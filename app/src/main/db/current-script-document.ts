import { createHash, randomUUID } from 'node:crypto'
import type { CurrentScriptBlock, CurrentScriptBlockKind } from '../../shared/domain'

const BLOCK_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/
const SAFE_COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\))$/i

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function stringAttribute(attrs: Record<string, unknown>, key: string): string | null {
  const value = attrs[key]
  return typeof value === 'string' && value ? value : null
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalize(nested)]))
}

export function serializeCurrentScriptEditorDocument(editorDocument: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(editorDocument))
}

export function hashCurrentScriptEditorDocument(editorDocument: Record<string, unknown>): string {
  return createHash('sha256').update(serializeCurrentScriptEditorDocument(editorDocument)).digest('hex')
}

export function createBlankCurrentScriptEditorDocument(): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: { blockId: `script-block-${randomUUID()}`, parentBlockIds: [] },
      content: []
    }]
  }
}

function wrapCurrentScriptMark(html: string, mark: Record<string, unknown>): string {
  const type = typeof mark.type === 'string' ? mark.type : ''
  const attrs = mark.attrs && typeof mark.attrs === 'object' && !Array.isArray(mark.attrs)
    ? mark.attrs as Record<string, unknown>
    : {}
  if (type === 'bold') return `<strong>${html}</strong>`
  if (type === 'italic') return `<em>${html}</em>`
  const annotationAttributes = [
    stringAttribute(attrs, 'annotationId') ? `data-script-annotation-id="${escapeHtml(stringAttribute(attrs, 'annotationId')!)}"` : '',
    stringAttribute(attrs, 'annotationNote') ? `data-script-annotation-note="${escapeHtml(stringAttribute(attrs, 'annotationNote')!)}"` : '',
    stringAttribute(attrs, 'annotationBlockId') ? `data-script-annotation-block-id="${escapeHtml(stringAttribute(attrs, 'annotationBlockId')!)}"` : ''
  ].filter(Boolean).join(' ')
  if (type === 'strike') return `<s${annotationAttributes ? ` ${annotationAttributes}` : ''}>${html}</s>`
  if (type === 'underline') return `<u${annotationAttributes ? ` ${annotationAttributes}` : ''}>${html}</u>`
  if (type === 'code') return `<code>${html}</code>`
  if (type === 'highlight') {
    const color = stringAttribute(attrs, 'color')
    const safeColor = color && SAFE_COLOR_PATTERN.test(color) ? color : null
    const attributes = [
      safeColor ? `data-color="${escapeHtml(safeColor)}" style="background-color: ${escapeHtml(safeColor)}; color: inherit"` : '',
      stringAttribute(attrs, 'linkIndex') ? `data-link-index="${escapeHtml(stringAttribute(attrs, 'linkIndex')!)}"` : '',
      stringAttribute(attrs, 'targetSelectionId') ? `data-target-selection-id="${escapeHtml(stringAttribute(attrs, 'targetSelectionId')!)}"` : '',
      annotationAttributes
    ].filter(Boolean).join(' ')
    return `<mark${attributes ? ` ${attributes}` : ''}>${html}</mark>`
  }
  if (type === 'scriptMarker') {
    const markerId = stringAttribute(attrs, 'markerId')
    if (!markerId) throw new Error('当前文案脚本标记缺少稳定ID')
    const attributes = [
      `data-script-marker-id="${escapeHtml(markerId)}"`,
      stringAttribute(attrs, 'markerNote') ? `data-script-marker-note="${escapeHtml(stringAttribute(attrs, 'markerNote')!)}"` : '',
      stringAttribute(attrs, 'markerBlockId') ? `data-script-marker-block-id="${escapeHtml(stringAttribute(attrs, 'markerBlockId')!)}"` : ''
    ].filter(Boolean).join(' ')
    return `<span ${attributes}>${html}</span>`
  }
  if (type === 'scriptMaterialRelation') {
    const relationId = stringAttribute(attrs, 'relationId')
    if (!relationId) throw new Error('当前文案素材关系缺少稳定ID')
    const attributes = [
      `data-script-material-relation-id="${escapeHtml(relationId)}"`,
      stringAttribute(attrs, 'draftId') ? `data-script-material-draft-id="${escapeHtml(stringAttribute(attrs, 'draftId')!)}"` : '',
      stringAttribute(attrs, 'draftParagraphIds') ? `data-script-material-draft-paragraph-ids="${escapeHtml(stringAttribute(attrs, 'draftParagraphIds')!)}"` : '',
      stringAttribute(attrs, 'sourcePointIds') ? `data-script-material-source-point-ids="${escapeHtml(stringAttribute(attrs, 'sourcePointIds')!)}"` : '',
      stringAttribute(attrs, 'sourcePointVersion') ? `data-script-material-source-point-version="${escapeHtml(stringAttribute(attrs, 'sourcePointVersion')!)}"` : '',
      stringAttribute(attrs, 'relationBlockId') ? `data-script-material-relation-block-id="${escapeHtml(stringAttribute(attrs, 'relationBlockId')!)}"` : '',
      stringAttribute(attrs, 'sourceRelationsJson') ? `data-script-source-relations="${escapeHtml(stringAttribute(attrs, 'sourceRelationsJson')!)}"` : ''
    ].filter(Boolean).join(' ')
    return `<span ${attributes}>${html}</span>`
  }
  throw new Error(`当前文案包含尚未支持的格式：${type || '未知格式'}`)
}

