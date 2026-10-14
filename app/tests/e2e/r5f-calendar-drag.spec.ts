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

async function hold(id: string, date: string): Promise<void> {
  const source = page.locator(`[data-schedule-focus-id="${id}"]`).first()
  const from = await source.boundingBox(); const to = await page.locator(`[data-calendar-date="${date}"]`).boundingBox()
  if (!from || !to) throw new Error('缺少日期或条目')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 38, { steps: 12 })
  await expect(page.locator('.schedule-drag-preview')).toBeVisible()
}

test('拿起跟手预览保留原位且布局不跳，跨周范围可见，松手才保存并可撤销', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const id = await create('跨周文案拍摄安排', 16, 20)
  await create('同时进行的安排', 17, 21, 'ssd')
  const before = await item(id)
  const geometry = await page.locator('.month-week-row').evaluateAll(es => es.map(e => ({ y: e.getBoundingClientRect().y, h: e.getBoundingClientRect().height })))
  await hold(id, '2026-07-24')
  const preview = page.locator('.schedule-drag-preview')
  await expect(preview).toHaveAttribute('data-valid', 'true')
  await expect(page.locator('[data-schedule-drag-source="true"]')).toHaveCount(2)
  expect(await item(id)).toMatchObject({ startAt: before!.startAt, endAt: before!.endAt })
  const afterGeometry = await page.locator('.month-week-row').evaluateAll(es => es.map(e => ({ y: e.getBoundingClientRect().y, h: e.getBoundingClientRect().height })))
  expect(afterGeometry).toEqual(geometry)
  // The first rendered segment spans Thu–Sun; its centre grabs Saturday (18th).
  await expect(page.locator('[data-schedule-drop-range="true"]')).toHaveCount(5)
  await expect(preview).toContainText('7月22日—7月26日')
  await page.screenshot({ path: info.outputPath('lifted-calendar-warm.png') })
  await page.mouse.up()
  await expect(preview).toHaveCount(0)
  await expect.poll(async () => new Date((await item(id))!.startAt!).getDate()).toBe(22)
  await page.getByRole('status').getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await item(id))!.startAt).toBe(before!.startAt)
})

test('Esc、窗口失焦、日期之外松手均取消，不保存或误开详情，随后仍能拖动', async () => {
  const id = await create('可取消的拖动'); const before = await item(id)
  for (const cancel of ['escape', 'blur', 'outside']) {
    await hold(id, '2026-07-20')
    if (cancel === 'escape') await page.keyboard.press('Escape')
    else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    else await page.mouse.move(20, 20, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.schedule-drag-preview')).toHaveCount(0)
    await expect(page.locator('[data-schedule-drag-source], [data-schedule-drop-range]')).toHaveCount(0)
    expect((await item(id))!.startAt).toBe(before!.startAt)
    await expect(page.locator('body')).not.toHaveClass(/schedule-moving/)
  }
  await hold(id, '2026-07-21'); await page.mouse.up()
  await expect.poll(async () => new Date((await item(id))!.startAt!).getDate()).toBe(21)
})

test('两套主题与窄窗口拖动预览不出屏，保留项目色，减少动效仍能操作', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const id = await create('右侧边界长名称的清晰拖动预览', 19)
  const w = await app.browserWindow(page)
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    await w.evaluate(w => w.setSize(880, 720))
    await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await hold(id, '2026-07-26')
    const preview = page.locator('.schedule-drag-preview'); const box = await preview.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    const colors = await preview.locator('.schedule-drag-preview-label').evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }))
    expect(colors.bg).not.toBe(colors.fg)
    if (style === 'feishu' && theme === 'dark') await page.screenshot({ path: info.outputPath('lifted-calendar-dark-narrow.png') })
    await page.keyboard.press('Escape'); await page.mouse.up()
  }
})

test('条目被其他入口删除后的移动失败会提示，拖动层不会残留', async () => {
  const id = await create('移动冲突测试')
  await hold(id, '2026-07-20')
  await page.evaluate(async id => { await (window as unknown as { creatorOS: CreatorOSApi }).creatorOS.deleteSchedule(id) }, id)
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('排期项不存在')
  await expect(page.locator('.schedule-drag-preview')).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveClass(/schedule-moving/)
})


test('小幅移动仍是单击，右键编辑不被抢走，日视图与未排期共用拖动反馈', async () => {
  const id = await create('轻点不是拖动')
  const source = page.locator(`[data-schedule-focus-id="${id}"]`)
  const b = await source.boundingBox(); if (!b) throw new Error('未找到条目')
  await page.mouse.move(b.x + 20, b.y + 8); await page.mouse.down(); await page.mouse.move(b.x + 22, b.y + 8); await page.mouse.up()
  await expect(page.locator('.schedule-drag-preview')).toHaveCount(0)
  await expect(page.locator('.schedule-detail-title-edit')).toContainText('轻点不是拖动')
  await source.click({ button: 'right' }); await expect(page.getByRole('menuitem', { name: '修改排期名称', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => { location.hash = '#/schedule?date=2026-07-16' })
  await page.locator('.day-schedule-view').waitFor()
  await source.dragTo(page.locator('.unscheduled-inbox'), { targetPosition: { x: 10, y: 10 } })
  await expect.poll(async () => (await item(id))?.startAt).toBeNull()
  await page.locator(`[data-schedule-inbox-id="${id}"]`).dragTo(page.locator('.day-schedule-view'), { targetPosition: { x: 20, y: 20 } })
  await expect.poll(async () => new Date((await item(id))!.startAt!).getDate()).toBe(16)
})
