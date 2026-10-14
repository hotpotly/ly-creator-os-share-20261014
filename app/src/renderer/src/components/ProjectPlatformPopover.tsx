import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { AnchoredPopover } from './AnchoredPopover'
import { ProjectPlatformControl } from './ProjectPlatformControl'

export function ProjectPlatformPopover({ anchor, platforms, onChange, onClose }: {
  anchor: HTMLElement; platforms: string[]; onChange(platforms: string[]): Promise<void>; onClose(): void
}): React.JSX.Element {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = async (next: string[]): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await onChange(next) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '发布平台保存失败，请重试') }
    finally { pending.current = false; setBusy(false) }
  }
  return <AnchoredPopover anchor={anchor} ariaLabel="选择发布平台" className="project-platform-inline-popover" onDismiss={onClose}>
    <header><b>发布平台</b><button aria-label="关闭发布平台选择" onClick={onClose}><X size={14} /></button></header>

    <ProjectPlatformControl platforms={platforms} disabled={busy} onChange={next => void change(next)} />
    {busy ? <small role="status">正在保存…</small> : null}
    {error ? <p role="alert">{error}</p> : null}
  </AnchoredPopover>
}
