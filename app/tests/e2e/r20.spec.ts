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

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.contentTypes.length) ?? 0)).toBe(5)
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

test('首页没有代办时植物保持初始状态且进度轨道清晰可见', async () => {
  const plant = mainWindow.getByLabel('今日待办成长植物')
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  await expect(plant.locator('.frame-1')).toHaveCSS('opacity', '1')
  await expect(plant.locator('.frame-4')).toHaveCSS('opacity', '0')
  await expect(plant).not.toHaveClass(/celebrating/)

  const progressColors = await plant.locator('.daily-growth-progress').evaluate((element) => {
    const styles = (globalThis as unknown as {
      getComputedStyle(node: unknown): { backgroundColor: string; getPropertyValue(name: string): string }
    }).getComputedStyle
    const root = styles((element as unknown as { ownerDocument: { documentElement: unknown } }).ownerDocument.documentElement)
    const fill = element.querySelector('i')
    return {
      track: styles(element).backgroundColor,
      fill: fill ? styles(fill).backgroundColor : '',
      fillToken: root.getPropertyValue('--growth-progress-fill').trim(),
      trackToken: root.getPropertyValue('--growth-progress-track').trim()
    }
  })
  expect(progressColors.fillToken).toBe('#b9caa8')
  expect(progressColors.trackToken).toBe('#d8d4ca')
  expect(progressColors.track).not.toBe(progressColors.fill)
  expect(progressColors.track).not.toBe('rgba(0, 0, 0, 0)')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r33-home-growth-empty-review.png'), fullPage: true })
  }
})

test('首页会记住上次使用的待办分类方式', async () => {
  await mainWindow.getByRole('button', { name: '按分类' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).preferences.homeTodoView)).toBe('category')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await expect(mainWindow.getByRole('heading', { name: '设置' })).toBeVisible()
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/home' })
  await expect(mainWindow.getByRole('button', { name: '按分类' })).toHaveClass(/active/)
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('button', { name: '按分类' })).toHaveClass(/active/)
})

test('设置中的天气与时间预览可临时覆盖首页场景', async () => {
  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({
      weatherPreviewCondition: 'snow',
      weatherPreviewPeriod: 'day'
    })
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  let plant = mainWindow.getByLabel('今日待办成长植物')
  await expect(plant).toHaveAttribute('data-weather', 'snow')
  await expect(plant).toHaveAttribute('data-period', 'day')
  const snowBackground = await plant.locator('.daily-growth-scene').evaluate((element) => (
    (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundImage: string } }).getComputedStyle(element).backgroundImage
  ))
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r34-home-weather-snow-review.png'), fullPage: true })
  }

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({
      weatherPreviewCondition: 'clear',
      weatherPreviewPeriod: 'day'
    })
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  plant = mainWindow.getByLabel('今日待办成长植物')
  await expect(plant).toHaveAttribute('data-weather', 'clear')
  const clearBackground = await plant.locator('.daily-growth-scene').evaluate((element) => (
    (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundImage: string } }).getComputedStyle(element).backgroundImage
  ))
  expect(clearBackground).not.toBe(snowBackground)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r34-home-weather-clear-review.png'), fullPage: true })
  }

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({
      weatherPreviewCondition: 'rain',
      weatherPreviewPeriod: 'day'
    })
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  plant = mainWindow.getByLabel('今日待办成长植物')
  await expect(plant).toHaveAttribute('data-weather', 'rain')
  const paneGeometry = await plant.evaluate((element) => {
    const host = element as unknown as {
      querySelector(selector: string): { getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; height: number } } | null
      querySelectorAll(selector: string): ArrayLike<{ getBoundingClientRect(): { left: number; right: number; top: number; bottom: number } }>
    }
    const scene = host.querySelector('.daily-growth-scene')!.getBoundingClientRect()
    const panes = Array.from(host.querySelectorAll('.daily-weather-pane')).map((pane) => pane.getBoundingClientRect())
    const style = (globalThis as unknown as {
      getComputedStyle(node: unknown, pseudo?: string): { animationName: string; backgroundImage: string; opacity: string }
    }).getComputedStyle
    return {
      count: panes.length,
      allInsideWindow: panes.every((pane) => (
        pane.left >= scene.left
        && pane.right <= scene.right
        && pane.top >= scene.top
        && pane.bottom <= scene.top + scene.height * 0.72
      )),
      precipitationAnimation: style(host.querySelector('.pane-1')!, '::after').animationName,
      precipitationBackground: style(host.querySelector('.pane-1')!, '::after').backgroundImage,
      precipitationOpacity: style(host.querySelector('.pane-1')!, '::after').opacity
    }
  })
  expect(paneGeometry).toMatchObject({
    count: 4,
    allInsideWindow: true,
    precipitationAnimation: 'daily-weather-rain',
    precipitationOpacity: '0.34'
  })
  expect(paneGeometry.precipitationBackground).toContain('radial-gradient')
  expect(paneGeometry.precipitationBackground).not.toContain('107deg')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r34-home-weather-rain-review.png'), fullPage: true })
  }

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({
      weatherPreviewCondition: 'cloudy',
      weatherPreviewPeriod: 'day'
    })
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  plant = mainWindow.getByLabel('今日待办成长植物')
  const cloudyBackground = await plant.locator('.daily-growth-scene').evaluate((element) => (
    (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundImage: string } }).getComputedStyle(element).backgroundImage
  ))
  expect(cloudyBackground).toBe(clearBackground)
  const cloudMotion = await plant.evaluate((element) => {
    const clouds = Array.from(element.querySelectorAll('.daily-weather-cloud'))
    const style = (globalThis as unknown as {
      getComputedStyle(node: unknown): { animationName: string; opacity: string }
    }).getComputedStyle
    const styles = clouds.map((cloud) => style(cloud))
    return {
      count: clouds.length,
      visible: styles.every((style) => Number(style.opacity) > 0),
      animations: new Set(styles.map((style) => style.animationName)).size === 1
        ? styles[0]?.animationName
        : 'mixed'
    }
  })
  expect(cloudMotion).toEqual({
    count: 8,
    visible: true,
    animations: 'daily-weather-cloud-drift'
  })
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r34-home-weather-cloudy-review.png'), fullPage: true })
  }

  for (const period of ['sunrise', 'sunset', 'night'] as const) {
    await mainWindow.evaluate(async (nextPeriod) => {
      await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({
        weatherPreviewCondition: 'clear',
        weatherPreviewPeriod: nextPeriod
      })
    }, period)
    await mainWindow.reload()
    await mainWindow.waitForLoadState('domcontentloaded')
    plant = mainWindow.getByLabel('今日待办成长植物')
    await expect(plant).toHaveAttribute('data-period', period)
    if (period === 'night') {
      const nightPane = plant.locator('.pane-1')
      await expect.poll(() => nightPane.evaluate((pane) => (
        Number(pane.ownerDocument.defaultView!.getComputedStyle(pane, '::before').opacity)
      ))).toBeCloseTo(0.58, 2)
      const nightGlass = await nightPane.evaluate((pane) => {
        const style = pane.ownerDocument.defaultView!.getComputedStyle(pane, '::before')
        return { background: style.backgroundImage, blend: style.mixBlendMode }
      })
      expect(nightGlass.background).toContain('linear-gradient')
      expect(nightGlass.blend).toBe('multiply')
    }
    if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
      await mainWindow.screenshot({ path: join(import.meta.dirname, `../../test-results/r36-home-weather-${period}-review.png`), fullPage: true })
    }
  }
})

