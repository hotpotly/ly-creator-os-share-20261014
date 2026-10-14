import { TodoCarryover } from './TodoCarryover'
import { useTodoDay } from '../hooks/useTodoDay'
import { TodoCompletionButton } from './TodoCompletionButton'
import { TodoDateRangeFields } from './TodoDateRangeFields'
import type { TodoDateRange } from '../../../shared/domain'
import { recommendedTodoStageForProject } from '../../../shared/todo-stage-recommendation'
import { projectModuleLabels } from '../utils/project-labels'
import { travelDayHighlight } from '../../../shared/travel-day'
import { BusinessTripStatus } from './BusinessTripStatus'
import { TodoDraftBatchSelection } from './TodoDraftBatchSelection'
import { draftProjectPatch } from '../../../shared/todo-draft-link'
import { TodoBatchLinkButton } from './TodoBatchLinkButton'
import { updateTodoWithStageOffer } from '../utils/todo-completion'
import { moveTodoWithinList, sortTodosByOrder } from '../../../shared/todo-order'
import { TodoCategoryPicker } from './TodoCategoryPicker'
import { TodoTitleEditor } from './TodoTitleEditor'
import { TodoProjectPicker } from './TodoProjectPicker'
import { DailyWorkLogEditor } from './DailyWorkLogEditor'
import { AppSelect } from './AppSelect'
import { CalendarDays, Equal, Check, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_COLOR_TOKENS, TODO_CATEGORY_ORDER, type StageTimeKey, type CreateTodoInput, type ProjectColorToken, type TodoCategory, type TodoItem, type TodoSegment } from '../../../shared/domain'
import { addTodoDateDays, formatTodoDateLabel, groupTodoDateRanges, todoDateRangeError, todoVisibleOnDate } from '../../../shared/todo-date'
import { parseTodoBatch } from '../../../shared/todo-parser'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { TodoActionPopover, type TodoActionTarget } from './TodoActionPopover'

const segmentLabels: Record<TodoSegment, string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
const segments = Object.keys(segmentLabels) as TodoSegment[]
const categories = TODO_CATEGORY_ORDER
const unsegmentedKey = 'unsegmented' as const
const TODO_DRAG_MIME = 'application/x-creator-os-todo-id'

type TodoColorStyle = CSSProperties & {
  '--todo-color': string
  '--todo-soft': string
  '--todo-text': string
  '--todo-progress'?: string
}

function categoryColorStyle(token: ProjectColorToken, progress?: number): TodoColorStyle {
  return {
    '--todo-color': `var(--${token})`,
    '--todo-soft': `var(--${token}-soft)`,
    '--todo-text': `var(--${token}-text)`,
    ...(progress === undefined ? {} : { '--todo-progress': `${progress * 3.6}deg` })
  }
}

interface TodoDraft extends CreateTodoInput {
  id: string
  projectCandidateIds?: string[]
  projectManual?: boolean
  categorySource: 'explicit' | 'memory' | 'rule' | 'manual'
}

