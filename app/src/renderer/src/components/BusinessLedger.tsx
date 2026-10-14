import { incomeFieldLabels, type BusinessIncomeField } from '../utils/income-fields'
import { ArrowDown, ArrowUp, BriefcaseBusiness, Columns3, MoreHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BusinessLedgerEntry, BusinessLifecycleStatus, BusinessPaymentStatus, InvoiceExecutionStatus, RebateExecutionStatus } from '../../../shared/domain'

const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 })
const money = (cents: number | null): string => cents == null ? '—' : currency.format(cents / 100)

export type BusinessTimeRange = 'month' | 'quarter' | 'year' | 'all' | 'custom'
export type BusinessRebateFilter = '' | 'pending_confirmation' | 'not_required' | 'pending' | 'completed'
export type BusinessInvoiceFilter = '' | InvoiceExecutionStatus

interface BusinessLedgerProps {
  entries: BusinessLedgerEntry[]
  timeRange: BusinessTimeRange
  customStart: string
  customEnd: string
  platform: string
  query: string
  lifecycleStatus: '' | BusinessLifecycleStatus
  paymentStatus: '' | BusinessPaymentStatus
  rebateStatus: BusinessRebateFilter
  invoiceStatus: BusinessInvoiceFilter
  onSelect(projectId: string): void
  onCreateStandalone(): void
  onField(projectId: string, field: BusinessIncomeField, anchor: HTMLElement): void
  onToggleSettled(projectId: string, settled: boolean): void
  onRelink(projectId: string): void
  onTrash(projectId: string): void
}

type ColumnId = 'record' | 'platform' | 'orderDate' | 'revenueMonth' | 'orderAmount' | 'expectedIncome' | 'payment' | 'rebate' | 'invoice'
type SortableColumnId = 'orderDate' | 'revenueMonth' | 'orderAmount' | 'expectedIncome'
interface ColumnDefinition {
  id: ColumnId
  label: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  sortable: boolean
}
interface StoredColumnState {
  order: ColumnId[]
  hidden: ColumnId[]
  widths: Partial<Record<ColumnId, number>>
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { id: 'record', label: '商务记录', defaultWidth: 236, minWidth: 180, maxWidth: 480, sortable: false },
  { id: 'platform', label: '下单平台', defaultWidth: 112, minWidth: 82, maxWidth: 200, sortable: false },
  { id: 'orderDate', label: '下单日期', defaultWidth: 112, minWidth: 96, maxWidth: 180, sortable: true },
  { id: 'revenueMonth', label: '收益月份', defaultWidth: 104, minWidth: 88, maxWidth: 170, sortable: true },
  { id: 'orderAmount', label: '商单金额', defaultWidth: 126, minWidth: 104, maxWidth: 220, sortable: true },
  { id: 'expectedIncome', label: '预计净收入', defaultWidth: 132, minWidth: 112, maxWidth: 230, sortable: true },
  { id: 'payment', label: '回款', defaultWidth: 112, minWidth: 96, maxWidth: 190, sortable: false },
  { id: 'rebate', label: '返点', defaultWidth: 112, minWidth: 96, maxWidth: 190, sortable: false },
  { id: 'invoice', label: '返点发票', defaultWidth: 132, minWidth: 108, maxWidth: 220, sortable: false }
]
const COLUMN_BY_ID = new Map(COLUMN_DEFINITIONS.map((column) => [column.id, column]))
const COLUMN_STORAGE_KEY = 'ly.creator-os.business-ledger-columns-v3'

function defaultColumnState(): StoredColumnState {
  return {
    order: COLUMN_DEFINITIONS.map((column) => column.id),
    hidden: [],
    widths: Object.fromEntries(COLUMN_DEFINITIONS.map((column) => [column.id, column.defaultWidth]))
  }
}

function storedColumnState(): StoredColumnState {
  const fallback = defaultColumnState()
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) ?? 'null') as Partial<StoredColumnState> | null
    const order = Array.isArray(parsed?.order)
      ? [...new Set(parsed.order.filter((id): id is ColumnId => COLUMN_BY_ID.has(id as ColumnId))), ...fallback.order.filter((id) => !parsed.order!.includes(id))]
      : fallback.order
    const hidden = Array.isArray(parsed?.hidden) ? parsed.hidden.filter((id): id is ColumnId => COLUMN_BY_ID.has(id as ColumnId)) : []
    const widths = Object.fromEntries(COLUMN_DEFINITIONS.map((column) => {
      const width = Number(parsed?.widths?.[column.id] ?? column.defaultWidth)
      return [column.id, Math.min(column.maxWidth, Math.max(column.minWidth, width))]
    }))
    return { order, hidden: hidden.length >= order.length ? [] : hidden, widths }
  } catch {
    return fallback
  }
}

