import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi }
let app: ElectronApplication, page: Page

test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_TEST_DATE: '2026-09-21', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-21T15:00:00', CREATOR_OS_TEST_TIME_ZONE: 'Asia/Shanghai', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  page = await app.firstWindow()
  await expect.poll(() => page.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
})
test.afterEach(async () => { await app?.close() })
async function seed(missingStart = false): Promise<{ projectId: string; scheduleId: string }> {
  return page.evaluate(async (missingStart) => {
    const api = (globalThis as Globals).creatorOS
    const project = await api.createProject({ title: 'R21ac阶段复盘', description: '', contentTypeId: 'type-digital', colorToken: 'project-4', platformTargets: ['B站'] })
    await api.setProjectModule(project.id, 'editing', true)
    const schedule = await api.createSchedule({ projectId: project.id, actionType: 'editing', title: '剪辑计划', startAt: '2026-09-10T09:00:00+08:00', endAt: '2026-09-12T17:00:00+08:00', scheduleKind: 'plan', waitingFor: null })
    await api.moveSchedule(schedule.id, '2026-09-11T09:00:00+08:00', '2026-09-13T17:00:00+08:00')
    const todos = await api.createTodoBatch([
      { title: '粗剪（4）', projectId: project.id, stageKey: 'editing', plannedDate: '2026-09-11', segment: null, category: 'self_media', trackingMode: 'checklist', progress: 0 },
      { title: '精剪（2）', projectId: project.id, stageKey: 'editing', plannedDate: '2026-09-12', segment: null, category: 'self_media', trackingMode: 'checklist', progress: 0 },
      { title: '返修', projectId: project.id, stageKey: 'editing', plannedDate: null, segment: null, category: 'self_media', trackingMode: 'checklist', progress: 0 }
    ])
    await api.updateTodo(todos[0]!.id, { completed: true })
    await api.updateStageTime(project.id, 'editing', { startedAt: missingStart ? null : { localDate: '2026-09-11', segment: 'morning' }, completedAt: { localDate: '2026-09-13', segment: 'afternoon' }, source: 'backfill' })
    location.hash = `#/reports?mode=project&project=${project.id}`
    return { projectId: project.id, scheduleId: schedule.id }
  }, missingStart)
}

test('R21ac compares original and current starts/finishes and preserves original after deletion', async () => {
  const ids = await seed()
  await expect(page.getByRole('heading', { name: '阶段起止偏差' })).toBeVisible()
  const comparison = page.getByRole('region', { name: '剪辑起止偏差' })
  await expect(comparison).toContainText('原计划（首次保存）')
  await expect(comparison).toContainText('开始：延迟1天')
  await expect(comparison).toContainText('完成：延迟1天')
  await expect(comparison).toContainText('开始：按计划开始')
  await expect(comparison).toContainText('完成：按期')
  await expect(page.locator('.project-review-metrics')).toContainText('已完成条目预计4小时')
  await expect(page.locator('.report-stage-estimates')).toContainText('待办预计：6小时')
  await expect(page.locator('.report-stage-estimates')).toContainText('1条未填')
  await expect(page.locator('.report-optional-effort')).not.toHaveAttribute('open', '')
  await expect(page.locator('.project-review-gaps')).not.toContainText('投入')
  await page.evaluate(async id => (globalThis as Globals).creatorOS.deleteSchedule(id), ids.scheduleId)
  await expect(comparison).toContainText('开始：延迟1天')
  await expect(page.locator('.project-review-timeline')).toContainText('当前排期未设置')
  const review = await page.evaluate(async id => (globalThis as Globals).creatorOS.getProjectCreationReview(id), ids.projectId)
  expect(review.stages.find(s => s.stageKey === 'editing')).toMatchObject({ plannedStartAt: null, baseline: { startVarianceSegments: 3, varianceSegments: 3 }, actualEffortHalfDayUnits: null })
})

test('R21ac completion without start is visible as a point and estimates never require dates or effort', async () => {
  await seed(true)
  const timeline = page.getByRole('list', { name: '项目计划与实际时间线' }).getByRole('listitem').filter({ hasText: '剪辑' })
  await expect(timeline).toContainText('已完成于9月13日下午，开始时间未记录')
  await expect(timeline).not.toContainText('未开始')
  await expect(timeline.locator('i.actual.point')).toHaveCount(1)
  await expect(page.getByRole('region', { name: '剪辑起止偏差' })).toContainText('开始：—')
  await expect(page.locator('.project-review-metrics')).toContainText('已完成条目预计4小时')
  await page.locator('.report-optional-effort > summary').click()
  await expect(page.locator('.report-optional-effort')).toContainText('不填写也可复盘')
})

test('R21ac original/current/actual fits four themes and narrow layout without forcing manual effort', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await seed(true)
  await expect(page.getByRole('heading', { name: '阶段起止偏差' })).toBeVisible()
  for (const width of [1280, 880]) {
    await page.setViewportSize({ width, height: 900 })
    for (const style of ['warm-gray-green', 'feishu']) for (const theme of ['light', 'dark']) {
      await page.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
      const geometry = await page.locator('.project-review-timeline, .report-plan-comparisons, .project-review-metrics').evaluateAll(elements => elements.map(el => ({ client: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, viewport: innerWidth })))
      for (const box of geometry) { expect(box.scroll).toBeLessThanOrEqual(box.client + 1); expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(box.viewport + 1) }
      await expect(page.locator('.project-review-gaps')).not.toContainText('实际投入')
      if (width === 880 && style === 'feishu') {
        await page.locator('.project-review-timeline').screenshot({ path: info.outputPath(`review-${theme}.png`) })
        await page.locator('.report-plan-comparisons').screenshot({ path: info.outputPath(`comparison-${theme}.png`) })
        await page.locator('.project-review-metrics').screenshot({ path: info.outputPath(`summary-${theme}.png`) })
      }
    }
  }
})
