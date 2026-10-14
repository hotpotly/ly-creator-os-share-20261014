import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, 'tests/visual/stage-two-screenshots')
const userData = resolve(appRoot, 'test-results/stage-two-visual-user-data')

await rm(userData, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

const electronApp = await electron.launch({
  args: ['.'],
  cwd: appRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CREATOR_OS_TEST_BACKGROUND: process.env.CREATOR_OS_TEST_BACKGROUND ?? '1',
    CREATOR_OS_USER_DATA: userData
  }
})

try {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => globalThis.creatorOS?.getWorkspace !== undefined)
  const nativeWindow = await electronApp.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(1440, 900))
  await page.waitForTimeout(250)

  const capture = async (name, hash) => {
    await page.evaluate((route) => { globalThis.location.hash = route }, hash)
    await page.waitForTimeout(250)
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`) })
  }

  await capture('projects-light-1440x900', '#/projects')
  await capture('ideas-light-1440x900', '#/ideas?type=type-digital&project=ssd')
  await capture('project-light-1440x900', '#/project/sponsor/overview')
  await capture('workbench-light-1440x900', '#/workbench/ai-browser')

  await page.evaluate(async () => globalThis.creatorOS?.setPreferences({ theme: 'dark' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await capture('workbench-dark-1440x900', '#/workbench/ai-browser')

  await nativeWindow.evaluate((window) => window.setSize(900, 720))
  await capture('workbench-dark-900x720', '#/workbench/ai-browser')
  await page.evaluate(async () => globalThis.creatorOS?.setPreferences({ theme: 'light' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await capture('ideas-light-900x720', '#/ideas?type=type-digital&project=ssd')
  await capture('projects-light-900x720', '#/projects')
  await nativeWindow.evaluate((window) => window.setSize(680, 720))
  await capture('ideas-light-680x720', '#/ideas?type=type-digital&project=ssd')
  await capture('projects-light-680x720', '#/projects')
  console.log(`stage-two screenshots captured: ${outputDirectory}`)
} finally {
  await electronApp.close()
}
