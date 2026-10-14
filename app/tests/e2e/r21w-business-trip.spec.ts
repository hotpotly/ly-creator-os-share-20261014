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
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_DATE: '2026-09-19', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-19T10:00:00', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
})
test.afterEach(async () => { await app?.close() })

async function workspace() { return main.evaluate(() => (globalThis as Globals).creatorOS.getWorkspace()) }
async function createTrip(page: Page, title = '上海出差') {
  await page.getByRole('button', { name: '安排行程', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '安排出差', exact: true })
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('出差名称或目的地').fill(title)
  await editor.getByRole('gridcell', { name: '选择2026年9月22日', exact: true }).click({ modifiers: ['Shift'] })
  await editor.getByLabel('出差备注').fill('发布会与外景拍摄')
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  await expect(editor).toHaveCount(0)
}

test('one trip synchronizes home, tray, widget and calendar; dates follow the viewed day', async () => {
  const before = await workspace()
  await createTrip(tray)
  for (const page of [main, tray]) await expect(page.getByRole('region', { name: '行程状态' })).toContainText('出差中·上海出差')
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('widget') })
  const widget = await opened
  await expect(widget.getByRole('region', { name: '行程状态' })).toContainText('出差中·上海出差')
  await widget.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(widget.getByRole('region', { name: '行程状态' })).toContainText('出差安排·上海出差')
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(tray.locator('.business-trip-summary')).toHaveCount(0)
  const after = await workspace()
  expect(after.todos).toEqual(before.todos)
  expect(after.schedules.length).toBe(before.schedules.length + 1)
  const item = after.schedules.find(item => item.trip)!
  await expect(main.locator(`[data-schedule-focus-id="${item.id}"]`).first()).toBeVisible()
  await main.locator(`[data-schedule-focus-id="${item.id}"]`).first().click({ button: 'right' })
  await main.getByRole('menuitem', { name: '查看出差安排', exact: true }).click()
  const editor = main.getByRole('dialog', { name: '编辑出差安排' })
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('出差名称或目的地').fill('上海品牌活动')
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  await expect(main.locator('.business-trip-summary')).toContainText('上海品牌活动')
  await expect(widget.locator('.business-trip-summary')).toContainText('上海品牌活动')
  // The todo role only receives the narrow trip mutation, never general schedule write access.
  const denied = await tray.evaluate(async () => { try { await (globalThis as Globals).creatorOS.moveSchedule('irrelevant', null, null); return false } catch { return true } })
  expect(denied).toBe(true)
})

test('editor dismissal writes nothing; validation and stale conflicts preserve input', async () => {
  const before = await workspace()
  await tray.getByRole('button', { name: '安排行程', exact: true }).click()
  let editor = tray.getByRole('dialog', { name: '安排出差', exact: true })
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('出差名称或目的地').fill('')
  await editor.getByRole('button', { name: '收起设置' }).click()
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('请填写')
  await expect(editor.getByRole('alert')).toBeInViewport()
  await editor.getByLabel('出差名称或目的地').fill('未保存行程')
  await editor.getByRole('button', { name: '关闭出差安排' }).click()
  expect((await workspace()).schedules).toEqual(before.schedules)
  await createTrip(tray)
  await tray.locator('.business-trip-summary').click()
  editor = tray.getByRole('dialog', { name: '编辑出差安排' })
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('出差备注').fill('我的草稿仍保留')
  const item = (await workspace()).schedules.find(item => item.trip)!
  await main.evaluate(async item => (globalThis as Globals).creatorOS.saveBusinessTrip({ scheduleId: item.id, expectedUpdatedAt: item.updatedAt, title: '另一窗口更名', projectId: null, startDate: '2026-09-19', endDate: '2026-09-22', notes: '新版本', action: 'save' }), item)
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('其他窗口')
  await expect(editor.getByRole('alert')).toBeInViewport()
  await expect(editor.getByLabel('出差备注')).toHaveValue('我的草稿仍保留')
  await editor.getByRole('button', { name: '关闭出差安排' }).click()
  await tray.locator('.business-trip-summary').click()
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('出差备注').fill('重新打开后重试')
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  expect((await workspace()).schedules.filter(item => item.trip)).toHaveLength(1)
  expect((await workspace()).schedules.find(item => item.trip)?.trip?.notes).toBe('重新打开后重试')
})

