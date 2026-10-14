import { projectStageProgress } from '../utils/project-overview-facts'
import { ProjectStageIcon } from './ProjectStageIcon'
import { ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectDetail, StagePlanEdit, StageTimeContext, StageTimePoint, StageTimeRecord, StageTimeUpdateResult } from '../../../shared/domain'
import { toSegmentOrdinal } from '../../../shared/domain/coarse-time'
import { projectModuleLabels } from '../utils/project-labels'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'

const stageLabels = projectModuleLabels
const segmentLabels: Record<StageTimePoint['segment'], string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'] as const

function shortDate(value: string): string {
  const [, month = '', day = ''] = value.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function localDateAtOffset(value: string, offset: number): string {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + offset))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function dateDifference(value: string, current: string): number {
  return Math.round((Date.parse(`${value}T00:00:00.000Z`) - Date.parse(`${current}T00:00:00.000Z`)) / 86_400_000)
}

function pointLabel(point: StageTimePoint | null, currentPoint: StageTimePoint | null): string {
  if (!point) return '未记录'
  if (!currentPoint) return `${shortDate(point.localDate)} ${segmentLabels[point.segment]}`
  const difference = dateDifference(point.localDate, currentPoint.localDate)
  const day = difference === 0 ? '今天' : difference === -1 ? '昨天' : difference === 1 ? '明天' : shortDate(point.localDate)
  return `${day}${segmentLabels[point.segment]}`
}

function effortLabel(units: number | null): string {
  if (!units) return '未记录'
  const days = units / 2
  return `${Number.isInteger(days) ? days.toFixed(0) : days}天`
}

interface ProjectTimelineProps {
  project: ProjectDetail
}

