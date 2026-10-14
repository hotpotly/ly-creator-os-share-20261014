import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectSummary, WorkspacePreferences, WorkspaceTabState } from '../../../shared/domain'
import type { AppRoute } from '../utils/router'
import { parseRoute, ROUTE_REPLACED_EVENT, routeHref, routeTitle } from '../utils/router'

const HOME_TAB: WorkspaceTabState = { id: 'workspace-home', history: ['#/home'], historyIndex: 0, lastUsedAt: '' }
const MAX_TABS = 8

export interface WorkspaceTabView extends WorkspaceTabState {
  label: string
  active: boolean
}

interface Options {
  enabled: boolean
  hydrated: boolean
  preferences: WorkspacePreferences
  projects: ProjectSummary[]
  persist(patch: Partial<WorkspacePreferences>): Promise<WorkspacePreferences>
  notify(message: string): void
}

function normalizedHref(value: string): string { return routeHref(parseRoute(value)) }
function currentHref(tab: WorkspaceTabState): string { return tab.history[tab.historyIndex] ?? '#/home' }

function normalizeTabs(preferences: WorkspacePreferences): { tabs: WorkspaceTabState[]; activeId: string } {
  const ids = new Set<string>()
  const tabs = preferences.workspaceTabs.slice(0, MAX_TABS).flatMap((tab) => {
    if (!tab.id || ids.has(tab.id) || tab.history.length === 0) return []
    ids.add(tab.id)
    const history = tab.history.slice(-40).map(normalizedHref)
    const historyIndex = Math.max(0, Math.min(tab.historyIndex - Math.max(0, tab.history.length - history.length), history.length - 1))
    return [{ ...tab, history, historyIndex }]
  })
  if (tabs.length === 0) tabs.push(HOME_TAB)
  return { tabs, activeId: tabs.some((tab) => tab.id === preferences.activeWorkspaceTabId) ? preferences.activeWorkspaceTabId : tabs[0]!.id }
}