function persistColumnState(state: StoredColumnState): StoredColumnState {
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(state))
  return state
}

function localDateParts(): { today: string; year: string; month: string; quarterStart: string; quarterEnd: string } {
  const date = new Date()
  const year = String(date.getFullYear())
  const monthNumber = date.getMonth() + 1
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`
  const quarterStartMonth = Math.floor((monthNumber - 1) / 3) * 3 + 1
  const quarterEndMonth = quarterStartMonth + 2
  return {
    today: `${month}-${String(date.getDate()).padStart(2, '0')}`,
    year,
    month,
    quarterStart: `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`,
    quarterEnd: `${year}-${String(quarterEndMonth).padStart(2, '0')}-31`
  }
}

function entryDate(entry: BusinessLedgerEntry): string | null {
  return entry.revenueMonth ? `${entry.revenueMonth}-01` : entry.orderDate ?? entry.createdAt?.slice(0, 10) ?? null
}

function timeMatches(entry: BusinessLedgerEntry, range: BusinessTimeRange, customStart: string, customEnd: string): boolean {
  if (range === 'all') return true
  const date = entryDate(entry)
  if (!date) return false
  const local = localDateParts()
  if (range === 'month') return date.startsWith(local.month)
  if (range === 'year') return date.startsWith(local.year)
  if (range === 'quarter') return date >= local.quarterStart && date <= local.quarterEnd
  return (!customStart || date >= customStart) && (!customEnd || date <= customEnd)
}

function normalizedRebateStatus(status: RebateExecutionStatus): BusinessRebateFilter {
  if (status === 'pending_confirmation') return 'pending_confirmation'
  if (status === 'not_required') return 'not_required'
  if (status === 'completed') return 'completed'
  return 'pending'
}

function statusTone(value: 'pending' | 'done' | 'muted' | 'danger'): string {
  return `business-state-pill ${value}`
}

function rebatePresentation(entry: BusinessLedgerEntry): { label: string; tone: 'pending' | 'done' | 'muted' | 'danger' } {
  const status = normalizedRebateStatus(entry.rebateExecutionStatus)
  if (status === 'completed') return { label: '已返点', tone: 'done' }
  if (status === 'not_required') return { label: '无需返点', tone: 'muted' }
  if (status === 'pending_confirmation') return { label: '待确认', tone: 'pending' }
  return { label: '待返点', tone: 'pending' }
}

function invoicePresentation(entry: BusinessLedgerEntry): { label: string; tone: 'pending' | 'done' | 'muted' | 'danger' } {
  if (entry.invoiceExecutionStatus === 'issued') return { label: '已收返点发票', tone: 'done' }
  if (entry.invoiceExecutionStatus === 'not_required') return { label: '无需返点发票', tone: 'muted' }
  if (entry.invoiceExecutionStatus === 'pending_confirmation') return { label: '待确认', tone: 'pending' }
  return { label: '待收返点发票', tone: 'pending' }
}

function lifecyclePresentation(entry: BusinessLedgerEntry): { label: string; tone: 'pending' | 'done' | 'muted' | 'danger' } {
  if (entry.lifecycleStatus === 'settled') return { label: '已结清', tone: 'done' }
  if (entry.lifecycleStatus === 'canceled') return { label: '已取消', tone: 'danger' }
  if (entry.lifecycleStatus === 'agreed_pending_order') return { label: '已谈妥·待下单', tone: 'pending' }
  return { label: '已下单', tone: 'muted' }
}

export function BusinessLedger({
  entries,
  timeRange,
  customStart,
  customEnd,
  platform,
  query,
  lifecycleStatus,
  paymentStatus,
  rebateStatus,
  invoiceStatus,
  onSelect,
  onCreateStandalone,
  onField,
  onToggleSettled,
  onRelink,
  onTrash
}: BusinessLedgerProps): React.JSX.Element {
  const [columns, setColumns] = useState(storedColumnState)
  const [columnEditorOpen, setColumnEditorOpen] = useState(false)
  const [sort, setSort] = useState<{ id: SortableColumnId; direction: 'asc' | 'desc' } | null>({ id: 'orderDate', direction: 'desc' })
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])

  const visible = useMemo(() => {
    const result = entries.filter((entry) => {
      const queryMatch = !query.trim() || `${entry.projectTitle}${entry.orderPlatform}${entry.rebateRecipientName}`.toLowerCase().includes(query.trim().toLowerCase())
      const platformMatch = !platform || entry.orderPlatform === platform
      const lifecycleMatch = !lifecycleStatus || entry.lifecycleStatus === lifecycleStatus
      const paymentMatch = !paymentStatus || entry.paymentStatus === paymentStatus
      const rebateMatch = !rebateStatus || normalizedRebateStatus(entry.rebateExecutionStatus) === rebateStatus
      const invoiceMatch = !invoiceStatus || entry.invoiceExecutionStatus === invoiceStatus
      return queryMatch && platformMatch && lifecycleMatch && paymentMatch && rebateMatch && invoiceMatch && timeMatches(entry, timeRange, customStart, customEnd)
    })
    if (!sort) return result
    const factor = sort.direction === 'asc' ? 1 : -1
    const sortableValue = (entry: BusinessLedgerEntry): string | number | null => {
      if (sort.id === 'orderDate') return entry.orderDate
      if (sort.id === 'revenueMonth') return entry.revenueMonth
      if (sort.id === 'orderAmount') return entry.platformOrderAmountCents
      return entry.expectedIncomeCents
    }
    return [...result].sort((left, right) => {
      const leftValue = sortableValue(left)
      const rightValue = sortableValue(right)
      if (leftValue == null && rightValue == null) return left.projectTitle.localeCompare(right.projectTitle)
      if (leftValue == null) return sort.direction === 'asc' ? -1 : 1
      if (rightValue == null) return sort.direction === 'asc' ? 1 : -1
      return (typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue))) * factor
    })
  }, [customEnd, customStart, entries, invoiceStatus, lifecycleStatus, paymentStatus, platform, query, rebateStatus, sort, timeRange])

  const activeEntries = useMemo(() => visible.filter((entry) => entry.lifecycleStatus !== 'canceled'), [visible])
  const totals = useMemo(() => activeEntries.reduce((result, entry) => {
    const ordered = ['ordered', 'settled'].includes(entry.lifecycleStatus)
    return {
      order: result.order + (ordered ? entry.platformOrderAmountCents ?? 0 : 0),
      received: result.received + (ordered && entry.paymentStatus === 'received' ? entry.platformOrderAmountCents ?? 0 : 0),
      actualNet: result.actualNet + (ordered && entry.paymentStatus === 'received' ? entry.expectedIncomeCents ?? 0 : 0),
      actualNetSamples: result.actualNetSamples + (ordered && entry.paymentStatus === 'received' && entry.expectedIncomeCents != null ? 1 : 0),
      actualNetEligibleSamples: result.actualNetEligibleSamples + (ordered && entry.paymentStatus === 'received' ? 1 : 0),
      expected: result.expected + (entry.expectedIncomeCents ?? 0),
      expectedSamples: result.expectedSamples + (entry.expectedIncomeCents == null ? 0 : 1),
      expectedEligibleSamples: result.expectedEligibleSamples + 1
    }
  }, { order: 0, received: 0, actualNet: 0, actualNetSamples: 0, actualNetEligibleSamples: 0, expected: 0, expectedSamples: 0, expectedEligibleSamples: 0 }), [activeEntries])
  const pending = Math.max(0, totals.order - totals.received)
  const visibleColumns = columns.order.filter((id) => !columns.hidden.includes(id))
  const gridStyle = {
    gridTemplateColumns: `${visibleColumns.map((id) => `${columns.widths[id] ?? COLUMN_BY_ID.get(id)!.defaultWidth}px`).join(' ')} 42px`,
    minWidth: `${visibleColumns.reduce((sum, id) => sum + (columns.widths[id] ?? COLUMN_BY_ID.get(id)!.defaultWidth), 0) + 58}px`
  } satisfies CSSProperties

  const updateColumns = (updater: (current: StoredColumnState) => StoredColumnState): void => {
    setColumns((current) => persistColumnState(updater(current)))
  }
  const startResize = (id: ColumnId, event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    resizeCleanup.current?.()
    const definition = COLUMN_BY_ID.get(id)!
    const startX = event.clientX
    const startWidth = columns.widths[id] ?? definition.defaultWidth
    const move = (moveEvent: PointerEvent): void => {
      const width = Math.min(definition.maxWidth, Math.max(definition.minWidth, Math.round(startWidth + moveEvent.clientX - startX)))
      setColumns((current) => ({ ...current, widths: { ...current.widths, [id]: width } }))
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (resizeCleanup.current === cleanup) resizeCleanup.current = null
    }
    const finish = (): void => {
      cleanup()
      setColumns((current) => persistColumnState(current))
    }
    resizeCleanup.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const moveColumn = (id: ColumnId, direction: -1 | 1): void => updateColumns((current) => {
    const index = current.order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.order.length) return current
    const order = [...current.order]
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    return { ...current, order }
  })
  const toggleColumn = (id: ColumnId): void => updateColumns((current) => {
    const hidden = current.hidden.includes(id) ? current.hidden.filter((item) => item !== id) : [...current.hidden, id]
    return hidden.length >= current.order.length ? current : { ...current, hidden }
  })
  const toggleSort = (id: SortableColumnId): void => setSort((current) => current?.id !== id
    ? { id, direction: 'desc' }
    : current.direction === 'desc'
      ? { id, direction: 'asc' }
      : null)
  const cell = (entry: BusinessLedgerEntry, id: ColumnId): ReactNode => {
    if (id === 'record') {
      const lifecycle = lifecyclePresentation(entry)
      return <span className="business-ledger-project"><button className="income-cell-button income-title-cell" aria-label={`${entry.projectTitle}商单收入详情`} onClick={() => onSelect(entry.projectId)}><b>{entry.projectTitle}</b></button><small><button className="income-status-cell" aria-label={`${entry.projectTitle}：商单状态`} onClick={(event) => onField(entry.projectId, 'lifecycle', event.currentTarget)}><em className={statusTone(lifecycle.tone)}>{lifecycle.label}</em></button>{entry.ledgerOnly ? '独立台账' : entry.linkedProjectTrashedAt ? '原项目在回收站' : '关联内容项目'}</small></span>
    }
    if (id === 'platform') return <span><b>{entry.orderPlatform || '待填写'}</b></span>
    if (id === 'orderDate') return <span className="business-number-cell"><b>{entry.orderDate || '—'}</b></span>
    if (id === 'revenueMonth') return <span className="business-number-cell"><b>{entry.revenueMonth || '—'}</b></span>
    if (id === 'orderAmount') return <span className="business-number-cell"><b>{money(entry.platformOrderAmountCents)}</b></span>
    if (id === 'expectedIncome') return <span className={`business-number-cell${entry.expectedIncomeCents != null && entry.expectedIncomeCents < 0 ? ' ledger-negative' : ''}`}><b>{money(entry.expectedIncomeCents)}</b></span>
    if (id === 'payment') return <span><em className={statusTone(entry.paymentStatus === 'received' ? 'done' : 'pending')}>{entry.paymentStatus === 'received' ? '已回款' : '未回款'}</em></span>
    if (id === 'rebate') {
      const presentation = rebatePresentation(entry)
      return <span><em className={statusTone(presentation.tone)}>{presentation.label}</em>{entry.effectiveFinalRebateAmountCents != null ? <small>{money(entry.effectiveFinalRebateAmountCents)}</small> : null}</span>
    }
    const presentation = invoicePresentation(entry)
    return <span><em className={statusTone(presentation.tone)}>{presentation.label}</em>{entry.invoiceIssuedCents ? <small>{money(entry.invoiceIssuedCents)}</small> : null}</span>
  }

  return <>
    <section className="business-ledger-summary card" aria-label="商单收入合计">
      <article className="actual-net"><span>实际净收入</span><b>{totals.actualNetEligibleSamples > 0 && totals.actualNetSamples === 0 ? '—' : money(totals.actualNet)}</b><small>{totals.actualNetSamples < totals.actualNetEligibleSamples ? `仅统计${totals.actualNetSamples}/${totals.actualNetEligibleSamples}笔已可计算` : '仅计算已到账，已扣除返点和成本'}</small></article>
      <article><span>预计净收入</span><b>{totals.expectedSamples ? money(totals.expected) : '—'}</b><small>{totals.expectedSamples < totals.expectedEligibleSamples ? `仅汇总${totals.expectedSamples}/${totals.expectedEligibleSamples}笔；另${totals.expectedEligibleSamples - totals.expectedSamples}笔净额待确认（含已谈妥）` : '包含已谈妥、已下单与已结清'}</small></article>
      <article><span>已回款</span><b>{money(totals.received)}</b><small>到账金额，未扣返点和成本</small></article>
      <article><span>待回款</span><b>{money(pending)}</b><small>待到账金额，未扣返点和成本</small></article>
    </section>
    <div className="business-ledger-table-tools">
      <p className="business-ledger-result-count">{visible.length}条商务记录</p>
      <button aria-expanded={columnEditorOpen} onClick={() => setColumnEditorOpen((current) => !current)}><Columns3 size={14} />列设置</button>
      {columnEditorOpen ? <section className="business-column-editor" role="dialog" aria-label="商单收入列设置">
        <header><b>显示与排序</b><button onClick={() => { const next = defaultColumnState(); setColumns(persistColumnState(next)) }}>恢复默认</button></header>
        {columns.order.map((id, index) => {
          const definition = COLUMN_BY_ID.get(id)!
          const onlyVisible = !columns.hidden.includes(id) && visibleColumns.length === 1
          return <label key={id}><input type="checkbox" checked={!columns.hidden.includes(id)} disabled={onlyVisible} onChange={() => toggleColumn(id)} /><span>{definition.label}</span><button aria-label={`上移${definition.label}`} disabled={index === 0} onClick={(event) => { event.preventDefault(); moveColumn(id, -1) }}><ArrowUp size={12} /></button><button aria-label={`下移${definition.label}`} disabled={index === columns.order.length - 1} onClick={(event) => { event.preventDefault(); moveColumn(id, 1) }}><ArrowDown size={12} /></button></label>
        })}
      </section> : null}
    </div>
    <section className="business-ledger-table card" aria-label="商单收入列表">
      <header className="business-ledger-row business-ledger-head" style={gridStyle}>
        {visibleColumns.map((id) => {
          const definition = COLUMN_BY_ID.get(id)!
          const activeSort = sort?.id === id ? sort : null
          return <span key={id}>{definition.sortable ? <button className="business-sort-head" onClick={() => toggleSort(id as SortableColumnId)}>{definition.label}{activeSort?.direction === 'asc' ? <ArrowUp size={12} /> : activeSort?.direction === 'desc' ? <ArrowDown size={12} /> : null}</button> : definition.label}<button className="business-ledger-resizer" aria-label={`调整${definition.label}列宽`} onPointerDown={(event) => startResize(id, event)} /></span>
        })}
        <span aria-hidden="true" />
      </header>
      {visible.map((entry) => <div className="business-ledger-row" style={gridStyle} key={entry.projectId} role="group" aria-label={`${entry.projectTitle}收入记录`}>
        {visibleColumns.map((id) => <span key={id} data-income-field={id}>{id === 'record' ? cell(entry, id) : <button className="income-cell-button" aria-label={`${entry.projectTitle}：${incomeFieldLabels[id]}`} onClick={(event) => onField(entry.projectId, id, event.currentTarget)}>{cell(entry, id)}</button>}</span>)}
        <span className="business-row-menu-cell" onClick={(event) => event.stopPropagation()}>
          <details className="business-row-menu" name="business-ledger-row-menu" onPointerLeave={(event) => event.currentTarget.removeAttribute('open')}><summary aria-label={`${entry.projectTitle}更多操作`}><MoreHorizontal size={15} /></summary><div>
            {entry.settlementMode === 'automatic'
              ? null
              : <button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onToggleSettled(entry.projectId, entry.settlementMode !== 'manual') }}>{entry.settlementMode === 'manual' ? '取消已结清' : '手动标记已结清'}</button>}
            <button onClick={() => onRelink(entry.projectId)}>{entry.ledgerOnly ? '关联商单项目' : '更换关联项目'}</button>
            <button className="danger-action" onClick={() => onTrash(entry.projectId)}>移入收入回收站</button>
          </div></details>
        </span>
      </div>)}
      {visible.length === 0 ? <div className="empty-state"><BriefcaseBusiness size={24} /><b>没有符合筛选的商务记录</b><span>{entries.length ? '调整时间、平台、状态或搜索条件。' : '可以直接补加历史商单，不需要创建内容项目。'}</span>{entries.length ? null : <button className="primary-action" onClick={onCreateStandalone}>直接补加商单</button>}</div> : null}
    </section>
  </>
}
