export interface CommandContext {
  requestId: string
  now: string
  workspaceId: string
}

export interface UndoableCommand<Input, Result, UndoPayload> {
  type: string
  isUndoPayload(payload: unknown): payload is UndoPayload
  execute(context: CommandContext, input: Input): {
    result: Result
    undoPayload: UndoPayload
  }
  undo(context: CommandContext, payload: UndoPayload): void
  redo?(context: CommandContext, input: Input): Result
}

export interface CommandExecutionMetadata<Input, Result> {
  entityType: string
  entityId(result: Result): string | null
  label: string
  auditInput(input: Input): unknown
}

export interface CommandExecutionResult<Result> {
  operationId: string
  result: Result
  replayed: boolean
  undoable: boolean
}
