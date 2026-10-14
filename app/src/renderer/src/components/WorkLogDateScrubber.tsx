import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { addTodoDateDays } from '../../../shared/todo-date'

/** Scrubbing is confined to the date: number inputs retain their native behavior. */
export function WorkLogDateScrubber({ day, disabled, onChange }: { day: string; disabled: boolean; onChange(day: string): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; day: string } | null>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    let accumulated = 0, last = 0
    const wheel = (event: WheelEvent): void => {
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
      if (disabled || !delta || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(delta))) return
      event.preventDefault()
      if (event.timeStamp - last > 180) accumulated = 0
      last = event.timeStamp
      accumulated += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1)
      const steps = Math.trunc(accumulated / 48)
      if (steps) { accumulated -= steps * 48; onChange(addTodoDateDays(day, steps)) }
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [day, disabled, onChange])
  return <div className="work-log-date-nav">
    <button type="button" aria-label="前一天时长" disabled={disabled} onClick={() => onChange(addTodoDateDays(day, -1))}><ChevronLeft size={14} /></button>
    <div ref={ref} className="work-log-date-scrubber" role="group" tabIndex={disabled ? -1 : 0} aria-label="左右滑动切换时长日期" aria-disabled={disabled} title="左右拖动或双指横滑切换日期，也可使用左右方向键"
      onPointerDown={event => { if (disabled || event.button !== 0) return; event.currentTarget.focus(); drag.current = { x: event.clientX, day }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (!drag.current || disabled) return; onChange(addTodoDateDays(drag.current.day, Math.trunc((drag.current.x - event.clientX) / 44))) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => { if (!disabled && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); onChange(addTodoDateDays(day, event.key === 'ArrowLeft' ? -1 : 1)) } }}>
      <b aria-live="polite">{day.replaceAll('-', '/')}时长</b>
    </div>
    <button type="button" aria-label="后一天时长" disabled={disabled} onClick={() => onChange(addTodoDateDays(day, 1))}><ChevronRight size={14} /></button>
  </div>
}
