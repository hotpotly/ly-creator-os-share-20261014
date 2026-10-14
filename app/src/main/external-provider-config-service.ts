import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { BlockList, isIP } from 'node:net'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  BUILTIN_TEXT_PROVIDER_CONFIG_IDS,
  EXTERNAL_PROVIDER_KINDS,
  type ExternalProviderConfig,
  type ExternalProviderConfigInput,
  type ExternalProviderKind,
  type ProviderSettings,
  type TextProviderExecutionContext
} from '../shared/domain'
import type { SecretProtector } from './mobile-sync-service'

const DEFAULT_BASE_URLS: Record<Exclude<ExternalProviderKind, 'openai_compatible'>, string> = {
  openai_api: 'https://api.openai.com/v1',
  anthropic_api: 'https://api.anthropic.com/v1',
  gemini_api: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek_api: 'https://api.deepseek.com'
}
const MAX_RESPONSE_BYTES = 1_000_000

const storedConfigSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(EXTERNAL_PROVIDER_KINDS),
  displayName: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  encryptedApiKey: z.string(),
  status: z.enum(['unverified', 'available', 'failed']),
  lastValidatedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()

const storeSchema = z.object({
  version: z.literal(1),
  defaultProviderConfigId: z.string(),
  fallbackProviderConfigId: z.string().nullable(),
  configs: z.array(storedConfigSchema)
}).strict()

type StoredConfig = z.infer<typeof storedConfigSchema>
type StoredProviderSettings = z.infer<typeof storeSchema>
type FetchImplementation = typeof fetch
type LookupImplementation = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: 4 | 6 }>>

const blockedIpv4Networks = new BlockList()
const blockedIpv6Networks = new BlockList()
const blockedIpv4Subnets = [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'], ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.0.0.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4']
] as const
for (const [network, prefix] of blockedIpv4Subnets) {
  blockedIpv4Networks.addSubnet(network, prefix, 'ipv4')
  blockedIpv6Networks.addSubnet(`::ffff:${network}`, 96 + prefix, 'ipv6')
}
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fec0::', 10], ['fe80::', 10], ['ff00::', 8]
] as const) blockedIpv6Networks.addSubnet(network, prefix, 'ipv6')

function emptyStore(): StoredProviderSettings {
  return {
    version: 1,
    defaultProviderConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
    fallbackProviderConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
    configs: []
  }
}

function normalizeBaseUrl(kind: ExternalProviderKind, candidate?: string): string {
  const raw = kind === 'openai_compatible' ? candidate?.trim() : DEFAULT_BASE_URLS[kind]
  if (!raw) throw new Error('OpenAI兼容Provider必须填写API地址')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('API地址格式无效') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API地址必须是不含账号、查询参数的HTTPS地址')
  const hostname = url.hostname.toLowerCase()
  const literalHost = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (isIP(literalHost) !== 0 && isBlockedAddress(literalHost))) {
    throw new Error('外部Provider不能使用本机或局域网地址')
  }
  return url.toString().replace(/\/+$/, '')
}

function isBlockedAddress(address: string): boolean {
  const mappedIpv4 = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return blockedIpv4Networks.check(mappedIpv4, 'ipv4')
  const family = isIP(address)
  return family === 4 ? blockedIpv4Networks.check(address, 'ipv4') : family === 6 ? blockedIpv6Networks.check(address, 'ipv6') : true
}

function abortError(): Error {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}

async function waitForLookup(
  operation: Promise<Array<{ address: string; family: 4 | 6 }>>,
  signal?: AbortSignal
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  if (!signal) return operation
  if (signal.aborted) throw abortError()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => { cleanup(); resolve(value) },
      (error: unknown) => { cleanup(); reject(error) }
    )
  })
}

function publicConfig(config: StoredConfig): ExternalProviderConfig {
  return {
    id: config.id,
    kind: config.kind,
    displayName: config.displayName,
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.encryptedApiKey),
    status: config.status,
    lastValidatedAt: config.lastValidatedAt,
    lastError: config.lastError,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  }
}

