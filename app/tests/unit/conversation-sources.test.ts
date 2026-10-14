import { afterEach, describe, expect, it } from 'vitest'
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeConversationAdapter, CodexConversationAdapter, ConversationSourceService } from '../../src/main/conversation-sources'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit-conversation-sources')

async function createRoot(name: string): Promise<string> {
  const root = join(unitRoot, `${name}-${crypto.randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

async function writeJsonLines(filePath: string, records: unknown[]): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
}

function codexMessage(role: 'user' | 'assistant' | 'developer', text: string, timestamp = '2026-07-20T08:00:00.000Z'): unknown {
  return {
    type: 'response_item', timestamp,
    payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] }
  }
}

function claudeMessage(role: 'user' | 'assistant', content: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    type: role, uuid: crypto.randomUUID(), timestamp: '2026-07-20T09:00:00.000Z', isSidechain: false,
    message: { role, content }, ...extra
  }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('conversation source adapters', () => {
  it('lists Codex metadata without exposing paths and loads only user/assistant text after selection', async () => {
    const root = await createRoot('codex')
    const sessionId = '019f-test-session-0001'
    await writeJsonLines(join(root, 'session_index.jsonl'), [{ id: sessionId, thread_name: 'Codex选择测试', updated_at: '2026-07-20T08:00:00.000Z' }])
    await writeJsonLines(join(root, 'sessions', '2026', '07', `rollout-${sessionId}.jsonl`), [
      { type: 'session_meta', payload: { cwd: '/private/project' } },
      codexMessage('user', '用户真实体验'),
      { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: 'TOOL_CANARY' } },
      codexMessage('developer', 'SYSTEM_CANARY'),
      codexMessage('assistant', '助手给出的判断\n```ts\nconst secretCode = true\n```\n保留结论')
    ])
    const adapter = new CodexConversationAdapter(root)

    const listed = await adapter.listMetadata()
    expect(listed.metadata).toEqual([expect.objectContaining({ id: `codex:${sessionId}`, source: 'codex', title: 'Codex选择测试', sizeBytes: null })])
    expect(JSON.stringify(listed)).not.toContain('/private/project')
    expect(JSON.stringify(listed)).not.toContain('用户真实体验')

    const loaded = await adapter.loadSelected([`codex:${sessionId}`])
    expect(loaded.conversations[0]?.turns.map((turn) => [turn.role, turn.text])).toEqual([['user', '用户真实体验'], ['assistant', '助手给出的判断\n[已排除代码块]\n保留结论']])
    expect(JSON.stringify(loaded)).not.toContain('TOOL_CANARY')
    expect(JSON.stringify(loaded)).not.toContain('SYSTEM_CANARY')
    expect(JSON.stringify(loaded)).not.toContain('secretCode')
    expect(loaded.excludedBlocks.get('tool_use')).toBe(1)
    expect(loaded.excludedBlocks.get('role_developer')).toBe(1)
    expect(loaded.excludedBlocks.get('code_block')).toBe(1)
  })

  it('reads only the appended JSONL tail after a successful source cursor', async () => {
    const root = await createRoot('codex-tail')
    const sessionId = '019f-tail-session-0001'
    const publicId = `codex:${sessionId}`
    const sessionPath = join(root, 'sessions', `rollout-${sessionId}.jsonl`)
    await writeJsonLines(join(root, 'session_index.jsonl'), [{ id: sessionId, thread_name: '增量尾部测试', updated_at: '2026-07-20T08:00:00.000Z' }])
    await writeJsonLines(sessionPath, [codexMessage('user', '首次扫描正文')])
    const adapter = new CodexConversationAdapter(root)

    const first = await adapter.loadSelected([publicId])
    const offset = first.conversations[0]!.cursor.endOffset
    await appendFile(sessionPath, `${JSON.stringify(codexMessage('assistant', '只应读取新增消息', '2026-07-20T10:00:00.000Z'))}\n`)
    const incremental = await adapter.loadSelected([publicId], new Map([[publicId, offset]]))

    expect(incremental.conversations[0]?.turns.map((turn) => turn.text)).toEqual(['只应读取新增消息'])
    expect(incremental.conversations[0]?.cursor).toMatchObject({ startOffset: offset, endOffset: (await stat(sessionPath)).size, lastMessageTimestamp: '2026-07-20T10:00:00.000Z' })
    expect(JSON.stringify(incremental)).not.toContain('首次扫描正文')
  })

  it('builds an incremental Claude title cache without persisting message bodies', async () => {
    const root = await createRoot('claude-cache')
    const projects = join(root, 'projects')
    const cachePath = join(root, 'cache', 'claude.json')
    const filePath = join(projects, 'project-a', 'session-a.jsonl')
    await writeJsonLines(filePath, [
      claudeMessage('user', 'PRIVATE_BODY_NEVER_CACHE'),
      { type: 'ai-title', sessionId: 'session-a', aiTitle: 'AI旧标题' },
      { type: 'custom-title', sessionId: 'session-a', customTitle: '用户标题' }
    ])
    const adapter = new ClaudeConversationAdapter(projects, cachePath)

    const first = await adapter.listMetadata()
    expect(first.metadata[0]).toMatchObject({ source: 'claude', title: '用户标题' })
    const firstCache = await readFile(cachePath, 'utf8')
    expect(firstCache).not.toContain('PRIVATE_BODY_NEVER_CACHE')
    expect(firstCache).not.toContain(filePath)
    const firstSize = (await stat(filePath)).size
    expect(firstCache).toContain(`"offset":${firstSize}`)

    await appendFile(filePath, `${JSON.stringify({ type: 'ai-title', sessionId: 'session-a', aiTitle: 'AI新标题' })}\n`)
    const second = await adapter.listMetadata()
    expect(second.metadata[0]?.title).toBe('用户标题')
    const secondCache = await readFile(cachePath, 'utf8')
    const secondSize = (await stat(filePath)).size
    expect(secondCache).toContain(`"offset":${secondSize}`)
    expect(secondCache).toContain('AI新标题')
    expect(secondCache).not.toContain('PRIVATE_BODY_NEVER_CACHE')
  })

  it('prepares a mixed sanitized preview and excludes unselected, tool, thinking and sidechain content', async () => {
    const root = await createRoot('mixed')
    const codexRoot = join(root, 'codex')
    const claudeRoot = join(root, 'claude')
    const selectedCodexId = '019f-selected-codex-0001'
    const unselectedCodexId = '019f-unselected-codex-02'
    await writeJsonLines(join(codexRoot, 'session_index.jsonl'), [
      { id: selectedCodexId, thread_name: '选中的Codex', updated_at: '2026-07-20T08:00:00.000Z' },
      { id: unselectedCodexId, thread_name: '未选择Codex', updated_at: '2026-07-19T08:00:00.000Z' }
    ])
    await writeJsonLines(join(codexRoot, 'sessions', `rollout-${selectedCodexId}.jsonl`), [codexMessage('user', '我的电话是13800138000，秘密品牌的体验很好')])
    await writeJsonLines(join(codexRoot, 'sessions', `rollout-${unselectedCodexId}.jsonl`), [codexMessage('user', 'UNSELECTED_CANARY')])
    await writeJsonLines(join(claudeRoot, 'project-a', 'session-a.jsonl'), [
      { type: 'ai-title', sessionId: 'session-a', aiTitle: '选中的Claude' },
      claudeMessage('user', [{ type: 'text', text: '联系邮箱test@example.com' }, { type: 'tool_result', content: 'TOOL_CANARY' }]),
      claudeMessage('assistant', [{ type: 'thinking', thinking: 'THINKING_CANARY' }, { type: 'text', text: '这是可以保留的方法' }]),
      claudeMessage('assistant', [{ type: 'text', text: 'SIDECHAIN_CANARY' }], { isSidechain: true })
    ])
    const service = new ConversationSourceService({ cacheDirectory: join(root, 'cache'), codexRoot, claudeRoot })
    const listed = await service.listMetadata({ limit: 20 })
    const claudeId = listed.conversations.find((item) => item.source === 'claude')?.id
    expect(claudeId).toBeTruthy()

    const preview = await service.prepareSelection({ ids: [`codex:${selectedCodexId}`, claudeId!], customSensitiveTerms: ['秘密品牌'] })
    expect(preview.selected.map((item) => item.source)).toEqual(['codex', 'claude'])
    expect(preview.sanitizedContent).toContain('[已遮盖手机号]')
    expect(preview.sanitizedContent).toContain('[已遮盖邮箱]')
    expect(preview.sanitizedContent).toContain('[已遮盖自定义敏感词]')
    expect(preview.sanitizedContent).not.toMatch(/13800138000|test@example\.com|秘密品牌|UNSELECTED_CANARY|TOOL_CANARY|THINKING_CANARY|SIDECHAIN_CANARY/)
    expect(preview.excludedBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockType: 'tool_result', count: 1 }),
      expect.objectContaining({ blockType: 'thinking', count: 1 }),
      expect.objectContaining({ blockType: 'sidechain', count: 1 })
    ]))
    expect(preview.budget.status).toBe('within')
    expect(preview.privacy.findingKinds).toEqual(expect.arrayContaining(['phone', 'email', 'custom_sensitive']))
    expect(JSON.stringify(preview.selected)).not.toContain(root)
  })

  it('blocks oversized input instead of silently truncating it', async () => {
    const root = await createRoot('budget')
    const codexRoot = join(root, 'codex')
    const claudeRoot = join(root, 'claude')
    const sessionId = '019f-budget-codex-0001'
    await writeJsonLines(join(codexRoot, 'session_index.jsonl'), [{ id: sessionId, thread_name: '超长输入', updated_at: '2026-07-20T08:00:00.000Z' }])
    await writeJsonLines(join(codexRoot, 'sessions', `rollout-${sessionId}.jsonl`), [codexMessage('user', '长'.repeat(300))])
    await mkdir(claudeRoot, { recursive: true })
    const service = new ConversationSourceService({ cacheDirectory: join(root, 'cache'), codexRoot, claudeRoot, softTokenLimit: 10, hardTokenLimit: 20 })

    const preview = await service.prepareSelection({ ids: [`codex:${sessionId}`] })
    expect(preview.budget.status).toBe('blocked')
    expect(preview.input.truncated).toBe(true)
    expect(preview.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INPUT_HARD_LIMIT_EXCEEDED' })]))
  })

  it('skips a damaged selected record without blocking valid turns', async () => {
    const root = await createRoot('damaged')
    const sessionId = '019f-damaged-codex-01'
    await writeJsonLines(join(root, 'session_index.jsonl'), [{ id: sessionId, thread_name: '损坏记录', updated_at: '2026-07-20T08:00:00.000Z' }])
    const sessionPath = join(root, 'sessions', `rollout-${sessionId}.jsonl`)
    await mkdir(join(root, 'sessions'), { recursive: true })
    await writeFile(sessionPath, `{not-json}\n${JSON.stringify(codexMessage('user', '仍然可读取的正文'))}\n`, 'utf8')
    const adapter = new CodexConversationAdapter(root)

    const loaded = await adapter.loadSelected([`codex:${sessionId}`])
    expect(loaded.conversations[0]?.turns[0]?.text).toBe('仍然可读取的正文')
    expect(loaded.issues).toEqual([expect.objectContaining({ code: 'SOURCE_RECORD_SKIPPED' })])
  })
})
