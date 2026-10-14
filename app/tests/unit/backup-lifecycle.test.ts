import BetterSqlite3 from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, restoreWorkspaceBackup, type WorkspaceStore } from '../../src/main/db'
import { pruneWorkspaceBackups } from '../../src/main/db/backup'
import { applyPendingWorkspaceRestore, scheduleWorkspaceRestore } from '../../src/main/workspace-restore'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit-backup-lifecycle')

async function fixture(): Promise<{ root: string; store: WorkspaceStore }> {
  await mkdir(unitRoot, { recursive: true })
  const root = await mkdtemp(join(unitRoot, 'workspace-'))
  roots.push(root)
  const store = await openWorkspaceStore(root)
  stores.push(store)
  return { root, store }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace backup lifecycle', () => {
  it('backs up only referenced non-video managed files and never ambient secrets or linked videos', async () => {
    const { root, store } = await fixture()
    const note = Buffer.from('只备份数据库引用的受管文稿')
    const video = Buffer.alloc(16, 1)
    await mkdir(join(root, 'managed-files', 'project'), { recursive: true })
    await mkdir(join(root, 'archive-links', 'project'), { recursive: true })
    await writeFile(join(root, 'managed-files', 'project', 'note.md'), note)
    await writeFile(join(root, 'archive-links', 'project', 'video.mp4'), video)
    await writeFile(join(root, 'provider-configs.json'), '{"secret":"must-not-back-up"}')
    const insert = store.repository.native.prepare(`INSERT INTO file_references(
      id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,source_origin,availability,process_state,capabilities_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const now = new Date().toISOString()
    insert.run('backup-note', 'file', 'managed-files/project/note.md', 'managed-files/project/note.md', 'note.md', createHash('sha256').update(note).digest('hex'), note.byteLength, 'text/markdown', 'managed_import', 'available', 'ready', '["preview"]', now, now)
    insert.run('backup-video', 'file', 'archive-links/project/video.mp4', 'archive-links/project/video.mp4', 'video.mp4', createHash('sha256').update(video).digest('hex'), video.byteLength, 'video/mp4', 'file_picker', 'available', 'ready', '["preview"]', now, now)

    const backup = await store.createBackup('manual-security')
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as { version: number; kind: string; files: Array<{ path: string }> }
    expect(manifest).toMatchObject({ version: 2, kind: 'manual' })
    expect(manifest.files.map((file) => file.path)).toContain('files/managed-files/project/note.md')
    expect(manifest.files.map((file) => file.path)).not.toContain('files/archive-links/project/video.mp4')
    expect(JSON.stringify(manifest)).not.toContain('provider-configs.json')
    await expect(stat(join(backup, 'provider-configs.json'))).rejects.toThrow()
    const firstStartup = await store.createBackup('startup')
    expect(await store.createBackup('startup')).toBe(firstStartup)
  })

  it('copies managed files from the frozen SQLite snapshot instead of later live-reference changes', async () => {
    const { root, store } = await fixture()
    await mkdir(join(root, 'managed-files', 'snapshot'), { recursive: true })
    await writeFile(join(root, 'managed-files', 'snapshot', 'before.txt'), '快照内引用')
    await writeFile(join(root, 'managed-files', 'snapshot', 'after.txt'), '快照后引用')
    const insert = store.repository.native.prepare(`INSERT INTO file_references(
      id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,source_origin,availability,process_state,capabilities_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const timestamp = new Date().toISOString()
    insert.run('snapshot-before', 'file', 'managed-files/snapshot/before.txt', 'managed-files/snapshot/before.txt', 'before.txt', createHash('sha256').update('快照内引用').digest('hex'), Buffer.byteLength('快照内引用'), 'text/plain', 'managed_import', 'available', 'ready', '["preview"]', timestamp, timestamp)
    const native = store.repository.native
    const originalBackup = native.backup.bind(native)
    vi.spyOn(native, 'backup').mockImplementation(async (destination, options) => {
      const result = await originalBackup(destination, options)
      native.prepare('DELETE FROM file_references WHERE id=?').run('snapshot-before')
      insert.run('snapshot-after', 'file', 'managed-files/snapshot/after.txt', 'managed-files/snapshot/after.txt', 'after.txt', createHash('sha256').update('快照后引用').digest('hex'), Buffer.byteLength('快照后引用'), 'text/plain', 'managed_import', 'available', 'ready', '["preview"]', timestamp, timestamp)
      return result
    })
    const backup = await store.createBackup('snapshot-consistency')
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as { files: Array<{ path: string }> }
    expect(manifest.files.map((file) => file.path)).toContain('files/managed-files/snapshot/before.txt')
    expect(manifest.files.map((file) => file.path)).not.toContain('files/managed-files/snapshot/after.txt')
  })

  it('restores a version-one manifest and creates a preserved pre-restore snapshot before replacing data', async () => {
    const { store } = await fixture()
    const original = await store.createBackup('legacy-compatible')
    const legacyRoot = await mkdtemp(join(unitRoot, 'legacy-backup-')); roots.push(legacyRoot)
    await cp(original, legacyRoot, { recursive: true })
    const manifestPath = join(legacyRoot, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.version = 1
    delete manifest.kind
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const target = await mkdtemp(join(unitRoot, 'replace-target-')); roots.push(target)
    const existing = await openWorkspaceStore(target); stores.push(existing)
    existing.repository.updateDescription('ai-browser', '替换前必须保留')
    existing.close(); stores.splice(stores.indexOf(existing), 1)

    await restoreWorkspaceBackup(legacyRoot, target, { replaceExisting: true })
    const restored = await openWorkspaceStore(target); stores.push(restored)
    expect(restored.repository.getProject('ai-browser', false).description).not.toBe('替换前必须保留')
    const preserved = await readdir(join(target, 'backups'))
    expect(preserved.some((name) => name.includes('pre_restore'))).toBe(true)
  })

  it('schedules an encrypted restore request and applies it in place before the workspace database opens', async () => {
    const { root, store } = await fixture()
    store.repository.updateDescription('ai-browser', '备份中的说明')
    const backup = await store.createBackup('restore-request')
    store.repository.updateDescription('ai-browser', '恢复前的新说明')
    store.close(); stores.splice(stores.indexOf(store), 1)
    const protector = {
      isAvailable: () => true,
      encrypt: (value: string) => Buffer.from(value).toString('base64'),
      decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
    }
    await scheduleWorkspaceRestore(root, backup, protector)
    expect(await readFile(join(root, 'pending-workspace-restore.json'), 'utf8')).not.toContain(backup)
    expect(await applyPendingWorkspaceRestore(root, protector)).toBe(true)
    const restored = await openWorkspaceStore(root); stores.push(restored)
    expect(restored.repository.getProject('ai-browser', false).description).toBe('备份中的说明')
    expect((await readdir(join(root, 'backups'))).some((name) => name.includes('pre_restore'))).toBe(true)
  })

  it('keeps the original workspace openable when a scheduled restore becomes unavailable or invalid', async () => {
    const { root, store } = await fixture()
    store.repository.updateDescription('ai-browser', '恢复失败后保留原数据')
    const backup = await store.createBackup('restore-failure')
    const protector = {
      isAvailable: () => true,
      encrypt: (value: string) => Buffer.from(value).toString('base64'),
      decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
    }
    await scheduleWorkspaceRestore(root, backup, protector)
    await writeFile(join(backup, 'manifest.json'), '{"broken":true}\n')
    store.close(); stores.splice(stores.indexOf(store), 1)
    await expect(applyPendingWorkspaceRestore(root, protector)).rejects.toThrow()
    const reopened = await openWorkspaceStore(root); stores.push(reopened)
    expect(reopened.repository.getProject('ai-browser', false).description).toBe('恢复失败后保留原数据')
    await expect(readFile(join(root, 'pending-workspace-restore.json'), 'utf8')).rejects.toThrow()
  })

  it('keeps recent daily and monthly automatic backups while leaving manual and invalid folders untouched', async () => {
    const { root, store } = await fixture()
    const template = await store.createBackup('manual-template')
    const backupRoot = join(root, 'backups')
    const sqlite = await readFile(join(template, 'workspace.sqlite3'))
    const databaseRecord = {
      path: 'workspace.sqlite3',
      sizeBytes: sqlite.byteLength,
      sha256: createHash('sha256').update(sqlite).digest('hex')
    }
    const marker = Buffer.from(`${JSON.stringify({ app: 'ly-creator-os', format: 2 })}\n`)
    const markerRecord = {
      path: 'creator-os-backup.json',
      sizeBytes: marker.byteLength,
      sha256: createHash('sha256').update(marker).digest('hex')
    }
    const createAutomatic = async (name: string, createdAt: string): Promise<void> => {
      const directory = join(backupRoot, name)
      await mkdir(directory)
      await writeFile(join(directory, 'workspace.sqlite3'), sqlite)
      await writeFile(join(directory, 'creator-os-backup.json'), marker)
      await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({
        version: 2, createdAt, label: 'startup', kind: 'startup', files: [databaseRecord, markerRecord]
      })}\n`)
    }
    const base = Date.UTC(2026, 6, 24, 12)
    for (let index = 0; index < 40; index += 1) {
      await createAutomatic(`daily-${String(index).padStart(2, '0')}`, new Date(base - index * 86_400_000).toISOString())
    }
    for (let index = 0; index < 15; index += 1) {
      await createAutomatic(`monthly-${String(index).padStart(2, '0')}`, new Date(Date.UTC(2025, 11 - index, 1, 12)).toISOString())
    }
    await mkdir(join(backupRoot, 'invalid-do-not-touch'))
    await pruneWorkspaceBackups(backupRoot)
    const remaining = await readdir(backupRoot)
    const automatic = remaining.filter((name) => name.startsWith('daily-') || name.startsWith('monthly-'))
    expect(automatic.length).toBeLessThanOrEqual(42)
    expect(remaining).toContain('daily-00')
    expect(remaining).not.toContain('monthly-14')
    expect(remaining).toContain('invalid-do-not-touch')
    expect(remaining.some((name) => name.includes('manual-template'))).toBe(true)

    const database = new BetterSqlite3(join(template, 'workspace.sqlite3'), { readonly: true })
    expect((database.pragma('quick_check') as Array<{ quick_check: string }>)[0]?.quick_check).toBe('ok')
    database.close()
  })
})
