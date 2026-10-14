import { groupScheduleItems, type ScheduleDisplayItem } from '../../../shared/schedule-group'
import { travelDayHighlight, travelLabel } from '../../../shared/travel-day'
import { BusinessTripButton, BusinessTripEditor } from './BusinessTripStatus'
import { tripDate } from '../../../shared/business-trip'
import { useScheduleRangeCreate } from '../hooks/useScheduleRangeCreate'
import { useSchedulePointerDrag } from '../hooks/useSchedulePointerDrag'
import { SchedulePropertyEditor, type ScheduleProperty } from './SchedulePropertyEditor'
import { AppSelect } from './AppSelect'
import { Check, ChevronLeft, ChevronRight, Flag, GripVertical, Palette, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_COLOR_TOKENS, type OptionalProjectModuleKey, type ProjectColorToken, type ProjectModuleKey, type ProjectSummary, type ScheduleItem } from '../../../shared/domain'
import { useInspectorDrawer } from '../hooks/useInspectorDrawer'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleForScheduleAction, projectModuleLabels } from '../utils/project-labels'
import { navigate } from '../utils/router'
import { isCrossDaySchedule, moveScheduleToDate, scheduleOccupiedRows, resizeScheduleRange, scheduleOccursOnDate, scheduleRangeSegmentsForWeek, scheduleResizeDeltaForDate, type ScheduleRangeEdge, type ScheduleRangeSegment } from '../../../shared/schedule-range'
import { deriveTopicDeadlineMarkers, type TopicDeadlineMarker } from '../../../shared/topic-deadline-marker'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { ProjectColorPicker } from './ProjectColorPicker'
import { ResizableInspectorDivider } from './ResizableInspectorDivider'

type ViewMode = 'week' | 'month' | 'day' | 'list'
type MenuPoint = { x: number; y: number }
type ScheduleStageSelection = OptionalProjectModuleKey | 'overview'
const PROJECT_DRAG_MIME = 'application/x-creator-project-id'
const PROJECT_OVERVIEW_DRAG_MIME = 'text/project-overview-id'
const TOPIC_DEADLINE_DRAG_MIME = 'application/x-creator-topic-deadline-id'
const UNBOUND_SCHEDULE_FILTER = '__unbound__'
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const monthWeekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function isoDate(date: Date): string {
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function calendarDayDelta(a: Date, b: Date): number { return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000) }
function addDays(date: Date, amount: number): Date { const result = new Date(date); result.setDate(result.getDate() + amount); return result }
function startOfWeek(date: Date): Date { const result = new Date(date); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result }
function formatMonthDay(date: Date): string { return `${date.getMonth() + 1}月${date.getDate()}日` }
function localDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1, 12)
}
function eventDate(item: ScheduleItem): string | null { return item.startAt ? isoDate(new Date(item.startAt)) : null }
function eventsFor(items: ScheduleItem[], date: Date, projectFilter?: string): ScheduleItem[] {
  const key = isoDate(date)
  return items.filter((item) => eventDate(item) === key && (!projectFilter || item.projectId === projectFilter))
}
function topicMarkersFor(markers: TopicDeadlineMarker[], date: Date): TopicDeadlineMarker[] {
  const key = isoDate(date)
  return markers.filter((marker) => marker.date === key)
}
function projectModule(item: ScheduleItem): ProjectModuleKey {
  return projectModuleForScheduleAction(item.actionType)
}
function openScheduleTarget(item: ScheduleItem): void {
  if (!item.projectId) return
  if (item.actionType === 'script') { navigate({ page: 'workbench', projectId: item.projectId }); return }
  navigate({ page: 'project', projectId: item.projectId, moduleKey: projectModule(item) })
}
function timeLabel(item: ScheduleItem): string {
  if (item.trip) return travelLabel(item)
  if (!item.startAt) return '未排期'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.startAt))
}
function kindLabel(item: ScheduleItem): string { if (item.trip) return `${travelLabel(item)}安排`; return item.scheduleKind === 'plan' ? '普通计划' : item.scheduleKind === 'publish_date' ? '发布日期' : item.actionType === 'overview' ? '目标日' : '截止日' }
function stateLabel(item: ScheduleItem): string { if (item.state === 'done') return '已完成'; if (item.trip) return item.trip.cancelled ? `已取消${travelLabel(item)}` : item.trip.endedEarly ? `${travelLabel(item)}已结束` : '按日期显示'; return item.state === 'normal' ? '正常' : item.state === 'waiting' ? '等待' : '逾期' }
type ScheduleSegment = 'morning' | 'afternoon' | 'evening'
const scheduleSegmentLabels: Record<ScheduleSegment, string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
function scheduleSegment(date: Date): ScheduleSegment { return date.getHours() < 12 ? 'morning' : date.getHours() < 18 ? 'afternoon' : 'evening' }
function fullTimeLabel(item: ScheduleItem): string {
  if (item.trip) return `${tripDate(item.startAt)}—${tripDate(item.endAt)}`
  if (!item.startAt) return '未排期'
  const date = new Date(item.startAt)
  return `${date.getMonth() + 1}月${date.getDate()}日${scheduleSegmentLabels[scheduleSegment(date)]}`
}
function beginScheduleDrag(event: React.DragEvent<HTMLElement>, item: ScheduleItem): void {
  if (!item.isMovable || item.trip?.cancelled || item.trip?.endedEarly) { event.preventDefault(); return }
  event.dataTransfer.setData('text/schedule-id', item.id)
  event.dataTransfer.effectAllowed = 'move'
  const week = event.currentTarget.closest<HTMLElement>('[data-calendar-week]')
  if (isCrossDaySchedule(item) && week?.dataset.calendarWeekStart) {
    const bounds = week.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right) return
    const column = Math.max(0, Math.min(6, Math.floor((event.clientX - bounds.left) / (bounds.width / 7))))
    event.dataTransfer.setData('text/schedule-grab-date', isoDate(addDays(localDate(week.dataset.calendarWeekStart), column)))
  }
}

type ResizePointerHandler = (event: React.PointerEvent<HTMLElement>, item: ScheduleItem, edge: ScheduleRangeEdge) => void
type ResizeKeyboardHandler = (item: ScheduleItem, edge: ScheduleRangeEdge, days: number, restoreFocus?: boolean) => void

function schedulePillClasses(item: ScheduleItem, selected: boolean, extra = ''): string {
  const kind = item.scheduleKind === 'plan' ? '' : item.scheduleKind === 'publish_date' ? ' publish-date' : ' hard'
  const state = item.state === 'normal' ? '' : ` ${item.state}`
  const publishing = item.actionType === 'publishing' ? ' publishing' : ''
  return `schedule-pill${kind}${publishing}${state}${selected ? ' selected' : ''}${extra}`
}

function scheduleDisplayName(project: ProjectSummary | undefined): string {
  return project?.title ?? '其他安排'
}
function scheduleColorToken(item: ScheduleItem, project: ProjectSummary | undefined): ProjectColorToken {
  return item.trip ? item.trip.kind === 'home' ? 'project-2' : item.trip.kind === 'rest' ? 'project-6' : 'project-3' : item.colorToken ?? project?.colorToken ?? 'project-4'
}
function projectScheduleStyle(item: ScheduleItem, project: ProjectSummary | undefined): React.CSSProperties {
  const colorToken = item.trip ? `travel-${item.trip.kind ?? 'business'}` : scheduleColorToken(item, project)
  return {
    '--schedule-color': `var(--${colorToken})`,
    '--schedule-soft': `var(--${colorToken}-soft)`,
    '--schedule-text': `var(--${colorToken}-text)`
  } as React.CSSProperties
}

function TopicDeadlineFlag({ marker, compact = false }: { marker: TopicDeadlineMarker; compact?: boolean }): React.JSX.Element {
  const accessibleName = `${marker.title}·目标日${marker.date}${marker.overdue ? '·已逾期' : ''}`
  return <button
    type="button"
    className={`topic-deadline-marker${compact ? ' compact' : ''}${marker.overdue ? ' overdue' : ''}`}
    data-topic-deadline-id={marker.topicId}
    aria-label={accessibleName}
    title={accessibleName}
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData(TOPIC_DEADLINE_DRAG_MIME, marker.topicId)
      event.dataTransfer.effectAllowed = 'move'
    }}
    onClick={() => navigate({ page: 'topics', topicId: marker.topicId })}
  >
    <Flag size={compact ? 9 : 10} aria-hidden="true" />
    <span>{marker.title}</span>
  </button>
}

function ProjectTargetFlag({ item, project, compact = false, selected = false, expanded, inspect, openColorMenu }: { item: ScheduleItem; project: ProjectSummary; openColorMenu: (item: ScheduleItem, anchor: HTMLElement, point?: MenuPoint) => void; compact?: boolean; selected?: boolean; expanded?: boolean; inspect: (item: ScheduleItem, anchor: HTMLElement) => void }): React.JSX.Element {
  const accessibleName = `${project.title}·目标日${item.startAt ? isoDate(new Date(item.startAt)) : ''}${item.state === 'done' ? '·已完成' : ''}`
  return <button
    type="button"
    className={`topic-deadline-marker project-target-marker${compact ? ' compact' : ''}${selected ? ' selected' : ''}${item.state === 'overdue' ? ' overdue' : ''}${item.state === 'done' ? ' done' : ''}`}
    data-project-target-id={item.id}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openColorMenu(item, event.currentTarget, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined) }}
    aria-label={accessibleName}
    aria-pressed={selected}
    aria-expanded={expanded}
    title={accessibleName}
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData('text/schedule-id', item.id)
      event.dataTransfer.effectAllowed = 'move'
    }}
    onClick={(event) => inspect(item, event.currentTarget)}
    onDoubleClick={() => openScheduleTarget(item)}
  >
    <Flag size={compact ? 9 : 10} aria-hidden="true" />
    <span>{project.title}·目标日</span>
  </button>
}

