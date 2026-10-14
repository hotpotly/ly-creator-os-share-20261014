import { z } from 'zod'
import {
  CONTENT_INSTRUCTION_SURFACES,
  SCRIPT_REVISION_WEB_SEARCH_MODES,
  STRUCTURED_REFERENCE_AVAILABILITIES,
  STRUCTURED_REFERENCE_ROLES,
  STRUCTURED_REFERENCE_SCOPES,
  STRUCTURED_REFERENCE_SOURCE_KINDS
} from './domain'

const idSchema = z.string().min(1).max(256)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const jsonRecordSchema = z.record(z.string(), z.unknown())

export const structuredReferenceRuleEvidenceSchema = z.object({
  ruleId: idSchema,
  text: z.string().min(1).max(500),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  resolvedRole: z.enum(STRUCTURED_REFERENCE_ROLES.filter((role) => role !== 'pending') as ['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference'])
}).strict().refine((value) => value.to >= value.from, { message: '规则证据范围无效' })

const structuredReferenceUseObjectSchema = z.object({
  occurrenceId: idSchema,
  sourceKey: z.string().regex(/^ref_v1_[a-f0-9]{32}$/u),
  sourceKind: z.enum(STRUCTURED_REFERENCE_SOURCE_KINDS),
  sourceId: idSchema,
  sourceLocator: z.record(z.string(), z.union([z.string().max(2_000), z.number().finite()])),
  label: z.string().trim().min(1).max(160),
  role: z.enum(STRUCTURED_REFERENCE_ROLES),
  roleOrigin: z.enum(['pending', 'deterministic_rule', 'manual', 'project_memory', 'runtime_fallback']),
  runtimeRole: z.enum(['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']).nullable(),
  projectMemory: z.object({
    role: z.enum(['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']),
    aspect: z.string().trim().max(200).nullable(),
    scope: z.enum(STRUCTURED_REFERENCE_SCOPES)
  }).strict().nullable().optional(),
  aspect: z.string().trim().max(200).nullable(),
  scope: z.enum(STRUCTURED_REFERENCE_SCOPES),
  ruleEvidence: structuredReferenceRuleEvidenceSchema.nullable(),
  ruleConflicts: z.array(structuredReferenceRuleEvidenceSchema).max(10).optional(),
  manualConflictResolution: z.enum(['unresolved', 'keep_manual', 'accept_rule']).nullable()
}).strict()

function validateStructuredReferenceRoleSemantics(
  value: z.infer<typeof structuredReferenceUseObjectSchema>,
  context: z.RefinementCtx
): void {
  if (value.role === 'pending') {
    const isValidFallback = value.roleOrigin === 'runtime_fallback' && value.runtimeRole === 'ordinary_reference'
    const isUnresolved = value.roleOrigin === 'pending' && value.runtimeRole === null
    if (!isValidFallback && !isUnresolved) {
      context.addIssue({ code: 'custom', message: '待定引用只能未解析，或明确降级为普通参考', path: ['runtimeRole'] })
    }
    return
  }
  if (value.roleOrigin === 'pending' || value.roleOrigin === 'runtime_fallback') {
    context.addIssue({ code: 'custom', message: '已确定用途与用途来源不一致', path: ['roleOrigin'] })
  }
  if (value.runtimeRole !== value.role) {
    context.addIssue({ code: 'custom', message: '显示用途与运行时用途必须一致', path: ['runtimeRole'] })
  }
}

export const structuredReferenceUseSchema = structuredReferenceUseObjectSchema.superRefine(validateStructuredReferenceRoleSemantics)

const frozenStructuredReferenceMemberSchema = z.object({
  occurrenceId: idSchema,
  sourceKey: z.string().regex(/^ref_v1_[a-f0-9]{32}$/u),
  sourceKind: z.enum(STRUCTURED_REFERENCE_SOURCE_KINDS),
  sourceVersion: z.string().min(1).max(500),
  contentSha256: sha256Schema,
  managedAssetId: idSchema.nullable(),
  binarySha256: sha256Schema.nullable(),
  order: z.number().int().nonnegative()
}).strict()

