import { addTodoDateDays, todoDateRangeKey } from '../../src/shared/todo-date'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __workLogTest?: { create(mode: string): void; schedule(): void; toggle(bounds: { x: number; y: number; width: number; height: number }): void } }
let app: ElectronApplication
let main: Page
let tray: Page
let widget: Page
let startDay: string
let endDay: string
// Test-only bootstrap exposes the existing window factory from the built module;
// no production hooks, fabricated sender roles, or visible windows are introduced.
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..')
  const harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__workLogTest = { create: createTodoWindow, schedule: createSchedulePanelWindow, toggle: toggleSchedulePanelWindow, failUpdate: () => { const original = WorkspaceRepository.prototype.createTodoItems; WorkspaceRepository.prototype.createTodoItems = function(...args) { WorkspaceRepository.prototype.createTodoItems = original; throw new Error("范围创建测试失败") } } };', file);`)
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-14T10:00:00', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
  const widgetOpened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('widget') })
  widget = await widgetOpened
  await expect(widget.locator('.todo-work-log')).toBeVisible()
  await tray.getByRole('button', { name: '普通待办', exact: true }).click()
  await expect(widget.getByRole('button', { name: '普通待办', exact: true })).toHaveAttribute('aria-pressed', 'true')
  startDay = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)
  endDay = addTodoDateDays(startDay, 2)
})
test.afterEach(async () => { await app?.close() })

