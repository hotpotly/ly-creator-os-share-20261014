export type ProjectTone = 'moss' | 'blue' | 'amber' | 'rose' | 'plum'
export type ProjectId = 'ios' | 'ssd' | 'ai-browser' | 'desktop' | 'sponsor'

export interface ProjectDefinition {
  id: ProjectId
  title: string
  shortTitle: string
  tone: ProjectTone
}

export const projects: Record<ProjectId, ProjectDefinition> = {
  ios: { id: 'ios', title: 'iOS 27第一周体验', shortTitle: 'iOS 27', tone: 'amber' },
  ssd: { id: 'ssd', title: '随身SSD横评', shortTitle: 'SSD横评', tone: 'moss' },
  'ai-browser': { id: 'ai-browser', title: 'AI浏览器入门教学', shortTitle: 'AI浏览器', tone: 'blue' },
  desktop: { id: 'desktop', title: '桌面改造计划', shortTitle: '桌面改造', tone: 'plum' },
  sponsor: { id: 'sponsor', title: '无线麦克风商单', shortTitle: '麦克风', tone: 'rose' }
}

export interface ActionItemData {
  id: string
  projectId: ProjectId
  type: string
  meta: string[]
  action: string
  urgent?: boolean
}

export interface ScheduleEventData {
  id: string
  title: string
  projectId: ProjectId
  date: string
  time?: string
  hardDeadline?: boolean
  state?: 'done' | 'waiting'
}

export const TODAY = new Date('2026-07-18T12:00:00+08:00')

export const actions: ActionItemData[] = [
  {
    id: 'ios-outline',
    projectId: 'ios',
    type: '手机系统测评',
    meta: ['截止今天18:00', '等待对象：我', '目标平台：B站/小红书'],
    action: '确认大纲',
    urgent: true
  },
  {
    id: 'ssd-testing',
    projectId: 'ssd',
    type: '数码长视频',
    meta: ['截止明天', '还差2项读写实测', '目标平台：B站'],
    action: '补充实测结果'
  },
  {
    id: 'ai-script',
    projectId: 'ai-browser',
    type: 'AI教学',
    meta: ['周一发布', '资料已齐', '协作档位：AI先行'],
    action: '对比双模型'
  }
]

export const scheduleEvents: ScheduleEventData[] = [
  { id: 'e1', title: '资料整理', projectId: 'desktop', date: '2026-07-01', state: 'done' },
  { id: 'e2', title: '测试计划', projectId: 'ssd', date: '2026-07-03' },
  { id: 'e3', title: '整理大纲', projectId: 'ai-browser', date: '2026-07-06' },
  { id: 'e4', title: '等甲方确认', projectId: 'sponsor', date: '2026-07-08', state: 'waiting' },
  { id: 'e5', title: '补拍', projectId: 'desktop', date: '2026-07-10' },
  { id: 'e6', title: '体验记录', projectId: 'ios', date: '2026-07-12', state: 'done' },
  { id: 'e7', title: '持续写入', projectId: 'ssd', date: '2026-07-13' },
  { id: 'e8', title: '双模型文案', projectId: 'ai-browser', date: '2026-07-15' },
  { id: 'e9', title: '客户初审', projectId: 'sponsor', date: '2026-07-16', state: 'waiting' },
  { id: 'e10', title: '封面候选', projectId: 'desktop', date: '2026-07-17' },
  { id: 'e11', title: '大纲截止', projectId: 'ios', date: '2026-07-18', time: '18:00', hardDeadline: true },
  { id: 'e12', title: '补实测', projectId: 'ssd', date: '2026-07-18' },
  { id: 'e13', title: '对比文案', projectId: 'ai-browser', date: '2026-07-18' },
  { id: 'e14', title: '拍摄', projectId: 'ssd', date: '2026-07-19' },
  { id: 'e15', title: '计划发布', projectId: 'ios', date: '2026-07-20', hardDeadline: true },
  { id: 'e16', title: '计划发布', projectId: 'ai-browser', date: '2026-07-20', hardDeadline: true },
  { id: 'e17', title: '剪辑', projectId: 'desktop', date: '2026-07-21' },
  { id: 'e18', title: '终审截止', projectId: 'sponsor', date: '2026-07-23', hardDeadline: true },
  { id: 'e19', title: '发布包', projectId: 'desktop', date: '2026-07-25' },
  { id: 'e20', title: '整理终稿', projectId: 'ssd', date: '2026-07-27' },
  { id: 'e21', title: '场景草稿', projectId: 'ai-browser', date: '2026-07-29' }
]

export const pinnedProjects = [
  { projectId: 'ios' as const, meta: '大纲' },
  { projectId: 'ai-browser' as const, meta: '文案' }
]

export const recentProjects = [
  { projectId: 'ssd' as const, meta: '资料' },
  { projectId: 'desktop' as const, meta: '制作' },
  { projectId: 'sponsor' as const, meta: '反馈2' }
]

export const confirmations = [
  { icon: '文', title: '双模型文案已完成', projectId: 'ai-browser' as const, action: '去对比' },
  { icon: '封', title: '4组封面文字候选', projectId: 'desktop' as const, action: '去选择' }
]
