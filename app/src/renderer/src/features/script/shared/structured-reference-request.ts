import type {
  ContentConstraint,
  ContentInstructionSurface,
  ContentTargetSnapshot,
  ScriptRevisionWebSearchMode,
  StructuredReferenceUse,
} from '../../../../../shared/domain'
import type { ContentInstructionDispatchPayload } from '../../../../../shared/ipc'
import type { StructuredComposerSnapshot } from './structured-reference-composer-state'

export interface StructuredInstructionProviderTarget {
  providerConfigId: string
  requestedModel: string
  requestedReasoningEffort?: string | null
  historyThreadId?: string | null
  providerThreadId?: string | null
  historyMessageIds?: string[]
}

function constraintsFromReferences(references: StructuredReferenceUse[]): ContentConstraint[] {
  return references.flatMap((reference) => {
    if (reference.role === 'pending' && reference.roleOrigin === 'runtime_fallback') return [{
      id: `constraint-${reference.occurrenceId}`,
      kind: 'ordinary_reference' as const,
      sourceOccurrenceId: reference.occurrenceId,
      description: `本轮将“${reference.label}”按普通参考使用，未写入项目记忆。`
    }]
    if (reference.role === 'pending') return []
    const kind = ({
      hard_constraint: 'hard_constraint',
      key_adoption: 'required_adoption',
      ordinary_reference: 'ordinary_reference',
      style_reference: 'style_only'
    } as const)[reference.role]
    return [{
      id: `constraint-${reference.occurrenceId}`,
      kind,
      sourceOccurrenceId: reference.occurrenceId,
      description: `${reference.label}：${reference.aspect ? `限定${reference.aspect}，` : ''}${kind}`
    }]
  })
}

export type StructuredInstructionPreparePayload = ContentInstructionDispatchPayload['instruction']

export async function buildStructuredInstructionPayload(input: {
  projectId: string
  sessionScope: string
  surface: ContentInstructionSurface
  snapshot: StructuredComposerSnapshot
  target: ContentTargetSnapshot | null
  currentDocumentParagraphs?: Array<{ id: string; position: number; text: string }>
  materialRevisionId?: string | null
  briefVersionId?: string | null
  outlineVersionId?: string | null
  includeProjectContext: boolean
  webSearchMode: ScriptRevisionWebSearchMode
  aiCount: 1 | 2
  targets: StructuredInstructionProviderTarget[]
  supersedesRequestId?: string | null
  generationId?: string | null
}): Promise<StructuredInstructionPreparePayload> {
  if (!window.creatorOS) throw new Error('结构化引用服务尚未就绪')
  const resolved = await window.creatorOS.resolveStructuredReferenceRoles({
    text: input.snapshot.displayText,
    references: input.snapshot.references
  })
  const references = resolved.map((result) => result.reference)
  const unresolved = references.find((reference) => reference.role === 'pending' && reference.roleOrigin !== 'runtime_fallback')
  if (unresolved) throw new Error(`请先确认引用“${unresolved.label}”的用途，或明确仅本轮按普通参考继续`)
  const conflict = resolved.find((result) => result.conflict)
  if (conflict) throw new Error(`引用“${conflict.reference.label}”的用途存在冲突，请先处理`)
  return {
    projectId: input.projectId,
    sessionScope: input.sessionScope,
    surface: input.surface,
    supersedesRequestId: input.supersedesRequestId ?? null,
    generationId: input.generationId ?? null,
    target: input.target,
    materialRevisionId: input.materialRevisionId ?? null,
    briefVersionId: input.briefVersionId ?? null,
    outlineVersionId: input.outlineVersionId ?? null,
    adoptedOpeningSnapshots: [],
    displayText: input.snapshot.displayText,
    editorDocument: input.snapshot.editorDocument,
    currentDocumentParagraphs: input.currentDocumentParagraphs ?? [],
    references,
    constraints: constraintsFromReferences(references),
    includeProjectContext: input.includeProjectContext,
    webSearchMode: input.webSearchMode,
    factRegion: '中国大陆',
    factAsOf: new Date().toISOString(),
    aiCount: input.aiCount,
    targets: input.targets
  }
}
