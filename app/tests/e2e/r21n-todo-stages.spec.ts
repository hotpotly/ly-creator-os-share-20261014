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

async function seed(): Promise<string[]> {
  return main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, workspace = await api.getWorkspace()
    await api.setModuleCompleted('ios', 'script', false)
    const rows = await api.createTodoBatch([
      { title: '当前初稿(2)', plannedDate: workspace.today, stageKey: 'script', projectId: 'ios', category: 'self_media', trackingMode: 'checklist', progress: 0, segment: null },
      { title: '过去改稿（0.5）', plannedDate: '2026-01-01', stageKey: 'script', projectId: 'ios', category: 'self_media', trackingMode: 'checklist', progress: 100, segment: null },
      { title: '未来未分阶段', plannedDate: '2027-01-01', projectId: 'ios', category: 'self_media', trackingMode: 'checklist', progress: 0, segment: null }
    ])
    return rows.map((todo) => todo.id)
  })
}
async function overview(): Promise<void> {
  await main.evaluate(() => { window.location.hash = '#/project/ios/overview' })
  await expect(main.locator('.project-stage-grid')).toBeVisible()
}
test('R21n menu lock completes only the linked stage, confirms open tasks and can reopen', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await seed(); await overview()
  const row = tray.locator('.todo-companion-group article').filter({ hasText: '当前初稿' })
  await row.locator('.todo-project-link').click()
  const picker = tray.getByRole('dialog', { name: '关联待办项目' })
  await expect(picker.getByLabel('所属阶段')).toHaveValue('script')
  await picker.getByRole('button', { name: '完成文案阶段', exact: true }).click()
  await expect(picker.getByRole('group', { name: '确认完成阶段' })).toContainText('还有1条待办未完成')
  await picker.getByRole('button', { name: '取消', exact: true }).click()
  await expect(picker.getByRole('button', { name: '完成文案阶段', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: '完成文案阶段', exact: true }).click()
  await picker.getByRole('button', { name: '确认完成阶段', exact: true }).click()
  await expect(picker.getByRole('button', { name: '重新打开文案阶段', exact: true })).toBeVisible()
  await expect(row).not.toHaveClass(/completed/)
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getProject('ios', false)).modules.find((module) => module.key === 'script')?.completedAt)).toBeTruthy()
  await tray.screenshot({ path: info.outputPath('menu-stage-light.png') })
  await picker.getByRole('button', { name: '重新打开文案阶段', exact: true }).click()
  await expect(picker.getByRole('button', { name: '完成文案阶段', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: '关闭项目选择' }).click()
  await row.getByRole('button', { name: '完成当前初稿(2)', exact: true }).click()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getProject('ios', false)).modules.find((module) => module.key === 'script')?.completedAt)).toBeNull()
})

test('R21n project contains all dates and states; edited completed title, date and links are one live record', async () => {
  const ids = await seed(); await overview()
  const list = main.locator('[data-stage-key="script"] .project-linked-todos')
  await expect(list.locator('.project-todo-row')).toHaveCount(2)
  await expect(list).toContainText('2026-01-01')
  await main.getByText('未指定或已隐藏阶段的待办 · 1条', { exact: true }).click()
  await expect(main.locator('.stage-workspace-secondary').filter({ hasText: '未来未分阶段' })).toContainText('2027-01-01')
  await list.locator('.project-todo-row').filter({ hasText: '过去改稿（0.5）' }).click({ button: 'right' })
  await main.getByRole('menuitem', { name: '编辑待办', exact: true }).click()
  const editor = main.locator('.todo-context-popover.edit')
  await editor.getByLabel('内容', { exact: true }).fill('最终改稿(3)')
  await editor.getByLabel('日期', { exact: true }).fill('2026-02-02')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(list).toContainText('3小时'); await expect(list).toContainText('2026-02-02')
  const edited = await main.evaluate(async (id) => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find((todo) => todo.id === id), ids[1]!)
  expect(edited).toMatchObject({ title: '最终改稿(3)', status: 'completed', stageKey: 'script' })
  await list.locator('.project-todo-row').filter({hasText:'最终改稿(3)'}).locator('.todo-project-link').click()
  const picker = main.getByRole('dialog', { name: '关联待办项目' })
  const otherTitle = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).projects.find((project) => project.id === 'ai-browser')!.title)
  await picker.getByRole('button', { name: '更换关联项目' }).click()
  await picker.getByLabel('搜索关联项目').fill(otherTitle)
  await picker.getByRole('button', { name: otherTitle, exact: true }).click()
  await expect(list.locator('.project-todo-row')).toHaveCount(1)
  await main.evaluate(() => { window.location.hash = '#/project/ai-browser/overview' })
  await main.getByText('未指定或已隐藏阶段的待办 · 1条', { exact: true }).click()
  await expect(main.locator('.project-todo-row')).toContainText('最终改稿(3)')
  await expect(main.locator('.project-todo-row')).toContainText('未指定阶段')
  await main.reload()
  await expect(main.locator('.project-todo-row')).toContainText('3小时')
})

