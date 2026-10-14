import { describe, expect, it } from 'vitest'
import { assertContentInstructionDispatchMatchesExecution, assertMaterialInstructionMatchesWorkspace } from '../../src/main/content-instruction-dispatch'
import { sha256 } from '../../src/main/content-instruction-request'
import type { ContentInstructionDispatchPayload } from '../../src/shared/ipc'

function revisionDispatch(): Extract<ContentInstructionDispatchPayload, { operation: 'script_revision' }> {
  return {
    operation: 'script_revision',
    instruction: {
      projectId: 'ios', sessionScope: 'script-conversation:ios', surface: 'script_conversation', target: null,
      displayText: '请重写', editorDocument: { type: 'doc' }, currentDocumentParagraphs: [], references: [], constraints: [], includeProjectContext: false,
      webSearchMode: 'automatic', factRegion: '中国大陆', factAsOf: '2026-08-04T00:00:00.000Z', aiCount: 1,
      targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: 'xhigh', historyThreadId: null, providerThreadId: null, historyMessageIds: [] }]
    },
    requests: [{
      projectId: 'ios', threadId: null, surface: 'conversation', baseVersionId: null, currentDocumentContent: '<p>原文</p>',
      includeProjectContext: false, provider: 'codex_cli', preferredModel: null, preferredReasoningEffort: 'xhigh',
      webSearchMode: 'automatic', message: '请重写', selection: {
        targetSelectionId: null, selectedText: null, contextBefore: '', contextAfter: '', occurrenceIndex: null, from: null, to: null
      }
    }]
  }
}

function materialFirstDispatch(): Extract<ContentInstructionDispatchPayload, { operation: 'script_material_chat' }> {
  return {
    operation: 'script_material_chat',
    instruction: {
      projectId: 'ios', sessionScope: 'script-material:ios:revision-1', surface: 'script_material_first_draft', target: null,
      materialRevisionId: 'revision-1', displayText: '', editorDocument: { type: 'doc' }, currentDocumentParagraphs: [], references: [], constraints: [],
      includeProjectContext: false, webSearchMode: 'automatic', factRegion: '中国大陆', factAsOf: '2026-08-04T00:00:00.000Z', aiCount: 1,
      targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: 'xhigh', historyThreadId: null, providerThreadId: null, historyMessageIds: [] }]
    },
    request: {
      projectId: 'ios', message: '', includeProjectContext: false,
      requests: [{ side: 'codex', providerConfigId: 'codex_cli_text_v1', preferredModel: null }], currentDocumentParagraphs: []
    }
  }
}

