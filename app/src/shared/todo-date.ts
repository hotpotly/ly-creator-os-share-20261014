import type { TodoDateRange, TodoItem } from './domain'
import { isValidLocalDate } from './domain/coarse-time'

function dateValue(date: string): number {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function addTodoDateDays(date: string, amount: number): string {
  return new Date(dateValue(date) + amount * 86_400_000).toISOString().slice(0, 10)
}

export function formatTodoDateLabel(date: string, today: string): string {
  const difference = Math.round((dateValue(date) - dateValue(today)) / 86_400_000)
  const [, month = '01', day = '01'] = date.split('-')
  const shortDate = `${Number(month)}月${Number(day)}日`
  if (difference === 0) return `今天·${shortDate}`
  if (difference === 1) return `明天·${shortDate}`
  if (difference === -1) return `昨天·${shortDate}`
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(dateValue(date)).getUTCDay()]
  return `${shortDate}·${weekday}`
}

export function completedTodoDay(timestamp: string | null, offsetMinutes?: number): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const offset = offsetMinutes ?? -date.getTimezoneOffset()
  return new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 10)
}

export function todoVisibleOnDate(todo: TodoItem, date: string, today: string): boolean {
  if (todo.status === 'dismissed') return false
  if (todo.dateRange) return date >= todo.dateRange.startDate && date <= todo.dateRange.endDate
  if (todo.plannedDate) return todo.plannedDate === date

  const completedDate = completedTodoDay(todo.completedAt)
  if (todo.status === 'completed') return completedDate === date
  return date === today && todo.source === 'manual'
}

/** A range is an atomic date value on the original todo, not a daily task copy. */
export function todoDateRangeError(range: TodoDateRange | null | undefined): string | null {
  if (!range) return null
  if (!isValidLocalDate(range.startDate) || !isValidLocalDate(range.endDate)) return '请选择有效的开始和结束日期'
  if (range.endDate < range.startDate) return '结束日期不能早于开始日期'
  if (range.name.trim().length > 60) return '范围名称不能超过60个字'
  return null
}

export function todoDateRangeLabel(range: TodoDateRange): string {
  return `${range.startDate}—${range.endDate}`
}

export function todoDateLabel(todo: Pick<TodoItem, 'dateRange' | 'plannedDate'>): string {
  return todo.dateRange ? `${todo.dateRange.name ? `${todo.dateRange.name} · ` : ''}${todoDateRangeLabel(todo.dateRange)}` : todo.plannedDate ?? '未指定日期'
}

export function todoDateRangeKey(range: TodoDateRange): string {
  return `range:${JSON.stringify([range.startDate, range.endDate, range.name])}`
}

/** Reuse persisted values, including completed/past ranges; never expose mutable task values. */
export function savedTodoDateRanges(todos: Pick<TodoItem, 'status' | 'dateRange'>[]): TodoDateRange[] {
  const ranges = new Map<string, TodoDateRange>()
  for (const todo of todos) {
    if (todo.status === 'dismissed' || !todo.dateRange) continue
    ranges.set(todoDateRangeKey(todo.dateRange), { ...todo.dateRange })
  }
  return [...ranges.values()].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate) || a.name.localeCompare(b.name))
}

export function groupTodoDateRanges(todos: TodoItem[]): { key: string; label: string; dateLabel: string; items: TodoItem[] }[] {
  const groups = new Map<string, { key: string; label: string; dateLabel: string; items: TodoItem[] }>()
  for (const todo of todos) {
    const range = todo.dateRange
    if (!range) continue
    const key = todoDateRangeKey(range)
    if (!groups.has(key)) groups.set(key, { key, label: range.name || '日期范围', dateLabel: todoDateRangeLabel(range), items: [] })
    groups.get(key)!.items.push(todo)
  }
  return [...groups.values()].sort((a, b) => a.dateLabel.localeCompare(b.dateLabel))
}
