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
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/schedule' })
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

test('新建排期默认不绑定项目并可选择醒目颜色', async () => {
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await expect(dialog.getByLabel('关联项目（可选）')).toHaveValue('')
  await dialog.getByRole('button', { name: '选择颜色7' }).click()
  await dialog.getByLabel('排期内容').fill('领取快递')
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const item = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((schedule) => schedule.title === '领取快递')
    return item ? { projectId: item.projectId, colorToken: item.colorToken, actionType: item.actionType } : null
  })).toEqual({ projectId: null, colorToken: 'project-7', actionType: 'overview' })
  await expect(mainWindow.getByRole('button', { name: /其他安排·领取快递/ })).toBeVisible()
})

test('R5c新建排期按项目启用阶段创建，备注为空时使用阶段名', async () => {
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  const projectSelect = dialog.getByLabel('关联项目（可选）')
  await expect(projectSelect).toBeFocused()
  await projectSelect.selectOption({ label: 'AI浏览器入门教学' })

  const stages = dialog.getByRole('group', { name: '项目阶段' })
  await expect(stages.getByRole('button', { name: '大纲', exact: true })).toBeVisible()
  await expect(stages.getByRole('button', { name: '概览', exact: true })).toHaveCount(0)
  await expect(stages.getByRole('button', { name: '版本', exact: true })).toHaveCount(0)
  await stages.getByRole('button', { pressed: true }).click()
  await stages.getByRole('button', { name: '大纲', exact: true }).click()
  await dialog.getByLabel('目标日').check()
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()

  await expect(dialog).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const schedule = workspace.schedules.find((item) => item.projectId === 'ai-browser' && item.title === '大纲')
    return schedule ? { actionType: schedule.actionType, kind: schedule.scheduleKind, hasDate: Boolean(schedule.startAt) } : null
  })).toEqual({ actionType: 'outline', kind: 'hard_deadline', hasDate: true })
})

test('R5c未排期收件箱可一次多选添加项目阶段', async () => {
  await mainWindow.getByRole('button', { name: '添加未排期行动' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '添加未排期行动' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  const stages = dialog.getByRole('group', { name: '项目阶段' })
  await stages.getByRole('button', { name: '大纲', exact: true }).click()
  await stages.getByRole('button', { name: '拍摄', exact: true }).click()
  await stages.getByRole('button', { name: '剪辑', exact: true }).click()
  await expect(stages.getByRole('button', { pressed: true })).toHaveCount(3)
  await dialog.getByLabel('备注（可选）').fill('R8批量阶段')
  await dialog.getByRole('button', { name: '加入收件箱·3项' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const items = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules
      .filter((item) => item.projectId === 'ai-browser' && item.startAt === null && item.title.startsWith('R8批量阶段'))
    return [...new Set(items.map((item) => item.actionType))].sort()
  })).toEqual(['editing', 'outline', 'shooting'])
  await mainWindow.keyboard.press('Meta+Z')
  await expect.poll(() => mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules
      .filter((item) => item.projectId === 'ai-browser' && item.title.startsWith('R8批量阶段')).length
  })).toBe(0)
})

