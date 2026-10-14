import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import JSZip from 'jszip'
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
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_TEST_TOUCH_ID: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.otherIncomeCategories.length) ?? 0)).toBe(6)
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('进入锁定的收入页面后直接发起系统验证，无需先点Touch ID按钮', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS
    await api?.enableBusinessLedgerLock('test-password')
    await api?.lockBusinessLedger()
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/income'
  })
  await expect(mainWindow.getByRole('heading', { name: '收入台账', level: 1 })).toBeVisible()
  await expect(mainWindow.getByText('综合总览')).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getBusinessLedgerLockStatus().then((status) => status.unlocked) ?? false)).toBe(true)
})

test('其他收入可手动录入，并在收入台账总览展示实际净收入和分类拆分', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/other-income' })
  await expect(mainWindow.getByRole('heading', { name: '其他收入', level: 1 })).toBeVisible()
  await mainWindow.getByRole('main').getByRole('button', { name: '新增收入', exact: true }).click()
  const editor = mainWindow.getByRole('dialog', { name: '新增其他收入' })
  await expect(editor.getByLabel('收入类型').locator('option')).toHaveText(['未分类', '顾问服务', '课程讲座', '内容授权', '平台分成', '发布会', '其他'])
  await editor.getByLabel('收入标题').fill('年度顾问服务')
  await editor.getByLabel('收入类型').selectOption({ label: '顾问服务' })
  await editor.getByLabel('客户／来源').fill('测试咨询有限公司')
  await editor.getByLabel('收益月份').fill('2026-07')
  await editor.getByLabel('收入日期').fill('2026-07-18')
  await editor.getByLabel('收入金额').fill('5000')
  await editor.getByLabel('直接成本').fill('200')
  await editor.getByLabel('回款状态').selectOption('received')
  await editor.getByLabel('回款日期').fill('2026-07-20')
  await editor.getByRole('button', { name: '保存收入' }).click()
  await expect(mainWindow.locator('.income-records')).toContainText('年度顾问服务')
  await expect(mainWindow.locator('.income-records')).toContainText('¥5,000.00')
  await expect(mainWindow.getByRole('region', { name: '其他收入列表' })).toHaveClass(/business-ledger-table/)
  await expect(mainWindow.getByRole('region', { name: '收入汇总' })).toHaveClass(/business-ledger-summary/)
  expect(await mainWindow.locator('.other-income-row').nth(1).evaluate((element) => {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element)
    const title = element.querySelector('b')!
    const detail = element.querySelector('small')!
    return {
      minHeight: style.minHeight,
      titleSize: element.ownerDocument.defaultView!.getComputedStyle(title).fontSize,
      detailSize: element.ownerDocument.defaultView!.getComputedStyle(detail).fontSize
    }
  })).toEqual({ minHeight: '50px', titleSize: '12px', detailSize: '10px' })
  expect(await mainWindow.locator('.income-title-button').filter({ hasText: '年度顾问服务' }).evaluate((element) => (
    element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor
  ))).toBe('rgba(0, 0, 0, 0)')

  await mainWindow.locator('.sidebar').getByRole('button', { name: '收入台账', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '收入台账', level: 1 })).toBeVisible()
  await expect(mainWindow.locator('.income-summary-grid')).toContainText('实际净收入')
  await expect(mainWindow.locator('.income-summary-grid')).not.toContainText('总计收入')
  await expect(mainWindow.locator('.income-summary-grid .actual-net')).toContainText('¥4,800.00')
  await expect(mainWindow.locator('.income-summary-grid').getByText('¥5,000.00').first()).toBeVisible()
  await expect(mainWindow.locator('.income-split-grid').getByRole('button', { name: /其他收入/ })).toContainText('1笔')
  const overview = mainWindow.locator('.income-overview-panel')
  await expect(overview.locator('.income-summary-grid')).toHaveCount(1)
  await expect(overview.locator('.income-split-grid')).toHaveCount(1)
  const actualCard = overview.locator('.income-summary-grid article').first()
  const expectedCard = overview.locator('.income-summary-grid article').nth(1)
  expect(await actualCard.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor))
    .toBe(await expectedCard.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor))
  expect(await actualCard.locator('span').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).color))
    .not.toBe(await expectedCard.locator('span').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).color))
  expect(Number.parseInt(await actualCard.locator('b').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).fontWeight), 10))
    .toBeGreaterThan(Number.parseInt(await expectedCard.locator('b').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).fontWeight), 10))
})

