import { dailyWorkTone, recordedWorkMinutes } from '../../../shared/daily-work-log'
import type { DailyWorkLog } from '../../../shared/domain'
import { ChevronRight, Clock3, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { AnchoredPopover } from './AnchoredPopover'
import { WorkLogDateScrubber } from './WorkLogDateScrubber'
import { travelDayHighlight } from '../../../shared/travel-day'

const categories = [
  { category: 'self_media', field: 'selfMediaMinutes' },
  { category: 'ai', field: 'aiMinutes' },
  { category: 'other_work', field: 'otherWorkMinutes' }
] as const
function duration(minutes: number): string {
  if (!minutes) return '0小时'
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return `${hours ? `${hours}小时` : ''}${rest ? `${rest}分钟` : ''}`
}
function hoursText(minutes: number): string { return String(Number((minutes / 60).toFixed(2))) }
type WorkLogDraft = { base: Pick<DailyWorkLog, 'selfMediaMinutes' | 'aiMinutes' | 'otherWorkMinutes' | 'totalMinutes'>; byCategory: boolean; hours: string; parts: { selfMediaMinutes: string; aiMinutes: string; otherWorkMinutes: string } }
function draftFor(record: DailyWorkLog): WorkLogDraft {
  return { base: { selfMediaMinutes: record.selfMediaMinutes, aiMinutes: record.aiMinutes, otherWorkMinutes: record.otherWorkMinutes, totalMinutes: record.totalMinutes ?? null }, byCategory: false, hours: hoursText(record.totalMinutes ?? record.selfMediaMinutes + record.aiMinutes + record.otherWorkMinutes), parts: { selfMediaMinutes: hoursText(record.selfMediaMinutes), aiMinutes: hoursText(record.aiMinutes), otherWorkMinutes: hoursText(record.otherWorkMinutes) } }
}
function WorkLogPopover({ anchor, dailyWorkLog, onDismiss }: { anchor: HTMLElement; dailyWorkLog: DailyWorkLog; onDismiss(): void }): React.JSX.Element {
  const { today, preferences, schedules } = useWorkspaceStore((state) => state.snapshot)
  const [day, setDay] = useState(dailyWorkLog.day)
  const label = day === today ? '今日' : day.replaceAll('-', '/')
  const refresh = useWorkspaceStore((state) => state.refresh)
  // Each visited day owns its draft and concurrency baseline; never reuse another day's values.
  const [drafts, setDrafts] = useState<Record<string, WorkLogDraft>>(() => ({ [dailyWorkLog.day]: draftFor(dailyWorkLog) }))
  const draft = drafts[day]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const changeDay = useCallback((next: string) => { if (!busy && next !== day) { setDay(next); setError('') } }, [busy, day])
  useEffect(() => {
    if (draft) return
    let cancelled = false
    void Promise.resolve().then(() => { if (!window.creatorOS) throw new Error('App尚未准备好'); return window.creatorOS.getDailyWorkLog(day) }).then(record => {
      if (!cancelled) setDrafts(current => ({ ...current, [day]: draftFor(record) }))
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '时长读取失败') })
    return () => { cancelled = true }
  }, [day, draft, retry])
  const updateDraft = (patch: Partial<WorkLogDraft>): void => setDrafts(current => ({ ...current, [day]: { ...current[day]!, ...patch } }))
  const pending = useRef(false)
  const parse = (value: string): number => {
    const number = Number(value)
    if (!value.trim() || !Number.isFinite(number) || number < 0 || number > 24) throw new Error('请输入0至24小时')
    return Math.round(number * 60)
  }
  const save = async (): Promise<void> => {
    if (pending.current || !window.creatorOS || !draft) return
    pending.current = true; setBusy(true); setError('')
    try {
      const { base, byCategory, hours, parts } = draft
      if (byCategory) await window.creatorOS.setDailyWorkLog(day, { selfMediaMinutes: parse(parts.selfMediaMinutes), aiMinutes: parse(parts.aiMinutes), otherWorkMinutes: parse(parts.otherWorkMinutes) }, base)
      else await window.creatorOS.setDailyWorkLogTotal(day, parse(hours), base)
      await refresh(); onDismiss()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '时长保存失败') }
    finally { pending.current = false; setBusy(false) }
  }
  const tone = travelDayHighlight(schedules, day)?.tone
  return <AnchoredPopover anchor={anchor} ariaLabel={`记录${label}投入`} className={`todo-work-log-popover compact${tone ? ` travel-surface-${tone}` : ''}`} onDismiss={onDismiss}>
    <header><WorkLogDateScrubber day={day} disabled={busy} onChange={changeDay} /><button type="button" aria-label="关闭投入记录" onClick={onDismiss}><X size={13} /></button></header>
    <form data-day={day} onSubmit={(event) => { event.preventDefault(); void save() }}>
      {draft ? <>{draft.byCategory ? categories.map(({ category, field }) => <label key={field}><span>{preferences.todoCategoryLabels[category]}</span><input type="number" min="0" max="24" step="any" disabled={busy} value={draft.parts[field]} onChange={(event) => updateDraft({ parts: { ...draft.parts, [field]: event.currentTarget.value } })} /><em>小时</em></label>) : <label><span>总时长</span><input autoFocus={day === dailyWorkLog.day} type="number" min="0" max="24" step="any" disabled={busy} value={draft.hours} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateDraft({ hours: event.currentTarget.value })} /><em>小时</em></label>}
      <p>{draft.byCategory ? '按分类合计，替代总时长；不重复累加。' : `${day.replaceAll('-', '/')}·保存当日总量，不累加`}</p></> : <p role="status">{error ? '无法读取这一天的时长' : '读取中…'}</p>}
      {error ? <p className="work-log-error" role="alert">{error}</p> : null}
      <footer>{draft ? <button type="button" disabled={busy} onClick={() => { updateDraft({ byCategory: !draft.byCategory }); setError('') }}>{draft.byCategory ? '只记总时长' : '按分类记录'}</button> : <button type="button" disabled={!error} onClick={() => { setError(''); setRetry(value => value + 1) }}>重试</button>}<button type="submit" className="primary-action" disabled={busy || !draft}>{busy ? '保存中…' : '保存'}</button></footer>
    </form>
  </AnchoredPopover>
}

