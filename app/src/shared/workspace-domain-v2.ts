import { z } from 'zod'
import { PROJECT_COLOR_TOKENS, PROJECT_STATUSES, STAGE_TIME_STATUSES, TODO_CATEGORIES, TODO_SEGMENTS, TODO_TRACKING_MODES, TOPIC_STAGE_ROLES } from './domain'
import { isValidLocalDate } from './domain/coarse-time'
import { WORKSPACE_V2_LIMITS } from './workspace-sync-v2'

export const WORKSPACE_DOMAIN_V2_KINDS = ['todo', 'work_log', 'project_catalog', 'todo_preferences'] as const
export const WORKSPACE_DOMAIN_V2_STAGE_KEYS = ['materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'versions'] as const
export const WORKSPACE_DOMAIN_V2_TODO_UNITS = {
  title: ['title'], category: ['category'], isExtra: ['isExtra'],
  C: ['status', 'trackingMode', 'progress', 'progressBeforeComplete', 'completedAt'],
  D: ['plannedDate', 'segment', 'dateRange'],
  P: ['projectId', 'stageKey', 'stageLinkSource']
} as const
export type WorkspaceDomainV2Kind = typeof WORKSPACE_DOMAIN_V2_KINDS[number]
export type WorkspaceDomainV2Body = Record<string, unknown>
export interface WorkspaceDomainV2Snapshot { deleted: boolean; body: WorkspaceDomainV2Body }
export interface WorkspaceDomainV2ResolutionInput {
  kind: WorkspaceDomainV2Kind
  id: string
  baseRevision: number
  currentRevision: number
  base: WorkspaceDomainV2Snapshot | null
  next: WorkspaceDomainV2Snapshot
  current: WorkspaceDomainV2Snapshot | null
}
export type WorkspaceDomainV2Resolution =
  | { status: 'apply' | 'noop'; body: WorkspaceDomainV2Body; deleted: boolean; changedUnits: string[] }
  | { status: 'conflict'; reason: 'concurrent_change' | 'deleted_record' | 'identity_collision'; conflictingUnits: string[] }
  | { status: 'rejected'; reason: 'invalid_change' | 'record_read_only' }
export type WorkspaceDomainV2Inspection = {
  rawJson: string
  body: WorkspaceDomainV2Body | null
  supported: boolean
  writable: boolean
  reason: null | 'invalid_json' | 'too_large' | 'unsafe_number' | 'unsupported_shape' | 'identity_mismatch' | 'record_read_only'
}
const localDate = z.string().refine(isValidLocalDate)
const stageKey = z.enum(WORKSPACE_DOMAIN_V2_STAGE_KEYS)
const readStageKey = z.enum([...WORKSPACE_DOMAIN_V2_STAGE_KEYS, 'feedback'])
const utcTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19))
const projectId = z.string().min(1).max(128)
const title = z.string().refine(value => value.trim().length >= 1 && value.trim().length <= 300)
const readRange = z.object({ startDate: localDate, endDate: localDate, name: z.string() }).strict().refine(value => value.startDate <= value.endDate)
const writeRange = readRange.refine(value => value.name.trim().length <= 60)
const completionShape = {
  status: z.enum(['open', 'completed']), trackingMode: z.enum(TODO_TRACKING_MODES),
  progress: z.number().int().min(0).max(100), progressBeforeComplete: z.number().int().min(0).max(99).nullable(),
  completedAt: utcTime.nullable()
}
export const workspaceDomainV2CompletionSchema = z.object(completionShape).strict().refine(value => value.status === 'completed'
  ? value.progress === 100 && value.completedAt !== null
  : value.completedAt === null && (value.trackingMode === 'checklist' ? value.progress === 0 : value.progress <= 99))
