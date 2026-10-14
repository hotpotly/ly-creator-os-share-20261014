import { AppSelect } from './AppSelect'
import { Archive, Check, ChevronDown, CircleAlert, Clock3, ExternalLink, Inbox, Pause, Play, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BUILTIN_TEXT_PROVIDER_CONFIG_IDS,
  type ExternalProviderConfig,
  type ConversationFilterBatchDecisionResult,
  type ConversationFilterCandidate,
  type ConversationFilterDecisionInput,
  type ConversationHistorySource,
  type ConversationMetadata,
  type ConversationScanPlan,
  type ConversationScanPreflight,
  type ConversationScanPreflightBatch,
  type ConversationScanProgress,
  type ProviderCapability,
  type ProviderSettings
} from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { LegacyContentEngine } from './LegacyContentEngine'

type SourceScope = 'codex' | 'claude' | 'both'
type ResultTab = 'pending' | 'confirmed' | 'parked' | 'discarded'
type PendingGroup = 'recommended' | 'needs_judgment'

interface ProviderChoice {
  id: string
  label: string
  available: boolean
  statusText: string
  cliProvider?: 'codex_cli' | 'claude_cli'
  externalConfig?: ExternalProviderConfig
}
const sourceLabels: Record<ConversationHistorySource, string> = { codex: 'Codex', claude: 'Claude' }
const atomTypeLabels: Record<ConversationFilterCandidate['atomType'], string> = {
  story: '故事', method: '方法', viewpoint: '观点', comparison: '对比', pitfall: '踩坑', verifiable_fact: '可核验事实'
}
const similarityLabels: Record<ConversationFilterCandidate['similarities'][number]['kind'], string> = {
  published_project: '疑似已做过',
  active_project: '疑似正在做',
  existing_topic: '已有相似选题',
  parked_direction: '关联已搁置方向'
}
const privacyLabels: Record<string, string> = {
  credential: '凭证', phone: '手机号', email: '邮箱', confidentiality: '可能的保密内容', custom_sensitive: '自定义敏感词'
}

function capabilityHint(capability: ProviderCapability | undefined): string {
  if (!capability) return '正在检测'
  if (capability.status === 'available') return '可用'
  if (capability.status === 'not_installed') return '未安装'
  if (capability.status === 'verifying') return '验证中'
  if (capability.status === 'verification_failed') return '验证失败'
  return '需安全验证'
}

function readableDate(value?: string): string {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date)
}

function emptyProgress(): ConversationScanProgress {
  return { scanId: null, mode: null, totalBatches: 0, completedBatches: 0, failedBatches: 0, activeBatches: 0, pausedBatches: 0, status: 'idle' }
}