test('天气城市使用紧凑滚动菜单并提供立即更新入口', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '首页与待办' }).click()
  const cityPicker = mainWindow.getByRole('button', { name: '首页天气城市' })
  await expect(cityPicker).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '立即更新天气' })).toBeDisabled()
  await cityPicker.click()
  const cityMenu = mainWindow.getByRole('menu', { name: '选择天气城市' })
  await expect(cityMenu).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r38-weather-city-picker-review.png'), fullPage: true })
  }
  const menuGeometry = await cityMenu.evaluate((element) => {
    const scroll = element.querySelector('.weather-city-picker-scroll')
    return {
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
      clientHeight: scroll?.clientHeight ?? 0,
      scrollHeight: scroll?.scrollHeight ?? 0
    }
  })
  expect(menuGeometry.width).toBeLessThanOrEqual(200)
  expect(menuGeometry.height).toBeLessThanOrEqual(240)
  expect(menuGeometry.scrollHeight).toBeGreaterThan(menuGeometry.clientHeight)
  await cityMenu.getByRole('menuitemradio', { name: '长沙' }).click()
  await expect(cityMenu).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => (
    (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.weatherCity
  ))).toBe('长沙')
  await expect(mainWindow.getByRole('button', { name: '立即更新天气' })).toBeEnabled()
  await expect(mainWindow.locator('.weather-scene-settings')).toContainText('已选择长沙')
})

test('设置只在主页面用紧凑菜单切换二级分类', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  const trigger = mainWindow.getByRole('button', { name: '当前设置分类：通用' })
  await trigger.click()
  const menu = mainWindow.getByRole('menu', { name: '切换设置分类' })
  await expect(menu).toBeVisible()
  const geometry = await menu.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width
  }))
  expect(geometry.width).toBeLessThanOrEqual(220)
  expect(geometry.height).toBeLessThanOrEqual(240)
  await expect(mainWindow.locator('.sidebar').getByRole('menu', { name: '切换设置分类' })).toHaveCount(0)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r39-settings-section-menu-review.png'), fullPage: true })
  }
  await mainWindow.locator('.settings-section-content').click({ position: { x: 8, y: 8 } })
  await expect(menu).toBeHidden()
  await trigger.click()
  await menu.getByRole('menuitemradio', { name: 'AI与发布' }).click()
  await expect(mainWindow.locator('.provider-settings')).toBeVisible()
  await expect(mainWindow.locator('.appearance-settings')).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '当前设置分类：AI与发布' })).toBeVisible()
})

