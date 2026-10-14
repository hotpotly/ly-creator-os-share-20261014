import { open, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { FileReferenceInput } from '../shared/domain'
import { discardManagedLocator, retainManagedFileFromBytes, retainManagedFileFromPath } from './managed-files'
import { parsePdfInUtilityProcess, type ParsedPdf } from './pdf-parser-client'

export const MAX_PROJECT_PDF_BYTES = 10 * 1024 * 1024

export interface RetainedProjectPdf {
  absolutePath: string
  file: FileReferenceInput
}

function assertPdfInput(name: string, bytes: Uint8Array): void {
  if (extname(name).toLowerCase() !== '.pdf') throw new Error('只支持PDF文件')
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PROJECT_PDF_BYTES) throw new Error('PDF文件必须小于10MB')
  if (Buffer.from(bytes).subarray(0, Math.min(bytes.byteLength, 1024)).indexOf('%PDF-') < 0) throw new Error('所选文件不是有效PDF')
}

export async function retainProjectPdfFromBytes(userDataPath: string, projectId: string, sourceName: string, bytes: Uint8Array): Promise<RetainedProjectPdf> {
  assertPdfInput(sourceName, bytes)
  const originalName = basename(sourceName)
  const safeProject = projectId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
  return retainManagedFileFromBytes(userDataPath, {
    managedDirectory: join('project-materials', safeProject), sourceName: originalName, maximumBytes: MAX_PROJECT_PDF_BYTES,
    profile: { mimeType: 'application/pdf', capabilities: ['preview', 'parse'], processState: 'ready' }
  }, bytes)
}

export async function retainProjectPdfFromPath(userDataPath: string, projectId: string, sourcePath: string, encryptedSourcePath: string | null): Promise<RetainedProjectPdf> {
  if (extname(sourcePath).toLowerCase() !== '.pdf') throw new Error('只支持PDF文件')
  const safeProject = projectId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
  const retained = await retainManagedFileFromPath(userDataPath, {
    sourcePath, managedDirectory: join('project-materials', safeProject), maximumBytes: MAX_PROJECT_PDF_BYTES,
    sourceBookmark: encryptedSourcePath, sourceOrigin: 'file_picker',
    profile: { mimeType: 'application/pdf', capabilities: ['preview', 'parse'], processState: 'ready' }
  })
  try {
    const copy = await open(retained.absolutePath, 'r')
    try {
      const signature = Buffer.alloc(Math.min(retained.file.sizeBytes, 1024))
      await copy.read(signature, 0, signature.length, 0)
      if (signature.indexOf('%PDF-') < 0) throw new Error('所选文件不是有效PDF')
    } finally { await copy.close() }
    retained.file.encryptedSourcePath = encryptedSourcePath
    return retained
  } catch (error) {
    await unlink(retained.absolutePath).catch(() => undefined)
    throw error
  }
}

export async function parseRetainedProjectPdf(retained: RetainedProjectPdf): Promise<ParsedPdf> {
  return parsePdfInUtilityProcess(retained.absolutePath)
}

export async function discardRetainedProjectPdf(retained: RetainedProjectPdf): Promise<void> {
  await unlink(retained.absolutePath).catch(() => undefined)
}

export async function discardProjectMaterialFile(userDataPath: string, relativePath: string): Promise<void> {
  await discardManagedLocator(userDataPath, relativePath)
}