test('未排期阶段不会重复添加，并可直接从看板删除', async () => {
  await mainWindow.getByRole('button', { name: '添加未排期行动' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '添加未排期行动' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await dialog.getByRole('group', { name: '项目阶段' }).getByRole('button', { name: '资料', exact: true }).click()
  const selectedStage = dialog.getByRole('group', { name: '项目阶段' }).getByRole('button', { pressed: true })
  const stageName = (await selectedStage.textContent())!.trim()
  await dialog.getByRole('button', { name: '加入收件箱' }).click()

  await mainWindow.getByRole('button', { name: '添加未排期行动' }).click()
  const repeatedDialog = mainWindow.getByRole('dialog', { name: '添加未排期行动' })
  await repeatedDialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await expect(repeatedDialog.getByRole('group', { name: '项目阶段' }).getByRole('button', { name: new RegExp(`^${stageName}`) })).toBeDisabled()
  await repeatedDialog.getByRole('button', { name: '关闭' }).click()

  const projectGroup = mainWindow.locator('.unscheduled-project-group').filter({ hasText: 'AI浏览器入门教学' })
  await projectGroup.getByRole('button', { name: new RegExp(`删除AI浏览器入门教学的${stageName}`) }).click()
  await expect(projectGroup.getByText(stageName, { exact: true })).toHaveCount(0)
})

test('R5c项目筛选chip拖入日期会预选项目并直接聚焦阶段', async () => {
  const projectChip = mainWindow.locator('.calendar-filterbar button[data-project-id="ai-browser"]')
  const targetDate = mainWindow.getByLabel('2026-07-15排期区')
  await projectChip.dragTo(targetDate)

  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await expect(dialog.getByLabel('关联项目（可选）')).toHaveValue('ai-browser')
  const selectedStage = dialog.getByRole('group', { name: '项目阶段' }).getByRole('button', { pressed: true })
  await expect(selectedStage).toBeFocused()
  await selectedStage.click()
  await dialog.getByRole('group', { name: '项目阶段' }).getByRole('button', { name: '文案', exact: true }).click()
  await dialog.getByLabel('备注（可选）').fill('拖入日期后的文案推进')
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()

  await expect.poll(() => mainWindow.evaluate(async () => {
    const schedule = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.title === '拖入日期后的文案推进')
    return schedule ? { projectId: schedule.projectId, actionType: schedule.actionType, start: schedule.startAt?.slice(0, 10) } : null
  })).toEqual({ projectId: 'ai-browser', actionType: 'script', start: '2026-07-15' })
})

test('R5c阶段在表单打开后停用会收敛选择且不能提交旧阶段', async () => {
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await dialog.getByRole('group', { name: '项目阶段' }).getByRole('button', { name: '大纲', exact: true }).click()

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.setProjectModule('ai-browser', 'outline', false)
  })

  const stages = dialog.getByRole('group', { name: '项目阶段' })
  await expect(stages.getByRole('button', { name: '大纲', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '新建排期', exact: true })).toBeDisabled()
  await stages.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    return workspace.schedules.some((item) => item.projectId === 'ai-browser' && item.actionType === 'outline' && item.title === '大纲')
  })).toBe(false)
})

test('没有启用阶段的项目仍可创建不关联阶段的排期', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = (await api.getWorkspace()).projects.find((item) => item.id === 'ai-browser')
    for (const moduleKey of project?.enabledModuleKeys ?? []) await api.setProjectModule('ai-browser', moduleKey, false)
  })
  const projectChip = mainWindow.locator('.calendar-filterbar button[data-project-id="ai-browser"]')
  await projectChip.dragTo(mainWindow.getByLabel('2026-07-15排期区'))

  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await expect(dialog.getByText('当前项目没有启用阶段，仍可选择“不关联阶段”。')).toBeVisible()
  await expect(dialog.getByLabel('关联项目（可选）')).toBeFocused()
  await dialog.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '新建排期', exact: true })).toBeEnabled()
  await dialog.getByLabel('备注（可选）').fill('整理项目交付材料')
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const item = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((schedule) => schedule.title === '整理项目交付材料')
    return item ? { actionType: item.actionType, date: item.startAt?.slice(0, 10) } : null
  })).toEqual({ actionType: 'overview', date: '2026-07-15' })
})

