import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appInfoSchema } from '../../src/shared/ipc'

describe('Mac local install contract', () => {
  it('keeps old or unpackaged app-info responses compatible while exposing build identity', () => {
    expect(appInfoSchema.parse({
      name: 'LY Creator OS',
      version: '0.1.0',
      platform: 'darwin',
      captureShortcut: 'CommandOrControl+Shift+L'
    })).toMatchObject({
      buildId: 'development',
      builtAt: null,
      installPath: '',
      isInstalledBuild: false
    })
    expect(appInfoSchema.parse({
      name: 'LY Creator OS',
      version: '0.1.0',
      platform: 'darwin',
      captureShortcut: 'CommandOrControl+Shift+L',
      buildId: 'abcdef123456-20260727.371',
      builtAt: '2026-07-27T01:00:00.000Z',
      installPath: '/Applications/LY Creator OS.app/Contents/MacOS/LY Creator OS',
      isInstalledBuild: true
    })).toMatchObject({
      buildId: 'abcdef123456-20260727.371',
      isInstalledBuild: true
    })
  })

  it('makes the standard package command install and verify the Applications copy', async () => {
    const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(packageJson.scripts['package:mac']).toContain('install-mac-app.mjs')
    expect(packageJson.scripts['package:mac']).toContain('--remove-source')
    expect(packageJson.scripts['package:smoke']).toContain('verify-installed-mac-app.mjs')
  })
})