function ResizeHandle({ item, edge, onPointerResize, onKeyboardResize }: { item: ScheduleItem; edge: ScheduleRangeEdge; onPointerResize: ResizePointerHandler; onKeyboardResize: ResizeKeyboardHandler }): React.JSX.Element | null {
  if (!item.isMovable) return null
  const edgeLabel = edge === 'start' ? '开始日期' : '结束日期'
  return <button
    type="button"
    className={`schedule-resize-handle ${edge}`}
    data-schedule-resize-id={item.id}
    data-resize-edge={edge}
    aria-label={`调整${item.title}${edgeLabel}`}
    title={`拖动调整${edgeLabel}`}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => onPointerResize(event, item, edge)}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : 7
      onKeyboardResize(item, edge, delta, true)
    }}
  />
}

function EventPill({ item, project, compact = false, expanded, selected = false, resizableEnd = false, resizing = false, targetAttached = false, inspect, openColorMenu, onPointerResize, onKeyboardResize }: { item: ScheduleItem; project?: ProjectSummary; compact?: boolean; expanded?: boolean; selected?: boolean; resizableEnd?: boolean; resizing?: boolean; targetAttached?: boolean; inspect: (item: ScheduleItem, anchor: HTMLElement) => void; openColorMenu: (item: ScheduleItem, anchor: HTMLElement, point?: MenuPoint) => void; onPointerResize: ResizePointerHandler; onKeyboardResize: ResizeKeyboardHandler }): React.JSX.Element {
  const deadlineTime = item.startAt && item.scheduleKind !== 'plan' ? timeLabel(item) : ''
  const eventTitle = `${item.trip?.cancelled ? '已取消·' : item.trip?.endedEarly ? '已结束·' : ''}${deadlineTime}${item.title}`
  const ownerName = item.trip ? travelLabel(item) : scheduleDisplayName(project)
  const accessibleName = `${ownerName}·${eventTitle}${item.scheduleKind === 'hard_deadline' ? item.actionType === 'overview' ? '·目标日' : '·截止日' : item.scheduleKind === 'publish_date' ? '·发布日期' : ''}${item.state === 'waiting' ? '·等待' : ''}${item.state === 'done' ? '·已完成' : ''}`
  const openProject = (): void => openScheduleTarget(item)
  return <div className={`schedule-pill-shell${resizableEnd ? ' resizable-end' : ''}${resizing ? ' resizing' : ''}`} style={projectScheduleStyle(item, project)}>
    <button
      data-schedule-focus-id={item.id}
      className={schedulePillClasses(item, selected)}
      aria-label={accessibleName} aria-expanded={expanded} aria-pressed={selected} title={accessibleName} draggable
      onDragStart={(event) => beginScheduleDrag(event, item)}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openColorMenu(item, event.currentTarget, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined) }}
      onClick={(event) => inspect(item, event.currentTarget)} onDoubleClick={openProject}
    >
      {item.state === 'done' ? <span className="schedule-done-mark" aria-hidden="true"><Check size={compact ? 8 : 9} /></span> : null}
      <span>{compact ? `${ownerName.replace(/(第一周体验|入门教学|计划|商单)$/g, '')}·${eventTitle}` : `${ownerName} · ${eventTitle}`}</span>
      {targetAttached ? <Flag className="schedule-attached-target" size={compact ? 9 : 10} aria-label="目标日" /> : null}
    </button>
    {resizableEnd ? <ResizeHandle item={item} edge="end" onPointerResize={onPointerResize} onKeyboardResize={onKeyboardResize} /> : null}
  </div>
}

function RangeEventBar({ segment, project, selected, resizing, inspect, openColorMenu, onPointerResize, onKeyboardResize }: { segment: ScheduleRangeSegment; project?: ProjectSummary; selected: boolean; resizing: boolean; inspect: (item: ScheduleItem, anchor: HTMLElement) => void; openColorMenu: (item: ScheduleItem, anchor: HTMLElement, point?: MenuPoint) => void; onPointerResize: ResizePointerHandler; onKeyboardResize: ResizeKeyboardHandler }): React.JSX.Element {
  const { item } = segment
  const ownerName = item.trip ? travelLabel(item) : scheduleDisplayName(project)
  const accessibleName = `${ownerName}·${item.title}·跨天排期${item.state === 'done' ? '·已完成' : ''}`
  return <div
    className={`schedule-range-shell${segment.startsRange ? ' range-start' : ' range-continues-left'}${segment.endsRange ? ' range-end' : ' range-continues-right'}${resizing ? ' resizing' : ''}`}
    data-schedule-range-id={item.id}
    data-range-start={segment.startsRange ? 'true' : 'false'}
    data-range-end={segment.endsRange ? 'true' : 'false'}
    style={{ ...projectScheduleStyle(item, project), gridColumn: `${segment.startColumn + 1} / span ${segment.span}`, gridRow: segment.lane + 1 }}
  >
    <button
      data-schedule-focus-id={item.id}
      className={schedulePillClasses(item, selected, ' schedule-range-pill')}
      aria-label={accessibleName}
      aria-pressed={selected}
      title={accessibleName}
      draggable
      onDragStart={(event) => beginScheduleDrag(event, item)}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openColorMenu(item, event.currentTarget, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined) }}
      onClick={(event) => inspect(item, event.currentTarget)}
      onDoubleClick={() => openScheduleTarget(item)}
    >
      {item.state === 'done' ? <span className="schedule-done-mark" aria-hidden="true"><Check size={8} /></span> : null}
      <span>{item.trip?.cancelled ? '已取消·' : item.trip?.endedEarly ? '已结束·' : ''}{ownerName} · {item.title}</span>
    </button>
    {segment.startsRange ? <ResizeHandle item={item} edge="start" onPointerResize={onPointerResize} onKeyboardResize={onKeyboardResize} /> : null}
    {segment.endsRange ? <ResizeHandle item={item} edge="end" onPointerResize={onPointerResize} onKeyboardResize={onKeyboardResize} /> : null}
  </div>
}

function ScheduleDetail({ item, project, onDelete, onEditTime, onOpenProject, onToggleDone, onEditProperty }: { onEditProperty(field: ScheduleProperty, anchor: HTMLElement): void; item: ScheduleDisplayItem; project: ProjectSummary | undefined; onDelete(): void; onEditTime(anchor: HTMLElement): void; onOpenProject(): void; onToggleDone(): void }): React.JSX.Element {
  const colorToken = item.trip ? `travel-${item.trip.kind ?? 'business'}` : scheduleColorToken(item, project)
  return <>
    <header><span className="schedule-detail-project"><i aria-hidden="true" style={{ background: `var(--${colorToken})` }} />{scheduleDisplayName(project)}</span><h3><button className="schedule-detail-title-edit" onClick={(event) => onEditProperty(item.actionType === 'overview' && item.scheduleKind === 'hard_deadline' ? 'projectTitle' : 'title', event.currentTarget)}>{item.title}</button></h3></header>
    <dl>
      <div><dt>时间</dt><dd>{item.trip ? <span>{fullTimeLabel(item)}</span> : <button className="schedule-time-link" aria-label={`修改${item.title}的时间`} onClick={(event) => onEditTime(event.currentTarget)}>{fullTimeLabel(item)}</button>}</dd></div>
      {project && !item.trip && !(item.actionType === 'overview' && item.scheduleKind === 'hard_deadline') ? <div><dt>阶段</dt><dd><button className="schedule-time-link" onClick={(event) => onEditProperty('stage', event.currentTarget)}>{item.members ? item.members.map(member => projectModuleLabels[projectModule(member)]).join('／') : item.actionType === 'overview' ? '不关联阶段' : projectModuleLabels[projectModule(item)]}</button></dd></div> : null}
      <div><dt>类型</dt><dd>{kindLabel(item)}</dd></div>
      <div><dt>状态</dt><dd>{stateLabel(item)}</dd></div>
      {project ? <div className="schedule-detail-color"><dt>项目色</dt><dd><ProjectColorPicker projectId={project.id} value={project.colorToken} label="更改排期项目色" /></dd></div> : null}
    </dl>
    <div className="inspector-actions">
      {item.trip ? <BusinessTripButton item={item} day={tripDate(item.startAt)!} /> : null}<button onClick={onToggleDone}><Check size={14} />{item.state === 'done' ? '恢复进行中' : '标记已完成'}</button>
      {project ? <button onClick={onOpenProject}>打开项目</button> : null}
      <button className="danger" aria-label="删除排期，快捷键Backspace" onClick={onDelete}><Trash2 size={14} /><span>删除排期</span><kbd>⌫</kbd></button>
    </div>
  </>
}

function ScheduleTimeEditor({ anchor, item, today, onChange, onClose }: {
  anchor: HTMLElement | null
  item: ScheduleItem
  today: string
  onChange(localDateValue: string | null, segment?: ScheduleSegment): Promise<void>
  onClose(): void
}): React.JSX.Element | null {
  const currentDate = item.startAt ? new Date(item.startAt) : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (localDateValue: string | null, segment?: ScheduleSegment): Promise<void> => {
    setBusy(true); setError('')
    try { await onChange(localDateValue, segment) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '排期时间修改失败') }
    finally { setBusy(false) }
  }
  if (!anchor) return null
  return <AnchoredPopover anchor={anchor} ariaLabel={`修改${item.title}的时间`} className="schedule-time-editor" onDismiss={onClose}>
    <header><div><span>排期时间</span><b>{fullTimeLabel(item)}</b></div><button aria-label="关闭时间选择" onClick={onClose}><X size={13} /></button></header>
    <CalendarDatePicker label="排期日期" today={today} value={currentDate ? isoDate(currentDate) : null} onChange={(value) => void run(value, currentDate ? scheduleSegment(currentDate) : 'afternoon')} />
    <div className="schedule-time-segments" role="group" aria-label="排期时段">{(['morning', 'afternoon', 'evening'] as const).map((segment) => <button className={currentDate && scheduleSegment(currentDate) === segment ? 'selected' : ''} disabled={busy || !currentDate} key={segment} onClick={() => currentDate && void run(isoDate(currentDate), segment)}>{scheduleSegmentLabels[segment]}</button>)}</div>
    {item.startAt ? <button className="schedule-time-clear" disabled={busy} onClick={() => void run(null)}>移到未排期</button> : null}
    {busy ? <p role="status">正在同步…</p> : error ? <p role="alert">{error}</p> : null}
  </AnchoredPopover>
}

