import type { ContentSourceSelectionSnapshot, ScriptRevisionWebSearchMode, TextProviderExecutionContext } from '../domain'

export const STRUCTURED_REFERENCE_ROLES = [
  'pending',
  'hard_constraint',
  'key_adoption',
  'ordinary_reference',
  'style_reference'
] as const

export type StructuredReferenceRole = (typeof STRUCTURED_REFERENCE_ROLES)[number]
export type ResolvedStructuredReferenceRole = Exclude<StructuredReferenceRole, 'pending'>

export const STRUCTURED_REFERENCE_SOURCE_KINDS = [
  'material_revision',
  'material_point',
  'material_draft_paragraph',
  'brief',
  'brief_point',
  'client_feedback',
  'project_material',
  'project_image',
  'project_material_group',
  'external_document_snapshot',
  'scratch_note',
  'real_experience',
  'outline_version',
  'outline_module',
  'outline_point',
  'outline_layout_template',
  'draft_version',
  'style_resource',
  'script_revision_message',
  'script_material_message',
  'outline_message',
  'temporary_attachment'
] as const

export type StructuredReferenceSourceKind = (typeof STRUCTURED_REFERENCE_SOURCE_KINDS)[number]

export const STRUCTURED_REFERENCE_SCOPES = [
  'whole_source',
  'source_fragment',
  'frozen_group_members',
  'outline_module',
  'outline_point',
  'current_target',
  'whole_outline',
  'whole_script'
] as const

export type StructuredReferenceScope = (typeof STRUCTURED_REFERENCE_SCOPES)[number]

export const STRUCTURED_REFERENCE_AVAILABILITIES = [
  'ready',
  'stored_only',
  'processing',
  'authorization_required',
  'reauthorization_required',
  'stale',
  'missing',
  'unsupported'
] as const

export type StructuredReferenceAvailability = (typeof STRUCTURED_REFERENCE_AVAILABILITIES)[number]

export interface StructuredReferenceRuleEvidence {
  ruleId: string
  text: string
  from: number
  to: number
  resolvedRole: ResolvedStructuredReferenceRole
}

export interface StructuredReferenceUse {
  occurrenceId: string
  sourceKey: string
  sourceKind: StructuredReferenceSourceKind
  sourceId: string
  sourceLocator: Record<string, string | number>
  label: string
  role: StructuredReferenceRole
  roleOrigin: 'pending' | 'deterministic_rule' | 'manual' | 'project_memory' | 'runtime_fallback'
  runtimeRole: ResolvedStructuredReferenceRole | null
  /**
   * The exact project preference that existed when this occurrence was created.
   * It remains attached while a deterministic text rule temporarily overrides
   * the visible role, so removing that cue can restore the remembered use.
   */
  projectMemory?: {
    role: ResolvedStructuredReferenceRole
    aspect: string | null
    scope: StructuredReferenceScope
  } | null
  aspect: string | null
  scope: StructuredReferenceScope
  ruleEvidence: StructuredReferenceRuleEvidence | null
  ruleConflicts?: StructuredReferenceRuleEvidence[]
  manualConflictResolution: 'unresolved' | 'keep_manual' | 'accept_rule' | null
}

export interface FrozenStructuredReferenceMember {
  occurrenceId: string
  sourceKey: string
  sourceKind: StructuredReferenceSourceKind
  sourceVersion: string
  contentSha256: string
  managedAssetId: string | null
  binarySha256: string | null
  order: number
}

export interface FrozenStructuredReference extends StructuredReferenceUse {
  sourceVersion: string
  contentSha256: string
  frozenTextContent: string | null
  managedAssetId: string | null
  binarySha256: string | null
  visualCapability: 'native_image_input' | 'auditable_visual_summary' | 'ocr_text_only' | 'unreadable' | null
  visualSummaryVersion: string | null
  frozenMembers: FrozenStructuredReferenceMember[]
  availability: StructuredReferenceAvailability
}

export interface StructuredReferenceCatalogItem {
  sourceKey: string
  sourceKind: StructuredReferenceSourceKind
  sourceId: string
  label: string
  summary: string
  group: 'current_material' | 'brief' | 'client_feedback' | 'project_material' | 'project_image' | 'material_group' | 'outline' | 'history' | 'style' | 'conversation' | 'temporary'
  sourceVersion: string
  availability: StructuredReferenceAvailability
  mimeType: string | null
  contentCharacters: number
  rememberedUse: {
    role: ResolvedStructuredReferenceRole
    aspect: string | null
    scope: StructuredReferenceScope
  } | null
  rememberedUses: Array<{
    role: ResolvedStructuredReferenceRole
    aspect: string | null
    scope: StructuredReferenceScope
  }>
  lastUsedAt: string | null
}

export interface ProjectReferenceRolePreference {
  projectId: string
  sourceKey: string
  sourceKind: StructuredReferenceSourceKind
  sourceId: string
  role: ResolvedStructuredReferenceRole
  aspect: string | null
  scope: StructuredReferenceScope
  createdAt: string
  updatedAt: string
}

