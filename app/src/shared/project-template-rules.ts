import type { ProjectTemplateDefinition, OptionalProjectModuleKey } from './domain'
import type { VideoFormat } from './content-classification'

export const PROJECT_KINDS = ['ordinary', 'commercial'] as const
export type ProjectKind = typeof PROJECT_KINDS[number]
export interface SaveProjectTemplateInput {
  id?: string
  name: string
  description: string
  moduleKeys: OptionalProjectModuleKey[]
  recommendedContentTypeIds: string[]
  recommendedVideoFormats: VideoFormat[]
  recommendedProjectKinds: ProjectKind[]
  isActive: boolean
}
export function templateMatchesClassification(template: ProjectTemplateDefinition, classification: { contentTypeId: string; videoFormat?: VideoFormat | null; isCommercial?: boolean }): boolean {
  const formats = template.recommendedVideoFormats ?? [], kinds = template.recommendedProjectKinds ?? []
  return template.isActive && (!template.recommendedContentTypeIds.length || template.recommendedContentTypeIds.includes(classification.contentTypeId))
    && (!formats.length || Boolean(classification.videoFormat && formats.includes(classification.videoFormat)))
    && (!kinds.length || kinds.includes(classification.isCommercial ? 'commercial' : 'ordinary'))
}
