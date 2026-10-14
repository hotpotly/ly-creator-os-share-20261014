import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }

let electronApp: ElectronApplication
let mainWindow: Page
let pageErrors: string[]
let userDataPath: string

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
      CREATOR_OS_TEST_R17_READY: '1',
      CREATOR_OS_TEST_DRAFT_BASE_FAILURE_CALL: testInfo.title.includes('基线保存失败') ? '2' : '0',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  pageErrors = []
  mainWindow.on('pageerror', (error) => pageErrors.push(error.message))
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await expect(mainWindow.getByRole('heading', { name: '当前文案' })).toBeVisible()
  await expect(mainWindow.getByText('这份旧整理结果还没有建立当前文案基线', { exact: false })).toBeVisible()
  await mainWindow.getByRole('button', { name: '确认同步', exact: true }).click()
  await mainWindow.getByRole('alertdialog', { name: '确认对照整理同步' }).getByRole('button', { name: '用整理结果覆盖' }).click()
  await expect.poll(async () => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const [comparison, current] = await Promise.all([
      api.getDraftComparisonWorkspace('ai-browser'),
      api.loadProjectCurrentScript('ai-browser')
    ])
    return current.status === 'ready'
      && comparison.currentDocumentBaseContentHash === current.snapshot.document.contentHash
  })).toBe(true)
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
})

// eslint-disable-next-line no-empty-pattern
test('R17双稿工作台使用Codex左Claude右、圆形直点选和三态着色', async ({}, testInfo) => {
  const firstGroup = mainWindow.locator('[data-comparison-group-id]').first()
  await expect(firstGroup.locator('.comparison-sources > section')).toHaveCount(2)
  await expect(firstGroup.locator('.comparison-sources > section').nth(0)).toHaveAttribute('data-comparison-side', 'codex')
  await expect(firstGroup.locator('.comparison-sources > section').nth(1)).toHaveAttribute('data-comparison-side', 'claude')
  await expect(mainWindow.getByText('右键选择')).toHaveCount(0)
  await expect(mainWindow.getByText('按组序生成，可拖动明确改序')).toHaveCount(0)
  await expect(firstGroup.locator('input[type="checkbox"]')).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '合并所选' })).toHaveCount(0)

  const codexSelect = firstGroup.getByRole('button', { name: '取消选用Codex稿' })
  await codexSelect.click()
  await expect(firstGroup.getByRole('button', { name: '选用Codex稿' })).toBeVisible()
  await firstGroup.getByRole('button', { name: '选用Codex稿' }).click()
  await expect(firstGroup.getByRole('button', { name: '取消选用Codex稿' })).toBeVisible()
  await expect(firstGroup).not.toHaveClass(/source-selected/)

  const colorMode = mainWindow.getByLabel('着色模式')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r17-all-colors.png') })
  await colorMode.selectOption('left')
  await expect(mainWindow.locator('.draft-comparison-workspace')).toHaveClass(/comparison-color-mode-left/)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r17-left-colors.png') })
  await colorMode.selectOption('none')
  await expect(mainWindow.locator('.draft-comparison-workspace')).toHaveClass(/comparison-color-mode-none/)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r17-no-colors.png') })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByLabel('着色模式')).toHaveValue('none')
  expect(pageErrors).toEqual([])
})

