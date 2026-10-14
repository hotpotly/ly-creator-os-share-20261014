import { AlertTriangle, Check, CheckCircle2, PencilLine, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  ScriptMaterialCheck,
  ScriptMaterialCheckTarget,
  ScriptMaterialWorkspace,
  TaskRun
} from '../../../shared/domain'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../../shared/domain'
import { AnchoredPopover } from './AnchoredPopover'

interface Props {
  workspace: ScriptMaterialWorkspace
  target: ScriptMaterialCheckTarget
  targetIdentity: string
  contentHash: string | null
  contextStale?: boolean
  readOnlySnapshot?: boolean
  currentContent?: string
  currentParagraphs?: Array<{ id: string; position: number; text: string }>
  tasks: TaskRun[]
  onWorkspaceChange(workspace: ScriptMaterialWorkspace): void
  onNotice(message: string): void
  onEditFinding?(paragraphId: string): void
  onDeleteFinding?(paragraphId: string): void
  onFinalizeRequested?(): Promise<void>
}

type EffectiveState = 'unchecked' | 'checking' | 'ready' | 'stale' | 'failed'

function creatorOS(): NonNullable<typeof window.creatorOS> {
  if (!window.creatorOS) throw new Error('素材检查服务尚未就绪')
  return window.creatorOS
}

function effectiveState(check: ScriptMaterialCheck | null, contentHash: string | null): EffectiveState {
  if (!check) return 'unchecked'
  if (!contentHash || check.targetContentHash !== contentHash) return 'stale'
  return check.state
}

function stateLabel(state: EffectiveState, current: boolean): string {
  if (state === 'checking') return '检查中'
  if (state === 'ready') return '已检查'
  if (state === 'stale') return '检查已过期'
  if (state === 'failed') return '检查失败'
  return current ? '检查当前文案' : '检查这篇AI稿'
}

