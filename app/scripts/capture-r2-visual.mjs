import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, 'tests/visual/r2-screenshots')
const userData = resolve(appRoot, 'test-results/r2-visual-user-data')
await rm(userData, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

const electronApp = await electron.launch({
  args: ['.'],
  cwd: appRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CREATOR_OS_TEST_BACKGROUND: '1',
    CREATOR_OS_USER_DATA: userData
  }
})

try {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => globalThis.creatorOS?.getWorkspace !== undefined)
  const nativeWindow = await electronApp.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(1440, 900))

  await page.evaluate(() => { globalThis.location.hash = '#/home' })
  await page.getByRole('region', { name: '选题与灵感' }).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'home-ideas-summary-light-1440x900.png') })

  await page.evaluate(() => { globalThis.location.hash = '#/projects?type=type-ai' })
  await page.getByLabel('筛选内容方向').waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'projects-toolbar-light-1440x900.png') })

  await page.evaluate(() => { globalThis.location.hash = '#/topics' })
  await page.locator('.topic-title-cell').first().waitFor()
  await page.locator('.topic-table-wrap').evaluate((element) => { element.scrollLeft = 560 })
  await page.screenshot({ path: resolve(outputDirectory, 'topics-sticky-light-1440x900.png') })

  await page.getByRole('button', { name: '新建选题', exact: true }).click()
  await page.getByRole('dialog', { name: '新建选题' }).waitFor()
  await page.evaluate(async () => globalThis.creatorOS.setPreferences({ theme: 'dark' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await nativeWindow.evaluate((window) => window.setSize(880, 720))
  await page.screenshot({ path: resolve(outputDirectory, 'new-topic-expanded-dark-880x720.png') })

  console.log(`R2 visual baselines captured: ${outputDirectory}`)
} finally {
  await electronApp.close()
}
