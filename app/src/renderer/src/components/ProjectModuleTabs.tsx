import { Check } from 'lucide-react'
import type { ProjectModule, StageTimeKey, StageTimeRecord } from '../../../shared/domain'
import { writeProjectStageDragData } from '../utils/project-stage-drag'
import { navigate } from '../utils/router'
import { projectModuleLabels } from '../utils/project-labels'

export function ProjectModuleTabs({
  projectId,
  modules,
  stageTimeRecords,
  activeModuleKey,
  activeModule,
  onEditStage,
  onToggleCompleted
}: {
  projectId: string
  modules: ProjectModule[]
  stageTimeRecords: StageTimeRecord[]
  activeModuleKey: ProjectModule['key']
  activeModule: ProjectModule | null
  onEditStage(stageKey: StageTimeKey, anchor: HTMLElement): void
  onToggleCompleted(module: ProjectModule): void
}): React.JSX.Element {
  const contentModules = modules.filter((module) => module.key !== 'business')
  const amountModule = modules.find((module) => module.key === 'business') ?? null
  const moduleButton = (module: ProjectModule): React.JSX.Element => {
    const stageRecord = stageTimeRecords.find((record) => record.stageKey === module.key)
    const editStage = (anchor: HTMLElement): void => {
      if (stageRecord) onEditStage(stageRecord.stageKey, anchor)
    }
    return <button
      type="button"
      className={`project-tab${activeModuleKey === module.key ? ' active' : ''}${module.completedAt ? ' done' : ''}`}
      aria-current={activeModuleKey === module.key ? 'page' : undefined}
      key={module.key}
      draggable={module.key !== 'business'}
      title={module.key === 'business' ? undefined : `${stageRecord ? '右键修改阶段时间；' : ''}拖到左侧常用`}
      onClick={() => navigate({ page: 'project', projectId, moduleKey: module.key })}
      onDragStart={(event) => {
        if (module.key !== 'overview' && module.key !== 'business') writeProjectStageDragData(event.dataTransfer, { projectId, moduleKey: module.key })
      }}
      onContextMenu={stageRecord ? (event) => {
        event.preventDefault()
        editStage(event.currentTarget)
      } : undefined}
      onKeyDown={stageRecord ? (event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        event.preventDefault()
        editStage(event.currentTarget)
      } : undefined}
    >
      {stageRecord ? <span className={`project-tab-state${module.completedAt ? ' done' : ''}`}>{module.completedAt ? <Check size={9} strokeWidth={3} /> : null}</span> : null}
      {projectModuleLabels[module.key]}
    </button>
  }
  return <div className="project-tab-bar">
    <nav className="project-tabs" aria-label="项目阶段">{contentModules.map(moduleButton)}</nav>
    {amountModule ? <nav className="project-tabs project-tabs-amount" aria-label="项目金额">{moduleButton(amountModule)}</nav> : null}
    {activeModule ? <button
      type="button"
      aria-label={activeModule.completedAt ? '取消当前阶段完成' : '标记当前阶段完成'}
      aria-pressed={Boolean(activeModule.completedAt)}
      className={`project-stage-complete${activeModule.completedAt ? ' done' : ''}`}
      onClick={() => onToggleCompleted(activeModule)}
      title={activeModule.completedAt ? '取消当前阶段完成' : '标记当前阶段完成'}
    ><Check size={14} strokeWidth={3} /></button> : null}
  </div>
}
