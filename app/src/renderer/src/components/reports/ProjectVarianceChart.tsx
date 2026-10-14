import type { CreationReportPeriodProject, StageTimeKey } from '../../../../shared/domain'
import { projectModuleLabels } from '../../utils/project-labels'

function formatVariance(segments: number): string {
  if (segments === 0) return '按期'
  const days = Math.round(Math.abs(segments) / 3 * 2) / 2
  return `${segments < 0 ? '提前' : '延迟'}${days}天`
}

export function ProjectVarianceChart({
  projects,
  onOpen
}: {
  projects: CreationReportPeriodProject[]
  onOpen(projectId: string, stageKey?: StageTimeKey): void
}): React.JSX.Element {
  const rows = projects.map((project) => {
    const periodStages = project.stages.filter((item) => item.varianceInPeriod)
    const stage = [...periodStages].filter((item) => item.varianceSegments !== null)
      .sort((left, right) => Math.abs(right.varianceSegments!) - Math.abs(left.varianceSegments!))[0]
    return { project, stage, hasUpcoming: periodStages.some((item) => item.varianceState === 'not_due'), hasSchedule: periodStages.length > 0 }
  })
  const withVariance = rows.filter((row) => row.stage)
  const upcomingCount = rows.filter((row) => !row.stage && row.hasUpcoming).length
  const noScheduleCount = rows.filter((row) => !row.hasSchedule).length
  const maximum = Math.max(1, ...withVariance.map((row) => Math.abs(row.stage!.varianceSegments!)))
  if (!rows.length) return <div className="report-chart-empty">本期还没有项目。</div>
  return <div className="report-variance-chart">
    <div className="report-variance-axis"><span>提前</span><b>按期</b><span>延迟</span></div>
    {withVariance.map(({ project, stage }) => {
      const value = stage!.varianceSegments!
      const width = Math.max(value === 0 ? 2 : 5, Math.abs(value) / maximum * 50)
      return <button key={project.projectId} onClick={() => onOpen(project.projectId, stage!.stageKey)} title={`${projectModuleLabels[stage!.stageKey]}：${formatVariance(value)}`}>
        <span><i style={{ background: `var(--${project.colorToken})` }} />{project.title}</span>
        <div><em className={value < 0 ? 'early' : value > 0 ? 'late' : 'on-time'} style={value < 0 ? { width: `${width}%`, right: '50%' } : { width: `${width}%`, left: '50%' }} /></div>
        <strong>{value > 0 ? '+' : value < 0 ? '−' : ''}{formatVariance(value).replace(/^(提前|延迟)/, '')}</strong>
      </button>
    })}
    {upcomingCount ? <p>{upcomingCount}个项目有未到期排期，暂不计算偏差。</p> : null}
    {noScheduleCount ? <p>{noScheduleCount}个项目无本期排期样本，未画成按期。</p> : null}
  </div>
}