describe('R16d dispatch semantic gate', () => {
  it('normalizes a continuous multi-block selection exactly like the editor', () => {
    const valid = revisionDispatch()
    const selected = {
      ...valid,
      instruction: {
        ...valid.instruction,
        target: {
          kind: 'current_script' as const, workingDocumentId: 'working-ios', revision: 1, contentHash: sha256('原文'),
          blockSelections: [
            { blockId: 'block-a', from: 0, to: 3, text: '第一段' },
            { blockId: 'block-b', from: 0, to: 3, text: '第二段' }
          ]
        }
      },
      requests: [{
        ...valid.requests[0]!,
        selection: { targetSelectionId: 'selection-ab', selectedText: '第一段 第二段', contextBefore: '', contextAfter: '', occurrenceIndex: 0, from: 1, to: 8 }
      }]
    }
    expect(() => assertContentInstructionDispatchMatchesExecution(selected)).not.toThrow()
  })

  it('accepts one canonical request and rejects a different execution message', () => {
    const valid = revisionDispatch()
    expect(() => assertContentInstructionDispatchMatchesExecution(valid)).not.toThrow()
    expect(() => assertContentInstructionDispatchMatchesExecution({
      ...valid, requests: [{ ...valid.requests[0]!, message: '悄悄执行另一条指令' }]
    })).toThrow('指令文字与实际消息不同')
  })

  it('rejects forged surfaces and targets before any task is created', () => {
    const valid = revisionDispatch()
    expect(() => assertContentInstructionDispatchMatchesExecution({
      ...valid,
      instruction: { ...valid.instruction, surface: 'current_script_rewrite', target: null }
    })).toThrow('普通对话surface不同')
    expect(() => assertContentInstructionDispatchMatchesExecution({
      ...valid,
      instruction: {
        ...valid.instruction,
        target: { kind: 'current_script', workingDocumentId: 'document-1', revision: 1, contentHash: sha256('原文'), blockSelections: [] }
      }
    })).toThrow('不带项目上下文的普通对话不应伪造当前文案目标')
  })

  it('distinguishes a single-AI empty first draft from continuous material chat', () => {
    const valid = materialFirstDispatch()
    expect(() => assertContentInstructionDispatchMatchesExecution(valid)).not.toThrow()
    expect(() => assertMaterialInstructionMatchesWorkspace(valid, {
      webSearchMode: 'automatic', activeRevision: { id: 'revision-1' }, selectedCodexDraftId: null, selectedClaudeDraftId: null, drafts: []
    })).not.toThrow()
    expect(() => assertMaterialInstructionMatchesWorkspace({
      ...valid, instruction: { ...valid.instruction, surface: 'script_material_chat' }
    }, { webSearchMode: 'automatic', activeRevision: { id: 'revision-1' }, selectedCodexDraftId: null, selectedClaudeDraftId: null, drafts: [] })).toThrow('首稿与连续对话判定不同')
  })

  it('rejects partial material paragraph targets and a stale selected draft', () => {
    const rewrite: Extract<ContentInstructionDispatchPayload, { operation: 'script_material_rewrite' }> = {
      operation: 'script_material_rewrite',
      instruction: {
        projectId: 'ios', sessionScope: 'script-material:ios:revision-1', surface: 'script_material_rewrite',
        target: {
          kind: 'material_draft', draftId: 'draft-current', contentHash: sha256('第一段\n第二段'), applicationTarget: null,
          paragraphSelections: [{ paragraphId: 'paragraph-a', from: 0, to: 3, text: '第一段' }]
        },
        materialRevisionId: 'revision-1', displayText: '更精简', editorDocument: { type: 'doc' }, currentDocumentParagraphs: [],
        references: [], constraints: [], includeProjectContext: false, webSearchMode: 'automatic', factRegion: '中国大陆',
        factAsOf: '2026-08-04T00:00:00.000Z', aiCount: 1,
        targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: 'xhigh', historyMessageIds: [] }]
      },
      request: {
        projectId: 'ios', draftId: 'draft-current', paragraphIds: ['paragraph-a', 'paragraph-b'], requirement: '更精简',
        parentCandidateId: null, applicationTarget: null, selectedParagraphId: null, selectedText: '', selectedStart: null, selectedEnd: null,
        providerConfigId: 'codex_cli_text_v1', includeProjectContext: false, preferredModel: null, preferredReasoningEffort: null
      }
    }
    expect(() => assertContentInstructionDispatchMatchesExecution(rewrite)).toThrow('素材局部修改段落不同')

    const chat = materialFirstDispatch()
    const continuous = {
      ...chat,
      instruction: {
        ...chat.instruction, surface: 'script_material_chat' as const,
        target: { kind: 'material_draft' as const, draftId: 'draft-old', contentHash: sha256('旧稿'), paragraphSelections: [], applicationTarget: null }
      },
      request: { ...chat.request, message: '继续修改', requests: [{ side: 'codex' as const, providerConfigId: 'codex_cli_text_v1', preferredModel: null }] }
    }
    expect(() => assertMaterialInstructionMatchesWorkspace(continuous, {
      webSearchMode: 'automatic', activeRevision: { id: 'revision-1' }, selectedCodexDraftId: 'draft-current', selectedClaudeDraftId: null,
      drafts: [
        { id: 'draft-old', side: 'codex', contentHash: sha256('旧稿') },
        { id: 'draft-current', side: 'codex', contentHash: sha256('当前稿') }
      ]
    })).toThrow('不是实际选中AI稿')
  })
})
