import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
let app: ElectronApplication
let page: Page
let pageErrors: string[] = []

test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow(); pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message)); await page.waitForLoadState('domcontentloaded')
  await page.locator('.page-header').waitFor()
  await page.evaluate(async () => {
    const state = await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.getWorkspace()
    for (const item of state.schedules) await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.deleteSchedule(item.id)
    location.hash = '#/schedule'
  })
  await page.getByRole('heading', { name: '项目排期' }).waitFor()
  const w = await app.browserWindow(page); await w.evaluate(w => w.setSize(1440, 1000))
})
test.afterEach(async () => { await app.close().catch(() => undefined); expect(pageErrors).toEqual([]) })
async function create(title: string, start = 16, end: number | null = null, projectId: string | null = 'ios'): Promise<string> {
  return page.evaluate(async ({ title, start, end, projectId }) => (await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.createSchedule({ projectId, title, actionType: projectId ? 'script' : 'overview', startAt: new Date(2026, 6, start, 9).toISOString(), endAt: end ? new Date(2026, 6, end, 19).toISOString() : null, scheduleKind: 'plan', waitingFor: null })).id, { title, start, end, projectId })
}
async function item(id: string) { return page.evaluate(async id => (await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.getWorkspace()).schedules.find(s => s.id === id), id) }
async function noOverlap(): Promise<void> {
  const overlaps = await page.locator('.schedule-canvas [data-schedule-focus-id], .schedule-canvas [data-project-target-id], .schedule-canvas [data-topic-deadline-id], .month-schedule [data-schedule-focus-id]').evaluateAll(elements => {
    const boxes = elements.map(e => ({ id: e.getAttribute('data-schedule-focus-id') ?? e.getAttribute('data-project-target-id') ?? e.getAttribute('data-topic-deadline-id'), r: e.getBoundingClientRect() })).filter(x => x.r.width && x.r.height)
    return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => a.id !== b.id && Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 && Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1).map(b => [a.id, b.id]))
  })
  expect(overlaps).toEqual([])
}

test('右键就近改排期名称、阶段和项目名，保存同一记录且不改变项目进度', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const id = await create('文案'); const before = await item(id)
  const pill = page.locator(`[data-schedule-focus-id="${id}"]`)
  await pill.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '修改排期名称', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '修改排期名称', exact: true })
  await dialog.getByLabel('排期名称', { exact: true }).fill('自定义创作安排')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(pill).toContainText('自定义创作安排')
  await pill.click({ button: 'right' }); await page.getByRole('menuitem', { name: '修改排期阶段' }).click()
  dialog = page.getByRole('dialog', { name: '修改排期阶段', exact: true })
  await page.screenshot({ path: info.outputPath('stage-property-editor.png') })
  await dialog.getByLabel('排期阶段', { exact: true }).selectOption('outline')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await item(id))?.actionType).toBe('outline')
  expect(await item(id)).toMatchObject({ id, title: '自定义创作安排', startAt: before?.startAt, state: before?.state })
  await pill.click({ button: 'right' }); await page.getByRole('menuitem', { name: '修改项目名称' }).click()
  dialog = page.getByRole('dialog', { name: '修改项目名称', exact: true })
  await dialog.getByLabel('项目名称', { exact: true }).fill('新项目名称')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(pill).toContainText('新项目名称')
  await expect(page.locator('.calendar-filterbar button[data-project-id="ios"]')).toContainText('新项目名称')
  expect((await item(id))?.title).toBe('自定义创作安排')
  await page.reload(); await expect(page.locator(`[data-schedule-focus-id="${id}"]`)).toContainText('自定义创作安排')
})

