import { createNodeFromContent, Extension, type Content, type Editor } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, Plugin, type Transaction } from '@tiptap/pm/state'

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'listItem', 'blockquote', 'codeBlock'])
const ANNOTATION_MARK_TYPES = new Set(['highlight', 'underline', 'strike', 'scriptMarker', 'scriptMaterialRelation'])
const STABLE_ID = /^[A-Za-z0-9:_-]{1,128}$/
const operationLocks = new WeakMap<Editor, boolean>()

export function setCurrentScriptEditorOperationLocked(editor: Editor, locked: boolean): void {
  operationLocks.set(editor, locked)
}

function createBlockId(): string {
  return `script-block-${crypto.randomUUID()}`
}

export const CurrentScriptEditorIdentity = Extension.create({
  name: 'currentScriptEditorIdentity',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      filterTransaction: (transaction) => (
        !transaction.docChanged
        || !operationLocks.get(editor)
        || Boolean(transaction.getMeta('currentScriptIdentity'))
      ),
      appendTransaction: (transactions, oldState, newState) => {
        if (!transactions.some((transaction) => transaction.docChanged && !transaction.getMeta('currentScriptIdentity'))) return null
        const earlierSnapshots = recentBlockSnapshotsByEditor.get(editor) ?? []
        rememberBlockSnapshot(editor, collectBlocks(oldState.doc))
        const identityTransaction = reconcileCurrentScriptBlockIdentity(oldState.doc, newState.doc, newState.tr, earlierSnapshots)
        rememberBlockSnapshot(editor, collectBlocks(identityTransaction?.doc ?? newState.doc))
        return identityTransaction
      }
    })]
  },
  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-current-script-block-id'),
            renderHTML: (attributes) => attributes.blockId
              ? { 'data-current-script-block-id': String(attributes.blockId) }
              : {}
          },
          parentBlockIds: {
            default: [],
            parseHTML: (element) => (element.getAttribute('data-current-script-parent-block-ids') ?? '').split(',').filter(Boolean),
            renderHTML: (attributes) => Array.isArray(attributes.parentBlockIds) && attributes.parentBlockIds.length
              ? { 'data-current-script-parent-block-ids': attributes.parentBlockIds.join(',') }
              : {}
          }
        }
      },
      {
        types: ['highlight', 'underline', 'strike'],
        attributes: {
          annotationId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-script-annotation-id'),
            renderHTML: (attributes) => attributes.annotationId
              ? { 'data-script-annotation-id': String(attributes.annotationId) }
              : {}
          },
          annotationNote: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-script-annotation-note'),
            renderHTML: (attributes) => attributes.annotationNote
              ? { 'data-script-annotation-note': String(attributes.annotationNote) }
              : {}
          },
          annotationBlockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-script-annotation-block-id'),
            renderHTML: (attributes) => attributes.annotationBlockId
              ? { 'data-script-annotation-block-id': String(attributes.annotationBlockId) }
              : {}
          },
          evidenceIdsJson: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-content-fact-evidence-ids'),
            renderHTML: (attributes) => attributes.evidenceIdsJson
              ? { 'data-content-fact-evidence-ids': String(attributes.evidenceIdsJson) }
              : {}
          }
        }
      }
    ]
  }
})

interface BlockPiece {
  type: string
  parentGroup: number
  position: number
  end: number
  id: string
  text: string
  parentBlockIds: string[]
}

interface MarkPiece {
  type: 'highlight' | 'underline' | 'strike' | 'scriptMarker' | 'scriptMaterialRelation'
  from: number
  to: number
  attrs: Record<string, unknown>
  rewrite: boolean
  logicalFrom: number | null
  logicalTo: number | null
}

const previousBlocksByEditor = new WeakMap<Editor, BlockPiece[]>()
const recentBlockSnapshotsByEditor = new WeakMap<Editor, BlockPiece[][]>()

