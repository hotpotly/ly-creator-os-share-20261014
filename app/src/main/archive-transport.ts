import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import { link, lstat, mkdir, open, readFile, realpath, readdir, rm, rmdir, statfs, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { addAbortSignal, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ArchiveAvailability {
  available: boolean
  writable: boolean
  freeBytes: number | null
  reason: 'ready' | 'not_mounted' | 'not_directory' | 'not_writable' | 'insufficient_space' | 'unavailable'
}

export interface ArchiveEntry {
  kind: 'file' | 'directory'
  size: number
  modifiedAt: string
}

export interface ArchiveCopyInput {
  sourcePath: string
  destinationRelativePath: string
}

export interface ArchiveCopyReceipt {
  relativePath: string
  bytesCopied: number
  sourceChecksum: string
  startedAt: string
  completedAt: string
}

export interface ArchiveCommitReceipt {
  relativePath: string
  temporaryRemoved: boolean
}

export interface ArchiveTransport {
  inspectAvailability(): Promise<ArchiveAvailability>
  listDirectories(relativePath: string): Promise<string[]>
  claimDirectory(relativePath: string, ownerId: string): Promise<boolean>
  releaseEmptyClaim(relativePath: string, ownerId: string): Promise<void>
  stat(relativePath: string): Promise<ArchiveEntry | null>
  copyFromLocal(input: ArchiveCopyInput, signal: AbortSignal, onProgress: (copiedBytes: number, totalBytes: number) => void): Promise<ArchiveCopyReceipt>
  checksum(relativePath: string, signal?: AbortSignal): Promise<string>
  commitNoReplace(fromRelativePath: string, preferredRelativePath: string): Promise<ArchiveCommitReceipt>
  remove(relativePath: string, recursive?: boolean): Promise<void>
}

export interface ArchiveTransportValidationReport {
  validationId: string
  availability: ArchiveAvailability
  smallFile: { bytes: number; checksumMatched: boolean; renamed: boolean }
  largeFile: { bytes: number; checksumMatched: boolean; renamed: boolean }
  interruption: { aborted: boolean; partialRemoved: boolean }
  noOverwrite: { collisionVersioned: boolean; originalPreserved: boolean }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function safeRelativePath(value: string, allowRoot = false): string {
  const trimmed = value.trim()
  if ((!trimmed && !allowRoot) || trimmed.includes('\0') || trimmed.includes('\\') || isAbsolute(trimmed)) {
    throw new Error('NAS相对路径无效')
  }
  if (!trimmed && allowRoot) return ''
  const segments = trimmed.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('NAS相对路径不能包含空段或越级')
  return segments.join('/')
}

function assertContained(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate)
  if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) return
  throw new Error('NAS路径越过已选择的归档目录')
}

async function sha256LocalFile(path: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  if (signal) addAbortSignal(signal, stream)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  if (signal?.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
  return hash.digest('hex')
}

export class MountedDirectoryArchiveTransport implements ArchiveTransport {
  private constructor(
    private readonly configuredRoot: string,
    private readonly canonicalRoot: string,
    private readonly rootFingerprint: { dev: string; ino: string; fsType: string }
  ) {}

  static async create(rootPath: string): Promise<MountedDirectoryArchiveTransport> {
    if (!isAbsolute(rootPath)) throw new Error('NAS归档目录必须是绝对路径')
    const canonicalRoot = await realpath(rootPath)
    const metadata = await lstat(canonicalRoot)
    if (!metadata.isDirectory()) throw new Error('NAS归档位置不是目录')
    const capacity = await statfs(canonicalRoot)
    return new MountedDirectoryArchiveTransport(resolve(rootPath), canonicalRoot, {
      dev: String(metadata.dev),
      ino: String(metadata.ino),
      fsType: String(capacity.type)
    })
  }

  private candidate(relativePath: string, allowRoot = false): string {
    const safe = safeRelativePath(relativePath, allowRoot)
    const candidate = safe ? resolve(this.canonicalRoot, safe) : this.canonicalRoot
    assertContained(this.canonicalRoot, candidate)
    return candidate
  }

  private async assertRootIdentity(): Promise<void> {
    try {
      const canonicalNow = await realpath(this.configuredRoot)
      const metadata = await lstat(canonicalNow)
      const capacity = await statfs(canonicalNow)
      if (
        canonicalNow !== this.canonicalRoot
        || !metadata.isDirectory()
        || String(metadata.dev) !== this.rootFingerprint.dev
        || String(metadata.ino) !== this.rootFingerprint.ino
        || String(capacity.type) !== this.rootFingerprint.fsType
      ) throw new Error('NAS挂载身份已经变化，请重新选择归档目录')
    } catch (error) {
      if (isMissing(error)) throw new Error('NAS归档目录当前未挂载')
      throw error
    }
  }

  private async ensureSafeParent(relativePath: string): Promise<string> {
    const safe = safeRelativePath(relativePath)
    const segments = safe.split('/')
    const fileName = segments.pop()!
    let current = this.canonicalRoot
    for (const segment of segments) {
      const next = join(current, segment)
      try {
        const metadata = await lstat(next)
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('NAS归档父路径必须是普通目录')
      } catch (error) {
        if (!isMissing(error)) throw error
        try { await mkdir(next, { mode: 0o700 }) }
        catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
        }
        const created = await lstat(next)
        if (created.isSymbolicLink() || !created.isDirectory()) throw new Error('NAS归档父路径必须是普通目录')
      }
      const canonicalNext = await realpath(next)
      assertContained(this.canonicalRoot, canonicalNext)
      if (canonicalNext !== next) throw new Error('NAS归档不跟随符号链接')
      current = canonicalNext
    }
    return join(current, fileName)
  }

  private async safeExisting(relativePath: string): Promise<{ path: string; metadata: Awaited<ReturnType<typeof lstat>> }> {
    const candidate = this.candidate(relativePath)
    const canonical = await realpath(candidate)
    assertContained(this.canonicalRoot, canonical)
    if (canonical !== candidate) throw new Error('NAS归档不跟随符号链接')
    const metadata = await lstat(canonical)
    if (metadata.isSymbolicLink()) throw new Error('NAS归档不跟随符号链接')
    return { path: canonical, metadata }
  }

  async inspectAvailability(): Promise<ArchiveAvailability> {
    try {
      await this.assertRootIdentity()
      const capacity = await statfs(this.canonicalRoot)
      const freeBytes = Number(capacity.bavail) * Number(capacity.bsize)
      if (freeBytes <= 0) return { available: true, writable: false, freeBytes, reason: 'insufficient_space' }
      const canaryPath = join(this.canonicalRoot, `.creator-os-write-canary-${randomUUID()}`)
      try {
        const canary = await open(canaryPath, 'wx', 0o600)
        try { await canary.write('ok'); await canary.sync() } finally { await canary.close() }
        await unlink(canaryPath)
      } catch {
        await rm(canaryPath, { force: true }).catch(() => undefined)
        return { available: true, writable: false, freeBytes, reason: 'not_writable' }
      }
      return {
        available: true,
        writable: true,
        freeBytes,
        reason: 'ready'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      return { available: false, writable: false, freeBytes: null, reason: message.includes('未挂载') ? 'not_mounted' : 'unavailable' }
    }
  }

  async listDirectories(relativePath: string): Promise<string[]> {
    await this.assertRootIdentity()
    const candidate = this.candidate(relativePath, true)
    const canonical = await realpath(candidate)
    assertContained(this.canonicalRoot, canonical)
    if (canonical !== candidate) throw new Error('NAS归档不跟随符号链接')
    const entries = await readdir(canonical, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name).sort()
  }

  async claimDirectory(relativePath: string, ownerId: string): Promise<boolean> {
    await this.assertRootIdentity()
    if (!/^[\p{L}\p{N}._:-]{1,160}$/u.test(ownerId)) throw new Error('NAS归档目录所有者标识无效')
    const safe = safeRelativePath(relativePath)
    const segments = safe.split('/')
    const leaf = segments.pop()!
    const parentRelative = segments.join('/')
    const parentProbe = parentRelative ? `${parentRelative}/.creator-os-parent-probe` : '.creator-os-parent-probe'
    const parent = dirname(await this.ensureSafeParent(parentProbe))
    const directory = join(parent, leaf)
    const marker = join(directory, '.creator-os-archive-owner')
    try {
      await mkdir(directory, { mode: 0o700 })
      try { await writeFile(marker, ownerId, { mode: 0o600, flag: 'wx' }) }
      catch (error) {
        await rmdir(directory).catch(() => undefined)
        throw error
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.safeExisting(`${safe}/.creator-os-archive-owner`).catch(() => null)
      if (!existing || !existing.metadata.isFile() || (await readFile(existing.path, 'utf8')) !== ownerId) throw new Error('DESTINATION_EXISTS')
      return false
    }
  }

  async releaseEmptyClaim(relativePath: string, ownerId: string): Promise<void> {
    await this.assertRootIdentity()
    if (!/^[\p{L}\p{N}._:-]{1,160}$/u.test(ownerId)) throw new Error('NAS归档目录所有者标识无效')
    const safe = safeRelativePath(relativePath)
    const directory = await this.safeExisting(safe)
    if (!directory.metadata.isDirectory()) throw new Error('NAS归档claim不是目录')
    const marker = await this.safeExisting(`${safe}/.creator-os-archive-owner`)
    if (!marker.metadata.isFile() || await readFile(marker.path, 'utf8') !== ownerId) throw new Error('NAS归档claim所有者不匹配')
    const entries = await readdir(directory.path)
    if (entries.length !== 1 || entries[0] !== '.creator-os-archive-owner') throw new Error('NAS归档claim目录已非空，未执行删除')
    await unlink(marker.path)
    try {
      await rmdir(directory.path)
    } catch (error) {
      await writeFile(marker.path, ownerId, { mode: 0o600, flag: 'wx' }).catch(() => undefined)
      throw error
    }
  }

  async stat(relativePath: string): Promise<ArchiveEntry | null> {
    try {
      await this.assertRootIdentity()
      const { metadata } = await this.safeExisting(relativePath)
      if (!metadata.isFile() && !metadata.isDirectory()) throw new Error('NAS归档只接受普通文件或目录')
      return {
        kind: metadata.isDirectory() ? 'directory' : 'file',
        size: Number(metadata.size),
        modifiedAt: metadata.mtime.toISOString()
      }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async copyFromLocal(input: ArchiveCopyInput, signal: AbortSignal, onProgress: (copiedBytes: number, totalBytes: number) => void): Promise<ArchiveCopyReceipt> {
    await this.assertRootIdentity()
    if (!isAbsolute(input.sourcePath)) throw new Error('归档源文件必须是Main进程解析的绝对路径')
    const configuredSource = await lstat(input.sourcePath)
    if (configuredSource.isSymbolicLink()) throw new Error('归档源文件不能是符号链接')
    const sourcePath = await realpath(input.sourcePath)
    const target = await this.ensureSafeParent(input.destinationRelativePath)
    const sourceHandle = await open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    let targetHandle: Awaited<ReturnType<typeof open>> | null = null
    try {
      const sourceBefore = await sourceHandle.stat()
      if (!sourceBefore.isFile()) throw new Error('归档源不是普通文件')
      const startedAt = new Date().toISOString()
      let copiedBytes = 0
      const sourceHash = createHash('sha256')
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          copiedBytes += chunk.length
          sourceHash.update(chunk)
          onProgress(copiedBytes, Number(sourceBefore.size))
          callback(null, chunk)
        }
      })
      targetHandle = await open(target, 'wx', 0o600)
      await pipeline(
        createReadStream(sourcePath, { fd: sourceHandle.fd, autoClose: false }),
        progress,
        createWriteStream(target, { fd: targetHandle.fd, autoClose: false }),
        { signal }
      )
      await targetHandle.sync()
      const sourceAfter = await sourceHandle.stat()
      if (
        sourceAfter.dev !== sourceBefore.dev
        || sourceAfter.ino !== sourceBefore.ino
        || sourceAfter.size !== sourceBefore.size
        || sourceAfter.mtimeMs !== sourceBefore.mtimeMs
      ) throw new Error('归档源文件在复制过程中发生变化')
      return {
        relativePath: input.destinationRelativePath,
        bytesCopied: copiedBytes,
        sourceChecksum: sourceHash.digest('hex'),
        startedAt,
        completedAt: new Date().toISOString()
      }
    } catch (error) {
      await targetHandle?.close().catch(() => undefined)
      targetHandle = null
      await sourceHandle.close().catch(() => undefined)
      await rm(target, { force: true }).catch(() => undefined)
      throw error
    } finally {
      await targetHandle?.close().catch(() => undefined)
      await sourceHandle.close().catch(() => undefined)
    }
  }

  async checksum(relativePath: string, signal?: AbortSignal): Promise<string> {
    await this.assertRootIdentity()
    const { path: candidate, metadata } = await this.safeExisting(relativePath)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('只能校验普通NAS文件')
    return sha256LocalFile(candidate, signal)
  }

  async commitNoReplace(fromRelativePath: string, preferredRelativePath: string): Promise<ArchiveCommitReceipt> {
    await this.assertRootIdentity()
    const { path: from, metadata: source } = await this.safeExisting(fromRelativePath)
    if (!source.isFile() || source.isSymbolicLink()) throw new Error('只能提交普通NAS临时文件')
    const preferred = safeRelativePath(preferredRelativePath)
    if (dirname(fromRelativePath) !== dirname(preferred)) throw new Error('NAS临时文件与正式文件必须在同一目录')
    const extension = extname(preferred)
    const stem = extension ? preferred.slice(0, -extension.length) : preferred
    for (let version = 1; version <= 9_999; version += 1) {
      const relativeTarget = version === 1 ? preferred : `${stem} v${version}${extension}`
      const target = await this.ensureSafeParent(relativeTarget)
      try {
        await link(from, target)
        const [sourceNow, targetNow] = await Promise.all([lstat(from), lstat(target)])
        if (
          String(sourceNow.dev) !== String(source.dev)
          || String(sourceNow.ino) !== String(source.ino)
          || String(targetNow.dev) !== String(source.dev)
          || String(targetNow.ino) !== String(source.ino)
        ) {
          await unlink(target).catch(() => undefined)
          throw new Error('NAS临时文件在提交过程中被替换')
        }
        let temporaryRemoved = true
        try { await unlink(from) } catch { temporaryRemoved = false }
        return { relativePath: relativeTarget, temporaryRemoved }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        if (['ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new Error('当前挂载目录不支持安全的不覆盖提交，请完成NAS实机验证')
        }
        throw error
      }
    }
    throw new Error('同名NAS文件版本过多，无法分配新名称')
  }

  async remove(relativePath: string, recursive = false): Promise<void> {
    await this.assertRootIdentity()
    const existing = await this.safeExisting(relativePath).catch((error: unknown) => {
      if (isMissing(error)) return null
      throw error
    })
    if (!existing) return
    await rm(existing.path, { recursive, force: true })
  }
}

async function createPatternFile(path: string, bytes: number): Promise<void> {
  const block = Buffer.alloc(Math.min(bytes, 1024 * 1024), 0x5a)
  const handle = await open(path, 'wx', 0o600)
  try {
    let written = 0
    while (written < bytes) {
      const length = Math.min(block.length, bytes - written)
      await handle.write(block, 0, length)
      written += length
    }
  } finally {
    await handle.close()
  }
}

export async function validateArchiveTransport(
  transport: ArchiveTransport,
  fixtureDirectory: string,
  options: { largeFileBytes?: number } = {}
): Promise<ArchiveTransportValidationReport> {
  const validationId = randomUUID()
  const prefix = `.creator-os-validation/${validationId}`
  const largeFileBytes = options.largeFileBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(largeFileBytes) || largeFileBytes < 2 * 1024 * 1024) throw new Error('NAS大文件验证至少需要2MB')
  await mkdir(fixtureDirectory, { recursive: true })
  const smallSource = join(fixtureDirectory, `${validationId}-small.txt`)
  const largeSource = join(fixtureDirectory, `${validationId}-large.bin`)
  try {
    await writeFile(smallSource, 'LY Creator OS NAS transport validation\n', { flag: 'wx', mode: 0o600 })
    await createPatternFile(largeSource, largeFileBytes)
    const availability = await transport.inspectAvailability()
    if (!availability.available || !availability.writable) throw new Error('NAS目录当前不可写，不能开始技术验证')
    const smallTemp = `${prefix}/small.partial`
    const smallFinal = `${prefix}/small.txt`
    const smallReceipt = await transport.copyFromLocal({ sourcePath: smallSource, destinationRelativePath: smallTemp }, new AbortController().signal, () => undefined)
    const smallSourceHash = await sha256LocalFile(smallSource)
    const smallTargetHash = await transport.checksum(smallTemp)
    const committedSmall = await transport.commitNoReplace(smallTemp, smallFinal)

    const interruptedPath = `${prefix}/interrupted.partial`
    const abortController = new AbortController()
    let abortIssued = false
    let abortObserved = false
    try {
      await transport.copyFromLocal({ sourcePath: largeSource, destinationRelativePath: interruptedPath }, abortController.signal, (copiedBytes) => {
        if (!abortIssued && copiedBytes >= 1024 * 1024) {
          abortIssued = true
          abortController.abort()
        }
      })
    } catch (error) {
      abortObserved = abortController.signal.aborted
        && ((error as Error).name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')
    }
    const interruptedEntry = await transport.stat(interruptedPath)

    const largeTemp = interruptedPath
    const largeFinal = `${prefix}/large.bin`
    const largeReceipt = await transport.copyFromLocal({ sourcePath: largeSource, destinationRelativePath: largeTemp }, new AbortController().signal, () => undefined)
    const largeSourceHash = await sha256LocalFile(largeSource)
    const largeTargetHash = await transport.checksum(largeTemp)
    const committedLarge = await transport.commitNoReplace(largeTemp, largeFinal)

    const collisionTemp = `${prefix}/collision.partial`
    await transport.copyFromLocal({ sourcePath: smallSource, destinationRelativePath: collisionTemp }, new AbortController().signal, () => undefined)
    const originalHash = await transport.checksum(smallFinal)
    const collisionCommitted = await transport.commitNoReplace(collisionTemp, smallFinal)
    const preservedHash = await transport.checksum(smallFinal)

    return {
      validationId,
      availability,
      smallFile: { bytes: smallReceipt.bytesCopied, checksumMatched: smallReceipt.sourceChecksum === smallSourceHash && smallSourceHash === smallTargetHash, renamed: committedSmall.relativePath === smallFinal && committedSmall.temporaryRemoved && Boolean(await transport.stat(smallFinal)) },
      largeFile: { bytes: largeReceipt.bytesCopied, checksumMatched: largeReceipt.sourceChecksum === largeSourceHash && largeSourceHash === largeTargetHash, renamed: committedLarge.relativePath === largeFinal && committedLarge.temporaryRemoved && Boolean(await transport.stat(largeFinal)) },
      interruption: { aborted: abortIssued && abortObserved, partialRemoved: interruptedEntry === null },
      noOverwrite: { collisionVersioned: collisionCommitted.relativePath !== smallFinal, originalPreserved: originalHash === preservedHash }
    }
  } finally {
    await transport.remove(prefix, true).catch(() => undefined)
    await rm(smallSource, { force: true }).catch(() => undefined)
    await rm(largeSource, { force: true }).catch(() => undefined)
  }
}
