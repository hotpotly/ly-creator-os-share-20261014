import { Check, ChevronLeft, ChevronRight, GripVertical, PencilLine, Pin, RefreshCw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CodexWritingModelOption,
  ProviderCapability,
  ScriptMaterialAiSide,
  ScriptMaterialDraft,
  ScriptMaterialMobileTab,
  ScriptMaterialScrollTops,
  ScriptMaterialRewriteCandidate,
  ScriptMaterialWorkspace as ScriptMaterialWorkspaceRecord,
  ScriptTextAnnotation,
  TaskRun
} from '../../../shared/domain'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../../shared/domain'
import { AnchoredPopover } from './AnchoredPopover'
import { ReadableMarkdown } from './ReadableMarkdown'
import { ScriptMaterialAuditControl } from './ScriptMaterialAuditControl'
import { SelectionActionMenu } from '../features/script/selection/SelectionActionMenu'
import { RewriteRequestPanel } from '../features/script/selection/RewriteRequestPanel'
import { RewriteCandidateDialog } from '../features/script/selection/RewriteCandidateDialog'
import { TextAnnotationMenu } from '../features/script/selection/TextAnnotationMenu'
import { REWRITE_QUICK_ACTIONS, type RewriteRequest } from '../features/script/selection/selection-contract'
import { AiCountControl, CodexModelControl, ProjectContextToggle, WebSearchModeControl } from '../features/script/shared/ScriptRequestControls'
import { StructuredReferenceComposer } from '../features/script/shared/StructuredReferenceComposer'
import type { StructuredComposerSnapshot } from '../features/script/shared/structured-reference-composer-state'
import { buildStructuredInstructionPayload } from '../features/script/shared/structured-reference-request'

interface Props {
  workspace: ScriptMaterialWorkspaceRecord
  tasks: TaskRun[]
  capabilities: ProviderCapability[]
  codexModels: CodexWritingModelOption[]
  preferredCodexModel: string | null
  includeProjectContext: boolean
  currentDocumentPane: ReactNode
  currentDocumentParagraphs(): Array<{ id: string; position: number; text: string }>
  currentDocumentState: 'loading' | 'empty' | 'ready'
  auditControlsHidden?: boolean
  readOnlySnapshot?: boolean
  requestedFocus: ScriptMaterialRelationFocus | null
  mobileTab: ScriptMaterialMobileTab
  mobileScrollTops: ScriptMaterialScrollTops
  onWorkspaceChange(workspace: ScriptMaterialWorkspaceRecord): void
  onMobileTabChange(tab: ScriptMaterialMobileTab): void
  onMobileScrollTopChange(tab: ScriptMaterialMobileTab, scrollTop: number): void
  onPreferredCodexModelChange(model: string | null): void
  onIncludeProjectContextChange(value: boolean): void
  onApplyDraft(draft: ScriptMaterialDraft, mode: 'replace' | 'append', paragraphIds?: string[], annotations?: ScriptTextAnnotation[]): void
  onApplyRewriteCandidate(candidate: ScriptMaterialRewriteCandidate, mode: 'append' | 'replace'): void
  rewriteCandidateTargetChanged(candidate: ScriptMaterialRewriteCandidate): boolean
  captureRewriteApplicationTarget(draftId: string, paragraphIds: string[]): Promise<ScriptMaterialRewriteCandidate['applicationTarget']>
  onRelationFocus(focus: ScriptMaterialRelationFocus): void
  onNotice(message: string): void
}

export interface ScriptMaterialRelationFocus {
  token: string
  origin: 'source' | 'draft' | 'current'
  draftId: string | null
  draftParagraphIds: string[]
  sourcePointIds: string[]
  liveDraftId?: string | null
  liveDraftParagraphIds?: string[]
  liveSourcePointIds?: string[]
  pinnedDraftId?: string | null
  pinnedDraftParagraphIds?: string[]
  pinnedSourcePointIds?: string[]
}

export const SCRIPT_MATERIAL_DRAG_MIME = 'application/x-ly-script-material-paragraphs'
export const SCRIPT_MATERIAL_CANDIDATE_DRAG_MIME = 'application/x-ly-script-material-rewrite-candidate'
const SCRIPT_MATERIAL_MOBILE_TABS: ReadonlyArray<{ id: ScriptMaterialMobileTab; label: string }> = [
  { id: 'source', label: '原始素材' },
  { id: 'ai', label: 'AI稿' },
  { id: 'current', label: '当前文案' }
]

export interface ScriptMaterialDragPayload {
  draftId: string
  paragraphIds: string[]
  annotations: ScriptTextAnnotation[]
}

export interface ScriptMaterialCandidateDragPayload {
  candidateId: string
}

interface ParagraphRewriteMenu {
  anchor: HTMLElement
  anchorPoint: { x: number; y: number }
  draftId: string
  paragraphId: string
  paragraphText: string
  paragraphTargets: Array<{ paragraphId: string; position: number; text: string }>
  selectedText: string
  selectedStart: number | null
  selectedEnd: number | null
  view: 'menu' | 'rewrite' | 'candidate'
  requirement: string
  taskId: string | null
  candidateId: string | null
}

type ScriptMaterialWorkspacePatch = {
  workingContent?: string
  aiCount?: 1 | 2
  selectedAiSide?: ScriptMaterialAiSide
  selectedCodexDraftId?: string | null
  selectedClaudeDraftId?: string | null
  webSearchMode?: ScriptMaterialWorkspaceRecord['webSearchMode']
}

function creatorOS(): NonNullable<typeof window.creatorOS> {
  if (!window.creatorOS) throw new Error('素材成稿服务尚未就绪')
  return window.creatorOS
}

function taskIsActive(task: TaskRun): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'waiting_confirmation'
}

function selectedTextInside(container: HTMLElement): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return ''
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return ''
  return selection.toString().trim()
}

function rawSelectionInside(container: HTMLElement): { start: number; end: number; text: string } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null
  const rawOffset = (node: Node, offset: number): number | null => {
    const element = node instanceof HTMLElement ? node : node.parentElement
    const mapped = element?.closest<HTMLElement>('[data-raw-start]')
    if (!mapped || !container.contains(mapped)) return null
    const base = Number.parseInt(mapped.dataset.rawStart ?? '', 10)
    if (!Number.isFinite(base)) return null
    const prefix = document.createRange()
    prefix.selectNodeContents(mapped)
    try {
      prefix.setEnd(node, offset)
    } catch {
      return null
    }
    return base + prefix.toString().length
  }
  const rawStart = rawOffset(range.startContainer, range.startOffset)
  const rawEnd = rawOffset(range.endContainer, range.endOffset)
  if (rawStart === null || rawEnd === null || rawEnd <= rawStart) return null
  const selected = selection.toString()
  const leading = selected.length - selected.trimStart().length
  const trailing = selected.length - selected.trimEnd().length
  const start = rawStart + leading
  const end = rawEnd - trailing
  if (end <= start) return null
  return { start, end, text: selected.trim() }
}

function mergeRelationFocus(
  liveFocus: ScriptMaterialRelationFocus,
  pinnedFocus: ScriptMaterialRelationFocus | null,
  origin: ScriptMaterialRelationFocus['origin'] = liveFocus.origin
): ScriptMaterialRelationFocus {
  const sameDraft = Boolean(pinnedFocus?.draftId && pinnedFocus.draftId === liveFocus.draftId)
  return {
    token: crypto.randomUUID(),
    origin,
    draftId: liveFocus.draftId,
    draftParagraphIds: [...new Set([
      ...liveFocus.draftParagraphIds,
      ...(sameDraft ? pinnedFocus?.draftParagraphIds ?? [] : [])
    ])],
    sourcePointIds: [...new Set([
      ...liveFocus.sourcePointIds,
      ...(pinnedFocus?.sourcePointIds ?? [])
    ])],
    liveDraftId: liveFocus.draftId,
    liveDraftParagraphIds: liveFocus.draftParagraphIds,
    liveSourcePointIds: liveFocus.sourcePointIds,
    pinnedDraftId: pinnedFocus?.draftId ?? null,
    pinnedDraftParagraphIds: pinnedFocus?.draftParagraphIds ?? [],
    pinnedSourcePointIds: pinnedFocus?.sourcePointIds ?? []
  }
}

function liveRelationFocus(focus: ScriptMaterialRelationFocus): ScriptMaterialRelationFocus {
  return {
    token: focus.token,
    origin: focus.origin,
    draftId: focus.liveDraftId === undefined ? focus.draftId : focus.liveDraftId,
    draftParagraphIds: focus.liveDraftParagraphIds ?? focus.draftParagraphIds,
    sourcePointIds: focus.liveSourcePointIds ?? focus.sourcePointIds
  }
}

function pinnedRelationFocus(focus: ScriptMaterialRelationFocus | null): ScriptMaterialRelationFocus | null {
  if (!focus) return null
  const draftParagraphIds = focus.pinnedDraftParagraphIds ?? []
  const sourcePointIds = focus.pinnedSourcePointIds ?? []
  if (!draftParagraphIds.length && !sourcePointIds.length) return null
  return {
    token: focus.token,
    origin: focus.origin,
    draftId: focus.pinnedDraftId ?? null,
    draftParagraphIds,
    sourcePointIds
  }
}