function TodoRow({ todo, colorToken, showCategory, onToggle, onContextMenu, onEdit, onDragStart, onDragEnd, onProjectChange, onReorder, onRowDrop, onRowDragOver, dropEdge }: {
  todo: TodoItem
  onReorder(direction: number): void
  onRowDrop(event: React.DragEvent<HTMLElement>): void
  onRowDragOver(event: React.DragEvent<HTMLElement>): void
  dropEdge?: string
  colorToken: ProjectColorToken
  showCategory: boolean
  onToggle(todo: TodoItem): void
  onContextMenu(event: React.MouseEvent<HTMLElement>, todo: TodoItem): void
  onEdit(): void
  onDragStart(event: React.DragEvent<HTMLElement>, todo: TodoItem): void
  onDragEnd(): void
  onProjectChange(projectId: string | null, stageKey: StageTimeKey | null): Promise<void>
}): React.JSX.Element {
  const hasProgress = todo.trackingMode === 'progress' && todo.progress > 0 && todo.progress < 100
  return <article
    className={`todo-row${todo.status === 'completed' ? ' completed' : ''}`}
    data-todo-id={todo.id} data-reorder-edge={dropEdge}
    onDrop={onRowDrop} onDragOver={onRowDragOver}
    style={categoryColorStyle(colorToken, todo.progress)}
    draggable
    onDragStart={(event) => { if (event.currentTarget.querySelector('.todo-inline-title.editing')) { event.preventDefault(); return }; onDragStart(event, todo) }}
    onDragEnd={onDragEnd}
    onContextMenu={(event) => onContextMenu(event, todo)}
  >
    <button className="todo-reorder-handle" draggable aria-label={`拖动排序：${todo.title}`} title="拖动排序，或按Alt＋↑↓" onKeyDown={event => { if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onReorder(event.key === 'ArrowDown' ? 1 : -1) } }}><Equal size={12} /></button>
    <TodoCompletionButton todo={todo} onToggle={() => onToggle(todo)} />
    <div className="todo-row-copy">
      <div><TodoTitleEditor todo={todo} onBegin={onEdit} /><TodoProjectPicker value={todo.projectId} stageKey={todo.stageKey} todo={todo} onChange={onProjectChange} />{showCategory ? <TodoCategoryPicker todo={todo} onBegin={onEdit} /> : null}</div>
      {hasProgress ? <div className="todo-progress-line"><i style={{ width: `${todo.progress}%` }} /><small>{todo.progress}%</small></div> : null}
    </div>
  </article>
}

