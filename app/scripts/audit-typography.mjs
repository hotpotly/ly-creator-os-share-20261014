// Read-only UI audit against an isolated, seeded workspace. Never opens a visible test window.
import { _electron as electron } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'test-results', `typography-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(output, { recursive: true })
const application = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: resolve(output, 'user-data') } })
const page = await application.firstWindow()
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const findings = []
const focus = process.env.CREATOR_OS_AUDIT_FOCUS?.split(',')
const routes = ['home', 'ideas', 'ideas?queue=review', 'topics', 'projects', 'income', 'business', 'other-income', 'reports', 'schedule', 'resources', 'tools', 'content-engine', 'distribution', 'recycle', 'settings', ...['overview', 'materials', 'outline', 'script', 'production', 'postproduction', 'publishing', 'versions'].map((module) => `project/ios/${module}`), 'workbench/ai-browser?mode=materials', 'workbench/ai-browser?mode=conversation'].filter((route) => !focus || focus.includes(route))
function inspectTypography() {
  const visible = (element) => {
    const r = element.getBoundingClientRect(), s = getComputedStyle(element)
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility === 'visible' && s.display !== 'none' && !element.closest('[inert], [hidden], .visually-hidden')
  }
  const selector = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${typeof element.className === 'string' ? '.' + element.className.trim().replace(/\s+/g, '.') : ''}`.replace(/\.$/, '')
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = (value) => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((n, i) => i === 3 ? n / 255 : n) }
  const blend = (a, b) => [...a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3])), 1]
  const lum = (rgb) => rgb.slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0)
  const texts = []
  for (const element of document.querySelectorAll('body *')) {
    if (!visible(element) || ['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(element.tagName)) continue
    const direct = [...element.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
    if (!direct.length) continue
    const s = getComputedStyle(element), rect = element.getBoundingClientRect()
    let bg = [255, 255, 255, 1], opaque = true
    const ancestors = []; for (let e = element; e; e = e.parentElement) ancestors.unshift(e)
    for (const a of ancestors) { const cs = getComputedStyle(a); bg = blend(rgba(cs.backgroundColor), bg); if (Number(cs.opacity) < 1 || cs.backgroundImage !== 'none') opaque = false }
    const foreground = blend(rgba(s.color), bg), l1 = lum(foreground), l2 = lum(bg)
    const lines = direct.flatMap((node) => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)) })
    texts.push({ selector: selector(element), text: direct.map((n) => n.textContent.trim()).join(' ').slice(0, 110), fontSize: parseFloat(s.fontSize), lineHeight: s.lineHeight, weight: s.fontWeight, color: s.color, bg: bg.slice(0, 3).map(Math.round), contrast: opaque ? +((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)).toFixed(2) : null, width: +rect.width.toFixed(1), height: +rect.height.toFixed(1), x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), lines: new Set(lines).size, clippedX: element.scrollWidth > element.clientWidth + 2 && ['hidden', 'clip'].includes(s.overflowX), ellipsis: s.textOverflow === 'ellipsis', disabled: Boolean(element.closest('[disabled],[aria-disabled="true"]')), tag: element.tagName })
  }
  const heading = [...document.querySelectorAll('h1,h2,h3,.page-header')].filter(visible).map((e) => ({ selector: selector(e), text: e.textContent.trim().slice(0, 90), size: getComputedStyle(e).fontSize, height: e.getBoundingClientRect().height }))
  const scrollers = [...document.querySelectorAll('main,.page,.app-main,.sidebar,.page-header,[role="dialog"]')].filter(visible).map((e) => ({ selector: selector(e), width: e.clientWidth, scrollWidth: e.scrollWidth, height: e.clientHeight, scrollHeight: e.scrollHeight, overflowX: getComputedStyle(e).overflowX }))
  const controls = [...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(visible).map((e) => ({ tag: e.tagName, label: e.getAttribute('aria-label') || e.closest('label')?.textContent.trim().slice(0, 60) || e.getAttribute('placeholder'), fontSize: getComputedStyle(e).fontSize, height: e.getBoundingClientRect().height }))
  return { controls, viewport: { width: innerWidth, height: innerHeight }, heading, scrollers, texts, sizes: Object.fromEntries([...new Set(texts.map((t) => t.fontSize))].sort((a,b) => a-b).map((size) => [size, texts.filter((t) => t.fontSize === size).length])) }
}
async function capture(name, theme, width, height, style = 'warm') {
  const native = await application.browserWindow(page)
  await native.evaluate((window, size) => window.setSize(size.width, size.height), { width, height })
  await page.evaluate(({ theme, style }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.visualStyle = style }, { theme, style })
  await page.waitForTimeout(350)
  const data = await page.evaluate(inspectTypography)
  const file = `${name.replace(/[^a-z0-9-]/gi, '-')}-${style}-${theme}-${width}.png`
  if (name.endsWith('zoom125')) {
    const png = await native.evaluate(async (window) => (await window.capturePage(undefined, { stayHidden: true })).toPNG().toString('base64'))
    await writeFile(resolve(output, file), Buffer.from(png, 'base64'))
  } else await page.screenshot({ path: resolve(output, file), scale: 'css', animations: 'disabled' })
  findings.push({ name, theme, style, screenshot: file, ...data })
}
try {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => window.creatorOS?.getWorkspace)
  await page.evaluate(async () => {
    await window.creatorOS.saveScript('ai-browser', 'merged_draft', '# 这款AI浏览器能不能真的减少重复操作\n\n这一周我把检索、网页整理和内容创作放在同一个工作流里，重点检查真实体验，而不只是功能列表。\n\n## 多个页面之间的信息整理\n\n普通任务需要保留清楚的上下文与来源，中文正文混排MX Master 4和Actions Ring时仍应自然断行。', undefined, '排版检查样例')
  })
  await page.evaluate(async () => {
    await window.creatorOS.saveOtherIncomeRecord(null, { title: 'MX Master 4产品体验分享与课程授权合作收入', categoryId: null, sourceName: '年度内容合作客户与线上课程平台', revenueMonth: '2026-07', incomeDate: '2026-07-18', amountCents: 560000, directCostCents: 30000, paymentStatus: 'pending', paymentReceivedDate: null, status: 'active', currency: 'CNY', notes: '排版审查样例，不是真实业务数据' })
  })
  await page.evaluate(() => { location.hash = '#/business' }); await page.waitForTimeout(300)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('creator-os:open-business-income-editor')))
  const seedBusiness = page.getByRole('dialog', { name: '直接补加商单' })
  await seedBusiness.getByLabel('商单名称').fill('MX Master 4体验视频与多平台联合推广商单')
  await seedBusiness.getByLabel('商单金额').fill('45000')
  await seedBusiness.getByLabel('制作成本').fill('15000')
  await seedBusiness.getByRole('button', { name: '无需返点', exact: true }).click()
  await seedBusiness.getByRole('button', { name: '保存', exact: true }).click()
  await seedBusiness.waitFor({ state: 'hidden' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addStyleTag({ content: '*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; animation-delay: 0s !important; }' })
  for (const route of routes) {
    await page.evaluate((route) => { location.hash = `#/${route}` }, route)
    await page.waitForTimeout(240)
    for (const [theme, width, height] of [['light',1440,900], ['light',880,720], ['dark',880,720]]) await capture(route, theme, width, height)
    await capture(route, 'light', 880, 720, 'feishu')
    await capture(route, 'dark', 880, 720, 'feishu')
    console.log(`audited ${route}`)
  }
  if (!focus) {
    await page.evaluate(() => { location.hash = '#/settings' }); await page.waitForTimeout(240)
    for (const [key, label] of [['workspace','工作区'],['home','首页与待办'],['ai-publishing','AI与发布'],['data-device','数据与设备']]) {
      await page.getByRole('button', { name: /当前设置分类/ }).click()
      await page.getByRole('menuitemradio', { name: label, exact: true }).click()
      await page.waitForTimeout(350)
      for (const [theme,width,height] of [['light',1440,900],['light',880,720],['dark',880,720]]) await capture(`settings-${key}`,theme,width,height)
      await capture(`settings-${key}`, 'light', 880, 720, 'feishu')
      await page.locator('main').evaluate((e) => { e.scrollTop = e.scrollHeight })
      await capture(`settings-${key}-bottom`, 'light', 880, 720)
      await page.locator('main').evaluate((e) => { e.scrollTop = 0 })
    }
    // New-record dialogs: no data is saved.

    for (const [route, name, button] of [['other-income','other-income-editor','新增收入'], ['topics','topic-editor','新建选题']]) {
      await page.evaluate((route) => { location.hash = `#/${route}` }, route); await page.waitForTimeout(240)
      const trigger = page.getByRole('button', { name: button, exact: true }).last()
      if (await trigger.count()) { await trigger.click(); for (const [theme,width,height] of [['light',1440,900],['light',880,720],['dark',880,720]]) await capture(name,theme,width,height); await page.keyboard.press('Escape') }
    }
    await page.evaluate(() => { location.hash = '#/business' }); await page.waitForTimeout(240)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('creator-os:open-business-income-editor')))
    for (const [theme,width,height] of [['light',1440,900],['light',880,720],['dark',880,720]]) await capture('business-editor',theme,width,height)
    await page.keyboard.press('Escape')
    await page.evaluate(() => { location.hash = '#/other-income' }); await page.waitForTimeout(240)
    await page.getByRole('button', { name: 'MX Master 4产品体验分享与课程授权合作收入：收入金额', exact: true }).click()
    await capture('income-amount-popover', 'light', 880, 720)
    await page.keyboard.press('Escape')
    await page.evaluate(() => { location.hash = '#/home' }); await page.waitForTimeout(240)
    await page.getByRole('button', { name: '月', exact: true }).click()
    await capture('home-month', 'light', 880, 720)
    await page.evaluate(() => { location.hash = '#/other-income' }); await page.waitForTimeout(240)
    await capture('other-income-narrow', 'light', 700, 720)
    await capture('other-income-breakpoint704', 'light', 704, 720)
    const native = await application.browserWindow(page)
    await native.evaluate((window) => window.webContents.setZoomFactor(1.25))
    await capture('other-income-zoom125', 'light', 880, 720)
    await native.evaluate((window) => window.webContents.setZoomFactor(1))
    const captured = application.waitForEvent('window')
    await page.evaluate(() => window.creatorOS.openCapture())
    const capturePage = await captured
    await capturePage.waitForLoadState('domcontentloaded')
    await capturePage.getByLabel('记录内容').fill('这是快速记录的排版检查：中文混排MX Master 4，保留英文词组内部空格。')
    const captureData = await capturePage.evaluate(inspectTypography)
    await capturePage.screenshot({ path: resolve(output, 'quick-capture.png'), scale: 'css' })
    findings.push({ name: 'quick-capture', theme: 'light', style: 'warm', screenshot: 'quick-capture.png', ...captureData })
  }
} finally {
  await writeFile(resolve(output, 'audit.json'), JSON.stringify({ createdAt: new Date().toISOString(), scope: 'isolated seeded desktop app; visible viewport, no real user data', errors, findings }, null, 2))
  console.log(`AUDIT_OUTPUT=${output}\nCAPTURES=${findings.length}\nERRORS=${JSON.stringify(errors)}`)
  await application.close()
}
