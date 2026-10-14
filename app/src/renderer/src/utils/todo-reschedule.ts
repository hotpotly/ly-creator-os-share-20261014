import type { TodoItem } from '../../../shared/domain'
import type { TodoCopyResult } from '../../../shared/todo-reschedule'
export const TODO_COPIED_EVENT = 'creator-todos-copied'
export async function copyTodosToToday(todos: TodoItem[], today: string, requestId: string): Promise<void> {
  if (!window.creatorOS) throw new Error('App尚未准备好')
  const result = await window.creatorOS.copyTodosToToday({ requestId, today, items: todos.map(todo => ({ todoId: todo.id, expectedUpdatedAt: todo.updatedAt })) })
  window.dispatchEvent(new CustomEvent<TodoCopyResult>(TODO_COPIED_EVENT, { detail: result }))
}
