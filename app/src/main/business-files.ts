import { basename, extname, join } from 'node:path'
import type { BusinessFileRole, FileReferenceInput } from '../shared/domain'
import { discardManagedLocator, retainManagedFileFromBytes } from './managed-files'

const MAX_BUSINESS_FILE_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'])

function mimeType(extension: string): string {
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/msword'
}

function hasExpectedSignature(extension: string, buffer: Buffer): boolean {
  if (extension === '.pdf') return buffer.subarray(0, Math.min(buffer.length, 1024)).indexOf('%PDF-') >= 0
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (extension === '.webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (extension === '.docx') return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
}

export async function retainBusinessFile(
  userDataPath: string,
  projectId: string,
  role: BusinessFileRole,
  sourceName: string,
  bytes: Uint8Array,
  sourceBookmark: string | null = null
): Promise<FileReferenceInput> {
  const originalName = basename(sourceName).trim()
  const extension = extname(originalName).toLowerCase()
  if (!originalName || !ALLOWED_EXTENSIONS.has(extension)) throw new Error('商务文件只支持PDF、图片或Word文件')
  if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength <= 0 || bytes.byteLength > MAX_BUSINESS_FILE_BYTES) throw new Error('商务文件必须小于25MB')
  const buffer = Buffer.from(bytes)
  if (!hasExpectedSignature(extension, buffer)) throw new Error('商务文件内容与扩展名不符')
  const safeProject = projectId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
  const retained = await retainManagedFileFromBytes(userDataPath, {
    managedDirectory: join('business-files', safeProject, role), sourceName: originalName, maximumBytes: MAX_BUSINESS_FILE_BYTES,
    sourceBookmark,
    sourceOrigin: sourceBookmark ? 'finder_drop' : 'managed_import',
    profile: { mimeType: mimeType(extension), capabilities: extension === '.pdf' || extension === '.doc' || extension === '.docx' ? ['preview', 'parse'] : ['preview', 'ocr'], processState: 'ready' }
  }, buffer)
  return retained.file
}

export async function discardBusinessFile(userDataPath: string, relativePath: string): Promise<void> {
  await discardManagedLocator(userDataPath, relativePath)
}
