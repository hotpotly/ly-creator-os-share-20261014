import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { inspectProviderExecutable } from '../../src/main/provider-execution'
import { verifyImageProviderSecurity } from '../../src/main/provider-security'

const roots: string[] = []
const realProviderIt = process.env.CREATOR_OS_REAL_IMAGE_PROVIDER === '1' ? it : it.skip

afterAll(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('real Codex image provider isolation', () => {
  realProviderIt('passes the exact image-generation canary while Shell and external file access remain disabled', async () => {
    const provider = await inspectProviderExecutable('codex_cli')
    expect(provider).not.toBeNull()
    const root = join(import.meta.dirname, '../../test-results/integration')
    await mkdir(root, { recursive: true })
    const taskDirectory = await mkdtemp(join(root, 'codex-image-no-shell-'))
    roots.push(taskDirectory)
    const result = await verifyImageProviderSecurity(provider!, { baseDirectory: taskDirectory })
    expect(result).toMatchObject({
      status: 'passed',
      checks: { generatedImage: true, shellDisabled: true, externalFileUnreadable: true }
    })
  }, 15 * 60_000)
})
