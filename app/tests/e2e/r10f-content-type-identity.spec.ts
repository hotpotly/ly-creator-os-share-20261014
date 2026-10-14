import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page

async function setRoute(hash: string): Promise<void> {
  await mainWindow.evaluate((nextHash) => { (globalThis as unknown as BrowserGlobals).location.hash = nextHash }, hash)
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.length)).toBeGreaterThan(5)
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

const types = [
  ['type-digital', '数码'], ['type-unboxing', '开箱'],
  ['type-system', '手机系统'], ['type-ai', 'AI'], ['type-undetermined', '待定方向']
] as const

async function fixtures(): Promise<void> {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    for (const type of (await api.getWorkspace()).contentTypes) await api.createProject({ title: `R10f${type.name}`, description: '', contentTypeId: type.id, platformTargets: ['B站'], colorToken: 'project-5' })
  })
}

test('text-only direction colors are shared by project and topic rows, menus, filters and new-topic choices', async () => {
  await fixtures()
  await setRoute('#/projects')
  for (const [id, name] of types) {
    const row = mainWindow.locator('.project-table article').filter({ hasText: `R10f${name}` })
    await expect(row.locator(`[data-content-type="${id}"] svg`)).toHaveCount(0)
    await expect(row.locator('.content-type-name')).toHaveText(name)
    expect(await row.locator('.project-color-dot').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await row.evaluate(el => { const probe = document.createElement('i'); probe.style.color = 'var(--project-5)'; el.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color }))
  }
  await mainWindow.getByLabel('筛选内容方向', { exact: true }).click()
  const filter = mainWindow.getByRole('menu', { name: '筛选内容方向选项' })
  for (const [id] of types) await expect(filter.locator(`[data-content-type="${id}"]`)).toBeVisible()
  await filter.getByRole('menuitemradio', { name: '开箱', exact: true }).click()
  await expect(mainWindow.getByLabel('筛选内容方向', { exact: true })).toHaveValue('type-unboxing')
  await expect(mainWindow.locator('.project-table article .content-type-label:not([data-content-type="type-unboxing"])')).toHaveCount(0)
  await mainWindow.getByLabel('筛选内容方向', { exact: true }).selectOption('')
  const project = mainWindow.locator('.project-table article').filter({ hasText: 'R10f数码' })
  await project.getByRole('button', { name: /内容方向/ }).click()
  await mainWindow.getByRole('menu', { name: '更改内容方向' }).getByRole('menuitemradio', { name: '开箱', exact: true }).click()
  await expect(project.locator('[data-content-type="type-unboxing"]')).toBeVisible()
  await setRoute('#/topics')
  const topic = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: 'R10f数码' })
  await expect(topic.locator('[data-content-type="type-unboxing"]')).toBeVisible()
  await topic.getByRole('button', { name: '开箱', exact: true }).click()
  const menu = mainWindow.getByRole('menu', { name: '选择内容方向' })
  for (const [id] of types) await expect(menu.locator(`[data-content-type="${id}"]`)).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await mainWindow.getByRole('button', { name: '筛选', exact: true }).click()
  for (const [id] of types) await expect(mainWindow.locator(`.topic-filter-direction [data-content-type="${id}"]`)).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await mainWindow.locator('.topbar').getByRole('button', { name: '新建选题', exact: true }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建选题' })
  for (const [id] of types) await expect(dialog.locator(`[data-content-type="${id}"]`)).toBeVisible()
  await dialog.getByRole('button', { name: '开箱', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '开箱', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('renaming preserves identity; custom and inactive directions retain their actual names', async () => {
  const customId = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.updateContentType('type-digital', { name: '硬件体验' })
    const custom = await api.createContentType('很长的自定义内容方向名称')
    await api.createProject({ title: '自定义方向项目', description: '', contentTypeId: custom.id, platformTargets: [], colorToken: 'project-1' })
    await api.updateContentType(custom.id, { isActive: false })
    return custom.id
  })
  await setRoute('#/projects')
  await expect(mainWindow.locator('.project-table [data-content-type="type-digital"]').first()).toContainText('硬件体验')
  await expect(mainWindow.locator('.project-table [data-content-type="type-digital"]').first()).toHaveAttribute('data-content-tone', 'digital')
  const row = mainWindow.locator('.project-table article').filter({ hasText: '自定义方向项目' })
  await expect(row.locator(`[data-content-type="${customId}"]`)).toHaveAttribute('data-content-tone', 'custom')
  await expect(row.locator('.content-type-name')).toHaveText('很长的自定义内容方向名称')
  await row.getByRole('button', { name: /内容方向/ }).click()
  await expect(mainWindow.getByRole('menuitemradio', { name: '很长的自定义内容方向名称', exact: true })).toBeDisabled()
})

test('four themes and narrow widths keep text badges legible without changing table geometry', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await fixtures()
  const sizes: Record<string, number> = {}
  for (const width of [1440, 880]) {
    await mainWindow.setViewportSize({ width, height: 900 })
    for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
      await mainWindow.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
      for (const route of ['projects', 'topics']) {
        await setRoute(`#/${route}`)
        const table = mainWindow.locator(route === 'projects' ? '.project-table' : '.topic-management-table')
        await expect(table.locator('.content-type-label').first()).toBeVisible()
        const geometry = await table.locator('.content-type-label').evaluateAll(elements => elements.map(el => {
          const r = el.getBoundingClientRect()
          const name = el.querySelector('.content-type-name')!.getBoundingClientRect()
          const styles = getComputedStyle(el)
          const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
          const luminance = (color: string): number => {
            ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1)
            const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 })
            return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!
          }
          const fg = luminance(styles.color), bg = luminance(styles.backgroundColor)
          return { iconCount: el.querySelectorAll('svg').length, fits: name.x >= r.x && name.right <= r.right + 1, background: styles.backgroundColor, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) }
        }))
        expect(geometry.every(item => item.iconCount === 0 && item.fits && item.background !== 'rgba(0, 0, 0, 0)' && item.contrast >= 4.5)).toBe(true)
        const height = (await table.boundingBox())!.height
        const key = `${route}-${width}`
        if (sizes[key] === undefined) sizes[key] = height
        expect(Math.abs(height - sizes[key]!)).toBeLessThanOrEqual(1)
        if (style === 'feishu' && width === 1440) await table.screenshot({ path: info.outputPath(`${route}-${theme}.png`) })
      }
    }
  }
})

