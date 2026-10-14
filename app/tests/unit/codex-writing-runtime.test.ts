import { describe, expect, it } from 'vitest'
import { buildCodexWritingAppServerArguments, buildCodexWritingSandboxProfile, chooseCodexWritingModel, type CodexModel } from '../../src/main/codex-writing-runtime'

function model(id: string, efforts: string[], isDefault = false): CodexModel {
  return {
    id,
    model: id,
    isDefault,
    hidden: false,
    defaultReasoningEffort: efforts[0] ?? 'medium',
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort }))
  }
}

describe('Codex writing runtime', () => {
  it('selects the highest available flagship and its highest supported reasoning effort', () => {
    expect(chooseCodexWritingModel([
      model('gpt-5.4-mini', ['low', 'high'], true),
      model('gpt-5.4', ['low', 'medium', 'high', 'xhigh']),
      model('gpt-5.5', ['low', 'medium', 'high', 'xhigh'])
    ])).toMatchObject({ model: { id: 'gpt-5.5' }, reasoningEffort: 'xhigh' })

    expect(chooseCodexWritingModel([
      model('gpt-5.5', ['xhigh']),
      model('gpt-5.6-sol', ['low', 'high', 'max', 'ultra'])
    ])).toMatchObject({ model: { id: 'gpt-5.6-sol' }, reasoningEffort: 'ultra' })
  })

  it('honors an available user-selected model and rejects a stale selection', () => {
    const models = [
      model('gpt-5.6-sol', ['high', 'ultra'], true),
      model('gpt-5.6-terra', ['medium', 'max'])
    ]
    expect(chooseCodexWritingModel(models, 'gpt-5.6-terra')).toMatchObject({
      model: { id: 'gpt-5.6-terra' },
      reasoningEffort: 'max'
    })
    expect(() => chooseCodexWritingModel(models, 'gpt-retired')).toThrow('CODEX_WRITING_SELECTED_MODEL_UNAVAILABLE')
  })

  it('limits outer writes to the task and dedicated runtime directories', () => {
    const profile = buildCodexWritingSandboxProfile({
      provider: 'codex_cli',
      executablePath: '/opt/homebrew/lib/node_modules/@openai/codex/vendor/bin/codex',
      version: 'test',
      fingerprint: 'test'
    }, '/tmp/creator-task', '/tmp/creator-runtime')
    expect(profile).toContain('(subpath "/tmp/creator-task")')
    expect(profile).toContain('(subpath "/tmp/creator-runtime")')
    expect(profile).toContain('(subpath "/opt/homebrew")')
    expect(profile).not.toContain('(allow file-write* (subpath "/Users/')
  })

  it('uses only current app-server feature flags', () => {
    const argumentsList = buildCodexWritingAppServerArguments('disabled')
    expect(argumentsList).not.toContain('sleep_tool')
    expect(argumentsList).toContain('standalone_web_search')
    expect(argumentsList).toContain('workspace_dependencies')
  })
})
