import {
  SIDEBAR_NAVIGATION_ITEM_IDS,
  createDefaultSidebarLayout,
  type SidebarLayoutPreference,
  type SidebarNavigationGroupPreference,
  type SidebarNavigationItemId
} from './domain'

const ITEM_IDS = new Set<string>(SIDEBAR_NAVIGATION_ITEM_IDS)
const SYSTEM_GROUPS = new Map(createDefaultSidebarLayout().groups.map((group) => [group.id, group]))
const MAX_GROUPS = 12
const MAX_CUSTOM_GROUPS = MAX_GROUPS - SYSTEM_GROUPS.size
const FIXED_INCOME_ITEM_IDS = new Set<SidebarNavigationItemId>(['business', 'other-income'])

const cloneGroup = (group: SidebarNavigationGroupPreference): SidebarNavigationGroupPreference => ({
  ...group,
  itemIds: [...group.itemIds]
})

export function normalizeSidebarLayout(value: unknown): SidebarLayoutPreference {
  const source = value && typeof value === 'object' ? value as Partial<SidebarLayoutPreference> : {}
  const seenGroupIds = new Set<string>()
  const seenItemIds = new Set<SidebarNavigationItemId>()
  const groups: SidebarNavigationGroupPreference[] = []
  let customGroupCount = 0

  if (Array.isArray(source.groups)) {
    source.groups.forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return
      const raw = candidate as Partial<SidebarNavigationGroupPreference>
      const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 80) : ''
      if (!id || seenGroupIds.has(id)) return
      const system = SYSTEM_GROUPS.get(id)
      if (!system && raw.isCustom !== true) return
      if (!system && customGroupCount >= MAX_CUSTOM_GROUPS) return
      const name = system?.name ?? (typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '')
      if (!name) return
      const itemIds: SidebarNavigationItemId[] = []
      if (Array.isArray(raw.itemIds)) {
        raw.itemIds.forEach((item) => {
          if (!ITEM_IDS.has(String(item)) || seenItemIds.has(item as SidebarNavigationItemId)) return
          if (FIXED_INCOME_ITEM_IDS.has(item as SidebarNavigationItemId) && id !== 'income') return
          itemIds.push(item as SidebarNavigationItemId)
          seenItemIds.add(item as SidebarNavigationItemId)
        })
      }
      seenGroupIds.add(id)
      if (!system) customGroupCount += 1
      groups.push({
        id,
        name,
        itemIds,
        expanded: raw.expanded !== false,
        isCustom: !system
      })
    })
  }

  createDefaultSidebarLayout().groups.forEach((system) => {
    if (!seenGroupIds.has(system.id)) {
      seenGroupIds.add(system.id)
      groups.push({ ...cloneGroup(system), itemIds: [] })
    }
  })

  const groupById = new Map(groups.map((group) => [group.id, group]))
  createDefaultSidebarLayout().groups.forEach((defaults) => {
    const target = groupById.get(defaults.id)
    defaults.itemIds.forEach((item) => {
      if (seenItemIds.has(item)) return
      target?.itemIds.push(item)
      seenItemIds.add(item)
    })
  })

  groups.forEach((group) => {
    if (group.id !== 'income') group.itemIds = group.itemIds.filter((item) => !FIXED_INCOME_ITEM_IDS.has(item))
  })
  const incomeGroup = groups.find((group) => group.id === 'income')
  if (incomeGroup) {
    incomeGroup.name = '收入台账'
    incomeGroup.isCustom = false
    incomeGroup.itemIds = ['business', 'other-income']
  }

  const hiddenItemIds = Array.isArray(source.hiddenItemIds)
    ? source.hiddenItemIds.filter((item, index, all): item is SidebarNavigationItemId => (
      item !== 'home'
      && !FIXED_INCOME_ITEM_IDS.has(item as SidebarNavigationItemId)
      && ITEM_IDS.has(String(item))
      && all.indexOf(item) === index
    ))
    : []

  return { version: 1, groups, hiddenItemIds }
}

