import { describe, expect, it } from 'vitest'
import { parseStructuredProviderOutput } from '../../src/main/provider-execution'

describe('Claude structured writing runtime', () => {
  it('captures the advertised model, session and auditable web tool records from stream-json', () => {
    const events = [{
      type: 'system', subtype: 'init', session_id: 'claude-session-r16e', model: 'claude-opus-4-8'
    }, {
      type: 'assistant', message: { content: [{
        type: 'tool_use', id: 'tool-web-search-r16e', name: 'WebSearch', input: { query: 'MX Master 4 官方原价' }
      }] }
    }, {
      type: 'user', timestamp: '2026-08-05T00:00:02.000Z', message: { content: [{
        type: 'tool_result', tool_use_id: 'tool-web-search-r16e', content: '查到 https://www.logitech.com/example '
      }] }
    }, {
      type: 'assistant', message: { content: [{
        type: 'tool_use', id: 'tool-web-fetch-r16e', name: 'WebFetch', input: { url: 'https://www.logitech.com/product' }
      }] }
    }, {
      type: 'user', timestamp: '2026-08-05T00:00:04.000Z', message: { content: [{
        type: 'tool_result', tool_use_id: 'tool-web-fetch-r16e', content: '页面正文 https://www.logitech.com/product#specs '
      }] }
    }, {
      type: 'result', is_error: false, session_id: 'claude-session-r16e',
      structured_output: { answer: '已核验' }, modelUsage: { 'claude-opus-4-8': {} }
    }]
    const result = parseStructuredProviderOutput('claude_cli', events.map((event) => JSON.stringify(event)).join('\n'))

    expect(result).toMatchObject({
      structuredOutput: { answer: '已核验' },
      providerThreadId: 'claude-session-r16e',
      model: 'claude-opus-4-8'
    })
    expect(result.webSearches).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'search', runtimeAccessId: 'tool-web-search-r16e' }),
      expect.objectContaining({ type: 'search', url: 'https://www.logitech.com/example', runtimeAccessId: 'tool-web-search-r16e' }),
      expect.objectContaining({ type: 'open_page', url: 'https://www.logitech.com/product', runtimeAccessId: 'tool-web-fetch-r16e' })
    ]))
    expect(result.webSearches).toContainEqual(expect.objectContaining({
      type: 'open_page', runtimeAccessId: 'tool-web-fetch-r16e', accessedAt: '2026-08-05T00:00:04.000Z'
    }))
    expect(result.webSearches).not.toContainEqual(expect.objectContaining({ type: 'open_page', runtimeAccessId: 'tool-web-search-r16e' }))
  })
})