export interface ContentConstraint {
  id: string
  kind:
    | 'blocking'
    | 'hard_constraint'
    | 'required_adoption'
    | 'ordinary_reference'
    | 'style_only'
    | 'negative_requirement'
    | 'source_availability'
    | 'fact_verification'
  sourceOccurrenceId: string | null
  description: string
}

export type ContentTargetSnapshot =
  | {
      kind: 'current_script'
      workingDocumentId: string
      revision: number
      contentHash: string
      blockSelections: Array<{ blockId: string; from: number; to: number; text: string }>
    }
  | {
      kind: 'material_draft'
      draftId: string
      contentHash: string
      paragraphSelections: Array<{ paragraphId: string; from: number; to: number; text: string }>
      applicationTarget: {
        targetId: string
        selectedText: string
        contentHash: string
        from: number
        to: number
      } | null
    }
  | {
      kind: 'draft_comparison'
      groupId: string
      sourceSelections: ContentSourceSelectionSnapshot[]
    }
  | {
      kind: 'version_comparison'
      comparisonId: string
      sourceSelections: ContentSourceSelectionSnapshot[]
    }
  | {
      kind: 'outline'
      outlineId: string
      moduleIds: string[]
      pointIds: string[]
    }

export const CONTENT_INSTRUCTION_SURFACES = [
  'outline_conversation',
  'outline_generation',
  'outline_rewrite',
  'outline_comparison',
  'script_conversation',
  'script_material_first_draft',
  'script_material_chat',
  'script_material_rewrite',
  'script_draft_comparison',
  'script_version_comparison',
  'current_script_rewrite'
] as const

export type ContentInstructionSurface = (typeof CONTENT_INSTRUCTION_SURFACES)[number]

export interface ContentInstructionInputBudget {
  maxTokens: number
  estimatedTokens: number
  hardConstraintTokens: number
  truncatedOrdinaryReferenceIds: string[]
}

export interface ContentInstructionRequest {
  id: string
  projectId: string
  sessionScope: string
  surface: ContentInstructionSurface
  supersedesRequestId: string | null
  generationId: string | null
  target: ContentTargetSnapshot | null
  materialRevisionId: string | null
  materialRevisionContentHash: string | null
  briefVersionId: string | null
  briefVersionContentHash: string | null
  outlineVersionId: string | null
  outlineVersionContentHash: string | null
  adoptedOpeningSnapshots: Array<Record<string, unknown>>
  displayText: string
  editorDocument: Record<string, unknown>
  currentDocumentParagraphs: Array<{ id: string; position: number; text: string }>
  references: FrozenStructuredReference[]
  constraints: ContentConstraint[]
  projectContextSnapshot: Record<string, unknown> | null
  projectContextFingerprint: string | null
  resourceSnapshotId: string | null
  resourceSnapshot: Record<string, unknown> | null
  resourceSnapshotFingerprint: string | null
  webSearchMode: ScriptRevisionWebSearchMode
  factRegion: string
  factAsOf: string
  inputBudget: ContentInstructionInputBudget
  aiCount: 1 | 2
  commonFingerprint: string
  createdAt: string
}

export interface ContentInstructionRequestTarget {
  id: string
  requestId: string
  provider: 'codex_cli' | 'claude_cli'
  providerConfigId: string
  providerSecurityFingerprint: string
  providerPolicyVersion: string
  runtimeVersion: string
  requestedModel: string
  actualModel: string | null
  requestedReasoningEffort: string | null
  actualReasoningEffort: string | null
  historyThreadId: string | null
  providerThreadId: string | null
  historyMessageIds: string[]
  historyHash: string
  historyEstimatedTokens: number
  estimatedInputTokens: number
  taskId: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
}

export interface ContentInstructionRequestTargetEvent {
  id: string
  targetId: string
  sequence: number
  eventKind: 'started' | 'requeued' | 'runtime_resolved' | 'task_linked' | 'completed' | 'failed' | 'canceled'
  actualModel: string | null
  actualReasoningEffort: string | null
  providerThreadId: string | null
  taskId: string | null
  status: ContentInstructionRequestTarget['status']
  createdAt: string
}

export interface ContentInstructionRequestRecord {
  request: ContentInstructionRequest
  targets: ContentInstructionRequestTarget[]
  targetEvents: ContentInstructionRequestTargetEvent[]
}

export interface ContentInstructionTargetPreparation {
  providerConfigId: string
  providerSecurity: Extract<TextProviderExecutionContext, { provider: 'codex_cli' | 'claude_cli' }>
  requestedModel: string
  actualModel: string | null
  requestedReasoningEffort: string | null
  actualReasoningEffort: string | null
  historyThreadId: string | null
  providerThreadId: string | null
  historyMessageIds: string[]
  historyHash: string
}