export const frozenStructuredReferenceSchema = structuredReferenceUseObjectSchema.extend({
  sourceVersion: z.string().min(1).max(500),
  contentSha256: sha256Schema,
  frozenTextContent: z.string().max(2_000_000).nullable(),
  managedAssetId: idSchema.nullable(),
  binarySha256: sha256Schema.nullable(),
  visualCapability: z.enum(['native_image_input', 'auditable_visual_summary', 'ocr_text_only', 'unreadable']).nullable(),
  visualSummaryVersion: z.string().max(500).nullable(),
  frozenMembers: z.array(frozenStructuredReferenceMemberSchema).max(500),
  availability: z.enum(STRUCTURED_REFERENCE_AVAILABILITIES)
}).strict().superRefine(validateStructuredReferenceRoleSemantics)

export const contentSourceSelectionSnapshotStrictSchema = z.object({
  selectionId: idSchema,
  position: z.number().int().nonnegative(),
  sourceKind: z.enum(['current_script', 'material_draft', 'comparison_source', 'comparison_candidate', 'draft_version']),
  sourceId: idSchema,
  sourceVersion: z.string().min(1).max(500),
  sourceContentHash: sha256Schema,
  sourceLabel: z.string().min(1).max(200),
  semanticGroupId: idSchema.nullable(),
  blockId: idSchema,
  blockStart: z.number().int().nonnegative(),
  blockEnd: z.number().int().nonnegative(),
  selectedText: z.string().min(1).max(300_000)
}).strict().refine((value) => value.blockEnd >= value.blockStart, { message: '来源选区范围无效' })

export const contentTargetSnapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('current_script'),
    workingDocumentId: idSchema,
    revision: z.number().int().positive(),
    contentHash: sha256Schema,
    blockSelections: z.array(z.object({ blockId: idSchema, from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string().max(300_000) }).strict().refine((value) => value.to >= value.from, { message: '当前文案选区范围无效' })).max(100)
  }).strict(),
  z.object({
    kind: z.literal('material_draft'),
    draftId: idSchema,
    contentHash: sha256Schema,
    paragraphSelections: z.array(z.object({ paragraphId: idSchema, from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string().max(300_000) }).strict().refine((value) => value.to >= value.from, { message: '素材稿选区范围无效' })).max(100),
    applicationTarget: z.object({
      targetId: idSchema, selectedText: z.string().max(80_000), contentHash: sha256Schema,
      from: z.number().int().nonnegative(), to: z.number().int().positive()
    }).strict().nullable().optional().default(null)
  }).strict(),
  z.object({ kind: z.literal('draft_comparison'), groupId: idSchema, sourceSelections: z.array(contentSourceSelectionSnapshotStrictSchema).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('version_comparison'), comparisonId: idSchema, sourceSelections: z.array(contentSourceSelectionSnapshotStrictSchema).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('outline'), outlineId: idSchema, moduleIds: z.array(idSchema).max(100), pointIds: z.array(idSchema).max(500) }).strict()
])

export const contentConstraintSchema = z.object({
  id: idSchema,
  kind: z.enum(['blocking', 'hard_constraint', 'required_adoption', 'ordinary_reference', 'style_only', 'negative_requirement', 'source_availability', 'fact_verification']),
  sourceOccurrenceId: idSchema.nullable(),
  description: z.string().trim().min(1).max(2_000)
}).strict()

export const contentInstructionInputBudgetSchema = z.object({
  maxTokens: z.number().int().min(256).max(2_000_000),
  estimatedTokens: z.number().int().nonnegative(),
  hardConstraintTokens: z.number().int().nonnegative(),
  truncatedOrdinaryReferenceIds: z.array(idSchema).max(1_000)
}).strict()

