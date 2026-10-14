import { z } from 'zod'
import { formatContentProviderInput, type ContentProviderInputSnapshot } from './content-provider-input'
import {
  CONTENT_FACT_ANNOTATION_PROMPT,
  providerContentFactAnnotationJsonSchema,
  providerContentFactAnnotationsSchema
} from './content-fact-annotation'
import type { DraftAlignmentMatchType, DraftParagraphSnapshot, ProjectGenerationContext } from '../shared/domain'

export const DRAFT_COMPARISON_MAXIMUM_CHARACTERS = 480_000
export const DRAFT_COMPARISON_TASK_TIMEOUT_MILLISECONDS = 10 * 60_000

export const draftCandidateQuickIntentSchema = z.enum([
  'regenerate',
  'polish',
  'concise',
  'humorous',
  'expand',
  'conversational'
])

const cliProviderSecuritySchema = z.object({
  provider: z.enum(['codex_cli', 'claude_cli']),
  providerConfigId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(160),
  cliVersion: z.string().min(1),
  fingerprint: z.string().min(1),
  policyVersion: z.string().min(1)
}).strict()

const externalProviderSecuritySchema = z.object({
  provider: z.literal('external_api'),
  providerConfigId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(160),
  kind: z.enum(['openai_api', 'anthropic_api', 'gemini_api', 'deepseek_api', 'openai_compatible']),
  baseUrl: z.string().min(1).max(2_000),
  model: z.string().min(1).max(160),
  configurationUpdatedAt: z.string().min(1)
}).strict()

export const draftTextProviderSecuritySchema = z.discriminatedUnion('provider', [
  cliProviderSecuritySchema,
  externalProviderSecuritySchema
])

const paragraphSchema = z.object({
  id: z.string().min(1).max(128),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(80_000)
}).strict()

const sourceSnapshotSchema = z.object({
  id: z.string().min(1),
  side: z.enum(['claude', 'codex']),
  content: z.string().min(1).max(1_000_000),
  paragraphs: z.array(paragraphSchema).min(1).max(2_000)
}).strict()

const reusedAlignmentGroupSchema = z.object({
  sourceGroupId: z.string().min(1),
  sourcePosition: z.number().int().nonnegative().default(0),
  sourceLabelIndex: z.number().int().positive().default(1),
  claudeParagraphIds: z.array(z.string().min(1).max(128)).max(2_000),
  codexParagraphIds: z.array(z.string().min(1).max(128)).max(2_000),
  matchType: z.enum(['exact', 'related', 'claude_only', 'codex_only', 'needs_review']),
  outlinePlacement: z.enum(['outline_item', 'outside_outline']).default('outside_outline'),
  outlineItemId: z.string().min(1).max(128).nullable().default(null),
  manuallyAdjusted: z.boolean()
}).strict()

const projectGenerationContextSnapshotSchema = z.custom<ProjectGenerationContext>((value) => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ProjectGenerationContext>
  return record.version === 1
    && typeof record.createdAt === 'string'
    && Boolean(record.project && typeof record.project.id === 'string')
})

const draftAlignmentOutlineSnapshotSchema = z.object({
  versionId: z.string().min(1).max(128),
  contentHash: z.string().min(1).max(128),
  name: z.string().max(120).nullable(),
  items: z.array(z.object({
    id: z.string().min(1).max(128),
    text: z.string().min(1).max(4_000)
  }).strict()).min(1).max(200)
}).strict()

export const draftAlignmentTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  claudeSnapshot: sourceSnapshotSchema,
  codexSnapshot: sourceSnapshotSchema,
  alignmentMode: z.enum(['full', 'incremental']).default('full'),
  baseSessionId: z.string().min(1).nullable().default(null),
  requestedParagraphIds: z.object({
    claude: z.array(z.string().min(1).max(128)).max(2_000),
    codex: z.array(z.string().min(1).max(128)).max(2_000)
  }).strict().nullable().default(null),
  reusedGroups: z.array(reusedAlignmentGroupSchema).max(2_000).default([]),
  outline: draftAlignmentOutlineSnapshotSchema.nullable().default(null),
  projectContext: projectGenerationContextSnapshotSchema.nullable().default(null),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: z.object({
    estimatedCharacters: z.number().int().nonnegative(),
    maximumCharacters: z.number().int().positive()
  }).strict()
}).strict()

