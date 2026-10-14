import { ChevronDown, LayoutGrid, PinOff, Settings, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectModuleKey, ProjectStageShortcutPreference, ProjectSummary, SidebarNavigationGroupPreference, SidebarNavigationItemId } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import {
  hasProjectDragData,
  readProjectDragData,
  writeProjectDragData
} from '../utils/project-drag'
import {
  hasProjectStageDragData,
  projectStageShortcutId,
  readProjectStageDragData,
  writeProjectStageDragData
} from '../utils/project-stage-drag'
import type { AppRoute } from '../utils/router'
import { navigate } from '../utils/router'
import { projectModuleLabels, projectStatusLabels } from '../utils/project-labels'
import { showStagePreview } from '../utils/stage-preview'
import { workspaceDestinationById } from '../utils/workspace-destinations'
import { AnchoredPopover } from './AnchoredPopover'
import { ProjectContextMenu, type ProjectMenuTarget } from './ProjectContextMenu'
import { InlineRename } from './InlineRename'

interface StageShortcutItem {
  id: string
  shortcut: ProjectStageShortcutPreference
  project: ProjectSummary
}

function CommonShortcutGroup({
  title,
  items,
  stageItems,
  lastModuleByProjectId,
  expanded,
  reorderable = false,
  activeProjectId,
  activeModuleKey,
  editingId,
  onToggle,
  onContext,
  onStageContext,
  onRename,
  onCancelRename,
  onDropProject,
  onDropStage
}: {
  title: '常用'
  items: ProjectSummary[]
  stageItems: StageShortcutItem[]
  lastModuleByProjectId: Record<string, ProjectModuleKey>
  expanded: boolean
  reorderable?: boolean
  activeProjectId?: string
  activeModuleKey?: ProjectModuleKey
  editingId: string | null
  onToggle(): void
  onContext(project: ProjectSummary, anchor: HTMLElement): void
  onStageContext(item: StageShortcutItem, anchor: HTMLElement): void
  onRename(id: string, title: string): void
  onCancelRename(): void
  onDropProject?(projectId: string, targetId: string | null, fromPinnedGroup: boolean): void
  onDropStage(shortcut: ProjectStageShortcutPreference, targetId: string | null, fromPinnedGroup: boolean): void
}): React.JSX.Element {
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null)
  const [projectDropTargetId, setProjectDropTargetId] = useState<string | null>(null)
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null)
  const [stageDropTargetId, setStageDropTargetId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const expandTimerRef = useRef<number | null>(null)

  const cancelExpandTimer = (): void => {
    if (expandTimerRef.current === null) return
    window.clearTimeout(expandTimerRef.current)
    expandTimerRef.current = null
  }
  useEffect(() => () => cancelExpandTimer(), [])
  useEffect(() => {
    if (expanded) cancelExpandTimer()
  }, [expanded])

  const acceptsProjectDrop = (event: React.DragEvent): boolean => reorderable && hasProjectDragData(event.dataTransfer)
  const acceptsStageDrop = (event: React.DragEvent): boolean => hasProjectStageDragData(event.dataTransfer)
  const acceptsDrop = (event: React.DragEvent): boolean => acceptsProjectDrop(event) || acceptsStageDrop(event)
  const resetDrag = (): void => {
    setDraggingProjectId(null)
    setProjectDropTargetId(null)
    setDraggingStageId(null)
    setStageDropTargetId(null)
    setDropActive(false)
    cancelExpandTimer()
  }
  const dropProject = (event: React.DragEvent, targetId: string | null): void => {
    if (!acceptsProjectDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    const projectId = readProjectDragData(event.dataTransfer)
    resetDrag()
    if (projectId) onDropProject?.(projectId, targetId, draggingProjectId === projectId)
  }
  const dropStage = (event: React.DragEvent, targetId: string | null): void => {
    if (!acceptsStageDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    const shortcut = readProjectStageDragData(event.dataTransfer)
    const sourceId = shortcut ? projectStageShortcutId(shortcut) : null
    resetDrag()
    if (shortcut) onDropStage(shortcut, targetId, draggingStageId === sourceId)
  }
  const dropShortcut = (event: React.DragEvent): void => {
    if (acceptsProjectDrop(event)) dropProject(event, null)
    else if (acceptsStageDrop(event)) dropStage(event, null)
  }
  const moveProjectByKeyboard = (projectId: string, delta: -1 | 1): void => {
    const index = items.findIndex((item) => item.id === projectId)
    const target = items[index + delta]
    if (!target) return
    onDropProject?.(projectId, delta < 0 ? target.id : items[index + 2]?.id ?? null, true)
  }
  const moveStageByKeyboard = (item: StageShortcutItem, delta: -1 | 1): void => {
    const index = stageItems.findIndex((candidate) => candidate.id === item.id)
    const target = stageItems[index + delta]
    if (!target) return
    onDropStage(item.shortcut, delta < 0 ? target.id : stageItems[index + 2]?.id ?? null, true)
  }
  const hasActiveStageShortcut = stageItems.some((item) => (
    item.shortcut.projectId === activeProjectId && item.shortcut.moduleKey === activeModuleKey
  ))

  return <section
    className={`project-shortcuts${dropActive ? ' drop-active' : ''}`}
    aria-label={`${title}，可拖入项目标题或项目阶段`}
    onDragEnter={(event) => {
      if (!acceptsDrop(event)) return
      event.preventDefault()
      setDropActive(true)
      if (!expanded && expandTimerRef.current === null) {
        expandTimerRef.current = window.setTimeout(() => {
          expandTimerRef.current = null
          onToggle()
        }, 450)
      }
    }}
    onDragOver={(event) => {
      if (!acceptsDrop(event)) return
      event.preventDefault()
      if (acceptsProjectDrop(event)) {
        event.dataTransfer.dropEffect = items.some((item) => item.id === readProjectDragData(event.dataTransfer)) ? 'move' : 'copy'
      } else {
        const shortcut = readProjectStageDragData(event.dataTransfer)
        event.dataTransfer.dropEffect = shortcut && stageItems.some((item) => item.id === projectStageShortcutId(shortcut)) ? 'move' : 'copy'
      }
    }}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropActive(false)
        cancelExpandTimer()
      }
    }}
    onDrop={dropShortcut}
  >
    <button className="sidebar-section-title" aria-expanded={expanded} onClick={onToggle}>
      <span>{title}</span>
      <ChevronDown className={expanded ? '' : 'collapsed'} size={12} />
    </button>
    {expanded ? <div className="project-shortcut-list">
      {items.map((project) => editingId === project.id
        ? <div className="project-shortcut editing" key={project.id}>
          <span className="project-dot" style={{ background: `var(--${project.colorToken})` }} />
          <InlineRename initialValue={project.title} ariaLabel={`重命名${project.title}`} className="shortcut-rename" onSave={(value) => onRename(project.id, value)} onCancel={onCancelRename} />
        </div>
        : <button
          className={`project-shortcut${activeProjectId === project.id && !hasActiveStageShortcut ? ' active' : ''}${draggingProjectId === project.id ? ' dragging' : ''}${projectDropTargetId === project.id ? ' drag-over' : ''}`}
          key={project.id}
          aria-label={project.title}
          title={`${project.title} · ${projectStatusLabels[project.status]} · 进度${project.progressPercent ?? 0}%${project.lastOpenedAt ? ` · 最近打开${new Date(project.lastOpenedAt).toLocaleDateString('zh-CN')}` : ''}${project.pendingExternalDrafts > 0 ? ` · ${project.pendingExternalDrafts}份外部稿待处理` : ''}（右键更多操作）`}
          draggable={reorderable}
          aria-keyshortcuts={reorderable ? 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
          onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: project.pendingExternalDrafts > 0 ? 'script' : lastModuleByProjectId[project.id] ?? 'overview' })}
          onContextMenu={(event) => {
            event.preventDefault()
            onContext(project, event.currentTarget)
          }}
          onDragStart={reorderable ? (event) => {
            setDraggingProjectId(project.id)
            writeProjectDragData(event.dataTransfer, project.id)
          } : undefined}
          onDragEnd={reorderable ? resetDrag : undefined}
          onDragOver={reorderable ? (event) => {
            if (!acceptsProjectDrop(event)) return
            event.preventDefault()
            event.stopPropagation()
            setProjectDropTargetId(project.id)
          } : undefined}
          onDragLeave={reorderable ? () => {
            if (projectDropTargetId === project.id) setProjectDropTargetId(null)
          } : undefined}
          onDrop={reorderable ? (event) => dropProject(event, project.id) : undefined}
          onKeyDown={reorderable ? (event) => {
            if (!event.altKey || !event.shiftKey) return
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveProjectByKeyboard(project.id, -1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveProjectByKeyboard(project.id, 1)
            }
          } : undefined}
        >
          <span className="project-dot" style={{ background: `var(--${project.colorToken})` }} />
          <span className="shortcut-name">{project.title}</span>
        </button>)}
      {stageItems.map((item) => {
        const label = projectModuleLabels[item.shortcut.moduleKey]
        const active = activeProjectId === item.shortcut.projectId && activeModuleKey === item.shortcut.moduleKey
        return <button
          className={`project-shortcut stage-shortcut${active ? ' active' : ''}${draggingStageId === item.id ? ' dragging' : ''}${stageDropTargetId === item.id ? ' drag-over' : ''}`}
          key={item.id}
          aria-label={`${item.project.title} · ${label}`}
          aria-current={active ? 'page' : undefined}
          aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
          title={`${item.project.title} · ${label}（右键移出常用）`}
          draggable
          onClick={() => navigate({ page: 'project', projectId: item.shortcut.projectId, moduleKey: item.shortcut.moduleKey })}
          onContextMenu={(event) => {
            event.preventDefault()
            onStageContext(item, event.currentTarget)
          }}
          onDragStart={(event) => {
            setDraggingStageId(item.id)
            writeProjectStageDragData(event.dataTransfer, item.shortcut)
          }}
          onDragEnd={resetDrag}
          onDragOver={(event) => {
            if (!acceptsStageDrop(event)) return
            event.preventDefault()
            event.stopPropagation()
            setStageDropTargetId(item.id)
          }}
          onDragLeave={() => {
            if (stageDropTargetId === item.id) setStageDropTargetId(null)
          }}
          onDrop={(event) => dropStage(event, item.id)}
          onKeyDown={(event) => {
            if (!event.altKey || !event.shiftKey) return
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveStageByKeyboard(item, -1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveStageByKeyboard(item, 1)
            }
          }}
        >
          <span className="project-dot" style={{ background: `var(--${item.project.colorToken})` }} />
          <span className="shortcut-name">{item.project.title}<small> · {label}</small></span>
        </button>
      })}
      {reorderable && items.length === 0 && stageItems.length === 0 ? <div className="project-shortcut-drop-hint">把项目或阶段拖到这里</div> : null}
    </div> : null}
  </section>
}