// eslint-disable-next-line no-empty-pattern
test('R16成稿对比在对照整理和唯一当前文案间切换且按项目记忆', async ({}, testInfo) => {
  const organizeTab = mainWindow.getByRole('tab', { name: '对照整理', exact: true })
  const currentTab = mainWindow.getByRole('tab', { name: '当前文案', exact: true })
  const syncDialog = mainWindow.getByRole('alertdialog', { name: '确认对照整理同步' })
  await expect(organizeTab).toHaveAttribute('aria-selected', 'true')

  const groupEditor = mainWindow.getByLabel('组1当前文案')
  const blockIdsBeforeSafeEdit = await mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready' ? current.snapshot.blocks.map((block) => block.blockId) : []
  })
  await groupEditor.fill('对照整理中的独立工作状态')
  await groupEditor.blur()
  await currentTab.click()

  const currentEditor = mainWindow.locator('.draft-current-script-layout .current-script-pane .tiptap')
  await expect(currentEditor).toBeVisible()
  await expect(mainWindow.locator('.draft-comparison-workspace')).not.toBeVisible()
  await expect(currentEditor).toContainText('对照整理中的独立工作状态')
  await expect.poll(async () => mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready' ? current.snapshot.blocks.map((block) => block.blockId) : []
  })).toEqual(blockIdsBeforeSafeEdit)
  await organizeTab.click()
  await groupEditor.fill('保留身份第一行\n保留身份第二行')
  await groupEditor.blur()
  await expect(syncDialog).not.toBeVisible()
  await currentTab.click()
  await expect.poll(() => currentEditor.evaluate((element) => (
    element as unknown as { innerText: string }
  ).innerText.includes('保留身份第一行\n保留身份第二行'))).toBe(true)
  await expect.poll(async () => mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready' ? current.snapshot.blocks.map((block) => block.blockId) : []
  })).toEqual(blockIdsBeforeSafeEdit)
  await organizeTab.click()
  await groupEditor.fill('保留身份第一行保留身份第二行')
  await groupEditor.blur()
  await expect(syncDialog).not.toBeVisible()
  await currentTab.click()
  await expect.poll(() => currentEditor.evaluate((element) => {
    const text = (element as unknown as { innerText: string }).innerText
    return text.includes('保留身份第一行保留身份第二行') && !text.includes('保留身份第一行\n保留身份第二行')
  })).toBe(true)
  await expect.poll(async () => mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready' ? current.snapshot.blocks.map((block) => block.blockId) : []
  })).toEqual(blockIdsBeforeSafeEdit)
  await currentEditor.fill('# 成稿对比共享当前文案\n\n这段直接保存到项目唯一正文。')
  await expect(mainWindow.locator('.current-script-save-status')).toHaveText('已自动保存', { timeout: 10_000 })

  await mainWindow.setViewportSize({ width: 880, height: 720 })
  await mainWindow.screenshot({ path: testInfo.outputPath('r16-draft-current-wide.png') })
  await mainWindow.setViewportSize({ width: 420, height: 720 })
  await mainWindow.screenshot({ path: testInfo.outputPath('r16-draft-current-narrow.png') })
  await mainWindow.setViewportSize({ width: 1280, height: 820 })

  await organizeTab.click()
  await expect(mainWindow.locator('.draft-comparison-workspace')).toBeVisible()
  await expect(groupEditor).toHaveValue('保留身份第一行保留身份第二行')
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  await groupEditor.fill('对照整理中的独立工作状态（继续整理）')
  await groupEditor.blur()
  await expect(syncDialog).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('r16-draft-sync-conflict-wide.png') })
  await mainWindow.setViewportSize({ width: 420, height: 720 })
  await mainWindow.screenshot({ path: testInfo.outputPath('r16-draft-sync-conflict-narrow.png') })
  await mainWindow.setViewportSize({ width: 1280, height: 820 })
  await syncDialog.getByRole('button', { name: '保留当前文案' }).click()
  await expect(syncDialog).not.toBeVisible()
  await mainWindow.getByRole('button', { name: '纯净', exact: true }).click()
  await expect(mainWindow.getByLabel('纯净文案编辑区')).toHaveValue(/\u6210稿对比共享当前文案/)
  await mainWindow.getByRole('button', { name: '以最新正文继续', exact: true }).click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).not.toBeVisible()
  await currentTab.click()
  await currentEditor.fill('# 成稿对比共享当前文案\n\n这段还没自动保存就切回整理。')
  await organizeTab.click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  await mainWindow.getByRole('button', { name: '组模式', exact: true }).click()
  await groupEditor.fill('快速切回时保留的整理结果')
  await groupEditor.blur()
  await expect(syncDialog).toBeVisible()
  await syncDialog.getByRole('button', { name: '保留当前文案' }).click()
  await currentTab.click()
  await expect(currentEditor).toContainText('这段还没自动保存就切回整理')
  await expect(mainWindow.locator('.current-script-save-status')).toHaveText('已自动保存', { timeout: 10_000 })
  await organizeTab.click()
  await mainWindow.getByRole('button', { name: '纯净', exact: true }).click()
  await mainWindow.getByRole('button', { name: '以最新正文继续', exact: true }).click()
  await mainWindow.getByRole('button', { name: '组模式', exact: true }).click()
  await mainWindow.keyboard.press('Meta+s')
  await expect(mainWindow.getByRole('status')).toContainText('没有保存隐藏的当前文案')
  await currentTab.click()
  await expect(currentEditor).toContainText('成稿对比共享当前文案')
  await mainWindow.getByRole('button', { name: /格式/ }).click()
  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await mainWindow.getByRole('toolbar', { name: '文案格式' }).getByRole('button', { name: '下划线' }).click()
  await expect(currentEditor.locator('u').first()).toBeVisible()
  await expect.poll(async () => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const [comparison, current] = await Promise.all([
      api.getDraftComparisonWorkspace('ai-browser'),
      api.loadProjectCurrentScript('ai-browser')
    ])
    return current.status === 'ready'
      && comparison.currentDocumentBaseContentHash !== current.snapshot.document.contentHash
  })).toBe(true)
  await organizeTab.click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  await groupEditor.fill('格式分叉后的整理结果')
  await groupEditor.blur()
  await expect(syncDialog).toBeVisible()
  await syncDialog.getByRole('button', { name: '保留当前文案' }).click()
  await currentTab.click()
  await expect(currentEditor.locator('u').first()).toBeVisible()

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/home' })
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('tab', { name: '对照筛选' })).toHaveAttribute('aria-selected', 'true')
  await expect(currentTab).toHaveAttribute('aria-selected', 'true')
  await organizeTab.click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  await mainWindow.getByLabel('组1当前文案').fill('真正重挂载后仍保留的整理结果')
  await mainWindow.getByLabel('组1当前文案').blur()
  await expect(syncDialog).toBeVisible()
  await syncDialog.getByRole('button', { name: '保留当前文案' }).click()
  await mainWindow.getByRole('button', { name: '纯净', exact: true }).click()
  await mainWindow.getByRole('button', { name: '以最新正文继续', exact: true }).click()
  await expect.poll(async () => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const [comparison, current] = await Promise.all([
      api.getDraftComparisonWorkspace('ai-browser'),
      api.loadProjectCurrentScript('ai-browser')
    ])
    return current.status === 'ready'
      && comparison.currentDocumentBaseRevision === current.snapshot.document.revision
      && comparison.currentDocumentBaseContentHash === current.snapshot.document.contentHash
  })).toBe(true)
  await mainWindow.getByRole('button', { name: '组模式', exact: true }).click()
  await mainWindow.getByLabel('组1当前文案').fill('富文本基线后的整理修改')
  await mainWindow.getByLabel('组1当前文案').blur()
  await expect(syncDialog).toBeVisible()
  await expect(syncDialog).toContainText('这次同步会改动当前文案的结构化内容')
  await expect(syncDialog).toContainText('格式、标记、来源关系或段落结构')
  await currentTab.click()
  await expect(syncDialog).not.toBeVisible()
  await expect(currentEditor.locator('u').first()).toBeVisible()
  await organizeTab.click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  await mainWindow.getByRole('button', { name: '纯净', exact: true }).click()
  await mainWindow.getByRole('button', { name: '以最新正文继续', exact: true }).click()
  await mainWindow.getByRole('button', { name: '组模式', exact: true }).click()
  await currentTab.click()

  await mainWindow.getByRole('tab', { name: '对话模式' }).click()
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await expect(currentTab).toHaveAttribute('aria-selected', 'true')
  await expect(currentEditor).toContainText('成稿对比共享当前文案')
  await expect(currentEditor.locator('u').first()).toBeVisible()
  await organizeTab.click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).not.toBeVisible()
  await mainWindow.getByLabel('组1当前文案').fill('富文本基线重开后的整理结果')
  await mainWindow.getByLabel('组1当前文案').blur()
  await expect(syncDialog).toBeVisible()
  await expect(syncDialog).toContainText('这次同步会改动当前文案的结构化内容')
  await expect(syncDialog.getByRole('button', { name: '保留当前文案' })).toBeFocused()
  const promptedOrganizerContent = await mainWindow.getByLabel('组1当前文案').inputValue()
  await mainWindow.keyboard.press('Meta+z')
  await expect(mainWindow.getByLabel('组1当前文案')).toHaveValue(promptedOrganizerContent)
  await mainWindow.getByLabel('组1当前文案').evaluate((element) => {
    const textarea = element as unknown as { value: string; dispatchEvent(event: unknown): void }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea) as object, 'value')?.set
    setter?.call(textarea, '弹框后异步变化的最新整理结果')
    const EventConstructor = (globalThis as unknown as { Event: new(type: string, init: { bubbles: boolean }) => unknown }).Event
    textarea.dispatchEvent(new EventConstructor('input', { bubbles: true }))
  })
  await syncDialog.getByRole('button', { name: '用整理结果覆盖' }).click()
  await expect(syncDialog).toBeVisible()
  await expect(mainWindow.getByRole('status')).toContainText('整理结果又有变化')
  await syncDialog.getByRole('button', { name: '用整理结果覆盖' }).click()
  await currentTab.click()
  await expect(currentEditor).toContainText('弹框后异步变化的最新整理结果')
  await expect(currentEditor.locator('u')).toHaveCount(0)

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/home' })
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('tab', { name: '对照筛选' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('tab', { name: '成稿对比' })).toHaveAttribute('aria-selected', 'true')
  await expect(currentTab).toHaveAttribute('aria-selected', 'true')
  await expect(currentEditor).toContainText('弹框后异步变化的最新整理结果')
  expect(await mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchDraftSurface)).toBe('current')
  expect(pageErrors).toEqual([])
})