const alignmentGroupSchema = z.object({
  claudeParagraphIds: z.array(z.string().min(1).max(128)).max(2_000),
  codexParagraphIds: z.array(z.string().min(1).max(128)).max(2_000),
  matchType: z.enum(['exact', 'related', 'claude_only', 'codex_only', 'needs_review']),
  outlinePlacement: z.enum(['outline_item', 'outside_outline']).optional(),
  outlineItemId: z.string().min(1).max(128).nullable().optional()
}).strict().refine((group) => group.claudeParagraphIds.length + group.codexParagraphIds.length > 0, '对照组不能为空')

export const draftAlignmentProviderOutputSchema = z.object({
  groups: z.array(alignmentGroupSchema).min(1).max(2_000)
}).strict()

export const draftAlignmentOutputJsonSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          claudeParagraphIds: { type: 'array', items: { type: 'string' } },
          codexParagraphIds: { type: 'array', items: { type: 'string' } },
          matchType: { type: 'string', enum: ['exact', 'related', 'claude_only', 'codex_only', 'needs_review'] },
          outlinePlacement: { type: 'string', enum: ['outline_item', 'outside_outline'] },
          outlineItemId: { type: ['string', 'null'] }
        },
        required: ['claudeParagraphIds', 'codexParagraphIds', 'matchType', 'outlinePlacement', 'outlineItemId'],
        additionalProperties: false
      }
    }
  },
  required: ['groups'],
  additionalProperties: false
} as const

const codexDraftRuntimeSchema = z.object({
  providerThreadId: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']),
  webSearches: z.array(z.object({
    type: z.enum(['search', 'open_page', 'find_in_page', 'other']),
    query: z.string().nullable(),
    url: z.string().nullable(),
    runtimeAccessId: z.string().min(1).max(500).nullable().optional(),
    accessedAt: z.string().datetime().nullable().optional()
  }))
}).strict()

export const draftAlignmentWorkerResultSchema = z.object({
  output: draftAlignmentProviderOutputSchema,
  runtime: codexDraftRuntimeSchema
}).strict()

export const draftCandidateTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  groupId: z.string().min(1),
  parentCandidateId: z.string().min(1).nullable(),
  claudeParagraphs: z.array(paragraphSchema).max(2_000),
  codexParagraphs: z.array(paragraphSchema).max(2_000),
  neighboringContext: z.object({
    before: z.string().max(80_000),
    after: z.string().max(80_000)
  }).strict(),
  existingCandidates: z.array(z.object({
    id: z.string().min(1),
    content: z.string().min(1).max(80_000),
    revisionRound: z.number().int().positive().default(1)
  }).strict()).max(100),
  target: z.object({
    kind: z.enum(['group', 'claude', 'codex', 'candidate', 'current']),
    sourceId: z.string().min(1).max(128).nullable(),
    content: z.string().min(1).max(DRAFT_COMPARISON_MAXIMUM_CHARACTERS)
  }).strict().default({ kind: 'group', sourceId: null, content: '（旧任务未冻结独立目标，按当前组处理）' }),
  selectedText: z.string().min(1).max(80_000).nullable().default(null),
  selectionStart: z.number().int().nonnegative().nullable().default(null),
  selectionEnd: z.number().int().nonnegative().nullable().default(null),
  quickIntent: draftCandidateQuickIntentSchema.nullable().default(null),
  customRequirement: z.string().max(30_000).default(''),
  requirement: z.string().min(1).max(30_000),
  preferredModel: z.string().min(1).max(160).nullable().default(null),
  preferredReasoningEffort: z.string().min(1).max(64).nullable().default(null),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']).default('disabled'),
  targetDecisionFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  sourceSelections: z.array(z.custom<import('../shared/domain').ContentSourceSelectionSnapshot>()).max(100).default([]),
  inheritedConflicts: z.array(z.custom<import('../shared/domain').ContentSelectionConflict>()).max(100).default([]),
  projectContext: projectGenerationContextSnapshotSchema.nullable().default(null),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: z.object({
    estimatedCharacters: z.number().int().nonnegative(),
    maximumCharacters: z.number().int().positive()
  }).strict()
}).strict()

