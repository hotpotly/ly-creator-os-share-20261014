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
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-21T15:00:00', CREATOR_OS_TEST_DATE: '2026-09-21', CREATOR_OS_TEST_TIME_ZONE: 'Asia/Shanghai', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
})
test.afterEach(async () => { await app?.close() })
async function seed(): Promise<string> {
  return main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, ws = await api.getWorkspace()
    await api.updateStageTime('ios', 'script', { startedAt: null, completedAt: null, source: 'manual' })
    await api.createSchedule({ projectId: 'ios', actionType: 'script', title: '文案计划', startAt: '2026-09-17T09:00:00+08:00', endAt: '2026-09-19T17:00:00+08:00', scheduleKind: 'plan', waitingFor: null })
    return (await api.createTodoBatch([{ title: 'R21ab文案（4）', plannedDate: ws.today, projectId: 'ios', stageKey: 'script', category: 'self_media', segment: 'afternoon', trackingMode: 'checklist', progress: 0 }]))[0]!.id
  })
}
function picker(page = tray) { return page.getByRole('dialog', { name: '关联待办项目' }) }
async function open(id: string, page = tray) { await page.locator(`[data-todo-id="${id}"] .todo-project-link`).click(); await expect(picker(page).getByLabel('所属阶段')).toHaveValue('script') }

test('R21ab menu starts and backfills phase completion without checking todo; report reads same facts and estimates', async () => {
  const id = await seed(); await open(id)
  await expect(picker()).toContainText('2026/09/17')
  await picker().getByRole('button', { name: '开始文案阶段', exact: true }).click()
  await expect(picker().getByLabel('实际开始日期')).toHaveValue('2026-09-21')
  await picker().getByLabel('实际开始日期').fill('2026-09-18')
  await picker().getByRole('button', { name: '确认开始阶段', exact: true }).click()
  await expect(picker()).toContainText('2026/09/18')
  await expect(picker().getByRole('button', { name: '开始文案阶段', exact: true })).toHaveCount(0)
  await picker().getByRole('button', { name: '完成文案阶段', exact: true }).click()
  await expect(picker().getByRole('group', { name: '确认完成阶段' })).toContainText('还有1条待办未完成')
  await picker().getByLabel('实际完成日期').fill('2026-09-20')
  await picker().getByRole('button', { name: '确认完成阶段', exact: true }).click()
  await expect(picker().getByRole('button', { name: '重新打开文案阶段', exact: true })).toBeVisible()
  expect(await main.evaluate(async id => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(item => item.id === id)?.status, id)).toBe('open')
  await main.evaluate(() => { location.hash = '#/reports?mode=project&project=ios' })
  await expect(main.getByRole('heading', { name: '阶段待办预计' })).toBeVisible()
  const result = await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getProjectCreationReview('ios')).stages.find(item => item.stageKey === 'script'))
  expect(result).toMatchObject({ startedAt: { localDate: '2026-09-18' }, completedAt: { localDate: '2026-09-20' }, plannedStartAt: { localDate: '2026-09-17' }, actualEffortHalfDayUnits: null })
  await expect(main.locator('.report-stage-estimates')).toContainText('4小时')
  await picker().getByRole('button', { name: '补记／更正时间', exact: true }).click()
  await picker().getByLabel('实际开始日期').fill('2026-09-17')
  await picker().getByRole('button', { name: '保存阶段时间', exact: true }).click()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getProjectCreationReview('ios')).stages.find(item => item.stageKey === 'script')?.startedAt?.localDate)).toBe('2026-09-17')
})

test('R21ab cancellation, invalid date ordering and stale cross-window draft cannot overwrite stage facts', async () => {
  const id = await seed(); await open(id)
  await picker().getByRole('button', { name: '开始文案阶段', exact: true }).click()
  await picker().getByRole('button', { name: '取消', exact: true }).click()
  expect(await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getTodoProjectStages('ios')).find(item => item.key === 'script')?.startedAt)).toBeNull()
  await picker().getByRole('button', { name: '完成文案阶段', exact: true }).click()
  await picker().getByLabel('实际开始日期').fill('2026-09-20')
  await picker().getByLabel('实际完成日期').fill('2026-09-19')
  await picker().getByRole('button', { name: '确认完成阶段', exact: true }).click()
  await expect(picker().getByRole('alert')).toBeVisible()
  expect(await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getTodoProjectStages('ios')).find(item => item.key === 'script')?.startedAt)).toBeNull()
  await picker().getByRole('button', { name: '取消', exact: true }).click()
  await picker().getByRole('button', { name: '开始文案阶段', exact: true }).click()
  await main.evaluate(async () => (globalThis as Globals).creatorOS.updateStageTime('ios', 'script', { startedAt: { localDate: '2026-09-17', segment: 'morning' }, source: 'manual' }))
  await picker().getByRole('button', { name: '确认开始阶段', exact: true }).click()
  await expect(picker().getByRole('alert')).toContainText('阶段时间已变化')
  expect(await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getTodoProjectStages('ios')).find(item => item.key === 'script')?.startedAt?.localDate)).toBe('2026-09-17')
})