test('设置可统一修改待办分类名称、颜色和植物相对权重', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '首页与待办' }).click()
  const settings = mainWindow.locator('.todo-category-settings')
  await expect(settings).toBeVisible()
  await settings.getByLabel('自媒体分类名称').fill('频道制作')
  await settings.getByLabel('AI分类颜色').selectOption('project-9')
  await settings.locator('.todo-category-weight-field input').nth(0).fill('40')
  await settings.getByLabel('AI相对权重').fill('10')
  await expect(settings).toContainText('只在今天实际有任务的分类之间自动换算')
  await settings.getByRole('button', { name: '保存分类' }).click()
  await expect(settings).toContainText('首页、浮窗和成长植物已同步')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const preferences = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences
    return {
      label: preferences.todoCategoryLabels.self_media,
      color: preferences.todoCategoryColors.ai,
      selfMediaWeight: preferences.todoCategoryWeights.self_media,
      aiWeight: preferences.todoCategoryWeights.ai
    }
  })).toEqual({ label: '频道制作', color: 'project-9', selfMediaWeight: 40, aiWeight: 10 })

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/home' })
  await mainWindow.getByRole('button', { name: '新建', exact: true }).click()
  const composer = mainWindow.getByRole('dialog', { name: '批量新建待办' })
  await composer.getByRole('textbox').first().fill('频道制作：写脚本')
  await expect(composer.getByLabel('待办分类')).toHaveValue('self_media')
  await composer.getByRole('button', { name: '创建1条待办' }).click()
  await mainWindow.getByRole('button', { name: '按分类' }).click()
  await expect(mainWindow.locator('.todo-group > header h3')).toContainText('频道制作')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '首页与待办' }).click()
  await expect(mainWindow.locator('.todo-category-settings')).toContainText('今天实际占比：频道制作100%')
})

test('书本会打开同风格白噪音页并在收起后继续保留播放状态', async () => {
  const plant = mainWindow.getByLabel('今日待办成长植物')
  await plant.getByRole('button', { name: '打开白噪音书本' }).click()
  const book = mainWindow.getByRole('dialog', { name: '窗边白噪音' })
  await expect(book).toBeVisible()
  await expect(book.getByText('开放声音来自Blankie声音库')).toBeVisible()
  await book.getByRole('button', { name: /雨声/ }).click()
  await expect(plant).toHaveAttribute('data-ambient-sound', 'rain')
  await expect(book.getByRole('button', { name: /雨声/ })).toHaveAttribute('aria-pressed', 'true')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r34-home-ambient-book-review.png'), fullPage: true })
  }

  await mainWindow.getByRole('heading', { name: '待办', exact: true }).click()
  await expect(book).toHaveCount(0)
  await expect(plant).toHaveAttribute('data-ambient-sound', 'rain')
  await plant.getByRole('button', { name: /打开白噪音书本，正在播放雨声/ }).click()
  await mainWindow.getByRole('dialog', { name: '窗边白噪音' }).getByRole('button', { name: '停止' }).click()
  await expect(plant).toHaveAttribute('data-ambient-sound', 'off')
})

test('R20首页批量创建、分类视图、默认勾选与右键进度保持轻量', async () => {
  await expect.poll(() => mainWindow.evaluate(async () => {
    const colors = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.todoCategoryColors
    return { life: colors.life, health: colors.other_work }
  })).toEqual({ life: 'project-2', health: 'project-1' })
  await expect(mainWindow.getByRole('heading', { name: '待办', exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '今天要推进', exact: true })).toHaveCount(0)
  await expect(mainWindow.locator('.todo-workspace .todo-group')).toHaveCount(0)
  await expect(mainWindow.locator('.todo-workspace .todo-groups')).toBeHidden()

  await mainWindow.getByRole('button', { name: '新建', exact: true }).click()
  const composer = mainWindow.getByRole('dialog', { name: '批量新建待办' })
  await composer.getByRole('textbox').first().fill('今天上午整理iOS 27第一周体验文案，下午研究AI工作流，晚上买洗衣液')
  await expect(composer.locator('.todo-draft-list article')).toHaveCount(3)
  await expect(composer.locator('.todo-project-link').first()).toHaveAttribute('data-project-id', 'ios')
  await expect(composer.getByRole('button', { name: '创建3条待办' })).toBeEnabled()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r20-composer-review.png'), fullPage: true })
  await composer.getByRole('button', { name: '创建3条待办' }).click()

  await expect(mainWindow.locator('.todo-workspace')).toContainText('整理iOS 27第一周体验文案')
  await expect(mainWindow.locator('.todo-workspace')).toContainText('研究AI工作流')
  await expect(mainWindow.locator('.todo-workspace')).toContainText('买洗衣液')
  await expect(mainWindow.locator('.todo-workspace')).not.toContainText('来自排期')
  await expect(mainWindow.locator('.todo-category-tag')).toHaveCount(3)
  await mainWindow.getByRole('button', { name: '按分类' }).click()
  await expect(mainWindow.locator('.todo-group > header h3')).toHaveText(['自媒体', '生活', 'AI'])
  await expect(mainWindow.getByText('健康', { exact: true })).toHaveCount(0)
  const categoryCard = mainWindow.locator('.todo-group.category-card').first()
  await expect.poll(() => categoryCard.evaluate((element) => {
    const style = (globalThis as unknown as { getComputedStyle(node: unknown, pseudo?: string): { backgroundColor: string; content: string } }).getComputedStyle
    return { background: style(element).backgroundColor, divider: style(element, '::after').content }
  })).toMatchObject({ divider: 'none' })
  expect(await categoryCard.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string } }).getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(mainWindow.locator('.todo-category-color-button')).toHaveCount(0)
  const lifeCategoryCard = mainWindow.locator('.todo-group.category-card').filter({ hasText: '生活' })
  await lifeCategoryCard.locator(':scope > header').click({ button: 'right' })
  await mainWindow.getByRole('dialog', { name: '设置生活分类颜色' }).getByRole('button', { name: '使用颜色10' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.todoCategoryColors.life)).toBe('project-10')

  const aiRow = mainWindow.locator('.todo-row').filter({ hasText: '研究AI工作流' })
  await expect(aiRow.locator('.todo-progress-line')).toHaveCount(0)
  await aiRow.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '记录进度' }).click()
  const progress = mainWindow.getByRole('dialog', { name: /研究AI工作流的待办操作/ })
  await progress.getByRole('button', { name: '50%' }).click()
  await expect(aiRow.locator('.todo-progress-line')).toContainText('50%')
  await expect(aiRow.locator('.todo-check')).toHaveClass(/partial/)
  await progress.getByRole('button', { name: '完成', exact: true }).click()
  await expect(progress).toHaveCount(0)
  await expect(aiRow).not.toHaveClass(/completed/)
  await expect(aiRow.locator('.todo-progress-line')).toContainText('50%')

  await aiRow.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '调整进度' }).click()
  await expect(mainWindow.getByRole('dialog', { name: /研究AI工作流的待办操作/ })).toBeVisible()
  await mainWindow.getByRole('button', { name: '按时间' }).click()
  await expect(mainWindow.getByRole('dialog', { name: /研究AI工作流的待办操作/ })).toHaveCount(0)

  await aiRow.getByRole('button', { name: '完成研究AI工作流' }).click()
  await expect(aiRow).toHaveClass(/completed/)
  await aiRow.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '调整进度' }).click()
  await mainWindow.getByRole('dialog', { name: /研究AI工作流的待办操作/ }).getByRole('button', { name: '完成', exact: true }).click()
  await expect(aiRow).toHaveClass(/completed/)
  await aiRow.getByRole('button', { name: '重新打开研究AI工作流' }).click()
  await expect(aiRow.locator('.todo-progress-line')).toContainText('50%')

  await mainWindow.getByRole('button', { name: '按时间' }).click()
  await mainWindow.getByRole('button', { name: '新建', exact: true }).click()
  const unsegmentedComposer = mainWindow.getByRole('dialog', { name: '批量新建待办' })
  await unsegmentedComposer.getByRole('textbox').first().fill('AI浏览器整理资料')
  await expect(unsegmentedComposer.locator('.todo-project-link')).toHaveAttribute('data-project-id', 'ai-browser')
  await expect(unsegmentedComposer.getByLabel('待办时段')).toHaveValue('')
  await unsegmentedComposer.getByRole('button', { name: '创建1条待办' }).click()
  const unsegmentedGroup = mainWindow.locator('.todo-group').filter({ has: mainWindow.getByRole('heading', { name: '未分时段', exact: true }) })
  await expect(unsegmentedGroup).toContainText('AI浏览器整理资料')
  await expect(unsegmentedGroup).toContainText('AI浏览器入门教学')
  await expect(mainWindow.locator('.todo-group').filter({ has: mainWindow.getByRole('heading', { name: '晚上', exact: true }) })).not.toContainText('AI浏览器整理资料')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r20-home-review.png'), fullPage: true })
})