export const draftCandidateProviderOutputSchema = z.object({
  content: z.string().min(1).max(80_000),
  summary: z.string().min(1).max(2_000),
  rationale: z.string().max(4_000),
  annotations: providerContentFactAnnotationsSchema,
  conflicts: z.array(z.object({
    id: z.string().min(1).max(128), kind: z.enum(['fact', 'brief', 'real_experience']),
    summary: z.string().min(1).max(2_000), sourceSelectionIds: z.array(z.string().min(1).max(128)).max(20),
    sourceExcerpts: z.array(z.string().max(4_000)).max(20)
  }).strict()).max(100).default([])
}).strict()

export const draftCandidateOutputJsonSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    summary: { type: 'string' },
    rationale: { type: 'string' },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'brief', 'real_experience'] },
          summary: { type: 'string' }, sourceSelectionIds: { type: 'array', items: { type: 'string' } },
          sourceExcerpts: { type: 'array', items: { type: 'string' } }
        },
        required: ['id', 'kind', 'summary', 'sourceSelectionIds', 'sourceExcerpts'], additionalProperties: false
      }
    },
    annotations: { type: 'array', items: providerContentFactAnnotationJsonSchema }
  },
  required: ['content', 'summary', 'rationale', 'conflicts', 'annotations'],
  additionalProperties: false
} as const

export const draftCandidateWorkerResultSchema = z.object({
  output: draftCandidateProviderOutputSchema,
  runtime: codexDraftRuntimeSchema
}).strict()

export const draftSplitMatchTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  groupId: z.string().min(1),
  strategy: z.enum(['original_order', 'extract_below']),
  side: z.enum(['claude', 'codex']),
  selectedParagraphIds: z.array(z.string().min(1).max(128)).min(1).max(2_000),
  selectedParagraphs: z.array(paragraphSchema).min(1).max(2_000),
  oppositeParagraphs: z.array(paragraphSchema).min(1).max(2_000),
  neighboringContext: z.object({
    before: z.string().max(20_000),
    after: z.string().max(20_000)
  }).strict(),
  contentHash: z.string().min(1).max(128),
  providerSecurity: cliProviderSecuritySchema.extend({ provider: z.literal('codex_cli') }).strict(),
  inputBudget: z.object({
    estimatedCharacters: z.number().int().nonnegative(),
    maximumCharacters: z.number().int().positive()
  }).strict()
}).strict()

export const draftSplitMatchProviderOutputSchema = z.object({
  matchedParagraphIds: z.array(z.string().min(1).max(128)).max(2_000)
}).strict()

export const draftSplitMatchOutputJsonSchema = {
  type: 'object',
  properties: {
    matchedParagraphIds: { type: 'array', items: { type: 'string' } }
  },
  required: ['matchedParagraphIds'],
  additionalProperties: false
} as const

export const draftSplitMatchWorkerResultSchema = z.object({
  output: draftSplitMatchProviderOutputSchema,
  runtime: codexDraftRuntimeSchema
}).strict()

export type DraftSplitMatchTaskSnapshot = z.infer<typeof draftSplitMatchTaskSnapshotSchema>
export type DraftSplitMatchProviderOutput = z.infer<typeof draftSplitMatchProviderOutputSchema>

export function parseDraftSplitMatchTaskSnapshot(input: string): DraftSplitMatchTaskSnapshot {
  return draftSplitMatchTaskSnapshotSchema.parse(JSON.parse(input))
}

