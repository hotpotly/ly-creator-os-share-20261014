import { IncomeFieldPopover } from './IncomeFieldPopover'
import type { IncomeFieldTarget, BusinessIncomeField } from '../utils/income-fields'
import { AppSelect } from './AppSelect'
import { handleIncomeDialogKey, useIncomeDraft } from '../utils/useIncomeDraft'
import {
  ArrowDown,
  ArrowUp,
  CalendarRange,
  ChevronDown,
  ClipboardPaste,
  ExternalLink,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  FolderOpen,
  ImageUp,
  Link2,
  LockKeyhole,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BusinessAutofillResult,
  BusinessFileRole,
  BusinessFolderScanResult,
  BusinessInvoice,
  BusinessLedgerEntry,
  BusinessLedgerLockStatus,
  BusinessLifecycleStatus,
  BusinessPaymentStatus,
  BusinessProjectData,
  BusinessRecord,
  BusinessRecordInput,
  ProjectSummary
} from '../../../shared/domain'
import { parseBilibiliHuahuoRows } from '../../../shared/business-import'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import {
  BusinessLedger,
  type BusinessInvoiceFilter,
  type BusinessRebateFilter,
  type BusinessTimeRange
} from './BusinessLedger'

const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 })
const money = (cents: number | null): string => cents == null ? '—' : currency.format(cents / 100)
const moneyInput = (cents: number | null): string => cents == null ? '' : String(cents / 100)
const today = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const currentMonth = (): string => today().slice(0, 7)
const businessFileLabels: Record<BusinessFileRole, string> = {
  rebate_contract: '返点合同',
  invoice_file: '返点发票',
  rebate_payment_proof: '返点支付凭证',
  chat_screenshot: '聊天截图'
}
const lifecycleLabels: Record<BusinessLifecycleStatus, string> = {
  agreed_pending_order: '已谈妥·待下单',
  ordered: '已下单',
  settled: '已结清',
  canceled: '已取消'
}
const eventLabels = {
  created: '创建',
  updated: '修改',
  imported: '智能导入',
  project_linked: '关联项目',
  project_detached: '项目解绑',
  manual_settled: '手动结清',
  manual_settlement_canceled: '取消手动结清',
  trashed: '删除',
  restored: '恢复',
  invoice_saved: '返点发票',
  file_imported: '资料导入'
} as const

function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/[¥￥,\s元]/g, '')
  if (!normalized) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('金额格式无效')
  return Math.round(amount * 100)
}

function safeMoney(value: string): number | null {
  try { return parseMoney(value) } catch { return null }
}

interface StagedBusinessFile {
  id: string
  file: File
  role: BusinessFileRole
}

interface LedgerEditorForm {
  mode: 'standalone' | 'project'
  ledgerId: string | null
  projectId: string | null
  title: string
  lifecycleChoice: BusinessLifecycleStatus
  originalSettlementMode: BusinessRecord['settlementMode']
  manualSettled: boolean
  orderPlatform: string
  orderPlatformManuallySet: boolean
  orderDate: string
  revenueMonth: string
  quotedAmount: string
  platformOrderAmount: string
  paymentStatus: BusinessPaymentStatus
  paymentReceivedDate: string
  rebateRequirement: BusinessRecordInput['rebateRequirement']
  rebateInputMode: NonNullable<BusinessRecordInput['rebateInputMode']>
  finalRebateRate: string
  finalRebateAmount: string
  rebateRecipientName: string
  invoiceRequirement: BusinessRecordInput['invoiceRequirement']
  invoiceReceivedManually: boolean
  invoiceReceivedFromEvidence: boolean
  videoProductionCost: string
  trafficPromotionCost: string
  notes: string
  stagedFiles: StagedBusinessFile[]
}

interface InvoiceEditor {
  id: string | null
  issuerName: string
  amount: string
  issuedDate: string
  linkedProjectIds: string[]
  image: File | null
}

interface SmartImportRow {
  id: string
  selected: boolean
  title: string
  record: BusinessRecordInput
  targetProjectId: string
  duplicate: boolean
}

function roleForFile(file: File): BusinessFileRole {
  const name = file.name.toLowerCase()
  if (/(发票|invoice)/i.test(name)) return 'invoice_file'
  if (/(合同|协议|contract|agreement)/i.test(name)) return 'rebate_contract'
  if (/(返点|转账|支付|payment|transfer)/i.test(name)) return 'rebate_payment_proof'
  return 'chat_screenshot'
}

function editorFromEntry(entry?: BusinessLedgerEntry, mode: LedgerEditorForm['mode'] = 'standalone', project?: ProjectSummary, preserve?: Pick<LedgerEditorForm, 'orderPlatform' | 'revenueMonth'>, invoiceReceivedFromEvidence = false): LedgerEditorForm {
  const lifecycleChoice = entry?.lifecycleStatus ?? 'agreed_pending_order'
  return {
    mode,
    ledgerId: mode === 'standalone' ? entry?.projectId ?? null : null,
    projectId: mode === 'project' ? entry?.projectId ?? project?.id ?? null : null,
    title: entry?.projectTitle ?? project?.title ?? '',
    lifecycleChoice,
    originalSettlementMode: entry?.settlementMode ?? null,
    manualSettled: entry?.settlementMode === 'manual',
    orderPlatform: entry?.orderPlatform ?? project?.platformTargets[0] ?? preserve?.orderPlatform ?? '',
    orderPlatformManuallySet: entry?.orderPlatformManuallySet ?? mode === 'standalone',
    orderDate: entry?.orderDate ?? '',
    revenueMonth: entry?.revenueMonth ?? preserve?.revenueMonth ?? '',
    quotedAmount: moneyInput(entry?.quotedAmountCents ?? null),
    platformOrderAmount: moneyInput(entry?.platformOrderAmountCents ?? null),
    paymentStatus: entry?.paymentStatus ?? 'pending',
    paymentReceivedDate: entry?.paymentReceivedDate ?? '',
    rebateRequirement: entry?.rebateRequirement ?? 'pending_confirmation',
    rebateInputMode: entry?.rebateInputMode ?? 'rate',
    finalRebateRate: entry?.finalRebateRatePercent == null ? '' : String(entry.finalRebateRatePercent),
    finalRebateAmount: moneyInput(entry?.finalRebateAmountCents ?? null),
    rebateRecipientName: entry?.rebateRecipientName ?? '',
    invoiceRequirement: entry?.invoiceRequirement ?? 'pending_confirmation',
    invoiceReceivedManually: Boolean(entry?.invoiceReceivedManuallyAt),
    invoiceReceivedFromEvidence,
    videoProductionCost: moneyInput(entry?.videoProductionCostCents ?? 0),
    trafficPromotionCost: moneyInput(entry?.trafficPromotionCostCents ?? 0),
    notes: entry?.notes ?? '',
    stagedFiles: []
  }
}

function recordInput(form: LedgerEditorForm): BusinessRecordInput {
  const orderAmount = parseMoney(form.platformOrderAmount)
  const rate = form.finalRebateRate.trim() ? Number(form.finalRebateRate) : null
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error('返点比例必须在0%到100%之间')
  const manualSettled = form.lifecycleChoice === 'settled'
    ? form.originalSettlementMode === 'automatic' ? false : true
    : false
  const rebateRequirement = form.rebateRequirement
  return {
    dealStatus: form.lifecycleChoice === 'canceled' ? 'canceled' : form.lifecycleChoice === 'agreed_pending_order' ? 'agreed_pending_order' : 'ordered',
    manualSettled,
    orderPlatform: form.orderPlatform,
    orderPlatformManuallySet: form.orderPlatformManuallySet,
    orderDate: form.orderDate || null,
    revenueMonth: form.revenueMonth || null,
    quotedAmountCents: parseMoney(form.quotedAmount),
    platformOrderAmountCents: orderAmount,
    rebateInputMode: form.rebateInputMode,
    finalRebateRatePercent: rebateRequirement === 'required' && form.rebateInputMode === 'rate' ? rate : null,
    finalRebateAmountCents: rebateRequirement === 'required'
      ? form.rebateInputMode === 'amount'
        ? parseMoney(form.finalRebateAmount)
        : rate !== null && orderAmount !== null ? Math.round(orderAmount * rate / 100) : null
      : null,
    rebateRequirement,
    rebateRecipientType: 'corporate',
    rebateRecipientName: form.rebateRecipientName,
    rebateProcedureStatus: rebateRequirement === 'not_required' ? 'not_required' : 'preparing',
    plannedRebateDate: null,
    paymentStatus: form.paymentStatus,
    paymentReceivedDate: form.paymentStatus === 'received' ? form.paymentReceivedDate || null : null,
    invoiceRequirement: form.invoiceRequirement,
    invoiceReceivedManually: form.invoiceReceivedManually,
    videoProductionCostCents: parseMoney(form.videoProductionCost) ?? 0,
    trafficPromotionCostCents: parseMoney(form.trafficPromotionCost) ?? 0,
    incomeAttributionDate: null,
    notes: form.notes
  }
}

function hasInvoiceEvidence(data: Pick<BusinessProjectData, 'invoices' | 'files'>): boolean {
  if (data.files.some((file) => file.role === 'invoice_file')) return true
  const activeInvoices = data.invoices.filter((invoice) => invoice.status !== 'voided' && invoice.status !== 'red_flushed')
  return activeInvoices.length > 0 && activeInvoices.every((invoice) => invoice.status === 'issued')
}

