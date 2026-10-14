import type { CreationReportKind, ProjectModuleKey, StageTimeKey } from '../../../shared/domain'

export type AppPage = 'home' | 'reviews' | 'reports' | 'ideas' | 'topics' | 'projects' | 'income' | 'business' | 'other-income' | 'project' | 'workbench' | 'tools' | 'content-engine' | 'distribution' | 'schedule' | 'resources' | 'recycle' | 'settings'
export type IdeaQueueRoute = 'inbox' | 'review' | 'processed'
export type WorkbenchRequestedMode = 'conversation' | 'comparison' | 'drafts' | 'materials' | 'versions'
export const ROUTE_REPLACED_EVENT = 'creator-os-route-replaced'

export interface AppRoute {
  reviewView?: 'period' | 'experiences' | 'daily'
  reviewEntryId?: string
  settingsSection?: 'templates'
  page: AppPage
  projectId?: string
  moduleKey?: ProjectModuleKey
  contentTypeId?: string
  draftVersionId?: string
  workbenchMode?: WorkbenchRequestedMode
  topicId?: string
  captureId?: string
  queue?: IdeaQueueRoute
  resourceId?: string
  reportMode?: 'period' | 'project'
  reportKind?: CreationReportKind
  anchorDate?: string
  snapshotId?: string
  focusedStageKey?: StageTimeKey
  source?: 'period' | 'project'
}

export function parseRoute(hash = window.location.hash): AppRoute {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, ''))
  if (!raw || raw === 'home') return { page: 'home' }
  if (raw.startsWith('capture')) return { page: 'home' }
  const [path, query = ''] = raw.split('?')
  const parts = (path ?? '').split('/').filter(Boolean)
  const params = new URLSearchParams(query)
  if (parts[0] === 'project' && parts[1]) return { page: 'project', projectId: parts[1], moduleKey: (parts[2] as ProjectModuleKey | undefined) ?? 'overview' }
  if (parts[0] === 'workbench' && parts[1]) {
    const requestedMode = params.get('mode')
    return {
      page: 'workbench',
      projectId: parts[1],
      draftVersionId: params.get('draft') ?? undefined,
      workbenchMode: ['conversation', 'comparison', 'drafts', 'materials', 'versions'].includes(requestedMode ?? '')
        ? requestedMode as WorkbenchRequestedMode
        : undefined
    }
  }
  if (parts[0] === 'projects' && params.get('status') === 'business') return { page: 'business', projectId: params.get('project') ?? undefined }
  if (parts[0] === 'projects' && params.get('status') === 'archived') return { page: 'topics' }
  if (parts[0] === 'projects' && params.get('status') === 'trash') return { page: 'recycle' }
  if (parts[0] === 'projects') return { page: 'projects', contentTypeId: params.get('type') ?? undefined }
  if (parts[0] === 'ideas') {
    const queue = params.get('queue')
    return {
      page: 'ideas',
      contentTypeId: params.get('type') ?? undefined,
      projectId: params.get('project') ?? undefined,
      captureId: params.get('capture') ?? undefined,
      queue: queue === 'inbox' || queue === 'review' || queue === 'processed' ? queue : undefined
    }
  }
  if (parts[0] === 'settings') return { page: 'settings', ...(params.get('section') === 'templates' ? { settingsSection: 'templates' as const } : {}) }
  if (parts[0] === 'topics') return { page: 'topics', topicId: params.get('topic') ?? undefined }
  if (parts[0] === 'income') return { page: 'income' }
  if (parts[0] === 'business') return { page: 'business', projectId: params.get('project') ?? undefined }
  if (parts[0] === 'other-income') return { page: 'other-income' }
  if (parts[0] === 'reviews') return { page: 'reviews', reportKind: params.get('kind') === 'weekly' ? 'weekly' : 'monthly', anchorDate: params.get('anchor') ?? undefined, reviewView: params.get('view') === 'daily' ? 'daily' : params.get('view') === 'experiences' ? 'experiences' : 'period', reviewEntryId: params.get('entry') ?? undefined }
  if (parts[0] === 'reports') {
    const mode = params.get('mode')
    const kind = params.get('kind')
    const focus = params.get('focus')
    const source = params.get('source')
    return {
      page: 'reports',
      reportMode: mode === 'project' ? 'project' : 'period',
      reportKind: kind === 'monthly' ? 'monthly' : 'weekly',
      anchorDate: params.get('anchor') ?? undefined,
      projectId: params.get('project') ?? undefined,
      snapshotId: params.get('snapshot') ?? undefined,
      focusedStageKey: ['materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'versions'].includes(focus ?? '') ? focus as StageTimeKey : undefined,
      source: source === 'project' ? 'project' : source === 'period' ? 'period' : undefined
    }
  }
  if (parts[0] === 'resources') return { page: 'resources', resourceId: params.get('resource') ?? undefined }
  if (parts[0] === 'schedule') return { page: 'schedule', projectId: params.get('project') ?? undefined, anchorDate: /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : undefined }
  if (['topics', 'income', 'business', 'other-income', 'tools', 'content-engine', 'distribution', 'resources', 'recycle', 'settings'].includes(parts[0] ?? '')) return { page: parts[0] as AppPage }
  return { page: 'home' }
}

