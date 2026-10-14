import { AppSelect } from './AppSelect'
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { createDefaultSidebarLayout, type SidebarLayoutPreference, type SidebarNavigationItemId } from '../../../shared/domain'
import {
  createSidebarGroup,
  deleteSidebarGroup,
  moveSidebarItem,
  renameSidebarGroup,
  reorderSidebarGroup,
  setSidebarItemHidden
} from '../../../shared/sidebar-layout'
import { useWorkspaceStore } from '../store/workspace'
import { showStagePreview } from '../utils/stage-preview'
import { workspaceDestinationById } from '../utils/workspace-destinations'

export function WorkspaceManagementSettings(): React.JSX.Element {
  const layout = useWorkspaceStore((state) => state.snapshot.preferences.sidebarLayout)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [newGroupName, setNewGroupName] = useState('')
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null)
  const [draggedItemId, setDraggedItemId] = useState<SidebarNavigationItemId | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<Record<string, string>>({})

  const save = async (next: SidebarLayoutPreference, message?: string): Promise<void> => {
    await setPreferences({ sidebarLayout: next })
    if (message) showStagePreview(message)
  }
  const moveGroup = (groupId: string, targetIndex: number): void => {
    void save(reorderSidebarGroup(layout, groupId, targetIndex))
  }
  const moveItem = (itemId: SidebarNavigationItemId, groupId: string, targetIndex?: number): void => {
    void save(moveSidebarItem(layout, itemId, groupId, targetIndex))
  }
  const createGroup = (): void => {
    const name = newGroupName.trim()
    if (!name) return
    try {
      void save(createSidebarGroup(layout, `custom-${crypto.randomUUID()}`, name), `已创建分组“${name}”`)
      setNewGroupName('')
    } catch (cause) {
      showStagePreview(cause instanceof Error ? cause.message : '无法创建分组')
    }
  }
  const removeGroup = (groupId: string): void => {
    try {
      void save(deleteSidebarGroup(layout, groupId, deleteTargets[groupId] || undefined), '自定义分组已删除')
    } catch (cause) {
      showStagePreview(cause instanceof Error ? cause.message : '无法删除分组')
    }
  }

  return <section className="settings-group card workspace-management-settings" aria-label="工作区管理">
    <header className="settings-group-head">
      <div><b>工作区管理</b><span>侧栏只显示你需要的入口；分组和入口都可以在这里拖动</span></div>
      <button onClick={() => void save(createDefaultSidebarLayout(), '侧栏已恢复默认布局')}><RotateCcw size={13} />恢复默认</button>
    </header>
    <div className="workspace-management-groups">
      {layout.groups.map((group, groupIndex) => <article
        className="workspace-management-group"
        key={group.id}
        aria-label={`${group.name}分组`}
        onDragOver={(event) => {
          if (!draggedGroupId) return
          event.preventDefault()
        }}
        onDrop={(event) => {
          if (!draggedGroupId) return
          event.preventDefault()
          moveGroup(draggedGroupId, groupIndex)
          setDraggedGroupId(null)
        }}
      >
        <header>
          <button
            className="workspace-group-drag"
            draggable
            aria-label={`拖动${group.name}分组`}
            title="拖动分组"
            onDragStart={(event) => {
              event.stopPropagation()
              setDraggedGroupId(group.id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDraggedGroupId(null)}
          ><GripVertical size={14} /></button>
          {group.isCustom
            ? <input
              defaultValue={group.name}
              aria-label={`重命名${group.name}分组`}
              maxLength={40}
              onBlur={(event) => {
                try {
                  if (event.currentTarget.value.trim() !== group.name) void save(renameSidebarGroup(layout, group.id, event.currentTarget.value))
                } catch (cause) {
                  event.currentTarget.value = group.name
                  showStagePreview(cause instanceof Error ? cause.message : '无法重命名分组')
                }
              }}
            />
            : <b>{group.name}</b>}
          <span>{group.itemIds.length ? `${group.itemIds.length}个入口` : '空分组不会显示'}</span>
          <button aria-label={`${group.name}分组上移`} disabled={groupIndex === 0} onClick={() => moveGroup(group.id, groupIndex - 1)}><ChevronUp size={13} /></button>
          <button aria-label={`${group.name}分组下移`} disabled={groupIndex === layout.groups.length - 1} onClick={() => moveGroup(group.id, groupIndex + 1)}><ChevronDown size={13} /></button>
        </header>
        <div
          className="workspace-management-items"
          onDragOver={(event) => {
            if (!draggedItemId || group.id === 'income') return
            event.preventDefault()
          }}
          onDrop={(event) => {
            if (!draggedItemId || group.id === 'income') return
            event.preventDefault()
            moveItem(draggedItemId, group.id)
            setDraggedItemId(null)
          }}
        >
          {group.itemIds.map((itemId, itemIndex) => {
            const destination = workspaceDestinationById.get(itemId)
            if (!destination) return null
            const Icon = destination.icon
            const hidden = layout.hiddenItemIds.includes(itemId)
            const fixedIncomeItem = itemId === 'business' || itemId === 'other-income'
            return <div
              className={`workspace-management-item${hidden ? ' hidden' : ''}${fixedIncomeItem ? ' fixed' : ''}`}
              draggable={!fixedIncomeItem}
              key={itemId}
              onDragStart={(event) => {
                if (fixedIncomeItem) return
                event.stopPropagation()
                setDraggedItemId(itemId)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDraggedItemId(null)}
              onDragOver={(event) => {
                if (!draggedItemId) return
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={(event) => {
                if (!draggedItemId) return
                event.preventDefault()
                event.stopPropagation()
                moveItem(draggedItemId, group.id, itemIndex)
                setDraggedItemId(null)
              }}
            >
              <GripVertical size={13} aria-hidden="true" />
              <Icon size={15} />
              <span>{destination.label}</span>
              <button
                aria-label={itemId === 'home' ? '首页固定显示' : fixedIncomeItem ? `${destination.label}固定显示` : hidden ? `显示${destination.label}` : `隐藏${destination.label}`}
                disabled={itemId === 'home' || fixedIncomeItem}
                title={itemId === 'home' ? '首页不能隐藏' : fixedIncomeItem ? '收入台账子入口位置固定' : hidden ? '重新显示' : '从侧栏隐藏'}
                onClick={() => void save(setSidebarItemHidden(layout, itemId, !hidden))}
              >{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          })}
          {!group.itemIds.length ? <span className="workspace-management-empty">把入口拖到这里</span> : null}
        </div>
        {group.isCustom ? <footer>
          {group.itemIds.length ? <label><span>删除前移到</span><AppSelect value={deleteTargets[group.id] ?? ''} onChange={(event) => {
            const targetGroupId = event.currentTarget.value
            setDeleteTargets((value) => ({ ...value, [group.id]: targetGroupId }))
          }}><option value="">选择分组</option>{layout.groups.filter((candidate) => candidate.id !== group.id && candidate.id !== 'income').map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</AppSelect></label> : <span>空分组可直接删除</span>}
          <button className="danger" disabled={group.itemIds.length > 0 && !deleteTargets[group.id]} onClick={() => removeGroup(group.id)}><Trash2 size={13} />删除分组</button>
        </footer> : null}
      </article>)}
    </div>
    <footer className="workspace-management-create">
      <input value={newGroupName} maxLength={40} placeholder="新分组名称" aria-label="新分组名称" onChange={(event) => setNewGroupName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') createGroup() }} />
      <button disabled={!newGroupName.trim()} onClick={createGroup}><Plus size={13} />新建分组</button>
    </footer>
  </section>
}
