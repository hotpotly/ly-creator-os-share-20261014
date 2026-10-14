import { RichTextFormattingToolbar as ScriptFormattingToolbar } from './RichTextFormattingToolbar'
import Underline from '@tiptap/extension-underline'
import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, Download, ExternalLink, FileInput, Flag, Highlighter, Maximize2, MoreHorizontal, Redo2, RefreshCw, Save, Send, Sparkles, Undo2, X } from 'lucide-react'
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode, type SetStateAction } from 'react'
import type {
  CodexWritingModelOption,
  ContentFactAnnotation,
  ContentFactEvidence,
  ContentTargetSnapshot,
  DraftAlignmentGroup,
  DraftComparisonColorMode,
  DraftComparisonDocumentMode,
  DraftComparisonSplitScope,
  DraftComparisonSplitStrategy,
  DraftComparisonHistoryEntry,
  DraftComparisonWorkspace as DraftComparisonWorkspaceRecord,
  DraftGroupDecisionKind,
  DraftComparisonSide,
  DraftVersion,
  ProviderSettings,
  ProjectDetail,
  ScriptRevisionConversation,
  ScriptRevisionMessage,
  ScriptRevisionProvider,
  ScriptRevisionSelectionSnapshot,
  ScriptMaterialDraft,
  ScriptMaterialMobileTab,
  ScriptMaterialScrollTops,
  ScriptConversationScrollTops,
  ScriptMaterialRewriteCandidate,
  ScriptTextAnnotation,
  ScriptMaterialWorkspace as ScriptMaterialWorkspaceRecord,
  ScriptWorkbenchSingleProvider,
  ScriptWorkbenchView,
  TaskRun,
  WorkbenchPreferences
} from '../../../shared/domain'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { messageTargetId } from '../../../shared/script-conversation'
import { richTextHtmlToPlainText, sourceContentToRichTextHtml, stripScriptWorkbenchAnnotations } from '../../../shared/script-version-content'
import { navigate, replaceRoute, type WorkbenchRequestedMode } from '../utils/router'
import { CandidateComparisonOverlay, ScriptConversationPane } from './ScriptConversationPane'
import { DraftComparisonWorkspace, type DraftComparisonCurrentDocumentApplyResult, type DraftComparisonSourceAnnotationProjection } from './DraftComparisonWorkspace'
import { FeishuHandoffDialog } from './FeishuHandoffDialog'
import { FreeformContentEditor } from './FreeformContentEditor'
import { markdownToReadableText } from './ReadableMarkdown'
import { ScriptVersionCompareView } from './ScriptVersionCompareView'
import {
  SCRIPT_MATERIAL_CANDIDATE_DRAG_MIME,
  SCRIPT_MATERIAL_DRAG_MIME,
  ScriptMaterialWorkspace,
  type ScriptMaterialCandidateDragPayload,
  type ScriptMaterialDragPayload,
  type ScriptMaterialRelationFocus
} from './ScriptMaterialWorkspace'
import { ScriptMaterialAuditControl } from './ScriptMaterialAuditControl'
import { ScriptMarker, ScriptMaterialRelation, ScriptTargetHighlight } from './ScriptDocumentMarks'
import { CurrentScriptEditorIdentity, ensureCurrentScriptEditorIdentity, setAuthoritativeCurrentScriptEditorContent, setCurrentScriptEditorOperationLocked } from '../features/script/current-document/CurrentScriptEditorIdentity'
import { CurrentScriptLifecycleDialogs } from '../features/script/current-document/CurrentScriptLifecycleDialogs'
import { canonicalCurrentScriptValue, projectCurrentScriptFactsToEditorDocument } from '../features/script/current-document/current-script-adapter'
import { useProjectCurrentScriptDocument } from '../features/script/current-document/useProjectCurrentScriptDocument'
import { SelectionActionMenu } from '../features/script/selection/SelectionActionMenu'
import { TextAnnotationMenu } from '../features/script/selection/TextAnnotationMenu'
import { RewriteRequestPanel } from '../features/script/selection/RewriteRequestPanel'
import { RewriteCandidateDialog } from '../features/script/selection/RewriteCandidateDialog'
import type { RewriteQuickIntent, RewriteRequest } from '../features/script/selection/selection-contract'
import { AiCountControl, ProjectContextToggle } from '../features/script/shared/ScriptRequestControls'
import { StructuredReferenceComposer } from '../features/script/shared/StructuredReferenceComposer'
import type { StructuredComposerSnapshot } from '../features/script/shared/structured-reference-composer-state'
import { buildStructuredInstructionPayload } from '../features/script/shared/structured-reference-request'

const providers: ScriptRevisionProvider[] = ['claude_cli', 'codex_cli']
type PendingComparisonRewrites = Record<string, { groupId: string }>
type DraftWorkbenchSurface = WorkbenchPreferences['workbenchDraftSurface']
type VersionWorkbenchSurface = WorkbenchPreferences['workbenchVersionSurface']
type ConversationWorkbenchTab = WorkbenchPreferences['workbenchConversationTab']
type VersionMobileSide = WorkbenchPreferences['workbenchVersionMobileSide']
type CurrentDocumentScrollSurface = 'conversation' | 'draft' | 'material' | 'version'

function readPendingComparisonRewrites(projectId: string): PendingComparisonRewrites {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(`comparison-pending-rewrites:${projectId}`) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, { groupId: string }] => (
          Boolean(entry[0])
          && Boolean(entry[1])
          && typeof entry[1] === 'object'
          && typeof (entry[1] as { groupId?: unknown }).groupId === 'string'
        ))
        .map(([taskId, value]) => [taskId, { groupId: value.groupId }])
    )
  } catch {
    return {}
  }
}

class DraftComparisonErrorBoundary extends Component<{ children: ReactNode; resetKey: string; onError(message: string): void }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  override componentDidUpdate(previousProps: Readonly<{ children: ReactNode; resetKey: string; onError(message: string): void }>): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Draft comparison render failed', error, info.componentStack)
    this.props.onError('成稿对比刚才出现异常，当前文案仍已保留。请重新打开成稿对比。')
  }
  override render(): ReactNode {
    if (this.state.failed) return <div className="comparison-safe-fallback"><b>成稿对比暂时没有显示</b><span>当前文案没有删除，可以立即重新载入这个区域。</span><button onClick={() => this.setState({ failed: false })}>重新显示成稿对比</button></div>
    return this.props.children
  }
}
const emptyConversation = (projectId: string, surface: ScriptRevisionConversation['surface'] = 'conversation'): ScriptRevisionConversation => ({
  projectId, surface, threadId: null, baseVersionId: null, baseVersionRevision: null, provider: null,
  providerFingerprint: null, providerThreadId: null, model: null, reasoningEffort: null,
  webSearchMode: 'automatic', messages: [], createdAt: null, updatedAt: null
})

const scriptMaterialRelationFocusKey = new PluginKey<ScriptMaterialRelationFocus | null>('scriptMaterialRelationFocus')

function materialRelationMatches(
  relationDraftId: string | null,
  relationDraftParagraphIds: string[],
  relationSourcePointIds: string[],
  focusDraftId: string | null | undefined,
  focusDraftParagraphIds: string[],
  focusSourcePointIds: string[]
): boolean {
  return Boolean(
    (focusDraftId && relationDraftId === focusDraftId
      && relationDraftParagraphIds.some((id) => focusDraftParagraphIds.includes(id)))
    || relationSourcePointIds.some((id) => focusSourcePointIds.includes(id))
  )
}

const ScriptMaterialRelationFocusDecorations = Extension.create({
  name: 'scriptMaterialRelationFocusDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin<ScriptMaterialRelationFocus | null>({
        key: scriptMaterialRelationFocusKey,
        state: {
          init: () => null,
          apply(transaction, previous) {
            const next = transaction.getMeta(scriptMaterialRelationFocusKey) as ScriptMaterialRelationFocus | null | undefined
            return next === undefined ? previous : next
          }
        },
        props: {
          decorations(state) {
            const focus = scriptMaterialRelationFocusKey.getState(state)
            if (!focus) return DecorationSet.empty
            const decorations: Decoration[] = []
            state.doc.descendants((node, position) => {
              if (!node.isText) return
              const relation = node.marks.find((mark) => mark.type.name === 'scriptMaterialRelation')
              if (!relation) return
              const relationDraftId = typeof relation.attrs.draftId === 'string' ? relation.attrs.draftId : null
              const relationDraftParagraphIds = typeof relation.attrs.draftParagraphIds === 'string'
                ? relation.attrs.draftParagraphIds.split(',').filter(Boolean)
                : []
              const relationSourcePointIds = typeof relation.attrs.sourcePointIds === 'string'
                ? relation.attrs.sourcePointIds.split(',').filter(Boolean)
                : []
              const liveDraftId = focus.liveDraftId === undefined ? focus.draftId : focus.liveDraftId
              const liveDraftParagraphIds = focus.liveDraftParagraphIds ?? focus.draftParagraphIds
              const liveSourcePointIds = focus.liveSourcePointIds ?? focus.sourcePointIds
              const live = materialRelationMatches(
                relationDraftId,
                relationDraftParagraphIds,
                relationSourcePointIds,
                liveDraftId,
                liveDraftParagraphIds,
                liveSourcePointIds
              )
              const pinned = materialRelationMatches(
                relationDraftId,
                relationDraftParagraphIds,
                relationSourcePointIds,
                focus.pinnedDraftId,
                focus.pinnedDraftParagraphIds ?? [],
                focus.pinnedSourcePointIds ?? []
              )
              if (!live && !pinned) return
              const classes = ['is-material-relation-active']
              if (live) classes.push('is-material-relation-live')
              if (pinned) classes.push('is-material-relation-pinned')
              decorations.push(Decoration.inline(position, position + node.nodeSize, {
                class: classes.join(' '),
                'data-script-material-focus-decoration': 'true'
              }))
            })
            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})

type RevisionSelection = Omit<ScriptRevisionSelectionSnapshot, 'baseVersionId' | 'selectionHash'>
type WorkbenchPrimaryView = 'conversation' | 'comparison' | 'versions'

interface PendingCurrentRewrite {
  taskId: string
  requestId: string
  selection: RevisionSelection
  requestedModel: string | null
  request: RewriteRequest
  applyTarget: { targetSelectionId: string | null; selectedText: string }
}

interface CurrentCandidateContinuation {
  pending: PendingCurrentRewrite
  message: ScriptRevisionMessage
}

interface ScriptMarkerRecord {
  id: string
  note: string
  text: string
  from: number
  to: number
}

function versionOf(project: ProjectDetail | null, kind: DraftVersion['kind']): DraftVersion | undefined {
  return project?.latestVersions.find((version) => version.documentType === 'script' && version.kind === kind)
}

function plainTextToHtml(value: string): string {
  return sourceContentToRichTextHtml(value)
}

function normalizedCurrentDocumentText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

function currentScriptTextBlockText(node: ProseMirrorNode): string {
  let text = ''
  node.descendants((child) => {
    if (child.isText) text += child.text ?? ''
    else if (child.type.name === 'hardBreak') text += '\n'
  })
  return text
}

function currentScriptDocumentTextBlocks(document: ProseMirrorNode): string[] {
  const blocks: string[] = []
  document.descendants((node) => {
    if (node.isTextblock) blocks.push(currentScriptTextBlockText(node))
  })
  return blocks
}

function applySafeDraftComparisonTextPatch(editor: Editor, content: string): boolean {
  const target = normalizedCurrentDocumentText(content)
  const current = normalizedCurrentDocumentText(currentScriptDocumentTextBlocks(editor.state.doc).join('\n\n'))
  if (target === current) return true
  const targetBlocks = target ? target.split('\n\n') : ['']
  const blocks: Array<{ node: ProseMirrorNode; position: number }> = []
  editor.state.doc.descendants((node, position) => {
    if (node.isTextblock) blocks.push({ node, position })
  })
  if (blocks.length !== targetBlocks.length) return false
  const currentBlocks = blocks.map((block) => currentScriptTextBlockText(block.node))
  const sortedCurrent = [...currentBlocks].sort()
  const sortedTarget = [...targetBlocks].sort()
  const isPureReorder = currentBlocks.some((content, index) => content !== targetBlocks[index])
    && sortedCurrent.every((content, index) => content === sortedTarget[index])
  if (isPureReorder) {
    const directTextBlocks = editor.state.doc.childCount === blocks.length
      && blocks.every((block, index) => editor.state.doc.child(index) === block.node)
    if (!directTextBlocks) return false
    const availableIndexes = new Map<string, number[]>()
    currentBlocks.forEach((text, index) => availableIndexes.set(text, [...(availableIndexes.get(text) ?? []), index]))
    const reordered = targetBlocks.map((text) => {
      const indexes = availableIndexes.get(text)
      const index = indexes?.shift()
      return index === undefined ? null : blocks[index]!.node
    })
    if (reordered.some((node) => !node)) return false
    const transaction = editor.state.tr.replaceWith(
      0,
      editor.state.doc.content.size,
      Fragment.fromArray(reordered as ProseMirrorNode[])
    )
    if (normalizedCurrentDocumentText(currentScriptDocumentTextBlocks(transaction.doc).join('\n\n')) !== target) return false
    editor.view.dispatch(transaction)
    return true
  }
  if (targetBlocks.some((content, index) => content !== currentBlocks[index] && currentBlocks.includes(content))) return false
  const changed = blocks.flatMap((block, index) => currentScriptTextBlockText(block.node) === targetBlocks[index]
    ? []
    : [{ ...block, content: targetBlocks[index] ?? '' }])
  if (!changed.length) return true
  for (const block of changed) {
    if (/<\s*\/?[a-z]|^(?:#{1,3}\s|\s*>\s?|\s*(?:[-*]|\d+\.)\s+)|\*\*|~~|`|\[[^\]]+\]\(https:\/\//m.test(block.content)) return false
    let containsMarks = block.node.marks.length > 0
    block.node.descendants((node) => {
      if (node.marks.length) containsMarks = true
    })
    if (containsMarks) return false
  }
  let transaction = editor.state.tr
  for (const block of changed.sort((left, right) => right.position - left.position)) {
    const from = block.position + 1
    const to = from + block.node.content.size
    if (!block.content) {
      transaction = transaction.delete(from, to)
      continue
    }
    const inlineNodes = block.content.split('\n').flatMap((line, index) => [
      ...(index ? [editor.schema.nodes.hardBreak!.create()] : []),
      ...(line ? [editor.schema.text(line)] : [])
    ])
    transaction = transaction.replaceWith(from, to, Fragment.fromArray(inlineNodes))
  }
  const projected = normalizedCurrentDocumentText(currentScriptDocumentTextBlocks(transaction.doc).join('\n\n'))
  if (projected !== target) return false
  editor.view.dispatch(transaction)
  return true
}

function exactRanges(editor: Editor, text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  let searchable = ''
  const positions: number[] = []
  let lastTextEnd: number | null = null
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return
    if (lastTextEnd !== null && position > lastTextEnd) { searchable += ' '; positions.push(position) }
    for (let index = 0; index < node.text.length; index += 1) { searchable += node.text[index]; positions.push(position + index) }
    lastTextEnd = position + node.text.length
  })
  let start = 0
  while (start <= searchable.length - text.length) {
    const index = searchable.indexOf(text, start)
    if (index < 0) break
    const from = positions[index]
    const last = positions[index + text.length - 1]
    if (from !== undefined && last !== undefined) ranges.push({ from, to: last + 1 })
    start = index + Math.max(1, text.length)
  }
  return ranges
}

function normalizedTextRangesInDocument(document: ProseMirrorNode, text: string): { from: number; to: number }[] {
  const searchableCharacters: string[] = []
  const positions: number[] = []
  let lastTextEnd: number | null = null
  const pushSpace = (position: number): void => {
    if (!searchableCharacters.length || searchableCharacters.at(-1) === ' ') return
    searchableCharacters.push(' ')
    positions.push(position)
  }
  document.descendants((node, position) => {
    if (!node.isText || !node.text) return
    if (lastTextEnd !== null && position > lastTextEnd) pushSpace(position)
    for (let index = 0; index < node.text.length; index += 1) {
      const character = node.text[index]!
      if (/\s/.test(character)) pushSpace(position + index)
      else {
        searchableCharacters.push(character)
        positions.push(position + index)
      }
    }
    lastTextEnd = position + node.text.length
  })
  const searchable = searchableCharacters.join('')
  const needle = text.replace(/\s+/g, ' ').trim()
  if (!needle) return []
  const ranges: { from: number; to: number }[] = []
  let cursor = 0
  while (cursor <= searchable.length - needle.length) {
    const index = searchable.indexOf(needle, cursor)
    if (index < 0) break
    const from = positions[index]
    const last = positions[index + needle.length - 1]
    if (from !== undefined && last !== undefined) ranges.push({ from, to: last + 1 })
    cursor = index + Math.max(1, needle.length)
  }
  return ranges
}

function normalizedTextRanges(editor: Editor, text: string): { from: number; to: number }[] {
  return normalizedTextRangesInDocument(editor.state.doc, text)
}

function addContentFactMarks(
  transaction: Transaction,
  container: { from: number; to: number },
  sourceText: string,
  annotations: ContentFactAnnotation[]
): void {
  annotations.forEach((annotation) => {
    const matches = normalizedTextRangesInDocument(transaction.doc, annotation.text)
      .filter((range) => range.from >= container.from && range.to <= container.to)
    let ordinal = 0
    let cursor = 0
    while (cursor < annotation.start) {
      const occurrence = sourceText.indexOf(annotation.text, cursor)
      if (occurrence < 0 || occurrence >= annotation.start) break
      ordinal += 1
      cursor = occurrence + Math.max(1, annotation.text.length)
    }
    const exactOffsets = sourceText.slice(annotation.start, annotation.end) === annotation.text
    const range = exactOffsets ? matches[ordinal] : matches.length === 1 ? matches[0] : undefined
    if (!range) return
    const markName = annotation.provenance === 'needs_confirmation' ? 'underline' : 'highlight'
    const markType = transaction.doc.type.schema.marks[markName]
    if (!markType) return
    const sourceLabel = annotation.webSources.length
      ? `；来源：${annotation.webSources.map((source) => source.title).join('、')}`
      : ''
    const notePrefix = annotation.provenance === 'needs_confirmation'
      ? '需要你补充'
      : annotation.provenance === 'web_supplement' ? '联网补充' : 'AI补写'
    transaction.addMark(range.from, range.to, markType.create({
      annotationId: `current-fact-${annotation.id}`.slice(0, 128),
      annotationNote: `${notePrefix}：${annotation.note}${sourceLabel}`,
      annotationBlockId: null,
      evidenceIdsJson: annotation.evidenceIds?.length ? JSON.stringify(annotation.evidenceIds) : null,
      ...(markName === 'highlight' ? {
        color: annotation.provenance === 'web_supplement' ? '#DCEBFF' : '#E7EFE8'
      } : {})
    }))
  })
}

function currentDocumentParagraphSnapshot(editor: Editor | null): Array<{ id: string; position: number; text: string }> {
  if (!editor) return []
  const paragraphs: Array<{ id: string; position: number; text: string }> = []
  editor.state.doc.descendants((node, position) => {
    if (!node.isTextblock || !node.textContent.trim()) return
    paragraphs.push({
      id: `current-${position}`,
      position: paragraphs.length,
      text: node.textContent.trim()
    })
  })
  return paragraphs
}

function targetRanges(editor: Editor, targetSelectionId: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, position) => {
    if (!node.isText) return
    if (node.marks.some((mark) => mark.type.name === 'highlight' && mark.attrs.targetSelectionId === targetSelectionId)) {
      const previous = ranges.at(-1)
      if (previous?.to === position) previous.to = position + node.nodeSize
      else ranges.push({ from: position, to: position + node.nodeSize })
    }
  })
  return ranges
}

function materialRelationRanges(editor: Editor, draftId: string, paragraphId: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, position) => {
    if (!node.isText) return
    const relation = node.marks.find((mark) => mark.type.name === 'scriptMaterialRelation'
      && mark.attrs.draftId === draftId
      && String(mark.attrs.draftParagraphIds ?? '').split(',').includes(paragraphId))
    if (!relation) return
    const previous = ranges.at(-1)
    if (previous?.to === position) previous.to = position + node.nodeSize
    else ranges.push({ from: position, to: position + node.nodeSize })
  })
  return ranges
}

function targetIdInSelection(editor: Editor, from: number, to: number): string | null {
  const targetIds = new Set<string>()
  const start = from === to ? Math.max(0, from - 1) : from
  const end = from === to ? Math.min(editor.state.doc.content.size, from + 1) : to
  editor.state.doc.nodesBetween(start, end, (node) => {
    if (!node.isText) return
    node.marks.forEach((mark) => {
      const targetId = mark.attrs.targetSelectionId
      if (mark.type.name === 'highlight' && typeof targetId === 'string' && targetId) targetIds.add(targetId)
    })
  })
  return targetIds.size === 1 ? Array.from(targetIds)[0] ?? null : null
}

