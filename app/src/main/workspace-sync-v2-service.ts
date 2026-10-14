import { WorkspaceV2BlobStore } from './db/workspace-sync-v2-blobs'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'
import * as wire from '../shared/workspace-sync-v2'
import { WorkspaceV2Repository } from './db/workspace-sync-v2-repository'
import { WorkspaceSyncError } from './db/workspace-sync-repository'
import type { WorkspaceRepository } from './db/repository'
import type { SecretProtector } from './mobile-sync-service'

export type WorkspaceV2Purpose = typeof wire.WORKSPACE_V2_PURPOSES[number]
const requestSchemas: Record<WorkspaceV2Purpose, z.ZodType> = {
  capabilities: wire.workspaceV2CapabilitiesRequestSchema,
  sync: wire.workspaceV2SyncRequestSchema,
  'snapshot.start': wire.workspaceV2SnapshotStartRequestSchema,
  'snapshot.page': wire.workspaceV2SnapshotPageRequestSchema,
  'blob.start': wire.workspaceV2BlobStartRequestSchema,
  'blob.status': wire.workspaceV2BlobStatusRequestSchema,
  'blob.chunk': wire.workspaceV2BlobChunkRequestSchema,
  'blob.commit': wire.workspaceV2BlobCommitRequestSchema,
  'blob.read': wire.workspaceV2BlobReadRequestSchema
}
export function deriveWorkspaceV2Key(secret: Buffer, serviceId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from(serviceId), wire.WORKSPACE_V2_KEY_INFO, 32))
}
export class WorkspaceSyncV2Service {
  readonly repository: WorkspaceV2Repository
  constructor(private readonly domain: WorkspaceRepository, private readonly protector: SecretProtector, private readonly clock = Date.now, private readonly onChanged = () => {}) {
    this.repository = new WorkspaceV2Repository(domain, clock, () => this.blobStore())
  }
  private blobStore(): WorkspaceV2BlobStore {
    let row = this.domain.native.prepare("SELECT value FROM workspace_v2_settings WHERE key='blob_key'").get() as { value: string } | undefined
    if (!row) {
      row = { value: this.protector.encrypt(randomBytes(32).toString('base64')) }
      this.domain.native.prepare("INSERT INTO workspace_v2_settings(key,value) VALUES('blob_key',?)").run(row.value)
    }
    const decoded = this.protector.decrypt(row.value), key = Buffer.from(decoded, 'base64')
    if (key.length !== 32 || key.toString('base64') !== decoded) throw new WorkspaceSyncError('secret_unavailable', '正文密钥不可用', 503)
    return new WorkspaceV2BlobStore(this.domain.native, key, (deviceId, scope, write) => this.repository.authorize(deviceId, scope, write), this.clock)
  }
  async handle(purpose: WorkspaceV2Purpose, value: unknown): Promise<wire.WorkspaceV2Envelope> {
    const envelope = wire.workspaceV2EnvelopeSchema.parse(value)
    if (envelope.purpose !== purpose) throw new WorkspaceSyncError('wrong_purpose', '加密请求用途不匹配', 403)
    if (envelope.workspaceId !== this.repository.workspaceId) throw new WorkspaceSyncError('wrong_workspace', '工作台身份不匹配', 403)
    if (!this.protector.isAvailable()) throw new WorkspaceSyncError('secret_unavailable', '设备密钥暂不可用', 503)
    this.repository.assertDevice(envelope.deviceId)
    const credential = this.domain.getMobileSyncDeviceCredential(envelope.deviceId)!
    const decoded = this.protector.decrypt(credential.encryptedSecret), secret = Buffer.from(decoded, 'base64')
    if (secret.length !== 32 || secret.toString('base64') !== decoded) throw new WorkspaceSyncError('secret_unavailable', '配对密钥格式无效', 503)
    const key = deriveWorkspaceV2Key(secret, envelope.serviceId); secret.fill(0)
    try {
      let plaintext: Buffer
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
        decipher.setAAD(Buffer.from(wire.workspaceV2Aad(envelope, 'request')))
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
        plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
      } catch { throw new WorkspaceSyncError('invalid_authentication', '请求认证失败', 401) }
      if (plaintext.length > wire.WORKSPACE_V2_LIMITS.metadataBytes) throw new WorkspaceSyncError('request_too_large', '同步内容过大', 413)
      const request = await requestSchemas[purpose].parseAsync(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)))
      wire.workspaceV2AssertEnvelopeBody(envelope, request as { protocolVersion: number; workspaceId: string; deviceId: string })
      const before = this.repository.watermark()
      const result = this.domain.native.transaction(() => {
        this.repository.assertDevice(envelope.deviceId, credential.encryptedSecret)
        const stamp = this.repository.grantsStamp(envelope.deviceId)
        const previous = this.domain.native.prepare('SELECT counter FROM workspace_v2_devices WHERE device_id=?').get(envelope.deviceId) as { counter: number } | undefined
        if (previous && envelope.counter <= previous.counter) throw new WorkspaceSyncError('replayed_request', '请求已处理', 409)
        this.domain.native.prepare('INSERT INTO workspace_v2_devices(device_id,counter) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET counter=excluded.counter').run(envelope.deviceId, envelope.counter)
        const response = this.dispatch(purpose, request)
        const encoded = Buffer.from(JSON.stringify(response))
        if (encoded.length > wire.WORKSPACE_V2_LIMITS.metadataBytes) throw new WorkspaceSyncError('response_too_large', '响应内容过大', 413)
        this.repository.assertDevice(envelope.deviceId, credential.encryptedSecret)
        if (stamp !== this.repository.grantsStamp(envelope.deviceId)) throw new WorkspaceSyncError('grants_changed', '同步授权已变更', 409)
        if (!this.protector.isAvailable()) throw new WorkspaceSyncError('secret_unavailable', '设备密钥暂不可用', 503)
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce)
        cipher.setAAD(Buffer.from(wire.workspaceV2Aad(envelope, 'response')))
        const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()])
        return { ...envelope, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
      })()
      if (this.repository.watermark() !== before) { try { this.onChanged() } catch { void 0 } }
      return result
    } finally { key.fill(0) }
  }
  private dispatch(purpose: WorkspaceV2Purpose, request: unknown): unknown {
    switch (purpose) {
      case 'capabilities': return this.repository.capabilities(request as z.infer<typeof wire.workspaceV2CapabilitiesRequestSchema>)
      case 'sync': return this.repository.synchronize(request as z.infer<typeof wire.workspaceV2SyncRequestSchema>)
      case 'snapshot.start': return this.repository.startSnapshot(request as z.infer<typeof wire.workspaceV2SnapshotStartRequestSchema>)
      case 'snapshot.page': return this.repository.snapshotPage(request as z.infer<typeof wire.workspaceV2SnapshotPageRequestSchema>)
      case 'blob.read': return this.repository.readBlob(request as z.infer<typeof wire.workspaceV2BlobReadRequestSchema>)
      case 'blob.start': {
        const value = request as z.infer<typeof wire.workspaceV2BlobStartRequestSchema>
        this.repository.authorize(value.deviceId, value.scope, true)
        if (value.purpose !== 'document' || value.mediaType !== 'application/json' || !['todo', 'work_log'].includes(value.entity.kind)) throw new WorkspaceSyncError('write_not_available', '此对象类型尚未启用', 403)
        return { protocolVersion: 2, workspaceId: value.workspaceId, deviceId: value.deviceId, ...this.blobStore().start(value) }
      }
      case 'blob.status': {
        const value = request as z.infer<typeof wire.workspaceV2BlobStatusRequestSchema>
        return { protocolVersion: 2, workspaceId: value.workspaceId, deviceId: value.deviceId, ...this.blobStore().status(value.deviceId, value.sessionId) }
      }
      case 'blob.chunk': {
        const value = request as z.infer<typeof wire.workspaceV2BlobChunkRequestSchema>
        return { protocolVersion: 2, workspaceId: value.workspaceId, deviceId: value.deviceId, ...this.blobStore().chunk(value.deviceId, value.sessionId, value.index, value.sha256, Buffer.from(value.bytesBase64, 'base64')) }
      }
      case 'blob.commit': {
        const value = request as z.infer<typeof wire.workspaceV2BlobCommitRequestSchema>
        return { protocolVersion: 2, workspaceId: value.workspaceId, deviceId: value.deviceId, ...this.blobStore().commit(value.deviceId, value.sessionId, value.sha256, value.byteLength) }
      }
    }
  }
}
