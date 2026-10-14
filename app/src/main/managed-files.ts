import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rmdir, symlink, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type { FileReferenceInput } from '../shared/domain'

export const MAX_MANAGED_FILE_BYTES = 4 * 1024 * 1024 * 1024
export const MAX_MANAGED_TREE_BYTES = 50 * 1024 * 1024 * 1024
export const MAX_MANAGED_TREE_ENTRIES = 10_000
export const MAX_MANAGED_TREE_DEPTH = 64

const MANAGED_ROOTS = new Set(['managed-files', 'imports', 'project-materials', 'business-files', 'publishing-assets', 'archive-links', 'distribution-links'])
const COPY_BUFFER_BYTES = 1024 * 1024

export type ManagedFileCapability = 'preview' | 'parse' | 'ocr' | 'transcribe' | 'browse'

export interface ManagedFileProfile {
  mimeType: string
  capabilities: ManagedFileCapability[]
  processState: NonNullable<FileReferenceInput['processState']>
}

export interface ManagedFileRetentionOptions {
  managedDirectory: string
  sourceName: string
  sourceOrigin?: NonNullable<FileReferenceInput['sourceOrigin']>
  sourceBookmark?: string | null
  sourceModifiedAt?: string | null
  maximumBytes?: number
  profile?: ManagedFileProfile
}

export interface ManagedPathRetentionOptions extends Omit<ManagedFileRetentionOptions, 'sourceName'> {
  sourcePath: string
  sourceName?: string
}

export interface RetainedManagedFile {
  absolutePath: string
  file: FileReferenceInput
}

export interface RetainedManagedTreeEntry extends RetainedManagedFile {
  importRelativePath: string
  parentFileId: string | null
}

export interface ManagedTreeFailure {
  relativePath: string
  message: string
}

export interface RetainedManagedTree {
  root: RetainedManagedTreeEntry
  entries: RetainedManagedTreeEntry[]
  failures: ManagedTreeFailure[]
}

export interface ManagedFileSweepResult {
  removedFiles: number
  removedDirectories: number
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.tif': 'image/tiff',
  '.tiff': 'image/tiff', '.webp': 'image/webp'
}
const AUDIO_MIME_TYPES: Record<string, string> = {
  '.aac': 'audio/aac', '.aiff': 'audio/aiff', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav'
}
const VIDEO_MIME_TYPES: Record<string, string> = {
  '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.mp4': 'video/mp4', '.webm': 'video/webm'
}
const TEXT_MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv', '.html': 'text/html', '.json': 'application/json', '.log': 'text/plain', '.markdown': 'text/markdown',
  '.md': 'text/markdown', '.rtf': 'application/rtf', '.srt': 'application/x-subrip', '.text': 'text/plain', '.txt': 'text/plain',
  '.vtt': 'text/vtt', '.xml': 'application/xml', '.yaml': 'application/yaml', '.yml': 'application/yaml'
}

function profile(mimeType: string, capabilities: ManagedFileCapability[], processState: ManagedFileProfile['processState']): ManagedFileProfile {
  return { mimeType, capabilities, processState }
}

