import { describe, expect, it } from 'vitest'
import { buildTitleGenerationPrompt, platformTitleLimit, titleGenerationOutputJsonSchemaFor, titleGenerationTaskSnapshotSchema } from '../../src/main/title-generation'

const providerSecurity = { provider: 'codex_cli' as const, cliVersion: 'unit', fingerprint: 'fingerprint', policyVersion: 'v1' }

describe('title generation rules', () => {
  it('asks each provider for ten master titles and only two platform adaptations', () => {
    const master = titleGenerationTaskSnapshotSchema.parse({
      version: 1, projectId: 'project', projectTitle: 'AI浏览器体验', platform: '主标题', sourceVersionId: 'final',
      sourceRevision: 3, sourceText: '这是定稿正文', providerSecurity, mode: 'master', instruction: '更克制',
      candidateCount: 10, masterTitle: null, platformTitleLimit: null
    })
    const masterPrompt = buildTitleGenerationPrompt(master)
    expect(masterPrompt).toContain('严格返回10个候选')
    expect(masterPrompt).toContain('用户本轮要求：更克制')
    expect(masterPrompt).toContain('这是定稿正文')

    const adaptation = titleGenerationTaskSnapshotSchema.parse({
      ...master, platform: '小红书', mode: 'platform_adaptation', masterTitle: '这是一个超过小红书保守限制的主标题，需要缩短后再发布',
      instruction: '保留真实体验', candidateCount: 2, platformTitleLimit: platformTitleLimit('小红书')
    })
    const adaptationPrompt = buildTitleGenerationPrompt(adaptation)
    expect(adaptationPrompt).toContain('严格返回2个不同措辞的候选')
    expect(adaptationPrompt).toContain('平台标题上限：20字')
    expect(adaptationPrompt).not.toContain('这是定稿正文')
  })

  it('constrains structured output to the exact provider batch size', () => {
    expect(titleGenerationOutputJsonSchemaFor(10).properties.candidates).toMatchObject({ minItems: 10, maxItems: 10 })
    expect(titleGenerationOutputJsonSchemaFor(2).properties.candidates).toMatchObject({ minItems: 2, maxItems: 2 })
  })
})
