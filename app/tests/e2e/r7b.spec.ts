import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

interface BrowserGlobals {
  creatorOS?: { getWorkspace(): Promise<{ projects: unknown[] }> }
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

test('R16a双AI宽窗隐藏状态按项目恢复且当前文案始终保留', async () => {
  await mainWindow.getByRole('button', { name: '更多文案操作' }).click()
  await mainWindow.getByRole('button', { name: '隐藏Claude栏' }).click()
  await expect(mainWindow.locator('#conversation-claude-panel')).toBeHidden()
  await expect(mainWindow.locator('#conversation-codex-panel')).toBeVisible()
  await expect(mainWindow.locator('.conversation-workbench-layout .current-script-pane')).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as { creatorOS: { getWorkbenchPreferences(projectId: string): Promise<{ workbenchHiddenProviders: string[] }> } }).creatorOS.getWorkbenchPreferences('ai-browser')
  ).workbenchHiddenProviders)).toEqual(['claude'])
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.locator('#conversation-claude-panel')).toBeHidden()
  await expect(mainWindow.locator('#conversation-codex-panel')).toBeVisible()
  await expect(mainWindow.locator('.conversation-workbench-layout .current-script-pane')).toBeVisible()
})

test('R16a防抖滚动快速切项目只写回原项目且素材双栏互不覆盖', async () => {
  await mainWindow.setViewportSize({ width: 1440, height: 900 })
  const codexHistory = mainWindow.locator('#conversation-codex-panel .script-conversation-history')
  await codexHistory.evaluate((element) => {
    element.style.paddingBottom = '900px'
    element.scrollTop = 41
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ios' })
  await expect(mainWindow.locator('.workbench-title-and-view > div:first-child > span')).not.toHaveText('AI浏览器入门教学')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as { creatorOS: { getWorkbenchPreferences(projectId: string): Promise<{ workbenchConversationScrollTops: { codex: number } }> } }).creatorOS
    return {
      old: (await api.getWorkbenchPreferences('ai-browser')).workbenchConversationScrollTops.codex,
      next: (await api.getWorkbenchPreferences('ios')).workbenchConversationScrollTops.codex
    }
  })).toEqual({ old: 41, next: 0 })

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.locator('.workbench-title-and-view > div:first-child > span')).toHaveText('AI浏览器入门教学')
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await mainWindow.getByRole('tab', { name: '素材成稿' }).click()
  const sourceBody = mainWindow.locator('.script-material-source-body')
  const aiBody = mainWindow.locator('.script-material-ai-body')
  await expect(sourceBody).toBeVisible()
  await expect(aiBody).toBeVisible()
  const sourceScrollTop = await sourceBody.evaluate((element) => {
    element.style.paddingBottom = '900px'
    element.scrollTop = 51
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return element.scrollTop
  })
  const aiScrollTop = await aiBody.evaluate((element) => {
    element.style.paddingBottom = '900px'
    element.scrollTop = 61
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return element.scrollTop
  })
  expect(sourceScrollTop).toBeGreaterThan(0)
  expect(aiScrollTop).toBeGreaterThan(0)
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ios' })
  await expect(mainWindow.locator('.workbench-title-and-view > div:first-child > span')).not.toHaveText('AI浏览器入门教学')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as { creatorOS: { getWorkbenchPreferences(projectId: string): Promise<{ workbenchMaterialScrollTops: { source: number; ai: number } }> } }).creatorOS
    return {
      old: (await api.getWorkbenchPreferences('ai-browser')).workbenchMaterialScrollTops,
      next: (await api.getWorkbenchPreferences('ios')).workbenchMaterialScrollTops
    }
  })).toEqual({ old: { source: sourceScrollTop, ai: aiScrollTop, current: 0 }, next: { source: 0, ai: 0, current: 0 } })
})