function WorkLogForDay({ day, compact }: { day: string; compact?: boolean }): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const [record, setRecord] = useState<DailyWorkLog | null>(() => snapshot.dailyWorkLog.day === day ? snapshot.dailyWorkLog : null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let canceled = false
    const load = async (): Promise<void> => {
      try {
        if (!window.creatorOS) throw new Error('App尚未准备好')
        const next = await window.creatorOS.getDailyWorkLog(day)
        if (!canceled) { setRecord(next); setError('') }
      } catch (reason) { if (!canceled) setError(reason instanceof Error ? reason.message : '时长读取失败') }
    }
    void load()
    return () => { canceled = true }
  }, [day, snapshot, retry])
  const label = day === snapshot.today ? '今日投入' : `${day.slice(0, 4) === snapshot.today.slice(0, 4) ? day.slice(5).replace('-', '/') : day.replaceAll('-', '/')}投入`
  const total = record ? recordedWorkMinutes(record) : null
  return <><div className={`todo-work-log${compact ? ' todo-work-log-compact' : ''}`} data-day={day}><div><Clock3 size={13} aria-hidden="true" />{!compact && <span>{label}</span>}<b data-work-tone={error || !record ? undefined : dailyWorkTone(total)}>{error ? '读取失败' : !record ? '读取中…' : total === null ? '未记录' : duration(total)}</b></div><button aria-label={compact ? (error ? '重试' : '记录') : undefined} title={compact ? `${error ? '重试读取' : '编辑'}${day}投入` : undefined} disabled={!record && !error} aria-expanded={Boolean(anchor)} onClick={(event) => { if (error) { setRetry((value) => value + 1); return }; setAnchor(anchor ? null : event.currentTarget) }}>{compact ? <Pencil size={14} aria-hidden="true" /> : <>{error ? '重试' : '记录'}<ChevronRight size={13} /></>}</button></div>{error ? <p className="todo-context-error" role="alert">{error}</p> : null}{anchor && record ? <WorkLogPopover anchor={anchor} dailyWorkLog={record} onDismiss={() => setAnchor(null)} /> : null}</>
}
export function DailyWorkLogEditor({ day, compact }: { day?: string; compact?: boolean }): React.JSX.Element {
  const today = useWorkspaceStore((state) => state.snapshot.today)
  const selectedDay = day ?? today
  // A date change unmounts the draft and cancels old reads; pending saves retain their original day.
  return <WorkLogForDay key={selectedDay} day={selectedDay} compact={compact} />
}
