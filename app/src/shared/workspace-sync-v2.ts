import { z } from 'zod'
import { isValidLocalDate } from './domain/coarse-time'

export const WORKSPACE_V2_SCOPES = ['preferences.todo', 'project.catalog', 'review', 'review.file', 'todo.day', 'todo.full', 'trip', 'work_log'] as const
export const WORKSPACE_V2_PURPOSES = ['capabilities', 'sync', 'snapshot.start', 'snapshot.page', 'blob.start', 'blob.status', 'blob.chunk', 'blob.commit', 'blob.read'] as const
export const WORKSPACE_V2_KINDS = ['todo', 'work_log', 'todo_day', 'todo_preferences', 'project_catalog', 'trip', 'review_period', 'review_entry', 'review_file'] as const
export const WORKSPACE_V2_KEY_INFO = 'ly-creator-workspace-v2'
export const WORKSPACE_V2_LIMITS = {
  batchRecords: 100, metadataBytes: 262144, inlineJsonBytes: 16384, blobChunkBytes: 65536,
  jsonBlobBytes: 16777216, imageBlobBytes: 20971520, imagesPerRecord: 20, concurrentUploads: 2,
  concurrentDownloads: 2, deviceTemporaryBytes: 268435456, workspaceTemporaryBytes: 536870912,
  idleTtlSeconds: 86400, absoluteTtlSeconds: 604800, unreferencedTtlSeconds: 86400, previewMaxPixels: 2048
} as const
export type WorkspaceV2Scope = typeof WORKSPACE_V2_SCOPES[number]
export type WorkspaceV2Kind = typeof WORKSPACE_V2_KINDS[number]
export const WORKSPACE_V2_KIND_SCOPE: Record<WorkspaceV2Kind, WorkspaceV2Scope> = {
  todo: 'todo.full', work_log: 'work_log', todo_day: 'todo.day', todo_preferences: 'preferences.todo',
  project_catalog: 'project.catalog', trip: 'trip', review_period: 'review', review_entry: 'review', review_file: 'review.file'
}
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positive = integer.min(1)
const uuid = z.string().uuid()
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const entityId = z.string().min(1).max(256).refine(value => Array.from(value).every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127))
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19))
const identity = { protocolVersion: z.literal(2), workspaceId: uuid, deviceId: uuid }
const scope = z.enum(WORKSPACE_V2_SCOPES)
const kind = z.enum(WORKSPACE_V2_KINDS)
const purpose = z.enum(WORKSPACE_V2_PURPOSES)
const ordered = (values: readonly string[]): boolean => values.every((value, index) => index === 0 || values[index - 1]! < value)
export const workspaceV2ScopesSchema = z.array(scope).min(1).max(WORKSPACE_V2_SCOPES.length).refine(ordered, '范围必须按UTF-16排序且不重复')
const uniqueIndexes = z.array(integer.max(319)).max(320).refine(values => values.every((value, index) => index === 0 || values[index - 1]! < value))
const pageToken = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/)
const imageMedia = z.enum(['image/png', 'image/jpeg', 'image/webp'])
const mediaType = z.enum(['application/json', 'image/png', 'image/jpeg', 'image/webp'])