export function ProjectTimeline({ project }: ProjectTimelineProps): React.JSX.Element {
  const { completed, total } = projectStageProgress(project)
  return <div className="project-overview-progress"><strong>{total ? `${completed}/${total}` : '—'}</strong><span>{total ? '阶段已完成' : '未启用阶段'}</span>{total ? <span className="project-overview-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} aria-label="项目阶段进度"><i style={{ width: `${completed / total * 100}%` }} /></span> : null}</div>
}

interface StageTimeEditorProps {
  anchor: HTMLElement | null
  record: StageTimeRecord | null
  initialView?: 'root' | 'effort'
  onClose(): void
  onSave(
    patch: {
      startedAt?: StageTimePoint | null
      completedAt?: StageTimePoint | null
      actualEffortHalfDayUnits?: number | null
      planEdit?: StagePlanEdit
      source: 'manual' | 'backfill'
    },
    requestId: string
  ): Promise<StageTimeUpdateResult>
}

export function StageTimeEditor(props: StageTimeEditorProps): React.JSX.Element | null {
  if (!props.record) return null
  return <StageTimeEditorForm key={props.record.id} {...props} record={props.record} />
}

type StageTimePatch = Parameters<StageTimeEditorProps['onSave']>[0]
type PointKind = 'start' | 'end'
type EditorView = 'root' | PointKind | `${PointKind}-segment` | `${PointKind}-calendar` | 'effort'

function pointFor(record: StageTimeRecord, kind: PointKind): { point: StageTimePoint | null; source: 'actual' | 'planned' | null } {
  if (kind === 'start') {
    if (record.startedAt) return { point: record.startedAt, source: 'actual' }
    if (record.plannedStartedAt) return { point: record.plannedStartedAt, source: 'planned' }
  } else {
    if (record.completedAt) return { point: record.completedAt, source: 'actual' }
    if (record.plannedCompletedAt) return { point: record.plannedCompletedAt, source: 'planned' }
  }
  return { point: null, source: null }
}

function StageTimeEditorForm({ anchor, record, initialView = 'root', onClose, onSave }: StageTimeEditorProps & { record: StageTimeRecord }): React.JSX.Element | null {
  const [context, setContext] = useState<StageTimeContext | null>(null)
  const [view, setView] = useState<EditorView>(initialView)
  const [calendarPoint, setCalendarPoint] = useState<StageTimePoint>(record.completedAt ?? record.plannedCompletedAt ?? record.startedAt ?? record.plannedStartedAt ?? { localDate: '', segment: 'afternoon' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<{ patch: StageTimePatch; requestId: string; closeAfter: boolean; keepView?: boolean } | null>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const effortCloseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    void window.creatorOS?.getStageTimeContext()
      .then((next) => {
        if (!active) return
        setContext(next)
        setCalendarPoint((current) => current.localDate ? current : next.currentPoint)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '当前时间读取失败') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => firstActionRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [view])

  useEffect(() => () => {
    if (effortCloseTimerRef.current !== null) window.clearTimeout(effortCloseTimerRef.current)
  }, [])

  useEffect(() => {
    if (!anchor) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || saving) return
      if (view === 'root') {
        onClose()
        window.requestAnimationFrame(() => anchor.focus())
      } else {
        setView(view.endsWith('-calendar') || view.endsWith('-segment') ? view.split('-')[0] as PointKind : 'root')
        setError('')
      }
    }
    const outside = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (!saving && target && !target.closest('.stage-time-editor') && !anchor.contains(target)) {
        onClose()
        window.requestAnimationFrame(() => anchor.focus())
      }
    }
    window.addEventListener('keydown', escape)
    document.addEventListener('mousedown', outside)
    return () => { window.removeEventListener('keydown', escape); document.removeEventListener('mousedown', outside) }
  }, [anchor, onClose, saving, view])

  const weekDates = useMemo(() => {
    if (!context) return []
    const [year = 1970, month = 1, day = 1] = context.currentPoint.localDate.split('-').map(Number)
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday
    return Array.from({ length: 7 }, (_, index) => localDateAtOffset(context.currentPoint.localDate, mondayOffset + index))
  }, [context])

  const patchSource = (point?: StageTimePoint | null): 'manual' | 'backfill' => (
    point && context && toSegmentOrdinal(point) < toSegmentOrdinal(context.currentPoint) ? 'backfill' : 'manual'
  )
  const runSave = async (action: { patch: StageTimePatch; requestId: string; closeAfter: boolean; keepView?: boolean }): Promise<boolean> => {
    setSaving(true)
    setError('')
    setPendingAction(action)
    try {
      await onSave(action.patch, action.requestId)
      setPendingAction(null)
      if (action.closeAfter) onClose()
      else if (!action.keepView) setView('root')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '阶段时间保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }
  const savePatch = (patch: StageTimePatch, closeAfter = false, keepView = false): void => {
    void runSave({ patch, requestId: crypto.randomUUID(), closeAfter, keepView })
  }

  const openPoint = (kind: PointKind): void => {
    const current = pointFor(record, kind).point
    setCalendarPoint(current ?? context?.currentPoint ?? calendarPoint)
    setView(kind)
    setError('')
  }

  const candidateError = (kind: PointKind, point: StageTimePoint): string | null => {
    if (!context) return '当前时间尚未读取'
    const currentOrdinal = toSegmentOrdinal(context.currentPoint)
    const candidateOrdinal = toSegmentOrdinal(point)
    const existingActual = kind === 'start' ? record.startedAt : record.completedAt
    const actual = Boolean(existingActual) || candidateOrdinal <= currentOrdinal
    if (actual && candidateOrdinal > currentOrdinal) return '实际时间不能晚于现在'
    if (actual && kind === 'start' && record.completedAt && candidateOrdinal > toSegmentOrdinal(record.completedAt)) return '开始时间不能晚于结束时间'
    if (actual && kind === 'end' && record.startedAt && candidateOrdinal < toSegmentOrdinal(record.startedAt)) return '结束时间不能早于开始时间'
    if (!actual && kind === 'start' && record.plannedCompletedAt && candidateOrdinal > toSegmentOrdinal(record.plannedCompletedAt)) return '开始时间不能晚于结束时间'
    if (!actual && kind === 'end' && record.plannedStartedAt && candidateOrdinal < toSegmentOrdinal(record.plannedStartedAt)) return '结束时间不能早于开始时间'
    return null
  }

  const savePoint = (kind: PointKind, point: StageTimePoint): void => {
    const message = candidateError(kind, point)
    if (message) {
      setError(message)
      return
    }
    const actual = Boolean(kind === 'start' ? record.startedAt : record.completedAt)
      || Boolean(context && toSegmentOrdinal(point) <= toSegmentOrdinal(context.currentPoint))
    if (actual) {
      savePatch({ [kind === 'start' ? 'startedAt' : 'completedAt']: point, source: patchSource(point) }, true)
      return
    }
    savePatch({ planEdit: { field: kind, point }, source: 'manual' }, true)
  }

  const clearPoint = (kind: PointKind): void => {
    const value = pointFor(record, kind)
    if (value.source === 'actual') savePatch({ [kind === 'start' ? 'startedAt' : 'completedAt']: null, source: 'manual' }, true)
    else savePatch({ planEdit: { field: kind, point: null }, source: 'manual' }, true)
  }

  const renderRoot = (): React.JSX.Element => <div className="stage-time-editor-root">
    {(['start', 'end'] as const).map((kind) => {
      const value = pointFor(record, kind)
      return <button className="stage-time-row" key={kind} onClick={() => openPoint(kind)}>
        <span><Clock3 size={13} /><b>{kind === 'start' ? '开始' : '结束'}</b></span>
        <em>{value.point ? pointLabel(value.point, context?.currentPoint ?? null) : '未记录'}{value.source ? <small className={value.source}>{value.source === 'actual' ? '实际' : '计划'}</small> : null}</em>
        <ChevronRight size={13} />
      </button>
    })}
    <button className="stage-time-row" onClick={() => { setView('effort'); setError('') }}>
      <span><Clock3 size={13} /><b>实际投入</b></span><em>{effortLabel(record.actualEffortHalfDayUnits)}</em><ChevronRight size={13} />
    </button>
  </div>

  const renderPointChoices = (kind: PointKind): React.JSX.Element => {
    if (!context) return <p className="stage-time-loading">正在读取当前时间…</p>
    const currentDate = context.currentPoint.localDate
    const existing = pointFor(record, kind)
    const dates = [
      { label: '今天', date: currentDate },
      { label: '明天', date: localDateAtOffset(currentDate, 1) },
      { label: '昨天', date: localDateAtOffset(currentDate, -1) }
    ]
    const actualLocked = existing.source === 'actual'
    const openSegments = (localDate: string): void => {
      setCalendarPoint({ localDate, segment: localDate === currentDate ? context.currentPoint.segment : 'afternoon' })
      setView(`${kind}-segment`)
      setError('')
    }
    return <div className="stage-time-choice-view">
      <button ref={firstActionRef} className="stage-time-back" onClick={() => setView('root')}><ChevronLeft size={13} />{kind === 'start' ? '开始' : '结束'}</button>
      <div className="stage-time-quick-grid compact">
        <button onClick={() => savePoint(kind, context.currentPoint)} disabled={saving}><b>现在</b><small>{pointLabel(context.currentPoint, context.currentPoint)}</small></button>
        {dates.map((item) => {
          const disabled = actualLocked && item.date > currentDate
          return <button key={item.label} disabled={saving || disabled} onClick={() => openSegments(item.date)}><b>{item.label}</b><small>{shortDate(item.date)}</small></button>
        })}
      </div>
      <div className="stage-week-strip" aria-label="本周日期">
        <header><span>本周</span><button onClick={() => setView(`${kind}-calendar`)}>更多<ChevronRight size={12} /></button></header>
        <div>{weekDates.map((date) => {
          const [year = 1970, month = 1, day = 1] = date.split('-').map(Number)
          const disabled = actualLocked && date > currentDate
          return <button className={date === currentDate ? 'today' : ''} key={date} disabled={disabled} onClick={() => openSegments(date)}><small>{weekdayLabels[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}</small><b>{day}</b></button>
        })}</div>
      </div>
      {existing.point ? <button className="stage-time-clear" onClick={() => clearPoint(kind)} disabled={saving}>清除{kind === 'start' ? '开始' : '结束'}</button> : null}
    </div>
  }

  const renderSegments = (kind: PointKind): React.JSX.Element => <div className="stage-time-segment-view">
    <button ref={firstActionRef} className="stage-time-back" onClick={() => setView(kind)}><ChevronLeft size={13} />{shortDate(calendarPoint.localDate)}</button>
    <p>选择时段</p>
    <div className="stage-segment-options">{(['morning', 'afternoon', 'evening'] as const).map((segment) => {
      const candidate = { ...calendarPoint, segment }
      const invalid = candidateError(kind, candidate)
      return <button className={calendarPoint.segment === segment ? 'selected' : ''} disabled={Boolean(invalid)} key={segment} onClick={() => savePoint(kind, candidate)}>{segmentLabels[segment]}</button>
    })}</div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>

  const renderCalendar = (kind: PointKind): React.JSX.Element => {
    if (!context) return <p className="stage-time-loading">正在读取当前时间…</p>
    const actualLocked = pointFor(record, kind).source === 'actual'
    const message = candidateError(kind, calendarPoint)
    return <div className="stage-time-calendar-view">
      <button ref={firstActionRef} className="stage-time-back" onClick={() => setView(kind)}><ChevronLeft size={13} />更多日期</button>
      <CalendarDatePicker
        label={kind === 'start' ? '开始' : '结束'}
        today={context.currentPoint.localDate}
        value={calendarPoint.localDate}
        max={actualLocked ? context.currentPoint.localDate : null}
        onChange={(localDate) => { if (localDate) { setCalendarPoint((current) => ({ ...current, localDate })); setView(`${kind}-segment`) } }}
      />
      {message ? <p className="form-error" role="alert">{message}</p> : null}
    </div>
  }

  const renderEffort = (): React.JSX.Element => {
    const common = [null, 1, 2, 3, 4] as const
    const current = record.actualEffortHalfDayUnits ?? 1
    const choose = (units: number | null): void => savePatch({ actualEffortHalfDayUnits: units, source: 'manual' }, true)
    const step = (units: number): void => {
      if (effortCloseTimerRef.current !== null) window.clearTimeout(effortCloseTimerRef.current)
      void runSave({
        patch: { actualEffortHalfDayUnits: units, source: 'manual' },
        requestId: crypto.randomUUID(),
        closeAfter: false,
        keepView: true
      }).then((saved) => {
        if (!saved) return
        effortCloseTimerRef.current = window.setTimeout(() => onClose(), 450)
      })
    }
    return <div className="stage-time-choice-view stage-effort-view">
      <button ref={firstActionRef} className="stage-time-back" onClick={() => setView('root')}><ChevronLeft size={13} />实际投入</button>
      <div className="stage-effort-options">{common.map((units) => <button className={record.actualEffortHalfDayUnits === units ? 'selected' : ''} key={units ?? 'none'} disabled={saving} onClick={() => choose(units)}>{units ? effortLabel(units) : '不填'}</button>)}</div>
      <div className="stage-effort-stepper"><button aria-label="减少半天" disabled={saving || current <= 1} onClick={() => step(Math.max(1, current - 1))}>−</button><b>{effortLabel(current)}</b><button aria-label="增加半天" disabled={saving || current >= 200} onClick={() => step(Math.min(200, current + 1))}>＋</button></div>
    </div>
  }

  return <AnchoredPopover anchor={anchor} ariaLabel={`修改${stageLabels[record.stageKey]}阶段时间`} className="stage-time-editor" onDismiss={onClose}>
    <header className="stage-time-editor-header"><div><span>阶段时间</span><h3><ProjectStageIcon stageKey={record.stageKey} />{stageLabels[record.stageKey]}</h3></div><button aria-label="关闭阶段时间" disabled={saving} onClick={() => { onClose(); window.requestAnimationFrame(() => anchor?.focus()) }}><X size={13} /></button></header>
    {view === 'root' ? renderRoot() : null}
    {view === 'start' || view === 'end' ? renderPointChoices(view) : null}
    {view === 'start-segment' || view === 'end-segment' ? renderSegments(view.split('-')[0] as PointKind) : null}
    {view === 'start-calendar' || view === 'end-calendar' ? renderCalendar(view.split('-')[0] as PointKind) : null}
    {view === 'effort' ? renderEffort() : null}
    {saving ? <p className="stage-time-saving" role="status">正在保存…</p> : null}
    {error && !view.endsWith('-segment') ? <div className="stage-time-error" role="alert"><span>{error}</span>{pendingAction ? <button onClick={() => void runSave(pendingAction)}>重试</button> : null}</div> : null}
  </AnchoredPopover>
}
