import { AlertTriangle, ListPlus, Check, RefreshCw, Replace, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { lineDiff } from '../../../../../shared/text-diff'
import { markdownToReadableText } from '../../../components/ReadableMarkdown'
import type { RewriteCandidateViewModel } from './selection-contract'

interface Props {
  candidate: RewriteCandidateViewModel | null
  remainingCount?: number
  onClose(): void
  onContinue(): void
  onAppend(): void
  onReplace(): void
}

const conflictLabels = { fact: '事实冲突', brief: 'Brief冲突', real_experience: '真实体验冲突' } as const

export function RewriteCandidateDialog({ candidate, remainingCount = 0, onClose, onContinue, onAppend, onReplace }: Props): React.JSX.Element | null {
  const dialogRef = useRef<HTMLElement>(null)
  const [confirmedCandidateId, setConfirmedCandidateId] = useState<string | null>(null)
  const originalText = useMemo(() => candidate ? markdownToReadableText(candidate.originalText) : '', [candidate])
  const candidateText = useMemo(() => candidate ? markdownToReadableText(candidate.candidateText) : '', [candidate])
  const diff = useMemo(() => lineDiff(originalText, candidateText), [candidateText, originalText])
  useEffect(() => {
    if (!candidate) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus())
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>([
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"]):not([disabled])'
      ].join(','))).filter((control) => !control.closest('[hidden],[aria-hidden="true"]'))
      if (!controls.length) return
      const first = controls[0]!, last = controls.at(-1)!
      if (!controls.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', keydown, true)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); previous?.focus() }
  }, [candidate, onClose])
  if (!candidate) return null
  const conflictsConfirmed = confirmedCandidateId === candidate.id
  const conflictsPending = candidate.conflicts.length > 0 && !conflictsConfirmed
  const appendBlocked = candidate.targetChanged || conflictsPending
  const replacementBlocked = appendBlocked || Boolean(candidate.replaceUnavailableReason)
  const fusion = candidate.mode === 'fusion'
  const applyBlockedTitle = candidate.targetChanged
    ? '原目标已变化，请重新选择后再应用'
    : conflictsPending ? '请先明确确认来源冲突' : undefined
  return createPortal(<div className="rewrite-candidate-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="rewrite-candidate-dialog" role="dialog" aria-modal="true" aria-label="局部改写候选" tabIndex={-1}>
      <header><div><span>{fusion ? '多来源统一候选' : '局部改写候选'}·第{candidate.generationRound}轮{remainingCount > 0 ? `·还有${remainingCount}项` : ''}</span><h3>{fusion ? '核对多来源输入，再决定是否采用统一候选' : '先看差异，再决定如何使用'}</h3><p>{candidate.providerLabel}·{candidate.actualModel ?? candidate.requestedModel ?? '自动选择'}{candidate.actualReasoningEffort ? `·${candidate.actualReasoningEffort}` : ''}</p></div><button aria-label="关闭候选" onClick={onClose}><X size={15} /></button></header>
      <div className="rewrite-candidate-columns"><article tabIndex={0} aria-label={fusion ? '冻结的多来源输入' : '原内容'}><span>{fusion ? '冻结的多来源输入' : '原内容'}</span><p>{originalText}</p></article><article tabIndex={0} aria-label={fusion ? '统一候选' : '新候选'}><span>{fusion ? '统一候选' : '新候选'}</span><p>{candidateText}</p></article></div>
      <div className="rewrite-inline-diff" tabIndex={0} aria-label={fusion ? '多来源输入与统一候选差异' : '原文与候选差异'}>{diff.map((part, index) => <div key={`${part.kind}-${index}`} className={part.kind}><i>{part.kind === 'added' ? '+' : part.kind === 'removed' ? '−' : '·'}</i><span>{part.text}</span></div>)}</div>
      {candidate.conflicts.length ? <section className="rewrite-conflicts" aria-label="来源冲突"><header><AlertTriangle size={14} /><b>有冲突，需要你决定</b></header>{candidate.conflicts.map((conflict) => <article key={conflict.id}><span>{conflictLabels[conflict.kind]}</span><p>{conflict.summary}</p>{conflict.sourceExcerpts.map((excerpt, index) => {
        const selectionId = conflict.sourceSelectionIds[index]
        const source = candidate.sourceSelections.find((selection) => selection.selectionId === selectionId)
        return <blockquote key={`${selectionId ?? 'source'}-${index}`}><b>{source?.sourceLabel ?? `来源${index + 1}`}</b><span>{excerpt}</span></blockquote>
      })}</article>)}<label className="rewrite-conflict-confirm"><input type="checkbox" checked={conflictsConfirmed} onChange={(event) => setConfirmedCandidateId(event.currentTarget.checked ? candidate.id : null)} /><span><b>我已看过上述冲突</b><small>仍按当前候选追加或替换，不代表系统自动取舍</small></span></label></section> : null}
      {candidate.targetChanged ? <p className="rewrite-target-warning"><AlertTriangle size={13} />原目标已变化，请重新选择后再追加或替换。</p> : null}
      {candidate.replaceUnavailableReason && !candidate.targetChanged ? <p className="rewrite-target-note"><AlertTriangle size={13} />{candidate.replaceUnavailableReason}</p> : null}
      <footer><button onClick={onClose}><Check size={13} />保留候选</button><button onClick={onContinue}><RefreshCw size={13} />继续修改</button><button disabled={appendBlocked} title={applyBlockedTitle} onClick={onAppend}><ListPlus size={13} />追加</button><button className="primary-action" disabled={replacementBlocked} title={candidate.replaceUnavailableReason ?? applyBlockedTitle} onClick={onReplace}><Replace size={13} />替换</button></footer>
    </section>
  </div>, document.body)
}
