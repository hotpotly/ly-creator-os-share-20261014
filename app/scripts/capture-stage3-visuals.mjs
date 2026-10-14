import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, 'tests/visual/stage-three-screenshots')
const userData = resolve(appRoot, 'test-results/stage-three-visual-user-data')
await rm(userData, { recursive: true, force: true }); await mkdir(outputDirectory, { recursive: true })

const electronApp = await electron.launch({
  args: ['.'], cwd: appRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CREATOR_OS_TEST_BACKGROUND: process.env.CREATOR_OS_TEST_BACKGROUND ?? '1',
    CREATOR_OS_USER_DATA: userData
  }
})
try {
  const page = await electronApp.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => globalThis.creatorOS?.getWorkspace !== undefined)
  const nativeWindow = await electronApp.browserWindow(page)
  const capture = async (name, hash, width, height) => {
    await nativeWindow.evaluate((window, size) => window.setSize(size.width, size.height), { width, height })
    await page.evaluate((route) => { globalThis.location.hash = route }, hash); await page.waitForTimeout(250)
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`) })
  }
  await capture('navigation-tabs-light-1440x900', '#/home', 1440, 900)
  await page.getByRole('button', { name: '隐藏侧边栏' }).click(); await page.waitForTimeout(220)
  await page.screenshot({ path: resolve(outputDirectory, 'navigation-tabs-collapsed-light-1440x900.png') })
  await page.getByRole('button', { name: '显示侧边栏' }).click(); await page.waitForTimeout(220)
  await capture('schedule-light-1440x900', '#/schedule', 1440, 900)
  await capture('schedule-light-900x720', '#/schedule', 900, 720)
  await capture('schedule-light-680x720', '#/schedule', 680, 720)
  await capture('ideas-classification-light-900x720', '#/ideas', 900, 720)
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '管理内容方向' }).click(); await page.waitForTimeout(120)
  await page.screenshot({ path: resolve(outputDirectory, 'content-directions-light-900x720.png') })
  await page.getByRole('button', { name: '关闭内容方向管理' }).click()
  await capture('project-configuration-light-900x720', '#/project/ai-browser/overview', 900, 720)
  await page.locator('.basic-info-card').getByRole('button', { name: '选择' }).click()
  await page.getByRole('dialog', { name: '选择项目模板' }).getByRole('button', { name: /^数码短视频/ }).click(); await page.waitForTimeout(120)
  await page.screenshot({ path: resolve(outputDirectory, 'project-template-diff-light-900x720.png') })
  await capture('project-overview-direct-edit-light-1440x900', '#/project/ios/overview', 1440, 900)
  await capture('project-materials-fullwidth-light-1440x900', '#/project/ios/materials', 1440, 900)
  await capture('project-outline-fullwidth-light-1440x900', '#/project/ios/outline', 1440, 900)
  await capture('project-versions-fullwidth-light-1440x900', '#/project/ios/versions', 1440, 900)
  await capture('project-production-light-1440x900', '#/project/ios/production', 1440, 900)
  await capture('project-ai-production-light-1440x900', '#/project/ai-browser/production', 1440, 900)
  await capture('tools-project-context-light-1440x900', '#/tools', 1440, 900)
  await capture('external-writing-light-900x720', '#/project/ai-browser/script', 900, 720)
  await page.getByRole('button', { name: /运行任务/ }).click(); await page.waitForTimeout(120)
  await page.screenshot({ path: resolve(outputDirectory, 'tasks-light-900x720.png') })
  await page.getByRole('button', { name: '关闭运行任务' }).click()
  await page.evaluate(async () => globalThis.creatorOS?.setPreferences({ theme: 'dark' })); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await capture('schedule-dark-1440x900', '#/schedule', 1440, 900)
  await capture('project-production-dark-1440x900', '#/project/ios/production', 1440, 900)
  await capture('project-ai-production-dark-1440x900', '#/project/ai-browser/production', 1440, 900)
  console.log(`stage-three screenshots captured: ${outputDirectory}`)
} finally { await electronApp.close() }
