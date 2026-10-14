import { createCipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, timingSafeEqual, type KeyObject } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import {
  deriveShortAuthenticationString,
  isPrivateLanAddress,
  MOBILE_ATTACHMENT_CHUNK_BYTES,
  mobileCaptureAad,
  mobileUploadChunkAad,
  mobileUploadControlAad,
  MobileSyncService,
  pairingClientHelloJson,
  pairingTranscriptJson,
  type MobileSyncAdvertiser,
  type PairingClientHello,
  type SecretProtector
} from '../../src/main/mobile-sync-service'

const directories: string[] = []
const services: MobileSyncService[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')
const x25519Prefix = Buffer.from('302a300506032b656e032100', 'hex')

const protector: SecretProtector = {
  isAvailable: () => true,
  encrypt: (secret) => `protected:${secret}`,
  decrypt: (encrypted) => encrypted.replace(/^protected:/, '')
}

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-mobile-sync-'))
  directories.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

async function startService(
  store: WorkspaceStore,
  customProtector = protector,
  advertiser?: MobileSyncAdvertiser,
  onChanged: () => void = () => {},
  androidUpdate?: { apkPath: string; versionCode: number; versionName: string }
): Promise<MobileSyncService> {
  const service = new MobileSyncService(store, customProtector, onChanged, {
    advertiser,
    androidUpdate
  })
  services.push(service)
  await service.setEnabled(true)
  return service
}

function rawPublicKey(publicKey: KeyObject): Buffer {
  return Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32)
}

function importPublicKey(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([x25519Prefix, raw]), format: 'der', type: 'spki' })
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

interface PairingResult {
  sessionId: string
  deviceId: string
  sessionKey: Buffer
  deviceSecret: Buffer
  sas: string
  statusProof: string
  responseBody: Record<string, unknown>
}