function CreateSchedulePopover({
  date,
  endDate,
  projects,
  initialProjectId,
  focusStage,
  returnFocus,
  onClose
}: {
  date: Date | null
  endDate?: Date
  projects: ProjectSummary[]
  initialProjectId?: string
  focusStage?: boolean
  returnFocus: HTMLElement | null
  onClose(): void
}): React.JSX.Element {
  const schedules = useWorkspaceStore((state) => state.snapshot.schedules)
  const initialProject = projects.find((project) => project.id === initialProjectId)
  const [projectId, setProjectId] = useState(initialProject?.id ?? '')
  const [selectedStageKeys, setSelectedStageKeys] = useState<ScheduleStageSelection[]>(['overview'])
  const [colorToken, setColorToken] = useState<ProjectColorToken>('project-4')
  const [note, setNote] = useState('')
  const [startDay, setStartDay] = useState(date ? isoDate(date) : '')
  const [endDay, setEndDay] = useState(endDate ? isoDate(endDate) : date ? isoDate(date) : '')
  const [kind, setKind] = useState<ScheduleItem['scheduleKind']>('plan')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const projectSelectRef = useRef<HTMLSelectElement>(null)
  const noteRef = useRef<HTMLInputElement>(null)
  const selectedStageRef = useRef<HTMLButtonElement>(null)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const selectedProject = projects.find((project) => project.id === projectId)
  const stageKeys = (selectedProject?.enabledModuleKeys ?? []).filter((key) => !['business', 'feedback'].includes(key))
  const existingStageKeys = new Set(schedules.filter((item) => item.projectId === projectId && !item.startAt && item.state !== 'done').map((item) => item.actionType))
  const availableStageKeys = date ? stageKeys : stageKeys.filter((key) => !existingStageKeys.has(key))
  const validSelectedStageKeys = selectedStageKeys.filter((key) => key === 'overview' || availableStageKeys.includes(key))
  const selectedStageKey = validSelectedStageKeys[0]
  const stageLabel = (key: ScheduleStageSelection): string => key === 'overview' ? '不关联阶段' : projectModuleLabels[key]

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (endDate) noteRef.current?.focus()
      else if (focusStage && availableStageKeys.length > 0 && selectedStageRef.current) selectedStageRef.current.focus()
      else projectSelectRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [availableStageKeys.length, focusStage, endDate])

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      const first = controls[0]; const last = controls.at(-1)
      if (!first || !last) return
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKeys)
    return () => { window.removeEventListener('keydown', handleKeys); returnFocus?.focus() }
  }, [onClose, returnFocus])
  const submit = async (): Promise<void> => {
    if (submittingRef.current) return
    const chosenStageKeys = !projectId ? ['overview'] as const : validSelectedStageKeys
    if (!window.creatorOS || chosenStageKeys.length === 0) { setError('请选择排期类型'); return }
    if (!projectId && !note.trim()) { setError('请填写排期内容'); return }
    if (date && (!startDay || !endDay || startDay > endDay)) { setError('结束日期不能早于开始日期'); return }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const start = date ? new Date(`${startDay}T09:00:00`) : null
      const inputs = chosenStageKeys.map((key) => ({
        projectId: projectId || null,
        colorToken: projectId ? null : colorToken,
        title: note.trim() ? chosenStageKeys.length > 1 ? `${note.trim()}·${stageLabel(key)}` : note.trim() : key === 'overview' ? selectedProject!.title : stageLabel(key),
        actionType: key,
        startAt: start?.toISOString() ?? null,
        endAt: date && endDay !== startDay ? new Date(`${endDay}T18:00:00`).toISOString() : null,
        scheduleKind: date && projectId ? kind : 'plan',
        waitingFor: null
      }))
      if (date && inputs.length === 1) await window.creatorOS.createSchedule(inputs[0]!)
      else await window.creatorOS.createScheduleBatch(inputs, crypto.randomUUID())
      await refresh(); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '新建排期失败') }
    finally { submittingRef.current = false; setSubmitting(false) }
  }
  return <div className="confirm-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className="schedule-create-dialog" role="dialog" aria-modal="true" aria-labelledby="new-schedule-title">
    <header><div><span>{date ? startDay === endDay ? startDay : `${startDay}—${endDay}` : '收件箱·未排期'}</span><h2 id="new-schedule-title">{date ? '新建排期' : '添加未排期行动'}</h2></div><button aria-label="关闭" onClick={onClose}><X size={17} /></button></header>
    {date ? <div className="schedule-create-range-dates"><label>开始日期<input aria-label="开始日期" type="date" value={startDay} onChange={(event) => setStartDay(event.target.value)} /></label><label>结束日期<input aria-label="结束日期" type="date" min={startDay} value={endDay} onChange={(event) => setEndDay(event.target.value)} /></label></div> : null}
    <label>关联项目（可选）<AppSelect ref={projectSelectRef} value={projectId} onChange={(event) => {
      const nextProjectId = event.target.value
      setProjectId(nextProjectId)
      setSelectedStageKeys(['overview'])
    }}><option value="">不关联项目（默认）</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect></label>
    {selectedProject ? <section className="schedule-stage-field" aria-labelledby="schedule-stage-label">
      <span id="schedule-stage-label">项目阶段</span>
      <div className="schedule-stage-options" role="group" aria-label="项目阶段">
        <button
          ref={selectedStageKey === 'overview' ? selectedStageRef : undefined}
          type="button"
          aria-pressed={validSelectedStageKeys.includes('overview')}
          className={(validSelectedStageKeys.includes('overview')) ? 'selected' : ''}
          onClick={() => setSelectedStageKeys(['overview'])}
        >不关联阶段</button>
        {stageKeys.map((key) => {
          const alreadyAdded = !date && existingStageKeys.has(key)
          const selected = validSelectedStageKeys.includes(key)
          return <button ref={key === selectedStageKey ? selectedStageRef : undefined} type="button" key={key} aria-pressed={selected} className={selected ? 'selected' : ''} disabled={alreadyAdded} title={alreadyAdded ? '已在未排期看板中' : undefined} onClick={() => setSelectedStageKeys((current) => {
            const next = current.filter((item) => item !== 'overview' && item !== key && availableStageKeys.includes(item))
            if (!current.includes(key)) next.push(key)
            return next.length ? next : ['overview']
          })}>{projectModuleLabels[key]}{alreadyAdded ? <small>已添加</small> : null}</button>
        })}
      </div>
      {!stageKeys.length ? <small>当前项目没有启用阶段，仍可选择“不关联阶段”。</small> : null}
    </section> : <section className="schedule-general-color-field" aria-labelledby="schedule-general-color-label">
      <span id="schedule-general-color-label">安排颜色</span>
      <div className="schedule-general-color-options" role="group" aria-label="选择安排颜色">
        {PROJECT_COLOR_TOKENS.slice(0, 10).map((token) => <button
          key={token}
          type="button"
          className={colorToken === token ? 'selected' : ''}
          aria-label={`选择颜色${token.replace('project-', '')}`}
          aria-pressed={colorToken === token}
          style={{ '--swatch-color': `var(--${token})` } as React.CSSProperties}
          onClick={() => setColorToken(token)}
        />)}
      </div>
    </section>}
    {date && selectedProject ? <fieldset><legend>日期类型</legend>{([['plan', '普通计划'], ['hard_deadline', '目标日'], ['publish_date', '发布日期']] as const).map(([value, label]) => <label key={value}><input type="radio" name="schedule-kind" checked={kind === value} onChange={() => setKind(value)} />{label}</label>)}</fieldset> : null}
    <label>{!projectId ? '排期内容' : '备注（可选）'}<input ref={noteRef} type="text" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder={!projectId ? '例如：取快递、整理账单' : '补充具体安排'} /></label>
    {error ? <p className="form-error">{error}</p> : null}
    <footer><button disabled={submitting} onClick={onClose}>取消</button><button className="primary-action" disabled={submitting || (projectId && validSelectedStageKeys.length === 0) || (!projectId && !note.trim())} onClick={() => void submit()}>{submitting ? '正在添加…' : `${date ? '新建排期' : '加入收件箱'}${projectId && validSelectedStageKeys.length > 1 ? `·${validSelectedStageKeys.length}项` : ''}`}</button></footer>
  </section></div>
}

