import { addTodoDateDays } from '../../src/shared/todo-date'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __workLogFaults?: { delays: Record<string, number>; fail: string[]; resolved: string[] }; __workLogTest?: { create(mode: string): void; schedule(): void; toggle(bounds: { x: number; y: number; width: number; height: number }): void } }
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
  writeFileSync(harness, `const { ipcMain } = require('electron'); const handle = ipcMain.handle.bind(ipcMain); globalThis.__workLogFaults = { delays: {}, fail: [], resolved: [] }; ipcMain.handle = (channel, handler) => handle(channel, channel === 'daily-work-log:get' ? async (event, payload) => { const faults = globalThis.__workLogFaults; if (faults.delays[payload.day]) await new Promise(resolve => setTimeout(resolve, faults.delays[payload.day])); faults.resolved.push(payload.day); if (faults.fail.includes(payload.day)) throw new Error('测试读取失败'); return handler(event, payload) } : handler); const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__workLogTest = { create: createTodoWindow, schedule: createSchedulePanelWindow, toggle: toggleSchedulePanelWindow };', file);`)
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

test('date drag and wheel keep independent drafts, cross months, and save only the displayed day', async () => {
  const { today, tomorrow } = await days()
  await setTotal(today, 60); await setTotal(tomorrow, 120)
  const dialog = await openLog(tray)
  await expect(dialog.getByLabel('总时长')).toHaveValue('1')
  await dialog.getByLabel('总时长').fill('4.5')
  const scrubber = dialog.getByRole('group', { name: '左右滑动切换时长日期' })
  const box = (await scrubber.boundingBox())!
  await tray.mouse.move(box.x + box.width - 5, box.y + box.height / 2)
  await tray.mouse.down()
  await tray.mouse.move(box.x + box.width - 53, box.y + box.height / 2, { steps: 8 })
  await tray.mouse.up()
  await expect(dialog.locator('form')).toHaveAttribute('data-day', tomorrow)
  await expect(dialog.getByLabel('总时长')).toHaveValue('2')
  await dialog.getByLabel('总时长').fill('3')
  await dialog.getByRole('button', { name: '前一天时长', exact: true }).click()
  await expect(dialog.getByLabel('总时长')).toHaveValue('4.5')
  await scrubber.focus(); await tray.keyboard.press('ArrowRight')
  await expect(dialog.getByLabel('总时长')).toHaveValue('3')
  await scrubber.dispatchEvent('wheel', { deltaX: 48 * 35, deltaY: 0 })
  const future = addTodoDateDays(tomorrow, 35)
  await expect(dialog.locator('form')).toHaveAttribute('data-day', future)
  await expect(dialog.getByLabel('总时长')).toHaveValue('0')
  await scrubber.dispatchEvent('wheel', { deltaX: -48 * 35, deltaY: 0 })
  await expect(dialog.getByLabel('总时长')).toHaveValue('3')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const totals = await main.evaluate(async ({ today, tomorrow }) => {
    const api = (globalThis as Globals).creatorOS
    return [(await api.getDailyWorkLog(today)).totalMinutes, (await api.getDailyWorkLog(tomorrow)).totalMinutes]
  }, { today, tomorrow })
  expect(totals).toEqual([60, 180])
})

test('scrubbed category drafts retain conflict baseline and Escape never saves', async () => {
  const { today, tomorrow } = await days()
  const dialog = await openLog(tray)
  await dialog.getByRole('button', { name: '后一天时长', exact: true }).click()
  await expect(dialog.getByLabel('总时长')).toHaveValue('0')
  await dialog.getByRole('button', { name: '按分类记录' }).click()
  await dialog.getByLabel('自媒体').fill('2')
  await dialog.getByRole('button', { name: '前一天时长', exact: true }).click()
  await expect(dialog.getByLabel('总时长')).toHaveValue('0')
  await dialog.getByRole('button', { name: '后一天时长', exact: true }).click()
  await expect(dialog.getByLabel('自媒体')).toHaveValue('2')
  await setTotal(tomorrow, 240)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('其他窗口更新')
  await expect(dialog.getByLabel('自媒体')).toHaveValue('2')
  await tray.keyboard.press('Escape')
  const log = await main.evaluate(async day => (globalThis as Globals).creatorOS.getDailyWorkLog(day), today)
  expect(log.totalMinutes).toBeNull()
})