test('explicit early end and cancel preserve ordinary todos and stored history', async () => {
  const before = (await workspace()).todos
  await createTrip(tray)
  await tray.locator('.business-trip-summary').click()
  const editor = tray.getByRole('dialog', { name: '编辑出差安排' })
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByRole('button', { name: '提前结束', exact: true }).click()
  await editor.getByRole('button', { name: '确认提前结束', exact: true }).click()
  await expect(main.locator('.business-trip-summary')).toContainText('出差已结束')
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(tray.locator('.business-trip-summary')).toHaveCount(0)
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await tray.locator('.business-trip-summary').click()
  await expect(editor.getByRole('gridcell').first()).toBeDisabled()
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByRole('button', { name: '取消出差', exact: true }).click()
  await expect(main.locator('.business-trip-summary')).toHaveCount(1)
  await editor.getByRole('button', { name: '确认取消出差', exact: true }).click()
  await expect(main.locator('.business-trip-summary')).toHaveCount(0)
  const after = await workspace()
  expect(after.todos).toEqual(before)
  expect(after.schedules.find(item => item.trip)?.trip?.cancelled).toBe(true)
})

test('narrow light/dark inline range calendars stay inside the viewport', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await createTrip(tray, '上海品牌活动与新产品发布会外景拍摄出差')
  const sizes: [number, number][] = []
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    await tray.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    await tray.locator('.business-trip-summary').click()
    const editor = tray.getByRole('dialog', { name: '编辑出差安排' })
    await expect(editor).toBeVisible()
    const inBounds = await editor.evaluate(element => { const r = element.getBoundingClientRect(); return r.x >= 7 && r.y >= 7 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7 && element.scrollWidth <= element.clientWidth })
    expect(inBounds).toBe(true)
    expect((await editor.boundingBox())!.height).toBeLessThanOrEqual(390)
    expect(await editor.locator('.business-trip-fields').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
    expect(await editor.getByRole('button', { name: '保存出差', exact: true }).evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 8 && r.bottom <= innerHeight - 8 })).toBe(true)
    await editor.getByRole('button', { name: '上个月' }).click()
    expect(await editor.locator('.business-trip-fields').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
    await editor.getByRole('button', { name: '下个月' }).click()
    const bounds = (await editor.boundingBox())!
    sizes.push([bounds.width, bounds.height])
    await editor.screenshot({ path: info.outputPath(`trip-${style}-${theme}.png`) })
    await editor.getByRole('gridcell', { name: '选择2026年9月23日', exact: true }).click({ modifiers: ['Shift'] })
    await expect(editor.getByLabel('已选行程日期')).toContainText('2026-09-23')
    await editor.getByRole('button', { name: '关闭出差安排' }).click()
  }
  expect(sizes.every(size => Math.abs(size[0] - sizes[0]![0]) <= 1 && Math.abs(size[1] - sizes[0]![1]) <= 1)).toBe(true)
  await main.locator('.business-trip-status').screenshot({ path: info.outputPath('trip-home.png') })
})


test('calendar creation uses the same records, overlapping trips remain separate, schedule role can complete trips but cannot edit their details', async () => {
  await main.getByRole('button', { name: '排期', exact: true }).click()
  await createTrip(main, '杭州出差')
  await expect(tray.locator('.business-trip-summary')).toContainText('杭州出差')
  await createTrip(tray, '上海中转')
  await expect(tray.locator('.business-trip-summary')).toHaveCount(2)
  const item = (await workspace()).schedules.find(item => item.trip)!
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.schedule() })
  const panel = await opened
  await expect(panel.locator('.schedule-companion-agenda')).toContainText('杭州出差')
  await expect(panel.getByRole('checkbox', { name: /杭州出差|上海中转/ })).toHaveCount(2)
  await panel.getByRole('checkbox', { name: '标记完成：杭州出差', exact: true }).click()
  await expect(panel.getByRole('checkbox', { name: '取消完成：杭州出差', exact: true })).toBeChecked()
  await expect(tray.locator('.business-trip-summary').filter({ hasText: '杭州出差' })).toContainText('已完成')
  await panel.getByRole('checkbox', { name: '取消完成：杭州出差', exact: true }).click()
  await expect(panel.getByRole('checkbox', { name: '标记完成：杭州出差', exact: true })).not.toBeChecked()
  const denied = await panel.evaluate(async item => {
    try {
      await (globalThis as Globals).creatorOS.saveBusinessTrip({ scheduleId: item.id, expectedUpdatedAt: item.updatedAt, title: '不应修改', projectId: null, startDate: '2026-09-19', endDate: '2026-09-22', notes: '', action: 'save' })
      return false
    } catch { return true }
  }, item)
  expect(denied).toBe(true)
  expect((await workspace()).schedules.filter(item => item.trip)).toHaveLength(2)
})

