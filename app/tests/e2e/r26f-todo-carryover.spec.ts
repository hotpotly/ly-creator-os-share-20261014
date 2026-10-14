import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __workLogTest?: { create(mode: string): void; schedule(): void; failCreate(): void; toggle(bounds: { x: number; y: number; width: number; height: number }): void } }
let app: ElectronApplication
let main: Page
let tray: Page
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..')
  const harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__workLogTest = { create: createTodoWindow, schedule: createSchedulePanelWindow, toggle: toggleSchedulePanelWindow, failCreate: () => { const original = WorkspaceRepository.prototype.createTodoItems; WorkspaceRepository.prototype.createTodoItems = function(...args) { WorkspaceRepository.prototype.createTodoItems = original; throw new Error("创建测试失败") } } };', file);`)
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_DATE: '2026-10-05', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
})
test.afterEach(async () => { await app?.close() })

async function seed() {
  return main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    const base = { plannedDate: '2026-10-04', segment: 'morning' as const, projectId: 'ios', stageKey: 'editing' as const, category: 'self_media' as const, trackingMode: 'progress' as const, progress: 40 }
    return api.createTodoBatch([
      { ...base, title: '选中接续' }, { ...base, title: '留在昨天' },
      { ...base, title: '前天事项', plannedDate: '2026-10-03' },
      { ...base, title: '昨天已完成', progress: 100 },
      { ...base, title: '无日期', plannedDate: null },
      { ...base, title: '今天已有', plannedDate: '2026-10-05' },
      { ...base, title: '期间不搬', plannedDate: null, segment: null, dateRange: { startDate: '2026-10-01', endDate: '2026-10-04', name: '期间' } }
    ])
  })
}
const panel = (page: Page) => page.getByRole('dialog', { name: '选择复制到今天的待办', exact: true })
async function open(page: Page) {
  await page.getByRole('button', { name: /昨日未完成/ }).click()
  await expect(panel(page)).toBeVisible()
}

test('selective carryover and undo synchronize home, tray and widget without duplicates', async () => {
  const items = await seed()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('widget') })
  const widget = await opened
  await expect(widget.getByRole('button', { name: '昨日未完成 2' })).toBeVisible()
  await expect(panel(tray)).toHaveCount(0)
  await open(tray)
  await expect(panel(tray).getByRole('checkbox')).toHaveCount(2)
  await expect(panel(tray).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await expect(panel(tray).getByRole('button', { name: '复制到今天（0）' })).toBeDisabled()
  await panel(tray).getByLabel('复制：选中接续', { exact: true }).check()
  await panel(tray).getByRole('button', { name: '取消', exact: true }).click()
  await open(tray)
  await expect(panel(tray).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await panel(tray).getByLabel('复制：选中接续', { exact: true }).check()
  await panel(tray).getByRole('button', { name: '复制到今天（1）' }).click()
  await expect(panel(tray)).toHaveCount(0)
  await expect(main.locator(`[data-todo-id="${items[0]!.id}"]`)).toHaveCount(0)
  await expect(main.locator(`[data-todo-id="${items[1]!.id}"]`)).toHaveCount(0)
  for (const page of [main, tray, widget]) await expect(page.getByRole('button', { name: '昨日未完成 2' })).toBeVisible()
  const current = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).todos)
  expect(current.find(todo => todo.id === items[0]!.id)).toEqual(items[0])
  const copy = current.find(todo => todo.title === items[0]!.title && todo.id !== items[0]!.id)!
  await expect(main.locator(`[data-todo-id="${copy.id}"]`)).toHaveCount(1)
  expect(copy).toMatchObject({ plannedDate: '2026-10-05', segment: null, progress: 40, projectId: 'ios', stageKey: 'editing' })
  expect(current).toHaveLength(items.length + 1)
  await tray.getByRole('button', { name: '撤销', exact: true }).click()
  for (const page of [main, tray, widget]) await expect(page.getByRole('button', { name: '昨日未完成 2' })).toBeVisible()
  await expect(main.locator(`[data-todo-id="${items[0]!.id}"]`)).toHaveCount(0)
  await main.reload()
  await expect(main.getByRole('button', { name: '昨日未完成 2' })).toBeVisible()
})

