import { workspaceAccessQuerySchema, workspaceAccessStateSchema, workspaceAccessUpdateSchema, WORKSPACE_ACCESS_SCOPES, type WorkspaceAccessState, type WorkspaceAccessUpdate } from '../../shared/workspace-access'
import { workspaceDomainV2Inspect, workspaceDomainV2Resolve, WORKSPACE_DOMAIN_V2_TODO_UNITS, type WorkspaceDomainV2Kind } from '../../shared/workspace-domain-v2'
import { WorkspaceV2DomainRejection } from './workspace-sync-v2-errors'
import { WorkspaceV2PageBudget } from './workspace-sync-v2-page-budget'
import type { WorkspaceV2BlobStore } from './workspace-sync-v2-blobs'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  WORKSPACE_V2_KIND_SCOPE, WORKSPACE_V2_LIMITS as LIMIT, WORKSPACE_V2_SCOPES,
  workspaceV2CanonicalJson, workspaceV2ChunkLength, workspaceV2ScopesSchema,
  type WorkspaceV2Kind, type WorkspaceV2Scope, type WorkspaceV2Record, type WorkspaceV2Receipt, type WorkspaceV2Operation, type WorkspaceV2Payload,
  workspaceV2CapabilitiesRequestSchema, workspaceV2SyncRequestSchema, workspaceV2SnapshotStartRequestSchema,
  workspaceV2SnapshotPageRequestSchema, workspaceV2BlobReadRequestSchema
} from '../../shared/workspace-sync-v2'
import type { WorkspaceRepository } from './repository'
import { WorkspaceSyncError } from './workspace-sync-repository'

type Capabilities = z.infer<typeof workspaceV2CapabilitiesRequestSchema>
type Sync = z.infer<typeof workspaceV2SyncRequestSchema>
type Start = z.infer<typeof workspaceV2SnapshotStartRequestSchema>
type Page = z.infer<typeof workspaceV2SnapshotPageRequestSchema>
type Read = z.infer<typeof workspaceV2BlobReadRequestSchema>
interface Header { sequence: number; kind: WorkspaceV2Kind; entity_id: string; revision: number; deleted: number; source: 'manual' | 'schedule' | null }
interface Manifest { id: string; device_id: string; scope_digest: string; scopes_json: string; through: number; entity_count: number; entries_sha256: string; expires_at: number; token_key: Buffer }
const implemented = ['preferences.todo', 'project.catalog', 'todo.full', 'work_log'] as const
const writable = new Set<WorkspaceV2Scope>(['todo.full', 'work_log'])
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const identity = (workspaceId: string, deviceId: string) => ({ protocolVersion: 2 as const, workspaceId, deviceId })
const headerColumns = 'sequence,kind,entity_id,revision,deleted,source'
function fail(message: string, code = 'scope_denied', status = 403): never { throw new WorkspaceSyncError(code, message, status) }

