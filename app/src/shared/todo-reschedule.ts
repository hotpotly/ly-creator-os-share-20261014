import { z } from 'zod'
import type { TodoItem } from './domain'
import { isValidLocalDate } from './domain/coarse-time'

const localDate = z.string().refine(isValidLocalDate, '日期无效')
export const todoCopyToTodaySchema = z.object({
  requestId: z.string().uuid(),
  today: localDate,
  items: z.array(z.object({ todoId: z.string().uuid(), expectedUpdatedAt: z.string().min(1) }).strict()).min(1).max(100)
    .refine(items => new Set(items.map(item => item.todoId)).size === items.length, '不能重复选择待办')
}).strict()
export type TodoCopyToTodayInput = z.infer<typeof todoCopyToTodaySchema>
export const todoCopyResultSchema = z.object({ operationId: z.string().uuid(), count: z.number().int().min(1).max(100), undoable: z.boolean() }).strict()
export type TodoCopyResult = z.infer<typeof todoCopyResultSchema>
export const todoCopyUndoSchema = z.object({ operationId: z.string().uuid() }).strict()

export function canCopyTodoToToday(todo: TodoItem, today: string): boolean {
  return todo.source === 'manual' && todo.status === 'open' && !todo.dateRange && !!todo.plannedDate && todo.plannedDate < today
}
