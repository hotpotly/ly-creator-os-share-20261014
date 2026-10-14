import type { ProjectCreationReview, StageTimeKey } from '../../../../shared/domain'
import { projectModuleLabels } from '../../utils/project-labels'

export function ProjectEffortChart({
  review,
  onOpen
}: {
  review: ProjectCreationReview
  onOpen(stageKey: StageTimeKey, anchor: HTMLElement): void
}): React.JSX.Element {
  const palette = ['var(--primary)', 'var(--warning)', 'var(--project-3)', 'var(--project-4)', 'var(--project-6)', 'var(--project-8)', 'var(--project-10)']
  const measured = review.stages.map((stage, index) => ({ stage, index })).filter(({ stage }) => (stage.actualEffortHalfDayUnits ?? 0) > 0)
  const stops = measured.reduce<{ cursor: number; values: string[] }>((result, { stage, index }) => {
    const end = result.cursor + (stage.actualEffortHalfDayUnits! / Math.max(1, review.summaryActualEffortHalfDayUnits)) * 100
    return { cursor: end, values: [...result.values, `${palette[index % palette.length]} ${result.cursor}% ${end}%`] }
  }, { cursor: 0, values: [] }).values
  const gradient = stops.length ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(var(--raised) 0 100%)'
  return <div className="project-effort-chart" aria-label="项目阶段实际投入">
    <div className="project-effort-donut" style={{ background: gradient }}><span><b>{review.summaryActualEffortStageCount ? `${review.summaryActualEffortHalfDayUnits / 2}天` : '—'}</b><small>总投入</small></span></div>
    <div className="project-effort-legend" role="list">{review.stages.map((stage, index) => <button role="listitem" key={stage.stageKey} onClick={(event) => onOpen(stage.stageKey, event.currentTarget)}>
      <i style={{ background: stage.actualEffortHalfDayUnits === null ? 'var(--line-strong)' : palette[index % palette.length] }} />
      <b>{projectModuleLabels[stage.stageKey]}</b>
      <span>{stage.actualEffortHalfDayUnits === null ? '未填' : `${stage.actualEffortHalfDayUnits / 2}天`}</span>
    </button>)}</div>
    <p>已填写{review.summaryActualEffortStageCount}/{review.stages.length}个阶段</p>
  </div>
}
