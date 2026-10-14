import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __focusTest: { create(mode: string): void; schedule(): void } }
let app: ElectronApplication, main: Page, tray: Page, widget: Page
const read = () => main.evaluate(() => (globalThis as Globals).creatorOS.getWorkspace())
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
const complete = (page: Page) => page.getByRole('button', { name: '这一步做到了', exact: true })
const smallTab = (page: Page) => page.getByRole('button', { name: '一小步', exact: true })
const openSmallStep = async (page: Page) => {
  if (await smallTab(page).count()) await smallTab(page).click()
  else {
    await page.getByRole('button', { name: '更多待办操作', exact: true }).click()
    await page.getByRole('button', { name: '查看已完成的一小步', exact: true }).click()
  }
}

test('saved completion celebrates only in the initiating window and leaves a distinct persistent completion card', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await tray.setViewportSize({ width: 420, height: 540 })
  await tray.evaluate(() => { document.documentElement.dataset.visualStyle = 'feishu'; document.documentElement.dataset.theme = 'light' })
  await tray.getByRole('button', { name: '修改一小步' }).click()
  await tray.getByLabel('一小步内容').fill('500字originos（3700字）')
  await tray.getByLabel('一小步内容').press('Enter')
  await expect(tray.getByRole('heading', { name: '500字originos（3700字）' })).toBeVisible()
  await tray.screenshot({ path: info.outputPath('before.png') })
  const before = await read()
  await complete(tray).click()
  await expect(tray.locator('.todo-small-step')).toHaveAttribute('data-celebrating', 'true')
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  await expect(tray.locator('.todo-small-confetti i')).toHaveCount(24)
  for (const page of [tray, widget]) await expect(smallTab(page)).toHaveCount(0)
  await expect(tray.getByRole('button', { name: '查看普通待办', exact: true })).toHaveCount(0)
  await expect(tray.getByRole('button', { name: '修改一小步' })).toHaveCount(0)
  await expect(widget.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
  await expect(widget.locator('.todo-small-confetti')).toHaveCount(0)
  await tray.screenshot({ path: info.outputPath('celebration.png') })
  await expect(tray.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
  expect((await read()).todos).toEqual(before.todos)
  await expect(tray.locator('.todo-list-options').getByRole('button', { name: '撤销一小步完成' })).toHaveCount(0)
  await openSmallStep(tray)
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  await expect(tray.locator('.todo-small-result')).toHaveText('500字originos（3700字）')
  const textStyle = await tray.locator('.todo-small-result').evaluate(el => { const style = getComputedStyle(el); return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight), color: style.color, heading: getComputedStyle(el.parentElement!.querySelector('h2')!).color } })
  expect(textStyle.size).toBeGreaterThanOrEqual(16)
  expect(textStyle.weight).toBeGreaterThanOrEqual(500)
  expect(textStyle.color).toBe(textStyle.heading)
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
  await tray.screenshot({ path: info.outputPath('completed.png') })
  await tray.reload()
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
  await tray.getByRole('button', { name: '撤销完成', exact: true }).click()
  await expect(complete(tray)).toBeVisible()
  await expect(tray.getByRole('button', { name: '修改一小步' })).toBeVisible()
  for (const page of [tray, widget]) await expect(smallTab(page)).toBeVisible()
  await tray.getByRole('button', { name: '更多待办操作', exact: true }).click()
  await expect(tray.getByRole('button', { name: '查看已完成的一小步' })).toHaveCount(0)
})

test('double click writes once; undo and manual navigation interrupt feedback without delayed writes', async () => {
  const initial = await read()
  const before = initial.todoDays!.find(day => day.day === initial.today)!
  await complete(tray).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(tray.locator('.todo-small-step')).toHaveAttribute('data-celebrating', 'true')
  expect((await read()).todoDays!.find(day => day.day === before.day)!.revision).toBe(before.revision + 1)
  await tray.getByRole('button', { name: '撤销一小步完成' }).click()
  await expect(complete(tray)).toBeVisible()
  await tray.waitForTimeout(1050)
  await expect(complete(tray)).toBeVisible()
  await complete(tray).click()
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(1)
  await openSmallStep(tray)
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
  await tray.waitForTimeout(1050)
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  await tray.getByRole('button', { name: '撤销完成', exact: true }).click()
  await complete(tray).click()
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(1)
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await openSmallStep(tray)
  await expect(tray.getByRole('heading', { name: '先推进一小步' })).toBeVisible()
  await tray.waitForTimeout(1050)
  await expect(complete(tray)).toBeVisible()
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await openSmallStep(tray)
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
})

