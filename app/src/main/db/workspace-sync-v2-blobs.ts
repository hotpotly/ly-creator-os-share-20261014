import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { WORKSPACE_V2_LIMITS as LIMIT, workspaceV2AssertChunk, workspaceV2BlobStartRequestSchema, workspaceV2CanonicalJson, workspaceV2CheckUploadBudget, workspaceV2SessionExpiry, type WorkspaceV2Scope } from '../../shared/workspace-sync-v2'
import { WorkspaceSyncError } from './workspace-sync-repository'

type Start = z.infer<typeof workspaceV2BlobStartRequestSchema>
interface Session {
  id: string; device_id: string; upload_id: string; declaration_hash: string; scope: WorkspaceV2Scope;
  kind: string; entity_id: string; purpose: string; sha256: string; byte_length: number; media_type: string;
  created_at: number; last_activity: number; committed_at: number | null
}
interface Chunk { chunk_index: number; sha256: string; nonce: Buffer; tag: Buffer; ciphertext: Buffer }
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const denied = (message: string) => new WorkspaceSyncError('blob_denied', message, 403)

export class WorkspaceV2BlobStore {
  constructor(private readonly db: Database.Database, private readonly key: Buffer, private readonly authorize: (deviceId: string, scope: WorkspaceV2Scope, write: boolean) => void, private readonly clock = Date.now) {
    if (key.length !== 32) throw new Error('分块密钥无效')
  }
  private expiry(session: Session): number {
    return session.committed_at === null ? workspaceV2SessionExpiry(session.created_at, session.last_activity) : session.committed_at + LIMIT.unreferencedTtlSeconds * 1000
  }
  private linked(id: string): boolean { return Boolean(this.db.prepare('SELECT 1 FROM workspace_v2_blob_links WHERE session_id=? LIMIT 1').get(id)) }
  private session(deviceId: string, id: string, write = true): Session {
    const session = this.db.prepare('SELECT * FROM workspace_v2_uploads WHERE id=? AND device_id=?').get(id, deviceId) as Session | undefined
    if (!session) {
      const used = this.db.prepare('SELECT declaration_json FROM workspace_v2_upload_keys WHERE device_id=? AND session_id=?').get(deviceId, id) as { declaration_json: string | null } | undefined
      if (used?.declaration_json) {
        this.authorize(deviceId, (JSON.parse(used.declaration_json) as { scope: WorkspaceV2Scope }).scope, write)
        throw new WorkspaceSyncError('blob_expired', '上传会话已过期', 410)
      }
      throw denied('上传会话不存在')
    }
    this.authorize(deviceId, session.scope, write)
    if (this.expiry(session) <= this.clock() && !this.linked(id)) throw new WorkspaceSyncError('blob_expired', '上传会话已过期', 410)
    return session
  }
  private state(session: Session) {
    const receivedIndexes = (this.db.prepare('SELECT chunk_index FROM workspace_v2_chunks WHERE session_id=? ORDER BY chunk_index').all(session.id) as { chunk_index: number }[]).map(row => row.chunk_index)
    return { sessionId: session.id, chunkBytes: 65536 as const, receivedIndexes, expiresAt: new Date(this.expiry(session)).toISOString() }
  }
  private ref(session: Session) { return { sha256: session.sha256, byteLength: session.byte_length, mediaType: session.media_type } }
  cleanup(): void {
    const now = this.clock()
    this.db.prepare(`DELETE FROM workspace_v2_uploads WHERE NOT EXISTS(SELECT 1 FROM workspace_v2_blob_links WHERE session_id=workspace_v2_uploads.id) AND ((committed_at IS NULL AND (last_activity+?<=? OR created_at+?<=?)) OR (committed_at IS NOT NULL AND committed_at+?<=?))`).run(LIMIT.idleTtlSeconds * 1000, now, LIMIT.absoluteTtlSeconds * 1000, now, LIMIT.unreferencedTtlSeconds * 1000, now)
  }
  start(value: Start) {
    const input = workspaceV2BlobStartRequestSchema.parse(value)
    return this.db.transaction(() => {
      this.authorize(input.deviceId, input.scope, true)
      this.cleanup()
      const declarationHash = hash(workspaceV2CanonicalJson(input))
      const used = this.db.prepare('SELECT declaration_hash,session_id FROM workspace_v2_upload_keys WHERE device_id=? AND upload_id=?').get(input.deviceId, input.uploadId) as { declaration_hash: string; session_id: string } | undefined
      if (used && used.declaration_hash !== declarationHash) throw new WorkspaceSyncError('upload_reused', '上传标识已用于不同内容', 409)
      const previous = this.db.prepare('SELECT * FROM workspace_v2_uploads WHERE device_id=? AND upload_id=?').get(input.deviceId, input.uploadId) as Session | undefined
      if (used && !previous) throw new WorkspaceSyncError('blob_expired', '上传标识已过期', 410)
      if (previous) {
        if (previous.declaration_hash !== declarationHash) throw new WorkspaceSyncError('upload_reused', '上传标识已用于不同内容', 409)
        return this.state(previous)
      }
      const device = this.db.prepare('SELECT COALESCE(SUM(byte_length),0) AS bytes,SUM(CASE WHEN committed_at IS NULL THEN 1 ELSE 0 END) AS count FROM workspace_v2_uploads WHERE device_id=? AND NOT EXISTS(SELECT 1 FROM workspace_v2_blob_links WHERE session_id=workspace_v2_uploads.id)').get(input.deviceId) as { bytes: number; count: number }
      const workspace = this.db.prepare('SELECT COALESCE(SUM(byte_length),0) AS bytes FROM workspace_v2_uploads WHERE NOT EXISTS(SELECT 1 FROM workspace_v2_blob_links WHERE session_id=workspace_v2_uploads.id)').get() as { bytes: number }
      if (!workspaceV2CheckUploadBudget({ declaredBytes: input.byteLength, deviceReservedBytes: device.bytes, workspaceReservedBytes: workspace.bytes, activeUploads: device.count ?? 0 })) throw new WorkspaceSyncError('blob_quota', '上传暂存空间不足', 429)
      const id = randomUUID(), now = this.clock()
      this.db.prepare('INSERT INTO workspace_v2_uploads(id,device_id,upload_id,declaration_hash,scope,kind,entity_id,purpose,sha256,byte_length,media_type,created_at,last_activity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.deviceId, input.uploadId, declarationHash, input.scope, input.entity.kind, input.entity.id, input.purpose, input.sha256, input.byteLength, input.mediaType, now, now)
      const declaration = { scope: input.scope, entity: input.entity, purpose: input.purpose, sha256: input.sha256, byteLength: input.byteLength, mediaType: input.mediaType }
      this.db.prepare('INSERT INTO workspace_v2_upload_keys(device_id,upload_id,declaration_hash,session_id,declaration_json) VALUES(?,?,?,?,?)').run(input.deviceId, input.uploadId, declarationHash, id, JSON.stringify(declaration))
      return this.state(this.session(input.deviceId, id))
    })()
  }
  status(deviceId: string, id: string) { return this.state(this.session(deviceId, id)) }
  chunk(deviceId: string, id: string, index: number, expectedHash: string, bytes: Buffer) {
    return this.db.transaction(() => {
      const session = this.session(deviceId, id)
      workspaceV2AssertChunk(session.byte_length, index, bytes)
      if (hash(bytes) !== expectedHash) throw new WorkspaceSyncError('chunk_hash', '分块摘要不匹配')
      const previous = this.db.prepare('SELECT * FROM workspace_v2_chunks WHERE session_id=? AND chunk_index=?').get(id, index) as Chunk | undefined
      if (previous && (previous.sha256 !== expectedHash || !this.decrypt(id, previous).equals(bytes))) throw new WorkspaceSyncError('chunk_reused', '分块已有不同内容', 409)
      if (!previous) {
        if (session.committed_at !== null) throw denied('已提交对象不可修改')
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce)
        cipher.setAAD(Buffer.from(`${id}\n${index}\n${expectedHash}`))
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
        this.db.prepare('INSERT INTO workspace_v2_chunks(session_id,chunk_index,sha256,nonce,tag,ciphertext) VALUES(?,?,?,?,?,?)').run(id, index, expectedHash, nonce, cipher.getAuthTag(), encrypted)
      }
      if (session.committed_at === null) this.db.prepare('UPDATE workspace_v2_uploads SET last_activity=? WHERE id=?').run(this.clock(), id)
      return { sessionId: id, index, sha256: expectedHash, byteLength: bytes.length }
    })()
  }
  private decrypt(id: string, chunk: Chunk): Buffer {
    const cipher = createDecipheriv('aes-256-gcm', this.key, chunk.nonce)
    cipher.setAAD(Buffer.from(`${id}\n${chunk.chunk_index}\n${chunk.sha256}`)); cipher.setAuthTag(chunk.tag)
    const bytes = Buffer.concat([cipher.update(chunk.ciphertext), cipher.final()])
    if (hash(bytes) !== chunk.sha256) throw new WorkspaceSyncError('chunk_corrupt', '分块内容已损坏', 409)
    return bytes
  }
  commit(deviceId: string, id: string, expectedHash: string, byteLength: number) {
    return this.db.transaction(() => {
      const session = this.session(deviceId, id)
      if (expectedHash !== session.sha256 || byteLength !== session.byte_length) throw new WorkspaceSyncError('blob_declaration', '上传声明不匹配', 409)
      const digest = createHash('sha256'), count = Math.ceil(session.byte_length / LIMIT.blobChunkBytes)
      let index = 0
      for (const chunk of this.db.prepare('SELECT * FROM workspace_v2_chunks WHERE session_id=? ORDER BY chunk_index').iterate(id) as IterableIterator<Chunk>) {
        if (chunk.chunk_index !== index) throw new WorkspaceSyncError('blob_incomplete', '上传内容尚未完整', 409)
        const bytes = this.decrypt(id, chunk)
        workspaceV2AssertChunk(session.byte_length, index, bytes); digest.update(bytes); index++
      }
      if (index !== count || digest.digest('hex') !== expectedHash) throw new WorkspaceSyncError('blob_incomplete', '上传内容尚未完整或摘要不符', 409)
      if (session.committed_at === null) this.db.prepare('UPDATE workspace_v2_uploads SET committed_at=? WHERE id=?').run(this.clock(), id)
      return { sessionId: id, ref: this.ref(session) }
    })()
  }
  committedJson(deviceId: string, entity: { kind: string; id: string }, ref: { sha256: string; byteLength: number; mediaType: string }): { json: string; sessionId: string } {
    const found = this.db.prepare("SELECT id FROM workspace_v2_uploads WHERE device_id=? AND kind=? AND entity_id=? AND sha256=? AND byte_length=? AND media_type='application/json' AND purpose='document' AND committed_at IS NOT NULL ORDER BY committed_at DESC LIMIT 1").get(deviceId, entity.kind, entity.id, ref.sha256, ref.byteLength) as { id: string } | undefined
    if (ref.mediaType !== 'application/json') throw denied('正文类型不匹配')
    if (!found) {
      const expired = this.db.prepare("SELECT k.session_id,json_extract(k.declaration_json,'$.scope') AS scope FROM workspace_v2_upload_keys k WHERE k.device_id=? AND json_extract(k.declaration_json,'$.entity.kind')=? AND json_extract(k.declaration_json,'$.entity.id')=? AND json_extract(k.declaration_json,'$.sha256')=? AND json_extract(k.declaration_json,'$.byteLength')=? AND json_extract(k.declaration_json,'$.mediaType')='application/json' AND json_extract(k.declaration_json,'$.purpose')='document' AND NOT EXISTS(SELECT 1 FROM workspace_v2_uploads u WHERE u.id=k.session_id) LIMIT 1").get(deviceId, entity.kind, entity.id, ref.sha256, ref.byteLength) as { session_id: string; scope: WorkspaceV2Scope } | undefined
      if (expired) {
        this.authorize(deviceId, expired.scope, true)
        throw new WorkspaceSyncError('blob_expired', '已上传正文已过期', 410)
      }
      throw denied('正文未由该设备上传并提交')
    }
    const session = this.session(deviceId, found.id), digest = createHash('sha256'), decoder = new TextDecoder('utf-8', { fatal: true }), parts: string[] = []
    let index = 0
    for (const chunk of this.db.prepare('SELECT * FROM workspace_v2_chunks WHERE session_id=? ORDER BY chunk_index').iterate(session.id) as IterableIterator<Chunk>) {
      if (chunk.chunk_index !== index) throw denied('正文缺少分块')
      const bytes = this.decrypt(session.id, chunk)
      workspaceV2AssertChunk(session.byte_length, index++, bytes); digest.update(bytes); parts.push(decoder.decode(bytes, { stream: true }))
    }
    parts.push(decoder.decode())
    if (index !== Math.ceil(session.byte_length / LIMIT.blobChunkBytes) || digest.digest('hex') !== ref.sha256) throw denied('正文分块或摘要不匹配')
    return { json: parts.join(''), sessionId: session.id }
  }
  consumeJson(deviceId: string, id: string): void {
    if (!this.db.inTransaction) throw new Error('正文消费必须与领域提交共用事务')
    const session = this.session(deviceId, id)
    if (session.committed_at === null || session.purpose !== 'document' || session.media_type !== 'application/json') throw denied('正文尚未完成')
    this.db.prepare('UPDATE workspace_v2_uploads SET consumed_at=COALESCE(consumed_at,?) WHERE id=?').run(this.clock(), id)
  }
  associate(deviceId: string, id: string, record: { kind: string; id: string; revision: number }): void {
    if (!this.db.inTransaction) throw new Error('对象关联必须与领域提交共用事务')
    const session = this.session(deviceId, id)
    if (session.committed_at === null || session.kind !== record.kind || session.entity_id !== record.id || !Number.isSafeInteger(record.revision) || record.revision < 1) throw denied('对象与领域记录不匹配')
    this.db.prepare('INSERT OR IGNORE INTO workspace_v2_blob_links(scope,kind,entity_id,revision,sha256,session_id) VALUES(?,?,?,?,?,?)').run(session.scope, record.kind, record.id, record.revision, session.sha256, id)
  }
  readReferenced(deviceId: string, record: { kind: string; id: string; revision: number }, sha256: string, index: number) {
    const session = this.db.prepare('SELECT u.* FROM workspace_v2_blob_links l JOIN workspace_v2_uploads u ON u.id=l.session_id WHERE l.kind=? AND l.entity_id=? AND l.revision=? AND l.sha256=?').get(record.kind, record.id, record.revision, sha256) as Session | undefined
    if (!session) throw denied('记录未引用该对象')
    this.authorize(deviceId, session.scope, false)
    const chunk = this.db.prepare('SELECT * FROM workspace_v2_chunks WHERE session_id=? AND chunk_index=?').get(session.id, index) as Chunk | undefined
    if (!chunk) throw denied('分块不存在')
    const bytes = this.decrypt(session.id, chunk)
    workspaceV2AssertChunk(session.byte_length, index, bytes)
    return { sha256, byteLength: session.byte_length, index, chunkSha256: chunk.sha256, bytesBase64: bytes.toString('base64') }
  }
}