export function buildDraftSplitMatchPrompt(snapshot: DraftSplitMatchTaskSnapshot): string {
  return [
    '你正在为两份文案执行组内语义匹配。只输出JSON，不解释。',
    '任务：找出对侧中与已选段落表达同一内容、承担同一结构功能或应当一起拆分的段落ID。',
    '宁可少选，不要把整组无关段落全部选入。保持对侧原始顺序。',
    snapshot.strategy === 'original_order' ? '为了保持阅读顺序，返回的对侧段落必须连续。' : '可以返回不连续段落。',
    '不得返回输入列表之外的ID。',
    '',
    `当前侧：${snapshot.side}`,
    `已选段落：${JSON.stringify(snapshot.selectedParagraphs)}`,
    `对侧候选：${JSON.stringify(snapshot.oppositeParagraphs)}`,
    `前文：${snapshot.neighboringContext.before || '无'}`,
    `后文：${snapshot.neighboringContext.after || '无'}`,
    '',
    '输出：{"matchedParagraphIds":["..."]}'
  ].join('\n')
}

export function validateDraftSplitMatchOutput(
  snapshot: DraftSplitMatchTaskSnapshot,
  raw: unknown
): DraftSplitMatchProviderOutput {
  const output = draftSplitMatchProviderOutputSchema.parse(raw)
  const known = new Set(snapshot.oppositeParagraphs.map((paragraph) => paragraph.id))
  if (new Set(output.matchedParagraphIds).size !== output.matchedParagraphIds.length) throw new Error('DRAFT_SPLIT_MATCH_DUPLICATE_ID')
  if (output.matchedParagraphIds.some((id) => !known.has(id))) throw new Error('DRAFT_SPLIT_MATCH_UNKNOWN_ID')
  if (snapshot.strategy === 'original_order' && output.matchedParagraphIds.length > 1) {
    const selected = new Set(output.matchedParagraphIds)
    const indexes = snapshot.oppositeParagraphs.flatMap((paragraph, index) => selected.has(paragraph.id) ? [index] : [])
    if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) {
      throw new Error('DRAFT_SPLIT_MATCH_NOT_CONTIGUOUS')
    }
  }
  return output
}

export const draftSourceGenerationTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  side: z.enum(['claude', 'codex']),
  currentContent: z.string().max(1_000_000),
  requirement: z.string().min(1).max(30_000),
  projectContext: projectGenerationContextSnapshotSchema.nullable().default(null),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: z.object({
    estimatedCharacters: z.number().int().nonnegative(),
    maximumCharacters: z.number().int().positive()
  }).strict()
}).strict()

export const draftSourceGenerationProviderOutputSchema = z.object({
  content: z.string().min(1).max(1_000_000),
  summary: z.string().min(1).max(2_000)
}).strict()

export const draftSourceGenerationOutputJsonSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    summary: { type: 'string' }
  },
  required: ['content', 'summary'],
  additionalProperties: false
} as const

export const draftSourceWorkerResultSchema = z.object({
  output: draftSourceGenerationProviderOutputSchema,
  runtime: z.object({
    providerThreadId: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1),
    webSearchMode: z.enum(['automatic', 'required', 'disabled']),
    webSearches: z.array(z.object({
      type: z.enum(['search', 'open_page', 'find_in_page', 'other']),
      query: z.string().nullable(),
      url: z.string().nullable(),
      runtimeAccessId: z.string().min(1).max(500).nullable().optional()
    }))
  }).strict()
}).strict()

export type DraftAlignmentTaskSnapshot = z.infer<typeof draftAlignmentTaskSnapshotSchema>
export type DraftAlignmentProviderOutput = z.input<typeof draftAlignmentProviderOutputSchema>
export type DraftCandidateTaskSnapshot = z.infer<typeof draftCandidateTaskSnapshotSchema>
export type DraftCandidateProviderOutput = z.infer<typeof draftCandidateProviderOutputSchema>
export type DraftSourceGenerationTaskSnapshot = z.infer<typeof draftSourceGenerationTaskSnapshotSchema>
export type DraftSourceGenerationProviderOutput = z.infer<typeof draftSourceGenerationProviderOutputSchema>

function requestedAlignmentParagraphs(snapshot: DraftAlignmentTaskSnapshot): {
  claude: DraftParagraphSnapshot[]
  codex: DraftParagraphSnapshot[]
} {
  if (snapshot.alignmentMode !== 'incremental' || !snapshot.requestedParagraphIds) {
    return { claude: snapshot.claudeSnapshot.paragraphs, codex: snapshot.codexSnapshot.paragraphs }
  }
  const claudeIds = new Set(snapshot.requestedParagraphIds.claude)
  const codexIds = new Set(snapshot.requestedParagraphIds.codex)
  return {
    claude: snapshot.claudeSnapshot.paragraphs.filter((paragraph) => claudeIds.has(paragraph.id)),
    codex: snapshot.codexSnapshot.paragraphs.filter((paragraph) => codexIds.has(paragraph.id))
  }
}

