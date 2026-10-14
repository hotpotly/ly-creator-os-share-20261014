import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { ScriptRevisionWebSearchMode, ScriptRevisionWebSearchRecord } from '../shared/domain'
import type { ProviderExecutableInfo } from './provider-execution'

const MAX_PROTOCOL_BYTES = 4_000_000
const MODEL_PREFERENCE = ['gpt-5.6-sol', 'gpt-5.6', 'gpt-5.5', 'gpt-5.4', 'gpt-5'] as const
const REASONING_PREFERENCE = ['ultra', 'max', 'xhigh', 'high', 'medium', 'low', 'none'] as const
const DISABLED_FEATURES = [
  'apps',
  'browser_use',
  'computer_use',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'memories',
  'multi_agent',
  'plugins',
  'request_permissions_tool',
  'shell_tool',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'unified_exec',
  'workspace_dependencies'
] as const
const DISALLOWED_ITEM_TYPES = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'subAgentActivity',
  'imageView',
  'imageGeneration'
])

interface RpcResponse {
  id?: number
  method?: string
  result?: unknown
  error?: { code?: number; message?: string }
  params?: unknown
}

export interface CodexModel {
  id: string
  model: string
  displayName?: string
  isDefault: boolean
  hidden: boolean
  defaultReasoningEffort: string
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>
}

interface ThreadStartResult {
  thread: { id: string }
  model: string
  reasoningEffort: string | null
}

interface TurnItem {
  id?: string
  type: string
  text?: string
  phase?: string | null
  query?: string
  action?: {
    type?: string
    query?: string | null
    queries?: string[] | null
    url?: string | null
    pattern?: string | null
  } | null
  observedAt?: string
}

interface TurnResult {
  id: string
  status: string
  error?: { message?: string } | null
  items: TurnItem[]
}

export interface CodexWritingTurnOptions {
  provider: ProviderExecutableInfo
  taskDirectory: string
  stateDirectory: string
  providerThreadId: string | null
  preferredModel?: string | null
  preferredReasoningEffort?: string | null
  webSearchMode: ScriptRevisionWebSearchMode
  developerInstructions: string
  buildInput(includeBootstrapHistory: boolean): string
  localImagePaths?: string[]
  outputSchema?: Record<string, unknown>
  persistThread?: boolean
  timeoutMilliseconds: number
  signal?: AbortSignal
  onProgress?(progress: number): void
}

export interface CodexWritingTurnResult {
  finalText: string
  providerThreadId: string
  model: string
  reasoningEffort: string
  webSearchMode: ScriptRevisionWebSearchMode
  webSearches: ScriptRevisionWebSearchRecord[]
}

function seatbeltLiteral(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function buildCodexWritingSandboxProfile(provider: ProviderExecutableInfo, taskDirectory: string, stateDirectory: string): string {
  const providerDirectory = dirname(provider.executablePath)
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    '(allow process-info*)',
    `(allow process-exec (literal ${seatbeltLiteral(provider.executablePath)}))`,
    '(allow signal)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix*)',
    '(allow network-outbound)',
    '(allow system-socket)',
    '(allow user-preference-read)',
    '(allow file-read-metadata)',
    '(allow file-read-data (literal "/"))',
    `(allow file-read* (subpath "/System") (subpath "/usr") (subpath "/Library") (subpath "/private/etc") (subpath "/private/var") (subpath "/dev") (subpath "/opt/homebrew") (subpath ${seatbeltLiteral(providerDirectory)}) (subpath ${seatbeltLiteral(taskDirectory)}) (subpath ${seatbeltLiteral(stateDirectory)}))`,
    `(allow file-write* (subpath ${seatbeltLiteral(taskDirectory)}) (subpath ${seatbeltLiteral(stateDirectory)}) (literal "/dev/null") (literal "/dev/dtracehelper"))`
  ].join('')
}

