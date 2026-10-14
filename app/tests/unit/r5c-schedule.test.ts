import { registerWorkspaceV2ProjectionFunctions } from '../../src/main/db/workspace-sync-v2-projections'
import BetterSqlite3 from 'better-sqlite3'
import { runMigrations } from '../../src/main/db/migrations'
import { groupScheduleItems } from '../../src/shared/schedule-group'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { RESPONSE_SCHEMAS, scheduleCreatePayloadSchema, scheduleUpdatePayloadSchema } from '../../src/shared/ipc'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-r5c-'))
  roots.push(directory)
  return openWorkspaceStore(directory)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('R5c schedule stage projection', () => {
  it('projects only enabled project modules into ordered project summaries', async () => {
    const store = await createStore()
    const sponsor = store.repository.listProjects().find((project) => project.id === 'sponsor')
    expect(sponsor?.enabledModuleKeys).toEqual(['materials', 'outline', 'script', 'shooting', 'editing', 'postproduction', 'publishing', 'business'])
    expect(RESPONSE_SCHEMAS.projectSummarySchema.parse(sponsor).enabledModuleKeys).toEqual(sponsor?.enabledModuleKeys)

    store.repository.setModule('sponsor', 'postproduction', false)
    expect(store.repository.listProjects().find((project) => project.id === 'sponsor')?.enabledModuleKeys).toEqual([
      'materials', 'outline', 'script', 'shooting', 'editing', 'publishing', 'business'
    ])
    store.close()
  })

  it('rejects unknown or disabled project stages at trusted boundaries', async () => {
    expect(() => scheduleCreatePayloadSchema.parse({
      projectId: 'ai-browser',
      title: '非法阶段',
      actionType: 'not-a-module',
      startAt: null,
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })).toThrow()

    const store = await createStore()
    store.repository.setModule('ai-browser', 'outline', false)
    expect(() => store.repository.createScheduleItem({
      projectId: 'ai-browser',
      title: '已停用大纲',
      actionType: 'outline',
      startAt: null,
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })).toThrow('所选项目阶段已停用')
    store.close()
  })

  it('accepts a project-level deadline and keeps it on the shared schedule record', async () => {
    const parsed = scheduleCreatePayloadSchema.parse({
      projectId: 'ai-browser',
      title: '预期完成',
      actionType: 'overview',
      startAt: '2026-07-31T18:00:00+08:00',
      endAt: null,
      scheduleKind: 'hard_deadline',
      waitingFor: null
    })
    const store = await createStore()
    const deadline = store.repository.createScheduleItem(parsed)
    expect(deadline).toMatchObject({ actionType: 'overview', scheduleKind: 'hard_deadline', source: 'synchronized' })
    expect(store.repository.moveScheduleItem(deadline.id, '2026-08-02T18:00:00+08:00', null).startAt).toContain('2026-08-02')
    expect(store.repository.getSnapshot().topics.find((topic) => topic.createdProjectId === 'ai-browser')?.expectedCompletionAt).toBe('2026-08-02')
    store.repository.deleteScheduleItem(deadline.id)
    expect(store.repository.getSnapshot().topics.find((topic) => topic.createdProjectId === 'ai-browser')?.expectedCompletionAt).toBeNull()
    store.close()
  })

  it('creates an obvious-colored schedule without binding a project', async () => {
    const parsed = scheduleCreatePayloadSchema.parse({
      projectId: null,
      colorToken: 'project-7',
      title: '取快递',
      actionType: 'overview',
      startAt: '2026-07-31T18:00:00+08:00',
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    const store = await createStore()
    const item = store.repository.createScheduleItem(parsed)
    expect(item).toMatchObject({ projectId: null, colorToken: 'project-7', title: '取快递', source: 'user' })
    expect(store.repository.getSnapshot().schedules.some((schedule) => schedule.id === item.id)).toBe(true)
    expect(store.repository.setScheduleColor(item.id, 'project-3').colorToken).toBe('project-3')
    store.close()
  })

  it('creates dated batches atomically with idempotency and whole-batch undo', async () => {
    const store = await createStore()
    const r = store.repository
    const base = { projectId: 'ai-browser', startAt: '2026-09-30T09:00:00+08:00', endAt: '2026-10-02T18:00:00+08:00', scheduleKind: 'plan' as const, waitingFor: null }
    const before = r.getSnapshot()
    r.setModule('ai-browser', 'outline', false)
    expect(() => r.createScheduleItems([{ ...base, actionType: 'script', title: '文案' }, { ...base, actionType: 'outline', title: '大纲' }])).toThrow('所选项目阶段已停用')
    expect(r.getSnapshot().schedules).toHaveLength(before.schedules.length)
    const input = [{ ...base, actionType: 'script' as const, title: '文案' }, { ...base, actionType: 'shooting' as const, title: '拍摄' }]
    const first = r.createScheduleItems(input, 'dated-multi-stage-test')
    expect(r.createScheduleItems(input, 'dated-multi-stage-test')).toEqual(first)
    expect(first).toHaveLength(2)
    expect(first.every(s => s.startAt === base.startAt && s.endAt === base.endAt)).toBe(true)
    expect(r.getSnapshot().todos).toEqual(before.todos)
    r.undoWorkspaceOperation()
    expect(r.getSnapshot().schedules).toHaveLength(before.schedules.length)
    store.close()
  })

  it('adds multiple unscheduled stages atomically', async () => {
    const store = await createStore()
    const items = store.repository.createScheduleItems([
      { projectId: 'ai-browser', title: '大纲', actionType: 'outline', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null },
      { projectId: 'ai-browser', title: '拍摄剪辑', actionType: 'shooting', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null },
      { projectId: 'ai-browser', title: '后期', actionType: 'postproduction', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null }
    ])
    expect(items).toHaveLength(3)
    const before = store.repository.getSnapshot().schedules.length
    store.repository.setModule('ai-browser', 'outline', false)
    expect(() => store.repository.createScheduleItems([
      { projectId: 'ai-browser', title: '文案', actionType: 'script', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null },
      { projectId: 'ai-browser', title: '大纲', actionType: 'outline', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null }
    ])).toThrow('所选项目阶段已停用')
    expect(store.repository.getSnapshot().schedules).toHaveLength(before)
    store.close()
  })

  it('replays one batch request without duplicates and removes the whole batch with workspace undo', async () => {
    const store = await createStore()
    const input = [
      { projectId: 'ai-browser', title: '大纲', actionType: 'outline' as const, startAt: null, endAt: null, scheduleKind: 'plan' as const, waitingFor: null },
      { projectId: 'ai-browser', title: '后期', actionType: 'postproduction' as const, startAt: null, endAt: null, scheduleKind: 'plan' as const, waitingFor: null }
    ]
    const requestId = 'f58b8224-939c-47ce-9d09-1a6fa06cdf3f'
    const first = store.repository.createScheduleItems(input, requestId)
    const replay = store.repository.createScheduleItems(input, requestId)
    expect(replay.map((item) => item.id)).toEqual(first.map((item) => item.id))
    expect(store.repository.getSnapshot().schedules.filter((item) => first.some((created) => created.id === item.id))).toHaveLength(2)

    expect(store.repository.getWorkspaceUndoState()).toMatchObject({ canUndo: true, commandType: 'schedule.batch-create' })
    store.repository.undoWorkspaceOperation()
    expect(store.repository.getSnapshot().schedules.filter((item) => first.some((created) => created.id === item.id))).toHaveLength(0)
    store.close()
  })
})


describe('R5e metadata edits keep one schedule and project facts independent', () => {
  it('updates only title/stage, preserves dates and completion, rejects disabled stages', async () => {
    const store = await createStore()
    const r = store.repository
    const item = r.createScheduleItem({ projectId: 'ios', title: '保留自定义名称', actionType: 'materials', startAt: '2026-07-18T09:00:00Z', endAt: '2026-07-20T09:00:00Z', scheduleKind: 'plan', waitingFor: null })
    r.setScheduleState(item.id, 'done')
    const project = r.getProject('ios', false)
    const next = r.updateScheduleItem(item.id, { actionType: 'script' })
    expect(next).toMatchObject({ id: item.id, title: item.title, startAt: item.startAt, endAt: item.endAt, state: 'done', actionType: 'script' })
    expect(r.getProject('ios', false).status).toBe(project.status)
    expect(r.updateScheduleItem(item.id, { title: ' 新标题 ' }).title).toBe('新标题')
    r.setModule('ios', 'postproduction', false)
    expect(() => r.updateScheduleItem(item.id, { actionType: 'postproduction' })).toThrow('停用')
    expect(() => r.updateScheduleItem(item.id, { title: ' ' })).toThrow()
    store.close()
  })
  it('protects free arrangements and target semantics at the trusted boundary', async () => {
    const store = await createStore(); const r = store.repository
    const free = r.createScheduleItem({ projectId: null, title: '自由安排', actionType: 'overview', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null })
    expect(() => r.updateScheduleItem(free.id, { actionType: 'script' })).toThrow('关联项目')
    const target = r.createScheduleItem({ projectId: 'ios', title: '目标日', actionType: 'overview', startAt: '2026-07-18T09:00:00Z', endAt: null, scheduleKind: 'hard_deadline', waitingFor: null })
    expect(() => r.updateScheduleItem(target.id, { actionType: 'script' })).toThrow('目标日')
    const publish = r.createScheduleItem({ projectId: 'ios', title: '发布', actionType: 'publishing', startAt: '2026-07-18T09:00:00Z', endAt: null, scheduleKind: 'publish_date', waitingFor: null })
    expect(r.updateScheduleItem(publish.id, { actionType: 'script' }).scheduleKind).toBe('plan')
    expect(() => r.moveScheduleItem(free.id, null, '2026-07-18T09:00:00Z')).toThrow('开始日期')
    expect(() => scheduleUpdatePayloadSchema.parse({ scheduleId: free.id, patch: { projectId: 'ios' } })).toThrow()
    expect(() => scheduleUpdatePayloadSchema.parse({ scheduleId: free.id, patch: { actionType: 'unknown' } })).toThrow()
    expect(() => scheduleUpdatePayloadSchema.parse({ scheduleId: free.id, patch: {} })).toThrow()
    store.close()
  })
})

it('groups only one dated batch and applies move, completion, rename and deletion atomically', async () => {
  const store = await createStore(), r = store.repository
  const input = (actionType: 'materials' | 'script') => ({ projectId: 'ai-browser', title: actionType === 'materials' ? '资料' : '文案', actionType, startAt: '2026-09-30T09:00:00Z', endAt: '2026-10-02T09:00:00Z', scheduleKind: 'plan' as const, waitingFor: null })
  const batch = r.createScheduleItems([input('materials'), input('script')])
  const separate = r.createScheduleItem(input('script'))
  expect(batch[0]!.groupId).toBeTruthy()
  expect(batch[1]!.groupId).toBe(batch[0]!.groupId)
  const labels = { materials: '资料', script: '文案' }
  expect(groupScheduleItems([...batch, separate], labels).map(item => item.title)).toEqual(['资料／文案', '文案'])
  r.moveScheduleItem(batch[1]!.id, '2026-10-03T09:00:00Z', '2026-10-06T09:00:00Z')
  const read = () => r.listScheduleItems().filter(item => item.groupId === batch[0]!.groupId)
  expect(read().every(item => item.startAt === '2026-10-03T09:00:00Z' && item.endAt === '2026-10-06T09:00:00Z')).toBe(true)
  expect(() => r.moveScheduleItem(batch[0]!.id, '2026-10-07T09:00:00Z', '2026-10-06T09:00:00Z')).toThrow()
  expect(read().every(item => item.startAt === '2026-10-03T09:00:00Z')).toBe(true)
  const db = new BetterSqlite3(store.databasePath)
  db.prepare('UPDATE schedule_items SET is_movable=0 WHERE id=?').run(batch[1]!.id)
  expect(() => r.moveScheduleItem(batch[0]!.id, '2026-10-10T09:00:00Z', null)).toThrow('不可移动')
  expect(read().every(item => item.startAt === '2026-10-03T09:00:00Z')).toBe(true)
  db.prepare('UPDATE schedule_items SET is_movable=1 WHERE id=?').run(batch[1]!.id); db.close()
  r.setScheduleState(batch[1]!.id, 'done')
  expect(read().every(item => item.state === 'done')).toBe(true)
  r.setScheduleState(batch[0]!.id, 'normal')
  expect(read().every(item => item.state === 'normal')).toBe(true)
  r.updateScheduleItem(batch[0]!.id, { title: '共同安排' })
  expect(groupScheduleItems(read(), labels)[0]!.title).toBe('共同安排·资料／文案')
  r.moveScheduleItem(batch[0]!.id, null, null)
  expect(read().every(item => item.startAt === null)).toBe(true)
  r.deleteScheduleItem(batch[0]!.id)
  expect(read()).toEqual([])
  expect(r.listScheduleItems().find(item => item.id === separate.id)).toEqual(separate)
  store.close()
})

it('backfills proven historical batches but not edited or independently created items', async () => {
  const store = await createStore(), r = store.repository
  const input = (actionType: 'materials' | 'script') => ({ projectId: 'ai-browser', title: actionType, actionType, startAt: '2026-09-30T09:00:00Z', endAt: null, scheduleKind: 'plan' as const, waitingFor: null })
  const batch = r.createScheduleItems([input('materials'), input('script')])
  const changed = r.createScheduleItems([input('materials'), input('script')])
  const separate = r.createScheduleItem(input('script'))
  const path = store.databasePath; store.close()
  const db = new BetterSqlite3(path)
  registerWorkspaceV2ProjectionFunctions(db)
  db.exec("DROP INDEX schedule_items_group_idx; ALTER TABLE schedule_items DROP COLUMN group_id; DELETE FROM schema_migrations WHERE id='0099_r27j_schedule_groups'")
  const logs = db.prepare("SELECT id,result_json,inverse_payload_json FROM operation_log WHERE command_type='schedule.batch-create'").all() as { id: string; result_json: string; inverse_payload_json: string }[]
  for (const log of logs) {
    const rows = JSON.parse(log.result_json).map((item: Record<string, unknown>) => { delete item.groupId; return item })
    db.prepare('UPDATE operation_log SET result_json=?,inverse_payload_json=? WHERE id=?').run(JSON.stringify(rows), JSON.stringify({ items: rows }), log.id)
  }
  db.prepare("UPDATE schedule_items SET updated_at='changed' WHERE id=?").run(changed[0]!.id)
  runMigrations(db)
  const group = (id: string) => (db.prepare('SELECT group_id FROM schedule_items WHERE id=?').get(id) as { group_id: string | null }).group_id
  expect(group(batch[0]!.id)).toBeTruthy()
  expect(group(batch[0]!.id)).toBe(group(batch[1]!.id))
  expect(group(changed[0]!.id)).toBeNull()
  expect(group(changed[1]!.id)).toBeNull()
  expect(group(separate.id)).toBeNull()
  const migrated = db.prepare("SELECT result_json,inverse_payload_json FROM operation_log WHERE id=?").get(group(batch[0]!.id)) as { result_json: string; inverse_payload_json: string }
  expect(JSON.parse(migrated.inverse_payload_json).items).toEqual(JSON.parse(migrated.result_json))
  runMigrations(db)
  expect(group(batch[0]!.id)).toBe(group(batch[1]!.id))
  db.close()
})