test('R16基线保存失败时保留整理结果并重新进入待确认状态', async () => {
  const groupEditor = mainWindow.getByLabel('组1当前文案')
  await groupEditor.fill('基线保存失败也不能伪装成已同步')
  await groupEditor.blur()
  await expect(mainWindow.getByRole('status')).toContainText('整理基线保存失败')
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  await mainWindow.getByRole('tab', { name: '当前文案', exact: true }).click()
  const currentEditor = mainWindow.locator('.draft-current-script-layout .current-script-pane .tiptap')
  await expect(currentEditor).toContainText('基线保存失败也不能伪装成已同步')
  await mainWindow.getByRole('tab', { name: '对照整理', exact: true }).click()
  await expect(mainWindow.getByText('当前文案已在其他页面更新', { exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('R17组模式和纯净模式编辑、备注与标记不白屏且内容持久化', async () => {
  test.setTimeout(90_000)
  const applyVisibleSyncPrompt = async (): Promise<void> => {
    const prompt = mainWindow.getByRole('alertdialog', { name: '确认对照整理同步' })
    await prompt.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined)
    for (let attempt = 0; attempt < 4 && await prompt.isVisible(); attempt += 1) {
      await prompt.getByRole('button', { name: '用整理结果覆盖' }).click()
    }
  }
  const moduleEditor = mainWindow.getByLabel('组1当前文案')
  await moduleEditor.fill('新的开头😀\n第二行')
  await moduleEditor.blur()
  await applyVisibleSyncPrompt()
  await mainWindow.getByRole('button', { name: '纯净' }).click()
  await expect(mainWindow.locator('.draft-comparison-workspace')).toHaveClass(/comparison-document-mode-clean/)
  await expect(mainWindow.getByLabel('纯净文案编辑区')).toHaveValue('新的开头😀\n第二行')
  await mainWindow.getByRole('button', { name: '组模式' }).click()
  await expect(mainWindow.getByLabel('组1当前文案')).toHaveValue('新的开头😀\n第二行')

  const editor = mainWindow.getByLabel('组1当前文案')
  await editor.dispatchEvent('contextmenu', { bubbles: true, clientX: 920, clientY: 300 })
  await mainWindow.getByRole('menuitem', { name: /添加备注/ }).click()
  const noteDialog = mainWindow.getByRole('dialog', { name: '文案组备注' })
  await noteDialog.getByRole('textbox').fill('注意保留口语节奏')
  await noteDialog.getByRole('button', { name: '保存' }).click()
  await expect(mainWindow.locator('.comparison-preview-module').first().locator('svg[aria-label="有备注"]')).toBeVisible()
  await editor.dispatchEvent('contextmenu', { bubbles: true, clientX: 920, clientY: 300 })
  await mainWindow.getByRole('menuitem', { name: /编辑备注/ }).click()
  await mainWindow.getByRole('dialog', { name: '文案组备注' }).getByRole('textbox').fill('备注已经修改')
  await mainWindow.getByRole('dialog', { name: '文案组备注' }).getByRole('button', { name: '保存' }).click()
  await editor.dispatchEvent('contextmenu', { bubbles: true, clientX: 920, clientY: 300 })
  await mainWindow.getByRole('menuitem', { name: '删除备注' }).click()
  await expect(mainWindow.locator('.comparison-preview-module').first().locator('svg[aria-label="有备注"]')).toHaveCount(0)

  await editor.evaluate((element) => {
    const textarea = element as unknown as { focus(): void; setSelectionRange(start: number, end: number): void }
    textarea.focus()
    textarea.setSelectionRange(0, 4)
  })
  await editor.dispatchEvent('contextmenu', { bubbles: true, clientX: 920, clientY: 330 })
  await mainWindow.getByRole('menuitem', { name: /添加标记/ }).click()
  await mainWindow.getByRole('dialog', { name: '文案标记' }).getByPlaceholder('备注（可不填）').fill('开头再确认')
  await mainWindow.getByRole('dialog', { name: '文案标记' }).getByRole('button', { name: '添加' }).click()
  await expect(mainWindow.getByRole('button', { name: /组1有1个标记/ })).toBeVisible()
  await mainWindow.getByRole('button', { name: '纯净' }).click()
  const cleanWithMarker = mainWindow.getByLabel('纯净文案编辑区')
  await cleanWithMarker.fill(`前缀-${await cleanWithMarker.inputValue()}`)
  await cleanWithMarker.blur()
  await applyVisibleSyncPrompt()
  await mainWindow.getByRole('button', { name: '组模式' }).click()
  await mainWindow.getByRole('button', { name: /组1有1个标记/ }).click()
  await expect(mainWindow.getByRole('dialog', { name: '组1标记' })).not.toContainText('位置已变化')
  await mainWindow.getByRole('dialog', { name: '组1标记' }).getByRole('button').first().click()
  await editor.fill('已经移除原来的标记文字')
  await editor.blur()
  await mainWindow.getByRole('button', { name: /组1有1个标记/ }).click()
  await expect(mainWindow.getByRole('dialog', { name: '组1标记' })).toContainText('位置已变化')
  await mainWindow.getByRole('dialog', { name: '组1标记' }).getByRole('button').first().click()

  for (let index = 0; index < 12; index += 1) {
    const mode = index % 2 ? '组模式' : '纯净'
    await mainWindow.locator('.comparison-document-mode').getByRole('button', { name: mode, exact: true }).click()
    const activeEditor = mode === '纯净' ? mainWindow.getByLabel('纯净文案编辑区') : mainWindow.getByLabel('组1当前文案')
    await activeEditor.fill(`稳定性循环${index}😀\n${'长文本'.repeat(30)}`)
    await activeEditor.blur()
    await applyVisibleSyncPrompt()
    await expect(mainWindow.locator('.script-workbench-shell')).toBeVisible()
  }
  await expect.poll(() => mainWindow.getByLabel('组1当前文案').evaluate((element) => {
    const textarea = element as unknown as { clientHeight: number; scrollHeight: number }
    return textarea.scrollHeight <= textarea.clientHeight + 2
  })).toBe(true)
  await mainWindow.getByRole('button', { name: '纯净' }).click()
  const oversizedEditor = mainWindow.getByLabel('纯净文案编辑区')
  const validContent = await oversizedEditor.inputValue()
  await oversizedEditor.fill('超'.repeat(80_001))
  await oversizedEditor.blur()
  await expect(mainWindow.getByText('单个文案组不能超过80000字，请拆分后再保存')).toBeVisible()
  await expect(mainWindow.locator('.comparison-safe-fallback')).toHaveCount(0)
  await oversizedEditor.fill(validContent)
  await oversizedEditor.blur()
  await mainWindow.getByRole('button', { name: '组模式' }).click()
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByLabel('组1当前文案')).toContainText('稳定性循环11')
  await expect(mainWindow.locator('.script-workbench-shell')).toBeVisible()
  await expect(mainWindow.locator('.comparison-safe-fallback')).toHaveCount(0)
  await electronApp.close()
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_TEST_R17_READY: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  mainWindow.on('pageerror', (error) => pageErrors.push(error.message))
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await expect(mainWindow.getByLabel('组1当前文案')).toContainText('稳定性循环11')
  expect(pageErrors).toEqual([])
})

test('R17拖动使用专用拖柄，手动正文替换需确认且纯净模式不改空白', async () => {
  const keepCurrentIfPrompted = async (): Promise<void> => {
    const prompt = mainWindow.getByRole('alertdialog', { name: '确认对照整理同步' })
    await prompt.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined)
    if (await prompt.isVisible()) await prompt.getByRole('button', { name: '保留当前文案' }).click()
  }
  const firstGroup = mainWindow.locator('[data-comparison-group-id]').first()
  const paragraph = firstGroup.locator('[data-comparison-side="codex"] .comparison-paragraph').first()
  const candidate = mainWindow.locator('[data-draft-candidate]').first()
  await expect(firstGroup.locator('[data-comparison-side="codex"]')).not.toHaveAttribute('draggable', 'true')
  await expect(paragraph).not.toHaveAttribute('draggable', 'true')
  await expect(candidate).not.toHaveAttribute('draggable', 'true')
  await expect(firstGroup.getByRole('button', { name: '拖动Codex稿', exact: true })).toHaveAttribute('draggable', 'true')
  await expect(paragraph.getByRole('button', { name: /拖动Codex稿段落1/ })).toHaveAttribute('draggable', 'true')
  await candidate.getByRole('button', { name: /拖动/ }).dragTo(mainWindow.locator('.comparison-preview-insert-line').nth(1))
  await expect(mainWindow.getByLabel('组2当前文案')).toHaveValue('候选体验段')
  await keepCurrentIfPrompted()

  await paragraph.locator('p').selectText()
  await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 })
  const selectionMenu = mainWindow.getByRole('menu', { name: '选区操作' })
  await expect(selectionMenu.getByRole('menuitem', { name: /按具体要求修改/ })).toBeVisible()
  await expect(selectionMenu.getByRole('menuitem', { name: '高亮' })).toBeVisible()
  await expect(selectionMenu.getByRole('menuitem', { name: /添加备注/ })).toBeVisible()
  await mainWindow.keyboard.press('Escape')

  const editor = mainWindow.getByLabel('组1当前文案')
  await editor.fill('完全手动修改，不能被静默覆盖')
  await editor.blur()
  await keepCurrentIfPrompted()
  await firstGroup.getByRole('button', { name: '选用Claude稿' }).click()
  const replaceDialog = mainWindow.getByRole('dialog', { name: '确认替换手动文案' })
  await expect(replaceDialog).toBeVisible()
  await replaceDialog.getByRole('button', { name: '取消' }).click()
  await expect(editor).toHaveValue('完全手动修改，不能被静默覆盖')
  const firstGroupId = await firstGroup.getAttribute('data-comparison-group-id')
  await firstGroup.getByRole('button', { name: '拖动Claude稿', exact: true }).dragTo(mainWindow.locator('.comparison-preview-insert-line.end'))
  await mainWindow.getByRole('dialog', { name: '确认替换手动文案' }).getByRole('button', { name: '确认替换' }).click()
  await keepCurrentIfPrompted()
  await expect(mainWindow.locator(`[data-preview-group-id="${firstGroupId}"] textarea`)).toHaveValue('Claude开头')
  expect((await mainWindow.locator('.comparison-preview-module').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-preview-group-id')))).at(-1)).toBe(firstGroupId)
  await mainWindow.locator(`[data-preview-group-id="${firstGroupId}"]`).getByRole('button', { name: /拖动组/ }).dragTo(mainWindow.locator('.comparison-preview-insert-line').first())
  await keepCurrentIfPrompted()
  expect((await mainWindow.locator('.comparison-preview-module').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-preview-group-id'))))[0]).toBe(firstGroupId)

  await mainWindow.getByRole('button', { name: '纯净' }).click()
  const cleanEditor = mainWindow.getByLabel('纯净文案编辑区')
  const exactWhitespace = '  保留开头\n\n\n保留结尾  '
  await cleanEditor.fill(exactWhitespace)
  await cleanEditor.blur()
  const cleanSyncPrompt = mainWindow.getByRole('alertdialog', { name: '确认对照整理同步' })
  await expect(cleanSyncPrompt).toBeVisible()
  await cleanSyncPrompt.getByRole('button', { name: '用整理结果覆盖' }).click()
  await mainWindow.getByRole('button', { name: '组模式' }).click()
  await expect(mainWindow.getByLabel('组1当前文案')).toHaveValue('  保留开头')
  await expect(mainWindow.getByLabel('组2当前文案')).toHaveValue('\n保留结尾  ')
  await mainWindow.getByRole('button', { name: '纯净' }).click()
  await expect(mainWindow.getByLabel('纯净文案编辑区')).toHaveValue(exactWhitespace)
  await mainWindow.getByRole('button', { name: '组模式' }).click()

  await mainWindow.getByLabel('组1当前文案').dispatchEvent('contextmenu', { bubbles: true, clientX: 920, clientY: 320 })
  await mainWindow.getByRole('menuitem', { name: /从当前文案删除/ }).click()
  await keepCurrentIfPrompted()
  await expect(mainWindow.getByRole('button', { name: '撤销删除' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '撤销删除' }).click()
  await keepCurrentIfPrompted()
  await expect(mainWindow.getByLabel('组1当前文案')).toHaveValue('  保留开头')
  expect(pageErrors).toEqual([])
})

test('R17右键后才进入临时合并，取消后不残留选择控件', async () => {
  const headers = mainWindow.locator('[data-comparison-group-id] > header')
  await headers.nth(0).dispatchEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 260 })
  await mainWindow.getByRole('menuitem', { name: /加入合并/ }).click()
  await expect(mainWindow.locator('.comparison-merge-bar')).toContainText('已选1组')
  await mainWindow.getByRole('tab', { name: /^组2/ }).click()
  await expect(mainWindow.locator('.comparison-merge-bar')).toContainText('已选2组')
  await mainWindow.getByRole('tab', { name: /^组2/ }).click()
  await expect(mainWindow.locator('.comparison-merge-bar')).toContainText('已选1组')
  await mainWindow.getByRole('tab', { name: /^组2/ }).click()
  await mainWindow.locator('.comparison-merge-bar').getByRole('button', { name: '取消' }).click()
  await expect(mainWindow.locator('.comparison-merge-bar')).toHaveCount(0)
  await expect(mainWindow.locator('.comparison-merge-check')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

// eslint-disable-next-line no-empty-pattern
test('R17四套主题与窄窗口保持紧凑可读且不丢当前文案', async ({}, testInfo) => {
  const combinations = [
    { visualStyle: 'warm', theme: 'light' },
    { visualStyle: 'warm', theme: 'dark' },
    { visualStyle: 'feishu', theme: 'light' },
    { visualStyle: 'feishu', theme: 'dark' }
  ] as const
  await mainWindow.getByLabel('组1当前文案').fill('四主题都要保留这段文案')
  await mainWindow.getByLabel('组1当前文案').blur()
  for (const combination of combinations) {
    await mainWindow.evaluate(async (preferences) => {
      const api = (globalThis as unknown as { creatorOS: { setPreferences(input: typeof preferences): Promise<unknown> } }).creatorOS
      await api.setPreferences(preferences)
    }, combination)
    await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', combination.visualStyle)
    await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', combination.theme)
    await expect(mainWindow.getByLabel('组1当前文案')).toHaveValue('四主题都要保留这段文案')
    if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
      await mainWindow.screenshot({ path: testInfo.outputPath(`r17-${combination.visualStyle}-${combination.theme}.png`) })
    }
  }
  const nativeWindow = await electronApp.browserWindow(mainWindow)
  await nativeWindow.evaluate((window) => window.setSize(680, 720))
  await expect.poll(() => mainWindow.evaluate(() => {
    const browserDocument = (globalThis as unknown as {
      document: { documentElement: { scrollWidth: number; clientWidth: number } }
    }).document
    return browserDocument.documentElement.scrollWidth - browserDocument.documentElement.clientWidth
  })).toBeLessThanOrEqual(1)
  await expect(mainWindow.getByRole('tablist', { name: '成稿对比窄窗栏目' })).toBeVisible()
  await expect(mainWindow.getByLabel('组1当前文案')).toHaveValue('四主题都要保留这段文案')
  const edgeEditor = mainWindow.getByLabel('组1当前文案')
  await edgeEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 676, clientY: 716 })
  const edgeMenu = mainWindow.locator('.comparison-context-menu')
  await expect(edgeMenu).toBeVisible()
  expect(await edgeMenu.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const viewport = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return rect.left >= 8 && rect.top >= 8 && rect.right <= viewport.innerWidth - 8 && rect.bottom <= viewport.innerHeight - 8
  })).toBe(true)
  await mainWindow.getByRole('menuitem', { name: /添加备注/ }).click()
  const edgeNote = mainWindow.getByRole('dialog', { name: '文案组备注' })
  expect(await edgeNote.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const viewport = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return rect.left >= 8 && rect.top >= 8 && rect.right <= viewport.innerWidth - 8 && rect.bottom <= viewport.innerHeight - 8
  })).toBe(true)
  await edgeNote.getByRole('button', { name: '取消' }).click()
  const paragraph = mainWindow.locator('[data-comparison-side="codex"] .comparison-paragraph').first()
  await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 676, clientY: 716 })
  const moveDetails = mainWindow.locator('.comparison-context-menu details').filter({ hasText: '移动到组' })
  await moveDetails.locator('summary').click()
  const moveSubmenu = moveDetails.locator(':scope > div')
  await expect(moveSubmenu).toBeVisible()
  expect(await moveSubmenu.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const viewport = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return rect.left >= 8 && rect.top >= 8 && rect.right <= viewport.innerWidth - 8 && rect.bottom <= viewport.innerHeight - 8
  })).toBe(true)
  expect(pageErrors).toEqual([])
})
