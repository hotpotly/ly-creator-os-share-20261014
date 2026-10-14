import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __reviewTravelTest: { create(mode: string): void; schedule(): void } }
let app: ElectronApplication, page: Page
test.beforeEach(async ({ browserName }, info) => {
 expect(browserName).toBe('chromium')
 const root = join(import.meta.dirname, '../..'), harness = info.outputPath('harness.cjs')
 mkdirSync(info.outputPath(), { recursive: true })
 writeFileSync(harness, `const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__reviewTravelTest = { create: createTodoWindow, schedule: createSchedulePanelWindow };', file);`)
 app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_DATE: '2026-09-27', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-27T10:00:00', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
 page = await app.firstWindow()
 await expect.poll(() => page.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBe('2026-09-27')
})
test.afterEach(async () => { await app?.close() })
test('typed chart bars and date circles share travel data; floating readout follows bar tops and stays inside at edges', async ({ browserName }, info) => {
 expect(browserName).toBe('chromium')
 const ids = await page.evaluate(async () => {
  const api = (globalThis as Globals).creatorOS, ids: string[] = []
  for (const [kind, startDate, endDate] of [['business','2026-09-01','2026-09-03'],['home','2026-09-02','2026-09-04'],['rest','2026-09-03','2026-09-05'],['rest','2026-09-30','2026-09-30']] as const) {
   ids.push((await api.saveBusinessTrip({ kind, scheduleId: null, expectedUpdatedAt: null, action: 'save', title: kind, projectId: null, startDate, endDate, notes: '' })).id)
  }
  for (const [day, minutes] of [['2026-09-01',545],['2026-09-02',0],['2026-09-06',0],['2026-09-30',720]] as const) await api.setDailyWorkLogTotal(day, minutes, await api.getDailyWorkLog(day))
  location.hash = '#/reviews?kind=monthly&anchor=2026-09-27'
  return ids
 })
 const chart = page.getByRole('group', { name: '每日工作投入' }), readout = page.getByLabel('每日工时读数')
 await expect(chart).toBeVisible()
 await expect(readout).toHaveCount(0)
 await expect(page.locator('.review-hour-number strong')).toHaveText('21.1')
 for (const [day, tone, text] of [['01','business','9小时5分钟'],['02','mixed','0小时'],['03','all','未记录'],['04','home-rest','未记录'],['05','rest','未记录'],['30','rest','12小时']]) {
  const point = chart.locator(`.review-chart-points button[data-day="2026-09-${day}"]`)
  await expect(point).toHaveAttribute('data-travel-kind', tone!)
  await point.hover()
  await expect(readout).toContainText(text!)
  const tip = (await readout.boundingBox())!, bar = (await point.locator('.review-chart-bar').boundingBox())!, frame = (await chart.boundingBox())!
  expect(tip.y + tip.height).toBeLessThanOrEqual(bar.y)
  expect(tip.x).toBeGreaterThanOrEqual(frame.x - 1)
  expect(tip.x + tip.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
 }
 await chart.locator('.review-chart-points button[data-day="2026-09-03"]').hover()
 await expect(readout).toContainText('出差／回家／休息')
 await expect(chart.locator('.review-chart-points button[data-day="2026-09-03"]')).toHaveAttribute('data-missing', 'true')
 await expect(chart.locator('.review-chart-points button[data-day="2026-09-02"] .review-chart-bar')).toHaveAttribute('data-zero', 'true')
 await page.getByRole('heading', { name: '工作投入', exact: true }).hover()
 await expect(readout).toHaveCount(0)
 for (const width of [880, 1280]) {
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 900), width)
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
   await page.evaluate(([s,t]) => { document.documentElement.dataset.visualStyle = s; document.documentElement.dataset.theme = t }, [style, theme])
   await chart.locator('.review-chart-points button[data-day="2026-09-30"]').hover()
   await expect(readout).toContainText('12小时')
   await expect.poll(() => page.locator('.review-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
   const tip = (await readout.boundingBox())!, bounds = (await chart.boundingBox())!
   expect(tip.x + tip.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
   expect(tip.y).toBeGreaterThanOrEqual((await page.locator('.review-page').boundingBox())!.y)
   expect(tip.y + tip.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
   if (width === 1280) { await page.getByRole('heading', { name: '工作投入', exact: true }).scrollIntoViewIfNeeded(); await chart.locator('.review-chart-points button[data-day="2026-09-30"]').hover() }
   if (style === 'feishu' && ((width === 880 && theme === 'dark') || (width === 1280 && theme === 'light'))) await page.screenshot({ path: info.outputPath(`chart-${width}-${theme}.png`) })
  }
 }
 await chart.locator('.review-chart-points button[data-day="2026-09-03"]').focus()
 await page.keyboard.press('ArrowRight')
 await expect(readout).toContainText('回家／休息')
 await page.evaluate(async id => {
  const api = (globalThis as Globals).creatorOS, item = (await api.getWorkspace()).schedules.find(s => s.id === id)!
  await api.saveBusinessTrip({ kind: 'rest', scheduleId: id, expectedUpdatedAt: item.updatedAt, action: 'cancel', title: item.title, projectId: null, startDate: '2026-09-03', endDate: '2026-09-05', notes: '' })
 }, ids[2]!)
 await expect(chart.locator('.review-chart-points button[data-day="2026-09-03"]')).toHaveAttribute('data-travel-kind','mixed')
 await expect(chart.locator('.review-chart-points button[data-day="2026-09-05"]')).not.toHaveAttribute('data-travel-kind')
 await page.getByRole('button', { name: '周复盘', exact: true }).click()
 await expect(chart.locator('.review-chart-points > button')).toHaveCount(7)
})
test('rest in the original editor persists and synchronizes home, tray, widget, calendar and review without adding hours', async ({ browserName }, info) => {
 expect(browserName).toBe('chromium')
 const before = await page.evaluate(() => (globalThis as Globals).creatorOS.getWorkspace())
 await page.getByRole('button', { name: '安排行程', exact: true }).click()
 await page.getByRole('group', { name: '行程类型' }).getByRole('button', { name: '休息', exact: true }).click()
 const editor = page.getByRole('dialog', { name: '安排休息', exact: true })
 await expect(editor.getByRole('group', { name: '行程类型' }).getByRole('button')).toHaveCount(3)
 await page.screenshot({ path: info.outputPath('rest-editor.png') })
 await editor.getByRole('button', { name: '保存休息', exact: true }).click()
 await expect(page.locator('.business-trip-summary')).toContainText('休息中·休息')
 await expect(page.locator('.todo-workspace')).toHaveClass(/travel-surface-rest/)
 for (const mode of ['tray','widget']) {
  const opened = app.waitForEvent('window')
  await app.evaluate((_, mode) => (globalThis as Globals).__reviewTravelTest.create(mode), mode)
  const companion = await opened
  await expect(companion.locator('.business-trip-summary')).toContainText('休息中·休息')
  await expect(companion.locator('.todo-companion')).toHaveClass(/travel-surface-rest/)
 }
 const opened = app.waitForEvent('window')
 await app.evaluate(() => (globalThis as Globals).__reviewTravelTest.schedule())
 const schedule = await opened
 await expect(schedule.locator('.schedule-companion-agenda [data-travel-kind="rest"]')).toContainText('休息')
 await expect(schedule.locator('.calendar-date-number[data-travel-tone="rest"]')).toHaveCount(1)
 const after = await page.evaluate(() => (globalThis as Globals).creatorOS.getWorkspace())
 expect(after.todos).toEqual(before.todos)
 expect(after.schedules.filter(item => item.trip?.kind === 'rest')).toHaveLength(1)
 await page.evaluate(() => { location.hash = '#/reviews?kind=monthly&anchor=2026-09-27' })
 const point = page.locator('.review-chart-points [data-day="2026-09-27"]')
 await expect(point).toHaveAttribute('data-travel-kind','rest')
 await expect(point).toHaveAttribute('data-missing','true')
 await point.hover()
 await expect(page.getByLabel('每日工时读数')).toContainText('未记录休息')
 await page.reload()
 await expect(point).toHaveAttribute('data-travel-kind','rest')
})
