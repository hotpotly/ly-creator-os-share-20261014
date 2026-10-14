import { appendFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MountedDirectoryArchiveTransport, validateArchiveTransport } from '../../src/main/archive-transport'

const directories: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit-archive-transport')

async function temporaryDirectory(prefix: string): Promise<string> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, prefix))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('mounted directory archive transport', () => {
  it('claims a project directory once and only lets the same stable owner reuse it', async () => {
    const destination = await temporaryDirectory('claim-destination-')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    await transport.claimDirectory('长视频成片/@26年/1-test', 'project-one')
    await transport.claimDirectory('长视频成片/@26年/1-test', 'project-one')
    await expect(transport.claimDirectory('长视频成片/@26年/1-test', 'project-two')).rejects.toThrow('DESTINATION_EXISTS')
    await mkdir(join(destination, '长视频成片', '@26年', '2-existing'))
    await expect(transport.claimDirectory('长视频成片/@26年/2-existing', 'project-two')).rejects.toThrow('DESTINATION_EXISTS')
  })

  it('releases only an empty owned claim and never recursively removes concurrent content', async () => {
    const destination = await temporaryDirectory('claim-release-')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    const relativeDirectory = '长视频成片/@26年/3-test'
    await transport.claimDirectory(relativeDirectory, 'project-three')
    await writeFile(join(destination, relativeDirectory, 'external.txt'), '外部并发写入')
    await expect(transport.releaseEmptyClaim(relativeDirectory, 'project-three')).rejects.toThrow('已非空')
    expect(await readFile(join(destination, relativeDirectory, 'external.txt'), 'utf8')).toBe('外部并发写入')
    expect(await readFile(join(destination, relativeDirectory, '.creator-os-archive-owner'), 'utf8')).toBe('project-three')
    await rm(join(destination, relativeDirectory, 'external.txt'))
    await transport.releaseEmptyClaim(relativeDirectory, 'project-three')
    expect(await transport.stat(relativeDirectory)).toBeNull()
  })

  it('validates small/large copy, cancellation cleanup, checksum, rename and no-overwrite', async () => {
    const destination = await temporaryDirectory('destination-')
    const fixtures = await temporaryDirectory('fixtures-')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    const report = await validateArchiveTransport(transport, fixtures, { largeFileBytes: 3 * 1024 * 1024 })
    expect(report.availability).toMatchObject({ available: true, writable: true, reason: 'ready' })
    expect(report.smallFile).toMatchObject({ checksumMatched: true, renamed: true })
    expect(report.largeFile).toMatchObject({ bytes: 3 * 1024 * 1024, checksumMatched: true, renamed: true })
    expect(report.interruption).toEqual({ aborted: true, partialRemoved: true })
    expect(report.noOverwrite).toEqual({ collisionVersioned: true, originalPreserved: true })
    expect(await transport.stat(`.creator-os-validation/${report.validationId}`)).toBeNull()
  })

  it('rejects traversal, absolute destinations, symlink escapes and existing names', async () => {
    const destination = await temporaryDirectory('destination-')
    const outside = await temporaryDirectory('outside-')
    const source = join(outside, 'source.txt')
    await writeFile(source, 'original')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    await expect(transport.copyFromLocal({ sourcePath: source, destinationRelativePath: '../escape.txt' }, new AbortController().signal, () => undefined)).rejects.toThrow('NAS相对路径')
    await expect(transport.copyFromLocal({ sourcePath: source, destinationRelativePath: '/absolute.txt' }, new AbortController().signal, () => undefined)).rejects.toThrow('NAS相对路径')
    await symlink(outside, join(destination, 'linked-outside'))
    await expect(transport.copyFromLocal({ sourcePath: source, destinationRelativePath: 'linked-outside/new/sub/escape.txt' }, new AbortController().signal, () => undefined)).rejects.toThrow('普通目录')
    await expect(lstat(join(outside, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })

    await transport.copyFromLocal({ sourcePath: source, destinationRelativePath: 'safe/one.partial' }, new AbortController().signal, () => undefined)
    await expect(transport.commitNoReplace('safe/one.partial', 'safe/final.txt')).resolves.toEqual({ relativePath: 'safe/final.txt', temporaryRemoved: true })
    await transport.copyFromLocal({ sourcePath: source, destinationRelativePath: 'safe/two.partial' }, new AbortController().signal, () => undefined)
    await expect(transport.commitNoReplace('safe/two.partial', 'safe/final.txt')).resolves.toEqual({ relativePath: 'safe/final v2.txt', temporaryRemoved: true })
    expect(await readFile(join(destination, 'safe/final.txt'), 'utf8')).toBe('original')
    expect(await readFile(join(destination, 'safe/final v2.txt'), 'utf8')).toBe('original')
  })

  it('keeps progress monotonic, rejects a changing source and detects target tampering', async () => {
    const destination = await temporaryDirectory('destination-')
    const fixtures = await temporaryDirectory('fixtures-')
    const source = join(fixtures, 'source.bin')
    await writeFile(source, Buffer.alloc(2 * 1024 * 1024, 0x2a))
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    const progress: number[] = []
    const receipt = await transport.copyFromLocal(
      { sourcePath: source, destinationRelativePath: 'checks/clean.partial' },
      new AbortController().signal,
      (bytes) => progress.push(bytes)
    )
    expect(progress.length).toBeGreaterThan(2)
    expect(progress.every((value, index) => index === 0 || value > progress[index - 1]!)).toBe(true)
    expect(progress.at(-1)).toBe(receipt.bytesCopied)
    expect(JSON.stringify(receipt)).not.toContain(destination)
    expect(JSON.stringify(receipt)).not.toContain(fixtures)
    await writeFile(join(destination, 'checks/clean.partial'), 'tampered')
    expect(await transport.checksum('checks/clean.partial')).not.toBe(receipt.sourceChecksum)

    let changed = false
    await expect(transport.copyFromLocal(
      { sourcePath: source, destinationRelativePath: 'checks/changing.partial' },
      new AbortController().signal,
      (bytes) => {
        if (!changed && bytes >= 64 * 1024) {
          changed = true
          appendFileSync(source, Buffer.from('changed'))
        }
      }
    )).rejects.toThrow('复制过程中发生变化')
    expect(await transport.stat('checks/changing.partial')).toBeNull()
  })

  it('cancels checksum verification before a temporary file can be committed', async () => {
    const destination = await temporaryDirectory('checksum-cancel-')
    await mkdir(join(destination, 'checks'), { recursive: true })
    await writeFile(join(destination, 'checks', 'large.partial'), Buffer.alloc(64 * 1024 * 1024, 0x3c))
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    const controller = new AbortController()
    const verification = transport.checksum('checks/large.partial', controller.signal)
    setImmediate(() => controller.abort())
    await expect(verification).rejects.toMatchObject({ name: 'AbortError' })
    expect(await transport.stat('checks/final.bin')).toBeNull()
    expect(await transport.stat('checks/large.partial')).toMatchObject({ kind: 'file' })
  })

  it('atomically allocates final, v2 and v3 under concurrent same-name commits', async () => {
    const destination = await temporaryDirectory('destination-')
    const fixtures = await temporaryDirectory('fixtures-')
    const source = join(fixtures, 'source.txt')
    await writeFile(source, 'same-name-content')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    await Promise.all(['one', 'two', 'three'].map((name) => transport.copyFromLocal(
      { sourcePath: source, destinationRelativePath: `concurrent/${name}.partial` },
      new AbortController().signal,
      () => undefined
    )))
    const committed = await Promise.all(['one', 'two', 'three'].map((name) => transport.commitNoReplace(
      `concurrent/${name}.partial`,
      'concurrent/final.txt'
    )))
    expect(new Set(committed.map((receipt) => receipt.relativePath))).toEqual(new Set(['concurrent/final.txt', 'concurrent/final v2.txt', 'concurrent/final v3.txt']))
    expect(committed.every((receipt) => receipt.temporaryRemoved)).toBe(true)
    for (const receipt of committed) expect(await transport.checksum(receipt.relativePath)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reports a previously selected directory as missing after it disappears', async () => {
    const destination = await temporaryDirectory('destination-')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    expect(await transport.inspectAvailability()).toMatchObject({ available: true, writable: true })
    expect((await readdir(destination)).some((name) => name.startsWith('.creator-os-write-canary-'))).toBe(false)
    await rm(destination, { recursive: true, force: true })
    expect(await transport.inspectAvailability()).toEqual({ available: false, writable: false, freeBytes: null, reason: 'not_mounted' })
  })

  it('rejects a different directory that appears at the same selected mount path', async () => {
    const destination = await temporaryDirectory('destination-')
    const fixtures = await temporaryDirectory('fixtures-')
    const source = join(fixtures, 'source.txt')
    await writeFile(source, 'must not reach replacement root')
    const transport = await MountedDirectoryArchiveTransport.create(destination)
    const oldRoot = `${destination}-disconnected`
    directories.push(oldRoot)
    await rename(destination, oldRoot)
    await mkdir(destination)
    expect(await transport.inspectAvailability()).toEqual({ available: false, writable: false, freeBytes: null, reason: 'unavailable' })
    await expect(transport.copyFromLocal(
      { sourcePath: source, destinationRelativePath: 'wrong-target.txt' },
      new AbortController().signal,
      () => undefined
    )).rejects.toThrow('挂载身份已经变化')
    expect(await readdir(destination)).toEqual([])
  })
})
