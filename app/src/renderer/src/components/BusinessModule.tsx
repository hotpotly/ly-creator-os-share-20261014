import { AppSelect } from './AppSelect'
import { Check, ChevronRight, ExternalLink, FileSearch, FileText, FolderOpen, ImageUp, Link2, Plus, ReceiptText, Trash2, UploadCloud, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BusinessAutofillResult, BusinessFileRole, BusinessFolderScanResult, BusinessInvoice, BusinessRecordInput, ProjectDetail, RebatePayment } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'

const moneyFormatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 })
const money = (cents: number | null): string => cents == null ? '—' : moneyFormatter.format(cents / 100)
const inputMoney = (cents: number | null): string => cents == null ? '' : String(cents / 100)
const parseMoney = (value: string, required = false): number | null => {
  const trimmed = value.trim()
  if (!trimmed) { if (required) throw new Error('请填写金额'); return null }
  const number = Number(trimmed.replace(/[¥￥,\s元]/g, ''))
  if (!Number.isFinite(number) || number < 0) throw new Error('金额格式无效')
  return Math.round(number * 100)
}
const safeParseMoney = (value: string): number | null => { try { return parseMoney(value) } catch { return null } }
const dateValue = (value: string): string | null => value.trim() || null
const currentLocalDate = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const fileLabels: Record<BusinessFileRole, string> = {
  rebate_contract: '返点合同',
  invoice_file: '返点发票',
  rebate_payment_proof: '返点支付凭证',
  chat_screenshot: '聊天截图'
}
const executionLabels = { pending_confirmation: '待确认', not_required: '无需返点', waiting_payment: '等待回款', pending: '待返点', missing_transfer_proof: '缺转账记录', completed: '已完成' } as const

interface BusinessFormState {
  orderPlatform: string
  orderDate: string
  revenueMonth: string
  platformOrderAmount: string
  rebateInputMode: BusinessRecordInput['rebateInputMode']
  finalRebateRate: string
  finalRebateAmount: string
  rebateRequirement: BusinessRecordInput['rebateRequirement']
  rebateRecipientType: BusinessRecordInput['rebateRecipientType']
  rebateRecipientName: string
  rebateProcedureStatus: BusinessRecordInput['rebateProcedureStatus']
  paymentStatus: BusinessRecordInput['paymentStatus']
  paymentReceivedDate: string
  invoiceRequirement: BusinessRecordInput['invoiceRequirement']
  videoProductionCost: string
  trafficPromotionCost: string
  notes: string
}

function stateFromProject(project: ProjectDetail): BusinessFormState {
  const record = project.business?.record
  return {
    orderPlatform: record?.orderPlatform || (project.platformTargets.length === 1 ? project.platformTargets[0] ?? '' : ''),
    orderDate: record?.orderDate ?? '', revenueMonth: record?.revenueMonth ?? '', platformOrderAmount: inputMoney(record?.platformOrderAmountCents ?? null),
    rebateInputMode: record?.rebateInputMode ?? 'rate',
    finalRebateRate: record?.finalRebateRatePercent == null ? '' : String(record.finalRebateRatePercent), finalRebateAmount: inputMoney(record?.finalRebateAmountCents ?? null),
    rebateRequirement: record?.rebateRequirement ?? 'pending_confirmation', rebateRecipientType: record?.rebateRecipientType === 'personal' ? 'personal' : 'corporate',
    rebateRecipientName: record?.rebateRecipientName ?? '', rebateProcedureStatus: record?.rebateProcedureStatus ?? 'preparing',
    paymentStatus: record?.paymentStatus ?? 'pending', paymentReceivedDate: record?.paymentReceivedDate ?? '', invoiceRequirement: record?.invoiceRequirement ?? 'pending_confirmation',
    videoProductionCost: inputMoney(record?.videoProductionCostCents ?? 0), trafficPromotionCost: inputMoney(record?.trafficPromotionCostCents ?? 0), notes: record?.notes ?? ''
  }
}

function calculatedRebateAmount(orderValue: string, rateValue: string): number | null {
  const order = safeParseMoney(orderValue); const rate = Number(rateValue)
  return order != null && rateValue.trim() && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? Math.round(order * rate / 100) : null
}

