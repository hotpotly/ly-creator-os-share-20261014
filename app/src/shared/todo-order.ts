import type { TodoItem } from './domain'
export function sortTodosByOrder(todos: readonly TodoItem[], order: readonly string[]): TodoItem[] {
  const ranks = new Map(order.map((id, index) => [id, index]))
  return [...todos].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
/** Replace only the displayed group's slots; hidden dates/groups keep their relative positions. */
export function moveTodoWithinList(todos: readonly TodoItem[], order: readonly string[], visibleIds: readonly string[], source: string, target: string, after: boolean): string[] {
  const current = sortTodosByOrder(todos, order).map(todo => todo.id)
  if (source === target || !visibleIds.includes(source) || !visibleIds.includes(target)) return current
  const members = new Set(visibleIds)
  const next = current.filter(id => members.has(id) && id !== source)
  const index = next.indexOf(target)
  if (index < 0) return current
  next.splice(index + Number(after), 0, source)
  let position = 0
  return current.map(id => members.has(id) ? next[position++]! : id)
}
