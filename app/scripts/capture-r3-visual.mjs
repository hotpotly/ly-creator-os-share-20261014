import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, '.local-evidence/r3-visual')
const userData = resolve(appRoot, 'test-results/r3-visual-user-data')
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

  const topicId = await page.evaluate(async () => {
    const workspace = await globalThis.creatorOS.getWorkspace()
    return (await globalThis.creatorOS.createTopic({
      title: '暑期选题拍摄计划',
      coreAngle: '在月底前补齐体验并决定是否立项',
      contentTypeId: workspace.contentTypes.find((item) => item.isActive).id,
      importanceLevel: 3,
      needsMoreExperience: true,
      startAt: '2026-07-20',
      expectedCompletionAt: '2026-07-24',
      actualCompletionAt: null,
      stageId: workspace.topicStages.find((item) => item.role === 'standard').id
    })).id
  })

  await page.evaluate(() => { globalThis.location.hash = '#/topics' })
  await page.getByRole('heading', { name: '选题管理' }).waitFor()
  await page.getByRole('button', { name: '管理阶段' }).click()
  const manager = page.getByRole('dialog', { name: '管理选题阶段' })
  await manager.getByRole('button', { name: /改名待评估/ }).click()
  await page.screenshot({ path: resolve(outputDirectory, 'topic-management-stage-label-light-1440x900.png') })

  await manager.getByRole('button', { name: '关闭阶段管理' }).click()
  await page.evaluate(() => { globalThis.location.hash = '#/schedule' })
  await page.locator(`[data-topic-deadline-id="${topicId}"]`).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'topic-deadline-month-light-1440x900.png') })

  await page.evaluate(async () => globalThis.creatorOS.setPreferences({ theme: 'dark' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await nativeWindow.evaluate((window) => window.setSize(880, 720))
  await page.getByRole('button', { name: '周', exact: true }).click()
  await page.getByRole('button', { name: '下一周' }).click()
  await page.locator(`[data-topic-deadline-id="${topicId}"]`).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'topic-deadline-week-dark-880x720.png') })

  console.log(`R3 visual evidence captured: ${outputDirectory}`)
} finally {
  await electronApp.close()
}
