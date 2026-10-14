import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
  document: { documentElement: { clientWidth: number; scrollWidth: number } }
}

let electronApp: ElectronApplication
let mainWindow: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'], cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.projects.length) ?? 0)).toBeGreaterThan(0)
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

async function openBusinessPage(): Promise<void> {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/business' })
  await expect(mainWindow.getByRole('region', { name: '商单收入列表' })).toBeVisible()
}

async function openDirectBusinessEditor(): Promise<ReturnType<Page['getByRole']>> {
  await mainWindow.getByRole('button', { name: /新建商单/ }).click()
  await mainWindow.getByRole('button', { name: '直接补加 不创建内容项目' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '直接补加商单' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('可连续补加商单、筛选、调整列宽，并从商单收入回收站恢复', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await openBusinessPage()
  const dialog = await openDirectBusinessEditor()
  await dialog.getByLabel('商单名称').fill('2026年历史合作')
  await dialog.getByLabel('商单状态').selectOption('ordered')
  await dialog.getByLabel('下单平台').selectOption('B站')
  await dialog.getByLabel('收益月份·可单独填写').fill('2026-03')
  await dialog.getByLabel('商单金额').fill('¥61,200')
  await dialog.getByRole('group', { name: '回款状态' }).getByRole('button', { name: '已回款' }).click()
  await dialog.getByRole('button', { name: '无需返点' }).click()
  await dialog.getByRole('button', { name: '无需', exact: true }).click()
  await dialog.getByRole('button', { name: '保存并继续新增' }).click()
  await expect(dialog.getByLabel('商单名称')).toHaveValue('')
  await expect(dialog.getByLabel('下单平台')).toHaveValue('B站')
  await expect(dialog.getByLabel('收益月份·可单独填写')).toHaveValue('2026-03')
  await dialog.getByLabel('商单名称').fill('第二笔历史合作')
  await dialog.getByLabel('商单状态').selectOption('ordered')
  await dialog.getByLabel('下单日期·可不填').fill('2026-01-15')
  await dialog.getByLabel('商单金额').fill('10000')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const agreedDialog = await openDirectBusinessEditor()
  await agreedDialog.getByLabel('商单名称').fill('已谈妥合作')
  await agreedDialog.getByLabel('商单状态').selectOption('agreed_pending_order')
  await agreedDialog.getByLabel('下单平台').selectOption('B站')
  await agreedDialog.getByLabel('收益月份·可单独填写').fill('2026-03')
  await agreedDialog.getByLabel('商单金额').fill('20000')
  await agreedDialog.getByRole('button', { name: '无需返点' }).click()
  await agreedDialog.getByRole('button', { name: '无需', exact: true }).click()
  await agreedDialog.getByRole('button', { name: '保存', exact: true }).click()

  const list = mainWindow.getByRole('region', { name: '商单收入列表' })
  const summary = mainWindow.locator('.business-ledger-summary')
  await expect(summary).toContainText('实际净收入')
  await expect(summary).not.toContainText('商单总额')
  await expect(summary.locator('.actual-net')).toContainText('¥61,200.00')
  await expect(summary.getByText('预计净收入').locator('..')).toContainText('¥81,200.00')
  await expect(summary.getByText('预计净收入').locator('..')).toContainText('仅汇总2/3笔；另1笔净额待确认（含已谈妥）')
  await expect(summary).toHaveClass(/card/)
  const actualCard = summary.locator('article').first()
  const expectedCard = summary.locator('article').nth(1)
  expect(await actualCard.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor))
    .toBe(await expectedCard.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor))
  expect(await actualCard.locator('span').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).color))
    .not.toBe(await expectedCard.locator('span').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).color))
  expect(Number.parseInt(await actualCard.locator('b').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).fontWeight), 10))
    .toBeGreaterThan(Number.parseInt(await expectedCard.locator('b').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).fontWeight), 10))
  await expect(list.locator('.business-ledger-row[role="group"]').first()).toContainText('第二笔历史合作')
  await list.getByRole('button', { name: '下单日期', exact: true }).click()
  await expect(list.locator('.business-ledger-row[role="group"]').first()).toContainText('2026年历史合作')
  await expect(list.getByRole('group', { name: '2026年历史合作收入记录' })).toContainText('独立台账')
  await list.getByLabel('2026年历史合作更多操作').click()
  await list.getByLabel('第二笔历史合作更多操作').click()
  await expect(list.locator('.business-row-menu[open]')).toHaveCount(1)
  await list.getByRole('button', { name: '手动标记已结清' }).click()
  await expect(list.getByRole('group', { name: '第二笔历史合作收入记录' })).toContainText('已结清')
  await expect(list.getByRole('group', { name: '第二笔历史合作收入记录' })).not.toContainText('手动')
  await mainWindow.getByLabel('筛选平台').selectOption('B站')
  await expect(mainWindow.locator('.business-ledger-result-count')).toHaveText('3条商务记录')

  const ledgerHead = mainWindow.locator('.business-ledger-head')
  const firstColumnBefore = await ledgerHead.locator(':scope > span').first().boundingBox()
  const firstResizer = ledgerHead.getByRole('button', { name: '调整商务记录列宽' })
  const resizerBox = await firstResizer.boundingBox()
  expect(firstColumnBefore).not.toBeNull()
  expect(resizerBox).not.toBeNull()
  await mainWindow.mouse.move(resizerBox!.x + 2, resizerBox!.y + resizerBox!.height / 2)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(resizerBox!.x + 52, resizerBox!.y + resizerBox!.height / 2)
  await mainWindow.mouse.up()
  await expect.poll(async () => (await ledgerHead.locator(':scope > span').first().boundingBox())?.width ?? 0).toBeGreaterThan(firstColumnBefore!.width + 35)
  expect(await mainWindow.evaluate(() => localStorage.getItem('ly.creator-os.business-ledger-columns-v3'))).toContain('"record"')

  await list.getByRole('button', { name: '2026年历史合作商单收入详情', exact: true }).click()
  const detail = mainWindow.getByRole('dialog', { name: '商单收入详情' })
  await expect(detail).toContainText('预计净收入')
  await expect(detail).toContainText('已结清')
  await detail.getByRole('button', { name: '移入回收站' }).click()
  await mainWindow.getByRole('dialog', { name: '删除商单收入' }).getByRole('button', { name: '确认删除' }).click()
  await expect(list.getByRole('button', { name: '2026年历史合作商单收入详情', exact: true })).toHaveCount(0)
  await mainWindow.getByRole('main').getByRole('button', { name: '回收站' }).click()
  const trash = mainWindow.getByRole('dialog', { name: '商单收入回收站' })
  await expect(trash).toContainText('2026年历史合作')
  await trash.getByRole('button', { name: '恢复' }).first().click()
  await expect(trash).not.toContainText('2026年历史合作')
  await mainWindow.screenshot({ path: testInfo.outputPath('business-ledger-r24.png'), fullPage: true })

  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(720, 720) })
  await expect.poll(() => mainWindow.evaluate(() => {
    const root = (globalThis as unknown as BrowserGlobals).document.documentElement
    return root.scrollWidth - root.clientWidth
  })).toBeLessThanOrEqual(1)
})