export function ScriptMaterialWorkspace({
  workspace,
  tasks,
  capabilities,
  codexModels,
  preferredCodexModel,
  includeProjectContext,
  currentDocumentPane,
  currentDocumentParagraphs,
  currentDocumentState,
  auditControlsHidden = false,
  readOnlySnapshot = false,
  requestedFocus,
  mobileTab,
  mobileScrollTops,
  onWorkspaceChange,
  onMobileTabChange,
  onMobileScrollTopChange,
  onPreferredCodexModelChange,
  onIncludeProjectContextChange,
  onApplyDraft,
  onApplyRewriteCandidate,
  rewriteCandidateTargetChanged,
  captureRewriteApplicationTarget,
  onRelationFocus,
  onNotice
}: Props): React.JSX.Element {
  const dismissedRewriteStorageKey = `creator-os:material-rewrite-dismissed:${workspace.projectId}`
  const currentDocumentEmpty = currentDocumentState === 'empty'
  const restoredLiveFocus = requestedFocus ? liveRelationFocus(requestedFocus) : null
  const restoredPinnedFocus = pinnedRelationFocus(requestedFocus)
  const [workingContent, setWorkingContent] = useState(workspace.workingContent)
  const [chatMessage, setChatMessage] = useState('')
  const [activePointIds, setActivePointIds] = useState<string[]>(restoredLiveFocus?.sourcePointIds ?? [])
  const [editingSource, setEditingSource] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingParagraphId, setConfirmingParagraphId] = useState<string | null>(null)
  const [rewriteMenu, setRewriteMenu] = useState<ParagraphRewriteMenu | null>(null)
  const [annotationMenu, setAnnotationMenu] = useState<ParagraphRewriteMenu | null>(null)
  const [annotationNote, setAnnotationNote] = useState('')
  const [sourceAnnotations, setSourceAnnotations] = useState<ScriptTextAnnotation[]>([])
  const [dismissedRewriteCandidateIds, setDismissedRewriteCandidateIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(dismissedRewriteStorageKey) ?? '[]') as string[]) } catch { return new Set() }
  })
  const [rewriteTasksAnchor, setRewriteTasksAnchor] = useState<HTMLElement | null>(null)
  const [selectedParagraphIds, setSelectedParagraphIds] = useState<string[]>([])
  const [readOnlySelection, setReadOnlySelection] = useState(() => ({
    side: workspace.selectedAiSide,
    codexDraftId: workspace.selectedCodexDraftId,
    claudeDraftId: workspace.selectedClaudeDraftId
  }))
  const [pinnedFocus, setPinnedFocus] = useState<ScriptMaterialRelationFocus | null>(restoredPinnedFocus)
  const [activeDraftParagraphIds, setActiveDraftParagraphIds] = useState<string[]>(restoredLiveFocus?.draftParagraphIds ?? [])
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 1120px)').matches)
  const sourceBodyRef = useRef<HTMLDivElement>(null)
  const aiBodyRef = useRef<HTMLDivElement>(null)
  const mobileScrollTimerRef = useRef<Record<Exclude<ScriptMaterialMobileTab, 'current'>, ReturnType<typeof setTimeout> | null>>({ source: null, ai: null })
  const mobileScrollPendingRef = useRef<Record<Exclude<ScriptMaterialMobileTab, 'current'>, number | null>>({ source: null, ai: null })
  const onMobileScrollTopChangeRef = useRef(onMobileScrollTopChange)
  const pointRefs = useRef(new Map<string, HTMLElement>())
  const paragraphRefs = useRef(new Map<string, HTMLElement>())
  const handledFocusToken = useRef<string | null>(null)
  const pendingRelationScrollRef = useRef<Partial<Record<Exclude<ScriptMaterialMobileTab, 'current'>, string>>>({})
  const liveFocus = useRef<ScriptMaterialRelationFocus | null>(restoredLiveFocus)
  const paragraphSelectionAnchor = useRef<number | null>(null)
  const autoMappingDraftIds = useRef(new Set<string>())
  const completedRewriteCandidateIds = useRef(new Set(
    workspace.rewriteCandidates.filter((candidate) => candidate.content.trim()).map((candidate) => candidate.id)
  ))

  useEffect(() => { setWorkingContent(workspace.workingContent) }, [workspace.workingContent])
  useEffect(() => {
    if (!readOnlySnapshot) return
    setEditingSource(false)
    setReadOnlySelection({
      side: workspace.selectedAiSide,
      codexDraftId: workspace.selectedCodexDraftId,
      claudeDraftId: workspace.selectedClaudeDraftId
    })
  }, [readOnlySnapshot, workspace])
  useEffect(() => {
    const nextLive = requestedFocus ? liveRelationFocus(requestedFocus) : null
    setPinnedFocus(pinnedRelationFocus(requestedFocus))
    setActivePointIds(nextLive?.sourcePointIds ?? [])
    setActiveDraftParagraphIds(nextLive?.draftParagraphIds ?? [])
    liveFocus.current = nextLive
    handledFocusToken.current = null
  }, [workspace.projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1120px)')
    const update = (): void => setIsNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => { onMobileScrollTopChangeRef.current = onMobileScrollTopChange }, [onMobileScrollTopChange])
  useEffect(() => () => {
    for (const tab of ['source', 'ai'] as const) {
      if (mobileScrollTimerRef.current[tab]) clearTimeout(mobileScrollTimerRef.current[tab]!)
      const pending = mobileScrollPendingRef.current[tab]
      if (pending !== null) onMobileScrollTopChangeRef.current(tab, pending)
    }
  }, [])

  const rememberMobileScroll = (tab: Exclude<ScriptMaterialMobileTab, 'current'>, scrollTop: number): void => {
    if (mobileScrollTimerRef.current[tab]) clearTimeout(mobileScrollTimerRef.current[tab]!)
    mobileScrollPendingRef.current[tab] = Math.max(0, Math.round(scrollTop))
    mobileScrollTimerRef.current[tab] = setTimeout(() => {
      const pending = mobileScrollPendingRef.current[tab]
      mobileScrollPendingRef.current[tab] = null
      mobileScrollTimerRef.current[tab] = null
      if (pending !== null) onMobileScrollTopChangeRef.current(tab, pending)
    }, 160)
  }

  const activeSide = readOnlySnapshot ? readOnlySelection.side : workspace.selectedAiSide
  const sideDrafts = workspace.drafts.filter((draft) => draft.side === activeSide)
  const selectedDraftId = activeSide === 'codex'
    ? readOnlySnapshot ? readOnlySelection.codexDraftId : workspace.selectedCodexDraftId
    : readOnlySnapshot ? readOnlySelection.claudeDraftId : workspace.selectedClaudeDraftId
  const activeDraft = sideDrafts.find((draft) => draft.id === selectedDraftId) ?? sideDrafts.at(-1)
  const activeDraftIndex = activeDraft ? sideDrafts.findIndex((draft) => draft.id === activeDraft.id) : -1
  useEffect(() => {
    if (!activeDraft || !window.creatorOS) { setSourceAnnotations([]); return }
    let canceled = false
    void window.creatorOS.listSourceScriptAnnotations(workspace.projectId, {
      sourceKind: 'material_draft', sourceId: activeDraft.id, sourceVersion: activeDraft.contentHash
    }).then((annotations) => { if (!canceled) setSourceAnnotations(annotations) }).catch(() => { if (!canceled) setSourceAnnotations([]) })
    return () => { canceled = true }
  }, [activeDraft, workspace.projectId])
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const restore = (tab: Exclude<ScriptMaterialMobileTab, 'current'>, target: HTMLElement | null): void => {
        const saved = mobileScrollTops[tab]
        if (target && Math.abs(target.scrollTop - saved) > 2) target.scrollTop = saved
      }
      if (!isNarrow) {
        restore('source', sourceBodyRef.current)
        restore('ai', aiBodyRef.current)
      } else if (mobileTab === 'source') restore('source', sourceBodyRef.current)
      else if (mobileTab === 'ai') restore('ai', aiBodyRef.current)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeDraft?.id, isNarrow, mobileScrollTops, mobileTab, workspace.activeRevision?.id])
  const sourceChanged = Boolean(workspace.activeRevision && workingContent !== workspace.activeRevision.content)
  const hasDraftForWorkingRevision = !sourceChanged && Boolean(activeDraft)
  const claudeAvailable = capabilities.find((item) => item.provider === 'claude_cli')?.available ?? false
  const chatting = tasks.some((task) => task.taskType === 'script_material_chat'
    && task.projectId === workspace.projectId
    && task.outputTarget?.endsWith(`:${activeSide}`)
    && taskIsActive(task))
  const activeMessages = workspace.messages.filter((message) => message.side === activeSide)
  const rewriteCandidate = rewriteMenu
    ? workspace.rewriteCandidates.find((candidate) => candidate.id === rewriteMenu.candidateId || candidate.taskId === rewriteMenu.taskId)
    : null
  const rewriteCandidateReady = rewriteCandidate?.content.trim() ? rewriteCandidate : null
  const displayPoints = workspace.points
  const activeParagraphs = useMemo(() => activeDraft?.paragraphs ?? [], [activeDraft])
  const highlightedPointIds = useMemo(
    () => [...new Set([...activePointIds, ...(pinnedFocus?.sourcePointIds ?? [])])],
    [activePointIds, pinnedFocus?.sourcePointIds]
  )
  const highlightedDraftParagraphIds = useMemo(
    () => [...new Set([
      ...activeDraftParagraphIds,
      ...(pinnedFocus && pinnedFocus.draftId === activeDraft?.id ? pinnedFocus.draftParagraphIds : [])
    ])],
    [activeDraft?.id, activeDraftParagraphIds, pinnedFocus]
  )
  const activeRewriteCandidates = useMemo(
    () => [...workspace.rewriteCandidates]
      .filter((candidate) => candidate.draftId === activeDraft?.id && !dismissedRewriteCandidateIds.has(candidate.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [activeDraft?.id, dismissedRewriteCandidateIds, workspace.rewriteCandidates]
  )
  const dismissRewriteCandidate = (candidateId: string): void => {
    setDismissedRewriteCandidateIds((current) => {
      const next = new Set(current).add(candidateId)
      localStorage.setItem(dismissedRewriteStorageKey, JSON.stringify(Array.from(next)))
      return next
    })
    setRewriteMenu(null)
    onNotice('已从局部任务列表移除')
  }
  const activeRewriteCandidateCount = activeRewriteCandidates.filter((candidate) => {
    if (candidate.content.trim()) return false
    const task = candidate.taskId ? tasks.find((item) => item.id === candidate.taskId) : null
    const status = readOnlySnapshot ? candidate.taskStatusAtSnapshot : task?.status
    return !status || ['queued', 'running', 'waiting_confirmation'].includes(status)
  }).length
  const activeDraftMappingMissing = Boolean(
    activeDraft
    && activeDraft.mappingState === 'ready'
    && activeParagraphs.length
    && !activeParagraphs.some((paragraph) => paragraph.sourcePointIds.length)
  )

  useEffect(() => {
    setSelectedParagraphIds([])
    paragraphSelectionAnchor.current = null
    setRewriteMenu(null)
    setRewriteTasksAnchor(null)
  }, [activeDraft?.id])

  useEffect(() => {
    const completed = workspace.rewriteCandidates.filter((candidate) => candidate.content.trim())
    const newlyCompleted = completed.filter((candidate) => !completedRewriteCandidateIds.current.has(candidate.id))
    completed.forEach((candidate) => completedRewriteCandidateIds.current.add(candidate.id))
    if (newlyCompleted.length) onNotice(newlyCompleted.length === 1
      ? '局部候选已生成，可以从AI稿顶部“局部任务”打开。'
      : `${newlyCompleted.length}个局部候选已生成，可以从AI稿顶部“局部任务”打开。`)
  }, [onNotice, workspace.rewriteCandidates])

  const updateWorkspace = useCallback(async (patch: ScriptMaterialWorkspacePatch): Promise<ScriptMaterialWorkspaceRecord> => {
    if (readOnlySnapshot) {
      onNotice('这是历史版本的冻结工作台；恢复为新的当前版本后才能修改。')
      return workspace
    }
    const next = await creatorOS().saveScriptMaterialWorkspace(workspace.projectId, patch)
    onWorkspaceChange(next)
    return next
  }, [onNotice, onWorkspaceChange, readOnlySnapshot, workspace])

  const selectDraft = useCallback(async (draft: ScriptMaterialDraft): Promise<void> => {
    setActivePointIds([])
    setActiveDraftParagraphIds([])
    if (readOnlySnapshot) {
      setReadOnlySelection((current) => ({
        ...current,
        side: draft.side,
        ...(draft.side === 'codex' ? { codexDraftId: draft.id } : { claudeDraftId: draft.id })
      }))
      return
    }
    await updateWorkspace({
      selectedAiSide: draft.side,
      ...(draft.side === 'codex'
        ? { selectedCodexDraftId: draft.id }
        : { selectedClaudeDraftId: draft.id })
    })
  }, [readOnlySnapshot, updateWorkspace])

  const publishFocus = useCallback((focus: Omit<ScriptMaterialRelationFocus, 'token'>): void => {
    const live = { ...focus, token: crypto.randomUUID() }
    liveFocus.current = live
    setActivePointIds(live.sourcePointIds)
    setActiveDraftParagraphIds(live.draftParagraphIds)
    const merged = mergeRelationFocus(live, pinnedFocus)
    handledFocusToken.current = merged.token
    onRelationFocus(merged)
    window.requestAnimationFrame(() => {
      const firstPointId = live.sourcePointIds[0]
      if (firstPointId) {
        if (!isNarrow || mobileTab === 'source') pointRefs.current.get(firstPointId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        else pendingRelationScrollRef.current.source = firstPointId
      }
      const firstParagraphId = live.draftParagraphIds[0]
      if (firstParagraphId) {
        if (!isNarrow || mobileTab === 'ai') paragraphRefs.current.get(firstParagraphId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        else pendingRelationScrollRef.current.ai = firstParagraphId
      }
    })
  }, [isNarrow, mobileTab, onRelationFocus, pinnedFocus])

  useEffect(() => {
    if (!requestedFocus || handledFocusToken.current === requestedFocus.token) return
    const requestedLiveFocus = liveRelationFocus(requestedFocus)
    const requestedDraft = requestedLiveFocus.draftId
      ? workspace.drafts.find((draft) => draft.id === requestedLiveFocus.draftId)
      : null
    if (requestedDraft && activeDraft?.id !== requestedDraft.id) {
      void selectDraft(requestedDraft)
      return
    }
    handledFocusToken.current = requestedFocus.token
    liveFocus.current = requestedLiveFocus
    setActivePointIds(requestedLiveFocus.sourcePointIds)
    setActiveDraftParagraphIds(requestedLiveFocus.draftParagraphIds)
    if (pinnedFocus) {
      const merged = mergeRelationFocus(requestedLiveFocus, pinnedFocus)
      handledFocusToken.current = merged.token
      onRelationFocus(merged)
    }
    window.requestAnimationFrame(() => {
      const firstPointId = requestedLiveFocus.sourcePointIds[0]
      if (firstPointId) {
        if (!isNarrow || mobileTab === 'source') {
          delete pendingRelationScrollRef.current.source
          pointRefs.current.get(firstPointId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        } else pendingRelationScrollRef.current.source = firstPointId
      }
      const firstParagraphId = requestedLiveFocus.draftParagraphIds[0]
      if (firstParagraphId) {
        if (!isNarrow || mobileTab === 'ai') {
          delete pendingRelationScrollRef.current.ai
          paragraphRefs.current.get(firstParagraphId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        } else pendingRelationScrollRef.current.ai = firstParagraphId
      }
    })
  }, [activeDraft?.id, isNarrow, mobileTab, onRelationFocus, pinnedFocus, requestedFocus, selectDraft, workspace.drafts])

  useEffect(() => {
    if (!isNarrow) return
    window.requestAnimationFrame(() => {
      if (mobileTab === 'source') {
        const pendingPointId = pendingRelationScrollRef.current.source
        if (pendingPointId) {
          delete pendingRelationScrollRef.current.source
          pointRefs.current.get(pendingPointId)?.scrollIntoView({ block: 'center' })
          return
        }
        if (mobileScrollTops.source > 0) return
        const pointId = highlightedPointIds[0]
        if (pointId) pointRefs.current.get(pointId)?.scrollIntoView({ block: 'center' })
        return
      }
      if (mobileTab === 'ai') {
        const pendingParagraphId = pendingRelationScrollRef.current.ai
        if (pendingParagraphId) {
          delete pendingRelationScrollRef.current.ai
          paragraphRefs.current.get(pendingParagraphId)?.scrollIntoView({ block: 'center' })
          return
        }
        if (mobileScrollTops.ai > 0) return
        const paragraphId = liveFocus.current?.draftParagraphIds.find((id) => paragraphRefs.current.has(id))
          ?? activeParagraphs.find((paragraph) => paragraph.sourcePointIds.some((id) => highlightedPointIds.includes(id)))?.id
        if (paragraphId) paragraphRefs.current.get(paragraphId)?.scrollIntoView({ block: 'center' })
        return
      }
      const live = liveFocus.current
      if (!live) return
      const replay = mergeRelationFocus(live, pinnedFocus, 'draft')
      handledFocusToken.current = replay.token
      onRelationFocus(replay)
    })
  }, [activeParagraphs, highlightedPointIds, isNarrow, mobileScrollTops.ai, mobileScrollTops.source, mobileTab, onRelationFocus, pinnedFocus])

  const sendChat = async (messageOverride?: string | StructuredComposerSnapshot): Promise<void> => {
    if (readOnlySnapshot) {
      onNotice('这是历史版本的冻结工作台；恢复为新的当前版本后才能继续生成。')
      return
    }
    const composerSnapshot = typeof messageOverride === 'object' ? messageOverride : null
    const outgoingMessage = typeof messageOverride === 'string' ? messageOverride : composerSnapshot?.displayText ?? chatMessage
    if ((!outgoingMessage.trim() && hasDraftForWorkingRevision) || !workingContent.trim() || chatting || busy) return
    setBusy(true)
    try {
      let next = await updateWorkspace({ workingContent, aiCount: workspace.aiCount, webSearchMode: workspace.webSearchMode })
      if (!next.activeRevision || next.activeRevision.content !== workingContent) {
        next = await creatorOS().createScriptMaterialRevision(workspace.projectId)
        onWorkspaceChange(next)
      }
      const sides: ScriptMaterialAiSide[] = next.drafts.length === 0 && next.aiCount === 2 ? ['codex', 'claude'] : [activeSide]
      const firstRound = sides.every((side) => !next.drafts.some((draft) => draft.side === side))
      const currentParagraphs = currentDocumentParagraphs()
      let failedCount = 0
      let unavailableCount = 0
      if (firstRound) {
        const batchRequests: Array<{ side: ScriptMaterialAiSide; providerConfigId: string; preferredModel: string | null }> = []
        sides.forEach((side) => {
          if (side === 'codex') batchRequests.push({ side, providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, preferredModel: preferredCodexModel })
          else if (claudeAvailable) batchRequests.push({ side, providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude, preferredModel: null })
        })
        const instruction = await buildStructuredInstructionPayload({
          projectId: next.projectId,
          sessionScope: `script-material:${next.projectId}:${next.activeRevision!.id}`,
          surface: 'script_material_first_draft',
          snapshot: composerSnapshot ?? { displayText: outgoingMessage, editorDocument: { type: 'doc', content: outgoingMessage ? [{ type: 'paragraph', content: [{ type: 'text', text: outgoingMessage }] }] : [{ type: 'paragraph' }] }, references: [] },
          target: null,
          currentDocumentParagraphs: currentParagraphs,
          materialRevisionId: next.activeRevision!.id,
          includeProjectContext,
          webSearchMode: next.webSearchMode,
          aiCount: batchRequests.length === 2 ? 2 : 1,
          targets: batchRequests.map((request) => ({
            providerConfigId: request.providerConfigId,
            requestedModel: request.side === 'codex' ? request.preferredModel ?? 'auto' : 'auto',
            requestedReasoningEffort: request.side === 'codex' ? 'xhigh' : null,
            historyThreadId: null,
            providerThreadId: null,
            historyMessageIds: []
          }))
        })
        const dispatched = await creatorOS().dispatchContentInstruction({
          operation: 'script_material_chat',
          instruction,
          request: {
            projectId: next.projectId,
            message: outgoingMessage,
            includeProjectContext,
            requests: batchRequests,
            currentDocumentParagraphs: currentParagraphs
          }
        })
        const tasks = dispatched.tasks
        failedCount = 0
        unavailableCount = sides.length - batchRequests.length
        if (!tasks.length) throw new Error('当前没有可用的AI Provider')
      } else {
        const taskRequests: Array<{ side: ScriptMaterialAiSide; providerConfigId: string; preferredModel: string | null }> = []
        const providerTargets: Array<{ providerConfigId: string; requestedModel: string; requestedReasoningEffort: string | null; historyThreadId: null; providerThreadId: null; historyMessageIds: string[] }> = []
        if (sides.includes('codex')) {
          providerTargets.push({
            providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
            requestedModel: preferredCodexModel ?? 'auto',
            requestedReasoningEffort: 'xhigh',
            historyThreadId: null,
            providerThreadId: null,
            historyMessageIds: next.messages.filter((message) => message.revisionId === next.activeRevision!.id && message.side === 'codex').slice(-100).map((message) => message.id)
          })
          taskRequests.push({ side: 'codex', providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, preferredModel: preferredCodexModel })
        }
        if (sides.includes('claude') && claudeAvailable) {
          providerTargets.push({
            providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
            requestedModel: 'auto',
            requestedReasoningEffort: null,
            historyThreadId: null,
            providerThreadId: null,
            historyMessageIds: next.messages.filter((message) => message.revisionId === next.activeRevision!.id && message.side === 'claude').slice(-100).map((message) => message.id)
          })
          taskRequests.push({ side: 'claude', providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude, preferredModel: null })
        }
        if (!taskRequests.length) throw new Error('当前没有可用的AI Provider')
        const instruction = await buildStructuredInstructionPayload({
          projectId: next.projectId,
          sessionScope: `script-material:${next.projectId}:${next.activeRevision!.id}`,
          surface: 'script_material_chat',
          snapshot: composerSnapshot ?? { displayText: outgoingMessage, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: outgoingMessage }] }] }, references: [] },
          target: activeDraft ? { kind: 'material_draft', draftId: activeDraft.id, contentHash: activeDraft.contentHash, paragraphSelections: [], applicationTarget: null } : null,
          currentDocumentParagraphs: currentParagraphs,
          materialRevisionId: next.activeRevision!.id,
          includeProjectContext,
          webSearchMode: next.webSearchMode,
          aiCount: providerTargets.length === 2 ? 2 : 1,
          targets: providerTargets
        })
        await creatorOS().dispatchContentInstruction({
          operation: 'script_material_chat',
          instruction,
          request: {
            projectId: next.projectId,
            message: outgoingMessage,
            includeProjectContext,
            requests: taskRequests,
            currentDocumentParagraphs: currentParagraphs
          }
        })
        failedCount = 0
        unavailableCount = sides.length - taskRequests.length
      }
      if (messageOverride === undefined || composerSnapshot) setChatMessage('')
      onNotice(failedCount || unavailableCount
        ? `已发送给可用的AI；另有${failedCount + unavailableCount}个Provider未能启动，可先继续成功的一侧。`
        : firstRound && sides.length === 2 ? '同一份原稿已同时发送给Codex和Claude；新稿完成后会各自用AI建立一次首次对应。' : '已发送；新稿完成后会自动用AI建立一次首次三栏对应。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : 'AI稿对话启动失败')
    } finally {
      setBusy(false)
    }
  }

  const focusPoints = (pointIds: string[], draftParagraphIds: string[] = []): void => {
    if (!pointIds.length) {
      publishFocus({
        origin: 'draft',
        draftId: activeDraft?.id ?? null,
        draftParagraphIds,
        sourcePointIds: []
      })
      onNotice(activeDraft?.mappingState === 'pending'
        ? '这篇新稿正在用AI建立首次对应。'
        : activeDraft?.mappingState === 'failed'
          ? '这篇稿的首次对应失败，可以点击“重新匹配”。'
          : activeDraftMappingMissing
            ? '检测到这篇旧稿没有真正建立来源对应，正在自动补做一次AI对应。'
            : '这一段暂时没有找到可靠的原稿对应。')
      return
    }
    publishFocus({
      origin: 'draft',
      draftId: activeDraft?.id ?? null,
      draftParagraphIds,
      sourcePointIds: pointIds
    })
    const first = pointIds[0]
    if (first) pointRefs.current.get(first)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const focusParagraphs = (pointId: string): void => {
    const matchingParagraphs = activeParagraphs.filter((item) => item.sourcePointIds.includes(pointId))
    const paragraph = matchingParagraphs[0]
    publishFocus({
      origin: 'source',
      draftId: activeDraft?.id ?? null,
      draftParagraphIds: matchingParagraphs.map((item) => item.id),
      sourcePointIds: [pointId]
    })
    if (paragraph) paragraphRefs.current.get(paragraph.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const selectAiParagraph = (
    paragraphId: string,
    paragraphIndex: number,
    options: { toggle: boolean; range: boolean }
  ): string[] => {
    let nextIds: string[]
    if (options.range && paragraphSelectionAnchor.current !== null) {
      const start = Math.min(paragraphSelectionAnchor.current, paragraphIndex)
      const end = Math.max(paragraphSelectionAnchor.current, paragraphIndex)
      const rangeIds = activeParagraphs.slice(start, end + 1).map((item) => item.id)
      nextIds = options.toggle
        ? [...new Set([...selectedParagraphIds, ...rangeIds])]
        : rangeIds
    } else if (options.toggle) {
      nextIds = selectedParagraphIds.includes(paragraphId)
        ? selectedParagraphIds.filter((id) => id !== paragraphId)
        : [...selectedParagraphIds, paragraphId]
    } else {
      nextIds = [paragraphId]
    }
    paragraphSelectionAnchor.current = paragraphIndex
    setSelectedParagraphIds(nextIds)
    return nextIds
  }

  const focusSelectedAiParagraphs = (paragraphIds: string[], fallbackParagraphId: string): void => {
    const focusedIds = paragraphIds.length ? paragraphIds : [fallbackParagraphId]
    const focusedParagraphs = activeParagraphs.filter((item) => focusedIds.includes(item.id))
    const pointIds = [...new Set(focusedParagraphs.flatMap((item) => item.sourcePointIds))]
    focusPoints(pointIds, focusedIds)
  }

  const beginParagraphDrag = (
    event: React.DragEvent<HTMLElement>,
    paragraph: ScriptMaterialDraft['paragraphs'][number],
    paragraphIndex: number
  ): void => {
    if (readOnlySnapshot || !activeDraft) {
      event.preventDefault()
      return
    }
    const paragraphIds = selectedParagraphIds.includes(paragraph.id)
      ? activeParagraphs.filter((item) => selectedParagraphIds.includes(item.id)).map((item) => item.id)
      : [paragraph.id]
    if (!selectedParagraphIds.includes(paragraph.id)) {
      setSelectedParagraphIds(paragraphIds)
      paragraphSelectionAnchor.current = paragraphIndex
      focusSelectedAiParagraphs(paragraphIds, paragraph.id)
    }
    const payload: ScriptMaterialDragPayload = {
      draftId: activeDraft.id,
      paragraphIds,
      annotations: sourceAnnotations.filter((annotation) => paragraphIds.includes(annotation.blockId))
    }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(SCRIPT_MATERIAL_DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', activeParagraphs
      .filter((item) => paragraphIds.includes(item.id))
      .map((item) => item.text)
      .join('\n\n'))
  }

  const remapActiveDraft = useCallback(async (automatic = false): Promise<void> => {
    if (readOnlySnapshot || !activeDraft || activeDraft.mappingState === 'pending') return
    const providerConfigId = activeDraft.providerConfigId ?? (activeDraft.side === 'claude'
      ? BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude
      : BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex)
    try {
      await creatorOS().startScriptMaterialMapping(
        workspace.projectId,
        activeDraft.id,
        providerConfigId,
        currentDocumentParagraphs()
      )
      const next = await creatorOS().getScriptMaterialWorkspace(workspace.projectId)
      onWorkspaceChange(next)
      onNotice(automatic
        ? '检测到这篇旧稿缺少来源关系，正在自动补做一次AI对应；正文不会被修改。'
        : '正在用AI重新匹配这篇稿；已生成内容不会被修改。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '重新匹配启动失败')
    }
  }, [activeDraft, currentDocumentParagraphs, onNotice, onWorkspaceChange, readOnlySnapshot, workspace.projectId])

  useEffect(() => {
    if (readOnlySnapshot || !activeDraft || !activeDraftMappingMissing || autoMappingDraftIds.current.has(activeDraft.id)) return
    autoMappingDraftIds.current.add(activeDraft.id)
    void remapActiveDraft(true)
  }, [activeDraft, activeDraftMappingMissing, readOnlySnapshot, remapActiveDraft])

  const confirmParagraphAnnotations = async (paragraphId: string, annotationIds: string[]): Promise<void> => {
    if (readOnlySnapshot || !activeDraft || !annotationIds.length || confirmingParagraphId) return
    setConfirmingParagraphId(paragraphId)
    try {
      const next = await creatorOS().confirmScriptMaterialAnnotations(
        workspace.projectId,
        activeDraft.id,
        paragraphId,
        annotationIds
      )
      onWorkspaceChange(next)
      onNotice('这段AI推断补写已确认，红色提示已取消。')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '确认补写失败')
    } finally {
      setConfirmingParagraphId(null)
    }
  }

  const submitParagraphRewrite = async (request?: RewriteRequest | string): Promise<void> => {
    if (readOnlySnapshot || !rewriteMenu || !activeDraft || busy) return
    const quickLabel = typeof request === 'object' && request.quickIntent
      ? REWRITE_QUICK_ACTIONS.find((item) => item.id === request.quickIntent)?.label ?? ''
      : ''
    const requirement = typeof request === 'string'
      ? request
      : typeof request === 'object'
        ? [quickLabel, request.requirement].filter(Boolean).join('：')
        : rewriteMenu.requirement.trim()
    if (!requirement) return
    setBusy(true)
    try {
      const providerConfigId = BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex
      const parentCandidate = rewriteMenu.candidateId
        ? workspace.rewriteCandidates.find((candidate) => candidate.id === rewriteMenu.candidateId) ?? null
        : null
      if (rewriteMenu.candidateId && !parentCandidate) throw new Error('上一轮候选已变化，请重新打开候选')
      // Continue from the frozen candidate while preserving its original
      // current-document destination. Recapturing would silently bind the
      // child to whatever text happens to exist now.
      const applicationTarget = parentCandidate
        ? parentCandidate.applicationTarget
        : await captureRewriteApplicationTarget(activeDraft.id, rewriteMenu.paragraphTargets.map((item) => item.paragraphId))
      const paragraphSelections = rewriteMenu.selectedText && rewriteMenu.selectedStart !== null && rewriteMenu.selectedEnd !== null
        ? [{ paragraphId: rewriteMenu.paragraphId, from: rewriteMenu.selectedStart, to: rewriteMenu.selectedEnd, text: rewriteMenu.selectedText }]
        : rewriteMenu.paragraphTargets.filter((paragraph) => paragraph.text.length).map((paragraph) => ({ paragraphId: paragraph.paragraphId, from: 0, to: paragraph.text.length, text: paragraph.text }))
      const instruction = await buildStructuredInstructionPayload({
        projectId: workspace.projectId,
        sessionScope: `script-material:${workspace.projectId}:${workspace.activeRevision!.id}`,
        surface: 'script_material_rewrite',
        snapshot: typeof request === 'object' && request.structuredInstruction
          ? { ...request.structuredInstruction, displayText: requirement }
          : { displayText: requirement, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: requirement }] }] }, references: [] },
        target: { kind: 'material_draft', draftId: activeDraft.id, contentHash: activeDraft.contentHash, paragraphSelections, applicationTarget },
        materialRevisionId: workspace.activeRevision!.id,
        includeProjectContext,
        webSearchMode: workspace.webSearchMode,
        aiCount: 1,
        targets: [{
          providerConfigId,
          requestedModel: typeof request === 'object' ? request.preferredModel ?? 'auto' : preferredCodexModel ?? 'auto',
          requestedReasoningEffort: typeof request === 'object' ? request.preferredReasoningEffort ?? 'xhigh' : 'xhigh',
          historyThreadId: null,
          providerThreadId: null,
          historyMessageIds: workspace.messages.filter((message) => message.revisionId === workspace.activeRevision!.id && message.side === activeDraft.side).slice(-100).map((message) => message.id)
        }]
      })
      const dispatched = await creatorOS().dispatchContentInstruction({
        operation: 'script_material_rewrite',
        instruction,
        request: {
        projectId: workspace.projectId,
        draftId: activeDraft.id,
        parentCandidateId: rewriteMenu.candidateId,
        applicationTarget,
        paragraphIds: rewriteMenu.paragraphTargets.map((item) => item.paragraphId),
        selectedParagraphId: rewriteMenu.selectedText ? rewriteMenu.paragraphId : null,
        selectedText: rewriteMenu.selectedText,
        selectedStart: rewriteMenu.selectedStart,
        selectedEnd: rewriteMenu.selectedEnd,
        requirement,
        providerConfigId,
        includeProjectContext,
        preferredModel: typeof request === 'object' ? request.preferredModel : preferredCodexModel,
        preferredReasoningEffort: typeof request === 'object' ? request.preferredReasoningEffort : 'xhigh'
        }
      })
      const task = dispatched.tasks[0]
      if (!task) throw new Error('局部候选任务没有成功建立')
      setRewriteMenu(null)
      onNotice(`局部候选已转到后台生成（任务${task.id.slice(0, 6)}）；可以继续滚动、编辑或发起其他候选。`)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '局部候选生成失败')
    } finally {
      setBusy(false)
    }
  }

  const saveSourceAnnotation = async (style: 'highlight' | 'underline' | 'strike' | 'flag', note = ''): Promise<void> => {
    const target = annotationMenu ?? rewriteMenu
    if (readOnlySnapshot || !target || !window.creatorOS || !activeDraft) return
    try {
      const ranges = target.selectedStart !== null && target.selectedEnd !== null
        ? [{ paragraphId: target.paragraphId, start: target.selectedStart, end: target.selectedEnd, text: target.selectedText }]
        : target.paragraphTargets.filter((paragraph) => paragraph.text.length).map((paragraph) => ({ paragraphId: paragraph.paragraphId, start: 0, end: paragraph.text.length, text: paragraph.text }))
      if (!ranges.length) { onNotice('当前没有可标记的文字'); return }
      const annotations = await Promise.all(ranges.map((range) => window.creatorOS!.upsertSourceScriptAnnotation({
        id: `script-annotation-${crypto.randomUUID()}`,
        projectId: workspace.projectId,
        sourceKind: 'material_draft',
        sourceId: activeDraft.id,
        sourceVersion: activeDraft.contentHash,
        blockId: range.paragraphId,
        blockStart: range.start,
        blockEnd: range.end,
        selectedText: range.text,
        style,
        note: note.trim(),
        status: 'active'
      })))
      setSourceAnnotations((current) => [...current, ...annotations])
      setRewriteMenu(null); setAnnotationMenu(null); setAnnotationNote('')
      onNotice(`${style === 'highlight' ? '高亮' : style === 'underline' ? '下划线' : style === 'strike' ? '删除线' : '旗标'}已保存为工作台标记。`)
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '保存工作台标记失败') }
  }

  const clearSourceAnnotations = async (): Promise<void> => {
    const target = annotationMenu ?? rewriteMenu
    if (!target || !window.creatorOS || !activeDraft) return
    const targetRanges = target.selectedStart !== null && target.selectedEnd !== null
      ? [{ paragraphId: target.paragraphId, start: target.selectedStart, end: target.selectedEnd }]
      : target.paragraphTargets.map((paragraph) => ({ paragraphId: paragraph.paragraphId, start: 0, end: paragraph.text.length }))
    const matches = sourceAnnotations.filter((annotation) => targetRanges.some((range) => annotation.blockId === range.paragraphId
      && annotation.blockEnd > range.start && annotation.blockStart < range.end))
    try {
      const replacements: ScriptTextAnnotation[] = []
      for (const annotation of matches) {
        await window.creatorOS.deleteSourceScriptAnnotation(workspace.projectId, annotation.id)
        const paragraph = activeDraft?.paragraphs.find((item) => item.id === annotation.blockId)
        const overlaps = targetRanges.filter((range) => range.paragraphId === annotation.blockId)
        let pieces: Array<[number, number]> = [[annotation.blockStart, annotation.blockEnd]]
        overlaps.forEach((overlap) => {
          pieces = pieces.flatMap(([start, end]) => {
            const next: Array<[number, number]> = []
            const beforeEnd = Math.min(end, overlap.start)
            const afterStart = Math.max(start, overlap.end)
            if (beforeEnd > start) next.push([start, beforeEnd])
            if (end > afterStart) next.push([afterStart, end])
            return next
          })
        })
        for (const [start, end] of pieces) {
          if (!paragraph || paragraph.text.slice(start, end).length !== end - start) continue
          replacements.push(await window.creatorOS.upsertSourceScriptAnnotation({
            id: `script-annotation-${crypto.randomUUID()}`,
            projectId: workspace.projectId,
            sourceKind: 'material_draft',
            sourceId: annotation.sourceId,
            sourceVersion: annotation.sourceVersion,
            blockId: annotation.blockId,
            blockStart: start,
            blockEnd: end,
            selectedText: paragraph.text.slice(start, end),
            style: annotation.style,
            note: annotation.note,
            status: annotation.status
          }))
        }
      }
      setSourceAnnotations((current) => [...current.filter((annotation) => !matches.some((match) => match.id === annotation.id)), ...replacements])
      setAnnotationMenu(null); setRewriteMenu(null); setAnnotationNote('')
      onNotice(matches.length ? '已清除当前范围的工作台标记。' : '当前范围没有可清除的工作台标记。')
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '清除工作台标记失败') }
  }

  const latestMatchingRewriteCandidate = rewriteMenu
    ? [...workspace.rewriteCandidates].reverse().find((candidate) => candidate.content.trim()
      && candidate.draftId === rewriteMenu.draftId
      && candidate.selectedText === rewriteMenu.selectedText
      && candidate.paragraphIds.length === rewriteMenu.paragraphTargets.length
      && candidate.paragraphIds.every((id) => rewriteMenu.paragraphTargets.some((target) => target.paragraphId === id)))
    : null

  const openRewriteCandidate = (
    candidate: ScriptMaterialRewriteCandidate,
    anchor: HTMLElement,
    anchorPoint?: { x: number; y: number }
  ): void => {
    const draft = workspace.drafts.find((item) => item.id === candidate.draftId)
    const paragraphTargets = (draft?.paragraphs ?? [])
      .filter((paragraph) => candidate.paragraphIds.includes(paragraph.id))
      .map((paragraph) => ({
        paragraphId: paragraph.id,
        position: paragraph.position,
        text: paragraph.text
      }))
    const fallbackText = candidate.selectedText || '原目标段落已经变化，可以根据任务要求重新生成。'
    const targets = paragraphTargets.length ? paragraphTargets : [{
      paragraphId: candidate.paragraphIds[0] ?? '',
      position: 0,
      text: fallbackText
    }]
    setRewriteTasksAnchor(null)
    setRewriteMenu({
      anchor,
      anchorPoint: anchorPoint ?? (() => {
        const rect = anchor.getBoundingClientRect()
        return { x: rect.left + Math.min(rect.width, 24), y: rect.bottom }
      })(),
      draftId: candidate.draftId,
      paragraphId: candidate.paragraphIds[0] ?? targets[0]!.paragraphId,
      paragraphText: targets[0]!.text,
      paragraphTargets: targets,
      selectedText: candidate.selectedText,
      selectedStart: candidate.selectedStart,
      selectedEnd: candidate.selectedEnd,
      view: 'candidate',
      requirement: candidate.requirement,
      taskId: candidate.taskId,
      candidateId: candidate.id
    })
  }

  const rewriteCandidateState = (candidate: ScriptMaterialRewriteCandidate): 'active' | 'ready' | 'failed' => {
    if (candidate.content.trim()) return 'ready'
    const task = candidate.taskId ? tasks.find((item) => item.id === candidate.taskId) : null
    const status = readOnlySnapshot ? candidate.taskStatusAtSnapshot : task?.status
    return status === 'failed' || status === 'canceled' ? 'failed' : 'active'
  }

  const rewriteCandidateTarget = (candidate: ScriptMaterialRewriteCandidate): string => {
    if (candidate.selectedText) return candidate.selectedText
    const draft = workspace.drafts.find((item) => item.id === candidate.draftId)
    return (draft?.paragraphs ?? [])
      .filter((paragraph) => candidate.paragraphIds.includes(paragraph.id))
      .map((paragraph) => paragraph.text)
      .join('\n\n') || '原目标段落已经变化'
  }

  const togglePinnedFocus = (): void => {
    if (pinnedFocus) {
      setPinnedFocus(null)
      const current = liveFocus.current
      if (current) {
        const next = mergeRelationFocus(current, null)
        handledFocusToken.current = next.token
        onRelationFocus(next)
      }
      onNotice('已取消固定高亮；下次定位会正常替换当前高亮。')
      return
    }
    const current = liveFocus.current
    if (!current || (!current.sourcePointIds.length && !current.draftParagraphIds.length)) {
      onNotice('请先点选一处有来源关系的内容，再固定本次高亮。')
      return
    }
    setPinnedFocus(current)
    const next = mergeRelationFocus(current, current)
    handledFocusToken.current = next.token
    onRelationFocus(next)
    onNotice('已固定本次高亮；继续定位其他内容时，这组对应仍会保留。')
  }

  const selectMobileTab = (tab: ScriptMaterialMobileTab, moveFocus = false): void => {
    onMobileTabChange(tab)
    if (moveFocus) window.requestAnimationFrame(() => document.getElementById(`script-material-${tab}-tab`)?.focus())
  }

  const handleMobileTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number): void => {
    let nextIndex = currentIndex
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex + SCRIPT_MATERIAL_MOBILE_TABS.length - 1) % SCRIPT_MATERIAL_MOBILE_TABS.length
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SCRIPT_MATERIAL_MOBILE_TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = SCRIPT_MATERIAL_MOBILE_TABS.length - 1
    else return
    event.preventDefault()
    const next = SCRIPT_MATERIAL_MOBILE_TABS[nextIndex]
    if (next) selectMobileTab(next.id, true)
  }

  return <div className={`script-material-workspace${readOnlySnapshot ? ' is-read-only-snapshot' : ''}`}>
    <div className="script-material-toolbar">
      <button
        className={`script-material-pin-highlight${pinnedFocus ? ' active' : ''}`}
        aria-pressed={Boolean(pinnedFocus)}
        disabled={!pinnedFocus && !liveFocus.current}
        title={pinnedFocus ? '取消固定后，新的定位会替换当前高亮' : '保留本次三栏对应，便于来回阅读'}
        onClick={togglePinnedFocus}
      ><Pin size={12} />{pinnedFocus ? '已固定高亮' : '固定本次高亮'}</button>
      {readOnlySnapshot ? <span className="script-material-read-only-chip">历史版本·只读</span> : null}
      <ProjectContextToggle value={includeProjectContext} disabled={readOnlySnapshot} className={includeProjectContext ? 'active' : ''} onChange={onIncludeProjectContextChange} />
      <WebSearchModeControl value={workspace.webSearchMode} disabled={readOnlySnapshot} onChange={(webSearchMode) => void updateWorkspace({ webSearchMode })} />
      <CodexModelControl models={codexModels} value={preferredCodexModel} disabled={readOnlySnapshot} className="script-material-model-select" ariaLabel="Codex成稿模型" onChange={onPreferredCodexModelChange} />
      <AiCountControl value={workspace.aiCount} disabled={readOnlySnapshot} className="script-material-ai-count" ariaLabel="AI数量" onChange={(aiCount) => void updateWorkspace({ aiCount })} />
    </div>

    <div className="script-material-mobile-tabs" role="tablist" aria-label="素材成稿窄窗栏目">
      {SCRIPT_MATERIAL_MOBILE_TABS.map((tab, index) => <button
        id={`script-material-${tab.id}-tab`}
        key={tab.id}
        role="tab"
        aria-selected={mobileTab === tab.id}
        aria-controls={`script-material-${tab.id}-panel`}
        tabIndex={mobileTab === tab.id ? 0 : -1}
        className={mobileTab === tab.id ? 'active' : ''}
        onClick={() => selectMobileTab(tab.id)}
        onKeyDown={(event) => handleMobileTabKeyDown(event, index)}
      >{tab.label}</button>)}
    </div>

    <div className="script-material-columns">
      <section
        id="script-material-source-panel"
        className={`script-material-pane source-pane${mobileTab === 'source' ? ' is-mobile-active' : ''}`}
        role={isNarrow ? 'tabpanel' : undefined}
        aria-labelledby={isNarrow ? 'script-material-source-tab' : undefined}
        hidden={isNarrow && mobileTab !== 'source'}
      >
        <header><div><span>原有顺序</span><h2>整理前的原始文案</h2></div><div className="script-material-source-actions">{workspace.activeRevision ? <em>修订v{workspace.activeRevision.revision}{sourceChanged ? '·有新修改' : ''}</em> : null}{displayPoints.length && !readOnlySnapshot ? <button onClick={() => setEditingSource((value) => !value)}><PencilLine size={12} />{editingSource ? '查看对应' : '编辑原稿'}</button> : null}</div></header>
        <div ref={sourceBodyRef} onScroll={(event) => rememberMobileScroll('source', event.currentTarget.scrollTop)} className={`script-material-source-body${!readOnlySnapshot && (editingSource || !displayPoints.length) ? ' editing' : ''}`}>
          {readOnlySnapshot && !displayPoints.length ? <div className="script-material-source-snapshot-empty">{workingContent || '这个历史版本没有冻结素材要点。'}</div> : !readOnlySnapshot && (editingSource || !displayPoints.length) ? <textarea aria-label="整理前的原始文案编辑区" value={workingContent} placeholder="把全程真实体验、乱序片段和待补写提示直接写在这里。" onChange={(event) => setWorkingContent(event.currentTarget.value)} onBlur={() => { if (workingContent !== workspace.workingContent) void updateWorkspace({ workingContent }) }} /> : <div className="script-material-point-list">
            {displayPoints.map((point) => {
              const active = highlightedPointIds.includes(point.id)
              const pinned = pinnedFocus?.sourcePointIds.includes(point.id) ?? false
              return <article key={point.id} ref={(node) => { if (node) pointRefs.current.set(point.id, node); else pointRefs.current.delete(point.id) }} className={`script-material-point${active ? ' active' : ''}${pinned ? ' is-highlight-pinned' : ''}`}>
                {pinned ? <span className="script-material-pinned-badge"><Pin size={10} />固定</span> : null}
                <div
                  className="script-material-selectable-content"
                  role="button"
                  tabIndex={0}
                  aria-label={`定位原稿段落：${point.summary || point.sourceText.slice(0, 24)}`}
                  onClick={(event) => {
                    if (!selectedTextInside(event.currentTarget)) focusParagraphs(point.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    focusParagraphs(point.id)
                  }}
                >
                  <p>{point.sourceText}</p>
                </div>
              </article>
            })}
          </div>}
        </div>
      </section>

      <section
        id="script-material-ai-panel"
        className={`script-material-pane ai-pane${mobileTab === 'ai' ? ' is-mobile-active' : ''}`}
        role={isNarrow ? 'tabpanel' : undefined}
        aria-labelledby={isNarrow ? 'script-material-ai-tab' : undefined}
        hidden={isNarrow && mobileTab !== 'ai'}
      >
        <header><div><span>AI成稿顺序</span><h2>AI稿</h2></div><div className="script-material-ai-actions">
          {activeDraft && currentDocumentEmpty && !readOnlySnapshot ? <button
            className="primary-action script-material-establish-current"
            aria-label={selectedParagraphIds.length ? `以所选${selectedParagraphIds.length}段建立当前文案` : '以此稿建立当前文案'}
            title="只有明确点击后才会把AI稿写入当前文案"
            onClick={() => onApplyDraft(activeDraft, 'replace', selectedParagraphIds.length ? selectedParagraphIds : undefined, sourceAnnotations)}
          >{selectedParagraphIds.length ? `以所选${selectedParagraphIds.length}段建立` : '以此稿建立当前文案'}</button> : null}
          {workspace.aiCount === 2 ? <div className="script-material-side-tabs" role="tablist" aria-label="AI稿选择"><button role="tab" aria-selected={activeSide === 'codex'} className={activeSide === 'codex' ? 'active' : ''} onClick={() => readOnlySnapshot ? setReadOnlySelection((current) => ({ ...current, side: 'codex' })) : void updateWorkspace({ selectedAiSide: 'codex' })}>Codex稿</button><button role="tab" aria-selected={activeSide === 'claude'} className={activeSide === 'claude' ? 'active' : ''} onClick={() => readOnlySnapshot ? setReadOnlySelection((current) => ({ ...current, side: 'claude' })) : void updateWorkspace({ selectedAiSide: 'claude' })}>Claude稿</button></div> : null}
          {activeDraft ? <div className="script-material-draft-switch" aria-label="AI稿版本切换">
            <button aria-label="上一篇AI稿" disabled={activeDraftIndex <= 0} onClick={() => { const draft = sideDrafts[activeDraftIndex - 1]; if (draft) void selectDraft(draft) }}><ChevronLeft size={13} /></button>
            <span>第{activeDraft.draftVersion}／{sideDrafts.length}稿</span>
            <button aria-label="下一篇AI稿" disabled={activeDraftIndex < 0 || activeDraftIndex >= sideDrafts.length - 1} onClick={() => { const draft = sideDrafts[activeDraftIndex + 1]; if (draft) void selectDraft(draft) }}><ChevronRight size={13} /></button>
          </div> : null}
          {activeRewriteCandidates.length ? <button
            className={`script-material-rewrite-tasks-button${activeRewriteCandidateCount ? ' is-active' : ''}`}
            aria-label={`局部任务${activeRewriteCandidates.length}个`}
            aria-expanded={Boolean(rewriteTasksAnchor)}
            onClick={(event) => {
              const anchor = event.currentTarget
              setRewriteTasksAnchor((current) => current ? null : anchor)
            }}
          >{activeRewriteCandidateCount ? <RefreshCw size={11} /> : <Sparkles size={11} />}局部任务{activeRewriteCandidateCount ? ` ${activeRewriteCandidateCount}` : ` ${activeRewriteCandidates.length}`}</button> : null}
          {activeDraft && !auditControlsHidden ? <ScriptMaterialAuditControl
            workspace={workspace}
            target={activeDraft.side}
            targetIdentity={activeDraft.id}
            contentHash={activeDraft.contentHash}
            contextStale={sourceChanged}
            readOnlySnapshot={readOnlySnapshot}
            tasks={tasks}
            onWorkspaceChange={onWorkspaceChange}
            onNotice={onNotice}
          /> : null}
          {activeDraft?.mappingState === 'pending' ? <em className="mapping pending">匹配中</em> : activeDraft?.mappingState === 'failed' ? readOnlySnapshot ? <em className="mapping failed">当时匹配失败</em> : <button className="mapping failed" title={activeDraft.mappingError ?? '首次对应失败'} onClick={() => void remapActiveDraft()}><RefreshCw size={11} />匹配失败</button> : activeDraftMappingMissing ? readOnlySnapshot ? <em className="mapping failed">当时未建立对应</em> : <button className="mapping failed" title="这篇旧稿尚未真正建立来源对应" onClick={() => void remapActiveDraft()}><RefreshCw size={11} />建立对应</button> : activeDraft && !readOnlySnapshot ? <button className="mapping ready" aria-label="重新匹配" onClick={() => void remapActiveDraft()} title="认为来源不准确时，主动用AI重新匹配"><RefreshCw size={11} /></button> : null}
          {activeDraft?.model ? <em title="本稿实际使用的模型与推理档位">{activeDraft.model}{activeDraft.reasoningEffort ? `·${activeDraft.reasoningEffort}` : ''}</em> : null}
          {activeDraft && currentDocumentState === 'ready' && !readOnlySnapshot ? <><button aria-label={selectedParagraphIds.length ? `追加所选${selectedParagraphIds.length}段到当前文案` : '追加到当前文案'} title={selectedParagraphIds.length ? `按AI稿顺序追加所选${selectedParagraphIds.length}段` : '追加整篇AI稿到当前文案'} onClick={() => onApplyDraft(activeDraft, 'append', selectedParagraphIds.length ? selectedParagraphIds : undefined, sourceAnnotations)}>{selectedParagraphIds.length ? `追加${selectedParagraphIds.length}段` : '追加'}</button><button className="primary-action" aria-label="替换当前文案" title="用整篇AI稿替换当前文案" onClick={() => onApplyDraft(activeDraft, 'replace', undefined, sourceAnnotations)}>替换</button></> : null}
        </div></header>
        <div ref={aiBodyRef} onScroll={(event) => rememberMobileScroll('ai', event.currentTarget.scrollTop)} className="script-material-ai-body">
          {activeMessages.length ? <div className="script-material-chat-history">{activeMessages.map((message) => <article key={message.id} className={message.role}><b>{message.role === 'user' ? '你' : activeSide === 'codex' ? 'Codex' : 'Claude'}</b><p>{message.content}</p></article>)}</div> : null}
          {selectedParagraphIds.length > 1 ? <div className="script-material-selection-status" role="status"><span>已选{selectedParagraphIds.length}段·右键修改</span><small>⌘点选增减·Shift连续选择</small><button onClick={() => { setSelectedParagraphIds([]); paragraphSelectionAnchor.current = null }}>清除</button></div> : null}
          {activeDraft ? <div className="script-material-paragraph-list">{activeParagraphs.map((paragraph, paragraphIndex) => {
            const active = paragraph.sourcePointIds.some((id) => highlightedPointIds.includes(id))
              || highlightedDraftParagraphIds.includes(paragraph.id)
            const pinned = Boolean(pinnedFocus?.sourcePointIds.some((id) => paragraph.sourcePointIds.includes(id))
              || (pinnedFocus?.draftId === activeDraft.id && pinnedFocus.draftParagraphIds.includes(paragraph.id)))
            const selected = selectedParagraphIds.includes(paragraph.id)
            const visibleAnnotations = paragraph.annotations.filter((annotation) => annotation.status === 'active')
            const pendingAnnotations = visibleAnnotations.filter((annotation) => annotation.provenance === 'needs_confirmation')
            const aiSupplementCount = visibleAnnotations.filter((annotation) => annotation.provenance === 'ai_supplement').length
            const webSources = [...new Map(
              visibleAnnotations.flatMap((annotation) => annotation.webSources).map((source) => [source.url, source])
            ).values()]
            return <article key={paragraph.id} ref={(node) => { if (node) paragraphRefs.current.set(paragraph.id, node); else paragraphRefs.current.delete(paragraph.id) }} className={`script-material-paragraph${active ? ' active' : ''}${selected ? ' is-selected' : ''}${pinned ? ' is-highlight-pinned' : ''}`}>
              {pinned ? <span className="script-material-pinned-badge"><Pin size={10} />固定</span> : null}
              <button
                className="script-material-drag-handle"
                draggable={!readOnlySnapshot}
                disabled={readOnlySnapshot}
                aria-label={selected ? `拖动所选${selectedParagraphIds.length}段到当前文案` : '拖动这段到当前文案'}
                title={selected ? `拖动所选${selectedParagraphIds.length}段` : '拖动到当前文案指定位置'}
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => beginParagraphDrag(event, paragraph, paragraphIndex)}
              ><GripVertical size={13} /></button>
              <div
                className="script-material-paragraph-content"
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`定位AI稿段落：${paragraph.text.slice(0, 24)}`}
                onClick={(event) => {
                  if (selectedTextInside(event.currentTarget)) return
                  const nextIds = selectAiParagraph(paragraph.id, paragraphIndex, {
                    toggle: event.metaKey || event.ctrlKey,
                    range: event.shiftKey
                  })
                  focusSelectedAiParagraphs(nextIds, paragraph.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  const nextIds = selectAiParagraph(paragraph.id, paragraphIndex, { toggle: false, range: false })
                  focusSelectedAiParagraphs(nextIds, paragraph.id)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (readOnlySnapshot) return
                  const selection = rawSelectionInside(event.currentTarget)
                  const targetIds = selection
                    ? [paragraph.id]
                    : selectedParagraphIds.includes(paragraph.id) && selectedParagraphIds.length
                      ? selectedParagraphIds
                      : [paragraph.id]
                  if (!selection && !selectedParagraphIds.includes(paragraph.id)) {
                    setSelectedParagraphIds([paragraph.id])
                    paragraphSelectionAnchor.current = paragraphIndex
                  }
                  const paragraphTargets = activeParagraphs
                    .filter((item) => targetIds.includes(item.id))
                    .map((item) => ({
                      paragraphId: item.id,
                      position: item.position,
                      text: item.text
                    }))
                  if (!selection) focusSelectedAiParagraphs(targetIds, paragraph.id)
                  setRewriteMenu({
                    anchor: event.currentTarget,
                    anchorPoint: { x: event.clientX, y: event.clientY },
                    draftId: activeDraft.id,
                    paragraphId: paragraph.id,
                    paragraphText: paragraph.text,
                    paragraphTargets,
                    selectedText: selection?.text ?? '',
                    selectedStart: selection?.start ?? null,
                    selectedEnd: selection?.end ?? null,
                    view: 'menu',
                    requirement: '',
                    taskId: null,
                    candidateId: null
                  })
                }}
              >
                <ReadableMarkdown content={paragraph.text} annotations={visibleAnnotations.map((annotation) => ({
                  start: annotation.start,
                  end: annotation.end,
                  provenance: annotation.provenance,
                  label: `${annotation.provenance === 'needs_confirmation' ? 'AI推断补写·待确认' : annotation.provenance === 'web_supplement' ? '联网补充' : 'AI补写'}：${annotation.note}`
                }))} manualMarks={[
                  ...paragraph.manualMarks,
                  ...sourceAnnotations.filter((annotation) => annotation.blockId === paragraph.id).map((annotation) => ({
                    start: annotation.blockStart,
                    end: annotation.blockEnd,
                    style: annotation.style,
                    note: annotation.note,
                    status: annotation.status
                  }))
                ]} />
              </div>
              {visibleAnnotations.length ? <footer className="script-material-annotation-bar">
                {aiSupplementCount ? <span>AI补写·{aiSupplementCount}处</span> : null}
                {webSources.map((source) => <button key={source.url} title={source.title} onClick={() => void creatorOS().openExternalLink(source.url)}>联网来源·{source.title}</button>)}
                {pendingAnnotations.length ? readOnlySnapshot ? <span className="needs-confirmation">{`AI推断补写·当时待确认${pendingAnnotations.length > 1 ? ` ${pendingAnnotations.length}处` : ''}`}</span> : <button className="needs-confirmation" disabled={confirmingParagraphId === paragraph.id} onClick={() => void confirmParagraphAnnotations(paragraph.id, pendingAnnotations.map((annotation) => annotation.id))}>{confirmingParagraphId === paragraph.id ? '确认中…' : `AI推断补写·待确认${pendingAnnotations.length > 1 ? ` ${pendingAnnotations.length}处` : ''}`}</button> : null}
              </footer> : null}
            </article>
          })}</div> : <div className="script-material-empty">{chatting ? 'AI正在主动重构完整文案…' : '暂无对话'}</div>}
        </div>
        {readOnlySnapshot ? <div className="script-material-chat-composer is-read-only"><span>这是历史版本冻结的AI稿与对话；恢复为新的当前版本后才能继续生成。</span></div> : <StructuredReferenceComposer
          className="script-material-chat-composer"
          projectId={workspace.projectId}
          sessionScope={`script-material:${workspace.projectId}:${workspace.activeRevision?.id ?? 'working'}`}
          value={chatMessage}
          onValueChange={setChatMessage}
          ariaLabel="AI稿对话要求"
          hasCurrentTarget={hasDraftForWorkingRevision}
          placeholder={hasDraftForWorkingRevision ? '继续像和Codex一样讨论重写、扩写、换顺序或改语气；输入@可引用Brief、项目资料、图片、大纲和版本' : '可留空直接成稿；输入@可指定必须遵守、重点采用或只参考风格的资料'}
          disabled={!workingContent.trim()}
          busy={chatting || busy}
          allowEmpty={!hasDraftForWorkingRevision}
          submitLabel={hasDraftForWorkingRevision ? '发送' : '直接成稿'}
          onSubmit={sendChat}
        />}
      </section>

      <div
        id="script-material-current-panel"
        className={`script-material-current-column${mobileTab === 'current' ? ' is-mobile-active' : ''}`}
        role={isNarrow ? 'tabpanel' : undefined}
        aria-labelledby={isNarrow ? 'script-material-current-tab' : undefined}
        hidden={isNarrow && mobileTab !== 'current'}
      >
        {currentDocumentPane}
      </div>
    </div>
    {rewriteTasksAnchor ? <AnchoredPopover
      anchor={rewriteTasksAnchor}
      ariaLabel="AI稿局部任务"
      className="script-material-rewrite-task-popover"
      role="dialog"
      onDismiss={() => setRewriteTasksAnchor(null)}
    >
      <header><div><b>局部任务</b><small>后台生成，不影响继续编辑</small></div><button aria-label="关闭局部任务" onClick={() => setRewriteTasksAnchor(null)}><X size={13} /></button></header>
      <div className="script-material-rewrite-task-list">
        {activeRewriteCandidates.map((candidate) => {
          const state = rewriteCandidateState(candidate)
          const task = candidate.taskId ? tasks.find((item) => item.id === candidate.taskId) : null
          return <button
            key={candidate.id}
            className={state}
            disabled={state === 'active'}
            onClick={(event) => {
              if (state === 'failed') { dismissRewriteCandidate(candidate.id); return }
              const rect = event.currentTarget.getBoundingClientRect()
              openRewriteCandidate(candidate, rewriteTasksAnchor ?? event.currentTarget, { x: rect.left, y: rect.top })
            }}
          >
            <span className="script-material-rewrite-task-status">{state === 'ready' ? <Check size={11} /> : state === 'failed' ? <X size={11} /> : <RefreshCw size={11} />}{state === 'ready' ? '已完成' : state === 'failed' ? '失败' : '生成中'}</span>
            <b>{rewriteCandidateTarget(candidate)}</b>
            <small><span>{state === 'failed' ? (readOnlySnapshot ? candidate.taskErrorAtSnapshot : task?.errorMessage) ?? candidate.requirement : candidate.requirement}</span>{state === 'failed' ? <em>点击移除</em> : null}</small>
          </button>
        })}
      </div>
    </AnchoredPopover> : null}
    {rewriteMenu?.view === 'menu' ? <SelectionActionMenu
      anchor={rewriteMenu.anchor}
      anchorPoint={rewriteMenu.anchorPoint}
      selectionLabel={rewriteMenu.selectedText || rewriteMenu.paragraphTargets.map((item) => item.text).join('\n\n')}
      onDismiss={() => setRewriteMenu(null)}
      onRewrite={() => setRewriteMenu({ ...rewriteMenu, view: 'rewrite' })}
      onAnnotation={(style) => void saveSourceAnnotation(style)}
      onNote={() => { setAnnotationMenu(rewriteMenu); setAnnotationNote(''); setRewriteMenu(null) }}
      onClear={() => void clearSourceAnnotations()}
    >
      {latestMatchingRewriteCandidate ? <button role="menuitem" className="rewrite-entry" onClick={() => setRewriteMenu({ ...rewriteMenu, view: 'candidate', taskId: null, candidateId: latestMatchingRewriteCandidate.id })}><Sparkles size={15} /><span><b>查看最近候选</b><small>原AI稿保持不变</small></span></button> : null}
      {!rewriteMenu.selectedText && activeDraft && currentDocumentState !== 'loading' ? <button role="menuitem" className="rewrite-entry" onClick={() => { onApplyDraft(activeDraft, currentDocumentEmpty ? 'replace' : 'append', rewriteMenu.paragraphTargets.map((item) => item.paragraphId), sourceAnnotations); setRewriteMenu(null) }}><Check size={15} /><span><b>{currentDocumentEmpty ? '以所选内容建立当前文案' : '追加到当前文案'}</b><small>只有明确执行后才写入当前文案</small></span></button> : null}
    </SelectionActionMenu> : null}
    {rewriteMenu?.view === 'rewrite' ? <RewriteRequestPanel
      anchor={rewriteMenu.anchor}
      anchorPoint={rewriteMenu.anchorPoint}
      selectionLabel={rewriteMenu.selectedText || rewriteMenu.paragraphTargets.map((item) => item.text).join('\n\n')}
      projectId={workspace.projectId}
      sessionScope={`script-material:${workspace.projectId}:${workspace.activeRevision?.id ?? 'working'}`}
      models={codexModels}
      initialModel={preferredCodexModel}
      initialReasoningEffort="xhigh"
      busy={busy}
      onBack={() => setRewriteMenu({ ...rewriteMenu, view: 'menu' })}
      onDismiss={() => setRewriteMenu(null)}
      onSubmit={(request) => void submitParagraphRewrite(request)}
    /> : null}
    {annotationMenu ? <TextAnnotationMenu
      anchor={annotationMenu.anchor}
      anchorPoint={annotationMenu.anchorPoint}
      note={annotationNote}
      onNoteChange={setAnnotationNote}
      onApply={(style, note) => void saveSourceAnnotation(style, note)}
      onClear={() => void clearSourceAnnotations()}
      onDismiss={() => { setAnnotationMenu(null); setAnnotationNote('') }}
    /> : null}
    <RewriteCandidateDialog
      candidate={rewriteMenu?.view === 'candidate' && rewriteCandidateReady ? {
        id: rewriteCandidateReady.id,
        originalText: rewriteMenu.selectedText || rewriteMenu.paragraphTargets.map((item) => item.text).join('\n\n'),
        candidateText: rewriteCandidateReady.content,
        providerLabel: rewriteCandidateReady.provider === 'claude_cli' ? 'Claude' : 'Codex',
        requestedModel: preferredCodexModel,
        actualModel: rewriteCandidateReady.model,
        actualReasoningEffort: rewriteCandidateReady.reasoningEffort,
        generationRound: (() => {
          const byId = new Map(workspace.rewriteCandidates.map((candidate) => [candidate.id, candidate]))
          let round = 1
          let cursor = rewriteCandidateReady
          const visited = new Set<string>()
          while (cursor.parentCandidateId && !visited.has(cursor.id)) {
            visited.add(cursor.id)
            const parent = byId.get(cursor.parentCandidateId)
            if (!parent) break
            round += 1
            cursor = parent
          }
          return round
        })(),
        sourceSelections: rewriteCandidateReady.sourceSelections,
        conflicts: rewriteCandidateReady.conflicts,
        targetChanged: rewriteCandidateTargetChanged(rewriteCandidateReady),
        replaceUnavailableReason: !rewriteCandidateReady.applicationTarget || rewriteCandidateReady.selectedText || rewriteCandidateReady.paragraphIds.length !== 1
          ? '这个候选没有当前文案中的唯一对应位置；可以追加，替换需先在当前文案重新选定目标。'
          : undefined
      } : null}
      onClose={() => setRewriteMenu(null)}
      onContinue={() => rewriteMenu && rewriteCandidateReady && setRewriteMenu({ ...rewriteMenu, view: 'rewrite', taskId: null, candidateId: rewriteCandidateReady.id })}
      onAppend={() => { if (rewriteCandidateReady) onApplyRewriteCandidate(rewriteCandidateReady, 'append'); setRewriteMenu(null) }}
      onReplace={() => { if (rewriteCandidateReady) onApplyRewriteCandidate(rewriteCandidateReady, 'replace'); setRewriteMenu(null) }}
    />
  </div>
}
