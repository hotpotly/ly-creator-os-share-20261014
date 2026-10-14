import { z } from 'zod'
import {
  WORKSPACE_V2_LIMITS,
  workspaceV2AssertCapabilities,
  workspaceV2CanonicalJson,
  workspaceV2CapabilitiesRequestSchema,
  workspaceV2CapabilitiesResponseSchema,
  workspaceV2ManifestSchema,
  workspaceV2PayloadHash,
  workspaceV2RecordSchema,
  workspaceV2ScopeDigest,
  workspaceV2ScopesSchema,
  workspaceV2SnapshotPageRequestSchema,
  workspaceV2SnapshotPageResponseSchema,
  workspaceV2VerifyManifest,
  type WorkspaceV2Payload
} from './workspace-sync-v2'

const scopes = z.object({ sourceScopes: workspaceV2ScopesSchema, targetScopes: workspaceV2ScopesSchema }).strict()
const permissions = z.array(z.object({ scope: workspaceV2ScopesSchema.element, read: z.literal(true), write: z.boolean() }).strict()).max(8)
const capabilities = scopes.extend({
  request: workspaceV2CapabilitiesRequestSchema,
  response: workspaceV2CapabilitiesResponseSchema,
  approvedPermissions: permissions,
  sourcePermissions: permissions
}).strict()
const snapshot = scopes.extend({
  workspaceId: z.string().uuid(), deviceId: z.string().uuid(),
  knownSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  manifest: workspaceV2ManifestSchema,
  oldRecords: z.array(workspaceV2RecordSchema),
  records: z.array(workspaceV2RecordSchema)
}).strict()
const terminalReplay = z.object({
  request: workspaceV2SnapshotPageRequestSchema,
  verifiedResponse: workspaceV2SnapshotPageResponseSchema,
  response: workspaceV2SnapshotPageResponseSchema
}).strict()
const same = (left: unknown, right: unknown): boolean => workspaceV2CanonicalJson(left) === workspaceV2CanonicalJson(right)
const payloadLength = (value: WorkspaceV2Payload): number => value.encoding === 'json' ? value.byteLength : value.ref.byteLength

export function workspaceScopeExtensionAssertScopes(value: unknown): void {
  const input = scopes.parse(value)
  if (input.targetScopes.length <= input.sourceScopes.length || input.sourceScopes.some(scope => !input.targetScopes.includes(scope))) throw new Error('目标范围必须是当前范围的严格超集')
}

export function workspaceScopeExtensionAssertCapabilities(value: unknown): void {
  const input = capabilities.parse(value)
  workspaceScopeExtensionAssertScopes({ sourceScopes: input.sourceScopes, targetScopes: input.targetScopes })
  workspaceV2AssertCapabilities(input.request, input.response, input.approvedPermissions)
  if (!same(input.approvedPermissions.map(permission => permission.scope), input.targetScopes) || input.approvedPermissions.some(permission => permission.scope === 'project.catalog' && permission.write)) throw new Error('批准集合必须精确对应扩展目标')
  if (!same(input.sourcePermissions.map(permission => permission.scope), input.sourceScopes) || input.sourcePermissions.some(permission => (permission.scope === 'project.catalog' && permission.write) || !same(permission, input.response.permissions.find(grant => grant.scope === permission.scope) ?? null))) throw new Error('旧范围权限在扩展期间发生变化')
  if (!same(input.request.clientScopes, input.targetScopes) || !same(input.response.supportedScopes, input.targetScopes)) throw new Error('扩展目标必须完整获得读取授权')
}

export async function workspaceScopeExtensionAssertSnapshot(value: unknown): Promise<void> {
  const input = await snapshot.parseAsync(value)
  workspaceScopeExtensionAssertScopes({ sourceScopes: input.sourceScopes, targetScopes: input.targetScopes })
  if (input.manifest.workspaceId !== input.workspaceId || input.manifest.deviceId !== input.deviceId || !same(input.manifest.scopes, input.targetScopes) || input.manifest.scopeDigest !== await workspaceV2ScopeDigest(input.targetScopes) || input.manifest.through < input.knownSequence) throw new Error('扩展清单身份、范围或固定水位不匹配')
  await workspaceV2VerifyManifest(input.manifest, input.records)
  const byIdentity = new Map(input.records.map(record => [workspaceV2CanonicalJson([record.kind, record.id]), record]))
  const oldIdentities = new Set<string>(), lengths = new Map<string, number>(), temporary = new Set<string>()
  let temporaryBytes = 0
  for (const record of [...input.oldRecords, ...input.records]) {
    const hash = workspaceV2PayloadHash(record.payload), length = payloadLength(record.payload)
    if (lengths.has(hash) && lengths.get(hash) !== length) throw new Error('相同正文摘要的长度不一致')
    lengths.set(hash, length)
  }
  for (const record of input.records) {
    const hash = workspaceV2PayloadHash(record.payload)
    if (temporary.has(hash)) continue
    temporary.add(hash)
    temporaryBytes += payloadLength(record.payload)
    if (temporaryBytes > WORKSPACE_V2_LIMITS.deviceTemporaryBytes) throw new Error('扩展快照必要正文超过暂存限额')
  }
  for (const before of input.oldRecords) {
    const identity = workspaceV2CanonicalJson([before.kind, before.id])
    if (oldIdentities.has(identity) || !input.sourceScopes.includes(before.metadata.scope) || before.sequence > input.knownSequence) throw new Error('旧基线身份、范围或水位无效')
    oldIdentities.add(identity)
    const after = byIdentity.get(identity)
    if (!after || after.revision < before.revision || after.sequence < before.sequence || (after.revision > before.revision && after.sequence <= before.sequence)) throw new Error('扩展清单缺失旧实体或版本回退')
    if (after.revision === before.revision && (after.sequence !== before.sequence || after.deleted !== before.deleted || workspaceV2PayloadHash(after.payload) !== workspaceV2PayloadHash(before.payload) || payloadLength(after.payload) !== payloadLength(before.payload))) throw new Error('同一基线版本正文发生变化')
  }
}

export async function workspaceScopeExtensionAssertTerminalReplay(value: unknown): Promise<void> {
  const input = await terminalReplay.parseAsync(value)
  for (const response of [input.verifiedResponse, input.response]) {
    if (response.workspaceId !== input.request.workspaceId || response.deviceId !== input.request.deviceId || response.manifestId !== input.request.manifestId || !response.done || response.next !== null || response.records.length > input.request.limit) throw new Error('终页复核身份或分页状态不匹配')
  }
  if (!same(input.verifiedResponse, input.response)) throw new Error('终页复核与已验证原页不同')
}

export async function workspaceScopeExtensionValidate(schema: string, value: unknown): Promise<void> {
  switch (schema) {
    case 'scopes': return workspaceScopeExtensionAssertScopes(value)
    case 'capabilities': return workspaceScopeExtensionAssertCapabilities(value)
    case 'snapshot': return workspaceScopeExtensionAssertSnapshot(value)
    case 'terminalReplay': return workspaceScopeExtensionAssertTerminalReplay(value)
    default: throw new Error('未知范围扩展校验器')
  }
}
