import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { WorkspaceSyncRepository } from '../../src/main/db/workspace-sync-repository'
import { WorkspaceSyncService, deriveWorkspaceKey } from '../../src/main/workspace-sync-service'
import { MobileSyncService } from '../../src/main/mobile-sync-service'
import type { CreateTodoInput, TodoItem } from '../../src/shared/domain'
import { WORKSPACE_BYTE_LIMIT, workspaceAad, type WorkspaceEnvelope, type WorkspaceOperation, type WorkspaceRemoteRecord, type WorkspaceSyncRequest, type WorkspaceSyncResponse } from '../../src/shared/workspace-sync'

const stores: WorkspaceStore[] = [], dirs: string[] = [], servers: MobileSyncService[] = []
const protector = { isAvailable: () => true, encrypt: (value: string) => value, decrypt: (value: string) => value }
const todo = (overrides: Partial<CreateTodoInput> = {}): CreateTodoInput => ({ title: '拍摄开头', plannedDate: '2026-10-03', segment: null, category: 'self_media', projectId: null, trackingMode: 'checklist', progress: 0, ...overrides })

async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'workspace-sync-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store)
  const domain = store.repository, deviceId = randomUUID(), workspaceId = domain.getOrCreateMobileSyncServiceId(), secret = randomBytes(32)
  domain.trustMobileSyncDevice({ id: deviceId, name: '测试手机', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const sync = new WorkspaceSyncRepository(domain)
  const request = (operations: WorkspaceOperation[] = [], extra: Partial<WorkspaceSyncRequest> = {}): WorkspaceSyncRequest => ({ protocolVersion: 1, workspaceId, deviceId, operations, cursor: 0, through: null, ...extra })
  return { store, domain, deviceId, workspaceId, secret, sync, request }
}

function operation(base: WorkspaceRemoteRecord | null, data: Record<string, unknown>, extra: Partial<WorkspaceOperation> = {}): WorkspaceOperation {
  return { operationId: randomUUID(), kind: base?.kind ?? 'todo', id: base?.id ?? randomUUID(), localRevision: 1, baseRevision: base?.revision ?? 0,
    base: base ? { deleted: base.deleted, data: base.data } : null, next: { deleted: false, data }, ...extra }
}
const initial = { title: '手机待办', category: 'life', plannedDate: '2026-10-03', completedAt: null }
function envelope(request: WorkspaceSyncRequest, secret: Buffer, counter: number): WorkspaceEnvelope {
  const base = { protocolVersion: 1 as const, workspaceId: request.workspaceId, serviceId: request.workspaceId, deviceId: request.deviceId, requestId: randomUUID(), counter }
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', deriveWorkspaceKey(secret, request.workspaceId), nonce)
  cipher.setAAD(Buffer.from(workspaceAad(base, 'request')))
  return { ...base, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(JSON.stringify(request)), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}
function decrypt(value: WorkspaceEnvelope, secret: Buffer, expected: WorkspaceEnvelope): WorkspaceSyncResponse {
  const cipher = createDecipheriv('aes-256-gcm', deriveWorkspaceKey(secret, expected.workspaceId), Buffer.from(value.nonce, 'base64'))
  cipher.setAAD(Buffer.from(workspaceAad(expected, 'response')))
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext, 'base64')), cipher.final()]).toString('utf8')) as WorkspaceSyncResponse
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
  stores.splice(0).forEach(store => store.close())
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('workspace transactional domain sync', () => {
  it('captures every local entry point and preserves complete historic projections', async () => {
    const { domain, sync } = await setup()
    const created = domain.createTodoItems([todo({ projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 35, isExtra: true })])[0]!
    const first = sync.latest('todo', created.id)!
    expect(first.metadata).toEqual({ todo: created, editableFields: ['title', 'category', 'plannedDate', 'completedAt'], deletable: true })
    domain.updateTodoItem(created.id, { title: '更新标题' })
    domain.dismissTodoItem(created.id)
    expect(sync.latest('todo', created.id)).toMatchObject({ revision: 3, deleted: true })
    const original = domain.native.prepare('SELECT data_json,metadata_json FROM workspace_sync_changes WHERE kind=? AND entity_id=? AND revision=1').get('todo', created.id) as { data_json: string; metadata_json: string }
    expect(JSON.parse(original.data_json).title).toBe(created.title)
    expect(JSON.parse(original.metadata_json).todo).toEqual(created)
    expect(() => domain.native.transaction(() => { domain.createTodoItems([todo({ title: '不应保存' })]); throw Error('rollback') })()).toThrow('rollback')
    expect(domain.native.prepare("SELECT 1 FROM workspace_sync_changes WHERE json_extract(data_json,'$.title')='不应保存'").get()).toBeUndefined()
    domain.setDailyWorkLog('2026-10-03', { selfMediaMinutes: 1440, aiMinutes: 1440, otherWorkMinutes: 1440 })
    expect(sync.latest('work_log', '2026-10-03')?.data).toEqual({ minutes: 4320 })
    domain.native.prepare('DELETE FROM daily_work_logs WHERE day=?').run('2026-10-03')
    expect(sync.latest('work_log', '2026-10-03')).toMatchObject({ deleted: true, data: { minutes: null }, metadata: { selfMediaMinutes: 1440 } })
  })

  it('imports a stable UUID and microsecond completion through todo domain events, idempotently', async () => {
    const { domain, sync, request } = await setup()
    const complete = '2026-10-03T18:30:00.123456Z'
    const op = operation(null, { ...initial, completedAt: complete })
    const first = sync.synchronize(request([op]), 1).response.receipts[0]!
    expect(first.status).toBe('accepted')
    expect(first.record.id).toBe(op.id)
    expect(first.record.data.completedAt).toBe(complete)
    const events = domain.native.prepare('SELECT count(*) AS n FROM todo_events WHERE todo_id=?').get(op.id)
    expect(events).toEqual({ n: 1 })
    expect(sync.synchronize(request([op]), 2).response.receipts[0]).toEqual(first)
    expect(domain.native.prepare('SELECT count(*) AS n FROM todo_events WHERE todo_id=?').get(op.id)).toEqual(events)
    expect(() => sync.synchronize(request([{ ...op, next: { ...op.next, data: { ...op.next.data, title: '换内容' } } }]), 3)).toThrow('不同内容')
    expect(sync.latest('todo', op.id)?.revision).toBe(1)
  })

  it('merges disjoint fields without losing domain metadata or completion time and conflicts on same-field edits', async () => {
    const { domain, sync, request } = await setup()
    const created = domain.createTodoItems([todo({ projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 55, segment: 'evening', isExtra: true })])[0]!
    const base = sync.latest('todo', created.id)!
    domain.updateTodoItem(created.id, { completed: true })
    const completed = domain.listTodoItems().find(value => value.id === created.id)!
    const result = sync.synchronize(request([operation(base, { ...base.data, title: '手机改标题' })]), 1).response.receipts[0]!
    expect(result.status).toBe('accepted')
    expect(result.record.metadata.todo).toMatchObject({ projectId: 'ios', stageKey: 'script', trackingMode: 'progress', segment: 'evening', progress: 100, progressBeforeComplete: 55, isExtra: true, completedAt: completed.completedAt })
    const conflict = sync.synchronize(request([operation(base, { ...base.data, title: '第二次手机改标题' })]), 2).response.receipts[0]!
    expect(conflict.status).toBe('conflict')
    expect(conflict.record.data.title).toBe('手机改标题')
  })

  it('validates historical bases, UUID collisions and all-or-nothing receipts/counters/domain changes', async () => {
    const { domain, sync, request } = await setup()
    const created = domain.createTodoItems([todo()])[0]!, base = sync.latest('todo', created.id)!
    const collision = operation(null, initial, { id: created.id })
    expect(sync.synchronize(request([collision]), 1).response.receipts[0]?.status).toBe('conflict')
    const forged = operation(base, { ...base.data, title: '伪造修改' })
    forged.base!.data = { ...base.data, title: '伪造基线' }
    const good = operation(null, initial)
    expect(() => sync.synchronize(request([good, forged]), 2)).toThrow('历史不符')
    expect(sync.latest('todo', good.id)).toBeNull()
    expect(domain.native.prepare('SELECT counter FROM workspace_sync_devices').get()).toEqual({ counter: 1 })
    expect(domain.native.prepare('SELECT 1 FROM workspace_sync_receipts WHERE operation_id=?').get(good.operationId)).toBeUndefined()
    expect(sync.synchronize(request([good]), 2).response.receipts[0]?.status).toBe('accepted')
  })

  it('preserves deletion/edit conflicts and marks complex todos read-only', async () => {
    const { domain, sync, request } = await setup()
    const created = domain.createTodoItems([todo()])[0]!, base = sync.latest('todo', created.id)!
    domain.dismissTodoItem(created.id)
    const response = sync.synchronize(request([operation(base, { ...base.data, title: '离线编辑' })]), 1)
    expect(response.response.receipts[0]).toMatchObject({ status: 'conflict', record: { deleted: true } })
    const rangeTodo = domain.createTodoItems([todo()])[0]!
    domain.native.prepare("UPDATE todo_items SET source='schedule' WHERE id=?").run(rangeTodo.id)
    const readonly = sync.latest('todo', rangeTodo.id)!
    expect(readonly.metadata).toMatchObject({ editableFields: [], deletable: false })
    expect(sync.synchronize(request([operation(readonly, { ...readonly.data, category: 'life' })]), 2).response.receipts[0]?.status).toBe('conflict')
    const changed = domain.createTodoItems([todo()])[0]!, deletedBase = sync.latest('todo', changed.id)!
    domain.updateTodoItem(changed.id, { title: '电脑更新' })
    expect(sync.synchronize(request([operation(deletedBase, deletedBase.data, { next: { deleted: true, data: deletedBase.data } })]), 3).response.receipts[0]?.status).toBe('conflict')
  })

  it('preserves classified minutes, distinguishes zero/clear and conflicts on any concurrent work-log revision', async () => {
    const { domain, sync, request } = await setup()
    const day = '2026-10-03'
    domain.setDailyWorkLog(day, { selfMediaMinutes: 60, aiMinutes: 30, otherWorkMinutes: 15 })
    let base = sync.latest('work_log', day)!
    const zero = sync.synchronize(request([operation(base, { minutes: 0 })]), 1).response.receipts[0]!
    expect(zero).toMatchObject({ status: 'accepted', record: { data: { minutes: 0 }, deleted: false, metadata: { selfMediaMinutes: 60, aiMinutes: 30, otherWorkMinutes: 15, totalMinutes: 0 } } })
    expect(sync.synchronize(request([operation(null, { minutes: 10 }, { kind: 'work_log', id: day })]), 2).response.receipts[0]?.status).toBe('conflict')
    base = zero.record
    domain.setDailyWorkLog(day, { selfMediaMinutes: 45, aiMinutes: 45, otherWorkMinutes: 15 })
    expect(sync.synchronize(request([operation(base, { minutes: 0 })]), 3).response.receipts[0]?.status).toBe('conflict')
    base = sync.latest('work_log', day)!
    const clear = sync.synchronize(request([operation(base, { minutes: null })]), 4).response.receipts[0]!
    expect(clear.record).toMatchObject({ deleted: true, data: { minutes: null }, metadata: { selfMediaMinutes: 45 } })
    expect(domain.getDailyWorkLog(day).updatedAt).toBe('')
    expect(sync.synchronize(request([operation(clear.record, { minutes: 360 })]), 5).response.receipts[0]).toMatchObject({ status: 'accepted', record: { deleted: false, data: { minutes: 360 } } })
  })

  it('paginates historic snapshots with a fixed high-water mark across interleaved local writes', async () => {
    const { domain, sync, request } = await setup()
    for (let i = 0; i < 3; i++) domain.createTodoItems(Array.from({ length: 50 }, (_, j) => todo({ title: `${i}-${j}` })))
    const first = sync.synchronize(request(), 1).response
    expect(first.changes).toHaveLength(100)
    expect(first.hasMore).toBe(true)
    const selected = first.changes[0]!
    domain.updateTodoItem(selected.id, { title: '水位之后更新' })
    const second = sync.synchronize(request([], { cursor: first.cursor, through: first.through }), 2).response
    expect(second.through).toBe(first.through)
    expect(second.changes.every(value => value.sequence <= first.through)).toBe(true)
    expect(second.hasMore).toBe(false)
    const third = sync.synchronize(request([], { cursor: second.cursor }), 3).response
    expect(third.changes).toContainEqual(expect.objectContaining({ id: selected.id, data: expect.objectContaining({ title: '水位之后更新' }) }))
    expect(() => sync.synchronize(request([], { cursor: third.through + 1 }), 4)).toThrow('历史已回退')
  })

  it('rejects oversized receipt batches atomically and limits pull pages by byte size', async () => {
    const { domain, sync, request } = await setup()
    const items = domain.createTodoItems(Array.from({ length: 8 }, () => todo({ title: '长'.repeat(9000) })))
    const response = sync.synchronize(request(), 1).response
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(WORKSPACE_BYTE_LIMIT)
    expect(response.changes.length).toBeLessThan(8)
    expect(response.hasMore).toBe(true)
    const ops = items.map(item => { const base = sync.latest('todo', item.id)!; return operation(base, { ...base.data, category: 'life' }) })
    expect(() => sync.synchronize(request(ops), 2)).toThrow('同步内容过大')
    expect(items.every(item => sync.latest('todo', item.id)?.data.category === 'self_media')).toBe(true)
  })

  it('rolls back a bounded request if full receipts cannot fit the response budget', async () => {
    const { domain, sync, request } = await setup()
    const items = [0, 1].flatMap(() => domain.createTodoItems(Array.from({ length: 50 }, () => todo({ title: 'x'.repeat(980) }))))
    const ops = items.map(item => { const base = sync.latest('todo', item.id)!; return operation(base, { ...base.data, category: 'life' }) })
    expect(Buffer.byteLength(JSON.stringify(request(ops)))).toBeLessThan(WORKSPACE_BYTE_LIMIT)
    expect(() => sync.synchronize(request(ops), 1)).toThrow('减少本次同步')
    expect(items.every(item => sync.latest('todo', item.id)?.data.category === 'self_media')).toBe(true)
    expect(domain.native.prepare('SELECT COUNT(*) AS n FROM workspace_sync_devices').get()).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT COUNT(*) AS n FROM workspace_sync_receipts').get()).toEqual({ n: 0 })
  })

  it('returns original receipt snapshots on a retry after subsequent domain edits', async () => {
    const { domain, sync, request } = await setup(), op = operation(null, initial)
    const first = sync.synchronize(request([op]), 1).response.receipts[0]!
    domain.updateTodoItem(op.id, { title: '随后电脑更新' })
    const second = sync.synchronize(request([op]), 2).response
    expect(second.receipts[0]).toEqual(first)
    expect(second.changes.at(-1)?.data.title).toBe('随后电脑更新')
    expect(domain.native.prepare('SELECT COUNT(*) AS n FROM todo_events WHERE todo_id=?').get(op.id)).toEqual({ n: 2 })
  })

  it('rolls back when response finalization fails and rejects unknown request/operation fields', async () => {
    const { sync, request } = await setup()
    const op = operation(null, initial)
    expect(() => sync.synchronize(request([op]), 1, () => { throw Error('encrypt failed') })).toThrow('encrypt failed')
    expect(sync.latest('todo', op.id)).toBeNull()
    expect(() => sync.synchronize({ ...request(), extra: true } as WorkspaceSyncRequest, 1)).toThrow()
    expect(() => sync.synchronize(request([{ ...op, next: { deleted: false, data: { ...initial, projectId: 'ios' } } }]), 1)).toThrow()
    expect(sync.synchronize(request([op]), 1).response.receipts[0]?.status).toBe('accepted')
  })

  it('backfills previous schemas before activating triggers', () => {
    const db = new Database(':memory:')
    try {
      runMigrationsThrough(db, '0100_r21af_todo_day_focus')
      db.prepare('INSERT INTO daily_work_logs(day,self_media_minutes,ai_minutes,other_work_minutes,updated_at,total_minutes) VALUES(?,?,?,?,?,?)').run('2026-10-01', 60, 30, 0, '2026-10-01T00:00:00Z', null)
      runMigrations(db)
      const row = db.prepare("SELECT * FROM workspace_sync_changes WHERE kind='work_log'").get() as { revision: number; data_json: string }
      expect(row.revision).toBe(1)
      expect(JSON.parse(row.data_json)).toEqual({ minutes: 90 })
      db.prepare('UPDATE daily_work_logs SET total_minutes=0 WHERE day=?').run('2026-10-01')
      expect(db.prepare('SELECT COUNT(*) AS n FROM workspace_sync_changes').get()).toEqual({ n: 2 })
    } finally { db.close() }
  })
})

