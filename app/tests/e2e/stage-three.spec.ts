import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication; let mainWindow: Page; let userDataPath: string

async function waitForCaptureVisibility(visible: boolean): Promise<void> {
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === '快速记录')?.isVisible() ?? false)).toBe(visible)
}

async function reopenCapture(capture: Page): Promise<void> {
  await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.openCapture())
  await expect(capture.getByLabel('记录内容')).toHaveValue('')
}

async function launchApp(path: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: path } })
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
  await expect.poll(() => page.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.schedules.length) ?? 0)).toBeGreaterThan(20)
  return { app, page }
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium'); userDataPath = testInfo.outputPath('user-data'); rmSync(userDataPath, { recursive: true, force: true })
  const launched = await launchApp(userDataPath); electronApp = launched.app; mainWindow = launched.page
})
test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('完整排期页复用真实数据并提供月周日列表、未排期与直接移动', async () => {
  await mainWindow.getByRole('button', { name: '排期', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '排期', level: 1 })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '未排期' })).toBeVisible()
  await expect(mainWindow.getByText('补一组桌面细节镜头')).toBeVisible()
  await expect.poll(() => mainWindow.locator('.unscheduled-project-group').count()).toBeGreaterThan(0)
  await expect(mainWindow.locator('.unscheduled-project-group').first()).toHaveCSS('border-left-style', 'none')
  await mainWindow.getByRole('button', { name: '添加未排期行动' }).click()
  const inboxDialog = mainWindow.getByRole('dialog', { name: '添加未排期行动' })
  await expect(inboxDialog.getByText('收件箱·未排期')).toBeVisible()
  await inboxDialog.getByLabel('排期内容').fill('E2E收件箱行动')
  await inboxDialog.getByRole('button', { name: '加入收件箱' }).click()
  await expect(mainWindow.getByText('E2E收件箱行动')).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E收件箱行动')?.startAt)).toBeNull()
  for (const view of ['周', '日', '列表', '月']) {
    await mainWindow.getByRole('button', { name: view, exact: true }).click()
    await expect(mainWindow.getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  const newSchedule = mainWindow.locator('.schedule-header .new-schedule')
  await newSchedule.click()
  const createDialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await expect(createDialog.getByLabel('关联项目（可选）')).toBeFocused()
  await mainWindow.keyboard.press('Escape')
  await expect(createDialog).toBeHidden()
  await expect(newSchedule).toBeFocused()
  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  const hardBefore = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === 'e11')!.startAt)
  const hardPill = mainWindow.getByRole('button', { name: /iOS 27第一周体验·18:00大纲截止·截止日/ })
  const targetDay = mainWindow.locator('.month-day').filter({ has: mainWindow.locator('time[datetime="2026-07-31"]') })
  const dataTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await hardPill.dispatchEvent('dragstart', { dataTransfer })
  await targetDay.dispatchEvent('dragover', { dataTransfer })
  await targetDay.dispatchEvent('drop', { dataTransfer })
  await hardPill.dispatchEvent('dragend', { dataTransfer })
  const moveToast = mainWindow.getByRole('status').filter({ hasText: '已移动排期' })
  await expect(moveToast).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === 'e11')!.startAt)).toContain('2026-07-31')
  await moveToast.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === 'e11')!.startAt)).toBe(hardBefore)
  const created = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.createSchedule({
    projectId: 'ssd', title: 'E2E可移动计划', actionType: 'materials', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null
  }))
  expect(created.startAt).toBeNull()
  await mainWindow.reload(); await mainWindow.waitForLoadState('domcontentloaded')
  const unscheduledCard = mainWindow.getByRole('button', { name: /E2E可移动计划·未排期/ })
  await expect(unscheduledCard).toBeVisible()
  const inboxToCalendarTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await unscheduledCard.dispatchEvent('dragstart', { dataTransfer: inboxToCalendarTransfer })
  await targetDay.dispatchEvent('dragover', { dataTransfer: inboxToCalendarTransfer })
  await targetDay.dispatchEvent('drop', { dataTransfer: inboxToCalendarTransfer })
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E可移动计划')?.startAt)).toContain('2026-07-31')

  const movedPill = mainWindow.locator('.schedule-pill').filter({ hasText: 'E2E可移动计划' })
  const calendarToInboxTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await movedPill.dispatchEvent('dragstart', { dataTransfer: calendarToInboxTransfer })
  await mainWindow.getByLabel('未排期，拖放排期到这里').dispatchEvent('dragover', { dataTransfer: calendarToInboxTransfer })
  await mainWindow.getByLabel('未排期，拖放排期到这里').dispatchEvent('drop', { dataTransfer: calendarToInboxTransfer })
  await expect(mainWindow.getByRole('status')).toContainText('已移至未排期')
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E可移动计划')?.startAt)).toBeNull()

  const returnedCard = mainWindow.getByRole('button', { name: /E2E可移动计划·未排期/ })
  const returnToCalendarTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await returnedCard.dispatchEvent('dragstart', { dataTransfer: returnToCalendarTransfer })
  await targetDay.dispatchEvent('dragover', { dataTransfer: returnToCalendarTransfer })
  await targetDay.dispatchEvent('drop', { dataTransfer: returnToCalendarTransfer })
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E可移动计划')?.startAt)).toContain('2026-07-31')

  await movedPill.click()
  await expect(movedPill).toHaveAttribute('aria-pressed', 'true')
  await expect(mainWindow.getByRole('button', { name: '删除排期，快捷键Backspace' })).toBeVisible()
  await newSchedule.click()
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.getByRole('dialog', { name: '新建排期' })).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => Boolean((await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E可移动计划')))).toBe(true)
  await mainWindow.keyboard.press('Escape')
  await expect.poll(() => mainWindow.evaluate(async () => Boolean((await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E可移动计划')))).toBe(true)
  await mainWindow.keyboard.press('Backspace')
  await expect(mainWindow.getByRole('status')).toContainText('已删除「E2E可移动计划」')
  await expect.poll(() => mainWindow.evaluate(async () => Boolean((await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === 'E2E可移动计划')))).toBe(false)
})

test('未验证Codex时记录留在收件箱且仍可手动完成归类', async () => {
  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.getByRole('button', { name: '快速记录' }).click()
  const capture = await capturePromise; await capture.waitForLoadState('domcontentloaded')
  await capture.getByLabel('记录内容').fill('SSD还需要补一轮发热记录')
  await capture.getByRole('button', { name: '保存', exact: true }).click()
  await waitForCaptureVisibility(false)
  await reopenCapture(capture)
  await capture.getByLabel('记录内容').fill('AI提示词做一期选题')
  await capture.getByRole('button', { name: '保存', exact: true }).click()
  await waitForCaptureVisibility(false)
  const result = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!; const workspace = await api.getWorkspace()
    const direct = workspace.captures.find((item) => item.originalContent === 'SSD还需要补一轮发热记录')!
    const uncertain = workspace.captures.find((item) => item.originalContent === 'AI提示词做一期选题')!
    return { direct, uncertain }
  })
  expect(result.direct).toMatchObject({ classificationStatus: 'unprocessed', primaryProjectId: null, classificationReason: null })
  expect(result.uncertain).toMatchObject({ classificationStatus: 'unprocessed', primaryProjectId: null, classificationReason: null })
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await mainWindow.getByRole('button', { name: '更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: /Codex归类收件箱/ }).click()
  await expect(mainWindow.getByRole('status').filter({ hasText: '安全验证' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '收件箱' }).click()
  const captureRow = mainWindow.locator('.inspiration-record').filter({ hasText: 'AI提示词做一期选题' })
  await expect(captureRow).toBeVisible()
  await captureRow.locator('.inspiration-record-main').click()
  await mainWindow.getByRole('button', { name: '进入卡片归类' }).click()
  const triage = mainWindow.getByRole('dialog', { name: /AI提示词做一期选题/ })
  await expect(triage).toBeVisible()
  await mainWindow.waitForTimeout(300)
  const [dialogBox, cardBox, optionsBox, actionsBox, viewport] = await Promise.all([
    mainWindow.locator('.triage-dialog').boundingBox(),
    mainWindow.locator('.triage-surface').boundingBox(),
    mainWindow.locator('.triage-options').boundingBox(),
    mainWindow.locator('.triage-actions').boundingBox(),
    mainWindow.evaluate(() => ({ width: (globalThis as unknown as { innerWidth: number }).innerWidth, height: (globalThis as unknown as { innerHeight: number }).innerHeight }))
  ])
  expect(dialogBox).not.toBeNull(); expect(cardBox).not.toBeNull(); expect(optionsBox).not.toBeNull(); expect(actionsBox).not.toBeNull()
  expect(dialogBox!.y).toBeGreaterThan(20)
  expect(dialogBox!.y + dialogBox!.height).toBeLessThan(viewport.height - 20)
  expect(Math.abs(dialogBox!.y + dialogBox!.height / 2 - viewport.height / 2)).toBeLessThan(3)
  expect(Math.abs(cardBox!.x + cardBox!.width / 2 - viewport.width / 2)).toBeLessThan(3)
  expect(Math.abs(cardBox!.width - optionsBox!.width)).toBeLessThan(1)
  expect(optionsBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height)
  expect(Math.abs(optionsBox!.width - actionsBox!.width)).toBeLessThan(3)
  expect(Math.abs(optionsBox!.y + optionsBox!.height - (actionsBox!.y + actionsBox!.height))).toBeLessThan(2)
  await expect(mainWindow.locator('.triage-surface .triage-options')).toHaveCount(0)
  await expect(mainWindow.locator('.triage-options .triage-actions')).toHaveCount(1)
  await triage.getByRole('button', { name: /选题灵感/ }).click()
  await triage.getByRole('button', { name: /立为新选题/ }).click()
  await mainWindow.keyboard.press('Escape')
  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  await expect(mainWindow.locator('.topic-management-table b').filter({ hasText: 'AI提示词做一期选题' })).toBeVisible()
})

test('查重整理只保留一条完全相同记录并支持整批撤回', async () => {
  const title = '这是一条完全相同的重复记录'
  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.getByRole('button', { name: '快速记录' }).click()
  const capture = await capturePromise; await capture.waitForLoadState('domcontentloaded')
  for (const index of [0, 1]) {
    await capture.getByLabel('记录内容').fill(title)
    await capture.getByRole('button', { name: '保存', exact: true }).click()
    await waitForCaptureVisibility(false)
    if (index === 0) await reopenCapture(capture)
  }
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await mainWindow.getByRole('button', { name: '更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: /查重整理/ }).click()
  const toast = mainWindow.getByRole('status').filter({ hasText: '1条重复项已移入回收站' })
  await expect(toast).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async (text) => {
    const captures = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).captures.filter((capture) => capture.originalContent === text)
    return captures.filter((capture) => capture.useStatus === 'active').length
  }, title)).toBe(1)
  await toast.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => mainWindow.evaluate(async (text) => {
    const captures = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).captures.filter((capture) => capture.originalContent === text)
    return captures.filter((capture) => capture.useStatus === 'active').length
  }, title)).toBe(2)
})

test('灵感页停留期间的新记录只在点击刷新后载入收件箱', async () => {
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await expect(mainWindow.getByRole('heading', { name: '灵感库' })).toBeVisible()
  await mainWindow.waitForTimeout(200)
  const title = 'SSD页面快照刷新验证'
  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.getByRole('button', { name: '快速记录' }).click()
  const capture = await capturePromise; await capture.waitForLoadState('domcontentloaded')
  await capture.getByLabel('记录内容').fill(title)
  await capture.getByRole('button', { name: '保存', exact: true }).click()
  await waitForCaptureVisibility(false)
  await expect(mainWindow.getByRole('button', { name: /载入新结果1条/ })).toBeVisible()
  await expect(mainWindow.getByText(title)).toHaveCount(0)
  await mainWindow.getByRole('button', { name: /载入新结果1条/ }).click()
  await mainWindow.getByRole('button', { name: '收件箱' }).click()
  await expect(mainWindow.locator('.inspiration-record').filter({ hasText: title })).toBeVisible()
})

test('灵感库支持通用记录路径、已有分类和人工新建分类', async () => {
  const title = '这是一条没有明显用途的私人备忘'
  const capturePromise = electronApp.waitForEvent('window')
  await mainWindow.getByRole('button', { name: '快速记录' }).click()
  const capture = await capturePromise; await capture.waitForLoadState('domcontentloaded')
  await capture.getByLabel('记录内容').fill(title)
  await capture.getByRole('button', { name: '保存', exact: true }).click()
  await waitForCaptureVisibility(false)
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await mainWindow.getByRole('button', { name: '收件箱' }).click()
  const row = mainWindow.locator('.inspiration-record').filter({ hasText: title })
  await expect(row).toBeVisible(); await row.locator('.inspiration-record-main').click()
  await mainWindow.getByRole('button', { name: '进入卡片归类' }).click()
  const triage = mainWindow.getByRole('dialog', { name: new RegExp(title) })
  await triage.getByRole('button', { name: /通用记录/ }).click()
  await triage.getByRole('button', { name: /日常感悟/ }).click()
  await mainWindow.keyboard.press('Escape')
  await mainWindow.getByRole('button', { name: '通用记录', exact: true }).click()
  await mainWindow.getByRole('button', { name: '已自动处理' }).click()
  await expect(mainWindow.locator('.inspiration-record').filter({ hasText: title })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: /日常感悟/ }).first()).toBeVisible()

  await mainWindow.getByRole('button', { name: '更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '管理通用记录分类' }).click()
  const manager = mainWindow.getByRole('dialog', { name: '管理通用记录分类' })
  await manager.getByLabel('新通用记录分类名称').fill('阅读摘录')
  await manager.getByRole('button', { name: '新增通用记录分类' }).click()
  await expect(manager.getByText('阅读摘录')).toBeVisible()
  await manager.getByRole('button', { name: '编辑阅读摘录', exact: true }).click()
  await manager.getByLabel('编辑阅读摘录描述').fill('书籍、文章和论文中的摘录与延伸想法。')
  await manager.getByRole('button', { name: '保存', exact: true }).click()
  await manager.getByRole('button', { name: '编辑阅读摘录', exact: true }).click()
  await expect(manager.getByLabel('编辑阅读摘录描述')).toHaveValue('书籍、文章和论文中的摘录与延伸想法。')
  await manager.getByRole('button', { name: '取消', exact: true }).click()
  await manager.getByRole('button', { name: '关闭通用记录分类管理' }).click()

  await mainWindow.getByRole('button', { name: '更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '管理内容方向' }).click()
  const directionManager = mainWindow.getByRole('dialog', { name: '管理内容方向' })
  await directionManager.getByRole('button', { name: '编辑AI', exact: true }).click()
  await directionManager.getByLabel('编辑AI描述').fill('AI工具、模型、自动化、生成式创作和AI实战过程，也包括智能体工作流。')
  await directionManager.getByRole('button', { name: '保存', exact: true }).click()
  await directionManager.getByRole('button', { name: '关闭内容方向管理' }).click()
  await mainWindow.getByRole('button', { name: '更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '管理内容方向' }).click()
  const reopenedDirectionManager = mainWindow.getByRole('dialog', { name: '管理内容方向' })
  await reopenedDirectionManager.getByRole('button', { name: '编辑AI', exact: true }).click()
  await expect(reopenedDirectionManager.getByLabel('编辑AI描述')).toHaveValue(/智能体工作流/)
})

test('Mock Provider在Utility Process中运行，任务进度、完成状态与重启持久化', async () => {
  const [taskId, siblingId] = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const [task, sibling] = await Promise.all([
      api.createTask({ taskType: 'mock_demo', projectId: 'ai-browser', title: 'E2E Mock任务', provider: 'mock', input: '验证Utility Process队列' }),
      api.createTask({ taskType: 'mock_demo', projectId: 'ssd', title: 'E2E 并发入队', provider: 'mock', input: '验证同一任务不会重复启动' })
    ])
    return [task.id, sibling.id]
  })
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id)?.status, taskId), { timeout: 10_000 }).toBe('succeeded')
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id)?.status, siblingId), { timeout: 10_000 }).toBe('succeeded')
  await mainWindow.getByRole('button', { name: /运行任务/ }).click()
  const drawer = mainWindow.getByRole('dialog', { name: '运行任务' })
  await drawer.getByRole('button', { name: '查看已完成与已取消' }).click()
  await expect(drawer.getByText('E2E Mock任务')).toBeVisible()
  await electronApp.close()
  const relaunched = await launchApp(userDataPath); electronApp = relaunched.app; mainWindow = relaunched.page
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id)?.status, taskId)).toBe('succeeded')
  const localProviders = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).providerCapabilities.filter((item) => item.provider.endsWith('_cli')))
  expect(localProviders).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'codex_cli', available: false, executablePath: null }), expect.objectContaining({ provider: 'claude_cli', available: false, executablePath: null })]))
})

