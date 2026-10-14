import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'
import { Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StructuredReferenceCatalogItem, StructuredReferenceUse } from '../../../../../shared/domain'
import { ReferencePickerPopover } from './ReferencePickerPopover'
import { ReferencePreflightNotice } from './ReferencePreflightNotice'
import { ReferenceRolePopover } from './ReferenceRolePopover'
import { StructuredReferenceMention } from './StructuredReferenceMention'
import {
  allowedStructuredReferenceScopes,
  composerBlockingReferences,
  composerPendingReferences,
  createStructuredReferenceUse,
  type StructuredComposerSnapshot,
  withManualReferenceRole,
  withRuntimeFallback
} from './structured-reference-composer-state'

function editorSnapshot(editor: NonNullable<ReturnType<typeof useEditor>>): StructuredComposerSnapshot {
  const references: StructuredReferenceUse[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'structuredReference' && node.attrs.reference) references.push(structuredClone(node.attrs.reference as StructuredReferenceUse))
  })
  return {
    displayText: editor.getText({ blockSeparator: '\n' }),
    editorDocument: editor.getJSON() as Record<string, unknown>,
    references
  }
}

function updateReferenceNode(editor: NonNullable<ReturnType<typeof useEditor>>, occurrenceId: string, nextReference: StructuredReferenceUse): void {
  let transaction = editor.state.tr
  editor.state.doc.descendants((node, position) => {
    const reference = node.type.name === 'structuredReference' ? node.attrs.reference as StructuredReferenceUse | null : null
    if (reference?.occurrenceId === occurrenceId) transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, reference: nextReference })
  })
  if (transaction.docChanged) editor.view.dispatch(transaction)
}

export interface StructuredReferenceEditorProps {
  projectId: string
  sessionScope: string
  value: string
  placeholder: string
  disabled?: boolean
  compact?: boolean
  autoFocus?: boolean
  hasCurrentTarget?: boolean
  ariaLabel: string
  onValueChange(value: string): void
  onSnapshotChange?(snapshot: StructuredComposerSnapshot): void
}