export function routeHref(route: AppRoute): string {
  if (route.page === 'settings' && route.settingsSection) return '#/settings?section=templates'
  if (route.page === 'home') return '#/home'
  if (route.page === 'project' && route.projectId) return `#/project/${encodeURIComponent(route.projectId)}/${route.moduleKey ?? 'overview'}`
  if (route.page === 'workbench' && route.projectId) {
    const params = new URLSearchParams()
    if (route.draftVersionId) params.set('draft', route.draftVersionId)
    if (route.workbenchMode) params.set('mode', route.workbenchMode)
    return `#/workbench/${encodeURIComponent(route.projectId)}${params.size ? `?${params}` : ''}`
  }
  if (route.page === 'projects') {
    const params = new URLSearchParams()
    if (route.contentTypeId) params.set('type', route.contentTypeId)
    return `#/projects${params.size ? `?${params}` : ''}`
  }
  if (route.page === 'ideas') {
    const params = new URLSearchParams()
    if (route.contentTypeId) params.set('type', route.contentTypeId)
    if (route.projectId) params.set('project', route.projectId)
    if (route.captureId) params.set('capture', route.captureId)
    if (route.queue) params.set('queue', route.queue)
    return `#/ideas${params.size ? `?${params}` : ''}`
  }
  if (route.page === 'topics') return `#/topics${route.topicId ? `?topic=${encodeURIComponent(route.topicId)}` : ''}`
  if (route.page === 'income') return '#/income'
  if (route.page === 'business') return `#/business${route.projectId ? `?project=${encodeURIComponent(route.projectId)}` : ''}`
  if (route.page === 'other-income') return '#/other-income'
  if (route.page === 'reviews') {
    const params = new URLSearchParams({ kind: route.reportKind ?? 'monthly' })
    if (route.anchorDate) params.set('anchor', route.anchorDate)
    if (route.reviewView) params.set('view', route.reviewView)
    if (route.reviewEntryId) params.set('entry', route.reviewEntryId)
    return `#/reviews?${params}`
  }
  if (route.page === 'reports') {
    const params = new URLSearchParams()
    params.set('mode', route.reportMode ?? 'period')
    params.set('kind', route.reportKind ?? 'weekly')
    if (route.anchorDate) params.set('anchor', route.anchorDate)
    if (route.projectId) params.set('project', route.projectId)
    if (route.snapshotId) params.set('snapshot', route.snapshotId)
    if (route.focusedStageKey) params.set('focus', route.focusedStageKey)
    if (route.source) params.set('source', route.source)
    return `#/reports?${params}`
  }
  if (route.page === 'resources') return `#/resources${route.resourceId ? `?resource=${encodeURIComponent(route.resourceId)}` : ''}`
  if (route.page === 'schedule') {
    const params = new URLSearchParams()
    if (route.projectId) params.set('project', route.projectId)
    if (route.anchorDate) params.set('date', route.anchorDate)
    return `#/schedule${params.size ? `?${params}` : ''}`
  }
  return `#/${route.page}`
}

export function navigate(route: AppRoute): void {
  const href = routeHref(route)
  if (window.location.hash === href) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else window.location.hash = href
}

export function replaceRoute(route: AppRoute): void {
  const href = routeHref(route)
  if (window.location.hash === href) return
  window.history.replaceState(null, '', href)
  window.dispatchEvent(new CustomEvent(ROUTE_REPLACED_EVENT, { detail: href }))
}

export function routeBreadcrumb(route: AppRoute, projectTitle?: string): string {
  if (route.page === 'project') return `工作区 / 内容项目 / ${projectTitle ?? routeTitle(route)}`
  if (route.page === 'workbench') return `工作区 / ${projectTitle ?? routeTitle(route)}`
  return `工作区 / ${routeTitle(route, projectTitle)}`
}

export interface RouteBreadcrumbItem {
  label: string
  route: AppRoute | null
}

export function routeBreadcrumbItems(route: AppRoute, projectTitle?: string): RouteBreadcrumbItem[] {
  const workspace: RouteBreadcrumbItem = { label: '工作区', route: { page: 'home' } }
  if (route.page === 'project') return [
    workspace,
    { label: '内容项目', route: { page: 'projects' } },
    { label: projectTitle ?? routeTitle(route), route: null }
  ]
  if (route.page === 'workbench') return [
    workspace,
    { label: '内容项目', route: { page: 'projects' } },
    { label: projectTitle ?? '项目详情', route: route.projectId ? { page: 'project', projectId: route.projectId, moduleKey: 'overview' } : null },
    { label: '文案工作台', route: null }
  ]
  if (route.page === 'business' || route.page === 'other-income') return [
    workspace,
    { label: '收入台账', route: { page: 'income' } },
    { label: routeTitle(route, projectTitle), route: null }
  ]
  return [workspace, { label: routeTitle(route, projectTitle), route: null }]
}

export function routeTitle(route: AppRoute, projectTitle?: string): string {
  const labels: Record<AppPage, string> = {
    home: '首页', reviews: '计划与复盘', reports: '创作报表', ideas: '灵感库', topics: '选题管理', projects: '内容项目', income: '收入台账', business: '商单收入', 'other-income': '其他收入', project: '项目详情', workbench: '文案工作台',
    tools: '创作工具', 'content-engine': 'AI选题筛选', distribution: '批量分发', schedule: '排期', resources: '资源', recycle: '回收站', settings: '设置'
  }
  return (route.page === 'project' || route.page === 'workbench') && projectTitle ? projectTitle : labels[route.page]
}
