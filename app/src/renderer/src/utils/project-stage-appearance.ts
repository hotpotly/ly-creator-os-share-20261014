import type { CSSProperties } from 'react'
import type { ProjectModuleKey } from '../../../shared/domain'

export const projectStageColorTokens: Record<ProjectModuleKey, string> = {
  overview: 'project-12', materials: 'project-2', outline: 'project-9', script: 'project-4',
  production: 'project-12', shooting: 'project-7', editing: 'project-3', postproduction: 'project-8',
  publishing: 'project-6', versions: 'project-12', business: 'project-5', feedback: 'project-12'
}
export function projectStageStyle(stageKey: ProjectModuleKey): CSSProperties {
  const token = projectStageColorTokens[stageKey]
  return { '--stage-accent': `var(--${token}-text)`, '--stage-soft': `var(--${token}-soft)` } as CSSProperties
}
