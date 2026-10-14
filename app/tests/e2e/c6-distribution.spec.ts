import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication
let mainWindow: Page
let userDataPath = ''
let videoPath = ''

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  videoPath = testInfo.outputPath('01-体验结论.mp4')
  rmSync(userDataPath, { recursive: true, force: true })
  mkdirSync(testInfo.outputDir, { recursive: true })
  writeFileSync(videoPath, Buffer.from([0, 0, 0, 20]))
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: userDataPath }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getAppInfo().then((info) => info.name) ?? '')).toBe('LY Creator OS')
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('批量分发从独立来源建立批次并按片段关联文件、账号和完成状态', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.savePublishingAccount({ platform: 'B站', accountName: '主账号', positioning: '长视频' })
    await api.savePublishingAccount({ platform: '小红书', accountName: '数码账号', positioning: '数码体验' })
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/tools'
  })
  await mainWindow.getByRole('button', { name: '管理分发批次' }).click()
  await expect(mainWindow.getByRole('heading', { name: '批量分发' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '新建批次' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建分发批次' })
  await dialog.getByLabel('来源').selectOption('manual_script')
  await dialog.getByLabel('来源内容').fill('第一段讲真实体验结论。第二段给出使用建议。')
  await dialog.getByLabel('批次名称').fill('AI浏览器拆短')
  await dialog.getByRole('button', { name: '创建批次' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'AI浏览器拆短' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: 'AI分析片段' })).toBeVisible()

  await mainWindow.getByRole('button', { name: '手动新增片段' }).click()
  await mainWindow.getByLabel('片段1主题').fill('真实体验结论')
  await mainWindow.getByLabel('片段1摘要').fill('按内容边界手动裁剪这一段。')
  await mainWindow.getByRole('button', { name: '保存片段' }).click()
  await expect(mainWindow.getByLabel('片段1主题')).toHaveValue('真实体验结论')
  await expect(mainWindow.getByText('B站不会出现在拆短分发中')).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: /B站·主账号/ })).toHaveCount(0)

  await mainWindow.locator('input[type=file]').setInputFiles(videoPath)
  await expect(mainWindow.getByText('01-体验结论.mp4')).toBeVisible()
  await mainWindow.getByRole('button', { name: /小红书·数码账号/ }).click()
  await expect(mainWindow.locator('.distribution-target-statuses').getByText('小红书·数码账号', { exact: true })).toBeVisible()
  await mainWindow.getByRole('button', { name: '已发布' }).click()
  await expect(mainWindow.getByRole('button', { name: '重新打开' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '重新打开' }).click()
  await expect(mainWindow.getByRole('button', { name: '完成批次' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '待发布' }).click()
  await mainWindow.getByRole('button', { name: '完成批次' }).click()
  const confirmation = mainWindow.getByRole('alertdialog', { name: '确认完成分发批次' })
  await expect(confirmation).toContainText('还有1个平台账号')
  await confirmation.getByRole('button', { name: '仍然完成' }).click()
  await expect(mainWindow.getByRole('button', { name: '重新打开' })).toBeVisible()
})