test('自由安排可改名；取消与Esc不保存；目标日不提供改阶段入口', async () => {
  const id = await create('自由安排', 16, null, null)
  const pill = page.locator(`[data-schedule-focus-id="${id}"]`)
  await pill.click({ button: 'right' }); await expect(page.getByRole('menuitem', { name: '修改排期阶段' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '修改排期名称', exact: true }).click()
  await page.getByLabel('排期名称', { exact: true }).fill('不要保存')
  await page.keyboard.press('Escape'); expect((await item(id))?.title).toBe('自由安排')
  const targetId = await page.evaluate(async () => (await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.createSchedule({ projectId: 'ios', title: '目标日', actionType: 'overview', startAt: new Date(2026, 6, 16, 9).toISOString(), endAt: null, scheduleKind: 'hard_deadline', waitingFor: null })).id)
  await page.locator(`[data-project-target-id="${targetId}"]`).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '修改排期阶段' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: '修改项目名称' })).toBeVisible()
  await page.keyboard.press('Escape')
  const topicId = await page.evaluate(async () => {
    const api = (window as unknown as { creatorOS: CreatorOSApi }).creatorOS
    const state = await api.getWorkspace()
    return (await api.createTopic({ title: '日视图选题目标', coreAngle: '', contentTypeId: state.contentTypes.find(t => t.isActive)!.id, importanceLevel: 2, needsMoreExperience: false, startAt: null, expectedCompletionAt: '2026-07-16', actualCompletionAt: null, stageId: state.topicStages.find(s => s.role === 'standard')!.id })).id
  })
  await page.evaluate(() => { location.hash = '#/schedule?date=2026-07-16' })
  await expect(page.locator(`.day-schedule-view [data-topic-deadline-id="${topicId}"]`)).toBeVisible()
  await expect(page.locator(`.day-schedule-view [data-project-target-id="${targetId}"]`)).toBeVisible()
})

test('稀疏跨天轨道与单日、完成态、拥挤日期在月周／首页／窄窗／四主题均不重叠', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(90_000)
  await create('周初较长安排', 13, 15); const b = await create('第二轨延续到周五', 14, 17)
  await page.evaluate(async id => { await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.setScheduleState(id, 'done') }, b)
  await create('周四单日', 16); await create('跨周', 18, 24, 'ssd')
  for (let i = 0; i < 9; i++) await create(`同日长标题安排${i}`, 16, null, i % 2 ? 'ssd' : null)
  const w = await app.browserWindow(page)
  for (const width of [1440, 880, 700]) {
    await w.evaluate((w, width) => w.setSize(width, 1000), width)
    for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
      await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
      for (const mode of ['月', '周']) {
        await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: mode, exact: true }).click()
        await noOverlap()
        if (mode === '月' && ((width === 1440 && style === 'warm' && theme === 'light') || (width === 880 && style === 'feishu' && theme === 'dark'))) await page.screenshot({ path: info.outputPath(`calendar-${width}-${style}-${theme}.png`) })
      }
    }
  }
  await page.evaluate(() => { location.hash = '#/home' })
  await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: '月', exact: true }).click()
  await noOverlap()
  const more = page.locator('[data-calendar-date="2026-07-16"] .month-overflow')
  await more.click(); await expect(page.locator('.day-schedule-view')).toContainText('同日长标题安排8')
  await expect(page.locator('.day-schedule-view [data-schedule-focus-id]')).toHaveCount(11)
})

test('真实拖动跨周续行中段保留抓取日期和时长，可撤销；边缘预览Esc取消不保存', async () => {
  const id = await create('跨周拖动', 17, 22)
  const before = await item(id)
  const continuation = page.locator(`[data-schedule-range-id="${id}"][data-range-start="false"] .schedule-range-pill`)
  await expect(continuation).toBeVisible()
  const box = await continuation.boundingBox(); if (!box) throw new Error('没有续行')
  await continuation.dragTo(page.locator('[data-calendar-date="2026-07-23"]'), { sourcePosition: { x: box.width / 2, y: box.height / 2 }, targetPosition: { x: 20, y: 6 } })
  await expect.poll(async () => new Date((await item(id))!.startAt!).getDate()).toBe(19)
  expect(new Date((await item(id))!.endAt!).getDate()).toBe(24)
  await page.getByRole('status').getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await item(id))?.startAt).toBe(before?.startAt)
  const handle = page.locator(`[data-schedule-resize-id="${id}"][data-resize-edge="end"]`)
  const h = await handle.boundingBox(); if (!h) throw new Error('没有拖动边缘')
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 80, h.y, { steps: 6 })
  await expect(page.locator('.schedule-resizing')).toHaveCount(1)
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await item(id)).toMatchObject({ startAt: before?.startAt, endAt: before?.endAt })
  await expect(page.locator('.schedule-resizing')).toHaveCount(0)
})


