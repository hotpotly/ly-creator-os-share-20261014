import { ClassificationFields, ClassificationSelect, SavedClassificationControl } from './ClassificationFields'
import { videoFormatLabel, projectKindLabel } from '../../../shared/content-classification'
import { MonthDateLabel, TopicStageLabel } from './FieldLabel'
import { ContentTypeLabel } from './ContentTypeLabel'
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, Columns3, ExternalLink, Filter, Settings2, Sparkles, Star, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CreateTopicInput, TopicColumnDefinition, TopicRecord, TopicStageDefinition, UpdateTopicInput } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { TopicColumnManager } from './TopicColumnManager'
import { TopicStageManager } from './TopicStageManager'

type TopicStageFilter = 'all' | string
type ActiveProperty = { topicId: string; property: string } | null
type TopicSort = { columnId: string; direction: 'asc' | 'desc' } | null
type TopicContextMenu = { anchor: HTMLTableRowElement; topicId: string } | null

function varianceLabel(days: number | null, completed: boolean): string {
  if (days === null) return '—'
  if (days === 0) return '按期'
  return days > 0 ? `${completed ? '延迟' : '逾期'}${days}天` : `提前${Math.abs(days)}天`
}

function TopicStars({ level, onChange }: { level: number; onChange(level: number): void }): React.JSX.Element {
  return <span className="topic-stars" aria-label={`重要程度${level}星`}>{[1, 2, 3].map((star) => <button key={star} aria-label={`设为${star}星`} aria-pressed={level >= star} onClick={() => onChange(level === star ? 0 : star)}><Star size={14} fill={level >= star ? 'currentColor' : 'none'} /></button>)}</span>
}

function TopicDialogDateField({ label, onChange, today, value }: { label: string; onChange(value: string | null): void; today: string; value: string | null }): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!anchor) return
    const close = (event: MouseEvent): void => {
      if (!(event.target as Element).closest('.topic-dialog-date-field, .anchored-popover-layer')) setAnchor(null)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setAnchor(null) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [anchor])
  return <div className="topic-dialog-date-field">
    <span>{label}</span>
    <button aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor((current) => current ? null : event.currentTarget)} type="button"><CalendarDays size={14} /><MonthDateLabel value={value} empty="未设置" /></button>
    {anchor ? <AnchoredPopover anchor={anchor} ariaLabel={`设置${label}`} className="topic-date-popover modal-calendar-popover" onDismiss={() => setAnchor(null)}><CalendarDatePicker label={label} onChange={(next) => { onChange(next); setAnchor(null) }} today={today} value={value} /></AnchoredPopover> : null}
  </div>
}

function NewTopicDialog({ onClose, onCreated, stages, today }: { onClose(): void; onCreated(topic: TopicRecord): void; stages: TopicStageDefinition[]; today: string }): React.JSX.Element {
  const contentTypes = useWorkspaceStore((state) => state.snapshot.contentTypes).filter((type) => type.isActive)
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const availableStages = stages
  const titleRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState<CreateTopicInput>({
    title: '', coreAngle: '', contentTypeId: contentTypes[0]?.id ?? '', importanceLevel: 0, needsMoreExperience: false,
    startAt: null, expectedCompletionAt: null, actualCompletionAt: null, stageId: availableStages[0]?.id ?? ''
  })
  const [classifying, setClassifying] = useState(false)
  const [classifyNote, setClassifyNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { window.setTimeout(() => titleRef.current?.focus(), 0) }, [])

  const runClassify = useCallback(async (): Promise<void> => {
    if (!window.creatorOS || !input.title.trim()) return
    setClassifying(true)
    try {
      const result = await window.creatorOS.classifyProjectDraft(input.title.trim(), input.coreAngle.trim())
      const suggestedTypeId = result.contentTypeId
      if (suggestedTypeId && result.confidence >= 0.6) {
        setInput((current) => ({ ...current, contentTypeId: suggestedTypeId }))
        setClassifyNote(`AI 已归类·${result.reason}`)
      } else {
        setClassifyNote('AI没把握，请手动选择内容方向')
      }
    } catch { setClassifyNote('') } finally { setClassifying(false) }
  }, [input.title, input.coreAngle])

  useEffect(() => {
    if (!preferences.autoClassifyNewProject || !input.title.trim()) return
    const timer = window.setTimeout(() => void runClassify(), 700)
    return () => window.clearTimeout(timer)
  }, [preferences.autoClassifyNewProject, input.title, input.coreAngle, runClassify])

  const save = async (): Promise<void> => {
    if (!window.creatorOS || !input.title.trim() || !input.stageId) return
    setSaving(true)
    setError('')
    try { const topic = await window.creatorOS.createTopic(input); onCreated(topic) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '选题创建失败') }
    finally { setSaving(false) }
  }

  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-topic-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && event.metaKey) void save() }}>
      <header><div><span>选题管理</span><h2 id="new-topic-title">新建选题</h2></div><button aria-label="关闭新建选题" onClick={onClose}><X size={18} /></button></header>
      <div className="dialog-body">
        <div className="np-title-row">
          <input ref={titleRef} aria-label="选题名称" value={input.title} maxLength={80} onChange={(event) => { const title = event.currentTarget.value; setInput((current) => ({ ...current, title })) }} placeholder="写下这期想做什么" />
          <button type="button" className="np-ai" aria-label="AI 自动归类" title="让 AI 按标题归类内容方向" disabled={classifying || !input.title.trim()} onClick={() => void runClassify()}><Sparkles size={17} /></button>
        </div>
        <textarea className="np-desc" aria-label="核心角度" value={input.coreAngle} onChange={(event) => { const coreAngle = event.currentTarget.value; setInput((current) => ({ ...current, coreAngle })) }} placeholder="这期最重要的判断或切入点（选填）" />
        <div className="np-smart np-smart-expanded">
          <div className="np-smart-head"><span>{classifying ? 'AI归类中…' : classifyNote || '选题设置'}</span></div>
          <ClassificationFields videoFormat={input.videoFormat} isCommercial={input.isCommercial} onChange={patch => setInput(current => ({ ...current, ...patch }))} />
          <div className="np-grp" role="group" aria-label="内容方向"><p>内容方向</p><div className="np-chips">{contentTypes.map((type) => <button type="button" key={type.id} className={`np-chip${input.contentTypeId === type.id ? ' on' : ''}`} aria-pressed={input.contentTypeId === type.id} onClick={() => setInput((current) => ({ ...current, contentTypeId: type.id }))}><ContentTypeLabel id={type.id} name={type.name} /></button>)}</div></div>
          <div className="np-grp" role="group" aria-label="选题阶段"><p>阶段</p><div className="np-chips">{availableStages.map((stage) => <button type="button" key={stage.id} className={`np-chip${input.stageId === stage.id ? ' on' : ''}`} aria-pressed={input.stageId === stage.id} onClick={() => setInput((current) => ({ ...current, stageId: stage.id }))}><TopicStageLabel stage={stage} /></button>)}</div></div>
          <div className="topic-dialog-field-row"><label className="topic-dialog-stars">重要程度<TopicStars level={input.importanceLevel} onChange={(level) => setInput((current) => ({ ...current, importanceLevel: level }))} /></label><button type="button" className={`np-chip${input.needsMoreExperience ? ' on' : ''}`} aria-pressed={input.needsMoreExperience} onClick={() => setInput((current) => ({ ...current, needsMoreExperience: !current.needsMoreExperience }))}>需补体验</button></div>
          <div className="topic-dialog-grid">
            <TopicDialogDateField label="开始时间" onChange={(startAt) => setInput((current) => ({ ...current, startAt }))} today={today} value={input.startAt} />
            <TopicDialogDateField label="目标日" onChange={(expectedCompletionAt) => setInput((current) => ({ ...current, expectedCompletionAt }))} today={today} value={input.expectedCompletionAt} />
            <TopicDialogDateField label="实际完成" onChange={(actualCompletionAt) => setInput((current) => ({ ...current, actualCompletionAt }))} today={today} value={input.actualCompletionAt} />
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer><span>⌘Enter 创建</span><button onClick={onClose}>取消</button><button className="primary-action" disabled={saving || !input.title.trim() || !input.stageId} onClick={() => void save()}>{saving ? '创建中…' : '新建选题'}</button></footer>
    </section>
  </div>
}

