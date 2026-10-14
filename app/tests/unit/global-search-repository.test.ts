import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const directories: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-global-search-'))
  directories.push(directory)
  return openWorkspaceStore(directory)
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace global search projection', () => {
  it('searches live project, topic, inspiration and current script projections', async () => {
    const store = await createStore()
    expect(store.repository.searchGlobal('aillq').some((result) => result.kind === 'project' && result.id === 'ai-browser')).toBe(true)
    expect(store.repository.searchGlobal('第一周体验').some((result) => result.kind === 'topic')).toBe(true)
    expect(store.repository.searchGlobal('三步演示').some((result) => result.kind === 'inspiration' && result.id === 'capture-3')).toBe(true)
    expect(store.repository.searchGlobal('结果能追溯').some((result) => result.kind === 'script' && result.projectId === 'ai-browser')).toBe(true)
    store.repository.renameProject('ai-browser', 'AI工作台教程')
    expect(store.repository.searchGlobal('工作台教程')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'project', id: 'ai-browser', title: 'AI工作台教程' })]))
    store.close()
  })

  it('excludes trash and discarded captures and only exposes safe account search fields', async () => {
    const store = await createStore()
    store.repository.trashProject('desktop')
    store.repository.setCaptureUseStatus('capture-3', 'discarded')
    const timestamp = '2026-07-24T12:00:00.000Z'
    store.repository.native.prepare(`
      INSERT INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('account-search-test', 'account', 'LY科技频道', '敏感备用手机号13900000000', null, 'own', 'manual_only', 1, JSON.stringify({
      platform: 'B站', accountName: '科技频道', phone: '13800138000', token: 'secret-token-must-not-match'
    }), 1, timestamp, timestamp)

    expect(store.repository.searchGlobal('桌面改造').some((result) => result.projectId === 'desktop' || result.id === 'desktop')).toBe(false)
    expect(store.repository.searchGlobal('三步演示').some((result) => result.id === 'capture-3')).toBe(false)
    expect(store.repository.searchGlobal('科技频道')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'account', id: 'account-search-test' })]))
    expect(store.repository.searchGlobal('13800138000')).toEqual([])
    expect(store.repository.searchGlobal('13900000000')).toEqual([])
    expect(store.repository.searchGlobal('secret-token-must-not-match')).toEqual([])
    store.close()
  })
})
