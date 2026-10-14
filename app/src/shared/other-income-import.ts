import type {
  OtherIncomeCompanyAlias,
  OtherIncomeDuplicateConfidence,
  OtherIncomeImportCandidate,
  OtherIncomeImportRuleConditions,
  OtherIncomeImportSourceRow,
  OtherIncomeRecord
} from './domain'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ')
const compactText = (value: string): string => normalizeText(value).toLowerCase()
const unique = (values: string[]): string[] => [...new Set(values.map(normalizeText).filter(Boolean))]

function stableHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function moneyToCents(raw: string): number | null {
  const normalized = raw.replace(/[¥￥,\s]/g, '').replace(/元$/, '')
  if (!normalized || !/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.round(Math.abs(value) * 100) : null
}

function normalizeDate(raw: string): string | null {
  const value = raw.trim().replace(/[/.年]/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/-+/g, '-')
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return null
  const normalized = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`
  return DATE_PATTERN.test(normalized) ? normalized : null
}

function normalizeCurrency(raw: string): string {
  const value = compactText(raw)
  if (!value || /^(?:cny|rmb|人民币|人民币元|元)$/.test(value)) return 'CNY'
  if (/^(?:usd|美元|美金)$/.test(value)) return 'USD'
  if (/^(?:hkd|港币|港元)$/.test(value)) return 'HKD'
  if (/^(?:eur|欧元)$/.test(value)) return 'EUR'
  if (/^(?:jpy|日元)$/.test(value)) return 'JPY'
  return normalizeText(raw).toUpperCase()
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim())
      current = ''
    } else current += char
  }
  cells.push(current.trim())
  return cells
}

const compactHeader = (value: string): string => compactText(value).replace(/[\s/\\（）()【】[\]_-]/g, '')

function headerIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map(compactHeader)
  for (const candidate of candidates.map(compactHeader)) {
    const index = normalized.findIndex((header) => header.includes(candidate))
    if (index >= 0) return index
  }
  return -1
}

interface DelimitedHeader {
  delimiter: string
  lineIndex: number
  headers: string[]
}

function findDelimitedHeader(lines: string[]): DelimitedHeader | null {
  let best: (DelimitedHeader & { score: number }) | null = null
  for (const delimiter of ['\t', ',']) {
    lines.slice(0, 80).forEach((line, lineIndex) => {
      if (!line.includes(delimiter)) return
      const headers = parseCsvLine(line, delimiter)
      const amountIndex = headerIndex(headers, ['收入金额', '到账金额', '交易金额', '结算金额', '收款金额', '入账金额', '订单金额', '金额', '收益'])
      if (amountIndex < 0) return
      const score = [
        headerIndex(headers, ['交易日期', '交易时间', '到账日期', '收入日期', '账单日期', '创建时间', '付款时间', '日期', '时间']),
        headerIndex(headers, ['付款方', '付方名称', '付款人名称', '付款人', '汇款人名称', '汇款人', '交易对方', '对方名称', '对方户名', '客户', '公司', '来源']),
        headerIndex(headers, ['收支方向', '交易方向', '收支类型', '收支', '类型']),
        headerIndex(headers, ['流水号', '交易单号', '交易号', '账单号', '订单号', 'transactionid']),
        headerIndex(headers, ['收入名称', '项目名称', '交易名称', '商品名称', '商品说明', '商品', '摘要', '备注', '名称', '交易类型'])
      ].filter((index) => index >= 0).length
      if (!best || score > best.score) best = { delimiter, lineIndex, headers, score }
    })
  }
  return best
}

function inferDirection(value: string, amountRaw: string, positiveMeansIncome = false): OtherIncomeImportSourceRow['direction'] {
  const text = compactText(`${value} ${amountRaw}`)
  if (/退款|退回|refund/.test(text)) return 'refund'
  if (/互转|内部转账|账户转账|转入余额|transfer/.test(text)) return 'transfer'
  if (/支出|付款|消费|扣款|expense/.test(text) || /^-/.test(amountRaw.trim())) return 'expense'
  if (/收入|收款|入账|到账|转入|结算|income|credit/.test(text)) return 'income'
  if (positiveMeansIncome && (moneyToCents(amountRaw) ?? 0) > 0) return 'income'
  return 'unknown'
}

function inferPaymentStatus(value: string, direction: OtherIncomeImportSourceRow['direction'], explicitDirection = false): OtherIncomeImportSourceRow['paymentStatus'] {
  const text = compactText(value)
  if (/已到账|已入账|已收款|已支付|已结算|成功|完成|received|paid|settled/.test(text)) return 'received'
  if (/待到账|未回款|待结算|pending/.test(text)) return 'pending'
  if (explicitDirection && direction === 'income') return 'received'
  return null
}

export function parseDelimitedIncomeRows(source: string): { rows: OtherIncomeImportSourceRow[]; errors: string[] } {
  const lines = source.replace(/\r/g, '').split('\n').map((line) => line.trimEnd()).filter((line) => Boolean(line.trim()))
  if (!lines.length) return { rows: [], errors: ['没有可识别的收入内容'] }
  const table = findDelimitedHeader(lines)
  if (!table) {
    if (lines.some((line) => line.includes('\t') || line.includes(','))) {
      return { rows: [], errors: ['没有找到金额列；支持“金额(元)”“交易金额”“收入金额”等常见表头'] }
    }
    return parseLooseIncomeRows(lines)
  }
  const { delimiter, lineIndex: headerLineIndex, headers } = table
  const titleIndex = headerIndex(headers, ['收入名称', '项目名称', '交易名称', '商品名称', '商品说明', '商品', '摘要', '备注', '名称', '交易类型'])
  const payerIndex = headerIndex(headers, ['付款方', '付方名称', '付款人名称', '付款人', '汇款人名称', '汇款人', '交易对方', '对方名称', '对方户名', '客户', '公司', '来源'])
  const dateIndex = headerIndex(headers, ['交易日期', '交易时间', '到账日期', '收入日期', '账单日期', '创建时间', '付款时间', '日期', '时间'])
  const monthIndex = headerIndex(headers, ['收益月份', '收入月份', '账单月份', '月份'])
  const amountIndex = headerIndex(headers, ['收入金额', '到账金额', '交易金额', '结算金额', '收款金额', '入账金额', '订单金额', '金额', '收益'])
  const directionIndex = headerIndex(headers, ['收支方向', '交易方向', '收支类型', '收支', '类型'])
  const statusIndex = headerIndex(headers, ['回款状态', '到账状态', '交易状态', '当前状态', '资金状态', '状态'])
  const idIndex = headerIndex(headers, ['流水号', '交易单号', '交易号', '账单号', '订单号', 'transactionid'])
  const currencyIndex = headerIndex(headers, ['币种', 'currency'])
  const signedAmountColumn = lines.slice(headerLineIndex + 1).some((line) => {
    const amount = parseCsvLine(line, delimiter)[amountIndex] ?? ''
    return /^-\s*[¥￥]?\d/.test(amount.trim())
  })
  const errors: string[] = []
  const rows = lines.slice(headerLineIndex + 1).flatMap((line, offset) => {
    const cells = parseCsvLine(line, delimiter)
    const amountRaw = cells[amountIndex] ?? ''
    const amountCents = moneyToCents(amountRaw)
    const rowNumber = headerLineIndex + offset + 2
    if (amountCents === null) {
      errors.push(`第${rowNumber}行金额无法识别`)
      return []
    }
    const payer = normalizeText(payerIndex >= 0 ? cells[payerIndex] ?? '' : '')
    const summary = normalizeText(titleIndex >= 0 ? cells[titleIndex] ?? '' : '')
    const directionText = directionIndex >= 0 ? cells[directionIndex] ?? '' : ''
    const direction = inferDirection(`${directionText} ${summary} ${headers[amountIndex] ?? ''}`, amountRaw, signedAmountColumn)
    const date = normalizeDate(dateIndex >= 0 ? cells[dateIndex] ?? '' : '')
    const monthValue = monthIndex >= 0 ? (cells[monthIndex] ?? '').trim() : ''
    return [{
      rowNumber,
      title: summary || payer || `收入记录${rowNumber}`,
      payer,
      transactionDate: date,
      revenueMonth: MONTH_PATTERN.test(monthValue) ? monthValue : date?.slice(0, 7) ?? null,
      amountCents,
      direction,
      paymentStatus: inferPaymentStatus(`${statusIndex >= 0 ? cells[statusIndex] ?? '' : ''} ${summary}`, direction, directionIndex >= 0 && Boolean(directionText.trim())),
      externalTransactionId: normalizeText(idIndex >= 0 ? cells[idIndex] ?? '' : ''),
      summary,
      currency: normalizeCurrency(currencyIndex >= 0 ? cells[currencyIndex] ?? 'CNY' : 'CNY'),
      rawText: line
    } satisfies OtherIncomeImportSourceRow]
  })
  return { rows, errors }
}

function parseLooseIncomeRows(lines: string[]): { rows: OtherIncomeImportSourceRow[]; errors: string[] } {
  const rows: OtherIncomeImportSourceRow[] = []
  const errors: string[] = []
  lines.forEach((line, index) => {
    const rawDate = line.match(/\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?/)?.[0] ?? ''
    const date = normalizeDate(rawDate)
    const withoutDate = rawDate ? line.replace(rawDate, ' ') : line
    const moneyMatch = [...withoutDate.matchAll(/[¥￥]?\s*-?\d[\d,]*(?:\.\d{1,2})?\s*元?/g)].at(-1)?.[0] ?? ''
    const amountCents = moneyToCents(moneyMatch)
    if (amountCents === null) {
      errors.push(`第${index + 1}行缺少可识别金额`)
      return
    }
    const company = line.match(/[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,}(?:有限责任公司|股份有限公司|有限公司|公司|工作室|平台)/)?.[0] ?? ''
    const direction = inferDirection(line, moneyMatch)
    rows.push({
      rowNumber: index + 1,
      title: normalizeText(line.replace(moneyMatch, '').replace(date ?? '', '').slice(0, 80)) || company || `收入记录${index + 1}`,
      payer: company,
      transactionDate: date,
      revenueMonth: date?.slice(0, 7) ?? null,
      amountCents,
      direction,
      paymentStatus: inferPaymentStatus(line, direction),
      externalTransactionId: line.match(/(?:流水号|交易号|订单号|账单号)[:：\s]*([A-Za-z0-9_-]+)/)?.[1] ?? '',
      summary: normalizeText(line),
      currency: /(?:USD|美元)/i.test(line) ? 'USD' : /(?:HKD|港币)/i.test(line) ? 'HKD' : 'CNY',
      rawText: line
    })
  })
  return { rows, errors }
}

function extractQuotedValues(instruction: string): string[] {
  return [...instruction.matchAll(/[“"「『]([^”"」』]{1,80})[”"」』]/g)].map((match) => match[1]!)
}

function cleanCompany(value: string): string {
  const markers = [...value.matchAll(/(?:只需要|只保留|只筛选|只提取|仅提取|只查看|只看|筛选出|提取出|筛选|提取|只要)/g)]
  const lastMarker = markers.at(-1)
  const afterSelection = lastMarker
    ? value.slice((lastMarker.index ?? 0) + lastMarker[0].length)
    : value
  return afterSelection.trim()
    .replace(/^[，,、；;\s]*(?:(?:我(?:的)?|在|从)?(?:银行)?(?:流水|账单|转账记录|交易记录)(?:里|中|内)?|今年|本年度|本月|来自|从|由|排除|不要|忽略|以及|和|与)+/, '')
    .replace(/^[的地得\s]+/, '')
}

function extractMoneyBoundary(instruction: string, kind: 'min' | 'max'): number | null {
  const pattern = kind === 'min'
    ? /(?:不少于|不低于|大于等于|至少|金额大于)\s*[¥￥]?\s*(\d[\d,.]*)/
    : /(?:不超过|不高于|小于等于|至多|金额小于)\s*[¥￥]?\s*(\d[\d,.]*)/
  const value = instruction.match(pattern)?.[1]
  return value ? moneyToCents(value) : null
}

export function parseOtherIncomeRuleInstruction(
  instruction: string,
  options?: { today?: string; categoryId?: string | null }
): OtherIncomeImportRuleConditions {
  const text = normalizeText(instruction)
  const today = DATE_PATTERN.test(options?.today ?? '') ? options!.today! : new Date().toISOString().slice(0, 10)
  const quoted = extractQuotedValues(text)
  const explicitCompanies = [...text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,40}?(?:有限责任公司|股份有限公司|有限公司|公司|工作室|平台)/g)]
    .map((match) => cleanCompany(match[0]))
  const excludePart = text.match(/(?:排除|不要|忽略)(.+?)(?:，|。|；|$)/)?.[1] ?? ''
  const excludedCompanies = explicitCompanies.filter((company) => excludePart.includes(company))
  const companies = explicitCompanies.filter((company) => !excludedCompanies.includes(company))
  const excludedQuoted = quoted.filter((value) => excludePart.includes(value))
  const includedQuoted = quoted.filter((value) => !excludedQuoted.includes(value) && !companies.includes(value))
  const plainExcluded = [...excludePart.matchAll(/(?:排除|不要|忽略)?([^，,、；;]+?)(?=和|与|以及|$)/g)]
    .map((match) => match[1]!.trim().replace(/^(?:和|与|以及)+/, '')).filter((value) => value && !/公司|工作室|平台/.test(value))
  const plainIncluded = [...text.matchAll(/(?:摘要|备注)?(?:包含|含有|只要)\s*([^，,、；;]+)/g)]
    .map((match) => match[1]!.trim()).filter((value) => value && !/公司|工作室|平台/.test(value))
  const excludeKeywords = unique([
    ...excludedQuoted,
    ...plainExcluded,
    ...(['退款', '个人账户', '账户互转', '内部转账', '支出'].filter((word) => excludePart.includes(word) || text.includes(`排除${word}`)))
  ])
  const includeKeywords = unique([...includedQuoted, ...plainIncluded])
  let startDate: string | null = null
  let endDate: string | null = null
  if (/今年|本年度/.test(text)) {
    startDate = `${today.slice(0, 4)}-01-01`
    endDate = `${today.slice(0, 4)}-12-31`
  } else if (/本月/.test(text)) {
    const [year, month] = today.split('-').map(Number)
    const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
    startDate = `${today.slice(0, 7)}-01`
    endDate = `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
  }
  const explicitDates = [...text.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0])
  if (explicitDates.length >= 1) startDate = explicitDates[0]!
  if (explicitDates.length >= 2) endDate = explicitDates[1]!
  const revenueMonth = text.match(/收益月份(?:设为|为|：|:)?\s*(\d{4}-(?:0[1-9]|1[0-2]))/)?.[1] ?? null
  return {
    companies: unique([...companies, ...quoted.filter((value) => /公司|工作室|平台/.test(value) && !excludedQuoted.includes(value))]),
    excludedCompanies: unique(excludedCompanies),
    includeKeywords,
    excludeKeywords,
    startDate,
    endDate,
    minimumAmountCents: extractMoneyBoundary(text, 'min'),
    maximumAmountCents: extractMoneyBoundary(text, 'max'),
    direction: 'income',
    paymentStatus: /已到账|已收款|已回款/.test(text) ? 'received' : /未到账|未回款|待回款/.test(text) ? 'pending' : null,
    categoryId: options?.categoryId ?? null,
    revenueMonth: MONTH_PATTERN.test(revenueMonth ?? '') ? revenueMonth : null
  }
}