test('其他收入可保存并复用常用客户来源', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/other-income' })
  await mainWindow.getByRole('main').getByRole('button', { name: '新增收入', exact: true }).click()
  let editor = mainWindow.getByRole('dialog', { name: '新增其他收入' })
  await editor.getByLabel('客户／来源').fill('甲方测试')
  await editor.getByRole('button', { name: '保存为常用' }).click()
  await expect(editor.getByText('已保存')).toBeVisible()
  await editor.getByRole('button', { name: '取消' }).click()
  await mainWindow.getByRole('alertdialog', { name: '收入修改尚未保存' }).getByRole('button', { name: '放弃修改' }).click()

  await mainWindow.getByRole('main').getByRole('button', { name: '新增收入', exact: true }).click()
  editor = mainWindow.getByRole('dialog', { name: '新增其他收入' })
  await editor.getByRole('button', { name: '打开常用客户模板' }).click()
  const menu = mainWindow.getByRole('menu', { name: '常用客户／来源' })
  const templateItem = menu.getByRole('menuitem', { name: '甲方测试' })
  const deleteTemplate = menu.getByRole('button', { name: '删除常用客户甲方测试' })
  expect(await templateItem.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  expect(await deleteTemplate.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await templateItem.click()
  await expect(editor.getByLabel('客户／来源')).toHaveValue('甲方测试')
  await editor.getByRole('button', { name: '取消' }).click()
  await mainWindow.getByRole('alertdialog', { name: '收入修改尚未保存' }).getByRole('button', { name: '放弃修改' }).click()

  expect(await mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).preferences.otherIncomeSourceTemplates)).toEqual(['甲方测试'])
})

test('智能导入把自然语言要求转成可见条件，并默认排除退款', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/other-income' })
  await mainWindow.getByRole('main').getByRole('button', { name: '智能批量导入' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '智能批量导入其他收入' })
  await dialog.locator('.import-source-panel > textarea').fill([
    '交易日期,付款方,收入金额,摘要,流水号',
    '2026-07-10,测试咨询有限公司,5000,顾问服务已到账,T001',
    '2026-07-11,测试咨询有限公司,300,退款,T002'
  ].join('\n'))
  await dialog.getByLabel('筛选要求').fill('只提取今年测试咨询有限公司的款项，排除退款')
  await dialog.getByRole('button', { name: '生成预览' }).click()
  await expect(dialog.getByText('公司：测试咨询有限公司')).toBeVisible()
  await expect(dialog.getByText('开始：2026-01-01')).toBeVisible()
  await expect(dialog.getByText('排除：退款')).toBeVisible()
  await expect(dialog.getByLabel('选择第2行')).toBeChecked()
  await expect(dialog.getByLabel('选择第3行')).not.toBeChecked()
  await expect(dialog).toContainText('付款方：测试咨询有限公司')
  await dialog.getByRole('button', { name: '导入所选收入' }).click()
  await expect(mainWindow.locator('.income-records')).toContainText('顾问服务已到账')
  await expect(mainWindow.locator('.income-records')).not.toContainText('退款')
})

test('智能导入可跳过账单说明行并识别金额括号表头', async () => {
  const zip = new JSZip()
  zip.file('xl/worksheets/sheet1.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>微信支付账单明细</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>导出时间：2026-07-28</t></is></c></row>',
    '<row r="3"><c r="A3" t="inlineStr"><is><t>共2笔记录</t></is></c></row>',
    '<row r="4"></row>',
    '<row r="5"><c r="A5" t="inlineStr"><is><t>交易时间</t></is></c><c r="B5" t="inlineStr"><is><t>付方名称</t></is></c><c r="C5" t="inlineStr"><is><t>商品名称</t></is></c><c r="D5" t="inlineStr"><is><t>收/支</t></is></c><c r="E5" t="inlineStr"><is><t>金额(元)</t></is></c><c r="F5" t="inlineStr"><is><t>当前状态</t></is></c><c r="G5" t="inlineStr"><is><t>交易单号</t></is></c></row>',
    '<row r="6"><c r="A6" t="inlineStr"><is><t>2026-03-18 10:30:00</t></is></c><c r="B6" t="inlineStr"><is><t>甲方测试科技有限公司</t></is></c><c r="C6" t="inlineStr"><is><t>年度顾问服务</t></is></c><c r="D6" t="inlineStr"><is><t>收入</t></is></c><c r="E6"><v>6800</v></c><c r="F6" t="inlineStr"><is><t>支付成功</t></is></c><c r="G6" t="inlineStr"><is><t>WX-001</t></is></c></row>',
    '<row r="7"><c r="A7" t="inlineStr"><is><t>2026-03-19 10:30:00</t></is></c><c r="B7" t="inlineStr"><is><t>其他公司</t></is></c><c r="C7" t="inlineStr"><is><t>咨询服务</t></is></c><c r="D7" t="inlineStr"><is><t>收入</t></is></c><c r="E7"><v>500</v></c><c r="F7" t="inlineStr"><is><t>支付成功</t></is></c><c r="G7" t="inlineStr"><is><t>WX-002</t></is></c></row>',
    '</sheetData></worksheet>'
  ].join(''))
  const file = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/other-income' })
  await mainWindow.getByRole('main').getByRole('button', { name: '智能批量导入' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '智能批量导入其他收入' })
  await dialog.locator('input[type="file"]').setInputFiles({
    name: '2026-01-01至2026-06-30收支记录汇总.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: file
  })
  await dialog.getByLabel('筛选要求').fill('流水里只需要甲方公司的')
  await dialog.getByRole('button', { name: '生成预览' }).click()

  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByText('公司：甲方公司')).toBeVisible()
  await expect(dialog.getByLabel('第5行付款方')).toHaveValue('甲方测试科技有限公司')
  await expect(dialog.getByLabel('第5行收入金额')).toHaveValue('6800')
  await expect(dialog.getByLabel('选择第5行')).toBeChecked()
  await expect(dialog.getByLabel('选择第6行')).not.toBeChecked()

  await dialog.getByRole('button', { name: '保存为常用规则' }).click()
  await expect(dialog.getByLabel('常用规则名称')).toBeFocused()
  await dialog.getByLabel('常用规则名称').fill('甲方公司收入')
  await dialog.getByRole('button', { name: '确认保存' }).click()
  await expect(dialog.getByRole('status')).toHaveText('已保存“甲方公司收入”')
  await expect(dialog.locator('.saved-rules').getByRole('button', { name: '甲方公司收入' })).toBeVisible()
})

