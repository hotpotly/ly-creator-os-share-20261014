import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow).toHaveTitle('LY Creator OS')
})

test.afterEach(async () => {
  await electronApp.close()
})

test('收入台账与资源同级，并可在更多中独立展开商单和其他收入', async () => {
  const sidebar = mainWindow.locator('.sidebar')
  const workspace = sidebar.getByRole('region', { name: '工作区', exact: true })
  const creation = sidebar.getByRole('region', { name: '创作', exact: true })
  const more = sidebar.getByRole('region', { name: '更多', exact: true })
  const income = more.getByRole('group', { name: '收入台账', exact: true })

  await expect(workspace.getByRole('button')).toHaveText(['工作区', '首页', '灵感库', '选题管理', '内容项目', '排期'])
  await expect(creation.getByRole('button')).toHaveText(['创作', '创作工具'])
  await expect(income.getByRole('button', { name: '收入台账', exact: true })).toBeVisible()
  await expect(income.getByRole('button', { name: '收起收入台账' })).toBeVisible()
  await expect(income.getByRole('button', { name: '商单收入' })).toBeVisible()
  await expect(income.getByRole('button', { name: '其他收入' })).toBeVisible()
  await expect(sidebar.getByRole('region', { name: '收入台账', exact: true })).toHaveCount(0)
  const resourceBox = await more.getByRole('button', { name: '资源', exact: true }).boundingBox()
  const incomeBox = await income.getByRole('button', { name: '收入台账', exact: true }).boundingBox()
  expect(resourceBox).not.toBeNull()
  expect(incomeBox).not.toBeNull()
  expect(Math.abs((resourceBox?.x ?? 0) - (incomeBox?.x ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((resourceBox?.height ?? 0) - (incomeBox?.height ?? 0))).toBeLessThanOrEqual(1)
  await expect(sidebar.getByRole('button', { name: '最近项目' })).toHaveCount(0)
  await expect(sidebar.locator('.nav-item small, .sidebar-section-title small, .shortcut-meta')).toHaveCount(0)
  await expect(sidebar.locator('.sidebar-footer').getByRole('button', { name: '设置' })).toBeVisible()

  const incomeToggle = income.getByRole('button', { name: '收起收入台账' })
  await expect(incomeToggle).toHaveAttribute('aria-expanded', 'true')
  await incomeToggle.click()
  await expect(income.getByRole('button', { name: '商单收入' })).toHaveCount(0)
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '更多', exact: true }).getByRole('group', { name: '收入台账', exact: true }).getByRole('button', { name: '展开收入台账' })).toHaveAttribute('aria-expanded', 'false')
})

test('首页移除自动化状态，运行任务只保留全局条件入口，暗色空日透明', async () => {
  await expect(mainWindow.getByRole('heading', { name: '自动化状态' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: /运行任务，\d+项/ })).toBeVisible()
  await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
  const empty = mainWindow.locator('.week-empty').first()
  await expect.poll(() => empty.evaluate((element) => {
    const style = (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string; borderTopWidth: string; boxShadow: string } }).getComputedStyle(element)
    return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow }
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' })
})

test('只有已完成或已取消任务时隐藏运行任务入口', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const database = new DatabaseSync(join(testInfo.outputPath('user-data'), 'creator-os.sqlite3'))
  database.exec(`UPDATE task_runs SET status=CASE WHEN id='task-cover-done' THEN 'succeeded' ELSE 'canceled' END`)
  database.close()
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('button', { name: /运行任务/ })).toHaveCount(0)
})

