import { IncomeFieldPopover } from './IncomeFieldPopover'
import { incomeFieldLabels, type IncomeFieldTarget, type OtherIncomeField } from '../utils/income-fields'
import { AppSelect } from './AppSelect'
import { handleIncomeDialogKey, useIncomeDraft } from '../utils/useIncomeDraft'
import { AnchoredPopover } from './AnchoredPopover'
import {
  ArchiveRestore,
  BookmarkPlus,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FileUp,
  Fingerprint,
  FolderCog,
  LockKeyhole,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BusinessLedgerEntry,
  BusinessLedgerLockStatus,
  BusinessRecordInput,
  IncomeLedgerTotals,
  OtherIncomeCategory,
  OtherIncomeImportCandidate,
  OtherIncomeImportRuleConditions,
  OtherIncomeRecord,
  OtherIncomeRecordInput
} from '../../../shared/domain'
import { calculateIncomeLedgerSummary } from '../../../shared/income-ledger'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { showStagePreview } from '../utils/stage-preview'

type TimeRange = 'month' | 'quarter' | 'year' | 'all' | 'custom'
const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 })
const money = (cents: number): string => currency.format(cents / 100)
const formatRecordMoney = (cents: number, code: string): string => {
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: code || 'CNY', maximumFractionDigits: 2 }).format(cents / 100)
  } catch {
    return `${code || 'CNY'} ${(cents / 100).toFixed(2)}`
  }
}
const today = (): string => new Date().toISOString().slice(0, 10)
const thisMonth = (): string => today().slice(0, 7)
const sourceTemplateKey = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
const parseMoney = (value: string): number => {
  const number = Number(value.trim().replace(/[¥￥,\s元]/g, ''))
  if (!Number.isFinite(number) || number < 0) throw new Error('请输入有效的非负金额')
  return Math.round(number * 100)
}

function periodBounds(range: TimeRange, customStart: string, customEnd: string): [string, string] | null {
  if (range === 'all') return null
  if (range === 'custom') return [customStart || '0000-01-01', customEnd || '9999-12-31']
  const date = new Date()
  const year = date.getFullYear()
  if (range === 'year') return [`${year}-01-01`, `${year}-12-31`]
  if (range === 'month') {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return [`${year}-${month}-01`, `${year}-${month}-31`]
  }
  const startMonth = Math.floor(date.getMonth() / 3) * 3 + 1
  const endMonth = startMonth + 2
  return [`${year}-${String(startMonth).padStart(2, '0')}-01`, `${year}-${String(endMonth).padStart(2, '0')}-31`]
}

function filterIncome(
  business: BusinessLedgerEntry[],
  other: OtherIncomeRecord[],
  range: TimeRange,
  customStart: string,
  customEnd: string
): { business: BusinessLedgerEntry[]; other: OtherIncomeRecord[] } {
  const bounds = periodBounds(range, customStart, customEnd)
  if (!bounds) return { business, other }
  const [start, end] = bounds
  return {
    business: business.filter((entry) => {
      const date = entry.revenueMonth ? `${entry.revenueMonth}-01` : entry.orderDate ?? entry.createdAt?.slice(0, 10) ?? '0000-01-01'
      return date >= start && date <= end
    }),
    other: other.filter((entry) => {
      const date = entry.revenueMonth ? `${entry.revenueMonth}-01` : entry.incomeDate ?? entry.createdAt.slice(0, 10)
      return date >= start && date <= end
    })
  }
}

function SummaryCards({ totals, includesAgreedBusiness = false, embedded = false, ledgerView = false }: { totals: IncomeLedgerTotals; includesAgreedBusiness?: boolean; embedded?: boolean; ledgerView?: boolean }): React.JSX.Element {
  const actualNetUnknown = totals.actualNetEligibleCount - totals.actualNetKnownCount
  const expectedNetUnknown = totals.expectedNetEligibleCount - totals.expectedNetKnownCount
  const expectedCoverage = includesAgreedBusiness ? '全部有效登记（含已谈妥）' : '所有有效登记'
  const className = ledgerView ? 'business-ledger-summary card' : `income-summary-grid${embedded ? ' embedded' : ' card'}`
  return <section className={className} aria-label="收入汇总">
    <article className="actual-net"><span>实际净收入</span><b>{actualNetUnknown > 0 && totals.actualNetKnownCount === 0 ? '—' : money(totals.actualNetIncomeCents)}</b><small>{actualNetUnknown > 0 ? `仅统计${totals.actualNetKnownCount}/${totals.actualNetEligibleCount}笔已可计算` : '仅计算已到账，已扣除返点和成本'}</small></article>
    <article><span>预计净收入</span><b>{expectedNetUnknown > 0 && totals.expectedNetKnownCount === 0 ? '—' : money(totals.expectedIncomeCents)}</b><small>{expectedNetUnknown > 0 ? `仅汇总${totals.expectedNetKnownCount}/${totals.expectedNetEligibleCount}笔有效登记；另${expectedNetUnknown}笔净额待确认${includesAgreedBusiness ? '（含已谈妥）' : ''}` : `包含${expectedCoverage}，未到账部分可能变化`}</small></article>
    <article><span>已回款</span><b>{money(totals.receivedCents)}</b><small>到账金额，未扣返点和成本</small></article>
    <article><span>待回款</span><b>{money(totals.pendingCents)}</b><small>待到账金额，未扣返点和成本</small></article>
  </section>
}

function IncomeLockGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<BusinessLedgerLockStatus | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const automaticSystemUnlockAttempted = useRef(false)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const next = await window.creatorOS?.getBusinessLedgerLockStatus()
        if (!next) throw new Error('无法读取隐私锁状态')
        if (!active) return
        setStatus(next)
        if (!next.enabled || next.unlocked || !next.touchIdAvailable || automaticSystemUnlockAttempted.current) return
        automaticSystemUnlockAttempted.current = true
        setBusy(true)
        try {
          const unlocked = await window.creatorOS?.unlockBusinessLedgerWithTouchId()
          if (active && unlocked) setStatus(unlocked)
        } catch {
          if (active) {
            setError('系统验证未完成，可输入收入台账密码，或重新验证。')
            window.requestAnimationFrame(() => passwordInputRef.current?.focus())
          }
        } finally {
          if (active) setBusy(false)
        }
      } catch {
        if (active) setStatus({ enabled: false, unlocked: true, securityAvailable: false, touchIdAvailable: false })
      }
    })()
    return () => { active = false }
  }, [])
  const unlock = async (touchId = false): Promise<void> => {
    if (!window.creatorOS) return
    setBusy(true); setError('')
    try {
      setStatus(touchId ? await window.creatorOS.unlockBusinessLedgerWithTouchId() : await window.creatorOS.unlockBusinessLedgerWithPassword(password))
      setPassword('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '解锁失败') }
    finally { setBusy(false) }
  }
  if (!status) return <main className="page projects-page income-ledger-page"><section className="card income-loading">正在读取收入台账…</section></main>
  if (!status.enabled || status.unlocked) return <>{children}</>
  return <main className="page projects-page income-ledger-page">
    <header className="page-header"><div><h1>收入台账</h1><p>商单收入和其他收入均受到同一把隐私锁保护。</p></div></header>
    <section className="business-ledger-lock card" aria-label="收入台账已锁定">
      <LockKeyhole size={30} />
      <div><span>{busy ? '正在等待系统验证' : '隐私锁已开启'}</span><h2>使用指纹或密码解锁</h2><p>进入页面时会直接请求Touch ID；取消后也可以输入收入台账密码。</p></div>
      <label>收入台账密码<input ref={passwordInputRef} autoFocus={!status.touchIdAvailable} disabled={busy} type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') void unlock() }} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div>{status.touchIdAvailable ? <button disabled={busy} onClick={() => void unlock(true)}><Fingerprint size={15} />重新验证</button> : null}<button className="primary-action" disabled={busy || !password} onClick={() => void unlock()}>密码解锁</button></div>
    </section>
  </main>
}

function RangeFilter({ range, customStart, customEnd, onRange, onStart, onEnd }: {
  range: TimeRange
  customStart: string
  customEnd: string
  onRange(value: TimeRange): void
  onStart(value: string): void
  onEnd(value: string): void
}): React.JSX.Element {
  return <div className="income-range-filter">
    <AppSelect aria-label="统计时间范围" value={range} onChange={(event) => onRange(event.currentTarget.value as TimeRange)}>
      <option value="month">本月</option><option value="quarter">本季度</option><option value="year">今年</option><option value="all">全部</option><option value="custom">自定义</option>
    </AppSelect>
    {range === 'custom' ? <><input type="date" aria-label="开始日期" value={customStart} onChange={(event) => onStart(event.currentTarget.value)} /><span>至</span><input type="date" aria-label="结束日期" value={customEnd} onChange={(event) => onEnd(event.currentTarget.value)} /></> : null}
  </div>
}

export function IncomeLedgerOverviewPage(): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [range, setRange] = useState<TimeRange>('year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashFilter, setTrashFilter] = useState<'all' | 'business' | 'other'>('all')
  const [businessTrash, setBusinessTrash] = useState<BusinessLedgerEntry[]>([])
  const [otherTrash, setOtherTrash] = useState<OtherIncomeRecord[]>([])
  const filtered = useMemo(() => filterIncome(snapshot.businessLedger, snapshot.otherIncomeRecords, range, customStart, customEnd), [snapshot.businessLedger, snapshot.otherIncomeRecords, range, customStart, customEnd])
  const summary = useMemo(() => calculateIncomeLedgerSummary(filtered.business, filtered.other), [filtered])
  const recent = useMemo(() => [
    ...filtered.business.map((entry) => ({ id: `business:${entry.projectId}`, title: entry.projectTitle, source: entry.orderPlatform || '商单收入', amount: entry.platformOrderAmountCents ?? 0, currency: 'CNY', date: entry.revenueMonth ?? entry.orderDate ?? entry.createdAt?.slice(0, 10) ?? '—', kind: '商单收入' })),
    ...filtered.other.map((entry) => ({ id: `other:${entry.id}`, title: entry.title, source: entry.sourceName || entry.categoryName, amount: entry.amountCents, currency: entry.currency, date: entry.revenueMonth ?? entry.incomeDate ?? entry.createdAt.slice(0, 10), kind: '其他收入' }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8), [filtered])
  const openTrash = async (): Promise<void> => {
    if (!window.creatorOS) return
    const [business, other] = await Promise.all([window.creatorOS.listTrashedBusinessLedgerEntries(), window.creatorOS.listTrashedOtherIncomeRecords()])
    setBusinessTrash(business); setOtherTrash(other); setTrashOpen(true)
  }
  const restore = async (kind: 'business' | 'other', id: string): Promise<void> => {
    if (!window.creatorOS) return
    if (kind === 'business') await window.creatorOS.restoreBusinessLedgerEntry(id)
    else await window.creatorOS.restoreOtherIncomeRecord(id)
    await refresh(); await openTrash()
  }
  const remove = async (kind: 'business' | 'other', id: string): Promise<void> => {
    if (!window.creatorOS || !window.confirm('永久删除后无法恢复，确定继续吗？')) return
    if (kind === 'business') await window.creatorOS.permanentlyDeleteBusinessLedgerEntry(id)
    else await window.creatorOS.permanentlyDeleteOtherIncomeRecord(id)
    await refresh(); await openTrash()
  }
  return <IncomeLockGate><main className="page projects-page income-ledger-page">
    <header className="page-header income-page-header"><div><h1>收入台账</h1></div><div><button onClick={() => void openTrash()}><Trash2 size={14} />收入回收站</button><button onClick={() => navigate({ page: 'other-income' })}><Sparkles size={14} />智能导入其他收入</button></div></header>
    <section className="card income-overview-panel">
      <div className="income-overview-filter"><div><b>综合总览</b><span>实际净收入只计算已到账记录；外币记录保留但不汇总。</span></div><RangeFilter range={range} customStart={customStart} customEnd={customEnd} onRange={setRange} onStart={setCustomStart} onEnd={setCustomEnd} /></div>
      <SummaryCards totals={summary.combined} includesAgreedBusiness embedded />
      <section className="income-split-grid" aria-label="收入类型拆分">
        <button onClick={() => navigate({ page: 'business' })}><div><span>商单收入·实际净收入</span><ChevronRight size={16} /></div><b>{summary.business.actualNetEligibleCount > 0 && summary.business.actualNetKnownCount === 0 ? '—' : money(summary.business.actualNetIncomeCents)}</b><small>{summary.business.actualNetKnownCount < summary.business.actualNetEligibleCount ? `实际仅统计${summary.business.actualNetKnownCount}/${summary.business.actualNetEligibleCount}笔·` : ''}预计{summary.business.expectedNetEligibleCount > 0 && summary.business.expectedNetKnownCount === 0 ? '—' : money(summary.business.expectedIncomeCents)}{summary.business.expectedNetKnownCount < summary.business.expectedNetEligibleCount ? `（仅汇总${summary.business.expectedNetKnownCount}/${summary.business.expectedNetEligibleCount}笔，含已谈妥）` : '（含已谈妥）'}·{summary.business.recordCount}笔</small></button>
        <button onClick={() => navigate({ page: 'other-income' })}><div><span>其他收入·实际净收入</span><ChevronRight size={16} /></div><b>{money(summary.other.actualNetIncomeCents)}</b><small>预计{money(summary.other.expectedIncomeCents)}·{summary.other.recordCount}笔</small></button>
      </section>
    </section>
    <section className="card income-recent"><header><div><h2>最近收入</h2></div></header>{recent.length ? <div className="income-table">
      <div className="income-table-row head"><span>收入</span><span>类型</span><span>来源</span><span>归属日期</span><span>金额</span></div>
      {recent.map((item) => <button className="income-table-row" key={item.id} onClick={() => navigate({ page: item.kind === '商单收入' ? 'business' : 'other-income' })}><span><b>{item.title}</b></span><span>{item.kind}</span><span>{item.source}</span><span>{item.date}</span><span>{formatRecordMoney(item.amount, item.currency)}</span></button>)}
    </div> : <div className="income-empty"><b>还没有收入记录</b><span>先新增一笔商单收入或其他收入。</span></div>}</section>
    {trashOpen ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTrashOpen(false) }}><section className="income-dialog income-trash-dialog" role="dialog" aria-modal="true" aria-label="收入回收站"><header><div><span>统一管理</span><h2>收入回收站</h2></div><button aria-label="关闭" onClick={() => setTrashOpen(false)}><X size={16} /></button></header><div className="income-dialog-body"><div className="trash-type-filter" role="group" aria-label="回收站类型筛选"><button className={trashFilter === 'all' ? 'selected' : ''} onClick={() => setTrashFilter('all')}>全部</button><button className={trashFilter === 'business' ? 'selected' : ''} onClick={() => setTrashFilter('business')}>商单收入</button><button className={trashFilter === 'other' ? 'selected' : ''} onClick={() => setTrashFilter('other')}>其他收入</button></div>
      {[...businessTrash.map((item) => ({ kind: 'business' as const, id: item.projectId, title: item.projectTitle, type: '商单收入', amount: item.platformOrderAmountCents ?? 0, currency: 'CNY' })), ...otherTrash.map((item) => ({ kind: 'other' as const, id: item.id, title: item.title, type: '其他收入', amount: item.amountCents, currency: item.currency }))].filter((item) => trashFilter === 'all' || item.kind === trashFilter).map((item) => <article className="income-trash-row" key={`${item.kind}:${item.id}`}><div><b>{item.title}</b><span>{item.type}·{formatRecordMoney(item.amount, item.currency)}</span></div><button aria-label={`恢复${item.title}`} onClick={() => void restore(item.kind, item.id)}><ArchiveRestore size={13} />恢复</button><button aria-label={`永久删除${item.title}`} className="danger-action" onClick={() => void remove(item.kind, item.id)}>永久删除</button></article>)}
      {!businessTrash.length && !otherTrash.length ? <div className="income-empty"><b>回收站为空</b><span>删除的收入记录会暂存在这里。</span></div> : null}
    </div><footer><button onClick={() => setTrashOpen(false)}>完成</button></footer></section></div> : null}
  </main></IncomeLockGate>
}

interface OtherIncomeForm {
  id: string | null
  title: string
  categoryId: string
  sourceName: string
  revenueMonth: string
  incomeDate: string
  amount: string
  directCost: string
  paymentStatus: 'pending' | 'received'
  paymentReceivedDate: string
  status: 'active' | 'canceled'
  currency: string
  notes: string
  sourceReference: string
  attachment: File | null
}
const emptyForm = (): OtherIncomeForm => ({ id: null, title: '', categoryId: '', sourceName: '', revenueMonth: thisMonth(), incomeDate: today(), amount: '', directCost: '0', paymentStatus: 'pending', paymentReceivedDate: '', status: 'active', currency: 'CNY', notes: '', sourceReference: '', attachment: null })
const formFromRecord = (record: OtherIncomeRecord): OtherIncomeForm => ({ id: record.id, title: record.title, categoryId: record.categoryId ?? '', sourceName: record.sourceName, revenueMonth: record.revenueMonth ?? '', incomeDate: record.incomeDate ?? '', amount: String(record.amountCents / 100), directCost: String(record.directCostCents / 100), paymentStatus: record.paymentStatus, paymentReceivedDate: record.paymentReceivedDate ?? '', status: record.status, currency: record.currency, notes: record.notes, sourceReference: record.sourceReference, attachment: null })
const inputFromForm = (form: OtherIncomeForm): OtherIncomeRecordInput => ({
  title: form.title.trim(), categoryId: form.categoryId || null, sourceName: form.sourceName.trim(), revenueMonth: form.revenueMonth || null, incomeDate: form.incomeDate || null,
  amountCents: parseMoney(form.amount), directCostCents: parseMoney(form.directCost || '0'), paymentStatus: form.paymentStatus,
  paymentReceivedDate: form.paymentStatus === 'received' ? form.paymentReceivedDate || form.incomeDate || null : null, status: form.status, currency: form.currency.trim().toUpperCase() || 'CNY',
  notes: form.notes.trim(), sourceReference: form.sourceReference.trim()
})

function conditionsText(conditions: OtherIncomeImportRuleConditions | null): string[] {
  if (!conditions) return []
  return [
    '方向：仅收入',
    ...conditions.companies.map((item) => `公司：${item}`),
    ...conditions.excludedCompanies.map((item) => `排除公司：${item}`),
    ...conditions.includeKeywords.map((item) => `包含：${item}`),
    ...conditions.excludeKeywords.map((item) => `排除：${item}`),
    conditions.startDate ? `开始：${conditions.startDate}` : '',
    conditions.endDate ? `结束：${conditions.endDate}` : '',
    conditions.minimumAmountCents != null ? `最低：${money(conditions.minimumAmountCents)}` : '',
    conditions.maximumAmountCents != null ? `最高：${money(conditions.maximumAmountCents)}` : '',
    conditions.paymentStatus ? `回款：${conditions.paymentStatus === 'received' ? '已回款' : '待回款'}` : '',
    conditions.categoryId ? `收入类型：${conditions.categoryId}` : '',
    conditions.revenueMonth ? `收益月份：${conditions.revenueMonth}` : ''
  ].filter(Boolean)
}

export function OtherIncomePage({ createRequested = false, onCreateHandled }: { createRequested?: boolean; onCreateHandled?(): void }): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const categories = snapshot.otherIncomeCategories
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [payment, setPayment] = useState('')
  const [recordStatus, setRecordStatus] = useState<'active' | 'canceled' | ''>('active')
  const [range, setRange] = useState<TimeRange>('year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const { editor, setEditor, openEditor, dirty, requestLeave, guard } = useIncomeDraft<OtherIncomeForm>()
  const [saving, setSaving] = useState(false)
  const [fieldTarget, setFieldTarget] = useState<IncomeFieldTarget | null>(null)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!createRequested) return
    openEditor(emptyForm())
    onCreateHandled?.()
  }, [createRequested, onCreateHandled, openEditor])
  const filtered = useMemo(() => {
    const bounds = periodBounds(range, customStart, customEnd)
    return snapshot.otherIncomeRecords.filter((record) => {
      const date = record.revenueMonth ? `${record.revenueMonth}-01` : record.incomeDate ?? record.createdAt.slice(0, 10)
      return !record.trashedAt
        && (!bounds || (date >= bounds[0] && date <= bounds[1]))
        && (!query || `${record.title} ${record.sourceName} ${record.notes}`.toLowerCase().includes(query.toLowerCase()))
        && (!categoryId || record.categoryId === categoryId)
        && (!payment || record.paymentStatus === payment)
        && (!recordStatus || record.status === recordStatus)
    })
  }, [snapshot.otherIncomeRecords, range, customStart, customEnd, query, categoryId, payment, recordStatus])
  const summary = useMemo(() => calculateIncomeLedgerSummary([], filtered).other, [filtered])
  const selected = snapshot.otherIncomeRecords.find((record) => record.id === editor?.id) ?? null
  const requestClose = (): void => {
    if (!saving) requestLeave(() => { openEditor(null); setError('') })
  }
  const openRecord = (record: OtherIncomeRecord): void => { setFieldTarget(null); setError(''); openEditor(formFromRecord(record)) }
  const save = async (): Promise<void> => {
    if (!window.creatorOS || !editor || saving) return
    setSaving(true)
    setError('')
    try {
      const input = inputFromForm(editor)
      if (!input.title) throw new Error('请填写收入标题')
      const saved = await window.creatorOS.saveOtherIncomeRecord(editor.id, input)
      setEditor((current) => current ? { ...current, id: saved.id } : current)
      if (editor.attachment) await window.creatorOS.importOtherIncomeAttachment([saved.id], editor.attachment.name, new Uint8Array(await editor.attachment.arrayBuffer()))
      await refresh(); openEditor(null); showStagePreview(editor.id ? '其他收入已更新' : '其他收入已新增')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setSaving(false) }
  }
  const trash = async (id: string): Promise<void> => {
    if (!window.creatorOS || !window.confirm('移入收入回收站？')) return
    await window.creatorOS.trashOtherIncomeRecord(id); await refresh()
  }
  const saveSourceTemplate = async (name: string): Promise<void> => {
    const normalized = name.normalize('NFKC').trim().replace(/\s+/g, ' ')
    if (!normalized) return
    const next = [
      normalized,
      ...snapshot.preferences.otherIncomeSourceTemplates.filter((item) => sourceTemplateKey(item) !== sourceTemplateKey(normalized))
    ]
    await setPreferences({ otherIncomeSourceTemplates: next })
    showStagePreview(`已保存常用客户“${normalized}”`)
  }
  const deleteSourceTemplate = async (name: string): Promise<void> => {
    await setPreferences({
      otherIncomeSourceTemplates: snapshot.preferences.otherIncomeSourceTemplates.filter((item) => sourceTemplateKey(item) !== sourceTemplateKey(name))
    })
    showStagePreview(`已移除常用客户“${name}”`)
  }
  return <IncomeLockGate><main className="page projects-page income-ledger-page business-ledger-page other-income-page">
    <header className="page-header business-ledger-page-header"><div><h1>其他收入</h1></div><div className="business-ledger-page-actions"><button onClick={() => setCategoryOpen(true)}><FolderCog size={14} />收入类型</button><button onClick={() => setImportOpen(true)}><Sparkles size={14} />智能批量导入</button><button className="primary-action" onClick={() => { setError(''); openEditor(emptyForm()) }}><Plus size={14} />新增收入</button></div></header>
    <section className="business-ledger-filters card" aria-label="其他收入筛选"><div className="business-filter-primary">
      <label><CalendarRange size={14} /><span className="visually-hidden">时间范围</span><AppSelect aria-label="统计时间范围" value={range} onChange={(event) => setRange(event.currentTarget.value as TimeRange)}><option value="month">本月</option><option value="quarter">本季度</option><option value="year">今年</option><option value="all">全部</option><option value="custom">自定义</option></AppSelect></label>
      {range === 'custom' ? <div className="business-custom-range"><input type="date" aria-label="开始日期" value={customStart} onChange={(event) => setCustomStart(event.currentTarget.value)} /><span>至</span><input type="date" aria-label="结束日期" value={customEnd} onChange={(event) => setCustomEnd(event.currentTarget.value)} /></div> : null}
      <label><span className="visually-hidden">收入类型</span><AppSelect aria-label="筛选收入类型" value={categoryId} onChange={(event) => setCategoryId(event.currentTarget.value)}><option value="">全部类型</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isActive ? '' : '（已停用）'}</option>)}</AppSelect></label>
      <label><span className="visually-hidden">回款状态</span><AppSelect aria-label="筛选回款状态" value={payment} onChange={(event) => setPayment(event.currentTarget.value)}><option value="">全部回款</option><option value="received">已回款</option><option value="pending">待回款</option></AppSelect></label>
      <label><span className="visually-hidden">记录状态</span><AppSelect aria-label="筛选记录状态" value={recordStatus} onChange={(event) => setRecordStatus(event.currentTarget.value as typeof recordStatus)}><option value="active">有效记录</option><option value="canceled">已取消</option><option value="">全部状态</option></AppSelect></label>
      <label className="table-search"><Search size={14} /><span className="visually-hidden">搜索其他收入</span><input aria-label="搜索其他收入" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索标题、客户或备注" /></label>
    </div></section>
    <SummaryCards totals={summary} ledgerView />
    <div className="business-ledger-table-tools"><p className="business-ledger-result-count">{filtered.length}条其他收入</p></div>
    <section className="business-ledger-table card income-records" aria-label="其他收入列表">
      <header className="business-ledger-row business-ledger-head other-income-row"><span>收入</span><span>类型</span><span>客户／来源</span><span>收益月份</span><span>金额／净收入</span><span>回款</span><span>操作</span></header>
      {filtered.map((record) => {
        const fieldButton = (field: OtherIncomeField, content: React.ReactNode): React.JSX.Element => <button className="income-cell-button" aria-label={`${record.title}：${incomeFieldLabels[field]}`} onClick={(event) => setFieldTarget({ kind: 'other', record, field, anchor: event.currentTarget })}>{content}</button>
        return <div className="business-ledger-row other-income-row" key={record.id} role="group" aria-label={`${record.title}收入记录`}>
          <span className="income-title-button"><button className="income-cell-button income-title-cell" aria-label={`${record.title}其他收入详情`} onClick={() => openRecord(record)}><b>{record.title}</b></button>{fieldButton('incomeDate', <small>{record.incomeDate || '未填写收入日期'}</small>)}</span>
          <span>{fieldButton('category', record.categoryName || '未分类')}</span>
          <span>{fieldButton('source', record.sourceName || '—')}</span>
          <span>{fieldButton('revenueMonth', record.revenueMonth || '—')}</span>
          <span>{fieldButton('amount', <b>{formatRecordMoney(record.amountCents, record.currency)}</b>)}{fieldButton('expectedIncome', <small>净{formatRecordMoney(record.expectedIncomeCents, record.currency)}</small>)}</span>
          <span>{fieldButton('payment', <em className={`business-state-pill ${record.status === 'canceled' ? 'danger' : record.paymentStatus === 'received' ? 'done' : 'pending'}`}>{record.status === 'canceled' ? '已取消' : record.paymentStatus === 'received' ? '已回款' : '待回款'}</em>)}</span>
          <span className="income-row-actions"><button aria-label={`删除${record.title}`} onClick={() => void trash(record.id)}><Trash2 size={13} /></button></span>
        </div>
      })}
      {!filtered.length ? <div className="empty-state"><CircleDollarSign size={24} /><b>没有符合筛选的其他收入</b><span>可以直接新增，或从表格、文本、截图和PDF智能导入。</span></div> : null}
    </section>
    {editor ? <OtherIncomeEditor
      form={editor}
      dirty={dirty}
      saving={saving}
      originalFileName={selected?.originalFileName ?? ''}
      categories={categories}
      sourceTemplates={snapshot.preferences.otherIncomeSourceTemplates}
      error={error}
      onChange={(value) => { setEditor(value); setError('') }}
      onClose={requestClose}
      onSave={() => void save()}
      onSaveSourceTemplate={(name) => void saveSourceTemplate(name)}
      onDeleteSourceTemplate={(name) => void deleteSourceTemplate(name)}
    /> : null}
    {fieldTarget ? <IncomeFieldPopover key={`${fieldTarget.kind === 'other' ? fieldTarget.record.id : fieldTarget.record.projectId}:${fieldTarget.field}`} target={fieldTarget} onDismiss={() => setFieldTarget((current) => current === fieldTarget ? null : current)} onSaved={refresh} /> : null}
    {guard}
    {categoryOpen ? <CategoryManager categories={categories} onClose={() => setCategoryOpen(false)} onChanged={() => void refresh()} /> : null}
    {importOpen ? <OtherIncomeImportDialog categories={categories} onClose={() => setImportOpen(false)} onImported={() => { void refresh(); setImportOpen(false) }} /> : null}
  </main></IncomeLockGate>
}

