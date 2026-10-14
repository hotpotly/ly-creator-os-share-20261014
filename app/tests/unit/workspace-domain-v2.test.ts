import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as domain from '../../src/shared/workspace-domain-v2'
import { WORKSPACE_V2_LIMITS, workspaceV2Sha256 } from '../../src/shared/workspace-sync-v2'

const fixture = JSON.parse(readFileSync(resolve('../shared-fixtures/workspace-domain-v2.json'), 'utf8'))
const schemas: Record<string, z.ZodType> = domain.workspaceDomainV2Schemas
const sample = (name: string): Record<string, unknown> => structuredClone(fixture.samples[name])
const inputForTodo = (next: Record<string, unknown>, base = sample('todo')): domain.WorkspaceDomainV2ResolutionInput => ({
  kind: 'todo', id: String(base.id), baseRevision: 1, currentRevision: 1,
  base: { deleted: false, body: structuredClone(base) }, next: { deleted: false, body: next }, current: { deleted: false, body: structuredClone(base) }
})

describe('workspace domain v2 frozen shared contract', () => {
  for (const testCase of fixture.cases) {
    it(`schema: ${testCase.name}`, () => {
      const result = schemas[testCase.schema]!.safeParse(testCase.value)
      expect(result.success, result.success ? testCase.name : JSON.stringify(result.error.issues)).toBe(testCase.valid)
    })
  }
  for (const testCase of fixture.inspectCases) {
    it(`wide inspection: ${testCase.name}`, () => {
      const result = domain.workspaceDomainV2Inspect(testCase.kind, testCase.id, testCase.json)
      expect(result).toMatchObject({ rawJson: testCase.json, supported: testCase.supported, writable: testCase.writable, reason: testCase.reason })
      if (result.body) expect(result.body).toEqual(JSON.parse(testCase.json))
    })
  }
  for (const testCase of fixture.resolutionCases) {
    it(`resolution: ${testCase.name}`, () => {
      const before = structuredClone(testCase.input)
      expect(domain.workspaceDomainV2Resolve(testCase.input)).toEqual(testCase.expected)
      expect(testCase.input).toEqual(before)
    })
  }
  for (const testCase of fixture.equalityCases) {
    it(`semantic JSON equality: ${testCase.name}`, () => {
      expect(domain.workspaceDomainV2Equal(JSON.parse(testCase.leftJson), JSON.parse(testCase.rightJson))).toBe(testCase.equal)
    })
  }
  for (const testCase of fixture.rawBaseCases) {
    it(`immutable raw baseline: ${testCase.name}`, () => {
      const run = () => domain.workspaceDomainV2AssertBaseRaw(testCase.actual, testCase.historical)
      if (testCase.valid) expect(run).not.toThrow()
      else expect(run).toThrow()
    })
  }

  it('contains exactly the thirteen create fields and does not authorize server fields', () => {
    expect(Object.keys(domain.workspaceDomainV2TodoCreateSchema.shape)).toHaveLength(13)
    expect(Object.keys(domain.workspaceDomainV2TodoCreateSchema.shape).sort()).toEqual(Object.keys(fixture.samples.todoCreate).sort())
  })

  it('preserves 80k history when changing an independent category and only rejects new large titles', () => {
    const base = { ...sample('todo'), title: '字'.repeat(80000), progress: 12.25 }
    const result = domain.workspaceDomainV2Resolve(inputForTodo({ ...base, category: 'life' }, base))
    expect(result).toMatchObject({ status: 'apply', changedUnits: ['category'], body: { title: base.title, progress: 12.25 } })
    expect(domain.workspaceDomainV2Resolve(inputForTodo({ ...base, title: `${base.title}新` }, base))).toEqual({ status: 'rejected', reason: 'invalid_change' })
  })

  it('retains absent optional fields when unrelated units change', () => {
    const base = sample('todo')
    for (const key of ['dateRange', 'isExtra', 'stageLinkSource', 'stageKey']) delete base[key]
    const result = domain.workspaceDomainV2Resolve(inputForTodo({ ...base, title: '新标题' }, base))
    expect(result).toMatchObject({ status: 'apply', changedUnits: ['title'] })
    if (result.status !== 'apply') throw new Error('expected apply')
    for (const key of ['dateRange', 'isExtra', 'stageLinkSource', 'stageKey']) expect(Object.hasOwn(result.body, key)).toBe(false)
    expect(domain.workspaceDomainV2Resolve(inputForTodo({ ...base, dateRange: null }, base))).toMatchObject({ status: 'apply', changedUnits: ['D'] })
    expect(domain.workspaceDomainV2Resolve(inputForTodo({ ...base, stageKey: null }, base))).toEqual({ status: 'rejected', reason: 'invalid_change' })
  })

  it('keeps unchanged historical disabled or closed project associations untouched', () => {
    const base = { ...sample('todo'), projectId: 'archived-project', stageKey: 'feedback', stageLinkSource: null }
    expect(domain.workspaceDomainV2Resolve(inputForTodo({ ...base, title: '仅改标题' }, base))).toMatchObject({ status: 'apply', body: { projectId: 'archived-project', stageKey: 'feedback', stageLinkSource: null }, changedUnits: ['title'] })
  })

  it('allows an equivalent numeric reencoding in a new body while preserving the exact baseline bytes', async () => {
    const raw = JSON.stringify(sample('todo')).replace('"progress":37', '"progress":37.0')
    const base = domain.workspaceDomainV2Inspect('todo', String(fixture.samples.todo.id), raw)
    const next = { ...base.body!, title: '新标题' }
    expect(domain.workspaceDomainV2Resolve(inputForTodo(next, base.body!))).toMatchObject({ status: 'apply', changedUnits: ['title'], body: { progress: 37 } })
    expect(base.rawJson).toBe(raw)
    const nextRaw = JSON.stringify(next)
    expect(await workspaceV2Sha256(new TextEncoder().encode(nextRaw))).not.toBe(await workspaceV2Sha256(new TextEncoder().encode(raw)))
    expect(() => domain.workspaceDomainV2AssertBaseRaw({ deleted: false, json: JSON.stringify(base.body) }, { deleted: false, json: raw })).toThrow()
  })

  it('does not turn finite fractional history into integer-only canonical data', () => {
    const base = { ...sample('todo'), progress: 12.25, progressBeforeComplete: 37.5 }
    expect(domain.workspaceDomainV2Resolve(inputForTodo({ ...base, isExtra: true }, base))).toMatchObject({ status: 'apply', body: { progress: 12.25, progressBeforeComplete: 37.5 }, changedUnits: ['isExtra'] })
  })

  it('rejects 17MiB JSON without truncating the source', () => {
    const rawJson = JSON.stringify({ ...sample('todo'), title: 'x'.repeat(17 * 1024 * 1024) })
    expect(rawJson.length).toBeGreaterThan(WORKSPACE_V2_LIMITS.jsonBlobBytes)
    expect(domain.workspaceDomainV2Inspect('todo', String(fixture.samples.todo.id), rawJson)).toEqual({ rawJson, body: null, supported: false, writable: false, reason: 'too_large' })
  })

  it('locks unsafe numeric history while preserving its raw text', () => {
    for (const token of ['9007199254740992', '-9007199254740992', '1e400', '-1e400']) {
      const raw = JSON.stringify(sample('todo')).replace('"progress":37', `"progress":${token}`)
      expect(domain.workspaceDomainV2Inspect('todo', String(fixture.samples.todo.id), raw)).toMatchObject({ rawJson: raw, writable: false, supported: false, reason: 'unsafe_number' })
      const base = JSON.parse(raw)
      expect(domain.workspaceDomainV2Resolve(inputForTodo({ ...base, title: '新标题' }, base))).toEqual({ status: 'rejected', reason: 'record_read_only' })
    }
  })

  it('handles shared immutable inputs without mutating snapshots', () => {
    const base = sample('todo')
    const input = inputForTodo({ ...base, title: '新标题' }, base)
    input.current = input.base
    expect(domain.workspaceDomainV2Resolve(input)).toMatchObject({ status: 'apply', changedUnits: ['title'] })
    expect(base.title).toBe(fixture.samples.todo.title)
  })
})