export function ContentEnginePage(): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh)
  const [conversations, setConversations] = useState<ConversationMetadata[]>([])
  const [sourceScope, setSourceScope] = useState<SourceScope>('both')
  const [providerConfigId, setProviderConfigId] = useState<string>(BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null)
  const [mode, setMode] = useState<'deep' | 'incremental'>('deep')
  const [plan, setPlan] = useState<ConversationScanPlan | null>(null)
  const [progress, setProgress] = useState<ConversationScanProgress>(emptyProgress)
  const [preflight, setPreflight] = useState<ConversationScanPreflight | null>(null)
  const [preflightBatch, setPreflightBatch] = useState<ConversationScanPreflightBatch | null>(null)
  const [customSensitiveText, setCustomSensitiveText] = useState('')
  const [budgetEnabled, setBudgetEnabled] = useState(false)
  const [budgetTokenLimit, setBudgetTokenLimit] = useState('1000000')
  const [candidates, setCandidates] = useState<ConversationFilterCandidate[]>([])
  const [resultTab, setResultTab] = useState<ResultTab>('pending')
  const [pendingGroup, setPendingGroup] = useState<PendingGroup>('recommended')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [bulkSelection, setBulkSelection] = useState<string[]>([])
  const [searchText, setSearchText] = useState('')
  const [detailWidth, setDetailWidth] = useState(() => Number(localStorage.getItem('ai-topic-filter-detail-width')) || 360)
  const [busy, setBusy] = useState<'scan' | 'verify' | 'decision' | 'pause' | 'resume' | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const capabilities = useMemo(() => new Map(snapshot.providerCapabilities.map((item) => [item.provider, item])), [snapshot.providerCapabilities])
  const providerChoices = useMemo<ProviderChoice[]>(() => {
    const cli = ([
      [BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, 'Codex', 'codex_cli'],
      [BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude, 'Claude', 'claude_cli']
    ] as const).map(([id, label, cliProvider]) => {
      const capability = capabilities.get(cliProvider)
      return { id, label, cliProvider, available: Boolean(capability?.available), statusText: capabilityHint(capability) }
    })
    const external = (providerSettings?.configs ?? []).map((config) => ({
      id: config.id,
      label: config.displayName,
      externalConfig: config,
      available: config.status === 'available',
      statusText: config.status === 'available' ? '可用' : config.status === 'failed' ? '验证失败' : '待验证'
    }))
    return [...cli, ...external]
  }, [capabilities, providerSettings])
  const selectedProvider = providerChoices.find((choice) => choice.id === providerConfigId) ?? providerChoices[0]
  const sourceCounts = useMemo(() => ({
    codex: conversations.filter((conversation) => conversation.source === 'codex').length,
    claude: conversations.filter((conversation) => conversation.source === 'claude').length
  }), [conversations])
  const customSensitiveTerms = useMemo(() => [...new Set(customSensitiveText.split(/[，,\n]/).map((term) => term.trim()).filter(Boolean))], [customSensitiveText])

  const refreshCandidates = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) return
    const next = await window.creatorOS.listConversationFilterCandidates()
    setCandidates(next)
    setBulkSelection((current) => {
      const allowed = new Set(next.filter((candidate) => candidate.status === 'review_pending' && candidate.reviewGroup === 'recommended').map((candidate) => candidate.id))
      return [...new Set([...current.filter((id) => allowed.has(id)), ...allowed])]
    })
    setSelectedCandidateId((current) => current && next.some((candidate) => candidate.id === current) ? current : window.innerWidth > 900 ? next.find((candidate) => candidate.status === 'review_pending')?.id ?? next[0]?.id ?? null : null)
  }, [])

  const refreshPlan = useCallback(async (nextMode = mode, nextScope = sourceScope): Promise<void> => {
    if (!window.creatorOS) return
    try {
      const [metadata, nextPlan, nextProgress] = await Promise.all([
        window.creatorOS.listConversationSources({ limit: 1_000 }),
        window.creatorOS.getConversationScanPlan({ mode: nextMode, sourceScope: nextScope }),
        window.creatorOS.getConversationScanProgress()
      ])
      setConversations(metadata.conversations)
      setPlan(nextPlan)
      setProgress(nextProgress)
      if (nextMode === 'deep' && nextPlan.previouslyScannedCount > 0) {
        setMode('incremental')
        setPlan(await window.creatorOS.getConversationScanPlan({ mode: 'incremental', sourceScope: nextScope }))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '扫描范围读取失败')
    }
  }, [mode, sourceScope])

  useEffect(() => {
    void Promise.all([refreshPlan(), refreshCandidates()])
  }, [refreshCandidates, refreshPlan])

  useEffect(() => {
    if (!window.creatorOS) return
    void window.creatorOS.getProviderSettings().then((settings) => {
      setProviderSettings(settings)
      setProviderConfigId(settings.defaultProviderConfigId)
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '无法读取AI设置'))
  }, [])

  useEffect(() => {
    if (progress.status !== 'running' || !progress.scanId || !window.creatorOS) return
    const timer = window.setInterval(() => {
      void window.creatorOS!.getConversationScanProgress(progress.scanId).then((next) => {
        setProgress(next)
        void refreshWorkspace()
        if (next.status === 'completed' || next.status === 'failed') {
          void refreshCandidates()
          void refreshPlan('incremental', sourceScope)
        }
      })
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [progress.scanId, progress.status, refreshCandidates, refreshPlan, refreshWorkspace, sourceScope])

  const visibleCandidates = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase()
    return candidates.filter((candidate) => {
      if (resultTab === 'pending' && (candidate.status !== 'review_pending' || candidate.reviewGroup !== pendingGroup)) return false
      if (resultTab !== 'pending' && candidate.status !== resultTab) return false
      return !query || `${candidate.themeTitle}${candidate.directionTitle}${candidate.title}${candidate.content}`.toLocaleLowerCase().includes(query)
    })
  }, [candidates, pendingGroup, resultTab, searchText])
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null
  const tabCounts = useMemo(() => ({
    pending: candidates.filter((candidate) => candidate.status === 'review_pending').length,
    confirmed: candidates.filter((candidate) => candidate.status === 'confirmed').length,
    parked: candidates.filter((candidate) => candidate.status === 'parked').length,
    discarded: candidates.filter((candidate) => candidate.status === 'discarded').length
  }), [candidates])

  const verifyProvider = async (): Promise<void> => {
    if (!window.creatorOS || !selectedProvider) return
    setBusy('verify'); setError('')
    try {
      if (selectedProvider.cliProvider) {
        const capability = await window.creatorOS.validateProviderSecurity(selectedProvider.cliProvider)
        await refreshWorkspace()
        if (capability.available) setNotice(`${selectedProvider.label}安全验证已通过`)
        else setError(capability.detail)
      } else if (selectedProvider.externalConfig) {
        const config = await window.creatorOS.validateExternalProviderConfig(selectedProvider.externalConfig.id)
        const settings = await window.creatorOS.getProviderSettings()
        setProviderSettings(settings)
        if (config.status === 'available') setNotice(`${selectedProvider.label}连接验证已通过`)
        else setError(config.lastError ?? '外部Provider验证失败')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Provider安全验证失败') }
    finally { setBusy(null) }
  }

  const startScan = async (): Promise<void> => {
    if (!window.creatorOS || !plan || !selectedProvider?.available) return
    setBusy('scan'); setError(''); setNotice('')
    try {
      const prepared = await window.creatorOS.prepareConversationScan({
        mode,
        sourceScope,
        providerConfigId: selectedProvider.id,
        customSensitiveTerms,
        budgetTokenLimit: budgetEnabled ? Number(budgetTokenLimit) : null
      })
      setPreflight(prepared)
      setPreflightBatch(await window.creatorOS.getConversationScanPreflightBatch(prepared.preflightId, 1))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发送前检查失败') }
    finally { setBusy(null) }
  }

  const confirmScan = async (): Promise<void> => {
    if (!window.creatorOS || !preflight) return
    setBusy('scan'); setError(''); setNotice('')
    try {
      const result = await window.creatorOS.startConversationScan(preflight.preflightId)
      setProgress(await window.creatorOS.getConversationScanProgress(result.scanId))
      setNotice(`已开始${mode === 'deep' ? '首次深度' : '增量'}扫描：${result.conversationCount}条对话，分为${result.tasks.length}批`)
      setPreflight(null)
      setPreflightBatch(null)
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '扫描启动失败') }
    finally { setBusy(null) }
  }

  const showPreflightBatch = async (batchIndex: number): Promise<void> => {
    if (!window.creatorOS || !preflight) return
    setBusy('scan'); setError('')
    try { setPreflightBatch(await window.creatorOS.getConversationScanPreflightBatch(preflight.preflightId, batchIndex)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '发送内容读取失败') }
    finally { setBusy(null) }
  }

  const pauseOrResume = async (): Promise<void> => {
    if (!window.creatorOS || !progress.scanId) return
    const pausing = progress.status === 'running'
    setBusy(pausing ? 'pause' : 'resume'); setError('')
    try {
      const next = pausing ? await window.creatorOS.pauseConversationScan(progress.scanId) : await window.creatorOS.resumeConversationScan(progress.scanId)
      setProgress(next)
      setNotice(pausing ? '扫描已暂停，进度已经保存' : '扫描已继续')
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '扫描状态修改失败') }
    finally { setBusy(null) }
  }

  const applyResult = async (result: ConversationFilterBatchDecisionResult): Promise<void> => {
    setCandidates((current) => {
      const updates = new Map(result.candidates.map((candidate) => [candidate.id, candidate]))
      return current.map((candidate) => updates.get(candidate.id) ?? candidate)
    })
    setBulkSelection((current) => current.filter((id) => !result.candidates.some((candidate) => candidate.id === id)))
    await refreshWorkspace()
  }

  const decide = async (candidate: ConversationFilterCandidate, decision: ConversationFilterDecisionInput): Promise<void> => {
    if (!window.creatorOS) return
    setBusy('decision'); setError('')
    try {
      const result = await window.creatorOS.decideConversationFilterCandidate(candidate.id, decision)
      await applyResult(result)
      setNotice(decision.action === 'park' ? '已暂时搁置' : decision.action === 'discard' || decision.action === 'mark_done' ? '已移入回收站' : decision.action === 'restore' ? '已恢复到待处理' : '已进入选题管理')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '候选处理失败') }
    finally { setBusy(null) }
  }

  const confirmBulk = async (): Promise<void> => {
    if (!window.creatorOS || !bulkSelection.length) return
    setBusy('decision'); setError('')
    try {
      const result = await window.creatorOS.confirmConversationFilterCandidates(bulkSelection)
      await applyResult(result)
      setNotice(`已确认${result.candidates.length}个方向，并按主题写入选题管理`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批量确认失败') }
    finally { setBusy(null) }
  }

  const deletePermanently = async (candidate: ConversationFilterCandidate): Promise<void> => {
    if (!window.creatorOS || !window.confirm(`永久删除“${candidate.title}”？此操作无法恢复。`)) return
    setBusy('decision')
    try {
      await window.creatorOS.permanentlyDeleteConversationFilterCandidate(candidate.id)
      setCandidates((current) => current.filter((item) => item.id !== candidate.id))
      setNotice('已永久删除')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '永久删除失败') }
    finally { setBusy(null) }
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    dragRef.current = { startX: event.clientX, startWidth: detailWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const resize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!dragRef.current) return
    const next = Math.max(300, Math.min(620, dragRef.current.startWidth + dragRef.current.startX - event.clientX))
    setDetailWidth(next)
  }
  const endResize = (): void => {
    dragRef.current = null
    localStorage.setItem('ai-topic-filter-detail-width', String(detailWidth))
  }

  return <main className="page ai-topic-filter-page">
    <header className="page-header ai-topic-filter-header">
      <div><span>创作工具</span><h1>AI选题筛选</h1></div>
      <div className="ai-topic-cloud-note"><ShieldCheck size={15} /><span>只有确认扫描后，所选文字才会发送到当前AI云端</span></div>
    </header>

    {notice ? <div className="inline-notice" role="status"><Sparkles size={14} />{notice}</div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}

    <section className="ai-topic-scan-bar content-card">
      <div className="ai-topic-scan-choice">
        <span>对话来源</span>
        <div>{(['codex', 'claude', 'both'] as const).map((scope) => <button className={sourceScope === scope ? 'active' : ''} key={scope} onClick={() => { setSourceScope(scope); void refreshPlan(mode, scope) }}>
          {scope === 'both' ? `Codex＋Claude（${sourceCounts.codex + sourceCounts.claude}）` : `${sourceLabels[scope]}（${sourceCounts[scope]}）`}
        </button>)}</div>
      </div>
      <div className="ai-topic-scan-choice">
        <span>使用哪个AI筛选</span>
        <div>{providerChoices.map((choice) => <button className={providerConfigId === choice.id ? 'active' : ''} key={choice.id} onClick={() => setProviderConfigId(choice.id)}>
          {choice.label}<small>{choice.statusText}</small>
        </button>)}</div>
      </div>
      <div className="ai-topic-scan-summary">
        <b>{mode === 'deep' ? '首次深度扫描' : '扫描新增对话'}</b>
        <span>{plan ? `${plan.eligibleConversationCount}条待扫描·预计约${plan.estimatedTokens.toLocaleString('zh-CN')} tokens${plan.estimateIsPartial ? '（保守估算）' : ''}` : '正在计算范围'}</span>
      </div>
      <div className="ai-topic-scan-actions">
        {!selectedProvider?.available
          ? <button className="secondary-action" disabled={busy !== null || !selectedProvider} onClick={() => void verifyProvider()}>{busy === 'verify' ? '验证中…' : `验证${selectedProvider?.label ?? 'AI'}`}</button>
          : null}
        {progress.status === 'running' || progress.status === 'paused' || progress.status === 'failed'
          ? <button className="secondary-action" disabled={busy !== null} onClick={() => void pauseOrResume()}>{progress.status === 'running' ? <><Pause size={13} />暂停</> : <><Play size={13} />继续</>}</button>
          : null}
        <button className="primary-action" disabled={busy !== null || !plan?.eligibleConversationCount || !selectedProvider?.available || progress.status === 'running' || progress.status === 'paused'} onClick={() => void startScan()}>
          <Sparkles size={14} />{busy === 'scan' ? '检查中…' : mode === 'deep' ? '检查并开始首次扫描' : `检查新增${plan?.eligibleConversationCount ?? 0}条`}
        </button>
      </div>
      <details className="ai-topic-scan-options">
        <summary>筛选范围与预算<ChevronDown size={13} /></summary>
        <div>
          <label><span>扫描方式</span><AppSelect value={mode} onChange={(event) => { const next = event.currentTarget.value as typeof mode; setMode(next); void refreshPlan(next, sourceScope) }}><option value="deep">深度扫描全部正常对话</option><option value="incremental">只扫描新增或变化部分</option></AppSelect></label>
          <label><span>自定义敏感词</span><textarea value={customSensitiveText} placeholder="客户名或未公开产品名，每行一个" onChange={(event) => setCustomSensitiveText(event.currentTarget.value)} /></label>
          <label className="ai-topic-budget-option"><input type="checkbox" checked={budgetEnabled} onChange={(event) => setBudgetEnabled(event.currentTarget.checked)} /><span>限制本次输入Token</span><input type="number" min={1_000} disabled={!budgetEnabled} value={budgetTokenLimit} onChange={(event) => setBudgetTokenLimit(event.currentTarget.value)} /></label>
        </div>
      </details>
      {progress.scanId && progress.totalBatches ? <div className={`ai-topic-progress ${progress.status}`}>
        <Clock3 size={14} /><span><b>{progress.mode === 'deep' ? '深度扫描' : '增量扫描'}：{progress.completedBatches}/{progress.totalBatches}批完成</b><small>{progress.status === 'running' ? '批次会连续运行，不需要逐批确认' : progress.status === 'paused' ? '已暂停，可随时继续' : progress.status === 'failed' ? `${progress.failedBatches}批失败，可点继续重试` : '本轮完成'}</small></span>
        <i><em style={{ width: `${progress.totalBatches ? (progress.completedBatches / progress.totalBatches) * 100 : 0}%` }} /></i>
      </div> : null}
    </section>

    {preflight && preflightBatch ? <div className="modal-backdrop ai-topic-preflight-backdrop">
      <section className="ai-topic-preflight" role="dialog" aria-modal="true" aria-labelledby="ai-topic-preflight-title">
        <header><div><span>只确认这一次，之后各批会连续运行</span><h2 id="ai-topic-preflight-title">发送前检查</h2></div><button aria-label="关闭发送前检查" onClick={() => { setPreflight(null); setPreflightBatch(null) }}><X size={16} /></button></header>
        <div className="ai-topic-preflight-summary">
          <article><b>{preflight.conversationCount}</b><span>条正常对话</span></article>
          <article><b>{preflight.estimatedTokens.toLocaleString('zh-CN')}</b><span>预计输入Token</span></article>
          <article><b>{preflight.privacyFindingCount}</b><span>处隐私遮盖</span></article>
          <article><b>{preflight.excludedBlocks.reduce((sum, block) => sum + block.count, 0)}</b><span>个排除块</span></article>
        </div>
        <p className="ai-topic-preflight-provider">{sourceScope === 'both' ? 'Codex＋Claude' : sourceLabels[sourceScope]} → {preflight.providerLabel}<small>{preflight.providerTransport === 'cli' ? 'CLI订阅额度消耗未知，不显示虚构金额' : '本次会调用已配置API；未取得真实单价时不显示虚构金额'}</small></p>
        <div className="ai-topic-preflight-meta">
          <span>已遮盖：{preflight.privacyFindingKinds.length ? preflight.privacyFindingKinds.map((kind) => privacyLabels[kind] ?? kind).join('、') : '未发现规则命中'}</span>
          <span>已排除：{preflight.excludedBlocks.length ? preflight.excludedBlocks.map((block) => `${block.blockType}×${block.count}`).join('、') : '无'}</span>
        </div>
        <div className="ai-topic-preflight-batchbar">
          <span>第{preflightBatch.batchIndex}/{preflightBatch.batchCount}批·{preflightBatch.sourceTitles.length}条来源·{preflightBatch.estimatedTokens.toLocaleString('zh-CN')} tokens</span>
          <div><button disabled={busy !== null || preflightBatch.batchIndex <= 1} onClick={() => void showPreflightBatch(preflightBatch.batchIndex - 1)}>上一批</button><button disabled={busy !== null || preflightBatch.batchIndex >= preflightBatch.batchCount} onClick={() => void showPreflightBatch(preflightBatch.batchIndex + 1)}>下一批</button></div>
        </div>
        <details className="ai-topic-preflight-sources"><summary>本批来源·{preflightBatch.sourceTitles.length}条</summary><p>{preflightBatch.sourceTitles.join('、')}</p></details>
        <pre>{preflightBatch.sanitizedContent}</pre>
        {preflight.issues.length ? <details className="ai-topic-preflight-issues"><summary>读取提示·{preflight.issues.length}条</summary>{preflight.issues.map((issue, index) => <p key={`${issue.code}:${issue.sourceId ?? ''}:${index}`}>{issue.message}</p>)}</details> : null}
        <footer><button onClick={() => { setPreflight(null); setPreflightBatch(null) }}>取消</button><button className="primary-action" disabled={busy !== null} onClick={() => void confirmScan()}>{busy === 'scan' ? '正在启动…' : `确认并开始${preflight.batchCount}批扫描`}</button></footer>
      </section>
    </div> : null}

    <section className="ai-topic-results">
      <header>
        <div className="ai-topic-tabs">{([
          ['pending', '待处理', tabCounts.pending, Inbox],
          ['confirmed', '已通过', tabCounts.confirmed, Check],
          ['parked', '已搁置', tabCounts.parked, Archive],
          ['discarded', '回收站', tabCounts.discarded, Trash2]
        ] as const).map(([tab, label, count, Icon]) => <button className={resultTab === tab ? 'active' : ''} key={tab} onClick={() => {
          setResultTab(tab)
          const next = candidates.find((candidate) => tab === 'pending'
            ? candidate.status === 'review_pending' && candidate.reviewGroup === pendingGroup
            : candidate.status === tab)
          setSelectedCandidateId(window.innerWidth > 900 ? next?.id ?? null : null)
        }}><Icon size={13} />{label}<span>{count}</span></button>)}</div>
        <label className="ai-topic-search"><Search size={13} /><input value={searchText} placeholder="搜索筛选结果" onChange={(event) => setSearchText(event.currentTarget.value)} /></label>
      </header>

      {resultTab === 'pending' ? <div className="ai-topic-pending-toolbar">
        <div>{(['recommended', 'needs_judgment'] as const).map((group) => <button className={pendingGroup === group ? 'active' : ''} key={group} onClick={() => {
          setPendingGroup(group)
          const next = candidates.find((candidate) => candidate.status === 'review_pending' && candidate.reviewGroup === group)
          setSelectedCandidateId(window.innerWidth > 900 ? next?.id ?? null : null)
        }}>{group === 'recommended' ? '推荐确认' : '需要判断'}·{candidates.filter((candidate) => candidate.status === 'review_pending' && candidate.reviewGroup === group).length}</button>)}</div>
        {pendingGroup === 'recommended' ? <button className="primary-action" disabled={!bulkSelection.length || busy !== null} onClick={() => void confirmBulk()}><Check size={13} />确认选中{bulkSelection.length}条</button> : null}
      </div> : null}

      <div className="ai-topic-result-layout" style={{ gridTemplateColumns: `minmax(320px,1fr) 7px ${detailWidth}px` }}>
        <div className="ai-topic-result-list">
          {visibleCandidates.length ? visibleCandidates.map((candidate) => <button className={`ai-topic-result-row${selectedCandidate?.id === candidate.id ? ' active' : ''}`} key={candidate.id} onClick={() => setSelectedCandidateId(candidate.id)}>
            {resultTab === 'pending' && pendingGroup === 'recommended' ? <input type="checkbox" aria-label={`选择${candidate.title}`} checked={bulkSelection.includes(candidate.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setBulkSelection((current) => event.currentTarget.checked ? [...new Set([...current, candidate.id])] : current.filter((id) => id !== candidate.id))} /> : <span className="ai-topic-row-mark" />}
            <span><b>{candidate.title}</b><small>{candidate.themeTitle}·{candidate.directionTitle}</small></span>
            <em>{candidate.similarities[0] ? `${similarityLabels[candidate.similarities[0].kind]}：${candidate.similarities[0].targetTitle}` : candidate.reviewGroup === 'recommended' ? '明确可做' : candidate.status === 'parked' ? '以后再看' : candidate.status === 'discarded' ? candidate.suppressionKind === 'done' ? '已标记做过' : '已弃用' : '已进入选题管理'}</em>
          </button>) : <div className="ai-topic-empty"><Sparkles size={22} /><b>{resultTab === 'pending' ? '这一组已经处理完' : '这里还没有记录'}</b><span>{resultTab === 'pending' ? '可以切换另一组，或扫描新增对话。' : '处理后的结果会保留在这里。'}</span></div>}
          {resultTab === 'pending' && candidates.some((candidate) => candidate.status === 'not_topic') ? <details className="ai-topic-no-topic"><summary>未形成选题·{candidates.filter((candidate) => candidate.status === 'not_topic').length}</summary><p>普通闲聊、纯代码修复和没有形成内容价值的结果已折叠保存，不进入待处理。</p>{candidates.filter((candidate) => candidate.status === 'not_topic').map((candidate) => <article key={candidate.id}><span><b>{candidate.title}</b><small>{candidate.valueReason}</small></span><button disabled={busy !== null} onClick={() => void decide(candidate, { action: 'restore' })}>恢复到待处理</button></article>)}</details> : null}
        </div>
        <button className="ai-topic-resizer" aria-label="拖动调整详情宽度" onPointerDown={beginResize} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize} />
        <aside className={`ai-topic-detail${selectedCandidate ? ' open' : ''}`}>
          {selectedCandidate ? <>
            <header><button className="ai-topic-detail-close" aria-label="关闭详情" onClick={() => setSelectedCandidateId(null)}><X size={14} /></button><span>{atomTypeLabels[selectedCandidate.atomType]}·{selectedCandidate.sourceRefs.length}处来源</span><h2>{selectedCandidate.title}</h2><p>{selectedCandidate.themeTitle}<i>→</i>{selectedCandidate.directionTitle}</p></header>
            <section><h3>为什么值得做</h3><p>{selectedCandidate.valueReason}</p></section>
            <section><h3>内容摘要</h3><p>{selectedCandidate.content}</p></section>
            {selectedCandidate.similarities.length ? <section className="ai-topic-similarities"><h3>重复判断</h3>{selectedCandidate.similarities.map((match) => <article key={`${match.kind}:${match.targetId}`}><CircleAlert size={13} /><span><b>{similarityLabels[match.kind]}</b><small>{match.targetTitle}</small></span></article>)}</section> : null}
            {selectedCandidate.riskNotes.length ? <section><h3>需要留意</h3><ul>{selectedCandidate.riskNotes.map((risk) => <li key={risk}>{risk}</li>)}</ul></section> : null}
            <details className="ai-topic-sources"><summary>查看原始来源<ChevronDown size={13} /></summary>{selectedCandidate.sourceRefs.map((reference) => <blockquote key={`${reference.sourceId}:${reference.messageId}:${reference.quote}`}><p>{reference.quote}</p><cite>{reference.sourceTitle ?? (reference.sourceId.startsWith('claude:') ? 'Claude会话' : 'Codex任务')}·{readableDate(reference.sourceUpdatedAt)}</cite></blockquote>)}</details>
            <footer>
              {selectedCandidate.status === 'review_pending' ? <>
                <button className="primary-action" disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'confirm' })}><Check size={13} />确认进入选题管理</button>
                {selectedCandidate.similarities.find((match) => match.kind === 'existing_topic') ? <button className="secondary-action" disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'append_topic', topicId: selectedCandidate.similarities.find((match) => match.kind === 'existing_topic')!.targetId })}>补充到已有选题</button> : null}
                {selectedCandidate.similarities.find((match) => match.kind === 'active_project') ? <button className="secondary-action" disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'append_project', projectId: selectedCandidate.similarities.find((match) => match.kind === 'active_project')!.targetId })}>补充到正在制作项目</button> : null}
                <button className="secondary-action" disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'park' })}>暂时搁置</button>
                <details><summary>其他处理</summary><button disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'mark_done' })}>这是已做过的</button><button disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'discard' })}>弃用此方向</button></details>
              </> : selectedCandidate.status === 'confirmed' ? <button className="primary-action" onClick={() => selectedCandidate.destinationKind === 'project' && selectedCandidate.destinationId ? navigate({ page: 'project', projectId: selectedCandidate.destinationId, moduleKey: 'overview' }) : navigate({ page: 'topics' })}><ExternalLink size={13} />{selectedCandidate.destinationKind === 'project' ? '打开项目' : '打开选题管理'}</button>
                : selectedCandidate.status === 'parked' ? <button className="primary-action" disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'restore' })}><RefreshCw size={13} />重新打开</button>
                  : selectedCandidate.status === 'discarded' ? <><button className="primary-action" disabled={busy !== null} onClick={() => void decide(selectedCandidate, { action: 'restore' })}><RefreshCw size={13} />恢复到待处理</button><button className="danger-action" disabled={busy !== null} onClick={() => void deletePermanently(selectedCandidate)}><Trash2 size={13} />永久删除</button></> : null}
            </footer>
          </> : <div className="ai-topic-empty"><Inbox size={22} /><b>选择一条结果</b><span>这里查看完整来源、相似判断和处理动作。</span></div>}
        </aside>
      </div>
    </section>

    <details className="legacy-content-engine-disclosure"><summary>手动粘贴（兼容入口）</summary><LegacyContentEngine /></details>
  </main>
}
