import { describe, expect, it } from 'vitest'
import type { TopicStageDefinition } from '../../src/shared/domain'
import {
  decideProjectLifecycleTransition,
  deriveTopicNextAction,
  shouldUpdateTopicExpectedCompletion
} from '../../src/main/domain/lifecycle-policy'

const stages: TopicStageDefinition[] = [
  { id: 'new', name: '新选题', nextActionLabel: null, position: 0, role: 'standard', createdAt: '', updatedAt: '' },
  { id: 'evaluating', name: '评估中', nextActionLabel: null, position: 1, role: 'standard', createdAt: '', updatedAt: '' },
  { id: 'created', name: '已立项', nextActionLabel: null, position: 2, role: 'project_created', createdAt: '', updatedAt: '' },
  { id: 'completed', name: '已完成', nextActionLabel: null, position: 3, role: 'completed', createdAt: '', updatedAt: '' },
  { id: 'archived', name: '已归档', nextActionLabel: null, position: 4, role: 'archived', createdAt: '', updatedAt: '' },
  { id: 'shelved', name: '已搁置', nextActionLabel: null, position: 5, role: 'shelved', createdAt: '', updatedAt: '' }
]

describe('lifecycle policy', () => {
  it('derives the next action from the single topic lifecycle source', () => {
    expect(deriveTopicNextAction(stages, 'new', null)).toEqual({ nextActionKind: 'advance_stage', nextStageId: 'evaluating' })
    expect(deriveTopicNextAction(stages, 'evaluating', null)).toEqual({ nextActionKind: 'create_project', nextStageId: null })
    expect(deriveTopicNextAction(stages, 'created', null).nextActionKind).toBe('create_project')
    expect(deriveTopicNextAction(stages, 'created', 'project-1').nextActionKind).toBe('open_project')
    expect(deriveTopicNextAction(stages, 'completed', 'project-1').nextActionKind).toBe('restart_project')
  })

  it('keeps trash, restore and completion rules explicit', () => {
    expect(decideProjectLifecycleTransition({
      action: { type: 'set', lifecycle: 'completed' },
      projectStatus: 'producing',
      topicStageRole: 'project_created',
      trashedAt: null
    })).toMatchObject({ targetRole: 'completed', recordActualCompletion: true, noOp: false })
    expect(decideProjectLifecycleTransition({
      action: { type: 'trash' },
      projectStatus: 'producing',
      topicStageRole: 'project_created',
      trashedAt: null
    })).toMatchObject({ targetRole: 'shelved', noOp: false })
    expect(decideProjectLifecycleTransition({
      action: { type: 'restore' },
      projectStatus: 'archived',
      topicStageRole: 'shelved',
      trashedAt: '2026-07-20T00:00:00.000Z'
    })).toMatchObject({ targetRole: 'project_created', normalizeLegacyArchivedProject: true })
  })

  it('protects permanent deletion when the project is active or has business facts', () => {
    expect(() => decideProjectLifecycleTransition({
      action: { type: 'permanently_delete' },
      projectStatus: 'producing',
      topicStageRole: 'project_created',
      trashedAt: null
    })).toThrow('项目必须先移入回收站')
    expect(() => decideProjectLifecycleTransition({
      action: { type: 'permanently_delete' },
      projectStatus: 'producing',
      topicStageRole: 'shelved',
      trashedAt: '2026-07-20T00:00:00.000Z',
      hasBusinessData: true
    })).toThrow('已有商务记录')
  })

  it('allows only deadline markers and hard deadlines to change expected completion', () => {
    expect(shouldUpdateTopicExpectedCompletion('topic_deadline_marker')).toBe(true)
    expect(shouldUpdateTopicExpectedCompletion('hard_deadline_item')).toBe(true)
    expect(shouldUpdateTopicExpectedCompletion('schedule_item')).toBe(false)
  })
})