export function BusinessModule({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  const business = project.business
  const projects = useWorkspaceStore((state) => state.snapshot.projects)
  const businessPlatforms = useWorkspaceStore((state) => state.snapshot.preferences.businessPlatforms)
  const commercialProjects = useMemo(() => projects.filter((item) => item.isCommercial && !item.trashedAt), [projects])
  const [form, setForm] = useState(() => stateFromProject(project))
  const [saving, setSaving] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [autofillSummary, setAutofillSummary] = useState<{ fields: string[]; warnings: string[]; model: string } | null>(null)
  const [paymentEditor, setPaymentEditor] = useState<{ id: string | null; amount: string; paidDate: string; notes: string } | null>(null)
  const [invoiceEditor, setInvoiceEditor] = useState<{ id: string | null; issuerName: string; amount: string; issuedDate: string; linkedProjectIds: string[] } | null>(null)
  const [folderScan, setFolderScan] = useState<(BusinessFolderScanResult & { selectedIds: string[] }) | null>(null)
  const [scanningFolder, setScanningFolder] = useState(false)
  const [fileTarget, setFileTarget] = useState<{ role: BusinessFileRole; rebatePaymentId: string | null; invoiceId: string | null } | null>(null)
  const [sharedFileEditor, setSharedFileEditor] = useState<{ fileId: string; projectIds: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autofillInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setForm(stateFromProject(project)), [project])
  const patch = <K extends keyof BusinessFormState>(key: K, value: BusinessFormState[K]): void => setForm((current) => ({ ...current, [key]: value }))
  const derivedFromRate = useMemo(() => calculatedRebateAmount(form.platformOrderAmount, form.finalRebateRate), [form.finalRebateRate, form.platformOrderAmount])
  const platformOptions = useMemo(() => [...new Set([...businessPlatforms, ...(form.orderPlatform ? [form.orderPlatform] : [])])], [businessPlatforms, form.orderPlatform])

  if (!business) return <section className="content-card project-module-surface business-workspace"><div className="module-empty-state"><b>金额只用于商单项目</b><span>把主要内容方向切回商单后，原有商务内容会重新显示。</span></div></section>

  const saveRecord = async (): Promise<void> => {
    if (!window.creatorOS || saving) return
    setSaving(true)
    try {
      const rate = form.finalRebateRate.trim() ? Number(form.finalRebateRate) : null
      if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error('返点比例必须在0%到100%之间')
      await window.creatorOS.saveBusinessRecord(project.id, {
        dealStatus: business.record.dealStatus,
        manualSettled: business.record.settlementMode === 'manual',
        orderPlatform: form.orderPlatform,
        orderPlatformManuallySet: business.record.orderPlatformManuallySet || form.orderPlatform !== business.record.orderPlatform,
        orderDate: dateValue(form.orderDate), revenueMonth: dateValue(form.revenueMonth),
        quotedAmountCents: business.record.quotedAmountCents, platformOrderAmountCents: parseMoney(form.platformOrderAmount),
        rebateInputMode: form.rebateInputMode,
        finalRebateRatePercent: form.rebateRequirement === 'required' && form.rebateInputMode === 'rate' ? rate : null,
        finalRebateAmountCents: form.rebateRequirement === 'required' && form.rebateInputMode === 'amount' ? parseMoney(form.finalRebateAmount) : derivedFromRate,
        rebateRequirement: form.rebateRequirement, rebateRecipientType: form.rebateRecipientType, rebateRecipientName: form.rebateRecipientName,
        rebateProcedureStatus: form.rebateProcedureStatus, plannedRebateDate: business.record.plannedRebateDate,
        paymentStatus: form.paymentStatus, paymentReceivedDate: form.paymentStatus === 'received' ? dateValue(form.paymentReceivedDate) : null,
        invoiceRequirement: form.invoiceRequirement, videoProductionCostCents: parseMoney(form.videoProductionCost) ?? 0,
        trafficPromotionCostCents: parseMoney(form.trafficPromotionCost) ?? 0, incomeAttributionDate: business.record.incomeAttributionDate, notes: form.notes
      })
      onNotice('金额信息已保存；预计净收入和结算状态已重新计算'); onChanged()
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '金额信息保存失败') }
    finally { setSaving(false) }
  }

  const applyAutofill = (result: BusinessAutofillResult): void => {
    const normalizedPlatform = result.orderPlatform
    setForm((current) => ({ ...current,
      orderPlatform: normalizedPlatform ?? current.orderPlatform, orderDate: result.orderDate ?? current.orderDate,
      revenueMonth: result.revenueMonth ?? result.orderDate?.slice(0, 7) ?? current.revenueMonth,
      platformOrderAmount: result.platformOrderAmountCents == null ? current.platformOrderAmount : inputMoney(result.platformOrderAmountCents),
      finalRebateRate: result.finalRebateRatePercent == null ? current.finalRebateRate : String(result.finalRebateRatePercent),
      finalRebateAmount: result.finalRebateAmountCents == null ? current.finalRebateAmount : inputMoney(result.finalRebateAmountCents),
      rebateRequirement: result.rebateRequirement ?? current.rebateRequirement, rebateRecipientType: result.rebateRecipientType ?? current.rebateRecipientType,
      rebateRecipientName: result.rebateRecipientName ?? current.rebateRecipientName, paymentStatus: result.paymentStatus ?? current.paymentStatus,
      paymentReceivedDate: result.paymentReceivedDate ?? current.paymentReceivedDate, invoiceRequirement: result.invoiceRequirement ?? current.invoiceRequirement,
      videoProductionCost: result.videoProductionCostCents == null ? current.videoProductionCost : inputMoney(result.videoProductionCostCents),
      trafficPromotionCost: result.trafficPromotionCostCents == null ? current.trafficPromotionCost : inputMoney(result.trafficPromotionCostCents), notes: result.notes ?? current.notes
    }))
    const warnings = [...result.warnings]
    setAutofillSummary({ fields: result.recognizedFields, warnings, model: result.model })
    onNotice(result.recognizedFields.length ? `已从图片填入${result.recognizedFields.length}项，请检查后保存` : '图片中没有识别到可填写的商务字段')
  }
  const recognizeScreenshot = async (file: File): Promise<void> => {
    if (!window.creatorOS || recognizing) return
    if (file.size > 12 * 1024 * 1024) { onNotice('商务截图不能超过12MB'); return }
    setRecognizing(true)
    try { applyAutofill(await window.creatorOS.extractBusinessScreenshot(project.id, file.name, new Uint8Array(await file.arrayBuffer()))) }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '截图识别失败') }
    finally { setRecognizing(false) }
  }

  const editPayment = (payment?: RebatePayment): void => setPaymentEditor(payment ? { id: payment.id, amount: inputMoney(payment.amountCents), paidDate: payment.paidDate, notes: payment.notes } : { id: null, amount: inputMoney(derivedFromRate ?? business.record.effectiveFinalRebateAmountCents), paidDate: currentLocalDate(), notes: '' })
  const savePayment = async (): Promise<void> => { if (!window.creatorOS || !paymentEditor || saving) return; setSaving(true); try { await window.creatorOS.saveRebatePayment(project.id, paymentEditor.id, { amountCents: parseMoney(paymentEditor.amount, true)!, paidDate: paymentEditor.paidDate, notes: paymentEditor.notes }); setPaymentEditor(null); onNotice('返点记录已保存'); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '返点记录保存失败') } finally { setSaving(false) } }
  const removePayment = async (id: string): Promise<void> => { if (!window.creatorOS || saving) return; setSaving(true); try { await window.creatorOS.deleteRebatePayment(project.id, id); onNotice('返点记录已删除'); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '返点记录删除失败') } finally { setSaving(false) } }
  const editInvoice = (invoice?: BusinessInvoice): void => setInvoiceEditor(invoice ? { id: invoice.id, issuerName: invoice.issuerName, amount: inputMoney(invoice.amountCents), issuedDate: invoice.issuedDate ?? '', linkedProjectIds: [...invoice.linkedProjectIds] } : { id: null, issuerName: form.rebateRecipientName, amount: inputMoney(business.record.effectiveFinalRebateAmountCents), issuedDate: '', linkedProjectIds: [project.id] })
  const saveInvoice = async (): Promise<void> => { if (!window.creatorOS || !invoiceEditor || saving) return; setSaving(true); try { await window.creatorOS.saveBusinessInvoice(project.id, invoiceEditor.id, { issuerName: invoiceEditor.issuerName, amountCents: parseMoney(invoiceEditor.amount, true)!, issuedDate: dateValue(invoiceEditor.issuedDate), status: 'issued', deliveredToClient: false, notes: '', linkedProjectIds: invoiceEditor.linkedProjectIds }); setInvoiceEditor(null); onNotice('返点发票已保存'); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '返点发票保存失败') } finally { setSaving(false) } }
  const removeInvoice = async (id: string): Promise<void> => { if (!window.creatorOS || saving) return; setSaving(true); try { await window.creatorOS.deleteBusinessInvoice(project.id, id); onNotice('返点发票已删除'); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '返点发票删除失败') } finally { setSaving(false) } }

  const chooseFile = (role: BusinessFileRole, rebatePaymentId: string | null = null, invoiceId: string | null = null): void => { setFileTarget({ role, rebatePaymentId, invoiceId }); fileInputRef.current?.click() }
  const importFile = async (file: File): Promise<void> => { if (!window.creatorOS || !fileTarget || saving) return; setSaving(true); try { await window.creatorOS.importBusinessFile(project.id, fileTarget.role, file.name, new Uint8Array(await file.arrayBuffer()), fileTarget); onNotice(`已保存${fileLabels[fileTarget.role]}`); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '商务文件导入失败') } finally { setSaving(false); setFileTarget(null) } }
  const removeFile = async (id: string): Promise<void> => { if (!window.creatorOS || saving) return; setSaving(true); try { await window.creatorOS.deleteBusinessFile(project.id, id); onNotice('商务文件已删除'); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '商务文件删除失败') } finally { setSaving(false) } }
  const saveSharedProjects = async (): Promise<void> => { if (!window.creatorOS || !sharedFileEditor || saving) return; setSaving(true); try { await window.creatorOS.setBusinessFileProjects(project.id, sharedFileEditor.fileId, sharedFileEditor.projectIds); setSharedFileEditor(null); onNotice('共用商单已更新'); onChanged() } catch (reason) { onNotice(reason instanceof Error ? reason.message : '共用商单更新失败') } finally { setSaving(false) } }
  const scanFolder = async (): Promise<void> => {
    if (!window.creatorOS || scanningFolder) return
    setScanningFolder(true)
    try {
      const result = await window.creatorOS.scanBusinessFolder()
      if (!result.canceled) setFolderScan({ ...result, selectedIds: result.candidates.map((candidate) => candidate.id) })
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '商务资料文件夹扫描失败') }
    finally { setScanningFolder(false) }
  }
  const importFolderCandidates = async (): Promise<void> => {
    if (!window.creatorOS || !folderScan?.scanId || !folderScan.selectedIds.length || saving) return
    setSaving(true)
    try {
      await window.creatorOS.importBusinessFolderCandidates(project.id, folderScan.scanId, folderScan.selectedIds)
      onNotice(`已导入${folderScan.selectedIds.length}个商务文件`)
      setFolderScan(null)
      onChanged()
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '商务资料导入失败') }
    finally { setSaving(false) }
  }

  const record = business.record
  const activeSharedFile = sharedFileEditor ? business.files.find((file) => file.id === sharedFileEditor.fileId) ?? null : null
  const rebateRequired = form.rebateRequirement === 'required'
  const invoiceRequired = form.invoiceRequirement === 'required'
  const invoiceLabel = record.invoiceExecutionStatus === 'pending_confirmation' ? '待确认' : record.invoiceExecutionStatus === 'not_required' ? '无需返点发票' : record.invoiceExecutionStatus === 'pending' ? '待收返点发票' : '已收返点发票'

  return <section className="content-card project-module-surface business-workspace">
    <header className="business-workspace-header"><div><span>项目商务金额</span><h2>金额</h2></div><div className="module-header-actions">
      <input ref={autofillInputRef} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void recognizeScreenshot(file); event.currentTarget.value = '' }} />
      <button disabled={recognizing} onClick={() => autofillInputRef.current?.click()}><ImageUp size={13} />{recognizing ? '正在识别…' : '聊天截图识别'}</button>
      <button disabled={scanningFolder} onClick={() => void scanFolder()}><FileSearch size={13} />{scanningFolder ? '扫描中…' : '扫描资料文件夹'}</button>
      <button onClick={() => navigate({ page: 'business', projectId: project.id })}>商单收入<ExternalLink size={13} /></button>
      <button className="primary-action" disabled={saving || recognizing} onClick={() => void saveRecord()}>{saving ? '保存中…' : '保存'}</button>
    </div></header>
    {autofillSummary ? <div className="business-autofill-result" role="status"><div><b>已识别{autofillSummary.fields.length}项</b><span>{autofillSummary.fields.join('、') || '未找到可填写字段'}·{autofillSummary.model}</span></div><small>{autofillSummary.warnings.join('；') || '已填入表单，保存前可逐项修改。'}</small><button aria-label="关闭识别结果" onClick={() => setAutofillSummary(null)}><X size={13} /></button></div> : null}

    <div className="business-summary"><article><span>商单金额</span><b>{money(record.platformOrderAmountCents)}</b><small>{record.paymentStatus === 'received' ? '已回款' : '待回款'}</small></article><article><span>最终返点</span><b>{money(record.effectiveFinalRebateAmountCents)}</b><small>{executionLabels[record.rebateExecutionStatus]}</small></article><article className={record.expectedIncomeCents != null && record.expectedIncomeCents < 0 ? 'negative' : 'positive'}><span>预计净收入</span><b>{money(record.expectedIncomeCents)}</b><small>已扣返点、制作与投流</small></article></div>

    <div className="business-sections compact">
      <section className="business-section business-amount-section"><header><div><h3>订单与成本</h3></div></header>
        <div className="business-platform-picker"><span>下单平台</span><div>{platformOptions.length ? platformOptions.map((platform) => <button className={form.orderPlatform === platform ? 'selected' : ''} key={platform} onClick={() => patch('orderPlatform', platform)}>{platform}</button>) : <small>请先在概览设置发布平台</small>}</div></div>
        <div className="business-field-grid primary"><label>平台下单日期·可不填<input type="date" value={form.orderDate} onChange={(event) => patch('orderDate', event.currentTarget.value)} /></label><label>收益月份<input type="month" value={form.revenueMonth} onChange={(event) => patch('revenueMonth', event.currentTarget.value)} /></label><label className="business-emphasis-field">平台下单金额<input inputMode="decimal" value={form.platformOrderAmount} onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, platformOrderAmount: value, finalRebateAmount: inputMoney(calculatedRebateAmount(value, current.finalRebateRate)) || current.finalRebateAmount })) }} placeholder="0.00" /></label><label>制作成本<input inputMode="decimal" value={form.videoProductionCost} onChange={(event) => patch('videoProductionCost', event.currentTarget.value)} placeholder="0.00" /></label><label>投流金额<input inputMode="decimal" value={form.trafficPromotionCost} onChange={(event) => patch('trafficPromotionCost', event.currentTarget.value)} placeholder="0.00" /></label></div>
        <div className="business-payment-row"><span>回款</span><div className="business-choice-chips"><button className={form.paymentStatus === 'pending' ? 'selected' : ''} onClick={() => setForm((current) => ({ ...current, paymentStatus: 'pending', paymentReceivedDate: '' }))}>待回款</button><button className={form.paymentStatus === 'received' ? 'selected' : ''} onClick={() => setForm((current) => ({ ...current, paymentStatus: 'received', paymentReceivedDate: current.paymentReceivedDate || currentLocalDate() }))}>已回款</button></div>{form.paymentStatus === 'received' ? <input aria-label="回款日期" value={form.paymentReceivedDate} onChange={(event) => patch('paymentReceivedDate', event.currentTarget.value)} placeholder="YYYY-MM-DD" /> : null}</div>
        <details className="business-notes"><summary>备注{form.notes ? '·已填写' : ''}</summary><textarea value={form.notes} onChange={(event) => patch('notes', event.currentTarget.value)} placeholder="只记录需要回看的商务说明，不写账号或密码" /></details>
      </section>

      <section className="business-section business-compliance-section"><header><div><h3>返点、开票与凭证</h3></div><div className="business-status-pair"><span className={`business-status ${record.rebateExecutionStatus}`}>{executionLabels[record.rebateExecutionStatus]}</span><span className="business-status">{invoiceLabel}</span></div></header>
        <div className="business-requirement-row"><span>返点</span><div className="business-choice-chips"><button className={form.rebateRequirement === 'pending_confirmation' ? 'selected' : ''} onClick={() => patch('rebateRequirement', 'pending_confirmation')}>待确认</button><button className={form.rebateRequirement === 'not_required' ? 'selected' : ''} onClick={() => patch('rebateRequirement', 'not_required')}>无需返点</button><button className={rebateRequired ? 'selected' : ''} onClick={() => patch('rebateRequirement', 'required')}>需要返点</button></div></div>
        {rebateRequired ? <div className="business-rebate-fields">
          <div className="business-rebate-core"><div className="business-choice-chips rebate-mode"><button className={form.rebateInputMode === 'rate' ? 'selected' : ''} onClick={() => patch('rebateInputMode', 'rate')}>按比例</button><button className={form.rebateInputMode === 'amount' ? 'selected' : ''} onClick={() => patch('rebateInputMode', 'amount')}>按金额</button></div>{form.rebateInputMode === 'rate' ? <label>返点比例<input inputMode="decimal" value={form.finalRebateRate} onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, finalRebateRate: value, finalRebateAmount: inputMoney(calculatedRebateAmount(current.platformOrderAmount, value)) || current.finalRebateAmount })) }} placeholder="例如20" /><small>%</small></label> : <label>返点金额<input inputMode="decimal" value={form.finalRebateAmount} onChange={(event) => patch('finalRebateAmount', event.currentTarget.value)} placeholder="0.00" /></label>}<div className="business-calculated-field"><span>{form.rebateInputMode === 'rate' ? '自动计算返点金额' : '本次确定返点金额'}</span><b>{money(form.rebateInputMode === 'rate' ? derivedFromRate : safeParseMoney(form.finalRebateAmount))}</b></div></div>
          <div className="business-rebate-meta"><label>返点方式<AppSelect value={form.rebateRecipientType} onChange={(event) => patch('rebateRecipientType', event.currentTarget.value as BusinessRecordInput['rebateRecipientType'])}><option value="corporate">对公</option><option value="personal">对私</option><option value="unknown">待确认</option></AppSelect></label><label>返点对象<input value={form.rebateRecipientName} onChange={(event) => patch('rebateRecipientName', event.currentTarget.value)} placeholder="公司或收款对象" /></label><label>手续状态<AppSelect value={form.rebateProcedureStatus} onChange={(event) => patch('rebateProcedureStatus', event.currentTarget.value as BusinessRecordInput['rebateProcedureStatus'])}><option value="preparing">准备中</option><option value="incomplete">不齐</option><option value="complete">已齐</option><option value="not_required">无需手续</option></AppSelect></label></div>
        </div> : <div className="business-collapsed-hint"><Check size={13} />无需返点，不显示比例、对象、合同和支付凭证。</div>}
        <div className="business-invoice-row"><span>返点发票</span><div className="business-choice-chips"><button className={form.invoiceRequirement === 'pending_confirmation' ? 'selected' : ''} onClick={() => patch('invoiceRequirement', 'pending_confirmation')}>待确认</button><button className={form.invoiceRequirement === 'not_required' ? 'selected' : ''} onClick={() => patch('invoiceRequirement', 'not_required')}>无需返点发票</button><button className={invoiceRequired ? 'selected' : ''} onClick={() => patch('invoiceRequirement', 'required')}>需要对方开</button></div></div>
        <div className="business-file-actions compact">{rebateRequired ? <button onClick={() => chooseFile('rebate_contract')}><FileText size={13} />合同</button> : null}{invoiceRequired ? <button onClick={() => chooseFile('invoice_file')}><ReceiptText size={13} />返点发票</button> : null}{rebateRequired ? <button onClick={() => chooseFile('rebate_payment_proof', business.rebatePayment?.id ?? null)}><UploadCloud size={13} />返点凭证</button> : null}</div>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importFile(file); event.currentTarget.value = '' }} />

        {rebateRequired ? <details className="business-record-details"><summary><span>返点记录</span><em>{business.rebatePayment ? `${money(business.rebatePayment.amountCents)}·${business.rebatePayment.paidDate}` : '未记录'}</em><ChevronRight size={13} /></summary><div className="business-record-list"><header><span>{record.remainingRebateCents == null ? '' : `待返点${money(record.remainingRebateCents)}`}</span><button onClick={() => editPayment(business.rebatePayment ?? undefined)}>{business.rebatePayment ? '编辑' : <><Plus size={13} />记录</>}</button></header>{paymentEditor ? <div className="business-inline-editor"><input aria-label="返点金额" inputMode="decimal" value={paymentEditor.amount} onChange={(event) => setPaymentEditor({ ...paymentEditor, amount: event.currentTarget.value })} placeholder="金额" /><input aria-label="返点日期" value={paymentEditor.paidDate} onChange={(event) => setPaymentEditor({ ...paymentEditor, paidDate: event.currentTarget.value })} placeholder="YYYY-MM-DD" /><input aria-label="返点备注" value={paymentEditor.notes} onChange={(event) => setPaymentEditor({ ...paymentEditor, notes: event.currentTarget.value })} placeholder="备注·可选" /><button onClick={() => setPaymentEditor(null)}>取消</button><button className="primary-action" disabled={saving} onClick={() => void savePayment()}>保存</button></div> : null}{business.rebatePayment ? <article><div><b>{money(business.rebatePayment.amountCents)}</b><span>{business.rebatePayment.paidDate}</span></div><div><button onClick={() => chooseFile('rebate_payment_proof', business.rebatePayment?.id)}><UploadCloud size={13} />凭证</button><button onClick={() => editPayment(business.rebatePayment ?? undefined)}>编辑</button><button aria-label="删除返点记录" onClick={() => void removePayment(business.rebatePayment!.id)}><Trash2 size={13} /></button></div></article> : null}</div></details> : null}

        {invoiceRequired || business.invoices.length ? <details className="business-record-details"><summary><span>返点发票</span><em>{business.invoices.length ? `${business.invoices.length}条` : '未记录'}</em><ChevronRight size={13} /></summary><div className="business-record-list"><header><span>{invoiceLabel}</span><button onClick={() => editInvoice()}><Plus size={13} />新增</button></header>{invoiceEditor ? <div className="business-inline-editor invoice"><input aria-label="返点方" value={invoiceEditor.issuerName} onChange={(event) => setInvoiceEditor({ ...invoiceEditor, issuerName: event.currentTarget.value })} placeholder="返点方" /><input aria-label="返点发票金额" inputMode="decimal" value={invoiceEditor.amount} onChange={(event) => setInvoiceEditor({ ...invoiceEditor, amount: event.currentTarget.value })} placeholder="金额" /><input aria-label="开票日期" value={invoiceEditor.issuedDate} onChange={(event) => setInvoiceEditor({ ...invoiceEditor, issuedDate: event.currentTarget.value })} placeholder="YYYY-MM-DD" /><div className="business-inline-shared-projects"><span>同一张返点发票关联</span>{commercialProjects.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={invoiceEditor.linkedProjectIds.includes(candidate.id) || candidate.id === project.id} disabled={candidate.id === project.id} onChange={(event) => { const checked = event.currentTarget.checked; setInvoiceEditor((current) => current ? { ...current, linkedProjectIds: checked ? [...new Set([...current.linkedProjectIds, candidate.id])] : current.linkedProjectIds.filter((id) => id !== candidate.id) } : current) }} />{candidate.title}</label>)}</div><button onClick={() => setInvoiceEditor(null)}>取消</button><button className="primary-action" disabled={saving} onClick={() => void saveInvoice()}>保存</button></div> : null}{business.invoices.map((invoice) => <article key={invoice.id}><div><b>{invoice.issuerName || '返点方待填'}·{money(invoice.amountCents)}</b><span>已收返点发票{invoice.issuedDate ? `·${invoice.issuedDate}` : ''}{invoice.sharedProjectCount > 1 ? `·共用${invoice.sharedProjectCount}单` : ''}</span></div><div>{invoice.projectId === project.id ? <><button onClick={() => chooseFile('invoice_file', null, invoice.id)}><UploadCloud size={13} />图片</button><button onClick={() => editInvoice(invoice)}>编辑</button><button aria-label="删除返点发票" onClick={() => void removeInvoice(invoice.id)}><Trash2 size={13} /></button></> : <small>由所属台账管理</small>}</div></article>)}</div></details> : null}

        {business.files.length ? <div className="business-file-list compact">{business.files.map((file) => <article key={file.id}><span><FileText size={14} /></span><div><b>{file.fileName}</b><small>{fileLabels[file.role]}{file.sharedProjectCount > 1 ? `·共用${file.sharedProjectCount}单` : ''}</small></div>{file.projectId === project.id ? <button onClick={() => setSharedFileEditor({ fileId: file.id, projectIds: [...file.linkedProjectIds] })}><Link2 size={13} />关联</button> : null}<button onClick={() => void window.creatorOS?.revealBusinessFile(project.id, file.id)}><FolderOpen size={13} /></button>{file.projectId === project.id ? <button aria-label={`删除商务文件${file.fileName}`} onClick={() => void removeFile(file.id)}><Trash2 size={13} /></button> : null}</article>)}</div> : null}
        {sharedFileEditor && activeSharedFile ? <div className="business-share-editor" role="dialog" aria-label="关联共用商单"><header><div><b>关联共用商单</b><span>{activeSharedFile.fileName}</span></div><button aria-label="关闭共用商单选择" onClick={() => setSharedFileEditor(null)}><X size={14} /></button></header><div className="business-share-projects">{commercialProjects.map((candidate) => { const checked = sharedFileEditor.projectIds.includes(candidate.id) || candidate.id === activeSharedFile.projectId; return <label key={candidate.id}><input type="checkbox" checked={checked} disabled={candidate.id === activeSharedFile.projectId} onChange={(event) => { const nextChecked = event.currentTarget.checked; setSharedFileEditor((current) => current ? { ...current, projectIds: nextChecked ? [...new Set([...current.projectIds, candidate.id])] : current.projectIds.filter((id) => id !== candidate.id) } : current) }} /><span>{candidate.title}</span></label> })}</div><footer><button onClick={() => setSharedFileEditor(null)}>取消</button><button className="primary-action" disabled={saving} onClick={() => void saveSharedProjects()}>保存关联</button></footer></div> : null}
      </section>
    </div>
    {folderScan ? <div className="modal-backdrop"><section className="business-folder-scan-dialog" role="dialog" aria-modal="true" aria-label="商务资料扫描结果"><header><div><span>已扫描{folderScan.rootName}</span><h3>选择要导入的商务文件</h3></div><button aria-label="关闭扫描结果" onClick={() => setFolderScan(null)}><X size={14} /></button></header><div>{folderScan.candidates.length ? folderScan.candidates.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={folderScan.selectedIds.includes(candidate.id)} onChange={(event) => { const checked = event.currentTarget.checked; setFolderScan((current) => current ? { ...current, selectedIds: checked ? [...current.selectedIds, candidate.id] : current.selectedIds.filter((id) => id !== candidate.id) } : current) }} /><span><b>{candidate.fileName}</b><small>{fileLabels[candidate.suggestedRole]}·{candidate.relativePath}</small></span></label>) : <p>没有找到带有合同、发票、返点或转账关键词的文件。</p>}</div><footer><span>{folderScan.ignoredCount ? `${folderScan.ignoredCount}个无关或不支持的文件已跳过` : folderScan.warnings.join('；')}</span><button onClick={() => setFolderScan(null)}>取消</button><button className="primary-action" disabled={saving || !folderScan.selectedIds.length} onClick={() => void importFolderCandidates()}>导入{folderScan.selectedIds.length}个</button></footer></section></div> : null}
    <footer className="business-footer-note"><Check size={13} />截图会交给Codex识别；填入后仍由你确认保存。</footer>
  </section>
}
