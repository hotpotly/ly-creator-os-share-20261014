import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { TaskRunner } from '../../src/main/task-runner'
import { structuredReferenceSourceKey } from '../../src/main/content-instruction-request'
import type { ContentProviderInputSnapshot } from '../../src/main/content-provider-input'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS, type StructuredReferenceUse, type TaskRun } from '../../src/shared/domain'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; root: string }> {
  await mkdir(unitRoot, { recursive: true })
  const root = await mkdtemp(join(unitRoot, 'creator-os-r16e-image-'))
  roots.push(root)
  const store = await openWorkspaceStore(root)
  stores.push(store)
  return { store, root }
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('R16e writing image sandbox', () => {
  it('copies a project-owned hash-verified image into a private TaskRun directory', async () => {
    const { store, root } = await createStore()
    const bytes = Buffer.from('r16e-image-bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const locator = 'managed-files/r16e/reference.png'
    const sourcePath = join(root, locator)
    await mkdir(join(root, 'managed-files/r16e'), { recursive: true })
    await writeFile(sourcePath, bytes)
    store.repository.createProjectAssetMaterial({
      projectId: 'ios', role: 'project_material', title: '写作外观图', usageType: 'parameter_fact', entries: [{
        parentFileId: null, importRelativePath: 'reference.png', file: {
          id: 'r16e-task-image-file', relativePath: locator, managedLocator: locator, originalName: 'reference.png',
          sha256, sizeBytes: bytes.byteLength, mimeType: 'image/png', availability: 'available', processState: 'ready',
          createdAt: '2026-08-05T00:00:00.000Z'
        }
      }]
    })
    const catalog = store.repository.listStructuredReferenceCatalog('ios', 'r16e-image-task')
    const image = catalog.find((item) => item.sourceKind === 'project_image' && item.label === 'reference.png')!
    const reference: StructuredReferenceUse = {
      occurrenceId: 'occurrence-r16e-image', sourceKey: structuredReferenceSourceKey('ios', 'project_image', image.sourceId),
      sourceKind: 'project_image', sourceId: image.sourceId, sourceLocator: {}, label: image.label,
      role: 'ordinary_reference', roleOrigin: 'manual', runtimeRole: 'ordinary_reference', aspect: '外观', scope: 'whole_source',
      ruleEvidence: null, ruleConflicts: [], manualConflictResolution: null
    }
    const providerSecurity = {
      provider: 'codex_cli' as const, providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, displayName: 'Codex CLI',
      cliVersion: 'test', fingerprint: 'r16e-image-fingerprint', policyVersion: 'test-policy'
    }
    const record = store.repository.prepareContentInstructionRequest({
      projectId: 'ios', sessionScope: 'r16e-image-task', surface: 'script_conversation', target: null,
      displayText: '参考@reference.png描述外观', editorDocument: { type: 'doc', content: [] }, references: [reference], constraints: [],
      includeProjectContext: false, webSearchMode: 'disabled', factRegion: '中国大陆', factAsOf: '2026-08-05T00:00:00.000Z',
      aiCount: 1, targets: [{
        providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, providerSecurity,
        requestedModel: 'gpt-5.6-sol', actualModel: 'gpt-5.6-sol', requestedReasoningEffort: 'xhigh', actualReasoningEffort: 'xhigh',
        historyThreadId: null, providerThreadId: null, historyMessageIds: [], historyHash: 'a'.repeat(64)
      }]
    })
    const task = store.repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: 'R16e写作图片', provider: 'codex_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    const input = store.repository.bindContentProviderInput(record.request.id, record.targets[0]!.id, task.id)
    const runner = new TaskRunner(store, () => undefined)
    vi.spyOn(runner, 'getImageProviderExecutionContext').mockResolvedValue({
      provider: 'codex_cli', cliVersion: 'test', fingerprint: 'image-security', policyVersion: 'test'
    })
    const taskDirectory = join(root, 'task-sandboxes', task.id)
    await mkdir(taskDirectory, { recursive: true, mode: 0o700 })
    const stage = runner as unknown as {
      prepareContentProviderImages(task: TaskRun, taskDirectory: string, input: ContentProviderInputSnapshot): Promise<string[]>
      assertProviderRuntimeMatchesFrozenInput(
        input: ContentProviderInputSnapshot,
        runtime: { model: string; reasoningEffort: string; webSearchMode: 'automatic' | 'required' | 'disabled' }
      ): void
    }
    const paths = await stage.prepareContentProviderImages(task, taskDirectory, input)

    expect(paths).toHaveLength(1)
    expect(await readFile(paths[0]!)).toEqual(bytes)
    expect((await stat(join(taskDirectory, 'input-assets'))).mode & 0o777).toBe(0o700)
    expect((await stat(paths[0]!)).mode & 0o777).toBe(0o600)
    expect(() => stage.assertProviderRuntimeMatchesFrozenInput(input, {
      model: 'gpt-5.5', reasoningEffort: 'xhigh', webSearchMode: 'disabled'
    })).toThrow('PROVIDER_RUNTIME_MODEL_DRIFT')

    await writeFile(sourcePath, Buffer.from('r16e-image-BYTES'))
    const secondDirectory = join(root, 'task-sandboxes', `${task.id}-tampered`)
    await mkdir(secondDirectory, { recursive: true, mode: 0o700 })
    await expect(stage.prepareContentProviderImages(task, secondDirectory, input)).rejects.toThrow(/CONTENT_IMAGE_/u)
  })
})
