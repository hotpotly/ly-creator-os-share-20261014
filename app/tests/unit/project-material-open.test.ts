import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectMaterialRevealTarget } from '../../src/main/project-material-open'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('project material Finder target resolution', () => {
  it('prefers the encrypted original location and falls back to the managed copy', async () => {
    await mkdir(unitRoot, { recursive: true })
    const root = await mkdtemp(join(unitRoot, 'creator-os-material-open-')); roots.push(root)
    const source = join(root, 'original.pdf')
    const managedDirectory = join(root, 'project-materials', 'project')
    const managed = join(managedDirectory, 'copy.pdf')
    await mkdir(managedDirectory, { recursive: true })
    await Promise.all([writeFile(source, '%PDF-source'), writeFile(managed, '%PDF-managed')])

    await expect(resolveProjectMaterialRevealTarget({
      userDataPath: root, relativePath: 'project-materials/project/copy.pdf', encryptedSourcePath: 'ciphertext', decryptSourcePath: () => source
    })).resolves.toEqual({ kind: 'source', path: source })

    await unlink(source)
    await expect(resolveProjectMaterialRevealTarget({
      userDataPath: root, relativePath: 'project-materials/project/copy.pdf', encryptedSourcePath: 'ciphertext', decryptSourcePath: () => source
    })).resolves.toEqual({ kind: 'managed', path: managed })
  })

  it('rejects a managed path outside the project material root', async () => {
    await mkdir(unitRoot, { recursive: true })
    const root = await mkdtemp(join(unitRoot, 'creator-os-material-open-')); roots.push(root)
    const outside = join(root, 'outside.pdf'); await writeFile(outside, '%PDF-outside')
    await expect(resolveProjectMaterialRevealTarget({
      userDataPath: root, relativePath: 'outside.pdf', encryptedSourcePath: null, decryptSourcePath: () => ''
    })).rejects.toThrow('项目资料受管路径无效')
  })

  it('opens imported folders from the original location or managed-files fallback', async () => {
    await mkdir(unitRoot, { recursive: true })
    const root = await mkdtemp(join(unitRoot, 'creator-os-material-folder-open-')); roots.push(root)
    const source = join(root, '原始资料夹')
    const managed = join(root, 'managed-files', 'project', 'copy-folder')
    await Promise.all([mkdir(source, { recursive: true }), mkdir(managed, { recursive: true })])

    await expect(resolveProjectMaterialRevealTarget({
      userDataPath: root, relativePath: 'managed-files/project/copy-folder', encryptedSourcePath: 'ciphertext', expectedKind: 'folder', decryptSourcePath: () => source
    })).resolves.toEqual({ kind: 'source', path: source })

    await rm(source, { recursive: true })
    await expect(resolveProjectMaterialRevealTarget({
      userDataPath: root, relativePath: 'managed-files/project/copy-folder', encryptedSourcePath: 'ciphertext', expectedKind: 'folder', decryptSourcePath: () => source
    })).resolves.toEqual({ kind: 'managed', path: managed })
  })
})