function renderCurrentScriptMarks(html: string, node: Record<string, unknown>): string {
  const marks = node.marks === undefined ? [] : node.marks
  if (!Array.isArray(marks)) throw new Error('当前文案文字格式无效')
  return marks.reduceRight((result, mark) => {
    if (!mark || typeof mark !== 'object' || Array.isArray(mark)) throw new Error('当前文案文字格式无效')
    return wrapCurrentScriptMark(result, mark as Record<string, unknown>)
  }, html)
}

function renderCurrentScriptNode(node: Record<string, unknown>): string {
  const type = typeof node.type === 'string' ? node.type : ''
  if (type === 'text') {
    if (typeof node.text !== 'string') throw new Error('当前文案文字节点无效')
    return renderCurrentScriptMarks(escapeHtml(node.text), node)
  }
  if (type === 'hardBreak') return renderCurrentScriptMarks('<br>', node)
  if (type === 'horizontalRule') throw new Error('当前文案暂不支持分隔线，请先删除后再保存')
  const children = node.content === undefined ? [] : node.content
  if (!Array.isArray(children)) throw new Error('当前文案编辑器节点格式无效')
  const content = children.map((child) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) throw new Error('当前文案编辑器节点格式无效')
    return renderCurrentScriptNode(child as Record<string, unknown>)
  }).join('')
  const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
    ? node.attrs as Record<string, unknown>
    : {}
  const blockId = stringAttribute(attrs, 'blockId')
  const lineage = Array.isArray(attrs.parentBlockIds)
    ? attrs.parentBlockIds.filter((id): id is string => typeof id === 'string').join(',')
    : ''
  const blockAttrs = blockId
    ? ` data-current-script-block-id="${escapeHtml(blockId)}"${lineage ? ` data-current-script-parent-block-ids="${escapeHtml(lineage)}"` : ''}`
    : ''
  if (type === 'doc') return content
  if (type === 'paragraph') return `<p${blockAttrs}>${content}</p>`
  if (type === 'heading') {
    if (typeof attrs.level !== 'number' || attrs.level < 1 || attrs.level > 3) throw new Error('当前文案标题只支持H1至H3')
    const level = attrs.level
    return `<h${level}${blockAttrs}>${content}</h${level}>`
  }
  if (type === 'bulletList') return `<ul>${content}</ul>`
  if (type === 'orderedList') {
    const start = typeof attrs.start === 'number' && Number.isSafeInteger(attrs.start) && attrs.start > 1 ? ` start="${attrs.start}"` : ''
    return `<ol${start}>${content}</ol>`
  }
  if (type === 'listItem') return `<li${blockAttrs}>${content}</li>`
  if (type === 'blockquote') return `<blockquote${blockAttrs}>${content}</blockquote>`
  if (type === 'codeBlock') return `<pre${blockAttrs}><code>${content}</code></pre>`
  throw new Error(`当前文案包含尚未支持的结构：${type || '未知结构'}`)
}

