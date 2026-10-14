import { z } from 'zod'
import type { ProjectGenerationContext, ScriptMaterialDraftParagraph, TaskResourceSnapshot } from '../shared/domain'
import { draftTextProviderSecuritySchema } from './draft-comparison'
import { formatContentProviderInput, type ContentProviderInputSnapshot } from './content-provider-input'

export const SCRIPT_MATERIAL_MAXIMUM_CHARACTERS = 480_000
export const SCRIPT_MATERIAL_TASK_TIMEOUT_MILLISECONDS = 10 * 60_000

const projectGenerationContextSnapshotSchema = z.custom<ProjectGenerationContext>((value) => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ProjectGenerationContext>
  return record.version === 1
    && typeof record.createdAt === 'string'
    && Boolean(record.project && typeof record.project.id === 'string')
})

const taskResourceSnapshotSchema = z.custom<TaskResourceSnapshot>((value) => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<TaskResourceSnapshot>
  return record.version === 1
    && typeof record.createdAt === 'string'
    && typeof record.projectId === 'string'
    && Array.isArray(record.requiredInputs)
    && Array.isArray(record.primaryReferences)
    && Array.isArray(record.supportingMaterials)
    && Array.isArray(record.automaticResources)
    && Array.isArray(record.recommendedResources)
    && Array.isArray(record.manualResources)
})

const inputBudgetSchema = z.object({
  estimatedCharacters: z.number().int().nonnegative(),
  maximumCharacters: z.number().int().positive()
}).strict()

const frozenPointSchema = z.object({
  id: z.string().min(1).max(128),
  position: z.number().int().nonnegative(),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().positive(),
  sourceText: z.string().min(1).max(80_000),
  summary: z.string().min(1).max(4_000),
  requirement: z.string().max(4_000),
  adoption: z.enum(['required', 'excluded'])
}).strict()

export const scriptMaterialExtractTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  sourceContent: z.string().min(1).max(1_000_000),
  sourceContentHash: z.string().min(1).max(128),
  projectContext: projectGenerationContextSnapshotSchema.nullable().default(null),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: inputBudgetSchema
}).strict()

const extractedPointSchema = z.object({
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().positive(),
  sourceText: z.string().min(1).max(80_000),
  summary: z.string().min(1).max(4_000)
}).strict()

export const scriptMaterialExtractProviderOutputSchema = z.object({
  points: z.array(extractedPointSchema).min(1).max(500)
}).strict()

export const scriptMaterialExtractOutputJsonSchema = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: {
        type: 'object',
        properties: {
          sourceStart: { type: 'integer', minimum: 0 },
          sourceEnd: { type: 'integer', minimum: 1 },
          sourceText: { type: 'string' },
          summary: { type: 'string' }
        },
        required: ['sourceStart', 'sourceEnd', 'sourceText', 'summary'],
        additionalProperties: false
      }
    }
  },
  required: ['points'],
  additionalProperties: false
} as const

export const scriptMaterialGenerateTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  sourceContentHash: z.string().min(1).max(128),
  side: z.enum(['codex', 'claude']),
  sourceContent: z.string().min(1).max(1_000_000),
  points: z.array(frozenPointSchema).min(1).max(500),
  requirement: z.string().max(30_000),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']),
  projectContext: projectGenerationContextSnapshotSchema.nullable().default(null),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: inputBudgetSchema
}).strict()

const webSourceSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url().max(2_000)
}).strict()

export const scriptMaterialDraftParagraphSchema = z.object({
  id: z.string().min(1).max(128),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(80_000),
  sourcePointIds: z.array(z.string().min(1).max(128)).max(500),
  transform: z.enum(['preserved', 'polished', 'expanded', 'combined', 'reordered']),
  provenance: z.array(z.enum(['source', 'ai_supplement', 'web_supplement', 'needs_confirmation'])).min(1).max(4),
  webSources: z.array(webSourceSchema).max(30),
  annotations: z.array(z.object({
    id: z.string().min(1).max(256),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(8_000),
    provenance: z.enum(['ai_supplement', 'web_supplement', 'needs_confirmation']),
    note: z.string().min(1).max(2_000),
    webSources: z.array(webSourceSchema).max(20),
    status: z.enum(['active', 'confirmed'])
  }).strict()).max(200).default([]),
  manualMarks: z.array(z.object({
    id: z.string().min(1).max(128),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(30_000),
    style: z.enum(['highlight', 'underline', 'strike'])
  }).strict()).max(500).default([])
}).strict()

export const scriptMaterialGenerateProviderOutputSchema = z.object({
  paragraphs: z.array(scriptMaterialDraftParagraphSchema).min(1).max(2_000)
}).strict()

