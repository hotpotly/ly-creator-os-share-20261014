import { layoutReviewChartDates } from '../../../../shared/review-chart-dates'
import { dailyWorkTone } from '../../../../shared/daily-work-log'
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReviewData } from '../../../../shared/personal-review'
import type { ScheduleItem } from '../../../../shared/domain'
import { TRAVEL_KINDS, TRAVEL_KIND_LABELS } from '../../../../shared/business-trip'
import { travelDayHighlight, travelToneLabel } from '../../../../shared/travel-day'

function duration(minutes: number | null): string {
  if (minutes === null) return '未记录'
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return `${hours}小时${rest ? `${rest}分钟` : ''}`
}
export function ReviewHoursChart({ logs, schedules, onOpenDay }: { logs: ReviewData['logs']; schedules: ScheduleItem[]; onOpenDay?: (day: string) => void }): React.JSX.Element {
  const [selected, setSelected] = useState(0), [focused, setFocused] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const points = useRef<Array<HTMLButtonElement | null>>([]), plot = useRef<HTMLDivElement>(null), tooltip = useRef<HTMLOutputElement>(null)
  const tooltipId = useId()
  const [plotWidth, setPlotWidth] = useState(0)
  useLayoutEffect(() => {
    const frame = plot.current
    if (!frame) return
    const measure = (): void => setPlotWidth(frame.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure); observer.observe(frame)
    return () => observer.disconnect()
  }, [])
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false })
  const maximum = Math.max(8, Math.ceil(Math.max(0, ...logs.map(log => log.minutes ?? 0)) / 240) * 4)
  const ticks = [maximum, maximum * .75, maximum * .5, maximum * .25, 0]
  const active = hovered ?? focused, current = active === null ? undefined : logs[active]
  const travel = useMemo(() => logs.map(log => travelDayHighlight(schedules, log.day)), [logs, schedules])
  const currentTravel = active === null ? undefined : travel[active]
  useLayoutEffect(() => {
    if (active === null || !current || !plot.current || !tooltip.current) return
    const reposition = (): void => {
      const point = points.current[active], bubble = tooltip.current, frame = plot.current
      if (!point || !bubble || !frame) return
      const bar = point.firstElementChild!.getBoundingClientRect(), bounds = frame.getBoundingClientRect()
      const pointBounds = point.getBoundingClientRect(), viewport = point.closest('.page')!.getBoundingClientRect()
      const width = Math.min(152, bounds.width), height = bubble.offsetHeight
      const left = Math.max(bounds.left, Math.min(bounds.right - width, bar.left + bar.width / 2 - width / 2))
      const top = Math.min(innerHeight - height - 8, Math.max(viewport.top + 8, bar.top - height - 8))
      setPosition({ left, top, visible: pointBounds.bottom > viewport.top && pointBounds.top < viewport.bottom })
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    observer.observe(plot.current)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [active, current, currentTravel?.tone])
  const barHeight = (minutes: number | null): number => Math.max(3, (minutes ?? 0) / (maximum * 60) * 100)
  const dates = layoutReviewChartDates(travel.map(day => day?.tone), plotWidth, active)
  return <div className="review-chart" role="group" aria-label="每日工作投入">
    <div className="review-chart-legend" aria-label="工时图例"><span><i />工作</span>{TRAVEL_KINDS.map(kind => <span key={kind} className={`travel-surface-${kind}`}><i />{TRAVEL_KIND_LABELS[kind]}</span>)}</div>
    <div className="review-chart-unit">小时</div>
    <div className="review-chart-frame">
      <div className="review-chart-axis" aria-hidden="true">{ticks.map(tick => <span key={tick}>{tick}</span>)}</div>
      <div ref={plot} className="review-chart-plot" onMouseLeave={() => setHovered(null)}>
        <div className="review-chart-grid" aria-hidden="true">{ticks.map(tick => <i key={tick} />)}</div>
        <div className="review-chart-points">{logs.map((log, index) => <button
          type="button" key={log.day} ref={element => { points.current[index] = element }}
          className={travel[index] ? `travel-surface-${travel[index].tone}` : undefined} data-travel-kind={travel[index]?.tone}
          aria-label={`${log.day}：${duration(log.minutes)}${travel[index] ? ` · ${travelToneLabel(travel[index].tone)}` : ''}`} aria-pressed={focused === index} aria-describedby={active === index ? tooltipId : undefined}
          tabIndex={selected === index ? 0 : -1} data-day={log.day} title={onOpenDay ? `编辑${log.day}记录` : undefined}
          data-active={active === index} data-missing={log.minutes === null}
          onMouseEnter={() => setHovered(index)} onFocus={() => { setHovered(null); setSelected(index); setFocused(index) }}
          onBlur={() => setFocused(null)} onClick={() => { setSelected(index); setFocused(index); onOpenDay?.(log.day) }}
          onKeyDown={event => {
            if (event.key === 'Escape') { setFocused(null); setHovered(null); return }
            const next = event.key === 'ArrowRight' ? Math.min(logs.length - 1, index + 1) : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? logs.length - 1 : -1
            if (next < 0) return
            event.preventDefault(); setSelected(next); points.current[next]?.focus()
          }}
        ><span className="review-chart-bar" style={{ height: `${barHeight(log.minutes)}%` }} data-zero={log.minutes === 0} /></button>)}</div>
        {current && active !== null && createPortal(<output ref={tooltip} id={tooltipId} className="review-chart-readout" aria-live="polite" aria-label="每日工时读数" data-day={current.day}
          style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}>
          <time dateTime={current.day}>{current.day}</time><strong data-work-tone={dailyWorkTone(current.minutes)}>{duration(current.minutes)}</strong>{currentTravel && <span>{travelToneLabel(currentTravel.tone)}</span>}
        </output>, document.body)}
      </div>
      <div className="review-chart-dates" onMouseLeave={() => setHovered(null)}>{dates.map(({ index, center }) => { const log = logs[index]!; return <button key={log.day} type="button" tabIndex={-1}
        className={`review-chart-date${travel[index] ? ` travel-surface-${travel[index].tone}` : ''}`} data-day={log.day} data-travel-kind={travel[index]?.tone}
        style={{ left: center }} aria-label={`查看${log.day}：${duration(log.minutes)}${travel[index] ? ` · ${travelToneLabel(travel[index].tone)}` : ''}`} title={travel[index]?.label}
        onMouseEnter={() => setHovered(index)} onFocus={() => { setSelected(index); setFocused(index) }} onBlur={() => setFocused(null)} onClick={() => onOpenDay?.(log.day)}
      >{Number(log.day.slice(8))}</button> })}</div>
    </div>
  </div>
}
