import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import {
  materialResearchTaskSnapshotSchema,
  validateMaterialResearchOutput
} from '../../src/main/material-research'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-material-research-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const providerSecurity = {
  provider: 'codex_cli' as const,
  providerConfigId: 'builtin:codex',
  displayName: 'Codex CLI',
  cliVersion: 'test',
  fingerprint: 'f'.repeat(64),
  policyVersion: 'test-policy'
}

function resultFixture(accessedAt = '2026-07-28T08:00:00.000Z') {
  return validateMaterialResearchOutput({
    suggestedTitle: '无线鼠标参数核验',
    overview: '已找到官方产品页，并保留一个仍待核实的问题。',
    claims: [{
      id: 'weight',
      heading: '产品重量',
      content: '官方规格页标注重量为63克。',
      status: 'supported',
      sourceIds: ['official-spec']
    }],
    conflicts: [],
    unresolved: ['首发渠道价格没有找到稳定的一手来源'],
    sources: [{
      id: 'official-spec',
      title: '产品官方规格',
      url: 'https://example.com/spec#weight',
      publisher: 'Example',
      sourceType: 'official',
      publishedAt: null
    }]
  }, [{ type: 'open_page', query: null, url: 'https://example.com/spec#overview' }], accessedAt)
}

describe('project material web research', () => {
  it('keeps sources on domains visited by Codex and rejects results without web activity', () => {
    const result = resultFixture()
    expect(result.sources[0]).toMatchObject({
      url: 'https://example.com/spec',
      domain: 'example.com',
      accessedAt: '2026-07-28T08:00:00.000Z'
    })
    expect(validateMaterialResearchOutput({
      suggestedTitle: '官方参数',
      overview: '来源经过网页访问。',
      claims: [{ id: 'claim', heading: '参数', content: '官方候选', status: 'supported', sourceIds: ['official'] }],
      conflicts: [],
      unresolved: [],
      sources: [{ id: 'official', title: '规范页', url: 'https://example.com/canonical-spec', publisher: 'Example', sourceType: 'official', publishedAt: null }]
    }, [{ type: 'open_page', query: null, url: 'https://example.com/redirected-spec' }], new Date().toISOString()).sources[0]?.domain).toBe('example.com')
    expect(() => validateMaterialResearchOutput({
      suggestedTitle: '伪来源',
      overview: '没有真实打开。',
      claims: [{ id: 'claim', heading: '参数', content: '错误候选', status: 'supported', sourceIds: ['fake'] }],
      conflicts: [],
      unresolved: [],
      sources: [{ id: 'fake', title: '看似可信', url: 'https://not-opened.example/spec', publisher: '', sourceType: 'official', publishedAt: null }]
    }, [{ type: 'open_page', query: null, url: 'https://example.com/spec' }], new Date().toISOString())).toThrow('MATERIAL_RESEARCH_SOURCE_NOT_OPENED')
    expect(() => validateMaterialResearchOutput({
      suggestedTitle: '没有联网',
      overview: '没有网页访问。',
      claims: [{ id: 'claim', heading: '参数', content: '错误候选', status: 'supported', sourceIds: ['fake'] }],
      conflicts: [],
      unresolved: [],
      sources: [{ id: 'fake', title: '看似可信', url: 'https://example.com/spec', publisher: '', sourceType: 'official', publishedAt: null }]
    }, [], new Date().toISOString())).toThrow('MATERIAL_RESEARCH_WEB_SEARCH_REQUIRED')
    expect(() => validateMaterialResearchOutput({
      suggestedTitle: '引用缺失',
      overview: '引用不存在。',
      claims: [{ id: 'claim', heading: '参数', content: '错误候选', status: 'supported', sourceIds: ['missing'] }],
      conflicts: [],
      unresolved: [],
      sources: [{ id: 'real', title: '真实来源', url: 'https://example.com/spec', publisher: '', sourceType: 'official', publishedAt: null }]
    }, [{ type: 'open_page', query: null, url: 'https://example.com/spec' }], new Date().toISOString())).toThrow('MATERIAL_RESEARCH_SOURCE_REF_INVALID')
  })

  it('persists a candidate before saving and confirms it idempotently as one sourced text material', async () => {
    const { store, directory } = await createStore()
    const researchId = '3ca07158-6bed-4499-99fd-a7ea21a024c8'
    const snapshot = materialResearchTaskSnapshotSchema.parse({
      version: 1,
      researchId,
      projectId: 'ssd',
      projectTitle: '固态硬盘评测',
      projectDescription: '准备做一期参数与实测对照。',
      requestedTitle: '',
      request: '收集重量和首发价格，优先官方来源。',
      requestedAt: '2026-07-28T07:50:00.000Z',
      providerSecurity
    })
    const beforeCount = store.repository.listProjectMaterials('ssd').length
    const task = store.repository.createMaterialResearchTask({
      researchId,
      projectId: 'ssd',
      request: snapshot.request,
      requestedTitle: '',
      inputSnapshot: JSON.stringify(snapshot)
    })
    expect(store.repository.listProjectMaterials('ssd')).toHaveLength(beforeCount)
    const result = resultFixture()
    store.repository.saveMaterialResearchResult(task.id, result, {
      providerThreadId: 'thread-test',
      model: 'gpt-test',
      reasoningEffort: 'high',
      webSearchMode: 'required',
      webSearches: [{ type: 'open_page', query: null, url: 'https://example.com/spec' }]
    })
    store.repository.updateTaskRun(task.id, { status: 'succeeded', progress: 100, finishedAt: '2026-07-28T08:00:01.000Z' })
    expect(store.repository.listProjectMaterials('ssd')).toHaveLength(beforeCount)
    expect(store.repository.getMaterialResearchSession('ssd', researchId)).toMatchObject({
      status: 'succeeded',
      savedMaterialId: null,
      result: { suggestedTitle: '无线鼠标参数核验' }
    })

    const saved = store.repository.saveMaterialResearchAsMaterial({
      projectId: 'ssd',
      researchId,
      title: '无线鼠标参数与来源',
      claimIds: ['weight']
    })
    expect(saved).toMatchObject({ sourceKind: 'text', title: '无线鼠标参数与来源', isPrimaryReference: false })
    expect(saved.textContent).toContain('原始收集要求')
    expect(saved.textContent).toContain('[产品官方规格](https://example.com/spec)')
    expect(saved.textContent).toContain('官方来源')
    expect(saved.textContent).not.toContain('2026-07-28T08:00:00.000Z')
    expect(store.repository.saveMaterialResearchAsMaterial({
      projectId: 'ssd', researchId, title: '重复点击不会新增', claimIds: ['weight']
    }).id).toBe(saved.id)
    expect(store.repository.listProjectMaterials('ssd')).toHaveLength(beforeCount + 1)

    store.repository.saveProjectPrimaryReferences({
      projectId: 'ssd',
      referenceRequirements: '优先核对联网来源',
      references: [],
      materialReferences: [{ materialId: saved.id, attentionNote: '注意价格和访问日期' }]
    })
    const preparation = store.repository.prepareTaskResources('ssd')
    expect(preparation.primaryReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        linkId: `material:${saved.id}`,
        sourceKind: 'text',
        status: 'included',
        attentionNote: '注意价格和访问日期'
      })
    ]))

    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getMaterialResearchSession('ssd', researchId).savedMaterialId).toBe(saved.id)
    expect(reopened.repository.getProject('ssd', false).materials.find((material) => material.id === saved.id)?.isPrimaryReference).toBe(true)
    reopened.close()
  })

  it('does not silently rerun interrupted network research after an app restart', async () => {
    const { store } = await createStore()
    const researchId = '5a2d774f-d2b7-4c93-9b4f-8c090041502b'
    const snapshot = materialResearchTaskSnapshotSchema.parse({
      version: 1,
      researchId,
      projectId: 'ssd',
      projectTitle: '固态硬盘评测',
      projectDescription: '',
      requestedTitle: '',
      request: '核对当前在售状态。',
      requestedAt: new Date().toISOString(),
      providerSecurity
    })
    const task = store.repository.createMaterialResearchTask({
      researchId, projectId: 'ssd', request: snapshot.request, requestedTitle: '', inputSnapshot: JSON.stringify(snapshot)
    })
    store.repository.updateTaskRun(task.id, { status: 'running', progress: 42, startedAt: new Date().toISOString() })
    store.repository.recoverInterruptedTasks()
    expect(store.repository.getTaskRun(task.id)).toMatchObject({
      status: 'failed',
      errorCode: 'APP_RESTARTED',
      errorMessage: expect.stringContaining('手动重试')
    })
    store.close()
  })
})