export const scriptMaterialGenerateOutputJsonSchema = {
  type: 'object',
  properties: {
    paragraphs: {
      type: 'array',
      minItems: 1,
      maxItems: 2000,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          position: { type: 'integer', minimum: 0 },
          text: { type: 'string' },
          sourcePointIds: { type: 'array', items: { type: 'string' } },
          transform: { type: 'string', enum: ['preserved', 'polished', 'expanded', 'combined', 'reordered'] },
          provenance: {
            type: 'array',
            items: { type: 'string', enum: ['source', 'ai_supplement', 'web_supplement', 'needs_confirmation'] }
          },
          webSources: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, url: { type: 'string' } },
              required: ['title', 'url'],
              additionalProperties: false
            }
          }
        },
        required: ['id', 'position', 'text', 'sourcePointIds', 'transform', 'provenance', 'webSources'],
        additionalProperties: false
      }
    }
  },
  required: ['paragraphs'],
  additionalProperties: false
} as const

const auditParagraphSchema = z.object({
  id: z.string().min(1).max(128),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(80_000),
  sourcePointIds: z.array(z.string().min(1).max(128)).max(500)
}).strict()

export const scriptMaterialAuditTaskSnapshotSchema = z.object({
  version: z.literal(2),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  target: z.enum(['codex', 'claude', 'current']),
  targetIdentity: z.string().min(1).max(128),
  targetContentHash: z.string().min(1).max(128),
  inputFingerprint: z.string().length(64),
  points: z.array(frozenPointSchema).min(1).max(500),
  paragraphs: z.array(auditParagraphSchema).min(1).max(2_000),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: inputBudgetSchema
}).strict()

const pointCoverageSchema = z.object({
  pointId: z.string().min(1).max(128),
  status: z.enum(['complete', 'partial', 'missing', 'excluded']),
  paragraphIds: z.array(z.string().min(1).max(128)).max(2_000),
  rationale: z.string().max(4_000)
}).strict()

const paragraphFindingSchema = z.object({
  paragraphId: z.string().min(1).max(128),
  sourcePointIds: z.array(z.string().min(1).max(128)).max(500),
  provenance: z.enum(['source', 'ai_supplement', 'web_supplement', 'needs_confirmation']),
  note: z.string().max(4_000)
}).strict()

export const scriptMaterialAuditProviderOutputSchema = z.object({
  pointCoverage: z.array(pointCoverageSchema).min(1).max(500),
  paragraphFindings: z.array(paragraphFindingSchema).max(2_000)
}).strict()

export const scriptMaterialAuditOutputJsonSchema = {
  type: 'object',
  properties: {
    pointCoverage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pointId: { type: 'string' },
          status: { type: 'string', enum: ['complete', 'partial', 'missing', 'excluded'] },
          paragraphIds: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' }
        },
        required: ['pointId', 'status', 'paragraphIds', 'rationale'],
        additionalProperties: false
      }
    },
    paragraphFindings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          paragraphId: { type: 'string' },
          sourcePointIds: { type: 'array', items: { type: 'string' } },
          provenance: { type: 'string', enum: ['source', 'ai_supplement', 'web_supplement', 'needs_confirmation'] },
          note: { type: 'string' }
        },
        required: ['paragraphId', 'sourcePointIds', 'provenance', 'note'],
        additionalProperties: false
      }
    }
  },
  required: ['pointCoverage', 'paragraphFindings'],
  additionalProperties: false
} as const

const runtimeSchema = z.object({
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
  }).strict())
}).strict()

export const scriptMaterialExtractWorkerResultSchema = z.object({
  output: scriptMaterialExtractProviderOutputSchema,
  runtime: runtimeSchema
}).strict()

export const scriptMaterialGenerateWorkerResultSchema = z.object({
  output: scriptMaterialGenerateProviderOutputSchema,
  runtime: runtimeSchema
}).strict()

export const scriptMaterialAuditWorkerResultSchema = z.object({
  output: scriptMaterialAuditProviderOutputSchema,
  runtime: runtimeSchema
}).strict()

const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(1_000_000)
}).strict()

const currentDocumentParagraphSchema = z.object({
  id: z.string().min(1).max(128),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(80_000)
}).strict()

const scriptMaterialRewriteTargetSchema = z.object({
  draftId: z.string().min(1).max(128),
  parentCandidateId: z.string().min(1).max(128).nullable().default(null),
  parentCandidateContent: z.string().min(1).max(1_000_000).nullable().default(null),
  applicationTarget: z.object({
    targetId: z.string().min(1).max(256), selectedText: z.string().max(80_000), contentHash: z.string().min(1).max(128),
    from: z.number().int().nonnegative(), to: z.number().int().nonnegative()
  }).strict().nullable().default(null),
  paragraphTargets: z.array(z.object({
    paragraphId: z.string().min(1).max(128),
    position: z.number().int().nonnegative(),
    text: z.string().min(1).max(80_000),
    sourcePointIds: z.array(z.string().min(1).max(128)).max(500)
  }).strict()).min(1).max(2_000),
  selectedParagraphId: z.string().min(1).max(128).nullable(),
  selectedText: z.string().max(30_000),
  selectedStart: z.number().int().nonnegative().nullable(),
  selectedEnd: z.number().int().positive().nullable()
}).strict()

export const scriptMaterialChatTaskSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  side: z.enum(['codex', 'claude']),
  sourceContent: z.string().min(1).max(1_000_000),
  sourceContentHash: z.string().min(1).max(128),
  currentDraftContent: z.string().max(1_000_000),
  currentDocumentParagraphs: z.array(currentDocumentParagraphSchema).max(2_000).default([]),
  history: z.array(chatHistoryMessageSchema).max(200),
  historyMessageIds: z.array(z.string().min(1).max(128)).max(200).default([]),
  message: z.string().min(1).max(30_000),
  preferredModel: z.string().min(1).max(160).nullable().default(null),
  preferredReasoningEffort: z.string().min(1).max(64).nullable().default(null),
  sourceSelections: z.array(z.custom<import('../shared/domain').ContentSourceSelectionSnapshot>()).max(100).default([]),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']),
  projectContext: projectGenerationContextSnapshotSchema.nullable().default(null),
  resourceSnapshot: taskResourceSnapshotSchema.nullable().default(null),
  rewriteTarget: scriptMaterialRewriteTargetSchema.nullable().default(null),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: inputBudgetSchema
}).strict()

export const scriptMaterialChatProviderOutputSchema = z.object({
  answer: z.string().min(1).max(1_000_000),
  draftContent: z.string().min(1).max(1_000_000),
  annotations: z.array(z.object({
    text: z.string().min(1).max(8_000),
    provenance: z.enum(['ai_supplement', 'web_supplement', 'needs_confirmation']),
    note: z.string().min(1).max(2_000),
    claim: z.string().trim().min(1).max(8_000).nullable().optional().default(null),
    factType: z.enum(['fact', 'price']).nullable().optional().default(null),
    priceKind: z.enum(['launch_official', 'current_official', 'current_channel', 'user_actual']).nullable().optional().default(null),
    currency: z.string().trim().min(3).max(12).nullable().optional().default(null),
    confirmationKind: z.enum(['user_only']).nullable().optional().default(null),
    placeholderId: z.string().min(1).max(256).nullable().optional().default(null),
    webSources: z.array(z.object({
      title: z.string().min(1).max(500),
      url: z.string().url().max(4_000).refine((url) => url.startsWith('https://'), '来源必须使用HTTPS')
    }).strict()).max(20)
  }).strict()).max(200)
}).strict()

export const scriptMaterialChatOutputJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    draftContent: { type: 'string' },
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          provenance: { type: 'string', enum: ['ai_supplement', 'web_supplement', 'needs_confirmation'] },
          note: { type: 'string' },
          claim: { type: ['string', 'null'] },
          factType: { type: ['string', 'null'], enum: ['fact', 'price', null] },
          priceKind: { type: ['string', 'null'], enum: ['launch_official', 'current_official', 'current_channel', 'user_actual', null] },
          currency: { type: ['string', 'null'] },
          confirmationKind: { type: ['string', 'null'], enum: ['user_only', null] },
          placeholderId: { type: ['string', 'null'] },
          webSources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                url: { type: 'string', pattern: '^https://' }
              },
              required: ['title', 'url'],
              additionalProperties: false
            }
          }
        },
        required: ['text', 'provenance', 'note', 'claim', 'factType', 'priceKind', 'currency', 'confirmationKind', 'placeholderId', 'webSources'],
        additionalProperties: false
      }
    }
  },
  required: ['answer', 'draftContent', 'annotations'],
  additionalProperties: false
} as const

export const scriptMaterialChatWorkerResultSchema = z.object({
  output: scriptMaterialChatProviderOutputSchema,
  runtime: runtimeSchema
}).strict()

const mappingDraftParagraphSchema = z.object({
  id: z.string().min(1).max(128),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(80_000)
}).strict()

export const scriptMaterialMapTaskSnapshotSchema = z.object({
  version: z.literal(2),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  draftId: z.string().min(1).max(128),
  side: z.enum(['codex', 'claude']),
  sourceContent: z.string().min(1).max(1_000_000),
  sourceContentHash: z.string().min(1).max(128),
  draftContentHash: z.string().min(1).max(128),
  points: z.array(frozenPointSchema).min(1).max(500),
  draftParagraphs: z.array(mappingDraftParagraphSchema).min(1).max(2_000),
  currentDocumentContentHash: z.string().min(1).max(128).nullable(),
  currentDocumentParagraphs: z.array(currentDocumentParagraphSchema).max(2_000),
  providerSecurity: draftTextProviderSecuritySchema,
  inputBudget: inputBudgetSchema
}).strict()