function EditTopicDialog({
  topic,
  stages,
  today,
  onClose,
  onSaved
}: {
  topic: TopicRecord
  stages: TopicStageDefinition[]
  today: string
  onClose(): void
  onSaved(): void
}): React.JSX.Element {
  const contentTypes = useWorkspaceStore((state) => state.snapshot.contentTypes)
  const [input, setInput] = useState<CreateTopicInput>({
    title: topic.title,
    coreAngle: topic.coreAngle,
    contentTypeId: topic.contentTypeId, videoFormat: topic.videoFormat ?? null, isCommercial: topic.isCommercial ?? false,
    importanceLevel: topic.importanceLevel,
    needsMoreExperience: topic.needsMoreExperience,
    startAt: topic.startAt,
    expectedCompletionAt: topic.expectedCompletionAt,
    actualCompletionAt: topic.actualCompletionAt,
    stageId: topic.stageId
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (): Promise<void> => {
    if (!window.creatorOS || !input.title.trim() || !input.stageId) return
    const patch: UpdateTopicInput = {}
    if ((input.videoFormat ?? null) !== (topic.videoFormat ?? null)) patch.videoFormat = input.videoFormat ?? null
    if (Boolean(input.isCommercial) !== Boolean(topic.isCommercial)) patch.isCommercial = Boolean(input.isCommercial)
    if (input.title.trim() !== topic.title) patch.title = input.title.trim()
    if (input.coreAngle !== topic.coreAngle) patch.coreAngle = input.coreAngle
    if (input.contentTypeId !== topic.contentTypeId) patch.contentTypeId = input.contentTypeId
    if (input.importanceLevel !== topic.importanceLevel) patch.importanceLevel = input.importanceLevel
    if (input.needsMoreExperience !== topic.needsMoreExperience) patch.needsMoreExperience = input.needsMoreExperience
    if (input.startAt !== topic.startAt) patch.startAt = input.startAt
    if (input.expectedCompletionAt !== topic.expectedCompletionAt) patch.expectedCompletionAt = input.expectedCompletionAt
    if (input.actualCompletionAt !== topic.actualCompletionAt) patch.actualCompletionAt = input.actualCompletionAt
    if (input.stageId !== topic.stageId) patch.stageId = input.stageId
    if (Object.keys(patch).length === 0) { onClose(); return }
    setSaving(true)
    setError('')
    try {
      await window.creatorOS.updateTopic(topic.id, patch)
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '选题保存失败')
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="new-project-dialog topic-full-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-topic-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && event.metaKey) void save() }}>
      <header><div><span>选题管理</span><h2 id="edit-topic-title">编辑所有内容</h2></div><button aria-label="关闭编辑选题" onClick={onClose}><X size={18} /></button></header>
      <div className="dialog-body">
        <input className="np-full-title" autoFocus aria-label="选题名称" value={input.title} maxLength={80} onChange={(event) => setInput((current) => ({ ...current, title: event.currentTarget.value }))} />
        <textarea className="np-desc" aria-label="核心角度" value={input.coreAngle} onChange={(event) => setInput((current) => ({ ...current, coreAngle: event.currentTarget.value }))} placeholder="这期最重要的判断或切入点（选填）" />
        <div className="np-smart np-smart-expanded">
          <ClassificationFields videoFormat={input.videoFormat} isCommercial={input.isCommercial} onChange={patch => setInput(current => ({ ...current, ...patch }))} />
          <div className="np-grp" role="group" aria-label="内容方向"><p>内容方向</p><div className="np-chips">{contentTypes.filter((type) => type.isActive || type.id === input.contentTypeId).map((type) => <button type="button" key={type.id} disabled={!type.isActive} className={`np-chip${input.contentTypeId === type.id ? ' on' : ''}`} aria-pressed={input.contentTypeId === type.id} onClick={() => setInput((current) => ({ ...current, contentTypeId: type.id }))}><ContentTypeLabel id={type.id} name={type.name} /></button>)}</div></div>
          <div className="np-grp" role="group" aria-label="选题阶段"><p>阶段</p><div className="np-chips">{stages.map((stage) => <button type="button" key={stage.id} className={`np-chip${input.stageId === stage.id ? ' on' : ''}`} aria-pressed={input.stageId === stage.id} onClick={() => setInput((current) => ({ ...current, stageId: stage.id }))}><TopicStageLabel stage={stage} /></button>)}</div></div>
          <div className="topic-dialog-field-row"><label className="topic-dialog-stars">重要程度<TopicStars level={input.importanceLevel} onChange={(level) => setInput((current) => ({ ...current, importanceLevel: level }))} /></label><button type="button" className={`np-chip${input.needsMoreExperience ? ' on' : ''}`} aria-pressed={input.needsMoreExperience} onClick={() => setInput((current) => ({ ...current, needsMoreExperience: !current.needsMoreExperience }))}>需补体验</button></div>
          <div className="topic-dialog-grid">
            <TopicDialogDateField label="开始时间" onChange={(startAt) => setInput((current) => ({ ...current, startAt }))} today={today} value={input.startAt} />
            <TopicDialogDateField label="目标日" onChange={(expectedCompletionAt) => setInput((current) => ({ ...current, expectedCompletionAt }))} today={today} value={input.expectedCompletionAt} />
            <TopicDialogDateField label="实际完成" onChange={(actualCompletionAt) => setInput((current) => ({ ...current, actualCompletionAt }))} today={today} value={input.actualCompletionAt} />
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer><span>⌘Enter 保存</span><button onClick={onClose}>取消</button><button className="primary-action" disabled={saving || !input.title.trim() || !input.stageId} onClick={() => void save()}>{saving ? '保存中…' : '保存全部修改'}</button></footer>
    </section>
  </div>
}

export function TopicManagementPage({ newTopicOpen, onNewTopicOpenChange, highlightedTopicId }: { newTopicOpen: boolean; onNewTopicOpenChange(open: boolean): void; highlightedTopicId?: string }): React.JSX.Element {
  const { topics: allTopics, topicStages, topicColumns, contentTypes, captures, projects, today } = useWorkspaceStore((state) => state.snapshot)
  const topics = useMemo(() => allTopics.filter((topic) => {
    if (topic.trashedAt) return false
    if (!topic.createdProjectId) return true
    return !projects.find((project) => project.id === topic.createdProjectId)?.trashedAt
  }), [allTopics, projects])
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [stageFilter, setStageFilter] = useState<TopicStageFilter>('all')
  const [needsExperience, setNeedsExperience] = useState(false)
  const [starred, setStarred] = useState(false)
  const [directionFilter, setDirectionFilter] = useState('')
  const [videoFilter, setVideoFilter] = useState(''), [kindFilter, setKindFilter] = useState('')
  const [activeProperty, setActiveProperty] = useState<ActiveProperty>(null)
  const [activeAnchor, setActiveAnchor] = useState<HTMLElement | null>(null)
  const [stageFilterAnchor, setStageFilterAnchor] = useState<HTMLElement | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [contextMenu, setContextMenu] = useState<TopicContextMenu>(null)
  const [stageManagerAnchor, setStageManagerAnchor] = useState<HTMLElement | null>(null)
  const [columnManagerAnchor, setColumnManagerAnchor] = useState<HTMLElement | null>(null)
  const [restartConfirmTopicId, setRestartConfirmTopicId] = useState<string | null>(null)
  const [editAllTopicId, setEditAllTopicId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [angleDraft, setAngleDraft] = useState('')
  const [customDraft, setCustomDraft] = useState('')
  const [sort, setSort] = useState<TopicSort>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('ly.creator-os.topic-col-widths') ?? '{}') as Record<string, number> } catch { return {} }
  })
  const closeAnchoredOverlays = (): void => {
    setActiveProperty(null)
    setActiveAnchor(null)
    setStageFilterAnchor(null)
    setFilterAnchor(null)
    setContextMenu(null)
    setStageManagerAnchor(null)
    setColumnManagerAnchor(null)
  }
  const colWidth = (column: TopicColumnDefinition): number => columnWidths[column.id] ?? (column.builtinKey === 'title' ? 230 : 122)
  const startColumnResize = (event: React.MouseEvent, columnId: string, startWidth: number): void => {
    event.preventDefault(); event.stopPropagation()
    const startX = event.clientX
    const onMove = (moveEvent: MouseEvent): void => setColumnWidths((widths) => ({ ...widths, [columnId]: Math.max(80, Math.round(startWidth + (moveEvent.clientX - startX))) }))
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-col-resizing')
      setColumnWidths((widths) => { try { localStorage.setItem('ly.creator-os.topic-col-widths', JSON.stringify(widths)) } catch { /* 忽略持久化失败 */ } return widths })
    }
    document.body.classList.add('is-col-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const typeName = (id: string): string => contentTypes.find((type) => type.id === id)?.name ?? '已停用方向'
  const stageCounts = useMemo(() => new Map(topicStages.map((stage) => [stage.id, topics.filter((topic) => topic.stageId === stage.id).length])), [topicStages, topics])
  const restartConfirmTopic = topics.find((topic) => topic.id === restartConfirmTopicId) ?? null
  const contextTopic = topics.find((topic) => topic.id === contextMenu?.topicId) ?? null
  const editAllTopic = topics.find((topic) => topic.id === editAllTopicId) ?? null
  const visibleColumns = useMemo(() => topicColumns.filter((column) => column.isVisible), [topicColumns])
  const effectiveStageFilter = stageFilter === 'all' || topicStages.some((stage) => stage.id === stageFilter) ? stageFilter : 'all'
  const selectedStage = effectiveStageFilter === 'all' ? null : topicStages.find((stage) => stage.id === effectiveStageFilter) ?? null
  const selectedStageCount = selectedStage ? stageCounts.get(selectedStage.id) ?? 0 : topics.length
  const activeFilterCount = Number(needsExperience) + Number(starred) + Number(Boolean(directionFilter)) + Number(Boolean(videoFilter)) + Number(Boolean(kindFilter))
  const sortValue = (topic: TopicRecord, column: TopicColumnDefinition): string | number | null => {
    if (!column.builtinKey) return topic.customValues[column.id] ?? null
    if (column.builtinKey === 'title') return topic.title
    if (column.builtinKey === 'importance') return topic.importanceLevel
    if (column.builtinKey === 'video') return videoFormatLabel(topic.videoFormat)
    if (column.builtinKey === 'kind') return projectKindLabel(Boolean(topic.isCommercial))
    if (column.builtinKey === 'direction') return typeName(topic.contentTypeId)
    if (column.builtinKey === 'stage') return topicStages.findIndex((stage) => stage.id === topic.stageId)
    if (column.builtinKey === 'start') return topic.startAt
    if (column.builtinKey === 'expected') return topic.expectedCompletionAt
    if (column.builtinKey === 'actual') return topic.actualCompletionAt
    if (column.builtinKey === 'variance') return topic.scheduleVarianceDays
    if (column.builtinKey === 'next') return topic.nextActionKind
    return topic.sourceCaptureIds.length
  }
  const visible = topics
    .filter((topic) => topic.id === highlightedTopicId || effectiveStageFilter === 'all' || topic.stageId === effectiveStageFilter)
    .filter((topic) => topic.id === highlightedTopicId || !needsExperience || topic.needsMoreExperience)
    .filter((topic) => topic.id === highlightedTopicId || !starred || topic.importanceLevel > 0)
    .filter((topic) => topic.id === highlightedTopicId || !directionFilter || topic.contentTypeId === directionFilter)
    .filter(topic => topic.id === highlightedTopicId || ((!videoFilter || (topic.videoFormat ?? 'undetermined') === videoFilter) && (!kindFilter || Boolean(topic.isCommercial) === (kindFilter === 'commercial'))))
    .sort((a, b) => {
      const sortColumn = sort ? topicColumns.find((column) => column.id === sort.columnId) : null
      if (sortColumn && sort) {
        const left = sortValue(a, sortColumn)
        const right = sortValue(b, sortColumn)
        if (left === null) return 1
        if (right === null) return -1
        const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
        return sort.direction === 'asc' ? result : -result
      }
      if (a.expectedCompletionAt && b.expectedCompletionAt) return a.expectedCompletionAt.localeCompare(b.expectedCompletionAt)
      if (a.expectedCompletionAt) return -1
      if (b.expectedCompletionAt) return 1
      if (a.startAt && b.startAt) return a.startAt.localeCompare(b.startAt)
      if (a.startAt) return -1
      if (b.startAt) return 1
      return a.title.localeCompare(b.title, 'zh-CN')
    })

  useEffect(() => {
    if (!highlightedTopicId || !topics.some((topic) => topic.id === highlightedTopicId)) return
    window.requestAnimationFrame(() => document.getElementById(`topic-row-${highlightedTopicId}`)?.scrollIntoView({ block: 'center' }))
  }, [highlightedTopicId, topics])

  useEffect(() => {
    if (!activeProperty) return
    const close = (event: MouseEvent): void => { if (!(event.target as Element).closest('.topic-cell-editor, .anchored-popover-layer')) { setActiveProperty(null); setActiveAnchor(null) } }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setActiveProperty(null); setActiveAnchor(null) } }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [activeProperty])

  useEffect(() => {
    if (!stageFilterAnchor && !filterAnchor && !contextMenu) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.anchored-popover-layer, .topic-stage-filter-trigger, .topic-filter-trigger')) return
      setStageFilterAnchor(null)
      setFilterAnchor(null)
      setContextMenu(null)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setStageFilterAnchor(null)
      setFilterAnchor(null)
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [contextMenu, filterAnchor, stageFilterAnchor])

  const openProperty = (topic: TopicRecord, property: string, anchor: HTMLElement): void => {
    const closing = activeProperty?.topicId === topic.id && activeProperty.property === property
    closeAnchoredOverlays()
    setActiveProperty(closing ? null : { topicId: topic.id, property })
    setActiveAnchor(closing ? null : anchor)
    setTitleDraft(topic.title)
    setAngleDraft(topic.coreAngle)
    if (property.startsWith('custom:')) setCustomDraft(topic.customValues[property.slice(7)] ?? '')
  }
  const isOpen = (topicId: string, property: string): boolean => activeProperty?.topicId === topicId && activeProperty.property === property
  const editContextTopic = (): void => {
    if (!contextMenu || !contextTopic) return
    const topicId = contextTopic.id
    setContextMenu(null)
    setEditAllTopicId(topicId)
  }
  const updateTopic = async (topicId: string, patch: UpdateTopicInput, close = true): Promise<void> => {
    if (!window.creatorOS) return
    setActionError('')
    try {
      await window.creatorOS.updateTopic(topicId, patch)
      await refresh()
      if (close) { setActiveProperty(null); setActiveAnchor(null) }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '选题保存失败') }
  }
  const trashTopic = async (topicId: string): Promise<void> => {
    if (!window.creatorOS) return
    setActionError('')
    const topic = allTopics.find((item) => item.id === topicId)
    try {
      if (topic?.createdProjectId) await window.creatorOS.trashProject(topic.createdProjectId)
      else await window.creatorOS.trashTopic(topicId)
      await refresh()
      setActiveProperty(null)
      setActiveAnchor(null)
    }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : '移入回收站失败') }
  }
  const setCustomValue = async (topicId: string, columnId: string, value: string | null): Promise<void> => {
    if (!window.creatorOS) return
    setActionError('')
    try { await window.creatorOS.setTopicCustomValue(topicId, columnId, value); await refresh(); setActiveProperty(null); setActiveAnchor(null) }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : '自定义列保存失败') }
  }

  const toggleSort = (columnId: string): void => setSort((current) => {
    if (!current || current.columnId !== columnId) return { columnId, direction: 'asc' }
    if (current.direction === 'asc') return { columnId, direction: 'desc' }
    return null
  })

  const renderTopicCell = (topic: TopicRecord, column: TopicColumnDefinition): React.JSX.Element => {
    const key = column.builtinKey
    if (!key) {
      const property = `custom:${column.id}`
      const value = topic.customValues[column.id] ?? null
      if (column.dataType === 'date') return <div className="topic-cell-editor"><button className="topic-property-button topic-date-button" aria-expanded={isOpen(topic.id, property)} onClick={(event) => openProperty(topic, property, event.currentTarget)}><MonthDateLabel value={value} /></button>{isOpen(topic.id, property) ? <AnchoredPopover anchor={activeAnchor} className="topic-date-popover" ariaLabel={`设置${column.name}`} onDismiss={closeAnchoredOverlays}><CalendarDatePicker label={column.name} onChange={(next) => void setCustomValue(topic.id, column.id, next)} today={today} value={value} /></AnchoredPopover> : null}</div>
      return <div className="topic-cell-editor"><button className="topic-property-button topic-custom-value-button" aria-expanded={isOpen(topic.id, property)} onClick={(event) => openProperty(topic, property, event.currentTarget)}>{value ?? '—'}</button>{isOpen(topic.id, property) ? <AnchoredPopover anchor={activeAnchor} className="topic-property-popover topic-text-popover compact" ariaLabel={`编辑${column.name}`} onDismiss={closeAnchoredOverlays}><label>{column.name}<input autoFocus inputMode={column.dataType === 'number' ? 'decimal' : 'text'} value={customDraft} onChange={(event) => setCustomDraft(event.currentTarget.value)} /></label><footer><button onClick={() => void setCustomValue(topic.id, column.id, null)}>清空</button><button className="primary-action" onClick={() => void setCustomValue(topic.id, column.id, customDraft)}>保存</button></footer></AnchoredPopover> : null}</div>
    }
    if (key === 'title') return <div className="topic-cell-editor"><button className="topic-property-button topic-title-button" aria-expanded={isOpen(topic.id, 'title')} onClick={(event) => openProperty(topic, 'title', event.currentTarget)}><b>{topic.title}</b>{topic.directions.length > 1 ? <span className="topic-direction-count">{topic.directions.length}个方向</span> : null}{topic.needsMoreExperience ? <span className="topic-needs-tag">需补体验</span> : null}</button>{isOpen(topic.id, 'title') ? <AnchoredPopover anchor={activeAnchor} className="topic-property-popover topic-text-popover" ariaLabel="编辑选题" onDismiss={closeAnchoredOverlays}><label>选题名称<input autoFocus maxLength={80} value={titleDraft} onChange={(event) => setTitleDraft(event.currentTarget.value)} /></label><label>核心角度<textarea value={angleDraft} onChange={(event) => setAngleDraft(event.currentTarget.value)} /></label>{topic.directions.length ? <details className="topic-ai-directions"><summary>AI筛选方向·{topic.directions.length}</summary><div>{topic.directions.map((direction) => <article key={direction.id}><header><b>{direction.title}</b>{direction.isPrimary ? <span>主要</span> : null}</header><p>{direction.summary}</p><details><summary>来源·{direction.sourceRefs.length}处</summary>{direction.sourceRefs.map((reference) => <blockquote key={`${reference.sourceId}:${reference.messageId}:${reference.quote}`}>{reference.quote}<cite>{reference.sourceTitle ?? (reference.sourceId.startsWith('claude:') ? 'Claude会话' : 'Codex任务')}</cite></blockquote>)}</details></article>)}</div></details> : null}<button className="topic-experience-toggle" aria-pressed={topic.needsMoreExperience} onClick={() => void updateTopic(topic.id, { needsMoreExperience: !topic.needsMoreExperience }, false)}><span aria-hidden="true">{topic.needsMoreExperience ? <Check size={12} /> : null}</span><span><b>需补体验</b></span></button><footer><button className="topic-trash-text" onClick={() => void trashTopic(topic.id)}>移入回收站</button><button className="primary-action" disabled={!titleDraft.trim()} onClick={() => void updateTopic(topic.id, { title: titleDraft, coreAngle: angleDraft })}>保存</button></footer></AnchoredPopover> : null}</div>
    if (key === 'importance') return <TopicStars level={topic.importanceLevel} onChange={(level) => void updateTopic(topic.id, { importanceLevel: level }, false)} />
    if (key === 'video' || key === 'kind') return <SavedClassificationControl dimension={key === 'video' ? 'video' : 'kind'} name={topic.title} videoFormat={topic.videoFormat} isCommercial={topic.isCommercial} onSave={patch => updateTopic(topic.id, patch)} />
    if (key === 'direction') return <div className="topic-cell-editor"><button className="topic-property-button" aria-expanded={isOpen(topic.id, 'direction')} onClick={(event) => openProperty(topic, 'direction', event.currentTarget)}><ContentTypeLabel id={topic.contentTypeId} name={typeName(topic.contentTypeId)} /></button>{isOpen(topic.id, 'direction') ? <AnchoredPopover anchor={activeAnchor} className="topic-property-popover" role="menu" ariaLabel="选择内容方向" onDismiss={closeAnchoredOverlays}>{contentTypes.filter((type) => type.isActive || type.id === topic.contentTypeId).map((type) => <button className={type.id === topic.contentTypeId ? 'selected' : ''} disabled={!type.isActive} key={type.id} onClick={() => void updateTopic(topic.id, { contentTypeId: type.id })}><ContentTypeLabel id={type.id} name={type.name} />{type.id === topic.contentTypeId ? <Check size={13} /> : null}</button>)}</AnchoredPopover> : null}</div>
    if (key === 'stage') return <div className="topic-cell-editor"><button className="topic-property-button" aria-expanded={isOpen(topic.id, 'stage')} onClick={(event) => openProperty(topic, 'stage', event.currentTarget)}><TopicStageLabel stage={topicStages.find(stage => stage.id === topic.stageId)} /></button>{isOpen(topic.id, 'stage') ? <AnchoredPopover anchor={activeAnchor} className="topic-property-popover" role="menu" ariaLabel="选择选题阶段" onDismiss={closeAnchoredOverlays}>{topicStages.map((stage) => <button className={stage.id === topic.stageId ? 'selected' : ''} key={stage.id} onClick={() => stage.role === 'project_created' && topic.lastProjectDeletedAt ? setRestartConfirmTopicId(topic.id) : void updateTopic(topic.id, { stageId: stage.id })}><TopicStageLabel stage={stage} />{stage.id === topic.stageId ? <Check size={13} /> : null}</button>)}</AnchoredPopover> : null}</div>
    if (key === 'start' || key === 'expected' || key === 'actual') {
      const value = key === 'start' ? topic.startAt : key === 'expected' ? topic.expectedCompletionAt : topic.actualCompletionAt
      const property = key
      const label = key === 'start' ? '开始时间' : key === 'expected' ? '目标日' : '实际完成'
      const change = (next: string | null): void => { if (key === 'start') void updateTopic(topic.id, { startAt: next }); else if (key === 'expected') void updateTopic(topic.id, { expectedCompletionAt: next }); else void updateTopic(topic.id, { actualCompletionAt: next }) }
      return <div className="topic-cell-editor"><button className="topic-property-button topic-date-button" aria-expanded={isOpen(topic.id, property)} onClick={(event) => openProperty(topic, property, event.currentTarget)}><MonthDateLabel value={value} /></button>{isOpen(topic.id, property) ? <AnchoredPopover anchor={activeAnchor} className="topic-date-popover" ariaLabel={`设置${label}`} onDismiss={closeAnchoredOverlays}><CalendarDatePicker label={label} onChange={change} today={today} value={value} /></AnchoredPopover> : null}</div>
    }
    if (key === 'variance') return <span className={`topic-variance ${topic.scheduleVarianceDays === null || topic.scheduleVarianceDays === 0 ? 'on-time' : topic.scheduleVarianceDays > 0 ? 'delayed' : 'early'}`}>{varianceLabel(topic.scheduleVarianceDays, Boolean(topic.actualCompletionAt))}</span>
    if (key === 'next') {
      const currentStage = topicStages.find((stage) => stage.id === topic.stageId) ?? null
      const nextStage = topic.nextStageId ? topicStages.find((stage) => stage.id === topic.nextStageId) ?? null : null
      const establishedStage = topicStages.find((stage) => stage.role === 'project_created') ?? null
      const linkedProject = topic.createdProjectId ? projects.find((project) => project.id === topic.createdProjectId) ?? null : null
      return topic.nextActionKind === 'open_project' && topic.createdProjectId
        ? <button className="topic-row-action" onClick={() => navigate({ page: 'project', projectId: topic.createdProjectId ?? undefined, moduleKey: 'overview' })}>打开项目<ExternalLink size={12} /></button>
        : topic.nextActionKind === 'create_project'
          ? <button className="topic-row-action" disabled={!establishedStage} onClick={() => establishedStage ? void updateTopic(topic.id, { stageId: establishedStage.id }, false) : undefined}>{currentStage?.nextActionLabel || '→已立项'}</button>
          : topic.nextActionKind === 'restart_project' && establishedStage
            ? <span className="topic-lifecycle-actions">{linkedProject && !linkedProject.trashedAt ? <button className="topic-row-action" onClick={() => navigate({ page: 'project', projectId: linkedProject.id, moduleKey: 'overview' })}>查看项目</button> : null}<button className="topic-row-action" onClick={() => topic.lastProjectDeletedAt ? setRestartConfirmTopicId(topic.id) : void updateTopic(topic.id, { stageId: establishedStage.id }, false)}>{linkedProject?.trashedAt ? '恢复项目' : topic.lastProjectDeletedAt ? '新建空项目' : '重新开始'}</button></span>
          : topic.nextActionKind === 'advance_stage' && nextStage
            ? <button className="topic-row-action topic-next-stage-action" onClick={() => void updateTopic(topic.id, { stageId: nextStage.id }, false)}>{currentStage?.nextActionLabel || `→${nextStage.name}`}</button>
            : <span className="topic-next-action-none">—</span>
    }
    return <div className="topic-cell-editor"><button className="topic-row-link" aria-expanded={isOpen(topic.id, 'inspirations')} onClick={(event) => openProperty(topic, 'inspirations', event.currentTarget)}>{topic.sourceCaptureIds.length}条</button>{isOpen(topic.id, 'inspirations') ? <AnchoredPopover anchor={activeAnchor} className="topic-property-popover topic-inspiration-popover" ariaLabel="关联灵感" onDismiss={closeAnchoredOverlays}><header><b>关联灵感</b><span>{topic.sourceCaptureIds.length}条</span></header>{topic.sourceCaptureIds.length ? <ul>{topic.sourceCaptureIds.map((id) => <li key={id}>{captures.find((capture) => capture.id === id)?.originalContent ?? '原始记录已归档'}</li>)}</ul> : <p>还没有关联灵感。</p>}</AnchoredPopover> : null}</div>
  }

  return <main className="page topic-management-page">
    <header className="page-header"><div><h1>选题管理</h1></div><div className="topic-page-actions"><button className="secondary-action" aria-expanded={Boolean(columnManagerAnchor)} onClick={(event) => { const anchor = event.currentTarget; const opening = !columnManagerAnchor; closeAnchoredOverlays(); if (opening) setColumnManagerAnchor(anchor) }}><Columns3 size={14} />管理列</button><button className="secondary-action" aria-expanded={Boolean(stageManagerAnchor)} onClick={(event) => { const anchor = event.currentTarget; const opening = !stageManagerAnchor; closeAnchoredOverlays(); if (opening) setStageManagerAnchor(anchor) }}><Settings2 size={14} />管理阶段</button></div></header>
    <section className="topic-management-shell">
      <header className="topic-management-toolbar">
        <button className="topic-stage-filter-trigger" aria-expanded={Boolean(stageFilterAnchor)} onClick={(event) => {
          const anchor = event.currentTarget
          const opening = !stageFilterAnchor
          closeAnchoredOverlays()
          if (opening) setStageFilterAnchor(anchor)
        }}>
          {selectedStage ? <TopicStageLabel stage={selectedStage} /> : <span>全部</span>}<b>{selectedStageCount}</b><ChevronDown size={13} />
        </button>
        <button className={`topic-filter-trigger${activeFilterCount ? ' active' : ''}`} aria-expanded={Boolean(filterAnchor)} onClick={(event) => {
          const anchor = event.currentTarget
          const opening = !filterAnchor
          closeAnchoredOverlays()
          if (opening) setFilterAnchor(anchor)
        }}>
          <Filter size={13} />{activeFilterCount ? `筛选·${activeFilterCount}` : '筛选'}
        </button>
        <span>{visible.length}个选题·目标日优先</span>
      </header>
      <div className="topic-table-wrap"><table className="topic-management-table" style={{ width: `${visibleColumns.reduce((sum, column) => sum + colWidth(column), 0)}px`, minWidth: `${visibleColumns.reduce((sum, column) => sum + colWidth(column), 0)}px` }}><thead><tr>{visibleColumns.map((column) => <th className={column.builtinKey === 'title' ? 'topic-title-column' : ''} style={{ width: `${colWidth(column)}px` }} key={column.id}><button className={sort?.columnId === column.id ? 'active' : ''} aria-label={`按${column.name}排序`} onClick={() => toggleSort(column.id)}>{column.name}{sort?.columnId === column.id ? sort.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}</button><span className="topic-col-resize" role="separator" aria-orientation="vertical" aria-label={`拖拽调整${column.name}列宽`} onMouseDown={(event) => startColumnResize(event, column.id, colWidth(column))} onClick={(event) => event.stopPropagation()} /></th>)}</tr></thead><tbody>{visible.map((topic) => <tr id={`topic-row-${topic.id}`} className={highlightedTopicId === topic.id ? 'search-highlighted' : ''} key={topic.id} onContextMenu={(event) => {
        event.preventDefault()
        closeAnchoredOverlays()
        setContextMenu({ anchor: event.currentTarget, topicId: topic.id })
      }}>{visibleColumns.map((column) => <td className={column.builtinKey === 'title' ? 'topic-title-cell' : ''} key={column.id}>{renderTopicCell(topic, column)}</td>)}</tr>)}</tbody></table>{!visible.length ? <div className="topic-empty"><Star size={24} /><b>当前筛选下没有选题</b></div> : null}</div>
    </section>
    {stageFilterAnchor ? <AnchoredPopover anchor={stageFilterAnchor} className="topic-stage-filter-menu topic-property-popover" role="menu" ariaLabel="筛选选题阶段" onDismiss={() => setStageFilterAnchor(null)}>
      <button className={effectiveStageFilter === 'all' ? 'selected' : ''} role="menuitemradio" aria-checked={effectiveStageFilter === 'all'} onClick={() => { setStageFilter('all'); setStageFilterAnchor(null) }}><span>全部</span><span>{topics.length}</span>{effectiveStageFilter === 'all' ? <Check size={13} /> : null}</button>
      {topicStages.map((stage) => <button className={effectiveStageFilter === stage.id ? 'selected' : ''} role="menuitemradio" aria-checked={effectiveStageFilter === stage.id} key={stage.id} onClick={() => { setStageFilter(stage.id); setStageFilterAnchor(null) }}><TopicStageLabel stage={stage} /><span>{stageCounts.get(stage.id) ?? 0}</span>{effectiveStageFilter === stage.id ? <Check size={13} /> : null}</button>)}
    </AnchoredPopover> : null}
    {filterAnchor ? <AnchoredPopover anchor={filterAnchor} className="topic-filter-popover" ariaLabel="筛选选题" onDismiss={() => setFilterAnchor(null)}>
      <button className="topic-filter-switch" role="switch" aria-checked={needsExperience} onClick={() => setNeedsExperience((value) => !value)}><span><b>需补体验</b></span><i aria-hidden="true">{needsExperience ? <Check size={11} /> : null}</i></button>
      <button className="topic-filter-switch" role="switch" aria-checked={starred} onClick={() => setStarred((value) => !value)}><span><b>已打星</b></span><i aria-hidden="true">{starred ? <Check size={11} /> : null}</i></button>
      <ClassificationSelect dimension="video" filter value={videoFilter} onChange={setVideoFilter} label="筛选视频形式" /><ClassificationSelect dimension="kind" filter value={kindFilter} onChange={setKindFilter} label="筛选项目类型" />
      <div className="topic-filter-direction"><b>内容方向</b><button className={!directionFilter ? 'selected' : ''} onClick={() => setDirectionFilter('')}><ContentTypeLabel id="" name="全部方向" />{!directionFilter ? <Check size={12} /> : null}</button>{contentTypes.filter((type) => type.isActive).map((type) => <button className={directionFilter === type.id ? 'selected' : ''} key={type.id} onClick={() => setDirectionFilter(type.id)}><ContentTypeLabel id={type.id} name={type.name} />{directionFilter === type.id ? <Check size={12} /> : null}</button>)}</div>
      {activeFilterCount ? <button className="topic-filter-clear" onClick={() => { setNeedsExperience(false); setStarred(false); setDirectionFilter(''); setVideoFilter(''); setKindFilter(''); setFilterAnchor(null) }}>清空筛选</button> : null}
    </AnchoredPopover> : null}
    {contextMenu && contextTopic ? <AnchoredPopover anchor={contextMenu.anchor} className="topic-context-menu topic-property-popover" role="menu" ariaLabel={`${contextTopic.title}的操作`} onDismiss={() => setContextMenu(null)}>
      {contextTopic.createdProjectId ? <>
        <button role="menuitem" onClick={() => { setContextMenu(null); navigate({ page: 'project', projectId: contextTopic.createdProjectId ?? undefined, moduleKey: 'overview' }) }}>打开项目</button>
        <button role="menuitem" onClick={editContextTopic}>编辑所有内容</button>
        <button className="danger" role="menuitem" onClick={() => { setContextMenu(null); void trashTopic(contextTopic.id) }}>移入回收站</button>
      </> : <>
        <button role="menuitem" onClick={editContextTopic}>编辑所有内容</button>
        <button className="danger" role="menuitem" onClick={() => { setContextMenu(null); void trashTopic(contextTopic.id) }}>移入回收站</button>
      </>}
    </AnchoredPopover> : null}
    {stageManagerAnchor ? <TopicStageManager anchor={stageManagerAnchor} stages={topicStages} topicCounts={stageCounts} onChanged={refresh} onClose={() => setStageManagerAnchor(null)} /> : null}
    {columnManagerAnchor ? <TopicColumnManager anchor={columnManagerAnchor} columns={topicColumns} onChanged={refresh} onClose={() => setColumnManagerAnchor(null)} /> : null}
    {actionError ? <div className="inline-notice form-error" role="alert">{actionError}<button onClick={() => setActionError('')}>关闭</button></div> : null}
    {newTopicOpen ? <NewTopicDialog onClose={() => onNewTopicOpenChange(false)} onCreated={() => { onNewTopicOpenChange(false); void refresh() }} stages={topicStages} today={today} /> : null}
    {editAllTopic ? <EditTopicDialog topic={editAllTopic} stages={topicStages} today={today} onClose={() => setEditAllTopicId(null)} onSaved={() => { setEditAllTopicId(null); void refresh() }} /> : null}
    {restartConfirmTopic ? <div className="modal-backdrop"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-empty-project-title"><header><div><h2 id="restart-empty-project-title">重新建立空项目？</h2></div><button aria-label="关闭重新建立确认" onClick={() => setRestartConfirmTopicId(null)}><X size={15} /></button></header><p>「{restartConfirmTopic.title}」原来的项目资料已经永久删除。继续后会建立一个新的空项目，选题恢复为“已立项”。</p><footer><button onClick={() => setRestartConfirmTopicId(null)}>取消</button><button className="primary-action" onClick={() => { const stage = topicStages.find((item) => item.role === 'project_created'); if (stage) void updateTopic(restartConfirmTopic.id, { stageId: stage.id }, false).then(() => setRestartConfirmTopicId(null)) }}>新建空项目</button></footer></section></div> : null}
  </main>
}
