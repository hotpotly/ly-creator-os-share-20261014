import type { TodoItem } from './domain'

/** Latest title is the single source for estimated hours, never actual effort. */
export function todoDurationMinutes(title: string): number | null {
  const match = title.normalize('NFKC').match(/\(\s*(\d+(?:\.\d+)?)\s*\)\s*$/)
  if (!match) return null
  const minutes = Math.round(Number(match[1]) * 60)
  return Number.isSafeInteger(minutes) && minutes >= 0 ? minutes : null
}

export function formatTodoDuration(title: string): string {
  const minutes = todoDurationMinutes(title)
  return formatEstimatedMinutes(minutes)
}

export function formatEstimatedMinutes(minutes: number | null): string {
  if (minutes === null) return '未填预计时长'
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return hours ? `${hours}小时${rest ? `${rest}分钟` : ''}` : `${rest}分钟`
}

export function summarizeTodoEstimates(todos: readonly TodoItem[]): { totalMinutes: number | null; completedMinutes: number | null; totalCount: number; filledCount: number; completedCount: number; completedFilledCount: number; missingCount: number } {
  const rows = [...new Map(todos.filter(todo => todo.source === 'manual' && todo.status !== 'dismissed').map(todo => [todo.id, todo])).values()]
  const values = rows.map(todo => ({ todo, minutes: todoDurationMinutes(todo.title) }))
  const filled = values.filter(item => item.minutes !== null)
  const completed = values.filter(item => item.todo.status === 'completed')
  const completedFilled = completed.filter(item => item.minutes !== null)
  return {
    totalMinutes: filled.length ? filled.reduce((sum, item) => sum + item.minutes!, 0) : null,
    completedMinutes: completedFilled.length ? completedFilled.reduce((sum, item) => sum + item.minutes!, 0) : null,
    totalCount: rows.length, filledCount: filled.length, completedCount: completed.length, completedFilledCount: completedFilled.length,
    missingCount: rows.length - filled.length
  }
}
