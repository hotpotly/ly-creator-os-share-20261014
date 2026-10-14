import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import type { TodoItem, TodoStageTimeInput } from '../../src/shared/domain'
import { parseTodoBatch } from '../../src/shared/todo-parser'
import { recommendedTodoStageForProject } from '../../src/shared/todo-stage-recommendation'
import { summarizeTodoEstimates } from '../../src/shared/todo-duration'
import { todoStageTimePayloadSchema } from '../../src/shared/ipc'
const stores: WorkspaceStore[] = [], dirs: string[] = []
async function setup(): Promise<{ store: WorkspaceStore; todo: TodoItem }> {
  process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-21T15:00:00'
  process.env.CREATOR_OS_TEST_TIME_ZONE = 'Asia/Shanghai'
  const root = join(import.meta.dirname, '../../test-results/unit-r21ab'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'time-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store)
  store.repository.updateStageTime('ios', 'script', { startedAt: null, completedAt: null, source: 'manual' })
  const [todo] = store.repository.createTodoItems([{ title: '修改文案（4）', projectId: 'ios', stageKey: 'script', plannedDate: '2026-09-18', segment: 'morning', category: 'self_media', trackingMode: 'checklist', progress: 0 }])
  return { store, todo: todo! }
}
function request(store: WorkspaceStore, todo: TodoItem, patch: Partial<TodoStageTimeInput> = {}): TodoStageTimeInput {
  const stage = store.repository.getTodoProjectStages(todo.projectId!).find(item => item.key === todo.stageKey)!
  return { todoId: todo.id, projectId: todo.projectId!, stageKey: todo.stageKey!, expectedRevision: stage.revision, expectedTodoUpdatedAt: todo.updatedAt,
    action: 'start', startedAt: { localDate: '2026-09-18', segment: 'morning' }, completedAt: null,
    confirmedOpenTodoIds: store.repository.listTodoItems().filter(item => item.projectId === todo.projectId && item.stageKey === todo.stageKey && item.status === 'open').map(item => item.id), requestId: randomUUID(), ...patch }
}
afterEach(async () => { stores.splice(0).forEach(store => store.close()); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); delete process.env.CREATOR_OS_TEST_STAGE_DATETIME; delete process.env.CREATOR_OS_TEST_TIME_ZONE })

