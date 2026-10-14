import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi }
let app: ElectronApplication, page: Page
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow()
  await expect.poll(() => page.evaluate(async () => !!(await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  await page.evaluate(() => { location.hash = '#/reviews?kind=monthly&anchor=2026-09-27' })
  await expect(page.getByRole('textbox', { name: '复盘正文', exact: true })).toBeVisible()
})
test.afterEach(async () => { await app?.close() })
test('manual panels are editor-local, compact when focused, and keyboard accessible', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const body = page.getByRole('textbox', { name: '复盘正文', exact: true })
  const root = body.locator('xpath=ancestor::div[contains(@class,"review-rich-editor")]')
  const life = page.getByRole('textbox', { name: '生活记录新内容', exact: true })
  const checkin = page.getByRole('textbox', { name: '打卡记录新内容', exact: true })
  for (const editor of [body, life, checkin]) {
    const container = editor.locator('xpath=ancestor::div[contains(@class,"review-rich-editor")]')
    const initialHeight = await container.evaluate(el => el.getBoundingClientRect().height)
    await editor.focus()
    await expect(container.getByRole('toolbar')).toBeHidden()
    expect(await container.evaluate(el => el.getBoundingClientRect().height)).toBe(initialHeight)
    await container.getByRole('button', { name: '展开样式面板' }).focus()
    await page.keyboard.press('Enter')
    await expect(container.getByRole('toolbar')).toBeVisible()
    await expect(editor).toBeFocused()
    await expect(container.getByRole('button', { name: '收起样式面板' })).toHaveAttribute('aria-expanded', 'true')
    await container.getByRole('button', { name: '加粗', exact: true }).focus()
    await page.keyboard.press('Meta+Shift+m')
    await expect(container.getByRole('toolbar')).toBeHidden()
    await expect(editor).toBeFocused()
    await editor.press('Control+Shift+m')
    await expect(container.getByRole('toolbar')).toBeVisible()
    for (const other of [body, life, checkin].filter(item => item !== editor)) {
      await expect(other.locator('xpath=ancestor::div[contains(@class,"review-rich-editor")]').getByRole('toolbar')).toBeHidden()
    }
    await container.getByRole('button', { name: '收起样式面板' }).click()
  }
  for (const width of [680, 1280]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 900), width)
    for (const theme of ['light', 'dark']) for (const style of ['warm', 'feishu']) {
      await page.evaluate(([t, s]) => { document.documentElement.dataset.theme = t; document.documentElement.dataset.visualStyle = s }, [theme, style])
      await body.focus()
      await expect(root.getByRole('toolbar')).toBeHidden()
      await body.press('Meta+Shift+m')
      await expect(root.getByRole('toolbar')).toBeVisible()
      expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      expect(await page.locator('.review-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      if (width === 1280 && style === 'feishu' && theme === 'dark') await root.screenshot({ path: info.outputPath('styles-open-dark.png') })
      await body.press('Meta+Shift+m')
      if (width === 1280 && style === 'feishu' && theme === 'light') await page.locator('.review-columns-writing').screenshot({ path: info.outputPath('styles-closed-light.png') })
    }
  }
  await body.fill('隐藏面板列表')
  await body.press('Meta+Shift+8')
  await expect(body.locator('ul')).toContainText('隐藏面板列表')
  await expect(root.getByRole('toolbar')).toBeHidden()
  await body.press('Meta+s')
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeDisabled()
  await page.reload()
  await expect(body.locator('ul')).toContainText('隐藏面板列表')
  await body.focus()
  await expect(root.getByRole('toolbar')).toBeHidden()
})