test('R21n project filters unassigned tasks and stage creates a task prelinked to itself', async () => {
  await seed(); await overview()
  await main.getByText('未指定或已隐藏阶段的待办 · 1条', { exact: true }).click()
  const unassigned = main.locator('.stage-workspace-secondary .project-linked-todos').first()
  await expect(unassigned.locator('.project-todo-row')).toHaveCount(1)
  await expect(unassigned).toContainText('未来未分阶段')
  const list = main.locator('[data-stage-key="script"] .project-linked-todos')
  await expect(list.locator('.project-todo-row')).toHaveCount(2)
  await list.getByRole('button', { name: '新增待办' }).click()
  await expect(list.getByLabel('新待办阶段')).toHaveValue('script')
  await list.getByLabel('待办内容').fill('项目内新增(1.5)')
  await list.getByRole('button', { name: '保存待办' }).click()
  await expect(list.locator('.project-todo-row')).toHaveCount(3)
  await expect(tray.locator('.todo-companion-group article').filter({ hasText: '项目内新增' })).toBeVisible()
  await main.locator('.project-todo-row').filter({ hasText: '项目内新增' }).click({ button: 'right' })
  await main.getByRole('menuitem', { name: '删除待办' }).click()
  await expect(list.locator('.project-todo-row')).toHaveCount(2)
  await expect(tray.locator('.todo-companion-group article').filter({ hasText: '项目内新增' })).toHaveCount(0)
})

test('R21n narrow real todo role permits only linked-stage mutation and rejects stale associations', async () => {
  const ids = await seed()
  const result = await tray.evaluate(async (todoId) => {
    const api = (globalThis as Globals).creatorOS
    const failures: string[] = []
    try { await api.setModuleCompleted('ios', 'script', true) } catch { failures.push('generic denied') }
    try { await api.getProject('ios', false) } catch { failures.push('detail denied') }
    try { await api.setTodoLinkedStageCompleted({ todoId, projectId: 'ai-browser', stageKey: 'script', expectedCompletedAt: null, completed: true, requestId: crypto.randomUUID() }) } catch { failures.push('mismatch denied') }
    await api.updateTodo(todoId, { stageKey: null })
    try { await api.setTodoLinkedStageCompleted({ todoId, projectId: 'ios', stageKey: 'script', expectedCompletedAt: null, completed: true, requestId: crypto.randomUUID() }) } catch { failures.push('stale denied') }
    return failures
  }, ids[0]!)
  expect(result).toEqual(['generic denied', 'detail denied', 'mismatch denied', 'stale denied'])
})

