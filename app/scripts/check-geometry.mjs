import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const base = 'http://127.0.0.1:4200/app/out/renderer/index.html'
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const server = spawn('python3', ['-m', 'http.server', '4200', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' })
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
await delay(400)

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.emulateMedia({ reducedMotion: 'reduce' })

const geometry = async () => page.evaluate(() => {
  const rect = (selector) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing geometry target: ${selector}`)
    const value = element.getBoundingClientRect()
    return { x: value.x, y: value.y, width: value.width, height: value.height }
  }
  const style = (selector) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing style target: ${selector}`)
    const value = getComputedStyle(element)
    return { display: value.display, paddingLeft: value.paddingLeft, borderRadius: value.borderRadius }
  }
  return {
    sidebar: rect('.sidebar'),
    tabbar: rect('.workspace-tabbar'),
    topbar: rect('.topbar'),
    page: rect('.page'),
    pageStyle: style('.page'),
    cardStyle: style('.card'),
    action: rect('.action-row'),
    sideRow: rect('.confirm-row'),
    sideIcon: rect('.square-mark'),
    inbox: rect('.inbox-card'),
    primary: rect('.home-column-primary'),
    secondary: rect('.home-column-secondary'),
    dividerStyle: style('.split-divider'),
    newProjectStyle: style('.new-project-button'),
    weekStyle: style('.week-grid'),
    pageScroll: (() => {
      const element = document.querySelector('.page')
      if (!(element instanceof HTMLElement)) throw new Error('Missing page scroller')
      return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }
    })()
  }
})

try {
  await page.goto(base)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const desktop = await geometry()
  assert.equal(Math.round(desktop.sidebar.width), 220)
  assert.equal(Math.round(desktop.tabbar.height), 40)
  assert.equal(Math.round(desktop.topbar.height), 56)
  assert.equal(desktop.pageStyle.paddingLeft, '24px')
  assert.equal(desktop.cardStyle.borderRadius, '12px')
  assert.ok(desktop.action.height >= 60)
  assert.equal(Math.round(desktop.sideRow.height), 58)
  assert.equal(Math.round(desktop.sideIcon.width), 32)
  assert.ok(desktop.inbox.y + desktop.inbox.height <= 720)
  assert.equal(desktop.dividerStyle.display, 'block')
  assert.ok(desktop.primary.width > desktop.secondary.width)
  assert.equal(desktop.pageScroll.clientHeight, 624)
  assert.ok(desktop.pageScroll.scrollHeight >= desktop.pageScroll.clientHeight)

  await page.setViewportSize({ width: 900, height: 720 })
  await page.waitForTimeout(30)
  const tablet = await geometry()
  assert.equal(Math.round(tablet.sidebar.width), 64)
  assert.equal(tablet.pageStyle.paddingLeft, '18px')
  assert.equal(tablet.dividerStyle.display, 'none')
  assert.ok(tablet.secondary.y > tablet.primary.y)
  assert.ok(tablet.pageScroll.scrollHeight > tablet.pageScroll.clientHeight)

  await page.setViewportSize({ width: 680, height: 720 })
  await page.waitForTimeout(30)
  const compact = await geometry()
  assert.equal(Math.round(compact.sidebar.width), 56)
  assert.equal(compact.weekStyle.display, 'grid')
  assert.equal(compact.newProjectStyle.display, 'none')

  console.log('geometry contracts passed: 1280 / 900 / 680')
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
