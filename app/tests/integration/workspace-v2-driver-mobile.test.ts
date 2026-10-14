import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { WorkspaceV2Repository } from '../../src/main/db/workspace-sync-v2-repository'
import { MobileSyncService } from '../../src/main/mobile-sync-service'
import { runFlutterFixture } from './helpers/flutter-fixture'

let store: WorkspaceStore | null = null
let service: MobileSyncService | null = null
let control: Server | null = null
let directory: string | null = null

afterEach(async () => {
  await service?.stop()
  service = null
  if (control) await new Promise<void>(resolve => control!.close(() => resolve()))
  control = null
  store?.close()
  store = null
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = null
})

it.each(['driver', 'engine', 'copy'] as const)('runs the production phone %s through retained drafts and grant recovery', async (mode) => {
  const root = join(import.meta.dirname, '../../test-results/integration')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'workspace-v2-driver-'))
  store = await openWorkspaceStore(join(directory, 'mac'))
  const domain = store.repository
  const secret = randomBytes(32), token = randomBytes(32).toString('hex'), deviceId = randomUUID()
  const workspaceId = domain.getOrCreateMobileSyncServiceId()
  domain.trustMobileSyncDevice({ id: deviceId, name: 'v2-driver-fixture', encryptedSecret: secret.toString('base64'), identityPublicKey: randomBytes(32).toString('base64'), upgradeDeviceId: null })
  const input = { plannedDate: '2026-10-03', segment: 'morning' as const, category: 'self_media' as const, projectId: null, trackingMode: 'progress' as const, progress: 37 }
  const todo = domain.createTodoItems([{ ...input, title: 'Driver task' }])[0]!
  const large = domain.createTodoItems([{ ...input, title: 'Historical original' }])[0]!
  domain.native.prepare('UPDATE todo_items SET title=? WHERE id=?').run('x'.repeat(80000), large.id)
  const repository = new WorkspaceV2Repository(domain)
  const grants = (write: boolean): void => repository.setDeviceGrants(deviceId, [
    { scope: 'todo.full', write }, { scope: 'work_log', write },
    { scope: 'project.catalog', write: false }, { scope: 'preferences.todo', write: false }
  ])
  grants(false)
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
      if (body.action === 'writable') grants(true)
      else if (body.action === 'readonly') grants(false)
      else if (mode === 'copy' && body.action === 'delete') domain.dismissTodoItem(todo.id)
      else if (!['state', 'finished'].includes(body.action)) throw new Error('Unknown fixture action')
      const value = {
        todo: domain.listTodoItems(true).find(item => item.id === todo.id),
        todos: mode === 'copy' ? domain.listTodoItems().filter(item => item.id !== large.id) : undefined,
        eventCount: (domain.native.prepare('SELECT COUNT(*) AS n FROM todo_events WHERE todo_id=?').get(todo.id) as { n: number }).n
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    } catch (error) { response.writeHead(500).end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => control!.listen(0, '127.0.0.1', resolve))
  const fixture = Buffer.from(JSON.stringify({
    address: `127.0.0.1:${status.port}`, controlAddress: `127.0.0.1:${(control.address() as { port: number }).port}`, token,
    deviceId, workspaceId, secretBase64: secret.toString('base64'), databasePath: join(directory, 'phone.sqlite'), todoId: todo.id, largeTodoId: large.id
  })).toString('base64')
  const result = await runFlutterFixture(`test/workspace_v2_${mode}_live_test.dart`, 'WORKSPACE_V2_DRIVER_FIXTURE', fixture)
  expect(result.code, result.output).toBe(0)
  expect(result.output).toContain(`LIVE_WORKSPACE_V2_${mode.toUpperCase()}_PASSED`)
  expect(actions.at(-1)).toBe('finished')
  if (mode === 'copy') {
    expect(domain.listTodoItems().find(item => item.id === todo.id)).toBeUndefined()
    const copied = domain.listTodoItems().filter(item => item.id !== large.id)
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({ title: 'Recovered task', progress: 67, source: 'manual' })
    expect(copied[0]!.id).not.toBe(todo.id)
  } else expect(domain.listTodoItems().find(item => item.id === todo.id)).toMatchObject({ title: 'Retained draft', progress: 67 })
  expect(domain.listTodoItems().find(item => item.id === large.id)?.title).toBe('x'.repeat(80000))
}, 360_000)