export function renderCurrentScriptEditorDocumentHtml(editorDocument: Record<string, unknown>): string {
  extractCurrentScriptBlocks(editorDocument)
  return renderCurrentScriptNode(editorDocument) || '<p></p>'
}

export interface CurrentScriptMarkProjection {
  type: 'highlight' | 'underline' | 'strike' | 'scriptMarker' | 'scriptMaterialRelation'
  blockId: string
  start: number
  end: number
  selectedText: string
  attrs: Record<string, unknown>
}

export function extractCurrentScriptMarkProjections(editorDocument: Record<string, unknown>): CurrentScriptMarkProjection[] {
  extractCurrentScriptBlocks(editorDocument)
  const projections: CurrentScriptMarkProjection[] = []
  const visitBlock = (node: Record<string, unknown>): void => {
    const nodeType = typeof node.type === 'string' ? node.type : ''
    const kind = blockKindForNodeType(nodeType)
    if (kind) {
      const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
        ? node.attrs as Record<string, unknown>
        : {}
      const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : ''
      let offset = 0
      const appendMarkProjections = (selectedText: string, start: number, end: number, marksValue: unknown, nestedBlock: boolean): void => {
        const marks = Array.isArray(marksValue) ? marksValue : []
        for (const value of marks) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue
          const mark = value as Record<string, unknown>
          const type = typeof mark.type === 'string' ? mark.type : ''
          if (!['highlight', 'underline', 'strike', 'scriptMarker', 'scriptMaterialRelation'].includes(type)) continue
          const markAttrs = mark.attrs && typeof mark.attrs === 'object' && !Array.isArray(mark.attrs)
            ? mark.attrs as Record<string, unknown>
            : {}
          if (type === 'highlight' && (stringAttribute(markAttrs, 'targetSelectionId') || stringAttribute(markAttrs, 'linkIndex'))) continue
          const targetBlockId = type === 'scriptMarker'
            ? stringAttribute(markAttrs, 'markerBlockId')
            : type === 'scriptMaterialRelation'
              ? stringAttribute(markAttrs, 'relationBlockId')
              : stringAttribute(markAttrs, 'annotationBlockId')
          if (targetBlockId ? targetBlockId !== blockId : nestedBlock) continue
          projections.push({ type: type as CurrentScriptMarkProjection['type'], blockId, start, end, selectedText, attrs: markAttrs })
        }
      }
      const visitInline = (child: Record<string, unknown>, nestedBlock = false): void => {
        const childType = typeof child.type === 'string' ? child.type : ''
        if (blockKindForNodeType(childType)) {
          if (Array.isArray(child.content)) {
            for (const nested of child.content) if (nested && typeof nested === 'object' && !Array.isArray(nested)) visitInline(nested as Record<string, unknown>, true)
          }
          return
        }
        if (childType === 'text') {
          const text = typeof child.text === 'string' ? child.text : ''
          const start = offset
          offset += text.length
          appendMarkProjections(text, start, offset, child.marks, nestedBlock)
          return
        }
        if (childType === 'hardBreak') {
          const start = offset
          offset += 1
          appendMarkProjections('\n', start, offset, child.marks, nestedBlock)
          return
        }
        if (!Array.isArray(child.content)) return
        for (const nested of child.content) if (nested && typeof nested === 'object' && !Array.isArray(nested)) visitInline(nested as Record<string, unknown>, nestedBlock)
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) if (child && typeof child === 'object' && !Array.isArray(child)) visitInline(child as Record<string, unknown>)
      }
    }
    if (!Array.isArray(node.content)) return
    for (const child of node.content) if (child && typeof child === 'object' && !Array.isArray(child)) visitBlock(child as Record<string, unknown>)
  }
  visitBlock(editorDocument)
  const grouped = new Map<string, CurrentScriptMarkProjection[]>()
  for (const projection of projections.filter((item) => item.end > item.start)) {
    const key = `${projection.blockId}\u0000${projection.type}\u0000${serializeCurrentScriptEditorDocument(projection.attrs)}`
    const items = grouped.get(key) ?? []
    items.push(projection)
    grouped.set(key, items)
  }
  return [...grouped.values()].flatMap((items) => {
    const ordered = items.sort((left, right) => left.start - right.start || left.end - right.end)
    const merged: CurrentScriptMarkProjection[] = []
    for (const item of ordered) {
      const previous = merged.at(-1)
      if (previous && previous.end === item.start) {
        previous.end = item.end
        previous.selectedText += item.selectedText
      } else merged.push({ ...item, attrs: { ...item.attrs } })
    }
    return merged
  }).sort((left, right) => left.blockId.localeCompare(right.blockId) || left.start - right.start || left.type.localeCompare(right.type))
}