test('R5c首页商单排期会打开商单模块而不是概览', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const today = (await api.getWorkspace()).today
    await api.createSchedule({
      projectId: 'sponsor',
      title: '打开商单阶段',
      actionType: 'business',
      startAt: `${today}T09:00:00+08:00`,
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/home'
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')

  await mainWindow.getByRole('button', { name: /无线麦克风商单·打开商单阶段/ }).dblclick()
  await expect.poll(() => mainWindow.url()).toContain('#/project/sponsor/business')
})


test('项目不关联阶段可留空备注创建跨日排期，切换项目使用当前项目名', async () => {
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  const create = dialog.getByRole('button', { name: '新建排期', exact: true })
  await expect(create).toBeDisabled()
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await dialog.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await expect(dialog.getByLabel('备注（可选）')).toHaveValue('')
  await expect(create).toBeEnabled()
  await dialog.getByLabel('关联项目（可选）').selectOption('')
  await dialog.getByLabel('排期内容').fill('   ')
  await expect(create).toBeDisabled()
  await dialog.getByLabel('关联项目（可选）').selectOption('sponsor')
  await dialog.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await dialog.getByLabel('开始日期').fill('2026-10-01')
  await dialog.getByLabel('结束日期').fill('2026-10-04')
  await create.click()
  await expect(dialog).toBeHidden()
  const read = () => mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    const project = workspace.projects.find(p => p.id === 'sponsor')!
    return workspace.schedules.filter(s => s.projectId === project.id && s.title === project.title && s.actionType === 'overview').map(s => ({ start: s.startAt?.slice(0, 10), end: s.endAt?.slice(0, 10), kind: s.scheduleKind }))
  })
  await expect.poll(read).toContainEqual({ start: '2026-10-01', end: '2026-10-04', kind: 'plan' })
  await mainWindow.reload()
  await expect.poll(read).toContainEqual({ start: '2026-10-01', end: '2026-10-04', kind: 'plan' })
})

test('首页与未排期入口复用项目名兜底，备注留空不影响阶段或目标日期类型', async () => {
  await mainWindow.evaluate(() => { location.hash = '#/home' })
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  let dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await dialog.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await dialog.getByLabel('目标日', { exact: true }).check()
  await dialog.getByRole('button', { name: '新建排期', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const w = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    return w.schedules.some(s => s.projectId === 'ai-browser' && s.title === w.projects.find(p => p.id === 'ai-browser')!.title && s.actionType === 'overview' && s.scheduleKind === 'hard_deadline')
  })).toBe(true)
  await mainWindow.evaluate(() => { location.hash = '#/schedule' })
  await mainWindow.getByRole('button', { name: '添加未排期行动' }).click()
  dialog = mainWindow.getByRole('dialog', { name: '添加未排期行动' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await dialog.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await expect(dialog.getByLabel('备注（可选）')).toHaveValue('')
  await dialog.getByRole('button', { name: '加入收件箱', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const w = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    return w.schedules.some(s => s.projectId === 'ai-browser' && s.title === w.projects.find(p => p.id === 'ai-browser')!.title && s.actionType === 'overview' && s.startAt === null && s.scheduleKind === 'plan')
  })).toBe(true)
})

test('dated project stages multi-select, create same-range batch and undo together', async () => {
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  const stages = dialog.getByRole('group', { name: '项目阶段' })
  await expect(stages.getByRole('button', { pressed: true })).toHaveText('不关联阶段')
  await expect(dialog.getByRole('button', { name: '新建排期', exact: true })).toBeEnabled()
  for (const name of ['文案', '拍摄', '剪辑']) await stages.getByRole('button', { name, exact: true }).click()
  await expect(stages.getByRole('button', { pressed: true })).toHaveCount(3)
  await dialog.getByLabel('开始日期').fill('2026-09-30')
  await dialog.getByLabel('结束日期').fill('2026-10-02')
  await dialog.getByLabel('备注（可选）').fill('跨月制作')
  await dialog.getByRole('button', { name: '新建排期·3项', exact: true }).click()
  await expect(dialog).toBeHidden()
  const read = () => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.filter(s => s.title.startsWith('跨月制作·')).map(s => ({ title: s.title, stage: s.actionType, start: s.startAt?.slice(0, 10), end: s.endAt?.slice(0, 10), kind: s.scheduleKind })).sort((a, b) => a.stage.localeCompare(b.stage)))
  await expect.poll(read).toEqual([
    { title: '跨月制作·剪辑', stage: 'editing', start: '2026-09-30', end: '2026-10-02', kind: 'plan' },
    { title: '跨月制作·文案', stage: 'script', start: '2026-09-30', end: '2026-10-02', kind: 'plan' },
    { title: '跨月制作·拍摄', stage: 'shooting', start: '2026-09-30', end: '2026-10-02', kind: 'plan' }
  ])
  await mainWindow.reload()
  await expect.poll(async () => (await read()).length).toBe(3)
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/schedule?date=2026-09-30' })
  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  await expect(mainWindow.locator('.schedule-range-pill').filter({ hasText: '跨月制作·文案／拍摄／剪辑' })).toHaveCount(1)
  await mainWindow.keyboard.press('Meta+Z')
  await expect.poll(read).toEqual([])
})

