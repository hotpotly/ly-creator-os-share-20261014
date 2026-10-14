import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

let electronApp: ElectronApplication
let mainWindow: Page
let destination = ''

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  destination = testInfo.outputPath('nas-root')
  await Promise.all([
    rm(userDataPath, { recursive: true, force: true }),
    rm(destination, { recursive: true, force: true })
  ])
  await mkdir(destination, { recursive: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_USER_DATA: userDataPath,
      CREATOR_OS_TEST_NAS_ROOT: destination
    }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('NAS设置不回显真实路径，项目冻结预览后才写入并可看到完成记录', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '数据与设备' }).click()
  const settings = mainWindow.locator('.nas-settings')
  await expect(settings.getByText('NAS归档', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '选择目录' }).click()
  await expect(settings.getByText('已连接')).toBeVisible()
  await expect(settings.getByText('尚未在所选NAS', { exact: false })).toBeVisible()
  await expect(settings.getByText(destination, { exact: true })).toHaveCount(0)

  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/project/ai-browser/overview' })
  await mainWindow.getByRole('button', { name: '项目操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '归档到NAS' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '归档到NAS' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '检查归档内容' }).click()
  await expect(dialog.getByText(/确认后固定编号|编号已固定/)).toBeVisible()
  expect(await readdir(destination)).not.toContain('长视频成片')

  await dialog.getByRole('button', { name: '确认并开始归档' }).click()
  await expect(dialog.locator('.nas-archive-runs em.committed')).toHaveText('已完成', { timeout: 15_000 })
  const categories = await readdir(destination)
  expect(categories).toContain('长视频成片')
  const years = await readdir(join(destination, '长视频成片'))
  expect(years[0]).toMatch(/^@\d{2}年$/)
  const folders = await readdir(join(destination, '长视频成片', years[0]!))
  const manifest = await readFile(join(destination, '长视频成片', years[0]!, folders[0]!, 'manifest.json'), 'utf8')
  expect(manifest).not.toContain(destination)
  expect(JSON.parse(manifest)).toMatchObject({ version: 1, projectId: 'ai-browser' })
})

test('设置页可创建一次手动封闭备份', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '数据与设备' }).click()
  const backupRow = mainWindow.locator('.settings-list article').filter({ hasText: '本地数据库与备份' })
  await backupRow.getByRole('button', { name: '立即备份' }).click()
  await expect(backupRow).toContainText('已备份')
})
