import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { WorkspaceV2BlobStore } from '../../src/main/db/workspace-sync-v2-blobs'
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

it('synchronizes complete mobile tasks, retained successors, terminal rejections and original JSON against the real Mac domain', async () => {
  const root = join(import.meta.dirname, '../../test-results/integration')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'workspace-v2-domain-dart-'))
  store = await openWorkspaceStore(join(directory, 'mac'))
  const domain = store.repository, secret = randomBytes(32), token = randomBytes(32).toString('hex'), deviceId = randomUUID()
  const workspaceId = domain.getOrCreateMobileSyncServiceId(), mobileTodoId = randomUUID(), rejectedTodoId = randomUUID()
  domain.trustMobileSyncDevice({ id: deviceId, name: 'v2-domain-fixture', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const input = { plannedDate: '2026-10-03', segment: 'evening' as const, category: 'self_media' as const, projectId: 'ios', stageKey: 'script' as const, trackingMode: 'progress' as const, progress: 37, isExtra: true }
  const todo = domain.createTodoItems([{ ...input, title: 'Mac task' }])[0]!
  const longTodo = domain.createTodoItems([{ ...input, title: 'Long historical task' }])[0]!
  domain.native.prepare('UPDATE todo_items SET title=?,progress=12.25 WHERE id=?').run('x'.repeat(80000), longTodo.id)
  domain.setDailyWorkLog('2026-10-03', { selfMediaMinutes: 90, aiMinutes: 30, otherWorkMinutes: 15 })
  const captureCount = (domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n
  const stageBefore = domain.getTodoProjectStages('ios').find(stage => stage.key === 'script')
  const sync = new WorkspaceV2Repository(domain)
  sync.setDeviceGrants(deviceId, [
    { scope: 'todo.full', write: true }, { scope: 'work_log', write: true },
    { scope: 'project.catalog', write: false }, { scope: 'preferences.todo', write: false }
  ])
  service = new MobileSyncService(store, { isAvailable: () => true, encrypt: value => value, decrypt: value => value }, () => undefined)
  const status = await service.setEnabled(true)
  const actions: string[] = []
  control = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk)
        if (size > 4096) { response.writeHead(413).end(); return }
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { action: string }
      actions.push(body.action)
      if (body.action === 'edit-mac-category') domain.updateTodoItem(todo.id, { category: 'life' })
      else if (body.action === 'edit-mac-progress') domain.updateTodoItem(todo.id, { progress: 51 })
      else if (body.action === 'archive-project') domain.setProjectLifecycle('ios', 'archived')
      else if (body.action === 'restore-project') domain.setProjectLifecycle('ios', 'project_created')
      else if (body.action === 'expire-upload') {
        domain.native.prepare('UPDATE workspace_v2_uploads SET created_at=?,last_activity=? WHERE device_id=? AND committed_at IS NULL').run(Date.now() - 8 * 86400000, Date.now() - 2 * 86400000, deviceId)
        new WorkspaceV2BlobStore(domain.native, Buffer.alloc(32, 1), () => {}).cleanup()
      }
      else if (!['state', 'finished'].includes(body.action)) throw new Error('Unknown fixture action')
      const relevantIds = [todo.id, longTodo.id, mobileTodoId, rejectedTodoId]
      const result = {
        ok: true,
        todos: domain.listTodoItems().filter(item => relevantIds.includes(item.id)),
        events: Object.fromEntries(relevantIds.map(id => [id, (domain.native.prepare('SELECT COUNT(*) AS n FROM todo_events WHERE todo_id=?').get(id) as { n: number }).n])),
        workLog: domain.getDailyWorkLog('2026-10-03')
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    } catch (error) { response.writeHead(500).end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => control!.listen(0, '127.0.0.1', resolve))
  const fixture = Buffer.from(JSON.stringify({
    address: `127.0.0.1:${status.port}`, controlAddress: `127.0.0.1:${(control.address() as { port: number }).port}`, token,
    deviceId, workspaceId, secretBase64: secret.toString('base64'), databasePath: join(directory, 'phone.sqlite'),
    macTodoId: todo.id, longTodoId: longTodo.id, mobileTodoId, rejectedTodoId
  })).toString('base64')
  const result = await runFlutterFixture('test/workspace_v2_domain_live_test.dart', 'WORKSPACE_V2_DOMAIN_FIXTURE', fixture)
  expect(result.code, result.output).toBe(0)
  expect(result.output).toContain('LIVE_WORKSPACE_V2_DOMAIN_PASSED')
  expect(actions).toContain('expire-upload')
  expect(actions).toContain('archive-project')
  expect(actions).toContain('restore-project')
  expect(actions.at(-1)).toBe('finished')
  expect(domain.listTodoItems().find(item => item.id === mobileTodoId)).toMatchObject({ progress: 67, progressBeforeComplete: 67, trackingMode: 'progress', status: 'open' })
  expect(domain.listTodoItems().find(item => item.id === longTodo.id)).toMatchObject({ title: 'x'.repeat(80000), progress: 12.25, category: 'life' })
  expect(domain.getTodoProjectStages('ios').find(stage => stage.key === 'script')?.completedAt).toBe(stageBefore?.completedAt)
  expect((domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n).toBe(captureCount)
}, 360_000)
