import { WorkspaceV2BlobStore } from '../../src/main/db/workspace-sync-v2-blobs'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { WorkspaceV2DomainRejection } from '../../src/main/db/workspace-sync-v2-errors'
import { WorkspaceSyncV2Service, deriveWorkspaceV2Key, type WorkspaceV2Purpose } from '../../src/main/workspace-sync-v2-service'
import * as wire from '../../src/shared/workspace-sync-v2'
import { workspaceDomainV2Inspect } from '../../src/shared/workspace-domain-v2'
import { WORKSPACE_V2_PAGE_JSON_BYTES } from '../../src/main/db/workspace-sync-v2-page-budget'

const stores: WorkspaceStore[] = [], dirs: string[] = []
const protector = { isAvailable: () => true, encrypt: (value: string) => value, decrypt: (value: string) => value }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const payload = (body: object): wire.WorkspaceV2Payload => { const json = JSON.stringify(body); return { encoding: 'json', json, sha256: sha(json), byteLength: Buffer.byteLength(json) } }
const createBody = (changes = {}) => ({ title: '写500字', category: 'self_media', isExtra: false, plannedDate: '2026-10-03', segment: null, dateRange: null, projectId: 'ios', stageKey: 'script', status: 'open', trackingMode: 'progress', progress: 37, progressBeforeComplete: null, completedAt: null, ...changes })
function createOperation(body = createBody(), id: string = randomUUID(), kind: 'todo' | 'work_log' = 'todo'): wire.WorkspaceV2Operation {
  return { type: 'record', operationId: randomUUID(), localRevision: 1, kind, id, baseRevision: 0, base: null, next: { deleted: false, payload: payload(body) } }
}
const bodyOf = (record: wire.WorkspaceV2Record): Record<string, unknown> => {
  if (record.payload.encoding !== 'json') throw new Error('Expected inline')
  return JSON.parse(record.payload.json)
}
function updateOperation(record: wire.WorkspaceV2Record, changes: object, deleted = false): wire.WorkspaceV2Operation {
  return { type: 'record', operationId: randomUUID(), localRevision: record.revision + 1, kind: record.kind, id: record.id, baseRevision: record.revision, base: { deleted: record.deleted, payload: record.payload }, next: { deleted, payload: deleted ? record.payload : payload({ ...bodyOf(record), ...changes }) } }
}
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'workspace-v2-write-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store)
  const domain = store.repository, deviceId = randomUUID(), workspaceId = domain.getOrCreateMobileSyncServiceId(), secret = randomBytes(32), changed = vi.fn()
  domain.trustMobileSyncDevice({ id: deviceId, name: '写入测试', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const service = new WorkspaceSyncV2Service(domain, protector, Date.now, changed), repository = service.repository
  const scopes: wire.WorkspaceV2Scope[] = ['preferences.todo', 'project.catalog', 'todo.full', 'work_log'], scoped = { scopes, scopeDigest: await wire.workspaceV2ScopeDigest(scopes) }
  repository.setDeviceGrants(deviceId, scopes.map(scope => ({ scope, write: true })))
  let counter = 0
  const call = async (purpose: WorkspaceV2Purpose, extra: object) => {
    const request = { protocolVersion: 2, workspaceId, deviceId, ...extra }
    const base = { protocolVersion: 2 as const, workspaceId, serviceId: workspaceId, deviceId, purpose, requestId: randomUUID(), counter: ++counter }
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', deriveWorkspaceV2Key(secret, workspaceId), nonce)
    cipher.setAAD(Buffer.from(wire.workspaceV2Aad(base, 'request')))
    const envelope = { ...base, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(JSON.stringify(request)), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }
    const encrypted = await service.handle(purpose, envelope)
    wire.workspaceV2AssertResponseEnvelope(envelope, encrypted)
    const decipher = createDecipheriv('aes-256-gcm', deriveWorkspaceV2Key(secret, workspaceId), Buffer.from(encrypted.nonce, 'base64'))
    decipher.setAAD(Buffer.from(wire.workspaceV2Aad(envelope, 'response'))); decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    const response = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8'))
    if (purpose === 'sync') await wire.workspaceV2AssertSyncResponse(request as never, response)
    return response
  }
  const sync = (operations: wire.WorkspaceV2Operation[], cursor = 0, through: number | null = null) => call('sync', { ...scoped, operations, cursor, through })
  const latest = (id: string, kind: wire.WorkspaceV2Kind = 'todo') => repository.latest(kind, id, deviceId)!
  return { domain, deviceId, service, repository, scoped, call, sync, latest, changed }
}
function declaredDocumentRecords(context: Awaited<ReturnType<typeof setup>>, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todo = context.domain.importWorkspaceTodoV2(randomUUID(), createBody({ title: `Budget fixture ${index}` }))
    const initial = context.latest(todo.id), body = bodyOf(initial)
    context.domain.native.prepare('UPDATE workspace_v2_hashes SET byte_length=? WHERE sequence=?').run(wire.WORKSPACE_V2_LIMITS.jsonBlobBytes, initial.sequence)
    return { record: context.latest(todo.id), body }
  })
}
function declaredPageBytes(records: wire.WorkspaceV2Record[]): number {
  return [...new Map(records.flatMap(record => record.payload.encoding === 'blob' ? [[record.payload.ref.sha256, record.payload.ref.byteLength] as const] : [])).values()].reduce((sum, bytes) => sum + bytes, 0)
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

describe('workspace v2 controlled domain writes', () => {
  it('advertises four actual scopes and never grants directory or preferences writes', async () => {
    const { call } = await setup()
    const caps = await call('capabilities', { clientScopes: [...wire.WORKSPACE_V2_SCOPES] })
    expect(caps.permissions).toEqual([{ scope: 'preferences.todo', read: true, write: false }, { scope: 'project.catalog', read: true, write: false }, { scope: 'todo.full', read: true, write: true }, { scope: 'work_log', read: true, write: true }])
  })
  it('creates37, keeps offline67 undo state and one final event without completing the stage', async () => {
    const { sync, domain, latest, changed } = await setup()
    const operation = createOperation(), stageBefore = domain.getTodoProjectStages('ios')
    const first = await sync([operation]), record = first.receipts[0].record as wire.WorkspaceV2Record
    expect(bodyOf(record)).toMatchObject({ progress: 37, progressBeforeComplete: null, status: 'open' })
    expect(record.sequence).toBeGreaterThan(first.through)
    const next = updateOperation(record, { progress: 67, progressBeforeComplete: 67 })
    await sync([next]); await sync([next])
    expect(bodyOf(latest(record.id))).toMatchObject({ progress: 67, progressBeforeComplete: 67, status: 'open', completedAt: null })
    expect(domain.native.prepare('SELECT action FROM todo_events WHERE todo_id=? ORDER BY rowid').all(record.id)).toEqual([{ action: 'created' }, { action: 'progressed' }])
    expect(domain.getTodoProjectStages('ios')).toEqual(stageBefore)
    expect(changed).toHaveBeenCalledTimes(2)
  })
  it('preserves completed microseconds, pb67 undo and exact old float and untrimmed range on title-only edits', async () => {
    const { sync, domain, latest } = await setup()
    const record = (await sync([createOperation()])).receipts[0].record as wire.WorkspaceV2Record
    const time = '2026-10-03T01:02:03.123456Z'
    await sync([updateOperation(record, { status: 'completed', progress: 100, progressBeforeComplete: 67, completedAt: time })])
    expect(bodyOf(latest(record.id)).completedAt).toBe(time)
    await sync([updateOperation(latest(record.id), { status: 'open', progress: 67, completedAt: null })])
    expect(bodyOf(latest(record.id)).progressBeforeComplete).toBe(67)
    const range = '{ "startDate":"2026-10-01", "endDate":"2026-10-05", "name":"  历史  " }'
    domain.native.prepare('UPDATE todo_items SET progress=37.5,date_range_json=?,planned_date=NULL,segment=NULL WHERE id=?').run(range, record.id)
    domain.setProjectLifecycle('ios', 'archived')
    domain.native.prepare("UPDATE project_modules SET enabled=0 WHERE project_id='ios' AND module_key='script'").run()
    await sync([updateOperation(latest(record.id), { title: '仅改标题' })])
    expect(domain.native.prepare('SELECT progress,progress_before_complete,date_range_json,project_id,stage_key FROM todo_items WHERE id=?').get(record.id)).toEqual({ progress: 37.5, progress_before_complete: 67, date_range_json: range, project_id: 'ios', stage_key: 'script' })
  })
  it('merges disjoint fields but conflicts within completion/date/project groups', async () => {
    const { sync, domain, latest } = await setup()
    const record = (await sync([createOperation()])).receipts[0].record as wire.WorkspaceV2Record
    domain.updateTodoItem(record.id, { category: 'life' })
    expect((await sync([updateOperation(record, { title: '手机标题' })])).receipts[0].status).toBe('accepted')
    expect(bodyOf(latest(record.id))).toMatchObject({ title: '手机标题', category: 'life' })
    for (const [local, remote] of [[{ progress: 67 }, { progress: 80 }], [{ plannedDate: '2026-10-04' }, { segment: 'evening' }], [{ stageKey: 'materials' }, { stageKey: 'shooting' }]]) {
      const base = latest(record.id); domain.updateTodoItem(record.id, remote as never)
      expect((await sync([updateOperation(base, local!)])).receipts[0].status).toBe('conflict')
    }
  })
  it('freezes terminal project/stage rejection, forbids reused operation IDs and records no rejected domain data', async () => {
    const { sync, domain, latest } = await setup()
    domain.setProjectLifecycle('ios', 'archived')
    const operation = createOperation(), rejected = (await sync([operation])).receipts[0]
    expect(rejected).toMatchObject({ status: 'rejected', code: 'project_unavailable', record: null, operationHash: sha(wire.workspaceV2CanonicalJson(operation)) })
    expect(latest((operation as { id: string }).id)).toBeNull()
    domain.setProjectLifecycle('ios', 'project_created')
    expect((await sync([operation])).receipts[0]).toEqual(rejected)
    expect((await sync([{ ...operation, operationId: randomUUID() }])).receipts[0].status).toBe('accepted')
    await expect(sync([{ ...operation, localRevision: 2 }])).rejects.toMatchObject({ code: 'operation_reused' })
    domain.native.prepare("UPDATE project_modules SET enabled=0 WHERE project_id='ios' AND module_key='script'").run()
    expect((await sync([createOperation()])).receipts[0]).toMatchObject({ status: 'rejected', code: 'stage_unavailable' })
  })
  it('rolls back every rejected savepoint while committing other operations, then retries the original receipt', async () => {
    const { sync, domain } = await setup(), original = domain.importWorkspaceTodoV2.bind(domain)
    const broken = createOperation(createBody({ title: '模拟失败' })), good = createOperation(createBody({ title: '正常保存' }))
    const spy = vi.spyOn(domain, 'importWorkspaceTodoV2').mockImplementation((id, body) => { const created = original(id, body); if (body.title === '模拟失败') throw new WorkspaceV2DomainRejection('invalid_change'); return created })
    const result = await sync([broken, good]); spy.mockRestore()
    expect(result.receipts.map((item: wire.WorkspaceV2Receipt) => item.status)).toEqual(['rejected', 'accepted'])
    expect(domain.native.prepare('SELECT 1 FROM todo_items WHERE id=?').get((broken as { id: string }).id)).toBeUndefined()
    expect(domain.native.prepare('SELECT 1 FROM todo_events WHERE todo_id=?').get((broken as { id: string }).id)).toBeUndefined()
    expect(domain.native.prepare("SELECT 1 FROM workspace_v2_changes WHERE kind='todo' AND entity_id=?").get((broken as { id: string }).id)).toBeUndefined()
    expect((await sync([broken, good])).receipts).toEqual(result.receipts)
  })
  it('rejects forged raw baselines and immutable fields and never revives a deleted todo', async () => {
    const { sync, latest } = await setup(), record = (await sync([createOperation()])).receipts[0].record as wire.WorkspaceV2Record
    const forged = updateOperation(record, { title: 'B' }) as Extract<wire.WorkspaceV2Operation, { type: 'record' }>
    forged.base!.payload = payload({ ...bodyOf(record), title: '伪造基线' })
    await expect(sync([forged])).rejects.toMatchObject({ code: 'invalid_base' })
    expect((await sync([updateOperation(record, { updatedAt: '伪造时间' })])).receipts[0]).toMatchObject({ status: 'rejected', code: 'invalid_change' })
    const smuggle = updateOperation(record, {}, true) as Extract<wire.WorkspaceV2Operation, { type: 'record' }>
    const raw = JSON.stringify(bodyOf(record), null, 1)
    smuggle.next.payload = { encoding: 'json', json: raw, sha256: sha(raw), byteLength: Buffer.byteLength(raw) }
    expect(smuggle.next.payload).not.toEqual(smuggle.base!.payload)
    expect((await sync([smuggle])).receipts[0].status).toBe('rejected')
    await sync([updateOperation(record, {}, true)])
    expect(latest(record.id).deleted).toBe(true)
    expect((await sync([updateOperation(record, { title: '复活' })])).receipts[0].status).toBe('conflict')
  })
  it('keeps 0 distinct from first-clear tombstones and preserves categories until explicit deletion', async () => {
    const { sync, domain, latest } = await setup(), day = '2026-10-06'
    const clear = createOperation({ day, totalMinutes: null } as never, day, 'work_log') as Extract<wire.WorkspaceV2Operation, { type: 'record' }>; clear.next.deleted = true
    expect((await sync([clear])).receipts[0].record).toMatchObject({ deleted: true, revision: 1 })
    expect(bodyOf(latest(day, 'work_log'))).toEqual({ day, totalMinutes: null, selfMediaMinutes: 0, aiMinutes: 0, otherWorkMinutes: 0, updatedAt: '' })
    await sync([updateOperation(latest(day, 'work_log'), { totalMinutes: 0 })])
    expect(latest(day, 'work_log').deleted).toBe(false); expect(domain.getDailyWorkLog(day).totalMinutes).toBe(0)
    domain.setDailyWorkLog(day, { selfMediaMinutes: 1440, aiMinutes: 1440, otherWorkMinutes: 1440 })
    const record = latest(day, 'work_log'); await sync([updateOperation(record, { totalMinutes: 60 })])
    expect(domain.getDailyWorkLog(day)).toMatchObject({ totalMinutes: 60, selfMediaMinutes: 1440, aiMinutes: 1440, otherWorkMinutes: 1440 })
    expect((await sync([updateOperation(record, { totalMinutes: 60 })])).receipts[0].status).toBe('conflict')
    await sync([updateOperation(latest(day, 'work_log'), {}, true)])
    await sync([updateOperation(latest(day, 'work_log'), { totalMinutes: 0 })])
    expect(domain.getDailyWorkLog(day)).toMatchObject({ totalMinutes: 0, selfMediaMinutes: 0, aiMinutes: 0, otherWorkMinutes: 0 })
  })
  it('projects narrow catalog and preferences atomically without private or learning-only revisions', async () => {
    const { domain, latest } = await setup(), catalog = bodyOf(latest('ios', 'project_catalog'))
    expect(Object.keys(catalog).sort()).toEqual(['id', 'title', 'status', 'topicStageRole', 'trashedAt', 'ledgerOnly', 'stages'].sort())
    const stages = domain.getTodoProjectStages('ios').map(({ key, enabled, completedAt, status, revision }) => ({ key, enabled, completedAt, status, revision }))
    expect(catalog.stages).toEqual(stages)
    const prefBefore = latest('workspace', 'todo_preferences')
    domain.setPreferences({ todoCategoryMemories: [{ title: '记忆', normalizedTitle: '记忆', category: 'life', projectId: null, updatedAt: '2026-10-03T00:00:00Z' }] })
    expect(latest('workspace', 'todo_preferences')).toEqual(prefBefore)
    domain.setPreferences({ companionTodoView: 'category' })
    expect(latest('workspace', 'todo_preferences').revision).toBe(prefBefore.revision + 1)
    const before = latest('ios', 'project_catalog')
    expect(() => domain.native.transaction(() => { domain.native.prepare("UPDATE projects SET title='rollback' WHERE id='ios'").run(); throw Error('rollback') })()).toThrow()
    expect(latest('ios', 'project_catalog')).toEqual(before)
    domain.native.prepare("UPDATE project_modules SET enabled=0 WHERE project_id='ios' AND module_key='script'").run()
    expect(latest('ios', 'project_catalog').revision).toBeGreaterThan(before.revision)
  })
  it('uploads large changed JSON in exact chunks and only publishes the accepted full historical reference', async () => {
    const { sync, call, domain, latest } = await setup()
    const initial = (await sync([createOperation()])).receipts[0].record as wire.WorkspaceV2Record
    domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('字'.repeat(80000), initial.id)
    const base = latest(initial.id), rawBody = JSON.parse((domain.native.prepare("SELECT payload_json FROM workspace_v2_changes WHERE kind='todo' AND entity_id=? ORDER BY revision DESC LIMIT 1").get(initial.id) as { payload_json: string }).payload_json)
    const bytes = Buffer.from(JSON.stringify({ ...rawBody, category: 'life' })), hash = sha(bytes)
    const declaration = { uploadId: randomUUID(), scope: 'todo.full', entity: { kind: 'todo', id: initial.id }, purpose: 'document', sha256: hash, byteLength: bytes.length, mediaType: 'application/json' }
    const session = await call('blob.start', declaration)
    expect((await call('blob.start', declaration)).sessionId).toBe(session.sessionId)
    for (let index = Math.ceil(bytes.length / 65536) - 1; index >= 0; index--) {
      const chunk = bytes.subarray(index * 65536, (index + 1) * 65536)
      await call('blob.chunk', { sessionId: session.sessionId, index, sha256: sha(chunk), bytesBase64: chunk.toString('base64') })
    }
    const committed = await call('blob.commit', { sessionId: session.sessionId, sha256: hash, byteLength: bytes.length })
    const operation: wire.WorkspaceV2Operation = { type: 'record', operationId: randomUUID(), localRevision: 3, kind: 'todo', id: initial.id, baseRevision: base.revision, base: { deleted: false, payload: base.payload }, next: { deleted: false, payload: { encoding: 'blob', ref: committed.ref } } }
    const record = (await sync([operation])).receipts[0].record as wire.WorkspaceV2Record
    expect(record.payload.encoding).toBe('blob')
    expect(domain.native.prepare('SELECT consumed_at FROM workspace_v2_uploads WHERE id=?').get(session.sessionId)).toEqual({ consumed_at: expect.any(Number) })
    expect((await call('blob.commit', { sessionId: session.sessionId, sha256: hash, byteLength: bytes.length })).ref).toEqual(committed.ref)
    expect((await sync([operation])).receipts[0].record).toEqual(record)
    const ref = record.payload.encoding === 'blob' ? record.payload.ref : null
    const chunks: Buffer[] = []
    for (let index = 0; index < Math.ceil(ref!.byteLength / 65536); index++) {
      const response = await call('blob.read', { record: { kind: 'todo', id: record.id, revision: record.revision }, sha256: ref!.sha256, index })
      chunks.push(Buffer.from(response.bytesBase64, 'base64'))
    }
    const downloaded = Buffer.concat(chunks)
    expect(sha(downloaded)).toBe(ref!.sha256)
    expect(JSON.parse(downloaded.toString('utf8'))).toMatchObject({ title: rawBody.title, category: 'life' })
    await expect(call('blob.read', { record: { kind: 'todo', id: record.id, revision: record.revision }, sha256: hash, index: 0 })).rejects.toMatchObject({ code: 'blob_not_referenced' })
  })

  it('rolls back all operations, receipts and counter for unknown failures and oversized receipts', async () => {
    const { sync, domain, deviceId } = await setup(), original = domain.importWorkspaceTodoV2.bind(domain)
    const first = createOperation(), second = createOperation()
    const spy = vi.spyOn(domain, 'importWorkspaceTodoV2').mockImplementation((id, body) => { const created = original(id, body); if (id === (second as { id: string }).id) throw new Error('未知故障'); return created })
    await expect(sync([first, second])).rejects.toThrow('未知故障'); spy.mockRestore()
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_receipts WHERE device_id=?').get(deviceId)).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT 1 FROM workspace_v2_devices WHERE device_id=?').get(deviceId)).toBeUndefined()
    expect(domain.native.prepare('SELECT 1 FROM todo_items WHERE id=?').get((first as { id: string }).id)).toBeUndefined()
    const todos = domain.createTodoItems(Array.from({ length: 30 }, () => ({ title: '旧标题', plannedDate: null, segment: null, category: 'life', projectId: null, trackingMode: 'checklist', progress: 0 })))
    for (const todo of todos) domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('x'.repeat(9000), todo.id)
    const operations = todos.map(todo => createOperation(createBody(), todo.id))
    await expect(sync(operations)).rejects.toMatchObject({ status: 413 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_receipts WHERE device_id=?').get(deviceId)).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT 1 FROM workspace_v2_devices WHERE device_id=?').get(deviceId)).toBeUndefined()
    expect((await sync(operations.slice(0, 10))).receipts.every((receipt: wire.WorkspaceV2Receipt) => receipt.status === 'conflict')).toBe(true)
  })

  it('captures a complete catalog tombstone before module cascades and does not leak connection preferences', async () => {
    const { domain, latest } = await setup(), id = 'catalog-delete-test'
    const type = (domain.native.prepare('SELECT id FROM content_types LIMIT 1').get() as { id: string }).id
    domain.native.prepare("INSERT INTO projects(id,title,content_type_id,status,project_color_token,created_at,updated_at) VALUES(?,?,?,'producing','project-1','2026-10-03','2026-10-03')").run(id, '目录', type)
    domain.native.prepare("INSERT INTO project_modules(project_id,module_key,enabled,position,last_changed_by,content_root_id) VALUES(?,'script',1,1,'manual','private-root')").run(id)
    const before = latest(id, 'project_catalog')
    domain.native.prepare('DELETE FROM projects WHERE id=?').run(id)
    const after = latest(id, 'project_catalog')
    expect(after.deleted).toBe(true); expect(bodyOf(after)).toEqual(bodyOf(before))
    const pref = latest('workspace', 'todo_preferences')
    domain.native.prepare("UPDATE preferences SET value_json=json_set(value_json,'$.privateConnection','secret-not-exported') WHERE key='workspace'").run()
    expect(latest('workspace', 'todo_preferences')).toEqual(pref)
  })

  it('rejects new associations to an uninterpretable future project lifecycle', async () => {
    const { domain, sync } = await setup()
    domain.native.prepare("UPDATE projects SET status='future-lifecycle' WHERE id='ios'").run()
    expect((await sync([createOperation()])).receipts[0]).toMatchObject({ status: 'rejected', code: 'project_unavailable', record: null })
  })

  it('preserves old preference decimals, out-of-range and nonfinite values across unrelated learning saves', async () => {
    const { domain, latest } = await setup()
    domain.native.prepare("UPDATE preferences SET value_json=json_set(value_json,'$.todoCategoryWeights',json(?)) WHERE key='workspace'").run('{"self_media":37.5,"ai":-10,"life":150,"other_work":1e400}')
    const before = latest('workspace', 'todo_preferences'), body = bodyOf(before)
    expect(body.todoCategoryWeights).toEqual({ self_media: 37.5, ai: -10, life: 150, other_work: Infinity })
    domain.setPreferences({ todoCategoryMemories: [{ title: '新记忆', normalizedTitle: '新记忆', category: 'life', projectId: null, updatedAt: '2026-10-03T00:00:00Z' }] })
    expect(latest('workspace', 'todo_preferences')).toEqual(before)
  })

  it('expires consumed JSON retry chunks while retaining upload IDs and the durable domain history', async () => {
    const { domain, deviceId, repository } = await setup()
    let clock = Date.parse('2026-10-03T00:00:00Z')
    const blobs = new WorkspaceV2BlobStore(domain.native, Buffer.alloc(32, 7), (device, scope, write) => repository.authorize(device, scope, write), () => clock)
    const id = randomUUID(), bytes = Buffer.from(JSON.stringify(createBody())), hash = sha(bytes)
    const request = { protocolVersion: 2 as const, workspaceId: repository.workspaceId, deviceId, uploadId: randomUUID(), scope: 'todo.full' as const, entity: { kind: 'todo' as const, id }, purpose: 'document' as const, sha256: hash, byteLength: bytes.length, mediaType: 'application/json' as const }
    const session = blobs.start(request); blobs.chunk(deviceId, session.sessionId, 0, hash, bytes); blobs.commit(deviceId, session.sessionId, hash, bytes.length)
    expect(() => domain.native.transaction(() => { blobs.consumeJson(deviceId, session.sessionId); throw Error('rollback') })()).toThrow()
    expect(domain.native.prepare('SELECT consumed_at FROM workspace_v2_uploads WHERE id=?').get(session.sessionId)).toEqual({ consumed_at: null })
    domain.native.transaction(() => { domain.importWorkspaceTodoV2(id, createBody()); blobs.consumeJson(deviceId, session.sessionId) })()
    const record = repository.latest('todo', id, deviceId)!
    domain.native.prepare('UPDATE workspace_v2_uploads SET byte_length=? WHERE id=?').run(wire.WORKSPACE_V2_LIMITS.deviceTemporaryBytes, session.sessionId)
    expect(() => blobs.start({ ...request, uploadId: randomUUID() })).toThrow('暂存空间不足')
    domain.native.prepare('UPDATE workspace_v2_uploads SET byte_length=? WHERE id=?').run(bytes.length, session.sessionId)
    clock += (wire.WORKSPACE_V2_LIMITS.unreferencedTtlSeconds - 1) * 1000; blobs.cleanup()
    expect(blobs.status(deviceId, session.sessionId).receivedIndexes).toEqual([0])
    clock += 1001; blobs.cleanup()
    expect(domain.native.prepare('SELECT 1 FROM workspace_v2_uploads WHERE id=?').get(session.sessionId)).toBeUndefined()
    expect(domain.native.prepare('SELECT 1 FROM workspace_v2_chunks WHERE session_id=?').get(session.sessionId)).toBeUndefined()
    expect(() => blobs.start(request)).toThrow('过期')
    for (const action of [() => blobs.status(deviceId, session.sessionId), () => blobs.chunk(deviceId, session.sessionId, 0, hash, bytes), () => blobs.commit(deviceId, session.sessionId, hash, bytes.length), () => blobs.committedJson(deviceId, request.entity, { sha256: hash, byteLength: bytes.length, mediaType: 'application/json' })]) {
      expect(action).toThrow(expect.objectContaining({ code: 'blob_expired', status: 410 }))
    }
    expect(() => blobs.status(randomUUID(), session.sessionId)).toThrow(expect.objectContaining({ code: 'blob_denied', status: 403 }))
    expect(() => blobs.status(deviceId, randomUUID())).toThrow(expect.objectContaining({ code: 'blob_denied', status: 403 }))
    expect(repository.latest('todo', id, deviceId)).toEqual(record)
  })

  it('keeps original unsafe numeric tokens in readonly preference history and unrelated saves', async () => {
    const { domain, latest } = await setup()
    const weights = '{"self_media":9007199254740993,"life":37.5,"ai":1e400,"other_work":-150}'
    domain.native.prepare("UPDATE preferences SET value_json=json_set(value_json,'$.todoCategoryWeights',json(?)) WHERE key='workspace'").run(weights)
    const before = latest('workspace', 'todo_preferences')
    if (before.payload.encoding !== 'json') throw Error('Expected inline')
    expect(before.payload.json).toContain('"todoCategoryWeights":' + weights)
    expect(workspaceDomainV2Inspect('todo_preferences', 'workspace', before.payload.json)).toMatchObject({ supported: false, writable: false, reason: 'unsafe_number' })
    domain.setPreferences({ todoCategoryMemories: [] })
    expect(latest('workspace', 'todo_preferences')).toEqual(before)
    expect((domain.native.prepare("SELECT value_json FROM preferences WHERE key='workspace'").get() as { value_json: string }).value_json).toContain(weights)
  })

  it('returns scoped410 after upload cleanup, retries immutable operations and does not leak foreign refs', async () => {
    const { domain, deviceId, repository, call, sync, latest } = await setup()
    const operation = createOperation() as Extract<wire.WorkspaceV2Operation, { type: 'record' }>
    const bytes = Buffer.from(JSON.stringify(createBody())), hash = sha(bytes)
    const declaration = { uploadId: randomUUID(), scope: 'todo.full', entity: { kind: 'todo', id: operation.id }, purpose: 'document', sha256: hash, byteLength: bytes.length, mediaType: 'application/json' }
    const upload = async (uploadId: string) => {
      const session = await call('blob.start', { ...declaration, uploadId })
      await call('blob.chunk', { sessionId: session.sessionId, index: 0, sha256: hash, bytesBase64: bytes.toString('base64') })
      const committed = await call('blob.commit', { sessionId: session.sessionId, sha256: hash, byteLength: bytes.length })
      return { session, committed }
    }
    const { session, committed } = await upload(declaration.uploadId)
    operation.next.payload = { encoding: 'blob', ref: committed.ref }
    const cleanup = () => {
      domain.native.prepare('UPDATE workspace_v2_uploads SET committed_at=? WHERE device_id=?').run(Date.now() - wire.WORKSPACE_V2_LIMITS.unreferencedTtlSeconds * 1000 - 1000, deviceId)
      new WorkspaceV2BlobStore(domain.native, Buffer.alloc(32), (device, scope, write) => repository.authorize(device, scope, write)).cleanup()
    }
    cleanup()
    const counter = domain.native.prepare('SELECT counter FROM workspace_v2_devices WHERE device_id=?').get(deviceId)
    await expect(sync([operation])).rejects.toMatchObject({ code: 'blob_expired', status: 410 })
    expect(domain.native.prepare('SELECT counter FROM workspace_v2_devices WHERE device_id=?').get(deviceId)).toEqual(counter)
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_receipts WHERE device_id=?').get(deviceId)).toEqual({ n: 0 })
    expect(latest(operation.id)).toBeNull()
    for (const [purpose, extra] of [
      ['blob.status', { sessionId: session.sessionId }], ['blob.chunk', { sessionId: session.sessionId, index: 0, sha256: hash, bytesBase64: bytes.toString('base64') }],
      ['blob.commit', { sessionId: session.sessionId, sha256: hash, byteLength: bytes.length }], ['blob.start', declaration]
    ] as const) await expect(call(purpose, extra)).rejects.toMatchObject({ code: 'blob_expired', status: 410 })
    await expect(sync([{ ...operation, id: randomUUID() }])).rejects.toMatchObject({ code: 'blob_denied', status: 403 })
    await expect(sync([{ ...operation, next: { ...operation.next, payload: { encoding: 'blob', ref: { ...committed.ref, sha256: '0'.repeat(64) } } } }])).rejects.toMatchObject({ code: 'blob_denied', status: 403 })
    const foreign = randomUUID()
    domain.trustMobileSyncDevice({ id: foreign, name: '其他设备', encryptedSecret: randomBytes(32).toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
    repository.setDeviceGrants(foreign, [{ scope: 'todo.full', write: true }])
    const blobs = new WorkspaceV2BlobStore(domain.native, Buffer.alloc(32), (device, scope, write) => repository.authorize(device, scope, write))
    expect(() => blobs.committedJson(foreign, declaration.entity, committed.ref)).toThrow(expect.objectContaining({ status: 403 }))
    await upload(randomUUID())
    const receipt = (await sync([operation])).receipts[0]
    expect(receipt.status).toBe('accepted')
    cleanup()
    expect((await sync([operation])).receipts[0]).toEqual(receipt)
    expect(domain.native.prepare('SELECT COUNT(*) n FROM todo_events WHERE todo_id=?').get(operation.id)).toEqual({ n: 1 })
  })

  it('paginates declared JSON references at128MiB without skipping fixed-window history or snapshot tokens', async () => {
    const context = await setup()
    declaredDocumentRecords(context, 10)
    const expected = (context.domain.native.prepare('SELECT sequence FROM workspace_v2_changes ORDER BY sequence').all() as { sequence: number }[]).map(row => row.sequence)
    const sequences: number[] = []
    let cursor = 0, through: number | null = null, pages = 0
    while (true) {
      const response = await context.sync([], cursor, through)
      expect(declaredPageBytes(response.changes)).toBeLessThanOrEqual(WORKSPACE_V2_PAGE_JSON_BYTES)
      expect(response.cursor).toBeGreaterThan(cursor)
      sequences.push(...response.changes.map((record: wire.WorkspaceV2Record) => record.sequence))
      cursor = response.cursor; through = response.through; pages++
      if (!response.hasMore) break
      expect(pages).toBeLessThan(10)
    }
    expect(pages).toBeGreaterThan(1)
    expect(sequences).toEqual(expected)
    const manifest = await context.call('snapshot.start', context.scoped)
    let after: string | null = null, snapshotPages = 0
    const snapshotSequences: number[] = []
    while (true) {
      const response = await context.call('snapshot.page', { manifestId: manifest.manifestId, after, limit: 100 })
      expect(declaredPageBytes(response.records)).toBeLessThanOrEqual(WORKSPACE_V2_PAGE_JSON_BYTES)
      expect(response.records.length).toBeGreaterThan(0)
      snapshotSequences.push(...response.records.map((record: wire.WorkspaceV2Record) => record.sequence))
      snapshotPages++
      if (response.done) break
      expect(response.next).not.toBe(after)
      after = response.next
      expect(snapshotPages).toBeLessThan(10)
    }
    expect(snapshotPages).toBeGreaterThan(1)
    const latestSequences = (context.domain.native.prepare('SELECT MAX(sequence) AS n FROM workspace_v2_changes GROUP BY kind,entity_id').all() as { n: number }[]).map(row => row.n).sort((a, b) => a - b)
    expect(snapshotSequences.sort((a, b) => a - b)).toEqual(latestSequences)
    expect(snapshotSequences.length).toBe(manifest.entityCount)
  })

  it('rolls back domain data, receipts and counter when declared receipt JSON exceeds the budget, then accepts frozen subbatches', async () => {
    const context = await setup(), fixtures = declaredDocumentRecords(context, 9)
    const rejected = fixtures.map(({ record, body }, index): wire.WorkspaceV2Operation => ({
      type: 'record', operationId: randomUUID(), localRevision: index + 1, kind: 'todo', id: record.id,
      baseRevision: record.revision, base: { deleted: record.deleted, payload: record.payload },
      next: { deleted: false, payload: payload({ ...body, updatedAt: 'immutable field forgery' }) }
    }))
    const created = createOperation(), operations = [created, ...rejected], frozen = JSON.stringify(operations)
    const watermark = context.repository.watermark()
    const counter = context.domain.native.prepare('SELECT counter FROM workspace_v2_devices WHERE device_id=?').get(context.deviceId)
    await expect(context.sync(operations)).rejects.toMatchObject({ code: 'response_too_large', status: 413 })
    expect(context.repository.watermark()).toBe(watermark)
    expect(context.domain.native.prepare('SELECT counter FROM workspace_v2_devices WHERE device_id=?').get(context.deviceId)).toEqual(counter)
    expect(context.domain.native.prepare('SELECT COUNT(*) AS n FROM workspace_v2_receipts WHERE device_id=?').get(context.deviceId)).toEqual({ n: 0 })
    expect(context.latest((created as { id: string }).id)).toBeNull()
    expect(context.changed).not.toHaveBeenCalled()
    const first = await context.sync(operations.slice(0, 5)), second = await context.sync(operations.slice(5))
    expect(first.receipts[0].status).toBe('accepted')
    expect(second.receipts.every((receipt: wire.WorkspaceV2Receipt) => receipt.status === 'rejected')).toBe(true)
    for (const response of [first, second]) {
      expect(declaredPageBytes([...response.receipts.flatMap((receipt: wire.WorkspaceV2Receipt) => receipt.record ? [receipt.record] : []), ...response.changes])).toBeLessThanOrEqual(WORKSPACE_V2_PAGE_JSON_BYTES)
    }
    expect(JSON.stringify(operations)).toBe(frozen)
    expect((await context.sync(operations.slice(0, 5))).receipts).toEqual(first.receipts)
    expect(context.domain.native.prepare('SELECT COUNT(*) AS n FROM todo_events WHERE todo_id=?').get((created as { id: string }).id)).toEqual({ n: 1 })
  })

  it('deduplicates declared receipt blobs against history at the exact response boundary', async () => {
    const context = await setup()
    let baseline = await context.sync([])
    while (baseline.hasMore) baseline = await context.sync([], baseline.cursor, baseline.through)
    const { record, body } = declaredDocumentRecords(context, 8).at(-1)!
    const operations: wire.WorkspaceV2Operation[] = [{
      type: 'record', operationId: randomUUID(), localRevision: 2, kind: 'todo', id: record.id,
      baseRevision: record.revision, base: { deleted: false, payload: record.payload },
      next: { deleted: false, payload: payload({ ...body, updatedAt: 'immutable field forgery' }) }
    }]
    const response = await context.sync(operations, baseline.cursor)
    expect(response.receipts).toHaveLength(1)
    expect(response.hasMore).toBe(false)
    expect(declaredPageBytes([...response.receipts.map((receipt: wire.WorkspaceV2Receipt) => receipt.record!), ...response.changes])).toBe(WORKSPACE_V2_PAGE_JSON_BYTES)
  })

})
