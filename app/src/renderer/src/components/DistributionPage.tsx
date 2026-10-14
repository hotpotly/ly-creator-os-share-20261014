import { AppSelect } from './AppSelect'
import { Check, ChevronRight, ExternalLink, FileVideo2, FolderOpen, Plus, RefreshCw, Scissors, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILTIN_TEXT_PROVIDER_CONFIG_IDS,
  type DistributionBatch,
  type DistributionSegment,
  type ProviderSettings,
  type PublishingAccountState
} from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'

type SourceKind = DistributionBatch['sourceKind']

function SegmentEditor({
  batch,
  segment,
  accounts,
  analysisLocked,
  locked,
  onChange
}: {
  batch: DistributionBatch
  segment: DistributionSegment
  accounts: PublishingAccountState['accounts']
  analysisLocked: boolean
  locked: boolean
  onChange(batch: DistributionBatch): void
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => ({
    startTimecode: segment.startTimecode,
    endTimecode: segment.endTimecode,
    theme: segment.theme,
    summary: segment.summary
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setDraft({
    startTimecode: segment.startTimecode,
    endTimecode: segment.endTimecode,
    theme: segment.theme,
    summary: segment.summary
  }), [segment.endTimecode, segment.startTimecode, segment.summary, segment.theme])
  const editable = batch.status === 'draft' && !locked
  const save = async (): Promise<void> => {
    if (!window.creatorOS) return
    setSaving(true); setError('')
    try { onChange(await window.creatorOS.updateDistributionSegment({ batchId: batch.id, segmentId: segment.id, ...draft })) } catch (reason) {
      setError(reason instanceof Error ? reason.message : '片段保存失败')
    } finally { setSaving(false) }
  }
  const selected = new Set(segment.targets.map((target) => target.accountId))
  const toggleAccount = async (accountId: string): Promise<void> => {
    if (!window.creatorOS || !editable) return
    setSaving(true); setError('')
    try {
      const next = selected.has(accountId) ? [...selected].filter((id) => id !== accountId) : [...selected, accountId]
      onChange(await window.creatorOS.replaceDistributionTargets(batch.id, segment.id, next))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '平台保存失败') } finally { setSaving(false) }
  }
  const setTargetStatus = async (targetId: string, status: 'pending' | 'published' | 'skipped'): Promise<void> => {
    if (!window.creatorOS || !editable) return
    setSaving(true); setError('')
    try { onChange(await window.creatorOS.setDistributionTargetStatus(batch.id, targetId, status, '')) } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分发状态保存失败')
    } finally { setSaving(false) }
  }
  return <article className="distribution-segment">
    <header><span>{String(segment.position + 1).padStart(2, '0')}</span><div><input aria-label={`片段${segment.position + 1}主题`} disabled={!editable} value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.currentTarget.value })} /><small>参考时间码·以内容为准手动裁剪</small></div>{editable ? <button disabled={saving} onClick={() => void save()}>{saving ? '保存中' : '保存片段'}</button> : <em>{batch.status === 'completed' ? '已完成' : analysisLocked ? '分析中' : '处理中'}</em>}</header>
    <div className="distribution-timecodes"><label>开始<input disabled={!editable} value={draft.startTimecode} onChange={(event) => setDraft({ ...draft, startTimecode: event.currentTarget.value })} /></label><ChevronRight size={14} /><label>结束<input disabled={!editable} value={draft.endTimecode} onChange={(event) => setDraft({ ...draft, endTimecode: event.currentTarget.value })} /></label></div>
    <textarea aria-label={`片段${segment.position + 1}摘要`} disabled={!editable} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.currentTarget.value })} />
    <div className={`distribution-file${segment.fileAvailability && segment.fileAvailability !== 'available' ? ' missing' : ''}`}>
      <FileVideo2 size={16} /><span>{segment.fileName ?? '尚未关联本机短视频'}</span>
      {segment.fileId ? <><button onClick={() => void window.creatorOS?.openDistributionFile(batch.id, segment.id)}><ExternalLink size={13} />预览</button><button onClick={() => void window.creatorOS?.revealDistributionFile(batch.id, segment.id)}><FolderOpen size={13} />Finder</button>{editable ? <button onClick={() => void window.creatorOS?.linkDistributionFiles(batch.id, undefined, segment.id).then((next) => { if (next) onChange(next) })}>重新关联</button> : null}</> : null}
    </div>
    <section className="distribution-targets"><header><b>分发账号</b><span>B站不会出现在拆短分发中</span></header>{accounts.length ? <div className="distribution-account-pills">{accounts.map((account) => <button className={selected.has(account.id) ? 'selected' : ''} disabled={!editable || saving} key={account.id} onClick={() => void toggleAccount(account.id)}>{selected.has(account.id) ? <Check size={12} /> : null}{account.platform}·{account.accountName}</button>)}</div> : <p>还没有可用的非B站账号，请先到“设置→平台账号”添加。</p>}
      {segment.targets.length ? <div className="distribution-target-statuses">{segment.targets.map((target) => <div key={target.id}><span>{target.platform}·{target.accountName}</span><div><button className={target.status === 'pending' ? 'active' : ''} disabled={!editable || saving} onClick={() => void setTargetStatus(target.id, 'pending')}>待发布</button><button className={target.status === 'published' ? 'active success' : ''} disabled={!editable || saving} onClick={() => void setTargetStatus(target.id, 'published')}>已发布</button><button className={target.status === 'skipped' ? 'active' : ''} disabled={!editable || saving} onClick={() => void setTargetStatus(target.id, 'skipped')}>跳过</button></div></div>)}</div> : null}
    </section>
    {error ? <p className="form-error">{error}</p> : null}
  </article>
}