export function splitDraftParagraphs(content: string, side: 'claude' | 'codex'): DraftParagraphSnapshot[] {
  const visible = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
  return visible.split(/\n+/)
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text, position) => ({ id: `${side}-p-${position + 1}`, position, text }))
}

export function estimateDraftComparisonInput(...values: string[]): { estimatedCharacters: number; maximumCharacters: number } {
  return {
    estimatedCharacters: values.reduce((sum, value) => sum + value.length, 0),
    maximumCharacters: DRAFT_COMPARISON_MAXIMUM_CHARACTERS
  }
}

export function assertDraftComparisonInputBudget(budget: { estimatedCharacters: number; maximumCharacters: number }): void {
  if (budget.estimatedCharacters > budget.maximumCharacters) throw new Error('DRAFT_COMPARISON_INPUT_TOO_LARGE')
}

export function parseDraftAlignmentTaskSnapshot(input: string): DraftAlignmentTaskSnapshot {
  return draftAlignmentTaskSnapshotSchema.parse(JSON.parse(input))
}

export function parseDraftCandidateTaskSnapshot(input: string): DraftCandidateTaskSnapshot {
  return draftCandidateTaskSnapshotSchema.parse(JSON.parse(input))
}

export function parseDraftSourceGenerationTaskSnapshot(input: string): DraftSourceGenerationTaskSnapshot {
  return draftSourceGenerationTaskSnapshotSchema.parse(JSON.parse(input))
}

function taggedJson(label: string, value: unknown): string {
  return `<${label}>\n${JSON.stringify(value)}\n</${label}>`
}