export function ScriptMaterialAuditControl({
  workspace,
  target,
  targetIdentity,
  contentHash,
  contextStale = false,
  readOnlySnapshot = false,
  currentContent,
  currentParagraphs,
  tasks,
  onWorkspaceChange,
  onNotice,
  onEditFinding,
  onDeleteFinding,
  onFinalizeRequested
}: Props): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [evidenceFindingId, setEvidenceFindingId] = useState<string | null>(null)
  const [evidenceNote, setEvidenceNote] = useState('')
  const check = workspace.checks.find((item) => item.targetIdentity === targetIdentity) ?? null
  const state = contextStale ? 'stale' : effectiveState(check, contentHash)
  const current = target === 'current'
  const checkingTask = check?.taskId ? tasks.find((task) => task.id === check.taskId) : null
  const missingCoverage = useMemo(() => (check?.pointCoverage ?? []).filter((coverage) => (
    coverage.status === 'missing' || coverage.status === 'partial'
  )), [check?.pointCoverage])
  const unresolvedFindings = useMemo(() => (check?.paragraphFindings ?? []).filter((finding) => (
    finding.provenance === 'needs_confirmation' && finding.status !== 'confirmed'
  )), [check?.paragraphFindings])
  const allowed = new Set(check?.allowedOmissionPointIds ?? [])
  const unallowedCoverage = missingCoverage.filter((coverage) => !allowed.has(coverage.pointId))
  const completedCount = (check?.pointCoverage ?? []).filter((coverage) => (
    coverage.status === 'complete' || coverage.status === 'excluded'
  )).length

  const refreshWorkspace = async (): Promise<void> => {
    onWorkspaceChange(await creatorOS().getScriptMaterialWorkspace(workspace.projectId))
  }

  const startAudit = async (): Promise<void> => {
    if (busy || state === 'checking') return
    if (readOnlySnapshot) {
      onNotice('这是历史版本的冻结检查；请先保存或恢复为新的当前版本，再更新检查。')
      return
    }
    if (current && !currentContent?.trim()) {
      onNotice('当前文案为空，暂时无法检查。')
      return
    }
    setBusy(true)
    try {
      await creatorOS().startScriptMaterialAudit(
        workspace.projectId,
        target,
        BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
        current ? currentContent : undefined,
        current ? undefined : targetIdentity,
        current ? currentParagraphs : undefined
      )
      await refreshWorkspace()
      onNotice(current ? '已开始检查当前文案；你可以继续编辑，结果不会覆盖变化后的正文。' : '已开始独立检查这篇AI稿。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '检查未能启动')
    } finally {
      setBusy(false)
    }
  }

  const setAllowedPointIds = async (pointIds: string[]): Promise<ScriptMaterialWorkspace | null> => {
    if (readOnlySnapshot) return null
    setBusy(true)
    try {
      const next = await creatorOS().setScriptMaterialAllowedOmissions(workspace.projectId, targetIdentity, pointIds)
      onWorkspaceChange(next)
      return next
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '本次遗漏状态保存失败')
      return null
    } finally {
      setBusy(false)
    }
  }

  const confirmEvidence = async (findingId: string): Promise<void> => {
    if (readOnlySnapshot || !evidenceNote.trim()) return
    setBusy(true)
    try {
      const next = await creatorOS().confirmScriptMaterialFinding(
        workspace.projectId,
        targetIdentity,
        findingId,
        evidenceNote
      )
      onWorkspaceChange(next)
      setEvidenceFindingId(null)
      setEvidenceNote('')
      onNotice('这条补充的确认依据已记录到本次检查。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '确认依据保存失败')
    } finally {
      setBusy(false)
    }
  }

  const cancelAudit = async (): Promise<void> => {
    if (readOnlySnapshot || busy || !check?.taskId) return
    setBusy(true)
    try {
      await creatorOS().cancelTask(check.taskId)
      await refreshWorkspace()
      onNotice('检查已取消；旧结果不会被当作最新检查。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '检查取消失败')
    } finally {
      setBusy(false)
    }
  }

  const retryAudit = async (): Promise<void> => {
    if (readOnlySnapshot || busy || !check?.taskId) return
    setBusy(true)
    try {
      await creatorOS().retryTask(check.taskId)
      await refreshWorkspace()
      onNotice('已按原冻结输入重新检查。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '检查重试失败')
    } finally {
      setBusy(false)
    }
  }

  const allowAllAndMaybeFinalize = async (): Promise<void> => {
    const nextIds = [...new Set([...(check?.allowedOmissionPointIds ?? []), ...missingCoverage.map((item) => item.pointId)])]
    const next = await setAllowedPointIds(nextIds)
    if (!next || unresolvedFindings.length || !onFinalizeRequested) {
      if (unresolvedFindings.length) onNotice(`普通遗漏已全部允许；还有${unresolvedFindings.length}条待确认补充必须逐条处理。`)
      return
    }
    await onFinalizeRequested()
  }

  const buttonIcon = state === 'ready'
    ? <CheckCircle2 size={12} />
    : state === 'failed'
      ? <AlertTriangle size={12} />
      : state === 'checking'
        ? <RefreshCw size={12} />
        : <ShieldCheck size={12} />

  return <div className={`script-material-audit-control state-${state}`}>
    <button
      className="script-material-audit-trigger"
      aria-label={`${current ? '当前文案' : 'AI稿'}素材覆盖检查：${stateLabel(state, current)}`}
      aria-expanded={Boolean(anchor)}
      onClick={(event) => setAnchor((value) => value ? null : event.currentTarget)}
    >
      {buttonIcon}<span>{stateLabel(state, current)}</span>
      {state === 'ready' && unallowedCoverage.length ? <em>{unallowedCoverage.length}</em> : null}
    </button>
    {anchor ? <AnchoredPopover
      anchor={anchor}
      ariaLabel={`${current ? '当前文案' : 'AI稿'}素材覆盖检查`}
      className="script-material-audit-popover"
      role="dialog"
      onDismiss={() => setAnchor(null)}
    >
      <header>
        <div><span>{current ? '定稿前检查' : 'AI稿独立检查'}</span><b>{stateLabel(state, current)}</b></div>
        <button aria-label="关闭素材检查" onClick={() => setAnchor(null)}><X size={13} /></button>
      </header>
      {state === 'checking' ? <div className="script-material-audit-state"><RefreshCw size={16} /><b>正在核对素材覆盖和新增事实</b><span>{checkingTask?.progress ? `${checkingTask.progress}%` : '可以继续编辑；正文变化后本次结果会显示为过期。'}</span>{!readOnlySnapshot && check?.taskId ? <button disabled={busy} onClick={() => void cancelAudit()}>取消检查</button> : null}</div> : null}
      {state === 'stale' ? <div className="script-material-audit-state warning"><AlertTriangle size={16} /><b>正文或检查依据已经变化</b><span>旧结果仍保留，但不能用于定稿。只有你点击更新才会再次调用AI。</span></div> : null}
      {state === 'failed' ? <div className="script-material-audit-state failed"><AlertTriangle size={16} /><b>上次检查没有完成</b><span>{check?.errorMessage ?? checkingTask?.errorMessage ?? '可以手动重新检查。'}</span>{!readOnlySnapshot && check?.taskId ? <button disabled={busy} onClick={() => void retryAudit()}>按原输入重试</button> : null}</div> : null}
      {state === 'unchecked' ? <div className="script-material-audit-state"><ShieldCheck size={16} /><b>还没有独立检查</b><span>首次对应不等于检查通过；检查只会在你明确点击后运行。</span></div> : null}
      {state === 'ready' && check ? <div className="script-material-audit-results">
        <div className="script-material-audit-summary">
          <span><Check size={12} />{completedCount}项已处理</span>
          <span className={unallowedCoverage.length ? 'warning' : ''}>{unallowedCoverage.length}项待补入或允许遗漏</span>
          <span className={unresolvedFindings.length ? 'danger' : ''}>{unresolvedFindings.length}条待确认</span>
        </div>
        {missingCoverage.length ? <section>
          <header><div><b>普通遗漏</b><small>只对本次版本有效，不改变原素材状态</small></div></header>
          <div className="script-material-audit-list">{missingCoverage.map((coverage) => {
            const point = workspace.points.find((item) => item.id === coverage.pointId)
            const isAllowed = allowed.has(coverage.pointId)
            return <article key={coverage.pointId} className={isAllowed ? 'resolved' : ''}>
              <div><span>{coverage.status === 'partial' ? '部分覆盖' : '未覆盖'}</span><b>{point?.summary || point?.sourceText || coverage.pointId}</b><small>{coverage.rationale}</small></div>
              {!readOnlySnapshot ? <button disabled={busy} onClick={() => void setAllowedPointIds(isAllowed
                ? [...allowed].filter((id) => id !== coverage.pointId)
                : [...allowed, coverage.pointId]
              )}>{isAllowed ? '取消允许' : '本次允许遗漏'}</button> : <em>{isAllowed ? '当时已允许' : '当时未处理'}</em>}
            </article>
          })}</div>
        </section> : null}
        {check.paragraphFindings.some((finding) => finding.provenance === 'needs_confirmation') ? <section className="script-material-audit-findings">
          <header><div><b>待确认补充</b><small>不能和普通遗漏一起批量跳过</small></div></header>
          <div className="script-material-audit-list">{check.paragraphFindings
            .filter((finding) => finding.provenance === 'needs_confirmation')
            .map((finding) => <article key={finding.id} className={finding.status === 'confirmed' ? 'resolved' : ''}>
              <div><span>{finding.status === 'confirmed' ? '已确认依据' : '需要你判断'}</span><b>{finding.note || '这段包含原稿无法直接支持的内容'}</b>{finding.resolutionNote ? <small>依据：{finding.resolutionNote}</small> : null}</div>
              {finding.status === 'confirmed' ? <CheckCircle2 size={15} /> : readOnlySnapshot ? <em>当时未处理</em> : evidenceFindingId === finding.id ? <div className="script-material-evidence-form">
                <textarea autoFocus value={evidenceNote} placeholder="写明依据，例如：来自我的实测记录第3条" onChange={(event) => setEvidenceNote(event.currentTarget.value)} />
                <footer><button onClick={() => { setEvidenceFindingId(null); setEvidenceNote('') }}>取消</button><button className="primary-action" disabled={!evidenceNote.trim() || busy} onClick={() => void confirmEvidence(finding.id)}>确认</button></footer>
              </div> : <div className="script-material-finding-actions">
                <button onClick={() => { setEvidenceFindingId(finding.id); setEvidenceNote('') }}>确认依据</button>
                {onEditFinding ? <button onClick={() => { onEditFinding(finding.paragraphId); setAnchor(null) }}><PencilLine size={11} />改写</button> : null}
                {onDeleteFinding ? <button onClick={() => { onDeleteFinding(finding.paragraphId); setAnchor(null) }}><Trash2 size={11} />删除</button> : null}
              </div>}
            </article>)}</div>
        </section> : null}
        <footer className="script-material-audit-footer">
          <span>{check.checkedAt ? `检查于${new Date(check.checkedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '检查时间未记录'}</span>
          {!readOnlySnapshot && current && missingCoverage.length ? <button disabled={busy} onClick={() => void allowAllAndMaybeFinalize()}>
            {unresolvedFindings.length ? '全部允许普通遗漏' : '本次全部允许遗漏并定稿'}
          </button> : !readOnlySnapshot && current && !unresolvedFindings.length && onFinalizeRequested ? <button className="primary-action" disabled={busy} onClick={() => void onFinalizeRequested()}>检查通过，定稿</button> : null}
        </footer>
      </div> : null}
      <footer className="script-material-audit-refresh">
        <span>{readOnlySnapshot ? '历史版本冻结记录·不会套到变化后的正文' : '不会在输入、保存或切换页面时自动运行'}</span>
        {readOnlySnapshot
          ? <em>恢复为当前版本后可处理</em>
          : <button disabled={busy || state === 'checking'} onClick={() => void startAudit()}><RefreshCw size={12} />{state === 'unchecked' ? '开始检查' : '更新检查'}</button>}
      </footer>
    </AnchoredPopover> : null}
  </div>
}
