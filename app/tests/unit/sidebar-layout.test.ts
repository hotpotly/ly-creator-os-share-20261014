import { describe, expect, it } from 'vitest'
import { SIDEBAR_NAVIGATION_ITEM_IDS, createDefaultSidebarLayout } from '../../src/shared/domain'
import { preferencesPatchSchema } from '../../src/shared/ipc'
import {
  createSidebarGroup,
  deleteSidebarGroup,
  moveSidebarItem,
  normalizeSidebarLayout,
  renameSidebarGroup,
  reorderSidebarGroup,
  setSidebarItemHidden
} from '../../src/shared/sidebar-layout'

describe('sidebar layout', () => {
  it('restores the confirmed default groups and repairs legacy or malformed layouts', () => {
    expect(normalizeSidebarLayout(undefined)).toEqual(createDefaultSidebarLayout())
    const repaired = normalizeSidebarLayout({
      version: 1,
      groups: [
        { id: 'workspace', name: '错误名称', itemIds: ['home', 'home', 'unknown', 'ideas'], expanded: false, isCustom: true },
        { id: 'custom-notes', name: '我的入口', itemIds: ['tools', 'ideas'], expanded: true, isCustom: true },
        { id: 'custom-notes', name: '重复', itemIds: ['resources'], expanded: true, isCustom: true }
      ],
      hiddenItemIds: ['home', 'resources', 'resources', 'unknown']
    })
    expect(repaired.groups.map((group) => group.id)).toEqual(['workspace', 'custom-notes', 'creation', 'income', 'more'])
    expect(repaired.groups[0]).toMatchObject({
      name: '工作区',
      itemIds: ['home', 'ideas', 'topics', 'projects', 'schedule'],
      expanded: false,
      isCustom: false
    })
    expect(repaired.groups.flatMap((group) => group.itemIds).sort()).toEqual([...SIDEBAR_NAVIGATION_ITEM_IDS].sort())
    expect(repaired.hiddenItemIds).toEqual(['resources'])
  })

  it('moves and hides destinations without changing the fixed registry', () => {
    const defaults = createDefaultSidebarLayout()
    const moved = moveSidebarItem(defaults, 'resources', 'creation', 0)
    expect(moved.groups.find((group) => group.id === 'creation')?.itemIds).toEqual(['resources', 'tools'])
    expect(moved.groups.find((group) => group.id === 'more')?.itemIds).toEqual([])
    expect(moved.groups.find((group) => group.id === 'income')?.itemIds).toEqual(['business', 'other-income'])
    expect(() => moveSidebarItem(moved, 'business', 'more')).toThrow('收入台账入口位置固定')
    expect(() => moveSidebarItem(moved, 'resources', 'income')).toThrow('收入台账分组只保留固定子入口')
    expect(setSidebarItemHidden(moved, 'resources', true).hiddenItemIds).toEqual(['resources'])
    expect(setSidebarItemHidden(moved, 'home', true).hiddenItemIds).toEqual([])
    expect(reorderSidebarGroup(moved, 'more', 0).groups[0]?.id).toBe('more')
  })

  it('keeps custom groups one level deep and requires a migration target before deleting non-empty groups', () => {
    const created = createSidebarGroup(createDefaultSidebarLayout(), 'custom-writing', '写作')
    const renamed = renameSidebarGroup(created, 'custom-writing', '写作流程')
    const moved = moveSidebarItem(renamed, 'tools', 'custom-writing')
    expect(moved.groups.find((group) => group.id === 'custom-writing')).toMatchObject({ name: '写作流程', itemIds: ['tools'], isCustom: true })
    expect(() => deleteSidebarGroup(moved, 'custom-writing')).toThrow('请先选择其中入口的新位置')
    const deleted = deleteSidebarGroup(moved, 'custom-writing', 'creation')
    expect(deleted.groups.some((group) => group.id === 'custom-writing')).toBe(false)
    expect(deleted.groups.find((group) => group.id === 'creation')?.itemIds).toContain('tools')
    expect(() => deleteSidebarGroup(deleted, 'workspace', 'creation')).toThrow('默认分组不能删除')
  })

  it('rejects incomplete or duplicated sidebar layouts at the IPC boundary', () => {
    expect(preferencesPatchSchema.safeParse({ sidebarLayout: createDefaultSidebarLayout() }).success).toBe(true)
    const incomplete = createDefaultSidebarLayout()
    incomplete.groups[0]!.itemIds = incomplete.groups[0]!.itemIds.filter((item) => item !== 'home')
    expect(preferencesPatchSchema.safeParse({ sidebarLayout: incomplete }).success).toBe(false)
    const duplicated = createDefaultSidebarLayout()
    duplicated.groups[1]!.itemIds.push('home')
    expect(preferencesPatchSchema.safeParse({ sidebarLayout: duplicated }).success).toBe(false)

    const customOnly = {
      version: 1,
      groups: [
        { id: 'custom-a', name: 'A', itemIds: ['home', 'ideas', 'topics'], expanded: true, isCustom: true },
        { id: 'custom-b', name: 'B', itemIds: ['projects', 'schedule', 'tools'], expanded: true, isCustom: true },
        { id: 'custom-c', name: 'C', itemIds: ['business', 'other-income', 'resources'], expanded: true, isCustom: true }
      ],
      hiddenItemIds: []
    }
    expect(preferencesPatchSchema.safeParse({ sidebarLayout: customOnly }).success).toBe(false)

    const twelveCustomGroups = {
      version: 1,
      groups: Array.from({ length: 12 }, (_, index) => ({
        id: `custom-${index}`,
        name: `分组${index}`,
        itemIds: index < SIDEBAR_NAVIGATION_ITEM_IDS.length ? [SIDEBAR_NAVIGATION_ITEM_IDS[index]!] : [],
        expanded: true,
        isCustom: true
      })),
      hiddenItemIds: []
    }
    expect(preferencesPatchSchema.safeParse({ sidebarLayout: twelveCustomGroups }).success).toBe(false)
    const normalized = normalizeSidebarLayout(twelveCustomGroups)
    expect(normalized.groups).toHaveLength(12)
    expect(normalized.groups.filter((group) => group.isCustom)).toHaveLength(8)
    expect(normalized.groups.filter((group) => !group.isCustom).map((group) => group.id).sort()).toEqual(['creation', 'income', 'more', 'workspace'])
  })

  it('validates unique project-stage shortcuts and excludes the overview entry', () => {
    expect(preferencesPatchSchema.safeParse({
      sidebarStageShortcutsExpanded: false,
      pinnedProjectStages: [
        { projectId: 'project-a', moduleKey: 'script' },
        { projectId: 'project-a', moduleKey: 'outline' }
      ]
    }).success).toBe(true)
    expect(preferencesPatchSchema.safeParse({
      pinnedProjectStages: [
        { projectId: 'project-a', moduleKey: 'script' },
        { projectId: 'project-a', moduleKey: 'script' }
      ]
    }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({
      pinnedProjectStages: [{ projectId: 'project-a', moduleKey: 'overview' }]
    }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({
      pinnedProjectStages: [{ projectId: 'project-a', moduleKey: 'business' }]
    }).success).toBe(false)
  })
})
