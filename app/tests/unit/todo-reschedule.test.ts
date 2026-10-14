import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import type { CreateTodoInput, TodoItem } from '../../src/shared/domain'
import { canCopyTodoToToday, todoCopyToTodaySchema, type TodoCopyToTodayInput } from '../../src/shared/todo-reschedule'
const stores: WorkspaceStore[] = [], dirs: string[] = []
const today = '2026-10-05', yesterday = '2026-10-04'
beforeEach(() => vi.stubEnv('CREATOR_OS_TEST_DATE', today))
afterEach(async () => { vi.unstubAllEnvs(); stores.splice(0).forEach(store => store.close()); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'carryover-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store); return store.repository
}
const draft = (patch: Partial<CreateTodoInput> = {}): CreateTodoInput => ({ title: '昨天剪辑', projectId: null, stageKey: null, plannedDate: yesterday, segment: 'morning', category: 'self_media', trackingMode: 'progress', progress: 40, ...patch })
const request = (todos: TodoItem[]): TodoCopyToTodayInput => ({ requestId: randomUUID(), today, items: todos.map(todo => ({ todoId: todo.id, expectedUpdatedAt: todo.updatedAt })) })
describe('explicit manual carryover', () => {
  it('copies only selected IDs, preserves progress/links/extra and never changes time logs, daily snapshots or schedules', async () => {
    const repo = await setup()
    const todos = repo.createTodoItems([draft({ projectId: 'ios', stageKey: 'editing', isExtra: true }), draft({ title: '不复制' })])
    repo.setDailyWorkLogTotal(yesterday, 180, repo.getDailyWorkLog(yesterday))
    const schedules = repo.listScheduleItems(), stages = repo.getProject('ios', false).stageTimeRecords
    const snapshots = repo.native.prepare('SELECT * FROM todo_daily_snapshots').all()
    const result = repo.copyTodosToToday(request([todos[0]!]))
    const copied = repo.listTodoItems().find(todo => !todos.some(original => original.id === todo.id))!
    expect(result).toMatchObject({ count: 1, undoable: true })
    expect(copied).toEqual({ ...todos[0], id: copied.id, plannedDate: today, segment: null, createdAt: copied.createdAt, updatedAt: copied.updatedAt, scheduleSyncEnabled: false })
    expect(repo.listTodoItems().find(todo => todo.id === todos[0]!.id)).toEqual(todos[0])
    expect(repo.listTodoItems()).toHaveLength(todos.length + 1)
    expect(repo.listTodoItems().find(todo => todo.id === todos[1]!.id)).toEqual(todos[1])
    expect(repo.getDailyWorkLog(yesterday).totalMinutes).toBe(180)
    expect(repo.getDailyWorkLog(today).totalMinutes).toBeNull()
    expect(repo.native.prepare('SELECT * FROM todo_daily_snapshots').all()).toEqual(snapshots)
    expect(repo.listScheduleItems()).toEqual(schedules)
    expect(repo.getProject('ios', false).stageTimeRecords).toEqual(stages)
    repo.undoTodoCopy(result.operationId)
    expect(repo.listTodoItems()).toEqual(todos)
  })
  it('replays the same request without duplicating writes and rejects a replay after undo', async () => {
    const repo = await setup(), items = repo.createTodoItems([draft(), draft({ plannedDate: '2026-10-01' })]), input = request(items)
    const first = repo.copyTodosToToday(input), after = repo.listTodoItems()
    expect(repo.copyTodosToToday(input)).toEqual(first)
    expect(repo.listTodoItems()).toEqual(after)
    repo.undoTodoCopy(first.operationId)
    expect(() => repo.copyTodosToToday(input)).toThrow('已经撤销')
  })
  it.each(['completed', 'dismissed', 'changed', 'missing'] as const)('rejects entire batch for %s selection', async mode => {
    const repo = await setup(), items = repo.createTodoItems([draft(), draft({ title: '另一个' })]), input = request(items)
    if (mode === 'completed') repo.updateTodoItem(items[1]!.id, { completed: true })
    if (mode === 'dismissed') repo.dismissTodoItem(items[1]!.id)
    if (mode === 'changed') repo.updateTodoItem(items[1]!.id, { title: '并发修改' })
    if (mode === 'missing') input.items[1]!.todoId = randomUUID()
    expect(() => repo.copyTodosToToday(input)).toThrow('已变化')
    expect(repo.listTodoItems().find(todo => todo.id === items[0]!.id)).toEqual(items[0])
  })
  it('excludes today, future, undated, ranges, completed and scheduled tasks', async () => {
    const repo = await setup()
    const items = repo.createTodoItems([draft({ plannedDate: today }), draft({ plannedDate: '2026-10-06' }), draft({ plannedDate: null }), draft({ plannedDate: null, segment: null, dateRange: { startDate: '2026-10-01', endDate: yesterday, name: '范围' } }), draft({ progress: 100 })])
    for (const item of items) { expect(canCopyTodoToToday(item, today)).toBe(false); expect(() => repo.copyTodosToToday(request([item]))).toThrow('已变化') }
    const manual = repo.createTodoItems([draft()])[0]!
    repo.native.prepare("UPDATE todo_items SET source='schedule' WHERE id=?").run(manual.id)
    expect(() => repo.copyTodosToToday(request([manual]))).toThrow('已变化')
  })
  it('rolls back todo fields, audit and undo logs after a later write fails', async () => {
    const repo = await setup(), items = repo.createTodoItems([draft(), draft({ title: '失败任务' })])
    const db = new Database(stores.at(-1)!.databasePath)
    try {
      const events = db.prepare('SELECT * FROM todo_events').all(), undo = repo.getWorkspaceUndoState()
      db.exec(`CREATE TRIGGER fail_carryover BEFORE INSERT ON todo_items WHEN NEW.title='失败任务' BEGIN SELECT RAISE(ABORT,'injected failure'); END`)
      expect(() => repo.copyTodosToToday(request(items))).toThrow('injected failure')
      expect(repo.listTodoItems()).toEqual(items)
      expect(db.prepare('SELECT * FROM todo_events').all()).toEqual(events)
      expect(repo.getWorkspaceUndoState()).toEqual(undo)
    } finally { db.close() }
  })
  it('rejects stale today and strict/duplicate/empty/oversized payloads', async () => {
    const repo = await setup(), items = repo.createTodoItems([draft()]), input = request(items)
    expect(() => repo.copyTodosToToday({ ...input, today: yesterday })).toThrow('日期已变化')
    for (const invalid of [{ ...input, today: '2026-02-30' }, { ...input, completed: true }, { ...input, items: [] }, { ...input, items: [...input.items, ...input.items] }, { ...input, items: Array.from({ length: 101 }, () => ({ todoId: randomUUID(), expectedUpdatedAt: 'x' })) }]) expect(todoCopyToTodaySchema.safeParse(invalid).success).toBe(false)
  })
  it('undo is atomic and cannot overwrite a later progress change', async () => {
    const repo = await setup(), items = repo.createTodoItems([draft(), draft()])
    const result = repo.copyTodosToToday(request(items))
    const copy = repo.listTodoItems().find(todo => todo.plannedDate === today)!
    repo.updateTodoItem(copy.id, { progress: 60 })
    const current = repo.listTodoItems()
    expect(() => repo.undoTodoCopy(result.operationId)).toThrow('无法撤销')
    expect(repo.listTodoItems()).toEqual(current)
  })
  it('copies persist across reopening; completing a copy never changes its source', async () => {
    const repo = await setup(), [original] = repo.createTodoItems([draft()])
    repo.copyTodosToToday(request([original!]))
    const copy = repo.listTodoItems().find(todo => todo.plannedDate === today)!
    repo.updateTodoItem(copy.id, { completed: true })
    stores.pop()!.close()
    const reopened = await openWorkspaceStore(dirs.at(-1)!); stores.push(reopened)
    expect(reopened.repository.listTodoItems().find(todo => todo.id === original!.id)).toEqual(original)
    expect(reopened.repository.listTodoItems().find(todo => todo.id === copy.id)?.status).toBe('completed')
  })
  it('undo removes only the new copies even if the original was edited', async () => {
    const repo = await setup(), [original] = repo.createTodoItems([draft()])
    const result = repo.copyTodosToToday(request([original!]))
    repo.updateTodoItem(original!.id, { progress: 60 })
    const updated = repo.listTodoItems().find(todo => todo.id === original!.id)!
    repo.undoTodoCopy(result.operationId)
    expect(repo.listTodoItems()).toEqual([updated])
  })
  it('cannot undo an unrelated operation through the todo-only endpoint', async () => {
    const repo = await setup(), items = repo.createTodoItems([draft()])
    const result = repo.copyTodosToToday(request(items))
    expect(() => repo.undoTodoCopy(randomUUID())).toThrow('撤销记录已变化')
    repo.undoTodoCopy(result.operationId)
    expect(() => repo.undoTodoCopy(result.operationId)).toThrow('撤销记录已变化')
    repo.setProjectPinned('ios', !repo.getProject('ios', false).isPinned)
    const unrelated = repo.getWorkspaceUndoState()
    expect(unrelated.canUndo).toBe(true)
    expect(() => repo.undoTodoCopy(unrelated.operationId!)).toThrow('撤销记录已变化')
    expect(repo.getWorkspaceUndoState()).toEqual(unrelated)
  })
})
