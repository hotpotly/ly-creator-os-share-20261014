import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
interface Globals { creatorOS: CreatorOSApi; location: { hash: string } }
let app: ElectronApplication, page: Page
async function route(hash: string): Promise<void> { await page.evaluate(hash => { (globalThis as unknown as Globals).location.hash = hash }, hash) }
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
  await expect.poll(() => page.evaluate(async () => (await (globalThis as unknown as Globals).creatorOS.getWorkspace()).projects.length)).toBeGreaterThan(5)
  await page.evaluate(async () => { await (globalThis as unknown as Globals).creatorOS.setPreferences({ autoClassifyNewProject: false }) })
})
test.afterEach(async () => { await app?.close().catch(() => undefined) })
test('create AI commercial long video, edit independently and sync to topic', async () => {
  await page.locator('.topbar').getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await dialog.getByLabel('项目名称').fill('R10h三维分类')
  await dialog.getByRole('group', { name: '内容方向' }).getByRole('button', { name: 'AI', exact: true }).click()
  await dialog.getByRole('group', { name: '视频形式', exact: true }).getByRole('button', { name: '长视频', exact: true }).click()
  await dialog.getByLabel('项目类型', { exact: true }).selectOption('commercial')
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(page.getByRole('heading', { name: '重命名项目R10h三维分类', exact: true })).toBeVisible()
  const id = await page.evaluate(async () => (await (globalThis as unknown as Globals).creatorOS.getWorkspace()).projects.find(p => p.title === 'R10h三维分类')!.id)
  await page.getByLabel('R10h三维分类的视频形式', { exact: true }).selectOption('short')
  await expect(page.getByLabel('R10h三维分类的视频形式', { exact: true })).toHaveValue('short')
  await page.getByLabel('更改主要内容方向', { exact: true }).click()
  await page.locator('.project-config-options').getByRole('button', { name: '开箱', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => { const p = await (globalThis as unknown as Globals).creatorOS.getProject(id, false); return [p.contentTypeId, p.videoFormat, p.isCommercial, p.appliedTemplateId] }, id)).toEqual(['type-unboxing', 'short', true, 'template-ai-tutorial'])
  await route('#/topics')
  const row = page.locator('.topic-management-table tbody tr').filter({ hasText: 'R10h三维分类' })
  await expect(row.getByLabel('R10h三维分类的视频形式', { exact: true })).toHaveValue('short')
  await row.getByLabel('R10h三维分类的项目类型', { exact: true }).selectOption('ordinary')
  await expect.poll(() => page.evaluate(async id => (await (globalThis as unknown as Globals).creatorOS.getProject(id, false)).isCommercial, id)).toBe(false)
  await expect(row.locator('.classification-value').getByText('普通', { exact: true })).toBeVisible()
  await expect(page.getByText('普通项目', { exact: true })).toHaveCount(0)
})
test('three filters combine and old direction bookmarks become independent filters', async () => {
  await page.evaluate(async () => {
    const api = (globalThis as unknown as Globals).creatorOS
    for (const videoFormat of ['long', 'short'] as const) for (const isCommercial of [false, true]) await api.createProject({ title: 'R10h' + videoFormat + isCommercial, description: '', contentTypeId: 'type-ai', videoFormat, isCommercial, platformTargets: [] })
  })
  await route('#/projects')
  await page.getByLabel('筛选内容方向', { exact: true }).selectOption('type-ai')
  await page.getByLabel('筛选视频形式', { exact: true }).selectOption('short')
  await page.getByLabel('筛选项目类型', { exact: true }).selectOption('commercial')
  await expect(page.locator('.project-table article')).toHaveCount(1)
  await expect(page.locator('.project-table article')).toContainText('R10hshorttrue')
  await route('#/projects?type=type-commercial')
  await expect(page.getByLabel('筛选内容方向', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('筛选项目类型', { exact: true })).toHaveValue('commercial')
  await route('#/topics')
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await page.getByLabel('筛选视频形式', { exact: true }).selectOption('short')
  await page.getByLabel('筛选项目类型', { exact: true }).selectOption('commercial')
  await page.keyboard.press('Escape')
  await expect(page.locator('.topic-management-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.topic-management-table tbody tr')).toContainText('R10hshorttrue')
})
test('new topic carries format and kind through immediate project creation', async () => {
  await route('#/topics')
  await page.locator('.topbar').getByRole('button', { name: '新建选题', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建选题' })
  await dialog.getByLabel('选题名称').fill('R10h开箱选题')
  await dialog.getByRole('group', { name: '内容方向' }).getByRole('button', { name: '开箱', exact: true }).click()
  await dialog.getByRole('group', { name: '视频形式', exact: true }).getByRole('button', { name: '短视频', exact: true }).click()
  await dialog.getByLabel('项目类型', { exact: true }).selectOption('commercial')
  await dialog.getByRole('group', { name: '选题阶段' }).getByRole('button', { name: '已立项', exact: true }).click()
  await dialog.getByRole('button', { name: '新建选题', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => { const p = (await (globalThis as unknown as Globals).creatorOS.getWorkspace()).projects.find(p => p.title === 'R10h开箱选题'); return p && [p.contentTypeId, p.videoFormat, p.isCommercial] })).toEqual(['type-unboxing', 'short', true])
})
test('classification fields and filters fit both styles and light/dark at narrow widths', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 880, height: 720 })
    await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    await route('#/projects')
    const toolbar = page.locator('.project-toolbar')
    await expect(toolbar).toBeVisible()
    expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.locator('.topbar').getByRole('button', { name: '新建项目', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建项目' })
    await expect(dialog).toBeVisible()
    const geometry = await dialog.locator('.classification-fields').evaluate(el => { const r = el.getBoundingClientRect(); return { fits: el.scrollWidth <= el.clientWidth + 1, inside: r.left >= 0 && r.right <= innerWidth } })
    expect(geometry).toEqual({ fits: true, inside: true })
    if (style === 'warm') await dialog.screenshot({ path: info.outputPath('classification-' + theme + '.png') })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  }
})

test('classification updates reject non-main windows and invalid values', async () => {
  await page.evaluate(async () => { await (globalThis as unknown as Globals).creatorOS.openCapture() })
  await expect.poll(() => app.windows().length).toBe(2)
  const capture = app.windows().find(w => w !== page)!
  await capture.waitForLoadState('domcontentloaded')
  const denied = await capture.evaluate(async () => { try { await (globalThis as unknown as Globals).creatorOS.updateProjectClassification('ios', { isCommercial: true }); return '' } catch (error) { return String(error) } })
  expect(denied).toContain('越权窗口')
  const invalid = await page.evaluate(async () => { try { await (globalThis as unknown as Globals).creatorOS.updateProjectClassification('ios', { isCommercial: 'yes' } as unknown as { isCommercial: boolean }); return '' } catch (error) { return String(error) } })
  expect(invalid).not.toBe('')
  expect(await page.evaluate(async () => (await (globalThis as unknown as Globals).creatorOS.getProject('ios', false)).isCommercial)).toBe(false)
})

test('long and short video badges share yellow and blue across rows and menus in four themes', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await page.evaluate(async () => {
    for (const videoFormat of ['long', 'short'] as const) await (globalThis as unknown as Globals).creatorOS.createProject({ title: 'R10i' + videoFormat, description: '', contentTypeId: 'type-ai', videoFormat, platformTargets: [] })
  })
  await page.setViewportSize({ width: 880, height: 720 })
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    for (const destination of ['projects', 'topics']) {
      await route('#/' + destination)
      for (const [value, token] of [['long', 'project-5'], ['short', 'project-2']]) {
        const row = page.locator(destination === 'projects' ? '.project-table article' : '.topic-management-table tbody tr').filter({ hasText: 'R10i' + value })
        const badge = row.locator('.classification-value .field-label').filter({ hasText: value === 'long' ? '长视频' : '短视频' })
        await expect(badge).toHaveAttribute('style', new RegExp(token! + '-soft'))
        const contrast = await badge.evaluate(el => {
          const styles = getComputedStyle(el), ctx = document.createElement('canvas').getContext('2d')!
          const luminance = (color: string): number => {
            ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1)
            const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 })
            return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!
          }
          const fg = luminance(styles.color), bg = luminance(styles.backgroundColor)
          return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)
        })
        expect(contrast).toBeGreaterThanOrEqual(4.5)
      }
    }
    await route('#/projects')
    await page.getByLabel('筛选视频形式', { exact: true }).click()
    const menu = page.getByRole('menu', { name: '筛选视频形式选项' })
    await expect(menu.getByRole('menuitemradio', { name: '长视频', exact: true }).locator('.field-label')).toHaveAttribute('style', /project-5-soft/)
    await expect(menu.getByRole('menuitemradio', { name: '短视频', exact: true }).locator('.field-label')).toHaveAttribute('style', /project-2-soft/)
    if (style === 'warm') await menu.screenshot({ path: info.outputPath('video-colors-' + theme + '.png') })
    await page.keyboard.press('Escape')
  }
})


test('video format is a direct single choice with keyboard selection and undetermined persistence', async () => {
  await page.locator('.topbar').getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await dialog.getByLabel('项目名称').fill('R10k形式待定')
  const formats = dialog.getByRole('group', { name: '视频形式', exact: true })
  await expect(formats.getByRole('button')).toHaveCount(3)
  await expect(dialog.getByRole('combobox', { name: '视频形式', exact: true })).toHaveCount(0)
  for (const name of ['长视频', '短视频', '形式待定']) {
    const option = formats.getByRole('button', { name, exact: true })
    await option.focus(); await option.press('Space')
    await expect(option).toHaveAttribute('aria-pressed', 'true')
    await expect(formats.getByRole('button', { pressed: true })).toHaveCount(1)
    await expect(dialog).toBeVisible()
  }
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => {
    const project = (await (globalThis as unknown as Globals).creatorOS.getWorkspace()).projects.find(p => p.title === 'R10k形式待定')
    return project ? project.videoFormat : 'missing'
  })).toBe(null)
  await page.reload()
  await expect(page.getByLabel('R10k形式待定的视频形式', { exact: true })).toHaveValue('')
})
