import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildProviderSandboxProfile,
  CHATGPT_CODEX_EXECUTABLE,
  CODEX_IMAGE_FEATURE_ARGUMENTS,
  imageProviderFingerprint,
  imageProviderInvocationSignature,
  providerInvocationSignature,
  PROVIDER_CANDIDATES,
  type ProviderExecutableInfo
} from '../../src/main/provider-execution'
import {
  ImageProviderSecurityAttestationStore,
  ProviderSecurityAttestationStore,
  verifyImageProviderSecurity,
  verifyProviderSecurity
} from '../../src/main/provider-security'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit-provider-security')

async function createRoot(name: string): Promise<string> {
  const root = join(unitRoot, `${name}-${crypto.randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

function providerInfo(provider: ProviderExecutableInfo['provider'], fingerprint = 'a'.repeat(64)): ProviderExecutableInfo {
  return {
    provider,
    executablePath: provider === 'codex_cli'
      ? '/opt/homebrew/lib/node_modules/@openai/codex/vendor/bin/codex'
      : '/Users/test/.local/share/claude/versions/1.0.0',
    version: 'test 1.0.0',
    fingerprint
  }
}

function promptValue(prompt: string, key: string): string {
  const line = prompt.split('\n').find((item) => item.startsWith(`${key}=`))
  if (!line) throw new Error(`missing ${key}`)
  return line.slice(key.length + 1)
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('CLI provider security contract', () => {
  it('builds a fingerprintable no-shell sandbox policy for both providers', () => {
    const taskDirectory = '/Users/test/Library/Application Support/LY Creator OS/provider-task'
    const codexProfile = buildProviderSandboxProfile(providerInfo('codex_cli'), taskDirectory)
    const claudeProfile = buildProviderSandboxProfile(providerInfo('claude_cli'), taskDirectory)

    expect(providerInvocationSignature('codex_cli')).toContain('shell_tool')
    expect(providerInvocationSignature('claude_cli')).toContain('--tools=')
    expect(codexProfile).toContain('(deny default)')
    expect(codexProfile).toContain(`(subpath "${taskDirectory}")`)
    expect(codexProfile).not.toContain('(allow process*)')
    expect(codexProfile).not.toContain('(literal "/bin/sh")')
    expect(codexProfile).not.toContain('(literal "/bin/cp")')
    expect(CODEX_IMAGE_FEATURE_ARGUMENTS).toContain('image_generation')
    expect(CODEX_IMAGE_FEATURE_ARGUMENTS).toContain('shell_tool')
    expect(CODEX_IMAGE_FEATURE_ARGUMENTS).toContain('unified_exec')
    expect(CODEX_IMAGE_FEATURE_ARGUMENTS.join(' ')).not.toMatch(/--enable (?:shell_tool|unified_exec)/)
    expect(imageProviderInvocationSignature()).toContain('workspace-write')
    expect(imageProviderInvocationSignature()).toContain('generated_images')
    expect(imageProviderFingerprint(providerInfo('codex_cli'))).not.toBe(providerInfo('codex_cli').fingerprint)
    expect(claudeProfile).toContain('(literal "/usr/bin/security")')
    expect(claudeProfile).not.toContain('/Users/test/Documents')
    expect(PROVIDER_CANDIDATES.codex_cli[0]).toBe(CHATGPT_CODEX_EXECUTABLE)
    expect(buildProviderSandboxProfile({
      ...providerInfo('codex_cli'),
      executablePath: CHATGPT_CODEX_EXECUTABLE
    }, taskDirectory)).toContain('(subpath "/Applications/ChatGPT.app/Contents/Resources")')
  })

  it('passes only when selected input is returned and all file canaries remain unreadable', async () => {
    const root = await createRoot('pass')
    const home = join(root, 'home'); const runs = join(root, 'runs')
    await mkdir(home, { recursive: true })
    const result = await verifyProviderSecurity(providerInfo('claude_cli'), {
      baseDirectory: runs,
      homeDirectory: home,
      execute: async (options) => {
        const selectedMarker = options.prompt.match(/LY_SELECTED_[A-Z0-9]+/)?.[0]
        return {
          structuredOutput: { selected_marker: selectedMarker, readable_file_contents: [], status: 'ok' },
          rawOutput: JSON.stringify({ selected_marker: selectedMarker, readable_file_contents: [], status: 'ok' })
        }
      }
    })

    expect(result).toMatchObject({ status: 'passed', failureCode: null, checks: { selectedInput: true, unselectedConversation: true, projectFile: true, homeFile: true, structuredOutput: true } })
    expect(await readdir(home)).toEqual([])
  })

  it('fails when an executor can read an unselected conversation canary', async () => {
    const root = await createRoot('leak')
    const home = join(root, 'home'); await mkdir(home, { recursive: true })
    const result = await verifyProviderSecurity(providerInfo('codex_cli'), {
      baseDirectory: join(root, 'runs'),
      homeDirectory: home,
      execute: async (options) => {
        const selectedMarker = options.prompt.match(/LY_SELECTED_[A-Z0-9]+/)?.[0]
        const leaked = await readFile(promptValue(options.prompt, 'unselected_conversation'), 'utf8')
        return {
          structuredOutput: { selected_marker: selectedMarker, readable_file_contents: [leaked], status: 'ok' },
          rawOutput: JSON.stringify({ selected_marker: selectedMarker, readable_file_contents: [leaked], status: 'ok' })
        }
      }
    })

    expect(result.status).toBe('failed')
    expect(result.failureCode).toBe('PROVIDER_CANARY_LEAK')
    expect(result.checks.unselectedConversation).toBe(false)
  })

  it('invalidates a passed attestation whenever the security fingerprint changes', async () => {
    const root = await createRoot('attestation')
    const store = new ProviderSecurityAttestationStore(join(root, 'provider-security-attestations.json'))
    const original = providerInfo('codex_cli', '1'.repeat(64))
    await store.save({
      provider: 'codex_cli', fingerprint: original.fingerprint, status: 'passed', verifiedAt: new Date().toISOString(), failureCode: null,
      checks: { selectedInput: true, unselectedConversation: true, projectFile: true, homeFile: true, structuredOutput: true }
    })

    expect(await store.isCurrent(original)).toBe(true)
    expect(await store.isCurrent(providerInfo('codex_cli', '2'.repeat(64)))).toBe(false)
  })

  it('records an execution timeout or cancellation as a failed verification without leaking raw errors', async () => {
    const root = await createRoot('failure')
    const home = join(root, 'home'); await mkdir(home, { recursive: true })
    const result = await verifyProviderSecurity(providerInfo('claude_cli'), {
      baseDirectory: join(root, 'runs'),
      homeDirectory: home,
      execute: async () => { throw new Error('TASK_TIMEOUT') }
    })

    expect(result).toMatchObject({ status: 'failed', failureCode: 'TASK_TIMEOUT', checks: { selectedInput: false, structuredOutput: false } })
    expect(await readdir(home)).toEqual([])
  })

  it('attests the exact no-shell image invocation independently from normal CLI tasks', async () => {
    const root = await createRoot('image-attestation')
    const info = providerInfo('codex_cli')
    const result = await verifyImageProviderSecurity(info, {
      baseDirectory: join(root, 'runs'),
      execute: async (_snapshot, taskDirectory) => {
        const imagePath = join(taskDirectory, 'generated.png')
        await writeFile(imagePath, new Uint8Array([137, 80, 78, 71]))
        return imagePath
      }
    })
    expect(result).toMatchObject({
      status: 'passed',
      fingerprint: imageProviderFingerprint(info),
      checks: { generatedImage: true, shellDisabled: true, externalFileUnreadable: true }
    })
    const store = new ImageProviderSecurityAttestationStore(join(root, 'image-security.json'))
    await store.save(result)
    expect(await store.isCurrent(imageProviderFingerprint(info))).toBe(true)
    expect(await store.isCurrent('f'.repeat(64))).toBe(false)
  })
})
