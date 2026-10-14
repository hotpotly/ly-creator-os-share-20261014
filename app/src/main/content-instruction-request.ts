import { createHash, randomUUID } from 'node:crypto'
import type {
  ContentConstraint,
  ContentInstructionInputBudget,
  ContentInstructionRequest,
  ContentInstructionSurface,
  ContentInstructionTargetPreparation,
  ContentTargetSnapshot,
  FrozenStructuredReference,
  StructuredReferenceAvailability,
  StructuredReferenceSourceKind,
  StructuredReferenceUse
} from '../shared/domain'

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, nested]) => [key, canonicalize(nested)]))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalSha256(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)))
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  Object.values(value as Record<string, unknown>).forEach((nested) => deepFreeze(nested))
  return value
}

export function structuredReferenceSourceKey(projectId: string, sourceKind: StructuredReferenceSourceKind, sourceId: string): string {
  return `ref_v1_${sha256(`${projectId}\n${sourceKind}\n${sourceId}`).slice(0, 32)}`
}

export interface ResolvedStructuredReferenceContent {
  use: StructuredReferenceUse
  sourceVersion: string
  textContent: string | null
  managedAssetId: string | null
  binarySha256: string | null
  visualCapability: FrozenStructuredReference['visualCapability']
  visualSummaryVersion: string | null
  frozenMembers?: FrozenStructuredReference['frozenMembers']
  availability: StructuredReferenceAvailability
}

export function freezeStructuredReference(input: ResolvedStructuredReferenceContent): FrozenStructuredReference {
  if (input.binarySha256 && !SHA256_PATTERN.test(input.binarySha256)) throw new Error('引用文件哈希无效')
  const contentSha256 = input.textContent === null
    ? input.binarySha256 ?? sha256('')
    : sha256(input.textContent)
  const use = structuredClone(input.use)
  return deepFreeze({
    ...use,
    sourceVersion: input.sourceVersion,
    contentSha256,
    frozenTextContent: input.textContent,
    managedAssetId: input.managedAssetId,
    binarySha256: input.binarySha256,
    visualCapability: input.visualCapability,
    visualSummaryVersion: input.visualSummaryVersion,
    frozenMembers: [...(input.frozenMembers ?? [])].sort((left, right) => left.order - right.order),
    availability: input.availability
  })
}

export function estimateContentTokens(value: string): number {
  let ascii = 0
  for (const character of value) if (character.codePointAt(0)! <= 0x7f) ascii += 1
  const nonAscii = value.length - ascii
  return Math.max(0, Math.ceil(ascii / 4) + nonAscii)
}

const nonTruncatableRoles = new Set<FrozenStructuredReference['role']>(['hard_constraint', 'key_adoption', 'style_reference'])

function effectiveReferenceRole(reference: FrozenStructuredReference): FrozenStructuredReference['role'] {
  return reference.runtimeRole ?? reference.role
}

function estimateReferenceTokens(reference: FrozenStructuredReference): number {
  const frozenMemberImageTokens = reference.frozenMembers.filter((member) => Boolean(member.binarySha256)).length * 1_024
  if (reference.frozenTextContent !== null) return estimateContentTokens(reference.frozenTextContent) + frozenMemberImageTokens
  if (reference.visualCapability === 'native_image_input') return 1_024
  if (reference.binarySha256) return 256
  return frozenMemberImageTokens
}

