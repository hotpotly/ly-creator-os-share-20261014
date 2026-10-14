import { formatEstimatedMinutes, summarizeTodoEstimates } from '../../../shared/todo-duration'
import { stagePlanBaselineLabel } from '../../../shared/stage-review'
import { TodoEstimateSummary } from './TodoEstimateSummary'
import { AppSelect } from './AppSelect'
import { BarChart3, Bot, CalendarCheck2, ChevronLeft, ChevronRight, Clock3, ExternalLink, MessageCircle, RefreshCw, RotateCcw, Send, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CreationReportConversation,
  CreationReportKind,
  CreationReportPublishedProject,
  CreationReportSnapshot,
  CreationReportSnapshotSummary,
  ProjectCreationReview,
  ProviderCapability,
  StageTimeRecord,
  StageTimeKey,
  StageTimePoint,
  StageTimeUpdateResult,
  TaskRun
} from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { navigate, replaceRoute, type AppRoute } from '../utils/router'
import { ProjectEffortChart } from './reports/ProjectEffortChart'
import { ProjectPlanActualTimeline } from './reports/ProjectPlanActualTimeline'
import { ProjectStageMatrix } from './reports/ProjectStageMatrix'
import { ProjectVarianceChart } from './reports/ProjectVarianceChart'
import { StageDurationEffortChart } from './reports/StageDurationEffortChart'
import { StageTimeEditor } from './ProjectTimeline'
import { ProjectPlatformSummary } from './ProjectPlatformControl'

const segmentLabels: Record<StageTimePoint['segment'], string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
type ReportProvider = 'codex_cli' | 'claude_cli'
const providerLabels: Record<ReportProvider, string> = { codex_cli: 'Codex', claude_cli: 'Claude' }
const REPORT_PROVIDER = 'codex_cli' as const

function shiftAnchor(anchor: string, kind: CreationReportKind, direction: -1 | 1): string {
  const date = new Date(`${anchor}T00:00:00.000Z`)
  if (kind === 'weekly') date.setUTCDate(date.getUTCDate() + direction * 7)
  else date.setUTCMonth(date.getUTCMonth() + direction, 1)
  return date.toISOString().slice(0, 10)
}

function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatPoint(point: StageTimePoint | null): string {
  return point ? `${Number(point.localDate.slice(5, 7))}月${Number(point.localDate.slice(8, 10))}日${segmentLabels[point.segment]}` : '—'
}

function formatEffort(units: number): string {
  const days = units / 2
  return `${Number.isInteger(days) ? days.toFixed(0) : days}天`
}

function formatDeltaDuration(segments: number): string {
  const days = Math.round((Math.abs(segments) / 3) * 2) / 2
  return `${Number.isInteger(days) ? days.toFixed(0) : days}天`
}

function varianceLabel(value: number | null, state: ProjectCreationReview['stages'][number]['varianceState']): string {
  if (state === 'no_schedule') return '无排期样本'
  if (state === 'not_due') return '未到期'
  if (value === null) return '—'
  if (value === 0) return '按期'
  return `${value < 0 ? '提前' : '延迟'}${formatDeltaDuration(value)}`
}

function pointsEqual(left: StageTimePoint | null, right: StageTimePoint | null): boolean {
  return Boolean(left && right && left.localDate === right.localDate && left.segment === right.segment)
}

function planLabel(start: StageTimePoint | null, end: StageTimePoint | null): string {
  if (!start) return '—'
  if (!end || pointsEqual(start, end)) return `截止：${formatPoint(end ?? start)}`
  return `窗口：${formatPoint(start)}—${formatPoint(end)}`
}

function variancePresentation(value: number | null, state: ProjectCreationReview['stages'][number]['varianceState']): { label: string; title?: string } {
  if (state === 'no_schedule') return { label: '—', title: '未设置排期，无法计算偏差' }
  if (state === 'not_due') return { label: '—', title: '排期尚未到期，暂不计算偏差' }
  if (value === null) return { label: '—', title: '没有可比较的计划与实际时间' }
  return { label: state === 'overdue_open' ? `仍逾期${formatDeltaDuration(value)}` : varianceLabel(value, state) }
}

function projectReviewAnomalies(review: ProjectCreationReview): Array<{ stageKey: StageTimeKey; message: string; severe: boolean }> {
  return review.stages.flatMap<{ stageKey: StageTimeKey; message: string; severe: boolean }>((stage) => {
    if (stage.status === 'not_started' || stage.status === 'skipped') return []
    if (stage.varianceState === 'overdue_open') return [{ stageKey: stage.stageKey, message: '已超过排期仍未完成', severe: true }]
    if (!stage.startedAt) return [{ stageKey: stage.stageKey, message: '开始时间未记录，无法计算历时与开始偏差', severe: false }]
    if (stage.status === 'completed' && !stage.completedAt) return [{ stageKey: stage.stageKey, message: '完成时间未记录，无法计算历时与完成偏差', severe: false }]
    return []
  })
}

function stageRecordForEditor(projectId: string, stage: {
  stageKey: StageTimeKey
  status?: StageTimeRecord['status']
  stateAtCutoff?: StageTimeRecord['status']
  startedAt: StageTimePoint | null
  completedAt: StageTimePoint | null
  actualEffortHalfDayUnits: number | null
  plannedStartAt: StageTimePoint | null
  plannedEndAt: StageTimePoint | null
  durationSegments: number | null
}): StageTimeRecord {
  return {
    id: `report:${projectId}:${stage.stageKey}`,
    projectId,
    stageKey: stage.stageKey,
    status: stage.status ?? stage.stateAtCutoff ?? 'not_started',
    startedAt: stage.startedAt,
    completedAt: stage.completedAt,
    startSource: null,
    completionSource: null,
    actualEffortHalfDayUnits: stage.actualEffortHalfDayUnits,
    plannedStartedAt: stage.plannedStartAt,
    plannedCompletedAt: stage.plannedEndAt,
    estimatedDurationHalfDayUnits: null,
    planManualFields: [],
    planAutoField: null,
    autoStartActionId: null,
    durationSegments: stage.durationSegments,
    durationLabel: null,
    createdAt: '',
    updatedAt: ''
  }
}

