import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractContentAtomDrafts, scanAndSanitizeContent } from '../../src/main/content-engine'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const directories: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-content-engine-'))
  directories.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('AI conversation content engine', () => {
  it('redacts credentials and private data before atom extraction', () => {
    const raw = '我的token: sk-test_12345678901234567890，手机号13800138000，邮箱me@example.com。\n这段内部资料严格保密，禁止外传。'
    const scanned = scanAndSanitizeContent(raw)
    expect(scanned.sanitizedContent).not.toContain('sk-test_12345678901234567890')
    expect(scanned.sanitizedContent).not.toContain('13800138000')
    expect(scanned.sanitizedContent).not.toContain('me@example.com')
    expect(scanned.findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(['credential', 'phone', 'email', 'possible_private']))
    expect(extractContentAtomDrafts(scanned.sanitizedContent).every((atom) => !atom.content.includes('13800138000'))).toBe(true)
  })

  it('persists traceable atoms, immutable derivation snapshots and project provenance', async () => {
    const { store, directory } = await createStore()
    const rawContent = [
      '我最近用Codex整理一个真实项目，一开始只想解决重复复制资料的问题。',
      '第一次执行时因为把token: sk-test_12345678901234567890直接贴进对话而报错，这是一个明显的踩坑点。',
      '解决方法是先限定本次读取范围，然后遮盖密钥，再把内容切成可以人工保留的洞察卡。',
      '相比直接把整段聊天变成文案，这种方式更容易检查来源，也更适合继续派生X内容。'
    ].join('\n\n')
    const imported = store.repository.importContentSource({ sourceKind: 'codex_export', title: 'Codex真实项目复盘', scopeLabel: '手动选择的四段对话', rawContent })
    expect(imported.source.privacyFindings.some((finding) => finding.kind === 'credential')).toBe(true)
    expect(imported.source.sanitizedContent).not.toContain('sk-test_')
    expect(imported.atoms.length).toBeGreaterThanOrEqual(3)
    expect('rawContent' in imported.source).toBe(false)

    const duplicate = store.repository.importContentSource({ sourceKind: 'codex_export', title: '重复导入', scopeLabel: '同一范围', rawContent })
    expect(duplicate.atoms).toHaveLength(0)
    expect(duplicate.duplicateAtomCount).toBe(imported.atoms.length)

    const selected = imported.atoms.slice(0, 2)
    for (const atom of selected) store.repository.setContentAtomStatus(atom.id, 'kept')
    const merged = store.repository.mergeContentAtoms(selected.map((atom) => atom.id), '一次可追溯的AI实践')
    expect(merged).toMatchObject({ status: 'kept', mergedFromIds: selected.map((atom) => atom.id) })
    expect(store.repository.getContentEngineSnapshot().atoms.filter((atom) => selected.some((item) => item.id === atom.id)).every((atom) => atom.status === 'merged')).toBe(true)

    const preparation = store.repository.prepareContentDerivation()
    expect(preparation).toMatchObject({ contentTypeId: 'type-ai', templateId: 'template-ai-tutorial' })
    expect(preparation.automaticResources.map((resource) => resource.name)).toContain('AI基础风格')

    const candidate = store.repository.createContentDerivative({ atomIds: [merged.id], outputType: 'x_thread' })
    expect(candidate.status).toBe('candidate')
    expect(candidate.derivationSnapshot.atoms[0]).toMatchObject({ id: merged.id, sourceRefs: expect.any(Array) })
    expect(candidate.derivationSnapshot.recommendedResources.map((resource) => resource.name)).toContain('真实体验叙事参考')
    const frozenSnapshot = structuredClone(candidate.derivationSnapshot)

    const confirmed = store.repository.confirmContentDerivative(candidate.id, `${candidate.currentContent}\n\n人工补充结尾。`)
    expect(confirmed).toMatchObject({ status: 'confirmed' })
    expect(confirmed.generatedContent).toBe(candidate.generatedContent)
    expect(confirmed.derivationSnapshot).toEqual(frozenSnapshot)
    expect(store.repository.getConfirmedContentForCopy(candidate.id)).toContain('人工补充结尾')

    const project = store.repository.createProjectFromContentDerivative(candidate.id, { title: '从对话到X内容', contentTypeId: 'type-ai', templateId: 'template-ai-tutorial' })
    const sourceVersion = project.versions.find((version) => version.kind === 'content_candidate')
    expect(sourceVersion).toMatchObject({ sourceCandidateId: candidate.id })
    expect(store.repository.getContentDerivative(candidate.id)).toMatchObject({ status: 'project_created', projectId: project.id, draftVersionId: sourceVersion?.id })
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getContentEngineSnapshot().derivatives.find((item) => item.id === candidate.id)).toMatchObject({ status: 'project_created', projectId: project.id })
    reopened.close()
  })
})
