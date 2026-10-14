import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { WorkspaceSyncRepository } from '../../src/main/db/workspace-sync-repository'
import { MobileSyncService } from '../../src/main/mobile-sync-service'
import { runFlutterFixture } from './helpers/flutter-fixture'
import type { UpdateTodoInput } from '../../src/shared/domain'

let store: WorkspaceStore | null = null, service: MobileSyncService | null = null, control: Server | null = null, directory: string | null = null

afterEach(async () => {
  await service?.stop(); service = null
  if (control) await new Promise<void>((resolve) => control!.close(() => resolve()))
  control = null
  store?.close(); store = null
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = null
})

it('round-trips Mac HTTP/AES domain changes through the real Dart SQLite store and client', async () => {
  const root = join(import.meta.dirname, '../../test-results/integration')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'workspace-dart-live-'))
  store = await openWorkspaceStore(join(directory, 'mac'))
  const domain = store.repository, secret = randomBytes(32), token = randomBytes(32).toString('hex'), deviceId = randomUUID()
  const workspaceId = domain.getOrCreateMobileSyncServiceId(), mobileTodoId = randomUUID()
  domain.trustMobileSyncDevice({ id: deviceId, name: 'integration-fixture', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const macTodo = domain.createTodoItems([{ title: 'Mac待办原文', plannedDate: '2026-10-03', segment: 'evening', category: 'self_media', projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 42, isExtra: true }])[0]!
  const macDeletedTodo = domain.createTodoItems([{ title: 'Mac删除冲突原文', plannedDate: '2026-10-03', segment: null, category: 'life', projectId: null, trackingMode: 'checklist', progress: 0 }])[0]!
  domain.setDailyWorkLog('2026-10-03', { selfMediaMinutes: 90, aiMinutes: 30, otherWorkMinutes: 15 })
  const captureCount = (domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n
  const captureChanged = vi.fn(), workspaceChanged = vi.fn(), sync = new WorkspaceSyncRepository(domain)
  service = new MobileSyncService(store, { isAvailable: () => true, encrypt: value => value, decrypt: value => value }, captureChanged, { onWorkspaceChanged: workspaceChanged })
  const status = await service.setEnabled(true)
  const actions: string[] = []
  let measurement: { changes: number; mode: string; requestBytes: number; responseBytes: number; totalBytes: number } | undefined
  control = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { action: string; id?: string; patch?: UpdateTodoInput; measurement?: typeof measurement }
      let result: unknown = { ok: true }
      actions.push(body.action)
      if (body.action === 'edit') domain.updateTodoItem(body.id!, body.patch!)
      else if (body.action === 'delete') domain.dismissTodoItem(body.id!)
      else if (body.action === 'seed-complex') result = { id: domain.createTodoItems([{ title: '复杂关联任务', plannedDate: '2026-10-03', segment: 'evening', category: 'self_media', projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 35 }])[0]!.id }
      else if (body.action === 'seed-large') result = { ids: [0, 1].flatMap(batch => domain.createTodoItems(Array.from({ length: 50 }, (_, index) => ({ title: `${batch}-${index}-${'x'.repeat(980)}`, plannedDate: '2026-10-03', segment: null, category: 'self_media' as const, projectId: null, trackingMode: 'checklist' as const, progress: 0 })))).map(item => item.id) }
      else if (body.action === 'measurement') measurement = body.measurement
      else if (body.action === 'revoke') domain.revokeMobileSyncDevice(deviceId)
      else if (body.action === 'inspect') result = {
        todo: body.id ? sync.latest('todo', body.id) : null,
        workLog: domain.getDailyWorkLog('2026-10-03'),
        events: body.id ? (domain.native.prepare('SELECT COUNT(*) AS n FROM todo_events WHERE todo_id=?').get(body.id) as { n: number }).n : null,
        captures: (domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n,
        captureChanged: captureChanged.mock.calls.length,
        receiptOperationIds: (domain.native.prepare('SELECT operation_id FROM workspace_sync_receipts WHERE device_id=?').all(deviceId) as { operation_id: string }[]).map(row => row.operation_id),
        counter: (domain.native.prepare('SELECT counter FROM workspace_sync_devices WHERE device_id=?').get(deviceId) as { counter: number } | undefined)?.counter ?? 0
      }
      else if (body.action !== 'finished') throw new Error('Unknown fixture command')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    } catch (error) { response.writeHead(500).end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => control!.listen(0, '127.0.0.1', resolve))
  const controlPort = (control.address() as { port: number }).port
  const fixture = Buffer.from(JSON.stringify({
    address: `127.0.0.1:${status.port}`, controlAddress: `127.0.0.1:${controlPort}`, token,
    deviceId, workspaceId, secretBase64: secret.toString('base64'),
    databasePath: join(directory, 'phone.sqlite'), macTodoId: macTodo.id, macDeletedTodoId: macDeletedTodo.id, mobileTodoId, captureCount
  })).toString('base64')
  const output = await runFlutterFixture('test/workspace_live_sync_test.dart', 'WORKSPACE_LIVE_FIXTURE', fixture)
  expect(output.code, output.output).toBe(0)
  expect(output.output).toContain('LIVE_WORKSPACE_SYNC_PASSED')
  expect(actions).toContain('finished')
  expect(measurement).toMatchObject({ changes: 100, mode: '100 sequential HTTP exchanges' })
  expect(measurement!.requestBytes).toBeGreaterThan(0)
  expect(measurement!.responseBytes).toBeGreaterThan(0)
  expect(measurement!.totalBytes).toBe(measurement!.requestBytes + measurement!.responseBytes)
  expect(measurement!.totalBytes).toBeLessThanOrEqual(1024 * 1024)
  await writeFile(join(root, 'workspace-mobile-sync-measurement.json'), JSON.stringify({ measuredAt: new Date().toISOString(), scope: 'UTF-8 plaintext application JSON requests plus responses; excludes encrypted envelopes, HTTP headers and carrier traffic', ...measurement }, null, 2))
  expect(sync.latest('todo', mobileTodoId)?.deleted).toBe(true)
  expect(sync.latest('todo', macDeletedTodo.id)?.deleted).toBe(true)
  expect(domain.getDailyWorkLog('2026-10-03').updatedAt).toBe('')
  expect(captureChanged).not.toHaveBeenCalled()
  expect(workspaceChanged.mock.calls.length).toBeGreaterThanOrEqual(5)
  expect((domain.native.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n).toBe(captureCount)
}, 360_000)