function rememberBlockSnapshot(editor: Editor, blocks: BlockPiece[]): void {
  const history = recentBlockSnapshotsByEditor.get(editor) ?? []
  const signature = blocks.map((block) => `${block.id}\u0000${block.type}\u0000${block.parentGroup}\u0000${block.text}`).join('\u0001')
  const previous = history.at(-1)
  const previousSignature = previous?.map((block) => `${block.id}\u0000${block.type}\u0000${block.parentGroup}\u0000${block.text}`).join('\u0001')
  if (signature === previousSignature) return
  recentBlockSnapshotsByEditor.set(editor, [...history.slice(-3), blocks])
}

export function resetCurrentScriptEditorIdentityBaseline(editor: Editor): void {
  previousBlocksByEditor.delete(editor)
  recentBlockSnapshotsByEditor.delete(editor)
}

export function setAuthoritativeCurrentScriptEditorContent(editor: Editor, content: Content): void {
  const parsed = createNodeFromContent(content, editor.schema, { slice: false, errorOnInvalidContent: true })
  const doc = parsed instanceof Fragment ? editor.schema.topNodeType.create(null, parsed) : parsed
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins }))
  resetCurrentScriptEditorIdentityBaseline(editor)
  ensureCurrentScriptEditorIdentity(editor)
  editor.emit('update', { editor, transaction: editor.state.tr.setMeta('currentScriptAuthoritativeContent', true), appendedTransactions: [] })
}

function stableParents(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && STABLE_ID.test(id))
    : []
}

function collectBlocks(doc: ProseMirrorNode): BlockPiece[] {
  const blocks: BlockPiece[] = []
  const parentGroups = new Map<ProseMirrorNode, number>()
  let nextParentGroup = 0
  doc.descendants((node, position, parent) => {
    if (!BLOCK_TYPES.has(node.type.name)) return
    if (!parent) return
    let parentGroup = parentGroups.get(parent)
    if (parentGroup === undefined) {
      parentGroup = nextParentGroup++
      parentGroups.set(parent, parentGroup)
    }
    blocks.push({
      type: node.type.name,
      parentGroup,
      position,
      end: position + node.nodeSize,
      id: typeof node.attrs.blockId === 'string' ? node.attrs.blockId : '',
      text: node.textContent,
      parentBlockIds: stableParents(node.attrs.parentBlockIds)
    })
  })
  return blocks
}

function mergedParentsForBlock(block: BlockPiece, previousBlocks: BlockPiece[], currentIds: Set<string>): BlockPiece[] {
  const original = previousBlocks.find((item) => item.id === block.id)
  if (!original) return []
  const peers = previousBlocks.filter((item) => item.parentGroup === original.parentGroup)
  const originalIndex = peers.findIndex((item) => item.id === block.id)
  if (originalIndex < 0) return []
  let previousSurvivor = originalIndex - 1
  while (previousSurvivor >= 0 && !currentIds.has(peers[previousSurvivor]!.id)) previousSurvivor -= 1
  let nextSurvivor = originalIndex + 1
  while (nextSurvivor < peers.length && !currentIds.has(peers[nextSurvivor]!.id)) nextSurvivor += 1
  const removedBefore = peers.slice(previousSurvivor + 1, originalIndex).filter((item) => !currentIds.has(item.id))
  const removedAfter = peers.slice(originalIndex + 1, nextSurvivor).filter((item) => !currentIds.has(item.id))
  const removedBeforeText = removedBefore.map((item) => item.text).join('')
  const removedAfterText = removedAfter.map((item) => item.text).join('')
  const originalLineage = new Set(original.parentBlockIds)
  const sharesSplitLineage = (item: BlockPiece): boolean => item.parentBlockIds.some((id) => originalLineage.has(id))
  // A missing neighbour is not necessarily a merge: it may have been deleted on its own.
  // Create merge lineage only when the survivor absorbed its text, or when two
  // blocks created by the same split are structurally joined after one side was
  // emptied. The latter keeps split -> empty -> join traceable without treating
  // deletion of an unrelated empty paragraph as a merge.
  const absorbedBefore = (Boolean(removedBeforeText) && block.text === `${removedBeforeText}${original.text}`)
    || (!removedBeforeText && removedBefore.length > 0 && removedBefore.every(sharesSplitLineage))
  const absorbedAfter = (Boolean(removedAfterText) && block.text === `${original.text}${removedAfterText}`)
    || (!removedAfterText && removedAfter.length > 0 && removedAfter.every(sharesSplitLineage))
  const merged = [
    ...(absorbedBefore ? removedBefore : []),
    ...(absorbedAfter ? removedAfter : [])
  ]
  return merged.length ? [original, ...merged] : []
}