export function StructuredReferenceEditor({ projectId, sessionScope, value, placeholder, disabled = false, compact = false, autoFocus = false, hasCurrentTarget = false, ariaLabel, onValueChange, onSnapshotChange }: StructuredReferenceEditorProps): React.JSX.Element {
  const [catalog, setCatalog] = useState<StructuredReferenceCatalogItem[]>([])
  const [picker, setPicker] = useState<{ from: number; to: number; point: { x: number; y: number }; query: string } | null>(null)
  const [activeReference, setActiveReference] = useState<{ reference: StructuredReferenceUse; anchor: HTMLElement } | null>(null)
  const [snapshot, setSnapshot] = useState<StructuredComposerSnapshot>({ displayText: value, editorDocument: { type: 'doc', content: [{ type: 'paragraph' }] }, references: [] })
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolveGenerationRef = useRef(0)
  const resolvingRef = useRef(false)
  const lastDisplayRef = useRef(value)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const extensions = useMemo(() => [StarterKit.configure({ heading: false, horizontalRule: false, blockquote: false, codeBlock: false }), StructuredReferenceMention], [])
  const editor = useEditor({
    extensions,
    content: value ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } : '',
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: { 'aria-label': ariaLabel, 'data-placeholder': placeholder, placeholder },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const resolveGeneration = ++resolveGenerationRef.current
      const next = editorSnapshot(activeEditor)
      lastDisplayRef.current = next.displayText
      setSnapshot(next)
      onValueChange(next.displayText)
      onSnapshotChange?.(next)
      if (!resolvingRef.current) {
        const { from } = activeEditor.state.selection
        const before = activeEditor.state.doc.textBetween(0, from, '\n', (node) => node.type.name === 'structuredReference' ? `@${(node.attrs.reference as StructuredReferenceUse | null)?.label ?? '引用'}` : '')
        const match = /@([^\s@，。！？；;：:\n]{0,40})$/u.exec(before)
        if (match) {
          const point = activeEditor.view.coordsAtPos(from)
          setPicker({ from: Math.max(0, from - match[0].length), to: from, point: { x: point.left, y: point.bottom }, query: match[1] ?? '' })
        }
      }
      if (resolveTimer.current) clearTimeout(resolveTimer.current)
      if (next.references.length && window.creatorOS) {
        resolveTimer.current = setTimeout(() => {
          void window.creatorOS!.resolveStructuredReferenceRoles({ text: next.displayText, references: next.references })
            .then((results) => {
              if (resolveGeneration !== resolveGenerationRef.current) return
              resolvingRef.current = true
              results.forEach((result) => updateReferenceNode(activeEditor, result.reference.occurrenceId, result.reference))
              resolvingRef.current = false
              const resolved = editorSnapshot(activeEditor)
              setSnapshot(resolved)
              onSnapshotChange?.(resolved)
            })
            .catch(() => undefined)
        }, 180)
      }
    }
  })

  useEffect(() => { editor?.setEditable(!disabled) }, [disabled, editor])
  useEffect(() => {
    if (!editor || value === lastDisplayRef.current) return
    editor.commands.setContent(value ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } : '', { emitUpdate: true })
  }, [editor, value])
  useEffect(() => {
    if (autoFocus && editor) window.requestAnimationFrame(() => editor.commands.focus('end'))
  }, [autoFocus, editor])
  useEffect(() => () => { if (resolveTimer.current) clearTimeout(resolveTimer.current) }, [])
  const pickerOpen = Boolean(picker)
  useEffect(() => {
    if (!pickerOpen || !window.creatorOS) return
    let active = true
    void window.creatorOS.listStructuredReferenceCatalog(projectId, sessionScope, picker?.query ?? '')
      .then((items) => { if (active) setCatalog(items) })
      .catch(() => { if (active) setCatalog([]) })
    return () => { active = false }
  }, [picker?.query, pickerOpen, projectId, sessionScope])

  const applyReference = useCallback((item: StructuredReferenceCatalogItem, scope?: StructuredReferenceUse['scope']): void => {
    if (!editor || !picker) return
    const availableScopes = allowedStructuredReferenceScopes(item.sourceKind, {}, { hasCurrentTarget })
    const reference = createStructuredReferenceUse(item, scope, availableScopes)
    editor.chain().focus().insertContentAt({ from: picker.from, to: picker.to }, [
      { type: 'structuredReference', attrs: { reference } },
      { type: 'text', text: ' ' }
    ]).run()
    setPicker(null)
  }, [editor, hasCurrentTarget, picker])

  const applyFallback = (): void => {
    if (!editor) return
    snapshot.references.forEach((reference) => {
      if (reference.role === 'pending') updateReferenceNode(editor, reference.occurrenceId, withRuntimeFallback(reference))
    })
  }

  const openReference = (occurrenceId: string): void => {
    if (!editor || !editorHostRef.current) return
    const anchor = editorHostRef.current.querySelector<HTMLElement>(`[data-reference-occurrence-id="${CSS.escape(occurrenceId)}"]`)
    const reference = editorSnapshot(editor).references.find((item) => item.occurrenceId === occurrenceId)
    if (anchor && reference) setActiveReference({ anchor, reference })
  }

  return <div
    ref={editorHostRef}
    className={`structured-reference-editor${compact ? ' is-compact' : ''}${disabled ? ' is-disabled' : ''}`}
    onClick={(event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-reference-occurrence-id]')
      if (chip?.dataset.referenceOccurrenceId) openReference(chip.dataset.referenceOccurrenceId)
    }}
    onScroll={() => setPicker(null)}
  >
    <EditorContent editor={editor} />
    <ReferencePreflightNotice references={snapshot.references} onUseOrdinaryFallback={applyFallback} onLocate={openReference} />
    {picker ? <ReferencePickerPopover
      anchor={editor?.view.dom ?? null}
      anchorPoint={picker.point}
      items={catalog}
      references={snapshot.references}
      hasCurrentTarget={hasCurrentTarget}
      query={picker.query}
      onQueryChange={(query) => setPicker({ ...picker, query })}
      onSelect={applyReference}
      onDismiss={() => { setPicker(null); editor?.commands.focus() }}
    /> : null}
    {activeReference ? <ReferenceRolePopover
      anchor={activeReference.anchor}
      reference={activeReference.reference}
      scopes={allowedStructuredReferenceScopes(activeReference.reference.sourceKind, activeReference.reference.sourceLocator, { hasCurrentTarget })
        .filter((scope) => scope === activeReference.reference.scope || !snapshot.references.some((reference) => (
          reference.occurrenceId !== activeReference.reference.occurrenceId
          && reference.sourceKey === activeReference.reference.sourceKey
          && reference.scope === scope
        )))}
      onDismiss={() => setActiveReference(null)}
      onApply={async ({ role, scope, aspect, remember, conflictResolution }) => {
        if (!editor) return
        if (resolveTimer.current) clearTimeout(resolveTimer.current)
        resolveGenerationRef.current += 1
        let next = withManualReferenceRole(activeReference.reference, role, scope, aspect, conflictResolution, remember)
        if (remember && window.creatorOS) {
          await window.creatorOS.setProjectReferenceRolePreference({ projectId, sourceKind: next.sourceKind, sourceId: next.sourceId, role, aspect, scope })
          next = { ...next, roleOrigin: 'project_memory' }
        } else if ((activeReference.reference.projectMemory || activeReference.reference.roleOrigin === 'project_memory') && window.creatorOS) {
          await window.creatorOS.removeProjectReferenceRolePreference({
            projectId,
            sourceKind: next.sourceKind,
            sourceId: next.sourceId,
            scope: activeReference.reference.projectMemory?.scope ?? activeReference.reference.scope
          })
        }
        updateReferenceNode(editor, next.occurrenceId, next)
        setActiveReference(null)
        editor.commands.focus()
      }}
    /> : null}
  </div>
}