test('取消运行中的文案任务后终态不会被迟到结果覆盖', async () => {
  const before = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser', false)).versions.length)
  const taskId = await mainWindow.evaluate(async () => {
    const task = await (globalThis as unknown as BrowserGlobals).creatorOS!.createTask({
      taskType: 'draft_generation', projectId: 'ai-browser', title: 'E2E取消终态', provider: 'mock', input: '取消后不得写入候选文案'
    })
    return task.id
  })
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id)?.status, taskId), { timeout: 10_000 }).toBe('running')
  await mainWindow.evaluate(async (id) => (globalThis as unknown as BrowserGlobals).creatorOS!.cancelTask(id), taskId)
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id)?.status, taskId)).toBe('canceled')
  await mainWindow.waitForTimeout(1_500)
  const result = await mainWindow.evaluate(async (id) => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getWorkspace()
    return {
      status: workspace.tasks.find((task) => task.id === id)?.status,
      versionCount: (await api.getProject('ai-browser', false)).versions.length
    }
  }, taskId)
  expect(result).toEqual({ status: 'canceled', versionCount: before })
})

test('首项任务超时后会通知界面并继续运行队列', async () => {
  const timeoutTaskId = await mainWindow.evaluate(async () => {
    const task = await (globalThis as unknown as BrowserGlobals).creatorOS!.createTask({
      taskType: 'mock_demo', projectId: 'ai-browser', title: 'E2E超时队列', provider: 'mock', input: 'CREATOR_OS_TEST_TIMEOUT'
    })
    return task.id
  })
  await mainWindow.waitForTimeout(10)
  const nextTaskId = await mainWindow.evaluate(async () => {
    const task = await (globalThis as unknown as BrowserGlobals).creatorOS!.createTask({
      taskType: 'mock_demo', projectId: 'ssd', title: 'E2E超时后续跑', provider: 'mock', input: '前一项超时后必须继续'
    })
    return task.id
  })
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id), timeoutTaskId), { timeout: 10_000 }).toMatchObject({ status: 'failed', errorCode: 'TASK_TIMEOUT' })
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id), nextTaskId), { timeout: 10_000 }).toMatchObject({ status: 'succeeded' })
})