function providerRequest(config: StoredConfig, apiKey: string, signal: AbortSignal): { url: string; init: RequestInit } {
  if (config.kind === 'anthropic_api') {
    return {
      url: `${config.baseUrl}/messages`,
      init: {
        method: 'POST',
        signal,
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8,
          messages: [{ role: 'user', content: '只回复OK' }]
        })
      }
    }
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      signal,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(config.kind === 'gemini_api' ? { 'x-goog-api-client': 'ly-creator-os/0.1.0' } : {})
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: '只输出JSON对象：{"ok":true}' }],
        response_format: { type: 'json_object' }
      })
    }
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Provider响应过大')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Provider响应过大')
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(combined)
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function validationFailure(status: number): string {
  if (status === 401 || status === 403) return 'API key无效或没有访问权限'
  if (status === 404) return 'API地址或模型不存在'
  if (status === 408 || status === 429) return 'Provider暂时限流或超时'
  return `Provider连接失败（HTTP ${status}）`
}

function stableValidationError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Provider连接超时'
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'Provider返回格式不符合所选协议'
  const message = error instanceof Error ? error.message : ''
  if (/^(?:API key无效或没有访问权限|API地址或模型不存在|Provider暂时限流或超时|Provider连接失败（HTTP \d+）|Provider响应过大|Provider返回了不允许的重定向|外部Provider域名无法解析|外部Provider域名解析到了本机或局域网地址|外部Provider不能使用本机或局域网地址)$/.test(message)) return message
  return 'Provider连接失败'
}

