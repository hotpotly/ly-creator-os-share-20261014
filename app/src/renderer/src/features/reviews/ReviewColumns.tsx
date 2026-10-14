import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ResizableInspectorDivider } from '../../components/ResizableInspectorDivider'

function readWidths(key: string): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 240 && v <= 2000) ? value : []
  } catch { return [] }
}
export function ReviewColumns({ first, second, third, variant = 'overview' }: { first: ReactNode; second: ReactNode; third: ReactNode; variant?: 'overview' | 'writing' }): React.JSX.Element {
  const key = variant === 'overview' ? 'ly.review.column-widths' : 'ly.review.writing-column-widths'
  const labels = variant === 'overview' ? ['目标与打卡', '工作投入'] : ['自由复盘', '生活记录']
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000), [saved, setSaved] = useState(() => readWidths(key))
  useLayoutEffect(() => {
    const el = root.current!
    const sync = (): void => setWidth(el.clientWidth)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const available = Math.max(760, width - 24)
  const ratios = variant === 'overview' ? [.29, .31] : [1 / 3, 1 / 3]
  const left = Math.min(Math.max(240, saved[0] ?? available * ratios[0]!), available - 500)
  const middle = Math.min(Math.max(240, saved[1] ?? available * ratios[1]!), available - left - 260)
  const commit = (index: number, value: number): void => {
    const next = [left, middle]
    next[index] = value
    setSaved(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Layout preferences do not affect saved records. */ }
  }
  return <div ref={root} className={`review-top-grid review-columns review-columns-${variant}`} style={{ '--review-first-width': `${left}px`, '--review-second-width': `${middle}px` } as CSSProperties}>
    <div className={variant === 'overview' ? 'review-goals-column' : 'review-writing-column'}>{first}</div>
    <ResizableInspectorDivider className="review-column-divider" ariaLabel={`调整${labels[0]}栏宽度`} width={left} defaultWidth={available * ratios[0]!} minWidth={240} maxWidth={Math.max(240, available - middle - 260)} cssVariable="--review-first-width" side="left" onCommit={value => commit(0, value)} />
    {second}
    <ResizableInspectorDivider className="review-column-divider" ariaLabel={`调整${labels[1]}栏宽度`} width={middle} defaultWidth={available * ratios[1]!} minWidth={240} maxWidth={Math.max(240, available - left - 260)} cssVariable="--review-second-width" side="left" onCommit={value => commit(1, value)} />
    {third}
  </div>
}