export const contentInstructionRequestSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sessionScope: z.string().trim().min(1).max(120),
  surface: z.enum(CONTENT_INSTRUCTION_SURFACES),
  supersedesRequestId: idSchema.nullable(),
  generationId: idSchema.nullable(),
  target: contentTargetSnapshotSchema.nullable(),
  materialRevisionId: idSchema.nullable(),
  materialRevisionContentHash: sha256Schema.nullable(),
  briefVersionId: idSchema.nullable(),
  briefVersionContentHash: sha256Schema.nullable(),
  outlineVersionId: idSchema.nullable(),
  outlineVersionContentHash: sha256Schema.nullable(),
  adoptedOpeningSnapshots: z.array(jsonRecordSchema).max(20),
  displayText: z.string().max(100_000),
  editorDocument: jsonRecordSchema,
  currentDocumentParagraphs: z.array(z.object({
    id: idSchema, position: z.number().int().nonnegative(), text: z.string().max(300_000)
  }).strict()).max(2_000).default([]),
  references: z.array(frozenStructuredReferenceSchema).max(500),
  constraints: z.array(contentConstraintSchema).max(1_000),
  projectContextSnapshot: jsonRecordSchema.nullable(),
  projectContextFingerprint: sha256Schema.nullable(),
  resourceSnapshotId: idSchema.nullable(),
  resourceSnapshot: jsonRecordSchema.nullable(),
  resourceSnapshotFingerprint: sha256Schema.nullable(),
  webSearchMode: z.enum(SCRIPT_REVISION_WEB_SEARCH_MODES),
  factRegion: z.string().trim().min(2).max(32),
  factAsOf: z.string().datetime(),
  inputBudget: contentInstructionInputBudgetSchema,
  aiCount: z.union([z.literal(1), z.literal(2)]),
  commonFingerprint: sha256Schema,
  createdAt: z.string().datetime()
}).strict().superRefine((value, context) => {
  const pairs = [
    ['materialRevisionId', 'materialRevisionContentHash'],
    ['briefVersionId', 'briefVersionContentHash'],
    ['outlineVersionId', 'outlineVersionContentHash']
  ] as const
  pairs.forEach(([idKey, hashKey]) => {
    if (Boolean(value[idKey]) !== Boolean(value[hashKey])) {
      context.addIssue({ code: 'custom', message: '版本身份与内容哈希必须成对', path: [hashKey] })
    }
  })
})

export const contentInstructionRequestTargetSchema = z.object({
  id: idSchema,
  requestId: idSchema,
  provider: z.enum(['codex_cli', 'claude_cli']),
  providerConfigId: idSchema,
  providerSecurityFingerprint: z.string().min(1).max(500),
  providerPolicyVersion: z.string().min(1).max(200),
  runtimeVersion: z.string().min(1).max(500),
  requestedModel: z.string().min(1).max(200),
  actualModel: z.string().max(200).nullable(),
  requestedReasoningEffort: z.string().max(100).nullable(),
  actualReasoningEffort: z.string().max(100).nullable(),
  historyThreadId: idSchema.nullable(),
  providerThreadId: z.string().max(500).nullable(),
  historyMessageIds: z.array(idSchema).max(100),
  historyHash: sha256Schema,
  historyEstimatedTokens: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(),
  taskId: idSchema.nullable(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'canceled'])
}).strict()

export const contentInstructionRequestTargetEventSchema = z.object({
  id: idSchema,
  targetId: idSchema,
  sequence: z.number().int().positive(),
  eventKind: z.enum(['started', 'requeued', 'runtime_resolved', 'task_linked', 'completed', 'failed', 'canceled']),
  actualModel: z.string().max(200).nullable(),
  actualReasoningEffort: z.string().max(100).nullable(),
  providerThreadId: z.string().max(500).nullable(),
  taskId: idSchema.nullable(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'canceled']),
  createdAt: z.string().datetime()
}).strict()

export const contentInstructionRequestRecordSchema = z.object({
  request: contentInstructionRequestSchema,
  targets: z.array(contentInstructionRequestTargetSchema).max(2),
  targetEvents: z.array(contentInstructionRequestTargetEventSchema).max(10_000)
}).strict()

export const structuredReferenceCatalogListPayloadSchema = z.object({
  projectId: idSchema,
  sessionScope: z.string().trim().min(1).max(120),
  query: z.string().trim().max(200).optional().default('')
}).strict()

