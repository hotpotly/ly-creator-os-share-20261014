import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { discardBusinessFile, retainBusinessFile } from '../../src/main/business-files'
import { normalizeBusinessPlatform, normalizeBusinessPlatforms } from '../../src/shared/business-platforms'
import { businessFileImportPayloadSchema } from '../../src/shared/ipc'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-business-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('商单与商务台账', () => {
  it('统一商务平台简称并移除停用平台', () => {
    expect(normalizeBusinessPlatform('B站花火')).toBe('B站')
    expect(normalizeBusinessPlatform('小红书蒲公英')).toBe('小红书')
    expect(normalizeBusinessPlatforms(['B站花火', '微信', '淘宝／天猫', '线下直签'])).toEqual([
      'B站', '小红书', '抖音', '油管', '线下直签'
    ])
  })

  it('允许只建立历史商务台账，并从内容项目和创作报表中隐藏', async () => {
    const { store, directory } = await createStore()
    const input = {
      orderPlatform: 'B站', orderDate: '2025-12-20', quotedAmountCents: null, platformOrderAmountCents: 2_000_000,
      finalRebateRatePercent: 10, finalRebateAmountCents: 200_000, rebateRequirement: 'required',
      rebateRecipientType: 'corporate', rebateRecipientName: '', rebateProcedureStatus: 'complete',
      plannedRebateDate: null, paymentStatus: 'received', paymentReceivedDate: '2025-12-28',
      invoiceRequirement: 'not_required', videoProductionCostCents: 100_000,
      trafficPromotionCostCents: 50_000, incomeAttributionDate: null, notes: '历史数据'
    } as const
    const entry = store.repository.saveStandaloneBusinessLedgerEntry(null, '2025年历史合作', input)
    expect(entry).toMatchObject({ projectTitle: '2025年历史合作', ledgerOnly: true, expectedIncomeCents: 1_650_000 })
    expect(store.repository.saveStandaloneBusinessLedgerEntry(entry.projectId, '2025年历史合作已修订', { ...input, notes: '已修订' })).toMatchObject({
      projectTitle: '2025年历史合作已修订',
      notes: '已修订',
      ledgerOnly: true
    })
    expect(store.repository.saveStandaloneBusinessLedgerEntry(entry.projectId, '2025年历史合作已修订', { ...input, notes: '已修订', paymentReceivedDate: null })).toMatchObject({ paymentStatus: 'received', paymentReceivedDate: null })
    expect(store.repository.listBusinessLedger().find((item) => item.projectId === entry.projectId)).toMatchObject({ projectTitle: '2025年历史合作已修订', notes: '已修订' })
    expect(() => store.repository.saveStandaloneBusinessLedgerEntry('sponsor', '不能覆盖普通项目', input)).toThrow('独立台账不存在')
    expect(() => store.repository.saveStandaloneBusinessLedgerEntry(null, '失败后不留空壳', { ...input, orderDate: '错误日期' })).toThrow('平台下单日期格式无效')
    expect(store.repository.listProjects(true, true, true).some((project) => project.title === '失败后不留空壳')).toBe(false)
    expect(store.repository.getSnapshot().projects.some((project) => project.id === entry.projectId)).toBe(false)
    expect(store.repository.listBusinessLedger().find((item) => item.projectId === entry.projectId)).toMatchObject({ ledgerOnly: true })
    expect(store.repository.getCreationReport('monthly', '2025-12-20', true).payload.publishedProjects.some((project) => project.projectId === entry.projectId)).toBe(false)
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.listBusinessLedger().find((item) => item.projectId === entry.projectId)).toMatchObject({ projectTitle: '2025年历史合作已修订', ledgerOnly: true })
    expect(reopened.repository.listProjects().some((project) => project.id === entry.projectId)).toBe(false)
    reopened.close()
  })

  it('只为商单项目开启商单模块，且不把合作条件重复放入台账', async () => {
    const { store } = await createStore()
    const sponsor = store.repository.getProject('sponsor', false)
    expect(sponsor.modules.find((module) => module.key === 'business')).toMatchObject({ enabled: true, position: 9 })
    expect(sponsor.business).not.toBeNull()
    expect(sponsor.materials).toEqual(expect.any(Array))
    expect(store.repository.getProject('ios', false).business).toBeNull()
    expect(() => store.repository.setModule('ios', 'business', true)).toThrow('金额模块是商单项目独有模块')
    expect(() => store.repository.saveBusinessRecord('ios', {
      orderPlatform: '', orderDate: null, quotedAmountCents: null, platformOrderAmountCents: null,
      finalRebateRatePercent: null, finalRebateAmountCents: null, rebateRequirement: 'pending_confirmation',
      rebateRecipientType: 'unknown', rebateRecipientName: '', rebateProcedureStatus: 'preparing',
      plannedRebateDate: null, paymentStatus: 'pending', paymentReceivedDate: null,
      invoiceRequirement: 'pending_confirmation', videoProductionCostCents: 0,
      trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    })).toThrow('商单记录只能写入商单项目')
    store.close()
  })

  it('按项目合计扣除成本，并按回款、单次返点与转账记录推进状态', async () => {
    const { store, directory } = await createStore()
    let data = store.repository.saveBusinessRecord('sponsor', {
      dealStatus: 'ordered',
      orderPlatform: '花火', orderDate: '2026-07-20', quotedAmountCents: 7_000_000, platformOrderAmountCents: 6_800_000,
      finalRebateRatePercent: 20, finalRebateAmountCents: null, rebateRequirement: 'required',
      rebateRecipientType: 'corporate', rebateRecipientName: '合作代理公司', rebateProcedureStatus: 'complete',
      plannedRebateDate: '2026-08-10', paymentStatus: 'pending', paymentReceivedDate: null,
      invoiceRequirement: 'not_required', videoProductionCostCents: 100_000,
      trafficPromotionCostCents: 50_000, incomeAttributionDate: null, notes: '首版只记项目合计'
    })
    expect(data.record).toMatchObject({
      effectiveFinalRebateAmountCents: 1_360_000,
      expectedIncomeCents: 5_290_000,
      effectiveIncomeAttributionDate: '2026-07-01',
      rebateExecutionStatus: 'pending',
      ledgerStatus: 'rebate_pending',
      remainingRebateCents: 1_360_000
    })
    expect(data.record.expectedIncomeRatePercent).toBeCloseTo(77.794, 2)

    data = store.repository.saveBusinessRecord('sponsor', {
      dealStatus: 'ordered',
      orderPlatform: '花火', orderDate: '2026-07-20', quotedAmountCents: 7_000_000, platformOrderAmountCents: 6_800_000,
      finalRebateRatePercent: 20, finalRebateAmountCents: null, rebateRequirement: 'required',
      rebateRecipientType: 'corporate', rebateRecipientName: '合作代理公司', rebateProcedureStatus: 'complete',
      plannedRebateDate: '2026-08-10', paymentStatus: 'received', paymentReceivedDate: '2026-07-24',
      invoiceRequirement: 'not_required', videoProductionCostCents: 100_000,
      trafficPromotionCostCents: 50_000, incomeAttributionDate: null, notes: '首版只记项目合计'
    })
    expect(data.record).toMatchObject({ rebateExecutionStatus: 'pending', ledgerStatus: 'rebate_pending', lifecycleStatus: 'ordered' })

    data = store.repository.saveRebatePayment('sponsor', null, { amountCents: 1_360_000, paidDate: '2026-08-10', notes: '单次返点' })
    expect(data.rebatePayment).toMatchObject({ amountCents: 1_360_000, notes: '单次返点' })
    expect(data.record).toMatchObject({ totalPaidRebateCents: 1_360_000, remainingRebateCents: 0, rebateExecutionStatus: 'completed', ledgerStatus: 'completed', lifecycleStatus: 'settled' })
    expect(() => store.repository.saveRebatePayment('sponsor', null, { amountCents: 100, paidDate: '2026-08-11', notes: '不允许第二次' })).toThrow('每个商单只能保留一次返点记录')

    const proof = await retainBusinessFile(directory, 'sponsor', 'rebate_payment_proof', '返点转账记录.pdf', new TextEncoder().encode('%PDF-1.7\nrebate proof'))
    data = store.repository.createBusinessFile({ projectId: 'sponsor', role: 'rebate_payment_proof', file: proof, rebatePaymentId: null, invoiceId: null })
    expect(data.record).toMatchObject({ rebateExecutionStatus: 'completed', ledgerStatus: 'completed' })
    expect(store.repository.listBusinessLedger()).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 'sponsor', expectedIncomeCents: 5_290_000, paymentStatus: 'received', ledgerStatus: 'completed' })
    ]))
    store.close()
  })

  it('已回款但返点待确认时不把未知净收入误报为零', async () => {
    const { store } = await createStore()
    store.repository.saveBusinessRecord('sponsor', {
      dealStatus: 'ordered',
      orderPlatform: 'B站', orderDate: '2026-07-20', quotedAmountCents: null, platformOrderAmountCents: 10_000_000,
      finalRebateRatePercent: null, finalRebateAmountCents: null, rebateRequirement: 'pending_confirmation',
      rebateRecipientType: 'unknown', rebateRecipientName: '', rebateProcedureStatus: 'preparing',
      plannedRebateDate: null, paymentStatus: 'received', paymentReceivedDate: '2026-07-24',
      invoiceRequirement: 'not_required', videoProductionCostCents: 0,
      trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    })
    expect(store.repository.getSnapshot().incomeLedgerSummary.business).toMatchObject({
      actualNetIncomeCents: 0,
      actualNetKnownCount: 0,
      actualNetEligibleCount: 1,
      receivedCents: 10_000_000
    })
    store.close()
  })

  it('预计净收入包含已谈妥待下单的有效登记', async () => {
    const { store } = await createStore()
    const before = store.repository.getSnapshot().incomeLedgerSummary.business
    const project = store.repository.createProject({
      title: '已谈妥合作', description: '', contentTypeId: 'type-commercial',
      templateId: 'template-commercial', colorToken: 'project-4', platformTargets: ['B站']
    })
    store.repository.saveBusinessRecord(project.id, {
      dealStatus: 'agreed_pending_order',
      orderPlatform: 'B站', orderDate: null, quotedAmountCents: 2_000_000, platformOrderAmountCents: 2_000_000,
      finalRebateRatePercent: null, finalRebateAmountCents: null, rebateRequirement: 'not_required',
      rebateRecipientType: 'unknown', rebateRecipientName: '', rebateProcedureStatus: 'not_required',
      plannedRebateDate: null, paymentStatus: 'pending', paymentReceivedDate: null,
      invoiceRequirement: 'not_required', videoProductionCostCents: 100_000,
      trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    })
    const after = store.repository.getSnapshot().incomeLedgerSummary.business
    expect(after.expectedIncomeCents).toBe(before.expectedIncomeCents + 1_900_000)
    expect(after.expectedNetKnownCount).toBe(before.expectedNetKnownCount + 1)
    expect(after.expectedNetEligibleCount).toBe(before.expectedNetEligibleCount + 1)
    expect(after.recordCount).toBe(before.recordCount + 1)
    expect(after.totalIncomeCents).toBe(before.totalIncomeCents)
    expect(after.actualNetIncomeCents).toBe(before.actualNetIncomeCents)
    expect(after.receivedCents).toBe(before.receivedCents)
    expect(after.pendingCents).toBe(before.pendingCents)
    store.close()
  })

  it('完成和归档后仍保留台账，永久删除项目时把商务历史转成独立台账', async () => {
    const { store } = await createStore()
    store.repository.saveBusinessRecord('sponsor', {
      dealStatus: 'ordered',
      orderPlatform: '花火', orderDate: '2026-07-20', quotedAmountCents: 5_000_000, platformOrderAmountCents: 4_800_000,
      finalRebateRatePercent: 10, finalRebateAmountCents: null, rebateRequirement: 'required',
      rebateRecipientType: 'corporate', rebateRecipientName: '合作方', rebateProcedureStatus: 'preparing',
      plannedRebateDate: null, paymentStatus: 'pending', paymentReceivedDate: null,
      invoiceRequirement: 'pending_confirmation', videoProductionCostCents: 0,
      trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    })
    expect(store.repository.setProjectLifecycle('sponsor', 'completed').topicStageRole).toBe('completed')
    expect(store.repository.listBusinessLedger().some((entry) => entry.projectId === 'sponsor')).toBe(true)
    expect(store.repository.setProjectLifecycle('sponsor', 'archived').topicStageRole).toBe('archived')
    expect(store.repository.listBusinessLedger().some((entry) => entry.projectId === 'sponsor')).toBe(true)
    store.repository.trashProject('sponsor')
    store.repository.permanentlyDeleteProject('sponsor')
    const converted = store.repository.listBusinessLedger().find((entry) => entry.projectTitle === '无线麦克风商单')
    expect(converted).toMatchObject({ ledgerOnly: true, platformOrderAmountCents: 4_800_000 })
    expect(converted?.projectId).toBe('sponsor')
    store.close()
  })

  it('支持多条返点发票记录，并只接受确认的四种商务文件角色', async () => {
    const { store, directory } = await createStore()
    store.repository.saveBusinessRecord('sponsor', {
      dealStatus: 'ordered',
      orderPlatform: '平台', orderDate: '2026-07-20', quotedAmountCents: null, platformOrderAmountCents: 6_800_000,
      finalRebateRatePercent: 10, finalRebateAmountCents: null, rebateRequirement: 'required',
      rebateRecipientType: 'corporate', rebateRecipientName: '返点方', rebateProcedureStatus: 'complete',
      plannedRebateDate: null, paymentStatus: 'received', paymentReceivedDate: '2026-07-20',
      invoiceRequirement: 'required', videoProductionCostCents: 0, trafficPromotionCostCents: 0,
      incomeAttributionDate: '2026-07-20', notes: ''
    })
    store.repository.saveRebatePayment('sponsor', null, { amountCents: 680_000, paidDate: '2026-07-21', notes: '' })
    let data = store.repository.saveBusinessInvoice('sponsor', null, {
      issuerName: '返点方', amountCents: 3_400_000, issuedDate: '2026-07-22', status: 'issued', deliveredToClient: false, notes: ''
    })
    data = store.repository.saveBusinessInvoice('sponsor', null, {
      issuerName: '返点方', amountCents: 3_400_000, issuedDate: null, status: 'pending', deliveredToClient: false, notes: ''
    })
    expect(data.invoices).toHaveLength(2)
    expect(data.record).toMatchObject({ invoiceExecutionStatus: 'pending', ledgerStatus: 'invoice_pending' })
    expect(store.repository.listBusinessLedger().find((item) => item.projectId === 'sponsor')?.invoiceIssuedCents).toBe(3_400_000)
    expect(store.repository.saveBusinessInvoice('sponsor', null, {
      issuerName: '返点方', amountCents: 100, issuedDate: null, status: 'issued', deliveredToClient: false, notes: ''
    }).invoices).toHaveLength(3)

    const common = { projectId: 'sponsor', name: 'proof.pdf', bytes: new Uint8Array([37, 80, 68, 70, 45]), rebatePaymentId: null, invoiceId: null }
    expect(businessFileImportPayloadSchema.parse({ ...common, role: 'rebate_contract' }).role).toBe('rebate_contract')
    expect(businessFileImportPayloadSchema.parse({ ...common, role: 'invoice_file' }).role).toBe('invoice_file')
    expect(businessFileImportPayloadSchema.parse({ ...common, role: 'rebate_payment_proof' }).role).toBe('rebate_payment_proof')
    expect(businessFileImportPayloadSchema.parse({ ...common, role: 'chat_screenshot' }).role).toBe('chat_screenshot')
    expect(() => businessFileImportPayloadSchema.parse({ ...common, role: 'cooperation_terms' })).toThrow()

    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getProject('sponsor', false).business?.invoices).toHaveLength(3)
    reopened.close()
  })

  it('无需上传或录入发票也能手动标记已收到，并可撤销且保留操作历史', async () => {
    const { store } = await createStore()
    const input = {
      dealStatus: 'ordered' as const,
      orderPlatform: 'B站', orderDate: '2026-08-14', quotedAmountCents: null, platformOrderAmountCents: 100_000,
      finalRebateRatePercent: null, finalRebateAmountCents: null, rebateRequirement: 'not_required' as const,
      rebateRecipientType: 'unknown' as const, rebateRecipientName: '', rebateProcedureStatus: 'not_required' as const,
      plannedRebateDate: null, paymentStatus: 'pending' as const, paymentReceivedDate: null,
      invoiceRequirement: 'required' as const, videoProductionCostCents: 0,
      trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    }

    let data = store.repository.saveBusinessRecord('sponsor', { ...input, invoiceReceivedManually: true })
    expect(data).toMatchObject({
      invoices: [],
      record: {
        invoiceRequirement: 'required',
        invoiceExecutionStatus: 'issued',
        invoiceReceivedManuallyAt: expect.any(String)
      }
    })
    const receivedAt = data.record.invoiceReceivedManuallyAt

    data = store.repository.saveBusinessRecord('sponsor', input)
    expect(data.record).toMatchObject({ invoiceExecutionStatus: 'issued', invoiceReceivedManuallyAt: receivedAt })

    data = store.repository.saveBusinessRecord('sponsor', { ...input, invoiceReceivedManually: false })
    expect(data.record).toMatchObject({ invoiceExecutionStatus: 'pending', invoiceReceivedManuallyAt: null })
    expect(data.events.map((event) => event.summary)).toEqual(expect.arrayContaining([
      '创建商务台账并手动标记已收到返点发票', '取消手动确认返点发票'
    ]))

    data = store.repository.saveBusinessRecord('sponsor', { ...input, invoiceRequirement: 'not_required', invoiceReceivedManually: true })
    expect(data.record).toMatchObject({ invoiceExecutionStatus: 'not_required', invoiceReceivedManuallyAt: null })
    store.close()
  })

  it('同一发票或凭证可以关联多单，并让关联项目共享转账证据', async () => {
    const { store, directory } = await createStore()
    const second = store.repository.createProject({
      title: '第二个商单', description: '', contentTypeId: 'type-commercial',
      templateId: 'template-commercial', colorToken: 'project-4', platformTargets: ['小红书']
    })
    const saveReceivedBusiness = (projectId: string) => store.repository.saveBusinessRecord(projectId, {
      dealStatus: 'ordered',
      orderPlatform: '平台', orderDate: '2026-07-20', quotedAmountCents: null, platformOrderAmountCents: 100_000,
      finalRebateRatePercent: 10, finalRebateAmountCents: null, rebateRequirement: 'required',
      rebateRecipientType: 'unknown', rebateRecipientName: '', rebateProcedureStatus: 'complete',
      plannedRebateDate: null, paymentStatus: 'received', paymentReceivedDate: '2026-07-20',
      invoiceRequirement: 'not_required', videoProductionCostCents: 0, trafficPromotionCostCents: 0,
      incomeAttributionDate: '2026-07-20', notes: ''
    })
    saveReceivedBusiness('sponsor')
    saveReceivedBusiness(second.id)
    const sharedInvoice = store.repository.saveBusinessInvoice('sponsor', null, {
      amountCents: 200_000, issuedDate: '2026-07-21', status: 'issued', deliveredToClient: true, notes: '两单共用',
      linkedProjectIds: ['sponsor', second.id]
    }).invoices[0]!
    expect(sharedInvoice).toMatchObject({ sharedProjectCount: 2, linkedProjectIds: expect.arrayContaining(['sponsor', second.id]) })
    expect(store.repository.getBusinessProjectData(second.id).invoices).toEqual([
      expect.objectContaining({ id: sharedInvoice.id, projectId: 'sponsor', sharedProjectCount: 2 })
    ])
    const sponsorPayment = store.repository.saveRebatePayment('sponsor', null, { amountCents: 10_000, paidDate: '2026-07-20', notes: '' }).rebatePayment!
    store.repository.saveRebatePayment(second.id, null, { amountCents: 10_000, paidDate: '2026-07-20', notes: '' })
    const retained = await retainBusinessFile(directory, 'sponsor', 'rebate_payment_proof', '两单共用转账记录.pdf', new TextEncoder().encode('%PDF-1.7\nshared proof'))
    let sponsorData = store.repository.createBusinessFile({
      projectId: 'sponsor', role: 'rebate_payment_proof', file: retained, rebatePaymentId: sponsorPayment.id, invoiceId: null, linkedProjectIds: [second.id]
    })
    expect(sponsorData.files[0]).toMatchObject({ sharedProjectCount: 2, linkedProjectIds: expect.arrayContaining(['sponsor', second.id]) })
    expect(store.repository.getBusinessProjectData(second.id)).toMatchObject({
      files: [expect.objectContaining({ fileName: '两单共用转账记录.pdf', sharedProjectCount: 2 })],
      record: expect.objectContaining({ rebateExecutionStatus: 'completed', ledgerStatus: 'completed', lifecycleStatus: 'settled' })
    })
    expect(() => store.repository.setBusinessFileProjects(second.id, sponsorData.files[0]!.id, [second.id])).toThrow('只有文件所属项目可以修改共用商单')
    sponsorData = store.repository.setBusinessFileProjects('sponsor', sponsorData.files[0]!.id, ['sponsor'])
    expect(sponsorData.files[0]).toMatchObject({ sharedProjectCount: 1, linkedProjectIds: ['sponsor'] })
    expect(store.repository.getBusinessProjectData(second.id).files).toEqual([])
    expect(store.repository.getBusinessProjectData(second.id).record).toMatchObject({
      rebateExecutionStatus: 'completed', ledgerStatus: 'completed'
    })
    store.close()
  })

  it('支持收益月份、按金额返点和商务回收站恢复', async () => {
    const { store } = await createStore()
    const entry = store.repository.saveStandaloneBusinessLedgerEntry(null, '只填收益月份', {
      orderPlatform: '小红书', orderDate: null, revenueMonth: '2026-03', quotedAmountCents: null, platformOrderAmountCents: 100_000,
      rebateInputMode: 'amount', finalRebateRatePercent: null, finalRebateAmountCents: 12_345, rebateRequirement: 'required',
      rebateRecipientType: 'unknown', rebateRecipientName: '', rebateProcedureStatus: 'preparing',
      plannedRebateDate: null, paymentStatus: 'pending', paymentReceivedDate: null, invoiceRequirement: 'not_required',
      videoProductionCostCents: 0, trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    })
    expect(entry).toMatchObject({
      revenueMonth: '2026-03',
      effectiveIncomeAttributionDate: '2026-03-01',
      rebateInputMode: 'amount',
      effectiveFinalRebateAmountCents: 12_345
    })
    store.repository.trashBusinessLedgerEntry(entry.projectId)
    expect(store.repository.listBusinessLedger().some((item) => item.projectId === entry.projectId)).toBe(false)
    expect(store.repository.listBusinessLedger(true)).toEqual([expect.objectContaining({ projectId: entry.projectId, trashedAt: expect.any(String) })])
    store.repository.restoreBusinessLedgerEntry(entry.projectId)
    expect(store.repository.listBusinessLedger().some((item) => item.projectId === entry.projectId)).toBe(true)
    store.close()
  })

  it('商务台账按待返点、待发票、待回款、已完成排序', async () => {
    const { store } = await createStore()
    const createCommercial = (title: string, colorToken: 'project-4' | 'project-5' | 'project-6' | 'project-7') => store.repository.createProject({
      title, description: '', contentTypeId: 'type-commercial', templateId: 'template-commercial', colorToken, platformTargets: []
    })
    const rebatePending = createCommercial('待返点商单', 'project-4')
    const invoicePending = createCommercial('待发票商单', 'project-5')
    const paymentPending = createCommercial('待回款商单', 'project-6')
    const completed = createCommercial('已完成商单', 'project-7')
    const save = (projectId: string, input: { rebateRequirement: 'required' | 'not_required'; paymentStatus: 'pending' | 'received'; invoiceRequirement: 'required' | 'not_required' }) => store.repository.saveBusinessRecord(projectId, {
      dealStatus: 'ordered',
      orderPlatform: '平台', orderDate: '2026-07-20', quotedAmountCents: null, platformOrderAmountCents: 100_000,
      finalRebateRatePercent: input.rebateRequirement === 'required' ? 10 : null, finalRebateAmountCents: null,
      rebateRequirement: input.rebateRequirement, rebateRecipientType: 'unknown', rebateRecipientName: '',
      rebateProcedureStatus: 'not_required', plannedRebateDate: null, paymentStatus: input.paymentStatus,
      paymentReceivedDate: input.paymentStatus === 'received' ? '2026-07-20' : null, invoiceRequirement: input.invoiceRequirement,
      videoProductionCostCents: 0, trafficPromotionCostCents: 0, incomeAttributionDate: '2026-07-20', notes: ''
    })
    save('sponsor', { rebateRequirement: 'required', paymentStatus: 'received', invoiceRequirement: 'not_required' })
    save(rebatePending.id, { rebateRequirement: 'required', paymentStatus: 'received', invoiceRequirement: 'not_required' })
    save(invoicePending.id, { rebateRequirement: 'required', paymentStatus: 'received', invoiceRequirement: 'required' })
    store.repository.saveRebatePayment(invoicePending.id, null, { amountCents: 10_000, paidDate: '2026-07-20', notes: '' })
    save(paymentPending.id, { rebateRequirement: 'not_required', paymentStatus: 'pending', invoiceRequirement: 'not_required' })
    save(completed.id, { rebateRequirement: 'not_required', paymentStatus: 'received', invoiceRequirement: 'not_required' })

    const relevant = new Set(['sponsor', rebatePending.id, invoicePending.id, paymentPending.id, completed.id])
    expect(store.repository.listBusinessLedger().filter((entry) => relevant.has(entry.projectId)).map((entry) => entry.ledgerStatus)).toEqual([
      'rebate_pending', 'rebate_pending', 'invoice_pending', 'payment_pending', 'completed'
    ])
    store.close()
  })

  it('商单项目自动建立待下单台账，并支持手动结清后撤销', async () => {
    const { store } = await createStore()
    const project = store.repository.createProject({
      title: '自动商务台账', description: '', contentTypeId: 'type-commercial',
      templateId: 'template-commercial', colorToken: 'project-4', platformTargets: ['小红书']
    })
    const initial = store.repository.listBusinessLedger().find((entry) => entry.projectId === project.id)
    expect(initial).toMatchObject({
      dealStatus: 'agreed_pending_order',
      lifecycleStatus: 'agreed_pending_order',
      orderPlatform: '小红书',
      orderPlatformManuallySet: false
    })
    const input = {
      dealStatus: 'ordered' as const, manualSettled: true, orderPlatform: '小红书蒲公英', orderPlatformManuallySet: true,
      orderDate: null, revenueMonth: '2026-07', quotedAmountCents: null, platformOrderAmountCents: 100_000,
      rebateInputMode: 'rate' as const, finalRebateRatePercent: null, finalRebateAmountCents: null,
      rebateRequirement: 'not_required' as const, rebateRecipientType: 'unknown' as const, rebateRecipientName: '',
      rebateProcedureStatus: 'not_required' as const, plannedRebateDate: null, paymentStatus: 'pending' as const,
      paymentReceivedDate: null, invoiceRequirement: 'not_required' as const, videoProductionCostCents: 0,
      trafficPromotionCostCents: 0, incomeAttributionDate: null, notes: ''
    }
    expect(store.repository.saveBusinessRecord(project.id, input).record).toMatchObject({
      lifecycleStatus: 'settled',
      settlementMode: 'manual',
      manualSettledAt: expect.any(String)
    })
    expect(store.repository.saveBusinessRecord(project.id, { ...input, manualSettled: false }).record).toMatchObject({
      lifecycleStatus: 'ordered',
      settlementMode: null,
      manualSettledAt: null
    })
    expect(store.repository.getBusinessProjectData(project.id).events.map((event) => event.action)).toEqual(expect.arrayContaining([
      'manual_settled', 'manual_settlement_canceled'
    ]))
    store.close()
  })

  it('独立台账可完整关联空白商单项目，商务回收站可永久删除', async () => {
    const { store } = await createStore()
    const standalone = store.repository.saveStandaloneBusinessLedgerEntry(null, '待关联商单', {
      dealStatus: 'ordered', manualSettled: false, orderPlatform: '线下直签', orderPlatformManuallySet: true,
      orderDate: '2026-06-02', revenueMonth: '2026-06', quotedAmountCents: null, platformOrderAmountCents: 88_000,
      rebateInputMode: 'amount', finalRebateRatePercent: null, finalRebateAmountCents: 8_000,
      rebateRequirement: 'required', rebateRecipientType: 'corporate', rebateRecipientName: '返点方',
      rebateProcedureStatus: 'preparing', plannedRebateDate: null, paymentStatus: 'pending', paymentReceivedDate: null,
      invoiceRequirement: 'required', videoProductionCostCents: 1_000, trafficPromotionCostCents: 2_000,
      incomeAttributionDate: null, notes: '保留全部信息'
    })
    const target = store.repository.createProject({
      title: '目标内容项目', description: '', contentTypeId: 'type-commercial',
      templateId: 'template-commercial', colorToken: 'project-5', platformTargets: ['B站']
    })
    const linked = store.repository.relinkBusinessLedgerEntry(standalone.projectId, target.id)
    expect(linked).toMatchObject({
      projectId: target.id,
      projectTitle: '目标内容项目',
      ledgerOnly: false,
      platformOrderAmountCents: 88_000,
      notes: '保留全部信息'
    })
    expect(store.repository.listProjects(true, true, true).some((project) => project.id === standalone.projectId)).toBe(false)
    store.repository.trashBusinessLedgerEntry(target.id)
    expect(() => store.repository.permanentlyDeleteBusinessLedgerEntry(target.id)).not.toThrow()
    expect(store.repository.listBusinessLedger(true).some((entry) => entry.projectId === target.id)).toBe(false)
    expect(store.repository.getProject(target.id, false).business).not.toBeNull()
    store.close()
  })

  it('校验商务文件真实签名并保存在App私有目录', async () => {
    const { store, directory } = await createStore()
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\nunit business proof')
    const retained = await retainBusinessFile(directory, 'sponsor', 'rebate_contract', '返点合同.pdf', pdfBytes)
    expect(retained.relativePath).toContain('business-files/sponsor/rebate_contract/')
    expect(retained.originalName).toBe('返点合同.pdf')
    await expect(access(join(directory, retained.relativePath))).resolves.toBeUndefined()
    expect(() => store.repository.createBusinessFile({ projectId: 'sponsor', role: 'rebate_contract', file: retained, rebatePaymentId: 'missing', invoiceId: null })).toThrow('返点记录不存在')
    expect(store.repository.hasBusinessFileContent('sponsor', retained.sha256)).toBe(false)
    store.repository.createBusinessFile({ projectId: 'sponsor', role: 'rebate_contract', file: retained, rebatePaymentId: null, invoiceId: null })
    expect(store.repository.hasBusinessFileContent('sponsor', retained.sha256)).toBe(true)
    await expect(retainBusinessFile(directory, 'sponsor', 'invoice_file', '伪装发票.pdf', new TextEncoder().encode('not a pdf'))).rejects.toThrow('内容与扩展名不符')
    expect(await discardBusinessFile(directory, retained.relativePath)).toBeUndefined()
    await expect(access(join(directory, retained.relativePath))).rejects.toThrow()
    store.close()
  })
})
