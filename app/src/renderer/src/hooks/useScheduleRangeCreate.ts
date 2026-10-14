import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Empty month cells only. Moving existing events and native touch scrolling keep their own gestures. */
export function useScheduleRangeCreate(contextKey: string, onCreate: (start: string, end: string) => void): (event: ReactPointerEvent<HTMLElement>) => void {
  const callback = useRef(onCreate)
  useLayoutEffect(() => { callback.current = onCreate })
  const session = useRef<(() => void) | null>(null)
  useEffect(() => () => session.current?.(), [])
  useEffect(() => { session.current?.() }, [contextKey])
  return (event) => {
    if (event.button !== 0 || event.ctrlKey || event.pointerType === 'touch' || session.current) return
    const target = event.target as Element
    if (target.closest('button, input, select, textarea, a, [role="button"], [draggable="true"], [data-schedule-focus-id], [data-project-target-id]')) return
    const cell = target.closest<HTMLElement>('.month-day[data-calendar-date]')
    const root = cell?.closest('.month-grid') ?? cell?.closest('.schedule-card')
    if (!cell || !root) return
    const cells = [...root.querySelectorAll<HTMLElement>('.month-day[data-calendar-date]')]
    const origin = cell.dataset.calendarDate!
    const pointerId = event.pointerId
    const x = event.clientX, y = event.clientY
    let active = false
    let range: [string, string] | null = null
    const clear = (): void => { for (const item of cells) { delete item.dataset.createRange; delete item.dataset.createStart; delete item.dataset.createEnd } }
    const stop = (): void => {
      clear(); document.body.classList.remove('schedule-selecting')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      session.current = null
    }
    const suppressClick = (): void => {
      const prevent = (e: MouseEvent): void => { e.preventDefault(); e.stopImmediatePropagation(); cleanup() }
      const cleanup = (): void => { window.removeEventListener('click', prevent, true); clearTimeout(timer) }
      const timer = window.setTimeout(cleanup, 350)
      window.addEventListener('click', prevent, true)
    }
    const cancel = (): void => { if (active) suppressClick(); stop() }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel() } }
    const update = (e: PointerEvent): void => {
      clear()
      const hit = cells.find((item) => { const b = item.getBoundingClientRect(); return e.clientX >= b.left && e.clientX < b.right && e.clientY >= b.top && e.clientY < b.bottom })
      const end = hit?.dataset.calendarDate
      range = end ? (origin <= end ? [origin, end] : [end, origin]) : null
      if (range) cells.forEach((item, index) => {
        const date = item.dataset.calendarDate!
        if (date < range![0] || date > range![1]) return
        item.dataset.createRange = 'true'
        if (date === range![0] || index % 7 === 0) item.dataset.createStart = 'true'
        if (date === range![1] || index % 7 === 6) item.dataset.createEnd = 'true'
      })
    }
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      if (!active && Math.hypot(e.clientX - x, e.clientY - y) < 6) return
      active = true; e.preventDefault(); document.body.classList.add('schedule-selecting'); update(e)
    }
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      if (active) { update(e); suppressClick() }
      const result = active ? range : null
      stop()
      if (result) callback.current(...result)
    }
    session.current = cancel
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
  }
}
