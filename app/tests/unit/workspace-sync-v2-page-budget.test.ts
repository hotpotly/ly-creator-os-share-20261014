import { describe, expect, it } from 'vitest'
import { WorkspaceV2PageBudget, WORKSPACE_V2_PAGE_JSON_BYTES } from '../../src/main/db/workspace-sync-v2-page-budget'
import { WORKSPACE_V2_LIMITS, type WorkspaceV2Record } from '../../src/shared/workspace-sync-v2'

function record(index: number, byteLength: number = WORKSPACE_V2_LIMITS.jsonBlobBytes): WorkspaceV2Record {
  return {
    kind: 'todo', id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    revision: 1, sequence: index, deleted: false,
    payload: { encoding: 'blob', ref: { sha256: index.toString(16).padStart(64, '0'), byteLength, mediaType: 'application/json' } },
    metadata: { scope: 'todo.full', read: true, write: false, deletable: false, editableFields: [], source: 'manual' }
  }
}

describe('workspace v2 necessary JSON page budget', () => {
  it('accepts the exact128MiB boundary and retains progress after rejecting the next reference', () => {
    expect(WORKSPACE_V2_PAGE_JSON_BYTES).toBe(128 * 1024 * 1024)
    const budget = new WorkspaceV2PageBudget()
    for (let i = 1; i <= 8; i++) expect(budget.add(record(i))).toBe(true)
    expect(budget.add(record(9))).toBe(false)
    expect(budget.add(record(8))).toBe(true)
    expect(budget.add(record(9, 1))).toBe(false)
  })
  it('deduplicates references across receipts and changes, not record IDs', () => {
    const budget = new WorkspaceV2PageBudget()
    const first = record(1)
    for (let i = 0; i < 100; i++) expect(budget.add({ ...first, id: record(i).id, revision: i + 1 })).toBe(true)
    for (let i = 2; i <= 8; i++) expect(budget.add(record(i))).toBe(true)
    expect(budget.add(record(9))).toBe(false)
  })
  it('rejects conflicting lengths for the same content hash', () => {
    const budget = new WorkspaceV2PageBudget()
    expect(budget.add(record(1))).toBe(true)
    expect(() => budget.add(record(1, 100))).toThrow(expect.objectContaining({ code: 'record_reference_mismatch', status: 409 }))
  })
  it('leaves inline bodies to the independent metadata envelope limit', () => {
    const budget = new WorkspaceV2PageBudget()
    for (let i = 1; i <= 8; i++) expect(budget.add(record(i))).toBe(true)
    expect(budget.add({ ...record(9), payload: { encoding: 'json', json: '{}', sha256: '0'.repeat(64), byteLength: 2 } })).toBe(true)
  })
})