test('常用独立于内容项目导航，支持项目拖入、排序、取消和折叠记忆', async () => {
  const contentProjects = mainWindow.getByRole('button', { name: '内容项目', exact: true })
  await expect(contentProjects).not.toHaveAttribute('aria-expanded')
  await contentProjects.click()

  const pinnedRegion = mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' })
  const source = mainWindow.locator('.project-table').getByRole('button', { name: /随身SSD横评/ }).first()
  const transfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer: transfer })
  await pinnedRegion.dispatchEvent('dragover', { dataTransfer: transfer })
  await pinnedRegion.dispatchEvent('drop', { dataTransfer: transfer })
  await source.dispatchEvent('dragend', { dataTransfer: transfer })

  await expect(pinnedRegion.getByRole('button', { name: /随身SSD横评/ })).toBeVisible()
  await expect(pinnedRegion.getByRole('button', { name: 'AI浏览器入门教学' })).toHaveAttribute('title', /进度\d+%.*最近打开/)
  await expect.poll(() => mainWindow.evaluate(async () => {
    const snapshot = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    return {
      pinned: snapshot.projects.find((project) => project.id === 'ssd')?.isPinned,
      order: snapshot.preferences.pinnedProjectOrder
    }
  })).toMatchObject({ pinned: true, order: expect.arrayContaining(['ssd']) })

  const ssd = pinnedRegion.getByRole('button', { name: /随身SSD横评/ })
  const ios = pinnedRegion.getByRole('button', { name: /iOS 27第一周体验/ })
  const reorderTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await ssd.dispatchEvent('dragstart', { dataTransfer: reorderTransfer })
  await ios.dispatchEvent('dragover', { dataTransfer: reorderTransfer })
  await ios.dispatchEvent('drop', { dataTransfer: reorderTransfer })
  await ssd.dispatchEvent('dragend', { dataTransfer: reorderTransfer })
  await expect.poll(() => pinnedRegion.locator('.shortcut-name').allTextContents()).toEqual([
    '随身SSD横评',
    'iOS 27第一周体验',
    'AI浏览器入门教学'
  ])

  await ssd.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '移出常用' }).click()
  await expect(pinnedRegion.getByRole('button', { name: /随身SSD横评/ })).toHaveCount(0)
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.find((project) => project.id === 'ssd')?.isPinned)).toBe(false)

  const toggle = mainWindow.getByRole('button', { name: '常用' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  const collapsedToggle = mainWindow.getByRole('button', { name: '常用' })
  await expect(collapsedToggle).toHaveAttribute('aria-expanded', 'false')

  const existingPinnedSource = mainWindow.locator('.project-table').getByRole('button', { name: /iOS 27第一周体验/ }).first()
  const collapsedRegion = mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' })
  const orderBeforeDuplicateDrop = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.pinnedProjectOrder)
  const expandTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await existingPinnedSource.dispatchEvent('dragstart', { dataTransfer: expandTransfer })
  await collapsedRegion.dispatchEvent('dragenter', { dataTransfer: expandTransfer })
  await expect(collapsedToggle).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 })
  await collapsedRegion.dispatchEvent('drop', { dataTransfer: expandTransfer })
  await existingPinnedSource.dispatchEvent('dragend', { dataTransfer: expandTransfer })
  await expect(mainWindow.getByRole('status')).toContainText('已在常用中')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const order = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.pinnedProjectOrder
    return { order, duplicateCount: order.filter((id) => id === 'ios').length }
  })).toEqual({ order: orderBeforeDuplicateDrop, duplicateCount: 1 })
})

test('项目阶段可拖入常用，支持精确打开、排序、移除和共享折叠记忆', async () => {
  await mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' }).getByRole('button', { name: 'AI浏览器入门教学', exact: true }).click()
  const projectStages = mainWindow.getByRole('navigation', { name: '项目阶段' })
  const stageRegion = mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' })
  const dragStage = async (name: string): Promise<void> => {
    const source = projectStages.getByRole('button', { name, exact: true })
    const transfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
    await source.dispatchEvent('dragstart', { dataTransfer: transfer })
    await stageRegion.dispatchEvent('dragover', { dataTransfer: transfer })
    await stageRegion.dispatchEvent('drop', { dataTransfer: transfer })
    await source.dispatchEvent('dragend', { dataTransfer: transfer })
  }

  const scriptTab = projectStages.getByRole('button', { name: '文案', exact: true })
  const scriptBox = await scriptTab.boundingBox()
  const sidebarBox = await mainWindow.locator('.sidebar').boundingBox()
  expect(scriptBox).not.toBeNull()
  expect(sidebarBox).not.toBeNull()
  await mainWindow.mouse.move((scriptBox?.x ?? 0) + (scriptBox?.width ?? 0) / 2, (scriptBox?.y ?? 0) + (scriptBox?.height ?? 0) / 2)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move((scriptBox?.x ?? 0) - 30, (scriptBox?.y ?? 0) + (scriptBox?.height ?? 0) / 2, { steps: 4 })
  await mainWindow.mouse.move((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0) / 2, (sidebarBox?.y ?? 0) + 180, { steps: 12 })
  await expect(mainWindow.locator('.stage-shortcut-sidebar-drop')).toBeVisible()
  await mainWindow.mouse.up()

  const scriptShortcut = stageRegion.getByRole('button', { name: 'AI浏览器入门教学 · 文案' })
  await expect(scriptShortcut).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.pinnedProjectStages)).toEqual([
    { projectId: 'ai-browser', moduleKey: 'script' }
  ])

  await dragStage('文案')
  await expect(mainWindow.getByRole('status')).toContainText('已在常用中')
  await expect(stageRegion.getByRole('button', { name: 'AI浏览器入门教学 · 文案' })).toHaveCount(1)

  await dragStage('资料')
  const materialsShortcut = stageRegion.getByRole('button', { name: 'AI浏览器入门教学 · 资料' })
  const reorderTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await materialsShortcut.dispatchEvent('dragstart', { dataTransfer: reorderTransfer })
  await scriptShortcut.dispatchEvent('dragover', { dataTransfer: reorderTransfer })
  await scriptShortcut.dispatchEvent('drop', { dataTransfer: reorderTransfer })
  await materialsShortcut.dispatchEvent('dragend', { dataTransfer: reorderTransfer })
  await expect.poll(() => stageRegion.locator('.stage-shortcut .shortcut-name').allTextContents()).toEqual([
    'AI浏览器入门教学 · 资料',
    'AI浏览器入门教学 · 文案'
  ])

  await projectStages.getByRole('button', { name: '资料', exact: true }).click()
  await scriptShortcut.click()
  await expect(projectStages.getByRole('button', { name: '文案', exact: true })).toHaveAttribute('aria-current', 'page')

  await scriptShortcut.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '移出常用' }).click()
  await expect(stageRegion.getByRole('button', { name: 'AI浏览器入门教学 · 文案' })).toHaveCount(0)

  const toggle = mainWindow.getByRole('button', { name: '常用' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('button', { name: '常用' })).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.pinnedProjectStages)).toEqual([
    { projectId: 'ai-browser', moduleKey: 'materials' }
  ])
  await mainWindow.getByRole('button', { name: '常用' }).click()
})