function resolveCompanyTerms(companies: string[], aliases: OtherIncomeCompanyAlias[]): string[] {
  const normalizedCompanies = companies.map(compactText)
  return unique(companies.flatMap((company) => [
    company,
    ...aliases.filter((alias) => normalizedCompanies.includes(compactText(alias.companyName))).map((alias) => alias.alias)
  ]))
}

function findCompanyMatch(
  terms: string[],
  haystack: string,
  payer: string
): { term: string; mode: 'exact' | 'shorthand'; shorthand: string | null } | null {
  const exact = terms.find((term) => haystack.includes(compactText(term)))
  if (exact) return { term: exact, mode: 'exact', shorthand: null }
  const payerText = compactText(payer)
  for (const term of terms) {
    if (!/公司$/i.test(term) || /(?:有限责任公司|股份有限公司|有限公司)$/i.test(term)) continue
    const shorthand = compactText(term.replace(/公司$/i, ''))
    if (shorthand.length >= 2 && payerText.includes(shorthand)) {
      return { term, mode: 'shorthand', shorthand }
    }
  }
  return null
}

function findDuplicate(
  row: OtherIncomeImportSourceRow,
  existing: OtherIncomeRecord[],
  sourceHash: string
): { confidence: OtherIncomeDuplicateConfidence; recordId: string | null } {
  if (row.externalTransactionId) {
    const exact = existing.find((record) => record.sourceTransactionId && record.sourceTransactionId === row.externalTransactionId)
    if (exact) return { confidence: 'exact', recordId: exact.id }
  }
  const exact = existing.find((record) => (
    record.amountCents === row.amountCents
    && record.incomeDate === row.transactionDate
    && compactText(record.sourceName) === compactText(row.payer)
    && Boolean(record.sourceHash)
    && record.sourceHash === sourceHash
  ))
  if (exact) return { confidence: 'exact', recordId: exact.id }
  const possible = existing.find((record) => (
    record.amountCents === row.amountCents
    && (record.incomeDate === row.transactionDate || compactText(record.sourceName) === compactText(row.payer))
  ))
  return possible ? { confidence: 'possible', recordId: possible.id } : { confidence: 'none', recordId: null }
}

