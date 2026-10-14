import BetterSqlite3 from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, lstat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { localDateForInstant } from '../../shared/domain/coarse-time'

interface BackupManifestFile { path: string; sizeBytes: number; sha256: string }
type BackupKind = 'startup' | 'manual' | 'pre_migration' | 'pre_restore' | 'nas_daily'
interface BackupManifestV1 { version: 1; createdAt: string; label: string; files: BackupManifestFile[] }
interface BackupManifestV2 { version: 2; createdAt: string; label: string; kind: BackupKind; files: BackupManifestFile[] }
type BackupManifest = BackupManifestV1 | BackupManifestV2
const BACKUP_MARKER = 'creator-os-backup.json'

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`备份目录包含不支持的文件类型：${relative(root, path)}`)
  }
  return files
}

async function secureTree(directory: string): Promise<void> {
  await chmod(directory, 0o700)
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await secureTree(path)
    else if (entry.isFile()) await chmod(path, 0o600)
    else throw new Error('备份中不允许符号链接或特殊文件')
  }
}

function backupKind(label: string): BackupKind {
  if (label === 'startup') return 'startup'
  if (label === 'pre_restore' || label.startsWith('pre-restore')) return 'pre_restore'
  if (label === 'nas_daily' || label.startsWith('nas-daily')) return 'nas_daily'
  if (label.startsWith('pre-migration')) return 'pre_migration'
  return 'manual'
}

function safeManagedLocator(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '')
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  if (!['managed-files', 'imports', 'project-materials', 'business-files', 'publishing-assets'].includes(parts[0] ?? '')) return null
  return parts.join('/')
}

async function copyEligibleManagedFiles(database: BetterSqlite3.Database, userDataPath: string, backupDirectory: string): Promise<void> {
  const hasFileReferences = Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_references'`).get())
  if (!hasFileReferences) return
  const rows = database.prepare(`SELECT COALESCE(NULLIF(managed_locator,''),relative_path) AS locator,mime_type FROM file_references`).all() as Array<{ locator: string; mime_type: string }>
  const copied = new Set<string>()
  for (const row of rows) {
    if (row.mime_type.startsWith('video/')) continue
    const locator = safeManagedLocator(row.locator)
    if (!locator || copied.has(locator)) continue
    const source = join(userDataPath, locator)
    const sourceInfo = await lstat(source).catch(() => null)
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) continue
    const target = join(backupDirectory, 'files', locator)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(source, target)
    await chmod(target, 0o600)
    copied.add(locator)
  }
}

function assertInside(root: string, path: string): void {
  const normalizedRoot = `${resolve(root)}/`
  if (!resolve(path).startsWith(normalizedRoot)) throw new Error('备份清单包含越界路径')
}

function parseManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') throw new Error('备份清单无效')
  const candidate = value as Partial<BackupManifestV2>
  if (![1, 2].includes(Number(candidate.version)) || typeof candidate.createdAt !== 'string' || typeof candidate.label !== 'string' || !Array.isArray(candidate.files)) throw new Error('不支持的备份清单')
  if (candidate.version === 2 && !['startup', 'manual', 'pre_migration', 'pre_restore', 'nas_daily'].includes(candidate.kind ?? '')) throw new Error('备份类型无效')
  const files = candidate.files.map((file) => {
    if (!file || typeof file.path !== 'string' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('备份清单文件记录无效')
    if (file.path.startsWith('/') || file.path.split('/').some((part) => part === '..' || part === '')) throw new Error('备份清单包含越界路径')
    return { path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 }
  })
  if (new Set(files.map((file) => file.path)).size !== files.length || !files.some((file) => file.path === 'workspace.sqlite3')) throw new Error('备份清单缺少必需文件或包含重复记录')
  return candidate.version === 2
    ? { version: 2, createdAt: candidate.createdAt, label: candidate.label, kind: candidate.kind!, files }
    : { version: 1, createdAt: candidate.createdAt, label: candidate.label, files }
}

export async function validateWorkspaceBackupDirectory(directory: string, options: { requireMarker?: boolean } = {}): Promise<BackupManifest> {
  const manifest = parseManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))
  const actualFiles = (await collectFiles(directory)).map((path) => relative(directory, path).replaceAll('\\', '/')).filter((path) => path !== 'manifest.json').sort()
  const declaredFiles = manifest.files.map((file) => file.path).sort()
  if (actualFiles.length !== declaredFiles.length || actualFiles.some((path, index) => path !== declaredFiles[index])) throw new Error('备份目录与封闭清单不一致')
  for (const file of manifest.files) {
    const path = join(directory, file.path); assertInside(directory, path)
    const info = await stat(path)
    if (!info.isFile() || info.size !== file.sizeBytes || await hashFile(path) !== file.sha256) throw new Error(`备份校验失败：${file.path}`)
  }
  if (options.requireMarker) {
    if (!manifest.files.some((file) => file.path === BACKUP_MARKER)) throw new Error('备份缺少App标记')
    await validateWorkspaceBackupMarker(directory)
  }
  return manifest
}

