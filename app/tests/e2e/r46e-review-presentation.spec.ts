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
test('daily hours distinguish missing and zero and use shared threshold colors; review checks match tray and edit same todos', async ({ browserName }, info) => {
 expect(browserName).toBe('chromium')
 const todoId = await page.evaluate(async () => {
  const api = (globalThis as Globals).creatorOS
  for (const [day, minutes] of [['2026-09-22',0],['2026-09-23',359],['2026-09-24',360],['2026-09-27',420]] as const) await api.setDailyWorkLogTotal(day, minutes, await api.getDailyWorkLog(day))
  const todos = await api.createTodoBatch([{ title: '统一勾选格式', category: 'self_media', suggestedCategory: 'self_media', plannedDate: '2026-09-27', segment: 'morning', projectId: null, stageKey: null, trackingMode: 'checklist', progress: 0 }])
  location.hash = '#/reviews?kind=weekly&anchor=2026-09-27'
  return todos[0]!.id
 })
 await expect(page.locator('.review-schedule')).toHaveAttribute('open', '')
 const rows = page.locator('.review-schedule')
 for (const [day, tone, text] of [['21','missing','未记录'],['22','zero','0小时'],['23','low','5小时59分钟'],['24','enough','6小时'],['27','enough','7小时']]) {
  const value = rows.locator(`.todo-work-log[data-day="2026-09-${day}"] b`)
  await expect(value).toHaveText(text!)
  await expect(value).toHaveAttribute('data-work-tone', tone!)
 }
 const check = rows.locator(`[data-todo-id="${todoId}"] .todo-check`)
 await check.click()
 await expect(check).toHaveAttribute('data-completed', 'true')
 await expect(check.locator('svg')).toBeVisible()
 await expect(rows.locator(`[data-todo-id="${todoId}"] .todo-title-link`)).toHaveCSS('text-decoration-line', 'line-through')
 const opened = app.waitForEvent('window')
 await app.evaluate(() => (globalThis as Globals).__reviewTravelTest.create('tray'))
 const tray = await opened, trayCheck = tray.locator(`[data-todo-id="${todoId}"] .todo-check`)
 await expect(trayCheck).toHaveAttribute('data-completed', 'true')
 await expect(tray.locator('.todo-work-log b')).toHaveAttribute('data-work-tone', 'enough')
 const style = (el: HTMLElement) => { const s = getComputedStyle(el); return [s.width, s.height, s.borderRadius, s.backgroundColor, s.borderColor] }
 expect(await check.evaluate(style)).toEqual(await trayCheck.evaluate(style))
 await trayCheck.click()
 await expect(check).toHaveAttribute('data-completed', 'false')
 await rows.locator(`[data-todo-id="${todoId}"] .todo-title-link`).click()
 await rows.getByLabel('修改待办文字').fill('菜单栏同步改名')
 await rows.getByLabel('修改待办文字').press('Enter')
 await expect(tray.locator(`[data-todo-id="${todoId}"] .todo-title-link`)).toHaveText('菜单栏同步改名')
 await trayCheck.click()
 for (const theme of ['light','dark']) for (const visualStyle of ['warm','feishu']) {
  await page.evaluate(([theme,visualStyle]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = visualStyle }, [theme,visualStyle])
  for (const [day, token] of [['21','text-supporting'],['22','danger'],['23','warning'],['24','success']]) {
   const value = rows.locator(`.todo-work-log[data-day="2026-09-${day}"] b`)
   expect(await value.evaluate((el, token) => { const probe = document.createElement('span'); probe.style.color = `var(--${token})`; el.append(probe); const expected = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(el).color === expected }, token!)).toBe(true)
   await page.locator(`.review-chart-points button[data-day="2026-09-${day}"]`).hover()
   const output = page.getByLabel('每日工时读数').locator('strong')
   await expect(output).toHaveAttribute('data-work-tone', day === '21' ? 'missing' : day === '22' ? 'zero' : day === '23' ? 'low' : 'enough')
   expect(await output.evaluate((el, token) => { const probe = document.createElement('span'); probe.style.color = `var(--${token})`; el.append(probe); const expected = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(el).color === expected }, token!)).toBe(true)
  }
 }
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 900))
 await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
 await rows.scrollIntoViewIfNeeded()
 await page.screenshot({ path: info.outputPath('daily-checks-hours.png') })
 await rows.locator('.todo-work-log[data-day="2026-09-21"]').getByRole('button', { name: '记录', exact: true }).click()
 await page.getByRole('dialog').getByLabel('总时长').fill('0')
 await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
 await expect(rows.locator('.todo-work-log[data-day="2026-09-21"] b')).toHaveText('0小时')
 await expect(rows.locator('.todo-work-log[data-day="2026-09-21"] b')).toHaveAttribute('data-work-tone','zero')
 await page.reload()
 await expect(page.locator('.review-schedule')).toHaveAttribute('open', '')
 await expect(rows.locator('.todo-work-log[data-day="2026-09-21"] b')).toHaveAttribute('data-work-tone','zero')
})
