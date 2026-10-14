import BetterSqlite3 from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore } from '../../src/main/db'
import { renderCurrentScriptEditorDocumentHtml } from '../../src/main/db/current-script-document'
import { runMigrations } from '../../src/main/db/migrations'
import { WorkspaceRepository } from '../../src/main/db/repository'
import { seedWorkspace } from '../../src/main/db/seed'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS, type CurrentScriptSourceRelationInput, type ScriptTextAnnotationInput } from '../../src/shared/domain'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'

const databases: BetterSqlite3.Database[] = []
const directories: string[] = []
const providerSecurity = {
  provider: 'codex_cli' as const,
  providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
  displayName: 'Codex CLI',
  cliVersion: 'test',
  fingerprint: 'current-script-material-restore-test',
  policyVersion: 'test-policy'
}

function createRepository(): { database: BetterSqlite3.Database; repository: WorkspaceRepository } {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runMigrations(database)
  seedWorkspace(database, true)
  return { database, repository: new WorkspaceRepository(database) }
}

function createProject(repository: WorkspaceRepository, title: string): string {
  return repository.createProject({
    title,
    description: '',
    contentTypeId: 'type-ai',
    colorToken: 'project-1',
    platformTargets: []
  }).id
}

function editorDocument(blockId: string, text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: { blockId, parentBlockIds: [] },
      content: text ? [{ type: 'text', text }] : []
    }]
  }
}

