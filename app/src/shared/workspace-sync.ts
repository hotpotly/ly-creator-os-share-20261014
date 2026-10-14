import { z } from 'zod'
import { isValidLocalDate } from './domain/coarse-time'

export const WORKSPACE_PROTOCOL = 1
export const WORKSPACE_PATH = '/workspace/v1/sync'
export const WORKSPACE_KEY_INFO = 'ly-creator-workspace-v1'
export const WORKSPACE_BATCH_LIMIT = 100
export const WORKSPACE_BYTE_LIMIT = 256 * 1024
const day = z.string().refine(isValidLocalDate)
const uuid = z.string().uuid()
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const workspaceKindSchema = z.enum(['todo', 'work_log'])
export const workspaceTodoDataSchema = z.object({
  title: z.string().min(1).max(100000),
  category: z.enum(['self_media', 'ai', 'life', 'other_work']),
  plannedDate: day.nullable(),
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$/).refine(value => Number.isFinite(Date.parse(value))).nullable()
}).strict()
export const workspaceLogDataSchema = z.object({ minutes: z.number().int().min(0).max(1440).nullable() }).strict()
export const workspaceLogSnapshotSchema = z.object({ minutes: z.number().int().min(0).max(4320).nullable() }).strict()
const snapshot = z.object({ deleted: z.boolean(), data: z.record(z.string(), z.unknown()) }).strict()
export const workspaceOperationSchema = z.object({
  operationId: uuid, kind: workspaceKindSchema, id: z.string().min(1).max(80),
  localRevision: revision.positive(), baseRevision: revision,
  base: snapshot.nullable(), next: snapshot
}).strict().superRefine((value, ctx) => {
  const schema = value.kind === 'todo' ? workspaceTodoDataSchema : workspaceLogSnapshotSchema
  if (!(value.kind === 'todo' ? uuid : day).safeParse(value.id).success) ctx.addIssue({ code: 'custom', message: '同步对象ID无效' })
  for (const item of [value.base, value.next]) {
    if (item && !schema.safeParse(item.data).success) ctx.addIssue({ code: 'custom', message: '同步字段无效' })
  }
  if (value.kind === 'work_log' && !value.next.deleted && value.next.data.minutes !== value.base?.data.minutes && !workspaceLogDataSchema.safeParse(value.next.data).success) ctx.addIssue({ code: 'custom', message: '每日投入须在0至1440分钟内' })
  if ((value.baseRevision === 0) !== (value.base === null)) ctx.addIssue({ code: 'custom', message: '同步基线无效' })
})
export const workspaceSyncRequestSchema = z.object({
  protocolVersion: z.literal(1), workspaceId: uuid, deviceId: uuid,
  cursor: revision, through: revision.nullable(),
  operations: z.array(workspaceOperationSchema).max(WORKSPACE_BATCH_LIMIT)
}).strict().superRefine((value, ctx) => {
  if (value.through !== null && value.through < value.cursor) ctx.addIssue({ code: 'custom', message: '同步水位无效' })
  if (new Set(value.operations.map(o => o.operationId)).size !== value.operations.length) ctx.addIssue({ code: 'custom', message: '批次操作ID重复' })
  if (new Set(value.operations.map(o => `${o.kind}:${o.id}`)).size !== value.operations.length) ctx.addIssue({ code: 'custom', message: '同一对象的操作必须顺序提交' })
})
export interface WorkspaceRemoteRecord {
  kind: 'todo' | 'work_log'
  id: string
  revision: number
  sequence: number
  deleted: boolean
  data: Record<string, unknown>
  metadata: Record<string, unknown>
}
export interface WorkspaceReceipt {
  operationId: string
  localRevision: number
  status: 'accepted' | 'conflict'
  record: WorkspaceRemoteRecord
}
export interface WorkspaceSyncResponse {
  protocolVersion: 1
  workspaceId: string
  deviceId: string
  receipts: WorkspaceReceipt[]
  changes: WorkspaceRemoteRecord[]
  cursor: number
  through: number
  hasMore: boolean
}
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>
export type WorkspaceSyncRequest = z.infer<typeof workspaceSyncRequestSchema>
export interface WorkspaceEnvelope {
  protocolVersion: 1
  workspaceId: string
  serviceId: string
  deviceId: string
  requestId: string
  counter: number
  nonce: string
  ciphertext: string
  tag: string
}
export function workspaceAad(value: Pick<WorkspaceEnvelope, 'workspaceId' | 'serviceId' | 'deviceId' | 'requestId' | 'counter'>, direction: 'request' | 'response'): string {
  return `workspace-v1\n${direction}\n${value.workspaceId}\n${value.serviceId}\n${value.deviceId}\n${value.requestId}\n${value.counter}`
}
