import { createHash } from 'node:crypto'
import type { UpdateTodoInput } from '../../shared/domain'
import { WORKSPACE_BATCH_LIMIT, WORKSPACE_BYTE_LIMIT, workspaceSyncRequestSchema, type WorkspaceOperation, type WorkspaceReceipt, type WorkspaceRemoteRecord, type WorkspaceSyncRequest, type WorkspaceSyncResponse } from '../../shared/workspace-sync'
import type { WorkspaceRepository } from './repository'

interface ChangeRow {
  sequence: number
  kind: 'todo' | 'work_log'
  entity_id: string
  revision: number
  deleted: number
  data_json: string
  metadata_json: string
}

export class WorkspaceSyncError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message) }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function record(row: ChangeRow): WorkspaceRemoteRecord {
  return { kind: row.kind, id: row.entity_id, revision: row.revision, sequence: row.sequence, deleted: row.deleted === 1, data: JSON.parse(row.data_json), metadata: JSON.parse(row.metadata_json) }
}

export class WorkspaceSyncRepository {
  constructor(private readonly domain: WorkspaceRepository) {}

  latest(kind: WorkspaceOperation['kind'], id: string): WorkspaceRemoteRecord | null {
    const row = this.domain.native.prepare('SELECT * FROM workspace_sync_changes WHERE kind=? AND entity_id=? ORDER BY revision DESC LIMIT 1').get(kind, id) as ChangeRow | undefined
    return row ? record(row) : null
  }