async function beginV2Pairing(input: {
  baseUrl: string
  serviceId: string
  deviceName?: string
  upgradeDeviceId?: string | null
  upgradeSecret?: Buffer
}): Promise<PairingResult> {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const clientPublicKey = rawPublicKey(publicKey).toString('base64')
  const clientChallengeBytes = randomBytes(32)
  const clientChallenge = clientChallengeBytes.toString('base64')
  const hello: PairingClientHello = {
    protocolVersion: 2,
    deviceName: input.deviceName ?? 'Pixel测试机',
    clientPublicKey,
    clientChallenge,
    capabilities: ['capture_text'],
    upgradeDeviceId: input.upgradeDeviceId ?? null
  }
  const requestBody: Record<string, unknown> = { ...hello }
  if (input.upgradeSecret) requestBody.upgradeProof = hmac(input.upgradeSecret, `upgrade-start\n${pairingClientHelloJson(hello)}`).toString('base64')
  const response = await fetch(`${input.baseUrl}/v2/pair/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody)
  })
  expect(response.status).toBe(200)
  const body = await response.json() as Record<string, unknown>
  expect(body).not.toHaveProperty('secret')
  const sessionId = body.sessionId as string
  const deviceId = body.deviceId as string
  const serverPublicKey = body.serverPublicKey as string
  const serverChallenge = body.serverChallenge as string
  const transcript = pairingTranscriptJson({
    ...hello, sessionId, deviceId, serviceId: input.serviceId, serverPublicKey, serverChallenge
  })
  const sharedSecret = diffieHellman({ privateKey, publicKey: importPublicKey(Buffer.from(serverPublicKey, 'base64')) })
  const salt = createHash('sha256').update(Buffer.concat([clientChallengeBytes, Buffer.from(serverChallenge, 'base64')])).digest()
  const derived = Buffer.from(hkdfSync('sha256', sharedSecret, salt, Buffer.from(`ly-creator-mobile-pairing-v2\n${transcript}`, 'utf8'), 64))
  const sessionKey = derived.subarray(0, 32)
  const deviceSecret = derived.subarray(32)
  expect(timingSafeEqual(Buffer.from(body.serverProof as string, 'base64'), hmac(sessionKey, `server-proof\n${transcript}`))).toBe(true)
  return {
    sessionId, deviceId, sessionKey, deviceSecret,
    sas: deriveShortAuthenticationString(sessionKey, transcript),
    statusProof: hmac(sessionKey, `status\n${sessionId}`).toString('base64'),
    responseBody: body
  }
}

async function pairingStatus(baseUrl: string, pairing: PairingResult): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/v2/pair/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: pairing.sessionId, proof: pairing.statusProof })
  })
  expect(response.status).toBe(200)
  const body = await response.json() as Record<string, unknown>
  expect(body).not.toHaveProperty('secret')
  return body
}

function encryptCapture(input: {
  secret: Buffer
  deviceId: string
  mobileCaptureId: string
  createdAt: string
  content: string
  hint: string
  protocolVersion: 1 | 2
  metadata?: Record<string, unknown>
}): Record<string, unknown> {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', input.secret, nonce)
  cipher.setAAD(Buffer.from(mobileCaptureAad(input), 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ content: input.content, hint: input.hint, ...input.metadata }), 'utf8'), cipher.final()])
  return {
    protocolVersion: input.protocolVersion,
    deviceId: input.deviceId,
    mobileCaptureId: input.mobileCaptureId,
    createdAt: input.createdAt,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  }
}

function encryptUploadControl(input: {
  secret: Buffer
  deviceId: string
  mobileCaptureId: string
  messageType: 'start' | 'status' | 'commit' | 'notes' | 'update'
  payload: Record<string, unknown>
}): Record<string, unknown> {
  const createdAt = new Date().toISOString()
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', input.secret, nonce)
  cipher.setAAD(Buffer.from(mobileUploadControlAad({ deviceId: input.deviceId, mobileCaptureId: input.mobileCaptureId, messageType: input.messageType, createdAt }), 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(input.payload), 'utf8'), cipher.final()])
  return {
    protocolVersion: 2, deviceId: input.deviceId, mobileCaptureId: input.mobileCaptureId, createdAt,
    nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64')
  }
}

function encryptUploadChunk(input: { secret: Buffer; deviceId: string; mobileCaptureId: string; attachmentId: string; chunkIndex: number; bytes: Buffer; nonce?: Buffer }): Record<string, unknown> {
  const nonce = input.nonce ?? randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', input.secret, nonce)
  cipher.setAAD(Buffer.from(mobileUploadChunkAad(input), 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final()])
  return {
    protocolVersion: 2, deviceId: input.deviceId, mobileCaptureId: input.mobileCaptureId,
    attachmentId: input.attachmentId, chunkIndex: input.chunkIndex, nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64')
  }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Android LAN capture sync v2', () => {
  it('only advertises private LAN address ranges accepted by Android', () => {
    expect(['10.0.2.2', '172.20.0.3', '192.168.50.2'].every(isPrivateLanAddress)).toBe(true)
    expect(['198.18.0.1', '8.8.8.8', '169.254.1.2'].some(isPrivateLanAddress)).toBe(false)
  })

  it('advertises Bonjour protocol metadata and stops the advertiser with the server', async () => {
    const calls: Array<{ name: string; port: number; txt: string[] }> = []
    let advertising = false
    const advertiser: MobileSyncAdvertiser = {
      get advertising() { return advertising },
      async start(input) { calls.push(input); advertising = true },
      async stop() { advertising = false }
    }
    const { store } = await createStore()
    const service = await startService(store, protector, advertiser)
    const status = service.getStatus()
    expect(status).toMatchObject({ running: true, advertised: true, protocolVersion: 2 })
    expect(calls).toEqual([{ name: status.serviceName, port: status.port, txt: ['pv=2', `sid=${status.serviceId}`] }])
    await service.stop()
    expect(advertising).toBe(false)
    store.close()
  })

  it('derives the secret on both ends, confirms the same six digits and imports stable ids idempotently', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    expect(service.getStatus().pendingPairings).toMatchObject([{
      sessionId: pairing.sessionId, deviceName: 'Pixel测试机', shortAuthenticationString: pairing.sas, upgradeDeviceId: null
    }])
    expect(await pairingStatus(baseUrl, pairing)).toMatchObject({ state: 'pending' })
    service.approvePairing(pairing.sessionId)
    expect(await pairingStatus(baseUrl, pairing)).toMatchObject({ state: 'approved', deviceId: pairing.deviceId })
    expect(store.repository.listMobileSyncDevices()).toMatchObject([{
      id: pairing.deviceId, protocolVersion: 2, trustState: 'trusted_v2', revokedAt: null
    }])

    const encrypted = encryptCapture({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId: 'mobile-note-1', protocolVersion: 2,
      createdAt: '2026-07-21T12:30:00.000Z', content: '这是从Android离线队列同步来的真实体验', hint: 'inspiration',
      metadata: {
        title: '本地标题', sourceApp: 'com.example.browser', sourceTitle: '分享页标题',
        sourceUrl: 'https://example.com/story', notes: '尤其注意开头',
        recordingMarkersMs: [1_000, 2_500], recordingInterruptionReason: '来电中断'
      }
    })
    const first = await (await fetch(`${baseUrl}/v2/captures`, { method: 'POST', body: JSON.stringify(encrypted) })).json() as {
      protocolVersion: number
      mobileCaptureId: string
      desktopCaptureId: string
      duplicate: boolean
      attachmentCount: number
      attachmentsCommitted: boolean
      proof: string
    }
    expect(first.duplicate).toBe(false)
    const { proof, ...signedReceipt } = first
    expect(Buffer.from(proof, 'base64')).toEqual(hmac(pairing.deviceSecret, `upload-response\n${JSON.stringify(signedReceipt)}`))
    const second = await (await fetch(`${baseUrl}/v2/captures`, { method: 'POST', body: JSON.stringify(encrypted) })).json() as typeof first
    expect(second).toMatchObject({ duplicate: true, desktopCaptureId: first.desktopCaptureId })
    expect(store.repository.getSnapshot().captures.filter((capture) => capture.sourceType === 'mobile_android')).toEqual([
      expect.objectContaining({
        id: first.desktopCaptureId,
        originalContent: '这是从Android离线队列同步来的真实体验',
        mobileTitle: '本地标题',
        mobileSourceApp: 'com.example.browser',
        mobileSourceTitle: '分享页标题',
        mobileSourceUrl: 'https://example.com/story',
        mobileNotes: '尤其注意开头',
        mobileRecordingMarkersMs: [1_000, 2_500],
        mobileRecordingInterruptionReason: '来电中断'
      })
    ])
    store.close()
  })

  it('accepts an old queued record with an overlong local title and stores a safe title', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const title = '截图文件名很长'.repeat(20)
    const encrypted = encryptCapture({
      secret: pairing.deviceSecret,
      deviceId: pairing.deviceId,
      mobileCaptureId: 'mobile-long-local-title',
      protocolVersion: 2,
      createdAt: '2026-07-26T10:45:00.000Z',
      content: '手机旧队列中的图片记录',
      hint: 'auto',
      metadata: { title }
    })

    const response = await fetch(`${baseUrl}/v2/captures`, {
      method: 'POST',
      body: JSON.stringify(encrypted)
    })
    expect(response.status).toBe(200)
    const receipt = await response.json() as { desktopCaptureId: string }
    const saved = store.repository.getSnapshot().captures.find((capture) => capture.id === receipt.desktopCaptureId)!
    expect([...saved.mobileTitle!]).toHaveLength(60)
    expect(title.startsWith(saved.mobileTitle!)).toBe(true)
    store.close()
  })

  it('appends full-note revisions idempotently without creating another capture', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const mobileCaptureId = 'note-revisions'
    const encrypted = encryptCapture({
      secret: pairing.deviceSecret,
      deviceId: pairing.deviceId,
      mobileCaptureId,
      protocolVersion: 2,
      createdAt: '2026-07-25T12:30:00.000Z',
      content: '原始记录',
      hint: 'auto',
      metadata: { notes: '初始备注' }
    })
    const created = await fetch(`${baseUrl}/v2/captures`, {
      method: 'POST',
      body: JSON.stringify(encrypted)
    })
    expect(created.status).toBe(200)
    const createdReceipt = await created.json() as { desktopCaptureId: string }

    const noteRequest = (revision: number, notes: string) => encryptUploadControl({
      secret: pairing.deviceSecret,
      deviceId: pairing.deviceId,
      mobileCaptureId,
      messageType: 'notes',
      payload: { revision, notes }
    })
    const first = await fetch(`${baseUrl}/v2/captures/notes`, {
      method: 'POST',
      body: JSON.stringify(noteRequest(1, '初始备注\n第一次补充'))
    })
    expect(first.status).toBe(200)
    const firstReceipt = await first.json() as Record<string, unknown>
    expect(firstReceipt).toMatchObject({
      mobileCaptureId,
      desktopCaptureId: createdReceipt.desktopCaptureId,
      notesRevision: 1,
      duplicate: false
    })
    const proof = firstReceipt.proof
    const unsigned = { ...firstReceipt }
    delete unsigned.proof
    expect(Buffer.from(proof as string, 'base64')).toEqual(
      hmac(pairing.deviceSecret, `upload-response\n${JSON.stringify(unsigned)}`)
    )

    const duplicate = await fetch(`${baseUrl}/v2/captures/notes`, {
      method: 'POST',
      body: JSON.stringify(noteRequest(1, '初始备注\n第一次补充'))
    })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toMatchObject({ notesRevision: 1, duplicate: true })
    expect((await fetch(`${baseUrl}/v2/captures/notes`, {
      method: 'POST',
      body: JSON.stringify(noteRequest(1, '同版本冲突内容'))
    })).status).toBe(400)
    const skipped = await fetch(`${baseUrl}/v2/captures/notes`, {
      method: 'POST',
      body: JSON.stringify(noteRequest(3, '跳过一个版本'))
    })
    expect(skipped.status).toBe(200)
    expect(await skipped.json()).toMatchObject({ notesRevision: 3, duplicate: false })

    expect(store.repository.getSnapshot().captures.filter(
      (capture) => capture.id === createdReceipt.desktopCaptureId
    )).toEqual([
      expect.objectContaining({
        originalContent: '原始记录',
        mobileNotes: '跳过一个版本'
      })
    ])
    expect(store.repository.native.prepare(
      `SELECT last_note_revision AS revision,last_note_sha256 AS sha256
       FROM mobile_capture_receipts WHERE device_id=? AND mobile_capture_id=?`
    ).get(pairing.deviceId, mobileCaptureId)).toMatchObject({
      revision: 3,
      sha256: createHash('sha256').update('跳过一个版本').digest('hex')
    })
    store.close()
  })

  it('serves a signed private APK through a one-use authenticated ticket', async () => {
    const { store, directory } = await createStore()
    const apkBytes = Buffer.from('private-test-apk-content')
    const apkPath = join(directory, 'ly-creator-capture.apk')
    await writeFile(apkPath, apkBytes)
    const service = await startService(
      store,
      protector,
      undefined,
      () => {},
      { apkPath, versionCode: 7, versionName: '1.2.0' }
    )
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const check = async (currentVersionCode: number) => {
      const response = await fetch(`${baseUrl}/v2/app/update/check`, {
        method: 'POST',
        body: JSON.stringify(encryptUploadControl({
          secret: pairing.deviceSecret,
          deviceId: pairing.deviceId,
          mobileCaptureId: 'app-update',
          messageType: 'update',
          payload: { currentVersionCode }
        }))
      })
      expect(response.status).toBe(200)
      return response.json() as Promise<Record<string, unknown>>
    }
    const available = await check(1)
    expect(available).toMatchObject({
      mobileCaptureId: 'app-update',
      available: true,
      versionCode: 7,
      versionName: '1.2.0',
      sizeBytes: apkBytes.length,
      sha256: createHash('sha256').update(apkBytes).digest('hex')
    })
    const ticket = available.ticket as string
    const downloaded = await fetch(
      `${baseUrl}/v2/app/update/download?ticket=${encodeURIComponent(ticket)}`
    )
    expect(downloaded.status).toBe(200)
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(apkBytes)
    expect((await fetch(
      `${baseUrl}/v2/app/update/download?ticket=${encodeURIComponent(ticket)}`
    )).status).toBe(401)

    expect(await check(7)).toMatchObject({
      available: false,
      versionCode: 7,
      ticket: null
    })
    store.close()
  })

  it('resumes encrypted attachment chunks and exposes the Capture only after atomic commit', async () => {
    const { store, directory } = await createStore()
    let failOnChanged = false
    const service = await startService(
      store,
      protector,
      undefined,
      () => {
        if (failOnChanged) throw new Error('模拟提交后的界面刷新失败')
      }
    )
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const mobileCaptureId = 'attachment-note-1'
    const attachmentId = 'attachment-photo-1'
    const bytes = Buffer.alloc(MOBILE_ATTACHMENT_CHUNK_BYTES + 137, 0x5a)
    const attachmentSha256 = createHash('sha256').update(bytes).digest('hex')
    const declaration = {
      attachmentId, attachmentKind: 'image', name: 'shared-photo.jpg', mimeType: 'image/jpeg',
      sourceModifiedAt: '2026-07-21T08:30:00.000Z',
      byteSize: bytes.length, sha256: attachmentSha256, chunkCount: 2
    }
    const startBody = encryptUploadControl({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, messageType: 'start',
      payload: { content: '手机分享的图片', hint: 'inspiration', captureCreatedAt: '2026-07-22T09:00:00.000Z', attachments: [declaration] }
    })
    const start = await fetch(`${baseUrl}/v2/uploads/start`, { method: 'POST', body: JSON.stringify(startBody) })
    expect(start.status).toBe(200)
    expect(await start.json()).toMatchObject({ state: 'receiving', attachments: [{ attachmentId, missingChunks: [0, 1] }] })
    expect(store.repository.getSnapshot().captures.some((capture) => capture.originalContent === '手机分享的图片')).toBe(false)

    const firstChunk = encryptUploadChunk({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, attachmentId, chunkIndex: 0,
      bytes: bytes.subarray(0, MOBILE_ATTACHMENT_CHUNK_BYTES)
    })
    const uploaded = await fetch(`${baseUrl}/v2/uploads/chunk`, { method: 'POST', body: JSON.stringify(firstChunk) })
    expect(uploaded.status).toBe(200)
    expect(await uploaded.json()).toMatchObject({ attachmentId, chunkIndex: 0, duplicate: false, receivedCount: 1 })
    const duplicate = await fetch(`${baseUrl}/v2/uploads/chunk`, { method: 'POST', body: JSON.stringify(firstChunk) })
    expect(await duplicate.json()).toMatchObject({ duplicate: true, receivedCount: 1 })
    const conflicting = encryptUploadChunk({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, attachmentId, chunkIndex: 0,
      bytes: Buffer.alloc(MOBILE_ATTACHMENT_CHUNK_BYTES, 0x33)
    })
    expect((await fetch(`${baseUrl}/v2/uploads/chunk`, { method: 'POST', body: JSON.stringify(conflicting) })).status).toBe(409)

    const resume = await fetch(`${baseUrl}/v2/uploads/status`, {
      method: 'POST', body: JSON.stringify(encryptUploadControl({ secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, messageType: 'status', payload: {} }))
    })
    expect(await resume.json()).toMatchObject({ attachments: [{ attachmentId, missingChunks: [1] }] })
    const incompleteCommit = await fetch(`${baseUrl}/v2/uploads/commit`, {
      method: 'POST', body: JSON.stringify(encryptUploadControl({ secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, messageType: 'commit', payload: {} }))
    })
    expect(incompleteCommit.status).toBe(409)
    expect(store.repository.getSnapshot().captures.some((capture) => capture.originalContent === '手机分享的图片')).toBe(false)

    const finalChunk = encryptUploadChunk({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, attachmentId, chunkIndex: 1,
      bytes: bytes.subarray(MOBILE_ATTACHMENT_CHUNK_BYTES)
    })
    expect((await fetch(`${baseUrl}/v2/uploads/chunk`, { method: 'POST', body: JSON.stringify(finalChunk) })).status).toBe(200)
    failOnChanged = true
    const committed = await fetch(`${baseUrl}/v2/uploads/commit`, {
      method: 'POST', body: JSON.stringify(encryptUploadControl({ secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, messageType: 'commit', payload: {} }))
    })
    expect(committed.status).toBe(200)
    const receipt = await committed.json() as { desktopCaptureId: string; attachmentsCommitted: boolean; attachmentCount: number }
    expect(receipt).toMatchObject({ attachmentsCommitted: true, attachmentCount: 1 })
    expect(store.repository.getSnapshot().captures).toContainEqual(expect.objectContaining({
      id: receipt.desktopCaptureId,
      originalContent: '手机分享的图片',
      attachments: [expect.objectContaining({
        fileName: 'shared-photo.jpg', attachmentKind: 'image',
        sizeBytes: bytes.length, sourceModifiedAt: '2026-07-21T08:30:00.000Z'
      })]
    }))
    const links = store.repository.listCaptureAssetLinks(receipt.desktopCaptureId)
    expect(links).toHaveLength(1)
    const file = store.repository.native.prepare(`SELECT original_name AS name,sha256,size_bytes AS sizeBytes,source_origin AS sourceOrigin,source_modified_at AS sourceModifiedAt FROM file_references WHERE id=?`).get(links[0]?.fileReferenceId) as Record<string, unknown>
    expect(file).toEqual({
      name: 'shared-photo.jpg', sha256: attachmentSha256, sizeBytes: bytes.length,
      sourceOrigin: 'mobile_android', sourceModifiedAt: '2026-07-21T08:30:00.000Z'
    })
    const locator = (store.repository.native.prepare(`SELECT managed_locator AS locator FROM file_references WHERE id=?`).get(links[0]?.fileReferenceId) as { locator: string }).locator
    expect(await readFile(join(directory, locator))).toEqual(bytes)

    const committedSessionId = (
      store.repository.native.prepare(
        `SELECT id FROM asset_upload_sessions WHERE state='committed' LIMIT 1`
      ).get() as { id: string }
    ).id
    const orphanDirectory = join(directory, 'mobile-upload-staging', committedSessionId!)
    await mkdir(orphanDirectory, { recursive: true })
    const repeatedStartOrphanPath = join(orphanDirectory, 'left-before-repeated-start.bin')
    await writeFile(repeatedStartOrphanPath, 'orphan')

    const repeated = await fetch(`${baseUrl}/v2/uploads/start`, { method: 'POST', body: JSON.stringify(encryptUploadControl({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId, messageType: 'start',
      payload: { content: '手机分享的图片', hint: 'inspiration', captureCreatedAt: '2026-07-22T09:00:00.000Z', attachments: [declaration] }
    })) })
    expect(await repeated.json()).toMatchObject({ duplicate: true, desktopCaptureId: receipt.desktopCaptureId, attachmentsCommitted: true })
    expect(store.repository.getSnapshot().captures.filter((capture) => capture.id === receipt.desktopCaptureId)).toHaveLength(1)
    await expect(readFile(repeatedStartOrphanPath)).rejects.toThrow()

    const restartOrphanPath = join(orphanDirectory, 'left-after-process-stop.bin')
    await mkdir(orphanDirectory, { recursive: true })
    await writeFile(restartOrphanPath, 'orphan')
    await service.stop()
    const restarted = await startService(store)
    await expect(readFile(restartOrphanPath)).rejects.toThrow()
    await restarted.stop()
    store.close()
  })

  it('removes unregistered candidate chunks from an interrupted receiving session', async () => {
    const { store, directory } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const mobileCaptureId = 'interrupted-candidate-cleanup'
    const attachmentId = 'candidate-file'
    const bytes = Buffer.from('candidate')
    const declaration = {
      attachmentId,
      attachmentKind: 'file',
      name: 'candidate.bin',
      mimeType: 'application/octet-stream',
      byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      chunkCount: 1
    }
    const started = await fetch(`${baseUrl}/v2/uploads/start`, {
      method: 'POST',
      body: JSON.stringify(encryptUploadControl({
        secret: pairing.deviceSecret,
        deviceId: pairing.deviceId,
        mobileCaptureId,
        messageType: 'start',
        payload: {
          content: '',
          hint: 'auto',
          captureCreatedAt: '2026-07-22T09:00:00.000Z',
          attachments: [declaration]
        }
      }))
    })
    expect(started.status).toBe(200)
    const uploaded = await fetch(`${baseUrl}/v2/uploads/chunk`, {
      method: 'POST',
      body: JSON.stringify(encryptUploadChunk({
        secret: pairing.deviceSecret,
        deviceId: pairing.deviceId,
        mobileCaptureId,
        attachmentId,
        chunkIndex: 0,
        bytes
      }))
    })
    expect(uploaded.status).toBe(200)
    const session = store.repository.getMobileAssetUpload(pairing.deviceId, mobileCaptureId)
    expect(session?.state).toBe('receiving')
    expect(session?.attachments[0]?.receivedCount).toBe(1)
    const registeredChunk = join(directory, session!.attachments[0]!.receivedChunks[0]!.stagedLocator)
    const attachmentDirectory = join(directory, 'mobile-upload-staging', session!.id, session!.attachments[0]!.id)
    const unregisteredChunk = join(attachmentDirectory, '0-unregistered.chunk')
    const interruptedPartial = join(attachmentDirectory, '0-unregistered.chunk.partial-dead-process')
    await mkdir(attachmentDirectory, { recursive: true })
    await writeFile(unregisteredChunk, bytes)
    await writeFile(interruptedPartial, bytes)

    await service.stop()
    const restarted = await startService(store)
    await expect(readFile(unregisteredChunk)).rejects.toThrow()
    await expect(readFile(interruptedPartial)).rejects.toThrow()
    expect(await readFile(registeredChunk)).toEqual(bytes)
    expect(store.repository.getMobileAssetUpload(pairing.deviceId, mobileCaptureId)).toMatchObject({
      state: 'receiving',
      attachments: [expect.objectContaining({ receivedCount: 1 })]
    })
    await restarted.stop()
    store.close()
  })

  it('keeps declared attachment order across out-of-order chunks and replayed starts', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const mobileCaptureId = 'ordered-recording-segments'
    const sources = [
      { attachmentId: 'segment-first', attachmentKind: 'audio', name: '灵感录音-001.aac', mimeType: 'audio/aac', bytes: Buffer.from('first') },
      { attachmentId: 'segment-second', attachmentKind: 'audio', name: '灵感录音-002.aac', mimeType: 'audio/aac', bytes: Buffer.from('second') },
      { attachmentId: 'segment-third', attachmentKind: 'audio', name: '灵感录音-003.aac', mimeType: 'audio/aac', bytes: Buffer.from('third') }
    ]
    const declarations = sources.map(({ bytes, ...source }) => ({
      ...source,
      byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      chunkCount: 1
    }))
    const payload = {
      content: '',
      hint: 'inspiration',
      captureCreatedAt: '2026-07-25T06:00:00.000Z',
      recordingMarkersMs: [1_000, 3_000],
      attachments: declarations
    }
    const startRequest = () => encryptUploadControl({
      secret: pairing.deviceSecret,
      deviceId: pairing.deviceId,
      mobileCaptureId,
      messageType: 'start',
      payload
    })
    expect((await fetch(`${baseUrl}/v2/uploads/start`, {
      method: 'POST', body: JSON.stringify(startRequest())
    })).status).toBe(200)

    for (const index of [2, 0]) {
      const source = sources[index]!
      const response = await fetch(`${baseUrl}/v2/uploads/chunk`, {
        method: 'POST',
        body: JSON.stringify(encryptUploadChunk({
          secret: pairing.deviceSecret,
          deviceId: pairing.deviceId,
          mobileCaptureId,
          attachmentId: source.attachmentId,
          chunkIndex: 0,
          bytes: source.bytes
        }))
      })
      expect(response.status).toBe(200)
    }
    const replayed = await fetch(`${baseUrl}/v2/uploads/start`, {
      method: 'POST', body: JSON.stringify(startRequest())
    })
    expect(replayed.status).toBe(200)
    expect(await replayed.json()).toMatchObject({
      state: 'receiving',
      attachments: [
        { attachmentId: 'segment-first', missingChunks: [] },
        { attachmentId: 'segment-second', missingChunks: [0] },
        { attachmentId: 'segment-third', missingChunks: [] }
      ]
    })
    const second = sources[1]!
    expect((await fetch(`${baseUrl}/v2/uploads/chunk`, {
      method: 'POST',
      body: JSON.stringify(encryptUploadChunk({
        secret: pairing.deviceSecret,
        deviceId: pairing.deviceId,
        mobileCaptureId,
        attachmentId: second.attachmentId,
        chunkIndex: 0,
        bytes: second.bytes
      }))
    })).status).toBe(200)
    const committed = await fetch(`${baseUrl}/v2/uploads/commit`, {
      method: 'POST',
      body: JSON.stringify(encryptUploadControl({
        secret: pairing.deviceSecret,
        deviceId: pairing.deviceId,
        mobileCaptureId,
        messageType: 'commit',
        payload: {}
      }))
    })
    expect(committed.status).toBe(200)
    const receipt = await committed.json() as { desktopCaptureId: string }
    expect(store.repository.listCaptureAssetLinks(receipt.desktopCaptureId).map((link) => ({
      position: link.position,
      name: link.fileName
    }))).toEqual([
      { position: 0, name: '灵感录音-001.aac' },
      { position: 1, name: '灵感录音-002.aac' },
      { position: 2, name: '灵感录音-003.aac' }
    ])
    store.close()
  })

  it('accepts a resumable declaration larger than 5GB without a product cap', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const mobileCaptureId = 'over-five-gigabytes'
    const byteSize = 5 * 1024 * 1024 * 1024 + 17
    const chunkCount = Math.ceil(byteSize / MOBILE_ATTACHMENT_CHUNK_BYTES)
    const response = await fetch(`${baseUrl}/v2/uploads/start`, {
      method: 'POST',
      body: JSON.stringify(encryptUploadControl({
        secret: pairing.deviceSecret,
        deviceId: pairing.deviceId,
        mobileCaptureId,
        messageType: 'start',
        payload: {
          content: '',
          hint: 'auto',
          captureCreatedAt: '2026-07-25T06:30:00.000Z',
          attachments: [{
            attachmentId: 'five-gig-video',
            attachmentKind: 'video',
            name: '原始长视频.mp4',
            mimeType: 'video/mp4',
            byteSize,
            sha256: 'a'.repeat(64),
            chunkCount
          }]
        }
      }))
    })
    expect(response.status).toBe(200)
    const body = await response.json() as {
      attachments: Array<{ missingChunks: number[] }>
    }
    expect(body.attachments[0]?.missingChunks).toHaveLength(chunkCount)
    const session = store.repository.getMobileAssetUpload(pairing.deviceId, mobileCaptureId)
    expect(session).toMatchObject({
      expiresAt: '9999-12-31T23:59:59.999Z',
      attachments: [expect.objectContaining({ byteSize, chunkCount, attachmentKind: 'video' })]
    })
    store.close()
  })

  it('rejects a pairing without persisting a secret and rejects forged status proofs', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    const forged = await fetch(`${baseUrl}/v2/pair/status`, {
      method: 'POST', body: JSON.stringify({ sessionId: pairing.sessionId, proof: randomBytes(32).toString('base64') })
    })
    expect(forged.status).toBe(401)
    service.rejectPairing(pairing.sessionId)
    expect(await pairingStatus(baseUrl, pairing)).toMatchObject({ state: 'rejected' })
    expect(store.repository.listMobileSyncDevices()).toHaveLength(0)
    store.close()
  })

  it('upgrades a legacy device in place and stops accepting the old protocol secret', async () => {
    const { store } = await createStore()
    const legacyId = randomUUID()
    const legacySecret = randomBytes(32)
    store.repository.addMobileSyncDevice({ id: legacyId, name: '旧版Android', encryptedSecret: protector.encrypt(legacySecret.toString('base64')) })
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const legacyCapture = encryptCapture({
      secret: legacySecret, deviceId: legacyId, mobileCaptureId: 'legacy-before-upgrade', protocolVersion: 1,
      createdAt: '2026-07-21T12:30:00.000Z', content: '升级前仍可续传', hint: 'auto'
    })
    expect((await fetch(`${baseUrl}/v1/captures`, { method: 'POST', body: JSON.stringify(legacyCapture) })).status).toBe(200)

    const pairing = await beginV2Pairing({
      baseUrl, serviceId: status.serviceId, deviceName: '升级后的Android', upgradeDeviceId: legacyId, upgradeSecret: legacySecret
    })
    expect(pairing.deviceId).toBe(legacyId)
    expect(service.getStatus().pendingPairings[0]?.upgradeDeviceId).toBe(legacyId)
    service.approvePairing(pairing.sessionId)
    expect(await pairingStatus(baseUrl, pairing)).toMatchObject({ state: 'approved' })
    expect(store.repository.listMobileSyncDevices()).toEqual([
      expect.objectContaining({ id: legacyId, name: '升级后的Android', protocolVersion: 2, trustState: 'trusted_v2' })
    ])
    const oldAfterUpgrade = encryptCapture({
      secret: legacySecret, deviceId: legacyId, mobileCaptureId: 'legacy-after-upgrade', protocolVersion: 1,
      createdAt: '2026-07-21T12:31:00.000Z', content: '不应使用旧密钥导入', hint: 'auto'
    })
    expect((await fetch(`${baseUrl}/v1/captures`, { method: 'POST', body: JSON.stringify(oldAfterUpgrade) })).status).toBe(401)
    const secureCapture = encryptCapture({
      secret: pairing.deviceSecret, deviceId: legacyId, mobileCaptureId: 'secure-after-upgrade', protocolVersion: 2,
      createdAt: '2026-07-21T12:32:00.000Z', content: '安全升级成功', hint: 'topic'
    })
    expect((await fetch(`${baseUrl}/v2/captures`, { method: 'POST', body: JSON.stringify(secureCapture) })).status).toBe(200)
    store.close()
  })

  it('rejects tampering and revoked v2 device secrets without importing plaintext', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const status = service.getStatus()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairing = await beginV2Pairing({ baseUrl, serviceId: status.serviceId })
    service.approvePairing(pairing.sessionId)
    const encrypted = encryptCapture({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId: 'tampered-note', protocolVersion: 2,
      createdAt: new Date().toISOString(), content: '不应导入', hint: 'auto'
    })
    const bytes = Buffer.from(encrypted.ciphertext as string, 'base64'); bytes[0] = (bytes[0] ?? 0) ^ 1
    encrypted.ciphertext = bytes.toString('base64')
    expect((await fetch(`${baseUrl}/v2/captures`, { method: 'POST', body: JSON.stringify(encrypted) })).status).toBe(400)
    expect(store.repository.getSnapshot().captures.some((capture) => capture.originalContent === '不应导入')).toBe(false)
    service.revokeDevice(pairing.deviceId)
    const validAfterRevoke = encryptCapture({
      secret: pairing.deviceSecret, deviceId: pairing.deviceId, mobileCaptureId: 'revoked-note', protocolVersion: 2,
      createdAt: new Date().toISOString(), content: '撤销后也不应导入', hint: 'auto'
    })
    expect((await fetch(`${baseUrl}/v2/captures`, { method: 'POST', body: JSON.stringify(validAfterRevoke) })).status).toBe(401)
    store.close()
  })

  it('disables plaintext v1 pairing for new devices', async () => {
    const { store } = await createStore()
    const service = await startService(store)
    const response = await fetch(`http://127.0.0.1:${service.getStatus().port}/v1/pair`, {
      method: 'POST', body: JSON.stringify({ code: '12345678', deviceName: 'Android' })
    })
    expect(response.status).toBe(410)
    expect(await response.json()).not.toHaveProperty('secret')
    expect(store.repository.listMobileSyncDevices()).toHaveLength(0)
    store.close()
  })

  it('refuses to start when encrypted system storage is unavailable', async () => {
    const { store } = await createStore()
    const unavailable: SecretProtector = { isAvailable: () => false, encrypt: () => { throw new Error('unavailable') }, decrypt: () => { throw new Error('unavailable') } }
    const service = new MobileSyncService(store, unavailable, () => {})
    services.push(service)
    await expect(service.setEnabled(true)).rejects.toThrow('系统安全存储当前不可用')
    expect(service.getStatus()).toMatchObject({ enabled: false, running: false, securityAvailable: false })
    store.close()
  })
})
