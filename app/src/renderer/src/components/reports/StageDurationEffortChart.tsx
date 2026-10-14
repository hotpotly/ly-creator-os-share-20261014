import type { CreationReportStageSummary, StageTimeKey } from '../../../../shared/domain'
import { projectModuleLabels } from '../../utils/project-labels'

function formatDays(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}天`
}

export function StageDurationEffortChart({
  stages,
  onFocus
}: {
  stages: CreationReportStageSummary[]
  onFocus(stageKey: StageTimeKey): void
}): React.JSX.Element {
  const values = stages.flatMap((stage) => [
    stage.averageDurationSegments === null ? 0 : stage.averageDurationSegments / 3,
    stage.averageActualEffortHalfDayUnits === null ? 0 : stage.averageActualEffortHalfDayUnits / 2
  ])
  const maximum = Math.max(1, ...values)
  const visible = stages.filter((stage) => stage.durationSampleCount || stage.actualEffortSampleCount)
  if (!visible.length) return <div className="report-chart-empty">至少记录一个阶段历时或实际投入后，才会显示对比。</div>
  return <div className="report-paired-bars" role="list" aria-label="阶段历时与实际投入对比">
    {visible.map((stage) => {
      const durationDays = (stage.averageDurationSegments ?? 0) / 3
      const effortDays = (stage.averageActualEffortHalfDayUnits ?? 0) / 2
      return <button role="listitem" key={stage.stageKey} onClick={() => onFocus(stage.stageKey)}>
        <b>{projectModuleLabels[stage.stageKey]}</b>
        <span className="report-bar-line"><small>平均历时</small><i><em style={{ width: `${Math.max(stage.durationSampleCount ? 2 : 0, durationDays / maximum * 100)}%` }} /></i><strong>{stage.averageDurationLabel ?? '—'}</strong></span>
        <span className="report-bar-line effort"><small>实际投入</small><i><em style={{ width: `${Math.max(stage.actualEffortSampleCount ? 2 : 0, effortDays / maximum * 100)}%` }} /></i><strong>{stage.averageActualEffortHalfDayUnits === null ? '—' : formatDays(effortDays)}</strong></span>
        <span className="report-bar-samples">{stage.durationSampleCount}个完整起止样本 · {stage.actualEffortSampleCount}次填写投入</span>
      </button>
    })}
  </div>
}
