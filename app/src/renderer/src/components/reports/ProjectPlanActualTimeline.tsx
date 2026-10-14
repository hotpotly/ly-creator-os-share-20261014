import { stageActualTimeLabel, stagePlanBaselineLabel } from '../../../../shared/stage-review'
import type { ProjectCreationReview, StageTimeKey, StageTimePoint } from '../../../../shared/domain'
import { toSegmentOrdinal } from '../../../../shared/domain/coarse-time'
import { projectModuleLabels } from '../../utils/project-labels'

const segmentLabels: Record<StageTimePoint['segment'], string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
function pointLabel(point: StageTimePoint | null): string {
  return point ? `${Number(point.localDate.slice(5, 7))}月${Number(point.localDate.slice(8, 10))}日${segmentLabels[point.segment]}` : '未记录'
}

function samePoint(left: StageTimePoint | null, right: StageTimePoint | null): boolean {
  return Boolean(left && right && left.localDate === right.localDate && left.segment === right.segment)
}

export function ProjectPlanActualTimeline({
  review,
  onOpen,
  onOpenSchedule
}: {
  review: ProjectCreationReview
  onOpen(stageKey: StageTimeKey, anchor: HTMLElement): void
  onOpenSchedule(): void
}): React.JSX.Element {
  const points = review.stages.flatMap((stage) => [stage.plannedStartAt, stage.plannedEndAt, stage.startedAt, stage.completedAt, stage.baseline?.plannedStartAt, stage.baseline?.plannedEndAt])
    .filter((point): point is StageTimePoint => Boolean(point))
  if (!points.length) return <div className="report-chart-empty">这个项目还没有计划或实际时间点。</div>
  const minimum = Math.min(...points.map(toSegmentOrdinal))
  const maximum = Math.max(
    minimum + 1,
    ...points.map(toSegmentOrdinal),
    ...(review.stages.some(stage => stage.status === 'in_progress' && stage.startedAt) ? [toSegmentOrdinal(review.calculatedThrough)] : [])
  )
  const position = (point: StageTimePoint): number => (toSegmentOrdinal(point) - minimum) / (maximum - minimum) * 100
  const width = (start: StageTimePoint, end: StageTimePoint): number => Math.max(1.5, position(end) - position(start))
  return <div className="project-review-timeline" role="list" aria-label="项目计划与实际时间线">
    {review.stages.map((stage) => {
      const actualEnd = stage.completedAt ?? (stage.startedAt && stage.status === 'in_progress' ? review.calculatedThrough : null)
      const plannedPoint = samePoint(stage.plannedStartAt, stage.plannedEndAt)
      const risk = stage.varianceState === 'overdue_open'
      const baseline = stage.baseline
      const baselinePoint = baseline ? samePoint(baseline.plannedStartAt, baseline.plannedEndAt) : false
      return <button role="listitem" key={stage.stageKey} onClick={(event) => onOpen(stage.stageKey, event.currentTarget)}>
        <b>{projectModuleLabels[stage.stageKey]}</b>
        <div className="project-review-track">
          {baseline?.plannedStartAt && baseline.plannedEndAt ? <i className={`baseline${baselinePoint ? ' point' : ''}`} style={{ left: `${position(baseline.plannedStartAt)}%`, width: baselinePoint ? '3px' : `${width(baseline.plannedStartAt, baseline.plannedEndAt)}%` }} /> : null}
          {stage.plannedStartAt && stage.plannedEndAt ? <i className={`planned${plannedPoint ? ' point' : ''}`} style={plannedPoint
            ? { left: `${position(stage.plannedStartAt)}%` }
            : { left: `${position(stage.plannedStartAt)}%`, width: `${width(stage.plannedStartAt, stage.plannedEndAt)}%` }} /> : null}
          {stage.startedAt && actualEnd ? <i className={`actual${stage.completedAt ? '' : ' open'}${risk ? ' risk' : ''}`} style={{ left: `${position(stage.startedAt)}%`, width: `${width(stage.startedAt, actualEnd)}%` }} /> : null}
          {stage.startedAt && !actualEnd ? <i className="actual point" title={`开始于${pointLabel(stage.startedAt)}，未记录完成日期`} style={{ left: `${position(stage.startedAt)}%`, width: '3px' }} /> : null}
          {!stage.startedAt && stage.completedAt ? <i className="actual point" title={`完成于${pointLabel(stage.completedAt)}，开始时间未记录`} style={{ left: `${position(stage.completedAt)}%`, width: '3px' }} /> : null}
        </div>
        <span className="project-review-time-values">{baseline ? <small className="project-review-original-plan" title={`保存于${baseline.capturedAt}；之后改期不覆盖`}><i className="baseline" />{stagePlanBaselineLabel(baseline.source)}：{baselinePoint ? `截止${pointLabel(baseline.plannedEndAt)}` : `${pointLabel(baseline.plannedStartAt)}—${pointLabel(baseline.plannedEndAt)}`}</small> : <small className="project-review-original-plan">原计划：未设置</small>}<small><i className={`planned${plannedPoint ? ' point' : ''}`} />当前排期{stage.plannedStartAt ? plannedPoint ? `截止${pointLabel(stage.plannedEndAt)}` : `${pointLabel(stage.plannedStartAt)}—${pointLabel(stage.plannedEndAt)}` : '未设置'}</small><small><i className={`actual${risk ? ' risk' : ''}`} />实际{stageActualTimeLabel(stage, pointLabel)}</small></span>
        <span className={`project-review-time-state${risk ? ' risk' : ''}`}>{stage.varianceState === 'overdue_open' ? '仍逾期' : stage.varianceState === 'late_completed' ? '晚完成' : stage.varianceState === 'early' ? '提前完成' : stage.varianceState === 'no_schedule' ? '无排期' : stage.status === 'in_progress' ? '进行中' : '—'}</span>
      </button>
    })}
    <div className="project-review-timeline-legend"><span><i className="baseline" />保留计划</span><span><i className="planned point" />截止日</span><span><i className="planned" />当前排期</span><span><i className="actual" />实际时间</span><span><i className="actual risk" />进行中风险</span><button onClick={onOpenSchedule}>打开此项目排期</button></div>
  </div>
}
