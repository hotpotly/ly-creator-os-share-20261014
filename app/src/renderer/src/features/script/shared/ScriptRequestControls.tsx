import { Check } from 'lucide-react'
import type { CodexWritingModelOption, ScriptMaterialWorkspace } from '../../../../../shared/domain'
import { AppSelect } from '../../../components/AppSelect'

type ScriptWebSearchMode = ScriptMaterialWorkspace['webSearchMode']

interface ProjectContextToggleProps {
  value: boolean
  disabled?: boolean
  className?: string
  onChange(value: boolean): void
}

export function ProjectContextToggle({ value, disabled = false, className = '', onChange }: ProjectContextToggleProps): React.JSX.Element {
  return <button className={className} aria-pressed={value} disabled={disabled} onClick={() => onChange(!value)}>{value ? <Check size={12} /> : null}项目上下文</button>
}

interface WebSearchModeControlProps {
  value: ScriptWebSearchMode
  disabled?: boolean
  onChange(value: ScriptWebSearchMode): void
}

export function WebSearchModeControl({ value, disabled = false, onChange }: WebSearchModeControlProps): React.JSX.Element {
  return <label>联网<AppSelect disabled={disabled} value={value} onChange={(event) => onChange(event.currentTarget.value as ScriptWebSearchMode)}><option value="automatic">按需</option><option value="required">必须</option><option value="disabled">关闭</option></AppSelect></label>
}

interface CodexModelControlProps {
  models: CodexWritingModelOption[]
  value: string | null
  disabled?: boolean
  className?: string
  ariaLabel: string
  onChange(value: string | null): void
}

export function CodexModelControl({ models, value, disabled = false, className, ariaLabel, onChange }: CodexModelControlProps): React.JSX.Element {
  const defaultModel = models.find((model) => model.isDefault)
  return <label className={className}>模型<AppSelect disabled={disabled} aria-label={ariaLabel} value={value ?? ''} onChange={(event) => onChange(event.currentTarget.value || null)}>
    <option value="">自动选择{defaultModel ? `·${defaultModel.id}` : ''}</option>
    {models.map((model) => <option value={model.id} key={model.id}>{model.displayName === model.id ? model.id : `${model.displayName}·${model.id}`}{model.isDefault ? '（默认）' : ''}</option>)}
  </AppSelect></label>
}

interface AiCountControlProps {
  value: 1 | 2
  disabled?: boolean
  className: string
  ariaLabel: string
  onChange(value: 1 | 2): void
}

export function AiCountControl({ value, disabled = false, className, ariaLabel, onChange }: AiCountControlProps): React.JSX.Element {
  return <div className={className} role="group" aria-label={ariaLabel}><button disabled={disabled} className={value === 1 ? 'active' : ''} onClick={() => onChange(1)}>1个AI</button><button disabled={disabled} className={value === 2 ? 'active' : ''} onClick={() => onChange(2)}>2个AI</button></div>
}
