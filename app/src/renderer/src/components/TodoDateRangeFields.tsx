import { CalendarDays } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TodoDateRange } from '../../../shared/domain'
import { savedTodoDateRanges, todoDateRangeError, todoDateRangeKey, todoDateRangeLabel } from '../../../shared/todo-date'
import { useWorkspaceStore } from '../store/workspace'
import { AppSelect } from './AppSelect'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'

/** Shared date-range draft; no persistence occurs until the parent saves. */
export function TodoDateRangeFields({ value, onChange, defaultDay, disabled = false, singleLabel = '当前查看日期' }: {
  value: TodoDateRange | null
  onChange(value: TodoDateRange | null): void
  defaultDay: string
  disabled?: boolean
  singleLabel?: string
}): React.JSX.Element {
  const today = useWorkspaceStore(state => state.snapshot.today)
  const todos = useWorkspaceStore(state => state.snapshot.todos)
  const ranges = useMemo(() => savedTodoDateRanges(todos), [todos])
  const selectedKey = value ? todoDateRangeKey(value) : 'day'
  const selectedValue = value && !ranges.some(range => todoDateRangeKey(range) === selectedKey) ? 'range' : selectedKey
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const error = todoDateRangeError(value)
  return <div className="todo-date-range-fields">
    <label className="todo-range-mode"><span>安排到</span><AppSelect aria-label="待办安排方式" disabled={disabled} value={selectedValue} renderOption={option => {
      const range = ranges.find(range => todoDateRangeKey(range) === option.value)
      return range ? <span className="todo-range-option"><span>{range.name || '日期范围'}</span><small>{todoDateRangeLabel(range)}</small></span> : option.label
    }} onChange={event => {
      setAnchor(null)
      const key = event.currentTarget.value
      const saved = ranges.find(range => todoDateRangeKey(range) === key)
      onChange(saved ? { ...saved } : key === 'range' ? { startDate: defaultDay, endDate: defaultDay, name: '' } : null)
    }}><option value="day">{singleLabel}</option><option value="range">自定义日期范围</option>{ranges.map(range => <option key={todoDateRangeKey(range)} value={todoDateRangeKey(range)}>{range.name || '日期范围'} · {todoDateRangeLabel(range)}</option>)}</AppSelect></label>
    {value ? <>
      <div className="todo-range-dates">
        <label><span>开始日期</span><input type="date" aria-label="范围开始日期" disabled={disabled} value={value.startDate} onChange={event => onChange({ ...value, startDate: event.currentTarget.value })} /></label>
        <label><span>结束日期</span><input type="date" aria-label="范围结束日期" disabled={disabled} min={value.startDate} value={value.endDate} onChange={event => onChange({ ...value, endDate: event.currentTarget.value })} /></label>
        <button type="button" aria-label="从日历选择日期范围" disabled={disabled} onClick={event => setAnchor(anchor ? null : event.currentTarget)}><CalendarDays size={14} /></button>
      </div>
      <label className="todo-range-name"><span>名称（可选）</span><input aria-label="日期范围名称" maxLength={60} placeholder="不填则显示日期范围" disabled={disabled} value={value.name} onChange={event => onChange({ ...value, name: event.currentTarget.value })} /></label>
      {error ? <p role="alert" className="todo-context-error">{error}</p> : null}
    </> : null}
    {anchor && value ? <AnchoredPopover anchor={anchor} ariaLabel="选择待办日期范围" className="todo-date-popover modal-calendar-popover" onDismiss={() => setAnchor(null)}>
      <CalendarDatePicker label="待办日期范围" today={today} value={value.startDate || defaultDay} clearable={false}
        rangeSelection={{ end: value.endDate || value.startDate || defaultDay, onChange: (startDate, endDate) => onChange({ ...value, startDate, endDate }) }}
        onChange={day => { if (day) onChange({ ...value, startDate: day, endDate: day }) }} />
      <button type="button" className="todo-range-calendar-done" onClick={() => setAnchor(null)}>确定</button>
    </AnchoredPopover> : null}
  </div>
}
