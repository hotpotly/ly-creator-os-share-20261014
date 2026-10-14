import type { StageTimePoint } from '../../../shared/domain'

/** Keep partial dates readable without inventing a missing endpoint. */
export function formatStageDateRange(start: StageTimePoint | null, end: StageTimePoint | null): string {
  const crossYear = Boolean(start && end && start.localDate.slice(0, 4) !== end.localDate.slice(0, 4))
  const date = (point: StageTimePoint): string => (crossYear ? point.localDate : point.localDate.slice(5)).replaceAll('-', '/')
  if (start && end) return start.localDate === end.localDate ? date(start) : `${date(start)}—${date(end)}`
  if (start) return `${date(start)}开始`
  if (end) return `${date(end)}结束`
  return '设置阶段时间'
}
