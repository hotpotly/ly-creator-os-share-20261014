import { canCopyTodoToToday } from '../../../shared/todo-reschedule'
import { copyTodosToToday } from '../utils/todo-reschedule'
import { TodoDateRangeFields } from './TodoDateRangeFields'
import { todoDateRangeError } from '../../../shared/todo-date'
import { useWorkspaceStore } from '../store/workspace'
import { updateTodoWithStageOffer } from '../utils/todo-completion'
import { TodoProjectPicker } from './TodoProjectPicker'
import { Check, Gauge, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TODO_CATEGORY_ORDER, type TodoCategory, type UpdateTodoInput, type TodoItem, type TodoSegment } from '../../../shared/domain'
import { AnchoredPopover } from './AnchoredPopover'
import { AppSelect } from './AppSelect'

const segmentLabels: Record<TodoSegment, string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
const segments = Object.keys(segmentLabels) as TodoSegment[]

export interface TodoActionTarget {
  initialView?: 'menu' | 'edit'
  anchor: HTMLElement
  anchorPoint: { x: number; y: number }
  todo: TodoItem
}

export function TodoActionPopover({ target, categoryLabels, onDismiss, onChanged }: {
  target: TodoActionTarget
  categoryLabels: Record<TodoCategory, string>
  onDismiss(): void
  onChanged(): unknown | Promise<unknown>
}): React.JSX.Element {
  const today = useWorkspaceStore(state => state.snapshot.today)
  const [view, setView] = useState<'menu' | 'progress' | 'edit'>(target.initialView ?? 'menu')
  const [draft, setDraft] = useState(target.todo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const copyRequest = useRef(crypto.randomUUID())

  useEffect(() => {
    setView(target.initialView ?? 'menu')
    setDraft(target.todo)
    setError('')
    copyRequest.current = crypto.randomUUID()
  }, [target])

  const run = async (action: () => Promise<unknown>, closeAfter = true): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await action()
      await onChanged()
      if (closeAfter) onDismiss()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '待办保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveProgress = async (progress: number, closeAfter = false): Promise<void> => {
    const nextProgress = Math.max(0, Math.min(100, Math.round(progress)))
    setDraft((current) => ({ ...current, trackingMode: 'progress', progress: nextProgress }))
    await run(async () => updateTodoWithStageOffer(target.todo, { trackingMode: 'progress', progress: nextProgress }), closeAfter)
  }

  const saveEdit = async (): Promise<void> => {
    const rangeError = todoDateRangeError(draft.dateRange)
    if (rangeError) { setError(rangeError); return }
    const patch: UpdateTodoInput = {}
    if (JSON.stringify(draft.dateRange ?? null) !== JSON.stringify(target.todo.dateRange ?? null)) patch.dateRange = draft.dateRange ?? null
    for (const key of ['projectId', 'stageKey', 'title', 'plannedDate', 'segment', 'category'] as const) {
      if (draft[key] !== target.todo[key]) Object.assign(patch, { [key]: draft[key] ?? null })
    }
    if (patch.stageKey !== undefined) patch.projectId = draft.projectId
    await run(async () => window.creatorOS?.updateTodo(draft.id, patch))
  }

  return <AnchoredPopover
    anchor={target.anchor}
    anchorPoint={target.anchorPoint}
    ariaLabel={`${target.todo.title}的待办操作`}
    className={`todo-context-popover ${view}`}
    role={view === 'menu' ? 'menu' : 'dialog'}
    onDismiss={onDismiss}
  >
    {view === 'menu' ? <>
      <button role="menuitem" onClick={() => setView('edit')}><Pencil size={13} />编辑待办</button>
      {canCopyTodoToToday(target.todo, today) ? <button role="menuitem" disabled={saving} onClick={() => void run(() => copyTodosToToday([target.todo], today, copyRequest.current))}>复制到今天</button> : null}
      <button role="menuitem" onClick={() => setView('progress')}><Gauge size={13} />{draft.trackingMode === 'progress' ? '调整进度' : '记录进度'}</button>
      {draft.trackingMode === 'progress' ? <button role="menuitem" disabled={saving} onClick={() => void run(async () => window.creatorOS?.updateTodo(draft.id, { trackingMode: 'checklist', progress: 0 }))}><Check size={13} />改为仅打勾</button> : null}
      <button role="menuitem" disabled={saving} onClick={() => void run(async () => window.creatorOS?.updateTodo(draft.id, { isExtra: !draft.isExtra }))}>{draft.isExtra ? '改为普通待办' : '改为额外'}</button>
      <button className="danger" role="menuitem" disabled={saving} onClick={() => void run(async () => window.creatorOS?.dismissTodo(draft.id))}><Trash2 size={13} />删除待办</button>
    </> : view === 'progress' ? <>
      <header><b>{draft.trackingMode === 'progress' ? '调整进度' : '记录进度'}</b><span>{draft.progress}%</span></header>
      <input
        aria-label="待办进度"
        type="range"
        min="0"
        max="95"
        step="5"
        value={Math.min(draft.progress, 95)}
        onChange={(event) => setDraft({ ...draft, trackingMode: 'progress', progress: Number(event.currentTarget.value) })}
        onMouseUp={(event) => void saveProgress(Number(event.currentTarget.value))}
        onKeyUp={(event) => void saveProgress(Number(event.currentTarget.value))}
      />
      <div>{[25, 50, 75].map((progress) => <button disabled={saving} key={progress} onClick={() => void saveProgress(progress)}>{progress}%</button>)}<button className="complete" disabled={saving} onClick={() => void saveProgress(draft.progress, true)}>完成</button></div>
    </> : <>
      <header><b>编辑待办</b><button aria-label="关闭编辑待办" onClick={onDismiss}><X size={13} /></button></header>
      <div className="todo-edit-title-row"><label><span>内容</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })} /></label><TodoProjectPicker value={draft.projectId} stageKey={draft.stageKey} disabled={saving} onChange={(projectId, stageKey) => setDraft({ ...draft, projectId, stageKey })} /></div>
      <TodoDateRangeFields value={draft.dateRange ?? null} defaultDay={draft.plannedDate ?? today} singleLabel="单日／未指定日期" disabled={saving} onChange={dateRange => setDraft({ ...draft, dateRange, ...(dateRange ? { plannedDate: null, segment: null } : {}) })} />
      {!draft.dateRange ? <label><span>日期</span><input value={draft.plannedDate ?? ''} placeholder="YYYY-MM-DD" onChange={(event) => setDraft({ ...draft, plannedDate: event.currentTarget.value || null })} /></label> : null}
      <div className="todo-edit-selects">
        <AppSelect disabled={Boolean(draft.dateRange)} aria-label="编辑待办时段" value={draft.segment ?? ''} onChange={(event) => setDraft({ ...draft, segment: (event.currentTarget.value || null) as TodoSegment | null })}><option value="">未分时段</option>{segments.map((segment) => <option value={segment} key={segment}>{segmentLabels[segment]}</option>)}</AppSelect>
        <AppSelect aria-label="编辑待办分类" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.currentTarget.value as TodoCategory })}>{TODO_CATEGORY_ORDER.map((category) => <option value={category} key={category}>{categoryLabels[category]}</option>)}</AppSelect>
      </div>
      <footer><button onClick={onDismiss}>取消</button><button className="primary-action" disabled={saving || Boolean(todoDateRangeError(draft.dateRange)) || !draft.title.trim()} onClick={() => void saveEdit()}>{saving ? '保存中…' : '保存'}</button></footer>
    </>}
    {error ? <p className="todo-context-error" role="alert">{error}</p> : null}
  </AnchoredPopover>
}