export class ExternalProviderConfigService {
  private state: StoredProviderSettings | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
    private readonly fetchImpl: FetchImplementation = fetch,
    private readonly lookupImpl: LookupImplementation = (hostname, options) => lookup(hostname, options) as Promise<Array<{ address: string; family: 4 | 6 }>>
  ) {}

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release = (): void => undefined
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }

  private async assertPublicCustomEndpoint(baseUrl: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError()
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
    if (isIP(hostname)) {
      if (isBlockedAddress(hostname)) throw new Error('外部Provider不能使用本机或局域网地址')
      return
    }
    let addresses: Awaited<ReturnType<LookupImplementation>>
    try {
      addresses = await waitForLookup(this.lookupImpl(hostname, { all: true, verbatim: true }), signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error('外部Provider域名无法解析')
    }
    if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) throw new Error('外部Provider域名解析到了本机或局域网地址')
  }

  private async load(): Promise<StoredProviderSettings> {
    if (this.state) return this.state
    try {
      const parsed = storeSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
      this.state = parsed
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : null
      if (code !== 'ENOENT') throw new Error('外部Provider配置文件损坏，未覆盖原文件')
      this.state = emptyStore()
    }
    return this.state
  }

  private async persist(state: StoredProviderSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, this.filePath)
    await chmod(this.filePath, 0o600)
    this.state = state
  }

  async getSettings(): Promise<ProviderSettings> {
    const state = await this.load()
    return {
      securityAvailable: this.protector.isAvailable(),
      configs: state.configs.map(publicConfig),
      defaultProviderConfigId: state.defaultProviderConfigId,
      fallbackProviderConfigId: state.fallbackProviderConfigId
    }
  }

  async saveConfig(input: ExternalProviderConfigInput): Promise<ExternalProviderConfig> {
    return this.withMutationLock(() => this.saveConfigUnlocked(input))
  }

  private async saveConfigUnlocked(input: ExternalProviderConfigInput): Promise<ExternalProviderConfig> {
    if (!this.protector.isAvailable()) throw new Error('macOS安全存储当前不可用，不能保存API key')
    const state = await this.load()
    const existing = input.id ? state.configs.find((config) => config.id === input.id) : undefined
    if (input.id && !existing) throw new Error('外部Provider配置不存在')
    const displayName = input.displayName.trim()
    const model = input.model.trim()
    if (!displayName || displayName.length > 80) throw new Error('Provider名称长度无效')
    if (!model || model.length > 160) throw new Error('模型名称长度无效')
    const apiKey = input.apiKey?.trim()
    if (!existing && !apiKey) throw new Error('首次保存必须填写API key')
    if (apiKey && apiKey.length > 8_000) throw new Error('API key长度无效')
    const baseUrl = normalizeBaseUrl(input.kind, input.baseUrl)
    if (existing && !apiKey && (existing.kind !== input.kind || existing.baseUrl !== baseUrl)) {
      throw new Error('修改Provider类型或API地址时必须重新填写API key')
    }
    const timestamp = new Date().toISOString()
    const next: StoredConfig = {
      id: existing?.id ?? randomUUID(),
      kind: input.kind,
      displayName,
      baseUrl,
      model,
      encryptedApiKey: apiKey ? this.protector.encrypt(apiKey) : existing!.encryptedApiKey,
      status: 'unverified',
      lastValidatedAt: null,
      lastError: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const configs = existing ? state.configs.map((config) => config.id === existing.id ? next : config) : [...state.configs, next]
    await this.persist({ ...state, configs })
    return publicConfig(next)
  }

  async deleteConfig(id: string): Promise<boolean> {
    return this.withMutationLock(() => this.deleteConfigUnlocked(id))
  }

  private async deleteConfigUnlocked(id: string): Promise<boolean> {
    const state = await this.load()
    if (!state.configs.some((config) => config.id === id)) throw new Error('外部Provider配置不存在')
    await this.persist({
      ...state,
      configs: state.configs.filter((config) => config.id !== id),
      defaultProviderConfigId: state.defaultProviderConfigId === id ? BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex : state.defaultProviderConfigId,
      fallbackProviderConfigId: state.fallbackProviderConfigId === id ? null : state.fallbackProviderConfigId
    })
    return true
  }

  async setRouting(defaultProviderConfigId: string, fallbackProviderConfigId: string | null): Promise<ProviderSettings> {
    return this.withMutationLock(() => this.setRoutingUnlocked(defaultProviderConfigId, fallbackProviderConfigId))
  }

  private async setRoutingUnlocked(defaultProviderConfigId: string, fallbackProviderConfigId: string | null): Promise<ProviderSettings> {
    const state = await this.load()
    const validIds = new Set([
      BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude,
      ...state.configs.map((config) => config.id)
    ])
    if (!validIds.has(defaultProviderConfigId) || (fallbackProviderConfigId && !validIds.has(fallbackProviderConfigId))) throw new Error('所选Provider配置不存在')
    if (fallbackProviderConfigId === defaultProviderConfigId) throw new Error('备用AI不能与默认AI相同')
    await this.persist({ ...state, defaultProviderConfigId, fallbackProviderConfigId })
    return this.getSettings()
  }

  async validateConfig(id: string): Promise<ExternalProviderConfig> {
    return this.withMutationLock(() => this.validateConfigUnlocked(id))
  }

  private async validateConfigUnlocked(id: string): Promise<ExternalProviderConfig> {
    const state = await this.load()
    const config = state.configs.find((candidate) => candidate.id === id)
    if (!config) throw new Error('外部Provider配置不存在')
    if (!this.protector.isAvailable()) throw new Error('macOS安全存储当前不可用，不能读取API key')
    let apiKey: string
    try { apiKey = this.protector.decrypt(config.encryptedApiKey) } catch { throw new Error('API key无法解密，请重新保存') }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    let status: StoredConfig['status'] = 'failed'
    let lastError: string | null = null
    try {
      if (config.kind === 'openai_compatible') await this.assertPublicCustomEndpoint(config.baseUrl, controller.signal)
      const request = providerRequest(config, apiKey, controller.signal)
      const response = await this.fetchImpl(request.url, request.init)
      if (response.status >= 300 && response.status < 400) throw new Error('Provider返回了不允许的重定向')
      if (!response.ok) throw new Error(validationFailure(response.status))
      const body = JSON.parse(await readBoundedResponse(response)) as unknown
      if (config.kind === 'anthropic_api') {
        z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string().min(1) })).min(1) }).parse(body)
      } else {
        const protocol = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1) }).parse(body)
        z.record(z.string(), z.unknown()).parse(JSON.parse(stripJsonFence(protocol.choices[0]!.message.content)))
      }
      status = 'available'
    } catch (error) {
      lastError = stableValidationError(error)
    } finally {
      clearTimeout(timer)
      apiKey = ''
    }
    const timestamp = new Date().toISOString()
    const next = { ...config, status, lastValidatedAt: timestamp, lastError, updatedAt: timestamp }
    await this.persist({ ...state, configs: state.configs.map((candidate) => candidate.id === id ? next : candidate) })
    return publicConfig(next)
  }

  async getExecutionContext(id: string): Promise<Extract<TextProviderExecutionContext, { provider: 'external_api' }>> {
    const state = await this.load()
    const config = state.configs.find((candidate) => candidate.id === id)
    if (!config) throw new Error('外部Provider配置不存在')
    if (config.status !== 'available') throw new Error('外部Provider必须先在设置中验证连接')
    return {
      provider: 'external_api',
      providerConfigId: config.id,
      displayName: config.displayName,
      kind: config.kind,
      baseUrl: config.baseUrl,
      model: config.model,
      configurationUpdatedAt: config.updatedAt
    }
  }

  async executeStructured(
    context: Extract<TextProviderExecutionContext, { provider: 'external_api' }>,
    prompt: string,
    outputSchema: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<unknown> {
    const state = await this.load()
    const config = state.configs.find((candidate) => candidate.id === context.providerConfigId)
    if (!config || config.status !== 'available') throw new Error('EXTERNAL_PROVIDER_UNAVAILABLE')
    if (config.updatedAt !== context.configurationUpdatedAt || config.kind !== context.kind || config.baseUrl !== context.baseUrl || config.model !== context.model) {
      throw new Error('EXTERNAL_PROVIDER_CONFIG_CHANGED')
    }
    if (!this.protector.isAvailable()) throw new Error('EXTERNAL_PROVIDER_KEY_UNAVAILABLE')
    if (config.kind === 'openai_compatible') await this.assertPublicCustomEndpoint(config.baseUrl, signal)
    let apiKey = ''
    try {
      apiKey = this.protector.decrypt(config.encryptedApiKey)
      const schemaInstruction = `严格只输出符合以下JSON Schema的JSON对象，不要使用Markdown代码块：\n${JSON.stringify(outputSchema)}`
      const request = config.kind === 'anthropic_api'
        ? {
            url: `${config.baseUrl}/messages`,
            init: {
              method: 'POST',
              signal,
              redirect: 'manual' as const,
              headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model: config.model, max_tokens: 20_000, messages: [{ role: 'user', content: `${prompt}\n\n${schemaInstruction}` }] })
            }
          }
        : {
            url: `${config.baseUrl}/chat/completions`,
            init: {
              method: 'POST',
              signal,
              redirect: 'manual' as const,
              headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: config.model,
                max_tokens: 20_000,
                messages: [{ role: 'system', content: schemaInstruction }, { role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
              })
            }
          }
      const response = await this.fetchImpl(request.url, request.init)
      if (response.status >= 300 && response.status < 400) throw new Error('EXTERNAL_PROVIDER_REDIRECT_BLOCKED')
      if (!response.ok) throw new Error(`EXTERNAL_PROVIDER_HTTP_${response.status}`)
      const raw = JSON.parse(await readBoundedResponse(response)) as unknown
      const content = config.kind === 'anthropic_api'
        ? z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1) }).parse(raw).content.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('')
        : z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).parse(raw).choices[0]!.message.content
      return JSON.parse(stripJsonFence(content)) as unknown
    } catch (error) {
      if (error instanceof Error && /^(EXTERNAL_PROVIDER_|Provider响应过大)/.test(error.message)) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new Error('TASK_CANCELED')
      throw new Error('EXTERNAL_PROVIDER_OUTPUT_INVALID')
    } finally {
      apiKey = ''
    }
  }
}
