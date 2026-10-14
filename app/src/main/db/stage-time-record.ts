import type { StagePlanField, StageTimeKey, StageTimePoint, StageTimeRecord, StageTimeSource } from '../../shared/domain'
import { diffSegments, formatCoarseDuration } from '../../shared/domain/coarse-time'
import type * as schema from './schema'
const parseJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T } catch { return fallback } }

export function mapStageTimeRecord(row: typeof schema.stageTimeRecords.$inferSelect): StageTimeRecord {
  const startedAt = row.startedDate && row.startedSegment ? { localDate: row.startedDate, segment: row.startedSegment as StageTimePoint['segment'] } : null
  const completedAt = row.completedDate && row.completedSegment ? { localDate: row.completedDate, segment: row.completedSegment as StageTimePoint['segment'] } : null
  const plannedStartedAt = row.plannedStartedDate && row.plannedStartedSegment ? { localDate: row.plannedStartedDate, segment: row.plannedStartedSegment as StageTimePoint['segment'] } : null
  const plannedCompletedAt = row.plannedCompletedDate && row.plannedCompletedSegment ? { localDate: row.plannedCompletedDate, segment: row.plannedCompletedSegment as StageTimePoint['segment'] } : null
  const duration = stageDuration(startedAt, completedAt)
  const planManualFields = parseJson<StagePlanField[]>(row.planManualFieldsJson, []).filter((field): field is StagePlanField => ['start', 'duration', 'end'].includes(field)).slice(-2)
  return {
    id: row.id, projectId: row.projectId, stageKey: row.stageKey as StageTimeKey, status: row.status as StageTimeRecord['status'],
    startedAt, completedAt, startSource: row.startSource as StageTimeSource | null, completionSource: row.completionSource as StageTimeSource | null,
    actualEffortHalfDayUnits: row.actualEffortHalfDayUnits,
    plannedStartedAt, plannedCompletedAt, estimatedDurationHalfDayUnits: row.estimatedDurationHalfDayUnits,
    planManualFields, planAutoField: row.planAutoField as StagePlanField | null, autoStartActionId: row.autoStartActionId,
    durationSegments: duration.segments, durationLabel: duration.label, createdAt: row.createdAt, updatedAt: row.updatedAt
  }
}


export function stageDuration(startedAt: StageTimePoint | null, completedAt: StageTimePoint | null): { segments: number | null; label: string | null } {
  if (!startedAt || !completedAt) return { segments: null, label: null }
  const segments = diffSegments(startedAt, completedAt)
  if (segments < 0) throw new Error('完成时间不能早于开始时间')
  return { segments, label: formatCoarseDuration(segments) }
}