test('收入页面在窄窗口和双视觉风格下无整页横向溢出', async () => {
  for (const view of [{ hash: '#/income', summary: '.income-summary-grid' }, { hash: '#/other-income', summary: '.business-ledger-summary' }]) {
    await mainWindow.evaluate((hash) => { (globalThis as unknown as BrowserGlobals).location.hash = hash }, view.hash)
    for (const style of ['warm', 'feishu'] as const) {
      await mainWindow.evaluate(async (visualStyle) => { await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences({ visualStyle }) }, style)
      await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(700, 720) })
      await expect.poll(() => mainWindow.evaluate(() => {
        const root = (globalThis as unknown as BrowserGlobals).document.documentElement
        return root.scrollWidth - root.clientWidth
      })).toBeLessThanOrEqual(1)
      await expect(mainWindow.locator(`${view.summary} article`)).toHaveCount(4)
      const firstMetric = await mainWindow.locator(`${view.summary} article`).first().boundingBox()
      const secondMetric = await mainWindow.locator(`${view.summary} article`).nth(1).boundingBox()
      expect(firstMetric).not.toBeNull()
      expect(secondMetric).not.toBeNull()
      expect(Math.abs(firstMetric!.y - secondMetric!.y)).toBeLessThanOrEqual(1)
    }
  }
})

test('顶部新增动作直接打开对应收入表单', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/income' })
  await mainWindow.locator('.topbar').getByRole('button', { name: '新增其他收入' }).click()
  await expect(mainWindow.getByRole('dialog', { name: '新增其他收入' })).toBeVisible()
  await mainWindow.getByRole('dialog', { name: '新增其他收入' }).getByRole('button', { name: '关闭', exact: true }).click()
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/business' })
  await mainWindow.locator('.topbar').getByRole('button', { name: '新增商单' }).click()
  await expect(mainWindow.getByRole('dialog', { name: '直接补加商单' })).toBeVisible()
})

test('其他收入标题直接编辑，取消与遮罩保护草稿，保存后复用原记录', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/other-income' })
  await mainWindow.getByRole('main').getByRole('button', { name: '新增收入', exact: true }).click()
  const create = mainWindow.getByRole('dialog', { name: '新增其他收入' })
  await create.getByLabel('收入标题').fill('原位编辑其他收入')
  await create.getByLabel('收入金额').fill('5000')
  await create.getByLabel('直接成本').fill('200')
  await create.getByRole('button', { name: '保存收入' }).click()
  const row = mainWindow.getByRole('button', { name: '原位编辑其他收入其他收入详情', exact: true })
  await row.focus()
  await row.press('Enter')
  const detail = mainWindow.getByRole('dialog', { name: '其他收入详情', exact: true })
  const amount = detail.getByLabel('收入金额')
  await expect(amount).toHaveValue('5000')
  await expect(detail.getByRole('button', { name: '编辑收入' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: '保存收入' })).toBeDisabled()
  const box = await amount.boundingBox()
  await amount.fill('6000')
  expect(await amount.boundingBox()).toEqual(box)
  await expect(detail.getByLabel('预计净收入')).toHaveText('¥5,800.00')
  await mainWindow.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } })
  const guard = mainWindow.getByRole('alertdialog', { name: '收入修改尚未保存' })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: '继续编辑' }).press('Escape')
  await expect(guard).toHaveCount(0)
  await expect(amount).toHaveValue('6000')
  await detail.getByRole('button', { name: '取消', exact: true }).click()
  await guard.getByRole('button', { name: '放弃修改' }).click()
  await row.click()
  await expect(amount).toHaveValue('5000')
  await amount.fill('-1')
  await detail.getByRole('button', { name: '保存收入' }).click()
  await expect(detail.getByRole('alert')).toBeVisible()
  await expect(amount).toHaveValue('-1')
  await amount.fill('6000')
  await detail.getByLabel('回款状态').selectOption('received')
  await detail.getByLabel('备注', { exact: true }).fill('保存后再次打开验证')
  await detail.getByRole('button', { name: '保存收入' }).click()
  await expect(detail).toHaveCount(0)
  await row.click()
  await expect(amount).toHaveValue('6000')
  await expect(detail.getByLabel('备注', { exact: true })).toHaveValue('保存后再次打开验证')
  for (const theme of ['light', 'dark']) {
    await mainWindow.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(720, 720) })
    const geometry = await detail.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, bottom: element.getBoundingClientRect().bottom, height: window.innerHeight }))
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height)
    await mainWindow.screenshot({ path: testInfo.outputPath(`income-inline-other-${theme}.png`) })
  }
  await detail.getByRole('button', { name: '关闭', exact: true }).click()
  const saved = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace())
  const records = saved.otherIncomeRecords.filter((item) => item.title === '原位编辑其他收入')
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ amountCents: 600_000, directCostCents: 20_000, paymentStatus: 'received' })
})

