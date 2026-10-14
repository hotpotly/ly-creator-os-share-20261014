import type { WorkspaceAccessState, WorkspaceAccessUpdate } from '../shared/workspace-access'
import { WorkspaceSyncV2Service } from './workspace-sync-v2-service'
import { WORKSPACE_V2_PURPOSES, workspaceV2Path, type WorkspaceV2Scope } from '../shared/workspace-sync-v2'
import { WorkspaceSyncService } from './workspace-sync-service'
import { WorkspaceSyncError } from './db/workspace-sync-repository'
import { WORKSPACE_PATH } from '../shared/workspace-sync'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  type KeyObject
} from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { constants, createReadStream } from 'node:fs'
import { chmod, mkdir, open, readFile, readdir, rename, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type { WorkspaceStore } from './db'
import type { MobileUploadAttachmentDeclaration, MobileUploadSessionState } from './db/repository'
import type { MobileCaptureReceipt, MobileSyncStatus } from '../shared/domain'
import { detectManagedFileProfile, discardManagedLocators, retainManagedFileFromPath, type RetainedManagedFile } from './managed-files'

export const MOBILE_SYNC_PROTOCOL_V1 = 1
export const MOBILE_SYNC_PROTOCOL_V2 = 2
export const MOBILE_SYNC_SERVICE_TYPE = '_lycreator._tcp'
const MAX_BODY_BYTES = 600_000
export const MOBILE_ATTACHMENT_CHUNK_BYTES = 256 * 1024
const MOBILE_UPLOAD_NO_EXPIRY = '9999-12-31T23:59:59.999Z'
const CONTROL_MESSAGE_MAX_AGE_MS = 15 * 60 * 1000
const MOBILE_UPLOAD_STAGING_ROOT = 'mobile-upload-staging'
const PAIRING_TTL_MS = 2 * 60 * 1000
const MAX_PAIRING_FAILURES = 5
const MAX_PENDING_PAIRINGS = 10
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

export interface SecretProtector {
  isAvailable(): boolean
  encrypt(secret: string): string
  decrypt(encrypted: string): string
}

export interface MobileSyncAdvertiser {
  readonly advertising: boolean
  start(input: { name: string; port: number; txt: string[] }): Promise<void>
  stop(): Promise<void>
}

export class DnsSdAdvertiser implements MobileSyncAdvertiser {
  private process: ChildProcess | null = null
  get advertising(): boolean { return this.process !== null }

  async start(input: { name: string; port: number; txt: string[] }): Promise<void> {
    if (this.process) return
    if (process.platform !== 'darwin') throw new Error('当前系统不支持Bonjour广播')
    const child = spawn('/usr/bin/dns-sd', ['-R', input.name, MOBILE_SYNC_SERVICE_TYPE, 'local.', String(input.port), ...input.txt], {
      stdio: 'ignore', windowsHide: true
    })
    await new Promise<void>((resolve, reject) => {
      const ready = (): void => { child.removeListener('error', fail); resolve() }
      const fail = (error: Error): void => { child.removeListener('spawn', ready); reject(error) }
      child.once('spawn', ready); child.once('error', fail)
    })
    this.process = child
    child.once('exit', () => { if (this.process === child) this.process = null })
  }

  async stop(): Promise<void> {
    const child = this.process
    this.process = null
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve() }, 1_000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.kill('SIGTERM')
    })
  }
}

class NoopAdvertiser implements MobileSyncAdvertiser {
  advertising = false
  async start(): Promise<void> { this.advertising = true }
  async stop(): Promise<void> { this.advertising = false }
}

type PairingState = 'pending' | 'approved' | 'rejected' | 'expired'
interface PairingSession {
  sessionId: string
  deviceId: string
  deviceName: string
  clientPublicKey: string
  sessionKey: Buffer
  deviceSecret: Buffer
  shortAuthenticationString: string
  requestedAt: number
  expiresAt: number
  state: PairingState
  upgradeDeviceId: string | null
}
interface FailedAttempts { timestamps: number[] }

interface AndroidUpdatePackage {
  apkPath: string
  versionCode: number
  versionName: string
}

interface AndroidUpdateTicket {
  apkPath: string
  sha256: string
  sizeBytes: number
  remoteAddress: string
  expiresAt: number
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(encoded), 'cache-control': 'no-store' })
  response.end(encoded)
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'request_too_large', '请求内容过大')
    chunks.push(buffer)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new RequestError(400, 'invalid_json', '请求格式无效') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError(400, 'invalid_request', '请求格式无效')
  return parsed as Record<string, unknown>
}

function decodeBase64(value: string, expectedLength: number | null, label: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new RequestError(400, 'invalid_encoding', `${label}格式无效`)
  const buffer = Buffer.from(value, 'base64')
  if (expectedLength !== null && buffer.length !== expectedLength) throw new RequestError(400, 'invalid_length', `${label}长度无效`)
  return buffer
}

