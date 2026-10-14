import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceTabView } from '../hooks/useWorkspaceTabs'
import type { AppRoute } from '../utils/router'
import { workspaceDestinations } from '../utils/workspace-destinations'
import { AnchoredPopover } from './AnchoredPopover'

interface Props {
  tabs: WorkspaceTabView[]
  canGoBack: boolean
  canGoForward: boolean
  sidebarCollapsed: boolean
  onSwitchTab(id: string): void
  onCloseTab(id: string): void
  onReorderTab(id: string, targetId: string): void
  onAddTab(route: AppRoute): void
  onGoBack(): void
  onGoForward(): void
  onToggleSidebar(): void
}

export function WorkspaceTabBar({ tabs, canGoBack, canGoForward, sidebarCollapsed, onSwitchTab, onCloseTab, onReorderTab, onAddTab, onGoBack, onGoForward, onToggleSidebar }: Props): React.JSX.Element {
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!addAnchor) return
    const focusFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.workspace-tab-add-menu [role="menuitem"]')?.focus()
    })
    const closeOnOutsideClick = (event: MouseEvent): void => {
      const target = event.target as Element
      if (addButtonRef.current?.contains(target) || target.closest('.workspace-tab-add-menu')) return
      setAddAnchor(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setAddAnchor(null)
      addButtonRef.current?.focus()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [addAnchor])

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const menu = event.currentTarget.closest('[role="menu"]')
    const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const currentIndex = items.indexOf(event.currentTarget)
    const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    event.preventDefault()
    items[targetIndex]?.focus()
  }

  return <nav className="workspace-tabbar" aria-label="工作区标签与历史">
    <div className="workspace-history-controls">
      <button aria-label={sidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏'} title={`${sidebarCollapsed ? '显示' : '隐藏'}侧边栏 ⌘B`} onClick={onToggleSidebar}>{sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
      <button aria-label="后退" title="后退" disabled={!canGoBack} onClick={onGoBack}><ChevronLeft size={16} /></button>
      <button aria-label="前进" title="前进" disabled={!canGoForward} onClick={onGoForward}><ChevronRight size={16} /></button>
    </div>
    <div className="workspace-tabs" role="tablist" aria-label="已打开的工作区标签">
      {tabs.map((tab, index) => <div className={`workspace-tab${tab.active ? ' active' : ''}`} draggable key={tab.id} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-creator-workspace-tab', tab.id) }} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-creator-workspace-tab')) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); onReorderTab(event.dataTransfer.getData('application/x-creator-workspace-tab'), tab.id) }}>
        <button className="workspace-tab-main" role="tab" aria-selected={tab.active} title={tab.label} onClick={() => onSwitchTab(tab.id)} onKeyDown={(event) => {
          if (!event.altKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          const target = tabs[index + (event.key === 'ArrowLeft' ? -1 : 1)]
          if (!target) return
          event.preventDefault(); onReorderTab(tab.id, target.id)
        }}><span>{tab.label}</span></button>
        {tabs.length > 1 ? <button className="workspace-tab-close" aria-label={`关闭${tab.label}`} title={`关闭${tab.label}`} onClick={() => onCloseTab(tab.id)}><X size={12} /></button> : null}
      </div>)}
    </div>
    <button ref={addButtonRef} className="workspace-tab-add" aria-label="新建工作区标签" aria-haspopup="menu" aria-expanded={Boolean(addAnchor)} title="新建工作区标签" onClick={(event) => {
      const button = event.currentTarget
      setAddAnchor((current) => current ? null : button)
    }}><Plus size={15} /></button>
    {addAnchor ? <AnchoredPopover anchor={addAnchor} ariaLabel="选择新标签起点" className="workspace-tab-add-menu" role="menu" onDismiss={() => setAddAnchor(null)}>
      {workspaceDestinations.map(({ label, route, icon: Icon }) => <button key={label} type="button" role="menuitem" onKeyDown={moveMenuFocus} onClick={() => {
        setAddAnchor(null)
        onAddTab(route)
      }}><Icon size={14} strokeWidth={1.8} /><span>{label}</span></button>)}
    </AnchoredPopover> : null}
  </nav>
}