function reconcileCurrentScriptBlockIdentity(
  previousDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode,
  transaction: Transaction,
  earlierSnapshots: BlockPiece[][] = []
): Transaction | null {
  const previousBlocks = collectBlocks(previousDoc)
  const currentBlocks = collectBlocks(currentDoc)
  const duplicateGroups = new Map<string, BlockPiece[]>()
  currentBlocks.forEach((block) => {
    if (!STABLE_ID.test(block.id)) return
    duplicateGroups.set(block.id, [...(duplicateGroups.get(block.id) ?? []), block])
  })
  const duplicateIds = new Set([...duplicateGroups.entries()].filter(([, blocks]) => blocks.length > 1).map(([id]) => id))
  const currentIds = new Set(currentBlocks.map((block) => block.id).filter((id) => STABLE_ID.test(id)))
  const previousIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]))
  currentBlocks.forEach((block) => {
    let lineage = block.parentBlockIds
    let needsNewId = !STABLE_ID.test(block.id) || duplicateIds.has(block.id)
    if (duplicateIds.has(block.id)) lineage = [...lineage, block.id]
    if (!needsNewId && previousIndexById.has(block.id)) {
      const immediateJoined = mergedParentsForBlock(block, previousBlocks, currentIds)
      // Joining paragraphs is often emitted as two document changes: first the
      // removed paragraph becomes empty, then it disappears. Keep a short,
      // editor-local snapshot window so the second transaction can still prove
      // that text was absorbed. A plain deletion never satisfies the exact-text
      // check in mergedParentsForBlock and therefore keeps the survivor ID.
      const joined = immediateJoined.length
        ? immediateJoined
        : [...earlierSnapshots]
          .reverse()
          .map((snapshot) => mergedParentsForBlock(block, snapshot, currentIds))
          .find((parents) => parents.length) ?? []
      if (joined.length) {
        needsNewId = true
        lineage = [...lineage, ...joined.flatMap((item) => [item.id, ...item.parentBlockIds])]
      }
    }
    if (!needsNewId) return
    transaction.setNodeMarkup(block.position, undefined, {
      ...transaction.doc.nodeAt(block.position)?.attrs,
      blockId: createBlockId(),
      parentBlockIds: [...new Set(lineage.filter((id) => STABLE_ID.test(id)))].slice(0, 32)
    })
  })
  return transaction.docChanged
    ? transaction.setMeta('addToHistory', false).setMeta('currentScriptIdentity', true)
    : null
}

function identityAttribute(type: MarkPiece['type']): 'annotationId' | 'markerId' | 'relationId' {
  if (type === 'scriptMarker') return 'markerId'
  if (type === 'scriptMaterialRelation') return 'relationId'
  return 'annotationId'
}

function targetBlockAttribute(type: MarkPiece['type']): 'annotationBlockId' | 'markerBlockId' | 'relationBlockId' {
  if (type === 'scriptMarker') return 'markerBlockId'
  if (type === 'scriptMaterialRelation') return 'relationBlockId'
  return 'annotationBlockId'
}

function createMarkId(type: MarkPiece['type']): string {
  return type === 'scriptMaterialRelation'
    ? `script-relation-${crypto.randomUUID()}`
    : `script-annotation-${crypto.randomUUID()}`
}