describe('workspace authenticated independent transport', () => {
  it('matches shared HKDF fixture and encrypts authenticated matching responses', async () => {
    const fixture = JSON.parse(await readFile(join(import.meta.dirname, '../../../shared-fixtures/workspace-sync-v1.json'), 'utf8'))
    expect(deriveWorkspaceKey(Buffer.from(fixture.crypto.secretBase64, 'base64'), fixture.identity.serviceId).toString('base64')).toBe(fixture.crypto.keyBase64)
    const { domain, secret, request } = await setup(), changed = vi.fn()
    const service = new WorkspaceSyncService(domain, protector, changed)
    const sent = envelope(request([operation(null, initial)]), secret, 1)
    const response = service.handle(sent)
    expect(response.nonce).not.toBe(sent.nonce)
    const body = decrypt(response, secret, sent)
    expect(body.receipts[0]?.status).toBe('accepted')
    expect(changed).toHaveBeenCalledOnce()
    expect(() => decrypt(response, secret, { ...sent, requestId: randomUUID() })).toThrow()
    expect(() => decrypt({ ...response, tag: randomBytes(16).toString('base64') }, secret, sent)).toThrow()
  })

  it('rejects replay after restart, altered identities/ciphertext, unknown envelope fields and revoked trust', async () => {
    const { store, domain, secret, request, deviceId } = await setup()
    const service = new WorkspaceSyncService(domain, protector, () => {})
    const sent = envelope(request(), secret, 1)
    service.handle(sent)
    const second = new WorkspaceSyncService(domain, protector, () => {})
    expect(() => second.handle(sent)).toThrow('已处理')
    expect(() => second.handle({ ...sent, counter: 2 })).toThrow('认证失败')
    expect(() => second.handle({ ...sent, requestId: randomUUID() })).toThrow('认证失败')
    expect(() => second.handle({ ...sent, ciphertext: randomBytes(100).toString('base64') })).toThrow('认证失败')
    expect(() => second.handle({ ...sent, extra: true })).toThrow()
    const other = new Database(store.databasePath)
    try { expect(other.prepare('SELECT counter FROM workspace_sync_devices WHERE device_id=?').get(deviceId)).toEqual({ counter: 1 }) } finally { other.close() }
    domain.revokeMobileSyncDevice(deviceId)
    expect(() => second.handle(envelope(request(), secret, 2))).toThrow('撤销')
  })

  it('rejects inner/outer identity substitution, changed service IDs and oversized encryption', async () => {
    const { domain, secret, request } = await setup()
    const service = new WorkspaceSyncService(domain, protector, () => {})
    const wrongDevice = request([], { deviceId: randomUUID() })
    const sent = envelope(wrongDevice, secret, 1)
    const outer = { ...sent, deviceId: request().deviceId }
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', deriveWorkspaceKey(secret, sent.workspaceId), nonce)
    cipher.setAAD(Buffer.from(workspaceAad(outer, 'request')))
    const substituted = { ...outer, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(JSON.stringify(wrongDevice)), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }
    expect(() => service.handle(substituted)).toThrow('身份不匹配')
    expect(() => service.handle({ ...envelope(request(), secret, 1), serviceId: randomUUID() })).toThrow('身份不匹配')
    expect(() => service.handle({ ...envelope(request(), secret, 1), ciphertext: Buffer.alloc(WORKSPACE_BYTE_LIMIT + 4).toString('base64') })).toThrow()
    expect(() => service.handle({ ...envelope(request(), secret, 1), nonce: 'AAAAAAAAAAAAAAAA=' })).toThrow()
  })

  it('routes workspace separately without triggering Capture classification and keeps legacy health alive', async () => {
    const { store, domain, request, secret } = await setup(), captureChanged = vi.fn(), workspaceChanged = vi.fn()
    const server = new MobileSyncService(store, protector, captureChanged, { onWorkspaceChanged: workspaceChanged })
    servers.push(server)
    const status = await server.setEnabled(true)
    const url = `http://127.0.0.1:${status.port}`
    const sent = envelope(request([operation(null, initial)]), secret, 1)
    const response = await fetch(`${url}/workspace/v1/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent) })
    expect(response.status).toBe(200)
    expect(decrypt(await response.json() as WorkspaceEnvelope, secret, sent).receipts[0]?.status).toBe('accepted')
    expect(workspaceChanged).toHaveBeenCalledOnce()
    expect(captureChanged).not.toHaveBeenCalled()
    expect((await fetch(`${url}/v2/health`)).status).toBe(200)
    expect(domain.listTodoItems().some((value: TodoItem) => value.title === initial.title)).toBe(true)
    const replay = await fetch(`${url}/workspace/v1/sync`, { method: 'POST', body: JSON.stringify(sent) })
    expect(replay.status).toBe(409)
  })
})