async function prepareCodexWritingEnvironment(taskDirectory: string, stateDirectory: string): Promise<NodeJS.ProcessEnv> {
  await mkdir(taskDirectory, { recursive: true, mode: 0o700 })
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const sourceAuth = resolve(homedir(), '.codex', 'auth.json')
  const targetAuth = resolve(stateDirectory, 'auth.json')
  try {
    await access(sourceAuth, constants.R_OK)
    await copyFile(sourceAuth, targetAuth)
    await chmod(targetAuth, 0o600)
  } catch {
    throw new Error('PROVIDER_NOT_AUTHENTICATED')
  }
  const env: NodeJS.ProcessEnv = {
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    LANG: process.env.LANG ?? 'zh_CN.UTF-8',
    PATH: '/usr/bin:/bin',
    HOME: taskDirectory,
    CODEX_HOME: stateDirectory,
    TMPDIR: taskDirectory,
    NO_COLOR: '1',
    CI: '1'
  }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

export function buildCodexWritingAppServerArguments(webSearchMode: ScriptRevisionWebSearchMode): string[] {
  return [
    'app-server',
    '--stdio',
    '--strict-config',
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    '--enable',
    'standalone_web_search',
    '-c',
    `web_search="${webSearchMode === 'disabled' ? 'disabled' : 'live'}"`,
    '-c',
    'tools.web_search.context_size="high"',
    '-c',
    'analytics.enabled=false'
  ]
}

class JsonLineRpcClient {
  private nextId = 1
  private bytes = 0
  private buffer = ''
  private settled = false
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private readonly notifications = new Set<(message: RpcResponse) => void>()
  private readonly closeListeners = new Set<(error: Error) => void>()

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => {
      this.bytes += chunk.byteLength
      if (this.bytes > MAX_PROTOCOL_BYTES) {
        this.fail(new Error('CODEX_WRITING_OUTPUT_TOO_LARGE'))
        return
      }
      this.buffer += chunk.toString('utf8')
      let newline = this.buffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (line) this.handleLine(line)
        newline = this.buffer.indexOf('\n')
      }
    })
    child.once('error', () => this.fail(new Error('CODEX_WRITING_START_FAILED')))
    child.once('exit', (code, signal) => {
      if (!this.settled && this.pending.size > 0) this.fail(new Error(`CODEX_WRITING_EXIT_${code ?? signal ?? 'UNKNOWN'}`))
    })
  }

  onNotification(listener: (message: RpcResponse) => void): () => void {
    this.notifications.add(listener)
    return () => this.notifications.delete(listener)
  }

  onClose(listener: (error: Error) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.settled) return Promise.reject(new Error('CODEX_WRITING_CONNECTION_CLOSED'))
    const id = this.nextId++
    return new Promise((resolveRequest, reject) => {
      this.pending.set(id, { resolve: resolveRequest, reject })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  notify(method: string, params?: unknown): void {
    if (!this.settled) this.child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`)
  }

  close(error = new Error('CODEX_WRITING_CONNECTION_CLOSED')): void {
    if (this.settled) return
    this.settled = true
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const listener of this.closeListeners) listener(error)
    this.closeListeners.clear()
    this.child.kill('SIGTERM')
  }

  private handleLine(line: string): void {
    let message: RpcResponse
    try { message = JSON.parse(line) as RpcResponse } catch { this.fail(new Error('CODEX_WRITING_PROTOCOL_INVALID')); return }
    if (typeof message.id === 'number' && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`CODEX_WRITING_RPC_${message.error.code ?? 'ERROR'}:${message.error.message ?? '请求失败'}`))
      else pending.resolve(message.result)
      return
    }
    if (message.method && typeof message.id === 'number') {
      this.child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'LY Creator OS未开放此请求' } })}\n`)
      return
    }
    if (message.method) for (const listener of this.notifications) listener(message)
  }

  private fail(error: Error): void {
    this.close(error)
    this.child.kill('SIGKILL')
  }
}

