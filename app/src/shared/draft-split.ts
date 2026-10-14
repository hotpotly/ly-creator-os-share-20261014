export type DraftSplitSide = 'claude' | 'codex'

export interface DraftParagraphIdSides {
  claude: string[]
  codex: string[]
}

export interface DraftSplitSelection {
  side: DraftSplitSide
  paragraphIds: string[]
  matchedParagraphIds?: string[]
}

export interface DraftSplitInput {
  paragraphIds: DraftParagraphIdSides
  selection: DraftSplitSelection
}

export interface DraftOriginalOrderPartition {
  role: 'before' | 'selected' | 'after'
  paragraphIds: DraftParagraphIdSides
}

export interface DraftExtractPartition {
  role: 'remaining' | 'selected'
  paragraphIds: DraftParagraphIdSides
}

export interface DraftOrderFields {
  id: string
  position: number
  labelIndex: number
}

function oppositeSide(side: DraftSplitSide): DraftSplitSide {
  return side === 'claude' ? 'codex' : 'claude'
}

function assertUniqueIds(ids: readonly string[], errorCode: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(errorCode)
}

function selectedIdsBySide(input: DraftSplitInput): DraftParagraphIdSides {
  if (!input.selection.paragraphIds.length) throw new Error('DRAFT_SPLIT_SELECTION_EMPTY')
  assertUniqueIds(input.paragraphIds.claude, 'DRAFT_SPLIT_SOURCE_DUPLICATE_ID')
  assertUniqueIds(input.paragraphIds.codex, 'DRAFT_SPLIT_SOURCE_DUPLICATE_ID')
  assertUniqueIds(input.selection.paragraphIds, 'DRAFT_SPLIT_SELECTION_DUPLICATE_ID')
  assertUniqueIds(input.selection.matchedParagraphIds ?? [], 'DRAFT_SPLIT_SELECTION_DUPLICATE_ID')

  const selected: DraftParagraphIdSides = { claude: [], codex: [] }
  selected[input.selection.side] = [...input.selection.paragraphIds]
  selected[oppositeSide(input.selection.side)] = [...(input.selection.matchedParagraphIds ?? [])]

  for (const side of ['claude', 'codex'] as const) {
    const known = new Set(input.paragraphIds[side])
    if (selected[side].some((id) => !known.has(id))) throw new Error('DRAFT_SPLIT_SELECTION_UNKNOWN_ID')
  }
  return selected
}

function isCompletelyEmpty(paragraphIds: DraftParagraphIdSides): boolean {
  return paragraphIds.claude.length === 0 && paragraphIds.codex.length === 0
}

function partitionSideInOriginalOrder(
  sourceIds: readonly string[],
  selectedIds: readonly string[]
): { before: string[]; selected: string[]; after: string[] } {
  if (!selectedIds.length) return { before: [...sourceIds], selected: [], after: [] }
  const selected = new Set(selectedIds)
  const indexes = sourceIds.flatMap((id, index) => selected.has(id) ? [index] : [])
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) {
    throw new Error('DRAFT_SPLIT_SELECTION_NOT_CONTIGUOUS')
  }
  const first = indexes[0]!
  const last = indexes.at(-1)!
  return {
    before: sourceIds.slice(0, first),
    selected: sourceIds.slice(first, last + 1),
    after: sourceIds.slice(last + 1)
  }
}

/**
 * Splits a semantic-alignment group without changing paragraph order.
 *
 * The primary selection belongs to `selection.side`. When Codex has already
 * resolved the matching paragraphs on the other side, pass those IDs through
 * `matchedParagraphIds`; otherwise the other side stays in the original
 * `before` partition and the selected partition is intentionally one-sided.
 */
export function splitDraftParagraphsInOriginalOrder(input: DraftSplitInput): DraftOriginalOrderPartition[] {
  const selected = selectedIdsBySide(input)
  const claude = partitionSideInOriginalOrder(input.paragraphIds.claude, selected.claude)
  const codex = partitionSideInOriginalOrder(input.paragraphIds.codex, selected.codex)
  const partitions: DraftOriginalOrderPartition[] = (['before', 'selected', 'after'] as const).map((role) => ({
    role,
    paragraphIds: { claude: claude[role], codex: codex[role] }
  }))
  const nonEmpty = partitions.filter((partition) => !isCompletelyEmpty(partition.paragraphIds))
  if (!nonEmpty.some((partition) => partition.role === 'selected')) throw new Error('DRAFT_SPLIT_SELECTION_EMPTY')
  return nonEmpty
}

/**
 * Extracts the selected paragraphs into a new group immediately below the
 * current group. Non-contiguous selections are allowed and both result groups
 * preserve each side's original relative order.
 */
export function extractDraftParagraphsToGroupBelow(input: DraftSplitInput): DraftExtractPartition[] {
  const selected = selectedIdsBySide(input)
  const selectedSets = {
    claude: new Set(selected.claude),
    codex: new Set(selected.codex)
  }
  const partitions: DraftExtractPartition[] = [
    {
      role: 'remaining',
      paragraphIds: {
        claude: input.paragraphIds.claude.filter((id) => !selectedSets.claude.has(id)),
        codex: input.paragraphIds.codex.filter((id) => !selectedSets.codex.has(id))
      }
    },
    {
      role: 'selected',
      paragraphIds: {
        claude: input.paragraphIds.claude.filter((id) => selectedSets.claude.has(id)),
        codex: input.paragraphIds.codex.filter((id) => selectedSets.codex.has(id))
      }
    }
  ]
  if (partitions.some((partition) => isCompletelyEmpty(partition.paragraphIds))) {
    throw new Error('DRAFT_SPLIT_EMPTY_GROUP')
  }
  return partitions
}

export function renumberDraftGroupsContinuously<T extends DraftOrderFields>(groups: readonly T[]): T[] {
  assertUniqueIds(groups.map((group) => group.id), 'DRAFT_GROUP_ORDER_DUPLICATE_ID')
  return groups.map((group, position) => ({ ...group, position, labelIndex: position + 1 }))
}

export function reorderDraftGroupsContinuously<T extends DraftOrderFields>(
  groups: readonly T[],
  orderedGroupIds: readonly string[]
): T[] {
  assertUniqueIds(groups.map((group) => group.id), 'DRAFT_GROUP_ORDER_DUPLICATE_ID')
  assertUniqueIds(orderedGroupIds, 'DRAFT_GROUP_ORDER_DUPLICATE_ID')
  const byId = new Map(groups.map((group) => [group.id, group]))
  if (orderedGroupIds.length !== groups.length || orderedGroupIds.some((id) => !byId.has(id))) {
    throw new Error('DRAFT_GROUP_ORDER_INVALID_SET')
  }
  return renumberDraftGroupsContinuously(orderedGroupIds.map((id) => byId.get(id)!))
}
