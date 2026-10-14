import { TodoCopyNotice } from './components/TodoCarryover'
import { ReviewPage } from './features/reviews/ReviewPage'
import { TodoStageStartPrompt } from './components/TodoStageStartPrompt'
import { ScheduleCompanionWindow } from './components/ScheduleCompanionWindow'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { CaptureWindow } from './components/CaptureWindow'
import { BusinessLedgerPage } from './components/BusinessLedgerPage'
import { ContentEnginePage } from './components/ContentEnginePage'
import { DistributionPage } from './components/DistributionPage'
import { HomePage } from './components/HomePage'
import { IncomeLedgerOverviewPage, OtherIncomePage } from './components/IncomeLedgerPages'
import { IdeasPage } from './components/IdeasPage'
import { GlobalSearchDialog } from './components/GlobalSearchDialog'
import { NewProjectDialog } from './components/NewProjectDialog'
import { ProjectDetailPage } from './components/ProjectDetailPage'
import { ProjectsPage } from './components/ProjectsPage'
import { RecyclePage } from './components/RecyclePage'
import { ReportsPage } from './components/ReportsPage'
import { ScriptWorkbench } from './components/ScriptWorkbench'
import { Sidebar } from './components/Sidebar'
import { TasksDrawer } from './components/TasksDrawer'
import { TopicManagementPage } from './components/TopicManagementPage'
import { TodoCompanionWindow } from './components/TodoCompanionWindow'
import { Topbar } from './components/Topbar'
import { WorkspaceTabBar } from './components/WorkspaceTabBar'
import { useWorkspaceTabs } from './hooks/useWorkspaceTabs'
import { ResourcesPage, SchedulePage, SettingsPage, ToolsPage } from './components/WorkspacePages'
import { useWorkspaceStore } from './store/workspace'
import type { AppearanceSnapshot, VisualStyle } from '../../shared/domain'
import { applyAppearance, readCachedAppearance } from './utils/appearance'
import { navigate, parseRoute, ROUTE_REPLACED_EVENT, routeBreadcrumbItems } from './utils/router'
import { showStagePreview, STAGE_PREVIEW_EVENT } from './utils/stage-preview'
import { shouldRefreshWorkspaceClock } from '../../shared/domain/workspace-clock'

function isCaptureRoute(): boolean { return decodeURIComponent(window.location.hash.slice(1)).startsWith('/capture') }
function todoCompanionMode(): 'tray' | 'widget' | null {
  const hash = decodeURIComponent(window.location.hash.slice(1))
  return hash.startsWith('/todo-tray') ? 'tray' : hash.startsWith('/todo-widget') ? 'widget' : null
}

const SIDEBAR_MIN_WIDTH = 184
const SIDEBAR_MAX_WIDTH = 340
const SIDEBAR_DEFAULT_WIDTH = 220
function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export function App(): React.JSX.Element { return <><AppContent /><TodoStageStartPrompt /><TodoCopyNotice /></> }

