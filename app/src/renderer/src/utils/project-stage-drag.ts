import type { ProjectStageShortcutPreference } from '../../../shared/domain'

export const PROJECT_STAGE_SHORTCUT_DRAG_MIME = 'application/x-creator-project-stage-shortcut'

export function projectStageShortcutId(shortcut: ProjectStageShortcutPreference): string {
  return `${shortcut.projectId}:${shortcut.moduleKey}`
}

export function writeProjectStageDragData(dataTransfer: DataTransfer, shortcut: ProjectStageShortcutPreference): void {
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(PROJECT_STAGE_SHORTCUT_DRAG_MIME, JSON.stringify(shortcut))
  dataTransfer.setData('text/plain', projectStageShortcutId(shortcut))
}

export function readProjectStageDragData(dataTransfer: DataTransfer): ProjectStageShortcutPreference | null {
  try {
    const value = JSON.parse(dataTransfer.getData(PROJECT_STAGE_SHORTCUT_DRAG_MIME)) as { projectId?: unknown; moduleKey?: unknown }
    if (typeof value.projectId !== 'string' || !value.projectId || typeof value.moduleKey !== 'string' || value.moduleKey === 'overview' || value.moduleKey === 'business') return null
    return value as ProjectStageShortcutPreference
  } catch {
    return null
  }
}

export function hasProjectStageDragData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(PROJECT_STAGE_SHORTCUT_DRAG_MIME)
}
