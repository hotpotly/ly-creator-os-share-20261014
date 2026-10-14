import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication
let mainWindow: Page
let pageErrors: string[]
let userDataPath: string

async function launchApp(): Promise<void> {
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_TEST_R17_READY: '1', CREATOR_OS_TEST_R18_REWRITE: '1', CREATOR_OS_TEST_R16B_REWRITE: '1', CREATOR_OS_TEST_R18_REWRITE_DELAY_MS: '250', CREATOR_OS_TEST_R18_MARKDOWN: '1', CREATOR_OS_USER_DATA: userDataPath }
  })
  mainWindow = await electronApp.firstWindow()
  mainWindow.on('pageerror', (error) => pageErrors.push(error.message))
  await mainWindow.waitForLoadState('domcontentloaded')
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  pageErrors = []
  await launchApp()
})

test.afterEach(async () => { await electronApp?.close().catch(() => undefined) })

test('R18拍摄待办和剪辑备忘录可保存、取消完成并在重启后恢复', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/production' })
  await expect(mainWindow.getByRole('heading', { name: 'AI视频制作' })).toBeVisible()
  await mainWindow.getByPlaceholder('例如：周六去公园拍外景').fill('去公园拍外景')
  await mainWindow.getByRole('button', { name: '添加' }).click()
  const item = mainWindow.locator('.shooting-items > div').first()
  await expect(item).toBeVisible()
  await expect(item.locator('input')).toHaveValue('去公园拍外景')
  await item.getByRole('button', { name: '标记完成' }).click()
  await expect(item).toHaveClass(/completed/)
  await item.getByRole('button', { name: '取消完成' }).click()
  await expect(item).not.toHaveClass(/completed/)
  await mainWindow.getByRole('textbox', { name: '剪辑备忘录' }).fill('开头节奏加快\n保留环境声')
  await mainWindow.getByRole('button', { name: '保存', exact: true }).click()
  await expect(mainWindow.getByRole('status')).toContainText('剪辑备忘录已保存')
  await electronApp.close()
  await launchApp()
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/production' })
  await expect(mainWindow.locator('.shooting-items input').first()).toHaveValue('去公园拍外景')
  await expect(mainWindow.getByRole('textbox', { name: '剪辑备忘录' })).toContainText('开头节奏加快')
  await expect(mainWindow.getByRole('textbox', { name: '剪辑备忘录' })).toContainText('保留环境声')
  expect(pageErrors).toEqual([])
})

test('R18版本对比支持自由粘贴，空AI栏不显示定位轨道', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await expect(mainWindow.locator('.conversation-locator')).toHaveCount(0)
  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await mainWindow.getByLabel('粘贴稿名称').fill('自由对比稿')
  await mainWindow.getByLabel('粘贴对比文字').fill('# 新标题\n\n**重点段落**\n\n新增结尾')
  await mainWindow.getByRole('button', { name: /加入[AB]/ }).click()
  await expect(mainWindow.locator('.version-compare-picker > article').filter({ hasText: '自由对比稿' })).toBeVisible()
  await expect(mainWindow.locator('.version-working-grid')).toContainText('新标题')
  await expect(mainWindow.locator('.version-working-grid')).not.toContainText('# 新标题')
  await mainWindow.locator('.version-file-drop').evaluate((element) => {
    const browser = globalThis as unknown as {
      DataTransfer: new () => { items: { add(file: unknown): void } }
      File: new (bits: string[], name: string, options: { type: string }) => unknown
      DragEvent: new (type: string, options: object) => Parameters<typeof element.dispatchEvent>[0]
    }
    const dataTransfer = new browser.DataTransfer()
    dataTransfer.items.add(new browser.File(['纯文本也能加入对比'], '版本拖入.txt', { type: 'text/plain' }))
    element.dispatchEvent(new browser.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
  await expect(mainWindow.locator('.version-compare-picker')).toContainText('版本拖入.txt')
  expect(pageErrors).toEqual([])
})

test('R18双稿组导航、颜色控件和空组提示保持轻量', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  const activeTab = mainWindow.locator('.comparison-group-tabs button.active').first()
  await expect(activeTab).toBeVisible()
  expect(await activeTab.evaluate((element) => element.getBoundingClientRect().width)).toBe(25)
  expect(await activeTab.evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element, '::after').display)).toBe('none')
  await mainWindow.setViewportSize({ width: 1080, height: 720 })
  expect(await activeTab.evaluate((element) => element.getBoundingClientRect().width)).toBe(25)
  expect(await mainWindow.locator('.comparison-group-tabs button:not(.active)').first().evaluate((element) => element.getBoundingClientRect().width)).toBe(22)
  const decidedTab = mainWindow.locator('.comparison-group-tabs button.decided').first()
  if (await decidedTab.count()) {
    const checkBox = await decidedTab.locator('svg').boundingBox()
    const nextBox = await decidedTab.locator('xpath=following-sibling::button[1]').boundingBox()
    if (checkBox && nextBox) expect(checkBox.x + checkBox.width).toBeLessThan(nextBox.x)
  }
  await mainWindow.getByLabel('着色模式').focus()
  expect(await mainWindow.locator('.comparison-compact-select').evaluate((element) => element.matches(':focus-within'))).toBe(true)
  await expect(mainWindow.getByText('这一组暂时留空')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('R18重新生成先显示候选结果，不会静默替换当前文案', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  const current = mainWindow.getByLabel('组1当前文案')
  const before = await current.inputValue()
  await mainWindow.locator('[data-comparison-group-id]').first().locator('[data-comparison-side="codex"] .comparison-paragraph').first().dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 })
  await mainWindow.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const request = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await request.getByRole('button', { name: '重新生成' }).click()
  await request.getByRole('button', { name: '生成候选' }).click()
  const result = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(result).toBeVisible()
  expect(await result.evaluate((element) => element.contains(element.ownerDocument.activeElement))).toBe(true)
  await mainWindow.keyboard.press('Shift+Tab')
  await expect(result.getByRole('button', { name: '替换' })).toBeFocused()
  await expect(result).toContainText('重新生成的')
  await expect(current).toHaveValue(before)
  await expect(result.getByRole('button', { name: '保留候选' })).toBeVisible()
  await expect(result.getByRole('button', { name: '追加' })).toBeVisible()
  await expect(result.getByRole('button', { name: '替换' })).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await expect(result).toHaveCount(0)
  await mainWindow.locator('[data-comparison-group-id]').first().locator('[data-comparison-side="codex"] .comparison-paragraph').first().dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 })
  await mainWindow.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  await request.getByRole('button', { name: '重新生成' }).click()
  await request.getByRole('button', { name: '生成候选' }).click()
  await expect(result).toBeVisible()
  await result.getByRole('button', { name: '替换' }).click()
  await expect(current).toContainText('重新生成的')
  expect(pageErrors).toEqual([])
})

