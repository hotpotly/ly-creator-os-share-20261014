import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
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

async function dragResizeHandle(handle: Locator, dayDelta: number, beforePointerUp?: () => Promise<void>): Promise<void> {
  const week = handle.locator('xpath=ancestor::*[@data-calendar-week][1]')
  const [handleBox, weekBox] = await Promise.all([handle.boundingBox(), week.boundingBox()])
  if (!handleBox || !weekBox) throw new Error('跨天排期拖拽热区没有可用几何信息')
  const startX = handleBox.x + handleBox.width / 2
  const startY = handleBox.y + handleBox.height / 2
  await mainWindow.mouse.move(startX, startY)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(startX + (weekBox.width / 7) * dayDelta, startY, { steps: 8 })
  await beforePointerUp?.()
  await mainWindow.mouse.up()
}

async function expectTodayDateMarker(marker: Locator): Promise<void> {
  await expect(marker).toHaveAttribute('aria-current', 'date')
  await expect.poll(() => marker.evaluate((element) => {
    const style = (globalThis as unknown as { getComputedStyle(node: unknown, pseudo?: string): { content: string; fontWeight: string; height: string; width: string } }).getComputedStyle
    const dot = style(element, '::after')
    return {
      content: dot.content,
      fontWeight: Number(style(element).fontWeight),
      height: dot.height,
      width: dot.width
    }
  })).toEqual({ content: '""', fontWeight: 750, height: '4px', width: '4px' })
}

test('完整排期的周视图和月视图统一突出今天', async () => {
  await expectTodayDateMarker(mainWindow.locator('.full-schedule .month-day.is-today time'))
  await mainWindow.getByRole('button', { name: '周', exact: true }).click()
  await expectTodayDateMarker(mainWindow.locator('.full-schedule .week-day.is-today .week-day-head time'))
})

test('完整月视图合并日期导航、提高同日容量并强化完成态', async () => {
  const scheduleHeader = mainWindow.locator('.full-schedule > .schedule-header')
  await expect(scheduleHeader.getByRole('heading', { name: '项目排期' })).toBeVisible()
  await expect(scheduleHeader.locator('.schedule-period-nav')).toContainText('2026年7月')
  await expect(mainWindow.locator('.full-schedule > .inline-calendar-toolbar')).toHaveCount(0)
  const completedPill = mainWindow.locator('.schedule-pill.done').first()
  await expect(completedPill.locator('.schedule-done-mark')).toBeVisible()
  await expect.poll(() => completedPill.evaluate((element) => (globalThis as unknown as { getComputedStyle(node: unknown): { opacity: string } }).getComputedStyle(element).opacity)).toBe('1')

  const rangeId = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const range = await api.createSchedule({
      projectId: 'ios',
      title: '跨周拍摄',
      actionType: 'shooting',
      startAt: '2026-07-17T09:00:00+08:00',
      endAt: '2026-07-22T09:00:00+08:00',
      scheduleKind: 'plan',
      waitingFor: null
    })
    for (let index = 1; index <= 6; index += 1) {
      await api.createSchedule({
        projectId: 'ai-browser',
        title: `同日行动${index}`,
        actionType: 'materials',
        startAt: `2026-07-14T${String(8 + index).padStart(2, '0')}:00:00+08:00`,
        endAt: null,
        scheduleKind: 'plan',
        waitingFor: null
      })
    }
    return range.id
  })

  const segments = mainWindow.locator(`[data-schedule-range-id="${rangeId}"]`)
  await expect(segments).toHaveCount(2)
  await expect(segments.nth(0)).toHaveAttribute('data-range-start', 'true')
  await expect(segments.nth(0)).toHaveAttribute('data-range-end', 'false')
  await expect(segments.nth(1)).toHaveAttribute('data-range-start', 'false')
  await expect(segments.nth(1)).toHaveAttribute('data-range-end', 'true')
  await expect(mainWindow.getByLabel('2026-07-14排期区').locator('.schedule-pill-shell')).toHaveCount(6)
  await expect(mainWindow.getByLabel('2026-07-14排期区').locator('.month-overflow')).toHaveCount(0)

  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    for (let index = 1; index <= 4; index += 1) {
      await api.createSchedule({
        projectId: 'ai-browser',
        title: `跨天同日起始${index}`,
        actionType: 'materials',
        startAt: `2026-07-18T${String(8 + index).padStart(2, '0')}:00:00+08:00`,
        endAt: null,
        scheduleKind: 'plan',
        waitingFor: null
      })
    }
  })
  await expect(mainWindow.getByLabel('2026-07-18排期区').locator('.schedule-pill-shell')).toHaveCount(6)
  await expect(mainWindow.getByLabel('2026-07-18排期区').locator('.month-overflow')).toHaveText('还有1项')

  await dragResizeHandle(mainWindow.getByRole('button', { name: '调整跨周拍摄开始日期' }), 1)
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === id)?.startAt?.slice(0, 10)
  }, rangeId)).toBe('2026-07-18')
  await mainWindow.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === id)?.startAt?.slice(0, 10)
  }, rangeId)).toBe('2026-07-17')
})

