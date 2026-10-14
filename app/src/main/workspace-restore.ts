import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { restoreWorkspaceBackupInPlace } from './db'
import { validateWorkspaceBackupDirectory } from './db/backup'
import type { SecretProtector } from './mobile-sync-service'

const pendingSchema = z.object({
  version: z.literal(1),
  encryptedBackupDirectory: z.string().min(1),
  requestedAt: z.string()
}).strict()

function pendingPath(userDataPath: string): string {
  return join(userDataPath, 'pending-workspace-restore.json')
}

export async function scheduleWorkspaceRestore(userDataPath: string, backupDirectory: string, protector: SecretProtector): Promise<void> {
  if (!protector.isAvailable()) throw new Error('系统安全存储当前不可用，不能安全保存恢复位置')
  await validateWorkspaceBackupDirectory(backupDirectory)
  await mkdir(userDataPath, { recursive: true, mode: 0o700 })
  const target = pendingPath(userDataPath)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    version: 1,
    encryptedBackupDirectory: protector.encrypt(backupDirectory),
    requestedAt: new Date().toISOString()
  })}\n`, { mode: 0o600, flag: 'wx' })
  await chmod(temporary, 0o600)
  await rename(temporary, target)
  await chmod(target, 0o600)
}

export async function applyPendingWorkspaceRestore(userDataPath: string, protector: SecretProtector): Promise<boolean> {
  const target = pendingPath(userDataPath)
  let pending: z.infer<typeof pendingSchema>
  try {
    pending = pendingSchema.parse(JSON.parse(await readFile(target, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    await rm(target, { force: true })
    throw new Error('待恢复请求损坏，已取消恢复')
  }
  if (!protector.isAvailable()) throw new Error('系统安全存储当前不可用，无法执行待恢复请求')
  const backupDirectory = protector.decrypt(pending.encryptedBackupDirectory)
  try {
    await validateWorkspaceBackupDirectory(backupDirectory)
    await restoreWorkspaceBackupInPlace(backupDirectory, userDataPath)
    await rm(target, { force: true })
    return true
  } catch (error) {
    await rm(join(dirname(target), 'pending-workspace-restore.json'), { force: true }).catch(() => undefined)
    throw error
  }
}