test('R21n compact lock and project list fit both themes without horizontal overflow', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await seed(); await overview()
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('index.html') && !item.webContents.getURL().includes('todo-tray')); window?.setSize(880, 720) })
  for (const theme of ['light', 'dark'] as const) {
    await main.evaluate((theme) => (globalThis as Globals).creatorOS.setPreferences({ theme }), theme)
    await expect(main.locator('.project-stage-grid')).toBeVisible()
    const geometry = await main.locator('.project-stage-grid').evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }))
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
    await main.screenshot({ path: info.outputPath(`project-todos-${theme}.png`) })
    await tray.locator('.todo-companion-group article').filter({ hasText: '当前初稿' }).locator('.todo-project-link').click()
    const picker = tray.getByRole('dialog', { name: '关联待办项目' })
    await expect(picker.getByLabel('所属阶段')).toHaveValue('script')
    const bounds = await picker.boundingBox(), viewport = await tray.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
    await tray.screenshot({ path: info.outputPath(`todo-stage-${theme}.png`) })
    await picker.getByRole('button', { name: '关闭项目选择' }).click()
  }
})

test('R21n companion draft can choose a project and stage without ever completing a stage', async () => {
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await tray.getByLabel('批量新建待办').fill('只写初稿(2)')
  await tray.locator('.todo-companion-drafts .todo-project-link').click()
  const picker = tray.getByRole('dialog', { name: '关联待办项目' })
  await picker.getByLabel('搜索关联项目').fill('iOS')
  await picker.getByRole('button', { name: 'iOS 27第一周体验', exact: true }).click()
  await picker.getByLabel('所属阶段').click()
  await tray.getByRole('menuitemradio', { name: '文案', exact: true }).click()
  await expect(picker.getByLabel('所属阶段')).toHaveValue('script')
  await expect(picker.getByRole('button', { name: '完成文案阶段', exact: true })).toHaveCount(0)
  await picker.getByRole('button', { name: '关闭项目选择' }).click()
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  const items = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).todos)
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ projectId: 'ios', stageKey: 'script', title: '只写初稿(2)', status: 'open' })
})

test('R21n stale title draft preserves a project association changed in another window', async () => {
  const ids = await seed()
  const row = main.locator('.todo-row').filter({ hasText: '当前初稿' })
  await row.click({ button: 'right' })
  await main.getByRole('menuitem', { name: '编辑待办' }).click()
  const editor = main.locator('.todo-context-popover.edit')
  await editor.getByLabel('内容', { exact: true }).fill('只改最终名字(4)')
  await tray.evaluate(async (id) => { await (globalThis as Globals).creatorOS.updateTodo(id, { projectId: 'ai-browser', stageKey: null }) }, ids[0]!)
  await expect(row.locator('.todo-project-link')).toHaveAttribute('data-project-id', 'ai-browser')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  const latest = await main.evaluate(async (id) => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find((todo) => todo.id === id), ids[0]!)
  expect(latest).toMatchObject({ title: '只改最终名字(4)', projectId: 'ai-browser', stageKey: null })
})


test('R21q click titles edits tray, home and project in place, including completed durations', async () => {
 const ids = await seed()
 const row = tray.locator(`[data-todo-id="${ids[0]}"]`)
 await row.getByRole('button', { name: '当前初稿(2)', exact: true }).click()
 const input = row.getByRole('textbox', { name: '修改待办文字' })
 await expect(input).toBeFocused()
 await expect(tray.locator('.todo-context-popover')).toHaveCount(0)
 await input.fill('当前初稿(3)'); await input.press('Enter')
 await expect(row.getByRole('button', { name: '当前初稿(3)', exact: true })).toBeVisible()
 await expect(main.locator('.todo-row').filter({ hasText: '当前初稿(3)' })).toBeVisible()
 await row.getByRole('button', { name: '完成当前初稿(3)', exact: true }).click()
 await row.getByRole('button', { name: '当前初稿(3)', exact: true }).click()
 await input.fill('完成后改成(4)'); await input.press('Tab')
 await expect(row).toHaveClass('completed')
 await expect(row.getByRole('button', { name: '完成后改成(4)', exact: true })).toBeVisible()
 await main.getByRole('button', { name: '完成后改成(4)', exact: true }).click()
 await main.getByRole('textbox', { name: '修改待办文字' }).fill('首页修改(5)')
 await main.getByRole('textbox', { name: '修改待办文字' }).press('Enter')
 await overview()
 const projectRow = main.locator(`.project-todo-row[data-todo-id="${ids[0]}"]`)
 await expect(projectRow).toContainText('5小时')
 await projectRow.getByRole('button', { name: '首页修改(5)', exact: true }).click()
 await projectRow.getByRole('textbox').fill('不填写时长')
 await projectRow.getByRole('textbox').press('Enter')
 await expect(projectRow).not.toContainText('5小时')
 await expect(row.getByRole('button', { name: '不填写时长', exact: true })).toBeVisible()
 await main.reload()
 await expect(main.locator(`.project-todo-row[data-todo-id="${ids[0]}"]`)).toContainText('不填写时长')
 const latest = await main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t => t.id === id), ids[0]!)
 expect(latest).toMatchObject({ title: '不填写时长', status: 'completed', projectId: 'ios', stageKey: 'script' })
})