test('failed persistence never celebrates or pretends the small step was completed', async () => {
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('todo:day-write'); ipcMain.handle('todo:day-write', () => { throw new Error('保存失败，请重试') }) })
  await complete(tray).click()
  await expect(tray.getByRole('alert')).toContainText('保存失败')
  await expect(complete(tray)).toBeEnabled()
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
  const state = await read()
  expect(state.todoDays!.find(day => day.day === state.today)!.smallCompleted).toBe(false)
})

test('reduced motion shows a static success result and allows the normal navigation immediately', async () => {
  await tray.emulateMedia({ reducedMotion: 'reduce' })
  await complete(tray).click()
  await expect(tray.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
  await openSmallStep(tray)
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  expect(await tray.locator('.todo-small-emblem > svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
})

test('light/dark skins, small windows, long text and keyboard editing remain usable', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium'); test.setTimeout(60000)
  await tray.getByRole('button', { name: '修改一小步' }).click()
  await tray.getByLabel('一小步内容').fill('取消的草稿')
  await tray.getByLabel('一小步内容').press('Escape')
  await expect(tray.getByRole('heading', { name: '先推进一小步' })).toBeVisible()
  for (const kind of ['business', 'home', 'rest'] as const) {
    await main.evaluate(async kind => {
      const api = (globalThis as Globals).creatorOS, s = await api.getWorkspace()
      for (const t of s.schedules.filter(t => t.trip && !t.trip.cancelled)) await api.saveBusinessTrip({ action: 'cancel', scheduleId: t.id, expectedUpdatedAt: t.updatedAt, kind: t.trip?.kind, title: t.title, projectId: t.projectId, startDate: s.today, endDate: s.today, notes: '' })
      await api.saveBusinessTrip({ kind, action: 'save', scheduleId: null, expectedUpdatedAt: null, title: kind === 'business' ? '广州出差' : kind === 'home' ? '回老家' : '休息', projectId: null, startDate: s.today, endDate: s.today, notes: '' })
    }, kind)
    await expect(tray.locator('.todo-companion')).toHaveClass(new RegExp(`travel-surface-${kind}`))
    for (const visualStyle of ['warm', 'feishu']) for (const theme of ['light', 'dark']) for (const width of [280, 320, 420]) {
      await tray.setViewportSize({ width, height: 360 })
      await tray.evaluate(({ visualStyle, theme }) => { document.documentElement.dataset.visualStyle = visualStyle; document.documentElement.dataset.theme = theme }, { visualStyle, theme })
      const background = await tray.locator('.todo-companion').evaluate(el => getComputedStyle(el).background)
      for (const completed of [false, true]) {
        await main.evaluate(async completed => { const api = (globalThis as Globals).creatorOS, s = await api.getWorkspace(), day = s.todoDays!.find(day => day.day === s.today)!; await api.writeTodoDay({ day: day.day, expectedRevision: day.revision, patch: { smallCompleted: completed, smallStep: '打开originOS文档，写500字开头', view: 'small' } }) }, completed)
        await expect(tray.getByRole('heading', { name: completed ? '一小步已完成' : '打开originOS文档，写500字开头' })).toBeVisible()
        expect(await tray.locator('.todo-companion').evaluate(el => getComputedStyle(el).background)).toBe(background)
        await expect(tray.locator('.business-trip-summary')).toHaveCount(1)
        const geometry = await tray.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, bottom: document.querySelector('.todo-work-log')!.getBoundingClientRect().bottom, height: innerHeight }))
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.width)
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1)
        await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
        if (completed && width >= 320) await expect(tray.getByRole('button', { name: '撤销完成', exact: true })).toBeInViewport()
        if (kind === 'business' && visualStyle === 'feishu' && width === 420 && completed) await tray.screenshot({ path: info.outputPath(`completed-${theme}-travel.png`) })
      }
    }
  }
  await tray.setViewportSize({ width: 320, height: 300 })
  await tray.getByRole('button', { name: '撤销完成', exact: true }).click()
  await tray.getByRole('button', { name: '修改一小步' }).click()
  await tray.getByLabel('一小步内容').fill('长内容'.repeat(100))
  await tray.getByLabel('一小步内容').press('Enter')
  await complete(tray).scrollIntoViewIfNeeded()
  await expect(complete(tray)).toBeInViewport()
  expect(await tray.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})