const draftParagraphMappingSchema = z.object({
  paragraphId: z.string().min(1).max(128),
  sourcePointIds: z.array(z.string().min(1).max(128)).max(500)
}).strict()

const currentParagraphMappingSchema = z.object({
  currentParagraphId: z.string().min(1).max(128),
  sourcePointIds: z.array(z.string().min(1).max(128)).max(500),
  draftParagraphIds: z.array(z.string().min(1).max(128)).max(2_000)
}).strict()

export const scriptMaterialMapProviderOutputSchema = z.object({
  draftParagraphMappings: z.array(draftParagraphMappingSchema).min(1).max(2_000),
  currentParagraphMappings: z.array(currentParagraphMappingSchema).max(2_000)
}).strict()

export const scriptMaterialMapOutputJsonSchema = {
  type: 'object',
  properties: {
    draftParagraphMappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          paragraphId: { type: 'string' },
          sourcePointIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['paragraphId', 'sourcePointIds'],
        additionalProperties: false
      }
    },
    currentParagraphMappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          currentParagraphId: { type: 'string' },
          sourcePointIds: { type: 'array', items: { type: 'string' } },
          draftParagraphIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['currentParagraphId', 'sourcePointIds', 'draftParagraphIds'],
        additionalProperties: false
      }
    }
  },
  required: ['draftParagraphMappings', 'currentParagraphMappings'],
  additionalProperties: false
} as const

export const scriptMaterialMapWorkerResultSchema = z.object({
  output: scriptMaterialMapProviderOutputSchema,
  runtime: runtimeSchema
}).strict()

export type ScriptMaterialExtractTaskSnapshot = z.infer<typeof scriptMaterialExtractTaskSnapshotSchema>
export type ScriptMaterialGenerateTaskSnapshot = z.infer<typeof scriptMaterialGenerateTaskSnapshotSchema>
export type ScriptMaterialAuditTaskSnapshot = z.infer<typeof scriptMaterialAuditTaskSnapshotSchema>
export type ScriptMaterialChatTaskSnapshot = z.infer<typeof scriptMaterialChatTaskSnapshotSchema>
export type ScriptMaterialMapTaskSnapshot = z.infer<typeof scriptMaterialMapTaskSnapshotSchema>
export type ScriptMaterialGenerateProviderOutput = z.infer<typeof scriptMaterialGenerateProviderOutputSchema>
export type ScriptMaterialAuditProviderOutput = z.infer<typeof scriptMaterialAuditProviderOutputSchema>
export type ScriptMaterialChatProviderOutput = z.input<typeof scriptMaterialChatProviderOutputSchema>
export type ScriptMaterialMapProviderOutput = z.infer<typeof scriptMaterialMapProviderOutputSchema>

export function estimateScriptMaterialInput(...values: string[]): { estimatedCharacters: number; maximumCharacters: number } {
  return {
    estimatedCharacters: values.reduce((sum, value) => sum + value.length, 0),
    maximumCharacters: SCRIPT_MATERIAL_MAXIMUM_CHARACTERS
  }
}

export function assertScriptMaterialInputBudget(budget: { estimatedCharacters: number; maximumCharacters: number }): void {
  if (budget.estimatedCharacters > budget.maximumCharacters) throw new Error('SCRIPT_MATERIAL_INPUT_TOO_LARGE')
}

export function parseScriptMaterialExtractTaskSnapshot(input: string): ScriptMaterialExtractTaskSnapshot {
  return scriptMaterialExtractTaskSnapshotSchema.parse(JSON.parse(input))
}

export function parseScriptMaterialGenerateTaskSnapshot(input: string): ScriptMaterialGenerateTaskSnapshot {
  return scriptMaterialGenerateTaskSnapshotSchema.parse(JSON.parse(input))
}

export function parseScriptMaterialAuditTaskSnapshot(input: string): ScriptMaterialAuditTaskSnapshot {
  return scriptMaterialAuditTaskSnapshotSchema.parse(JSON.parse(input))
}

export function parseScriptMaterialChatTaskSnapshot(input: string): ScriptMaterialChatTaskSnapshot {
  return scriptMaterialChatTaskSnapshotSchema.parse(JSON.parse(input))
}

export function parseScriptMaterialMapTaskSnapshot(input: string): ScriptMaterialMapTaskSnapshot {
  return scriptMaterialMapTaskSnapshotSchema.parse(JSON.parse(input))
}

export function scriptMaterialProjectResourceSelection(
  snapshot: TaskResourceSnapshot | null
): Omit<TaskResourceSnapshot, 'generationContext'> | null {
  if (!snapshot) return null
  const selection = structuredClone(snapshot)
  delete selection.generationContext
  return selection
}

function taggedJson(label: string, value: unknown): string {
  return `<${label}>\n${JSON.stringify(value)}\n</${label}>`
}

