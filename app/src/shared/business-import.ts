import type { BusinessRecordInput } from './domain'

export interface BilibiliImportDefaults {
  revenueMonth: string | null
  rebateRequirement: BusinessRecordInput['rebateRequirement']
  invoiceRequirement: BusinessRecordInput['invoiceRequirement']
}

export interface BilibiliImportParseResult {
  items: Array<{ title: string; record: BusinessRecordInput }>
  errors: string[]
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1 } else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      fields.push(current.trim())
      current = ''
    } else current += character
  }
  fields.push(current.trim())
  return fields
}

function headerIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)))
}

function normalizedDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!match) return null
  const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`
  return Number.isNaN(new Date(`${date}T00:00:00`).getTime()) ? null : date
}

function normalizedMonth(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[-/.年](\d{1,2})/)
  return match ? `${match[1]}-${match[2]!.padStart(2, '0')}` : null
}

function amountCents(value: string): number | null {
  const amount = Number(value.replace(/[¥￥,\s元]/g, ''))
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
}

export function parseBilibiliHuahuoRows(source: string, defaults: BilibiliImportDefaults): BilibiliImportParseResult {
  const lines = source.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return { items: [], errors: ['请粘贴包含表头和至少一条账单的数据'] }
  const delimiter = lines[0]!.includes('\t') ? '\t' : ','
  const headers = splitCsvLine(lines[0]!, delimiter).map((header) => header.replace(/\s/g, '').toLowerCase())
  const titleIndex = headerIndex(headers, ['订单名称', '项目名称', '商单名称', '任务名称', '名称'])
  const amountIndex = headerIndex(headers, ['订单收益', '收益金额', '结算金额', '金额', '收益'])
  const dateIndex = headerIndex(headers, ['账单生成日期', '生成日期', '下单日期', '日期', '时间'])
  const monthIndex = headerIndex(headers, ['收益月份', '账单月份', '结算月份', '月份'])
  const statusIndex = headerIndex(headers, ['账单状态', '结算状态', '状态'])
  const orderIdIndex = headerIndex(headers, ['订单号', '订单id'])
  const billIdIndex = headerIndex(headers, ['账单号', '账单id'])
  if (titleIndex < 0 || amountIndex < 0) return { items: [], errors: ['表头至少需要“订单名称”和“订单收益”两列'] }

  const errors: string[] = []
  const items = lines.slice(1).flatMap((line, offset) => {
    const row = splitCsvLine(line, delimiter)
    const title = row[titleIndex]?.trim() ?? ''
    const amount = amountCents(row[amountIndex] ?? '')
    if (!title || amount == null) {
      errors.push(`第${offset + 2}行缺少订单名称或金额`)
      return []
    }
    const orderDate = dateIndex >= 0 ? normalizedDate(row[dateIndex] ?? '') : null
    const revenueMonth = monthIndex >= 0
      ? normalizedMonth(row[monthIndex] ?? '')
      : defaults.revenueMonth ?? orderDate?.slice(0, 7) ?? null
    const sourceStatus = statusIndex >= 0 ? row[statusIndex]?.trim() ?? '' : ''
    const paymentStatus: BusinessRecordInput['paymentStatus'] = /(已结算|已支付|已回款|已到账|完成)/.test(sourceStatus) ? 'received' : 'pending'
    const ids = [
      orderIdIndex >= 0 && row[orderIdIndex] ? `订单号：${row[orderIdIndex]}` : '',
      billIdIndex >= 0 && row[billIdIndex] ? `账单号：${row[billIdIndex]}` : '',
      sourceStatus ? `花火状态：${sourceStatus}` : ''
    ].filter(Boolean)
    const record: BusinessRecordInput = {
      dealStatus: 'ordered',
      manualSettled: false,
      orderPlatform: 'B站花火',
      orderPlatformManuallySet: true,
      orderDate,
      revenueMonth,
      quotedAmountCents: null,
      platformOrderAmountCents: amount,
      rebateInputMode: 'rate',
      finalRebateRatePercent: null,
      finalRebateAmountCents: null,
      rebateRequirement: defaults.rebateRequirement,
      rebateRecipientType: 'unknown',
      rebateRecipientName: '',
      rebateProcedureStatus: defaults.rebateRequirement === 'not_required' ? 'not_required' : 'preparing',
      plannedRebateDate: null,
      paymentStatus,
      paymentReceivedDate: paymentStatus === 'received' ? orderDate : null,
      invoiceRequirement: defaults.invoiceRequirement,
      videoProductionCostCents: 0,
      trafficPromotionCostCents: 0,
      incomeAttributionDate: null,
      notes: ids.join('；')
    }
    return [{ title, record }]
  })
  return { items, errors }
}
