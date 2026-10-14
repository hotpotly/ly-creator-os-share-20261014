import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi }

test('R16c实际IPC只返回安全目录并在本地确定性判定引用用途', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const app = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_TEST_R16C_PREPARE: '1',
      CREATOR_OS_TEST_R16D_DISPATCH: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    const result = await window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      await api.saveProjectTextMaterial('sponsor', 'brief', 'R16c E2E Brief', '参数必须以Brief为准')
      const catalog = await api.listStructuredReferenceCatalog('sponsor', 'e2e-r16c-script-conversation')
      const item = catalog[0]
      if (!item) throw new Error('测试项目没有可引用资料')
      const referenceFor = (text: string) => {
        const token = `@${item.label}`
        const mentionFrom = text.indexOf(token)
        return {
          occurrenceId: `e2e-${item.sourceId}`,
          sourceKey: item.sourceKey,
          sourceKind: item.sourceKind,
          sourceId: item.sourceId,
          sourceLocator: { mentionFrom, mentionTo: mentionFrom + token.length },
          label: item.label,
          role: 'pending' as const,
          roleOrigin: 'pending' as const,
          runtimeRole: null,
          aspect: null,
          scope: 'whole_source' as const,
          ruleEvidence: null,
          ruleConflicts: [],
          manualConflictResolution: null
        }
      }
      const vagueText = `请看看@${item.label}。`
      const hardText = `必须按@${item.label}的参数来写。`
      const vague = await api.resolveStructuredReferenceRoles({ text: vagueText, references: [referenceFor(vagueText)] })
      const hard = await api.resolveStructuredReferenceRoles({ text: hardText, references: [referenceFor(hardText)] })
      let strictInputRejected = false
      try {
        await api.resolveStructuredReferenceRoles({ text: vagueText, references: [referenceFor(vagueText)], providerConfigId: 'forged' } as never)
      } catch { strictInputRejected = true }
      await api.saveScriptMaterialWorkspace('sponsor', { workingContent: 'R16c测试原稿。' })
      const materialWorkspace = await api.createScriptMaterialRevision('sponsor')
      if (!materialWorkspace.activeRevision) throw new Error('测试素材修订没有建立')
      const dispatched = await api.dispatchContentInstruction({
        operation: 'script_material_chat',
        instruction: {
        projectId: 'sponsor',
        sessionScope: 'e2e-r16c-script-conversation',
        surface: 'script_material_first_draft',
        target: null,
        materialRevisionId: materialWorkspace.activeRevision.id,
        displayText: hardText,
        editorDocument: { type: 'doc', content: [] },
        currentDocumentParagraphs: [],
        references: [hard[0]!.reference],
        constraints: [],
        includeProjectContext: false,
        webSearchMode: 'automatic',
        factRegion: '中国大陆',
        factAsOf: '2026-08-04T00:00:00.000Z',
        aiCount: 1,
        targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto' }]
        },
        request: {
          projectId: 'sponsor', message: hardText, includeProjectContext: false, currentDocumentParagraphs: [],
          requests: [{ side: 'codex', providerConfigId: 'codex_cli_text_v1', preferredModel: null }]
        }
      })
      const prepared = dispatched.request
      const reloaded = await api.getContentInstructionRequest(prepared.request.id)
      return { catalog, vague, hard, strictInputRejected, prepared, reloaded }
    })
    expect(result.catalog.length).toBeGreaterThan(0)
    expect(result.catalog.length).toBeLessThanOrEqual(2_000)
    expect(JSON.stringify(result.catalog)).not.toMatch(/(?:absolutePath|frozenTextContent|sourceBookmark|encryptedSourcePath|token)/u)
    expect(result.vague[0]?.reference.role).toBe('pending')
    expect(result.hard[0]?.reference.role).toBe('hard_constraint')
    expect(result.hard[0]?.reference.ruleEvidence).not.toBeNull()
    expect(result.strictInputRejected).toBe(true)
    expect(result.prepared.request.id).toBe(result.reloaded.request.id)
    expect(result.prepared.request.sessionScope).toBe('e2e-r16c-script-conversation')
    expect(result.prepared.request.resourceSnapshot).toBeNull()
    expect(result.prepared.targets[0]?.actualModel).toBe('gpt-5.6')
    expect(result.prepared.targets[0]?.providerPolicyVersion).toBeTruthy()
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})
