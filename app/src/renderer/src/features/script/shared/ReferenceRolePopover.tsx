import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResolvedStructuredReferenceRole, StructuredReferenceScope, StructuredReferenceUse } from '../../../../../shared/domain'
import { AnchoredPopover } from '../../../components/AnchoredPopover'
import { AppSelect } from '../../../components/AppSelect'
import { referenceRoleLabel, referenceScopeLabel } from './structured-reference-composer-state'

const roles: ResolvedStructuredReferenceRole[] = ['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']

export function ReferenceRolePopover({ anchor, reference, scopes, onApply, onDismiss }: {
  anchor: HTMLElement | null
  reference: StructuredReferenceUse
  scopes: StructuredReferenceScope[]
  onApply(input: { role: ResolvedStructuredReferenceRole; scope: StructuredReferenceScope; aspect: string | null; remember: boolean; conflictResolution: StructuredReferenceUse['manualConflictResolution'] }): void
  onDismiss(): void
}): React.JSX.Element | null {
  const initialRole = reference.role === 'pending' ? 'ordinary_reference' : reference.role
  const [role, setRole] = useState<ResolvedStructuredReferenceRole>(initialRole)
  const [scope, setScope] = useState(reference.scope)
  const [aspect, setAspect] = useState(reference.aspect ?? '')
  const [remember, setRemember] = useState(Boolean(reference.projectMemory || reference.roleOrigin === 'project_memory'))
  const [conflictResolution, setConflictResolution] = useState<StructuredReferenceUse['manualConflictResolution']>(reference.manualConflictResolution)
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { window.requestAnimationFrame(() => firstRef.current?.focus()) }, [])
  const recognizedRole = reference.ruleEvidence?.resolvedRole ?? reference.ruleConflicts?.[0]?.resolvedRole ?? null
  const hasConflict = Boolean(reference.ruleConflicts?.length || reference.manualConflictResolution === 'unresolved')
  const explanation = useMemo(() => recognizedRole ? `文字识别为“${referenceRoleLabel(recognizedRole)}”` : '当前文字没有识别出明确用途', [recognizedRole])
  return <AnchoredPopover anchor={anchor} ariaLabel="设置引用用途" className="reference-role-popover" onDismiss={onDismiss}>
    <header><div><b>{reference.label}</b><small>设置这次生成怎样使用它</small></div><button ref={firstRef} aria-label="关闭引用设置" onClick={onDismiss}><X size={14} /></button></header>
    {hasConflict ? <div className="reference-role-conflict" role="alert"><AlertTriangle size={14} /><span><b>用途存在冲突</b><small>{explanation}，本次手动设置为“{referenceRoleLabel(role)}”。</small></span></div> : <p className="reference-role-evidence">{explanation}</p>}
    <label><span>用途</span><AppSelect aria-label="引用用途" value={role} onChange={(event) => { setRole(event.currentTarget.value as ResolvedStructuredReferenceRole); setConflictResolution(null) }}>{roles.map((value) => <option key={value} value={value}>{referenceRoleLabel(value)}</option>)}</AppSelect></label>
    <label><span>范围</span><AppSelect aria-label="引用范围" value={scope} onChange={(event) => setScope(event.currentTarget.value as StructuredReferenceScope)}>{scopes.map((value) => <option key={value} value={value}>{referenceScopeLabel(value)}</option>)}</AppSelect></label>
    <label><span>限定方面（可不填）</span><input value={aspect} maxLength={200} placeholder={role === 'style_reference' ? '例如：语气、节奏、排版结构' : '例如：参数、外观、使用体验'} onChange={(event) => setAspect(event.currentTarget.value)} /></label>
    {hasConflict ? <fieldset><legend>本次冲突怎么处理</legend><label><input type="radio" name={`reference-conflict-${reference.occurrenceId}`} checked={conflictResolution === 'keep_manual'} onChange={() => setConflictResolution('keep_manual')} />保留本次手动用途</label>{recognizedRole ? <label><input type="radio" name={`reference-conflict-${reference.occurrenceId}`} checked={conflictResolution === 'accept_rule'} onChange={() => { setConflictResolution('accept_rule'); setRole(recognizedRole) }} />采用文字识别用途</label> : null}</fieldset> : null}
    <label className="reference-role-memory"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.currentTarget.checked)} /><span><b>记住这份引用的用法</b><small>仅在当前项目、同一份来源中使用</small></span></label>
    <footer><button onClick={onDismiss}>取消</button><button className="primary-action" disabled={hasConflict && conflictResolution !== 'keep_manual' && conflictResolution !== 'accept_rule'} onClick={() => onApply({ role, scope, aspect: aspect.trim() || null, remember, conflictResolution })}>应用本次设置</button></footer>
  </AnchoredPopover>
}
