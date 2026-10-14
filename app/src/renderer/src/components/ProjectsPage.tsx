import { ClassificationSelect, SavedClassificationControl } from './ClassificationFields'
import { FieldLabel, MonthDateLabel } from './FieldLabel'
import { projectStageColorTokens } from '../utils/project-stage-appearance'
import { ContentTypeSelect } from './ContentTypeSelect'
import { ContentTypeLabel } from './ContentTypeLabel'
import { AppSelect } from './AppSelect'
import { Check, ChevronDown, ChevronUp, Columns3, FileText, MoreHorizontal, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type ProjectSummary, type ScheduleItem } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { writeProjectDragData } from '../utils/project-drag'
import {
  projectColumnDefinition,
  readProjectTableLayout,
  writeProjectTableLayout,
  type ProjectTableColumnKey,
  type ProjectTableLayout
} from '../utils/project-table-columns'
import type { AppRoute } from '../utils/router'
import { navigate } from '../utils/router'
import { projectModuleLabels } from '../utils/project-labels'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { ProjectColumnManager } from './ProjectColumnManager'
import { ProjectContextMenu, type ProjectMenuTarget } from './ProjectContextMenu'
import { InlineRename } from './InlineRename'
import { ProjectPlatformControl, ProjectPlatformSummary } from './ProjectPlatformControl'

interface ProjectPropertyEditor {
  anchor: HTMLElement
  kind: 'deadline' | 'direction' | 'platforms'
  projectId: string
}

