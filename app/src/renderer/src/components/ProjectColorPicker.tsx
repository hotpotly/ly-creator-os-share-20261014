import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PROJECT_COLOR_TOKENS, type ProjectColorToken } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'

export function ProjectColorPicker({
  projectId,
  value,
  label = '选择项目色',
  autoFocus = false,
  onChanged
}: {
  projectId: string
  value: ProjectColorToken
  label?: string
  autoFocus?: boolean
  onChanged?(colorToken: ProjectColorToken): void
}): React.JSX.Element {
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [saving, setSaving] = useState<ProjectColorToken | null>(null)
  const [error, setError] = useState('')
  const focusButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    const frame = window.requestAnimationFrame(() => focusButtonRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus])

  const selectColor = async (colorToken: ProjectColorToken): Promise<void> => {
    if (!window.creatorOS || saving || colorToken === value) return
    setSaving(colorToken)
    setError('')
    try {
      await window.creatorOS.setProjectColor(projectId, colorToken)
      await refresh()
      onChanged?.(colorToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目颜色保存失败')
    } finally {
      setSaving(null)
    }
  }

  return <div className="project-color-picker-wrap">
    <div className="project-color-picker" role="group" aria-label={label}>
      {PROJECT_COLOR_TOKENS.map((colorToken, index) => <button
        ref={colorToken === value ? focusButtonRef : undefined}
        key={colorToken}
        type="button"
        className={colorToken === value ? 'selected' : ''}
        aria-label={`颜色${index + 1}`}
        aria-pressed={colorToken === value}
        disabled={saving !== null}
        style={{ '--project-color-sample': `var(--${colorToken})`, '--project-color-sample-soft': `var(--${colorToken}-soft)`, '--project-color-sample-text': `var(--${colorToken}-text)` } as React.CSSProperties}
        onClick={() => void selectColor(colorToken)}
      ><span aria-hidden="true" />{colorToken === value ? <Check size={11} aria-hidden="true" /> : null}</button>)}
    </div>
    {error ? <small className="project-color-error" role="alert">{error}</small> : null}
  </div>
}
