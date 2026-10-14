import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workspaceAad, workspaceLogDataSchema, workspaceOperationSchema, workspaceSyncRequestSchema } from '../../src/shared/workspace-sync'
import { completedTodoDay } from '../../src/shared/todo-date'

const fixture = JSON.parse(readFileSync(resolve('../shared-fixtures/workspace-sync-v1.json'), 'utf8'))
describe('workspace v1 contract', () => {
  it('uses separate direction, workspace, device and request identity in AAD', () => {
    expect(workspaceAad(fixture.identity, 'request')).toBe(`workspace-v1\nrequest\n${fixture.identity.workspaceId}\n${fixture.identity.serviceId}\n${fixture.identity.deviceId}\n${fixture.identity.requestId}\n7`)
    expect(workspaceAad(fixture.identity, 'response')).not.toBe(workspaceAad(fixture.identity, 'request'))
  })
  it('validates snapshots, stable IDs and immutable operation identities', () => {
    expect(workspaceOperationSchema.safeParse(fixture.operation).success).toBe(true)
    expect(workspaceOperationSchema.safeParse({ ...fixture.operation, baseRevision: 1 }).success).toBe(false)
    expect(workspaceOperationSchema.safeParse({ ...fixture.operation, kind: 'review_draft' }).success).toBe(false)
    const request = { protocolVersion: 1, workspaceId: fixture.identity.workspaceId, deviceId: fixture.identity.deviceId, cursor: 0, through: null, operations: [fixture.operation] }
    expect(workspaceSyncRequestSchema.safeParse(request).success).toBe(true)
    expect(workspaceSyncRequestSchema.safeParse({ ...request, operations: [fixture.operation, fixture.operation] }).success).toBe(false)
    expect(workspaceSyncRequestSchema.safeParse({ ...request, cursor: 2, through: 1 }).success).toBe(false)
  })
  it('distinguishes missing from zero and validates exact minute bounds', () => {
    for (const minutes of fixture.minutes) expect(workspaceLogDataSchema.safeParse({ minutes }).success).toBe(true)
    for (const minutes of fixture.invalidMinutes) expect(workspaceLogDataSchema.safeParse({ minutes }).success).toBe(false)
  })
  it('preserves Dart microseconds and lets users repair oversized legacy totals', () => {
    expect(workspaceOperationSchema.safeParse({ ...fixture.operation, next: { ...fixture.operation.next, data: { ...fixture.operation.next.data, completedAt: fixture.dates[2].utc } } }).success).toBe(true)
    for (const minutes of fixture.legacyMinutes) {
      const operation = { ...fixture.operation, kind: 'work_log', id: '2026-10-03', baseRevision: 1, base: { deleted: false, data: { minutes } }, next: { deleted: false, data: { minutes: 480 } } }
      expect(workspaceOperationSchema.safeParse(operation).success).toBe(true)
      expect(workspaceOperationSchema.safeParse({ ...operation, baseRevision: 0, base: null, next: { deleted: false, data: { minutes } } }).success).toBe(false)
      expect(workspaceOperationSchema.safeParse({ ...operation, next: { deleted: true, data: { minutes } } }).success).toBe(true)
    }
  })
  it('assigns undated completion to local calendar day', () => {
    for (const value of fixture.dates) expect(completedTodoDay(value.utc, value.offsetMinutes)).toBe(value.day)
  })
})