const row = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"]`)
const read = () => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).todos)
async function closeDateOptions(page: Page) {
  const options = page.getByRole('dialog', { name: '新建待办日期设置', exact: true })
  if (await options.count()) await options.getByRole('button', { name: '确定', exact: true }).click()
}
async function openRange(page: Page = tray, name = '三天清单') {
  await page.getByRole('button', { name: '展开新建待办' }).click()
  await page.getByLabel('批量新建待办', { exact: true }).fill('整理书架范围测试\n阅读范围测试')
  await page.getByRole('button', { name: /新建待办日期：/ }).click()
  await page.getByLabel('待办安排方式', { exact: true }).selectOption('range')
  await page.getByLabel('范围开始日期').fill(startDay)
  await page.getByLabel('范围结束日期').fill(endDay)
  await page.getByLabel('日期范围名称').fill(name)
}
async function createRange(page: Page = tray, name = '三天清单') {
  await openRange(page, name)
  await closeDateOptions(page)
  await page.getByRole('button', { name: '创建2条', exact: true }).click()
  await expect(page.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  return (await read()).filter(t => t.title.includes('范围测试'))
}

test('create a named range from tray, show inclusive days across windows, complete only once and persist', async () => {
  const items = await createRange(), id = items[0]!.id
  expect(items).toHaveLength(2)
  expect(items[0]).toMatchObject({ plannedDate: null, segment: null, dateRange: { startDate: startDay, endDate: endDay, name: '三天清单' } })
  for (const page of [main, tray, widget]) {
    await expect(row(page, id)).toBeVisible()
    await expect(page.locator('[data-date-range]').filter({ has: row(page, id) })).toContainText('三天清单')
  }
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(row(tray, id)).toBeVisible()
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(row(tray, id)).toBeVisible()
  await row(tray, id).locator('.todo-check').click()
  for (const page of [main, tray, widget]) await expect(row(page, id)).toHaveClass(/completed/)
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(row(tray, id)).toHaveCount(0)
  expect((await read()).filter(t => t.id === id)).toHaveLength(1)
  await tray.reload()
  await expect(row(tray, id)).toHaveClass(/completed/)
  await row(widget, id).locator('.todo-check').click()
  await expect(row(main, id)).not.toHaveClass(/completed/)
  expect((await read()).find(t => t.id === id)?.dateRange?.endDate).toBe(endDay)
})

test('unnamed range, invalid dates, calendar cancel and failed save preserve draft without partial tasks', async () => {
  await openRange(tray, '')
  await tray.getByLabel('范围结束日期').fill(addTodoDateDays(startDay, -1))
  await expect(tray.getByRole('alert')).toContainText('结束日期不能早于开始日期')
  await expect(tray.getByRole('button', { name: '创建2条' })).toBeDisabled()
  await tray.getByLabel('范围结束日期').fill(endDay)
  await tray.getByRole('button', { name: '从日历选择日期范围' }).click()
  await expect(tray.getByRole('dialog', { name: '选择待办日期范围' })).toBeVisible()
  await tray.keyboard.press('Escape')
  await expect(tray.getByRole('dialog', { name: '选择待办日期范围' })).toHaveCount(0)
  await expect(tray.getByLabel('范围结束日期')).toHaveValue(endDay)
  await app.evaluate(() => { (globalThis as typeof globalThis & { __workLogTest: { failUpdate(): void } }).__workLogTest.failUpdate() })
  await closeDateOptions(tray)
  await tray.getByRole('button', { name: '创建2条' }).click()
  await expect(tray.getByRole('alert')).toContainText('范围创建测试失败')
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveValue(/整理书架范围测试/)
  expect((await read()).filter(t => t.title.includes('范围测试'))).toHaveLength(0)
  await closeDateOptions(tray)
  await tray.getByRole('button', { name: '创建2条' }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  await expect(tray.locator('[data-date-range] > header')).toContainText('日期范围')
  await expect(tray.locator('[data-date-range] > header')).toContainText(`${startDay}—${endDay}`)
  await expect(tray.locator('main')).not.toContainText('中秋假期')
})

test('existing task range can be edited or cleared from the shared action menu without changing other fields', async () => {
  const [todo] = await createRange(widget)
  await row(tray, todo!.id).click({ button: 'right' })
  await tray.getByRole('menuitem', { name: '编辑待办' }).click()
  const edit = tray.getByRole('dialog', { name: `${todo!.title}的待办操作` })
  await edit.getByLabel('日期范围名称').fill('改名后的范围')
  await edit.getByLabel('范围结束日期').fill(addTodoDateDays(endDay, 2))
  await edit.getByRole('button', { name: '保存', exact: true }).click()
  await expect(edit).toHaveCount(0)
  const changed = (await read()).find(t => t.id === todo!.id)!
  expect(changed).toEqual({ ...todo, dateRange: { ...todo!.dateRange, name: '改名后的范围', endDate: addTodoDateDays(endDay, 2) }, updatedAt: changed.updatedAt })
  await row(tray, todo!.id).click({ button: 'right' }); await tray.getByRole('menuitem', { name: '编辑待办' }).click()
  await edit.getByLabel('待办安排方式').selectOption('day')
  await edit.getByLabel('日期', { exact: true }).fill(startDay)
  await edit.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await read()).find(t => t.id === todo!.id)?.dateRange).toBeNull()
  await expect(row(main, todo!.id)).toBeVisible()
})

test('home uses the same composer and period tasks cannot be dragged into a daily time slot', async () => {
  await main.locator('.todo-create-button').click()
  const composer = main.getByRole('dialog', { name: '批量新建待办' })
  await composer.getByLabel('待办安排方式').selectOption('range')
  await composer.getByLabel('范围开始日期').fill(startDay)
  await composer.getByLabel('范围结束日期').fill(endDay)
  await composer.locator('textarea').fill('首页范围测试')
  await composer.getByRole('button', { name: '创建1条待办' }).click()
  const todo = (await read()).find(t => t.title === '首页范围测试')!
  await expect(row(tray, todo.id)).toBeVisible()
  await expect(row(main, todo.id)).toBeVisible()
  const error = await main.evaluate(async ({ todo, startDay }) => {
    try { await (globalThis as Globals).creatorOS.moveTodoInTime({ todoId: todo.id, expectedUpdatedAt: todo.updatedAt, day: startDay, segment: 'morning', target: null, after: true }); return '' }
    catch (reason) { return String(reason) }
  }, { todo, startDay })
  expect(error).toContain('已变化')
  expect((await read()).find(t => t.id === todo.id)).toEqual(todo)
})

