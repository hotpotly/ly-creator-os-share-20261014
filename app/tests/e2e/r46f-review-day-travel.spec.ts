import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi }
let app: ElectronApplication, page: Page
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_DATE: '2026-09-27', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow()
  await expect.poll(() => page.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBe('2026-09-27')
  await page.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    await api.setDailyWorkLogTotal('2026-09-21', 150, await api.getDailyWorkLog('2026-09-21'))
    await api.createTodoBatch([{ title: '当天剪辑', category: 'self_media', suggestedCategory: 'self_media', plannedDate: '2026-09-21', segment: 'morning', projectId: null, stageKey: null, trackingMode: 'checklist', progress: 0 }])
    location.hash = '#/reviews?kind=weekly&anchor=2026-09-27'
  })
  await expect(page.getByRole('group', { name: '每日工作投入' })).toBeVisible()
})
test.afterEach(async () => { await app?.close() })
test('weekly/monthly day cards share travel surfaces and editable status including missing hours and overlaps', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await page.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    for (const [kind, startDate, endDate, title] of [['business','2026-09-21','2026-09-23','杭州出差'],['home','2026-09-22','2026-09-24','回老家'],['rest','2026-09-24','2026-09-24','休息']] as const) {
      await api.saveBusinessTrip({ kind, scheduleId: null, expectedUpdatedAt: null, action: 'save', title, startDate, endDate, projectId: null, notes: '' })
    }
  })
  const details = page.locator('.review-schedule'), card = (day: string) => details.locator(`.review-day-card[data-day="2026-09-${day}"]`)
  await expect(details).toHaveAttribute('open', '')
  for (const [day, tone] of [['21','business'],['22','mixed'],['23','mixed'],['24','home-rest']]) {
    await expect(card(day!)).toHaveAttribute('data-travel-kind', tone!)
    await expect(card(day!).locator('.business-trip-summary')).toHaveCount(day === '21' ? 1 : 2)
  }
  await expect(card('25')).not.toHaveAttribute('data-travel-kind')
  await expect(card('25').getByLabel('行程状态')).toHaveCount(0)
  await expect(card('22')).toContainText('未记录')
  await expect(card('22')).toContainText('暂无待办')
  await expect(card('22').locator('[data-travel-kind="business"]')).toContainText('出差记录·杭州出差')
  await expect(card('24').locator('[data-travel-kind="rest"]')).toContainText('休息记录·休息')
  await expect(details.getByRole('button', { name: '安排行程', exact: true })).toHaveCount(0)
  const hoursBefore = await page.evaluate(() => (globalThis as Globals).creatorOS.getDailyWorkLog('2026-09-24'))
  for (const width of [680,1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width,900), width)
    for (const theme of ['light','dark']) for (const style of ['warm','feishu']) {
      await page.evaluate(([theme,style]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = style }, [theme,style])
      await expect.poll(() => details.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      expect(await card('21').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await card('25').evaluate(el => getComputedStyle(el).backgroundColor))
      expect(await card('22').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient')
      await expect(card('21').locator('.todo-work-log b')).toHaveAttribute('data-work-tone','low')
      if (width === 1280 && style === 'feishu') { await details.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`day-travel-${theme}.png`) }) }
    }
  }
  await card('24').locator('.business-trip-summary[data-travel-kind="rest"]').click()
  const editor = page.getByRole('dialog', { name: '编辑休息安排', exact: true })
  await editor.getByRole('group', { name: '行程类型' }).getByRole('button', { name: '出差', exact: true }).click()
  await page.getByRole('dialog', { name: '编辑出差安排', exact: true }).getByRole('button', { name: '保存出差', exact: true }).click()
  await expect(card('24')).toHaveAttribute('data-travel-kind','mixed')
  expect(await page.evaluate(() => (globalThis as Globals).creatorOS.getDailyWorkLog('2026-09-24'))).toEqual(hoursBefore)
  await page.getByRole('button', { name: '月复盘', exact: true }).click()
  await expect(details).toHaveAttribute('open', '')
  await expect(card('24')).toHaveAttribute('data-travel-kind','mixed')
  await page.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS, w = await api.getWorkspace()
    for (const item of w.schedules.filter(item => item.trip && item.title === '回老家')) await api.saveBusinessTrip({ kind: item.trip!.kind, scheduleId: item.id, expectedUpdatedAt: item.updatedAt, action: 'cancel', title: item.title, startDate: '2026-09-22', endDate: '2026-09-24', projectId: null, notes: '' })
  })
  await expect(card('22')).toHaveAttribute('data-travel-kind','business')
  await expect(card('24')).toHaveAttribute('data-travel-kind','business')
  await expect(card('24').locator('.business-trip-summary')).toHaveCount(1)
  await page.reload()
  await expect(details).toHaveAttribute('open', '')
  await expect(card('24')).toHaveAttribute('data-travel-kind','business')
})
