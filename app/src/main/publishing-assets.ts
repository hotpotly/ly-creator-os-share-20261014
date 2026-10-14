import { basename, extname, join } from 'node:path'
import type { FileReferenceInput, PublishingMaterialKind } from '../shared/domain'
import { discardManagedLocator, retainManagedFileFromBytes } from './managed-files'

const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass'])
const MAX_COVER_BYTES = 20 * 1024 * 1024
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024

function assetMimeType(extension: string): string {
  return extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.vtt' ? 'text/vtt' : extension === '.srt' ? 'application/x-subrip' : extension === '.ass' ? 'text/x-ssa' : 'image/jpeg'
}

function hasExpectedImageSignature(extension: string, buffer: Buffer): boolean {
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
}

export async function retainPublishingAsset(userDataPath: string, projectId: string, materialKind: Extract<PublishingMaterialKind, 'cover' | 'subtitle'>, sourceName: string, bytes: Uint8Array): Promise<FileReferenceInput> {
  const originalName = basename(sourceName).trim()
  const extension = extname(originalName).toLowerCase()
  const allowed = materialKind === 'cover' ? COVER_EXTENSIONS : SUBTITLE_EXTENSIONS
  const maximum = materialKind === 'cover' ? MAX_COVER_BYTES : MAX_SUBTITLE_BYTES
  if (!originalName || !allowed.has(extension)) throw new Error(materialKind === 'cover' ? '封面只支持PNG、JPG或WebP图片' : '字幕只支持SRT、VTT或ASS文件')
  if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength <= 0 || bytes.byteLength > maximum) throw new Error(materialKind === 'cover' ? '封面文件必须小于20MB' : '字幕文件必须小于2MB')
  const buffer = Buffer.from(bytes)
  if (materialKind === 'cover' && !hasExpectedImageSignature(extension, buffer)) throw new Error('封面文件内容与PNG、JPG或WebP格式不符')
  if (materialKind === 'subtitle' && buffer.toString('utf8').includes('\ufffd')) throw new Error('字幕文件不是有效的UTF-8文本')

  const safeProject = projectId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
  const retained = await retainManagedFileFromBytes(userDataPath, {
    managedDirectory: join('publishing-assets', safeProject), sourceName: originalName, maximumBytes: maximum,
    profile: { mimeType: assetMimeType(extension), capabilities: materialKind === 'cover' ? ['preview', 'ocr'] : ['preview', 'parse'], processState: 'ready' }
  }, buffer)
  return retained.file
}

export async function discardPublishingAsset(userDataPath: string, relativePath: string): Promise<void> {
  await discardManagedLocator(userDataPath, relativePath)
}
