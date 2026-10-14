import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { WorkspaceUndoResult, WorkspaceUndoState } from '../../../shared/domain'
import {
  DEFAULT_UNDO_TTL_MS,
  serializeUndoPayload,
  UndoConflictError,
  undoExpiresAt
} from '../../domain/undo-policy'
import {
  type CommandContext,
  type CommandExecutionMetadata,
  type CommandExecutionResult,
  type UndoableCommand
} from './contracts'
import {
  OperationLogRepository,
  type OperationLogRecord
} from '../../infrastructure/db/repositories/operation-log-repository'

type RegisteredCommand = UndoableCommand<unknown, unknown, unknown>

export interface CommandExecutorOptions {
  sessionId: string
  workspaceId: string
  undoTtlMs?: number
  now?: () => string
}

export class CommandExecutor {
  private readonly commands = new Map<string, RegisteredCommand>()
  private readonly now: () => string
  private readonly undoTtlMs: number

  constructor(
    private readonly database: BetterSqlite3.Database,
    private readonly operationLogs: OperationLogRepository,
    private readonly options: CommandExecutorOptions
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.undoTtlMs = options.undoTtlMs ?? DEFAULT_UNDO_TTL_MS
  }

  register<Input, Result, UndoPayload>(command: UndoableCommand<Input, Result, UndoPayload>): void {
    if (this.commands.has(command.type)) throw new Error(`撤销命令重复注册：${command.type}`)
    this.commands.set(command.type, command as RegisteredCommand)
  }

  initializeSession(): void {
    const timestamp = this.now()
    this.database.transaction(() => this.operationLogs.downgradePreviousSessions(this.options.sessionId, timestamp))()
    try {
      this.operationLogs.clearExpiredUndoPayloads(timestamp)
    } catch {
      // 过期载荷维护失败不能阻断App启动；后续读取撤销栈时会再次尝试。
    }
  }

  execute<Input, Result, UndoPayload>(
    command: UndoableCommand<Input, Result, UndoPayload>,
    input: Input,
    requestId: string,
    metadata: CommandExecutionMetadata<Input, Result>
  ): CommandExecutionResult<Result> {
    if (this.commands.get(command.type) !== command) throw new Error(`撤销命令尚未注册：${command.type}`)
    const forwardPayloadJson = JSON.stringify(metadata.auditInput(input))
    if (forwardPayloadJson === undefined) throw new Error('命令审计输入无法序列化')
    const replay = this.replay<Result>(command.type, requestId, forwardPayloadJson)
    if (replay) return replay
    return this.database.transaction(() => {
      const concurrentReplay = this.replay<Result>(command.type, requestId, forwardPayloadJson)
      if (concurrentReplay) return concurrentReplay
      const timestamp = this.now()
      const context: CommandContext = { requestId, now: timestamp, workspaceId: this.options.workspaceId }
      const executed = command.execute(context, input)
      const resultJson = JSON.stringify(executed.result)
      if (resultJson === undefined) throw new Error('命令结果无法序列化')
      const inverse = command.isUndoPayload(executed.undoPayload)
        ? serializeUndoPayload(executed.undoPayload)
        : { json: null, bytes: 0, reason: 'unsafe' as const }
      const undoable = inverse.reason === 'safe'
      const operationId = randomUUID()
      this.operationLogs.insert({
        id: operationId,
        workspaceId: this.options.workspaceId,
        sessionId: this.options.sessionId,
        requestId,
        commandType: command.type,
        entityType: metadata.entityType,
        entityId: metadata.entityId(executed.result),
        label: metadata.label,
        forwardPayloadJson,
        resultJson,
        inversePayloadJson: inverse.json,
        inversePayloadBytes: undoable ? inverse.bytes : 0,
        status: undoable ? 'undoable' : 'audit_only',
        createdAt: timestamp,
        updatedAt: timestamp,
        undoneAt: null,
        redoneAt: null,
        expiresAt: undoable ? undoExpiresAt(timestamp, this.undoTtlMs) : null
      })
      return { operationId, result: executed.result, replayed: false, undoable }
    })()
  }

  getUndoState(): WorkspaceUndoState {
    const timestamp = this.now()
    this.operationLogs.clearExpiredUndoPayloads(timestamp)
    const operation = this.operationLogs.findLatestUndoable(this.options.sessionId, timestamp)
    return operation
      ? {
          canUndo: true,
          operationId: operation.id,
          commandType: operation.commandType,
          label: operation.label,
          createdAt: operation.createdAt
        }
      : { canUndo: false, operationId: null, commandType: null, label: null, createdAt: null }
  }

  undo(operationId?: string | null): WorkspaceUndoResult {
    const timestamp = this.now()
    this.operationLogs.clearExpiredUndoPayloads(timestamp)
    const operation = this.operationLogs.findLatestUndoable(this.options.sessionId, timestamp)
    if (operationId && operation?.id !== operationId) throw new Error('撤销栈已经变化，请重试')
    this.assertUndoable(operation, timestamp)
    const command = this.commands.get(operation.commandType)
    if (!command) throw new Error('当前版本无法撤销这项操作')
    let payload: unknown
    try {
      payload = JSON.parse(operation.inversePayloadJson)
    } catch {
      throw new Error('撤销记录已损坏')
    }
    if (!command.isUndoPayload(payload)) throw new Error('撤销记录已损坏')
    const context: CommandContext = { requestId: `undo:${operation.id}`, now: timestamp, workspaceId: this.options.workspaceId }
    try {
      this.database.transaction(() => {
        command.undo(context, payload)
        this.operationLogs.markUndone(operation.id, timestamp)
      })()
    } catch (error) {
      if (error instanceof UndoConflictError) this.operationLogs.markConflicted(operation.id, timestamp)
      throw error
    }
    return {
      operationId: operation.id,
      commandType: operation.commandType,
      entityType: operation.entityType,
      entityId: operation.entityId,
      label: operation.label,
      undoneAt: timestamp
    }
  }

  private replay<Result>(commandType: string, requestId: string, forwardPayloadJson: string): CommandExecutionResult<Result> | null {
    const operation = this.operationLogs.findByRequestId(requestId)
    if (!operation) return null
    if (operation.commandType !== commandType) throw new Error('requestId已被其他操作使用')
    if (operation.forwardPayloadJson !== forwardPayloadJson) throw new Error('requestId对应的操作参数不一致')
    if (operation.status === 'undone') throw new Error('这个请求对应的操作已经撤销，不能重复执行')
    if (operation.status === 'conflicted') throw new Error('这个请求对应的操作已发生冲突，不能重复执行')
    if (!operation.resultJson) throw new Error('请求已经处理，不能重复执行')
    return {
      operationId: operation.id,
      result: JSON.parse(operation.resultJson) as Result,
      replayed: true,
      undoable: operation.status === 'undoable' && operation.sessionId === this.options.sessionId
    }
  }

  private assertUndoable(operation: OperationLogRecord | null, now: string): asserts operation is OperationLogRecord & { inversePayloadJson: string } {
    if (!operation) throw new Error('当前没有可撤销的操作')
    if (operation.sessionId !== this.options.sessionId) throw new Error('只能撤销本次App运行期间的操作')
    if (operation.status !== 'undoable' || !operation.inversePayloadJson) throw new Error('这项操作已无法撤销')
    if (!operation.expiresAt || operation.expiresAt <= now) throw new Error('这项操作已过期，无法撤销')
  }
}