test('R5d周视图保留未被跨天条覆盖日期的新建入口并支持连续键盘调整', async () => {
  const rangeId = await mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.createSchedule({
      projectId: 'ios',
      title: '键盘调整跨天排期',
      actionType: 'shooting',
      startAt: '2026-07-17T09:00:00+08:00',
      endAt: '2026-07-18T09:00:00+08:00',
      scheduleKind: 'plan',
      waitingFor: null
    })).id
  })
  await mainWindow.getByRole('button', { name: '周', exact: true }).click()
  await expect(mainWindow.getByLabel('2026-07-14排期区').getByRole('button', { name: '暂未排期' })).toBeVisible()

  await mainWindow.locator('.calendar-filterbar button[data-project-id="ssd"]').dragTo(mainWindow.locator(`[data-schedule-range-id="${rangeId}"]`))
  const createDialog = mainWindow.getByRole('dialog', { name: '新建排期' })
  await expect(createDialog).toBeVisible()
  await expect(createDialog.getByLabel('关联项目（可选）')).toHaveValue('ssd')
  await createDialog.getByRole('button', { name: '关闭' }).click()

  const endHandle = mainWindow.getByRole('button', { name: '调整键盘调整跨天排期结束日期' })
  await endHandle.focus()
  await endHandle.press('ArrowRight')
  await endHandle.press('ArrowRight')
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === id)?.endAt?.slice(0, 10)
  }, rangeId)).toBe('2026-07-20')
  await expect.poll(() => mainWindow.evaluate((id) => {
    const active = (globalThis as unknown as { document: { activeElement: { getAttribute(name: string): string | null } | null } }).document.activeElement
    return (active?.getAttribute('data-schedule-resize-id') === id && active.getAttribute('data-resize-edge') === 'end') || active?.getAttribute('data-schedule-focus-id') === id
  }, rangeId)).toBe(true)
})

test('月视图把结束日期向下拖到下一周对应日期', async () => {
  const rangeId = await mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.createSchedule({
      projectId: null,
      colorToken: 'project-7',
      title: '跨周整理琐事',
      actionType: 'overview',
      startAt: '2026-07-22T09:00:00+08:00',
      endAt: '2026-07-24T09:00:00+08:00',
      scheduleKind: 'plan',
      waitingFor: null
    })).id
  })
  const handle = mainWindow.getByRole('button', { name: '调整跨周整理琐事结束日期' })
  const target = mainWindow.locator('[data-calendar-date="2026-07-29"]')
  const [handleBox, targetBox] = await Promise.all([handle.boundingBox(), target.boundingBox()])
  expect(handleBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await mainWindow.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 })
  await mainWindow.mouse.up()
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((item) => item.id === id)?.endAt?.slice(0, 10)
  }, rangeId)).toBe('2026-07-29')
})

