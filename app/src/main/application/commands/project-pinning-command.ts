import type { ProjectSummary } from '../../../shared/domain'
import { UndoConflictError } from '../../domain/undo-policy'
import type { UndoableCommand } from './contracts'

export const PROJECT_PINNING_COMMAND_TYPE = 'project.pinning'

export interface ProjectPinningCommandInput {
  projectId: string
  pinned: boolean
}

export interface ProjectPinningCommandResult {
  project: ProjectSummary
  previousPinned: boolean
}

export interface ProjectPinningUndoPayload {
  projectId: string
  previousPinned: boolean
  expectedPinned: boolean
}

export interface ProjectPinningCommandHandlers {
  execute(input: ProjectPinningCommandInput, timestamp: string): ProjectPinningCommandResult
  undo(payload: ProjectPinningUndoPayload, timestamp: string): void
}

export function createProjectPinningCommand(
  handlers: ProjectPinningCommandHandlers
): UndoableCommand<ProjectPinningCommandInput, ProjectPinningCommandResult, ProjectPinningUndoPayload> {
  return {
    type: PROJECT_PINNING_COMMAND_TYPE,
    isUndoPayload(payload): payload is ProjectPinningUndoPayload {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
      const candidate = payload as Record<string, unknown>
      return Object.keys(candidate).sort().join(',') === 'expectedPinned,previousPinned,projectId'
        && typeof candidate.projectId === 'string'
        && typeof candidate.previousPinned === 'boolean'
        && typeof candidate.expectedPinned === 'boolean'
    },
    execute(context, input) {
      const result = handlers.execute(input, context.now)
      return {
        result,
        undoPayload: {
          projectId: input.projectId,
          previousPinned: result.previousPinned,
          expectedPinned: input.pinned
        }
      }
    },
    undo(context, payload) {
      try {
        handlers.undo(payload, context.now)
      } catch (error) {
        throw new UndoConflictError(error instanceof Error ? error.message : '常用状态已经发生其他变化，无法撤销')
      }
    }
  }
}