function OtherIncomeEditor({
  form,
  dirty,
  saving,
  originalFileName,
  categories,
  sourceTemplates,
  error,
  onChange,
  onClose,
  onSave,
  onSaveSourceTemplate,
  onDeleteSourceTemplate
}: {
  form: OtherIncomeForm
  dirty: boolean
  saving: boolean
  originalFileName: string
  categories: OtherIncomeCategory[]
  sourceTemplates: string[]
  error: string
  onChange(value: OtherIncomeForm): void
  onClose(): void
  onSave(): void
  onSaveSourceTemplate(name: string): void
  onDeleteSourceTemplate(name: string): void
}): React.JSX.Element {
  const patch = (value: Partial<OtherIncomeForm>): void => onChange({ ...form, ...value })
  const [templateAnchor, setTemplateAnchor] = useState<HTMLElement | null>(null)
  const trimmedSource = form.sourceName.normalize('NFKC').trim().replace(/\s+/g, ' ')
  const sourceIsSaved = Boolean(trimmedSource) && sourceTemplates.some((item) => sourceTemplateKey(item) === sourceTemplateKey(trimmedSource))
  const expected = (() => { try { return parseMoney(form.amount || '0') - parseMoney(form.directCost || '0') } catch { return 0 } })()
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="income-dialog income-editor-dialog" role="dialog" aria-modal="true" aria-label={form.id ? '其他收入详情' : '新增其他收入'} onKeyDown={(event) => handleIncomeDialogKey(event, onClose)}><header><div><span>其他收入</span><h2>{form.id ? '收入详情' : '新增收入'}</h2></div><button aria-label={form.id ? '关闭其他收入详情' : '关闭收入录入'} disabled={saving} onClick={onClose}><X size={16} /></button></header><div className="income-dialog-body income-form-grid" inert={saving}>
    <label className="wide">收入标题<input autoFocus value={form.title} onChange={(event) => patch({ title: event.currentTarget.value })} placeholder="例如：年度品牌顾问服务" /></label>
    <label>收入类型<AppSelect value={form.categoryId} onChange={(event) => patch({ categoryId: event.currentTarget.value })}><option value="">未分类</option>{categories.filter((item) => item.isActive || item.id === form.categoryId).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</AppSelect></label>
    <div className="income-form-field income-source-template-field">
      <div className="income-source-template-label"><span>客户／来源</span>{trimmedSource ? sourceIsSaved ? <small>已保存</small> : <button type="button" onClick={() => onSaveSourceTemplate(trimmedSource)}><BookmarkPlus size={11} />保存为常用</button> : null}</div>
      <div className="income-source-template-control">
        <input aria-label="客户／来源" value={form.sourceName} onChange={(event) => patch({ sourceName: event.currentTarget.value })} placeholder="公司或平台名称" />
        <button type="button" aria-label="打开常用客户模板" aria-expanded={Boolean(templateAnchor)} onClick={(event) => setTemplateAnchor(templateAnchor ? null : event.currentTarget)}><span>常用</span><ChevronDown size={11} /></button>
      </div>
      {templateAnchor ? <AnchoredPopover anchor={templateAnchor} ariaLabel="常用客户／来源" className="income-source-template-popover" role="menu" onDismiss={() => setTemplateAnchor(null)}>
        {sourceTemplates.length ? sourceTemplates.map((template) => <div key={template}>
          <button type="button" role="menuitem" onClick={() => { patch({ sourceName: template }); setTemplateAnchor(null) }}>{template}</button>
          <button type="button" aria-label={`删除常用客户${template}`} title="删除常用客户" onClick={() => onDeleteSourceTemplate(template)}><Trash2 size={12} /></button>
        </div>) : <p>还没有保存常用客户。</p>}
      </AnchoredPopover> : null}
    </div>
    <label>收益月份<input type="month" value={form.revenueMonth} onChange={(event) => patch({ revenueMonth: event.currentTarget.value })} /></label>
    <label>收入日期<input type="date" value={form.incomeDate} onChange={(event) => patch({ incomeDate: event.currentTarget.value })} /></label>
    <label>收入金额<input inputMode="decimal" value={form.amount} onChange={(event) => patch({ amount: event.currentTarget.value })} placeholder="0.00" /></label>
    <label>直接成本<input inputMode="decimal" value={form.directCost} onChange={(event) => patch({ directCost: event.currentTarget.value })} placeholder="0.00" /></label>
    <label>币种<input value={form.currency} onChange={(event) => patch({ currency: event.currentTarget.value })} placeholder="CNY" /></label>
    <label>预计净收入<output>{formatRecordMoney(expected, form.currency)}</output></label>
    <label>回款状态<AppSelect value={form.paymentStatus} onChange={(event) => patch({ paymentStatus: event.currentTarget.value as OtherIncomeForm['paymentStatus'] })}><option value="pending">待回款</option><option value="received">已回款</option></AppSelect></label>
    <label>回款日期<input type="date" disabled={form.paymentStatus !== 'received'} value={form.paymentReceivedDate} onChange={(event) => patch({ paymentReceivedDate: event.currentTarget.value })} /></label>
    <label>记录状态<AppSelect value={form.status} onChange={(event) => patch({ status: event.currentTarget.value as OtherIncomeForm['status'] })}><option value="active">有效</option><option value="canceled">已取消</option></AppSelect></label>
    <label className="wide">附件或凭证<input type="file" onChange={(event) => { const attachment = event.currentTarget.files?.[0] ?? null; patch({ attachment, sourceReference: attachment?.name ?? form.sourceReference }) }} /><small>{form.attachment?.name || originalFileName || form.sourceReference || '可选择合同、凭证、表格、图片或PDF；也可只在备注中记录云盘链接。'}</small></label>
    <label className="wide">备注<textarea aria-label="备注" value={form.notes} onChange={(event) => patch({ notes: event.currentTarget.value })} placeholder="可记录税费、合同、开票等补充信息" /></label>
    {error ? <p className="form-error wide" role="alert">{error}</p> : null}
  </div><footer><span>{dirty ? '有未保存的修改' : form.id ? '可直接修改，保存后生效' : '填写后保存'}</span><button disabled={saving} onClick={onClose}>{dirty ? '取消' : '关闭'}</button><button className="primary-action" disabled={saving || (Boolean(form.id) && !dirty)} onClick={onSave}>{saving ? '保存中…' : '保存收入'}</button></footer></section></div>
}

function CategoryManager({ categories, onClose, onChanged }: { categories: OtherIncomeCategory[]; onClose(): void; onChanged(): void }): React.JSX.Element {
  const [drafts, setDrafts] = useState(categories)
  const [name, setName] = useState('')
  const save = async (category: OtherIncomeCategory): Promise<void> => {
    const saved = await window.creatorOS?.saveOtherIncomeCategory(category.id, { name: category.name, description: category.description, isActive: category.isActive })
    if (saved) setDrafts((items) => items.map((item) => item.id === saved.id ? saved : item))
    onChanged()
  }
  const add = async (): Promise<void> => {
    if (!name.trim()) return
    const saved = await window.creatorOS?.saveOtherIncomeCategory(null, { name: name.trim(), description: '', isActive: true })
    if (saved) setDrafts((items) => [...items, saved])
    setName(''); onChanged()
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="income-dialog category-dialog" role="dialog" aria-modal="true" aria-label="管理收入类型"><header><div><span>可配置分类</span><h2>其他收入类型</h2></div><button aria-label="关闭" onClick={onClose}><X size={16} /></button></header><div className="income-dialog-body category-list">
    {drafts.map((category, index) => <article key={category.id}><input aria-label="类型名称" value={category.name} onChange={(event) => setDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.currentTarget.value } : item))} /><input aria-label="类型说明" value={category.description} onChange={(event) => setDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.currentTarget.value } : item))} /><label><input type="checkbox" checked={category.isActive} onChange={(event) => setDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: event.currentTarget.checked } : item))} />启用</label><button onClick={() => void save(drafts[index]!)}>保存</button></article>)}
    <div className="category-add"><input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="新增类型名称" /><button className="primary-action" onClick={() => void add()}><Plus size={13} />新增</button></div>
  </div><footer><button onClick={onClose}>完成</button></footer></section></div>
}

