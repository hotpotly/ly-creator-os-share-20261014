import { describe, expect, it } from 'vitest'
import type { TopicRecord, TopicStageDefinition } from '../../src/shared/domain'
import { deriveTopicDeadlineMarkers } from '../../src/shared/topic-deadline-marker'

const stages: TopicStageDefinition[] = [
  { id: 'draft', name: '待评估', nextActionLabel: '决定是否制作', position: 10, role: 'standard', createdAt: '', updatedAt: '' },
  { id: 'created', name: '已立项', nextActionLabel: null, position: 20, role: 'project_created', createdAt: '', updatedAt: '' },
  { id: 'shelved', name: '已搁置', nextActionLabel: null, position: 30, role: 'shelved', createdAt: '', updatedAt: '' }
]

function topic(patch: Partial<TopicRecord> = {}): TopicRecord {
  return {
    id: 'topic-1',
    title: '系统通知体验',
    coreAngle: '',
    contentTypeId: 'type-system',
    importanceLevel: 2,
    needsMoreExperience: false,
    startAt: null,
    expectedCompletionAt: '2026-07-28',
    actualCompletionAt: null,
    scheduleVarianceDays: null,
    nextActionKind: 'advance_stage',
    nextStageId: 'created',
    stageId: 'draft',
    customValues: {},
    sourceCaptureIds: [],
    createdProjectId: null,
    lastProjectDeletedAt: null,
    trashedAt: null,
    directions: [],
    ...patch
  }
}

describe('选题预期完成旗帜投影', () => {
  it('只投影未删除且位于普通阶段的选题，保留已关联项目的无损回退', () => {
    const result = deriveTopicDeadlineMarkers([
      topic(),
      topic({ id: 'linked-draft', createdProjectId: 'project-paused', stageId: 'draft' }),
      topic({ id: 'created-topic', createdProjectId: 'project-1', stageId: 'created' }),
      topic({ id: 'shelved-topic', stageId: 'shelved' }),
      topic({ id: 'trashed-topic', trashedAt: '2026-07-25T00:00:00.000Z' }),
      topic({ id: 'no-date', expectedCompletionAt: null })
    ], stages, '2026-07-25')

    expect(result).toEqual([
      { topicId: 'topic-1', title: '系统通知体验', date: '2026-07-28', overdue: false },
      { topicId: 'linked-draft', title: '系统通知体验', date: '2026-07-28', overdue: false }
    ])
  })

  it('同一选题只生成一枚旗帜并标记逾期', () => {
    const duplicated = topic({ expectedCompletionAt: '2026-07-24' })
    const result = deriveTopicDeadlineMarkers([duplicated, { ...duplicated }], stages, '2026-07-25')

    expect(result).toEqual([{ topicId: 'topic-1', title: '系统通知体验', date: '2026-07-24', overdue: true }])
  })
})
