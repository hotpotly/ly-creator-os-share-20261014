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
test('travel dates use readable circles instead of missing bars; dense month labels never overlap', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await page.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    for (const [kind,startDate,endDate] of [['business','2026-09-01','2026-09-22'],['home','2026-09-23','2026-09-30'],['rest','2026-09-24','2026-09-24'],['rest','2026-09-25','2026-09-25']] as const) await api.saveBusinessTrip({ kind, scheduleId:null, expectedUpdatedAt:null, action:'save', title:kind, startDate,endDate,projectId:null,notes:'' })
    location.hash = '#/reviews?kind=monthly&anchor=2026-09-27'
  })
  const circles = page.locator('.review-chart-date[data-travel-kind]')
  await expect(page.locator('.review-chart-points > button')).toHaveCount(30)
  await expect.poll(() => circles.count()).toBeGreaterThan(1)
  await expect.poll(() => circles.count()).toBeLessThan(30)
  await page.locator('.review-chart-points button[data-day="2026-09-22"]').hover()
  const day22 = page.locator('.review-chart-date[data-day="2026-09-22"]')
  await expect(day22).toHaveText('22')
  await expect(day22).toHaveCSS('border-radius','50%')
  expect((await page.locator('.review-chart-points button[data-day="2026-09-22"] .review-chart-bar').boundingBox())!.height).toBe(0)
  await day22.hover()
  await expect(page.getByLabel('每日工时读数')).toContainText('未记录出差')
  for (const width of [680,880,1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width,900),width)
    for (const theme of ['light','dark']) for (const visualStyle of ['warm','feishu']) {
      await page.evaluate(([theme,visualStyle]) => { document.documentElement.dataset.theme=theme; document.documentElement.dataset.visualStyle=visualStyle },[theme,visualStyle])
      await expect.poll(() => circles.evaluateAll(elements => {
        const boxes = elements.map(el=>el.getBoundingClientRect()), parent = elements[0]!.parentElement!.getBoundingClientRect()
        return boxes.every((box,i) => box.width >= 22 && box.height >= 22 && Math.abs(box.top - parent.top) < 1 && parent.height === 26 && box.left >= parent.left - 1 && box.right <= parent.right + 1 && boxes.every((other,j) => i===j || box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top))
      })).toBe(true)
      await expect.poll(() => circles.evaluateAll(elements => Math.min(...elements.map(el => {
        const style=getComputedStyle(el), canvas=document.createElement('canvas'), ctx=canvas.getContext('2d')!
        const rgb=(value:string) => { ctx.fillStyle=value; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>v/255) }
        const luminance=(values:number[])=>values.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0)
        const fore=luminance(rgb(style.color))
        const tokens=el.getAttribute('data-travel-kind')==='home-rest'?['home','rest']:[el.getAttribute('data-travel-kind')!]
        return Math.min(...tokens.map(kind=>{ const probe=document.createElement('span');probe.style.backgroundColor=`var(--travel-${kind}-soft)`;el.append(probe); const back=luminance(rgb(getComputedStyle(probe).backgroundColor));probe.remove();return (Math.max(fore,back)+.05)/(Math.min(fore,back)+.05) }))
      })))).toBeGreaterThanOrEqual(4.5)
      await expect.poll(()=>page.locator('.review-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
      if(width===880 && visualStyle==='feishu'){ await page.getByRole('heading',{name:'工作投入',exact:true}).scrollIntoViewIfNeeded(); await page.screenshot({path:info.outputPath(`date-circles-${theme}.png`)}) }
    }
  }
  await page.locator('.review-chart-points button[data-day="2026-09-22"]').focus()
  await day22.click()
  await expect(page.locator('.review-daily .todo-work-log')).toHaveAttribute('data-day','2026-09-22')
  await page.getByRole('button',{name:'周复盘',exact:true}).click()
  await expect(page.locator('.review-chart-date')).toHaveCount(7)
  await page.locator('.review-chart-points button[data-day="2026-09-22"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByLabel('每日工时读数')).toContainText('回家')
})

