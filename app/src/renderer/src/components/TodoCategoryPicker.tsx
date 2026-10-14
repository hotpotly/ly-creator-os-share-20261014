import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import { TODO_CATEGORY_ORDER, type TodoCategory, type TodoItem } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { AnchoredPopover } from './AnchoredPopover'

/** Category-only patches use the existing persistence and correction-memory path. */
export function TodoCategoryPicker({ todo, onBegin }: { todo: TodoItem; onBegin?(): void }): React.JSX.Element {
  const labels = useWorkspaceStore(state => state.snapshot.preferences.todoCategoryLabels)
  const refresh = useWorkspaceStore(state => state.refresh)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  const select = async (category: TodoCategory): Promise<void> => {
    if (pending.current) return
    if (category === todo.category) { setAnchor(null); return }
    pending.current = true
    setSaving(true)
    setError('')
    try {
      if (!window.creatorOS) throw new Error('App尚未准备好')
      await window.creatorOS.updateTodo(todo.id, { category })
      await refresh()
      setAnchor(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '待办分类保存失败，请重试')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <>
    <button type="button" className="todo-category-tag" aria-haspopup="menu" aria-expanded={Boolean(anchor)}
      aria-label={`更改${todo.title}的分类，当前为${labels[todo.category]}`} disabled={saving}
      onContextMenu={event => event.stopPropagation()}
      onDragStart={event => { event.preventDefault(); event.stopPropagation() }}
      onClick={event => {
        event.stopPropagation()
        if (anchor) { setAnchor(null); return }
        onBegin?.()
        setError('')
        setAnchor(event.currentTarget)
      }}
    >{labels[todo.category]}</button>
    {anchor ? <AnchoredPopover anchor={anchor} role="menu" ariaLabel="选择待办分类"
      className="todo-context-popover menu todo-category-popover" onDismiss={() => setAnchor(null)}>
      {TODO_CATEGORY_ORDER.map(category => <button type="button" role="menuitemradio" aria-checked={todo.category === category}
        disabled={saving} key={category} onClick={() => void select(category)}>
        <span>{labels[category]}</span>{todo.category === category ? <Check size={13} /> : null}
      </button>)}
      {error ? <p className="todo-context-error" role="alert">{error}</p> : null}
    </AnchoredPopover> : null}
  </>
}