test('其他收入金额、分类、日期和回款各自就近修改，不弹完整编辑', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/other-income' })
  await mainWindow.getByRole('main').getByRole('button', { name: '新增收入', exact: true }).click()
  const create = mainWindow.getByRole('dialog', { name: '新增其他收入' })
  await create.getByLabel('收入标题').fill('字段编辑其他收入')
  await create.getByLabel('收入金额').fill('1000')
  await create.getByLabel('直接成本').fill('100')
  await create.getByLabel('备注', { exact: true }).fill('不能被单项编辑覆盖')
  await create.getByRole('button', { name: '保存收入' }).click()
  const row = mainWindow.getByRole('group', { name: '字段编辑其他收入收入记录', exact: true })
  await row.getByRole('button', { name: '字段编辑其他收入：收入金额', exact: true }).click()
  const amount = mainWindow.getByRole('dialog', { name: '收入金额快捷修改' })
  await expect(mainWindow.getByRole('dialog', { name: '其他收入详情' })).toHaveCount(0)
  await amount.getByLabel('收入金额').fill('-1')
  await amount.getByRole('button', { name: '保存', exact: true }).click()
  await expect(amount.getByRole('alert')).toContainText('金额格式无效')
  await amount.getByLabel('收入金额').fill('2000')
  await amount.getByLabel('收入金额').press('Enter')
  await expect(amount).toHaveCount(0)
  await expect(row.getByRole('button', { name: '字段编辑其他收入：收入金额', exact: true })).toHaveText('¥2,000.00')
  await row.getByRole('button', { name: '字段编辑其他收入：收入类型', exact: true }).click()
  await mainWindow.getByRole('dialog', { name: '收入类型快捷修改' }).getByRole('button', { name: '发布会', exact: true }).click()
  await row.getByRole('button', { name: '字段编辑其他收入：收入日期', exact: true }).click()
  const date = mainWindow.getByRole('dialog', { name: '收入日期快捷修改' })
  await date.getByLabel('收入日期').fill('2026-09-10')
  await date.getByRole('button', { name: '保存', exact: true }).click()
  await row.getByRole('button', { name: '字段编辑其他收入：回款状态', exact: true }).click()
  const payment = mainWindow.getByRole('dialog', { name: '回款状态快捷修改' })
  await payment.getByRole('button', { name: '已回款', exact: true }).click()
  await expect(row).toContainText('已回款')
  for (const theme of ['light', 'dark']) {
    await mainWindow.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(720, 720) })
    await row.getByRole('button', { name: '字段编辑其他收入：回款状态', exact: true }).click()
    const box = await payment.boundingBox()
    const viewport = await mainWindow.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 7)
    await mainWindow.screenshot({ path: testInfo.outputPath(`income-cell-other-${theme}.png`) })
    await payment.getByRole('button', { name: '关闭单项修改' }).click()
  }
  await row.getByRole('button', { name: '字段编辑其他收入其他收入详情', exact: true }).click()
  const full = mainWindow.getByRole('dialog', { name: '其他收入详情' })
  await expect(full.getByLabel('备注', { exact: true })).toHaveValue('不能被单项编辑覆盖')
  await expect(full.getByLabel('直接成本')).toHaveValue('100')
  await expect(full.getByLabel('预计净收入')).toHaveText('¥1,900.00')
  await expect(full.getByLabel('收入类型').locator('option:checked')).toHaveText('发布会')
})