export function allocateContentInstructionBudget(input: {
  maxTokens: number
  baseText: string
  references: FrozenStructuredReference[]
  reservedTokens?: number
}): ContentInstructionInputBudget {
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 256) throw new Error('输入预算至少为256 tokens')
  const reservedTokens = input.reservedTokens ?? 0
  if (!Number.isInteger(reservedTokens) || reservedTokens < 0) throw new Error('保留输入预算无效')
  let estimatedTokens = estimateContentTokens(input.baseText) + reservedTokens
  if (estimatedTokens > input.maxTokens) throw new Error('请求正文或项目上下文超过输入预算，不能静默截断')
  const hardConstraintTokens = input.references
    .filter((reference) => effectiveReferenceRole(reference) === 'hard_constraint')
    .reduce((sum, reference) => sum + estimateReferenceTokens(reference), 0)
  const requiredReferences = input.references.filter((reference) => nonTruncatableRoles.has(effectiveReferenceRole(reference)))
  const requiredTokens = requiredReferences.reduce((sum, reference) => sum + estimateReferenceTokens(reference), 0)
  if (estimatedTokens + requiredTokens > input.maxTokens) {
    throw new Error('硬性、重点或风格引用超过输入预算，不能静默截断')
  }
  estimatedTokens += requiredTokens
  const truncatedOrdinaryReferenceIds: string[] = []
  input.references.filter((reference) => !nonTruncatableRoles.has(effectiveReferenceRole(reference))).forEach((reference) => {
    const tokens = estimateReferenceTokens(reference)
    if (estimatedTokens + tokens > input.maxTokens) truncatedOrdinaryReferenceIds.push(reference.occurrenceId)
    else estimatedTokens += tokens
  })
  return { maxTokens: input.maxTokens, estimatedTokens, hardConstraintTokens, truncatedOrdinaryReferenceIds }
}

export interface BuildContentInstructionRequestInput {
  id?: string
  projectId: string
  sessionScope: string
  surface: ContentInstructionSurface
  supersedesRequestId?: string | null
  generationId?: string | null
  target: ContentTargetSnapshot | null
  materialRevisionId?: string | null
  materialRevisionContentHash?: string | null
  briefVersionId?: string | null
  briefVersionContentHash?: string | null
  outlineVersionId?: string | null
  outlineVersionContentHash?: string | null
  adoptedOpeningSnapshots?: Array<Record<string, unknown>>
  displayText: string
  editorDocument: Record<string, unknown>
  currentDocumentParagraphs?: Array<{ id: string; position: number; text: string }>
  references: FrozenStructuredReference[]
  constraints: ContentConstraint[]
  projectContextSnapshot: Record<string, unknown> | null
  resourceSnapshotId?: string | null
  resourceSnapshot: Record<string, unknown> | null
  webSearchMode: ContentInstructionRequest['webSearchMode']
  factRegion: string
  factAsOf: string
  maxInputTokens: number
  aiCount: 1 | 2
  createdAt?: string
}

export type ContentInstructionCommonSnapshot = Omit<ContentInstructionRequest, 'id' | 'commonFingerprint' | 'createdAt'>

export function contentInstructionCommonSnapshot(request: ContentInstructionRequest): ContentInstructionCommonSnapshot {
  const common = { ...request } as Partial<ContentInstructionRequest>
  delete common.id
  delete common.commonFingerprint
  delete common.createdAt
  return common as ContentInstructionCommonSnapshot
}

export function contentInstructionCommonFingerprint(request: ContentInstructionRequest): string {
  return canonicalSha256(contentInstructionCommonSnapshot(request))
}