test('goal categories appear only when populated and disappear after removing the last goal', async () => {
  const groups = page.locator('.review-goal-group')
  await expect(page.getByRole('heading', { name: '本周目标', exact: true })).toBeVisible()
  await expect(groups).toHaveCount(0)
  await page.getByRole('button', { name: '添加目标', exact: true }).click()
  await expect(page.getByLabel('目标分类').locator('option')).toHaveCount(4)
  await page.getByLabel('目标分类').selectOption('生活')
  await page.getByLabel('新目标', { exact: true }).fill('陪家人散步')
  await page.locator('.review-goal-form').getByRole('button', { name: '添加', exact: true }).click()
  await expect(groups).toHaveCount(1)
  await expect(groups.getByRole('heading')).toHaveText('生活')
  await page.getByLabel('完成陪家人散步', { exact: true }).check()
  await expect(groups).toHaveCount(1)
  await page.getByRole('button', { name: '保存复盘', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeDisabled()
  await page.reload()
  await expect(groups).toHaveCount(1)
  await page.getByRole('button', { name: '月复盘', exact: true }).click()
  await expect(groups).toHaveCount(0)
  await page.getByRole('button', { name: '周复盘', exact: true }).click()
  await expect(groups).toHaveCount(1)
  await page.getByRole('button', { name: '移除目标陪家人散步', exact: true }).click()
  await expect(groups).toHaveCount(0)
  await page.getByRole('button', { name: '保存复盘', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeDisabled()
  await page.reload()
  await expect(groups).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加目标', exact: true })).toBeVisible()
})

test('home uses the shared pale blue palette in chart, daily cards and the original day editor', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await page.evaluate(async () => {
    const api = (globalThis as Globals).creatorOS
    await api.saveBusinessTrip({ kind: 'home', scheduleId: null, expectedUpdatedAt: null, action: 'save', title: '回家', projectId: null, startDate: '2026-09-22', endDate: '2026-09-23', notes: '' })
    await api.setDailyWorkLogTotal('2026-09-22', 180, await api.getDailyWorkLog('2026-09-22'))
  })
  await expect(page.locator('.review-day-card[data-day="2026-09-22"]')).toHaveAttribute('data-travel-kind', 'home')
  for (const theme of ['light', 'dark']) for (const visualStyle of ['warm', 'feishu']) {
    await page.evaluate(([theme, visualStyle]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = visualStyle }, [theme, visualStyle])
    const colors = await page.evaluate(() => {
      const work = document.querySelector('.review-chart-legend > span:first-child i')!, home = document.querySelector('.review-chart-legend .travel-surface-home i')!, bar = document.querySelector('.review-chart-points [data-day="2026-09-22"] .review-chart-bar')!
      const style = getComputedStyle(document.documentElement)
      return { work: getComputedStyle(work).backgroundColor, home: getComputedStyle(home).backgroundColor, bar: getComputedStyle(bar).backgroundColor, homeToken: style.getPropertyValue('--travel-home').trim(), projectToken: style.getPropertyValue('--project-2').trim(), card: getComputedStyle(document.querySelector('.review-day-card[data-day="2026-09-22"]')!).backgroundColor }
    })
    expect(colors.home).not.toBe(colors.work)
    expect(colors.home).toBe(colors.bar)
    expect(colors.homeToken).toBe(theme === 'light' ? '#9bcff3' : '#90c8ee')
    expect(colors.projectToken).toBe('#5bacf2')
    expect(colors.card).toBe(theme === 'light' ? 'rgb(244, 250, 255)' : 'rgb(25, 39, 48)')
    if (visualStyle === 'feishu') await page.locator('.review-hours').screenshot({ path: info.outputPath(`home-blue-${theme}.png`) })
  }
  await page.locator('.review-chart-points [data-day="2026-09-22"]').click()
  await expect(page.locator('.todo-workspace')).toHaveClass(/travel-surface-home/)
  const palette = await page.locator('.todo-workspace').evaluate(el => getComputedStyle(el).getPropertyValue('--travel-surface').trim())
  expect(palette).toBe('#192730')
})
