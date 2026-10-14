import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../src/shared/domain'
import { ExternalProviderConfigService } from '../../src/main/external-provider-config-service'
import type { SecretProtector } from '../../src/main/mobile-sync-service'

const directories: string[] = []

async function createService(
  fetchImpl?: typeof fetch,
  lookupImpl?: ConstructorParameters<typeof ExternalProviderConfigService>[3]
): Promise<{ service: ExternalProviderConfigService; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'creator-os-provider-config-'))
  directories.push(directory)
  const path = join(directory, 'provider-configs.json')
  const protector: SecretProtector = {
    isAvailable: () => true,
    encrypt: (secret) => `encrypted:${Buffer.from(secret).toString('base64')}`,
    decrypt: (encrypted) => Buffer.from(encrypted.slice('encrypted:'.length), 'base64').toString('utf8')
  }
  return { service: new ExternalProviderConfigService(path, protector, fetchImpl, lookupImpl), path }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('external provider config service', () => {
  it('persists only safeStorage ciphertext and never returns the API key to Renderer contracts', async () => {
    const { service, path } = await createService()
    const saved = await service.saveConfig({
      kind: 'deepseek_api',
      displayName: '我的DeepSeek',
      model: 'deepseek-chat',
      apiKey: 'sk-super-sensitive-value'
    })
    expect(saved).toMatchObject({
      kind: 'deepseek_api',
      baseUrl: 'https://api.deepseek.com',
      hasApiKey: true,
      status: 'unverified'
    })
    expect(saved).not.toHaveProperty('apiKey')
    expect(saved).not.toHaveProperty('encryptedApiKey')
    const stored = await readFile(path, 'utf8')
    expect(stored).not.toContain('sk-super-sensitive-value')
    expect(stored).toContain('encryptedApiKey')
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    await service.saveConfig({ id: saved.id, kind: saved.kind, displayName: '改名后', model: 'deepseek-chat' })
    const reloaded = (await service.getSettings()).configs[0]!
    expect(reloaded).toMatchObject({ id: saved.id, displayName: '改名后', hasApiKey: true })
  })

  it('rejects insecure or local custom endpoints before any network request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const { service } = await createService(fetchMock)
    await expect(service.saveConfig({
      kind: 'openai_compatible', displayName: '不安全', model: 'model', apiKey: 'key', baseUrl: 'http://example.com/v1'
    })).rejects.toThrow('HTTPS')
    await expect(service.saveConfig({
      kind: 'openai_compatible', displayName: '本机', model: 'model', apiKey: 'key', baseUrl: 'https://localhost/v1'
    })).rejects.toThrow('本机或局域网')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates supported protocols with the decrypted key only inside Main and stores a redacted result', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const { service, path } = await createService(fetchMock)
    const saved = await service.saveConfig({
      kind: 'gemini_api', displayName: 'Gemini教程', model: 'gemini-test', apiKey: 'gemini-private-key'
    })
    const validated = await service.validateConfig(saved.id)
    expect(validated).toMatchObject({ status: 'available', lastError: null })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect((request?.headers as Record<string, string>).authorization).toBe('Bearer gemini-private-key')
    expect(JSON.parse(String(request?.body))).toMatchObject({ response_format: { type: 'json_object' } })
    expect(await readFile(path, 'utf8')).not.toContain('gemini-private-key')
  })

  it('requires a replacement key before changing the Provider type or custom API address', async () => {
    const { service } = await createService()
    const saved = await service.saveConfig({
      kind: 'openai_compatible', displayName: '兼容服务', model: 'model-a', apiKey: 'original-key', baseUrl: 'https://api.example.com/v1'
    })
    await expect(service.saveConfig({
      id: saved.id, kind: 'openai_compatible', displayName: saved.displayName, model: saved.model, baseUrl: 'https://other.example.com/v1'
    })).rejects.toThrow('必须重新填写API key')
    await expect(service.saveConfig({
      id: saved.id, kind: 'openai_api', displayName: saved.displayName, model: saved.model
    })).rejects.toThrow('必须重新填写API key')
    const updated = await service.saveConfig({
      id: saved.id, kind: 'openai_compatible', displayName: saved.displayName, model: saved.model, baseUrl: 'https://other.example.com/v1', apiKey: 'replacement-key'
    })
    expect(updated.baseUrl).toBe('https://other.example.com/v1')
  })

  it('blocks IPv6, DNS-to-private and redirect SSRF paths for custom endpoints', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 302, headers: { location: 'https://127.0.0.1/' } }))
    const privateLookup = vi.fn<NonNullable<ConstructorParameters<typeof ExternalProviderConfigService>[3]>>().mockResolvedValue([{ address: '192.168.1.8', family: 4 }])
    const { service } = await createService(fetchMock, privateLookup)
    await expect(service.saveConfig({
      kind: 'openai_compatible', displayName: 'IPv6本机', model: 'model', apiKey: 'key', baseUrl: 'https://[::1]/v1'
    })).rejects.toThrow('本机或局域网')
    for (const baseUrl of ['https://[::ffff:7f00:1]/v1', 'https://[::ffff:a00:1]/v1', 'https://[fec0::1]/v1']) {
      await expect(service.saveConfig({
        kind: 'openai_compatible', displayName: 'IPv6映射内网', model: 'model', apiKey: 'key', baseUrl
      })).rejects.toThrow('本机或局域网')
    }
    const saved = await service.saveConfig({
      kind: 'openai_compatible', displayName: 'DNS内网', model: 'model', apiKey: 'key', baseUrl: 'https://custom.example.com/v1'
    })
    const privateResult = await service.validateConfig(saved.id)
    expect(privateResult).toMatchObject({ status: 'failed', lastError: '外部Provider域名解析到了本机或局域网地址' })
    expect(fetchMock).not.toHaveBeenCalled()

    const publicLookup = vi.fn<NonNullable<ConstructorParameters<typeof ExternalProviderConfigService>[3]>>().mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
    const { service: redirectService } = await createService(fetchMock, publicLookup)
    const redirectConfig = await redirectService.saveConfig({
      kind: 'openai_compatible', displayName: '重定向', model: 'model', apiKey: 'key', baseUrl: 'https://redirect.example.com/v1'
    })
    const redirectResult = await redirectService.validateConfig(redirectConfig.id)
    expect(redirectResult).toMatchObject({ status: 'failed', lastError: 'Provider返回了不允许的重定向' })
    expect((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).redirect).toBe('manual')
  })

  it('lets validation timeout release the mutation queue even when DNS lookup never settles', async () => {
    const hangingLookup = vi.fn<NonNullable<ConstructorParameters<typeof ExternalProviderConfigService>[3]>>()
      .mockImplementation(() => new Promise(() => undefined))
    const { service } = await createService(vi.fn<typeof fetch>(), hangingLookup)
    const saved = await service.saveConfig({
      kind: 'openai_compatible', displayName: '卡住的DNS', model: 'model', apiKey: 'key', baseUrl: 'https://slow.example.com/v1'
    })
    vi.useFakeTimers()
    try {
      const validation = service.validateConfig(saved.id)
      await Promise.resolve()
      await Promise.resolve()
      expect(hangingLookup).toHaveBeenCalledOnce()
      const rename = service.saveConfig({ id: saved.id, kind: saved.kind, displayName: '验证后改名', model: saved.model, baseUrl: saved.baseUrl })
      await vi.advanceTimersByTimeAsync(20_001)
      await expect(validation).resolves.toMatchObject({ status: 'failed', lastError: 'Provider连接超时' })
      await expect(rename).resolves.toMatchObject({ displayName: '验证后改名', status: 'unverified' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('serializes validation with concurrent edits so stale validation cannot overwrite the newer config', async () => {
    let finishValidation: ((response: Response) => void) | null = null
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { finishValidation = resolve }))
    const { service } = await createService(fetchMock)
    const saved = await service.saveConfig({ kind: 'deepseek_api', displayName: '原名称', model: 'deepseek-chat', apiKey: 'key' })
    const validation = service.validateConfig(saved.id)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const rename = service.saveConfig({ id: saved.id, kind: saved.kind, displayName: '并发后的名称', model: saved.model })
    finishValidation!(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }))
    await expect(validation).resolves.toMatchObject({ status: 'available' })
    await expect(rename).resolves.toMatchObject({ displayName: '并发后的名称', status: 'unverified' })
    expect((await service.getSettings()).configs).toEqual([expect.objectContaining({ displayName: '并发后的名称', status: 'unverified' })])
  })

  it('executes a validated external configuration with a frozen context and parses structured output', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }), { status: 200 }))
    const { service } = await createService(fetchMock)
    const saved = await service.saveConfig({ kind: 'deepseek_api', displayName: '选题AI', model: 'deepseek-chat', apiKey: 'private-key' })
    expect((await service.validateConfig(saved.id)).status).toBe('available')
    const context = await service.getExecutionContext(saved.id)
    const result = await service.executeStructured(context, '筛选输入', { type: 'object' }, new AbortController().signal)
    expect(result).toEqual({ ok: true })
    const executionRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(executionRequest.redirect).toBe('manual')
    expect(String(executionRequest.body)).toContain('json_object')
  })

  it('refuses a frozen execution context after the target endpoint changes and sends nothing to the new endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }))
    const publicLookup = vi.fn<NonNullable<ConstructorParameters<typeof ExternalProviderConfigService>[3]>>().mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
    const { service } = await createService(fetchMock, publicLookup)
    const saved = await service.saveConfig({
      kind: 'openai_compatible', displayName: '预检目标', model: 'model-a', apiKey: 'old-key', baseUrl: 'https://old.example.com/v1'
    })
    expect((await service.validateConfig(saved.id)).status).toBe('available')
    const frozen = await service.getExecutionContext(saved.id)
    await service.saveConfig({
      id: saved.id, kind: saved.kind, displayName: saved.displayName, model: 'model-b', apiKey: 'new-key', baseUrl: 'https://new.example.com/v1'
    })
    await expect(service.executeStructured(frozen, '不应发送', { type: 'object' }, new AbortController().signal))
      .rejects.toThrow('EXTERNAL_PROVIDER_UNAVAILABLE')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uses the Anthropic messages protocol and rejects malformed HTTP 2xx bodies with a stable error', async () => {
    const anthropicFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }), { status: 200 }))
    const { service } = await createService(anthropicFetch)
    const anthropic = await service.saveConfig({ kind: 'anthropic_api', displayName: 'Claude API', model: 'claude-test', apiKey: 'anthropic-key' })
    expect(await service.validateConfig(anthropic.id)).toMatchObject({ status: 'available', lastError: null })
    const [url, request] = anthropicFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    expect((request?.headers as Record<string, string>)['x-api-key']).toBe('anthropic-key')
    expect((request?.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')

    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>not an API</html>', { status: 200 }))
    const { service: invalidService } = await createService(invalidFetch)
    const invalid = await invalidService.saveConfig({ kind: 'openai_api', displayName: '假API', model: 'model', apiKey: 'key' })
    expect(await invalidService.validateConfig(invalid.id)).toMatchObject({ status: 'failed', lastError: 'Provider返回格式不符合所选协议' })
  })

  it('refuses to persist a key when macOS safe storage is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'creator-os-provider-no-security-'))
    directories.push(directory)
    const service = new ExternalProviderConfigService(join(directory, 'provider-configs.json'), {
      isAvailable: () => false,
      encrypt: () => { throw new Error('must not encrypt') },
      decrypt: () => { throw new Error('must not decrypt') }
    })
    expect((await service.getSettings()).securityAvailable).toBe(false)
    await expect(service.saveConfig({ kind: 'openai_api', displayName: 'OpenAI', model: 'model', apiKey: 'secret' })).rejects.toThrow('安全存储当前不可用')
  })

  it('stores only stable failure messages and manages explicit default/fallback routing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('raw provider secret response', { status: 401 }))
    const { service, path } = await createService(fetchMock)
    const first = await service.saveConfig({ kind: 'openai_api', displayName: 'OpenAI工作', model: 'model-a', apiKey: 'key-a' })
    const second = await service.saveConfig({ kind: 'anthropic_api', displayName: 'Claude API', model: 'model-b', apiKey: 'key-b' })
    await expect(service.setRouting(first.id, first.id)).rejects.toThrow('不能与默认AI相同')
    const routed = await service.setRouting(first.id, second.id)
    expect(routed).toMatchObject({ defaultProviderConfigId: first.id, fallbackProviderConfigId: second.id })
    const failed = await service.validateConfig(first.id)
    expect(failed).toMatchObject({ status: 'failed', lastError: 'API key无效或没有访问权限' })
    expect(await readFile(path, 'utf8')).not.toContain('raw provider secret response')
    await service.deleteConfig(first.id)
    expect(await service.getSettings()).toMatchObject({
      defaultProviderConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      fallbackProviderConfigId: second.id
    })
  })

  it('does not overwrite a corrupted provider config file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'creator-os-provider-corrupt-'))
    directories.push(directory)
    const path = join(directory, 'provider-configs.json')
    await mkdir(directory, { recursive: true })
    await writeFile(path, '{not-json', 'utf8')
    const protector: SecretProtector = { isAvailable: () => true, encrypt: (value) => value, decrypt: (value) => value }
    const service = new ExternalProviderConfigService(path, protector)
    await expect(service.getSettings()).rejects.toThrow('配置文件损坏')
    expect(await readFile(path, 'utf8')).toBe('{not-json')
  })
})