test('未排期与日历真实往返拖动、改期撤销、上下滚轮仍可用', async () => {
  const id = await page.evaluate(async () => (await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.createSchedule({ projectId: null, title: '往返安排', actionType: 'overview', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null })).id)
  const chip = page.getByRole('button', { name: '其他安排·往返安排·未排期', exact: true })
  await chip.dragTo(page.locator('[data-calendar-date="2026-07-16"]'), { targetPosition: { x: 15, y: 5 } })
  await expect.poll(async () => new Date((await item(id))!.startAt!).getDate()).toBe(16)
  const pill = page.locator(`[data-schedule-focus-id="${id}"]`)
  await pill.dragTo(page.locator('.unscheduled-inbox'), { targetPosition: { x: 10, y: 10 } })
  await expect.poll(async () => (await item(id))?.startAt).toBeNull()
  await page.getByRole('status').getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => new Date((await item(id))!.startAt!).getDate()).toBe(16)
  await page.evaluate(() => { location.hash = '#/reports' })
  await page.locator('.reports-page').waitFor()
  await page.mouse.move(700, 650); await page.mouse.wheel(0, 450)
  await expect.poll(() => page.locator('.reports-page').evaluate(e => e.scrollTop)).toBeGreaterThan(0)
})

test('月周日列表共享改名入口，月份切换后换视图保留所看日期范围', async () => {
  const id = await create('跨视图安排', 16)
  for (const mode of ['月', '周', '列表']) {
    await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: mode, exact: true }).click()
    await page.locator(`[data-schedule-focus-id="${id}"]`).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '修改排期阶段' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await page.evaluate(() => { location.hash = '#/schedule?date=2026-07-16' })
  await expect(page.locator('.day-schedule-view')).toContainText('跨视图安排')
  await page.locator(`[data-schedule-focus-id="${id}"]`).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '修改排期名称', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: '月', exact: true }).click()
  await page.getByRole('button', { name: '下个月', exact: true }).click()
  await page.getByRole('group', { name: '排期视图' }).getByRole('button', { name: '周', exact: true }).click()
  await expect(page.locator('[data-testid="week-grid"]')).toHaveAttribute('data-calendar-week-start', '2026-07-27')
})


test('窄窗边界浮层保持可见，空标题禁止保存，阶段停用时失败不丢失并可重试', async () => {
  const id = await create('失败重试安排', 19)
  const w = await app.browserWindow(page); await w.evaluate(w => w.setSize(700, 720))
  const pill = page.locator(`[data-schedule-focus-id="${id}"]`)
  await pill.click({ button: 'right' }); await page.getByRole('menuitem', { name: '修改排期名称', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '修改排期名称', exact: true })
  await dialog.getByLabel('排期名称', { exact: true }).fill('   ')
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await pill.click({ button: 'right' }); await page.getByRole('menuitem', { name: '修改排期阶段' }).click()
  dialog = page.getByRole('dialog', { name: '修改排期阶段', exact: true })
  await dialog.getByLabel('排期阶段', { exact: true }).selectOption('outline')
  await page.evaluate(async () => { await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.setProjectModule('ios', 'outline', false) })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('停用')
  expect(await item(id)).toMatchObject({ title: '失败重试安排', actionType: 'script' })
  const bounds = await dialog.boundingBox(); const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
  await page.evaluate(async () => { await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.setProjectModule('ios', 'outline', true) })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await item(id))?.actionType).toBe('outline')
  await expect(dialog).toHaveCount(0)
})