test('周视图把未被跨天排期占用的单日事项压回第一行', async () => {
  const fixture = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const range = await api.createSchedule({
      projectId: 'ssd',
      title: '周初连续制作',
      actionType: 'shooting',
      startAt: '2026-07-13T09:00:00+08:00',
      endAt: '2026-07-16T09:00:00+08:00',
      scheduleKind: 'plan',
      waitingFor: null
    })
    const single = await api.createSchedule({
      projectId: 'ssd',
      title: '周五独立整理',
      actionType: 'materials',
      startAt: '2026-07-17T09:00:00+08:00',
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    const target = await api.createSchedule({
      projectId: 'ssd',
      title: '周六目标日',
      actionType: 'overview',
      startAt: '2026-07-18T18:00:00+08:00',
      endAt: null,
      scheduleKind: 'hard_deadline',
      waitingFor: null
    })
    return { rangeId: range.id, singleId: single.id, targetId: target.id }
  })

  await mainWindow.getByRole('button', { name: '周', exact: true }).click()
  await mainWindow.locator('.calendar-filterbar button[data-project-id="ssd"]').click()
  const range = mainWindow.locator(`[data-schedule-range-id="${fixture.rangeId}"]`)
  const single = mainWindow.locator(`[data-schedule-focus-id="${fixture.singleId}"]`)
  const target = mainWindow.locator(`[data-project-target-id="${fixture.targetId}"]`)
  await expect(range).toBeVisible()
  await expect(single).toBeVisible()
  await expect(target).toBeVisible()
  await expect(range.locator('.lucide-calendar-days')).toHaveCount(0)
  await expect.poll(async () => {
    const [targetBox, singleBox] = await Promise.all([target.boundingBox(), single.boundingBox()])
    return targetBox && singleBox ? { target: targetBox.height, schedule: singleBox.height } : null
  }).toEqual({ target: 25, schedule: 25 })
  await expect.poll(async () => {
    const [rangeBox, singleBox] = await Promise.all([range.boundingBox(), single.boundingBox()])
    return rangeBox && singleBox ? Math.abs(rangeBox.y - singleBox.y) : null
  }).toBeLessThanOrEqual(2)
  await expect.poll(() => mainWindow.getByLabel('2026-07-17排期区').locator('.week-events').evaluate((element) => {
    const style = (globalThis as unknown as { getComputedStyle(node: unknown): { marginTop: string; paddingTop: string } }).getComputedStyle(element)
    return { marginTop: style.marginTop, paddingTop: style.paddingTop }
  })).toEqual({ marginTop: '0px', paddingTop: '9px' })
})

test('R5d单日胶囊右边缘可拖成跨天排期并撤销', async () => {
  const scheduleId = await mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.createSchedule({
      projectId: 'ai-browser',
      title: '单日可延长',
      actionType: 'shooting',
      startAt: '2026-07-15T09:00:00+08:00',
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })).id
  })

  await dragResizeHandle(mainWindow.getByRole('button', { name: '调整单日可延长结束日期' }), 2, async () => {
    await expect(mainWindow.locator(`[data-schedule-range-id="${scheduleId}"]`)).toHaveCount(1)
  })
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    const item = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((entry) => entry.id === id)
    return item?.endAt?.slice(0, 10) ?? null
  }, scheduleId)).toBe('2026-07-17')
  await expect(mainWindow.locator(`[data-schedule-range-id="${scheduleId}"]`)).toHaveCount(1)

  await mainWindow.getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => mainWindow.evaluate(async (id) => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules.find((entry) => entry.id === id)?.endAt ?? null
  }, scheduleId)).toBeNull()
})

test('项目可从收件箱整体拖入，发布统一黑色并与同日目标旗帜合并', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.createSchedule({
      projectId: 'ai-browser',
      title: '整项目拖拽入口',
      actionType: 'outline',
      startAt: null,
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    await api.createSchedule({
      projectId: 'ai-browser',
      title: '正式发布',
      actionType: 'publishing',
      startAt: '2026-07-16T18:00:00+08:00',
      endAt: null,
      scheduleKind: 'publish_date',
      waitingFor: null
    })
    await api.createSchedule({
      projectId: 'ai-browser',
      title: '目标日',
      actionType: 'overview',
      startAt: '2026-07-16T18:00:00+08:00',
      endAt: null,
      scheduleKind: 'hard_deadline',
      waitingFor: null
    })
  })

  const targetDate = mainWindow.getByLabel('2026-07-16排期区')
  const publishing = targetDate.locator('.schedule-pill.publishing')
  await expect(publishing).toBeVisible()
  await expect(publishing.locator('.schedule-attached-target')).toBeVisible()
  await expect(targetDate.locator('.project-target-marker')).toHaveCount(0)
  await expect(publishing).toHaveCSS('background-color', 'rgb(36, 36, 33)')

  const group = mainWindow.locator('.unscheduled-project-group').filter({ hasText: 'AI浏览器入门教学' })
  const projectHandle = group.getByRole('button', { name: '拖拽整个项目AI浏览器入门教学' })
  const projectDropTarget = mainWindow.getByLabel('2026-07-15排期区')
  const dataTransfer = await mainWindow.evaluateHandle(() => new (globalThis as unknown as { DataTransfer: new () => unknown }).DataTransfer())
  await projectHandle.dispatchEvent('dragstart', { dataTransfer })
  await projectDropTarget.dispatchEvent('dragover', { dataTransfer })
  await projectDropTarget.dispatchEvent('drop', { dataTransfer })
  await expect.poll(() => mainWindow.evaluate(async () => {
    return (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).schedules
      .filter((item) => item.projectId === 'ai-browser' && item.actionType === 'overview' && item.scheduleKind === 'plan')
      .map((item) => item.startAt?.slice(0, 10) ?? null)
  })).toContain('2026-07-15')
})
