import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseRetainedImport, retainImportFromBytes } from '../../src/main/imported-files'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('script file import', () => {
  it('accepts a plain text comparison draft as a managed copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'creator-os-import-'))
    cleanup.push(directory)
    const retained = await retainImportFromBytes(directory, 'project-1', '自由对比.txt', new TextEncoder().encode('第一段\n第二段'))
    expect(retained.extension).toBe('.txt')
    expect(retained.file.mimeType).toBe('text/plain')
    expect(await parseRetainedImport(retained)).toBe('第一段\n第二段')
    expect(await readFile(retained.absolutePath, 'utf8')).toBe('第一段\n第二段')
  })
})
