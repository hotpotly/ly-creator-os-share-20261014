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

async function setRoute(hash: string): Promise<void> {
  await mainWindow.evaluate((nextHash) => { (globalThis as unknown as BrowserGlobals).location.hash = nextHash }, hash)
}

async function projectColor(projectId: string): Promise<string | undefined> {
  return mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.find((project) => project.id === id)?.colorToken, projectId)
}

test('R5b项目色支持排期右键、排期详情和项目概览三处修改，并同步整个工作区', async () => {
  await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.setProjectColor('ios', 'project-1'))
  await setRoute('#/schedule')

  const iosPills = mainWindow.locator('.schedule-pill').filter({ hasText: 'iOS 27' })
  await expect(iosPills.first()).toBeVisible()
  await iosPills.first().click({ button: 'right' })
  const contextMenu = mainWindow.getByRole('menu', { name: /iOS 27.*的排期操作/ })
  await contextMenu.getByRole('menuitem', { name: '更换项目色' }).click()
  const contextPicker = mainWindow.getByRole('group', { name: /更改iOS 27.*项目色/ })
  await expect(contextPicker.getByRole('button', { name: '颜色1', exact: true })).toBeFocused()
  await contextPicker.getByRole('button', { name: '颜色12', exact: true }).click()
  await expect.poll(() => projectColor('ios')).toBe('project-12')
  await expect(iosPills.first()).toBeFocused()
  await expect.poll(() => iosPills.first().evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string } }).getComputedStyle(element).backgroundColor)).toMatch(/^(rgb\(227, 233, 238\)|color\(srgb 0\.931922 0\.94651 0\.958667\))$/)

  await iosPills.first().click()
  const detailPicker = mainWindow.getByRole('group', { name: '更改排期项目色' })
  await detailPicker.getByRole('button', { name: '颜色10', exact: true }).click()
  await expect.poll(() => projectColor('ios')).toBe('project-10')
  await expect.poll(() => iosPills.first().evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string } }).getComputedStyle(element).backgroundColor)).toMatch(/^(rgb\(246, 222, 217\)|color\(srgb 0\.978118 0\.919765 0\.907608\))$/)

  await setRoute('#/project/ios/overview')
  await expect(mainWindow.getByRole('textbox', { name: '项目描述' })).toBeVisible()
  const overviewPicker = mainWindow.getByRole('group', { name: '更改项目色' })
  await overviewPicker.getByRole('button', { name: '颜色9', exact: true }).click()
  await expect.poll(() => projectColor('ios')).toBe('project-9')

  await setRoute('#/schedule')
  const updatedPills = mainWindow.locator('.schedule-pill').filter({ hasText: 'iOS 27' })
  await expect(updatedPills.first()).toBeVisible()
  await expect.poll(() => updatedPills.first().evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string } }).getComputedStyle(element).backgroundColor)).toMatch(/^(rgb\(216, 240, 242\)|color\(srgb 0\.905176 0\.963529 0\.968392\))$/)
})

test('R5b新建同一内容方向的项目仍由仓库依次分配不同未用颜色', async () => {
  const createProject = async (title: string): Promise<void> => {
    await mainWindow.locator('.topbar').getByRole('button', { name: '新建项目', exact: true }).click()
    const dialog = mainWindow.getByRole('dialog', { name: '新建项目' })
    await dialog.getByLabel('项目名称').fill(title)
    await dialog.getByRole('group', { name: '内容方向' }).getByRole('button', { name: '数码', exact: true }).click()
    await dialog.getByRole('button', { name: '创建项目' }).click()
    await expect(dialog).toBeHidden()
  }

  await createProject('R5b同方向颜色一')
  await createProject('R5b同方向颜色二')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const projects = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects
    return ['R5b同方向颜色一', 'R5b同方向颜色二'].map((title) => projects.find((project) => project.title === title)?.colorToken)
  })).not.toEqual([undefined, undefined])
  const colors = await mainWindow.evaluate(async () => {
    const projects = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects
    return ['R5b同方向颜色一', 'R5b同方向颜色二'].map((title) => projects.find((project) => project.title === title)?.colorToken)
  })
  expect(colors[0]).toBeTruthy()
  expect(colors[1]).toBeTruthy()
  expect(colors[0]).not.toBe(colors[1])
})

test('R5b排期双侧面板可折叠、记忆宽度，并在窄窗口用抽屉显示详情', async () => {
  await setRoute('#/schedule')
  await mainWindow.getByRole('button', { name: '折叠未排期' }).click()
  await mainWindow.getByRole('button', { name: '折叠排期详情' }).click()
  await expect(mainWindow.getByRole('button', { name: /展开未排期/ })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '展开排期详情' })).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const preferences = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences
    return [preferences.scheduleUnscheduledCollapsed, preferences.scheduleInspectorCollapsed]
  })).toEqual([true, true])

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.getByRole('button', { name: /展开未排期/ })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '展开排期详情' })).toBeVisible()

  await mainWindow.getByRole('button', { name: /展开未排期/ }).click()
  await mainWindow.getByRole('button', { name: '展开排期详情' }).click()
  const leftDivider = mainWindow.getByRole('separator', { name: '调整未排期宽度' })
  const rightDivider = mainWindow.getByRole('separator', { name: '调整右侧详情宽度' })
  const before = await mainWindow.evaluate(async () => {
    const preferences = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences
    return { left: preferences.scheduleUnscheduledWidth, right: preferences.inspectorWidth }
  })
  await leftDivider.focus()
  await mainWindow.keyboard.press('ArrowRight')
  await rightDivider.focus()
  await mainWindow.keyboard.press('ArrowLeft')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const preferences = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences
    return { left: preferences.scheduleUnscheduledWidth, right: preferences.inspectorWidth }
  })).toEqual({ left: before.left + 16, right: before.right + 16 })

  await mainWindow.getByRole('button', { name: '折叠排期详情' }).click()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(880, 720))
  const pill = mainWindow.locator('.schedule-pill').first()
  await pill.click()
  const drawer = mainWindow.getByRole('dialog', { name: '排期详情' })
  await expect(drawer).toHaveClass(/drawer-open/)
  await expect(drawer.getByRole('button', { name: '关闭右侧详情' })).toBeVisible()
})
