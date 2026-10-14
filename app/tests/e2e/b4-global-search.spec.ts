import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
  innerWidth: number
  innerHeight: number
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
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.projects.length) ?? 0)).toBeGreaterThan(0)
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('Cmd+K支持键盘搜索、拼音首字母和项目跳转', async () => {
  await mainWindow.keyboard.press('Meta+k')
  const dialog = mainWindow.getByRole('dialog', { name: '全局搜索' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('footer')).toBeVisible()
  const dialogBox = await dialog.boundingBox()
  const viewportHeight = await mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).innerHeight)
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewportHeight - 8)
  const input = dialog.getByRole('combobox')
  await expect(input).toBeFocused()
  await expect(dialog.getByText('最近打开的项目')).toBeVisible()
  await mainWindow.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('option').last()).toBeFocused()
  await mainWindow.keyboard.press('Tab')
  await expect(input).toBeFocused()
  await expect(mainWindow.locator('.app-main')).toHaveAttribute('inert', '')

  await input.fill('aillq')
  const projectResult = dialog.getByRole('option', { name: /AI浏览器入门教学/ })
  await expect(projectResult).toBeVisible()
  await projectResult.hover()
  await expect(projectResult).toHaveAttribute('aria-selected', 'true')
  await mainWindow.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(mainWindow.getByRole('heading', { name: 'AI浏览器入门教学' })).toBeVisible()

  await mainWindow.keyboard.press('Meta+k')
  await expect(dialog).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await mainWindow.getByRole('button', { name: '打开全局搜索' }).click()
  await expect(dialog).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.getByRole('button', { name: '打开全局搜索' })).toBeFocused()
})

test('搜索结果可跳到具体选题、灵感和文案版本', async () => {
  const exactScript = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS
    if (!api) throw new Error('CreatorOS API unavailable')
    return api.saveScript('ai-browser', 'final', '<h2>B4唯一命中文案</h2><p>搜索后必须打开这一份具体定稿。</p>')
  })
  await mainWindow.keyboard.press('Meta+k')
  let dialog = mainWindow.getByRole('dialog', { name: '全局搜索' })
  await dialog.getByRole('combobox').fill('第一周体验')
  await dialog.getByRole('heading', { name: /^选题/ }).locator('..').getByRole('option', { name: /iOS 27第一周体验/ }).click()
  await expect(mainWindow.getByRole('heading', { name: '选题管理' })).toBeVisible()
  await expect(mainWindow.locator('tr.search-highlighted')).toContainText('iOS 27第一周体验')

  await mainWindow.keyboard.press('Meta+k')
  dialog = mainWindow.getByRole('dialog', { name: '全局搜索' })
  await dialog.getByRole('combobox').fill('三步演示')
  await dialog.getByRole('option', { name: /AI浏览器的来源核对/ }).click()
  await expect(mainWindow.getByRole('heading', { name: '灵感库' })).toBeVisible()
  await expect(mainWindow.locator('.inspiration-record.active')).toContainText('AI浏览器的来源核对')

  await mainWindow.keyboard.press('Meta+k')
  dialog = mainWindow.getByRole('dialog', { name: '全局搜索' })
  await dialog.getByRole('combobox').fill('B4唯一命中文案')
  await dialog.getByRole('option', { name: /AI浏览器入门教学.*定稿文案/ }).click()
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).location.hash)).toContain(`draft=${exactScript.id}`)
  const currentEditor = mainWindow.locator('.current-script-pane .ProseMirror')
  await expect(currentEditor).toContainText('搜索后必须打开这一份具体定稿')
  // Search opens the exact immutable historical snapshot; R16 no longer edits versions in place.
  await expect(mainWindow.getByText(/历史快照：.*只读/)).toBeVisible()
  await expect(currentEditor).toHaveAttribute('contenteditable', 'false')
  await expect(mainWindow.getByRole('button', { name: '恢复为当前版本', exact: true })).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async (versionId) => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser', false)
    return project?.latestVersions.find((version) => version.id === versionId)?.content ?? ''
  }, exactScript.id)).toContain('搜索后必须打开这一份具体定稿')
  await mainWindow.keyboard.press('Meta+k')
  await expect(mainWindow.getByRole('dialog', { name: '全局搜索' })).toBeVisible()
})

test('窄窗口仍可用Cmd+K打开纯搜索对话框', async () => {
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(680, 720) })
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).innerWidth)).toBeLessThanOrEqual(700)
  await expect(mainWindow.getByRole('button', { name: '打开全局搜索' })).toBeHidden()
  await mainWindow.keyboard.press('Meta+k')
  const dialog = mainWindow.getByRole('dialog', { name: '全局搜索' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill('aillq')
  await expect(dialog.getByRole('option', { name: /AI浏览器入门教学 AI · 内容项目/ })).toBeVisible()
})