function safeEqual(actual: Buffer, expected: Buffer): boolean {
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function optionalMetadataText(value: unknown, maximumLength: number, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new RequestError(400, 'invalid_capture_metadata', `${label}格式无效`)
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (normalized.length > maximumLength) throw new RequestError(400, 'invalid_capture_metadata', `${label}过长`)
  return normalized || null
}

function optionalBoundedMetadataText(value: unknown, maximumLength: number, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new RequestError(400, 'invalid_capture_metadata', `${label}格式无效`)
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return null
  return [...normalized].slice(0, maximumLength).join('')
}

function captureMetadata(payload: Record<string, unknown>): {
  title: string | null
  sourceApp: string | null
  sourceTitle: string | null
  sourceUrl: string | null
  notes: string
  recordingMarkersMs: number[]
  recordingInterruptionReason: string | null
} {
  const sourceUrl = optionalMetadataText(payload.sourceUrl, 4_096, '原始链接')
  if (sourceUrl) {
    let parsed: URL
    try { parsed = new URL(sourceUrl) } catch { throw new RequestError(400, 'invalid_capture_metadata', '原始链接无效') }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new RequestError(400, 'invalid_capture_metadata', '原始链接协议无效')
  }
  const rawMarkers = payload.recordingMarkersMs
  if (rawMarkers !== undefined && (!Array.isArray(rawMarkers) || rawMarkers.length > 10_000 ||
    rawMarkers.some((value) => !Number.isSafeInteger(value) || (value as number) < 0))) {
    throw new RequestError(400, 'invalid_capture_metadata', '录音重点标记无效')
  }
  return {
    // 标题只用于手机本地展示，过长时安全截短，不能阻断正文或附件同步。
    // 这也让旧版Android已经进入失败队列的记录在Mac升级后可直接重试。
    title: optionalBoundedMetadataText(payload.title, 60, '本地标题'),
    sourceApp: optionalMetadataText(payload.sourceApp, 255, '来源App'),
    sourceTitle: optionalMetadataText(payload.sourceTitle, 500, '分享标题'),
    sourceUrl,
    notes: optionalMetadataText(payload.notes, 20_000, '备注') ?? '',
    recordingMarkersMs: (rawMarkers as number[] | undefined) ?? [],
    recordingInterruptionReason: optionalMetadataText(payload.recordingInterruptionReason, 500, '录音中断原因')
  }
}

function rawX25519PublicKey(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(der).subarray(-32)
}

function importX25519PublicKey(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
}

export interface PairingClientHello {
  protocolVersion: 2
  deviceName: string
  clientPublicKey: string
  clientChallenge: string
  capabilities: string[]
  upgradeDeviceId: string | null
}

export function pairingClientHelloJson(hello: PairingClientHello): string {
  return JSON.stringify({
    protocolVersion: hello.protocolVersion,
    deviceName: hello.deviceName,
    clientPublicKey: hello.clientPublicKey,
    clientChallenge: hello.clientChallenge,
    capabilities: [...hello.capabilities].sort(),
    upgradeDeviceId: hello.upgradeDeviceId
  })
}

export function pairingTranscriptJson(input: PairingClientHello & {
  sessionId: string
  deviceId: string
  serviceId: string
  serverPublicKey: string
  serverChallenge: string
}): string {
  return JSON.stringify({
    protocolVersion: input.protocolVersion,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    serviceId: input.serviceId,
    deviceName: input.deviceName,
    clientPublicKey: input.clientPublicKey,
    serverPublicKey: input.serverPublicKey,
    clientChallenge: input.clientChallenge,
    serverChallenge: input.serverChallenge,
    capabilities: [...input.capabilities].sort(),
    upgradeDeviceId: input.upgradeDeviceId
  })
}

export function deriveShortAuthenticationString(sessionKey: Buffer, transcript: string): string {
  const digest = hmac(sessionKey, `sas\n${transcript}`)
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0')
}

export function mobileCaptureAad(input: { deviceId: string; mobileCaptureId: string; createdAt: string; protocolVersion?: 1 | 2 }): string {
  return `${input.protocolVersion ?? MOBILE_SYNC_PROTOCOL_V1}\n${input.deviceId}\n${input.mobileCaptureId}\n${input.createdAt}`
}

export function mobileUploadControlAad(input: { deviceId: string; mobileCaptureId: string; messageType: 'start' | 'status' | 'commit' | 'notes' | 'update'; createdAt: string }): string {
  return `${MOBILE_SYNC_PROTOCOL_V2}\n${input.deviceId}\n${input.mobileCaptureId}\n${input.messageType}\n${input.createdAt}`
}

export function mobileUploadChunkAad(input: { deviceId: string; mobileCaptureId: string; attachmentId: string; chunkIndex: number }): string {
  return `${MOBILE_SYNC_PROTOCOL_V2}\n${input.deviceId}\n${input.mobileCaptureId}\n${input.attachmentId}\n${input.chunkIndex}`
}

export function isPrivateLanAddress(address: string): boolean {
  const octets = address.split('.').map((value) => Number.parseInt(value, 10))
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  return octets[0] === 10 || (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) || (octets[0] === 192 && octets[1] === 168)
}

export class MobileSyncService {
  private readonly workspaceSync: WorkspaceSyncService
  private readonly workspaceSyncV2: WorkspaceSyncV2Service
  private server: Server | null = null
  private port: number | null = null
  private error: string | null = null
  private readonly failedPairing = new Map<string, FailedAttempts>()
  private readonly pairings = new Map<string, PairingSession>()
  private readonly advertiser: MobileSyncAdvertiser
  private readonly serviceId: string
  private readonly serviceName: string
  private readonly androidUpdateOverride: AndroidUpdatePackage | null
  private readonly updateTickets = new Map<string, AndroidUpdateTicket>()

  constructor(
    private readonly store: WorkspaceStore,
    private readonly protector: SecretProtector,
    private readonly onChanged: () => void,
    options: { advertiser?: MobileSyncAdvertiser; androidUpdate?: AndroidUpdatePackage; onWorkspaceChanged?: () => void } = {}
  ) {
    this.workspaceSyncV2 = new WorkspaceSyncV2Service(store.repository, protector, Date.now, options.onWorkspaceChanged ?? (() => {}))
    this.workspaceSync = new WorkspaceSyncService(store.repository, protector, options.onWorkspaceChanged ?? (() => {}))
    this.advertiser = options.advertiser ?? (process.env.NODE_ENV === 'test' ? new NoopAdvertiser() : new DnsSdAdvertiser())
    this.serviceId = store.repository.getOrCreateMobileSyncServiceId()
    this.serviceName = `LY Creator OS-${this.serviceId.slice(0, 6)}`
    this.androidUpdateOverride = options.androidUpdate ?? null
  }

  setWorkspaceV2Grants(deviceId: string, grants: readonly { scope: WorkspaceV2Scope; write: boolean }[]): void {
    this.workspaceSyncV2.repository.setDeviceGrants(deviceId, grants)
  }

  getWorkspaceV2Access(deviceId: string): WorkspaceAccessState {
    return this.workspaceSyncV2.repository.getDeviceAccess(deviceId)
  }

  updateWorkspaceV2Access(input: WorkspaceAccessUpdate): WorkspaceAccessState {
    return this.workspaceSyncV2.repository.updateDeviceAccess(input)
  }

  async startFromPreference(): Promise<void> {
    if (!this.store.repository.getMobileSyncEnabled()) return
    try { await this.start() } catch (error) { this.error = error instanceof Error ? error.message : '局域网接收启动失败' }
  }

  async setEnabled(enabled: boolean): Promise<MobileSyncStatus> {
    if (enabled) {
      await this.start()
      this.store.repository.setMobileSyncEnabled(true)
    } else {
      this.store.repository.setMobileSyncEnabled(false)
      await this.stop()
    }
    return this.getStatus()
  }

  async start(): Promise<void> {
    if (this.server) return
    if (!this.protector.isAvailable()) throw new Error('系统安全存储当前不可用，不能保存配对密钥')
    await this.cleanupExpiredUploads()
    this.error = null
    const server = createServer((request, response) => { void this.handle(request, response) })
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 3_000
    server.maxHeadersCount = 32
    server.maxConnections = 24
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => { server.removeListener('listening', ready); reject(error) }
      const ready = (): void => { server.removeListener('error', fail); resolve() }
      server.once('error', fail); server.once('listening', ready); server.listen(0, '0.0.0.0')
    })
    const address = server.address()
    if (!address || typeof address === 'string') { server.close(); throw new Error('无法取得局域网监听端口') }
    try { await this.advertiser.start({ name: this.serviceName, port: address.port, txt: [`pv=${MOBILE_SYNC_PROTOCOL_V2}`, `sid=${this.serviceId}`] }) } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw new Error(`Bonjour广播启动失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
    this.server = server
    this.port = address.port
    server.on('error', (reason) => { this.error = reason.message })
  }

  async stop(): Promise<void> {
    this.pairings.clear()
    const server = this.server
    this.server = null
    this.port = null
    await this.advertiser.stop()
    if (!server) return
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeAllConnections()
    await closed
  }

  approvePairing(sessionId: string): MobileSyncStatus {
    const session = this.requirePendingPairing(sessionId)
    this.store.repository.trustMobileSyncDevice({
      id: session.deviceId,
      name: session.deviceName,
      encryptedSecret: this.protector.encrypt(session.deviceSecret.toString('base64')),
      identityPublicKey: session.clientPublicKey,
      upgradeDeviceId: session.upgradeDeviceId
    })
    session.state = 'approved'
    this.onChanged()
    return this.getStatus()
  }

  rejectPairing(sessionId: string): MobileSyncStatus {
    const session = this.requirePendingPairing(sessionId)
    session.state = 'rejected'
    return this.getStatus()
  }

  revokeDevice(deviceId: string): MobileSyncStatus {
    this.store.repository.revokeMobileSyncDevice(deviceId)
    return this.getStatus()
  }

  getStatus(): MobileSyncStatus {
    this.cleanupPairings()
    const port = this.port
    return {
      enabled: this.store.repository.getMobileSyncEnabled(),
      running: Boolean(this.server),
      securityAvailable: this.protector.isAvailable(),
      port,
      addresses: port ? this.localAddresses().map((address) => `${address}:${port}`) : [],
      serviceName: this.server ? this.serviceName : null,
      serviceId: this.serviceId,
      advertised: this.advertiser.advertising,
      protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
      error: this.error,
      pendingPairings: [...this.pairings.values()].filter((session) => session.state === 'pending').map((session) => ({
        sessionId: session.sessionId,
        deviceName: session.deviceName,
        shortAuthenticationString: session.shortAuthenticationString,
        requestedAt: new Date(session.requestedAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        upgradeDeviceId: session.upgradeDeviceId
      })),
      devices: this.store.repository.listMobileSyncDevices()
    }
  }

  private localAddresses(): string[] {
    const addresses = new Set<string>()
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateLanAddress(entry.address)) addresses.add(entry.address)
    }
    return [...addresses].sort()
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('x-content-type-options', 'nosniff')
    try {
      const workspacePurpose = WORKSPACE_V2_PURPOSES.find(purpose => workspaceV2Path(purpose) === request.url)
      if (request.method === 'POST' && workspacePurpose) { json(response, 200, await this.workspaceSyncV2.handle(workspacePurpose, await readJson(request))); return }
      if (request.method === 'POST' && request.url === WORKSPACE_PATH) { json(response, 200, this.workspaceSync.handle(await readJson(request))); return }
      if (request.method === 'GET' && request.url === '/v1/health') { json(response, 200, { protocolVersion: MOBILE_SYNC_PROTOCOL_V1, service: 'LY Creator OS', legacy: true }); return }
      if (request.method === 'POST' && request.url === '/v1/pair') { json(response, 410, { error: 'legacy_pairing_disabled', message: '新设备请使用自动发现和两端数字确认' }); return }
      if (request.method === 'POST' && request.url === '/v1/captures') { await this.handleCapture(request, response, MOBILE_SYNC_PROTOCOL_V1); return }
      if (request.method === 'GET' && request.url === '/v2/health') { json(response, 200, { protocolVersion: MOBILE_SYNC_PROTOCOL_V2, service: 'LY Creator OS', serviceId: this.serviceId }); return }
      if (request.method === 'POST' && request.url === '/v2/pair/start') { await this.handlePairingStart(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/pair/status') { await this.handlePairingStatus(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/captures') { await this.handleCapture(request, response, MOBILE_SYNC_PROTOCOL_V2); return }
      if (request.method === 'POST' && request.url === '/v2/captures/notes') { await this.handleCaptureNotes(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/app/update/check') { await this.handleUpdateCheck(request, response); return }
      if (request.method === 'GET' && request.url?.startsWith('/v2/app/update/download?')) { await this.handleUpdateDownload(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/uploads/start') { await this.handleUploadStart(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/uploads/status') { await this.handleUploadStatus(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/uploads/chunk') { await this.handleUploadChunk(request, response); return }
      if (request.method === 'POST' && request.url === '/v2/uploads/commit') { await this.handleUploadCommit(request, response); return }
      json(response, 404, { error: 'not_found' })
    } catch (error) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      if (error instanceof WorkspaceSyncError) { json(response, error.status, { error: error.code, message: error.message }); return }
      if (error instanceof RequestError) { json(response, error.status, { error: error.code, message: error.message }); return }
      const message = error instanceof Error ? error.message : '请求处理失败'
      json(response, 400, { error: 'invalid_request', message })
    }
  }

  private async handlePairingStart(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const remote = request.socket.remoteAddress ?? 'unknown'
    if (this.isRateLimited(remote)) throw new RequestError(429, 'too_many_attempts', '配对尝试过多，请稍后再试')
    this.cleanupPairings()
    if ([...this.pairings.values()].filter((session) => session.state === 'pending').length >= MAX_PENDING_PAIRINGS) throw new RequestError(503, 'pairing_busy', '待确认设备过多，请稍后再试')
    const body = await readJson(request)
    const protocolVersion = body.protocolVersion
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : ''
    const clientPublicKey = typeof body.clientPublicKey === 'string' ? body.clientPublicKey : ''
    const clientChallenge = typeof body.clientChallenge === 'string' ? body.clientChallenge : ''
    const capabilities = Array.isArray(body.capabilities) ? [...new Set(body.capabilities.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64))].sort() : []
    const upgradeDeviceId = typeof body.upgradeDeviceId === 'string' && body.upgradeDeviceId ? body.upgradeDeviceId : null
    if (protocolVersion !== MOBILE_SYNC_PROTOCOL_V2 || !deviceName || deviceName.length > 80 || capabilities.length > 20) throw new RequestError(400, 'invalid_client_hello', '配对请求字段无效')
    const clientPublicKeyBytes = decodeBase64(clientPublicKey, 32, 'Android公钥')
    const clientChallengeBytes = decodeBase64(clientChallenge, 32, 'Android挑战')
    const hello: PairingClientHello = { protocolVersion: 2, deviceName, clientPublicKey, clientChallenge, capabilities, upgradeDeviceId }
    if (upgradeDeviceId) {
      const credential = this.store.repository.getMobileSyncDeviceCredential(upgradeDeviceId)
      if (!credential || credential.protocolVersion !== 1 || credential.trustState !== 'legacy_v1') {
        this.recordPairingFailure(remote); throw new RequestError(401, 'legacy_identity_invalid', '旧版设备身份无效或已经升级')
      }
      const proof = typeof body.upgradeProof === 'string' ? decodeBase64(body.upgradeProof, 32, '升级凭据') : Buffer.alloc(0)
      const oldSecret = decodeBase64(this.protector.decrypt(credential.encryptedSecret), 32, '旧版设备密钥')
      if (!safeEqual(proof, hmac(oldSecret, `upgrade-start\n${pairingClientHelloJson(hello)}`))) {
        this.recordPairingFailure(remote); throw new RequestError(401, 'legacy_proof_invalid', '旧版设备安全升级验证失败')
      }
    }
    const sessionId = randomUUID()
    const deviceId = upgradeDeviceId ?? randomUUID()
    const serverChallengeBytes = randomBytes(32)
    const { publicKey, privateKey } = generateKeyPairSync('x25519')
    const serverPublicKey = rawX25519PublicKey(publicKey).toString('base64')
    const serverChallenge = serverChallengeBytes.toString('base64')
    const transcript = pairingTranscriptJson({ ...hello, sessionId, deviceId, serviceId: this.serviceId, serverPublicKey, serverChallenge })
    const sharedSecret = diffieHellman({ privateKey, publicKey: importX25519PublicKey(clientPublicKeyBytes) })
    const salt = createHash('sha256').update(Buffer.concat([clientChallengeBytes, serverChallengeBytes])).digest()
    const derived = Buffer.from(hkdfSync('sha256', sharedSecret, salt, Buffer.from(`ly-creator-mobile-pairing-v2\n${transcript}`, 'utf8'), 64))
    const sessionKey = derived.subarray(0, 32)
    const deviceSecret = derived.subarray(32, 64)
    const shortAuthenticationString = deriveShortAuthenticationString(sessionKey, transcript)
    const requestedAt = Date.now()
    this.pairings.set(sessionId, {
      sessionId, deviceId, deviceName, clientPublicKey, sessionKey, deviceSecret, shortAuthenticationString,
      requestedAt, expiresAt: requestedAt + PAIRING_TTL_MS, state: 'pending', upgradeDeviceId
    })
    this.failedPairing.delete(remote)
    this.onChanged()
    json(response, 200, {
      protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
      sessionId,
      deviceId,
      serviceId: this.serviceId,
      serverPublicKey,
      serverChallenge,
      expiresAt: new Date(requestedAt + PAIRING_TTL_MS).toISOString(),
      serverProof: hmac(sessionKey, `server-proof\n${transcript}`).toString('base64')
    })
  }

  private async handlePairingStatus(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const session = this.pairings.get(sessionId)
    if (!session) throw new RequestError(404, 'pairing_not_found', '配对请求不存在或已过期')
    if (session.state === 'pending' && session.expiresAt <= Date.now()) session.state = 'expired'
    const proof = typeof body.proof === 'string' ? decodeBase64(body.proof, 32, '状态凭据') : Buffer.alloc(0)
    if (!safeEqual(proof, hmac(session.sessionKey, `status\n${session.sessionId}`))) throw new RequestError(401, 'pairing_proof_invalid', '配对状态验证失败')
    json(response, 200, {
      protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      serviceId: this.serviceId,
      state: session.state
    })
  }

  private async handleCapture(request: IncomingMessage, response: ServerResponse, expectedProtocolVersion: 1 | 2): Promise<void> {
    const body = await readJson(request)
    const protocolVersion = body.protocolVersion
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    const mobileCaptureId = typeof body.mobileCaptureId === 'string' ? body.mobileCaptureId : ''
    const createdAt = typeof body.createdAt === 'string' ? body.createdAt : ''
    const nonce = typeof body.nonce === 'string' ? body.nonce : ''
    const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : ''
    const tag = typeof body.tag === 'string' ? body.tag : ''
    if (protocolVersion !== expectedProtocolVersion || !deviceId || !mobileCaptureId || !createdAt || !nonce || !ciphertext || !tag) throw new RequestError(400, 'encrypted_record_incomplete', '加密记录字段不完整')
    const device = this.store.repository.getMobileSyncDeviceCredential(deviceId)
    if (!device || device.protocolVersion !== expectedProtocolVersion) throw new RequestError(401, 'device_revoked', '设备未配对、已撤销或需要安全升级')
    if (!/^[0-9a-f-]{36}$/i.test(deviceId) || mobileCaptureId.length > 128 || !/^[0-9a-z-]{1,128}$/i.test(mobileCaptureId) || !Number.isFinite(new Date(createdAt).getTime())) throw new RequestError(400, 'invalid_record_identity', '记录标识或时间无效')
    const secret = decodeBase64(this.protector.decrypt(device.encryptedSecret), 32, '设备密钥')
    const nonceBytes = decodeBase64(nonce, 12, 'nonce')
    const ciphertextBytes = decodeBase64(ciphertext, null, '密文')
    const tagBytes = decodeBase64(tag, 16, '认证标签')
    const decipher = createDecipheriv('aes-256-gcm', secret, nonceBytes)
    decipher.setAAD(Buffer.from(mobileCaptureAad({ deviceId, mobileCaptureId, createdAt, protocolVersion: expectedProtocolVersion }), 'utf8'))
    decipher.setAuthTag(tagBytes)
    let plaintext: string
    try { plaintext = Buffer.concat([decipher.update(ciphertextBytes), decipher.final()]).toString('utf8') } catch { throw new RequestError(400, 'authentication_failed', '加密记录验证失败') }
    const payload = JSON.parse(plaintext) as Record<string, unknown>
    const content = typeof payload.content === 'string' ? payload.content : ''
    const hint = payload.hint === 'inspiration' || payload.hint === 'topic' ? payload.hint : 'auto'
    const metadata = captureMetadata(payload)
    const receipt: MobileCaptureReceipt = this.store.repository.importMobileCapture({
      deviceId, mobileCaptureId, content, hint, createdAt, ...metadata
    })
    this.onChanged()
    json(
      response,
      200,
      expectedProtocolVersion === MOBILE_SYNC_PROTOCOL_V2
        ? this.uploadResponse(secret, {
            protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
            mobileCaptureId: receipt.mobileCaptureId,
            desktopCaptureId: receipt.desktopCaptureId,
            duplicate: receipt.duplicate,
            attachmentCount: 0,
            attachmentsCommitted: true
          })
        : receipt
    )
  }

  private async handleCaptureNotes(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const control = this.decryptUploadControl(await readJson(request), 'notes')
    const revision = typeof control.payload.revision === 'number' ? control.payload.revision : -1
    const notes = typeof control.payload.notes === 'string' ? control.payload.notes : ''
    if (!Number.isSafeInteger(revision) || revision < 1 || !notes.trim() || notes.length > 100_000) {
      throw new RequestError(400, 'invalid_note_update', '追加备注内容或版本无效')
    }
    const receipt = this.store.repository.appendMobileCaptureNotes({
      deviceId: control.deviceId,
      mobileCaptureId: control.mobileCaptureId,
      revision,
      notes
    })
    if (!receipt.duplicate) this.onChanged()
    json(response, 200, this.uploadResponse(control.secret, {
      protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
      ...receipt
    }))
  }

  private async handleUpdateCheck(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const control = this.decryptUploadControl(await readJson(request), 'update')
    if (control.mobileCaptureId !== 'app-update') {
      throw new RequestError(400, 'invalid_update_identity', '更新请求标识无效')
    }
    const currentVersionCode = typeof control.payload.currentVersionCode === 'number'
      ? control.payload.currentVersionCode
      : -1
    if (!Number.isSafeInteger(currentVersionCode) || currentVersionCode < 0) {
      throw new RequestError(400, 'invalid_update_version', 'Android版本信息无效')
    }
    const update = await this.androidUpdatePackage()
    if (!update) {
      json(response, 200, this.uploadResponse(control.secret, {
        protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
        mobileCaptureId: control.mobileCaptureId,
        available: false,
        reason: 'not_configured'
      }))
      return
    }
    const available = update.versionCode > currentVersionCode
    let ticket: string | null = null
    if (available) {
      this.cleanupUpdateTickets()
      const remoteAddress = request.socket.remoteAddress ?? ''
      for (const [id, existing] of this.updateTickets) {
        if (existing.remoteAddress === remoteAddress) this.updateTickets.delete(id)
      }
      ticket = randomBytes(32).toString('base64url')
      this.updateTickets.set(ticket, {
        apkPath: update.apkPath,
        sha256: update.sha256,
        sizeBytes: update.sizeBytes,
        remoteAddress,
        expiresAt: Date.now() + 2 * 60 * 1000
      })
    }
    json(response, 200, this.uploadResponse(control.secret, {
      protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
      mobileCaptureId: control.mobileCaptureId,
      available,
      versionCode: update.versionCode,
      versionName: update.versionName,
      sizeBytes: update.sizeBytes,
      sha256: update.sha256,
      ticket
    }))
  }

  private async handleUpdateDownload(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.cleanupUpdateTickets()
    const url = new URL(request.url ?? '', 'http://localhost')
    const ticketValue = url.searchParams.get('ticket') ?? ''
    const ticket = this.updateTickets.get(ticketValue)
    this.updateTickets.delete(ticketValue)
    if (!ticket || ticket.expiresAt <= Date.now() || ticket.remoteAddress !== (request.socket.remoteAddress ?? '')) {
      throw new RequestError(401, 'update_ticket_invalid', '更新下载凭据无效或已经过期')
    }
    const info = await stat(ticket.apkPath).catch(() => null)
    if (!info?.isFile() || info.size !== ticket.sizeBytes) {
      throw new RequestError(404, 'update_package_missing', 'Android更新包已经变化，请重新检查')
    }
    response.statusCode = 200
    response.setHeader('content-type', 'application/vnd.android.package-archive')
    response.setHeader('content-length', String(ticket.sizeBytes))
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-disposition', 'attachment; filename="ly-creator-capture.apk"')
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(ticket.apkPath)
      stream.on('error', reject)
      response.on('finish', resolvePromise)
      response.on('close', resolvePromise)
      stream.pipe(response)
    })
  }

  private async androidUpdatePackage(): Promise<(AndroidUpdatePackage & {
    sha256: string
    sizeBytes: number
  }) | null> {
    let configured = this.androidUpdateOverride
    if (!configured) {
      const apkPath = process.env.CREATOR_OS_ANDROID_APK_PATH
        ? resolve(process.env.CREATOR_OS_ANDROID_APK_PATH)
        : join(process.resourcesPath ?? '', 'android', 'ly-creator-capture.apk')
      const metadataPath = process.env.CREATOR_OS_ANDROID_UPDATE_METADATA
        ? resolve(process.env.CREATOR_OS_ANDROID_UPDATE_METADATA)
        : join(dirname(apkPath), 'update.json')
      try {
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
        if (!Number.isSafeInteger(metadata.versionCode) ||
            (metadata.versionCode as number) < 1 ||
            typeof metadata.versionName !== 'string' ||
            !metadata.versionName.trim()) return null
        configured = {
          apkPath,
          versionCode: metadata.versionCode as number,
          versionName: metadata.versionName.trim()
        }
      } catch {
        return null
      }
    }
    const info = await stat(configured.apkPath).catch(() => null)
    if (!info?.isFile() || info.size <= 0) return null
    const digest = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(configured!.apkPath)
      stream.on('data', (chunk) => digest.update(chunk))
      stream.on('end', resolvePromise)
      stream.on('error', reject)
    })
    return {
      ...configured,
      sha256: digest.digest('hex'),
      sizeBytes: info.size
    }
  }

  private cleanupUpdateTickets(): void {
    const timestamp = Date.now()
    for (const [id, ticket] of this.updateTickets) {
      if (ticket.expiresAt <= timestamp) this.updateTickets.delete(id)
    }
  }

  private authenticatedDeviceSecret(deviceId: string): Buffer {
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw new RequestError(400, 'invalid_device_identity', '设备标识无效')
    const device = this.store.repository.getMobileSyncDeviceCredential(deviceId)
    if (!device || device.protocolVersion !== MOBILE_SYNC_PROTOCOL_V2 || device.trustState !== 'trusted_v2') {
      throw new RequestError(401, 'device_revoked', '设备未配对、已撤销或需要安全升级')
    }
    return decodeBase64(this.protector.decrypt(device.encryptedSecret), 32, '设备密钥')
  }

  private validateUploadIdentity(deviceId: string, mobileCaptureId: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !/^[0-9a-z-]{1,128}$/i.test(mobileCaptureId)) {
      throw new RequestError(400, 'invalid_upload_identity', '记录标识无效')
    }
  }

  private decryptUploadControl(body: Record<string, unknown>, messageType: 'start' | 'status' | 'commit' | 'notes' | 'update'): {
    deviceId: string
    mobileCaptureId: string
    secret: Buffer
    payload: Record<string, unknown>
  } {
    const protocolVersion = body.protocolVersion
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    const mobileCaptureId = typeof body.mobileCaptureId === 'string' ? body.mobileCaptureId : ''
    const createdAt = typeof body.createdAt === 'string' ? body.createdAt : ''
    const nonce = typeof body.nonce === 'string' ? body.nonce : ''
    const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : ''
    const tag = typeof body.tag === 'string' ? body.tag : ''
    if (protocolVersion !== MOBILE_SYNC_PROTOCOL_V2 || !createdAt || !nonce || !ciphertext || !tag) throw new RequestError(400, 'encrypted_control_incomplete', '加密控制消息字段不完整')
    this.validateUploadIdentity(deviceId, mobileCaptureId)
    const messageTime = Date.parse(createdAt)
    if (!Number.isFinite(messageTime) || Math.abs(Date.now() - messageTime) > CONTROL_MESSAGE_MAX_AGE_MS) throw new RequestError(400, 'control_message_expired', '同步请求时间无效或已经过期')
    const secret = this.authenticatedDeviceSecret(deviceId)
    const decipher = createDecipheriv('aes-256-gcm', secret, decodeBase64(nonce, 12, 'nonce'))
    decipher.setAAD(Buffer.from(mobileUploadControlAad({ deviceId, mobileCaptureId, messageType, createdAt }), 'utf8'))
    decipher.setAuthTag(decodeBase64(tag, 16, '认证标签'))
    let plaintext: Buffer
    try { plaintext = Buffer.concat([decipher.update(decodeBase64(ciphertext, null, '密文')), decipher.final()]) } catch {
      throw new RequestError(400, 'authentication_failed', '加密控制消息验证失败')
    }
    let payload: unknown
    try { payload = JSON.parse(plaintext.toString('utf8')) } catch { throw new RequestError(400, 'invalid_control_payload', '加密控制消息内容无效') }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError(400, 'invalid_control_payload', '加密控制消息内容无效')
    return { deviceId, mobileCaptureId, secret, payload: payload as Record<string, unknown> }
  }

  private uploadResponse(secret: Buffer, body: Record<string, unknown>): Record<string, unknown> {
    return { ...body, proof: hmac(secret, `upload-response\n${JSON.stringify(body)}`).toString('base64') }
  }

  private uploadStatusBody(session: MobileUploadSessionState): Record<string, unknown> {
    return {
      protocolVersion: MOBILE_SYNC_PROTOCOL_V2,
      mobileCaptureId: session.mobileCaptureId,
      state: session.state,
      committedCaptureId: session.committedCaptureId,
      attachments: session.attachments.map((attachment) => {
        const received = new Set(attachment.receivedChunks.map((chunk) => chunk.chunkIndex))
        return {
          attachmentId: attachment.attachmentId,
          state: attachment.state,
          receivedCount: attachment.receivedCount,
          chunkCount: attachment.chunkCount,
          missingChunks: Array.from({ length: attachment.chunkCount }, (_, index) => index).filter((index) => !received.has(index))
        }
      })
    }
  }

  private async handleUploadStart(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const control = this.decryptUploadControl(await readJson(request), 'start')
    const content = typeof control.payload.content === 'string' ? control.payload.content.replace(/\r\n?/g, '\n').trim() : ''
    const hint = control.payload.hint === 'inspiration' || control.payload.hint === 'topic' ? control.payload.hint : 'auto'
    const metadata = captureMetadata(control.payload)
    const captureCreatedAt = typeof control.payload.captureCreatedAt === 'string' ? control.payload.captureCreatedAt : ''
    if (content.length > 100_000 || !Number.isFinite(Date.parse(captureCreatedAt))) throw new RequestError(400, 'invalid_capture_metadata', '记录正文或时间无效')
    const rawAttachments = Array.isArray(control.payload.attachments) ? control.payload.attachments : []
    if (rawAttachments.length < 1) throw new RequestError(400, 'invalid_attachment_count', '每条附件记录至少需要1个附件')
    const attachmentIds = new Set<string>()
    let totalBytes = 0
    const attachments: MobileUploadAttachmentDeclaration[] = rawAttachments.map((raw, position): MobileUploadAttachmentDeclaration => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RequestError(400, 'invalid_attachment_metadata', '附件声明无效')
      const item = raw as Record<string, unknown>
      const attachmentId = typeof item.attachmentId === 'string' ? item.attachmentId : ''
      const attachmentKind = item.attachmentKind
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim().toLowerCase() : ''
      const sourceModifiedAtRaw = typeof item.sourceModifiedAt === 'string' ? item.sourceModifiedAt : null
      const sourceModifiedAt = sourceModifiedAtRaw && Number.isFinite(Date.parse(sourceModifiedAtRaw))
        ? new Date(sourceModifiedAtRaw).toISOString()
        : null
      const byteSize = typeof item.byteSize === 'number' ? item.byteSize : -1
      const sha256 = typeof item.sha256 === 'string' ? item.sha256.toLowerCase() : ''
      const chunkCount = typeof item.chunkCount === 'number' ? item.chunkCount : -1
      if (!/^[0-9a-z-]{1,128}$/i.test(attachmentId) || attachmentIds.has(attachmentId)) throw new RequestError(400, 'invalid_attachment_id', '附件标识无效或重复')
      if (attachmentKind !== 'image' && attachmentKind !== 'video' && attachmentKind !== 'audio' && attachmentKind !== 'pdf' && attachmentKind !== 'word' && attachmentKind !== 'file') throw new RequestError(400, 'invalid_attachment_kind', '附件类型无效')
      if (!name || name.length > 255 || basename(name) !== name || name.includes('\0')) throw new RequestError(400, 'invalid_attachment_name', '附件名称无效')
      if (!mimeType || mimeType.length > 200 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)) throw new RequestError(400, 'invalid_attachment_mime', '附件MIME无效')
      if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new RequestError(400, 'invalid_attachment_size', '附件大小无效或为空')
      if (!/^[0-9a-f]{64}$/.test(sha256) || chunkCount !== Math.ceil(byteSize / MOBILE_ATTACHMENT_CHUNK_BYTES)) throw new RequestError(400, 'invalid_attachment_integrity', '附件大小、摘要或分块数无效')
      attachmentIds.add(attachmentId); totalBytes += byteSize
      if (!Number.isSafeInteger(totalBytes)) throw new RequestError(400, 'invalid_attachment_size', '附件总大小无效')
      if (sourceModifiedAtRaw && !sourceModifiedAt) throw new RequestError(400, 'invalid_attachment_time', '附件来源时间无效')
      return { attachmentId, attachmentKind, position, name, mimeType, sourceModifiedAt, byteSize, sha256, chunkCount }
    })
    const started = this.store.repository.beginMobileAssetUpload({
      deviceId: control.deviceId, mobileCaptureId: control.mobileCaptureId, protocolVersion: 2, content, hint, ...metadata,
      captureCreatedAt: new Date(captureCreatedAt).toISOString(), expiresAt: MOBILE_UPLOAD_NO_EXPIRY, attachments
    })
    if ('desktopCaptureId' in started) {
      const committedSession = this.store.repository.getMobileAssetUpload(
        control.deviceId,
        control.mobileCaptureId
      )
      if (committedSession?.state === 'committed') {
        await this.removeSessionStaging(committedSession.id)
          .catch(() => undefined)
      }
      json(response, 200, this.uploadResponse(control.secret, { ...started, protocolVersion: MOBILE_SYNC_PROTOCOL_V2, attachmentCount: attachments.length, attachmentsCommitted: true }))
      return
    }
    json(response, 200, this.uploadResponse(control.secret, this.uploadStatusBody(started)))
  }

  private async handleUploadStatus(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const control = this.decryptUploadControl(await readJson(request), 'status')
    const session = this.store.repository.getMobileAssetUpload(control.deviceId, control.mobileCaptureId)
    if (!session) throw new RequestError(404, 'upload_not_found', '附件上传会话不存在或已经过期')
    json(response, 200, this.uploadResponse(control.secret, this.uploadStatusBody(session)))
  }

  private async handleUploadChunk(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    const mobileCaptureId = typeof body.mobileCaptureId === 'string' ? body.mobileCaptureId : ''
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : ''
    const chunkIndex = typeof body.chunkIndex === 'number' ? body.chunkIndex : -1
    const nonce = typeof body.nonce === 'string' ? body.nonce : ''
    const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : ''
    const tag = typeof body.tag === 'string' ? body.tag : ''
    if (body.protocolVersion !== MOBILE_SYNC_PROTOCOL_V2 || !/^[0-9a-z-]{1,128}$/i.test(attachmentId) || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || !nonce || !ciphertext || !tag) {
      throw new RequestError(400, 'encrypted_chunk_incomplete', '加密附件分块字段不完整')
    }
    this.validateUploadIdentity(deviceId, mobileCaptureId)
    const secret = this.authenticatedDeviceSecret(deviceId)
    const nonceBytes = decodeBase64(nonce, 12, 'nonce')
    const ciphertextBytes = decodeBase64(ciphertext, null, '分块密文')
    if (ciphertextBytes.length > MOBILE_ATTACHMENT_CHUNK_BYTES) throw new RequestError(413, 'chunk_too_large', '附件分块不能超过256KB')
    const decipher = createDecipheriv('aes-256-gcm', secret, nonceBytes)
    decipher.setAAD(Buffer.from(mobileUploadChunkAad({ deviceId, mobileCaptureId, attachmentId, chunkIndex }), 'utf8'))
    decipher.setAuthTag(decodeBase64(tag, 16, '认证标签'))
    let plaintext: Buffer
    try { plaintext = Buffer.concat([decipher.update(ciphertextBytes), decipher.final()]) } catch { throw new RequestError(400, 'authentication_failed', '附件分块验证失败') }
    const session = this.store.repository.getMobileAssetUpload(deviceId, mobileCaptureId)
    const attachment = session?.attachments.find((item) => item.attachmentId === attachmentId)
    if (!session || !attachment) throw new RequestError(404, 'upload_not_found', '附件上传会话不存在')
    const expectedBytes = chunkIndex === attachment.chunkCount - 1
      ? attachment.byteSize - MOBILE_ATTACHMENT_CHUNK_BYTES * (attachment.chunkCount - 1)
      : MOBILE_ATTACHMENT_CHUNK_BYTES
    if (chunkIndex >= attachment.chunkCount || plaintext.length !== expectedBytes) throw new RequestError(400, 'chunk_size_mismatch', '附件分块大小与声明不一致')
    const sha256 = createHash('sha256').update(plaintext).digest('hex')
    const existing = attachment.receivedChunks.find((chunk) => chunk.chunkIndex === chunkIndex)
    if (existing) {
      if (existing.byteSize !== plaintext.length || existing.sha256 !== sha256) throw new RequestError(409, 'chunk_conflict', '同一分块标识对应的内容不一致')
      const result = { protocolVersion: 2, mobileCaptureId, attachmentId, chunkIndex, duplicate: true, receivedCount: attachment.receivedCount, chunkCount: attachment.chunkCount }
      json(response, 200, this.uploadResponse(secret, result)); return
    }
    const reusedNonce = this.store.repository.findMobileAssetChunkNonce(deviceId, nonce)
    if (reusedNonce) throw new RequestError(409, 'nonce_reused', '附件分块nonce已经被其他分块使用')
    // Every request writes a private candidate. A concurrent conflicting retry
    // must never overwrite or delete the file already referenced by SQLite.
    const stagedLocator = join(
      MOBILE_UPLOAD_STAGING_ROOT,
      session.id,
      attachment.id,
      `${chunkIndex}-${randomUUID()}.chunk`
    )
    await this.writeStagedBytes(stagedLocator, plaintext)
    let recorded: { duplicate: boolean; receivedCount: number; chunkCount: number }
    try {
      recorded = this.store.repository.recordMobileAssetChunk({
        deviceId, mobileCaptureId, attachmentId, chunkIndex, byteSize: plaintext.length, sha256, nonce,
        authTag: tag, stagedLocator
      })
      if (recorded.duplicate) await unlink(this.resolveStagingLocator(stagedLocator)).catch(() => undefined)
    } catch (error) {
      await unlink(this.resolveStagingLocator(stagedLocator)).catch(() => undefined)
      if (error instanceof Error && error.message.includes('内容不一致')) throw new RequestError(409, 'chunk_conflict', error.message)
      if (error instanceof Error && error.message.includes('nonce已经被其他分块使用')) throw new RequestError(409, 'nonce_reused', error.message)
      throw error
    }
    json(response, 200, this.uploadResponse(secret, {
      protocolVersion: 2, mobileCaptureId, attachmentId, chunkIndex, duplicate: recorded.duplicate,
      receivedCount: recorded.receivedCount, chunkCount: recorded.chunkCount
    }))
  }

  private async handleUploadCommit(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const control = this.decryptUploadControl(await readJson(request), 'commit')
    const session = this.store.repository.getMobileAssetUpload(control.deviceId, control.mobileCaptureId)
    if (!session) throw new RequestError(404, 'upload_not_found', '附件上传会话不存在或已经过期')
    if (session.state === 'committed' && session.committedCaptureId) {
      const started = this.store.repository.beginMobileAssetUpload({
        deviceId: control.deviceId, mobileCaptureId: control.mobileCaptureId, protocolVersion: 2,
        content: session.originalContent, hint: session.captureKindHint, title: session.mobileTitle,
        sourceApp: session.mobileSourceApp, sourceTitle: session.mobileSourceTitle,
        sourceUrl: session.mobileSourceUrl, notes: session.mobileNotes,
        recordingMarkersMs: session.mobileRecordingMarkersMs,
        recordingInterruptionReason: session.mobileRecordingInterruptionReason,
        captureCreatedAt: session.captureCreatedAt,
        expiresAt: session.expiresAt, attachments: session.attachments.map(({ attachmentId, attachmentKind, position, name, mimeType, sourceModifiedAt, byteSize, sha256, chunkCount }) => ({ attachmentId, attachmentKind, position, name, mimeType, sourceModifiedAt, byteSize, sha256, chunkCount }))
      })
      if (!('desktopCaptureId' in started)) throw new Error('已提交附件回执读取失败')
      await this.removeSessionStaging(session.id).catch(() => undefined)
      json(response, 200, this.uploadResponse(control.secret, { ...started, protocolVersion: 2, attachmentCount: session.attachments.length, attachmentsCommitted: true }))
      return
    }
    const incomplete = session.attachments.filter((attachment) => attachment.receivedCount !== attachment.chunkCount)
    if (incomplete.length) {
      json(response, 409, this.uploadResponse(control.secret, { error: 'chunks_missing', message: '附件仍有分块没有上传完成', ...this.uploadStatusBody(session) }))
      return
    }
    const retained: Array<{ attachmentId: string; attachmentKind: MobileUploadAttachmentDeclaration['attachmentKind']; retained: RetainedManagedFile }> = []
    let receipt: MobileCaptureReceipt
    try {
      for (const attachment of session.attachments) {
        const assembledLocator = await this.assembleAttachment(session, attachment.attachmentId)
        const profile = detectManagedFileProfile(attachment.name)
        const file = await retainManagedFileFromPath(dirname(this.store.databasePath), {
          sourcePath: this.resolveStagingLocator(assembledLocator), sourceName: attachment.name,
          managedDirectory: join('managed-files', 'mobile-android'), sourceOrigin: 'mobile_android',
          sourceModifiedAt: attachment.sourceModifiedAt,
          maximumBytes: Number.MAX_SAFE_INTEGER, profile
        })
        if (file.file.sha256 !== attachment.sha256 || file.file.sizeBytes !== attachment.byteSize) {
          await discardManagedLocators(dirname(this.store.databasePath), [file.file.managedLocator ?? file.file.relativePath])
          throw new RequestError(400, 'attachment_integrity_failed', `附件“${attachment.name}”整体校验失败`)
        }
        retained.push({ attachmentId: attachment.attachmentId, attachmentKind: attachment.attachmentKind, retained: file })
      }
      receipt = this.store.repository.commitMobileAssetUpload({
        deviceId: control.deviceId,
        mobileCaptureId: control.mobileCaptureId,
        files: retained.map((item) => ({ attachmentId: item.attachmentId, attachmentKind: item.attachmentKind, file: item.retained.file }))
      })
    } catch (error) {
      await discardManagedLocators(dirname(this.store.databasePath), retained.map((item) => item.retained.file.managedLocator ?? item.retained.file.relativePath))
      throw error
    }
    // The database transaction above is the commit point. No later cleanup,
    // renderer refresh, or disconnected HTTP client may delete files that are
    // already referenced by the committed Capture.
    if (receipt.duplicate) {
      await discardManagedLocators(
        dirname(this.store.databasePath),
        retained.map((item) => item.retained.file.managedLocator ?? item.retained.file.relativePath)
      ).catch(() => undefined)
    }
    await this.removeSessionStaging(session.id).catch(() => undefined)
    try { this.onChanged() } catch { /* committed data remains authoritative */ }
    json(response, 200, this.uploadResponse(control.secret, {
      ...receipt, protocolVersion: 2, attachmentCount: session.attachments.length, attachmentsCommitted: true
    }))
  }

  private resolveStagingLocator(locator: string): string {
    if (!locator || isAbsolute(locator)) throw new Error('附件暂存位置无效')
    const normalized = normalize(locator)
    const parts = normalized.split(sep)
    if (parts[0] !== MOBILE_UPLOAD_STAGING_ROOT || parts.some((part) => !part || part === '.' || part === '..')) throw new Error('附件暂存位置无效')
    const root = resolve(dirname(this.store.databasePath), MOBILE_UPLOAD_STAGING_ROOT)
    const absolute = resolve(dirname(this.store.databasePath), normalized)
    const escaped = relative(root, absolute)
    if (!escaped || escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) throw new Error('附件暂存位置无效')
    return absolute
  }

  private async writeStagedBytes(locator: string, bytes: Buffer): Promise<void> {
    const destination = this.resolveStagingLocator(locator)
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 }); await chmod(dirname(destination), 0o700)
    const temporary = `${destination}.partial-${randomUUID()}`
    const output = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await output.writeFile(bytes); await output.sync() } finally { await output.close() }
    try { await rename(temporary, destination) } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
  }

  private async assembleAttachment(session: MobileUploadSessionState, attachmentId: string): Promise<string> {
    const attachment = session.attachments.find((item) => item.attachmentId === attachmentId)
    if (!attachment) throw new Error('附件声明不存在')
    const chunks = [...attachment.receivedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
    if (chunks.length !== attachment.chunkCount || chunks.some((chunk, index) => chunk.chunkIndex !== index)) throw new RequestError(409, 'chunks_missing', `附件“${attachment.name}”仍有分块缺失`)
    this.store.repository.markMobileAssetAttachmentAssembling(session.id, attachmentId)
    const locator = join(MOBILE_UPLOAD_STAGING_ROOT, session.id, attachment.id, 'assembled.file')
    const destination = this.resolveStagingLocator(locator)
    await unlink(destination).catch(() => undefined)
    const output = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    const hash = createHash('sha256')
    let size = 0
    try {
      for (const chunk of chunks) {
        const bytes = await readFile(this.resolveStagingLocator(chunk.stagedLocator))
        if (bytes.length !== chunk.byteSize || createHash('sha256').update(bytes).digest('hex') !== chunk.sha256) throw new RequestError(400, 'staged_chunk_corrupted', `附件“${attachment.name}”的暂存分块损坏`)
        await output.write(bytes); hash.update(bytes); size += bytes.length
      }
      await output.sync()
    } catch (error) {
      await output.close(); await unlink(destination).catch(() => undefined); throw error
    }
    await output.close()
    if (size !== attachment.byteSize || hash.digest('hex') !== attachment.sha256) {
      await unlink(destination).catch(() => undefined)
      throw new RequestError(400, 'attachment_integrity_failed', `附件“${attachment.name}”整体校验失败`)
    }
    this.store.repository.markMobileAssetAttachmentAssembled(session.id, attachmentId, locator)
    return locator
  }

  private async removeSessionStaging(sessionId: string): Promise<void> {
    const root = this.resolveStagingLocator(join(MOBILE_UPLOAD_STAGING_ROOT, sessionId, '_root'))
    await rm(dirname(root), { recursive: true, force: true })
  }

  private async cleanupSessionStagingOrphans(sessionId: string): Promise<void> {
    const sessionRoot = dirname(this.resolveStagingLocator(join(MOBILE_UPLOAD_STAGING_ROOT, sessionId, '_root')))
    const retained = new Set(this.store.repository.listMobileAssetUploadStagingLocators(sessionId)
      .map((locator) => this.resolveStagingLocator(locator)))
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(path)
          await rmdir(path).catch(() => undefined)
        } else if (!retained.has(path)) {
          // Includes interrupted .partial files and candidate chunks written
          // immediately before a process stop but not yet registered in SQLite.
          await unlink(path).catch(() => undefined)
        }
      }
    }
    await visit(sessionRoot)
  }

  private async cleanupExpiredUploads(): Promise<void> {
    const locators = this.store.repository.removeExpiredMobileAssetUploads(new Date().toISOString())
    for (const locator of locators) await unlink(this.resolveStagingLocator(locator)).catch(() => undefined)
    const stagingRoot = resolve(dirname(this.store.databasePath), MOBILE_UPLOAD_STAGING_ROOT)
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 }); await chmod(stagingRoot, 0o700)
    // Scan only directories that actually occupy disk. Historical committed
    // sessions can remain for idempotency without making startup cost grow.
    for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const state = this.store.repository.getMobileAssetUploadSessionState(entry.name)
      if (state === null || state === 'committed') {
        await this.removeSessionStaging(entry.name).catch(() => undefined)
      } else {
        await this.cleanupSessionStagingOrphans(entry.name)
      }
    }
  }

  private requirePendingPairing(sessionId: string): PairingSession {
    this.cleanupPairings()
    const session = this.pairings.get(sessionId)
    if (!session || session.state !== 'pending') throw new Error('待批准设备不存在或已处理')
    if (session.expiresAt <= Date.now()) { session.state = 'expired'; throw new Error('数字核对已超时，请让Android重新连接') }
    return session
  }

  private cleanupPairings(): void {
    const cutoff = Date.now() - PAIRING_TTL_MS
    for (const [sessionId, session] of this.pairings) {
      if (session.state === 'pending' && session.expiresAt <= Date.now()) session.state = 'expired'
      if (session.requestedAt < cutoff && session.state !== 'pending') this.pairings.delete(sessionId)
    }
  }

  private isRateLimited(remote: string): boolean {
    const cutoff = Date.now() - PAIRING_TTL_MS
    const attempts = (this.failedPairing.get(remote)?.timestamps ?? []).filter((timestamp) => timestamp >= cutoff)
    if (attempts.length) this.failedPairing.set(remote, { timestamps: attempts }); else this.failedPairing.delete(remote)
    return attempts.length >= MAX_PAIRING_FAILURES
  }

  private recordPairingFailure(remote: string): void {
    const attempts = this.failedPairing.get(remote)?.timestamps ?? []
    this.failedPairing.set(remote, { timestamps: [...attempts, Date.now()] })
  }
}