export async function validateWorkspaceBackupMarker(directory: string): Promise<void> {
  const markerPath = join(directory, BACKUP_MARKER)
  const markerInfo = await lstat(markerPath)
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) throw new Error('备份App标记不是普通文件')
  const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { app?: unknown; format?: unknown }
  if (
    !marker
    || typeof marker !== 'object'
    || marker.app !== 'ly-creator-os'
    || marker.format !== 2
    || Object.keys(marker).sort().join(',') !== 'app,format'
  ) throw new Error('备份App标记无效')
}

async function readValidatedManifest(directory: string): Promise<BackupManifest | null> {
  try {
    return await validateWorkspaceBackupDirectory(directory, { requireMarker: true })
  } catch { return null }
}

export async function pruneWorkspaceBackups(backupRoot: string): Promise<void> {
  const entries = await readdir(backupRoot, { withFileTypes: true }).catch(() => [])
  const automatic: Array<{ name: string; manifest: BackupManifestV2 }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = await readValidatedManifest(join(backupRoot, entry.name))
    if (manifest?.version === 2 && ['startup', 'nas_daily'].includes(manifest.kind)) automatic.push({ name: entry.name, manifest })
  }
  automatic.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt))
  const keep = new Set<string>()
  const seenDays = new Set<string>()
  const seenMonths = new Set<string>()
  for (const item of automatic) {
    const day = localDateForInstant(new Date(item.manifest.createdAt), 'Asia/Shanghai')
    const month = day.slice(0, 7)
    if (!seenDays.has(day) && seenDays.size < 30) { seenDays.add(day); keep.add(item.name) }
    if (!seenMonths.has(month) && seenMonths.size < 12) { seenMonths.add(month); keep.add(item.name) }
  }
  await Promise.all(automatic.filter((item) => !keep.has(item.name)).map((item) => rm(join(backupRoot, item.name), { recursive: true, force: true })))
}