test('首页会记住批量预览中的手动分类修正并用于同类待办', async () => {
  await mainWindow.getByRole('button', { name: '新建', exact: true }).click()
  let composer = mainWindow.getByRole('dialog', { name: '批量新建待办' })
  await composer.getByRole('textbox').first().fill('整理桌面')
  await expect(composer.getByLabel('待办分类')).toHaveValue('self_media')
  await composer.getByLabel('待办分类').selectOption('life')
  await composer.getByRole('button', { name: '创建1条待办' }).click()

  await expect.poll(() => mainWindow.evaluate(async () => {
    const memories = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.todoCategoryMemories
    return memories.map((memory) => ({ title: memory.title, category: memory.category }))
  })).toContainEqual({ title: '整理桌面', category: 'life' })

  await mainWindow.getByRole('button', { name: '新建', exact: true }).click()
  composer = mainWindow.getByRole('dialog', { name: '批量新建待办' })
  await composer.getByRole('textbox').first().fill('整理桌面柜')
  await expect(composer.getByLabel('待办分类')).toHaveValue('life')
  await expect(composer).toContainText('已按你之前的修改分类1条，仍可调整')
})

test('首页植物按今日已有分类归一化权重并随细进度连续成长', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    await api.createTodoBatch([
      {
        title: '写稿2小时',
        plannedDate: workspace.today,
        segment: 'morning',
        category: 'self_media',
        projectId: null,
        trackingMode: 'progress',
        progress: 50
      },
      {
        title: '整理素材1H',
        plannedDate: workspace.today,
        segment: 'afternoon',
        category: 'self_media',
        projectId: null,
        trackingMode: 'checklist',
        progress: 0
      },
      {
        title: '买洗衣液',
        plannedDate: workspace.today,
        segment: 'evening',
        category: 'life',
        projectId: null,
        trackingMode: 'checklist',
        progress: 0
      },
      {
        title: '跑步30分钟',
        plannedDate: workspace.today,
        segment: 'evening',
        category: 'other_work',
        projectId: null,
        trackingMode: 'checklist',
        progress: 0
      },
      {
        title: '历史积压4小时',
        plannedDate: '2026-07-01',
        segment: null,
        category: 'self_media',
        projectId: null,
        trackingMode: 'checklist',
        progress: 0
      }
    ])
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')

  const plant = mainWindow.getByLabel('今日待办成长植物')
  await expect(plant).toBeVisible()
  await expect(plant).toHaveAttribute('data-weather', 'cloudy')
  await expect(plant).toHaveAttribute('data-weather-source', 'fallback')
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13')
  await expect(mainWindow.locator('.home-column-secondary > .daily-growth')).toHaveCount(1)
  await expect(mainWindow.locator('.home-column-secondary > .inbox-card')).toHaveCount(1)
  const plantGeometry = await plant.evaluate((element) => {
    const button = element.querySelector('.daily-growth-plant')
    const stack = element.querySelector('.daily-growth-stack')
    const scene = element.querySelector('.daily-growth-scene')
    const inbox = element.parentElement?.querySelector('.inbox-card')
    const style = (globalThis as unknown as {
      getComputedStyle(node: unknown): { backgroundImage: string; borderRadius: string }
    }).getComputedStyle(scene)
    const buttonStyle = (globalThis as unknown as {
      getComputedStyle(node: unknown): { borderRadius: string }
    }).getComputedStyle(button)
    const buttonRect = button?.getBoundingClientRect()
    const inboxRect = inbox?.getBoundingClientRect()
    return {
      height: element.getBoundingClientRect().height,
      buttonWidth: buttonRect?.width ?? 0,
      sceneWidth: scene?.getBoundingClientRect().width ?? 0,
      stackHeight: stack?.getBoundingClientRect().height ?? 0,
      background: style.backgroundImage,
      borderRadius: buttonStyle.borderRadius,
      leftDifference: buttonRect && inboxRect ? Math.abs(buttonRect.left - inboxRect.left) : 999,
      rightDifference: buttonRect && inboxRect ? Math.abs(buttonRect.right - inboxRect.right) : 999
    }
  })
  expect(plantGeometry.height).toBeLessThanOrEqual(350)
  expect(plantGeometry.buttonWidth).toBeLessThanOrEqual(420)
  expect(plantGeometry.sceneWidth).toBeGreaterThan(220)
  expect(plantGeometry.stackHeight).toBeLessThan(260)
  expect(plantGeometry.background).not.toBe('none')
  expect(plantGeometry.borderRadius).not.toBe('0px')
  expect(plantGeometry.leftDifference).toBeLessThanOrEqual(1)
  expect(plantGeometry.rightDifference).toBeLessThanOrEqual(1)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r32-home-growth-sapling-review.png'), fullPage: true })
  }

  const materialRow = mainWindow.locator('.todo-row').filter({ hasText: '整理素材1H' })
  await materialRow.getByRole('button', { name: '完成整理素材1H' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')

  await plant.getByRole('button', { name: /点击植物/ }).click()
  await expect(plant).toHaveClass(/reacting/)

  const ratioBeforeWatering = await plant.getByRole('progressbar').getAttribute('aria-valuenow')
  await plant.getByRole('button', { name: '给植物浇水' }).click()
  await expect(plant).toHaveClass(/watering/)
  await mainWindow.waitForTimeout(120)
  await plant.getByRole('button', { name: '给植物浇水' }).click({ force: true })
  await expect(plant).toHaveClass(/watering/)
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', ratioBeforeWatering ?? '33')
  await mainWindow.waitForTimeout(850)
  const waterDrops = plant.locator('.daily-growth-water-stream')
  await expect(waterDrops).not.toHaveCSS('opacity', '0')
  await expect.poll(() => waterDrops.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const scene = element.parentElement!.getBoundingClientRect()
    return {
      tall: rect.height > rect.width * 2,
      centered: Math.abs((rect.left + rect.width / 2) - (scene.left + scene.width / 2)) <= 1
    }
  })).toEqual({ tall: true, centered: true })
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r33-home-watering-review.png'), fullPage: true })
  }
  await expect(plant).not.toHaveClass(/watering/, { timeout: 3_000 })

  await mainWindow.evaluate(() => {
    const doc = (globalThis as unknown as {
      document: { defaultView: { Event: new(type: string) => unknown }; dispatchEvent(event: unknown): boolean }
    }).document
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'hidden' })
    doc.dispatchEvent(new doc.defaultView.Event('visibilitychange'))
  })
  await expect(plant).toHaveClass(/motion-paused/)
  await mainWindow.evaluate(() => {
    const doc = (globalThis as unknown as {
      document: { defaultView: { Event: new(type: string) => unknown }; dispatchEvent(event: unknown): boolean }
    }).document
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'visible' })
    doc.dispatchEvent(new doc.defaultView.Event('visibilitychange'))
  })
  await expect(plant).not.toHaveClass(/motion-paused/)
  await mainWindow.emulateMedia({ reducedMotion: 'reduce' })
  await expect(plant.locator('.daily-growth-stack')).toHaveCSS('animation-name', 'none')
  await mainWindow.emulateMedia({ reducedMotion: 'no-preference' })

  const writingRow = mainWindow.locator('.todo-row').filter({ hasText: '写稿2小时' })
  await writingRow.getByRole('button', { name: '完成写稿2小时' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '38')
  await expect(plant).not.toHaveClass(/celebrating/)
  const lifeRow = mainWindow.locator('.todo-row').filter({ hasText: '买洗衣液' })
  await lifeRow.getByRole('button', { name: '完成买洗衣液' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '63')
  const healthRow = mainWindow.locator('.todo-row').filter({ hasText: '跑步30分钟' })
  await healthRow.getByRole('button', { name: '完成跑步30分钟' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await expect(plant).toHaveClass(/celebrating/)
  await writingRow.getByRole('button', { name: '重新打开写稿2小时' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '88')
  await expect(plant).not.toHaveClass(/celebrating/)
  await expect(plant.locator('.frame-3')).toHaveCSS('opacity', '1')

  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.waitForTimeout(300)
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r32-home-growth-review.png'), fullPage: true })
    await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r32-home-growth-dark-review.png'), fullPage: true })
    await mainWindow.getByRole('button', { name: '切换到浅色模式' }).click()
  }
  await mainWindow.setViewportSize({ width: 880, height: 720 })
  await expect(plant).toBeHidden()
})

test('首页只有生活待办时会按生活自身完成度实时填满进度', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    await api.createTodoBatch([{
      title: '整理房间1小时',
      plannedDate: workspace.today,
      segment: 'morning',
      category: 'life',
      projectId: null,
      trackingMode: 'progress',
      progress: 50
    }])
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')

  const plant = mainWindow.getByLabel('今日待办成长植物')
  const row = mainWindow.locator('.todo-row').filter({ hasText: '整理房间1小时' })
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  await row.getByRole('button', { name: '完成整理房间1小时' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await row.getByRole('button', { name: '重新打开整理房间1小时' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
})

test('首页植物随待办改写和删除实时重新计算', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    const created = await api.createTodoBatch([
      { title: '写稿1小时', plannedDate: workspace.today, segment: 'morning', category: 'self_media', projectId: null, trackingMode: 'checklist', progress: 100 },
      { title: '剪辑1小时', plannedDate: workspace.today, segment: 'afternoon', category: 'self_media', projectId: null, trackingMode: 'checklist', progress: 0 },
      { title: '买生活用品', plannedDate: workspace.today, segment: 'evening', category: 'life', projectId: null, trackingMode: 'checklist', progress: 100 },
      { title: '健康打卡', plannedDate: workspace.today, segment: 'evening', category: 'other_work', projectId: null, trackingMode: 'checklist', progress: 100 }
    ])
    for (const todo of created.filter((item) => item.title !== '剪辑1小时')) await api.updateTodo(todo.id, { completed: true })
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')

  const plant = mainWindow.getByLabel('今日待办成长植物')
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '81')
  const editingRow = mainWindow.locator('.todo-row').filter({ hasText: '剪辑1小时' })
  await editingRow.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '编辑待办' }).click()
  const editDialog = mainWindow.locator('.todo-context-popover.edit')
  await editDialog.locator('input').first().fill('剪辑3小时')
  await editDialog.getByRole('button', { name: '保存' }).click()
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '72')

  const rewrittenRow = mainWindow.locator('.todo-row').filter({ hasText: '剪辑3小时' })
  await rewrittenRow.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '删除待办' }).click()
  await expect(rewrittenRow).toHaveCount(0)
  await expect(plant.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
})