export function StructuredReferenceComposer({ projectId, sessionScope, value, onValueChange, placeholder, ariaLabel, disabled = false, submitDisabled = false, busy = false, allowEmpty = false, compact = false, autoFocus = false, hasCurrentTarget = false, submitLabel = '发送', controls, className = '', onSubmit }: {
  projectId: string
  sessionScope: string
  value: string
  onValueChange(value: string): void
  placeholder: string
  ariaLabel: string
  disabled?: boolean
  submitDisabled?: boolean
  busy?: boolean
  allowEmpty?: boolean
  compact?: boolean
  autoFocus?: boolean
  hasCurrentTarget?: boolean
  submitLabel?: string
  controls?: ReactNode
  className?: string
  onSubmit(snapshot: StructuredComposerSnapshot): Promise<void> | void
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<StructuredComposerSnapshot>({ displayText: value, editorDocument: { type: 'doc', content: [{ type: 'paragraph' }] }, references: [] })
  const blocked = composerBlockingReferences(snapshot.references).length > 0 || composerPendingReferences(snapshot.references).length > 0
  const canSubmit = !disabled && !submitDisabled && !busy && !blocked && (allowEmpty || Boolean(snapshot.displayText.trim()) || snapshot.references.length > 0)
  return <div className={`structured-reference-composer${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
    {controls ? <div className="structured-reference-controls">{controls}</div> : null}
    <StructuredReferenceEditor
      projectId={projectId}
      sessionScope={sessionScope}
      value={value}
      onValueChange={onValueChange}
      onSnapshotChange={setSnapshot}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled || busy}
      compact={compact}
      autoFocus={autoFocus}
      hasCurrentTarget={hasCurrentTarget}
    />
    <button className="primary-action structured-reference-submit" disabled={!canSubmit} onClick={() => void onSubmit(snapshot)}><Send size={13} />{busy ? '正在启动' : submitLabel}</button>
  </div>
}
