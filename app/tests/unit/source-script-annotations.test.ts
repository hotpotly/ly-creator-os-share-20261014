import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-source-annotation-'))
  roots.push(directory)
  const store = await openWorkspaceStore(directory)
  stores.push(store)
  return store
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('source-side script annotations', () => {
  it('persists exact source coordinates independently from ordinary rich-text formatting', async () => {
    const store = await createStore()
    const version = store.repository.saveScript(
      'ai-browser',
      'user_edit',
      '<h1>标题</h1><p><u>官方参数</u>是120克，但这条下划线是正文格式。</p>'
    )
    const annotation = store.repository.upsertSourceScriptAnnotation({
      id: 'source-annotation-exact',
      projectId: 'ai-browser',
      sourceKind: 'draft_version',
      sourceId: version.id,
      sourceVersion: String(version.revision),
      blockId: 'body',
      blockStart: 3,
      blockEnd: 7,
      selectedText: '官方参数',
      style: 'highlight',
      note: '联网核对后保留',
      status: 'active'
    })
    expect(annotation).toMatchObject({
      sourceKind: 'draft_version',
      coordinateSpace: 'block_text',
      selectedText: '官方参数',
      style: 'highlight'
    })
    expect(store.repository.listSourceScriptAnnotations('ai-browser', {
      sourceKind: 'draft_version', sourceId: version.id, sourceVersion: String(version.revision)
    })).toEqual([annotation])

    expect(() => store.repository.upsertSourceScriptAnnotation({
      id: annotation.id,
      projectId: 'ai-browser',
      sourceKind: 'draft_version',
      sourceId: version.id,
      sourceVersion: String(version.revision),
      blockId: 'body',
      blockStart: 3,
      blockEnd: 7,
      selectedText: '已经变化的文字',
      style: 'highlight',
      note: annotation.note,
      status: 'active'
    })).toThrow('标注文字与来源范围不一致')
    expect(store.repository.deleteSourceScriptAnnotation('ai-browser', annotation.id)).toBe(true)
    expect(store.repository.listSourceScriptAnnotations('ai-browser', { sourceId: version.id })).toEqual([])
  })
})
