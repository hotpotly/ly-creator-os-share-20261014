import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, sep } from 'node:path'
import { z } from 'zod'
import type { WorkspaceStore } from './db'
import { PersonalReviewRepository } from './db/personal-review-repository'
import { assertTrustedSender } from './security'
import { discardManagedLocator, resolveManagedFilePath, retainManagedFileFromBytes, type RetainedManagedFile } from './managed-files'
import { REVIEW_CHANNELS, reviewEntrySaveSchema, reviewFileQuerySchema, reviewPeriodSchema, reviewQuerySchema } from '../shared/personal-review'
const maximumBytes = 20 * 1024 * 1024
function imageMime(bytes: Buffer, name: string): string {
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null
  if (!mime || nativeImage.createFromBuffer(bytes).isEmpty()) throw new Error(`${name}无法读取。请使用PNG、JPEG或WebP图片。`)
  return mime
}
export function registerPersonalReviewIpc(store: WorkspaceStore, notify: () => void): void {
  const repository = new PersonalReviewRepository(store.repository)
  const root = dirname(store.databasePath)
  const handle = (channel: string, action: (payload: unknown, event: Electron.IpcMainInvokeEvent) => unknown): void => {
    ipcMain.handle(channel, (event, payload: unknown) => { assertTrustedSender(event, ['main']); return action(payload, event) })
  }
  handle(REVIEW_CHANNELS.get, payload => repository.get(reviewQuerySchema.parse(payload)))
  handle(REVIEW_CHANNELS.save, payload => { const result = repository.save(reviewPeriodSchema.parse(payload)); notify(); return result })
  handle(REVIEW_CHANNELS.entrySave, payload => { const result = repository.saveEntry(reviewEntrySaveSchema.parse(payload)); notify(); return result })
  handle(REVIEW_CHANNELS.entryGet, payload => repository.entry(z.string().uuid().parse(payload)))
  handle(REVIEW_CHANNELS.search, payload => repository.search(z.string().max(120).parse(payload)))
  handle(REVIEW_CHANNELS.detach, payload => { const { entryId, fileId } = reviewFileQuerySchema.parse(payload); const result = repository.detach(entryId, fileId); notify(); return result })
  handle(REVIEW_CHANNELS.preview, async payload => {
    const { entryId, fileId } = reviewFileQuerySchema.parse(payload), file = repository.file(entryId, fileId)
    const path = resolveManagedFilePath(root, file.managedLocator ?? file.relativePath)
    const actual = await realpath(path), actualRoot = await realpath(root)
    if (!actual.startsWith(actualRoot + sep) || (await stat(actual)).size > maximumBytes) throw new Error('图片位置或大小无效')
    const image = nativeImage.createFromBuffer(await readFile(actual))
    if (image.isEmpty()) throw new Error('无法预览图片，原图仍保留在备份中')
    const size = image.getSize()
    return (Math.max(size.width, size.height) > 2000 ? image.resize(size.width >= size.height ? { width: 2000 } : { height: 2000 }) : image).toDataURL()
  })
  handle(REVIEW_CHANNELS.importImages, async payload => {
    const { entry, images } = z.object({ entry: reviewEntrySaveSchema, images: z.array(z.object({ name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array).refine(b => b.byteLength > 0 && b.byteLength <= maximumBytes, '图片不得超过20MB') }).strict()).min(1).max(20) }).strict().parse(payload)
    if (entry.trashed) throw new Error('请先恢复记录')
    const retained: RetainedManagedFile[] = []
    try {
      for (const image of images) {
        const bytes = Buffer.from(image.bytes), name = basename(image.name), mime = imageMime(bytes, name)
        retained.push(await retainManagedFileFromBytes(root, { managedDirectory: 'managed-files/reviews', sourceName: name, maximumBytes, sourceOrigin: 'managed_import', profile: { mimeType: mime, capabilities: ['preview'], processState: 'ready' } }, bytes))
      }
      const result = repository.saveEntryWithFiles(entry, retained.map(item => item.file)); notify(); return result
    } catch (error) {
      await Promise.all(retained.map(item => discardManagedLocator(root, item.file.managedLocator ?? item.file.relativePath)))
      throw error
    }
  })
  handle(REVIEW_CHANNELS.attach, async (payload, event) => {
    const id = z.string().uuid().parse(payload), entry = repository.entry(id)
    if (entry.trashed) throw new Error('请先恢复记录')
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('主窗口不可用')
    const selection = await dialog.showOpenDialog(owner, { title: '添加生活照片或打卡截图', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片（单张不超过20MB）', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (selection.canceled) return entry
    if (selection.filePaths.length + entry.attachments.length > 20) throw new Error('每条记录最多20张图片')
    const retained: RetainedManagedFile[] = []
    try {
      for (const path of selection.filePaths) {
        const info = await stat(path)
        if (!info.isFile() || info.size <= 0 || info.size > maximumBytes) throw new Error(`${basename(path)}不是有效图片或超过20MB`)
        const bytes = await readFile(path)
        if (bytes.length > maximumBytes) throw new Error('图片读取时大小已变化，超过20MB')
        const mime = imageMime(bytes, basename(path))
        retained.push(await retainManagedFileFromBytes(root, { managedDirectory: 'managed-files/reviews', sourceName: basename(path), maximumBytes, sourceOrigin: 'file_picker', profile: { mimeType: mime, capabilities: ['preview'], processState: 'ready' } }, bytes))
      }
      const result = repository.attach(id, retained.map(item => item.file)); notify(); return result
    } catch (error) {
      await Promise.all(retained.map(item => discardManagedLocator(root, item.file.managedLocator ?? item.file.relativePath)))
      throw error
    }
  })
}