export function ProjectsPage({ route }: { route: AppRoute }): React.JSX.Element {
  const { projects, contentTypes, schedules, today, preferences } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('')
  const [videoFilter, setVideoFilter] = useState(''), [kindFilter, setKindFilter] = useState('')
  const [menu, setMenu] = useState<ProjectMenuTarget | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [propertyEditor, setPropertyEditor] = useState<ProjectPropertyEditor | null>(null)
  const [propertyBusy, setPropertyBusy] = useState(false)
  const [propertyError, setPropertyError] = useState('')
  const [columnManagerAnchor, setColumnManagerAnchor] = useState<HTMLElement | null>(null)
  const [tableLayout, setTableLayout] = useState<ProjectTableLayout>(readProjectTableLayout)
  const [deadlineSort, setDeadlineSort] = useState<'none' | 'ascending' | 'descending'>('none')
  const saveRename = (id: string, title: string): void => { void (async () => { try { await window.creatorOS?.renameProject(id, title); await refresh() } finally { setEditingId(null) } })() }
  const platforms = useMemo(() => [...new Set(['B站', '小红书', '抖音', '视频号', ...projects.flatMap((project) => project.platformTargets)])], [projects])
  const directionOptions = useMemo(() => contentTypes.filter((type) => type.isActive || type.id === route.contentTypeId), [contentTypes, route.contentTypeId])
  const filtered = useMemo(() => projects.filter((project) => {
    const lifecycleMatches = !project.trashedAt && project.topicStageRole === 'project_created'
    const typeMatches = !route.contentTypeId || project.contentTypeId === route.contentTypeId
    const queryMatches = !query.trim() || `${project.title}${project.description}`.toLowerCase().includes(query.trim().toLowerCase())
    const platformMatches = !platform || project.platformTargets.includes(platform)
    return lifecycleMatches && typeMatches && queryMatches && platformMatches && (!videoFilter || (project.videoFormat ?? 'undetermined') === videoFilter) && (!kindFilter || project.isCommercial === (kindFilter === 'commercial'))
  }), [platform, projects, query, route.contentTypeId, videoFilter, kindFilter])
  useEffect(() => {
    if (route.contentTypeId === 'type-commercial' || route.contentTypeId === 'type-quick') {
      if (route.contentTypeId === 'type-commercial') setKindFilter('commercial')
      else setVideoFilter('short')
      navigate({ page: 'projects' })
    }
  }, [route.contentTypeId])
  const selectedType = contentTypes.find((type) => type.id === route.contentTypeId)
  const editedProject = propertyEditor ? projects.find((project) => project.id === propertyEditor.projectId) ?? null : null
  const visibleColumnKeys = useMemo(() => tableLayout.order.filter((key) => !tableLayout.hidden.includes(key)), [tableLayout])
  const columnWidth = (key: ProjectTableColumnKey): number => {
    const definition = projectColumnDefinition(key)
    return Math.max(definition.minimumWidth, tableLayout.widths[key] ?? definition.defaultWidth)
  }
  const tableGrid = visibleColumnKeys.map((key) => `${columnWidth(key)}px`).join(' ')
  const tableWidth = visibleColumnKeys.reduce((sum, key) => sum + columnWidth(key), 0)
  const deadlineByProject = useMemo(() => {
    const result = new Map<string, ScheduleItem>()
    schedules.filter((item) => item.actionType === 'overview' && item.scheduleKind === 'hard_deadline' && item.startAt)
      .sort((left, right) => (left.startAt ?? '').localeCompare(right.startAt ?? ''))
      .forEach((item) => { if (item.projectId && !result.has(item.projectId)) result.set(item.projectId, item) })
    return result
  }, [schedules])
  const orderedProjects = useMemo(() => {
    if (deadlineSort === 'none') return filtered
    return [...filtered].sort((left, right) => {
      const leftDate = deadlineByProject.get(left.id)?.startAt ?? null
      const rightDate = deadlineByProject.get(right.id)?.startAt ?? null
      if (leftDate === null && rightDate === null) return 0
      if (leftDate === null) return 1
      if (rightDate === null) return -1
      return deadlineSort === 'ascending' ? leftDate.localeCompare(rightDate) : rightDate.localeCompare(leftDate)
    })
  }, [deadlineByProject, deadlineSort, filtered])

  const saveTableLayout = (next: ProjectTableLayout): void => {
    setTableLayout(next)
    writeProjectTableLayout(next)
  }

  const startColumnResize = (event: React.MouseEvent, key: ProjectTableColumnKey): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = columnWidth(key)
    const definition = projectColumnDefinition(key)
    const onMove = (moveEvent: MouseEvent): void => setTableLayout((current) => ({
      ...current,
      widths: { ...current.widths, [key]: Math.max(definition.minimumWidth, Math.round(startWidth + moveEvent.clientX - startX)) }
    }))
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-col-resizing')
      setTableLayout((current) => { writeProjectTableLayout(current); return current })
    }
    document.body.classList.add('is-col-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    if (!propertyEditor) return
    const close = (event: MouseEvent): void => {
      const target = event.target as Node
      if (propertyEditor.anchor.contains(target) || (target instanceof Element && target.closest('.project-list-property-popover, .project-list-date-popover'))) return
      setPropertyEditor(null)
      setPropertyError('')
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setPropertyEditor(null)
      setPropertyError('')
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [propertyEditor])

  const openPropertyEditor = (projectId: string, kind: ProjectPropertyEditor['kind'], anchor: HTMLElement): void => {
    setPropertyEditor((current) => current?.projectId === projectId && current.kind === kind ? null : { projectId, kind, anchor })
    setPropertyError('')
  }

  const changeContentType = async (projectId: string, contentTypeId: string): Promise<void> => {
    if (!window.creatorOS) return
    try {
      setPropertyBusy(true)
      setPropertyError('')
      await window.creatorOS.updateProjectContentType(projectId, contentTypeId)
      await refresh()
      setPropertyEditor(null)
    } catch (reason) {
      setPropertyError(reason instanceof Error ? reason.message : '内容方向修改失败')
    } finally {
      setPropertyBusy(false)
    }
  }

  const changePlatforms = async (projectId: string, next: string[]): Promise<void> => {
    if (!window.creatorOS || !editedProject) return
    try {
      setPropertyBusy(true)
      setPropertyError('')
      await window.creatorOS.updateProjectPlatforms(projectId, next)
      await refresh()
    } catch (reason) {
      setPropertyError(reason instanceof Error ? reason.message : '发布平台修改失败')
    } finally {
      setPropertyBusy(false)
    }
  }

  const changeDeadline = async (projectId: string, localDateValue: string | null): Promise<void> => {
    if (!window.creatorOS) return
    const existing = deadlineByProject.get(projectId)
    try {
      setPropertyBusy(true)
      setPropertyError('')
      if (!localDateValue) {
        if (existing) await window.creatorOS.deleteSchedule(existing.id)
      } else {
        const [year = 1970, month = 1, day = 1] = localDateValue.split('-').map(Number)
        const startAt = new Date(year, month - 1, day, 18, 0).toISOString()
        if (existing) await window.creatorOS.moveSchedule(existing.id, startAt, null)
        else await window.creatorOS.createSchedule({
          projectId,
          title: '目标日',
          actionType: 'overview',
          startAt,
          endAt: null,
          scheduleKind: 'hard_deadline',
          waitingFor: null
        })
      }
      await refresh()
      setPropertyEditor(null)
    } catch (reason) {
      setPropertyError(reason instanceof Error ? reason.message : '目标日修改失败')
    } finally {
      setPropertyBusy(false)
    }
  }

  const renderProjectCell = (project: ProjectSummary, key: ProjectTableColumnKey): React.JSX.Element => {
    if (key === 'project') return <div className="project-cell-title"><span className="project-color-dot" style={{ background: `var(--${project.colorToken})` }} />{editingId === project.id ? <InlineRename initialValue={project.title} ariaLabel={`重命名${project.title}`} className="project-title-rename" onSave={(value) => saveRename(project.id, value)} onCancel={() => setEditingId(null)} /> : <button draggable title="打开项目；也可以拖到侧栏常用" onDragStart={(event) => writeProjectDragData(event.dataTransfer, project.id)} onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: preferences.lastProjectModuleById[project.id] ?? 'overview' })}><b>{project.title}</b>{project.description.trim() ? <span>{project.description}</span> : null}</button>}</div>
    if (key === 'direction') return <button className="project-property-button" aria-expanded={propertyEditor?.projectId === project.id && propertyEditor.kind === 'direction'} aria-label={`更改${project.title}的内容方向，当前为${project.contentTypeName}`} onClick={(event) => openPropertyEditor(project.id, 'direction', event.currentTarget)}><ContentTypeLabel id={project.contentTypeId} name={project.contentTypeName} /></button>
    if (key === 'stage') return <button className="project-stage-link" aria-label={project.currentStageKey ? `打开${project.title}的${projectModuleLabels[project.currentStageKey]}阶段` : `打开${project.title}概览`} onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: project.currentStageKey ?? 'overview' })}><FieldLabel token={project.currentStageKey ? projectStageColorTokens[project.currentStageKey] : undefined} className="project-stage-label">{project.currentStageKey ? projectModuleLabels[project.currentStageKey] : project.progressPercent === 100 ? '全部完成' : '暂无阶段'}</FieldLabel><small>{project.progressPercent ?? 0}%</small></button>
    if (key === 'platforms') return <button className="project-property-button project-platform-button" aria-expanded={propertyEditor?.projectId === project.id && propertyEditor.kind === 'platforms'} aria-label={`更改${project.title}的发布平台`} onClick={(event) => openPropertyEditor(project.id, 'platforms', event.currentTarget)}><ProjectPlatformSummary platforms={project.platformTargets} /></button>
    if (key === 'deadline') return <button className="project-list-link-cell" aria-expanded={propertyEditor?.projectId === project.id && propertyEditor.kind === 'deadline'} aria-label={`修改${project.title}的目标日`} onClick={(event) => openPropertyEditor(project.id, 'deadline', event.currentTarget)}><MonthDateLabel compact value={deadlineByProject.get(project.id)?.startAt} empty="未设置" /></button>
    if (key === 'template') return <button className="project-list-link-cell" onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })}><FieldLabel>{project.appliedTemplateName ?? '从空白开始'}</FieldLabel></button>
    if (key === 'kind' || key === 'video') return <SavedClassificationControl dimension={key === 'kind' ? 'kind' : 'video'} name={project.title} videoFormat={project.videoFormat} isCommercial={project.isCommercial} onSave={async patch => { if (!window.creatorOS) throw new Error('App尚未准备好'); await window.creatorOS.updateProjectClassification(project.id, patch); await refresh() }} />
    if (key === 'updated') return <button className="project-list-link-cell" onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })}><MonthDateLabel compact value={project.updatedAt} empty="未设置" /></button>
    return <button className="icon-button project-menu-trigger" aria-label={`${project.title}更多操作`} onClick={(event) => setMenu({ project, anchor: event.currentTarget, view: 'active' })}><MoreHorizontal size={16} /></button>
  }

  return <main className="page projects-page">
    <header className="page-header"><div><h1>内容项目</h1>{selectedType ? <p>{`已筛选：${selectedType.name}`}</p> : null}</div></header>
    <section className="project-toolbar card">
      <ClassificationSelect dimension="video" filter value={videoFilter} onChange={setVideoFilter} label="筛选视频形式" /><ClassificationSelect dimension="kind" filter value={kindFilter} onChange={setKindFilter} label="筛选项目类型" />
      <label className="filter-select"><span className="visually-hidden">筛选内容方向</span><ContentTypeSelect aria-label="筛选内容方向" value={route.contentTypeId ?? ''} onChange={(event) => navigate({ page: 'projects', contentTypeId: event.currentTarget.value || undefined })}><option value="">全部方向</option>{directionOptions.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</ContentTypeSelect></label>
      <label className="filter-select"><span className="visually-hidden">筛选发布平台</span><AppSelect aria-label="筛选发布平台" value={platform} onChange={(event) => setPlatform(event.currentTarget.value)}><option value="">全部平台</option>{platforms.map((item) => <option value={item} key={item}>{item}</option>)}</AppSelect></label>
      <label className="table-search"><Search size={15} /><span className="visually-hidden">搜索内容项目</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索项目" /></label>
      <button className="secondary-action project-column-manage-trigger" aria-expanded={Boolean(columnManagerAnchor)} onClick={(event) => { const anchor = event.currentTarget; setColumnManagerAnchor((current) => current ? null : anchor) }}><Columns3 size={14} />管理列</button>
    </section>
    <section className="project-table card" aria-label="内容项目列表">
      <header className="project-table-row project-table-head" style={{ gridTemplateColumns: tableGrid, minWidth: `${tableWidth}px` }}>{visibleColumnKeys.map((key) => <span className="project-table-header-cell" aria-sort={key === 'deadline' ? deadlineSort : undefined} key={key}>{key === 'deadline'
        ? <button className={deadlineSort === 'none' ? '' : 'active'} aria-label={`按目标日${deadlineSort === 'ascending' ? '降序' : '升序'}排列`} onClick={() => setDeadlineSort((current) => current === 'none' ? 'ascending' : current === 'ascending' ? 'descending' : 'none')}>目标日{deadlineSort === 'ascending' ? <ChevronUp size={11} /> : deadlineSort === 'descending' ? <ChevronDown size={11} /> : null}</button>
        : projectColumnDefinition(key).label}<i role="separator" aria-orientation="vertical" aria-label={`拖拽调整${projectColumnDefinition(key).label}列宽`} onMouseDown={(event) => startColumnResize(event, key)} /></span>)}</header>
      {orderedProjects.map((project) => <article className="project-table-row" style={{ gridTemplateColumns: tableGrid, minWidth: `${tableWidth}px` }} key={project.id} onContextMenu={(event) => { event.preventDefault(); setMenu({ project, anchor: event.currentTarget, anchorPoint: { x: event.clientX, y: event.clientY }, view: 'active' }) }}>
        {visibleColumnKeys.map((key) => <div className={`project-table-cell project-table-cell-${key}`} key={key}>{renderProjectCell(project, key)}</div>)}
      </article>)}
      {filtered.length === 0 ? <div className="empty-state"><FileText size={26} /><b>没有正在推进的项目</b><span>新建项目，或在选题管理中把选题改为“已立项”。</span></div> : null}
    </section>
    {columnManagerAnchor ? <ProjectColumnManager anchor={columnManagerAnchor} layout={tableLayout} onChange={saveTableLayout} onClose={() => setColumnManagerAnchor(null)} /> : null}
    <AnchoredPopover anchor={propertyEditor?.kind === 'direction' ? propertyEditor.anchor : null} ariaLabel="更改内容方向" className="project-list-property-popover" role="menu" onDismiss={() => setPropertyEditor(null)}>
      <header><b>内容方向</b><span>点选后全项目同步</span></header>
      <div>{contentTypes.filter((type) => type.isActive || type.id === editedProject?.contentTypeId).map((type) => {
        const selected = type.id === editedProject?.contentTypeId
        return <button type="button" role="menuitemradio" aria-checked={selected} disabled={propertyBusy || !type.isActive} key={type.id} onClick={() => editedProject && void changeContentType(editedProject.id, type.id)}><ContentTypeLabel id={type.id} name={type.name} />{selected ? <Check size={14} /> : null}</button>
      })}</div>
      {propertyError ? <p role="alert">{propertyError}</p> : null}
    </AnchoredPopover>
    <AnchoredPopover anchor={propertyEditor?.kind === 'platforms' ? propertyEditor.anchor : null} ariaLabel="更改发布平台" className="project-list-property-popover" onDismiss={() => setPropertyEditor(null)}>
      <header><b>发布平台</b><span>圆点为主平台</span></header>
      {editedProject ? <ProjectPlatformControl platforms={editedProject.platformTargets} disabled={propertyBusy} onChange={(next) => void changePlatforms(editedProject.id, next)} /> : null}
      {propertyError ? <p role="alert">{propertyError}</p> : null}
    </AnchoredPopover>
    <AnchoredPopover anchor={propertyEditor?.kind === 'deadline' ? propertyEditor.anchor : null} ariaLabel="更改项目目标日" className="project-list-date-popover" onDismiss={() => setPropertyEditor(null)}>
      <header><b>目标日</b><span>与排期、选题双向同步</span></header>
      <CalendarDatePicker
        label="目标日"
        today={today}
        value={editedProject ? deadlineByProject.get(editedProject.id)?.startAt?.slice(0, 10) ?? null : null}
        onChange={(localDateValue) => editedProject && void changeDeadline(editedProject.id, localDateValue)}
      />
      {propertyBusy ? <p role="status">正在同步…</p> : propertyError ? <p role="alert">{propertyError}</p> : null}
    </AnchoredPopover>
    <ProjectContextMenu target={menu} onClose={() => setMenu(null)} onRename={(project) => setEditingId(project.id)} />
  </main>
}
