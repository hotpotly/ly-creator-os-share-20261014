import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, copyFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import type { ScriptRevisionWebSearchRecord, ScriptRevisionWebSearchMode } from '../shared/domain'

export type CliProviderKind = 'codex_cli' | 'claude_cli'

export const PROVIDER_SECURITY_POLICY_VERSION = 'cli-sandbox-v2'
export const IMAGE_PROVIDER_SECURITY_POLICY_VERSION = 'image-cli-sandbox-v1'
export const CODEX_IMAGE_FEATURE_ARGUMENTS = [
  '--enable', 'image_generation',
  '--disable', 'shell_tool',
  '--disable', 'unified_exec',
  '--disable', 'apps',
  '--disable', 'browser_use',
  '--disable', 'computer_use',
  '--disable', 'hooks',
  '--disable', 'multi_agent',
  '--disable', 'plugins',
  '--disable', 'skill_mcp_dependency_install',
  '--disable', 'standalone_web_search'
] as const
export const CHATGPT_CODEX_EXECUTABLE = '/Applications/ChatGPT.app/Contents/Resources/codex'
export const PROVIDER_CANDIDATES: Record<CliProviderKind, readonly string[]> = {
  codex_cli: [CHATGPT_CODEX_EXECUTABLE, '/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(homedir(), '.local', 'bin', 'codex')],
  claude_cli: [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
}

const TRUSTED_EXECUTABLE_ROOTS = ['/Applications/ChatGPT.app/Contents/Resources', '/opt/homebrew', '/usr/local', join(homedir(), '.local')]
const CODEX_DISABLED_FEATURES = [
  'apps', 'browser_use', 'computer_use', 'hooks', 'image_generation', 'multi_agent', 'plugins',
  'shell_tool', 'skill_mcp_dependency_install', 'standalone_web_search', 'unified_exec'
] as const
const MAX_OUTPUT_BYTES = 1_000_000

export interface ProviderExecutableInfo {
  provider: CliProviderKind
  executablePath: string
  version: string
  fingerprint: string
}

export interface ProviderInvocationResult {
  structuredOutput: unknown
  rawOutput: string
  providerThreadId?: string | null
  model?: string | null
  reasoningEffort?: string | null
  webSearches?: ScriptRevisionWebSearchRecord[]
}

export interface ProviderInvocationOptions {
  provider: ProviderExecutableInfo
  taskDirectory: string
  prompt: string
  imagePaths?: string[]
  webSearchMode?: ScriptRevisionWebSearchMode
  preferredModel?: string | null
  preferredReasoningEffort?: string | null
  outputSchema: Record<string, unknown>
  timeoutMilliseconds: number
  signal?: AbortSignal
  onSpawn?(child: ChildProcessWithoutNullStreams): void
}

function isTrustedPath(path: string): boolean {
  return TRUSTED_EXECUTABLE_ROOTS.some((root) => path === root || path.startsWith(`${root}${sep}`))
}

function commandVersion(executablePath: string): Promise<string> {
  return new Promise((resolveVersion, reject) => {
    const child = spawn(executablePath, ['--version'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('PROVIDER_VERSION_TIMEOUT')) }, 5_000)
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) { reject(new Error('PROVIDER_VERSION_FAILED')); return }
      const version = output.trim().replace(/\s+/g, ' ').slice(0, 160)
      if (!version) { reject(new Error('PROVIDER_VERSION_EMPTY')); return }
      resolveVersion(version)
    })
  })
}

async function resolveCodexNative(wrapperPath: string): Promise<string> {
  if (!wrapperPath.endsWith(`${sep}bin${sep}codex.js`)) return wrapperPath
  const packageRoot = resolve(dirname(wrapperPath), '..')
  const platformDirectory = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  const packageName = process.arch === 'arm64' ? 'codex-darwin-arm64' : 'codex-darwin-x64'
  const nativePath = resolve(packageRoot, 'node_modules', '@openai', packageName, 'vendor', platformDirectory, 'bin', 'codex')
  await access(nativePath, constants.X_OK)
  return realpath(nativePath)
}