export function chooseCodexWritingModel(models: CodexModel[], preferredModel?: string | null, preferredReasoningEffort?: string | null): { model: CodexModel; reasoningEffort: string } {
  const visible = models.filter((model) => !model.hidden)
  const selected = preferredModel
    ? visible.find((model) => model.id === preferredModel || model.model === preferredModel)
    : MODEL_PREFERENCE.map((id) => visible.find((model) => model.id === id || model.model === id)).find(Boolean)
      ?? visible.find((model) => model.isDefault)
      ?? visible[0]
  if (preferredModel && !selected) throw new Error('CODEX_WRITING_SELECTED_MODEL_UNAVAILABLE')
  if (!selected) throw new Error('CODEX_WRITING_MODEL_UNAVAILABLE')
  const supported = new Set(selected.supportedReasoningEfforts.map((option) => option.reasoningEffort))
  if (preferredReasoningEffort && !supported.has(preferredReasoningEffort)) throw new Error('CODEX_WRITING_SELECTED_REASONING_UNAVAILABLE')
  const reasoningEffort = preferredReasoningEffort
    ?? REASONING_PREFERENCE.find((effort) => supported.has(effort))
    ?? selected.defaultReasoningEffort
  return { model: selected, reasoningEffort }
}

export async function listCodexWritingModels(options: {
  provider: ProviderExecutableInfo
  taskDirectory: string
  stateDirectory: string
  timeoutMilliseconds?: number
}): Promise<CodexModel[]> {
  if (options.provider.provider !== 'codex_cli') throw new Error('CODEX_WRITING_PROVIDER_INVALID')
  const env = await prepareCodexWritingEnvironment(options.taskDirectory, options.stateDirectory)
  const profile = buildCodexWritingSandboxProfile(options.provider, options.taskDirectory, options.stateDirectory)
  const child = spawn('/usr/bin/sandbox-exec', [
    '-p',
    profile,
    options.provider.executablePath,
    ...buildCodexWritingAppServerArguments('disabled')
  ], {
    cwd: options.taskDirectory,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  })
  const client = new JsonLineRpcClient(child)
  let timeout: NodeJS.Timeout | null = null
  try {
    timeout = setTimeout(() => client.close(new Error('TASK_TIMEOUT')), options.timeoutMilliseconds ?? 30_000)
    const initialize = await client.request('initialize', {
      clientInfo: { name: 'ly-creator-os', title: 'LY Creator OS', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    })
    if (!initialize || typeof initialize !== 'object') throw new Error('CODEX_WRITING_INITIALIZE_FAILED')
    client.notify('initialized')
    const response = await client.request('model/list', { includeHidden: false, limit: 100 }) as { data?: CodexModel[] }
    return (Array.isArray(response?.data) ? response.data : []).filter((model) => !model.hidden)
  } finally {
    if (timeout) clearTimeout(timeout)
    client.close()
  }
}

function normalizeWebSearch(item: TurnItem): ScriptRevisionWebSearchRecord {
  const actionType = item.action?.type
  const type = actionType === 'openPage' || actionType === 'open_page'
    ? 'open_page'
    : actionType === 'findInPage' || actionType === 'find_in_page'
      ? 'find_in_page'
      : actionType === 'search' ? 'search' : item.query ? 'search' : 'other'
  const query = item.action?.query ?? item.action?.queries?.filter(Boolean).join('；') ?? item.query ?? null
  return {
    type,
    query,
    url: item.action?.url ?? null,
    runtimeAccessId: item.id ?? null,
    accessedAt: item.observedAt ?? new Date().toISOString()
  }
}

function finalAgentText(turn: TurnResult): string {
  const messages = turn.items.filter((item) => item.type === 'agentMessage' && typeof item.text === 'string')
  const final = [...messages].reverse().find((item) => item.phase === 'final_answer') ?? messages.at(-1)
  return final?.text?.trim() ?? ''
}

function assertNoDisallowedToolItems(turn: TurnResult): void {
  const violation = turn.items.find((item) => DISALLOWED_ITEM_TYPES.has(item.type))
  if (violation) throw new Error(`CODEX_WRITING_TOOL_BOUNDARY_VIOLATION:${violation.type}`)
}

function mergeTurnItems(turn: TurnResult, completedItems: TurnItem[]): TurnResult {
  const merged = new Map<string, TurnItem>()
  for (const item of [...turn.items, ...completedItems]) {
    const key = item.id ? `${item.type}:${item.id}` : `${item.type}:${JSON.stringify(item)}`
    merged.set(key, item)
  }
  return { ...turn, items: [...merged.values()] }
}

function waitForTurn(client: JsonLineRpcClient, turnId: string, signal?: AbortSignal): Promise<TurnResult> {
  return new Promise((resolveTurn, reject) => {
    const cleanupNotification = client.onNotification((message) => {
      if (message.method !== 'turn/completed') return
      const params = message.params as { turn?: TurnResult } | undefined
      if (!params?.turn || params.turn.id !== turnId) return
      cleanup()
      resolveTurn(params.turn)
    })
    const cleanupClose = client.onClose((error) => { cleanup(); reject(error) })
    const abort = (): void => { cleanup(); reject(new Error('TASK_CANCELED')) }
    const cleanup = (): void => {
      cleanupNotification()
      cleanupClose()
      signal?.removeEventListener('abort', abort)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function startOrResumeThread(client: JsonLineRpcClient, options: CodexWritingTurnOptions, model: string, reasoningEffort: string): Promise<{ result: ThreadStartResult; resumed: boolean }> {
  const config = {
    web_search: options.webSearchMode === 'disabled' ? 'disabled' : 'live',
    tools: { web_search: { context_size: 'high' } },
    analytics: { enabled: false },
    model_reasoning_effort: reasoningEffort
  }
  const common = {
    model,
    cwd: options.taskDirectory,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    config,
    developerInstructions: options.developerInstructions,
    personality: 'pragmatic'
  }
  if (options.providerThreadId) {
    try {
      const result = await client.request('thread/resume', { threadId: options.providerThreadId, ...common }) as ThreadStartResult
      return { result, resumed: true }
    } catch { /* create a recovery thread below */ }
  }
  const result = await client.request('thread/start', {
    ...common,
    ephemeral: options.persistThread === false
  }) as ThreadStartResult
  return { result, resumed: false }
}

export async function runCodexWritingTurn(options: CodexWritingTurnOptions): Promise<CodexWritingTurnResult> {
  if (options.provider.provider !== 'codex_cli') throw new Error('CODEX_WRITING_PROVIDER_INVALID')
  const env = await prepareCodexWritingEnvironment(options.taskDirectory, options.stateDirectory)
  const profile = buildCodexWritingSandboxProfile(options.provider, options.taskDirectory, options.stateDirectory)
  const child = spawn('/usr/bin/sandbox-exec', [
    '-p',
    profile,
    options.provider.executablePath,
    ...buildCodexWritingAppServerArguments(options.webSearchMode)
  ], {
    cwd: options.taskDirectory,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  })
  const client = new JsonLineRpcClient(child)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 8_000) stderr += chunk.toString('utf8').slice(0, 8_000 - stderr.length)
  })
  let timeout: NodeJS.Timeout | null = null
  const abort = (): void => client.close(new Error('TASK_CANCELED'))
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    timeout = setTimeout(() => client.close(new Error('TASK_TIMEOUT')), options.timeoutMilliseconds)
    const initialize = await client.request('initialize', {
      clientInfo: { name: 'ly-creator-os', title: 'LY Creator OS', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    })
    if (!initialize || typeof initialize !== 'object') throw new Error('CODEX_WRITING_INITIALIZE_FAILED')
    client.notify('initialized')
    options.onProgress?.(12)

    const modelResponse = await client.request('model/list', { includeHidden: false, limit: 100 }) as { data?: CodexModel[] }
    const selected = chooseCodexWritingModel(Array.isArray(modelResponse?.data) ? modelResponse.data : [], options.preferredModel, options.preferredReasoningEffort)
    options.onProgress?.(20)

    const thread = await startOrResumeThread(client, options, selected.model.id, selected.reasoningEffort)
    const providerThreadId = thread.result.thread.id
    const actualModel = thread.result.model || selected.model.id
    const actualEffort = thread.result.reasoningEffort || selected.reasoningEffort || selected.model.defaultReasoningEffort
    options.onProgress?.(28)

    const completedTurns = new Map<string, TurnResult>()
    const completedItems = new Map<string, TurnItem[]>()
    const stopTurnMonitor = client.onNotification((message) => {
      if (message.method === 'item/completed') {
        const params = message.params as { turnId?: string; item?: TurnItem } | undefined
        if (!params?.turnId || !params.item) return
        completedItems.set(params.turnId, [
          ...(completedItems.get(params.turnId) ?? []),
          { ...params.item, observedAt: new Date().toISOString() }
        ])
        return
      }
      if (message.method === 'turn/completed') {
        const params = message.params as { turn?: TurnResult } | undefined
        if (params?.turn?.id) completedTurns.set(params.turn.id, params.turn)
      }
    })
    const turnResponse = await client.request('turn/start', {
      threadId: providerThreadId,
      input: [
        { type: 'text', text: options.buildInput(!thread.resumed), text_elements: [] },
        ...(options.localImagePaths ?? []).map((path) => ({ type: 'localImage', path, detail: 'original' }))
      ],
      cwd: options.taskDirectory,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: options.webSearchMode !== 'disabled' },
      model: actualModel,
      effort: actualEffort,
      summary: 'none',
      personality: 'pragmatic',
      outputSchema: options.outputSchema ?? null
    }) as { turn?: TurnResult }
    if (!turnResponse?.turn?.id) throw new Error('CODEX_WRITING_TURN_START_FAILED')
    options.onProgress?.(38)
    const completedTurn = turnResponse.turn.status === 'completed'
      ? turnResponse.turn
      : completedTurns.get(turnResponse.turn.id) ?? await waitForTurn(client, turnResponse.turn.id, options.signal)
    stopTurnMonitor()
    const turn = mergeTurnItems(completedTurn, completedItems.get(completedTurn.id) ?? [])
    if (turn.status !== 'completed') throw new Error(`CODEX_WRITING_TURN_${turn.status.toUpperCase()}:${turn.error?.message ?? '生成失败'}`)
    assertNoDisallowedToolItems(turn)
    const finalText = finalAgentText(turn)
    if (!finalText) throw new Error('CODEX_WRITING_EMPTY_RESPONSE')
    const webSearches = turn.items.filter((item) => item.type === 'webSearch').map(normalizeWebSearch)
    options.onProgress?.(96)
    return {
      finalText,
      providerThreadId,
      model: actualModel,
      reasoningEffort: actualEffort,
      webSearchMode: options.webSearchMode,
      webSearches
    }
  } catch (error) {
    if (options.signal?.aborted) throw new Error('TASK_CANCELED')
    if (/not logged in|authentication|unauthorized|401/i.test(stderr)) throw new Error('PROVIDER_NOT_AUTHENTICATED')
    if (/operation not permitted|sandbox/i.test(stderr)) throw new Error('PROVIDER_SANDBOX_DENIED')
    if (error instanceof Error && /^CODEX_WRITING_/.test(error.message)) throw error
    throw error instanceof Error ? error : new Error('CODEX_WRITING_FAILED')
  } finally {
    if (timeout) clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
    client.close()
  }
}