export function buildContentInstructionRequest(input: BuildContentInstructionRequestInput): ContentInstructionRequest {
  if (!input.projectId) throw new Error('请求缺少项目身份')
  if (!input.sessionScope.trim() || input.sessionScope.length > 120) throw new Error('请求缺少有效会话范围')
  if (input.aiCount !== 1 && input.aiCount !== 2) throw new Error('AI数量无效')
  const versionPairs = [
    ['素材修订', input.materialRevisionId, input.materialRevisionContentHash],
    ['Brief版本', input.briefVersionId, input.briefVersionContentHash],
    ['大纲版本', input.outlineVersionId, input.outlineVersionContentHash]
  ] as const
  versionPairs.forEach(([label, id, contentHash]) => {
    if (Boolean(id) !== Boolean(contentHash)) throw new Error(`${label}身份与内容哈希必须同时冻结`)
  })
  const frozenInput = structuredClone(input)
  frozenInput.sessionScope = frozenInput.sessionScope.trim()
  frozenInput.factRegion = frozenInput.factRegion.trim()
  const createdAt = frozenInput.createdAt ?? new Date().toISOString()
  const projectContextFingerprint = frozenInput.projectContextSnapshot ? canonicalSha256(frozenInput.projectContextSnapshot) : null
  const resourceSnapshotFingerprint = frozenInput.resourceSnapshot ? canonicalSha256(frozenInput.resourceSnapshot) : null
  const inputBudget = allocateContentInstructionBudget({
    maxTokens: frozenInput.maxInputTokens,
    baseText: JSON.stringify({
      surface: frozenInput.surface,
      target: frozenInput.target,
      displayText: frozenInput.displayText,
      editorDocument: frozenInput.editorDocument,
      currentDocumentParagraphs: frozenInput.currentDocumentParagraphs ?? [],
      projectContextSnapshot: frozenInput.projectContextSnapshot,
      resourceSnapshot: frozenInput.resourceSnapshot,
      adoptedOpeningSnapshots: frozenInput.adoptedOpeningSnapshots ?? [],
      constraints: frozenInput.constraints,
      providerReserve: { targetCount: frozenInput.aiCount, tokensPerTarget: 256 }
    }),
    references: frozenInput.references,
    reservedTokens: frozenInput.aiCount * 256
  })
  const common = {
    projectId: frozenInput.projectId,
    sessionScope: frozenInput.sessionScope,
    surface: frozenInput.surface,
    supersedesRequestId: frozenInput.supersedesRequestId ?? null,
    generationId: frozenInput.generationId ?? null,
    target: frozenInput.target,
    materialRevisionId: frozenInput.materialRevisionId ?? null,
    materialRevisionContentHash: frozenInput.materialRevisionContentHash ?? null,
    briefVersionId: frozenInput.briefVersionId ?? null,
    briefVersionContentHash: frozenInput.briefVersionContentHash ?? null,
    outlineVersionId: frozenInput.outlineVersionId ?? null,
    outlineVersionContentHash: frozenInput.outlineVersionContentHash ?? null,
    adoptedOpeningSnapshots: frozenInput.adoptedOpeningSnapshots ?? [],
    displayText: frozenInput.displayText,
    editorDocument: frozenInput.editorDocument,
    currentDocumentParagraphs: frozenInput.currentDocumentParagraphs ?? [],
    references: frozenInput.references,
    constraints: frozenInput.constraints,
    projectContextSnapshot: frozenInput.projectContextSnapshot,
    projectContextFingerprint,
    resourceSnapshotId: frozenInput.resourceSnapshotId ?? null,
    resourceSnapshot: frozenInput.resourceSnapshot,
    resourceSnapshotFingerprint,
    webSearchMode: frozenInput.webSearchMode,
    factRegion: frozenInput.factRegion,
    factAsOf: frozenInput.factAsOf,
    inputBudget,
    aiCount: frozenInput.aiCount
  }
  const request = {
    id: frozenInput.id ?? randomUUID(),
    ...common,
    commonFingerprint: canonicalSha256(common),
    createdAt
  }
  return deepFreeze(request)
}

export function assertContentInstructionTargetsMatchRequest(
  request: ContentInstructionRequest,
  targets: ContentInstructionTargetPreparation[]
): void {
  if (targets.length !== request.aiCount) throw new Error('请求目标数量与AI数量不一致')
  if (new Set(targets.map((target) => target.providerConfigId)).size !== targets.length) throw new Error('同一请求不能重复发送到相同Provider配置')
  targets.forEach((target) => {
    if (!target.requestedModel.trim()) throw new Error('每个发送目标都必须保留请求模型')
    if (target.providerSecurity.provider === 'codex_cli' && (!target.actualModel?.trim() || target.actualModel === 'auto')) {
      throw new Error('Codex目标必须在发送前冻结具体实际模型')
    }
    if (!target.providerSecurity.fingerprint || !target.providerSecurity.cliVersion) throw new Error('Provider安全与运行时快照不完整')
    if (request.webSearchMode === 'required' && target.providerSecurity.provider === 'claude_cli') {
      throw new Error('Claude当前不支持必须联网，请更换Provider或联网策略')
    }
  })
}