export function detectManagedFileProfile(name: string, kind: FileReferenceInput['kind'] = 'file'): ManagedFileProfile {
  if (kind === 'folder') return profile('inode/directory', ['browse'], 'ready')
  const extension = extname(name).toLowerCase()
  if (extension === '.pdf') return profile('application/pdf', ['preview', 'parse'], 'pending')
  if (extension === '.docx') return profile('application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['preview', 'parse'], 'pending')
  if (extension === '.doc') return profile('application/msword', ['preview', 'parse'], 'pending')
  if (extension === '.pages') return profile('application/vnd.apple.pages', ['preview'], 'ready')
  if (IMAGE_MIME_TYPES[extension]) return profile(IMAGE_MIME_TYPES[extension], ['preview', 'ocr'], 'pending')
  if (AUDIO_MIME_TYPES[extension]) return profile(AUDIO_MIME_TYPES[extension], ['preview', 'transcribe'], 'pending')
  if (VIDEO_MIME_TYPES[extension]) return profile(VIDEO_MIME_TYPES[extension], ['preview'], 'ready')
  if (TEXT_MIME_TYPES[extension]) return profile(TEXT_MIME_TYPES[extension], ['preview', 'parse'], 'pending')
  return profile('application/octet-stream', [], 'stored_only')
}

function safeName(sourceName: string): string {
  const name = basename(sourceName).trim()
  if (!name || name === '.' || name === '..' || name.includes('\0')) throw new Error('文件名无效')
  return name
}

function safeManagedDirectory(value: string): string {
  if (!value || isAbsolute(value)) throw new Error('受管目录无效')
  const normalized = normalize(value)
  const parts = normalized.split(sep)
  if (normalized === '.' || parts.some((part) => !part || part === '.' || part === '..')) throw new Error('受管目录无效')
  const root = parts[0]
  if (!root || !MANAGED_ROOTS.has(root)) throw new Error('受管目录不在允许范围内')
  return normalized
}

function safeManagedLocator(userDataPath: string, locator: string): { absolutePath: string; relativePath: string } {
  if (!locator || isAbsolute(locator)) throw new Error('受管文件位置无效')
  const relativePath = normalize(locator)
  const parts = relativePath.split(sep)
  const root = parts[0]
  if (relativePath === '.' || parts.length < 2 || !root || parts.some((part) => !part || part === '.' || part === '..') || !MANAGED_ROOTS.has(root)) {
    throw new Error('受管文件位置不在允许范围内')
  }
  const userRoot = resolve(userDataPath)
  const absolutePath = resolve(userRoot, relativePath)
  const escaped = relative(userRoot, absolutePath)
  if (!escaped || escaped.startsWith(`..${sep}`) || escaped === '..' || isAbsolute(escaped)) throw new Error('受管文件位置不在允许范围内')
  return { absolutePath, relativePath }
}

export function resolveManagedFilePath(userDataPath: string, locator: string): string {
  return safeManagedLocator(userDataPath, locator).absolutePath
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

async function writeBytesAtomically(destination: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${destination}.partial-${randomUUID()}`
  try {
    const output = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await output.writeFile(bytes); await output.sync() } finally { await output.close() }
    await rename(temporaryPath, destination)
  } catch (error) {
    await Promise.all([unlink(temporaryPath).catch(() => undefined), unlink(destination).catch(() => undefined)])
    throw error
  }
}

async function copyOpenFile(source: Awaited<ReturnType<typeof open>>, destination: string, expectedSize: number): Promise<string> {
  const output = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  const hash = createHash('sha256')
  let position = 0
  try {
    const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(expectedSize, 1)))
    while (position < expectedSize) {
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, expectedSize - position), position)
      if (bytesRead === 0) throw new Error('外部文件在读取过程中提前结束')
      hash.update(buffer.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written)
        if (result.bytesWritten === 0) throw new Error('受管文件副本写入中断')
        written += result.bytesWritten
      }
      position += bytesRead
    }
    await output.sync()
    return hash.digest('hex')
  } finally { await output.close() }
}

async function hashOpenFile(source: Awaited<ReturnType<typeof open>>, expectedSize: number): Promise<string> {
  const hash = createHash('sha256'); let position = 0
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(expectedSize, 1)))
  while (position < expectedSize) {
    const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, expectedSize - position), position)
    if (bytesRead === 0) throw new Error('外部文件在读取过程中提前结束')
    hash.update(buffer.subarray(0, bytesRead)); position += bytesRead
  }
  return hash.digest('hex')
}

function buildFileReference(input: {
  id?: string
  kind?: 'file' | 'folder'
  relativePath: string
  originalName: string
  sizeBytes: number
  sha256: string
  sourceOrigin: NonNullable<FileReferenceInput['sourceOrigin']>
  sourceBookmark?: string | null
  sourceModifiedAt?: string | null
  profile: ManagedFileProfile
}): FileReferenceInput {
  const timestamp = new Date().toISOString()
  return {
    id: input.id ?? randomUUID(), kind: input.kind ?? 'file', relativePath: input.relativePath, managedLocator: input.relativePath,
    originalName: input.originalName, sizeBytes: input.sizeBytes, sha256: input.sha256, mimeType: input.profile.mimeType,
    sourceModifiedAt: input.sourceModifiedAt ?? null,
    sourceBookmark: input.sourceBookmark ?? null, sourceOrigin: input.sourceOrigin, availability: 'available',
    processState: input.profile.processState, capabilitiesJson: JSON.stringify(input.profile.capabilities), createdAt: timestamp, updatedAt: timestamp
  }
}

function assertFileSize(size: number, maximum: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('文件为空或大小无效')
  if (size > maximum) throw new Error(`单个文件不能超过${Math.floor(maximum / 1024 / 1024)}MB`)
}

export async function retainManagedFileFromBytes(userDataPath: string, options: ManagedFileRetentionOptions, bytes: Uint8Array): Promise<RetainedManagedFile> {
  const maximum = options.maximumBytes ?? MAX_MANAGED_FILE_BYTES
  assertFileSize(bytes.byteLength, maximum)
  const originalName = safeName(options.sourceName)
  const directory = safeManagedDirectory(options.managedDirectory)
  const relativePath = join(directory, `${randomUUID()}-${originalName}`)
  const absolutePath = join(userDataPath, relativePath)
  await ensurePrivateDirectory(dirname(absolutePath))
  await writeBytesAtomically(absolutePath, bytes)
  const buffer = Buffer.from(bytes)
  return {
    absolutePath,
    file: buildFileReference({
      relativePath, originalName, sizeBytes: buffer.byteLength, sha256: createHash('sha256').update(buffer).digest('hex'),
      sourceOrigin: options.sourceOrigin ?? 'managed_import', sourceBookmark: options.sourceBookmark,
      sourceModifiedAt: options.sourceModifiedAt,
      profile: options.profile ?? detectManagedFileProfile(originalName)
    })
  }
}

async function retainOpenSourceFile(userDataPath: string, sourcePath: string, options: Omit<ManagedFileRetentionOptions, 'sourceName'> & { sourceName?: string }): Promise<RetainedManagedFile> {
  const maximum = options.maximumBytes ?? MAX_MANAGED_FILE_BYTES
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  let destination: string | null = null
  let temporaryPath: string | null = null
  try {
    const before = await source.stat()
    if (!before.isFile()) throw new Error('只能导入普通文件')
    assertFileSize(before.size, maximum)
    const originalName = safeName(options.sourceName ?? sourcePath)
    const directory = safeManagedDirectory(options.managedDirectory)
    const relativePath = join(directory, `${randomUUID()}-${originalName}`)
    destination = join(userDataPath, relativePath)
    temporaryPath = `${destination}.partial-${randomUUID()}`
    await ensurePrivateDirectory(dirname(destination))
    const sha256 = await copyOpenFile(source, temporaryPath, before.size)
    const after = await source.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('外部文件在读取过程中发生变化，请重试')
    }
    await rename(temporaryPath, destination)
    temporaryPath = null
    return {
      absolutePath: destination,
      file: buildFileReference({
        relativePath, originalName, sizeBytes: before.size, sha256, sourceOrigin: options.sourceOrigin ?? 'finder_drop',
        sourceBookmark: options.sourceBookmark, sourceModifiedAt: options.sourceModifiedAt ?? before.mtime.toISOString(),
        profile: options.profile ?? detectManagedFileProfile(originalName)
      })
    }
  } catch (error) {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    if (destination) await unlink(destination).catch(() => undefined)
    throw error
  } finally { await source.close() }
}

export async function retainManagedFileFromPath(userDataPath: string, options: ManagedPathRetentionOptions): Promise<RetainedManagedFile> {
  return retainOpenSourceFile(userDataPath, options.sourcePath, options)
}

export async function retainLinkedFileFromPath(userDataPath: string, options: ManagedPathRetentionOptions): Promise<RetainedManagedFile> {
  const maximum = options.maximumBytes ?? MAX_MANAGED_FILE_BYTES
  const source = await open(options.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  let destination: string | null = null
  try {
    const before = await source.stat()
    if (!before.isFile()) throw new Error('只能关联普通文件')
    assertFileSize(before.size, maximum)
    const originalName = safeName(options.sourceName ?? options.sourcePath)
    const directory = safeManagedDirectory(options.managedDirectory)
    const relativePath = join(directory, `${randomUUID()}-${originalName}`)
    destination = join(userDataPath, relativePath)
    await ensurePrivateDirectory(dirname(destination))
    const sha256 = await hashOpenFile(source, before.size)
    const after = await source.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('外部文件在关联过程中发生变化，请重试')
    await symlink(options.sourcePath, destination, 'file')
    return {
      absolutePath: destination,
      file: buildFileReference({
        relativePath, originalName, sizeBytes: before.size, sha256, sourceOrigin: options.sourceOrigin ?? 'file_picker',
        sourceBookmark: options.sourceBookmark, sourceModifiedAt: options.sourceModifiedAt ?? before.mtime.toISOString(),
        profile: options.profile ?? detectManagedFileProfile(originalName)
      })
    }
  } catch (error) {
    if (destination) await unlink(destination).catch(() => undefined)
    throw error
  } finally { await source.close() }
}

export async function openVerifiedLinkedFileSnapshot(path: string, expected: Pick<FileReferenceInput, 'sizeBytes' | 'sha256'>): Promise<Awaited<ReturnType<typeof open>>> {
  const link = await lstat(path)
  if (!link.isSymbolicLink()) throw new Error('字幕输入已失去外部文件关联，请重新选择')
  const targetPath = await realpath(path)
  const source = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await source.stat()
    if (!before.isFile() || before.size !== expected.sizeBytes) throw new Error('外部字幕输入已发生变化，请重新选择')
    const sha256 = await hashOpenFile(source, before.size)
    const after = await source.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || sha256 !== expected.sha256) {
      throw new Error('外部字幕输入已发生变化，请重新选择')
    }
    return source
  } catch (error) {
    await source.close()
    throw error
  }
}

export async function verifyLinkedFileSnapshot(path: string, expected: Pick<FileReferenceInput, 'sizeBytes' | 'sha256'>): Promise<void> {
  const source = await openVerifiedLinkedFileSnapshot(path, expected)
  await source.close()
}

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '文件导入失败'
}

export async function retainManagedTreeFromPath(userDataPath: string, input: {
  scopeId: string
  sourcePath: string
  sourceBookmark?: string | null
  sourceOrigin?: NonNullable<FileReferenceInput['sourceOrigin']>
  maximumFileBytes?: number
  maximumTreeBytes?: number
  maximumEntries?: number
  maximumDepth?: number
}): Promise<RetainedManagedTree> {
  const sourceInfo = await lstat(input.sourcePath)
  const safeScope = input.scopeId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'unscoped'
  const managedDirectory = join('managed-files', safeScope)
  if (sourceInfo.isSymbolicLink()) throw new Error('不支持导入符号链接')
  if (sourceInfo.isFile()) {
    const retained = await retainManagedFileFromPath(userDataPath, {
      sourcePath: input.sourcePath, managedDirectory, sourceBookmark: input.sourceBookmark,
      sourceOrigin: input.sourceOrigin ?? 'finder_drop', maximumBytes: input.maximumFileBytes
    })
    const entry = { ...retained, importRelativePath: retained.file.originalName, parentFileId: null }
    return { root: entry, entries: [entry], failures: [] }
  }
  if (!sourceInfo.isDirectory()) throw new Error('只能导入普通文件或文件夹')

  const rootName = safeName(input.sourcePath)
  const rootLocator = join(managedDirectory, `${randomUUID()}-${rootName}`)
  const rootDestination = join(userDataPath, rootLocator)
  const sourceAbsolute = resolve(input.sourcePath)
  if (resolve(rootDestination).startsWith(`${sourceAbsolute}${sep}`)) throw new Error('不能把App受管目录作为导入来源')
  const temporaryRoot = `${rootDestination}.partial-${randomUUID()}`
  const failures: ManagedTreeFailure[] = []
  const entries: RetainedManagedTreeEntry[] = []
  const maximumFileBytes = input.maximumFileBytes ?? MAX_MANAGED_FILE_BYTES
  const maximumTreeBytes = input.maximumTreeBytes ?? MAX_MANAGED_TREE_BYTES
  const maximumEntries = input.maximumEntries ?? MAX_MANAGED_TREE_ENTRIES
  const maximumDepth = input.maximumDepth ?? MAX_MANAGED_TREE_DEPTH
  let totalBytes = 0
  let entryCount = 0

  interface TreeStats { bytes: number; hash: string }
  const copyDirectory = async (sourceDirectory: string, destinationDirectory: string, importPath: string, locator: string, parentFileId: string | null, depth: number, sourceBookmark: string | null): Promise<TreeStats> => {
    if (depth > maximumDepth) throw new Error(`文件夹层级不能超过${maximumDepth}层`)
    entryCount += 1
    if (entryCount > maximumEntries) throw new Error(`单次最多导入${maximumEntries}个文件和文件夹`)
    const id = randomUUID()
    await ensurePrivateDirectory(destinationDirectory)
    const entry: RetainedManagedTreeEntry = {
      absolutePath: join(userDataPath, locator), importRelativePath: importPath, parentFileId,
      file: buildFileReference({ id, kind: 'folder', relativePath: locator, originalName: basename(importPath), sizeBytes: 0, sha256: '',
        sourceOrigin: input.sourceOrigin ?? 'finder_drop', sourceBookmark, profile: detectManagedFileProfile(importPath, 'folder') })
    }
    entries.push(entry)
    const childHashes: string[] = []
    let directoryBytes = 0
    const children = await readdir(sourceDirectory, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const child of children) {
      const childImportPath = join(importPath, child.name)
      const childSource = join(sourceDirectory, child.name)
      const childDestination = join(destinationDirectory, child.name)
      const childLocator = join(locator, child.name)
      const entryCountBefore = entryCount
      const totalBytesBefore = totalBytes
      const entriesLengthBefore = entries.length
      const failuresLengthBefore = failures.length
      try {
        const childInfo = await lstat(childSource)
        if (childInfo.isSymbolicLink()) throw new Error('已跳过符号链接')
        if (childInfo.isDirectory()) {
          const stats = await copyDirectory(childSource, childDestination, childImportPath, childLocator, id, depth + 1, null)
          directoryBytes += stats.bytes; childHashes.push(`${child.name}\0${stats.hash}`)
          continue
        }
        if (!childInfo.isFile()) throw new Error('已跳过非普通文件')
        assertFileSize(childInfo.size, maximumFileBytes)
        if (totalBytes + childInfo.size > maximumTreeBytes) throw new Error(`单次导入总大小不能超过${Math.floor(maximumTreeBytes / 1024 / 1024)}MB`)
        entryCount += 1
        if (entryCount > maximumEntries) throw new Error(`单次最多导入${maximumEntries}个文件和文件夹`)
        const source = await open(childSource, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const before = await source.stat()
          if (!before.isFile() || before.size !== childInfo.size || before.ino !== childInfo.ino || before.dev !== childInfo.dev) throw new Error('文件在读取前发生变化，请重试')
          const sha256 = await copyOpenFile(source, childDestination, before.size)
          const after = await source.stat()
          if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('文件在读取过程中发生变化，请重试')
          const childEntry: RetainedManagedTreeEntry = {
            absolutePath: join(userDataPath, childLocator), importRelativePath: childImportPath, parentFileId: id,
            file: buildFileReference({ relativePath: childLocator, originalName: child.name, sizeBytes: before.size, sha256,
              sourceOrigin: input.sourceOrigin ?? 'finder_drop', profile: detectManagedFileProfile(child.name) })
          }
          entries.push(childEntry)
          totalBytes += before.size; directoryBytes += before.size; childHashes.push(`${child.name}\0${sha256}`)
        } finally { await source.close() }
      } catch (error) {
        entryCount = entryCountBefore; totalBytes = totalBytesBefore
        entries.splice(entriesLengthBefore); failures.splice(failuresLengthBefore)
        await removeTreeNoFollow(childDestination).catch(() => undefined)
        failures.push({ relativePath: childImportPath, message: failureMessage(error) })
      }
    }
    const digest = createHash('sha256').update(`folder\0${importPath}\0${childHashes.join('\0')}`).digest('hex')
    entry.file.sha256 = digest; entry.file.sizeBytes = directoryBytes
    return { bytes: directoryBytes, hash: digest }
  }

  try {
    await ensurePrivateDirectory(dirname(rootDestination))
    await copyDirectory(input.sourcePath, temporaryRoot, rootName, rootLocator, null, 0, input.sourceBookmark ?? null)
    await rename(temporaryRoot, rootDestination)
    const root = entries[0]
    if (!root) throw new Error('文件夹导入失败')
    return { root, entries, failures }
  } catch (error) {
    await removeTreeNoFollow(temporaryRoot).catch(() => undefined)
    await removeTreeNoFollow(rootDestination).catch(() => undefined)
    throw error
  }
}

async function removeTreeNoFollow(path: string): Promise<ManagedFileSweepResult> {
  const info = await lstat(path).catch(() => null)
  if (!info) return { removedFiles: 0, removedDirectories: 0 }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    await unlink(path)
    return { removedFiles: 1, removedDirectories: 0 }
  }
  let removedFiles = 0; let removedDirectories = 0
  const children = await readdir(path)
  for (const child of children) {
    const result = await removeTreeNoFollow(join(path, child))
    removedFiles += result.removedFiles; removedDirectories += result.removedDirectories
  }
  await rmdir(path)
  return { removedFiles, removedDirectories: removedDirectories + 1 }
}

export async function discardManagedLocator(userDataPath: string, locator: string): Promise<boolean> {
  let target: ReturnType<typeof safeManagedLocator>
  try { target = safeManagedLocator(userDataPath, locator) } catch { return false }
  const info = await lstat(target.absolutePath).catch(() => null)
  if (!info) return false
  try {
    if (info.isDirectory() && !info.isSymbolicLink()) await rmdir(target.absolutePath)
    else await unlink(target.absolutePath)
    return true
  } catch { return false }
}

export async function discardManagedLocators(userDataPath: string, locators: Iterable<string>): Promise<number> {
  const ordered = [...new Set(locators)].sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length || b.length - a.length)
  let removed = 0
  for (const locator of ordered) if (await discardManagedLocator(userDataPath, locator)) removed += 1
  return removed
}

export async function sweepUnreferencedManagedFiles(userDataPath: string, referencedLocators: Iterable<string>): Promise<ManagedFileSweepResult> {
  const referenced = new Set<string>()
  for (const locator of referencedLocators) {
    try { referenced.add(safeManagedLocator(userDataPath, locator).relativePath) } catch { /* 非受管旧值不参与清理 */ }
  }
  let removedFiles = 0; let removedDirectories = 0
  const walk = async (absolutePath: string, locator: string, isRoot = false): Promise<void> => {
    const info = await lstat(absolutePath).catch(() => null)
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) {
      if (!referenced.has(locator)) { await unlink(absolutePath); removedFiles += 1 }
      return
    }
    if (!isRoot && basename(absolutePath).includes('.partial-') && !referenced.has(locator)) {
      const result = await removeTreeNoFollow(absolutePath)
      removedFiles += result.removedFiles; removedDirectories += result.removedDirectories
      return
    }
    for (const child of await readdir(absolutePath)) await walk(join(absolutePath, child), join(locator, child))
    if (!isRoot && !referenced.has(locator)) {
      try { await rmdir(absolutePath); removedDirectories += 1 } catch { /* 有仍被引用的后代时保留目录 */ }
    }
  }
  for (const root of MANAGED_ROOTS) await walk(join(userDataPath, root), root, true)
  return { removedFiles, removedDirectories }
}

export async function cleanupReleasedManagedFiles(userDataPath: string, releasedLocators: Iterable<string>, referencedLocators: Iterable<string>): Promise<ManagedFileSweepResult> {
  await discardManagedLocators(userDataPath, releasedLocators)
  return sweepUnreferencedManagedFiles(userDataPath, referencedLocators)
}
