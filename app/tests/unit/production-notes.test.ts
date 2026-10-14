import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const roots: string[] = []
const stores: WorkspaceStore[] = []

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  const root = join(import.meta.dirname, '../../test-results/unit')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'creator-os-production-'))
  roots.push(directory)
  const store = await openWorkspaceStore(directory)
  stores.push(store)
  return { store, directory }
}

describe('project production notes', () => {
  it('persists shooting checklist and editing memo independently for a project', async () => {
    const { store, directory } = await createStore()
    expect(store.repository.getProjectProductionNotes('ai-browser')).toMatchObject({
      projectId: 'ai-browser',
      shootingItems: [],
      editingNotes: ''
    })
    const saved = store.repository.setProjectProductionNotes('ai-browser', {
      shootingItems: [
        { id: '7c18f690-8bd0-4c91-bf20-f70e1640dbe2', text: '去公园拍外景', completed: false, scheduleDate: '2026-07-27', scheduleSegment: 'morning' },
        { id: '12e5ddf8-aae0-445b-a1d9-f75b28bf0efd', text: '补录产品特写', completed: true, scheduleDate: null, scheduleSegment: null }
      ],
      editingNotes: '开头加快节奏\n保留环境声',
      editingNotesFormat: 'plain_text'
    })
    expect(saved.updatedAt).toBeTruthy()
    expect(store.repository.getProjectProductionNotes('ai-browser')).toEqual(saved)
    expect(store.repository.getProjectProductionNotes('ssd')).toMatchObject({ shootingItems: [], editingNotes: '' })
    store.close()
    stores.splice(stores.indexOf(store), 1)
    const reopened = await openWorkspaceStore(directory)
    stores.push(reopened)
    expect(reopened.repository.getProjectProductionNotes('ai-browser')).toEqual(saved)
  })

  it('normalizes legacy checklist and memo records without changing stage completion', async () => {
    const { store } = await createStore()
    const before = store.repository.getProject('ai-browser', false).stageTimeRecords.find((stage) => stage.stageKey === 'production')
    const timestamp = '2026-07-27T09:00:00.000Z'
    store.repository.native.prepare(`INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
      .run('production:ai-browser', JSON.stringify({
        projectId: 'ai-browser',
        shootingItems: [{ id: '7c18f690-8bd0-4c91-bf20-f70e1640dbe2', text: '旧待办', completed: false }],
        editingNotes: '<script>alert(1)</script>旧备忘',
        updatedAt: timestamp
      }), timestamp)
    expect(store.repository.getProjectProductionNotes('ai-browser')).toMatchObject({
      shootingItems: [{ text: '旧待办', scheduleDate: null, scheduleSegment: null }],
      editingNotesFormat: 'plain_text'
    })
    const after = store.repository.getProject('ai-browser', false).stageTimeRecords.find((stage) => stage.stageKey === 'production')
    expect(after).toEqual(before)
  })
})
