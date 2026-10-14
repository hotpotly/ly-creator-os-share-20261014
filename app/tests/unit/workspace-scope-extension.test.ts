import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  workspaceScopeExtensionAssertScopes,
  workspaceScopeExtensionAssertSnapshot,
  workspaceScopeExtensionAssertTerminalReplay,
  workspaceScopeExtensionValidate
} from '../../src/shared/workspace-scope-extension'
import {
  workspaceV2ManifestDigest,
  workspaceV2ScopeDigest,
  workspaceV2Sha256,
  type WorkspaceV2Record,
  type WorkspaceV2Scope
} from '../../src/shared/workspace-sync-v2'

const fixture = JSON.parse(readFileSync(resolve('../shared-fixtures/workspace-scope-extension.json'), 'utf8')) as {
  version: number
  cases: { name: string; schema: string; value: unknown; valid: boolean }[]
}
const identity = { protocolVersion: 2 as const, workspaceId: '11111111-1111-4111-8111-111111111111', deviceId: '22222222-2222-4222-8222-222222222222' }
const sourceScopes: WorkspaceV2Scope[] = ['todo.full']
const targetScopes: WorkspaceV2Scope[] = ['preferences.todo', 'todo.full']
async function record(json: string, revision = 7, sequence = 9): Promise<WorkspaceV2Record> {
  const bytes = new TextEncoder().encode(json)
  return {
    kind: 'todo', id: '33333333-3333-4333-8333-333333333333', revision, sequence, deleted: false,
    payload: { encoding: 'json', json, sha256: await workspaceV2Sha256(bytes), byteLength: bytes.length },
    metadata: { scope: 'todo.full', read: true, write: false, deletable: false, editableFields: [], source: 'manual' }
  }
}
async function proof(oldRecords: WorkspaceV2Record[], records: WorkspaceV2Record[]) {
  return {
    sourceScopes, targetScopes, workspaceId: identity.workspaceId, deviceId: identity.deviceId,
    knownSequence: 9, oldRecords, records,
    manifest: {
      ...identity, scopes: targetScopes, scopeDigest: await workspaceV2ScopeDigest(targetScopes),
      manifestId: '44444444-4444-4444-8444-444444444444', schemaVersion: 1 as const,
      through: 12, entityCount: records.length, entriesSha256: await workspaceV2ManifestDigest(records), expiresAt: '2026-10-04T00:00:00Z'
    }
  }
}

describe('workspace scope extension shared semantics', () => {
  it('uses one portable fixture contract without enabling new runtime scopes', () => {
    expect(fixture.version).toBe(1)
    expect(new Set(fixture.cases.map(testCase => testCase.schema))).toEqual(new Set(['scopes', 'capabilities', 'snapshot', 'terminalReplay']))
    expect(new Set(fixture.cases.map(testCase => testCase.name)).size).toBe(fixture.cases.length)
  })
  for (const testCase of fixture.cases) {
    it(testCase.name, async () => {
      const actual = workspaceScopeExtensionValidate(testCase.schema, testCase.value)
      if (testCase.valid) await expect(actual).resolves.toBeUndefined()
      else await expect(actual).rejects.toThrow()
    })
  }

  it('rejects replacement and same-scope approvals rather than silently taking an intersection', () => {
    expect(() => workspaceScopeExtensionAssertScopes({ sourceScopes: ['todo.full'], targetScopes: ['work_log'] })).toThrow()
    expect(() => workspaceScopeExtensionAssertScopes({ sourceScopes, targetScopes: sourceScopes })).toThrow()
    expect(() => workspaceScopeExtensionAssertScopes({ sourceScopes, targetScopes })).not.toThrow()
  })

  it('retains unknown raw JSON and permits only metadata changes on an immutable baseline revision', async () => {
    const before = await record('{"unsafe":1e400,"future":{"decimal":37.5}}')
    const metadataChanged = { ...before, metadata: { ...before.metadata, write: true, deletable: true, editableFields: ['title'] } }
    await expect(workspaceScopeExtensionAssertSnapshot(await proof([before], [metadataChanged]))).resolves.toBeUndefined()
    for (const after of [
      await record('{"unsafe":null,"future":{"decimal":37.5}}'),
      await record('{ "unsafe":1e400, "future":{"decimal":37.5} }'),
      { ...before, deleted: true },
      { ...before, sequence: 10 }
    ]) await expect(workspaceScopeExtensionAssertSnapshot(await proof([before], [after]))).rejects.toThrow()
    await expect(workspaceScopeExtensionAssertSnapshot(await proof([before], [await record('{"future":true}', 8, 10)]))).resolves.toBeUndefined()
  })

  it('does not equate same-hash blob references with different declared lengths', async () => {
    const before = await record('{"raw":true}')
    if (before.payload.encoding !== 'json') throw new Error('Expected inline test input')
    const ref = { sha256: before.payload.sha256, byteLength: before.payload.byteLength, mediaType: 'application/json' as const }
    const equivalent: WorkspaceV2Record = { ...before, payload: { encoding: 'blob', ref } }
    await expect(workspaceScopeExtensionAssertSnapshot(await proof([before], [equivalent]))).resolves.toBeUndefined()
    const forged: WorkspaceV2Record = { ...equivalent, revision: 8, sequence: 10, payload: { encoding: 'blob', ref: { ...ref, byteLength: ref.byteLength + 1 } } }
    await expect(workspaceScopeExtensionAssertSnapshot(await proof([before], [forged]))).rejects.toThrow()
  })

  it('requires the same authenticated empty terminal page rather than a fresh snapshot', async () => {
    const request = { ...identity, manifestId: '44444444-4444-4444-8444-444444444444', after: null, limit: 1 }
    const verifiedResponse = { ...identity, manifestId: request.manifestId, records: [], next: null, done: true }
    await expect(workspaceScopeExtensionAssertTerminalReplay({ request, verifiedResponse, response: { ...verifiedResponse } })).resolves.toBeUndefined()
    await expect(workspaceScopeExtensionAssertTerminalReplay({ request, verifiedResponse, response: { ...verifiedResponse, manifestId: '55555555-5555-4555-8555-555555555555' } })).rejects.toThrow()
  })
})
