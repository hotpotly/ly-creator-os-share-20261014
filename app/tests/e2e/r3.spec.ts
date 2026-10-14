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
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.length)).toBeGreaterThan(5)
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

test('R3全局使用选题管理作为唯一正式名称', async () => {
  await expect(mainWindow.getByRole('button', { name: '选题管理', exact: true })).toBeVisible()
  await expect(mainWindow.getByText('选题规划', { exact: true })).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '选题管理', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '选题管理', exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('tab', { name: '选题管理', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('R3普通阶段可编辑下一步显示文案且真实动作仍按生命周期推进', async () => {
  const fixture = await mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const topic = workspace.topics.find((item) => !item.createdProjectId && item.nextActionKind === 'advance_stage')!
    const stage = workspace.topicStages.find((item) => item.id === topic.stageId)!
    return { topicId: topic.id, topicTitle: topic.title, stageId: stage.id, stageName: stage.name, nextStageId: topic.nextStageId! }
  })

  await mainWindow.getByRole('button', { name: '选题管理', exact: true }).click()
  await mainWindow.getByRole('button', { name: '管理阶段' }).click()
  const manager = mainWindow.getByRole('dialog', { name: '管理选题阶段' })
  await manager.getByRole('button', { name: `改名${fixture.stageName}` }).click()
  await manager.getByLabel(`编辑${fixture.stageName}下一步显示文案`).fill('补齐体验再进入制作')
  await manager.getByRole('button', { name: '保存' }).click()
  await expect(manager.getByText('下一步：补齐体验再进入制作')).toBeVisible()
  await manager.getByRole('button', { name: '关闭阶段管理' }).click()

  const topicRow = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: fixture.topicTitle })
  await expect(topicRow.getByRole('button', { name: '补齐体验再进入制作' })).toBeVisible()
  await topicRow.getByRole('button', { name: '补齐体验再进入制作' }).click()
  await expect.poll(() => mainWindow.evaluate(async (topicId) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.find((topic) => topic.id === topicId)?.stageId
  }, fixture.topicId)).toBe(fixture.nextStageId)
})

