import { describe, expect, it } from 'vitest'
import {
  extractDraftParagraphsToGroupBelow,
  renumberDraftGroupsContinuously,
  reorderDraftGroupsContinuously,
  splitDraftParagraphsInOriginalOrder
} from '../../src/shared/draft-split'

const paragraphIds = {
  claude: ['c1', 'c2', 'c3', 'c4', 'c5'],
  codex: ['x1', 'x2', 'x3', 'x4', 'x5']
}

describe('draft semantic group split planning', () => {
  it('keeps untouched opposite content in the original group for a one-sided ordered split', () => {
    expect(splitDraftParagraphsInOriginalOrder({
      paragraphIds,
      selection: { side: 'claude', paragraphIds: ['c3', 'c4'] }
    })).toEqual([
      { role: 'before', paragraphIds: { claude: ['c1', 'c2'], codex: paragraphIds.codex } },
      { role: 'selected', paragraphIds: { claude: ['c3', 'c4'], codex: [] } },
      { role: 'after', paragraphIds: { claude: ['c5'], codex: [] } }
    ])
  })

  it('uses already matched opposite IDs and preserves both original orders', () => {
    expect(splitDraftParagraphsInOriginalOrder({
      paragraphIds,
      selection: {
        side: 'codex',
        paragraphIds: ['x2', 'x3'],
        matchedParagraphIds: ['c3', 'c4']
      }
    })).toEqual([
      { role: 'before', paragraphIds: { claude: ['c1', 'c2'], codex: ['x1'] } },
      { role: 'selected', paragraphIds: { claude: ['c3', 'c4'], codex: ['x2', 'x3'] } },
      { role: 'after', paragraphIds: { claude: ['c5'], codex: ['x4', 'x5'] } }
    ])
  })

  it('drops completely empty edge partitions while keeping the selected partition', () => {
    expect(splitDraftParagraphsInOriginalOrder({
      paragraphIds: { claude: ['c1', 'c2'], codex: ['x1', 'x2'] },
      selection: {
        side: 'claude',
        paragraphIds: ['c1'],
        matchedParagraphIds: ['x1']
      }
    })).toEqual([
      { role: 'selected', paragraphIds: { claude: ['c1'], codex: ['x1'] } },
      { role: 'after', paragraphIds: { claude: ['c2'], codex: ['x2'] } }
    ])
  })

  it('rejects a non-contiguous selection on either side of an ordered split', () => {
    expect(() => splitDraftParagraphsInOriginalOrder({
      paragraphIds,
      selection: { side: 'claude', paragraphIds: ['c1', 'c3'] }
    })).toThrow('DRAFT_SPLIT_SELECTION_NOT_CONTIGUOUS')
    expect(() => splitDraftParagraphsInOriginalOrder({
      paragraphIds,
      selection: {
        side: 'claude',
        paragraphIds: ['c2'],
        matchedParagraphIds: ['x1', 'x3']
      }
    })).toThrow('DRAFT_SPLIT_SELECTION_NOT_CONTIGUOUS')
  })

  it('normalizes a reversed selection back to source order', () => {
    expect(splitDraftParagraphsInOriginalOrder({
      paragraphIds,
      selection: {
        side: 'claude',
        paragraphIds: ['c4', 'c3'],
        matchedParagraphIds: ['x4', 'x3']
      }
    })[1]).toEqual({
      role: 'selected',
      paragraphIds: { claude: ['c3', 'c4'], codex: ['x3', 'x4'] }
    })
  })

  it('extracts a non-contiguous selection below without changing relative order', () => {
    expect(extractDraftParagraphsToGroupBelow({
      paragraphIds,
      selection: {
        side: 'claude',
        paragraphIds: ['c5', 'c2'],
        matchedParagraphIds: ['x4', 'x1']
      }
    })).toEqual([
      {
        role: 'remaining',
        paragraphIds: { claude: ['c1', 'c3', 'c4'], codex: ['x2', 'x3', 'x5'] }
      },
      {
        role: 'selected',
        paragraphIds: { claude: ['c2', 'c5'], codex: ['x1', 'x4'] }
      }
    ])
  })

  it('allows extracting an entire primary side when the untouched side keeps the original group non-empty', () => {
    expect(extractDraftParagraphsToGroupBelow({
      paragraphIds: { claude: ['c1'], codex: ['x1'] },
      selection: { side: 'claude', paragraphIds: ['c1'] }
    })).toEqual([
      { role: 'remaining', paragraphIds: { claude: [], codex: ['x1'] } },
      { role: 'selected', paragraphIds: { claude: ['c1'], codex: [] } }
    ])
  })

  it('rejects extraction when it would leave a completely empty original group', () => {
    expect(() => extractDraftParagraphsToGroupBelow({
      paragraphIds: { claude: ['c1'], codex: ['x1'] },
      selection: {
        side: 'claude',
        paragraphIds: ['c1'],
        matchedParagraphIds: ['x1']
      }
    })).toThrow('DRAFT_SPLIT_EMPTY_GROUP')
  })

  it.each([
    {
      name: 'empty selection',
      input: { paragraphIds, selection: { side: 'claude' as const, paragraphIds: [] } },
      error: 'DRAFT_SPLIT_SELECTION_EMPTY'
    },
    {
      name: 'unknown selection ID',
      input: { paragraphIds, selection: { side: 'claude' as const, paragraphIds: ['missing'] } },
      error: 'DRAFT_SPLIT_SELECTION_UNKNOWN_ID'
    },
    {
      name: 'duplicate source ID',
      input: {
        paragraphIds: { claude: ['c1', 'c1'], codex: ['x1'] },
        selection: { side: 'claude' as const, paragraphIds: ['c1'] }
      },
      error: 'DRAFT_SPLIT_SOURCE_DUPLICATE_ID'
    },
    {
      name: 'duplicate selection ID',
      input: { paragraphIds, selection: { side: 'claude' as const, paragraphIds: ['c1', 'c1'] } },
      error: 'DRAFT_SPLIT_SELECTION_DUPLICATE_ID'
    },
    {
      name: 'unknown matched ID',
      input: {
        paragraphIds,
        selection: { side: 'claude' as const, paragraphIds: ['c1'], matchedParagraphIds: ['missing'] }
      },
      error: 'DRAFT_SPLIT_SELECTION_UNKNOWN_ID'
    }
  ])('rejects $name', ({ input, error }) => {
    expect(() => splitDraftParagraphsInOriginalOrder(input)).toThrow(error)
    expect(() => extractDraftParagraphsToGroupBelow(input)).toThrow(error)
  })
})

