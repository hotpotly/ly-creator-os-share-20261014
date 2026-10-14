import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi }
let app: ElectronApplication, page: Page

test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_TEST_DATE: '2026-09-27', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow()
  await expect.poll(() => page.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBe('2026-09-27')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 1000))
  await page.evaluate(() => { location.hash = '#/reviews?kind=weekly&anchor=2026-09-27' })
  await expect(page.locator('.review-columns-writing')).toBeVisible()
})
test.afterEach(async () => { await app?.close() })

test('date hierarchy and icon-only same-day hours editor, including a year boundary', async () => {
  const card = page.locator('.review-day-card[data-day="2026-09-21"]')
  await expect(card.locator('time')).toHaveText('9月21日周一')
  await expect(card.locator('time')).toHaveAttribute('datetime', '2026-09-21')
  await expect(card.locator('header')).not.toContainText('2026')
  await expect(card.locator('header')).not.toContainText('投入')
  const edit = card.getByRole('button', { name: '记录', exact: true })
  await expect(edit).toHaveText('')
  await expect(edit).toHaveAttribute('title', '编辑2026-09-21投入')
  await edit.click()
  await page.getByRole('dialog').getByLabel('总时长').fill('6')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await expect(card.locator('b[data-work-tone]')).toHaveText('6小时')
  await expect(card.locator('b[data-work-tone]')).toHaveAttribute('data-work-tone', 'enough')
  await card.getByRole('button', { name: '查看2026-09-21记录' }).click()
  await expect(page.locator('.review-daily .todo-work-log')).toHaveAttribute('data-day', '2026-09-21')
  await expect(page.locator('.review-daily .todo-work-log')).toContainText('09/21投入')
  await expect(page.locator('.review-daily .todo-work-log b')).toHaveText('6小时')
  await page.evaluate(() => { location.hash = '#/reviews?kind=weekly&anchor=2027-01-01' })
  await expect(page.locator('.review-day-card[data-day="2026-12-31"] time')).toHaveText('12月31日周四')
  await expect(page.locator('.review-day-card[data-day="2027-01-01"] time')).toHaveText('1月1日周五')
})

test('bottom three columns resize independently by pointer and keyboard, persist, and reflow in all themes', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const bottom = page.locator('.review-columns-writing')
  const panels = bottom.locator(':scope > :not([role="separator"])')
  await expect(panels).toHaveCount(3)
  await expect.poll(async () => {
    const boxes = await Promise.all([0, 1, 2].map(async n => (await panels.nth(n).boundingBox())!))
    return boxes[0]!.x + boxes[0]!.width <= boxes[1]!.x && boxes[1]!.x + boxes[1]!.width <= boxes[2]!.x && Math.abs(boxes[0]!.y - boxes[2]!.y) < 2
  }).toBe(true)
  const upper = page.getByRole('separator', { name: '调整目标与打卡栏宽度' })
  const upperWidth = await upper.getAttribute('aria-valuenow')
  const divider = page.getByRole('separator', { name: '调整自由复盘栏宽度' })
  await divider.scrollIntoViewIfNeeded()
  const initial = Number(await divider.getAttribute('aria-valuenow'))
  const rect = (await divider.boundingBox())!
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 30)
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 40, rect.y + 30, { steps: 8 }); await page.mouse.up()
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial + 40))
  const second = page.getByRole('separator', { name: '调整生活记录栏宽度' })
  const secondInitial = Number(await second.getAttribute('aria-valuenow'))
  await second.focus(); await page.keyboard.press('ArrowLeft')
  await expect(second).toHaveAttribute('aria-valuenow', String(secondInitial - 16))
  await expect(upper).toHaveAttribute('aria-valuenow', upperWidth!)
  const editor = page.getByRole('textbox', { name: '复盘正文', exact: true })
  await editor.fill('这周留出时间休息，也完成了剪辑。'); await editor.press('Meta+s')
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  await page.reload()
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial + 40))
  await expect(second).toHaveAttribute('aria-valuenow', String(secondInitial - 16))
  await expect(editor).toContainText('这周留出时间休息')
  for (const width of [1500, 880, 680]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 1000), width)
    for (const theme of ['light', 'dark']) for (const visualStyle of ['warm', 'feishu']) {
      await page.evaluate(([theme, visualStyle]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = visualStyle }, [theme, visualStyle])
      await editor.click()
      await expect.poll(() => page.locator('.review-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await expect.poll(() => bottom.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      if (width === 1500 && visualStyle === 'feishu') {
        await bottom.screenshot({ path: info.outputPath(`writing-${theme}.png`) })
        await page.locator('.review-schedule').screenshot({ path: info.outputPath(`dates-${theme}.png`) })
      }
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 1000))
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial + 40))
  await page.getByRole('button', { name: '月复盘', exact: true }).click()
  await expect(page.locator('.review-day-card')).toHaveCount(30)
  await expect(divider).toHaveAttribute('aria-valuenow', String(initial + 40))
  await expect(page.getByRole('heading', { name: '自由复盘', exact: true })).toHaveCount(1)
  await divider.focus(); await page.keyboard.press('Home')
  await expect.poll(async () => {
    const available = await bottom.evaluate(el => el.clientWidth - 24)
    return Math.abs(Number(await divider.getAttribute('aria-valuenow')) - Math.round(available / 3))
  }).toBeLessThanOrEqual(1)
})