function SidebarNavigationGroup({ group, hiddenItemIds, route, onToggle, incomeGroup, onToggleIncome }: {
  group: SidebarNavigationGroupPreference
  hiddenItemIds: SidebarNavigationItemId[]
  route: AppRoute
  onToggle(): void
  incomeGroup?: SidebarNavigationGroupPreference
  onToggleIncome?(): void
}): React.JSX.Element | null {
  const destinations = group.itemIds
    .filter((id) => !hiddenItemIds.includes(id))
    .map((id) => workspaceDestinationById.get(id))
    .filter((destination) => destination !== undefined)
  if (!destinations.length && !(group.id === 'more' && incomeGroup)) return null
  return <section className="sidebar-navigation-group" aria-label={group.name}>
    <button className="sidebar-section-title" aria-expanded={group.expanded} onClick={onToggle}>
      <span>{group.name}</span>
      <ChevronDown className={group.expanded ? '' : 'collapsed'} size={12} />
    </button>
    {group.expanded ? <nav className="primary-nav" aria-label={`${group.name}导航`}>
      {destinations.map(({ id, label, route: destinationRoute, icon: Icon }) => {
        const page = destinationRoute.page
        const active = route.page === page || (page === 'projects' && route.page === 'project') || (page === 'tools' && route.page === 'content-engine')
        return <button key={id} className={`nav-item${active ? ' active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined} title={label} onClick={() => navigate(destinationRoute)}>
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
        </button>
      })}
      {group.id === 'more' && incomeGroup ? <IncomeNavigationEntry group={incomeGroup} route={route} onToggle={onToggleIncome ?? (() => {})} /> : null}
    </nav> : null}
  </section>
}

function IncomeNavigationEntry({ group, route, onToggle }: {
  group: SidebarNavigationGroupPreference
  route: AppRoute
  onToggle(): void
}): React.JSX.Element {
  const overview = workspaceDestinationById.get('income')
  const children = group.itemIds
    .map((id) => workspaceDestinationById.get(id))
    .filter((destination) => destination !== undefined)
  const inIncome = route.page === 'income' || route.page === 'business' || route.page === 'other-income'
  const OverviewIcon = overview?.icon
  return <div className={`income-nav-cluster${inIncome ? ' context-active' : ''}`} role="group" aria-label="收入台账">
    <div className={`nav-item income-nav-parent${route.page === 'income' ? ' active' : ''}`}>
      <button className="income-nav-main" aria-current={route.page === 'income' ? 'page' : undefined} onClick={() => navigate({ page: 'income' })}>
        {OverviewIcon ? <OverviewIcon size={18} strokeWidth={1.8} /> : null}<span>收入台账</span>
      </button>
      <button className="income-nav-toggle" aria-label={`${group.expanded ? '收起' : '展开'}收入台账`} aria-expanded={group.expanded} onClick={onToggle}>
        <ChevronDown className={group.expanded ? '' : 'collapsed'} size={13} />
      </button>
    </div>
    {group.expanded ? <div className="income-nav-children">
      {children.map(({ id, label, route: destinationRoute, icon: Icon }) => {
        const active = route.page === destinationRoute.page
        return <button key={id} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={label} title={label} onClick={() => navigate(destinationRoute)}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
        </button>
      })}
    </div> : null}
  </div>
}

export function Sidebar({ route }: { route: AppRoute }): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.snapshot.projects)
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [menu, setMenu] = useState<ProjectMenuTarget | null>(null)
  const [stageMenu, setStageMenu] = useState<{ item: StageShortcutItem; anchor: HTMLElement } | null>(null)
  const [sidebarStageDropActive, setSidebarStageDropActive] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const openContext = (project: ProjectSummary, anchor: HTMLElement): void => setMenu({ project, anchor, view: 'active' })
  const saveRename = (id: string, title: string): void => {
    void (async () => {
      try {
        await window.creatorOS?.renameProject(id, title)
        await refresh()
      } finally {
        setEditingId(null)
      }
    })()
  }
  const activeProjects = useMemo(
    () => projects.filter((project) => project.topicStageRole === 'project_created' && !project.trashedAt),
    [projects]
  )
  const pinned = useMemo(() => {
    const order = new Map(preferences.pinnedProjectOrder.map((id, index) => [id, index]))
    return activeProjects.filter((project) => project.isPinned).sort((a, b) => {
      const aOrder = order.get(a.id)
      const bOrder = order.get(b.id)
      if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER)
      return (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '')
    })
  }, [activeProjects, preferences.pinnedProjectOrder])
  const pinnedStages = useMemo(() => {
    const projectById = new Map(activeProjects.map((project) => [project.id, project]))
    return preferences.pinnedProjectStages.flatMap<StageShortcutItem>((shortcut) => {
      const project = projectById.get(shortcut.projectId)
      if (!project || shortcut.moduleKey === 'feedback' || (shortcut.moduleKey as string) === 'business') return []
      if (shortcut.moduleKey !== 'versions' && !project.enabledModuleKeys.some((key) => key === shortcut.moduleKey)) return []
      return [{ id: projectStageShortcutId(shortcut), shortcut, project }]
    })
  }, [activeProjects, preferences.pinnedProjectStages])
  const reorderPinned = (projectId: string, targetId: string | null, fromPinnedGroup: boolean): void => {
    const project = activeProjects.find((item) => item.id === projectId)
    if (!project) return
    if (project.isPinned && !fromPinnedGroup) {
      showStagePreview(`“${project.title}”已在常用中`)
      return
    }
    const currentOrder = pinned.map((item) => item.id)
    const orderedIds = pinned.map((item) => item.id).filter((id) => id !== projectId)
    const targetIndex = targetId ? orderedIds.indexOf(targetId) : orderedIds.length
    orderedIds.splice(targetIndex < 0 ? orderedIds.length : targetIndex, 0, projectId)
    if (project.isPinned && orderedIds.every((id, index) => id === currentOrder[index])) {
      showStagePreview(`“${project.title}”已在常用中`)
      return
    }
    void (async () => {
      try {
        if (!project.isPinned) await window.creatorOS?.setProjectPinned(projectId, true)
        await setPreferences({ pinnedProjectOrder: orderedIds })
        await refresh()
        showStagePreview(project.isPinned ? '已调整常用顺序' : `已把“${project.title}”加入常用`)
      } catch (cause) {
        await refresh()
        showStagePreview(cause instanceof Error ? cause.message : '常用保存失败')
      }
    })()
  }
  const reorderPinnedStage = (shortcut: ProjectStageShortcutPreference, targetId: string | null, fromPinnedGroup: boolean): void => {
    const project = activeProjects.find((item) => item.id === shortcut.projectId)
    const available = project && shortcut.moduleKey !== 'feedback' && (shortcut.moduleKey as string) !== 'business'
      && (shortcut.moduleKey === 'versions' || project.enabledModuleKeys.some((key) => key === shortcut.moduleKey))
    if (!available) {
      showStagePreview('这个项目阶段当前不可用')
      return
    }
    const shortcutId = projectStageShortcutId(shortcut)
    const current = preferences.pinnedProjectStages
    const existing = current.some((item) => projectStageShortcutId(item) === shortcutId)
    if (existing && !fromPinnedGroup) {
      showStagePreview(`“${project.title} · ${projectModuleLabels[shortcut.moduleKey]}”已在常用中`)
      return
    }
    const next = current.filter((item) => projectStageShortcutId(item) !== shortcutId)
    const targetIndex = targetId ? next.findIndex((item) => projectStageShortcutId(item) === targetId) : next.length
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, shortcut)
    if (existing && next.every((item, index) => projectStageShortcutId(item) === projectStageShortcutId(current[index]!))) {
      showStagePreview(`“${project.title} · ${projectModuleLabels[shortcut.moduleKey]}”已在常用中`)
      return
    }
    void (async () => {
      try {
        await setPreferences({ pinnedProjectStages: next })
        showStagePreview(existing ? '已调整常用顺序' : `已把“${project.title} · ${projectModuleLabels[shortcut.moduleKey]}”加入常用`)
      } catch (cause) {
        showStagePreview(cause instanceof Error ? cause.message : '常用保存失败')
      }
    })()
  }
  const removePinnedStage = (shortcut: ProjectStageShortcutPreference): void => {
    const next = preferences.pinnedProjectStages.filter((item) => projectStageShortcutId(item) !== projectStageShortcutId(shortcut))
    setStageMenu(null)
    void (async () => {
      try {
        await setPreferences({ pinnedProjectStages: next })
        showStagePreview('已移出常用')
      } catch (cause) {
        showStagePreview(cause instanceof Error ? cause.message : '常用保存失败')
      }
    })()
  }
  const toggleNavigationGroup = (groupId: string): void => {
    const groups = preferences.sidebarLayout.groups.map((group) => group.id === groupId ? { ...group, expanded: !group.expanded } : group)
    void setPreferences({ sidebarLayout: { ...preferences.sidebarLayout, groups } })
  }
  const incomeGroup = preferences.sidebarLayout.groups.find((group) => group.id === 'income')

  return (
    <aside
      className={`sidebar${sidebarStageDropActive ? ' stage-drop-active' : ''}`}
      onDragEnter={(event) => {
        if (!hasProjectStageDragData(event.dataTransfer)) return
        event.preventDefault()
        setSidebarStageDropActive(true)
      }}
      onDragOver={(event) => {
        if (!hasProjectStageDragData(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!sidebarStageDropActive) setSidebarStageDropActive(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSidebarStageDropActive(false)
      }}
      onDrop={(event) => {
        if (!hasProjectStageDragData(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        const shortcut = readProjectStageDragData(event.dataTransfer)
        setSidebarStageDropActive(false)
        if (shortcut) reorderPinnedStage(shortcut, null, false)
      }}
    >
      {sidebarStageDropActive ? <div className="stage-shortcut-sidebar-drop" aria-hidden="true"><b>松开加入常用</b><span>会保存当前项目和这个阶段</span></div> : null}
      <div className="brand-row"><span className="brand-avatar">LY</span><strong>Creator OS</strong></div>
      <button className="workspace-switch" aria-label="自媒体工作区" onClick={() => showStagePreview('当前只有一个本地工作区')}><LayoutGrid className="workspace-icon" size={16} /><span>自媒体工作区</span><ChevronDown size={13} /></button>
      <div className="sidebar-scroll">
        {preferences.sidebarLayout.groups.filter((group) => group.id !== 'income').map((group) => <SidebarNavigationGroup
          key={group.id}
          group={group}
          hiddenItemIds={preferences.sidebarLayout.hiddenItemIds}
          route={route}
          onToggle={() => toggleNavigationGroup(group.id)}
          incomeGroup={group.id === 'more' ? incomeGroup : undefined}
          onToggleIncome={() => toggleNavigationGroup('income')}
        />)}
        <CommonShortcutGroup
          title="常用"
          items={pinned}
          stageItems={pinnedStages}
          lastModuleByProjectId={preferences.lastProjectModuleById}
          expanded={preferences.sidebarPinnedExpanded}
          reorderable
          activeProjectId={route.projectId}
          activeModuleKey={route.moduleKey}
          editingId={editingId}
          onToggle={() => void setPreferences({ sidebarPinnedExpanded: !preferences.sidebarPinnedExpanded })}
          onContext={openContext}
          onStageContext={(item, anchor) => setStageMenu({ item, anchor })}
          onRename={saveRename}
          onCancelRename={() => setEditingId(null)}
          onDropProject={reorderPinned}
          onDropStage={reorderPinnedStage}
        />
      </div>
      <div className="sidebar-footer">
        <button className={`settings-link${route.page === 'recycle' ? ' active' : ''}`} aria-label="回收站" onClick={() => navigate({ page: 'recycle' })}><Trash2 size={18} /><span>回收站</span></button>
        <button className={`settings-link${route.page === 'settings' ? ' active' : ''}`} aria-label="设置" onClick={() => navigate({ page: 'settings' })}><Settings size={18} /><span>设置</span></button>
        <div className="user-tile"><span className="user-avatar">LY</span><span><b>LY</b><small>本地工作区</small></span></div>
      </div>
      <ProjectContextMenu target={menu} onClose={() => setMenu(null)} onRename={(project) => setEditingId(project.id)} />
      {stageMenu ? <AnchoredPopover anchor={stageMenu.anchor} role="menu" ariaLabel={`${stageMenu.item.project.title} · ${projectModuleLabels[stageMenu.item.shortcut.moduleKey]}的操作`} className="project-context-menu" onDismiss={() => setStageMenu(null)}>
        <button role="menuitem" onClick={() => removePinnedStage(stageMenu.item.shortcut)}><PinOff size={13} />移出常用</button>
      </AnchoredPopover> : null}
    </aside>
  )
}
