import BetterSqlite3 from 'better-sqlite3'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandExecutor } from '../../src/main/application/commands/command-executor'
import type { UndoableCommand } from '../../src/main/application/commands/contracts'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations } from '../../src/main/db/migrations'
import { OperationLogRepository } from '../../src/main/infrastructure/db/repositories/operation-log-repository'

const roots: string[] = []
const databases: BetterSqlite3.Database[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-operation-log-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

function createExecutor(now: () => string, undoTtlMs = 60_000): {
  database: BetterSqlite3.Database
  executor: CommandExecutor
} {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runMigrations(database)
  database.exec('CREATE TABLE command_facts (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)')
  const executor = new CommandExecutor(database, new OperationLogRepository(database), {
    sessionId: 'test-session',
    workspaceId: 'test-workspace',
    undoTtlMs,
    now
  })
  executor.initializeSession()
  return { database, executor }
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('operation log and undo command foundation', () => {
  it('records project pinning as a reversible database operation', async () => {
    const { store } = await createStore()
    expect(store.repository.getProject('ssd', false).isPinned).toBe(false)
    expect(store.repository.setProjectPinned('ssd', true, '99999999-9999-4999-8999-999999999999').isPinned).toBe(true)
    const state = store.repository.getWorkspaceUndoState()
    expect(state).toMatchObject({ canUndo: true, commandType: 'project.pinning', label: '加入常用' })
    store.repository.undoWorkspaceOperation(state.operationId)
    expect(store.repository.getProject('ssd', false).isPinned).toBe(false)
    expect(store.repository.native.prepare(`SELECT status FROM operation_log WHERE request_id=?`).get('99999999-9999-4999-8999-999999999999')).toEqual({
      status: 'undone'
    })
    store.close()
  })

  it('does not overwrite a newer pinning choice when undoing', async () => {
    const { store } = await createStore()
    store.repository.setProjectPinned('ssd', true, '99999999-9999-4999-8999-999999999991')
    const operationId = store.repository.getWorkspaceUndoState().operationId!
    store.repository.native.prepare(`UPDATE projects SET is_pinned=0 WHERE id='ssd'`).run()
    expect(() => store.repository.undoWorkspaceOperation(operationId)).toThrow('常用状态已经发生其他变化')
    expect(store.repository.native.prepare(`SELECT status FROM operation_log WHERE id=?`).get(operationId)).toEqual({ status: 'conflicted' })
    expect(store.repository.getProject('ssd', false).isPinned).toBe(false)
    store.close()
  })

  it('writes the stage fact and operation log once for an idempotent request', async () => {
    const { store } = await createStore()
    const first = store.repository.setModuleCompleted('ios', 'outline', true, '11111111-1111-4111-8111-111111111111')
    const replay = store.repository.setModuleCompleted('ios', 'outline', true, '11111111-1111-4111-8111-111111111111')
    expect(replay.eventId).toBe(first.eventId)
    expect(() => store.repository.setModuleCompleted('ios', 'outline', false, '11111111-1111-4111-8111-111111111111')).toThrow('操作参数不一致')
    expect(store.repository.native.prepare(`SELECT COUNT(*) AS count FROM stage_time_events WHERE record_id=?`).get(first.record.id)).toEqual({ count: 1 })
    expect(store.repository.native.prepare(`SELECT status,entity_id AS entityId FROM operation_log WHERE request_id=?`).get('11111111-1111-4111-8111-111111111111')).toEqual({
      status: 'undoable',
      entityId: first.eventId
    })
    store.close()
  })

  it('undoes the latest current-session stage command and keeps the audit row', async () => {
    const { store } = await createStore()
    store.repository.setModuleCompleted('ios', 'outline', true, '22222222-2222-4222-8222-222222222222')
    const state = store.repository.getWorkspaceUndoState()
    expect(state).toMatchObject({ canUndo: true, commandType: 'project.stage-completion', label: '完成阶段' })
    expect(store.repository.undoWorkspaceOperation(state.operationId)).toMatchObject({
      operationId: state.operationId,
      commandType: 'project.stage-completion'
    })
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'outline')?.status).toBe('not_started')
    expect(store.repository.native.prepare(`SELECT status,inverse_payload_json AS inversePayload FROM operation_log WHERE id=?`).get(state.operationId)).toEqual({
      status: 'undone',
      inversePayload: null
    })
    expect(store.repository.getWorkspaceUndoState().canUndo).toBe(false)
    store.close()
  })

  it('downgrades old-session undo data to audit-only when the workspace reopens', async () => {
    const { store, directory } = await createStore()
    store.repository.setModuleCompleted('ios', 'outline', true, '33333333-3333-4333-8333-333333333333')
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getWorkspaceUndoState().canUndo).toBe(false)
    expect(reopened.repository.native.prepare(`SELECT status,inverse_payload_json AS inversePayload FROM operation_log WHERE request_id=?`).get('33333333-3333-4333-8333-333333333333')).toEqual({
      status: 'audit_only',
      inversePayload: null
    })
    reopened.close()
  })

  it('keeps stage completion and later time edits in strict LIFO order', async () => {
    const { store } = await createStore()
    store.repository.setModuleCompleted('ios', 'outline', true, '44444444-4444-4444-8444-444444444444')
    const completionOperationId = store.repository.getWorkspaceUndoState().operationId!
    store.repository.updateStageTime('ios', 'outline', { actualEffortHalfDayUnits: 2, source: 'manual' }, '44444444-4444-4444-8444-444444444445')
    const updateOperationId = store.repository.getWorkspaceUndoState().operationId!
    expect(() => store.repository.undoWorkspaceOperation(completionOperationId)).toThrow('撤销栈已经变化')
    expect(store.repository.native.prepare(`SELECT status FROM operation_log WHERE id=?`).get(completionOperationId)).toEqual({ status: 'undoable' })
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'outline')).toMatchObject({
      status: 'completed',
      actualEffortHalfDayUnits: 2
    })
    store.repository.undoWorkspaceOperation(updateOperationId)
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'outline')).toMatchObject({
      status: 'completed',
      actualEffortHalfDayUnits: null
    })
    store.repository.undoWorkspaceOperation(completionOperationId)
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'outline')?.status).toBe('not_started')
    store.close()
  })

  it('keeps the existing stage Toast undo route consistent with the operation stack', async () => {
    const { store } = await createStore()
    const completed = store.repository.setModuleCompleted('ios', 'outline', true, '88888888-8888-4888-8888-888888888888')
    store.repository.updateStageTime('ios', 'outline', { actualEffortHalfDayUnits: 2, source: 'manual' }, '88888888-8888-4888-8888-888888888889')
    expect(() => store.repository.undoStageTimeEvent('ios', completed.eventId)).toThrow('撤销栈已经变化')
    expect(store.repository.native.prepare(`SELECT status FROM operation_log WHERE request_id=?`).get('88888888-8888-4888-8888-888888888888')).toEqual({
      status: 'undoable'
    })
    expect(store.repository.getWorkspaceUndoState()).toMatchObject({ canUndo: true, commandType: 'project.stage-time-update' })
    store.close()
  })

  it('does not let the legacy Toast route bypass expiry or session boundaries', async () => {
    const first = await createStore()
    const expired = first.store.repository.setModuleCompleted('ios', 'outline', true, '88888888-8888-4888-8888-888888888881')
    first.store.repository.native.prepare(`UPDATE operation_log SET expires_at='2000-01-01T00:00:00.000Z' WHERE entity_id=?`).run(expired.eventId)
    expect(() => first.store.repository.undoStageTimeEvent('ios', expired.eventId)).toThrow('已过期')

    const restarted = first.store.repository.setModuleCompleted('ios', 'script', true, '88888888-8888-4888-8888-888888888882')
    first.store.close()
    const reopened = await openWorkspaceStore(first.directory)
    expect(() => reopened.repository.undoStageTimeEvent('ios', restarted.eventId)).toThrow('本次App运行期间')
    reopened.close()
  })

  it('rolls back a failed command together with its missing operation log', () => {
    const { database, executor } = createExecutor(() => '2026-07-24T08:00:00.000Z')
    const command: UndoableCommand<{ id: string }, { id: string }, { id: string }> = {
      type: 'test.failure',
      isUndoPayload: (payload): payload is { id: string } => Boolean(payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string'),
      execute(_context, input) {
        database.prepare('INSERT INTO command_facts(id,value) VALUES(?,?)').run(input.id, 'temporary')
        throw new Error('forced failure')
      },
      undo() {}
    }
    executor.register(command)
    expect(() => executor.execute(command, { id: 'fact-1' }, '55555555-5555-4555-8555-555555555555', {
      entityType: 'test_fact',
      entityId: (result) => result.id,
      label: '失败命令',
      auditInput: (input) => ({ id: input.id })
    })).toThrow('forced failure')
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_facts').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM operation_log').get()).toEqual({ count: 0 })
  })

  it('keeps oversized inverse data out of the undo stack and expires safe payloads', () => {
    let currentTime = '2026-07-24T08:00:00.000Z'
    const { database, executor } = createExecutor(() => currentTime, 1_000)
    const oversized: UndoableCommand<{ id: string }, { id: string }, { ids: string[] }> = {
      type: 'test.oversized',
      isUndoPayload: (payload): payload is { ids: string[] } => Boolean(
        payload
        && typeof payload === 'object'
        && Array.isArray((payload as { ids?: unknown }).ids)
        && (payload as { ids: unknown[] }).ids.every((id) => typeof id === 'string')
      ),
      execute(_context, input) {
        database.prepare('INSERT INTO command_facts(id,value) VALUES(?,?)').run(input.id, 'saved')
        return { result: { id: input.id }, undoPayload: { ids: Array.from({ length: 80 }, (_, index) => `${index}:${'x'.repeat(1_000)}`) } }
      },
      undo() {}
    }
    executor.register(oversized)
    const result = executor.execute(oversized, { id: 'oversized' }, '66666666-6666-4666-8666-666666666666', {
      entityType: 'test_fact',
      entityId: (saved) => saved.id,
      label: '大载荷',
      auditInput: (input) => ({ id: input.id })
    })
    expect(result.undoable).toBe(false)
    expect(database.prepare(`SELECT status,inverse_payload_json AS inversePayload FROM operation_log WHERE id=?`).get(result.operationId)).toEqual({
      status: 'audit_only',
      inversePayload: null
    })

    const expiring: UndoableCommand<{ id: string }, { id: string }, { id: string }> = {
      type: 'test.expiring',
      isUndoPayload: (payload): payload is { id: string } => Boolean(payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string'),
      execute(_context, input) {
        database.prepare('INSERT INTO command_facts(id,value) VALUES(?,?)').run(input.id, 'saved')
        return { result: { id: input.id }, undoPayload: { id: input.id } }
      },
      undo() {}
    }
    executor.register(expiring)
    const expiringResult = executor.execute(expiring, { id: 'expiring' }, '77777777-7777-4777-8777-777777777777', {
      entityType: 'test_fact',
      entityId: (saved) => saved.id,
      label: '过期载荷',
      auditInput: (input) => ({ id: input.id })
    })
    expect(expiringResult.undoable).toBe(true)
    currentTime = '2026-07-24T08:00:02.000Z'
    expect(executor.getUndoState().canUndo).toBe(false)
    expect(database.prepare(`SELECT status,inverse_payload_json AS inversePayload FROM operation_log WHERE id=?`).get(expiringResult.operationId)).toEqual({
      status: 'audit_only',
      inversePayload: null
    })
  })

  it('rejects a stale operation id and only undoes the latest command', async () => {
    const { store } = await createStore()
    store.repository.setModuleCompleted('ios', 'outline', true, '99999999-9999-4999-8999-999999999991')
    const olderOperationId = store.repository.getWorkspaceUndoState().operationId!
    store.repository.setModuleCompleted('ios', 'script', true, '99999999-9999-4999-8999-999999999992')
    const latestOperationId = store.repository.getWorkspaceUndoState().operationId!

    expect(() => store.repository.undoWorkspaceOperation(olderOperationId)).toThrow('撤销栈已经变化')
    expect(store.repository.undoWorkspaceOperation(latestOperationId).operationId).toBe(latestOperationId)
    const project = store.repository.getProject('ios', false)
    expect(project.stageTimeRecords.find((record) => record.stageKey === 'outline')?.status).toBe('completed')
    expect(project.stageTimeRecords.find((record) => record.stageKey === 'script')?.status).toBe('not_started')
    store.close()
  })

  it('rejects replaying a request after its operation was undone', async () => {
    const { store } = await createStore()
    const requestId = '99999999-9999-4999-8999-999999999993'
    store.repository.setModuleCompleted('ios', 'outline', true, requestId)
    store.repository.undoWorkspaceOperation()
    expect(() => store.repository.setModuleCompleted('ios', 'outline', true, requestId)).toThrow('已经撤销')
    store.close()
  })

  it('does not overwrite a later project status when undoing a non-publishing stage', async () => {
    const { store } = await createStore()
    store.repository.setModuleCompleted('ios', 'outline', true, '99999999-9999-4999-8999-999999999994')
    store.repository.native.prepare(`UPDATE projects SET status='paused' WHERE id='ios'`).run()

    store.repository.undoWorkspaceOperation()

    expect(store.repository.getProject('ios', false)).toMatchObject({ status: 'paused' })
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'outline')?.status).toBe('not_started')
    store.close()
  })

  it('restores the exact publishing status and removes only the learning sample created by the command', async () => {
    const { store } = await createStore()
    store.repository.native.prepare(`UPDATE projects SET status='paused',ai_suggested_content_type_id='type-ai' WHERE id='ios'`).run()
    const before = store.repository.native.prepare(`SELECT COUNT(*) AS count FROM classification_learning_samples`).get() as { count: number }

    store.repository.setModuleCompleted('ios', 'publishing', true, '99999999-9999-4999-8999-999999999995')

    expect(store.repository.getProject('ios', false).status).toBe('published')
    expect(store.repository.native.prepare(`SELECT COUNT(*) AS count FROM classification_learning_samples`).get()).toEqual({ count: before.count + 1 })
    store.repository.undoWorkspaceOperation()
    expect(store.repository.getProject('ios', false).status).toBe('paused')
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'publishing')?.status).toBe('not_started')
    expect(store.repository.native.prepare(`SELECT COUNT(*) AS count FROM classification_learning_samples`).get()).toEqual(before)
    store.close()
  })

  it('keeps credential-like inverse values out of operation_log even when a command validator accepts them', () => {
    const { database, executor } = createExecutor(() => '2026-07-24T08:00:00.000Z')
    const command: UndoableCommand<{ id: string }, { id: string }, { previousValue: string }> = {
      type: 'test.sensitive-inverse',
      isUndoPayload: (payload): payload is { previousValue: string } => Boolean(
        payload
        && typeof payload === 'object'
        && typeof (payload as { previousValue?: unknown }).previousValue === 'string'
      ),
      execute(_context, input) {
        database.prepare('INSERT INTO command_facts(id,value) VALUES(?,?)').run(input.id, 'saved')
        return { result: { id: input.id }, undoPayload: { previousValue: 'sk-abcdefghijklmnopqrstuv' } }
      },
      undo() {}
    }
    executor.register(command)

    const result = executor.execute(command, { id: 'sensitive' }, '99999999-9999-4999-8999-999999999996', {
      entityType: 'test_fact',
      entityId: (saved) => saved.id,
      label: '敏感逆载荷',
      auditInput: (input) => ({ id: input.id })
    })

    expect(result.undoable).toBe(false)
    expect(database.prepare(`SELECT status,inverse_payload_json AS inversePayload FROM operation_log WHERE id=?`).get(result.operationId)).toEqual({
      status: 'audit_only',
      inversePayload: null
    })

    const contentCommand: UndoableCommand<{ id: string }, { id: string }, { previousText: string }> = {
      type: 'test.content-inverse',
      isUndoPayload: (payload): payload is { previousText: string } => Boolean(
        payload
        && typeof payload === 'object'
        && typeof (payload as { previousText?: unknown }).previousText === 'string'
      ),
      execute(_context, input) {
        database.prepare('INSERT INTO command_facts(id,value) VALUES(?,?)').run(input.id, 'saved')
        return { result: { id: input.id }, undoPayload: { previousText: '这是一段不应写入操作日志的完整正文' } }
      },
      undo() {}
    }
    executor.register(contentCommand)
    const contentResult = executor.execute(contentCommand, { id: 'content' }, '99999999-9999-4999-8999-999999999997', {
      entityType: 'test_fact',
      entityId: (saved) => saved.id,
      label: '正文逆载荷',
      auditInput: (input) => ({ id: input.id })
    })
    expect(contentResult.undoable).toBe(false)
    expect(database.prepare(`SELECT status,inverse_payload_json AS inversePayload FROM operation_log WHERE id=?`).get(contentResult.operationId)).toEqual({
      status: 'audit_only',
      inversePayload: null
    })
  })
})
