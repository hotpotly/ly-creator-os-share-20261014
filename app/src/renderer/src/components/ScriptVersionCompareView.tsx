import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Check, ChevronDown, ChevronUp, Combine, FileText, GitCompareArrows, Heading1, Heading2, Highlighter, List, Plus, Redo2, Save, Strikethrough, Undo2, Upload, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CodexWritingModelOption, ContentSelectionConflict, ContentSourceSelectionSnapshot, DraftVersion, ProjectCurrentScriptSnapshot, ScriptRevisionConversation, ScriptTextAnnotation, TaskRun } from '../../../shared/domain'
import { lineDiff, type TextDiffPart } from '../../../shared/text-diff'
import { richTextHtmlToPlainText, sourceContentToRichTextHtml, stripScriptWorkbenchAnnotations } from '../../../shared/script-version-content'
import { ScriptMarker, ScriptMaterialRelation, ScriptTargetHighlight } from './ScriptDocumentMarks'
import { CurrentScriptEditorIdentity, ensureCurrentScriptEditorIdentity, setCurrentScriptEditorOperationLocked } from '../features/script/current-document/CurrentScriptEditorIdentity'
import { SelectionActionMenu } from '../features/script/selection/SelectionActionMenu'
import { TextAnnotationMenu } from '../features/script/selection/TextAnnotationMenu'
import { RewriteRequestPanel } from '../features/script/selection/RewriteRequestPanel'
import { RewriteCandidateDialog } from '../features/script/selection/RewriteCandidateDialog'
import type { RewriteRequest } from '../features/script/selection/selection-contract'

type CompareSide = 'left' | 'right'

interface CompareSource {
  id: string
  label: string
  content: string
  createdAt: string
  isFinal: boolean
  version: DraftVersion | null
  source: 'version' | 'paste'
}

interface WorkingCopy {
  sourceId: string
  content: string
  plainText: string
  displayName: string
}

interface VersionSelectionMenu {
  side: CompareSide
  x: number
  y: number
  from: number
  to: number
  selectedText: string
  blockStart: number
  blockEnd: number
}

interface VersionFusionSource {
  id: string
  label: string
  selections: ContentSourceSelectionSnapshot[]
}

interface VersionCandidateTarget {
  targetSelectionId: string
  side: CompareSide
  sourceId: string
  contentHash: string
  content: string
  range: { from: number; to: number; selectedText: string } | null
  inheritedConflicts?: ContentSelectionConflict[]
}

interface PendingVersionRewrite {
  taskId: string
  requestedModel: string | null
  request: RewriteRequest
  sourceSelections: ContentSourceSelectionSnapshot[]
  target: VersionCandidateTarget
}

interface VersionCandidateContinuation {
  inputText: string
  threadId: string
  sourceSelections: ContentSourceSelectionSnapshot[]
  target: VersionCandidateTarget
}

export interface SaveVersionWorkingCopyInput {
  content: string
  displayName: string
  sourceVersionId: string | null
}

const highlightColors = ['#F3D9A3', '#BFD9C1', '#BDD8E5', '#D7C4E0', '#E7C1BB', '#D8D39D']

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function versionLabel(version: DraftVersion): string {
  if (version.displayName) return version.displayName
  if (version.isFinal) return `定稿v${version.revision}`
  if (version.kind === 'external_draft') return version.sourceFileName ?? `外部稿v${version.revision}`
  if (version.kind === 'claude_candidate') return `Claude稿v${version.revision}`
  if (version.kind === 'codex_candidate') return `Codex稿v${version.revision}`
  return `文案v${version.revision}`
}

function sourceFromVersion(version: DraftVersion): CompareSource {
  return {
    id: version.id,
    label: versionLabel(version),
    content: version.workspaceContent ?? version.content,
    createdAt: version.createdAt,
    isFinal: version.isFinal,
    version,
    source: 'version'
  }
}

function initialWorkingCopy(source: CompareSource): WorkingCopy {
  const content = sourceContentToRichTextHtml(source.content)
  return {
    sourceId: source.id,
    content,
    plainText: richTextHtmlToPlainText(content),
    displayName: `${source.label}副本`.slice(0, 80)
  }
}

function positionAtPlainOffset(editor: Editor, offset: number): number | null {
  if (offset < 0) return null
  for (let position = 1; position <= editor.state.doc.content.size; position += 1) {
    if (editor.state.doc.textBetween(0, position, '\n').length >= offset) return position
  }
  return offset === editor.getText({ blockSeparator: '\n' }).length ? editor.state.doc.content.size : null
}

function CompareFormattingToolbar({ editor, disabled = false }: { editor: Editor | null; disabled?: boolean }): React.JSX.Element {
  const run = (event: React.MouseEvent<HTMLButtonElement>, action: () => void): void => {
    event.preventDefault()
    action()
  }
  return <fieldset disabled={disabled} className="version-editor-format-toolbar" role="toolbar" aria-label="版本文案格式">
    <button title="加粗" aria-label="加粗" aria-pressed={editor?.isActive('bold') ?? false} onMouseDown={(event) => run(event, () => editor?.chain().focus().toggleBold().run())}><Bold size={13} /></button>
    <button title="删除线" aria-label="删除线" aria-pressed={editor?.isActive('strike') ?? false} onMouseDown={(event) => run(event, () => editor?.chain().focus().toggleStrike().run())}><Strikethrough size={13} /></button>
    <i />
    <button title="正文" aria-label="正文" onMouseDown={(event) => run(event, () => editor?.chain().focus().setParagraph().run())}>正文</button>
    <button title="一级标题" aria-label="一级标题" aria-pressed={editor?.isActive('heading', { level: 1 }) ?? false} onMouseDown={(event) => run(event, () => editor?.chain().focus().toggleHeading({ level: 1 }).run())}><Heading1 size={14} /></button>
    <button title="二级标题" aria-label="二级标题" aria-pressed={editor?.isActive('heading', { level: 2 }) ?? false} onMouseDown={(event) => run(event, () => editor?.chain().focus().toggleHeading({ level: 2 }).run())}><Heading2 size={14} /></button>
    <button title="无序列表" aria-label="无序列表" aria-pressed={editor?.isActive('bulletList') ?? false} onMouseDown={(event) => run(event, () => editor?.chain().focus().toggleBulletList().run())}><List size={14} /></button>
    <i />
    {highlightColors.map((color, index) => <button
      className="format-highlight"
      title={`高亮颜色${index + 1}`}
      aria-label={`高亮颜色${index + 1}`}
      key={color}
      style={{ '--format-highlight': color } as React.CSSProperties}
      onMouseDown={(event) => run(event, () => editor?.chain().focus().toggleHighlight({ color }).run())}
    />)}
    <button title="清除高亮" aria-label="清除高亮" onMouseDown={(event) => run(event, () => editor?.chain().focus().unsetHighlight().run())}><Highlighter size={13} /></button>
  </fieldset>
}