export function ReportsPage({ route }: { route: AppRoute }): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh)
  const today = snapshot.today
  const mode = route.reportMode ?? 'period'
  const kind = route.reportKind ?? 'weekly'
  const anchorDate = route.anchorDate ?? today
  const [report, setReport] = useState<CreationReportSnapshot | null>(null)
  const [reportHistory, setReportHistory] = useState<CreationReportSnapshotSummary[]>([])
  const [review, setReview] = useState<ProjectCreationReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conversation, setConversation] = useState<CreationReportConversation | null>(null)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversationError, setConversationError] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [periodSubview, setPeriodSubview] = useState<'overview' | 'published'>('overview')
  const [stageEditor, setStageEditor] = useState<{ anchor: HTMLElement; record: StageTimeRecord; initialView?: 'root' | 'effort' } | null>(null)

  useEffect(() => setPeriodSubview('overview'), [anchorDate, kind, route.snapshotId])

  const goPeriod = (overrides: Partial<AppRoute> = {}): void => navigate({
    page: 'reports',
    reportMode: 'period',
    reportKind: kind,
    anchorDate,
    ...overrides
  })
  const goProject = (projectId: string, focusedStageKey?: StageTimeKey, source: 'period' | 'project' = 'period'): void => navigate({
    page: 'reports',
    reportMode: 'project',
    reportKind: kind,
    anchorDate,
    snapshotId: report?.id,
    projectId,
    focusedStageKey,
    source
  })

  const loadPeriod = useCallback(async (force = false): Promise<void> => {
    if (!window.creatorOS) { setError('当前环境无法读取创作报表'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const next = route.snapshotId && !force
        ? await window.creatorOS.getCreationReportSnapshotById(route.snapshotId)
        : await window.creatorOS.getCreationReport(kind, anchorDate, force)
      setReport(next)
      setReportHistory(await window.creatorOS.listCreationReportSnapshots(next.kind, next.periodStart))
      if (route.snapshotId !== next.id) {
        replaceRoute({
          page: 'reports',
          reportMode: 'period',
          reportKind: next.kind,
          anchorDate,
          snapshotId: next.id
        })
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创作报表生成失败') }
    finally { setLoading(false) }
  }, [anchorDate, kind, route.snapshotId])

  const loadReview = useCallback(async (): Promise<void> => {
    const projectId = route.projectId ?? snapshot.projects.find((project) => !project.trashedAt)?.id
    if (!window.creatorOS || !projectId) { setError('还没有可以复盘的项目'); setLoading(false); return }
    setLoading(true); setError('')
    try { setReview(await window.creatorOS.getProjectCreationReview(projectId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '项目复盘读取失败') }
    finally { setLoading(false) }
  }, [route.projectId, snapshot.projects])

  const saveStageTime = async (
    patch: {
      startedAt?: StageTimePoint | null
      completedAt?: StageTimePoint | null
      actualEffortHalfDayUnits?: number | null
      planEdit?: Parameters<NonNullable<typeof window.creatorOS>['updateStageTime']>[2]['planEdit']
      source: 'manual' | 'backfill'
    },
    requestId: string
  ): Promise<StageTimeUpdateResult> => {
    if (!window.creatorOS || !stageEditor) throw new Error('当前无法修改阶段时间')
    const result = await window.creatorOS.updateStageTime(stageEditor.record.projectId, stageEditor.record.stageKey, patch, requestId)
    await refreshWorkspace()
    if (mode === 'period') await loadPeriod(true)
    else await loadReview()
    return result
  }

  useEffect(() => {
    if (mode === 'period') void loadPeriod()
    else void loadReview()
  }, [loadPeriod, loadReview, mode])

  const reportTaskSignature = snapshot.tasks.filter((task) => task.taskType === 'report_discussion').map((task) => `${task.id}:${task.status}`).join('|')
  useEffect(() => {
    if (mode !== 'period' || !report || !window.creatorOS) { setConversation(null); return }
    let active = true
    setConversationLoading(true); setConversationError('')
    void window.creatorOS.getCreationReportConversation(report.id).then((value) => { if (active) setConversation(value) })
      .catch((reason) => { if (active) setConversationError(reason instanceof Error ? reason.message : '报表对话读取失败') })
      .finally(() => { if (active) setConversationLoading(false) })
    return () => { active = false }
  }, [mode, report, reportTaskSignature])

  const selectedCapability = snapshot.providerCapabilities.find((item) => item.provider === REPORT_PROVIDER)
  const taskById = useMemo(() => new Map(snapshot.tasks.map((task) => [task.id, task])), [snapshot.tasks])
  const hasPendingReply = conversation?.messages.some((item) => item.role === 'user' && item.taskId && ['queued', 'running'].includes(taskById.get(item.taskId)?.status ?? '')) ?? false

  const verifyProvider = async (): Promise<void> => {
    if (!window.creatorOS || verifying) return
    setVerifying(true); setConversationError('')
    try {
      const capability = await window.creatorOS.validateProviderSecurity(REPORT_PROVIDER)
      await refreshWorkspace()
      if (!capability.available) throw new Error(capability.detail || 'Codex安全验证未通过')
    }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : 'Provider安全验证失败') }
    finally { setVerifying(false) }
  }
  const sendMessage = async (): Promise<void> => {
    const content = message.trim()
    if (!window.creatorOS || !report || !content || sending || hasPendingReply) return
    setSending(true); setConversationError('')
    try {
      if (!selectedCapability?.available) {
        if (selectedCapability?.status === 'not_installed') throw new Error('本机未检测到Codex，请先安装或重新登录Codex')
        setVerifying(true)
        const capability = await window.creatorOS.validateProviderSecurity(REPORT_PROVIDER)
        await refreshWorkspace()
        setVerifying(false)
        if (!capability.available) throw new Error(capability.detail || 'Codex安全验证未通过')
      }
      await window.creatorOS.sendCreationReportMessage(report.id, REPORT_PROVIDER, content)
      setMessage('')
      setConversation(await window.creatorOS.getCreationReportConversation(report.id))
    } catch (reason) { setConversationError(reason instanceof Error ? reason.message : '报表问题发送失败') }
    finally { setSending(false); setVerifying(false) }
  }
  const retryTask = async (task: TaskRun): Promise<void> => {
    if (!window.creatorOS || sending) return
    setSending(true); setConversationError('')
    try { await window.creatorOS.retryTask(task.id) }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '重试失败') }
    finally { setSending(false) }
  }

  const modeSwitch = <div className="segmented report-mode-switch" aria-label="报表模式">
    <button className={mode === 'period' ? 'active' : ''} onClick={() => goPeriod({ snapshotId: report?.id })}>周期总览</button>
    <button
      className={mode === 'project' ? 'active' : ''}
      disabled={!route.projectId && !snapshot.projects.some((project) => !project.trashedAt)}
      onClick={() => {
        const projectId = route.projectId ?? snapshot.projects.find((project) => !project.trashedAt)?.id
        if (projectId) goProject(projectId, undefined, 'period')
      }}
    >项目复盘</button>
  </div>

  return <main className="page reports-page">
    <header className="page-header reports-page-header">
      <div><h1>{mode === 'period' && periodSubview === 'published' ? '发布详情' : '创作报表'}</h1><p>{mode === 'period' ? periodSubview === 'published' ? '按内容方向查看本期具体发布与制作表现。' : '看跨项目瓶颈、排期偏差和记录覆盖。' : '看单个项目从开始到发布的真实时间与投入。'}</p></div>
      {modeSwitch}
      {mode === 'period' ? <button className="secondary-action" disabled={loading} onClick={() => void loadPeriod(true)}><RefreshCw size={14} className={loading ? 'is-spinning' : ''} />重新生成</button> : null}
    </header>

    {mode === 'period' ? <section className="report-toolbar card" aria-label="报表时间范围">
      <div className="segmented" aria-label="报表类型">
        <button className={kind === 'weekly' ? 'active' : ''} onClick={() => goPeriod({ reportKind: 'weekly', anchorDate: today, snapshotId: undefined })}>周报</button>
        <button className={kind === 'monthly' ? 'active' : ''} onClick={() => goPeriod({ reportKind: 'monthly', anchorDate: today, snapshotId: undefined })}>月报</button>
      </div>
      <div className="report-period-controls">
        <button aria-label={`上一${kind === 'weekly' ? '周' : '月'}`} onClick={() => goPeriod({ anchorDate: shiftAnchor(anchorDate, kind, -1), snapshotId: undefined })}><ChevronLeft size={15} /></button>
        <button className="report-current-period" onClick={() => goPeriod({ anchorDate: today, snapshotId: undefined })}>{report?.payload.period.label ?? '正在读取…'}</button>
        <button aria-label={`下一${kind === 'weekly' ? '周' : '月'}`} disabled={Boolean(report?.payload.period.endDate && report.payload.period.endDate >= today)} onClick={() => goPeriod({ anchorDate: shiftAnchor(anchorDate, kind, 1), snapshotId: undefined })}><ChevronRight size={15} /></button>
      </div>
      {reportHistory.length > 1 ? <label className="report-snapshot-picker"><span>历史快照</span><AppSelect value={report?.id ?? ''} onChange={(event) => goPeriod({ snapshotId: event.currentTarget.value })}>{reportHistory.map((item) => <option key={item.id} value={item.id}>{formatGeneratedAt(item.generatedAt)} · v{item.version}</option>)}</AppSelect></label> : null}
      <span className="report-generated-at">{report ? `${formatGeneratedAt(report.generatedAt)}生成并保存` : ''}</span>
    </section> : <ProjectReviewToolbar review={review} route={route} kind={kind} anchorDate={anchorDate} />}

    {error ? <section className="report-error card" role="alert"><TriangleAlert size={18} /><div><b>报表暂时无法读取</b><span>{error}</span></div><button onClick={() => mode === 'period' ? void loadPeriod() : void loadReview()}>重试</button></section> : null}
    {loading && !(mode === 'period' ? report : review) ? <section className="report-loading card" aria-live="polite"><RefreshCw className="is-spinning" size={18} /><span>正在汇总阶段时间与排期…</span></section> : null}
    {mode === 'period' && report ? periodSubview === 'published'
      ? <PublishedDetail report={report} onBack={() => setPeriodSubview('overview')} onOpenProject={goProject} />
      : <PeriodReportContent
        report={report}
        onOpenPublished={() => setPeriodSubview('published')}
        onOpenProject={goProject}
        onEditStage={(projectId, stageKey, anchor) => {
          const project = report.payload.version === 2 ? report.payload.periodProjects.find((item) => item.projectId === projectId) : null
          const stage = project?.stages.find((item) => item.stageKey === stageKey)
          if (stage) setStageEditor({ anchor, record: stageRecordForEditor(projectId, stage) })
        }}
        onFocusStage={(stageKey) => document.getElementById(`report-stage-${stageKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      /> : null}
    {mode === 'project' && review ? <ProjectReviewContent
      review={review}
      focusedStageKey={route.focusedStageKey}
      onEditStage={(stageKey, anchor, initialView) => {
        const stage = review.stages.find((item) => item.stageKey === stageKey)
        if (stage) setStageEditor({ anchor, record: stageRecordForEditor(review.projectId, stage), initialView })
      }}
    /> : null}
    {mode === 'period' && report && periodSubview === 'overview' ? <section className="report-section report-conversation card" aria-label="和AI讨论本期报表">
      <header className="card-header report-conversation-header"><div><h2><MessageCircle size={17} />和AI讨论本期报表</h2><span className="report-section-note">对话固定引用这份{formatGeneratedAt(report.generatedAt)}生成的快照</span></div><span className="report-provider-cloud-note"><ShieldCheck size={14} />本机CLI调用，内容仍会发送到Codex云端</span></header>
      <div className="report-provider-row" aria-label="报表对话使用Codex">
        <div className="report-provider-fixed"><b>Codex</b><small>{providerCapabilityLabel(selectedCapability)}</small></div>
        {selectedCapability && !selectedCapability.available && selectedCapability.status !== 'not_installed' ? <button className="report-provider-verify" disabled={verifying || hasPendingReply} onClick={() => void verifyProvider()}>{verifying ? '启用中…' : '启用Codex'}</button> : null}
      </div>
      <div className="report-chat-history" aria-live="polite">
        {conversationLoading && !conversation?.messages.length ? <div className="report-chat-empty"><RefreshCw size={17} className="is-spinning" />正在读取对话…</div> : conversation?.messages.length ? conversation.messages.map((item) => {
          const task = item.taskId ? taskById.get(item.taskId) : undefined
          return <article className={`report-chat-message ${item.role}`} key={item.id}><span className="report-chat-avatar">{item.role === 'assistant' ? <Bot size={15} /> : '我'}</span><div><header><b>{item.role === 'assistant' ? providerLabels[item.provider] : '我'}</b><small>{formatGeneratedAt(item.createdAt)}</small></header><p>{item.content}</p>{item.role === 'user' && task && ['queued', 'running'].includes(task.status) ? <span className="report-chat-task"><RefreshCw size={12} className="is-spinning" />正在分析</span> : null}{item.role === 'user' && task?.status === 'failed' ? <span className="report-chat-task failed"><TriangleAlert size={12} />{task.errorMessage ?? '回答失败'}<button disabled={sending} onClick={() => void retryTask(task)}><RotateCcw size={12} />重试</button></span> : null}</div></article>
        }) : <div className="report-chat-empty"><MessageCircle size={19} /><b>这份报表还没有对话</b><span>可以问「哪个阶段最拖延？」或「下周最值得改什么？」。</span></div>}
      </div>
      {conversationError ? <div className="report-chat-error" role="alert"><TriangleAlert size={14} />{conversationError}</div> : null}
      <div className="report-chat-composer"><textarea aria-label="报表对话问题" value={message} maxLength={4_000} rows={3} placeholder={selectedCapability?.status === 'not_installed' ? '本机未检测到Codex' : '问问这期数据，例如：我最应该先优化哪个阶段？第一次发送会自动完成安全检查。'} disabled={selectedCapability?.status === 'not_installed' || sending || verifying || hasPendingReply} onChange={(event) => setMessage(event.currentTarget.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void sendMessage() } }} /><button className="primary-action" disabled={!message.trim() || selectedCapability?.status === 'not_installed' || sending || verifying || hasPendingReply} onClick={() => void sendMessage()}><Send size={14} />{verifying ? '启用中' : '发送'}</button><small>⌘Enter发送 · 使用Codex · 仅保存到当前报表快照</small></div>
    </section> : null}
    <StageTimeEditor anchor={stageEditor?.anchor ?? null} record={stageEditor?.record ?? null} initialView={stageEditor?.initialView} onClose={() => setStageEditor(null)} onSave={saveStageTime} />
  </main>
}

function PeriodReportContent({
  report,
  onOpenPublished,
  onOpenProject,
  onEditStage,
  onFocusStage
}: {
  report: CreationReportSnapshot
  onOpenPublished(): void
  onOpenProject(projectId: string, stageKey?: StageTimeKey): void
  onEditStage(projectId: string, stageKey: StageTimeKey, anchor: HTMLElement): void
  onFocusStage(stageKey: StageTimeKey): void
}): React.JSX.Element {
  const payload = report.payload
  const comparison = payload.comparison
  const publishTrend = comparison.publishedCountDelta === 0 ? `与${payload.period.comparisonLabel}持平` : `比${payload.period.comparisonLabel}${comparison.publishedCountDelta > 0 ? '多' : '少'}${Math.abs(comparison.publishedCountDelta)}条`
  const slowest = [...payload.stageSummaries].filter((stage) => stage.averageDurationSegments !== null).sort((a, b) => b.averageDurationSegments! - a.averageDurationSegments!)[0]
  const delayed = [...payload.stageSummaries].sort((a, b) => (b.delayedCompletedCount + b.openOverdueCount) - (a.delayedCompletedCount + a.openOverdueCount))[0]
  return <>
    <section className="report-metrics" aria-label="本期摘要">
      <button className="report-metric report-metric-link card" onClick={onOpenPublished} aria-label={`查看本期${payload.publishedCount}条发布详情`}><span className="report-metric-icon"><CalendarCheck2 size={17} /></span><div><small>发布条数</small><b>{payload.publishedCount}<em>条</em></b><span>{publishTrend} · 查看具体内容</span></div><ChevronRight size={15} /></button>
      <article className="report-metric card"><span className="report-metric-icon"><Clock3 size={17} /></span><div><small>单条平均制作历时</small><b>{payload.averageProjectDurationLabel ?? '—'}</b><span>{payload.projectDurationSampleCount}/{payload.publishedCount}条有完整起止</span></div></article>
      <article className="report-metric card"><span className="report-metric-icon warning"><TriangleAlert size={17} /></span><div><small>延迟与逾期</small><b>{payload.delayedCompletedCount + payload.openOverdueCount}<em>个阶段</em></b><span>比较快照生成时的当前排期</span></div></article>
      <article className="report-metric card"><span className="report-metric-icon"><BarChart3 size={17} /></span><div><small>时间记录覆盖</small><b>{payload.durationStageSampleCount}<em>/{payload.completedStageCount}</em></b><span>{payload.actualEffortStageSampleCount}个阶段有选填投入记录</span></div></article>
    </section>
    <section className="report-insights card"><span>本期最耗时：<b>{slowest ? projectModuleLabels[slowest.stageKey] : '样本不足'}</b></span><span>最常拖延：<b>{delayed && delayed.delayedCompletedCount + delayed.openOverdueCount ? projectModuleLabels[delayed.stageKey] : '样本不足'}</b></span><span>记录最缺失：<b>{payload.durationStageSampleCount < payload.completedStageCount ? '阶段起止（选填）' : '暂无明显缺口'}</b></span></section>
    {payload.version === 1 ? <section className="report-legacy-notice card"><TriangleAlert size={16} /><span>这份历史快照没有项目阶段明细；AI对话仍引用原快照。重新生成可使用当前口径。</span></section> : <>
      <ReportChartCard title="项目 × 阶段" note="点击阶段即可直接补记时间或投入。"><ProjectStageMatrix projects={payload.periodProjects} onOpenProject={onOpenProject} onEditStage={onEditStage} /></ReportChartCard>
      <div className="report-chart-pair">
        <ReportChartCard title="阶段历时与实际投入" note="历时含等待；投入只统计手动填写。"><StageDurationEffortChart stages={payload.stageSummaries} onFocus={onFocusStage} /></ReportChartCard>
        <ReportChartCard title="项目排期偏差" note="基于生成快照时的当前排期；原计划对比请进入项目复盘。"><ProjectVarianceChart projects={payload.periodProjects} onOpen={onOpenProject} /></ReportChartCard>
      </div>
      <section className="report-section report-projects card">
        <header className="card-header"><h2>本期项目</h2><span className="count-badge">{payload.periodProjects.length}</span></header>
        {payload.periodProjects.map((project) => <button className="report-project-row" key={project.projectId} onClick={() => onOpenProject(project.projectId)}>
          <span className="project-dot" style={{ background: `var(--${project.colorToken})` }} />
          <span><b>{project.title}</b><small>{project.actualStageKeys.length ? `实际推进：${project.actualStageKeys.map((key) => projectModuleLabels[key]).join('、')}` : `仅有计划：${project.scheduledStageKeys.map((key) => projectModuleLabels[key]).join('、')}`}</small></span>
          <span><small>项目累计历时</small><b>{project.lifecycleDurationSegments === null ? '—' : formatDeltaDuration(project.lifecycleDurationSegments)}</b></span>
          <span><small>累计实际投入</small><b>{project.summaryActualEffortStageCount ? formatEffort(project.summaryActualEffortHalfDayUnits) : '—'}</b></span>
          <span className={project.delayedStageCount || project.openOverdueCount ? 'report-delay' : ''}>{project.openOverdueCount
            ? `${project.openOverdueCount}个仍逾期`
            : project.delayedStageCount
              ? `${project.delayedStageCount}个晚完成`
              : project.stages.some((stage) => stage.varianceInPeriod && stage.varianceState === 'not_due')
                ? '有未到期排期'
                : project.stages.some((stage) => stage.varianceInPeriod)
                  ? '无已知拖延'
                  : '无本期排期'}</span>
        </button>)}
      </section>
    </>}
    <section className="report-section card">
      <header className="card-header"><h2>各阶段精确数据</h2><span className="report-section-note">图表和表格读取同一份快照</span></header>
      <div className="report-stage-table" role="table">
        <div className="report-stage-row report-stage-head" role="row"><span>阶段</span><span>本期完成</span><span>平均历时</span><span>平均实际投入</span><span>排期拖延</span><span>较{payload.period.comparisonLabel}</span></div>
        {payload.stageSummaries.map((stage) => <div className="report-stage-row" id={`report-stage-${stage.stageKey}`} role="row" key={stage.stageKey}>
          <b>{projectModuleLabels[stage.stageKey]}</b><span>{stage.completedCount || '—'}</span><span>{stage.averageDurationLabel ?? '—'}<small>{stage.durationSampleCount}个样本</small></span><span>{stage.averageActualEffortHalfDayUnits === null ? '—' : formatEffort(stage.averageActualEffortHalfDayUnits)}<small>{stage.actualEffortSampleCount}次填写</small></span><span className={stage.delayedCompletedCount || stage.openOverdueCount ? 'report-delay' : ''}>{stage.delayedCompletedCount || stage.openOverdueCount ? `${stage.delayedCompletedCount}晚完成 · ${stage.openOverdueCount}仍逾期` : stage.notDueSampleCount ? `${stage.notDueSampleCount}未到期` : stage.scheduledSampleCount ? '无拖延' : '无排期样本'}</span><span>{stage.durationDeltaSegments === null ? '—' : stage.durationDeltaSegments === 0 ? '持平' : `${stage.durationDeltaSegments < 0 ? '快' : '慢'}${formatDeltaDuration(stage.durationDeltaSegments)}`}</span>
        </div>)}
      </div>
    </section>
    {payload.version === 2 ? <section className="report-section card">
      <header className="card-header"><h2>各项目阶段总计</h2><span className="report-section-note">每个项目、每个阶段分别统计；点击进入对应阶段</span></header>
      <div className="report-project-stage-table" role="table">
        <div className="report-project-stage-row head" role="row"><span>项目</span><span>阶段</span><span>阶段状态</span><span>阶段总历时</span><span>实际投入</span><span>排期日历</span><span>偏差</span></div>
        {payload.periodProjects.flatMap((project) => project.stages.map((stage) => <button role="row" key={`${project.projectId}:${stage.stageKey}`} onClick={(event) => onEditStage(project.projectId, stage.stageKey, event.currentTarget)}>
          <span><i style={{ background: `var(--${project.colorToken})` }} />{project.title}</span>
          <b>{projectModuleLabels[stage.stageKey]}</b>
          <span>{stage.stateAtCutoff === 'completed' ? '已完成' : stage.stateAtCutoff === 'in_progress' ? '进行中' : stage.stateAtCutoff === 'skipped' ? '已跳过' : '未开始'}</span>
          <span>{stage.durationSegments === null ? stage.elapsedSegments === null ? '—' : `已过${formatDeltaDuration(stage.elapsedSegments)}` : formatDeltaDuration(stage.durationSegments)}</span>
          <span>{stage.actualEffortHalfDayUnits === null ? '—' : formatEffort(stage.actualEffortHalfDayUnits)}</span>
          <span>{stage.plannedStartAt ? planLabel(stage.plannedStartAt, stage.plannedEndAt) : '未排期'}</span>
          <span title={variancePresentation(stage.varianceSegments, stage.varianceState).title} className={stage.varianceState === 'overdue_open' || stage.varianceState === 'late_completed' ? 'report-delay' : stage.varianceState === 'early' ? 'report-improved' : ''}>{variancePresentation(stage.varianceSegments, stage.varianceState).label}</span>
        </button>))}
      </div>
    </section> : null}
  </>
}

function PublishedDetail({
  report,
  onBack,
  onOpenProject
}: {
  report: CreationReportSnapshot
  onBack(): void
  onOpenProject(projectId: string): void
}): React.JSX.Element {
  const projects = report.payload.publishedProjects
  const groups = useMemo(() => {
    const grouped = new Map<string, CreationReportPublishedProject[]>()
    projects.forEach((project) => {
      const key = project.contentTypeName || '未分类'
      grouped.set(key, [...(grouped.get(key) ?? []), project])
    })
    return [...grouped.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
  }, [projects])
  const effort = projects.reduce((sum, project) => sum + project.actualEffortHalfDayUnits, 0)
  const effortProjects = projects.filter((project) => project.actualEffortStageCount > 0)
  const durationSamples = projects.flatMap((project) => project.projectDurationSegments === null ? [] : [project.projectDurationSegments])
  const averageDuration = durationSamples.length ? Math.round(durationSamples.reduce((sum, value) => sum + value, 0) / durationSamples.length) : null
  const platforms = new Set(projects.flatMap((project) => project.platformTargets))
  const delayed = projects.filter((project) => project.delayedStageCount > 0).length
  return <section className="published-detail">
    <header className="published-detail-header">
      <button onClick={onBack}><ChevronLeft size={15} />返回周期总览</button>
      <div><b>{report.payload.period.label}</b><span>这里只统计发布阶段在本期完成的内容</span></div>
    </header>
    <section className="report-metrics published-detail-metrics" aria-label="发布详情摘要">
      <article className="report-metric card"><div><small>本期发布</small><b>{projects.length}<em>条</em></b><span>{groups.length}个内容方向</span></div></article>
      <article className="report-metric card"><div><small>平均制作历时</small><b>{averageDuration === null ? '—' : formatDeltaDuration(averageDuration)}</b><span>{durationSamples.length}/{projects.length}条有完整起止</span></div></article>
      <article className="report-metric card"><div><small>实际投入合计</small><b>{effortProjects.length ? formatEffort(effort) : '—'}</b><span>{effortProjects.length ? `${effortProjects.length}/${projects.length}条有投入记录` : '未记录（选填）'}</span></div></article>
      <article className="report-metric card"><div><small>发布平台覆盖</small><b>{platforms.size}<em>个平台</em></b><span>{delayed ? `${delayed}条存在晚完成阶段` : '暂无已知晚完成阶段'}</span></div></article>
    </section>
    <section className="report-section card published-direction-board">
      <header className="card-header"><h2>内容方向分布</h2><span className="report-section-note">按本期发布条数排序</span></header>
      <div>{groups.map(([name, items]) => {
        const groupEffort = items.reduce((sum, item) => sum + item.actualEffortHalfDayUnits, 0)
        const groupEffortProjects = items.filter((item) => item.actualEffortStageCount > 0)
        return <article key={name}><header><b>{name}</b><span>{items.length}条 · {projects.length ? Math.round(items.length / projects.length * 100) : 0}%</span></header><div><i style={{ width: `${projects.length ? items.length / projects.length * 100 : 0}%` }} /></div><small>{groupEffortProjects.length ? `实际投入${formatEffort(groupEffort)}（${groupEffortProjects.length}/${items.length}条有记录）` : '手动投入未记录（选填）'} · 发布平台{new Set(items.flatMap((item) => item.platformTargets)).size}个</small></article>
      })}</div>
    </section>
    <section className="report-section card published-project-list">
      <header className="card-header"><h2>具体发布</h2><span className="report-section-note">点击进入项目复盘</span></header>
      {groups.map(([name, items]) => <section key={name}><header><b>{name}</b><span>{items.length}条</span></header>{items.map((project) => <button key={project.projectId} onClick={() => onOpenProject(project.projectId)}>
        <i style={{ background: `var(--${project.colorToken})` }} />
        <span><b>{project.title}</b><small>{project.platformTargets.length ? <ProjectPlatformSummary platforms={project.platformTargets} /> : '发布平台未设置'}</small></span>
        <span><small>发布于</small><b>{formatPoint(project.publishedAt)}</b></span>
        <span><small>制作历时</small><b>{project.projectDurationLabel ?? '—'}</b></span>
        <span><small>实际投入</small><b>{project.actualEffortStageCount > 0 ? formatEffort(project.actualEffortHalfDayUnits) : '—'}</b></span>
        <span className={project.delayedStageCount ? 'report-delay' : 'report-improved'}>{project.delayedStageCount ? `${project.delayedStageCount}个阶段晚完成` : '无已知晚完成阶段'}</span>
        <ChevronRight size={14} />
      </button>)}</section>)}
      {!projects.length ? <div className="report-chart-empty">这个周期还没有完成发布的内容。</div> : null}
    </section>
  </section>
}

function ProjectReviewToolbar({ review, route, kind, anchorDate }: { review: ProjectCreationReview | null; route: AppRoute; kind: CreationReportKind; anchorDate: string }): React.JSX.Element {
  const allProjects = useWorkspaceStore((state) => state.snapshot.projects)
  const projects = useMemo(() => allProjects.filter((project) => !project.trashedAt), [allProjects])
  return <section className="report-toolbar report-project-toolbar card">
    <label><span>项目</span><AppSelect value={review?.projectId ?? route.projectId ?? ''} onChange={(event) => navigate({ page: 'reports', reportMode: 'project', reportKind: kind, anchorDate, snapshotId: route.snapshotId, projectId: event.currentTarget.value, source: route.source })}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect></label>
    {route.source === 'period' ? <button onClick={() => navigate({ page: 'reports', reportMode: 'period', reportKind: kind, anchorDate, snapshotId: route.snapshotId })}><ChevronLeft size={14} />返回周期总览</button> : null}
    {review ? <button className="secondary-action" onClick={() => navigate({ page: 'project', projectId: review.projectId, moduleKey: 'overview' })}>{route.source === 'project' ? <><ChevronLeft size={13} />返回项目</> : <>打开项目<ExternalLink size={13} /></>}</button> : null}
  </section>
}

function ProjectReviewContent({ review, focusedStageKey, onEditStage }: { review: ProjectCreationReview; focusedStageKey?: StageTimeKey; onEditStage(stageKey: StageTimeKey, anchor: HTMLElement, initialView?: 'root' | 'effort'): void }): React.JSX.Element {
  const todos = useWorkspaceStore(state => state.snapshot.todos).filter(todo => todo.projectId === review.projectId && todo.source === 'manual' && todo.status !== 'dismissed')
  const estimates = summarizeTodoEstimates(todos)
  const lifecycleLabel = review.lifecycleDurationSegments === null ? '—' : formatDeltaDuration(review.lifecycleDurationSegments)
  const variance = review.largestAbsoluteVarianceSegments
  const anomalies = projectReviewAnomalies(review)
  useEffect(() => {
    if (focusedStageKey) document.getElementById(`project-review-stage-${focusedStageKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedStageKey])
  return <>
    <section className="report-metrics project-review-metrics">
      <article className="report-metric card"><div><small>项目总历时</small><b>{lifecycleLabel}</b><span>{review.lifecycleEndKind === 'archived_without_publish' ? '没有确定发布终点' : review.lifecycleOngoing ? '仍在进行中' : review.lifecycleEndKind === 'missing_start' ? '缺少开始记录' : '截止发布完成'}</span></div></article>
      <article className="report-metric card"><div><small>已完成条目预计</small><b>{estimates.completedMinutes === null ? '—' : formatEstimatedMinutes(estimates.completedMinutes)}</b><span>{estimates.completedFilledCount}/{estimates.completedCount}条已完成待办有时长 · 非实际工时</span></div></article>
      <article className="report-metric card"><div><small>当前排期最大完成偏差</small><b>{variance === null ? '—' : varianceLabel(variance, variance < 0 ? 'early' : variance > 0 ? 'late_completed' : 'on_time')}</b><span>{review.largestAbsoluteVarianceStageKey ? projectModuleLabels[review.largestAbsoluteVarianceStageKey] : '无排期样本'}</span></div></article>
      <article className="report-metric card"><div><small>时间记录覆盖</small><b>{review.completeTimeSampleCount}<em>/{review.completedStageCount}</em></b><span>已完成阶段：{review.completeTimeSampleCount}/{review.completedStageCount}有完整起止</span></div></article>
    </section>
    <ReportChartCard title="阶段待办预计" note="括号时长合计，非实际工时；历史可能混用，重复事项需核对。">
      <div className="report-stage-estimates"><section><b>项目合计</b><TodoEstimateSummary todos={todos} /></section>{review.stages.map(stage => {
        const linked = todos.filter(todo => todo.stageKey === stage.stageKey)
        return linked.length ? <section key={stage.stageKey}><b>{projectModuleLabels[stage.stageKey]}</b><TodoEstimateSummary todos={linked} /></section> : null
      })}{todos.some(todo => !todo.stageKey || !review.stages.some(stage => stage.stageKey === todo.stageKey)) ? <section><b>未指定或已隐藏阶段</b><TodoEstimateSummary todos={todos.filter(todo => !todo.stageKey || !review.stages.some(stage => stage.stageKey === todo.stageKey))} /></section> : null}{!todos.length ? <p className="todo-estimate-summary">尚无关联待办</p> : null}</div>
    </ReportChartCard>
    <ReportChartCard title="计划与实际时间线" note="原计划保留首次保存的排期；旧记录仅保留接入时计划。实际历时包含等待。"><ProjectPlanActualTimeline review={review} onOpen={onEditStage} onOpenSchedule={() => navigate({ page: 'schedule', projectId: review.projectId })} /></ReportChartCard>
    <StagePlanComparisons review={review} />
    <div className="report-chart-pair project-review-pair">
      <details className="report-section card report-optional-effort"><summary>手动实际投入（选填）{review.summaryActualEffortStageCount ? ` · 已记录${formatEffort(review.summaryActualEffortHalfDayUnits)}` : ' · 无记录'}</summary><p className="report-section-note">独立保留旧记录，不与待办预计相加；不填写也可复盘。</p><ProjectEffortChart review={review} onOpen={(stageKey, anchor) => onEditStage(stageKey, anchor, 'effort')} /></details>
      <section className="report-section card project-review-gaps"><header className="card-header"><h2>数据缺口与异常</h2><span className="report-section-note">只检查已开始或已完成阶段</span></header>{anomalies.length ? <ul>{anomalies.slice(0, 8).map((item) => <li className={item.severe ? 'severe' : ''} key={item.stageKey}><b>{projectModuleLabels[item.stageKey]}</b><span>{item.message}</span></li>)}</ul> : <div className="project-review-gaps-empty">目前没有明显异常</div>}</section>
    </div>
    <section className="report-section card">
      <header className="card-header"><h2>阶段明细</h2><span className="report-section-note">点击一行直接补记时间或投入</span></header>
      <div className="project-review-table" role="table">
        <div className="project-review-row head"><span>阶段</span><span>状态</span><span>排期日历</span><span>开始于</span><span>完成于</span><span>历时</span><span>完成项预计</span><span>当前完成偏差</span></div>
        {review.stages.map((stage) => <button className={focusedStageKey === stage.stageKey ? 'focused' : ''} id={`project-review-stage-${stage.stageKey}`} key={stage.stageKey} onClick={(event) => onEditStage(stage.stageKey, event.currentTarget)}>
          <b>{projectModuleLabels[stage.stageKey]}{!stage.enabled ? <small>已停用历史阶段</small> : null}</b><span>{stage.status === 'completed' ? '已完成' : stage.status === 'in_progress' ? '进行中' : stage.status === 'skipped' ? '已跳过' : '未开始'}</span><span title={planLabel(stage.plannedStartAt, stage.plannedEndAt)}>{planLabel(stage.plannedStartAt, stage.plannedEndAt)}</span><span>{formatPoint(stage.startedAt)}</span><span>{formatPoint(stage.completedAt)}</span><span>{stage.durationSegments === null ? stage.elapsedSegments === null ? '—' : `已过${formatDeltaDuration(stage.elapsedSegments)}` : formatDeltaDuration(stage.durationSegments)}</span><span>{formatEstimatedMinutes(summarizeTodoEstimates(todos.filter(todo => todo.stageKey === stage.stageKey)).completedMinutes)}</span><span title={variancePresentation(stage.varianceSegments, stage.varianceState).title}>{variancePresentation(stage.varianceSegments, stage.varianceState).label}</span>
        </button>)}
      </div>
    </section>
  </>
}

function startVarianceLabel(value: number | null): string {
  return value === null ? '—' : value === 0 ? '按计划开始' : `${value < 0 ? '提前' : '延迟'}${formatDeltaDuration(value)}`
}

function StagePlanComparisons({ review }: { review: ProjectCreationReview }): React.JSX.Element {
  return <ReportChartCard title="阶段起止偏差" note="分别比较开始与完成；缺少日期或只有截止点时，不推算开始偏差。">
    <div className="report-plan-comparisons">{review.stages.filter(stage => stage.baseline || stage.plannedStartAt || stage.startedAt || stage.completedAt).map(stage => <section key={stage.stageKey} aria-label={`${projectModuleLabels[stage.stageKey]}起止偏差`}>
      <b>{projectModuleLabels[stage.stageKey]}</b>
      {stage.baseline ? <div><span>{stagePlanBaselineLabel(stage.baseline.source)}</span><span>开始：{startVarianceLabel(stage.baseline.startVarianceSegments)}</span><span>完成：{variancePresentation(stage.baseline.varianceSegments, stage.baseline.varianceState).label}</span></div> : <div><span>原计划未设置</span></div>}
      <div><span>当前排期</span><span>开始：{startVarianceLabel(stage.startVarianceSegments)}</span><span>完成：{variancePresentation(stage.varianceSegments, stage.varianceState).label}</span></div>
    </section>)}</div>
    {!review.stages.some(stage => stage.baseline || stage.plannedStartAt || stage.startedAt || stage.completedAt) ? <p className="report-chart-empty">尚无可比较的计划与实际日期。</p> : null}
  </ReportChartCard>
}

function ReportChartCard({ title, note, children }: { title: string; note: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="report-section report-chart-card card"><header className="card-header"><h2>{title}</h2><span className="report-section-note">{note}</span></header>{children}</section>
}

function providerCapabilityLabel(capability: ProviderCapability | undefined): string {
  if (!capability) return '正在检测'
  if (capability.available) return '安全验证已通过'
  if (capability.status === 'not_installed') return '本机未安装'
  if (capability.status === 'verifying') return '验证中'
  if (capability.status === 'verification_failed') return '验证失败'
  return '需要安全验证'
}
