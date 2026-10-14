import type BetterSqlite3 from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export async function backfillLegacyFileReferences(database: BetterSqlite3.Database, userDataPath: string): Promise<void> {
  const rows = database.prepare(`SELECT id,source_file_path FROM draft_versions WHERE source_file_id IS NULL AND source_file_path IS NOT NULL`).all() as { id: string; source_file_path: string }[]
  const importsRoot = resolve(userDataPath, 'imports')
  for (const row of rows) {
    const normalized = row.source_file_path.replace(/\\/g, '/')
    const marker = normalized.lastIndexOf('/imports/')
    if (marker < 0) continue
    const suffix = normalized.slice(marker + '/imports/'.length).split('/').filter(Boolean)
    if (suffix.length === 0 || suffix.includes('..')) continue
    const candidate = resolve(importsRoot, ...suffix)
    if (!candidate.startsWith(`${importsRoot}/`)) continue
    const resolvedPath = await realpath(candidate).catch(() => null)
    if (!resolvedPath || !resolvedPath.startsWith(`${importsRoot}/`)) continue
    const info = await stat(resolvedPath).catch(() => null)
    if (!info?.isFile()) continue
    await chmod(resolvedPath, 0o600)
    const relativePath = join('imports', ...suffix)
    const existing = database.prepare('SELECT id FROM file_references WHERE relative_path=?').get(relativePath) as { id: string } | undefined
    const fileId = existing?.id ?? randomUUID()
    const extension = extname(candidate).toLowerCase()
    const sha256 = existing ? null : await hashFile(resolvedPath)
    database.transaction(() => {
      if (!existing) {
        const timestamp = new Date().toISOString()
        const mimeType = extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/markdown'
        database.prepare(`INSERT INTO file_references(id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,source_origin,availability,process_state,capabilities_json,created_at,updated_at) VALUES(?,'file',?,?,?,?,?,?,'managed_import','available','ready',?,?,?)`).run(
          fileId, relativePath, relativePath, basename(candidate), sha256, info.size, mimeType, '["preview"]', timestamp, timestamp
        )
      }
      database.prepare('UPDATE draft_versions SET source_file_id=?,source_file_path=NULL WHERE id=? AND source_file_id IS NULL').run(fileId, row.id)
    })()
  }
}