test('收入台账隐私锁可在设置开启、密码解锁并再次关闭', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '数据与设备' }).click()
  const privacy = mainWindow.locator('.business-ledger-privacy-settings')
  await privacy.getByRole('button', { name: '已关闭' }).click()
  const enableDialog = mainWindow.getByRole('dialog', { name: '开启收入台账隐私锁' })
  await enableDialog.getByLabel('设置密码').fill('ledger-2026')
  await enableDialog.getByLabel('再次输入').fill('ledger-2026')
  await enableDialog.getByRole('button', { name: '开启', exact: true }).click()
  await expect(privacy.getByRole('button', { name: '已开启' })).toBeVisible()

  await mainWindow.evaluate(async () => {
    const global = globalThis as unknown as BrowserGlobals
    await global.creatorOS!.lockBusinessLedger()
    global.location.hash = '#/business'
  })
  const locked = mainWindow.getByRole('region', { name: '收入台账已锁定' })
  await locked.getByLabel('收入台账密码').fill('wrong-password')
  await locked.getByRole('button', { name: '解锁' }).click()
  await expect(locked.getByRole('alert')).toContainText('密码不正确')
  await locked.getByLabel('收入台账密码').fill('ledger-2026')
  await locked.getByRole('button', { name: '解锁' }).click()
  await expect(mainWindow.getByRole('region', { name: '商单收入列表' })).toBeVisible()

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/settings' })
  await mainWindow.getByRole('button', { name: '当前设置分类：通用' }).click()
  await mainWindow.getByRole('menuitemradio', { name: '数据与设备' }).click()
  const privacyAgain = mainWindow.locator('.business-ledger-privacy-settings')
  await privacyAgain.getByRole('button', { name: '已开启' }).click()
  const disableDialog = mainWindow.getByRole('dialog', { name: '关闭收入台账隐私锁' })
  await disableDialog.getByLabel('当前密码').fill('ledger-2026')
  await disableDialog.getByRole('button', { name: '关闭隐私锁' }).click()
  await expect(privacyAgain.getByRole('button', { name: '已关闭' })).toBeVisible()
})

