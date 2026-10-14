import type { BusinessLedgerStatus } from '../../../shared/domain'

export const ledgerStatusLabels: Record<BusinessLedgerStatus, string> = {
  agreed_pending_order: '已谈妥·待下单',
  missing_transfer_proof: '缺转账记录',
  rebate_pending: '待返点',
  invoice_pending: '待收返点发票',
  payment_pending: '待回款',
  completed: '已结清',
  canceled: '已取消'
}