export function moveSidebarItem(
  layout: SidebarLayoutPreference,
  itemId: SidebarNavigationItemId,
  targetGroupId: string,
  targetIndex?: number
): SidebarLayoutPreference {
  const normalized = normalizeSidebarLayout(layout)
  if (FIXED_INCOME_ITEM_IDS.has(itemId)) throw new Error('收入台账入口位置固定')
  if (targetGroupId === 'income') throw new Error('收入台账分组只保留固定子入口')
  const groups = normalized.groups.map(cloneGroup)
  const target = groups.find((group) => group.id === targetGroupId)
  if (!target) throw new Error('目标分组不存在')
  groups.forEach((group) => { group.itemIds = group.itemIds.filter((item) => item !== itemId) })
  const index = targetIndex === undefined ? target.itemIds.length : Math.max(0, Math.min(targetIndex, target.itemIds.length))
  target.itemIds.splice(index, 0, itemId)
  return { ...normalized, groups }
}

export function reorderSidebarGroup(layout: SidebarLayoutPreference, groupId: string, targetIndex: number): SidebarLayoutPreference {
  const normalized = normalizeSidebarLayout(layout)
  const groups = normalized.groups.map(cloneGroup)
  const index = groups.findIndex((group) => group.id === groupId)
  if (index < 0) throw new Error('分组不存在')
  const [group] = groups.splice(index, 1)
  if (!group) throw new Error('分组不存在')
  groups.splice(Math.max(0, Math.min(targetIndex, groups.length)), 0, group)
  return { ...normalized, groups }
}

export function createSidebarGroup(layout: SidebarLayoutPreference, id: string, name: string): SidebarLayoutPreference {
  const normalized = normalizeSidebarLayout(layout)
  const nextId = id.trim().slice(0, 80)
  const nextName = name.trim().slice(0, 40)
  if (!nextId || normalized.groups.some((group) => group.id === nextId)) throw new Error('分组标识无效或已存在')
  if (!nextName) throw new Error('请输入分组名称')
  if (normalized.groups.length >= 12) throw new Error('最多保留12个侧栏分组')
  return {
    ...normalized,
    groups: [...normalized.groups.map(cloneGroup), { id: nextId, name: nextName, itemIds: [], expanded: true, isCustom: true }]
  }
}

export function renameSidebarGroup(layout: SidebarLayoutPreference, groupId: string, name: string): SidebarLayoutPreference {
  const normalized = normalizeSidebarLayout(layout)
  const nextName = name.trim().slice(0, 40)
  if (!nextName) throw new Error('请输入分组名称')
  const groups = normalized.groups.map((group) => {
    if (group.id !== groupId) return cloneGroup(group)
    if (!group.isCustom) throw new Error('默认分组不能改名')
    return { ...cloneGroup(group), name: nextName }
  })
  return { ...normalized, groups }
}

export function deleteSidebarGroup(layout: SidebarLayoutPreference, groupId: string, targetGroupId?: string): SidebarLayoutPreference {
  const normalized = normalizeSidebarLayout(layout)
  const current = normalized.groups.find((group) => group.id === groupId)
  if (!current) throw new Error('分组不存在')
  if (!current.isCustom) throw new Error('默认分组不能删除')
  if (current.itemIds.length && !targetGroupId) throw new Error('请先选择其中入口的新位置')
  if (targetGroupId === groupId) throw new Error('请选择其他分组')
  if (targetGroupId === 'income') throw new Error('收入台账分组只保留固定子入口')
  const groups = normalized.groups.filter((group) => group.id !== groupId).map(cloneGroup)
  if (current.itemIds.length) {
    const target = groups.find((group) => group.id === targetGroupId)
    if (!target) throw new Error('目标分组不存在')
    target.itemIds.push(...current.itemIds)
  }
  return { ...normalized, groups }
}

export function setSidebarItemHidden(
  layout: SidebarLayoutPreference,
  itemId: SidebarNavigationItemId,
  hidden: boolean
): SidebarLayoutPreference {
  const normalized = normalizeSidebarLayout(layout)
  if (itemId === 'home' || FIXED_INCOME_ITEM_IDS.has(itemId)) return normalized
  const next = new Set(normalized.hiddenItemIds)
  if (hidden) next.add(itemId)
  else next.delete(itemId)
  return { ...normalized, hiddenItemIds: [...next] }
}
