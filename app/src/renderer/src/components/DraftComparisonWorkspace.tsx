import { AppSelect } from './AppSelect'
import { AlertTriangle, Check, Combine, Eye, FileText, Flag, GitCompareArrows, GripVertical, History, Layers3, Link2, Link2Off, MessageSquarePlus, MoveRight, Palette, Redo2, RefreshCw, RotateCcw, Scissors, Sparkles, StickyNote, Trash2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  BUILTIN_TEXT_PROVIDER_CONFIG_IDS,
  canonicalDraftGroupDecisionFingerprintInput,
  type CodexWritingModelOption,
  type ContentFactAnnotation,
  type DraftAlignmentGroup,
  type DraftCandidateRevision,
  type DraftComparisonColorMode,
  type DraftComparisonDocumentMode,
  type DraftComparisonHistoryEntry,
  type DraftComparisonSide,
  type DraftComparisonSplitScope,
  type DraftComparisonSplitStrategy,
  type DraftComparisonWorkspace as DraftComparisonWorkspaceRecord,
  type DraftGroupDecisionKind,
  type DraftWorkingSource,
  type ProviderCapability,
  type ProviderSettings,
  type ScriptTextAnnotation,
  type TaskRun
} from '../../../shared/domain'
import { locateUniqueRawSelection } from '../../../shared/text-selection'
import { ReadableMarkdown } from './ReadableMarkdown'
import { RewriteRequestPanel } from '../features/script/selection/RewriteRequestPanel'
import { RewriteCandidateDialog } from '../features/script/selection/RewriteCandidateDialog'
import { SelectionActionMenu } from '../features/script/selection/SelectionActionMenu'
import { TextAnnotationMenu } from '../features/script/selection/TextAnnotationMenu'
import type { RewriteRequest } from '../features/script/selection/selection-contract'

const groupColors = [
  'comparison-color-1', 'comparison-color-2', 'comparison-color-3', 'comparison-color-4',
  'comparison-color-5', 'comparison-color-6', 'comparison-color-7', 'comparison-color-8',
  'comparison-color-9', 'comparison-color-10', 'comparison-color-11', 'comparison-color-12'
]

async function sha256Text(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sourceManualMarks(annotations: ScriptTextAnnotation[], sourceId: string, blockId: string) {
  return annotations
    .filter((annotation) => annotation.sourceId === sourceId && annotation.blockId === blockId)
    .map((annotation) => ({ start: annotation.blockStart, end: annotation.blockEnd, style: annotation.style, note: annotation.note, status: annotation.status }))
}

function readableFactAnnotations(annotations: ContentFactAnnotation[]) {
  return annotations.map((annotation) => ({
    start: annotation.start,
    end: annotation.end,
    provenance: annotation.provenance,
    label: `${annotation.provenance === 'needs_confirmation' ? '需要你补充' : annotation.provenance === 'web_supplement' ? '联网核验' : 'AI补写'}：${annotation.note}`
  }))
}

function CandidateFactEvidence({ annotations }: { annotations: ContentFactAnnotation[] }): React.JSX.Element | null {
  const sources = [...new Map(annotations.flatMap((annotation) => annotation.webSources).map((source) => [source.url, source])).values()]
  if (!sources.length) return null
  return <div className="content-fact-sources" aria-label="联网事实来源">{sources.map((source) => <button
    type="button"
    key={source.url}
    title={source.url}
    onClick={() => void window.creatorOS?.openExternalLink(source.url)}
  >{source.title}</button>)}</div>
}

interface ProviderOption {
  id: string
  label: string
  model: string | null
}

interface ComparisonContextMenu {
  x: number
  y: number
  groupId: string
  sourceId: string
  sourceKind: 'claude' | 'codex' | 'candidate'
  paragraphId?: string
  selectedText?: string
  selectionStart?: number
  selectionEnd?: number
}

interface PreviewContextMenu {
  x: number
  y: number
  groupId: string
  selectedText?: string
  selectionStart?: number
  selectionEnd?: number
}

interface RewriteMenuState {
  groupId: string
  parentCandidateId: string | null
  x: number
  y: number
  requirement: string
  selectedText?: string
  selectionStart?: number
  selectionEnd?: number
  sourceKind?: 'claude' | 'codex' | 'candidate' | 'current'
  sourceId?: string
}

interface FusionSelection {
  id: string
  groupId: string
  sourceKind: 'claude' | 'codex' | 'candidate' | 'current'
  sourceId?: string
  sourceLabel: string
  selectedText: string
  selectionStart: number
  selectionEnd: number
}

function fusionSelectionSourceKey(selection: Pick<FusionSelection, 'sourceKind' | 'sourceId'>): string {
  return `${selection.sourceKind}:${selection.sourceId ?? selection.sourceKind}`
}

interface CandidateHistoryStack {
  id: string
  candidates: DraftCandidateRevision[]
}

function candidateHistoryStacks(candidates: DraftCandidateRevision[]): CandidateHistoryStack[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const rootOf = (candidate: DraftCandidateRevision): string => {
    let current = candidate
    const visited = new Set<string>()
    while (current.parentCandidateId && !visited.has(current.id)) {
      visited.add(current.id)
      const parent = byId.get(current.parentCandidateId)
      if (!parent) break
      current = parent
    }
    return current.id
  }
  const stacks = new Map<string, DraftCandidateRevision[]>()
  candidates.forEach((candidate) => {
    const rootId = rootOf(candidate)
    stacks.set(rootId, [...(stacks.get(rootId) ?? []), candidate])
  })
  return Array.from(stacks.entries())
    .map(([id, items]) => ({ id, candidates: items.sort((left, right) => left.revisionRound - right.revisionRound || left.position - right.position) }))
    .sort((left, right) => (left.candidates[0]?.position ?? 0) - (right.candidates[0]?.position ?? 0))
}

function groupStatus(group: DraftAlignmentGroup): string {
  if (group.manuallyAdjusted) return '已人工调整'
  if (group.matchType === 'claude_only') return '仅Claude有'
  if (group.matchType === 'codex_only') return '仅Codex有'
  if (group.matchType === 'needs_review') return '需确认'
  return '已对齐'
}

function sourceContent(group: DraftAlignmentGroup, sourceId: string): string {
  if (sourceId === 'claude') return group.claudeParagraphs.map((paragraph) => paragraph.text).join('\n\n')
  if (sourceId === 'codex') return group.codexParagraphs.map((paragraph) => paragraph.text).join('\n\n')
  return group.candidates.find((candidate) => candidate.id === sourceId)?.content ?? ''
}

function rawBoundaryOffset(node: Node, offset: number, end: boolean): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const marker = node.parentElement?.closest<HTMLElement>('[data-raw-start][data-raw-end]')
    if (!marker) return null
    const start = Number(marker.dataset.rawStart)
    return Number.isSafeInteger(start) ? start + offset : null
  }
  if (!(node instanceof HTMLElement)) return null
  const ownStart = Number(node.dataset.rawStart)
  const ownEnd = Number(node.dataset.rawEnd)
  if (Number.isSafeInteger(ownStart) && Number.isSafeInteger(ownEnd)) return end && offset > 0 ? ownEnd : ownStart
  const childIndex = end ? Math.max(0, Math.min(offset - 1, node.childNodes.length - 1)) : Math.min(offset, node.childNodes.length - 1)
  const child = node.childNodes[childIndex]
  if (!child) return null
  const markers = child instanceof HTMLElement
    ? Array.from(child.querySelectorAll<HTMLElement>('[data-raw-start][data-raw-end]'))
    : []
  const marker = child instanceof HTMLElement && child.matches('[data-raw-start][data-raw-end]')
    ? child
    : end ? markers.at(-1) : markers[0]
  if (!marker) return rawBoundaryOffset(child, end ? child.textContent?.length ?? 0 : 0, end)
  const value = Number(end ? marker.dataset.rawEnd : marker.dataset.rawStart)
  return Number.isSafeInteger(value) ? value : null
}

function selectionRangeWithin(root: HTMLElement, selection: Selection | null): { text: string; start: number; end: number; rawStart: number | null; rawEnd: number | null } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const text = range.toString()
  if (!text.trim()) return null
  const start = prefix.toString().length
  return {
    text,
    start,
    end: start + text.length,
    rawStart: rawBoundaryOffset(range.startContainer, range.startOffset, false),
    rawEnd: rawBoundaryOffset(range.endContainer, range.endOffset, true)
  }
}

function clampFloatingPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8))
  }
}