export class WorkspaceV2Repository {
  constructor(readonly domain: WorkspaceRepository, private readonly clock = Date.now, private readonly blobs?: () => WorkspaceV2BlobStore) {}
  get workspaceId(): string { return this.domain.getOrCreateMobileSyncServiceId() }
  setDeviceGrants(deviceId: string, grants: readonly { scope: WorkspaceV2Scope; write: boolean }[]): void {
    const parsed = z.array(z.object({ scope: z.enum(WORKSPACE_V2_SCOPES), write: z.boolean() }).strict()).max(8).refine(values => new Set(values.map(value => value.scope)).size === values.length).parse(grants)
    this.domain.native.transaction(() => {
      this.assertDevice(deviceId)
      const before = this.domain.native.prepare('SELECT scope,write_allowed FROM workspace_v2_grants WHERE device_id=? ORDER BY scope').all(deviceId) as { scope: WorkspaceV2Scope; write_allowed: number }[]
      const sorted = [...parsed].sort((a, b) => a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0)
      if (JSON.stringify(before.map(row => ({ scope: row.scope, write: Boolean(row.write_allowed) }))) === JSON.stringify(sorted)) return
      this.domain.native.prepare('DELETE FROM workspace_v2_grants WHERE device_id=?').run(deviceId)
      for (const grant of parsed) this.domain.native.prepare('INSERT INTO workspace_v2_grants(device_id,scope,write_allowed,approved_at) VALUES(?,?,?,?)').run(deviceId, grant.scope, Number(grant.write), new Date(this.clock()).toISOString())
      this.domain.native.prepare('INSERT INTO workspace_v2_grant_revisions(device_id,revision) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision').run(deviceId, randomBytes(32).toString('hex'))
      this.domain.native.prepare('DELETE FROM workspace_v2_manifests WHERE device_id=?').run(deviceId)
    })()
  }
  getDeviceAccess(deviceId: string): WorkspaceAccessState {
    workspaceAccessQuerySchema.parse({ deviceId })
    this.assertDevice(deviceId)
    const rows = this.domain.native.prepare('SELECT scope,write_allowed FROM workspace_v2_grants WHERE device_id=? ORDER BY scope').all(deviceId) as { scope: WorkspaceV2Scope; write_allowed: number }[]
    return workspaceAccessStateSchema.parse({ deviceId, revision: hash(this.grantsStamp(deviceId)), grants: rows.filter(row => WORKSPACE_ACCESS_SCOPES.some(scope => scope === row.scope)).map(row => ({ scope: row.scope, write: writable.has(row.scope) && row.write_allowed === 1 })) })
  }
  updateDeviceAccess(input: WorkspaceAccessUpdate): WorkspaceAccessState {
    const value = workspaceAccessUpdateSchema.parse(input)
    return this.domain.native.transaction(() => {
      const before = this.getDeviceAccess(value.deviceId)
      if (before.revision !== value.expectedRevision) fail('授权已在其他窗口更改，请重新载入后确认', 'grant_conflict', 409)
      if (JSON.stringify(before.grants) !== JSON.stringify(value.grants)) this.setDeviceGrants(value.deviceId, value.grants)
      return this.getDeviceAccess(value.deviceId)
    })()
  }
  grantsStamp(deviceId: string): string {
    const revision = this.domain.native.prepare('SELECT revision FROM workspace_v2_grant_revisions WHERE device_id=?').get(deviceId) as { revision: string } | undefined
    return JSON.stringify({ revision: revision?.revision ?? null, grants: this.domain.native.prepare('SELECT scope,write_allowed,approved_at FROM workspace_v2_grants WHERE device_id=? ORDER BY scope').all(deviceId) })
  }
  assertDevice(deviceId: string, expectedEncryptedSecret?: string): void {
    const credential = this.domain.getMobileSyncDeviceCredential(deviceId)
    if (!credential || credential.protocolVersion !== 2 || credential.trustState !== 'trusted_v2' || (expectedEncryptedSecret !== undefined && credential.encryptedSecret !== expectedEncryptedSecret)) fail('设备已撤销或配对密钥已变更', 'device_revoked', 401)
  }
  authorize(deviceId: string, scope: WorkspaceV2Scope, write = false): void {
    this.assertDevice(deviceId)
    if (!implemented.some(value => value === scope) || (write && !writable.has(scope))) fail('此范围尚未提供写入或读取能力')
    const grant = this.domain.native.prepare('SELECT write_allowed FROM workspace_v2_grants WHERE device_id=? AND scope=?').get(deviceId, scope) as { write_allowed: number } | undefined
    if (!grant || (write && !grant.write_allowed)) fail('此设备未获准同步该范围')
  }
  private authorizeScopes(deviceId: string, scopes: WorkspaceV2Scope[]): void {
    workspaceV2ScopesSchema.parse(scopes)
    for (const scope of scopes) this.authorize(deviceId, scope)
  }
  private assertContext(request: { workspaceId: string; deviceId: string }): void {
    if (!this.domain.native.inTransaction) throw new Error('v2操作必须在认证事务中执行')
    this.assertDevice(request.deviceId)
    if (request.workspaceId !== this.workspaceId) fail('工作台身份不匹配', 'wrong_workspace')
  }
  capabilities(request: Capabilities) {
    this.assertContext(request)
    const supportedScopes = implemented.filter(scope => request.clientScopes.includes(scope) && Boolean(this.domain.native.prepare('SELECT 1 FROM workspace_v2_grants WHERE device_id=? AND scope=?').get(request.deviceId, scope)))
    return { ...identity(this.workspaceId, request.deviceId), schemaVersion: 1 as const, supportedScopes, permissions: supportedScopes.map(scope => ({ scope, read: true as const, write: writable.has(scope) && Boolean((this.domain.native.prepare('SELECT write_allowed FROM workspace_v2_grants WHERE device_id=? AND scope=?').get(request.deviceId, scope) as { write_allowed: number }).write_allowed) })), limits: LIMIT }
  }
  watermark(): number { return (this.domain.native.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM workspace_v2_changes').get() as { n: number }).n }
  private payloadInfo(sequence: number): { sha256: string; byte_length: number } {
    const existing = this.domain.native.prepare('SELECT sha256,byte_length FROM workspace_v2_hashes WHERE sequence=?').get(sequence) as { sha256: string; byte_length: number } | undefined
    if (existing) return existing
    const size = this.domain.native.prepare('SELECT length(CAST(payload_json AS BLOB)) AS n FROM workspace_v2_changes WHERE sequence=?').get(sequence) as { n: number } | undefined
    if (!size || size.n > LIMIT.jsonBlobBytes) fail('记录正文超出可同步大小', 'record_too_large', 413)
    const digest = createHash('sha256')
    for (let offset = 0; offset < size.n; offset += LIMIT.blobChunkBytes) digest.update(this.rawChunk(sequence, offset, LIMIT.blobChunkBytes))
    const result = { sha256: digest.digest('hex'), byte_length: size.n }
    this.domain.native.prepare('INSERT INTO workspace_v2_hashes(sequence,sha256,byte_length) VALUES(?,?,?)').run(sequence, result.sha256, result.byte_length)
    return result
  }
  private rawChunk(sequence: number, offset: number, length: number): Buffer {
    return (this.domain.native.prepare('SELECT substr(CAST(payload_json AS BLOB),?,?) AS bytes FROM workspace_v2_changes WHERE sequence=?').get(offset + 1, length, sequence) as { bytes: Buffer }).bytes
  }
  private rawJson(row: Header): string { return (this.domain.native.prepare('SELECT payload_json FROM workspace_v2_changes WHERE sequence=?').get(row.sequence) as { payload_json: string }).payload_json }
  private metadata(row: Header, deviceId: string): WorkspaceV2Record['metadata'] {
    const scope = WORKSPACE_V2_KIND_SCOPE[row.kind]
    const grant = this.domain.native.prepare('SELECT write_allowed FROM workspace_v2_grants WHERE device_id=? AND scope=?').get(deviceId, scope) as { write_allowed: number } | undefined
    const canWrite = writable.has(scope) && Boolean(grant?.write_allowed) && !(row.kind === 'todo' && row.deleted) && workspaceDomainV2Inspect(row.kind as WorkspaceDomainV2Kind, row.entity_id, this.rawJson(row)).writable
    return { scope, read: true, write: canWrite, deletable: canWrite, editableFields: canWrite ? row.kind === 'todo' ? Object.values(WORKSPACE_DOMAIN_V2_TODO_UNITS).flat() : ['totalMinutes'] : [], source: row.kind === 'todo' ? row.source : null }
  }
  private record(row: Header, deviceId: string, frozenMetadata?: string): WorkspaceV2Record {
    const info = this.payloadInfo(row.sequence)
    const payload: WorkspaceV2Record['payload'] = info.byte_length <= LIMIT.inlineJsonBytes
      ? { encoding: 'json', json: this.rawChunk(row.sequence, 0, info.byte_length).toString('utf8'), sha256: info.sha256, byteLength: info.byte_length }
      : { encoding: 'blob', ref: { sha256: info.sha256, byteLength: info.byte_length, mediaType: 'application/json' } }
    return { kind: row.kind, id: row.entity_id, revision: row.revision, sequence: row.sequence, deleted: row.deleted === 1, payload, metadata: frozenMetadata ? JSON.parse(frozenMetadata) : this.metadata(row, deviceId) }
  }
  private kinds(scopes: WorkspaceV2Scope[]): WorkspaceV2Kind[] { return Object.entries(WORKSPACE_V2_KIND_SCOPE).filter(([, scope]) => scopes.includes(scope)).map(([kind]) => kind as WorkspaceV2Kind) }
  private bindCursor(deviceId: string, digest: string, cursor: number): void {
    this.domain.native.prepare('INSERT INTO workspace_v2_cursor_bindings(device_id,scope_digest,max_cursor) VALUES(?,?,?) ON CONFLICT(device_id,scope_digest) DO UPDATE SET max_cursor=MAX(max_cursor,excluded.max_cursor)').run(deviceId, digest, cursor)
  }
  synchronize(request: Sync) {
    this.assertContext(request)
    this.authorizeScopes(request.deviceId, request.scopes)
    const through = request.through ?? this.watermark()
    if (through > this.watermark() || request.cursor > through) fail('工作台历史已回退', 'cursor_ahead', 409)
    const binding = this.domain.native.prepare('SELECT max_cursor FROM workspace_v2_cursor_bindings WHERE device_id=? AND scope_digest=?').get(request.deviceId, request.scopeDigest) as { max_cursor: number } | undefined
    if (request.cursor > (binding?.max_cursor ?? 0)) fail('此范围必须先完成快照或从头同步', 'cursor_scope_mismatch', 409)
    if (request.through !== null && !this.domain.native.prepare('SELECT 1 FROM workspace_v2_windows WHERE device_id=? AND scope_digest=? AND through=?').get(request.deviceId, request.scopeDigest, request.through)) fail('固定水位不属于当前范围', 'window_unknown', 409)
    if (request.through === null) this.domain.native.prepare('INSERT OR IGNORE INTO workspace_v2_windows(device_id,scope_digest,through) VALUES(?,?,?)').run(request.deviceId, request.scopeDigest, through)
    const receipts = request.operations.map(operation => this.applyOperation(request.deviceId, operation))
    const documents = new WorkspaceV2PageBudget()
    for (const receipt of receipts) {
      if (receipt.record && !documents.add(receipt.record)) fail('回执正文超出分页上限', 'response_too_large', 413)
    }
    const kinds = this.kinds(request.scopes)
    const rows = this.domain.native.prepare(`SELECT ${headerColumns} FROM workspace_v2_changes WHERE sequence>? AND sequence<=? AND kind IN(${kinds.map(() => '?').join(',')}) ORDER BY sequence LIMIT 101`).all(request.cursor, through, ...kinds) as Header[]
    const response = { ...identity(this.workspaceId, request.deviceId), scopes: request.scopes, scopeDigest: request.scopeDigest, receipts, changes: [] as WorkspaceV2Record[], cursor: request.cursor, through, hasMore: request.cursor < through }
    if (Buffer.byteLength(JSON.stringify({ ...response, cursor: through, hasMore: false })) > LIMIT.metadataBytes) fail('回执超出分页上限', 'response_too_large', 413)
    for (const row of rows.slice(0, 100)) {
      const next = this.record(row, request.deviceId), candidate = { ...response, changes: [...response.changes, next], cursor: through, hasMore: false }
      if (Buffer.byteLength(JSON.stringify(candidate)) > LIMIT.metadataBytes || !documents.add(next)) break
      response.changes.push(next); response.cursor = next.sequence
    }
    if (response.changes.length === rows.length) response.cursor = through
    if (!receipts.length && response.cursor === request.cursor && response.cursor < through) fail('单条记录超出分页上限', 'record_too_large', 413)
    response.hasMore = response.cursor < through
    this.bindCursor(request.deviceId, request.scopeDigest, response.cursor)
    return response
  }
  latest(kind: WorkspaceV2Kind, id: string, deviceId: string): WorkspaceV2Record | null {
    this.authorize(deviceId, WORKSPACE_V2_KIND_SCOPE[kind])
    const row = this.domain.native.prepare(`SELECT ${headerColumns} FROM workspace_v2_changes WHERE kind=? AND entity_id=? ORDER BY revision DESC LIMIT 1`).get(kind, id) as Header | undefined
    return row ? this.record(row, deviceId) : null
  }
  private bodyFromPayload(deviceId: string, kind: WorkspaceV2Kind, id: string, payload: WorkspaceV2Payload): { json: string; sessionId?: string } {
    if (payload.encoding === 'json') return { json: payload.json }
    const existing = this.domain.native.prepare('SELECT c.sequence,c.kind,c.entity_id,c.revision,c.deleted,c.source FROM workspace_v2_hashes h JOIN workspace_v2_changes c ON c.sequence=h.sequence WHERE c.kind=? AND c.entity_id=? AND h.sha256=? AND h.byte_length=? LIMIT 1').get(kind, id, payload.ref.sha256, payload.ref.byteLength) as Header | undefined
    if (existing) return { json: this.rawJson(existing) }
    if (!this.blobs) fail('正文上传暂不可用', 'blob_unavailable', 503)
    return this.blobs().committedJson(deviceId, { kind, id }, payload.ref)
  }
  private applyOperation(deviceId: string, operation: WorkspaceV2Operation): WorkspaceV2Receipt {
    const kind = operation.type === 'record' ? operation.kind : 'todo_preferences', id = operation.type === 'record' ? operation.id : 'workspace'
    this.authorize(deviceId, WORKSPACE_V2_KIND_SCOPE[kind])
    const operationHash = hash(workspaceV2CanonicalJson(operation))
    const existing = this.domain.native.prepare('SELECT payload_hash,receipt_json FROM workspace_v2_receipts WHERE device_id=? AND operation_id=?').get(deviceId, operation.operationId) as { payload_hash: string; receipt_json: string } | undefined
    if (existing) {
      if (existing.payload_hash !== operationHash) fail('操作标识已用于不同内容', 'operation_reused', 409)
      return JSON.parse(existing.receipt_json) as WorkspaceV2Receipt
    }
    this.authorize(deviceId, WORKSPACE_V2_KIND_SCOPE[kind], true)
    if (operation.type !== 'record' || (kind !== 'todo' && kind !== 'work_log')) fail('该写入意图尚未启用', 'write_not_available')
    const latest = this.domain.native.prepare(`SELECT ${headerColumns} FROM workspace_v2_changes WHERE kind=? AND entity_id=? ORDER BY revision DESC LIMIT 1`).get(kind, id) as Header | undefined
    let historical: Header | undefined
    if (operation.base) {
      historical = this.domain.native.prepare(`SELECT ${headerColumns} FROM workspace_v2_changes WHERE kind=? AND entity_id=? AND revision=?`).get(kind, id, operation.baseRevision) as Header | undefined
      if (!historical || operation.base.deleted !== Boolean(historical.deleted) || workspaceV2CanonicalJson(this.record(historical, deviceId).payload) !== workspaceV2CanonicalJson(operation.base.payload)) fail('同步基线与不可变历史不匹配', 'invalid_base', 409)
    }
    let receipt: WorkspaceV2Receipt
    try {
      receipt = this.domain.native.transaction((): WorkspaceV2Receipt => {
        if (operation.next.deleted && operation.base && workspaceV2CanonicalJson(operation.next.payload) !== workspaceV2CanonicalJson(operation.base.payload)) throw new WorkspaceV2DomainRejection('invalid_change')
        const supplied = this.bodyFromPayload(deviceId, kind, id, operation.next.payload)
        let nextBody: Record<string, unknown>
        try { nextBody = JSON.parse(supplied.json) } catch { throw new WorkspaceV2DomainRejection('invalid_change') }
        const resolution = workspaceDomainV2Resolve({ kind, id, baseRevision: operation.baseRevision, currentRevision: latest?.revision ?? 0,
          base: historical ? { deleted: Boolean(historical.deleted), body: JSON.parse(this.rawJson(historical)) } : null,
          current: latest ? { deleted: Boolean(latest.deleted), body: JSON.parse(this.rawJson(latest)) } : null,
          next: { deleted: operation.next.deleted, body: nextBody } })
        if (resolution.status === 'rejected') throw new WorkspaceV2DomainRejection(resolution.reason)
        if (resolution.status === 'conflict') {
          if (!latest) throw new Error('冲突缺少真实领域版本')
          return { operationId: operation.operationId, localRevision: operation.localRevision, status: 'conflict', record: this.record(latest, deviceId) }
        }
        if (resolution.status === 'apply') {
          if (kind === 'todo') {
            if (resolution.deleted) this.domain.dismissTodoItem(id)
            else if (!historical) this.domain.importWorkspaceTodoV2(id, resolution.body)
            else this.domain.applyWorkspaceTodoV2(id, resolution.body)
          } else {
            this.domain.setWorkspaceWorkLog(id, resolution.deleted ? null : resolution.body.totalMinutes as number)
            if (!latest && resolution.deleted) this.domain.native.prepare('INSERT INTO workspace_sync_changes(kind,entity_id,revision,deleted,data_json,metadata_json) VALUES(?,?,1,1,?,?)').run(kind, id, JSON.stringify({ minutes: null }), JSON.stringify(this.domain.getDailyWorkLog(id)))
          }
        }
        const record = this.latest(kind, id, deviceId)
        if (!record) throw new Error('领域写入缺少投影')
        if (supplied.sessionId) this.blobs!().consumeJson(deviceId, supplied.sessionId)
        return { operationId: operation.operationId, localRevision: operation.localRevision, status: 'accepted', record }
      })()
    } catch (error) {
      if (!(error instanceof WorkspaceV2DomainRejection)) throw error
      receipt = { operationId: operation.operationId, localRevision: operation.localRevision, status: 'rejected', target: { kind, id }, operationHash, code: error.code, record: this.latest(kind, id, deviceId) }
    }
    this.domain.native.prepare('INSERT INTO workspace_v2_receipts(device_id,operation_id,payload_hash,receipt_json) VALUES(?,?,?,?)').run(deviceId, operation.operationId, operationHash, JSON.stringify(receipt))
    return receipt
  }
  startSnapshot(request: Start) {
    this.assertContext(request)
    this.authorizeScopes(request.deviceId, request.scopes)
    this.domain.native.prepare('DELETE FROM workspace_v2_manifests WHERE expires_at<=?').run(this.clock())
    const through = this.watermark()
    const previous = this.domain.native.prepare('SELECT * FROM workspace_v2_manifests WHERE device_id=? AND scope_digest=? AND through=? ORDER BY expires_at DESC LIMIT 1').get(request.deviceId, request.scopeDigest, through) as Manifest | undefined
    if (previous) return this.manifestBody(previous)
    const kinds = this.kinds(request.scopes)
    const rows = this.domain.native.prepare(`SELECT ${headerColumns} FROM workspace_v2_changes WHERE sequence IN(SELECT MAX(sequence) FROM workspace_v2_changes WHERE sequence<=? AND kind IN(${kinds.map(() => '?').join(',')}) GROUP BY kind,entity_id)`).all(through, ...kinds) as Header[]
    rows.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0)
    const manifest: Manifest = { id: randomUUID(), device_id: request.deviceId, scope_digest: request.scopeDigest, scopes_json: JSON.stringify(request.scopes), through, entity_count: rows.length, entries_sha256: '', expires_at: this.clock() + LIMIT.idleTtlSeconds * 1000, token_key: randomBytes(32) }
    const entries = rows.map(row => ({ row, metadata: this.metadata(row, request.deviceId), hash: this.payloadInfo(row.sequence).sha256 }))
    const digest = createHash('sha256')
    for (const item of entries) digest.update(workspaceV2CanonicalJson([item.row.kind, item.row.entity_id, item.row.revision, item.row.sequence, item.row.deleted === 1, item.hash, hash(workspaceV2CanonicalJson(item.metadata))]))
    manifest.entries_sha256 = digest.digest('hex')
    this.domain.native.prepare('INSERT INTO workspace_v2_manifests(id,device_id,scope_digest,scopes_json,through,entity_count,entries_sha256,expires_at,token_key) VALUES(?,?,?,?,?,?,?,?,?)').run(manifest.id, manifest.device_id, manifest.scope_digest, manifest.scopes_json, manifest.through, manifest.entity_count, manifest.entries_sha256, manifest.expires_at, manifest.token_key)
    const insert = this.domain.native.prepare('INSERT INTO workspace_v2_manifest_entries(manifest_id,ordinal,sequence,metadata_json) VALUES(?,?,?,?)')
    entries.forEach((entry, index) => insert.run(manifest.id, index + 1, entry.row.sequence, JSON.stringify(entry.metadata)))
    return this.manifestBody(manifest)
  }
  private manifestBody(manifest: Manifest) {
    return { ...identity(this.workspaceId, manifest.device_id), manifestId: manifest.id, schemaVersion: 1 as const, scopes: JSON.parse(manifest.scopes_json) as WorkspaceV2Scope[], scopeDigest: manifest.scope_digest, through: manifest.through, entityCount: manifest.entity_count, entriesSha256: manifest.entries_sha256, expiresAt: new Date(manifest.expires_at).toISOString() }
  }
  private manifest(deviceId: string, id: string): Manifest {
    const value = this.domain.native.prepare('SELECT * FROM workspace_v2_manifests WHERE id=? AND device_id=?').get(id, deviceId) as Manifest | undefined
    if (!value || value.expires_at <= this.clock()) fail('快照不存在或已过期', 'manifest_expired', 410)
    this.authorizeScopes(deviceId, JSON.parse(value.scopes_json) as WorkspaceV2Scope[])
    return value
  }
  private token(manifest: Manifest, ordinal: number): string {
    const payload = Buffer.from(JSON.stringify([manifest.id, manifest.device_id, manifest.scope_digest, ordinal])).toString('base64url')
    return payload + createHmac('sha256', manifest.token_key).update(payload).digest('base64url')
  }
  private tokenOrdinal(manifest: Manifest, token: string | null): number {
    if (token === null) return 0
    const data = token.slice(0, -43), signature = Buffer.from(token.slice(-43), 'base64url'), expected = createHmac('sha256', manifest.token_key).update(data).digest()
    if (signature.length !== expected.length || signature.toString('base64url') !== token.slice(-43) || Buffer.from(data, 'base64url').toString('base64url') !== data || !timingSafeEqual(signature, expected)) fail('快照页位置签名无效', 'invalid_page', 409)
    const decoded: unknown = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== manifest.id || decoded[1] !== manifest.device_id || decoded[2] !== manifest.scope_digest || !Number.isSafeInteger(decoded[3]) || decoded[3] < 1 || decoded[3] >= manifest.entity_count) fail('快照页位置不匹配', 'invalid_page', 409)
    return decoded[3] as number
  }
  snapshotPage(request: Page) {
    this.assertContext(request)
    const manifest = this.manifest(request.deviceId, request.manifestId), after = this.tokenOrdinal(manifest, request.after)
    const rows = this.domain.native.prepare(`SELECT ${headerColumns.split(',').map(column => `c.${column}`).join(',')},e.ordinal,e.metadata_json FROM workspace_v2_manifest_entries e JOIN workspace_v2_changes c ON c.sequence=e.sequence WHERE e.manifest_id=? AND e.ordinal>? ORDER BY e.ordinal LIMIT ?`).all(manifest.id, after, request.limit) as (Header & { ordinal: number; metadata_json: string })[]
    const response = { ...identity(this.workspaceId, request.deviceId), manifestId: manifest.id, records: [] as WorkspaceV2Record[], next: null as string | null, done: false }
    const documents = new WorkspaceV2PageBudget()
    let ordinal = after
    for (const row of rows) {
      const record = this.record(row, request.deviceId, row.metadata_json), next = row.ordinal < manifest.entity_count ? this.token(manifest, row.ordinal) : null
      const candidate = { ...response, records: [...response.records, record], next, done: next === null }
      if (Buffer.byteLength(JSON.stringify(candidate)) > LIMIT.metadataBytes || !documents.add(record)) break
      response.records.push(record); response.next = next; response.done = next === null; ordinal = row.ordinal
    }
    if (manifest.entity_count === 0) response.done = true
    if (!response.done && ordinal === after) fail('快照页无法取得进展', 'record_too_large', 413)
    if (response.done) this.bindCursor(request.deviceId, manifest.scope_digest, manifest.through)
    return response
  }
  readBlob(request: Read) {
    this.assertContext(request)
    this.authorize(request.deviceId, WORKSPACE_V2_KIND_SCOPE[request.record.kind])
    const row = this.domain.native.prepare(`SELECT ${headerColumns} FROM workspace_v2_changes WHERE kind=? AND entity_id=? AND revision=?`).get(request.record.kind, request.record.id, request.record.revision) as Header | undefined
    if (!row) fail('历史记录不存在', 'record_unknown', 404)
    if (request.record.manifestId) {
      const manifest = this.manifest(request.deviceId, request.record.manifestId)
      if (!this.domain.native.prepare('SELECT 1 FROM workspace_v2_manifest_entries WHERE manifest_id=? AND sequence=?').get(manifest.id, row.sequence)) fail('该版本不属于快照', 'record_not_in_manifest')
    }
    const info = this.payloadInfo(row.sequence)
    if (info.sha256 !== request.sha256) fail('历史记录未引用该对象', 'blob_not_referenced')
    const length = workspaceV2ChunkLength(info.byte_length, request.index)
    const bytes = this.rawChunk(row.sequence, request.index * LIMIT.blobChunkBytes, length)
    return { ...identity(this.workspaceId, request.deviceId), sha256: request.sha256, byteLength: info.byte_length, index: request.index, chunkSha256: hash(bytes), bytesBase64: bytes.toString('base64') }
  }
}
