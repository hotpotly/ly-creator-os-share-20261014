import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AriaRole, CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'

const viewportGap = 8
const anchorGap = 5
const activePopoverStack: symbol[] = []
const focusTargetSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusReturnTarget(anchor: HTMLElement): HTMLElement {
  if (anchor.matches(focusTargetSelector)) return anchor
  return anchor.querySelector<HTMLElement>(focusTargetSelector) ?? anchor
}

interface AnchoredPopoverProps {
  anchor: HTMLElement | null
  anchorPoint?: { x: number; y: number } | null
  ariaLabel: string
  children: ReactNode
  className?: string
  onDismiss(): void
  role?: AriaRole
  style?: CSSProperties
}

interface PopoverPosition {
  left: number
  ready: boolean
  top: number
}

export function AnchoredPopover({ anchor, anchorPoint = null, ariaLabel, children, className = '', onDismiss, role = 'dialog', style }: AnchoredPopoverProps): React.JSX.Element | null {
  const popoverRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const stackTokenRef = useRef(Symbol(ariaLabel))
  const [position, setPosition] = useState<PopoverPosition>({ left: viewportGap, ready: false, top: viewportGap })

  const updatePosition = useCallback((): void => {
    if (!anchor || !popoverRef.current) return
    const anchorRect = anchorPoint
      ? { bottom: anchorPoint.y, left: anchorPoint.x, right: anchorPoint.x, top: anchorPoint.y }
      : anchor.getBoundingClientRect()
    const popoverRect = popoverRef.current.getBoundingClientRect()
    const availableWidth = Math.max(0, window.innerWidth - viewportGap * 2)
    const availableHeight = Math.max(0, window.innerHeight - viewportGap * 2)
    const popoverWidth = Math.min(popoverRect.width, availableWidth)
    const popoverHeight = Math.min(popoverRect.height, availableHeight)

    let left = anchorRect.left
    if (left + popoverWidth > window.innerWidth - viewportGap) left = anchorRect.right - popoverWidth
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - viewportGap - popoverWidth))

    let top = anchorRect.bottom + anchorGap
    const canOpenAbove = anchorRect.top - anchorGap - popoverHeight >= viewportGap
    if (top + popoverHeight > window.innerHeight - viewportGap && canOpenAbove) top = anchorRect.top - anchorGap - popoverHeight
    top = Math.max(viewportGap, Math.min(top, window.innerHeight - viewportGap - popoverHeight))

    setPosition({ left, ready: true, top })
  }, [anchor, anchorPoint])

  useLayoutEffect(() => {
    if (!anchor) return
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    const observer = new ResizeObserver(updatePosition)
    if (popoverRef.current) observer.observe(popoverRef.current)
    observer.observe(anchor)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchor, updatePosition])

  useLayoutEffect(() => {
    if (!anchor || role !== 'menu' || !position.ready || !popoverRef.current) return
    const popover = popoverRef.current
    const items = (): HTMLElement[] => Array.from(popover.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'))
    const frame = window.requestAnimationFrame(() => {
      if (!popover.contains(document.activeElement)) items()[0]?.focus()
    })
    const navigateMenu = (event: KeyboardEvent): void => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const available = items()
      if (!available.length) return
      event.preventDefault()
      const current = Math.max(0, available.indexOf(document.activeElement as HTMLElement))
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? available.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % available.length
            : (current - 1 + available.length) % available.length
      available[next]?.focus()
    }
    popover.addEventListener('keydown', navigateMenu)
    return () => {
      window.cancelAnimationFrame(frame)
      popover.removeEventListener('keydown', navigateMenu)
    }
  }, [anchor, position.ready, role])

  useEffect(() => {
    if (!anchor) return
    returnFocusRef.current = focusReturnTarget(anchor)
    const popover = popoverRef.current
    const token = stackTokenRef.current
    activePopoverStack.push(token)
    return () => {
      const index = activePopoverStack.lastIndexOf(token)
      if (index >= 0) activePopoverStack.splice(index, 1)
      const returnTarget = returnFocusRef.current
      window.requestAnimationFrame(() => {
        if (!returnTarget?.isConnected) return
        const active = document.activeElement
        if (active === document.body || active === document.documentElement || (active instanceof Node && popover?.contains(active))) returnTarget.focus()
      })
    }
  }, [anchor])

  useEffect(() => {
    if (!anchor) return
    const dismissFromOutside = (event: PointerEvent): void => {
      if (activePopoverStack.at(-1) !== stackTokenRef.current) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchor.contains(target) || popoverRef.current?.contains(target)) return
      onDismiss()
    }
    const dismissFromEscape = (event: KeyboardEvent): void => {
      if (activePopoverStack.at(-1) !== stackTokenRef.current) return
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onDismiss()
    }
    document.addEventListener('pointerdown', dismissFromOutside, true)
    window.addEventListener('keydown', dismissFromEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissFromOutside, true)
      window.removeEventListener('keydown', dismissFromEscape)
    }
  }, [anchor, onDismiss])

  if (!anchor) return null
  return createPortal(
    <section
      ref={popoverRef}
      className={`anchored-popover-layer ${className}`.trim()}
      role={role}
      aria-label={ariaLabel}
      style={{ ...style, left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
    >
      {children}
    </section>,
    anchor.closest('dialog[open]') ?? document.body
  )
}
