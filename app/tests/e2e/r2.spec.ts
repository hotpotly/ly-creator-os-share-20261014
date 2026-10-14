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

async function setRoute(hash: string): Promise<void> {
  await mainWindow.evaluate((nextHash) => { (globalThis as unknown as BrowserGlobals).location.hash = nextHash }, hash)
}

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

test('R2首页三项摘要分别深链到灵感库队列', async () => {
  for (const [label, queue, facet] of [
    ['新记录', 'inbox', '收件箱'],
    ['待我确认', 'review', '待我确认'],
    ['今日已自动处理', 'processed', '已自动处理']
  ] as const) {
    await setRoute('#/home')
    const summary = mainWindow.getByRole('region', { name: '选题与灵感' })
    await summary.getByRole('button', { name: new RegExp(label) }).click()
    await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).location.hash)).toContain(`queue=${queue}`)
    await expect(mainWindow.locator('.inspiration-facets').getByRole('button', { name: new RegExp(facet) })).toHaveClass(/active/)
  }
})

test('R2内容项目和商务台账使用紧凑可选筛选工具栏', async () => {
  await setRoute('#/projects')
  await mainWindow.getByLabel('筛选内容方向').selectOption('type-ai')
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).location.hash)).toContain('type=type-ai')
  await expect(mainWindow.locator('.project-table article')).toHaveCount(1)
  await expect(mainWindow.locator('.project-table article').first()).toContainText('AI')
  await expect(mainWindow.locator('.project-toolbar > *')).toHaveCount(4)

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS!.saveBusinessRecord('sponsor', {
      orderPlatform: '花火',
      orderDate: '2026-07-20',
      revenueMonth: '2026-06',
      quotedAmountCents: 7_000_000,
      platformOrderAmountCents: 6_800_000,
      finalRebateRatePercent: null,
      finalRebateAmountCents: null,
      rebateRequirement: 'not_required',
      rebateRecipientType: 'unknown',
      rebateRecipientName: '',
      rebateProcedureStatus: 'not_required',
      plannedRebateDate: null,
      paymentStatus: 'received',
      paymentReceivedDate: '2026-06-18',
      invoiceRequirement: 'not_required',
      videoProductionCostCents: 0,
      trafficPromotionCostCents: 0,
      incomeAttributionDate: '2026-06-18',
      notes: ''
    })
  })
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await setRoute('#/business')
  const timeRange = mainWindow.getByLabel('时间范围')
  await expect(timeRange).toHaveValue('year')
  await timeRange.selectOption('all')
  await expect(mainWindow.getByLabel('自定义开始日期')).toHaveCount(0)
  await timeRange.selectOption('custom')
  await mainWindow.getByLabel('自定义开始日期').fill('2026-06-01')
  await mainWindow.getByLabel('自定义结束日期').fill('2026-06-30')
  await expect(mainWindow.locator('.business-ledger-result-count')).toHaveText('1条商务记录')
})

