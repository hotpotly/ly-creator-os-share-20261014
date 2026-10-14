import { z } from 'zod'
import { platformTitleLimit } from '../shared/domain'

export { platformTitleLimit }

const providerSecuritySchema = z.object({
  provider: z.enum(['codex_cli', 'claude_cli']), cliVersion: z.string(), fingerprint: z.string(), policyVersion: z.string()
})

export const titleGenerationTaskSnapshotSchema = z.object({
  version: z.literal(1), projectId: z.string(), projectTitle: z.string(), platform: z.string(), sourceVersionId: z.string(),
  sourceRevision: z.number().int().positive(), sourceText: z.string().min(1).max(300_000), providerSecurity: providerSecuritySchema,
  mode: z.enum(['master', 'platform_adaptation']).default('master'), masterTitle: z.string().max(300).nullable().default(null),
  instruction: z.string().max(2_000).default(''), candidateCount: z.union([z.literal(2), z.literal(10)]).default(10),
  platformTitleLimit: z.number().int().positive().max(300).nullable().default(null)
})

export const titleGenerationOutputSchema = z.object({
  candidates: z.array(z.object({
    angle: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(300), coverText: z.string().trim().min(1).max(40)
  })).min(2).max(10)
})

export function titleGenerationOutputJsonSchemaFor(candidateCount: 2 | 10) {
  return {
    type: 'object',
    properties: {
      candidates: {
        type: 'array', minItems: candidateCount, maxItems: candidateCount,
        items: {
          type: 'object',
          properties: { angle: { type: 'string' }, title: { type: 'string' }, coverText: { type: 'string' } },
          required: ['angle', 'title', 'coverText'], additionalProperties: false
        }
      }
    },
    required: ['candidates'], additionalProperties: false
  } as const
}

export type TitleGenerationTaskSnapshot = z.infer<typeof titleGenerationTaskSnapshotSchema>

export function buildTitleGenerationPrompt(snapshot: TitleGenerationTaskSnapshot): string {
  if (snapshot.mode === 'platform_adaptation') {
    if (!snapshot.masterTitle) throw new Error('PLATFORM_TITLE_REQUIRES_MASTER')
    return [
      '你正在为LY Creator OS把用户已经选定的主标题适配为平台标题。',
      '只处理给定主标题，不读取文件、不调用工具、不访问网页，也不要重新从文案发明另一套选题。',
      `平台：${snapshot.platform}`,
      `平台标题上限：${snapshot.platformTitleLimit ?? '未设置'}字`,
      `已选主标题：${snapshot.masterTitle}`,
      `用户本轮要求：${snapshot.instruction || '无'}`,
      `严格返回${snapshot.candidateCount}个不同措辞的候选；保留主标题核心意思，每条不超过平台限制。coverText仍给出更短的封面文字。`,
      '严格匹配输出Schema。'
    ].join('\n')
  }
  const angleGuide = snapshot.platform === 'B站'
    ? '至少包含信息型与观点型角度。'
    : snapshot.platform === '小红书'
      ? '至少包含搜索型与情绪型角度。'
      : '至少包含实用型与发现型角度。'
  return [
    '你正在为LY Creator OS生成平台标题候选。',
    '只根据给定定稿工作，不读取文件、不调用工具、不访问网页。',
    `任务：生成跨平台使用的主标题。${angleGuide}`,
    '每个候选必须同时给出发布标题与更短的封面文字；两者不能写成同一个字段。',
    '避免虚假承诺、未经原文支持的数字、夸张结论和重复角度。',
    `用户本轮要求：${snapshot.instruction || '无'}`,
    `项目：${snapshot.projectTitle}`, `定稿v${snapshot.sourceRevision}：`, snapshot.sourceText,
    `严格返回${snapshot.candidateCount}个候选；每个Provider负责10条，两边合计20条。严格匹配输出Schema。`
  ].join('\n')
}

export function parseTitleGenerationSnapshot(value: string): TitleGenerationTaskSnapshot {
  return titleGenerationTaskSnapshotSchema.parse(JSON.parse(value))
}
