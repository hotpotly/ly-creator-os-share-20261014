import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __focusTest: { create(mode: string): void; schedule(): void } }
let app: ElectronApplication, main: Page, tray: Page, widget: Page
const read = () => main.evaluate(() => (globalThis as Globals).creatorOS.getWorkspace())
const row = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"]`)
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..'), harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module=require('node:module'), fs=require('node:fs'), file=${JSON.stringify(join(root, 'out/main/index.js'))}; const m=new Module(file); m.filename=file; m.paths=Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file,'utf8')+'\\n;globalThis.__focusTest={create:createTodoWindow,schedule:createSchedulePanelWindow};',file);`)
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  main = await app.firstWindow()
  await expect.poll(async () => (await read()).today).toBeTruthy()
  await main.evaluate(async () => { const api = (globalThis as Globals).creatorOS; const s = await api.getWorkspace(); for (const t of s.todos) await api.dismissTodo(t.id) })
  let opened = app.waitForEvent('window'); await app.evaluate(() => { (globalThis as Globals).__focusTest.create('tray') }); tray = await opened
  await expect(tray.getByRole('button', { name: '这一步做到了' })).toBeVisible()
  opened = app.waitForEvent('window'); await tray.evaluate(() => (globalThis as Globals).creatorOS.openTodoWidget()); widget = await opened
  await expect(widget.getByRole('button', { name: '这一步做到了' })).toBeVisible()
})
test.afterEach(async () => { await app?.close() })
test('small step editing, completion, undo, manual navigation and date isolation persist across windows', async () => {
  const before = await read()
  await tray.getByRole('button', { name: '修改一小步' }).click()
  await tray.getByLabel('一小步内容').fill('打开originos文档')
  await tray.getByRole('button', { name: '保存', exact: true }).click()
  await expect(widget.getByRole('heading', { name: '打开originos文档' })).toBeVisible()
  await tray.getByRole('button', { name: '这一步做到了' }).click()
  for (const page of [tray, widget]) await expect(page.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
  expect((await read()).todos).toEqual(before.todos)
  await tray.getByRole('button', { name: '更多待办操作', exact: true }).click()
  await tray.getByRole('button', { name: '查看已完成的一小步', exact: true }).click()
  await tray.getByRole('button', { name: '撤销完成', exact: true }).click()
  await expect(widget.getByRole('button', { name: '这一步做到了' })).toBeVisible()
  await tray.getByRole('button', { name: '普通待办', exact: true }).click()
  await tray.reload()
  await expect(tray.getByRole('button', { name: '普通待办', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(tray.getByRole('button', { name: '普通待办', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await tray.getByRole('button', { name: '一小步', exact: true }).click()
  await expect(tray.getByRole('heading', { name: '先推进一小步' })).toBeVisible()
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await tray.getByRole('button', { name: '一小步', exact: true }).click()
  await expect(tray.getByRole('heading', { name: '打开originos文档' })).toBeVisible()
  const plannedDay = (await read()).todoDays!.find(d => d.day !== before.today)!
  expect(plannedDay.entered).toBe(false)
  await main.evaluate(async d => { await (globalThis as Globals).creatorOS.writeTodoDay({ day: d.day, expectedRevision: d.revision, patch: { view: 'regular' } }) }, plannedDay)
  await app.evaluate((_, day) => { process.env.CREATOR_OS_TEST_DATE = day }, plannedDay.day)
  await tray.reload()
  await expect(tray.getByRole('button', { name: '这一步做到了' })).toBeVisible()
  await expect.poll(async () => (await read()).todoDays?.find(d => d.day === plannedDay.day)?.entered).toBe(true)
})
test('normal progress is unchanged, extras auto-show once and manual hiding never deletes data', async () => {
  const tasks = await main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, { today } = await api.getWorkspace()
    return api.createTodoBatch([false, true].map(isExtra => ({ title: isExtra ? '额外素材' : '普通文案', plannedDate: today, segment: null, category: 'self_media', projectId: null, trackingMode: 'progress', progress: 35, isExtra })))
  })
  const normal = tasks[0]!, extra = tasks[1]!
  await tray.getByRole('button', { name: '普通待办', exact: true }).click()
  await expect(row(tray, normal.id)).toBeVisible(); await expect(row(tray, extra.id)).toHaveCount(0)
  await row(tray, normal.id).locator('.todo-check').click()
  await expect(row(tray, extra.id)).toBeVisible(); await expect(row(widget, extra.id)).toBeVisible()
  await tray.getByRole('button', { name: '不显示额外', exact: true }).click()
  await expect(row(widget, extra.id)).toHaveCount(0)
  await tray.reload()
  await expect(tray.getByRole('button', { name: '显示额外', exact: true })).toBeVisible()
  expect((await read()).todos.find(t => t.id === extra.id)).toMatchObject({ isExtra: true, progress: 35 })
  await row(tray, normal.id).locator('.todo-check').click()
  await expect.poll(async () => (await read()).todos.find(t => t.id === normal.id)?.progress).toBe(35)
  await row(tray, normal.id).locator('.todo-check').click()
  await expect(row(tray, extra.id)).toBeVisible()
  await tray.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await read()).todos.find(t => t.id === normal.id)?.progress).toBe(35)
  await tray.getByRole('button', { name: '待办视图' }).click()
  await tray.getByRole('menuitemradio', { name: '按分类' }).click()
  await expect(row(tray, normal.id)).toBeVisible()
  await tray.getByRole('button', { name: '更多待办操作', exact: true }).click()
  await expect(tray.getByRole('button', { name: '浮在桌面' })).toBeVisible()
  await expect(tray.getByRole('button', { name: '打开主窗口' })).toBeVisible()
  await tray.getByRole('button', { name: '批量关联待办', exact: true }).click()
  await expect(tray.getByRole('group', { name: '选择要关联的待办' })).toBeVisible()
  await tray.keyboard.press('Escape')
})
test('extras can be created and reclassified without adding a third screen; narrow theme layouts stay usable', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium'); test.setTimeout(60000)
  await tray.getByRole('button', { name: '普通待办', exact: true }).click()
  await expect(tray.getByRole('button', { name: '显示额外', exact: true })).toBeVisible()
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await tray.getByLabel('额外', { exact: true }).check()
  await tray.getByLabel('批量新建待办', { exact: true }).fill('额外整理照片')
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveCount(0)
  const extra = (await read()).todos.find(t => t.title === '额外整理照片')!
  expect(extra.isExtra).toBe(true)
  await expect(row(tray, extra.id)).toBeVisible()
  await row(tray, extra.id).click({ button: 'right' })
  await tray.getByRole('menuitem', { name: '改为普通待办' }).click()
  await expect.poll(async () => (await read()).todos.find(t => t.id === extra.id)?.isExtra).toBe(false)
  await expect(tray.getByRole('group', { name: '待办阶段' }).getByRole('button')).toHaveCount(2)
  for (const visualStyle of ['warm', 'feishu']) for (const theme of ['light', 'dark']) for (const width of [320, 420]) {
    await tray.setViewportSize({ width, height: 300 })
    await tray.evaluate(({ visualStyle, theme }) => { document.documentElement.dataset.visualStyle = visualStyle; document.documentElement.dataset.theme = theme }, { visualStyle, theme })
    for (const state of ['一小步', '普通待办']) {
      await tray.getByRole('button', { name: state, exact: true }).click()
      await expect(tray.getByRole('button', { name: state, exact: true })).toHaveAttribute('aria-pressed', 'true')
      const geometry = await tray.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, bottom: document.querySelector('.todo-work-log')!.getBoundingClientRect().bottom, height: innerHeight }))
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width)
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1)
      if (width === 420 && visualStyle === 'feishu') await tray.screenshot({ path: info.outputPath(`${theme}-${state}.png`) })
    }
  }
})
test('daily focus writes reject stale revisions and schedule-window writes', async () => {
  const result = await main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, s = await api.getWorkspace(), d = s.todoDays!.find(d => d.day === s.today)!
    await api.writeTodoDay({ day: s.today, expectedRevision: d.revision, patch: { smallStep: '新内容' } })
    try { await api.writeTodoDay({ day: s.today, expectedRevision: d.revision, patch: { smallStep: '旧内容' } }); return false } catch { return true }
  })
  expect(result).toBe(true)
  await expect(tray.getByRole('heading', { name: '新内容' })).toBeVisible()
  await tray.getByRole('button', { name: '修改一小步' }).click()
  await tray.getByLabel('一小步内容').fill('保留我的草稿')
  await main.evaluate(async () => { const api = (globalThis as Globals).creatorOS, s = await api.getWorkspace(), d = s.todoDays!.find(d => d.day === s.today)!; await api.writeTodoDay({ day: s.today, expectedRevision: d.revision, patch: { smallStep: '另一个窗口的内容' } }) })
  await tray.getByRole('button', { name: '保存', exact: true }).click()
  await expect(tray.getByRole('alert')).toContainText('其他窗口更新')
  await expect(tray.getByLabel('一小步内容')).toHaveValue('保留我的草稿')
  await tray.getByRole('button', { name: '保存', exact: true }).click()
  await expect(widget.getByRole('heading', { name: '保留我的草稿' })).toBeVisible()
  const opened = app.waitForEvent('window'); await app.evaluate(() => (globalThis as Globals).__focusTest.schedule()); const schedule = await opened
  await expect.poll(() => schedule.evaluate(() => Boolean((globalThis as Globals).creatorOS))).toBe(true)
  expect(await schedule.evaluate(async () => { try { await (globalThis as Globals).creatorOS.writeTodoDay({ day: '2026-10-02', expectedRevision: 0, patch: { showExtra: true } }); return true } catch { return false } })).toBe(false)
})


