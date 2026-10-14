import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page
let userDataPath: string

const currentText = '第一点。\n\n个人实测续航10小时。'
const normalizeHash = (value: string): string => createHash('sha256').update(value.replace(/\s+/g, ' ').trim()).digest('hex')

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).projects.length)).toBeGreaterThan(2)

  await mainWindow.evaluate(async (content) => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.saveScriptMaterialWorkspace('ai-browser', { workingContent: '第一点。\n第二点。' })
    let workspace = await api.createScriptMaterialRevision('ai-browser')
    workspace = await api.replaceScriptMaterialPoints('ai-browser', workspace.activeRevision!.id, [{
      sourceStart: 0, sourceEnd: 4, sourceText: '第一点。', summary: '第一点'
    }, {
      sourceStart: 5, sourceEnd: 9, sourceText: '第二点。', summary: '第二点'
    }])
    await api.confirmScriptMaterialPoints('ai-browser', workspace.activeRevision!.id)
    await api.saveScript(
      'ai-browser',
      'merged_draft',
      `<p>第一点。</p><p><span data-script-marker-id="r42e-marker" data-script-marker-note="核实续航测试环境"><u>个人实测续航10小时。</u></span></p>`,
      undefined,
      'R42e检查稿'
    )
    void content
  }, currentText)

  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  database.exec('PRAGMA busy_timeout = 5000')
  const revision = database.prepare(`SELECT id FROM script_material_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1`).get('ai-browser') as { id: string }
  const points = database.prepare(`SELECT stable_id AS id FROM script_material_points WHERE revision_id=? ORDER BY position`).all(revision.id) as Array<{ id: string }>
  const createdAt = new Date().toISOString()
  database.prepare(`INSERT INTO script_material_checks(
    id,project_id,revision_id,target,target_identity,target_content_hash,input_fingerprint,state,
    point_coverage_json,paragraph_findings_json,allowed_omission_point_ids_json,task_id,error_message,checked_at,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'r42e-current-check',
    'ai-browser',
    revision.id,
    'current',
    'current',
    normalizeHash(currentText),
    createHash('sha256').update('r42e-input-fingerprint').digest('hex'),
    'ready',
    JSON.stringify([{
      pointId: points[0]!.id,
      status: 'complete',
      paragraphIds: ['current-0'],
      rationale: '第一点已完整覆盖'
    }, {
      pointId: points[1]!.id,
      status: 'missing',
      paragraphIds: [],
      rationale: '第二点没有出现在当前文案'
    }]),
    JSON.stringify([{
      id: 'r42e-finding-runtime',
      paragraphId: 'current-6',
      sourcePointIds: [],
      provenance: 'needs_confirmation',
      note: '续航10小时属于原稿没有支持的个人实测数据',
      status: 'active',
      resolutionNote: '',
      confirmedAt: null
    }, {
      id: 'r42e-finding-environment',
      paragraphId: 'current-6',
      sourcePointIds: [],
      provenance: 'needs_confirmation',
      note: '续航测试环境也需要本人逐条确认',
      status: 'active',
      resolutionNote: '',
      confirmedAt: null
    }]),
    '[]',
    null,
    null,
    createdAt,
    createdAt,
    createdAt
  )
  database.close()

  await mainWindow.evaluate(() => {
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser?mode=materials'
  })
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('heading', { name: '当前文案' })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
})

test('R42e显式检查、逐条处理、定稿门和历史恢复形成闭环', async () => {
  test.setTimeout(90_000)
  const currentEditor = mainWindow.locator('.current-script-pane .tiptap')
  const currentAudit = mainWindow.getByRole('button', { name: /当前文案素材覆盖检查/ })
  await expect(currentAudit).toContainText('已检查')
  await expect(currentEditor.locator('span[data-script-marker-id="r42e-marker"]')).toHaveAttribute('data-script-marker-note', '核实续航测试环境')
  await expect(currentEditor.locator('u')).toContainText('个人实测续航10小时')
  const initial = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = await api.getProject('ai-browser')
    const workspace = await api.getWorkspace()
    return {
      taskCount: workspace.tasks.length,
      versionCount: project.versions.filter((version) => version.documentType === 'script').length
    }
  })

  await mainWindow.waitForTimeout(800)
  await currentEditor.click()
  await mainWindow.keyboard.press('End')
  await mainWindow.keyboard.insertText('改')
  await expect(currentAudit).toContainText('检查已过期')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).tasks.length)).toBe(initial.taskCount)
  await mainWindow.getByRole('button', { name: '定稿' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('变化')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')
    return {
      finalCount: project.versions.filter((version) => version.documentType === 'script' && version.isFinal).length,
      versionCount: project.versions.filter((version) => version.documentType === 'script').length
    }
  })).toEqual({ finalCount: 0, versionCount: initial.versionCount })

  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+z')
  await expect(currentAudit).toContainText('已检查')
  await currentAudit.click()
  const auditDialog = mainWindow.getByRole('dialog', { name: '当前文案素材覆盖检查' })
  await expect(auditDialog).toContainText('第二点没有出现在当前文案')
  await expect(auditDialog).toContainText('续航10小时')
  await auditDialog.getByRole('button', { name: '本次允许遗漏' }).click()
  await expect(auditDialog.getByRole('button', { name: '取消允许' })).toBeVisible()
  const runtimeFinding = auditDialog.locator('.script-material-audit-list > article').filter({ hasText: '续航10小时属于原稿没有支持的个人实测数据' })
  await runtimeFinding.getByRole('button', { name: '确认依据' }).click()
  await runtimeFinding.getByPlaceholder('写明依据，例如：来自我的实测记录第3条').fill('来自我在2026年7月的续航实测记录')
  await runtimeFinding.getByRole('button', { name: '确认', exact: true }).click()
  await expect(auditDialog).toContainText('依据：来自我在2026年7月的续航实测记录')
  const environmentFinding = auditDialog.locator('.script-material-audit-list > article').filter({ hasText: '续航测试环境也需要本人逐条确认' })
  await environmentFinding.getByRole('button', { name: '确认依据' }).click()
  await environmentFinding.getByPlaceholder('写明依据，例如：来自我的实测记录第3条').fill('来自室温25℃、自动亮度的本人测试记录')
  await environmentFinding.getByRole('button', { name: '确认', exact: true }).click()
  await expect(auditDialog).toContainText('依据：来自室温25℃、自动亮度的本人测试记录')
  await auditDialog.getByRole('button', { name: '本次全部允许遗漏并定稿' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('已定稿')

  const finalSnapshot = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = await api.getProject('ai-browser')
    const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)!
    const snapshot = await api.getScriptMaterialVersionSnapshot('ai-browser', finalVersion.id)
    return {
      versionId: finalVersion.id,
      allowed: snapshot?.finalization?.allowedOmissionPointIds.length ?? 0,
      confirmed: snapshot?.finalization?.confirmedFindingIds.length ?? 0,
      snapshotHash: snapshot?.snapshotHash ?? '',
      sourceContent: finalVersion.content,
      sourceWorkspaceContent: finalVersion.workspaceContent ?? null,
      versionCount: project.versions.filter((version) => version.documentType === 'script').length
    }
  })
  expect(finalSnapshot.allowed).toBe(1)
  expect(finalSnapshot.confirmed).toBe(2)
  expect(finalSnapshot.snapshotHash).toHaveLength(64)
  expect(finalSnapshot.sourceContent).not.toContain('data-script-marker-id')
  expect(finalSnapshot.sourceContent).toContain('<u>个人实测续航10小时。</u>')
  expect(finalSnapshot.sourceWorkspaceContent).toContain('data-script-marker-id="r42e-marker"')
  expect(finalSnapshot.sourceWorkspaceContent).toContain('<u><span data-script-marker-id="r42e-marker"')
  expect(finalSnapshot.sourceWorkspaceContent).toContain('个人实测续航10小时。')

  await mainWindow.evaluate(({ versionId }) => {
    ;(globalThis as unknown as BrowserGlobals).location.hash = `#/workbench/ai-browser?mode=materials&draft=${versionId}`
  }, finalSnapshot)
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('button', { name: '恢复为当前版本' })).toBeVisible()
  await expect(currentEditor).toHaveAttribute('contenteditable', 'false')
  const frozenEditorHtml = await currentEditor.innerHTML()
  await currentEditor.click()
  await mainWindow.keyboard.insertText('历史误改')
  await expect.poll(() => currentEditor.innerHTML()).toBe(frozenEditorHtml)
  await expect(mainWindow.getByRole('button', { name: '编辑原稿' })).toHaveCount(0)
  await expect(mainWindow.getByLabel('整理前的原始文案编辑区')).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '重新匹配' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '追加到当前文案' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '替换当前文案' })).toHaveCount(0)
  await expect(mainWindow.getByRole('tab', { name: '对话模式' })).toBeDisabled()
  await expect(mainWindow.getByRole('tab', { name: '版本对比' })).toBeDisabled()
  await expect(mainWindow.getByRole('tab', { name: '成稿对比' })).toBeDisabled()
  await expect(mainWindow.getByLabel('Codex成稿模型')).toBeDisabled()
  await expect(mainWindow.locator('.script-material-toolbar').getByRole('button', { name: '项目上下文' })).toBeDisabled()
  await expect(mainWindow.locator('.script-material-ai-count').getByRole('button').first()).toBeDisabled()
  await expect(mainWindow.locator('.script-material-ai-count').getByRole('button').last()).toBeDisabled()
  const liveStateBeforeHistoricalBrowse = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getScriptMaterialWorkspace('ai-browser')
    const root = await api.getWorkspace()
    return {
      taskCount: root.tasks.length,
      workingContent: workspace.workingContent,
      aiCount: workspace.aiCount,
      selectedAiSide: workspace.selectedAiSide,
      selectedCodexDraftId: workspace.selectedCodexDraftId,
      selectedClaudeDraftId: workspace.selectedClaudeDraftId,
      webSearchMode: workspace.webSearchMode
    }
  })
  await currentEditor.click({ button: 'right' })
  await expect(mainWindow.locator('.script-editor-context-menu')).toHaveCount(0)
  await mainWindow.locator('.script-material-toolbar').getByRole('button', { name: '项目上下文' }).click({ force: true })
  await mainWindow.locator('.script-material-ai-count').getByRole('button').last().click({ force: true })
  await mainWindow.getByRole('tab', { name: '对话模式' }).click({ force: true })
  await mainWindow.getByRole('tab', { name: '成稿对比' }).click({ force: true })
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getScriptMaterialWorkspace('ai-browser')
    const root = await api.getWorkspace()
    return {
      taskCount: root.tasks.length,
      workingContent: workspace.workingContent,
      aiCount: workspace.aiCount,
      selectedAiSide: workspace.selectedAiSide,
      selectedCodexDraftId: workspace.selectedCodexDraftId,
      selectedClaudeDraftId: workspace.selectedClaudeDraftId,
      webSearchMode: workspace.webSearchMode
    }
  })).toEqual(liveStateBeforeHistoricalBrowse)
  await currentAudit.click()
  const frozenAuditDialog = mainWindow.getByRole('dialog', { name: '当前文案素材覆盖检查' })
  await expect(frozenAuditDialog).toContainText('历史版本冻结记录')
  await expect(frozenAuditDialog).toContainText('当时已允许')
  await expect(frozenAuditDialog.getByRole('button', { name: '更新检查' })).toHaveCount(0)
  await frozenAuditDialog.getByRole('button', { name: '关闭素材检查' }).click()
  await mainWindow.evaluate(() => {
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser?mode=materials'
  })
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')

  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  const leftEditor = mainWindow.locator('.version-working-editor-left')
  await expect(leftEditor).toContainText('个人实测续航10小时')
  await leftEditor.getByRole('button', { name: '恢复到工作台' }).click()
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => mainWindow.evaluate(() => (
    globalThis as unknown as BrowserGlobals
  ).location.hash)).toContain('mode=materials')
  await expect(currentEditor).toContainText('个人实测续航10小时')
  await expect(currentEditor.locator('span[data-script-marker-id="r42e-marker"]')).toHaveAttribute('data-script-marker-note', '核实续航测试环境')
  await expect(currentEditor.locator('u')).toContainText('个人实测续航10小时')
  await expect(currentAudit).toContainText('已检查')
  const restoredVersionState = await mainWindow.evaluate(async ({ versionId, sourceContent, sourceWorkspaceContent }) => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')
    const scripts = project.versions.filter((version) => version.documentType === 'script')
    const source = scripts.find((version) => version.id === versionId)!
    const restored = scripts.slice().sort((left, right) => right.revision - left.revision)[0]!
    return {
      versionCount: scripts.length,
      sourceUnchanged: source.content === sourceContent && source.workspaceContent === sourceWorkspaceContent,
      restoredId: restored.id
    }
  }, finalSnapshot)
  expect(restoredVersionState.versionCount).toBe(finalSnapshot.versionCount + 1)
  expect(restoredVersionState.sourceUnchanged).toBe(true)
  expect(restoredVersionState.restoredId).not.toBe(finalSnapshot.versionId)
  await currentEditor.click()
  await mainWindow.keyboard.press('End')
  await mainWindow.keyboard.insertText('新')
  await expect(currentAudit).toContainText('检查已过期')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).tasks.length)).toBe(initial.taskCount)
})

