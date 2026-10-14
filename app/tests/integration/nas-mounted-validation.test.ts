import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { MountedDirectoryArchiveTransport, validateArchiveTransport } from '../../src/main/archive-transport'

const mountedRoot = process.env.CREATOR_OS_NAS_VALIDATION_ROOT?.trim() ?? ''
const runOnlyWithExplicitMountedRoot = mountedRoot ? describe : describe.skip
const execFileAsync = promisify(execFile)

runOnlyWithExplicitMountedRoot('explicit mounted NAS validation', () => {
  it('validates the real SMB mount without mounting or storing credentials', async () => {
    const canonicalRoot = await realpath(mountedRoot)
    const { stdout } = await execFileAsync('/sbin/mount', [])
    const mountLine = stdout.split('\n').find((line) => line.includes(` on ${canonicalRoot} (`))
    expect(mountLine, 'CREATOR_OS_NAS_VALIDATION_ROOT必须直接指向已挂载共享根目录').toBeTruthy()
    expect(mountLine, '实机门只接受macOS已挂载的SMB目录').toContain('(smbfs,')

    const fixtureParent = join(tmpdir(), 'creator-os-nas-live-validation')
    await mkdir(fixtureParent, { recursive: true })
    const fixtureDirectory = await mkdtemp(join(fixtureParent, 'fixtures-'))
    try {
      const transport = await MountedDirectoryArchiveTransport.create(canonicalRoot)
      const largeMb = Number(process.env.CREATOR_OS_NAS_VALIDATION_LARGE_MB ?? '256')
      const report = await validateArchiveTransport(transport, fixtureDirectory, { largeFileBytes: largeMb * 1024 * 1024 })
      expect(report.smallFile).toMatchObject({ checksumMatched: true, renamed: true })
      expect(report.largeFile).toMatchObject({ checksumMatched: true, renamed: true })
      expect(report.interruption).toEqual({ aborted: true, partialRemoved: true })
      expect(report.noOverwrite).toEqual({ collisionVersioned: true, originalPreserved: true })
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true })
    }
  }, 10 * 60 * 1_000)
})
