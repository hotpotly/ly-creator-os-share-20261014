import {
  PROJECT_STATUSES,
  type ProjectModuleKey,
  type ProjectStatus,
  type StageTimeRecord
} from '../../../shared/domain'
import { UndoConflictError } from '../../domain/undo-policy'
import type { UndoableCommand } from './contracts'

export const STAGE_COMPLETION_COMMAND_TYPE = 'project.stage-completion'

export interface StageCompletionCommandInput {
  projectId: string
  moduleKey: ProjectModuleKey
  completed: boolean
}

export interface ClassificationLearningSampleSnapshot {
  id: string
  projectId: string
  title: string
  suggestedTypeId: string | null
  finalTypeId: string
  createdAt: string
}

export interface StageCompletionCommandResult {
  record: StageTimeRecord
  eventId: string
  projectStatusBefore: ProjectStatus | null
  projectStatusAfter: ProjectStatus | null
  moduleCompletedAtBefore: string | null
  moduleCompletedAtAfter: string | null
  classificationLearningSampleIds: string[]
  removedClassificationLearningSamples: ClassificationLearningSampleSnapshot[]
}

export interface StageCompletionUndoPayload {
  projectId: string
  eventId: string
  projectStatusBefore: ProjectStatus | null
  projectStatusAfter: ProjectStatus | null
  moduleCompletedAtBefore: string | null
  moduleCompletedAtAfter: string | null
  classificationLearningSampleIds: string[]
  removedClassificationLearningSamples: ClassificationLearningSampleSnapshot[]
}

export interface StageCompletionCommandHandlers {
  execute(input: StageCompletionCommandInput): StageCompletionCommandResult
  undo(payload: StageCompletionUndoPayload): void
}

export function createStageCompletionCommand(
  handlers: StageCompletionCommandHandlers
): UndoableCommand<StageCompletionCommandInput, StageCompletionCommandResult, StageCompletionUndoPayload> {
  return {
    type: STAGE_COMPLETION_COMMAND_TYPE,
    isUndoPayload(payload): payload is StageCompletionUndoPayload {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
      const candidate = payload as Record<string, unknown>
      if (Object.keys(candidate).sort().join(',') !== 'classificationLearningSampleIds,eventId,moduleCompletedAtAfter,moduleCompletedAtBefore,projectId,projectStatusAfter,projectStatusBefore,removedClassificationLearningSamples') return false
      const validStatus = (status: unknown): status is ProjectStatus | null => (
        status === null
        || (typeof status === 'string' && PROJECT_STATUSES.includes(status as ProjectStatus))
      )
      const validNullableText = (value: unknown): value is string | null => value === null || typeof value === 'string'
      const validRemovedSample = (value: unknown): value is ClassificationLearningSampleSnapshot => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const sample = value as Record<string, unknown>
        return Object.keys(sample).sort().join(',') === 'createdAt,finalTypeId,id,projectId,suggestedTypeId,title'
          && typeof sample.id === 'string'
          && typeof sample.projectId === 'string'
          && typeof sample.title === 'string'
          && validNullableText(sample.suggestedTypeId)
          && typeof sample.finalTypeId === 'string'
          && typeof sample.createdAt === 'string'
      }
      return typeof candidate.projectId === 'string'
        && typeof candidate.eventId === 'string'
        && validStatus(candidate.projectStatusBefore)
        && validStatus(candidate.projectStatusAfter)
        && ((candidate.projectStatusBefore === null) === (candidate.projectStatusAfter === null))
        && validNullableText(candidate.moduleCompletedAtBefore)
        && validNullableText(candidate.moduleCompletedAtAfter)
        && Array.isArray(candidate.classificationLearningSampleIds)
        && candidate.classificationLearningSampleIds.every((id) => typeof id === 'string')
        && Array.isArray(candidate.removedClassificationLearningSamples)
        && candidate.removedClassificationLearningSamples.every(validRemovedSample)
    },
    execute(_context, input) {
      const result = handlers.execute(input)
      return {
        result,
        undoPayload: {
          projectId: input.projectId,
          eventId: result.eventId,
          projectStatusBefore: result.projectStatusBefore,
          projectStatusAfter: result.projectStatusAfter,
          moduleCompletedAtBefore: result.moduleCompletedAtBefore,
          moduleCompletedAtAfter: result.moduleCompletedAtAfter,
          classificationLearningSampleIds: result.classificationLearningSampleIds,
          removedClassificationLearningSamples: result.removedClassificationLearningSamples
        }
      }
    },
    undo(_context, payload) {
      try {
        handlers.undo(payload)
      } catch (error) {
        throw new UndoConflictError(error instanceof Error ? error.message : '阶段时间已经发生其他变化，无法撤销')
      }
    }
  }
}