test('completed entry lives only in more and follows each date without adding a return button to the card', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await tray.setViewportSize({ width: 280, height: 380 })
  await complete(tray).click()
  await expect(tray.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
  await expect(tray.getByRole('group', { name: '待办阶段' })).toHaveCount(0)
  await tray.getByRole('button', { name: '更多待办操作', exact: true }).click()
  await expect(tray.getByRole('button', { name: '查看已完成的一小步' })).toBeVisible()
  await tray.screenshot({ path: info.outputPath('completed-in-more.png') })
  await tray.getByRole('button', { name: '查看已完成的一小步' }).press('Enter')
  await expect(tray.getByRole('heading', { name: '一小步已完成' })).toBeVisible()
  await expect(tray.getByRole('button', { name: '查看普通待办', exact: true })).toHaveCount(0)
  await tray.getByRole('button', { name: '返回待办列表', exact: true }).click()
  await expect(tray.locator('.todo-small-step')).toHaveCount(0)
  await tray.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(smallTab(tray)).toBeVisible()
  await tray.getByRole('button', { name: '更多待办操作', exact: true }).click()
  await expect(tray.getByRole('button', { name: '查看已完成的一小步' })).toHaveCount(0)
  await tray.keyboard.press('Escape')
  await tray.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(smallTab(tray)).toHaveCount(0)
  await openSmallStep(tray)
  await expect(tray.locator('.todo-small-confetti')).toHaveCount(0)
  await tray.getByRole('button', { name: '撤销完成', exact: true }).click()
  await expect(smallTab(tray)).toBeVisible()
  await expect(complete(tray)).toBeVisible()
})