test('direction filter keeps keyboard selection and project creation uses the same identity', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await setRoute('#/projects')
  const select = mainWindow.getByLabel('筛选内容方向', { exact: true })
  await select.focus(); await mainWindow.keyboard.press('ArrowDown')
  const menu = mainWindow.getByRole('menu', { name: '筛选内容方向选项' })
  await expect(menu.getByRole('menuitemradio', { name: '全部方向', exact: true })).toBeFocused()
  await mainWindow.keyboard.press('End'); await mainWindow.keyboard.press('Enter')
  await expect(select).toHaveValue('type-undetermined')
  await expect(mainWindow.locator('.content-type-select[data-content-type="type-undetermined"]')).toHaveAttribute('data-content-tone', 'custom')
  for (const theme of ['light', 'dark']) {
    await mainWindow.evaluate(theme => { document.documentElement.dataset.visualStyle = 'feishu'; document.documentElement.dataset.theme = theme }, theme)
    expect(await select.evaluate(el => el.parentElement!.querySelectorAll('svg').length)).toBe(0)
    await select.click()
    await menu.screenshot({ path: info.outputPath(`filter-${theme}.png`) })
    await mainWindow.keyboard.press('Escape')
  }
  await mainWindow.locator('.topbar').getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建项目' })
  for (const [id] of types) await expect(dialog.locator(`[data-content-type="${id}"]`)).toBeVisible()
  await dialog.getByRole('group', { name: '内容方向' }).getByRole('button', { name: '开箱', exact: true }).click()
  await expect(dialog.getByRole('group', { name: '内容方向' }).getByRole('button', { name: '开箱', exact: true })).toHaveAttribute('aria-pressed', 'true')
})


test('stage, platform and date values share compact backgrounds; month colors stay stable when dates change', async ({ browserName }, info) => {
  await fixtures()
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    const topic = workspace.topics.find(topic => topic.title === 'R10f数码')!
    await api.updateTopic(topic.id, { startAt: '2026-09-04', expectedCompletionAt: '2027-09-08', actualCompletionAt: '2027-10-09' })
    const column = await api.createTopicColumn('参考日期', 'date')
    await api.setTopicCustomValue(topic.id, column.id, '2028-09-18')
  })
  await setRoute('#/projects')
  const project = mainWindow.locator('.project-table article').filter({ hasText: 'R10f数码' })
  await expect(project.locator('.platform-label')).toHaveText('B站')
  await expect(project.locator('.project-stage-label')).toBeVisible()
  await project.getByRole('button', { name: /发布平台/ }).click()
  await mainWindow.getByRole('button', { name: '小红书', exact: true }).click()
  await mainWindow.keyboard.press('Escape')
  await expect(project.locator('.platform-label')).toHaveCount(2)
  await setRoute('#/topics')
  const topic = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: 'R10f数码' })
  await expect(topic.locator('.topic-stage-label')).toBeVisible()
  await expect(topic.locator('[data-month="9"]')).toHaveCount(3)
  await expect(topic.locator('[data-month="10"]')).toHaveCount(1)
  const colors = await topic.locator('.month-date-label').evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundColor))
  expect(colors[0]).toBe(colors[1]); expect(colors[1]).not.toBe(colors[2]); expect(colors[3]).toBe(colors[0])
  await topic.getByRole('button', { name: '9月4日', exact: true }).click()
  const picker = mainWindow.getByRole('dialog', { name: '设置开始时间' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: '下个月', exact: true }).click()
  await picker.getByRole('gridcell', { name: /^选择2026年10月5日/ }).click()
  await expect(topic.locator('[data-month="10"]')).toHaveCount(2)
  expect(browserName).toBe('chromium')
  await mainWindow.keyboard.press('Escape')
  await expect(topic.locator('.topic-stars button')).toHaveCount(3)
  await topic.screenshot({ path: info.outputPath('month-date-row.png') })
})
