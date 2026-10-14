import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
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
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.length)).toBeGreaterThan(2)
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

test('R15对话模式、对照筛选和版本对比共用一份可恢复文案状态', async () => {
  const viewTabs = mainWindow.getByRole('tablist', { name: '文案工作台视图' })
  await expect(viewTabs.getByRole('tab')).toHaveText(['对话模式', '对照筛选', '版本对比'])
  await expect(viewTabs.getByRole('tab', { name: '对话模式' })).toHaveAttribute('aria-selected', 'true')
  const aiCountSwitch = mainWindow.getByRole('group', { name: '对话AI数量' })
  await expect(aiCountSwitch.getByRole('button', { name: '2个AI' })).toHaveClass(/active/)

  const claudeFreeform = mainWindow.getByLabel('Claude自由稿自由编辑区')
  await expect(claudeFreeform).toBeVisible()
  await claudeFreeform.fill('Claude免费账户粘贴稿\n第二段')
  await claudeFreeform.press('Meta+S')
  await expect.poll(() => mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getDraftComparisonWorkspace('ai-browser')).claudeContent
  })).toBe('Claude免费账户粘贴稿\n第二段')

  await aiCountSwitch.getByRole('button', { name: '1个AI' }).click()
  const singleProviderSwitch = mainWindow.getByRole('group', { name: '单AI选择' })
  await expect(singleProviderSwitch).toBeVisible()
  await singleProviderSwitch.getByRole('button', { name: 'Claude' }).click()
  await expect(mainWindow.getByLabel('Claude自由稿自由编辑区')).toHaveValue('Claude免费账户粘贴稿\n第二段')
  await singleProviderSwitch.getByRole('button', { name: 'Codex' }).click()
  await expect(mainWindow.locator('.codex-pane')).toBeVisible()
  await expect(mainWindow.locator('.current-script-pane')).toBeVisible()
  await mainWindow.getByRole('separator', { name: '调整单AI和当前文案宽度' }).press('ArrowRight')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchMergedSplit)).toBe(69)

  await viewTabs.getByRole('tab', { name: '对照筛选' }).click()
  await expect(mainWindow.getByLabel('Claude稿编辑区')).toHaveValue('Claude免费账户粘贴稿\n第二段')
  await mainWindow.getByLabel('Codex稿编辑区').fill('Codex稿第一段\nCodex稿第二段')
  await mainWindow.getByRole('separator', { name: '调整Codex稿和Claude稿宽度' }).press('ArrowRight')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchComparisonSplit)).toBe(52)
  const contextToggle = mainWindow.getByRole('button', { name: '项目上下文：不包含' })
  await contextToggle.click()
  await expect(mainWindow.getByRole('button', { name: '项目上下文：包含' })).toHaveAttribute('aria-pressed', 'true')
  await mainWindow.getByLabel('Codex稿整稿生成要求').fill('保留当前未保存的组内要求')
  await viewTabs.getByRole('tab', { name: '对话模式' }).click()
  await mainWindow.getByRole('group', { name: '对话AI数量' }).getByRole('button', { name: '2个AI' }).click()
  await viewTabs.getByRole('tab', { name: '对照筛选' }).click()
  await expect(mainWindow.getByLabel('Codex稿整稿生成要求')).toHaveValue('保留当前未保存的组内要求')
  await mainWindow.getByRole('button', { name: '保存双稿' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('双稿已保存')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getDraftComparisonWorkspace('ai-browser')
    return { claude: workspace.claudeContent, codex: workspace.codexContent }
  })).toEqual({ claude: 'Claude免费账户粘贴稿\n第二段', codex: 'Codex稿第一段\nCodex稿第二段' })

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('tab', { name: '对照筛选' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByLabel('Claude稿编辑区')).toHaveValue('Claude免费账户粘贴稿\n第二段')
  await expect(mainWindow.getByLabel('Codex稿编辑区')).toHaveValue('Codex稿第一段\nCodex稿第二段')
})

