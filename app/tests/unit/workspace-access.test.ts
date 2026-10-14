import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { WorkspaceSyncV2Service, deriveWorkspaceV2Key, type WorkspaceV2Purpose } from '../../src/main/workspace-sync-v2-service'
import { workspaceAccessGrantsSchema, workspaceAccessUpdateSchema } from '../../src/shared/workspace-access'
import * as wire from '../../src/shared/workspace-sync-v2'

const stores: WorkspaceStore[] = [], dirs: string[] = []
const protector = { isAvailable: () => true, encrypt: (value: string) => value, decrypt: (value: string) => value }
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'workspace-access-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store)
  const domain = store.repository, deviceId = randomUUID(), workspaceId = domain.getOrCreateMobileSyncServiceId(), secret = randomBytes(32)
  domain.trustMobileSyncDevice({ id: deviceId, name: '假授权设备', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const service = new WorkspaceSyncV2Service(domain, protector), repository = service.repository
  const scopes: wire.WorkspaceV2Scope[] = ['todo.full', 'work_log'], scoped = { scopes, scopeDigest: await wire.workspaceV2ScopeDigest(scopes) }
  let counter = 0
  const call = async (purpose: WorkspaceV2Purpose, extra: object) => {
    const request = { protocolVersion: 2, workspaceId, deviceId, ...extra }
    const base = { protocolVersion: 2 as const, workspaceId, serviceId: workspaceId, deviceId, purpose, requestId: randomUUID(), counter: ++counter }
    const nonce = randomBytes(12), key = deriveWorkspaceV2Key(secret, workspaceId), cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(Buffer.from(wire.workspaceV2Aad(base, 'request')))
    const envelope = { ...base, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(JSON.stringify(request)), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }
    const encrypted = await service.handle(purpose, envelope)
    wire.workspaceV2AssertResponseEnvelope(envelope, encrypted)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'))
    decipher.setAAD(Buffer.from(wire.workspaceV2Aad(envelope, 'response'))); decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8'))
  }
  const access = () => repository.getDeviceAccess(deviceId)
  const grant = (write: boolean) => repository.updateDeviceAccess({ deviceId, expectedRevision: access().revision, grants: scopes.map(scope => ({ scope: scope as 'todo.full' | 'work_log', write })) })
  const sync = (operations: wire.WorkspaceV2Operation[] = [], cursor = 0, through: number | null = null) => call('sync', { ...scoped, cursor, through, operations })
  return { domain, repository, deviceId, access, grant, call, scoped, sync }
}
function operation(): wire.WorkspaceV2Operation {
  const json = JSON.stringify({ title: '保存一小步', category: 'life', isExtra: false, plannedDate: '2026-10-03', segment: null, dateRange: null, projectId: null, stageKey: null, status: 'open', trackingMode: 'progress', progress: 37, progressBeforeComplete: null, completedAt: null })
  return { type: 'record', operationId: randomUUID(), localRevision: 1, kind: 'todo', id: randomUUID(), baseRevision: 0, base: null, next: { deleted: false, payload: { encoding: 'json', json, byteLength: Buffer.byteLength(json), sha256: createHash('sha256').update(json).digest('hex') } } }
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

describe('explicit local workspace access', () => {
  it('strictly validates four scopes, two editable scopes, unique sorted grants and CAS identity', () => {
    expect(workspaceAccessGrantsSchema.parse([{ scope: 'work_log', write: true }, { scope: 'todo.full', write: false }])).toEqual([{ scope: 'todo.full', write: false }, { scope: 'work_log', write: true }])
    for (const grants of [[{ scope: 'review', write: false }], [{ scope: 'project.catalog', write: true }], [{ scope: 'preferences.todo', write: true }], [{ scope: 'todo.full', write: false, read: true }], [{ scope: 'todo.full', write: false }, { scope: 'todo.full', write: false }]]) expect(workspaceAccessGrantsSchema.safeParse(grants).success).toBe(false)
    expect(workspaceAccessUpdateSchema.safeParse({ deviceId: randomUUID(), expectedRevision: 'a'.repeat(64), grants: [], permissions: [] }).success).toBe(false)
    expect(workspaceAccessUpdateSchema.safeParse({ deviceId: 'unknown', expectedRevision: 'a'.repeat(64), grants: [] }).success).toBe(false)
  })
  it('pairing grants nothing and unknown, legacy or revoked devices cannot read or modify access', async () => {
    const { domain, repository, deviceId, access, grant, call } = await setup()
    expect(access().grants).toEqual([])
    expect((await call('capabilities', { clientScopes: [...wire.WORKSPACE_V2_SCOPES] })).supportedScopes).toEqual([])
    const other = randomUUID(); domain.trustMobileSyncDevice({ id: other, name: '另一台', encryptedSecret: 'fake', identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
    grant(true); expect(repository.getDeviceAccess(other).grants).toEqual([])
    const legacy = randomUUID(); domain.addMobileSyncDevice({ id: legacy, name: '旧版', encryptedSecret: 'fake' })
    for (const id of [randomUUID(), legacy]) {
      expect(() => repository.getDeviceAccess(id)).toThrow('设备已撤销')
      expect(() => repository.updateDeviceAccess({ deviceId: id, expectedRevision: access().revision, grants: [] })).toThrow('设备已撤销')
    }
    const saved = access(); domain.revokeMobileSyncDevice(deviceId)
    expect(() => repository.updateDeviceAccess({ deviceId, expectedRevision: saved.revision, grants: [] })).toThrow('设备已撤销')
    await expect(call('capabilities', { clientScopes: [...wire.WORKSPACE_V2_SCOPES] })).rejects.toMatchObject({ status: 401 })
  })
  it('preserves no-ops and rejects stale revisions even after approval returns to the same values', async () => {
    const { domain, repository, deviceId, access, grant } = await setup(), initial = access()
    const originalStamp = repository.grantsStamp(deviceId)
    expect(repository.updateDeviceAccess({ deviceId, expectedRevision: initial.revision, grants: [] })).toEqual(initial)
    expect(repository.grantsStamp(deviceId)).toBe(originalStamp)
    const saved = grant(false), before = domain.native.prepare('SELECT * FROM workspace_v2_grants ORDER BY scope').all()
    expect(repository.updateDeviceAccess({ deviceId, expectedRevision: saved.revision, grants: [...saved.grants].reverse() })).toEqual(saved)
    expect(domain.native.prepare('SELECT * FROM workspace_v2_grants ORDER BY scope').all()).toEqual(before)
    expect(() => repository.updateDeviceAccess({ deviceId, expectedRevision: initial.revision, grants: [] })).toThrow('其他窗口')
    repository.updateDeviceAccess({ deviceId, expectedRevision: saved.revision, grants: [] })
    expect(access().grants).toEqual([]); expect(access().revision).not.toBe(initial.revision)
    expect(() => repository.updateDeviceAccess({ deviceId, expectedRevision: initial.revision, grants: initial.grants })).toThrow('其他窗口')
  })
  it('preserves progress proofs for permission changes, but invalidates stale metadata manifests', async () => {
    const { domain, repository, deviceId, access, grant, call, scoped, sync } = await setup(); grant(false)
    domain.createTodoItems([{ title: '本机待办', category: 'life', plannedDate: '2026-10-03', segment: null, projectId: null, trackingMode: 'checklist', progress: 0 }])
    const manifest = await call('snapshot.start', scoped)
    const page = await call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 100 })
    expect(page.records[0].metadata.write).toBe(false)
    await sync([], manifest.through)
    const state = () => ['workspace_v2_cursor_bindings', 'workspace_v2_windows'].map(table => domain.native.prepare(`SELECT * FROM ${table} WHERE device_id=?`).all(deviceId))
    const before = state(), unchanged = access()
    repository.updateDeviceAccess({ deviceId, expectedRevision: unchanged.revision, grants: unchanged.grants })
    expect((await call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 100 })).records).toEqual(page.records)
    grant(true); expect(state()).toEqual(before)
    await expect(call('snapshot.page', { manifestId: manifest.manifestId, after: null, limit: 100 })).rejects.toMatchObject({ code: 'manifest_expired' })
    expect((await sync([], manifest.through, manifest.through)).hasMore).toBe(false)
    const refreshed = await call('snapshot.start', scoped)
    expect((await call('snapshot.page', { manifestId: refreshed.manifestId, after: null, limit: 100 })).records[0].metadata.write).toBe(true)
    repository.updateDeviceAccess({ deviceId, expectedRevision: access().revision, grants: [] })
    expect(state()).toEqual(before)
    await expect(sync([], manifest.through)).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    grant(true)
    expect((await sync([], manifest.through, manifest.through)).hasMore).toBe(false)
    repository.updateDeviceAccess({ deviceId, expectedRevision: access().revision, grants: [...access().grants, { scope: 'project.catalog', write: false }] })
    expect((await sync([], manifest.through)).hasMore).toBe(false)
    const forged = ['preferences.todo', 'todo.full', 'work_log'] as wire.WorkspaceV2Scope[]
    await expect(call('sync', { scopes: forged, scopeDigest: await wire.workspaceV2ScopeDigest(forged), cursor: manifest.through, through: null, operations: [] })).rejects.toMatchObject({ code: 'scope_denied' })
    const expanded = ['project.catalog', 'todo.full', 'work_log'] as wire.WorkspaceV2Scope[]
    await expect(call('sync', { scopes: expanded, scopeDigest: await wire.workspaceV2ScopeDigest(expanded), cursor: manifest.through, through: null, operations: [] })).rejects.toMatchObject({ code: 'cursor_scope_mismatch' })
  })
  it('returns immutable lost receipts after downgrade but rejects new mutations until write is restored', async () => {
    const { domain, repository, deviceId, access, grant, sync } = await setup(); grant(true)
    const first = operation(), pending = operation(), accepted = (await sync([first])).receipts[0]
    grant(false)
    expect((await sync([first])).receipts[0]).toEqual(accepted)
    await expect(sync([{ ...first, localRevision: 2 }])).rejects.toMatchObject({ code: 'operation_reused', status: 409 })
    await expect(sync([pending])).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(domain.native.prepare('SELECT 1 FROM workspace_v2_receipts WHERE operation_id=?').get(pending.operationId)).toBeUndefined()
    repository.updateDeviceAccess({ deviceId, expectedRevision: access().revision, grants: [] })
    await expect(sync([first])).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    grant(true)
    expect((await sync([pending])).receipts[0].status).toBe('accepted')
    expect((await sync([first])).receipts[0]).toEqual(accepted)
    domain.revokeMobileSyncDevice(deviceId)
    await expect(sync([first])).rejects.toMatchObject({ status: 401 })
  })
  it('migrates grants without changing permissions, domain records or v1 history', () => {
    const database = new Database(':memory:')
    try {
      database.pragma('foreign_keys=ON'); runMigrationsThrough(database, '0103_m3_workspace_v2_domains')
      const id = randomUUID()
      database.prepare("INSERT INTO mobile_sync_devices(id,name,encrypted_secret,created_at,protocol_version,trust_state) VALUES(?,'test','fake','2026-10-03',2,'trusted_v2')").run(id)
      database.prepare("INSERT INTO workspace_v2_grants(device_id,scope,write_allowed,approved_at) VALUES(?,'todo.full',0,'2026-10-03')").run(id)
      const before = database.prepare('SELECT * FROM workspace_v2_grants').all(), legacy = database.prepare('SELECT * FROM workspace_sync_changes').all()
      runMigrations(database); runMigrations(database)
      expect(database.prepare('SELECT * FROM workspace_v2_grants').all()).toEqual(before)
      expect(database.prepare('SELECT * FROM workspace_v2_grant_revisions').all()).toEqual([])
      expect(database.prepare('SELECT * FROM workspace_sync_changes').all()).toEqual(legacy)
      expect(database.pragma('foreign_key_check')).toEqual([])
    } finally { database.close() }
  })
})