function VersionWorkingEditor({
  side,
  source,
  working,
  diff,
  diffVisible,
  saving,
  onChange,
  onSave,
  onRestore,
  onActiveEditor,
  onEditorAvailable,
  onSelectionContext,
  annotations,
  narrow,
  active,
  scrollTop,
  onScrollTopChange
}: {
  side: CompareSide
  source: CompareSource | null
  working: WorkingCopy | null
  diff: TextDiffPart[]
  diffVisible: boolean
  saving: boolean
  onChange(patch: Partial<Pick<WorkingCopy, 'content' | 'plainText' | 'displayName'>>): void
  onSave(): void
  onRestore(): void
  onActiveEditor(editor: Editor | null): void
  onEditorAvailable(editor: Editor | null): void
  onSelectionContext(menu: VersionSelectionMenu, editor: Editor): void
  annotations: ScriptTextAnnotation[]
  narrow: boolean
  active: boolean
  scrollTop: number
  onScrollTopChange(scrollTop: number): void
}): React.JSX.Element {
  const onChangeRef = useRef(onChange)
  const onActiveEditorRef = useRef(onActiveEditor)
  const savingRef = useRef(saving)
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingScrollRef = useRef<number | null>(null)
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  const [, setEditorRevision] = useState(0)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onActiveEditorRef.current = onActiveEditor }, [onActiveEditor])
  useEffect(() => { onScrollTopChangeRef.current = onScrollTopChange }, [onScrollTopChange])
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, horizontalRule: false }),
      Underline,
      ScriptTargetHighlight.configure({ multicolor: true }),
      ScriptMarker,
      ScriptMaterialRelation,
      CurrentScriptEditorIdentity
    ],
    content: working?.content ?? '<p></p>',
    editable: Boolean(source),
    immediatelyRender: false,
    onFocus: ({ editor: focusedEditor }) => onActiveEditorRef.current(focusedEditor),
    onSelectionUpdate: () => setEditorRevision((value) => value + 1),
    onUpdate: ({ editor: currentEditor }) => {
      if (savingRef.current) return
      ensureCurrentScriptEditorIdentity(currentEditor)
      setEditorRevision((value) => value + 1)
      onChangeRef.current({
        content: currentEditor.getHTML(),
        plainText: currentEditor.getText({ blockSeparator: '\n' })
      })
    }
  }, [source?.id])

  useEffect(() => {
    onEditorAvailable(editor)
    return () => onEditorAvailable(null)
  }, [editor, onEditorAvailable])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !working || editor.getHTML() === working.content) return
    editor.commands.setContent(working.content, { emitUpdate: false })
    ensureCurrentScriptEditorIdentity(editor)
  }, [editor, working])
  useEffect(() => {
    if (!editor || editor.isDestroyed || !annotations.length) return
    let transaction = editor.state.tr
    annotations.filter((annotation) => annotation.status === 'active').forEach((annotation) => {
      let exists = false
      editor.state.doc.descendants((node) => {
        if (node.isText && node.marks.some((mark) => mark.attrs.annotationId === annotation.id || mark.attrs.markerId === annotation.id)) exists = true
      })
      if (exists) return
      const from = positionAtPlainOffset(editor, annotation.blockStart)
      const to = positionAtPlainOffset(editor, annotation.blockEnd)
      if (from === null || to === null || from >= to || editor.state.doc.textBetween(from, to, '\n') !== annotation.selectedText) return
      const markType = editor.schema.marks[annotation.style === 'flag' ? 'scriptMarker' : annotation.style]
      if (!markType) return
      transaction = transaction.addMark(from, to, markType.create(annotation.style === 'flag'
        ? { markerId: annotation.id, markerNote: annotation.note || null, markerBlockId: 'body' }
        : { annotationId: annotation.id, annotationNote: annotation.note || null, annotationBlockId: 'body', ...(annotation.style === 'highlight' ? { color: '#F3D9A3' } : {}) }))
    })
    if (transaction.docChanged) editor.view.dispatch(transaction)
  }, [annotations, editor])
  useEffect(() => {
    savingRef.current = saving
    if (editor && !editor.isDestroyed) {
      editor.setEditable(Boolean(source) && !saving)
      setCurrentScriptEditorOperationLocked(editor, saving || !source)
    }
    if (saving) onActiveEditorRef.current(null)
  }, [editor, saving, source])
  useEffect(() => () => {
    if (onActiveEditorRef.current) onActiveEditorRef.current(null)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    if (pendingScrollRef.current !== null) onScrollTopChangeRef.current(pendingScrollRef.current)
  }, [editor])
  useEffect(() => {
    const target = editorScrollRef.current
    if (target && Math.abs(target.scrollTop - scrollTop) > 2) target.scrollTop = scrollTop
  }, [scrollTop, source?.id])

  const rememberScroll = (value: number): void => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    pendingScrollRef.current = Math.max(0, Math.round(value))
    scrollTimerRef.current = setTimeout(() => {
      const pending = pendingScrollRef.current
      pendingScrollRef.current = null
      if (pending !== null) onScrollTopChangeRef.current(pending)
    }, 160)
  }

  const sideName = side === 'left' ? '左侧' : '右侧'
  const visibleDiff = diff.filter((part) => part.kind === 'same' || part.kind === 'omitted' || (side === 'left' ? part.kind === 'removed' : part.kind === 'added'))
  return <article
    id={`version-working-${side}-panel`}
    role={narrow ? 'tabpanel' : undefined}
    aria-labelledby={narrow ? `version-working-${side}-panel-tab` : undefined}
    hidden={narrow && !active}
    className={`version-working-editor version-working-editor-${side}`}
    aria-label={`${sideName}版本编辑器`}
  >
    <header>
      <div><span>{side === 'left' ? '文案A' : '文案B'} · 原版本不会修改</span><b>{source?.label ?? `请为${sideName}选择来源`}</b></div>
      {source?.isFinal ? <em><Check size={12} />定稿</em> : null}
    </header>
    {source && working ? <>
      <CompareFormattingToolbar editor={editor} disabled={saving} />
      <EditorContent
        ref={editorScrollRef}
        onScroll={(event) => rememberScroll(event.currentTarget.scrollTop)}
        onContextMenu={(event) => {
          if (!editor || saving) return
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
          const selectedText = editor.state.doc.textBetween(from, to, '\n')
          if (!selectedText.trim()) return
          event.preventDefault()
          const blockStart = editor.state.doc.textBetween(0, from, '\n').length
          onSelectionContext({ side, x: event.clientX, y: event.clientY, from, to, selectedText, blockStart, blockEnd: blockStart + selectedText.length }, editor)
        }}
        className="version-rich-editor"
        editor={editor}
      />
      {diffVisible ? <div className="version-inline-diff" aria-label={`${sideName}差异参考`}>
        <span>差异参考·不会写入正文</span>
        <div className="version-diff-content">{visibleDiff.map((part, index) => <p className={part.kind} key={`${part.kind}-${index}`}>{part.text}</p>)}</div>
      </div> : null}
      <footer>
        <input
          aria-label={`${sideName}新版本名称`}
          disabled={saving}
          value={working.displayName}
          maxLength={80}
          placeholder="新版本名称"
          onChange={(event) => onChange({ displayName: event.currentTarget.value })}
        />
        <div className="version-editor-save-actions">
          <button disabled={saving || !working.plainText.trim()} onClick={onRestore}>恢复到工作台</button>
          <button className="primary-action" disabled={saving || !working.plainText.trim()} onClick={onSave}><Save size={13} />{saving ? '保存中…' : '另存新版本'}</button>
        </div>
      </footer>
    </> : <div className="version-editor-empty"><FileText size={18} /><span>在上方来源区选择一份文案</span></div>}
  </article>
}

