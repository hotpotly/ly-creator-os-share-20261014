import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { z } from 'zod'
import type {
  ConversationExcludedBlockSummary,
  ConversationHistorySource,
  ConversationMetadata,
  ConversationMetadataIssue,
  ConversationMetadataResult,
  ConversationSelectionIssue,
  ConversationSelectionPreview,
  ConversationSourceCursor,
  ConversationSourceAvailability
} from '../shared/domain'
import { scanAndSanitizeContent } from './content-engine'

const DEFAULT_SOFT_TOKEN_LIMIT = 80_000
const DEFAULT_HARD_TOKEN_LIMIT = 120_000
const MAX_LINE_BYTES = 16 * 1024 * 1024
const MAX_SOURCE_FILE_BYTES = 128 * 1024 * 1024

export interface ConversationTextTurn {
  sourceId: string
  messageId: string
  role: 'user' | 'assistant'
  timestamp: string | null
  text: string
}

interface LoadedConversation {
  metadata: ConversationMetadata
  turns: ConversationTextTurn[]
  cursor: ConversationSourceCursor
}

interface ConversationLoadResult {
  conversations: LoadedConversation[]
  excludedBlocks: Map<string, number>
  issues: ConversationSelectionIssue[]
  truncated: boolean
}

interface AdapterListResult {
  metadata: ConversationMetadata[]
  issues: ConversationMetadataIssue[]
}

export interface ConversationSourceAdapter {
  readonly source: ConversationHistorySource
  detect(): Promise<ConversationSourceAvailability>
  listMetadata(): Promise<AdapterListResult>
  loadSelected(ids: readonly string[], afterOffsets?: ReadonlyMap<string, number>): Promise<ConversationLoadResult>
}

export interface ConversationSourceServiceOptions {
  cacheDirectory: string
  codexRoot?: string
  claudeRoot?: string
  softTokenLimit?: number
  hardTokenLimit?: number
}

interface JsonLineScanResult {
  offset: number
  oversizedLineCount: number
  stopped: boolean
}

