import type { TodoItem, TodoStageStartCandidate, UpdateTodoInput } from '../../../shared/domain'
export const TODO_STAGE_START_OFFER = 'creator-todo-stage-start-offer'
export interface TodoStageStartOffer { candidate: TodoStageStartCandidate | null; anchor: HTMLElement | null; point: { x: number; y: number }; error?: string }
export async function updateTodoWithStageOffer(todo: TodoItem, patch: UpdateTodoInput): Promise<TodoItem> {
  if (!window.creatorOS) throw new Error('App尚未准备好')
  const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const bounds = anchor?.getBoundingClientRect()
  const point = { x: bounds?.left ?? 20, y: bounds?.bottom ?? 80 }
  const result = await window.creatorOS.updateTodo(todo.id, patch)
  if (todo.status !== 'completed' && result.status === 'completed' && result.projectId) {
    // Completing a task is committed independently. Reading a suggestion never starts a stage.
    void window.creatorOS.getTodoStageStartCandidate(result.id).then(candidate => {
      if (candidate) window.dispatchEvent(new CustomEvent<TodoStageStartOffer>(TODO_STAGE_START_OFFER, { detail: { candidate, anchor, point } }))
    }).catch(() => window.dispatchEvent(new CustomEvent<TodoStageStartOffer>(TODO_STAGE_START_OFFER, { detail: { candidate: null, anchor, point, error: '待办已完成，阶段开始建议读取失败，可在项目中手动开始。' } })))
  }
  return result
}