export function ScriptWorkbench({ projectId, draftVersionId, requestedMode }: { projectId: string; draftVersionId?: string; requestedMode?: WorkbenchRequestedMode }): React.JSX.Element {
  const workspaceLoadKey = `${projectId}:${draftVersionId ?? ''}:${requestedMode ?? ''}`
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const tasks = useWorkspaceStore((state) => state.snapshot.tasks)
  const providerCapabilities = useWorkspaceStore((state) => state.snapshot.providerCapabilities)
  const refreshWorkspace = useWorkspaceStore((state) => state.refresh)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [conversations, setConversations] = useState<Record<ScriptRevisionProvider, ScriptRevisionConversation>>({ claude_cli: emptyConversation(projectId), codex_cli: emptyConversation(projectId) })
  const [versionCodexConversation, setVersionCodexConversation] = useState<ScriptRevisionConversation>(() => emptyConversation(projectId, 'version_compare'))
  const [loading, setLoading] = useState(true)
  const [workspaceLoadError, setWorkspaceLoadError] = useState('')
  const [conversationLoading, setConversationLoading] = useState(true)
  const [notice, setNotice] = useState(() => {
    const key = `workbench-pending-notice:${projectId}`
    const pending = window.sessionStorage.getItem(key) ?? ''
    window.sessionStorage.removeItem(key)
    return pending
  })
  const [primaryView, setPrimaryView] = useState<WorkbenchPrimaryView>(preferences.workbenchPrimaryView)
  const [draftSurface, setDraftSurface] = useState<DraftWorkbenchSurface>(preferences.workbenchDraftSurface)
  const [versionSurface, setVersionSurface] = useState<VersionWorkbenchSurface>(preferences.workbenchVersionSurface)
  const [conversationTab, setConversationTab] = useState<ConversationWorkbenchTab>(preferences.workbenchConversationTab)
  const [hiddenProviders, setHiddenProviders] = useState<ScriptWorkbenchSingleProvider[]>(preferences.workbenchHiddenProviders)
  const [conversationScrollTops, setConversationScrollTops] = useState<ScriptConversationScrollTops>(preferences.workbenchConversationScrollTops)
  const [workbenchView, setWorkbenchView] = useState<ScriptWorkbenchView>(preferences.workbenchView)
  const [singleProvider, setSingleProvider] = useState<ScriptWorkbenchSingleProvider>(preferences.workbenchSingleProvider)
  const [comparisonWorkspace, setComparisonWorkspace] = useState<DraftComparisonWorkspaceRecord | null>(null)
  const pendingComparisonRewritesKey = `comparison-pending-rewrites:${projectId}`
  const [comparisonPendingRewrites, setComparisonPendingRewrites] = useState<PendingComparisonRewrites>(() => readPendingComparisonRewrites(projectId))
  const setPersistedComparisonPendingRewrites = useCallback((action: SetStateAction<PendingComparisonRewrites>): void => {
    const current = readPendingComparisonRewrites(projectId)
    const next = typeof action === 'function' ? action(current) : action
    window.sessionStorage.setItem(pendingComparisonRewritesKey, JSON.stringify(next))
    setComparisonPendingRewrites(next)
  }, [pendingComparisonRewritesKey, projectId])
  const [materialWorkspace, setMaterialWorkspace] = useState<ScriptMaterialWorkspaceRecord | null>(null)
  const [comparisonKind, setComparisonKind] = useState<'drafts' | 'materials'>(preferences.workbenchComparisonKind)
  const [materialMobileTab, setMaterialMobileTab] = useState<ScriptMaterialMobileTab>(preferences.workbenchMaterialTab)
  const [materialScrollTops, setMaterialScrollTops] = useState<ScriptMaterialScrollTops>(preferences.workbenchMaterialScrollTops)
  const [versionMobileSide, setVersionMobileSide] = useState<VersionMobileSide>(preferences.workbenchVersionMobileSide)
  const [versionSourcePanelOpen, setVersionSourcePanelOpen] = useState(preferences.workbenchVersionSourcePanelOpen)
  const [versionDiffVisible, setVersionDiffVisible] = useState(preferences.workbenchVersionDiffVisible)
  const [versionScrollTops, setVersionScrollTops] = useState(preferences.workbenchVersionScrollTops)
  const [draftCurrentScrollTop, setDraftCurrentScrollTop] = useState(preferences.workbenchDraftCurrentScrollTop)
  const [versionCurrentScrollTop, setVersionCurrentScrollTop] = useState(preferences.workbenchVersionCurrentScrollTop)
  const [codexModels, setCodexModels] = useState<CodexWritingModelOption[]>([])
  const [resolvedWorkspaceLoadKey, setResolvedWorkspaceLoadKey] = useState('')
  const [preferredCodexModel, setPreferredCodexModel] = useState<string | null>(preferences.workbenchCodexModel)
  const [comparisonHistory, setComparisonHistory] = useState<DraftComparisonHistoryEntry[]>([])
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null)
  const [claudeFreeformContent, setClaudeFreeformContent] = useState('')
  const [claudePaneMode, setClaudePaneMode] = useState<'freeform' | 'ai'>('freeform')
  const [comparisonUndoHtml, setComparisonUndoHtml] = useState<string | null>(null)
  const [modelSplit, setModelSplit] = useState(preferences.workbenchModelSplit)
  const [documentSplit, setDocumentSplit] = useState(preferences.workbenchMergedSplit)
  const [comparisonSide, setComparisonSide] = useState<DraftComparisonSide>(preferences.workbenchComparisonSide)
  const [comparisonSplit, setComparisonSplit] = useState(preferences.workbenchComparisonSplit)
  const [comparisonPreviewSplit, setComparisonPreviewSplit] = useState(preferences.workbenchComparisonPreviewSplit)
  const [comparisonScrollTop, setComparisonScrollTop] = useState(preferences.workbenchComparisonScrollTop)
  const [comparisonColorMode, setComparisonColorMode] = useState<DraftComparisonColorMode>(preferences.workbenchComparisonColorMode)
  const [comparisonDocumentMode, setComparisonDocumentMode] = useState<DraftComparisonDocumentMode>(preferences.workbenchComparisonDocumentMode)
  const [comparisonSplitScope, setComparisonSplitScope] = useState<DraftComparisonSplitScope>(preferences.workbenchComparisonSplitScope)
  const [comparisonUseOutline, setComparisonUseOutline] = useState(preferences.workbenchComparisonUseOutline)
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false)
  const [versionName, setVersionName] = useState('')
  const [markers, setMarkers] = useState<ScriptMarkerRecord[]>([])
  const [markerListOpen, setMarkerListOpen] = useState(false)
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number; from: number; to: number } | null>(null)
  const [editorSelectionStage, setEditorSelectionStage] = useState<'actions' | 'rewrite' | 'annotation'>('actions')
  const [editorAnnotationNote, setEditorAnnotationNote] = useState('')
  const [factEvidencePopover, setFactEvidencePopover] = useState<{ x: number; y: number; items: ContentFactEvidence[] } | null>(null)
  const [pendingCurrentRewrites, setPendingCurrentRewrites] = useState<PendingCurrentRewrite[]>([])
  const [activeCurrentRewriteTaskId, setActiveCurrentRewriteTaskId] = useState<string | null>(null)
  const [currentCandidateContinuation, setCurrentCandidateContinuation] = useState<CurrentCandidateContinuation | null>(null)
  const [markerComposer, setMarkerComposer] = useState<{ x: number; y: number; from: number; to: number; note: string } | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [feishuOpen, setFeishuOpen] = useState(false)
  const [includeProjectContext, setIncludeProjectContext] = useState(false)
  const [saving, setSaving] = useState(false)
  const [versionRestoreBusy, setVersionRestoreBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [composerMessage, setComposerMessage] = useState('')
  const [sendTargets, setSendTargets] = useState<Set<ScriptRevisionProvider>>(new Set(providers))
  const [revisionSelection, setRevisionSelection] = useState<RevisionSelection | null>(null)
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null)
  const [activeConversationProvider, setActiveConversationProvider] = useState<ScriptRevisionProvider>('codex_cli')
  const [locatorProvider, setLocatorProvider] = useState<ScriptRevisionProvider | null>(null)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set())
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [appliedRevisionMessageId, setAppliedRevisionMessageId] = useState<string | null>(null)
  const [currentDocumentVersion, setCurrentDocumentVersion] = useState(0)
  const [materialCurrentContentHash, setMaterialCurrentContentHash] = useState<string | null>(null)
  const [historicalMaterialSnapshotAvailable, setHistoricalMaterialSnapshotAvailable] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [materialRelationFocus, setMaterialRelationFocus] = useState<ScriptMaterialRelationFocus | null>(null)
  const [materialDropActive, setMaterialDropActive] = useState(false)
  const [isWorkbenchNarrow, setIsWorkbenchNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches)
  const layoutRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'models' | 'document' | null>(null)
  const appliedInitialMaterialMappings = useRef(new Set<string>())
  const materialWorkspaceLoadId = useRef(0)
  const workbenchLoadId = useRef(0)
  const pendingCurrentScriptRestoreInFlight = useRef(false)
  const savingRef = useRef(false)
  const versionRestoreBusyRef = useRef(false)
  const currentEditorScrollRef = useRef<HTMLDivElement>(null)
  const currentEditorScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentEditorPendingScrollRef = useRef<{ projectId: string; surface: CurrentDocumentScrollSurface; value: number } | null>(null)
  const currentDocumentScrollContextRef = useRef('')
  const currentProjectIdRef = useRef(projectId)
  const materialScrollTopsRef = useRef(materialScrollTops)
  const versionScrollTopsRef = useRef(versionScrollTops)
  const conversationScrollTopsRef = useRef(conversationScrollTops)
  const draftCurrentScrollTopRef = useRef(draftCurrentScrollTop)
  const versionCurrentScrollTopRef = useRef(versionCurrentScrollTop)
  useEffect(() => { materialScrollTopsRef.current = materialScrollTops }, [materialScrollTops])
  useEffect(() => { versionScrollTopsRef.current = versionScrollTops }, [versionScrollTops])
  useEffect(() => { conversationScrollTopsRef.current = conversationScrollTops }, [conversationScrollTops])
  useEffect(() => { draftCurrentScrollTopRef.current = draftCurrentScrollTop }, [draftCurrentScrollTop])
  useEffect(() => { versionCurrentScrollTopRef.current = versionCurrentScrollTop }, [versionCurrentScrollTop])
  const flushCurrentEditorScroll = (): void => {
    if (currentEditorScrollTimerRef.current) clearTimeout(currentEditorScrollTimerRef.current)
    currentEditorScrollTimerRef.current = null
    const pending = currentEditorPendingScrollRef.current
    currentEditorPendingScrollRef.current = null
    if (!pending) return
    if (pending.surface === 'conversation') {
      const next = { ...conversationScrollTopsRef.current, current: pending.value }
      conversationScrollTopsRef.current = next
      setConversationScrollTops(next)
      void window.creatorOS?.setWorkbenchPreferences(pending.projectId, { workbenchConversationScrollTops: next })
    } else if (pending.surface === 'draft') {
      draftCurrentScrollTopRef.current = pending.value
      setDraftCurrentScrollTop(pending.value)
      void window.creatorOS?.setWorkbenchPreferences(pending.projectId, { workbenchDraftCurrentScrollTop: pending.value })
    } else if (pending.surface === 'version') {
      versionCurrentScrollTopRef.current = pending.value
      setVersionCurrentScrollTop(pending.value)
      void window.creatorOS?.setWorkbenchPreferences(pending.projectId, { workbenchVersionCurrentScrollTop: pending.value })
    } else {
      const next = { ...materialScrollTopsRef.current, current: pending.value }
      materialScrollTopsRef.current = next
      setMaterialScrollTops(next)
      void window.creatorOS?.setWorkbenchPreferences(pending.projectId, { workbenchMaterialScrollTops: next })
    }
  }
  useEffect(() => {
    const previousProjectId = currentProjectIdRef.current
    if (previousProjectId !== projectId) flushCurrentEditorScroll()
    currentProjectIdRef.current = projectId
  }, [projectId])
  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, horizontalRule: false }),
    Underline,
    ScriptTargetHighlight.configure({ multicolor: true }),
    ScriptMarker,
    ScriptMaterialRelation,
    CurrentScriptEditorIdentity,
    ScriptMaterialRelationFocusDecorations
  ], [])
  const editor = useEditor({ extensions, content: '', editable: true, immediatelyRender: false })
  const currentScript = useProjectCurrentScriptDocument({
    projectId,
    editor,
    enabled: !draftVersionId && resolvedWorkspaceLoadKey === workspaceLoadKey,
    materialWorkspace
  })

  const requestedScriptVersion = draftVersionId ? project?.versions.find((version) => version.id === draftVersionId && version.documentType === 'script') : undefined
  const currentScriptVersion = requestedScriptVersion ?? versionOf(project, 'merged_draft') ?? versionOf(project, 'external_draft') ?? null
  const finalScriptVersion = project?.versions.find((version) => version.documentType === 'script' && version.isFinal) ?? null
  const materialSnapshotReadOnly = Boolean(draftVersionId)
  const currentScriptEditorEditable = !materialSnapshotReadOnly && !saving && !versionRestoreBusy && currentScript.phase === 'ready' && currentScript.saveState !== 'conflict' && currentScript.recoveryCandidates.length === 0
  const requireCurrentScriptEditorEditable = (): boolean => {
    if (currentScriptEditorEditable && !savingRef.current && editor?.isEditable) return true
    setNotice(materialSnapshotReadOnly
      ? '这是历史版本的冻结工作台；请先恢复为新的当前版本再修改。'
      : versionRestoreBusy
        ? '正在恢复版本，为避免覆盖新输入，当前文案已暂时锁定。'
        : '当前文案正在保存或等待处理冲突，请稍候。')
    return false
  }
  const selectedMaterialDraftId = materialWorkspace?.selectedAiSide === 'claude'
    ? materialWorkspace.selectedClaudeDraftId
    : materialWorkspace?.selectedCodexDraftId
  const selectedMaterialDraft = materialWorkspace?.drafts.find((draft) => draft.id === selectedMaterialDraftId)
    ?? materialWorkspace?.drafts.filter((draft) => draft.side === materialWorkspace.selectedAiSide).at(-1)
    ?? null
  const taskSignature = tasks.filter((task) => ['script_revision', 'script_material_extract', 'script_material_generate', 'script_material_chat', 'script_material_map', 'script_material_audit', 'draft_source_generation', 'draft_alignment', 'draft_split_match', 'draft_candidate'].includes(task.taskType)).map((task) => `${task.id}:${task.status}`).join('|')
  const anchorWorkbenchViewport = (): void => {
    window.requestAnimationFrame(() => {
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      document.querySelectorAll<HTMLElement>('.page').forEach((page) => {
        page.scrollTop = 0
        page.scrollLeft = 0
      })
    })
  }

  const loadDraftComparison = async (sessionId?: string | null): Promise<void> => {
    if (!window.creatorOS) return
    const next = await window.creatorOS.getDraftComparisonWorkspace(projectId, sessionId)
    setComparisonWorkspace(next)
    setClaudeFreeformContent(next.claudeContent)
  }

  const loadScriptMaterial = async (): Promise<void> => {
    if (!window.creatorOS) return
    const loadId = ++materialWorkspaceLoadId.current
    const historical = draftVersionId
      ? await window.creatorOS.getScriptMaterialVersionSnapshot(projectId, draftVersionId)
      : null
    const next = historical?.workspace ?? await window.creatorOS.getScriptMaterialWorkspace(projectId)
    if (loadId !== materialWorkspaceLoadId.current) return
    setHistoricalMaterialSnapshotAvailable(Boolean(historical))
    setMaterialWorkspace(next)
  }

  const applyMaterialWorkspace = (next: ScriptMaterialWorkspaceRecord): void => {
    materialWorkspaceLoadId.current += 1
    setMaterialWorkspace(next)
  }

  const loadConversations = async (expectedLoadId = workbenchLoadId.current): Promise<void> => {
    if (!window.creatorOS) return
    setConversationLoading(true)
    try {
      const [claude, codex, versionCodex] = await Promise.all([
        window.creatorOS.getScriptRevisionConversation(projectId, null, 'claude_cli'),
        window.creatorOS.getScriptRevisionConversation(projectId, null, 'codex_cli'),
        window.creatorOS.getScriptRevisionConversation(projectId, null, 'codex_cli', 'version_compare')
      ])
      if (expectedLoadId !== workbenchLoadId.current) return
      setConversations({ claude_cli: claude, codex_cli: codex })
      setVersionCodexConversation(versionCodex)
    } catch (reason) { if (expectedLoadId === workbenchLoadId.current) setNotice(reason instanceof Error ? reason.message : 'AI对话读取失败') }
    finally { if (expectedLoadId === workbenchLoadId.current) setConversationLoading(false) }
  }

  const load = async (): Promise<void> => {
    if (!editor) return
    if (!window.creatorOS) {
      setLoading(false)
      setWorkspaceLoadError('文案工作台需要在App中打开')
      setNotice('文案工作台需要在App中打开')
      return
    }
    const materialLoadId = ++materialWorkspaceLoadId.current
    const expectedLoadId = ++workbenchLoadId.current
    setLoading(true)
    setWorkspaceLoadError('')
    try {
      const [next, projectPreferences, draftComparison, scriptMaterial, nextProviderSettings, materialVersionSnapshot, frozenCurrentScriptVersion] = await Promise.all([
        window.creatorOS.getProject(projectId),
        window.creatorOS.getWorkbenchPreferences(projectId),
        window.creatorOS.getDraftComparisonWorkspace(projectId),
        window.creatorOS.getScriptMaterialWorkspace(projectId),
        window.creatorOS.getProviderSettings(),
        draftVersionId ? window.creatorOS.getScriptMaterialVersionSnapshot(projectId, draftVersionId) : Promise.resolve(null),
        draftVersionId ? window.creatorOS.getCurrentScriptVersionSnapshot(projectId, draftVersionId) : Promise.resolve(null)
      ])
      if (expectedLoadId !== workbenchLoadId.current) return
      setProject(next)
      setModelSplit(projectPreferences.workbenchModelSplit)
      setDocumentSplit(projectPreferences.workbenchMergedSplit)
      const requestedPrimaryView: WorkbenchPrimaryView = requestedMode === 'versions'
        ? 'versions'
        : requestedMode === 'comparison' || requestedMode === 'drafts' || requestedMode === 'materials'
          ? 'comparison'
          : requestedMode === 'conversation'
            ? 'conversation'
            : projectPreferences.workbenchPrimaryView
      const requestedWorkbenchView: ScriptWorkbenchView = projectPreferences.workbenchView === 'single' || projectPreferences.workbenchView === 'dual'
        ? projectPreferences.workbenchView
        : 'dual'
      const requestedComparisonKind = requestedMode === 'drafts'
        ? 'drafts'
        : requestedMode === 'materials'
          ? 'materials'
          : projectPreferences.workbenchComparisonKind
      setWorkbenchView(requestedWorkbenchView)
      setPrimaryView(requestedPrimaryView)
      setComparisonKind(requestedComparisonKind)
      setDraftSurface(projectPreferences.workbenchDraftSurface)
      setVersionSurface(projectPreferences.workbenchVersionSurface)
      setMaterialMobileTab(projectPreferences.workbenchMaterialTab)
      setMaterialScrollTops(projectPreferences.workbenchMaterialScrollTops)
      setVersionMobileSide(projectPreferences.workbenchVersionMobileSide)
      setVersionSourcePanelOpen(projectPreferences.workbenchVersionSourcePanelOpen)
      setVersionDiffVisible(projectPreferences.workbenchVersionDiffVisible)
      setVersionScrollTops(projectPreferences.workbenchVersionScrollTops)
      setConversationScrollTops(projectPreferences.workbenchConversationScrollTops)
      setDraftCurrentScrollTop(projectPreferences.workbenchDraftCurrentScrollTop)
      setVersionCurrentScrollTop(projectPreferences.workbenchVersionCurrentScrollTop)
      if (requestedMode) {
        void window.creatorOS.setWorkbenchPreferences(projectId, {
          workbenchPrimaryView: requestedPrimaryView,
          workbenchView: requestedWorkbenchView,
          workbenchComparisonKind: requestedComparisonKind
        })
      }
      setPreferredCodexModel(projectPreferences.workbenchCodexModel)
      setSingleProvider(projectPreferences.workbenchSingleProvider)
      setConversationTab(projectPreferences.workbenchConversationTab)
      setHiddenProviders(projectPreferences.workbenchHiddenProviders)
      setActiveConversationProvider(projectPreferences.workbenchDualActiveProvider === 'claude' ? 'claude_cli' : 'codex_cli')
      setComparisonSide(projectPreferences.workbenchComparisonSide)
      setComparisonSplit(projectPreferences.workbenchComparisonSplit)
      setComparisonPreviewSplit(projectPreferences.workbenchComparisonPreviewSplit)
      setComparisonScrollTop(projectPreferences.workbenchComparisonScrollTop)
      setComparisonColorMode(projectPreferences.workbenchComparisonColorMode)
      setComparisonDocumentMode(projectPreferences.workbenchComparisonDocumentMode)
      setComparisonSplitScope(projectPreferences.workbenchComparisonSplitScope)
      setComparisonUseOutline(projectPreferences.workbenchComparisonUseOutline)
      setComparisonWorkspace(draftComparison)
      if (materialLoadId === materialWorkspaceLoadId.current) {
        setHistoricalMaterialSnapshotAvailable(Boolean(materialVersionSnapshot))
        setMaterialWorkspace(materialVersionSnapshot?.workspace ?? scriptMaterial)
      }
      setProviderSettings(nextProviderSettings)
      setClaudeFreeformContent(draftComparison.claudeContent)
      const requested = draftVersionId ? next.versions.find((version) => version.id === draftVersionId && version.documentType === 'script') : undefined
      const current = requested ?? versionOf(next, 'merged_draft') ?? versionOf(next, 'external_draft')
      if (draftVersionId) {
        setAuthoritativeCurrentScriptEditorContent(editor, frozenCurrentScriptVersion
          ? projectCurrentScriptFactsToEditorDocument(frozenCurrentScriptVersion)
          : sourceContentToRichTextHtml(current?.workspaceContent ?? current?.content ?? ''))
      }
      setRevisionSelection(null)
      setActiveTargetId(null)
      anchorWorkbenchViewport()
      await loadConversations(expectedLoadId)
      if (expectedLoadId !== workbenchLoadId.current) return
      setResolvedWorkspaceLoadKey(workspaceLoadKey)
    } catch (reason) {
      if (expectedLoadId === workbenchLoadId.current) {
        const message = reason instanceof Error ? reason.message : '文案工作台加载失败'
        setWorkspaceLoadError(message)
        setNotice(message)
      }
    }
    finally { if (expectedLoadId === workbenchLoadId.current) setLoading(false) }
  }

  useEffect(() => {
    workbenchLoadId.current += 1
    setProject(null)
    setLoading(true)
    setWorkspaceLoadError('')
    setImmersive(false)
    setMaterialRelationFocus(null)
    appliedInitialMaterialMappings.current.clear()
    setIncludeProjectContext(false)
    setComposerMessage('')
    setRevisionSelection(null)
    setActiveTargetId(null)
    setActiveConversationProvider('codex_cli')
    setPrimaryView('conversation')
    setLocatorProvider(null)
    setSelectedCandidateIds(new Set())
    setComparisonOpen(false)
    setAppliedRevisionMessageId(null)
    setComparisonWorkspace(null)
    setPersistedComparisonPendingRewrites(readPendingComparisonRewrites(projectId))
    materialWorkspaceLoadId.current += 1
    setMaterialWorkspace(null)
    setComparisonKind('drafts')
    setCodexModels([])
    setResolvedWorkspaceLoadKey('')
    setComparisonHistory([])
    setProviderSettings(null)
    setClaudeFreeformContent('')
    setComparisonUndoHtml(null)
    setVersionName('')
    versionRestoreBusyRef.current = false
    setVersionRestoreBusy(false)
    setMarkers([])
    setMaterialCurrentContentHash(null)
    setHistoricalMaterialSnapshotAvailable(false)
    setMarkerListOpen(false)
    setEditorContextMenu(null)
    setEditorSelectionStage('actions')
    setEditorAnnotationNote('')
    setPendingCurrentRewrites([])
    setActiveCurrentRewriteTaskId(null)
    setMarkerComposer(null)
    setConversations({ claude_cli: emptyConversation(projectId), codex_cli: emptyConversation(projectId) })
    setVersionCodexConversation(emptyConversation(projectId, 'version_compare'))
  }, [projectId, draftVersionId, editor, requestedMode, setPersistedComparisonPendingRewrites])
  useEffect(() => {
    editor?.setEditable(currentScriptEditorEditable)
    if (editor) setCurrentScriptEditorOperationLocked(editor, !currentScriptEditorEditable)
    if (!materialSnapshotReadOnly) return
    setPrimaryView('comparison')
    setComparisonKind('materials')
    setFormatToolbarOpen(false)
    setEditorContextMenu(null)
    setEditorSelectionStage('actions')
    setMarkerComposer(null)
  }, [currentScriptEditorEditable, editor, loading, materialSnapshotReadOnly])
  useEffect(() => {
    if (!currentScript.authoritativeEpoch) return
    setComparisonUndoHtml(null)
    setRevisionSelection(null)
    setActiveTargetId(null)
    setEditorContextMenu(null)
    setEditorSelectionStage('actions')
    setMarkerComposer(null)
    setMarkerListOpen(false)
    setMaterialRelationFocus(null)
  }, [currentScript.authoritativeEpoch])
  useEffect(() => {
    if (preferences.lastProjectModuleById[projectId] === 'script') return
    void setPreferences({
      lastProjectModuleById: { ...preferences.lastProjectModuleById, [projectId]: 'script' }
    })
  }, [preferences.lastProjectModuleById, projectId, setPreferences])
  useEffect(() => { if (editor) void load() }, [projectId, draftVersionId, editor, requestedMode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)')
    const update = (): void => setIsWorkbenchNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const currentDocumentScrollSurface: CurrentDocumentScrollSurface = primaryView === 'conversation'
    ? 'conversation'
    : primaryView === 'versions'
      ? 'version'
      : comparisonKind === 'materials' ? 'material' : 'draft'
  const currentDocumentScrollContext = `${currentDocumentScrollSurface}:${conversationTab}:${draftSurface}:${materialMobileTab}:${versionSurface}`
  useEffect(() => {
    if (currentDocumentScrollContextRef.current && currentDocumentScrollContextRef.current !== currentDocumentScrollContext) flushCurrentEditorScroll()
    currentDocumentScrollContextRef.current = currentDocumentScrollContext
    const saved = currentDocumentScrollSurface === 'conversation'
      ? conversationScrollTopsRef.current.current
      : currentDocumentScrollSurface === 'draft'
        ? draftCurrentScrollTopRef.current
        : currentDocumentScrollSurface === 'version'
          ? versionCurrentScrollTopRef.current
          : materialScrollTopsRef.current.current
    const frame = window.requestAnimationFrame(() => {
      const target = currentEditorScrollRef.current
      if (target && Math.abs(target.scrollTop - saved) > 2) target.scrollTop = saved
    })
    return () => window.cancelAnimationFrame(frame)
  }, [conversationScrollTops, currentDocumentScrollContext, currentDocumentScrollSurface, draftCurrentScrollTop, materialScrollTops, versionCurrentScrollTop])
  useEffect(() => () => { flushCurrentEditorScroll() }, [])
  useEffect(() => {
    const api = window.creatorOS
    if (!api || draftVersionId || !editor || currentScript.phase !== 'ready' || currentScript.recoveryCandidates.length || workspaceLoadError || pendingCurrentScriptRestoreInFlight.current) return
    const key = `workbench-pending-current-script-restore:${projectId}`
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return
    let pending: { content: string; displayName?: string; versionId?: string } | null = null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { content?: unknown }).content === 'string') {
        pending = parsed as { content: string; displayName?: string; versionId?: string }
      }
    } catch {
      pending = null
    }
    window.sessionStorage.removeItem(key)
    if (!pending) {
      setNotice('待恢复的历史文案无法读取，当前文案未改动。')
      return
    }
    pendingCurrentScriptRestoreInFlight.current = true
    savingRef.current = true
    setCurrentScriptEditorOperationLocked(editor, true)
    setSaving(true)
    void (async () => {
      const frozen = pending?.versionId
        ? await api.getCurrentScriptVersionSnapshot(projectId, pending.versionId)
        : null
      const restored = await currentScript.restoreVersion({
        ...(frozen ? { snapshot: frozen } : { content: pending?.content ?? '' }),
        sourceVersionId: pending?.versionId ?? null,
        displayName: pending?.displayName
      })
      if (restored?.materialWorkspace) applyMaterialWorkspace(restored.materialWorkspace)
      return restored?.version ?? null
    })()
      .then(async (version) => {
        if (!version) {
          setNotice('历史文案已放入编辑器，但尚未建立版本；请先处理当前页面的保存提示。')
          return
        }
        setProject(await api.getProject(projectId))
        setNotice(`${version.displayName || `文案v${version.revision}`}已恢复为新的当前版本；原历史版本保持不变`)
      })
      .catch((reason) => setNotice(reason instanceof Error ? reason.message : '历史版本恢复失败'))
      .finally(() => {
        pendingCurrentScriptRestoreInFlight.current = false
        savingRef.current = false
        setSaving(false)
      })
  }, [currentScript.phase, currentScript.recoveryCandidates.length, draftVersionId, editor, projectId, workspaceLoadError]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (resolvedWorkspaceLoadKey !== workspaceLoadKey) return
    let active = true
    void window.creatorOS?.listCodexWritingModels()
      .then((models) => { if (active) setCodexModels(models) })
      .catch(() => { if (active) setCodexModels([]) })
    return () => { active = false }
  }, [resolvedWorkspaceLoadKey, workspaceLoadKey])
  useEffect(() => { if (window.creatorOS) void loadConversations() }, [projectId, taskSignature]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (window.creatorOS && comparisonWorkspace) void loadDraftComparison().catch((reason) => setNotice(reason instanceof Error ? reason.message : '双稿状态读取失败'))
  }, [projectId, taskSignature]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (window.creatorOS && materialWorkspace) void loadScriptMaterial().catch((reason) => setNotice(reason instanceof Error ? reason.message : '素材成稿状态读取失败'))
  }, [projectId, taskSignature]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!window.creatorOS || comparisonWorkspace?.activeSession?.status !== 'ready') {
      setComparisonHistory([])
      return
    }
    void window.creatorOS.listDraftComparisonHistory(projectId)
      .then(setComparisonHistory)
      .catch((reason) => setNotice(reason instanceof Error ? reason.message : '操作历史读取失败'))
  }, [projectId, comparisonWorkspace?.activeSession?.id, comparisonWorkspace?.activeSession?.status, comparisonWorkspace?.activeSession?.updatedAt])
  useEffect(() => {
    if (!editor) return
    Array.from(editor.view.dom.querySelectorAll<HTMLElement>('mark[data-target-selection-id]'))
      .forEach((mark) => mark.classList.toggle('is-target-active', mark.dataset.targetSelectionId === activeTargetId))
  }, [activeTargetId, editor, revisionSelection])
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(scriptMaterialRelationFocusKey, materialRelationFocus))
    const frame = window.requestAnimationFrame(() => {
      const firstMatch = editor.view.dom.querySelector<HTMLElement>('.is-material-relation-live')
      if (firstMatch && materialRelationFocus?.origin !== 'current') firstMatch.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editor, materialRelationFocus])
  useEffect(() => {
    if (!editor || !currentScriptEditorEditable || currentScript.phase !== 'ready' || !selectedMaterialDraft || selectedMaterialDraft.mappingState !== 'ready' || !selectedMaterialDraft.currentContentHash || !selectedMaterialDraft.currentMappings.length) return
    if (appliedInitialMaterialMappings.current.has(selectedMaterialDraft.id)) return
    let canceled = false
    const snapshot = currentDocumentParagraphSnapshot(editor)
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot))).then((buffer) => {
      if (canceled) return
      const hash = Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== selectedMaterialDraft.currentContentHash) return
      let searchFrom = 0
      const relationType = editor.schema.marks.scriptMaterialRelation
      selectedMaterialDraft.currentMappings
        .map((mapping) => ({
          mapping,
          position: snapshot.find((paragraph) => paragraph.id === mapping.currentParagraphId)?.position ?? Number.MAX_SAFE_INTEGER
        }))
        .sort((left, right) => left.position - right.position)
        .forEach(({ mapping }) => {
          const range = normalizedTextRanges(editor, mapping.currentParagraphText).find((candidate) => candidate.from >= searchFrom)
          if (!range) return
          searchFrom = range.to
          if (relationType && editor.state.doc.rangeHasMark(range.from, range.to, relationType)) return
          editor.chain().setTextSelection(range).setMark('scriptMaterialRelation', {
            relationId: crypto.randomUUID(),
            draftId: selectedMaterialDraft.id,
            draftParagraphIds: mapping.draftParagraphIds.join(','),
            sourcePointIds: mapping.sourcePointIds.join(','),
            sourcePointVersion: materialWorkspace?.activeRevision?.id ?? null
          }).run()
        })
      appliedInitialMaterialMappings.current.add(selectedMaterialDraft.id)
    })
    return () => { canceled = true }
  }, [currentDocumentVersion, currentScript.phase, currentScriptEditorEditable, editor, materialWorkspace?.activeRevision?.id, selectedMaterialDraft])
  useEffect(() => {
    if (!editor) return
    const refreshMarkers = (): void => {
      setCurrentDocumentVersion((value) => value + 1)
      const next: ScriptMarkerRecord[] = []
      editor.state.doc.descendants((node, position) => {
        if (!node.isText || !node.text) return
        const marker = node.marks.find((mark) => mark.type.name === 'scriptMarker' && typeof mark.attrs.markerId === 'string' && mark.attrs.markerId)
        if (!marker) return
        const previous = next.at(-1)
        if (previous && previous.id === marker.attrs.markerId && previous.to === position) {
          previous.to = position + node.nodeSize
          previous.text += node.text
        } else {
          next.push({ id: String(marker.attrs.markerId), note: typeof marker.attrs.markerNote === 'string' ? marker.attrs.markerNote : '', text: node.text, from: position, to: position + node.nodeSize })
        }
      })
      setMarkers(next)
    }
    refreshMarkers()
    editor.on('update', refreshMarkers)
    return () => { editor.off('update', refreshMarkers) }
  }, [editor])
  useEffect(() => {
    if (!editor) {
      setMaterialCurrentContentHash(null)
      return
    }
    let canceled = false
    const normalized = editor.getText({ blockSeparator: '\n\n' }).replace(/\s+/g, ' ').trim()
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)).then((buffer) => {
      if (canceled) return
      setMaterialCurrentContentHash([...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
    })
    return () => { canceled = true }
  }, [currentDocumentVersion, editor])
  useEffect(() => {
    if (!markerComposer && !markerListOpen) return
    const close = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.script-editor-context-menu, .script-marker-composer, .script-marker-menu')) return
      setMarkerComposer(null)
      setMarkerListOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (markerComposer) setMarkerComposer(null)
      else setMarkerListOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [markerComposer, markerListOpen])
  useEffect(() => {
    if (currentScript.saveState !== 'conflict' && currentScript.recoveryCandidates.length === 0) return
    setEditorContextMenu(null)
    setMarkerComposer(null)
    setMarkerListOpen(false)
    setComparisonOpen(false)
    setMoreOpen(false)
    setFeishuOpen(false)
  }, [currentScript.recoveryCandidates.length, currentScript.saveState])

  const locateMarker = (marker: ScriptMarkerRecord): void => {
    if (!editor) return
    editor.chain().focus().setTextSelection({ from: marker.from, to: marker.to }).scrollIntoView().run()
    setMarkerListOpen(false)
  }

  const persistLayout = (patch: Partial<WorkbenchPreferences>): void => { void window.creatorOS?.setWorkbenchPreferences(projectId, patch) }
  const changeMaterialScrollTop = (tab: ScriptMaterialMobileTab, value: number): void => {
    const next = { ...materialScrollTopsRef.current, [tab]: Math.max(0, Math.round(value)) }
    materialScrollTopsRef.current = next
    setMaterialScrollTops(next)
    persistLayout({ workbenchMaterialScrollTops: next })
  }
  const changeConversationScrollTop = (tab: Exclude<ConversationWorkbenchTab, 'current'>, value: number): void => {
    const next = { ...conversationScrollTopsRef.current, [tab]: Math.max(0, Math.round(value)) }
    conversationScrollTopsRef.current = next
    setConversationScrollTops(next)
    persistLayout({ workbenchConversationScrollTops: next })
  }
  const switchView = (view: Exclude<ScriptWorkbenchView, 'comparison'>): void => {
    if (materialSnapshotReadOnly) return
    setWorkbenchView(view)
    setPrimaryView('conversation')
    setLocatorProvider(null)
    if (view === 'single' && conversationTab !== 'current') setConversationTab(singleProvider)
    persistLayout({
      workbenchView: view,
      workbenchPrimaryView: 'conversation',
      ...(view === 'single' && conversationTab !== 'current' ? { workbenchConversationTab: singleProvider } : {})
    })
    anchorWorkbenchViewport()
  }
  const switchPrimaryView = (view: WorkbenchPrimaryView): void => {
    if (versionRestoreBusyRef.current) {
      setNotice('正在恢复版本，完成后会自动进入当前文案。')
      return
    }
    if (materialSnapshotReadOnly && view !== 'comparison') return
    setPrimaryView(view)
    setLocatorProvider(null)
    if (view === 'comparison') {
      persistLayout({ workbenchPrimaryView: 'comparison' })
    } else if (view === 'conversation') {
      const next = workbenchView === 'single' || workbenchView === 'dual' ? workbenchView : 'dual'
      setWorkbenchView(next)
      persistLayout({ workbenchView: next, workbenchPrimaryView: 'conversation' })
    } else {
      persistLayout({ workbenchPrimaryView: 'versions' })
    }
    anchorWorkbenchViewport()
  }
  const switchComparisonKind = (kind: 'drafts' | 'materials'): void => {
    if (materialSnapshotReadOnly && kind !== 'materials') return
    setComparisonKind(kind)
    setNotice('')
    persistLayout({ workbenchComparisonKind: kind })
  }
  const switchDraftSurface = (surface: DraftWorkbenchSurface): void => {
    setDraftSurface(surface)
    setLocatorProvider(null)
    persistLayout({ workbenchDraftSurface: surface })
    anchorWorkbenchViewport()
  }
  const switchVersionSurface = (surface: VersionWorkbenchSurface): void => {
    if (versionRestoreBusyRef.current) {
      setNotice('正在恢复版本，完成后会自动进入当前文案。')
      return
    }
    setVersionSurface(surface)
    setLocatorProvider(null)
    persistLayout({ workbenchVersionSurface: surface })
    anchorWorkbenchViewport()
  }
  const switchSingleProvider = (provider: ScriptWorkbenchSingleProvider): void => {
    setSingleProvider(provider)
    setConversationTab(provider)
    setActiveConversationProvider(provider === 'claude' ? 'claude_cli' : 'codex_cli')
    setLocatorProvider(null)
    persistLayout({ workbenchSingleProvider: provider, workbenchConversationTab: provider })
  }
  const switchConversationTab = (tab: ConversationWorkbenchTab): void => {
    setConversationTab(tab)
    setLocatorProvider(null)
    if (tab === 'current') persistLayout({ workbenchConversationTab: 'current' })
    else if (workbenchView === 'single') {
      setSingleProvider(tab)
      setActiveConversationProvider(tab === 'claude' ? 'claude_cli' : 'codex_cli')
      persistLayout({ workbenchConversationTab: tab, workbenchSingleProvider: tab })
    } else {
      setActiveConversationProvider(tab === 'claude' ? 'claude_cli' : 'codex_cli')
      persistLayout({ workbenchConversationTab: tab, workbenchDualActiveProvider: tab })
    }
  }
  const toggleHiddenProvider = (provider: ScriptWorkbenchSingleProvider): void => {
    const next = hiddenProviders.includes(provider)
      ? hiddenProviders.filter((item) => item !== provider)
      : [...hiddenProviders, provider]
    setHiddenProviders(next)
    persistLayout({ workbenchHiddenProviders: next })
  }
  const switchDraftMobileTab = (tab: DraftComparisonSide | 'current'): void => {
    setLocatorProvider(null)
    if (tab === 'current') {
      setDraftSurface('current')
      persistLayout({ workbenchDraftSurface: 'current' })
    } else {
      setDraftSurface('organize')
      setComparisonSide(tab)
      persistLayout({ workbenchDraftSurface: 'organize', workbenchComparisonSide: tab })
    }
    anchorWorkbenchViewport()
  }
  const switchVersionMobileTab = (tab: VersionMobileSide | 'current'): void => {
    if (versionRestoreBusyRef.current) return
    setLocatorProvider(null)
    if (tab === 'current') {
      setVersionSurface('current')
      persistLayout({ workbenchVersionSurface: 'current' })
    } else {
      setVersionSurface('compare')
      setVersionMobileSide(tab)
      persistLayout({ workbenchVersionSurface: 'compare', workbenchVersionMobileSide: tab })
    }
    anchorWorkbenchViewport()
  }
  const switchComparisonSide = (side: DraftComparisonSide): void => {
    setComparisonSide(side)
    persistLayout({ workbenchComparisonSide: side })
  }
  const changeComparisonSplit = (value: number): void => {
    setComparisonSplit(value)
    persistLayout({ workbenchComparisonSplit: value })
  }
  const changeComparisonPreviewSplit = (value: number): void => {
    setComparisonPreviewSplit(value)
    persistLayout({ workbenchComparisonPreviewSplit: value })
  }
  const changeComparisonScrollTop = (value: number): void => {
    const rounded = Math.max(0, Math.round(value))
    setComparisonScrollTop(rounded)
    persistLayout({ workbenchComparisonScrollTop: rounded })
  }
  const changeComparisonColorMode = (value: DraftComparisonColorMode): void => {
    setComparisonColorMode(value)
    persistLayout({ workbenchComparisonColorMode: value })
  }
  const changeComparisonDocumentMode = (value: DraftComparisonDocumentMode): void => {
    setComparisonDocumentMode(value)
    persistLayout({ workbenchComparisonDocumentMode: value })
  }
  const changeComparisonSplitScope = (value: DraftComparisonSplitScope): void => {
    setComparisonSplitScope(value)
    persistLayout({ workbenchComparisonSplitScope: value })
  }
  const changeComparisonUseOutline = (value: boolean): void => {
    setComparisonUseOutline(value)
    persistLayout({ workbenchComparisonUseOutline: value })
  }

  const claudeAvailable = Boolean(providerCapabilities.find((item) => item.provider === 'claude_cli')?.available)
  const codexAvailable = Boolean(providerCapabilities.find((item) => item.provider === 'codex_cli')?.available)
  useEffect(() => {
    if (workbenchView === 'comparison') return
    const visible = workbenchView === 'single'
      ? singleProvider === 'codex' && codexAvailable ? ['codex_cli'] : singleProvider === 'claude' && claudeAvailable ? ['claude_cli'] : []
      : providers.filter((provider) => provider === 'codex_cli' ? codexAvailable : claudeAvailable)
    setSendTargets(new Set(visible as ScriptRevisionProvider[]))
  }, [workbenchView, singleProvider, codexAvailable, claudeAvailable])

  const revisionSelectionForRange = (from: number, to: number): RevisionSelection | null => {
    if (!editor || from === to) return null
    const existingTargetId = targetIdInSelection(editor, from, to)
    const selectedText = editor.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim()
    if (selectedText.length < 2) return null
    const contextBefore = editor.state.doc.textBetween(Math.max(0, from - 160), from, ' ').replace(/\s+/g, ' ').trim()
    const contextAfter = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 160), ' ').replace(/\s+/g, ' ').trim()
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ').replace(/\s+/g, ' ').trim()
    const prefix = editor.state.doc.textBetween(0, from, ' ').replace(/\s+/g, ' ').trim()
    let occurrenceIndex = 0
    let cursor = 0
    while ((cursor = fullText.indexOf(selectedText, cursor)) >= 0 && cursor < prefix.length) { occurrenceIndex += 1; cursor += selectedText.length }
    return { targetSelectionId: existingTargetId ?? crypto.randomUUID(), selectedText, contextBefore, contextAfter, occurrenceIndex, from, to }
  }

  const captureRevisionSelection = (): void => {
    if (!editor) return
    let { from, to } = editor.state.selection
    const browserSelection = window.getSelection()
    if (from === to && browserSelection && !browserSelection.isCollapsed && browserSelection.anchorNode && browserSelection.focusNode) {
      try {
        const anchor = editor.view.posAtDOM(browserSelection.anchorNode, browserSelection.anchorOffset)
        const focus = editor.view.posAtDOM(browserSelection.focusNode, browserSelection.focusOffset)
        from = Math.min(anchor, focus)
        to = Math.max(anchor, focus)
      } catch {
        // Tiptap仍以自己的选区为准；DOM选区落在编辑器外时不建立目标。
      }
    }
    const existingTargetId = targetIdInSelection(editor, from, to)
    if (from === to) {
      if (existingTargetId) {
        setActiveTargetId(existingTargetId)
        const range = targetRanges(editor, existingTargetId)[0]
        if (range) setRevisionSelection({ targetSelectionId: existingTargetId, selectedText: editor.state.doc.textBetween(range.from, range.to, ' ').replace(/\s+/g, ' ').trim(), contextBefore: '', contextAfter: '', occurrenceIndex: null, from: range.from, to: range.to })
      } else setRevisionSelection(null)
      return
    }
    const selection = revisionSelectionForRange(from, to)
    if (!selection) return
    setRevisionSelection(selection)
    if (existingTargetId) setActiveTargetId(existingTargetId)
  }

  const openEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!editor || materialSnapshotReadOnly) return
    let { from, to } = editor.state.selection
    if (from === to) {
      const $from = editor.state.doc.resolve(from)
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (!node.isTextblock) continue
        from = $from.start(depth)
        to = $from.end(depth)
        break
      }
    }
    if (from === to) return
    event.preventDefault()
    setMarkerListOpen(false)
    setMarkerComposer(null)
    setEditorContextMenu({
      x: Math.max(8, Math.min(window.innerWidth - 190, event.clientX)),
      y: Math.max(8, Math.min(window.innerHeight - 190, event.clientY)),
      from,
      to
    })
    setEditorSelectionStage('actions')
    setEditorAnnotationNote('')
  }

  const markCurrentSelection = (selection: RevisionSelection): void => {
    if (!editor || selection.from === null || selection.to === null || !selection.targetSelectionId) return
    const currentText = editor.state.doc.textBetween(selection.from, selection.to, ' ').replace(/\s+/g, ' ').trim()
    if (currentText !== selection.selectedText) throw new Error('当前选区已经变化，请重新选择后再发送')
    editor.chain().setTextSelection({ from: selection.from, to: selection.to }).setHighlight({ targetSelectionId: selection.targetSelectionId } as never).run()
    setActiveTargetId(selection.targetSelectionId)
  }

  const currentAnnotationRanges = (from: number, to: number): Array<{ from: number; to: number; blockId: string }> => {
    if (!editor || from >= to) return []
    ensureCurrentScriptEditorIdentity(editor)
    const ranges: Array<{ from: number; to: number; blockId: string }> = []
    editor.state.doc.descendants((node, position) => {
      if (!node.isTextblock) return true
      const start = Math.max(from, position + 1)
      const end = Math.min(to, position + node.nodeSize - 1)
      const blockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : ''
      if (start < end && blockId) ranges.push({ from: start, to: end, blockId })
      return false
    })
    return ranges
  }

  const freezeCurrentInstructionTarget = async (from: number, to: number): Promise<ContentTargetSnapshot> => {
    if (!editor) throw new Error('当前文案编辑器尚未就绪')
    ensureCurrentScriptEditorIdentity(editor)
    const frozen = await currentScript.flush()
    if (!frozen) throw new Error('当前文案尚未完成保存，请稍后重试')
    const savedBlocks = new Map(frozen.blocks.map((block) => [block.blockId, block.text]))
    const blockSelections: Extract<ContentTargetSnapshot, { kind: 'current_script' }>['blockSelections'] = []
    editor.state.doc.descendants((node, position) => {
      if (!node.isTextblock) return true
      const blockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : ''
      const blockStart = position + 1
      const blockEnd = position + node.nodeSize - 1
      const selectionStart = Math.max(from, blockStart)
      const selectionEnd = Math.min(to, blockEnd)
      if (!blockId || selectionStart >= selectionEnd) return false
      const localFrom = selectionStart - blockStart
      const localTo = selectionEnd - blockStart
      const savedText = savedBlocks.get(blockId)
      if (savedText === undefined || localTo > savedText.length) throw new Error('当前文案选区已变化，请重新选择')
      blockSelections.push({ blockId, from: localFrom, to: localTo, text: savedText.slice(localFrom, localTo) })
      return false
    })
    if (!blockSelections.length) throw new Error('当前文案选区已变化，请重新选择')
    return {
      kind: 'current_script',
      workingDocumentId: frozen.document.workingDocumentId,
      revision: frozen.document.revision,
      contentHash: frozen.document.contentHash,
      blockSelections
    }
  }

  const freezeCurrentDocumentInstructionTarget = async (): Promise<ContentTargetSnapshot> => {
    const frozen = await currentScript.flush()
    if (!frozen) throw new Error('当前文案尚未完成保存，请稍后重试')
    return {
      kind: 'current_script',
      workingDocumentId: frozen.document.workingDocumentId,
      revision: frozen.document.revision,
      contentHash: frozen.document.contentHash,
      blockSelections: []
    }
  }

  const applyCurrentAnnotation = (style: 'highlight' | 'underline' | 'strike' | 'flag', note = ''): void => {
    if (!editor || !editorContextMenu || !currentScriptEditorEditable) return
    const ranges = currentAnnotationRanges(editorContextMenu.from, editorContextMenu.to)
    if (!ranges.length) { setNotice('所选内容已变化，请重新选择'); return }
    let transaction = editor.state.tr
    ranges.forEach((range) => {
      const id = `script-annotation-${crypto.randomUUID()}`
      const markType = editor.schema.marks[style === 'flag' ? 'scriptMarker' : style]
      if (!markType) return
      const attrs = style === 'flag'
        ? { markerId: id, markerNote: note.trim() || null, markerBlockId: range.blockId }
        : {
            annotationId: id,
            annotationNote: note.trim() || null,
            annotationBlockId: range.blockId,
            ...(style === 'highlight' ? { color: '#F3D9A3', targetSelectionId: null } : {})
          }
      transaction = transaction.addMark(range.from, range.to, markType.create(attrs))
    })
    editor.view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, editorContextMenu.from, editorContextMenu.to)))
    setEditorContextMenu(null)
    setEditorSelectionStage('actions')
    setEditorAnnotationNote('')
    setNotice('已添加工作台标记；导出时不会带入')
  }

  const clearCurrentAnnotations = (): void => {
    if (!editor || !editorContextMenu || !currentScriptEditorEditable) return
    const { from, to } = editorContextMenu
    let transaction = editor.state.tr
    editor.state.doc.nodesBetween(from, to, (node, position) => {
      if (!node.isText) return
      const start = Math.max(from, position)
      const end = Math.min(to, position + node.nodeSize)
      node.marks.forEach((mark) => {
        const isAnnotation = ['highlight', 'underline', 'strike'].includes(mark.type.name)
          && typeof mark.attrs.annotationId === 'string' && mark.attrs.annotationId
        const isFlag = mark.type.name === 'scriptMarker' && typeof mark.attrs.markerId === 'string' && mark.attrs.markerId
        if (isAnnotation || isFlag) transaction = transaction.removeMark(start, end, mark)
      })
    })
    if (transaction.docChanged) editor.view.dispatch(transaction)
    setEditorContextMenu(null)
    setEditorSelectionStage('actions')
    setEditorAnnotationNote('')
    setNotice(transaction.docChanged ? '已清除当前范围的工作台标记' : '当前范围没有工作台标记')
  }

  const sendCurrentSelectionRewrite = async (request: RewriteRequest): Promise<void> => {
    if (!window.creatorOS || !editor || !editorContextMenu || sending || !codexAvailable) return
    const selection = revisionSelectionForRange(editorContextMenu.from, editorContextMenu.to)
    if (!selection) throw new Error('所选内容已变化，请重新选择')
    const quickLabels: Record<RewriteQuickIntent, string> = {
      regenerate: '重新生成', polish: '润色', concise: '更精简', conversational: '更口语', expand: '扩写', humorous: '更有趣'
    }
    const message = [request.quickIntent ? `请将选中文字${quickLabels[request.quickIntent]}。` : '', request.requirement].filter(Boolean).join('\n')
    if (!message) return
    setSending(true)
    try {
      const target = await freezeCurrentInstructionTarget(editorContextMenu.from, editorContextMenu.to)
      const instruction = await buildStructuredInstructionPayload({
        projectId,
        sessionScope: `current-script-rewrite:${projectId}`,
        surface: 'current_script_rewrite',
        snapshot: request.structuredInstruction
          ? { ...request.structuredInstruction, displayText: message }
          : { displayText: message, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] }, references: [] },
        target,
        includeProjectContext,
        webSearchMode: 'automatic',
        aiCount: 1,
        targets: [{
          providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
          requestedModel: request.preferredModel ?? 'auto',
          requestedReasoningEffort: request.preferredReasoningEffort ?? 'xhigh',
          historyThreadId: conversations.codex_cli.threadId,
          providerThreadId: conversations.codex_cli.providerThreadId,
          historyMessageIds: conversations.codex_cli.messages.slice(-40).map((item) => item.id)
        }]
      })
      const dispatched = await window.creatorOS.dispatchContentInstruction({
        operation: 'script_revision',
        instruction,
        requests: [{
        projectId,
        threadId: conversations.codex_cli.threadId,
        baseVersionId: currentScriptVersion?.id ?? null,
        currentDocumentContent: editor.getHTML(),
        includeProjectContext,
        provider: 'codex_cli',
        preferredModel: request.preferredModel,
        preferredReasoningEffort: request.preferredReasoningEffort,
        message,
        selection
        }]
      })
      const task = dispatched.tasks[0]
      if (!task) throw new Error('局部候选任务没有成功建立')
      markCurrentSelection(selection)
      setRevisionSelection(selection)
      setPendingCurrentRewrites((current) => [...current.filter((item) => item.taskId !== task.id), {
        taskId: task.id,
        requestId: dispatched.request.request.id,
        selection,
        requestedModel: request.preferredModel,
        request,
        applyTarget: {
          targetSelectionId: selection.targetSelectionId,
          selectedText: selection.selectedText ?? ''
        }
      }])
      setActiveCurrentRewriteTaskId(task.id)
      setEditorContextMenu(null)
      setEditorSelectionStage('actions')
      setNotice('已在后台生成局部候选，原文不会被直接修改')
      await refreshWorkspace()
      await loadConversations()
    } finally {
      setSending(false)
    }
  }

  const sendCurrentCandidateContinuation = async (request: RewriteRequest): Promise<void> => {
    const continuation = currentCandidateContinuation
    const candidateText = continuation?.message.suggestion?.replacementText ?? ''
    if (!window.creatorOS || !continuation || !candidateText || sending || !codexAvailable) return
    if (pendingCurrentRewriteTargetChangedFor(continuation.pending)) throw new Error('原应用目标已变化，请重新选择后再生成')
    const quickLabels: Record<RewriteQuickIntent, string> = {
      regenerate: '重新生成', polish: '润色', concise: '更精简', conversational: '更口语', expand: '扩写', humorous: '更有趣'
    }
    const message = [
      '请继续修改上一轮候选，不要回到原文重新生成。',
      request.quickIntent ? `快捷要求：${quickLabels[request.quickIntent]}` : '',
      request.requirement
    ].filter(Boolean).join('\n')
    setSending(true)
    try {
      const targetSelectionId = continuation.pending.applyTarget.targetSelectionId
      const selection: RevisionSelection = {
        targetSelectionId,
        selectedText: candidateText,
        contextBefore: '',
        contextAfter: '',
        occurrenceIndex: 0,
        from: 1,
        to: candidateText.length + 1
      }
      const currentRange = currentRewriteTargetRange(continuation.pending)
      if (!currentRange) throw new Error('原应用目标已变化，请重新选择后再生成')
      const target = await freezeCurrentInstructionTarget(currentRange.from, currentRange.to)
      const instruction = await buildStructuredInstructionPayload({
        projectId,
        sessionScope: `current-script-rewrite:${projectId}`,
        surface: 'current_script_rewrite',
        supersedesRequestId: continuation.pending.requestId,
        snapshot: request.structuredInstruction
          ? { ...request.structuredInstruction, displayText: message }
          : { displayText: message, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] }, references: [] },
        target,
        includeProjectContext,
        webSearchMode: 'automatic',
        aiCount: 1,
        targets: [{
          providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
          requestedModel: request.preferredModel ?? 'auto',
          requestedReasoningEffort: request.preferredReasoningEffort ?? 'xhigh',
          historyThreadId: conversations.codex_cli.threadId,
          providerThreadId: conversations.codex_cli.providerThreadId,
          historyMessageIds: conversations.codex_cli.messages.slice(-40).map((item) => item.id)
        }]
      })
      const dispatched = await window.creatorOS.dispatchContentInstruction({
        operation: 'script_revision',
        instruction,
        requests: [{
        projectId,
        threadId: conversations.codex_cli.threadId,
        baseVersionId: null,
        currentDocumentContent: sourceContentToRichTextHtml(candidateText),
        includeProjectContext,
        provider: 'codex_cli',
        preferredModel: request.preferredModel,
        preferredReasoningEffort: request.preferredReasoningEffort,
        message,
        selection
        }]
      })
      const task = dispatched.tasks[0]
      if (!task) throw new Error('继续修改任务没有成功建立')
      setPendingCurrentRewrites((current) => [...current.filter((item) => item.taskId !== task.id), {
        taskId: task.id,
        requestId: dispatched.request.request.id,
        selection,
        requestedModel: request.preferredModel,
        request,
        applyTarget: continuation.pending.applyTarget
      }])
      setCurrentCandidateContinuation(null)
      setActiveCurrentRewriteTaskId(task.id)
      setNotice('已基于上一轮候选继续生成，当前文案仍不会被直接修改')
      await refreshWorkspace()
      await loadConversations()
    } finally {
      setSending(false)
    }
  }

  const sendMessage = async (composerSnapshot?: StructuredComposerSnapshot): Promise<void> => {
    const content = (composerSnapshot?.displayText ?? composerMessage).trim()
    if (!window.creatorOS || !editor || !content || loading || sending || sendTargets.size === 0 || materialSnapshotReadOnly) return
    setSending(true); setNotice('')
    try {
      const structuredTarget = revisionSelection && revisionSelection.from !== null && revisionSelection.to !== null
        ? await freezeCurrentInstructionTarget(revisionSelection.from, revisionSelection.to)
        : includeProjectContext ? await freezeCurrentDocumentInstructionTarget() : null
      const selectedProviders = Array.from(sendTargets)
      const instruction = await buildStructuredInstructionPayload({
        projectId,
        sessionScope: `script-conversation:${projectId}`,
        surface: 'script_conversation',
        snapshot: composerSnapshot ?? { displayText: content, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }, references: [] },
        target: structuredTarget,
        includeProjectContext,
        webSearchMode: 'automatic',
        aiCount: selectedProviders.length === 2 ? 2 : 1,
        targets: selectedProviders.map((provider) => {
          const conversation = conversations[provider]
          return {
            providerConfigId: provider === 'codex_cli' ? BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex : BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
            requestedModel: provider === 'codex_cli' ? preferredCodexModel ?? 'auto' : 'auto',
            requestedReasoningEffort: provider === 'codex_cli' ? 'xhigh' : null,
            historyThreadId: conversation.threadId,
            providerThreadId: conversation.providerThreadId,
            historyMessageIds: conversation.messages.slice(-40).map((message) => message.id)
          }
        })
      })
      const dispatched = await window.creatorOS.dispatchContentInstruction({
        operation: 'script_revision',
        instruction,
        requests: selectedProviders.map((provider) => {
        const conversation = conversations[provider]
        return {
          projectId,
          threadId: conversation.threadId,
          baseVersionId: currentScriptVersion?.id ?? null,
          currentDocumentContent: editor.getHTML(),
          includeProjectContext,
          provider,
          preferredModel: provider === 'codex_cli' ? preferredCodexModel : null,
          preferredReasoningEffort: provider === 'codex_cli' ? 'xhigh' : null,
          webSearchMode: 'automatic',
          message: content,
          selection: revisionSelection ?? { targetSelectionId: null, selectedText: null, contextBefore: '', contextAfter: '', occurrenceIndex: null, from: null, to: null }
        }
      })
      })
      if (revisionSelection) markCurrentSelection(revisionSelection)
      setComposerMessage('')
      setNotice(`已发送给${dispatched.tasks.length === 2 ? 'Claude和Codex' : '所选AI'}`)
      await refreshWorkspace(); await loadConversations()
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '消息发送失败') }
    finally { setSending(false) }
  }

  const locateTarget = (message: ScriptRevisionMessage): void => {
    if (!editor) return
    const targetId = messageTargetId(message)
    if (!targetId) { setNotice('这条候选没有可定位的原文'); return }
    let ranges = targetRanges(editor, targetId)
    if (!ranges.length && message.selectedText) {
      const exact = exactRanges(editor, message.selectedText)
      if (exact.length === 1) { editor.chain().setTextSelection(exact[0]!).setHighlight({ targetSelectionId: targetId } as never).run(); ranges = exact }
    }
    if (!ranges.length) { setNotice('原目标已变化，请重新选择位置'); return }
    setActiveTargetId(targetId)
    Array.from(editor.view.dom.querySelectorAll<HTMLElement>('mark[data-target-selection-id]')).find((element) => element.dataset.targetSelectionId === targetId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setNotice('已定位到当前文案中的对应位置')
  }

  const focusTargetFromDocument = (event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement
    const evidenceElement = target.closest<HTMLElement>('[data-content-fact-evidence-ids]')
    if (evidenceElement?.dataset.contentFactEvidenceIds && window.creatorOS) {
      let evidenceIds: string[] = []
      try {
        const parsed = JSON.parse(evidenceElement.dataset.contentFactEvidenceIds) as unknown
        if (Array.isArray(parsed)) evidenceIds = parsed.filter((item): item is string => typeof item === 'string')
      } catch { /* malformed attributes are ignored */ }
      if (evidenceIds.length) {
        void window.creatorOS.getContentFactEvidence(projectId, evidenceIds)
          .then((items) => {
            if (!items.length) throw new Error('联网证据已失效或不属于当前项目')
            setFactEvidencePopover({ x: event.clientX, y: event.clientY, items })
            setNotice(`已读取${items.length}条联网证据`)
          })
          .catch((reason) => setNotice(reason instanceof Error ? reason.message : '联网证据读取失败'))
        return
      }
    }
    setFactEvidencePopover(null)
    const targetId = target.closest<HTMLElement>('mark[data-target-selection-id]')?.dataset.targetSelectionId
    if (!targetId) return
    setActiveTargetId(targetId)
    const matchedProviders = providers.filter((provider) => conversations[provider].messages.some((message) => messageTargetId(message) === targetId))
    setNotice(matchedProviders.length
      ? `已定位${matchedProviders.map((provider) => provider === 'claude_cli' ? 'Claude' : 'Codex').join('和')}中的对应候选`
      : '这段还没有AI候选')
  }

  const applySuggestion = async (message: ScriptRevisionMessage, action: 'replace' | 'insert_after'): Promise<void> => {
    if (!window.creatorOS || !editor || !message.suggestion) throw new Error('当前候选不可用')
    if (message.selectionSnapshot?.applicationTarget?.surface === 'version_compare'
      || message.sourceSelections.some((selection) => selection.sourceKind === 'draft_version')) {
      throw new Error('这条候选绑定版本对比工作副本，请回到版本对比使用')
    }
    if (!requireCurrentScriptEditorEditable()) throw new Error('当前文案暂时不能修改')
    const targetId = messageTargetId(message)
    let ranges = targetId ? targetRanges(editor, targetId) : []
    if (!ranges.length) ranges = exactRanges(editor, message.suggestion.originalText)
    if (ranges.length === 0) throw new Error('原文已变化，请重新选择目标或复制候选')
    if (ranges.length > 1) throw new Error('原文存在多处，不能自动替换，请先定位目标')
    const range = ranges[0]!
    const source = editor.state.doc.textBetween(range.from, range.to, ' ').replace(/\s+/g, ' ').trim()
    const expected = message.suggestion.originalText.replace(/\s+/g, ' ').trim()
    if (source !== expected) throw new Error('原目标内容已经变化，请重新生成候选')
    let applied = false
    if (action === 'replace') {
      applied = editor.chain().focus().insertContentAt(range, message.suggestion.replacementText).run()
      if (targetId) editor.chain().setTextSelection({ from: range.from, to: range.from + message.suggestion.replacementText.length }).setHighlight({ targetSelectionId: targetId } as never).run()
    } else applied = editor.chain().focus().insertContentAt(range.to, message.suggestion.replacementText).run()
    if (!applied) throw new Error('候选没有写入当前文案，请稍后重试')
    const insertedFrom = action === 'replace' ? range.from : range.to
    const insertedRange = normalizedTextRanges(editor, message.suggestion.replacementText)
      .find((candidate) => candidate.from >= Math.max(0, insertedFrom - 1))
    if (insertedRange && message.factAnnotations.length) {
      const transaction = editor.state.tr
      addContentFactMarks(transaction, insertedRange, message.suggestion.replacementText, message.factAnnotations)
      if (transaction.docChanged) editor.view.dispatch(transaction)
    }
    await window.creatorOS.setScriptRevisionSuggestionStatus(projectId, message.id, 'applied')
    setAppliedRevisionMessageId(message.id)
    if (targetId) setActiveTargetId(targetId)
    setNotice('候选已应用到当前文案；保存后才会建立新版本')
    await loadConversations()
  }

  const undoSuggestion = async (message: ScriptRevisionMessage): Promise<void> => {
    if (!window.creatorOS || !editor || appliedRevisionMessageId !== message.id) throw new Error('当前没有可撤销的候选应用')
    if (!requireCurrentScriptEditorEditable()) throw new Error('当前文案暂时不能修改')
    if (!editor.commands.undo()) throw new Error('本次候选应用已经不能撤销')
    await window.creatorOS.setScriptRevisionSuggestionStatus(projectId, message.id, 'pending')
    setAppliedRevisionMessageId(null); setNotice('已撤销本次候选应用'); await loadConversations()
  }
  const copySuggestion = async (message: ScriptRevisionMessage): Promise<void> => {
    if (!window.creatorOS || !message.suggestion) return
    await navigator.clipboard.writeText(message.suggestion.replacementText)
    await window.creatorOS.setScriptRevisionSuggestionStatus(projectId, message.id, 'copied')
    setNotice('候选文字已复制'); await loadConversations()
  }
  const appendConversationMessage = (message: ScriptRevisionMessage): void => {
    if (!editor || message.role !== 'assistant') return
    if (!requireCurrentScriptEditorEditable()) return
    const previousSize = editor.state.doc.content.size
    const renderedHtml = plainTextToHtml(message.content)
    const renderedText = richTextHtmlToPlainText(renderedHtml)
    if (!editor.chain().focus('end').insertContent(renderedHtml).run()) {
      setNotice('回答没有写入当前文案，请稍后重试')
      return
    }
    const insertedRange = normalizedTextRanges(editor, renderedText)
      .find((candidate) => candidate.from >= Math.max(0, previousSize - 1))
    if (insertedRange && message.factAnnotations.length) {
      const transaction = editor.state.tr
      addContentFactMarks(transaction, insertedRange, message.content, message.factAnnotations)
      if (transaction.docChanged) editor.view.dispatch(transaction)
    }
    setNotice('回答已加入当前文案；保存后才会建立版本')
  }
  const copyConversationMessage = async (message: ScriptRevisionMessage): Promise<void> => {
    await navigator.clipboard.writeText(message.content)
    setNotice('回答已复制')
  }
  const discardSuggestion = async (message: ScriptRevisionMessage): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.setScriptRevisionSuggestionStatus(projectId, message.id, 'discarded')
    setSelectedCandidateIds((current) => { const next = new Set(current); next.delete(message.id); return next }); await loadConversations()
  }
  const retryTask = async (task: (typeof tasks)[number]): Promise<void> => {
    if (!window.creatorOS) return
    try {
      await window.creatorOS.retryTask(task.id)
      await refreshWorkspace()
      await Promise.all([loadConversations(), loadDraftComparison()])
      setNotice('任务已按原冻结输入重新开始')
    }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : '重试失败') }
  }
  const retryComparisonTask = async (taskId: string): Promise<TaskRun> => {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) throw new Error('原任务不存在')
    if (!window.creatorOS) throw new Error('App接口暂不可用')
    const retried = await window.creatorOS.retryTask(task.id)
    await refreshWorkspace()
    await Promise.all([loadConversations(), loadDraftComparison()])
    setNotice('任务已按原冻结输入重新开始')
    return retried
  }
  const verifyProvider = async (provider: ScriptRevisionProvider): Promise<void> => {
    if (!window.creatorOS) return
    try { await window.creatorOS.validateProviderSecurity(provider); await refreshWorkspace(); setNotice(`${provider === 'claude_cli' ? 'Claude' : 'Codex'}已通过安全验证`) }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Provider验证失败') }
  }

  const saveClaudeFreeform = async (content: string): Promise<void> => {
    if (!window.creatorOS) return
    const next = await window.creatorOS.saveDraftComparisonDrafts(projectId, { claudeContent: content })
    setComparisonWorkspace(next)
    setClaudeFreeformContent(next.claudeContent)
    setNotice('Claude自由稿已保存')
  }

  const saveComparisonDrafts = async (patch: { claudeContent?: string; codexContent?: string }): Promise<void> => {
    if (!window.creatorOS) return
    const next = await window.creatorOS.saveDraftComparisonDrafts(projectId, patch)
    setComparisonWorkspace(next)
    setClaudeFreeformContent(next.claudeContent)
  }

  const startDraftAlignment = async (providerConfigId: string, confirmFull = false): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.startDraftAlignment(projectId, providerConfigId, includeProjectContext, { useOutline: comparisonUseOutline, confirmFull })
    await refreshWorkspace()
    await loadDraftComparison()
    setNotice('已冻结双稿，正在建立语义对照')
  }

  const generateDraftSource = async (input: { side: DraftComparisonSide; requirement: string; providerConfigId: string }): Promise<void> => {
    if (!window.creatorOS) return
    await window.creatorOS.generateDraftSource({ projectId, ...input, includeProjectContext })
    await refreshWorkspace()
    setNotice(`${input.side === 'claude' ? 'Claude稿' : 'Codex稿'}整稿生成任务已开始`)
  }

  const generateDraftCandidate = async (input: { groupId: string; parentCandidateId?: string | null; requirement?: string; quickIntent?: 'regenerate' | 'polish' | 'concise' | 'humorous' | 'expand' | 'conversational'; providerConfigId: string; preferredModel?: string | null; preferredReasoningEffort?: string | null; structuredInstruction?: StructuredComposerSnapshot; selectedText?: string; selectionStart?: number; selectionEnd?: number; sourceKind?: 'claude' | 'codex' | 'candidate' | 'current'; sourceId?: string; sourceSelections?: Array<{ sourceKind: 'claude' | 'codex' | 'candidate' | 'current'; sourceId?: string | null; selectedText: string; selectionStart: number; selectionEnd: number }> }): Promise<TaskRun> => {
    if (!window.creatorOS) throw new Error('文案服务尚未就绪')
    const { structuredInstruction, ...legacyInput } = input
    const displayText = input.requirement ?? ''
    const instruction = await buildStructuredInstructionPayload({
      projectId,
      sessionScope: `draft-comparison:${projectId}:${comparisonWorkspace?.activeSession?.id ?? 'working'}`,
      surface: 'script_draft_comparison',
      snapshot: structuredInstruction
        ? { ...structuredInstruction, displayText }
        : { displayText, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: displayText }] }] }, references: [] },
      target: null,
      includeProjectContext,
      webSearchMode: 'automatic',
      aiCount: 1,
      targets: [{
        providerConfigId: input.providerConfigId,
        requestedModel: input.preferredModel ?? 'auto',
        requestedReasoningEffort: input.preferredReasoningEffort ?? 'xhigh',
        historyThreadId: null,
        providerThreadId: null,
        historyMessageIds: []
      }]
    })
    const dispatched = await window.creatorOS.dispatchContentInstruction({
      operation: 'draft_candidate',
      instruction,
      request: { projectId, ...legacyInput, includeProjectContext }
    })
    const task = dispatched.tasks[0]
    if (!task) throw new Error('候选任务没有成功建立')
    setPersistedComparisonPendingRewrites((current) => ({ ...current, [task.id]: { groupId: input.groupId } }))
    await refreshWorkspace()
    setNotice('候选生成任务已开始')
    return task
  }

  const deleteDraftCandidate = async (candidateId: string): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.deleteDraftCandidate(projectId, candidateId))
    setNotice('候选已删除')
  }

  const setDraftGroupDecision = async (input: { groupId: string; kind: DraftGroupDecisionKind; sourceId?: string | null; sourceIds?: string[]; content?: string }): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.setDraftGroupDecision({ projectId, ...input }))
  }

  const mergeDraftAlignmentGroups = async (groupIds: string[]): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.mergeDraftAlignmentGroups(projectId, groupIds))
    setNotice('所选相邻对照组已合并')
  }

  const splitDraftAlignmentSelection = async (input: {
    groupId: string
    side: DraftComparisonSide
    paragraphIds: string[]
    strategy: DraftComparisonSplitStrategy
  }): Promise<void> => {
    if (!window.creatorOS) return
    const result = await window.creatorOS.startDraftAlignmentSplit({
      projectId,
      ...input,
      scope: comparisonSplitScope
    })
    setComparisonWorkspace(result.workspace)
    await refreshWorkspace()
    setNotice(result.task
      ? 'Codex正在推理对侧对应段落；完成后会自动拆分，当前内容不会提前变化'
      : input.strategy === 'original_order' ? '已按原顺序拆分' : '已提取到下方新组')
  }

  const moveDraftParagraph = async (input: { side: 'claude' | 'codex'; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.moveDraftParagraph({ projectId, ...input }))
  }

  const moveDraftParagraphs = async (moves: Array<{ side: 'claude' | 'codex'; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }>): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.moveDraftParagraphs({ projectId, moves }))
  }

  const moveDraftCandidate = async (candidateId: string, toGroupId: string): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.moveDraftCandidate(projectId, candidateId, toGroupId))
  }
  const reorderDraftCandidates = async (groupId: string, candidateIds: string[]): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.reorderDraftCandidates(projectId, groupId, candidateIds))
  }
  const reorderDraftGroups = async (groupIds: string[]): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.reorderDraftAlignmentGroups(projectId, groupIds))
  }
  const setDraftGroupNote = async (groupId: string, note: string): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.setDraftGroupNote(projectId, groupId, note))
  }
  const setDraftGroupMarkers = async (groupId: string, nextMarkers: NonNullable<DraftAlignmentGroup['decision']>['markers']): Promise<void> => {
    if (!window.creatorOS) return
    setComparisonWorkspace(await window.creatorOS.setDraftGroupMarkers(projectId, groupId, nextMarkers))
  }
  const restoreDraftComparisonHistory = async (historyId: string): Promise<void> => {
    if (!window.creatorOS) return
    const workspace = await window.creatorOS.restoreDraftComparisonHistory(projectId, historyId)
    setComparisonWorkspace(workspace)
    setComparisonHistory(await window.creatorOS.listDraftComparisonHistory(projectId))
    setNotice('已回到所选操作记录；之后的记录仍然保留')
  }

  const persistDraftComparisonCurrentBase = async (expectedFingerprint: string): Promise<boolean> => {
    if (!window.creatorOS || !editor) return false
    const snapshot = await currentScript.flush()
    if (!snapshot) return false
    if (
      canonicalCurrentScriptValue(editor.getJSON()) !== expectedFingerprint
      || canonicalCurrentScriptValue(snapshot.document.editorDocument) !== expectedFingerprint
    ) return false
    const next = await window.creatorOS.setDraftComparisonCurrentDocumentBase(
      projectId,
      snapshot.document.revision,
      snapshot.document.contentHash
    )
    setComparisonWorkspace(next)
    return canonicalCurrentScriptValue(editor.getJSON()) === expectedFingerprint
  }

  const adoptCurrentDocumentAsDraftComparisonBase = async (expectedFingerprint: string): Promise<boolean> => {
    if (!editor || !requireCurrentScriptEditorEditable()) return false
    if (canonicalCurrentScriptValue(editor.getJSON()) !== expectedFingerprint) return false
    return persistDraftComparisonCurrentBase(expectedFingerprint)
  }

  const applyDraftComparison = (
    content: string,
    expectedCurrentFingerprint: string,
    allowStructuralReplacement = false,
    sourceAnnotations: DraftComparisonSourceAnnotationProjection[] = []
  ): DraftComparisonCurrentDocumentApplyResult => {
    if (!editor || !requireCurrentScriptEditorEditable()) return { status: 'stale' }
    if (canonicalCurrentScriptValue(editor.getJSON()) !== expectedCurrentFingerprint) return { status: 'stale' }
    const normalizedContent = normalizedCurrentDocumentText(content)
    const normalizedCurrent = normalizedCurrentDocumentText(editor.getText({ blockSeparator: '\n\n' }))
    if (normalizedContent === normalizedCurrent) {
      const expectedFingerprint = canonicalCurrentScriptValue(editor.getJSON())
      return {
        status: 'applied',
        fingerprint: expectedFingerprint,
        baselinePersisted: persistDraftComparisonCurrentBase(expectedFingerprint)
      }
    }
    const previousHtml = editor.getHTML()
    if (!applySafeDraftComparisonTextPatch(editor, content)) {
      if (!allowStructuralReplacement) return { status: 'confirmation_required' }
      if (!editor.commands.setContent(plainTextToHtml(content))) {
        setNotice('双稿选择没有写入当前文案，请稍后重试')
        return { status: 'stale' }
      }
    }
    const migratedSourceAnnotationIds = new Set<string>()
    const annotationTransaction = editor.state.tr
    sourceAnnotations.forEach(({ annotation, sourceBlockText }) => {
      const normalizedBlockText = markdownToReadableText(sourceBlockText).replace(/\s+/g, ' ').trim()
      const normalizedSelectedText = markdownToReadableText(annotation.selectedText).replace(/\s+/g, ' ').trim()
      if (!normalizedBlockText || !normalizedSelectedText) return
      const blockRanges = normalizedTextRangesInDocument(annotationTransaction.doc, normalizedBlockText)
      if (blockRanges.length !== 1) return
      const blockRange = blockRanges[0]!
      const selectedRanges = normalizedTextRangesInDocument(annotationTransaction.doc, normalizedSelectedText)
        .filter((range) => range.from >= blockRange.from && range.to <= blockRange.to)
      if (selectedRanges.length !== 1) return
      const selectedRange = selectedRanges[0]!
      const markType = annotationTransaction.doc.type.schema.marks[annotation.style === 'flag' ? 'scriptMarker' : annotation.style]
      if (!markType) return
      const annotationId = `current-${annotation.id}`.slice(0, 128)
      const attrs = annotation.style === 'flag'
        ? { markerId: annotationId, markerNote: annotation.note || null, markerBlockId: null }
        : {
            annotationId,
            annotationNote: annotation.note || null,
            annotationBlockId: null,
            ...(annotation.style === 'highlight' ? { color: '#F3D9A3' } : {})
          }
      annotationTransaction.addMark(selectedRange.from, selectedRange.to, markType.create(attrs))
      migratedSourceAnnotationIds.add(annotation.id)
    })
    if (annotationTransaction.docChanged) editor.view.dispatch(annotationTransaction)
    if (window.creatorOS && sourceAnnotations.length) {
      void Promise.all(sourceAnnotations.map(({ annotation }) => window.creatorOS!.upsertSourceScriptAnnotation({
        projectId: annotation.projectId,
        sourceKind: annotation.sourceKind === 'comparison_candidate' ? 'comparison_candidate' : 'comparison_source',
        sourceId: annotation.sourceId,
        sourceVersion: annotation.sourceVersion,
        id: annotation.id,
        blockId: annotation.blockId,
        blockStart: annotation.blockStart,
        blockEnd: annotation.blockEnd,
        selectedText: annotation.selectedText,
        style: annotation.style,
        note: annotation.note,
        status: migratedSourceAnnotationIds.has(annotation.id) ? 'active' : 'not_migrated'
      }))).catch(() => setNotice('来源标记的迁移状态保存失败，当前文案内容已保留'))
    }
    const expectedFingerprint = canonicalCurrentScriptValue(editor.getJSON())
    setComparisonUndoHtml((current) => current ?? previousHtml)
    anchorWorkbenchViewport()
    setNotice('双稿选择已应用到当前文案；保存后才会建立新版本')
    return {
      status: 'applied',
      fingerprint: expectedFingerprint,
      baselinePersisted: persistDraftComparisonCurrentBase(expectedFingerprint)
    }
  }

  const undoDraftComparisonApply = (): void => {
    if (!editor || !comparisonUndoHtml) return
    if (!requireCurrentScriptEditorEditable()) return
    if (!editor.commands.setContent(comparisonUndoHtml)) {
      setNotice('本次双稿应用已经不能撤销')
      return
    }
    const expectedFingerprint = canonicalCurrentScriptValue(editor.getJSON())
    void persistDraftComparisonCurrentBase(expectedFingerprint).then((persisted) => {
      if (!persisted) setNotice('撤销已保留，但当前文案又有变化；对照整理同步前会再次确认。')
    }).catch((reason) => setNotice(reason instanceof Error ? reason.message : '对照整理基线保存失败'))
    anchorWorkbenchViewport()
    setComparisonUndoHtml(null)
    setNotice('已撤销本次双稿应用')
  }

  const saveCurrent = async (finalize = false): Promise<void> => {
    if (!window.creatorOS || !editor || !project) return
    if (savingRef.current) {
      setNotice('当前文案正在保存，请稍候。')
      return
    }
    if (workspaceLoadError || currentScript.phase !== 'ready' || currentScript.recoveryCandidates.length) {
      setNotice(currentScript.recoveryCandidates.length ? '请先处理未保存副本，再保存或定稿。' : '当前文案尚未载入，请先重试。')
      return
    }
    if (materialSnapshotReadOnly) {
      setNotice('这是历史版本的冻结工作台；请先恢复为新的当前版本再修改或定稿。')
      return
    }
    savingRef.current = true
    setCurrentScriptEditorOperationLocked(editor, true)
    setSaving(true)
    try {
      if (finalize && materialWorkspace?.activeRevision && !draftVersionId) {
        const gate = await window.creatorOS.getScriptMaterialFinalizationGate(
          project.id,
          editor.getText({ blockSeparator: '\n\n' })
        )
        if (!gate.canFinalize) {
          setNotice(gate.message)
          return
        }
      }
      const savedVersion = draftVersionId
        ? null
        : await currentScript.saveVersion('merged_draft', versionName.trim() || undefined, finalize)
      const version = draftVersionId
        ? finalize
          ? await window.creatorOS.saveAndFinalizeScript(project.id, editor.getHTML(), draftVersionId, versionName.trim() || undefined)
          : await window.creatorOS.saveScript(project.id, 'merged_draft', editor.getHTML(), draftVersionId, versionName.trim() || undefined)
        : savedVersion
      if (!version) {
        setNotice(currentScript.error || '当前文案尚未保存，请先处理页面中的保存提示。')
        return
      }
      const versionLabel = version.displayName || `文案v${version.revision}`
      const message = finalize ? `${versionLabel}已定稿` : `${versionLabel}已保存`
      if (draftVersionId) {
        if (await window.creatorOS.getScriptMaterialVersionSnapshot(project.id, version.id)) {
          await window.creatorOS.restoreScriptMaterialVersionSnapshot(project.id, version.id)
        }
        window.sessionStorage.setItem(`workbench-pending-notice:${projectId}`, message)
        window.setTimeout(() => navigate({
          page: 'workbench',
          projectId,
          workbenchMode: comparisonKind === 'materials' ? 'materials' : undefined
        }), 0)
      } else {
        setNotice(message)
        setVersionName('')
        setProject(await window.creatorOS.getProject(project.id))
      }
      await refreshWorkspace()
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '保存文案失败') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const restoreHistoricalMaterialVersion = async (): Promise<void> => {
    if (!window.creatorOS || !editor || !project || !requestedScriptVersion || !materialSnapshotReadOnly) return
    setSaving(true)
    try {
      window.sessionStorage.setItem(`workbench-pending-current-script-restore:${projectId}`, JSON.stringify({
        content: requestedScriptVersion.workspaceContent ?? requestedScriptVersion.content,
        versionId: requestedScriptVersion.id,
        displayName: `${requestedScriptVersion.displayName || `文案v${requestedScriptVersion.revision}`}恢复`
      }))
      window.setTimeout(() => navigate({ page: 'workbench', projectId, workbenchMode: 'materials' }), 0)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '历史版本恢复失败')
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        const target = event.target as HTMLElement | null
        const currentScriptVisible = primaryView === 'conversation'
          || (primaryView === 'comparison' && comparisonKind === 'materials')
          || (primaryView === 'comparison' && comparisonKind === 'drafts' && draftSurface === 'current')
          || (primaryView === 'versions' && versionSurface === 'current')
        const editingOutsideCurrentScript = Boolean(
          target?.closest('textarea, input, [contenteditable="true"]')
          && !target.closest('.current-script-pane')
        )
        if (!currentScriptVisible || editingOutsideCurrentScript) setNotice('当前编辑区有自己的保存入口；没有保存隐藏的当前文案。')
        else if (materialSnapshotReadOnly) setNotice('历史版本是只读快照；请先恢复为新的当前版本。')
        else if (savingRef.current) setNotice('当前文案正在保存，请稍候。')
        else if (workspaceLoadError || currentScript.phase !== 'ready' || currentScript.recoveryCandidates.length) setNotice(currentScript.recoveryCandidates.length ? '请先处理未保存副本，再保存或定稿。' : '当前文案尚未载入，请先重试。')
        else void saveCurrent(event.shiftKey)
        return
      }
      const currentScriptVisible = primaryView === 'conversation'
        || (primaryView === 'comparison' && comparisonKind === 'materials')
        || (primaryView === 'comparison' && comparisonKind === 'drafts' && draftSurface === 'current')
        || (primaryView === 'versions' && versionSurface === 'current')
      if (key !== 'z' || !editor || !currentScriptVisible || materialSnapshotReadOnly) return
      const target = event.target as HTMLElement | null
      if (target?.closest('.current-script-pane [contenteditable="true"]')) return
      if (!currentScriptEditorEditable) {
        event.preventDefault()
        setNotice('当前文案正在保存或等待处理冲突，现在不能撤销。')
        return
      }
      if (target?.closest('textarea, input, [contenteditable="true"]') && !target.closest('.current-script-pane')) return
      event.preventDefault()
      if (event.shiftKey) editor.commands.redo()
      else editor.commands.undo()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [comparisonKind, currentScriptEditorEditable, draftSurface, editor, materialSnapshotReadOnly, primaryView, project, versionName, versionSurface]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const openQuickLocator = (): void => {
      if (workbenchView === 'comparison') {
        setNotice('对照筛选没有对话定位列表')
        return
      }
      const provider = workbenchView === 'single'
        ? singleProvider === 'claude' ? 'claude_cli' : 'codex_cli'
        : activeConversationProvider
      if (provider === 'claude_cli' && (!claudeAvailable || claudePaneMode !== 'ai')) {
        setNotice('Claude自由稿没有消息定位；切换到AI对话后可使用⌘J')
        return
      }
      setLocatorProvider(provider)
    }
    const unsubscribe = window.creatorOS?.onWorkbenchQuickLocatorRequested(openQuickLocator)
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        openQuickLocator()
        return
      }
      if (event.key !== 'Escape') return
      if (immersive) {
        event.preventDefault()
        setImmersive(false)
      } else if (locatorProvider) {
        event.preventDefault()
        setLocatorProvider(null)
      } else if (comparisonOpen) {
        event.preventDefault()
        setComparisonOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      unsubscribe?.()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeConversationProvider, claudeAvailable, claudePaneMode, comparisonOpen, immersive, locatorProvider, singleProvider, workbenchView])

  const exportWord = async (): Promise<void> => {
    if (!window.creatorOS || !editor || !project) return
    setMoreOpen(false)
    try { const result = await window.creatorOS.exportScriptWord(project.id, project.title, stripScriptWorkbenchAnnotations(editor.getHTML())); if (!result.canceled) setNotice('Word文案已导出到所选位置') }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Word文案导出失败') }
  }
  const importScript = async (): Promise<void> => {
    if (!window.creatorOS) return
    setMoreOpen(false)
    try {
      const result = await window.creatorOS.importScript(projectId)
      if (!result.canceled && result.version) { setNotice('外部文案已导入，原文件保持不变'); navigate({ page: 'workbench', projectId, draftVersionId: result.version.id }) }
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '导入文案失败') }
  }

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = layoutRef.current?.getBoundingClientRect()
    if (!rect || !dragRef.current) return
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left)) / rect.width * 100
    if (dragRef.current === 'document') setDocumentSplit(Math.max(50, Math.min(80, x)))
    else setModelSplit(Math.max(25, Math.min(75, x / (documentSplit / 100) * 100)))
  }
  const stopDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (dragRef.current) persistLayout({ workbenchModelSplit: modelSplit, workbenchMergedSplit: documentSplit })
    dragRef.current = null; document.body.classList.remove('is-resizing')
  }
  const beginDrag = (kind: 'models' | 'document', event: React.PointerEvent<HTMLDivElement>): void => { dragRef.current = kind; event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add('is-resizing') }
  const adjustDivider = (kind: 'models' | 'document', event: React.KeyboardEvent<HTMLDivElement>): void => {
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0
    if (!direction && event.key !== 'Home') return
    event.preventDefault()
    if (kind === 'models') { const next = event.key === 'Home' ? 50 : Math.max(25, Math.min(75, modelSplit + direction * 2)); setModelSplit(next); persistLayout({ workbenchModelSplit: next }) }
    else { const next = event.key === 'Home' ? 67 : Math.max(50, Math.min(80, documentSplit + direction * 2)); setDocumentSplit(next); persistLayout({ workbenchMergedSplit: next }) }
  }

  const modelArea = documentSplit
  const paneStyles = {
    '--claude-basis': `${modelArea * modelSplit / 100}%`,
    '--codex-basis': `${modelArea * (100 - modelSplit) / 100}%`,
    '--merged-basis': `${100 - modelArea}%`,
    '--single-ai-basis': `${documentSplit}%`,
    '--single-document-basis': `${100 - documentSplit}%`
  } as React.CSSProperties
  const allCandidates = providers.flatMap((provider) => conversations[provider].messages).filter((message) => message.role === 'assistant' && message.suggestion)
  const selectedCandidates = allCandidates.filter((message) => selectedCandidateIds.has(message.id))
  const currentDocumentState: 'loading' | 'empty' | 'ready' = loading || !editor
    || (!draftVersionId && currentScript.phase !== 'ready')
    ? 'loading'
    : editor.getText().trim()
      ? 'ready'
      : 'empty'
  const applyMaterialDraftContent = (
    draft: ScriptMaterialDraft,
    mode: 'replace' | 'append' | 'insert',
    paragraphIds?: string[],
    insertPosition?: number,
    sourceAnnotations: ScriptTextAnnotation[] = []
  ): boolean => {
    if (!editor || !requireCurrentScriptEditorEditable()) return false
    const appliedParagraphs = paragraphIds?.length
      ? draft.paragraphs.filter((paragraph) => paragraphIds.includes(paragraph.id))
      : draft.paragraphs
    if (!appliedParagraphs.length) {
      setNotice('所选AI稿段落已经变化，请重新选择。')
      return false
    }
    const appliedContent = paragraphIds?.length
      ? appliedParagraphs.map((paragraph) => paragraph.text).join('\n\n')
      : draft.content
    const wasEmpty = !editor.getText().trim()
    const previousHtml = editor.getHTML()
    const previousContentSize = editor.state.doc.content.size
    const boundedPosition = Math.max(0, Math.min(editor.state.doc.content.size, insertPosition ?? editor.state.doc.content.size))
    let searchFrom = mode === 'append'
      ? Math.max(0, previousContentSize - 1)
      : mode === 'insert'
        ? Math.max(0, boundedPosition - 1)
        : 0
    const relationIds: string[] = []
    const migratedAnnotationIds = new Set<string>()
    let selectionEnd: number | null = null
    const chain = mode === 'replace'
      ? editor.chain().setContent(plainTextToHtml(appliedContent))
      : mode === 'append'
        ? editor.chain().setContent(`${editor.getHTML()}${plainTextToHtml(appliedContent)}`)
        : editor.chain().insertContentAt(boundedPosition, plainTextToHtml(appliedContent), { updateSelection: true })
    const applied = chain.command(({ tr, dispatch }) => {
      if (!dispatch) return true
      const relationType = tr.doc.type.schema.marks.scriptMaterialRelation
      if (!relationType) return false
      appliedParagraphs.forEach((paragraph) => {
        const visibleText = markdownToReadableText(paragraph.text).replace(/\s+/g, ' ').trim()
        const range = normalizedTextRangesInDocument(tr.doc, visibleText).find((candidate) => candidate.from >= searchFrom)
        if (!range) return
        const relationId = crypto.randomUUID()
        relationIds.push(relationId)
        tr.addMark(range.from, range.to, relationType.create({
          relationId,
          draftId: draft.id,
          draftParagraphIds: paragraph.id,
          sourcePointIds: paragraph.sourcePointIds.join(','),
          sourcePointVersion: materialWorkspace?.activeRevision?.id ?? null
        }))
        const paragraphAnnotations = sourceAnnotations.filter((annotation) => (
          annotation.sourceKind === 'material_draft'
          && annotation.sourceId === draft.id
          && annotation.sourceVersion === draft.contentHash
          && annotation.blockId === paragraph.id
          && annotation.blockStart >= 0
          && annotation.blockEnd <= paragraph.text.length
          && paragraph.text.slice(annotation.blockStart, annotation.blockEnd) === annotation.selectedText
        ))
        paragraphAnnotations.forEach((annotation) => {
          const normalizedSelected = markdownToReadableText(annotation.selectedText).replace(/\s+/g, ' ').trim()
          const sourceVisible = markdownToReadableText(paragraph.text).replace(/\s+/g, ' ').trim()
          if (!normalizedSelected || sourceVisible.split(normalizedSelected).length !== 2) return
          const annotationRanges = normalizedTextRangesInDocument(tr.doc, normalizedSelected)
            .filter((candidate) => candidate.from >= range.from && candidate.to <= range.to)
          if (annotationRanges.length !== 1) return
          const annotationRange = annotationRanges[0]!
          const annotationId = `script-annotation-${crypto.randomUUID()}`
          const markType = tr.doc.type.schema.marks[annotation.style === 'flag' ? 'scriptMarker' : annotation.style]
          if (!markType) return
          const attrs = annotation.style === 'flag'
            ? { markerId: annotationId, markerNote: annotation.note || null, markerBlockId: null }
            : {
                annotationId,
                annotationNote: annotation.note || null,
                annotationBlockId: null,
                ...(annotation.style === 'highlight' ? { color: '#F3D9A3' } : {})
              }
          tr.addMark(annotationRange.from, annotationRange.to, markType.create(attrs))
          migratedAnnotationIds.add(annotation.id)
        })
        addContentFactMarks(tr, range, paragraph.text, paragraph.annotations)
        searchFrom = range.to
        selectionEnd = range.to
      })
      if (selectionEnd !== null) tr.setSelection(TextSelection.create(tr.doc, Math.min(tr.doc.content.size, selectionEnd)))
      closeHistory(tr)
      return true
    }).run()
    if (!applied) {
      setNotice('AI稿没有写入当前文案，请稍后重试')
      return false
    }
    const relevantSourceAnnotations = sourceAnnotations.filter((annotation) => (
      annotation.sourceKind === 'material_draft'
      && annotation.sourceId === draft.id
      && annotation.sourceVersion === draft.contentHash
      && appliedParagraphs.some((paragraph) => paragraph.id === annotation.blockId)
    ))
    if (window.creatorOS && relevantSourceAnnotations.length) {
      void Promise.all(relevantSourceAnnotations.map((annotation) => window.creatorOS!.upsertSourceScriptAnnotation({
        projectId: annotation.projectId,
        sourceKind: 'material_draft',
        sourceId: annotation.sourceId,
        sourceVersion: annotation.sourceVersion,
        id: annotation.id,
        blockId: annotation.blockId,
        blockStart: annotation.blockStart,
        blockEnd: annotation.blockEnd,
        selectedText: annotation.selectedText,
        style: annotation.style,
        note: annotation.note,
        status: migratedAnnotationIds.has(annotation.id) ? 'active' : 'not_migrated'
      }))).catch(() => setNotice('来源标记的迁移状态保存失败，当前文案内容已保留'))
    }
    setComparisonUndoHtml(previousHtml)
    editor.view.dispatch(closeHistory(editor.state.tr))
    setRevisionSelection(null)
    setActiveTargetId(null)
    setMaterialRelationFocus({
      token: crypto.randomUUID(),
      origin: 'draft',
      draftId: draft.id,
      draftParagraphIds: appliedParagraphs.map((paragraph) => paragraph.id),
      sourcePointIds: [...new Set(appliedParagraphs.flatMap((paragraph) => paragraph.sourcePointIds))]
    })
    window.requestAnimationFrame(() => {
      const relation = relationIds.at(-1)
      if (relation) editor.view.dom.querySelector<HTMLElement>(`[data-script-material-relation-id="${relation}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    setNotice(mode === 'replace'
      ? wasEmpty
        ? `已用第${draft.draftVersion}稿建立当前文案，并保留来源关系。`
        : `已用第${draft.draftVersion}稿替换当前文案，并保留来源关系。`
      : mode === 'insert'
        ? `已把第${draft.draftVersion}稿所选${appliedParagraphs.length}段插入指定位置，并保留来源关系。`
      : paragraphIds?.length
        ? `已把第${draft.draftVersion}稿所选${appliedParagraphs.length}段追加到当前文案末尾，并保留来源关系。`
        : `已把第${draft.draftVersion}稿追加到当前文案末尾。`)
    return true
  }

  const applyMaterialDraft = (draft: ScriptMaterialDraft, mode: 'replace' | 'append', paragraphIds?: string[], annotations?: ScriptTextAnnotation[]): void => {
    applyMaterialDraftContent(draft, mode, paragraphIds, undefined, annotations)
  }

  const applyMaterialRewriteCandidate = (
    candidate: ScriptMaterialRewriteCandidate,
    modeOrInsertPosition?: 'append' | 'replace' | number
  ): void => {
    if (!editor || !candidate.content.trim() || !requireCurrentScriptEditorEditable()) return
    const explicitMode = typeof modeOrInsertPosition === 'string' ? modeOrInsertPosition : null
    const insertPosition = typeof modeOrInsertPosition === 'number' ? modeOrInsertPosition : undefined
    const mappedRanges = explicitMode !== 'append' && insertPosition === undefined
      && !candidate.selectedText
      && candidate.paragraphIds.length === 1
      ? materialRelationRanges(editor, candidate.draftId, candidate.paragraphIds[0]!)
      : []
    const replacementRange = mappedRanges.length === 1 ? mappedRanges[0]! : null
    const frozenTargetText = candidate.applicationTarget?.selectedText
      ?? (candidate.sourceSelections.length === 1 ? candidate.sourceSelections[0]!.selectedText : '')
    if (replacementRange && frozenTargetText) {
      const currentTargetText = editor.state.doc.textBetween(replacementRange.from, replacementRange.to, ' ').replace(/\s+/g, ' ').trim()
      if (currentTargetText !== frozenTargetText.replace(/\s+/g, ' ').trim()) {
        setNotice('原应用目标已变化，请重新选择后再生成。')
        return
      }
    }
    if (explicitMode === 'replace' && !replacementRange) {
      setNotice('原目标已变化或没有精确对应，请重新选择后再替换。')
      return
    }
    const fallbackPosition = Math.max(0, Math.min(
      editor.state.doc.content.size,
      explicitMode === 'append' ? editor.state.doc.content.size : insertPosition ?? editor.state.selection.from
    ))
    const insertionStart = replacementRange?.from ?? fallbackPosition
    const previousHtml = editor.getHTML()
    const applied = editor.commands.insertContentAt(
      replacementRange ?? fallbackPosition,
      plainTextToHtml(candidate.content),
      { updateSelection: true }
    )
    if (!applied) {
      setNotice('局部候选没有写入当前文案，请稍后重试')
      return
    }
    setComparisonUndoHtml(previousHtml)
    const visibleText = markdownToReadableText(candidate.content).replace(/\s+/g, ' ').trim()
    const range = normalizedTextRanges(editor, visibleText)
      .find((item) => item.from >= Math.max(0, insertionStart - 1))
    if (range) {
      const relationId = crypto.randomUUID()
      editor.chain()
        .setTextSelection(range)
        .setMark('scriptMaterialRelation', {
          relationId,
          draftId: candidate.draftId,
          draftParagraphIds: candidate.paragraphIds.join(','),
          sourcePointIds: candidate.sourcePointIds.join(','),
          sourcePointVersion: materialWorkspace?.activeRevision?.id ?? null
        })
        .run()
      editor.commands.setTextSelection(range.to)
      if (candidate.annotations.length) {
        const transaction = editor.state.tr
        addContentFactMarks(transaction, range, candidate.content, candidate.annotations.map((annotation) => ({
          id: annotation.id,
          start: annotation.start,
          end: annotation.end,
          text: annotation.text,
          provenance: annotation.provenance,
          note: annotation.note,
          webSources: annotation.webSources,
          evidenceIds: annotation.evidenceIds
        })))
        if (transaction.docChanged) editor.view.dispatch(transaction)
      }
      window.requestAnimationFrame(() => {
        editor.view.dom.querySelector<HTMLElement>(`[data-script-material-relation-id="${relationId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
    setRevisionSelection(null)
    setActiveTargetId(null)
    setMaterialRelationFocus({
      token: crypto.randomUUID(),
      origin: 'draft',
      draftId: candidate.draftId,
      draftParagraphIds: candidate.paragraphIds,
      sourcePointIds: candidate.sourcePointIds
    })
    setNotice(replacementRange
      ? '局部候选已替换当前文案中唯一对应的原段落，并保留来源关系。'
      : insertPosition === undefined
        ? '局部候选已插入当前光标位置，并保留原AI段落与素材来源关系。'
        : '局部候选已插入拖放位置，并保留原AI段落与素材来源关系。')
  }

  const materialDragPosition = (event: React.DragEvent<HTMLDivElement>): number | null => {
    if (!editor || (!event.dataTransfer.types.includes(SCRIPT_MATERIAL_DRAG_MIME)
      && !event.dataTransfer.types.includes(SCRIPT_MATERIAL_CANDIDATE_DRAG_MIME))) return null
    return editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null
  }

  const dragMaterialOverCurrentDocument = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!currentScriptEditorEditable) return
    const position = materialDragPosition(event)
    if (position === null || !editor) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!materialDropActive) setMaterialDropActive(true)
    editor.commands.setTextSelection(position)
    editor.view.focus()
  }

  const dropMaterialIntoCurrentDocument = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!requireCurrentScriptEditorEditable()) return
    const position = materialDragPosition(event)
    if (position === null) return
    event.preventDefault()
    event.stopPropagation()
    setMaterialDropActive(false)
    try {
      if (event.dataTransfer.types.includes(SCRIPT_MATERIAL_CANDIDATE_DRAG_MIME)) {
        const payload = JSON.parse(event.dataTransfer.getData(SCRIPT_MATERIAL_CANDIDATE_DRAG_MIME)) as Partial<ScriptMaterialCandidateDragPayload>
        const candidate = materialWorkspace?.rewriteCandidates.find((item) => item.id === payload.candidateId)
        if (!candidate?.content.trim()) throw new Error('拖动的局部候选已经变化，请重新打开')
        applyMaterialRewriteCandidate(candidate, position)
        return
      }
      const payload = JSON.parse(event.dataTransfer.getData(SCRIPT_MATERIAL_DRAG_MIME)) as Partial<ScriptMaterialDragPayload>
      if (!payload.draftId || !Array.isArray(payload.paragraphIds) || !payload.paragraphIds.every((id) => typeof id === 'string')) {
        throw new Error('拖动的AI稿段落已经变化')
      }
      const draft = materialWorkspace?.drafts.find((item) => item.id === payload.draftId)
      if (!draft) throw new Error('拖动的AI稿已经变化，请重新选择')
      const annotations = Array.isArray(payload.annotations)
        ? payload.annotations.filter((annotation): annotation is ScriptTextAnnotation => Boolean(
          annotation && typeof annotation === 'object' && typeof annotation.id === 'string'
        ))
        : []
      applyMaterialDraftContent(draft, 'insert', payload.paragraphIds, position, annotations)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'AI稿段落插入失败')
    }
  }

  const locateMaterialRelationFromCurrent = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (!target?.closest('.tiptap')) return
    const relation = target.closest<HTMLElement>('[data-script-material-relation-id]')
    if (!relation) {
      setNotice('这段是当前文案新增，暂未建立原稿对应。')
      return
    }
    const draftId = relation.dataset.scriptMaterialDraftId ?? null
    const draftParagraphIds = (relation.dataset.scriptMaterialDraftParagraphIds ?? '').split(',').filter(Boolean)
    const persistedSourcePointIds = (relation.dataset.scriptMaterialSourcePointIds ?? '').split(',').filter(Boolean)
    const sourcePointIds = persistedSourcePointIds.length
      ? persistedSourcePointIds
      : [...new Set((materialWorkspace?.drafts ?? [])
        .filter((draft) => !draftId || draft.id === draftId)
        .flatMap((draft) => draft.paragraphs)
        .filter((paragraph) => draftParagraphIds.includes(paragraph.id))
        .flatMap((paragraph) => paragraph.sourcePointIds))]
    setMaterialRelationFocus({
      token: crypto.randomUUID(),
      origin: 'current',
      draftId,
      draftParagraphIds,
      sourcePointIds
    })
    setNotice(sourcePointIds.length
      ? '已定位到这段当前文案对应的AI稿与原始素材。'
      : '已定位到对应AI稿；这段暂时没有可靠的原始素材对应。')
  }

  const materialCurrentDocumentEmpty = currentDocumentState === 'empty' && primaryView === 'comparison' && comparisonKind === 'materials'
  const materialCurrentDocumentSurface = primaryView === 'comparison' && comparisonKind === 'materials'
  const effectiveConversationTab: ConversationWorkbenchTab = workbenchView === 'single' && conversationTab !== 'current'
    ? singleProvider
    : conversationTab
  const currentScriptStatus = workspaceLoadError
    ? { className: 'error', label: '载入失败' }
    : currentScript.phase === 'loading' || currentScript.phase === 'disabled'
    ? { className: 'saving', label: '正在载入' }
    : currentScript.phase === 'selection_required'
      ? { className: 'unsaved', label: '等待选择起点' }
      : currentScript.phase === 'confirmation_required'
        ? { className: 'unsaved', label: '等待确认标记' }
        : currentScript.phase === 'error'
          ? { className: 'error', label: '载入失败' }
          : currentScript.recoveryCandidates.length > 0
            ? { className: 'conflict', label: '等待处理冲突' }
            : currentScript.saveState === 'saving'
            ? { className: 'saving', label: '正在保存' }
            : currentScript.saveState === 'unsaved'
              ? { className: 'unsaved', label: '待自动保存' }
              : currentScript.saveState === 'error'
                ? { className: 'error', label: '保存失败' }
                : currentScript.saveState === 'conflict'
                  ? { className: 'conflict', label: '等待处理冲突' }
                  : { className: 'saved', label: '已自动保存' }
  const locateAuditFindingParagraph = (paragraphId: string): void => {
    if (!editor) return
    const position = Number.parseInt(paragraphId.replace(/^current-/, ''), 10)
    const node = Number.isFinite(position) ? editor.state.doc.nodeAt(position) : null
    if (!node?.isTextblock) {
      setNotice('这条检查对应的段落位置已经变化，请更新检查。')
      return
    }
    editor.chain().focus().setTextSelection({
      from: Math.min(editor.state.doc.content.size, position + 1),
      to: Math.min(editor.state.doc.content.size, position + Math.max(1, node.nodeSize - 1))
    }).scrollIntoView().run()
    setNotice('已选中待确认补充所在段落，可以直接改写；修改后检查会显示为过期。')
  }
  const deleteAuditFindingParagraph = (paragraphId: string): void => {
    if (!editor) return
    if (!requireCurrentScriptEditorEditable()) return
    const position = Number.parseInt(paragraphId.replace(/^current-/, ''), 10)
    const node = Number.isFinite(position) ? editor.state.doc.nodeAt(position) : null
    if (!node?.isTextblock) {
      setNotice('这条检查对应的段落位置已经变化，请更新检查。')
      return
    }
    editor.view.dispatch(editor.state.tr.delete(position, Math.min(editor.state.doc.content.size, position + node.nodeSize)))
    editor.commands.focus()
    setNotice('对应段落已删除；请更新检查后再定稿。')
  }
  const pendingCurrentRewrite = activeCurrentRewriteTaskId
    ? pendingCurrentRewrites.find((item) => item.taskId === activeCurrentRewriteTaskId) ?? null
    : null
  const pendingCurrentRewriteMessage = pendingCurrentRewrite
    ? conversations.codex_cli.messages.find((message) => message.role === 'assistant' && message.taskId === pendingCurrentRewrite.taskId && message.suggestion) ?? null
    : null
  const currentRewriteTargetRange = (pending: PendingCurrentRewrite): { from: number; to: number } | null => {
    if (!editor) return null
    const targetId = pending.applyTarget.targetSelectionId
    const ranges = targetId ? targetRanges(editor, targetId) : exactRanges(editor, pending.applyTarget.selectedText)
    if (ranges.length !== 1) return null
    const actual = editor.state.doc.textBetween(ranges[0]!.from, ranges[0]!.to, ' ').replace(/\s+/g, ' ').trim()
    return actual === pending.applyTarget.selectedText.replace(/\s+/g, ' ').trim() ? ranges[0]! : null
  }
  const pendingCurrentRewriteTargetChangedFor = (pending: PendingCurrentRewrite): boolean => !currentRewriteTargetRange(pending)
  const pendingCurrentRewriteTargetChanged = Boolean(pendingCurrentRewrite && pendingCurrentRewriteTargetChangedFor(pendingCurrentRewrite))
  const applyCurrentRewriteCandidate = async (pending: PendingCurrentRewrite, message: ScriptRevisionMessage, action: 'replace' | 'insert_after'): Promise<void> => {
    if (!window.creatorOS || !editor || !message.suggestion) throw new Error('当前候选不可用')
    if (!requireCurrentScriptEditorEditable()) throw new Error('当前文案暂时不能修改')
    const range = currentRewriteTargetRange(pending)
    if (!range) throw new Error('原应用目标已变化，请重新选择后再生成')
    const applied = action === 'replace'
      ? editor.chain().focus().insertContentAt(range, message.suggestion.replacementText).run()
      : editor.chain().focus().insertContentAt(range.to, message.suggestion.replacementText).run()
    if (!applied) throw new Error('候选没有写入当前文案，请稍后重试')
    if (action === 'replace' && pending.applyTarget.targetSelectionId) {
      editor.chain().setTextSelection({ from: range.from, to: range.from + message.suggestion.replacementText.length })
        .setHighlight({ targetSelectionId: pending.applyTarget.targetSelectionId } as never).run()
    }
    const insertedFrom = action === 'replace' ? range.from : range.to
    const insertedRange = normalizedTextRanges(editor, message.suggestion.replacementText)
      .find((candidate) => candidate.from >= Math.max(0, insertedFrom - 1))
    if (insertedRange && message.factAnnotations.length) {
      const transaction = editor.state.tr
      addContentFactMarks(transaction, insertedRange, message.suggestion.replacementText, message.factAnnotations)
      if (transaction.docChanged) editor.view.dispatch(transaction)
    }
    await window.creatorOS.setScriptRevisionSuggestionStatus(projectId, message.id, 'applied')
    setAppliedRevisionMessageId(message.id)
    setActiveTargetId(pending.applyTarget.targetSelectionId)
    setNotice('候选已应用到当前文案；保存后才会建立新版本')
    await loadConversations()
  }
  const removeCurrentRewrite = (taskId: string): void => {
    setPendingCurrentRewrites((current) => current.filter((item) => item.taskId !== taskId))
    setActiveCurrentRewriteTaskId((current) => current === taskId ? null : current)
  }
  const standaloneCurrentDocumentTabPanel = isWorkbenchNarrow && !(primaryView === 'comparison' && comparisonKind === 'materials')
  const currentDocumentPane = <section id="current-script-panel" role={standaloneCurrentDocumentTabPanel ? 'tabpanel' : undefined} aria-labelledby={standaloneCurrentDocumentTabPanel ? 'current-script-panel-tab' : undefined} hidden={isWorkbenchNarrow && primaryView === 'conversation' && effectiveConversationTab !== 'current'} className={`workbench-pane current-script-pane${formatToolbarOpen ? ' toolbar-open' : ''}${materialCurrentDocumentEmpty ? ' is-document-empty' : ''}${materialSnapshotReadOnly ? ' is-read-only-snapshot' : ''}${primaryView === 'conversation' && effectiveConversationTab === 'current' ? ' mobile-active' : ''}`}>
    <header><div><span>{materialSnapshotReadOnly ? '历史快照' : '可编辑'}</span><h2>当前文案</h2></div><div className="merged-pane-tools">
      {materialCurrentDocumentSurface && materialWorkspace?.activeRevision && (!draftVersionId || historicalMaterialSnapshotAvailable) ? <ScriptMaterialAuditControl
        workspace={materialWorkspace}
        target="current"
        targetIdentity="current"
        contentHash={materialCurrentContentHash}
        contextStale={Boolean(materialWorkspace.activeRevision && materialWorkspace.workingContent !== materialWorkspace.activeRevision.content)}
        readOnlySnapshot={Boolean(draftVersionId && historicalMaterialSnapshotAvailable)}
        currentContent={editor?.getText({ blockSeparator: '\n\n' }) ?? ''}
        currentParagraphs={currentDocumentParagraphSnapshot(editor)}
        tasks={tasks}
        onWorkspaceChange={applyMaterialWorkspace}
        onNotice={setNotice}
        onEditFinding={!currentScriptEditorEditable ? undefined : locateAuditFindingParagraph}
        onDeleteFinding={!currentScriptEditorEditable ? undefined : deleteAuditFindingParagraph}
        onFinalizeRequested={!currentScriptEditorEditable ? undefined : () => saveCurrent(true)}
      /> : materialCurrentDocumentSurface && draftVersionId && !historicalMaterialSnapshotAvailable
        ? <span className="script-material-audit-unavailable" title="这个旧版本保存时尚未建立素材检查快照">历史版本无冻结检查</span>
        : null}
      {!materialSnapshotReadOnly ? <><button title="撤销⌘Z" aria-label="撤销" disabled={!currentScriptEditorEditable || !editor?.can().undo()} onClick={() => editor?.commands.undo()}><Undo2 size={13} /></button>
      <button title="重做⌘Shift Z" aria-label="重做" disabled={!currentScriptEditorEditable || !editor?.can().redo()} onClick={() => editor?.commands.redo()}><Redo2 size={13} /></button></> : null}
      <div className="script-marker-menu">
        <button className={markers.length ? 'has-markers' : ''} aria-label="查看文案标记" aria-expanded={markerListOpen} onClick={() => { setMarkerListOpen((value) => !value); setEditorContextMenu(null); setMarkerComposer(null) }}><Flag size={13} />{markers.length ? <span>{markers.length}</span> : null}</button>
        {markerListOpen ? <div className="script-marker-popover" role="dialog" aria-label="文案标记"><header><b>文案标记</b><button aria-label="关闭标记列表" onClick={() => setMarkerListOpen(false)}><X size={12} /></button></header>{markers.length ? <div>{markers.map((marker, index) => <button key={marker.id} onClick={() => locateMarker(marker)}><span>{index + 1}</span><div><b>{marker.text.slice(0, 42)}{marker.text.length > 42 ? '…' : ''}</b><small>{marker.note || '没有备注'}</small></div></button>)}</div> : <p>暂无标记</p>}</div> : null}
      </div>
      {!materialSnapshotReadOnly ? <button disabled={!currentScriptEditorEditable} aria-expanded={formatToolbarOpen} onClick={() => setFormatToolbarOpen((value) => !value)}><Highlighter size={13} />格式{formatToolbarOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button> : null}
      {!draftVersionId ? <><span className={`current-script-save-status ${currentScriptStatus.className}`} title={currentScript.error || undefined}>{currentScriptStatus.label}</span><span className="visually-hidden" aria-live="assertive" aria-atomic="true">{currentScript.error ? `${currentScriptStatus.label}：${currentScript.error}` : currentScriptStatus.label}</span></> : null}
      {currentScriptVersion ? <span className="link-count">{currentScriptVersion.displayName || `v${currentScriptVersion.revision}`}</span> : null}
    </div></header>
    {formatToolbarOpen ? <ScriptFormattingToolbar editor={editor} disabled={!currentScriptEditorEditable} /> : null}
    <div
      ref={currentEditorScrollRef}
      className={`editor-scroll${materialDropActive ? ' is-material-drop-target' : ''}`}
      onScroll={(event) => {
        if (currentEditorScrollTimerRef.current) clearTimeout(currentEditorScrollTimerRef.current)
        currentEditorPendingScrollRef.current = {
          projectId,
          surface: currentDocumentScrollSurface,
          value: Math.max(0, Math.round(event.currentTarget.scrollTop))
        }
        currentEditorScrollTimerRef.current = setTimeout(() => {
          flushCurrentEditorScroll()
        }, 160)
      }}
      onContextMenu={!currentScriptEditorEditable ? undefined : openEditorContextMenu}
      onClick={focusTargetFromDocument}
      onDoubleClick={locateMaterialRelationFromCurrent}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setMaterialDropActive(false)
      }}
      onDragOver={dragMaterialOverCurrentDocument}
      onDrop={dropMaterialIntoCurrentDocument}
      onMouseUp={captureRevisionSelection}
      onKeyUp={captureRevisionSelection}
    >{loading ? <div className="loading-state">正在载入…</div> : <>
      {materialCurrentDocumentEmpty ? <div className="current-script-empty-state" role="status"><FileInput size={17} /><span><b>当前文案还是空的</b><small>{materialSnapshotReadOnly ? '这是历史版本冻结状态；恢复为新的当前版本后才能编辑。' : '可以直接在下方开始写，或在AI稿中明确选择“以此稿建立当前文案”。AI稿不会自动写入。'}</small></span></div> : null}
      <EditorContent editor={editor} />
    </>}</div>
    {factEvidencePopover ? <div
      className="content-fact-evidence-popover"
      role="dialog"
      aria-label="联网证据"
      style={{ left: Math.max(8, Math.min(factEvidencePopover.x, window.innerWidth - 330)), top: Math.max(8, Math.min(factEvidencePopover.y + 8, window.innerHeight - 260)) }}
    ><header><span><b>联网证据</b><small>{factEvidencePopover.items[0]?.market}·核验至{factEvidencePopover.items[0]?.factAsOf.slice(0, 10)}</small></span><button aria-label="关闭联网证据" onClick={() => setFactEvidencePopover(null)}><X size={12} /></button></header><div>{factEvidencePopover.items.map((item) => <button key={item.id} onClick={() => void window.creatorOS?.openExternalLink(item.sourceUrl)}><span><b>{item.claim}</b><small>{item.sourceTitle}·{item.accessedAt.slice(0, 10)}{item.priceKind ? `·${item.priceKind}` : ''}</small></span><ExternalLink size={12} /></button>)}</div></div> : null}
    {currentScriptEditorEditable && editorContextMenu && editorSelectionStage === 'actions' ? <SelectionActionMenu
      anchor={currentEditorScrollRef.current}
      anchorPoint={{ x: editorContextMenu.x, y: editorContextMenu.y }}
      selectionLabel={`${editor?.state.doc.textBetween(editorContextMenu.from, editorContextMenu.to, ' ').replace(/\s+/g, ' ').trim().slice(0, 56) ?? ''}${editorContextMenu.to - editorContextMenu.from > 56 ? '…' : ''}`}
      onDismiss={() => setEditorContextMenu(null)}
      onRewrite={() => setEditorSelectionStage('rewrite')}
      onAnnotation={(style) => applyCurrentAnnotation(style)}
      onNote={() => setEditorSelectionStage('annotation')}
      onClear={clearCurrentAnnotations}
    ><button role="menuitem" onClick={() => { editor?.commands.undo(); setEditorContextMenu(null) }}><Undo2 size={13} />撤销</button><button role="menuitem" onClick={() => { editor?.commands.redo(); setEditorContextMenu(null) }}><Redo2 size={13} />重做</button></SelectionActionMenu> : null}
    {currentScriptEditorEditable && editorContextMenu && editorSelectionStage === 'rewrite' ? <RewriteRequestPanel
      anchor={currentEditorScrollRef.current}
      anchorPoint={{ x: editorContextMenu.x, y: editorContextMenu.y }}
      selectionLabel={`所选${editorContextMenu.to - editorContextMenu.from}字`}
      projectId={projectId}
      sessionScope={`current-script-rewrite:${projectId}`}
      models={codexModels}
      initialModel={preferredCodexModel}
      initialReasoningEffort="xhigh"
      busy={sending}
      submitDisabled={!codexAvailable}
      submitDisabledReason="请先验证Codex"
      onBack={() => setEditorSelectionStage('actions')}
      onDismiss={() => setEditorContextMenu(null)}
      onSubmit={(request) => void sendCurrentSelectionRewrite(request).catch((reason) => setNotice(reason instanceof Error ? reason.message : '候选生成失败'))}
    /> : null}
    {currentScriptEditorEditable && editorContextMenu && editorSelectionStage === 'annotation' ? <TextAnnotationMenu
      anchor={currentEditorScrollRef.current}
      anchorPoint={{ x: editorContextMenu.x, y: editorContextMenu.y }}
      note={editorAnnotationNote}
      onNoteChange={setEditorAnnotationNote}
      onApply={applyCurrentAnnotation}
      onClear={clearCurrentAnnotations}
      onDismiss={() => { setEditorContextMenu(null); setEditorSelectionStage('actions'); setEditorAnnotationNote('') }}
    /> : null}
    {pendingCurrentRewrites.length ? <aside className="selection-candidate-dock current-candidate-dock" aria-label="当前文案局部候选任务">
      <b>局部候选</b>
      <div>{pendingCurrentRewrites.map((pending, index) => {
        const message = conversations.codex_cli.messages.find((item) => item.role === 'assistant' && item.taskId === pending.taskId && item.suggestion)
        const task = tasks.find((item) => item.id === pending.taskId)
        const terminal = task?.status === 'failed' || task?.status === 'canceled'
        const label = message ? '已完成·查看' : task?.status === 'failed' ? '失败·移除' : task?.status === 'canceled' ? '已取消·移除' : '生成中'
        return <button key={pending.taskId} title={task?.errorMessage ?? undefined} className={activeCurrentRewriteTaskId === pending.taskId ? 'active' : ''} onClick={() => terminal ? removeCurrentRewrite(pending.taskId) : setActiveCurrentRewriteTaskId(pending.taskId)}><span>{index + 1}</span>{label}</button>
      })}</div>
    </aside> : null}
    <RewriteCandidateDialog
      candidate={pendingCurrentRewriteMessage?.suggestion && pendingCurrentRewrite ? {
        id: pendingCurrentRewriteMessage.id,
        originalText: pendingCurrentRewriteMessage.suggestion.originalText,
        candidateText: pendingCurrentRewriteMessage.suggestion.replacementText,
        providerLabel: 'Codex',
        requestedModel: pendingCurrentRewrite.requestedModel,
        actualModel: pendingCurrentRewriteMessage.model,
        actualReasoningEffort: pendingCurrentRewriteMessage.reasoningEffort,
        generationRound: pendingCurrentRewriteMessage.generationRound ?? 1,
        sourceSelections: [{
          selectionId: pendingCurrentRewrite.selection.targetSelectionId ?? `current-selection-${pendingCurrentRewrite.taskId}`,
          position: 0,
          sourceKind: 'current_script',
          sourceId: projectId,
          sourceVersion: pendingCurrentRewriteMessage.selectionSnapshot?.baseVersionId ?? currentScriptVersion?.id ?? 'current',
          sourceContentHash: pendingCurrentRewriteMessage.selectionHash ?? pendingCurrentRewrite.selection.selectedText ?? '',
          sourceLabel: '当前文案选区',
          semanticGroupId: null,
          blockId: pendingCurrentRewrite.selection.targetSelectionId ?? 'current-selection',
          blockStart: pendingCurrentRewrite.selection.from ?? 0,
          blockEnd: pendingCurrentRewrite.selection.to ?? 0,
          selectedText: pendingCurrentRewrite.selection.selectedText ?? ''
        }],
        conflicts: [],
        targetChanged: pendingCurrentRewriteTargetChanged
      } : null}
      remainingCount={Math.max(0, pendingCurrentRewrites.length - 1)}
      onClose={() => setActiveCurrentRewriteTaskId(null)}
      onContinue={() => {
        if (!pendingCurrentRewrite || !pendingCurrentRewriteMessage || pendingCurrentRewriteTargetChanged) {
          setNotice('原应用目标已变化，请重新选择后再生成')
          return
        }
        setCurrentCandidateContinuation({ pending: pendingCurrentRewrite, message: pendingCurrentRewriteMessage })
        setActiveCurrentRewriteTaskId(null)
      }}
      onAppend={() => pendingCurrentRewriteMessage && pendingCurrentRewrite && void applyCurrentRewriteCandidate(pendingCurrentRewrite, pendingCurrentRewriteMessage, 'insert_after').then(() => removeCurrentRewrite(pendingCurrentRewrite.taskId)).catch((reason) => setNotice(reason instanceof Error ? reason.message : '候选追加失败'))}
      onReplace={() => pendingCurrentRewriteMessage && pendingCurrentRewrite && void applyCurrentRewriteCandidate(pendingCurrentRewrite, pendingCurrentRewriteMessage, 'replace').then(() => removeCurrentRewrite(pendingCurrentRewrite.taskId)).catch((reason) => setNotice(reason instanceof Error ? reason.message : '候选替换失败'))}
    />
    {currentCandidateContinuation ? <RewriteRequestPanel
      anchor={currentEditorScrollRef.current}
      anchorPoint={{ x: Math.round(window.innerWidth / 2), y: Math.min(420, Math.round(window.innerHeight / 2)) }}
      selectionLabel={`上一轮候选${currentCandidateContinuation.message.suggestion?.replacementText.length ?? 0}字`}
      projectId={projectId}
      sessionScope={`current-script-rewrite:${projectId}`}
      models={codexModels}
      initialModel={currentCandidateContinuation.pending.request.preferredModel ?? preferredCodexModel}
      initialReasoningEffort={currentCandidateContinuation.pending.request.preferredReasoningEffort ?? 'xhigh'}
      busy={sending}
      submitDisabled={!codexAvailable}
      submitDisabledReason="请先验证Codex"
      onDismiss={() => setCurrentCandidateContinuation(null)}
      onSubmit={(request) => void sendCurrentCandidateContinuation(request).catch((reason) => setNotice(reason instanceof Error ? reason.message : '继续修改失败'))}
    /> : null}
  </section>

  const paneProps = (provider: ScriptRevisionProvider) => ({
    provider,
    conversation: {
      ...conversations[provider],
      messages: conversations[provider].messages.filter((message) => message.selectionSnapshot?.applicationTarget?.surface !== 'version_compare')
    },
    capability: providerCapabilities.find((item) => item.provider === provider),
    tasks,
    loading: conversationLoading,
    activeTargetId,
    mobileActive: effectiveConversationTab === (provider === 'claude_cli' ? 'claude' : 'codex'),
    locatorOpen: locatorProvider === provider,
    selectedCandidateIds,
    appliedMessageId: appliedRevisionMessageId,
    scrollTop: conversationScrollTops[provider === 'claude_cli' ? 'claude' : 'codex'],
    onActivate: () => setActiveConversationProvider(provider),
    onLocatorClose: () => setLocatorProvider(null),
    onLocate: locateTarget,
    onToggleCompare: (message: ScriptRevisionMessage) => setSelectedCandidateIds((current) => {
      const next = new Set(current)
      if (next.has(message.id)) next.delete(message.id)
      else next.add(message.id)
      return next
    }),
    onApply: applySuggestion,
    onUndo: undoSuggestion,
    onCopy: copySuggestion,
    onDiscard: discardSuggestion,
    onAppendMessage: appendConversationMessage,
    onCopyMessage: copyConversationMessage,
    onRetry: retryTask,
    onVerify: verifyProvider,
    onScrollTopChange: (value: number) => changeConversationScrollTop(provider === 'claude_cli' ? 'claude' : 'codex', value)
  })

  const claudePane = <div className="claude-workbench-wrap">
    {claudeAvailable ? <div className="claude-pane-mode" role="tablist" aria-label="Claude工作方式">
      <button role="tab" aria-selected={claudePaneMode === 'freeform'} className={claudePaneMode === 'freeform' ? 'active' : ''} onClick={() => { setClaudePaneMode('freeform'); setLocatorProvider(null) }}>自由稿</button>
      <button role="tab" aria-selected={claudePaneMode === 'ai'} className={claudePaneMode === 'ai' ? 'active' : ''} onClick={() => { setClaudePaneMode('ai'); setActiveConversationProvider('claude_cli') }}>AI对话</button>
    </div> : null}
    {claudePaneMode === 'ai' && claudeAvailable
      ? <ScriptConversationPane key={`${projectId}:claude`} {...paneProps('claude_cli')} />
      : <FreeformContentEditor
        title="Claude自由稿"
        eyebrow={claudeAvailable ? '可粘贴，也可切换AI对话' : '免费账户直接复制粘贴'}
        value={claudeFreeformContent}
        placeholder="把你在Claude App里完成的文案直接粘贴到这里，也可以继续自由修改。"
        onChange={setClaudeFreeformContent}
        onSave={saveClaudeFreeform}
      />}
  </div>

  const singleAiPane = singleProvider === 'claude'
    ? claudePane
    : <ScriptConversationPane key={`${projectId}:codex`} {...paneProps('codex_cli')} />

  const conversationComposer = <StructuredReferenceComposer
    className="script-shared-composer"
    projectId={projectId}
    sessionScope={`script-conversation:${projectId}`}
    value={composerMessage}
    onValueChange={setComposerMessage}
    ariaLabel="文案对话要求"
    hasCurrentTarget={Boolean(revisionSelection)}
    placeholder={revisionSelection ? '针对所选文字提要求，例如：更口语一点，但保留参数事实；输入@可引用资料' : '直接和AI对话；输入@可引用Brief、项目资料、图片、大纲、版本和对话'}
    disabled={loading || materialSnapshotReadOnly}
    submitDisabled={sendTargets.size === 0}
    busy={sending}
    submitLabel={sendTargets.size === 2 ? '同时发送' : '发送'}
    onSubmit={sendMessage}
    controls={<div className="script-composer-meta">
      {revisionSelection?.selectedText
        ? <span className="revision-selection-chip"><span>已选：{revisionSelection.selectedText.slice(0, 72)}{revisionSelection.selectedText.length > 72 ? '…' : ''}</span><button aria-label="取消选区，改为普通对话" onClick={() => { setRevisionSelection(null); setActiveTargetId(null) }}><X size={12} /></button></span>
        : <span className="script-scope-chip">普通对话</span>}
      <ProjectContextToggle value={includeProjectContext} className={`script-context-button${includeProjectContext ? ' active' : ''}`} disabled={!project || loading} onChange={setIncludeProjectContext} />
      <div className="script-send-targets" role="group" aria-label="选择发送对象">
        {providers.map((provider) => {
          const checked = sendTargets.has(provider)
          const available = providerCapabilities.find((item) => item.provider === provider)?.available
          const hiddenBySingleView = workbenchView === 'single' && ((singleProvider === 'claude') !== (provider === 'claude_cli'))
          if (hiddenBySingleView) return null
          return <button key={provider} className={checked ? 'active' : ''} aria-pressed={checked} disabled={!available || loading} onClick={() => setSendTargets((current) => { const next = new Set(current); if (next.has(provider)) next.delete(provider); else next.add(provider); return next })}><span>{checked ? '✓' : ''}</span>{provider === 'claude_cli' ? 'Claude' : 'Codex'}</button>
        })}
      </div>
    </div>}
  />

  const mobileWorkbenchTabs: { ariaLabel: string; items: WorkbenchMobileTabItem[]; activeId: string; onChange(id: string): void } | null = primaryView === 'conversation'
    ? {
        ariaLabel: '对话模式窄窗栏目',
        items: workbenchView === 'single'
          ? [{ id: singleProvider, label: singleProvider === 'claude' ? 'Claude' : 'Codex', controls: `conversation-${singleProvider}-panel`, tabId: `conversation-${singleProvider}-panel-tab` }, { id: 'current', label: '当前文案', controls: 'current-script-panel', tabId: 'current-script-panel-tab' }]
          : [{ id: 'claude', label: 'Claude', controls: 'conversation-claude-panel', tabId: 'conversation-claude-panel-tab' }, { id: 'codex', label: 'Codex', controls: 'conversation-codex-panel', tabId: 'conversation-codex-panel-tab' }, { id: 'current', label: '当前文案', controls: 'current-script-panel', tabId: 'current-script-panel-tab' }],
        activeId: effectiveConversationTab,
        onChange: (id) => switchConversationTab(id as ConversationWorkbenchTab)
      }
    : primaryView === 'comparison' && comparisonKind === 'drafts'
      ? {
          ariaLabel: '成稿对比窄窗栏目',
          items: [{ id: 'codex', label: 'Codex稿', controls: 'draft-comparison-panel', tabId: 'draft-comparison-codex-tab' }, { id: 'claude', label: 'Claude稿', controls: 'draft-comparison-panel', tabId: 'draft-comparison-claude-tab' }, { id: 'current', label: '当前文案', controls: 'current-script-panel', tabId: 'current-script-panel-tab' }],
          activeId: draftSurface === 'current' ? 'current' : comparisonSide,
          onChange: (id) => switchDraftMobileTab(id as DraftComparisonSide | 'current')
        }
      : primaryView === 'versions'
        ? {
            ariaLabel: '版本对比窄窗栏目',
            items: [{ id: 'left', label: '版本A', controls: 'version-working-left-panel', tabId: 'version-working-left-panel-tab' }, { id: 'right', label: '版本B', controls: 'version-working-right-panel', tabId: 'version-working-right-panel-tab' }, { id: 'current', label: '当前文案', controls: 'current-script-panel', tabId: 'current-script-panel-tab' }],
            activeId: versionSurface === 'current' ? 'current' : versionMobileSide,
            onChange: (id) => switchVersionMobileTab(id as VersionMobileSide | 'current')
          }
        : null
  const contextDetailsVisible = Boolean(requestedScriptVersion) || selectedCandidateIds.size > 0 || Boolean(notice)
  const contextRowVisible = Boolean(mobileWorkbenchTabs)
    || Boolean(requestedScriptVersion)
    || selectedCandidateIds.size > 0
    || Boolean(notice)

  const canSaveCurrentScript = !saving && !versionRestoreBusy && !workspaceLoadError && currentScript.phase === 'ready' && currentScript.recoveryCandidates.length === 0
  const draftCurrentSurfaceVisible = primaryView === 'comparison' && comparisonKind === 'drafts' && draftSurface === 'current'

  return <main className={`workbench-shell script-workbench-shell${immersive ? ' is-immersive' : ''}${primaryView === 'conversation' && effectiveConversationTab === 'current' ? ' conversation-current-mobile' : ''}`}>
    <header className="workbench-topbar">
      <button className="workbench-back" onClick={() => navigate({ page: 'project', projectId, moduleKey: 'script' })}><ArrowLeft size={17} />返回项目</button>
      <div className="workbench-title-and-view">
        <div><span>{project?.title ?? '文案工作台'}</span><h1>文案</h1></div>
        <div className="workbench-view-switch" role="tablist" aria-label="文案工作台视图">
          <button role="tab" disabled={materialSnapshotReadOnly || versionRestoreBusy} aria-selected={primaryView === 'conversation'} className={primaryView === 'conversation' ? 'active' : ''} onClick={() => switchPrimaryView('conversation')}>对话模式</button>
          <button role="tab" disabled={versionRestoreBusy} aria-selected={primaryView === 'comparison'} className={primaryView === 'comparison' ? 'active' : ''} onClick={() => switchPrimaryView('comparison')}>对照筛选</button>
          <button role="tab" disabled={materialSnapshotReadOnly || versionRestoreBusy} aria-selected={primaryView === 'versions'} className={primaryView === 'versions' ? 'active' : ''} onClick={() => switchPrimaryView('versions')}>版本对比</button>
        </div>
        {primaryView === 'comparison' ? <div className="comparison-kind-switch" role="tablist" aria-label="对照类型"><button role="tab" disabled={materialSnapshotReadOnly} aria-selected={comparisonKind === 'drafts'} className={comparisonKind === 'drafts' ? 'active' : ''} onClick={() => switchComparisonKind('drafts')}>成稿对比</button><button role="tab" aria-selected={comparisonKind === 'materials'} className={comparisonKind === 'materials' ? 'active' : ''} onClick={() => switchComparisonKind('materials')}>素材成稿</button></div> : null}
        {primaryView === 'comparison' && comparisonKind === 'drafts' ? <div className="draft-surface-switch" role="tablist" aria-label="成稿对比页面"><button role="tab" aria-selected={draftSurface === 'organize'} className={draftSurface === 'organize' ? 'active' : ''} onClick={() => switchDraftSurface('organize')}>对照整理</button><button role="tab" aria-selected={draftSurface === 'current'} className={draftSurface === 'current' ? 'active' : ''} onClick={() => switchDraftSurface('current')}>当前文案</button></div> : null}
        {primaryView === 'versions' ? <div className="version-surface-switch" role="tablist" aria-label="版本对比页面"><button role="tab" disabled={versionRestoreBusy} aria-selected={versionSurface === 'compare'} className={versionSurface === 'compare' ? 'active' : ''} onClick={() => switchVersionSurface('compare')}>版本选择与差异</button><button role="tab" disabled={versionRestoreBusy} aria-selected={versionSurface === 'current'} className={versionSurface === 'current' ? 'active' : ''} onClick={() => switchVersionSurface('current')}>当前文案</button></div> : null}
        {primaryView === 'conversation' ? <><AiCountControl value={workbenchView === 'single' ? 1 : 2} className="single-provider-switch ai-count-switch" ariaLabel="对话AI数量" onChange={(aiCount) => switchView(aiCount === 1 ? 'single' : 'dual')} />{workbenchView === 'single' ? <div className="single-provider-switch" role="group" aria-label="单AI选择"><button className={singleProvider === 'claude' ? 'active' : ''} onClick={() => switchSingleProvider('claude')}>Claude</button><button className={singleProvider === 'codex' ? 'active' : ''} onClick={() => switchSingleProvider('codex')}>Codex</button></div> : null}</> : null}
      </div>
      <div className="workbench-actions">
        {primaryView !== 'versions' || versionSurface === 'current' ? <>
          {primaryView === 'comparison' && comparisonKind === 'materials' ? <button aria-label="进入沉浸模式" onClick={() => setImmersive(true)}><Maximize2 size={15} />沉浸</button> : null}
          {materialSnapshotReadOnly ? <button className="primary-action" disabled={saving} onClick={() => void restoreHistoricalMaterialVersion()}><RefreshCw size={15} />{saving ? '恢复中…' : '恢复为当前版本'}</button> : <>
            <input className="script-version-name-input" aria-label="本次版本名称" value={versionName} maxLength={80} placeholder="版本名称（可选）" onChange={(event) => setVersionName(event.currentTarget.value)} />
            <button aria-label="保存当前文案" disabled={!canSaveCurrentScript} onClick={() => void saveCurrent()}><Save size={15} />保存</button>
            <button className="primary-action" disabled={!canSaveCurrentScript} onClick={() => void saveCurrent(true)}><Check size={15} />{saving ? '保存中…' : '定稿'}</button>
            <div className="workbench-more"><button aria-label="更多文案操作" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal size={17} /></button>{moreOpen ? <div className="workbench-more-menu"><button onClick={() => setFeishuOpen(true)}><Send size={14} />飞书交接</button><button onClick={() => void exportWord()}><Download size={14} />导出Word</button><button onClick={() => void importScript()}><FileInput size={14} />导入文案</button>{primaryView === 'conversation' && workbenchView === 'dual' ? <><button onClick={() => toggleHiddenProvider('claude')}>{hiddenProviders.includes('claude') ? '显示Claude栏' : '隐藏Claude栏'}</button><button onClick={() => toggleHiddenProvider('codex')}>{hiddenProviders.includes('codex') ? '显示Codex栏' : '隐藏Codex栏'}</button></> : null}<button onClick={() => { setModelSplit(50); setDocumentSplit(67); setHiddenProviders([]); persistLayout({ workbenchModelSplit: 50, workbenchMergedSplit: 67, workbenchHiddenProviders: [] }); setMoreOpen(false) }}>恢复默认布局</button></div> : null}</div>
          </>}
        </> : null}
      </div>
    </header>
    {workspaceLoadError ? <section className="workbench-load-error" role="alert"><AlertTriangle size={17} /><div><b>文案工作台没有完整载入</b><span>{workspaceLoadError}。当前文案没有被其他版本覆盖。</span></div><button className="primary-action" disabled={loading} onClick={() => void load()}><RefreshCw size={13} />{loading ? '重试中…' : '重新载入'}</button></section> : null}
    {contextRowVisible ? <div className={`workbench-context-row${!contextDetailsVisible ? ' mobile-only' : ''}`}>
      {mobileWorkbenchTabs ? <WorkbenchMobileTabs {...mobileWorkbenchTabs} /> : null}
      {requestedScriptVersion ? <span className="context-chip external-draft-chip">{materialSnapshotReadOnly ? `历史快照：${requestedScriptVersion.displayName || `文案v${requestedScriptVersion.revision}`}·只读` : requestedScriptVersion.kind === 'external_draft' ? `正在整理：${requestedScriptVersion.sourceFileName ?? `外部稿v${requestedScriptVersion.revision}`}` : `正在编辑：${requestedScriptVersion.isFinal ? '定稿文案' : `文案v${requestedScriptVersion.revision}`}`}</span> : null}
      {selectedCandidateIds.size ? <div className="candidate-compare-bar"><span>已选{selectedCandidateIds.size}个候选</span><button disabled={selectedCandidateIds.size < 2} onClick={() => setComparisonOpen(true)}>开始对比</button><button onClick={() => setSelectedCandidateIds(new Set())}>清空</button></div> : notice ? <div className="workbench-notice" role="status"><Sparkles size={14} />{notice}<button onClick={() => setNotice('')}>关闭</button></div> : null}
    </div> : null}
    {comparisonKind === 'drafts' || primaryView === 'comparison' ? <div hidden={isWorkbenchNarrow && primaryView === 'comparison' && comparisonKind === 'drafts' && draftSurface === 'current'} className={`workbench-layout comparison-workbench-layout${primaryView === 'comparison' && (comparisonKind === 'materials' || draftSurface === 'organize') ? '' : ' workbench-view-hidden'}`}>
      {comparisonKind === 'materials'
        ? materialWorkspace?.projectId === projectId ? <ScriptMaterialWorkspace
          key={projectId}
          workspace={materialWorkspace}
          tasks={tasks}
          capabilities={providerCapabilities}
          codexModels={codexModels}
          preferredCodexModel={preferredCodexModel}
          onPreferredCodexModelChange={(model) => {
            setPreferredCodexModel(model)
            persistLayout({ workbenchCodexModel: model })
          }}
          includeProjectContext={includeProjectContext}
          currentDocumentPane={currentDocumentPane}
          currentDocumentParagraphs={() => editor ? currentDocumentParagraphSnapshot(editor) : []}
          currentDocumentState={currentDocumentState}
          auditControlsHidden={Boolean(draftVersionId && !historicalMaterialSnapshotAvailable)}
          readOnlySnapshot={materialSnapshotReadOnly}
          requestedFocus={materialRelationFocus}
          mobileTab={materialMobileTab}
          mobileScrollTops={materialScrollTops}
          onWorkspaceChange={applyMaterialWorkspace}
          onMobileTabChange={(tab) => {
            setMaterialMobileTab(tab)
            persistLayout({ workbenchMaterialTab: tab })
          }}
          onMobileScrollTopChange={changeMaterialScrollTop}
          onIncludeProjectContextChange={setIncludeProjectContext}
          onApplyDraft={applyMaterialDraft}
          onApplyRewriteCandidate={applyMaterialRewriteCandidate}
          captureRewriteApplicationTarget={async (draftId, paragraphIds) => {
            if (!editor || paragraphIds.length !== 1) return null
            const ranges = materialRelationRanges(editor, draftId, paragraphIds[0]!)
            if (ranges.length !== 1) return null
            const selectedText = editor.state.doc.textBetween(ranges[0]!.from, ranges[0]!.to, ' ')
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(selectedText))
            const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
            return {
              targetId: `material-relation:${draftId}:${paragraphIds[0]}`,
              selectedText,
              contentHash,
              from: ranges[0]!.from,
              to: ranges[0]!.to
            }
          }}
          rewriteCandidateTargetChanged={(candidate) => {
            if (!editor || !candidate.applicationTarget) return false
            const ranges = materialRelationRanges(editor, candidate.draftId, candidate.paragraphIds[0]!)
            if (ranges.length !== 1) return true
            const currentText = editor.state.doc.textBetween(ranges[0]!.from, ranges[0]!.to, ' ').replace(/\s+/g, ' ').trim()
            return currentText !== candidate.applicationTarget.selectedText.replace(/\s+/g, ' ').trim()
          }}
          onRelationFocus={setMaterialRelationFocus}
          onNotice={setNotice}
        /> : <div className="loading-state">正在载入素材成稿…</div>
        : comparisonWorkspace?.projectId === projectId ? <DraftComparisonErrorBoundary key={`${projectId}:${comparisonWorkspace.activeSession?.id ?? 'setup'}`} resetKey={primaryView} onError={setNotice}><DraftComparisonWorkspace
          workspace={comparisonWorkspace}
          visible={primaryView === 'comparison' && comparisonKind === 'drafts' && draftSurface === 'organize'}
          currentDocumentContent={editor?.getText({ blockSeparator: '\n\n' }) ?? ''}
          currentDocumentFingerprint={editor ? canonicalCurrentScriptValue(editor.getJSON()) : ''}
          currentDocumentSnapshotFingerprint={currentScript.snapshot ? canonicalCurrentScriptValue(currentScript.snapshot.document.editorDocument) : null}
          currentDocumentRevision={currentScript.snapshot?.document.revision ?? null}
          currentDocumentContentHash={currentScript.snapshot?.document.contentHash ?? null}
          capabilities={providerCapabilities}
          providerSettings={providerSettings}
          tasks={tasks}
          pendingRewrites={comparisonPendingRewrites}
          onPendingRewritesChange={setPersistedComparisonPendingRewrites}
          operationHistory={comparisonHistory}
          mobileSide={comparisonSide}
          showMobileTabs={false}
          mobilePanelId={isWorkbenchNarrow ? 'draft-comparison-panel' : undefined}
          mobilePanelLabelledBy={isWorkbenchNarrow ? `draft-comparison-${comparisonSide}-tab` : undefined}
          sourceSplit={comparisonSplit}
          previewSplit={comparisonPreviewSplit}
          scrollTop={comparisonScrollTop}
          includeProjectContext={includeProjectContext}
          colorMode={comparisonColorMode}
          documentMode={comparisonDocumentMode}
          splitScope={comparisonSplitScope}
          useOutline={comparisonUseOutline}
          codexModels={codexModels}
          preferredCodexModel={preferredCodexModel}
          loading={loading}
          onSaveDrafts={saveComparisonDrafts}
          onGenerateSource={generateDraftSource}
          onStartAlignment={startDraftAlignment}
          onGenerateCandidate={generateDraftCandidate}
          onDeleteCandidate={deleteDraftCandidate}
          onSetDecision={setDraftGroupDecision}
          onMergeGroups={mergeDraftAlignmentGroups}
          onSplitSelection={splitDraftAlignmentSelection}
          onMoveParagraph={moveDraftParagraph}
          onMoveParagraphs={moveDraftParagraphs}
          onMoveCandidate={moveDraftCandidate}
          onReorderCandidates={reorderDraftCandidates}
          onReorderGroups={reorderDraftGroups}
          onSetGroupNote={setDraftGroupNote}
          onSetGroupMarkers={setDraftGroupMarkers}
          onApply={applyDraftComparison}
          onAdoptCurrentDocument={adoptCurrentDocumentAsDraftComparisonBase}
          onUndo={undoDraftComparisonApply}
          canUndo={Boolean(comparisonUndoHtml)}
          onSelectSession={loadDraftComparison}
          onRetryTask={retryComparisonTask}
          onRestoreHistory={restoreDraftComparisonHistory}
          onMobileSideChange={switchComparisonSide}
          onSourceSplitChange={changeComparisonSplit}
          onPreviewSplitChange={changeComparisonPreviewSplit}
          onIncludeProjectContextChange={setIncludeProjectContext}
          onColorModeChange={changeComparisonColorMode}
          onDocumentModeChange={changeComparisonDocumentMode}
          onSplitScopeChange={changeComparisonSplitScope}
          onUseOutlineChange={changeComparisonUseOutline}
          onScrollTopChange={changeComparisonScrollTop}
          onNotice={setNotice}
        /></DraftComparisonErrorBoundary> : <div className="loading-state">正在载入成稿对比…</div>}
    </div> : null}
    {primaryView === 'conversation' || (primaryView === 'comparison' && comparisonKind === 'drafts' && !draftCurrentSurfaceVisible) ? <div className={primaryView === 'conversation' ? 'workbench-view-active' : 'workbench-view-hidden'}>
      {workbenchView === 'single'
        ? <div ref={layoutRef} className="workbench-layout single-ai-workbench-layout" style={paneStyles} onPointerMove={pointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <div id={`conversation-${singleProvider}-panel`} role={isWorkbenchNarrow ? 'tabpanel' : undefined} aria-labelledby={isWorkbenchNarrow ? `conversation-${singleProvider}-panel-tab` : undefined} hidden={isWorkbenchNarrow && effectiveConversationTab !== singleProvider} className={`conversation-pane-wrap${effectiveConversationTab === singleProvider ? ' mobile-active' : ''}`}>{singleAiPane}</div>
          <div className="workbench-divider merged-divider" role="separator" aria-label="调整单AI和当前文案宽度" aria-orientation="vertical" aria-valuemin={50} aria-valuemax={80} aria-valuenow={Math.round(documentSplit)} tabIndex={0} onKeyDown={(event) => adjustDivider('document', event)} onPointerDown={(event) => beginDrag('document', event)} onDoubleClick={() => { setDocumentSplit(67); persistLayout({ workbenchMergedSplit: 67 }) }}><span /></div>
          {currentDocumentPane}
        </div>
        : <div ref={layoutRef} className="workbench-layout conversation-workbench-layout" style={paneStyles} onPointerMove={pointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <div id="conversation-claude-panel" role={isWorkbenchNarrow ? 'tabpanel' : undefined} aria-labelledby={isWorkbenchNarrow ? 'conversation-claude-panel-tab' : undefined} hidden={isWorkbenchNarrow && effectiveConversationTab !== 'claude'} className={`conversation-pane-wrap${effectiveConversationTab === 'claude' ? ' mobile-active' : ''}${hiddenProviders.includes('claude') ? ' is-wide-hidden' : ''}`}>{claudePane}</div>
          <div className="workbench-divider model-divider" role="separator" aria-label="调整Claude和Codex宽度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(modelSplit)} tabIndex={0} onKeyDown={(event) => adjustDivider('models', event)} onPointerDown={(event) => beginDrag('models', event)} onDoubleClick={() => { setModelSplit(50); persistLayout({ workbenchModelSplit: 50 }) }}><span /></div>
          <div id="conversation-codex-panel" role={isWorkbenchNarrow ? 'tabpanel' : undefined} aria-labelledby={isWorkbenchNarrow ? 'conversation-codex-panel-tab' : undefined} hidden={isWorkbenchNarrow && effectiveConversationTab !== 'codex'} className={`conversation-pane-wrap${effectiveConversationTab === 'codex' ? ' mobile-active' : ''}${hiddenProviders.includes('codex') ? ' is-wide-hidden' : ''}`}><ScriptConversationPane key={`${projectId}:codex`} {...paneProps('codex_cli')} /></div>
          <div className="workbench-divider merged-divider" role="separator" aria-label="调整AI对话和当前文案宽度" aria-orientation="vertical" aria-valuemin={50} aria-valuemax={80} aria-valuenow={Math.round(documentSplit)} tabIndex={0} onKeyDown={(event) => adjustDivider('document', event)} onPointerDown={(event) => beginDrag('document', event)} onDoubleClick={() => { setDocumentSplit(67); persistLayout({ workbenchMergedSplit: 67 }) }}><span /></div>
          {currentDocumentPane}
        </div>}
    </div> : null}
    {project?.id === projectId ? <div hidden={isWorkbenchNarrow && primaryView === 'versions' && versionSurface === 'current'} className={`workbench-layout version-compare-workbench-layout${primaryView === 'versions' && versionSurface === 'compare' ? '' : ' workbench-view-hidden'}`}><ScriptVersionCompareView key={projectId} versions={project.versions} currentDocumentSnapshot={currentScript.snapshot} onFreezeCurrentDocument={() => currentScript.flush()} codexModels={codexModels} preferredCodexModel={preferredCodexModel} codexAvailable={codexAvailable} codexConversation={versionCodexConversation} tasks={tasks} onCandidateStatus={async (messageId, status) => {
      if (!window.creatorOS) throw new Error('文案服务尚未就绪')
      await window.creatorOS.setScriptRevisionSuggestionStatus(projectId, messageId, status)
      await loadConversations()
    }} onGenerateFusionCandidate={async ({ request, sourceSelections, combinedText, target, threadId }) => {
      if (!window.creatorOS) throw new Error('文案服务尚未就绪')
      const threadConversation = threadId
        ? await window.creatorOS.getScriptRevisionConversation(projectId, threadId, 'codex_cli', 'version_compare')
        : null
      const quickLabels: Record<RewriteQuickIntent, string> = { regenerate: '重新生成', polish: '润色', concise: '更精简', conversational: '更口语', expand: '扩写', humorous: '更有趣' }
      const message = [sourceSelections.length > 1 ? '将这些冻结来源综合成一份统一候选，不要静默取舍来源冲突。' : '针对冻结的版本选区生成局部候选。', request.quickIntent ? `快捷要求：${quickLabels[request.quickIntent]}` : '', request.requirement].filter(Boolean).join('\n')
      const instruction = await buildStructuredInstructionPayload({
        projectId,
        sessionScope: `version-comparison:${projectId}`,
        surface: 'script_version_comparison',
        snapshot: request.structuredInstruction
          ? { ...request.structuredInstruction, displayText: message }
          : { displayText: message, editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: message }] }] }, references: [] },
        target: { kind: 'version_comparison', comparisonId: `version-comparison:${projectId}`, sourceSelections },
        includeProjectContext,
        webSearchMode: 'automatic',
        aiCount: 1,
        targets: [{
          providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
          requestedModel: request.preferredModel ?? 'auto',
          requestedReasoningEffort: request.preferredReasoningEffort ?? 'xhigh',
          historyThreadId: threadId,
          providerThreadId: threadConversation?.providerThreadId ?? null,
          historyMessageIds: threadConversation?.messages.slice(-40).map((item) => item.id) ?? []
        }]
      })
      const dispatched = await window.creatorOS.dispatchContentInstruction({
        operation: 'script_revision',
        instruction,
        requests: [{
        projectId,
        threadId,
        surface: 'version_compare',
        baseVersionId: null,
        currentDocumentContent: sourceContentToRichTextHtml(combinedText),
        includeProjectContext,
        provider: 'codex_cli',
        preferredModel: request.preferredModel,
        preferredReasoningEffort: request.preferredReasoningEffort,
        message,
        sourceSelections,
        selection: {
          targetSelectionId: target.targetSelectionId,
          selectedText: combinedText,
          contextBefore: '',
          contextAfter: '',
          occurrenceIndex: 0,
          from: 1,
          to: combinedText.length + 1,
          applicationTarget: {
            surface: 'version_compare',
            side: target.side,
            sourceId: target.sourceId,
            contentHash: target.contentHash,
            content: target.content,
            range: target.range,
            inheritedConflicts: target.inheritedConflicts
          }
        }
        }]
      })
      const task = dispatched.tasks[0]
      if (!task) throw new Error('版本候选任务没有成功建立')
      await refreshWorkspace()
      await loadConversations()
      return task
    }} visible={primaryView === 'versions' && versionSurface === 'compare'} narrow={isWorkbenchNarrow} mobileSide={versionMobileSide} sourcePanelOpen={versionSourcePanelOpen} diffVisible={versionDiffVisible} scrollTops={versionScrollTops} onMobileSideChange={(side) => {
      setVersionMobileSide(side)
      persistLayout({ workbenchVersionMobileSide: side })
    }} onSourcePanelOpenChange={(value) => {
      setVersionSourcePanelOpen(value)
      persistLayout({ workbenchVersionSourcePanelOpen: value })
    }} onDiffVisibleChange={(value) => {
      setVersionDiffVisible(value)
      persistLayout({ workbenchVersionDiffVisible: value })
    }} onScrollTopChange={(side, value) => {
      const next = { ...versionScrollTopsRef.current, [side]: Math.max(0, Math.round(value)) }
      versionScrollTopsRef.current = next
      setVersionScrollTops(next)
      persistLayout({ workbenchVersionScrollTops: next })
    }} onImportFile={async (file) => {
      if (!window.creatorOS) throw new Error('文案服务尚未就绪')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await window.creatorOS.importScriptFile(projectId, file.name, bytes)
      if (result.canceled || !result.version) throw new Error(`${file.name}没有可读取的文案内容`)
      setProject(await window.creatorOS.getProject(projectId))
      setNotice(`${file.name}已加入版本对比`)
      return result.version
    }} onSaveWorkingCopy={async ({ content, displayName, sourceVersionId }) => {
      if (!window.creatorOS) throw new Error('文案服务尚未就绪')
      const version = await window.creatorOS.saveScript(projectId, 'user_edit', content, sourceVersionId ?? undefined, displayName)
      setProject(await window.creatorOS.getProject(projectId))
      return version
    }} onRestoreWorkingCopy={async ({ content, displayName, sourceVersionId }) => {
      if (!window.creatorOS || !editor) throw new Error('文案服务尚未就绪')
      const sourceVersion = sourceVersionId ? project?.versions.find((item) => item.id === sourceVersionId) : null
      const unchangedFromFrozen = Boolean(sourceVersion && (
        content === (sourceVersion.workspaceContent ?? sourceVersion.content)
        || sourceContentToRichTextHtml(content) === sourceContentToRichTextHtml(sourceVersion.workspaceContent ?? sourceVersion.content)
      ))
      const frozen = sourceVersionId && unchangedFromFrozen
        ? await window.creatorOS.getCurrentScriptVersionSnapshot(projectId, sourceVersionId)
        : null
      const restored = await currentScript.restoreVersion({
        ...(frozen ? { snapshot: frozen } : { content }),
        sourceVersionId,
        displayName
      })
      if (!restored) throw new Error('恢复版本尚未保存，请先处理当前页面的保存提示')
      if (restored.materialWorkspace) applyMaterialWorkspace(restored.materialWorkspace)
      const version = restored.version
      const message = `${version.displayName || `文案v${version.revision}`}已恢复为新的当前版本；原版本保持不变`
      setProject(await window.creatorOS.getProject(projectId))
      setPrimaryView('comparison')
      setComparisonKind('materials')
      setNotice(message)
      persistLayout({
        workbenchPrimaryView: 'comparison',
        workbenchComparisonKind: 'materials'
      })
      window.setTimeout(() => replaceRoute({ page: 'workbench', projectId, workbenchMode: 'materials' }), 0)
    }} onRestoreBusyChange={(busy) => {
      versionRestoreBusyRef.current = busy
      setVersionRestoreBusy(busy)
      if (busy) {
        if (editor) {
          editor.setEditable(false)
          setCurrentScriptEditorOperationLocked(editor, true)
        }
        setEditorContextMenu(null)
        setMarkerComposer(null)
        setMoreOpen(false)
      }
    }} onNotice={setNotice} /></div> : null}
    {draftCurrentSurfaceVisible ? <div className="workbench-layout draft-current-script-layout">{currentDocumentPane}</div> : null}
    {primaryView === 'versions' ? <div hidden={versionSurface !== 'current'} className={`workbench-layout version-current-script-layout${versionSurface === 'current' ? '' : ' workbench-view-hidden'}`}>{currentDocumentPane}</div> : null}
    {primaryView === 'conversation' && (workbenchView === 'dual' || singleProvider === 'codex' || claudeAvailable) ? conversationComposer : null}
    {comparisonOpen && selectedCandidates.length >= 2 ? <CandidateComparisonOverlay candidates={selectedCandidates} onApply={async (message) => { await applySuggestion(message, 'replace'); setComparisonOpen(false) }} onClose={() => setComparisonOpen(false)} /> : null}
    {project ? <FeishuHandoffDialog open={feishuOpen} project={project} finalVersion={finalScriptVersion} onClose={() => { setFeishuOpen(false); setMoreOpen(false) }} onNotice={setNotice} /> : null}
    {!draftVersionId ? <CurrentScriptLifecycleDialogs controller={currentScript} onNotice={setNotice} /> : null}
  </main>
}

