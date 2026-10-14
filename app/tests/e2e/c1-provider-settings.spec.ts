import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

let electronApp: ElectronApplication
let mainWindow: Page
let userDataPath = ''

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/settings' })
  await expect(mainWindow.getByRole('heading', { name: '设置' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: 'AI与发布' }).click()
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('外部API在设置中安全保存、改名、选择默认与重启恢复，Renderer不回显key', async () => {
  const section = mainWindow.locator('.provider-settings')
  await expect(section.getByText('AI与模型', { exact: true })).toBeVisible()
  await section.getByRole('button', { name: '添加API' }).click()
  await section.getByLabel('类型').selectOption('deepseek_api')
  await section.getByLabel('显示名称').fill('我的选题DeepSeek')
  await section.getByLabel('模型ID').fill('deepseek-chat')
  await section.getByLabel('API key').fill('sk-c1-e2e-secret')
  await section.getByRole('button', { name: /安全保存/ }).click()
  await expect(section.locator('.provider-config-row b').filter({ hasText: '我的选题DeepSeek' })).toBeVisible()
  await expect(section.getByText('key已安全保存')).toBeVisible()
  await expect(section.getByText('sk-c1-e2e-secret')).toHaveCount(0)

  await section.getByLabel('默认AI').selectOption({ label: '我的选题DeepSeek' })
  await expect(section.getByLabel('默认AI').locator('option:checked')).toHaveText('我的选题DeepSeek')
  const stored = await readFile(join(userDataPath, 'provider-configs.json'), 'utf8')
  expect(stored).not.toContain('sk-c1-e2e-secret')
  expect(stored).toContain('encryptedApiKey')

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: 'AI与发布' }).click()
  const reloadedSection = mainWindow.locator('.provider-settings')
  await expect(reloadedSection.locator('.provider-config-row b').filter({ hasText: '我的选题DeepSeek' })).toBeVisible()
  await expect(reloadedSection.getByLabel('默认AI').locator('option:checked')).toHaveText('我的选题DeepSeek')
  await reloadedSection.getByRole('button', { name: '编辑' }).click()
  await expect(reloadedSection.getByLabel('API key')).toHaveValue('')
  await expect(reloadedSection.getByLabel('API key')).toHaveAttribute('type', 'password')
  await expect(reloadedSection.getByLabel('类型')).toBeDisabled()
  await reloadedSection.getByLabel('显示名称').fill('我的AI选题筛选')
  await reloadedSection.getByRole('button', { name: /安全保存/ }).click()
  await expect(reloadedSection.locator('.provider-config-row b').filter({ hasText: '我的AI选题筛选' })).toBeVisible()

  await electronApp.close()
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: 'AI与发布' }).click()
  const restartedSection = mainWindow.locator('.provider-settings')
  await expect(restartedSection.locator('.provider-config-row b').filter({ hasText: '我的AI选题筛选' })).toBeVisible()
  await expect(restartedSection.getByLabel('默认AI').locator('option:checked')).toHaveText('我的AI选题筛选')

  await mainWindow.evaluate(() => { (globalThis as unknown as { location: { hash: string } }).location.hash = '#/content-engine' })
  const defaultProviderButton = mainWindow.locator('.ai-topic-scan-choice').filter({ hasText: '使用哪个AI筛选' }).getByRole('button', { name: /我的AI选题筛选/ })
  await expect(defaultProviderButton).toHaveClass(/active/)
})
