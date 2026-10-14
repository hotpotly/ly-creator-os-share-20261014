export const VIDEO_FORMATS = ['long', 'short'] as const
export type VideoFormat = (typeof VIDEO_FORMATS)[number]
export const videoFormatLabel = (value?: VideoFormat | null): string => value === 'long' ? '长视频' : value === 'short' ? '短视频' : '形式待定'
export const projectKindLabel = (commercial: boolean): string => commercial ? '商单' : '普通'
export const LEGACY_CONTENT_TYPE_IDS = ['type-commercial', 'type-quick'] as const
/** Compatibility for saved pre-migration actions, not a second editable taxonomy. */
export function normalizeLegacyClassification<T extends { contentTypeId: string; isCommercial?: boolean; videoFormat?: VideoFormat | null; templateId?: string | null }>(input: T): T {
  if (input.contentTypeId === 'type-commercial') return { ...input, contentTypeId: 'type-undetermined', isCommercial: true, templateId: input.templateId === undefined ? 'template-commercial' : input.templateId }
  if (input.contentTypeId === 'type-quick') return { ...input, contentTypeId: 'type-undetermined', videoFormat: 'short', templateId: input.templateId === undefined ? 'template-quick-content' : input.templateId }
  return input
}
