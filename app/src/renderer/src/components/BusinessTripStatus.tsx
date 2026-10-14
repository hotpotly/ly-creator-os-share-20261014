import { travelLabel } from '../../../shared/travel-day'
import { CalendarDays, ChevronDown, Coffee, House, Plane, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { ScheduleItem } from '../../../shared/domain'
import { businessTripsForDate, businessTripSaveSchema, tripDate, TRAVEL_KINDS, TRAVEL_KIND_LABELS, TRAVEL_DEFAULT_TITLES, type TravelKind, type BusinessTripSaveInput } from '../../../shared/business-trip'
import { useWorkspaceStore } from '../store/workspace'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { AppSelect } from './AppSelect'

export function TravelIcon({ kind = 'business', size = 14 }: { kind?: TravelKind; size?: number }): React.JSX.Element {
  const Icon = kind === 'home' ? House : kind === 'rest' ? Coffee : Plane
  return <Icon size={size} aria-hidden="true" />
}

export function BusinessTripEditor({ anchor, item, initialDate, initialEndDate, initialProjectId, initialKind = 'business', onClose }: {
  initialKind?: TravelKind; anchor: HTMLElement; item?: ScheduleItem; initialDate: string; initialEndDate?: string; initialProjectId?: string; onClose(): void
}): React.JSX.Element {
  const { today, projects } = useWorkspaceStore(state => state.snapshot)
  const refresh = useWorkspaceStore(state => state.refresh)
  // Keep the version captured when opening; broadcasts must never silently overwrite a draft.
  const [original] = useState(item)
  const [kind, setKind] = useState<TravelKind>(item?.trip?.kind ?? initialKind)
  const label = TRAVEL_KIND_LABELS[kind]
  const [title, setTitle] = useState(item?.title ?? TRAVEL_DEFAULT_TITLES[initialKind])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  const [startDate, setStartDate] = useState(tripDate(item?.startAt ?? null) ?? initialDate)
  const [endDate, setEndDate] = useState(tripDate(item?.endAt ?? null) ?? initialEndDate ?? initialDate)
  const [projectId, setProjectId] = useState(item?.projectId ?? initialProjectId ?? '')
  const [notes, setNotes] = useState(item?.trip?.notes ?? '')
  const [confirmation, setConfirmation] = useState<'cancel' | 'end_early' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const cancelled = Boolean(original?.trip?.cancelled)
  const ended = Boolean(original?.trip?.endedEarly)
  const canEnd = original && !ended && !cancelled && (tripDate(original.startAt) ?? '') <= today && (tripDate(original.endAt) ?? '') >= today
  const dismiss = (): void => { if (!saving.current) onClose() }
  const save = async (action: BusinessTripSaveInput['action']): Promise<void> => {
    if (saving.current) return
    const payload = {
      scheduleId: original?.id ?? null, expectedUpdatedAt: original?.updatedAt ?? null, action,
      kind, title, projectId: projectId || null, startDate, endDate, notes
    }
    // Lifecycle actions use the stored record, not unrelated unsaved edits.
    if (action !== 'save' && original) Object.assign(payload, { kind: original.trip?.kind ?? 'business', title: original.title, projectId: original.projectId, startDate: tripDate(original.startAt), endDate: tripDate(original.endAt), notes: original.trip?.notes ?? '' })
    const parsed = businessTripSaveSchema.safeParse(payload)
    if (!parsed.success) {
      if (parsed.error.issues.some(issue => ['title', 'notes', 'projectId'].includes(String(issue.path[0])))) setDetailsOpen(true)
      setError(parsed.error.issues[0]?.message ?? '请检查行程安排'); return
    }
    saving.current = true; setBusy(true); setError('')
    try {
      if (!window.creatorOS) throw new Error('App连接不可用，请稍后重试')
      await window.creatorOS.saveBusinessTrip(parsed.data)
      // Mutation broadcasts to all windows; a refresh error must not enable duplicate creation.
      void refresh().catch(() => undefined)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试') }
    finally { saving.current = false; setBusy(false) }
  }
  return <AnchoredPopover anchor={anchor} ariaLabel={original ? `编辑${label}安排` : `安排${label}`} className={`business-trip-editor travel-surface-${kind}`} onDismiss={dismiss}>
    <header><div className="business-trip-kind" role="group" aria-label="行程类型">
          {TRAVEL_KINDS.map(value => <button key={value} type="button" disabled={busy || cancelled} aria-pressed={kind === value} data-kind={value} onClick={() => {
            // Only a new, untouched default name follows the type. Existing names are user data.
            if (!original && title === TRAVEL_DEFAULT_TITLES[kind]) setTitle(TRAVEL_DEFAULT_TITLES[value])
            setKind(value)
          }}><TravelIcon kind={value} size={13} />{TRAVEL_KIND_LABELS[value]}</button>)}
        </div><button type="button" aria-label={`关闭${label}安排`} disabled={busy} onClick={dismiss}><X size={14} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void save('save') }}>
      <div className="business-trip-fields"><fieldset disabled={busy || cancelled}>
        {cancelled || ended ? <b className="business-trip-readonly-status">{cancelled ? `已取消${label}` : `${label}已结束`}</b> : null}
        <div className="business-trip-calendar">
          <CalendarDatePicker clearable={false} fixedWeeks={false} label="行程日期" today={today} value={startDate} onChange={() => undefined} rangeSelection={{ end: endDate, disabled: busy || cancelled || ended, onChange: (start, end) => { setStartDate(start); setEndDate(end) } }} />
          <output className="business-trip-range" aria-label="已选行程日期" aria-live="polite"><CalendarDays size={13} />{startDate === endDate ? startDate : `${startDate} — ${endDate}`}</output>
        </div>
        <div id={detailsId} className="business-trip-details" hidden={!detailsOpen}>
          <label>名称／目的地<input aria-label={`${label}名称或目的地`} maxLength={300} placeholder={TRAVEL_DEFAULT_TITLES[kind]} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>关联项目（可选）<AppSelect aria-label={`${label}关联项目`} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">不关联项目</option>{projects.filter(project => !project.trashedAt || project.id === projectId).map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect></label>
          <label>备注（可选）<textarea aria-label={`${label}备注`} rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          {original && !cancelled ? <div className="business-trip-lifecycle">
            <button type="button" className="business-trip-danger" onClick={() => setConfirmation('cancel')}>{`取消${label}`}</button>
            {canEnd ? <button type="button" onClick={() => setConfirmation('end_early')}>提前结束</button> : null}
          </div> : null}
        </div>
      </fieldset>
      </div>
      {error ? <p className="business-trip-error" role="alert">{error}</p> : null}
      {confirmation ? <div className="business-trip-confirm" role="group" aria-label={`确认${label}变更`}><p>{confirmation === 'cancel' ? `取消后待办区不再显示这次${label}，排期记录仍保留。` : `今天记为最后一天，之后不再显示${label}提示。`}未保存的其他修改不会提交。</p><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>返回</button><button type="button" disabled={busy} onClick={() => void save(confirmation)}>{confirmation === 'cancel' ? `确认取消${label}` : '确认提前结束'}</button></div> : <footer>
        <button type="button" className="business-trip-more" aria-expanded={detailsOpen} aria-controls={detailsId} disabled={busy} onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? '收起设置' : '更多设置'}<ChevronDown size={12} /></button>
        {!cancelled ? <button type="submit" className="business-trip-save" disabled={busy}>{busy ? '保存中…' : `保存${label}`}</button> : null}
      </footer>}
    </form>

  </AnchoredPopover>
}

