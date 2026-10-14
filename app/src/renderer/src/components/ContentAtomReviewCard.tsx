import { Check, GitMerge, RotateCcw, ShieldCheck, X } from 'lucide-react'
import type { ContentAtomRecord } from '../../../shared/domain'

const atomTypeLabels: Record<ContentAtomRecord['atomType'], string> = {
  story: '故事', method: '方法', viewpoint: '观点', comparison: '对比', pitfall: '踩坑', verifiable_fact: '可验证事实'
}
const statusLabels: Record<ContentAtomRecord['status'], string> = { review_pending: '待确认', kept: '保留', discarded: '放弃', merged: '已合并' }

export function ContentAtomReviewCard({ atom, sourceTitle, mergeSelected, busy, onToggleMerge, onStatus }: {
  atom: ContentAtomRecord
  sourceTitle: string
  mergeSelected: boolean
  busy: boolean
  onToggleMerge(): void
  onStatus(status: 'kept' | 'discarded'): void
}): React.JSX.Element {
  const canMerge = atom.status === 'review_pending' || atom.status === 'kept'
  const hasMaskedContent = atom.content.includes('已遮盖')
  return <article className={`content-atom-card ${atom.status}${mergeSelected ? ' merge-selected' : ''}`}>
    <header><div><span className="atom-type">{atomTypeLabels[atom.atomType]}</span><span className={`atom-status ${atom.status}`}>{statusLabels[atom.status]}</span></div>{canMerge ? <button className="atom-merge-toggle" aria-pressed={mergeSelected} disabled={busy} onClick={onToggleMerge}><GitMerge size={12} />{mergeSelected ? '已选合并' : '选择合并'}</button> : null}</header>
    <h3>{atom.title}</h3>
    <p>{atom.content}</p>
    <div className="atom-source-row"><span>{hasMaskedContent ? <ShieldCheck size={12} /> : null}{sourceTitle}</span><em>{atom.sourceRefs.length}处来源</em></div>
    <footer>{atom.status === 'review_pending' ? <><button className="secondary-action" disabled={busy} onClick={() => onStatus('discarded')}><X size={13} />放弃</button><button className="primary-action" disabled={busy} onClick={() => onStatus('kept')}><Check size={13} />保留</button></> : atom.status === 'kept' ? <><span><Check size={13} />将进入候选生成</span><button className="secondary-action" disabled={busy} onClick={() => onStatus('discarded')}>放弃</button></> : atom.status === 'discarded' ? <button className="secondary-action" disabled={busy} onClick={() => onStatus('kept')}><RotateCcw size={13} />重新保留</button> : <span><GitMerge size={13} />原卡与来源继续保留</span>}</footer>
  </article>
}