export function ScriptVersionCompareView({
  versions,
  onImportFile,
  onSaveWorkingCopy,
  onRestoreWorkingCopy,
  onRestoreBusyChange,
  currentDocumentSnapshot,
  onFreezeCurrentDocument,
  codexModels,
  preferredCodexModel,
  codexAvailable,
  codexConversation,
  tasks,
  onCandidateStatus,
  onGenerateFusionCandidate,
  visible,
  narrow,
  mobileSide,
  sourcePanelOpen,
  diffVisible,
  scrollTops,
  onMobileSideChange,
  onSourcePanelOpenChange,
  onDiffVisibleChange,
  onScrollTopChange,
  onNotice
}: {
  versions: DraftVersion[]
  onImportFile(file: File): Promise<DraftVersion>
  onSaveWorkingCopy(input: SaveVersionWorkingCopyInput): Promise<DraftVersion>
  onRestoreWorkingCopy(input: SaveVersionWorkingCopyInput): Promise<void>
  onRestoreBusyChange?(busy: boolean): void
  currentDocumentSnapshot: ProjectCurrentScriptSnapshot | null
  onFreezeCurrentDocument(): Promise<ProjectCurrentScriptSnapshot | null>
  codexModels: CodexWritingModelOption[]
  preferredCodexModel: string | null
  codexAvailable: boolean
  codexConversation: ScriptRevisionConversation
  tasks: TaskRun[]
  onCandidateStatus(messageId: string, status: 'applied' | 'discarded'): Promise<void>
  onGenerateFusionCandidate(input: { request: RewriteRequest; sourceSelections: ContentSourceSelectionSnapshot[]; combinedText: string; target: VersionCandidateTarget; threadId: string | null }): Promise<TaskRun>
  visible: boolean
  narrow: boolean
  mobileSide: CompareSide
  sourcePanelOpen: boolean
  diffVisible: boolean
  scrollTops: { left: number; right: number }
  onMobileSideChange(side: CompareSide): void
  onSourcePanelOpenChange(value: boolean): void
  onDiffVisibleChange(value: boolean): void
  onScrollTopChange(side: CompareSide, scrollTop: number): void
  onNotice(message: string): void
}): React.JSX.Element {
  const scriptVersions = useMemo(() => versions
    .filter((version) => version.documentType === 'script')
    .sort((a, b) => b.revision - a.revision), [versions])
  const savedSources = useMemo(() => scriptVersions.map(sourceFromVersion), [scriptVersions])
  const [localSources, setLocalSources] = useState<CompareSource[]>([])
  const allSources = useMemo(() => {
    const byId = new Map<string, CompareSource>()
    localSources.forEach((source) => byId.set(source.id, source))
    savedSources.forEach((source) => byId.set(source.id, source))
    return Array.from(byId.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }, [localSources, savedSources])
  const [selectedIds, setSelectedIds] = useState<[string | null, string | null]>(() => [
    savedSources[0]?.id ?? null,
    savedSources[1]?.id ?? null
  ])
  const selectionCustomizedRef = useRef(false)
  const visibleRef = useRef(visible)
  useEffect(() => { visibleRef.current = visible }, [visible])
  const activeSide = mobileSide
  const [pasteLabel, setPasteLabel] = useState('')
  const [pasteContent, setPasteContent] = useState('')
  const [dragging, setDragging] = useState(false)
  const [workingCopies, setWorkingCopies] = useState<Record<string, WorkingCopy>>({})
  const [savingSide, setSavingSide] = useState<CompareSide | null>(null)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [selectionMenu, setSelectionMenu] = useState<VersionSelectionMenu | null>(null)
  const [selectionStage, setSelectionStage] = useState<'actions' | 'rewrite' | 'annotation'>('actions')
  const [annotationNote, setAnnotationNote] = useState('')
  const [fusionSources, setFusionSources] = useState<VersionFusionSource[]>([])
  const [fusionRequestOpen, setFusionRequestOpen] = useState(false)
  const [versionCandidateContinuation, setVersionCandidateContinuation] = useState<VersionCandidateContinuation | null>(null)
  const [pendingVersionRewrites, setPendingVersionRewrites] = useState<PendingVersionRewrite[]>([])
  const [activeVersionRewriteTaskId, setActiveVersionRewriteTaskId] = useState<string | null>(null)
  const [versionAnnotations, setVersionAnnotations] = useState<ScriptTextAnnotation[]>([])
  const editorsRef = useRef<Partial<Record<CompareSide, Editor>>>({})
  const [, setVersionEditorEpoch] = useState(0)
  useEffect(() => {
    const restorable = codexConversation.messages.flatMap((message): PendingVersionRewrite[] => {
      const applicationTarget = message.selectionSnapshot?.applicationTarget
      if (message.role !== 'assistant' || !message.taskId || !message.suggestion || message.suggestionStatus !== 'pending'
        || applicationTarget?.surface !== 'version_compare' || !message.selectionSnapshot?.targetSelectionId) return []
      return [{
        taskId: message.taskId,
        requestedModel: message.model,
        request: { quickIntent: null, requirement: message.candidateInstruction ?? '', preferredModel: message.model, preferredReasoningEffort: message.reasoningEffort },
        sourceSelections: message.sourceSelections,
        target: { targetSelectionId: message.selectionSnapshot.targetSelectionId, ...applicationTarget }
      }]
    })
    if (!restorable.length) return
    setPendingVersionRewrites((current) => {
      const byTask = new Map(current.map((item) => [item.taskId, item]))
      restorable.forEach((item) => { if (!byTask.has(item.taskId)) byTask.set(item.taskId, item) })
      return Array.from(byTask.values())
    })
  }, [codexConversation.messages])
  const registerLeftEditor = useCallback((editor: Editor | null) => {
    if (editor) editorsRef.current.left = editor
    else delete editorsRef.current.left
    setVersionEditorEpoch((value) => value + 1)
  }, [])
  const registerRightEditor = useCallback((editor: Editor | null) => {
    if (editor) editorsRef.current.right = editor
    else delete editorsRef.current.right
    setVersionEditorEpoch((value) => value + 1)
  }, [])

  const availableIds = useMemo(() => new Set(allSources.map((source) => source.id)), [allSources])
  const resolvedSelectedIds: [string | null, string | null] = [
    selectedIds[0] && availableIds.has(selectedIds[0]) ? selectedIds[0] : null,
    selectedIds[1] && availableIds.has(selectedIds[1]) ? selectedIds[1] : null
  ]
  const leftSource = allSources.find((source) => source.id === resolvedSelectedIds[0]) ?? null
  const rightSource = allSources.find((source) => source.id === resolvedSelectedIds[1]) ?? null
  const leftWorking = leftSource ? workingCopies[leftSource.id] ?? null : null
  const rightWorking = rightSource ? workingCopies[rightSource.id] ?? null : null

  useEffect(() => {
    const projectId = leftSource?.version?.projectId ?? rightSource?.version?.projectId ?? currentDocumentSnapshot?.document.projectId
    if (!projectId || !window.creatorOS) { setVersionAnnotations([]); return }
    let active = true
    void window.creatorOS.listSourceScriptAnnotations(projectId, { sourceKind: 'draft_version' })
      .then((annotations) => { if (active) setVersionAnnotations(annotations) })
      .catch(() => { if (active) setVersionAnnotations([]) })
    return () => { active = false }
  }, [currentDocumentSnapshot?.document.projectId, leftSource?.version?.id, leftSource?.version?.projectId, rightSource?.version?.id, rightSource?.version?.projectId])

  useEffect(() => {
    setSelectedIds((current) => {
      const next: [string | null, string | null] = [
        current[0] && availableIds.has(current[0]) ? current[0] : null,
        current[1] && availableIds.has(current[1]) ? current[1] : null
      ]
      const unused = allSources.filter((source) => !next.includes(source.id))
      if (!next[0]) next[0] = unused.shift()?.id ?? null
      if (!next[1]) next[1] = unused.shift()?.id ?? null
      return next[0] === current[0] && next[1] === current[1] ? current : next
    })
  }, [allSources, availableIds])
  useEffect(() => {
    if (visibleRef.current || selectionCustomizedRef.current) return
    setSelectedIds([savedSources[0]?.id ?? null, savedSources[1]?.id ?? null])
  }, [savedSources])

  useEffect(() => {
    setWorkingCopies((current) => {
      let next = current
      for (const source of [leftSource, rightSource]) {
        if (!source || next[source.id]) continue
        if (next === current) next = { ...current }
        next[source.id] = initialWorkingCopy(source)
      }
      return next
    })
  }, [leftSource, rightSource])

  const assignSources = (ids: string[]): void => {
    if (!ids.length) return
    selectionCustomizedRef.current = true
    const start = activeSide === 'left' ? 0 : 1
    setSelectedIds((current) => {
      const next: [string | null, string | null] = [...current]
      let target = start
      ids.forEach((id) => {
        const other = target === 0 ? 1 : 0
        if (next[other] === id) {
          const previousTarget = next[target] ?? null
          next[target] = next[other] ?? null
          next[other] = previousTarget
        } else next[target] = id
        target = other
      })
      return next
    })
    if (ids.length % 2 === 1) onMobileSideChange(activeSide === 'left' ? 'right' : 'left')
  }

  const addPaste = (): void => {
    if (!pasteContent.trim()) return
    const source: CompareSource = {
      id: `paste-${crypto.randomUUID()}`,
      label: pasteLabel.trim() || `粘贴稿${localSources.filter((item) => item.source === 'paste').length + 1}`,
      content: pasteContent,
      createdAt: new Date().toISOString(),
      isFinal: false,
      version: null,
      source: 'paste'
    }
    setLocalSources((current) => [...current, source])
    assignSources([source.id])
    setPasteLabel('')
    setPasteContent('')
  }

  const importFiles = async (files: File[]): Promise<void> => {
    const imported: CompareSource[] = []
    for (const file of files) {
      try {
        const version = await onImportFile(file)
        imported.push(sourceFromVersion(version))
      } catch (reason) {
        onNotice(reason instanceof Error ? reason.message : `${file.name}导入失败`)
      }
    }
    if (!imported.length) return
    setLocalSources((current) => [...current, ...imported.filter((source) => !current.some((item) => item.id === source.id))])
    assignSources(imported.map((source) => source.id))
  }

  const updateWorking = (sourceId: string, patch: Partial<Pick<WorkingCopy, 'content' | 'plainText' | 'displayName'>>): void => {
    setWorkingCopies((current) => {
      const working = current[sourceId]
      return working ? { ...current, [sourceId]: { ...working, ...patch } } : current
    })
  }

  const freezeVersionSelection = async (menu: VersionSelectionMenu): Promise<{ source: CompareSource; selection: ContentSourceSelectionSnapshot; target: VersionCandidateTarget; annotations: ScriptTextAnnotation[] }> => {
    const source = menu.side === 'left' ? leftSource : rightSource
    const working = menu.side === 'left' ? leftWorking : rightWorking
    if (!source || !working) throw new Error('对比来源已变化，请重新选择')
    let frozenSource = source
    let frozenAnnotations = source.version
      ? versionAnnotations.filter((annotation) => annotation.sourceId === source.version!.id
        && annotation.sourceVersion === String(source.version!.revision)
        && annotation.blockId === 'body' && annotation.status === 'active')
      : []
    const sourcePlainText = richTextHtmlToPlainText(sourceContentToRichTextHtml(source.content))
    if (!source.version || sourcePlainText !== working.plainText) {
      const cleanWorkingContent = stripScriptWorkbenchAnnotations(working.content)
      const version = await onSaveWorkingCopy({
        content: cleanWorkingContent,
        displayName: `${working.displayName || source.label}·选区快照`.slice(0, 80),
        sourceVersionId: source.version?.id ?? null
      })
      frozenSource = sourceFromVersion(version)
      const migratedAnnotations: ScriptTextAnnotation[] = []
      if (source.version && window.creatorOS) {
        const sourceRows = frozenAnnotations
        for (const annotation of sourceRows) {
          let start = -1
          if (working.plainText.slice(annotation.blockStart, annotation.blockEnd) === annotation.selectedText) {
            // Exact frozen coordinates win even when the same wording appears elsewhere.
            start = annotation.blockStart
          } else {
            const first = working.plainText.indexOf(annotation.selectedText)
            if (first >= 0 && first === working.plainText.lastIndexOf(annotation.selectedText)) start = first
          }
          if (start < 0) continue
          migratedAnnotations.push(await window.creatorOS.upsertSourceScriptAnnotation({
            id: `script-annotation-${crypto.randomUUID()}`,
            projectId: version.projectId,
            sourceKind: 'draft_version',
            sourceId: version.id,
            sourceVersion: String(version.revision),
            blockId: 'body',
            blockStart: start,
            blockEnd: start + annotation.selectedText.length,
            selectedText: annotation.selectedText,
            style: annotation.style,
            note: annotation.note,
            status: 'active'
          }))
        }
      }
      frozenAnnotations = migratedAnnotations
      if (migratedAnnotations.length) setVersionAnnotations((current) => [...current, ...migratedAnnotations])
      setLocalSources((current) => current.some((item) => item.id === version.id) ? current : [...current, frozenSource])
      setWorkingCopies((current) => ({
        ...current,
        [version.id]: {
          sourceId: version.id,
          content: cleanWorkingContent,
          plainText: working.plainText,
          displayName: `${frozenSource.label}副本`.slice(0, 80)
        }
      }))
      setSelectedIds((current) => {
        const next: [string | null, string | null] = [...current]
        next[menu.side === 'left' ? 0 : 1] = version.id
        return next
      })
      onMobileSideChange(menu.side)
      onNotice('已将当前工作副本冻结为新版本，再用于局部候选')
    }
    const version = frozenSource.version
    if (!version) throw new Error('选区版本冻结失败')
    const frozenPlainText = richTextHtmlToPlainText(sourceContentToRichTextHtml(version.workspaceContent ?? version.content))
    let blockStart = menu.blockStart
    let blockEnd = menu.blockEnd
    if (frozenPlainText.slice(blockStart, blockEnd) !== menu.selectedText) {
      const uniqueStart = frozenPlainText.indexOf(menu.selectedText)
      if (uniqueStart < 0 || uniqueStart !== frozenPlainText.lastIndexOf(menu.selectedText)) throw new Error('冻结后的选区无法唯一定位，请重新选择')
      blockStart = uniqueStart
      blockEnd = uniqueStart + menu.selectedText.length
    }
    const contentHash = await sha256(frozenPlainText)
    return {
      source: frozenSource,
      annotations: frozenAnnotations,
      target: {
        targetSelectionId: `version-target-${crypto.randomUUID()}`,
        side: menu.side,
        sourceId: version.id,
        contentHash: await sha256(stripScriptWorkbenchAnnotations(working.content)),
        content: stripScriptWorkbenchAnnotations(working.content),
        range: { from: menu.from, to: menu.to, selectedText: menu.selectedText }
      },
      selection: {
        selectionId: `version-selection-${crypto.randomUUID()}`,
        position: 0,
        sourceKind: 'draft_version',
        sourceId: version.id,
        sourceVersion: String(version.revision),
        sourceContentHash: contentHash,
        sourceLabel: frozenSource.label,
        semanticGroupId: null,
        blockId: 'body',
        blockStart,
        blockEnd,
        selectedText: menu.selectedText
      }
    }
  }

  const addVersionSelectionToFusion = async (): Promise<void> => {
    if (!selectionMenu) return
    const frozen = await freezeVersionSelection(selectionMenu)
    setFusionSources((current) => {
      const sourceIndex = current.findIndex((item) => item.selections[0]?.sourceId === frozen.selection.sourceId)
      if (sourceIndex >= 0) {
        if (current[sourceIndex]!.selections.some((selection) => selection.blockStart === frozen.selection.blockStart && selection.blockEnd === frozen.selection.blockEnd)) return current
        return current.map((item, index) => index === sourceIndex ? { ...item, selections: [...item.selections, frozen.selection] } : item)
      }
      if (current.length >= 4) { onNotice('版本综合一次最多选择4个来源'); return current }
      return [...current, { id: crypto.randomUUID(), label: frozen.source.label, selections: [frozen.selection] }]
    })
    setSelectionMenu(null)
    setSelectionStage('actions')
  }

  const addCurrentDocumentToFusion = async (): Promise<void> => {
    const frozenSnapshot = await onFreezeCurrentDocument().catch((reason: unknown) => {
      onNotice(reason instanceof Error ? reason.message : '当前文案暂时无法冻结，请稍后重试')
      return null
    })
    if (!frozenSnapshot) { onNotice('当前文案尚未完成保存，暂时不能作为综合来源'); return }
    const blocks = frozenSnapshot.blocks.filter((block) => block.text.trim())
    if (blocks.length > 100) { onNotice('当前文案可选文本块超过100个，请在当前文案页划选需要的范围'); return }
    const selections = blocks.map((block, position) => ({
      selectionId: `current-selection-${crypto.randomUUID()}`,
      position,
      sourceKind: 'current_script' as const,
      sourceId: frozenSnapshot.document.workingDocumentId,
      sourceVersion: frozenSnapshot.document.contentHash,
      sourceContentHash: frozenSnapshot.document.contentHash,
      sourceLabel: '当前文案',
      semanticGroupId: null,
      blockId: block.blockId,
      blockStart: 0,
      blockEnd: block.text.length,
      selectedText: block.text
    }))
    if (!selections.length) return
    setFusionSources((current) => {
      if (current.some((item) => item.selections[0]?.sourceKind === 'current_script')) return current
      if (current.length >= 4) { onNotice('版本综合一次最多选择4个来源'); return current }
      return [...current, { id: crypto.randomUUID(), label: '当前文案', selections }]
    })
  }

  const captureVersionTarget = async (side: CompareSide, range: VersionCandidateTarget['range'] = null): Promise<VersionCandidateTarget> => {
    const source = side === 'left' ? leftSource : rightSource
    const working = side === 'left' ? leftWorking : rightWorking
    if (!source || !working) throw new Error('请先选择候选要写入的A／B工作副本')
    const content = stripScriptWorkbenchAnnotations(working.content)
    return { targetSelectionId: `version-target-${crypto.randomUUID()}`, side, sourceId: source.id, contentHash: await sha256(content), content, range }
  }

  const startVersionCandidate = async (
    request: RewriteRequest,
    selections: ContentSourceSelectionSnapshot[],
    target: VersionCandidateTarget,
    options: { inputText?: string; threadId?: string | null } = {}
  ): Promise<void> => {
    if (!selections.length) return
    const positioned = selections.map((selection, position) => ({ ...selection, position }))
    const combinedText = options.inputText ?? (positioned.length === 1
      ? positioned[0]!.selectedText
      : positioned.map((selection) => `[来源：${selection.sourceLabel}]\n${selection.selectedText}`).join('\n\n'))
    const task = await onGenerateFusionCandidate({ request, sourceSelections: positioned, combinedText, target, threadId: options.threadId ?? null })
    setPendingVersionRewrites((current) => [...current.filter((item) => item.taskId !== task.id), {
      taskId: task.id,
      requestedModel: request.preferredModel,
      request,
      sourceSelections: positioned,
      target
    }])
    setActiveVersionRewriteTaskId(task.id)
    setSelectionMenu(null)
    setFusionRequestOpen(false)
    setVersionCandidateContinuation(null)
    onNotice('已冻结选区和应用目标并在后台生成候选')
  }

  const applyVersionAnnotation = async (style: 'highlight' | 'underline' | 'strike' | 'flag', note = ''): Promise<void> => {
    if (!selectionMenu) return
    const frozen = await freezeVersionSelection(selectionMenu)
    const id = `script-annotation-${crypto.randomUUID()}`
    const saved = await window.creatorOS?.upsertSourceScriptAnnotation({
      projectId: frozen.source.version!.projectId,
      sourceKind: 'draft_version',
      sourceId: frozen.source.version!.id,
      sourceVersion: String(frozen.source.version!.revision),
      id,
      blockId: 'body',
      blockStart: frozen.selection.blockStart,
      blockEnd: frozen.selection.blockEnd,
      selectedText: frozen.selection.selectedText,
      style,
      note: note.trim(),
      status: 'active'
    })
    if (saved) setVersionAnnotations((current) => [...current.filter((annotation) => annotation.id !== saved.id), saved])
    setSelectionMenu(null)
    setSelectionStage('actions')
    setAnnotationNote('')
    onNotice('已添加版本工作台标记，普通导出不会带入')
  }

  const clearVersionAnnotations = async (): Promise<void> => {
    if (!selectionMenu || !window.creatorOS) return
    const frozen = await freezeVersionSelection(selectionMenu)
    const version = frozen.source.version
    if (!version) return
    const start = frozen.selection.blockStart
    const end = frozen.selection.blockEnd
    const body = richTextHtmlToPlainText(sourceContentToRichTextHtml(frozen.source.content))
    const matches = frozen.annotations.filter((annotation) => annotation.sourceId === version.id
      && annotation.sourceVersion === String(version.revision)
      && annotation.blockId === 'body'
      && annotation.blockEnd > start && annotation.blockStart < end)
    const replacements: ScriptTextAnnotation[] = []
    for (const annotation of matches) {
      await window.creatorOS.deleteSourceScriptAnnotation(annotation.projectId, annotation.id)
      for (const [pieceStart, pieceEnd] of [[annotation.blockStart, Math.min(annotation.blockEnd, start)], [Math.max(annotation.blockStart, end), annotation.blockEnd]] as const) {
        if (pieceEnd <= pieceStart) continue
        replacements.push(await window.creatorOS.upsertSourceScriptAnnotation({
          id: `script-annotation-${crypto.randomUUID()}`,
          projectId: annotation.projectId,
          sourceKind: 'draft_version',
          sourceId: annotation.sourceId,
          sourceVersion: annotation.sourceVersion,
          blockId: 'body',
          blockStart: pieceStart,
          blockEnd: pieceEnd,
          selectedText: body.slice(pieceStart, pieceEnd),
          style: annotation.style,
          note: annotation.note,
          status: annotation.status
        }))
      }
    }
    setVersionAnnotations((current) => [...current.filter((annotation) => !matches.some((match) => match.id === annotation.id)), ...replacements])
    const targetEditorCandidate = editorsRef.current[selectionMenu.side]
    const targetEditor = targetEditorCandidate && !targetEditorCandidate.isDestroyed ? targetEditorCandidate : null
    if (targetEditor) {
      let transaction = targetEditor.state.tr
      targetEditor.state.doc.descendants((node, position) => {
        if (!node.isText) return
        node.marks.forEach((mark) => {
          const id = mark.type.name === 'scriptMarker' ? mark.attrs.markerId : mark.attrs.annotationId
          if (matches.some((annotation) => annotation.id === id)) transaction = transaction.removeMark(position, position + node.nodeSize, mark)
        })
      })
      if (transaction.docChanged) targetEditor.view.dispatch(transaction)
    }
    setSelectionMenu(null)
    setSelectionStage('actions')
    setAnnotationNote('')
    onNotice(matches.length ? '已从所选范围清除工作台标记' : '所选范围没有工作台标记')
  }

  const saveWorking = async (side: CompareSide): Promise<void> => {
    const source = side === 'left' ? leftSource : rightSource
    const working = side === 'left' ? leftWorking : rightWorking
    if (!source || !working || !working.plainText.trim() || savingSide) return
    setSavingSide(side)
    try {
      const version = await onSaveWorkingCopy({
        content: working.content,
        displayName: working.displayName.trim() || `${source.label}副本`,
        sourceVersionId: source.version?.id ?? null
      })
      setLocalSources((current) => current.some((item) => item.id === version.id) ? current : [...current, sourceFromVersion(version)])
      onNotice(`${versionLabel(version)}已另存，原版本保持不变`)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '另存新版本失败')
    } finally {
      setSavingSide(null)
    }
  }

  const restoreWorking = async (side: CompareSide): Promise<void> => {
    const source = side === 'left' ? leftSource : rightSource
    const working = side === 'left' ? leftWorking : rightWorking
    if (!source || !working || !working.plainText.trim() || savingSide) return
    setSavingSide(side)
    onRestoreBusyChange?.(true)
    try {
      await onRestoreWorkingCopy({
        content: working.content,
        displayName: working.displayName.trim() || `${source.label}恢复版`,
        sourceVersionId: source.version?.id ?? null
      })
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '恢复到工作台失败')
    } finally {
      setSavingSide(null)
      onRestoreBusyChange?.(false)
    }
  }

  const deferredLeftText = useDeferredValue(leftWorking?.plainText ?? '')
  const deferredRightText = useDeferredValue(rightWorking?.plainText ?? '')
  const diff = useMemo(() => leftSource && rightSource ? lineDiff(deferredLeftText, deferredRightText) : [], [deferredLeftText, deferredRightText, leftSource, rightSource])
  const activeVersionRewrite = activeVersionRewriteTaskId
    ? pendingVersionRewrites.find((item) => item.taskId === activeVersionRewriteTaskId) ?? null
    : null
  const pendingFusionMessage = activeVersionRewrite
    ? codexConversation.messages.find((message) => message.role === 'assistant' && message.taskId === activeVersionRewrite.taskId && message.suggestion) ?? null
    : null
  const activeTargetWorking = activeVersionRewrite ? workingCopies[activeVersionRewrite.target.sourceId] ?? null : null
  const activeTargetSourceId = activeVersionRewrite?.target.side === 'left' ? resolvedSelectedIds[0] : activeVersionRewrite?.target.side === 'right' ? resolvedSelectedIds[1] : null
  const activeTargetEditorCandidate = activeVersionRewrite ? editorsRef.current[activeVersionRewrite.target.side] ?? null : null
  const activeTargetEditor = activeTargetEditorCandidate && !activeTargetEditorCandidate.isDestroyed ? activeTargetEditorCandidate : null
  const usableActiveEditor = activeEditor && !activeEditor.isDestroyed ? activeEditor : null
  const activeTargetRangeChanged = Boolean(activeVersionRewrite?.target.range && activeTargetEditor && (
    activeVersionRewrite.target.range.to > activeTargetEditor.state.doc.content.size
    || activeTargetEditor.state.doc.textBetween(activeVersionRewrite.target.range.from, activeVersionRewrite.target.range.to, '\n') !== activeVersionRewrite.target.range.selectedText
  ))
  const activeVersionTargetChanged = Boolean(activeVersionRewrite && (
    activeTargetSourceId !== activeVersionRewrite.target.sourceId
    || !activeTargetWorking
    || stripScriptWorkbenchAnnotations(activeTargetWorking.content) !== activeVersionRewrite.target.content
    || !activeTargetEditor
    || activeTargetRangeChanged
  ))

  const removeVersionRewrite = (taskId: string): void => {
    setPendingVersionRewrites((current) => current.filter((item) => item.taskId !== taskId))
    setActiveVersionRewriteTaskId((current) => current === taskId ? null : current)
  }

  const applyActiveVersionCandidate = async (mode: 'append' | 'replace'): Promise<void> => {
    if (!activeVersionRewrite || !pendingFusionMessage?.suggestion || activeVersionTargetChanged || !activeTargetEditor) {
      onNotice('原应用目标已经变化，请重新选择后再使用候选')
      return
    }
    const replacement = sourceContentToRichTextHtml(pendingFusionMessage.suggestion.replacementText)
    const range = activeVersionRewrite.target.range
    if (range) {
      const target = mode === 'replace' ? { from: range.from, to: range.to } : range.to
      activeTargetEditor.commands.insertContentAt(target, replacement)
    } else if (mode === 'append') {
      activeTargetEditor.chain().focus('end').insertContent(sourceContentToRichTextHtml(`\n\n${pendingFusionMessage.suggestion.replacementText}`)).run()
    } else {
      activeTargetEditor.commands.setContent(replacement)
      ensureCurrentScriptEditorIdentity(activeTargetEditor)
    }
    await onCandidateStatus(pendingFusionMessage.id, 'applied')
    removeVersionRewrite(activeVersionRewrite.taskId)
    onNotice(`${range ? '局部候选' : '综合候选'}已${mode === 'append' ? '追加' : '替换'}到绑定的${activeVersionRewrite.target.side === 'left' ? 'A' : 'B'}工作副本，原版本和当前文案未改动`)
  }

  const continueActiveVersionCandidate = async (): Promise<void> => {
    if (!activeVersionRewrite || !pendingFusionMessage?.suggestion) return
    const conflictsById = new Map<string, ContentSelectionConflict>()
    ;[...(activeVersionRewrite.target.inheritedConflicts ?? []), ...pendingFusionMessage.conflicts]
      .forEach((conflict) => conflictsById.set(conflict.id, conflict))
    onMobileSideChange(activeVersionRewrite.target.side)
    setVersionCandidateContinuation({
      inputText: pendingFusionMessage.suggestion.replacementText,
      threadId: pendingFusionMessage.threadId,
      sourceSelections: activeVersionRewrite.sourceSelections,
      target: { ...activeVersionRewrite.target, inheritedConflicts: Array.from(conflictsById.values()) }
    })
    setFusionRequestOpen(true)
    setActiveVersionRewriteTaskId(null)
  }

  return <section className={`script-version-compare version-mobile-side-${mobileSide}`}>
    <header>
      <div><span>单页面自由对比·原版本不会修改</span><h2>版本对比</h2></div>
      <div className="version-compare-toolbar" role="toolbar" aria-label="版本对比工具">
        <button aria-expanded={sourcePanelOpen} onClick={() => onSourcePanelOpenChange(!sourcePanelOpen)}>{sourcePanelOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{sourcePanelOpen ? '收起来源' : '展开来源'}</button>
        <button className={diffVisible ? 'active' : ''} aria-pressed={diffVisible} onClick={() => onDiffVisibleChange(!diffVisible)}><GitCompareArrows size={13} />差异</button>
        <button aria-label="撤销当前版本编辑" disabled={Boolean(savingSide) || !usableActiveEditor?.can().undo()} onClick={() => usableActiveEditor?.chain().focus().undo().run()}><Undo2 size={13} /></button>
        <button aria-label="重做当前版本编辑" disabled={Boolean(savingSide) || !usableActiveEditor?.can().redo()} onClick={() => usableActiveEditor?.chain().focus().redo().run()}><Redo2 size={13} /></button>
      </div>
    </header>

    {sourcePanelOpen ? <section className="version-source-panel" aria-label="对比来源">
      <div className="version-source-slot-switch" role="group" aria-label="选择要更换的对比栏">
        <button className={activeSide === 'left' ? 'active' : ''} aria-pressed={activeSide === 'left'} onClick={() => onMobileSideChange('left')}><span>A</span>{leftSource?.label ?? '选择左侧来源'}</button>
        <button className={activeSide === 'right' ? 'active' : ''} aria-pressed={activeSide === 'right'} onClick={() => onMobileSideChange('right')}><span>B</span>{rightSource?.label ?? '选择右侧来源'}</button>
      </div>
      <div className="version-compare-inputs">
        <div className="version-paste-source">
          <input aria-label="粘贴稿名称" value={pasteLabel} placeholder="名称（可不填）" onChange={(event) => setPasteLabel(event.currentTarget.value)} />
          <textarea aria-label="粘贴对比文字" value={pasteContent} maxLength={400_000} placeholder="在这里粘贴任意文案…" onChange={(event) => setPasteContent(event.currentTarget.value)} />
          <button disabled={!pasteContent.trim()} onClick={addPaste}><Plus size={13} />加入{activeSide === 'left' ? 'A' : 'B'}</button>
        </div>
        <div
          className={`version-file-drop${dragging ? ' dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles(Array.from(event.dataTransfer.files)) }}
        >
          <Upload size={17} /><b>拖入文件作为来源</b><span>Markdown、纯文本、Word·可多选</span>
        </div>
      </div>
      <div className="version-compare-picker" role="group" aria-label="选择对比版本">
        {currentDocumentSnapshot ? <article className={fusionSources.some((item) => item.selections[0]?.sourceKind === 'current_script') ? 'selected fusion-selected' : ''}>
          <button className="version-source-select" aria-pressed={fusionSources.some((item) => item.selections[0]?.sourceKind === 'current_script')} onClick={addCurrentDocumentToFusion}>
            <span><Plus size={13} /></span><b>当前文案</b><small>加入2—4来源综合候选·不替换A／B</small>
          </button>
        </article> : null}
        {allSources.map((source) => {
          const selectedIndex = resolvedSelectedIds.indexOf(source.id)
          return <article key={source.id} className={selectedIndex >= 0 ? 'selected' : ''}>
            <button className="version-source-select" aria-pressed={selectedIndex >= 0} onClick={() => assignSources([source.id])}>
              <span>{selectedIndex >= 0 ? selectedIndex === 0 ? 'A' : 'B' : <FileText size={13} />}</span>
              <b>{source.label}</b>
              <small>{source.source === 'paste' ? '自由粘贴' : new Date(source.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{source.isFinal ? ' · 当前定稿' : ''}</small>
            </button>
            {source.source === 'paste' ? <button className="version-source-remove" aria-label={`移除${source.label}`} onClick={() => {
              setLocalSources((current) => current.filter((item) => item.id !== source.id))
              setSelectedIds((current) => current.map((id) => id === source.id ? null : id) as [string | null, string | null])
            }}><X size={11} /></button> : null}
          </article>
        })}
      </div>
    </section> : null}

    <div className="version-working-grid">
      <VersionWorkingEditor
        side="left"
        source={leftSource}
        working={leftWorking}
        diff={diff}
        diffVisible={diffVisible}
        saving={savingSide !== null}
        onChange={(patch) => leftSource && updateWorking(leftSource.id, patch)}
        onSave={() => void saveWorking('left')}
        onRestore={() => void restoreWorking('left')}
        onActiveEditor={(editor) => { setActiveEditor(editor); if (editor) onMobileSideChange('left') }}
        onEditorAvailable={registerLeftEditor}
        onSelectionContext={(menu, editor) => { setActiveEditor(editor); onMobileSideChange('left'); setSelectionMenu(menu); setSelectionStage('actions'); setAnnotationNote('') }}
        annotations={leftSource?.version ? versionAnnotations.filter((annotation) => annotation.sourceId === leftSource.version!.id && annotation.sourceVersion === String(leftSource.version!.revision)) : []}
        narrow={narrow}
        active={mobileSide === 'left'}
        scrollTop={scrollTops.left}
        onScrollTopChange={(value) => onScrollTopChange('left', value)}
      />
      <VersionWorkingEditor
        side="right"
        source={rightSource}
        working={rightWorking}
        diff={diff}
        diffVisible={diffVisible}
        saving={savingSide !== null}
        onChange={(patch) => rightSource && updateWorking(rightSource.id, patch)}
        onSave={() => void saveWorking('right')}
        onRestore={() => void restoreWorking('right')}
        onActiveEditor={(editor) => { setActiveEditor(editor); if (editor) onMobileSideChange('right') }}
        onEditorAvailable={registerRightEditor}
        onSelectionContext={(menu, editor) => { setActiveEditor(editor); onMobileSideChange('right'); setSelectionMenu(menu); setSelectionStage('actions'); setAnnotationNote('') }}
        annotations={rightSource?.version ? versionAnnotations.filter((annotation) => annotation.sourceId === rightSource.version!.id && annotation.sourceVersion === String(rightSource.version!.revision)) : []}
        narrow={narrow}
        active={mobileSide === 'right'}
        scrollTop={scrollTops.right}
        onScrollTopChange={(value) => onScrollTopChange('right', value)}
      />
    </div>
    {fusionSources.length ? <aside className="comparison-fusion-basket version-fusion-basket" aria-label="版本综合来源">
      <header><div><b>2—4来源综合</b><small>已冻结{fusionSources.length}个来源</small></div><button aria-label="清空版本综合来源" onClick={() => setFusionSources([])}><X size={13} /></button></header>
      <div>{fusionSources.map((source) => <span key={source.id}>{source.label}<button aria-label={`移除${source.label}`} onClick={() => setFusionSources((current) => current.filter((item) => item.id !== source.id))}><X size={10} /></button></span>)}</div>
      <button className="primary-action" disabled={fusionSources.length < 2 || !codexAvailable} onClick={() => setFusionRequestOpen(true)}><Combine size={13} />综合成统一候选…</button>
    </aside> : null}
    {pendingVersionRewrites.length ? <aside className="selection-candidate-dock version-candidate-dock" aria-label="版本局部候选任务">
      <b>局部候选</b>
      <div>{pendingVersionRewrites.map((pending, index) => {
        const message = codexConversation.messages.find((item) => item.role === 'assistant' && item.taskId === pending.taskId && item.suggestion)
        const task = tasks.find((item) => item.id === pending.taskId)
        const terminal = task?.status === 'failed' || task?.status === 'canceled'
        const label = message ? '已完成·查看' : task?.status === 'failed' ? '失败·移除' : task?.status === 'canceled' ? '已取消·移除' : '生成中'
        return <button key={pending.taskId} title={task?.errorMessage ?? undefined} className={activeVersionRewriteTaskId === pending.taskId ? 'active' : ''} onClick={() => terminal ? removeVersionRewrite(pending.taskId) : setActiveVersionRewriteTaskId(pending.taskId)}><span>{index + 1}</span>{label}</button>
      })}</div>
    </aside> : null}
    {selectionMenu && selectionStage === 'actions' ? <SelectionActionMenu
      anchor={usableActiveEditor?.view.dom ?? null}
      anchorPoint={{ x: selectionMenu.x, y: selectionMenu.y }}
      selectionLabel={`${selectionMenu.selectedText.slice(0, 56)}${selectionMenu.selectedText.length > 56 ? '…' : ''}`}
      allowFusion
      onDismiss={() => setSelectionMenu(null)}
      onRewrite={() => setSelectionStage('rewrite')}
      onFusion={() => void addVersionSelectionToFusion().catch((reason) => onNotice(reason instanceof Error ? reason.message : '选区冻结失败'))}
      onAnnotation={(style) => void applyVersionAnnotation(style).catch((reason) => onNotice(reason instanceof Error ? reason.message : '标记失败'))}
      onNote={() => setSelectionStage('annotation')}
      onClear={() => void clearVersionAnnotations().catch((reason) => onNotice(reason instanceof Error ? reason.message : '清除标记失败'))}
    /> : null}
    {selectionMenu && selectionStage === 'rewrite' ? <RewriteRequestPanel
      anchor={usableActiveEditor?.view.dom ?? null}
      anchorPoint={{ x: selectionMenu.x, y: selectionMenu.y }}
      selectionLabel={`所选${selectionMenu.selectedText.length}字`}
      projectId={versions[0]?.projectId ?? ''}
      sessionScope={`version-comparison:${versions[0]?.projectId ?? 'unknown'}`}
      models={codexModels}
      initialModel={preferredCodexModel}
      initialReasoningEffort="xhigh"
      busy={!codexAvailable}
      onBack={() => setSelectionStage('actions')}
      onDismiss={() => setSelectionMenu(null)}
      onSubmit={(request) => void freezeVersionSelection(selectionMenu).then((frozen) => startVersionCandidate(request, [frozen.selection], frozen.target)).catch((reason) => onNotice(reason instanceof Error ? reason.message : '候选生成失败'))}
    /> : null}
    {selectionMenu && selectionStage === 'annotation' ? <TextAnnotationMenu
      anchor={usableActiveEditor?.view.dom ?? null}
      anchorPoint={{ x: selectionMenu.x, y: selectionMenu.y }}
      note={annotationNote}
      onNoteChange={setAnnotationNote}
      onApply={(style, note) => void applyVersionAnnotation(style, note).catch((reason) => onNotice(reason instanceof Error ? reason.message : '标记失败'))}
      onClear={() => void clearVersionAnnotations().catch((reason) => onNotice(reason instanceof Error ? reason.message : '清除标记失败'))}
      onDismiss={() => { setSelectionMenu(null); setSelectionStage('actions'); setAnnotationNote('') }}
    /> : null}
    {fusionRequestOpen ? <RewriteRequestPanel
      anchor={usableActiveEditor?.view.dom ?? null}
      anchorPoint={{ x: Math.round(window.innerWidth / 2), y: Math.min(420, Math.round(window.innerHeight / 2)) }}
      selectionLabel={versionCandidateContinuation ? `沿用${versionCandidateContinuation.sourceSelections.length}个冻结来源` : `${fusionSources.length}个版本／当前文案来源`}
      projectId={versions[0]?.projectId ?? ''}
      sessionScope={`version-comparison:${versions[0]?.projectId ?? 'unknown'}`}
      models={codexModels}
      initialModel={preferredCodexModel}
      initialReasoningEffort="xhigh"
      busy={!codexAvailable}
      onDismiss={() => { setFusionRequestOpen(false); setVersionCandidateContinuation(null) }}
      onSubmit={(request) => void (versionCandidateContinuation
        ? startVersionCandidate(request, versionCandidateContinuation.sourceSelections, versionCandidateContinuation.target, { inputText: versionCandidateContinuation.inputText, threadId: versionCandidateContinuation.threadId })
        : captureVersionTarget(activeSide).then((target) => startVersionCandidate(request, fusionSources.flatMap((source) => source.selections), target)))
        .catch((reason) => onNotice(reason instanceof Error ? reason.message : '综合候选生成失败'))}
    /> : null}
    <RewriteCandidateDialog
      candidate={pendingFusionMessage?.suggestion && activeVersionRewrite ? {
        id: pendingFusionMessage.id,
        originalText: pendingFusionMessage.suggestion.originalText,
        candidateText: pendingFusionMessage.suggestion.replacementText,
        providerLabel: 'Codex',
        requestedModel: activeVersionRewrite.requestedModel,
        actualModel: pendingFusionMessage.model,
        actualReasoningEffort: pendingFusionMessage.reasoningEffort,
        generationRound: pendingFusionMessage.generationRound ?? 1,
        sourceSelections: pendingFusionMessage.sourceSelections.length ? pendingFusionMessage.sourceSelections : activeVersionRewrite.sourceSelections,
        conflicts: Array.from(new Map([...(activeVersionRewrite.target.inheritedConflicts ?? []), ...pendingFusionMessage.conflicts].map((conflict) => [conflict.id, conflict])).values()),
        mode: activeVersionRewrite.sourceSelections.length > 1 ? 'fusion' : 'rewrite',
        targetChanged: activeVersionTargetChanged
      } : null}
      remainingCount={Math.max(0, pendingVersionRewrites.length - 1)}
      onClose={() => setActiveVersionRewriteTaskId(null)}
      onContinue={() => void continueActiveVersionCandidate().catch((reason) => onNotice(reason instanceof Error ? reason.message : '继续修改失败'))}
      onAppend={() => void applyActiveVersionCandidate('append').catch((reason) => onNotice(reason instanceof Error ? reason.message : '应用候选失败'))}
      onReplace={() => void applyActiveVersionCandidate('replace').catch((reason) => onNotice(reason instanceof Error ? reason.message : '应用候选失败'))}
    />
  </section>
}