test('B站花火表格可预览导入，两笔商单可共用同一张返点发票', async () => {
  await openBusinessPage()
  await mainWindow.getByRole('button', { name: '智能导入' }).click()
  const batch = mainWindow.getByRole('dialog', { name: '智能导入' })
  await batch.getByLabel('默认收益月份').fill('2026-03')
  await batch.getByLabel('粘贴表格或合作文字').fill([
    '订单名称\t订单收益\t收益月份\t账单状态\t订单号',
    '花火商单A\t61200\t2026-03\t已结算\tA-001',
    '花火商单B\t49000\t2026-03\t待结算\tB-002'
  ].join('\n'))
  await batch.getByRole('button', { name: '生成预览' }).click()
  await expect(batch).toContainText('2条将写入')
  await batch.getByRole('button', { name: '导入2条' }).click()

  const list = mainWindow.getByRole('region', { name: '商单收入列表' })
  for (const title of ['花火商单A', '花火商单B']) {
    await list.getByRole('button', { name: `${title}商单收入详情`, exact: true }).click()
    const editor = mainWindow.getByRole('dialog', { name: '商单收入详情' })
    await editor.getByRole('button', { name: '需要返点' }).click()
    await editor.getByLabel('返点比例').fill('10')
    await editor.getByRole('button', { name: '需要对方开' }).click()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
  }

  await list.getByRole('button', { name: '花火商单A商单收入详情', exact: true }).click()
  await mainWindow.getByRole('dialog', { name: '商单收入详情' }).getByRole('button', { name: '新增或共用' }).click()
  const invoice = mainWindow.getByRole('dialog', { name: '返点发票' })
  await invoice.getByLabel('返点方').fill('返点服务商')
  await invoice.getByLabel('发票金额').fill('11020')
  await invoice.getByLabel('开票日期').fill('2026-03-25')
  await invoice.getByLabel('关联商单花火商单B').check()
  await invoice.getByRole('button', { name: '保存并标记已收到' }).click()

  const workspace = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace())
  const first = workspace.businessLedger.find((entry) => entry.projectTitle === '花火商单A')!
  const second = workspace.businessLedger.find((entry) => entry.projectTitle === '花火商单B')!
  expect(first).toMatchObject({ orderPlatform: 'B站', revenueMonth: '2026-03', invoiceExecutionStatus: 'issued' })
  expect(second).toMatchObject({ orderPlatform: 'B站', revenueMonth: '2026-03', invoiceExecutionStatus: 'issued' })
  const firstData = await mainWindow.evaluate(async (projectId) => (globalThis as unknown as BrowserGlobals).creatorOS!.getBusinessProjectData(projectId), first.projectId)
  const secondData = await mainWindow.evaluate(async (projectId) => (globalThis as unknown as BrowserGlobals).creatorOS!.getBusinessProjectData(projectId), second.projectId)
  expect(firstData.invoices[0]).toMatchObject({ issuerName: '返点服务商', sharedProjectCount: 2 })
  expect(secondData.invoices[0]?.id).toBe(firstData.invoices[0]?.id)
})