test('R7c对照筛选在Provider不可用时保留稿件且不允许盲目开始', async () => {
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await mainWindow.getByLabel('Claude稿编辑区').fill('Claude待对照内容')
  await mainWindow.getByLabel('Codex稿编辑区').fill('Codex待对照内容')
  const start = mainWindow.getByRole('button', { name: '开始语义对照' })
  const capabilities = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).providerCapabilities)
  if (!capabilities.some((capability) => capability.available)) await expect(start).toBeDisabled()
  await expect(mainWindow.getByText('每次更新都会保留为历史对照；任务运行期间仍可继续写稿。')).toBeVisible()
})

test('R7c窄窗成稿对比保留稳定当前文案Tab并按项目记住', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.setViewportSize({ width: 820, height: 760 })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  const narrowTabs = mainWindow.getByRole('tablist', { name: '成稿对比窄窗栏目' })
  await expect(narrowTabs).toBeVisible()
  await expect(narrowTabs.getByRole('tab')).toHaveText(['Codex稿', 'Claude稿', '当前文案'])
  await narrowTabs.getByRole('tab', { name: 'Codex稿' }).click()
  await expect(mainWindow.getByLabel('Codex稿编辑区')).toBeVisible()
  await expect(mainWindow.getByLabel('Claude稿编辑区')).toBeHidden()
  await expect(mainWindow.locator('[data-comparison-side]:visible')).not.toHaveCount(0)
  await expect(narrowTabs.getByRole('tab', { name: 'Codex稿' })).toHaveAttribute('aria-controls', 'draft-comparison-panel')
  await expect(mainWindow.locator('#draft-comparison-panel')).toHaveAttribute('aria-labelledby', 'draft-comparison-codex-tab')
  for (const tab of await narrowTabs.getByRole('tab').all()) {
    const controls = await tab.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    await expect(mainWindow.locator(`#${controls!}`)).toHaveCount(1)
  }
  const currentTab = narrowTabs.getByRole('tab', { name: '当前文案' })
  await currentTab.click()
  await expect(mainWindow.locator('.draft-current-script-layout .current-script-pane')).toBeVisible()
  await expect(mainWindow.getByRole('tabpanel')).toHaveCount(1)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r16a-draft-current-narrow.png') })
  const currentScroll = mainWindow.locator('.draft-current-script-layout .editor-scroll')
  await currentScroll.evaluate((element) => {
    element.querySelector('.tiptap')?.setAttribute('style', 'padding-bottom:1000px')
    element.scrollTop = 123
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchDraftCurrentScrollTop)).toBe(123)
  await narrowTabs.getByRole('tab', { name: 'Codex稿' }).click()
  await currentTab.click()
  await expect.poll(() => currentScroll.evaluate((element) => element.scrollTop)).toBe(123)
  await currentTab.press('ArrowLeft')
  await expect(narrowTabs.getByRole('tab', { name: 'Claude稿' })).toBeFocused()
  await currentTab.click()

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('tab', { name: '对照筛选' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('tablist', { name: '成稿对比窄窗栏目' }).getByRole('tab', { name: '当前文案' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.locator('.draft-current-script-layout .current-script-pane')).toBeVisible()
  const restoredTabs = mainWindow.getByRole('tablist', { name: '成稿对比窄窗栏目' })
  const restoredScroll = mainWindow.locator('.draft-current-script-layout .editor-scroll')
  await restoredScroll.evaluate((element) => {
    element.querySelector('.tiptap')?.setAttribute('style', 'padding-bottom:1000px')
  })
  await restoredTabs.getByRole('tab', { name: 'Codex稿' }).click()
  await restoredTabs.getByRole('tab', { name: '当前文案' }).click()
  await expect.poll(() => restoredScroll.evaluate((element) => element.scrollTop)).toBe(123)
})

// Playwright requires the first fixture argument to use object destructuring.
// eslint-disable-next-line no-empty-pattern
test('R15当前文案支持撤销重做、隐蔽标记、命名保存和多版本对比且编辑后不白屏', async ({}, testInfo) => {
  const editor = mainWindow.locator('.current-script-pane .tiptap')
  await expect(editor).toBeVisible()
  const shell = mainWindow.locator('.script-workbench-shell')
  const initialTheme = await mainWindow.locator('html').getAttribute('data-theme')

  await editor.click()
  await mainWindow.keyboard.press('Meta+A')
  await mainWindow.keyboard.insertText('第一版开头\n\n第一版结尾')
  await expect(editor).toContainText('第一版开头')
  await mainWindow.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(editor).not.toContainText('第一版开头')
  await mainWindow.getByRole('button', { name: '重做', exact: true }).click()
  await expect(editor).toContainText('第一版开头')

  await editor.click()
  await mainWindow.keyboard.press('Meta+ArrowUp')
  await mainWindow.keyboard.down('Shift')
  await mainWindow.keyboard.press('ArrowRight')
  await mainWindow.keyboard.press('ArrowRight')
  await mainWindow.keyboard.press('ArrowRight')
  await mainWindow.keyboard.up('Shift')
  await editor.dispatchEvent('contextmenu', { bubbles: true, clientX: 520, clientY: 320 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: /添加备注/ }).click()
  const markerDialog = mainWindow.getByRole('dialog', { name: '工作台标记' })
  await markerDialog.getByLabel('备注（可单独保存）').fill('开头语气之后再确认')
  await markerDialog.getByRole('button', { name: '保存备注并添加旗标' }).click()
  await expect(mainWindow.getByRole('button', { name: '查看文案标记' })).toContainText('1')

  await mainWindow.getByLabel('本次版本名称').fill('结构精简版')
  await mainWindow.getByRole('button', { name: '保存当前文案' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('结构精简版已保存')
  await expect(shell).toBeVisible()
  await expect(editor).toContainText('第一版开头')
  expect(await mainWindow.locator('html').getAttribute('data-theme')).toBe(initialTheme)

  await editor.click()
  await mainWindow.keyboard.press('Meta+A')
  await mainWindow.keyboard.insertText('第二版开头\n\n新增中段\n\n第二版结尾')
  await mainWindow.getByLabel('本次版本名称').fill('口播增强版')
  await mainWindow.getByRole('button', { name: '保存当前文案' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('口播增强版已保存')
  await expect(shell).toBeVisible()
  await expect(editor).toContainText('新增中段')
  const conversationTopbarBox = await mainWindow.locator('.workbench-topbar').boundingBox()
  expect(conversationTopbarBox?.y ?? -1).toBeGreaterThanOrEqual(0)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r15-conversation.png') })

  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await expect(mainWindow.getByRole('button', { name: '返回项目' })).toBeVisible()
  const topbarBox = await mainWindow.locator('.workbench-topbar').boundingBox()
  expect(topbarBox?.y ?? -1).toBeGreaterThanOrEqual(0)
  await expect(mainWindow.locator('.version-source-select').filter({ hasText: '结构精简版' })).toBeVisible()
  await expect(mainWindow.locator('.version-source-select').filter({ hasText: '口播增强版' })).toBeVisible()
  await expect(mainWindow.locator('.version-working-grid')).toContainText('新增中段')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r15-version-compare.png') })

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS?.setPreferences({ visualStyle: 'feishu', theme: 'dark' })
  })
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
  await expect.poll(() => mainWindow.evaluate(() => {
    const documentElement = (globalThis as unknown as {
      document: { documentElement: { scrollWidth: number; clientWidth: number } }
    }).document.documentElement
    return documentElement.scrollWidth - documentElement.clientWidth
  })).toBeLessThanOrEqual(1)
  await expect(mainWindow.locator('.version-working-grid')).toContainText('新增中段')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r15-version-compare-feishu-dark.png') })
})