export function providerInvocationSignature(provider: CliProviderKind): string {
  if (provider === 'codex_cli') {
    return JSON.stringify({
      policy: PROVIDER_SECURITY_POLICY_VERSION,
      command: ['exec', '--sandbox=read-only', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config', '--output-schema'],
      disabledFeatures: CODEX_DISABLED_FEATURES
    })
  }
  return JSON.stringify({
    policy: PROVIDER_SECURITY_POLICY_VERSION,
    command: ['--print', '--output-format=stream-json', '--verbose', '--json-schema', '--permission-mode=dontAsk', '--tools=WebSearch,WebFetch|', '--no-session-persistence', '--safe-mode', '--strict-mcp-config']
  })
}

export function imageProviderInvocationSignature(): string {
  return JSON.stringify({
    policy: IMAGE_PROVIDER_SECURITY_POLICY_VERSION,
    command: ['exec', '--sandbox=workspace-write', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config'],
    featureArguments: CODEX_IMAGE_FEATURE_ARGUMENTS,
    outputRoot: 'CODEX_HOME/generated_images',
    outerSandbox: 'seatbelt-task-directory-only'
  })
}

export function imageProviderFingerprint(provider: ProviderExecutableInfo): string {
  return createHash('sha256').update(JSON.stringify({
    provider: provider.provider,
    executablePath: provider.executablePath,
    version: provider.version,
    invocation: imageProviderInvocationSignature()
  })).digest('hex')
}

export async function inspectProviderExecutable(provider: CliProviderKind, candidates: readonly string[] = PROVIDER_CANDIDATES[provider]): Promise<ProviderExecutableInfo | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      const candidateInfo = await stat(candidate)
      if (!candidateInfo.isFile()) continue
      const canonical = await realpath(candidate)
      if (!isTrustedPath(canonical)) continue
      const executablePath = provider === 'codex_cli' ? await resolveCodexNative(canonical) : canonical
      if (!isTrustedPath(executablePath)) continue
      const executableInfo = await stat(executablePath)
      if (!executableInfo.isFile()) continue
      const version = await commandVersion(executablePath)
      const fingerprint = createHash('sha256').update(JSON.stringify({ provider, executablePath, version, invocation: providerInvocationSignature(provider) })).digest('hex')
      return { provider, executablePath, version, fingerprint }
    } catch { /* try the next trusted candidate */ }
  }
  return null
}

function seatbeltLiteral(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function buildProviderSandboxProfile(provider: ProviderExecutableInfo, taskDirectory: string): string {
  const executableParent = provider.provider === 'claude_cli' ? resolve(dirname(provider.executablePath), '..') : '/opt/homebrew'
  const processExecutables = [
    `(literal ${seatbeltLiteral(provider.executablePath)})`,
    ...(provider.provider === 'claude_cli' ? ['(literal "/usr/bin/security")'] : [])
  ].join(' ')
  const providerReads = provider.provider === 'claude_cli'
    ? `(subpath ${seatbeltLiteral(executableParent)}) (literal ${seatbeltLiteral(join(homedir(), '.claude.json'))}) (subpath ${seatbeltLiteral(join(homedir(), 'Library', 'Keychains'))})`
    : provider.executablePath.startsWith('/Applications/ChatGPT.app/Contents/Resources/')
      ? `(subpath "/Applications/ChatGPT.app/Contents/Resources")`
      : `(subpath "/opt/homebrew")`
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    '(allow process-info*)',
    `(allow process-exec ${processExecutables})`,
    '(allow signal)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix*)',
    '(allow network-outbound)',
    '(allow system-socket)',
    '(allow user-preference-read)',
    '(allow file-read-metadata)',
    '(allow file-read-data (literal "/"))',
    `(allow file-read* (subpath "/System") (subpath "/usr") (subpath "/Library") (subpath "/private/etc") (subpath "/private/var") (subpath "/dev") (subpath ${seatbeltLiteral(taskDirectory)}) ${providerReads})`,
    `(allow file-write* (subpath ${seatbeltLiteral(taskDirectory)}) (literal "/dev/null") (literal "/dev/dtracehelper"))`
  ].join('')
}