function initializeBlank(repository: WorkspaceRepository, projectId: string, blockId = 'script-block-blank') {
  const load = repository.loadProjectCurrentScript(projectId)
  expect(load).toMatchObject({ status: 'initialization_required', candidates: [], requiresSelection: false })
  const initialized = repository.initializeProjectCurrentScript({
    projectId,
    clientMutationId: randomUUID(),
    sourceVersionId: null,
    expectedSourceContentHash: null,
    editorDocument: editorDocument(blockId, ''),
    sourceRelations: [],
    annotations: []
  })
  if (initialized.status !== 'ready') throw new Error('expected blank current script')
  return initialized.snapshot
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('project current script document', () => {
  it('offers only user-saved initialization candidates and never promotes source or AI drafts', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '初始化白名单')
    const providerDraft = repository.createVersion(projectId, 'script', 'codex_candidate', 'AI候选', 'provider')
    const externalDraft = repository.createVersion(projectId, 'script', 'external_draft', '外部导入稿', 'importer')
    const userVersion = repository.saveScript(projectId, 'user_edit', '<p>另存版本</p>', undefined, '备选稿')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '素材原稿绝不能成为当前文案' })

    const selection = repository.loadProjectCurrentScript(projectId)
    expect(selection.status).toBe('initialization_required')
    if (selection.status !== 'initialization_required') throw new Error('expected initialization candidates')
    expect(selection.candidates.map((candidate) => candidate.versionId)).toEqual([userVersion.id])
    expect(selection.candidates.map((candidate) => candidate.versionId)).not.toContain(providerDraft.id)
    expect(selection.candidates.map((candidate) => candidate.versionId)).not.toContain(externalDraft.id)
    expect(selection).toMatchObject({ recommendedVersionId: userVersion.id, requiresSelection: false })
    expect(database.prepare(`SELECT COUNT(*) AS count FROM project_current_script_documents`).get()).toEqual({ count: 0 })

    const saved = repository.saveScript(projectId, 'merged_draft', '<p>当前用户稿</p>')
    const next = repository.loadProjectCurrentScript(projectId)
    expect(next.status).toBe('initialization_required')
    if (next.status !== 'initialization_required') throw new Error('expected initialization candidates')
    expect(next.recommendedVersionId).toBe(saved.id)
    const candidate = next.candidates.find((item) => item.versionId === saved.id)!
    const initialized = repository.initializeProjectCurrentScript({
      projectId,
      clientMutationId: randomUUID(),
      sourceVersionId: saved.id,
      expectedSourceContentHash: candidate.sourceContentHash,
      editorDocument: editorDocument('script-block-initial', '当前用户稿'),
      sourceRelations: [],
      annotations: []
    })
    expect(initialized.status).toBe('ready')
    if (initialized.status !== 'ready') throw new Error('expected ready current script')
    expect(initialized.snapshot.document).toMatchObject({ revision: 1, lastSavedVersionId: saved.id })
    expect(initialized.snapshot.blocks).toEqual([expect.objectContaining({ blockId: 'script-block-initial', text: '当前用户稿' })])
    expect(() => RESPONSE_SCHEMAS.projectCurrentScriptLoadResultSchema.parse(initialized)).not.toThrow()
  })

  it('accepts Tiptap list wrappers and its harmless trailing empty paragraph during first migration', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, 'Markdown列表初始化')
    const version = repository.saveScript(projectId, 'merged_draft', '# 标题\n\n正文\n\n- 第一项\n- 第二项')
    const selection = repository.loadProjectCurrentScript(projectId)
    if (selection.status !== 'initialization_required') throw new Error('expected initialization candidates')
    const candidate = selection.candidates.find((item) => item.versionId === version.id)!
    const initialized = repository.initializeProjectCurrentScript({
      projectId,
      clientMutationId: randomUUID(),
      sourceVersionId: version.id,
      expectedSourceContentHash: candidate.sourceContentHash,
      editorDocument: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, blockId: 'heading-1', parentBlockIds: [] }, content: [{ type: 'text', text: '标题' }] },
          { type: 'paragraph', attrs: { blockId: 'paragraph-1', parentBlockIds: [] }, content: [{ type: 'text', text: '正文' }] },
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', attrs: { blockId: 'item-1', parentBlockIds: [] }, content: [{ type: 'paragraph', attrs: { blockId: 'item-text-1', parentBlockIds: [] }, content: [{ type: 'text', text: '第一项' }] }] },
              { type: 'listItem', attrs: { blockId: 'item-2', parentBlockIds: [] }, content: [{ type: 'paragraph', attrs: { blockId: 'item-text-2', parentBlockIds: [] }, content: [{ type: 'text', text: '第二项' }] }] }
            ]
          },
          { type: 'paragraph', attrs: { blockId: 'trailing-empty', parentBlockIds: [] }, content: [] }
        ]
      },
      sourceRelations: [],
      annotations: []
    })
    expect(initialized.status).toBe('ready')
  })

  it('autosaves body, relations and annotations atomically without creating draft versions', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, 'CAS自动保存')
    const initial = initializeBlank(repository, projectId)
    const blockId = initial.blocks[0]!.blockId
    const relation: CurrentScriptSourceRelationInput = {
      id: 'relation-1', targetBlockId: blockId, targetStart: 0, targetEnd: 2,
      sourceKind: 'material_point', sourceId: 'material-point-1', sourceVersion: '1'
    }
    const annotation: ScriptTextAnnotationInput = {
      id: 'annotation-1', blockId, blockStart: 0, blockEnd: 2, selectedText: '第一',
      style: 'highlight', note: '保留真实体验', status: 'active'
    }
    const mutationId = randomUUID()
    const draftCount = (database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId) as { count: number }).count
    const applied = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: mutationId,
      expectedRevision: initial.document.revision,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '第一版当前文案'),
      sourceRelations: [relation],
      annotations: [annotation]
    })
    expect(applied.status).toBe('applied')
    if (applied.status !== 'applied') throw new Error('expected applied current script')
    expect(applied.snapshot.document.revision).toBe(2)
    expect(applied.snapshot.sourceRelations).toEqual([expect.objectContaining(relation)])
    expect(applied.snapshot.annotations).toEqual([expect.objectContaining({ ...annotation, sourceVersion: '2' })])
    expect((database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId) as { count: number }).count).toBe(draftCount)
    expect(() => RESPONSE_SCHEMAS.applyProjectCurrentScriptResultSchema.parse(applied)).not.toThrow()

    const replay = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: mutationId,
      expectedRevision: initial.document.revision,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '第一版当前文案'),
      sourceRelations: [relation],
      annotations: [annotation]
    })
    expect(replay.status).toBe('applied')
    if (replay.status !== 'applied') throw new Error('expected idempotent replay')
    expect(replay.snapshot.document.revision).toBe(2)
    expect(replay).toEqual(applied)

    const reopened = new WorkspaceRepository(database).loadProjectCurrentScript(projectId)
    expect(reopened.status).toBe('ready')
    if (reopened.status !== 'ready') throw new Error('expected recovered current script')
    expect(reopened.snapshot).toMatchObject({
      document: { revision: 2 },
      sourceRelations: [expect.objectContaining({ id: relation.id })],
      annotations: [expect.objectContaining({ id: annotation.id })]
    })

    const noOpMutationId = randomUUID()
    const noOpInput = {
      projectId,
      workingDocumentId: reopened.snapshot.document.workingDocumentId,
      clientMutationId: noOpMutationId,
      expectedRevision: reopened.snapshot.document.revision,
      expectedContentHash: reopened.snapshot.document.contentHash,
      editorDocument: reopened.snapshot.document.editorDocument,
      sourceRelations: [relation],
      annotations: [annotation]
    }
    const noOp = repository.applyProjectCurrentScriptTransaction(noOpInput)
    expect(noOp.status).toBe('applied')
    if (noOp.status !== 'applied') throw new Error('expected no-op apply')
    expect(noOp.snapshot.document.revision).toBe(2)
    expect(repository.applyProjectCurrentScriptTransaction(noOpInput)).toEqual(noOp)

    const advanced = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: noOp.snapshot.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: noOp.snapshot.document.revision,
      expectedContentHash: noOp.snapshot.document.contentHash,
      editorDocument: editorDocument(blockId, '第二版当前文案'),
      sourceRelations: [],
      annotations: []
    })
    expect(advanced.status).toBe('applied')
    if (advanced.status !== 'applied') throw new Error('expected advanced current script')
    expect(advanced.snapshot.document.revision).toBe(3)
    const lateReplay = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: mutationId,
      expectedRevision: initial.document.revision,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '第一版当前文案'),
      sourceRelations: [relation],
      annotations: [annotation]
    })
    expect(lateReplay.status).toBe('applied')
    if (lateReplay.status !== 'applied') throw new Error('expected late idempotent replay')
    expect(lateReplay.snapshot.document.revision).toBe(2)
    expect(repository.loadProjectCurrentScript(projectId)).toMatchObject({ status: 'ready', snapshot: { document: { revision: 3 } } })
  })

  it('returns structured CAS conflicts and preserves both the activity head and attempted recovery copy', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, 'CAS冲突')
    const draftCount = (database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId) as { count: number }).count
    const initial = initializeBlank(repository, projectId)
    const blockId = initial.blocks[0]!.blockId
    const first = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: 1,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '服务端较新正文'),
      sourceRelations: [],
      annotations: []
    })
    if (first.status !== 'applied') throw new Error('expected first apply')

    const stale = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: 1,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '客户端未落盘正文'),
      sourceRelations: [],
      annotations: []
    })
    expect(stale).toMatchObject({
      status: 'conflict', code: 'CURRENT_SCRIPT_CAS_CONFLICT', reason: 'revision_mismatch',
      actual: { document: { revision: 2 } },
      attempted: { editorDocument: editorDocument(blockId, '客户端未落盘正文') }
    })
    if (stale.status !== 'conflict') throw new Error('expected stale conflict')
    expect(() => RESPONSE_SCHEMAS.applyProjectCurrentScriptResultSchema.parse(stale)).not.toThrow()

    const wrongHash = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: first.snapshot.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: 2,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '另一份本地正文'),
      sourceRelations: [],
      annotations: []
    })
    expect(wrongHash).toMatchObject({ status: 'conflict', reason: 'content_hash_mismatch' })

    const wrongDocument = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: 'current-script-other',
      clientMutationId: randomUUID(),
      expectedRevision: 2,
      expectedContentHash: first.snapshot.document.contentHash,
      editorDocument: editorDocument('script-block-other', '第三份本地正文'),
      sourceRelations: [],
      annotations: []
    })
    expect(wrongDocument).toMatchObject({ status: 'conflict', reason: 'working_document_mismatch' })

    const current = repository.loadProjectCurrentScript(projectId)
    if (current.status !== 'ready') throw new Error('expected current script')
    expect(current.snapshot.document.editorDocument).toEqual(editorDocument(blockId, '服务端较新正文'))
    const recovery = repository.listCurrentScriptRecoveryCandidates(projectId)
    expect(recovery).toHaveLength(3)
    expect(recovery.map((item) => item.editorDocument)).toContainEqual(editorDocument(blockId, '客户端未落盘正文'))
    expect(() => RESPONSE_SCHEMAS.currentScriptRecoveryCandidateSchema.array().parse(recovery)).not.toThrow()
    expect(database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId)).toEqual({ count: draftCount })
  })

  it('rejects invalid block coordinates and cascades all current-script facts with the project', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '范围与级联')
    const initial = initializeBlank(repository, projectId)
    const blockId = initial.blocks[0]!.blockId
    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: 1,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '短正文'),
      sourceRelations: [{
        id: 'relation-invalid', targetBlockId: blockId, targetStart: 0, targetEnd: 99,
        sourceKind: 'material_point', sourceId: 'point', sourceVersion: '1'
      }],
      annotations: []
    })).toThrow('来源关系范围无效')
    expect(repository.loadProjectCurrentScript(projectId)).toMatchObject({ status: 'ready', snapshot: { document: { revision: 1 } } })

    const valid = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: 1,
      expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument(blockId, '短正文'),
      sourceRelations: [{
        id: 'relation-valid', targetBlockId: blockId, targetStart: 0, targetEnd: 1,
        sourceKind: 'material_point', sourceId: 'point', sourceVersion: '1'
      }],
      annotations: [{
        id: 'annotation-valid', blockId, blockStart: 0, blockEnd: 1, selectedText: '短',
        style: 'flag', note: '', status: 'active'
      }]
    })
    expect(valid.status).toBe('applied')
    database.prepare(`DELETE FROM projects WHERE id=?`).run(projectId)
    for (const table of ['project_current_script_documents', 'current_script_source_relations', 'script_text_annotations', 'script_working_document_revisions']) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
    }
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('includes provider/importer finals, recommends the newest explicit save, and preserves structured formatting on initialization', () => {
    const { repository } = createRepository()
    const providerProjectId = createProject(repository, '服务商定稿候选')
    const provider = repository.createVersion(providerProjectId, 'script', 'codex_candidate', '<p>服务商稿</p>', 'provider')
    repository.setFinalVersion(providerProjectId, provider.id)
    const newer = repository.saveScript(providerProjectId, 'merged_draft', '<h2><strong>格式标题</strong></h2><ul><li>列表项</li></ul><ol start="5"><li>编号项</li></ol>')
    const candidates = repository.loadProjectCurrentScript(providerProjectId)
    if (candidates.status !== 'initialization_required') throw new Error('expected provider project candidates')
    expect(candidates.candidates.map((item) => item.versionId)).toEqual([newer.id, provider.id])
    expect(candidates.recommendedVersionId).toBe(newer.id)

    const structuredDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading', attrs: { level: 2, blockId: 'heading-1', parentBlockIds: [] },
          content: [{ type: 'text', text: '格式标题', marks: [{ type: 'bold' }] }]
        },
        {
          type: 'bulletList', content: [{
            type: 'listItem', attrs: { blockId: 'list-item-1', parentBlockIds: [] }, content: [{
              type: 'paragraph', attrs: { blockId: 'list-paragraph-1', parentBlockIds: [] },
              content: [{ type: 'text', text: '列表项' }]
            }]
          }]
        },
        {
          type: 'orderedList', attrs: { start: 5 }, content: [{
            type: 'listItem', attrs: { blockId: 'ordered-item-1', parentBlockIds: [] }, content: [{
              type: 'paragraph', attrs: { blockId: 'ordered-paragraph-1', parentBlockIds: [] },
              content: [{ type: 'text', text: '编号项' }]
            }]
          }]
        }
      ]
    }
    const source = candidates.candidates.find((item) => item.versionId === newer.id)!
    const initialized = repository.initializeProjectCurrentScript({
      projectId: providerProjectId,
      clientMutationId: randomUUID(),
      sourceVersionId: newer.id,
      expectedSourceContentHash: source.sourceContentHash,
      editorDocument: structuredDocument,
      sourceRelations: [],
      annotations: []
    })
    expect(initialized).toMatchObject({ status: 'ready', snapshot: { document: { lastSavedVersionId: newer.id } } })

    const importerProjectId = createProject(repository, '导入定稿候选')
    const imported = repository.createVersion(importerProjectId, 'script', 'external_draft', '<p>导入定稿</p>', 'importer')
    repository.setFinalVersion(importerProjectId, imported.id)
    const importerCandidates = repository.loadProjectCurrentScript(importerProjectId)
    expect(importerCandidates).toMatchObject({ status: 'initialization_required', recommendedVersionId: imported.id })
  })

  it('requires legacy marks, notes and material relations to migrate without changing their meaning', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, '旧标记迁移')
    const source = repository.saveScript(
      projectId,
      'user_edit',
      '<p><span data-script-marker-id="flag-legacy" data-script-marker-note="必须保留">注意</span><span data-script-material-relation-id="relation-legacy" data-script-material-source-point-ids="point-1">依据</span></p>'
    )
    const selection = repository.loadProjectCurrentScript(projectId)
    if (selection.status !== 'initialization_required') throw new Error('expected migration selection')
    const candidate = selection.candidates.find((item) => item.versionId === source.id)!
    const document = editorDocument('legacy-block', '注意依据')
    const relation: CurrentScriptSourceRelationInput = {
      id: 'relation-legacy', targetBlockId: 'legacy-block', targetStart: 2, targetEnd: 4,
      sourceKind: 'material_point', sourceId: 'point-1', sourceVersion: '1'
    }
    const annotation: ScriptTextAnnotationInput = {
      id: 'flag-legacy', blockId: 'legacy-block', blockStart: 0, blockEnd: 2, selectedText: '注意',
      style: 'flag', note: '必须保留', status: 'active'
    }
    const input = {
      projectId,
      clientMutationId: randomUUID(),
      sourceVersionId: source.id,
      expectedSourceContentHash: candidate.sourceContentHash,
      editorDocument: document,
      sourceRelations: [relation],
      annotations: [annotation]
    }
    expect(() => repository.initializeProjectCurrentScript({
      ...input,
      clientMutationId: randomUUID(),
      annotations: [{ ...annotation, note: '丢失了原备注' }]
    })).toThrow('旧标记未迁移')
    expect(() => repository.initializeProjectCurrentScript({
      ...input,
      clientMutationId: randomUUID(),
      sourceRelations: [{ ...relation, sourceId: 'wrong-point' }]
    })).toThrow('旧素材关系未完整迁移')
    const initialized = repository.initializeProjectCurrentScript(input)
    expect(initialized).toMatchObject({ status: 'ready', snapshot: { annotations: [expect.objectContaining(annotation)] } })

    const temporaryProjectId = createProject(repository, '临时AI定位不升格')
    const temporary = repository.saveScript(
      temporaryProjectId,
      'user_edit',
      '<p><mark data-target-selection-id="selection-1">临时定位</mark><mark data-link-index="2">对照投影</mark></p>'
    )
    const temporarySelection = repository.loadProjectCurrentScript(temporaryProjectId)
    if (temporarySelection.status !== 'initialization_required') throw new Error('expected temporary mark selection')
    const temporaryCandidate = temporarySelection.candidates.find((item) => item.versionId === temporary.id)!
    expect(repository.initializeProjectCurrentScript({
      projectId: temporaryProjectId,
      clientMutationId: randomUUID(),
      sourceVersionId: temporary.id,
      expectedSourceContentHash: temporaryCandidate.sourceContentHash,
      editorDocument: editorDocument('temporary-block', '临时定位对照投影'),
      sourceRelations: [],
      annotations: []
    })).toMatchObject({ status: 'ready', snapshot: { annotations: [] } })

    const duplicateProjectId = createProject(repository, '重复文字不静默迁移')
    const duplicate = repository.saveScript(duplicateProjectId, 'user_edit', '<p><u>重复</u>与重复</p>')
    const duplicateSelection = repository.loadProjectCurrentScript(duplicateProjectId)
    if (duplicateSelection.status !== 'initialization_required') throw new Error('expected duplicate selection')
    const duplicateCandidate = duplicateSelection.candidates.find((item) => item.versionId === duplicate.id)!
    const duplicateDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'duplicate-block', parentBlockIds: [] },
        content: [
          { type: 'text', text: '重复', marks: [{ type: 'underline' }] },
          { type: 'text', text: '与重复' }
        ]
      }]
    }
    expect(repository.initializeProjectCurrentScript({
      projectId: duplicateProjectId,
      clientMutationId: randomUUID(),
      sourceVersionId: duplicate.id,
      expectedSourceContentHash: duplicateCandidate.sourceContentHash,
      editorDocument: duplicateDocument,
      sourceRelations: [],
      annotations: []
    })).toMatchObject({ status: 'ready', snapshot: { annotations: [] } })
  })

  it('freezes the activity head into an explicit version and exposes the complete read-only history snapshot', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '显式版本冻结')
    const initial = initializeBlank(repository, projectId, 'format-block')
    const formatted = {
      type: 'doc',
      content: [{
        type: 'heading', attrs: { level: 2, blockId: 'format-block', parentBlockIds: [] },
        content: [{ type: 'text', text: '冻结格式', marks: [{ type: 'bold' }, { type: 'italic' }] }]
      }, {
        type: 'orderedList', attrs: { start: 5 }, content: [{
          type: 'listItem', attrs: { blockId: 'freeze-list-item', parentBlockIds: [] }, content: [{
            type: 'paragraph', attrs: { blockId: 'freeze-list-paragraph', parentBlockIds: [] },
            content: [{ type: 'text', text: '第五项' }]
          }]
        }]
      }]
    }
    const annotation: ScriptTextAnnotationInput = {
      id: 'freeze-annotation', blockId: 'format-block', blockStart: 0, blockEnd: 2, selectedText: '冻结',
      style: 'highlight', note: '历史标注', status: 'active'
    }
    const applied = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: formatted, sourceRelations: [], annotations: [annotation]
    })
    if (applied.status !== 'applied') throw new Error('expected formatted head')
    const before = (database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId) as { count: number }).count
    const mutationId = randomUUID()
    const saveInput = {
      projectId,
      workingDocumentId: applied.snapshot.document.workingDocumentId,
      clientMutationId: mutationId,
      expectedRevision: applied.snapshot.document.revision,
      expectedContentHash: applied.snapshot.document.contentHash,
      editorDocument: formatted,
      sourceRelations: [],
      annotations: [annotation],
      kind: 'user_edit' as const,
      displayName: '带格式冻结版'
    }
    const saved = repository.saveProjectCurrentScriptVersion(saveInput)
    expect(saved.status).toBe('saved')
    if (saved.status !== 'saved') throw new Error('expected saved current version')
    expect(saved.version.workspaceContent).toContain('<strong><em>冻结格式</em></strong>')
    expect(saved.version.workspaceContent).toContain('data-current-script-block-id="format-block"')
    expect(saved.version.workspaceContent).toContain('<ol start="5">')
    expect(saved.snapshot.document).toMatchObject({ revision: 2, lastSavedVersionId: saved.version.id })
    expect((database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId) as { count: number }).count).toBe(before + 1)
    const replay = repository.saveProjectCurrentScriptVersion(saveInput)
    expect(replay).toMatchObject({ status: 'saved', version: { id: saved.version.id }, revisionSnapshotId: saved.revisionSnapshotId })
    expect((database.prepare(`SELECT COUNT(*) AS count FROM draft_versions WHERE project_id=?`).get(projectId) as { count: number }).count).toBe(before + 1)
    const historical = repository.getCurrentScriptVersionSnapshot(projectId, saved.version.id)
    expect(historical).toMatchObject({
      document: { editorDocument: formatted, lastSavedVersionId: saved.version.id },
      annotations: [expect.objectContaining(annotation)]
    })
    expect(() => RESPONSE_SCHEMAS.saveProjectCurrentScriptVersionResultSchema.parse(saved)).not.toThrow()
    expect(() => RESPONSE_SCHEMAS.projectCurrentScriptSnapshotSchema.nullable().parse(historical)).not.toThrow()

    const finalized = repository.saveProjectCurrentScriptVersion({
      ...saveInput,
      clientMutationId: randomUUID(),
      expectedRevision: saved.snapshot.document.revision,
      expectedContentHash: saved.snapshot.document.contentHash,
      kind: 'merged_draft',
      finalize: true,
      displayName: '原子定稿版'
    })
    expect(finalized.status).toBe('saved')
    if (finalized.status !== 'saved') throw new Error('expected atomically finalized current version')
    expect(finalized.version).toMatchObject({ kind: 'merged_draft', isFinal: true, displayName: '原子定稿版' })
    expect(repository.getProject(projectId).versions.filter((version) => version.isFinal).map((version) => version.id)).toEqual([finalized.version.id])
    expect(finalized.snapshot.document.lastSavedVersionId).toBe(finalized.version.id)
  })

  it('keeps conflict evidence frozen, resolves it once, and can save the attempted copy without replacing the head', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '冲突恢复状态机')
    const initial = initializeBlank(repository, projectId, 'conflict-block')
    const headTwo = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('conflict-block', '服务端第二版'), sourceRelations: [], annotations: []
    })
    if (headTwo.status !== 'applied') throw new Error('expected second head')
    const conflictMutationId = randomUUID()
    const conflictInput = {
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: conflictMutationId,
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('conflict-block', '未保存客户端稿'), sourceRelations: [], annotations: []
    }
    const conflict = repository.applyProjectCurrentScriptTransaction(conflictInput)
    if (conflict.status !== 'conflict') throw new Error('expected conflict')
    const savedHead = repository.saveProjectCurrentScriptVersion({
      projectId,
      workingDocumentId: headTwo.snapshot.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: headTwo.snapshot.document.revision,
      expectedContentHash: headTwo.snapshot.document.contentHash,
      editorDocument: headTwo.snapshot.document.editorDocument,
      sourceRelations: [],
      annotations: [],
      kind: 'user_edit',
      displayName: '服务端第二版备份'
    })
    if (savedHead.status !== 'saved') throw new Error('expected saved head after conflict')
    const headThree = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: headTwo.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 2, expectedContentHash: headTwo.snapshot.document.contentHash,
      editorDocument: editorDocument('conflict-block', '服务端第三版'), sourceRelations: [], annotations: []
    })
    if (headThree.status !== 'applied') throw new Error('expected third head')
    expect(repository.applyProjectCurrentScriptTransaction(conflictInput)).toMatchObject({
      status: 'conflict', actual: { document: { revision: 2, lastSavedVersionId: null, editorDocument: editorDocument('conflict-block', '服务端第二版') } }
    })
    expect(repository.listCurrentScriptRecoveryCandidates(projectId).find((item) => item.id === conflict.conflictId)).toMatchObject({
      actual: { document: { revision: 2 } }
    })
    const resolved = repository.resolveCurrentScriptRecovery({
      projectId, conflictId: conflict.conflictId, resolutionKind: 'saved_attempt_as_version',
      resolvedRevisionSnapshotId: null, versionKind: 'user_edit', displayName: '冲突备份'
    })
    expect(resolved.savedVersionId).toBeTruthy()
    expect(repository.listCurrentScriptRecoveryCandidates(projectId).some((item) => item.id === conflict.conflictId)).toBe(false)
    expect(repository.loadProjectCurrentScript(projectId)).toMatchObject({
      status: 'ready', snapshot: { document: { revision: 3, editorDocument: editorDocument('conflict-block', '服务端第三版') } }
    })
    expect(database.prepare(`SELECT parent_version_ids_json AS parents FROM draft_versions WHERE id=?`).get(resolved.savedVersionId)).toEqual({ parents: '[]' })
    expect(repository.getCurrentScriptVersionSnapshot(projectId, resolved.savedVersionId!)).toMatchObject({
      document: { editorDocument: editorDocument('conflict-block', '未保存客户端稿') }
    })
    expect(() => RESPONSE_SCHEMAS.resolvedCurrentScriptRecoverySchema.parse(resolved)).not.toThrow()

    const replacementConflict = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: headTwo.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 2, expectedContentHash: headTwo.snapshot.document.contentHash,
      editorDocument: editorDocument('conflict-block', '显式替换稿'), sourceRelations: [], annotations: []
    })
    if (replacementConflict.status !== 'conflict') throw new Error('expected replacement conflict')
    const changedBeforeConfirmation = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: replacementConflict.actual.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: replacementConflict.actual.document.revision,
      expectedContentHash: replacementConflict.actual.document.contentHash,
      editorDocument: editorDocument('conflict-block', '替换确认前服务端继续更新'),
      sourceRelations: [],
      annotations: []
    })
    if (changedBeforeConfirmation.status !== 'applied') throw new Error('expected intervening server update')
    expect(() => repository.resolveCurrentScriptRecovery({
      projectId,
      conflictId: replacementConflict.conflictId,
      resolutionKind: 'replaced_with_attempt',
      resolvedRevisionSnapshotId: null,
      expectedHeadWorkingDocumentId: replacementConflict.actual.document.workingDocumentId,
      expectedHeadRevision: replacementConflict.actual.document.revision,
      expectedHeadContentHash: replacementConflict.actual.document.contentHash
    })).toThrow('CURRENT_SCRIPT_RECOVERY_HEAD_CHANGED')
    expect(repository.listCurrentScriptRecoveryCandidates(projectId).some((item) => item.id === replacementConflict.conflictId)).toBe(true)
    const replacement = repository.resolveCurrentScriptRecovery({
      projectId,
      conflictId: replacementConflict.conflictId,
      resolutionKind: 'replaced_with_attempt',
      resolvedRevisionSnapshotId: null,
      expectedHeadWorkingDocumentId: changedBeforeConfirmation.snapshot.document.workingDocumentId,
      expectedHeadRevision: changedBeforeConfirmation.snapshot.document.revision,
      expectedHeadContentHash: changedBeforeConfirmation.snapshot.document.contentHash
    })
    expect(replacement).toMatchObject({ resolutionKind: 'replaced_with_attempt', resolvedRevisionSnapshotId: expect.any(String) })
    expect(repository.loadProjectCurrentScript(projectId)).toMatchObject({
      status: 'ready',
      snapshot: { document: { editorDocument: replacementConflict.attempted.editorDocument } }
    })
    expect(repository.listCurrentScriptRecoveryCandidates(projectId).some((item) => item.id === replacementConflict.conflictId)).toBe(false)
  })

  it('restores the activity head, material snapshot and a new frozen version in one transaction', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, '原子恢复历史版本')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '历史素材原稿' })
    const historicalMaterial = repository.createScriptMaterialRevision(projectId)
    const initial = initializeBlank(repository, projectId, 'restore-block')
    const historicalDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { blockId: 'restore-block', parentBlockIds: [] },
        content: [{ type: 'text', text: '历史正文', marks: [{ type: 'underline', attrs: { annotationId: 'restore-annotation', annotationNote: '保留备注', annotationBlockId: 'restore-block' } }] }]
      }]
    }
    const annotation: ScriptTextAnnotationInput = {
      id: 'restore-annotation', blockId: 'restore-block', blockStart: 0, blockEnd: 4,
      selectedText: '历史正文', style: 'underline', note: '保留备注', status: 'active'
    }
    const historicalHead = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision, expectedContentHash: initial.document.contentHash,
      editorDocument: historicalDocument, sourceRelations: [], annotations: [annotation]
    })
    if (historicalHead.status !== 'applied') throw new Error('expected historical head')
    const historicalVersion = repository.saveProjectCurrentScriptVersion({
      projectId, workingDocumentId: historicalHead.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: historicalHead.snapshot.document.revision, expectedContentHash: historicalHead.snapshot.document.contentHash,
      editorDocument: historicalDocument, sourceRelations: [], annotations: [annotation], kind: 'merged_draft', displayName: '历史冻结版'
    })
    if (historicalVersion.status !== 'saved') throw new Error('expected historical version')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '当前素材已变化' })
    repository.createScriptMaterialRevision(projectId)
    const currentHead = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: historicalHead.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: historicalHead.snapshot.document.revision, expectedContentHash: historicalHead.snapshot.document.contentHash,
      editorDocument: editorDocument('restore-block', '当前正文已变化'), sourceRelations: [], annotations: []
    })
    if (currentHead.status !== 'applied') throw new Error('expected current head')
    const restored = repository.restoreProjectCurrentScriptVersion({
      projectId, workingDocumentId: currentHead.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: currentHead.snapshot.document.revision, expectedContentHash: currentHead.snapshot.document.contentHash,
      editorDocument: historicalDocument, sourceRelations: [], annotations: [annotation],
      sourceVersionId: historicalVersion.version.id, displayName: '历史冻结版恢复'
    })
    expect(restored.status).toBe('restored')
    if (restored.status !== 'restored') throw new Error('expected atomic restore')
    expect(restored.snapshot).toMatchObject({
      document: { editorDocument: historicalDocument, lastSavedVersionId: restored.version.id },
      annotations: [expect.objectContaining({ id: annotation.id, note: annotation.note })]
    })
    expect(restored.version.parentVersionIds).toEqual([historicalVersion.version.id])
    expect(restored.materialWorkspace?.activeRevision?.id).toBe(historicalMaterial.activeRevision?.id)
    expect(repository.getCurrentScriptVersionSnapshot(projectId, restored.version.id)).toMatchObject({
      document: { editorDocument: historicalDocument },
      annotations: [expect.objectContaining({ id: annotation.id })]
    })
    expect(() => RESPONSE_SCHEMAS.restoreProjectCurrentScriptVersionResultSchema.parse(restored)).not.toThrow()
  })

  it('keeps a restored material workspace exact, copy-on-writes it, and replays restore without later side effects', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '恢复素材精确快照')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '同一修订素材', requirement: '历史要求' })
    const material = repository.createScriptMaterialRevision(projectId)
    const revisionId = material.activeRevision?.id
    if (!revisionId) throw new Error('expected material revision')
    const stamp = '2026-08-02T08:00:00.000Z'
    database.prepare(`INSERT INTO script_material_drafts(
      id,project_id,revision_id,side,source_kind,requirement,input_fingerprint,content,content_hash,draft_version,
      mapping_state,current_mappings_json,paragraphs_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'historical-draft', projectId, revisionId, 'codex', 'freeform', '', 'history-input', '历史AI稿', createHash('sha256').update('历史AI稿').digest('hex'), 1,
      'ready', '[]', '[]', stamp, stamp
    )
    const abandonedMapping = repository.createTaskRun({
      taskType: 'script_material_map',
      projectId,
      title: '历史稿首次对应',
      provider: 'codex_cli',
      inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false },
      outputTarget: `script-material-map:${projectId}:${revisionId}:historical-draft`
    })
    database.prepare(`UPDATE script_material_drafts SET mapping_state='pending',mapping_task_id=? WHERE id='historical-draft'`)
      .run(abandonedMapping.id)
    const initial = initializeBlank(repository, projectId, 'overlay-block')
    const historyHead = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('overlay-block', '历史正文'), sourceRelations: [], annotations: []
    })
    if (historyHead.status !== 'applied') throw new Error('expected historical head')
    const historyVersion = repository.saveProjectCurrentScriptVersion({
      projectId, workingDocumentId: historyHead.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: historyHead.snapshot.document.revision, expectedContentHash: historyHead.snapshot.document.contentHash,
      editorDocument: historyHead.snapshot.document.editorDocument, sourceRelations: [], annotations: [],
      kind: 'merged_draft', displayName: '精确历史版'
    })
    if (historyVersion.status !== 'saved') throw new Error('expected historical version')
    database.prepare(`INSERT INTO script_material_drafts(
      id,project_id,revision_id,side,source_kind,requirement,input_fingerprint,content,content_hash,draft_version,
      mapping_state,current_mappings_json,paragraphs_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'late-draft', projectId, revisionId, 'codex', 'freeform', '', 'late-input', '快照后AI稿', createHash('sha256').update('快照后AI稿').digest('hex'), 2,
      'ready', '[]', '[]', stamp, stamp
    )
    database.prepare(`INSERT INTO script_material_messages(id,project_id,revision_id,side,role,content,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('late-message', projectId, revisionId, 'codex', 'assistant', '快照后消息', stamp)
    database.prepare(`INSERT INTO script_material_checks(
      id,project_id,revision_id,target,target_identity,target_content_hash,input_fingerprint,state,
      point_coverage_json,paragraph_findings_json,allowed_omission_point_ids_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'late-check', projectId, revisionId, 'current', 'current', 'a'.repeat(64), 'late-check-input', 'ready',
      '[]', '[]', '[]', stamp, stamp
    )
    const lateTask = repository.startScriptMaterialChat({
      projectId,
      side: 'codex',
      message: '恢复前启动的旧任务',
      providerSecurity
    })
    const current = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: historyHead.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: historyHead.snapshot.document.revision, expectedContentHash: historyHead.snapshot.document.contentHash,
      editorDocument: editorDocument('overlay-block', '现在的正文'), sourceRelations: [], annotations: []
    })
    if (current.status !== 'applied') throw new Error('expected current head')
    const restoreInput = {
      projectId, workingDocumentId: current.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: current.snapshot.document.revision, expectedContentHash: current.snapshot.document.contentHash,
      editorDocument: historyHead.snapshot.document.editorDocument, sourceRelations: [], annotations: [],
      sourceVersionId: historyVersion.version.id, displayName: '精确历史版恢复'
    }
    const restored = repository.restoreProjectCurrentScriptVersion(restoreInput)
    if (restored.status !== 'restored') throw new Error('expected restore')
    expect(restored.materialWorkspace?.drafts.map((draft) => draft.id)).toEqual(['historical-draft'])
    expect(restored.materialWorkspace?.drafts[0]).toMatchObject({
      mappingState: 'failed',
      mappingTaskId: null,
      mappingError: '历史对应任务已经结束，请手动重新对应'
    })
    expect(restored.materialWorkspace?.messages).toEqual([])
    expect(restored.materialWorkspace?.checks).toEqual([])
    expect(repository.getScriptMaterialVersionSnapshot(projectId, restored.version.id)?.workspace.drafts.map((draft) => draft.id))
      .toEqual(['historical-draft'])
    const editedMaterial = repository.saveScriptMaterialWorkspace(projectId, { requirement: '恢复后新要求' })
    expect(editedMaterial.drafts.map((draft) => draft.id)).toEqual(['historical-draft'])
    expect(editedMaterial.drafts[0]).toMatchObject({ mappingState: 'failed', mappingTaskId: null })
    expect(editedMaterial.messages).toEqual([])
    expect(editedMaterial.checks).toEqual([])
    expect(database.prepare(`SELECT id FROM script_material_drafts WHERE revision_id=? ORDER BY id`).all(revisionId))
      .toEqual([{ id: 'historical-draft' }])
    const afterLateTask = repository.saveScriptMaterialChatResult(lateTask.id, {
      answer: '这条旧结果不应写回来',
      draftContent: '恢复前任务生成的过期AI稿',
      annotations: []
    })
    expect(afterLateTask.drafts.map((draft) => draft.id)).toEqual(['historical-draft'])
    expect(afterLateTask.messages).toEqual([])

    const advanced = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: restored.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: restored.snapshot.document.revision, expectedContentHash: restored.snapshot.document.contentHash,
      editorDocument: editorDocument('overlay-block', '恢复之后继续写'), sourceRelations: [], annotations: []
    })
    if (advanced.status !== 'applied') throw new Error('expected advanced head')
    repository.saveScriptMaterialWorkspace(projectId, { requirement: '恢复之后继续改素材' })
    const replay = repository.restoreProjectCurrentScriptVersion(restoreInput)
    expect(replay).toMatchObject({ status: 'restored', version: { id: restored.version.id } })
    expect(repository.loadProjectCurrentScript(projectId)).toMatchObject({
      status: 'ready', snapshot: { document: { editorDocument: editorDocument('overlay-block', '恢复之后继续写') } }
    })
    expect(repository.getScriptMaterialWorkspace(projectId).requirement).toBe('恢复之后继续改素材')
    expect(() => repository.restoreProjectCurrentScriptVersion({ ...restoreInput, sourceVersionId: null }))
      .toThrow('CURRENT_SCRIPT_MUTATION_ID_REUSED')
  })

  it('rejects lossy legacy restores and detects immutable revision snapshot tampering', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '历史恢复完整性')
    const initial = initializeBlank(repository, projectId, 'integrity-block')
    const unsupported = repository.createVersion(projectId, 'script', 'user_edit', '<h4>旧四级标题</h4>', 'user')
    expect(() => repository.restoreProjectCurrentScriptVersion({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('integrity-block', '旧四级标题'), sourceRelations: [], annotations: [],
      sourceVersionId: unsupported.id, displayName: '不应静默恢复'
    })).toThrow('不会静默丢弃')

    const head = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('integrity-block', '可保存正文'), sourceRelations: [], annotations: []
    })
    if (head.status !== 'applied') throw new Error('expected head')
    const saved = repository.saveProjectCurrentScriptVersion({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: head.snapshot.document.editorDocument, sourceRelations: [], annotations: [], kind: 'user_edit'
    })
    if (saved.status !== 'saved') throw new Error('expected saved version')
    const other = repository.createVersion(projectId, 'script', 'user_edit', '另一版本', 'user')
    database.prepare(`UPDATE script_working_document_revisions SET saved_version_id=? WHERE id=?`).run(other.id, saved.revisionSnapshotId)
    expect(() => repository.getCurrentScriptVersionSnapshot(projectId, other.id)).toThrow('当前文案历史快照校验失败')
  })

  it('freezes a conflict backup against the attempted material source instead of the newer live workspace', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, '冲突素材来源')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '素材A' })
    let materialA = repository.createScriptMaterialRevision(projectId)
    const revisionA = materialA.activeRevision?.id
    if (!revisionA) throw new Error('expected material A')
    materialA = repository.replaceScriptMaterialPoints(projectId, revisionA, [{
      sourceStart: 0, sourceEnd: 3, sourceText: '素材A', summary: 'A要点'
    }])
    materialA = repository.confirmScriptMaterialPoints(projectId, revisionA)
    const pointA = materialA.points[0]!.id
    const initial = initializeBlank(repository, projectId, 'material-conflict-block')
    const relationDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'material-conflict-block', parentBlockIds: [] },
        content: [{
          type: 'text', text: '采用素材A', marks: [{ type: 'scriptMaterialRelation', attrs: {
            relationId: 'relation-a', relationBlockId: 'material-conflict-block',
            sourcePointIds: pointA, sourcePointVersion: revisionA, draftId: '', draftParagraphIds: ''
          } }]
        }]
      }]
    }
    const relationA: CurrentScriptSourceRelationInput = {
      id: 'relation-a', targetBlockId: 'material-conflict-block', targetStart: 0, targetEnd: 5,
      sourceKind: 'material_point', sourceId: pointA, sourceVersion: revisionA
    }
    const base = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision, expectedContentHash: initial.document.contentHash,
      editorDocument: relationDocument, sourceRelations: [relationA], annotations: []
    })
    if (base.status !== 'applied') throw new Error('expected material base')
    const frozenA = repository.saveProjectCurrentScriptVersion({
      projectId, workingDocumentId: base.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: base.snapshot.document.revision, expectedContentHash: base.snapshot.document.contentHash,
      editorDocument: relationDocument, sourceRelations: [relationA], annotations: [], kind: 'merged_draft'
    })
    if (frozenA.status !== 'saved') throw new Error('expected frozen A')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '素材B' })
    let materialB = repository.createScriptMaterialRevision(projectId)
    const revisionB = materialB.activeRevision?.id
    if (!revisionB) throw new Error('expected material B')
    materialB = repository.replaceScriptMaterialPoints(projectId, revisionB, [{
      sourceStart: 0, sourceEnd: 3, sourceText: '素材B', summary: 'B要点'
    }])
    materialB = repository.confirmScriptMaterialPoints(projectId, revisionB)
    const server = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: frozenA.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: frozenA.snapshot.document.revision, expectedContentHash: frozenA.snapshot.document.contentHash,
      editorDocument: editorDocument('material-conflict-block', '服务端改成素材B'), sourceRelations: [], annotations: []
    })
    if (server.status !== 'applied') throw new Error('expected server B')
    const conflict = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: frozenA.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: frozenA.snapshot.document.revision, expectedContentHash: frozenA.snapshot.document.contentHash,
      editorDocument: relationDocument, sourceRelations: [relationA], annotations: []
    })
    if (conflict.status !== 'conflict') throw new Error('expected material conflict')
    const resolved = repository.resolveCurrentScriptRecovery({
      projectId, conflictId: conflict.conflictId, resolutionKind: 'saved_attempt_as_version',
      resolvedRevisionSnapshotId: null, versionKind: 'user_edit', displayName: '素材A冲突副本'
    })
    const snapshot = repository.getScriptMaterialVersionSnapshot(projectId, resolved.savedVersionId!)
    expect(snapshot?.sourceRevisionId).toBe(revisionA)
    expect(snapshot?.sourceRevisionId).not.toBe(materialB.activeRevision?.id)
    expect(snapshot?.workspace.points.map((point) => point.id)).toEqual([pointA])

    const replacementConflict = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: frozenA.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: frozenA.snapshot.document.revision, expectedContentHash: frozenA.snapshot.document.contentHash,
      editorDocument: relationDocument, sourceRelations: [relationA], annotations: []
    })
    if (replacementConflict.status !== 'conflict') throw new Error('expected replacement material conflict')
    repository.resolveCurrentScriptRecovery({
      projectId, conflictId: replacementConflict.conflictId, resolutionKind: 'replaced_with_attempt',
      resolvedRevisionSnapshotId: null,
      expectedHeadWorkingDocumentId: server.snapshot.document.workingDocumentId,
      expectedHeadRevision: server.snapshot.document.revision,
      expectedHeadContentHash: server.snapshot.document.contentHash
    })
    expect(repository.getScriptMaterialWorkspace(projectId)).toMatchObject({
      activeRevision: { id: revisionA },
      points: [{ id: pointA }]
    })

    const pointB = materialB.points[0]!.id
    const wrongRelation: CurrentScriptSourceRelationInput = {
      id: 'relation-b', targetBlockId: 'material-conflict-block', targetStart: 0, targetEnd: 5,
      sourceKind: 'material_point', sourceId: pointB, sourceVersion: revisionB
    }
    const wrongDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'material-conflict-block', parentBlockIds: [] },
        content: [{
          type: 'text', text: '采用素材B', marks: [{ type: 'scriptMaterialRelation', attrs: {
            relationId: 'relation-b', relationBlockId: 'material-conflict-block',
            sourcePointIds: pointB, sourcePointVersion: revisionB, draftId: '', draftParagraphIds: ''
          } }]
        }]
      }]
    }
    const live = repository.loadProjectCurrentScript(projectId)
    if (live.status !== 'ready') throw new Error('expected live current script')
    expect(() => repository.restoreProjectCurrentScriptVersion({
      projectId, workingDocumentId: live.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: live.snapshot.document.revision, expectedContentHash: live.snapshot.document.contentHash,
      editorDocument: wrongDocument, sourceRelations: [wrongRelation], annotations: [],
      sourceVersionId: frozenA.version.id, displayName: '不应混入B素材'
    })).toThrow('素材来源与冻结快照不一致')
  })

  it('merges overlapping annotation projections across text nodes split by ordinary formatting', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, '重叠标记投影')
    const initial = initializeBlank(repository, projectId, 'overlap-block')
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'overlap-block', parentBlockIds: [] },
        content: [
          { type: 'text', text: '重', marks: [{ type: 'highlight', attrs: { color: '#F3D9A3' } }, { type: 'underline' }] },
          { type: 'text', text: '叠', marks: [{ type: 'highlight', attrs: { color: '#F3D9A3' } }, { type: 'underline' }, { type: 'bold' }] }
        ]
      }]
    }
    const applied = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision,
      expectedContentHash: initial.document.contentHash,
      editorDocument: document,
      sourceRelations: [],
      annotations: [
        { id: 'overlap-highlight', blockId: 'overlap-block', blockStart: 0, blockEnd: 2, selectedText: '重叠', style: 'highlight', note: '', status: 'active' },
        { id: 'overlap-underline', blockId: 'overlap-block', blockStart: 0, blockEnd: 2, selectedText: '重叠', style: 'underline', note: '', status: 'active' }
      ]
    })
    expect(applied).toMatchObject({ status: 'applied', snapshot: { annotations: [{ id: 'overlap-highlight' }, { id: 'overlap-underline' }] } })
  })

  it('merges persistent mark projections across marked hard breaks', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, '跨换行标记投影')
    const initial = initializeBlank(repository, projectId, 'hard-break-mark-block')
    const underline = { type: 'underline' }
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'hard-break-mark-block', parentBlockIds: [] },
        content: [
          { type: 'text', text: '甲', marks: [underline] },
          { type: 'hardBreak', marks: [underline] },
          { type: 'text', text: '乙', marks: [underline] }
        ]
      }]
    }
    const applied = repository.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: initial.document.workingDocumentId,
      clientMutationId: randomUUID(),
      expectedRevision: initial.document.revision,
      expectedContentHash: initial.document.contentHash,
      editorDocument: document,
      sourceRelations: [],
      annotations: [{
        id: 'hard-break-underline', blockId: 'hard-break-mark-block', blockStart: 0, blockEnd: 3,
        selectedText: '甲\n乙', style: 'underline', note: '', status: 'active'
      }]
    })
    expect(renderCurrentScriptEditorDocumentHtml(document)).toBe(
      '<p data-current-script-block-id="hard-break-mark-block"><u>甲</u><u><br></u><u>乙</u></p>'
    )
    expect(applied).toMatchObject({
      status: 'applied',
      snapshot: {
        annotations: [{ id: 'hard-break-underline', selectedText: '甲\n乙' }]
      }
    })
  })

  it('does not stale the live current-material check when a conflicting copy is only saved as an alternate version', () => {
    const { database, repository } = createRepository()
    const projectId = createProject(repository, '冲突备份不污染检查')
    repository.saveScriptMaterialWorkspace(projectId, { workingContent: '素材原稿' })
    const material = repository.createScriptMaterialRevision(projectId)
    const revisionId = material.activeRevision?.id
    if (!revisionId) throw new Error('expected material revision')
    const initial = initializeBlank(repository, projectId, 'audit-block')
    const server = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('audit-block', '服务端正文'), sourceRelations: [], annotations: []
    })
    if (server.status !== 'applied') throw new Error('expected server head')
    const timestamp = '2026-08-02T08:00:00.000Z'
    const targetHash = createHash('sha256').update('服务端正文').digest('hex')
    database.prepare(`INSERT INTO script_material_checks(
      id,project_id,revision_id,target,target_identity,target_content_hash,input_fingerprint,state,
      point_coverage_json,paragraph_findings_json,allowed_omission_point_ids_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'live-current-check', projectId, revisionId, 'current', 'current', targetHash, 'fingerprint', 'ready',
      '[]', '[]', '[]', timestamp, timestamp
    )
    const conflict = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('audit-block', '客户端冲突稿'), sourceRelations: [], annotations: []
    })
    if (conflict.status !== 'conflict') throw new Error('expected material conflict')
    repository.resolveCurrentScriptRecovery({
      projectId, conflictId: conflict.conflictId, resolutionKind: 'saved_attempt_as_version',
      resolvedRevisionSnapshotId: null, versionKind: 'user_edit', displayName: '冲突备份'
    })
    expect(database.prepare(`SELECT state,target_content_hash AS targetContentHash FROM script_material_checks WHERE id='live-current-check'`).get())
      .toEqual({ state: 'ready', targetContentHash: targetHash })
  })

  it('rejects reused mutation IDs, bad selected text, duplicate IDs and excessive document complexity', () => {
    const { repository } = createRepository()
    const projectId = createProject(repository, '防御性约束')
    const initial = initializeBlank(repository, projectId, 'guard-block')
    const mutationId = randomUUID()
    const firstInput = {
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: mutationId,
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: editorDocument('guard-block', '第一次'), sourceRelations: [], annotations: []
    }
    expect(repository.applyProjectCurrentScriptTransaction(firstInput).status).toBe('applied')
    expect(() => repository.applyProjectCurrentScriptTransaction({ ...firstInput, editorDocument: editorDocument('guard-block', '修改后重用ID') }))
      .toThrow('CURRENT_SCRIPT_MUTATION_ID_REUSED')

    const head = repository.loadProjectCurrentScript(projectId)
    if (head.status !== 'ready') throw new Error('expected guarded head')
    const inactive = repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: editorDocument('guard-block', '已删除原标注文字'), sourceRelations: [],
      annotations: [{
        id: 'not-migrated', blockId: 'removed-block', blockStart: 0, blockEnd: 99, selectedText: '原标注文字',
        style: 'flag', note: '等待人工处理', status: 'position_changed'
      }]
    })
    expect(inactive).toMatchObject({ status: 'applied', snapshot: { annotations: [expect.objectContaining({ id: 'not-migrated', status: 'position_changed' })] } })
    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: editorDocument('guard-block', '坐标文字'), sourceRelations: [],
      annotations: [{ id: 'bad-selected', blockId: 'guard-block', blockStart: 0, blockEnd: 2, selectedText: '错误', style: 'flag', note: '', status: 'active' }]
    })).toThrow('标注文字与块内范围不一致')
    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: { type: 'doc', content: [
        { type: 'paragraph', attrs: { blockId: 'same', parentBlockIds: [] }, content: [] },
        { type: 'paragraph', attrs: { blockId: 'same', parentBlockIds: [] }, content: [] }
      ] }, sourceRelations: [], annotations: []
    })).toThrow('block ID不能重复')

    let nested: Record<string, unknown> = { type: 'paragraph', attrs: { blockId: 'deep', parentBlockIds: [] }, content: [] }
    for (let index = 0; index < 33; index += 1) nested = { type: 'bulletList', content: [nested] }
    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: { type: 'doc', content: [nested] }, sourceRelations: [], annotations: []
    })).toThrow('嵌套不能超过32层')

    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: {
        type: 'doc', content: [{
          type: 'heading', attrs: { level: 4, blockId: 'unsupported-heading', parentBlockIds: [] }, content: [{ type: 'text', text: '四级标题' }]
        }]
      }, sourceRelations: [], annotations: []
    })).toThrow('标题只支持H1至H3')

    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: {
        type: 'doc', content: [{
          type: 'paragraph', attrs: { blockId: 'marker-block', parentBlockIds: [] },
          content: [{ type: 'text', text: '无ID标记', marks: [{ type: 'scriptMarker', attrs: { markerNote: '只有备注' } }] }]
        }]
      }, sourceRelations: [], annotations: []
    })).toThrow('脚本标记缺少稳定ID')

    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: {
        type: 'doc', content: [{
          type: 'paragraph', attrs: { blockId: 'ghost-relation-block', parentBlockIds: [] },
          content: [{ type: 'text', text: '幽灵来源', marks: [{ type: 'scriptMaterialRelation', attrs: { relationId: 'ghost-relation' } }] }]
        }]
      }, sourceRelations: [], annotations: []
    })).toThrow('素材关系投影没有对应的独立来源事实')

    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: editorDocument('large-block', '&'.repeat(300_000)), sourceRelations: [], annotations: []
    })).toThrow('转换为可保存格式后不能超过1MB')

    const tooManyBlocks = Array.from({ length: 10_001 }, (_, index) => ({
      type: 'paragraph', attrs: { blockId: `b${index}`, parentBlockIds: [] }, content: []
    }))
    expect(() => repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: head.snapshot.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: head.snapshot.document.revision, expectedContentHash: head.snapshot.document.contentHash,
      editorDocument: { type: 'doc', content: tooManyBlocks }, sourceRelations: [], annotations: []
    })).toThrow('文本块不能超过10000个')
  })

  it('preserves hard breaks and split/merge lineage and survives a real on-disk reopen', async () => {
    await mkdir(join(process.cwd(), 'test-results'), { recursive: true })
    const directory = await mkdtemp(join(process.cwd(), 'test-results', 'current-script-'))
    directories.push(directory)
    const firstStore = await openWorkspaceStore(directory)
    const projectId = createProject(firstStore.repository, '真实重启')
    const initial = initializeBlank(firstStore.repository, projectId, 'origin-block')
    const document = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'split-a', parentBlockIds: ['origin-block'] }, content: [{ type: 'text', text: '甲' }, { type: 'hardBreak' }, { type: 'text', text: '乙' }] },
        { type: 'paragraph', attrs: { blockId: 'merged', parentBlockIds: ['split-a', 'split-b'] }, content: [{ type: 'text', text: '合并' }] }
      ]
    }
    const applied = firstStore.repository.applyProjectCurrentScriptTransaction({
      projectId, workingDocumentId: initial.document.workingDocumentId, clientMutationId: randomUUID(),
      expectedRevision: 1, expectedContentHash: initial.document.contentHash,
      editorDocument: document,
      sourceRelations: [{ id: 'disk-relation', targetBlockId: 'merged', targetStart: 0, targetEnd: 2, sourceKind: 'brief_point', sourceId: 'brief-1', sourceVersion: '1' }],
      annotations: [{ id: 'disk-annotation', blockId: 'split-a', blockStart: 0, blockEnd: 3, selectedText: '甲\n乙', style: 'underline', note: '', status: 'active' }]
    })
    if (applied.status !== 'applied') throw new Error('expected disk apply')
    expect(applied.snapshot.blocks).toEqual([
      expect.objectContaining({ blockId: 'split-a', parentBlockIds: ['origin-block'], text: '甲\n乙' }),
      expect.objectContaining({ blockId: 'merged', parentBlockIds: ['split-a', 'split-b'], text: '合并' })
    ])
    firstStore.close()
    const reopenedStore = await openWorkspaceStore(directory)
    const reopened = reopenedStore.repository.loadProjectCurrentScript(projectId)
    expect(reopened).toMatchObject({
      status: 'ready',
      snapshot: {
        document: { revision: 2, editorDocument: document },
        sourceRelations: [expect.objectContaining({ id: 'disk-relation' })],
        annotations: [expect.objectContaining({ id: 'disk-annotation', selectedText: '甲\n乙' })]
      }
    })
    reopenedStore.close()
  })
})