test('R20今日投入只在首页底部展示总数并通过记录浮层维护分类', async () => {
  const workLog = mainWindow.locator('.todo-work-log')
  await expect(workLog).toContainText('今日投入')
  await expect(workLog).toContainText('0小时')
  await workLog.getByRole('button', { name: /记录/ }).click()
  const popover = mainWindow.getByRole('dialog', { name: '记录今日投入' })
  await popover.getByRole('button', { name: '按分类记录' }).click()
  await popover.getByLabel('自媒体').fill('4')
  await popover.getByLabel('AI').fill('1.5')
  await popover.getByLabel('健康').fill('0.5')
  await popover.getByRole('button', { name: '保存' }).click()
  await expect(workLog).toContainText('6小时')
  await expect(workLog).not.toContainText('自媒体 4')
  await expect.poll(() => workLog.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { borderTopWidth: string } }).getComputedStyle(element).borderTopWidth)).toBe('0px')
})

test('排期不再生成每日待办，手动待办可在时间和分类之间拖动', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    await api.createSchedule({
      projectId: 'ios',
      title: '仅保留在排期',
      actionType: 'production',
      startAt: `${workspace.today}T14:00:00+08:00`,
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    await api.createTodoBatch([{
      title: '可拖动的独立待办',
      plannedDate: workspace.today,
      segment: null,
      category: 'self_media',
      projectId: 'ios',
      trackingMode: 'checklist',
      progress: 0
    }, {
      title: '生活分类占位',
      plannedDate: workspace.today,
      segment: null,
      category: 'life',
      projectId: null,
      trackingMode: 'checklist',
      progress: 0
    }])
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')

  const todoWorkspace = mainWindow.locator('.todo-workspace')
  await expect(todoWorkspace).toContainText('可拖动的独立待办')
  await expect(todoWorkspace).not.toContainText('仅保留在排期')
  const todoRow = todoWorkspace.locator('.todo-row').filter({ hasText: '可拖动的独立待办' })
  const afternoonGroup = todoWorkspace.locator('.todo-group').filter({ has: mainWindow.getByRole('heading', { name: '下午', exact: true }) })
  const dataTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await todoRow.dispatchEvent('dragstart', { dataTransfer })
  await expect(afternoonGroup).toBeVisible()
  await afternoonGroup.dispatchEvent('dragenter', { dataTransfer })
  await afternoonGroup.dispatchEvent('dragover', { dataTransfer })
  await afternoonGroup.dispatchEvent('drop', { dataTransfer })
  await expect.poll(() => mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).todos.find((item) => item.title === '可拖动的独立待办')?.segment
  })).toBe('afternoon')

  await todoWorkspace.getByRole('button', { name: '按分类' }).click()
  const lifeGroup = todoWorkspace.locator('.todo-group').filter({ has: mainWindow.getByRole('heading', { name: '生活', exact: true }) })
  await todoWorkspace.locator('.todo-row').filter({ hasText: '可拖动的独立待办' }).dragTo(lifeGroup)
  await expect.poll(() => mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).todos.find((item) => item.title === '可拖动的独立待办')?.category
  })).toBe('life')
})

