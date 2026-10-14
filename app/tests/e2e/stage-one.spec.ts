import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { href: string; hash: string }
  navigator: { permissions: { query(descriptor: { name: string }): Promise<{ state: string }> } }
}

let electronApp: ElectronApplication
let mainWindow: Page
const expectedVisibleWindowCount = process.env.CREATOR_OS_TEST_BACKGROUND === '1' ? 0 : 1

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => localStorage.clear())
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow).toHaveTitle('LY Creator OS')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const browser = globalThis as unknown as BrowserGlobals
    return browser.creatorOS?.getAppInfo().then((info) => info.name) ?? ''
  })).toBe('LY Creator OS')
})

test.afterEach(async () => {
  await electronApp.close()
})

test('Android局域网接收自动发现Mac并用六位数字批准设备', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await expect(mainWindow.getByRole('heading', { name: '设置', level: 1 })).toBeVisible()
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '数据与设备' }).click()
  const section = mainWindow.locator('.mobile-sync-settings')
  await expect(section.getByText('Android快速记录')).toBeVisible()
  await expect(section.getByText('已关闭')).toBeVisible()
  const initial = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getMobileSyncStatus())
  expect(initial).toMatchObject({ enabled: false, running: false })
  if (!initial.securityAvailable) {
    await expect(section.getByRole('button', { name: '开启局域网接收' })).toBeDisabled()
    return
  }
  await section.getByRole('button', { name: '开启局域网接收' }).click()
  await expect(section.getByText('正在接收')).toBeVisible()
  const active = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getMobileSyncStatus())
  expect(active).toMatchObject({ enabled: true, running: true, advertised: true, protocolVersion: 2, pendingPairings: [], port: expect.any(Number) })
  await expect(section.getByText('Bonjour已广播 · 安全协议v2')).toBeVisible()
  await expect(section.getByText('自动发现的Mac', { exact: false })).toBeVisible()

  const { publicKey } = generateKeyPairSync('x25519')
  const clientPublicKey = Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32).toString('base64')
  const startResponse = await fetch(`http://127.0.0.1:${active.port}/v2/pair/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      protocolVersion: 2, deviceName: 'Pixel E2E', clientPublicKey,
      clientChallenge: randomBytes(32).toString('base64'), capabilities: ['capture_text'], upgradeDeviceId: null
    })
  })
  expect(startResponse.status).toBe(200)
  expect(await startResponse.json()).not.toHaveProperty('secret')
  await expect(section.getByText('待批准设备')).toBeVisible()
  await expect(section.locator('.mobile-device-approval > strong')).toHaveText(/^\d{3} \d{3}$/)
  await section.getByRole('button', { name: '数字一致，信任设备' }).click()
  await expect(section.getByText('Pixel E2E')).toBeVisible()
  await expect(section.getByText('安全连接·v2')).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/mobile-sync-settings-review.png'), fullPage: true })
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(680, 720) })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/mobile-sync-settings-review-narrow.png'), fullPage: true })
  }
  await section.getByRole('button', { name: '停止接收' }).click()
  await expect(section.getByText('已关闭')).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getMobileSyncStatus())).toMatchObject({ enabled: false, running: false, advertised: false, pendingPairings: [] })
})

test('main window renders approved home structure and schedule interactions', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await expect(mainWindow.getByRole('heading', { name: '7月18日，星期六' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '首页' })).toHaveAttribute('aria-current', 'page')
  await expect(mainWindow.getByRole('heading', { name: '本周排期' })).toBeVisible()
  await expect(mainWindow.locator('.week-day.is-today .schedule-pill')).toHaveCount(3)
  await expect(mainWindow.locator('.week-day.is-today .week-day-head time')).toHaveAttribute('aria-current', 'date')
  await expect(mainWindow.locator('.week-day .schedule-pill .lucide-calendar-days')).toHaveCount(0)
  await expect.poll(() => mainWindow.locator('.week-grid').evaluate((grid) => {
    const today = grid.querySelector('.week-day.is-today')
    const other = grid.querySelector('.week-day:not(.is-today)')
    const todayDate = today?.querySelector('.week-day-head time')
    const otherDate = other?.querySelector('.week-day-head time')
    if (!today || !other || !todayDate) return null
    const style = (globalThis as unknown as { getComputedStyle(node: unknown, pseudo?: string): { backgroundColor: string; content: string; fontWeight: string; height: string; width: string } }).getComputedStyle
    const dot = style(todayDate, '::after')
    return {
      neutralToday: style(today).backgroundColor === style(other).backgroundColor,
      dateWeight: Number(style(todayDate).fontWeight),
      otherDateWeight: otherDate ? Number(style(otherDate).fontWeight) : null,
      dot: { content: dot.content, width: dot.width, height: dot.height }
    }
  })).toEqual({ neutralToday: true, dateWeight: 750, otherDateWeight: 560, dot: { content: '""', width: '4px', height: '4px' } })
  await mainWindow.screenshot({ path: testInfo.outputPath('home-week.png'), animations: 'disabled' })
  await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
  await expect.poll(() => mainWindow.locator('.week-empty').first().evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string } }).getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await mainWindow.getByRole('button', { name: '切换到浅色模式' }).click()

  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  await expect(mainWindow.getByTestId('month-grid')).toBeVisible()
  await expect(mainWindow.locator('.month-day')).toHaveCount(35)
  await expect.poll(() => mainWindow.getByTestId('month-grid').evaluate((grid) => {
    const today = grid.querySelector('.month-day.is-today')
    const other = grid.querySelector('.month-day:not(.muted):not(.is-today)')
    const todayDate = today?.querySelector('time')
    const otherDate = other?.querySelector('time')
    if (!today || !other || !todayDate || !otherDate) return null
    const style = (globalThis as unknown as { getComputedStyle(node: unknown, pseudo?: string): { backgroundColor: string; content: string; fontWeight: string; height: string; width: string } }).getComputedStyle
    const dot = style(todayDate, '::after')
    return {
      neutralToday: style(today).backgroundColor === style(other).backgroundColor,
      dateWeight: Number(style(todayDate).fontWeight),
      otherDateWeight: Number(style(otherDate).fontWeight),
      dot: { content: dot.content, width: dot.width, height: dot.height }
    }
  })).toEqual({ neutralToday: true, dateWeight: 750, otherDateWeight: 560, dot: { content: '""', width: '4px', height: '4px' } })
  await expect(mainWindow.locator('.month-day.is-today time')).toHaveAttribute('aria-current', 'date')
  const aiCalendarPill = mainWindow.getByTestId('month-grid').getByRole('button', { name: /AI浏览器入门教学/ }).first()
  await expect.poll(() => aiCalendarPill.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }).getComputedStyle(element).backgroundColor)).toBe('rgb(214, 234, 252)')
  await expect.poll(() => aiCalendarPill.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }).getComputedStyle(element).color)).toBe('rgb(44, 86, 121)')
  await expect(mainWindow.getByRole('button', { name: /iOS 27第一周体验·18:00大纲截止·截止日/ })).toBeVisible()
  const waitingPill = mainWindow.getByRole('button', { name: /无线麦克风商单·客户初审文案·等待/ })
  await expect(waitingPill).toBeVisible()
  await expect.poll(() => waitingPill.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }).getComputedStyle(element).borderTopWidth)).toBe('1px')
  await expect.poll(() => waitingPill.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }).getComputedStyle(element).borderTopStyle)).toBe('dashed')
  await mainWindow.getByRole('button', { name: '＋ 新建排期', exact: true }).click()
  const createDialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await expect(createDialog).toBeVisible()
  await createDialog.getByLabel('开始日期', { exact: true }).fill('2026-07-02')
  await createDialog.getByLabel('结束日期', { exact: true }).fill('2026-07-02')
  await expect(createDialog.getByText('2026-07-02', { exact: true })).toBeVisible()
  await createDialog.getByRole('button', { name: '关闭' }).click()
  await mainWindow.getByRole('button', { name: '下个月' }).click()
  await expect(mainWindow.getByText('2026年8月', { exact: true })).toBeVisible()
  await expect(mainWindow.locator('.month-day')).toHaveCount(42)
  await mainWindow.getByRole('button', { name: '今天', exact: true }).click()
  await expect(mainWindow.getByText('2026年7月', { exact: true })).toBeVisible()

  await mainWindow.screenshot({ path: testInfo.outputPath('home-month.png'), animations: 'disabled' })
})

test('resizable divider supports keyboard reset', async () => {
  const divider = mainWindow.getByRole('separator', { name: '调整首页左右栏宽度' })
  await divider.focus()
  await divider.press('ArrowLeft')
  await expect(divider).toHaveAttribute('aria-valuenow', '61')
  await divider.press('Home')
  await expect(divider).toHaveAttribute('aria-valuenow', '63')
})

test('首页右栏可以拖到最窄，确认项标题仍保持可读', async () => {
  const nativeWindow = await electronApp.browserWindow(mainWindow)
  await nativeWindow.evaluate((window) => window.setSize(1440, 900))
  const divider = mainWindow.getByRole('separator', { name: '调整首页左右栏宽度' })
  const confirmationTitle = mainWindow.locator('.confirm-row b').first()
  const isClipped = (): Promise<boolean> => confirmationTitle.evaluate((element) => {
    const node = element as unknown as { clientWidth: number; scrollWidth: number }
    return node.scrollWidth > node.clientWidth + 1
  })

  await expect(mainWindow.getByRole('heading', { name: '自动化状态' })).toHaveCount(0)
  await expect.poll(async () => (await mainWindow.locator('.home-column-secondary').boundingBox())!.width).toBeGreaterThan(320)
  expect(await isClipped()).toBe(false)

  await divider.focus()
  for (let index = 0; index < 20; index += 1) await divider.press('ArrowRight')

  const narrow = (await mainWindow.locator('.home-column-secondary').boundingBox())!
  expect(narrow.width).toBeLessThanOrEqual(241)
  expect(await isClipped()).toBe(false)

  await divider.press('Home')
  await expect(divider).toHaveAttribute('aria-valuenow', '63')
})

test('首页日历单击排期只展开详情浮层，双击才进入项目', async () => {
  const deadlinePill = mainWindow.locator('.week-day.is-today').getByRole('button', { name: /iOS 27第一周体验·18:00大纲截止·截止日/ })
  await deadlinePill.click()

  const detail = mainWindow.getByRole('dialog', { name: '排期详情：大纲截止' })
  await expect(detail).toBeVisible()
  await expect(deadlinePill).toHaveAttribute('aria-pressed', 'true')
  await expect(deadlinePill).toHaveAttribute('aria-expanded', 'true')
  await expect(mainWindow.getByRole('heading', { name: '本周排期' })).toBeVisible()
  await expect(detail.getByRole('heading', { level: 3 })).toHaveText('大纲截止')
  await expect(detail.getByText('iOS 27第一周体验')).toBeVisible()
  await expect(detail.getByText('截止日')).toBeVisible()
  await expect(detail.getByText('正常')).toBeVisible()
  await expect(detail.getByRole('button', { name: '删除排期，快捷键Backspace' })).toBeVisible()
  const timeButton = detail.getByRole('button', { name: '修改大纲截止的时间' })
  await expect(timeButton).not.toContainText(':00:00')
  await timeButton.click()
  const timeEditor = mainWindow.getByRole('dialog', { name: '修改大纲截止的时间' })
  await expect(timeEditor.getByRole('grid', { name: '排期日期日历' })).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/feedback-schedule-time-editor.png') })
  }
  await mainWindow.keyboard.press('Escape')
  await expect(timeEditor).toBeHidden()
  await expect(detail).toBeVisible()

  await deadlinePill.click()
  await expect(detail).toBeHidden()
  await expect(deadlinePill).toHaveAttribute('aria-pressed', 'false')
  await expect(deadlinePill).toHaveAttribute('aria-expanded', 'false')

  await deadlinePill.click()
  await expect(detail).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await expect(detail).toBeHidden()

  await deadlinePill.click()
  await expect(detail).toBeVisible()
  await mainWindow.getByRole('heading', { name: '本周排期' }).click()
  await expect(detail).toBeHidden()

  const nativeWindow = await electronApp.browserWindow(mainWindow)
  for (const width of [1280, 760]) {
    await nativeWindow.evaluate((window, size) => window.setSize(size, 760), width)
    const lastColumnPill = mainWindow.locator('.week-day').last().locator('.schedule-pill').first()
    await lastColumnPill.click()
    const lastDetail = mainWindow.getByRole('dialog', { name: '排期详情：拍摄' })
    await expect(lastDetail).toBeVisible()
    const [box, viewport] = await Promise.all([
      lastDetail.boundingBox(),
      mainWindow.evaluate(() => ({ height: (globalThis as unknown as { innerHeight: number }).innerHeight, width: (globalThis as unknown as { innerWidth: number }).innerWidth }))
    ])
    expect(box!.x).toBeGreaterThanOrEqual(7)
    expect(box!.y).toBeGreaterThanOrEqual(7)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 7)
    await mainWindow.keyboard.press('Escape')
    await expect(lastDetail).toBeHidden()
  }

  await nativeWindow.evaluate((window) => window.setSize(1440, 900))
  await deadlinePill.dblclick()
  await expect(mainWindow.getByRole('heading', { name: 'iOS 27第一周体验' })).toBeVisible()
  await expect(mainWindow.getByRole('dialog', { name: '排期详情：大纲截止' })).toBeHidden()
})

test('首页选题与灵感摘要使用整行深链且没有行尾箭头', async () => {
  const summary = mainWindow.getByRole('region', { name: '选题与灵感' })
  await expect(summary.getByRole('button')).toHaveCount(3)
  await expect(summary.locator('.lucide-arrow-right')).toHaveCount(0)
  await summary.getByRole('button', { name: /新记录/ }).click()
  await expect(mainWindow.getByRole('heading', { name: '灵感库', level: 1 })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: /收件箱/ })).toHaveClass(/active/)
})

test('quick capture opens as a separate secure window', async () => {
  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.getByRole('button', { name: '快速记录' }).click()
  const capture = await capturePromise
  await capture.waitForLoadState('domcontentloaded')
  await expect(capture.getByRole('heading', { name: '快速记录' })).toBeVisible()
  await expect(capture).toHaveTitle('快速记录')
  await expect(capture.getByLabel('记录内容')).toBeFocused()
  await expect(capture.getByRole('button', { name: '保存' })).toBeDisabled()
  await expect(capture.getByText('⌘S保存')).toBeVisible()
  await capture.getByLabel('记录内容').fill('记录一条E2E灵感')
  await capture.getByLabel('记录内容').press('Enter')
  await capture.getByLabel('记录内容').pressSequentially('第二行')
  await expect(capture.getByLabel('记录内容')).toHaveValue('记录一条E2E灵感\n第二行')
  await capture.getByLabel('记录内容').press('Meta+s')
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === '快速记录')?.isVisible() ?? false)).toBe(false)
  await expect.poll(() => mainWindow.evaluate(async () => {
    const browser = globalThis as unknown as BrowserGlobals
    const workspace = await browser.creatorOS?.getWorkspace()
    return workspace?.captures.some((item) => item.originalContent === '记录一条E2E灵感\n第二行') ?? false
  })).toBe(true)
  expect(await electronApp.windows()).toHaveLength(2)
  const captureGeometry = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === '快速记录')
    if (!window) return null
    return { outer: window.getBounds(), content: window.getContentBounds() }
  })
  expect(captureGeometry).not.toBeNull()
  expect(captureGeometry?.outer.width).toBe(captureGeometry?.content.width)
  expect(captureGeometry?.outer.height).toBe(captureGeometry?.content.height)

  const captureEscalationError = await capture.evaluate(async () => {
    const browser = globalThis as unknown as BrowserGlobals
    try {
      await browser.creatorOS?.openCapture()
      return ''
    } catch (error) {
      return String(error)
    }
  })
  expect(captureEscalationError).toContain('越权窗口')
  expect(await electronApp.windows()).toHaveLength(2)

  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length)).toBe(expectedVisibleWindowCount)
  await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
  await mainWindow.getByRole('button', { name: '快速记录' }).click()
  await expect.poll(() => capture.evaluate(() => (globalThis as unknown as { document: { documentElement: { dataset: { theme?: string } } } }).document.documentElement.dataset.theme)).toBe('dark')
})

test('window roles, navigation and Chromium permissions are denied by default', async () => {
  const closeEscalationError = await mainWindow.evaluate(async () => {
    const browser = globalThis as unknown as BrowserGlobals
    try {
      await browser.creatorOS?.closeCapture()
      return ''
    } catch (error) {
      return String(error)
    }
  })
  expect(closeEscalationError).toContain('越权窗口')

  const originalUrl = mainWindow.url()
  await mainWindow.evaluate(() => {
    const browser = globalThis as unknown as BrowserGlobals
    browser.location.href = 'file:///tmp/untrusted-renderer.html'
  })
  await mainWindow.waitForTimeout(100)
  expect(mainWindow.url()).toBe(originalUrl)

  const permission = await mainWindow.evaluate(async () => {
    const browser = globalThis as unknown as BrowserGlobals
    const result = await browser.navigator.permissions.query({ name: 'geolocation' })
    return result.state
  })
  expect(permission).toBe('denied')
})

test('run tasks drawer manages visibility and Escape', async () => {
  await mainWindow.getByRole('button', { name: /运行任务/ }).click()
  const drawer = mainWindow.getByRole('dialog', { name: '运行任务' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: '刷新状态' })).toHaveCount(2)
  const dismissFailed = drawer.getByRole('button', { name: '关闭实测表格整理' })
  await expect(dismissFailed).toContainText('关闭')
  await dismissFailed.click()
  await expect(dismissFailed).toHaveCount(0)
  await drawer.getByRole('button', { name: '关闭运行任务' }).focus()
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.getByRole('dialog', { name: '运行任务' })).toHaveCount(0)
})

test('local controls and project creation entry remain functional', async () => {
  await mainWindow.getByRole('button', { name: '新建项目' }).click()
  await expect(mainWindow.getByRole('dialog', { name: '新建项目' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '关闭新建项目' }).click()

  const pinned = mainWindow.getByRole('button', { name: '常用' })
  await expect(pinned).toHaveAttribute('aria-expanded', 'true')
  await pinned.click()
  await expect(pinned).toHaveAttribute('aria-expanded', 'false')
  await expect(mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' }).getByRole('button', { name: /iOS 27第一周体验/ })).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  await mainWindow.locator('.calendar-filterbar button[data-project-id="ssd"]').click()
  await expect(mainWindow.locator('.calendar-filterbar button[data-project-id="ssd"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(mainWindow.getByTestId('month-grid').locator('.schedule-pill')).toHaveCount(5)
})
