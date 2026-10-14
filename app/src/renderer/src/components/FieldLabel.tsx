import type { CSSProperties, ReactNode } from 'react'
import type { TopicStageDefinition } from '../../../shared/domain'
import { dateLabelParts, topicStageToken } from '../../../shared/field-appearance'

export function FieldLabel({ token, children, className = '', month }: { token?: string; children: ReactNode; className?: string; month?: number }): React.JSX.Element {
  const style = token ? { '--field-soft': `var(--${token}-soft)`, '--field-text': `var(--${token}-text)` } as CSSProperties : undefined
  return <span className={`field-label ${className}`} style={style} data-month={month}>{children}</span>
}

export function TopicStageLabel({ stage }: { stage?: TopicStageDefinition }): React.JSX.Element {
  return <FieldLabel token={topicStageToken(stage)} className="topic-stage-label">{stage?.name ?? '未配置阶段'}</FieldLabel>
}

export function MonthDateLabel({ value, empty = '—', compact = false }: { value: string | null | undefined; empty?: string; compact?: boolean }): React.JSX.Element {
  const parts = dateLabelParts(value)
  return parts ? <FieldLabel token={`month-${parts.month}`} month={parts.month} className="month-date-label">{compact ? `${parts.month}/${parts.day}` : `${parts.month}月${parts.day}日`}</FieldLabel> : <span className="field-empty">{empty}</span>
}