describe('draft group continuous ordering', () => {
  const groups = [
    { id: 'g3', position: 7, labelIndex: 9, content: 'third' },
    { id: 'g1', position: 2, labelIndex: 4, content: 'first' },
    { id: 'g2', position: 5, labelIndex: 8, content: 'second' }
  ]

  it('renumbers the given order without mutating source records', () => {
    const result = renumberDraftGroupsContinuously(groups)
    expect(result.map(({ id, position, labelIndex }) => ({ id, position, labelIndex }))).toEqual([
      { id: 'g3', position: 0, labelIndex: 1 },
      { id: 'g1', position: 1, labelIndex: 2 },
      { id: 'g2', position: 2, labelIndex: 3 }
    ])
    expect(groups[0]).toMatchObject({ position: 7, labelIndex: 9 })
    expect(result.map((group) => group.content)).toEqual(['third', 'first', 'second'])
  })

  it('reorders by an exact ID permutation and applies continuous positions and labels', () => {
    expect(reorderDraftGroupsContinuously(groups, ['g1', 'g2', 'g3'])).toEqual([
      { id: 'g1', position: 0, labelIndex: 1, content: 'first' },
      { id: 'g2', position: 1, labelIndex: 2, content: 'second' },
      { id: 'g3', position: 2, labelIndex: 3, content: 'third' }
    ])
  })

  it('rejects duplicate, missing and unknown reorder IDs', () => {
    expect(() => reorderDraftGroupsContinuously(groups, ['g1', 'g1', 'g3']))
      .toThrow('DRAFT_GROUP_ORDER_DUPLICATE_ID')
    expect(() => reorderDraftGroupsContinuously(groups, ['g1', 'g2']))
      .toThrow('DRAFT_GROUP_ORDER_INVALID_SET')
    expect(() => reorderDraftGroupsContinuously(groups, ['g1', 'g2', 'missing']))
      .toThrow('DRAFT_GROUP_ORDER_INVALID_SET')
    expect(() => renumberDraftGroupsContinuously([...groups, { ...groups[0]!, position: 10 }]))
      .toThrow('DRAFT_GROUP_ORDER_DUPLICATE_ID')
  })
})
