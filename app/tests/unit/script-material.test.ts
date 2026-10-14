import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/db/migrations'
import { WorkspaceRepository } from '../../src/main/db/repository'
import { seedWorkspace } from '../../src/main/db/seed'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'

const databases: BetterSqlite3.Database[] = []

function createRepository(): WorkspaceRepository {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runMigrations(database)
  seedWorkspace(database, true)
  return new WorkspaceRepository(database)
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('script material traceability workspace', () => {
  it('keeps an editable working copy and freezes confirmed source revisions', () => {
    const repository = createRepository()
    let workspace = repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '先体验键盘。\n后来改用触控板。',
      requirement: '保留真实体验，补足衔接。',
      aiCount: 2,
      selectedAiSide: 'claude',
      webSearchMode: 'disabled'
    })
    expect(workspace).toMatchObject({
      activeRevision: null,
      aiCount: 2,
      selectedAiSide: 'claude',
      webSearchMode: 'disabled'
    })

    workspace = repository.createScriptMaterialRevision('ios')
    expect(workspace.activeRevision).toMatchObject({
      revision: 1,
      content: '先体验键盘。\n后来改用触控板。',
      pointsConfirmed: false
    })

    workspace = repository.replaceScriptMaterialPoints('ios', workspace.activeRevision!.id, [{
      sourceStart: 0,
      sourceEnd: 6,
      sourceText: '先体验键盘。',
      summary: '先体验键盘'
    }, {
      sourceStart: 7,
      sourceEnd: 15,
      sourceText: '后来改用触控板。',
      summary: '后来改用触控板',
      requirement: '说明改用原因'
    }])
    expect(workspace.points).toHaveLength(2)
    expect(new Set(workspace.points.map((point) => point.id)).size).toBe(2)
    const firstPointIds = workspace.points.map((point) => point.id)

    workspace = repository.confirmScriptMaterialPoints('ios', workspace.activeRevision!.id)
    expect(workspace.activeRevision?.pointsConfirmed).toBe(true)
    expect(workspace.activeRevision?.confirmedAt).toBeTruthy()
    expect(() => RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(workspace)).not.toThrow()

    workspace = repository.saveScriptMaterialWorkspace('ios', {
      workingContent: '先体验键盘。\n后来改用触控板。\n最后保留两个设备。'
    })
    expect(workspace.activeRevision?.revision).toBe(1)
    expect(workspace.activeRevision?.content).not.toBe(workspace.workingContent)

    workspace = repository.createScriptMaterialRevision('ios')
    expect(workspace.activeRevision?.revision).toBe(2)
    workspace = repository.replaceScriptMaterialPoints('ios', workspace.activeRevision!.id, [{
      sourceStart: 0,
      sourceEnd: 6,
      sourceText: '先体验键盘。',
      summary: '先体验键盘'
    }, {
      sourceStart: 7,
      sourceEnd: 15,
      sourceText: '后来改用触控板。',
      summary: '后来改用触控板'
    }, {
      sourceStart: 16,
      sourceEnd: 25,
      sourceText: '最后保留两个设备。',
      summary: '最后保留两个设备'
    }])
    expect(workspace.points.slice(0, 2).map((point) => point.id)).toEqual(firstPointIds)
    expect(workspace.points[2]?.id).toMatch(/^material-/)
  })

  it('requires exact source ranges and keeps post-mapping point edits immediately usable', () => {
    const repository = createRepository()
    repository.saveScriptMaterialWorkspace('ios', { workingContent: '第一段。\n第二段。' })
    let workspace = repository.createScriptMaterialRevision('ios')
    const revisionId = workspace.activeRevision!.id

    expect(() => repository.replaceScriptMaterialPoints('ios', revisionId, [{
      sourceStart: 0,
      sourceEnd: 4,
      sourceText: '错误段。',
      summary: '错误'
    }])).toThrow('与原稿位置不一致')

    workspace = repository.replaceScriptMaterialPoints('ios', revisionId, [{
      sourceStart: 0,
      sourceEnd: 4,
      sourceText: '第一段。',
      summary: '第一段'
    }, {
      sourceStart: 5,
      sourceEnd: 9,
      sourceText: '第二段。',
      summary: '第二段'
    }])
    workspace = repository.confirmScriptMaterialPoints('ios', revisionId)
    expect(workspace.activeRevision?.pointsConfirmed).toBe(true)

    workspace = repository.updateScriptMaterialPoint('ios', revisionId, workspace.points[1]!.id, {
      adoption: 'excluded',
      requirement: '本次不采用'
    })
    expect(workspace.points[1]).toMatchObject({ adoption: 'excluded', requirement: '本次不采用' })
    expect(workspace.activeRevision?.pointsConfirmed).toBe(true)
  })
})
