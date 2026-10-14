import { TodoCarryover } from './TodoCarryover'
import { useSmallStepCelebration } from '../hooks/useSmallStepCelebration'
import { useTodoDay } from '../hooks/useTodoDay'
import { TodoSmallStep } from './TodoSmallStep'
import { BusinessTripButton } from './BusinessTripStatus'
import { TodoCompletionButton } from './TodoCompletionButton'
import { TodoCreateOptions } from './TodoCreateOptions'
import type { TodoDateRange } from '../../../shared/domain'
import { projectModuleLabels } from '../utils/project-labels'
import { travelDayHighlight } from '../../../shared/travel-day'
import { BusinessTripStatus } from './BusinessTripStatus'
import { TodoDraftBatchSelection } from './TodoDraftBatchSelection'
import { draftProjectPatch, retainDraftOverrides } from '../../../shared/todo-draft-link'
import { TodoBatchLinkButton } from './TodoBatchLinkButton'
import { updateTodoWithStageOffer } from '../utils/todo-completion'
import { moveTodoWithinList, sortTodosByOrder } from '../../../shared/todo-order'
import { TodoCategoryPicker } from './TodoCategoryPicker'
import { TodoTitleEditor } from './TodoTitleEditor'
import { TodoProjectPicker } from './TodoProjectPicker'
import { DailyWorkLogEditor } from './DailyWorkLogEditor'
import { MoreHorizontal, SlidersHorizontal, Undo2, Equal, Check, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Maximize2, Plus, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useMemo, useRef, useState } from 'react'
import { TODO_CATEGORY_ORDER, type StageTimeKey, type ProjectColorToken, type TodoItem, type TodoSegment } from '../../../shared/domain'
import { addTodoDateDays, formatTodoDateLabel, groupTodoDateRanges, todoDateRangeError, todoVisibleOnDate } from '../../../shared/todo-date'
import { parseTodoBatch } from '../../../shared/todo-parser'
import { useWorkspaceStore } from '../store/workspace'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { TodoActionPopover, type TodoActionTarget } from './TodoActionPopover'

const segmentLabels: Record<TodoSegment, string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
const categoryOrder = TODO_CATEGORY_ORDER
const segmentOrder: TodoSegment[] = ['morning', 'afternoon', 'evening']

type TodoStyle = CSSProperties & {
  '--todo-color': string
  '--todo-soft': string
  '--todo-text': string
  '--todo-progress'?: string
}

function todoStyle(token: ProjectColorToken, progress?: number): TodoStyle {
  return {
    '--todo-color': `var(--${token})`,
    '--todo-soft': `var(--${token}-soft)`,
    '--todo-text': `var(--${token}-text)`,
    ...(progress === undefined ? {} : { '--todo-progress': `${progress * 3.6}deg` })
  }
}