export async function createWorkspaceBackup(database: BetterSqlite3.Database, userDataPath: string, label = 'manual'): Promise<string> {
  const backupRoot = join(userDataPath, 'backups')
  await mkdir(backupRoot, { recursive: true, mode: 0o700 }); await chmod(backupRoot, 0o700)
  const kind = backupKind(label)
  if (kind === 'startup' || kind === 'nas_daily') {
    const today = localDateForInstant(new Date(), 'Asia/Shanghai')
    const existing = await readdir(backupRoot, { withFileTypes: true })
    for (const entry of existing) {
      if (!entry.isDirectory()) continue
      const manifest = await readValidatedManifest(join(backupRoot, entry.name))
      if (manifest?.version === 2 && manifest.kind === kind && localDateForInstant(new Date(manifest.createdAt), 'Asia/Shanghai') === today) return join(backupRoot, entry.name)
    }
  }
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '-').slice(0, 48) || 'manual'
  const directory = join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeLabel}`)
  await mkdir(directory, { recursive: false, mode: 0o700 })
  try {
    const databaseTarget = join(directory, 'workspace.sqlite3')
    await database.backup(databaseTarget); await chmod(databaseTarget, 0o600)
    const frozenDatabase = new BetterSqlite3(databaseTarget, { readonly: true, fileMustExist: true })
    try {
      await copyEligibleManagedFiles(frozenDatabase, userDataPath, directory)
    } finally {
      frozenDatabase.close()
    }
    await writeFile(join(directory, BACKUP_MARKER), `${JSON.stringify({ app: 'ly-creator-os', format: 2 })}\n`, { mode: 0o600, flag: 'wx' })
    const backedFiles = (await collectFiles(directory)).filter((path) => path !== join(directory, 'manifest.json'))
    const files: BackupManifestFile[] = []
    for (const path of backedFiles) {
      const info = await stat(path)
      files.push({ path: relative(directory, path).replaceAll('\\', '/'), sizeBytes: info.size, sha256: await hashFile(path) })
    }
    const manifest: BackupManifestV2 = { version: 2, createdAt: new Date().toISOString(), label: safeLabel, kind, files }
    await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await secureTree(directory)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  await pruneWorkspaceBackups(backupRoot)
  return directory
}

export async function restoreWorkspaceBackup(backupDirectory: string, targetUserDataPath: string, options: { replaceExisting?: boolean } = {}): Promise<void> {
  const manifest = await validateWorkspaceBackupDirectory(backupDirectory)
  const existingTarget = await stat(targetUserDataPath).catch(() => null)
  const targetEntries = existingTarget?.isDirectory() ? await readdir(targetUserDataPath) : []
  if (existingTarget && (!existingTarget.isDirectory() || (targetEntries.length > 0 && !options.replaceExisting))) throw new Error('恢复目标必须是不存在或空目录，拒绝静默覆盖')

  let preRestoreBackup: string | null = null
  if (options.replaceExisting && targetEntries.length && (await stat(join(targetUserDataPath, 'creator-os.sqlite3')).catch(() => null))?.isFile()) {
    const current = new BetterSqlite3(join(targetUserDataPath, 'creator-os.sqlite3'))
    try { preRestoreBackup = await createWorkspaceBackup(current, targetUserDataPath, 'pre_restore') } finally { current.close() }
  }
  const staging = join(dirname(targetUserDataPath), `.${relative(dirname(targetUserDataPath), targetUserDataPath).replace(/[^a-z0-9_-]/gi, '-') || 'creator-os'}-restore-${randomUUID()}`)
  const rollback = `${targetUserDataPath}.pre-restore-${randomUUID()}`
  try {
    await mkdir(staging, { recursive: false, mode: 0o700 })
    const targetDatabase = join(staging, 'creator-os.sqlite3')
    await copyFile(join(backupDirectory, 'workspace.sqlite3'), targetDatabase); await chmod(targetDatabase, 0o600)
    for (const file of manifest.files.filter((entry) => entry.path.startsWith('files/'))) {
      const target = join(staging, file.path.slice('files/'.length)); assertInside(staging, target)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(join(backupDirectory, file.path), target); await chmod(target, 0o600)
    }
    if (preRestoreBackup) {
      const preserved = join(staging, 'backups', preRestoreBackup.split('/').at(-1)!)
      await mkdir(dirname(preserved), { recursive: true, mode: 0o700 })
      const { cp } = await import('node:fs/promises')
      await cp(preRestoreBackup, preserved, { recursive: true, force: false, errorOnExist: true })
    }
    const database = new BetterSqlite3(targetDatabase, { readonly: true, fileMustExist: true })
    try {
      const quickCheck = database.pragma('quick_check') as { quick_check: string }[]
      if (quickCheck.some((row) => row.quick_check !== 'ok') || (database.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('备份数据库完整性检查失败')
    } finally { database.close() }
    await secureTree(staging)
    if (existingTarget) await rename(targetUserDataPath, rollback)
    await rename(staging, targetUserDataPath)
    await rm(rollback, { recursive: true, force: true })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (await stat(rollback).catch(() => null)) {
      await rm(targetUserDataPath, { recursive: true, force: true }).catch(() => undefined)
      await rename(rollback, targetUserDataPath)
    } else if (existingTarget && !(await stat(targetUserDataPath).catch(() => null))) await mkdir(targetUserDataPath, { recursive: false, mode: 0o700 })
    throw error
  }
}

export async function restoreWorkspaceBackupInPlace(backupDirectory: string, targetUserDataPath: string): Promise<void> {
  await validateWorkspaceBackupDirectory(backupDirectory)
  await mkdir(targetUserDataPath, { recursive: true, mode: 0o700 })
  const currentDatabasePath = join(targetUserDataPath, 'creator-os.sqlite3')
  if ((await stat(currentDatabasePath).catch(() => null))?.isFile()) {
    const current = new BetterSqlite3(currentDatabasePath)
    try { await createWorkspaceBackup(current, targetUserDataPath, 'pre_restore') } finally { current.close() }
  }
  const operationId = randomUUID()
  const staging = join(targetUserDataPath, `.workspace-restore-${operationId}`)
  const rollback = join(targetUserDataPath, `.workspace-rollback-${operationId}`)
  const managedRoots = ['managed-files', 'imports', 'project-materials', 'business-files', 'publishing-assets']
  const names = ['creator-os.sqlite3', 'creator-os.sqlite3-wal', 'creator-os.sqlite3-shm', ...managedRoots]
  const movedOld: string[] = []
  const installedNew: string[] = []
  try {
    await restoreWorkspaceBackup(backupDirectory, staging)
    await mkdir(rollback, { recursive: false, mode: 0o700 })
    for (const name of names) {
      const current = join(targetUserDataPath, name)
      if (await stat(current).catch(() => null)) {
        await rename(current, join(rollback, name))
        movedOld.push(name)
      }
      const replacement = join(staging, name)
      if (await stat(replacement).catch(() => null)) {
        await rename(replacement, current)
        installedNew.push(name)
      }
    }
    await rm(staging, { recursive: true, force: true })
    await rm(rollback, { recursive: true, force: true })
  } catch (error) {
    for (const name of installedNew.reverse()) await rm(join(targetUserDataPath, name), { recursive: true, force: true }).catch(() => undefined)
    for (const name of movedOld.reverse()) {
      const previous = join(rollback, name)
      if (await stat(previous).catch(() => null)) await rename(previous, join(targetUserDataPath, name)).catch(() => undefined)
    }
    await rm(staging, { recursive: true, force: true })
    await rm(rollback, { recursive: true, force: true })
    throw error
  }
}
