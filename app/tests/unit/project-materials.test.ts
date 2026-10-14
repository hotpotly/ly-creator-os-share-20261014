import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { importProjectAssetPaths } from '../../src/main/ipc'
import { cleanupReleasedManagedFiles, retainManagedFileFromBytes, retainManagedTreeFromPath } from '../../src/main/managed-files'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-materials-')); roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('project Brief and material persistence', () => {
  it('imports each selected root independently and returns partial, stored-only and failed results', async () => {
    const { store, directory } = await createStore()
    const sourceFolder = join(directory, '体验包')
    const outside = join(directory, 'outside.txt')
    const unknown = join(directory, '原始数据.xyz')
    const missing = join(directory, '已经移动.txt')
    await mkdir(sourceFolder, { recursive: true })
    await writeFile(join(sourceFolder, '实测.txt'), '温度升高')
    await writeFile(outside, '不能跟随')
    await writeFile(unknown, 'unknown')
    await symlink(outside, join(sourceFolder, '外部链接.txt'))

    const result = await importProjectAssetPaths(store, {
      secretProtector: { isAvailable: () => false, encrypt: () => { throw new Error('disabled') }, decrypt: () => { throw new Error('disabled') } }
    }, { projectId: 'ssd', role: 'project_material', usageType: 'material_clue', sourcePaths: [sourceFolder, unknown, missing] })

    expect(result).toMatchObject({ importedRootCount: 2, storedOnlyFileCount: 1, failedEntryCount: 2 })
    expect(result.items.map((item) => item.status)).toEqual(['partial', 'stored_only', 'failed'])
    expect(result.items[0]?.failedEntries).toEqual([{ relativePath: join('体验包', '外部链接.txt'), message: '已跳过符号链接' }])
    expect(JSON.stringify(result)).not.toContain(directory)
    const project = store.repository.getProject('ssd', false)
    expect(project.materials.map((material) => material.title)).toEqual(expect.arrayContaining(['体验包', '原始数据.xyz']))
    expect(project.assetLinks.filter((link) => link.parentLinkId === null).every((link) => link.usageType === 'material_clue')).toBe(true)
    store.close()
  })

  it('keeps the legacy Markdown framework as an optional scratch note', async () => {
    const { store, directory } = await createStore()
    const first = store.repository.saveProjectFramework('ssd', '# 本期框架\n\n- 先讲真实体验\n- 再讲速度变化')
    expect(first).toMatchObject({ id: 'project-framework:ssd', title: '项目框架', role: 'project_material', sourceKind: 'text' })
    const updated = store.repository.saveProjectFramework('ssd', '# 更新后的框架\n\n## 结论\n续航比参数更重要')
    expect(updated.id).toBe(first.id)
    expect(store.repository.getProject('ssd', false).materials.filter((item) => item.id === first.id)).toHaveLength(1)
    const preparation = store.repository.prepareTaskResources('ssd')
    expect(preparation.supportingMaterials).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id, kind: 'scratch_note', content: expect.stringContaining('续航比参数更重要') })]))
    expect(preparation.requiredInputs.find((item) => item.key === 'project_materials')?.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id })]))
    expect(store.repository.prepareTaskResources('ssd', { supportingMaterialIds: [first.id] }).requiredInputs.find((item) => item.key === 'project_materials')).toMatchObject({
      status: 'included', items: expect.arrayContaining([expect.objectContaining({ id: first.id })])
    })

    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getProject('ssd', false).materials.find((item) => item.id === first.id)?.textContent).toContain('更新后的框架')
    reopened.close()
  })

  it('keeps link-only Briefs visibly incomplete and sends saved text into task snapshots', async () => {
    const { store, directory } = await createStore()
    expect(store.repository.prepareTaskResources('sponsor').requiredInputs.find((item) => item.key === 'commercial_brief')).toMatchObject({ status: 'missing', items: [] })

    const link = store.repository.createProjectLinkMaterial({
      projectId: 'sponsor', role: 'brief', title: '甲方飞书原文', sourceUrl: 'https://brand.feishu.cn/docx/brief-id#section'
    })
    expect(link).toMatchObject({ sourceKind: 'link', parseStatus: 'link_only', sourceUrl: 'https://brand.feishu.cn/docx/brief-id' })
    expect(store.repository.prepareTaskResources('sponsor').requiredInputs.find((item) => item.key === 'commercial_brief')).toMatchObject({ status: 'empty' })

    const pasted = store.repository.createProjectTextMaterial({
      projectId: 'sponsor', role: 'brief', title: '微信确认版Brief', textContent: '必须说明户外收音稳定性，禁用绝对化表述。'
    })
    expect(pasted).toMatchObject({ sourceKind: 'text', parseStatus: 'ready' })
    const brief = store.repository.prepareTaskResources('sponsor').requiredInputs.find((item) => item.key === 'commercial_brief')!
    expect(brief.status).toBe('included')
    expect(brief.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pasted.id, content: expect.stringContaining('户外收音稳定性') }),
      expect.objectContaining({ id: link.id, content: expect.stringContaining('仅保存，未读取正文') })
    ]))
    expect(store.repository.buildTaskResourceSnapshot('sponsor').generationContext?.brief).toEqual(brief)
    expect(() => store.repository.createProjectTextMaterial({ projectId: 'ssd', role: 'brief', title: '', textContent: '不应保存' })).toThrow('Brief只用于商单项目')
    expect(store.repository.createProjectLinkMaterial({ projectId: 'sponsor', role: 'project_material', title: '官网规格', sourceUrl: 'https://example.com/specs#weight' })).toMatchObject({ sourceUrl: 'https://example.com/specs' })
    expect(() => store.repository.createProjectLinkMaterial({ projectId: 'sponsor', role: 'brief', title: '', sourceUrl: 'https://secret@example.com/brief' })).toThrow('只支持不含账号密码的HTTPS网页链接')

    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getProject('sponsor', false).materials).toHaveLength(3)
    expect(reopened.repository.getProject('sponsor', false).materials.map((item) => item.title)).toEqual(expect.arrayContaining(['甲方飞书原文', '微信确认版Brief']))
    reopened.close()
  })

  it('tracks parsed PDF files as project materials and removes their file references together', async () => {
    const { store } = await createStore()
    const pdf = store.repository.createProjectPdfMaterial({
      projectId: 'ssd', role: 'project_material', title: '持续写入测试说明', textContent: '持续写入到70%后需要继续记录温度。', pageCount: 3,
      file: { id: 'pdf-file-unit', relativePath: 'project-materials/ssd/unit.pdf', originalName: 'unit.pdf', sha256: 'a'.repeat(64), sizeBytes: 120, mimeType: 'application/pdf', createdAt: new Date().toISOString(), encryptedSourcePath: 'encrypted-original-path' }
    })
    expect(pdf).toMatchObject({ sourceKind: 'file', pageCount: 3, fileName: 'unit.pdf' })
    expect(store.repository.native.prepare('SELECT encrypted_source_path AS encryptedSourcePath,source_bookmark AS sourceBookmark,managed_locator AS managedLocator FROM file_references WHERE id=?').get('pdf-file-unit')).toEqual({
      encryptedSourcePath: 'encrypted-original-path', sourceBookmark: 'encrypted-original-path', managedLocator: 'project-materials/ssd/unit.pdf'
    })
    expect(store.repository.listProjectAssetLinks('ssd')).toEqual([expect.objectContaining({
      projectMaterialId: pdf.id, fileReferenceId: 'pdf-file-unit', relativePath: 'unit.pdf', isPrimaryReference: false
    })])
    expect(JSON.stringify(store.repository.getProject('ssd', false).materials)).not.toContain('encrypted-original-path')
    expect(store.repository.prepareTaskResources('ssd').supportingMaterials).toEqual(expect.arrayContaining([expect.objectContaining({ id: pdf.id, kind: 'project_material' })]))
    expect(store.repository.prepareTaskResources('ssd').requiredInputs.find((item) => item.key === 'project_materials')?.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: pdf.id })]))
    expect(store.repository.deleteProjectMaterial('ssd', pdf.id)).toEqual({
      deleted: true, relativePath: 'project-materials/ssd/unit.pdf', managedLocators: ['project-materials/ssd/unit.pdf']
    })
    expect(store.repository.native.prepare('SELECT 1 FROM file_references WHERE id=?').get('pdf-file-unit')).toBeUndefined()
    expect(() => store.repository.deleteProjectMaterial('sponsor', pdf.id)).toThrow('不存在')
    store.close()
  })

  it('persists multiple primary references and freezes notes, requirements and missing states into task snapshots', async () => {
    const { store, directory } = await createStore()
    const first = store.repository.createProjectPdfMaterial({
      projectId: 'ssd', role: 'project_material', title: '官方规格', textContent: '官方标注重量为800克。', pageCount: 2,
      file: { id: 'primary-spec', relativePath: 'project-materials/ssd/spec.pdf', originalName: 'spec.pdf', sha256: 'b'.repeat(64), sizeBytes: 88, mimeType: 'application/pdf', createdAt: new Date().toISOString(), encryptedSourcePath: null }
    })
    const second = store.repository.createProjectPdfMaterial({
      projectId: 'ssd', role: 'project_material', title: '实测记录', textContent: '实测体感更轻，但不改写官方规格。', pageCount: 1,
      file: { id: 'primary-test', relativePath: 'project-materials/ssd/test.pdf', originalName: 'test.pdf', sha256: 'c'.repeat(64), sizeBytes: 66, mimeType: 'application/pdf', createdAt: new Date().toISOString(), encryptedSourcePath: null }
    })
    const links = store.repository.listProjectAssetLinks('ssd').filter((link) => [first.id, second.id].includes(link.projectMaterialId))
    expect(links).toHaveLength(2)
    const saved = store.repository.saveProjectPrimaryReferences({
      projectId: 'ssd', referenceRequirements: '先讲实际体验，规格冲突时明确标记。',
      references: [
        { linkId: links[0]!.id, attentionNote: '重量数字以这份官方资料为准。' },
        { linkId: links[1]!.id, attentionNote: '只用于个人体验，不覆盖官方参数。' }
      ]
    })
    expect(saved.referenceRequirements).toContain('规格冲突')
    expect(saved.assetLinks.filter((link) => link.isPrimaryReference)).toEqual(expect.arrayContaining([
      expect.objectContaining({ attentionNote: '重量数字以这份官方资料为准。' }),
      expect.objectContaining({ attentionNote: '只用于个人体验，不覆盖官方参数。' })
    ]))
    store.repository.native.prepare("UPDATE file_references SET availability='source_missing' WHERE id='primary-test'").run()
    const preparation = store.repository.prepareTaskResources('ssd')
    expect(preparation.primaryReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ linkId: links[0]!.id, status: 'included', materialTitle: '官方规格', materialUpdatedAt: expect.any(String) }),
      expect.objectContaining({ linkId: links[1]!.id, status: 'missing', materialTitle: '实测记录' })
    ]))
    const snapshot = store.repository.buildTaskResourceSnapshot('ssd')
    const input = store.repository.composeDraftTaskInput('ssd', '生成文案', snapshot)
    expect(input).toContain('【主要参考与逐项注意事项】')
    expect(input).toContain('重量数字以这份官方资料为准')
    expect(input).toContain('个人体验优先用户实测')

    store.repository.saveProjectPrimaryReferences({ projectId: 'ssd', referenceRequirements: '新要求', references: [] })
    expect(snapshot.referenceRequirements).toContain('规格冲突')
    expect(snapshot.primaryReferences).toHaveLength(2)
    expect(() => store.repository.saveProjectPrimaryReferences({ projectId: 'sponsor', referenceRequirements: '', references: [{ linkId: links[0]!.id, attentionNote: '' }] })).toThrow('不属于当前项目')

    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getProject('ssd', false).referenceRequirements).toBe('新要求')
    reopened.close()
  })

  it('supports multiple scratch notes and freezes only selected supporting inputs into generation context', async () => {
    const { store } = await createStore()
    const first = store.repository.saveProjectScratchNote('ssd', null, '体验碎片', '- 手感比预期轻\n- 风扇声偏明显')
    const second = store.repository.saveProjectScratchNote('ssd', null, '补拍清单', '- 补拍接口\n- 补拍重量')
    const updated = store.repository.saveProjectScratchNote('ssd', first.id, '体验碎片·更新', '- 风扇声只在高负载明显')
    expect(updated.id).toBe(first.id)
    expect(second.id).not.toBe(first.id)

    const context = store.repository.buildProjectGenerationContext('ssd', [updated.id])
    expect(context.supportingMaterials).toEqual([expect.objectContaining({ id: updated.id, title: '体验碎片·更新' })])
    expect(context.supportingMaterials).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: second.id })]))
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.supportingMaterials)).toBe(true)
    expect(() => store.repository.buildProjectGenerationContext('ssd', ['missing-note'])).toThrow('包含不可用的补充资料')
    const longNote = store.repository.saveProjectScratchNote('ssd', null, '长笔记', '长'.repeat(200_000))
    const snapshot = store.repository.buildTaskResourceSnapshot('ssd', { supportingMaterialIds: [longNote.id] })
    expect(JSON.stringify(snapshot).length).toBeLessThan(350_000)
    expect(snapshot.supportingMaterials).toHaveLength(0)
    expect(snapshot.generationContext?.supportingMaterials[0]?.content).toContain('上下文已截断')
    store.close()
  })

  it('keeps a primary Brief body only once while retaining its primary-reference note', async () => {
    const { store } = await createStore()
    const uniqueBriefText = '唯一商单Brief正文：户外稳定性必须出现。'
    const brief = store.repository.createProjectPdfMaterial({
      projectId: 'sponsor', role: 'brief', title: '合作Brief', textContent: uniqueBriefText, pageCount: 1,
      file: { id: 'sponsor-brief-primary', relativePath: 'project-materials/sponsor/brief.pdf', originalName: 'brief.pdf', sha256: 'd'.repeat(64), sizeBytes: 72, mimeType: 'application/pdf', createdAt: new Date().toISOString(), encryptedSourcePath: null }
    })
    const link = store.repository.listProjectAssetLinks('sponsor').find((item) => item.projectMaterialId === brief.id)!
    store.repository.saveProjectPrimaryReferences({
      projectId: 'sponsor', referenceRequirements: '以这份Brief为主要参考',
      references: [{ linkId: link.id, attentionNote: '同时保留主要参考备注' }]
    })

    const context = store.repository.buildProjectGenerationContext('sponsor')
    expect(context.brief?.items[0]?.content).toBe(uniqueBriefText)
    expect(context.primaryReferences[0]).toMatchObject({ projectMaterialId: brief.id, content: null, attentionNote: '同时保留主要参考备注' })
    const prompt = store.repository.composeDraftTaskInput('sponsor', '生成商单文案', store.repository.buildTaskResourceSnapshot('sponsor'))
    expect(prompt.match(new RegExp(uniqueBriefText, 'g'))).toHaveLength(1)
    expect(prompt).toContain('同时保留主要参考备注')
    store.close()
  })

  it('writes folder relationships atomically and releases only files without remaining business relationships', async () => {
    const { store, directory } = await createStore()
    const source = join(directory, '参考资料')
    await mkdir(join(source, '实测'), { recursive: true })
    await writeFile(join(source, 'brief.pdf'), '%PDF-1.7\nunit')
    await writeFile(join(source, '实测', '续航.txt'), '连续播放12小时')
    const retained = await retainManagedTreeFromPath(directory, { scopeId: 'ssd', sourcePath: source, sourceBookmark: 'encrypted-folder-source' })
    const material = store.repository.createProjectAssetMaterial({
      projectId: 'ssd', role: 'project_material', title: '整包参考资料',
      entries: retained.entries.map((entry) => ({ file: entry.file, importRelativePath: entry.importRelativePath, parentFileId: entry.parentFileId })),
      usageType: 'material_clue'
    })
    expect(material).toMatchObject({ sourceKind: 'folder', parseStatus: 'ready', fileId: retained.root.file.id })
    const links = store.repository.listProjectAssetLinks('ssd').filter((link) => link.projectMaterialId === material.id)
    expect(links).toHaveLength(retained.entries.length)
    expect(links.every((link) => link.usageType === 'material_clue')).toBe(true)
    expect(links.find((link) => link.fileKind === 'folder')).toMatchObject({ mimeType: 'inode/directory', capabilities: ['browse'], processState: 'ready' })
    expect(store.repository.getProject('ssd', false).assetLinks.filter((link) => link.projectMaterialId === material.id)).toEqual(links)
    const folderLink = links.find((link) => link.relativePath === join('参考资料', '实测'))!
    const childEntry = retained.entries.find((entry) => entry.importRelativePath === join('参考资料', '实测', '续航.txt'))!
    expect(links.find((link) => link.fileReferenceId === childEntry.file.id)?.parentLinkId).toBe(folderLink.id)

    const capture = store.repository.createCapture({ captureKind: 'project_content', primaryProjectId: 'ssd', originalContent: '共享附件关系测试', sourceType: 'quick_capture' })
    store.repository.native.prepare('INSERT INTO capture_asset_links(id,capture_id,file_reference_id,attachment_kind,position,created_at) VALUES(?,?,?,?,?,?)')
      .run('shared-capture-file', capture.id, childEntry.file.id, 'file', 0, new Date().toISOString())

    const deleted = store.repository.deleteProjectMaterial('ssd', material.id)
    expect(deleted.managedLocators).not.toContain(childEntry.file.managedLocator)
    expect(store.repository.native.prepare('SELECT 1 FROM file_references WHERE id=?').get(childEntry.file.id)).toBeTruthy()
    await cleanupReleasedManagedFiles(directory, deleted.managedLocators, store.repository.listManagedFileLocators())
    expect(await stat(childEntry.absolutePath)).toBeTruthy()

    store.repository.native.prepare('DELETE FROM capture_asset_links WHERE id=?').run('shared-capture-file')
    const released = store.repository.releaseOrphanFileReferences([childEntry.file.id])
    expect(released).toEqual({ ids: [childEntry.file.id], managedLocators: [childEntry.file.managedLocator] })
    await cleanupReleasedManagedFiles(directory, released.managedLocators, store.repository.listManagedFileLocators())
    await expect(stat(retained.root.absolutePath)).rejects.toThrow()
    store.close()
  })

  it('recovers database and physical file orphans on the next startup', async () => {
    const { store, directory } = await createStore()
    const retained = await retainManagedFileFromBytes(directory, {
      managedDirectory: join('managed-files', 'crash-recovery'), sourceName: 'orphan.txt'
    }, new TextEncoder().encode('尚未完成的关系'))
    const material = store.repository.createProjectAssetMaterial({
      projectId: 'ssd', role: 'project_material', title: '崩溃恢复测试',
      entries: [{ file: retained.file, importRelativePath: retained.file.originalName, parentFileId: null }]
    })
    store.repository.native.prepare('DELETE FROM project_materials WHERE id=?').run(material.id)
    expect(store.repository.native.prepare('SELECT 1 FROM file_references WHERE id=?').get(retained.file.id)).toBeTruthy()
    expect(await stat(retained.absolutePath)).toBeTruthy()
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.native.prepare('SELECT 1 FROM file_references WHERE id=?').get(retained.file.id)).toBeUndefined()
    await expect(stat(retained.absolutePath)).rejects.toThrow()
    reopened.close()
  })
})
