import type { StageTimePoint, StageTimeStatus } from './domain'

/** A missing start is not proof that a stage never started. */
export function stageActualTimeLabel(stage: { status: StageTimeStatus; startedAt: StageTimePoint | null; completedAt: StageTimePoint | null }, format: (point: StageTimePoint) => string): string {
  if (stage.completedAt) return stage.startedAt
    ? `${format(stage.startedAt)}—${format(stage.completedAt)}`
    : `已完成于${format(stage.completedAt)}，开始时间未记录`
  if (stage.startedAt) return `${format(stage.startedAt)}—${stage.status === 'completed' ? '完成时间未记录' : stage.status === 'skipped' ? '已跳过' : '进行中'}`
  return stage.status === 'completed' ? '已完成，起止时间未记录' : stage.status === 'skipped' ? '已跳过' : stage.status === 'in_progress' ? '进行中，开始时间未记录' : '未开始'
}

export function stagePlanBaselineLabel(source: 'first_saved' | 'legacy'): string {
  return source === 'legacy' ? '接入时计划（非最初计划）' : '原计划（首次保存）'
}
