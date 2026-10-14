import type { CreateScheduleInput, ScheduleItem } from '../../../shared/domain'
import { UndoConflictError } from '../../domain/undo-policy'
import type { UndoableCommand } from './contracts'

export const SCHEDULE_BATCH_CREATE_COMMAND_TYPE = 'schedule.batch-create'

export interface ScheduleBatchCreateCommandInput {
  items: CreateScheduleInput[]
}

export interface ScheduleBatchCreateUndoPayload {
  items: ScheduleItem[]
}

export interface ScheduleBatchCreateCommandHandlers {
  execute(input: ScheduleBatchCreateCommandInput): ScheduleItem[]
  undo(payload: ScheduleBatchCreateUndoPayload): void
}

function isScheduleItem(value: unknown): value is ScheduleItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && (item.projectId === null || typeof item.projectId === 'string')
    && (item.colorToken === null || typeof item.colorToken === 'string')
    && typeof item.title === 'string'
    && typeof item.actionType === 'string'
    && (item.startAt === null || typeof item.startAt === 'string')
    && (item.endAt === null || typeof item.endAt === 'string')
    && ['plan', 'hard_deadline', 'publish_date'].includes(String(item.scheduleKind))
    && ['normal', 'waiting', 'done', 'overdue'].includes(String(item.state))
    && (item.waitingFor === null || typeof item.waitingFor === 'string')
    && ['user', 'project_node', 'synchronized'].includes(String(item.source))
    && typeof item.isMovable === 'boolean'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
}

export function createScheduleBatchCreateCommand(
  handlers: ScheduleBatchCreateCommandHandlers
): UndoableCommand<ScheduleBatchCreateCommandInput, ScheduleItem[], ScheduleBatchCreateUndoPayload> {
  return {
    type: SCHEDULE_BATCH_CREATE_COMMAND_TYPE,
    isUndoPayload(payload): payload is ScheduleBatchCreateUndoPayload {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
      const candidate = payload as Record<string, unknown>
      return Object.keys(candidate).join(',') === 'items'
        && Array.isArray(candidate.items)
        && candidate.items.length >= 1
        && candidate.items.length <= 20
        && candidate.items.every(isScheduleItem)
    },
    execute(_context, input) {
      const items = handlers.execute(input)
      return { result: items, undoPayload: { items } }
    },
    undo(_context, payload) {
      try {
        handlers.undo(payload)
      } catch (error) {
        throw new UndoConflictError(error instanceof Error ? error.message : '这些排期已经发生变化，无法撤销')
      }
    }
  }
}
