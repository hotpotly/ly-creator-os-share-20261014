export const PROJECT_SHORTCUT_DRAG_MIME = 'application/x-creator-project-shortcut'

export function writeProjectDragData(dataTransfer: DataTransfer, projectId: string): void {
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(PROJECT_SHORTCUT_DRAG_MIME, projectId)
  dataTransfer.setData('text/plain', projectId)
}

export function readProjectDragData(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(PROJECT_SHORTCUT_DRAG_MIME)
}

export function hasProjectDragData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(PROJECT_SHORTCUT_DRAG_MIME)
}