export function DistributionPage(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.snapshot)
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh)
  const projects = useMemo(() => workspace.projects.filter((project) => !project.trashedAt && project.topicStageRole === 'project_created'), [workspace.projects])
  const [batches, setBatches] = useState<DistributionBatch[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [accountState, setAccountState] = useState<PublishingAccountState | null>(null)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null)
  const [providerConfigId, setProviderConfigId] = useState<string>(BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex)
  const [creating, setCreating] = useState(false)
  const [sourceKind, setSourceKind] = useState<SourceKind>('project_final')
  const [sourceProjectId, setSourceProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmComplete, setConfirmComplete] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async (preferredId?: string): Promise<void> => {
    if (!window.creatorOS) return
    const next = await window.creatorOS.listDistributionBatches()
    setBatches(next)
    setSelectedId((current) => preferredId ?? (current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null))
  }, [])
  useEffect(() => {
    if (!window.creatorOS) return
    void Promise.all([
      refresh(),
      window.creatorOS.getPublishingAccountState(null).then(setAccountState),
      window.creatorOS.getProviderSettings().then((settings) => { setProviderSettings(settings); setProviderConfigId(settings.defaultProviderConfigId) })
    ]).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '批量分发加载失败'))
  }, [refresh])
  const selected = batches.find((batch) => batch.id === selectedId) ?? null
  const activeTask = selected?.analysisTaskId ? workspace.tasks.find((task) => task.id === selected.analysisTaskId) : null
  const activeTaskStatus = activeTask?.status
  const activeTaskFinishedAt = activeTask?.finishedAt
  const analysisLocked = activeTaskStatus === 'queued' || activeTaskStatus === 'running'
  const interactionLocked = analysisLocked || busy
  useEffect(() => {
    if (!activeTaskStatus || !['succeeded', 'failed'].includes(activeTaskStatus)) return
    void refresh(selected?.id)
  }, [activeTaskFinishedAt, activeTaskStatus, refresh, selected?.id])

  const providers = useMemo(() => {
    const capabilities = new Map(workspace.providerCapabilities.map((item) => [item.provider, item]))
    return [
      { id: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, label: 'Codex', available: Boolean(capabilities.get('codex_cli')?.available) },
      { id: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude, label: 'Claude', available: Boolean(capabilities.get('claude_cli')?.available) },
      ...(providerSettings?.configs ?? []).map((config) => ({ id: config.id, label: config.displayName, available: config.status === 'available' }))
    ]
  }, [providerSettings?.configs, workspace.providerCapabilities])
  const accounts = useMemo(() => (accountState?.accounts ?? []).filter((account) => account.status === 'active' && account.platform !== 'B站'), [accountState])
  const selectedProviderAvailable = providers.find((provider) => provider.id === providerConfigId)?.available === true
  const applyBatch = (batch: DistributionBatch): void => {
    setBatches((current) => current.map((item) => item.id === batch.id ? batch : item))
    setSelectedId(batch.id)
  }
  const create = async (): Promise<void> => {
    if (!window.creatorOS) return
    setBusy(true); setError('')
    try {
      const project = projects.find((item) => item.id === sourceProjectId)
      const batch = await window.creatorOS.createDistributionBatch({
        title: title.trim() || (sourceKind === 'project_final' ? `${project?.title ?? '项目'}·拆短分发` : '新的分发批次'),
        sourceKind,
        sourceProjectId: sourceKind === 'project_final' ? sourceProjectId : null,
        sourceText: sourceKind === 'project_final' ? '' : sourceText
      })
      setCreating(false); setTitle(''); setSourceText('')
      await refresh(batch.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批次创建失败') } finally { setBusy(false) }
  }
  const analyze = async (): Promise<void> => {
    if (!selected || !window.creatorOS) return
    setBusy(true); setError('')
    try {
      await window.creatorOS.startDistributionAnalysis(selected.id, providerConfigId)
      await refreshWorkspace()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI分析启动失败') } finally { setBusy(false) }
  }
  const linkFiles = async (files?: File[]): Promise<void> => {
    if (!selected || !window.creatorOS || interactionLocked) return
    setBusy(true); setError('')
    try {
      const batch = await window.creatorOS.linkDistributionFiles(selected.id, files)
      if (batch) applyBatch(batch)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '文件关联失败') } finally { setBusy(false) }
  }
  const complete = async (force = false): Promise<void> => {
    if (!selected || !window.creatorOS) return
    setBusy(true); setError('')
    try {
      const result = await window.creatorOS.completeDistributionBatch(selected.id, force)
      if (result.requiresConfirmation) { setConfirmComplete(result.pendingTargetCount); return }
      setConfirmComplete(null); applyBatch(result.batch)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批次完成失败') } finally { setBusy(false) }
  }

  return <main className="page distribution-page">
    <header className="page-header"><div><span>创作工具</span><h1>批量分发</h1><p>AI只给出参考时间码和主题；你按内容手动裁剪，短视频始终留在电脑本地。</p></div><button className="primary-action" onClick={() => setCreating(true)}><Plus size={14} />新建批次</button></header>
    {error ? <p className="form-error distribution-page-error">{error}</p> : null}
    <div className="distribution-layout">
      <aside className="content-card distribution-batch-list"><header><b>分发批次</b><span>{batches.length}个</span></header>{batches.length ? batches.map((batch) => <button className={batch.id === selectedId ? 'active' : ''} key={batch.id} onClick={() => setSelectedId(batch.id)}><span>{batch.title}</span><small>{batch.status === 'completed' ? '已完成' : batch.segments.length ? `${batch.segments.length}个片段` : '等待分析'}</small></button>) : <div><Scissors size={20} /><p>还没有分发批次</p></div>}</aside>
      <section className="distribution-main">
        {selected ? <><section className="content-card distribution-summary"><header><div><span>{selected.sourceProjectTitle ? `来自项目·${selected.sourceProjectTitle}` : selected.sourceKind === 'subtitle' ? '来自字幕' : '手动文案'}</span><h2>{selected.title}</h2></div><div>{selected.status === 'completed' ? <button onClick={() => void window.creatorOS?.reopenDistributionBatch(selected.id).then(applyBatch)}><RefreshCw size={13} />重新打开</button> : <button className="primary-action" disabled={busy || activeTask?.status === 'running' || activeTask?.status === 'queued'} onClick={() => void complete()}>{selected.segments.flatMap((segment) => segment.targets).length ? '完成批次' : '手动完成'}</button>}</div></header>
          <ol><li className="done">来源内容</li><li className={selected.segments.length ? 'done' : 'active'}>片段方案</li><li className={selected.segments.some((segment) => segment.fileId) ? 'done' : ''}>关联文件</li><li className={selected.status === 'completed' ? 'done' : ''}>平台分发</li></ol>
          <div className="distribution-analysis-row"><label>分析AI<AppSelect value={providerConfigId} onChange={(event) => setProviderConfigId(event.currentTarget.value)}>{providers.map((provider) => <option disabled={!provider.available} key={provider.id} value={provider.id}>{provider.label}{provider.available ? '' : '·不可用'}</option>)}</AppSelect></label><button disabled={busy || !selectedProviderAvailable || activeTask?.status === 'running' || activeTask?.status === 'queued'} onClick={() => void analyze()}>{activeTask?.status === 'running' ? `分析中${activeTask.progress}%` : activeTask?.status === 'queued' ? '等待分析' : selected.segments.length ? '重新分析片段' : 'AI分析片段'}</button><small>{selectedProviderAvailable ? '重新分析会替换现有片段方案与关联。' : '先在设置中验证一个可用AI；也可以手动新增片段。'}</small></div>
        </section>
        {selected.segments.length ? <><section className="distribution-link-bar" onDragOver={(event) => { if (!interactionLocked) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (!interactionLocked) void linkFiles([...event.dataTransfer.files]) }}><UploadCloud size={17} /><span>{analysisLocked ? 'AI正在重新分析，完成前暂时锁定当前片段。' : '按文件名自然顺序自动匹配尚未关联的片段；只建立外部链接，不复制视频。'}</span><input className="visually-hidden" disabled={interactionLocked} ref={fileInputRef} type="file" accept="video/*,.mkv,.webm" multiple onChange={(event) => { void linkFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = '' }} /><button disabled={interactionLocked || selected.status === 'completed'} onClick={() => fileInputRef.current?.click()}>选择多个短视频</button><button disabled={interactionLocked || selected.status === 'completed'} onClick={() => void linkFiles()}>从Finder选择</button></section><div className="distribution-segments">{selected.segments.map((segment) => <SegmentEditor accounts={accounts} analysisLocked={analysisLocked} batch={selected} locked={interactionLocked} segment={segment} key={segment.id} onChange={applyBatch} />)}{selected.status === 'draft' ? <button className="distribution-add-segment" disabled={interactionLocked} onClick={() => void window.creatorOS?.createDistributionSegment(selected.id).then(applyBatch)}><Plus size={14} />新增片段</button> : null}</div></> : <section className="content-card distribution-empty"><Scissors size={24} /><h2>{analysisLocked ? 'AI正在分析片段' : '先让AI给出片段方案'}</h2><p>结果只包含参考开始／结束时间码和每段主题，不会自动剪视频。</p><button disabled={interactionLocked} onClick={() => void window.creatorOS?.createDistributionSegment(selected.id).then(applyBatch)}><Plus size={14} />手动新增片段</button></section>}</> : <section className="content-card distribution-empty"><FileVideo2 size={24} /><h2>选择或新建一个批次</h2></section>}
      </section>
    </div>
    {creating ? <div className="modal-backdrop"><section className="distribution-create-dialog" role="dialog" aria-modal="true" aria-label="新建分发批次"><header><div><span>来源内容</span><h2>新建分发批次</h2></div><button onClick={() => setCreating(false)}>×</button></header><div><label>来源<AppSelect value={sourceKind} onChange={(event) => setSourceKind(event.currentTarget.value as SourceKind)}><option value="project_final">项目定稿</option><option value="manual_script">粘贴文案</option><option value="subtitle">粘贴SRT字幕</option></AppSelect></label>{sourceKind === 'project_final' ? <label>项目<AppSelect value={sourceProjectId} onChange={(event) => { setSourceProjectId(event.currentTarget.value); const project = projects.find((item) => item.id === event.currentTarget.value); if (!title && project) setTitle(`${project.title}·拆短分发`) }}><option value="">选择有定稿的项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect></label> : <label className="wide">来源内容<textarea autoFocus value={sourceText} onChange={(event) => setSourceText(event.currentTarget.value)} placeholder={sourceKind === 'subtitle' ? '粘贴SRT字幕，AI会优先沿用真实时间码' : '粘贴完整文案'} /></label>}<label className="wide">批次名称<input value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="例如：AI浏览器长视频拆短" /></label></div><footer><button onClick={() => setCreating(false)}>取消</button><button className="primary-action" disabled={busy || (sourceKind === 'project_final' ? !sourceProjectId : !sourceText.trim())} onClick={() => void create()}>{busy ? '正在创建' : '创建批次'}</button></footer></section></div> : null}
    {confirmComplete !== null ? <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="确认完成分发批次"><h2>仍有{confirmComplete || '未设置'}项未完成</h2><p>{confirmComplete ? `还有${confirmComplete}个平台账号处于“待发布”。` : '这个批次还没有设置任何分发账号。'}仍然可以手动完成，之后也能重新打开。</p><footer><button onClick={() => setConfirmComplete(null)}>继续处理</button><button className="primary-action" onClick={() => void complete(true)}>仍然完成</button></footer></section></div> : null}
  </main>
}
