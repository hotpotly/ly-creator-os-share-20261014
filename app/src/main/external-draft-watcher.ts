import { watch, type FSWatcher } from 'chokidar'
import { extname, dirname } from 'node:path'
import type { WorkspaceStore } from './db'
import { discardRetainedImport, parseRetainedImport, retainImportFromPath, type RetainedImport } from './imported-files'

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.docx'])
const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export class ExternalDraftWatcher {
  private watcher: FSWatcher | null = null
  private watchedPaths = new Set<string>()
  private pendingByPath = new Map<string, Promise<void>>()

  constructor(private readonly store: WorkspaceStore, private readonly onChanged: () => void) {}

  async start(): Promise<void> { await this.sync() }

  async sync(): Promise<void> {
    const sources = this.store.repository.listExternalFileSources().filter((item) => item.status !== 'paused')
    const nextPaths = new Set(sources.map((item) => item.sourcePath))
    if (!this.watcher) {
      this.watcher = watch([...nextPaths], {
        persistent: true, ignoreInitial: true, atomic: true,
        awaitWriteFinish: { stabilityThreshold: 1400, pollInterval: 100 }
      })
      this.watcher.on('change', (path) => this.enqueue(path))
      this.watcher.on('add', (path) => this.enqueue(path))
      this.watcher.on('unlink', (path) => this.handleMissing(path))
      this.watcher.on('error', (error) => console.error('外部文案监听失败', error))
    } else {
      const removed = [...this.watchedPaths].filter((path) => !nextPaths.has(path))
      const added = [...nextPaths].filter((path) => !this.watchedPaths.has(path))
      if (removed.length) await this.watcher.unwatch(removed)
      if (added.length) this.watcher.add(added)
    }
    this.watchedPaths = nextPaths
  }

  async close(): Promise<void> {
    const watcher = this.watcher
    this.watcher = null; this.watchedPaths.clear()
    await watcher?.close()
    await Promise.allSettled([...this.pendingByPath.values()])
    this.pendingByPath.clear()
  }

  private enqueue(sourcePath: string): void {
    const previous = this.pendingByPath.get(sourcePath) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(() => this.handleChange(sourcePath)).finally(() => {
      if (this.pendingByPath.get(sourcePath) === pending) this.pendingByPath.delete(sourcePath)
    })
    this.pendingByPath.set(sourcePath, pending)
  }

  private handleMissing(sourcePath: string): void {
    const relation = this.store.repository.listExternalFileSources().find((item) => item.sourcePath === sourcePath)
    if (!relation || relation.status === 'paused') return
    this.store.repository.updateExternalFileRelation(relation.id, { status: 'missing' })
    this.onChanged()
  }

  private async handleChange(sourcePath: string): Promise<void> {
    const relation = this.store.repository.listExternalFileSources().find((item) => item.sourcePath === sourcePath)
    if (!relation || relation.status === 'paused') return
    let retained: RetainedImport | null = null
    try {
      if (!SUPPORTED_EXTENSIONS.has(extname(sourcePath).toLowerCase())) throw new Error('外部文案格式已变更，无法继续监听')
      retained = await retainImportFromPath(dirname(this.store.databasePath), relation.projectId, sourcePath)
      if (!retained.sourceStat) throw new Error('无法读取外部文案文件状态')
      if (retained.sourceStat.sizeBytes > MAX_IMPORT_BYTES) throw new Error('外部文案超过10MB，已暂停同步')
      if (retained.file.sha256 === relation.lastSha256) {
        const sourceStat = retained.sourceStat
        await discardRetainedImport(retained); retained = null
        this.store.repository.updateExternalFileRelation(relation.id, { lastMtimeMs: sourceStat.mtimeMs, lastSizeBytes: sourceStat.sizeBytes, status: 'active' })
        this.onChanged()
        return
      }
      const content = await parseRetainedImport(retained)
      this.store.repository.syncExternalScriptVersion(relation.id, relation.projectId, content, retained.file, {
        mtimeMs: retained.sourceStat.mtimeMs, sizeBytes: retained.sourceStat.sizeBytes
      })
      retained = null
      this.onChanged()
    } catch (error) {
      if (retained) await discardRetainedImport(retained).catch(() => undefined)
      console.error(`外部文案同步失败：${relation.displayName}`, error instanceof Error ? error.message : error)
      this.store.repository.updateExternalFileRelation(relation.id, { status: 'paused' })
      await this.watcher?.unwatch(sourcePath); this.watchedPaths.delete(sourcePath)
      this.onChanged()
    }
  }
}
