import { ContentTypeSelect } from './ContentTypeSelect'
import { AppSelect } from './AppSelect'
import { GitMerge, Layers3, MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContentDerivationPreparation, ContentDerivativeType, ContentEngineSnapshot } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { ContentAtomReviewCard } from './ContentAtomReviewCard'
import { ContentDerivativeCandidate } from './ContentDerivativeCandidate'
import { ContentSourceImportPanel } from './ContentSourceImportPanel'
import { ResourceRows, ResourceSection } from './TaskResourcePicker'

const emptyEngine: ContentEngineSnapshot = { sources: [], atoms: [], derivatives: [] }
const outputLabels: Record<ContentDerivativeType, string> = {
  x_single: 'X单帖', x_thread: 'X串文', ai_short_video_script: 'AI短视频文案'
}

export function LegacyContentEngine(): React.JSX.Element {
  const { contentTypes, projectTemplates } = useWorkspaceStore((state) => state.snapshot)
  const [engine, setEngine] = useState<ContentEngineSnapshot>(emptyEngine)
  const [preparation, setPreparation] = useState<ContentDerivationPreparation | null>(null)
  const [contentTypeId, setContentTypeId] = useState('type-ai')
  const [templateId, setTemplateId] = useState<string | null>('template-ai-tutorial')
  const [outputType, setOutputType] = useState<ContentDerivativeType>('x_single')
  const [excludedRecommendedIds, setExcludedRecommendedIds] = useState<string[]>([])
  const [manualResourceIds, setManualResourceIds] = useState<string[]>([])
  const [mergeSelectedIds, setMergeSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) { setError('请在LY Creator OS中打开'); setLoading(false); return }
    try { setEngine(await window.creatorOS.getContentEngine()); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '内容引擎加载失败') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!window.creatorOS) return
    let current = true
    window.creatorOS.prepareContentDerivation({ contentTypeId, templateId }).then((next) => {
      if (!current) return
      setPreparation(next); setExcludedRecommendedIds([]); setManualResourceIds([])
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : '引用资源加载失败') })
    return () => { current = false }
  }, [contentTypeId, templateId])

  const sourceById = useMemo(() => new Map(engine.sources.map((source) => [source.id, source])), [engine.sources])
  const keptAtoms = useMemo(() => engine.atoms.filter((atom) => atom.status === 'kept'), [engine.atoms])
  const reviewCount = engine.atoms.filter((atom) => atom.status === 'review_pending').length

  const mutate = async (operation: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try { await operation(); await refresh(); setNotice(success) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setBusy(false) }
  }

  const changeAtomStatus = (atomId: string, status: 'kept' | 'discarded'): void => {
    if (!window.creatorOS) return
    void mutate(() => window.creatorOS!.setContentAtomStatus(atomId, status), status === 'kept' ? '已保留1张洞察卡' : '已放弃1张洞察卡')
  }
  const mergeAtoms = (): void => {
    if (!window.creatorOS || mergeSelectedIds.length < 2) return
    void mutate(async () => { await window.creatorOS!.mergeContentAtoms(mergeSelectedIds); setMergeSelectedIds([]) }, `已合并${mergeSelectedIds.length}张洞察卡`)
  }
  const createCandidate = (): void => {
    if (!window.creatorOS || keptAtoms.length === 0) return
    void mutate(() => window.creatorOS!.createContentDerivative({
      atomIds: keptAtoms.slice(0, 20).map((atom) => atom.id), outputType, contentTypeId, templateId,
      excludedRecommendedResourceIds: excludedRecommendedIds, manualResourceIds
    }), `已生成1份${outputLabels[outputType]}候选`)
  }

  return <div className="legacy-content-engine content-engine-page">
    <header className="page-header content-engine-header"><div><span>手动粘贴兼容入口</span><h1>从明确片段生成旧版洞察卡</h1><p>只用于继续处理过去的手动导入；新的对话筛选请使用上方主流程。</p></div><div className="content-engine-header-badge"><ShieldCheck size={16} /><span><b>本机处理</b><small>不扫描私人聊天</small></span></div></header>

    <ol className="content-engine-steps" aria-label="内容引擎步骤"><li className={engine.sources.length ? 'done' : 'active'}><span>1</span><div><b>来源片段</b><small>{engine.sources.length}份明确导入</small></div></li><li className={keptAtoms.length ? 'done' : engine.atoms.length ? 'active' : ''}><span>2</span><div><b>洞察卡</b><small>{keptAtoms.length}张已保留·{reviewCount}张待确认</small></div></li><li className={engine.derivatives.length ? 'done' : keptAtoms.length ? 'active' : ''}><span>3</span><div><b>派生候选</b><small>{engine.derivatives.length}份可回看快照</small></div></li></ol>

    {notice ? <div className="inline-notice content-engine-notice" role="status"><Sparkles size={14} />{notice}</div> : null}
    {error ? <p className="form-error content-engine-error" role="alert">{error}</p> : null}

    <div className="content-engine-layout">
      <aside><ContentSourceImportPanel onImported={(result) => { void refresh(); setNotice(result.atoms.length ? `已从本次片段提取${result.atoms.length}张洞察卡` : `没有新增洞察卡；${result.duplicateAtomCount}张与已有内容重复`) }} /></aside>
      <div className="content-engine-main">
        <section className="content-atom-workspace content-card">
          <header><div><span>2·人工决定去留</span><h2>洞察卡</h2><p>评分只是本机规则建议；只有你点“保留”的卡片才能生成候选。</p></div><div className="atom-workspace-actions"><span>{mergeSelectedIds.length ? `已选${mergeSelectedIds.length}张` : '可合并相近洞察'}</span><button className="secondary-action" disabled={busy || mergeSelectedIds.length < 2} onClick={mergeAtoms}><GitMerge size={13} />合并所选</button></div></header>
          {loading ? <div className="loading-state">正在读取本机内容…</div> : engine.atoms.length ? <div className="content-atom-grid">{engine.atoms.map((atom) => <ContentAtomReviewCard key={atom.id} atom={atom} sourceTitle={[...new Set(atom.sourceRefs.map((ref) => sourceById.get(ref.sourceId)?.title ?? '已移除来源'))].join('｜')} mergeSelected={mergeSelectedIds.includes(atom.id)} busy={busy} onToggleMerge={() => setMergeSelectedIds((current) => current.includes(atom.id) ? current.filter((id) => id !== atom.id) : [...current, atom.id])} onStatus={(status) => changeAtomStatus(atom.id, status)} />)}</div> : <div className="content-engine-empty"><Layers3 size={23} /><b>还没有洞察卡</b><span>先在左侧粘贴你明确选中的对话片段。</span></div>}
        </section>

        <section className="content-derivation-builder content-card">
          <header><div><span>3·带快照生成</span><h2>派生候选</h2><p>目前用可追溯的本机规则生成初稿，不会假装已调用Codex或Claude。</p></div><MessageSquareText size={19} /></header>
          <div className="content-output-types" role="group" aria-label="候选格式">{(Object.entries(outputLabels) as Array<[ContentDerivativeType, string]>).map(([value, label]) => <button className={outputType === value ? 'active' : ''} aria-pressed={outputType === value} key={value} onClick={() => setOutputType(value)}>{label}</button>)}</div>
          <div className="content-derivation-settings"><label><span>内容方向</span><ContentTypeSelect value={contentTypeId} onChange={(event) => { const next = event.currentTarget.value; setContentTypeId(next); setTemplateId(contentTypes.find((item) => item.id === next)?.defaultProjectTemplateId ?? null) }}>{contentTypes.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ContentTypeSelect></label><label><span>项目模板</span><AppSelect value={templateId ?? ''} onChange={(event) => setTemplateId(event.currentTarget.value || null)}><option value="">从空白开始</option>{projectTemplates.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</AppSelect></label></div>
          {preparation ? <div className="content-derivation-resources"><ResourceSection title="自动引用" description="基础风格随内容方向锁定"><ResourceRows resources={preparation.automaticResources} empty="当前方向没有自动资源" /></ResourceSection><ResourceSection title="推荐参考" description="默认带入，可一键移除"><ResourceRows resources={preparation.recommendedResources} empty="暂无推荐参考" excludedIds={excludedRecommendedIds} onToggleExcluded={(resourceId) => setExcludedRecommendedIds((current) => current.includes(resourceId) ? current.filter((id) => id !== resourceId) : [...current, resourceId])} /></ResourceSection><ResourceSection title="手动选择" description="其他博主的蒸馏内容不会自动带入"><ResourceRows resources={preparation.manualResources} empty="暂无可手动选择的其他博主资源" selectedIds={manualResourceIds} onToggleSelected={(resourceId) => setManualResourceIds((current) => current.includes(resourceId) ? current.filter((id) => id !== resourceId) : [...current, resourceId])} /></ResourceSection></div> : null}
          <footer><span><b>{keptAtoms.length}</b>张已保留洞察将进入本次快照{keptAtoms.length > 20 ? '，上限取最新20张' : ''}</span><button className="primary-action" disabled={busy || keptAtoms.length === 0 || !preparation} onClick={createCandidate}><Sparkles size={14} />{busy ? '正在处理…' : `生成${outputLabels[outputType]}`}</button></footer>
        </section>

        {engine.derivatives.length ? <section className="content-derivative-history"><header><div><span>可编辑·可追溯</span><h2>候选历史</h2></div><span>{engine.derivatives.length}份</span></header><div className="content-derivative-list">{engine.derivatives.map((candidate) => <ContentDerivativeCandidate key={candidate.id} candidate={candidate} contentTypes={contentTypes} templates={projectTemplates} busy={busy} onConfirm={(content) => { if (window.creatorOS) void mutate(() => window.creatorOS!.confirmContentDerivative(candidate.id, content), '已确认候选，现在可以复制或创建项目') }} onCopy={() => { if (window.creatorOS) void mutate(() => window.creatorOS!.copyContentDerivative(candidate.id), '已复制确认后的内容') }} onCreateProject={(input) => { if (window.creatorOS) void mutate(() => window.creatorOS!.createProjectFromContentDerivative(candidate.id, input), '已创建内容项目并保留候选来源') }} />)}</div></section> : null}
      </div>
    </div>
  </div>
}
