import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const base = 'http://127.0.0.1:4201'
// Stage3.5 adds a confirmed 40px workspace tab bar above the frozen v8 shell.
// Keep the v8 comparison as a drift alarm, with a scoped allowance for that intentional navigation row.
const threshold = 0.053
const changedPixelThreshold = 0.23
const viewports = ['1280x720', '1440x900', '880x720']
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const server = spawn('python3', ['-m', 'http.server', '4201', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore'
})
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
await delay(400)

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const page = await browser.newPage()
const failures = []

async function compareImages(page, firstUrl, secondUrl) {
  return page.evaluate(async ({ firstUrl, secondUrl }) => {
    const loadImage = (url) => new Promise((resolveImage, rejectImage) => {
      const image = new Image()
      image.onload = () => resolveImage(image)
      image.onerror = rejectImage
      image.src = url
    })
    const [first, second] = await Promise.all([loadImage(firstUrl), loadImage(secondUrl)])
    if (first.width !== second.width || first.height !== second.height) {
      throw new Error(`visual size mismatch: ${first.width}x${first.height} != ${second.width}x${second.height}`)
    }
    const canvas = document.createElement('canvas')
    canvas.width = first.width
    canvas.height = first.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas unavailable')
    context.drawImage(first, 0, 0)
    const firstPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(second, 0, 0)
    const secondPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let difference = 0
    let changedPixels = 0
    let firstLuminance = 0
    let secondLuminance = 0
    for (let index = 0; index < firstPixels.length; index += 4) {
      difference += Math.abs(firstPixels[index] - secondPixels[index])
      difference += Math.abs(firstPixels[index + 1] - secondPixels[index + 1])
      difference += Math.abs(firstPixels[index + 2] - secondPixels[index + 2])
      if (
        Math.abs(firstPixels[index] - secondPixels[index])
        + Math.abs(firstPixels[index + 1] - secondPixels[index + 1])
        + Math.abs(firstPixels[index + 2] - secondPixels[index + 2]) > 30
      ) changedPixels += 1
      firstLuminance += firstPixels[index] + firstPixels[index + 1] + firstPixels[index + 2]
      secondLuminance += secondPixels[index] + secondPixels[index + 1] + secondPixels[index + 2]
    }
    const denominator = first.width * first.height * 3 * 255
    return {
      difference: difference / denominator,
      changedPixels: changedPixels / (first.width * first.height),
      firstLuminance: firstLuminance / denominator,
      secondLuminance: secondLuminance / denominator
    }
  }, { firstUrl, secondUrl })
}

try {
  await page.goto(`${base}/app/out/renderer/index.html`)
  for (const theme of ['light', 'dark']) {
    for (const mode of ['home', 'home-month']) {
      for (const viewport of viewports) {
        const referenceUrl = `${base}/visual-baseline/screenshots/v8-${mode}-${theme}-${viewport}.png`
        const actualUrl = `${base}/app/tests/visual/screenshots/app-${mode}-${theme}-${viewport}.png`
        const result = await compareImages(page, referenceUrl, actualUrl)
        console.log(`${mode}/${theme}/${viewport}: mean=${(result.difference * 100).toFixed(4)}%, changed=${(result.changedPixels * 100).toFixed(2)}%`)
        if (result.difference > threshold) failures.push(`${mode}/${theme}/${viewport} mean: ${(result.difference * 100).toFixed(4)}% > ${(threshold * 100).toFixed(2)}%`)
        if (result.changedPixels > changedPixelThreshold) failures.push(`${mode}/${theme}/${viewport} changed pixels: ${(result.changedPixels * 100).toFixed(2)}% > ${(changedPixelThreshold * 100).toFixed(2)}%`)
      }
    }
  }

  const capture = await compareImages(
    page,
    `${base}/app/tests/visual/screenshots/app-capture-light-420x300.png`,
    `${base}/app/tests/visual/screenshots/app-capture-dark-420x300.png`
  )
  console.log(`capture: light luminance=${capture.firstLuminance.toFixed(3)}, dark luminance=${capture.secondLuminance.toFixed(3)}, theme difference=${(capture.difference * 100).toFixed(2)}%`)
  if (capture.firstLuminance < 0.72) failures.push(`capture light theme is unexpectedly dark: ${capture.firstLuminance.toFixed(3)}`)
  if (capture.secondLuminance > 0.28) failures.push(`capture dark theme is unexpectedly light: ${capture.secondLuminance.toFixed(3)}`)
  if (capture.difference < 0.35) failures.push(`capture theme screenshots are too similar: ${(capture.difference * 100).toFixed(2)}%`)

  if (failures.length > 0) throw new Error(`visual comparison failed: ${failures.join('; ')}`)
  console.log('visual comparison passed: frozen v8 light/dark baselines with Stage3.5 navigation-shell allowance')
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