test('新建商单项目自动进入待下单台账，并可在统一弹窗改为已下单', async () => {
  const projectId = await mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.createProject({
      title: '自动生成商务记录', description: '', contentTypeId: 'type-commercial',
      templateId: 'template-commercial', colorToken: 'project-5', platformTargets: ['小红书']
    })
    return project.id
  })
  await openBusinessPage()
  const row = mainWindow.getByRole('region', { name: '商单收入列表' }).getByRole('button', { name: '自动生成商务记录商单收入详情', exact: true })
  await expect(mainWindow.getByRole('group', { name: '自动生成商务记录收入记录' })).toContainText('已谈妥·待下单')
  await expect(mainWindow.getByRole('group', { name: '自动生成商务记录收入记录' })).toContainText('小红书')
  await row.click()
  const editor = mainWindow.getByRole('dialog', { name: '商单收入详情' })
  await editor.getByLabel('商单状态').selectOption('ordered')
  await editor.getByLabel('商单金额').fill('20000')
  await editor.getByRole('button', { name: '无需返点' }).click()
  await editor.getByRole('button', { name: '需要对方开' }).click()
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  const record = await mainWindow.evaluate(async (id) => (globalThis as unknown as BrowserGlobals).creatorOS!.getBusinessProjectData(id), projectId)
  expect(record.record).toMatchObject({
    dealStatus: 'ordered',
    lifecycleStatus: 'ordered',
    platformOrderAmountCents: 2_000_000,
    rebateRequirement: 'not_required',
    invoiceRequirement: 'required',
    invoiceExecutionStatus: 'pending'
  })
})

test('独立台账可从详情后绑定商单项目，返点发票无需上传也可手动标记已收到', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const targetProjectId = await mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.createProject({
      title: '后绑定目标项目', description: '', contentTypeId: 'type-commercial',
      templateId: 'template-commercial', colorToken: 'project-6', platformTargets: ['B站']
    })
    return project.id
  })
  await openBusinessPage()

  const editor = await openDirectBusinessEditor()
  await editor.getByLabel('商单名称').fill('先填写后绑定商单')
  await editor.getByLabel('商单状态').selectOption('ordered')
  await editor.getByLabel('下单平台').selectOption('B站')
  await editor.getByRole('button', { name: '无需返点' }).click()
  await editor.getByRole('button', { name: '需要对方开' }).click()
  await editor.getByRole('group', { name: '返点发票状态' }).getByRole('button', { name: '已收到' }).click()
  await mainWindow.screenshot({ path: testInfo.outputPath('manual-invoice-received.png') })
  await editor.getByRole('button', { name: '保存', exact: true }).click()

  const list = mainWindow.getByRole('region', { name: '商单收入列表' })
  await list.getByRole('button', { name: '先填写后绑定商单商单收入详情', exact: true }).click()
  let detail = mainWindow.getByRole('dialog', { name: '商单收入详情' })
  await expect(detail.getByRole('group', { name: '返点发票状态' }).getByRole('button', { name: '已收到' })).toHaveAttribute('aria-pressed', 'true')
  await expect(detail).toContainText('已手动标记收到，尚未补录发票信息。')
  await detail.getByRole('button', { name: '关联商单项目' }).click()

  const relink = mainWindow.getByRole('dialog', { name: '关联商单项目' })
  await relink.getByLabel('目标商单项目').selectOption(targetProjectId)
  await mainWindow.screenshot({ path: testInfo.outputPath('post-entry-project-link.png') })
  await relink.getByRole('button', { name: '确认关联' }).click()

  detail = mainWindow.getByRole('dialog', { name: '商单收入详情' })
  await expect(detail).toContainText('后绑定目标项目')
  await expect(detail.getByRole('button', { name: '更换关联项目' })).toBeVisible()
  await expect(detail.getByRole('button', { name: '查看项目' })).toBeVisible()

  const workspace = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace())
  expect(workspace.businessLedger.find((entry) => entry.projectId === targetProjectId)).toMatchObject({
    projectTitle: '后绑定目标项目',
    ledgerOnly: false,
    invoiceExecutionStatus: 'issued',
    invoiceReceivedManuallyAt: expect.any(String)
  })
  expect(workspace.businessLedger.some((entry) => entry.projectTitle === '先填写后绑定商单')).toBe(false)
})