test('range controls and groups fit narrow windows in all themes', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await openRange(tray, '范围名称可以自定义')
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('todo')) { win.setMinimumSize(280, 300); win.setSize(320, 500) } })
  for (const visualStyle of ['warm', 'feishu'] as const) for (const theme of ['light', 'dark'] as const) {
    await main.evaluate(async prefs => { await (globalThis as Globals).creatorOS.setPreferences(prefs) }, { visualStyle, theme })
    await expect.poll(() => tray.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const label of ['范围开始日期', '范围结束日期', '日期范围名称']) {
      const box = (await tray.getByLabel(label).boundingBox())!, width = await tray.evaluate(() => innerWidth)
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    await tray.getByRole('button', { name: '从日历选择日期范围' }).click()
    const calendar = tray.getByRole('dialog', { name: '选择待办日期范围' })
    const bounds = (await calendar.boundingBox())!, viewport = await tray.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.w); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.h)
    await tray.keyboard.press('Escape')
    if (visualStyle === 'warm') await tray.screenshot({ path: info.outputPath(`range-create-${theme}.png`) })
  }
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('todo')) win.setSize(320, 300) })
  const createButton = tray.getByRole('button', { name: '创建2条', exact: true })
  await closeDateOptions(tray)
  await createButton.scrollIntoViewIfNeeded()
  const buttonBounds = (await createButton.boundingBox())!, height = await tray.evaluate(() => innerHeight)
  expect(buttonBounds.y).toBeGreaterThanOrEqual(0); expect(buttonBounds.y + buttonBounds.height).toBeLessThanOrEqual(height)
  await createButton.click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  await expect(tray.locator('[data-date-range]')).toBeVisible()
  await expect(tray.locator('[data-date-range] > header')).toContainText('0/2已完成')
  await tray.screenshot({ path: info.outputPath('range-group.png') })
})


test('single-day parsing is unchanged after leaving range mode and future ranges stay on their own dates', async () => {
  await openRange(tray)
  await tray.getByLabel('待办安排方式').selectOption('day')
  await closeDateOptions(tray)
  await tray.getByLabel('批量新建待办', { exact: true }).fill('明天单日测试')
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect.poll(async () => (await read()).find(t => t.title.includes('单日测试'))?.plannedDate).toBe(addTodoDateDays(startDay, 1))
  expect((await read()).find(t => t.title.includes('单日测试'))?.dateRange).toBeNull()
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await tray.getByRole('button', { name: /新建待办日期：/ }).click()
  await tray.getByLabel('待办安排方式').selectOption('range')
  await tray.getByLabel('范围开始日期').fill(addTodoDateDays(startDay, 5))
  await tray.getByLabel('范围结束日期').fill(addTodoDateDays(startDay, 7))
  await closeDateOptions(tray)
  await tray.getByLabel('批量新建待办', { exact: true }).fill('明天未来范围测试')
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  const future = (await read()).find(t => t.title.includes('未来范围测试'))!
  expect(future.plannedDate).toBeNull()
  expect(future.dateRange?.startDate).toBe(addTodoDateDays(startDay, 5))
  await expect(row(tray, future.id)).toBeVisible()
  await expect(row(main, future.id)).toHaveCount(0)
  await expect(row(widget, future.id)).toHaveCount(0)
})