test('dated multiselect excludes overview, clears stale project stages, and keeps only enabled choices', async () => {
  await mainWindow.evaluate(() => { location.hash = '#/home' })
  await mainWindow.getByRole('button', { name: '＋ 新建排期' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  const stages = dialog.getByRole('group', { name: '项目阶段' })
  await stages.getByRole('button', { name: '文案', exact: true }).click()
  await stages.getByRole('button', { name: '拍摄', exact: true }).click()
  await stages.getByRole('button', { name: '不关联阶段', exact: true }).click()
  await expect(stages.getByRole('button', { pressed: true })).toHaveText('不关联阶段')
  await stages.getByRole('button', { name: '文案', exact: true }).focus()
  await mainWindow.keyboard.press('Space')
  await stages.getByRole('button', { name: '拍摄', exact: true }).click()
  await expect(stages.getByRole('button', { name: '不关联阶段', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await dialog.getByLabel('关联项目（可选）').selectOption('sponsor')
  await expect(stages.getByRole('button', { pressed: true })).toHaveCount(1)
  await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
  await stages.getByRole('button', { pressed: true }).click()
  await stages.getByRole('button', { name: '文案', exact: true }).click()
  await stages.getByRole('button', { name: '拍摄', exact: true }).click()
  await mainWindow.evaluate(async () => { await (globalThis as unknown as BrowserGlobals).creatorOS!.setProjectModule('ai-browser', 'shooting', false) })
  await expect(stages.getByRole('button', { name: '拍摄', exact: true })).toHaveCount(0)
  await expect(stages.getByRole('button', { pressed: true })).toHaveText('文案')
  await mainWindow.evaluate(async () => { await (globalThis as unknown as BrowserGlobals).creatorOS!.setProjectModule('ai-browser', 'script', false) })
  await expect(dialog.getByRole('button', { name: '新建排期', exact: true })).toBeDisabled()
})

test('grouped calendar entry completes, resizes, edits and deletes as one', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const ids = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const base = { projectId: 'ai-browser', startAt: '2026-09-30T09:00:00+08:00', endAt: '2026-10-02T18:00:00+08:00', scheduleKind: 'plan' as const, waitingFor: null }
    return (await api.createScheduleBatch([{ ...base, actionType: 'materials', title: '资料' }, { ...base, actionType: 'script', title: '文案' }], crypto.randomUUID())).map(item => item.id)
  })
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/schedule?date=2026-09-30' })
  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  const bar = mainWindow.locator('.schedule-range-pill').filter({ hasText: '资料／文案' })
  await expect(bar).toHaveCount(1)
  await bar.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '标记已完成', exact: true }).click()
  await expect(bar).toHaveClass(/done/)
  const rows = () => mainWindow.evaluate(async ids => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.filter(item => ids.includes(item.id)), ids)
  await expect.poll(async () => (await rows()).every(item => item.state === 'done')).toBe(true)
  await mainWindow.screenshot({ path: testInfo.outputPath('grouped-completed.png') })
  await bar.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '恢复进行中', exact: true }).click()
  await expect(bar).not.toHaveClass(/done/)
  await mainWindow.locator(`[data-schedule-range-id="${ids[0]}"] [data-resize-edge="end"]`).focus()
  await mainWindow.keyboard.press('ArrowRight')
  await expect.poll(async () => (await rows()).every(item => item.endAt?.startsWith('2026-10-03'))).toBe(true)
  await bar.click({ button: 'right' })
  await mainWindow.getByRole('menuitem', { name: '修改排期名称', exact: true }).click()
  await mainWindow.getByRole('dialog', { name: '修改排期名称' }).getByLabel('排期名称', { exact: true }).fill('合并安排')
  await mainWindow.getByRole('dialog', { name: '修改排期名称' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect(bar).toContainText('合并安排·资料／文案')
  await mainWindow.reload()
  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  await expect(bar).toHaveCount(1)
  await bar.click()
  await mainWindow.getByRole('button', { name: '删除排期，快捷键Backspace' }).click()
  await expect.poll(rows).toEqual([])
})

