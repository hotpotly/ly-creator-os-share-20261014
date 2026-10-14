import { z } from 'zod'

export const WORKSPACE_ACCESS_SCOPES = ['preferences.todo', 'project.catalog', 'todo.full', 'work_log'] as const
export const WORKSPACE_ACCESS_OPTIONS = [
  { scope: 'todo.full', label: '待办', editable: true },
  { scope: 'work_log', label: '工作投入', editable: true },
  { scope: 'project.catalog', label: '项目目录', editable: false },
  { scope: 'preferences.todo', label: '待办分类与视图', editable: false }
] as const
const grantSchema = z.object({ scope: z.enum(WORKSPACE_ACCESS_SCOPES), write: z.boolean() }).strict().refine(value => !value.write || value.scope === 'todo.full' || value.scope === 'work_log', '此范围仅可读取')
export const workspaceAccessGrantsSchema = z.array(grantSchema).max(4).refine(values => new Set(values.map(value => value.scope)).size === values.length, '授权范围重复').transform(values => [...values].sort((a, b) => a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0))
export const workspaceAccessQuerySchema = z.object({ deviceId: z.string().uuid() }).strict()
export const workspaceAccessStateSchema = z.object({ deviceId: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), grants: workspaceAccessGrantsSchema }).strict()
export const workspaceAccessUpdateSchema = z.object({ deviceId: z.string().uuid(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), grants: workspaceAccessGrantsSchema }).strict()
export type WorkspaceAccessState = z.infer<typeof workspaceAccessStateSchema>
export type WorkspaceAccessUpdate = z.infer<typeof workspaceAccessUpdateSchema>
export type WorkspaceAccessGrant = z.infer<typeof grantSchema>
