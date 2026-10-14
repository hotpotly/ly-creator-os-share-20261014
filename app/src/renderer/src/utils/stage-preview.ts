export const STAGE_PREVIEW_EVENT = 'creator-os:stage-preview'

export function showStagePreview(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(STAGE_PREVIEW_EVENT, { detail: message }))
}