describe('R21ab restricted linked phase time', () => {
  it('starts without completing a todo, backfills completion and feeds the original review while keeping plan/effort unchanged', async () => {
    const { store, todo } = await setup(), repo = store.repository
    repo.createScheduleItem({ projectId: 'ios', title: '文案计划', actionType: 'script', startAt: '2026-09-17T09:00:00+08:00', endAt: '2026-09-19T17:00:00+08:00', scheduleKind: 'plan', waitingFor: null })
    const planBefore = repo.native.prepare("SELECT * FROM schedule_items WHERE project_id='ios'").all()
    const otherBefore = repo.listStageTimeRecords('ios').filter(item => item.stageKey !== 'script')
    const input = request(store, todo); expect(repo.setTodoLinkedStageTime(input)).toBe(true)
    expect(repo.listTodoItems().find(item => item.id === todo.id)).toEqual(todo)
    const end = request(store, todo, { action: 'complete', completedAt: { localDate: '2026-09-20', segment: 'evening' } })
    repo.setTodoLinkedStageTime(end)
    const review = repo.getProjectCreationReview('ios').stages.find(item => item.stageKey === 'script')!
    expect(review).toMatchObject({ startedAt: input.startedAt, completedAt: end.completedAt, plannedStartAt: { localDate: '2026-09-17' }, plannedEndAt: { localDate: '2026-09-19' }, actualEffortHalfDayUnits: null, status: 'completed' })
    expect(repo.native.prepare("SELECT * FROM schedule_items WHERE project_id='ios'").all()).toEqual(planBefore)
    expect(repo.listStageTimeRecords('ios').filter(item => item.stageKey !== 'script')).toEqual(otherBefore)
    expect(repo.native.prepare('SELECT count(*) n FROM daily_work_logs').get()).toEqual({ n: 0 })
    const correction = request(store, todo, { action: 'edit', startedAt: { localDate: '2026-09-17', segment: 'afternoon' }, completedAt: end.completedAt })
    repo.setTodoLinkedStageTime(correction)
    expect(repo.getProjectCreationReview('ios').stages.find(item => item.stageKey === 'script')?.startedAt).toEqual(correction.startedAt)
    expect(() => repo.setTodoLinkedStageTime(end)).toThrow('已变化')
    repo.setTodoLinkedStageCompleted({ todoId: todo.id, projectId: 'ios', stageKey: 'script', completed: false, expectedCompletedAt: repo.getTodoProjectStages('ios').find(item => item.key === 'script')!.completedAt, requestId: randomUUID() })
    expect(repo.getTodoProjectStages('ios').find(item => item.key === 'script')).toMatchObject({ startedAt: correction.startedAt, actualCompletedAt: null })
  })
  it('rejects stale stage and todo changes, invalid dates, future values, and end-before-start atomically', async () => {
    const { store, todo } = await setup(), repo = store.repository
    const before = repo.listStageTimeRecords('ios')
    for (const patch of [
      { startedAt: { localDate: '2026-02-30', segment: 'morning' as const } },
      { startedAt: { localDate: '2027-01-01', segment: 'morning' as const } },
      { action: 'edit' as const, completedAt: { localDate: '2026-09-17', segment: 'morning' as const } }
    ]) expect(() => repo.setTodoLinkedStageTime(request(store, todo, patch))).toThrow()
    expect(repo.listStageTimeRecords('ios')).toEqual(before)
    const stale = request(store, todo)
    repo.updateStageTime('ios', 'script', { startedAt: { localDate: '2026-09-16', segment: 'morning' }, source: 'manual' })
    expect(() => repo.setTodoLinkedStageTime(stale)).toThrow('阶段时间已变化')
    const staleTodo = request(store, todo, { action: 'edit' })
    repo.updateTodoItem(todo.id, { projectId: null })
    expect(() => repo.setTodoLinkedStageTime(staleTodo)).toThrow('关联已变化')
  })
  it('requires the exact open todo set and never manufactures a start when only completing', async () => {
    const { store, todo } = await setup(), repo = store.repository
    const input = request(store, todo, { action: 'complete', startedAt: null, completedAt: { localDate: '2026-09-20', segment: 'afternoon' }, confirmedOpenTodoIds: [] })
    expect(() => repo.setTodoLinkedStageTime(input)).toThrow('清单已变化')
    expect(repo.getTodoProjectStages('ios').find(item => item.key === 'script')?.actualCompletedAt).toBeNull()
    repo.setTodoLinkedStageTime({ ...input, confirmedOpenTodoIds: [todo.id] })
    expect(repo.getTodoProjectStages('ios').find(item => item.key === 'script')).toMatchObject({ startedAt: null, actualCompletedAt: input.completedAt })
    expect(repo.listTodoItems().find(item => item.id === todo.id)?.status).toBe('open')
  })
  it('rejects hidden/dismissed targets and narrow IPC cannot modify plans or actual effort', async () => {
    const { store, todo } = await setup(), repo = store.repository
    const input = request(store, todo)
    expect(todoStageTimePayloadSchema.safeParse({ ...input, actualEffortHalfDayUnits: 8 }).success).toBe(false)
    expect(todoStageTimePayloadSchema.safeParse({ ...input, planEdit: {} }).success).toBe(false)
    repo.native.prepare("UPDATE project_modules SET enabled=0 WHERE project_id='ios' AND module_key='script'").run()
    expect(() => repo.setTodoLinkedStageTime(input)).toThrow('隐藏')
    repo.native.prepare("UPDATE project_modules SET enabled=1 WHERE project_id='ios' AND module_key='script'").run()
    repo.dismissTodoItem(todo.id)
    expect(() => repo.setTodoLinkedStageTime(input)).toThrow('不存在')
  })
})

describe('R21ab estimates and creation recommendations', () => {
  it('only prefills a unique enabled stage, not ambiguous/disabled/unlinked actions', () => {
    const project = { id: 'oppo', title: 'OPPO', enabledModuleKeys: ['script', 'shooting', 'editing'] }
    expect(parseTodoBatch('OPPO粗剪（4）', { today: '2026-09-21', projects: [project] })[0]).toMatchObject({ projectId: 'oppo', stageKey: 'editing' })
    expect(recommendedTodoStageForProject('OPPO拍摄和剪辑', project)).toBeNull()
    expect(recommendedTodoStageForProject('OPPO字幕', project)).toBeNull()
    expect(recommendedTodoStageForProject('OPPO沟通', project)).toBeNull()
    expect(parseTodoBatch('粗剪（4）', { today: '2026-09-21', projects: [project] })[0]?.stageKey).toBeUndefined()
  })
  it('sums current unique titles, keeps missing distinct from zero, does not multiply progress or add events', async () => {
    const { todo } = await setup()
    const rows = [todo, todo, { ...todo, id: 'two', title: '剪辑（2）', status: 'completed' as const }, { ...todo, id: 'three', title: '拍摄（10）', progress: 80 }, { ...todo, id: 'four', title: '没填', status: 'completed' as const }, { ...todo, id: 'ignored', title: '忽略（99）', status: 'dismissed' as const }]
    expect(summarizeTodoEstimates(rows)).toEqual({ totalMinutes: 960, completedMinutes: 120, totalCount: 4, filledCount: 3, completedCount: 2, completedFilledCount: 1, missingCount: 1 })
    expect(summarizeTodoEstimates([{ ...todo, title: '未填' }])).toMatchObject({ totalMinutes: null, completedMinutes: null })
    expect(summarizeTodoEstimates([{ ...todo, title: '零（0）', status: 'completed' }])).toMatchObject({ totalMinutes: 0, completedMinutes: 0 })
  })
})