function OtherIncomeImportDialog({ categories, onClose, onImported }: { categories: OtherIncomeCategory[]; onClose(): void; onImported(): void }): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [sourceName, setSourceName] = useState('粘贴内容')
  const [instruction, setInstruction] = useState('只提取收入，排除支出、退款和内部转账')
  const [categoryId, setCategoryId] = useState('')
  const [conditions, setConditions] = useState<OtherIncomeImportRuleConditions | null>(null)
  const [ruleConditions, setRuleConditions] = useState<OtherIncomeImportRuleConditions | null>(null)
  const [candidates, setCandidates] = useState<OtherIncomeImportCandidate[]>([])
  const [targets, setTargets] = useState<Record<string, 'other' | 'business'>>({})
  const [file, setFile] = useState<File | null>(null)
  const [retainOriginal, setRetainOriginal] = useState(false)
  const [aliasCompany, setAliasCompany] = useState('')
  const [aliasValue, setAliasValue] = useState('')
  const [ruleName, setRuleName] = useState('')
  const [ruleNameOpen, setRuleNameOpen] = useState(false)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleNotice, setRuleNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = async (): Promise<void> => {
    if (!window.creatorOS) return
    setBusy(true); setError('')
    try {
      const result = await window.creatorOS.previewOtherIncomeImport({
        sourceName: file?.name || sourceName,
        mimeType: file?.type || 'text/plain',
        text: file ? undefined : text,
        bytes: file ? new Uint8Array(await file.arrayBuffer()) : undefined,
        instruction,
        categoryId: categoryId || null,
        today: today(),
        conditions: ruleConditions ?? undefined
      })
      setConditions(result.conditions); setCandidates(result.candidates)
      setTargets(Object.fromEntries(result.candidates.map((candidate) => [candidate.id, 'other'])))
      if (result.errors.length) setError(result.errors.join('；'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '识别失败') }
    finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (!window.creatorOS) return
    const selected = candidates.filter((candidate) => candidate.selected)
    if (!selected.length) { setError('请至少勾选一条收入'); return }
    setBusy(true)
    try {
      const otherRecords = selected.filter((candidate) => targets[candidate.id] !== 'business')
      const businessRecords = selected.filter((candidate) => targets[candidate.id] === 'business')
      const savedOther = otherRecords.length ? await window.creatorOS.saveOtherIncomeRecordsBatch(otherRecords.map((candidate) => ({
        title: candidate.title || candidate.summary || '其他收入',
        categoryId: candidate.categoryId,
        sourceName: candidate.payer,
        revenueMonth: candidate.revenueMonth,
        incomeDate: candidate.transactionDate,
        amountCents: candidate.amountCents ?? 0,
        directCostCents: candidate.directCostCents,
        paymentStatus: candidate.paymentStatus ?? 'pending',
        paymentReceivedDate: candidate.paymentStatus === 'received' ? candidate.transactionDate : null,
        status: 'active',
        currency: candidate.currency,
        notes: candidate.evidence.join('；'),
        sourceReference: file?.name || sourceName,
        sourceTransactionId: candidate.externalTransactionId,
        sourceHash: candidate.sourceHash
      }))) : []
      if (retainOriginal && file && savedOther.length) {
        await window.creatorOS.importOtherIncomeAttachment(savedOther.map((record) => record.id), file.name, new Uint8Array(await file.arrayBuffer()))
      }
      if (businessRecords.length) await window.creatorOS.saveStandaloneBusinessLedgerEntriesBatch(businessRecords.map((candidate) => ({
        title: candidate.title || candidate.summary || '导入商单',
        record: {
          dealStatus: 'ordered',
          manualSettled: false,
          orderPlatform: '',
          orderPlatformManuallySet: false,
          orderDate: candidate.transactionDate,
          revenueMonth: candidate.revenueMonth,
          quotedAmountCents: null,
          platformOrderAmountCents: candidate.amountCents,
          rebateInputMode: 'rate',
          finalRebateRatePercent: null,
          finalRebateAmountCents: null,
          rebateRequirement: 'pending_confirmation',
          rebateRecipientType: 'unknown',
          rebateRecipientName: '',
          rebateProcedureStatus: 'preparing',
          plannedRebateDate: null,
          paymentStatus: candidate.paymentStatus ?? 'pending',
          paymentReceivedDate: candidate.paymentStatus === 'received' ? candidate.transactionDate : null,
          invoiceRequirement: 'pending_confirmation',
          videoProductionCostCents: 0,
          trafficPromotionCostCents: 0,
          incomeAttributionDate: null,
          notes: `从其他收入智能导入转入；${candidate.evidence.join('；')}`
        } satisfies BusinessRecordInput
      })))
      showStagePreview(`已导入${selected.length}笔收入`); onImported()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败') }
    finally { setBusy(false) }
  }
  const saveRule = async (): Promise<void> => {
    if (!window.creatorOS || !conditions || !ruleName.trim()) return
    setRuleSaving(true); setRuleNotice('')
    try {
      const saved = await window.creatorOS.saveOtherIncomeImportRule(null, ruleName.trim(), instruction, conditions)
      await refresh()
      setRuleNameOpen(false)
      setRuleNotice(`已保存“${saved.name}”`)
      showStagePreview('常用导入规则已保存')
    } catch (reason) {
      setRuleNotice(reason instanceof Error ? reason.message : '规则保存失败')
    } finally {
      setRuleSaving(false)
    }
  }
  const confirmAlias = async (): Promise<void> => {
    if (!window.creatorOS || !aliasCompany.trim() || !aliasValue.trim()) return
    await window.creatorOS.saveOtherIncomeCompanyAlias(aliasCompany, aliasValue)
    setAliasCompany(''); setAliasValue('')
    showStagePreview('公司别名已确认，之后可用于精确匹配')
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="income-dialog income-import-dialog" role="dialog" aria-modal="true" aria-label="智能批量导入其他收入"><header><div><span>先筛选、预览和核对，再写入台账</span><h2>智能批量导入</h2></div><button aria-label="关闭" onClick={onClose}><X size={16} /></button></header><div className="income-dialog-body import-body">
    <section className="import-source-panel"><div className="import-source-actions"><button onClick={() => inputRef.current?.click()}><FileUp size={14} />选择文件</button><input ref={inputRef} hidden type="file" accept=".xlsx,.csv,.tsv,.txt,.pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => { const picked = event.currentTarget.files?.[0] ?? null; setFile(picked); if (picked) setSourceName(picked.name) }} /><span>{file?.name || '支持Excel、CSV、TSV、TXT、截图和PDF'}</span>{file ? <button onClick={() => setFile(null)}>改用粘贴</button> : null}</div>
      {!file ? <textarea value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="粘贴银行流水、转账记录、合同或聊天中的表格／文本…" /> : null}
      <label>筛选要求<textarea value={instruction} onChange={(event) => { setInstruction(event.currentTarget.value); setRuleConditions(null) }} placeholder="输入付款方、日期、金额、到账状态或排除条件" /></label>
      <div className="import-rule-row"><AppSelect value={categoryId} onChange={(event) => setCategoryId(event.currentTarget.value)}><option value="">默认未分类</option>{categories.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</AppSelect><button className="primary-action" disabled={busy || (!file && !text.trim())} onClick={() => void preview()}><Sparkles size={13} />{busy ? '识别中…' : '生成预览'}</button></div>
      {snapshot.otherIncomeImportRules.length ? <div className="saved-rules"><span>常用规则</span>{snapshot.otherIncomeImportRules.map((rule) => <button key={rule.id} onClick={() => { setInstruction(rule.instruction); setConditions(rule.conditions); setRuleConditions(rule.conditions); setCategoryId(rule.conditions.categoryId ?? '') }}>{rule.name}</button>)}</div> : null}
      <details className="alias-manager"><summary>确认公司别名</summary><div><input aria-label="公司全名" value={aliasCompany} onChange={(event) => setAliasCompany(event.currentTarget.value)} placeholder="公司全名" /><input aria-label="公司别名" value={aliasValue} onChange={(event) => setAliasValue(event.currentTarget.value)} placeholder="账单中出现的别名" /><button disabled={!aliasCompany.trim() || !aliasValue.trim()} onClick={() => void confirmAlias()}>确认别名</button></div>{snapshot.otherIncomeCompanyAliases.length ? <p>{snapshot.otherIncomeCompanyAliases.map((alias) => `${alias.companyName}＝${alias.alias}`).join('；')}</p> : null}</details>
    </section>
    {conditions ? <section className="visible-conditions"><header><b>实际执行条件</b><button onClick={() => { setRuleName(instruction.trim().slice(0, 24) || '收入筛选规则'); setRuleNameOpen(true); setRuleNotice('') }}>保存为常用规则</button></header>
      {ruleNameOpen ? <form className="rule-save-editor" onSubmit={(event) => { event.preventDefault(); void saveRule() }}><input autoFocus aria-label="常用规则名称" value={ruleName} onChange={(event) => setRuleName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRuleNameOpen(false) }} placeholder="给这条规则起个名字" /><button className="primary-action" disabled={ruleSaving || !ruleName.trim()} type="submit">{ruleSaving ? '保存中…' : '确认保存'}</button><button type="button" onClick={() => setRuleNameOpen(false)}>取消</button></form> : null}
      {ruleNotice ? <p className="rule-save-notice" role="status">{ruleNotice}</p> : null}
      <div>{conditionsText(conditions).map((item) => <span key={item}>{item}</span>)}</div><small>公司优先按全名或已确认别名匹配；以“公司”结尾的简称会使用核心词匹配付款方，并在候选证据中说明。</small></section> : null}
    {candidates.length ? <section className="import-candidates"><header><b>识别结果</b><span>已选{candidates.filter((item) => item.selected).length}/{candidates.length}条</span></header>{candidates.map((candidate, index) => <article className={!candidate.selected ? 'muted' : ''} key={candidate.id}><input type="checkbox" aria-label={`选择第${candidate.rowNumber}行`} checked={candidate.selected} disabled={candidate.amountCents == null || candidate.amountCents <= 0} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.currentTarget.checked } : item))} /><div><input aria-label={`第${candidate.rowNumber}行收入标题`} value={candidate.title} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.currentTarget.value } : item))} /><div className="candidate-edit-grid">
      <input aria-label={`第${candidate.rowNumber}行付款方`} value={candidate.payer} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, payer: event.currentTarget.value } : item))} placeholder="付款方" />
      <input aria-label={`第${candidate.rowNumber}行收入日期`} type="date" value={candidate.transactionDate ?? ''} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, transactionDate: event.currentTarget.value || null } : item))} />
      <input aria-label={`第${candidate.rowNumber}行收益月份`} type="month" value={candidate.revenueMonth ?? ''} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, revenueMonth: event.currentTarget.value || null } : item))} />
      <input aria-label={`第${candidate.rowNumber}行收入金额`} inputMode="decimal" value={candidate.amountCents == null ? '' : String(candidate.amountCents / 100)} onChange={(event) => { const amount = (() => { try { return parseMoney(event.currentTarget.value) } catch { return null } })(); setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, amountCents: amount, selected: amount !== null && amount > 0 && item.selected } : item)) }} placeholder="收入金额" />
      <AppSelect aria-label={`第${candidate.rowNumber}行回款状态`} value={candidate.paymentStatus ?? 'pending'} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, paymentStatus: event.currentTarget.value as 'pending' | 'received' } : item))}><option value="pending">待回款</option><option value="received">已回款</option></AppSelect>
      <input aria-label={`第${candidate.rowNumber}行直接成本`} inputMode="decimal" value={String(candidate.directCostCents / 100)} onChange={(event) => { const cost = (() => { try { return parseMoney(event.currentTarget.value) } catch { return 0 } })(); setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, directCostCents: cost } : item)) }} placeholder="直接成本" />
      <input aria-label={`第${candidate.rowNumber}行币种`} value={candidate.currency} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, currency: event.currentTarget.value.toUpperCase() } : item))} placeholder="CNY" />
    </div><small>{candidate.evidence.join('；') || '暂无命中依据'}</small>{candidate.exclusionReasons.length || candidate.warnings.length ? <em>{[...candidate.exclusionReasons, ...candidate.warnings].join('；')}</em> : null}</div><div className="candidate-targets"><AppSelect aria-label={`第${candidate.rowNumber}行导入台账`} value={targets[candidate.id] ?? 'other'} onChange={(event) => setTargets((current) => ({ ...current, [candidate.id]: event.currentTarget.value as 'other' | 'business' }))}><option value="other">其他收入</option><option value="business">商单收入</option></AppSelect>{targets[candidate.id] !== 'business' ? <AppSelect aria-label={`第${candidate.rowNumber}行收入类型`} value={candidate.categoryId ?? ''} onChange={(event) => setCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, categoryId: event.currentTarget.value || null } : item))}><option value="">未分类</option>{categories.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</AppSelect> : null}</div></article>)}</section> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div><footer><label className="retain-original"><input type="checkbox" disabled={!file} checked={retainOriginal} onChange={(event) => setRetainOriginal(event.currentTarget.checked)} />保留原始文件作为附件</label><span>{retainOriginal && file ? '原文件会受管保存并关联到本次其他收入。' : '原文件默认不保留，只保存确认后的结构化记录。'}</span><button onClick={onClose}>取消</button><button className="primary-action" disabled={busy || !candidates.some((candidate) => candidate.selected)} onClick={() => void save()}>导入所选收入</button></footer></section></div>
}
