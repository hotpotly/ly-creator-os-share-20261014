export type ProjectTableColumnKey =
  | 'project'
  | 'direction'
  | 'video'
  | 'stage'
  | 'platforms'
  | 'deadline'
  | 'template'
  | 'kind'
  | 'updated'
  | 'operation'

export interface ProjectTableColumnDefinition {
  key: ProjectTableColumnKey
  label: string
  defaultWidth: number
  minimumWidth: number
  defaultVisible: boolean
  required?: boolean
}

export interface ProjectTableLayout {
  order: ProjectTableColumnKey[]
  hidden: ProjectTableColumnKey[]
  widths: Partial<Record<ProjectTableColumnKey, number>>
}

export const PROJECT_TABLE_COLUMNS: ProjectTableColumnDefinition[] = [
  { key: 'project', label: '项目', defaultWidth: 270, minimumWidth: 180, defaultVisible: true, required: true },
  { key: 'direction', label: '内容方向', defaultWidth: 138, minimumWidth: 90, defaultVisible: true },
  { key: 'video', label: '视频形式', defaultWidth: 112, minimumWidth: 92, defaultVisible: true },
  { key: 'stage', label: '当前阶段', defaultWidth: 148, minimumWidth: 100, defaultVisible: true },
  { key: 'platforms', label: '发布平台', defaultWidth: 240, minimumWidth: 130, defaultVisible: true },
  { key: 'deadline', label: '目标日', defaultWidth: 150, minimumWidth: 110, defaultVisible: true },
  { key: 'template', label: '项目模板', defaultWidth: 150, minimumWidth: 100, defaultVisible: false },
  { key: 'kind', label: '项目类型', defaultWidth: 110, minimumWidth: 86, defaultVisible: true },
  { key: 'updated', label: '最近更新', defaultWidth: 142, minimumWidth: 106, defaultVisible: false },
  { key: 'operation', label: '操作', defaultWidth: 64, minimumWidth: 52, defaultVisible: true }
]

export const DEFAULT_PROJECT_TABLE_LAYOUT: ProjectTableLayout = {
  order: PROJECT_TABLE_COLUMNS.map((column) => column.key),
  hidden: PROJECT_TABLE_COLUMNS.filter((column) => !column.defaultVisible).map((column) => column.key),
  widths: {}
}

const STORAGE_KEY = 'ly.creator-os.project-table-layout-v1'
const validKeys = new Set(PROJECT_TABLE_COLUMNS.map((column) => column.key))

export function readProjectTableLayout(): ProjectTableLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ProjectTableLayout>
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((key): key is ProjectTableColumnKey => typeof key === 'string' && validKeys.has(key as ProjectTableColumnKey))
      : []
    for (const column of PROJECT_TABLE_COLUMNS) if (!order.includes(column.key)) order.push(column.key)
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((key): key is ProjectTableColumnKey => typeof key === 'string' && validKeys.has(key as ProjectTableColumnKey) && key !== 'project')
      : [...DEFAULT_PROJECT_TABLE_LAYOUT.hidden]
    const widths = parsed.widths && typeof parsed.widths === 'object' ? parsed.widths : {}
    return { order, hidden, widths }
  } catch {
    return { ...DEFAULT_PROJECT_TABLE_LAYOUT, order: [...DEFAULT_PROJECT_TABLE_LAYOUT.order], hidden: [...DEFAULT_PROJECT_TABLE_LAYOUT.hidden] }
  }
}

export function writeProjectTableLayout(layout: ProjectTableLayout): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch { /* 本地偏好写入失败时继续使用当前会话状态 */ }
}

export function projectColumnDefinition(key: ProjectTableColumnKey): ProjectTableColumnDefinition {
  return PROJECT_TABLE_COLUMNS.find((column) => column.key === key) ?? PROJECT_TABLE_COLUMNS[0]!
}
