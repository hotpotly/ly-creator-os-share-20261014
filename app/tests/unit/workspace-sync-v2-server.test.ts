import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { WorkspaceV2Repository } from '../../src/main/db/workspace-sync-v2-repository'
import { WorkspaceV2BlobStore } from '../../src/main/db/workspace-sync-v2-blobs'
import { WorkspaceSyncRepository } from '../../src/main/db/workspace-sync-repository'
import { WorkspaceSyncV2Service, deriveWorkspaceV2Key, type WorkspaceV2Purpose } from '../../src/main/workspace-sync-v2-service'
import { MobileSyncService } from '../../src/main/mobile-sync-service'
import * as wire from '../../src/shared/workspace-sync-v2'

const stores: WorkspaceStore[] = [], dirs: string[] = [], servers: MobileSyncService[] = []
const protector = { isAvailable: () => true, encrypt: (value: string) => value, decrypt: (value: string) => value }
const makeTodo = (title = '推进一小步') => ({ title, plannedDate: '2026-10-03', category: 'life' as const, segment: null, projectId: null, trackingMode: 'checklist' as const, progress: 0 })
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
function seal(purpose: WorkspaceV2Purpose, request: object, workspaceId: string, deviceId: string, secret: Buffer, counter: number): wire.WorkspaceV2Envelope {
  const base = { protocolVersion: 2 as const, workspaceId, serviceId: workspaceId, deviceId, purpose, requestId: randomUUID(), counter }
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', deriveWorkspaceV2Key(secret, workspaceId), nonce)
  cipher.setAAD(Buffer.from(wire.workspaceV2Aad(base, 'request')))
  return { ...base, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(JSON.stringify(request)), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}
function unseal(response: wire.WorkspaceV2Envelope, expected: wire.WorkspaceV2Envelope, secret: Buffer) {
  wire.workspaceV2AssertResponseEnvelope(expected, response)
  const cipher = createDecipheriv('aes-256-gcm', deriveWorkspaceV2Key(secret, expected.workspaceId), Buffer.from(response.nonce, 'base64'))
  cipher.setAAD(Buffer.from(wire.workspaceV2Aad(expected, 'response'))); cipher.setAuthTag(Buffer.from(response.tag, 'base64'))
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(response.ciphertext, 'base64')), cipher.final()]).toString('utf8'))
}
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'workspace-v2-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store)
  const domain = store.repository, deviceId = randomUUID(), workspaceId = domain.getOrCreateMobileSyncServiceId(), secret = randomBytes(32)
  domain.trustMobileSyncDevice({ id: deviceId, name: '假设备', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const repository = new WorkspaceV2Repository(domain), service = new WorkspaceSyncV2Service(domain, protector)
  const id = { protocolVersion: 2 as const, workspaceId, deviceId }, scopes = ['todo.full', 'work_log'] as wire.WorkspaceV2Scope[]
  const scoped = { scopes, scopeDigest: await wire.workspaceV2ScopeDigest(scopes) }
  const grant = () => repository.setDeviceGrants(deviceId, scopes.map(scope => ({ scope, write: false })))
  let counter = 0
  const call = async (purpose: WorkspaceV2Purpose, extra: object) => {
    const request = { ...id, ...extra }, envelope = seal(purpose, request, workspaceId, deviceId, secret, ++counter)
    const response = await service.handle(purpose, envelope)
    return unseal(response, envelope, secret)
  }
  return { dir, store, domain, repository, service, deviceId, workspaceId, secret, id, scoped, grant, call }
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
  for (const store of stores.splice(0)) store.close()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('workspace v2 read-only production foundation', () => {
  it('backfills complete revisions and tombstones without modifying v1 history', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON'); runMigrationsThrough(db, '0101_m2_workspace_sync')
      db.prepare("INSERT INTO todo_items(id,title,category,status,tracking_mode,source,created_at,updated_at) VALUES(?,'first','life','open','checklist','manual','2026-10-03','2026-10-03')").run(randomUUID())
      db.prepare("UPDATE todo_items SET title='second'").run(); db.prepare('DELETE FROM todo_items').run()
      const before = db.prepare('SELECT * FROM workspace_sync_changes ORDER BY sequence').all()
      runMigrations(db)
      expect(db.prepare('SELECT * FROM workspace_sync_changes ORDER BY sequence').all()).toEqual(before)
      const history = db.prepare("SELECT revision,deleted,payload_json FROM workspace_v2_changes WHERE kind='todo' ORDER BY sequence").all() as { revision: number; deleted: number; payload_json: string }[]
      expect(history.map(row => row.revision)).toEqual([1, 2, 3]); expect(history[2]?.deleted).toBe(1)
      expect(JSON.parse(history[0]!.payload_json).title).toBe('first')
      expect(JSON.parse(history[1]!.payload_json).title).toBe('second')
      expect(() => db.prepare('UPDATE workspace_v2_changes SET deleted=0').run()).toThrow('immutable')
    } finally { db.close() }
  })
  it('advertises nothing by default and never upgrades a granted read scope to write', async () => {
    const context = await setup()
    const { call, grant, repository, deviceId } = context
    expect((await call('capabilities', { clientScopes: [...wire.WORKSPACE_V2_SCOPES] })).supportedScopes).toEqual([])
    grant()
    const caps = await call('capabilities', { clientScopes: [...wire.WORKSPACE_V2_SCOPES] })
    expect(caps.supportedScopes).toEqual(['todo.full', 'work_log'])
    expect(caps.permissions.every((permission: { write: boolean }) => !permission.write)).toBe(true)
    repository.setDeviceGrants(deviceId, [{ scope: 'todo.full', write: true }, { scope: 'review', write: true }])
    expect((await call('capabilities', { clientScopes: ['review', 'todo.full'] })).permissions).toEqual([{ scope: 'todo.full', read: true, write: true }])
    await expect(call('snapshot.start', { scopes: ['review'], scopeDigest: await wire.workspaceV2ScopeDigest(['review']) })).rejects.toMatchObject({ status: 403 })
  })
  it('captures Mac and v1 changes atomically with complete todo and work-log payloads', async () => {
    const { domain, call, grant, scoped, deviceId, workspaceId } = await setup(); grant()
    const created = domain.createTodoItems([{ ...makeTodo(), isExtra: true, projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 50 }])[0]!
    domain.setDailyWorkLog('2026-10-03', { selfMediaMinutes: 100, aiMinutes: 20, otherWorkMinutes: 5 })
    const legacy = new WorkspaceSyncRepository(domain), baseline = legacy.latest('todo', created.id)!
    legacy.synchronize({ protocolVersion: 1, workspaceId, deviceId, cursor: 0, through: null, operations: [{ operationId: randomUUID(), id: created.id, kind: 'todo', localRevision: 1, baseRevision: baseline.revision, base: { data: baseline.data, deleted: false }, next: { data: { ...baseline.data, title: '手机v1改标题' }, deleted: false } }] }, 1)
    const result = await call('sync', { ...scoped, cursor: 0, through: null, operations: [] })
    const records = result.changes.filter((record: wire.WorkspaceV2Record) => record.id === created.id)
    expect(JSON.parse(records[0].payload.json)).toEqual(created)
    expect(JSON.parse(records[1].payload.json)).toMatchObject({ title: '手机v1改标题', isExtra: true, progress: 50, stageKey: 'script' })
    const work = result.changes.find((record: wire.WorkspaceV2Record) => record.kind === 'work_log' && record.id === '2026-10-03')
    expect(JSON.parse(work.payload.json)).toEqual(domain.getDailyWorkLog('2026-10-03'))
    const before = domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_changes').get()
    expect(() => domain.native.transaction(() => { domain.createTodoItems([makeTodo('rollback')]); throw Error('rollback') })()).toThrow()
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_changes').get()).toEqual(before)
  })
  it('freezes old values, verifies signed page tokens and resumes pages after service recreation', async () => {
    const { domain, call, grant, scoped, service, secret, workspaceId, deviceId, id } = await setup(); grant()
    const created = domain.createTodoItems(Array.from({ length: 3 }, (_, i) => makeTodo(`old-${i}`)))
    const manifest = await call('snapshot.start', scoped)
    domain.updateTodoItem(created[0]!.id, { title: 'new' })
    const first = await call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 1 })
    expect(first.done).toBe(false)
    await expect(call('snapshot.page', { manifestId: manifest.manifestId, after: first.next.slice(0, -1) + (first.next.endsWith('a') ? 'b' : 'a'), limit: 1 })).rejects.toMatchObject({ code: 'invalid_page' })
    const secondManifest = await call('snapshot.start', scoped)
    await expect(call('snapshot.page', { manifestId: secondManifest.manifestId, after: first.next, limit: 1 })).rejects.toMatchObject({ code: 'invalid_page' })
    const records = [...first.records]
    let after = first.next, counter = 100
    const restarted = new WorkspaceSyncV2Service(domain, protector)
    while (after) {
      const request = seal('snapshot.page', { ...id, manifestId: manifest.manifestId, after, limit: 1 }, workspaceId, deviceId, secret, counter++)
      const result = unseal(await restarted.handle('snapshot.page', request), request, secret)
      records.push(...result.records); after = result.next
    }
    await wire.workspaceV2VerifyManifest(manifest, records)
    expect(JSON.parse(records.find(record => record.id === created[0]!.id).payload.json).title).toBe('old-0')
    const request = seal('sync', { ...id, ...scoped, operations: [], cursor: manifest.through, through: null }, workspaceId, deviceId, secret, counter++)
    const delta = unseal(await service.handle('sync', request), request, secret)
    expect(delta.changes.some((record: wire.WorkspaceV2Record) => record.id === created[0]!.id)).toBe(true)
  })
  it('binds nonzero cursors to completed scope snapshots and invalidates them after local grant changes', async () => {
    const { domain, call, grant, scoped, repository, deviceId } = await setup(); grant()
    domain.createTodoItems([makeTodo()])
    await expect(call('sync', { ...scoped, cursor: repository.watermark(), through: null, operations: [] })).rejects.toMatchObject({ code: 'cursor_scope_mismatch' })
    const manifest = await call('snapshot.start', scoped)
    await call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 100 })
    expect((await call('sync', { ...scoped, cursor: manifest.through, through: null, operations: [] })).hasMore).toBe(false)
    repository.setDeviceGrants(deviceId, [{ scope: 'todo.full', write: false }])
    await expect(call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 100 })).rejects.toMatchObject({ code: 'manifest_expired' })
    const scopes: wire.WorkspaceV2Scope[] = ['todo.full']
    await expect(call('sync', { scopes, scopeDigest: await wire.workspaceV2ScopeDigest(scopes), cursor: manifest.through, through: null, operations: [] })).rejects.toMatchObject({ code: 'cursor_scope_mismatch' })
  })
  it('streams large raw JSON through authenticated historical references, never a hash-only read', async () => {
    const { domain, call, grant, scoped } = await setup(); grant()
    const todo = domain.createTodoItems([makeTodo()])[0]!
    domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('字'.repeat(50000), todo.id)
    const manifest = await call('snapshot.start', scoped), page = await call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 100 })
    const item = page.records.find((record: wire.WorkspaceV2Record) => record.id === todo.id)
    expect(item.payload.encoding).toBe('blob')
    const bytes: Buffer[] = []
    for (let index = 0; index < Math.ceil(item.payload.ref.byteLength / 65536); index++) {
      const result = await call('blob.read', { record: { kind: 'todo', id: todo.id, revision: item.revision, manifestId: manifest.manifestId }, sha256: item.payload.ref.sha256, index })
      expect((await wire.workspaceV2BlobReadResponseSchema.safeParseAsync(result)).success).toBe(true)
      bytes.push(Buffer.from(result.bytesBase64, 'base64'))
    }
    expect(sha(Buffer.concat(bytes))).toBe(item.payload.ref.sha256)
    expect(JSON.parse(Buffer.concat(bytes).toString('utf8')).title).toBe('字'.repeat(50000))
    await expect(call('blob.read', { record: { kind: 'todo', id: randomUUID(), revision: item.revision }, sha256: item.payload.ref.sha256, index: 0 })).rejects.toMatchObject({ code: 'record_unknown' })
    await expect(call('blob.read', { record: { kind: 'todo', id: todo.id, revision: 1 }, sha256: item.payload.ref.sha256, index: 0 })).rejects.toMatchObject({ code: 'blob_not_referenced' })
  })
  it('denies writes and uploads with only readonly grants', async () => {
    const { call, domain, repository, deviceId, scoped } = await setup()
    repository.setDeviceGrants(deviceId, [{ scope: 'todo.full', write: false }])
    const data = '{}', payload = { encoding: 'json', json: data, sha256: sha(data), byteLength: 2 }
    await expect(call('sync', { ...scoped, cursor: 0, through: null, operations: [{ type: 'record', operationId: randomUUID(), kind: 'todo', id: randomUUID(), localRevision: 1, baseRevision: 0, base: null, next: { deleted: false, payload } }] })).rejects.toMatchObject({ status: 403 })
    await expect(call('blob.start', { uploadId: randomUUID(), scope: 'todo.full', entity: { kind: 'todo', id: randomUUID() }, purpose: 'document', sha256: sha(data), byteLength: 2, mediaType: 'application/json' })).rejects.toMatchObject({ status: 403 })
    await expect(call('blob.status', { sessionId: randomUUID() })).rejects.toMatchObject({ status: 403 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_uploads').get()).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_receipts').get()).toEqual({ n: 0 })
  })
  it('rejects purpose swaps, replay, body substitution, revocation and grant changes before committing counters', async () => {
    const { id, service, domain, deviceId, workspaceId, secret } = await setup()
    const request = seal('capabilities', { ...id, clientScopes: ['todo.full'] }, workspaceId, deviceId, secret, 1)
    await expect(service.handle('sync', request)).rejects.toMatchObject({ code: 'wrong_purpose' })
    const altered = { ...request, tag: Buffer.alloc(16).toString('base64') }
    await expect(service.handle('capabilities', altered)).rejects.toMatchObject({ code: 'invalid_authentication' })
    const response = await service.handle('capabilities', request)
    expect(unseal(response, request, secret).supportedScopes).toEqual([])
    await expect(service.handle('capabilities', request)).rejects.toMatchObject({ code: 'replayed_request' })
    const foreign = seal('capabilities', { ...id, deviceId: randomUUID(), clientScopes: [] }, workspaceId, deviceId, secret, 2)
    await expect(service.handle('capabilities', foreign)).rejects.toThrow('身份')
    const pending = service.handle('capabilities', seal('capabilities', { ...id, clientScopes: [] }, workspaceId, deviceId, secret, 3))
    domain.revokeMobileSyncDevice(deviceId)
    await expect(pending).rejects.toMatchObject({ code: 'device_revoked' })
    expect(domain.native.prepare('SELECT counter FROM workspace_v2_devices WHERE device_id=?').get(deviceId)).toEqual({ counter: 1 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_sync_devices').get()).toEqual({ n: 0 })
  })
  it('rolls back counter, manifest and hash caches when final secret availability fails', async () => {
    const { id, domain, workspaceId, deviceId, secret, scoped, grant } = await setup(); grant(); domain.createTodoItems([makeTodo()])
    const locked = { ...protector, isAvailable: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) }
    const service = new WorkspaceSyncV2Service(domain, locked)
    await expect(service.handle('snapshot.start', seal('snapshot.start', { ...id, ...scoped }, workspaceId, deviceId, secret, 1))).rejects.toMatchObject({ code: 'secret_unavailable' })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_devices').get()).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_manifests').get()).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_hashes').get()).toEqual({ n: 0 })
  })
  it('persists the v2 replay counter across database reopen and keeps its v1 namespace separate', async () => {
    const { dir, store, domain, id, workspaceId, deviceId, secret, service } = await setup()
    const request = seal('capabilities', { ...id, clientScopes: [] }, workspaceId, deviceId, secret, 8)
    await service.handle('capabilities', request)
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_sync_devices').get()).toEqual({ n: 0 })
    stores.splice(stores.indexOf(store), 1); store.close()
    const reopened = await openWorkspaceStore(dir); stores.push(reopened)
    await expect(new WorkspaceSyncV2Service(reopened.repository, protector).handle('capabilities', request)).rejects.toMatchObject({ code: 'replayed_request' })
  })
  it('bridges an explicit v1 missing-log clear as a v2 tombstone, not a recorded zero', async () => {
    const { domain, workspaceId, deviceId, call, scoped, grant } = await setup(); grant()
    new WorkspaceSyncRepository(domain).synchronize({ protocolVersion: 1, workspaceId, deviceId, cursor: 0, through: null, operations: [{ operationId: randomUUID(), kind: 'work_log', id: '2026-11-01', localRevision: 1, baseRevision: 0, base: null, next: { deleted: true, data: { minutes: null } } }] }, 1)
    const response = await call('sync', { ...scoped, cursor: 0, through: null, operations: [] })
    const cleared = response.changes.find((record: wire.WorkspaceV2Record) => record.kind === 'work_log' && record.id === '2026-11-01')
    expect(cleared.deleted).toBe(true)
    expect(JSON.parse(cleared.payload.json)).toMatchObject({ day: '2026-11-01', totalMinutes: null })
  })
  it('preserves a fixed incremental watermark, rejects guessed windows and detects database rollback', async () => {
    const { domain, call, grant, scoped, repository } = await setup(); grant()
    for (const count of [50, 50, 10]) domain.createTodoItems(Array.from({ length: count }, (_, index) => makeTodo(`task-${index}`)))
    const request = { ...scoped, cursor: 0, through: null, operations: [] }
    const first = await call('sync', request)
    expect(first.changes.length).toBe(100); expect(first.hasMore).toBe(true)
    const late = domain.createTodoItems([makeTodo('late')])[0]!
    const second = await call('sync', { ...request, cursor: first.cursor, through: first.through })
    expect(second.cursor).toBe(first.through); expect(second.hasMore).toBe(false)
    expect(second.changes.some((record: wire.WorkspaceV2Record) => record.id === late.id)).toBe(false)
    await expect(call('sync', { ...request, through: first.through - 1 })).rejects.toMatchObject({ code: 'window_unknown' })
    await expect(call('sync', { ...request, cursor: repository.watermark() + 1 })).rejects.toMatchObject({ code: 'cursor_ahead' })
    const last = await call('sync', { ...request, cursor: second.cursor })
    expect(last.changes.some((record: wire.WorkspaceV2Record) => record.id === late.id)).toBe(true)
  })
  it('rolls back final response serialization and denies a scope revoked during async body validation', async () => {
    const { domain, service, id, scoped, workspaceId, deviceId, secret, grant, repository } = await setup(); grant()
    domain.createTodoItems([makeTodo()])
    const original = service.repository.startSnapshot.bind(service.repository)
    const spy = vi.spyOn(service.repository, 'startSnapshot').mockImplementation(request => ({ ...original(request), invalid: BigInt(1) }))
    await expect(service.handle('snapshot.start', seal('snapshot.start', { ...id, ...scoped }, workspaceId, deviceId, secret, 1))).rejects.toThrow()
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_manifests').get()).toEqual({ n: 0 })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_devices').get()).toEqual({ n: 0 })
    spy.mockRestore()
    const pending = service.handle('snapshot.start', seal('snapshot.start', { ...id, ...scoped }, workspaceId, deviceId, secret, 2))
    repository.setDeviceGrants(deviceId, [])
    await expect(pending).rejects.toMatchObject({ code: 'scope_denied' })
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_devices').get()).toEqual({ n: 0 })
  })

  it('pages safely when false and the final cursor would cross the exact 256KiB budget', async () => {
    const { domain, repository, call, id, grant, scoped } = await setup(); grant()
    const todos = domain.createTodoItems(Array.from({ length: 16 }, () => makeTodo('base')))
    const initial = await call('sync', { ...scoped, cursor: 0, through: null, operations: [] })
    const request = { ...id, ...scoped, cursor: initial.cursor, through: null, operations: [] }
    let measured = 0
    expect(() => domain.native.transaction(() => {
      for (const todo of todos) domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('x'.repeat(15000), todo.id)
      const result = repository.synchronize(request)
      expect(result.changes).toHaveLength(16)
      measured = Buffer.byteLength(JSON.stringify(result))
      throw Error('measure rollback')
    })()).toThrow('measure rollback')
    const extra = 262145 - measured
    expect(extra).toBeGreaterThan(0)
    todos.forEach((todo, index) => domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('x'.repeat(15000 + Math.floor(extra / 16) + (index < extra % 16 ? 1 : 0)), todo.id))
    const first = await call('sync', request)
    expect(first.hasMore).toBe(true); expect(first.changes).toHaveLength(15)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(262144)
    const last = await call('sync', { ...request, cursor: first.cursor, through: first.through })
    expect(last.changes).toHaveLength(1); expect(last.hasMore).toBe(false)
    expect(Buffer.byteLength(JSON.stringify(last))).toBeLessThanOrEqual(262144)
  })

  it('uses encrypted production HTTP routes without notifying Capture or workspace UI', async () => {
    const { store, id, workspaceId, deviceId, secret } = await setup(), changed = vi.fn(), workspaceChanged = vi.fn()
    const server = new MobileSyncService(store, protector, changed, { onWorkspaceChanged: workspaceChanged }); servers.push(server)
    server.setWorkspaceV2Grants(deviceId, [{ scope: 'todo.full', write: false }])
    const status = await server.setEnabled(true), request = seal('capabilities', { ...id, clientScopes: ['todo.full'] }, workspaceId, deviceId, secret, 1)
    changed.mockClear(); workspaceChanged.mockClear()
    const response = await fetch(`http://127.0.0.1:${status.port}/workspace/v2/capabilities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
    expect(response.status).toBe(200)
    const envelope = await response.json() as wire.WorkspaceV2Envelope
    expect(unseal(envelope, request, secret).supportedScopes).toEqual(['todo.full'])
    expect(changed).not.toHaveBeenCalled(); expect(workspaceChanged).not.toHaveBeenCalled()
  })
})

describe('workspace v2 encrypted blob staging behind a future fake write adapter', () => {
  async function setupBlob() {
    const context = await setup(), key = randomBytes(32)
    let now = Date.UTC(2026, 9, 3), enabled = true
    const authorize = (deviceId: string) => { if (!enabled || deviceId !== context.deviceId) throw Error('revoked') }
    const blob = new WorkspaceV2BlobStore(context.domain.native, key, authorize, () => now)
    const start = (bytes: Buffer, uploadId = randomUUID()) => ({ ...context.id, uploadId, scope: 'todo.full' as const, entity: { kind: 'todo' as const, id: randomUUID() }, purpose: 'document' as const, sha256: sha(bytes), byteLength: bytes.length, mediaType: 'application/json' as const })
    return { ...context, blob, key, authorize, start, clock: () => now, advance: (ms: number) => { now += ms }, revoke: () => { enabled = false } }
  }
  it('persists out-of-order encrypted chunks, exact tails and immutable declarations across recreation', async () => {
    const { blob, domain, key, authorize, deviceId, start, clock } = await setupBlob()
    const bytes = Buffer.from('{"pad":"' + 'x'.repeat(131073 - 10) + '"}'), declaration = start(bytes), session = blob.start(declaration)
    expect(blob.start(declaration)).toEqual(session)
    expect(() => blob.start({ ...declaration, sha256: '0'.repeat(64) })).toThrow('不同内容')
    expect(() => blob.chunk(deviceId, session.sessionId, 0, sha(bytes.subarray(0, 1)), bytes.subarray(0, 1))).toThrow('长度')
    for (const index of [2, 0]) { const part = bytes.subarray(index * 65536, (index + 1) * 65536); blob.chunk(deviceId, session.sessionId, index, sha(part), part) }
    const restored = new WorkspaceV2BlobStore(domain.native, key, authorize, clock)
    expect(restored.status(deviceId, session.sessionId).receivedIndexes).toEqual([0, 2])
    expect(() => restored.commit(deviceId, session.sessionId, declaration.sha256, bytes.length)).toThrow('尚未完整')
    const middle = bytes.subarray(65536, 131072); restored.chunk(deviceId, session.sessionId, 1, sha(middle), middle)
    expect(restored.chunk(deviceId, session.sessionId, 1, sha(middle), middle)).toMatchObject({ byteLength: 65536 })
    const stored = domain.native.prepare('SELECT ciphertext FROM workspace_v2_chunks WHERE session_id=? AND chunk_index=1').get(session.sessionId) as { ciphertext: Buffer }
    expect(stored.ciphertext.includes(Buffer.from('x'.repeat(50)))).toBe(false)
    const committed = restored.commit(deviceId, session.sessionId, declaration.sha256, bytes.length)
    expect(restored.commit(deviceId, session.sessionId, declaration.sha256, bytes.length)).toEqual(committed)
    expect(() => restored.readReferenced(deviceId, { ...declaration.entity, revision: 1 }, declaration.sha256, 0)).toThrow('未引用')
    domain.native.transaction(() => restored.associate(deviceId, session.sessionId, { ...declaration.entity, revision: 1 }))()
    expect(restored.readReferenced(deviceId, { ...declaration.entity, revision: 1 }, declaration.sha256, 2).bytesBase64).toBe(bytes.subarray(131072).toString('base64'))
  })
  it('rolls back chunk confirmation on crash and rejects tampering before a commit', async () => {
    const { blob, domain, deviceId, start } = await setupBlob(), bytes = Buffer.from('{}'), declaration = start(bytes), session = blob.start(declaration)
    expect(() => domain.native.transaction(() => { blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes); throw Error('crash') })()).toThrow('crash')
    expect(blob.status(deviceId, session.sessionId).receivedIndexes).toEqual([])
    blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes)
    expect(() => blob.chunk(deviceId, session.sessionId, 0, sha(Buffer.from('[]')), Buffer.from('[]'))).toThrow('不同内容')
    domain.native.prepare('UPDATE workspace_v2_chunks SET ciphertext=? WHERE session_id=?').run(Buffer.from('xx'), session.sessionId)
    expect(() => blob.commit(deviceId, session.sessionId, declaration.sha256, bytes.length)).toThrow()
    expect(domain.native.prepare('SELECT committed_at FROM workspace_v2_uploads WHERE id=?').get(session.sessionId)).toEqual({ committed_at: null })
  })
  it('counts declared and committed-but-unassociated bytes and enforces two active sessions', async () => {
    const { blob, domain, deviceId, start } = await setupBlob(), bytes = Buffer.from('{}')
    const first = blob.start(start(bytes)), second = blob.start(start(bytes))
    expect(() => blob.start(start(bytes))).toThrow('空间')
    for (const session of [first, second]) { blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes); blob.commit(deviceId, session.sessionId, sha(bytes), 2) }
    domain.native.prepare('UPDATE workspace_v2_uploads SET byte_length=? WHERE id=?').run(268435455, first.sessionId)
    expect(() => blob.start(start(bytes))).toThrow('空间')
    expect(domain.native.prepare('SELECT COUNT(*) n FROM workspace_v2_uploads WHERE committed_at IS NOT NULL').get()).toEqual({ n: 2 })
  })
  it('expires idle or absolute sessions, retains associated originals and never reuses an expired upload ID', async () => {
    const { blob, domain, deviceId, start, advance } = await setupBlob(), bytes = Buffer.from('{}'), declaration = start(bytes), idle = blob.start(declaration)
    advance(86400000)
    expect(() => blob.status(deviceId, idle.sessionId)).toThrow('过期')
    blob.cleanup()
    expect(() => blob.start(declaration)).toThrow('过期')
    const durableDecl = start(bytes), durable = blob.start(durableDecl)
    blob.chunk(deviceId, durable.sessionId, 0, sha(bytes), bytes); blob.commit(deviceId, durable.sessionId, sha(bytes), bytes.length)
    expect(() => blob.associate(deviceId, durable.sessionId, { ...durableDecl.entity, revision: 1 })).toThrow('事务')
    domain.native.transaction(() => blob.associate(deviceId, durable.sessionId, { ...durableDecl.entity, revision: 1 }))()
    const orphan = blob.start(start(bytes)); blob.chunk(deviceId, orphan.sessionId, 0, sha(bytes), bytes); blob.commit(deviceId, orphan.sessionId, sha(bytes), bytes.length)
    advance(8 * 86400000); blob.cleanup()
    expect(domain.native.prepare('SELECT id FROM workspace_v2_uploads').all()).toEqual([{ id: durable.sessionId }])
    expect(blob.readReferenced(deviceId, { ...durableDecl.entity, revision: 1 }, sha(bytes), 0).bytesBase64).toBe(bytes.toString('base64'))
  })
  it('caps absolute TTL even when identical chunks keep the session active', async () => {
    const { blob, deviceId, start, advance } = await setupBlob()
    const bytes = Buffer.from('{"pad":"' + 'x'.repeat(65526) + '"}'), declaration = start(bytes), session = blob.start(declaration)
    blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes)
    for (let halfDay = 1; halfDay < 14; halfDay++) {
      advance(43200000)
      blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes)
    }
    advance(43200000)
    expect(() => blob.status(deviceId, session.sessionId)).toThrow('过期')
  })

  it('rechecks fake scope/device permission for status/chunk/commit/read after revocation', async () => {
    const { blob, domain, deviceId, start, revoke } = await setupBlob(), bytes = Buffer.from('{}'), declaration = start(bytes), session = blob.start(declaration)
    blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes); blob.commit(deviceId, session.sessionId, sha(bytes), 2)
    domain.native.transaction(() => blob.associate(deviceId, session.sessionId, { ...declaration.entity, revision: 1 }))()
    revoke()
    for (const call of [() => blob.status(deviceId, session.sessionId), () => blob.chunk(deviceId, session.sessionId, 0, sha(bytes), bytes), () => blob.commit(deviceId, session.sessionId, sha(bytes), 2), () => blob.readReferenced(deviceId, { ...declaration.entity, revision: 1 }, sha(bytes), 0)]) expect(call).toThrow('revoked')
  })
})