function inputFromRecord(record: BusinessRecord, patch: Partial<BusinessRecordInput> = {}): BusinessRecordInput {
  return {
    dealStatus: record.dealStatus,
    manualSettled: record.settlementMode === 'manual',
    orderPlatform: record.orderPlatform,
    orderPlatformManuallySet: record.orderPlatformManuallySet,
    orderDate: record.orderDate,
    revenueMonth: record.revenueMonth,
    quotedAmountCents: record.quotedAmountCents,
    platformOrderAmountCents: record.platformOrderAmountCents,
    rebateInputMode: record.rebateInputMode,
    finalRebateRatePercent: record.finalRebateRatePercent,
    finalRebateAmountCents: record.finalRebateAmountCents,
    rebateRequirement: record.rebateRequirement,
    rebateRecipientType: record.rebateRecipientType,
    rebateRecipientName: record.rebateRecipientName,
    rebateProcedureStatus: record.rebateProcedureStatus,
    plannedRebateDate: record.plannedRebateDate,
    paymentStatus: record.paymentStatus,
    paymentReceivedDate: record.paymentReceivedDate,
    invoiceRequirement: record.invoiceRequirement,
    videoProductionCostCents: record.videoProductionCostCents,
    trafficPromotionCostCents: record.trafficPromotionCostCents,
    incomeAttributionDate: record.incomeAttributionDate,
    notes: record.notes,
    ...patch
  }
}

function entryHasBusinessFacts(entry: BusinessLedgerEntry): boolean {
  return entry.dealStatus !== 'agreed_pending_order'
    || Boolean(entry.manualSettledAt || entry.orderDate || entry.revenueMonth || entry.quotedAmountCents || entry.platformOrderAmountCents
      || entry.finalRebateRatePercent || entry.finalRebateAmountCents || entry.rebateRecipientName || entry.paymentReceivedDate
      || entry.videoProductionCostCents || entry.trafficPromotionCostCents || entry.notes || entry.businessFileCount || entry.invoiceIssuedCents)
    || entry.rebateRequirement !== 'pending_confirmation'
    || entry.invoiceRequirement !== 'pending_confirmation'
    || entry.paymentStatus !== 'pending'
}

