import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

export type ProjectMaterialRevealTarget = { kind: 'source' | 'managed'; path: string }

async function accessiblePath(path: string, expectedKind: 'file' | 'folder'): Promise<string | null> {
  try {
    const resolved = await realpath(path)
    const info = await stat(resolved)
    return expectedKind === 'folder' ? (info.isDirectory() ? resolved : null) : (info.isFile() ? resolved : null)
  } catch { return null }
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export async function resolveProjectMaterialRevealTarget(input: {
  userDataPath: string
  relativePath: string
  encryptedSourcePath: string | null
  expectedKind?: 'file' | 'folder'
  decryptSourcePath(encrypted: string): string
}): Promise<ProjectMaterialRevealTarget> {
  const expectedKind = input.expectedKind ?? 'file'
  if (input.encryptedSourcePath) {
    try {
      const sourcePath = input.decryptSourcePath(input.encryptedSourcePath)
      const source = sourcePath ? await accessiblePath(sourcePath, expectedKind) : null
      if (source) return { kind: 'source', path: source }
    } catch { /* 加密记录损坏或系统密钥变更时改用受管副本 */ }
  }

  const allowedManagedRoots = ['project-materials', 'managed-files'].map((directory) => resolve(input.userDataPath, directory))
  const candidate = resolve(input.userDataPath, input.relativePath)
  const managedRoot = allowedManagedRoots.find((root) => isWithin(root, candidate))
  if (!managedRoot) throw new Error('项目资料受管路径无效')
  const managed = await accessiblePath(candidate, expectedKind)
  if (!managed) throw new Error('原始文件和App受管副本均不可用')

  const realManagedRoot = await realpath(join(managedRoot)).catch(() => managedRoot)
  if (!isWithin(realManagedRoot, managed)) throw new Error('项目资料受管路径无效')
  return { kind: 'managed', path: managed }
}
