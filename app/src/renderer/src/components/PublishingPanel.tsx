import { AppSelect } from './AppSelect'
import { AlertTriangle, Captions, Copy, Film, FolderOpen, Image as ImageIcon, ShieldCheck, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_PLATFORMS, PUBLISHING_PLATFORM_CAPABILITIES, platformTitleLimit, type ProjectDetail, type PublishingAccountState, type PublishingMaterial, type PublishingMaterialKind } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'

export function PublishingPanel({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  const tasks = useWorkspaceStore((state) => state.snapshot.tasks)
  const computerUseEnabled = useWorkspaceStore((state) => state.snapshot.preferences.computerUsePublishBilibili)
  const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
  const platforms = useMemo(() => [...new Set([...project.platformTargets, ...PROJECT_PLATFORMS])], [project.platformTargets])
  const definitions: Array<{ key: PublishingMaterialKind; label: string; required: boolean }> = [
    { key: 'title', label: '标题', required: true }, { key: 'description', label: '简介', required: true }, { key: 'cover', label: '封面', required: true },
    { key: 'tags', label: '标签', required: true }, { key: 'video', label: '视频', required: true }, { key: 'subtitle', label: '字幕', required: false }
  ]
  const [platform, setPlatform] = useState(platforms[0] ?? 'B站')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingTitles, setGeneratingTitles] = useState(false)
  const [titleInstruction, setTitleInstruction] = useState('')
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [accountState, setAccountState] = useState<PublishingAccountState | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const material = useCallback((targetPlatform: string, kind: PublishingMaterialKind): PublishingMaterial | undefined => project.publishingMaterials.find((item) => item.platform === targetPlatform && item.materialKind === kind), [project.publishingMaterials])
  const platformCapability = PUBLISHING_PLATFORM_CAPABILITIES.find((capability) => capability.platform === platform)
  const loadAccounts = useCallback(async (): Promise<void> => {
    if (window.creatorOS) setAccountState(await window.creatorOS.getPublishingAccountState(project.id))
  }, [project.id])
  useEffect(() => { void loadAccounts().catch(() => undefined) }, [loadAccounts])
  const status = (item: PublishingMaterial | undefined): 'missing' | 'unbased' | 'stale' | 'ready' => {
    if (!item || (!item.textValue?.trim() && !item.fileId)) return 'missing'
    if (!finalVersion || !item.sourceVersionId) return 'unbased'
    return item.sourceVersionId === finalVersion.id ? 'ready' : 'stale'
  }
  useEffect(() => {
    const available = platforms.includes(platform) ? platform : platforms[0] ?? 'B站'
    if (available !== platform) { setPlatform(available); return }
    const savedTitle = material(available, 'title')?.textValue ?? ''
    const savedDescription = material(available, 'description')?.textValue ?? ''
    const savedTags = material(available, 'tags')?.textValue ?? ''
    setTitle(savedTitle); setDescription(savedDescription); setTags(savedTags)
    setConfirmOpen(false)
    if (!finalVersion || !window.creatorOS || (savedTitle && savedDescription && savedTags)) return
    let active = true
    void window.creatorOS.preparePublishingDraft(project.id, available).then((draft) => {
      if (!active) return
      if (!savedTitle) setTitle(draft.title)
      if (!savedDescription) setDescription(draft.description)
      if (!savedTags) setTags(draft.tags.join(','))
    }).catch(() => undefined)
    return () => { active = false }
  }, [finalVersion, material, platform, platforms, project.id])
  const requiredReady = definitions.filter((item) => item.required && status(material(platform, item.key)) === 'ready').length
  const selectedAccountId = accountState?.selections.find((selection) => selection.platform === platform)?.accountId ?? ''
  const platformAccounts = accountState?.accounts.filter((account) => account.platform === platform && account.status === 'active') ?? []
  const masterTitleMaterial = material('主标题', 'title')
  const masterTitle = masterTitleMaterial?.textValue?.trim() ?? ''
  const masterCandidates = project.titleCandidates.filter((candidate) => candidate.platform === '主标题')
  const platformTitleCandidates = project.titleCandidates.filter((candidate) => candidate.platform === platform && candidate.masterTitleSnapshot === masterTitle)
  const limit = platformTitleLimit(platform)
  const masterNeedsAdaptation = Boolean(masterTitle && limit && [...masterTitle].length > limit)
  const generating = tasks.some((task) => task.projectId === project.id && task.taskType === 'title_generation' && ['queued', 'running'].includes(task.status))
  const latestHandoff = project.publishingHandoffs.find((handoff) => handoff.platform === platform) ?? null
  const latestPilot = latestHandoff ? project.publishingComputerUsePilots.find((pilot) => pilot.handoffId === latestHandoff.id) ?? null : null
  const latestHandoffFresh = Boolean(latestHandoff && finalVersion &&
    latestHandoff.packageSnapshot.sourceVersionId === finalVersion.id &&
    latestHandoff.packageSnapshot.accountId === selectedAccountId &&
    latestHandoff.packageSnapshot.title === (material(platform, 'title')?.textValue?.trim() ?? '') &&
    latestHandoff.packageSnapshot.description === (material(platform, 'description')?.textValue?.trim() ?? '') &&
    JSON.stringify(latestHandoff.packageSnapshot.tags) === JSON.stringify((material(platform, 'tags')?.textValue ?? '').split(/[,，#\n]+/).map((item) => item.trim()).filter(Boolean)) &&
    latestHandoff.packageSnapshot.coverFileId === (material(platform, 'cover')?.fileId ?? '') &&
    latestHandoff.packageSnapshot.subtitleFileId === (material(platform, 'subtitle')?.fileId ?? null) &&
    latestHandoff.packageSnapshot.videoFileId === (material(platform, 'video')?.fileId ?? ''))
  const pilotIsActive = Boolean(latestPilot && ['prepared', 'page_opened', 'ready_for_review'].includes(latestPilot.status))
  const run = async (action: () => Promise<void>, fallback: string, setter: (value: boolean) => void): Promise<void> => {
    setter(true)
    try { await action() } catch (reason) { onNotice(reason instanceof Error ? reason.message : fallback) } finally { setter(false) }
  }
  const saveText = (): Promise<void> => run(async () => {
    if (!window.creatorOS) return
    await Promise.all([
      window.creatorOS.savePublishingTextMaterial(project.id, platform, 'title', title),
      window.creatorOS.savePublishingTextMaterial(project.id, platform, 'description', description),
      window.creatorOS.savePublishingTextMaterial(project.id, platform, 'tags', tags)
    ])
    onNotice(`已保存${platform}发布信息；${finalVersion ? `关联定稿v${finalVersion.revision}` : '设置定稿后仍需更新一次'}`); onChanged()
  }, '发布信息保存失败', setSaving)
  const upload = (file: File, kind: 'cover' | 'subtitle'): Promise<void> => run(async () => {
    if (!window.creatorOS) return
    const maximum = kind === 'cover' ? 20 * 1024 * 1024 : 2 * 1024 * 1024
    if (file.size > maximum) throw new Error(kind === 'cover' ? '封面文件不能超过20MB' : '字幕文件不能超过2MB')
    await window.creatorOS.importPublishingFileMaterial(project.id, platform, kind, file.name, new Uint8Array(await file.arrayBuffer()))
    onNotice(`已加入${platform}${kind === 'cover' ? '封面' : '字幕'}：${file.name}`); onChanged()
  }, '发布物料导入失败', setSaving)
  const chooseVideo = (): Promise<void> => run(async () => {
    const selected = await window.creatorOS?.choosePublishingVideo(project.id, platform)
    if (!selected) return
    onNotice(`已关联${selected.fileName ?? '发布视频'}；App不会复制成片`); onChanged()
  }, '视频关联失败', setSaving)
  const revealMaterial = async (kind: 'cover' | 'subtitle' | 'video'): Promise<void> => {
    try { await window.creatorOS?.revealPublishingMaterial(project.id, platform, kind) }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '无法在Finder中显示文件') }
  }
  const selectAccount = async (accountId: string): Promise<void> => {
    if (!accountId) { onNotice('请先在设置中添加这个平台的账号'); return }
    try {
      setAccountState(await window.creatorOS!.selectPublishingAccount(project.id, platform, accountId))
      onNotice(`已选择${platform}发布账号`)
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '发布账号选择失败') }
  }
  const copyField = async (field: 'title' | 'description' | 'tags'): Promise<void> => {
    try {
      if (!latestHandoff || latestHandoff.status === 'failed' || !latestHandoffFresh) throw new Error('请重新检查发布包')
      await window.creatorOS?.copyPublishingHandoffField(latestHandoff.id, field)
      onNotice(`已复制${field === 'title' ? '标题' : field === 'description' ? '简介' : '标签'}`)
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '复制失败') }
  }
  const generateMasterTitles = (): Promise<void> => run(async () => {
    const created = await window.creatorOS?.startTitleGeneration(project.id, '主标题', { mode: 'master', instruction: titleInstruction })
    onNotice(`Codex与Claude将各生成10条主标题·${created?.length ?? 0}项后台任务`); onChanged()
  }, '标题任务启动失败', setGeneratingTitles)
  const adaptMasterTitle = (): Promise<void> => run(async () => {
    if (!window.creatorOS || !masterTitle) return
    if (!masterNeedsAdaptation) {
      const saved = await window.creatorOS.savePublishingTextMaterial(project.id, platform, 'title', masterTitle)
      setTitle(saved.textValue ?? masterTitle); onNotice(`主标题符合${platform}长度，已直接用于发布包`); onChanged(); return
    }
    const created = await window.creatorOS.startTitleGeneration(project.id, platform, { mode: 'platform_adaptation', masterTitle, instruction: titleInstruction })
    onNotice(`主标题超过${platform}${limit}字限制；Codex与Claude各生成2条短版·${created.length}项任务`); onChanged()
  }, '平台标题适配失败', setGeneratingTitles)
  const applyTitle = async (candidateId: string): Promise<void> => {
    try {
      const candidate = project.titleCandidates.find((item) => item.id === candidateId)
      const selected = await window.creatorOS?.selectTitleCandidate(project.id, candidateId)
      if (candidate?.platform !== '主标题') setTitle(selected?.textValue ?? '')
      onNotice(candidate?.platform === '主标题' ? '已确定主标题；现在可按平台直接沿用或生成短版' : `已选为${platform}标题`); onChanged()
    }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '标题选择失败') }
  }
  const prepareHandoff = (): Promise<void> => run(async () => {
    const handoff = await window.creatorOS?.preparePublishingHandoff(project.id, platform)
    if (handoff) onNotice(handoff.issues.length ? handoff.issues.join('·') : `${platform}发布包已通过本地预检`)
    setConfirmOpen(false); onChanged()
  }, '发布包预检失败', setHandoffBusy)
  const openHandoff = (): Promise<void> => run(async () => {
    if (!latestHandoff) return
    await window.creatorOS?.openPublishingHandoff(latestHandoff.id)
    onNotice(`已复制${platform}文案并打开官方发布页；App不会自动点击发布`); setConfirmOpen(false); onChanged()
  }, '平台发布页打开失败', setHandoffBusy)
  const confirmPublished = (): Promise<void> => run(async () => {
    if (!latestHandoff) return
    await window.creatorOS?.confirmPublishingHandoff(latestHandoff.id)
    onNotice(`已记录${platform}为人工确认发布`); onChanged()
  }, '发布确认失败', setHandoffBusy)
  const startComputerUsePilot = (): Promise<void> => run(async () => {
    if (!latestHandoff) return
    const pilot = await window.creatorOS?.startPublishingComputerUsePilot(latestHandoff.id)
    if (pilot?.status === 'failed') throw new Error(pilot.lastError ?? 'B站Computer Use试验启动失败')
    onNotice('已复制安全任务包并打开B站；请交给Codex辅助填写，完成后停在发布按钮前')
    onChanged()
  }, 'B站Computer Use试验启动失败', setHandoffBusy)
  const markComputerUsePilotReady = (): Promise<void> => run(async () => {
    if (!latestPilot) return
    await window.creatorOS?.markPublishingComputerUsePilotReady(latestPilot.id)
    onNotice('已标记为页面待检查；请逐项核对后亲自点击发布')
    onChanged()
  }, 'Computer Use试验状态更新失败', setHandoffBusy)
  const cancelComputerUsePilot = (): Promise<void> => run(async () => {
    if (!latestPilot) return
    await window.creatorOS?.stopPublishingComputerUsePilot(latestPilot.id, 'canceled')
    onNotice('已取消Computer Use试验；人工发布交接仍可继续使用')
    onChanged()
  }, 'Computer Use试验取消失败', setHandoffBusy)
  const statusLabel: Record<ReturnType<typeof status>, string> = { missing: '待补', unbased: '待定稿', stale: '基于旧稿', ready: '已就绪' }
  return <section className="content-card project-module-surface publishing-workspace">
    <header><div><span>发布任务卡</span><h2>发布</h2></div><small>{finalVersion ? `当前引用定稿v${finalVersion.revision}` : '尚未设置定稿'}</small></header>
    <div className="title-candidate-module"><header><div><h3>主标题</h3></div><label className="title-requirement"><span>本轮要求</span><input value={titleInstruction} maxLength={2000} onChange={(event) => setTitleInstruction(event.currentTarget.value)} placeholder="可选，例如：更克制、突出真实体验" /></label><button className="primary-action" disabled={!finalVersion || generatingTitles || generating} onClick={() => void generateMasterTitles()}>{generatingTitles || generating ? '生成中…' : masterCandidates.length ? '再生成20条' : '生成20条主标题'}</button></header>
      {masterCandidates.length ? <div className="title-candidate-list">{masterCandidates.map((candidate) => <article className={`${candidate.isSelected ? 'selected' : ''}${finalVersion && candidate.sourceVersionId !== finalVersion.id ? ' stale' : ''}`} key={candidate.id}><header><b>{candidate.provider === 'codex_cli' ? 'Codex' : 'Claude'}·{candidate.angle}</b><span>{candidate.isSelected ? '主标题' : finalVersion && candidate.sourceVersionId !== finalVersion.id ? '基于旧稿' : candidate.coverText}</span></header><p>{candidate.title}</p><button disabled={Boolean(finalVersion && candidate.sourceVersionId !== finalVersion.id)} onClick={() => void applyTitle(candidate.id)}>{candidate.isSelected ? '当前主标题' : '选为主标题'}</button></article>)}</div> : <div className="title-candidate-empty">{finalVersion ? `尚未生成主标题·将引用定稿v${finalVersion.revision}` : '请先在文案中设置定稿'}</div>}
      {masterTitle ? <section className="platform-title-adaptation"><header><div><b>{platform}标题</b><span>主标题{[...masterTitle].length}字{limit ? `·平台按${limit}字检查` : ''}</span></div><button disabled={generatingTitles || generating} onClick={() => void adaptMasterTitle()}>{masterNeedsAdaptation ? '双AI生成4条短版' : '直接沿用主标题'}</button></header>{platformTitleCandidates.length ? <div className="title-candidate-list compact">{platformTitleCandidates.map((candidate) => <article className={`${candidate.isSelected ? 'selected' : ''}${finalVersion && candidate.sourceVersionId !== finalVersion.id ? ' stale' : ''}`} key={candidate.id}><header><b>{candidate.provider === 'codex_cli' ? 'Codex' : 'Claude'}·{candidate.angle}</b><span>{candidate.isSelected ? '已选择' : candidate.coverText}</span></header><p>{candidate.title}</p><button disabled={Boolean(finalVersion && candidate.sourceVersionId !== finalVersion.id)} onClick={() => void applyTitle(candidate.id)}>{candidate.isSelected ? '当前标题' : '用这条'}</button></article>)}</div> : <p>{masterNeedsAdaptation ? '主标题超出平台限制，生成后会在这里出现4条候选。' : '主标题在平台限制内，无需再次调用AI。'}</p>}</section> : null}
    </div>
    <div className="publish-matrix" role="table" aria-label="平台物料完成度"><div className="publish-matrix-head" role="row"><b role="columnheader">平台</b>{definitions.map((item) => <b role="columnheader" key={item.key}>{item.label}</b>)}</div>{platforms.map((targetPlatform) => <div className={`publish-matrix-row${platform === targetPlatform ? ' active' : ''}`} role="row" key={targetPlatform}><b role="rowheader">{targetPlatform}</b>{definitions.map((definition) => { const item = material(targetPlatform, definition.key); const currentStatus = status(item); return <button className={currentStatus} role="cell" key={definition.key} onClick={() => setPlatform(targetPlatform)}><span>{statusLabel[currentStatus]}</span><small>{item ? `v${item.revision}` : definition.required ? '必需' : '可选'}</small></button> })}</div>)}</div>
    <section className="publishing-task-card" aria-label={`${platform}发布任务卡`}><header><div><nav aria-label="选择发布平台">{platforms.map((item) => <button className={item === platform ? 'active' : ''} key={item} onClick={() => setPlatform(item)}>{item}</button>)}</nav><h3>{platform}发布包</h3></div><strong className={requiredReady === 5 ? 'ready' : ''}>{requiredReady}/5项就绪</strong></header>
      <div className="publishing-readiness">{definitions.map((definition) => { const currentStatus = status(material(platform, definition.key)); return <div className={currentStatus} key={definition.key}><span>{definition.label}{definition.required ? '' : '·可选'}</span><b>{statusLabel[currentStatus]}</b></div> })}</div>
      <label className="publishing-account-picker"><span><UserRound size={14} />发布账号</span><AppSelect aria-label={`${platform}发布账号`} value={selectedAccountId} onChange={(event) => void selectAccount(event.currentTarget.value)}><option value="">{platformAccounts.length ? '选择一个账号' : '请先到设置添加账号'}</option>{platformAccounts.map((account) => <option value={account.id} key={account.id}>{account.accountName}{account.positioning ? ` · ${account.positioning}` : ''}</option>)}</AppSelect>{!platformAccounts.length ? <button onClick={() => { window.location.hash = '#/settings' }}>去设置</button> : null}</label>
      <p className="publishing-draft-note">空白字段会从当前定稿和账号/Brief标签自动填入待编辑草稿；请检查后再保存发布信息。</p>
      <div className="publishing-fields"><label>标题<input value={title} maxLength={300} onChange={(event) => setTitle(event.currentTarget.value)} /></label><label>简介<textarea value={description} maxLength={5000} onChange={(event) => setDescription(event.currentTarget.value)} /></label><label>标签<input value={tags} maxLength={1000} onChange={(event) => setTags(event.currentTarget.value)} placeholder="用逗号分隔" /></label></div>
      <div className="publishing-copy-actions"><button disabled={!latestHandoff || latestHandoff.status === 'failed' || !latestHandoffFresh} onClick={() => void copyField('title')}><Copy size={13} />标题</button><button disabled={!latestHandoff || latestHandoff.status === 'failed' || !latestHandoffFresh} onClick={() => void copyField('description')}><Copy size={13} />简介</button><button disabled={!latestHandoff || latestHandoff.status === 'failed' || !latestHandoffFresh} onClick={() => void copyField('tags')}><Copy size={13} />标签</button></div>
      <div className="publishing-assets"><input ref={coverInputRef} aria-label={`选择${platform}发布封面`} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file, 'cover'); event.currentTarget.value = '' }} /><input ref={subtitleInputRef} aria-label={`选择${platform}发布字幕`} className="visually-hidden" type="file" accept=".srt,.vtt,.ass" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file, 'subtitle'); event.currentTarget.value = '' }} /><span className="publishing-asset-item"><button onClick={() => coverInputRef.current?.click()}><ImageIcon size={14} />{material(platform, 'cover')?.fileName ?? '选择封面'}</button>{material(platform, 'cover')?.fileId ? <button aria-label="在Finder中显示封面" onClick={() => void revealMaterial('cover')}><FolderOpen size={13} /></button> : null}</span><span className="publishing-asset-item"><button onClick={() => void chooseVideo()}><Film size={14} />{material(platform, 'video')?.fileName ?? '关联视频'}</button>{material(platform, 'video')?.fileId ? <button aria-label="在Finder中显示视频" onClick={() => void revealMaterial('video')}><FolderOpen size={13} /></button> : null}</span><span className="publishing-asset-item"><button disabled={platformCapability?.supportsSubtitle === false} onClick={() => subtitleInputRef.current?.click()}><Captions size={14} />{platformCapability?.supportsSubtitle === false ? '平台不接收字幕文件' : material(platform, 'subtitle')?.fileName ?? '选择字幕·可选'}</button>{platformCapability?.supportsSubtitle !== false && material(platform, 'subtitle')?.fileId ? <button aria-label="在Finder中显示字幕" onClick={() => void revealMaterial('subtitle')}><FolderOpen size={13} /></button> : null}</span><button className="primary-action" disabled={saving} onClick={() => void saveText()}>{saving ? '保存中…' : '保存发布信息'}</button></div>
      <section className="publishing-handoff"><header><div><b>官方发布交接</b><span>只复制发布包并打开官方页，不会代你点击发布</span></div><em>{latestHandoff ? latestHandoff.status === 'confirmed' ? '已确认发布' : !latestHandoffFresh ? '发布包已过期' : latestPilot?.status === 'ready_for_review' ? '页面待检查' : latestPilot?.status === 'page_opened' ? '辅助填写中' : latestHandoff.status === 'opened' ? '已打开平台' : latestHandoff.status === 'failed' ? '预检未通过' : '可交接' : '待预检'}</em></header>{latestHandoff?.issues.length ? <ul>{latestHandoff.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : latestHandoff && !latestHandoffFresh ? <ul><li>定稿、账号或发布物料已变化，请重新检查发布包</li></ul> : latestHandoff ? <ul>{latestHandoff.checklist.map((item) => <li key={item}>{item}</li>)}</ul> : null}<div className="publishing-handoff-actions"><button disabled={handoffBusy || pilotIsActive} onClick={() => void prepareHandoff()}>{pilotIsActive ? '请先完成当前试验' : latestHandoff ? '重新预检' : '检查发布包'}</button>{latestHandoff?.status === 'prepared' && !latestHandoff.issues.length && latestHandoffFresh ? <button className="primary-action" onClick={() => setConfirmOpen(true)}>打开官方发布页</button> : null}{latestHandoff?.status === 'opened' && latestHandoffFresh ? <button className="primary-action" onClick={() => void confirmPublished()}>我已在平台发布</button> : null}</div>{confirmOpen ? <div className="publishing-open-confirm" role="alertdialog"><AlertTriangle size={15} /><span>将复制发布文案并打开{platform}官方页。最后发布必须由你在网页内确认。</span><button onClick={() => setConfirmOpen(false)}>取消</button><button className="primary-action" onClick={() => void openHandoff()}>确认打开</button></div> : null}
        {platform === 'B站' && (computerUseEnabled || pilotIsActive) ? <div className={`publishing-computer-use-pilot ${latestPilot?.status ?? 'idle'}`}><span><ShieldCheck size={14} /><span><b>B站Computer Use试验</b><small>{latestPilot?.status === 'page_opened' ? '投稿页已打开；完成辅助填写后在这里标记待检查' : latestPilot?.status === 'ready_for_review' ? '字段已填写；请在网页逐项检查并亲自点击发布' : latestPilot?.status === 'completed' ? '已随本次人工发布确认完成' : latestPilot?.status === 'failed' ? latestPilot.lastError ?? '试验失败，可继续人工发布' : latestPilot?.status === 'canceled' ? '本轮已取消，可重新预检后再试' : '任务包只允许上传与填写，账号不一致会在上传前停止'}</small></span></span><div>{computerUseEnabled && latestHandoff?.status === 'prepared' && latestHandoffFresh && !latestHandoff.issues.length && (!latestPilot || ['completed', 'failed', 'canceled'].includes(latestPilot.status)) ? <button disabled={handoffBusy} onClick={() => void startComputerUsePilot()}>准备辅助填写</button> : null}{latestPilot?.status === 'page_opened' ? <button className="primary-action" disabled={handoffBusy} onClick={() => void markComputerUsePilotReady()}>字段已填，等待我检查</button> : null}{latestPilot && ['page_opened', 'ready_for_review'].includes(latestPilot.status) ? <button aria-label="取消B站Computer Use试验" disabled={handoffBusy} onClick={() => void cancelComputerUsePilot()}><X size={12} />取消</button> : null}</div></div> : null}
      </section>
    </section>
  </section>
}
