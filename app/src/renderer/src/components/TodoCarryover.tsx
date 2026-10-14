import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { addTodoDateDays, formatTodoDateLabel } from '../../../shared/todo-date'
import { canCopyTodoToToday, type TodoCopyResult } from '../../../shared/todo-reschedule'
import type { TodoItem } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { copyTodosToToday, TODO_COPIED_EVENT } from '../utils/todo-reschedule'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'

export function TodoCarryover({ day }: { day: string }): React.JSX.Element | null {
  const { today, todos } = useWorkspaceStore(state => state.snapshot)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const yesterday = addTodoDateDays(today, -1)
  const count = todos.filter(todo => canCopyTodoToToday(todo, today) && todo.plannedDate === yesterday).length
  if (day !== today) return null
  return <>
    {count || anchor ? <button type="button" className="todo-carryover-button" aria-expanded={!!anchor} onClick={event => setAnchor(event.currentTarget)}>昨日未完成 {count}</button> : null}
    {anchor ? <CarryoverPanel anchor={anchor} today={today} onClose={() => setAnchor(null)} /> : null}
  </>
}

function CarryoverPanel({ anchor, today, onClose }: { anchor: HTMLElement; today: string; onClose(): void }): React.JSX.Element {
  const { todos, preferences } = useWorkspaceStore(state => state.snapshot)
  const refresh = useWorkspaceStore(state => state.refresh)
  const yesterday = addTodoDateDays(today, -1)
  const [sourceDay, setSourceDay] = useState(yesterday)
  const [items, setItems] = useState(() => todos.filter(todo => canCopyTodoToToday(todo, today) && todo.plannedDate === yesterday))
  const [selected, setSelected] = useState<string[]>([])
  const [calendar, setCalendar] = useState(false)
  const [busy, setBusy] = useState(false), pending = useRef(false)
  const [error, setError] = useState('')
  const request = useRef<{ signature: string; id: string } | null>(null)
  const chooseDay = (day: string): void => {
    setSourceDay(day); setItems(todos.filter(todo => canCopyTodoToToday(todo, today) && todo.plannedDate === day)); setSelected([]); setCalendar(false); setError('')
  }
  const save = async (): Promise<void> => {
    if (pending.current || !selected.length) return
    pending.current = true; setBusy(true); setError('')
    const chosen = items.filter(item => selected.includes(item.id))
    const signature = JSON.stringify(chosen.map(todo => [todo.id, todo.updatedAt]))
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() }
    try {
      await copyTodosToToday(chosen, today, request.current.id)
      onClose()
      void refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '复制失败，请重试') }
    finally { pending.current = false; setBusy(false) }
  }
  return <AnchoredPopover anchor={anchor} ariaLabel="选择复制到今天的待办" className="todo-batch-link-panel todo-carryover-panel" onDismiss={() => { if (!pending.current) onClose() }}>
    <header><b>{sourceDay === yesterday ? '昨日未完成' : '未完成待办'}</b><button aria-label="关闭复制到今天" disabled={busy} onClick={onClose}><X size={14} /></button></header>
    <button className="todo-carryover-date" disabled={busy} aria-expanded={calendar} onClick={() => setCalendar(value => !value)}>{formatTodoDateLabel(sourceDay, today)} · 选择日期</button>
    {calendar ? <CalendarDatePicker label="来源日期" today={today} value={sourceDay} max={yesterday} clearable={false} onChange={day => { if (day) chooseDay(day) }} /> : <>
      <div className="todo-batch-selection"><span>已选{selected.length}条</span><button disabled={busy || !items.length} onClick={() => setSelected(items.slice(0, 100).map(todo => todo.id))}>{items.length > 100 ? '选择前100条' : '全选'}</button><button disabled={busy || !selected.length} onClick={() => setSelected([])}>清空</button></div>
      <div className="todo-batch-items" role="group" aria-label="选择未完成待办">
        {items.map(todo => <CarryoverRow key={todo.id} todo={todo} category={preferences.todoCategoryLabels[todo.category]} selected={selected.includes(todo.id)} disabled={busy || (selected.length >= 100 && !selected.includes(todo.id))} onChange={checked => setSelected(ids => checked ? [...ids, todo.id] : ids.filter(id => id !== todo.id))} />)}
        {!items.length ? <p>当天没有未完成待办</p> : null}
      </div>
      {error ? <p role="alert">{error}<button disabled={busy} onClick={() => chooseDay(sourceDay)}>重新选择</button></p> : null}
      <footer><button disabled={busy} onClick={onClose}>取消</button><button className="primary-action" disabled={busy || !selected.length} onClick={() => void save()}>{busy ? '复制中…' : `复制到今天（${selected.length}）`}</button></footer>
    </>}
  </AnchoredPopover>
}

function CarryoverRow({ todo, category, selected, disabled, onChange }: { todo: TodoItem; category: string; selected: boolean; disabled: boolean; onChange(checked: boolean): void }): React.JSX.Element {
  return <label className={selected ? 'selected' : ''}><input type="checkbox" aria-label={`复制：${todo.title}`} checked={selected} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} /><span><b title={todo.title}>{todo.title}</b><small>{category}{todo.isExtra ? ' · 额外' : ''}{todo.trackingMode === 'progress' ? ` · ${todo.progress}%` : ''}</small></span></label>
}

export function TodoCopyNotice(): React.JSX.Element | null {
  const [notice, setNotice] = useState<TodoCopyResult | null>(null)
  const [busy, setBusy] = useState(false), pending = useRef(false)
  const [error, setError] = useState('')
  const refresh = useWorkspaceStore(state => state.refresh)
  useEffect(() => {
    const copied = (event: Event): void => { setNotice((event as CustomEvent<TodoCopyResult>).detail); setError('') }
    window.addEventListener(TODO_COPIED_EVENT, copied)
    return () => window.removeEventListener(TODO_COPIED_EVENT, copied)
  }, [])
  useEffect(() => {
    if (!notice || busy || error) return
    const timer = setTimeout(() => setNotice(null), 15000)
    return () => clearTimeout(timer)
  }, [notice, busy, error])
  if (!notice) return null
  const undo = async (): Promise<void> => {
    if (!window.creatorOS || pending.current) return
    pending.current = true; setBusy(true)
    try { await window.creatorOS.undoTodoCopy(notice.operationId); setNotice(null); void refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '撤销失败') }
    finally { pending.current = false; setBusy(false) }
  }
  return createPortal(<div className="todo-copy-notice" role={error ? 'alert' : 'status'}><span>{error || `已复制到今天（${notice.count}条）`}</span>{notice.undoable && !error ? <button disabled={busy} onClick={() => void undo()}>{busy ? '撤销中…' : '撤销'}</button> : null}<button aria-label="关闭复制提示" disabled={busy} onClick={() => setNotice(null)}><X size={13} /></button></div>, document.body)
}