function markFallbackKey(piece: MarkPiece): string {
  const identityKey = identityAttribute(piece.type)
  const attrs = Object.fromEntries(Object.entries(piece.attrs)
    .filter(([key]) => key !== identityKey)
    .sort(([left], [right]) => left.localeCompare(right)))
  return `${piece.type}:${JSON.stringify(attrs)}`
}

function contiguousRanges(pieces: MarkPiece[]): MarkPiece[] {
  const ranges: MarkPiece[] = []
  for (const piece of pieces.sort((left, right) => left.from - right.from || left.to - right.to)) {
    const previous = ranges.at(-1)
    const targetKey = targetBlockAttribute(piece.type)
    const sameLogicalTarget = typeof piece.attrs[targetKey] === 'string'
      && piece.attrs[targetKey] === previous?.attrs[targetKey]
      && previous?.logicalTo !== null
      && previous?.logicalTo === piece.logicalFrom
    if (previous && (previous.to === piece.from || sameLogicalTarget)) {
      previous.to = piece.to
      previous.logicalTo = piece.logicalTo
      previous.rewrite ||= piece.rewrite
    }
    else ranges.push({ ...piece, attrs: { ...piece.attrs } })
  }
  return ranges
}

function logicalOffsetAt(doc: ProseMirrorNode, block: BlockPiece, absolutePosition: number): number | null {
  const blockNode = doc.nodeAt(block.position)
  if (!blockNode) return null
  let offset = 0
  let found: number | null = null
  blockNode.descendants((node, relativePosition) => {
    const position = block.position + 1 + relativePosition
    if (position === absolutePosition) found = offset
    if (node.isText) offset += node.text?.length ?? 0
    else if (node.type.name === 'hardBreak') offset += 1
    return found === null
  })
  return found
}

