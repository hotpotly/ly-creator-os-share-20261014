import { groupScheduleItems } from '../../../shared/schedule-group'
import { travelDayHighlight, travelLabel } from '../../../shared/travel-day'
import { ExternalLink, CalendarDays, Check, Flag, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ScheduleItem } from '../../../shared/domain'
import { isCrossDaySchedule, scheduleOccursOnDate } from '../../../shared/schedule-range'
import { deriveTopicDeadlineMarkers } from '../../../shared/topic-deadline-marker'
import { useWorkspaceStore } from '../store/workspace'
import { TravelIcon } from './BusinessTripStatus'
import { CalendarDatePicker } from './CalendarDatePicker'
import { projectModuleForScheduleAction, projectModuleLabels } from '../utils/project-labels'

export function ScheduleCompanionWindow(): React.JSX.Element {
  const { today, schedules, projects, topics, topicStages } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [dateOverride, setDate] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const pending = useRef(false)
  const contentRef = useRef<HTMLElement>(null)
  const agendaRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    let frame = 0, lastHeight = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const height = Math.min(600, Math.max(200, Math.ceil(element.getBoundingClientRect().height)))
        if (height === lastHeight) return
        lastHeight = height
        void window.creatorOS?.resizeScheduleWindow(height).catch(() => { lastHeight = 0 })
      })
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])
  const selectedDate = dateOverride ?? today
  useEffect(() => { if (agendaRef.current) agendaRef.current.scrollTop = 0 }, [selectedDate])
  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); void window.creatorOS?.closeScheduleWindow() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const active = useMemo(() => groupScheduleItems(schedules, projectModuleLabels).filter((item) => !item.projectId || (projectById.has(item.projectId) && !projectById.get(item.projectId)!.trashedAt)), [schedules, projectById])
  const markers = useMemo(() => deriveTopicDeadlineMarkers(topics, topicStages, today), [topics, topicStages, today])
  const itemsForDay = (day: string): ScheduleItem[] => active.filter((item) => scheduleOccursOnDate(item, new Date(`${day}T12:00:00`)))
    .sort((a, b) => Number(a.state === 'done') - Number(b.state === 'done') || (a.startAt ?? '').localeCompare(b.startAt ?? '') || a.id.localeCompare(b.id))
  const items = itemsForDay(selectedDate)
  const targets = markers.filter((item) => item.date === selectedDate)
  const entriesForDay = (day: string): { title: string; color: string; done: boolean; summary: string }[] => [
    ...itemsForDay(day).map((item) => {
      const project = item.projectId ? projectById.get(item.projectId) : undefined
      return { title: item.trip ? `${travelLabel(item)}·${item.title}` : project?.title ?? item.title, color: item.trip ? `travel-${item.trip.kind ?? 'business'}` : project?.colorToken ?? item.colorToken ?? 'project-1', done: item.state === 'done', summary: `${project?.title ?? ''}·${item.title}${item.state === 'done' ? '·已完成' : ''}` }
    }),
    ...markers.filter((item) => item.date === day).map((item) => ({ title: item.title, color: 'primary', done: false, summary: `${item.title}·选题目标日` }))
  ]
  const toggle = async (item: ScheduleItem): Promise<void> => {
    if (pending.current || !window.creatorOS) return
    pending.current = true; setPendingId(item.id); setError(null)
    try {
      await window.creatorOS.setScheduleState(item.id, item.state === 'done' ? 'normal' : 'done')
      await refresh()
    } catch (reason) {
      setError({ id: item.id, message: reason instanceof Error ? reason.message : '状态保存失败，请重试' })
    } finally { pending.current = false; setPendingId(null) }
  }
  return <main ref={contentRef} className="schedule-companion">
    <header><b><CalendarDays size={15} />排期</b><nav><button aria-label="打开排期" title="打开排期" onClick={() => void window.creatorOS?.openScheduleMainWindow(selectedDate)}><ExternalLink size={14} /></button><button aria-label="关闭排期速览" onClick={() => void window.creatorOS?.closeScheduleWindow()}><X size={14} /></button></nav></header>
    <section className="schedule-companion-calendar">
      <CalendarDatePicker key={today} fixedWeeks={false} clearable={false} label="查看排期" today={today} value={selectedDate}
        onChange={(value) => { setDate(value === today ? null : value); setError(null) }}
        dayHighlight={day => travelDayHighlight(active, day)}
        hasItems={(day) => entriesForDay(day).length > 0}
        daySummary={(day) => entriesForDay(day).map((entry) => entry.summary).join('；')}
        renderDayContent={(day) => {
          const entries = entriesForDay(day), first = entries[0]
          return <>{entries.length > 1 ? <span className="schedule-day-more">+{entries.length - 1}</span> : null}
            <span className={`schedule-day-project${first?.done ? ' done' : ''}`} style={first ? { '--schedule-project-color': `var(--${first.color})` } as CSSProperties : undefined}>{first?.title ?? '\u00a0'}</span></>
        }} />
    </section>
    <div className="schedule-companion-day"><b>{selectedDate === today ? '今天' : selectedDate.slice(5).replace('-', '月') + '日'}</b><span>{items.length + targets.length}项安排</span></div>
    <section ref={agendaRef} className="schedule-companion-agenda schedule-companion-scroll" aria-label="所选日期排期">
      {items.map((item) => {
        const project = item.projectId ? projectById.get(item.projectId) : undefined
        const time = item.startAt ? new Date(item.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
        const stage = projectModuleLabels[projectModuleForScheduleAction(item.actionType)]
        const name = project ? `${item.actionType === 'overview' ? item.title : stage}·${project.title}` : item.title
        const range = item.endAt && item.startAt && isCrossDaySchedule(item) ? `${new Date(item.startAt).toLocaleDateString('zh-CN')}—${new Date(item.endAt).toLocaleDateString('zh-CN')}` : time
        const detail = [item.title !== stage && name !== item.title && !name.startsWith(`${item.title}·`) ? item.title : '', range].filter(Boolean).join(' · ')
        return <article data-travel-kind={item.trip ? item.trip.kind ?? 'business' : undefined} key={item.id} title={[name, detail].filter(Boolean).join('；')} className={item.state === 'done' ? 'done' : ''} style={{ borderLeftColor: `var(--${(item.trip ? `travel-${item.trip.kind ?? 'business'}` : project?.colorToken ?? item.colorToken ?? 'project-1')})` }}>
          <div className="schedule-agenda-heading">
            <button className="schedule-agenda-check" role="checkbox" aria-checked={item.state === 'done'} aria-label={`${item.state === 'done' ? '取消完成' : '标记完成'}：${item.title}`} title={item.state === 'done' ? '取消完成' : '标记完成'} disabled={pendingId !== null} onClick={() => void toggle(item)}>{item.state === 'done' ? <Check size={13} /> : null}</button>{item.trip ? <TravelIcon kind={item.trip.kind} size={13} /> : null}
            <b>{name}</b><small>{item.state === 'done' ? '已完成' : item.trip ? (item.trip.cancelled ? `已取消${travelLabel(item)}` : item.trip.endedEarly ? `${travelLabel(item)}已结束` : travelLabel(item)) : pendingId === item.id ? '保存中…' : item.scheduleKind !== 'plan' ? '目标／截止' : ''}</small>
          </div>
          {error?.id === item.id ? <p className="schedule-state-error" role="alert" title={error.message}>{error.message}</p> : <p className="schedule-agenda-detail">{detail || '普通安排'}</p>}
        </article>
      })}
      {targets.map((item) => <article key={item.topicId} title={`选题目标日·${item.title}`}><div className="schedule-agenda-heading"><Flag size={12} /><b>选题目标日·{item.title}</b></div><p className="schedule-agenda-detail">选题目标，只读</p></article>)}
      {!items.length && !targets.length ? <p className="schedule-companion-empty">这一天暂无排期</p> : null}
    </section>
  </main>
}
