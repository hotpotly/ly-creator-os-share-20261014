import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { FileReferenceInput } from '../shared/domain'
import { assertDeclaredSafeDocxArchive } from './docx-archive-safety'
import { parseDocxInUtilityProcess } from './docx-parser-client'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORTED_TEXT_LENGTH = 1_000_000

export interface RetainedImport {
  absolutePath: string
  file: FileReferenceInput
  extension: '.md' | '.markdown' | '.txt' | '.text' | '.docx'
  sourceStat?: { mtimeMs: number; sizeBytes: number }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function supportedExtension(name: string): RetainedImport['extension'] {
  const extension = extname(name).toLowerCase()
  if (extension !== '.md' && extension !== '.markdown' && extension !== '.txt' && extension !== '.text' && extension !== '.docx') throw new Error('只支持Markdown、纯文本或Word .docx文件')
  return extension
}

function assertSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('导入文件为空或大小无效')
  if (size > MAX_IMPORT_BYTES) throw new Error('导入文件不能超过10MB')
}

async function buildRetainedImport(userDataPath: string, projectId: string, sourceName: string, write: (destination: string) => Promise<void>): Promise<RetainedImport> {
  const originalName = basename(sourceName)
  const extension = supportedExtension(originalName)
  const safeProject = projectId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
  const relativePath = join('imports', safeProject, `${randomUUID()}-${originalName}`)
  const absolutePath = join(userDataPath, relativePath)
  const temporaryPath = `${absolutePath}.partial-${randomUUID()}`
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 }); await chmod(dirname(absolutePath), 0o700)
  try {
    await write(temporaryPath); await chmod(temporaryPath, 0o600)
    const retainedInfo = await stat(temporaryPath); assertSize(retainedInfo.size)
    const sha256 = await hashFile(temporaryPath)
    await rename(temporaryPath, absolutePath)
    return {
      absolutePath,
      extension,
      file: {
        id: randomUUID(), relativePath, originalName, sizeBytes: retainedInfo.size, sha256,
        mimeType: extension === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : extension === '.txt' || extension === '.text' ? 'text/plain' : 'text/markdown',
        createdAt: new Date().toISOString()
      }
    }
  } catch (error) {
    await Promise.all([unlink(temporaryPath).catch(() => undefined), unlink(absolutePath).catch(() => undefined)])
    throw error
  }
}

export async function retainImportFromPath(userDataPath: string, projectId: string, sourcePath: string): Promise<RetainedImport> {
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  let retained: RetainedImport | null = null
  try {
    const before = await source.stat()
    if (!before.isFile()) throw new Error('只能导入普通文件')
    assertSize(before.size); supportedExtension(sourcePath)
    retained = await buildRetainedImport(userDataPath, projectId, sourcePath, async (destination) => {
      const output = await open(destination, 'wx', 0o600)
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024)
        let position = 0
        while (position < before.size) {
          const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, before.size - position), position)
          if (bytesRead === 0) throw new Error('外部文件在读取过程中提前结束')
          let bytesWritten = 0
          while (bytesWritten < bytesRead) {
            const result = await output.write(buffer, bytesWritten, bytesRead - bytesWritten, position + bytesWritten)
            if (result.bytesWritten === 0) throw new Error('外部文件副本写入中断')
            bytesWritten += result.bytesWritten
          }
          position += bytesRead
        }
        await output.sync()
      } finally { await output.close() }
    })
    const after = await source.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      await discardRetainedImport(retained); retained = null
      throw new Error('外部文件在读取过程中发生变化，请重试')
    }
    retained.sourceStat = { mtimeMs: after.mtimeMs, sizeBytes: after.size }
    return retained
  } catch (error) {
    if (retained) await discardRetainedImport(retained)
    throw error
  } finally { await source.close() }
}

export async function retainImportFromBytes(userDataPath: string, projectId: string, sourceName: string, bytes: Uint8Array): Promise<RetainedImport> {
  assertSize(bytes.byteLength); supportedExtension(sourceName)
  return buildRetainedImport(userDataPath, projectId, sourceName, async (destination) => writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }))
}

export async function parseRetainedImport(retained: RetainedImport): Promise<string> {
  if (retained.extension === '.docx') {
    const buffer = await readFile(retained.absolutePath); assertDeclaredSafeDocxArchive(buffer)
    return parseDocxInUtilityProcess(retained.absolutePath)
  }
  const content = await readFile(retained.absolutePath, 'utf8')
  if (content.length > MAX_IMPORTED_TEXT_LENGTH) throw new Error('导入文案正文不能超过100万字')
  return content
}

export async function discardRetainedImport(retained: RetainedImport): Promise<void> {
  await unlink(retained.absolutePath).catch(() => undefined)
}
