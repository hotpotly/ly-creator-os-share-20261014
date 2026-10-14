import { CalendarDays, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ProjectDetail, ProjectModule, ProjectModuleKey, StageTimeKey } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { formatStageDateRange } from '../utils/stage-date-range'
import { writeProjectStageDragData } from '../utils/project-stage-drag'
import { ProjectStageIcon } from './ProjectStageIcon'
import { projectStageStyle } from '../utils/project-stage-appearance'
import { ProjectTodos } from './ProjectTodos'
import { AnchoredPopover } from './AnchoredPopover'

const entries: Partial<Record<ProjectModuleKey, string>> = {
  materials: '资料与真实体验', outline: '打开当前大纲', script: '打开文案工作台',
  shooting: '拍摄清单与素材', editing: '剪辑备注与工程', postproduction: '字幕与封面', publishing: '发布信息', production: '查看合并历史与内容'
}

export function ProjectStageWorkspace({ project, onEditStage, onComplete, onStart, onOpen }: {
  project: ProjectDetail
  onEditStage(key: StageTimeKey, anchor: HTMLElement): void
  onStart(key: StageTimeKey): Promise<void>
  onComplete(module: ProjectModule): Promise<void>
  onOpen(key: ProjectModuleKey): void
}): React.JSX.Element {
  const todos = useWorkspaceStore(state => state.snapshot.todos)
  const [columns, setColumns] = useState('2')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<{ module: ProjectModule; anchor: HTMLElement } | null>(null)
  const [confirmation, setConfirmation] = useState<ProjectModule | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingStart = useRef(false)
  const modules = project.modules.filter(module => module.enabled && !['overview', 'business', 'versions', 'production', 'feedback'].includes(module.key)).sort((a, b) => a.position - b.position)
  const secondary = project.modules.filter(module => module.enabled && ['versions', 'business'].includes(module.key))
  const activeModules = modules.filter(module => !module.completedAt && project.stageTimeRecords.some(record => record.stageKey === module.key && record.startedAt && record.status !== 'skipped'))
  const hiddenLinks = todos.filter(todo => todo.projectId === project.id && todo.source === 'manual' && todo.status !== 'dismissed' && todo.stageKey !== 'production' && (!todo.stageKey || !modules.some(module => module.key === todo.stageKey)))
  const complete = async (module: ProjectModule): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await onComplete(module); setConfirmation(null) } finally { setBusy(false) }
  }
  const start = async (module: ProjectModule): Promise<void> => {
    if (pendingStart.current) return
    pendingStart.current = true; setBusy(true); setError('')
    try { await onStart(module.key as StageTimeKey); setMenu(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '阶段开始失败，请重试') }
    finally { pendingStart.current = false; setBusy(false) }
  }
  const canStart = (module: ProjectModule): boolean => !module.completedAt && !project.stageTimeRecords.some(record => record.stageKey === module.key && (record.startedAt || record.status !== 'not_started'))
  return <div className="project-stage-workspace">
    <header className="stage-workspace-heading"><div><h2>项目阶段</h2>{activeModules.length ? <small>{`进行中：${activeModules.map(module => projectModuleLabels[module.key]).join('、')}`}</small> : null}</div><div className="stage-workspace-tools">{secondary.map(module => <button className="stage-workspace-secondary-link" key={module.key} onClick={() => onOpen(module.key)}><ProjectStageIcon stageKey={module.key} size={14} />{projectModuleLabels[module.key]}{module.completedAt ? ' · 已完成' : ''}</button>)}<div className="segmented" role="group" aria-label="阶段列数">{[['auto', '自适应'], ['2', '两列'], ['3', '三列']].map(([value, label]) => <button key={value} aria-pressed={columns === value} className={columns === value ? 'active' : ''} onClick={() => setColumns(value!)}>{label}</button>)}</div></div></header>
    <section className="project-stage-grid" data-columns={columns} aria-label="同页项目阶段">
      {modules.map(module => {
        const record = project.stageTimeRecords.find(record => record.stageKey === module.key)
        const open = expanded[module.key] ?? !module.completedAt
        const active = !module.completedAt && record?.status !== 'skipped' && Boolean(record?.startedAt)
        const hasPlan = Boolean(record?.plannedStartedAt || record?.plannedCompletedAt)
        const hasActual = Boolean(record?.startedAt || record?.completedAt)
        return <article className="project-stage-card" key={module.key} data-stage-key={module.key} data-active={active || undefined} data-status={module.completedAt ? 'completed' : active ? 'active' : 'idle'} style={projectStageStyle(module.key)}>
          <header><button className="stage-card-title" draggable onDragStart={event => writeProjectStageDragData(event.dataTransfer, { projectId: project.id, moduleKey: module.key as StageTimeKey })} onClick={() => setExpanded({ ...expanded, [module.key]: !open })} aria-expanded={open}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="stage-card-identity"><ProjectStageIcon stageKey={module.key} size={18} /></span><h3>{projectModuleLabels[module.key]}</h3></button><button className="stage-card-status" aria-label={`${projectModuleLabels[module.key]}阶段状态`} aria-haspopup="menu" aria-expanded={menu?.module.key === module.key} onClick={event => { setError(''); setMenu({ module, anchor: event.currentTarget }) }}>{module.completedAt ? '已完成' : record?.status === 'skipped' ? '已跳过' : record?.startedAt ? '进行中' : '未开始'}<ChevronDown size={11} /></button><button aria-label={`${projectModuleLabels[module.key]}阶段操作`} onClick={event => { setError(''); setMenu({ module, anchor: event.currentTarget }) }}><MoreHorizontal size={16} /></button></header>
          <div className="stage-card-dates">
            {hasActual ? <button className="stage-date-actual" aria-label={`修改${projectModuleLabels[module.key]}实际日期`} onClick={event => onEditStage(module.key as StageTimeKey, event.currentTarget)}><CalendarDays size={13} /><span>实际</span><strong>{formatStageDateRange(record?.startedAt ?? null, record?.completedAt ?? null)}</strong></button> : null}
            {hasPlan ? <button className="stage-date-planned" aria-label={`修改${projectModuleLabels[module.key]}计划日期`} onClick={event => onEditStage(module.key as StageTimeKey, event.currentTarget)}><CalendarDays size={13} /><span>计划</span><strong>{formatStageDateRange(record?.plannedStartedAt ?? null, record?.plannedCompletedAt ?? null)}</strong></button> : null}
            {!hasActual && !hasPlan ? <button className="stage-card-set-time" aria-label={`修改${projectModuleLabels[module.key]}阶段时间`} onClick={event => onEditStage(module.key as StageTimeKey, event.currentTarget)}><CalendarDays size={13} />设置阶段时间</button> : null}
          </div>
          {open ? <ProjectTodos project={project} stageKey={module.key as StageTimeKey} compact /> : <button className="stage-card-expand" onClick={() => setExpanded({ ...expanded, [module.key]: true })}>展开待办记录</button>}
          <button className="stage-card-content" onClick={() => onOpen(module.key)}>{entries[module.key] ?? '打开阶段内容'}<ChevronRight size={14} /></button>
        </article>
      })}
    </section>
    {!modules.length ? <p className="stage-workspace-empty">还没有启用阶段，可从项目操作中管理阶段模块。</p> : null}
    {hiddenLinks.length ? <details className="stage-workspace-secondary"><summary>未指定或已隐藏阶段的待办 · {hiddenLinks.length}条</summary><ProjectTodos project={project} unassignedOnly /></details> : null}
    {menu ? <AnchoredPopover anchor={menu.anchor} role="menu" ariaLabel="阶段操作" onDismiss={() => setMenu(null)} className="stage-card-menu">{canStart(menu.module) ? <button role="menuitem" disabled={busy} onClick={() => void start(menu.module)}>{busy ? '正在开始…' : '现在开始'}</button> : null}<button role="menuitem" disabled={busy} onClick={() => { onEditStage(menu.module.key as StageTimeKey, menu.anchor); setMenu(null) }}>{canStart(menu.module) ? '选择开始日期…' : '修改阶段时间'}</button><button role="menuitem" disabled={busy} onClick={() => { setConfirmation(menu.module); setMenu(null) }}>{menu.module.completedAt ? '重新打开阶段' : '完成阶段'}</button>{error ? <p role="alert" className="stage-card-menu-error">{error}</p> : null}</AnchoredPopover> : null}
    {confirmation ? <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="确认阶段状态"><h2>{confirmation.completedAt ? '重新打开' : '完成'}{projectModuleLabels[confirmation.key]}阶段？</h2><p>此操作只改变阶段，不会勾选或重新打开待办。</p><p>当前还有{todos.filter(todo => todo.projectId === project.id && todo.stageKey === confirmation.key && todo.status === 'open').length}条待办未完成。</p><footer><button disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button disabled={busy} className="primary-action" onClick={() => void complete(confirmation)}>确认{confirmation.completedAt ? '重新打开' : '完成阶段'}</button></footer></section></div> : null}
  </div>
}