test('内容项目列表可直接修改方向、主平台并按截止时间排列', async () => {
  await setRoute('#/projects')
  const row = mainWindow.locator('.project-table article').filter({ hasText: 'AI浏览器入门教学' })
  await expect(mainWindow.locator('.project-table-head')).toContainText('当前阶段')
  await expect(mainWindow.locator('.project-table-head')).not.toContainText('下一步动作')

  await row.getByRole('button', { name: /更改AI浏览器入门教学的内容方向/ }).click()
  const directionMenu = mainWindow.getByRole('menu', { name: '更改内容方向' })
  await directionMenu.getByRole('menuitemradio', { name: '数码' }).click()
  await expect(row.getByRole('button', { name: /内容方向，当前为数码/ })).toBeVisible()

  await row.getByRole('button', { name: '更改AI浏览器入门教学的发布平台' }).click()
  const platformMenu = mainWindow.getByRole('group', { name: '发布平台' })
  await platformMenu.getByRole('button', { name: 'YouTube', exact: true }).click()
  await platformMenu.getByRole('button', { name: 'YouTube设为主平台' }).click()
  await expect(row.locator('.project-platform-summary')).toContainText('YouTube')
  await expect(row.locator('.project-primary-platform-dot')).toHaveCount(1)
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.find((project) => project.id === 'ai-browser')?.platformTargets[0])).toBe('YouTube')

  await mainWindow.getByRole('button', { name: '按目标日升序排列' }).click()
  await expect(mainWindow.locator('.project-table-header-cell[aria-sort="ascending"]')).toContainText('目标日')
  const deadlineLabels = await mainWindow.locator('.project-table article .project-list-link-cell').evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''))
  const datedLabels = deadlineLabels.filter((value) => value !== '未设置')
  expect(datedLabels).toEqual([...datedLabels].sort((left, right) => {
    const [leftMonth, leftDay] = left.split('/').map(Number)
    const [rightMonth, rightDay] = right.split('/').map(Number)
    return (leftMonth! * 32 + leftDay!) - (rightMonth! * 32 + rightDay!)
  }))

  const stageButton = row.locator('.project-stage-link')
  await expect(stageButton).not.toHaveText(/筹备|制作/)
  await stageButton.click()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).location.hash)).toMatch(/^#\/project\/ai-browser\/(materials|outline|script|production|postproduction|publishing|versions)$/)
})

test('R2选题名称首列冻结且新建弹窗默认展开全部字段', async () => {
  await setRoute('#/topics')
  const wrap = mainWindow.locator('.topic-table-wrap')
  const firstTitleCell = mainWindow.locator('.topic-title-cell').first()
  const initialX = (await firstTitleCell.boundingBox())!.x
  await wrap.evaluate((element) => { element.scrollLeft = 560 })
  const scrolledX = (await firstTitleCell.boundingBox())!.x
  expect(Math.abs(scrolledX - initialX)).toBeLessThanOrEqual(1)
  await expect(firstTitleCell).toBeVisible()

  await mainWindow.locator('.topbar').getByRole('button', { name: '新建选题', exact: true }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建选题' })
  await expect(dialog.getByRole('group', { name: '内容方向' })).toBeVisible()
  await expect(dialog.getByRole('group', { name: '选题阶段' })).toBeVisible()
  await expect(dialog.getByText('重要程度', { exact: true })).toBeVisible()
  await expect(dialog.getByText('开始时间', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /展开修改|收起/ })).toHaveCount(0)
})

test('R2项目面包屑补齐层级且配乐预留不受项目选择拦截', async () => {
  await setRoute('#/project/ios/overview')
  await expect(mainWindow.locator('.breadcrumb')).toHaveText('工作区 / 内容项目 / iOS 27第一周体验')
  await mainWindow.locator('.breadcrumb').getByRole('button', { name: '内容项目' }).click()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).location.hash)).toBe('#/projects')

  await setRoute('#/tools')
  const music = mainWindow.locator('.tool-card').filter({ hasText: '配乐与音效' })
  await music.getByRole('button', { name: '查看规划' }).click()
  await expect(mainWindow.getByRole('status')).toHaveText('配乐与音效是额外创作工具，将在后续阶段接通')
})

