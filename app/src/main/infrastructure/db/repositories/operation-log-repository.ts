import type BetterSqlite3 from 'better-sqlite3'
import type { OperationLogStatus } from '../../../../shared/domain'

export interface OperationLogRecord {
  id: string
  workspaceId: string
  sessionId: string
  requestId: string
  commandType: string
  entityType: string
  entityId: string | null
  label: string
  forwardPayloadJson: string
  resultJson: string | null
  inversePayloadJson: string | null
  inversePayloadBytes: number
  status: OperationLogStatus
  createdAt: string
  updatedAt: string
  undoneAt: string | null
  redoneAt: string | null
  expiresAt: string | null
}

export type InsertOperationLogInput = OperationLogRecord

interface OperationLogRow {
  id: string
  workspace_id: string
  session_id: string
  request_id: string
  command_type: string
  entity_type: string
  entity_id: string | null
  label: string
  forward_payload_json: string
  result_json: string | null
  inverse_payload_json: string | null
  inverse_payload_bytes: number
  status: OperationLogStatus
  created_at: string
  updated_at: string
  undone_at: string | null
  redone_at: string | null
  expires_at: string | null
}

function mapOperationLog(row: OperationLogRow): OperationLogRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    requestId: row.request_id,
    commandType: row.command_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    label: row.label,
    forwardPayloadJson: row.forward_payload_json,
    resultJson: row.result_json,
    inversePayloadJson: row.inverse_payload_json,
    inversePayloadBytes: row.inverse_payload_bytes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    undoneAt: row.undone_at,
    redoneAt: row.redone_at,
    expiresAt: row.expires_at
  }
}

export class OperationLogRepository {
  constructor(private readonly database: BetterSqlite3.Database) {}

  insert(input: InsertOperationLogInput): OperationLogRecord {
    this.database.prepare(`
      INSERT INTO operation_log(
        id,workspace_id,session_id,request_id,command_type,entity_type,entity_id,label,forward_payload_json,result_json,
        inverse_payload_json,inverse_payload_bytes,status,created_at,updated_at,undone_at,redone_at,expires_at
      ) VALUES(
        @id,@workspaceId,@sessionId,@requestId,@commandType,@entityType,@entityId,@label,@forwardPayloadJson,@resultJson,
        @inversePayloadJson,@inversePayloadBytes,@status,@createdAt,@updatedAt,@undoneAt,@redoneAt,@expiresAt
      )
    `).run(input)
    return input
  }

  findById(id: string): OperationLogRecord | null {
    const row = this.database.prepare('SELECT * FROM operation_log WHERE id=?').get(id) as OperationLogRow | undefined
    return row ? mapOperationLog(row) : null
  }

  findByRequestId(requestId: string): OperationLogRecord | null {
    const row = this.database.prepare('SELECT * FROM operation_log WHERE request_id=?').get(requestId) as OperationLogRow | undefined
    return row ? mapOperationLog(row) : null
  }

  findLatestUndoable(sessionId: string, now: string): OperationLogRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM operation_log
      WHERE session_id=? AND status='undoable' AND inverse_payload_json IS NOT NULL AND expires_at>?
      ORDER BY created_at DESC,rowid DESC LIMIT 1
    `).get(sessionId, now) as OperationLogRow | undefined
    return row ? mapOperationLog(row) : null
  }

  findUndoableByEntity(sessionId: string, entityType: string, entityId: string, now: string): OperationLogRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM operation_log
      WHERE session_id=? AND entity_type=? AND entity_id=? AND status='undoable' AND expires_at>?
      ORDER BY created_at DESC,rowid DESC LIMIT 1
    `).get(sessionId, entityType, entityId, now) as OperationLogRow | undefined
    return row ? mapOperationLog(row) : null
  }

  findLatestByEntity(entityType: string, entityId: string): OperationLogRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM operation_log
      WHERE entity_type=? AND entity_id=?
      ORDER BY created_at DESC,rowid DESC LIMIT 1
    `).get(entityType, entityId) as OperationLogRow | undefined
    return row ? mapOperationLog(row) : null
  }

  markUndone(id: string, undoneAt: string): void {
    this.database.prepare(`
      UPDATE operation_log
      SET status='undone',undone_at=?,updated_at=?,inverse_payload_json=NULL,inverse_payload_bytes=0
      WHERE id=? AND status='undoable'
    `).run(undoneAt, undoneAt, id)
  }

  markUndoneByEntity(sessionId: string, entityType: string, entityId: string, undoneAt: string): void {
    this.database.prepare(`
      UPDATE operation_log
      SET status='undone',undone_at=?,updated_at=?,inverse_payload_json=NULL,inverse_payload_bytes=0
      WHERE session_id=? AND entity_type=? AND entity_id=? AND status='undoable'
    `).run(undoneAt, undoneAt, sessionId, entityType, entityId)
  }

  markConflicted(id: string, updatedAt: string): void {
    this.database.prepare(`
      UPDATE operation_log
      SET status='conflicted',updated_at=?,inverse_payload_json=NULL,inverse_payload_bytes=0
      WHERE id=? AND status='undoable'
    `).run(updatedAt, id)
  }

  markConflictedByEntity(sessionId: string, entityType: string, entityId: string, updatedAt: string): void {
    this.database.prepare(`
      UPDATE operation_log
      SET status='conflicted',updated_at=?,inverse_payload_json=NULL,inverse_payload_bytes=0
      WHERE session_id=? AND entity_type=? AND entity_id=? AND status='undoable'
    `).run(updatedAt, sessionId, entityType, entityId)
  }

  downgradePreviousSessions(currentSessionId: string, updatedAt: string): number {
    const result = this.database.prepare(`
      UPDATE operation_log
      SET status='audit_only',updated_at=?,inverse_payload_json=NULL,inverse_payload_bytes=0
      WHERE session_id<>? AND status='undoable'
    `).run(updatedAt, currentSessionId)
    return result.changes
  }

  clearExpiredUndoPayloads(now: string): number {
    const result = this.database.prepare(`
      UPDATE operation_log
      SET status='audit_only',updated_at=?,inverse_payload_json=NULL,inverse_payload_bytes=0
      WHERE status='undoable' AND expires_at<=?
    `).run(now, now)
    return result.changes
  }
}
