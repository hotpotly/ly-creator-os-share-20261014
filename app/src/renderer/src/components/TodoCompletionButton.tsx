import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { TodoItem } from '../../../shared/domain'

export function TodoCompletionButton({ todo, onToggle, disabled }: { todo: TodoItem; onToggle(): void; disabled?: boolean }): React.JSX.Element {
  const completed = todo.status === 'completed'
  const partial = !completed && todo.trackingMode === 'progress' && todo.progress > 0 && todo.progress < 100
  return <button type="button" className={`todo-check${partial ? ' partial' : ''}`} data-completed={completed}
    style={{ '--todo-progress': `${todo.progress * 3.6}deg` } as CSSProperties}
    aria-label={completed ? `重新打开${todo.title}` : `完成${todo.title}`} disabled={disabled} onClick={onToggle}>
    {completed ? <Check size={12} strokeWidth={2.4} /> : null}
  </button>
}