test('R21ab draft stage recommendation is visible, editable, clearable and never starts phase during creation', async () => {
  const project = await main.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    await api.setProjectModule('ios', 'editing', true)
    await api.updateStageTime('ios', 'editing', { startedAt: null, completedAt: null, source: 'manual' })
    return (await api.getWorkspace()).projects.find(item => item.id === 'ios')!.title
  })
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await tray.getByLabel('批量新建待办').fill(`${project}粗剪（4）`)
  const preview = tray.getByRole('region', { name: '待办项目预览' })
  await expect(preview.locator('.todo-draft-stage')).toHaveText('剪辑')
  await preview.getByRole('button', { name: '查看关联项目', exact: true }).click()
  await expect(picker().getByLabel('所属阶段')).toHaveValue('editing')
  await picker().getByLabel('所属阶段').selectOption('')
  await picker().getByRole('button', { name: '关闭项目选择' }).click()
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  const created = await main.evaluate(async title => (await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(item => item.title === title), `${project}粗剪（4）`)
  expect(created).toMatchObject({ projectId: 'ios', stageKey: null, status: 'open' })
  expect(await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getTodoProjectStages('ios')).find(item => item.key === 'editing')?.startedAt)).toBeNull()
})

test('R21ab shared phase actions in tray/widget/home/project fit four themes and narrow viewports', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const id = await seed(); await open(id)
  await picker().getByRole('button', { name: '完成文案阶段', exact: true }).click()
  for (const style of ['warm-gray-green', 'feishu']) for (const theme of ['light', 'dark']) {
    await tray.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    const box = await picker().boundingBox(), viewport = await tray.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.h + 1)
    expect(await picker().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await expect(picker().getByRole('button', { name: '确认完成阶段', exact: true })).toBeVisible()
    if (style === 'feishu') await tray.screenshot({ path: info.outputPath(`stage-time-${theme}.png`) })
  }
  await picker().getByRole('button', { name: '取消', exact: true }).click()
  await picker().getByRole('button', { name: '关闭项目选择' }).click()
  const opened = app.waitForEvent('window'); await app.evaluate(() => (globalThis as Globals).__workLogTest!.create('widget')); const widget = await opened
  await open(id, widget); await expect(picker(widget).getByRole('button', { name: '开始文案阶段', exact: true })).toBeVisible()
  await picker(widget).getByRole('button', { name: '关闭项目选择' }).click()
  await open(id, main); await expect(picker(main).getByRole('button', { name: '补记／更正时间', exact: true })).toBeVisible()
  await picker(main).getByRole('button', { name: '关闭项目选择' }).click()
  await main.evaluate(() => { location.hash = '#/project/ios/overview' })
  await open(id, main); await expect(picker(main).getByRole('button', { name: '开始文案阶段', exact: true })).toBeVisible()
})

test('R21ab new phase command is rejected for the schedule-only companion role', async () => {
  const id = await seed()
  const opened = app.waitForEvent('window'); await app.evaluate(() => (globalThis as Globals).__workLogTest!.schedule()); const schedule = await opened
  const result = await schedule.evaluate(async id => {
    try { await (globalThis as Globals).creatorOS.setTodoLinkedStageTime({ todoId: id, projectId: 'ios', stageKey: 'script', expectedRevision: 'a'.repeat(64), expectedTodoUpdatedAt: '', action: 'start', startedAt: { localDate: '2026-09-21', segment: 'morning' }, completedAt: null, confirmedOpenTodoIds: [], requestId: crypto.randomUUID() }); return 'allowed' }
    catch (error) { return String(error) }
  }, id)
  expect(result).not.toBe('allowed')
  expect(await main.evaluate(async () => (await (globalThis as Globals).creatorOS.getTodoProjectStages('ios')).find(item => item.key === 'script')?.startedAt)).toBeNull()
})