test('R18连续改写按任务排队展示，后一项不会覆盖前一项', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  const groups = mainWindow.locator('[data-comparison-group-id]')
  for (const index of [0, 1]) {
    await groups.nth(index).locator('[data-comparison-side="codex"] .comparison-paragraph').first().dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 + index * 20 })
    await mainWindow.getByRole('menuitem', { name: /按具体要求修改/ }).click()
    const request = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
    await request.getByRole('button', { name: '重新生成' }).click()
    await request.getByRole('button', { name: '生成候选' }).click()
  }
  const result = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(result).toBeVisible()
  await expect(result).toContainText('还有1项')
  await result.getByRole('button', { name: '保留候选' }).click()
  await expect(result).toBeVisible()
  await expect(result).not.toContainText('还有1项')
  await result.getByRole('button', { name: '保留候选' }).click()
  await expect(result).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('R18 Markdown重复词划选会精确改写鼠标选中的位置', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  const paragraph = mainWindow.locator('[data-comparison-group-id]').first().locator('[data-comparison-side="codex"] .comparison-paragraph').first()
  await paragraph.locator('strong').evaluate((element) => {
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    const selection = element.ownerDocument.defaultView?.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 })
  await mainWindow.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const request = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await request.getByRole('button', { name: '重新生成' }).click()
  await request.getByRole('button', { name: '生成候选' }).click()
  const result = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(result).toContainText('重复短语与重新生成的重复短语')
  await expect(result).not.toContainText('# ')
  await result.getByRole('button', { name: '保留候选' }).click()
  expect(pageErrors).toEqual([])
})

test('R18文案入口直达工作台模式、定稿独立成栏，外部写作整卡可直接拖入文件', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/script' })
  const builtIn = mainWindow.locator('.built-in-writing-entry')
  await expect(builtIn).toBeVisible()
  await expect(builtIn.getByRole('group', { name: '文案工作台主视图' }).getByRole('button')).toHaveText(['对话模式', '对照筛选', '版本对比'])
  await expect(builtIn.getByRole('group', { name: '文案对照类型' }).getByRole('button')).toHaveText(['成稿对比', '素材成稿'])
  const finalEntry = mainWindow.locator('.script-final-entry')
  await expect(finalEntry).toBeVisible()
  await expect(builtIn.locator('.script-final-entry')).toHaveCount(0)
  const external = mainWindow.locator('.external-writing-entry')
  await expect(external).toContainText('拖入文件直接导入')
  await mainWindow.screenshot({ path: testInfo.outputPath('r18-script-entry.png') })
  await external.evaluate((element) => {
    const browser = globalThis as unknown as {
      DataTransfer: new () => { items: { add(file: unknown): void } }
      File: new (bits: string[], name: string, options: { type: string }) => unknown
      DragEvent: new (type: string, options: object) => Parameters<typeof element.dispatchEvent>[0]
    }
    const dataTransfer = new browser.DataTransfer()
    dataTransfer.items.add(new browser.File(['# 拖入文案\n\n正文内容'], '拖入测试.md', { type: 'text/markdown' }))
    element.dispatchEvent(new browser.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
  await expect(mainWindow.locator('.external-draft-list')).toContainText('拖入测试.md')
  await builtIn.getByRole('button', { name: '素材成稿' }).click()
  await expect(mainWindow.getByRole('tab', { name: '对照筛选' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('tab', { name: '素材成稿' })).toHaveAttribute('aria-selected', 'true')
  expect(pageErrors).toEqual([])
})