test('首页待办隐藏空分组并按各组内容自适应高度', async () => {
  const fixture = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    const [year, month, day] = workspace.today.split('-').map(Number)
    const productionDates = new Set(workspace.productionChecklist.filter((item) => !item.completed).map((item) => item.scheduleDate))
    let offset = 1
    let date = ''
    do {
      date = new Date(Date.UTC(year!, month! - 1, day! + offset)).toISOString().slice(0, 10)
      offset += 1
    } while (productionDates.has(date))
    offset -= 1
    await api.createTodoBatch([
      ...['整理素材', '校对文案', '导出清单'].map((title) => ({
        title,
        plannedDate: date,
        segment: 'morning' as const,
        category: 'self_media' as const,
        projectId: null,
        trackingMode: 'checklist' as const,
        progress: 0
      })),
      {
        title: '购买日用品',
        plannedDate: date,
        segment: 'afternoon' as const,
        category: 'life' as const,
        projectId: null,
        trackingMode: 'checklist' as const,
        progress: 0
      }
    ])
    return { date, offset }
  })

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  const workspace = mainWindow.locator('.todo-workspace')
  for (let index = 0; index < fixture.offset; index += 1) await workspace.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(workspace.getByRole('button', { name: new RegExp(fixture.date.slice(5, 7).replace(/^0/, '') + '月') })).toBeVisible()
  await expect(workspace.locator('.todo-group > header h3')).toHaveText(['上午', '下午'])
  await expect(workspace.getByRole('heading', { name: '晚上', exact: true })).toHaveCount(0)
  await expect(workspace.getByRole('heading', { name: '未分时段', exact: true })).toHaveCount(0)

  const morning = workspace.locator('.todo-group').nth(0)
  const afternoon = workspace.locator('.todo-group').nth(1)
  await expect.poll(async () => {
    const [morningBox, afternoonBox] = await Promise.all([morning.boundingBox(), afternoon.boundingBox()])
    return morningBox && afternoonBox ? morningBox.height > afternoonBox.height : null
  }).toBe(true)
})

