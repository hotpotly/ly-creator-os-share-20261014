import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { StructuredReferenceUse } from '../../../../../shared/domain'
import { composerBlockingReferences, composerPendingReferences } from './structured-reference-composer-state'

export function ReferencePreflightNotice({ references, onUseOrdinaryFallback, onLocate }: {
  references: StructuredReferenceUse[]
  onUseOrdinaryFallback(): void
  onLocate(occurrenceId: string): void
}): React.JSX.Element | null {
  const blocking = composerBlockingReferences(references)
  const pending = composerPendingReferences(references)
  if (!blocking.length && !pending.length) return null
  if (blocking.length) return <div className="reference-preflight-notice is-blocking" role="alert">
    <AlertTriangle size={14} />
    <span><b>{blocking.length}个引用用途存在冲突</b><small>请先决定按文字识别还是按本次手动设置。</small></span>
    <button onClick={() => onLocate(blocking[0]!.occurrenceId)}>处理冲突<ArrowRight size={12} /></button>
  </div>
  return <div className="reference-preflight-notice" role="status">
    <AlertTriangle size={14} />
    <span><b>{pending.length}个引用用途待定</b><small>不会静默猜测；可以逐个设置，或仅本轮按普通参考继续。</small></span>
    <button onClick={onUseOrdinaryFallback}>本轮按普通参考继续</button>
  </div>
}