test('相同工作区起点不会建立重复标签，项目切换仍复用当前标签', async () => {
  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  await expect(mainWindow.getByRole('tab')).toHaveCount(1)
  await mainWindow.getByRole('button', { name: '新建工作区标签' }).click()
  await mainWindow.getByRole('menuitem', { name: '内容项目' }).click()
  await expect(mainWindow.getByRole('tab')).toHaveCount(1)

  await mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' }).getByRole('button', { name: /AI浏览器入门教学/ }).first().click()
  await expect(mainWindow.getByRole('tab', { name: 'AI浏览器入门教学' })).toHaveCount(1)
  await expect(mainWindow.getByRole('tab')).toHaveCount(1)
})

test('工作区管理支持跨组、隐藏、自定义分组、删除迁移和恢复默认，不影响顶部新标签菜单', async () => {
  await mainWindow.getByRole('button', { name: '设置', exact: true }).click()
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '工作区' }).click()
  const manager = mainWindow.getByRole('region', { name: '工作区管理' })
  const creationGroup = manager.getByRole('article', { name: '创作分组' })
  const moreGroup = manager.getByRole('article', { name: '更多分组' })
  const resourceItem = moreGroup.locator('.workspace-management-item').filter({ hasText: '资源' })
  const transfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await resourceItem.dispatchEvent('dragstart', { dataTransfer: transfer })
  await creationGroup.locator('.workspace-management-items').dispatchEvent('dragover', { dataTransfer: transfer })
  await creationGroup.locator('.workspace-management-items').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '创作', exact: true }).getByRole('button', { name: '资源' })).toBeVisible()

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '工作区' }).click()
  const reloadedManager = mainWindow.getByRole('region', { name: '工作区管理' })
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '创作', exact: true }).getByRole('button', { name: '资源' })).toBeVisible()
  await reloadedManager.getByRole('button', { name: '隐藏资源' }).click()
  await expect(mainWindow.locator('.sidebar').getByRole('button', { name: '资源' })).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '新建工作区标签' }).click()
  await expect(mainWindow.getByRole('menuitem', { name: '资源' })).toBeVisible()
  await mainWindow.keyboard.press('Escape')

  await reloadedManager.getByLabel('新分组名称').fill('常用工具')
  await reloadedManager.getByRole('button', { name: '新建分组' }).click()
  const customGroup = reloadedManager.getByRole('article', { name: '常用工具分组' })
  await expect(customGroup).toBeVisible()
  await customGroup.getByLabel('重命名常用工具分组').fill('发布工具')
  await customGroup.getByLabel('重命名常用工具分组').press('Tab')
  await expect(reloadedManager.getByRole('article', { name: '发布工具分组' })).toBeVisible()

  const movedResource = reloadedManager.locator('.workspace-management-item').filter({ hasText: '资源' })
  const itemTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await movedResource.dispatchEvent('dragstart', { dataTransfer: itemTransfer })
  await reloadedManager.getByRole('article', { name: '发布工具分组' }).locator('.workspace-management-items').dispatchEvent('drop', { dataTransfer: itemTransfer })
  await reloadedManager.getByRole('button', { name: '显示资源' }).click()
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '发布工具', exact: true }).getByRole('button', { name: '资源' })).toBeVisible()

  const renamedCustom = reloadedManager.getByRole('article', { name: '发布工具分组' })
  await renamedCustom.getByRole('combobox').selectOption('more')
  const deleteCustomGroup = reloadedManager.getByRole('article', { name: '发布工具分组' }).locator('button.danger')
  await expect(deleteCustomGroup).toBeEnabled()
  await deleteCustomGroup.click()
  await expect(reloadedManager.getByRole('article', { name: '发布工具分组' })).toHaveCount(0)
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '更多', exact: true }).getByRole('button', { name: '资源' })).toBeVisible()

  await reloadedManager.getByRole('button', { name: '恢复默认' }).click()
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '工作区', exact: true }).getByRole('button', { name: '首页' })).toBeVisible()
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '创作', exact: true }).getByRole('button', { name: '创作工具' })).toBeVisible()
  await expect(mainWindow.locator('.sidebar').getByRole('region', { name: '更多', exact: true }).getByRole('button', { name: '资源' })).toBeVisible()
})
