import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { businessRecordPatchPayloadSchema, otherIncomeRecordPatchPayloadSchema } from '../../src/shared/ipc'

const opened: Array<{ root: string; store: WorkspaceStore }> = []
async function fixture(): Promise<WorkspaceStore> {
  const base = join(import.meta.dirname, '../../test-results/unit')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'income-fields-'))
  const store = await openWorkspaceStore(root)
  opened.push({ root, store })
  return store
}
afterEach(async () => { for (const { root, store } of opened.splice(0)) { store.close(); await rm(root, { recursive: true, force: true }) } })

test('局部合同只接受白名单且不为未修改字段注入默认值', () => {
  expect(businessRecordPatchPayloadSchema.parse({ projectId: 'sponsor', patch: { platformOrderAmountCents: 4500000 } }).patch).toEqual({ platformOrderAmountCents: 4500000 })
  expect(otherIncomeRecordPatchPayloadSchema.parse({ recordId: 'income', patch: { amountCents: 200 } }).patch).toEqual({ amountCents: 200 })
  for (const patch of [{ expectedIncomeCents: 1 }, { notes: '不属于这项' }, {}, { platformOrderAmountCents: -1 }, { orderDate: '2026-13-01' }]) {
    expect(businessRecordPatchPayloadSchema.safeParse({ projectId: 'sponsor', patch }).success).toBe(false)
  }
  expect(otherIncomeRecordPatchPayloadSchema.safeParse({ recordId: 'income', patch: { sourceHash: '覆盖来源' } }).success).toBe(false)
})

test('商单局部修改保留最新事实，按比例重算净收入，拒绝覆盖发票证据及回收记录', async () => {
  const store = await fixture()
  const repository = store.repository
  const current = repository.getBusinessProjectData('sponsor').record
  repository.saveBusinessRecord('sponsor', { ...current, dealStatus: 'ordered', orderDate: '2026-09-10', revenueMonth: null, platformOrderAmountCents: 1_000_000,
    rebateRequirement: 'required', rebateInputMode: 'rate', finalRebateRatePercent: 10, finalRebateAmountCents: 100_000,
    invoiceRequirement: 'required', invoiceReceivedManually: true, videoProductionCostCents: 20_000, trafficPromotionCostCents: 30_000,
    notes: '最新备注不能丢失', rebateRecipientType: 'personal', plannedRebateDate: '2026-10-01' })
  const updated = repository.patchBusinessRecord('sponsor', { platformOrderAmountCents: 2_000_000 }).record
  expect(updated).toMatchObject({ platformOrderAmountCents: 2_000_000, effectiveFinalRebateAmountCents: 200_000, expectedIncomeCents: 1_750_000,
    revenueMonth: null, notes: '最新备注不能丢失', rebateRecipientType: 'personal', plannedRebateDate: '2026-10-01', invoiceReceivedManuallyAt: expect.any(String) })
  const eventCount = repository.getBusinessProjectData('sponsor').events.length
  repository.patchBusinessRecord('sponsor', { platformOrderAmountCents: 2_000_000 })
  expect(repository.getBusinessProjectData('sponsor').events.length).toBe(eventCount)
  repository.patchBusinessRecord('sponsor', { paymentStatus: 'received', paymentReceivedDate: '2026-09-11' })
  expect(repository.patchBusinessRecord('sponsor', { paymentStatus: 'pending' }).record.paymentReceivedDate).toBeNull()
  repository.saveBusinessInvoice('sponsor', null, { issuerName: '返点方', amountCents: 100, issuedDate: null, status: 'issued', deliveredToClient: false, notes: '', linkedProjectIds: ['sponsor'] })
  expect(() => repository.patchBusinessRecord('sponsor', { invoiceReceivedManually: false, invoiceRequirement: 'required' })).toThrow('已有发票资料')
  repository.trashBusinessLedgerEntry('sponsor')
  expect(() => repository.patchBusinessRecord('sponsor', { orderPlatform: 'B站' })).toThrow('回收站')
})

test('其他收入局部更新不重建记录或覆盖成本、来源及附件，回款日期保持一致', async () => {
  const repository = (await fixture()).repository
  const record = repository.saveOtherIncomeRecord(null, { title: '只改单项', categoryId: null, sourceName: '原客户', revenueMonth: '2026-09', incomeDate: '2026-09-10',
    amountCents: 100_000, directCostCents: 12_000, paymentStatus: 'received', paymentReceivedDate: '2026-09-11', status: 'active', currency: 'CNY', notes: '保留备注', sourceHash: 'abc', sourceTransactionId: 'external-1', sourceReference: '原始凭证' })
  repository.patchOtherIncomeRecord(record.id, { sourceName: '新客户' })
  const updated = repository.patchOtherIncomeRecord(record.id, { amountCents: 200_000 })
  expect(updated).toMatchObject({ id: record.id, sourceName: '新客户', directCostCents: 12_000, expectedIncomeCents: 188_000, notes: '保留备注', sourceHash: 'abc', sourceTransactionId: 'external-1', sourceReference: '原始凭证' })
  expect(repository.patchOtherIncomeRecord(record.id, { paymentStatus: 'pending' }).paymentReceivedDate).toBeNull()
  repository.trashOtherIncomeRecord(record.id)
  expect(() => repository.patchOtherIncomeRecord(record.id, { amountCents: 1 })).toThrow('回收站')
})
