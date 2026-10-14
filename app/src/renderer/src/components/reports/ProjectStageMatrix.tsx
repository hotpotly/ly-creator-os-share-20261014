import type { CreationReportPeriodProject, StageTimeKey } from '../../../../shared/domain'
import { formatCoarseDuration } from '../../../../shared/domain/coarse-time'
import { projectModuleLabels } from '../../utils/project-labels'

const stateLabel = {
  not_started: '未记录',
  in_progress: '进行中',
  completed: '已完成',
  skipped: '已跳过'
} as const

export function ProjectStageMatrix({
  projects,
  onOpenProject,
  onEditStage
}: {
  projects: CreationReportPeriodProject[]
  onOpenProject(projectId: string): void
  onEditStage(projectId: string, stageKey: StageTimeKey, anchor: HTMLElement): void
}): React.JSX.Element {
  const columns = [...new Set(projects.flatMap((project) => project.stages.map((stage) => stage.stageKey)))]
  if (!projects.length) return <div className="report-chart-empty">本期还没有项目阶段记录。</div>
  return <div className="report-matrix-wrap">
    <div className="report-stage-matrix" role="table" aria-label="项目与阶段矩阵" style={{ '--stage-columns': columns.length } as React.CSSProperties}>
      <div className="report-matrix-head" role="row"><span>项目</span>{columns.map((stageKey) => <span key={stageKey}>{projectModuleLabels[stageKey]}</span>)}</div>
      {projects.map((project) => <div className="report-matrix-row" role="row" key={project.projectId}>
        <button className="report-matrix-project" onClick={() => onOpenProject(project.projectId)}><i style={{ background: `var(--${project.colorToken})` }} /><span>{project.title}</span></button>
        {columns.map((stageKey) => {
          const stage = project.stages.find((item) => item.stageKey === stageKey)
          if (!stage) return <span className="report-matrix-cell missing" key={stageKey}><i /><span>未启用</span></span>
          const overdue = stage.varianceState === 'overdue_open' || stage.varianceState === 'late_completed'
          return <button
            className={`report-matrix-cell ${stage.stateAtCutoff}${overdue ? ' overdue' : ''}`}
            aria-label={`${project.title}，${projectModuleLabels[stageKey]}，${stateLabel[stage.stateAtCutoff]}${overdue ? '，逾期' : ''}`}
            key={stageKey}
            onClick={(event) => onEditStage(project.projectId, stageKey, event.currentTarget)}
            title={`${stateLabel[stage.stateAtCutoff]}${stage.elapsedSegments !== null ? ` · 已经过${stage.elapsedSegments}个时段` : ''}${overdue ? ' · 逾期' : ''}`}
          ><i /><span><b>{stateLabel[stage.stateAtCutoff]}</b><small>{stage.stateAtCutoff === 'in_progress' ? stage.elapsedSegments === null ? '未记开始' : `已过${formatCoarseDuration(stage.elapsedSegments)}` : stage.stateAtCutoff === 'skipped' ? '不计用时' : formatCoarseDuration(stage.durationSegments) ?? '未记录用时'}</small></span>{overdue ? <em>逾期</em> : null}</button>
        })}
      </div>)}
    </div>
  </div>
}