async function scanJsonLines(
  filePath: string,
  options: { start?: number; maximumLineBytes?: number; includeFinalLine?: boolean },
  onLine: (line: string) => boolean | void
): Promise<JsonLineScanResult> {
  const start = options.start ?? 0
  const maximumLineBytes = options.maximumLineBytes ?? MAX_LINE_BYTES
  let offset = start
  let pending = Buffer.alloc(0)
  let discardedBytes = 0
  let discardingOversizedLine = false
  let oversizedLineCount = 0
  let stopped = false
  const stream = createReadStream(filePath, { start, highWaterMark: 64 * 1024 })

  for await (const value of stream) {
    let chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    if (discardingOversizedLine) {
      const newline = chunk.indexOf(0x0a)
      if (newline < 0) { discardedBytes += chunk.byteLength; continue }
      offset += discardedBytes + newline + 1
      chunk = chunk.subarray(newline + 1)
      discardedBytes = 0
      discardingOversizedLine = false
    }
    let data = pending.length ? Buffer.concat([pending, chunk]) : chunk
    pending = Buffer.alloc(0)
    while (data.length) {
      const newline = data.indexOf(0x0a)
      if (newline < 0) {
        if (data.length > maximumLineBytes) {
          oversizedLineCount += 1
          discardedBytes = data.length
          discardingOversizedLine = true
        } else pending = Buffer.from(data)
        break
      }
      const lineBuffer = data.subarray(0, newline)
      offset += newline + 1
      data = data.subarray(newline + 1)
      if (lineBuffer.length > maximumLineBytes) { oversizedLineCount += 1; continue }
      if (onLine(lineBuffer.toString('utf8')) === false) { stopped = true; break }
    }
    if (stopped) break
  }
  if (!stopped && options.includeFinalLine && pending.length) {
    offset += pending.length
    if (onLine(pending.toString('utf8')) === false) stopped = true
  }
  return { offset, oversizedLineCount, stopped }
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function safeTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  return compact.length > 120 ? `${compact.slice(0, 119)}…` : compact
}
function isoDate(value: unknown, fallback: Date): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 10_000_000_000 ? value * 1_000 : value).toISOString()
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return fallback.toISOString()
}
function lengthLabel(sizeBytes: number | null): string {
  if (sizeBytes === null) return '选择后计算长度'
  if (sizeBytes < 1_024) return '不足1KB记录'
  if (sizeBytes < 1_024 * 1_024) return `约${Math.ceil(sizeBytes / 1_024)}KB记录`
  return `约${(sizeBytes / (1_024 * 1_024)).toFixed(sizeBytes < 10 * 1_024 * 1_024 ? 1 : 0)}MB记录`
}
function addExcluded(target: Map<string, number>, blockType: string, count = 1): void {
  target.set(blockType, (target.get(blockType) ?? 0) + count)
}
function mergeExcluded(target: Map<string, number>, source: Map<string, number>): void {
  for (const [kind, count] of source) addExcluded(target, kind, count)
}
function withoutFencedCode(value: string): { text: string; count: number } {
  let count = 0
  const text = value.replace(/(^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:(?:\n[ \t]*(?:```|~~~)[ \t]*(?=\n|$))|$)/g, (match) => {
    count += 1
    return match.startsWith('\n') ? '\n[已排除代码块]' : '[已排除代码块]'
  })
  return { text: text.trim(), count }
}
function isWithin(root: string, candidate: string): boolean { return candidate === root || candidate.startsWith(`${root}${sep}`) }
function selectionIssue(sourceId: string | null, code: string, message: string): ConversationSelectionIssue { return { sourceId, code, message } }

const codexIndexRecordSchema = z.object({ id: z.string().min(8).max(160), thread_name: z.string().optional(), updated_at: z.union([z.string(), z.number()]).optional() }).passthrough()

export class CodexConversationAdapter implements ConversationSourceAdapter {
  readonly source = 'codex' as const
  private metadataById = new Map<string, ConversationMetadata>()
  private sessionPathById = new Map<string, string>()

  constructor(private readonly root: string = join(homedir(), '.codex'), private readonly maximumCharacters = DEFAULT_HARD_TOKEN_LIMIT * 2) {}

  async detect(): Promise<ConversationSourceAvailability> {
    try {
      await Promise.all([access(join(this.root, 'session_index.jsonl'), constants.R_OK), access(join(this.root, 'sessions'), constants.R_OK)])
      return { source: this.source, displayName: 'Codex任务', detected: true, detail: '已检测到本机Codex任务索引' }
    } catch { return { source: this.source, displayName: 'Codex任务', detected: false, detail: '未检测到可选择的Codex任务' } }
  }

  async listMetadata(): Promise<AdapterListResult> {
    const metadataById = new Map<string, ConversationMetadata>()
    let malformed = 0
    try {
      await scanJsonLines(join(this.root, 'session_index.jsonl'), { maximumLineBytes: 256 * 1024, includeFinalLine: true }, (line) => {
        if (!line.trim()) return
        try {
          const parsed = codexIndexRecordSchema.parse(JSON.parse(line))
          if (!/^[a-zA-Z0-9_-]+$/.test(parsed.id)) { malformed += 1; return }
          const id = `codex:${parsed.id}`
          const updatedAt = isoDate(parsed.updated_at, new Date(0))
          metadataById.set(id, { id, source: this.source, title: safeTitle(parsed.thread_name, `Codex任务·${updatedAt.slice(0, 10)}`), updatedAt, sizeBytes: null, lengthLabel: lengthLabel(null) })
        } catch { malformed += 1 }
      })
      this.metadataById = metadataById
      return {
        metadata: [...metadataById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        issues: malformed ? [{ source: this.source, code: 'CODEX_INDEX_RECORD_SKIPPED', message: `已跳过${malformed}条无法识别的Codex索引记录` }] : []
      }
    } catch {
      this.metadataById.clear()
      return { metadata: [], issues: [{ source: this.source, code: 'CODEX_INDEX_UNAVAILABLE', message: 'Codex任务索引暂时无法读取' }] }
    }
  }

  async loadSelected(ids: readonly string[], afterOffsets: ReadonlyMap<string, number> = new Map()): Promise<ConversationLoadResult> {
    if (this.metadataById.size === 0) await this.listMetadata()
    const conversations: LoadedConversation[] = []
    const excludedBlocks = new Map<string, number>()
    const issues: ConversationSelectionIssue[] = []
    let characterCount = 0
    let truncated = false
    for (const publicId of ids) {
      const rawId = publicId.startsWith('codex:') ? publicId.slice('codex:'.length) : ''
      const metadata = this.metadataById.get(publicId)
      if (!metadata || !/^[a-zA-Z0-9_-]{8,160}$/.test(rawId)) { issues.push(selectionIssue(publicId, 'SOURCE_NOT_FOUND', '所选Codex任务已不存在或索引已变化')); continue }
      const sessionPath = await this.findSessionPath(rawId)
      if (!sessionPath) { issues.push(selectionIssue(publicId, 'CODEX_SESSION_NOT_FOUND', 'Codex任务正文文件未找到')); continue }
      const loaded = await this.loadSession(sessionPath, metadata, this.maximumCharacters - characterCount, afterOffsets.get(publicId) ?? 0)
      conversations.push({ metadata, turns: loaded.turns, cursor: loaded.cursor })
      mergeExcluded(excludedBlocks, loaded.excludedBlocks)
      issues.push(...loaded.issues)
      characterCount += loaded.turns.reduce((total, turn) => total + turn.text.length, 0)
      if (loaded.truncated || characterCount >= this.maximumCharacters) { truncated = true; break }
    }
    return { conversations, excludedBlocks, issues, truncated }
  }

  private async findSessionPath(rawId: string): Promise<string | null> {
    const cached = this.sessionPathById.get(rawId)
    if (cached) return cached
    const sessionsRoot = await realpath(join(this.root, 'sessions')).catch(() => null)
    if (!sessionsRoot) return null
    const visit = async (directory: string): Promise<string | null> => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const candidate = join(directory, entry.name)
        if (entry.isDirectory()) {
          const found = await visit(candidate)
          if (found) return found
        } else if (entry.isFile() && entry.name.endsWith(`${rawId}.jsonl`)) {
          const canonical = await realpath(candidate).catch(() => null)
          if (canonical && isWithin(sessionsRoot, canonical)) { this.sessionPathById.set(rawId, canonical); return canonical }
        }
      }
      return null
    }
    return visit(sessionsRoot)
  }

  private async loadSession(filePath: string, metadata: ConversationMetadata, characterLimit: number, requestedStartOffset: number): Promise<{ turns: ConversationTextTurn[]; cursor: ConversationSourceCursor; excludedBlocks: Map<string, number>; issues: ConversationSelectionIssue[]; truncated: boolean }> {
    const turns: ConversationTextTurn[] = []
    const excludedBlocks = new Map<string, number>()
    const issues: ConversationSelectionIssue[] = []
    let malformed = 0
    let characters = 0
    let truncated = false
    let lastMessageTimestamp: string | null = null
    const file = await stat(filePath)
    const startOffset = Number.isSafeInteger(requestedStartOffset) && requestedStartOffset >= 0 && requestedStartOffset <= file.size ? requestedStartOffset : 0
    if (startOffset !== requestedStartOffset) issues.push(selectionIssue(metadata.id, 'INCREMENTAL_CURSOR_RESET', '该Codex任务文件已缩短，将重新读取当前完整对话'))
    const emptyCursor = (): ConversationSourceCursor => ({ sourceId: metadata.id, updatedAt: metadata.updatedAt, startOffset, endOffset: startOffset, lastMessageTimestamp: null, contentHash: sha256('') })
    if (file.size > MAX_SOURCE_FILE_BYTES && startOffset === 0) return { turns, cursor: emptyCursor(), excludedBlocks, issues: [...issues, selectionIssue(metadata.id, 'SOURCE_FILE_TOO_LARGE', '该Codex任务记录超过本期读取上限，请改用手动分段导入')], truncated: true }
    const scan = await scanJsonLines(filePath, { start: startOffset, includeFinalLine: true }, (line) => {
      if (!line.trim()) return
      let record: Record<string, unknown>
      try { record = JSON.parse(line) as Record<string, unknown> } catch { malformed += 1; return }
      if (record.type !== 'response_item' || !record.payload || typeof record.payload !== 'object') { addExcluded(excludedBlocks, typeof record.type === 'string' ? record.type : 'unknown_record'); return }
      const payload = record.payload as Record<string, unknown>
      if (payload.type !== 'message') { addExcluded(excludedBlocks, payload.type === 'function_call' ? 'tool_use' : typeof payload.type === 'string' ? payload.type : 'response_item'); return }
      if (payload.role !== 'user' && payload.role !== 'assistant') { addExcluded(excludedBlocks, typeof payload.role === 'string' ? `role_${payload.role}` : 'role_unknown'); return }
      if (!Array.isArray(payload.content)) { addExcluded(excludedBlocks, 'message_without_text'); return }
      const textBlocks: string[] = []
      for (const blockValue of payload.content) {
        if (!blockValue || typeof blockValue !== 'object') { addExcluded(excludedBlocks, 'unknown_block'); continue }
        const block = blockValue as Record<string, unknown>
        const allowed = payload.role === 'user' ? block.type === 'input_text' : block.type === 'output_text'
        if (allowed && typeof block.text === 'string' && block.text.trim()) {
          const cleaned = withoutFencedCode(block.text)
          if (cleaned.count) addExcluded(excludedBlocks, 'code_block', cleaned.count)
          if (cleaned.text) textBlocks.push(cleaned.text)
        }
        else addExcluded(excludedBlocks, typeof block.type === 'string' ? block.type : 'unknown_block')
      }
      if (textBlocks.length === 0) return
      const text = textBlocks.join('\n')
      const remaining = characterLimit - characters
      if (remaining <= 0) { truncated = true; return false }
      const accepted = text.length > remaining ? text.slice(0, remaining) : text
      const timestamp = typeof record.timestamp === 'string' ? record.timestamp : null
      turns.push({ sourceId: metadata.id, messageId: sha256(`${metadata.id}:${record.timestamp ?? ''}:${line}`).slice(0, 32), role: payload.role, timestamp, text: accepted })
      lastMessageTimestamp = timestamp ?? lastMessageTimestamp
      characters += accepted.length
      if (accepted.length < text.length) { truncated = true; return false }
    })
    if (scan.oversizedLineCount) addExcluded(excludedBlocks, 'oversized_line', scan.oversizedLineCount)
    if (malformed) issues.push(selectionIssue(metadata.id, 'SOURCE_RECORD_SKIPPED', `已跳过${malformed}条损坏的Codex正文记录`))
    if (truncated) issues.push(selectionIssue(metadata.id, 'INPUT_HARD_LIMIT_EXCEEDED', '所选内容超过输入硬上限，预览仅保留前段且不能开始筛选'))
    return {
      turns,
      cursor: {
        sourceId: metadata.id,
        updatedAt: metadata.updatedAt,
        startOffset,
        endOffset: scan.offset,
        lastMessageTimestamp,
        contentHash: sha256(turns.map((turn) => `${turn.messageId}:${turn.text}`).join('\n'))
      },
      excludedBlocks,
      issues,
      truncated
    }
  }
}

const claudeCacheEntrySchema = z.object({
  id: z.string(), relativePath: z.string(), mtimeMs: z.number(), sizeBytes: z.number().int().nonnegative(), offset: z.number().int().nonnegative(),
  aiTitle: z.string().nullable(), customTitle: z.string().nullable(), updatedAt: z.string()
})
const claudeCacheSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), claudeCacheEntrySchema) })
type ClaudeCacheEntry = z.infer<typeof claudeCacheEntrySchema>

export class ClaudeConversationAdapter implements ConversationSourceAdapter {
  readonly source = 'claude' as const
  private cacheEntries = new Map<string, ClaudeCacheEntry>()
  private refreshPromise: Promise<AdapterListResult> | null = null

  constructor(
    private readonly root: string = join(homedir(), '.claude', 'projects'),
    private readonly cachePath: string,
    private readonly maximumCharacters = DEFAULT_HARD_TOKEN_LIMIT * 2
  ) {}

  async detect(): Promise<ConversationSourceAvailability> {
    try {
      await access(this.root, constants.R_OK)
      return { source: this.source, displayName: 'Claude会话', detected: true, detail: '已检测到本机Claude会话目录' }
    } catch { return { source: this.source, displayName: 'Claude会话', detected: false, detail: '未检测到可选择的Claude会话' } }
  }

  async listMetadata(): Promise<AdapterListResult> {
    if (!this.refreshPromise) this.refreshPromise = this.refreshMetadata().finally(() => { this.refreshPromise = null })
    return this.refreshPromise
  }

  async loadSelected(ids: readonly string[], afterOffsets: ReadonlyMap<string, number> = new Map()): Promise<ConversationLoadResult> {
    await this.listMetadata()
    const conversations: LoadedConversation[] = []
    const excludedBlocks = new Map<string, number>()
    const issues: ConversationSelectionIssue[] = []
    let characterCount = 0
    let truncated = false
    const canonicalRoot = await realpath(this.root).catch(() => null)
    if (!canonicalRoot) return { conversations, excludedBlocks, issues: [selectionIssue(null, 'CLAUDE_SOURCE_UNAVAILABLE', 'Claude会话目录暂时无法读取')], truncated: false }
    for (const publicId of ids) {
      const entry = this.cacheEntries.get(publicId)
      if (!entry) { issues.push(selectionIssue(publicId, 'SOURCE_NOT_FOUND', '所选Claude会话已不存在或缓存已变化')); continue }
      const candidate = await realpath(join(canonicalRoot, entry.relativePath)).catch(() => null)
      if (!candidate || !isWithin(canonicalRoot, candidate)) { issues.push(selectionIssue(publicId, 'SOURCE_PATH_INVALID', '所选Claude会话路径校验失败')); continue }
      const metadata = this.metadataFromEntry(entry)
      const loaded = await this.loadSession(candidate, metadata, this.maximumCharacters - characterCount, afterOffsets.get(publicId) ?? 0)
      conversations.push({ metadata, turns: loaded.turns, cursor: loaded.cursor })
      mergeExcluded(excludedBlocks, loaded.excludedBlocks)
      issues.push(...loaded.issues)
      characterCount += loaded.turns.reduce((total, turn) => total + turn.text.length, 0)
      if (loaded.truncated || characterCount >= this.maximumCharacters) { truncated = true; break }
    }
    return { conversations, excludedBlocks, issues, truncated }
  }

  private async refreshMetadata(): Promise<AdapterListResult> {
    const issues: ConversationMetadataIssue[] = []
    const cached = await this.readCache()
    const previousEntries = cached.entries
    const nextEntries = new Map<string, ClaudeCacheEntry>()
    const canonicalRoot = await realpath(this.root).catch(() => null)
    if (!canonicalRoot) { this.cacheEntries.clear(); return { metadata: [], issues: [{ source: this.source, code: 'CLAUDE_SOURCE_UNAVAILABLE', message: 'Claude会话目录暂时无法读取' }] } }
    const projectDirectories = await readdir(canonicalRoot, { withFileTypes: true }).catch(() => [])
    let skipped = 0
    for (const projectDirectory of projectDirectories.filter((entry) => entry.isDirectory())) {
      const directory = join(canonicalRoot, projectDirectory.name)
      const files = await readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
        const filePath = join(directory, file.name)
        try {
          const fileStat = await stat(filePath)
          const relativePath = relative(canonicalRoot, filePath)
          const id = `claude:${sha256(relativePath).slice(0, 32)}`
          const previous = previousEntries[id]
          const mayContinue = previous && previous.relativePath === relativePath && previous.sizeBytes <= fileStat.size && previous.offset <= fileStat.size && previous.mtimeMs <= fileStat.mtimeMs
          const entry: ClaudeCacheEntry = {
            id,
            relativePath,
            mtimeMs: fileStat.mtimeMs,
            sizeBytes: fileStat.size,
            offset: mayContinue ? previous.offset : 0,
            aiTitle: mayContinue ? previous.aiTitle : null,
            customTitle: mayContinue ? previous.customTitle : null,
            updatedAt: fileStat.mtime.toISOString()
          }
          if (!previous || previous.sizeBytes !== fileStat.size || previous.mtimeMs !== fileStat.mtimeMs || previous.offset !== fileStat.size) await this.scanTitleMetadata(filePath, entry)
          nextEntries.set(id, entry)
        } catch { skipped += 1 }
      }
    }
    this.cacheEntries = nextEntries
    await this.writeCache(nextEntries).catch(() => { issues.push({ source: this.source, code: 'CLAUDE_CACHE_WRITE_FAILED', message: 'Claude会话列表已读取，但增量缓存未能保存' }) })
    if (skipped) issues.push({ source: this.source, code: 'CLAUDE_METADATA_SKIPPED', message: `已跳过${skipped}条无法识别的Claude会话记录` })
    return { metadata: [...nextEntries.values()].map((entry) => this.metadataFromEntry(entry)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), issues }
  }

  private async scanTitleMetadata(filePath: string, entry: ClaudeCacheEntry): Promise<void> {
    const scan = await scanJsonLines(filePath, { start: entry.offset, maximumLineBytes: 256 * 1024, includeFinalLine: false }, (line) => {
      if (!/"type"\s*:\s*"(?:ai-title|custom-title)"/.test(line)) return
      try {
        const record = JSON.parse(line) as Record<string, unknown>
        if (record.type === 'custom-title') entry.customTitle = safeTitle(record.customTitle, '') || null
        if (record.type === 'ai-title') entry.aiTitle = safeTitle(record.aiTitle, '') || null
      } catch { /* a damaged title event must not block the remaining metadata */ }
    })
    entry.offset = scan.offset
  }

  private metadataFromEntry(entry: ClaudeCacheEntry): ConversationMetadata {
    const fallback = `Claude会话·${entry.updatedAt.slice(0, 10)}`
    return { id: entry.id, source: this.source, title: entry.customTitle ?? entry.aiTitle ?? fallback, updatedAt: entry.updatedAt, sizeBytes: entry.sizeBytes, lengthLabel: lengthLabel(entry.sizeBytes) }
  }

  private async loadSession(filePath: string, metadata: ConversationMetadata, characterLimit: number, requestedStartOffset: number): Promise<{ turns: ConversationTextTurn[]; cursor: ConversationSourceCursor; excludedBlocks: Map<string, number>; issues: ConversationSelectionIssue[]; truncated: boolean }> {
    const turns: ConversationTextTurn[] = []
    const excludedBlocks = new Map<string, number>()
    const issues: ConversationSelectionIssue[] = []
    let malformed = 0
    let characters = 0
    let truncated = false
    let lastMessageTimestamp: string | null = null
    const file = await stat(filePath)
    const startOffset = Number.isSafeInteger(requestedStartOffset) && requestedStartOffset >= 0 && requestedStartOffset <= file.size ? requestedStartOffset : 0
    if (startOffset !== requestedStartOffset) issues.push(selectionIssue(metadata.id, 'INCREMENTAL_CURSOR_RESET', '该Claude会话文件已缩短，将重新读取当前完整对话'))
    const emptyCursor = (): ConversationSourceCursor => ({ sourceId: metadata.id, updatedAt: metadata.updatedAt, startOffset, endOffset: startOffset, lastMessageTimestamp: null, contentHash: sha256('') })
    if (file.size > MAX_SOURCE_FILE_BYTES && startOffset === 0) return { turns, cursor: emptyCursor(), excludedBlocks, issues: [...issues, selectionIssue(metadata.id, 'SOURCE_FILE_TOO_LARGE', '该Claude会话记录超过本期读取上限，请改用手动分段导入')], truncated: true }
    const scan = await scanJsonLines(filePath, { start: startOffset, includeFinalLine: true }, (line) => {
      if (!line.trim()) return
      let record: Record<string, unknown>
      try { record = JSON.parse(line) as Record<string, unknown> } catch { malformed += 1; return }
      if (record.type !== 'user' && record.type !== 'assistant') { addExcluded(excludedBlocks, typeof record.type === 'string' ? record.type : 'unknown_record'); return }
      if (record.isSidechain === true) { addExcluded(excludedBlocks, 'sidechain'); return }
      if (record.isCompactSummary === true) { addExcluded(excludedBlocks, 'compressed_summary'); return }
      if (record.isMeta === true || record.isVisibleInTranscriptOnly === true) { addExcluded(excludedBlocks, 'metadata_message'); return }
      if (record.isApiErrorMessage === true) { addExcluded(excludedBlocks, 'api_error'); return }
      if (!record.message || typeof record.message !== 'object') { addExcluded(excludedBlocks, 'message_without_text'); return }
      const message = record.message as Record<string, unknown>
      if (message.role !== record.type) { addExcluded(excludedBlocks, 'role_mismatch'); return }
      const textBlocks: string[] = []
      if (typeof message.content === 'string') {
        if (message.content.trim()) {
          const cleaned = withoutFencedCode(message.content)
          if (cleaned.count) addExcluded(excludedBlocks, 'code_block', cleaned.count)
          if (cleaned.text) textBlocks.push(cleaned.text)
        }
      } else if (Array.isArray(message.content)) {
        for (const blockValue of message.content) {
          if (!blockValue || typeof blockValue !== 'object') { addExcluded(excludedBlocks, 'unknown_block'); continue }
          const block = blockValue as Record<string, unknown>
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            const cleaned = withoutFencedCode(block.text)
            if (cleaned.count) addExcluded(excludedBlocks, 'code_block', cleaned.count)
            if (cleaned.text) textBlocks.push(cleaned.text)
          } else addExcluded(excludedBlocks, typeof block.type === 'string' ? block.type : 'unknown_block')
        }
      } else addExcluded(excludedBlocks, 'message_without_text')
      if (textBlocks.length === 0) return
      const text = textBlocks.join('\n')
      const remaining = characterLimit - characters
      if (remaining <= 0) { truncated = true; return false }
      const accepted = text.length > remaining ? text.slice(0, remaining) : text
      const fallbackId = sha256(`${metadata.id}:${record.timestamp ?? ''}:${line}`).slice(0, 32)
      const timestamp = typeof record.timestamp === 'string' ? record.timestamp : null
      turns.push({ sourceId: metadata.id, messageId: typeof record.uuid === 'string' ? record.uuid : fallbackId, role: record.type, timestamp, text: accepted })
      lastMessageTimestamp = timestamp ?? lastMessageTimestamp
      characters += accepted.length
      if (accepted.length < text.length) { truncated = true; return false }
    })
    if (scan.oversizedLineCount) addExcluded(excludedBlocks, 'oversized_line', scan.oversizedLineCount)
    if (malformed) issues.push(selectionIssue(metadata.id, 'SOURCE_RECORD_SKIPPED', `已跳过${malformed}条损坏的Claude正文记录`))
    if (truncated) issues.push(selectionIssue(metadata.id, 'INPUT_HARD_LIMIT_EXCEEDED', '所选内容超过输入硬上限，预览仅保留前段且不能开始筛选'))
    return {
      turns,
      cursor: {
        sourceId: metadata.id,
        updatedAt: metadata.updatedAt,
        startOffset,
        endOffset: scan.offset,
        lastMessageTimestamp,
        contentHash: sha256(turns.map((turn) => `${turn.messageId}:${turn.text}`).join('\n'))
      },
      excludedBlocks,
      issues,
      truncated
    }
  }

  private async readCache(): Promise<z.infer<typeof claudeCacheSchema>> {
    try { return claudeCacheSchema.parse(JSON.parse(await readFile(this.cachePath, 'utf8'))) }
    catch { return { version: 1, entries: {} } }
  }

  private async writeCache(entries: Map<string, ClaudeCacheEntry>): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.cachePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, this.cachePath)
  }
}

export class ConversationSourceService {
  private readonly adapters: Record<ConversationHistorySource, ConversationSourceAdapter>
  private readonly softTokenLimit: number
  private readonly hardTokenLimit: number

  constructor(options: ConversationSourceServiceOptions) {
    this.softTokenLimit = options.softTokenLimit ?? DEFAULT_SOFT_TOKEN_LIMIT
    this.hardTokenLimit = options.hardTokenLimit ?? DEFAULT_HARD_TOKEN_LIMIT
    const maximumCharacters = this.hardTokenLimit * 2 + 1
    this.adapters = {
      codex: new CodexConversationAdapter(options.codexRoot, maximumCharacters),
      claude: new ClaudeConversationAdapter(options.claudeRoot, join(options.cacheDirectory, 'claude-conversation-metadata.json'), maximumCharacters)
    }
  }

  async listMetadata(query?: { text?: string; source?: ConversationHistorySource; limit?: number }): Promise<ConversationMetadataResult> {
    const selectedAdapters = query?.source ? [this.adapters[query.source]] : Object.values(this.adapters)
    const [sources, lists] = await Promise.all([
      Promise.all(Object.values(this.adapters).map(async (adapter) => adapter.detect())),
      Promise.all(selectedAdapters.map(async (adapter) => adapter.listMetadata()))
    ])
    const normalizedQuery = query?.text?.trim().toLocaleLowerCase() ?? ''
    const limit = Math.max(1, Math.min(query?.limit ?? 300, 1_000))
    const conversations = lists.flatMap((result) => result.metadata)
      .filter((item) => !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
    return { sources, conversations, issues: lists.flatMap((result) => result.issues) }
  }

  async prepareSelection(input: { ids: string[]; customSensitiveTerms?: string[]; afterOffsets?: Record<string, number> }): Promise<ConversationSelectionPreview> {
    const ids = [...new Set(input.ids)]
    if (ids.length === 0) throw new Error('至少选择一条对话')
    if (ids.length > 30) throw new Error('单次最多选择30条对话，请分批处理')
    const customTerms = [...new Set((input.customSensitiveTerms ?? []).map((term) => term.trim()).filter(Boolean))]
    if (customTerms.some((term) => term.length < 2 || term.length > 80) || customTerms.length > 50) throw new Error('自定义敏感词需为2—80字，最多50条')
    const codexIds = ids.filter((id) => id.startsWith('codex:'))
    const claudeIds = ids.filter((id) => id.startsWith('claude:'))
    const unknownIds = ids.filter((id) => !id.startsWith('codex:') && !id.startsWith('claude:'))
    const afterOffsets = new Map(Object.entries(input.afterOffsets ?? {}).filter(([, offset]) => Number.isSafeInteger(offset) && offset >= 0))
    const results = await Promise.all([
      this.adapters.codex.loadSelected(codexIds, afterOffsets),
      this.adapters.claude.loadSelected(claudeIds, afterOffsets)
    ])
    const excludedBlocks = new Map<string, number>()
    const issues = results.flatMap((result) => result.issues)
    for (const result of results) mergeExcluded(excludedBlocks, result.excludedBlocks)
    for (const id of unknownIds) issues.push(selectionIssue(id, 'SOURCE_ID_INVALID', '对话来源ID无效'))
    const loaded = results.flatMap((result) => result.conversations)
    const selectedById = new Map(loaded.map((conversation) => [conversation.metadata.id, conversation]))
    const ordered = ids.flatMap((id) => selectedById.has(id) ? [selectedById.get(id)!] : [])
    const rawContent = ordered.map((conversation) => {
      const turns = conversation.turns.map((turn) => `[${turn.role === 'user' ? '用户' : '助手'}｜message_id=${turn.messageId}]\n${turn.text}`).join('\n\n')
      return `===== 对话数据开始｜source=${conversation.metadata.source}｜source_id=${conversation.metadata.id} =====\n${turns}\n===== 对话数据结束｜source_id=${conversation.metadata.id} =====`
    }).join('\n\n')
    const { sanitizedContent, findings } = scanAndSanitizeContent(rawContent, customTerms)
    const estimatedTokens = Math.ceil(sanitizedContent.length / 2)
    const truncated = results.some((result) => result.truncated)
    const noUsableText = ordered.reduce((total, conversation) => total + conversation.turns.length, 0) === 0
    if (noUsableText) issues.push(selectionIssue(null, 'NO_USABLE_TEXT', '所选记录中没有可发送的普通用户或助手文本'))
    const blocked = noUsableText || truncated || estimatedTokens > this.hardTokenLimit
    const warning = !blocked && estimatedTokens > this.softTokenLimit
    if ((truncated || estimatedTokens > this.hardTokenLimit) && !issues.some((issue) => issue.code === 'INPUT_HARD_LIMIT_EXCEEDED')) issues.push(selectionIssue(null, 'INPUT_HARD_LIMIT_EXCEEDED', '所选内容超过输入硬上限，请减少会话或改用手动分段导入'))
    const budget = blocked
      ? { status: 'blocked' as const, message: noUsableText ? '没有可发送的普通对话文本，不能开始筛选' : '已超过硬上限，不能开始筛选；请减少会话或分批处理' }
      : warning
        ? { status: 'warning' as const, message: '输入规模较大，建议分批筛选以减少等待和模型用量' }
        : { status: 'within' as const, message: '输入规模在第一期安全预算内' }
    return {
      selected: ordered.map((conversation) => conversation.metadata),
      sanitizedContent,
      contentSha256: sha256(sanitizedContent),
      sourceCursors: ordered.map((conversation) => conversation.cursor),
      privacy: {
        findingCount: findings.length,
        findingKinds: [...new Set(findings.map((finding) => finding.kind))],
        customSensitiveTermCount: customTerms.length
      },
      excludedBlocks: [...excludedBlocks.entries()].map(([blockType, count]): ConversationExcludedBlockSummary => ({ blockType, count })).sort((left, right) => right.count - left.count || left.blockType.localeCompare(right.blockType)),
      input: {
        conversationCount: ordered.length,
        turnCount: ordered.reduce((total, conversation) => total + conversation.turns.length, 0),
        characterCount: sanitizedContent.length,
        estimatedTokens,
        truncated
      },
      budget: { ...budget, softTokenLimit: this.softTokenLimit, hardTokenLimit: this.hardTokenLimit },
      issues
    }
  }
}
