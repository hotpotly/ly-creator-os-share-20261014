import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { WORKSPACE_BYTE_LIMIT, WORKSPACE_KEY_INFO, workspaceAad, workspaceSyncRequestSchema, type WorkspaceEnvelope } from '../shared/workspace-sync'
import type { WorkspaceRepository } from './db/repository'
import { WorkspaceSyncError, WorkspaceSyncRepository } from './db/workspace-sync-repository'
import type { SecretProtector } from './mobile-sync-service'

const envelopeSchema = z.object({
  protocolVersion: z.literal(1), workspaceId: z.string().uuid(), serviceId: z.string().uuid(),
  deviceId: z.string().uuid(), requestId: z.string().uuid(), counter: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().max(16), ciphertext: z.string().min(1).max(Math.ceil(WORKSPACE_BYTE_LIMIT / 3) * 4), tag: z.string().max(24)
}).strict()

function decode(value: string, size?: number): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (!value || decoded.toString('base64') !== value || (size !== undefined && decoded.length !== size)) throw new WorkspaceSyncError('invalid_encoding', '加密内容格式无效')
  return decoded
}

export function deriveWorkspaceKey(secret: Buffer, serviceId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from(serviceId, 'utf8'), Buffer.from(WORKSPACE_KEY_INFO, 'utf8'), 32))
}

export class WorkspaceSyncService {
  private readonly sync: WorkspaceSyncRepository
  constructor(private readonly domain: WorkspaceRepository, private readonly protector: SecretProtector, private readonly onChanged: () => void) {
    this.sync = new WorkspaceSyncRepository(domain)
  }

  handle(body: unknown): WorkspaceEnvelope {
    const envelope = envelopeSchema.parse(body)
    const serviceId = this.domain.getOrCreateMobileSyncServiceId()
    if (envelope.serviceId !== serviceId || envelope.workspaceId !== serviceId) throw new WorkspaceSyncError('wrong_workspace', '工作台身份不匹配', 403)
    if (!this.protector.isAvailable()) throw new WorkspaceSyncError('secret_unavailable', '设备密钥暂不可用', 503)
    const device = this.domain.getMobileSyncDeviceCredential(envelope.deviceId)
    if (!device || device.protocolVersion !== 2 || device.trustState !== 'trusted_v2') throw new WorkspaceSyncError('device_revoked', '设备已撤销或未配对', 401)
    const key = deriveWorkspaceKey(decode(this.protector.decrypt(device.encryptedSecret), 32), serviceId)
    let plaintext: Buffer
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, decode(envelope.nonce, 12))
      decipher.setAAD(Buffer.from(workspaceAad(envelope, 'request'), 'utf8'))
      decipher.setAuthTag(decode(envelope.tag, 16))
      plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()])
    } catch { throw new WorkspaceSyncError('invalid_authentication', '请求认证失败', 401) }
    if (plaintext.length > WORKSPACE_BYTE_LIMIT) throw new WorkspaceSyncError('request_too_large', '同步内容过大', 413)
    const request = workspaceSyncRequestSchema.parse(JSON.parse(plaintext.toString('utf8')))
    if (request.deviceId !== envelope.deviceId || request.workspaceId !== envelope.workspaceId) throw new WorkspaceSyncError('invalid_identity', '请求身份不匹配', 403)
    let encrypted: WorkspaceEnvelope | undefined
    const result = this.sync.synchronize(request, envelope.counter, response => {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.from(workspaceAad(envelope, 'response'), 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(response), 'utf8'), cipher.final()])
      encrypted = { ...envelope, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
    })
    if (result.changed) { try { this.onChanged() } catch { return encrypted! } }
    return encrypted!
  }
}