export function TodoWorkspace({ day, onDayChange }: { day?: string; onDayChange?: (day: string) => void } = {}): React.JSX.Element {
  const { today, todos, schedules, projects, productionChecklist, preferences } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [view, setView] = useState<'time' | 'category'>(preferences.homeTodoView)
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null)
  const selectedDate = day ?? selectedDateOverride ?? today
  const focus = useTodoDay(selectedDate)
  const [createExtra, setCreateExtra] = useState(false)
  const selectDate = (next: string | null): void => { if (onDayChange) onDayChange(next ?? today); else setSelectedDateOverride(next) }
  const travelTone = travelDayHighlight(schedules, selectedDate)?.tone
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState<TodoActionTarget | null>(null)
  const savingOrder = useRef(false)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const [colorEditor, setColorEditor] = useState<{ anchor: HTMLElement; category: TodoCategory } | null>(null)
  const [rawText, setRawText] = useState('')
  const [dateRange, setDateRange] = useState<TodoDateRange | null>(null)
  const [drafts, setDrafts] = useState<TodoDraft[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setView(preferences.homeTodoView) }, [preferences.homeTodoView])
  const activeProjects = useMemo(() => projects.filter((project) => !project.trashedAt), [projects])
  const productionForDate = useMemo(() => productionChecklist.filter((item) => item.scheduleDate === selectedDate && !item.completed), [productionChecklist, selectedDate])
  const visible = useMemo(() => sortTodosByOrder(todos.filter((todo) => todo.source === 'manual' && (!todo.isExtra || focus.entry.showExtra) && todoVisibleOnDate(todo, selectedDate, today)), preferences.companionTodoOrder ?? []), [selectedDate, today, todos, preferences.companionTodoOrder, focus.entry.showExtra])
  const openCount = visible.filter((todo) => !todo.isExtra && todo.status === 'open').length + productionForDate.length
  const selectedDateLabel = formatTodoDateLabel(selectedDate, today)

  const updateParsedDrafts = (value: string): void => {
    setRawText(value)
    setDrafts((current) => parseTodoBatch(value, {
      today,
      defaultDate: selectedDate,
      projects: activeProjects,
      categoryLabels: preferences.todoCategoryLabels,
      categoryMemories: preferences.todoCategoryMemories, stageMemories: preferences.todoStageMemories
    }).map((item, index) => ({
      ...item,
      ...(current[index]?.title === item.title && current[index]?.categorySource === 'manual' ? { category: current[index]!.category, categorySource: 'manual' as const, categorySelection: 'manual' as const } : {}),
      ...(current[index]?.title === item.title && current[index]?.projectManual ? { projectId: current[index]!.projectId, stageKey: current[index]!.stageKey, stageSelection: current[index]!.stageSelection, projectManual: true } : {}),
      id: globalThis.crypto.randomUUID()
    })))
  }

  const updateDraft = (id: string, patch: Partial<TodoDraft>): void => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch, ...(patch.title !== undefined && !draft.projectManual ? { stageKey: recommendedTodoStageForProject(patch.title, projects.find(project => project.id === draft.projectId), preferences.todoStageMemories) } : {}) } : draft))
  }

  const createTodos = async (): Promise<void> => {
    if (!window.creatorOS || drafts.length === 0 || saving) return
    if (todoDateRangeError(dateRange)) { setError(todoDateRangeError(dateRange)!); return }
    setSaving(true); setError('')
    try {
      await window.creatorOS.createTodoBatch(drafts.map((draft) => ({
        title: draft.title,
        isExtra: createExtra,
        dateRange,
        plannedDate: dateRange ? null : draft.plannedDate,
        segment: dateRange ? null : draft.segment,
        category: draft.category,
        suggestedCategory: draft.suggestedCategory,
        projectId: draft.projectId,
        stageKey: draft.stageKey,
        stageSelection: draft.stageSelection,
        categorySelection: draft.categorySource === 'manual' ? 'manual' : draft.categorySelection,
        trackingMode: draft.trackingMode,
        progress: draft.progress
      })))
      await refresh()
      if (createExtra) await focus.update({ showExtra: true }, undefined, false, dateRange?.startDate ?? selectedDate)
      if (dateRange) selectDate(dateRange.startDate)
      setComposerAnchor(null); setRawText(''); setDrafts([]); setDateRange(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '待办创建失败')
    } finally { setSaving(false) }
  }

  const toggleTodo = async (todo: TodoItem): Promise<void> => {
    if (!window.creatorOS) return
    setError('')
    try {
      await updateTodoWithStageOffer(todo, { completed: todo.status !== 'completed' })
      await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '待办保存失败') }
  }

  const completeProductionItem = async (projectId: string, itemId: string): Promise<void> => {
    if (!window.creatorOS) return
    setError('')
    try {
      const notes = await window.creatorOS.getProjectProductionNotes(projectId)
      await window.creatorOS.setProjectProductionNotes(projectId, {
        shootingItems: notes.shootingItems.map((item) => item.id === itemId ? { ...item, completed: true } : item),
        editingNotes: notes.editingNotes,
        editingNotesFormat: notes.editingNotesFormat
      })
      await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '项目待办保存失败') }
  }

  const moveTodoToGroup = async (event: React.DragEvent<HTMLElement>, groupKey: string): Promise<void> => {
    event.preventDefault()
    setDragOverKey(null)
    setDraggingTodoId(null); setDropTarget(null)
    if (!window.creatorOS) return
    const todoId = event.dataTransfer.getData(TODO_DRAG_MIME) || event.dataTransfer.getData('text/plain').replace(/^todo:/, '')
    const todo = visible.find((item) => item.id === todoId)
    if (!todo || (todo.dateRange && view === 'time')) return
    setError('')
    try {
      if (view === 'time') {
        const segment = groupKey === unsegmentedKey ? null : groupKey as TodoSegment
        await moveTime(todo, null, segment, true)
        return
      } else {
        const category = groupKey as TodoCategory
        if (todo.category === category) return
        await window.creatorOS.updateTodo(todo.id, { category })
      }
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '待办移动失败')
    }
  }

  const moveTime = async (todo: TodoItem, target: TodoItem | null, segment: TodoSegment | null, after: boolean): Promise<void> => {
    if (savingOrder.current) return
    savingOrder.current = true
    const restoreFocus = document.activeElement?.getAttribute('aria-label') === `拖动排序：${todo.title}`
    try {
      await window.creatorOS?.moveTodoInTime({ todoId: todo.id, expectedUpdatedAt: todo.updatedAt, day: selectedDate, segment, target: target ? { todoId: target.id, expectedUpdatedAt: target.updatedAt } : null, after })
      await refresh()
      if (restoreFocus) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-todo-id="${todo.id}"] .todo-reorder-handle`)?.focus())
    } finally { savingOrder.current = false }
  }

  const reorder = async (members: TodoItem[], source: string, target: string, after: boolean): Promise<void> => {
    setDraggingTodoId(null); setDropTarget(null); setDragOverKey(null); setError('')
    if (source === target) return
    const sourceTodo = visible.find(todo => todo.id === source), targetTodo = visible.find(todo => todo.id === target)
    if (Boolean(sourceTodo?.dateRange) !== Boolean(targetTodo?.dateRange) || (sourceTodo?.dateRange && !members.some(todo => todo.id === source))) return
    const live = useWorkspaceStore.getState().snapshot
    try {
      if (view === 'time' && !members.some(item => item.dateRange)) {
        const todo = visible.find(item => item.id === source), anchor = visible.find(item => item.id === target)
        if (todo && anchor) await moveTime(todo, anchor, anchor.segment, after)
      } else await setPreferences({ companionTodoOrder: moveTodoWithinList(live.todos, live.preferences.companionTodoOrder ?? [], members.map(todo => todo.id), source, target, after) })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '排序保存失败') }
  }

  const dailyGroups = (view === 'time'
    ? [...segments.map((key) => ({
        key,
        label: segmentLabels[key],
        items: visible.filter((todo) => !todo.dateRange && todo.segment === key),
        production: productionForDate.filter((item) => item.scheduleSegment === key)
      })), {
        key: unsegmentedKey,
        label: '未分时段',
        items: visible.filter((todo) => !todo.dateRange && todo.segment === null),
        production: productionForDate.filter((item) => item.scheduleSegment === null)
      }]
    : categories.map((key) => ({
        key,
        label: preferences.todoCategoryLabels[key],
        items: visible.filter((todo) => !todo.dateRange && todo.category === key),
        production: key === 'self_media' ? productionForDate : []
      }))).filter((group) => draggingTodoId !== null || group.items.length > 0 || group.production.length > 0)
    .sort((a, b) => view === 'time' && draggingTodoId ? Number(!a.items.length && !a.production.length) - Number(!b.items.length && !b.production.length) : 0)

  const groupEntries = [...dailyGroups.map(group => ({ ...group, dateLabel: '' })), ...groupTodoDateRanges(visible).map(group => ({ ...group, production: [] as typeof productionForDate }))]

  return <section className={`card todo-workspace${travelTone ? ` travel-surface-${travelTone}` : ''}`}>
    <header className="card-header todo-workspace-header">
      <h2>待办</h2><span className="count-badge">{openCount}</span>
      <div className="todo-date-nav" role="group" aria-label="待办日期">
        <button aria-label="查看前一天待办" onClick={() => { selectDate(addTodoDateDays(selectedDate, -1)); setDateAnchor(null); setMenu(null) }}><ChevronLeft size={13} /></button>
        <button className="todo-date-label" aria-expanded={Boolean(dateAnchor)} aria-label={`选择待办日期，当前${selectedDateLabel}`} onClick={(event) => { const anchor = event.currentTarget; setDateAnchor((current) => current ? null : anchor) }}><CalendarDays size={13} />{selectedDateLabel}</button>
        <button aria-label="查看后一天待办" onClick={() => { selectDate(addTodoDateDays(selectedDate, 1)); setDateAnchor(null); setMenu(null) }}><ChevronRight size={13} /></button>
        {selectedDate !== today ? <button className="todo-date-today" onClick={() => { selectDate(null); setDateAnchor(null); setMenu(null) }}>今天</button> : null}
      </div>
      <TodoCarryover key={`carryover-${selectedDate}-${today}`} day={selectedDate} />
      <div className="segmented todo-view-switch" aria-label="待办查看方式">
        <button className={view === 'time' ? 'active' : ''} onClick={() => { setView('time'); void setPreferences({ homeTodoView: 'time' }) }}>按时间</button>
        <button className={view === 'category' ? 'active' : ''} onClick={() => { setView('category'); void setPreferences({ homeTodoView: 'category' }) }}>按分类</button>
      </div>
      <TodoBatchLinkButton key={`${selectedDate}:${view}`} todos={visible} />
      <button className="todo-create-button" onClick={(event) => { setComposerAnchor(event.currentTarget); setMenu(null) }}><Plus size={13} />新建</button>
    </header>
    <div className="todo-list-options"><button aria-pressed={focus.entry.showExtra} disabled={focus.saving} onClick={() => void focus.update({ showExtra: !focus.entry.showExtra })}>{focus.entry.showExtra ? '不显示额外' : '显示额外'}</button></div>
    {focus.error ? <p role="alert" className="todo-error">{focus.error}</p> : null}
    <BusinessTripStatus key={selectedDate} day={selectedDate} />
    <div className={`todo-groups ${view}`}>
      {groupEntries.map((group) => {
        const category = view === 'category' && !group.dateLabel ? group.key as TodoCategory : null
        const colorToken = category ? preferences.todoCategoryColors[category] : null
        return <section
          className={`todo-group${category ? ' category-card' : ''}${dragOverKey === group.key ? ' drop-active' : ''}`}
          style={colorToken ? categoryColorStyle(colorToken) : undefined}
          key={group.key}
          data-time-group={view === 'time' && !group.dateLabel ? group.key : undefined} data-date-range={group.dateLabel || undefined}
          onDragEnter={(event) => { if (event.dataTransfer.types.includes(TODO_DRAG_MIME)) setDragOverKey(group.key) }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(TODO_DRAG_MIME)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDragOverKey(group.key); setDropTarget(null)
          }}
          onDragLeave={(event) => {
            const related = event.relatedTarget
            if (related instanceof Node && event.currentTarget.contains(related)) return
            setDragOverKey((current) => current === group.key ? null : current)
          }}
          onDrop={(event) => { if (group.dateLabel) { event.preventDefault(); setDraggingTodoId(null); setDragOverKey(null); return }; void moveTodoToGroup(event, group.key) }}
        >
        <header
          title={category ? '右键更改分类颜色' : undefined}
          onContextMenu={category ? (event) => {
            event.preventDefault()
            setColorEditor({ anchor: event.currentTarget, category })
          } : undefined}
        ><h3>{group.label}</h3>{group.dateLabel ? <small className="todo-range-group-dates">{group.dateLabel}</small> : null}<span>{group.dateLabel ? `${group.items.filter(todo => todo.status === 'completed').length}/${group.items.length}已完成` : group.items.filter(todo => todo.status === 'open').length + group.production.length}</span></header>
        <div>
          {group.production.map((item) => <article className="todo-row production" style={categoryColorStyle(preferences.todoCategoryColors.self_media)} key={`production:${item.projectId}:${item.id}`}>
            <button className="todo-check" aria-label={`完成${item.text}`} onClick={() => void completeProductionItem(item.projectId, item.id)} />
            <div className="todo-row-copy"><div><button className="todo-title-link" onClick={() => navigate({ page: 'project', projectId: item.projectId, moduleKey: 'production' })}>{item.text}</button>{view === 'time' ? <span className="todo-category-tag">{preferences.todoCategoryLabels.self_media}</span> : null}</div><small>{projects.find((project) => project.id === item.projectId)?.title ?? '项目拍摄清单'}</small></div>
          </article>)}
          {group.items.map((todo) => {
            return <TodoRow
              key={todo.id}
              todo={todo}
              dropEdge={dropTarget?.id === todo.id ? dropTarget.after ? 'after' : 'before' : undefined}
              onReorder={direction => { const members = view === 'time' && !todo.dateRange ? groupEntries.filter(item => !item.dateLabel).flatMap(item => item.items) : group.items; const target = members[members.findIndex(item => item.id === todo.id) + direction]; if (target) void reorder(group.items, todo.id, target.id, direction > 0) }}
              onRowDragOver={event => { if (!draggingTodoId || (view !== 'time' && !group.items.some(item => item.id === draggingTodoId))) return; event.preventDefault(); event.stopPropagation(); setDragOverKey(null); const bounds = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: todo.id, after: event.clientY > bounds.top + bounds.height / 2 }) }}
              onRowDrop={event => { if (!draggingTodoId || (view !== 'time' && !group.items.some(item => item.id === draggingTodoId))) return; event.preventDefault(); event.stopPropagation(); setDragOverKey(null); const bounds = event.currentTarget.getBoundingClientRect(); void reorder(group.items, draggingTodoId, todo.id, event.clientY > bounds.top + bounds.height / 2) }}
              colorToken={preferences.todoCategoryColors[todo.category]}
              showCategory={view === 'time' || Boolean(todo.dateRange)}
              onProjectChange={async (projectId, stageKey) => { await window.creatorOS?.updateTodo(todo.id, { projectId, stageKey }); await refresh() }}
              onEdit={() => setMenu(null)}
              onToggle={(item) => void toggleTodo(item)}
              onDragStart={(event, item) => {
                event.dataTransfer.setData(TODO_DRAG_MIME, item.id)
                event.dataTransfer.effectAllowed = 'move'
                setDraggingTodoId(item.id)
                setMenu(null)
              }}
              onDragEnd={() => {
                setDropTarget(null)
                setDragOverKey(null)
                setDraggingTodoId(null)
              }}
              onContextMenu={(event, item) => {
              event.preventDefault()
              setComposerAnchor(null)
                setMenu({ anchor: event.currentTarget, anchorPoint: { x: event.clientX, y: event.clientY }, todo: item })
            }} />
          })}
          {group.items.length === 0 && group.production.length === 0 ? <p className="todo-group-empty">暂无待办</p> : null}
        </div>
      </section>})}
    </div>
    {error ? <p className="todo-error" role="alert">{error}</p> : null}
    <DailyWorkLogEditor day={selectedDate} />

    {composerAnchor ? <AnchoredPopover anchor={composerAnchor} ariaLabel="批量新建待办" className="todo-composer" onDismiss={() => setComposerAnchor(null)}>
      <header><div><b>新建待办</b></div><button aria-label="关闭新建待办" onClick={() => setComposerAnchor(null)}><X size={14} /></button></header>
      <label className="todo-create-extra"><input type="checkbox" checked={createExtra} onChange={event => setCreateExtra(event.target.checked)} />额外</label>
      <TodoDateRangeFields value={dateRange} onChange={setDateRange} defaultDay={selectedDate} disabled={saving} singleLabel={selectedDateLabel} />
      <textarea autoFocus disabled={saving} value={rawText} placeholder="输入待办内容，可用换行或逗号分隔多件事" onChange={(event) => updateParsedDrafts(event.currentTarget.value)} />
      <TodoDraftBatchSelection key={`${selectedDate}:${JSON.stringify(drafts.map(draft => draft.id))}`} items={drafts} disabled={saving} onApply={(ids, projectId) => setDrafts(current => current.map(draft => ids.includes(draft.id) ? { ...draft, ...draftProjectPatch(draft, projectId, projects.find(project => project.id === projectId), preferences.todoStageMemories), stageSelection: projectId === draft.projectId ? draft.stageSelection : 'suggested', projectManual: true } : draft))}>
      {checkbox => <div className="todo-draft-list">
        {drafts.map((draft) => <article key={draft.id}>
          <button aria-label="移除这条待办" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}><X size={12} /></button>
          <div className="todo-draft-title-row">{checkbox(draft.id, draft.title)}<input aria-label="待办标题" value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.currentTarget.value })} /><TodoProjectPicker draftTitle={draft.title} value={draft.projectId ?? null} stageKey={draft.stageKey} candidateIds={draft.projectCandidateIds} automatic={!draft.projectManual} disabled={saving} onChange={(projectId, stageKey, selection) => updateDraft(draft.id, { projectId, stageKey, stageSelection: selection ?? 'manual', projectManual: true })} />{draft.stageKey ? <small className="todo-draft-stage">{projectModuleLabels[draft.stageKey]}</small> : null}</div>
          <div>
            {!dateRange ? <><input aria-label="待办日期" value={draft.plannedDate ?? ''} placeholder="日期" onChange={(event) => updateDraft(draft.id, { plannedDate: event.currentTarget.value || null })} />
            <AppSelect aria-label="待办时段" value={draft.segment ?? ''} onChange={(event) => updateDraft(draft.id, { segment: (event.currentTarget.value || null) as TodoSegment | null })}>
              <option value="">未分时段</option>{segments.map((segment) => <option value={segment} key={segment}>{segmentLabels[segment]}</option>)}
            </AppSelect></> : null}
            <AppSelect aria-label="待办分类" value={draft.category} onChange={(event) => updateDraft(draft.id, { category: event.currentTarget.value as TodoCategory, categorySource: 'manual' })}>
              {categories.map((category) => <option value={category} key={category}>{preferences.todoCategoryLabels[category]}</option>)}
            </AppSelect>
            {draft.trackingMode === 'progress' ? <span>{draft.progress}%</span> : null}
          </div>
        </article>)}
        {rawText.trim() && drafts.length === 0 ? <p>还没有识别到可创建的待办</p> : null}
      </div>}
      </TodoDraftBatchSelection>
      <footer><button className="primary-action" disabled={saving || Boolean(todoDateRangeError(dateRange)) || drafts.length === 0 || drafts.some((draft) => !draft.title.trim())} onClick={() => void createTodos()}>{saving ? '创建中…' : `创建${drafts.length}条待办`}</button></footer>
    </AnchoredPopover> : null}

    {dateAnchor ? <AnchoredPopover anchor={dateAnchor} ariaLabel="选择待办日期" className="todo-date-popover modal-calendar-popover" onDismiss={() => setDateAnchor(null)}>
      <CalendarDatePicker dayHighlight={day => travelDayHighlight(schedules, day)} clearable={false} label="查看待办日期" onChange={(value) => { if (value) selectDate(value === today ? null : value); setDateAnchor(null); setMenu(null) }} today={today} value={selectedDate} />
    </AnchoredPopover> : null}

    {menu ? <TodoActionPopover target={menu} categoryLabels={preferences.todoCategoryLabels} onDismiss={() => setMenu(null)} onChanged={refresh} /> : null}

    {colorEditor ? <AnchoredPopover anchor={colorEditor.anchor} ariaLabel={`设置${preferences.todoCategoryLabels[colorEditor.category]}分类颜色`} className="todo-color-popover" onDismiss={() => setColorEditor(null)}>
      <header><b>{preferences.todoCategoryLabels[colorEditor.category]}颜色</b><button aria-label="关闭分类颜色设置" onClick={() => setColorEditor(null)}><X size={12} /></button></header>
      <div>{PROJECT_COLOR_TOKENS.map((token) => <button
        key={token}
        className={preferences.todoCategoryColors[colorEditor.category] === token ? 'active' : ''}
        style={categoryColorStyle(token)}
        aria-label={`使用颜色${token.replace('project-', '')}`}
        onClick={() => void setPreferences({ todoCategoryColors: { ...preferences.todoCategoryColors, [colorEditor.category]: token } })}
      ><i />{preferences.todoCategoryColors[colorEditor.category] === token ? <Check size={11} /> : null}</button>)}</div>
    </AnchoredPopover> : null}


  </section>
}