export function buildOtherIncomeImportCandidates(
  rows: OtherIncomeImportSourceRow[],
  conditions: OtherIncomeImportRuleConditions,
  aliases: OtherIncomeCompanyAlias[],
  existing: OtherIncomeRecord[],
  defaultCategoryId: string | null
): OtherIncomeImportCandidate[] {
  const companyTerms = resolveCompanyTerms(conditions.companies, aliases)
  const excludedCompanyTerms = resolveCompanyTerms(conditions.excludedCompanies, aliases)
  return rows.map((row) => {
    const haystack = compactText(`${row.payer} ${row.summary} ${row.rawText}`)
    const matchReasons: string[] = []
    const exclusionReasons: string[] = []
    const evidence: string[] = []
    const warnings: string[] = []
    if (row.payer) evidence.push(`付款方：${row.payer}`)
    if (row.amountCents !== null) evidence.push(`金额：¥${(row.amountCents / 100).toFixed(2)}`)
    if (row.transactionDate) evidence.push(`日期：${row.transactionDate}`)

    if (companyTerms.length) {
      const matchedCompany = findCompanyMatch(companyTerms, haystack, row.payer)
      if (matchedCompany?.mode === 'exact') matchReasons.push(`付款方或摘要明确包含“${matchedCompany.term}”`)
      else if (matchedCompany) matchReasons.push(`付款方“${row.payer}”包含公司简称“${matchedCompany.shorthand}”`)
      else exclusionReasons.push('未命中指定公司或已确认别名')
    }
    const excludedCompany = findCompanyMatch(excludedCompanyTerms, haystack, row.payer)
    if (excludedCompany) exclusionReasons.push(`命中排除公司“${excludedCompany.term}”`)
    conditions.includeKeywords.forEach((keyword) => {
      if (haystack.includes(compactText(keyword))) matchReasons.push(`命中关键词“${keyword}”`)
      else exclusionReasons.push(`未命中必含词“${keyword}”`)
    })
    conditions.excludeKeywords.forEach((keyword) => {
      if (haystack.includes(compactText(keyword))) exclusionReasons.push(`命中排除词“${keyword}”`)
    })
    if (row.direction !== 'income') exclusionReasons.push(row.direction === 'unknown' ? '无法确认这是收入' : `交易方向为${row.direction}`)
    if (conditions.startDate && (!row.transactionDate || row.transactionDate < conditions.startDate)) exclusionReasons.push(`早于${conditions.startDate}或缺少日期`)
    if (conditions.endDate && (!row.transactionDate || row.transactionDate > conditions.endDate)) exclusionReasons.push(`晚于${conditions.endDate}或缺少日期`)
    if (conditions.minimumAmountCents !== null && (row.amountCents ?? -1) < conditions.minimumAmountCents) exclusionReasons.push('金额低于筛选下限')
    if (conditions.maximumAmountCents !== null && (row.amountCents ?? Number.MAX_SAFE_INTEGER) > conditions.maximumAmountCents) exclusionReasons.push('金额高于筛选上限')
    if (conditions.paymentStatus && row.paymentStatus !== conditions.paymentStatus) exclusionReasons.push(`回款状态不是${conditions.paymentStatus === 'received' ? '已回款' : '未回款'}`)
    if (row.amountCents === null || row.amountCents <= 0) exclusionReasons.push('缺少有效收入金额')
    if (row.currency !== 'CNY') warnings.push(`外币${row.currency}不计入人民币总收入`)

    const suspectedBusiness = /商单|花火|蒲公英|星图|广告合作|品牌合作|订单收益/.test(row.rawText)
    if (suspectedBusiness) warnings.push('疑似商单，请确认是否改入商单收入')
    const sourceHash = stableHash(`${row.externalTransactionId}|${row.transactionDate}|${row.payer}|${row.amountCents}|${row.rawText}`)
    const duplicate = findDuplicate(row, existing, sourceHash)
    if (duplicate.confidence === 'exact') warnings.push('与已有收入高度重复')
    if (duplicate.confidence === 'possible') warnings.push('与已有收入疑似重复')
    const matched = exclusionReasons.length === 0
    return {
      ...row,
      id: `income-candidate-${sourceHash}`,
      selected: matched && row.currency === 'CNY' && duplicate.confidence !== 'exact' && !suspectedBusiness,
      categoryId: conditions.categoryId ?? defaultCategoryId,
      directCostCents: 0,
      matched,
      matchReasons: matchReasons.length ? matchReasons : matched ? ['符合收入方向与基础条件'] : [],
      exclusionReasons,
      evidence,
      warnings,
      duplicateConfidence: duplicate.confidence,
      duplicateRecordId: duplicate.recordId,
      suspectedBusiness,
      sourceHash
    }
  })
}
