import { Activity, Moon, PenLine, Plus, Search, Sun } from 'lucide-react'
import { countAttentionTasks } from '../../../shared/task-visibility'
import { useWorkspaceStore } from '../store/workspace'
import { navigate, type RouteBreadcrumbItem } from '../utils/router'

interface Props {
  isDark: boolean
  tasksOpen: boolean
  onToggleTheme(): void
  onOpenCapture(): void
  primaryActionLabel: '新建项目' | '新建选题' | '新增其他收入' | '新增商单'
  onPrimaryAction(): void
  onToggleTasks(): void
  onOpenSearch(): void
  searchOpen: boolean
  breadcrumbItems: RouteBreadcrumbItem[]
}

export function Topbar({ isDark, tasksOpen, onToggleTheme, onOpenCapture, primaryActionLabel, onPrimaryAction, onToggleTasks, onOpenSearch, searchOpen, breadcrumbItems }: Props): React.JSX.Element {
  const taskCount = useWorkspaceStore((state) => countAttentionTasks(state.snapshot.tasks))
  return (
    <header className="topbar">
      <nav className="breadcrumb" aria-label="当前位置">{breadcrumbItems.map((item, index) => <span key={`${item.label}:${index}`}>{index ? <i aria-hidden="true"> / </i> : null}{item.route ? <button onClick={() => navigate(item.route!)}>{item.label}</button> : <b aria-current="page">{item.label}</b>}</span>)}</nav>
      <div className="topbar-actions">
        <button className="global-search" aria-label="打开全局搜索" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={onOpenSearch}><Search size={16} /><span>搜索项目、文案、复盘等内容</span><kbd>⌘K</kbd></button>
        <button className="topbar-button" aria-label="快速记录" onClick={onOpenCapture}><PenLine size={16} /><span>快速记录</span></button>
        <button className="topbar-button primary new-project-button" aria-label={primaryActionLabel} onClick={onPrimaryAction}><Plus size={17} /><span>{primaryActionLabel}</span></button>
        {taskCount > 0 ? <button className="topbar-button" aria-label={`运行任务，${taskCount}项`} aria-expanded={tasksOpen} aria-controls="tasks-drawer" onClick={onToggleTasks}><Activity size={16} /><span>运行任务</span><b className="task-count">{taskCount}</b></button> : null}
        <button className="theme-button" aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'} onClick={onToggleTheme}>{isDark ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>
    </header>
  )
}
