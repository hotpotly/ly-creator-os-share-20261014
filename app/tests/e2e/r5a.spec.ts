import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
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
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.length)).toBeGreaterThan(5)
})

test.afterEach(async () => {
  await electronApp.close()
})

test('R5a选题阶段与条件收进浮层，列宽热区可见，右键可移入回收站', async () => {
  const fixture = await mainWindow.evaluate(async () => {
    const snapshot = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const stage = snapshot.topicStages.find((item) => item.role === 'project_created')!
    const stageTopics = snapshot.topics.filter((topic) => !topic.trashedAt && topic.stageId === stage.id)
    const uncreated = snapshot.topics.find((topic) => !topic.trashedAt && !topic.createdProjectId)!
    const created = stageTopics.find((topic) => topic.createdProjectId)!
    return {
      stageName: stage.name,
      stageCount: stageTopics.length,
      starredCount: stageTopics.filter((topic) => topic.importanceLevel > 0).length,
      createdTitle: created.title,
      createdProjectId: created.createdProjectId!,
      uncreatedTitle: uncreated.title
    }
  })

  await mainWindow.getByRole('button', { name: '选题管理' }).click()

  const separator = mainWindow.getByRole('separator', { name: /拖拽调整选题名称列宽/ })
  const separatorBox = await separator.boundingBox()
  expect(separatorBox?.width).toBeGreaterThanOrEqual(10)
  await separator.hover()
  await expect.poll(() => separator.evaluate((element) => {
    const browser = globalThis as unknown as { getComputedStyle(node: unknown, pseudo?: string): { backgroundColor: string } }
    return browser.getComputedStyle(element, '::after').backgroundColor
  })).not.toBe('rgba(0, 0, 0, 0)')

  const titleHeader = mainWindow.getByRole('columnheader', { name: '选题名称' })
  const widthBefore = (await titleHeader.boundingBox())!.width
  await mainWindow.mouse.move(separatorBox!.x + separatorBox!.width / 2, separatorBox!.y + separatorBox!.height / 2)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(separatorBox!.x + separatorBox!.width / 2 + 36, separatorBox!.y + separatorBox!.height / 2)
  await mainWindow.mouse.up()
  await expect.poll(async () => (await titleHeader.boundingBox())!.width).toBeGreaterThan(widthBefore + 20)

  await mainWindow.locator('.topic-stage-filter-trigger').click()
  const stageMenu = mainWindow.getByRole('menu', { name: '筛选选题阶段' })
  await expect(stageMenu).toBeVisible()
  const geometry = await stageMenu.evaluate((menu) => {
    const browser = globalThis as unknown as {
      document: { body: unknown }
      innerHeight: number
      innerWidth: number
    }
    const rect = menu.getBoundingClientRect()
    return {
      inViewport: rect.left >= 8 && rect.top >= 8 && rect.right <= browser.innerWidth - 8 && rect.bottom <= browser.innerHeight - 8,
      portaled: menu.parentElement === browser.document.body
    }
  })
  expect(geometry).toEqual({ inViewport: true, portaled: true })
  const stageItems = stageMenu.getByRole('menuitemradio')
  await expect(stageItems.first()).toBeFocused()
  await mainWindow.keyboard.press('ArrowDown')
  await expect(stageItems.nth(1)).toBeFocused()

  await mainWindow.getByRole('button', { name: '管理列' }).click()
  await expect(stageMenu).toBeHidden()
  await expect(mainWindow.getByRole('dialog', { name: '管理选题列' })).toBeVisible()
  await mainWindow.locator('.topic-filter-trigger').click()
  await expect(mainWindow.getByRole('dialog', { name: '管理选题列' })).toBeHidden()
  await expect(mainWindow.getByRole('dialog', { name: '筛选选题' })).toBeVisible()
  await mainWindow.locator('.topic-filter-trigger').click()

  await mainWindow.locator('.topic-stage-filter-trigger').click()
  await stageMenu.getByRole('menuitemradio', { name: new RegExp(`^${fixture.stageName}\\s+${fixture.stageCount}$`) }).click()
  await expect(mainWindow.locator('.topic-management-table tbody tr')).toHaveCount(fixture.stageCount)

  await mainWindow.locator('.topic-filter-trigger').click()
  const filter = mainWindow.getByRole('dialog', { name: '筛选选题' })
  await filter.getByRole('switch', { name: /已打星/ }).click()
  await expect(mainWindow.locator('.topic-management-table tbody tr')).toHaveCount(fixture.starredCount)
  await expect(mainWindow.locator('.topic-filter-trigger')).toContainText('筛选·1')
  await filter.getByRole('button', { name: '清空筛选' }).click()

  await mainWindow.locator('.topic-stage-filter-trigger').click()
  await mainWindow.getByRole('menu', { name: '筛选选题阶段' }).getByRole('menuitemradio', { name: /^全部\s+\d+$/ }).click()
  const createdRow = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: fixture.createdTitle })
  await createdRow.click({ button: 'right' })
  const createdMenu = mainWindow.getByRole('menu', { name: `${fixture.createdTitle}的操作` })
  await expect(createdMenu.getByRole('menuitem', { name: '打开项目' })).toBeVisible()
  await expect(createdMenu.getByRole('menuitem', { name: '编辑所有内容' })).toBeVisible()
  await createdMenu.getByRole('menuitem', { name: '移入回收站' }).click()
  await expect(createdRow).toHaveCount(0)
  await expect.poll(() => mainWindow.evaluate(async (projectId) => {
    const project = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.find((item) => item.id === projectId)
    return Boolean(project?.trashedAt)
  }, fixture.createdProjectId)).toBe(true)

  await mainWindow.getByRole('button', { name: '回收站' }).click()
  const recycledProject = mainWindow.locator('.recycle-item').filter({ hasText: fixture.createdTitle })
  await expect(recycledProject).toBeVisible()
  await recycledProject.getByRole('button', { name: '恢复' }).click()
  await expect(recycledProject).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  await expect(mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: fixture.createdTitle })).toBeVisible()

  const topicRow = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: fixture.uncreatedTitle })
  await topicRow.click({ button: 'right' })
  const contextMenu = mainWindow.getByRole('menu', { name: `${fixture.uncreatedTitle}的操作` })
  await expect(contextMenu.getByRole('menuitem', { name: '编辑所有内容' })).toBeVisible()
  await contextMenu.getByRole('menuitem', { name: '移入回收站' }).click()
  await expect(topicRow).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '回收站' }).click()
  await mainWindow.locator('.recycle-nav').getByRole('button', { name: '选题' }).click()
  const recycled = mainWindow.locator('.recycle-item').filter({ hasText: fixture.uncreatedTitle })
  await expect(recycled).toBeVisible()
  await recycled.getByRole('button', { name: '恢复' }).click()
  await expect(recycled).toHaveCount(0)
})

test('R5a排期视图顺序为月周日列表，同时保留既有默认视图', async () => {
  const homeViews = mainWindow.getByRole('group', { name: '排期视图' })
  await expect(homeViews.getByRole('button')).toHaveText(['月', '周'])
  await expect(homeViews.getByRole('button', { name: '周', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await mainWindow.getByRole('button', { name: '排期', exact: true }).click()
  const fullViews = mainWindow.getByRole('group', { name: '排期视图' })
  await expect(fullViews.getByRole('button')).toHaveText(['月', '周', '日', '列表'])
  await expect(fullViews.getByRole('button', { name: '月', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