test('仅确认类任务无需Provider即可完成', async () => {
  const result = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.confirmTask('task-transcript-confirm'))
  expect(result).toMatchObject({ provider: 'none', status: 'succeeded', progress: 100, requiresConfirmation: false })
})

test('项目页在后台文案任务完成后刷新版本但保留当前页面', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/overview' })
  const description = mainWindow.getByRole('textbox', { name: '项目描述' })
  await description.fill('这段项目描述正在编辑，后台刷新不能覆盖。')
  const before = await mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser', false)
    return project.versions.filter((version) => ['script', 'outline'].includes(version.documentType)).length + project.publishingMaterials.filter((material) => ['title', 'cover', 'subtitle'].includes(material.materialKind)).length
  })
  const taskId = await mainWindow.evaluate(async () => {
    const task = await (globalThis as unknown as BrowserGlobals).creatorOS!.createTask({ taskType: 'draft_generation', projectId: 'ai-browser', title: '后台文案刷新', provider: 'mock', input: '生成一份新的候选文案' })
    return task.id
  })
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.find((task) => task.id === id)?.status, taskId), { timeout: 10_000 }).toBe('succeeded')
  await expect(description).toHaveValue('这段项目描述正在编辑，后台刷新不能覆盖。')
  await mainWindow.getByRole('button', { name: '版本', exact: true }).click()
  const versions = mainWindow.locator('.versions-card article')
  await expect(versions).toHaveCount(before + 1)
  await expect(mainWindow).toHaveURL(/#\/project\/ai-browser\/versions$/)
})