export function TodoCompanionWindow({ mode }: { mode: 'tray' | 'widget' }): React.JSX.Element {
  const { today, todos, schedules, projects, preferences } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [stageSelections, setStageSelections] = useState<Record<string, 'manual' | 'suggested'>>({})
  const [stageOverrides, setStageOverrides] = useState<Record<string, StageTimeKey | null>>({})
  const [projectOverrides, setProjectOverrides] = useState<Record<string, string | null>>({})
  const [rawText, setRawText] = useState('')
  const [dateRange, setDateRange] = useState<TodoDateRange | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const view = preferences.companionTodoView ?? 'time'
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropGroup, setDropGroup] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const savingOrder = useRef(false)
  const setView = (value: 'all' | 'time' | 'category'): void => {
    setDragId(null); setDropTarget(null); setDropGroup(null)
    void setPreferences({ companionTodoView: value }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '查看方式保存失败'))
  }
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null)
  const selectedDate = selectedDateOverride ?? today
  const focus = useTodoDay(selectedDate, true)
  const celebration = useSmallStepCelebration(focus.entry)
  const focusView = celebration.presentation ? 'small' : focus.view
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)
  const [createExtra, setCreateExtra] = useState(false)
  const [undoTodo, setUndoTodo] = useState<{ before: TodoItem; updatedAt: string } | null>(null)
  const [toggling, setToggling] = useState(false)
  const travelTone = travelDayHighlight(schedules, selectedDate)?.tone
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState<TodoActionTarget | null>(null)
  const selectedDateLabel = formatTodoDateLabel(selectedDate, today)
  const activeProjects = useMemo(() => projects.filter((project) => !project.trashedAt), [projects])
  const parsedDrafts = useMemo(
    () => parseTodoBatch(rawText, {
      today,
      defaultDate: selectedDate,
      projects: activeProjects,
      categoryLabels: preferences.todoCategoryLabels,
      categoryMemories: preferences.todoCategoryMemories, stageMemories: preferences.todoStageMemories
    }),
    [activeProjects, preferences.todoCategoryLabels, preferences.todoCategoryMemories, preferences.todoStageMemories, rawText, selectedDate, today]
  )
  const drafts = parsedDrafts.map((draft, index) => { const key = `${index}:${draft.sourceText}`; return { ...draft, stageSelection: stageSelections[key] ?? draft.stageSelection, stageKey: Object.hasOwn(stageOverrides, key) ? stageOverrides[key]! : draft.stageKey ?? null, projectId: Object.hasOwn(projectOverrides, key) ? projectOverrides[key]! : draft.projectId, key } })
  const allVisible = useMemo(() => sortTodosByOrder(todos.filter((todo) => todo.source === 'manual' && todoVisibleOnDate(todo, selectedDate, today)), preferences.companionTodoOrder ?? []), [todos, selectedDate, today, preferences.companionTodoOrder])
  const visible = allVisible.filter(todo => !todo.isExtra || focus.entry.showExtra)
  const groups = useMemo(() => {
    const daily = visible.filter(todo => !todo.dateRange && !todo.isExtra)
    const normal = (view === 'all' ? [{ key: 'all', label: '自由排序', items: daily, category: null }] : view === 'time'
      ? [...segmentOrder.map(segment => ({ key: segment, label: segmentLabels[segment], items: daily.filter(todo => todo.segment === segment), category: null })), { key: 'unsegmented', label: '未分时段', items: daily.filter(todo => todo.segment === null), category: null }]
      : categoryOrder.map(category => ({ key: category, label: preferences.todoCategoryLabels[category], items: daily.filter(todo => todo.category === category), category })))
      .filter(group => group.items.length > 0).map(group => ({ ...group, dateLabel: '' }))
    return [...normal, ...groupTodoDateRanges(visible.filter(todo => !todo.isExtra)).map(group => ({ ...group, category: null })), ...(focus.entry.showExtra ? [{ key: 'extra', label: '额外', items: visible.filter(todo => todo.isExtra), category: null, dateLabel: '' }] : [])]
  }, [preferences.todoCategoryLabels, view, visible, focus.entry.showExtra])

  const reorder = async (source: string, target: string | null, after: boolean, groupKey?: string): Promise<void> => {
    setDragId(null); setDropTarget(null); setDropGroup(null)
    if (savingOrder.current || source === target || !visible.some((todo) => todo.id === source)) return
    const group = groups.find(group => group.key === groupKey || group.items.some(todo => todo.id === target)) ?? (view === 'time' && groupKey ? { key: groupKey, items: [] as TodoItem[] } : null)
    if (!group || (view !== 'time' && !group.items.some(todo => todo.id === source))) return
    const sourceExtra = Boolean(visible.find(todo => todo.id === source)?.isExtra)
    if (sourceExtra !== (group.key === 'extra')) return
    const sourceRange = visible.find(todo => todo.id === source)?.dateRange
    if (!sourceExtra && (Boolean(sourceRange) !== group.key.startsWith('range:') || (sourceRange && !group.items.some(todo => todo.id === source)))) return
    savingOrder.current = true; setError('')
    try {
      const live = useWorkspaceStore.getState().snapshot
      if (view === 'time' && !sourceRange && !sourceExtra) {
        const item = visible.find(todo => todo.id === source)!, anchor = group.items.find(todo => todo.id === target)
        const restoreFocus = document.activeElement?.getAttribute('aria-label') === `拖动排序：${item.title}`
        await window.creatorOS?.moveTodoInTime({ todoId: source, expectedUpdatedAt: item.updatedAt, day: selectedDate, segment: group.key === 'unsegmented' ? null : group.key as TodoSegment, target: anchor ? { todoId: anchor.id, expectedUpdatedAt: anchor.updatedAt } : null, after })
        await refresh()
        if (restoreFocus) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-todo-id="${source}"] .todo-reorder-handle`)?.focus())
      } else if (target) await setPreferences({ companionTodoOrder: moveTodoWithinList(live.todos, live.preferences.companionTodoOrder ?? [], group.items.map(todo => todo.id), source, target, after) })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '排序保存失败，请重试') }
    finally { savingOrder.current = false }
  }

  const changeDraftText = (text: string): void => {
    const next = parseTodoBatch(text, { today, defaultDate: selectedDate, projects: activeProjects, categoryLabels: preferences.todoCategoryLabels, categoryMemories: preferences.todoCategoryMemories, stageMemories: preferences.todoStageMemories })
    const keys = next.map((draft, index) => `${index}:${draft.sourceText}`)
    setProjectOverrides(current => retainDraftOverrides(current, keys))
    setStageOverrides(current => retainDraftOverrides(current, keys))
    setStageSelections(current => retainDraftOverrides(current, keys))
    setRawText(text)
  }

  const bindDrafts = (ids: string[], projectId: string | null): void => {
    const patches = drafts.filter(draft => ids.includes(draft.key)).map(draft => ({ key: draft.key, ...draftProjectPatch(draft, projectId, projects.find(project => project.id === projectId), preferences.todoStageMemories) }))
    setProjectOverrides(current => ({ ...current, ...Object.fromEntries(patches.map(patch => [patch.key, patch.projectId])) }))
    setStageOverrides(current => ({ ...current, ...Object.fromEntries(patches.map(patch => [patch.key, patch.stageKey])) }))
    setStageSelections(current => ({ ...current, ...Object.fromEntries(patches.map(patch => [patch.key, drafts.find(draft => draft.key === patch.key)?.projectId === projectId ? current[patch.key] ?? 'suggested' : 'suggested'])) }))
  }

  const create = async (): Promise<void> => {
    if (!window.creatorOS || !drafts.length || creating) return
    if (todoDateRangeError(dateRange)) { setError(todoDateRangeError(dateRange)!); return }
    setCreating(true); setError('')
    try {
      await window.creatorOS.createTodoBatch(drafts.map((draft) => ({
        isExtra: createExtra,
        title: draft.title,
        dateRange,
        plannedDate: dateRange ? null : draft.plannedDate,
        segment: dateRange ? null : draft.segment,
        category: draft.category,
        suggestedCategory: draft.suggestedCategory,
        projectId: draft.projectId,
        stageKey: draft.stageKey,
        stageSelection: draft.stageSelection,
        categorySelection: draft.categorySelection,
        trackingMode: draft.trackingMode,
        progress: draft.progress
      })))
      setComposerOpen(false)
      setRawText(''); setProjectOverrides({}); setStageOverrides({}); setStageSelections({})
      setCreateExtra(false); setDateRange(null)
      if (createExtra) await focus.update({ showExtra: true }, undefined, false, dateRange?.startDate ?? selectedDate)
      if (dateRange) setSelectedDateOverride(dateRange.startDate)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '待办创建失败')
    } finally { setCreating(false) }
  }

  const toggle = async (todo: TodoItem): Promise<void> => {
    if (!window.creatorOS || toggling) return
    setToggling(true); setError('')
    try {
      const updated = await updateTodoWithStageOffer(todo, { completed: todo.status !== 'completed', expectedUpdatedAt: todo.updatedAt })
      setUndoTodo({ before: todo, updatedAt: updated.updatedAt })
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '待办保存失败') }
    finally { setToggling(false) }
  }

  const listOptions = <div className="todo-list-options">
    <button aria-pressed={focus.entry.showExtra} disabled={focus.saving} onClick={() => void focus.update({ showExtra: !focus.entry.showExtra })}>{focus.entry.showExtra ? '不显示额外' : '显示额外'}</button>
    <button aria-label="待办视图" aria-expanded={Boolean(viewAnchor)} onClick={event => setViewAnchor(event.currentTarget)}><SlidersHorizontal size={12} />视图</button>
  </div>

  return <main data-focus-view={focusView} data-view={view} className={`todo-companion ${mode}${travelTone ? ` travel-surface-${travelTone}` : ''}`}>
    <header className="todo-companion-titlebar compact-titlebar">
      <div>{focus.entry.smallCompleted && focusView === 'small' ? <button className="todo-companion-back" aria-label="返回待办列表" disabled={focus.saving} onClick={() => { celebration.cancel(); void focus.update({ view: 'regular' }) }}><ChevronLeft size={12} /><b>待办</b></button> : <b>待办</b>}<div className="todo-companion-date-nav" role="group" aria-label="待办日期">
        <button aria-label="查看前一天待办" onClick={() => { celebration.cancel(); setSelectedDateOverride(addTodoDateDays(selectedDate, -1)); setDateAnchor(null); setMenu(null); setUndoTodo(null) }}><ChevronLeft size={11} /></button>
        <button className="todo-companion-date-label" aria-expanded={Boolean(dateAnchor)} aria-label={`选择待办日期，当前${selectedDateLabel}`} onClick={event => setDateAnchor(current => current ? null : event.currentTarget)}>{selectedDate === today ? `今天·${selectedDate.slice(5).replace('-', '/')}` : selectedDate.slice(5).replace('-', '/')}</button>
        <button aria-label="查看后一天待办" onClick={() => { celebration.cancel(); setSelectedDateOverride(addTodoDateDays(selectedDate, 1)); setDateAnchor(null); setMenu(null); setUndoTodo(null) }}><ChevronRight size={11} /></button>
      </div></div>
      <nav>
        <BusinessTripButton key={selectedDate} day={selectedDate} />
        <button aria-label={composerOpen ? '收起新建待办' : '展开新建待办'} title="新建待办" aria-expanded={composerOpen} onClick={() => { celebration.cancel(); void focus.update({ view: 'regular', ...(selectedDate === today ? { entered: true } : {}) }); setCreateExtra(false); setComposerOpen(value => !value) }}>{composerOpen ? <ChevronUp size={13} /> : <Plus size={13} />}</button>
        <button aria-label="更多待办操作" aria-expanded={Boolean(moreAnchor)} onClick={event => setMoreAnchor(event.currentTarget)}><MoreHorizontal size={15} /></button>
        <button aria-label="关闭待办窗口" title="关闭" onClick={() => { celebration.cancel(); void window.creatorOS?.closeTodoWindow() }}><X size={14} /></button>
      </nav>
    </header>
    <TodoCarryover key={`carryover-${selectedDate}-${today}`} day={selectedDate} />
    {!focus.entry.smallCompleted || (composerOpen && focusView === 'regular') ? <div className={`todo-companion-toolbar focus-toolbar${composerOpen ? ' composing' : ''}`}>
      {!focus.entry.smallCompleted ? <div className="segmented" role="group" aria-label="待办阶段">
        <button aria-pressed={focusView === 'small'} className={focusView === 'small' ? 'active' : ''} disabled={focus.saving} onClick={() => { celebration.cancel(); setComposerOpen(false); void focus.update({ view: 'small', ...(selectedDate === today ? { entered: true } : {}) }) }}>一小步</button>
        <button aria-pressed={focusView === 'regular'} className={focusView === 'regular' ? 'active' : ''} disabled={focus.saving} onClick={() => { celebration.cancel(); void focus.update({ view: 'regular', ...(selectedDate === today ? { entered: true } : {}) }) }}>普通待办</button>
      </div> : null}
      {composerOpen && focusView === 'regular' ? <TodoCreateOptions extra={createExtra} onExtraChange={setCreateExtra} dateRange={dateRange} onDateRangeChange={setDateRange} day={selectedDate} dayLabel={selectedDateLabel} disabled={creating} /> : null}
    </div> : null}
    <BusinessTripStatus key={`trip-${selectedDate}`} day={selectedDate} compact showCreate={false} />
    {moreAnchor ? <AnchoredPopover anchor={moreAnchor} ariaLabel="更多待办操作" className="todo-compact-menu" onDismiss={() => setMoreAnchor(null)}>
      {focus.entry.smallCompleted ? <button aria-label="查看已完成的一小步" disabled={focus.saving} onClick={() => { celebration.cancel(); setMoreAnchor(null); setComposerOpen(false); void focus.update({ view: 'small' }) }}><span>一小步</span><Check size={13} /></button> : null}
      <TodoBatchLinkButton key={`${selectedDate}:${view}`} todos={allVisible} />
      {mode === 'tray' ? <button onClick={() => { setMoreAnchor(null); void window.creatorOS?.openTodoWidget() }}><Maximize2 size={13} />浮在桌面</button> : null}
      <button onClick={() => { setMoreAnchor(null); void window.creatorOS?.openTodoMainWindow() }}><ExternalLink size={13} />打开主窗口</button>
    </AnchoredPopover> : null}
    {viewAnchor ? <AnchoredPopover anchor={viewAnchor} ariaLabel="待办查看方式" className="todo-compact-menu" role="menu" onDismiss={() => setViewAnchor(null)}>
      {(['all', 'time', 'category'] as const).map(value => <button role="menuitemradio" aria-checked={view === value} key={value} onClick={() => { setView(value); setViewAnchor(null) }}>{value === 'all' ? '全部' : value === 'time' ? '按时间' : '按分类'}{view === value ? <Check size={12} /> : null}</button>)}
    </AnchoredPopover> : null}
    {focus.error ? <p className="todo-companion-error" role="alert">{focus.error}</p> : null}
    {focusView === 'small' ? <TodoSmallStep key={`small-${selectedDate}`} entry={celebration.presentation?.entry ?? focus.entry} busy={focus.saving} celebrating={celebration.presentation?.phase === 'celebrating'} onDismissCelebration={celebration.cancel} onSave={(patch, revision) => celebration.save(patch, revision, focus.update)} /> : null}
    {dateAnchor ? <AnchoredPopover anchor={dateAnchor} ariaLabel="选择待办日期" className="todo-date-popover todo-companion-date-popover modal-calendar-popover" onDismiss={() => setDateAnchor(null)}>
      <CalendarDatePicker dayHighlight={day => travelDayHighlight(schedules, day)} clearable={false} label="查看待办日期" onChange={(value) => { celebration.cancel(); if (value) setSelectedDateOverride(value === today ? null : value); setDateAnchor(null) }} today={today} value={selectedDate} />
    </AnchoredPopover> : null}

    {composerOpen && focusView === 'regular' ? <section className="todo-companion-create">
      <textarea
        aria-label="批量新建待办"
        value={rawText}
        placeholder="新建待办"
        disabled={creating}
        onChange={(event) => changeDraftText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void create()
          }
        }}
      />
      <button disabled={creating || drafts.length === 0 || Boolean(todoDateRangeError(dateRange))} onClick={() => void create()}><Plus size={13} />{drafts.length ? `创建${drafts.length}条` : '创建'}</button>
    </section> : null}

    {composerOpen && focusView === 'regular' && drafts.length ? <section className="todo-companion-draft-preview" aria-label="待办项目预览">
      <TodoDraftBatchSelection key={`${selectedDate}:${rawText}`} items={drafts.map(draft => ({ id: draft.key, title: draft.title }))} disabled={creating} onApply={bindDrafts}>
        {checkbox => <div className="todo-companion-drafts">{drafts.map(draft => <div key={draft.key}>
          {checkbox(draft.key, draft.title)}<b>{draft.title}</b><TodoProjectPicker draftTitle={draft.title} value={draft.projectId ?? null} stageKey={draft.stageKey} candidateIds={draft.projectCandidateIds} automatic={!Object.hasOwn(projectOverrides, draft.key)} disabled={creating} onChange={(projectId, stageKey, selection) => { setStageSelections(current => ({ ...current, [draft.key]: selection ?? 'manual' })); setProjectOverrides(current => ({ ...current, [draft.key]: projectId })); setStageOverrides(current => ({ ...current, [draft.key]: stageKey })) }} />{draft.stageKey ? <small className="todo-draft-stage">{projectModuleLabels[draft.stageKey]}</small> : null}
        </div>)}</div>}
      </TodoDraftBatchSelection>
    </section> : null}

    {error ? <p className="todo-companion-error" role="alert">{error}</p> : null}
    <section hidden={focusView !== 'regular'} className="todo-companion-list" aria-label={`${selectedDateLabel}待办列表`}>
      {groups.map((group, groupIndex) => <section className={`todo-companion-group${dropGroup === group.key ? ' drop-active' : ''}`} data-time-group={view === 'time' && !group.dateLabel ? group.key : undefined} data-date-range={group.dateLabel || undefined}
        onDragOver={event => { if (!dragId || view !== 'time') return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropGroup(group.key); setDropTarget(null) }}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropGroup(null) }}
        onDrop={event => { if (!dragId || view !== 'time') return; event.preventDefault(); void reorder(dragId, null, true, group.key) }}
        style={group.category ? todoStyle(preferences.todoCategoryColors[group.category]) : undefined} key={group.key}>
        <header><div className="todo-group-caption"><span title={group.label}>{group.label}</span><small>{group.dateLabel ? `${group.items.filter(todo => todo.status === 'completed').length}/${group.items.length}已完成` : group.items.filter(todo => todo.status === 'open').length}</small>{group.dateLabel ? <span className="todo-range-group-dates">{group.dateLabel}</span> : null}</div>{group.key === 'extra' ? <button aria-label="新建额外待办" onClick={() => { setCreateExtra(true); setComposerOpen(true) }}><Plus size={12} /></button> : null}{groupIndex === 0 ? listOptions : null}</header>
        {group.items.map((todo) => {
          return <article
            data-todo-id={todo.id}
            data-reorder-edge={dropTarget?.id === todo.id ? (dropTarget.after ? 'after' : 'before') : undefined}
            onDragOver={(event) => { if (!dragId || (view !== 'time' && !group.items.some(item => item.id === dragId))) return; event.preventDefault(); event.stopPropagation(); setDropGroup(null); event.dataTransfer.dropEffect = 'move'; const box = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: todo.id, after: event.clientY > box.top + box.height / 2 }) }}
            onDrop={(event) => { if (!dragId || (view !== 'time' && !group.items.some(item => item.id === dragId))) return; event.preventDefault(); event.stopPropagation(); setDropGroup(null); const box = event.currentTarget.getBoundingClientRect(); void reorder(dragId, todo.id, event.clientY > box.top + box.height / 2) }}
            className={todo.status === 'completed' ? 'completed' : ''}
            style={todoStyle(preferences.todoCategoryColors[todo.category], todo.progress)}
            key={todo.id}
            onContextMenu={(event) => {
              event.preventDefault()
              setDateAnchor(null)
              setMenu({ anchor: event.currentTarget, anchorPoint: { x: event.clientX, y: event.clientY }, todo })
            }}
          >
            <button className="todo-reorder-handle" draggable aria-label={`拖动排序：${todo.title}`} title="拖动排序，或按Alt＋↑↓" onDragStart={(event) => { setMenu(null); setDragId(todo.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-creator-todo-order', todo.id) }} onDragEnd={() => { setDragId(null); setDropTarget(null); setDropGroup(null) }} onKeyDown={(event) => {
              if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault()
              const members = view === 'time' && !todo.dateRange ? groups.filter(item => !item.dateLabel).flatMap(item => item.items) : group.items
              const target = members[members.findIndex((item) => item.id === todo.id) + (event.key === 'ArrowDown' ? 1 : -1)]
              if (target) void reorder(todo.id, target.id, event.key === 'ArrowDown')
            }}><Equal size={12} /></button>
            <TodoCompletionButton todo={todo} disabled={toggling} onToggle={() => void toggle(todo)} />
            <div className={`todo-companion-copy${todo.projectId ? ' has-project' : ''}`}><TodoTitleEditor todo={todo} onBegin={() => setMenu(null)} /><TodoProjectPicker value={todo.projectId} stageKey={todo.stageKey} todo={todo} onChange={async (projectId, stageKey) => { await window.creatorOS?.updateTodo(todo.id, { projectId, stageKey }); await refresh() }} /></div>
            {view === 'time' || todo.dateRange ? <TodoCategoryPicker todo={todo} onBegin={() => { setDateAnchor(null); setMenu(null) }} /> : null}
          </article>
        })}
      </section>)}
      {view === 'time' && dragId && !visible.find(todo => todo.id === dragId)?.dateRange ? <div className="todo-empty-time-targets">{[...segmentOrder, 'unsegmented'].filter(key => !groups.some(group => group.key === key)).map(key => <div key={key} data-time-group={key} className={`todo-time-drop-slot${dropGroup === key ? ' drop-active' : ''}`}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropGroup(key); setDropTarget(null) }}
        onDragLeave={() => setDropGroup(null)}
        onDrop={event => { event.preventDefault(); void reorder(dragId, null, true, key) }}
      >移到{key === 'unsegmented' ? '未分时段' : segmentLabels[key as TodoSegment]}</div>)}</div> : null}
      {!groups.length ? <div className="todo-empty-heading"><span title={`${selectedDateLabel}还没有待办`}>{selectedDateLabel}还没有待办</span>{listOptions}</div> : !visible.length ? <div className="todo-companion-empty"><Check size={18} /><b>{selectedDateLabel}还没有待办</b></div> : null}
    </section>
    {menu ? <TodoActionPopover target={menu} categoryLabels={preferences.todoCategoryLabels} onDismiss={() => setMenu(null)} onChanged={refresh} /> : null}
    {undoTodo && focusView === 'regular' ? <div className="todo-completion-undo"><span>{undoTodo.before.title}</span><button disabled={toggling} onClick={async () => {
      setToggling(true)
      try {
        await window.creatorOS?.updateTodo(undoTodo.before.id, { completed: undoTodo.before.status === 'completed', expectedUpdatedAt: undoTodo.updatedAt })
        setUndoTodo(null); await refresh()
      } catch (reason) { setError(reason instanceof Error ? reason.message : '撤销失败') }
      finally { setToggling(false) }
    }}><Undo2 size={12} />撤销</button></div> : null}
    <DailyWorkLogEditor day={selectedDate} />
  </main>
}
