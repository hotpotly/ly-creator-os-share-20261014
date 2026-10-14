import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __workLogTest?: { create(mode: string): void; schedule(): void; toggle(bounds: { x: number; y: number; width: number; height: number }): void } }
let app: ElectronApplication
let main: Page
let tray: Page
let widget: Page
// Test-only bootstrap exposes the existing window factory from the built module;
// no production hooks, fabricated sender roles, or visible windows are introduced.
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..')
  const harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__workLogTest = { create: createTodoWindow, schedule: createSchedulePanelWindow, toggle: toggleSchedulePanelWindow, failUpdate: () => { const original = WorkspaceRepository.prototype.updateTodoItem; WorkspaceRepository.prototype.updateTodoItem = function(...args) { WorkspaceRepository.prototype.updateTodoItem = original; throw new Error("分类保存测试失败") } } };', file);`)
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
})
test.afterEach(async () => { await app?.close() })

async function seed(progress = 0) {
  return main.evaluate(async progress => {
    const api = (globalThis as Globals).creatorOS
    const ws = await api.getWorkspace()
    await api.setPreferences({ companionTodoView: 'time', homeTodoView: 'time', todoCategoryLabels: { ...ws.preferences.todoCategoryLabels, ai: '智能研究' } })
    const [todo] = await api.createTodoBatch([{ title: '整理书桌分类测试', plannedDate: ws.today, segment: 'morning', projectId: 'ios', stageKey: 'script', category: 'life', trackingMode: 'progress', progress }])
    return todo!
  }, progress)
}
const badge = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"] .todo-category-tag`)
const menu = (page: Page) => page.getByRole('menu', { name: '选择待办分类', exact: true })
const read = (id: string) => main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t => t.id === id), id)

test('all three surfaces share category updates, preserve fields and remember corrections after reload', async () => {
  const todo = await seed(100)
  for (const [page, label, category] of [[main, '智能研究', 'ai'], [tray, '健康', 'other_work'], [widget, '自媒体', 'self_media']] as const) {
    await badge(page, todo.id).click()
    await expect(menu(page).getByRole('menuitemradio')).toHaveCount(4)
    await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveCount(1)
    await menu(page).getByRole('menuitemradio', { name: label, exact: true }).click()
    await expect(menu(page)).toHaveCount(0)
    for (const surface of [main, tray, widget]) await expect(badge(surface, todo.id)).toHaveText(label)
    const saved = (await read(todo.id))!
    expect(saved).toEqual({ ...todo, category, updatedAt: saved.updatedAt })
  }
  await tray.reload()
  await expect(badge(tray, todo.id)).toHaveText('自媒体')
  const memories = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).preferences.todoCategoryMemories)
  expect(memories.some(memory => memory.category === 'self_media')).toBe(true)
})

test('outside click, Escape, same choice and trigger toggle do not write; keyboard selection works', async () => {
  const todo = await seed(35)
  const trigger = badge(tray, todo.id)
  await trigger.click()
  await trigger.click()
  await expect(menu(tray)).toHaveCount(0)
  await trigger.press('Enter')
  await expect(menu(tray)).toBeVisible()
  await tray.keyboard.press('Escape')
  await expect(menu(tray)).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await tray.locator('.todo-work-log').click()
  await expect(menu(tray)).toHaveCount(0)
  await tray.keyboard.press('Escape')
  await trigger.click()
  await menu(tray).getByRole('menuitemradio', { name: '生活', exact: true }).click()
  expect(await read(todo.id)).toEqual(todo)
  await trigger.press('Space')
  await expect(menu(tray).getByRole('menuitemradio').first()).toBeFocused()
  await tray.keyboard.press('End')
  await tray.keyboard.press('Enter')
  await expect(trigger).toHaveText('健康')
  expect((await read(todo.id))!.progress).toBe(35)
})

test('menu fits a narrow companion window in all themes and follows category renames', async () => {
  const todo = await seed()
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().includes('todo')) { win.setMinimumSize(280, 240); win.setSize(320, 320) }
    }
  })
  for (const appearance of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    await tray.evaluate(({ appearance, theme }) => { document.documentElement.dataset.visualStyle = appearance; document.documentElement.dataset.theme = theme }, { appearance, theme })
    await badge(tray, todo.id).click()
    const box = (await menu(tray).boundingBox())!
    const viewport = await tray.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    await expect(menu(tray)).toContainText('智能研究')
    await tray.keyboard.press('Escape')
  }
})

test('a failed save keeps the menu and error visible without changing the label', async () => {
  const todo = await seed()
  await badge(tray, todo.id).click()
  // Fail the real repository method in the test process, not a copied renderer API.
  await app.evaluate(() => {
    const g = globalThis as typeof globalThis & { __workLogTest?: { failUpdate?(): void } }
    g.__workLogTest!.failUpdate!()
  })
  await menu(tray).getByRole('menuitemradio', { name: '健康', exact: true }).click()
  await expect(menu(tray).getByRole('alert')).toContainText('分类保存测试失败')
  await expect(badge(tray, todo.id)).toHaveText('生活')
  expect(await read(todo.id)).toEqual(todo)
  // The injected failure is one-shot; retry exercises the normal save path.
  await menu(tray).getByRole('menuitemradio', { name: '健康', exact: true }).click()
  await expect(menu(tray)).toHaveCount(0)
  await expect(badge(tray, todo.id)).toHaveText('健康')
})
