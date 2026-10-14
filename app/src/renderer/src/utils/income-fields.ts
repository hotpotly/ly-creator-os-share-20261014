import type { BusinessLedgerEntry, OtherIncomeRecord } from '../../../shared/domain'

export type BusinessIncomeField = 'platform' | 'orderDate' | 'revenueMonth' | 'orderAmount' | 'expectedIncome' | 'payment' | 'rebate' | 'invoice' | 'lifecycle'
export type OtherIncomeField = 'category' | 'source' | 'revenueMonth' | 'incomeDate' | 'amount' | 'expectedIncome' | 'payment'
export type IncomeFieldTarget =
  | { kind: 'business'; record: BusinessLedgerEntry; field: BusinessIncomeField; anchor: HTMLElement }
  | { kind: 'other'; record: OtherIncomeRecord; field: OtherIncomeField; anchor: HTMLElement }
export const incomeFieldLabels = {
  platform: '下单平台', orderDate: '下单日期', revenueMonth: '收益月份', orderAmount: '商单金额', expectedIncome: '预计净收入',
  payment: '回款状态', rebate: '返点', invoice: '返点发票', lifecycle: '商单状态', category: '收入类型', source: '客户或来源', incomeDate: '收入日期', amount: '收入金额'
} as const