test('文案模块区分持续关联与一次性副本导入', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/script' })
  await expect(mainWindow.getByRole('heading', { name: 'Markdown / Word文案' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '关联外部文案' })).toHaveCount(1)
  await expect(mainWindow.getByRole('button', { name: '导入文件副本' })).toBeVisible()
  await expect(mainWindow.getByLabel('选择要导入的外部文案')).toBeAttached()
})

test('选题使用单元格属性菜单，项目版本与制作发布使用真实任务流骨架', async () => {
  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  await expect(mainWindow.locator('.topic-detail-drawer')).toHaveCount(0)
  await expect(mainWindow.getByRole('columnheader', { name: '开始时间' })).toBeVisible()
  await expect(mainWindow.getByRole('columnheader', { name: '目标日' })).toBeVisible()
  await expect(mainWindow.getByRole('columnheader', { name: '实际完成' })).toBeVisible()
  await expect(mainWindow.getByRole('columnheader', { name: '提前/延迟' })).toBeVisible()
  const topicTitle = '系统通知管理到底有没有变好'
  const topicRow = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: topicTitle })
  await topicRow.locator('.topic-title-button').click()
  const topicEditor = mainWindow.getByRole('dialog', { name: '编辑选题' })
  await expect(topicEditor).toBeVisible()
  await expect(topicEditor.locator('input[type="checkbox"]')).toHaveCount(0)
  await expect(topicEditor.locator('.topic-experience-toggle')).toBeVisible()
  expect((await topicEditor.locator('.topic-experience-toggle').boundingBox())!.height).toBeLessThan(60)
  await mainWindow.keyboard.press('Escape')
  await topicRow.locator('td').nth(4).getByRole('button').click()
  const startCalendar = mainWindow.getByRole('dialog', { name: '设置开始时间' })
  await expect(startCalendar.getByRole('grid', { name: '开始时间日历' })).toBeVisible()
  await startCalendar.getByRole('gridcell', { name: '选择2026年7月20日' }).click()
  await expect(topicRow.locator('td').nth(4)).toContainText('7月20日')
  await topicRow.locator('td').nth(5).getByRole('button').click()
  const expectedCalendar = mainWindow.getByRole('dialog', { name: '设置目标日' })
  await expectedCalendar.getByRole('gridcell', { name: '选择2026年7月24日' }).click()
  await expect(topicRow.locator('td').nth(5)).toContainText('7月24日')
  await topicRow.locator('td').nth(6).getByRole('button').click()
  const actualCalendar = mainWindow.getByRole('dialog', { name: '设置实际完成' })
  await actualCalendar.getByRole('gridcell', { name: '选择2026年7月22日' }).click()
  await expect(topicRow.locator('td').nth(7)).toContainText('提前2天')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const topic = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).topics.find((item) => item.title === '系统通知管理到底有没有变好')
    return [topic?.startAt, topic?.expectedCompletionAt, topic?.actualCompletionAt, topic?.scheduleVarianceDays]
  })).toEqual(['2026-07-20', '2026-07-24', '2026-07-22', -2])
  await topicRow.locator('td').nth(2).getByRole('button').click()
  const directionMenu = mainWindow.getByRole('menu', { name: '选择内容方向' })
  await expect(directionMenu).toBeVisible()
  const floatingGeometry = await directionMenu.evaluate((menu) => {
    const browser = globalThis as unknown as {
      document: { body: unknown; elementFromPoint(x: number, y: number): unknown }
      innerHeight: number
      innerWidth: number
    }
    const rect = menu.getBoundingClientRect()
    const points: Array<[number, number]> = [[rect.left + 4, rect.top + 4], [rect.right - 4, rect.bottom - 4]]
    return {
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= browser.innerWidth && rect.bottom <= browser.innerHeight,
      portaled: menu.parentElement === browser.document.body,
      topLayer: points.every(([x, y]) => {
        const hit = browser.document.elementFromPoint(x, y) as typeof menu | null
        return hit === menu || (hit !== null && menu.contains(hit))
      })
    }
  })
  expect(floatingGeometry).toEqual({ inViewport: true, portaled: true, topLayer: true })

  // 定稿入口已按§2.41移至文案工作台，版本历史不再提供设为定稿
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('button', { name: '定稿', exact: true }).click()
  await expect(mainWindow.getByRole('status')).toContainText('已定稿')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/versions' })
  const claudeRow = mainWindow.locator('.versions-card article').filter({ hasText: 'Claude候选' }).first()
  await claudeRow.getByRole('button', { name: '对比' }).click()
  await expect(mainWindow.getByLabel('版本对比')).toBeVisible()
  await mainWindow.getByRole('button', { name: '确认加入风格偏好档' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('已加入风格偏好档')

  await mainWindow.getByRole('button', { name: '拍摄剪辑', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '拍摄剪辑' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '后期', exact: true }).click()
  await expect(mainWindow.getByRole('button', { name: /选择视频或音频/ })).toBeVisible()
  await expect(mainWindow.getByText('本机离线执行')).toBeVisible()
  await expect(mainWindow.getByText('标题候选')).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '发布', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '主标题' })).toBeVisible()
  await expect(mainWindow.getByRole('table', { name: '平台物料完成度' })).toBeVisible()

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ssd/materials' })
  await expect(mainWindow.getByRole('heading', { name: '体验与参数' })).toBeVisible()
  await expect(mainWindow.locator('.inspiration-landing-list')).toContainText('快速记录')
})

