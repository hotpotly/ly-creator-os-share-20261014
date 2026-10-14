import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, 'tests/visual/r5-screenshots')
const userData = resolve(appRoot, 'test-results/r5a-visual-user-data')
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
  await page.evaluate(() => { globalThis.location.hash = '#/topics' })
  await page.getByRole('heading', { name: '选题管理' }).waitFor()
  await page.locator('.topic-filter-trigger').click()
  await page.getByRole('dialog', { name: '筛选选题' }).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'topics-filter-light-1440x900.png') })
  console.log(`R5a visual baseline captured: ${outputDirectory}`)
} finally {
  await electronApp.close()
}
