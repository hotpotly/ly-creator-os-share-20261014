import { addTodoDateDays } from '../../src/shared/todo-date'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __workLogTest?: { create(mode: string): void; schedule(): void; toggle(bounds: { x: number; y: number; width: number; height: number }): void } }
let app: ElectronApplication
let main: Page
let tray: Page
// Test-only bootstrap exposes the existing window factory from the built module;
// no production hooks, fabricated sender roles, or visible windows are introduced.
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..')
  const harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__workLogTest = { create: createTodoWindow, schedule: createSchedulePanelWindow, toggle: toggleSchedulePanelWindow };', file);`)
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
})
test.afterEach(async () => { await app?.close() })

async function days(): Promise<{ today: string; yesterday: string; tomorrow: string }> {
  const today = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)
  return { today, yesterday: addTodoDateDays(today, -1), tomorrow: addTodoDateDays(today, 1) }
}
async function setTotal(day: string, minutes: number): Promise<void> {
  await main.evaluate(async ({ day, minutes }) => {
    const api = (globalThis as Globals).creatorOS
    await api.setDailyWorkLogTotal(day, minutes, await api.getDailyWorkLog(day))
  }, { day, minutes })
}
async function openLog(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('.todo-work-log').getByRole('button', { name: '记录', exact: true }).click()
  return page.locator('.todo-work-log-popover')
}
test('R21o selected-date reading and saving is shared across home, menu and desktop, not global today', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const { today, yesterday, tomorrow } = await days()
  await setTotal(today, 60); await setTotal(yesterday, 180); await setTotal(tomorrow, 120)
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(tray.locator('.todo-work-log')).toHaveAttribute('data-day', yesterday)
  await expect(tray.locator('.todo-work-log')).toContainText('3小时')
  await expect(tray.locator('.todo-work-log')).not.toContainText('今日投入')
  const dialog = await openLog(tray)
  await expect(dialog).toContainText(yesterday.replaceAll('-', '/'))
  await expect(dialog.getByLabel('总时长')).toHaveValue('3')
  await dialog.getByLabel('总时长').fill('4.5')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(tray.locator('.todo-work-log')).toContainText('4小时30分钟')
  await expect(main.locator('.todo-work-log')).toContainText('1小时')
  await main.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(main.locator('.todo-work-log')).toContainText('4小时30分钟')
  await tray.screenshot({ path: info.outputPath('selected-date-work-log.png') })
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('widget') })
  const widget = await opened
  await widget.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(widget.locator('.todo-work-log')).toHaveAttribute('data-day', tomorrow)
  await expect(widget.locator('.todo-work-log')).toContainText('2小时')
  await expect(tray.locator('.todo-work-log')).toHaveAttribute('data-day', yesterday)
  await tray.reload()
  await expect(tray.locator('.todo-work-log')).toHaveAttribute('data-day', today)
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(tray.locator('.todo-work-log')).toContainText('4小时30分钟')
})

test('R21o past classified edits keep same-day conflict checks and never write into today', async () => {
  const { today, yesterday } = await days()
  await main.evaluate(async (day) => (globalThis as Globals).creatorOS.setDailyWorkLog(day, { selfMediaMinutes: 120, aiMinutes: 30, otherWorkMinutes: 0 }), yesterday)
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  const dialog = await openLog(tray)
  await dialog.getByRole('button', { name: '按分类记录' }).click()
  await expect(dialog.getByLabel('自媒体')).toHaveValue('2')
  await setTotal(yesterday, 300)
  await dialog.getByLabel('健康').fill('1')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('其他窗口更新')
  await tray.keyboard.press('Escape')
  const current = await openLog(tray)
  await expect(current.getByLabel('总时长')).toHaveValue('5')
  await current.getByRole('button', { name: '按分类记录' }).click()
  await current.getByLabel('健康').fill('1')
  await current.getByRole('button', { name: '保存', exact: true }).click()
  await expect(tray.locator('.todo-work-log')).toContainText('3小时30分钟')
  const log = await main.evaluate(async (day) => (globalThis as Globals).creatorOS.getDailyWorkLog(day), today)
  expect(log.totalMinutes).toBeNull(); expect(log.selfMediaMinutes).toBe(0)
})

test('R21o switching dates discards old drafts and rapid cross-month changes cannot show old totals', async () => {
  const { today } = await days()
  await setTotal(today, 60)
  const dialog = await openLog(tray)
  await dialog.getByLabel('总时长').fill('9')
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(tray.locator('.todo-work-log-popover')).toHaveCount(0)
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
  // More than a month exercises day-key teardown and cancellation of in-flight reads.
  for (let i = 0; i < 32; i++) await tray.getByRole('button', { name: '查看前一天待办' }).click()
  const target = addTodoDateDays(today, -33)
  await expect(tray.locator('.todo-work-log')).toHaveAttribute('data-day', target)
  const past = await openLog(tray)
  await past.getByLabel('总时长').fill('2')
  await past.getByRole('button', { name: '保存', exact: true }).click()
  await expect(tray.locator('.todo-work-log')).toContainText('2小时')
  const logs = await main.evaluate(async ({ today, target }) => {
    const api = (globalThis as Globals).creatorOS
    return [await api.getDailyWorkLog(today), await api.getDailyWorkLog(target)]
  }, { today, target })
  expect(logs.map((log) => log.totalMinutes)).toEqual([60, 120])
})

test('R21o date read validates real dates, is read-only, and schedule role is denied', async () => {
  const result = await tray.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    let rejected = false
    try { await api.getDailyWorkLog('2026-02-30') } catch { rejected = true }
    const empty = await api.getDailyWorkLog('2020-01-01')
    return { rejected, empty }
  })
  expect(result.rejected).toBe(true)
  expect(result.empty).toMatchObject({ day: '2020-01-01', updatedAt: '', totalMinutes: null })
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.schedule() })
  const schedule = await opened
  await expect.poll(() => schedule.evaluate(async () => { try { await (globalThis as Globals).creatorOS.getDailyWorkLog('2020-01-01'); return false } catch { return true } })).toBe(true)
})
