import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'

interface CalendarDatePickerProps {
  label: string
  today: string
  value: string | null
  hasItems?: (day: string) => boolean
  renderDayContent?: (day: string) => ReactNode
  dayHighlight?: (day: string) => { tone: string; label: string } | undefined
  daySummary?: (day: string) => string
  clearable?: boolean
  fixedWeeks?: boolean
  min?: string | null
  max?: string | null
  rangeSelection?: { end: string; disabled?: boolean; onChange(start: string, end: string): void }
  onChange(value: string | null): void
}

const weekLabels = ['一', '二', '三', '四', '五', '六', '日']

function parseDateKey(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function dateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fullDateLabel(value: string): string {
  const date = parseDateKey(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function calendarCells(year: number, month: number, fixedWeeks: boolean): Date[] {
  const first = new Date(year, month, 1, 12)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - mondayOffset, 12)
  const count = fixedWeeks ? 42 : Math.ceil((mondayOffset + new Date(year, month + 1, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12))
}

export function CalendarDatePicker({ rangeSelection, fixedWeeks = true, renderDayContent, dayHighlight, daySummary, hasItems, clearable = true, label, min = null, max = null, onChange, today, value }: CalendarDatePickerProps): React.JSX.Element {
  const initial = parseDateKey(value ?? today)
  const [visibleMonth, setVisibleMonth] = useState(() => ({ month: initial.getMonth(), year: initial.getFullYear() }))
  const cells = useMemo(() => calendarCells(visibleMonth.year, visibleMonth.month, fixedWeeks), [visibleMonth, fixedWeeks])
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ anchor: string; end: string; previousAnchor: string; pointerId: number } | null>(null)
  const rangeAnchor = useRef(value ?? today)
  const [draftRange, setDraftRange] = useState<[string, string] | null>(null)
  const ordered = (a: string, b: string): [string, string] => a <= b ? [a, b] : [b, a]
  const range = rangeSelection ? draftRange ?? ordered(value ?? today, rangeSelection.end) : null
  const cancelDrag = (): void => {
    if (!drag.current) return
    rangeAnchor.current = drag.current.previousAnchor
    drag.current = null; setDraftRange(null)
  }
  const selectRange = (key: string, extend: boolean): void => {
    if (!rangeSelection || rangeSelection.disabled) return
    if (!extend) rangeAnchor.current = key
    rangeSelection.onChange(...ordered(rangeAnchor.current, key))
  }
  const moveMonth = (offset: number): void => {
    const next = new Date(visibleMonth.year, visibleMonth.month + offset, 1, 12)
    setVisibleMonth({ month: next.getMonth(), year: next.getFullYear() })
  }
  const todayDisabled = Boolean((min && today < min) || (max && today > max))

  return <div className={`calendar-date-picker${rangeSelection ? ' calendar-range-picker' : ''}`} onKeyDownCapture={event => {
    if (event.key === 'Escape' && drag.current) { cancelDrag(); event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() }
  }}>
    <div className="calendar-date-value">
      <span><CalendarDays size={14} />{label}</span>
      <b>{value ? fullDateLabel(value) : '未设置'}</b>
      {value && clearable ? <button type="button" aria-label={`清除${label}`} onClick={() => onChange(null)}><X size={13} /></button> : null}
    </div>
    <header className="calendar-date-header">
      <b>{visibleMonth.year}年{visibleMonth.month + 1}月</b>
      <button type="button" disabled={todayDisabled || rangeSelection?.disabled} onClick={() => { const date = parseDateKey(today); setVisibleMonth({ year: date.getFullYear(), month: date.getMonth() }); if (rangeSelection) selectRange(today, false); else onChange(today) }}>今天</button>
      <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={15} /></button>
      <button type="button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={15} /></button>
    </header>
    <div className="calendar-weekdays" aria-hidden="true">{weekLabels.map((item) => <span key={item}>{item}</span>)}</div>
    <div ref={gridRef} className="calendar-date-grid" role="grid" aria-label={`${label}日历`} title={rangeSelection ? '拖动选择连续日期；Shift+点击或Shift+回车选择到另一日期，可翻月' : undefined} onPointerMove={event => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointerId) return
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-range-date]')
      if (!cell || !gridRef.current?.contains(cell) || cell.disabled) return
      current.end = cell.dataset.rangeDate!
      setDraftRange(ordered(current.anchor, current.end))
    }} onPointerUp={event => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointerId) return
      drag.current = null; setDraftRange(null)
      rangeSelection?.onChange(...ordered(current.anchor, current.end))
    }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
      {cells.map((date) => {
        const key = dateKey(date)
        const selected = range ? key === range[0] || key === range[1] : key === value
        const inRange = range && key >= range[0] && key <= range[1]
        const isToday = key === today
        const outside = date.getMonth() !== visibleMonth.month
        const disabled = Boolean(rangeSelection?.disabled || (min && key < min) || (max && key > max))
        const highlight = dayHighlight?.(key)
        const summary = [daySummary?.(key), highlight?.label].filter(Boolean).join('；')
        return <button
          type="button"
          className={`${outside ? 'outside' : ''} ${isToday ? 'today' : ''} ${selected ? 'selected' : ''} ${inRange ? 'in-range' : ''} ${hasItems?.(key) ? 'has-items' : ''}`.trim()}
          aria-current={isToday ? 'date' : undefined}
          aria-label={`${isToday ? '今天，' : ''}选择${fullDateLabel(key)}${summary ? `，${summary}` : hasItems?.(key) ? '，有排期' : ''}`}
          title={summary || undefined}
          aria-pressed={Boolean(inRange || selected)}
          disabled={disabled}
          key={key}
          data-range-date={rangeSelection ? key : undefined}
          onPointerDown={event => {
            if (!rangeSelection || disabled || event.button !== 0) return
            const previousAnchor = rangeAnchor.current
            if (!event.shiftKey) rangeAnchor.current = key
            drag.current = { anchor: rangeAnchor.current, end: key, previousAnchor, pointerId: event.pointerId }
            setDraftRange(ordered(rangeAnchor.current, key))
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onKeyDown={event => {
            if (rangeSelection && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectRange(key, event.shiftKey) }
          }}
          onClick={event => { if (!rangeSelection) onChange(key); else if (event.detail === 0) selectRange(key, event.shiftKey) }}
          role="gridcell"
        >
          <span className="calendar-date-number" data-travel-tone={highlight?.tone}>{date.getDate()}</span>{isToday ? <small>今</small> : null}{selected ? <Check size={10} /> : null}{renderDayContent?.(key)}
        </button>
      })}
    </div>
  </div>
}