export function ensureCurrentScriptEditorIdentity(editor: Editor, previousDocument?: ProseMirrorNode): boolean {
  const transaction = editor.state.tr
  const previousBlocks = previousDocument ? collectBlocks(previousDocument) : previousBlocksByEditor.get(editor) ?? []
  const currentBlocks = collectBlocks(editor.state.doc)
  const duplicateGroups = new Map<string, BlockPiece[]>()
  for (const block of currentBlocks) {
    if (!STABLE_ID.test(block.id)) continue
    duplicateGroups.set(block.id, [...(duplicateGroups.get(block.id) ?? []), block])
  }
  const duplicateIds = new Set([...duplicateGroups.entries()].filter(([, blocks]) => blocks.length > 1).map(([id]) => id))
  const currentIds = new Set(currentBlocks.map((block) => block.id).filter((id) => STABLE_ID.test(id)))
  const previousIndexById = new Map(previousBlocks.map((block, index) => [block.id, index]))

  for (const block of currentBlocks) {
    let lineage = block.parentBlockIds
    let needsNewId = !STABLE_ID.test(block.id) || duplicateIds.has(block.id)
    if (duplicateIds.has(block.id)) lineage = [...lineage, block.id]

    if (!needsNewId && previousIndexById.has(block.id)) {
      const immediateJoined = mergedParentsForBlock(block, previousBlocks, currentIds)
      const joined = immediateJoined.length
        ? immediateJoined
        : [...(recentBlockSnapshotsByEditor.get(editor) ?? [])]
          .reverse()
          .map((snapshot) => mergedParentsForBlock(block, snapshot, currentIds))
          .find((parents) => parents.length) ?? []
      if (joined.length) {
        needsNewId = true
        lineage = [...lineage, ...joined.flatMap((item) => [item.id, ...item.parentBlockIds])]
      }
    }

    if (!needsNewId) continue
    transaction.setNodeMarkup(block.position, undefined, {
      ...transaction.doc.nodeAt(block.position)?.attrs,
      blockId: createBlockId(),
      parentBlockIds: [...new Set(lineage.filter((id) => STABLE_ID.test(id)))].slice(0, 32)
    })
  }

  const markGroups = new Map<string, MarkPiece[]>()
  const finalBlocks = collectBlocks(transaction.doc)
  transaction.doc.descendants((node, position) => {
    if (!node.isText && node.type.name !== 'hardBreak') return
    for (const mark of node.marks) {
      if (!ANNOTATION_MARK_TYPES.has(mark.type.name)) continue
      if (mark.type.name === 'highlight' && (mark.attrs.targetSelectionId || mark.attrs.linkIndex)) continue
      if (
        (mark.type.name === 'highlight' || mark.type.name === 'underline' || mark.type.name === 'strike')
        && !(typeof mark.attrs.annotationId === 'string' && STABLE_ID.test(mark.attrs.annotationId))
      ) continue
      const type = mark.type.name as MarkPiece['type']
      const attrs = { ...mark.attrs }
      const targetKey = targetBlockAttribute(type)
      const declaredTarget = attrs[targetKey]
      let rewrite = false
      if (typeof declaredTarget === 'string' && !finalBlocks.some((block) => block.id === declaredTarget && position >= block.position && position < block.end)) {
        const containing = finalBlocks.filter((block) => position >= block.position && position < block.end)
        const owner = containing.filter((block) => block.parentBlockIds.includes(declaredTarget))
          .sort((left, right) => (left.end - left.position) - (right.end - right.position))[0]
          ?? containing.sort((left, right) => (left.end - left.position) - (right.end - right.position))[0]
        if (owner) {
          attrs[targetKey] = owner.id
          rewrite = true
        }
      }
      const targetBlock = typeof attrs[targetKey] === 'string'
        ? finalBlocks.find((block) => block.id === attrs[targetKey])
        : undefined
      const logicalFrom = targetBlock ? logicalOffsetAt(transaction.doc, targetBlock, position) : null
      const piece: MarkPiece = {
        type,
        from: position,
        to: position + node.nodeSize,
        attrs,
        rewrite,
        logicalFrom,
        logicalTo: logicalFrom === null ? null : logicalFrom + node.nodeSize
      }
      const identityKey = identityAttribute(piece.type)
      const targetBlockKey = targetBlockAttribute(piece.type)
      const declaredId = piece.attrs[identityKey]
      const key = typeof declaredId === 'string' && STABLE_ID.test(declaredId)
        ? `${piece.type}:id:${declaredId}:target:${String(piece.attrs[targetBlockKey] ?? '')}`
        : `${piece.type}:missing:${markFallbackKey(piece)}:target:${String(piece.attrs[targetBlockKey] ?? '')}`
      markGroups.set(key, [...(markGroups.get(key) ?? []), piece])
    }
  })

  const usedDeclaredIds = new Set<string>()
  for (const pieces of markGroups.values()) {
    const ranges = contiguousRanges(pieces)
    const identityKey = identityAttribute(ranges[0]!.type)
    const declaredId = ranges[0]!.attrs[identityKey]
    const hasStableId = typeof declaredId === 'string' && STABLE_ID.test(declaredId)
    const canKeepDeclaredId = hasStableId && !usedDeclaredIds.has(declaredId)
    if (canKeepDeclaredId) usedDeclaredIds.add(declaredId)
    ranges.forEach((range, index) => {
      if (canKeepDeclaredId && index === 0 && !range.rewrite) return
      const markType = editor.schema.marks[range.type]
      if (!markType) return
      transaction.removeMark(range.from, range.to, markType)
      transaction.addMark(range.from, range.to, markType.create({
        ...range.attrs,
        [identityKey]: canKeepDeclaredId && index === 0 ? declaredId : createMarkId(range.type)
      }))
    })
  }

  if (!transaction.docChanged) {
    previousBlocksByEditor.set(editor, currentBlocks)
    rememberBlockSnapshot(editor, currentBlocks)
    return false
  }
  const finalSnapshot = collectBlocks(transaction.doc)
  previousBlocksByEditor.set(editor, finalSnapshot)
  rememberBlockSnapshot(editor, finalSnapshot)
  editor.view.dispatch(transaction.setMeta('addToHistory', false).setMeta('currentScriptIdentity', true))
  return true
}
