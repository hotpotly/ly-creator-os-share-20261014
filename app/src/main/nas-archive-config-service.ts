import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { ARCHIVE_CATEGORIES, type ArchiveCategory, type NasArchiveDestinationStatus } from '../shared/domain'
import { MountedDirectoryArchiveTransport } from './archive-transport'
import type { SecretProtector } from './mobile-sync-service'

const DEFAULT_CATEGORY_LABELS: Record<ArchiveCategory, string> = {
  long_video: '长视频成片',
  short_video: '短视频成片',
  ai_video: 'AI视频'
}

function normalizeCategoryLabel(value: string): string {
  return value.normalize('NFKC').replace(/[\0/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 40)
}

const storeSchema = z.object({
  version: z.literal(1),
  destinationId: z.literal('primary'),
  revision: z.string().uuid(),
  displayName: z.string().max(120),
  encryptedRootPath: z.string(),
  categoryLabels: z.record(z.enum(ARCHIVE_CATEGORIES), z.string().min(1).max(40)),
  liveSmbValidated: z.boolean(),
  lastValidatedAt: z.string().nullable()
}).strict()

type StoredConfig = z.infer<typeof storeSchema>

export class NasArchiveConfigService {
  private state: StoredConfig | null | undefined
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector
  ) {}

  private async load(): Promise<StoredConfig | null> {
    if (this.state !== undefined) return this.state
    try {
      this.state = storeSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('NAS归档设置损坏，请重新选择归档目录')
      this.state = null
    }
    return this.state
  }

  private async save(next: StoredConfig | null): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    if (!next) {
      const { rm } = await import('node:fs/promises')
      await rm(this.filePath, { force: true })
      this.state = null
      return
    }
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await import('node:fs/promises').then(({ writeFile }) => writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' }))
    await chmod(temporary, 0o600)
    await rename(temporary, this.filePath)
    await chmod(this.filePath, 0o600)
    this.state = next
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release = (): void => undefined
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }

  private decryptRoot(config: StoredConfig): string {
    if (!this.protector.isAvailable()) throw new Error('系统安全存储当前不可用，不能读取NAS目录')
    return this.protector.decrypt(config.encryptedRootPath)
  }

  async setRoot(rootPath: string, options: { markLiveSmbValidated?: boolean } = {}): Promise<NasArchiveDestinationStatus> {
    return this.mutate(async () => {
      if (!this.protector.isAvailable()) throw new Error('系统安全存储当前不可用，不能保存NAS目录')
      const transport = await MountedDirectoryArchiveTransport.create(rootPath)
      const availability = await transport.inspectAvailability()
      if (!availability.available || !availability.writable) throw new Error('所选NAS归档目录当前不可写')
      const previous = await this.load()
      await this.save({
        version: 1,
        destinationId: 'primary',
        revision: randomUUID(),
        displayName: rootPath.split('/').filter(Boolean).at(-1) ?? 'NAS归档',
        encryptedRootPath: this.protector.encrypt(rootPath),
        categoryLabels: previous?.categoryLabels ?? DEFAULT_CATEGORY_LABELS,
        liveSmbValidated: Boolean(options.markLiveSmbValidated),
        lastValidatedAt: options.markLiveSmbValidated ? new Date().toISOString() : previous?.lastValidatedAt ?? null
      })
      return this.getStatus()
    })
  }

  async updateCategoryLabels(labels: Record<ArchiveCategory, string>): Promise<NasArchiveDestinationStatus> {
    return this.mutate(async () => {
      const config = await this.load()
      if (!config) throw new Error('请先选择NAS归档目录')
      const categoryLabels = Object.fromEntries(ARCHIVE_CATEGORIES.map((category) => {
        const label = normalizeCategoryLabel(labels[category] ?? '')
        if (!label) throw new Error('NAS分类名称不能为空或只包含路径字符')
        if (label === '系统备份') throw new Error('“系统备份”是App保留目录，不能用作视频分类')
        return [category, label]
      })) as Record<ArchiveCategory, string>
      if (new Set(Object.values(categoryLabels)).size !== ARCHIVE_CATEGORIES.length) throw new Error('不同视频分类不能使用相同名称')
      await this.save({ ...config, revision: randomUUID(), categoryLabels })
      return this.getStatus()
    })
  }

  async clear(): Promise<NasArchiveDestinationStatus> {
    await this.mutate(() => this.save(null))
    return this.getStatus()
  }

  async createTransport(): Promise<MountedDirectoryArchiveTransport> {
    const config = await this.load()
    if (!config) throw new Error('NAS归档目录尚未设置')
    return MountedDirectoryArchiveTransport.create(this.decryptRoot(config))
  }

  async getPrivateRoot(): Promise<string> {
    const config = await this.load()
    if (!config) throw new Error('NAS归档目录尚未设置')
    return this.decryptRoot(config)
  }

  async getStatus(): Promise<NasArchiveDestinationStatus> {
    const config = await this.load()
    if (!config) {
      return {
        id: 'primary', revision: null, configured: false, displayName: null, categoryLabels: DEFAULT_CATEGORY_LABELS,
        availability: 'not_configured', freeBytes: null, liveSmbValidated: false, lastCheckedAt: null
      }
    }
    let availability: NasArchiveDestinationStatus['availability'] = 'unavailable'
    let freeBytes: number | null = null
    try {
      const root = this.decryptRoot(config)
      if (!(await stat(root).catch(() => null))) availability = 'not_mounted'
      else {
        const inspected = await (await MountedDirectoryArchiveTransport.create(root)).inspectAvailability()
        availability = inspected.reason === 'not_directory' ? 'unavailable' : inspected.reason
        freeBytes = inspected.freeBytes
      }
    } catch (error) {
      availability = (error instanceof Error && error.message.includes('未挂载')) ? 'not_mounted' : 'unavailable'
    }
    return {
      id: 'primary',
      revision: config.revision,
      configured: true,
      displayName: config.displayName,
      categoryLabels: config.categoryLabels,
      availability,
      freeBytes,
      liveSmbValidated: config.liveSmbValidated,
      lastCheckedAt: new Date().toISOString()
    }
  }
}