export function buildScriptMaterialExtractPrompt(snapshot: ScriptMaterialExtractTaskSnapshot): string {
  return [
    '你正在LY Creator OS中把一份整理前的原始文案拆成可追溯的语义素材要点。',
    '只处理SOURCE_CONTENT，不得改写原文、补充事实、读取文件、调用工具、执行命令或访问网页。',
    '按语义而不是按每一句机械拆分；一个独立体验、事实、判断或待展开意图通常是一个要点。',
    '每个要点必须返回原文中的精确UTF-16起止偏移和完全一致的sourceText；要点按原文顺序返回，范围不得交叉或倒序。',
    'summary只概括这个要点，不加入原文没有的信息。返回严格JSON。',
    '',
    ...(snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
    taggedJson('SOURCE_CONTENT', snapshot.sourceContent)
  ].join('\n')
}

export function validateScriptMaterialExtractOutput(snapshot: ScriptMaterialExtractTaskSnapshot, raw: unknown): z.infer<typeof scriptMaterialExtractProviderOutputSchema> {
  const output = scriptMaterialExtractProviderOutputSchema.parse(raw)
  let lastEnd = 0
  for (const [index, point] of output.points.entries()) {
    if (point.sourceStart < lastEnd || point.sourceEnd <= point.sourceStart || point.sourceEnd > snapshot.sourceContent.length) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_SOURCE_RANGE_INVALID')
    }
    if (snapshot.sourceContent.slice(point.sourceStart, point.sourceEnd) !== point.sourceText) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_SOURCE_RANGE_INVALID')
    }
    if (!point.summary.trim()) throw new Error(`PROVIDER_SCRIPT_MATERIAL_POINT_${index + 1}_INVALID`)
    lastEnd = point.sourceEnd
  }
  return output
}

export function buildScriptMaterialGeneratePrompt(snapshot: ScriptMaterialGenerateTaskSnapshot): string {
  return [
    '你正在LY Creator OS中根据用户整理前的原始文案生成一篇完整工作稿。',
    '直接生成成稿，不先输出大纲。可以保留、润色、补写结构性衔接、合并和调整顺序。',
    '所有adoption=required的素材要点都必须被正文完整覆盖；adoption=excluded的要点本次不要采用。',
    '不得凭空新增具体体验、数字、参数或评价性事实。原稿没有依据但确需用户核实的具体内容，标记provenance=needs_confirmation。',
    snapshot.webSearchMode === 'disabled'
      ? '本次禁止联网；不得声称查过网页。'
      : snapshot.webSearchMode === 'required'
        ? '本次要求联网核实适合外部核实的内容；引用的网页必须放入webSources，联网内容标记web_supplement。'
        : '只有确实需要核实外部事实时才联网；引用的网页必须放入webSources，联网内容标记web_supplement。',
    '每个段落返回来源素材ID，可多对多。纯衔接段可没有素材ID，但必须标记ai_supplement。',
    '段落position从0连续递增；ID在本次结果内唯一。只返回严格JSON。',
    '',
    ...(snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
    taggedJson('SOURCE_CONTENT', snapshot.sourceContent),
    taggedJson('MATERIAL_POINTS', snapshot.points),
    taggedJson('OVERALL_REQUIREMENT', snapshot.requirement),
    taggedJson('WEB_SEARCH_MODE', snapshot.webSearchMode)
  ].join('\n')
}

export function validateScriptMaterialGenerateOutput(
  snapshot: ScriptMaterialGenerateTaskSnapshot,
  raw: unknown
): { paragraphs: ScriptMaterialDraftParagraph[] } {
  const output = scriptMaterialGenerateProviderOutputSchema.parse(raw)
  const pointIds = new Set(snapshot.points.map((point) => point.id))
  const paragraphIds = new Set<string>()
  for (const [index, paragraph] of output.paragraphs.entries()) {
    if (paragraph.position !== index || paragraphIds.has(paragraph.id)) throw new Error('PROVIDER_SCRIPT_MATERIAL_PARAGRAPHS_INVALID')
    paragraphIds.add(paragraph.id)
    if (paragraph.sourcePointIds.some((id) => !pointIds.has(id))) throw new Error('PROVIDER_SCRIPT_MATERIAL_POINT_REF_INVALID')
    if (!paragraph.sourcePointIds.length && !paragraph.provenance.includes('ai_supplement') && !paragraph.provenance.includes('web_supplement')) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_PROVENANCE_INVALID')
    }
    if (snapshot.webSearchMode === 'disabled' && (paragraph.webSources.length || paragraph.provenance.includes('web_supplement'))) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_WEB_SOURCE_INVALID')
    }
  }
  return {
    paragraphs: output.paragraphs.map((paragraph) => ({ ...paragraph, annotations: [], manualMarks: [] }))
  }
}

