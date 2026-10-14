import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectManagedFileProfile,
  discardManagedLocator,
  discardManagedLocators,
  retainLinkedFileFromPath,
  retainManagedFileFromBytes,
  retainManagedTreeFromPath,
  sweepUnreferencedManagedFiles,
  verifyLinkedFileSnapshot
} from '../../src/main/managed-files'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createRoot(): Promise<string> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-managed-files-'))
  roots.push(directory)
  return directory
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('managed file retention', () => {
  it('recognizes common file capabilities and atomically retains private bytes', async () => {
    const directory = await createRoot()
    expect(detectManagedFileProfile('产品 brief.pdf')).toMatchObject({ mimeType: 'application/pdf', capabilities: ['preview', 'parse'], processState: 'pending' })
    expect(detectManagedFileProfile('采访.m4a')).toMatchObject({ mimeType: 'audio/mp4', capabilities: ['preview', 'transcribe'], processState: 'pending' })
    expect(detectManagedFileProfile('素材.bin')).toMatchObject({ mimeType: 'application/octet-stream', capabilities: [], processState: 'stored_only' })

    const bytes = new TextEncoder().encode('统一附件正文')
    const retained = await retainManagedFileFromBytes(directory, {
      managedDirectory: join('managed-files', 'unit-project'), sourceName: '说明.txt', sourceOrigin: 'managed_import'
    }, bytes)
    expect(retained.file).toMatchObject({ kind: 'file', originalName: '说明.txt', mimeType: 'text/plain', processState: 'pending', sourceOrigin: 'managed_import' })
    expect(JSON.parse(retained.file.capabilitiesJson!)).toEqual(['preview', 'parse'])
    expect(await readFile(retained.absolutePath, 'utf8')).toBe('统一附件正文')
    expect((await stat(retained.absolutePath)).mode & 0o777).toBe(0o600)
    expect(await discardManagedLocator(directory, '../outside.txt')).toBe(false)
    expect(await stat(retained.absolutePath)).toBeTruthy()
  })

  it('copies a folder tree without following symlinks and reports only failed entries', async () => {
    const directory = await createRoot()
    const source = join(directory, 'Finder资料')
    const outside = join(directory, 'outside.txt')
    await mkdir(join(source, '参数'), { recursive: true })
    await writeFile(join(source, 'README.md'), '# 体验记录')
    await writeFile(join(source, '参数', '规格.txt'), '重量：100g')
    await writeFile(outside, '不能跟随')
    await symlink(outside, join(source, '参数', '外部链接.txt'))

    const retained = await retainManagedTreeFromPath(directory, {
      scopeId: 'project-unit', sourcePath: source, sourceBookmark: 'encrypted-source-bookmark'
    })
    expect(retained.root.file).toMatchObject({ kind: 'folder', originalName: 'Finder资料', sourceBookmark: 'encrypted-source-bookmark', mimeType: 'inode/directory' })
    expect(retained.entries.map((entry) => entry.importRelativePath)).toEqual(['Finder资料', join('Finder资料', '参数'), join('Finder资料', '参数', '规格.txt'), join('Finder资料', 'README.md')])
    expect(retained.entries.find((entry) => entry.file.originalName === '规格.txt')?.parentFileId).toBe(retained.entries.find((entry) => entry.file.originalName === '参数')?.file.id)
    expect(retained.failures).toEqual([{ relativePath: join('Finder资料', '参数', '外部链接.txt'), message: '已跳过符号链接' }])
    expect(await readFile(join(retained.root.absolutePath, '参数', '规格.txt'), 'utf8')).toBe('重量：100g')
    expect(retained.root.file.sha256).toMatch(/^[a-f0-9]{64}$/)

    expect(await discardManagedLocators(directory, retained.entries.map((entry) => entry.file.managedLocator!))).toBe(retained.entries.length)
    await expect(stat(retained.root.absolutePath)).rejects.toThrow()
  })

  it('keeps large subtitle inputs as external links instead of copying their bytes', async () => {
    const directory = await createRoot()
    const source = join(directory, '成片.mp4')
    await writeFile(source, 'external-video-bytes')
    const retained = await retainLinkedFileFromPath(directory, {
      sourcePath: source, managedDirectory: join('publishing-assets', 'project'), sourceBookmark: 'encrypted-source-path'
    })
    expect((await lstat(retained.absolutePath)).isSymbolicLink()).toBe(true)
    expect(await readFile(retained.absolutePath, 'utf8')).toBe('external-video-bytes')
    expect(retained.file).toMatchObject({ originalName: '成片.mp4', sourceOrigin: 'file_picker', sourceBookmark: 'encrypted-source-path' })
    await expect(verifyLinkedFileSnapshot(retained.absolutePath, retained.file)).resolves.toBeUndefined()
    await writeFile(source, 'updated-external-video')
    expect(await readFile(retained.absolutePath, 'utf8')).toBe('updated-external-video')
    await expect(verifyLinkedFileSnapshot(retained.absolutePath, retained.file)).rejects.toThrow('已发生变化')
  })

  it('sweeps untracked files while preserving referenced managed content', async () => {
    const directory = await createRoot()
    const keep = await retainManagedFileFromBytes(directory, { managedDirectory: join('managed-files', 'sweep'), sourceName: 'keep.txt' }, new Uint8Array([1]))
    const remove = await retainManagedFileFromBytes(directory, { managedDirectory: join('managed-files', 'sweep'), sourceName: 'remove.txt' }, new Uint8Array([2]))
    const partial = join(directory, 'managed-files', 'sweep', 'crash.partial-test')
    await writeFile(partial, 'partial')

    const result = await sweepUnreferencedManagedFiles(directory, [keep.file.managedLocator!])
    expect(result.removedFiles).toBe(2)
    expect(await readFile(keep.absolutePath)).toEqual(Buffer.from([1]))
    await expect(stat(remove.absolutePath)).rejects.toThrow()
    await expect(stat(partial)).rejects.toThrow()
  })
})
