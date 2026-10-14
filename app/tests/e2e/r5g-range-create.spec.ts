import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
let app: ElectronApplication
let page: Page
let pageErrors: string[] = []

test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow(); pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message)); await page.waitForLoadState('domcontentloaded')
  await page.locator('.page-header').waitFor()
  await page.evaluate(async () => {
    const state = await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.getWorkspace()
    for (const item of state.schedules) await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.deleteSchedule(item.id)
    location.hash = '#/schedule'
  })
  await page.getByRole('heading', { name: '项目排期' }).waitFor()
  const w = await app.browserWindow(page); await w.evaluate(w => w.setSize(1440, 1000))
})
test.afterEach(async () => { await app.close().catch(() => undefined); expect(pageErrors).toEqual([]) })

async function holdRange(from: string, to: string): Promise<void> {
  const a = await page.locator(`.month-day[data-calendar-date="${from}"]`).boundingBox()
  const b = await page.locator(`.month-day[data-calendar-date="${to}"]`).boundingBox()
  if (!a || !b) throw new Error('日期不可见')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height - 12)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 12, { steps: 10 })
}
const count = (): Promise<number> => page.evaluate(async () => (await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.getWorkspace()).schedules.length)
test('R5g forward/reverse/cross-week/cross-month/same-day draft and single save', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  for (const [from, to, days] of [['2026-07-15', '2026-07-17', 3], ['2026-07-21', '2026-07-17', 5], ['2026-07-30', '2026-08-02', 4], ['2026-07-15', '2026-07-15', 1]] as const) {
    await holdRange(from, to)
    if (from === to) { const b = (await page.locator(`.month-day[data-calendar-date="${to}"]`).boundingBox())!; await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height - 12) }
    await expect(page.locator('[data-create-range]')).toHaveCount(days)
    expect(await count()).toBe(0)
    await page.mouse.up()
    const dialog = page.getByRole('dialog', { name: '新建排期', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('排期内容', { exact: true })).toBeFocused()
    await expect(dialog.getByLabel('开始日期', { exact: true })).toHaveValue(from < to ? from : to)
    await expect(dialog.getByLabel('结束日期', { exact: true })).toHaveValue(from < to ? to : from)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    expect(await count()).toBe(0)
  }
  await holdRange('2026-07-17', '2026-07-21')
  await page.screenshot({ path: info.outputPath('range-preview.png') })
  await page.mouse.up()
  const dialog = page.getByRole('dialog', { name: '新建排期', exact: true })
  await dialog.getByLabel('排期内容', { exact: true }).fill('跨日新安排')
  await page.screenshot({ path: info.outputPath('range-draft-light.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ path: info.outputPath('range-draft-dark.png') })
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()
  await expect.poll(count).toBe(1)
  const item = await page.evaluate(async () => (await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.getWorkspace()).schedules[0]!)
  expect(new Date(item.startAt!).getDate()).toBe(17)
  expect(new Date(item.endAt!).getDate()).toBe(21)
  await page.reload()
  await expect.poll(count).toBe(1)
})
test('R5g cancel on Escape, blur, pointercancel or outside; ordinary click does not create', async () => {
  for (const action of ['Escape', 'blur', 'pointercancel', 'outside']) {
    await holdRange('2026-07-15', '2026-07-17')
    await expect(page.locator('[data-create-range]')).toHaveCount(3)
    if (action === 'Escape') await page.keyboard.press('Escape')
    else if (action === 'outside') await page.mouse.move(5, 5)
    else await page.evaluate((action) => window.dispatchEvent(new Event(action)), action)
    await page.mouse.up()
    await expect(page.locator('[data-create-range]')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '新建排期', exact: true })).toHaveCount(0)
    expect(await count()).toBe(0)
  }
  const cell = page.locator('.month-day[data-calendar-date="2026-07-15"]')
  const b = (await cell.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height - 12)
  await expect(page.getByRole('dialog', { name: '新建排期', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '＋ 新建排期', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '新建排期', exact: true })).toBeVisible()
})


test('R27h moving over dates shows no create button in full calendar or home', async () => {
  for (const route of ['#/schedule', '#/home']) {
    await page.evaluate(route => { location.hash = route }, route)
    await page.getByRole('button', { name: '月', exact: true }).click()
    const cells = page.locator('.month-day')
    await expect(cells.first()).toBeVisible()
    for (const index of [8, 9, 10]) {
      await cells.nth(index).hover()
      await expect(cells.nth(index).getByRole('button', { name: /新建排期/ })).toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    await expect(page.locator('.month-empty-action')).toHaveCount(0)
    await page.getByRole('button', { name: '＋ 新建排期', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建排期', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    expect(await count()).toBe(0)
  }
})