test('R11内容项目列可排序管理，截止时间使用紧凑日历并同步同一排期记录', async () => {
  await setRoute('#/projects')
  const table = mainWindow.getByLabel('内容项目列表')
  await expect(table.locator('.project-table-head')).toContainText('目标日')
  const row = table.locator('article').filter({ hasText: 'AI浏览器入门教学' })
  expect((await row.locator('.project-property-button').allInnerTexts()).join('')).not.toMatch(/更改|选择/)
  const rowBox = await row.boundingBox()
  expect(rowBox).not.toBeNull()
  await row.click({ button: 'right', position: { x: 96, y: 30 } })
  const contextMenu = mainWindow.getByRole('menu', { name: /AI浏览器入门教学的操作/ })
  const menuBox = await contextMenu.boundingBox()
  expect(menuBox).not.toBeNull()
  expect(Math.abs(menuBox!.x - (rowBox!.x + 96))).toBeLessThanOrEqual(4)
  expect(Math.abs(menuBox!.y - (rowBox!.y + 35))).toBeLessThanOrEqual(4)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/feedback-project-context-menu.png') })
  }
  await contextMenu.press('Escape')

  await mainWindow.getByRole('button', { name: '管理列' }).click()
  const manager = mainWindow.getByRole('dialog', { name: '管理内容项目列' })
  await manager.getByRole('button', { name: '项目模板', exact: true }).click()
  await expect(table.locator('.project-table-head')).toContainText('项目模板')
  await expect(table.getByRole('separator', { name: '拖拽调整项目模板列宽' })).toBeVisible()
  await manager.getByRole('button', { name: '关闭列管理' }).click()

  await row.getByRole('button', { name: /修改AI浏览器入门教学的目标日/ }).click()
  const deadlineEditor = mainWindow.getByRole('dialog', { name: '更改项目目标日' })
  await expect(deadlineEditor.getByRole('grid', { name: '目标日日历' })).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/feedback-project-deadline-picker.png') })
  }
  await deadlineEditor.getByRole('gridcell', { name: /选择2026年7月30日/ }).click()
  await expect(row.getByRole('button', { name: /修改AI浏览器入门教学的目标日/ })).toContainText('7/30')
  const synchronized = await mainWindow.evaluate(async () => {
    const workspace = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
    return workspace.schedules.filter((item) => item.projectId === 'ai-browser' && item.actionType === 'overview' && item.scheduleKind === 'hard_deadline')
  })
  expect(synchronized).toHaveLength(1)
  expect(synchronized[0]).toMatchObject({ source: 'synchronized' })
})

test('R2暗色选题空值使用次级文本对比度', async () => {
  await setRoute('#/topics')
  await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
  const colors = await mainWindow.locator('.topic-variance.on-time').filter({ hasText: '—' }).first().evaluate((element) => {
    const browser = globalThis as unknown as {
      document: { documentElement: unknown }
      getComputedStyle(node: unknown): { color: string; getPropertyValue(name: string): string }
    }
    const style = browser.getComputedStyle(element)
    return { color: style.color, secondary: browser.getComputedStyle(browser.document.documentElement).getPropertyValue('--secondary').trim() }
  })
  expect(colors.color).toBe('rgb(160, 160, 160)')
  expect(colors.secondary).toBe('#a0a0a0')
})


test('R10e项目列表空描述不占行，真实描述和打开入口保留', async () => {
  const describedId = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    for (const [title, description] of [['空描述项目', ''], ['空白描述项目', '   ']]) {
      await api.createProject({ title: title!, description: description!, contentTypeId: 'type-ai', platformTargets: ['B站'], colorToken: 'project-2' })
    }
    return (await api.createProject({ title: '有描述项目', description: '保留我写的真实描述', contentTypeId: 'type-ai', platformTargets: ['B站'], colorToken: 'project-3' })).id
  })
  await setRoute('#/projects')
  for (const style of ['warm', 'feishu']) for (const theme of ['light', 'dark']) {
    await mainWindow.evaluate(({ style, theme }) => { document.documentElement.dataset.visualStyle = style; document.documentElement.dataset.theme = theme }, { style, theme })
    for (const title of ['空描述项目', '空白描述项目']) {
      const cell = mainWindow.locator('.project-cell-title').filter({ has: mainWindow.getByText(title, { exact: true }) })
      await expect(cell.locator('button > b')).toHaveText(title)
      await expect(cell.locator('button > span')).toHaveCount(0)
      await expect(cell.locator('.project-color-dot')).toBeVisible()
      await expect(cell.locator('button')).toBeInViewport()
    }
    await expect(mainWindow.getByText('尚未填写项目描述', { exact: true })).toHaveCount(0)
    const described = mainWindow.locator('.project-cell-title').filter({ has: mainWindow.getByText('有描述项目', { exact: true }) })
    await expect(described.locator('button > span')).toHaveText('保留我写的真实描述')
  }
  await mainWindow.locator('.project-cell-title').filter({ has: mainWindow.getByText('有描述项目', { exact: true }) }).getByRole('button').click()
  await expect.poll(() => mainWindow.evaluate(() => location.hash)).toContain(`/project/${describedId}/`)
})
