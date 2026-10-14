import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { seedWorkspace } from '../../src/main/db/seed'
import type { CreateTodoInput, TodoDateRange } from '../../src/shared/domain'
import { RESPONSE_SCHEMAS, todoCreateBatchPayloadSchema, todoUpdatePayloadSchema } from '../../src/shared/ipc'
import { groupTodoDateRanges, savedTodoDateRanges, todoDateRangeKey, todoDateRangeError, todoVisibleOnDate } from '../../src/shared/todo-date'
import { calculateDailyTodoGrowth } from '../../src/shared/todo-growth'

const dirs: string[] = [], stores: WorkspaceStore[] = []
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'todo-range-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store); return store.repository
}
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
const range: TodoDateRange = { startDate: '2026-09-25', endDate: '2026-09-27', name: '个人计划' }
const input = (patch: Partial<CreateTodoInput> = {}): CreateTodoInput => ({ title: '整理书桌', plannedDate: null, segment: null, projectId: null, category: 'life', trackingMode: 'checklist', progress: 0, dateRange: range, ...patch })

describe('date-range todos', () => {
  it('deduplicates saved ranges, distinguishes dates/names, includes completed history and excludes dismissed', () => {
    const future = { ...range, startDate: '2027-01-01', endDate: '2027-01-03' }
    const unnamed = { ...range, name: '' }
    const choices = savedTodoDateRanges([
      { status: 'open', dateRange: range }, { status: 'completed', dateRange: { ...range } },
      { status: 'completed', dateRange: future }, { status: 'open', dateRange: unnamed },
      { status: 'dismissed', dateRange: { ...range, name: '已移除' } }, { status: 'open', dateRange: null }
    ])
    expect(choices).toHaveLength(3)
    expect(choices[0]).toEqual(future)
    expect(new Set(choices.map(todoDateRangeKey)).size).toBe(3)
    expect(choices).toContainEqual(unnamed)
    choices[0]!.name = '仅改草稿'
    expect(future.name).toBe('个人计划')
    expect(savedTodoDateRanges([])).toEqual([])
  })
  it('persists a single record, projects the inclusive range and survives reopening', async () => {
    const r = await setup(), [todo] = r.createTodoItems([input()])
    expect(todo!.dateRange).toEqual(range)
    expect(RESPONSE_SCHEMAS.todoItemSchema.parse(todo).dateRange).toEqual(range)
    for (const day of ['2026-09-25', '2026-09-26', '2026-09-27']) expect(todoVisibleOnDate(todo!, day, '2026-09-26')).toBe(true)
    for (const day of ['2026-09-24', '2026-09-28']) expect(todoVisibleOnDate(todo!, day, '2026-09-26')).toBe(false)
    const reopened = await openWorkspaceStore(dirs[0]!); stores.push(reopened)
    expect(reopened.repository.listTodoItems().find(t => t.id === todo!.id)).toEqual(todo)
    expect(r.native.prepare('SELECT COUNT(*) n FROM todo_items WHERE id=?').get(todo!.id)).toEqual({ n: 1 })
  })
  it('preserves ranges and unrelated fields through category, completion, rename and reopen edits', async () => {
    const r = await setup(), [todo] = r.createTodoItems([input({ projectId: 'ios', stageKey: 'script', trackingMode: 'progress', progress: 35 })])
    let next = r.updateTodoItem(todo!.id, { category: 'ai' })
    expect(next).toEqual({ ...todo, category: 'ai', updatedAt: next.updatedAt })
    next = r.updateTodoItem(todo!.id, { completed: true })
    expect(next.dateRange).toEqual(range); expect(next.projectId).toBe('ios'); expect(next.stageKey).toBe('script')
    expect(todoVisibleOnDate(next, '2026-09-27', '2026-10-01')).toBe(true)
    next = r.updateTodoItem(todo!.id, { completed: false, title: '新的标题' })
    expect(next.progress).toBe(35); expect(next.dateRange).toEqual(range)
    expect(() => r.updateTodoItem(todo!.id, { plannedDate: '2026-09-28' })).toThrow('单日')
    next = r.updateTodoItem(todo!.id, { dateRange: null, plannedDate: '2026-09-28', segment: 'evening' })
    expect(next).toMatchObject({ dateRange: null, plannedDate: '2026-09-28', segment: 'evening', progress: 35 })
  })
  it('rejects malformed/reversed dates and rolls back the entire batch', async () => {
    const r = await setup(), before = r.listTodoItems()
    for (const bad of [{ ...range, startDate: '2026-02-30' }, { ...range, endDate: '2026-09-24' }, { ...range, name: '字'.repeat(61) }]) {
      expect(todoDateRangeError(bad)).toBeTruthy()
      expect(todoCreateBatchPayloadSchema.safeParse({ items: [input({ dateRange: bad })] }).success).toBe(false)
      expect(() => r.createTodoItems([input(), input({ dateRange: bad })])).toThrow()
      expect(r.listTodoItems()).toEqual(before)
    }
  })
  it('supports same-day, unnamed and cross-year ranges with no day assignment', async () => {
    const r = await setup()
    const [a, b, c] = r.createTodoItems([
      input({ dateRange: { ...range, endDate: range.startDate, name: '' } }),
      input({ title: '另一件事', dateRange: { ...range, endDate: range.startDate, name: '  ' } }),
      input({ dateRange: { startDate: '2026-12-31', endDate: '2027-01-02', name: '' }, plannedDate: '2026-09-25', segment: 'evening' })
    ])
    expect(a!.dateRange?.name).toBe(''); expect(b!.dateRange?.name).toBe('')
    expect(c).toMatchObject({ plannedDate: null, segment: null })
    const groups = groupTodoDateRanges([a!, b!, c!]); expect(groups).toHaveLength(2); expect(groups[0]!.items).toHaveLength(2)
    expect(todoVisibleOnDate(c!, '2027-01-01', '2027-01-01')).toBe(true)
  })
  it('does not turn period tasks into daily growth, investments or time assignments', async () => {
    const r = await setup(), [todo] = r.createTodoItems([input({ progress: 100 })])
    expect(calculateDailyTodoGrowth([todo!], '2026-09-26').todoCount).toBe(0)
    expect(() => r.moveTodoInTime({ todoId: todo!.id, expectedUpdatedAt: todo!.updatedAt, day: '2026-09-26', segment: 'morning', target: null, after: true })).toThrow()
    expect(r.listTodoItems().find(t => t.id === todo!.id)).toEqual(todo)
    const dismissed = r.dismissTodoItem(todo!.id); expect(dismissed).toBe(true)
  })
  it('validates both input and output boundaries', async () => {
    const r = await setup(), [todo] = r.createTodoItems([input()])
    expect(todoUpdatePayloadSchema.safeParse({ todoId: todo!.id, patch: { dateRange: { ...range, unknown: 'x' } } }).success).toBe(false)
    expect(todoCreateBatchPayloadSchema.parse({ items: [input({ dateRange: null })] }).items[0]!.dateRange).toBeNull()
    expect(RESPONSE_SCHEMAS.todoItemSchema.parse(todo)).toEqual(todo)
  })
  it('migrates old daily and completed tasks without changing data and is idempotent', () => {
    const db = new Database(':memory:')
    try {
      runMigrationsThrough(db, '0096_r10j_template_rules'); seedWorkspace(db, true, true)
      db.prepare(`INSERT INTO todo_items(id,title,planned_date,segment,category,status,tracking_mode,progress,source,created_at,updated_at) VALUES('old-range-test','旧待办','2026-09-26','evening','life','completed','checklist',100,'manual','before','before')`).run()
      const old = db.prepare('SELECT * FROM todo_items').all()
      runMigrations(db); runMigrations(db)
      expect(db.prepare('SELECT * FROM todo_items').all()).toEqual(old.map(row => ({ ...(row as object), date_range_json: null, is_extra: 0 })))
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
})
