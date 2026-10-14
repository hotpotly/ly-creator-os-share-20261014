import { useCallback, useEffect, useRef, useState } from 'react'

function isInspectorDrawerViewport(): boolean {
  return document.documentElement.clientWidth <= 1000
}

export function useInspectorDrawer(): {
  drawerOpen: boolean
  closeButtonRef: React.RefObject<HTMLButtonElement | null>
  openDrawer(trigger: HTMLElement): void
  closeDrawer(): void
} {
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const closeDrawer = useCallback((): void => {
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    const returnFocus = returnFocusRef.current
    returnFocusRef.current = null
    window.requestAnimationFrame(() => returnFocus?.focus())
  }, [])

  const openDrawer = useCallback((trigger: HTMLElement): void => {
    if (!isInspectorDrawerViewport()) return
    returnFocusRef.current = trigger
    openRef.current = true
    setOpen(true)
  }, [])

  useEffect(() => {
    const handleResize = (): void => {
      if (!isInspectorDrawerViewport()) {
        openRef.current = false
        returnFocusRef.current = null
        setOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeDrawer()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeDrawer, open])

  return {
    drawerOpen: open,
    closeButtonRef,
    openDrawer,
    closeDrawer
  }
}