function providerArguments(provider: ProviderExecutableInfo, schemaPath: string, outputSchema: Record<string, unknown>, options: ProviderInvocationOptions): string[] {
  if (provider.provider === 'codex_cli') {
    return [
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config',
      ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
      ...(options.imagePaths ?? []).flatMap((path) => ['--image', path]),
      '--color', 'never', '--output-schema', schemaPath, '-'
    ]
  }
  const webEnabled = (options.webSearchMode ?? 'disabled') !== 'disabled'
  const model = options.preferredModel && options.preferredModel !== 'auto' ? options.preferredModel : null
  return [
    '--print', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(outputSchema), '--permission-mode', 'dontAsk',
    '--tools', webEnabled ? 'WebSearch,WebFetch' : '',
    ...(webEnabled ? ['--allowedTools', 'WebSearch,WebFetch'] : []),
    ...(model ? ['--model', model] : []),
    '--effort', options.preferredReasoningEffort ?? 'max',
    '--disable-slash-commands', '--no-session-persistence', '--no-chrome', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--prompt-suggestions', 'false'
  ]
}

export async function prepareProviderEnvironment(provider: ProviderExecutableInfo, taskDirectory: string): Promise<NodeJS.ProcessEnv> {
  const common: NodeJS.ProcessEnv = {
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    LANG: process.env.LANG ?? 'zh_CN.UTF-8',
    PATH: '/usr/bin:/bin',
    TMPDIR: taskDirectory,
    NO_COLOR: '1',
    CI: '1'
  }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    if (process.env[key]) common[key] = process.env[key]
  }
  if (provider.provider === 'claude_cli') return { ...common, HOME: homedir() }
  const codexHome = join(taskDirectory, '.provider-auth')
  await mkdir(codexHome, { recursive: true, mode: 0o700 })
  try {
    await copyFile(join(homedir(), '.codex', 'auth.json'), join(codexHome, 'auth.json'), constants.COPYFILE_EXCL)
    await chmod(join(codexHome, 'auth.json'), 0o600)
  } catch { throw new Error('PROVIDER_NOT_AUTHENTICATED') }
  return { ...common, HOME: taskDirectory, CODEX_HOME: codexHome }
}

function parseJsonCandidate(value: string): unknown {
  const trimmed = value.trim()
  try { return JSON.parse(trimmed) } catch { /* scan the final JSON line */ }
  for (const line of trimmed.split('\n').reverse()) {
    try { return JSON.parse(line) } catch { /* keep scanning */ }
  }
  throw new Error('PROVIDER_OUTPUT_INVALID_JSON')
}

