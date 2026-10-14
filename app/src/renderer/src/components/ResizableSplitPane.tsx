import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { clampHomeSplit, clampHomeSplitForWidth, homeSplitBoundsForWidth, HOME_SPLIT_DEFAULT, HOME_SPLIT_MAX, HOME_SPLIT_MIN } from '../utils/layout'

const STORAGE_KEY = 'ly.creator-os.home-split'

function readInitialSplit(): number {
  const raw = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? '')
  return Number.isFinite(raw) ? clampHomeSplit(raw) : HOME_SPLIT_DEFAULT
}

interface Props {
  left: ReactNode
  right: ReactNode
}

export function ResizableSplitPane({ left, right }: Props): React.JSX.Element {
  const preferenceSplit = useWorkspaceStore((state) => state.snapshot.preferences.homeSplit)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [split, setSplit] = useState(readInitialSplit)
  const splitRef = useRef(split)
  const [bounds, setBounds] = useState({ min: HOME_SPLIT_MIN, max: HOME_SPLIT_MAX })
  const containerRef = useRef<HTMLDivElement>(null)

  const update = (value: number): number => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0
    const next = window.innerWidth > 900 && width > 0 ? clampHomeSplitForWidth(value, width) : clampHomeSplit(value)
    setSplit(next)
    splitRef.current = next
    localStorage.setItem(STORAGE_KEY, String(next))
    return next
  }

  const persist = (value = splitRef.current): void => { void setPreferences({ homeSplit: value }) }

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== null) return
    const next = clampHomeSplit(preferenceSplit)
    setSplit(next); splitRef.current = next
  }, [preferenceSplit])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const syncBounds = (): void => {
      if (window.innerWidth <= 900) return
      const width = container.getBoundingClientRect().width
      const nextBounds = homeSplitBoundsForWidth(width)
      setBounds(nextBounds)
      const next = clampHomeSplitForWidth(split, width)
      if (Math.abs(next - split) > 0.01) {
        setSplit(next)
        splitRef.current = next
        localStorage.setItem(STORAGE_KEY, String(next))
      }
    }
    syncBounds()
    const observer = new ResizeObserver(syncBounds)
    observer.observe(container)
    return () => observer.disconnect()
  }, [split])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const divider = event.currentTarget
    divider.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing')
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    update(((event.clientX - rect.left) / rect.width) * 100)
  }

  const stopPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('is-resizing')
    persist()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: number
    if (event.key === 'ArrowLeft') next = update(split - 2)
    else if (event.key === 'ArrowRight') next = update(split + 2)
    else if (event.key === 'Home') next = update(HOME_SPLIT_DEFAULT)
    else return
    persist(next)
    event.preventDefault()
  }

  return (
    <div ref={containerRef} className="home-split" style={{ '--home-left': `${split}%` } as React.CSSProperties}>
      <div className="home-column home-column-primary">{left}</div>
      <div
        className="split-divider"
        role="separator"
        aria-label="调整首页左右栏宽度"
        aria-orientation="vertical"
        aria-valuemin={Math.round(bounds.min)}
        aria-valuemax={Math.round(bounds.max)}
        aria-valuenow={Math.round(split)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onLostPointerCapture={() => document.body.classList.remove('is-resizing')}
        onDoubleClick={() => persist(update(HOME_SPLIT_DEFAULT))}
        onKeyDown={onKeyDown}
      ><span /></div>
      <aside className="home-column home-column-secondary">{right}</aside>
    </div>
  )
}
