import { ContentTypeSelect } from './ContentTypeSelect'
import { AppSelect } from './AppSelect'
import { Check, Filter, HelpCircle, Inbox, MoreHorizontal, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureDestinationCandidate, CaptureRecord, ContentTypeDefinition, GeneralRecordCategory, ProjectSummary, TopicRecord, TopicStageDefinition } from '../../../shared/domain'
import { useInspectorDrawer } from '../hooks/useInspectorDrawer'
import { useWorkspaceStore } from '../store/workspace'
import type { AppRoute, IdeaQueueRoute } from '../utils/router'
import { navigate } from '../utils/router'
import { showStagePreview } from '../utils/stage-preview'
import { AnchoredPopover } from './AnchoredPopover'
import { ClassificationDefinitionManager } from './ClassificationDefinitionManager'
import { CaptureAttachmentList } from './CaptureAttachmentList'
import { ResizableInspectorDivider } from './ResizableInspectorDivider'

type PathFilter = 'all' | 'topic_idea' | 'project_content' | 'general_record'
type CaptureQueue = 'inbox' | 'review' | 'processed' | 'parked' | 'discarded'
type ViewMode = 'list' | 'card'
type CardPath = 'topic_idea' | 'project_content' | 'general_record'
type TriageChoice = { path?: CardPath; topicDestination?: 'new' | 'existing'; existingTopicId?: string; destinationProjectId?: string; generalCategoryId?: string }
interface UndoEntry { message: string; undo(): Promise<void> }

const sourceLabels: Record<CaptureRecord['sourceType'], string> = { quick_capture: '快速记录', web_bookmark: '网页收藏', notion_import: 'Notion导入', project: '项目内', conversation_filter: 'AI对话筛选', mobile_android: 'Android快速记录' }
const queueLabels: Record<CaptureQueue, string> = { inbox: '收件箱', review: '待我确认', processed: '已自动处理', parked: '暂存', discarded: '弃用' }
const usageLabels: Record<NonNullable<CaptureRecord['usageType']>, string> = { parameter_fact: '参数事实', opinion: '观点想法', material_clue: '素材线索' }

function captureQueue(capture: CaptureRecord): CaptureQueue {
  if (capture.useStatus === 'parked') return 'parked'
  if (capture.useStatus === 'discarded') return 'discarded'
  if (capture.classificationStatus === 'unprocessed') return 'inbox'
  if (capture.classificationStatus === 'suggested') return 'review'
  return 'processed'
}

function captureTitle(content: string): string {
  const first = content.trim().split(/[。！？\n]/).find(Boolean) ?? content.trim()
  if (!first) return '附件记录'
  return first.length > 38 ? `${first.slice(0, 38)}…` : first
}

function capturePathLabel(capture: CaptureRecord): string {
  if (capture.captureKind === 'topic_idea') return '选题灵感'
  if (capture.captureKind === 'project_content') return '内容灵感'
  if (capture.captureKind === 'general_record') return '通用记录'
  return '路径未定'
}

function captureFingerprint(capture: CaptureRecord): string {
  return [capture.captureKind, capture.primaryProjectId, capture.linkedTopicId, capture.classificationStatus, capture.classificationConfidence, capture.classifiedAt, capture.useStatus, capture.usageType, capture.generalCategoryId,
    capture.attachments.map((attachment) => `${attachment.id}:${attachment.processState}`).join(',')].join('|')
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button,a,input,textarea,select,summary,[contenteditable="true"]'))
}

interface TriageOverlayProps {
  queue: 'inbox' | 'review'
  records: CaptureRecord[]
  projects: ProjectSummary[]
  contentTypes: ContentTypeDefinition[]
  generalCategories: GeneralRecordCategory[]
  topics: TopicRecord[]
  topicStages: TopicStageDefinition[]
  startId: string | null
  onClose(): void
  onChanged(): Promise<unknown>
  onDecision(message: string, undo: () => Promise<void>): void
  onUndoLast(): void
}

