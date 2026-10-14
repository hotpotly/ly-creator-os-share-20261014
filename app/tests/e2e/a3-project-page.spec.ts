import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

let electronApp: ElectronApplication
let mainWindow: Page

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
  await mainWindow.setViewportSize({ width: 1440, height: 900 })
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow).toHaveTitle('LY Creator OS')
})

test.afterEach(async () => {
  await electronApp.close()
})

test('项目Header、概览入口与阶段Tab保持分工，阶段完成和右键时间继续可用', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/project/ios/overview' })
  await expect(mainWindow.getByRole('heading', { name: 'iOS 27第一周体验' })).toBeVisible()
  await expect(mainWindow.locator('.project-overview-nav')).toHaveAttribute('aria-current', 'page')
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '概览', exact: true })).toHaveCount(0)

  const quickCapture = mainWindow.getByRole('button', { name: '快速记录到项目' })
  await expect(quickCapture).toBeVisible()
  await expect.poll(() => quickCapture.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })).toEqual({ width: 30, height: 30 })

  await mainWindow.getByRole('button', { name: '重命名项目iOS 27第一周体验' }).click()
  await expect(mainWindow.getByLabel('重命名项目')).toBeFocused()
  await mainWindow.getByLabel('重命名项目').press('Escape')

  const outlineTab = mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true })
  await outlineTab.click()
  const complete = mainWindow.getByRole('button', { name: '标记当前阶段完成', exact: true })
  await expect(complete).toBeVisible()
  await complete.click()
  await expect(mainWindow.getByRole('button', { name: '取消当前阶段完成', exact: true })).toBeVisible()
  await expect(outlineTab.locator('.project-tab-state')).toHaveClass(/done/)
  await outlineTab.click({ button: 'right' })
  await expect(mainWindow.getByRole('dialog', { name: '修改大纲阶段时间' })).toBeVisible()
})

test('商单大纲与文案中的反馈入口保存为甲方反馈并同步回项目', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/project/sponsor/outline' })
  await expect(mainWindow.getByText('甲方反馈', { exact: true })).toBeVisible()
  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.getByRole('button', { name: '记录反馈' }).click()
  const capture = await capturePromise
  await expect(capture.getByRole('heading', { name: '记录甲方反馈' })).toBeVisible()
  await capture.getByLabel('反馈内容').fill('甲方希望第二段先讲真实体验')
  await capture.getByRole('button', { name: '保存', exact: true }).click()

  await expect.poll(() => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as { creatorOS: CreatorOSApi }).creatorOS
    return (await api.getWorkspace()).captures.some((item) =>
      item.primaryProjectId === 'sponsor'
      && item.captureKind === 'client_feedback'
      && item.originalContent === '甲方希望第二段先讲真实体验'
    )
  })).toBe(true)
  await expect(mainWindow.getByText('甲方希望第二段先讲真实体验')).toBeVisible()
})

test('右侧详情宽度在灵感库和排期共用、支持键盘调整并持久化', async () => {
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  const inspirationDivider = mainWindow.getByRole('separator', { name: '调整右侧详情宽度' })
  await expect(inspirationDivider).toHaveAttribute('aria-valuenow', '310')
  await inspirationDivider.press('ArrowLeft')
  await expect(inspirationDivider).toHaveAttribute('aria-valuenow', '326')
  await expect.poll(() => mainWindow.locator('.inspiration-detail').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(326)

  await mainWindow.getByRole('button', { name: '排期' }).click()
  const scheduleDivider = mainWindow.getByRole('separator', { name: '调整右侧详情宽度' })
  await expect(scheduleDivider).toHaveAttribute('aria-valuenow', '326')
  await expect.poll(() => mainWindow.locator('.schedule-inspector').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(326)

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('separator', { name: '调整右侧详情宽度' })).toHaveAttribute('aria-valuenow', '326')
  await mainWindow.getByRole('separator', { name: '调整右侧详情宽度' }).press('Home')
  await expect(mainWindow.locator('.schedule-inspector')).toHaveCSS('width', '310px')

  await mainWindow.setViewportSize({ width: 901, height: 760 })
  await expect(mainWindow.getByRole('separator', { name: '调整右侧详情宽度' })).toBeHidden()
  await expect(mainWindow.locator('.schedule-inspector')).toBeHidden()
  await expect.poll(() => mainWindow.locator('.schedule-workspace').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const scheduleTrigger = mainWindow.locator('.schedule-pill').first()
  await scheduleTrigger.click()
  await expect(mainWindow.getByRole('dialog', { name: '排期详情' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '关闭右侧详情' })).toBeFocused()
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.locator('.schedule-inspector')).toBeHidden()
  await expect(scheduleTrigger).toBeFocused()

  await mainWindow.setViewportSize({ width: 900, height: 760 })
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await expect(mainWindow.getByRole('separator', { name: '调整右侧详情宽度' })).toBeHidden()
  await expect(mainWindow.locator('.inspiration-detail')).toBeHidden()
  const inspirationTrigger = mainWindow.locator('.inspiration-record-main').first()
  await inspirationTrigger.click()
  await expect(mainWindow.getByRole('dialog')).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '关闭右侧详情' })).toBeFocused()
  await mainWindow.getByRole('button', { name: '关闭右侧详情' }).click()
  await expect(mainWindow.locator('.inspiration-detail')).toBeHidden()
  await expect(inspirationTrigger).toBeFocused()
})