test('R7b⌘J只打开当前AI栏的紧凑定位列表并由Esc优先关闭', async () => {
  await mainWindow.getByRole('group', { name: '对话AI数量' }).getByRole('button', { name: '1个AI' }).click()
  await mainWindow.getByRole('group', { name: '单AI选择' }).getByRole('button', { name: 'Codex' }).click()
  await mainWindow.keyboard.press('Meta+J')

  const locator = mainWindow.getByRole('dialog', { name: 'Codex快速定位列表' })
  await expect(locator).toBeVisible()
  await expect(locator).toContainText('当前AI栏还没有可定位的消息')
  await mainWindow.keyboard.press('ArrowDown')
  await mainWindow.keyboard.press('ArrowUp')
  await expect(locator).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await expect(locator).toBeHidden()
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
})

test('R7b窄窗Tab保留当前AI选择，自由稿不会伪装成消息定位', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.setViewportSize({ width: 820, height: 760 })
  const modelTabs = mainWindow.getByRole('tablist', { name: '对话模式窄窗栏目' })
  await expect(modelTabs.getByRole('tab')).toHaveText(['Claude', 'Codex', '当前文案'])
  for (const tab of await modelTabs.getByRole('tab').all()) {
    const controls = await tab.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    await expect(mainWindow.locator(`#${controls!}`)).toHaveCount(1)
  }
  await modelTabs.getByRole('tab', { name: 'Codex' }).click()
  await expect(mainWindow.getByRole('tabpanel')).toHaveCount(1)
  await expect(mainWindow.locator('#conversation-codex-panel')).toHaveAttribute('aria-labelledby', 'conversation-codex-panel-tab')
  const codexHistory = mainWindow.locator('#conversation-codex-panel .script-conversation-history')
  await codexHistory.evaluate((element) => {
    element.style.paddingBottom = '900px'
    element.scrollTop = 67
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as { creatorOS: { getWorkbenchPreferences(projectId: string): Promise<{ workbenchConversationScrollTops: { codex: number } }> } }).creatorOS.getWorkbenchPreferences('ai-browser')
  ).workbenchConversationScrollTops.codex)).toBe(67)
  await mainWindow.keyboard.press('Meta+J')
  await expect(mainWindow.getByRole('dialog', { name: 'Codex快速定位列表' })).toBeVisible()
  await mainWindow.keyboard.press('Escape')

  const currentTab = modelTabs.getByRole('tab', { name: '当前文案' })
  await currentTab.click()
  await expect(mainWindow.locator('.current-script-pane')).toBeVisible()
  await expect(mainWindow.locator('.conversation-pane-wrap:visible')).toHaveCount(0)
  await expect(mainWindow.locator('#current-script-panel')).toHaveAttribute('aria-labelledby', 'current-script-panel-tab')
  const backBox = await mainWindow.getByRole('button', { name: '返回项目' }).boundingBox()
  const viewport = mainWindow.viewportSize()
  expect(backBox && viewport && backBox.x >= 0 && backBox.x + backBox.width <= viewport.width).toBe(true)
  await expect.poll(() => mainWindow.evaluate(() => {
    const browser = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth
  })).toBe(true)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r16a-conversation-current-narrow.png') })
  const currentScroll = mainWindow.locator('#current-script-panel .editor-scroll')
  await currentScroll.evaluate((element) => {
    element.querySelector('.tiptap')?.setAttribute('style', 'padding-bottom:900px')
    element.scrollTop = 91
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as { creatorOS: { getWorkbenchPreferences(projectId: string): Promise<{ workbenchConversationScrollTops: { current: number } }> } }).creatorOS.getWorkbenchPreferences('ai-browser')
  ).workbenchConversationScrollTops.current)).toBe(91)
  await modelTabs.getByRole('tab', { name: 'Codex' }).click()
  await expect.poll(() => codexHistory.evaluate((element) => element.scrollTop)).toBe(67)
  await currentTab.click()
  await expect.poll(() => currentScroll.evaluate((element) => element.scrollTop)).toBe(91)
  await currentTab.press('Home')
  await expect(modelTabs.getByRole('tab', { name: 'Claude' })).toBeFocused()
  await modelTabs.getByRole('tab', { name: 'Claude' }).click()
  await mainWindow.keyboard.press('Meta+J')
  await expect(mainWindow.getByRole('status')).toContainText('Claude自由稿没有消息定位')
  await expect(mainWindow.getByRole('dialog', { name: /快速定位列表/ })).toHaveCount(0)
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('tablist', { name: '对话模式窄窗栏目' }).getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true')
})
