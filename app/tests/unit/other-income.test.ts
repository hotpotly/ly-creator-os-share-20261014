import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { extractOtherIncomeImportText } from '../../src/main/other-income-import-file'
import type { OtherIncomeRecord } from '../../src/shared/domain'
import { calculateIncomeLedgerSummary } from '../../src/shared/income-ledger'
import { buildOtherIncomeImportCandidates, parseDelimitedIncomeRows, parseOtherIncomeRuleInstruction } from '../../src/shared/other-income-import'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')
async function createStore(): Promise<WorkspaceStore['repository']> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-income-'))
  roots.push(directory)
  return (await openWorkspaceStore(directory)).repository
}
afterEach(async () => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe('收入台账与其他收入', () => {
  it('迁移默认分类，并支持新增、汇总、回收与恢复', async () => {
    const repository = await createStore()
    expect(repository.listOtherIncomeCategories().map((item) => item.name)).toEqual(['顾问服务', '课程讲座', '内容授权', '平台分成', '发布会', '其他'])
    const consulting = repository.listOtherIncomeCategories()[0]!
    const record = repository.saveOtherIncomeRecord(null, {
      title: '年度顾问服务', categoryId: consulting.id, sourceName: '测试咨询有限公司', revenueMonth: '2026-07', incomeDate: '2026-07-18',
      amountCents: 500_000, directCostCents: 20_000, paymentStatus: 'received', paymentReceivedDate: '2026-07-18',
      status: 'active', currency: 'CNY', notes: '税费计入直接成本'
    })
    repository.saveOtherIncomeRecord(null, {
      title: '美元授权', categoryId: null, sourceName: '海外平台', revenueMonth: '2026-07', incomeDate: '2026-07-19',
      amountCents: 100_000, directCostCents: 0, paymentStatus: 'pending', paymentReceivedDate: null,
      status: 'active', currency: 'USD', notes: ''
    })
    expect(record).toMatchObject({ categoryName: '顾问服务', expectedIncomeCents: 480_000 })
    expect(repository.getSnapshot().incomeLedgerSummary.other).toMatchObject({ totalIncomeCents: 500_000, actualNetIncomeCents: 480_000, expectedIncomeCents: 480_000, receivedCents: 500_000, recordCount: 1 })
    repository.trashOtherIncomeRecord(record.id)
    expect(repository.listOtherIncomeRecords()).not.toContainEqual(expect.objectContaining({ id: record.id }))
    expect(repository.listOtherIncomeRecords(true)).toContainEqual(expect.objectContaining({ id: record.id, trashedAt: expect.any(String) }))
    repository.restoreOtherIncomeRecord(record.id)
    expect(repository.listOtherIncomeRecords()).toContainEqual(expect.objectContaining({ id: record.id }))
  })

  it('保存精确公司别名和可复用自然语言筛选规则', async () => {
    const repository = await createStore()
    const alias = repository.saveOtherIncomeCompanyAlias('测试咨询有限公司', '测试咨询')
    expect(repository.saveOtherIncomeCompanyAlias('测试咨询有限公司', '测试咨询')).toEqual(alias)
    const conditions = parseOtherIncomeRuleInstruction('只提取今年测试咨询有限公司转来的已到账款项，排除退款和内部转账', { today: '2026-07-28' })
    expect(conditions).toMatchObject({ companies: ['测试咨询有限公司'], startDate: '2026-01-01', endDate: '2026-12-31', paymentStatus: 'received' })
    expect(conditions.excludeKeywords).toEqual(expect.arrayContaining(['退款', '内部转账']))
    const rule = repository.saveOtherIncomeImportRule(null, '今年顾问款', '只提取今年测试咨询有限公司', conditions)
    expect(repository.listOtherIncomeImportRules()).toContainEqual(expect.objectContaining({ id: rule.id, conditions }))
  })

  it('保存并规范化常用客户来源模板', async () => {
    const repository = await createStore()
    repository.setPreferences({
      otherIncomeSourceTemplates: [' 甲方测试 ', '甲方测试', 'B站创作激励', '  B站创作激励  ']
    })
    expect(repository.getPreferences().otherIncomeSourceTemplates).toEqual(['甲方测试', 'B站创作激励'])
    expect(repository.getSnapshot().preferences.otherIncomeSourceTemplates).toEqual(['甲方测试', 'B站创作激励'])
  })

  it.each([
    '只看甲方公司的收入',
    '流水里只需要甲方公司的',
    '在银行流水中只保留甲方公司的转账'
  ])('理解口语化公司筛选要求：%s', (instruction) => {
    const conditions = parseOtherIncomeRuleInstruction(instruction, { today: '2026-07-28' })
    expect(conditions.companies).toEqual(['甲方公司'])
    expect(conditions.direction).toBe('income')
  })

  it('用用户输入的公司简称匹配流水中的完整付款方名称', () => {
    const parsed = parseDelimitedIncomeRows([
      '2026-01-01至2026-06-30收支记录汇总',
      '付方账户,付方名称,付方开户行,付方账户币种,收方账户,收方名称,收方开户银行,收方账户币种,交易金额,余额,交易时间,交易流水号,交易类型,摘要',
      'PAY-001,甲方测试科技有限公司,付款测试银行,人民币,SELF-001,收款测试工作室,收款测试银行,人民币,35000,120000,2026-01-22 18:30:33,BANK-IN-001,提回对公户收款,业务款',
      'SELF-001,收款测试工作室,收款测试银行,人民币,EMP-001,测试人员,个人测试银行,人民币,-15000,105000,2026-01-27 17:23:24,BANK-OUT-001,对公转账正常提出,工资垫付'
    ].join('\n'))
    const conditions = parseOtherIncomeRuleInstruction('流水里只需要甲方公司的', { today: '2026-07-28' })
    const candidates = buildOtherIncomeImportCandidates(parsed.rows, conditions, [], [], null)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]).toMatchObject({ rowNumber: 3, payer: '甲方测试科技有限公司', amountCents: 3_500_000, direction: 'income', currency: 'CNY', externalTransactionId: 'BANK-IN-001' })
    expect(parsed.rows[1]).toMatchObject({ direction: 'expense' })
    expect(candidates[0]).toMatchObject({ payer: '甲方测试科技有限公司', selected: true, matched: true })
    expect(candidates[0]?.matchReasons).toContain('付款方“甲方测试科技有限公司”包含公司简称“甲方”')
    expect(candidates[1]).toMatchObject({ payer: '收款测试工作室', selected: false, matched: false })
  })

  it('解析表格、展示命中证据，并默认排除退款、疑似商单和重复项', () => {
    const parsed = parseDelimitedIncomeRows([
      '交易日期,付款方,收入金额,摘要,流水号',
      '2026-07-10,测试咨询,5000,顾问服务已到账,T001',
      '2026-07-11,测试咨询,8000,花火品牌合作已到账,T002',
      '2026-07-12,测试咨询,500,退款,T003'
    ].join('\n'))
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]).toMatchObject({ direction: 'income', paymentStatus: 'received', amountCents: 500_000 })
    const conditions = parseOtherIncomeRuleInstruction('只提取今年测试咨询有限公司的款项，排除退款', { today: '2026-07-28' })
    const existing = [{
      id: 'existing', title: '旧记录', categoryId: null, categoryName: '未分类', sourceName: '测试咨询', revenueMonth: '2026-07',
      incomeDate: '2026-07-10', amountCents: 500_000, directCostCents: 0, expectedIncomeCents: 500_000, paymentStatus: 'received' as const,
      paymentReceivedDate: '2026-07-10', status: 'active' as const, currency: 'CNY', notes: '', sourceReference: '', sourceTransactionId: 'T001',
      sourceHash: '', originalFileId: null, originalFileName: null, trashedAt: null, createdAt: '2026-07-10T00:00:00Z', updatedAt: '2026-07-10T00:00:00Z'
    }]
    const candidates = buildOtherIncomeImportCandidates(parsed.rows, conditions, [{ id: 'alias', companyName: '测试咨询有限公司', alias: '测试咨询', createdAt: '2026-01-01' }], existing, null)
    expect(candidates[0]).toMatchObject({ duplicateConfidence: 'exact', selected: false, matched: true })
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(['付款方：测试咨询', '金额：¥5000.00']))
    expect(candidates[1]).toMatchObject({ suspectedBusiness: true, selected: false })
    expect(candidates[2]?.selected).toBe(false)
    expect(candidates[2]?.exclusionReasons.join('')).toContain('退款')
    const distinctId = buildOtherIncomeImportCandidates([{ ...parsed.rows[0]!, externalTransactionId: 'T009', rawText: `${parsed.rows[0]!.rawText} 新流水` }], conditions, [{ id: 'alias', companyName: '测试咨询有限公司', alias: '测试咨询', createdAt: '2026-01-01' }], existing, null)[0]!
    expect(distinctId.duplicateConfidence).toBe('possible')
    expect(distinctId.selected).toBe(true)
  })

  it('没有到账证据时保持待回款建议，且松散文本不会把日期当金额', () => {
    const contract = parseDelimitedIncomeRows('收入日期,付款方,收入金额,摘要\n2026-07-10,某公司,5000,顾问合同')
    expect(contract.rows[0]).toMatchObject({ direction: 'income', paymentStatus: null })
    const noMoney = parseDelimitedIncomeRows('2026-07-10 某公司 收入合同')
    expect(noMoney.rows).toEqual([])
    expect(noMoney.errors[0]).toContain('缺少可识别金额')
  })

  it('正确解析多公司排除条件和Excel日期序列号', async () => {
    const conditions = parseOtherIncomeRuleInstruction('只提取A有限公司和C有限公司，排除B有限公司和员工报销', { today: '2026-07-28' })
    expect(conditions.companies).toEqual(expect.arrayContaining(['A有限公司', 'C有限公司']))
    expect(conditions.excludedCompanies).toContain('B有限公司')
    expect(conditions.excludeKeywords).toContain('员工报销')

    const zip = new JSZip()
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>收入日期</t></is></c><c r="B1" t="inlineStr"><is><t>收入金额</t></is></c></row>
      <row r="2"><c r="A2"><v>46212</v></c><c r="B2"><v>5000</v></c></row>
    </sheetData></worksheet>`)
    const text = await extractOtherIncomeImportText('账单.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await zip.generateAsync({ type: 'uint8array' }))
    expect(text).toContain('2026-07-09')
    expect(parseDelimitedIncomeRows(text).rows[0]).toMatchObject({ transactionDate: '2026-07-09', amountCents: 500_000 })
  })

  it('自动跳过微信和支付宝账单说明行，并识别金额括号表头', async () => {
    const wechat = parseDelimitedIncomeRows([
      '微信支付账单明细',
      '微信昵称：[测试用户]',
      '起始时间：[2026-01-01 00:00:00]\t终止时间：[2026-06-30 23:59:59]',
      '交易时间\t交易类型\t交易对方\t商品\t收/支\t金额(元)\t支付方式\t当前状态\t交易单号\t商户单号\t备注',
      '2026-03-18 10:20:00\t商户消费\t甲方公司\t顾问服务\t收入\t¥8,888.00\t零钱\t支付成功\tWX001\tM001\t季度顾问费'
    ].join('\n'))
    expect(wechat.errors).toEqual([])
    expect(wechat.rows[0]).toMatchObject({
      rowNumber: 5,
      title: '顾问服务',
      payer: '甲方公司',
      transactionDate: '2026-03-18',
      amountCents: 888_800,
      direction: 'income',
      paymentStatus: 'received',
      externalTransactionId: 'WX001'
    })

    const alipay = parseDelimitedIncomeRows([
      '支付宝交易记录明细查询',
      '账号:[demo@example.com]',
      '交易号,商家订单号,交易创建时间,交易对方,商品名称,金额（元）,收/支,交易状态,备注',
      'ALI001,ORDER001,2026-04-09 09:30:00,甲方公司,内容授权,"12,345.67",收入,交易成功,版权费'
    ].join('\n'))
    expect(alipay.errors).toEqual([])
    expect(alipay.rows[0]).toMatchObject({ payer: '甲方公司', title: '内容授权', transactionDate: '2026-04-09', amountCents: 1_234_567, direction: 'income', externalTransactionId: 'ALI001' })

    const zip = new JSZip()
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>微信支付账单明细</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>导出时间</t></is></c><c r="B2" t="inlineStr"><is><t>2026-07-28</t></is></c></row>
      <row r="8"><c r="A8" t="inlineStr"><is><t>交易时间</t></is></c><c r="B8" t="inlineStr"><is><t>交易对方</t></is></c><c r="C8" t="inlineStr"><is><t>商品</t></is></c><c r="D8" t="inlineStr"><is><t>收/支</t></is></c><c r="E8" t="inlineStr"><is><t>金额(元)</t></is></c></row>
      <row r="9"><c r="A9"><v>46099</v></c><c r="B9" t="inlineStr"><is><t>甲方公司</t></is></c><c r="C9" t="inlineStr"><is><t>课程讲座</t></is></c><c r="D9" t="inlineStr"><is><t>收入</t></is></c><c r="E9"><v>6000</v></c></row>
    </sheetData></worksheet>`)
    const text = await extractOtherIncomeImportText('收支记录汇总.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await zip.generateAsync({ type: 'uint8array' }))
    expect(parseDelimitedIncomeRows(text).rows[0]).toMatchObject({ payer: '甲方公司', title: '课程讲座', transactionDate: '2026-03-18', amountCents: 600_000, direction: 'income' })
  })

  it('把同一受管附件关联到多笔其他收入', async () => {
    const repository = await createStore()
    const input = {
      title: '顾问费', categoryId: null, sourceName: '客户', revenueMonth: '2026-07', incomeDate: '2026-07-01',
      amountCents: 100_000, directCostCents: 0, paymentStatus: 'pending' as const, paymentReceivedDate: null,
      status: 'active' as const, currency: 'CNY', notes: ''
    }
    const records = repository.saveOtherIncomeRecordsBatch([input, { ...input, title: '第二笔' }])
    const attached = repository.attachOtherIncomeFile(records.map((record) => record.id), {
      id: 'income-file', kind: 'file', relativePath: 'other-income-files/source.pdf', managedLocator: 'other-income-files/source.pdf',
      originalName: 'source.pdf', sizeBytes: 100, sha256: 'a'.repeat(64), mimeType: 'application/pdf', sourceModifiedAt: null,
      sourceBookmark: null, sourceOrigin: 'managed_import', availability: 'available', processState: 'ready',
      capabilitiesJson: '["preview","parse"]', createdAt: '2026-07-28T00:00:00Z', updatedAt: '2026-07-28T00:00:00Z'
    })
    expect(attached.records).toEqual(records.map((record) => expect.objectContaining({ id: record.id, originalFileId: 'income-file', originalFileName: 'source.pdf' })))
  })

  it('统一拆分实际净收入与预计净收入', () => {
    const pending = {
      id: 'one', title: '顾问费', categoryId: null, categoryName: '顾问服务', sourceName: '客户', revenueMonth: '2026-07', incomeDate: '2026-07-01',
      amountCents: 200_000, directCostCents: 10_000, expectedIncomeCents: 190_000, paymentStatus: 'pending', paymentReceivedDate: null,
      status: 'active', currency: 'CNY', notes: '', sourceReference: '', sourceTransactionId: '', sourceHash: '', originalFileId: null,
      originalFileName: null, trashedAt: null, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z'
    } satisfies OtherIncomeRecord
    const summary = calculateIncomeLedgerSummary([], [pending, {
      ...pending,
      id: 'two',
      title: '已到账顾问费',
      amountCents: 100_000,
      directCostCents: 20_000,
      expectedIncomeCents: 80_000,
      paymentStatus: 'received',
      paymentReceivedDate: '2026-07-02'
    }])
    expect(summary.combined).toEqual({
      totalIncomeCents: 300_000,
      actualNetIncomeCents: 80_000,
      actualNetKnownCount: 1,
      actualNetEligibleCount: 1,
      expectedIncomeCents: 270_000,
      expectedNetKnownCount: 2,
      expectedNetEligibleCount: 2,
      receivedCents: 100_000,
      pendingCents: 200_000,
      recordCount: 2
    })
  })
})