export function buildScriptMaterialAuditPrompt(snapshot: ScriptMaterialAuditTaskSnapshot): string {
  return [
    '你正在LY Creator OS中独立检查一篇文案对整理前原稿素材的覆盖和来源依据。',
    '不得润色、改写或补写文案；不得读取文件、调用工具、执行命令或访问网页。',
    '每个素材要点必须且只能返回一次覆盖结果。required要点判断complete、partial或missing；excluded要点必须返回excluded。',
    '逐段判断其内容来自哪些素材点。只有纯结构性衔接可标ai_supplement；出现原稿无法支持的具体体验、数字、参数或评价性事实时标needs_confirmation。',
    '同一段若有多条彼此独立的待确认事实，必须分别返回多条needs_confirmation finding，并在note中具体说明是哪条事实，不能合并成笼统提醒。',
    '段落和素材均允许多对多。所有引用ID必须来自冻结输入。返回严格JSON。',
    '',
    taggedJson('MATERIAL_POINTS', snapshot.points),
    taggedJson('TARGET_PARAGRAPHS', snapshot.paragraphs)
  ].join('\n')
}

export function validateScriptMaterialAuditOutput(
  snapshot: ScriptMaterialAuditTaskSnapshot,
  raw: unknown
): z.infer<typeof scriptMaterialAuditProviderOutputSchema> {
  const output = scriptMaterialAuditProviderOutputSchema.parse(raw)
  const pointIds = new Set(snapshot.points.map((point) => point.id))
  const paragraphIds = new Set(snapshot.paragraphs.map((paragraph) => paragraph.id))
  const seenPoints = new Set<string>()
  for (const coverage of output.pointCoverage) {
    if (!pointIds.has(coverage.pointId) || seenPoints.has(coverage.pointId)) throw new Error('PROVIDER_SCRIPT_MATERIAL_COVERAGE_INVALID')
    const point = snapshot.points.find((item) => item.id === coverage.pointId)!
    if (
      point.adoption === 'excluded'
        ? coverage.status !== 'excluded'
        : !['complete', 'partial', 'missing'].includes(coverage.status)
    ) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_COVERAGE_INVALID')
    }
    if (coverage.paragraphIds.some((id) => !paragraphIds.has(id))) throw new Error('PROVIDER_SCRIPT_MATERIAL_PARAGRAPH_REF_INVALID')
    seenPoints.add(coverage.pointId)
  }
  if (seenPoints.size !== pointIds.size) throw new Error('PROVIDER_SCRIPT_MATERIAL_COVERAGE_INVALID')
  const seenFindings = new Set<string>()
  for (const finding of output.paragraphFindings) {
    if (!paragraphIds.has(finding.paragraphId)) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_PARAGRAPH_REF_INVALID')
    }
    if (finding.sourcePointIds.some((id) => !pointIds.has(id))) throw new Error('PROVIDER_SCRIPT_MATERIAL_POINT_REF_INVALID')
    const identity = JSON.stringify([
      finding.paragraphId,
      finding.provenance,
      finding.note.trim(),
      [...finding.sourcePointIds].sort()
    ])
    if (seenFindings.has(identity)) throw new Error('PROVIDER_SCRIPT_MATERIAL_FINDING_DUPLICATE')
    seenFindings.add(identity)
  }
  return output
}