export function ScheduleCard({ full = false, initialProjectFilter, initialDate }: { full?: boolean; initialProjectFilter?: string; initialDate?: string }): React.JSX.Element {
  const { today: todayKey, schedules, projects: allProjects, preferences, topics, topicStages } = useWorkspaceStore((state) => state.snapshot)
  const today = useMemo(() => localDate(todayKey), [todayKey])
  const refresh = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const projects = useMemo(() => allProjects.filter((project) => project.topicStageRole === 'project_created' && !project.trashedAt), [allProjects])
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const [mode, setMode] = useState<ViewMode>(full ? 'month' : 'week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [dayOffset, setDayOffset] = useState(0)
  const [projectFilter, setProjectFilter] = useState<string | undefined>(initialProjectFilter)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { drawerOpen: detailDrawerOpen, closeButtonRef, openDrawer, closeDrawer } = useInspectorDrawer()
  const [detailAnchor, setDetailAnchor] = useState<HTMLElement | null>(null)
  const [tripEditor, setTripEditor] = useState<{ anchor: HTMLElement; item: ScheduleItem } | null>(null)
  const [createTarget, setCreateTarget] = useState<{ date: Date | null; endDate?: Date; initialProjectId?: string; focusStage?: boolean } | null>(null)
  const [createReturnFocus, setCreateReturnFocus] = useState<HTMLElement | null>(null)
  const [lastMove, setLastMove] = useState<{ id: string; startAt: string | null; endAt: string | null; message: string } | null>(null)
  const [lastTopicMove, setLastTopicMove] = useState<{ id: string; date: string; title: string } | null>(null)
  const [resizePreview, setResizePreview] = useState<{ id: string; edge: ScheduleRangeEdge; deltaDays: number } | null>(null)
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null)
  const [unscheduledDropActive, setUnscheduledDropActive] = useState(false)
  const [colorMenu, setColorMenu] = useState<{ anchor: HTMLElement; scheduleId: string; point?: MenuPoint; mode: 'menu' | 'picker' } | null>(null)
  const [propertyEditor, setPropertyEditor] = useState<{ anchor: HTMLElement; id: string; field: ScheduleProperty; point?: MenuPoint } | null>(null)
  const [dropDate, setDropDate] = useState<string | null>(null)
  const [timeEditorAnchor, setTimeEditorAnchor] = useState<HTMLElement | null>(null)
  const colorMenuReturnFocusRef = useRef<HTMLElement | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const resizeQueueRef = useRef<Map<string, Promise<void>>>(new Map())
  const resizeProjectedRef = useRef<Map<string, ScheduleItem>>(new Map())
  const deletingIdRef = useRef<string | null>(null)
  const displayItems = groupScheduleItems(schedules, projectModuleLabels)
  const visibleItems = displayItems.filter((item) => !projectFilter || (projectFilter === UNBOUND_SCHEDULE_FILTER ? item.projectId === null : item.projectId === projectFilter))
  const previewItems = resizePreview
    ? visibleItems.map((item) => {
      if (item.id !== resizePreview.id) return item
      const preview = resizeScheduleRange(item, resizePreview.edge, resizePreview.deltaDays)
      return { ...item, ...preview }
    })
    : visibleItems
  const visibleCalendarItems = previewItems.filter((item) => !(item.actionType === 'overview' && item.scheduleKind === 'hard_deadline'))
  const projectTargetItems = previewItems.filter((item) => item.projectId && item.actionType === 'overview' && item.scheduleKind === 'hard_deadline' && item.startAt)
  const topicDeadlineMarkers = useMemo(() => deriveTopicDeadlineMarkers(topics, topicStages, todayKey), [todayKey, topicStages, topics])
  const visibleTopicDeadlineMarkers = projectFilter ? [] : topicDeadlineMarkers
  const unscheduledItems = visibleItems.filter((item) => !item.startAt)
  const unscheduledGroups: Array<{ key: string; project?: ProjectSummary; items: ScheduleItem[] }> = [
    { key: 'unbound', items: unscheduledItems.filter((item) => item.projectId === null) },
    ...projects.map((project) => ({
      key: project.id,
      project,
      items: unscheduledItems.filter((item) => item.projectId === project.id)
    }))
  ].filter((group) => group.items.length > 0)
  const selectedItem = displayItems.find((item) => item.id === selectedId) ?? null
  const selectedProject = selectedItem?.projectId ? projectById.get(selectedItem.projectId) : undefined
  const colorMenuItem = colorMenu ? displayItems.find((item) => item.id === colorMenu.scheduleId) : undefined
  const colorMenuProject = colorMenuItem?.projectId ? projectById.get(colorMenuItem.projectId) : undefined
  const visibleMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1, 12), [monthOffset, today])
  const weekStart = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset])
  const visibleDay = useMemo(() => addDays(today, dayOffset), [dayOffset, today])
  const openDay = (date: Date): void => {
    if (!full) { navigate({ page: 'schedule', anchorDate: isoDate(date), projectId: projectFilter === UNBOUND_SCHEDULE_FILTER ? undefined : projectFilter }); return }
    setDayOffset(calendarDayDelta(date, today)); setMode('day')
  }
  useEffect(() => {
    if (!initialDate) return
    const date = localDate(initialDate)
    if (isoDate(date) !== initialDate) return
    setDayOffset(calendarDayDelta(date, today)); setMode('day')
    setMonthOffset((date.getFullYear() - today.getFullYear()) * 12 + date.getMonth() - today.getMonth())
    setWeekOffset(calendarDayDelta(startOfWeek(date), startOfWeek(today)) / 7)
  }, [initialDate, today])
  const inspectorCollapsed = preferences.scheduleInspectorCollapsed && !detailDrawerOpen

  useEffect(() => { setProjectFilter(initialProjectFilter) }, [initialProjectFilter])

  useEffect(() => {
    if (!lastMove) return
    const timer = window.setTimeout(() => setLastMove(null), 6_000)
    return () => window.clearTimeout(timer)
  }, [lastMove])

  useEffect(() => {
    if (!lastTopicMove) return
    const timer = window.setTimeout(() => setLastTopicMove(null), 6_000)
    return () => window.clearTimeout(timer)
  }, [lastTopicMove])

  useEffect(() => {
    if (!deleteNotice) return
    const timer = window.setTimeout(() => setDeleteNotice(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [deleteNotice])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  useEffect(() => {
    if (!colorMenu) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.schedule-color-menu, .project-color-picker-wrap, .schedule-pill')) return
      setColorMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      const anchor = colorMenu.anchor
      setColorMenu(null)
      anchor.focus()
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [colorMenu])

  useEffect(() => {
    if (colorMenu || !colorMenuReturnFocusRef.current) return
    const anchor = colorMenuReturnFocusRef.current
    colorMenuReturnFocusRef.current = null
    const frame = window.requestAnimationFrame(() => {
      if (document.contains(anchor)) anchor.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [colorMenu])

  const closeDetail = useCallback((): void => { setDetailAnchor(null); setSelectedId(null); setTimeEditorAnchor(null); closeDrawer() }, [closeDrawer])
  const performMove = async (item: ScheduleItem, startAt: string | null, endAt: string | null, message?: string): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.moveSchedule(item.id, startAt, endAt)
    closeDetail()
    setDeleteNotice(null)
    setLastTopicMove(null)
    setLastMove({ id: item.id, startAt: item.startAt, endAt: item.endAt, message: message ?? (startAt ? '已移动排期' : '已移至未排期') })
    await refresh()
  }
  const pointerDrag = useSchedulePointerDrag({
    contextKey: `${mode}:${dayOffset}:${monthOffset}:${weekOffset}:${projectFilter ?? ''}`,
    getItem: (id) => displayItems.find((item) => item.id === id),
    getLabel: (item) => `${scheduleDisplayName(projectById.get(item.projectId ?? ''))} · ${item.title}`,
    onStart: () => { setColorMenu(null); setPropertyEditor(null); setTimeEditorAnchor(null) },
    onMove: performMove,
    onError: (cause) => setDeleteNotice(cause instanceof Error ? cause.message : '移动排期失败')
  })
  const editScheduleTime = async (localDateValue: string | null, segment: ScheduleSegment = 'afternoon'): Promise<void> => {
    if (!window.creatorOS || !selectedItem) return
    if (!localDateValue) {
      await window.creatorOS.moveSchedule(selectedItem.id, null, null)
    } else {
      const [year = 1970, month = 1, day = 1] = localDateValue.split('-').map(Number)
      const hour = segment === 'morning' ? 9 : segment === 'afternoon' ? 14 : 19
      const nextStart = new Date(year, month - 1, day, hour, 0)
      const duration = selectedItem.startAt && selectedItem.endAt ? Date.parse(selectedItem.endAt) - Date.parse(selectedItem.startAt) : null
      await window.creatorOS.moveSchedule(selectedItem.id, nextStart.toISOString(), duration === null ? null : new Date(nextStart.getTime() + duration).toISOString())
    }
    await refresh()
  }
  const undoMove = async (): Promise<void> => {
    if (!window.creatorOS || !lastMove) return
    await window.creatorOS.moveSchedule(lastMove.id, lastMove.startAt, lastMove.endAt)
    setLastMove(null); await refresh()
  }
  const moveTopicDeadline = async (marker: TopicDeadlineMarker, date: Date): Promise<void> => {
    const nextDate = isoDate(date)
    if (!window.creatorOS || marker.date === nextDate) return
    try {
      await window.creatorOS.updateTopic(marker.topicId, { expectedCompletionAt: nextDate })
      setDeleteNotice(null)
      setLastMove(null)
      setLastTopicMove({ id: marker.topicId, date: marker.date, title: marker.title })
      await refresh()
    } catch (cause) {
      setDeleteNotice(cause instanceof Error ? `移动选题日期失败：${cause.message}` : '移动选题日期失败')
    }
  }
  const undoTopicDeadlineMove = async (): Promise<void> => {
    if (!window.creatorOS || !lastTopicMove) return
    try {
      await window.creatorOS.updateTopic(lastTopicMove.id, { expectedCompletionAt: lastTopicMove.date })
      setLastTopicMove(null)
      await refresh()
    } catch (cause) {
      setDeleteNotice(cause instanceof Error ? `撤销选题日期失败：${cause.message}` : '撤销选题日期失败')
    }
  }
  const deleteSelectedItem = useCallback(async (): Promise<void> => {
    if (!window.creatorOS || !selectedItem || deletingIdRef.current) return
    deletingIdRef.current = selectedItem.id
    try {
      await window.creatorOS.deleteSchedule(selectedItem.id)
      setSelectedId(null)
      closeDrawer()
      setDetailAnchor(null)
      setLastMove(null)
      setDeleteNotice(`已删除「${selectedItem.title}」`)
      await refresh()
    } catch (cause) {
      setDeleteNotice(cause instanceof Error ? `删除失败：${cause.message}` : '删除排期失败')
    } finally {
      deletingIdRef.current = null
    }
  }, [closeDrawer, refresh, selectedItem])
  const deleteUnscheduledItem = useCallback(async (item: ScheduleItem): Promise<void> => {
    if (!window.creatorOS || deletingIdRef.current) return
    deletingIdRef.current = item.id
    try {
      await window.creatorOS.deleteSchedule(item.id)
      if (selectedId === item.id) {
        setSelectedId(null)
        closeDrawer()
      }
      setDeleteNotice(`已删除「${item.title}」`)
      await refresh()
    } catch (cause) {
      setDeleteNotice(cause instanceof Error ? `删除失败：${cause.message}` : '删除排期失败')
    } finally {
      deletingIdRef.current = null
    }
  }, [closeDrawer, refresh, selectedId])
  const toggleDone = useCallback(async (item: ScheduleItem): Promise<void> => {
    await window.creatorOS?.setScheduleState(item.id, item.state === 'done' ? 'normal' : 'done')
    await refresh()
  }, [refresh])
  const inspectItem = useCallback((item: ScheduleItem, anchor: HTMLElement): void => {
    if (full) { setSelectedId(item.id); openDrawer(anchor); return }
    const closing = selectedId === item.id && detailAnchor !== null
    setSelectedId(closing ? null : item.id)
    setDetailAnchor(closing ? null : anchor)
  }, [detailAnchor, full, openDrawer, selectedId])

  useEffect(() => {
    if (!selectedItem || createTarget || (!full && !detailAnchor)) return
    const deleteOnShortcut = (event: KeyboardEvent): void => {
      const isDeleteShortcut = event.key === 'Backspace' || event.key.toLowerCase() === 'x'
      if (!isDeleteShortcut || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.confirm-layer, .anchored-popover-layer:not(.schedule-detail-popover), [role="dialog"]:not(.schedule-detail-popover)')) return
      event.preventDefault()
      void deleteSelectedItem()
    }
    window.addEventListener('keydown', deleteOnShortcut)
    return () => window.removeEventListener('keydown', deleteOnShortcut)
  }, [createTarget, deleteSelectedItem, detailAnchor, full, selectedItem])

  useEffect(() => {
    if (!detailAnchor) return
    const closeOutside = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('.schedule-pill, .topic-deadline-marker, .schedule-detail-popover, .schedule-time-editor, .schedule-property-editor')) return
      closeDetail()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || timeEditorAnchor) return
      event.preventDefault()
      closeDetail()
      detailAnchor.focus()
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', closeOnEscape) }
  }, [closeDetail, detailAnchor, timeEditorAnchor])

  useEffect(() => { resizeCleanupRef.current?.(); closeDetail(); setColorMenu(null); setPropertyEditor(null) }, [closeDetail, dayOffset, mode, monthOffset, projectFilter, weekOffset])
  const openCreateDate = (date: Date, initialProjectId?: string, focusStage = false): void => {
    setCreateReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setCreateTarget({ date, initialProjectId, focusStage })
  }
  const rangeCreate = useScheduleRangeCreate(`${mode}:${visibleMonth.toISOString()}:${Boolean(createTarget)}`, (start, end) => {
    setCreateReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setCreateTarget({ date: new Date(`${start}T12:00:00`), endDate: new Date(`${end}T12:00:00`) })
  })
  const openCreateInbox = (): void => {
    setCreateReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setCreateTarget({ date: null })
  }
  const closeCreateDate = useCallback((): void => { setCreateTarget(null); setCreateReturnFocus(null) }, [])
  const dropOnDate = (event: React.DragEvent, date: Date): void => {
    event.preventDefault()
    event.stopPropagation()
    setDropDate(null)
    const draggedTopicId = event.dataTransfer.getData(TOPIC_DEADLINE_DRAG_MIME)
    const topicMarker = topicDeadlineMarkers.find((marker) => marker.topicId === draggedTopicId)
    if (topicMarker) {
      void moveTopicDeadline(topicMarker, date)
      return
    }
    const plainDragValue = event.dataTransfer.getData('text/plain')
    const overviewProjectId = event.dataTransfer.getData(PROJECT_OVERVIEW_DRAG_MIME)
      || (plainDragValue.startsWith('project-overview:') ? plainDragValue.slice('project-overview:'.length) : '')
    const overviewProject = projectById.get(overviewProjectId)
    if (overviewProject && window.creatorOS) {
      const startAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 0).toISOString()
      void window.creatorOS.createSchedule({
        projectId: overviewProject.id,
        title: '项目推进',
        actionType: 'overview',
        startAt,
        endAt: null,
        scheduleKind: 'plan',
        waitingFor: null
      }).then(() => refresh()).catch((cause: unknown) => {
        setDeleteNotice(cause instanceof Error ? `创建项目排期失败：${cause.message}` : '创建项目排期失败')
      })
      return
    }
    const draggedProjectId = event.dataTransfer.getData(PROJECT_DRAG_MIME)
    if (draggedProjectId && projectById.has(draggedProjectId)) {
      openCreateDate(date, draggedProjectId, true)
      return
    }
    const id = event.dataTransfer.getData('text/schedule-id'); const item = displayItems.find((entry) => entry.id === id)
    if (!item) return
    const moved = moveScheduleToDate(item, date, event.dataTransfer.getData('text/schedule-grab-date'))
    if (moved.startAt === item.startAt && moved.endAt === item.endAt) return
    void performMove(item, moved.startAt, moved.endAt).catch((cause: unknown) => setDeleteNotice(cause instanceof Error ? cause.message : '移动排期失败'))
  }
  const dropInUnscheduled = (event: React.DragEvent): void => {
    event.preventDefault()
    setUnscheduledDropActive(false)
    const id = event.dataTransfer.getData('text/schedule-id'); const item = displayItems.find((entry) => entry.id === id)
    if (!item?.startAt) return
    void performMove(item, null, null).catch((cause: unknown) => setDeleteNotice(cause instanceof Error ? cause.message : '移动排期失败'))
  }
  const resizeByDays = (item: ScheduleItem, edge: ScheduleRangeEdge, deltaDays: number, restoreFocus = false): void => {
    const baseItem = resizeProjectedRef.current.get(item.id) ?? item
    const next = resizeScheduleRange(baseItem, edge, deltaDays)
    if (next.startAt === baseItem.startAt && next.endAt === baseItem.endAt) return
    resizeProjectedRef.current.set(item.id, { ...baseItem, startAt: next.startAt, endAt: next.endAt })
    const previous = resizeQueueRef.current.get(item.id) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        await performMove(baseItem, next.startAt, next.endAt, '已调整排期日期')
        if (!restoreFocus) return
        window.requestAnimationFrame(() => {
          const handle = [...document.querySelectorAll<HTMLElement>('[data-schedule-resize-id][data-resize-edge]')]
            .find((candidate) => candidate.dataset.scheduleResizeId === item.id && candidate.dataset.resizeEdge === edge)
          const fallback = [...document.querySelectorAll<HTMLElement>('[data-schedule-focus-id]')]
            .find((candidate) => candidate.dataset.scheduleFocusId === item.id)
          ;(handle ?? fallback)?.focus()
        })
      })
      .catch((cause: unknown) => {
        setDeleteNotice(cause instanceof Error ? `调整排期失败：${cause.message}` : '调整排期失败')
      })
      .finally(() => {
        if (resizeQueueRef.current.get(item.id) !== operation) return
        resizeQueueRef.current.delete(item.id)
        resizeProjectedRef.current.delete(item.id)
      })
    resizeQueueRef.current.set(item.id, operation)
  }
  const startResize = (event: React.PointerEvent<HTMLElement>, item: ScheduleItem, edge: ScheduleRangeEdge): void => {
    if (!item.isMovable || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const calendarWeek = event.currentTarget.closest<HTMLElement>('[data-calendar-week]')
    if (!calendarWeek) return
    const dayWidth = calendarWeek.getBoundingClientRect().width / 7
    if (!Number.isFinite(dayWidth) || dayWidth <= 0) return
    const originX = event.clientX
    const originWeek = calendarWeek
    let latestDelta = 0
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('blur', onCancel)
      document.body.classList.remove('schedule-resizing')
      resizeCleanupRef.current = null
      setResizePreview(null)
    }
    const onMove = (moveEvent: PointerEvent): void => {
      const directCell = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
        .map((element) => element.closest<HTMLElement>('[data-calendar-date]'))
        .find((element): element is HTMLElement => Boolean(element?.dataset.calendarDate))
      let targetDate = directCell?.dataset.calendarDate
      if (!targetDate) {
        const weeks = [...document.querySelectorAll<HTMLElement>('[data-calendar-week]')]
        const nearestWeek = weeks.reduce<HTMLElement | null>((nearest, week) => {
          const bounds = week.getBoundingClientRect()
          const distance = moveEvent.clientY < bounds.top ? bounds.top - moveEvent.clientY : moveEvent.clientY > bounds.bottom ? moveEvent.clientY - bounds.bottom : 0
          if (!nearest) return week
          const nearestBounds = nearest.getBoundingClientRect()
          const nearestDistance = moveEvent.clientY < nearestBounds.top ? nearestBounds.top - moveEvent.clientY : moveEvent.clientY > nearestBounds.bottom ? moveEvent.clientY - nearestBounds.bottom : 0
          return distance < nearestDistance ? week : nearest
        }, null)
        const weekStartDate = nearestWeek?.dataset.calendarWeekStart
        if (nearestWeek && weekStartDate) {
          const bounds = nearestWeek.getBoundingClientRect()
          const column = Math.min(6, Math.max(0, Math.floor((moveEvent.clientX - bounds.left) / (bounds.width / 7))))
          targetDate = isoDate(addDays(localDate(weekStartDate), column))
        }
      }
      latestDelta = targetDate
        ? scheduleResizeDeltaForDate(item, edge, targetDate)
        : Math.round((moveEvent.clientX - originX) / dayWidth)
      if (!targetDate && originWeek.dataset.calendarWeekStart) {
        const verticalRows = Math.round((moveEvent.clientY - originWeek.getBoundingClientRect().top) / Math.max(1, originWeek.getBoundingClientRect().height))
        latestDelta += verticalRows * 7
      }
      setResizePreview({ id: item.id, edge, deltaDays: latestDelta })
    }
    const onUp = (): void => {
      const deltaDays = latestDelta
      cleanup()
      if (deltaDays !== 0) resizeByDays(item, edge, deltaDays)
    }
    const onCancel = (): void => cleanup()
    const onEscape = (keyEvent: KeyboardEvent): void => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); onCancel() } }
    resizeCleanupRef.current = cleanup
    document.body.classList.add('schedule-resizing')
    setResizePreview({ id: item.id, edge, deltaDays: 0 })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('blur', onCancel)
  }
  useEffect(() => {
    const clear = (): void => setDropDate(null)
    window.addEventListener('dragend', clear); window.addEventListener('drop', clear)
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear) }
  }, [])
  const targetsForDate = (date: Date): ScheduleItem[] => projectTargetItems.filter((item) => scheduleOccursOnDate(item, date))
  const publishingHasTarget = (item: ScheduleItem, date: Date): boolean => item.actionType === 'publishing'
    && targetsForDate(date).some((target) => target.projectId === item.projectId)
  const unattachedTargetsForDate = (date: Date, dayEvents: ScheduleItem[]): ScheduleItem[] => targetsForDate(date)
    .filter((target) => !dayEvents.some((item) => item.projectId === target.projectId && item.actionType === 'publishing'))
  const renderProjectTarget = (item: ScheduleItem, compact = false): React.JSX.Element | null => {
    const project = item.projectId ? projectById.get(item.projectId) : undefined
    return project ? <ProjectTargetFlag key={item.id} item={item} project={project} compact={compact} selected={selectedId === item.id} expanded={full ? undefined : selectedId === item.id && detailAnchor !== null} inspect={inspectItem} openColorMenu={(item, anchor, point) => setColorMenu({ anchor, point, scheduleId: item.id, mode: 'menu' })} /> : null
  }
  const renderEvent = (item: ScheduleItem, compact = false, resizableEnd = false, date?: Date): React.JSX.Element | null => {
    const project = item.projectId ? projectById.get(item.projectId) : undefined
    if (item.projectId && !project) return null
    return <EventPill key={item.id} item={item} project={project} compact={compact} expanded={full ? undefined : selectedId === item.id && detailAnchor !== null} selected={selectedId === item.id} resizableEnd={resizableEnd} resizing={resizePreview?.id === item.id} targetAttached={Boolean(date && publishingHasTarget(item, date))} inspect={inspectItem} openColorMenu={(targetItem, anchor, point) => setColorMenu({ anchor, point, scheduleId: targetItem.id, mode: 'menu' })} onPointerResize={startResize} onKeyboardResize={resizeByDays} />
  }
  const renderRangeEvent = (segment: ScheduleRangeSegment): React.JSX.Element | null => {
    const project = segment.item.projectId ? projectById.get(segment.item.projectId) : undefined
    if (segment.item.projectId && !project) return null
    return <RangeEventBar key={`${segment.item.id}-${segment.startColumn}`} segment={segment} project={project} selected={selectedId === segment.item.id} resizing={resizePreview?.id === segment.item.id} inspect={inspectItem} openColorMenu={(targetItem, anchor, point) => setColorMenu({ anchor, point, scheduleId: targetItem.id, mode: 'menu' })} onPointerResize={startResize} onKeyboardResize={resizeByDays} />
  }

  const monthFirst = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1, 12)
  const monthGridStart = addDays(monthFirst, -((monthFirst.getDay() + 6) % 7))
  const monthLast = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0, 12)
  const monthCellCount = Math.ceil((((monthFirst.getDay() + 6) % 7) + monthLast.getDate()) / 7) * 7
  const monthDays = Array.from({ length: monthCellCount }, (_, index) => addDays(monthGridStart, index))
  const monthWeeks = Array.from({ length: monthCellCount / 7 }, (_, index) => monthDays.slice(index * 7, index * 7 + 7))
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const weekRangeSegments = scheduleRangeSegmentsForWeek(visibleCalendarItems, weekStart)
  const monthLabel = `${visibleMonth.getFullYear()}年${visibleMonth.getMonth() + 1}月`
  const activeDate = mode === 'day' ? visibleDay : mode === 'week' ? weekStart : mode === 'month' ? visibleMonth : today
  const fullProjectFilters = <div className="calendar-filterbar"><button className={!projectFilter ? 'active' : ''} aria-pressed={!projectFilter} onClick={() => setProjectFilter(undefined)}>全部排期</button>{schedules.some((item) => item.projectId === null) ? <button
    className={projectFilter === UNBOUND_SCHEDULE_FILTER ? 'active' : ''}
    aria-pressed={projectFilter === UNBOUND_SCHEDULE_FILTER}
    onClick={() => setProjectFilter(projectFilter === UNBOUND_SCHEDULE_FILTER ? undefined : UNBOUND_SCHEDULE_FILTER)}
  ><i style={{ background: 'var(--project-4)' }} />其他安排</button> : null}{projects.map((project) => <button
    key={project.id}
    draggable
    data-project-id={project.id}
    className={projectFilter === project.id ? 'active' : ''}
    aria-pressed={projectFilter === project.id}
    title={`筛选${project.title}；拖入日期新建该项目排期`}
    onDragStart={(event) => {
      event.dataTransfer.setData(PROJECT_DRAG_MIME, project.id)
      event.dataTransfer.effectAllowed = 'copy'
    }}
    onClick={() => setProjectFilter(projectFilter === project.id ? undefined : project.id)}
  ><i style={{ background: `var(--${project.colorToken})` }} />{project.title}</button>)}</div>

  const allowCalendarDrop = (event: React.DragEvent): void => {
    const cell = event.currentTarget as HTMLElement
    if (cell.dataset.calendarDate) setDropDate(cell.dataset.calendarDate)
    event.preventDefault()
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(PROJECT_DRAG_MIME) ? 'copy' : 'move'
  }
  const dropOnRangeLayer = (event: React.DragEvent<HTMLElement>, rangeWeekStart: Date): void => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset = Math.min(Math.max(event.clientX - bounds.left, 0), Math.max(0, bounds.width - 1))
    const dayIndex = Math.min(6, Math.floor(offset / (bounds.width / 7)))
    dropOnDate(event, addDays(rangeWeekStart, dayIndex))
  }

  const calendar = mode === 'week'
    ? <div
      className="week-grid calendar-week-row"
      data-testid="week-grid"
      data-calendar-week
      data-calendar-week-start={isoDate(weekStart)}
      aria-label={`${formatMonthDay(weekStart)}至${formatMonthDay(addDays(weekStart, 6))}排期`}
      style={{ '--range-lanes': Math.max(0, ...weekRangeSegments.map((segment) => segment.lane + 1)) } as React.CSSProperties}
    >
      {weekDays.map((date, dayIndex) => {
        const travel = travelDayHighlight(visibleCalendarItems, isoDate(date))
        const isToday = isoDate(date) === isoDate(today)
        const dayTopicMarkers = topicMarkersFor(visibleTopicDeadlineMarkers, date)
        const dayEvents = eventsFor(visibleCalendarItems, date).filter((item) => !isCrossDaySchedule(item))
        const dayProjectTargets = unattachedTargetsForDate(date, dayEvents)
        const rangeSegmentsForDay = weekRangeSegments.filter((segment) => segment.startColumn <= dayIndex && dayIndex < segment.startColumn + segment.span)
        const rangeLaneCount = Math.max(0, ...rangeSegmentsForDay.map((segment) => segment.lane + 1))
        const hasRangeEvent = rangeSegmentsForDay.length > 0
        return <section key={isoDate(date)} data-calendar-date={isoDate(date)} data-drop-active={dropDate === isoDate(date) || undefined} aria-label={`${isoDate(date)}排期区${isToday ? '，今天' : ''}`} className={`week-day${isToday ? ' is-today' : ''}`} onDragOver={allowCalendarDrop} onDrop={(event) => dropOnDate(event, date)}>
          <div className="week-day-head"><b>{weekdays[date.getDay()]}</b><time data-travel-tone={travel?.tone} title={travel?.label} aria-label={travel ? `${date.getDate()}日，${travel.label}` : undefined} aria-current={isToday ? 'date' : undefined} dateTime={isoDate(date)}>{date.getDate()}日</time></div>
          <div className="week-events" style={{ '--range-lanes-day': rangeLaneCount } as React.CSSProperties}>{dayTopicMarkers.map((marker) => <TopicDeadlineFlag key={marker.topicId} marker={marker} compact />)}{dayProjectTargets.map((item) => renderProjectTarget(item, true))}{dayEvents.map((item) => renderEvent(item, true, true, date))}{dayTopicMarkers.length === 0 && dayProjectTargets.length === 0 && dayEvents.length === 0 && !hasRangeEvent ? <button className="week-empty" onClick={() => openCreateDate(date)}>暂未排期</button> : null}</div>
        </section>
      })}
      {weekRangeSegments.length ? <div className="schedule-range-layer week-range-layer" onDragOver={allowCalendarDrop} onDrop={(event) => dropOnRangeLayer(event, weekStart)}>{weekRangeSegments.map(renderRangeEvent)}</div> : null}
    </div>
    : mode === 'month'
      ? <div className="month-wrap" data-testid="month-grid">
        <div className="month-weekdays">{monthWeekdays.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="month-grid">{monthWeeks.map((days) => {
          const rangeSegments = scheduleRangeSegmentsForWeek(visibleCalendarItems, days[0] ?? monthGridStart)
          const visibleLimit = full ? (monthWeeks.length <= 5 ? 7 : 6) : 3
          const visibleRangeSegments = rangeSegments.filter((segment) => segment.lane < visibleLimit)
          const visibleLaneCount = Math.min(visibleLimit, Math.max(0, ...rangeSegments.map((segment) => segment.lane + 1)))
          return <div className="month-week-row calendar-week-row" data-calendar-week data-calendar-week-start={isoDate(days[0] ?? monthGridStart)} key={isoDate(days[0] ?? monthGridStart)} style={{ '--range-lanes': visibleLaneCount } as React.CSSProperties}>
            {days.map((date, dayIndex) => {
              const inMonth = date.getMonth() === visibleMonth.getMonth()
              const isToday = isoDate(date) === isoDate(today)
              const dayTopicMarkers = topicMarkersFor(visibleTopicDeadlineMarkers, date)
              const dayEvents = eventsFor(visibleCalendarItems, date).filter((item) => !isCrossDaySchedule(item))
              const dayProjectTargets = unattachedTargetsForDate(date, dayEvents)
              const dayRanges = visibleRangeSegments.filter((segment) => segment.startColumn <= dayIndex && dayIndex < segment.startColumn + segment.span)
              const visibleRangeCount = dayRanges.length
              const reservedRows = scheduleOccupiedRows(dayRanges, dayIndex)
              const singleItemLimit = Math.max(0, visibleLimit - visibleRangeCount)
              const visibleTopicMarkerCount = Math.min(dayTopicMarkers.length, singleItemLimit)
              const visibleProjectTargetCount = Math.min(dayProjectTargets.length, Math.max(0, singleItemLimit - visibleTopicMarkerCount))
              const singleEventLimit = Math.max(0, singleItemLimit - visibleTopicMarkerCount - visibleProjectTargetCount)
              const hiddenRangeCount = rangeSegments.filter((segment) => segment.lane >= visibleLimit && segment.startColumn <= dayIndex && dayIndex < segment.startColumn + segment.span).length
              const hiddenTopicMarkerCount = Math.max(0, dayTopicMarkers.length - visibleTopicMarkerCount)
              const hiddenProjectTargetCount = Math.max(0, dayProjectTargets.length - visibleProjectTargetCount)
              const hiddenSingleCount = Math.max(0, dayEvents.length - singleEventLimit)
              const overflowCount = hiddenRangeCount + hiddenTopicMarkerCount + hiddenProjectTargetCount + hiddenSingleCount
              const travel = travelDayHighlight(visibleCalendarItems, isoDate(date))
              return <section key={isoDate(date)} data-calendar-date={isoDate(date)} data-drop-active={dropDate === isoDate(date) || undefined} aria-label={`${isoDate(date)}排期区${isToday ? '，今天' : ''}`} onPointerDown={rangeCreate} className={`month-day${inMonth ? '' : ' muted'}${isToday ? ' is-today' : ''}`} style={{ '--range-lanes-day': reservedRows } as React.CSSProperties} onDragOver={allowCalendarDrop} onDrop={(event) => dropOnDate(event, date)}>
                <time data-travel-tone={travel?.tone} title={travel?.label} aria-label={travel ? `${date.getDate()}日，${travel.label}` : undefined} aria-current={isToday ? 'date' : undefined} dateTime={isoDate(date)}>{date.getDate()}</time>
                <div className="month-day-events">
                  {dayTopicMarkers.slice(0, visibleTopicMarkerCount).map((marker) => <TopicDeadlineFlag key={marker.topicId} marker={marker} compact />)}
                  {dayProjectTargets.slice(0, visibleProjectTargetCount).map((item) => renderProjectTarget(item, true))}
                  {dayEvents.slice(0, singleEventLimit).map((item) => renderEvent(item, true, true, date))}
                  {overflowCount > 0 ? <button className="month-overflow" onClick={() => { openDay(date) }}>还有{overflowCount}项</button> : null}
                </div>
              </section>
            })}
            {visibleRangeSegments.length ? <div className="schedule-range-layer month-range-layer" onDragOver={allowCalendarDrop} onDrop={(event) => dropOnRangeLayer(event, days[0] ?? monthGridStart)}>{visibleRangeSegments.map(renderRangeEvent)}</div> : null}
          </div>
        })}</div>
      </div>
      : mode === 'day'
        ? (() => {
          const dayTopicMarkers = topicMarkersFor(visibleTopicDeadlineMarkers, visibleDay)
          const dayEvents = visibleCalendarItems.filter((item) => scheduleOccursOnDate(item, visibleDay))
          const dayProjectTargets = unattachedTargetsForDate(visibleDay, dayEvents)
          return <div className="day-schedule-view" data-calendar-date={isoDate(visibleDay)} aria-label={`${isoDate(visibleDay)}排期区`} onDragOver={allowCalendarDrop} onDrop={(event) => dropOnDate(event, visibleDay)}><header><b>{isoDate(visibleDay) === isoDate(today) ? '今天' : weekdays[visibleDay.getDay()]}</b><span>{visibleDay.getMonth() + 1}月{visibleDay.getDate()}日</span></header>{dayTopicMarkers.map((marker) => <article key={marker.topicId}><time>目标</time><TopicDeadlineFlag marker={marker} /></article>)}{dayProjectTargets.map((item) => <article key={item.id}><time>目标</time>{renderProjectTarget(item)}</article>)}{dayEvents.length ? dayEvents.map((item) => <article key={item.id}><time>{timeLabel(item)}</time>{renderEvent(item, false, false, visibleDay)}</article>) : dayProjectTargets.length || dayTopicMarkers.length ? null : <button className="empty-day" onClick={() => openCreateDate(visibleDay)}>当天还没有排期，点击新建</button>}</div>
        })()
        : <div className="schedule-list-view">{previewItems.filter((item) => item.startAt).sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? '')).map((item) => <article key={item.id}><time>{item.startAt ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.startAt)) : ''}</time>{item.actionType === 'overview' && item.scheduleKind === 'hard_deadline' ? renderProjectTarget(item) : renderEvent(item)}<span>{kindLabel(item)}</span></article>)}</div>

  const changeMode = (next: ViewMode): void => {
    const anchor = mode === 'month' && visibleMonth.getFullYear() === today.getFullYear() && visibleMonth.getMonth() === today.getMonth() ? today : activeDate
    setDayOffset(calendarDayDelta(anchor, today))
    setWeekOffset(calendarDayDelta(startOfWeek(anchor), startOfWeek(today)) / 7)
    setMonthOffset((anchor.getFullYear() - today.getFullYear()) * 12 + anchor.getMonth() - today.getMonth())
    setMode(next)
  }
  const periodNavigation = mode === 'list'
    ? <span className="schedule-period-label">全部已排期</span>
    : <div className="schedule-period-nav">
      <button aria-label={mode === 'week' ? '上一周' : mode === 'day' ? '前一天' : '上个月'} onClick={() => mode === 'week' ? setWeekOffset((value) => value - 1) : mode === 'day' ? setDayOffset((value) => value - 1) : setMonthOffset((value) => value - 1)}><ChevronLeft size={15} /></button>
      <button className="today-button" onClick={() => { setWeekOffset(0); setMonthOffset(0); setDayOffset(0) }}>今天</button>
      <button aria-label={mode === 'week' ? '下一周' : mode === 'day' ? '后一天' : '下个月'} onClick={() => mode === 'week' ? setWeekOffset((value) => value + 1) : mode === 'day' ? setDayOffset((value) => value + 1) : setMonthOffset((value) => value + 1)}><ChevronRight size={15} /></button>
      <strong>{mode === 'week' ? `${formatMonthDay(weekStart)}—${formatMonthDay(addDays(weekStart, 6))}` : mode === 'day' ? `${visibleDay.getFullYear()}年${formatMonthDay(visibleDay)}` : monthLabel}</strong>
    </div>

  return <section {...pointerDrag} className={`card schedule-card mode-${mode}${full ? ' full-schedule' : ''}`}>
    <header className="card-header schedule-header"><div className="schedule-heading"><h2>{full ? '项目排期' : mode === 'week' ? '本周排期' : '本月排期'}</h2>{full ? periodNavigation : null}</div><div className="schedule-controls"><div className="segmented" role="group" aria-label="排期视图">{(full ? ['month', 'week', 'day', 'list'] : ['month', 'week']).map((value) => <button key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => changeMode(value as ViewMode)}>{{ week: '周', month: '月', day: '日', list: '列表' }[value]}</button>)}</div>{!full ? <button className="text-button" onClick={() => navigate({ page: 'schedule' })}>打开排期</button> : null}{full ? <BusinessTripButton day={isoDate(new Date(activeDate))} /> : null}<button className="new-schedule" onClick={() => openCreateDate(new Date(activeDate))}>＋ 新建排期</button></div></header>
    {full
      ? fullProjectFilters
      : mode === 'list'
        ? <div className="inline-calendar-toolbar"><strong>全部已排期</strong>{fullProjectFilters}</div>
        : <><div className="week-toolbar schedule-home-toolbar">{periodNavigation}</div>{fullProjectFilters}</>}
    {full ? <div
      className={`schedule-workspace${preferences.scheduleUnscheduledCollapsed ? ' left-collapsed' : ''}${inspectorCollapsed ? ' right-collapsed' : ''}`}
      style={{ '--inspector-width': `${preferences.inspectorWidth}px`, '--unscheduled-width': `${preferences.scheduleUnscheduledWidth}px` } as React.CSSProperties}
    >
      <aside
        className={`unscheduled-inbox${unscheduledDropActive ? ' drop-active' : ''}`}
        aria-label="未排期，拖放排期到这里"
        onDragEnter={(event) => { event.preventDefault(); setUnscheduledDropActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
        onDragLeave={(event) => {
          const related = event.relatedTarget
          if (related instanceof Node && event.currentTarget.contains(related)) return
          setUnscheduledDropActive(false)
        }}
        onDrop={dropInUnscheduled}
      >
        {preferences.scheduleUnscheduledCollapsed
          ? <button className="schedule-panel-rail" aria-label={`展开未排期，${unscheduledItems.length}项`} onClick={() => void setPreferences({ scheduleUnscheduledCollapsed: false })}><PanelLeftOpen size={15} /><span>未排期</span><b>{unscheduledItems.length}</b></button>
          : <>
            <header><div><span>收件箱</span><h3>未排期</h3></div><div className="schedule-panel-head-actions"><button className="unscheduled-inbox-add" aria-label="添加未排期行动" title="添加未排期行动" onClick={openCreateInbox}><Plus size={14} /></button><button className="schedule-panel-collapse" aria-label="折叠未排期" title="折叠未排期" onClick={() => void setPreferences({ scheduleUnscheduledCollapsed: true })}><PanelLeftClose size={14} /></button></div></header>

            <div className="unscheduled-project-list">
              {unscheduledGroups.map(({ key, project, items }) => <article className="unscheduled-project-group" style={projectScheduleStyle(items[0]!, project)} key={key}>
                <header>
                  <i aria-hidden="true" />
                  {project ? <button onClick={() => navigate({ page: 'project', projectId: project.id })}>{project.title}</button> : <strong>其他安排</strong>}
                  <span>{items.length}</span>
                  {project ? <button
                    className="unscheduled-project-drag"
                    draggable
                    aria-label={`拖拽整个项目${project.title}`}
                    title="拖入日历创建项目整体排期"
                    onDragStart={(event) => {
                      event.dataTransfer.setData(PROJECT_OVERVIEW_DRAG_MIME, project.id)
                      event.dataTransfer.setData('text/plain', `project-overview:${project.id}`)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                  ><GripVertical size={12} /></button> : null}
                </header>
                <div>
                  {items.map((item) => <span className="unscheduled-stage-shell" key={item.id}>
                    <button
                      className={`unscheduled-stage-chip${selectedId === item.id ? ' selected' : ''}`}
                      draggable
                      data-schedule-inbox-id={item.id}
                      aria-label={`${scheduleDisplayName(project)}·${item.title}·未排期`}
                      aria-pressed={selectedId === item.id}
                      onDragStart={(event) => beginScheduleDrag(event, item)}
                      onContextMenu={(event) => { event.preventDefault(); setColorMenu({ anchor: event.currentTarget, scheduleId: item.id, mode: 'menu', point: event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined }) }}
                      onClick={(event) => { setSelectedId(item.id); openDrawer(event.currentTarget) }}
                      onDoubleClick={() => project ? navigate({ page: 'project', projectId: project.id, moduleKey: projectModule(item) }) : undefined}
                    ><GripVertical size={10} /><span>{item.title}</span></button>
                    <button className="unscheduled-stage-delete" aria-label={`删除${scheduleDisplayName(project)}的${item.title}`} title="删除" onClick={() => void deleteUnscheduledItem(item)}><X size={9} /></button>
                  </span>)}
                </div>
              </article>)}
            </div>
            {!unscheduledItems.length ? <p>暂无未排期行动</p> : null}
          </>}
      </aside>
      <ResizableInspectorDivider
        width={preferences.scheduleUnscheduledWidth}
        ariaLabel="调整未排期宽度"
        className="left-panel-divider"
        cssVariable="--unscheduled-width"
        defaultWidth={176}
        minWidth={132}
        maxWidth={320}
        side="left"
        onCommit={(width) => setPreferences({ scheduleUnscheduledWidth: width })}
        onError={() => setDeleteNotice('未排期宽度保存失败')}
      />
      <div className="schedule-canvas">{calendar}</div>
      <ResizableInspectorDivider width={preferences.inspectorWidth} ariaLabel="调整右侧详情宽度" minWidth={220} onCommit={(width) => setPreferences({ inspectorWidth: width })} onError={() => setDeleteNotice('右侧详情宽度保存失败')} />
      <aside className={`schedule-inspector resizable-detail-pane${inspectorCollapsed ? ' collapsed' : ''}${detailDrawerOpen ? ' drawer-open' : ''}`} aria-label="排期详情" role={detailDrawerOpen ? 'dialog' : undefined}>
        {inspectorCollapsed
          ? <button className="schedule-panel-rail" aria-label="展开排期详情" onClick={() => void setPreferences({ scheduleInspectorCollapsed: false })}><PanelRightOpen size={15} /><span>详情</span></button>
          : <>
            <div className="schedule-inspector-controls"><button className="schedule-panel-collapse" aria-label="折叠排期详情" title="折叠排期详情" onClick={() => void setPreferences({ scheduleInspectorCollapsed: true })}><PanelRightClose size={14} /></button></div>
            <button ref={closeButtonRef} className="inspector-drawer-close" aria-label="关闭右侧详情" onClick={closeDrawer}><X size={15} /></button>
            {selectedItem
              ? <ScheduleDetail onEditProperty={(field, anchor) => setPropertyEditor({ anchor, id: selectedItem.id, field })} item={selectedItem} project={selectedProject} onDelete={() => void deleteSelectedItem()} onEditTime={setTimeEditorAnchor} onOpenProject={() => openScheduleTarget(selectedItem)} onToggleDone={() => void toggleDone(selectedItem)} />
              : <><header><span>排期详情</span><h3>选择一条排期</h3></header></>}
          </>}
      </aside>
    </div> : <div className={mode === 'month' ? 'month-schedule' : 'schedule-body'}>{calendar}</div>}
    {!full && selectedItem && detailAnchor ? <AnchoredPopover anchor={detailAnchor} ariaLabel={`排期详情：${selectedItem.title}`} className="schedule-detail-popover" onDismiss={() => setDetailAnchor(null)}>
      <ScheduleDetail onEditProperty={(field, anchor) => setPropertyEditor({ anchor, id: selectedItem.id, field })} item={selectedItem} project={selectedProject} onDelete={() => void deleteSelectedItem()} onEditTime={setTimeEditorAnchor} onOpenProject={() => openScheduleTarget(selectedItem)} onToggleDone={() => void toggleDone(selectedItem)} />
    </AnchoredPopover> : null}
    {selectedItem ? <ScheduleTimeEditor anchor={timeEditorAnchor} item={selectedItem} today={todayKey} onChange={editScheduleTime} onClose={() => setTimeEditorAnchor(null)} /> : null}
    {colorMenu && colorMenuItem ? colorMenu.mode === 'menu'
      ? <AnchoredPopover anchor={colorMenu.anchor} anchorPoint={colorMenu.point} ariaLabel={`${scheduleDisplayName(colorMenuProject)}的排期操作`} className="schedule-color-menu" role="menu" onDismiss={() => setColorMenu(null)}>
        {!(colorMenuItem.actionType === 'overview' && colorMenuItem.scheduleKind === 'hard_deadline') ? <button role="menuitem" onClick={() => { setPropertyEditor({ anchor: colorMenu.anchor, point: colorMenu.point, id: colorMenuItem.id, field: 'title' }); setColorMenu(null) }}>修改排期名称</button> : null}
        {colorMenuProject && !colorMenuItem.trip && !(colorMenuItem.actionType === 'overview' && colorMenuItem.scheduleKind === 'hard_deadline') ? <button role="menuitem" onClick={() => { setPropertyEditor({ anchor: colorMenu.anchor, point: colorMenu.point, id: colorMenuItem.id, field: 'stage' }); setColorMenu(null) }}>修改排期阶段</button> : null}
        <button role="menuitem" onClick={() => { if (colorMenuItem.trip) setTripEditor({ anchor: colorMenu.anchor, item: colorMenuItem }); else { setSelectedId(colorMenuItem.id); setTimeEditorAnchor(colorMenu.anchor) }; setColorMenu(null) }}>{colorMenuItem.trip ? `查看${travelLabel(colorMenuItem)}安排` : '修改日期／时段'}</button>
        {colorMenuProject ? <button role="menuitem" onClick={() => { setPropertyEditor({ anchor: colorMenu.anchor, point: colorMenu.point, id: colorMenuItem.id, field: 'projectTitle' }); setColorMenu(null) }}>修改项目名称</button> : null}
        <button role="menuitem" onClick={() => { void toggleDone(colorMenuItem).catch((cause: unknown) => setDeleteNotice(cause instanceof Error ? cause.message : '状态保存失败')); setColorMenu(null) }}>{colorMenuItem.state === 'done' ? '恢复进行中' : '标记已完成'}</button>
        {!colorMenuItem.trip ? <button role="menuitem" onClick={() => setColorMenu({ ...colorMenu, mode: 'picker' })}><Palette size={14} aria-hidden="true" /><span>{colorMenuProject ? '更换项目色' : '更换安排颜色'}</span></button> : null}
      </AnchoredPopover>
      : <AnchoredPopover anchor={colorMenu.anchor} anchorPoint={colorMenu.point} ariaLabel={`更换${scheduleDisplayName(colorMenuProject)}颜色`} className="schedule-color-menu schedule-color-palette" onDismiss={() => setColorMenu(null)}>
        <header><b>{colorMenuProject ? '更换项目色' : '更换安排颜色'}</b><small>{colorMenuProject?.title ?? colorMenuItem.title}</small></header>
        {colorMenuProject ? <ProjectColorPicker projectId={colorMenuProject.id} value={colorMenuProject.colorToken} label={`更改${colorMenuProject.title}项目色`} autoFocus onChanged={() => {
          colorMenuReturnFocusRef.current = colorMenu.anchor
          setColorMenu(null)
        }} /> : <div className="schedule-general-color-options schedule-inline-color-options" role="group" aria-label="选择安排颜色">
          {PROJECT_COLOR_TOKENS.slice(0, 10).map((token, index) => <button
            key={token}
            type="button"
            autoFocus={index === 0}
            className={scheduleColorToken(colorMenuItem, undefined) === token ? 'selected' : ''}
            aria-label={`选择颜色${index + 1}`}
            aria-pressed={scheduleColorToken(colorMenuItem, undefined) === token}
            style={{ '--swatch-color': `var(--${token})` } as React.CSSProperties}
            onClick={() => {
              void window.creatorOS?.setScheduleColor(colorMenuItem.id, token).then(async () => {
                await refresh()
                colorMenuReturnFocusRef.current = colorMenu.anchor
                setColorMenu(null)
              }).catch((cause: unknown) => setDeleteNotice(cause instanceof Error ? cause.message : '排期颜色保存失败'))
            }}
          />)}
        </div>}
      </AnchoredPopover>
      : null}
    {propertyEditor && schedules.some((item) => item.id === propertyEditor.id) ? <SchedulePropertyEditor key={`${propertyEditor.id}:${propertyEditor.field}`} anchor={propertyEditor.anchor} point={propertyEditor.point} item={displayItems.find((item) => item.id === propertyEditor.id)!} project={projectById.get(schedules.find((item) => item.id === propertyEditor.id)?.projectId ?? '')} field={propertyEditor.field} onSaved={refresh} onClose={() => setPropertyEditor(null)} /> : null}
    {tripEditor ? <BusinessTripEditor anchor={tripEditor.anchor} item={tripEditor.item} initialDate={todayKey} onClose={() => setTripEditor(null)} /> : null}
    {createTarget ? <CreateSchedulePopover date={createTarget.date} endDate={createTarget.endDate} projects={projects} initialProjectId={createTarget.initialProjectId} focusStage={createTarget.focusStage} returnFocus={createReturnFocus} onClose={closeCreateDate} /> : null}
    {deleteNotice ? <div className="schedule-move-toast" role="status">{deleteNotice}</div> : lastTopicMove ? <div className="schedule-move-toast" role="status">已移动选题「{lastTopicMove.title}」的目标日<button onClick={() => void undoTopicDeadlineMove()}>撤销</button></div> : lastMove ? <div className="schedule-move-toast" role="status">{lastMove.message}<button onClick={() => void undoMove().catch((cause: unknown) => setDeleteNotice(cause instanceof Error ? cause.message : '撤销失败'))}>撤销</button></div> : null}
  </section>
}