test('商单详情直接编辑、固定位置、未保存保护与发票刷新不覆盖草稿', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await openBusinessPage()
  const create = await openDirectBusinessEditor()
  await create.getByLabel('商单名称').fill('原位编辑商单')
  await create.getByLabel('商单金额').fill('10000')
  await create.getByRole('button', { name: '无需返点' }).click()
  await create.getByRole('button', { name: '需要对方开' }).click()
  await create.getByRole('button', { name: '保存', exact: true }).click()
  const row = mainWindow.getByRole('button', { name: '原位编辑商单商单收入详情', exact: true })
  await row.focus()
  await row.press('Enter')
  const detail = mainWindow.getByRole('dialog', { name: '商单收入详情', exact: true })
  const amount = detail.getByLabel('商单金额')
  await expect(amount).toHaveValue('10000')
  await expect(detail.getByRole('button', { name: '编辑商务信息' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  const beforeData = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const entry = (await api.getWorkspace()).businessLedger.find((item) => item.projectTitle === '原位编辑商单')!
    return api.getBusinessProjectData(entry.projectId)
  })
  await amount.scrollIntoViewIfNeeded()
  const before = await amount.boundingBox()
  await amount.fill('12000')
  expect(await amount.boundingBox()).toEqual(before)
  await expect(detail.locator('.business-editor-calculation')).toContainText('¥12,000.00')
  await amount.press('Escape')
  const guard = mainWindow.getByRole('alertdialog', { name: '收入修改尚未保存' })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: '继续编辑' }).click()
  await expect(amount).toHaveValue('12000')
  await detail.getByRole('button', { name: '取消', exact: true }).click()
  await guard.getByRole('button', { name: '放弃修改' }).click()
  await row.click()
  await expect(amount).toHaveValue('10000')
  const afterDiscard = await mainWindow.evaluate(async (id) => (globalThis as unknown as BrowserGlobals).creatorOS!.getBusinessProjectData(id), beforeData.record.projectId)
  expect(afterDiscard.events.length).toBe(beforeData.events.length)
  await amount.fill('12000')
  await detail.getByLabel('备注', { exact: true }).fill('发票单独保存后这段草稿仍在')
  await detail.getByRole('button', { name: '新增或共用' }).click()
  const invoice = mainWindow.getByRole('dialog', { name: '返点发票', exact: true })
  await invoice.getByLabel('返点方', { exact: true }).fill('原位测试方')
  await invoice.getByLabel('发票金额').fill('100')
  await invoice.getByRole('button', { name: '保存并标记已收到' }).click()
  await expect(invoice).toHaveCount(0)
  await expect(detail.getByRole('group', { name: '返点发票状态' }).getByRole('button', { name: '已收到' })).toHaveAttribute('aria-pressed', 'true')
  await expect(amount).toHaveValue('12000')
  await expect(detail.getByLabel('备注', { exact: true })).toHaveValue('发票单独保存后这段草稿仍在')
  await amount.fill('金额错误')
  await detail.getByRole('button', { name: '保存', exact: true }).click()
  await expect(detail.getByRole('alert')).toContainText('金额格式无效')
  await expect(amount).toHaveValue('金额错误')
  await amount.fill('12000')
  await detail.getByRole('button', { name: '保存', exact: true }).click()
  await expect(detail).toHaveCount(0)
  await row.click()
  await expect(amount).toHaveValue('12000')
  for (const theme of ['light', 'dark']) {
    await mainWindow.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(880, 720) })
    await detail.locator('.business-editor-scroll').evaluate((element) => { element.scrollTop = 0 })
    const geometry = await detail.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, bottom: element.getBoundingClientRect().bottom, height: window.innerHeight }))
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height)
    await expect(detail.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
    await mainWindow.screenshot({ path: testInfo.outputPath(`income-inline-business-${theme}.png`) })
  }
  await detail.getByRole('button', { name: '关闭', exact: true }).click()
  const finalData = await mainWindow.evaluate(async (id) => (globalThis as unknown as BrowserGlobals).creatorOS!.getBusinessProjectData(id), beforeData.record.projectId)
  expect(finalData.record.platformOrderAmountCents).toBe(1_200_000)
  expect(finalData.invoices).toHaveLength(1)
})

