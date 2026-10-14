import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

const INSPECTOR_WIDTH_DEFAULT = 310
const INSPECTOR_WIDTH_MIN = 240
const INSPECTOR_WIDTH_MAX = 520

function clampPanelWidth(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function ResizableInspectorDivider({
  width,
  ariaLabel,
  onCommit,
  onError,
  className = '',
  cssVariable = '--inspector-width',
  defaultWidth = INSPECTOR_WIDTH_DEFAULT,
  minWidth = INSPECTOR_WIDTH_MIN,
  maxWidth = INSPECTOR_WIDTH_MAX,
  side = 'right'
}: {
  width: number
  ariaLabel: string
  onCommit(width: number): unknown | Promise<unknown>
  onError?(message: string): void
  className?: string
  cssVariable?: `--${string}`
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  side?: 'left' | 'right'
}): React.JSX.Element {
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const currentWidth = draftWidth ?? clampPanelWidth(width, minWidth, maxWidth)
  const currentWidthRef = useRef(currentWidth)
  currentWidthRef.current = currentWidth
  const dragStartRef = useRef<{ x: number; width: number } | null>(null)
  const dividerRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => {
    dragStartRef.current = null
    document.body.classList.remove('is-inspector-resizing')
  }, [])

  const update = (divider: HTMLDivElement, value: number): number => {
    const next = clampPanelWidth(value, minWidth, maxWidth)
    setDraftWidth(next)
    currentWidthRef.current = next
    divider.parentElement?.style.setProperty(cssVariable, `${next}px`)
    return next
  }

  const commit = async (value: number): Promise<void> => {
    try {
      await onCommit(value)
    } catch (cause) {
      dividerRef.current?.parentElement?.style.setProperty(cssVariable, `${clampPanelWidth(width, minWidth, maxWidth)}px`)
      onError?.(cause instanceof Error ? cause.message : '右侧详情宽度保存失败')
    } finally {
      setDraftWidth(null)
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    dragStartRef.current = { x: event.clientX, width: currentWidthRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('is-inspector-resizing')
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !dragStartRef.current) return
    const delta = event.clientX - dragStartRef.current.x
    update(event.currentTarget, dragStartRef.current.width + (side === 'left' ? delta : -delta))
  }

  const stopPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragStartRef.current = null
    document.body.classList.remove('is-inspector-resizing')
    void commit(currentWidthRef.current)
  }

  const lostPointerCapture = (): void => {
    const interrupted = dragStartRef.current !== null
    dragStartRef.current = null
    document.body.classList.remove('is-inspector-resizing')
    if (interrupted) void commit(currentWidthRef.current)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 16
    let next: number
    if (event.key === 'ArrowLeft') next = update(event.currentTarget, currentWidthRef.current + (side === 'right' ? step : -step))
    else if (event.key === 'ArrowRight') next = update(event.currentTarget, currentWidthRef.current + (side === 'left' ? step : -step))
    else if (event.key === 'Home') next = update(event.currentTarget, defaultWidth)
    else return
    event.preventDefault()
    void commit(next)
  }

  return <div
    ref={dividerRef}
    className={`inspector-divider ${className}`.trim()}
    role="separator"
    aria-label={ariaLabel}
    aria-orientation="vertical"
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    aria-valuenow={currentWidth}
    tabIndex={0}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={stopPointer}
    onPointerCancel={stopPointer}
    onLostPointerCapture={lostPointerCapture}
    onDoubleClick={(event) => void commit(update(event.currentTarget, defaultWidth))}
    onKeyDown={onKeyDown}
  ><span /></div>
}
