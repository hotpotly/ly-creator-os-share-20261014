import { Archive, CheckCircle2, FileInput, FolderOpen, FolderSearch, HardDrive, ListChecks, Pencil, Pin, PinOff, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { AnchoredPopover } from './AnchoredPopover'

export type ProjectMenuView = 'active' | 'trash'
export interface ProjectMenuTarget {
  project: ProjectSummary
  anchor: HTMLElement
  anchorPoint?: { x: number; y: number }
  view: ProjectMenuView
  context?: 'list' | 'detail'
}
type DoneAction = 'completed' | 'archived' | 'trashed' | 'restored' | 'deleted' | 'pinned' | 'unpinned'

// 项目操作的唯一入口：侧边栏、内容项目列表和项目详情共用；右键或“⋯”触发，删除不再平铺在界面上。
export function ProjectContextMenu({ target, onClose, onDone, onRename, onManageModules, onArchiveToNas }: {
  target: ProjectMenuTarget | null
  onClose(): void
  onDone?(action: DoneAction, project: ProjectSummary): void
  onRename?(project: ProjectSummary): void
  onManageModules?(project: ProjectSummary): void
  onArchiveToNas?(project: ProjectSummary): void
}): React.JSX.Element {
  const refresh = useWorkspaceStore((state) => state.refresh)
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [confirm, setConfirm] = useState<{ kind: 'complete' | 'archive' | 'trash' | 'delete'; project: ProjectSummary } | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!target || confirm) return
    const closeOutside = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('.project-context-menu, .project-menu-trigger')) return
      onClose()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault(); onClose(); target.anchor.focus()
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', closeOnEscape) }
  }, [confirm, onClose, target])

  const openProject = (project: ProjectSummary): void => {
    navigate({ page: 'project', projectId: project.id, moduleKey: project.pendingExternalDrafts > 0 ? 'script' : 'overview' })
    onClose()
  }
  const restore = async (project: ProjectSummary): Promise<void> => {
    if (!window.creatorOS || working) return
    setWorking(true); setError('')
    try { await window.creatorOS.restoreProject(project.id); await refresh(); onClose(); onDone?.('restored', project) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '项目恢复失败') }
    finally { setWorking(false) }
  }
  const togglePinned = async (project: ProjectSummary): Promise<void> => {
    if (!window.creatorOS || working) return
    const pinned = !project.isPinned
    setWorking(true); setError('')
    try {
      await window.creatorOS.setProjectPinned(project.id, pinned)
      const order = preferences.pinnedProjectOrder.filter((id) => id !== project.id)
      await setPreferences({ pinnedProjectOrder: pinned ? [...order, project.id] : order })
      await refresh()
      onClose()
      onDone?.(pinned ? 'pinned' : 'unpinned', project)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '常用状态保存失败')
    } finally {
      setWorking(false)
    }
  }
  const revealFolder = async (project: ProjectSummary): Promise<void> => {
    if (!window.creatorOS || working) return
    setWorking(true); setError('')
    try { await window.creatorOS.revealProjectFolder(project.id); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '打开项目文件夹失败') }
    finally { setWorking(false) }
  }
  const importDraft = async (project: ProjectSummary): Promise<void> => {
    if (!window.creatorOS || working) return
    setWorking(true); setError('')
    try {
      const result = await window.creatorOS.importScript(project.id)
      if (!result.canceled) {
        await refresh()
        navigate({ page: 'project', projectId: project.id, moduleKey: 'script' })
      }
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入外部文案失败') }
    finally { setWorking(false) }
  }
  const askConfirm = (kind: 'complete' | 'archive' | 'trash' | 'delete', project: ProjectSummary): void => { setConfirm({ kind, project }); onClose() }
  const runConfirm = async (): Promise<void> => {
    if (!window.creatorOS || !confirm || working) return
    setWorking(true); setError('')
    try {
      if (confirm.kind === 'complete') await window.creatorOS.setProjectLifecycle(confirm.project.id, 'completed')
      else if (confirm.kind === 'archive') await window.creatorOS.setProjectLifecycle(confirm.project.id, 'archived')
      else if (confirm.kind === 'trash') await window.creatorOS.trashProject(confirm.project.id)
      else await window.creatorOS.permanentlyDeleteProject(confirm.project.id)
      const action: DoneAction = confirm.kind === 'complete' ? 'completed' : confirm.kind === 'archive' ? 'archived' : confirm.kind === 'trash' ? 'trashed' : 'deleted'
      const project = confirm.project
      setConfirm(null); await refresh(); onDone?.(action, project)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '项目处理失败') }
    finally { setWorking(false) }
  }

  return <>
    {target && !confirm ? <AnchoredPopover anchor={target.anchor} anchorPoint={target.anchorPoint} role="menu" ariaLabel={`${target.project.title}的操作`} className="project-context-menu" onDismiss={onClose}>
      {target.view === 'trash' ? <>
        <button role="menuitem" disabled={working} onClick={() => void restore(target.project)}><RotateCcw size={13} />恢复项目</button>
        <button role="menuitem" className="danger" onClick={() => askConfirm('delete', target.project)}><Trash2 size={13} />永久删除</button>
      </> : <>
        {target.context !== 'detail' ? <button role="menuitem" onClick={() => openProject(target.project)}><FolderOpen size={13} />打开项目</button> : null}
        {onRename ? <button role="menuitem" onClick={() => { const project = target.project; onClose(); onRename(project) }}><Pencil size={13} />重命名</button> : null}
        {onManageModules ? <button role="menuitem" onClick={() => { const project = target.project; onClose(); onManageModules(project) }}><ListChecks size={13} />管理阶段模块</button> : null}
        {onArchiveToNas ? <button role="menuitem" onClick={() => { const project = target.project; onClose(); onArchiveToNas(project) }}><HardDrive size={13} />归档到NAS</button> : null}
        <button role="menuitem" disabled={working} onClick={() => void revealFolder(target.project)}><FolderSearch size={13} />打开项目文件夹</button>
        <button role="menuitem" disabled={working} onClick={() => void importDraft(target.project)}><FileInput size={13} />导入外部文案</button>
        <button role="menuitem" disabled={working} onClick={() => void togglePinned(target.project)}>{target.project.isPinned ? <PinOff size={13} /> : <Pin size={13} />}{target.project.isPinned ? '移出常用' : '加入常用'}</button>
        <button role="menuitem" onClick={() => askConfirm('complete', target.project)}><CheckCircle2 size={13} />标记项目完成</button>
        <button role="menuitem" onClick={() => askConfirm('archive', target.project)}><Archive size={13} />归档项目</button>
        <button role="menuitem" className="danger" onClick={() => askConfirm('trash', target.project)}><Trash2 size={13} />移到回收站</button>
      </>}
      {error ? <p className="project-menu-error" role="alert">{error}</p> : null}
    </AnchoredPopover> : null}
    {confirm ? <div className="modal-backdrop"><section className="confirm-dialog project-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="project-menu-confirm-title">
      <header><div>{confirm.kind === 'complete' ? <CheckCircle2 size={16} /> : confirm.kind === 'archive' ? <Archive size={16} /> : <Trash2 size={16} />}<h2 id="project-menu-confirm-title">{confirm.kind === 'complete' ? '标记项目完成？' : confirm.kind === 'archive' ? '归档项目？' : confirm.kind === 'trash' ? '移到回收站？' : '永久删除项目？'}</h2></div><button aria-label="关闭项目操作确认" onClick={() => setConfirm(null)}><X size={15} /></button></header>
      <p>{confirm.kind === 'complete' ? `「${confirm.project.title}」会从内容项目移除，并在选题管理中进入“已完成”。` : confirm.kind === 'archive' ? `「${confirm.project.title}」会从内容项目移除，并在选题管理中进入“已归档”。` : confirm.kind === 'trash' ? `「${confirm.project.title}」会移入项目回收站，对应选题改为“已搁置”；恢复项目后会重新立项。` : `「${confirm.project.title}」及项目内版本、资料和任务记录将永久删除，无法恢复；对应选题会保留为“已搁置”。`}</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer><button onClick={() => setConfirm(null)}>取消</button><button className={confirm.kind === 'trash' || confirm.kind === 'delete' ? 'danger-action' : 'primary-action'} disabled={working} onClick={() => void runConfirm()}>{working ? '处理中…' : confirm.kind === 'complete' ? '标记完成' : confirm.kind === 'archive' ? '归档项目' : confirm.kind === 'trash' ? '移到回收站' : '永久删除'}</button></footer>
    </section></div> : null}
  </>
}