export function BusinessTripButton({ item, day, endDate, projectId, kind = 'business' }: { kind?: TravelKind; item?: ScheduleItem; day: string; endDate?: string; projectId?: string }): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const label = item ? `查看${travelLabel(item)}安排` : '安排行程'
  return <><button type="button" className="business-trip-add business-trip-icon" aria-label={label} title={label} onClick={event => setAnchor(event.currentTarget)}>{item ? (<TravelIcon kind={item.trip?.kind} size={15} />) : <CalendarDays size={15} />}</button>{anchor ? <BusinessTripEditor anchor={anchor} item={item} initialDate={day} initialEndDate={endDate} initialProjectId={projectId} initialKind={kind} onClose={() => setAnchor(null)} /> : null}</>
}

export function BusinessTripStatus({ day, compact = false, showCreate = true }: { day: string; compact?: boolean; showCreate?: boolean }): React.JSX.Element | null {
  const { today, schedules } = useWorkspaceStore(state => state.snapshot)
  const entries = businessTripsForDate(schedules, day, today)
  const [editing, setEditing] = useState<{ anchor: HTMLElement; item: ScheduleItem } | null>(null)
  if (!showCreate && !entries.length && !editing) return null
  return <section className={`business-trip-status${compact ? ' compact' : ''}${entries.length ? ' has-trips' : ''}`} aria-label="行程状态">
    <div className="business-trip-entries">{entries.map(entry => <button key={entry.item.id} type="button" className={`business-trip-summary${entry.item.state === 'done' ? ' done' : ''}`} data-travel-kind={entry.item.trip?.kind ?? 'business'} title={`${entry.label}·${entry.item.title}；${entry.range}；${entry.progress}`} onClick={event => setEditing({ anchor: event.currentTarget, item: entry.item })}>
      <TravelIcon kind={entry.item.trip?.kind} size={14} /><span className="business-trip-copy"><b>{entry.label}·{entry.item.title}</b>{!compact ? <small>{entry.range} · {entry.progress}</small> : null}</span>
    </button>)}</div>
    {showCreate && <BusinessTripButton day={day} />}
    {editing ? <BusinessTripEditor anchor={editing.anchor} item={editing.item} initialDate={day} onClose={() => setEditing(null)} /> : null}
  </section>
}
