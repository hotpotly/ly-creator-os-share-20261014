import { z } from 'zod'
import type { TodoCopyToTodayInput } from '../../../shared/todo-reschedule'
import { UndoConflictError } from '../../domain/undo-policy'
import type { UndoableCommand } from './contracts'

const payloadSchema = z.object({ items: z.array(z.object({
  id: z.string().uuid(), afterUpdatedAt: z.string()
}).strict()).min(1).max(100) }).strict()
export type TodoCopyUndoPayload = z.infer<typeof payloadSchema>
export const TODO_COPY_COMMAND = 'todo.copy-to-today'
export function createTodoCopyCommand(handlers: {
  execute(input: TodoCopyToTodayInput): TodoCopyUndoPayload
  undo(payload: TodoCopyUndoPayload): void
}): UndoableCommand<TodoCopyToTodayInput, number, TodoCopyUndoPayload> {
  return {
    type: TODO_COPY_COMMAND,
    isUndoPayload: (payload): payload is TodoCopyUndoPayload => payloadSchema.safeParse(payload).success,
    execute: (_context, input) => {
      const undoPayload = handlers.execute(input)
      return { result: undoPayload.items.length, undoPayload }
    },
    undo: (_context, payload) => {
      try { handlers.undo(payload) }
      catch (error) { throw new UndoConflictError(error instanceof Error ? error.message : '待办已变化，无法撤销') }
    }
  }
}