function blockKindForNodeType(nodeType: string): CurrentScriptBlockKind | null {
  if (nodeType === 'heading') return 'heading'
  if (nodeType === 'paragraph') return 'paragraph'
  if (nodeType === 'listItem') return 'list_item'
  if (nodeType === 'blockquote') return 'quote'
  if (nodeType === 'codeBlock') return 'code'
  return null
}

function textContent(node: Record<string, unknown>): string {
  if (node.type === 'hardBreak') return '\n'
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map((child) => child && typeof child === 'object' ? textContent(child as Record<string, unknown>) : '').join('')
}

export function extractCurrentScriptBlocks(editorDocument: Record<string, unknown>): CurrentScriptBlock[] {
  if (editorDocument.type !== 'doc' || !Array.isArray(editorDocument.content)) throw new Error('当前文案编辑器文档格式无效')
  const blocks: CurrentScriptBlock[] = []
  const usedIds = new Set<string>()
  const visit = (node: Record<string, unknown>, depth: number): void => {
    if (depth > 32) throw new Error('当前文案编辑器节点嵌套不能超过32层')
    const nodeType = typeof node.type === 'string' ? node.type : ''
    const kind = blockKindForNodeType(nodeType)
    if (kind) {
      const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
        ? node.attrs as Record<string, unknown>
        : {}
      const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : ''
      if (!BLOCK_ID_PATTERN.test(blockId)) throw new Error('当前文案存在缺失或无效的block ID')
      if (usedIds.has(blockId)) throw new Error('当前文案block ID不能重复')
      const parentBlockIds = Array.isArray(attrs.parentBlockIds) ? attrs.parentBlockIds : []
      if (parentBlockIds.length > 32 || parentBlockIds.some((id) => typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id))) {
        throw new Error('当前文案block血缘无效')
      }
      usedIds.add(blockId)
      blocks.push({ blockId, kind, parentBlockIds: [...new Set(parentBlockIds)], text: textContent(node) })
      if (blocks.length > 10_000) throw new Error('当前文案文本块不能超过10000个')
    }
    if (!Array.isArray(node.content)) return
    for (const child of node.content) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) throw new Error('当前文案编辑器节点格式无效')
      visit(child as Record<string, unknown>, depth + 1)
    }
  }
  for (const child of editorDocument.content) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) throw new Error('当前文案编辑器节点格式无效')
    visit(child as Record<string, unknown>, 1)
  }
  if (!blocks.length) throw new Error('当前文案至少需要一个文本块')
  return blocks
}

export function currentScriptDocumentText(editorDocument: Record<string, unknown>): string {
  return extractCurrentScriptBlocks(editorDocument)
    .filter((block) => block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'code')
    .map((block) => block.text)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
}