test('earlier date selection clears checks and past-day context menu uses the same copy and undo', async () => {
  const items = await seed()
  await open(main)
  await panel(main).getByRole('button', { name: '全选', exact: true }).click()
  await panel(main).getByRole('button', { name: /选择日期/ }).click()
  await panel(main).getByRole('gridcell', { name: '选择2026年10月3日', exact: true }).click()
  await expect(panel(main).getByRole('checkbox')).toHaveCount(1)
  await expect(panel(main).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await panel(main).getByLabel('复制：前天事项').check()
  await panel(main).getByRole('button', { name: '复制到今天（1）' }).click()
  await expect(main.locator('[data-todo-id]').filter({ hasText: '前天事项' })).toHaveCount(1)
  await expect(main.locator(`[data-todo-id="${items[2]!.id}"]`)).toHaveCount(0)
  await main.getByRole('button', { name: '撤销', exact: true }).click()
  await main.getByRole('button', { name: '查看前一天待办', exact: true }).click()
  await expect(main.getByRole('button', { name: /昨日未完成/ })).toHaveCount(0)
  await main.locator(`[data-todo-id="${items[0]!.id}"]`).click({ button: 'right' })
  await main.getByRole('menuitem', { name: '复制到今天', exact: true }).click()
  await expect(main.locator('.todo-copy-notice')).toBeVisible()
  await expect(main.locator(`[data-todo-id="${items[0]!.id}"]`)).toHaveCount(1)
  await main.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(main.locator(`[data-todo-id="${items[0]!.id}"]`)).toHaveCount(1)
  await main.locator(`[data-todo-id="${items[3]!.id}"]`).click({ button: 'right' })
  await expect(main.getByRole('menuitem', { name: '复制到今天', exact: true })).toHaveCount(0)
})

test('concurrent completion rejects the whole selection and keeps recoverable checks', async () => {
  const items = await seed()
  await open(tray)
  await panel(tray).getByRole('button', { name: '全选', exact: true }).click()
  await main.evaluate(async id => (globalThis as Globals).creatorOS.updateTodo(id, { completed: true }), items[1]!.id)
  await panel(tray).getByRole('button', { name: '复制到今天（2）' }).click()
  await expect(panel(tray).getByRole('alert')).toContainText('未复制任何待办')
  await expect(panel(tray).getByRole('checkbox', { checked: true })).toHaveCount(2)
  await expect(main.locator(`[data-todo-id="${items[0]!.id}"]`)).toHaveCount(0)
  await panel(tray).getByRole('button', { name: '重新选择' }).click()
  await expect(panel(tray).getByRole('checkbox')).toHaveCount(1)
  await expect(panel(tray).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await panel(tray).getByLabel('复制：选中接续').check()
  await panel(tray).getByRole('button', { name: '复制到今天（1）' }).click()
  const copiedId = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(todo => todo.title === '选中接续' && todo.plannedDate === '2026-10-05')!.id)
  await main.evaluate(async id => (globalThis as Globals).creatorOS.updateTodo(id, { progress: 60 }), copiedId)
  await tray.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(tray.locator('.todo-copy-notice')).toContainText('无法撤销')
  expect(await main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(todo => todo.id === id)?.progress, copiedId)).toBe(60)
})

test('quiet empty state, keyboard cancellation and four-theme compact geometry', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await expect(main.getByRole('button', { name: /昨日未完成/ })).toHaveCount(0)
  await seed()
  await open(tray)
  await tray.keyboard.press('Escape')
  await expect(panel(tray)).toHaveCount(0)
  for (const width of [240, 320]) {
    await app.evaluate(({ BrowserWindow }, w) => { const window = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/todo-tray'))!; window.setContentSize(w, 380) }, width)
    for (const theme of ['light', 'dark']) for (const style of ['warm', 'feishu']) {
      await tray.evaluate(([theme, style]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = style }, [theme, style])
      await open(tray)
      const bounds = (await panel(tray).boundingBox())!, viewport = await tray.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(bounds.x).toBeGreaterThanOrEqual(7)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7)
      expect(await panel(tray).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await panel(tray).getByRole('button', { name: '全选', exact: true }).click()
      if (width === 320 && style === 'feishu') await tray.screenshot({ path: info.outputPath(`carryover-${theme}.png`) })
      await panel(tray).getByRole('button', { name: '取消', exact: true }).click()
    }
  }
})

test('date changes discard selection and non-todo windows cannot call the command', async () => {
  const items = await seed()
  await open(main)
  await panel(main).getByRole('button', { name: '全选', exact: true }).click()
  await main.getByRole('button', { name: '查看前一天待办', exact: true }).click()
  await expect(panel(main)).toHaveCount(0)
  await main.getByRole('button', { name: '查看后一天待办', exact: true }).click()
  await open(main)
  await expect(panel(main).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await panel(main).getByRole('button', { name: /选择日期/ }).click()
  await expect(panel(main).getByRole('gridcell', { name: '今天，选择2026年10月5日', exact: true })).toBeDisabled()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.schedule() })
  const schedule = await opened
  await schedule.waitForLoadState('domcontentloaded')
  const error = await schedule.evaluate(async item => {
    try { await (globalThis as Globals).creatorOS.copyTodosToToday({ requestId: crypto.randomUUID(), today: '2026-10-05', items: [{ todoId: item.id, expectedUpdatedAt: item.updatedAt }] }); return '' }
    catch (error) { return String(error) }
  }, items[0]!)
  expect(error).not.toBe('')
  expect(await main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(todo => todo.id === id)?.plannedDate, items[0]!.id)).toBe('2026-10-04')
})

