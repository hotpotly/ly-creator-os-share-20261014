import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { listTodoDays, writeTodoDay } from '../../src/main/db/todo-day-repository'
import { defaultTodoDay, todoDayWriteSchema } from '../../src/shared/todo-day'
import { todoCreateBatchPayloadSchema, todoUpdatePayloadSchema } from '../../src/shared/ipc'
import { calculateDailyTodoGrowth } from '../../src/shared/todo-growth'
import type { CreateTodoInput } from '../../src/shared/domain'
const dirs: string[] = [], stores: WorkspaceStore[] = []
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'todo-day-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store); return store.repository
}
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
const input = (isExtra = false): CreateTodoInput => ({ title: '整理素材', plannedDate: '2026-10-02', segment: null, category: 'self_media', projectId: null, trackingMode: 'progress', progress: 35, isExtra })
describe('daily small step and extra todos', () => {
  it('preserves old rows as regular and extra progress through reopen', async () => {
    const r = await setup(), old = r.listTodoItems()
    expect(old.every(t => !t.isExtra)).toBe(true)
    const [extra] = r.createTodoItems([input(true)])
    const completed = r.updateTodoItem(extra!.id, { completed: true })
    expect(completed.isExtra).toBe(true)
    expect(completed.updatedAt).not.toBe(extra!.updatedAt)
    expect(() => r.updateTodoItem(extra!.id, { completed: false, expectedUpdatedAt: 'stale' })).toThrow('其他窗口')
    expect(r.updateTodoItem(extra!.id, { completed: false })).toMatchObject({ isExtra: true, progress: 35 })
    const reopened = await openWorkspaceStore(dirs[0]!); stores.push(reopened)
    expect(reopened.repository.listTodoItems().find(t => t.id === extra!.id)?.isExtra).toBe(true)
    expect(r.updateTodoItem(extra!.id, { isExtra: false })).toMatchObject({ isExtra: false, progress: 35 })
  })
  it('stores days independently and rejects stale changes without overwriting', async () => {
    const r = await setup(), day = '2026-10-02'
    expect(defaultTodoDay(day)).toMatchObject({ view: 'small', entered: false, showExtra: false, revision: 0 })
    const first = writeTodoDay(r.native, { day, expectedRevision: 0, patch: { smallStep: '打开文档', entered: true } })
    const second = writeTodoDay(r.native, { day, expectedRevision: 1, patch: { smallCompleted: true, view: 'regular' } })
    expect(second.smallStep).toBe(first.smallStep)
    expect(() => writeTodoDay(r.native, { day, expectedRevision: 1, patch: { smallStep: '旧窗口内容' } })).toThrow('其他窗口')
    writeTodoDay(r.native, { day: '2026-10-03', expectedRevision: 0, patch: { view: 'regular' } })
    expect(listTodoDays(r.native)).toHaveLength(2)
    const reverted = writeTodoDay(r.native, { day, expectedRevision: 2, patch: { smallCompleted: false, view: 'small' } })
    expect(reverted).toMatchObject({ smallStep: '打开文档', smallCompleted: false, revision: 3 })
    const reopened = await openWorkspaceStore(dirs[0]!); stores.push(reopened)
    expect(listTodoDays(reopened.repository.native)[0]).toEqual(reverted)
    expect(listTodoDays(reopened.repository.native)[1]?.entered).toBe(false)
  })
  it('rejects invalid dates, empty steps, negative revisions and unknown fields', () => {
    for (const value of [{ day: '2026-02-30', expectedRevision: 0, patch: {} }, { day: '2026-10-02', expectedRevision: -1, patch: {} }, { day: '2026-10-02', expectedRevision: 0, patch: { smallStep: ' ' } }, { day: '2026-10-02', expectedRevision: 0, patch: { totalMinutes: 30 } }]) expect(todoDayWriteSchema.safeParse(value).success).toBe(false)
    expect(todoCreateBatchPayloadSchema.safeParse({ items: [input(true)] }).success).toBe(true)
    expect(todoCreateBatchPayloadSchema.safeParse({ items: [{ ...input(), isExtra: 'yes' }] }).success).toBe(false)
    expect(todoUpdatePayloadSchema.safeParse({ todoId: '00000000-0000-4000-8000-000000000000', patch: { isExtra: true } }).success).toBe(true)
  })
  it('does not count extras towards ordinary growth or alter work logs on small step completion', async () => {
    const r = await setup(), [normal, extra] = r.createTodoItems([input(), input(true)])
    expect(calculateDailyTodoGrowth([normal!, extra!], '2026-10-02')).toEqual(calculateDailyTodoGrowth([normal!], '2026-10-02'))
    const before = r.getDailyWorkLog('2026-10-02'), todos = r.listTodoItems()
    writeTodoDay(r.native, { day: '2026-10-02', expectedRevision: 0, patch: { smallCompleted: true } })
    expect(r.getDailyWorkLog('2026-10-02')).toEqual(before)
    expect(r.listTodoItems()).toEqual(todos)
  })
})