export function parseStructuredProviderOutput(
  provider: CliProviderKind,
  stdout: string,
  observedAtByRuntimeAccessId: ReadonlyMap<string, string> = new Map()
): ProviderInvocationResult {
  const parsed = parseJsonCandidate(stdout)
  if (provider === 'claude_cli') {
    const events = stdout.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as Record<string, unknown>] } catch { return [] }
    })
    const envelope = [...events].reverse().find((event) => event.type === 'result') ?? parsed
    if (!envelope || typeof envelope !== 'object') throw new Error('PROVIDER_OUTPUT_INVALID_JSON')
    const resultEnvelope = envelope as {
      is_error?: unknown
      result?: unknown
      structured_output?: unknown
      session_id?: unknown
      modelUsage?: unknown
    }
    if (resultEnvelope.is_error === true) {
      const result = typeof resultEnvelope.result === 'string' ? resultEnvelope.result : ''
      if (/not logged in/i.test(result)) throw new Error('PROVIDER_NOT_AUTHENTICATED')
      throw new Error('PROVIDER_RESPONSE_ERROR')
    }
    const structuredOutput = resultEnvelope.structured_output
      ?? (typeof resultEnvelope.result === 'string' ? parseJsonCandidate(resultEnvelope.result) : resultEnvelope.result)
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init')
    const modelUsage = resultEnvelope.modelUsage && typeof resultEnvelope.modelUsage === 'object'
      ? Object.keys(resultEnvelope.modelUsage as Record<string, unknown>)
      : []
    const cleanModel = (value: unknown): string | null => typeof value === 'string'
      ? value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu'), '').replace(/\[[0-9;]*m/gu, '').trim() || null
      : null
    const model = cleanModel(init?.model) ?? cleanModel(modelUsage.length === 1 ? modelUsage[0] : null)
    const webSearches: ScriptRevisionWebSearchRecord[] = []
    const eventObservedAt = (event: Record<string, unknown>): string | null => {
      for (const candidate of [event.timestamp, event.created_at, event.createdAt]) {
        if (typeof candidate === 'string' && !Number.isNaN(Date.parse(candidate))) return candidate
      }
      return null
    }
    const toolUseNames = new Map<string, { name: string; query: string | null; url: string | null; observedAt: string | null }>()
    const pushToolUses = (content: unknown, event: Record<string, unknown>): void => {
      if (!Array.isArray(content)) return
      for (const item of content) {
        if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'tool_use') continue
        const tool = item as { id?: unknown; name?: unknown; input?: unknown }
        if (typeof tool.id !== 'string' || !['WebSearch', 'WebFetch'].includes(String(tool.name))) continue
        const input = tool.input && typeof tool.input === 'object' ? tool.input as Record<string, unknown> : {}
        const url = typeof input.url === 'string' ? input.url : null
        const query = typeof input.query === 'string' ? input.query : null
        const observedAt = observedAtByRuntimeAccessId.get(tool.id) ?? eventObservedAt(event)
        toolUseNames.set(tool.id, { name: String(tool.name), query, url, observedAt })
        if (tool.name === 'WebSearch') webSearches.push({
          type: 'search', query, url: null, runtimeAccessId: tool.id, accessedAt: observedAt
        })
      }
    }
    for (const event of events) {
      const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : null
      pushToolUses(message?.content, event)
      const content = message?.content
      if (!Array.isArray(content)) continue
      for (const item of content) {
        if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'tool_result') continue
        const toolResult = item as { tool_use_id?: unknown; content?: unknown; is_error?: unknown }
        if (typeof toolResult.tool_use_id !== 'string' || !toolUseNames.has(toolResult.tool_use_id)) continue
        if (toolResult.is_error === true) continue
        const toolUseId = toolResult.tool_use_id
        const toolUse = toolUseNames.get(toolUseId)!
        const observedAt = observedAtByRuntimeAccessId.get(toolUseId) ?? eventObservedAt(event) ?? toolUse.observedAt
        const serialized = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)
        const urls = [...new Set([
          ...(toolUse.name === 'WebFetch' && toolUse.url ? [toolUse.url] : []),
          ...(serialized.match(/https:\/\/[^\s"'<>\])}]+/gu) ?? []).map((url) => url.replace(/[，。；！？]+$/gu, ''))
        ])]
        urls.forEach((url) => webSearches.push({
          type: toolUse.name === 'WebFetch' ? 'open_page' : 'search', query: toolUse.query, url,
          runtimeAccessId: toolUseId, accessedAt: observedAt
        }))
      }
    }
    return {
      structuredOutput,
      rawOutput: stdout,
      providerThreadId: typeof resultEnvelope.session_id === 'string' ? resultEnvelope.session_id : typeof init?.session_id === 'string' ? init.session_id : null,
      model,
      reasoningEffort: null,
      webSearches
    }
  }
  return { structuredOutput: parsed, rawOutput: stdout, providerThreadId: null, model: null, reasoningEffort: null, webSearches: [] }
}