export function workspaceV2CanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${Array.from(value, workspaceV2CanonicalJson).join(',')}]`
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${workspaceV2CanonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('规范JSON只接受JSON值和安全整数')
}

export async function workspaceV2Sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export async function workspaceV2ScopeDigest(scopes: readonly string[]): Promise<string> {
  workspaceV2ScopesSchema.parse(scopes)
  return workspaceV2Sha256(utf8(workspaceV2CanonicalJson(scopes)))
}
export function workspaceV2Aad(value: { purpose: typeof WORKSPACE_V2_PURPOSES[number]; workspaceId: string; serviceId: string; deviceId: string; requestId: string; counter: number }, direction: 'request' | 'response'): string {
  return `workspace-v2\n${direction}\n${value.purpose}\n${value.workspaceId}\n${value.serviceId}\n${value.deviceId}\n${value.requestId}\n${value.counter}`
}
export function workspaceV2Path(value: typeof WORKSPACE_V2_PURPOSES[number]): string {
  return `/workspace/v2/${value.replace('.', '/')}`
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Base64格式无效')
  const binary = atob(value)
  if (btoa(binary) !== value) throw new Error('Base64编码不规范')
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}
function base64(maximum: number, exact?: number) {
  return z.string().min(1).max(Math.ceil(maximum / 3) * 4).refine(value => {
    try { const size = decodeBase64(value).length; return size <= maximum && (exact === undefined || size === exact) } catch { return false }
  })
}
export const workspaceV2EnvelopeSchema = z.object({
  ...identity, serviceId: uuid, purpose, requestId: uuid, counter: positive,
  nonce: base64(12, 12), ciphertext: base64(WORKSPACE_V2_LIMITS.metadataBytes), tag: base64(16, 16)
}).strict().refine(value => value.workspaceId === value.serviceId, '工作台与服务身份不匹配')
export type WorkspaceV2Envelope = z.infer<typeof workspaceV2EnvelopeSchema>

export const workspaceV2JsonRefSchema = z.object({ sha256: hash, byteLength: positive.max(WORKSPACE_V2_LIMITS.jsonBlobBytes), mediaType: z.literal('application/json') }).strict()
export const workspaceV2BlobRefSchema = z.object({ sha256: hash, byteLength: positive.max(WORKSPACE_V2_LIMITS.imageBlobBytes), mediaType }).strict().refine(value => value.mediaType !== 'application/json' || value.byteLength <= WORKSPACE_V2_LIMITS.jsonBlobBytes)
export const workspaceV2InlineSchema = z.object({ encoding: z.literal('json'), json: z.string().min(2).max(WORKSPACE_V2_LIMITS.inlineJsonBytes), sha256: hash, byteLength: positive.max(WORKSPACE_V2_LIMITS.inlineJsonBytes) }).strict().superRefine(async (value, ctx) => {
  const bytes = utf8(value.json)
  let object = false
  try { const decoded: unknown = JSON.parse(value.json); object = Boolean(decoded && typeof decoded === 'object' && !Array.isArray(decoded)) } catch { object = false }
  if (!object || bytes.length !== value.byteLength || await workspaceV2Sha256(bytes) !== value.sha256) ctx.addIssue({ code: 'custom', message: '原始JSON字节或摘要无效' })
})
export const workspaceV2PayloadSchema = z.discriminatedUnion('encoding', [workspaceV2InlineSchema, z.object({ encoding: z.literal('blob'), ref: workspaceV2JsonRefSchema }).strict()])
export type WorkspaceV2Payload = z.infer<typeof workspaceV2PayloadSchema>
export const workspaceV2MetadataSchema = z.object({
  scope, read: z.literal(true), write: z.boolean(), deletable: z.boolean(),
  editableFields: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/)).max(40).refine(values => new Set(values).size === values.length),
  source: z.enum(['manual', 'schedule']).nullable()
}).strict().superRefine((value, ctx) => {
  if ((!value.write && (value.deletable || value.editableFields.length)) || (value.scope === 'project.catalog' && value.write) || (value.scope !== 'todo.full' && value.source !== null)) ctx.addIssue({ code: 'custom', message: '只读或来源权限无效' })
})
export const workspaceV2RecordSchema = z.object({ kind, id: entityId, revision: positive, sequence: positive, deleted: z.boolean(), payload: workspaceV2PayloadSchema, metadata: workspaceV2MetadataSchema }).strict().refine(value => WORKSPACE_V2_KIND_SCOPE[value.kind] === value.metadata.scope, '记录范围不匹配')
export type WorkspaceV2Record = z.infer<typeof workspaceV2RecordSchema>
const snapshot = z.object({ deleted: z.boolean(), payload: workspaceV2PayloadSchema }).strict()
const recordOperation = z.object({ type: z.literal('record'), operationId: uuid, kind, id: entityId, localRevision: positive, baseRevision: integer, base: snapshot.nullable(), next: snapshot }).strict().superRefine((value, ctx) => {
  if ((value.baseRevision === 0) !== (value.base === null) || value.kind === 'project_catalog') ctx.addIssue({ code: 'custom', message: '同步基线或只读目录写入无效' })
})
const moveOperation = z.object({
  type: z.literal('todo.move'), operationId: uuid, localRevision: positive, baseRevision: integer,
  todoId: uuid, day: z.string().refine(isValidLocalDate), viewMode: z.enum(['all', 'time', 'category']),
  category: z.enum(['self_media', 'ai', 'life', 'other_work']).nullable(), segment: z.enum(['morning', 'afternoon', 'evening']).nullable(), beforeId: uuid.nullable(), afterId: uuid.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.beforeId === value.todoId || value.afterId === value.todoId || (value.beforeId !== null && value.beforeId === value.afterId) || (value.viewMode !== 'category' && value.category !== null) || (value.viewMode === 'category' && value.category === null) || (value.viewMode !== 'time' && value.segment !== null)) ctx.addIssue({ code: 'custom', message: '排序锚点或分组无效' })
})
export const workspaceV2OperationSchema = z.discriminatedUnion('type', [recordOperation, moveOperation])
export type WorkspaceV2Operation = z.infer<typeof workspaceV2OperationSchema>
const scoped = { scopes: workspaceV2ScopesSchema, scopeDigest: hash }
async function checkScopes(value: { scopes: WorkspaceV2Scope[]; scopeDigest: string }, ctx: z.RefinementCtx) {
  if (await workspaceV2Sha256(utf8(workspaceV2CanonicalJson(value.scopes))) !== value.scopeDigest) ctx.addIssue({ code: 'custom', message: '范围集合摘要无效' })
}
function checkBytes(value: unknown, ctx: z.RefinementCtx) {
  if (utf8(JSON.stringify(value)).length > WORKSPACE_V2_LIMITS.metadataBytes) ctx.addIssue({ code: 'custom', message: '请求或响应超过256KiB' })
}
export const workspaceV2SyncRequestSchema = z.object({ ...identity, ...scoped, cursor: integer, through: integer.nullable(), operations: z.array(workspaceV2OperationSchema).max(100) }).strict().superRefine(async (value, ctx) => {
  await checkScopes(value, ctx); checkBytes(value, ctx)
  if (value.through !== null && value.through < value.cursor) ctx.addIssue({ code: 'custom', message: '固定水位无效' })
  if (new Set(value.operations.map(operation => operation.operationId)).size !== value.operations.length) ctx.addIssue({ code: 'custom', message: '操作ID重复' })
  const targets = new Set<string>()
  for (const operation of value.operations) {
    const target = operation.type === 'record' ? `${operation.kind}:${operation.id}` : 'todo.move:order'
    const required: WorkspaceV2Scope[] = operation.type === 'record' ? [WORKSPACE_V2_KIND_SCOPE[operation.kind]] : ['preferences.todo', 'todo.full']
    if (targets.has(target) || required.some(scope => !value.scopes.includes(scope))) ctx.addIssue({ code: 'custom', message: '操作重复或超出范围' })
    targets.add(target)
  }
})
export const WORKSPACE_V2_REJECTION_CODES = ['project_unavailable', 'stage_unavailable', 'invalid_change', 'record_read_only'] as const
export const workspaceV2ReceiptSchema = z.discriminatedUnion('status', [
  z.object({ operationId: uuid, localRevision: positive, status: z.enum(['accepted', 'conflict']), record: workspaceV2RecordSchema }).strict(),
  z.object({
    operationId: uuid, localRevision: positive, status: z.literal('rejected'),
    target: z.object({ kind, id: entityId }).strict(), operationHash: hash,
    code: z.enum(WORKSPACE_V2_REJECTION_CODES), record: workspaceV2RecordSchema.nullable()
  }).strict().refine(value => value.record === null || (value.record.kind === value.target.kind && value.record.id === value.target.id), '拒绝回执的当前记录不匹配')
])
export type WorkspaceV2Receipt = z.infer<typeof workspaceV2ReceiptSchema>
export const workspaceV2SyncResponseSchema = z.object({ ...identity, ...scoped, receipts: z.array(workspaceV2ReceiptSchema).max(100), changes: z.array(workspaceV2RecordSchema).max(100), cursor: integer, through: integer, hasMore: z.boolean() }).strict().superRefine(async (value, ctx) => {
  await checkScopes(value, ctx); checkBytes(value, ctx)
  if (value.cursor > value.through || value.hasMore !== (value.cursor < value.through)) ctx.addIssue({ code: 'custom', message: '同步水位无效' })
  let previous = 0
  for (const record of value.changes) {
    if (record.sequence <= previous || record.sequence > value.cursor) ctx.addIssue({ code: 'custom', message: '变更序列无效' })
    previous = record.sequence
  }
  for (const record of [...value.changes, ...value.receipts.flatMap(receipt => receipt.record ? [receipt.record] : [])]) if (!value.scopes.includes(record.metadata.scope)) ctx.addIssue({ code: 'custom', message: '响应超出授权范围' })
  for (const receipt of value.receipts) if (receipt.status === 'rejected' && !value.scopes.includes(WORKSPACE_V2_KIND_SCOPE[receipt.target.kind])) ctx.addIssue({ code: 'custom', message: '拒绝回执超出授权范围' })
})
export const workspaceV2CapabilitiesRequestSchema = z.object({ ...identity, clientScopes: z.array(z.string().regex(/^[a-z][a-z_.]{0,39}$/)).max(32).refine(ordered) }).strict()
export const workspaceV2LimitsSchema = z.object({
  batchRecords: z.literal(100), metadataBytes: z.literal(262144), inlineJsonBytes: z.literal(16384), blobChunkBytes: z.literal(65536),
  jsonBlobBytes: z.literal(16777216), imageBlobBytes: z.literal(20971520), imagesPerRecord: z.literal(20), concurrentUploads: z.literal(2), concurrentDownloads: z.literal(2),
  deviceTemporaryBytes: z.literal(268435456), workspaceTemporaryBytes: z.literal(536870912), idleTtlSeconds: z.literal(86400), absoluteTtlSeconds: z.literal(604800), unreferencedTtlSeconds: z.literal(86400), previewMaxPixels: z.literal(2048)
}).strict()
export const workspaceV2CapabilitiesResponseSchema = z.object({ ...identity, schemaVersion: z.literal(1), supportedScopes: z.array(scope).max(8).refine(ordered), permissions: z.array(z.object({ scope, read: z.literal(true), write: z.boolean() }).strict()).max(8), limits: workspaceV2LimitsSchema }).strict().superRefine((value, ctx) => {
  if (value.supportedScopes.length !== value.permissions.length || value.permissions.some((grant, index) => grant.scope !== value.supportedScopes[index] || (grant.scope === 'project.catalog' && grant.write))) ctx.addIssue({ code: 'custom', message: '能力授权无效' })
})
export const workspaceV2SnapshotStartRequestSchema = z.object({ ...identity, ...scoped }).strict().superRefine(checkScopes)
export const workspaceV2ManifestSchema = z.object({ ...identity, ...scoped, manifestId: uuid, schemaVersion: z.literal(1), through: integer, entityCount: integer, entriesSha256: hash, expiresAt: timestamp }).strict().superRefine(checkScopes)
export const workspaceV2SnapshotPageRequestSchema = z.object({ ...identity, manifestId: uuid, after: pageToken.nullable(), limit: positive.max(100) }).strict()
export const workspaceV2SnapshotPageResponseSchema = z.object({ ...identity, manifestId: uuid, records: z.array(workspaceV2RecordSchema).max(100), next: pageToken.nullable(), done: z.boolean() }).strict().superRefine((value, ctx) => {
  checkBytes(value, ctx)
  if (value.done !== (value.next === null) || (!value.done && !value.records.length)) ctx.addIssue({ code: 'custom', message: '快照页未取得进展' })
})

export function workspaceV2PayloadHash(payload: WorkspaceV2Payload): string { return payload.encoding === 'json' ? payload.sha256 : payload.ref.sha256 }
export async function workspaceV2ManifestText(records: WorkspaceV2Record[]): Promise<string> {
  const lines: string[] = []
  let previous: WorkspaceV2Record | undefined
  for (const value of records) {
    const record = await workspaceV2RecordSchema.parseAsync(value)
    if (previous && (previous.kind > record.kind || (previous.kind === record.kind && previous.id >= record.id))) throw new Error('清单必须按kind/id排序且不重复')
    const metadataHash = await workspaceV2Sha256(utf8(workspaceV2CanonicalJson(record.metadata)))
    lines.push(workspaceV2CanonicalJson([record.kind, record.id, record.revision, record.sequence, record.deleted, workspaceV2PayloadHash(record.payload), metadataHash]))
    previous = record
  }
  return lines.join('')
}
export async function workspaceV2ManifestDigest(records: WorkspaceV2Record[]): Promise<string> { return workspaceV2Sha256(utf8(await workspaceV2ManifestText(records))) }
export async function workspaceV2VerifyManifest(manifest: z.infer<typeof workspaceV2ManifestSchema>, records: WorkspaceV2Record[]): Promise<void> {
  await workspaceV2ManifestSchema.parseAsync(manifest)
  if (records.length !== manifest.entityCount || records.some(record => record.sequence > manifest.through || !manifest.scopes.includes(record.metadata.scope)) || await workspaceV2ManifestDigest(records) !== manifest.entriesSha256) throw new Error('快照条目数、范围、水位或摘要无效')
}

export function workspaceV2ChunkLength(byteLength: number, index: number): number {
  positive.max(WORKSPACE_V2_LIMITS.imageBlobBytes).parse(byteLength); integer.parse(index)
  if (index >= Math.ceil(byteLength / WORKSPACE_V2_LIMITS.blobChunkBytes)) throw new Error('分块索引越界')
  return Math.min(WORKSPACE_V2_LIMITS.blobChunkBytes, byteLength - index * WORKSPACE_V2_LIMITS.blobChunkBytes)
}
export const workspaceV2BlobStartRequestSchema = z.object({ ...identity, uploadId: uuid, scope, entity: z.object({ kind, id: entityId }).strict(), purpose: z.enum(['document', 'image']), sha256: hash, byteLength: positive.max(WORKSPACE_V2_LIMITS.imageBlobBytes), mediaType }).strict().superRefine((value, ctx) => {
  if (WORKSPACE_V2_KIND_SCOPE[value.entity.kind] !== value.scope || value.scope === 'project.catalog' || (value.purpose === 'document' ? value.mediaType !== 'application/json' || value.byteLength > WORKSPACE_V2_LIMITS.jsonBlobBytes : value.scope !== 'review.file' || !imageMedia.safeParse(value.mediaType).success)) ctx.addIssue({ code: 'custom', message: '上传范围、类型或大小无效' })
})
export const workspaceV2BlobSessionSchema = z.object({ ...identity, sessionId: uuid, chunkBytes: z.literal(65536), receivedIndexes: uniqueIndexes, expiresAt: timestamp }).strict()
export const workspaceV2BlobStatusRequestSchema = z.object({ ...identity, sessionId: uuid }).strict()
export const workspaceV2BlobChunkRequestSchema = z.object({ ...identity, sessionId: uuid, index: integer.max(319), sha256: hash, bytesBase64: base64(65536) }).strict().superRefine(async (value, ctx) => {
  try {
    if (await workspaceV2Sha256(decodeBase64(value.bytesBase64)) !== value.sha256) ctx.addIssue({ code: 'custom', message: '分块摘要无效' })
  } catch { ctx.addIssue({ code: 'custom', message: '分块编码无效' }) }
})
export const workspaceV2BlobChunkAckSchema = z.object({ ...identity, sessionId: uuid, index: integer.max(319), sha256: hash, byteLength: positive.max(65536) }).strict()
export const workspaceV2BlobCommitRequestSchema = z.object({ ...identity, sessionId: uuid, sha256: hash, byteLength: positive.max(20971520) }).strict()
export const workspaceV2BlobCommitResponseSchema = z.object({ ...identity, sessionId: uuid, ref: workspaceV2BlobRefSchema }).strict()
export const workspaceV2BlobReadRequestSchema = z.object({ ...identity, record: z.object({ kind, id: entityId, revision: positive, manifestId: uuid.optional() }).strict(), sha256: hash, index: integer.max(319) }).strict()
export const workspaceV2BlobReadResponseSchema = z.object({ ...identity, sha256: hash, byteLength: positive.max(20971520), index: integer.max(319), chunkSha256: hash, bytesBase64: base64(65536) }).strict().superRefine(async (value, ctx) => {
  try {
    const bytes = decodeBase64(value.bytesBase64)
    if (workspaceV2ChunkLength(value.byteLength, value.index) !== bytes.length || await workspaceV2Sha256(bytes) !== value.chunkSha256) ctx.addIssue({ code: 'custom', message: '下载分块长度或摘要无效' })
  } catch { ctx.addIssue({ code: 'custom', message: '下载分块编码或索引无效' }) }
})
export function workspaceV2AssertChunk(byteLength: number, index: number, bytes: Uint8Array): void {
  if (bytes.length !== workspaceV2ChunkLength(byteLength, index)) throw new Error('分块长度不匹配')
}
export function workspaceV2CheckUploadBudget(input: { declaredBytes: number; deviceReservedBytes: number; workspaceReservedBytes: number; activeUploads: number }): boolean {
  for (const value of Object.values(input)) integer.parse(value)
  return input.declaredBytes > 0 && input.declaredBytes <= WORKSPACE_V2_LIMITS.imageBlobBytes && input.activeUploads < WORKSPACE_V2_LIMITS.concurrentUploads && input.deviceReservedBytes <= WORKSPACE_V2_LIMITS.deviceTemporaryBytes - input.declaredBytes && input.workspaceReservedBytes <= WORKSPACE_V2_LIMITS.workspaceTemporaryBytes - input.declaredBytes
}
export function workspaceV2SessionExpiry(createdAtMs: number, lastActivityMs: number): number {
  integer.parse(createdAtMs); integer.parse(lastActivityMs)
  if (lastActivityMs < createdAtMs) throw new Error('会话时间无效')
  const expiry = Math.min(createdAtMs + WORKSPACE_V2_LIMITS.absoluteTtlSeconds * 1000, lastActivityMs + WORKSPACE_V2_LIMITS.idleTtlSeconds * 1000)
  integer.parse(expiry); return expiry
}
export function workspaceV2AssertEnvelopeBody(envelope: WorkspaceV2Envelope, body: { protocolVersion: number; workspaceId: string; deviceId: string }): void {
  workspaceV2EnvelopeSchema.parse(envelope)
  if (body.protocolVersion !== 2 || body.workspaceId !== envelope.workspaceId || body.deviceId !== envelope.deviceId) throw new Error('密文正文身份不匹配')
}

export function workspaceV2AssertResponseEnvelope(request: unknown, response: unknown): void {
  const sent = workspaceV2EnvelopeSchema.parse(request)
  const received = workspaceV2EnvelopeSchema.parse(response)
  for (const key of ['protocolVersion', 'workspaceId', 'serviceId', 'deviceId', 'purpose', 'requestId', 'counter'] as const) {
    if (sent[key] !== received[key]) throw new Error('响应密文不属于当前请求')
  }
}
export function workspaceV2AssertCapabilities(request: unknown, response: unknown, approvedPermissions: readonly { scope: WorkspaceV2Scope; read: true; write: boolean }[]): void {
  const sent = workspaceV2CapabilitiesRequestSchema.parse(request)
  const received = workspaceV2CapabilitiesResponseSchema.parse(response)
  const approved = z.array(z.object({ scope, read: z.literal(true), write: z.boolean() }).strict()).max(8).refine(values => new Set(values.map(value => value.scope)).size === values.length).parse(approvedPermissions)
  if (sent.workspaceId !== received.workspaceId || sent.deviceId !== received.deviceId) throw new Error('能力响应身份不匹配')
  for (const permission of received.permissions) {
    const trusted = approved.find(value => value.scope === permission.scope)
    if (!sent.clientScopes.includes(permission.scope) || !trusted || (permission.write && !trusted.write)) throw new Error('能力范围尚未获准')
  }
}
export async function workspaceV2AssertSyncResponse(request: unknown, response: unknown): Promise<void> {
  const sent = await workspaceV2SyncRequestSchema.parseAsync(request)
  const received = await workspaceV2SyncResponseSchema.parseAsync(response)
  if (sent.workspaceId !== received.workspaceId || sent.deviceId !== received.deviceId || sent.scopeDigest !== received.scopeDigest || workspaceV2CanonicalJson(sent.scopes) !== workspaceV2CanonicalJson(received.scopes)) throw new Error('同步响应身份或范围不匹配')
  if ((sent.through !== null && sent.through !== received.through) || received.cursor < sent.cursor || received.changes.some(record => record.sequence <= sent.cursor)) throw new Error('同步响应水位不匹配')
  if (received.receipts.length !== sent.operations.length) throw new Error('同步回执缺失或多余')
  if (received.hasMore && received.cursor === sent.cursor && received.receipts.length === 0) throw new Error('同步分页未取得进展')
  const acknowledged = new Set<string>()
  for (const receipt of received.receipts) {
    const operation = sent.operations.find(value => value.operationId === receipt.operationId)
    if (!operation || receipt.localRevision !== operation.localRevision || acknowledged.has(receipt.operationId)) throw new Error('同步回执不属于当前操作')
    if (receipt.status === 'rejected') {
      const target = operation.type === 'record' ? { kind: operation.kind, id: operation.id } : { kind: 'todo_preferences', id: 'workspace' }
      if (receipt.target.kind !== target.kind || receipt.target.id !== target.id ||
        receipt.operationHash !== await workspaceV2OperationHash(operation) ||
        (receipt.record === null ? operation.baseRevision !== 0 : receipt.record.revision < operation.baseRevision)) throw new Error('拒绝回执与在途操作不匹配')
    } else if (operation.type === 'record') {
      if (receipt.record.kind !== operation.kind || receipt.record.id !== operation.id || (receipt.status === 'accepted' && receipt.record.revision < operation.baseRevision)) throw new Error('同步回执记录不匹配')
    } else if (receipt.record.kind !== 'todo_preferences' || receipt.record.id !== 'workspace') throw new Error('排序回执记录不匹配')
    acknowledged.add(receipt.operationId)
  }
}

export async function workspaceV2OperationHash(operation: WorkspaceV2Operation): Promise<string> {
  await workspaceV2OperationSchema.parseAsync(operation)
  return workspaceV2Sha256(utf8(workspaceV2CanonicalJson(operation)))
}
