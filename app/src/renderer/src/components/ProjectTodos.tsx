import { todoDateLabel } from '../../../shared/todo-date'
import { TodoEstimateSummary } from './TodoEstimateSummary'
import { TodoBatchLinkButton } from './TodoBatchLinkButton'
import { updateTodoWithStageOffer } from '../utils/todo-completion'
import { TodoTitleEditor } from './TodoTitleEditor'
import { Check, MoreHorizontal, Plus } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'
import type { ProjectDetail, StageTimeKey, TodoItem } from '../../../shared/domain'
import { formatTodoDuration } from '../../../shared/todo-duration'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { AppSelect } from './AppSelect'
import { TodoActionPopover, type TodoActionTarget } from './TodoActionPopover'
import { TodoProjectPicker } from './TodoProjectPicker'

/** Project and stage views reference the same workspace todos, never copied records. */
export function ProjectTodos({ project, stageKey = null, compact = false, unassignedOnly = false }: { project: ProjectDetail; stageKey?: StageTimeKey | null; compact?: boolean; unassignedOnly?: boolean }): React.JSX.Element {
  const { todos, today, preferences } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [menu, setMenu] = useState<TodoActionTarget | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today)
  const [stageChosen, setStageChosen] = useState(Boolean(stageKey))
  const [newStage, setNewStage] = useState<StageTimeKey | null>(stageKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const all = todos.filter((todo) => todo.projectId === project.id && todo.source === 'manual' && todo.status !== 'dismissed' && (!stageKey || todo.stageKey === stageKey) && (!unassignedOnly || !todo.stageKey || (!['production'].includes(todo.stageKey) && !project.modules.some(module => module.key === todo.stageKey && module.enabled && !['versions', 'business', 'feedback'].includes(module.key)))))
  const visible = all.filter((todo) => (status === 'all' || todo.status === status) && (stageFilter === 'all' || (stageFilter === 'none' ? !todo.stageKey : todo.stageKey === stageFilter)))
    .sort((a, b) => (a.dateRange?.startDate ?? a.plannedDate ?? '9999').localeCompare(b.dateRange?.startDate ?? b.plannedDate ?? '9999') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const stages = project.modules.filter((module) => !['overview', 'business', 'feedback'].includes(module.key))
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await action(); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : '待办保存失败') }
    finally { pending.current = false; setBusy(false) }
  }
  const openEdit = (anchor: HTMLElement, todo: TodoItem, point?: { x: number; y: number }, direct = true): void => {
    const bounds = anchor.getBoundingClientRect()
    setMenu({ todo, anchor, initialView: direct ? 'edit' : 'menu', anchorPoint: point ?? { x: bounds.left, y: bounds.bottom } })
  }
  const completedCount = all.filter(todo => todo.status === 'completed').length
  const shown = compact && !expanded ? visible.slice(0, 3) : visible
  const Container = compact ? 'section' : 'details'
  return <Container className={`project-linked-todos${compact ? ' compact' : ''}`} open={!compact && !stageKey ? true : undefined}>
    {!compact ? <summary><b>{stageKey ? `${projectModuleLabels[stageKey]} · 关联待办` : '关联待办'}</b><span>{all.length}条 · 全部日期</span></summary> : null}
    <div className="project-todo-toolbar">
      {compact ? <span className="stage-todo-count">{all.length ? <><b>{all.filter(todo => todo.status !== 'completed').length}项待办</b><span>{all.filter(todo => todo.status === 'completed').length}项已完成</span></> : '暂无待办'}</span> : null}
      {!compact ? <div className="segmented" role="group" aria-label="关联待办状态">{[['all', '全部'], ['open', '未完成'], ['completed', '已完成']].map(([value, label]) => <button key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => setStatus(value!)}>{label}</button>)}</div> : null}
      {!stageKey ? <AppSelect aria-label="筛选关联阶段" value={stageFilter} onChange={(event) => setStageFilter(event.currentTarget.value)}><option value="all">全部阶段</option><option value="none">未指定阶段</option>{stages.map((module) => <option key={module.key} value={module.key}>{projectModuleLabels[module.key]}{module.enabled ? '' : '（已隐藏）'}</option>)}</AppSelect> : null}
      <TodoBatchLinkButton key={`${project.id}:${stageKey}:${status}:${stageFilter}`} todos={visible} iconOnly={compact} />
      <button className="project-todo-add" aria-expanded={creating} onClick={() => { setCreating(!creating); setError('') }}><Plus size={13} />新增待办</button>
    </div>
    <TodoEstimateSummary todos={visible} />
    {compact && all.length > 0 ? <div className="stage-todo-progress" role="progressbar" aria-label="关联待办完成进度" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={completedCount}><span style={{ width: `${completedCount / all.length * 100}%` }} /></div> : null}
    {creating ? <form className="project-todo-create" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      if (!window.creatorOS) throw new Error('App尚未准备好')
      await window.creatorOS.createTodoBatch([{ title, plannedDate: date || null, projectId: project.id, stageKey: newStage, stageSelection: stageChosen ? 'manual' : 'suggested', category: 'self_media', segment: null, trackingMode: 'checklist', progress: 0 }])
      setTitle(''); setCreating(false)
    }) }}>
      <label>待办内容<input autoFocus required maxLength={300} placeholder="例如：修改开头(2)" value={title} disabled={busy} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label>日期<input type="date" value={date} disabled={busy} onChange={(event) => setDate(event.currentTarget.value)} /></label>
      <label>阶段<AppSelect aria-label="新待办阶段" value={newStage ?? ''} disabled={busy} onChange={(event) => { setNewStage(event.currentTarget.value as StageTimeKey || null); setStageChosen(true) }}><option value="">未指定阶段</option>{stages.filter((module) => module.enabled).map((module) => <option key={module.key} value={module.key}>{projectModuleLabels[module.key]}</option>)}</AppSelect></label>
      <button type="submit" disabled={busy || !title.trim()}>保存待办</button>
    </form> : null}
    <div className="project-todo-list" aria-label="项目关联待办清单">
      {shown.map((todo, index) => <Fragment key={todo.id}>{compact && expanded && (index === 0 || todoDateLabel(shown[index - 1]!) !== todoDateLabel(todo)) ? <p className="stage-todo-day">{todoDateLabel(todo)}</p> : null}<article key={todo.id} data-todo-id={todo.id} className={`project-todo-row${todo.status === 'completed' ? ' completed' : ''}`} onContextMenu={(event) => { event.preventDefault(); openEdit(event.currentTarget, todo, { x: event.clientX, y: event.clientY }, false) }}>
        <button className="todo-check" disabled={busy} aria-label={todo.status === 'completed' ? `重新打开${todo.title}` : `完成${todo.title}`} onClick={() => void run(async () => updateTodoWithStageOffer(todo, { completed: todo.status !== 'completed' }))}>{todo.status === 'completed' ? <Check size={12} /> : null}</button>
        <div className="project-todo-content"><div><TodoTitleEditor todo={todo} className="project-todo-title" onBegin={() => setMenu(null)} /><TodoProjectPicker value={todo.projectId} stageKey={todo.stageKey} todo={todo} disabled={busy} onChange={async (projectId, stageKey) => { await window.creatorOS?.updateTodo(todo.id, { projectId, stageKey }); await refresh() }} /></div><small>{compact ? todoDateLabel(todo) : `${todoDateLabel(todo)} · ${todo.stageKey ? projectModuleLabels[todo.stageKey] : '未指定阶段'} · ${preferences.todoCategoryLabels[todo.category]}`}</small></div>
        <span className="project-todo-duration" title="括号表示预计小时，不是实际工时；历史数字可能混用">{formatTodoDuration(todo.title).startsWith('未填') ? formatTodoDuration(todo.title) : `预计${formatTodoDuration(todo.title)}`}</span>
        <button className="project-todo-more" aria-label={`编辑${todo.title}`} onClick={(event) => openEdit(event.currentTarget, todo)}><MoreHorizontal size={15} /></button>
      </article></Fragment>)}
      {!visible.length && !compact ? <p className="project-todo-empty">{all.length ? '没有符合筛选的待办' : '还没有关联待办，可以在这里新建，或点已有待办后的小锁绑定。'}</p> : null}
    </div>
    {compact && all.length > 0 ? <button className="stage-todo-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起每日记录' : `按天查看 · ${all.length}条`}</button> : null}
    {error ? <p className="todo-context-error" role="alert">{error}</p> : null}
    {menu ? <TodoActionPopover target={menu} categoryLabels={preferences.todoCategoryLabels} onDismiss={() => setMenu(null)} onChanged={refresh} /> : null}
  </Container>
}