test('completed lists merge controls into group headings across views and narrow windows', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium'); test.setTimeout(60000)
  await main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, { today } = await api.getWorkspace()
    await api.createTodoBatch([
      { title: 'originos文案6小时', plannedDate: today, segment: 'morning', category: 'self_media', projectId: null, trackingMode: 'progress', progress: 35 },
      { title: '健身房', plannedDate: today, segment: 'evening', category: 'life', projectId: null, trackingMode: 'checklist', progress: 0 },
      { title: '整理额外素材', plannedDate: today, segment: null, category: 'life', projectId: null, trackingMode: 'checklist', progress: 0, isExtra: true }
    ])
  })
  await complete(tray).click()
  for (const page of [tray, widget]) {
    await expect(page.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
    await expect(page.locator('.focus-toolbar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '普通待办', exact: true })).toHaveCount(0)
    await expect(page.locator('.todo-companion-titlebar').getByRole('button', { name: '安排行程', exact: true })).toBeVisible()
    await expect(page.locator('.todo-companion-group > header .todo-list-options')).toHaveCount(1)
  }
  for (const view of ['全部', '按时间', '按分类']) {
    await tray.getByRole('button', { name: '待办视图', exact: true }).click()
    await tray.getByRole('menuitemradio', { name: view, exact: true }).click()
    for (const theme of ['light', 'dark']) for (const width of [240, 280, 320, 420]) {
      await tray.setViewportSize({ width, height: 380 })
      await tray.evaluate(theme => { document.documentElement.dataset.visualStyle = 'feishu'; document.documentElement.dataset.theme = theme }, theme)
      const geometry = await tray.evaluate(() => {
        const heading = document.querySelector('.todo-companion-group > header')!, caption = heading.querySelector('.todo-group-caption')!.getBoundingClientRect(), controls = heading.querySelector('.todo-list-options')!.getBoundingClientRect()
        return { scroll: document.documentElement.scrollWidth, width: innerWidth, captionRight: caption.right, controlsLeft: controls.left, centerDifference: Math.abs(caption.y + caption.height / 2 - controls.y - controls.height / 2), footerBottom: document.querySelector('.todo-work-log')!.getBoundingClientRect().bottom, height: innerHeight }
      })
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width)
      expect(geometry.captionRight).toBeLessThanOrEqual(geometry.controlsLeft)
      expect(geometry.centerDifference).toBeLessThanOrEqual(1)
      expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.height + 1)
      for (const name of ['安排行程', '更多待办操作', '待办视图', '显示额外']) await expect(tray.getByRole('button', { name, exact: true })).toBeInViewport()
      if (view === '全部' && width === 280) await tray.screenshot({ path: info.outputPath(`merged-list-${theme}.png`) })
    }
  }
  await tray.getByRole('button', { name: '显示额外', exact: true }).click()
  for (const page of [tray, widget]) {
    await expect(page.getByRole('button', { name: '不显示额外', exact: true })).toBeVisible()
    await expect(page.locator('.todo-companion-group > header .todo-list-options')).toHaveCount(1)
    await expect(page.getByText('整理额外素材', { exact: true })).toBeVisible()
  }
  await tray.getByRole('button', { name: '不显示额外', exact: true }).click()
  await expect(tray.getByText('整理额外素材', { exact: true })).toHaveCount(0)
  await tray.getByRole('button', { name: '安排行程', exact: true }).click()
  await expect(tray.getByRole('group', { name: '行程类型', exact: true })).toBeVisible()
  await tray.getByRole('button', { name: '关闭出差安排', exact: true }).click()
  await openSmallStep(tray)
  await expect(tray.getByRole('button', { name: '返回待办列表', exact: true })).toBeVisible()
  await tray.getByRole('button', { name: '返回待办列表', exact: true }).click()
  await expect(tray.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
})

test('empty, extra-only and named-range lists keep one compact controls entry', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await tray.setViewportSize({ width: 280, height: 380 })
  await tray.evaluate(() => { document.documentElement.dataset.visualStyle = 'feishu'; document.documentElement.dataset.theme = 'light' })
  await complete(tray).click()
  await expect(tray.locator('.todo-companion')).toHaveAttribute('data-focus-view', 'regular')
  await expect(tray.locator('.todo-empty-heading .todo-list-options')).toBeVisible()
  await expect(tray.locator('.todo-list-options')).toHaveCount(1)
  await tray.screenshot({ path: info.outputPath('empty-merged.png') })
  await tray.getByRole('button', { name: '显示额外', exact: true }).click()
  await tray.getByRole('button', { name: '新建额外待办', exact: true }).click()
  await tray.getByLabel('批量新建待办', { exact: true }).fill('额外读书')
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveValue('')
  await tray.getByRole('button', { name: '收起新建待办', exact: true }).click()
  await expect(tray.getByText('额外读书', { exact: true })).toBeVisible()
  await expect(tray.locator('.todo-companion-group > header .todo-list-options')).toHaveCount(1)
  await tray.getByRole('button', { name: '不显示额外', exact: true }).click()
  await expect(tray.locator('.todo-empty-heading .todo-list-options')).toBeVisible()
  await main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, { today } = await api.getWorkspace()
    await api.createTodoBatch([{ title: '整理一组资料', plannedDate: null, dateRange: { name: '很长的日期范围名称用于检查窄窗口布局', startDate: today, endDate: today }, segment: null, category: 'self_media', projectId: null, trackingMode: 'checklist', progress: 0 }])
  })
  await expect(tray.locator('.todo-companion-group[data-date-range] .todo-list-options')).toBeVisible()
  await expect(tray.locator('.todo-list-options')).toHaveCount(1)
  for (const width of [240, 280, 420]) {
    await tray.setViewportSize({ width, height: 380 })
    expect(await tray.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(tray.getByRole('button', { name: '显示额外', exact: true })).toBeInViewport()
    await expect(tray.getByRole('button', { name: '待办视图', exact: true })).toBeInViewport()
  }
})