test('home entry and popup fit narrow and wide layouts without an automatic prompt', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await seed()
  for (const width of [680, 1280]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes('/todo-'))!.setContentSize(w, 800), width)
    await expect(panel(main)).toHaveCount(0)
    expect(await main.locator('.todo-workspace-header').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await open(main)
    expect(await panel(main).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    if (width === 1280) await main.screenshot({ path: info.outputPath('carryover-home.png') })
    await panel(main).getByRole('button', { name: '取消', exact: true }).click()
  }
})

test('compact creation options share the tabs row and disappear after successful creation', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await expect(tray.getByRole('button', { name: '普通待办', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const options = tray.locator('.todo-create-options')
  for (const width of [240, 320]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/todo-tray'))!.setContentSize(w, 450), width)
    for (const theme of ['light', 'dark']) for (const style of ['warm', 'feishu']) {
      await tray.evaluate(([theme, style]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = style }, [theme, style])
      const tabs = (await tray.getByRole('group', { name: '待办阶段' }).boundingBox())!, bounds = (await options.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(tabs.x + tabs.width)
      expect(Math.abs(bounds.y + bounds.height / 2 - tabs.y - tabs.height / 2)).toBeLessThan(2)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(await tray.locator('.focus-toolbar').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (width === 240 && style === 'feishu') await tray.screenshot({ path: info.outputPath(`compact-create-${theme}.png`) })
    }
  }
  await options.getByRole('checkbox', { name: '额外' }).check()
  await tray.getByLabel('批量新建待办', { exact: true }).fill('紧凑额外测试')
  await options.getByRole('button', { name: /新建待办日期/ }).click()
  const dates = tray.getByRole('dialog', { name: '新建待办日期设置' })
  await dates.getByLabel('待办安排方式').selectOption('range')
  await dates.getByLabel('范围开始日期').fill('2026-10-05')
  await dates.getByLabel('范围结束日期').fill('2026-10-07')
  await dates.getByLabel('日期范围名称').fill('三天')
  await dates.getByRole('button', { name: '从日历选择日期范围' }).click()
  await expect(tray.getByRole('dialog', { name: '选择待办日期范围' })).toBeVisible()
  await tray.keyboard.press('Escape')
  await expect(dates).toBeVisible()
  await dates.getByRole('button', { name: '确定', exact: true }).click()
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(options).toHaveCount(0)
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  const todo = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(todo => todo.title === '紧凑额外测试'))
  expect(todo).toMatchObject({ isExtra: true, dateRange: { startDate: '2026-10-05', endDate: '2026-10-07', name: '三天' } })
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await expect(options.getByRole('checkbox')).not.toBeChecked()
  await expect(options.getByRole('button', { name: /新建待办日期/ })).not.toHaveClass(/active/)
  await tray.getByRole('button', { name: '收起新建待办' }).click()
  await expect(options).toHaveCount(0)
})

test('creation after completing the small step still exposes compact options and preserves failed drafts', async () => {
  await main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, snapshot = await api.getWorkspace()
    const day = snapshot.todoDays!.find(value => value.day === snapshot.today)!
    await api.writeTodoDay({ day: snapshot.today, expectedRevision: day.revision, patch: { smallCompleted: true, view: 'regular' } })
  })
  await expect(tray.getByRole('group', { name: '待办阶段' })).toHaveCount(0)
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await tray.getByLabel('批量新建待办', { exact: true }).fill('失败后重试')
  await tray.locator('.todo-create-options').getByRole('checkbox').check()
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.failCreate() })
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByRole('alert')).toContainText('创建测试失败')
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveValue('失败后重试')
  await expect(tray.locator('.todo-create-options').getByRole('checkbox')).toBeChecked()
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.locator('.todo-create-options')).toHaveCount(0)
  await expect(tray.locator('.focus-toolbar')).toHaveCount(0)
})