test('选题阶段与列可配置，项目删除先进回收站并可恢复', async () => {
  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  await mainWindow.getByRole('button', { name: '管理阶段' }).click()
  const stageManager = mainWindow.getByRole('dialog', { name: '管理选题阶段' })
  await stageManager.getByLabel('新阶段名称').fill('脚本验证')
  await stageManager.getByRole('button', { name: '新增' }).click()
  await stageManager.getByRole('button', { name: '关闭阶段管理' }).click()
  await mainWindow.locator('.topic-stage-filter-trigger').click()
  await expect(mainWindow.getByRole('menu', { name: '筛选选题阶段' }).getByRole('menuitemradio', { name: /^脚本验证\s+\d+$/ })).toBeVisible()
  await mainWindow.keyboard.press('Escape')

  await mainWindow.getByRole('button', { name: '管理列' }).click()
  const columnManager = mainWindow.getByRole('dialog', { name: '管理选题列' })
  await columnManager.getByPlaceholder('新列名称').fill('拍摄轮次')
  await columnManager.getByLabel('新列类型').selectOption('number')
  await columnManager.getByRole('button', { name: '新增' }).click()
  await expect(mainWindow.getByRole('columnheader', { name: '拍摄轮次' })).toBeVisible()
  await columnManager.getByRole('button', { name: '关闭列管理' }).click()
  await mainWindow.getByRole('columnheader', { name: '拍摄轮次' }).getByRole('button').click()

  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  const projectRow = mainWindow.locator('.project-table article').filter({ hasText: 'iOS 27第一周体验' })
  await projectRow.click({ button: 'right' })
  await expect(mainWindow.getByRole('menu', { name: 'iOS 27第一周体验的操作' })).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.getByRole('menu', { name: 'iOS 27第一周体验的操作' })).toBeHidden()
  await projectRow.getByRole('button', { name: 'iOS 27第一周体验更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '移到回收站' }).click()
  const trashDialog = mainWindow.getByRole('dialog', { name: '移到回收站？' })
  await trashDialog.getByRole('button', { name: '移到回收站' }).click()
  await expect(projectRow).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '回收站' }).click()
  await expect(mainWindow.getByRole('heading', { name: '回收站' })).toBeVisible()
  const trashedRow = mainWindow.locator('.recycle-item').filter({ hasText: 'iOS 27第一周体验' })
  await expect(trashedRow).toBeVisible()
  await trashedRow.getByRole('button', { name: '恢复' }).click()
  await expect(trashedRow).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  await expect(mainWindow.locator('.project-table article').filter({ hasText: 'iOS 27第一周体验' })).toBeVisible()
})