test('home and desktop share date scrubber; vertical scroll does not change dates', async () => {
  const { today, yesterday } = await days()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('widget') })
  const widget = await opened
  for (const page of [main, widget]) {
    const dialog = await openLog(page)
    const scrubber = dialog.getByRole('group', { name: '左右滑动切换时长日期' })
    await scrubber.dispatchEvent('wheel', { deltaX: 0, deltaY: 180 })
    await expect(dialog.locator('form')).toHaveAttribute('data-day', today)
    await scrubber.focus(); await page.keyboard.press('ArrowLeft')
    await expect(dialog.locator('form')).toHaveAttribute('data-day', yesterday)
    await expect(dialog.getByLabel('总时长')).toHaveValue('0')
    await page.keyboard.press('Escape')
  }
})

test('travel surfaces follow viewed dates, preserve identities and fit both styles in light and dark', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const { today, tomorrow, yesterday } = await days()
  const tripIds = await main.evaluate(async ({ today, tomorrow, yesterday }) => {
    const api = (globalThis as Globals).creatorOS
    const business = await api.saveBusinessTrip({ scheduleId: null, expectedUpdatedAt: null, action: 'save', title: '出差测试', startDate: yesterday, endDate: today, projectId: null, notes: '', kind: 'business' })
    const home = await api.saveBusinessTrip({ scheduleId: null, expectedUpdatedAt: null, action: 'save', title: '回家测试', startDate: today, endDate: tomorrow, projectId: null, notes: '', kind: 'home' })
    return { business: business.id, home: home.id }
  }, { today, tomorrow, yesterday })
  expect(tripIds.business).toBeTruthy()
  await expect(tray.locator('.todo-companion')).toHaveClass(/travel-surface-mixed/)
  await expect(main.locator('.todo-workspace')).toHaveClass(/travel-surface-mixed/)
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(tray.locator('.todo-companion')).toHaveClass(/travel-surface-business/)
  const dialog = await openLog(tray)
  await expect(dialog).toHaveClass(/travel-surface-business/)
  await dialog.getByRole('button', { name: '后一天时长', exact: true }).click()
  await expect(dialog).toHaveClass(/travel-surface-mixed/)
  await dialog.getByRole('button', { name: '后一天时长', exact: true }).click()
  await expect(dialog).toHaveClass(/travel-surface-home/)
  await tray.keyboard.press('Escape')
  for (const page of [main, tray]) {
    await page.getByRole('button', { name: /^选择待办日期/ }).click()
    await expect(page.locator('.calendar-date-number[data-travel-tone="mixed"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
  }
  const sizes: { width: number; height: number }[] = []
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    for (const page of [main, tray]) await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    const editor = await openLog(tray)
    await expect(editor.getByLabel('总时长')).toBeInViewport()
    const geometry = await editor.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const header = element.querySelector('header')!
      return { fits: rect.left >= 7 && rect.right <= innerWidth - 7 && rect.bottom <= innerHeight - 7, headerFits: header.scrollWidth <= header.clientWidth + 1, background: getComputedStyle(element).backgroundColor }
    })
    expect(geometry.fits).toBe(true); expect(geometry.headerFits).toBe(true)
    sizes.push((await editor.boundingBox())!)
    await tray.screenshot({ path: info.outputPath(`travel-work-log-${style}-${theme}.png`) })
    await main.locator('.todo-workspace').screenshot({ path: info.outputPath(`travel-home-${style}-${theme}.png`) })
    await tray.keyboard.press('Escape')
  }
  expect(sizes.every(size => Math.abs(size.width - sizes[0]!.width) <= 1 && Math.abs(size.height - sizes[0]!.height) <= 1)).toBe(true)
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(tray.locator('.todo-companion')).toHaveClass(/travel-surface-home/)
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(tray.locator('.todo-companion')).not.toHaveClass(/travel-surface-/)
})

test('late reads cannot overwrite a newer day; failed reads retry without stale save', async () => {
  const { today, tomorrow, yesterday } = await days()
  await setTotal(tomorrow, 120); await setTotal(yesterday, 180)
  await app.evaluate((_, { tomorrow, yesterday }) => {
    const faults = (globalThis as Globals).__workLogFaults!
    faults.delays[tomorrow] = 700
    faults.fail = [yesterday]
  }, { tomorrow, yesterday })
  const dialog = await openLog(tray)
  await dialog.getByRole('button', { name: '后一天时长', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '前一天时长', exact: true }).click()
  await expect(dialog.locator('form')).toHaveAttribute('data-day', today)
  await expect.poll(() => app.evaluate(() => (globalThis as Globals).__workLogFaults!.resolved)).toContain(tomorrow)
  await expect(dialog.getByLabel('总时长')).toHaveValue('0')
  await dialog.getByRole('button', { name: '前一天时长', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('测试读取失败')
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('总时长')).toHaveCount(0)
  await app.evaluate(() => { (globalThis as Globals).__workLogFaults!.fail = [] })
  await dialog.getByRole('button', { name: '重试', exact: true }).click()
  await expect(dialog.getByLabel('总时长')).toHaveValue('3')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
