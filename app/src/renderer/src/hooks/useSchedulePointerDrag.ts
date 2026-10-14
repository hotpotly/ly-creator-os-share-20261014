import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent } from 'react'
import type { ScheduleItem } from '../../../shared/domain'
import { isCrossDaySchedule, moveScheduleToDate } from '../../../shared/schedule-range'

const dayKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const localDay = (key: string): Date => new Date(`${key}T12:00:00`)
type Destination = { date: string } | { inbox: true } | null
interface Options {
  contextKey: string
  getItem(id: string): ScheduleItem | undefined
  getLabel(item: ScheduleItem): string
  onStart(): void
  onMove(item: ScheduleItem, startAt: string | null, endAt: string | null): Promise<void>
  onError(error: unknown): void
}

/** Native-feeling local drag: no HTML screenshot, no writes until release, no touch-scroll interception. */
export function useSchedulePointerDrag(options: Options): {
  onPointerDownCapture(event: ReactPointerEvent<HTMLElement>): void
  onDragStartCapture(event: ReactDragEvent<HTMLElement>): void
} {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const session = useRef<{ cancel(): void } | null>(null)
  const saving = useRef(false)
  useEffect(() => () => session.current?.cancel(), [])
  useEffect(() => { session.current?.cancel() }, [options.contextKey])

  return {
    onDragStartCapture(event) { if (session.current) event.preventDefault() },
    onPointerDownCapture(event) {
      if (event.button !== 0 || event.pointerType === 'touch' || saving.current || session.current) return
      const target = event.target as Element
      if (target.closest('[data-schedule-resize-id]')) return
      const source = target.closest<HTMLElement>('[data-schedule-focus-id], [data-project-target-id], [data-schedule-inbox-id]')
      const id = source?.dataset.scheduleFocusId ?? source?.dataset.projectTargetId ?? source?.dataset.scheduleInboxId
      const item = id ? latest.current.getItem(id) : undefined
      if (!source || !item?.isMovable) return
      const root = event.currentTarget
      const sourceBox = source.getBoundingClientRect()
      const start = { x: event.clientX, y: event.clientY }
      let point = start
      const pointerId = event.pointerId
      const cells = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-calendar-date]')]
      const hitDate = (): string | undefined => cells().find(cell => {
        const b = cell.getBoundingClientRect()
        return point.x >= b.left && point.x < b.right && point.y >= b.top && point.y < b.bottom
      })?.dataset.calendarDate
      const grabDate = isCrossDaySchedule(item) ? hitDate() : undefined
      let active = false
      let ended = false
      let frame = 0
      let ghost: HTMLDivElement | null = null
      let caption: HTMLDivElement | null = null
      let destination: Destination = null
      let candidate: { startAt: string | null; endAt: string | null } | null = null
      const marks: HTMLElement[] = []
      const style = getComputedStyle(source)
      const width = Math.min(380, Math.max(170, sourceBox.width))
      const offsetX = Math.min(width - 12, Math.max(12, (start.x - sourceBox.left) / Math.max(1, sourceBox.width) * width))
      const offsetY = Math.min(18, start.y - sourceBox.top)
      let scroller: HTMLElement | null = root.parentElement
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement
      const clearMarks = (): void => {
        for (const element of marks.splice(0)) {
          delete element.dataset.scheduleDropRange; delete element.dataset.scheduleDropAnchor; delete element.dataset.scheduleDragSource
        }
      }
      const removeVisuals = (): void => {
        clearMarks(); ghost?.remove(); ghost = null
        document.body.classList.remove('schedule-moving')
      }
      const stop = (): void => {
        ended = true; cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('blur', cancel)
        window.removeEventListener('keydown', keydown, true)
        session.current = null
      }
      const cancel = (): void => { if (active) suppressClick(); stop(); removeVisuals() }
      const keydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { if (active) { e.preventDefault(); e.stopImmediatePropagation() }; cancel() }
      }
      const suppressClick = (): void => {
        const prevent = (e: MouseEvent): void => { e.preventDefault(); e.stopImmediatePropagation(); cleanup() }
        const cleanup = (): void => { window.removeEventListener('click', prevent, true); window.clearTimeout(timer) }
        const timer = window.setTimeout(cleanup, 350)
        window.addEventListener('click', prevent, true)
      }
      const paint = (): void => {
        if (!active || ended || !ghost || !caption) return
        // Keep the calendar still while moving; only the lifted item and landing range change.
        if (scroller && point.x >= scroller.getBoundingClientRect().left && point.x <= scroller.getBoundingClientRect().right) {
          const b = scroller.getBoundingClientRect(); const top = Math.max(0, b.top); const bottom = Math.min(innerHeight, b.bottom)
          if (point.y >= top && point.y < top + 30) scroller.scrollTop -= 7
          else if (point.y <= bottom && point.y > bottom - 30) scroller.scrollTop += 7
        }
        const inbox = root.querySelector<HTMLElement>('.unscheduled-inbox')
        const inboxBox = inbox?.getBoundingClientRect()
        const inInbox = inboxBox && point.x >= inboxBox.left && point.x < inboxBox.right && point.y >= inboxBox.top && point.y < inboxBox.bottom
        const date = hitDate()
        destination = inInbox ? { inbox: true } : date ? { date } : null
        candidate = destination ? 'inbox' in destination ? { startAt: null, endAt: null } : moveScheduleToDate(item, localDay(destination.date), grabDate) : null
        clearMarks()
        for (const element of root.querySelectorAll<HTMLElement>('[data-schedule-focus-id], [data-project-target-id], [data-schedule-inbox-id]')) {
          if ((element.dataset.scheduleFocusId ?? element.dataset.projectTargetId ?? element.dataset.scheduleInboxId) === item.id) { element.dataset.scheduleDragSource = 'true'; marks.push(element) }
        }
        if (candidate?.startAt) {
          const first = dayKey(new Date(candidate.startAt)); const last = candidate.endAt ? dayKey(new Date(candidate.endAt)) : first
          for (const cell of cells()) if (cell.dataset.calendarDate! >= first && cell.dataset.calendarDate! <= last) {
            cell.dataset.scheduleDropRange = 'true'; if (cell.dataset.calendarDate === date) cell.dataset.scheduleDropAnchor = 'true'; marks.push(cell)
          }
          const format = (key: string): string => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(localDay(key))
          caption.textContent = `${format(first)}${last !== first ? `—${format(last)}` : ''} · 松开移动`
        } else if (inInbox && inbox) { inbox.dataset.scheduleDropRange = 'true'; marks.push(inbox); caption.textContent = '移至未排期 · 松开确认' }
        else caption.textContent = '移到日期上 · Esc取消'
        ghost.dataset.valid = destination ? 'true' : 'false'
        ghost.style.transform = `translate3d(${Math.max(8, Math.min(innerWidth - width - 8, point.x - offsetX))}px, ${Math.max(8, Math.min(innerHeight - 66, point.y - offsetY - 3))}px, 0)`
        frame = requestAnimationFrame(paint)
      }
      const lift = (): void => {
        active = true; latest.current.onStart()
        ghost = document.createElement('div'); ghost.className = 'schedule-drag-preview'; ghost.style.width = `${width}px`
        ghost.setAttribute('aria-hidden', 'true')
        for (const name of ['--schedule-color', '--schedule-soft', '--schedule-text']) ghost.style.setProperty(name, style.getPropertyValue(name) || `var(--primary${name.endsWith('soft') ? '-soft' : ''})`)
        const label = document.createElement('div'); label.className = 'schedule-drag-preview-label'; label.textContent = latest.current.getLabel(item)
        if (item.actionType === 'publishing') label.classList.add('publishing')
        caption = document.createElement('div'); caption.className = 'schedule-drag-caption'
        ghost.append(label, caption); document.body.append(ghost); document.body.classList.add('schedule-moving')
        frame = requestAnimationFrame(paint)
      }
      const move = (e: PointerEvent): void => {
        if (e.pointerId !== pointerId) return
        point = { x: e.clientX, y: e.clientY }
        if (!active && Math.hypot(point.x - start.x, point.y - start.y) >= 5) lift()
        if (active) e.preventDefault()
      }
      const release = (e: PointerEvent): void => {
        if (e.pointerId !== pointerId) return
        if (!active) { cancel(); return }
        point = { x: e.clientX, y: e.clientY }; cancelAnimationFrame(frame); paint()
        const next = candidate
        stop(); suppressClick()
        if (!next || (next.startAt === item.startAt && next.endAt === item.endAt)) { removeVisuals(); return }
        saving.current = true
        if (caption) caption.textContent = '正在保存…'
        void latest.current.onMove(item, next.startAt, next.endAt).catch(error => latest.current.onError(error)).finally(() => {
          saving.current = false; removeVisuals()
          requestAnimationFrame(() => {
            for (const element of root.querySelectorAll<HTMLElement>('[data-schedule-focus-id], [data-project-target-id], [data-schedule-inbox-id]')) {
              if ((element.dataset.scheduleFocusId ?? element.dataset.projectTargetId ?? element.dataset.scheduleInboxId) !== item.id) continue
              element.animate([{ opacity: .45 }, { opacity: 1 }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-fast')) || 140 })
            }
          })
        })
      }
      session.current = { cancel }
      window.addEventListener('pointermove', move, { passive: false })
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('blur', cancel)
      window.addEventListener('keydown', keydown, true)
    }
  }
}