function TriageOverlay({ queue, records, projects, contentTypes, generalCategories, topics, topicStages, startId, onClose, onChanged, onDecision, onUndoLast }: TriageOverlayProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLElement>(null)
  const [index, setIndex] = useState(() => Math.max(0, records.findIndex((record) => record.id === startId)))
  const [path, setPath] = useState<CardPath | null>(null)
  const [destinationProjectId, setDestinationProjectId] = useState<string | null>(null)
  const [topicDestination, setTopicDestination] = useState<'new' | 'existing'>('new')
  const [existingTopicId, setExistingTopicId] = useState<string>('')
  const [generalCategoryId, setGeneralCategoryId] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const [candidates, setCandidates] = useState<CaptureDestinationCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const record = records[Math.min(index, Math.max(0, records.length - 1))]

  useEffect(() => {
    if (!record) return
    setPath(record.captureKind === 'unknown' ? null : record.captureKind === 'topic_idea' ? 'topic_idea' : record.captureKind === 'general_record' ? 'general_record' : 'project_content')
    setDestinationProjectId(record.suggestedProjectId)
    setTopicDestination('new'); setExistingTopicId(''); setGeneralCategoryId(record.generalCategoryId ?? ''); setNewCategoryName(''); setShowAllProjects(false); setProjectQuery(''); setError('')
  }, [record])

  useEffect(() => {
    if (!record || path !== 'project_content' || !window.creatorOS) return
    let active = true
    setLoadingCandidates(true)
    void window.creatorOS.listCaptureDestinationCandidates(record.id).then((items) => { if (active) setCandidates(items) }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '项目建议加载失败') }).finally(() => { if (active) setLoadingCandidates(false) })
    return () => { active = false }
  }, [path, record])

  useEffect(() => { dialogRef.current?.focus() }, [])
  useEffect(() => { if (!records.length) onClose() }, [onClose, records.length])

  const contentDirections = contentTypes.filter((item) => item.isActive)
  const inferredContentTypeId = record?.suggestedContentTypeId ?? candidates[0]?.contentTypeId ?? contentDirections[0]?.id ?? null
  const likelyCandidates = useMemo(() => {
    const likely = candidates.filter((item) => item.score >= 0.6).slice(0, 3)
    const selected = candidates.find((item) => item.projectId === destinationProjectId)
    return selected && !likely.some((item) => item.projectId === selected.projectId) ? [...likely.slice(0, 2), selected] : likely
  }, [candidates, destinationProjectId])
  const shownCandidates = showAllProjects
    ? candidates.filter((item) => !projectQuery.trim() || item.title.toLowerCase().includes(projectQuery.trim().toLowerCase()))
    : likelyCandidates
  const activeGeneralCategories = useMemo(() => generalCategories.filter((category) => category.isActive), [generalCategories])

  const complete = useCallback(async (choice?: TriageChoice): Promise<void> => {
    if (!record || !window.creatorOS || working) return
    const activePath = choice?.path ?? path
    const activeTopicDestination = choice?.topicDestination ?? topicDestination
    const activeExistingTopicId = choice?.existingTopicId ?? existingTopicId
    const activeProjectId = choice?.destinationProjectId ?? destinationProjectId
    const activeGeneralCategoryId = choice?.generalCategoryId ?? generalCategoryId
    setWorking(true); setError('')
    try {
      if (queue === 'review' && !activePath) throw new Error('先确定这条记录的路径')
      if (activePath === 'project_content') {
        const projectId = queue === 'review' && !activeProjectId ? record.suggestedProjectId : activeProjectId
        const candidate = candidates.find((item) => item.projectId === projectId)
        if (!projectId) throw new Error('请选择一个项目去向')
        await window.creatorOS.confirmCaptureClassification(record.id, projectId, candidate?.contentTypeId ?? record.suggestedContentTypeId, 'project_content')
      } else if (activePath === 'topic_idea') {
        if (activeTopicDestination === 'existing') {
          if (!activeExistingTopicId) throw new Error('请选择要并入的选题')
          await window.creatorOS.attachCaptureToTopic(record.id, activeExistingTopicId)
        } else {
          if (!inferredContentTypeId) throw new Error('暂时无法判断内容方向，请先在列表中补充信息')
          await window.creatorOS.confirmCaptureClassification(record.id, null, inferredContentTypeId, 'topic_idea')
        }
      } else if (activePath === 'general_record') {
        if (!activeGeneralCategoryId) throw new Error('请选择通用记录分类')
        await window.creatorOS.confirmCaptureClassification(record.id, null, null, 'general_record', activeGeneralCategoryId)
      } else throw new Error('先选择选题灵感、内容灵感或通用记录')
      const captureId = record.id
      await onChanged()
      onDecision('已完成1条归类', async () => { await window.creatorOS!.undoCaptureClassification(captureId); await onChanged() })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '归类失败') }
    finally { setWorking(false) }
  }, [candidates, destinationProjectId, existingTopicId, generalCategoryId, inferredContentTypeId, onChanged, onDecision, path, queue, record, topicDestination, working])

  const createGeneralCategory = useCallback(async (): Promise<void> => {
    if (!window.creatorOS || !newCategoryName.trim()) return
    setCreatingCategory(true); setError('')
    try {
      const category = await window.creatorOS.createGeneralRecordCategory(newCategoryName.trim())
      setGeneralCategoryId(category.id); setNewCategoryName(''); await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分类创建失败') }
    finally { setCreatingCategory(false) }
  }, [newCategoryName, onChanged])

  const setUseStatus = useCallback(async (status: CaptureRecord['useStatus']): Promise<void> => {
    if (!record || !window.creatorOS) return
    setWorking(true); setError('')
    try {
      const captureId = record.id
      await window.creatorOS.setCaptureUseStatus(captureId, status); await onChanged()
      onDecision(status === 'parked' ? '已暂存1条灵感' : '已弃用1条灵感', async () => { await window.creatorOS!.setCaptureUseStatus(captureId, 'active'); await onChanged() })
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '状态保存失败') }
    finally { setWorking(false) }
  }, [onChanged, onDecision, record])

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (!record || isInteractiveTarget(event.target)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); onUndoLast(); return }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setIndex((current) => (current + (event.key === 'ArrowLeft' ? -1 : 1) + records.length) % records.length); return }
      if (queue === 'inbox' && event.key === '1') { event.preventDefault(); setPath('topic_idea'); setDestinationProjectId(null); return }
      if (queue === 'inbox' && event.key === '2') { event.preventDefault(); setPath('project_content'); return }
      if (queue === 'inbox' && event.key === '3') { event.preventDefault(); setPath('general_record'); setDestinationProjectId(null); return }
      if (queue === 'inbox' && /^[4-9]$/.test(event.key)) {
        const optionIndex = Number(event.key) - 4
        if (path === 'project_content') { const option = shownCandidates[optionIndex]; if (option) { event.preventDefault(); setDestinationProjectId(option.projectId); void complete({ destinationProjectId: option.projectId }) } return }
        if (path === 'general_record') { const category = activeGeneralCategories[optionIndex]; if (category) { event.preventDefault(); setGeneralCategoryId(category.id); void complete({ generalCategoryId: category.id }) } return }
        if (path === 'topic_idea' && optionIndex === 0) { event.preventDefault(); setTopicDestination('new'); void complete({ topicDestination: 'new' }); return }
        if (path === 'topic_idea' && optionIndex === 1) { event.preventDefault(); setTopicDestination('existing'); return }
        return
      }
      if (queue === 'review' && event.key.toLowerCase() === 'd') { event.preventDefault(); setShowAllProjects(true); return }
      if (event.key === 'Enter') { event.preventDefault(); void complete() }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void setUseStatus('parked') }
      if (event.key.toLowerCase() === 'x') { event.preventDefault(); void setUseStatus('discarded') }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [activeGeneralCategories, complete, onClose, onUndoLast, path, queue, record, records.length, setUseStatus, shownCandidates])

  if (!record) return null
  const showManualDestination = queue === 'inbox' || (queue === 'review' && showAllProjects)
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'))
    if (!focusable.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div className="triage-overlay" role="presentation">
    <section className="triage-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="triage-title" tabIndex={-1} onKeyDown={trapFocus}>
      <header className="triage-topbar"><span aria-live="polite">{queueLabels[queue]}·卡片归类 {Math.min(index + 1, records.length)}/{records.length}</span><button className="triage-exit" onClick={onClose}>退出（Esc）</button></header>
      <div className="triage-sheet-body">
        <article className="triage-surface">
          <div className="triage-meta"><span>{sourceLabels[record.sourceType]}</span><time>{new Date(record.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></div>
          <h2 id="triage-title">{captureTitle(record.originalContent)}</h2>
          <div className="triage-content"><p>{record.originalContent || '这条记录只包含附件。'}</p><CaptureAttachmentList capture={record} /></div>
        </article>
        <section className="triage-options" aria-label="归类选项">
          {queue === 'review' && !showAllProjects ? <section className="triage-suggestion"><span>Codex建议去向</span><b>{record.captureKind === 'general_record' ? generalCategories.find((category) => category.id === record.generalCategoryId)?.name ?? '待选择分类' : record.suggestedProjectId ? projects.find((project) => project.id === record.suggestedProjectId)?.title : contentTypes.find((type) => type.id === record.suggestedContentTypeId)?.name ?? '待补充方向'}</b><small>{capturePathLabel(record)}{record.classificationReason ? `·${record.classificationReason}` : ''}</small></section> : null}
          {showManualDestination ? <section className="triage-classification">
          <div className="triage-step triage-step-main"><b>路径</b><div className="triage-choice-grid triage-path-grid"><button aria-pressed={path === 'topic_idea'} className={path === 'topic_idea' ? 'active' : ''} onClick={() => { setPath('topic_idea'); setDestinationProjectId(null) }}><Check size={13} />选题灵感<kbd>1</kbd></button><button aria-pressed={path === 'project_content'} className={path === 'project_content' ? 'active' : ''} onClick={() => setPath('project_content')}><Check size={13} />内容灵感<kbd>2</kbd></button><button aria-pressed={path === 'general_record'} className={path === 'general_record' ? 'active' : ''} onClick={() => { setPath('general_record'); setDestinationProjectId(null) }}><Check size={13} />通用记录<kbd>3</kbd></button></div></div>
          {path === 'project_content' ? <div className="triage-step triage-step-sub"><b>Codex认为最可能的项目</b>{showAllProjects ? <label className="triage-project-search"><Search size={13} /><input value={projectQuery} onChange={(event) => setProjectQuery(event.currentTarget.value)} placeholder="搜索全部活跃项目" autoFocus /></label> : null}{loadingCandidates ? <span className="triage-loading">正在判断最可能项目…</span> : shownCandidates.length ? <div className="triage-project-grid">{shownCandidates.map((candidate, candidateIndex) => <button key={candidate.projectId} aria-pressed={destinationProjectId === candidate.projectId} className={destinationProjectId === candidate.projectId ? 'active' : ''} title={`${candidate.title}·${candidate.reason}`} onClick={() => { setDestinationProjectId(candidate.projectId); void complete({ destinationProjectId: candidate.projectId }) }}><span>{candidate.title}</span><small>{candidateIndex === 0 && !showAllProjects ? '最可能' : '可能相关'}</small><kbd>{candidateIndex + 4}</kbd></button>)}</div> : <span className="triage-no-match">没有足够可靠的项目匹配</span>}<button className="triage-more" aria-expanded={showAllProjects} onClick={() => { setShowAllProjects((value) => !value); setProjectQuery('') }}>{showAllProjects ? '收起全部项目' : shownCandidates.length ? '都不合适？查看更多项目' : '搜索更多项目'}</button></div> : null}
          {path === 'topic_idea' ? <div className="triage-step triage-step-sub"><b>选题去向</b><div className="triage-choice-grid"><button aria-pressed={topicDestination === 'new'} className={topicDestination === 'new' ? 'active' : ''} onClick={() => { setTopicDestination('new'); void complete({ topicDestination: 'new' }) }}>立为新选题<kbd>4</kbd></button><button aria-pressed={topicDestination === 'existing'} className={topicDestination === 'existing' ? 'active' : ''} onClick={() => setTopicDestination('existing')}>并入已有选题<kbd>5</kbd></button></div>{topicDestination === 'existing' ? <AppSelect aria-label="要并入的选题" value={existingTopicId} onChange={(event) => { const topicId = event.currentTarget.value; setExistingTopicId(topicId); if (topicId) void complete({ topicDestination: 'existing', existingTopicId: topicId }) }}><option value="">选择选题</option>{topics.filter((topic) => topicStages.find((stage) => stage.id === topic.stageId)?.role !== 'shelved').map((topic) => <option value={topic.id} key={topic.id}>{topic.title}</option>)}</AppSelect> : null}</div> : null}
          {path === 'general_record' ? <div className="triage-step triage-step-sub"><b>通用记录分类</b><div className="triage-general-categories">{activeGeneralCategories.map((category, categoryIndex) => <button key={category.id} aria-pressed={generalCategoryId === category.id} className={generalCategoryId === category.id ? 'active' : ''} onClick={() => { setGeneralCategoryId(category.id); void complete({ generalCategoryId: category.id }) }}><Check size={12} />{category.name}{categoryIndex < 6 ? <kbd>{categoryIndex + 4}</kbd> : null}</button>)}<label><input value={newCategoryName} onChange={(event) => setNewCategoryName(event.currentTarget.value)} placeholder="新分类名称" /><button disabled={creatingCategory || !newCategoryName.trim()} onClick={() => void createGeneralCategory()}>＋新建分类</button></label></div></div> : null}
          </section> : null}
          {error ? <p className="triage-error" role="alert">{error}</p> : null}
          <footer className="triage-actions"><button className="primary-action" disabled={working || !path || (path === 'project_content' && !destinationProjectId) || (path === 'topic_idea' && topicDestination === 'existing' && !existingTopicId) || (path === 'general_record' && !generalCategoryId)} onClick={() => void complete()}>{queue === 'review' && !showAllProjects ? '接受建议' : '完成归类'}·Enter</button>{queue === 'review' && !showAllProjects ? <button onClick={() => setShowAllProjects(true)}>调整去向·D</button> : null}<span /><button onClick={() => void setUseStatus('parked')}>暂存S</button><button className="danger-text" onClick={() => void setUseStatus('discarded')}>弃用X</button><div className="triage-help-wrap"><button className="triage-help" aria-label="查看卡片归类快捷操作" aria-expanded={helpOpen} onClick={() => setHelpOpen((value) => !value)}><HelpCircle size={14} /></button>{helpOpen ? <div className="triage-help-popover" role="tooltip">左右键切卡·1/2/3选路径·4起选去向并自动归类·Enter完成·D调整·S暂存·X弃用·⌘Z撤回·Esc退出</div> : null}</div></footer>
        </section>
      </div>
    </section>
  </div>
}

export function IdeasPage({ route }: { route: AppRoute }): React.JSX.Element {
  const { contentTypes, generalRecordCategories, projects, captures: liveCaptures, topics, topicStages, preferences } = useWorkspaceStore((state) => state.snapshot)
  const hydrated = useWorkspaceStore((state) => state.hydrated)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [captures, setCaptures] = useState<CaptureRecord[]>(liveCaptures)
  const [pendingResults, setPendingResults] = useState(0)
  const [path, setPath] = useState<PathFilter>('all')
  const [queue, setQueue] = useState<CaptureQueue>('inbox')
  const [viewMode, setViewMode] = useState<ViewMode>(() => localStorage.getItem('ly.creator-os.idea-view') === 'card' ? 'card' : 'list')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<CaptureRecord['sourceType'] | ''>('')
  const [directionFilter, setDirectionFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [generalCategoryFilter, setGeneralCategoryFilter] = useState('')
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null)
  const { drawerOpen: detailDrawerOpen, closeButtonRef, openDrawer, closeDrawer } = useInspectorDrawer()
  const [filterOpen, setFilterOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [directionManagerOpen, setDirectionManagerOpen] = useState(false)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [deduplicating, setDeduplicating] = useState(false)
  const [batchWorking, setBatchWorking] = useState(false)
  const [destinationEditorId, setDestinationEditorId] = useState<string | null>(null)
  const [destinationProjectId, setDestinationProjectId] = useState('')
  const [categoryEditorId, setCategoryEditorId] = useState<string | null>(null)
  const [categoryDestinationId, setCategoryDestinationId] = useState('')
  const [topicEditorId, setTopicEditorId] = useState<string | null>(null)
  const [topicDirectionId, setTopicDirectionId] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [contextMenu, setContextMenu] = useState<{ anchor: HTMLElement; captureId: string } | null>(null)
  const undoStackRef = useRef<UndoEntry[]>([])
  const noticeTimerRef = useRef<number | null>(null)
  const cardTriggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const captureSnapshotReadyRef = useRef(false)
  const directCaptureChangeRef = useRef(false)
  const contentDirections = contentTypes.filter((item) => item.isActive)

  useEffect(() => {
    if (!hydrated) return
    if (!captureSnapshotReadyRef.current || directCaptureChangeRef.current) {
      captureSnapshotReadyRef.current = true; directCaptureChangeRef.current = false
      setCaptures(liveCaptures); setPendingResults(0); return
    }
    const visible = new Map(captures.map((capture) => [capture.id, captureFingerprint(capture)]))
    const changed = liveCaptures.reduce((count, capture) => count + (visible.get(capture.id) === captureFingerprint(capture) ? 0 : 1), 0)
      + captures.reduce((count, capture) => count + (liveCaptures.some((item) => item.id === capture.id) ? 0 : 1), 0)
    setPendingResults(changed)
  }, [captures, hydrated, liveCaptures])

  const syncCaptures = useCallback(async (): Promise<unknown> => {
    directCaptureChangeRef.current = true
    const snapshot = await refresh()
    setCaptures(snapshot.captures); setPendingResults(0)
    return snapshot
  }, [refresh])
  const loadPendingResults = useCallback((): void => {
    setCaptures(liveCaptures); setPendingResults(0)
  }, [liveCaptures])
  const switchQueue = useCallback((nextQueue: CaptureQueue): void => {
    setQueue(nextQueue)
    setQuery('')
    setSelectedCaptureId(null)
    setViewMode('list')
    setCardOpen(false)
    const deepLinkedQueue = (['inbox', 'review', 'processed'] as CaptureQueue[]).includes(nextQueue)
      ? nextQueue as IdeaQueueRoute
      : undefined
    if (route.queue !== deepLinkedQueue) navigate({ ...route, page: 'ideas', queue: deepLinkedQueue, captureId: undefined })
  }, [route])

  const inPath = useCallback((capture: CaptureRecord): boolean => path === 'all' || capture.captureKind === path, [path])
  const routeFiltered = useMemo(() => captures.filter((capture) => {
    if (!inPath(capture)) return false
    if (generalCategoryFilter && capture.generalCategoryId !== generalCategoryFilter) return false
    if (route.projectId && capture.primaryProjectId !== route.projectId && capture.suggestedProjectId !== route.projectId) return false
    if (projectFilter && capture.primaryProjectId !== projectFilter && capture.suggestedProjectId !== projectFilter && !capture.referencedProjectIds.includes(projectFilter)) return false
    if (route.contentTypeId && capture.suggestedContentTypeId !== route.contentTypeId && projects.find((project) => project.id === capture.primaryProjectId)?.contentTypeId !== route.contentTypeId) return false
    if (sourceFilter && capture.sourceType !== sourceFilter) return false
    if (directionFilter && capture.suggestedContentTypeId !== directionFilter && projects.find((project) => project.id === capture.primaryProjectId)?.contentTypeId !== directionFilter) return false
    if (capture.useStatus === 'discarded') return false
    return true
  }), [captures, directionFilter, generalCategoryFilter, inPath, projectFilter, projects, route.contentTypeId, route.projectId, sourceFilter])
  const counts = useMemo(() => Object.fromEntries((Object.keys(queueLabels) as CaptureQueue[]).map((key) => [key, routeFiltered.filter((capture) => captureQueue(capture) === key).length])) as Record<CaptureQueue, number>, [routeFiltered])
  const queueRecords = useMemo(() => routeFiltered.filter((capture) => query.trim()
    ? capture.originalContent.toLowerCase().includes(query.trim().toLowerCase())
    : captureQueue(capture) === queue).sort((a, b) => queue === 'processed'
      ? (a.classificationConfidence ?? 1) - (b.classificationConfidence ?? 1) || b.createdAt.localeCompare(a.createdAt)
      : b.createdAt.localeCompare(a.createdAt)), [query, queue, routeFiltered])
  const selectedCapture = queueRecords.find((capture) => capture.id === selectedCaptureId) ?? queueRecords[0] ?? null
  const cardRecords = routeFiltered.filter((capture) => captureQueue(capture) === queue && ['inbox', 'review'].includes(queue))

  useEffect(() => { if (viewMode === 'card' && ['inbox', 'review'].includes(queue) && cardRecords.length) setCardOpen(true) }, [cardRecords.length, queue, viewMode])
  useEffect(() => { if (!cardOpen) cardTriggerRef.current?.focus() }, [cardOpen])
  useEffect(() => {
    if (!route.queue) return
    setQueue(route.queue)
    setQuery('')
    setSelectedCaptureId(null)
    setViewMode('list')
    setCardOpen(false)
  }, [route.queue])
  useEffect(() => {
    if (!route.captureId) return
    const target = captures.find((capture) => capture.id === route.captureId && capture.useStatus !== 'discarded')
    if (!target) return
    setPath('all')
    setQuery('')
    setSourceFilter('')
    setDirectionFilter('')
    setProjectFilter('')
    setGeneralCategoryFilter('')
    setQueue(captureQueue(target))
    setViewMode('list')
    setCardOpen(false)
    setSelectedCaptureId(target.id)
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`inspiration-record-${target.id}`)
      row?.scrollIntoView({ block: 'center' })
      const trigger = row?.querySelector<HTMLElement>('.inspiration-record-main')
      if (trigger) openDrawer(trigger)
    })
  }, [captures, openDrawer, route.captureId])
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => { if (event.key === '/' && !isInteractiveTarget(event.target)) { event.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', focusSearch); return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  useEffect(() => {
    if (!contextMenu) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.anchored-popover-layer')) return
      setContextMenu(null)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setContextMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [contextMenu])
  useEffect(() => () => { if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current) }, [])

  const showNotice = useCallback((message: string): void => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 4200)
  }, [])
  const rememberUndo = useCallback((message: string, undo: () => Promise<void>): void => {
    undoStackRef.current.push({ message, undo })
    showNotice(message)
  }, [showNotice])
  const undoLast = useCallback((): void => {
    const entry = undoStackRef.current.pop()
    if (!entry) { showNotice('没有可撤回的本次操作'); return }
    void entry.undo().then(() => showNotice(`已撤回：${entry.message}`)).catch((cause) => setActionError(cause instanceof Error ? cause.message : '撤回失败'))
  }, [showNotice])

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    try { setActionError(''); directCaptureChangeRef.current = true; await action(); await syncCaptures() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : '操作失败') }
  }
  const discardCapture = useCallback(async (captureId: string): Promise<void> => {
    if (!window.creatorOS) return
    setContextMenu(null)
    setActionError('')
    try {
      await window.creatorOS.setCaptureUseStatus(captureId, 'discarded')
      await syncCaptures()
      rememberUndo('已将1条灵感移入回收站', async () => {
        await window.creatorOS!.setCaptureUseStatus(captureId, 'active')
        await syncCaptures()
      })
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '移入回收站失败')
    }
  }, [rememberUndo, syncCaptures])
  const runInboxClassification = async (): Promise<void> => {
    if (!window.creatorOS) return
    setClassifying(true); setMoreOpen(false); setActionError('')
    try {
      const task = await window.creatorOS.startCaptureClassification()
      if (!task) throw new Error('Codex尚未通过安全验证，或收件箱没有待归类记录')
      await syncCaptures()
      showNotice(`${task.title}已开始，完成后点右侧刷新载入结果`)
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Codex归类启动失败'
      setActionError(message)
      showNotice(message)
    }
    finally { setClassifying(false) }
  }
  const runExactDeduplication = async (): Promise<void> => {
    if (!window.creatorOS) return
    setDeduplicating(true); setMoreOpen(false); setActionError('')
    try {
      const result = await window.creatorOS.deduplicateCapturesExact()
      await syncCaptures()
      if (!result.duplicateCount) {
        showNotice(`已检查${result.scannedCount}条记录，没有发现完全相同内容`)
        return
      }
      rememberUndo(`已保留${result.duplicateGroupCount}条原记录，${result.duplicateCount}条重复项已移入回收站`, async () => {
        for (const item of result.discarded) await window.creatorOS!.setCaptureUseStatus(item.captureId, item.previousUseStatus)
        await syncCaptures()
      })
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '查重整理失败')
    } finally {
      setDeduplicating(false)
    }
  }
  const openDestination = (capture: CaptureRecord): void => {
    if (capture.primaryProjectId) navigate({ page: 'project', projectId: capture.primaryProjectId, moduleKey: 'materials' })
    else if (capture.linkedTopicId) navigate({ page: 'topics' })
  }
  const acceptSuggestion = useCallback(async (capture: CaptureRecord): Promise<boolean> => {
    if (!window.creatorOS || capture.classificationStatus !== 'suggested') return false
    if (capture.captureKind === 'project_content' && capture.suggestedProjectId) {
      await window.creatorOS.confirmCaptureClassification(capture.id, capture.suggestedProjectId, capture.suggestedContentTypeId, 'project_content')
      return true
    }
    if (capture.captureKind === 'topic_idea' && capture.suggestedContentTypeId) {
      await window.creatorOS.confirmCaptureClassification(capture.id, null, capture.suggestedContentTypeId, 'topic_idea')
      return true
    }
    if (capture.captureKind === 'general_record' && capture.generalCategoryId) {
      await window.creatorOS.confirmCaptureClassification(capture.id, null, null, 'general_record', capture.generalCategoryId)
      return true
    }
    return false
  }, [])
  const acceptOne = useCallback(async (capture: CaptureRecord): Promise<void> => {
    const accepted = await acceptSuggestion(capture)
    if (!accepted) { setSelectedCaptureId(capture.id); setQueue('review'); setViewMode('card'); setCardOpen(true); return }
    await syncCaptures()
    rememberUndo('已接受1条建议', async () => { await window.creatorOS!.undoCaptureClassification(capture.id); await syncCaptures() })
  }, [acceptSuggestion, rememberUndo, syncCaptures])
  const rejectSuggestion = useCallback(async (capture: CaptureRecord): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.undoCaptureClassification(capture.id); await syncCaptures()
    showNotice('已退回收件箱，Codex建议仍保留在操作记录中')
  }, [showNotice, syncCaptures])
  const acceptBatch = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) return
    const targets = queueRecords.filter((capture) => capture.classificationStatus === 'suggested')
    const acceptedIds: string[] = []
    setBatchWorking(true); setActionError('')
    try {
      for (const capture of targets) if (await acceptSuggestion(capture)) acceptedIds.push(capture.id)
      await syncCaptures()
      if (!acceptedIds.length) { showNotice('当前建议需要逐条补充去向'); return }
      rememberUndo(`已接受${acceptedIds.length}条建议`, async () => {
        for (const captureId of [...acceptedIds].reverse()) await window.creatorOS!.undoCaptureClassification(captureId)
        await syncCaptures()
      })
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '批量接受失败') }
    finally { setBatchWorking(false) }
  }, [acceptSuggestion, queueRecords, rememberUndo, showNotice, syncCaptures])
  const convertToTopicIdea = useCallback(async (capture: CaptureRecord): Promise<void> => {
    if (!window.creatorOS) return
    setActionError('')
    try {
      const projectTypeId = projects.find((project) => project.id === (capture.primaryProjectId ?? capture.suggestedProjectId))?.contentTypeId
      const contentTypeId = capture.suggestedContentTypeId ?? projectTypeId
      if (!contentTypeId) {
        setTopicEditorId(capture.id); setTopicDirectionId(contentDirections[0]?.id ?? '')
        return
      }
      await window.creatorOS.confirmCaptureClassification(capture.id, null, contentTypeId, 'topic_idea'); await syncCaptures()
      rememberUndo('已转为选题灵感', async () => { await window.creatorOS!.undoCaptureClassification(capture.id); await syncCaptures() })
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '转换失败') }
  }, [contentDirections, projects, rememberUndo, syncCaptures])
  const saveTopicConversion = useCallback(async (capture: CaptureRecord): Promise<void> => {
    if (!window.creatorOS || !topicDirectionId) return
    try {
      await window.creatorOS.confirmCaptureClassification(capture.id, null, topicDirectionId, 'topic_idea'); await syncCaptures()
      setTopicEditorId(null); setTopicDirectionId('')
      rememberUndo('已转为选题灵感', async () => { await window.creatorOS!.undoCaptureClassification(capture.id); await syncCaptures() })
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '转换失败') }
  }, [rememberUndo, syncCaptures, topicDirectionId])
  const saveContentDestination = useCallback(async (capture: CaptureRecord): Promise<void> => {
    if (!window.creatorOS || !destinationProjectId) return
    setActionError('')
    try {
      const project = projects.find((item) => item.id === destinationProjectId)
      if (!project) throw new Error('请选择一个项目')
      await window.creatorOS.confirmCaptureClassification(capture.id, project.id, project.contentTypeId, 'project_content'); await syncCaptures()
      setDestinationEditorId(null); setDestinationProjectId('')
      rememberUndo('已转为内容灵感并关联项目', async () => { await window.creatorOS!.undoCaptureClassification(capture.id); await syncCaptures() })
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '转换失败') }
  }, [destinationProjectId, projects, rememberUndo, syncCaptures])
  const saveGeneralDestination = useCallback(async (capture: CaptureRecord): Promise<void> => {
    if (!window.creatorOS || !categoryDestinationId) return
    setActionError('')
    try {
      await window.creatorOS.confirmCaptureClassification(capture.id, null, null, 'general_record', categoryDestinationId); await syncCaptures()
      setCategoryEditorId(null); setCategoryDestinationId('')
      rememberUndo('已转为通用记录', async () => { await window.creatorOS!.undoCaptureClassification(capture.id); await syncCaptures() })
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '转换失败') }
  }, [categoryDestinationId, rememberUndo, syncCaptures])
  const selectedProject = selectedCapture ? projects.find((project) => project.id === (selectedCapture.primaryProjectId ?? selectedCapture.suggestedProjectId)) : null
  const selectedTopic = selectedCapture ? topics.find((topic) => topic.id === selectedCapture.linkedTopicId) : null
  const selectedGeneralCategory = selectedCapture ? generalRecordCategories.find((category) => category.id === selectedCapture.generalCategoryId) : null

  return <main className="page inspiration-page">
    <header className="page-header inspiration-page-header"><div><h1>灵感库</h1></div><div className="inspiration-page-actions"><button onClick={() => showStagePreview('批量导入会接入录音、截图、文字与链接')}>+导入</button><button aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)}><Filter size={14} />筛选</button><button aria-label="更多操作" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal size={16} /></button>{filterOpen ? <section className="inspiration-popover filter-popover" role="dialog" aria-label="筛选灵感"><label>内容方向<ContentTypeSelect value={directionFilter} onChange={(event) => setDirectionFilter(event.currentTarget.value)}><option value="">全部方向</option>{contentDirections.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</ContentTypeSelect></label><label>关联项目<AppSelect value={projectFilter} onChange={(event) => setProjectFilter(event.currentTarget.value)}><option value="">全部活跃项目</option>{projects.filter((project) => project.topicStageRole === 'project_created' && !project.trashedAt).map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}</AppSelect></label><label>来源<AppSelect value={sourceFilter} onChange={(event) => setSourceFilter(event.currentTarget.value as CaptureRecord['sourceType'] | '')}><option value="">全部来源</option>{Object.entries(sourceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</AppSelect></label><button onClick={() => { setDirectionFilter(''); setProjectFilter(''); setSourceFilter(''); setFilterOpen(false) }}>清空筛选</button></section> : null}{moreOpen ? <section className="inspiration-popover more-popover" role="menu"><button role="menuitem" disabled={classifying || !counts.inbox} onClick={() => void runInboxClassification()}><Sparkles size={14} />Codex归类收件箱<span>{counts.inbox}条</span></button><button role="menuitem" disabled={deduplicating || !captures.some((capture) => capture.useStatus === 'active')} onClick={() => void runExactDeduplication()}><Search size={14} />查重整理<span>完全相同</span></button><button role="menuitem" onClick={() => { setMoreOpen(false); setDirectionManagerOpen(true) }}>管理内容方向</button><button role="menuitem" onClick={() => { setMoreOpen(false); setCategoryManagerOpen(true) }}>管理通用记录分类</button></section> : null}</div></header>
    <section className="inspiration-shell">
      <div className="inspiration-toolbar"><nav className="inspiration-path-tabs" aria-label="灵感路径">{([['all', '全部'], ['topic_idea', '选题灵感'], ['project_content', '内容灵感'], ['general_record', '通用记录']] as const).map(([value, label]) => <button key={value} aria-pressed={path === value} className={path === value ? 'active' : ''} onClick={() => { setPath(value); if (value !== 'general_record') setGeneralCategoryFilter('') }}>{label}</button>)}</nav><label className="inspiration-search"><Search size={14} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="只搜灵感与记录（含暂存）" /></label><button className={`inspiration-refresh${pendingResults ? ' has-new' : ''}`} aria-label={pendingResults ? `载入新结果${pendingResults}条` : '载入新结果'} title={pendingResults ? `有${pendingResults}条后台结果待载入` : '当前没有待载入的新结果'} onClick={loadPendingResults}><RefreshCw size={14} />{pendingResults ? <span>{pendingResults}</span> : null}</button></div>
      <div className="inspiration-workspace" style={{ '--inspector-width': `${preferences.inspectorWidth}px` } as React.CSSProperties}>
        <aside className="inspiration-facets"><b>需要你处理</b><button className={queue === 'inbox' ? 'active' : ''} onClick={() => switchQueue('inbox')}>收件箱<span>{counts.inbox}</span></button><button className={queue === 'review' ? 'active' : ''} onClick={() => switchQueue('review')}>待我确认<span>{counts.review}</span></button><b>抽查与记录</b><button className={queue === 'processed' ? 'active' : ''} onClick={() => switchQueue('processed')}>{path === 'topic_idea' ? '已建选题候选' : '已自动处理'}<span>{counts.processed}</span></button>{path === 'general_record' ? <><b>分类</b><button className={!generalCategoryFilter ? 'active' : ''} onClick={() => setGeneralCategoryFilter('')}>全部分类<span>{captures.filter((capture) => capture.captureKind === 'general_record').length}</span></button>{generalRecordCategories.filter((category) => category.isActive).map((category) => <button key={category.id} className={generalCategoryFilter === category.id ? 'active' : ''} onClick={() => setGeneralCategoryFilter(category.id)}>{category.name}<span>{captures.filter((capture) => capture.captureKind === 'general_record' && capture.generalCategoryId === category.id).length}</span></button>)}<button className="inspiration-manage-facet" onClick={() => setCategoryManagerOpen(true)}>＋管理分类</button></> : null}<b>稍后处理</b><button className={queue === 'parked' ? 'active' : ''} onClick={() => switchQueue('parked')}>暂存<span>{counts.parked}</span></button><p className="inspiration-facet-hint">弃用的灵感已移入<button className="inspiration-facet-link" onClick={() => navigate({ page: 'recycle' })}>回收站</button></p></aside>
        <section className="inspiration-records"><header><h2>{query ? '搜索结果' : queueLabels[queue]}</h2><span>{queueRecords.length}条</span>{queue === 'review' && !query && queueRecords.length ? <button className="inspiration-batch-action" disabled={batchWorking} onClick={() => void acceptBatch()}>{batchWorking ? '处理中…' : '批量接受'}</button> : null}{['inbox', 'review'].includes(queue) && !query ? <div className="inspiration-view-toggle"><button className={viewMode === 'list' ? 'active' : ''} onClick={() => { setViewMode('list'); localStorage.setItem('ly.creator-os.idea-view', 'list') }}>列表</button><button ref={cardTriggerRef} className={viewMode === 'card' ? 'active' : ''} disabled={!cardRecords.length} onClick={() => { setViewMode('card'); setCardOpen(true); localStorage.setItem('ly.creator-os.idea-view', 'card') }}>卡片</button></div> : null}</header><div className="inspiration-record-list">{queueRecords.map((capture) => {
          const project = projects.find((item) => item.id === (capture.primaryProjectId ?? capture.suggestedProjectId)); const topic = topics.find((item) => item.id === capture.linkedTopicId)
          const generalCategory = generalRecordCategories.find((category) => category.id === capture.generalCategoryId)
          return <article id={`inspiration-record-${capture.id}`} className={`inspiration-record${selectedCapture?.id === capture.id ? ' active' : ''}`} key={capture.id} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ anchor: event.currentTarget, captureId: capture.id }) }}><button className="inspiration-record-main" onClick={(event) => { setSelectedCaptureId(capture.id); openDrawer(event.currentTarget) }}><b>{captureTitle(capture.originalContent)}</b></button><div className="inspiration-record-meta"><CaptureAttachmentList capture={capture} compact />{capture.generalCategoryId ? <button className="destination-chip" onClick={() => { setPath('general_record'); setGeneralCategoryFilter(capture.generalCategoryId ?? '') }}>→{generalCategory?.name ?? '已停用分类'}</button> : capture.primaryProjectId || capture.linkedTopicId ? <button className="destination-chip" onClick={() => openDestination(capture)}>→{project?.title ?? topic?.title}</button> : capture.classificationStatus === 'suggested' ? <button className="destination-chip suggestion-chip" onClick={(event) => { setSelectedCaptureId(capture.id); openDrawer(event.currentTarget) }}>建议→{project?.title ?? contentTypes.find((type) => type.id === capture.suggestedContentTypeId)?.name ?? '待补充'}</button> : <span>{capturePathLabel(capture)}</span>}{capture.classificationStatus === 'suggested' ? <span className="inspiration-inline-actions"><button aria-label={`接受建议：${captureTitle(capture.originalContent)}`} onClick={() => void acceptOne(capture)}><Check size={12} />接受</button><button aria-label={`退回收件箱：${captureTitle(capture.originalContent)}`} onClick={() => void rejectSuggestion(capture)}><X size={12} />退回</button></span> : null}{queue === 'processed' && capture.classificationActor === 'system' ? <button className="inspiration-row-undo" onClick={() => void runAction(() => window.creatorOS!.undoCaptureClassification(capture.id))}>撤销</button> : null}<time>{new Date(capture.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></div></article>
        })}{!queueRecords.length ? <div className="inspiration-empty"><Inbox size={24} /><b>{query ? '没有找到相关灵感' : `${queueLabels[queue]}暂时为空`}</b><span>{queue === 'review' ? '今天没有需要你确认的内容。' : '新的快速记录会保留原始内容。'}</span>{queue === 'review' && counts.processed ? <button onClick={() => switchQueue('processed')}>抽查低可信自动结果→</button> : null}</div> : null}</div></section>
        <ResizableInspectorDivider width={preferences.inspectorWidth} ariaLabel="调整右侧详情宽度" onCommit={(width) => setPreferences({ inspectorWidth: width })} onError={() => showNotice('右侧详情宽度保存失败')} />
        <aside className={`inspiration-detail resizable-detail-pane${detailDrawerOpen ? ' drawer-open' : ''}`} role={detailDrawerOpen ? 'dialog' : undefined} aria-labelledby={detailDrawerOpen ? 'inspiration-detail-title' : undefined}><button ref={closeButtonRef} className="inspector-drawer-close" aria-label="关闭右侧详情" onClick={closeDrawer}><X size={15} /></button><h2 id="inspiration-detail-title">{selectedCapture ? captureTitle(selectedCapture.originalContent) : 'Codex处理记录'}</h2>{selectedCapture ? <><p className="inspiration-original">{selectedCapture.originalContent || '这条记录只包含附件。'}</p><CaptureAttachmentList capture={selectedCapture} /><dl>{selectedCapture.captureKind !== 'general_record' ? <div><dt>去向</dt><dd>{selectedProject?.title ?? selectedTopic?.title ?? '尚未确定'}</dd></div> : null}{selectedCapture.captureKind === 'general_record' && selectedGeneralCategory ? <div><dt>分类</dt><dd>{selectedGeneralCategory.name}</dd></div> : selectedCapture.usageType ? <div><dt>用途</dt><dd>{usageLabels[selectedCapture.usageType]}</dd></div> : null}<div><dt>后续</dt><dd>{selectedCapture.classificationStatus === 'unprocessed' ? '等待手动归类' : selectedCapture.classificationStatus === 'suggested' ? '等待你确认建议' : '已完成当前处理'}</dd></div></dl>{selectedCapture.classificationReason ? <details><summary>为什么这样处理</summary><p>{capturePathLabel(selectedCapture)}·{selectedCapture.classificationReason}{selectedCapture.classificationConfidence !== null ? `·可信度${Math.round(selectedCapture.classificationConfidence * 100)}%` : ''}</p></details> : null}<div className="inspiration-detail-actions">{selectedCapture.classificationStatus === 'unprocessed' ? <button className="primary-action" onClick={() => { setQueue('inbox'); setViewMode('card'); setCardOpen(true) }}>进入卡片归类</button> : null}{selectedCapture.classificationStatus === 'suggested' ? <button className="primary-action" onClick={() => { setQueue('review'); setViewMode('card'); setCardOpen(true) }}>处理这条建议</button> : null}{selectedCapture.classificationStatus === 'confirmed' && (selectedCapture.primaryProjectId || selectedCapture.linkedTopicId) ? <button onClick={() => openDestination(selectedCapture)}>{selectedCapture.primaryProjectId ? '打开所属项目' : '在选题管理中查看'}</button> : null}{selectedCapture.captureKind !== 'topic_idea' ? <button onClick={() => void convertToTopicIdea(selectedCapture)}>转为选题灵感</button> : null}{selectedCapture.captureKind !== 'project_content' ? <button onClick={() => { setDestinationEditorId(selectedCapture.id); setDestinationProjectId(selectedCapture.suggestedProjectId ?? '') }}>转为内容灵感</button> : null}{selectedCapture.captureKind !== 'general_record' ? <button onClick={() => { setCategoryEditorId(selectedCapture.id); setCategoryDestinationId('') }}>转为通用记录</button> : null}{selectedCapture.classificationStatus === 'confirmed' ? <button onClick={() => void runAction(() => window.creatorOS!.undoCaptureClassification(selectedCapture.id))}>撤销归类</button> : null}{selectedCapture.useStatus !== 'active' ? <button onClick={() => void runAction(() => window.creatorOS!.setCaptureUseStatus(selectedCapture.id, 'active'))}>恢复</button> : null}</div>{destinationEditorId === selectedCapture.id ? <section className="inspiration-destination-editor"><label>内容项目<AppSelect aria-label="转为内容灵感的项目" value={destinationProjectId} onChange={(event) => setDestinationProjectId(event.currentTarget.value)}><option value="">选择活跃项目</option>{projects.filter((project) => project.topicStageRole === 'project_created' && !project.trashedAt).map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}</AppSelect></label><div><button onClick={() => { setDestinationEditorId(null); setDestinationProjectId('') }}>取消</button><button className="primary-action" disabled={!destinationProjectId} onClick={() => void saveContentDestination(selectedCapture)}>确认转换</button></div></section> : null}{topicEditorId === selectedCapture.id ? <section className="inspiration-destination-editor"><label>内容方向<AppSelect aria-label="转为选题灵感的内容方向" value={topicDirectionId} onChange={(event) => setTopicDirectionId(event.currentTarget.value)}><option value="">选择内容方向</option>{contentDirections.map((direction) => <option value={direction.id} key={direction.id}>{direction.name}</option>)}</AppSelect></label><div><button onClick={() => { setTopicEditorId(null); setTopicDirectionId('') }}>取消</button><button className="primary-action" disabled={!topicDirectionId} onClick={() => void saveTopicConversion(selectedCapture)}>确认转换</button></div></section> : null}{categoryEditorId === selectedCapture.id ? <section className="inspiration-destination-editor"><label>通用记录分类<AppSelect aria-label="转为通用记录的分类" value={categoryDestinationId} onChange={(event) => setCategoryDestinationId(event.currentTarget.value)}><option value="">选择已有分类</option>{generalRecordCategories.filter((category) => category.isActive).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</AppSelect></label><div><button onClick={() => setCategoryManagerOpen(true)}>＋新建分类</button><span /><button onClick={() => { setCategoryEditorId(null); setCategoryDestinationId('') }}>取消</button><button className="primary-action" disabled={!categoryDestinationId} onClick={() => void saveGeneralDestination(selectedCapture)}>确认转换</button></div></section> : null}{actionError ? <p className="form-error" role="alert">{actionError}</p> : null}</> : <p>选择一条记录查看完整原文和处理理由。</p>}</aside>
      </div>
    </section>
    {cardOpen && ['inbox', 'review'].includes(queue) ? <TriageOverlay queue={queue as 'inbox' | 'review'} records={cardRecords} projects={projects} contentTypes={contentTypes} generalCategories={generalRecordCategories} topics={topics} topicStages={topicStages} startId={selectedCapture?.id ?? null} onClose={() => { setCardOpen(false); setViewMode('list'); localStorage.setItem('ly.creator-os.idea-view', 'list') }} onChanged={syncCaptures} onDecision={rememberUndo} onUndoLast={undoLast} /> : null}
    {directionManagerOpen ? <ClassificationDefinitionManager ariaLabel="管理内容方向" title="管理内容方向" definitions={contentTypes} newNameLabel="新内容方向名称" newNamePlaceholder="例如：AI实战日志" addButtonLabel="新增内容方向" descriptionPlaceholder="例如：以AI工具、模型、自动化和实战过程为主，不包含单纯的软件资讯。" canReorder onClose={() => setDirectionManagerOpen(false)} onChanged={refresh} onCreate={(name) => window.creatorOS!.createContentType(name)} onUpdate={(id, patch) => window.creatorOS!.updateContentType(id, patch)} onReorder={(ids) => window.creatorOS!.reorderContentTypes(ids)} /> : null}
    {categoryManagerOpen ? <ClassificationDefinitionManager ariaLabel="管理通用记录分类" title="管理通用记录分类" definitions={generalRecordCategories} newNameLabel="新通用记录分类名称" newNamePlaceholder="例如：阅读摘录" addButtonLabel="新增通用记录分类" descriptionPlaceholder="例如：书籍、文章和论文中的摘录、观点与延伸思考。" onClose={() => setCategoryManagerOpen(false)} onChanged={refresh} onCreate={(name) => window.creatorOS!.createGeneralRecordCategory(name)} onUpdate={(id, patch) => window.creatorOS!.updateGeneralRecordCategory(id, patch)} /> : null}
    {contextMenu ? <AnchoredPopover anchor={contextMenu.anchor} className="topic-context-menu topic-property-popover" role="menu" ariaLabel="灵感操作" onDismiss={() => setContextMenu(null)}><button className="danger" role="menuitem" onClick={() => void discardCapture(contextMenu.captureId)}>移入回收站</button></AnchoredPopover> : null}
    {notice ? <div className="inspiration-toast" role="status"><span>{notice}</span>{undoStackRef.current.length ? <button onClick={undoLast}>撤销</button> : null}</div> : null}
  </main>
}