test('trip and project target expose reversible completion in the calendar', async () => {
  const ids = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const target = await api.createSchedule({ projectId: 'ai-browser', actionType: 'overview', title: '项目目标', startAt: '2026-09-30T09:00:00+08:00', endAt: null, scheduleKind: 'hard_deadline', waitingFor: null })
    const trip = await api.saveBusinessTrip({ scheduleId: null, expectedUpdatedAt: null, action: 'save', title: '广州出差', projectId: null, startDate: '2026-09-29', endDate: '2026-10-02', notes: '', kind: 'business' })
    return { target: target.id, trip: trip.id }
  })
  await mainWindow.evaluate(() => { location.hash = '#/schedule?date=2026-09-30' })
  await mainWindow.getByRole('button', { name: '月', exact: true }).click()
  for (const selector of [`[data-project-target-id="${ids.target}"]`, `[data-schedule-focus-id="${ids.trip}"]`]) {
    const bar = mainWindow.locator(selector)
    await bar.click({ button: 'right' })
    await mainWindow.getByRole('menuitem', { name: '标记已完成', exact: true }).click()
    await expect(bar).toHaveClass(/done/)
    expect(await bar.locator('span').last().evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('line-through')
    await bar.click({ button: 'right' })
    await mainWindow.getByRole('menuitem', { name: '恢复进行中', exact: true }).click()
    await expect(bar).not.toHaveClass(/done/)
  }
})

test('project schedules need neither a stage selection nor a note, including after clearing stages', async () => {
  for (const entry of ['calendar', 'home', 'inbox']) {
    await mainWindow.evaluate(entry => { location.hash = entry === 'home' ? '#/home' : '#/schedule' }, entry)
    await mainWindow.getByRole('button', { name: entry === 'inbox' ? '添加未排期行动' : '＋ 新建排期', exact: true }).click()
    const dialog = mainWindow.getByRole('dialog', { name: entry === 'inbox' ? '添加未排期行动' : '新建排期', exact: true })
    const save = dialog.getByRole('button', { name: entry === 'inbox' ? '加入收件箱' : '新建排期', exact: true })
    await expect(save).toBeDisabled()
    await dialog.getByLabel('关联项目（可选）').selectOption('ai-browser')
    const stages = dialog.getByRole('group', { name: '项目阶段' })
    await expect(stages.getByRole('button', { pressed: true })).toHaveText('不关联阶段')
    if (entry !== 'calendar') {
      for (const name of ['文案', '拍摄', '文案', '拍摄']) await stages.getByRole('button', { name, exact: true }).click()
      await expect(stages.getByRole('button', { pressed: true })).toHaveText('不关联阶段')
    }
    await dialog.getByLabel('关联项目（可选）').selectOption('sponsor')
    await dialog.getByLabel('备注（可选）').fill('   ')
    await expect(save).toBeEnabled()
    if (entry !== 'inbox') {
      await dialog.getByLabel('开始日期').fill('2026-10-11')
      await dialog.getByLabel('结束日期').fill('2026-10-16')
    }
    const countBefore = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.length)
    await save.click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => mainWindow.evaluate(async count => {
      const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
      const project = workspace.projects.find(project => project.id === 'sponsor')!
      return workspace.schedules.length === count + 1 && workspace.schedules.some(item => item.projectId === project.id && item.title === project.title && item.actionType === 'overview' && item.scheduleKind === 'plan')
    }, countBefore)).toBe(true)
  }
})