test('travel skins remain identical between small and ordinary views in both themes', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await tray.setViewportSize({ width: 420, height: 520 })
  for (const kind of ['business', 'home', 'rest'] as const) {
    await main.evaluate(async kind => {
      const api = (globalThis as Globals).creatorOS, s = await api.getWorkspace()
      for (const t of s.schedules.filter(t => t.trip && !t.trip.cancelled)) await api.saveBusinessTrip({ action: 'cancel', scheduleId: t.id, expectedUpdatedAt: t.updatedAt, kind: t.trip?.kind, title: t.title, projectId: t.projectId, startDate: s.today, endDate: s.today, notes: '' })
      await api.saveBusinessTrip({ kind, action: 'save', scheduleId: null, expectedUpdatedAt: null, title: kind === 'business' ? '广州出差' : kind === 'home' ? '回老家' : '休息', projectId: null, startDate: s.today, endDate: s.today, notes: '' })
    }, kind)
    await expect(tray.locator('.todo-companion')).toHaveClass(new RegExp(`travel-surface-${kind}`))
    for (const theme of ['light', 'dark']) {
      await tray.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await tray.getByRole('button', { name: '一小步', exact: true }).click()
      const background = await tray.locator('.todo-companion').evaluate(el => getComputedStyle(el).background)
      await tray.getByRole('button', { name: '普通待办', exact: true }).click()
      expect(await tray.locator('.todo-companion').evaluate(el => getComputedStyle(el).background)).toBe(background)
      await expect(tray.locator('.business-trip-summary')).toHaveCount(1)
      if (kind === 'business') await tray.screenshot({ path: info.outputPath(`travel-${theme}.png`) })
    }
  }
})