function failureCode(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  if (/not logged in|please run \/login|authentication required/i.test(stderr)) return 'PROVIDER_NOT_AUTHENTICATED'
  if (/operation not permitted|sandbox/i.test(stderr)) return 'PROVIDER_SANDBOX_DENIED'
  return `PROVIDER_EXIT_${code ?? signal ?? 'UNKNOWN'}`
}

export function runProviderInvocation(options: ProviderInvocationOptions): Promise<ProviderInvocationResult> {
  return new Promise((resolveInvocation, reject) => {
    let child: ChildProcessWithoutNullStreams | null = null
    let timeout: NodeJS.Timeout | null = null
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      action()
    }
    const abort = (): void => {
      child?.kill('SIGTERM')
      finish(() => reject(new Error('TASK_CANCELED')))
    }
    void (async () => {
      await mkdir(options.taskDirectory, { recursive: true, mode: 0o700 })
      const schemaPath = join(options.taskDirectory, 'output-schema.json')
      await writeFile(schemaPath, JSON.stringify(options.outputSchema), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      const env = await prepareProviderEnvironment(options.provider, options.taskDirectory)
      if (options.signal?.aborted) { abort(); return }
      const profile = buildProviderSandboxProfile(options.provider, options.taskDirectory)
      child = spawn('/usr/bin/sandbox-exec', ['-p', profile, options.provider.executablePath, ...providerArguments(options.provider, schemaPath, options.outputSchema, options)], {
        cwd: options.taskDirectory,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      })
      options.onSpawn?.(child)
      options.signal?.addEventListener('abort', abort, { once: true })
      timeout = setTimeout(() => { child?.kill('SIGKILL'); finish(() => reject(new Error('TASK_TIMEOUT'))) }, options.timeoutMilliseconds)
      let stdout = ''; let stderr = ''; let outputBytes = 0
      let claudeLineBuffer = ''
      const runtimeAccessObservedAt = new Map<string, string>()
      const observeClaudeEvents = (text: string): void => {
        if (options.provider.provider !== 'claude_cli') return
        claudeLineBuffer += text
        const lines = claudeLineBuffer.split('\n')
        claudeLineBuffer = lines.pop() ?? ''
        const observedAt = new Date().toISOString()
        lines.forEach((line) => {
          try {
            const event = JSON.parse(line) as Record<string, unknown>
            const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : null
            const content = Array.isArray(message?.content) ? message.content : []
            content.forEach((item) => {
              if (!item || typeof item !== 'object') return
              const record = item as { type?: unknown; id?: unknown; tool_use_id?: unknown }
              const runtimeAccessId = record.type === 'tool_result' ? record.tool_use_id : record.type === 'tool_use' ? record.id : null
              if (typeof runtimeAccessId === 'string') runtimeAccessObservedAt.set(runtimeAccessId, observedAt)
            })
          } catch { /* incomplete or non-JSON lines cannot provide runtime access evidence */ }
        })
      }
      const append = (current: string, chunk: Buffer): string => {
        outputBytes += chunk.byteLength
        if (outputBytes > MAX_OUTPUT_BYTES) { child?.kill('SIGKILL'); finish(() => reject(new Error('PROVIDER_OUTPUT_TOO_LARGE'))); return current }
        return current + chunk.toString('utf8')
      }
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        observeClaudeEvents(text)
        stdout = append(stdout, chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
      child.once('error', () => finish(() => reject(new Error('PROVIDER_START_FAILED'))))
      child.once('exit', (code, signal) => {
        if (settled) return
        if (code !== 0) { finish(() => reject(new Error(failureCode(stderr, code, signal)))); return }
        try {
          if (claudeLineBuffer) observeClaudeEvents('\n')
          const result = parseStructuredProviderOutput(options.provider.provider, stdout, runtimeAccessObservedAt)
          finish(() => resolveInvocation(result))
        } catch (error) { finish(() => reject(error)) }
      })
      child.stdin.end(options.prompt)
    })().catch((error: unknown) => finish(() => reject(error instanceof Error ? error : new Error('PROVIDER_START_FAILED'))))
  })
}