export function BusinessLedgerPage({ highlightedProjectId }: { highlightedProjectId?: string }): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const entries = snapshot.businessLedger
  const projects = snapshot.projects
  const preferences = snapshot.preferences
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)

  const [query, setQuery] = useState('')
  const [timeRange, setTimeRange] = useState<BusinessTimeRange>('year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [platform, setPlatform] = useState('')
  const [lifecycleStatus, setLifecycleStatus] = useState<'' | BusinessLifecycleStatus>('')
  const [paymentStatus, setPaymentStatus] = useState<'' | BusinessPaymentStatus>('')
  const [rebateStatus, setRebateStatus] = useState<BusinessRebateFilter>('')
  const [invoiceStatus, setInvoiceStatus] = useState<BusinessInvoiceFilter>('')

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(highlightedProjectId ?? null)
  const [selectedData, setSelectedData] = useState<BusinessProjectData | null>(null)
  const initialEntry = entries.find((entry) => entry.projectId === highlightedProjectId)
  const { editor, setEditor, openEditor, dirty, requestLeave, guard } = useIncomeDraft<LedgerEditorForm>(initialEntry ? editorFromEntry(initialEntry, initialEntry.ledgerOnly ? 'standalone' : 'project', undefined, undefined, initialEntry.invoiceExecutionStatus === 'issued' && !initialEntry.invoiceReceivedManuallyAt) : null)
  const loadedEditorId = useRef<string | null>(initialEntry?.projectId ?? null)
  const requestedDetailId = useRef<string | null>(highlightedProjectId ?? null)
  const [fieldTarget, setFieldTarget] = useState<IncomeFieldTarget | null>(null)
  const [detailError, setDetailError] = useState('')
  const [smartText, setSmartText] = useState('')
  const [smartOpen, setSmartOpen] = useState(false)
  const [autofillSummary, setAutofillSummary] = useState<{ fields: string[]; warnings: string[] } | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [associateProjects, setAssociateProjects] = useState<ProjectSummary[]>([])
  const [invoiceEditor, setInvoiceEditor] = useState<InvoiceEditor | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashedEntries, setTrashedEntries] = useState<BusinessLedgerEntry[]>([])
  const [pendingTrashId, setPendingTrashId] = useState<string | null>(null)
  const [pendingPermanentDeleteId, setPendingPermanentDeleteId] = useState<string | null>(null)
  const [relinkSourceId, setRelinkSourceId] = useState<string | null>(null)
  const [relinkTargetId, setRelinkTargetId] = useState('')
  const [folderScan, setFolderScan] = useState<(BusinessFolderScanResult & { selectedIds: string[] }) | null>(null)
  const [scanningFolder, setScanningFolder] = useState(false)
  const [platformManagerOpen, setPlatformManagerOpen] = useState(false)
  const [newPlatform, setNewPlatform] = useState('')

  const [importOpen, setImportOpen] = useState(false)
  const [importSource, setImportSource] = useState('')
  const [importRows, setImportRows] = useState<SmartImportRow[]>([])
  const [importMonth, setImportMonth] = useState(currentMonth())
  const [importLink, setImportLink] = useState('')
  const [importing, setImporting] = useState(false)

  const [lockStatus, setLockStatus] = useState<BusinessLedgerLockStatus | null>(null)
  const [lockPassword, setLockPassword] = useState('')
  const [lockError, setLockError] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  const editorFilesRef = useRef<HTMLInputElement>(null)
  const editorScreenshotRef = useRef<HTMLInputElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)
  const importScreenshotRef = useRef<HTMLInputElement>(null)
  const invoiceImageRef = useRef<HTMLInputElement>(null)
  const lockPasswordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void window.creatorOS?.getBusinessLedgerLockStatus()
      .then(async (status) => {
        if (!active) return
        setLockStatus(status)
        if (!status.enabled || status.unlocked || !status.touchIdAvailable || !window.creatorOS) return
        setUnlocking(true)
        try {
          const unlocked = await window.creatorOS.unlockBusinessLedgerWithTouchId()
          if (active) setLockStatus(unlocked)
        } catch {
          if (active) {
            setLockError('系统验证未完成，可输入收入台账密码，或重新验证。')
            window.requestAnimationFrame(() => lockPasswordRef.current?.focus())
          }
        } finally {
          if (active) setUnlocking(false)
        }
      })
      .catch((reason: unknown) => { if (active) setLockError(reason instanceof Error ? reason.message : '无法读取隐私锁状态') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedProjectId || !window.creatorOS) return
    let active = true
    const entry = entries.find((item) => item.projectId === selectedProjectId)
    if (!entry) return
    void window.creatorOS.getBusinessProjectData(selectedProjectId)
      .then((data) => {
        if (!active || requestedDetailId.current !== selectedProjectId) return
        setSelectedData(data)
        setDetailError('')
        if (loadedEditorId.current !== selectedProjectId) {
          loadedEditorId.current = selectedProjectId
          openEditor(editorFromEntry({ ...entry, ...data.record }, entry.ledgerOnly ? 'standalone' : 'project', undefined, undefined, hasInvoiceEvidence(data)))
        } else {
          setEditor((current) => current ? { ...current, invoiceReceivedFromEvidence: hasInvoiceEvidence(data) } : current)
        }
      })
      .catch((reason: unknown) => { if (active && requestedDetailId.current === selectedProjectId) setDetailError(reason instanceof Error ? reason.message : '收入详情加载失败，请关闭后重试') })
    return () => { active = false }
  }, [entries, selectedProjectId, openEditor, setEditor])

  const closeEditor = (): void => {
    requestedDetailId.current = null
    openEditor(null)
    loadedEditorId.current = null
    setSelectedProjectId(null)
    setSelectedData(null)
    setError('')
  }
  const requestCloseEditor = (): void => {
    if (!saving && !recognizing && !scanningFolder) requestLeave(closeEditor)
  }

  const selected = entries.find((entry) => entry.projectId === selectedProjectId) ?? null
  const businessPlatforms = useMemo(() => [...new Set([...preferences.businessPlatforms, ...entries.map((entry) => entry.orderPlatform).filter(Boolean)])], [entries, preferences.businessPlatforms])
  const eligibleProjects = useMemo(() => associateProjects.length
    ? associateProjects
    : projects.filter((project) => {
      if (!project.isCommercial || project.trashedAt) return false
      const active = entries.find((entry) => entry.projectId === project.id)
      return !active || !entryHasBusinessFacts(active)
    }), [associateProjects, entries, projects])

  const patchEditor = <K extends keyof LedgerEditorForm>(key: K, value: LedgerEditorForm[K]): void => {
    setEditor((current) => current ? { ...current, [key]: value } : current)
    setError('')
  }

  const setInvoiceRequirement = (value: BusinessRecordInput['invoiceRequirement']): void => {
    setEditor((current) => current ? {
      ...current,
      invoiceRequirement: value,
      invoiceReceivedManually: value === 'required' ? current.invoiceReceivedManually : false
    } : current)
    setError('')
  }

  const derivedEditor = useMemo(() => {
    if (!editor) return { rebate: null, expected: null }
    const order = safeMoney(editor.platformOrderAmount)
    const production = safeMoney(editor.videoProductionCost) ?? 0
    const traffic = safeMoney(editor.trafficPromotionCost) ?? 0
    const rate = editor.finalRebateRate.trim() ? Number(editor.finalRebateRate) : null
    const rebate = editor.rebateRequirement === 'not_required'
      ? 0
      : editor.rebateRequirement === 'required'
        ? editor.rebateInputMode === 'amount'
          ? safeMoney(editor.finalRebateAmount)
          : order != null && rate !== null && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? Math.round(order * rate / 100) : null
        : null
    return { rebate, expected: order != null && rebate != null ? order - rebate - production - traffic : null }
  }, [editor])

  const openDirectEditor = (): void => {
    setNewMenuOpen(false)
    openEditor(editorFromEntry())
    setSmartText('')
    setSmartOpen(false)
    setAutofillSummary(null)
    setError('')
  }

  useEffect(() => {
    const open = (): void => openDirectEditor()
    window.addEventListener('creator-os:open-business-income-editor', open)
    return () => window.removeEventListener('creator-os:open-business-income-editor', open)
  })

  const openAssociateEditor = async (): Promise<void> => {
    setNewMenuOpen(false)
    if (!window.creatorOS) return
    const trashed = await window.creatorOS.listTrashedBusinessLedgerEntries()
    setTrashedEntries(trashed)
    const candidates = projects.filter((project) => {
      if (!project.isCommercial || project.trashedAt) return false
      const active = entries.find((entry) => entry.projectId === project.id)
      return !active || !entryHasBusinessFacts(active) || trashed.some((entry) => entry.projectId === project.id)
    })
    setAssociateProjects(candidates)
    openEditor(editorFromEntry(undefined, 'project'))
    setSmartText('')
    setSmartOpen(false)
    setAutofillSummary(null)
    setError('')
  }

  const selectAssociateProject = async (projectId: string): Promise<void> => {
    if (!window.creatorOS) return
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    try {
      const data = await window.creatorOS.getBusinessProjectData(projectId)
      const trashed = trashedEntries.find((entry) => entry.projectId === projectId)
      const entry = trashed ?? entries.find((item) => item.projectId === projectId)
      openEditor(editorFromEntry(entry ? { ...entry, ...data.record } : undefined, 'project', project, undefined, hasInvoiceEvidence(data)))
    } catch {
      openEditor(editorFromEntry(undefined, 'project', project))
    }
  }

  const openField = (projectId: string, field: BusinessIncomeField, anchor: HTMLElement): void => {
    const record = entries.find((entry) => entry.projectId === projectId)
    if (record) setFieldTarget({ kind: 'business', record, field, anchor })
  }

  const editEntry = (projectId: string): void => {
    const entry = entries.find((item) => item.projectId === projectId)
    if (!entry) return
    setFieldTarget(null)
    requestedDetailId.current = projectId
    loadedEditorId.current = projectId
    // Paint the final editor immediately; only supplementary data is loaded asynchronously.
    openEditor(editorFromEntry(entry, entry.ledgerOnly ? 'standalone' : 'project', undefined, undefined, entry.invoiceExecutionStatus === 'issued' && !entry.invoiceReceivedManuallyAt))
    setSelectedData(null)
    setSelectedProjectId(projectId)
    setDetailError('')
    setAutofillSummary(null)
    setSmartText('')
    setSmartOpen(false)
    setError('')
  }

  const saveEditor = async (continueAdding: boolean): Promise<void> => {
    if (!window.creatorOS || !editor || saving) return
    setSaving(true)
    setError('')
    try {
      const input = recordInput(editor)
      if (selectedData && selected) {
        input.rebateRecipientType = selectedData.record.rebateRecipientType
        input.rebateProcedureStatus = input.rebateRequirement === 'not_required' ? 'not_required' : selectedData.record.rebateRequirement === input.rebateRequirement ? selectedData.record.rebateProcedureStatus : 'preparing'
        input.plannedRebateDate = selectedData.record.plannedRebateDate
        input.incomeAttributionDate = selectedData.record.incomeAttributionDate
      }
      let saved: BusinessLedgerEntry | null = null
      if (editor.mode === 'standalone') {
        saved = await window.creatorOS.saveStandaloneBusinessLedgerEntry(editor.ledgerId, editor.title, input)
      } else {
        if (!editor.projectId) throw new Error('请选择要关联的项目')
        await window.creatorOS.saveBusinessRecord(editor.projectId, input)
        await refreshWorkspace()
        saved = useWorkspaceStore.getState().snapshot.businessLedger.find((entry) => entry.projectId === editor.projectId) ?? null
      }
      const projectId = saved?.projectId ?? editor.projectId
      if (!projectId) throw new Error('商单收入保存失败')
      // If attachment import fails, retries update this record instead of creating another one.
      if (editor.mode === 'standalone') setEditor((current) => current ? { ...current, ledgerId: projectId } : current)
      for (const staged of editor.stagedFiles) {
        await window.creatorOS.importBusinessFile(projectId, staged.role, staged.file.name, new Uint8Array(await staged.file.arrayBuffer()))
        setEditor((current) => current ? { ...current, stagedFiles: current.stagedFiles.filter((item) => item.id !== staged.id) } : current)
      }
      await refreshWorkspace()
      setAutofillSummary(null)
      setSmartText('')
      setSmartOpen(false)
      if (continueAdding && !editor.ledgerId && editor.mode === 'standalone') {
        openEditor(editorFromEntry(undefined, 'standalone', undefined, { orderPlatform: editor.orderPlatform, revenueMonth: editor.revenueMonth }))
      } else {
        closeEditor()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '商单收入保存失败')
    } finally {
      setSaving(false)
    }
  }

  const applyAutofill = (result: BusinessAutofillResult): void => {
    setEditor((current) => current ? {
      ...current,
      title: result.title ?? current.title,
      lifecycleChoice: result.dealStatus ?? current.lifecycleChoice,
      orderPlatform: result.orderPlatform ?? current.orderPlatform,
      orderPlatformManuallySet: result.orderPlatform ? true : current.orderPlatformManuallySet,
      orderDate: result.orderDate ?? current.orderDate,
      revenueMonth: result.revenueMonth ?? result.orderDate?.slice(0, 7) ?? current.revenueMonth,
      quotedAmount: result.quotedAmountCents == null ? current.quotedAmount : moneyInput(result.quotedAmountCents),
      platformOrderAmount: result.platformOrderAmountCents == null ? current.platformOrderAmount : moneyInput(result.platformOrderAmountCents),
      finalRebateRate: result.finalRebateRatePercent == null ? current.finalRebateRate : String(result.finalRebateRatePercent),
      finalRebateAmount: result.finalRebateAmountCents == null ? current.finalRebateAmount : moneyInput(result.finalRebateAmountCents),
      rebateInputMode: result.finalRebateAmountCents != null && result.finalRebateRatePercent == null ? 'amount' : current.rebateInputMode,
      rebateRequirement: result.rebateRequirement ?? current.rebateRequirement,
      rebateRecipientName: result.rebateRecipientName ?? current.rebateRecipientName,
      paymentStatus: result.paymentStatus ?? current.paymentStatus,
      paymentReceivedDate: result.paymentReceivedDate ?? current.paymentReceivedDate,
      invoiceRequirement: result.invoiceRequirement ?? current.invoiceRequirement,
      videoProductionCost: result.videoProductionCostCents == null ? current.videoProductionCost : moneyInput(result.videoProductionCostCents),
      trafficPromotionCost: result.trafficPromotionCostCents == null ? current.trafficPromotionCost : moneyInput(result.trafficPromotionCostCents),
      notes: result.notes ?? current.notes
    } : current)
    setAutofillSummary({ fields: result.recognizedFields, warnings: result.warnings })
  }

  const recognizeEditorText = async (): Promise<void> => {
    if (!window.creatorOS || !editor || !smartText.trim() || recognizing) return
    setRecognizing(true)
    setError('')
    try { applyAutofill(await window.creatorOS.extractBusinessText(editor.projectId, smartText)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '文字识别失败，原文已保留，可手动填写') }
    finally { setRecognizing(false) }
  }

  const recognizeEditorScreenshot = async (files: FileList | File[]): Promise<void> => {
    if (!window.creatorOS || !editor || recognizing) return
    const file = Array.from(files)[0]
    if (!file) return
    setRecognizing(true)
    setError('')
    try {
      applyAutofill(await window.creatorOS.extractBusinessScreenshot(editor.projectId, file.name, new Uint8Array(await file.arrayBuffer())))
      setEditor((current) => current ? { ...current, stagedFiles: [...current.stagedFiles, { id: crypto.randomUUID(), file, role: 'chat_screenshot' }] } : current)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '截图识别失败，图片已保留，可手动填写') }
    finally { setRecognizing(false) }
  }

  const addEditorFiles = (files: FileList | File[]): void => {
    const staged = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, role: roleForFile(file) }))
    setEditor((current) => current ? { ...current, stagedFiles: [...current.stagedFiles, ...staged] } : current)
  }

  const unlockWithPassword = async (): Promise<void> => {
    if (!window.creatorOS || unlocking) return
    setUnlocking(true)
    setLockError('')
    try {
      setLockStatus(await window.creatorOS.unlockBusinessLedgerWithPassword(lockPassword))
      setLockPassword('')
    } catch (reason) { setLockError(reason instanceof Error ? reason.message : '解锁失败') }
    finally { setUnlocking(false) }
  }

  const unlockWithTouchId = async (): Promise<void> => {
    if (!window.creatorOS || unlocking) return
    setUnlocking(true)
    setLockError('')
    try { setLockStatus(await window.creatorOS.unlockBusinessLedgerWithTouchId()) }
    catch (reason) { setLockError(reason instanceof Error ? reason.message : 'Touch ID解锁失败') }
    finally { setUnlocking(false) }
  }

  const lockNow = async (): Promise<void> => {
    if (!window.creatorOS) return
    setLockStatus(await window.creatorOS.lockBusinessLedger())
    setSelectedProjectId(null)
  }

  const openTrash = async (): Promise<void> => {
    if (!window.creatorOS) return
    setTrashedEntries(await window.creatorOS.listTrashedBusinessLedgerEntries())
    setTrashOpen(true)
  }

  const trashEntry = async (projectId: string): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.trashBusinessLedgerEntry(projectId)
    setPendingTrashId(null)
    closeEditor()
    await refreshWorkspace()
  }

  const restoreEntry = async (projectId: string): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.restoreBusinessLedgerEntry(projectId)
    setTrashedEntries(await window.creatorOS.listTrashedBusinessLedgerEntries())
    await refreshWorkspace()
  }

  const permanentlyDeleteEntry = async (projectId: string): Promise<void> => {
    if (!window.creatorOS || saving) return
    setSaving(true)
    setError('')
    try {
      await window.creatorOS.permanentlyDeleteBusinessLedgerEntry(projectId)
      setPendingPermanentDeleteId(null)
      setTrashedEntries(await window.creatorOS.listTrashedBusinessLedgerEntries())
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '永久删除商单收入失败') }
    finally { setSaving(false) }
  }

  const openRelink = (projectId: string): void => {
    requestLeave(() => {
      closeEditor()
      setRelinkSourceId(projectId)
      setRelinkTargetId('')
      setError('')
    })
  }

  const relinkEntry = async (): Promise<void> => {
    if (!window.creatorOS || !relinkSourceId || !relinkTargetId || saving) return
    setSaving(true)
    setError('')
    try {
      const entry = await window.creatorOS.relinkBusinessLedgerEntry(relinkSourceId, relinkTargetId)
      setRelinkSourceId(null)
      setRelinkTargetId('')
      await refreshWorkspace()
      editEntry(entry.projectId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '关联商单项目失败') }
    finally { setSaving(false) }
  }

  const toggleSettled = async (projectId: string, settled: boolean): Promise<void> => {
    if (!window.creatorOS) return
    const data = await window.creatorOS.getBusinessProjectData(projectId)
    await window.creatorOS.saveBusinessRecord(projectId, inputFromRecord(data.record, { dealStatus: 'ordered', manualSettled: settled }))
    await refreshWorkspace()
  }

  const editInvoice = (invoice?: BusinessInvoice): void => {
    if (!selected) return
    setInvoiceEditor(invoice ? {
      id: invoice.id,
      issuerName: invoice.issuerName,
      amount: moneyInput(invoice.amountCents),
      issuedDate: invoice.issuedDate ?? '',
      linkedProjectIds: [...invoice.linkedProjectIds],
      image: null
    } : {
      id: null,
      issuerName: editor?.rebateRecipientName ?? selected.rebateRecipientName,
      amount: moneyInput(editor ? derivedEditor.rebate : selected.effectiveFinalRebateAmountCents),
      issuedDate: '',
      linkedProjectIds: [selected.projectId],
      image: null
    })
  }

  const saveInvoice = async (): Promise<void> => {
    if (!window.creatorOS || !selected || !invoiceEditor || saving) return
    setSaving(true)
    setError('')
    try {
      const previousInvoiceIds = new Set(selectedData?.invoices.map((invoice) => invoice.id) ?? [])
      const data = await window.creatorOS.saveBusinessInvoice(selected.projectId, invoiceEditor.id, {
        issuerName: invoiceEditor.issuerName,
        amountCents: parseMoney(invoiceEditor.amount) ?? 0,
        issuedDate: invoiceEditor.issuedDate || null,
        status: 'issued',
        deliveredToClient: false,
        notes: '',
        linkedProjectIds: invoiceEditor.linkedProjectIds
      })
      const savedInvoice = invoiceEditor.id
        ? data.invoices.find((invoice) => invoice.id === invoiceEditor.id)
        : data.invoices.find((invoice) => !previousInvoiceIds.has(invoice.id))
      if (invoiceEditor.image && savedInvoice) {
        await window.creatorOS.importBusinessFile(selected.projectId, 'invoice_file', invoiceEditor.image.name, new Uint8Array(await invoiceEditor.image.arrayBuffer()), {
          invoiceId: savedInvoice.id,
          linkedProjectIds: invoiceEditor.linkedProjectIds
        })
      }
      setInvoiceEditor(null)
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '返点发票保存失败') }
    finally { setSaving(false) }
  }

  const scanFolder = async (): Promise<void> => {
    if (!window.creatorOS || scanningFolder || !selected) return
    setScanningFolder(true)
    setError('')
    try {
      const result = await window.creatorOS.scanBusinessFolder()
      if (!result.canceled) setFolderScan({ ...result, selectedIds: result.candidates.map((candidate) => candidate.id) })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '商务资料文件夹扫描失败') }
    finally { setScanningFolder(false) }
  }

  const importFolder = async (): Promise<void> => {
    if (!window.creatorOS || !selected || !folderScan?.scanId || !folderScan.selectedIds.length) return
    setSaving(true)
    try {
      await window.creatorOS.importBusinessFolderCandidates(selected.projectId, folderScan.scanId, folderScan.selectedIds)
      setFolderScan(null)
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '商务资料导入失败') }
    finally { setSaving(false) }
  }

  const importRowsFromRecords = (items: Array<{ title: string; record: BusinessRecordInput }>): void => {
    setImportRows(items.map((item) => {
      const duplicate = entries.find((entry) => {
        const orderId = item.record.notes.match(/订单号：([^；]+)/)?.[1]
        const existingOrderId = entry.notes.match(/订单号：([^；]+)/)?.[1]
        if (orderId && existingOrderId) return item.record.orderPlatform === entry.orderPlatform && orderId === existingOrderId
        return item.title === entry.projectTitle
          && item.record.orderPlatform === entry.orderPlatform
          && item.record.platformOrderAmountCents === entry.platformOrderAmountCents
          && item.record.revenueMonth === entry.revenueMonth
      })
      const exactProject = projects.find((project) => project.isCommercial && project.title === item.title && !project.trashedAt)
      return {
        id: crypto.randomUUID(),
        selected: true,
        title: item.title,
        record: item.record,
        targetProjectId: duplicate?.projectId ?? exactProject?.id ?? '',
        duplicate: Boolean(duplicate)
      }
    }))
  }

  const buildImportPreview = async (sourceOverride?: string): Promise<void> => {
    const source = sourceOverride ?? importSource
    const parsed = parseBilibiliHuahuoRows(source, {
      revenueMonth: importMonth || null,
      rebateRequirement: 'pending_confirmation',
      invoiceRequirement: 'pending_confirmation'
    })
    if (parsed.items.length) {
      importRowsFromRecords(parsed.items)
      setError(parsed.errors.join('；'))
      return
    }
    if (!window.creatorOS || !source.trim()) {
      setError(parsed.errors.join('；'))
      return
    }
    setRecognizing(true)
    try {
      const result = await window.creatorOS.extractBusinessText(null, source)
      importRowsFromRecords([{
        title: result.title || '待命名商单',
        record: {
          dealStatus: result.dealStatus ?? 'agreed_pending_order',
          manualSettled: false,
          orderPlatform: result.orderPlatform ?? '',
          orderPlatformManuallySet: true,
          orderDate: result.orderDate,
          revenueMonth: result.revenueMonth ?? result.orderDate?.slice(0, 7) ?? (importMonth || null),
          quotedAmountCents: result.quotedAmountCents,
          platformOrderAmountCents: result.platformOrderAmountCents,
          rebateInputMode: result.finalRebateAmountCents != null && result.finalRebateRatePercent == null ? 'amount' : 'rate',
          finalRebateRatePercent: result.finalRebateRatePercent,
          finalRebateAmountCents: result.finalRebateAmountCents,
          rebateRequirement: result.rebateRequirement ?? 'pending_confirmation',
          rebateRecipientType: result.rebateRecipientType ?? 'unknown',
          rebateRecipientName: result.rebateRecipientName ?? '',
          rebateProcedureStatus: 'preparing',
          plannedRebateDate: null,
          paymentStatus: result.paymentStatus ?? 'pending',
          paymentReceivedDate: result.paymentReceivedDate,
          invoiceRequirement: result.invoiceRequirement ?? 'pending_confirmation',
          videoProductionCostCents: result.videoProductionCostCents ?? 0,
          trafficPromotionCostCents: result.trafficPromotionCostCents ?? 0,
          incomeAttributionDate: null,
          notes: result.notes ?? ''
        }
      }])
      setError(result.warnings.join('；'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '智能导入识别失败') }
    finally { setRecognizing(false) }
  }

  const openImportLink = async (): Promise<void> => {
    if (!window.creatorOS || !importLink.trim()) return
    setError('')
    try { await window.creatorOS.openBusinessImportLink(importLink.trim()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '账单页面打开失败') }
  }

  const captureImportLink = async (): Promise<void> => {
    if (!window.creatorOS || recognizing) return
    setRecognizing(true)
    setError('')
    try {
      const captured = await window.creatorOS.captureBusinessImportLink()
      const source = `${captured.text}\n来源链接：${captured.url}`
      setImportLink(captured.url)
      setImportSource(source)
      await buildImportPreview(source)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '账单页面读取失败') }
    finally { setRecognizing(false) }
  }

  const recognizeImportScreenshots = async (files: FileList | File[]): Promise<void> => {
    if (!window.creatorOS || recognizing) return
    setRecognizing(true)
    setError('')
    try {
      const items: Array<{ title: string; record: BusinessRecordInput }> = []
      for (const file of Array.from(files)) {
        const result = await window.creatorOS.extractBusinessScreenshot(null, file.name, new Uint8Array(await file.arrayBuffer()))
        items.push({
          title: result.title || file.name.replace(/\.[^.]+$/, '').slice(0, 80),
          record: {
            dealStatus: result.dealStatus ?? 'ordered',
            manualSettled: false,
            orderPlatform: result.orderPlatform ?? '',
            orderPlatformManuallySet: true,
            orderDate: result.orderDate,
            revenueMonth: result.revenueMonth ?? result.orderDate?.slice(0, 7) ?? (importMonth || null),
            quotedAmountCents: result.quotedAmountCents,
            platformOrderAmountCents: result.platformOrderAmountCents,
            rebateInputMode: result.finalRebateAmountCents != null && result.finalRebateRatePercent == null ? 'amount' : 'rate',
            finalRebateRatePercent: result.finalRebateRatePercent,
            finalRebateAmountCents: result.finalRebateAmountCents,
            rebateRequirement: result.rebateRequirement ?? 'pending_confirmation',
            rebateRecipientType: result.rebateRecipientType ?? 'unknown',
            rebateRecipientName: result.rebateRecipientName ?? '',
            rebateProcedureStatus: 'preparing',
            plannedRebateDate: null,
            paymentStatus: result.paymentStatus ?? 'pending',
            paymentReceivedDate: result.paymentReceivedDate,
            invoiceRequirement: result.invoiceRequirement ?? 'pending_confirmation',
            videoProductionCostCents: result.videoProductionCostCents ?? 0,
            trafficPromotionCostCents: result.trafficPromotionCostCents ?? 0,
            incomeAttributionDate: null,
            notes: result.notes ?? `来源截图：${file.name}`
          }
        })
      }
      importRowsFromRecords(items)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '截图识别失败') }
    finally { setRecognizing(false) }
  }

  const saveImportRows = async (): Promise<void> => {
    if (!window.creatorOS || importing) return
    const rows = importRows.filter((row) => row.selected)
    if (!rows.length) return
    setImporting(true)
    setError('')
    try {
      for (const row of rows) {
        if (row.targetProjectId) await window.creatorOS.saveBusinessRecord(row.targetProjectId, row.record)
        else await window.creatorOS.saveStandaloneBusinessLedgerEntry(null, row.title, row.record)
      }
      await refreshWorkspace()
      setImportOpen(false)
      setImportRows([])
      setImportSource('')
      setImportLink('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '智能导入失败') }
    finally { setImporting(false) }
  }

  const clearFilters = (): void => {
    setTimeRange('year')
    setCustomStart('')
    setCustomEnd('')
    setPlatform('')
    setLifecycleStatus('')
    setPaymentStatus('')
    setRebateStatus('')
    setInvoiceStatus('')
    setQuery('')
  }

  const saveBusinessPlatforms = (next: string[]): void => {
    void setPreferences({ businessPlatforms: [...new Set(next.map((item) => item.trim()).filter(Boolean))] })
  }

  const renameBusinessPlatform = (index: number, value: string): void => {
    const next = [...preferences.businessPlatforms]
    next[index] = value
    saveBusinessPlatforms(next)
  }

  const moveBusinessPlatform = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= preferences.businessPlatforms.length) return
    const next = [...preferences.businessPlatforms]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    saveBusinessPlatforms(next)
  }

  if (!lockStatus || (lockStatus.enabled && !lockStatus.unlocked)) {
    return <main className="page projects-page business-ledger-page">
      <header className="page-header"><div><h1>商单收入</h1><p>汇总数据受到隐私锁保护；项目内金额页不受影响。</p></div></header>
      <section className="business-ledger-lock card" aria-label="收入台账已锁定">
        <LockKeyhole size={30} />
        <div><span>{unlocking ? '正在等待系统验证' : '隐私锁已开启'}</span><h2>使用指纹或密码解锁</h2><p>进入页面时会直接请求Touch ID；取消后也可以输入收入台账密码。</p></div>
        <label>收入台账密码<input ref={lockPasswordRef} autoFocus={!lockStatus?.touchIdAvailable} disabled={unlocking} type="password" value={lockPassword} onChange={(event) => setLockPassword(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') void unlockWithPassword() }} /></label>
        {lockError ? <p className="form-error" role="alert">{lockError}</p> : null}
        <div>{lockStatus?.touchIdAvailable ? <button disabled={unlocking} onClick={() => void unlockWithTouchId()}><Fingerprint size={15} />重新验证</button> : null}<button className="primary-action" disabled={unlocking || !lockPassword} onClick={() => void unlockWithPassword()}>密码解锁</button></div>
      </section>
    </main>
  }

  return <main className="page projects-page business-ledger-page">
    <header className="page-header business-ledger-page-header">
      <div><h1>商单收入</h1></div>
      <div className="business-ledger-page-actions">
        {lockStatus.enabled ? <button onClick={() => void lockNow()}><LockKeyhole size={14} />锁定</button> : null}
        <button onClick={() => void openTrash()}><Trash2 size={14} />回收站</button>
        <button onClick={() => { setImportOpen(true); setError('') }}><Sparkles size={14} />智能导入</button>
        <div className="business-new-menu">
          <button className="primary-action" aria-expanded={newMenuOpen} onClick={() => setNewMenuOpen((current) => !current)}><Plus size={15} />新建商单<ChevronDown size={13} /></button>
          {newMenuOpen ? <div role="menu"><button onClick={openDirectEditor}><b>直接补加</b><small>不创建内容项目</small></button><button onClick={() => void openAssociateEditor()}><b>关联已有项目</b><small>恢复或补充项目台账</small></button></div> : null}
        </div>
      </div>
    </header>

    <section className="business-ledger-filters card" aria-label="商单收入筛选">
      <div className="business-filter-primary">
        <label><CalendarRange size={14} /><span className="visually-hidden">时间范围</span><AppSelect aria-label="时间范围" value={timeRange} onChange={(event) => setTimeRange(event.currentTarget.value as BusinessTimeRange)}><option value="month">本月</option><option value="quarter">本季度</option><option value="year">今年</option><option value="all">全部</option><option value="custom">自定义</option></AppSelect></label>
        {timeRange === 'custom' ? <div className="business-custom-range"><input aria-label="自定义开始日期" value={customStart} onChange={(event) => setCustomStart(event.currentTarget.value)} placeholder="开始日期" /><span>至</span><input aria-label="自定义结束日期" value={customEnd} onChange={(event) => setCustomEnd(event.currentTarget.value)} placeholder="结束日期" /></div> : null}
        <label><span className="visually-hidden">筛选平台</span><AppSelect aria-label="筛选平台" value={platform} onChange={(event) => setPlatform(event.currentTarget.value)}><option value="">全部平台</option>{businessPlatforms.map((item) => <option key={item}>{item}</option>)}</AppSelect></label>
        <button onClick={() => setPlatformManagerOpen(true)}>管理平台</button>
        <label><span className="visually-hidden">筛选商单状态</span><AppSelect aria-label="筛选商单状态" value={lifecycleStatus} onChange={(event) => setLifecycleStatus(event.currentTarget.value as '' | BusinessLifecycleStatus)}><option value="">全部阶段</option>{Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AppSelect></label>
        <label className="table-search"><Search size={15} /><span className="visually-hidden">搜索商单收入</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索商单、平台或返点方" /></label>
        <button onClick={clearFilters}>清除筛选</button>
      </div>
      <div className="business-filter-statuses">
        <span>回款</span><button className={paymentStatus === 'pending' ? 'selected warning' : ''} onClick={() => setPaymentStatus((current) => current === 'pending' ? '' : 'pending')}>未回款</button><button className={paymentStatus === 'received' ? 'selected success' : ''} onClick={() => setPaymentStatus((current) => current === 'received' ? '' : 'received')}>已回款</button>
        <i />
        <span>返点</span><button className={rebateStatus === 'pending' ? 'selected warning' : ''} onClick={() => setRebateStatus((current) => current === 'pending' ? '' : 'pending')}>待返点</button><button className={rebateStatus === 'completed' ? 'selected success' : ''} onClick={() => setRebateStatus((current) => current === 'completed' ? '' : 'completed')}>已返点</button><button className={rebateStatus === 'not_required' ? 'selected muted' : ''} onClick={() => setRebateStatus((current) => current === 'not_required' ? '' : 'not_required')}>无需返点</button>
        <i />
        <span>返点发票</span><button className={invoiceStatus === 'pending' ? 'selected warning' : ''} onClick={() => setInvoiceStatus((current) => current === 'pending' ? '' : 'pending')}>待收</button><button className={invoiceStatus === 'issued' ? 'selected success' : ''} onClick={() => setInvoiceStatus((current) => current === 'issued' ? '' : 'issued')}>已收</button><button className={invoiceStatus === 'not_required' ? 'selected muted' : ''} onClick={() => setInvoiceStatus((current) => current === 'not_required' ? '' : 'not_required')}>无需</button>
      </div>
    </section>

    <BusinessLedger
      entries={entries}
      timeRange={timeRange}
      customStart={customStart}
      customEnd={customEnd}
      platform={platform}
      query={query}
      lifecycleStatus={lifecycleStatus}
      paymentStatus={paymentStatus}
      rebateStatus={rebateStatus}
      invoiceStatus={invoiceStatus}
      onSelect={editEntry}
      onCreateStandalone={openDirectEditor}
      onField={openField}
      onToggleSettled={(projectId, settled) => void toggleSettled(projectId, settled)}
      onRelink={openRelink}
      onTrash={setPendingTrashId}
    />

    {editor ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestCloseEditor() }}>
      <section className="business-editor-dialog" role="dialog" aria-modal="true" aria-label={selected ? '商单收入详情' : editor.mode === 'project' ? '关联项目商务录入' : '直接补加商单'} onKeyDown={(event) => { if (!invoiceEditor && !folderScan && !pendingTrashId && !guard) handleIncomeDialogKey(event, requestCloseEditor) }}>
        <header><div><span>{selected ? selected.ledgerOnly ? '独立商单收入·可直接修改' : '关联内容项目·可直接修改' : editor.mode === 'project' ? '关联已有项目' : '不创建内容项目'}</span><h2>{selected ? selected.projectTitle : editor.mode === 'project' ? '选择项目并补加商务' : '直接补加商单'}</h2></div><button aria-label="关闭商务录入" disabled={saving || recognizing || scanningFolder} onClick={requestCloseEditor}><X size={16} /></button></header>
        <div className="business-editor-scroll" inert={saving || recognizing}>
          <section className="business-smart-fill">
            <header><div><Sparkles size={15} /><span><b>智能填写</b></span></div><button onClick={() => setSmartOpen((current) => !current)}>{smartOpen ? '收起' : '展开'}</button></header>
            {smartOpen ? <div><textarea value={smartText} onChange={(event) => setSmartText(event.currentTarget.value)} placeholder="粘贴甲方聊天、报价或合作说明……" /><div><input ref={editorScreenshotRef} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => { if (event.currentTarget.files) void recognizeEditorScreenshot(event.currentTarget.files); event.currentTarget.value = '' }} /><button disabled={recognizing} onClick={() => editorScreenshotRef.current?.click()}><ImageUp size={13} />聊天截图</button><button className="primary-action" disabled={recognizing || !smartText.trim()} onClick={() => void recognizeEditorText()}><ClipboardPaste size={13} />{recognizing ? '识别中…' : '识别并填入'}</button></div></div> : null}
            {autofillSummary ? <div className="business-autofill-result compact"><div><b>已识别{autofillSummary.fields.length}项</b><span>{autofillSummary.fields.join('、') || '未找到可填写字段'}</span></div><small>{autofillSummary.warnings.join('；') || '请检查后保存'}</small></div> : null}
          </section>

          <section className="business-editor-section">
            <h3>基本信息</h3>
            {editor.mode === 'project' && !selected ? <label className="business-editor-wide"><span>选择项目</span><AppSelect aria-label="选择关联项目" value={editor.projectId ?? ''} onChange={(event) => void selectAssociateProject(event.currentTarget.value)}><option value="">请选择尚未进入台账的商单项目</option>{eligibleProjects.map((project) => <option key={project.id} value={project.id}>{project.title}{trashedEntries.some((entry) => entry.projectId === project.id) ? '·将恢复原台账' : ''}</option>)}</AppSelect></label> : null}
            <div className="business-editor-grid basic">
              <label className="business-editor-wide"><span>商单名称</span><input autoFocus readOnly={editor.mode === 'project'} value={editor.title} onChange={(event) => patchEditor('title', event.currentTarget.value)} placeholder="例如：某品牌合作" /></label>
              <label><span>商单状态</span><AppSelect aria-label="商单状态" value={editor.lifecycleChoice} onChange={(event) => { const value = event.currentTarget.value as BusinessLifecycleStatus; setEditor((current) => current ? { ...current, lifecycleChoice: value, manualSettled: value === 'settled' } : current) }}><option value="agreed_pending_order">已谈妥·待下单</option><option value="ordered">已下单</option><option value="settled">已结清</option><option value="canceled">已取消</option></AppSelect></label>
              <label><span>下单平台</span><AppSelect aria-label="下单平台" value={editor.orderPlatform} onChange={(event) => { const value = event.currentTarget.value; setEditor((current) => current ? { ...current, orderPlatform: value, orderPlatformManuallySet: true } : current) }}><option value="">请选择平台</option>{businessPlatforms.map((item) => <option key={item} value={item}>{item}</option>)}</AppSelect></label>
              <label><span>下单日期·可不填</span><input type="date" value={editor.orderDate} onChange={(event) => { const value = event.currentTarget.value; setEditor((current) => current ? { ...current, orderDate: value, revenueMonth: current.revenueMonth || value.slice(0, 7) } : current) }} /></label>
              <label><span>收益月份·可单独填写</span><input type="month" value={editor.revenueMonth} onChange={(event) => patchEditor('revenueMonth', event.currentTarget.value)} /></label>
            </div>
          </section>

          <section className="business-editor-section">
            <h3>金额</h3>
            <div className="business-editor-grid money">
              <label><span>询单报价·可选</span><input inputMode="decimal" value={editor.quotedAmount} onChange={(event) => patchEditor('quotedAmount', event.currentTarget.value)} placeholder="¥61,200" /></label>
              <label><span>商单金额</span><input inputMode="decimal" value={editor.platformOrderAmount} onChange={(event) => patchEditor('platformOrderAmount', event.currentTarget.value)} placeholder="¥61,200" /></label>
              <div className="business-editor-choice"><span>回款状态</span><div className="business-choice-chips" role="group" aria-label="回款状态"><button className={editor.paymentStatus === 'pending' ? 'selected' : ''} onClick={() => setEditor((current) => current ? { ...current, paymentStatus: 'pending', paymentReceivedDate: '' } : current)}>未回款</button><button className={editor.paymentStatus === 'received' ? 'selected' : ''} onClick={() => setEditor((current) => current ? { ...current, paymentStatus: 'received', paymentReceivedDate: current.paymentReceivedDate || today() } : current)}>已回款</button></div></div>
              <label><span>回款日期</span><input type="date" disabled={editor.paymentStatus !== 'received'} value={editor.paymentReceivedDate} onChange={(event) => patchEditor('paymentReceivedDate', event.currentTarget.value)} /></label>
            </div>
            <div className="business-editor-grid cost-row">
              <label><span>制作成本</span><input inputMode="decimal" value={editor.videoProductionCost} onChange={(event) => patchEditor('videoProductionCost', event.currentTarget.value)} placeholder="0" /></label>
              <label><span>投流成本</span><input inputMode="decimal" value={editor.trafficPromotionCost} onChange={(event) => patchEditor('trafficPromotionCost', event.currentTarget.value)} placeholder="0" /></label>
            </div>
            <div className="business-editor-calculation"><span>预计净收入·自动计算</span><b>{money(derivedEditor.expected)}</b><small>商单金额－返点－制作成本－投流成本</small></div>
          </section>

          <section className="business-editor-section">
            <h3>结算</h3>
            <div className="business-editor-settlement-row">
              <div><span>返点{selected && editor.rebateRequirement === 'required' ? <small>·{selected.rebateExecutionStatus === 'completed' ? '已返点' : '待返点'}</small> : null}</span><div className="business-choice-chips"><button className={editor.rebateRequirement === 'pending_confirmation' ? 'selected' : ''} onClick={() => patchEditor('rebateRequirement', 'pending_confirmation')}>待确认</button><button className={editor.rebateRequirement === 'not_required' ? 'selected' : ''} onClick={() => patchEditor('rebateRequirement', 'not_required')}>无需返点</button><button className={editor.rebateRequirement === 'required' ? 'selected' : ''} onClick={() => patchEditor('rebateRequirement', 'required')}>需要返点</button></div>{editor.rebateRequirement === 'required' ? <div className="business-rebate-inline"><AppSelect aria-label="返点填写方式" value={editor.rebateInputMode} onChange={(event) => patchEditor('rebateInputMode', event.currentTarget.value as LedgerEditorForm['rebateInputMode'])}><option value="rate">按比例</option><option value="amount">按金额</option></AppSelect>{editor.rebateInputMode === 'rate' ? <input aria-label="返点比例" value={editor.finalRebateRate} onChange={(event) => patchEditor('finalRebateRate', event.currentTarget.value)} placeholder="例如15%" /> : <input aria-label="返点金额" value={editor.finalRebateAmount} onChange={(event) => patchEditor('finalRebateAmount', event.currentTarget.value)} placeholder="金额" />}<input aria-label="返点方" value={editor.rebateRecipientName} onChange={(event) => patchEditor('rebateRecipientName', event.currentTarget.value)} placeholder="返点方" /></div> : null}</div>
              <div><span>返点发票</span><div className="business-choice-chips"><button className={editor.invoiceRequirement === 'pending_confirmation' ? 'selected' : ''} onClick={() => setInvoiceRequirement('pending_confirmation')}>待确认</button><button className={editor.invoiceRequirement === 'not_required' ? 'selected' : ''} onClick={() => setInvoiceRequirement('not_required')}>无需</button><button className={editor.invoiceRequirement === 'required' ? 'selected' : ''} onClick={() => setInvoiceRequirement('required')}>需要对方开</button></div>{editor.invoiceRequirement === 'required' ? <div className="business-invoice-status-control"><span>发票状态</span><div className="business-choice-chips" role="group" aria-label="返点发票状态"><button aria-pressed={!editor.invoiceReceivedManually && !editor.invoiceReceivedFromEvidence} disabled={editor.invoiceReceivedFromEvidence} className={!editor.invoiceReceivedManually && !editor.invoiceReceivedFromEvidence ? 'selected' : ''} onClick={() => patchEditor('invoiceReceivedManually', false)}>待收</button><button aria-pressed={editor.invoiceReceivedManually || editor.invoiceReceivedFromEvidence} className={editor.invoiceReceivedManually || editor.invoiceReceivedFromEvidence ? 'selected' : ''} onClick={() => patchEditor('invoiceReceivedManually', true)}>已收到</button></div></div> : null}<small>{editor.invoiceReceivedFromEvidence ? '已根据上传或录入的发票确认收到。' : editor.invoiceRequirement === 'required' ? '可以直接手动标记，之后仍可补传图片或录入发票信息。' : '先确认是否需要对方开票。'}</small></div>
            </div>
          </section>

          {selected && selectedData && (editor.invoiceRequirement === 'required' || selectedData.invoices.length > 0) ? <div className="business-editor-section">
          {editor.invoiceRequirement === 'required' || selectedData.invoices.length ? <section><header className="business-detail-section-head"><h3>返点发票</h3><button onClick={() => editInvoice()}><ReceiptText size={13} />新增或共用</button></header>{selectedData.invoices.length ? <div className="business-detail-invoices">{selectedData.invoices.map((invoice) => <article key={invoice.id}><div><b>{invoice.issuerName || selected.rebateRecipientName || '返点方待填'}</b><span>{money(invoice.amountCents)}{invoice.issuedDate ? `·${invoice.issuedDate}` : ''}{invoice.sharedProjectCount > 1 ? `·共用${invoice.sharedProjectCount}单` : ''}</span></div>{invoice.projectId === selected.projectId ? <button onClick={() => editInvoice(invoice)}>编辑</button> : <small>由所属台账管理</small>}</article>)}</div> : <p className="business-detail-empty">{selected.invoiceReceivedManuallyAt ? '已手动标记收到，尚未补录发票信息。' : '还没有返点发票。'}</p>}</section> : null}
</div> : null}

          <section className="business-editor-section">
            <header className="business-detail-section-head"><div><h3>资料</h3></div>{selected ? <button disabled={scanningFolder} onClick={() => void scanFolder()}><FileSearch size={13} />{scanningFolder ? '扫描中…' : '扫描文件夹'}</button> : null}<button onClick={() => editorFilesRef.current?.click()}><UploadCloud size={13} />选择文件</button></header>
            {selected && selectedData ? <>{selectedData.files.length ? <div className="business-detail-files">{selectedData.files.map((file) => <article key={file.id}><FileText size={14} /><span><b>{file.fileName}</b><small>{businessFileLabels[file.role]}{file.sharedProjectCount > 1 ? `·共用${file.sharedProjectCount}单` : ''}</small></span><button onClick={() => void window.creatorOS?.revealBusinessFile(selected.projectId, file.id)}><FolderOpen size={13} />打开</button></article>)}</div> : <p className="business-detail-empty">还没有合同、凭证、发票或聊天截图。</p>}</> : null}
            <input ref={editorFilesRef} className="visually-hidden" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={(event) => { if (event.currentTarget.files) addEditorFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
            <div className="business-editor-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addEditorFiles(event.dataTransfer.files) }}><UploadCloud size={20} /><b>拖入商务资料</b><span>无需预先选择类型，保存前可以修改分类</span></div>
            {editor.stagedFiles.length ? <div className="business-editor-staged-files">{editor.stagedFiles.map((staged) => <article key={staged.id}><FileText size={13} /><span>{staged.file.name}</span><AppSelect aria-label={`${staged.file.name}分类`} value={staged.role} onChange={(event) => { const role = event.currentTarget.value as BusinessFileRole; setEditor((current) => current ? { ...current, stagedFiles: current.stagedFiles.map((item) => item.id === staged.id ? { ...item, role } : item) } : current) }}>{Object.entries(businessFileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AppSelect><button aria-label={`移除${staged.file.name}`} onClick={() => setEditor((current) => current ? { ...current, stagedFiles: current.stagedFiles.filter((item) => item.id !== staged.id) } : current)}><X size={12} /></button></article>)}</div> : null}
            <label className="business-editor-wide"><span>备注</span><textarea aria-label="备注" value={editor.notes} onChange={(event) => patchEditor('notes', event.currentTarget.value)} placeholder="只记录需要回看的商务说明" /></label>
          </section>
          {selected && selectedData ? <>
          <details className="business-history"><summary>操作历史·{selectedData.events.length}条</summary><div>{selectedData.events.map((event) => <article key={event.id}><span>{eventLabels[event.action]}</span><b>{event.summary}</b><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></article>)}</div></details>
          <div className="income-record-actions"><button className="danger-action" onClick={() => requestLeave(() => { closeEditor(); setPendingTrashId(selected.projectId) })}><Trash2 size={13} />移入回收站</button><button onClick={() => openRelink(selected.projectId)}><Link2 size={13} />{selected.ledgerOnly ? '关联商单项目' : '更换关联项目'}</button>{selected.ledgerOnly ? null : <button onClick={() => requestLeave(() => { closeEditor(); navigate({ page: 'project', projectId: selected.projectId, moduleKey: 'business' }) })}>查看项目<ExternalLink size={13} /></button>}</div>
          </> : null}
          {detailError ? <p className="form-error" role="alert">{detailError}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <footer><span>{dirty ? '有未保存的修改' : selected ? '可直接修改，保存后生效' : editor.mode === 'standalone' ? '保存后只出现在商单收入。' : '保存后恢复或补充对应项目的商单收入。'}</span><button disabled={saving || recognizing || scanningFolder} onClick={requestCloseEditor}>{dirty ? '取消' : '关闭'}</button>{editor.mode === 'standalone' && !editor.ledgerId ? <button disabled={saving || recognizing || scanningFolder || !editor.title.trim()} onClick={() => void saveEditor(true)}>保存并继续新增</button> : null}<button className="primary-action" disabled={saving || recognizing || scanningFolder || (Boolean(selected) && (!dirty || !selectedData)) || !editor.title.trim() || (editor.mode === 'project' && !editor.projectId)} onClick={() => void saveEditor(false)}>{saving ? '保存中…' : '保存'}</button></footer>
      </section>
    </div> : null}

    {invoiceEditor && selected ? <div className="modal-backdrop"><section className="business-invoice-dialog" role="dialog" aria-modal="true" aria-label="返点发票"><header><div><span>可关联多笔商单</span><h3>{invoiceEditor.id ? '编辑返点发票' : '新增返点发票'}</h3></div><button aria-label="关闭返点发票" onClick={() => setInvoiceEditor(null)}><X size={14} /></button></header><div className="business-invoice-fields"><label>返点方<input value={invoiceEditor.issuerName} onChange={(event) => setInvoiceEditor({ ...invoiceEditor, issuerName: event.currentTarget.value })} /></label><label>发票金额<input inputMode="decimal" value={invoiceEditor.amount} onChange={(event) => setInvoiceEditor({ ...invoiceEditor, amount: event.currentTarget.value })} /></label><label>开票日期<input value={invoiceEditor.issuedDate} onChange={(event) => setInvoiceEditor({ ...invoiceEditor, issuedDate: event.currentTarget.value })} placeholder="YYYY-MM-DD" /></label><label className="wide">发票图片<input ref={invoiceImageRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => setInvoiceEditor({ ...invoiceEditor, image: event.currentTarget.files?.[0] ?? null })} /></label></div><div className="business-invoice-projects"><b>关联商单</b>{entries.filter((entry) => entry.invoiceRequirement === 'required').map((entry) => <label key={entry.projectId}><input aria-label={`关联商单${entry.projectTitle}`} type="checkbox" checked={invoiceEditor.linkedProjectIds.includes(entry.projectId) || entry.projectId === selected.projectId} disabled={entry.projectId === selected.projectId} onChange={(event) => { const checked = event.currentTarget.checked; setInvoiceEditor((current) => current ? { ...current, linkedProjectIds: checked ? [...new Set([...current.linkedProjectIds, entry.projectId])] : current.linkedProjectIds.filter((id) => id !== entry.projectId) } : current) }} /><span>{entry.projectTitle}<small>{entry.orderPlatform || '平台待填'}·{money(entry.effectiveFinalRebateAmountCents)}</small></span></label>)}</div><footer><button onClick={() => setInvoiceEditor(null)}>取消</button><button className="primary-action" disabled={saving || !invoiceEditor.amount.trim()} onClick={() => void saveInvoice()}>保存并标记已收到</button></footer></section></div> : null}

    {importOpen ? <div className="modal-backdrop"><section className="business-smart-import-dialog" role="dialog" aria-modal="true" aria-label="智能导入"><header><div><span>支持B站及其他平台</span><h3>智能导入商单收入</h3></div><button aria-label="关闭智能导入" onClick={() => setImportOpen(false)}><X size={14} /></button></header><div className="business-smart-import-source"><label>默认收益月份<input type="month" value={importMonth} onChange={(event) => setImportMonth(event.currentTarget.value)} /></label><label className="wide">粘贴表格或合作文字<textarea value={importSource} onChange={(event) => setImportSource(event.currentTarget.value)} placeholder={'可以粘贴B站账单表格、甲方聊天或合作说明\\n订单名称\\t订单收益\\t账单月份\\t账单状态'} /></label><label className="wide">账单链接<div><input value={importLink} onChange={(event) => setImportLink(event.currentTarget.value)} placeholder="粘贴账单页面链接" /><button disabled={!importLink.trim()} onClick={() => void openImportLink()}><Link2 size={13} />登录或打开账单</button><button disabled={recognizing} onClick={() => void captureImportLink()}><FileSearch size={13} />读取当前页面</button></div><small>首次可在独立安全窗口登录；登录状态只保存在本机，读取后自动生成预览。</small></label><div className="business-smart-import-buttons"><input ref={importFileRef} className="visually-hidden" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void file.text().then(setImportSource); event.currentTarget.value = '' }} /><button onClick={() => importFileRef.current?.click()}><FileSpreadsheet size={13} />账单文件</button><input ref={importScreenshotRef} className="visually-hidden" type="file" multiple accept=".png,.jpg,.jpeg,.webp" onChange={(event) => { if (event.currentTarget.files) void recognizeImportScreenshots(event.currentTarget.files); event.currentTarget.value = '' }} /><button disabled={recognizing} onClick={() => importScreenshotRef.current?.click()}><ImageUp size={13} />账单截图</button><button className="primary-action" disabled={recognizing || !importSource.trim()} onClick={() => void buildImportPreview()}>{recognizing ? '识别中…' : '生成预览'}</button></div></div>{importRows.length ? <div className="business-smart-import-preview"><header><b>导入预览</b><span>{importRows.filter((row) => row.selected).length}条将写入</span></header>{importRows.map((row) => <article key={row.id} className={row.selected ? '' : 'disabled'}><input aria-label={`导入${row.title}`} type="checkbox" checked={row.selected} onChange={(event) => { const selected = event.currentTarget.checked; setImportRows((current) => current.map((item) => item.id === row.id ? { ...item, selected } : item)) }} /><input aria-label="导入商单名称" value={row.title} onChange={(event) => { const title = event.currentTarget.value; setImportRows((current) => current.map((item) => item.id === row.id ? { ...item, title } : item)) }} /><input aria-label="导入商单金额" value={moneyInput(row.record.platformOrderAmountCents)} onChange={(event) => { const amount = safeMoney(event.currentTarget.value); setImportRows((current) => current.map((item) => item.id === row.id ? { ...item, record: { ...item.record, platformOrderAmountCents: amount } } : item)) }} /><input aria-label="导入收益月份" type="month" value={row.record.revenueMonth ?? ''} onChange={(event) => { const revenueMonth = event.currentTarget.value || null; setImportRows((current) => current.map((item) => item.id === row.id ? { ...item, record: { ...item.record, revenueMonth } } : item)) }} /><AppSelect aria-label="导入关联项目" value={row.targetProjectId} onChange={(event) => { const targetProjectId = event.currentTarget.value; setImportRows((current) => current.map((item) => item.id === row.id ? { ...item, targetProjectId } : item)) }}><option value="">作为独立台账</option>{projects.filter((project) => project.isCommercial && !project.trashedAt).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect>{row.duplicate ? <em>重复·默认更新</em> : null}</article>)}</div> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<footer><span>确认前可修改、取消勾选或选择关联项目。</span><button onClick={() => setImportOpen(false)}>取消</button><button className="primary-action" disabled={importing || !importRows.some((row) => row.selected)} onClick={() => void saveImportRows()}>{importing ? '导入中…' : `导入${importRows.filter((row) => row.selected).length}条`}</button></footer></section></div> : null}

    {trashOpen ? <div className="modal-backdrop"><section className="business-trash-dialog" role="dialog" aria-modal="true" aria-label="商单收入回收站"><header><div><span>长期保留，除非你主动永久删除</span><h3>商单收入回收站</h3></div><button aria-label="关闭商单收入回收站" onClick={() => setTrashOpen(false)}><X size={14} /></button></header><div>{trashedEntries.length ? trashedEntries.map((entry) => <article key={entry.projectId}><span><b>{entry.projectTitle}</b><small>{entry.orderPlatform || '平台待填'}·{entry.revenueMonth || '月份待填'}</small></span><div><button onClick={() => void restoreEntry(entry.projectId)}><RotateCcw size={13} />恢复</button><button className="danger-action" onClick={() => setPendingPermanentDeleteId(entry.projectId)}><Trash2 size={13} />永久删除</button></div></article>) : <p>回收站为空。</p>}</div>{error ? <p className="form-error" role="alert">{error}</p> : null}</section></div> : null}

    {pendingTrashId ? <div className="modal-backdrop"><section className="business-delete-dialog" role="dialog" aria-modal="true" aria-label="删除商单收入"><h3>移入收入回收站？</h3><p>不会归档内容项目，商单资料会长期保留并可恢复。</p><footer><button onClick={() => setPendingTrashId(null)}>取消</button><button className="danger-action" onClick={() => void trashEntry(pendingTrashId)}>确认删除</button></footer></section></div> : null}

    {pendingPermanentDeleteId ? <div className="modal-backdrop"><section className="business-delete-dialog" role="dialog" aria-modal="true" aria-label="永久删除商单收入"><h3>永久删除这条商单收入？</h3><p>金额、返点、发票、资料和历史记录都会删除，无法恢复。共用给其他商单的发票和文件会继续保留。</p>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer><button disabled={saving} onClick={() => setPendingPermanentDeleteId(null)}>取消</button><button className="danger-action" disabled={saving} onClick={() => void permanentlyDeleteEntry(pendingPermanentDeleteId)}>{saving ? '删除中…' : '永久删除'}</button></footer></section></div> : null}

    {relinkSourceId ? <div className="modal-backdrop"><section className="business-relink-dialog" role="dialog" aria-modal="true" aria-label="关联商单项目"><header><div><span>商务信息会完整移动</span><h3>{entries.find((entry) => entry.projectId === relinkSourceId)?.ledgerOnly ? '关联商单项目' : '更换关联项目'}</h3></div><button aria-label="关闭关联项目" onClick={() => setRelinkSourceId(null)}><X size={14} /></button></header><label><span>目标商单项目</span><AppSelect autoFocus value={relinkTargetId} onChange={(event) => setRelinkTargetId(event.currentTarget.value)}><option value="">请选择空白商单项目</option>{projects.filter((project) => {
      if (!project.isCommercial || project.trashedAt || project.id === relinkSourceId) return false
      const targetEntry = entries.find((entry) => entry.projectId === project.id)
      return !targetEntry || !entryHasBusinessFacts(targetEntry)
    }).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect><small>只显示还没有填写商务内容的商单项目。</small></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer><button disabled={saving} onClick={() => setRelinkSourceId(null)}>取消</button><button className="primary-action" disabled={saving || !relinkTargetId} onClick={() => void relinkEntry()}>{saving ? '关联中…' : '确认关联'}</button></footer></section></div> : null}

    {folderScan && selected ? <div className="modal-backdrop"><section className="business-folder-scan-dialog" role="dialog" aria-modal="true" aria-label="商务资料扫描结果"><header><div><span>已扫描{folderScan.rootName}</span><h3>选择要导入的商务文件</h3></div><button aria-label="关闭扫描结果" onClick={() => setFolderScan(null)}><X size={14} /></button></header><div>{folderScan.candidates.length ? folderScan.candidates.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={folderScan.selectedIds.includes(candidate.id)} onChange={(event) => { const checked = event.currentTarget.checked; setFolderScan((current) => current ? { ...current, selectedIds: checked ? [...current.selectedIds, candidate.id] : current.selectedIds.filter((id) => id !== candidate.id) } : current) }} /><span><b>{candidate.fileName}</b><small>{businessFileLabels[candidate.suggestedRole]}·{candidate.relativePath}</small></span></label>) : <p>没有找到合同、发票、返点凭证或聊天截图。</p>}</div><footer><span>{folderScan.ignoredCount ? `${folderScan.ignoredCount}个无关或不支持的文件已跳过` : ''}</span><button onClick={() => setFolderScan(null)}>取消</button><button className="primary-action" disabled={saving || !folderScan.selectedIds.length} onClick={() => void importFolder()}>导入{folderScan.selectedIds.length}个</button></footer></section></div> : null}

    {platformManagerOpen ? <div className="modal-backdrop"><section className="business-platform-dialog" role="dialog" aria-modal="true" aria-label="管理接单平台"><header><div><span>与发布平台分开管理；停用不会改变历史商单</span><h3>接单平台</h3></div><button aria-label="关闭平台管理" onClick={() => setPlatformManagerOpen(false)}><X size={14} /></button></header><div>{preferences.businessPlatforms.map((item, index) => <article key={`${item}-${index}`}><input aria-label={`编辑接单平台${item}`} defaultValue={item} onBlur={(event) => renameBusinessPlatform(index, event.currentTarget.value)} /><span><button aria-label={`上移${item}`} disabled={index === 0} onClick={() => moveBusinessPlatform(index, -1)}><ArrowUp size={12} /></button><button aria-label={`下移${item}`} disabled={index === preferences.businessPlatforms.length - 1} onClick={() => moveBusinessPlatform(index, 1)}><ArrowDown size={12} /></button><button aria-label={`停用${item}`} onClick={() => saveBusinessPlatforms(preferences.businessPlatforms.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></span></article>)}</div><footer><input value={newPlatform} onChange={(event) => setNewPlatform(event.currentTarget.value)} placeholder="新增平台名称" /><button className="primary-action" disabled={!newPlatform.trim()} onClick={() => { saveBusinessPlatforms([...preferences.businessPlatforms, newPlatform]); setNewPlatform('') }}>添加</button></footer></section></div> : null}
    {fieldTarget ? <IncomeFieldPopover key={`${fieldTarget.kind}:${fieldTarget.kind === 'business' ? fieldTarget.record.projectId : fieldTarget.record.id}:${fieldTarget.field}`} target={fieldTarget} onDismiss={() => setFieldTarget((current) => current === fieldTarget ? null : current)} onSaved={refreshWorkspace} /> : null}
    {guard}
  </main>
}
