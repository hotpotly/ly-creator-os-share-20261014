import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const base = 'http://127.0.0.1:4199'
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const viewports = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '880x720', width: 880, height: 720 }
]
const server = spawn('python3', ['-m', 'http.server', '4199', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore'
})

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
await delay(500)

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const page = await context.newPage()

const freezeVisualState = async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

try {
  await mkdir(resolve(root, 'visual-baseline/screenshots'), { recursive: true })
  await mkdir(resolve(root, 'app/tests/visual/screenshots'), { recursive: true })

  for (const theme of ['light', 'dark']) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.goto(`${base}/prototypes/app-ui-core-prototype-v8-20260718.html`)
      await page.evaluate((nextTheme) => {
        localStorage.clear()
        localStorage.setItem('ly-creator-theme', nextTheme)
        document.documentElement.dataset.theme = nextTheme
      }, theme)
      await freezeVisualState()
      await page.waitForFunction((nextTheme) => document.documentElement.dataset.theme === nextTheme, theme)
      await page.screenshot({ path: resolve(root, `visual-baseline/screenshots/v8-home-${theme}-${viewport.name}.png`) })
      await page.locator('[data-schedule-mode="month"]').click()
      await page.locator('#toast').evaluate((toast) => toast.classList.remove('show'))
      await page.screenshot({ path: resolve(root, `visual-baseline/screenshots/v8-home-month-${theme}-${viewport.name}.png`) })

      await page.goto(`${base}/app/out/renderer/index.html`)
      await page.evaluate((nextTheme) => {
        localStorage.clear()
        localStorage.setItem('ly.creator-os.theme', nextTheme)
        document.documentElement.dataset.theme = nextTheme
      }, theme)
      await page.reload()
      await freezeVisualState()
      await page.waitForFunction((nextTheme) => document.documentElement.dataset.theme === nextTheme, theme)
      await page.screenshot({ path: resolve(root, `app/tests/visual/screenshots/app-home-${theme}-${viewport.name}.png`) })
      await page.getByRole('button', { name: '月', exact: true }).click()
      await page.screenshot({ path: resolve(root, `app/tests/visual/screenshots/app-home-month-${theme}-${viewport.name}.png`) })
    }

    await page.setViewportSize({ width: 420, height: 300 })
    await page.goto(`${base}/app/out/renderer/index.html#/capture`)
    await page.evaluate((nextTheme) => {
      localStorage.setItem('ly.creator-os.theme', nextTheme)
      document.documentElement.dataset.theme = nextTheme
    }, theme)
    await page.reload()
    await freezeVisualState()
    await page.waitForFunction((nextTheme) => document.documentElement.dataset.theme === nextTheme, theme)
    await page.waitForTimeout(50)
    await page.screenshot({ path: resolve(root, `app/tests/visual/screenshots/app-capture-${theme}-420x300.png`) })
  }
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