test('R3选题预期完成旗帜在月周视图共用日期并支持拖动撤销', async () => {
  const fixture = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    const stage = workspace.topicStages.find((item) => item.role === 'standard')!
    const contentType = workspace.contentTypes.find((item) => item.isActive)!
    const topic = await api.createTopic({
      title: 'R3日历旗帜选题',
      coreAngle: '验证预期完成与日历旗帜读取同一字段',
      contentTypeId: contentType.id,
      importanceLevel: 2,
      needsMoreExperience: false,
      startAt: '2026-07-20',
      expectedCompletionAt: '2026-07-24',
      actualCompletionAt: null,
      stageId: stage.id
    })
    const schedule = await api.createSchedule({
      projectId: 'ssd',
      title: 'R3撤销优先级排期',
      actionType: 'materials',
      startAt: '2026-07-23T09:00:00+08:00',
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    return {
      topicId: topic.id,
      scheduleId: schedule.id,
      scheduleStart: schedule.startAt,
      scheduleCount: (await api.getWorkspace()).schedules.length
    }
  })

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/schedule' })
  const marker = mainWindow.locator(`[data-topic-deadline-id="${fixture.topicId}"]`)
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveAttribute('aria-label', /2026-07-24/)

  await marker.click()
  await expect(mainWindow.getByRole('heading', { name: '选题管理' })).toBeVisible()
  await expect(mainWindow.locator(`#topic-row-${fixture.topicId}`)).toHaveClass(/search-highlighted/)

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/schedule' })
  const refreshedMarker = mainWindow.locator(`[data-topic-deadline-id="${fixture.topicId}"]`)
  await refreshedMarker.dragTo(mainWindow.getByLabel('2026-07-25排期区'), { targetPosition: { x: 12, y: 18 } })
  await expect.poll(() => mainWindow.evaluate(async (topicId) => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    return {
      date: workspace.topics.find((topic) => topic.id === topicId)?.expectedCompletionAt,
      scheduleCount: workspace.schedules.length
    }
  }, fixture.topicId)).toEqual({ date: '2026-07-25', scheduleCount: fixture.scheduleCount })
  await expect(mainWindow.getByRole('status')).toContainText('已移动选题')
  await mainWindow.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => mainWindow.evaluate(async (topicId) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.find((topic) => topic.id === topicId)?.expectedCompletionAt
  }, fixture.topicId)).toBe('2026-07-24')

  await mainWindow.locator(`[data-topic-deadline-id="${fixture.topicId}"]`).dragTo(mainWindow.getByLabel('2026-07-25排期区'), { targetPosition: { x: 12, y: 18 } })
  await expect.poll(() => mainWindow.evaluate(async (topicId) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.find((topic) => topic.id === topicId)?.expectedCompletionAt
  }, fixture.topicId)).toBe('2026-07-25')

  const schedulePill = mainWindow.locator(`[data-schedule-focus-id="${fixture.scheduleId}"]`).first()
  const targetDay = mainWindow.locator('.month-day').filter({ has: mainWindow.locator('time[datetime="2026-07-31"]') })
  const dataTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await schedulePill.dispatchEvent('dragstart', { dataTransfer })
  await targetDay.dispatchEvent('dragover', { dataTransfer })
  await targetDay.dispatchEvent('drop', { dataTransfer })
  await schedulePill.dispatchEvent('dragend', { dataTransfer })
  await expect.poll(() => mainWindow.evaluate(async (scheduleId) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === scheduleId)!.startAt?.slice(0, 10)
  }, fixture.scheduleId)).toBe('2026-07-31')
  const latestMoveToast = mainWindow.getByRole('status')
  await expect(latestMoveToast).toContainText('已移动排期')
  await expect(latestMoveToast).not.toContainText('已移动选题')
  await latestMoveToast.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => mainWindow.evaluate(async (scheduleId) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === scheduleId)!.startAt
  }, fixture.scheduleId)).toBe(fixture.scheduleStart)
  await expect.poll(() => mainWindow.evaluate(async (topicId) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.find((topic) => topic.id === topicId)?.expectedCompletionAt
  }, fixture.topicId)).toBe('2026-07-25')
  await mainWindow.evaluate(async (topicId) => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.updateTopic(topicId, { expectedCompletionAt: '2026-07-24' })
  }, fixture.topicId)

  await mainWindow.getByRole('button', { name: '周', exact: true }).click()
  await mainWindow.getByRole('button', { name: '下一周' }).click()
  await expect(mainWindow.locator(`[data-topic-deadline-id="${fixture.topicId}"]`)).toHaveCount(1)

  await mainWindow.evaluate(async (topicId) => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.updateTopic(topicId, { expectedCompletionAt: null })
  }, fixture.topicId)
  await expect(mainWindow.locator(`[data-topic-deadline-id="${fixture.topicId}"]`)).toHaveCount(0)

  await mainWindow.evaluate(async (topicId) => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.updateTopic(topicId, { expectedCompletionAt: '2026-07-27' })
    const workspace = await api.getWorkspace()
    const established = workspace.topicStages.find((stage) => stage.role === 'project_created')!
    await api.updateTopic(topicId, { stageId: established.id })
  }, fixture.topicId)
  await expect(mainWindow.locator(`[data-topic-deadline-id="${fixture.topicId}"]`)).toHaveCount(0)
  await expect.poll(() => mainWindow.evaluate(async (topicId) => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const topic = workspace.topics.find((item) => item.id === topicId)!
    return {
      createdProjectId: topic.createdProjectId,
      hardDeadline: workspace.schedules.find((item) => item.projectId === topic.createdProjectId && item.scheduleKind === 'hard_deadline')?.startAt?.slice(0, 10)
    }
  }, fixture.topicId)).toEqual({ createdProjectId: expect.any(String), hardDeadline: '2026-07-27' })
})