test('compact quick create saves defaults, switches type directly and preserves custom names', async () => {
  await tray.getByRole('button', { name: '安排行程', exact: true }).click()
  const editor = tray.locator('.business-trip-editor')
  await expect(editor.getByLabel('出差名称或目的地')).toBeHidden()
  await editor.getByRole('group', { name: '行程类型' }).getByRole('button', { name: '回家', exact: true }).click()
  await editor.getByRole('button', { name: '保存回家', exact: true }).click()
  expect((await workspace()).schedules.find(item => item.trip)?.title).toBe('回老家')
  await tray.getByRole('button', { name: '安排行程', exact: true }).click()
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  expect((await workspace()).schedules.filter(item => item.trip).map(item => item.title).sort()).toEqual(['出差', '回老家'])
  await tray.getByRole('button', { name: '安排行程', exact: true }).click()
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('出差名称或目的地').fill('探亲')
  await editor.getByRole('button', { name: '收起设置' }).click()
  await editor.getByRole('group', { name: '行程类型' }).getByRole('button', { name: '回家', exact: true }).click()
  await editor.getByRole('button', { name: '保存回家', exact: true }).click()
  expect((await workspace()).schedules.find(item => item.title === '探亲')?.trip?.kind).toBe('home')
})

test('collapsed quick date edit preserves existing title, project and notes; advanced drafts survive disclosure', async () => {
  const projectId = (await workspace()).projects.find(project => !project.trashedAt)!.id
  const item = await main.evaluate(async projectId => (globalThis as Globals).creatorOS.saveBusinessTrip({ scheduleId: null, expectedUpdatedAt: null, action: 'save', kind: 'home', title: '探亲行程', projectId, startDate: '2026-09-19', endDate: '2026-09-20', notes: '带相机' }), projectId)
  await tray.locator('.business-trip-summary').click()
  const editor = tray.locator('.business-trip-editor')
  await editor.getByRole('gridcell', { name: '选择2026年9月22日', exact: true }).click({ modifiers: ['Shift'] })
  await editor.getByRole('button', { name: '保存回家', exact: true }).click()
  let saved = (await workspace()).schedules.find(entry => entry.id === item.id)!
  expect(saved).toMatchObject({ title: '探亲行程', projectId, trip: { notes: '带相机', kind: 'home' } })
  expect(saved.endAt).toContain('2026-09-22')
  await tray.locator('.business-trip-summary').click()
  await editor.getByRole('button', { name: '更多设置' }).click()
  await editor.getByLabel('回家备注').fill('带相机和电池')
  await editor.getByRole('button', { name: '收起设置' }).click()
  await editor.getByRole('button', { name: '更多设置' }).click()
  await expect(editor.getByLabel('回家备注')).toHaveValue('带相机和电池')
  // Lifecycle actions still ignore unrelated unsaved fields.
  await editor.getByRole('button', { name: '提前结束', exact: true }).click()
  await editor.getByRole('button', { name: '确认提前结束', exact: true }).click()
  saved = (await workspace()).schedules.find(entry => entry.id === item.id)!
  expect(saved.trip?.notes).toBe('带相机')
  expect(saved.trip?.endedEarly).toBe(true)
})

test('one icon entry; drag forward, backward, single day and across a month, with keyboard fallback', async () => {
  const status = tray.getByRole('region', { name: '行程状态' })
  await expect(status.getByRole('button')).toHaveCount(1)
  await expect(status.getByRole('button')).toHaveText('')
  await status.getByRole('button', { name: '安排行程' }).click()
  const editor = tray.locator('.business-trip-editor')
  const cell = (date: string) => editor.locator(`[data-range-date="${date}"]`)
  const dragDates = async (from: string, to: string) => {
    const a = (await cell(from).boundingBox())!
    const b = (await cell(to).boundingBox())!
    await tray.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await tray.mouse.down()
    await tray.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
    await tray.mouse.up()
  }
  await dragDates('2026-09-19', '2026-09-23')
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-19 — 2026-09-23')
  await expect(editor.locator('.in-range')).toHaveCount(5)
  await dragDates('2026-09-25', '2026-09-20')
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-20 — 2026-09-25')
  await cell('2026-09-22').click()
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-22')
  const pending = (await cell('2026-09-24').boundingBox())!
  await tray.mouse.move(pending.x + pending.width / 2, pending.y + pending.height / 2)
  await tray.mouse.down()
  await tray.keyboard.press('Escape')
  await tray.mouse.up()
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-22')
  await cell('2026-09-25').click({ modifiers: ['Shift'] })
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-22 — 2026-09-25')
  await dragDates('2026-09-29', '2026-10-03')
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-29 — 2026-10-03')
  await editor.getByRole('button', { name: '下个月' }).click()
  await cell('2026-10-10').focus()
  await tray.keyboard.press('Shift+Enter')
  await expect(editor.getByLabel('已选行程日期')).toHaveText('2026-09-29 — 2026-10-10')
  await editor.getByRole('button', { name: '保存出差', exact: true }).click()
  const saved = (await workspace()).schedules.find(item => item.trip)!
  expect(saved.startAt).toContain('2026-09-29')
  expect(saved.endAt).toContain('2026-10-10')
})
