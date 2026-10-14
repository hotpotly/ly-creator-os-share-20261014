import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { WorkspaceV2Repository } from '../../src/main/db/workspace-sync-v2-repository'
import { MobileSyncService } from '../../src/main/mobile-sync-service'
import { runFlutterFixture } from './helpers/flutter-fixture'

let store: WorkspaceStore | null = null, service: MobileSyncService | null = null, control: Server | null = null, directory: string | null = null

afterEach(async () => {
  await service?.stop(); service = null
  if (control) await new Promise<void>(resolve => control!.close(() => resolve()))
  control = null
  store?.close(); store = null
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = null
})

it('upgrades real v1 SQLite records through authenticated v2 snapshots and resumable JSON chunks', async () => {
  const root = join(import.meta.dirname, '../../test-results/integration')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'workspace-v2-dart-'))
  store = await openWorkspaceStore(join(directory, 'mac'))
  const domain = store.repository, secret = randomBytes(32), token = randomBytes(32).toString('hex'), deviceId = randomUUID()
  const workspaceId = domain.getOrCreateMobileSyncServiceId(), mobileTodoId = randomUUID()
  domain.trustMobileSyncDevice({ id: deviceId, name: 'v2-integration-fixture', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const todo = domain.createTodoItems([{ title: 'Historical long body', plannedDate: '2026-10-03', segment: 'evening', category: 'self_media', projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 42, isExtra: true }])[0]!
  domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('x'.repeat(80000), todo.id)
  domain.setDailyWorkLog('2026-10-03', { selfMediaMinutes: 90, aiMinutes: 30, otherWorkMinutes: 15 })
  const captures = (domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n
  const sync = new WorkspaceV2Repository(domain)
  service = new MobileSyncService(store, { isAvailable: () => true, encrypt: value => value, decrypt: value => value }, () => undefined)
  const status = await service.setEnabled(true)
  const actions: string[] = []
  control = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { action: string }
      actions.push(body.action)
      if (body.action === 'grant') sync.setDeviceGrants(deviceId, [{ scope: 'todo.full', write: false }, { scope: 'work_log', write: false }])
      else if (body.action === 'edit-after-snapshot') domain.updateTodoItem(todo.id, { title: 'after fixed snapshot' })
      else if (body.action === 'revoke') domain.revokeMobileSyncDevice(deviceId)
      else if (body.action !== 'finished') throw new Error('Unknown fixture action')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
    } catch (error) { response.writeHead(500).end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => control!.listen(0, '127.0.0.1', resolve))
  const fixture = Buffer.from(JSON.stringify({
    address: `127.0.0.1:${status.port}`, controlAddress: `127.0.0.1:${(control.address() as { port: number }).port}`, token,
    deviceId, workspaceId, secretBase64: secret.toString('base64'), databasePath: join(directory, 'phone.sqlite'), macTodoId: todo.id, mobileTodoId
  })).toString('base64')
  const result = await runFlutterFixture('test/workspace_v2_live_test.dart', 'WORKSPACE_V2_LIVE_FIXTURE', fixture)
  expect(result.code, result.output).toBe(0)
  expect(result.output).toContain('LIVE_WORKSPACE_V2_PASSED')
  expect(actions).toEqual(['grant', 'edit-after-snapshot', 'revoke', 'finished'])
  expect((domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n).toBe(captures)
}, 360_000)