export function buildScriptMaterialChatPrompt(snapshot: ScriptMaterialChatTaskSnapshot, providerInput: ContentProviderInputSnapshot | null = null): string {
  const resourceSelection = scriptMaterialProjectResourceSelection(snapshot.resourceSnapshot)
  const responseInstructions = snapshot.rewriteTarget
    ? [
        '这是一次局部候选生成，不是全文改写。必须结合CURRENT_AI_DRAFT理解全文主题、表达口径和所选内容的前后上下文，但只能重写REWRITE_TARGET指定的范围。',
        snapshot.rewriteTarget.parentCandidateContent
          ? '这是继续修改：必须以PARENT_CANDIDATE中的上一轮候选为直接改写对象，不得回到原AI稿重新生成。' : '',
        snapshot.rewriteTarget.selectedText
          ? 'REWRITE_TARGET包含一段精确选中文字；draftContent只返回可以直接替换这段选中文字的候选文字，不要返回所在整段，更不要返回整篇AI稿。'
          : 'draftContent只返回所选AI段落的局部候选；多段目标按原目标顺序返回并用空行分段，不要返回未选择段落或整篇AI稿。',
        '局部候选不得悄悄改动目标之外的文字，不得为了展示上下文重复全文。answer只用一句话说明完成了什么。',
        'annotations只标记局部候选里本轮主动补入且需要让用户感知的精确文字。'
      ]
    : [
        '如果这是首轮且用户没有额外要求，默认完成一次主动的结构性重写，直接给出自然、完整、可继续编辑的成稿。',
        'answer用于自然回复用户；draftContent必须始终返回本轮对话后的完整AI稿，不要只返回局部改动或差异。'
      ]
  return [
    '你正在LY Creator OS的AI稿区域和用户连续讨论并撰写文案。',
    '请使用与正常高智能Codex文案对话相同的理解、推理和写作能力，不要退化成固定的润色、补写、换序规则或模板按钮。',
    '整理前原稿是事实与真实体验底稿，不是现成大纲，也不要把原稿顺序默认视为成稿顺序。',
    '如果用户没有明确要求保留顺序，先在内部理解内容单元、核心判断、受众和叙事主线，再主动选择更好的成稿结构；允许大幅换序、合并重复内容、拆分段落、补足衔接、开场和收束。只有原稿顺序确实已经合理时才沿用，不要为了降低遗漏风险逐段顺稿润色。',
    '用户可以要求自由重写、扩写、精简、调整结构、改变语气或补充内容；最新用户要求优先于默认重构策略。',
    '把独立出现的XXX／xxx／连续三个以上X，“这里不知道怎么写”“这里补一下”“待补”，以及方括号／圆括号中的“补充原价、补充成交价、查参数、补上市时间”等指令视为用户主动交给AI的补写锚点。必须处理并移除原占位指令，不要停下来追问。',
    '先判断占位内容能否从公开来源核实。产品参数、功能支持、官方原价、公开促销价／市场成交价、上市时间和型号等，只要联网未关闭，就必须先主动联网搜索并核实后写入；不要把引用格式写进口播正文，并把写入的精确结果标为web_supplement。',
    '只有实际购买价、个人购买时间、具体亲身体验、故障、使用时长等无法从公开来源确定、确实必须由用户本人填写的事实，才保留一段自然明确的待填写文字（例如“【请填写实际到手价】”），并把该精确文字标为needs_confirmation。不要用needs_confirmation代替本可以联网查到的公开信息，也不得把推断伪装成用户已经确认的事实。',
    'annotations只标记本轮主动补入且需要让用户感知的精确文字，不要把普通改写全部标记。普通补写用ai_supplement；有可靠联网来源的新增事实用web_supplement并附真实HTTPS来源，同时填写claim及factType=fact或price，价格还必须填写ISO 4217币种；只有用户本人能回答的个人事实才用needs_confirmation并填写confirmationKind=user_only。处理PLACEHOLDERS时必须把对应id逐字填入placeholderId，非占位补写填null。其他不适用字段返回null。标记text必须逐字出现在draftContent中，按正文出现顺序返回；没有需要标记的内容时返回空数组。',
    '如果联网关闭或没有留下可靠来源，不得把具体参数标为web_supplement，也不得把公开事实改成needs_confirmation推给用户填写。应改用不依赖具体参数的安全表达，并在answer中说明暂未核验到。',
    ...responseInstructions,
    '不要声称已经写入当前文案、保存、定稿或发布。只返回严格JSON。',
    '',
    ...(providerInput
      ? [formatContentProviderInput(providerInput)]
      : [
          ...(snapshot.projectContext ? [taggedJson('PROJECT_CONTEXT', snapshot.projectContext)] : []),
          ...(resourceSelection ? [taggedJson('PROJECT_RESOURCE_SELECTION', resourceSelection)] : [])
        ]),
    taggedJson('ORIGINAL_SOURCE', snapshot.sourceContent),
    taggedJson('CURRENT_AI_DRAFT', snapshot.currentDraftContent),
    taggedJson('CURRENT_DOCUMENT_PARAGRAPHS', snapshot.currentDocumentParagraphs),
    ...(snapshot.rewriteTarget?.parentCandidateContent ? [taggedJson('PARENT_CANDIDATE', {
      id: snapshot.rewriteTarget.parentCandidateId,
      content: snapshot.rewriteTarget.parentCandidateContent
    })] : []),
    taggedJson('CONVERSATION_HISTORY', snapshot.history),
    ...(snapshot.rewriteTarget ? [taggedJson('REWRITE_TARGET', snapshot.rewriteTarget)] : []),
    taggedJson('LATEST_USER_MESSAGE', snapshot.message),
    taggedJson('WEB_SEARCH_MODE', snapshot.webSearchMode)
  ].join('\n')
}