test('项目右键可重命名，标题跨列表与侧边栏同步，Esc取消不改', async () => {
  // 侧栏“常用”只显示用户主动固定的项目和阶段（A2b/A2c决定），先把目标项目固定后再验证重命名同步。
  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setProjectPinned('ssd', true)
  })
  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  const row = mainWindow.locator('.project-table article').filter({ hasText: '随身SSD横评' })
  await row.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '重命名' }).click()
  const input = mainWindow.locator('.inline-rename')
  await expect(input).toBeVisible()
  await input.fill('随身SSD深度横评')
  await input.press('Enter')
  await expect(mainWindow.locator('.project-table article').filter({ hasText: '随身SSD深度横评' })).toBeVisible()
  await expect(mainWindow.locator('.project-shortcut').filter({ hasText: '随身SSD深度横评' })).toBeVisible()

  const renamed = mainWindow.locator('.project-table article').filter({ hasText: '随身SSD深度横评' })
  await renamed.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '重命名' }).click()
  await mainWindow.locator('.inline-rename').fill('临时不保存')
  await mainWindow.keyboard.press('Escape')
  await expect(mainWindow.locator('.project-table article').filter({ hasText: '随身SSD深度横评' })).toBeVisible()

  await renamed.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '重命名' }).click()
  await mainWindow.locator('.inline-rename').fill('随身SSD横评')
  await mainWindow.locator('.inline-rename').press('Enter')
  await expect(mainWindow.locator('.project-table article').filter({ hasText: '随身SSD横评' })).toBeVisible()
})

test('选题可从编辑弹窗移入回收站，并在回收站选题分类下恢复', async () => {
  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  const topicTitle = mainWindow.locator('.topic-title-button').filter({ hasText: '系统通知管理到底有没有变好' })
  await expect(topicTitle).toBeVisible()
  await topicTitle.click()
  const editor = mainWindow.getByRole('dialog', { name: '编辑选题' })
  await editor.getByRole('button', { name: '移入回收站' }).click()
  await expect(mainWindow.locator('.topic-title-button').filter({ hasText: '系统通知管理到底有没有变好' })).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '回收站' }).click()
  await mainWindow.locator('.recycle-nav').getByRole('button', { name: '选题' }).click()
  const trashedTopic = mainWindow.locator('.recycle-item').filter({ hasText: '系统通知管理到底有没有变好' })
  await expect(trashedTopic).toBeVisible()
  await trashedTopic.getByRole('button', { name: '恢复' }).click()
  await expect(trashedTopic).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  await expect(mainWindow.locator('.topic-title-button').filter({ hasText: '系统通知管理到底有没有变好' })).toBeVisible()
})

