import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: testInfo.outputPath('user-data') } })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.page-header').waitFor()
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
})
test.afterEach(async () => { await app.close().catch(() => undefined) })
async function go(route: string): Promise<void> {
  await page.evaluate((route) => { location.hash = `#/${route}` }, route)
  await page.waitForTimeout(180)
}
async function resize(width: number, height = 720): Promise<void> {
  const window = await app.browserWindow(page)
  await window.evaluate((win, size) => win.setSize(size.width, size.height), { width, height })
  await page.waitForTimeout(200)
}

test('收入完整表单与单项浮层共用输入字号，主标题和窗口密度不放大', async () => {
  await resize(880)
  await go('other-income')
  await expect(page.locator('.page-header h1')).toHaveCSS('font-size', '24px')
  await page.getByRole('button', { name: '新增收入', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新增其他收入' })
  await expect(editor.getByLabel('收入金额', { exact: true })).toHaveCSS('font-size', '13px')
  const height = await editor.getByLabel('收入金额', { exact: true }).evaluate((e) => e.getBoundingClientRect().height)
  expect(height).toBeGreaterThanOrEqual(32)
  expect(height).toBeLessThanOrEqual(34)
  await editor.getByLabel('收入标题').fill('统一字号检查')
  await editor.getByLabel('收入金额', { exact: true }).fill('1000')
  await editor.getByRole('button', { name: '保存收入', exact: true }).click()
  await page.getByRole('button', { name: '统一字号检查：收入金额', exact: true }).click()
  const popover = page.getByRole('dialog', { name: '收入金额快捷修改' })
  await expect(popover.getByLabel('收入金额', { exact: true })).toHaveCSS('font-size', '13px')
  await page.keyboard.press('Escape')
  await go('business')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('creator-os:open-business-income-editor')))
  const business = page.getByRole('dialog', { name: '直接补加商单' })
  await expect(business.getByLabel('商单金额', { exact: true })).toHaveCSS('font-size', '13px')
  await expect(business.getByLabel('商单名称', { exact: true })).toHaveCSS('font-size', '13px')
  await expect(business.getByRole('button', { name: '保存', exact: true })).toHaveCSS('font-size', '12px')
  await expect(business.locator('footer')).toBeInViewport()
})

test('700与704px、880px及125%缩放下收入页头操作不折字或溢出', async () => {
  for (const route of ['income', 'business', 'other-income']) {
    await go(route)
    for (const width of [1440, 880, 704, 700]) {
      await resize(width)
      const invalid = await page.locator('.page-header button').evaluateAll((buttons) => buttons.flatMap((button) => {
        const rect = button.getBoundingClientRect()
        if (!rect.width || !rect.height) return []
        const lines = [...button.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()).flatMap((n) => {
          const range = document.createRange(); range.selectNodeContents(n)
          return [...range.getClientRects()].filter((r) => r.width).map((r) => Math.round(r.y))
        })
        return new Set(lines).size > 1 || rect.right > innerWidth + 1 ? [button.textContent] : []
      }))
      expect(invalid, `${route}:${width}`).toEqual([])
    }
  }
  const window = await app.browserWindow(page)
  await resize(880)
  await window.evaluate((win) => win.webContents.setZoomFactor(1.25))
  await page.waitForTimeout(200)
  await expect(page.getByRole('button', { name: '收入类型', exact: true })).toHaveCSS('white-space', 'nowrap')
  expect(await page.locator('main').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
})

test('两套明暗主题的必读说明有足够对比度，字体与几何不随主题改变', async () => {
  test.setTimeout(60_000)
  await resize(880)
  for (const [route, selector] of [['other-income', '.business-ledger-summary small'], ['reports', '.report-matrix-cell small'], ['project/ios/publishing', '.publish-matrix-row > button small']]) {
    await go(route!)
    await page.locator(selector!).first().waitFor()
    let baseline: { width: number; height: number; fontSize: string } | undefined
    for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
      await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
      const metrics = await page.locator(selector!).first().evaluate((e) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const rgba = (color: string): number[] => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data] }
        let background = [255, 255, 255]
        const chain: Element[] = []; for (let node: Element | null = e; node; node = node.parentElement) chain.unshift(node)
        for (const node of chain) { const c = rgba(getComputedStyle(node).backgroundColor); background = background.map((v, i) => c[i]! * c[3]! / 255 + v * (1 - c[3]! / 255)) }
        const luminance = (color: number[]): number => color.slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0)
        const fg = luminance(rgba(getComputedStyle(e).color)), bg = luminance(background)
        const rect = e.getBoundingClientRect()
        return { contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), width: rect.width, height: rect.height, fontSize: getComputedStyle(e).fontSize }
      })
      expect(metrics.contrast, `${route}:${style}:${theme}`).toBeGreaterThanOrEqual(4.5)
      expect(parseFloat(metrics.fontSize)).toBeGreaterThanOrEqual(10)
      if (!baseline) baseline = metrics
      else { expect(metrics.fontSize).toBe(baseline.fontSize); expect(Math.abs(metrics.width - baseline.width)).toBeLessThanOrEqual(1); expect(Math.abs(metrics.height - baseline.height)).toBeLessThanOrEqual(1) }
    }
  }
})

test('报表逾期角标与状态不重叠，发布必需项不再继承6px小字', async () => {
  await resize(880)
  await go('reports')
  const badges = page.locator('.report-matrix-cell:has(> em)')
  expect(await badges.count()).toBeGreaterThan(0)
  const overlap = await badges.evaluateAll((cells) => cells.some((e) => {
    const text = e.querySelector('b')!.getBoundingClientRect(), badge = e.querySelector('em')!.getBoundingClientRect()
    return text.left < badge.right && text.right > badge.left && text.top < badge.bottom && text.bottom > badge.top
  }))
  expect(overlap).toBe(false)
  await go('project/ios/publishing')
  await expect(page.locator('.publish-matrix-row > button small').first()).toHaveCSS('font-size', '10px')
  await expect(page.locator('.project-hero h1')).toHaveCSS('font-size', '21px')
})