export const projectReferenceRolePreferenceSchema = z.object({
  projectId: idSchema,
  sourceKey: z.string().regex(/^ref_v1_[a-f0-9]{32}$/u),
  sourceKind: z.enum(STRUCTURED_REFERENCE_SOURCE_KINDS),
  sourceId: idSchema,
  role: z.enum(['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']),
  aspect: z.string().trim().max(200).nullable(),
  scope: z.enum(STRUCTURED_REFERENCE_SCOPES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()

export const projectReferenceRolePreferenceSetPayloadSchema = z.object({
  projectId: idSchema,
  sourceKind: z.enum(STRUCTURED_REFERENCE_SOURCE_KINDS),
  sourceId: idSchema,
  role: z.enum(['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']),
  aspect: z.string().trim().max(200).nullable(),
  scope: z.enum(STRUCTURED_REFERENCE_SCOPES)
}).strict()

export const projectReferenceRolePreferenceRemovePayloadSchema = z.object({
  projectId: idSchema,
  sourceKind: z.enum(STRUCTURED_REFERENCE_SOURCE_KINDS),
  sourceId: idSchema,
  scope: z.enum(STRUCTURED_REFERENCE_SCOPES)
}).strict()

export const contentInstructionTargetEventAppendPayloadSchema = contentInstructionRequestTargetEventSchema.omit({
  id: true,
  sequence: true,
  createdAt: true
}).strict()

export const structuredReferenceRolesResolvePayloadSchema = z.object({
  text: z.string().max(100_000),
  references: z.array(structuredReferenceUseSchema).max(500)
}).strict()

export const contentInstructionRequestPreparePayloadSchema = z.object({
  projectId: idSchema,
  sessionScope: z.string().trim().min(1).max(120),
  surface: z.enum(CONTENT_INSTRUCTION_SURFACES),
  supersedesRequestId: idSchema.nullable().optional(),
  generationId: idSchema.nullable().optional(),
  target: contentTargetSnapshotSchema.nullable(),
  materialRevisionId: idSchema.nullable().optional(),
  briefVersionId: idSchema.nullable().optional(),
  outlineVersionId: idSchema.nullable().optional(),
  adoptedOpeningSnapshots: z.array(jsonRecordSchema).max(20).optional(),
  displayText: z.string().max(100_000),
  editorDocument: jsonRecordSchema,
  currentDocumentParagraphs: z.array(z.object({
    id: idSchema, position: z.number().int().nonnegative(), text: z.string().max(300_000)
  }).strict()).max(2_000).default([]),
  references: z.array(structuredReferenceUseSchema).max(500),
  constraints: z.array(contentConstraintSchema).max(1_000),
  includeProjectContext: z.boolean(),
  resourceSelection: z.object({
    taskContentTypeId: idSchema.optional(),
    taskTemplateId: idSchema.nullable().optional(),
    excludedRecommendedResourceIds: z.array(idSchema).max(100).optional(),
    manualResourceIds: z.array(idSchema).max(100).optional(),
    supportingMaterialIds: z.array(idSchema).max(100).optional()
  }).strict().optional(),
  webSearchMode: z.enum(SCRIPT_REVISION_WEB_SEARCH_MODES),
  factRegion: z.string().trim().min(2).max(32),
  factAsOf: z.string().datetime(),
  aiCount: z.union([z.literal(1), z.literal(2)]),
  targets: z.array(z.object({
    providerConfigId: idSchema,
    requestedModel: z.string().trim().min(1).max(200),
    requestedReasoningEffort: z.string().trim().max(100).nullable().optional(),
    historyThreadId: idSchema.nullable().optional(),
    providerThreadId: z.string().max(500).nullable().optional(),
    historyMessageIds: z.array(idSchema).max(100).optional()
  }).strict()).min(1).max(2)
}).strict().superRefine((value, context) => {
  if (value.targets.length !== value.aiCount) context.addIssue({ code: 'custom', message: '发送目标数量必须与AI数量一致', path: ['targets'] })
})

export const contentInstructionRequestGetPayloadSchema = z.object({ requestId: idSchema }).strict()
export const contentInstructionRequestGetByTaskPayloadSchema = z.object({ taskId: idSchema }).strict()