test('点击Tab行最右完成按钮可完成或取消当前阶段，发布完成同步项目状态', async () => {
  await mainWindow.locator('.project-shortcut').filter({ hasText: 'iOS 27第一周体验' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'iOS 27第一周体验' })).toBeVisible()
  await mainWindow.locator('.project-tabs').getByRole('button', { name: '发布', exact: true }).click()
  const publishMarker = mainWindow.getByRole('button', { name: '标记当前阶段完成', exact: true })
  await expect(publishMarker).toHaveAttribute('aria-pressed', 'false')
  await publishMarker.click()
  const completedPublishMarker = mainWindow.getByRole('button', { name: '取消当前阶段完成', exact: true })
  await expect(completedPublishMarker).toHaveAttribute('aria-pressed', 'true')
  await expect(completedPublishMarker).toHaveClass(/done/)
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '发布', exact: true })).toHaveClass(/done/)
  // 常用中的项目行只显示名称，状态进入悬停提示（A2b决定），因此在title中断言已发布状态。
  await expect(mainWindow.locator('.project-shortcut').filter({ hasText: 'iOS 27第一周体验' })).toHaveAttribute('title', /已发布/)
  await completedPublishMarker.click()
  await expect(mainWindow.getByRole('button', { name: '标记当前阶段完成', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '发布', exact: true })).not.toHaveClass(/done/)
  await expect(mainWindow.locator('.project-shortcut').filter({ hasText: 'iOS 27第一周体验' })).not.toHaveAttribute('title', /已发布/)
  await expect(mainWindow.getByRole('button', { name: '标记完成发布', exact: true })).toHaveCount(0)
})

test('工作区撤销IPC只撤回本次运行周期内最新的阶段操作', async () => {
  const result = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.setModuleCompleted('ios', 'outline', true)
    const olderState = await api.getWorkspaceUndoState()
    await api.setModuleCompleted('ios', 'script', true)
    const latestState = await api.getWorkspaceUndoState()
    let staleError = ''
    try {
      await api.undoWorkspaceOperation(olderState.operationId)
    } catch (error) {
      staleError = error instanceof Error ? error.message : String(error)
    }
    const undone = await api.undoWorkspaceOperation(latestState.operationId)
    const project = await api.getProject('ios', false)
    return {
      olderState,
      latestState,
      staleError,
      undone,
      outlineStatus: project.stageTimeRecords.find((record) => record.stageKey === 'outline')?.status,
      scriptStatus: project.stageTimeRecords.find((record) => record.stageKey === 'script')?.status,
      nextState: await api.getWorkspaceUndoState()
    }
  })
  expect(result.olderState).toMatchObject({ canUndo: true, commandType: 'project.stage-completion' })
  expect(result.latestState).toMatchObject({ canUndo: true, commandType: 'project.stage-completion' })
  expect(result.latestState.operationId).not.toBe(result.olderState.operationId)
  expect(result.staleError).toContain('撤销栈已经变化')
  expect(result.undone).toMatchObject({ operationId: result.latestState.operationId, commandType: 'project.stage-completion' })
  expect(result.outlineStatus).toBe('completed')
  expect(result.scriptStatus).toBe('not_started')
  expect(result.nextState).toMatchObject({ canUndo: true, operationId: result.olderState.operationId })
})

test('阶段首次动作自动开始，概览显示进度并支持右键Tab修改时间', async () => {
  const projectId = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = await api.createProject({
      title: '阶段时间E2E', description: '验证阶段自身起止时间', contentTypeId: 'type-ai', templateId: 'template-ai-tutorial', colorToken: 'project-8', platformTargets: ['B站']
    })
    await api.saveProjectTextMaterial(project.id, 'project_material', '首次有效资料', '这次保存应自动开始资料阶段。')
    return project.id
  })
  await mainWindow.evaluate((id) => { (globalThis as unknown as BrowserGlobals).location.hash = `#/project/${id}/materials` }, projectId)
  await expect(mainWindow.getByRole('heading', { name: '阶段时间E2E' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '标记当前阶段完成', exact: true }).click()
  const toast = mainWindow.locator('.project-stage-toast')
  await expect(toast).toContainText('资料完成于')
  await expect(toast.getByRole('button', { name: '修改' })).toHaveCount(0)
  const materialTab = mainWindow.locator('.project-tabs').getByRole('button', { name: '资料', exact: true })
  await materialTab.click({ button: 'right' })
  const editor = mainWindow.getByRole('dialog', { name: '修改资料阶段时间' })
  await expect(editor.getByRole('button', { name: /^开始/ })).toBeVisible()
  await expect(editor.getByRole('button', { name: /^结束/ })).toBeVisible()
  await expect(editor.getByRole('button', { name: /^实际投入/ })).toBeVisible()
  await expect(editor.getByText('预计时长')).toHaveCount(0)
  expect((await editor.boundingBox())?.width ?? 999).toBeLessThanOrEqual(312)
  await editor.getByRole('button', { name: /^开始/ }).click()
  await expect(editor.locator('.stage-time-quick-grid > button')).toHaveCount(4)
  await expect(editor.locator('.stage-week-strip > div > button')).toHaveCount(7)
  await editor.getByRole('button', { name: '昨天', exact: false }).click()
  await editor.getByRole('button', { name: '上午', exact: true }).click()
  await materialTab.click({ button: 'right' })
  const effortEditor = mainWindow.getByRole('dialog', { name: '修改资料阶段时间' })
  await expect(effortEditor.getByRole('button', { name: /^实际投入/ })).toBeVisible()
  await effortEditor.getByRole('button', { name: /^实际投入/ }).click()
  await effortEditor.getByRole('button', { name: '1.5天', exact: true }).click()
  await expect(toast).toContainText('已更新资料阶段时间')

  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '概览', exact: true })).toHaveCount(0)
  await mainWindow.locator('.project-overview-nav').click()
  const progress = mainWindow.locator('.project-progress-card')
  await expect(progress).toBeVisible()
  await expect(progress.locator('.project-progress-meta')).toContainText('已完成1/共')
  await expect(progress.locator('.project-progress-track')).toHaveCSS('height', '6px')
  await expect(progress.locator('.stage-time-item')).toHaveCount(0)
  await materialTab.click({ button: 'right' })
  await expect(mainWindow.getByRole('dialog', { name: '修改资料阶段时间' })).toBeVisible()
})

