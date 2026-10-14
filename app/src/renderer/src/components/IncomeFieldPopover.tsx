import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { BusinessRecordPatch, OtherIncomeRecordPatch } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { incomeFieldLabels, type IncomeFieldTarget } from '../utils/income-fields'
import { AnchoredPopover } from './AnchoredPopover'

function money(cents: number | null, currency = 'CNY'): string {
  if (cents === null) return '待确认'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(cents / 100)
}
function parseAmount(value: string, nullable = false): number | null {
  const normalized = value.trim().replace(/[¥￥,\s元]/g, '')
  if (!normalized && nullable) return null
  if (!normalized) throw new Error('请填写金额')
  const amount = Number(normalized)
  const cents = Math.round(amount * 100)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents)) throw new Error('金额格式无效')
  return cents
}
function dateToday(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function initialValue(target: IncomeFieldTarget): string {
  const record = target.record
  switch (target.field) {
    case 'revenueMonth': return record.revenueMonth ?? ''
    case 'expectedIncome': return ''
    case 'payment': return target.kind === 'other' && target.record.status === 'canceled' ? 'canceled' : record.paymentStatus
  }
  if (target.kind === 'business') {
    const entry = target.record
    switch (target.field) {
      case 'platform': return entry.orderPlatform
      case 'orderDate': return entry.orderDate ?? ''
      case 'orderAmount': return entry.platformOrderAmountCents === null ? '' : String(entry.platformOrderAmountCents / 100)
      case 'lifecycle': return entry.lifecycleStatus
      case 'invoice': return entry.invoiceRequirement === 'required' ? entry.invoiceExecutionStatus === 'issued' ? 'received' : 'pending' : entry.invoiceRequirement
      case 'rebate': return entry.rebateRequirement
    }
  } else {
    switch (target.field) {
      case 'category': return target.record.categoryId ?? ''
      case 'source': return target.record.sourceName
      case 'incomeDate': return target.record.incomeDate ?? ''
      case 'amount': return String(target.record.amountCents / 100)
    }
  }
  return ''
}

export function IncomeFieldPopover({ target, onDismiss, onSaved }: { target: IncomeFieldTarget; onDismiss(): void; onSaved(): Promise<unknown> }): React.JSX.Element {
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const categories = useWorkspaceStore((state) => state.snapshot.otherIncomeCategories)
  const initial = initialValue(target)
  const [value, setValue] = useState(initial)
  const entry = target.kind === 'business' ? target.record : null
  const [rebateMode, setRebateMode] = useState(entry?.rebateInputMode ?? 'rate')
  const [rebateValue, setRebateValue] = useState(entry?.rebateInputMode === 'amount' ? entry.finalRebateAmountCents == null ? '' : String(entry.finalRebateAmountCents / 100) : entry?.finalRebateRatePercent == null ? '' : String(entry.finalRebateRatePercent))
  const [recipient, setRecipient] = useState(entry?.rebateRecipientName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>('input, button')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  const label = incomeFieldLabels[target.field]
  const close = (): void => { if (!saving) onDismiss() }
  const save = async (nextValue = value): Promise<void> => {
    if (!window.creatorOS || saving) return
    setSaving(true)
    setError('')
    try {
      if (target.kind === 'business') {
        let patch: BusinessRecordPatch
        switch (target.field) {
          case 'platform': patch = { orderPlatform: nextValue }; break
          case 'orderDate': patch = { orderDate: nextValue || null }; break
          case 'revenueMonth': patch = { revenueMonth: nextValue || null }; break
          case 'orderAmount': patch = { platformOrderAmountCents: parseAmount(nextValue, true) }; break
          case 'payment': patch = { paymentStatus: nextValue as 'pending' | 'received', paymentReceivedDate: nextValue === 'received' ? target.record.paymentReceivedDate || dateToday() : null }; break
          case 'lifecycle': patch = { dealStatus: nextValue === 'settled' ? 'ordered' : nextValue as 'ordered' | 'agreed_pending_order' | 'canceled', manualSettled: nextValue === 'settled' }; break
          case 'invoice': patch = { invoiceRequirement: ['received', 'pending'].includes(nextValue) ? 'required' : nextValue as 'pending_confirmation' | 'not_required', invoiceReceivedManually: nextValue === 'received' }; break
          case 'rebate': {
            const rate = rebateValue.trim() ? Number(rebateValue.replace(/%$/, '')) : null
            if (value === 'required' && rebateMode === 'rate' && rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error('返点比例必须在0%到100%之间')
            patch = { rebateRequirement: value as 'required' | 'not_required' | 'pending_confirmation', rebateInputMode: rebateMode, rebateRecipientName: recipient,
              finalRebateRatePercent: value === 'required' && rebateMode === 'rate' ? rate : null,
              finalRebateAmountCents: value === 'required' && rebateMode === 'amount' ? parseAmount(rebateValue, true) : null }
            break
          }
          default: return
        }
        await window.creatorOS.patchBusinessRecord(target.record.projectId, patch)
      } else {
        let patch: OtherIncomeRecordPatch
        switch (target.field) {
          case 'category': patch = { categoryId: nextValue || null }; break
          case 'source': patch = { sourceName: nextValue }; break
          case 'revenueMonth': patch = { revenueMonth: nextValue || null }; break
          case 'incomeDate': patch = { incomeDate: nextValue || null }; break
          case 'amount': patch = { amountCents: parseAmount(nextValue)! }; break
          case 'payment': patch = nextValue === 'canceled' ? { status: 'canceled' } : { status: 'active', paymentStatus: nextValue as 'received' | 'pending', paymentReceivedDate: nextValue === 'received' ? target.record.paymentReceivedDate || dateToday() : null }; break
          default: return
        }
        await window.creatorOS.patchOtherIncomeRecord(target.record.id, patch)
      }
      await onSaved()
      onDismiss()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试') }
    finally { setSaving(false) }
  }
  const options: Array<{ value: string; label: string; disabled?: boolean }> | null = target.field === 'payment'
    ? [{ value: 'pending', label: target.kind === 'business' ? '未回款' : '待回款' }, { value: 'received', label: '已回款' }, ...(target.kind === 'other' ? [{ value: 'canceled', label: '已取消' }] : [])]
    : target.kind === 'business' && target.field === 'platform'
      ? [{ value: '', label: '未填写' }, ...[...new Set([...preferences.businessPlatforms, target.record.orderPlatform].filter(Boolean))].map((platform) => ({ value: platform, label: platform }))]
      : target.field === 'lifecycle'
        ? [{ value: 'agreed_pending_order', label: '已谈妥·待下单' }, { value: 'ordered', label: '已下单' }, { value: 'settled', label: '已结清' }, { value: 'canceled', label: '已取消' }]
        : target.field === 'invoice'
          ? [{ value: 'pending_confirmation', label: '待确认' }, { value: 'not_required', label: '无需返点发票' }, { value: 'pending', label: '待收返点发票', disabled: entry?.invoiceExecutionStatus === 'issued' && !entry.invoiceReceivedManuallyAt }, { value: 'received', label: '已收到' }]
          : target.kind === 'other' && target.field === 'category'
            ? [{ value: '', label: '未分类' }, ...categories.filter((category) => category.isActive || category.id === target.record.categoryId).map((category) => ({ value: category.id, label: category.name }))]
            : null
  const readOnly = target.field === 'expectedIncome'
  const inputType = target.field === 'orderDate' || target.field === 'incomeDate' ? 'date' : target.field === 'revenueMonth' ? 'month' : 'text'
  return <AnchoredPopover anchor={target.anchor} ariaLabel={`${label}${readOnly ? '明细' : '快捷修改'}`} className="income-field-popover" onDismiss={close}>
    <header><b>{label}</b><button aria-label="关闭单项修改" disabled={saving} onClick={close}><X size={14} /></button></header>
    <div ref={contentRef} className="income-field-content" inert={saving}>
      {readOnly ? <><p>自动计算，不直接填写净收入。</p><dl>
        {target.kind === 'business' ? <><div><dt>商单金额</dt><dd>{money(target.record.platformOrderAmountCents)}</dd></div><div><dt>返点</dt><dd>{money(target.record.effectiveFinalRebateAmountCents)}</dd></div><div><dt>制作成本</dt><dd>{money(target.record.videoProductionCostCents)}</dd></div><div><dt>投流成本</dt><dd>{money(target.record.trafficPromotionCostCents)}</dd></div></> : <><div><dt>收入金额</dt><dd>{money(target.record.amountCents, target.record.currency)}</dd></div><div><dt>直接成本</dt><dd>{money(target.record.directCostCents, target.record.currency)}</dd></div></>}
        <div><dt>预计净收入</dt><dd>{money(target.record.expectedIncomeCents, target.kind === 'other' ? target.record.currency : 'CNY')}</dd></div>
      </dl></> : options ? <div className="income-field-options">{options.map((option) => <button key={option.value} aria-pressed={initial === option.value} disabled={option.disabled} onClick={() => void save(option.value)}>{option.label}{initial === option.value ? <Check size={14} aria-hidden="true" /> : null}</button>)}</div> : target.field === 'rebate' ? <>
        <div className="income-field-options">{[{ value: 'pending_confirmation', label: '待确认' }, { value: 'not_required', label: '无需返点' }, { value: 'required', label: '需要返点' }].map((option) => <button key={option.value} aria-pressed={value === option.value} onClick={() => { setValue(option.value); setError('') }}>{option.label}</button>)}</div>
        {value === 'required' ? <><div className="business-choice-chips"><button aria-pressed={rebateMode === 'rate'} onClick={() => { setRebateMode('rate'); setRebateValue(entry?.finalRebateRatePercent == null ? '' : String(entry.finalRebateRatePercent)) }}>按比例</button><button aria-pressed={rebateMode === 'amount'} onClick={() => { setRebateMode('amount'); setRebateValue(entry?.effectiveFinalRebateAmountCents == null ? '' : String(entry.effectiveFinalRebateAmountCents / 100)) }}>按金额</button></div><label>{rebateMode === 'rate' ? '返点比例（%）' : '返点金额'}<input aria-label={rebateMode === 'rate' ? '返点比例' : '返点金额'} inputMode="decimal" value={rebateValue} onChange={(event) => setRebateValue(event.currentTarget.value)} /></label><label>返点方<input value={recipient} onChange={(event) => setRecipient(event.currentTarget.value)} /></label><p>{entry?.rebateExecutionStatus === 'completed' ? '已根据支付记录或凭证确认返点。' : '返点完成状态根据支付记录或凭证确认。'}</p></> : null}
      </> : <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label>{label}<input autoFocus type={inputType} inputMode={target.field === 'amount' || target.field === 'orderAmount' ? 'decimal' : undefined} value={value} onChange={(event) => { setValue(event.currentTarget.value); setError('') }} /></label>
        {target.field === 'source' && preferences.otherIncomeSourceTemplates.length ? <div className="income-field-options">{preferences.otherIncomeSourceTemplates.map((source) => <button type="button" key={source} onClick={() => setValue(source)}>{source}</button>)}</div> : null}
        <button type="submit" className="visually-hidden" tabIndex={-1}>提交单项修改</button>
      </form>}
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {saving ? <p role="status">保存中…</p> : !readOnly && !options ? <footer><button onClick={close}>取消</button><button className="primary-action" onClick={() => void save()}>保存</button></footer> : null}
  </AnchoredPopover>
}