test('R42e素材工作台可直接取消、按冻结输入重试并再次取消检查', async () => {
  test.setTimeout(45_000)
  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  database.exec('PRAGMA busy_timeout = 5000')
  const revision = database.prepare(`SELECT id FROM script_material_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1`).get('ai-browser') as { id: string }
  const points = database.prepare(`SELECT
    stable_id AS id,position,source_start AS sourceStart,source_end AS sourceEnd,source_text AS sourceText,
    summary,requirement,adoption
    FROM script_material_points WHERE revision_id=? ORDER BY position`).all(revision.id) as Array<{
      id: string
      position: number
      sourceStart: number
      sourceEnd: number
      sourceText: string
      summary: string
      requirement: string
      adoption: 'required' | 'excluded'
    }>
  const check = database.prepare(`SELECT input_fingerprint AS inputFingerprint,target_content_hash AS targetContentHash
    FROM script_material_checks WHERE project_id=? AND target_identity='current'`).get('ai-browser') as {
      inputFingerprint: string
      targetContentHash: string
    }
  const taskId = 'r42e-workbench-cancel-task'
  const timestamp = new Date().toISOString()
  const inputSnapshot = JSON.stringify({
    version: 2,
    projectId: 'ai-browser',
    revisionId: revision.id,
    target: 'current',
    targetIdentity: 'current',
    targetContentHash: check.targetContentHash,
    inputFingerprint: check.inputFingerprint,
    points,
    paragraphs: [{
      id: 'current-0',
      position: 0,
      text: '第一点。',
      sourcePointIds: []
    }, {
      id: 'current-6',
      position: 1,
      text: '个人实测续航10小时。',
      sourcePointIds: []
    }],
    providerSecurity: {
      provider: 'codex_cli',
      providerConfigId: 'codex_cli_text_v1',
      displayName: 'Codex CLI',
      cliVersion: 'e2e',
      fingerprint: 'r42e-workbench-cancel',
      policyVersion: 'e2e'
    },
    inputBudget: {
      estimatedCharacters: 100,
      maximumCharacters: 480000
    }
  })
  database.prepare(`INSERT INTO task_runs(
    id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,
    output_target,requires_confirmation,requested_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    taskId,
    'script_material_audit',
    'ai-browser',
    'R42e工作台取消检查',
    'none',
    'queued',
    0,
    inputSnapshot,
    JSON.stringify({ network: 'off', readableRefs: [], writableTarget: 'none', shell: false }),
    `script-material-check:ai-browser:${revision.id}:current`,
    0,
    timestamp
  )
  database.prepare(`UPDATE script_material_checks SET state='checking',task_id=?,error_message=NULL,updated_at=?
    WHERE project_id=? AND target_identity='current'`).run(taskId, timestamp, 'ai-browser')
  database.close()

  await mainWindow.evaluate(() => {
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser'
  })
  await mainWindow.evaluate(() => {
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser?mode=materials'
  })
  const currentAudit = mainWindow.getByRole('button', { name: /当前文案素材覆盖检查/ })
  await expect(currentAudit).toContainText('检查中')
  await currentAudit.click()
  const auditDialog = mainWindow.getByRole('dialog', { name: '当前文案素材覆盖检查' })
  await auditDialog.getByRole('button', { name: '取消检查' }).click()
  await expect(currentAudit).toContainText('检查失败')
  await auditDialog.getByRole('button', { name: '按原输入重试' }).click()
  await expect(currentAudit).toContainText('检查中')
  await auditDialog.getByRole('button', { name: '取消检查' }).click()
  await expect(currentAudit).toContainText('检查失败')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getScriptMaterialWorkspace('ai-browser')
    const current = workspace.checks.find((item) => item.targetIdentity === 'current')
    return { state: current?.state, errorMessage: current?.errorMessage }
  })).toEqual({ state: 'failed', errorMessage: '检查任务已取消' })
})
