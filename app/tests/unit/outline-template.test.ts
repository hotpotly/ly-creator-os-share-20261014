import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { extractOutlineTemplateItems, outlineTemplateName } from '../../src/main/outline-template'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-outline-template-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('outline template library', () => {
  it('extracts non-empty Word paragraphs as reusable structure without retaining the raw document', () => {
    expect(outlineTemplateName('/tmp/数码体验结构.docx')).toBe('数码体验结构')
    expect(extractOutlineTemplateItems('开头钩子\r\n\r\n\t真实体验  场景\n参数解释\u0000')).toEqual(['开头钩子', '真实体验 场景', '参数解释'])
    expect(() => extractOutlineTemplateItems('\n\t\n')).toThrow('没有可用的大纲结构')
  })

  it('persists, updates and removes only outline template resources', async () => {
    const { store, directory } = await createStore()
    const first = store.repository.saveOutlineTemplate({ name: '数码体验结构', sourceName: '数码体验结构.docx', items: ['开头', '体验', '结论'] })
    expect(first).toMatchObject({ resourceType: 'template', origin: 'own', selectionMode: 'manual_only', version: 1, isActive: true })
    expect(first.payload).toMatchObject({ kind: 'outline_template', sourceName: '数码体验结构.docx', items: ['开头', '体验', '结论'] })

    const updated = store.repository.saveOutlineTemplate({ name: '数码体验结构', sourceName: '数码体验结构.docx', items: ['场景', '实测', '购买建议'] })
    expect(updated).toMatchObject({ id: first.id, version: 2 })
    expect(updated.payload.items).toEqual(['场景', '实测', '购买建议'])
    expect(store.repository.deleteOutlineTemplate(first.id)).toBe(true)
    expect(store.repository.listResources().some((resource) => resource.id === first.id)).toBe(false)
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.listResources().some((resource) => resource.id === first.id)).toBe(false)
    expect(reopened.repository.listResources(true).find((resource) => resource.id === first.id)).toMatchObject({ isActive: false, version: 2 })
    reopened.close()
  })
})
