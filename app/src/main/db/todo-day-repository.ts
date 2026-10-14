import type Database from 'better-sqlite3'
import { defaultTodoDay, todoDaySchema, todoDayWriteSchema, type TodoDay, type TodoDayWrite } from '../../shared/todo-day'

export function listTodoDays(db: Database.Database): TodoDay[] {
  return (db.prepare('SELECT payload FROM todo_day_focus ORDER BY day').all() as { payload: string }[]).map(row => todoDaySchema.parse(JSON.parse(row.payload)))
}

export function getTodoDay(db: Database.Database, day: string): TodoDay {
  const row = db.prepare('SELECT payload FROM todo_day_focus WHERE day=?').get(day) as { payload: string } | undefined
  return row ? todoDaySchema.parse(JSON.parse(row.payload)) : defaultTodoDay(day)
}

export function writeTodoDay(db: Database.Database, value: TodoDayWrite): TodoDay {
  const input = todoDayWriteSchema.parse(value)
  return db.transaction(() => {
    const current = getTodoDay(db, input.day)
    if (current.revision !== input.expectedRevision) throw new Error('这一天已在其他窗口更新，请重试')
    const next = todoDaySchema.parse({ ...current, ...input.patch, revision: current.revision + 1 })
    db.prepare('INSERT INTO todo_day_focus(day,payload) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload').run(input.day, JSON.stringify(next))
    return next
  })()
}