interface WorkbenchMobileTabItem {
  id: string
  label: string
  controls: string
  tabId: string
}

function WorkbenchMobileTabs({
  ariaLabel,
  items,
  activeId,
  onChange
}: {
  ariaLabel: string
  items: WorkbenchMobileTabItem[]
  activeId: string
  onChange(id: string): void
}): React.JSX.Element {
  const activate = (id: string, container?: HTMLElement | null): void => {
    onChange(id)
    if (!container) return
    window.requestAnimationFrame(() => container.querySelector<HTMLButtonElement>(`[data-workbench-mobile-tab="${id}"]`)?.focus())
  }
  return <div className="workbench-mobile-panel-tabs" role="tablist" aria-label={ariaLabel} style={{ '--workbench-mobile-tab-count': items.length } as React.CSSProperties}>
    {items.map((item, index) => <button
      key={item.id}
      id={item.tabId}
      data-workbench-mobile-tab={item.id}
      role="tab"
      tabIndex={activeId === item.id ? 0 : -1}
      aria-selected={activeId === item.id}
      aria-controls={item.controls}
      className={activeId === item.id ? 'active' : ''}
      onClick={() => activate(item.id)}
      onKeyDown={(event) => {
        let nextIndex = -1
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length
        else if (event.key === 'Home') nextIndex = 0
        else if (event.key === 'End') nextIndex = items.length - 1
        if (nextIndex < 0) return
        event.preventDefault()
        activate(items[nextIndex]!.id, event.currentTarget.parentElement)
      }}
    >{item.label}</button>)}
  </div>
}
