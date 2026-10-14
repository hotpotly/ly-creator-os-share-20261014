import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication
let mainWindow: Page
let currentUserDataPath = ''

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data'); currentUserDataPath = userDataPath; rmSync(userDataPath, { recursive: true, force: true })
  const videoPath = testInfo.outputPath('成片.mp4'); mkdirSync(testInfo.outputDir, { recursive: true }); writeFileSync(videoPath, Buffer.from([0, 0, 0, 20]))
  electronApp = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_PUBLISHING_VIDEO: videoPath } })
  mainWindow = await electronApp.firstWindow(); await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getAppInfo().then((info) => info.name) ?? '')).toBe('LY Creator OS')
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('stable cover flows from final draft into a confirmation-gated publishing package', async () => {
  const coverTaskId = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = await api.getProject('ai-browser')
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    await api.setFinalVersion(project.id, final.id)
    const tasks = await api.startCoverGeneration({ projectId: project.id, platform: 'B站', layout: 'bilibili_landscape', generationMode: 'stable_layers', batchCount: 2, headline: 'AI浏览器真实体验', materialLinkIds: [], groupNote: '暖灰绿科技风' })
    return tasks[0]!.id
  })
  await expect.poll(() => mainWindow.evaluate(async (taskId) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === taskId)?.status, coverTaskId), { timeout: 20_000 }).toBe('succeeded')

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/postproduction' })
  await expect(mainWindow.getByRole('heading', { name: '后期', exact: true })).toBeVisible()
  await expect(mainWindow.getByText('本机离线执行')).toBeVisible()
  await expect(mainWindow.locator('.cover-empty-grid article')).toHaveCount(2)
  await expect(mainWindow.locator('.cover-empty-grid img').first()).toHaveAttribute('src', /^data:image\/png;base64,/)
  await mainWindow.locator('.cover-empty-grid article').first().getByRole('button', { name: '选择', exact: true }).click()
  await expect(mainWindow.locator('.cover-empty-grid article').first()).toHaveClass(/selected/)

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/publishing' })
  await expect(mainWindow.getByRole('heading', { name: '发布', exact: true })).toBeVisible()
  await expect(mainWindow.locator('.publishing-fields input').first()).not.toHaveValue('')
  await expect(mainWindow.locator('.publishing-fields textarea')).not.toHaveValue('')

  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'title', 'AI浏览器真实体验')
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'description', '一次完整的本机真实体验。')
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'tags', 'AI,浏览器,效率')
    const account = await api.savePublishingAccount({ platform: 'B站', accountName: 'LY数码', positioning: '数码长视频', phone: '13800138000', email: 'ly@example.com' })
    await api.selectPublishingAccount('ai-browser', 'B站', account.id)
    await api.choosePublishingVideo('ai-browser', 'B站')
  })
  await mainWindow.reload(); await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/publishing' })
  await expect(mainWindow.getByText('5/5项就绪')).toBeVisible()
  const accountView = await mainWindow.evaluate(async () => {
    const state = await (globalThis as unknown as BrowserGlobals).creatorOS!.getPublishingAccountState('ai-browser')
    return { phone: state.accounts[0]?.maskedPhone, email: state.accounts[0]?.maskedEmail, serialized: JSON.stringify(state) }
  })
  expect(accountView).toMatchObject({ phone: '138••••8000', email: 'l•••@example.com' })
  expect(accountView.serialized).not.toContain('13800138000')
  expect(accountView.serialized).not.toContain('ly@example.com')
  const databaseBytes = ['creator-os.sqlite3', 'creator-os.sqlite3-wal', 'creator-os.sqlite3-shm']
    .map((name) => join(currentUserDataPath, name)).filter(existsSync).map((path) => readFileSync(path))
  const databaseText = Buffer.concat(databaseBytes).toString('utf8')
  expect(databaseText).not.toContain('13800138000')
  expect(databaseText).not.toContain('ly@example.com')
  await mainWindow.getByRole('button', { name: '检查发布包' }).click()
  await expect(mainWindow.getByText('可交接', { exact: true })).toBeVisible()
  const staleOpenError = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const oldHandoff = (await api.getProject('ai-browser')).publishingHandoffs.find((handoff) => handoff.platform === 'B站')!
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'title', '预检后修改的标题')
    let message = ''
    try { await api.openPublishingHandoff(oldHandoff.id) } catch (reason) { message = reason instanceof Error ? reason.message : String(reason) }
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'title', 'AI浏览器真实体验')
    await api.preparePublishingHandoff('ai-browser', 'B站')
    return message
  })
  expect(staleOpenError).toContain('发布包已过期')
  await expect(mainWindow.getByText('可交接', { exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '标题', exact: true })).toBeEnabled()
  await expect(mainWindow.getByRole('button', { name: '在Finder中显示视频' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '打开官方发布页' }).click()
  const confirmation = mainWindow.getByRole('alertdialog')
  await expect(confirmation).toContainText('最后发布必须由你在网页内确认')
  await confirmation.getByRole('button', { name: '取消' }).click()
  await expect(confirmation).toBeHidden()
})
