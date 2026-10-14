import { ArrowLeft, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CodexWritingModelOption } from '../../../../../shared/domain'
import { AnchoredPopover } from '../../../components/AnchoredPopover'
import { AppSelect } from '../../../components/AppSelect'
import { REWRITE_QUICK_ACTIONS, type RewriteQuickIntent, type RewriteRequest } from './selection-contract'
import { StructuredReferenceEditor } from '../shared/StructuredReferenceComposer'
import { composerBlockingReferences, composerPendingReferences, type StructuredComposerSnapshot } from '../shared/structured-reference-composer-state'

interface Props {
  anchor: HTMLElement | null
  anchorPoint?: { x: number; y: number } | null
  selectionLabel: string
  projectId: string
  sessionScope: string
  models: CodexWritingModelOption[]
  initialModel: string | null
  initialReasoningEffort?: string | null
  busy?: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string
  onBack?(): void
  onDismiss(): void
  onSubmit(request: RewriteRequest): void
}

export function RewriteRequestPanel({ anchor, anchorPoint, selectionLabel, projectId, sessionScope, models, initialModel, initialReasoningEffort = null, busy = false, submitDisabled = false, submitDisabledReason, onBack, onDismiss, onSubmit }: Props): React.JSX.Element | null {
  const [requirement, setRequirement] = useState('')
  const [structuredInstruction, setStructuredInstruction] = useState<StructuredComposerSnapshot>({ displayText: '', editorDocument: { type: 'doc', content: [{ type: 'paragraph' }] }, references: [] })
  const [quickIntent, setQuickIntent] = useState<RewriteQuickIntent | null>(null)
  const [model, setModel] = useState(initialModel)
  const selectedModel = useMemo(() => models.find((item) => item.id === model) ?? models.find((item) => item.isDefault) ?? models[0] ?? null, [model, models])
  const reasoningOptions = useMemo(() => selectedModel?.reasoningEfforts ?? [], [selectedModel])
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(initialReasoningEffort)
  const referenceBlocked = composerBlockingReferences(structuredInstruction.references).length > 0 || composerPendingReferences(structuredInstruction.references).length > 0
  const fallbackReasoningEffort = reasoningOptions.includes('xhigh')
    ? 'xhigh'
    : reasoningOptions.includes('high') ? 'high' : reasoningOptions.at(-1) ?? null
  const effectiveReasoningEffort = reasoningEffort && reasoningOptions.includes(reasoningEffort)
    ? reasoningEffort
    : fallbackReasoningEffort
  const submit = (): void => {
    if (busy || submitDisabled || referenceBlocked || (!quickIntent && !requirement.trim())) return
    onSubmit({ quickIntent, requirement: requirement.trim(), preferredModel: model, preferredReasoningEffort: effectiveReasoningEffort, structuredInstruction })
  }
  return <AnchoredPopover anchor={anchor} anchorPoint={anchorPoint} ariaLabel="按具体要求修改" className="rewrite-request-popover" onDismiss={onDismiss}>
    <header>{onBack ? <button className="back" aria-label="返回选区操作" onClick={onBack}><ArrowLeft size={14} /></button> : null}<div><b>按具体要求修改</b><small>生成局部候选，不直接改原文</small></div><button aria-label="关闭修改面板" onClick={onDismiss}><X size={14} /></button></header>
    <div className="rewrite-request-target"><span>修改范围</span><p>{selectionLabel}</p></div>
    <StructuredReferenceEditor projectId={projectId} sessionScope={sessionScope} value={requirement} onValueChange={setRequirement} onSnapshotChange={setStructuredInstruction} placeholder="输入具体要求；键入@可引用资料" ariaLabel="具体修改要求" compact autoFocus hasCurrentTarget disabled={busy} />
    <div className="rewrite-quick-actions">{REWRITE_QUICK_ACTIONS.map((action) => <button key={action.id} className={quickIntent === action.id ? 'active' : ''} aria-pressed={quickIntent === action.id} onClick={() => setQuickIntent((current) => current === action.id ? null : action.id)}>{action.label}</button>)}</div>
    <div className="rewrite-model-row">
      <label><span>模型</span><AppSelect aria-label="局部修改模型" value={model ?? ''} onChange={(event) => setModel(event.currentTarget.value || null)}><option value="">自动选择{selectedModel ? `·${selectedModel.displayName}` : ''}</option>{models.map((option) => <option key={option.id} value={option.id}>{option.displayName}{option.isDefault ? '（默认）' : ''}</option>)}</AppSelect></label>
      <label><span>推理</span><AppSelect aria-label="局部修改推理档位" value={effectiveReasoningEffort ?? ''} onChange={(event) => setReasoningEffort(event.currentTarget.value || null)} disabled={!reasoningOptions.length}>{reasoningOptions.map((option) => <option key={option} value={option}>{option}</option>)}</AppSelect></label>
    </div>
    <footer><span>{submitDisabled ? submitDisabledReason ?? '当前AI暂不可用' : '后台生成候选'}</span><button className="primary-action" disabled={busy || submitDisabled || referenceBlocked || (!quickIntent && !requirement.trim())} onClick={submit}><Sparkles size={13} />{busy ? '正在启动' : '生成候选'}</button></footer>
  </AnchoredPopover>
}