test('商单单元格就近修改，标题才打开完整编辑且没有加载弹窗闪烁', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await openBusinessPage()
  const create = await openDirectBusinessEditor()
  await create.getByLabel('商单名称').fill('字段编辑商单')
  await create.getByLabel('商单金额').fill('45000')
  await create.getByLabel('制作成本').fill('15000')
  await create.getByRole('button', { name: '无需返点' }).click()
  await create.getByRole('button', { name: '需要对方开' }).click()
  await create.getByRole('button', { name: '保存', exact: true }).click()
  const row = mainWindow.getByRole('group', { name: '字段编辑商单收入记录', exact: true })
  const amountCell = row.getByRole('button', { name: '字段编辑商单：商单金额', exact: true })
  await amountCell.click()
  const amount = mainWindow.getByRole('dialog', { name: '商单金额快捷修改', exact: true })
  await expect(amount).toBeVisible()
  await expect(mainWindow.getByRole('dialog', { name: '商单收入详情' })).toHaveCount(0)
  await expect(amount.locator('input')).toHaveCount(1)
  await amount.getByLabel('商单金额').fill('46000')
  await amount.getByRole('button', { name: '保存', exact: true }).click()
  await expect(amount).toHaveCount(0)
  await expect(amountCell).toHaveText('¥46,000.00')
  await row.getByRole('button', { name: '字段编辑商单：预计净收入', exact: true }).click()
  const calculation = mainWindow.getByRole('dialog', { name: '预计净收入明细' })
  await expect(calculation).toContainText('¥31,000.00')
  await expect(calculation.locator('input')).toHaveCount(0)
  await calculation.getByRole('button', { name: '关闭单项修改' }).click()
  await row.getByRole('button', { name: '字段编辑商单：回款状态', exact: true }).click()
  await mainWindow.getByRole('dialog', { name: '回款状态快捷修改' }).getByRole('button', { name: '已回款', exact: true }).click()
  await expect(row.getByRole('button', { name: '字段编辑商单：回款状态', exact: true })).toHaveText('已回款')
  await row.getByRole('button', { name: '字段编辑商单：收益月份', exact: true }).click()
  const month = mainWindow.getByRole('dialog', { name: '收益月份快捷修改' })
  await month.getByLabel('收益月份').fill('2026-09')
  await month.getByRole('button', { name: '保存', exact: true }).click()
  await expect(row.getByRole('button', { name: '字段编辑商单：收益月份', exact: true })).toHaveText('2026-09')

  for (const theme of ['light', 'dark']) {
    await mainWindow.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(700, 720) })
    const invoiceCell = row.getByRole('button', { name: '字段编辑商单：返点发票', exact: true })
    await invoiceCell.scrollIntoViewIfNeeded()
    await invoiceCell.click()
    const invoice = mainWindow.getByRole('dialog', { name: '返点发票快捷修改' })
    await expect(invoice).toBeVisible()
    const geometry = await invoice.boundingBox()
    const viewport = await mainWindow.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(geometry!.x).toBeGreaterThanOrEqual(7)
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(viewport.height - 7)
    await mainWindow.screenshot({ path: testInfo.outputPath(`income-cell-business-${theme}.png`) })
    await invoice.getByRole('button', { name: '关闭单项修改' }).press('Escape')
    await expect(invoice).toHaveCount(0)
  }
  await row.getByRole('button', { name: '字段编辑商单：返点发票', exact: true }).click()
  await mainWindow.getByRole('dialog', { name: '返点发票快捷修改' }).getByRole('button', { name: '已收到', exact: true }).click()
  await expect(row.getByRole('button', { name: '字段编辑商单：返点发票', exact: true })).toHaveText('已收返点发票')
  await mainWindow.evaluate(() => {
    const state = globalThis as unknown as { incomeDialogMounts: string[]; incomeObserver: MutationObserver }
    state.incomeDialogMounts = []
    state.incomeObserver = new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) {
        if (!(node instanceof Element)) continue
        const nodes = [...node.querySelectorAll('[role="dialog"]'), ...(node.matches('[role="dialog"]') ? [node] : [])]
        state.incomeDialogMounts.push(...nodes.map((element) => element.getAttribute('aria-label') || ''))
      }
    })
    state.incomeObserver.observe(document.body, { childList: true, subtree: true })
  })
  await row.getByRole('button', { name: '字段编辑商单商单收入详情', exact: true }).click()
  const full = mainWindow.getByRole('dialog', { name: '商单收入详情', exact: true })
  await expect(full.getByLabel('商单金额')).toHaveValue('46000')
  await expect(full.locator('.business-history')).toBeVisible()
  expect(await mainWindow.evaluate(() => {
    const state = globalThis as unknown as { incomeDialogMounts: string[]; incomeObserver: MutationObserver }
    state.incomeObserver.disconnect()
    return state.incomeDialogMounts
  })).toEqual(['商单收入详情'])
})