test('待办可切换日期并把无明确日期的新计划默认放入所选日期', async () => {
  const workspace = mainWindow.locator('.todo-workspace')
  await expect(workspace.getByRole('button', { name: /选择待办日期，当前今天/ })).toBeVisible()
  await workspace.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(workspace.getByRole('button', { name: /选择待办日期，当前明天/ })).toBeVisible()

  await workspace.getByRole('button', { name: '新建', exact: true }).click()
  const composer = mainWindow.getByRole('dialog', { name: '批量新建待办' })
  await composer.getByRole('textbox').first().fill('整理明日素材')
  const selectedDate = await mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const [year, month, day] = workspace.today.split('-').map(Number)
    return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10)
  })
  await expect(composer.getByLabel('待办日期')).toHaveValue(selectedDate)
  await composer.getByRole('button', { name: '创建1条待办' }).click()
  await expect(workspace).toContainText('整理明日素材')

  await workspace.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(workspace).not.toContainText('整理明日素材')
  await workspace.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(workspace).toContainText('整理明日素材')

  await workspace.getByRole('button', { name: /选择待办日期，当前明天/ }).click()
  const picker = mainWindow.getByRole('dialog', { name: '选择待办日期' })
  const dayAfterTomorrow = await mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const [year, month, day] = workspace.today.split('-').map(Number)
    const date = new Date(Date.UTC(year!, month! - 1, day! + 2))
    return {
      key: date.toISOString().slice(0, 10),
      label: `选择${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
    }
  })
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/r26-todo-date-review.png'), fullPage: true })
  await picker.getByRole('gridcell', { name: dayAfterTomorrow.label }).click()
  await expect(workspace.getByRole('button', { name: new RegExp(dayAfterTomorrow.key.slice(5, 7).replace(/^0/, '') + '月') })).toBeVisible()
})

test('有日期待办即使今天勾选也只保留在原计划日期', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    const [year, month, day] = workspace.today.split('-').map(Number)
    const yesterday = new Date(Date.UTC(year!, month! - 1, day! - 1)).toISOString().slice(0, 10)
    await api.createTodoBatch([
      {
        title: '只属于昨天的未完成任务',
        plannedDate: yesterday,
        segment: null,
        category: 'self_media',
        projectId: null,
        trackingMode: 'checklist',
        progress: 0
      },
      {
        title: '只属于今天的任务',
        plannedDate: workspace.today,
        segment: null,
        category: 'self_media',
        projectId: null,
        trackingMode: 'checklist',
        progress: 0
      }
    ])
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')

  const workspace = mainWindow.locator('.todo-workspace')
  await expect(workspace).toContainText('只属于今天的任务')
  await expect(workspace).not.toContainText('只属于昨天的未完成任务')
  await workspace.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(workspace).toContainText('只属于昨天的未完成任务')
  await expect(workspace).not.toContainText('只属于今天的任务')
  const yesterdayRow = workspace.locator('.todo-row').filter({ hasText: '只属于昨天的未完成任务' })
  await yesterdayRow.getByRole('button', { name: '完成只属于昨天的未完成任务' }).click()
  await expect(yesterdayRow).toHaveClass(/completed/)
  await workspace.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(workspace).toContainText('只属于今天的任务')
  await expect(workspace).not.toContainText('只属于昨天的未完成任务')
})

test('R21菜单栏与桌面待办窗口支持批量创建、勾选、右键编辑和窗口入口', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/todo-widget' })
  await expect(mainWindow).toHaveTitle('今日待办')
  const companion = mainWindow.locator('.todo-companion.widget')
  await expect(companion).toBeVisible()
  await expect(companion.getByRole('button', { name: '打开主窗口' })).toBeVisible()
  await expect(companion.getByRole('button', { name: '关闭待办窗口' })).toBeVisible()
  await expect(companion.getByRole('button', { name: /选择待办日期，当前今天/ })).toBeVisible()
  await expect(companion.getByRole('textbox', { name: '批量新建待办' })).toHaveCount(0)
  await companion.getByRole('button', { name: '展开新建待办' }).click()
  await companion.getByRole('textbox', { name: '批量新建待办' }).fill('今天上午整理素材，晚上买牛奶')
  await expect(companion.getByRole('button', { name: '创建2条' })).toBeEnabled()
  await companion.getByRole('button', { name: '创建2条' }).click()
  await expect(companion.locator('.todo-companion-list article')).toHaveCount(2)
  await expect(companion.locator('.todo-companion-group > header')).toHaveText(['上午1', '晚上1'])
  await companion.getByRole('button', { name: '按分类' }).click()
  await expect(companion.locator('.todo-companion-group > header')).toHaveText(['自媒体1', '生活1'])
  await companion.getByRole('button', { name: '按时间' }).click()
  const milkRow = companion.locator('.todo-companion-list article').filter({ hasText: '买牛奶' })
  await milkRow.click({ button: 'right' })
  await expect(mainWindow.getByRole('menuitem', { name: '编辑待办' })).toBeVisible()
  await expect(mainWindow.getByRole('menuitem', { name: '记录进度' })).toBeVisible()
  await expect(mainWindow.getByRole('menuitem', { name: '删除待办' })).toBeVisible()
  await mainWindow.getByRole('menuitem', { name: '编辑待办' }).click()
  const edit = mainWindow.locator('.todo-context-popover.edit')
  await edit.locator('input').first().fill('买牛奶和咖啡')
  await edit.getByLabel('编辑待办分类').selectOption('self_media')
  await edit.getByRole('button', { name: '保存' }).click()
  const editedRow = companion.locator('.todo-companion-list article').filter({ hasText: '买牛奶和咖啡' })
  await expect(editedRow).toContainText('自媒体')
  await editedRow.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '记录进度' }).click()
  const progressDialog = mainWindow.getByRole('dialog', { name: /买牛奶和咖啡的待办操作/ })
  await progressDialog.getByRole('button', { name: '50%' }).click()
  await expect(editedRow.locator('.todo-check')).toHaveClass(/partial/)
  await progressDialog.getByRole('button', { name: '完成', exact: true }).click()
  await companion.getByRole('button', { name: '完成整理素材' }).click()
  await expect(companion.locator('.todo-companion-list article').filter({ hasText: '整理素材' })).toHaveClass(/completed/)
  await companion.getByRole('button', { name: '收起新建待办' }).click()
  await expect(companion.getByRole('textbox', { name: '批量新建待办' })).toHaveCount(0)
  await expect.poll(() => companion.locator('.todo-companion-list article').first().evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(30)
  await expect.poll(() => companion.locator('.todo-companion-titlebar').evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { getPropertyValue(name: string): string } }).getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('drag')
})

test('回收站项目不参与伴随窗待办识别，同名事项保持未关联', async () => {
  const projectTitle = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = (await api.getWorkspace()).projects.find((item) => item.id === 'ios')!
    await api.trashProject(project.id)
    return project.title
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/todo-widget' })
  const companion = mainWindow.locator('.todo-companion.widget')
  await companion.getByRole('button', { name: '展开新建待办' }).click()
  const title = `${projectTitle}报销路费`
  await companion.getByRole('textbox', { name: '批量新建待办' }).fill(title)
  await companion.getByRole('button', { name: '创建1条' }).click()
  await expect(companion.getByRole('alert')).toHaveCount(0)
  await expect(companion).toContainText(title)
  await expect.poll(() => mainWindow.evaluate(async (todoTitle) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).todos.find((item) => item.title === todoTitle)?.projectId
  }, title)).toBeNull()
})

test('菜单栏与桌面待办窗口可提前规划其他日期', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/todo-widget' })
  const companion = mainWindow.locator('.todo-companion.widget')
  await companion.getByRole('button', { name: '查看后一天待办' }).click()
  await expect(companion.getByText(/明天·.*0项未完成/)).toBeVisible()
  await companion.getByRole('button', { name: '展开新建待办' }).click()
  await companion.getByRole('textbox', { name: '批量新建待办' }).fill('规划明日拍摄')
  await companion.getByRole('button', { name: '创建1条' }).click()
  await expect(companion).toContainText('规划明日拍摄')
  await companion.getByRole('button', { name: '查看前一天待办' }).click()
  await expect(companion).not.toContainText('规划明日拍摄')
})
