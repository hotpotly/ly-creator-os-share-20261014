import { FilePenLine, LayoutDashboard, MoreHorizontal, Pencil } from 'lucide-react'
import type { DragEvent, RefObject } from 'react'
import type { ProjectDetail, ProjectModuleKey } from '../../../shared/domain'
import { writeProjectDragData } from '../utils/project-drag'
import { navigate } from '../utils/router'
import { projectStatusLabels } from '../utils/project-labels'
import { ProjectIdentityVisual } from './ProjectIdentityVisual'
import { InlineRename } from './InlineRename'

export function ProjectHeader({
  project,
  activeModule,
  editingName,
  actionsRef,
  fileInputRef,
  menuExpanded,
  moduleManager,
  onRenameStart,
  onRenameSave,
  onRenameCancel,
  onImportScript,
  onOpenMenu
}: {
  project: ProjectDetail
  activeModule: ProjectModuleKey
  editingName: boolean
  actionsRef: RefObject<HTMLDivElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  menuExpanded: boolean
  moduleManager: React.ReactNode
  onRenameStart(): void
  onRenameSave(title: string): void
  onRenameCancel(): void
  onImportScript(file: File): void
  onOpenMenu(anchor: HTMLElement): void
}): React.JSX.Element {
  const dragTitle = (event: DragEvent<HTMLButtonElement>): void => writeProjectDragData(event.dataTransfer, project.id)
  return <header className="project-hero">
    <ProjectIdentityVisual project={project} />
    <div className="project-hero-copy">
      <div className="project-heading-meta"><button className="category-link" onClick={() => navigate({ page: 'projects', contentTypeId: project.contentTypeId })}>{project.contentTypeName}</button><span>{projectStatusLabels[project.status]}</span></div>
      {editingName
        ? <InlineRename initialValue={project.title} ariaLabel="重命名项目" className="project-hero-rename" onSave={onRenameSave} onCancel={onRenameCancel} />
        : <h1><button className="project-title-button" aria-label={`重命名项目${project.title}`} draggable onDragStart={dragTitle} onClick={onRenameStart} title="点击重命名；也可以拖到侧栏常用"><span>{project.title}</span><Pencil size={12} /></button></h1>}
    </div>
    <div className="project-hero-actions" ref={actionsRef}>
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".md,.markdown,.txt,.text,.docx" aria-label="选择要导入的外部文案" onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file) onImportScript(file)
        event.currentTarget.value = ''
      }} />
      <button className={`project-overview-nav${activeModule === 'overview' ? ' active' : ''}`} aria-current={activeModule === 'overview' ? 'page' : undefined} onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })}><LayoutDashboard size={14} />概览</button>
      <button className="project-quick-capture" aria-label="快速记录到项目" title="快速记录到项目" onClick={() => void window.creatorOS?.openCapture(project.id)}><FilePenLine size={15} /></button>
      <button className="project-menu-trigger project-hero-menu" aria-label="项目操作" aria-haspopup="menu" aria-expanded={menuExpanded} onClick={(event) => onOpenMenu(event.currentTarget)}><MoreHorizontal size={16} /></button>
      {moduleManager}
    </div>
  </header>
}