const dateShape = { plannedDate: localDate.nullable(), segment: z.enum(TODO_SEGMENTS).nullable(), dateRange: writeRange.nullable() }
export const workspaceDomainV2DateSchema = z.object(dateShape).strict().refine(value => value.dateRange === null || (value.plannedDate === null && value.segment === null))
const projectShape = { projectId: projectId.nullable(), stageKey: stageKey.nullable(), stageLinkSource: z.literal('manual').nullable() }
export const workspaceDomainV2ProjectSchema = z.object(projectShape).strict().refine(value => value.stageKey === null
  ? value.stageLinkSource === null
  : value.projectId !== null && value.stageLinkSource === 'manual')
export const workspaceDomainV2TodoCreateSchema = z.object({
  title, category: z.enum(TODO_CATEGORIES), isExtra: z.boolean(), ...dateShape,
  projectId: projectId.nullable(), stageKey: stageKey.nullable(), ...completionShape
}).strict().superRefine((value, ctx) => {
  if (!workspaceDomainV2CompletionSchema.safeParse(pick(value, WORKSPACE_DOMAIN_V2_TODO_UNITS.C)).success ||
      !workspaceDomainV2DateSchema.safeParse(pick(value, WORKSPACE_DOMAIN_V2_TODO_UNITS.D)).success ||
      !workspaceDomainV2ProjectSchema.safeParse({ projectId: value.projectId, stageKey: value.stageKey, stageLinkSource: value.stageKey ? 'manual' : null }).success) {
    ctx.addIssue({ code: 'custom', message: '待办目标组无效' })
  }
})
export const workspaceDomainV2TodoReadSchema = z.object({
  id: z.string().uuid(), title: z.string(), category: z.enum(TODO_CATEGORIES), isExtra: z.boolean().optional(),
  plannedDate: localDate.nullable(), segment: z.enum(TODO_SEGMENTS).nullable(), dateRange: readRange.nullable().optional(),
  projectId: z.string().nullable(), stageKey: readStageKey.nullable().optional(), stageLinkSource: z.literal('manual').nullable().optional(),
  status: z.enum(['open', 'completed', 'dismissed']), trackingMode: z.enum(TODO_TRACKING_MODES),
  progress: z.number(), progressBeforeComplete: z.number().nullable(), completedAt: z.string().nullable(),
  source: z.enum(['manual', 'schedule']), sourceScheduleId: z.string().nullable(), sourcePlannedDate: localDate.nullable(), sourceSegment: z.enum(TODO_SEGMENTS).nullable(),
  scheduleSyncEnabled: z.boolean(), dismissedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
}).strict()
export const workspaceDomainV2WorkLogCreateSchema = z.object({ day: localDate, totalMinutes: z.number().int().min(0).max(1440).nullable() }).strict()
export const workspaceDomainV2WorkLogReadSchema = z.object({
  day: localDate, totalMinutes: z.number().nullable().optional(), selfMediaMinutes: z.number(), aiMinutes: z.number(), otherWorkMinutes: z.number(), updatedAt: z.string()
}).strict()
export const workspaceDomainV2ProjectCatalogSchema = z.object({
  id: projectId, title: z.string(), status: z.enum(PROJECT_STATUSES), topicStageRole: z.enum(TOPIC_STAGE_ROLES).nullable(), trashedAt: z.string().nullable(), ledgerOnly: z.boolean(),
  stages: z.array(z.object({ key: stageKey, enabled: z.boolean(), completedAt: z.string().nullable(), status: z.enum(STAGE_TIME_STATUSES), revision: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).refine(values => new Set(values.map(value => value.key)).size === values.length)
}).strict()
const categoryMap = <T extends z.ZodType>(value: T) => z.object({ self_media: value, ai: value, life: value, other_work: value }).strict()
export const workspaceDomainV2TodoPreferencesSchema = z.object({
  todoCategoryLabels: categoryMap(z.string()), todoCategoryColors: categoryMap(z.enum(PROJECT_COLOR_TOKENS)), todoCategoryWeights: categoryMap(z.number()),
  companionTodoView: z.enum(['all', 'time', 'category']), companionTodoOrder: z.array(z.string().uuid())
}).strict()
export const workspaceDomainV2Schemas = {
  todoCreate: workspaceDomainV2TodoCreateSchema, todoRead: workspaceDomainV2TodoReadSchema,
  completion: workspaceDomainV2CompletionSchema, date: workspaceDomainV2DateSchema, project: workspaceDomainV2ProjectSchema,
  workLogCreate: workspaceDomainV2WorkLogCreateSchema, workLogRead: workspaceDomainV2WorkLogReadSchema,
  projectCatalog: workspaceDomainV2ProjectCatalogSchema, todoPreferences: workspaceDomainV2TodoPreferencesSchema
}
const readSchemas: Record<WorkspaceDomainV2Kind, z.ZodType> = {
  todo: workspaceDomainV2TodoReadSchema, work_log: workspaceDomainV2WorkLogReadSchema,
  project_catalog: workspaceDomainV2ProjectCatalogSchema, todo_preferences: workspaceDomainV2TodoPreferencesSchema
}
function object(value: unknown): value is WorkspaceDomainV2Body {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function pick(body: WorkspaceDomainV2Body, keys: readonly string[]): WorkspaceDomainV2Body {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]))
}
function inspectNumbers(body: unknown): 'valid' | 'unsafe_number' | 'unsupported_shape' {
  const pending: unknown[] = [body]
  const seen = new Set<object>()
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return 'unsafe_number'
    } else if (value !== null && typeof value === 'object') {
      if (!Array.isArray(value) && !object(value)) return 'unsupported_shape'
      if (seen.has(value)) continue
      seen.add(value)
      for (const child of Object.values(value)) pending.push(child)
    } else if (!['string', 'boolean'].includes(typeof value) && value !== null) return 'unsupported_shape'
  }
  return 'valid'
}
function inspectBody(kind: WorkspaceDomainV2Kind, id: string, body: WorkspaceDomainV2Body): Omit<WorkspaceDomainV2Inspection, 'rawJson' | 'body'> {
  const failure = (reason: WorkspaceDomainV2Inspection['reason']) => ({ supported: false, writable: false, reason })
  const numbers = inspectNumbers(body)
  if (numbers !== 'valid') return failure(numbers)
  if (!readSchemas[kind]?.safeParse(body).success) return failure('unsupported_shape')
  if ((kind === 'todo_preferences' && id !== 'workspace') || (kind === 'work_log' ? body.day !== id : kind !== 'todo_preferences' && body.id !== id)) return failure('identity_mismatch')
  const writable = kind === 'work_log' || (kind === 'todo' && body.source === 'manual')
  return { supported: true, writable, reason: writable ? null : 'record_read_only' }
}
export function workspaceDomainV2Inspect(kind: WorkspaceDomainV2Kind, id: string, rawJson: string): WorkspaceDomainV2Inspection {
  if (new TextEncoder().encode(rawJson).byteLength > WORKSPACE_V2_LIMITS.jsonBlobBytes) return { rawJson, body: null, supported: false, writable: false, reason: 'too_large' }
  let body: unknown
  try { body = JSON.parse(rawJson) } catch { return { rawJson, body: null, supported: false, writable: false, reason: 'invalid_json' } }
  if (!object(body)) return { rawJson, body: null, supported: false, writable: false, reason: 'invalid_json' }
  return { rawJson, body, ...inspectBody(kind, id, body) }
}
export function workspaceDomainV2Equal(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]]
  const seenLeft = new Set<object>()
  const seenRight = new Set<object>()
  while (pending.length) {
    const [a, b] = pending.pop()!
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b) || a !== b) return false
    } else if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
      if (a !== b) return false
    } else {
      if (seenLeft.has(a) || seenRight.has(b)) return false
      seenLeft.add(a); seenRight.add(b)
      if (Array.isArray(a) !== Array.isArray(b) || (!Array.isArray(a) && (!object(a) || !object(b)))) return false
      const aKeys = Object.keys(a).sort(), bKeys = Object.keys(b).sort()
      if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index]) || (Array.isArray(a) && a.length !== (b as unknown[]).length)) return false
      for (const key of aKeys) pending.push([(a as WorkspaceDomainV2Body)[key], (b as WorkspaceDomainV2Body)[key]])
    }
  }
  return true
}
export function workspaceDomainV2AssertBaseRaw(actual: { deleted: boolean; json: string }, historical: { deleted: boolean; json: string }): void {
  if (actual.deleted !== historical.deleted || actual.json !== historical.json) throw new Error('同步基线原文不匹配')
}
const snapshotSchema = z.object({ deleted: z.boolean(), body: z.record(z.string(), z.unknown()) }).strict()
const resolutionInputSchema = z.object({
  kind: z.enum(WORKSPACE_DOMAIN_V2_KINDS), id: z.string().min(1), baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currentRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), base: snapshotSchema.nullable(), next: snapshotSchema, current: snapshotSchema.nullable()
}).strict().refine(value => (value.baseRevision === 0) === (value.base === null) && (value.currentRevision === 0) === (value.current === null) && value.currentRevision >= value.baseRevision)
const rejected = (reason: 'invalid_change' | 'record_read_only' = 'invalid_change'): WorkspaceDomainV2Resolution => ({ status: 'rejected', reason })
const conflict = (reason: 'concurrent_change' | 'deleted_record' | 'identity_collision', conflictingUnits: string[]): WorkspaceDomainV2Resolution => ({ status: 'conflict', reason, conflictingUnits })
function result(status: 'apply' | 'noop', body: WorkspaceDomainV2Body, deleted: boolean, changedUnits: string[]): WorkspaceDomainV2Resolution {
  return { status, body: structuredClone(body), deleted, changedUnits }
}
function validChangedTodoUnit(unit: string, body: WorkspaceDomainV2Body): boolean {
  if (unit === 'title') return title.safeParse(body.title).success
  if (unit === 'category') return z.enum(TODO_CATEGORIES).safeParse(body.category).success
  if (unit === 'isExtra') return z.boolean().safeParse(body.isExtra).success
  if (unit === 'C') return workspaceDomainV2CompletionSchema.safeParse(pick(body, WORKSPACE_DOMAIN_V2_TODO_UNITS.C)).success
  if (unit === 'D') return workspaceDomainV2DateSchema.safeParse(pick(body, WORKSPACE_DOMAIN_V2_TODO_UNITS.D)).success
  return workspaceDomainV2ProjectSchema.safeParse(pick(body, WORKSPACE_DOMAIN_V2_TODO_UNITS.P)).success
}
function resolveTodo(input: WorkspaceDomainV2ResolutionInput): WorkspaceDomainV2Resolution {
  const { base, next, current } = input
  if (!z.string().uuid().safeParse(input.id).success) return rejected()
  if (base === null) {
    if (current !== null) return conflict('identity_collision', ['create'])
    if (next.deleted || !workspaceDomainV2TodoCreateSchema.safeParse(next.body).success) return rejected()
    return result('apply', next.body, false, ['create'])
  }
  if (!current || !inspectBody('todo', input.id, base.body).writable || !inspectBody('todo', input.id, current.body).writable) return rejected('record_read_only')
  if (next.deleted) {
    if (!workspaceDomainV2Equal(base.body, next.body)) return rejected()
    if (current.deleted) return result('noop', current.body, true, [])
    if (input.currentRevision !== input.baseRevision) return conflict('concurrent_change', ['deleted'])
    return result('apply', current.body, true, ['deleted'])
  }
  if (base.deleted || current.deleted || current.body.status === 'dismissed') return conflict('deleted_record', ['deleted'])
  if (!inspectBody('todo', input.id, next.body).writable) return rejected()
  const writableKeys = new Set<string>(Object.values(WORKSPACE_DOMAIN_V2_TODO_UNITS).flat())
  if (!workspaceDomainV2Equal(pick(base.body, Object.keys(base.body).filter(key => !writableKeys.has(key))), pick(next.body, Object.keys(next.body).filter(key => !writableKeys.has(key))))) return rejected()
  const changedUnits: string[] = [], conflictingUnits: string[] = []
  const merged: WorkspaceDomainV2Body = structuredClone(current.body)
  for (const [unit, keys] of Object.entries(WORKSPACE_DOMAIN_V2_TODO_UNITS)) {
    const baseUnit = pick(base.body, keys), nextUnit = pick(next.body, keys), currentUnit = pick(current.body, keys)
    if (workspaceDomainV2Equal(baseUnit, nextUnit)) continue
    if (!validChangedTodoUnit(unit, next.body)) return rejected()
    if (!workspaceDomainV2Equal(baseUnit, currentUnit) && !workspaceDomainV2Equal(currentUnit, nextUnit)) { conflictingUnits.push(unit); continue }
    if (workspaceDomainV2Equal(currentUnit, nextUnit)) continue
    for (const key of keys) { if (Object.hasOwn(next.body, key)) merged[key] = next.body[key]; else delete merged[key] }
    changedUnits.push(unit)
  }
  if (conflictingUnits.length) return conflict('concurrent_change', conflictingUnits)
  return result(changedUnits.length ? 'apply' : 'noop', merged, false, changedUnits)
}
function resolveWorkLog(input: WorkspaceDomainV2ResolutionInput): WorkspaceDomainV2Resolution {
  const { base, next, current } = input
  if (!isValidLocalDate(input.id)) return rejected()
  if (base === null) {
    if (current !== null) return conflict('identity_collision', ['create'])
    if (!workspaceDomainV2WorkLogCreateSchema.safeParse(next.body).success || next.body.day !== input.id || next.deleted !== (next.body.totalMinutes === null)) return rejected()
    return result('apply', next.body, next.deleted, ['create'])
  }
  if (!current || !inspectBody('work_log', input.id, base.body).writable || !inspectBody('work_log', input.id, current.body).writable) return rejected('record_read_only')
  if (!inspectBody('work_log', input.id, next.body).writable) return rejected()
  if (!workspaceDomainV2Equal(pick(base.body, Object.keys(base.body).filter(key => key !== 'totalMinutes')), pick(next.body, Object.keys(next.body).filter(key => key !== 'totalMinutes')))) return rejected()
  if (next.deleted && !workspaceDomainV2Equal(base.body, next.body)) return rejected()
  const totalChanged = !workspaceDomainV2Equal(pick(base.body, ['totalMinutes']), pick(next.body, ['totalMinutes']))
  if (!next.deleted && (totalChanged || base.deleted) && !z.number().int().min(0).max(1440).safeParse(next.body.totalMinutes).success) return rejected()
  if (input.currentRevision !== input.baseRevision) return conflict('concurrent_change', ['work_log'])
  if (next.deleted) return result(current.deleted ? 'noop' : 'apply', current.body, true, current.deleted ? [] : ['deleted'])
  if (base.deleted) return result('apply', { ...current.body, totalMinutes: next.body.totalMinutes, selfMediaMinutes: 0, aiMinutes: 0, otherWorkMinutes: 0 }, false, ['totalMinutes'])
  if (!totalChanged) return result('noop', current.body, false, [])
  return result('apply', { ...current.body, totalMinutes: next.body.totalMinutes }, false, ['totalMinutes'])
}
export function workspaceDomainV2Resolve(input: WorkspaceDomainV2ResolutionInput): WorkspaceDomainV2Resolution {
  if (!resolutionInputSchema.safeParse(input).success) return rejected()
  if (input.kind === 'project_catalog' || input.kind === 'todo_preferences') return rejected('record_read_only')
  if (input.base && input.current) {
    if (!inspectBody(input.kind, input.id, input.base.body).writable || !inspectBody(input.kind, input.id, input.current.body).writable) return rejected('record_read_only')
    if (input.baseRevision === input.currentRevision && (input.base.deleted !== input.current.deleted || !workspaceDomainV2Equal(input.base.body, input.current.body))) return rejected()
  }
  return input.kind === 'todo' ? resolveTodo(input) : resolveWorkLog(input)
}