function placeContextSubmenu(details: HTMLDetailsElement): void {
  if (!details.open) return
  const submenu = details.querySelector<HTMLElement>(':scope > div')
  if (!submenu) return
  const anchor = details.getBoundingClientRect()
  const submenuWidth = Math.max(112, submenu.scrollWidth)
  const submenuHeight = Math.min(240, Math.max(29, submenu.scrollHeight))
  const left = anchor.right + 6 + submenuWidth <= window.innerWidth - 8
    ? anchor.right + 6
    : Math.max(8, anchor.left - submenuWidth - 6)
  Object.assign(submenu.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${Math.max(8, Math.min(anchor.top, window.innerHeight - submenuHeight - 8))}px`
  })
}

function navigateComparisonContextMenu(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':scope > button:not([disabled]), :scope > details > summary'))
  if (!controls.length) return
  event.preventDefault()
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const targetIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? controls.length - 1
      : event.key === 'ArrowDown' ? (index + 1 + controls.length) % controls.length
        : (index - 1 + controls.length) % controls.length
  controls[targetIndex]?.focus()
}

function latestTask(tasks: TaskRun[], predicate: (task: TaskRun) => boolean): TaskRun | null {
  return tasks.filter(predicate).sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0] ?? null
}

function providerName(candidate: DraftCandidateRevision, options: ProviderOption[]): string {
  if (candidate.sourceKind === 'freeform') return '手动候选'
  if (candidate.provider === 'claude_cli') return 'Claude候选'
  if (candidate.provider === 'codex_cli') return 'Codex候选'
  return `${options.find((option) => option.id === candidate.providerConfigId)?.label ?? '外部AI'}候选`
}

function sourceLabel(source: DraftWorkingSource, options: ProviderOption[]): string {
  if (source.sourceKind === 'freeform') return '自由稿'
  const provider = options.find((option) => option.id === source.providerConfigId)?.label
    ?? (source.provider === 'claude_cli' ? 'Claude' : source.provider === 'codex_cli' ? 'Codex' : '外部AI')
  return `${provider}生成${source.model ? ` · ${source.model}` : ''}`
}

export type DraftComparisonCurrentDocumentApplyResult =
  | { status: 'applied'; fingerprint: string; baselinePersisted: Promise<boolean> }
  | { status: 'confirmation_required' }
  | { status: 'stale' }

export interface DraftComparisonSourceAnnotationProjection {
  annotation: ScriptTextAnnotation
  sourceBlockText: string
}

export function DraftComparisonWorkspace({
  workspace,
  visible,
  currentDocumentContent,
  currentDocumentFingerprint,
  currentDocumentSnapshotFingerprint,
  currentDocumentRevision,
  currentDocumentContentHash,
  capabilities,
  providerSettings,
  tasks,
  pendingRewrites,
  onPendingRewritesChange: setPendingRewrites,
  operationHistory,
  mobileSide,
  showMobileTabs = true,
  mobilePanelId,
  mobilePanelLabelledBy,
  sourceSplit,
  previewSplit,
  scrollTop,
  includeProjectContext,
  colorMode,
  documentMode,
  splitScope,
  useOutline,
  codexModels,
  preferredCodexModel,
  loading,
  onSaveDrafts,
  onGenerateSource,
  onStartAlignment,
  onGenerateCandidate,
  onDeleteCandidate,
  onSetDecision,
  onMergeGroups,
  onSplitSelection,
  onMoveParagraph,
  onMoveParagraphs,
  onMoveCandidate,
  onReorderCandidates,
  onReorderGroups,
  onSetGroupNote,
  onSetGroupMarkers,
  onApply: commitCurrentDocument,
  onAdoptCurrentDocument,
  onUndo,
  canUndo,
  onSelectSession,
  onRetryTask,
  onRestoreHistory,
  onMobileSideChange,
  onSourceSplitChange,
  onPreviewSplitChange,
  onIncludeProjectContextChange,
  onColorModeChange,
  onDocumentModeChange,
  onSplitScopeChange,
  onUseOutlineChange,
  onScrollTopChange,
  onNotice
}: {
  workspace: DraftComparisonWorkspaceRecord
  visible: boolean
  currentDocumentContent: string
  currentDocumentFingerprint: string
  currentDocumentSnapshotFingerprint: string | null
  currentDocumentRevision: number | null
  currentDocumentContentHash: string | null
  capabilities: ProviderCapability[]
  providerSettings: ProviderSettings | null
  tasks: TaskRun[]
  pendingRewrites: Record<string, { groupId: string }>
  onPendingRewritesChange: Dispatch<SetStateAction<Record<string, { groupId: string }>>>
  operationHistory: DraftComparisonHistoryEntry[]
  mobileSide: DraftComparisonSide
  showMobileTabs?: boolean
  mobilePanelId?: string
  mobilePanelLabelledBy?: string
  sourceSplit: number
  previewSplit: number
  scrollTop: number
  includeProjectContext: boolean
  colorMode: DraftComparisonColorMode
  documentMode: DraftComparisonDocumentMode
  splitScope: DraftComparisonSplitScope
  useOutline: boolean
  codexModels: CodexWritingModelOption[]
  preferredCodexModel: string | null
  loading: boolean
  onSaveDrafts(patch: { claudeContent?: string; codexContent?: string }): Promise<void>
  onGenerateSource(input: { side: DraftComparisonSide; requirement: string; providerConfigId: string }): Promise<void>
  onStartAlignment(providerConfigId: string, confirmFull?: boolean): Promise<void>
  onGenerateCandidate(input: { groupId: string; parentCandidateId?: string | null; requirement?: string; quickIntent?: 'regenerate' | 'polish' | 'concise' | 'humorous' | 'expand' | 'conversational'; providerConfigId: string; preferredModel?: string | null; preferredReasoningEffort?: string | null; structuredInstruction?: RewriteRequest['structuredInstruction']; selectedText?: string; selectionStart?: number; selectionEnd?: number; sourceKind?: 'claude' | 'codex' | 'candidate' | 'current'; sourceId?: string; sourceSelections?: Array<{ sourceKind: 'claude' | 'codex' | 'candidate' | 'current'; sourceId?: string | null; selectedText: string; selectionStart: number; selectionEnd: number }> }): Promise<TaskRun>
  onDeleteCandidate(candidateId: string): Promise<void>
  onSetDecision(input: { groupId: string; kind: DraftGroupDecisionKind; sourceId?: string | null; sourceIds?: string[]; content?: string }): Promise<void>
  onMergeGroups(groupIds: string[]): Promise<void>
  onSplitSelection(input: { groupId: string; side: DraftComparisonSide; paragraphIds: string[]; strategy: DraftComparisonSplitStrategy }): Promise<void>
  onMoveParagraph(input: { side: DraftComparisonSide; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }): Promise<void>
  onMoveParagraphs(moves: Array<{ side: DraftComparisonSide; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }>): Promise<void>
  onMoveCandidate(candidateId: string, toGroupId: string): Promise<void>
  onReorderCandidates(groupId: string, candidateIds: string[]): Promise<void>
  onReorderGroups(groupIds: string[]): Promise<void>
  onSetGroupNote(groupId: string, note: string): Promise<void>
  onSetGroupMarkers(groupId: string, markers: NonNullable<DraftAlignmentGroup['decision']>['markers']): Promise<void>
  onApply(content: string, expectedCurrentFingerprint: string, allowStructuralReplacement?: boolean, sourceAnnotations?: DraftComparisonSourceAnnotationProjection[]): DraftComparisonCurrentDocumentApplyResult
  onAdoptCurrentDocument(expectedCurrentFingerprint: string): Promise<boolean>
  onUndo(): void
  canUndo: boolean
  onSelectSession(sessionId?: string | null): Promise<void>
  onRetryTask(taskId: string): Promise<TaskRun>
  onRestoreHistory(historyId: string): Promise<void>
  onMobileSideChange(side: DraftComparisonSide): void
  onSourceSplitChange(value: number): void
  onPreviewSplitChange(value: number): void
  onIncludeProjectContextChange(value: boolean): void
  onColorModeChange(value: DraftComparisonColorMode): void
  onDocumentModeChange(value: DraftComparisonDocumentMode): void
  onSplitScopeChange(value: DraftComparisonSplitScope): void
  onUseOutlineChange(value: boolean): void
  onScrollTopChange(value: number): void
  onNotice(message: string): void
}): React.JSX.Element {
  const [claudeContent, setClaudeContent] = useState(workspace.claudeContent)
  const [codexContent, setCodexContent] = useState(workspace.codexContent)
  const [claudeDirty, setClaudeDirty] = useState(false)
  const [codexDirty, setCodexDirty] = useState(false)
  const [providerConfigId, setProviderConfigId] = useState<string>(BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex)
  const [sourceRequirements, setSourceRequirements] = useState<Record<DraftComparisonSide, string>>({
    claude: '根据当前内容生成或完善一份完整文案',
    codex: '根据当前内容生成或完善一份完整文案'
  })
  const [editingSources, setEditingSources] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [activeGroupId, setActiveGroupId] = useState<string | null>(workspace.activeSession?.groups[0]?.id ?? null)
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null)
  const [candidateHistoryIndexes, setCandidateHistoryIndexes] = useState<Record<string, number>>({})
  const [deleteConfirmCandidateId, setDeleteConfirmCandidateId] = useState<string | null>(null)
  const [comparisonCandidateIds, setComparisonCandidateIds] = useState<Set<string>>(new Set())
  const [movePairedContent, setMovePairedContent] = useState(true)
  const [contextMenu, setContextMenu] = useState<ComparisonContextMenu | null>(null)
  const [previewContextMenu, setPreviewContextMenu] = useState<PreviewContextMenu | null>(null)
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupId: string; side?: DraftComparisonSide } | null>(null)
  const [paragraphSelection, setParagraphSelection] = useState<{ groupId: string; side: DraftComparisonSide; ids: Set<string>; anchorId: string } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyCursorId, setHistoryCursorId] = useState<string | null>(null)
  const [historyRedoIds, setHistoryRedoIds] = useState<string[]>([])
  const [rewriteMenu, setRewriteMenu] = useState<RewriteMenuState | null>(null)
  const [noteComposer, setNoteComposer] = useState<{ groupId: string; x: number; y: number; note: string } | null>(null)
  const [markerComposer, setMarkerComposer] = useState<{ groupId: string; x: number; y: number; start: number; end: number; text: string; note: string } | null>(null)
  const [markerListGroupId, setMarkerListGroupId] = useState<string | null>(null)
  const [sourceReplacementPrompt, setSourceReplacementPrompt] = useState<{ groupId: string; sourceId: string; insertIndex?: number } | null>(null)
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, string>>({})
  const [previewOrder, setPreviewOrder] = useState<string[]>([])
  const [cleanContent, setCleanContent] = useState('')
  const [cleanDirty, setCleanDirty] = useState(false)
  const [draggingPreviewGroupId, setDraggingPreviewGroupId] = useState<string | null>(null)
  const [draggingCandidateId, setDraggingCandidateId] = useState<string | null>(null)
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [previewDropIndex, setPreviewDropIndex] = useState<number | null>(null)
  const [lastDeleted, setLastDeleted] = useState<{ groupId: string; content: string } | null>(null)
  const [currentDocumentDiverged, setCurrentDocumentDiverged] = useState(false)
  const [documentSyncPrompt, setDocumentSyncPrompt] = useState<{
    content: string
    currentFingerprint: string
    reason: 'current_changed' | 'structured_replacement'
    sourceAnnotations: DraftComparisonSourceAnnotationProjection[]
  } | null>(null)
  const [fullRebuildPrompt, setFullRebuildPrompt] = useState<{ providerConfigId: string; percent: number; manualConflictCount?: number } | null>(null)
  const [liveSourceSplit, setLiveSourceSplit] = useState(sourceSplit)
  const [livePreviewSplit, setLivePreviewSplit] = useState(previewSplit)
  const [busy, setBusy] = useState(false)
  const [fusionSelections, setFusionSelections] = useState<FusionSelection[]>([])
  const [fusionRequestOpen, setFusionRequestOpen] = useState(false)
  const [sourceAnnotations, setSourceAnnotations] = useState<ScriptTextAnnotation[]>([])
  const [sourceAnnotationMenu, setSourceAnnotationMenu] = useState<(ComparisonContextMenu & { note: string }) | null>(null)
  const [rewriteTargetChanged, setRewriteTargetChanged] = useState(false)
  const [historyResetToken, setHistoryResetToken] = useState(0)
  const projectRef = useRef(workspace.projectId)
  const workspaceRef = useRef<HTMLElement>(null)
  const sourceGridRef = useRef<HTMLDivElement>(null)
  const sourceDraggingRef = useRef(false)
  const previewDraggingRef = useRef(false)
  const groupListRef = useRef<HTMLDivElement>(null)
  const rewriteReturnFocusRef = useRef<HTMLElement | null>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingScrollTopRef = useRef<number | null>(null)
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  const visibleRef = useRef(visible)
  const currentDocumentContentRef = useRef(currentDocumentContent)
  const currentDocumentFingerprintRef = useRef(currentDocumentFingerprint)
  const currentDocumentBaseFingerprintRef = useRef(currentDocumentFingerprint)
  const currentDocumentDivergedRef = useRef(false)
  const persistedBaseCheckRef = useRef('')
  const localBaselinePendingRef = useRef(false)
  const documentSyncReturnFocusRef = useRef<HTMLElement | null>(null)
  const session = workspace.activeSession
  const groups = useMemo(() => session?.groups ?? [], [session?.groups])
  const latestSessionId = workspace.sessionHistory[0]?.id ?? null
  const historical = Boolean(session && latestSessionId && session.id !== latestSessionId)
  const sourceChangedSinceSnapshot = Boolean(session && (
    workspace.claudeContent.trim() !== session.claudeSnapshot.content.trim()
    || workspace.codexContent.trim() !== session.codexSnapshot.content.trim()
  ))

  useEffect(() => {
    if (!contextMenu || contextMenu.selectedText) return
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-comparison-context-root="true"] > button:not([disabled]), [data-comparison-context-root="true"] > details > summary')?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [contextMenu])

  const setDocumentDiverged = (value: boolean): void => {
    currentDocumentDivergedRef.current = value
    setCurrentDocumentDiverged(value)
  }
  const markDocumentDiverged = (message?: string): void => {
    setDocumentDiverged(true)
    setCleanContent(currentDocumentContentRef.current)
    setCleanDirty(false)
    if (message) onNotice(message)
  }
  const sourceAnnotationProjections = useMemo<DraftComparisonSourceAnnotationProjection[]>(() => {
    if (!session) return []
    return sourceAnnotations.flatMap((annotation) => {
      let sourceBlockText = ''
      if (annotation.sourceKind === 'comparison_source') {
        const source = annotation.sourceId === session.claudeSnapshot.id
          ? session.claudeSnapshot
          : annotation.sourceId === session.codexSnapshot.id ? session.codexSnapshot : null
        if (!source || annotation.sourceVersion !== source.contentHash) return []
        sourceBlockText = groups.flatMap((group) => annotation.sourceId === session.claudeSnapshot.id
          ? group.claudeParagraphs
          : group.codexParagraphs).find((paragraph) => paragraph.id === annotation.blockId)?.text ?? ''
      } else if (annotation.sourceKind === 'comparison_candidate') {
        const candidate = groups.flatMap((group) => group.candidates).find((item) => item.id === annotation.sourceId)
        if (!candidate || annotation.sourceVersion !== candidate.contentHash || annotation.blockId !== candidate.id) return []
        sourceBlockText = candidate.content
      } else return []
      if (
        !sourceBlockText
        || annotation.blockStart < 0
        || annotation.blockEnd > sourceBlockText.length
        || sourceBlockText.slice(annotation.blockStart, annotation.blockEnd) !== annotation.selectedText
      ) return []
      return [{ annotation, sourceBlockText }]
    })
  }, [groups, session, sourceAnnotations])
  const requestDocumentSync = (content: string, reason: 'current_changed' | 'structured_replacement'): void => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && !activeElement.closest('.comparison-document-sync-dialog')) {
      documentSyncReturnFocusRef.current = activeElement
    }
    setDocumentSyncPrompt({ content, currentFingerprint: currentDocumentFingerprintRef.current, reason, sourceAnnotations: sourceAnnotationProjections })
  }
  const restoreDocumentSyncFocus = (): void => {
    const target = documentSyncReturnFocusRef.current
    documentSyncReturnFocusRef.current = null
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
      else workspaceRef.current?.focus()
    })
  }
  const trackAppliedDocument = (result: Extract<DraftComparisonCurrentDocumentApplyResult, { status: 'applied' }>): void => {
    currentDocumentBaseFingerprintRef.current = result.fingerprint
    localBaselinePendingRef.current = true
    void result.baselinePersisted.then((persisted) => {
      if (currentDocumentBaseFingerprintRef.current !== result.fingerprint) return
      localBaselinePendingRef.current = false
      if (!persisted) markDocumentDiverged('当前文案在建立整理基线时又有变化；本次整理状态已保留，同步前需要重新确认。')
    }).catch((reason) => {
      if (currentDocumentBaseFingerprintRef.current !== result.fingerprint) return
      localBaselinePendingRef.current = false
      markDocumentDiverged(reason instanceof Error ? reason.message : '对照整理基线保存失败；同步前需要重新确认。')
    })
  }
  const commitOrganizedContent = (
    content: string,
    allowStructuralReplacement = false,
    annotationProjections = sourceAnnotationProjections
  ): DraftComparisonCurrentDocumentApplyResult => {
    const result = commitCurrentDocument(content, currentDocumentFingerprintRef.current, allowStructuralReplacement, annotationProjections)
    if (result.status === 'applied') trackAppliedDocument(result)
    else if (result.status === 'stale') markDocumentDiverged('当前文案又有新变化；整理结果已保留，没有覆盖最新内容。')
    return result
  }
  const applyOrganizedContent = (content: string): void => {
    if (!visibleRef.current) {
      if (currentDocumentFingerprintRef.current === currentDocumentBaseFingerprintRef.current) {
        const result = commitOrganizedContent(content)
        if (result.status === 'confirmation_required') markDocumentDiverged('已保留对照整理结果；它会影响当前文案的格式、标记或来源关系，请回到对照整理后明确确认。')
        return
      }
      markDocumentDiverged('已保留对照整理结果；当前文案正在其他页面编辑，没有在后台覆盖。')
      return
    }
    if (currentDocumentDivergedRef.current) {
      requestDocumentSync(content, 'current_changed')
      return
    }
    const result = commitOrganizedContent(content)
    if (result.status === 'confirmation_required') {
      requestDocumentSync(content, 'structured_replacement')
    }
  }
  const applyCleanContent = (content: string, annotationProjections = sourceAnnotationProjections): void => {
    if (!visibleRef.current) {
      markDocumentDiverged('已保留整理结果；当前文案正在其他页面编辑，没有在后台覆盖。')
      return
    }
    const result = commitOrganizedContent(content, true, annotationProjections)
    if (result.status === 'applied') {
      setDocumentDiverged(false)
      setDocumentSyncPrompt(null)
      restoreDocumentSyncFocus()
    }
  }
  const onApply = applyOrganizedContent

  useLayoutEffect(() => {
    currentDocumentContentRef.current = currentDocumentContent
  }, [currentDocumentContent])
  useLayoutEffect(() => {
    currentDocumentFingerprintRef.current = currentDocumentFingerprint
    if (
      !visibleRef.current
      && currentDocumentFingerprint !== currentDocumentBaseFingerprintRef.current
    ) markDocumentDiverged()
  }, [currentDocumentFingerprint]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const wasVisible = visibleRef.current
    visibleRef.current = visible
    if (wasVisible && !visible) {
      if (documentSyncPrompt) markDocumentDiverged()
      currentDocumentBaseFingerprintRef.current = currentDocumentFingerprintRef.current
      setDocumentSyncPrompt(null)
      return
    }
    if (!wasVisible && visible && currentDocumentFingerprintRef.current !== currentDocumentBaseFingerprintRef.current) {
      markDocumentDiverged('当前文案已在其他页面更新；对照整理状态仍保留，同步前会让你明确选择。')
    }
  }, [documentSyncPrompt, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const availableProviders = useMemo<ProviderOption[]>(() => {
    const builtins = [
      {
        id: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
        label: 'Codex',
        model: null,
        available: Boolean(capabilities.find((item) => item.provider === 'codex_cli')?.available)
      },
      {
        id: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
        label: 'Claude',
        model: null,
        available: Boolean(capabilities.find((item) => item.provider === 'claude_cli')?.available)
      }
    ].filter((item) => item.available).map((item) => ({ id: item.id, label: item.label, model: item.model }))
    const external = (providerSettings?.configs ?? [])
      .filter((config) => config.status === 'available')
      .map((config) => ({ id: config.id, label: config.displayName, model: config.model }))
    return [...builtins, ...external]
  }, [capabilities, providerSettings])
  const codexReasoningAvailable = Boolean(capabilities.find((item) => item.provider === 'codex_cli')?.available)

  useEffect(() => {
    if (projectRef.current !== workspace.projectId) {
      projectRef.current = workspace.projectId
      setClaudeContent(workspace.claudeContent)
      setCodexContent(workspace.codexContent)
      setClaudeDirty(false)
      setCodexDirty(false)
      setEditingSources(false)
      setComparisonCandidateIds(new Set())
      setCandidateHistoryIndexes({})
      setDeleteConfirmCandidateId(null)
      setContextMenu(null)
      setPreviewContextMenu(null)
      setGroupContextMenu(null)
      setParagraphSelection(null)
      setRewriteMenu(null)
      setNoteComposer(null)
      setMarkerComposer(null)
      setFusionSelections([])
      setFusionRequestOpen(false)
      setSourceAnnotationMenu(null)
      setPreviewOverrides({})
      setPreviewOrder([])
      setCleanContent('')
      setCleanDirty(false)
    } else {
      if (!claudeDirty) setClaudeContent(workspace.claudeContent)
      if (!codexDirty) setCodexContent(workspace.codexContent)
    }
    if (workspace.activeSession?.groups.length && !workspace.activeSession.groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(workspace.activeSession.groups[0]!.id)
    }
  }, [workspace, activeGroupId, claudeDirty, codexDirty])

  useEffect(() => {
    let active = true
    void window.creatorOS?.listSourceScriptAnnotations(workspace.projectId)
      .then((annotations) => { if (active) setSourceAnnotations(annotations) })
      .catch(() => { if (active) setSourceAnnotations([]) })
    return () => { active = false }
  }, [workspace.projectId, session?.id])
  useEffect(() => {
    if (!availableProviders.some((provider) => provider.id === providerConfigId) && availableProviders[0]) setProviderConfigId(availableProviders[0].id)
  }, [availableProviders, providerConfigId])

  useEffect(() => {
    const groupIds = [...groups].sort((left, right) => left.position - right.position).map((group) => group.id)
    setPreviewOrder((current) => {
      const retained = current.filter((id) => groupIds.includes(id))
      const missing = groupIds.filter((id) => !retained.includes(id))
      return [...retained, ...missing]
    })
    setPreviewOverrides((current) => {
      const next = { ...current }
      groups.forEach((group) => {
        if (next[group.id] === undefined) next[group.id] = group.decision?.content ?? ''
        else if (next[group.id] === '' && group.decision?.content) next[group.id] = group.decision.content
      })
      return next
    })
  }, [session?.id, groups])
  useEffect(() => {
    const terminalWithoutCandidate = Object.entries(pendingRewrites)
      .filter(([taskId, pending]) => {
        const candidateExists = groups.find((item) => item.id === pending.groupId)?.candidates.some((item) => item.taskId === taskId)
        const task = tasks.find((item) => item.id === taskId)
        return !candidateExists && Boolean(task && ['failed', 'canceled'].includes(task.status))
      })
      .map(([taskId]) => taskId)
    if (!terminalWithoutCandidate.length) return
    const timer = window.setTimeout(() => {
      setPendingRewrites((current) => Object.fromEntries(
        Object.entries(current).filter(([taskId]) => !terminalWithoutCandidate.includes(taskId))
      ))
    }, 1_000)
    return () => window.clearTimeout(timer)
  }, [groups, pendingRewrites, setPendingRewrites, tasks])
  useEffect(() => {
    if (!historyResetToken) return
    const orderedGroups = [...groups].sort((left, right) => left.position - right.position)
    setPreviewOrder(orderedGroups.map((group) => group.id))
    setPreviewOverrides(Object.fromEntries(orderedGroups.map((group) => [group.id, group.decision?.content ?? ''])))
    setCleanDirty(false)
    setLastDeleted(null)
    setHistoryResetToken(0)
  }, [historyResetToken, groups])
  const rewriteResults = useMemo(() => Object.entries(pendingRewrites).flatMap(([taskId, pending]) => {
    const candidate = groups.find((item) => item.id === pending.groupId)?.candidates.find((item) => item.taskId === taskId)
    return candidate ? [{ taskId, groupId: pending.groupId, candidate }] : []
  }), [groups, pendingRewrites])
  const rewriteResult = rewriteResults[0] ?? null
  const rewriteResultTargetHasChanged = useCallback(async (result = rewriteResult): Promise<boolean> => {
    if (!result || result.candidate.inputRelationChanged) return Boolean(result?.candidate.inputRelationChanged)
    if (result.candidate.sourceSelections.some((selection) => (
      selection.sourceKind === 'current_script'
      && (!currentDocumentContentHash || selection.sourceVersion !== currentDocumentContentHash)
    ))) return true
    if (!result.candidate.targetDecisionFingerprint) return false
    const group = groups.find((item) => item.id === result.groupId)
    if (!group) return true
    const effectiveContent = previewOverrides[group.id] ?? group.decision?.content ?? ''
    const fingerprint = await sha256Text(canonicalDraftGroupDecisionFingerprintInput(group.decision, effectiveContent))
    return fingerprint !== result.candidate.targetDecisionFingerprint
  }, [currentDocumentContentHash, groups, previewOverrides, rewriteResult])
  useEffect(() => {
    let active = true
    void rewriteResultTargetHasChanged().then((changed) => { if (active) setRewriteTargetChanged(changed) })
    return () => { active = false }
  }, [rewriteResultTargetHasChanged])
  const cleanContentFromGroups = useMemo(() => previewOrder
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is DraftAlignmentGroup => Boolean(group))
    .filter((group) => group.decision && !['omit', 'unresolved'].includes(group.decision.kind))
    .map((group) => previewOverrides[group.id] ?? group.decision?.content ?? '')
    .filter((content) => Boolean(content.trim()))
    .join('\n\n'), [groups, previewOrder, previewOverrides])
  useEffect(() => {
    if (!cleanDirty && !currentDocumentDiverged) setCleanContent(cleanContentFromGroups)
  }, [cleanContentFromGroups, cleanDirty, currentDocumentDiverged])
  useLayoutEffect(() => {
    if (!visible || !currentDocumentContentHash || !currentDocumentSnapshotFingerprint || currentDocumentRevision === null) return
    const checkKey = `${workspace.activeSession?.id ?? 'setup'}:${workspace.currentDocumentBaseRevision ?? 'legacy'}:${workspace.currentDocumentBaseContentHash ?? 'legacy'}:${currentDocumentRevision}:${currentDocumentContentHash}:${currentDocumentFingerprint}`
    if (persistedBaseCheckRef.current === checkKey) return
    persistedBaseCheckRef.current = checkKey
    if (
      workspace.currentDocumentBaseRevision === currentDocumentRevision
      && workspace.currentDocumentBaseContentHash === currentDocumentContentHash
      && currentDocumentFingerprintRef.current === currentDocumentSnapshotFingerprint
    ) {
      localBaselinePendingRef.current = false
      currentDocumentBaseFingerprintRef.current = currentDocumentFingerprintRef.current
      setDocumentDiverged(false)
      return
    }
    if (
      localBaselinePendingRef.current
      && currentDocumentFingerprintRef.current === currentDocumentBaseFingerprintRef.current
    ) return
    markDocumentDiverged(workspace.currentDocumentBaseContentHash
      ? '当前文案与上次对照整理的基线不同；任何覆盖都会先让你确认。'
      : '这份旧整理结果还没有建立当前文案基线；首次同步前需要你确认。')
  }, [cleanContentFromGroups, currentDocumentContentHash, currentDocumentFingerprint, currentDocumentRevision, currentDocumentSnapshotFingerprint, visible, workspace.activeSession?.id, workspace.currentDocumentBaseContentHash, workspace.currentDocumentBaseRevision]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sourceDraggingRef.current) setLiveSourceSplit(sourceSplit) }, [sourceSplit])
  useEffect(() => { if (!previewDraggingRef.current) setLivePreviewSplit(previewSplit) }, [previewSplit])
  useEffect(() => { onScrollTopChangeRef.current = onScrollTopChange }, [onScrollTopChange])
  useEffect(() => {
    const root = workspaceRef.current
    const list = groupListRef.current
    const target = root && root.scrollHeight > root.clientHeight + 2 ? root : list
    if (target && Math.abs(target.scrollTop - scrollTop) > 2) target.scrollTop = scrollTop
  }, [session?.id, scrollTop])
  useEffect(() => () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    if (pendingScrollTopRef.current !== null) onScrollTopChangeRef.current(pendingScrollTopRef.current)
  }, [])
  useEffect(() => {
    if (!paragraphSelection) return
    const clearSelection = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setParagraphSelection(null)
    }
    window.addEventListener('keydown', clearSelection)
    return () => window.removeEventListener('keydown', clearSelection)
  }, [paragraphSelection])
  useEffect(() => {
    if (!contextMenu && !previewContextMenu && !groupContextMenu && !rewriteMenu && !noteComposer && !markerComposer && !historyOpen) return
    const close = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.comparison-context-menu, .comparison-rewrite-popover, .comparison-note-popover, .comparison-marker-popover, .comparison-operation-history, .anchored-popover-layer')) return
      setContextMenu(null)
      setPreviewContextMenu(null)
      setGroupContextMenu(null)
      setRewriteMenu(null)
      setNoteComposer(null)
      setMarkerComposer(null)
      setHistoryOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (historyOpen) setHistoryOpen(false)
      else if (markerComposer) setMarkerComposer(null)
      else if (noteComposer) setNoteComposer(null)
      else if (rewriteMenu) {
        setRewriteMenu(null)
        window.setTimeout(() => rewriteReturnFocusRef.current?.focus(), 0)
      }
      else if (previewContextMenu) setPreviewContextMenu(null)
      else if (groupContextMenu) setGroupContextMenu(null)
      else if (mergeMode) { setMergeMode(false); setSelectedGroups(new Set()) }
      else setContextMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [contextMenu, previewContextMenu, groupContextMenu, rewriteMenu, noteComposer, markerComposer, mergeMode, historyOpen])

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await action() }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '操作失败') }
    finally { setBusy(false) }
  }
  const restoreOperationHistory = async (historyId: string, clearRedo = false): Promise<void> => {
    await onRestoreHistory(historyId)
    setHistoryResetToken((value) => value + 1)
    setHistoryCursorId(historyId)
    if (clearRedo) setHistoryRedoIds([])
    setHistoryOpen(false)
  }
  const undoOperationHistory = async (): Promise<void> => {
    if (historical || operationHistory.length < 2) return
    const currentIndex = Math.max(0, operationHistory.findIndex((entry) => entry.id === historyCursorId))
    const target = operationHistory[currentIndex + 1]
    if (!target) return
    const currentId = historyCursorId ?? operationHistory[0]?.id
    if (currentId) setHistoryRedoIds((current) => [...current, currentId])
    await restoreOperationHistory(target.id)
  }
  const redoOperationHistory = async (): Promise<void> => {
    if (historical || !historyRedoIds.length) return
    const targetId = historyRedoIds.at(-1)!
    setHistoryRedoIds((current) => current.slice(0, -1))
    await restoreOperationHistory(targetId)
  }
  useEffect(() => {
    const latest = operationHistory[0]
    if (!latest) {
      setHistoryCursorId(null)
      setHistoryRedoIds([])
      return
    }
    if (!historyCursorId || !operationHistory.some((entry) => entry.id === historyCursorId)) {
      setHistoryCursorId(latest.id)
      return
    }
    if (latest.id !== historyCursorId && !latest.label.startsWith('恢复到')) {
      setHistoryCursorId(latest.id)
      setHistoryRedoIds([])
    }
  }, [historyCursorId, operationHistory])
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (!visible || documentSyncPrompt || event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || historical) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.shiftKey) void run(redoOperationHistory)
      else void run(undoOperationHistory)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [documentSyncPrompt, historical, historyCursorId, historyRedoIds, operationHistory, visible]) // eslint-disable-line react-hooks/exhaustive-deps
  const requestAlignment = async (confirmFull = false): Promise<void> => {
    try {
      await saveDrafts()
      await onStartAlignment(BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, confirmFull)
      setEditingSources(false)
      setFullRebuildPrompt(null)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (message.includes('DRAFT_ALIGNMENT_UNCHANGED')) {
        onNotice('两份稿子和大纲都没有变化，无需重新生成对照')
        setEditingSources(false)
        return
      }
      if (message.includes('DRAFT_ALIGNMENT_FULL_REBUILD_CONFIRM_REQUIRED')) {
        const percent = Number(message.match(/DRAFT_ALIGNMENT_FULL_REBUILD_CONFIRM_REQUIRED:(\d+)/)?.[1] ?? 100)
        setFullRebuildPrompt({ providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, percent })
        return
      }
      if (message.includes('DRAFT_ALIGNMENT_MANUAL_CONFLICT_CONFIRM_REQUIRED')) {
        const manualConflictCount = Number(message.match(/DRAFT_ALIGNMENT_MANUAL_CONFLICT_CONFIRM_REQUIRED:(\d+)/)?.[1] ?? 1)
        setFullRebuildPrompt({ providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, percent: 100, manualConflictCount })
        return
      }
      throw reason
    }
  }

  const saveDrafts = async (): Promise<void> => {
    await onSaveDrafts({ claudeContent, codexContent })
    setClaudeDirty(false)
    setCodexDirty(false)
    onNotice('双稿已保存')
  }

  const sourceTaskFor = (side: DraftComparisonSide): TaskRun | null => latestTask(
    tasks,
    (task) => task.taskType === 'draft_source_generation' && task.outputTarget === `draft-source:${workspace.projectId}:${side}`
  )
  const resizeSourceColumns = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!sourceDraggingRef.current) return
    const rect = sourceGridRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    setLiveSourceSplit(Math.max(30, Math.min(70, (event.clientX - rect.left) / rect.width * 100)))
  }
  const resizePreviewColumn = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!previewDraggingRef.current) return
    const rect = workspaceRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    setLivePreviewSplit(Math.max(20, Math.min(45, (rect.right - event.clientX) / rect.width * 100)))
  }
  const rememberScroll = (value: number): void => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    pendingScrollTopRef.current = Math.max(0, Math.round(value))
    scrollTimerRef.current = setTimeout(() => {
      const pending = pendingScrollTopRef.current
      pendingScrollTopRef.current = null
      scrollTimerRef.current = null
      if (pending !== null) onScrollTopChangeRef.current(pending)
    }, 250)
  }
  const needsSourceReplacementConfirmation = (group: DraftAlignmentGroup, sourceId: string): boolean => (
    group.decision?.kind === 'freeform'
    && Boolean(group.decision.content.trim())
    && !group.decision.sourceIds.includes(sourceId)
  )
  const syncMarkersAfterContentChange = async (group: DraftAlignmentGroup, content: string): Promise<void> => {
    if (!group.decision?.markers.length) return
    const nextMarkers = group.decision.markers.map((marker) => {
      if (content.slice(marker.start, marker.end) === marker.text) return { ...marker, status: 'active' as const }
      const relocated = content.indexOf(marker.text)
      return relocated >= 0 && relocated === content.lastIndexOf(marker.text)
        ? { ...marker, start: relocated, end: relocated + marker.text.length, status: 'active' as const }
        : { ...marker, status: 'position_changed' as const }
    })
    if (JSON.stringify(nextMarkers) !== JSON.stringify(group.decision.markers)) await onSetGroupMarkers(group.id, nextMarkers)
  }
  const chooseSource = async (group: DraftAlignmentGroup, sourceId: string, partialText?: string, confirmed = false): Promise<void> => {
    if (partialText?.trim()) {
      const selection = partialText.trim()
      const existing = (previewOverrides[group.id] ?? group.decision?.content ?? '').trim()
      const content = existing && !existing.includes(selection) ? `${existing}\n\n${selection}` : existing || selection
      await onSetDecision({ groupId: group.id, kind: 'freeform', content })
      setPreviewOverrides((current) => ({ ...current, [group.id]: content }))
      onApply(buildPreviewContent(group.id, content))
      return
    }
    const currentIds = group.decision?.sourceIds ?? []
    if (
      !confirmed
      && needsSourceReplacementConfirmation(group, sourceId)
    ) {
      setSourceReplacementPrompt({ groupId: group.id, sourceId })
      return
    }
    // “确认替换”是明确的覆盖动作，不能把旧候选与新来源继续组合。
    // 普通点选仍保留多来源组合能力。
    const nextIds = confirmed
      ? [sourceId]
      : currentIds.includes(sourceId) ? currentIds.filter((id) => id !== sourceId) : [...currentIds, sourceId]
    if (!nextIds.length) {
      await onSetDecision({ groupId: group.id, kind: 'unresolved' })
      await syncMarkersAfterContentChange(group, '')
      setPreviewOverrides((current) => ({ ...current, [group.id]: '' }))
      onApply(buildPreviewContent(group.id, ''))
      return
    }
    if (nextIds.length === 1) {
      const only = nextIds[0]!
      const kind: DraftGroupDecisionKind = only === 'claude' ? 'claude' : only === 'codex' ? 'codex' : 'candidate'
      await onSetDecision({ groupId: group.id, kind, sourceId: only })
      const content = sourceContent(group, only)
      await syncMarkersAfterContentChange(group, content)
      setPreviewOverrides((current) => ({ ...current, [group.id]: content }))
      onApply(buildPreviewContent(group.id, content))
      return
    }
    const content = nextIds.map((id) => sourceContent(group, id)).filter(Boolean).join('\n\n')
    await onSetDecision({ groupId: group.id, kind: 'combination', sourceIds: nextIds, content })
    await syncMarkersAfterContentChange(group, content)
    setPreviewOverrides((current) => ({ ...current, [group.id]: content }))
    onApply(buildPreviewContent(group.id, content))
  }
  const markGap = async (group: DraftAlignmentGroup): Promise<void> => {
    await onSetDecision({ groupId: group.id, kind: 'unresolved' })
    await syncMarkersAfterContentChange(group, '')
    setPreviewOverrides((current) => ({ ...current, [group.id]: '' }))
    onApply(buildPreviewContent(group.id, ''))
  }
  const persistPreviewOverride = async (group: DraftAlignmentGroup): Promise<void> => {
    const content = previewOverrides[group.id] ?? group.decision?.content ?? ''
    if (!content.trim()) {
      await onSetDecision({ groupId: group.id, kind: 'unresolved' })
      onApply(buildPreviewContent(group.id, ''))
      return
    }
    await onSetDecision({ groupId: group.id, kind: 'freeform', content })
    await syncMarkersAfterContentChange(group, content)
    onApply(buildPreviewContent(group.id, content))
  }
  const persistCleanDocument = async (adoptUnchangedCurrent = false): Promise<void> => {
    const wasDiverged = currentDocumentDivergedRef.current
    const wasDirty = cleanDirty
    if (wasDiverged && !wasDirty && !adoptUnchangedCurrent) return
    const editableGroups = previewOrder
      .map((id) => groups.find((group) => group.id === id))
      .filter((group): group is DraftAlignmentGroup => Boolean(group))
      .filter((group) => group.decision && !['omit', 'unresolved'].includes(group.decision.kind))
    if (!editableGroups.length) return
    const normalized = cleanContent
    const parts = normalized.split('\n\n')
    const nextContents = parts.length === editableGroups.length
      ? parts
      : [normalized, ...editableGroups.slice(1).map(() => '')]
    if (nextContents.some((content) => content.length > 80_000)) {
      throw new Error('单个文案组不能超过80000字，请拆分后再保存')
    }
    if (parts.length === editableGroups.length) {
      for (let index = 0; index < editableGroups.length; index += 1) {
        await onSetDecision({ groupId: editableGroups[index]!.id, kind: parts[index]!.trim() ? 'freeform' : 'omit', content: parts[index] ?? '' })
        await syncMarkersAfterContentChange(editableGroups[index]!, parts[index] ?? '')
      }
      setPreviewOverrides((current) => Object.fromEntries([
        ...Object.entries(current),
        ...editableGroups.map((group, index) => [group.id, parts[index] ?? ''])
      ]))
    } else {
      await onSetDecision({ groupId: editableGroups[0]!.id, kind: normalized.trim() ? 'freeform' : 'omit', content: normalized })
      await syncMarkersAfterContentChange(editableGroups[0]!, normalized)
      for (const group of editableGroups.slice(1)) {
        await onSetDecision({ groupId: group.id, kind: 'omit' })
        await syncMarkersAfterContentChange(group, '')
      }
      setPreviewOverrides((current) => ({
        ...current,
        [editableGroups[0]!.id]: normalized,
        ...Object.fromEntries(editableGroups.slice(1).map((group) => [group.id, '']))
      }))
      if (parts.length !== editableGroups.length) onNotice('跨组边界已按人工调整原样保留，返回组模式可继续整理模块')
    }
    setCleanDirty(false)
    if (wasDiverged && !wasDirty) {
      const expectedFingerprint = currentDocumentFingerprintRef.current
      if (!await onAdoptCurrentDocument(expectedFingerprint)) {
        markDocumentDiverged('当前文案在建立整理基线时又有变化；请重新确认。')
        return
      }
      currentDocumentBaseFingerprintRef.current = expectedFingerprint
      localBaselinePendingRef.current = false
      setDocumentDiverged(false)
      setDocumentSyncPrompt(null)
      return
    }
    onApply(normalized)
  }
  const groupAtCleanOffset = (offset: number): { group: DraftAlignmentGroup; localOffset: number } | null => {
    let cursor = 0
    for (const groupId of previewOrder) {
      const group = groups.find((item) => item.id === groupId)
      if (!group || !group.decision || ['omit', 'unresolved'].includes(group.decision.kind)) continue
      const content = previewOverrides[group.id] ?? group.decision.content
      if (offset <= cursor + content.length) return { group, localOffset: Math.max(0, offset - cursor) }
      cursor += content.length + 2
    }
    const group = groups.find((item) => item.decision && !['omit', 'unresolved'].includes(item.decision.kind))
    return group ? { group, localOffset: Math.max(0, offset - cursor) } : null
  }
  const moveParagraphWithPair = async (input: { side: DraftComparisonSide; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }): Promise<void> => {
    if (!movePairedContent || input.fromGroupId === input.toGroupId) {
      await onMoveParagraph(input)
      return
    }
    const group = groups.find((item) => item.id === input.fromGroupId)
    if (!group) throw new Error('来源组已经变化，请刷新后重试')
    const opposite: DraftComparisonSide = input.side === 'claude' ? 'codex' : 'claude'
    const oppositeParagraphs = opposite === 'claude' ? group.claudeParagraphs : group.codexParagraphs
    await onMoveParagraphs([
      input,
      ...oppositeParagraphs.map((paragraph) => ({
        side: opposite,
        paragraphId: paragraph.id,
        fromGroupId: input.fromGroupId,
        toGroupId: input.toGroupId
      }))
    ])
  }
  const selectParagraph = (event: React.MouseEvent, groupId: string, side: DraftComparisonSide, paragraphId: string): void => {
    if (window.getSelection()?.toString().trim()) return
    const additive = event.metaKey || event.ctrlKey
    setParagraphSelection((current) => {
      if (event.shiftKey && current?.groupId === groupId && current.side === side) {
        const group = groups.find((item) => item.id === groupId)
        const paragraphs = side === 'claude' ? group?.claudeParagraphs ?? [] : group?.codexParagraphs ?? []
        const anchorIndex = paragraphs.findIndex((paragraph) => paragraph.id === current.anchorId)
        const targetIndex = paragraphs.findIndex((paragraph) => paragraph.id === paragraphId)
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
          return { groupId, side, ids: new Set(paragraphs.slice(start, end + 1).map((paragraph) => paragraph.id)), anchorId: current.anchorId }
        }
      }
      if (!additive || !current || current.groupId !== groupId || current.side !== side) {
        return { groupId, side, ids: new Set([paragraphId]), anchorId: paragraphId }
      }
      const ids = new Set(current.ids)
      if (ids.has(paragraphId)) ids.delete(paragraphId)
      else ids.add(paragraphId)
      return ids.size ? { groupId, side, ids, anchorId: paragraphId } : null
    })
  }
  const openSourceContextMenu = (event: React.MouseEvent, menu: Omit<ComparisonContextMenu, 'x' | 'y'>): void => {
    event.preventDefault()
    if (menu.paragraphId && menu.sourceKind !== 'candidate') {
      const sameSelection = paragraphSelection?.groupId === menu.groupId
        && paragraphSelection.side === menu.sourceKind
        && paragraphSelection.ids.has(menu.paragraphId)
      if (!sameSelection) setParagraphSelection({ groupId: menu.groupId, side: menu.sourceKind, ids: new Set([menu.paragraphId]), anchorId: menu.paragraphId })
    }
    const textRoot = event.currentTarget.querySelector<HTMLElement>(':scope > .readable-markdown, :scope > p')
    const selectedRange = textRoot ? selectionRangeWithin(textRoot, window.getSelection()) : null
    const group = groups.find((item) => item.id === menu.groupId)
    const paragraph = group && menu.paragraphId && menu.sourceKind !== 'candidate'
      ? (menu.sourceKind === 'claude' ? group.claudeParagraphs : group.codexParagraphs).find((item) => item.id === menu.paragraphId)
      : null
    const rawSource = menu.sourceKind === 'candidate'
      ? group?.candidates.find((candidate) => candidate.id === menu.sourceId)?.content
      : paragraph?.text
    const paragraphBase = group && menu.paragraphId && menu.sourceKind !== 'candidate'
      ? (menu.sourceKind === 'claude' ? group.claudeParagraphs : group.codexParagraphs)
        .slice(0, Math.max(0, (menu.sourceKind === 'claude' ? group.claudeParagraphs : group.codexParagraphs).findIndex((paragraph) => paragraph.id === menu.paragraphId)))
        .reduce((length, paragraph) => length + paragraph.text.length + 2, 0)
      : 0
    const markerSelection = selectedRange
      && selectedRange.rawStart !== null
      && selectedRange.rawEnd !== null
      && selectedRange.rawEnd > selectedRange.rawStart
      ? { start: paragraphBase + selectedRange.rawStart, end: paragraphBase + selectedRange.rawEnd }
      : null
    const rawSelection = markerSelection ?? locateUniqueRawSelection(rawSource, selectedRange?.text, paragraphBase)
    const selectedText = rawSelection && rawSource
      ? rawSource.slice(rawSelection.start - paragraphBase, rawSelection.end - paragraphBase)
      : selectedRange?.text
    const position = clampFloatingPosition(event.clientX, event.clientY, 218, 450)
    setRewriteMenu(null)
    setContextMenu({
      ...menu,
      selectedText,
      selectionStart: rawSelection?.start,
      selectionEnd: rawSelection?.end,
      ...position
    })
  }
  const openPreviewContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>, group: DraftAlignmentGroup): void => {
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    const position = clampFloatingPosition(event.clientX, event.clientY, 205, 270)
    setContextMenu(null)
    setPreviewContextMenu({
      groupId: group.id,
      selectedText: start !== end ? target.value.slice(start, end) : undefined,
      selectionStart: start,
      selectionEnd: end,
      ...position
    })
  }
  const buildPreviewContent = (overrideGroupId?: string, overrideContent?: string, orderedIds = previewOrder): string => orderedIds
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is DraftAlignmentGroup => Boolean(group))
    .filter((group) => group.decision?.kind !== 'omit')
    .map((group) => (
      group.id === overrideGroupId
        ? overrideContent ?? ''
        : previewOverrides[group.id] ?? group.decision?.content ?? ''
    ))
    .filter((content) => Boolean(content.trim()))
    .join('\n\n')
  const persistPreviewOrder = async (next: string[]): Promise<void> => {
    setPreviewOrder(next)
    await onReorderGroups(next)
    onApply(buildPreviewContent(undefined, undefined, next))
  }
  const deletePreviewModule = async (group: DraftAlignmentGroup): Promise<void> => {
    const content = previewOverrides[group.id] ?? group.decision?.content ?? ''
    setLastDeleted({ groupId: group.id, content })
    await onSetDecision({ groupId: group.id, kind: 'omit' })
    setPreviewOverrides((current) => ({ ...current, [group.id]: '' }))
    onApply(buildPreviewContent(group.id, ''))
  }
  const restoreDeletedModule = async (): Promise<void> => {
    if (!lastDeleted) return
    await onSetDecision({ groupId: lastDeleted.groupId, kind: 'freeform', content: lastDeleted.content })
    setPreviewOverrides((current) => ({ ...current, [lastDeleted.groupId]: lastDeleted.content }))
    onApply(buildPreviewContent(lastDeleted.groupId, lastDeleted.content))
    setLastDeleted(null)
  }
  const addMarker = async (): Promise<void> => {
    if (!markerComposer) return
    const group = groups.find((item) => item.id === markerComposer.groupId)
    if (!group) return
    const markers = [...(group.decision?.markers ?? []), {
      id: crypto.randomUUID(),
      start: markerComposer.start,
      end: markerComposer.end,
      text: markerComposer.text,
      note: markerComposer.note.trim(),
      status: 'active' as const
    }]
    await onSetGroupMarkers(group.id, markers)
    setMarkerComposer(null)
  }
  const beginRewrite = (input: Omit<RewriteMenuState, 'requirement'> & { requirement?: string }): void => {
    rewriteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRewriteMenu({ ...input, requirement: input.requirement ?? '' })
    setContextMenu(null)
    setPreviewContextMenu(null)
  }
  const closeRewrite = (): void => {
    setRewriteMenu(null)
    window.setTimeout(() => rewriteReturnFocusRef.current?.focus(), 0)
  }
  const submitRewrite = async (request: RewriteRequest): Promise<void> => {
    if (!rewriteMenu) return
    if (!request.requirement && !request.quickIntent) return
    await onGenerateCandidate({
      groupId: rewriteMenu.groupId,
      parentCandidateId: rewriteMenu.parentCandidateId,
      requirement: request.requirement,
      quickIntent: request.quickIntent ?? undefined,
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      preferredModel: request.preferredModel,
      preferredReasoningEffort: request.preferredReasoningEffort,
      structuredInstruction: request.structuredInstruction,
      selectedText: rewriteMenu.selectedText,
      selectionStart: rewriteMenu.selectionStart,
      selectionEnd: rewriteMenu.selectionEnd,
      sourceKind: rewriteMenu.sourceKind,
      sourceId: rewriteMenu.sourceId
    })
    closeRewrite()
  }
  const addFusionSelection = (selection: Omit<FusionSelection, 'id'>): void => {
    setFusionSelections((current) => {
      const sameGroup = current.filter((item) => item.groupId === selection.groupId)
      const duplicate = sameGroup.some((item) => item.sourceKind === selection.sourceKind
        && item.sourceId === selection.sourceId
        && item.selectionStart === selection.selectionStart
        && item.selectionEnd === selection.selectionEnd)
      if (duplicate) return current
      const existingSourceKeys = new Set(sameGroup.map(fusionSelectionSourceKey))
      if (!existingSourceKeys.has(fusionSelectionSourceKey(selection)) && existingSourceKeys.size >= 4) {
        onNotice('综合候选一次最多选择4个来源')
        return current
      }
      if (current.length && sameGroup.length !== current.length) onNotice('已切换到新的语义组，上一组的综合选区已清除')
      return [...sameGroup, { ...selection, id: crypto.randomUUID() }]
    })
    setContextMenu(null)
    setPreviewContextMenu(null)
  }
  const submitFusionRewrite = async (request: RewriteRequest): Promise<void> => {
    const groupId = fusionSelections[0]?.groupId
    if (!groupId || new Set(fusionSelections.map(fusionSelectionSourceKey)).size < 2) return
    await onGenerateCandidate({
      groupId,
      requirement: request.requirement,
      quickIntent: request.quickIntent ?? undefined,
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      preferredModel: request.preferredModel,
      preferredReasoningEffort: request.preferredReasoningEffort,
      structuredInstruction: request.structuredInstruction,
      sourceSelections: fusionSelections.map((selection) => ({
        sourceKind: selection.sourceKind,
        sourceId: selection.sourceId ?? null,
        selectedText: selection.selectedText,
        selectionStart: selection.selectionStart,
        selectionEnd: selection.selectionEnd
      }))
    })
    setFusionRequestOpen(false)
    setFusionSelections([])
  }
  const sourceAnnotationTarget = (menu: ComparisonContextMenu): {
    sourceKind: 'comparison_source' | 'comparison_candidate'
    sourceId: string
    sourceVersion: string
    blockId: string
    blockStart: number
    blockEnd: number
    selectedText: string
  } | null => {
    if (!session || !menu.selectedText || menu.selectionStart === undefined || menu.selectionEnd === undefined) return null
    const group = groups.find((item) => item.id === menu.groupId)
    if (!group) return null
    if (menu.sourceKind === 'candidate') {
      const candidate = group.candidates.find((item) => item.id === menu.sourceId)
      if (!candidate) return null
      return {
        sourceKind: 'comparison_candidate', sourceId: candidate.id, sourceVersion: candidate.contentHash,
        blockId: candidate.id, blockStart: menu.selectionStart, blockEnd: menu.selectionEnd, selectedText: menu.selectedText
      }
    }
    if (!menu.paragraphId) return null
    const paragraphs = menu.sourceKind === 'claude' ? group.claudeParagraphs : group.codexParagraphs
    const paragraphIndex = paragraphs.findIndex((paragraph) => paragraph.id === menu.paragraphId)
    const paragraph = paragraphs[paragraphIndex]
    if (!paragraph) return null
    const paragraphBase = paragraphs.slice(0, paragraphIndex).reduce((length, item) => length + item.text.length + 2, 0)
    const source = menu.sourceKind === 'claude' ? session.claudeSnapshot : session.codexSnapshot
    return {
      sourceKind: 'comparison_source', sourceId: source.id, sourceVersion: source.contentHash,
      blockId: paragraph.id, blockStart: menu.selectionStart - paragraphBase, blockEnd: menu.selectionEnd - paragraphBase,
      selectedText: menu.selectedText
    }
  }
  const refreshSourceAnnotations = async (): Promise<void> => {
    if (!window.creatorOS) return
    setSourceAnnotations(await window.creatorOS.listSourceScriptAnnotations(workspace.projectId))
  }
  const saveSourceAnnotation = async (menu: ComparisonContextMenu, style: 'highlight' | 'underline' | 'strike' | 'flag', note: string): Promise<void> => {
    if (!window.creatorOS) return
    const target = sourceAnnotationTarget(menu)
    if (!target || target.blockStart < 0 || target.blockEnd <= target.blockStart) throw new Error('标记选区已经变化，请重新选择')
    await window.creatorOS.upsertSourceScriptAnnotation({
      projectId: workspace.projectId,
      ...target,
      id: `script-annotation-${crypto.randomUUID()}`,
      style,
      note: note.trim(),
      status: 'active'
    })
    await refreshSourceAnnotations()
    setSourceAnnotationMenu(null)
    setContextMenu(null)
    onNotice('已添加来源标记；只在精确对应时迁入当前文案')
  }
  const applySourceAnnotation = async (style: 'highlight' | 'underline' | 'strike' | 'flag', note: string): Promise<void> => {
    if (!sourceAnnotationMenu) return
    await saveSourceAnnotation(sourceAnnotationMenu, style, note)
  }
  const clearSourceAnnotations = async (menu: ComparisonContextMenu | null = sourceAnnotationMenu): Promise<void> => {
    if (!window.creatorOS || !menu) return
    const target = sourceAnnotationTarget(menu)
    if (!target) return
    const sourceParagraphs = target.sourceId === session?.claudeSnapshot.id
      ? groups.flatMap((group) => group.claudeParagraphs)
      : groups.flatMap((group) => group.codexParagraphs)
    const blockText = target.sourceKind === 'comparison_candidate'
      ? groups.flatMap((group) => group.candidates).find((candidate) => candidate.id === target.sourceId)?.content ?? ''
      : sourceParagraphs.find((paragraph) => paragraph.id === target.blockId)?.text ?? ''
    const matches = sourceAnnotations.filter((annotation) => annotation.sourceKind === target.sourceKind
      && annotation.sourceId === target.sourceId
      && annotation.sourceVersion === target.sourceVersion
      && annotation.blockId === target.blockId
      && annotation.blockEnd > target.blockStart
      && annotation.blockStart < target.blockEnd)
    const replacements: ScriptTextAnnotation[] = []
    for (const annotation of matches) {
      await window.creatorOS.deleteSourceScriptAnnotation(workspace.projectId, annotation.id)
      for (const [pieceStart, pieceEnd] of [
        [annotation.blockStart, Math.min(annotation.blockEnd, target.blockStart)],
        [Math.max(annotation.blockStart, target.blockEnd), annotation.blockEnd]
      ] as const) {
        if (pieceEnd <= pieceStart) continue
        replacements.push(await window.creatorOS.upsertSourceScriptAnnotation({
          id: `script-annotation-${crypto.randomUUID()}`,
          projectId: workspace.projectId,
          sourceKind: target.sourceKind,
          sourceId: annotation.sourceId,
          sourceVersion: annotation.sourceVersion,
          blockId: annotation.blockId,
          blockStart: pieceStart,
          blockEnd: pieceEnd,
          selectedText: blockText.slice(pieceStart, pieceEnd),
          style: annotation.style,
          note: annotation.note,
          status: annotation.status
        }))
      }
    }
    setSourceAnnotations((current) => [
      ...current.filter((annotation) => !matches.some((match) => match.id === annotation.id)),
      ...replacements
    ])
    await refreshSourceAnnotations()
    setSourceAnnotationMenu(null)
    setContextMenu(null)
    onNotice(matches.length ? '已清除当前范围的来源标记' : '当前范围没有来源标记')
  }
  const dismissRewriteResult = (): void => {
    if (!rewriteResult) return
    setPendingRewrites((current) => Object.fromEntries(Object.entries(current).filter(([taskId]) => taskId !== rewriteResult.taskId)))
    window.setTimeout(() => rewriteReturnFocusRef.current?.focus(), 0)
  }
  const applyRewriteResult = async (mode: 'append' | 'replace'): Promise<void> => {
    if (!rewriteResult) return
    if (await rewriteResultTargetHasChanged(rewriteResult)) {
      setRewriteTargetChanged(true)
      onNotice('候选生成后原目标或当前文案又有变化；已保留候选，没有覆盖最新内容。请重新选择后再生成。')
      return
    }
    const group = groups.find((item) => item.id === rewriteResult.groupId)
    if (!group) return
    const candidate = rewriteResult.candidate
    if (mode === 'append') {
      const current = (previewOverrides[group.id] ?? group.decision?.content ?? '').trim()
      const content = current ? `${current}\n\n${candidate.content}` : candidate.content
      await onSetDecision({ groupId: group.id, kind: 'freeform', content })
      setPreviewOverrides((values) => ({ ...values, [group.id]: content }))
      onApply(buildPreviewContent(group.id, content))
    } else {
      await onSetDecision({ groupId: group.id, kind: 'candidate', sourceId: candidate.id })
      setPreviewOverrides((values) => ({ ...values, [group.id]: candidate.content }))
      onApply(buildPreviewContent(group.id, candidate.content))
    }
    dismissRewriteResult()
  }
  const continueRewriteResult = (): void => {
    if (!rewriteResult) return
    beginRewrite({
      groupId: rewriteResult.groupId,
      parentCandidateId: rewriteResult.candidate.id,
      x: window.innerWidth / 2,
      y: Math.min(window.innerHeight / 2, 420),
      sourceKind: 'candidate',
      sourceId: rewriteResult.candidate.id
    })
    dismissRewriteResult()
  }
  const retryCandidateTask = async (taskId: string, groupId: string): Promise<void> => {
    const task = await onRetryTask(taskId)
    setPendingRewrites((current) => ({ ...current, [task.id]: { groupId } }))
  }
  const handlePreviewDrop = async (event: React.DragEvent, index: number, targetGroup?: DraftAlignmentGroup): Promise<void> => {
    event.preventDefault()
    const sourcePayload = event.dataTransfer.getData('application/x-draft-preview-source')
    if (sourcePayload) {
      try {
        const source = JSON.parse(sourcePayload) as { groupId: string; sourceId: string; content: string }
        const sourceGroup = groups.find((group) => group.id === source.groupId)
        if (!sourceGroup) throw new Error('拖动来源已经失效')
        if (documentMode === 'clean' && targetGroup) {
          const target = event.currentTarget.querySelector<HTMLTextAreaElement>('textarea') ?? event.currentTarget.closest<HTMLElement>('.comparison-preview-module')?.querySelector<HTMLTextAreaElement>('textarea')
          if (target) {
            const value = previewOverrides[targetGroup.id] ?? targetGroup.decision?.content ?? ''
            const caret = target.selectionStart ?? value.length
            const next = `${value.slice(0, caret)}${source.content}${value.slice(caret)}`
            setPreviewOverrides((current) => ({ ...current, [targetGroup.id]: next }))
            await onSetDecision({ groupId: targetGroup.id, kind: 'freeform', content: next })
            onApply(buildPreviewContent(targetGroup.id, next))
            setPreviewDropIndex(null)
            return
          }
        }
        const awaitingConfirmation = needsSourceReplacementConfirmation(sourceGroup, source.sourceId)
        if (awaitingConfirmation) {
          setSourceReplacementPrompt({ groupId: sourceGroup.id, sourceId: source.sourceId, insertIndex: index })
          return
        }
        await chooseSource(sourceGroup, source.sourceId)
        const next = previewOrder.filter((id) => id !== source.groupId)
        next.splice(Math.max(0, Math.min(index, next.length)), 0, source.groupId)
        await persistPreviewOrder(next)
      } catch (reason) {
        onNotice(reason instanceof Error ? reason.message : '拖动来源已经失效')
      } finally {
        setPreviewDropIndex(null)
      }
      return
    }
    if (draggingPreviewGroupId) {
      const next = previewOrder.filter((id) => id !== draggingPreviewGroupId)
      next.splice(Math.max(0, Math.min(index, next.length)), 0, draggingPreviewGroupId)
      await persistPreviewOrder(next)
      setDraggingPreviewGroupId(null)
      setPreviewDropIndex(null)
    }
  }
  const scrollToGroup = (groupId: string): void => {
    setActiveGroupId(groupId)
    groupListRef.current?.querySelector<HTMLElement>(`[data-comparison-group-id="${groupId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const setupVisible = !session || session.status === 'failed' || session.status === 'aligning' || editingSources

  if (setupVisible) {
    const alignmentTask = session?.alignmentTaskId ? tasks.find((task) => task.id === session.alignmentTaskId) ?? null : null
    return <section id={mobilePanelId} role={mobilePanelId ? 'tabpanel' : undefined} aria-labelledby={mobilePanelLabelledBy} className={`draft-comparison-setup comparison-mobile-side-${mobileSide}`}>
      {showMobileTabs ? <ComparisonMobileTabs side={mobileSide} onChange={onMobileSideChange} /> : null}
      {workspace.sessionHistory.length > 1 ? <label className="comparison-setup-history">查看历史对照
        <AppSelect aria-label="设置页历史对照" value={session?.id ?? ''} onChange={(event) => void run(() => onSelectSession(event.currentTarget.value))}>
          {workspace.sessionHistory.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? '最新 · ' : ''}{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.status === 'ready' ? `${item.groupCount}组` : item.status === 'aligning' ? '对照中' : '失败'}</option>)}
        </AppSelect>
      </label> : null}
      <div ref={sourceGridRef} className="comparison-source-grid" style={{ gridTemplateColumns: `${liveSourceSplit}fr 10px ${100 - liveSourceSplit}fr` }}>
        <ComparisonSourceEditor
          side="codex"
          label="Codex稿"
          value={codexContent}
          source={workspace.codexSource}
          sourceStatus={sourceLabel(workspace.codexSource, availableProviders)}
          updatedAt={workspace.codexUpdatedAt}
          task={sourceTaskFor('codex')}
          requirement={sourceRequirements.codex}
          placeholder="直接粘贴、输入，或让已验证AI生成Codex稿"
          providerConfigId={providerConfigId}
          providers={availableProviders}
          disabled={busy}
          onChange={(value) => { setCodexContent(value); setCodexDirty(true) }}
          onRequirementChange={(value) => setSourceRequirements((current) => ({ ...current, codex: value }))}
          onProviderChange={setProviderConfigId}
          onGenerate={() => run(async () => {
            if (codexDirty) { await onSaveDrafts({ codexContent }); setCodexDirty(false) }
            await onGenerateSource({ side: 'codex', requirement: sourceRequirements.codex, providerConfigId })
          })}
          onRetry={async (taskId) => { await onRetryTask(taskId) }}
          onBlur={() => { if (codexDirty) void run(async () => { await onSaveDrafts({ codexContent }); setCodexDirty(false) }) }}
        />
        <div
          className="comparison-source-divider"
          role="separator"
          aria-label="调整Codex稿和Claude稿宽度"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={Math.round(liveSourceSplit)}
          tabIndex={0}
          onPointerDown={(event) => { sourceDraggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={resizeSourceColumns}
          onPointerUp={(event) => {
            sourceDraggingRef.current = false
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            onSourceSplitChange(liveSourceSplit)
          }}
          onPointerCancel={() => { sourceDraggingRef.current = false; setLiveSourceSplit(sourceSplit) }}
          onDoubleClick={() => { setLiveSourceSplit(50); onSourceSplitChange(50) }}
          onKeyDown={(event) => {
            const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -2 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 2 : 0
            if (!direction && event.key !== 'Home') return
            event.preventDefault()
            const next = event.key === 'Home' ? 50 : Math.max(30, Math.min(70, liveSourceSplit + direction))
            setLiveSourceSplit(next)
            onSourceSplitChange(next)
          }}
        ><span /></div>
        <ComparisonSourceEditor
          side="claude"
          label="Claude稿"
          value={claudeContent}
          source={workspace.claudeSource}
          sourceStatus={sourceLabel(workspace.claudeSource, availableProviders)}
          updatedAt={workspace.claudeUpdatedAt}
          task={sourceTaskFor('claude')}
          requirement={sourceRequirements.claude}
          placeholder="直接粘贴或输入你在Claude App里完成的稿子"
          providerConfigId={providerConfigId}
          providers={availableProviders}
          disabled={busy}
          onChange={(value) => { setClaudeContent(value); setClaudeDirty(true) }}
          onRequirementChange={(value) => setSourceRequirements((current) => ({ ...current, claude: value }))}
          onProviderChange={setProviderConfigId}
          onGenerate={() => run(async () => {
            if (claudeDirty) { await onSaveDrafts({ claudeContent }); setClaudeDirty(false) }
            await onGenerateSource({ side: 'claude', requirement: sourceRequirements.claude, providerConfigId })
          })}
          onRetry={async (taskId) => { await onRetryTask(taskId) }}
          onBlur={() => { if (claudeDirty) void run(async () => { await onSaveDrafts({ claudeContent }); setClaudeDirty(false) }) }}
        />
      </div>
      <div className="comparison-preflight" aria-label="双稿对照发送前检查">
        <span>Claude稿{claudeContent.trim().length}字</span>
        <span>Codex稿{codexContent.trim().length}字</span>
        <span>预计发送至少{claudeContent.length + codexContent.length}字</span>
        <button className={includeProjectContext ? 'active' : ''} aria-pressed={includeProjectContext} onClick={() => onIncludeProjectContextChange(!includeProjectContext)}>{includeProjectContext ? <Check size={11} /> : null}项目上下文：{includeProjectContext ? '包含' : '不包含'}</button>
        <button className={useOutline ? 'active' : ''} aria-pressed={useOutline} onClick={() => onUseOutlineChange(!useOutline)}>{useOutline ? <Check size={11} /> : null}{useOutline ? '参照大纲' : '不参照大纲'}</button>
        <span>隐私范围：{includeProjectContext ? '双稿正文与已批准项目资料' : '仅双稿正文'}</span>
        <span>安全状态：{codexReasoningAvailable ? 'Codex已验证' : 'Codex尚未验证'}</span>
      </div>
      <footer className="comparison-start-bar">
        <div>
          <b>{session?.status === 'aligning' ? '正在建立语义对照…' : session?.errorMessage ?? (editingSources ? '修改后会优先只处理变化部分；未变化的组连同选择和候选一起复用。' : '两边都准备好后，冻结当前内容并按语义分组。')}</b>
          <span>每次更新都会保留为历史对照；任务运行期间仍可继续写稿。</span>
        </div>
        {session?.status === 'failed' && alignmentTask ? <button onClick={() => void run(async () => { await onRetryTask(alignmentTask.id) })}><RefreshCw size={13} />按原快照重试</button> : null}
        {editingSources && session?.status === 'ready' ? <button onClick={() => setEditingSources(false)}>取消修改</button> : null}
        <span className="comparison-reasoning-provider">对照AI：Codex高推理</span>
        <button disabled={busy || loading} onClick={() => void run(saveDrafts)}>保存双稿</button>
        <button className="primary-action" disabled={!claudeContent.trim() || !codexContent.trim() || !codexReasoningAvailable || busy || session?.status === 'aligning'} onClick={() => void run(() => requestAlignment())}><GitCompareArrows size={15} />{session?.status === 'aligning' ? '对照中…' : editingSources ? '更新语义对照' : '开始语义对照'}</button>
      </footer>
      {fullRebuildPrompt ? <div className="comparison-full-rebuild-dialog" role="dialog" aria-label={fullRebuildPrompt.manualConflictCount ? '确认增量更新人工整理组' : '确认完整重建语义对照'}><b>{fullRebuildPrompt.manualConflictCount ? '修改碰到了人工整理内容' : '这次修改范围较大'}</b><p>{fullRebuildPrompt.manualConflictCount ? `${fullRebuildPrompt.manualConflictCount}组包含人工选择、备注、标记或候选。继续只重做这些变化组，其他组保持不变，旧结果仍保留在历史中。` : `约${fullRebuildPrompt.percent}%的内容需要重新对照。继续会完整重建分组，但旧对照和当前文案仍会保留在历史中。`}</p><footer><button onClick={() => setFullRebuildPrompt(null)}>取消</button><button className="primary-action" onClick={() => void run(() => requestAlignment(true))}>{fullRebuildPrompt.manualConflictCount ? '继续增量对照' : '继续完整重建'}</button></footer></div> : null}
    </section>
  }

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null
  const orderedPreviewGroups = previewOrder
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is DraftAlignmentGroup => Boolean(group))
  const previewContent = orderedPreviewGroups
    .filter((group) => group.decision && !['omit', 'unresolved'].includes(group.decision.kind))
    .map((group) => previewOverrides[group.id] ?? group.decision?.content ?? '')
    .filter((content) => Boolean(content.trim()))
    .join('\n\n')
  const unresolvedCount = groups.filter((group) => !group.decision || group.decision.kind === 'unresolved').length

  return <section
    ref={workspaceRef}
    id={mobilePanelId}
    role={mobilePanelId ? 'tabpanel' : undefined}
    aria-labelledby={mobilePanelLabelledBy}
    tabIndex={-1}
    className={`draft-comparison-workspace comparison-mobile-side-${mobileSide} comparison-color-mode-${colorMode} comparison-document-mode-${documentMode}`}
    style={{ gridTemplateColumns: `minmax(0, ${100 - livePreviewSplit}fr) 10px minmax(220px, ${livePreviewSplit}fr)` }}
    onScroll={(event) => { if (event.currentTarget === event.target) rememberScroll(event.currentTarget.scrollTop) }}
  >
    {showMobileTabs ? <ComparisonMobileTabs side={mobileSide} onChange={onMobileSideChange} /> : null}
    <header className="comparison-toolbar">
      <div><span>{historical ? '历史冻结快照' : `${groups.length}组 · 当前冻结快照`}</span><b>语义对照</b></div>
      <div className="comparison-operation-history">
        <button aria-expanded={historyOpen} disabled={!operationHistory.length} onClick={() => setHistoryOpen((value) => !value)}><History size={12} />历史操作</button>
        {historyOpen ? <div role="dialog" aria-label="历史操作记录">
          <header><b>最近操作</b><nav><button aria-label="撤销结构操作" disabled={operationHistory.length < 2 || historical} onClick={() => void run(undoOperationHistory)}><Undo2 size={12} /></button><button aria-label="重做结构操作" disabled={!historyRedoIds.length || historical} onClick={() => void run(redoOperationHistory)}><Redo2 size={12} /></button></nav></header>
          <div>{operationHistory.map((entry) => <button className={entry.id === historyCursorId ? 'current' : ''} key={entry.id} onClick={() => void run(() => restoreOperationHistory(entry.id, true))}><span>{entry.label}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time></button>)}</div>
          <footer>⌘Z撤销·⌘⇧Z重做·最多保留50条</footer>
        </div> : null}
      </div>
      <label className="comparison-history-picker">历史对照<AppSelect aria-label="历史对照" value={session.id} onChange={(event) => void run(() => onSelectSession(event.currentTarget.value))}>{workspace.sessionHistory.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? '最新 · ' : ''}{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.groupCount}组</option>)}</AppSelect></label>
      <div className="comparison-split-scope" role="group" aria-label="拆分范围">
        <button className={splitScope === 'current' ? 'is-pressed' : ''} aria-pressed={splitScope === 'current'} onClick={() => onSplitScopeChange('current')}>仅当前侧</button>
        <button className={splitScope === 'matched' ? 'is-pressed' : ''} aria-pressed={splitScope === 'matched'} onClick={() => onSplitScopeChange('matched')}>匹配两侧</button>
      </div>
      <span className="comparison-reasoning-provider">Codex高推理</span>
      <div className="comparison-group-tabs" role="tablist" aria-label="对照组">{groups.map((group, index) => <button
        key={group.id}
        className={`${activeGroup?.id === group.id ? 'active ' : ''}${group.decision ? 'decided ' : ''}${group.decision?.kind === 'unresolved' ? 'gap ' : ''}${mergeMode && selectedGroups.has(group.id) ? 'merge-selected ' : ''}${draggingGroupId === group.id ? 'dragging ' : ''}${groupColors[index % groupColors.length]}`}
        role="tab"
        aria-selected={activeGroup?.id === group.id}
        aria-label={`组${group.labelIndex}，${groupStatus(group)}${group.decision ? '，已选择' : ''}`}
        onClick={() => {
          if (!mergeMode) {
            scrollToGroup(group.id)
            return
          }
          setSelectedGroups((current) => {
            const next = new Set(current)
            if (next.has(group.id)) next.delete(group.id)
            else next.add(group.id)
            return next
          })
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-draft-paragraph') || event.dataTransfer.types.includes('application/x-draft-candidate') || event.dataTransfer.types.includes('application/x-draft-group')) event.preventDefault()
        }}
        onDrop={(event) => {
          const paragraph = event.dataTransfer.getData('application/x-draft-paragraph')
          const candidate = event.dataTransfer.getData('application/x-draft-candidate')
          const draggedGroup = event.dataTransfer.getData('application/x-draft-group')
          if (!paragraph && !candidate && !draggedGroup) return
          event.preventDefault()
          try {
            if (draggedGroup) {
              const input = JSON.parse(draggedGroup) as { groupId: string }
              if (input.groupId !== group.id) {
                const ids = groups.map((item) => item.id).filter((id) => id !== input.groupId)
                ids.splice(Math.max(0, ids.indexOf(group.id)), 0, input.groupId)
                void run(() => onReorderGroups(ids))
              }
            } else if (paragraph) {
              const input = JSON.parse(paragraph) as { side: DraftComparisonSide; paragraphId: string; fromGroupId: string }
              if (input.fromGroupId !== group.id) void run(() => moveParagraphWithPair({ ...input, toGroupId: group.id }))
            } else {
              const input = JSON.parse(candidate) as { candidateId: string; fromGroupId: string }
              if (input.fromGroupId !== group.id) void run(() => onMoveCandidate(input.candidateId, group.id))
            }
          } catch { onNotice('拖动的段落信息已经失效') }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setGroupContextMenu({ groupId: group.id, ...clampFloatingPosition(event.clientX, event.clientY, 205, 68) })
        }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-draft-group', JSON.stringify({ groupId: group.id }))
          setDraggingGroupId(group.id)
        }}
        onDragEnd={() => setDraggingGroupId(null)}
      ><span>{group.labelIndex}</span>{group.decision || (mergeMode && selectedGroups.has(group.id)) ? <Check size={9} /> : null}</button>)}</div>
      {historical
        ? <button onClick={() => void run(() => onSelectSession(null))}>返回最新</button>
        : <button className={sourceChangedSinceSnapshot ? 'has-source-change' : ''} onClick={() => setEditingSources(true)}>{sourceChangedSinceSnapshot ? '工作稿已变化·重新对照' : '修改双稿'}</button>}
      {mergeMode ? <div className="comparison-merge-bar"><span>已选{selectedGroups.size}组</span><button disabled={historical || selectedGroups.size < 2 || busy} onClick={() => void run(async () => { await onMergeGroups(Array.from(selectedGroups)); setSelectedGroups(new Set()); setMergeMode(false) })}><Combine size={12} />合并</button><button onClick={() => { setSelectedGroups(new Set()); setMergeMode(false) }}>取消</button></div> : null}
      <button disabled={!canUndo} onClick={onUndo}><RotateCcw size={13} />撤销应用</button>
      <button className={movePairedContent ? 'is-pressed' : ''} aria-pressed={movePairedContent} title="拖动来源卡时，是否同时移动另一侧对应内容" onClick={() => setMovePairedContent((value) => !value)}>{movePairedContent ? <Link2 size={13} /> : <Link2Off size={13} />}联动</button>
      <label className="comparison-compact-select"><Palette size={12} /><AppSelect aria-label="着色模式" value={colorMode} onChange={(event) => onColorModeChange(event.currentTarget.value as DraftComparisonColorMode)}><option value="all">全部</option><option value="left">仅左侧</option><option value="none">全部关闭</option></AppSelect></label>
      <div className="comparison-document-mode" role="group" aria-label="当前文案模式"><button className={documentMode === 'groups' ? 'is-pressed' : ''} onClick={() => onDocumentModeChange('groups')}><Layers3 size={12} />组模式</button><button className={documentMode === 'clean' ? 'is-pressed' : ''} onClick={() => onDocumentModeChange('clean')}><FileText size={12} />纯净</button></div>
    </header>
    <fieldset className="comparison-readonly-content" disabled={historical}>
      <div
        ref={groupListRef}
        className="comparison-group-list"
        onScroll={(event) => rememberScroll(event.currentTarget.scrollTop)}
      >
        {groups.map((group, index) => {
          const groupTask = latestTask(tasks, (task) => task.taskType === 'draft_candidate' && task.outputTarget === `draft-candidate:${group.id}`)
          const splitTask = latestTask(tasks, (task) => task.taskType === 'draft_split_match' && task.outputTarget === `draft-split-match:${group.id}`)
          const comparisonCandidates = group.candidates.filter((candidate) => comparisonCandidateIds.has(candidate.id))
          const historyStacks = candidateHistoryStacks(group.candidates)
          const missingCombinationSources = group.decision?.kind === 'combination'
            ? group.decision.sourceIds.filter((id) => id !== 'claude' && id !== 'codex' && !group.candidates.some((candidate) => candidate.id === id)).length
            : 0
          return <article
            key={group.id}
            data-comparison-group-id={group.id}
            className={`comparison-group-card ${groupColors[index % groupColors.length]}${activeGroup?.id === group.id ? ' is-active' : ''}${group.decision ? ' has-decision' : ''}`}
            onMouseEnter={() => setActiveGroupId(group.id)}
          >
            <header onContextMenu={(event) => { event.preventDefault(); setGroupContextMenu({ groupId: group.id, ...clampFloatingPosition(event.clientX, event.clientY, 205, 68) }) }}>
              <label>组{group.labelIndex}{group.outlineLabel ? <small title={group.outlineLabel}>{group.outlineLabel}</small> : null}{mergeMode && selectedGroups.has(group.id) ? <span className="comparison-merge-check"><Check size={10} /></span> : null}</label>
              <span className={`comparison-group-status status-${group.matchType}${group.manuallyAdjusted ? ' manual' : ''}`}>{groupStatus(group)}</span>
            </header>
            {missingCombinationSources ? <div className="candidate-card-notice">组合结果已保留；其中{missingCombinationSources}个来源候选已删除。</div> : null}
            <div className="comparison-sources" style={{ gridTemplateColumns: `${liveSourceSplit}fr ${100 - liveSourceSplit}fr` }}>
              <ComparisonGroupSource
                side="codex"
                label="Codex稿"
                group={group}
                selected={group.decision?.sourceIds.includes('codex') ?? false}
                selectedParagraphIds={paragraphSelection?.groupId === group.id && paragraphSelection.side === 'codex' ? paragraphSelection.ids : new Set()}
                onSelect={() => void run(() => chooseSource(group, 'codex'))}
                onParagraphSelect={selectParagraph}
                onMoveParagraph={(input) => void run(() => moveParagraphWithPair(input))}
                onContextMenu={openSourceContextMenu}
                onGroupContextMenu={(event) => {
                  event.preventDefault()
                  setGroupContextMenu({ groupId: group.id, side: 'codex', ...clampFloatingPosition(event.clientX, event.clientY, 218, 310) })
                }}
                annotations={sourceAnnotations.filter((annotation) => annotation.sourceId === session.codexSnapshot.id && annotation.sourceVersion === session.codexSnapshot.contentHash)}
              />
              <ComparisonGroupSource
                side="claude"
                label="Claude稿"
                group={group}
                selected={group.decision?.sourceIds.includes('claude') ?? false}
                selectedParagraphIds={paragraphSelection?.groupId === group.id && paragraphSelection.side === 'claude' ? paragraphSelection.ids : new Set()}
                onSelect={() => void run(() => chooseSource(group, 'claude'))}
                onParagraphSelect={selectParagraph}
                onMoveParagraph={(input) => void run(() => moveParagraphWithPair(input))}
                onContextMenu={openSourceContextMenu}
                onGroupContextMenu={(event) => {
                  event.preventDefault()
                  setGroupContextMenu({ groupId: group.id, side: 'claude', ...clampFloatingPosition(event.clientX, event.clientY, 218, 310) })
                }}
                annotations={sourceAnnotations.filter((annotation) => annotation.sourceId === session.claudeSnapshot.id && annotation.sourceVersion === session.claudeSnapshot.contentHash)}
              />
            </div>
            {comparisonCandidates.length >= 2 ? <div className="comparison-candidate-compare">
              <header><b>候选对比</b><button aria-label="关闭候选对比" onClick={() => setComparisonCandidateIds((current) => { const next = new Set(current); group.candidates.forEach((candidate) => next.delete(candidate.id)); return next })}><X size={12} /></button></header>
              <div>{comparisonCandidates.map((candidate) => <article key={candidate.id}><b>{providerName(candidate, availableProviders)}</b><ReadableMarkdown content={candidate.content} annotations={readableFactAnnotations(candidate.factAnnotations)} manualMarks={sourceManualMarks(sourceAnnotations, candidate.id, candidate.id)} /><CandidateFactEvidence annotations={candidate.factAnnotations} /></article>)}</div>
            </div> : null}
            <div className="comparison-candidates" data-group-id={group.id}>
              {historyStacks.map((stack) => {
                const selectedHistoryIndex = stack.candidates.findIndex((candidate) => group.decision?.sourceIds.includes(candidate.id))
                const historyIndex = Math.max(0, Math.min(stack.candidates.length - 1, candidateHistoryIndexes[stack.id] ?? (selectedHistoryIndex >= 0 ? selectedHistoryIndex : stack.candidates.length - 1)))
                const candidate = stack.candidates[historyIndex]!
                const expanded = expandedCandidateId === candidate.id
                const compared = comparisonCandidateIds.has(candidate.id)
                return <div
                  key={stack.id}
                  data-draft-candidate
                  tabIndex={0}
                  aria-expanded={expanded}
                  className={`${group.decision?.sourceIds.includes(candidate.id) ? 'candidate-selected ' : ''}${expanded ? 'candidate-expanded' : ''}`}
                  onContextMenu={(event) => openSourceContextMenu(event, { groupId: group.id, sourceId: candidate.id, sourceKind: 'candidate' })}
                  onDragOver={(event) => {
                    if (draggingCandidateId && draggingCandidateId !== candidate.id) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    if (!draggingCandidateId || draggingCandidateId === candidate.id) return
                    event.preventDefault()
                    const movingStack = historyStacks.find((item) => item.candidates.some((itemCandidate) => itemCandidate.id === draggingCandidateId))
                    if (!movingStack || movingStack.id === stack.id) return
                    const orderedStacks = historyStacks.filter((item) => item.id !== movingStack.id)
                    orderedStacks.splice(Math.max(0, orderedStacks.findIndex((item) => item.id === stack.id)), 0, movingStack)
                    const ids = orderedStacks.flatMap((item) => item.candidates.map((itemCandidate) => itemCandidate.id))
                    void run(() => onReorderCandidates(group.id, ids))
                    setDraggingCandidateId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter') { event.preventDefault(); setExpandedCandidateId(expanded ? null : candidate.id); return }
                    if (event.key === 'Escape') { event.preventDefault(); setExpandedCandidateId(null); return }
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                    event.preventDefault()
                    const cards = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-draft-candidate]') ?? [])
                    const currentIndex = cards.indexOf(event.currentTarget)
                    cards[(currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + cards.length) % cards.length]?.focus()
                  }}
                >
                  <header>
                    <button
                      type="button"
                      className={`comparison-select-circle${group.decision?.sourceIds.includes(candidate.id) ? ' selected' : ''}`}
                      aria-label={`${group.decision?.sourceIds.includes(candidate.id) ? '取消选用' : '选用'}${providerName(candidate, availableProviders)}`}
                      aria-pressed={group.decision?.sourceIds.includes(candidate.id) ?? false}
                      onClick={(event) => { event.stopPropagation(); void run(() => chooseSource(group, candidate.id)) }}
                    >{group.decision?.sourceIds.includes(candidate.id) ? <Check size={11} /> : null}</button>
                    <b>{providerName(candidate, availableProviders)}</b>
                    <span>{candidate.summary}</span>
                    <button
                      type="button"
                      className="comparison-drag-handle"
                      draggable
                      aria-label={`拖动${providerName(candidate, availableProviders)}`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-draft-candidate', JSON.stringify({ candidateId: candidate.id, fromGroupId: group.id }))
                        event.dataTransfer.setData('application/x-draft-preview-source', JSON.stringify({ groupId: group.id, sourceId: candidate.id, sourceKind: 'candidate', content: candidate.content }))
                        setDraggingCandidateId(candidate.id)
                      }}
                      onDragEnd={() => setDraggingCandidateId(null)}
                    ><GripVertical size={11} /></button>
                    {stack.candidates.length > 1 ? <nav aria-label={`${providerName(candidate, availableProviders)}历史候选`}>
                      <button aria-label="上一个历史候选" disabled={historyIndex === 0} onClick={(event) => { event.stopPropagation(); setCandidateHistoryIndexes((current) => ({ ...current, [stack.id]: historyIndex - 1 })) }}>‹</button>
                      <small>{historyIndex + 1}/{stack.candidates.length}</small>
                      <button aria-label="下一个历史候选" disabled={historyIndex === stack.candidates.length - 1} onClick={(event) => { event.stopPropagation(); setCandidateHistoryIndexes((current) => ({ ...current, [stack.id]: historyIndex + 1 })) }}>›</button>
                    </nav> : null}
                  </header>
                  <ReadableMarkdown content={candidate.content} annotations={readableFactAnnotations(candidate.factAnnotations)} manualMarks={sourceManualMarks(sourceAnnotations, candidate.id, candidate.id)} />
                  <CandidateFactEvidence annotations={candidate.factAnnotations} />
                  {candidate.inputRelationChanged ? <div className="candidate-card-notice">分组关系已变化，请确认内容后再选用。</div> : null}
                  {expanded ? <div className="comparison-candidate-detail">
                    <span>要求：{candidate.requirement}</span>
                    {candidate.rationale ? <span>说明：{candidate.rationale}</span> : null}
                    <span>来源：{candidate.sourceKind === 'freeform' ? '手动' : `${providerName(candidate, availableProviders).replace('候选', '')}${candidate.model ? ` · ${candidate.model}` : candidate.provider === 'codex_cli' || candidate.provider === 'claude_cli' ? ' · CLI自动选择' : ''}`}{candidate.parentTraceId ? ' · 基于上一候选' : ''}</span>
                    <span>第{candidate.revisionRound}轮 · {candidate.characterCount}字 · 顺序{candidate.position + 1}</span>
                  </div> : null}
                  {compared ? <span className="candidate-inline-state"><Eye size={11} />对比中</span> : null}
                </div>
              })}
            </div>
            {groupTask && ['queued', 'running', 'failed'].includes(groupTask.status) ? <div className={`comparison-task-state ${groupTask.status}`}>
              <span>{groupTask.status === 'failed' ? groupTask.errorMessage ?? '候选生成失败' : `候选生成中 · ${groupTask.progress}%`}</span>
              {groupTask.status === 'failed' ? <button onClick={() => void run(() => retryCandidateTask(groupTask.id, group.id))}><RefreshCw size={11} />按原输入重试</button> : null}
            </div> : null}
            {splitTask && ['queued', 'running', 'failed'].includes(splitTask.status) ? <div className={`comparison-task-state ${splitTask.status}`}>
              <span>{splitTask.status === 'failed' ? splitTask.errorMessage ?? '匹配拆分失败，原组没有变化' : `Codex匹配对侧段落中 · ${splitTask.progress}%`}</span>
              {splitTask.status === 'failed' ? <button onClick={() => void run(async () => { await onRetryTask(splitTask.id) })}><RefreshCw size={11} />按原输入重试</button> : null}
            </div> : null}
          </article>
        })}
      </div>
    </fieldset>
    <div
      className="comparison-preview-divider"
      role="separator"
      aria-label="调整对照内容和合并预览宽度"
      aria-orientation="vertical"
      aria-valuemin={20}
      aria-valuemax={45}
      aria-valuenow={Math.round(livePreviewSplit)}
      tabIndex={0}
      onPointerDown={(event) => { previewDraggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={resizePreviewColumn}
      onPointerUp={(event) => {
        previewDraggingRef.current = false
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        onPreviewSplitChange(livePreviewSplit)
      }}
      onPointerCancel={() => { previewDraggingRef.current = false; setLivePreviewSplit(previewSplit) }}
      onDoubleClick={() => { setLivePreviewSplit(29); onPreviewSplitChange(29) }}
      onKeyDown={(event) => {
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 2 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? -2 : 0
        if (!direction && event.key !== 'Home') return
        event.preventDefault()
        const next = event.key === 'Home' ? 29 : Math.max(20, Math.min(45, livePreviewSplit + direction))
        setLivePreviewSplit(next)
        onPreviewSplitChange(next)
      }}
    ><span /></div>
    <aside className="comparison-preview">
      <header><div><h2>当前文案</h2></div><button onClick={() => void run(() => persistPreviewOrder([...groups].sort((left, right) => left.position - right.position).map((group) => group.id)))}>恢复组序</button>{lastDeleted ? <button onClick={() => void run(restoreDeletedModule)}><RotateCcw size={12} />撤销删除</button> : null}{groups.some((group) => group.decision?.markers.length) ? <button onClick={() => setMarkerListGroupId(groups.find((group) => group.decision?.markers.length)?.id ?? null)}><Flag size={12} />{groups.reduce((sum, group) => sum + (group.decision?.markers.length ?? 0), 0)}</button> : null}<b className={currentDocumentDiverged || unresolvedCount ? 'has-unresolved' : ''}>{currentDocumentDiverged ? '待确认' : unresolvedCount ? `${unresolvedCount}处待处理` : '已同步'}</b></header>
      {currentDocumentDiverged ? <div className="comparison-current-diverged" role="note"><AlertTriangle size={13} /><span><b>当前文案已在其他页面更新</b><small>整理状态仍保留；任何覆盖都会先让你确认。“纯净”模式已跟进最新正文。</small></span></div> : null}
      <div className="comparison-preview-modules">
        {documentMode === 'clean' ? <article
          className="comparison-clean-document"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-draft-preview-source')) event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            const payload = event.dataTransfer.getData('application/x-draft-preview-source')
            if (!payload) return
            try {
              const source = JSON.parse(payload) as { content: string }
              const textarea = event.currentTarget.querySelector<HTMLTextAreaElement>('textarea')
              const caret = textarea?.selectionStart ?? cleanContent.length
              const next = `${cleanContent.slice(0, caret)}${source.content}${cleanContent.slice(caret)}`
              setCleanContent(next)
              setCleanDirty(true)
            } catch { onNotice('拖动来源已经失效') }
          }}
        ><AutoGrowTextarea
            ariaLabel="纯净文案编辑区"
            value={cleanContent}
            clean
            onChange={(next) => { setCleanContent(next); setCleanDirty(true) }}
            onBlur={() => void run(persistCleanDocument)}
            onContextMenu={(event) => {
              event.preventDefault()
              const start = event.currentTarget.selectionStart ?? 0
              const end = event.currentTarget.selectionEnd ?? start
              const location = groupAtCleanOffset(start)
              if (!location) return
              const endLocation = groupAtCleanOffset(Math.max(start, end - 1))
              const selectionStaysInGroup = start !== end && endLocation?.group.id === location.group.id
              const position = clampFloatingPosition(event.clientX, event.clientY, 205, 270)
              setPreviewContextMenu({
                groupId: location.group.id,
                selectedText: selectionStaysInGroup ? cleanContent.slice(start, end) : undefined,
                selectionStart: selectionStaysInGroup ? location.localOffset : undefined,
                selectionEnd: selectionStaysInGroup ? location.localOffset + Math.max(0, end - start) : undefined,
                ...position
              })
            }}
          /></article> : orderedPreviewGroups.length ? orderedPreviewGroups.map((group, index) => {
          const colorClass = groupColors[Math.max(0, groups.findIndex((item) => item.id === group.id)) % groupColors.length]
          const unresolved = !group.decision || group.decision.kind === 'unresolved'
          const omitted = group.decision?.kind === 'omit'
          const value = previewOverrides[group.id] ?? group.decision?.content ?? ''
          return <div className="comparison-preview-drop-wrap" key={group.id}>
            <div
              className={`comparison-preview-insert-line${previewDropIndex === index ? ' active' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setPreviewDropIndex(index) }}
              onDragLeave={() => setPreviewDropIndex((current) => current === index ? null : current)}
              onDrop={(event) => void run(() => handlePreviewDrop(event, index))}
            />
            <article
              className={`comparison-preview-module ${colorClass}${unresolved ? ' unresolved' : ''}${omitted ? ' omitted' : ''}${group.decision?.markers.length ? ' has-inline-marker' : ''}`}
              data-preview-group-id={group.id}
              onDragOver={(event) => {
                event.preventDefault()
                setPreviewDropIndex(index + 1)
              }}
              onDrop={(event) => {
                void run(() => handlePreviewDrop(event, index + 1, group))
              }}
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('textarea')) return
                event.preventDefault()
                setPreviewContextMenu({ groupId: group.id, ...clampFloatingPosition(event.clientX, event.clientY, 205, 270) })
              }}
            >
              <header>
                <button draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingPreviewGroupId(group.id) }} onDragEnd={() => setDraggingPreviewGroupId(null)} aria-label={`拖动组${group.labelIndex}`}><GripVertical size={12} />组{group.labelIndex}</button>
                <span>{group.decision?.note ? <StickyNote size={11} aria-label="有备注" /> : null}{group.decision?.markers.length ? <button aria-label={`组${group.labelIndex}有${group.decision.markers.length}个标记`} onClick={() => setMarkerListGroupId(group.id)}><Flag size={11} />{group.decision.markers.length}</button> : null}</span>
                <small>{index + 1}/{orderedPreviewGroups.length}</small>
              </header>
              {group.decision?.markers.map((marker, markerIndex) => <button
                className="comparison-inline-marker"
                key={marker.id}
                style={inlineMarkerStyle(value, marker.start, markerIndex)}
                aria-label={`查看组${group.labelIndex}标记${markerIndex + 1}`}
                title={marker.text}
                onClick={() => setMarkerListGroupId(group.id)}
              ><Flag size={8} /></button>)}
              {unresolved
                ? <button className="preview-gap preview-gap-empty" aria-label={`定位组${group.labelIndex}待处理内容`} onClick={() => scrollToGroup(group.id)} />
                : omitted
                  ? <button className="preview-gap" onClick={() => {
                      const restoreSource = group.codexParagraphs.length ? 'codex' : group.claudeParagraphs.length ? 'claude' : null
                      if (restoreSource) void run(() => chooseSource(group, restoreSource))
                    }}>这一组已从当前文案删除，点按恢复</button>
                  : <AutoGrowTextarea
                      ariaLabel={`组${group.labelIndex}当前文案`}
                      value={value}
                      clean={false}
                      onChange={(next) => setPreviewOverrides((current) => ({ ...current, [group.id]: next }))}
                      onBlur={() => void run(() => persistPreviewOverride(group))}
                      onContextMenu={(event) => openPreviewContextMenu(event, group)}
                    />}
            </article>
          </div>
        }) : <div className="empty-state">从左侧点选内容后，这里会生成当前文案。</div>}
        {documentMode === 'groups' ? <div
          className={`comparison-preview-insert-line end${previewDropIndex === orderedPreviewGroups.length ? ' active' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setPreviewDropIndex(orderedPreviewGroups.length) }}
          onDrop={(event) => void run(() => handlePreviewDrop(event, orderedPreviewGroups.length))}
        /> : null}
      </div>
      <footer><span>{currentDocumentDiverged ? '整理结果与最新当前文案待确认' : (documentMode === 'clean' ? cleanContent : previewContent).trim() ? '左右编辑已同步到同一份当前文案' : '当前文案为空'}</span><button disabled={!(documentMode === 'clean' ? cleanContent : previewContent).trim()} onClick={() => documentMode === 'clean' ? void run(() => persistCleanDocument(true)) : onApply(previewContent)}><Check size={13} />{currentDocumentDiverged ? documentMode === 'clean' ? '以最新正文继续' : '确认同步' : '立即同步'}</button></footer>
    </aside>
    {documentSyncPrompt ? <><div className="comparison-document-sync-backdrop" aria-hidden="true" /><div className="comparison-full-rebuild-dialog comparison-document-sync-dialog" role="alertdialog" aria-modal="true" aria-label="确认对照整理同步" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDocumentSyncPrompt(null)
        markDocumentDiverged()
        restoreDocumentSyncFocus()
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = buttons[0]
      const last = buttons.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}><b>{documentSyncPrompt.reason === 'structured_replacement' ? '这次同步会改动当前文案的结构化内容' : '当前文案有更新，要用整理结果覆盖吗？'}</b><p>{documentSyncPrompt.reason === 'structured_replacement' ? '无法安全映射的格式、标记、来源关系或段落结构可能被移除。整理结果已经保留；只有明确选择覆盖才会替换整篇正文。' : '已保留对照整理中的结构和选择。保留当前文案不会丢掉这些整理状态；只有明确选择覆盖才会替换正文。'}</p><footer><button autoFocus onClick={() => {
      setDocumentSyncPrompt(null)
      markDocumentDiverged()
      restoreDocumentSyncFocus()
    }}>保留当前文案</button><button className="primary-action" onClick={() => {
      const latestOrganizedContent = documentMode === 'clean' ? cleanContent : previewContent
      if (latestOrganizedContent !== documentSyncPrompt.content) {
        setDocumentSyncPrompt({ ...documentSyncPrompt, content: latestOrganizedContent })
        onNotice('整理结果又有变化，请按当前可见内容重新确认。')
        return
      }
      if (currentDocumentFingerprintRef.current !== documentSyncPrompt.currentFingerprint) {
        setDocumentSyncPrompt({ ...documentSyncPrompt, currentFingerprint: currentDocumentFingerprintRef.current })
        onNotice('当前文案又有新变化，请重新确认。')
        return
      }
      applyCleanContent(documentSyncPrompt.content, documentSyncPrompt.sourceAnnotations)
    }}>用整理结果覆盖</button></footer></div></> : null}
    {contextMenu ? (() => {
      const group = groups.find((item) => item.id === contextMenu.groupId)
      if (!group) return null
      const sourceParagraphs = contextMenu.sourceKind === 'candidate'
        ? []
        : contextMenu.sourceKind === 'claude' ? group.claudeParagraphs : group.codexParagraphs
      const selectedParagraphIds = contextMenu.paragraphId
        ? paragraphSelection?.groupId === group.id
          && paragraphSelection.side === contextMenu.sourceKind
          && paragraphSelection.ids.has(contextMenu.paragraphId)
          ? sourceParagraphs.filter((paragraph) => paragraphSelection.ids.has(paragraph.id)).map((paragraph) => paragraph.id)
          : [contextMenu.paragraphId]
        : []
      const selectedParagraphText = selectedParagraphIds.length
        ? sourceParagraphs.filter((paragraph) => selectedParagraphIds.includes(paragraph.id)).map((paragraph) => paragraph.text).join('\n\n')
        : ''
      const selectedIndexes = selectedParagraphIds.map((id) => sourceParagraphs.findIndex((paragraph) => paragraph.id === id)).filter((index) => index >= 0)
      const selectionIsContiguous = selectedIndexes.length > 0
        && Math.max(...selectedIndexes) - Math.min(...selectedIndexes) + 1 === selectedIndexes.length
      const contiguousSelectedText = selectionIsContiguous
        ? sourceParagraphs.slice(Math.min(...selectedIndexes), Math.max(...selectedIndexes) + 1).map((paragraph) => paragraph.text).join('\n\n')
        : ''
      const effectiveSelectedText = contextMenu.selectedText || contiguousSelectedText || undefined
      const fullSourceContent = contextMenu.sourceKind === 'candidate'
        ? sourceContent(group, contextMenu.sourceId)
        : sourceParagraphs.map((paragraph) => paragraph.text).join('\n\n')
      const effectiveSelectionStart = contextMenu.selectedText
        ? contextMenu.selectionStart
        : effectiveSelectedText ? fullSourceContent.indexOf(effectiveSelectedText) : undefined
      const effectiveSelectionEnd = effectiveSelectionStart !== undefined && effectiveSelectionStart >= 0 && effectiveSelectedText
        ? effectiveSelectionStart + effectiveSelectedText.length
        : undefined
      const currentGroupContent = previewOverrides[group.id] ?? group.decision?.content ?? ''
      const markerStart = contextMenu.selectedText ? currentGroupContent.indexOf(contextMenu.selectedText) : -1
      const markerCanLocate = markerStart >= 0 && markerStart === currentGroupContent.lastIndexOf(contextMenu.selectedText ?? '')
      if (contextMenu.selectedText && effectiveSelectionStart !== undefined && effectiveSelectionEnd !== undefined) {
        return <SelectionActionMenu
          anchor={workspaceRef.current}
          anchorPoint={{ x: contextMenu.x, y: contextMenu.y }}
          selectionLabel={contextMenu.selectedText}
          allowFusion
          onDismiss={() => setContextMenu(null)}
          onRewrite={() => beginRewrite({
            groupId: group.id,
            parentCandidateId: contextMenu.sourceKind === 'candidate' ? contextMenu.sourceId : null,
            x: contextMenu.x,
            y: contextMenu.y,
            selectedText: contextMenu.selectedText,
            selectionStart: effectiveSelectionStart,
            selectionEnd: effectiveSelectionEnd,
            sourceKind: contextMenu.sourceKind,
            sourceId: contextMenu.sourceId
          })}
          onFusion={() => addFusionSelection({
            groupId: group.id,
            sourceKind: contextMenu.sourceKind,
            sourceId: contextMenu.sourceId,
            sourceLabel: contextMenu.sourceKind === 'claude' ? 'Claude稿' : contextMenu.sourceKind === 'codex' ? 'Codex稿' : '候选',
            selectedText: contextMenu.selectedText!,
            selectionStart: effectiveSelectionStart,
            selectionEnd: effectiveSelectionEnd
          })}
          onAnnotation={(style) => void run(() => saveSourceAnnotation(contextMenu, style, ''))}
          onNote={() => {
            setSourceAnnotationMenu({ ...contextMenu, note: '' })
            setContextMenu(null)
          }}
          onClear={() => void run(() => clearSourceAnnotations(contextMenu))}
        />
      }
      return <div className="comparison-context-menu" data-comparison-context-root="true" role="menu" tabIndex={-1} onKeyDown={navigateComparisonContextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
        {selectedParagraphText && contextMenu.sourceKind !== 'candidate' ? <button role="menuitem" onClick={() => void run(async () => { await chooseSource(group, contextMenu.sourceId, selectedParagraphText); setContextMenu(null) })}><Check size={14} /><span><b>选用所选段落</b><small>{selectedParagraphIds.length > 1 ? `按原顺序加入${selectedParagraphIds.length}段` : '加入当前段落'}</small></span></button> : null}
        <button role="menuitem" disabled={!codexReasoningAvailable || (selectedParagraphIds.length > 1 && !selectionIsContiguous)} onClick={() => beginRewrite({ groupId: group.id, parentCandidateId: contextMenu.sourceKind === 'candidate' ? contextMenu.sourceId : null, x: contextMenu.x, y: contextMenu.y, selectedText: effectiveSelectedText, selectionStart: effectiveSelectionStart, selectionEnd: effectiveSelectionEnd, sourceKind: contextMenu.sourceKind, sourceId: contextMenu.sourceId })}><MessageSquarePlus size={14} /><span><b>按具体要求修改…</b><small>{selectedParagraphIds.length > 1 && !selectionIsContiguous ? '改写时请选择连续段落' : effectiveSelectedText ? `只改${selectedParagraphIds.length > 1 ? `所选${selectedParagraphIds.length}段` : '当前内容'}` : '处理当前来源'}</small></span></button>
        <button role="menuitem" disabled={selectedParagraphIds.length > 1 && !selectionIsContiguous} onClick={() => {
          const text = effectiveSelectedText || fullSourceContent
          const start = effectiveSelectionStart !== undefined && effectiveSelectionStart >= 0 ? effectiveSelectionStart : 0
          if (!text) return
          addFusionSelection({
            groupId: group.id,
            sourceKind: contextMenu.sourceKind,
            sourceId: contextMenu.sourceId,
            sourceLabel: contextMenu.sourceKind === 'claude' ? 'Claude稿' : contextMenu.sourceKind === 'codex' ? 'Codex稿' : '候选',
            selectedText: text,
            selectionStart: start,
            selectionEnd: start + text.length
          })
        }}><Combine size={14} /><span><b>加入综合候选</b><small>再从其他来源选取，最多4项</small></span></button>
        {contextMenu.selectedText ? <button role="menuitem" onClick={() => {
          setSourceAnnotationMenu({ ...contextMenu, note: '' })
          setContextMenu(null)
        }}><Flag size={14} /><span><b>添加工作台标记…</b></span></button> : null}
        {contextMenu.selectedText ? <button role="menuitem" disabled={!markerCanLocate} onClick={() => {
          if (!contextMenu.selectedText || !markerCanLocate) return
          setMarkerComposer({
            groupId: group.id,
            ...clampFloatingPosition(contextMenu.x, contextMenu.y, 238, 190),
            start: markerStart,
            end: markerStart + contextMenu.selectedText.length,
            text: contextMenu.selectedText,
            note: ''
          })
          setContextMenu(null)
        }}><Flag size={14} /><span><b>标记所选文字</b><small>{markerCanLocate ? '标记会显示在当前文案' : '先把这段选入当前文案'}</small></span></button> : null}
        {contextMenu.sourceKind === 'candidate' ? <button role="menuitem" onClick={() => { setExpandedCandidateId(contextMenu.sourceId); setContextMenu(null) }}><RotateCcw size={14} /><span><b>查看历史生成</b></span></button> : null}
        {contextMenu.paragraphId ? <details onToggle={(event) => placeContextSubmenu(event.currentTarget)}><summary><MoveRight size={14} /><span><b>移动到组…</b></span></summary><div>{groups.filter((target) => target.id !== group.id).map((target, targetIndex) => <button key={target.id} className={groupColors[targetIndex % groupColors.length]} onClick={() => {
          if (!contextMenu.paragraphId) return
          void run(async () => { await moveParagraphWithPair({ side: contextMenu.sourceKind === 'candidate' ? 'codex' : contextMenu.sourceKind, paragraphId: contextMenu.paragraphId!, fromGroupId: group.id, toGroupId: target.id }); setContextMenu(null) })
        }}><i />组{target.labelIndex}</button>)}</div></details> : null}
        {contextMenu.sourceKind !== 'candidate' && selectedParagraphIds.length ? <details onToggle={(event) => placeContextSubmenu(event.currentTarget)}><summary><Scissors size={14} /><span><b>拆分所选段落…</b><small>{splitScope === 'matched' ? 'Codex会自动找对侧对应段落' : '只拆当前侧'}</small></span></summary><div>
          <button onClick={() => void run(async () => { await onSplitSelection({ groupId: group.id, side: contextMenu.sourceKind as DraftComparisonSide, paragraphIds: selectedParagraphIds, strategy: 'original_order' }); setParagraphSelection(null); setContextMenu(null) })}>按原顺序拆分</button>
          <button onClick={() => void run(async () => { await onSplitSelection({ groupId: group.id, side: contextMenu.sourceKind as DraftComparisonSide, paragraphIds: selectedParagraphIds, strategy: 'extract_below' }); setParagraphSelection(null); setContextMenu(null) })}>提取到下方新组</button>
        </div></details> : null}
        <button role="menuitem" onClick={() => void run(async () => { await markGap(group); setContextMenu(null) })}><X size={14} /><span><b>两边都不满意</b></span></button>
        {contextMenu.sourceKind === 'candidate' ? <button className="danger" role="menuitem" onClick={() => {
          if (deleteConfirmCandidateId !== contextMenu.sourceId) { setDeleteConfirmCandidateId(contextMenu.sourceId); return }
          void run(async () => { await onDeleteCandidate(contextMenu.sourceId); setDeleteConfirmCandidateId(null); setContextMenu(null) })
        }}><Trash2 size={14} /><span><b>{deleteConfirmCandidateId === contextMenu.sourceId ? '再次点击确认删除' : '删除候选'}</b><small>{group.decision?.sourceIds.includes(contextMenu.sourceId) ? '已用于当前选择，请先改选' : '不会删除原稿'}</small></span></button> : null}
      </div>
    })() : null}
    {groupContextMenu ? (() => {
      const group = groups.find((item) => item.id === groupContextMenu.groupId)
      if (!group) return null
      const side = groupContextMenu.side
      const sideParagraphs = side ? side === 'claude' ? group.claudeParagraphs : group.codexParagraphs : []
      const sideContent = sideParagraphs.map((paragraph) => paragraph.text).join('\n\n')
      const splitParagraphIds = sideParagraphs.slice(0, Math.max(1, Math.ceil(sideParagraphs.length / 2))).map((paragraph) => paragraph.id)
      return <div className="comparison-context-menu compact" role="menu" style={{ left: groupContextMenu.x, top: groupContextMenu.y }}>
        {side ? <button role="menuitem" disabled={!codexReasoningAvailable || !sideContent.trim()} onClick={() => { setGroupContextMenu(null); beginRewrite({ groupId: group.id, parentCandidateId: null, x: groupContextMenu.x, y: groupContextMenu.y, selectedText: sideContent, selectionStart: 0, selectionEnd: sideContent.length, sourceKind: side, sourceId: side }) }}><MessageSquarePlus size={13} /><span><b>修改当前侧整组…</b><small>只处理{side === 'codex' ? 'Codex' : 'Claude'}这一侧</small></span></button> : null}
        {side && sideParagraphs.length > 1 ? <button role="menuitem" onClick={() => void run(async () => { await onSplitSelection({ groupId: group.id, side, paragraphIds: splitParagraphIds, strategy: 'original_order' }); setGroupContextMenu(null) })}><Scissors size={13} /><span><b>按段落拆分整组</b><small>{splitScope === 'matched' ? '自动匹配对侧后拆分' : '只拆当前侧'}</small></span></button> : null}
        <button role="menuitem" onClick={() => {
          setMergeMode(true)
          setSelectedGroups((current) => new Set(current).add(groupContextMenu.groupId))
          setGroupContextMenu(null)
        }}><Combine size={13} /><span><b>{mergeMode && selectedGroups.has(groupContextMenu.groupId) ? '已加入合并' : '加入合并'}</b><small>选择相邻组后再确认</small></span></button>
      </div>
    })() : null}
    {sourceReplacementPrompt ? <div className="comparison-full-rebuild-dialog" role="dialog" aria-label="确认替换手动文案">
      <b>这一组已经手动修改</b>
      <p>继续选用来源会替换这一组的手动正文。取消不会改变当前文案。</p>
      <footer>
        <button onClick={() => setSourceReplacementPrompt(null)}>取消</button>
        <button className="primary-action" onClick={() => {
          const prompt = sourceReplacementPrompt
          const group = groups.find((item) => item.id === prompt.groupId)
          setSourceReplacementPrompt(null)
          if (group) void run(async () => {
            await chooseSource(group, prompt.sourceId, undefined, true)
            if (prompt.insertIndex !== undefined) {
              const next = previewOrder.filter((id) => id !== prompt.groupId)
              next.splice(Math.max(0, Math.min(prompt.insertIndex, next.length)), 0, prompt.groupId)
              await persistPreviewOrder(next)
            }
          })
        }}>确认替换</button>
      </footer>
    </div> : null}
    {previewContextMenu ? (() => {
      const group = groups.find((item) => item.id === previewContextMenu.groupId)
      if (!group) return null
      return <div className="comparison-context-menu compact" role="menu" style={{ left: previewContextMenu.x, top: previewContextMenu.y }}>
        <button role="menuitem" disabled={!codexReasoningAvailable} onClick={() => beginRewrite({ groupId: group.id, parentCandidateId: null, x: previewContextMenu.x, y: previewContextMenu.y, selectedText: previewContextMenu.selectedText, selectionStart: previewContextMenu.selectionStart, selectionEnd: previewContextMenu.selectionEnd, sourceKind: 'current', sourceId: group.id })}><MessageSquarePlus size={13} /><span><b>按具体要求修改…</b><small>{previewContextMenu.selectedText ? '只改选中文字' : '修改这一组'}</small></span></button>
        <button role="menuitem" onClick={() => {
          const content = previewOverrides[group.id] ?? group.decision?.content ?? ''
          const text = previewContextMenu.selectedText || content
          const start = previewContextMenu.selectionStart ?? 0
          if (!text) return
          addFusionSelection({ groupId: group.id, sourceKind: 'current', sourceId: group.id, sourceLabel: '当前文案', selectedText: text, selectionStart: start, selectionEnd: start + text.length })
        }}><Combine size={13} /><span><b>加入综合候选</b></span></button>
        {previewContextMenu.selectedText && previewContextMenu.selectionStart !== undefined && previewContextMenu.selectionEnd !== undefined ? <button role="menuitem" onClick={() => {
          setMarkerComposer({ groupId: group.id, ...clampFloatingPosition(previewContextMenu.x, previewContextMenu.y, 238, 190), start: previewContextMenu.selectionStart!, end: previewContextMenu.selectionEnd!, text: previewContextMenu.selectedText!, note: '' })
          setPreviewContextMenu(null)
        }}><Flag size={13} /><span><b>添加标记</b><small>备注可留空</small></span></button> : null}
        <button role="menuitem" onClick={() => { setNoteComposer({ groupId: group.id, ...clampFloatingPosition(previewContextMenu.x, previewContextMenu.y, 238, 150), note: group.decision?.note ?? '' }); setPreviewContextMenu(null) }}><StickyNote size={13} /><span><b>{group.decision?.note ? '编辑备注' : '添加备注'}</b><small>不会写入文案</small></span></button>
        {group.decision?.note ? <button role="menuitem" onClick={() => void run(async () => { await onSetGroupNote(group.id, ''); setPreviewContextMenu(null) })}><X size={13} /><span><b>删除备注</b></span></button> : null}
        <button className="danger" role="menuitem" onClick={() => void run(async () => { await deletePreviewModule(group); setPreviewContextMenu(null) })}><Trash2 size={13} /><span><b>从当前文案删除</b><small>不会删除左侧来源</small></span></button>
      </div>
    })() : null}
    {noteComposer ? <div className="comparison-note-popover" role="dialog" aria-label="文案组备注" style={{ left: noteComposer.x, top: noteComposer.y }}><header><b>备注</b><button onClick={() => setNoteComposer(null)}><X size={11} /></button></header><textarea autoFocus value={noteComposer.note} maxLength={2_000} placeholder="只在工作台显示" onChange={(event) => setNoteComposer({ ...noteComposer, note: event.currentTarget.value })} /><footer><button onClick={() => setNoteComposer(null)}>取消</button><button className="primary-action" onClick={() => void run(async () => { await onSetGroupNote(noteComposer.groupId, noteComposer.note); setNoteComposer(null) })}>保存</button></footer></div> : null}
    {markerComposer ? <div className="comparison-marker-popover" role="dialog" aria-label="文案标记" style={{ left: markerComposer.x, top: markerComposer.y }}><header><b>添加标记</b><button onClick={() => setMarkerComposer(null)}><X size={11} /></button></header><p>{markerComposer.text}</p><input autoFocus value={markerComposer.note} maxLength={2_000} placeholder="备注（可不填）" onChange={(event) => setMarkerComposer({ ...markerComposer, note: event.currentTarget.value })} /><footer><button onClick={() => setMarkerComposer(null)}>取消</button><button className="primary-action" onClick={() => void run(addMarker)}>添加</button></footer></div> : null}
    {markerListGroupId ? (() => {
      const group = groups.find((item) => item.id === markerListGroupId)
      if (!group) return null
      return <div className="comparison-marker-list" role="dialog" aria-label={`组${group.labelIndex}标记`}><header><b>组{group.labelIndex}标记</b><button onClick={() => setMarkerListGroupId(null)}><X size={12} /></button></header>{group.decision?.markers.map((marker) => <button key={marker.id} onClick={() => { setMarkerListGroupId(null); scrollToGroup(group.id) }}><span>{marker.text}</span><small>{marker.note || '无备注'}{marker.status === 'position_changed' ? ' · 位置已变化' : ''}</small></button>)}{!group.decision?.markers.length ? <p>暂无标记</p> : null}</div>
    })() : null}
    {fusionSelections.length ? <aside className="comparison-fusion-basket" aria-label="综合候选选区">
      <header><div><b>综合候选</b><small>已冻结{new Set(fusionSelections.map(fusionSelectionSourceKey)).size}个来源·{fusionSelections.length}个范围，最多4来源</small></div><button aria-label="清空综合选区" onClick={() => setFusionSelections([])}><X size={13} /></button></header>
      <div>{fusionSelections.map((selection) => <span key={selection.id}><i>{selection.sourceLabel}</i>{selection.selectedText.slice(0, 32)}{selection.selectedText.length > 32 ? '…' : ''}<button aria-label={`移除${selection.sourceLabel}选区`} onClick={() => setFusionSelections((current) => current.filter((item) => item.id !== selection.id))}><X size={10} /></button></span>)}</div>
      <button className="primary-action" disabled={new Set(fusionSelections.map(fusionSelectionSourceKey)).size < 2 || !codexReasoningAvailable} onClick={() => setFusionRequestOpen(true)}><Combine size={13} />综合成统一候选…</button>
    </aside> : null}
    {fusionRequestOpen ? <RewriteRequestPanel
      anchor={workspaceRef.current}
      anchorPoint={{ x: Math.round(window.innerWidth / 2), y: Math.min(420, Math.round(window.innerHeight / 2)) }}
      selectionLabel={`${new Set(fusionSelections.map(fusionSelectionSourceKey)).size}个来源·${fusionSelections.length}个范围`}
      projectId={workspace.projectId}
      sessionScope={`draft-comparison:${workspace.projectId}:${workspace.activeSession?.id ?? 'working'}`}
      models={codexModels}
      initialModel={preferredCodexModel}
      initialReasoningEffort="xhigh"
      busy={busy || !codexReasoningAvailable}
      onDismiss={() => setFusionRequestOpen(false)}
      onSubmit={(request) => void run(() => submitFusionRewrite(request))}
    /> : null}
    {sourceAnnotationMenu ? <TextAnnotationMenu
      anchor={workspaceRef.current}
      anchorPoint={{ x: sourceAnnotationMenu.x, y: sourceAnnotationMenu.y }}
      note={sourceAnnotationMenu.note}
      onNoteChange={(note) => setSourceAnnotationMenu({ ...sourceAnnotationMenu, note })}
      onApply={(style, note) => void run(() => applySourceAnnotation(style, note))}
      onClear={() => void run(clearSourceAnnotations)}
      onDismiss={() => setSourceAnnotationMenu(null)}
    /> : null}
    {rewriteMenu ? <RewriteRequestPanel
      anchor={workspaceRef.current}
      anchorPoint={{ x: rewriteMenu.x, y: rewriteMenu.y }}
      selectionLabel={rewriteMenu.selectedText ? `所选${rewriteMenu.selectedText.length}字` : '当前内容组'}
      projectId={workspace.projectId}
      sessionScope={`draft-comparison:${workspace.projectId}:${workspace.activeSession?.id ?? 'working'}`}
      models={codexModels}
      initialModel={preferredCodexModel}
      initialReasoningEffort="xhigh"
      busy={busy || !codexReasoningAvailable}
      onDismiss={closeRewrite}
      onSubmit={(request) => void run(() => submitRewrite(request))}
    /> : null}
    <RewriteCandidateDialog
      candidate={rewriteResult ? {
        id: rewriteResult.candidate.id,
        originalText: rewriteResult.candidate.targetContent || rewriteResult.candidate.sourceSelections.map((selection) => selection.selectedText).join('\n\n') || groups.find((item) => item.id === rewriteResult.groupId)?.decision?.content || '',
        candidateText: rewriteResult.candidate.content,
        providerLabel: 'Codex',
        requestedModel: preferredCodexModel,
        actualModel: rewriteResult.candidate.model,
        actualReasoningEffort: rewriteResult.candidate.reasoningEffort,
        generationRound: rewriteResult.candidate.revisionRound,
        sourceSelections: rewriteResult.candidate.sourceSelections,
        conflicts: rewriteResult.candidate.conflicts,
        mode: new Set(rewriteResult.candidate.sourceSelections.map((selection) => `${selection.sourceKind}:${selection.sourceId}`)).size > 1 ? 'fusion' : 'rewrite',
        targetChanged: rewriteTargetChanged
      } : null}
      remainingCount={Math.max(0, rewriteResults.length - 1)}
      onClose={dismissRewriteResult}
      onContinue={continueRewriteResult}
      onAppend={() => void run(() => applyRewriteResult('append'))}
      onReplace={() => void run(() => applyRewriteResult('replace'))}
    />
  </section>
}

function ComparisonMobileTabs({ side, onChange }: { side: DraftComparisonSide; onChange(side: DraftComparisonSide): void }): React.JSX.Element {
  return <div className="comparison-mobile-tabs" role="tablist" aria-label="双稿窄窗选择">
    <button className={side === 'codex' ? 'active' : ''} role="tab" aria-selected={side === 'codex'} onClick={() => onChange('codex')}>Codex稿</button>
    <button className={side === 'claude' ? 'active' : ''} role="tab" aria-selected={side === 'claude'} onClick={() => onChange('claude')}>Claude稿</button>
  </div>
}

function AutoGrowTextarea({
  ariaLabel,
  value,
  clean,
  onChange,
  onBlur,
  onContextMenu
}: {
  ariaLabel: string
  value: string
  clean: boolean
  onChange(value: string): void
  onBlur(): void
  onContextMenu(event: React.MouseEvent<HTMLTextAreaElement>): void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback((): void => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.max(clean ? 28 : 42, element.scrollHeight)}px`
  }, [clean])
  useLayoutEffect(() => {
    resize()
    const frame = window.requestAnimationFrame(resize)
    return () => window.cancelAnimationFrame(frame)
  }, [value, clean, resize])
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let previousWidth = -1
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth
      if (Math.abs(width - previousWidth) < 0.5) return
      previousWidth = width
      resize()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [clean, resize])
  return <textarea
    ref={ref}
    className="comparison-preview-editor"
    aria-label={ariaLabel}
    value={value}
    rows={1}
    onChange={(event) => onChange(event.currentTarget.value)}
    onBlur={onBlur}
    onContextMenu={onContextMenu}
  />
}

function inlineMarkerStyle(content: string, start: number, index: number): React.CSSProperties {
  const safeStart = Math.max(0, Math.min(start, content.length))
  const before = content.slice(0, safeStart)
  const currentLine = before.slice(before.lastIndexOf('\n') + 1)
  const visualColumn = Array.from(currentLine).reduce((total, character) => total + (character.charCodeAt(0) <= 0xff ? 0.55 : 1), 0)
  const horizontal = 8 + ((visualColumn + index * 1.7) % 26) / 26 * 80
  const vertical = Math.max(0, Math.min(1, safeStart / Math.max(1, content.length)))
  return {
    '--marker-x': `${horizontal}%`,
    '--marker-position': `${vertical}`
  } as React.CSSProperties
}

function ComparisonSourceEditor({
  side,
  label,
  value,
  source,
  sourceStatus,
  updatedAt,
  task,
  requirement,
  placeholder,
  providerConfigId,
  providers,
  disabled,
  onChange,
  onRequirementChange,
  onProviderChange,
  onGenerate,
  onRetry,
  onBlur
}: {
  side: DraftComparisonSide
  label: string
  value: string
  source: DraftWorkingSource
  sourceStatus: string
  updatedAt: string | null
  task: TaskRun | null
  requirement: string
  placeholder: string
  providerConfigId: string
  providers: ProviderOption[]
  disabled: boolean
  onChange(value: string): void
  onRequirementChange(value: string): void
  onProviderChange(value: string): void
  onGenerate(): Promise<void>
  onRetry(taskId: string): Promise<void>
  onBlur(): void
}): React.JSX.Element {
  const generating = task && ['queued', 'running'].includes(task.status)
  return <section className="comparison-source-editor" data-comparison-side={side}>
    <header><div><span>{source.sourceKind === 'provider' ? 'AI工作稿' : '自由编辑'}</span><b>{label}</b></div><em title={updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : undefined}>{sourceStatus}{updatedAt ? ` · ${new Date(updatedAt).toLocaleString('zh-CN')}` : ''}</em></header>
    <textarea aria-label={`${label}编辑区`} value={value} maxLength={1_000_000} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} onBlur={onBlur} />
    <div className="comparison-source-generation">
      <textarea aria-label={`${label}整稿生成要求`} value={requirement} maxLength={30_000} placeholder="写整稿生成或完善要求" disabled={disabled || Boolean(generating)} onChange={(event) => onRequirementChange(event.currentTarget.value)} />
      <AppSelect aria-label={`${label}整稿生成AI`} value={providerConfigId} disabled={!providers.length || disabled || Boolean(generating)} onChange={(event) => onProviderChange(event.currentTarget.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</AppSelect>
      <button disabled={!requirement.trim() || !providers.length || disabled || Boolean(generating)} onMouseDown={(event) => event.preventDefault()} onClick={() => void onGenerate()}><Sparkles size={12} />{generating ? `生成中${task?.progress ?? 0}%` : value.trim() ? 'AI完善整稿' : 'AI生成整稿'}</button>
    </div>
    {task?.status === 'failed' ? <div className="comparison-task-state failed"><span>{task.errorMessage ?? '整稿生成失败'}</span><button onClick={() => void onRetry(task.id)}><RefreshCw size={11} />按原输入重试</button></div> : null}
  </section>
}

function ComparisonGroupSource({
  side,
  label,
  group,
  selected,
  selectedParagraphIds,
  onSelect,
  onParagraphSelect,
  onMoveParagraph,
  onContextMenu,
  onGroupContextMenu,
  annotations
}: {
  side: DraftComparisonSide
  label: string
  group: DraftAlignmentGroup
  selected: boolean
  selectedParagraphIds: Set<string>
  onSelect(): void
  onParagraphSelect(event: React.MouseEvent, groupId: string, side: DraftComparisonSide, paragraphId: string): void
  onMoveParagraph(input: { side: DraftComparisonSide; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }): void
  onContextMenu(event: React.MouseEvent, menu: Omit<ComparisonContextMenu, 'x' | 'y'>): void
  onGroupContextMenu(event: React.MouseEvent): void
  annotations: ScriptTextAnnotation[]
}): React.JSX.Element {
  const paragraphs = side === 'claude' ? group.claudeParagraphs : group.codexParagraphs
  const fullContent = paragraphs.map((paragraph) => paragraph.text).join('\n\n')
  return <section
    data-comparison-side={side}
    className={selected ? 'source-selected' : ''}
  >
    <header onContextMenu={onGroupContextMenu}>
      <button className={`comparison-select-circle${selected ? ' selected' : ''}`} aria-label={`${selected ? '取消选用' : '选用'}${label}`} aria-pressed={selected} onClick={onSelect}>{selected ? <Check size={11} /> : null}</button>
      <b>{label}</b>
      {fullContent ? <button
        type="button"
        className="comparison-drag-handle"
        draggable
        aria-label={`拖动${label}`}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-draft-preview-source', JSON.stringify({ groupId: group.id, sourceId: side, sourceKind: side, content: fullContent }))
        }}
      ><GripVertical size={11} /></button> : null}
    </header>
    {paragraphs.length ? paragraphs.map((paragraph, paragraphIndex) => <div
      className={`comparison-paragraph${selectedParagraphIds.has(paragraph.id) ? ' paragraph-selected' : ''}`}
      key={paragraph.id}
      onClick={(event) => onParagraphSelect(event, group.id, side, paragraph.id)}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-draft-paragraph')) event.preventDefault()
      }}
      onDrop={(event) => {
        const payload = event.dataTransfer.getData('application/x-draft-paragraph')
        if (!payload) return
        event.preventDefault()
        try {
          const input = JSON.parse(payload) as { side: DraftComparisonSide; paragraphId: string; fromGroupId: string }
          if (input.side === side) onMoveParagraph({ ...input, toGroupId: group.id, toIndex: paragraphIndex })
        } catch { /* 上层拖放仍可处理失效数据 */ }
      }}
      onContextMenu={(event) => onContextMenu(event, { groupId: group.id, sourceId: side, sourceKind: side, paragraphId: paragraph.id })}
    >
      <button
        type="button"
        className="comparison-paragraph-drag-handle"
        draggable
        aria-label={`拖动${label}段落${paragraphIndex + 1}`}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-draft-paragraph', JSON.stringify({ side, paragraphId: paragraph.id, fromGroupId: group.id }))
        }}
      ><GripVertical size={10} /></button>
      <ReadableMarkdown content={paragraph.text} manualMarks={sourceManualMarks(annotations, annotations[0]?.sourceId ?? '', paragraph.id)} />
    </div>) : <div className="comparison-source-empty">这一侧没有对应内容</div>}
  </section>
}
