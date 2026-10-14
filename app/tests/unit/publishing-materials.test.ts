import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { discardPublishingAsset, retainPublishingAsset } from '../../src/main/publishing-assets'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-publishing-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('publishing material readiness', () => {
  it('persists text and file materials against the current final version and replaces old files safely', async () => {
    const { store, directory } = await createStore()
    const project = store.repository.getProject('ai-browser', false)
    const firstFinal = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    store.repository.setFinalVersion(project.id, firstFinal.id)

    expect(store.repository.savePublishingTextMaterial({ projectId: project.id, platform: 'B站', materialKind: 'title', textValue: 'AI浏览器真实体验' })).toMatchObject({ platform: 'B站', materialKind: 'title', textValue: 'AI浏览器真实体验', sourceVersionId: firstFinal.id, revision: 1 })
    expect(store.repository.savePublishingTextMaterial({ projectId: project.id, platform: 'B站', materialKind: 'title', textValue: 'AI浏览器一周体验' })).toMatchObject({ revision: 2, sourceVersionId: firstFinal.id })

    const userDataPath = dirname(store.databasePath)
    const firstFile = await retainPublishingAsset(userDataPath, project.id, 'cover', '封面.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    const firstCover = store.repository.savePublishingFileMaterial({ projectId: project.id, platform: 'B站', materialKind: 'cover', file: firstFile })
    expect(firstCover).toMatchObject({ replacedRelativePath: null, material: { fileName: '封面.png', sourceVersionId: firstFinal.id, revision: 1 } })
    expect((await readFile(join(userDataPath, firstFile.relativePath))).byteLength).toBe(8)

    const secondFile = await retainPublishingAsset(userDataPath, project.id, 'cover', '新封面.webp', new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]))
    const secondCover = store.repository.savePublishingFileMaterial({ projectId: project.id, platform: 'B站', materialKind: 'cover', file: secondFile })
    expect(secondCover).toMatchObject({ replacedRelativePath: firstFile.relativePath, material: { fileName: '新封面.webp', revision: 2 } })
    await discardPublishingAsset(userDataPath, secondCover.replacedRelativePath!)
    await expect(stat(join(userDataPath, firstFile.relativePath))).rejects.toThrow()
    expect(store.repository.getProject(project.id, false).publishingMaterials).toEqual(expect.arrayContaining([
      expect.objectContaining({ materialKind: 'title', revision: 2 }), expect.objectContaining({ materialKind: 'cover', revision: 2 })
    ]))
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getProject(project.id, false).publishingMaterials.find((item) => item.materialKind === 'cover')).toMatchObject({ fileName: '新封面.webp', revision: 2 })
    reopened.close()
  })

  it('rejects unsupported or binary publishing files', async () => {
    const { store } = await createStore()
    const userDataPath = dirname(store.databasePath)
    await expect(retainPublishingAsset(userDataPath, 'ai-browser', 'cover', '封面.gif', new Uint8Array([1]))).rejects.toThrow('PNG、JPG或WebP')
    await expect(retainPublishingAsset(userDataPath, 'ai-browser', 'cover', '伪装.png', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow('文件内容')
    await expect(retainPublishingAsset(userDataPath, 'ai-browser', 'subtitle', '字幕.srt', new Uint8Array([0xff, 0xfe]))).rejects.toThrow('UTF-8')
    const ass = await retainPublishingAsset(userDataPath, 'ai-browser', 'subtitle', '中英字幕.ass', new TextEncoder().encode('[Script Info]\\nScriptType: v4.00+'))
    expect(ass).toMatchObject({ originalName: '中英字幕.ass', mimeType: 'text/x-ssa' })
    store.close()
  })
})
