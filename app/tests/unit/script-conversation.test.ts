import { describe, expect, it } from 'vitest'
import type { ScriptRevisionMessage } from '../../src/shared/domain'
import { groupCandidateMessages, messageTargetId } from '../../src/shared/script-conversation'

function candidate(id: string, targetSelectionId: string | null, selectionHash = id): ScriptRevisionMessage {
  return {
    id,
    threadId: 'thread',
    role: 'assistant',
    content: `候选${id}`,
    provider: 'codex_cli',
    selectedText: '目标原文',
    selectionHash,
    selectionSnapshot: {
      baseVersionId: 'version',
      targetSelectionId,
      selectedText: '目标原文',
      selectionHash,
      contextBefore: '',
      contextAfter: '',
      occurrenceIndex: 0,
      from: 1,
      to: 5
    },
    suggestion: { originalText: '目标原文', replacementText: `改写${id}`, action: 'replace', summary: '改写', rationale: '' },
    suggestionStatus: 'pending',
    candidateGroupId: null,
    candidateNumber: null,
    generationRound: null,
    candidateInstruction: null,
    taskId: null,
    contextSnapshot: null,
    model: 'gpt-test',
    reasoningEffort: 'high',
    sourceSelections: [],
    conflicts: [],
    webSearchMode: 'automatic',
    webSearches: [],
    factAnnotations: [],
    createdAt: `2026-07-25T00:00:0${id}.000Z`
  }
}

describe('script conversation candidate groups', () => {
  it('uses the stable target id before legacy hashes', () => {
    expect(messageTargetId(candidate('1', 'target-one', 'old-hash'))).toBe('target-one')
    expect(messageTargetId(candidate('2', null, 'old-hash'))).toBe('legacy-old-hash')
  })

  it('keeps only the latest turn visible while retaining all history in one numbered group', () => {
    const first = candidate('1', 'target-one')
    const second = candidate('2', 'target-one')
    const other = candidate('3', 'target-two')
    const result = groupCandidateMessages([first, second, other])

    expect(result.latestIds).toEqual(new Set(['2', '3']))
    expect(result.groupByMessageId.get('1')).toMatchObject({ number: 1, revisions: [first, second] })
    expect(result.groupByMessageId.get('3')).toMatchObject({ number: 2, revisions: [other] })
  })

  it('prefers persisted group ids, numbers and generation rounds over message order', () => {
    const newer = { ...candidate('2', 'target-one'), candidateGroupId: 'group-one', candidateNumber: 7, generationRound: 2 }
    const older = { ...candidate('1', 'target-one'), candidateGroupId: 'group-one', candidateNumber: 7, generationRound: 1 }
    const result = groupCandidateMessages([newer, older])

    expect(result.latestIds).toEqual(new Set(['2']))
    expect(result.groupByMessageId.get('1')).toMatchObject({ key: 'group-one', number: 7, revisions: [older, newer] })
  })
})