function AppContent(): React.JSX.Element {
  const captureRoute = isCaptureRoute()
  const todoMode = todoCompanionMode()
  const scheduleMode = window.location.hash.startsWith('#/schedule-tray')
  const standaloneRoute = captureRoute || todoMode !== null || scheduleMode
  const [route, setRoute] = useState(parseRoute)
  const [appearance, setAppearance] = useState<AppearanceSnapshot>(readCachedAppearance)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newTopicOpen, setNewTopicOpen] = useState(false)
  const [otherIncomeCreateRequested, setOtherIncomeCreateRequested] = useState(false)
  const [stageNotice, setStageNotice] = useState('')
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [sidebarPreviewWidth, setSidebarPreviewWidth] = useState<number | null>(null)
  const undoPendingRef = useRef(false)
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const hydrated = useWorkspaceStore((state) => state.hydrated)
  const hydrate = useWorkspaceStore((state) => state.hydrate)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const workspaceNavigation = useWorkspaceTabs({
    enabled: !standaloneRoute, hydrated, preferences: snapshot.preferences, projects: snapshot.projects,
    persist: setPreferences, notify: showStagePreview
  })

  const isDark = appearance.theme === 'dark'
  const sidebarWidth = sidebarPreviewWidth ?? clampSidebarWidth(snapshot.preferences.sidebarWidth)
  const effectiveSidebarWidth = viewportWidth <= 680 ? 56 : viewportWidth <= 1180 ? 64 : sidebarWidth
  useEffect(() => { applyAppearance(appearance) }, [appearance])
  useEffect(() => { document.title = captureRoute ? '快速记录' : todoMode ? '今日待办' : scheduleMode ? '排期速览' : 'LY Creator OS' }, [captureRoute, todoMode, scheduleMode])
  useEffect(() => {
    const updateViewportWidth = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])
  useEffect(() => {
    if (captureRoute) return
    void hydrate().then((workspace) => {
      if (!window.creatorOS) return
      setAppearance({
        theme: workspace.preferences.theme,
        visualStyle: workspace.preferences.visualStyle
      })
    })
    const onHashChange = (): void => setRoute(parseRoute())
    const unsubscribeData = window.creatorOS?.onWorkspaceChanged(() => { void refresh() })
    const unsubscribeAppearance = window.creatorOS?.onAppearanceChanged(setAppearance)
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener(ROUTE_REPLACED_EVENT, onHashChange)
    return () => {
      unsubscribeData?.()
      unsubscribeAppearance?.()
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener(ROUTE_REPLACED_EVENT, onHashChange)
    }
  }, [captureRoute, hydrate, refresh])

  useEffect(() => {
    if (captureRoute) return
    const timer = window.setInterval(() => {
      if (shouldRefreshWorkspaceClock(snapshot.today, snapshot.captureSummary.creativeDay)) void refresh()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [captureRoute, refresh, snapshot.captureSummary.creativeDay, snapshot.today])

  useEffect(() => {
    let timeout: number | undefined
    const showNotice = (event: Event): void => {
      const message = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : ''
      if (!message) return
      window.clearTimeout(timeout); setStageNotice(message)
      timeout = window.setTimeout(() => setStageNotice(''), 2600)
    }
    window.addEventListener(STAGE_PREVIEW_EVENT, showNotice)
    return () => { window.clearTimeout(timeout); window.removeEventListener(STAGE_PREVIEW_EVENT, showNotice) }
  }, [])

  useEffect(() => {
    if (standaloneRoute) return
    const toggleSidebarShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'b') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      event.preventDefault(); workspaceNavigation.toggleSidebar()
    }
    window.addEventListener('keydown', toggleSidebarShortcut)
    return () => window.removeEventListener('keydown', toggleSidebarShortcut)
  }, [standaloneRoute, workspaceNavigation])

  useEffect(() => {
    if (standaloneRoute) return
    const openGlobalSearch = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setGlobalSearchOpen((value) => !value)
    }
    window.addEventListener('keydown', openGlobalSearch)
    return () => window.removeEventListener('keydown', openGlobalSearch)
  }, [standaloneRoute])

  useEffect(() => {
    if (standaloneRoute || route.page === 'ideas' || route.page === 'workbench') return
    const undoWorkspaceOperation = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      event.preventDefault()
      if (!window.creatorOS || undoPendingRef.current) return
      undoPendingRef.current = true
      void window.creatorOS.getWorkspaceUndoState()
        .then(async (state) => {
          if (!state.canUndo || !state.operationId) {
            showStagePreview('当前没有可撤销的操作')
            return
          }
          await window.creatorOS!.undoWorkspaceOperation(state.operationId)
          await refresh()
          showStagePreview(`已撤销：${state.label ?? '上一步操作'}`)
        })
        .catch((reason: unknown) => {
          showStagePreview(reason instanceof Error ? reason.message : '撤销失败')
        })
        .finally(() => { undoPendingRef.current = false })
    }
    window.addEventListener('keydown', undoWorkspaceOperation)
    return () => window.removeEventListener('keydown', undoWorkspaceOperation)
  }, [refresh, route.page, standaloneRoute])

  useEffect(() => {
    if (standaloneRoute) return
    return window.creatorOS?.onScheduleNavigate((day) => navigate({ page: 'schedule', anchorDate: day }))
  }, [standaloneRoute])

  if (captureRoute) return <CaptureWindow />
  if (todoMode) return <TodoCompanionWindow mode={todoMode} />
  if (scheduleMode) return <ScheduleCompanionWindow />
  if (route.page === 'workbench' && route.projectId) return <><ScriptWorkbench key={`${route.projectId}:${route.draftVersionId ?? 'current'}:${route.workbenchMode ?? 'remembered'}`} projectId={route.projectId} draftVersionId={route.draftVersionId} requestedMode={route.workbenchMode} />{globalSearchOpen ? <GlobalSearchDialog onClose={() => setGlobalSearchOpen(false)} /> : null}</>

  const toggleTheme = (): void => {
    setAppearance((value) => {
      const theme = value.theme === 'dark' ? 'light' : 'dark'
      void setPreferences({ theme })
      return { ...value, theme }
    })
  }
  const setVisualStyle = (visualStyle: VisualStyle): void => {
    setAppearance((value) => ({ ...value, visualStyle }))
    void setPreferences({ visualStyle })
  }
  const openCapture = (): void => {
    if (window.creatorOS) void window.creatorOS.openCapture(route.projectId)
    else window.open(`${window.location.origin}${window.location.pathname}#/capture`, '_blank', 'width=420,height=300')
  }
  const persistSidebarWidth = (width: number): void => {
    const nextWidth = clampSidebarWidth(width)
    setSidebarPreviewWidth(nextWidth)
    void setPreferences({ sidebarWidth: nextWidth }).finally(() => setSidebarPreviewWidth(null))
  }
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (window.innerWidth <= 1180) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (moveEvent: PointerEvent): void => {
      setSidebarPreviewWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    }
    const finish = (finishEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-sidebar-resizing')
      persistSidebarWidth(startWidth + finishEvent.clientX - startX)
    }
    document.body.classList.add('is-sidebar-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return
    event.preventDefault()
    if (event.key === 'Home') {
      persistSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
      return
    }
    const step = event.shiftKey ? 24 : 8
    persistSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? step : -step))
  }
  const projectTitle = snapshot.projects.find((project) => project.id === route.projectId)?.title
  const content = route.page === 'ideas' ? <IdeasPage route={route} />
    : route.page === 'reviews' ? <ReviewPage route={route} />
    : route.page === 'reports' ? <ReportsPage route={route} />
    : route.page === 'topics' ? <TopicManagementPage key={route.topicId ?? 'topics'} newTopicOpen={newTopicOpen} onNewTopicOpenChange={setNewTopicOpen} highlightedTopicId={route.topicId} />
      : route.page === 'projects' ? <ProjectsPage route={route} />
      : route.page === 'income' ? <IncomeLedgerOverviewPage />
      : route.page === 'business' ? <BusinessLedgerPage key={route.projectId ?? 'business-ledger'} highlightedProjectId={route.projectId} />
      : route.page === 'other-income' ? <OtherIncomePage createRequested={otherIncomeCreateRequested} onCreateHandled={() => setOtherIncomeCreateRequested(false)} />
      : route.page === 'project' && route.projectId ? <ProjectDetailPage projectId={route.projectId} moduleKey={route.moduleKey ?? 'overview'} />
        : route.page === 'tools' ? <ToolsPage />
          : route.page === 'content-engine' ? <ContentEnginePage />
          : route.page === 'distribution' ? <DistributionPage />
          : route.page === 'schedule' ? <SchedulePage projectId={route.projectId} anchorDate={route.anchorDate} />
            : route.page === 'resources' ? <ResourcesPage highlightedResourceId={route.resourceId} />
              : route.page === 'recycle' ? <RecyclePage />
              : route.page === 'settings' ? <SettingsPage section={route.settingsSection} appearance={appearance} onToggleTheme={toggleTheme} onSetVisualStyle={setVisualStyle} />
                : <HomePage />

  return <div
    className={`app-shell${workspaceNavigation.sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
    style={{ '--sidebar-width': `${effectiveSidebarWidth}px` } as CSSProperties}
  >
    <Sidebar route={route} />
    {!workspaceNavigation.sidebarCollapsed ? <div
      className="sidebar-resize-handle"
      role="separator"
      aria-label="拖拽调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={sidebarWidth}
      tabIndex={0}
      onPointerDown={startSidebarResize}
      onKeyDown={resizeSidebarWithKeyboard}
      onDoubleClick={() => persistSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
    /> : null}
    <div className="app-main">
      <WorkspaceTabBar tabs={workspaceNavigation.tabs} canGoBack={workspaceNavigation.canGoBack} canGoForward={workspaceNavigation.canGoForward} sidebarCollapsed={workspaceNavigation.sidebarCollapsed} onSwitchTab={workspaceNavigation.switchTab} onCloseTab={workspaceNavigation.closeTab} onReorderTab={workspaceNavigation.reorderTab} onAddTab={workspaceNavigation.addTab} onGoBack={workspaceNavigation.goBack} onGoForward={workspaceNavigation.goForward} onToggleSidebar={workspaceNavigation.toggleSidebar} />
      <Topbar isDark={isDark} tasksOpen={tasksOpen} searchOpen={globalSearchOpen} breadcrumbItems={routeBreadcrumbItems(route, projectTitle)} onToggleTheme={toggleTheme} onOpenCapture={openCapture} onOpenSearch={() => setGlobalSearchOpen(true)} primaryActionLabel={route.page === 'topics' ? '新建选题' : route.page === 'business' ? '新增商单' : route.page === 'income' || route.page === 'other-income' ? '新增其他收入' : '新建项目'} onPrimaryAction={() => {
        if (route.page === 'topics') setNewTopicOpen(true)
        else if (route.page === 'business') window.dispatchEvent(new CustomEvent('creator-os:open-business-income-editor'))
        else if (route.page === 'income' || route.page === 'other-income') {
          setOtherIncomeCreateRequested(true)
          navigate({ page: 'other-income' })
        } else setNewProjectOpen(true)
      }} onToggleTasks={() => setTasksOpen((value) => !value)} />
      {content}
    </div>
    <TasksDrawer open={tasksOpen} onClose={() => setTasksOpen(false)} />
    <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    {globalSearchOpen ? <GlobalSearchDialog onClose={() => setGlobalSearchOpen(false)} /> : null}
    {stageNotice ? <div className="stage-toast" role="status">{stageNotice}</div> : null}
  </div>
}