export function buildDraftAlignmentPrompt(snapshot: DraftAlignmentTaskSnapshot): string {
  const requested = requestedAlignmentParagraphs(snapshot)
  return [
    '你正在执行LY Creator OS中的双稿语义对齐任务。',
    snapshot.alignmentMode === 'incremental'
      ? `这是增量对照：未修改的${snapshot.reusedGroups.length}组已经由系统安全复用。只根据下方发生变化或受影响的冻结段落${snapshot.projectContext ? '和用户明确勾选的项目上下文' : ''}建立新组，不要重新检查未发送的正文。`
      : `只根据下方冻结段落${snapshot.projectContext ? '和用户明确勾选的项目上下文' : ''}建立对照组；不得改写、删减或新增任何段落，不得读取其他文件、调用工具、执行命令或访问网页。`,
    '不得读取其他文件、调用工具、执行命令或访问网页。',
    '每个段落ID必须且只能出现一次。一对多、多对一和单边独有内容都可以形成一组。',
    'exact表示表达基本一致，related表示含义相关但侧重点不同，单边内容使用claude_only或codex_only，无法判断使用needs_review。',
    snapshot.outline
      ? '优先参照冻结大纲的项目顺序做组对组语义对照；属于某个大纲父组时返回outlinePlacement=outline_item及对应outlineItemId；大纲未覆盖的开头、过渡、补充或结尾必须单独返回outlinePlacement=outside_outline且outlineItemId=null。大纲只帮助判断结构，不得据此新增、改写或删除正文段落。'
      : '本次未启用大纲参照，只依据两份冻结正文的语义与顺序分组。',
    '保持原稿整体顺序，返回严格JSON。',
    '',
    ...(snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
    ...(snapshot.outline ? [taggedJson('FROZEN_OUTLINE', snapshot.outline)] : []),
    taggedJson('CLAUDE_PARAGRAPHS', requested.claude),
    taggedJson('CODEX_PARAGRAPHS', requested.codex)
  ].join('\n')
}

export function validateDraftAlignmentOutput(snapshot: DraftAlignmentTaskSnapshot, raw: unknown): DraftAlignmentProviderOutput {
  if (snapshot.outline) {
    const rawGroups = raw && typeof raw === 'object' && Array.isArray((raw as { groups?: unknown }).groups)
      ? (raw as { groups: unknown[] }).groups
      : []
    if (rawGroups.some((group) => (
      !group || typeof group !== 'object'
      || !Object.prototype.hasOwnProperty.call(group, 'outlinePlacement')
      || !Object.prototype.hasOwnProperty.call(group, 'outlineItemId')
    ))) throw new Error('PROVIDER_DRAFT_ALIGNMENT_OUTLINE_INVALID')
  }
  const parsedOutput = draftAlignmentProviderOutputSchema.parse(raw)
  const output = {
    groups: parsedOutput.groups.map((group) => ({
      ...group,
      outlinePlacement: group.outlinePlacement ?? 'outside_outline' as const,
      outlineItemId: group.outlineItemId ?? null
    }))
  }
  const requested = requestedAlignmentParagraphs(snapshot)
  const expectedClaude = new Set(requested.claude.map((paragraph) => paragraph.id))
  const expectedCodex = new Set(requested.codex.map((paragraph) => paragraph.id))
  const seenClaude = new Set<string>()
  const seenCodex = new Set<string>()
  const orderedClaude: string[] = []
  const orderedCodex: string[] = []
  const outlineIndexes = new Map(snapshot.outline?.items.map((item, index) => [item.id, index]) ?? [])
  let lastOutlineIndex = -1
  for (const group of output.groups) {
    if (group.outlinePlacement === 'outline_item') {
      const outlineIndex = group.outlineItemId ? outlineIndexes.get(group.outlineItemId) : undefined
      if (outlineIndex === undefined || outlineIndex < lastOutlineIndex) throw new Error('PROVIDER_DRAFT_ALIGNMENT_OUTLINE_INVALID')
      lastOutlineIndex = outlineIndex
    } else if (group.outlineItemId !== null) {
      throw new Error('PROVIDER_DRAFT_ALIGNMENT_OUTLINE_INVALID')
    }
    if (!snapshot.outline && (group.outlinePlacement !== 'outside_outline' || group.outlineItemId !== null)) {
      throw new Error('PROVIDER_DRAFT_ALIGNMENT_OUTLINE_INVALID')
    }
    for (const id of group.claudeParagraphIds) {
      if (!expectedClaude.has(id) || seenClaude.has(id)) throw new Error('PROVIDER_DRAFT_ALIGNMENT_INVALID')
      seenClaude.add(id)
      orderedClaude.push(id)
    }
    for (const id of group.codexParagraphIds) {
      if (!expectedCodex.has(id) || seenCodex.has(id)) throw new Error('PROVIDER_DRAFT_ALIGNMENT_INVALID')
      seenCodex.add(id)
      orderedCodex.push(id)
    }
    const expectedMatchType: DraftAlignmentMatchType | null = group.claudeParagraphIds.length === 0
      ? 'codex_only'
      : group.codexParagraphIds.length === 0 ? 'claude_only' : null
    if (expectedMatchType && group.matchType !== expectedMatchType) throw new Error('PROVIDER_DRAFT_ALIGNMENT_INVALID')
    if (!expectedMatchType && (group.matchType === 'claude_only' || group.matchType === 'codex_only')) throw new Error('PROVIDER_DRAFT_ALIGNMENT_INVALID')
  }
  if (seenClaude.size !== expectedClaude.size || seenCodex.size !== expectedCodex.size) throw new Error('PROVIDER_DRAFT_ALIGNMENT_INVALID')
  if (
    orderedClaude.some((id, index) => id !== requested.claude[index]?.id)
    || orderedCodex.some((id, index) => id !== requested.codex[index]?.id)
  ) throw new Error('PROVIDER_DRAFT_ALIGNMENT_INVALID')
  return output
}

export function buildDraftCandidatePrompt(snapshot: DraftCandidateTaskSnapshot, providerInput: ContentProviderInputSnapshot | null = null): string {
  return [
    '你正在执行LY Creator OS中一个明确对照组的受控文案改写任务。',
    snapshot.selectedText
      ? `只改写TARGET_SOURCE中明确给出的SELECTED_TEXT，不要改动或返回选区之外的文字。必要时参考邻接上下文${snapshot.projectContext ? '和用户明确勾选的项目上下文' : ''}；不得读取其他文件、执行命令或调用未授权工具。`
      : `只处理下方TARGET_SOURCE，必要时参考当前组、邻接上下文${snapshot.projectContext ? '和用户明确勾选的项目上下文' : ''}；不得读取其他文件、执行命令或调用未授权工具。`,
    snapshot.webSearchMode === 'disabled'
      ? '本轮关闭联网，不得声称查过网页。'
      : '遇到可能变化的参数、型号、价格或时间时，使用本轮受控WebSearch／WebFetch核验；查不到可靠来源不得编造。',
    CONTENT_FACT_ANNOTATION_PROMPT,
    '输出一个新的独立候选，不覆盖原稿或旧候选。保留事实和参数，不要声称已经应用或保存。',
    '如果多个来源在事实、Brief要求或用户真实体验上冲突，必须写入conflicts，不得静默选边；用户真实体验优先于网络普遍结论，但参数仍需保持准确。',
    '',
    ...(providerInput ? [formatContentProviderInput(providerInput)] : snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
    taggedJson('CLAUDE_PARAGRAPHS', snapshot.claudeParagraphs),
    taggedJson('CODEX_PARAGRAPHS', snapshot.codexParagraphs),
    taggedJson('TARGET_SOURCE', snapshot.target),
    taggedJson('SOURCE_SELECTIONS', snapshot.sourceSelections),
    ...(snapshot.inheritedConflicts.length ? [taggedJson('UNRESOLVED_SOURCE_CONFLICTS', snapshot.inheritedConflicts)] : []),
    ...(snapshot.selectedText ? [taggedJson('SELECTED_TEXT', snapshot.selectedText)] : []),
    taggedJson('EXISTING_CANDIDATES', snapshot.existingCandidates),
    taggedJson('NEIGHBORING_CONTEXT', snapshot.neighboringContext),
    taggedJson('QUICK_INTENT', snapshot.quickIntent),
    taggedJson('CUSTOM_REQUIREMENT', snapshot.customRequirement),
    taggedJson('USER_REQUIREMENT', snapshot.requirement)
  ].join('\n')
}

export function buildDraftSourceGenerationPrompt(snapshot: DraftSourceGenerationTaskSnapshot): string {
  return [
    '你正在LY Creator OS中生成一份完整工作稿。',
    `只根据用户要求、当前工作稿${snapshot.projectContext ? '和用户明确勾选的项目上下文' : ''}生成完整正文；不得读取其他文件、调用工具、执行命令或访问网页。`,
    '如果当前工作稿非空，在保留事实与参数的前提下完善；如果为空，则按用户要求从头生成。',
    '只返回完整稿件与一句简短摘要，不要声称已经保存、采用或发布。',
    '',
    ...(snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
    taggedJson('SIDE', snapshot.side),
    taggedJson('CURRENT_DRAFT', snapshot.currentContent),
    taggedJson('USER_REQUIREMENT', snapshot.requirement)
  ].join('\n')
}

export function buildCodexDraftSourceGenerationTurnInput(snapshot: DraftSourceGenerationTaskSnapshot): string {
  return [
    '本轮需要生成一份完整、可继续编辑的中文自媒体工作稿，不是广告短句或几段概念文案。',
    '允许联网自动查证当前参数、版本和其他可能变化的事实。新增外部事实应尽量给出来源；查不到可靠来源时不要补写。',
    '用户确认的真实体验、Brief和项目内锁定事实优先于网页。不得虚构第一人称体验、测试过程或用户没有提供的结论。',
    '如果当前工作稿非空，在保留事实与参数的前提下完善；如果为空，则按用户要求从头生成。',
    '按本轮输出Schema只返回完整稿件与一句简短摘要，不要声称已经保存、采用或发布。',
    '',
    ...(snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
    taggedJson('SIDE', snapshot.side),
    taggedJson('CURRENT_DRAFT', snapshot.currentContent),
    taggedJson('USER_REQUIREMENT', snapshot.requirement)
  ].join('\n')
}
