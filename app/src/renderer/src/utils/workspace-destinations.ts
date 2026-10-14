import { BriefcaseBusiness, CalendarDays, CircleDollarSign, Folder, HandCoins, Home, Inbox, Library, Lightbulb, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SidebarNavigationItemId } from '../../../shared/domain'
import type { AppRoute } from './router'

export interface WorkspaceDestination {
  id: SidebarNavigationItemId | 'income'
  icon: LucideIcon
  label: string
  route: AppRoute
}

// 固定注册表同时供顶部“新标签”菜单使用；用户侧栏布局只能引用ID，不能改写或隐藏注册表。
export const workspaceDestinations: readonly WorkspaceDestination[] = [
  { id: 'home', label: '首页', route: { page: 'home' }, icon: Home },
  { id: 'ideas', label: '灵感库', route: { page: 'ideas' }, icon: Inbox },
  { id: 'topics', label: '选题管理', route: { page: 'topics' }, icon: Lightbulb },
  { id: 'projects', label: '内容项目', route: { page: 'projects' }, icon: Folder },
  { id: 'income', label: '收入台账', route: { page: 'income' }, icon: CircleDollarSign },
  { id: 'business', label: '商单收入', route: { page: 'business' }, icon: BriefcaseBusiness },
  { id: 'other-income', label: '其他收入', route: { page: 'other-income' }, icon: HandCoins },
  { id: 'tools', label: '创作工具', route: { page: 'tools' }, icon: Wrench },
  { id: 'schedule', label: '排期', route: { page: 'schedule' }, icon: CalendarDays },
  { id: 'resources', label: '资源', route: { page: 'resources' }, icon: Library }
]

export const workspaceDestinationById = new Map(workspaceDestinations.map((destination) => [destination.id, destination]))
