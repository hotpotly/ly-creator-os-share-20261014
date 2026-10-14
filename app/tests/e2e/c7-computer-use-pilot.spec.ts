import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication
let mainWindow: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  const videoPath = testInfo.outputPath('成片.mp4')
  rmSync(userDataPath, { recursive: true, force: true })
  mkdirSync(testInfo.outputDir, { recursive: true })
  writeFileSync(videoPath, Buffer.from([0, 0, 0, 20]))
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_USER_DATA: userDataPath,
      CREATOR_OS_TEST_PUBLISHING_VIDEO: videoPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getAppInfo().then((info) => info.name) ?? '')).toBe('LY Creator OS')
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('B站试验默认关闭，开启后只推进到页面待检查而不确认发布', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: 'AI与发布' }).click()
  const toggle = mainWindow.getByRole('button', { name: '已关闭（推荐）' })
  await expect(toggle).toBeVisible()
  await expect(mainWindow.getByText('小红书继续使用复制文案＋手动发布')).toBeVisible()
  await toggle.click()
  await expect(mainWindow.getByRole('button', { name: '试验已开启' })).toBeVisible()

  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = await api.getProject('ai-browser')
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    await api.setFinalVersion(project.id, final.id)
    await api.savePublishingTextMaterial(project.id, 'B站', 'title', 'AI浏览器真实体验')
    await api.savePublishingTextMaterial(project.id, 'B站', 'description', '一次完整的本机真实体验。')
    await api.savePublishingTextMaterial(project.id, 'B站', 'tags', 'AI,浏览器,效率')
    await api.importPublishingFileMaterial(project.id, 'B站', 'cover', '封面.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    const account = await api.savePublishingAccount({ platform: 'B站', accountName: 'LY数码', positioning: '数码长视频' })
    await api.selectPublishingAccount(project.id, 'B站', account.id)
    await api.choosePublishingVideo(project.id, 'B站')
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/publishing'
  })
  await expect(mainWindow.getByRole('heading', { name: '发布', exact: true })).toBeVisible()
  await expect(mainWindow.getByText('5/5项就绪')).toBeVisible()
  await mainWindow.getByRole('button', { name: '检查发布包' }).click()
  await expect(mainWindow.getByRole('button', { name: '准备辅助填写' })).toBeVisible()
  const disabledError = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const handoff = (await api.getProject('ai-browser')).publishingHandoffs[0]!
    await api.setPreferences({ computerUsePublishBilibili: false })
    let message = ''
    try { await api.startPublishingComputerUsePilot(handoff.id) } catch (reason) { message = reason instanceof Error ? reason.message : String(reason) }
    await api.setPreferences({ computerUsePublishBilibili: true })
    return message
  })
  expect(disabledError).toContain('请先在设置中开启')
  await expect(mainWindow.getByRole('button', { name: '准备辅助填写' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '准备辅助填写' }).click()
  await expect(mainWindow.getByText('辅助填写中', { exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '字段已填，等待我检查' })).toBeVisible()
  const packet = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(packet).toContain('CREATOR_OS_COMPUTER_USE_PILOT_V1')
  expect(packet).toContain('当前账号与expectedAccountName不一致')
  await mainWindow.evaluate(async () => { await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({ computerUsePublishBilibili: false }) })
  await expect(mainWindow.getByRole('button', { name: '取消B站Computer Use试验' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '取消B站Computer Use试验' }).click()
  await expect(mainWindow.getByRole('button', { name: '重新预检' })).toBeEnabled()
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('')
  await mainWindow.getByRole('button', { name: '重新预检' }).click()
  await expect(mainWindow.getByRole('button', { name: '准备辅助填写' })).toHaveCount(0)
  await mainWindow.evaluate(async () => { await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({ computerUsePublishBilibili: true }) })
  await expect(mainWindow.getByRole('button', { name: '准备辅助填写' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '准备辅助填写' }).click()
  await expect(mainWindow.getByText('辅助填写中', { exact: true })).toBeVisible()

  let project = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser'))
  expect(project.publishingComputerUsePilots[0]).toMatchObject({ platform: 'B站', status: 'page_opened', accountName: 'LY数码' })
  expect(project.publishingHandoffs[0]?.status).toBe('opened')
  const duplicateError = await mainWindow.evaluate(async () => {
    let message = ''
    try { await (globalThis as unknown as BrowserGlobals).creatorOS!.preparePublishingHandoff('ai-browser', 'B站') }
    catch (reason) { message = reason instanceof Error ? reason.message : String(reason) }
    return message
  })
  expect(duplicateError).toContain('已有Computer Use试验')

  await mainWindow.getByRole('button', { name: '字段已填，等待我检查' }).click()
  await expect(mainWindow.getByText('页面待检查', { exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '我已在平台发布' })).toBeVisible()
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('')
  project = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser'))
  expect(project.publishingComputerUsePilots[0]?.status).toBe('ready_for_review')
  expect(project.publishingHandoffs[0]?.status).toBe('opened')
  const staleConfirmError = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const handoff = (await api.getProject('ai-browser')).publishingHandoffs[0]!
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'title', '发布前被修改的标题')
    let message = ''
    try { await api.confirmPublishingHandoff(handoff.id) } catch (reason) { message = reason instanceof Error ? reason.message : String(reason) }
    await api.savePublishingTextMaterial('ai-browser', 'B站', 'title', 'AI浏览器真实体验')
    return message
  })
  expect(staleConfirmError).toContain('发布包已过期')
})
