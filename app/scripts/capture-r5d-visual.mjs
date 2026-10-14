import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, 'tests/visual/r5-screenshots')
const userData = resolve(appRoot, 'test-results/r5d-visual-user-data')
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
  await page.evaluate(async () => {
    await globalThis.creatorOS.createSchedule({
      projectId: 'ios',
      title: '跨周拍摄与补充体验',
      actionType: 'production',
      startAt: '2026-07-17T09:00:00+08:00',
      endAt: '2026-07-22T09:00:00+08:00',
      scheduleKind: 'plan',
      waitingFor: null
    })
    await globalThis.creatorOS.createSchedule({
      projectId: 'ai-browser',
      title: '教程素材整理',
      actionType: 'materials',
      startAt: '2026-07-15T09:00:00+08:00',
      endAt: '2026-07-18T09:00:00+08:00',
      scheduleKind: 'plan',
      waitingFor: null
    })
    globalThis.location.hash = '#/schedule'
  })
  await page.getByRole('heading', { name: '项目排期' }).waitFor()
  await page.locator('.schedule-range-shell').first().waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'schedule-ranges-month-light-1440x900.png') })

  await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: '周', exact: true }).click()
  await page.locator('.week-range-layer .schedule-range-shell').first().waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'schedule-ranges-week-light-1440x900.png') })

  await page.evaluate(async () => globalThis.creatorOS.setPreferences({ theme: 'dark' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await nativeWindow.evaluate((window) => window.setSize(880, 720))
  await page.screenshot({ path: resolve(outputDirectory, 'schedule-ranges-week-dark-880x720.png') })

  await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: '月', exact: true }).click()
  await page.locator('.month-range-layer .schedule-range-shell').first().waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'schedule-ranges-month-dark-880x720.png') })
  console.log(`R5d visual baselines captured: ${outputDirectory}`)
} finally {
  await electronApp.close()
}
