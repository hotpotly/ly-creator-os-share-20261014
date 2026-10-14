import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import {
  buildScriptMaterialChatPrompt,
  buildScriptMaterialGeneratePrompt,
  parseScriptMaterialAuditTaskSnapshot,
  parseScriptMaterialChatTaskSnapshot,
  parseScriptMaterialExtractTaskSnapshot,
  parseScriptMaterialGenerateTaskSnapshot,
  parseScriptMaterialMapTaskSnapshot,
  validateScriptMaterialAuditOutput,
  validateScriptMaterialChatOutput,
  validateScriptMaterialExtractOutput,
  validateScriptMaterialGenerateOutput,
  validateScriptMaterialMapOutput
} from '../../src/main/script-material'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../src/shared/domain'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')
const providerSecurity = {
  provider: 'codex_cli' as const,
  providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
  displayName: 'Codex CLI',
  cliVersion: 'test',
  fingerprint: 'script-material-test-fingerprint',
  policyVersion: 'test-policy'
}

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-script-material-'))
  roots.push(directory)
  const store = await openWorkspaceStore(directory)
  stores.push(store)
  return store
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('script material provider workflow', () => {
  it('freezes the same first-round request for two AIs and never replaces a failed side with another provider', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '先试了键盘。\n后来换成触控板。',
      aiCount: 2,
      webSearchMode: 'automatic'
    })
    store.repository.createScriptMaterialRevision('ios')
    const currentDocumentParagraphs = [{ id: 'current-1', position: 0, text: '当前文案保持不变。' }]
    const claudeSecurity = {
      ...providerSecurity,
      provider: 'claude_cli' as const,
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
      displayName: 'Claude CLI',
      fingerprint: 'script-material-claude-test-fingerprint'
    }
    const firstRoundTasks = store.repository.startScriptMaterialChatBatch({
      projectId: 'ios',
      message: '',
      includeProjectContext: true,
      currentDocumentParagraphs,
      requests: [{
        side: 'codex',
        providerSecurity
      }, {
        side: 'claude',
        providerSecurity: claudeSecurity
      }]
    })
    const codexTask = firstRoundTasks[0]!
    const claudeTask = firstRoundTasks[1]!
    const codexSnapshot = parseScriptMaterialChatTaskSnapshot(codexTask.inputSnapshot)
    const claudeSnapshot = parseScriptMaterialChatTaskSnapshot(claudeTask.inputSnapshot)

    expect({
      revisionId: codexSnapshot.revisionId,
      sourceContent: codexSnapshot.sourceContent,
      message: codexSnapshot.message,
      currentDocumentParagraphs: codexSnapshot.currentDocumentParagraphs,
      webSearchMode: codexSnapshot.webSearchMode,
      projectContext: codexSnapshot.projectContext
    }).toEqual({
      revisionId: claudeSnapshot.revisionId,
      sourceContent: claudeSnapshot.sourceContent,
      message: claudeSnapshot.message,
      currentDocumentParagraphs: claudeSnapshot.currentDocumentParagraphs,
      webSearchMode: claudeSnapshot.webSearchMode,
      projectContext: claudeSnapshot.projectContext
    })
    expect(codexSnapshot.projectContext).not.toBeNull()
    expect(codexSnapshot.providerSecurity.provider).toBe('codex_cli')
    expect(claudeSnapshot.providerSecurity.provider).toBe('claude_cli')

    store.repository.updateTaskRun(claudeTask.id, {
      status: 'failed',
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorMessage: 'Claude本轮不可用',
      finishedAt: new Date().toISOString()
    })
    let workspace = store.repository.saveScriptMaterialChatResult(codexTask.id, {
      answer: 'Codex侧已完成。',
      draftContent: '先试键盘，后来换成触控板。',
      annotations: []
    }, { model: 'gpt-5.6-sol', reasoningEffort: 'max' })

    expect(workspace.drafts).toHaveLength(1)
    expect(workspace.drafts[0]).toMatchObject({ side: 'codex', content: '先试键盘，后来换成触控板。' })
    expect(workspace.drafts.some((draft) => draft.side === 'claude')).toBe(false)
    expect(store.repository.getTaskRun(claudeTask.id)).toMatchObject({
      provider: 'claude_cli',
      status: 'failed',
      errorCode: 'PROVIDER_UNAVAILABLE'
    })

    const retriedClaudeTask = store.repository.retryTaskRun(claudeTask.id)
    expect(retriedClaudeTask).toMatchObject({
      provider: 'claude_cli',
      retryOfId: claudeTask.id
    })
    expect(retriedClaudeTask.inputSnapshot).toBe(claudeTask.inputSnapshot)
    const chatTaskProviders = store.repository.listTaskRuns()
      .filter((task) => task.taskType === 'script_material_chat')
      .map((task) => task.provider)
    expect(chatTaskProviders.filter((provider) => provider === 'codex_cli')).toHaveLength(1)
    expect(chatTaskProviders.filter((provider) => provider === 'claude_cli')).toHaveLength(2)
    store.repository.cancelTaskRun(retriedClaudeTask.id)
    workspace = store.repository.getScriptMaterialWorkspace('ios')
    expect(workspace.drafts).toHaveLength(1)
    expect(workspace.drafts[0]?.side).toBe('codex')
  })

  it('keeps the compatible Codex task when required web search rejects the Claude side', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '价格和参数都需要联网查证。',
      aiCount: 2,
      webSearchMode: 'required'
    })
    store.repository.createScriptMaterialRevision('ios')
    const claudeSecurity = {
      ...providerSecurity,
      provider: 'claude_cli' as const,
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
      displayName: 'Claude CLI',
      fingerprint: 'script-material-claude-required-web'
    }
    const tasks = store.repository.startScriptMaterialChatBatch({
      projectId: 'ios',
      message: '',
      requests: [{
        side: 'codex',
        providerSecurity
      }, {
        side: 'claude',
        providerSecurity: claudeSecurity
      }]
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ provider: 'codex_cli', status: 'queued' })
    expect(store.repository.listTaskRuns().filter((task) => task.taskType === 'script_material_chat')).toEqual([
      expect.objectContaining({ id: tasks[0]!.id, provider: 'codex_cli', status: 'queued' })
    ])
  })

  it('preserves shared input errors instead of reporting every batch failure as provider unavailable', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '超长原稿'.repeat(130_000),
      aiCount: 2,
      webSearchMode: 'automatic'
    })
    store.repository.createScriptMaterialRevision('ios')

    expect(() => store.repository.startScriptMaterialChatBatch({
      projectId: 'ios',
      requests: [{
        side: 'codex',
        providerSecurity
      }]
    })).toThrow('SCRIPT_MATERIAL_INPUT_TOO_LARGE')
    expect(store.repository.listTaskRuns().filter((task) => task.taskType === 'script_material_chat')).toHaveLength(0)
  })

  it('budgets the actual Provider resource selection without counting generation context twice', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '接近上限时仍应按真实Prompt预算。',
      aiCount: 1,
      webSearchMode: 'disabled'
    })
    store.repository.createScriptMaterialRevision('ios')
    const baseSnapshot = store.repository.buildTaskResourceSnapshot('ios', { preserveFullContext: true })
    const generationContext = structuredClone(baseSnapshot.generationContext!)
    const longContext = '长'.repeat(250_000)
    generationContext.project.description = longContext
    const frozenResourceSnapshot = { ...baseSnapshot, generationContext }

    const task = store.repository.startScriptMaterialChat({
      projectId: 'ios', side: 'codex', message: '生成首稿', providerSecurity, frozenResourceSnapshot
    })
    const snapshot = parseScriptMaterialChatTaskSnapshot(task.inputSnapshot)
    const prompt = buildScriptMaterialChatPrompt(snapshot)
    expect(snapshot.inputBudget.estimatedCharacters).toBeLessThan(snapshot.inputBudget.maximumCharacters)
    expect(prompt.length).toBeLessThan(snapshot.inputBudget.maximumCharacters)
    expect(prompt).toContain(longContext)
    expect(prompt.indexOf(longContext)).toBe(prompt.lastIndexOf(longContext))
  })

  it('writes first, keeps a free-form conversation and maps the finished draft afterward', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '先试了键盘。\n后来换成触控板。',
      aiCount: 1,
      webSearchMode: 'disabled'
    })
    store.repository.createScriptMaterialRevision('ios')
    const frozenResourceSnapshot = store.repository.buildTaskResourceSnapshot('ios', { preserveFullContext: true })

    const chatTask = store.repository.startScriptMaterialChat({
      projectId: 'ios',
      side: 'codex',
      message: '',
      preferredModel: 'gpt-5.6-terra',
      currentDocumentParagraphs: [{ id: 'current-1', position: 0, text: '我当前先写了键盘。' }],
      frozenResourceSnapshot,
      providerSecurity
    })
    const chatSnapshot = parseScriptMaterialChatTaskSnapshot(chatTask.inputSnapshot)
    expect(chatSnapshot.history).toEqual([])
    expect(chatSnapshot.currentDraftContent).toBe('')
    expect(chatSnapshot.preferredModel).toBe('gpt-5.6-terra')
    expect(chatSnapshot.resourceSnapshot).toEqual(frozenResourceSnapshot)
    expect(chatSnapshot.message).toContain('主动重构')
    const firstDraftPrompt = buildScriptMaterialChatPrompt(chatSnapshot)
    expect(firstDraftPrompt).toContain('相同的理解、推理和写作能力')
    expect(firstDraftPrompt).toContain('不要把原稿顺序默认视为成稿顺序')
    expect(firstDraftPrompt).toContain('XXX')
    expect(firstDraftPrompt).toContain('方括号')
    expect(firstDraftPrompt).toContain('必须先主动联网搜索')
    expect(firstDraftPrompt).toContain('完整AI稿')
    expect(firstDraftPrompt).toContain('<PROJECT_RESOURCE_SELECTION>')
    expect(firstDraftPrompt).toContain('<CURRENT_DOCUMENT_PARAGRAPHS>')
    expect(firstDraftPrompt).toContain('我当前先写了键盘。')

    let workspace = store.repository.saveScriptMaterialChatResult(chatTask.id, validateScriptMaterialChatOutput({
      answer: '我先按自然叙事顺序整理成完整稿。',
      draftContent: '后来我换成了触控板。\n\n在那之前，我先试过键盘。',
      annotations: []
    }), { model: 'test-model', reasoningEffort: 'high' })
    expect(workspace.points).toHaveLength(2)
    expect(workspace.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', '直接成稿'],
      ['assistant', '我先按自然叙事顺序整理成完整稿。']
    ])
    expect(workspace.drafts[0]).toMatchObject({
      model: 'test-model',
      content: '后来我换成了触控板。\n\n在那之前，我先试过键盘。',
      draftVersion: 1,
      mappingState: 'pending'
    })
    expect(workspace.selectedCodexDraftId).toBe(workspace.drafts[0]?.id)
    expect(workspace.drafts[0]?.paragraphs[0]?.sourcePointIds).toEqual([])

    store.repository.native.prepare('DELETE FROM script_material_points WHERE revision_id = ?').run(workspace.activeRevision!.id)
    store.repository.native.prepare('UPDATE script_material_revisions SET points_confirmed = 0, confirmed_at = NULL WHERE id = ?').run(workspace.activeRevision!.id)
    workspace = store.repository.getScriptMaterialWorkspace('ios')
    expect(workspace.points).toEqual([])

    const mapTask = store.repository.startScriptMaterialMappingFromChat(chatTask.id)
    workspace = store.repository.getScriptMaterialWorkspace('ios')
    expect(workspace.points).toHaveLength(2)
    expect(workspace.activeRevision?.pointsConfirmed).toBe(true)
    const mapSnapshot = parseScriptMaterialMapTaskSnapshot(mapTask.inputSnapshot)
    expect(mapSnapshot.draftParagraphs).toHaveLength(2)
    expect(mapSnapshot.currentDocumentParagraphs).toEqual([{ id: 'current-1', position: 0, text: '我当前先写了键盘。' }])
    expect(() => validateScriptMaterialMapOutput(mapSnapshot, {
      draftParagraphMappings: [{
        paragraphId: mapSnapshot.draftParagraphs[0]!.id,
        sourcePointIds: ['unknown']
      }, {
        paragraphId: mapSnapshot.draftParagraphs[1]!.id,
        sourcePointIds: [workspace.points[0]!.id]
      }],
      currentParagraphMappings: [{
        currentParagraphId: 'current-1',
        sourcePointIds: [workspace.points[0]!.id],
        draftParagraphIds: [mapSnapshot.draftParagraphs[1]!.id]
      }]
    })).toThrow('PROVIDER_SCRIPT_MATERIAL_POINT_REF_INVALID')
    expect(() => validateScriptMaterialMapOutput(mapSnapshot, {
      draftParagraphMappings: mapSnapshot.draftParagraphs.map((paragraph) => ({
        paragraphId: paragraph.id,
        sourcePointIds: []
      })),
      currentParagraphMappings: [{
        currentParagraphId: 'current-1',
        sourcePointIds: [],
        draftParagraphIds: []
      }]
    })).toThrow('PROVIDER_SCRIPT_MATERIAL_MAPPING_EMPTY')

    workspace = store.repository.saveScriptMaterialMapResult(mapTask.id, validateScriptMaterialMapOutput(mapSnapshot, {
      draftParagraphMappings: [{
        paragraphId: mapSnapshot.draftParagraphs[0]!.id,
        sourcePointIds: [workspace.points[1]!.id]
      }, {
        paragraphId: mapSnapshot.draftParagraphs[1]!.id,
        sourcePointIds: [workspace.points[0]!.id]
      }],
      currentParagraphMappings: [{
        currentParagraphId: 'current-1',
        sourcePointIds: [workspace.points[0]!.id],
        draftParagraphIds: [mapSnapshot.draftParagraphs[1]!.id]
      }]
    }))
    expect(workspace.activeRevision?.pointsConfirmed).toBe(true)
    expect(workspace.points).toHaveLength(2)
    expect(workspace.drafts[0]?.mappingState).toBe('ready')
    expect(workspace.drafts[0]?.paragraphs[0]?.sourcePointIds).toEqual([workspace.points[1]!.id])
    expect(workspace.drafts[0]?.currentMappings).toEqual([{
      currentParagraphId: 'current-1',
      currentParagraphText: '我当前先写了键盘。',
      sourcePointIds: [workspace.points[0]!.id],
      draftParagraphIds: [mapSnapshot.draftParagraphs[1]!.id]
    }])
    const remapTask = store.repository.startScriptMaterialMapping({
      projectId: 'ios',
      draftId: workspace.drafts[0]!.id,
      currentDocumentParagraphs: mapSnapshot.currentDocumentParagraphs,
      providerSecurity
    })
    expect(remapTask.title).toContain('重新对应')
    store.repository.cancelTaskRun(remapTask.id)
    workspace = store.repository.getScriptMaterialWorkspace('ios')
    expect(workspace.drafts[0]).toMatchObject({ mappingState: 'failed', mappingError: '对应任务已取消' })
    const retriedMapTask = store.repository.retryTaskRun(remapTask.id)
    workspace = store.repository.getScriptMaterialWorkspace('ios')
    expect(workspace.drafts[0]).toMatchObject({ mappingState: 'pending', mappingTaskId: retriedMapTask.id })
    workspace = store.repository.saveScriptMaterialMapResult(retriedMapTask.id, validateScriptMaterialMapOutput(
      parseScriptMaterialMapTaskSnapshot(retriedMapTask.inputSnapshot),
      {
        draftParagraphMappings: [{
          paragraphId: mapSnapshot.draftParagraphs[0]!.id,
          sourcePointIds: [workspace.points[1]!.id]
        }, {
          paragraphId: mapSnapshot.draftParagraphs[1]!.id,
          sourcePointIds: [workspace.points[0]!.id]
        }],
        currentParagraphMappings: [{
          currentParagraphId: 'current-1',
          sourcePointIds: [workspace.points[0]!.id],
          draftParagraphIds: [mapSnapshot.draftParagraphs[1]!.id]
        }]
      }
    ))

    const followUp = store.repository.startScriptMaterialChat({
      projectId: 'ios',
      side: 'codex',
      message: '把开头写得更直接，其他地方按你的判断处理。',
      providerSecurity
    })
    const followUpSnapshot = parseScriptMaterialChatTaskSnapshot(followUp.inputSnapshot)
    expect(followUpSnapshot.history).toHaveLength(2)
    expect(followUpSnapshot.currentDraftContent).toBe(workspace.drafts[0]?.content)
    expect(followUpSnapshot.message).toContain('按你的判断处理')
    workspace = store.repository.saveScriptMaterialChatResult(followUp.id, {
      answer: '我重新整理了一篇。',
      draftContent: '先试键盘，再换触控板，结论更直接。',
      annotations: []
    }, { model: 'test-model', reasoningEffort: 'high' })
    expect(workspace.drafts).toHaveLength(2)
    expect(workspace.drafts.map((draft) => draft.draftVersion)).toEqual([1, 2])
    expect(workspace.drafts[0]?.content).toBe('后来我换成了触控板。\n\n在那之前，我先试过键盘。')
    expect(workspace.selectedCodexDraftId).toBe(workspace.drafts[1]?.id)
  })

  it('stores a targeted rewrite as a local candidate without creating another full draft', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '先试了键盘。\n后来换成触控板。',
      aiCount: 1,
      webSearchMode: 'disabled'
    })
    store.repository.createScriptMaterialRevision('ios')
    const chatTask = store.repository.startScriptMaterialChat({
      projectId: 'ios',
      side: 'codex',
      message: '',
      providerSecurity
    })
    let workspace = store.repository.saveScriptMaterialChatResult(chatTask.id, {
      answer: '已生成完整稿。',
      draftContent: '后来我换成了触控板。\n\n在那之前，我先试过键盘。',
      annotations: []
    }, { model: 'test-model', reasoningEffort: 'high' })
    const draft = workspace.drafts[0]!
    const target = draft.paragraphs[0]!
    const selectedText = '触控板'
    const selectedStart = target.text.indexOf(selectedText)
    const applicationTargetText = '当前文案里的触控板段落'
    const applicationTarget = {
      targetId: 'material-relation-target', selectedText: applicationTargetText,
      contentHash: createHash('sha256').update(applicationTargetText).digest('hex'), from: 3, to: 3 + applicationTargetText.length
    }

    const rewriteTask = store.repository.startScriptMaterialRewriteCandidate({
      projectId: 'ios',
      draftId: draft.id,
      applicationTarget,
      paragraphIds: [target.id],
      selectedParagraphId: target.id,
      selectedText,
      selectedStart,
      selectedEnd: selectedStart + selectedText.length,
      requirement: '换成更口语的说法',
      preferredModel: 'gpt-5.6-sol',
      currentDocumentParagraphs: [{ id: 'current-rewrite-1', position: 0, text: '当前文案里的可信上下文。' }],
      frozenResourceSnapshot: store.repository.buildTaskResourceSnapshot('ios', { preserveFullContext: true }),
      providerSecurity
    })
    workspace = store.repository.getScriptMaterialWorkspace('ios')
    expect(workspace.rewriteCandidates).toHaveLength(1)
    expect(workspace.rewriteCandidates[0]).toMatchObject({
      draftId: draft.id,
      paragraphIds: [target.id],
      selectedText,
      requirement: '换成更口语的说法',
      content: '',
      taskId: rewriteTask.id
    })
    const pendingCandidateId = workspace.rewriteCandidates[0]!.id
    const snapshot = parseScriptMaterialChatTaskSnapshot(rewriteTask.inputSnapshot)
    const prompt = buildScriptMaterialChatPrompt(snapshot)
    expect(snapshot.rewriteTarget).toMatchObject({
      draftId: draft.id,
      selectedParagraphId: target.id,
      selectedText
    })
    expect(snapshot.currentDocumentParagraphs).toEqual([
      { id: 'current-rewrite-1', position: 0, text: '当前文案里的可信上下文。' }
    ])
    expect(prompt).toContain('这是一次局部候选生成，不是全文改写')
    expect(prompt).toContain('draftContent只返回可以直接替换这段选中文字的候选文字')
    expect(prompt).toContain('<REWRITE_TARGET>')
    expect(prompt).toContain('当前文案里的可信上下文。')
    expect(prompt).toContain('<PROJECT_RESOURCE_SELECTION>')

    workspace = store.repository.saveScriptMaterialChatResult(rewriteTask.id, {
      answer: '已给出局部候选。',
      draftContent: '触控起来更顺手',
      annotations: []
    }, { model: 'gpt-5.6-sol', reasoningEffort: 'max' })

    expect(workspace.drafts).toHaveLength(1)
    expect(workspace.messages).toHaveLength(2)
    expect(workspace.rewriteCandidates).toHaveLength(1)
    expect(workspace.rewriteCandidates[0]).toMatchObject({
      id: pendingCandidateId,
      draftId: draft.id,
      paragraphIds: [target.id],
      selectedText,
      selectedStart,
      selectedEnd: selectedStart + selectedText.length,
      requirement: '换成更口语的说法',
      content: '触控起来更顺手',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
      taskId: rewriteTask.id
    })
    expect(() => store.repository.startScriptMaterialRewriteCandidate({
      projectId: 'ios', draftId: draft.id, parentCandidateId: pendingCandidateId,
      applicationTarget: { ...applicationTarget, targetId: 'silently-rebound-target' }, paragraphIds: [target.id],
      selectedParagraphId: target.id, selectedText, selectedStart, selectedEnd: selectedStart + selectedText.length,
      requirement: '不能静默重绑', providerSecurity
    })).toThrow('继续修改必须沿用上一轮当前文案目标')
    const followUpTask = store.repository.startScriptMaterialRewriteCandidate({
      projectId: 'ios',
      draftId: draft.id,
      parentCandidateId: pendingCandidateId,
      applicationTarget,
      paragraphIds: [target.id],
      selectedParagraphId: target.id,
      selectedText,
      selectedStart,
      selectedEnd: selectedStart + selectedText.length,
      requirement: '再精简一些',
      preferredModel: 'gpt-5.6-sol',
      providerSecurity
    })
    const followUpSnapshot = parseScriptMaterialChatTaskSnapshot(followUpTask.inputSnapshot)
    expect(followUpSnapshot.currentDraftContent).toBe('触控起来更顺手')
    expect(followUpSnapshot.rewriteTarget).toMatchObject({
      parentCandidateId: pendingCandidateId,
      parentCandidateContent: '触控起来更顺手',
      applicationTarget
    })
    expect(buildScriptMaterialChatPrompt(followUpSnapshot)).toContain('必须以PARENT_CANDIDATE中的上一轮候选为直接改写对象')
    workspace = store.repository.saveScriptMaterialChatResult(followUpTask.id, {
      answer: '已继续精简。',
      draftContent: '触控更顺手',
      annotations: []
    }, { model: 'gpt-5.6-sol', reasoningEffort: 'max' })
    expect(workspace.rewriteCandidates.at(-1)).toMatchObject({
      parentCandidateId: pendingCandidateId,
      applicationTarget,
      content: '触控更顺手'
    })
    expect(() => RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(workspace)).not.toThrow()
  })

  it('fills XXX directly, keeps exact AI/web annotations and lets the user confirm inferred text', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '我最喜欢它的XXX，产品容量这里写XXX。',
      aiCount: 1,
      webSearchMode: 'automatic'
    })
    store.repository.createScriptMaterialRevision('ios')
    const chatTask = store.repository.startScriptMaterialChat({
      projectId: 'ios',
      side: 'codex',
      message: '',
      providerSecurity
    })
    const officialUrl = 'https://example.com/product'
    const output = validateScriptMaterialChatOutput({
      answer: '我已经主动补全两处XXX，并标出需要确认和联网核实的文字。',
      draftContent: '我最喜欢它的生态联动，官方提供4TB版本。',
      annotations: [{
        text: '生态联动',
        provenance: 'needs_confirmation',
        note: '根据上下文推断的个人偏好，需要用户确认',
        webSources: []
      }, {
        text: '4TB',
        provenance: 'web_supplement',
        note: '来自官方产品页',
        webSources: [{ title: '官方产品页', url: officialUrl }]
      }]
    })
    let workspace = store.repository.saveScriptMaterialChatResult(chatTask.id, output, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
      webSearchMode: 'automatic',
      webSearches: [{ url: officialUrl }]
    })
    const paragraph = workspace.drafts[0]!.paragraphs[0]!
    expect(workspace.drafts[0]).toMatchObject({ model: 'gpt-5.6-sol', reasoningEffort: 'max' })
    expect(paragraph.annotations.map((annotation) => ({
      text: annotation.text,
      provenance: annotation.provenance,
      status: annotation.status
    }))).toEqual([
      { text: '生态联动', provenance: 'needs_confirmation', status: 'active' },
      { text: '4TB', provenance: 'web_supplement', status: 'active' }
    ])
    expect(paragraph.webSources).toEqual([{ title: '官方产品页', url: officialUrl }])

    const pendingId = paragraph.annotations[0]!.id
    workspace = store.repository.confirmScriptMaterialAnnotations(
      'ios',
      workspace.drafts[0]!.id,
      paragraph.id,
      [pendingId]
    )
    expect(workspace.drafts[0]!.paragraphs[0]!.annotations[0]!.status).toBe('confirmed')
    expect(workspace.drafts[0]!.paragraphs[0]!.annotations[1]!.status).toBe('active')

    workspace = store.repository.setScriptMaterialManualMarks(
      'ios',
      workspace.drafts[0]!.id,
      paragraph.id,
      [{
        id: 'manual-highlight-1',
        start: 1,
        end: 5,
        text: paragraph.text.slice(1, 5),
        style: 'highlight'
      }, {
        id: 'manual-underline-1',
        start: 5,
        end: 9,
        text: paragraph.text.slice(5, 9),
        style: 'underline'
      }]
    )
    expect(workspace.drafts[0]!.paragraphs[0]!.manualMarks).toEqual([
      { id: 'manual-highlight-1', start: 1, end: 5, text: paragraph.text.slice(1, 5), style: 'highlight' },
      { id: 'manual-underline-1', start: 5, end: 9, text: paragraph.text.slice(5, 9), style: 'underline' }
    ])
    expect(() => store.repository.setScriptMaterialManualMarks(
      'ios',
      workspace.drafts[0]!.id,
      paragraph.id,
      [{ id: 'stale-mark', start: 1, end: 5, text: '已经变化', style: 'strike' }]
    )).toThrow('文案标记文字已经变化')

    const unverifiedTask = store.repository.startScriptMaterialChat({
      projectId: 'ios',
      side: 'codex',
      message: '把容量换成另一个具体参数。',
      providerSecurity
    })
    workspace = store.repository.saveScriptMaterialChatResult(unverifiedTask.id, {
      answer: '已更新参数。',
      draftContent: '官方提供8TB版本。',
      annotations: [{
        text: '8TB',
        provenance: 'web_supplement',
        note: '声称来自网页但没有访问记录',
        webSources: [{ title: '未访问来源', url: 'https://example.com/unvisited' }]
      }]
    }, {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
      webSearchMode: 'automatic',
      webSearches: []
    })
    expect(workspace.drafts.at(-1)!.paragraphs[0]!.annotations[0]).toMatchObject({
      text: '8TB',
      provenance: 'needs_confirmation',
      webSources: []
    })

    expect(() => validateScriptMaterialChatOutput({
      answer: '错误标记',
      draftContent: '正文里没有这句话。',
      annotations: [{
        text: '并不存在',
        provenance: 'ai_supplement',
        note: '错误',
        webSources: []
      }]
    })).toThrow('PROVIDER_SCRIPT_MATERIAL_ANNOTATION_TEXT_INVALID')
  })

  it('only paints researched public facts blue after persisting complete runtime evidence', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '官方原价XXX，我实际到手价XXX。', aiCount: 1, webSearchMode: 'automatic'
    })
    const workspace = store.repository.createScriptMaterialRevision('ios')
    const task = store.repository.startScriptMaterialChat({ projectId: 'ios', side: 'codex', message: '', providerSecurity })
    const targetPreparation = {
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      providerSecurity,
      requestedModel: 'gpt-5.6-sol',
      actualModel: 'gpt-5.6-sol',
      requestedReasoningEffort: 'max',
      actualReasoningEffort: 'max',
      historyThreadId: null,
      providerThreadId: null,
      historyMessageIds: [],
      historyHash: 'a'.repeat(64)
    }
    const request = store.repository.prepareContentInstructionRequest({
      projectId: 'ios', sessionScope: 'r16e-fact-evidence', surface: 'script_material_first_draft',
      generationId: workspace.activeRevision!.id, target: null, materialRevisionId: workspace.activeRevision!.id,
      displayText: '直接成稿并主动补齐公开原价', editorDocument: { type: 'doc', content: [] }, references: [], constraints: [],
      includeProjectContext: false, webSearchMode: 'automatic', factRegion: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z', aiCount: 1, targets: [targetPreparation]
    })
    store.repository.bindContentProviderInput(request.request.id, request.targets[0]!.id, task.id)
    const frozenProviderInput = store.repository.getContentProviderInputByTaskId(task.id)!
    const publicPlaceholderId = frozenProviderInput.placeholders.find((placeholder) => placeholder.kind === 'public_fact')!.id
    const userPlaceholderId = frozenProviderInput.placeholders.find((placeholder) => placeholder.kind === 'user_only_fact')!.id
    store.repository.appendContentInstructionTargetEvent({
      targetId: request.targets[0]!.id, eventKind: 'task_linked', actualModel: 'gpt-5.6-sol', actualReasoningEffort: 'max',
      providerThreadId: null, taskId: task.id, status: 'queued'
    })

    const officialUrl = 'https://example.com/product-price'
    expect(() => store.repository.saveScriptMaterialChatResult(task.id, {
      answer: '没有返回事实标记。',
      draftContent: '官方原价999元，我实际到手价待填写。',
      annotations: []
    }, {
      model: 'gpt-5.6-sol', reasoningEffort: 'max', webSearchMode: 'automatic',
      webSearches: [{ type: 'open_page', url: officialUrl, runtimeAccessId: 'web-access-actual-1', accessedAt: '2026-08-05T00:00:02.000Z' }]
    })).toThrow('PROVIDER_PUBLIC_PLACEHOLDER_EVIDENCE_MISSING')
    const saved = store.repository.saveScriptMaterialChatResult(task.id, {
      answer: '已核实公开价格，并保留个人价格待填。',
      draftContent: '官方原价999元，我实际到手价【请填写实际到手价】。',
      annotations: [{
        text: '999元', provenance: 'web_supplement', note: '官方公开原价', claim: '该产品官方原价为999元',
        factType: 'price', priceKind: 'launch_official', currency: 'CNY', confirmationKind: null, placeholderId: publicPlaceholderId,
        webSources: [{ title: '官方价格页', url: officialUrl }]
      }, {
        text: '【请填写实际到手价】', provenance: 'needs_confirmation', note: '只有用户本人知道实际成交价',
        claim: null, factType: null, currency: null, confirmationKind: 'user_only', placeholderId: userPlaceholderId, webSources: []
      }]
    }, {
      model: 'gpt-5.6-sol', reasoningEffort: 'max', webSearchMode: 'automatic',
      webSearches: [{
        type: 'open_page', url: officialUrl, runtimeAccessId: 'web-access-actual-1', accessedAt: '2026-08-05T00:00:02.000Z'
      }]
    })

    expect(saved.drafts[0]!.paragraphs[0]!.annotations.map((annotation) => annotation.provenance))
      .toEqual(['web_supplement', 'needs_confirmation'])
    expect(store.repository.listContentFactEvidence(task.id)).toEqual([expect.objectContaining({
      requestId: request.request.id,
      targetId: request.targets[0]!.id,
      claim: '该产品官方原价为999元',
      sourceUrl: officialUrl,
      market: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z',
      evidenceType: 'price',
      priceKind: 'launch_official',
      currency: 'CNY',
      runtimeAccessId: 'web-access-actual-1',
      accessedAt: '2026-08-05T00:00:02.000Z'
    })])
    expect(() => store.repository.saveScriptMaterialChatResult(task.id, {
      answer: '公开价格不能推给用户填。',
      draftContent: '官方原价999元，【请填写官方原价】',
      annotations: [{
        text: '999元', provenance: 'web_supplement', note: '官方公开原价', claim: '该产品官方原价为999元',
        factType: 'price', priceKind: 'launch_official', currency: 'CNY', confirmationKind: null, placeholderId: publicPlaceholderId,
        webSources: [{ title: '官方价格页', url: officialUrl }]
      }, {
        text: '【请填写官方原价】', provenance: 'needs_confirmation', note: '我实际购买价需要用户填写',
        claim: null, factType: null, currency: null, confirmationKind: 'user_only', placeholderId: userPlaceholderId, webSources: []
      }]
    }, {
      model: 'gpt-5.6-sol', reasoningEffort: 'max', webSearchMode: 'automatic',
      webSearches: [{ type: 'open_page', url: officialUrl, runtimeAccessId: 'web-access-invalid-red', accessedAt: '2026-08-05T00:00:03.000Z' }]
    }))
      .toThrow('PROVIDER_USER_FACT_CONFIRMATION_INVALID')
    expect(() => store.repository.native.prepare('UPDATE content_fact_evidence SET claim=? WHERE task_id=?')
      .run('伪造结论', task.id)).toThrow('immutable')
  })

  it('freezes one source request, validates exact point ranges and persists a traced AI draft', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '先试了键盘。\n后来换成触控板。',
      requirement: '调整顺序，但不要编造体验。',
      aiCount: 1,
      webSearchMode: 'disabled'
    })
    let workspace = store.repository.createScriptMaterialRevision('ios')
    const extractTask = store.repository.startScriptMaterialExtraction({ projectId: 'ios', providerSecurity })
    const extractSnapshot = parseScriptMaterialExtractTaskSnapshot(extractTask.inputSnapshot)
    expect(extractSnapshot.sourceContent).toBe(workspace.workingContent)
    expect(() => validateScriptMaterialExtractOutput(extractSnapshot, {
      points: [{ sourceStart: 0, sourceEnd: 6, sourceText: '并非原文。', summary: '错误' }]
    })).toThrow('PROVIDER_SCRIPT_MATERIAL_SOURCE_RANGE_INVALID')

    const extractOutput = validateScriptMaterialExtractOutput(extractSnapshot, {
      points: [
        { sourceStart: 0, sourceEnd: 6, sourceText: '先试了键盘。', summary: '先试键盘' },
        { sourceStart: 7, sourceEnd: 15, sourceText: '后来换成触控板。', summary: '后来换触控板' }
      ]
    })
    workspace = store.repository.saveScriptMaterialExtractionResult(extractTask.id, extractOutput)
    workspace = store.repository.confirmScriptMaterialPoints('ios', workspace.activeRevision!.id)

    const generationTask = store.repository.startScriptMaterialGeneration({
      projectId: 'ios',
      side: 'codex',
      providerSecurity
    })
    const generationSnapshot = parseScriptMaterialGenerateTaskSnapshot(generationTask.inputSnapshot)
    expect(generationSnapshot.points.map((point) => point.id)).toEqual(workspace.points.map((point) => point.id))
    expect(buildScriptMaterialGeneratePrompt(generationSnapshot)).toContain('所有adoption=required的素材要点都必须被正文完整覆盖')
    expect(() => validateScriptMaterialGenerateOutput(generationSnapshot, {
      paragraphs: [{
        id: 'p-1', position: 0, text: '无来源具体体验', sourcePointIds: ['unknown'],
        transform: 'expanded', provenance: ['source'], webSources: []
      }]
    })).toThrow('PROVIDER_SCRIPT_MATERIAL_POINT_REF_INVALID')

    const generationOutput = validateScriptMaterialGenerateOutput(generationSnapshot, {
      paragraphs: [{
        id: 'p-1', position: 0, text: '后来我换成了触控板。', sourcePointIds: [workspace.points[1]!.id],
        transform: 'reordered', provenance: ['source'], webSources: []
      }, {
        id: 'p-2', position: 1, text: '在那之前，我先试过键盘。', sourcePointIds: [workspace.points[0]!.id],
        transform: 'reordered', provenance: ['source'], webSources: []
      }]
    })
    workspace = store.repository.saveScriptMaterialGenerationResult(generationTask.id, generationOutput, {
      model: 'test-model',
      reasoningEffort: 'high'
    })
    expect(workspace.drafts[0]).toMatchObject({
      side: 'codex',
      model: 'test-model',
      reasoningEffort: 'high',
      content: '后来我换成了触控板。\n\n在那之前，我先试过键盘。'
    })
    expect(workspace.drafts[0]?.paragraphs[0]?.sourcePointIds).toEqual([workspace.points[1]!.id])
  })

  it('audits every source point exactly once and records unsupported detail findings', async () => {
    const store = await createStore()
    store.repository.saveScriptMaterialWorkspace('ios', { workingContent: '第一点。\n第二点。' })
    let workspace = store.repository.createScriptMaterialRevision('ios')
    workspace = store.repository.replaceScriptMaterialPoints('ios', workspace.activeRevision!.id, [{
      sourceStart: 0, sourceEnd: 4, sourceText: '第一点。', summary: '第一点'
    }, {
      sourceStart: 5, sourceEnd: 9, sourceText: '第二点。', summary: '第二点'
    }])
    workspace = store.repository.confirmScriptMaterialPoints('ios', workspace.activeRevision!.id)
    const task = store.repository.startScriptMaterialAudit({
      projectId: 'ios',
      target: 'current',
      currentContent: '第一点。\n新增了原稿没有的具体数字。',
      providerSecurity
    })
    const snapshot = parseScriptMaterialAuditTaskSnapshot(task.inputSnapshot)
    expect(() => validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: workspace.points[0]!.id, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
      }],
      paragraphFindings: []
    })).toThrow()
    expect(() => validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: workspace.points[0]!.id, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
      }, {
        pointId: workspace.points[1]!.id, status: 'allowed_omission', paragraphIds: [], rationale: 'AI自行允许遗漏'
      }],
      paragraphFindings: []
    })).toThrow()
    expect(() => validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: workspace.points[0]!.id, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
      }, {
        pointId: workspace.points[1]!.id, status: 'missing', paragraphIds: [], rationale: '未出现'
      }],
      paragraphFindings: [{
        paragraphId: 'current-p-2', sourcePointIds: [], provenance: 'needs_confirmation', note: '同一条事实'
      }, {
        paragraphId: 'current-p-2', sourcePointIds: [], provenance: 'needs_confirmation', note: '同一条事实'
      }]
    })).toThrow('PROVIDER_SCRIPT_MATERIAL_FINDING_DUPLICATE')

    const output = validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: workspace.points[0]!.id, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
      }, {
        pointId: workspace.points[1]!.id, status: 'missing', paragraphIds: [], rationale: '未出现'
      }],
      paragraphFindings: [{
        paragraphId: 'current-p-2',
        sourcePointIds: [],
        provenance: 'needs_confirmation',
        note: '具体数字无法在原稿中找到依据'
      }]
    })
    workspace = store.repository.saveScriptMaterialAuditResult(task.id, output)
    expect(workspace.checks[0]).toMatchObject({
      target: 'current',
      state: 'ready',
      pointCoverage: expect.arrayContaining([expect.objectContaining({ status: 'missing' })]),
      paragraphFindings: [expect.objectContaining({ provenance: 'needs_confirmation' })]
    })
  })
})