  private watermark(): number {
    return (this.domain.native.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM workspace_sync_changes').get() as { value: number }).value
  }

  synchronize(input: WorkspaceSyncRequest, counter: number, finalize?: (response: WorkspaceSyncResponse) => void): { response: WorkspaceSyncResponse; changed: boolean } {
    const request = workspaceSyncRequestSchema.parse(input)
    if (Buffer.byteLength(JSON.stringify(request)) > WORKSPACE_BYTE_LIMIT) throw new WorkspaceSyncError('request_too_large', '同步内容过大', 413)
    if (!Number.isSafeInteger(counter) || counter < 1) throw new WorkspaceSyncError('invalid_counter', '同步计数无效')
    return this.domain.native.transaction(() => {
      const credential = this.domain.getMobileSyncDeviceCredential(request.deviceId)
      if (!credential || credential.protocolVersion !== 2 || credential.trustState !== 'trusted_v2') throw new WorkspaceSyncError('device_revoked', '设备已撤销或未配对', 401)
      if (request.workspaceId !== this.domain.getOrCreateMobileSyncServiceId()) throw new WorkspaceSyncError('wrong_workspace', '工作台身份不匹配', 403)
      const previousCounter = this.domain.native.prepare('SELECT counter FROM workspace_sync_devices WHERE device_id=?').get(request.deviceId) as { counter: number } | undefined
      if (previousCounter && counter <= previousCounter.counter) throw new WorkspaceSyncError('replayed_request', '请求已处理', 409)
      const before = this.watermark()
      if (request.cursor > before || (request.through !== null && request.through > before)) throw new WorkspaceSyncError('cursor_ahead', '工作台历史已回退，请保留本地资料并重新检查', 409)
      this.domain.native.prepare('INSERT INTO workspace_sync_devices(device_id,counter) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET counter=excluded.counter').run(request.deviceId, counter)
      const receipts = request.operations.map(operation => this.apply(request.deviceId, operation))
      const through = request.through ?? this.watermark()
      const response: WorkspaceSyncResponse = {
        protocolVersion: 1, workspaceId: request.workspaceId, deviceId: request.deviceId,
        receipts, changes: [], cursor: request.cursor, through, hasMore: request.cursor < through
      }
      if (Buffer.byteLength(JSON.stringify(response)) > WORKSPACE_BYTE_LIMIT) throw new WorkspaceSyncError('response_too_large', '请减少本次同步的待办数量', 413)
      const rows = this.domain.native.prepare('SELECT * FROM workspace_sync_changes WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?').all(request.cursor, through, WORKSPACE_BATCH_LIMIT) as ChangeRow[]
      for (const row of rows) {
        const next = record(row)
        const candidate = { ...response, changes: [...response.changes, next], cursor: next.sequence, hasMore: next.sequence < through }
        if (Buffer.byteLength(JSON.stringify(candidate)) > WORKSPACE_BYTE_LIMIT) {
          if (!response.changes.length && !receipts.length) throw new WorkspaceSyncError('record_too_large', '单条待办超出同步大小限制', 413)
          break
        }
        response.changes.push(next)
        response.cursor = next.sequence
      }
      response.hasMore = response.cursor < through
      finalize?.(response)
      return { response, changed: this.watermark() !== before }
    })()
  }

  private apply(deviceId: string, operation: WorkspaceOperation): WorkspaceReceipt {
    const hash = createHash('sha256').update(canonical(operation)).digest('hex')
    const previous = this.domain.native.prepare('SELECT payload_hash,receipt_json FROM workspace_sync_receipts WHERE device_id=? AND operation_id=?').get(deviceId, operation.operationId) as { payload_hash: string; receipt_json: string } | undefined
    if (previous) {
      if (previous.payload_hash !== hash) throw new WorkspaceSyncError('operation_reused', '操作标识已用于不同内容', 409)
      return JSON.parse(previous.receipt_json) as WorkspaceReceipt
    }
    const current = this.latest(operation.kind, operation.id)
    if (operation.base) {
      const row = this.domain.native.prepare('SELECT * FROM workspace_sync_changes WHERE kind=? AND entity_id=? AND revision=?').get(operation.kind, operation.id, operation.baseRevision) as ChangeRow | undefined
      if (!row || canonical({ deleted: row.deleted === 1, data: JSON.parse(row.data_json) }) !== canonical(operation.base)) throw new WorkspaceSyncError('invalid_baseline', '同步基线与历史不符', 409)
    }
    let conflict = Boolean(current && operation.base === null)
    const fields = Object.keys(operation.next.data).filter(key => !operation.base || canonical(operation.next.data[key]) !== canonical(operation.base.data[key]))
    const deletionChanged = operation.base?.deleted !== operation.next.deleted
    if (current && operation.base) {
      if (current.deleted && !operation.next.deleted && (operation.kind === 'todo' || !operation.base.deleted || current.revision !== operation.baseRevision)) conflict = true
      if (operation.next.deleted && current.revision !== operation.baseRevision) conflict = true
      if (operation.kind === 'work_log' && current.revision !== operation.baseRevision) conflict = true
      if (operation.kind === 'todo') {
        const editable = current.metadata.editableFields as string[]
        if (fields.some(key => !editable.includes(key)) || (deletionChanged && current.metadata.deletable !== true)) conflict = true
        if (fields.some(key => canonical(current.data[key]) !== canonical(operation.base!.data[key]))) conflict = true
      }
    }
    if (!conflict && (!current || fields.length || deletionChanged)) this.applyDomain(operation, current, fields)
    const updated = this.latest(operation.kind, operation.id)
    if (!updated) throw new WorkspaceSyncError('missing_record', '同步对象不存在')
    const receipt: WorkspaceReceipt = { operationId: operation.operationId, localRevision: operation.localRevision, status: conflict ? 'conflict' : 'accepted', record: updated }
    this.domain.native.prepare('INSERT INTO workspace_sync_receipts(device_id,operation_id,payload_hash,receipt_json) VALUES(?,?,?,?)').run(deviceId, operation.operationId, hash, JSON.stringify(receipt))
    return receipt
  }

  private applyDomain(operation: WorkspaceOperation, current: WorkspaceRemoteRecord | null, fields: string[]): void {
    const { id, kind, next } = operation
    if (kind === 'work_log') {
      const minutes = next.deleted ? null : next.data.minutes as number | null
      this.domain.setWorkspaceWorkLog(id, minutes)
      if (minutes === null && !this.latest(kind, id)) {
        this.domain.native.prepare('INSERT INTO workspace_sync_changes(kind,entity_id,revision,deleted,data_json,metadata_json) VALUES(?,?,1,1,?,?)').run(kind, id, JSON.stringify({ minutes: null }), JSON.stringify(this.domain.getDailyWorkLog(id)))
      }
      return
    }
    if (!current) {
      this.domain.importWorkspaceTodo(id, {
        title: next.data.title as string, category: next.data.category as 'self_media' | 'ai' | 'life' | 'other_work',
        plannedDate: next.data.plannedDate as string | null, segment: null, projectId: null, trackingMode: 'checklist', progress: 0
      }, next.data.completedAt as string | null)
      if (next.deleted) this.domain.dismissTodoItem(id)
      return
    }
    if (next.deleted) {
      if (!current.deleted) this.domain.dismissTodoItem(id)
      return
    }
    const patch: UpdateTodoInput = {}
    if (fields.includes('title')) patch.title = next.data.title as string
    if (fields.includes('category')) patch.category = next.data.category as UpdateTodoInput['category']
    if (fields.includes('plannedDate')) patch.plannedDate = next.data.plannedDate as string | null
    const completedAt = fields.includes('completedAt') ? next.data.completedAt as string | null : undefined
    this.domain.updateWorkspaceTodo(id, patch, completedAt)
  }
}