export function validateScriptMaterialChatOutput(raw: unknown): z.infer<typeof scriptMaterialChatProviderOutputSchema> {
  const output = scriptMaterialChatProviderOutputSchema.parse(raw)
  if (!output.answer.trim() || !output.draftContent.trim()) throw new Error('PROVIDER_SCRIPT_MATERIAL_CHAT_INVALID')
  const draftContent = output.draftContent.trim()
  let searchStart = 0
  for (const annotation of output.annotations) {
    if (!annotation.text.trim() || !annotation.note.trim()) throw new Error('PROVIDER_SCRIPT_MATERIAL_ANNOTATION_INVALID')
    const position = draftContent.indexOf(annotation.text, searchStart)
    if (position < 0) throw new Error('PROVIDER_SCRIPT_MATERIAL_ANNOTATION_TEXT_INVALID')
    if (annotation.provenance === 'web_supplement' && !annotation.webSources.length) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_ANNOTATION_SOURCE_MISSING')
    }
    if (annotation.provenance !== 'web_supplement' && annotation.webSources.length) {
      throw new Error('PROVIDER_SCRIPT_MATERIAL_ANNOTATION_SOURCE_UNEXPECTED')
    }
    searchStart = position + annotation.text.length
  }
  return {
    answer: output.answer.trim(),
    draftContent,
    annotations: output.annotations.map((annotation) => ({
      ...annotation,
      text: annotation.text,
      note: annotation.note.trim(),
      webSources: annotation.webSources.map((source) => ({ title: source.title.trim(), url: source.url }))
    }))
  }
}

export function buildScriptMaterialMapPrompt(snapshot: ScriptMaterialMapTaskSnapshot): string {
  return [
    '你正在LY Creator OS中为一篇新完成的AI稿建立首次三栏来源对应。',
    'AI稿已经展示给用户；本任务只负责理解原稿、AI稿与当前文案的语义关系，不得改写或生成任何正文。',
    '素材点已经绑定原稿精确位置。请为每个AI稿段落返回它实际使用的全部素材点ID；润色、换序、合并、拆分和隐含转述都要按含义判断，不能只按字面相似度。',
    '如果提供了当前文案段落，再为每个当前文案段落返回它对应的素材点ID以及来自本篇AI稿的段落ID。',
    '每个AI稿段落和当前文案段落都必须且只能返回一次。纯AI新增、纯衔接或无法可靠对应的内容返回空数组，不得伪造关系。',
    '允许一对多、多对一，三栏各自顺序互不影响。',
    '不得读取文件、执行命令或访问网页。只返回严格JSON。',
    '',
    taggedJson('ORIGINAL_SOURCE_POINTS', snapshot.points),
    taggedJson('AI_DRAFT_PARAGRAPHS', snapshot.draftParagraphs),
    taggedJson('CURRENT_DOCUMENT_PARAGRAPHS', snapshot.currentDocumentParagraphs)
  ].join('\n')
}

export function validateScriptMaterialMapOutput(
  snapshot: ScriptMaterialMapTaskSnapshot,
  raw: unknown
): z.infer<typeof scriptMaterialMapProviderOutputSchema> {
  const output = scriptMaterialMapProviderOutputSchema.parse(raw)
  const pointIds = new Set(snapshot.points.map((point) => point.id))
  const paragraphIds = new Set(snapshot.draftParagraphs.map((paragraph) => paragraph.id))
  const currentParagraphIds = new Set(snapshot.currentDocumentParagraphs.map((paragraph) => paragraph.id))
  const seenDraftParagraphs = new Set<string>()
  for (const mapping of output.draftParagraphMappings) {
    if (!paragraphIds.has(mapping.paragraphId) || seenDraftParagraphs.has(mapping.paragraphId)) throw new Error('PROVIDER_SCRIPT_MATERIAL_PARAGRAPH_REF_INVALID')
    if (mapping.sourcePointIds.some((id) => !pointIds.has(id))) throw new Error('PROVIDER_SCRIPT_MATERIAL_POINT_REF_INVALID')
    seenDraftParagraphs.add(mapping.paragraphId)
  }
  if (seenDraftParagraphs.size !== paragraphIds.size) throw new Error('PROVIDER_SCRIPT_MATERIAL_PARAGRAPH_REF_INVALID')
  if (snapshot.points.length && !output.draftParagraphMappings.some((mapping) => mapping.sourcePointIds.length)) {
    throw new Error('PROVIDER_SCRIPT_MATERIAL_MAPPING_EMPTY')
  }
  const seenCurrentParagraphs = new Set<string>()
  for (const mapping of output.currentParagraphMappings) {
    if (!currentParagraphIds.has(mapping.currentParagraphId) || seenCurrentParagraphs.has(mapping.currentParagraphId)) throw new Error('PROVIDER_SCRIPT_MATERIAL_CURRENT_PARAGRAPH_REF_INVALID')
    if (mapping.sourcePointIds.some((id) => !pointIds.has(id))) throw new Error('PROVIDER_SCRIPT_MATERIAL_POINT_REF_INVALID')
    if (mapping.draftParagraphIds.some((id) => !paragraphIds.has(id))) throw new Error('PROVIDER_SCRIPT_MATERIAL_PARAGRAPH_REF_INVALID')
    seenCurrentParagraphs.add(mapping.currentParagraphId)
  }
  if (seenCurrentParagraphs.size !== currentParagraphIds.size) throw new Error('PROVIDER_SCRIPT_MATERIAL_CURRENT_PARAGRAPH_REF_INVALID')
  return output
}
