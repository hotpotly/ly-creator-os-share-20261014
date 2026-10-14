import type {
  CurrentScriptSourceRelationInput,
  ProjectCurrentScriptSnapshot,
  ScriptTextAnnotationInput
} from '../../../../../shared/domain'

const STABLE_ID = /^[A-Za-z0-9:_-]{1,128}$/
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'listItem', 'blockquote', 'codeBlock'])
const ANNOTATION_MARKS = new Set(['highlight', 'underline', 'strike', 'scriptMarker'])

function attrsOf(value: Record<string, unknown>): Record<string, unknown> {
  return value.attrs && typeof value.attrs === 'object' && !Array.isArray(value.attrs)
    ? value.attrs as Record<string, unknown>
    : {}
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalize(nested)]))
}

export function canonicalCurrentScriptValue(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function csvAttribute(attrs: Record<string, unknown>, key: string): string[] {
  return typeof attrs[key] === 'string'
    ? [...new Set(attrs[key].split(',').map((item) => item.trim()).filter(Boolean))]
    : []
}

interface MarkProjection {
  type: 'highlight' | 'underline' | 'strike' | 'scriptMarker' | 'scriptMaterialRelation'
  blockId: string
  start: number
  end: number
  selectedText: string
  attrs: Record<string, unknown>
}

interface FactMark {
  type: MarkProjection['type']
  start: number
  end: number
  attrs: Record<string, unknown>
}

function addFactMarksToBlock(node: Record<string, unknown>, facts: FactMark[]): Record<string, unknown> {
  let offset = 0
  const visitInline = (child: Record<string, unknown>): Record<string, unknown>[] => {
    const childType = typeof child.type === 'string' ? child.type : ''
    if (BLOCK_TYPES.has(childType)) {
      return [{
        ...child,
        ...(Array.isArray(child.content) ? {
          content: child.content.flatMap((nested) => (
            nested && typeof nested === 'object' && !Array.isArray(nested)
              ? visitInline(nested as Record<string, unknown>)
              : []
          ))
        } : {})
      }]
    }
    if (childType === 'text') {
      const value = typeof child.text === 'string' ? child.text : ''
      const start = offset
      offset += value.length
      const boundaries = new Set([start, offset])
      for (const fact of facts) {
        if (fact.end <= start || fact.start >= offset) continue
        boundaries.add(Math.max(start, fact.start))
        boundaries.add(Math.min(offset, fact.end))
      }
      const ordered = [...boundaries].sort((left, right) => left - right)
      return ordered.slice(0, -1).flatMap((segmentStart, index) => {
        const segmentEnd = ordered[index + 1]!
        if (segmentEnd <= segmentStart) return []
        const marks = Array.isArray(child.marks)
          ? child.marks.filter((mark): mark is Record<string, unknown> => Boolean(mark) && typeof mark === 'object' && !Array.isArray(mark)).map((mark) => ({ ...mark }))
          : []
        for (const fact of facts) {
          if (fact.start > segmentStart || fact.end < segmentEnd) continue
          const identityKey = fact.type === 'scriptMarker' ? 'markerId' : fact.type === 'scriptMaterialRelation' ? 'relationId' : 'annotationId'
          const existingIndex = marks.findIndex((mark) => mark.type === fact.type && attrsOf(mark)[identityKey] === fact.attrs[identityKey])
          if (existingIndex >= 0) marks[existingIndex] = { ...marks[existingIndex], attrs: { ...attrsOf(marks[existingIndex]!), ...fact.attrs } }
          else marks.push({ type: fact.type, attrs: { ...fact.attrs } })
        }
        return [{ ...child, text: value.slice(segmentStart - start, segmentEnd - start), ...(marks.length ? { marks } : {}) }]
      })
    }
    if (childType === 'hardBreak') {
      const start = offset
      offset += 1
      const marks = Array.isArray(child.marks)
        ? child.marks.filter((mark): mark is Record<string, unknown> => Boolean(mark) && typeof mark === 'object' && !Array.isArray(mark)).map((mark) => ({ ...mark }))
        : []
      for (const fact of facts) {
        if (fact.start > start || fact.end < offset) continue
        const identityKey = fact.type === 'scriptMarker' ? 'markerId' : fact.type === 'scriptMaterialRelation' ? 'relationId' : 'annotationId'
        const existingIndex = marks.findIndex((mark) => mark.type === fact.type && attrsOf(mark)[identityKey] === fact.attrs[identityKey])
        if (existingIndex >= 0) marks[existingIndex] = { ...marks[existingIndex], attrs: { ...attrsOf(marks[existingIndex]!), ...fact.attrs } }
        else marks.push({ type: fact.type, attrs: { ...fact.attrs } })
      }
      return [{ ...child, ...(marks.length ? { marks } : {}) }]
    }
    if (!Array.isArray(child.content)) return [{ ...child }]
    return [{ ...child, content: child.content.flatMap((nested) => (
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? visitInline(nested as Record<string, unknown>)
        : []
    )) }]
  }
  return {
    ...node,
    ...(Array.isArray(node.content) ? {
      content: node.content.flatMap((child) => (
        child && typeof child === 'object' && !Array.isArray(child)
          ? visitInline(child as Record<string, unknown>)
          : []
      ))
    } : {})
  }
}

function addFactMarksToDocumentNode(node: Record<string, unknown>, factsByBlock: Map<string, FactMark[]>): Record<string, unknown> {
  const nodeType = typeof node.type === 'string' ? node.type : ''
  const blockId = typeof attrsOf(node).blockId === 'string' ? String(attrsOf(node).blockId) : ''
  if (BLOCK_TYPES.has(nodeType) && factsByBlock.has(blockId)) {
    const marked = addFactMarksToBlock(node, factsByBlock.get(blockId) ?? [])
    return {
      ...marked,
      ...(Array.isArray(marked.content) ? {
        content: marked.content.map((child) => child && typeof child === 'object' && !Array.isArray(child)
          ? addFactMarksToDocumentNode(child as Record<string, unknown>, factsByBlock)
          : child)
      } : {})
    }
  }
  return {
    ...node,
    ...(Array.isArray(node.content) ? {
      content: node.content.map((child) => child && typeof child === 'object' && !Array.isArray(child)
        ? addFactMarksToDocumentNode(child as Record<string, unknown>, factsByBlock)
        : child)
    } : {})
  }
}

export function projectCurrentScriptFactsToEditorDocument(snapshot: ProjectCurrentScriptSnapshot): Record<string, unknown> {
  const factsByBlock = new Map<string, FactMark[]>()
  const add = (blockId: string, fact: FactMark): void => {
    factsByBlock.set(blockId, [...(factsByBlock.get(blockId) ?? []), fact])
  }
  for (const annotation of snapshot.annotations) {
    if (annotation.status !== 'active') continue
    const type: FactMark['type'] = annotation.style === 'flag' ? 'scriptMarker' : annotation.style
    add(annotation.blockId, {
      type,
      start: annotation.blockStart,
      end: annotation.blockEnd,
      attrs: annotation.style === 'flag'
        ? { markerId: annotation.id, markerNote: annotation.note, markerBlockId: annotation.blockId }
        : {
            annotationId: annotation.id,
            annotationNote: annotation.note,
            annotationBlockId: annotation.blockId,
            evidenceIdsJson: annotation.evidenceIds?.length ? JSON.stringify(annotation.evidenceIds) : null
          }
    })
  }
  const relationGroups = new Map<string, ProjectCurrentScriptSnapshot['sourceRelations']>()
  for (const relation of snapshot.sourceRelations) {
    const key = `${relation.targetBlockId}:${relation.targetStart}:${relation.targetEnd}`
    relationGroups.set(key, [...(relationGroups.get(key) ?? []), relation])
  }
  for (const relations of relationGroups.values()) {
    const ordered = [...relations].sort((left, right) => left.id.localeCompare(right.id))
    const primary = ordered[0]
    if (!primary) continue
    const draftRelations = ordered.filter((relation) => relation.sourceKind === 'material_draft_paragraph')
    add(primary.targetBlockId, {
      type: 'scriptMaterialRelation',
      start: primary.targetStart,
      end: primary.targetEnd,
      attrs: {
        relationId: primary.id,
        relationBlockId: primary.targetBlockId,
        sourceRelationsJson: JSON.stringify(ordered.map((relation) => ({
          id: relation.id,
          sourceKind: relation.sourceKind,
          sourceId: relation.sourceId,
          sourceVersion: relation.sourceVersion
        }))),
        draftId: draftRelations[0]?.sourceVersion ?? null,
        draftParagraphIds: draftRelations.map((relation) => relation.sourceId).join(','),
        sourcePointIds: ordered.filter((relation) => relation.sourceKind === 'material_point').map((relation) => relation.sourceId).join(',')
        ,sourcePointVersion: ordered.find((relation) => relation.sourceKind === 'material_point')?.sourceVersion ?? null
      }
    })
  }
  return addFactMarksToDocumentNode(snapshot.document.editorDocument, factsByBlock)
}

export function currentScriptMarkProjections(editorDocument: Record<string, unknown>): MarkProjection[] {
  const projections: MarkProjection[] = []
  const visitBlock = (node: Record<string, unknown>): void => {
    const nodeType = typeof node.type === 'string' ? node.type : ''
    if (BLOCK_TYPES.has(nodeType)) {
      const blockId = typeof attrsOf(node).blockId === 'string' ? String(attrsOf(node).blockId) : ''
      let offset = 0
      const append = (selectedText: string, start: number, end: number, marksValue: unknown, nestedBlock: boolean): void => {
        if (!Array.isArray(marksValue)) return
        for (const item of marksValue) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue
          const mark = item as Record<string, unknown>
          const type = typeof mark.type === 'string' ? mark.type : ''
          if (!ANNOTATION_MARKS.has(type) && type !== 'scriptMaterialRelation') continue
          const attrs = attrsOf(mark)
          if (type === 'highlight' && (attrs.targetSelectionId || attrs.linkIndex)) continue
          if (
            (type === 'highlight' || type === 'underline' || type === 'strike')
            && !validId(attrs.annotationId)
          ) continue
          const targetBlockId = type === 'scriptMarker'
            ? attrs.markerBlockId
            : type === 'scriptMaterialRelation'
              ? attrs.relationBlockId
              : attrs.annotationBlockId
          if (typeof targetBlockId === 'string' ? targetBlockId !== blockId : nestedBlock) continue
          projections.push({
            type: type as MarkProjection['type'], blockId, start, end, selectedText, attrs
          })
        }
      }
      const visitInline = (child: Record<string, unknown>, nestedBlock = false): void => {
        const childType = typeof child.type === 'string' ? child.type : ''
        if (BLOCK_TYPES.has(childType)) {
          if (Array.isArray(child.content)) {
            for (const nested of child.content) {
              if (nested && typeof nested === 'object' && !Array.isArray(nested)) visitInline(nested as Record<string, unknown>, true)
            }
          }
          return
        }
        if (childType === 'text') {
          const text = typeof child.text === 'string' ? child.text : ''
          const start = offset
          offset += text.length
          append(text, start, offset, child.marks, nestedBlock)
          return
        }
        if (childType === 'hardBreak') {
          const start = offset
          offset += 1
          append('\n', start, offset, child.marks, nestedBlock)
          return
        }
        if (!Array.isArray(child.content)) return
        for (const nested of child.content) {
          if (nested && typeof nested === 'object' && !Array.isArray(nested)) visitInline(nested as Record<string, unknown>, nestedBlock)
        }
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          if (child && typeof child === 'object' && !Array.isArray(child)) visitInline(child as Record<string, unknown>)
        }
      }
    }
    if (!Array.isArray(node.content)) return
    for (const child of node.content) {
      if (child && typeof child === 'object' && !Array.isArray(child)) visitBlock(child as Record<string, unknown>)
    }
  }
  visitBlock(editorDocument)

  const groups = new Map<string, MarkProjection[]>()
  for (const projection of projections.filter((item) => item.end > item.start)) {
    const key = `${projection.blockId}\u0000${projection.type}\u0000${canonicalCurrentScriptValue(projection.attrs)}`
    const group = groups.get(key) ?? []
    group.push(projection)
    groups.set(key, group)
  }
  return [...groups.values()].flatMap((items) => {
    const ordered = items.sort((left, right) => left.start - right.start || left.end - right.end)
    const merged: MarkProjection[] = []
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

function validId(value: unknown): value is string {
  return typeof value === 'string' && STABLE_ID.test(value)
}

function projectionKey(projection: MarkProjection): string {
  return `${projection.type}:${projection.blockId}:${projection.start}:${projection.end}:${projection.selectedText}`
}

export interface CurrentScriptFactBuildOptions {
  previous: ProjectCurrentScriptSnapshot | null
  materialRevisionId: string | null
  createId(): string
  generatedIds: Map<string, string>
}

export function buildCurrentScriptFacts(
  editorDocument: Record<string, unknown>,
  options: CurrentScriptFactBuildOptions
): { sourceRelations: CurrentScriptSourceRelationInput[]; annotations: ScriptTextAnnotationInput[] } {
  const projections = currentScriptMarkProjections(editorDocument)
  const previousProjections = options.previous
    ? currentScriptMarkProjections(projectCurrentScriptFactsToEditorDocument(options.previous))
    : []
  const usedAnnotationIds = new Set<string>()
  const annotations = projections.flatMap((projection): ScriptTextAnnotationInput[] => {
    if (projection.type === 'scriptMaterialRelation') return []
    const style: ScriptTextAnnotationInput['style'] = projection.type === 'scriptMarker' ? 'flag' : projection.type
    const declaredId = projection.type === 'scriptMarker' ? projection.attrs.markerId : projection.attrs.annotationId
    const exactPrevious = options.previous?.annotations.find((annotation) => (
      !usedAnnotationIds.has(annotation.id)
      && annotation.status === 'active'
      && annotation.style === style
      && annotation.blockId === projection.blockId
      && annotation.blockStart === projection.start
      && annotation.blockEnd === projection.end
      && annotation.selectedText === projection.selectedText
    ))
    const generatedKey = `annotation:${projectionKey(projection)}`
    let id = validId(declaredId) ? declaredId : exactPrevious?.id ?? options.generatedIds.get(generatedKey)
    if (!id || usedAnnotationIds.has(id)) {
      id = `script-annotation-${options.createId()}`
      options.generatedIds.set(generatedKey, id)
    }
    usedAnnotationIds.add(id)
    const declaredNote = projection.type === 'scriptMarker' ? projection.attrs.markerNote : projection.attrs.annotationNote
    const declaredEvidenceIds = projection.type === 'scriptMarker' || typeof projection.attrs.evidenceIdsJson !== 'string'
      ? []
      : (() => {
          try {
            const parsed = JSON.parse(projection.attrs.evidenceIdsJson) as unknown
            return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
          } catch { return [] }
        })()
    return [{
      id,
      blockId: projection.blockId,
      blockStart: projection.start,
      blockEnd: projection.end,
      selectedText: projection.selectedText,
      style,
      note: typeof declaredNote === 'string' ? declaredNote : exactPrevious?.note ?? '',
      evidenceIds: declaredEvidenceIds.length ? declaredEvidenceIds : exactPrevious?.evidenceIds ?? [],
      status: 'active'
    }]
  })
  const previouslyProjectedAnnotationIds = new Set((options.previous?.annotations ?? []).filter((annotation) => (
    previousProjections.some((projection) => {
      if (projection.type === 'scriptMaterialRelation') return false
      const style: ScriptTextAnnotationInput['style'] = projection.type === 'scriptMarker' ? 'flag' : projection.type
      const declaredId = projection.type === 'scriptMarker' ? projection.attrs.markerId : projection.attrs.annotationId
      return annotation.style === style
        && annotation.blockId === projection.blockId
        && annotation.blockStart === projection.start
        && annotation.blockEnd === projection.end
        && annotation.selectedText === projection.selectedText
        && (!validId(declaredId) || annotation.id === declaredId)
    })
  )).map((annotation) => annotation.id))
  for (const annotation of options.previous?.annotations ?? []) {
    if (!usedAnnotationIds.has(annotation.id) && (
      annotation.status !== 'active' || !previouslyProjectedAnnotationIds.has(annotation.id)
    )) {
      annotations.push({
        id: annotation.id,
        blockId: annotation.blockId,
        blockStart: annotation.blockStart,
        blockEnd: annotation.blockEnd,
        selectedText: annotation.selectedText,
        style: annotation.style,
        note: annotation.note,
        evidenceIds: annotation.evidenceIds ?? [],
        status: annotation.status
      })
    }
  }

  const sourceRelations: CurrentScriptSourceRelationInput[] = []
  const usedRelationIds = new Set<string>()
  for (const projection of projections.filter((item) => item.type === 'scriptMaterialRelation')) {
    const relationId = projection.attrs.relationId
    if (!validId(relationId)) continue
    const primaryPrevious = options.previous?.sourceRelations.find((relation) => relation.id === relationId)
    const previousCohort = primaryPrevious
      ? options.previous?.sourceRelations.filter((relation) => (
        relation.targetBlockId === primaryPrevious.targetBlockId
        && relation.targetStart === primaryPrevious.targetStart
        && relation.targetEnd === primaryPrevious.targetEnd
      )) ?? []
      : []
    const embeddedSources = (() => {
      if (typeof projection.attrs.sourceRelationsJson !== 'string') return []
      try {
        const parsed = JSON.parse(projection.attrs.sourceRelationsJson) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.flatMap((item): Array<Pick<CurrentScriptSourceRelationInput, 'id' | 'sourceKind' | 'sourceId' | 'sourceVersion'>> => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return []
          const relation = item as Record<string, unknown>
          if (!validId(relation.id) || typeof relation.sourceKind !== 'string' || typeof relation.sourceId !== 'string' || typeof relation.sourceVersion !== 'string') return []
          if (!['material_point', 'material_draft_paragraph', 'outline_point', 'brief_point', 'comparison_source', 'generation'].includes(relation.sourceKind)) return []
          return [{
            id: relation.id,
            sourceKind: relation.sourceKind as CurrentScriptSourceRelationInput['sourceKind'],
            sourceId: relation.sourceId,
            sourceVersion: relation.sourceVersion
          }]
        })
      } catch {
        return []
      }
    })()
    const expectedSources: Array<Pick<CurrentScriptSourceRelationInput, 'sourceKind' | 'sourceId' | 'sourceVersion'> & { id?: string }> = [
      ...embeddedSources,
      ...csvAttribute(projection.attrs, 'draftParagraphIds').map((sourceId) => ({
        sourceKind: 'material_draft_paragraph' as const,
        sourceId,
        sourceVersion: typeof projection.attrs.draftId === 'string' && projection.attrs.draftId
          ? projection.attrs.draftId
          : options.materialRevisionId ?? 'legacy'
      })),
      ...csvAttribute(projection.attrs, 'sourcePointIds').map((sourceId) => ({
        sourceKind: 'material_point' as const,
        sourceId,
        sourceVersion: typeof projection.attrs.sourcePointVersion === 'string' && projection.attrs.sourcePointVersion
          ? projection.attrs.sourcePointVersion
          : options.materialRevisionId ?? (typeof projection.attrs.draftId === 'string' && projection.attrs.draftId ? projection.attrs.draftId : 'legacy')
      }))
    ]
    const sources: Array<Pick<CurrentScriptSourceRelationInput, 'sourceKind' | 'sourceId' | 'sourceVersion'> & { id?: string }> = [...previousCohort.map((relation) => ({
      id: relation.id,
      sourceKind: relation.sourceKind,
      sourceId: relation.sourceId,
      sourceVersion: relation.sourceVersion
    }))]
    for (const expected of expectedSources) {
      if (!sources.some((source) => source.sourceKind === expected.sourceKind && source.sourceId === expected.sourceId)) sources.push(expected)
    }
    const declaredPrimaryIndex = sources.findIndex((source) => source.id === relationId)
    if (declaredPrimaryIndex > 0) {
      const [declaredPrimary] = sources.splice(declaredPrimaryIndex, 1)
      sources.unshift(declaredPrimary!)
    }
    sources.forEach((source, index) => {
      const previous = previousCohort.find((relation) => relation.sourceKind === source.sourceKind && relation.sourceId === source.sourceId)
      const generatedKey = `relation:${relationId}:${source.sourceKind}:${source.sourceId}`
      let id = index === 0
        ? relationId
        : validId(source.id) && source.id !== relationId
          ? source.id
          : previous?.id ?? options.generatedIds.get(generatedKey)
      if (!id || usedRelationIds.has(id)) {
        id = `script-relation-${options.createId()}`
        options.generatedIds.set(generatedKey, id)
      }
      usedRelationIds.add(id)
      sourceRelations.push({
        ...source,
        id,
        targetBlockId: projection.blockId,
        targetStart: projection.start,
        targetEnd: projection.end
      })
    })
  }
  const previouslyProjectedRelationIds = new Set((options.previous?.sourceRelations ?? []).filter((relation) => (
    previousProjections.some((projection) => projection.type === 'scriptMaterialRelation'
      && projection.blockId === relation.targetBlockId
      && projection.start === relation.targetStart
      && projection.end === relation.targetEnd
      && validId(projection.attrs.relationId)
      && (projection.attrs.relationId === relation.id || options.previous?.sourceRelations.some((primary) => (
        primary.id === projection.attrs.relationId
        && primary.targetBlockId === relation.targetBlockId
        && primary.targetStart === relation.targetStart
        && primary.targetEnd === relation.targetEnd
      ))))
  )).map((relation) => relation.id))
  for (const relation of options.previous?.sourceRelations ?? []) {
    if (usedRelationIds.has(relation.id) || previouslyProjectedRelationIds.has(relation.id)) continue
    usedRelationIds.add(relation.id)
    sourceRelations.push({
      id: relation.id,
      targetBlockId: relation.targetBlockId,
      targetStart: relation.targetStart,
      targetEnd: relation.targetEnd,
      sourceKind: relation.sourceKind,
      sourceId: relation.sourceId,
      sourceVersion: relation.sourceVersion
    })
  }

  return {
    sourceRelations: sourceRelations.sort((left, right) => left.targetBlockId.localeCompare(right.targetBlockId) || left.targetStart - right.targetStart || left.id.localeCompare(right.id)),
    annotations: annotations.sort((left, right) => left.blockId.localeCompare(right.blockId) || left.blockStart - right.blockStart || left.id.localeCompare(right.id))
  }
}

export function currentScriptSnapshotInputs(snapshot: ProjectCurrentScriptSnapshot): {
  editorDocument: Record<string, unknown>
  sourceRelations: CurrentScriptSourceRelationInput[]
  annotations: ScriptTextAnnotationInput[]
} {
  return {
    editorDocument: snapshot.document.editorDocument,
    sourceRelations: snapshot.sourceRelations.map((relation) => ({
      id: relation.id,
      targetBlockId: relation.targetBlockId,
      targetStart: relation.targetStart,
      targetEnd: relation.targetEnd,
      sourceKind: relation.sourceKind,
      sourceId: relation.sourceId,
      sourceVersion: relation.sourceVersion
    })),
    annotations: snapshot.annotations.map((annotation) => ({
      id: annotation.id,
      blockId: annotation.blockId,
      blockStart: annotation.blockStart,
      blockEnd: annotation.blockEnd,
      selectedText: annotation.selectedText,
      style: annotation.style,
      note: annotation.note,
      status: annotation.status
    }))
  }
}
