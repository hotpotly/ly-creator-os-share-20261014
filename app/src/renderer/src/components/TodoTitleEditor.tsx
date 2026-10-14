import { useRef, useState } from 'react'
import type { TodoItem } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'

export function TodoTitleEditor({ todo, className = 'todo-title-link', onBegin }: {
  todo: TodoItem
  className?: string
  onBegin?(): void
}): React.JSX.Element {
  const refresh = useWorkspaceStore(state => state.refresh)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.title)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const cancelled = useRef(false)
  const original = useRef(todo.title)
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = (): void => { requestAnimationFrame(() => trigger.current?.focus()) }
  const save = async (keyboard = false): Promise<void> => {
    if (pending.current || cancelled.current) return
    const title = draft.trim()
    if (!title) { setError('待办内容不能为空'); return }
    if (title === original.current) { setEditing(false); if (keyboard) restoreFocus(); return }
    pending.current = true; setSaving(true); setError('')
    try {
      if (!window.creatorOS) throw new Error('App尚未准备好')
      await window.creatorOS.updateTodo(todo.id, { title })
      await refresh()
      setEditing(false)
      if (keyboard) restoreFocus()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '待办保存失败，请重试') }
    finally { pending.current = false; setSaving(false) }
  }
  return <span className={`todo-inline-title${editing ? ' editing' : ''}`}>
    {editing ? <input
      autoFocus aria-label="修改待办文字" aria-invalid={Boolean(error)} aria-busy={saving}
      maxLength={300} value={draft} readOnly={saving}
      onChange={event => { setDraft(event.currentTarget.value); setError('') }}
      onBlur={() => { void save() }}
      onContextMenu={event => event.stopPropagation()}
      onDragStart={event => { event.preventDefault(); event.stopPropagation() }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save(true) }
        if (event.key === 'Escape' && !pending.current) {
          event.preventDefault(); event.stopPropagation(); cancelled.current = true
          setEditing(false); setError(''); restoreFocus()
        }
      }}
    /> : <button ref={trigger} type="button" className={className} onClick={() => {
      onBegin?.(); original.current = todo.title; cancelled.current = false
      setDraft(todo.title); setError(''); setEditing(true)
    }}>{todo.title}</button>}
    {todo.isExtra && !editing ? <small className="todo-extra-badge">额外</small> : null}
    {error ? <span className="todo-inline-error" role="alert">{error}</span> : null}
  </span>
}
