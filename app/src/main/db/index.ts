import BetterSqlite3 from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorkspaceBackup, restoreWorkspaceBackup, restoreWorkspaceBackupInPlace } from './backup'
import { backfillLegacyFileReferences } from './file-reference-backfill'
import { hasPendingMigrations, LATEST_MIGRATION_ID, runMigrations } from './migrations'
import { WorkspaceRepository } from './repository'
import { seedWorkspace } from './seed'
import { discardManagedLocators, sweepUnreferencedManagedFiles } from '../managed-files'

export interface WorkspaceStore {
  repository: WorkspaceRepository
  databasePath: string
  createBackup(label?: string): Promise<string>
  close(): void
}

export async function openWorkspaceStore(userDataPath: string): Promise<WorkspaceStore> {
  await mkdir(userDataPath, { recursive: true, mode: 0o700 }); await chmod(userDataPath, 0o700)
  const databasePath = join(userDataPath, 'creator-os.sqlite3')
  const existed = Boolean(await stat(databasePath).catch(() => null))
  const previousUmask = process.umask(0o077)
  let native: BetterSqlite3.Database
  try { native = new BetterSqlite3(databasePath) } finally { process.umask(previousUmask) }
  try {
    const contentTypesTableExists = Boolean(native.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='content_types'`).get())
    const hadWorkspaceData = contentTypesTableExists && (native.prepare('SELECT COUNT(*) AS count FROM content_types').get() as { count: number }).count > 0
    native.pragma('foreign_keys = ON')
    native.pragma('busy_timeout = 5000')
    const quickCheck = native.pragma('quick_check') as { quick_check: string }[]
    if (quickCheck.some((row) => row.quick_check !== 'ok')) throw new Error('数据库完整性检查失败，未执行迁移')
    const foreignKeyIssues = native.pragma('foreign_key_check') as unknown[]
    if (foreignKeyIssues.length > 0) throw new Error('数据库外键检查失败，未执行迁移')
    if (existed && hasPendingMigrations(native)) await createWorkspaceBackup(native, userDataPath, `pre-migration-${LATEST_MIGRATION_ID}`)
    runMigrations(native)
    await backfillLegacyFileReferences(native, userDataPath)
    const includeDemoContent = process.env.NODE_ENV === 'test' || process.env.CREATOR_OS_DEMO_SEED === '1'
    seedWorkspace(native, !hadWorkspaceData, includeDemoContent)
    native.pragma('journal_mode = WAL')
    const repository = new WorkspaceRepository(native, { sessionId: randomUUID() })
    repository.initializeUndoSession()
    repository.assertCanonicalTypes()
    const released = repository.releaseOrphanFileReferences()
    await discardManagedLocators(userDataPath, released.managedLocators)
    await sweepUnreferencedManagedFiles(userDataPath, repository.listManagedFileLocators())
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) if (await stat(path).catch(() => null)) await chmod(path, 0o600)
    return {
      repository,
      databasePath,
      createBackup: (label = 'manual') => createWorkspaceBackup(native, userDataPath, label),
      close: () => native.close()
    }
  } catch (error) {
    native.close()
    throw error
  }
}

export { restoreWorkspaceBackup, restoreWorkspaceBackupInPlace }
