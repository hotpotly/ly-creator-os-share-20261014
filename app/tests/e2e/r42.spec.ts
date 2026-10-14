import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
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

async function expectMaterialRelationCount(scope: Locator, expected: number): Promise<void> {
  await expect.poll(() => scope.locator('[data-script-material-relation-id]').evaluateAll((nodes) => (
    new Set(nodes.map((node) => node.getAttribute('data-script-material-relation-id')).filter(Boolean)).size
  ))).toBe(expected)
}

async function expectJoinedText(locator: Locator, expected: string): Promise<void> {
  await expect.poll(async () => (await locator.allTextContents()).join('')).toContain(expected)
}

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

  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.saveScriptMaterialWorkspace('ai-browser', {
      workingContent: '先试键盘。\n后来换成触控板。',
      requirement: '保留真实体验并调整顺序。'
    })
    let workspace = await api.createScriptMaterialRevision('ai-browser')
    workspace = await api.replaceScriptMaterialPoints('ai-browser', workspace.activeRevision!.id, [{
      sourceStart: 0, sourceEnd: 5, sourceText: '先试键盘。', summary: '先试键盘'
    }, {
      sourceStart: 6, sourceEnd: 14, sourceText: '后来换成触控板。', summary: '后来换触控板'
    }])
    await api.confirmScriptMaterialPoints('ai-browser', workspace.activeRevision!.id)
    await api.saveScript('ai-browser', 'merged_draft', '# 闲鱼加价在闲鱼买16T小米智能存储，是大冤种还是真香？\n\n这是标题后的第一段，标题换行时不能和正文互相遮挡。\n\n- 第一项\n- 第二项', undefined, 'Markdown易读稿')
  })
  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  database.exec('PRAGMA busy_timeout = 5000')
  const revision = database.prepare(`SELECT id FROM script_material_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1`).get('ai-browser') as { id: string }
  const sourcePoints = database.prepare(`SELECT stable_id AS id FROM script_material_points WHERE revision_id = ? ORDER BY position`).all(revision.id) as Array<{ id: string }>
  const content = '先给结论：生态联动最省心。\n\n官方支持4TB版本。\n\n这段没有可靠来源。'
  const createdAt = new Date().toISOString()
  database.prepare(`INSERT INTO script_material_drafts (
    id, project_id, revision_id, side, source_kind, provider_config_id, provider_kind, model,
    reasoning_effort, provider_fingerprint, requirement, input_fingerprint, content, content_hash,
    paragraphs_json, task_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    'r42-annotated-draft',
    'ai-browser',
    revision.id,
    'codex',
    'provider',
    'builtin-codex-cli',
    'codex_cli',
    'gpt-5.6-sol',
    'ultra',
    'r42-e2e',
    '主动重构并补全XXX',
    'r42-e2e-input',
    content,
    createHash('sha256').update(content).digest('hex'),
    JSON.stringify([{
      id: 'material-codex-p-1',
      position: 0,
      text: '先给结论：生态联动最省心。',
      sourcePointIds: [sourcePoints[1]!.id],
      transform: 'expanded',
      provenance: ['needs_confirmation'],
      webSources: [],
      annotations: [{
        id: 'annotation-inference',
        start: 5,
        end: 9,
        text: '生态联动',
        provenance: 'needs_confirmation',
        note: '根据上下文推断的个人偏好',
        webSources: [],
        status: 'active'
      }]
    }, {
      id: 'material-codex-p-2',
      position: 1,
      text: '官方支持4TB版本。',
      sourcePointIds: [sourcePoints[0]!.id],
      transform: 'expanded',
      provenance: ['web_supplement'],
      webSources: [{ title: '官方产品页', url: 'https://example.com/product' }],
      annotations: [{
        id: 'annotation-web',
        start: 4,
        end: 7,
        text: '4TB',
        provenance: 'web_supplement',
        note: '本轮联网核实',
        webSources: [{ title: '官方产品页', url: 'https://example.com/product' }],
        status: 'active'
      }]
    }, {
      id: 'material-codex-p-3',
      position: 2,
      text: '这段没有可靠来源。',
      sourcePointIds: [],
      transform: 'expanded',
      provenance: ['needs_confirmation'],
      webSources: [],
      annotations: []
    }]),
    createdAt,
    createdAt
  )
  database.prepare(`INSERT INTO script_material_rewrite_candidates (
    id,project_id,revision_id,draft_id,side,paragraph_ids_json,selected_text,selected_start,selected_end,
    requirement,content,source_point_ids_json,annotations_json,provider_config_id,provider_kind,model,
    reasoning_effort,task_id,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(
    'r42-local-candidate',
    'ai-browser',
    revision.id,
    'r42-annotated-draft',
    'codex',
    JSON.stringify(['material-codex-p-1']),
    '',
    null,
    null,
    '更口语化',
    '先说结论，我觉得生态联动才是它最省心的地方。',
    JSON.stringify([sourcePoints[1]!.id]),
    '[]',
    'builtin-codex-cli',
    'codex_cli',
    'gpt-5.6-sol',
    'max',
    createdAt
  )
  const secondContent = '第二版开头更直接。'
  database.prepare(`INSERT INTO script_material_drafts (
    id, project_id, revision_id, side, source_kind, provider_config_id, provider_kind, model,
    reasoning_effort, provider_fingerprint, requirement, input_fingerprint, content, content_hash,
    draft_version, paragraphs_json, task_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    'r42-second-draft',
    'ai-browser',
    revision.id,
    'codex',
    'provider',
    'builtin-codex-cli',
    'codex_cli',
    'gpt-5.6-sol',
    'ultra',
    'r42-e2e',
    '再次生成',
    'r42-e2e-input-2',
    secondContent,
    createHash('sha256').update(secondContent).digest('hex'),
    2,
    JSON.stringify([{
      id: 'material-codex-v2-p-1',
      position: 0,
      text: secondContent,
      sourcePointIds: [sourcePoints[0]!.id],
      transform: 'polished',
      provenance: ['source'],
      webSources: [],
      annotations: [],
      manualMarks: []
    }]),
    createdAt,
    createdAt
  )
  database.close()
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.saveScriptMaterialWorkspace('ai-browser', { selectedAiSide: 'codex', selectedCodexDraftId: 'r42-annotated-draft' })
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
  })
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
})

test('R42素材成稿先提供AI稿对话，再保留三栏追溯和纯净文案标注工具', async ({ browserName }, testInfo) => {
  test.setTimeout(90_000)
  expect(browserName).toBe('chromium')
  const viewTabs = mainWindow.getByRole('tablist', { name: '文案工作台视图' })
  await expect(viewTabs.getByRole('tab')).toHaveText(['对话模式', '对照筛选', '版本对比'])
  await viewTabs.getByRole('tab', { name: '对照筛选' }).click()
  const kindTabs = mainWindow.getByRole('tablist', { name: '对照类型' })
  await expect(kindTabs.getByRole('tab')).toHaveText(['成稿对比', '素材成稿'])
  await kindTabs.getByRole('tab', { name: '素材成稿' }).click()

  await expect(mainWindow.getByRole('heading', { name: '整理前的原始文案' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: 'AI稿' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '当前文案' })).toBeVisible()
  const currentHeading = mainWindow.locator('.current-script-pane .tiptap h1')
  await expect(currentHeading).toContainText('闲鱼加价')
  await expect(mainWindow.locator('.current-script-pane .tiptap')).not.toContainText('# 闲鱼加价')
  const headingGeometry = await currentHeading.evaluate((heading) => {
    const style = heading.ownerDocument.defaultView!.getComputedStyle(heading)
    const next = heading.nextElementSibling?.getBoundingClientRect()
    const rect = heading.getBoundingClientRect()
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      overlap: next ? rect.bottom - next.top : 0
    }
  })
  expect(headingGeometry.fontSize).toBeLessThanOrEqual(22)
  expect(headingGeometry.lineHeight).toBeGreaterThanOrEqual(30)
  expect(headingGeometry.overlap).toBeLessThanOrEqual(0)
  await expect(mainWindow.locator('.workbench-topbar').getByRole('tablist', { name: '对照类型' })).toBeVisible()
  await expect(mainWindow.locator('.workbench-context-row')).toHaveCount(0)
  await mainWindow.getByRole('button', { name: /编辑原稿/ }).click()
  const sourceEditor = mainWindow.getByLabel('整理前的原始文案编辑区')
  await expect(sourceEditor).toHaveValue('先试键盘。\n后来换成触控板。')
  const sourceEditorGeometry = await sourceEditor.evaluate((editor) => {
    const editorRect = editor.getBoundingClientRect()
    const bodyRect = editor.parentElement!.getBoundingClientRect()
    return { editorHeight: editorRect.height, bodyHeight: bodyRect.height }
  })
  expect(sourceEditorGeometry.editorHeight).toBeGreaterThanOrEqual(sourceEditorGeometry.bodyHeight - 2)
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-source-editor.png') })
  await mainWindow.getByRole('button', { name: /查看对应/ }).click()
  await expect(mainWindow.locator('.script-material-point')).toHaveCount(2)
  await expect(mainWindow.locator('.script-material-point').nth(0)).toContainText('先试键盘')
  await expect(mainWindow.locator('.script-material-point').nth(1)).toContainText('后来换成触控板')
  await expect(mainWindow.getByLabel('AI稿对话要求')).toHaveAttribute('placeholder', /继续像和Codex一样讨论/)
  await expect(mainWindow.getByRole('button', { name: '发送' })).toBeVisible()
  await expect(mainWindow.getByTitle('本稿实际使用的模型与推理档位')).toHaveText('gpt-5.6-sol·ultra')
  await expect(mainWindow.getByLabel('AI稿版本切换')).toContainText('第1／2稿')
  await mainWindow.getByRole('button', { name: '下一篇AI稿' }).click()
  await expect(mainWindow.locator('.script-material-paragraph-content')).toHaveText('第二版开头更直接。')
  await mainWindow.getByRole('button', { name: '上一篇AI稿' }).click()
  await expect(mainWindow.locator('.script-material-paragraph-content').first()).toContainText('生态联动')
  await expect(mainWindow.getByLabel('Codex成稿模型')).toBeVisible()
  await expect(mainWindow.getByLabel('Codex成稿模型').locator('option').first()).toContainText('自动选择')
  await mainWindow.getByLabel('Codex成稿模型').click()
  const modelOptions = mainWindow.getByRole('menu', { name: 'Codex成稿模型选项' })
  await expect(modelOptions).toBeVisible()
  await expect(modelOptions).toHaveClass(/app-select-popover/)
  const modelMenuItems = modelOptions.getByRole('menuitemradio')
  await expect(modelMenuItems.first()).toContainText('自动选择')
  expect(await modelMenuItems.count()).toBeGreaterThan(0)
  await expect(modelMenuItems.first()).not.toHaveText('')
  const modelMenuBox = (await modelOptions.boundingBox())!
  expect(modelMenuBox.width).toBeLessThanOrEqual(320)
  expect(modelMenuBox.height).toBeLessThanOrEqual(230)
  expect(modelMenuBox.height).toBeGreaterThan(30)
  await modelMenuItems.first().click()
  await expect(modelOptions).toHaveCount(0)
  const webControlBox = await mainWindow.locator('.script-material-toolbar > label').filter({ hasText: '联网' }).boundingBox()
  const modelControlBox = await mainWindow.locator('.script-material-toolbar > label').filter({ hasText: '模型' }).boundingBox()
  expect(modelControlBox!.x).toBeGreaterThan(webControlBox!.x)
  const directActionTaskCount = await mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).tasks.length)
  const currentEditor = mainWindow.locator('.current-script-pane .tiptap')
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await mainWindow.keyboard.press('Backspace')
  const emptyCurrentState = mainWindow.locator('.current-script-empty-state')
  await expect(emptyCurrentState).toContainText('当前文案还是空的')
  await expect(emptyCurrentState).toContainText('AI稿不会自动写入')
  await expect(mainWindow.getByRole('button', { name: '以此稿建立当前文案' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '追加到当前文案' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '替换当前文案' })).toHaveCount(0)
  await expect(currentEditor).not.toContainText('先给结论')
  await currentEditor.click()
  await mainWindow.keyboard.insertText('我先自己写')
  await expect(emptyCurrentState).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '替换当前文案' })).toBeVisible()
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await mainWindow.keyboard.press('Backspace')
  await expect(emptyCurrentState).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-empty-current.png') })
  await mainWindow.getByRole('button', { name: '下一篇AI稿' }).click()
  await expect(emptyCurrentState).toBeVisible()
  await expect(currentEditor).not.toContainText('第二版开头更直接')
  await mainWindow.getByRole('button', { name: '上一篇AI稿' }).click()
  await kindTabs.getByRole('tab', { name: '成稿对比' }).click()
  await kindTabs.getByRole('tab', { name: '素材成稿' }).click()
  await expect(emptyCurrentState).toBeVisible()
  await mainWindow.setViewportSize({ width: 900, height: 760 })
  const emptyStateTabs = mainWindow.getByRole('tablist', { name: '素材成稿窄窗栏目' })
  await emptyStateTabs.getByRole('tab', { name: '当前文案' }).click()
  await expect(emptyCurrentState).toBeVisible()
  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()
  await expect(emptyCurrentState).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await emptyStateTabs.getByRole('tab', { name: 'AI稿' }).click()
  await mainWindow.setViewportSize({ width: 1440, height: 900 })
  await expect(currentEditor).toHaveText('')
  await mainWindow.getByRole('button', { name: '以此稿建立当前文案' }).click()
  await expect(emptyCurrentState).toHaveCount(0)
  await expect(currentEditor).toContainText('先给结论')
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 3)
  await expect(mainWindow.getByRole('button', { name: '替换当前文案' })).toBeVisible()
  await expect(mainWindow.getByRole('status')).toContainText('建立当前文案')
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+z')
  await expect(emptyCurrentState).toBeVisible()
  await expect(currentEditor).toHaveText('')
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 0)
  await mainWindow.keyboard.press('Meta+Shift+z')
  await expect(currentEditor).toContainText('先给结论')
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 3)
  await mainWindow.getByRole('button', { name: '保存当前文案' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')
    const version = project.latestVersions.find((item) => item.documentType === 'script' && item.kind === 'merged_draft')
    return {
      deliveryRelationCount: (version?.content.match(/data-script-material-relation-id/g) ?? []).length,
      workspaceRelationCount: new Set(Array.from(
        version?.workspaceContent?.matchAll(/data-script-material-relation-id="([^"]+)"/g) ?? [],
        (match) => match[1]
      )).size
    }
  })).toEqual({ deliveryRelationCount: 0, workspaceRelationCount: 3 })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  await expect(currentEditor).toContainText('先给结论')
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 3)
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await mainWindow.keyboard.press('Backspace')
  await expect(emptyCurrentState).toBeVisible()
  const firstSourcePoint = mainWindow.locator('.script-material-point').first()
  await expect(firstSourcePoint.getByRole('button', { name: '复制' })).toHaveCount(0)
  await expect.poll(() => firstSourcePoint.locator('.script-material-selectable-content').evaluate((content) => (
    content.ownerDocument.defaultView!.getComputedStyle(content).userSelect
  ))).toBe('text')
  const firstAiParagraph = mainWindow.locator('.script-material-paragraph').first()
  const secondAiParagraph = mainWindow.locator('.script-material-paragraph').nth(1)
  const thirdAiParagraph = mainWindow.locator('.script-material-paragraph').nth(2)
  await expect(firstAiParagraph.getByRole('button', { name: '复制' })).toHaveCount(0)
  await firstAiParagraph.locator('.script-material-paragraph-content').click()
  await expect(mainWindow.locator('.script-material-point').nth(1)).toHaveClass(/active/)
  const establishOneParagraph = mainWindow.getByRole('button', { name: '以所选1段建立当前文案' })
  await expect(establishOneParagraph).toBeVisible()
  await establishOneParagraph.click()
  await expect(currentEditor).toContainText('先给结论')
  await expect(currentEditor).not.toContainText('官方支持4TB')
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 1)
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+z')
  await expect(emptyCurrentState).toBeVisible()
  await firstAiParagraph.locator('.script-material-paragraph-content').click({ modifiers: ['Meta'] })
  await thirdAiParagraph.locator('.script-material-paragraph-content').click()
  await firstAiParagraph.locator('.script-material-paragraph-content').click({ modifiers: ['Meta'] })
  const establishTwoParagraphs = mainWindow.getByRole('button', { name: '以所选2段建立当前文案' })
  await expect(establishTwoParagraphs).toBeVisible()
  await establishTwoParagraphs.click()
  await expect(currentEditor).toContainText('先给结论')
  await expect(currentEditor).not.toContainText('官方支持4TB')
  await expect(currentEditor).toContainText('这段没有可靠来源')
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 2)
  await expect.poll(() => currentEditor.evaluate((editor) => {
    const text = editor.textContent ?? ''
    return text.indexOf('先给结论') < text.indexOf('这段没有可靠来源')
  })).toBe(true)
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+z')
  await expect(emptyCurrentState).toBeVisible()
  await firstAiParagraph.locator('.script-material-paragraph-content').click({ button: 'right' })
  const establishSelectedFromMenu = mainWindow.getByRole('menuitem', { name: /以所选内容建立当前文案/ })
  await expect(establishSelectedFromMenu).toBeVisible()
  await establishSelectedFromMenu.click()
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 2)
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+z')
  await expect(emptyCurrentState).toBeVisible()
  await mainWindow.locator('.script-material-selection-status').getByRole('button', { name: '清除' }).click()
  await firstAiParagraph.locator('.script-material-paragraph-content').click({ button: 'right' })
  const establishOneFromMenu = mainWindow.getByRole('menuitem', { name: /以所选内容建立当前文案/ })
  await expect(establishOneFromMenu).toBeVisible()
  await establishOneFromMenu.click()
  await expectMaterialRelationCount(mainWindow.locator('.current-script-pane'), 1)
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+z')
  await expect(emptyCurrentState).toBeVisible()
  await firstAiParagraph.locator('.script-material-paragraph-content').click()
  await firstAiParagraph.getByRole('button', { name: '拖动所选1段到当前文案' }).dragTo(mainWindow.locator('.current-script-pane .tiptap p').first())
  await expect(mainWindow.locator('.current-script-pane [data-script-material-draft-paragraph-ids="material-codex-p-1"]').first()).toContainText('先给结论')
  const appendSelected = mainWindow.getByRole('button', { name: '追加所选1段到当前文案' })
  await expect(appendSelected).toHaveText('追加1段')
  await appendSelected.click()
  await expect(mainWindow.locator('.current-script-pane .tiptap')).toContainText('先给结论：生态联动最省心。')
  await expect(mainWindow.locator('.current-script-pane .tiptap')).not.toContainText('官方支持4TB版本。')
  await expect(mainWindow.locator('.current-script-pane [data-script-material-draft-paragraph-ids="material-codex-p-1"]').first()).toContainText('先给结论')
  await secondAiParagraph.locator('.script-material-paragraph-content').click({ modifiers: ['Meta'] })
  await expect(mainWindow.locator('.script-material-paragraph.is-selected')).toHaveCount(2)
  await expect(mainWindow.getByRole('button', { name: '追加所选2段到当前文案' })).toHaveText('追加2段')
  await expect(mainWindow.locator('.script-material-selection-status')).toContainText('已选2段·右键修改')
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-multi-selection.png') })
  await secondAiParagraph.locator('.script-material-paragraph-content').click({ modifiers: ['Meta'] })
  await expect(mainWindow.locator('.script-material-paragraph.is-selected')).toHaveCount(1)
  await firstAiParagraph.locator('.script-material-paragraph-content').click()
  await secondAiParagraph.locator('.script-material-paragraph-content').click({ modifiers: ['Shift'] })
  await expect(mainWindow.locator('.script-material-paragraph.is-selected')).toHaveCount(2)
  await secondAiParagraph.locator('.script-material-paragraph-content').click({ button: 'right' })
  const selectionMenu = mainWindow.getByRole('menu', { name: '选区操作' })
  await expect(selectionMenu.getByRole('menuitem', { name: /按具体要求修改/ })).toBeVisible()
  await expect(selectionMenu.getByRole('menuitem', { name: /追加到当前文案/ })).toBeVisible()
  await selectionMenu.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const multiRewriteDialog = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await expect(multiRewriteDialog).toContainText('先给结论')
  await expect(multiRewriteDialog).toContainText('官方支持4TB')
  await expect(multiRewriteDialog).toContainText('生成局部候选，不直接改原文')
  await multiRewriteDialog.getByLabel('关闭修改面板').click()
  await mainWindow.locator('.script-material-selection-status').getByRole('button', { name: '清除' }).click()
  await expect(mainWindow.locator('.script-material-paragraph.is-selected')).toHaveCount(0)
  await mainWindow.locator('.script-material-point').first().click()
  await expect(mainWindow.locator('.script-material-paragraph').nth(1)).toHaveClass(/active/)
  await mainWindow.getByRole('button', { name: '替换当前文案' }).click()
  const firstCurrentRelation = mainWindow.locator('.current-script-pane [data-script-material-relation-id]').first()
  const secondCurrentRelation = mainWindow.locator('.current-script-pane [data-script-material-draft-paragraph-ids="material-codex-p-2"]').first()
  const secondCurrentRelationId = await secondCurrentRelation.getAttribute('data-script-material-relation-id')
  expect(secondCurrentRelationId).toBeTruthy()
  const secondCurrentRelationParts = mainWindow.locator(`.current-script-pane [data-script-material-relation-id="${secondCurrentRelationId}"]`)
  await expect(firstCurrentRelation).toContainText('先给结论')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).tasks.length)).toBe(directActionTaskCount)
  await mainWindow.evaluate(() => {
    const globalState = globalThis as unknown as {
      __r42ScrollLog: string[]
      __r42OriginalScrollIntoView: (...args: unknown[]) => void
      __r42ScrollPrototype: { scrollIntoView: (...args: unknown[]) => void }
      document: { createElement(tagName: string): object }
    }
    let elementPrototype = Object.getPrototypeOf(globalState.document.createElement('div')) as {
      scrollIntoView: (...args: unknown[]) => void
    }
    while (elementPrototype && !Object.prototype.hasOwnProperty.call(elementPrototype, 'scrollIntoView')) {
      elementPrototype = Object.getPrototypeOf(elementPrototype) as typeof elementPrototype
    }
    globalState.__r42ScrollLog = []
    globalState.__r42OriginalScrollIntoView = elementPrototype.scrollIntoView
    globalState.__r42ScrollPrototype = elementPrototype
    elementPrototype.scrollIntoView = function (this: { className: unknown; textContent?: string | null }): void {
      globalState.__r42ScrollLog.push(`${String(this.className)}|${this.textContent?.trim().slice(0, 40) ?? ''}`)
    }
  })
  await firstCurrentRelation.dblclick()
  await expect(mainWindow.locator('.script-material-point').nth(1)).toHaveClass(/active/)
  await expect(firstAiParagraph).toHaveClass(/active/)
  await expect.poll(() => mainWindow.evaluate(() => {
    const log = (globalThis as unknown as { __r42ScrollLog: string[] }).__r42ScrollLog
    return {
      source: log.some((item) => item.includes('script-material-point')),
      ai: log.some((item) => item.includes('script-material-paragraph'))
    }
  })).toEqual({ source: true, ai: true })
  await mainWindow.evaluate(() => {
    const globalState = globalThis as unknown as {
      __r42OriginalScrollIntoView: (...args: unknown[]) => void
      __r42ScrollPrototype: { scrollIntoView: (...args: unknown[]) => void }
    }
    globalState.__r42ScrollPrototype.scrollIntoView = globalState.__r42OriginalScrollIntoView
  })
  const pinHighlight = mainWindow.getByRole('button', { name: '固定本次高亮' })
  await expect(pinHighlight).toBeEnabled()
  await pinHighlight.click()
  await expect(mainWindow.getByRole('button', { name: '已固定高亮' })).toHaveAttribute('aria-pressed', 'true')
  await expect(mainWindow.locator('.current-script-pane .is-material-relation-pinned').filter({ hasText: '先给结论' })).toBeVisible()
  await kindTabs.getByRole('tab', { name: '成稿对比' }).click()
  await expect(kindTabs.getByRole('tab', { name: '成稿对比' })).toHaveAttribute('aria-selected', 'true')
  await kindTabs.getByRole('tab', { name: '素材成稿' }).click()
  await expect(mainWindow.getByRole('button', { name: '已固定高亮' })).toHaveAttribute('aria-pressed', 'true')
  await expect(mainWindow.locator('.script-material-point .script-material-pinned-badge')).toHaveCount(1)
  await expect(mainWindow.locator('.script-material-paragraph .script-material-pinned-badge')).toHaveCount(1)
  await expect(mainWindow.locator('.current-script-pane .is-material-relation-pinned').filter({ hasText: '先给结论' })).toBeVisible()
  await secondAiParagraph.locator('.script-material-paragraph-content').click()
  await expect(mainWindow.locator('.script-material-point.active')).toHaveCount(2)
  const pinnedCurrentHighlight = mainWindow.locator('.current-script-pane .is-material-relation-pinned').filter({ hasText: '先给结论' })
  const liveCurrentHighlight = mainWindow.locator('.current-script-pane .is-material-relation-live')
  await expect(pinnedCurrentHighlight).toHaveClass(/is-material-relation-active/)
  await expect(pinnedCurrentHighlight).not.toHaveClass(/is-material-relation-live/)
  await expectJoinedText(liveCurrentHighlight, '官方支持4TB')
  await expect(firstAiParagraph).toHaveClass(/is-highlight-pinned/)

  await secondCurrentRelation.click()
  await mainWindow.keyboard.press('Home')
  await mainWindow.keyboard.press('ArrowRight')
  await mainWindow.keyboard.type('测')
  await expectJoinedText(secondCurrentRelationParts, '官测方支持4TB')
  await expectJoinedText(mainWindow.locator('.current-script-pane .is-material-relation-live'), '官测方支持4TB')
  await mainWindow.keyboard.press('Meta+z')
  await expectJoinedText(secondCurrentRelationParts, '官方支持4TB')
  await expectJoinedText(mainWindow.locator('.current-script-pane .is-material-relation-live'), '官方支持4TB')
  await mainWindow.keyboard.press('Meta+Shift+z')
  await expectJoinedText(secondCurrentRelationParts, '官测方支持4TB')
  await mainWindow.keyboard.press('Meta+z')
  await expectJoinedText(secondCurrentRelationParts, '官方支持4TB')
  await secondCurrentRelationParts.evaluateAll((relations) => {
    const first = relations[0]
    const last = relations.at(-1)
    if (!first || !last) return
    const range = first.ownerDocument.createRange()
    range.setStartBefore(first)
    range.setEndAfter(last)
    const selection = first.ownerDocument.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await mainWindow.keyboard.press('Backspace')
  await expect(secondCurrentRelationParts).toHaveCount(0)
  await expect(mainWindow.locator('.current-script-pane .is-material-relation-live')).toHaveCount(0)
  await mainWindow.keyboard.press('Meta+z')
  await expectJoinedText(secondCurrentRelationParts, '官方支持4TB')
  await expectJoinedText(mainWindow.locator('.current-script-pane .is-material-relation-live'), '官方支持4TB')
  await mainWindow.keyboard.press('Meta+Shift+z')
  await expect(secondCurrentRelationParts).toHaveCount(0)
  await mainWindow.keyboard.press('Meta+z')
  await expectJoinedText(secondCurrentRelationParts, '官方支持4TB')
  await mainWindow.getByRole('button', { name: '保存当前文案' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')
    const version = project.latestVersions.find((item) => item.documentType === 'script' && item.kind === 'merged_draft')
    const content = version?.content ?? ''
    const workspaceContent = version?.workspaceContent ?? ''
    return {
      deliveryHasRelation: content.includes('data-script-material-relation-id'),
      workspaceHasRelation: workspaceContent.includes('data-script-material-relation-id'),
      hasDecorationClass: workspaceContent.includes('is-material-relation-active') || workspaceContent.includes('is-material-relation-pinned') || workspaceContent.includes('is-material-relation-live'),
      hasDecorationData: workspaceContent.includes('data-script-material-focus-decoration')
    }
  })).toEqual({ deliveryHasRelation: false, workspaceHasRelation: true, hasDecorationClass: false, hasDecorationData: false })

  await mainWindow.setViewportSize({ width: 900, height: 760 })
  const materialNarrowTabs = mainWindow.getByRole('tablist', { name: '素材成稿窄窗栏目' })
  await expect(materialNarrowTabs).toBeVisible()
  await expect(materialNarrowTabs.getByRole('tab')).toHaveText(['原始素材', 'AI稿', '当前文案'])
  await expect(mainWindow.getByRole('tabpanel')).toHaveCount(1)
  await expect(mainWindow.locator('.script-material-pane.ai-pane')).toBeVisible()
  await expect(mainWindow.locator('.script-material-pane.source-pane')).toBeHidden()
  const sourceTab = materialNarrowTabs.getByRole('tab', { name: '原始素材' })
  const aiTab = materialNarrowTabs.getByRole('tab', { name: 'AI稿' })
  const currentTab = materialNarrowTabs.getByRole('tab', { name: '当前文案' })
  await sourceTab.click()
  await expect(mainWindow.locator('.script-material-pane.source-pane')).toBeVisible()
  await expect(mainWindow.locator('.script-material-pane.ai-pane')).toBeHidden()
  await expect(mainWindow.locator('.script-material-point.active')).toHaveCount(2)
  await expect(mainWindow.locator('.script-material-point .script-material-pinned-badge')).toHaveCount(1)
  const sourceBody = mainWindow.locator('.script-material-source-body')
  await sourceBody.evaluate((element) => {
    element.style.paddingBottom = '900px'
    element.scrollTop = 73
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchMaterialScrollTops.source)).toBe(73)
  await sourceTab.press('ArrowRight')
  await expect(aiTab).toBeFocused()
  await expect(aiTab).toHaveAttribute('aria-selected', 'true')
  await aiTab.press('End')
  await expect(currentTab).toBeFocused()
  await expect(currentTab).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.locator('.script-material-current-column')).toBeVisible()
  await expect(pinnedCurrentHighlight).toHaveClass(/is-material-relation-pinned/)
  await expectJoinedText(liveCurrentHighlight, '官方支持4TB')
  await currentTab.press('Home')
  await expect(sourceTab).toBeFocused()
  await expect.poll(() => sourceBody.evaluate((element) => element.scrollTop)).toBe(73)
  await mainWindow.evaluate(() => {
    const globalState = globalThis as unknown as {
      __r42DeferredScrollLog: string[]
      __r42DeferredOriginalScrollIntoView: (...args: unknown[]) => void
      __r42DeferredScrollPrototype: { scrollIntoView: (...args: unknown[]) => void }
      document: { createElement(tagName: string): object }
    }
    let elementPrototype = Object.getPrototypeOf(globalState.document.createElement('div')) as { scrollIntoView: (...args: unknown[]) => void }
    while (elementPrototype && !Object.prototype.hasOwnProperty.call(elementPrototype, 'scrollIntoView')) {
      elementPrototype = Object.getPrototypeOf(elementPrototype) as typeof elementPrototype
    }
    globalState.__r42DeferredScrollLog = []
    globalState.__r42DeferredOriginalScrollIntoView = elementPrototype.scrollIntoView
    globalState.__r42DeferredScrollPrototype = elementPrototype
    elementPrototype.scrollIntoView = function (this: { className: unknown }): void {
      globalState.__r42DeferredScrollLog.push(String(this.className))
    }
  })
  await aiTab.click()
  await expect(mainWindow.locator('.script-material-pane.ai-pane')).toBeVisible()
  await expect(firstAiParagraph).toHaveClass(/is-highlight-pinned/)
  await expect(secondAiParagraph).toHaveClass(/active/)
  await secondAiParagraph.locator('.script-material-paragraph-content').click()
  await sourceTab.click()
  await expect.poll(() => mainWindow.evaluate(() => (
    globalThis as unknown as { __r42DeferredScrollLog: string[] }
  ).__r42DeferredScrollLog.some((item) => item.includes('script-material-point')))).toBe(true)
  await mainWindow.evaluate(() => {
    const globalState = globalThis as unknown as {
      __r42DeferredOriginalScrollIntoView: (...args: unknown[]) => void
      __r42DeferredScrollPrototype: { scrollIntoView: (...args: unknown[]) => void }
    }
    globalState.__r42DeferredScrollPrototype.scrollIntoView = globalState.__r42DeferredOriginalScrollIntoView
  })
  await aiTab.click()
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchMaterialTab)).toBe('ai')
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-narrow-tabs.png') })
  await mainWindow.setViewportSize({ width: 680, height: 720 })
  await expect(mainWindow.locator('.script-material-columns > :visible')).toHaveCount(1)
  await expect.poll(() => mainWindow.locator('.script-material-workspace').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await mainWindow.setViewportSize({ width: 1440, height: 900 })
  await expect(materialNarrowTabs).toBeHidden()
  await expect(mainWindow.locator('.script-material-pane.source-pane')).toBeVisible()
  await expect(mainWindow.locator('.script-material-pane.ai-pane')).toBeVisible()
  await expect(mainWindow.locator('.script-material-current-column')).toBeVisible()
  await sourceBody.evaluate((element) => {
    element.scrollTop = 91
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchMaterialScrollTops.source)).toBe(91)
  await mainWindow.getByRole('button', { name: '已固定高亮' }).click()
  await expect(mainWindow.locator('.current-script-pane .is-material-relation-pinned')).toHaveCount(0)
  await expectJoinedText(liveCurrentHighlight, '官方支持4TB')
  await expect(mainWindow.locator('.script-material-point.active')).toHaveCount(1)
  await thirdAiParagraph.locator('.script-material-paragraph-content').click()
  await expect(mainWindow.locator('.script-material-point.active')).toHaveCount(0)
  await expect(thirdAiParagraph).toHaveClass(/active/)
  await expect(mainWindow.locator('.current-script-pane .is-material-relation-active').filter({ hasText: '先给结论' })).toHaveCount(0)
  await expect(mainWindow.locator('.current-script-pane .is-material-relation-live').filter({ hasText: '这段没有可靠来源' })).toBeVisible()
  await expect(mainWindow.getByRole('status')).toContainText('没有找到可靠的原稿对应')
  await firstAiParagraph.locator('.script-material-paragraph-content').click()

  await firstAiParagraph.locator('.script-material-paragraph-content').click({ button: 'right' })
  await expect(mainWindow.getByRole('menuitem', { name: /按具体要求修改/ })).toBeVisible()
  await expect(mainWindow.getByRole('menuitem', { name: '下划线' })).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-context-menu.png') })
  await mainWindow.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const rewriteDialog = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await expect(rewriteDialog.getByPlaceholder('输入具体要求')).toBeFocused()
  await expect(rewriteDialog.locator('.rewrite-quick-actions button')).toHaveText(['重新生成', '润色', '更精简', '更口语', '扩写', '更有趣'])
  await expect(rewriteDialog.getByRole('button', { name: '生成候选', exact: true })).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-rewrite-dialog.png') })
  await rewriteDialog.getByLabel('关闭修改面板').click()
  await mainWindow.getByRole('button', { name: '局部任务1个' }).click()
  const rewriteTasks = mainWindow.getByRole('dialog', { name: 'AI稿局部任务' })
  await expect(rewriteTasks).toContainText('后台生成，不影响继续编辑')
  await expect(rewriteTasks.locator('.script-material-rewrite-task-list > button.ready')).toContainText('已完成')
  await expect(rewriteTasks).toContainText('更口语化')
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-local-tasks.png') })
  await rewriteTasks.locator('.script-material-rewrite-task-list > button.ready').click()
  const localCandidate = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(localCandidate).toContainText('先说结论，我觉得生态联动才是它最省心的地方。')
  await expect(mainWindow.getByLabel('AI稿版本切换')).toContainText('第1／2稿')
  await localCandidate.getByRole('button', { name: '追加' }).click()
  await expect(mainWindow.locator('.current-script-pane .tiptap')).toContainText('先说结论，我觉得生态联动才是它最省心的地方。')
  await expect(mainWindow.locator('mark.needs-confirmation')).toHaveText('生态联动')
  await expect(mainWindow.locator('mark.web-supplement')).toHaveText('4TB')
  await mainWindow.locator('mark.needs-confirmation').evaluate((element) => {
    const selection = element.ownerDocument.defaultView!.getSelection()!
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  const selectedTextBox = await mainWindow.locator('mark.needs-confirmation').boundingBox()
  await mainWindow.mouse.click(selectedTextBox!.x + selectedTextBox!.width / 2, selectedTextBox!.y + selectedTextBox!.height / 2, { button: 'right' })
  await expect(mainWindow.getByRole('menuitem', { name: '高亮' })).toBeVisible()
  await expect(mainWindow.getByRole('menuitem', { name: '下划线' })).toBeVisible()
  await expect(mainWindow.getByRole('menuitem', { name: '删除线' })).toBeVisible()
  await expect(mainWindow.getByRole('menuitem', { name: /清除标记/ })).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-selection-menu.png') })
  await mainWindow.getByRole('menuitem', { name: '下划线' }).click()
  await expect(mainWindow.locator('.manual-underline')).toHaveText('生态联动')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.listSourceScriptAnnotations('ai-browser')
  ).filter((annotation) => annotation.sourceKind === 'material_draft' && annotation.selectedText === '生态联动'))).toEqual([
    expect.objectContaining({ blockStart: 5, blockEnd: 9, selectedText: '生态联动', style: 'underline' })
  ])
  const webSupplementStyle = await mainWindow.locator('mark.web-supplement').evaluate((element) => {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element)
    const paragraph = element.closest('p')
    return {
      color: style.color,
      paragraphColor: paragraph ? element.ownerDocument.defaultView!.getComputedStyle(paragraph).color : '',
      background: style.backgroundColor
    }
  })
  expect(webSupplementStyle.color).not.toBe(webSupplementStyle.paragraphColor)
  expect(webSupplementStyle.background).not.toBe('rgba(0, 0, 0, 0)')
  await expect(mainWindow.getByRole('button', { name: '联网来源·官方产品页' })).toBeVisible()
  const confirmInference = mainWindow.getByRole('button', { name: 'AI推断补写·待确认' })
  await expect(confirmInference).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-annotations.png') })
  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({ theme: 'dark' })
  })
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(mainWindow.locator('mark.needs-confirmation')).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-annotations-dark.png') })
  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({ theme: 'light' })
  })
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'light')
  await confirmInference.click()
  await expect(mainWindow.locator('mark.needs-confirmation')).toHaveCount(0)
  await expect(mainWindow.locator('.script-material-paragraph').first()).toContainText('生态联动')
  await expect(mainWindow.locator('mark.web-supplement')).toHaveText('4TB')
  await expect(mainWindow.locator('.source-pane > footer, .current-script-pane > footer')).toHaveCount(0)

  await mainWindow.setViewportSize({ width: 900, height: 760 })
  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()
  await expect(mainWindow.locator('.workbench-topbar')).toBeHidden()
  await expect(mainWindow.locator('.script-material-toolbar')).toBeHidden()
  await expect(mainWindow.getByRole('tablist', { name: '素材成稿窄窗栏目' })).toBeVisible()
  await expect(mainWindow.locator('.script-material-columns > :visible')).toHaveCount(1)
  await expect(mainWindow.getByRole('button', { name: /退出沉浸/ })).toHaveCount(0)
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.locator('.workbench-topbar')).toBeVisible()
  await mainWindow.setViewportSize({ width: 680, height: 760 })
  const compactTopbarGeometry = await mainWindow.locator('.workbench-topbar').evaluate((topbar) => {
    const topbarRect = topbar.getBoundingClientRect()
    let childBottom = topbarRect.bottom
    for (let index = 0; index < topbar.children.length; index += 1) {
      childBottom = Math.max(childBottom, topbar.children.item(index)?.getBoundingClientRect().bottom ?? topbarRect.bottom)
    }
    const workspaceTop = topbar.ownerDocument.querySelector('.script-material-workspace')?.getBoundingClientRect().top ?? 0
    return { topbarBottom: topbarRect.bottom, childBottom, workspaceTop }
  })
  expect(compactTopbarGeometry.childBottom).toBeLessThanOrEqual(compactTopbarGeometry.topbarBottom + 1)
  expect(compactTopbarGeometry.workspaceTop).toBeGreaterThanOrEqual(compactTopbarGeometry.topbarBottom)
  for (const controlName of ['项目上下文', '1个AI', '2个AI']) {
    const control = mainWindow.getByRole('button', { name: controlName })
    await expect.poll(() => control.evaluate((button, label) => {
      const rect = button.getBoundingClientRect()
      const hit = button.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return Boolean(hit?.closest('button')?.textContent?.includes(label))
    }, controlName)).toBe(true)
  }
  await mainWindow.screenshot({ path: testInfo.outputPath('r42-compact-topbar.png') })
  await mainWindow.getByRole('button', { name: '进入沉浸模式' }).click()
  await expect(mainWindow.locator('.workbench-topbar')).toBeHidden()
  const compactImmersiveGeometry = await mainWindow.locator('.script-workbench-shell').evaluate((shell) => {
    const shellRect = shell.getBoundingClientRect()
    const workspaceRect = shell.querySelector('.script-material-workspace')?.getBoundingClientRect()
    return {
      gridRowCount: shell.ownerDocument.defaultView!.getComputedStyle(shell).gridTemplateRows.trim().split(/\s+/).filter(Boolean).length,
      topGap: workspaceRect ? workspaceRect.top - shellRect.top : Number.POSITIVE_INFINITY,
      bottomGap: workspaceRect ? shellRect.bottom - workspaceRect.bottom : Number.POSITIVE_INFINITY
    }
  })
  expect(compactImmersiveGeometry.gridRowCount).toBe(1)
  expect(compactImmersiveGeometry.topGap + compactImmersiveGeometry.bottomGap).toBeLessThanOrEqual(20)
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.locator('.workbench-topbar')).toBeVisible()
  await mainWindow.setViewportSize({ width: 1440, height: 900 })

  const aiCount = mainWindow.getByRole('group', { name: 'AI数量' })
  await aiCount.getByRole('button', { name: '2个AI' }).click()
  await expect(aiCount.getByRole('button', { name: '2个AI' })).toHaveClass(/active/)
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getScriptMaterialWorkspace('ai-browser')
  ).aiCount)).toBe(2)
  await expect(mainWindow.getByRole('tab', { name: 'Codex稿' })).toBeVisible()
  await expect(mainWindow.getByRole('tab', { name: 'Claude稿' })).toBeVisible()

  await mainWindow.getByRole('button', { name: /格式/ }).click()
  await expect(mainWindow.getByRole('button', { name: '下划线' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '删除线' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '高亮颜色1' })).toBeVisible()

  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ))).toMatchObject({ workbenchPrimaryView: 'comparison', workbenchComparisonKind: 'materials', workbenchMaterialTab: 'ai' })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).preferences.lastProjectModuleById['ai-browser'])).toBe('script')
  await mainWindow.setViewportSize({ width: 900, height: 760 })
  await mainWindow.getByRole('tablist', { name: '素材成稿窄窗栏目' }).getByRole('tab', { name: '当前文案' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchMaterialTab)).toBe('current')
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('tab', { name: '对照筛选' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('tablist', { name: '素材成稿窄窗栏目' }).getByRole('tab', { name: '当前文案' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.locator('.script-material-current-column')).toBeVisible()
  await expect(mainWindow.locator('.manual-underline')).toHaveText('生态联动')
})
