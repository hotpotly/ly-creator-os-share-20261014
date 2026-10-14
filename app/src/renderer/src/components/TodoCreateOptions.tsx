import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import type { TodoDateRange } from '../../../shared/domain'
import { todoDateRangeLabel } from '../../../shared/todo-date'
import { AnchoredPopover } from './AnchoredPopover'
import { TodoDateRangeFields } from './TodoDateRangeFields'

export function TodoCreateOptions({ extra, onExtraChange, dateRange, onDateRangeChange, day, dayLabel, disabled }: {
  extra: boolean
  onExtraChange(value: boolean): void
  dateRange: TodoDateRange | null
  onDateRangeChange(value: TodoDateRange | null): void
  day: string
  dayLabel: string
  disabled: boolean
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const label = dateRange ? todoDateRangeLabel(dateRange) : dayLabel
  return <div className="todo-create-options">
    <label className="todo-create-extra"><input type="checkbox" checked={extra} disabled={disabled} onChange={event => onExtraChange(event.target.checked)} />额外</label>
    <button type="button" className={dateRange ? 'active' : ''} aria-label={`新建待办日期：${label}`} title={label} aria-expanded={Boolean(anchor)} disabled={disabled} onClick={event => setAnchor(anchor ? null : event.currentTarget)}><CalendarDays size={14} /></button>
    {anchor ? <AnchoredPopover anchor={anchor} ariaLabel="新建待办日期设置" className="todo-create-date-popover" onDismiss={() => setAnchor(null)}>
      <TodoDateRangeFields value={dateRange} onChange={onDateRangeChange} defaultDay={day} disabled={disabled} singleLabel={dayLabel} />
      <button type="button" className="todo-range-calendar-done" onClick={() => setAnchor(null)}>确定</button>
    </AnchoredPopover> : null}
  </div>
}
