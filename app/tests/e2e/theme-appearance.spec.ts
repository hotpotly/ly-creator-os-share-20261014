import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_USER_DATA: userDataPath,
      CREATOR_OS_TEST_BACKGROUND: '1'
    }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.waitForFunction(() => (globalThis as unknown as Partial<BrowserGlobals>).creatorOS?.getWorkspace !== undefined)
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

async function setWindowSize(width: number, height: number): Promise<void> {
  const nativeWindow = await electronApp.browserWindow(mainWindow)
  await nativeWindow.evaluate((window, size) => window.setSize(size.width, size.height), { width, height })
}

async function go(hash: string): Promise<void> {
  await mainWindow.evaluate((nextHash) => { (globalThis as unknown as BrowserGlobals).location.hash = nextHash }, hash)
  await mainWindow.waitForTimeout(80)
}

async function criticalGeometry(): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  return mainWindow.evaluate(() => {
    const browserDocument = (globalThis as unknown as {
      document: {
        querySelector(selector: string): { getBoundingClientRect(): { x: number; y: number; width: number; height: number } } | null
      }
    }).document
    const selectors = ['.sidebar', '.workspace-tabbar', '.topbar', '.page-header', '.home-split', '.home-column-primary', '.home-column-secondary']
    return Object.fromEntries(selectors.map((selector) => {
      const node = browserDocument.querySelector(selector)
      if (!node) throw new Error(`缺少几何检查节点：${selector}`)
      const box = node.getBoundingClientRect()
      return [selector, { x: box.x, y: box.y, width: box.width, height: box.height }]
    }))
  })
}

test('两套风格与明暗模式独立持久化，切换不改变页面几何，并同步快速记录窗口', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await setWindowSize(1440, 900)
  await go('#/home')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', 'warm')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'light')
  const warmGeometry = await criticalGeometry()
  await mainWindow.screenshot({ path: testInfo.outputPath('home-warm-light-1440x900.png') })

  await go('#/settings')
  await expect(mainWindow.getByRole('heading', { name: '设置' })).toBeVisible()
  await mainWindow.getByRole('radio', { name: /飞书式专业工作台/ }).click()
  await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'light')
  await mainWindow.screenshot({ path: testInfo.outputPath('settings-feishu-light-1440x900.png') })

  await go('#/home')
  const feishuGeometry = await criticalGeometry()
  for (const [selector, warmBox] of Object.entries(warmGeometry)) {
    const feishuBox = feishuGeometry[selector]
    expect(feishuBox, selector).toBeDefined()
    if (!feishuBox) continue
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(warmBox[key] - feishuBox[key]), `${selector}.${key}`).toBeLessThanOrEqual(1)
    }
  }
  await mainWindow.screenshot({ path: testInfo.outputPath('home-feishu-light-1440x900.png') })

  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).creatorOS.openCapture())
  const captureWindow = await capturePromise
  await captureWindow.waitForLoadState('domcontentloaded')
  await expect(captureWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
  await expect(captureWindow.locator('html')).toHaveAttribute('data-theme', 'light')
  await captureWindow.getByLabel('记录内容').fill('切换主题时不要丢失尚未保存的内容')

  await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
  await expect(captureWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(captureWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
  await expect(captureWindow.getByLabel('记录内容')).toHaveValue('切换主题时不要丢失尚未保存的内容')
  await mainWindow.screenshot({ path: testInfo.outputPath('home-feishu-dark-1440x900.png') })
  await captureWindow.screenshot({ path: testInfo.outputPath('capture-feishu-dark-420x300.png') })
  await captureWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).creatorOS.closeCapture())

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS.getWorkspace()
    return { theme: workspace.preferences.theme, visualStyle: workspace.preferences.visualStyle }
  })).toEqual({ theme: 'dark', visualStyle: 'feishu' })
})

test('飞书式主题在核心页面与窄窗口保持可读且没有横向溢出', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.evaluate(async () => { await (globalThis as unknown as BrowserGlobals).creatorOS.setPreferences({ visualStyle: 'feishu', theme: 'light' }) })
  await setWindowSize(1440, 900)
  const pages = [
    { hash: '#/ideas', name: 'ideas' },
    { hash: '#/topics', name: 'topics' },
    { hash: '#/projects', name: 'projects' },
    { hash: '#/schedule', name: 'schedule' },
    { hash: '#/reports', name: 'reports' }
  ]
  for (const page of pages) {
    await go(page.hash)
    await expect(mainWindow.locator('html')).toHaveAttribute('data-visual-style', 'feishu')
    await mainWindow.screenshot({ path: testInfo.outputPath(`${page.name}-feishu-light-1440x900.png`) })
  }

  await setWindowSize(680, 720)
  await go('#/settings')
  await expect(mainWindow.locator('.appearance-settings')).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(() => {
    const documentElement = (globalThis as unknown as {
      document: { documentElement: { scrollWidth: number; clientWidth: number } }
    }).document.documentElement
    const documentWidth = documentElement.scrollWidth
    const viewportWidth = documentElement.clientWidth
    return documentWidth - viewportWidth
  })).toBeLessThanOrEqual(1)
  await mainWindow.screenshot({ path: testInfo.outputPath('settings-feishu-light-680x720.png') })
})