function newTabId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function useWorkspaceTabs({ enabled, hydrated, preferences, projects, persist, notify }: Options): {
  tabs: WorkspaceTabView[]
  activeTabId: string
  canGoBack: boolean
  canGoForward: boolean
  sidebarCollapsed: boolean
  switchTab(id: string): void
  closeTab(id: string): void
  reorderTab(id: string, targetId: string): void
  addTab(route: AppRoute): void
  goBack(): void
  goForward(): void
  toggleSidebar(): void
} {
  const [tabs, setTabs] = useState<WorkspaceTabState[]>([HOME_TAB])
  const [activeTabId, setActiveTabId] = useState(HOME_TAB.id)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const tabsRef = useRef(tabs)
  const activeRef = useRef(activeTabId)
  const readyRef = useRef(false)
  const navigationModeRef = useRef<'switch' | 'history' | 'new' | null>(null)

  const commitTabs = useCallback((next: WorkspaceTabState[]): void => {
    tabsRef.current = next
    setTabs(next)
  }, [])
  const commitActive = useCallback((id: string): void => {
    activeRef.current = id
    setActiveTabId(id)
  }, [])
  const setHash = useCallback((href: string, mode: 'switch' | 'history' | 'new'): void => {
    navigationModeRef.current = mode
    if (window.location.hash === href) window.dispatchEvent(new HashChangeEvent('hashchange'))
    else window.location.hash = href
  }, [])

  useEffect(() => {
    if (!enabled || !hydrated || readyRef.current) return
    const normalized = normalizeTabs(preferences)
    const initialHref = routeHref(parseRoute())
    const active = normalized.tabs.find((tab) => tab.id === normalized.activeId) ?? normalized.tabs[0]!
    let nextTabs = normalized.tabs
    if (initialHref !== '#/home' && currentHref(active) !== initialHref) {
      nextTabs = normalized.tabs.map((tab) => tab.id === active.id ? {
        ...tab, history: [...tab.history.slice(0, tab.historyIndex + 1), initialHref].slice(-40),
        historyIndex: Math.min(tab.historyIndex + 1, 39), lastUsedAt: new Date().toISOString()
      } : tab)
    }
    tabsRef.current = nextTabs; activeRef.current = active.id; readyRef.current = true
    const restored = currentHref(nextTabs.find((tab) => tab.id === active.id) ?? active)
    if (initialHref === '#/home' && restored !== initialHref) setHash(restored, 'switch')
    queueMicrotask(() => { commitTabs(nextTabs); commitActive(active.id); setSidebarCollapsed(preferences.sidebarCollapsed) })
  }, [commitActive, commitTabs, enabled, hydrated, preferences, setHash])

  useEffect(() => {
    if (!enabled) return
    const recordRoute = (): void => {
      if (!readyRef.current) return
      const href = routeHref(parseRoute())
      if (navigationModeRef.current) { navigationModeRef.current = null; return }
      const activeId = activeRef.current
      const next = tabsRef.current.map((tab) => {
        if (tab.id !== activeId || currentHref(tab) === href) return tab
        const history = [...tab.history.slice(0, tab.historyIndex + 1), href].slice(-40)
        return { ...tab, history, historyIndex: history.length - 1, lastUsedAt: new Date().toISOString() }
      })
      commitTabs(next)
    }
    window.addEventListener('hashchange', recordRoute)
    return () => window.removeEventListener('hashchange', recordRoute)
  }, [commitTabs, enabled])

  useEffect(() => {
    if (!enabled) return
    const replaceCurrentRoute = (): void => {
      if (!readyRef.current) return
      const href = routeHref(parseRoute())
      const activeId = activeRef.current
      commitTabs(tabsRef.current.map((tab) => {
        if (tab.id !== activeId || currentHref(tab) === href) return tab
        const history = [...tab.history]
        history[tab.historyIndex] = href
        return { ...tab, history, lastUsedAt: new Date().toISOString() }
      }))
    }
    window.addEventListener(ROUTE_REPLACED_EVENT, replaceCurrentRoute)
    return () => window.removeEventListener(ROUTE_REPLACED_EVENT, replaceCurrentRoute)
  }, [commitTabs, enabled])

  useEffect(() => {
    if (!enabled || !readyRef.current) return
    const timer = window.setTimeout(() => {
      void persist({ workspaceTabs: tabs, activeWorkspaceTabId: activeTabId, sidebarCollapsed })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [activeTabId, enabled, persist, sidebarCollapsed, tabs])

  const switchTab = useCallback((id: string): void => {
    const tab = tabsRef.current.find((item) => item.id === id)
    if (!tab) return
    const next = tabsRef.current.map((item) => item.id === id ? { ...item, lastUsedAt: new Date().toISOString() } : item)
    commitTabs(next); commitActive(id); setHash(currentHref(tab), 'switch')
  }, [commitActive, commitTabs, setHash])

  const closeTab = useCallback((id: string): void => {
    if (tabsRef.current.length <= 1) return
    const index = tabsRef.current.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = tabsRef.current.filter((tab) => tab.id !== id)
    commitTabs(next)
    if (activeRef.current !== id) return
    const fallback = next[Math.min(index, next.length - 1)] ?? next[0]!
    commitActive(fallback.id); setHash(currentHref(fallback), 'switch')
  }, [commitActive, commitTabs, setHash])

  const addTab = useCallback((route: AppRoute): void => {
    const href = routeHref(route)
    const existing = tabsRef.current.find((tab) => currentHref(tab) === href)
    if (existing) {
      const next = tabsRef.current.map((item) => item.id === existing.id ? { ...item, lastUsedAt: new Date().toISOString() } : item)
      commitTabs(next); commitActive(existing.id); setHash(href, 'switch')
      return
    }
    if (tabsRef.current.length >= MAX_TABS) { notify('最多同时打开8个工作区标签'); return }
    const tab: WorkspaceTabState = { id: newTabId(), history: [href], historyIndex: 0, lastUsedAt: new Date().toISOString() }
    commitTabs([...tabsRef.current, tab]); commitActive(tab.id); setHash(href, 'new')
  }, [commitActive, commitTabs, notify, setHash])

  const reorderTab = useCallback((id: string, targetId: string): void => {
    if (id === targetId) return
    const next = [...tabsRef.current]
    const sourceIndex = next.findIndex((tab) => tab.id === id); const targetIndex = next.findIndex((tab) => tab.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = next.splice(sourceIndex, 1)
    if (!moved) return
    next.splice(targetIndex, 0, moved); commitTabs(next)
  }, [commitTabs])

  const moveHistory = useCallback((delta: -1 | 1): void => {
    const activeId = activeRef.current
    const tab = tabsRef.current.find((item) => item.id === activeId)
    if (!tab) return
    const historyIndex = tab.historyIndex + delta
    if (historyIndex < 0 || historyIndex >= tab.history.length) return
    const next = tabsRef.current.map((item) => item.id === activeId ? { ...item, historyIndex, lastUsedAt: new Date().toISOString() } : item)
    commitTabs(next); setHash(tab.history[historyIndex]!, 'history')
  }, [commitTabs, setHash])

  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!
  const views = useMemo(() => tabs.map((tab): WorkspaceTabView => {
    const route = parseRoute(currentHref(tab))
    const project = projects.find((item) => item.id === route.projectId)
    return { ...tab, label: routeTitle(route, project?.title), active: tab.id === activeTabId }
  }), [activeTabId, projects, tabs])

  return {
    tabs: views, activeTabId,
    canGoBack: active.historyIndex > 0,
    canGoForward: active.historyIndex < active.history.length - 1,
    sidebarCollapsed,
    switchTab, closeTab, reorderTab, addTab,
    goBack: () => moveHistory(-1), goForward: () => moveHistory(1),
    toggleSidebar: () => setSidebarCollapsed((value) => !value)
  }
}