test('R21q inline cancellation, empty input, IME and external association updates are safe', async () => {
 const ids = await seed(), row = tray.locator(`[data-todo-id="${ids[0]}"]`)
 await row.getByRole('button', { name: '当前初稿(2)', exact: true }).click()
 const input = row.getByRole('textbox')
 await input.fill('不要保存'); await input.press('Escape')
 await expect(row.getByRole('button', { name: '当前初稿(2)', exact: true })).toBeFocused()
 await row.getByRole('button', { name: '当前初稿(2)', exact: true }).click()
 await input.fill('   '); await input.press('Enter')
 await expect(row.getByRole('alert')).toContainText('不能为空')
 await input.fill('输入法确认(6)')
 await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
 await expect(input).toBeVisible()
 await main.evaluate(async id => { await (globalThis as Globals).creatorOS.updateTodo(id, { projectId: 'ai-browser', stageKey: null, category: 'other_work' }) }, ids[0]!)
 await input.press('Enter')
 const latest = await main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t => t.id === id), ids[0]!)
 expect(latest).toMatchObject({ title: '输入法确认(6)', projectId: 'ai-browser', stageKey: null, category: 'other_work' })
})

test('R21q inline title editing also works in real widget and preserves reorder controls', async () => {
 const ids = await seed()
 const opened = app.waitForEvent('window')
 await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('widget') })
 const widget = await opened
 await widget.getByRole('button', { name: '全部', exact: true }).click()
 const row = widget.locator(`[data-todo-id="${ids[0]}"]`)
 await row.getByRole('button', { name: '当前初稿(2)', exact: true }).click()
 await row.getByRole('textbox').fill('桌面最终(1.5)'); await row.getByRole('textbox').press('Enter')
 await expect(row.getByRole('button', { name: '拖动排序：桌面最终(1.5)', exact: true })).toHaveAttribute('draggable', 'true')
 await expect(tray.locator(`[data-todo-id="${ids[0]}"]`)).toContainText('桌面最终(1.5)')
 await expect.poll(() => widget.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('R21q failed save keeps draft and retry sends one title-only update', async () => {
 const ids = await seed()
 await app.evaluate(({ ipcMain }) => {
   const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
   const original = handlers.get('todo:update')!
   let fail = true
   ipcMain.removeHandler('todo:update')
   ipcMain.handle('todo:update', (...args) => {
     if (fail) { fail = false; throw new Error('测试保存失败') }
     return original(...args)
   })
 })
 const row = tray.locator(`[data-todo-id="${ids[0]}"]`)
 await row.getByRole('button', { name: '当前初稿(2)', exact: true }).click()
 const input = row.getByRole('textbox')
 await input.fill('失败后保留(2.5)'); await input.press('Enter')
 await expect(row.getByRole('alert')).toContainText('测试保存失败')
 await expect(input).toHaveValue('失败后保留(2.5)')
 await expect.poll(() => main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t => t.id === id)?.title, ids[0]!)).toBe('当前初稿(2)')
 await input.press('Enter')
 await expect(row.getByRole('button', { name: '失败后保留(2.5)', exact: true })).toBeVisible()
 await expect(row.getByRole('alert')).toHaveCount(0)
})
