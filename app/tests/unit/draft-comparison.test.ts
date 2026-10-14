import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { canonicalSha256 } from '../../src/main/content-instruction-request'
import {
  buildDraftAlignmentPrompt,
  buildDraftCandidatePrompt,
  buildDraftSplitMatchPrompt,
  DRAFT_COMPARISON_TASK_TIMEOUT_MILLISECONDS,
  parseDraftAlignmentTaskSnapshot,
  parseDraftCandidateTaskSnapshot,
  parseDraftSourceGenerationTaskSnapshot,
  parseDraftSplitMatchTaskSnapshot,
  splitDraftParagraphs,
  validateDraftAlignmentOutput,
  validateDraftSplitMatchOutput
} from '../../src/main/draft-comparison'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../src/shared/domain'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')
const providerSecurity = {
  provider: 'codex_cli' as const,
  providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
  displayName: 'Codex CLI',
  cliVersion: 'test',
  fingerprint: 'draft-comparison-test-fingerprint',
  policyVersion: 'test-policy'
}

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-draft-comparison-'))
  roots.push(directory)
  const store = await openWorkspaceStore(directory)
  stores.push(store)
  return store
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('dual draft comparison', () => {
  it('persists the exact current-document revision used as the organize baseline', async () => {
    const store = await createStore()
    expect(store.repository.getDraftComparisonWorkspace('ai-browser')).toMatchObject({
      currentDocumentBaseRevision: null,
      currentDocumentBaseContentHash: null
    })
    const loaded = store.repository.loadProjectCurrentScript('ai-browser')
    const ready = loaded.status === 'ready' ? loaded : store.repository.initializeProjectCurrentScript({
      projectId: 'ai-browser',
      clientMutationId: randomUUID(),
      sourceVersionId: null,
      expectedSourceContentHash: null,
      editorDocument: {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { blockId: 'script-block-baseline', parentBlockIds: [] } }]
      },
      sourceRelations: [],
      annotations: []
    })
    if (ready.status !== 'ready') throw new Error('expected current script')
    const workspace = store.repository.setDraftComparisonCurrentDocumentBase(
      'ai-browser',
      ready.snapshot.document.revision,
      ready.snapshot.document.contentHash
    )
    expect(workspace).toMatchObject({
      currentDocumentBaseRevision: ready.snapshot.document.revision,
      currentDocumentBaseContentHash: ready.snapshot.document.contentHash
    })
    expect(store.repository.getDraftComparisonWorkspace('ai-browser')).toMatchObject({
      currentDocumentBaseRevision: ready.snapshot.document.revision,
      currentDocumentBaseContentHash: ready.snapshot.document.contentHash
    })
    expect(() => store.repository.setDraftComparisonCurrentDocumentBase(
      'ai-browser',
      ready.snapshot.document.revision,
      'a'.repeat(64)
    )).toThrow('当前文案已经变化')
  })

  it('splits plain text and HTML into deterministic paragraph snapshots', () => {
    expect(splitDraftParagraphs('第一段\n第二段\n\n第三段', 'claude')).toEqual([
      { id: 'claude-p-1', position: 0, text: '第一段' },
      { id: 'claude-p-2', position: 1, text: '第二段' },
      { id: 'claude-p-3', position: 2, text: '第三段' }
    ])
    expect(splitDraftParagraphs('<p>参数A</p><p>体验B</p>', 'codex').map((item) => item.text)).toEqual(['参数A', '体验B'])
  })

  it('persists freeform drafts, freezes provenance and validates every paragraph exactly once', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: '共同开头\nClaude补充体验\n共同结尾',
      codexContent: '共同开头\nCodex补充参数\n共同结尾'
    })
    const task = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const snapshot = parseDraftAlignmentTaskSnapshot(task.inputSnapshot)
    expect(task).toMatchObject({ taskType: 'draft_alignment', provider: 'codex_cli', outputTarget: `draft-alignment:${snapshot.sessionId}` })
    expect(snapshot.providerSecurity).toEqual(providerSecurity)
    expect(buildDraftAlignmentPrompt(snapshot)).toContain('每个段落ID必须且只能出现一次')
    expect(() => validateDraftAlignmentOutput(snapshot, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'exact' }]
    })).toThrow('PROVIDER_DRAFT_ALIGNMENT_INVALID')
    expect(() => validateDraftAlignmentOutput(snapshot, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'claude_only' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'related' }
      ]
    })).toThrow('PROVIDER_DRAFT_ALIGNMENT_INVALID')
    expect(() => validateDraftAlignmentOutput(snapshot, {
      groups: [
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'related' }
      ]
    })).toThrow('PROVIDER_DRAFT_ALIGNMENT_INVALID')

    const output = validateDraftAlignmentOutput(snapshot, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'exact' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: [], matchType: 'claude_only' },
        { claudeParagraphIds: [], codexParagraphIds: ['codex-p-2'], matchType: 'codex_only' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'related' }
      ]
    })
    const workspace = store.repository.saveDraftAlignmentResult(task.id, output)
    expect(workspace.activeSession).toMatchObject({
      status: 'ready',
      alignmentProviderConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      alignmentProviderFingerprint: providerSecurity.fingerprint
    })
    expect(workspace.activeSession?.groups).toHaveLength(4)
    expect(workspace.activeSession?.claudeSnapshot).toMatchObject({ sourceKind: 'freeform', provider: null })
  })

  it('re-aligns only changed groups and reuses untouched decisions and candidates', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: '共同开头\nClaude第二段\n共同结尾',
      codexContent: '共同开头\nCodex第二段\n共同结尾'
    })
    const firstTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(firstTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'exact' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'exact' }
      ]
    })
    const [firstGroup, , thirdGroup] = workspace.activeSession!.groups
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: firstGroup!.id, kind: 'claude'
    })
    const historicalCandidate = store.repository.addFreeformDraftCandidate('ai-browser', thirdGroup!.id, '保留的历史候选')
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: thirdGroup!.id, kind: 'candidate', sourceId: historicalCandidate.id
    })

    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: '共同开头\nClaude第二段已修改\n共同结尾',
      codexContent: '共同开头\nCodex第二段已修改\n共同结尾'
    })
    const nextTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const snapshot = parseDraftAlignmentTaskSnapshot(nextTask.inputSnapshot)
    expect(snapshot).toMatchObject({
      alignmentMode: 'incremental',
      baseSessionId: workspace.activeSession!.id,
      requestedParagraphIds: { claude: ['claude-p-2'], codex: ['codex-p-2'] }
    })
    expect(snapshot.reusedGroups).toHaveLength(2)
    const prompt = buildDraftAlignmentPrompt(snapshot)
    expect(prompt).toContain('未修改的2组已经由系统安全复用')
    expect(prompt).toContain('Claude第二段已修改')
    expect(prompt).not.toContain('共同开头')

    workspace = store.repository.saveDraftAlignmentResult(nextTask.id, {
      groups: [{ claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }]
    })
    expect(workspace.activeSession?.groups).toHaveLength(3)
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({ kind: 'claude', content: '共同开头' })
    expect(workspace.activeSession?.groups[2]?.decision).toMatchObject({ kind: 'candidate', content: '保留的历史候选' })
    expect(workspace.activeSession?.groups[2]?.candidates).toHaveLength(1)
    expect(workspace.activeSession?.groups[2]?.candidates[0]?.id).not.toBe(historicalCandidate.id)
  })

  it('does not resend unchanged drafts and requires an explicit confirmation before a full rebuild', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2\nA3\nA4',
      codexContent: 'B1\nB2\nB3\nB4'
    })
    const firstTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    store.repository.saveDraftAlignmentResult(firstTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-4'], codexParagraphIds: ['codex-p-4'], matchType: 'related' }
      ]
    })
    const taskCount = store.repository.listTaskRuns().length
    expect(() => store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false }))
      .toThrow('DRAFT_ALIGNMENT_UNCHANGED')
    expect(store.repository.listTaskRuns()).toHaveLength(taskCount)

    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2改\nA3改\nA4改',
      codexContent: 'B1\nB2改\nB3改\nB4改'
    })
    expect(() => store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false }))
      .toThrow('DRAFT_ALIGNMENT_FULL_REBUILD_CONFIRM_REQUIRED:75')
    expect(store.repository.listTaskRuns()).toHaveLength(taskCount)
    const confirmed = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false, confirmFull: true })
    expect(parseDraftAlignmentTaskSnapshot(confirmed.inputSnapshot)).toMatchObject({
      alignmentMode: 'full',
      baseSessionId: null,
      requestedParagraphIds: null,
      reusedGroups: []
    })
  })

  it('freezes the selected outline into the alignment snapshot and prompt only when enabled', async () => {
    const store = await createStore()
    const outline = store.repository.saveOutline('ai-browser', [
      { id: 'outline-1', text: '先讲结论' },
      { id: 'outline-2', text: '再讲体验和参数' }
    ], undefined, { id: 'outline-doc', name: '评测大纲' })
    store.repository.setActiveOutlineVersion('ai-browser', outline.id)
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: '开头\n体验', codexContent: '结论\n参数' })

    const withOutline = store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: true, includeProjectContext: true
    })
    const frozen = parseDraftAlignmentTaskSnapshot(withOutline.inputSnapshot)
    expect(frozen.outline).toMatchObject({
      versionId: outline.id,
      name: '评测大纲',
      items: [{ id: 'outline-1', text: '先讲结论' }, { id: 'outline-2', text: '再讲体验和参数' }]
    })
    expect(frozen.outline?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(frozen.projectContext?.selectedOutline).toBeNull()
    expect(buildDraftAlignmentPrompt(frozen)).toContain('<FROZEN_OUTLINE>')
    expect(() => validateDraftAlignmentOutput(frozen, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }
      ]
    })).toThrow('PROVIDER_DRAFT_ALIGNMENT_OUTLINE_INVALID')
    expect(() => validateDraftAlignmentOutput(frozen, {
      groups: [
        {
          claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-2'
        },
        {
          claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-1'
        }
      ]
    })).toThrow('PROVIDER_DRAFT_ALIGNMENT_OUTLINE_INVALID')
    expect(validateDraftAlignmentOutput(frozen, {
      groups: [
        {
          claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related',
          outlinePlacement: 'outside_outline', outlineItemId: null
        },
        {
          claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-1'
        }
      ]
    }).groups[0]).toMatchObject({ outlinePlacement: 'outside_outline', outlineItemId: null })

    const outlinedWorkspace = store.repository.saveDraftAlignmentResult(withOutline.id, {
      groups: [
        {
          claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related',
          outlinePlacement: 'outside_outline', outlineItemId: null
        },
        {
          claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-1'
        }
      ]
    })
    expect(outlinedWorkspace.activeSession?.groups).toEqual([
      expect.objectContaining({
        outlinePlacement: 'outside_outline', outlineItemId: null, outlineItemTitle: null, outlineLabel: '大纲外内容'
      }),
      expect.objectContaining({
        outlinePlacement: 'outline_item', outlineItemId: 'outline-1', outlineItemTitle: '先讲结论',
        outlineLabel: '大纲1 · 先讲结论'
      })
    ])
    expect(() => store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: false, includeProjectContext: true
    })).toThrow('DRAFT_ALIGNMENT_FULL_REBUILD_CONFIRM_REQUIRED:100')
    const withoutOutline = parseDraftAlignmentTaskSnapshot(store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: false, includeProjectContext: true, confirmFull: true
    }).inputSnapshot)
    expect(withoutOutline.outline).toBeNull()
    expect(withoutOutline.projectContext?.selectedOutline).toBeNull()
    expect(buildDraftAlignmentPrompt(withoutOutline)).toContain('本次未启用大纲参照')
    expect(buildDraftAlignmentPrompt(withoutOutline)).not.toContain('<FROZEN_OUTLINE>')
  })

  it('keeps outline relations through incremental reuse and applies safe merge, split and cross-group move rules', async () => {
    const store = await createStore()
    const outline = store.repository.saveOutline('ai-browser', [
      { id: 'outline-1', text: '结论' },
      { id: 'outline-2', text: '体验' }
    ], undefined, { id: 'outline-doc', name: '大纲' })
    store.repository.setActiveOutlineVersion('ai-browser', outline.id)
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2\nA3', codexContent: 'B1\nB2\nB3' })
    const firstTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: true })
    let workspace = store.repository.saveDraftAlignmentResult(firstTask.id, {
      groups: [
        {
          claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-1'
        },
        {
          claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-1'
        },
        {
          claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'related',
          outlinePlacement: 'outline_item', outlineItemId: 'outline-2'
        }
      ]
    })
    const [first, second, third] = workspace.activeSession!.groups
    workspace = store.repository.mergeDraftAlignmentGroups('ai-browser', [first!.id, second!.id])
    expect(workspace.activeSession?.groups.map((group) => [group.position, group.labelIndex])).toEqual([[0, 1], [1, 2]])
    expect(workspace.activeSession?.groups[0]).toMatchObject({ outlinePlacement: 'outline_item', outlineItemId: 'outline-1' })
    const merged = workspace.activeSession!.groups[0]!
    workspace = store.repository.splitDraftAlignmentGroup({
      projectId: 'ai-browser', groupId: merged.id,
      firstClaudeParagraphIds: [merged.claudeParagraphs[0]!.id],
      firstCodexParagraphIds: [merged.codexParagraphs[0]!.id]
    })
    expect(workspace.activeSession?.groups.slice(0, 2)).toEqual([
      expect.objectContaining({ outlinePlacement: 'outline_item', outlineItemId: 'outline-1' }),
      expect.objectContaining({ outlinePlacement: 'outline_item', outlineItemId: 'outline-1' })
    ])
    const splitSecond = workspace.activeSession!.groups[1]!
    workspace = store.repository.moveDraftParagraphs({
      projectId: 'ai-browser',
      moves: [{ side: 'claude', paragraphId: splitSecond.claudeParagraphs[0]!.id, fromGroupId: splitSecond.id, toGroupId: third!.id }]
    })
    expect(workspace.activeSession?.groups.filter((group) => group.id === splitSecond.id || group.id === third!.id))
      .toEqual([
        expect.objectContaining({ outlinePlacement: 'outside_outline', outlineItemId: null }),
        expect.objectContaining({ outlinePlacement: 'outside_outline', outlineItemId: null })
      ])
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2\nA3改', codexContent: 'B1\nB2\nB3改' })
    const incremental = parseDraftAlignmentTaskSnapshot(store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: true, confirmFull: true
    }).inputSnapshot)
    expect(incremental.alignmentMode).toBe('incremental')
    expect(incremental.reusedGroups).toEqual([
      expect.objectContaining({ outlinePlacement: 'outline_item', outlineItemId: 'outline-1' }),
      expect.objectContaining({ outlinePlacement: 'outside_outline', outlineItemId: null })
    ])
  })

  it('targets selected source text and supports quick rewrite without custom instructions', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'Claude原句', codexContent: 'Codex需要润色的原句' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' }]
    })
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      targetKind: 'codex',
      selectedText: '需要润色',
      quickIntent: 'polish',
      requirement: '',
      providerSecurity
    })
    const snapshot = parseDraftCandidateTaskSnapshot(task.inputSnapshot)
    expect(snapshot).toMatchObject({
      target: { kind: 'codex', sourceId: null, content: 'Codex需要润色的原句' },
      selectedText: '需要润色',
      quickIntent: 'polish',
      customRequirement: ''
    })
    expect(snapshot.requirement).toContain('润色')
    const prompt = buildDraftCandidatePrompt(snapshot)
    expect(prompt).toContain('<SELECTED_TEXT>')
    expect(prompt).toContain('不要改动或返回选区之外的文字')
    const candidate = store.repository.saveDraftCandidateResult(task.id, {
      content: '值得重点润色',
      summary: '替换选区',
      rationale: '只返回选区替换文'
    })
    expect(candidate.content).toBe('Codex值得重点润色的原句')
    const evidenceWorkspace = store.repository.getDraftComparisonWorkspace('ai-browser')
    const evidenceSource = evidenceWorkspace.activeSession!.codexSnapshot
    const evidenceParagraph = evidenceSource.paragraphs[0]!
    const evidenceSelection = {
      selectionId: 'draft-candidate-evidence-source', position: 0, sourceKind: 'comparison_source' as const,
      sourceId: evidenceSource.id, sourceVersion: evidenceSource.contentHash, sourceContentHash: evidenceSource.contentHash,
      sourceLabel: 'Codex稿', semanticGroupId: workspace.activeSession!.groups[0]!.id, blockId: evidenceParagraph.id,
      blockStart: 0, blockEnd: evidenceParagraph.text.length, selectedText: evidenceParagraph.text
    }
    const evidenceTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      targetKind: 'codex',
      selectedText: '需要润色',
      quickIntent: 'regenerate',
      requirement: '补入核验后的官方售价',
      webSearchMode: 'automatic',
      providerSecurity
    })
    const providerThreadId = null
    const historyMessageIds: string[] = []
    const instruction = store.repository.prepareContentInstructionRequest({
      projectId: 'ai-browser', sessionScope: 'draft-candidate-evidence', surface: 'script_draft_comparison',
      target: { kind: 'draft_comparison', groupId: workspace.activeSession!.groups[0]!.id, sourceSelections: [evidenceSelection] },
      displayText: '补入核验后的官方售价', editorDocument: { type: 'doc', content: [] },
      references: [], constraints: [], includeProjectContext: false, webSearchMode: 'automatic',
      factRegion: '中国大陆', factAsOf: '2026-08-05T00:00:00.000Z', aiCount: 1,
      targets: [{
        providerConfigId: providerSecurity.providerConfigId,
        providerSecurity,
        requestedModel: 'auto', actualModel: 'gpt-5.6', requestedReasoningEffort: 'xhigh', actualReasoningEffort: 'xhigh',
        historyThreadId: null, providerThreadId, historyMessageIds,
        historyHash: canonicalSha256({ providerThreadId, historyMessageIds })
      }]
    })
    store.repository.bindContentProviderInput(instruction.request.id, instruction.targets[0]!.id, evidenceTask.id)
    const evidenceCandidate = store.repository.saveDraftCandidateResult(evidenceTask.id, {
      content: '官方售价是1999元', summary: '核验价格', rationale: '按官网页面补入', conflicts: [],
      annotations: [{
        text: '1999元', provenance: 'web_supplement', note: '官网价格页', claim: '官方售价为1999元',
        factType: 'price', priceKind: 'current_official', currency: 'CNY', confirmationKind: null,
        webSources: [{ title: '官网价格页', url: 'https://example.com/product' }]
      }]
    }, {
      model: 'gpt-5.6', reasoningEffort: 'xhigh', webSearchMode: 'automatic',
      webSearches: [{ type: 'open_page', url: 'https://example.com/product', runtimeAccessId: 'draft-runtime-open', accessedAt: '2026-08-05T02:03:04.000Z' }]
    })
    expect(evidenceCandidate).toMatchObject({
      content: 'Codex官方售价是1999元的原句',
      factAnnotations: [{ start: 10, end: 15, text: '1999元', provenance: 'web_supplement' }]
    })
    expect(store.repository.listContentFactEvidence(evidenceTask.id)).toEqual([expect.objectContaining({
      sourceUrl: 'https://example.com/product', accessedAt: '2026-08-05T02:03:04.000Z', runtimeAccessId: 'draft-runtime-open'
    })])
    expect(() => store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      targetKind: 'codex',
      selectedText: '已经不存在',
      quickIntent: 'regenerate',
      providerSecurity
    })).toThrow('所选文字已变化')
    store.repository.setDraftGroupDecision({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      kind: 'freeform',
      content: '重复内容，中间隔开，重复内容'
    })
    const initializedCurrent = store.repository.initializeProjectCurrentScript({
      projectId: 'ai-browser',
      clientMutationId: randomUUID(),
      sourceVersionId: null,
      expectedSourceContentHash: null,
      editorDocument: {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { blockId: 'current-group-block', parentBlockIds: [] } }]
      },
      sourceRelations: [],
      annotations: []
    })
    if (initializedCurrent.status !== 'ready') throw new Error('expected current script')
    expect(store.repository.applyProjectCurrentScriptTransaction({
      projectId: 'ai-browser',
      workingDocumentId: initializedCurrent.snapshot.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: initializedCurrent.snapshot.document.revision,
      expectedContentHash: initializedCurrent.snapshot.document.contentHash,
      editorDocument: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          attrs: { blockId: 'current-group-block', parentBlockIds: [] },
          content: [{ type: 'text', text: '重复内容，中间隔开，重复内容' }]
        }]
      },
      sourceRelations: [],
      annotations: []
    }).status).toBe('applied')
    expect(() => store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      targetKind: 'current',
      selectedText: '重复内容',
      quickIntent: 'polish',
      providerSecurity
    })).toThrow('DRAFT_CANDIDATE_SELECTION_AMBIGUOUS')
    const repeatedTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      targetKind: 'current',
      selectedText: '重复内容',
      selectionStart: 10,
      selectionEnd: 14,
      quickIntent: 'polish',
      providerSecurity
    })
    expect(parseDraftCandidateTaskSnapshot(repeatedTask.inputSnapshot)).toMatchObject({
      selectedText: '重复内容',
      selectionStart: 10,
      selectionEnd: 14
    })
    expect(store.repository.saveDraftCandidateResult(repeatedTask.id, {
      content: '第二处已改',
      summary: '精确替换',
      rationale: '按选区偏移替换'
    }).content).toBe('重复内容，中间隔开，第二处已改')
    expect(DRAFT_COMPARISON_TASK_TIMEOUT_MILLISECONDS).toBeGreaterThan(120_000)
  })

  it('freezes two to four source selections, records the actual model and refuses invented conflict sources', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: '真实体验是机身更小巧',
      codexContent: '官方参数是重量120克'
    })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' }]
    })
    const group = workspace.activeSession!.groups[0]!
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: group.id,
      requirement: '吸收两者优点并保留冲突',
      preferredModel: 'gpt-5.6',
      preferredReasoningEffort: 'xhigh',
      sourceSelections: [
        { sourceKind: 'claude', selectedText: '机身更小巧', selectionStart: 5, selectionEnd: 10 },
        { sourceKind: 'codex', selectedText: '重量120克', selectionStart: 5, selectionEnd: 11 }
      ],
      providerSecurity
    })
    const snapshot = parseDraftCandidateTaskSnapshot(task.inputSnapshot)
    expect(snapshot).toMatchObject({
      target: { kind: 'group' },
      preferredModel: 'gpt-5.6',
      preferredReasoningEffort: 'xhigh'
    })
    expect(snapshot.sourceSelections).toHaveLength(2)
    expect(snapshot.sourceSelections.map((selection) => selection.selectedText)).toEqual(['机身更小巧', '重量120克'])
    const [first, second] = snapshot.sourceSelections
    const candidate = store.repository.saveDraftCandidateResult(task.id, {
      content: '官方参数是120克，但我的真实体验是它很小巧。',
      summary: '统一参数和体验',
      rationale: '不静默取舍',
      conflicts: [{
        id: 'real-experience-conflict', kind: 'real_experience', summary: '体验表述与参数维度不同',
        sourceSelectionIds: [first!.selectionId, second!.selectionId],
        sourceExcerpts: [first!.selectedText, second!.selectedText]
      }]
    }, { model: 'gpt-5.6', reasoningEffort: 'xhigh' })
    expect(candidate).toMatchObject({
      model: 'gpt-5.6', reasoningEffort: 'xhigh', sourceSelections: snapshot.sourceSelections,
      targetKind: 'group', targetContent: snapshot.target.content
    })
    expect(candidate.conflicts).toEqual([expect.objectContaining({ kind: 'real_experience' })])
    const continuationTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: group.id, parentCandidateId: candidate.id,
      quickIntent: 'concise', providerSecurity
    })
    const continuationSnapshot = parseDraftCandidateTaskSnapshot(continuationTask.inputSnapshot)
    expect(continuationSnapshot.sourceSelections).toEqual(snapshot.sourceSelections)
    expect(continuationSnapshot.inheritedConflicts).toEqual(candidate.conflicts)
    expect(buildDraftCandidatePrompt(continuationSnapshot)).toContain('<UNRESOLVED_SOURCE_CONFLICTS>')
    const continuedCandidate = store.repository.saveDraftCandidateResult(continuationTask.id, {
      content: '120克，真实体验小巧。', summary: '继续精简', rationale: '仍保留冲突', conflicts: []
    })
    expect(continuedCandidate.sourceSelections).toEqual(candidate.sourceSelections)
    expect(continuedCandidate.conflicts).toEqual(candidate.conflicts)

    const invalidTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: group.id, quickIntent: 'polish',
      sourceSelections: [
        { sourceKind: 'claude', selectedText: '机身更小巧', selectionStart: 5, selectionEnd: 10 },
        { sourceKind: 'codex', selectedText: '重量120克', selectionStart: 5, selectionEnd: 11 }
      ], providerSecurity
    })
    expect(() => store.repository.saveDraftCandidateResult(invalidTask.id, {
      content: '无效候选', summary: '无效冲突', rationale: '',
      conflicts: [{ id: 'invalid', kind: 'fact', summary: '伪造来源', sourceSelectionIds: ['missing-selection'], sourceExcerpts: [] }]
    })).toThrow('PROVIDER_DRAFT_CANDIDATE_CONFLICT_SOURCE_INVALID')
  })

  it('freezes comparison selections against real paragraph blocks instead of group-local pseudo blocks', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: '第一段\n\n第二段\n\n第三段',
      codexContent: '甲段\n\n乙段\n\n丙段'
    })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2', 'claude-p-3'], codexParagraphIds: ['codex-p-2', 'codex-p-3'], matchType: 'related' }
      ]
    })
    const secondGroup = workspace.activeSession!.groups[1]!
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: secondGroup.id, quickIntent: 'polish',
      targetKind: 'claude', sourceKind: 'claude',
      selectedText: '二段\n\n第三', selectionStart: 1, selectionEnd: 7,
      providerSecurity
    })
    const snapshot = parseDraftCandidateTaskSnapshot(task.inputSnapshot)
    expect(snapshot.sourceSelections.map((selection) => ({
      blockId: selection.blockId,
      blockStart: selection.blockStart,
      blockEnd: selection.blockEnd,
      selectedText: selection.selectedText
    }))).toEqual([
      { blockId: 'claude-p-2', blockStart: 1, blockEnd: 3, selectedText: '二段' },
      { blockId: 'claude-p-3', blockStart: 0, blockEnd: 2, selectedText: '第三' }
    ])
    expect(snapshot.sourceSelections.every((selection) => selection.sourceId === workspace.activeSession!.claudeSnapshot.id)).toBe(true)
  })

  it('marks a completed candidate stale when the current group decision changed during generation', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'Claude来源', codexContent: 'Codex来源' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' }]
    })
    const group = workspace.activeSession!.groups[0]!
    workspace = store.repository.setDraftGroupDecision({ projectId: 'ai-browser', groupId: group.id, kind: 'freeform', content: '生成前的当前文案' })
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: group.id, targetKind: 'codex', sourceKind: 'codex',
      quickIntent: 'polish', providerSecurity
    })
    const frozen = parseDraftCandidateTaskSnapshot(task.inputSnapshot)
    expect(frozen.targetDecisionFingerprint).toMatch(/^[0-9a-f]{64}$/)
    store.repository.setDraftGroupDecision({ projectId: 'ai-browser', groupId: group.id, kind: 'freeform', content: '任务期间的新编辑' })
    const candidate = store.repository.saveDraftCandidateResult(task.id, {
      content: '候选内容', summary: '候选', rationale: '', conflicts: []
    })
    expect(candidate).toMatchObject({
      status: 'input_changed',
      inputRelationChanged: true,
      targetDecisionFingerprint: frozen.targetDecisionFingerprint
    })
  })

  it('uses exact source offsets when the repeated selection is in a later paragraph', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'Claude第一段\nClaude第二段',
      codexContent: '开头重复内容\n中间重复内容结尾'
    })
    const alignmentTask = store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: false
    })
    const workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{
        claudeParagraphIds: ['claude-p-1', 'claude-p-2'],
        codexParagraphIds: ['codex-p-1', 'codex-p-2'],
        matchType: 'related'
      }]
    })
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      targetKind: 'codex',
      selectedText: '重复内容',
      selectionStart: 10,
      selectionEnd: 14,
      quickIntent: 'polish',
      providerSecurity
    })
    expect(parseDraftCandidateTaskSnapshot(task.inputSnapshot).target.content).toBe('开头重复内容\n\n中间重复内容结尾')
    expect(store.repository.saveDraftCandidateResult(task.id, {
      content: '第二处已改',
      summary: '精确替换第二段',
      rationale: ''
    }).content).toBe('开头重复内容\n\n中间第二处已改结尾')
  })

  it('preserves exact freeform whitespace and deterministically merges decisions, notes and markers', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2', codexContent: 'B1\nB2' })
    const task = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(task.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }
      ]
    })
    const [first, second] = workspace.activeSession!.groups
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: first!.id, kind: 'freeform', content: '  第一段  \n'
    })
    workspace = store.repository.setDraftGroupNote('ai-browser', first!.id, '第一条备注')
    workspace = store.repository.setDraftGroupMarkers('ai-browser', first!.id, [{
      id: 'm1', start: 2, end: 5, text: '第一段', note: '', status: 'active'
    }])
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: second!.id, kind: 'freeform', content: '\n第二段'
    })
    workspace = store.repository.setDraftGroupNote('ai-browser', second!.id, '第二条备注')
    workspace = store.repository.setDraftGroupMarkers('ai-browser', second!.id, [{
      id: 'm2', start: 1, end: 4, text: '第二段', note: '复核', status: 'active'
    }])
    expect(workspace.activeSession?.groups[0]?.decision?.content).toBe('  第一段  \n')
    workspace = store.repository.mergeDraftAlignmentGroups('ai-browser', [first!.id, second!.id])
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      kind: 'freeform',
      content: '  第一段  \n\n\n\n第二段',
      note: '组1：第一条备注\n组2：第二条备注'
    })
    expect(workspace.activeSession?.groups[0]?.decision?.markers).toEqual([
      expect.objectContaining({ text: '第一段', start: 2, end: 5 }),
      expect.objectContaining({ text: '第二段', start: 11, end: 14 })
    ])
    const merged = workspace.activeSession!.groups[0]!
    workspace = store.repository.splitDraftAlignmentGroup({
      projectId: 'ai-browser',
      groupId: merged.id,
      firstClaudeParagraphIds: [merged.claudeParagraphs[0]!.id],
      firstCodexParagraphIds: [merged.codexParagraphs[0]!.id]
    })
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      kind: 'freeform',
      content: '  第一段  \n\n\n\n第二段',
      note: '组1：第一条备注\n组2：第二条备注',
      markers: [
        expect.objectContaining({ text: '第一段' }),
        expect.objectContaining({ text: '第二段' })
      ]
    })
  })

  it('moves linked paragraphs atomically and rolls back all changes when the linked move is invalid', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2', codexContent: 'B1\nB2' })
    const task = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(task.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }
      ]
    })
    const [first, second] = workspace.activeSession!.groups
    expect(() => store.repository.moveDraftParagraphs({
      projectId: 'ai-browser',
      moves: [
        { side: 'claude', paragraphId: 'claude-p-1', fromGroupId: first!.id, toGroupId: second!.id },
        { side: 'codex', paragraphId: 'codex-p-1', fromGroupId: first!.id, toGroupId: second!.id }
      ]
    })).toThrow('未执行任何移动')
    workspace = store.repository.getDraftComparisonWorkspace('ai-browser')
    expect(workspace.activeSession?.groups[0]?.claudeParagraphs.map((paragraph) => paragraph.id)).toEqual(['claude-p-1'])
    expect(workspace.activeSession?.groups[0]?.codexParagraphs.map((paragraph) => paragraph.id)).toEqual(['codex-p-1'])

    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: first!.id, kind: 'freeform', content: '冻结的来源正文'
    })
    workspace = store.repository.setDraftGroupNote('ai-browser', first!.id, '来源备注')
    workspace = store.repository.setDraftGroupMarkers('ai-browser', first!.id, [{
      id: 'source-marker', start: 0, end: 2, text: '冻结', note: '', status: 'active'
    }])
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: second!.id, kind: 'freeform', content: '冻结的目标正文'
    })
    workspace = store.repository.setDraftGroupNote('ai-browser', second!.id, '目标备注')
    workspace = store.repository.moveDraftParagraphs({
      projectId: 'ai-browser',
      moves: [{ side: 'claude', paragraphId: 'claude-p-1', fromGroupId: first!.id, toGroupId: second!.id }]
    })
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      kind: 'freeform', content: '冻结的来源正文', note: '来源备注',
      markers: [expect.objectContaining({ id: 'source-marker', text: '冻结' })]
    })
    expect(workspace.activeSession?.groups[1]?.decision).toMatchObject({
      kind: 'freeform', content: '冻结的目标正文', note: '目标备注'
    })
  })

  it('preserves unchanged manual order and surfaces changed manual-group conflicts before incremental alignment', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2\nA3',
      codexContent: 'B1\nB2\nB3'
    })
    const firstTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(firstTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-3'], matchType: 'related' }
      ]
    })
    const [first, second, third] = workspace.activeSession!.groups
    workspace = store.repository.reorderDraftAlignmentGroups('ai-browser', [third!.id, first!.id, second!.id])
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2\nA3\nA4',
      codexContent: 'B1\nB2\nB3\nB4'
    })
    const incremental = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const incrementalSnapshot = parseDraftAlignmentTaskSnapshot(incremental.inputSnapshot)
    expect(incrementalSnapshot.reusedGroups.map((group) => group.sourcePosition)).toEqual([0, 1, 2])
    workspace = store.repository.saveDraftAlignmentResult(incremental.id, {
      groups: [{ claudeParagraphIds: ['claude-p-4'], codexParagraphIds: ['codex-p-4'], matchType: 'related' }]
    })
    expect(workspace.activeSession?.groups.slice(0, 3).map((group) => (
      `${group.claudeParagraphs[0]?.text}:${group.codexParagraphs[0]?.text}`
    ))).toEqual(['A3:B3', 'A1:B1', 'A2:B2'])

    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2已修改\nA3\nA4',
      codexContent: 'B1\nB2已修改\nB3\nB4'
    })
    expect(() => store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: false
    })).toThrow('DRAFT_ALIGNMENT_MANUAL_CONFLICT_CONFIRM_REQUIRED')
    const confirmedIncremental = parseDraftAlignmentTaskSnapshot(store.repository.startDraftAlignment({
      projectId: 'ai-browser', providerSecurity, useOutline: false, confirmFull: true
    }).inputSnapshot)
    expect(confirmedIncremental).toMatchObject({
      alignmentMode: 'incremental',
      requestedParagraphIds: {
        claude: ['claude-p-2'],
        codex: ['codex-p-2']
      }
    })
    expect(confirmedIncremental.reusedGroups.map((group) => group.sourceLabelIndex)).toEqual([1, 2, 4])
  })

  it('keeps provider candidates, decisions and manual group edits traceable', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2', codexContent: 'B1\nB2' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    const alignmentSnapshot = parseDraftAlignmentTaskSnapshot(alignmentTask.inputSnapshot)
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }
      ]
    })
    const firstGroup = workspace.activeSession!.groups[0]!
    const candidateTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: firstGroup.id,
      requirement: '合并两边优点',
      providerSecurity
    })
    const candidateSnapshot = parseDraftCandidateTaskSnapshot(candidateTask.inputSnapshot)
    expect(candidateSnapshot).toMatchObject({ sessionId: alignmentSnapshot.sessionId, groupId: firstGroup.id, requirement: '合并两边优点' })
    const providerCandidate = store.repository.saveDraftCandidateResult(candidateTask.id, {
      content: 'AB候选',
      summary: '合并优点',
      rationale: '保留双方信息'
    })
    expect(providerCandidate).toMatchObject({
      groupId: firstGroup.id,
      sourceKind: 'provider',
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      providerFingerprint: providerSecurity.fingerprint
    })
    const manualCandidate = store.repository.addFreeformDraftCandidate('ai-browser', firstGroup.id, '手动候选')
    expect(manualCandidate.sourceKind).toBe('freeform')
    const continuationTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser',
      groupId: firstGroup.id,
      parentCandidateId: providerCandidate.id,
      requirement: '只继续修改所选候选',
      providerSecurity
    })
    const continuationSnapshot = parseDraftCandidateTaskSnapshot(continuationTask.inputSnapshot)
    expect(continuationSnapshot.existingCandidates).toEqual([
      { id: providerCandidate.id, content: providerCandidate.content, revisionRound: 1 }
    ])
    expect(continuationSnapshot).toMatchObject({ selectedText: null, selectionStart: null, selectionEnd: null })
    expect(continuationSnapshot.sourceSelections).toEqual(providerCandidate.sourceSelections)
    const secondGroup = workspace.activeSession!.groups[1]!
    const secondCandidate = store.repository.addFreeformDraftCandidate('ai-browser', secondGroup.id, '第二组候选')

    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser',
      groupId: firstGroup.id,
      kind: 'candidate',
      sourceId: providerCandidate.id
    })
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({ kind: 'candidate', sourceId: providerCandidate.id, content: 'AB候选' })
    expect(() => store.repository.deleteDraftCandidate('ai-browser', providerCandidate.id)).toThrow('已用于当前选择')

    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser',
      groupId: firstGroup.id,
      kind: 'freeform',
      content: '最终手动内容'
    })
    expect(workspace.activeSession?.groups[0]?.decision?.content).toBe('最终手动内容')
    workspace = store.repository.mergeDraftAlignmentGroups('ai-browser', workspace.activeSession!.groups.map((group) => group.id))
    expect(workspace.activeSession?.groups).toHaveLength(1)
    expect(workspace.activeSession?.groups[0]?.candidates.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([providerCandidate.id, manualCandidate.id, secondCandidate.id]))
    expect(workspace.activeSession?.groups[0]?.manuallyAdjusted).toBe(true)
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({ kind: 'freeform', content: '最终手动内容' })
    const merged = workspace.activeSession!.groups[0]!
    workspace = store.repository.splitDraftAlignmentGroup({
      projectId: 'ai-browser',
      groupId: merged.id,
      firstClaudeParagraphIds: [merged.claudeParagraphs[0]!.id],
      firstCodexParagraphIds: [merged.codexParagraphs[0]!.id]
    })
    expect(workspace.activeSession?.groups).toHaveLength(2)
    expect(workspace.activeSession?.groups.every((group) => group.manuallyAdjusted)).toBe(true)
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({ kind: 'freeform', content: '最终手动内容' })
  })

  it('keeps Provider draft provenance, history and combination results after a source candidate is deleted', async () => {
    const store = await createStore()
    const externalProvider = {
      provider: 'external_api' as const,
      providerConfigId: '11111111-1111-4111-8111-111111111111',
      displayName: '已验证外部AI',
      kind: 'openai_compatible' as const,
      baseUrl: 'https://provider.example/v1',
      model: 'text-model-v1',
      configurationUpdatedAt: '2026-07-25T00:00:00.000Z'
    }
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'Claude初稿', codexContent: 'Codex初稿' })
    const sourceTask = store.repository.startDraftSourceGeneration({
      projectId: 'ai-browser',
      side: 'codex',
      requirement: '生成完整Codex稿',
      includeProjectContext: true,
      providerSecurity: externalProvider
    })
    expect(parseDraftSourceGenerationTaskSnapshot(sourceTask.inputSnapshot).providerSecurity).toEqual(externalProvider)
    expect(parseDraftSourceGenerationTaskSnapshot(sourceTask.inputSnapshot).projectContext?.project.id).toBe('ai-browser')
    let workspace = store.repository.saveDraftSourceGenerationResult(sourceTask.id, { content: '外部AI生成的Codex完整稿', summary: '完成整稿' })
    expect(workspace.codexSource).toMatchObject({
      sourceKind: 'provider',
      provider: 'external_api',
      providerConfigId: externalProvider.providerConfigId,
      model: externalProvider.model,
      taskId: sourceTask.id
    })

    const firstAlignment = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity: externalProvider, useOutline: false })
    const firstSnapshot = parseDraftAlignmentTaskSnapshot(firstAlignment.inputSnapshot)
    workspace = store.repository.saveDraftAlignmentResult(firstAlignment.id, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' }]
    })
    expect(workspace.activeSession?.codexSnapshot).toMatchObject({
      sourceKind: 'provider',
      provider: 'external_api',
      model: externalProvider.model
    })
    const group = workspace.activeSession!.groups[0]!
    const candidate = store.repository.addFreeformDraftCandidate('ai-browser', group.id, '组合候选')
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser',
      groupId: group.id,
      kind: 'combination',
      sourceIds: ['claude', candidate.id],
      content: '已经冻结的组合结果'
    })
    workspace = store.repository.deleteDraftCandidate('ai-browser', candidate.id)
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      kind: 'combination',
      sourceIds: ['claude', candidate.id],
      content: '已经冻结的组合结果'
    })

    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'Claude第二稿' })
    const secondAlignment = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false, confirmFull: true })
    store.repository.saveDraftAlignmentResult(secondAlignment.id, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' }]
    })
    workspace = store.repository.getDraftComparisonWorkspace('ai-browser')
    expect(workspace.sessionHistory).toHaveLength(2)
    const historical = store.repository.getDraftComparisonWorkspace('ai-browser', firstSnapshot.sessionId)
    expect(historical.activeSession?.id).toBe(firstSnapshot.sessionId)
    expect(historical.activeSession?.groups[0]?.decision?.content).toBe('已经冻结的组合结果')
  })

  it('marks a candidate stale when its frozen paragraph relationship changes before completion', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2', codexContent: 'B1\nB2' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }
      ]
    })
    const [firstGroup, secondGroup] = workspace.activeSession!.groups
    const candidateTask = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: firstGroup!.id, requirement: '保留原意并润色', providerSecurity
    })
    workspace = store.repository.moveDraftParagraph({
      projectId: 'ai-browser', side: 'claude', paragraphId: 'claude-p-1',
      fromGroupId: firstGroup!.id, toGroupId: secondGroup!.id
    })
    expect(workspace.activeSession?.groups[0]?.claudeParagraphs).toHaveLength(0)
    expect(store.repository.saveDraftCandidateResult(candidateTask.id, {
      content: '旧关系生成结果', summary: '旧关系', rationale: '测试'
    })).toMatchObject({ status: 'input_changed', inputRelationChanged: true })
  })

  it('moves an entire candidate history stack without losing the selected current document', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2', codexContent: 'B1\nB2' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-2'], codexParagraphIds: ['codex-p-2'], matchType: 'related' }
      ]
    })
    const [source, target] = workspace.activeSession!.groups
    const parent = store.repository.addFreeformDraftCandidate('ai-browser', source!.id, '第一轮候选')
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: source!.id, parentCandidateId: parent.id, requirement: '再精简一次', providerSecurity
    })
    const child = store.repository.saveDraftCandidateResult(task.id, { content: '第二轮候选', summary: '精简', rationale: '' })
    workspace = store.repository.setDraftGroupDecision({
      projectId: 'ai-browser', groupId: source!.id, kind: 'candidate', sourceId: child.id
    })

    workspace = store.repository.moveDraftCandidate('ai-browser', child.id, target!.id)

    expect(workspace.activeSession?.groups[0]?.candidates).toHaveLength(0)
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      kind: 'freeform', sourceId: null, sourceIds: [], content: '第二轮候选'
    })
    expect(workspace.activeSession?.groups[1]?.candidates.map((candidate) => candidate.id)).toEqual([parent.id, child.id])
    expect(workspace.activeSession?.groups[1]?.candidates.every((candidate) => candidate.inputRelationChanged)).toBe(true)
    expect(workspace.activeSession?.groups.every((group) => group.manuallyAdjusted)).toBe(true)
  })

  it('persists group order, candidate order, notes, markers and same-group paragraph order', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1\nA2\nA3', codexContent: 'B1\nB2\nB3' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [
        { claudeParagraphIds: ['claude-p-1', 'claude-p-2'], codexParagraphIds: ['codex-p-1'], matchType: 'related' },
        { claudeParagraphIds: ['claude-p-3'], codexParagraphIds: ['codex-p-2', 'codex-p-3'], matchType: 'related' }
      ]
    })
    const [first, second] = workspace.activeSession!.groups
    const candidateOne = store.repository.addFreeformDraftCandidate('ai-browser', first!.id, '候选一')
    const candidateTwo = store.repository.addFreeformDraftCandidate('ai-browser', first!.id, '候选二')
    workspace = store.repository.reorderDraftCandidates('ai-browser', first!.id, [candidateTwo.id, candidateOne.id])
    expect(workspace.activeSession?.groups[0]?.candidates.map((candidate) => candidate.id)).toEqual([candidateTwo.id, candidateOne.id])

    workspace = store.repository.setDraftGroupDecision({ projectId: 'ai-browser', groupId: first!.id, kind: 'codex' })
    workspace = store.repository.setDraftGroupNote('ai-browser', first!.id, '只在工作台显示')
    workspace = store.repository.setDraftGroupMarkers('ai-browser', first!.id, [{
      id: 'marker-1', start: 0, end: 2, text: 'B1', note: '开头再确认', status: 'active'
    }])
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      note: '只在工作台显示',
      markers: [{ id: 'marker-1', text: 'B1', note: '开头再确认', status: 'active' }]
    })

    workspace = store.repository.moveDraftParagraph({
      projectId: 'ai-browser', side: 'claude', paragraphId: 'claude-p-2',
      fromGroupId: first!.id, toGroupId: first!.id, toIndex: 0
    })
    expect(workspace.activeSession?.groups[0]?.claudeParagraphs.map((paragraph) => paragraph.id)).toEqual(['claude-p-2', 'claude-p-1'])
    expect(workspace.activeSession?.groups[0]?.decision).toMatchObject({
      kind: 'freeform',
      content: 'B1',
      note: '只在工作台显示',
      markers: [{ id: 'marker-1', text: 'B1', note: '开头再确认', status: 'active' }]
    })

    workspace = store.repository.reorderDraftAlignmentGroups('ai-browser', [second!.id, first!.id])
    expect(workspace.activeSession?.groups.map((group) => group.id)).toEqual([second!.id, first!.id])
    expect(workspace.activeSession?.groups.every((group) => group.manuallyAdjusted)).toBe(true)
  })

  it('preserves the parent trace after a parent candidate is deleted', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', { claudeContent: 'A1', codexContent: 'B1' })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{ claudeParagraphIds: ['claude-p-1'], codexParagraphIds: ['codex-p-1'], matchType: 'related' }]
    })
    const group = workspace.activeSession!.groups[0]!
    const parent = store.repository.addFreeformDraftCandidate('ai-browser', group.id, '父候选')
    const task = store.repository.startDraftCandidateGeneration({
      projectId: 'ai-browser', groupId: group.id, parentCandidateId: parent.id, requirement: '继续改', providerSecurity
    })
    const child = store.repository.saveDraftCandidateResult(task.id, { content: '子候选', summary: '续写', rationale: '' })
    expect(child).toMatchObject({ parentCandidateId: parent.id, parentTraceId: parent.id, revisionRound: 2 })
    workspace = store.repository.deleteDraftCandidate('ai-browser', parent.id)
    expect(workspace.activeSession?.groups[0]?.candidates).toEqual([
      expect.objectContaining({ id: child.id, parentCandidateId: null, parentTraceId: parent.id, revisionRound: 2 })
    ])
  })

  it('splits a selected current-side range with continuous group labels and restores persistent history', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2\nA3',
      codexContent: 'B1\nB2\nB3'
    })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{
        claudeParagraphIds: ['claude-p-1', 'claude-p-2', 'claude-p-3'],
        codexParagraphIds: ['codex-p-1', 'codex-p-2', 'codex-p-3'],
        matchType: 'related'
      }]
    })
    const baseline = store.repository.listDraftComparisonHistory('ai-browser')
    expect(baseline).toHaveLength(1)
    const group = workspace.activeSession!.groups[0]!
    const result = store.repository.startDraftAlignmentSplit({
      projectId: 'ai-browser',
      groupId: group.id,
      side: 'claude',
      paragraphIds: ['claude-p-2'],
      strategy: 'original_order',
      scope: 'current'
    })
    expect(result.task).toBeNull()
    workspace = result.workspace
    expect(workspace.activeSession?.groups.map((item) => ({
      position: item.position,
      labelIndex: item.labelIndex,
      claude: item.claudeParagraphs.map((paragraph) => paragraph.id),
      codex: item.codexParagraphs.map((paragraph) => paragraph.id)
    }))).toEqual([
      { position: 0, labelIndex: 1, claude: ['claude-p-1'], codex: ['codex-p-1', 'codex-p-2', 'codex-p-3'] },
      { position: 1, labelIndex: 2, claude: ['claude-p-2'], codex: [] },
      { position: 2, labelIndex: 3, claude: ['claude-p-3'], codex: [] }
    ])
    expect(store.repository.listDraftComparisonHistory('ai-browser').map((entry) => entry.label))
      .toEqual(['按原顺序拆分', '开始对照'])

    workspace = store.repository.restoreDraftComparisonHistory('ai-browser', baseline[0]!.id)
    expect(workspace.activeSession?.groups).toHaveLength(1)
    expect(workspace.activeSession?.groups[0]?.claudeParagraphs.map((paragraph) => paragraph.id))
      .toEqual(['claude-p-1', 'claude-p-2', 'claude-p-3'])
    expect(store.repository.listDraftComparisonHistory('ai-browser')[0]?.label).toBe('恢复到开始对照')
  })

  it('runs matched split through a frozen Codex task, validates output, caches it and leaves changed input untouched', async () => {
    const store = await createStore()
    store.repository.saveDraftComparisonDrafts('ai-browser', {
      claudeContent: 'A1\nA2\nA3\nA4',
      codexContent: 'B1\nB2\nB3\nB4'
    })
    const alignmentTask = store.repository.startDraftAlignment({ projectId: 'ai-browser', providerSecurity, useOutline: false })
    let workspace = store.repository.saveDraftAlignmentResult(alignmentTask.id, {
      groups: [{
        claudeParagraphIds: ['claude-p-1', 'claude-p-2', 'claude-p-3', 'claude-p-4'],
        codexParagraphIds: ['codex-p-1', 'codex-p-2', 'codex-p-3', 'codex-p-4'],
        matchType: 'related'
      }]
    })
    const baseline = store.repository.listDraftComparisonHistory('ai-browser')[0]!
    const group = workspace.activeSession!.groups[0]!
    const started = store.repository.startDraftAlignmentSplit({
      projectId: 'ai-browser',
      groupId: group.id,
      side: 'claude',
      paragraphIds: ['claude-p-2', 'claude-p-3'],
      strategy: 'extract_below',
      scope: 'matched',
      providerSecurity
    })
    expect(started.task).toMatchObject({ taskType: 'draft_split_match', provider: 'codex_cli' })
    const snapshot = parseDraftSplitMatchTaskSnapshot(started.task!.inputSnapshot)
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(buildDraftSplitMatchPrompt(snapshot)).toContain('只输出JSON')
    expect(() => validateDraftSplitMatchOutput(snapshot, { matchedParagraphIds: ['missing'] }))
      .toThrow('DRAFT_SPLIT_MATCH_UNKNOWN_ID')
    workspace = store.repository.saveDraftSplitMatchResult(started.task!.id, {
      matchedParagraphIds: ['codex-p-2', 'codex-p-3']
    })
    expect(workspace.activeSession?.groups.map((item) => ({
      claude: item.claudeParagraphs.map((paragraph) => paragraph.id),
      codex: item.codexParagraphs.map((paragraph) => paragraph.id)
    }))).toEqual([
      { claude: ['claude-p-1', 'claude-p-4'], codex: ['codex-p-1', 'codex-p-4'] },
      { claude: ['claude-p-2', 'claude-p-3'], codex: ['codex-p-2', 'codex-p-3'] }
    ])

    workspace = store.repository.restoreDraftComparisonHistory('ai-browser', baseline.id)
    const cached = store.repository.startDraftAlignmentSplit({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      side: 'claude',
      paragraphIds: ['claude-p-2', 'claude-p-3'],
      strategy: 'extract_below',
      scope: 'matched',
      providerSecurity
    })
    expect(cached.task).toBeNull()
    expect(cached.workspace.activeSession?.groups).toHaveLength(2)

    workspace = store.repository.restoreDraftComparisonHistory('ai-browser', baseline.id)
    const staleTask = store.repository.startDraftAlignmentSplit({
      projectId: 'ai-browser',
      groupId: workspace.activeSession!.groups[0]!.id,
      side: 'claude',
      paragraphIds: ['claude-p-2'],
      strategy: 'extract_below',
      scope: 'matched',
      providerSecurity
    }).task!
    workspace = store.repository.moveDraftParagraph({
      projectId: 'ai-browser',
      side: 'codex',
      paragraphId: 'codex-p-4',
      fromGroupId: workspace.activeSession!.groups[0]!.id,
      toGroupId: workspace.activeSession!.groups[0]!.id,
      toIndex: 0
    })
    const beforeFailedSave = workspace.activeSession!.groups[0]!.codexParagraphs.map((paragraph) => paragraph.id)
    expect(() => store.repository.saveDraftSplitMatchResult(staleTask.id, { matchedParagraphIds: ['codex-p-2'] }))
      .toThrow('DRAFT_SPLIT_SOURCE_CHANGED')
    expect(store.repository.getDraftComparisonWorkspace('ai-browser').activeSession?.groups[0]?.codexParagraphs.map((paragraph) => paragraph.id))
      .toEqual(beforeFailedSave)
  })
})