test('saved ranges deduplicate and auto-fill in home, tray, widget and editing without mutating existing tasks', async () => {
  const items = await createRange()
  const value = todoDateRangeKey(items[0]!.dateRange!)
  const before = await read()
  await main.locator('.todo-create-button').click()
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await widget.getByRole('button', { name: '展开新建待办' }).click()
  for (const page of [tray, widget]) await page.getByRole('button', { name: /新建待办日期：/ }).click()
  const homeComposer = main.getByRole('dialog', { name: '批量新建待办' })
  for (const scope of [homeComposer, tray, widget]) {
    const select = scope.getByLabel('待办安排方式', { exact: true })
    await expect(select.locator('option')).toHaveCount(3)
    await select.selectOption(value)
    await expect(scope.getByLabel('范围开始日期')).toHaveValue(startDay)
    await expect(scope.getByLabel('范围结束日期')).toHaveValue(endDay)
    await expect(scope.getByLabel('日期范围名称')).toHaveValue('三天清单')
  }
  // Selection and subsequent edits are only drafts, not group-wide edits.
  await widget.getByLabel('日期范围名称').fill('仅草稿中的新名称')
  await expect(widget.getByLabel('待办安排方式')).toHaveValue('range')
  expect(await read()).toEqual(before)
  await closeDateOptions(tray)
  await tray.getByLabel('批量新建待办', { exact: true }).fill('复用已有范围')
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  const created = (await read()).find(t => t.title === '复用已有范围')!
  expect(created.dateRange).toEqual(items[0]!.dateRange)
  expect((await read()).filter(t => items.some(item => item.id === t.id))).toEqual(items)
  await expect(tray.locator('[data-date-range] > header')).toContainText('0/3已完成')
  await row(tray, created.id).click({ button: 'right' })
  await tray.getByRole('menuitem', { name: '编辑待办' }).click()
  const edit = tray.getByRole('dialog', { name: '复用已有范围的待办操作' })
  await expect(edit.getByLabel('待办安排方式')).toHaveValue(value)
  await edit.getByLabel('待办安排方式').selectOption('day')
  await edit.getByLabel('待办安排方式').selectOption(value)
  await expect(edit.getByLabel('日期范围名称')).toHaveValue('三天清单')
  await tray.keyboard.press('Escape')
  expect((await read()).find(t => t.id === created.id)).toEqual(created)
  // Another window saves a new range; an already open home composer updates its choices.
  await closeDateOptions(widget)
  await widget.getByLabel('批量新建待办', { exact: true }).fill('新范围跨窗同步')
  await widget.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(homeComposer.getByLabel('待办安排方式').locator('option')).toHaveCount(4)
  await expect(homeComposer.getByLabel('日期范围名称')).toHaveValue('三天清单')
})

test('saved range menu shows dates, supports keyboard and fits narrow windows in all themes', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const name = '用于辨认已有日期范围的较长名称'
  const items = await createRange(tray, name)
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) if (win.webContents.getURL().includes('todo')) { win.setMinimumSize(280, 300); win.setSize(320, 500) } })
  await tray.getByRole('button', { name: /新建待办日期：/ }).click()
  const select = tray.getByLabel('待办安排方式', { exact: true })
  for (const visualStyle of ['warm', 'feishu'] as const) for (const theme of ['light', 'dark'] as const) {
    await main.evaluate(async prefs => { await (globalThis as Globals).creatorOS.setPreferences(prefs) }, { visualStyle, theme })
    await select.click()
    const menu = tray.getByRole('menu', { name: '待办安排方式选项' })
    const option = menu.getByRole('menuitemradio').filter({ hasText: name })
    await expect(option).toContainText(`${startDay}—${endDay}`)
    const bounds = (await menu.boundingBox())!, viewport = await tray.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.w)
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.h)
    await expect.poll(() => tray.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (visualStyle === 'warm') await tray.screenshot({ path: info.outputPath(`saved-range-menu-${theme}.png`) })
    await option.click()
    await expect(select).toHaveValue(todoDateRangeKey(items[0]!.dateRange!))
    await expect(tray.getByLabel('日期范围名称')).toHaveValue(name)
  }
  await select.press('Enter')
  await expect(tray.getByRole('menu', { name: '待办安排方式选项' }).getByRole('menuitemradio').first()).toBeFocused()
  await tray.keyboard.press('Escape')
  await expect(select).toBeFocused()
  await select.press('Enter')
  await expect(tray.getByRole('menu', { name: '待办安排方式选项' }).getByRole('menuitemradio').first()).toBeFocused()
  await tray.keyboard.press('Home')
  await tray.keyboard.press('Enter')
  await expect(select).toHaveValue('day')
  await expect(tray.getByLabel('范围开始日期')).toHaveCount(0)
})
