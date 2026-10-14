import { describe, expect, it } from 'vitest'
import {
  buildScriptMaterialChatPrompt,
  scriptMaterialChatTaskSnapshotSchema
} from '../../src/main/script-material'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../src/shared/domain'

const baseSnapshot = {
  version: 1 as const,
  projectId: 'ios',
  revisionId: 'revision-1',
  side: 'codex' as const,
  sourceContent: '先试键盘，后来换成触控板。',
  sourceContentHash: 'source-hash',
  currentDraftContent: '后来我换成触控板。\n\n在那之前先试了键盘。',
  currentDocumentParagraphs: [],
  history: [],
  message: '写得更口语化',
  preferredModel: null,
  webSearchMode: 'disabled' as const,
  projectContext: null,
  providerSecurity: {
    provider: 'codex_cli' as const,
    providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
    displayName: 'Codex CLI',
    cliVersion: 'test',
    fingerprint: 'test-fingerprint',
    policyVersion: 'test-policy'
  },
  inputBudget: { estimatedCharacters: 100, maximumCharacters: 1_500_000 }
}

describe('script material targeted rewrite prompt', () => {
  it('keeps ordinary chat as a complete-draft operation', () => {
    const snapshot = scriptMaterialChatTaskSnapshotSchema.parse({ ...baseSnapshot, rewriteTarget: null })
    const prompt = buildScriptMaterialChatPrompt(snapshot)
    expect(prompt).toContain('draftContent必须始终返回本轮对话后的完整AI稿')
    expect(prompt).not.toContain('<REWRITE_TARGET>')
  })

  it('returns only a local candidate for selected paragraphs or selected text', () => {
    const snapshot = scriptMaterialChatTaskSnapshotSchema.parse({
      ...baseSnapshot,
      rewriteTarget: {
        draftId: 'draft-1',
        paragraphTargets: [{
          paragraphId: 'paragraph-1',
          position: 0,
          text: '后来我换成触控板。',
          sourcePointIds: ['point-1']
        }],
        selectedParagraphId: 'paragraph-1',
        selectedText: '触控板',
        selectedStart: 6,
        selectedEnd: 9
      }
    })
    const prompt = buildScriptMaterialChatPrompt(snapshot)
    expect(prompt).toContain('这是一次局部候选生成，不是全文改写')
    expect(prompt).toContain('draftContent只返回可以直接替换这段选中文字的候选文字')
    expect(prompt).toContain('"paragraphId":"paragraph-1"')
    expect(prompt).not.toContain('draftContent必须始终返回本轮对话后的完整AI稿')
  })
})