test('新建选题与新建项目都默认展开可编辑字段', async () => {
  await mainWindow.getByRole('button', { name: '选题管理' }).click()
  await mainWindow.locator('.topbar').getByRole('button', { name: '新建选题', exact: true }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建选题' })
  await dialog.getByLabel('选题名称').fill('E2E chip 选题')
  await expect(dialog.getByRole('group', { name: '内容方向' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /展开修改|收起/ })).toHaveCount(0)
  const directionChip = dialog.getByRole('group', { name: '内容方向' }).locator('.np-chip').filter({ hasText: '手机系统' })
  await directionChip.click()
  await expect(directionChip).toHaveClass(/\bon\b/)
  await dialog.getByRole('group', { name: '选题阶段' }).locator('.np-chip').filter({ hasText: '待评估' }).click()
  await dialog.locator('footer .primary-action').click()
  await expect(mainWindow.locator('.topic-title-button').filter({ hasText: 'E2E chip 选题' })).toBeVisible()
})

test('项目与选题共用生命周期，完成后可从选题重新开始', async () => {
  const directProjectTitle = 'E2E直接项目生命周期'
  const topicTitle = 'E2E选题自动立项'

  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  await expect(mainWindow.locator('.projects-page .page-header').getByRole('button', { name: '新建项目', exact: true })).toHaveCount(0)
  await mainWindow.locator('.topbar').getByRole('button', { name: '新建项目', exact: true }).click()
  const projectDialog = mainWindow.getByRole('dialog', { name: '新建项目' })
  await projectDialog.getByLabel('项目名称').fill(directProjectTitle)
  await projectDialog.getByRole('button', { name: '创建项目' }).click()
  await expect(mainWindow.getByRole('heading', { name: directProjectTitle })).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async (title) => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const project = workspace.projects.find((item) => item.title === title)
    const topic = workspace.topics.find((item) => item.createdProjectId === project?.id)
    return { projectRole: project?.topicStageRole, topicStage: workspace.topicStages.find((stage) => stage.id === topic?.stageId)?.role }
  }, directProjectTitle)).toEqual({ projectRole: 'project_created', topicStage: 'project_created' })

  await mainWindow.getByRole('button', { name: '选题管理', exact: true }).click()
  await expect(mainWindow.locator('.topbar').getByRole('button', { name: '新建选题', exact: true })).toBeVisible()
  await expect(mainWindow.locator('.topic-management-page .page-header').getByRole('button', { name: '新建选题', exact: true })).toHaveCount(0)
  await mainWindow.locator('.topbar').getByRole('button', { name: '新建选题', exact: true }).click()
  const topicDialog = mainWindow.getByRole('dialog', { name: '新建选题' })
  await topicDialog.getByLabel('选题名称').fill(topicTitle)
  await topicDialog.getByRole('button', { name: '新建选题', exact: true }).click()
  const topicRow = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: topicTitle })
  await expect(topicRow).toBeVisible()
  const createdTopic = await mainWindow.evaluate(async (title) => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const topic = workspace.topics.find((item) => item.title === title)!
    return { id: topic.id, stageName: workspace.topicStages.find((stage) => stage.id === topic.stageId)!.name }
  }, topicTitle)
  await topicRow.getByRole('button', { name: createdTopic.stageName, exact: true }).click()
  await mainWindow.getByRole('menu', { name: '选择选题阶段' }).getByRole('button', { name: '已立项', exact: true }).click()
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const topic = workspace.topics.find((item) => item.id === id)
    return { linked: Boolean(topic?.createdProjectId), role: workspace.topicStages.find((stage) => stage.id === topic?.stageId)?.role }
  }, createdTopic.id)).toEqual({ linked: true, role: 'project_created' })

  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  const projectRow = mainWindow.locator('.project-table article').filter({ hasText: topicTitle })
  await expect(projectRow).toBeVisible()
  await projectRow.getByRole('button', { name: `${topicTitle}更多操作` }).click()
  await mainWindow.getByRole('menu').getByRole('menuitem', { name: '标记项目完成' }).click()
  await mainWindow.getByRole('dialog', { name: '标记项目完成？' }).getByRole('button', { name: '标记完成' }).click()
  await expect(projectRow).toHaveCount(0)

  await mainWindow.getByRole('button', { name: '选题管理', exact: true }).click()
  const completedRow = mainWindow.locator('.topic-management-table tbody tr').filter({ hasText: topicTitle })
  await expect(completedRow).toContainText('已完成')
  await completedRow.getByRole('button', { name: '重新开始', exact: true }).click()
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const topic = workspace.topics.find((item) => item.id === id)
    return workspace.topicStages.find((stage) => stage.id === topic?.stageId)?.role
  }, createdTopic.id)).toBe('project_created')
  await mainWindow.getByRole('button', { name: '内容项目', exact: true }).click()
  await expect(mainWindow.locator('.project-table article').filter({ hasText: topicTitle })).toBeVisible()
})
