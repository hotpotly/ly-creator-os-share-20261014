import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { buildScriptDocx } from '../../src/main/docx-export'
import { feishuClipboardText, feishuWordFileName, normalizeFeishuDocumentUrl } from '../../src/main/feishu-handoff'

const directories: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit-feishu')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-feishu-'))
  directories.push(directory)
  const store = await openWorkspaceStore(directory)
  stores.push(store)
  return { store, directory }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('feishu first-version handoff', () => {
  it('accepts only Feishu/Lark document HTTPS links', () => {
    expect(normalizeFeishuDocumentUrl('https://my.feishu.cn/docx/abc?from=copy')).toBe('https://my.feishu.cn/docx/abc?from=copy')
    expect(normalizeFeishuDocumentUrl('https://example.larksuite.com/wiki/xyz')).toBe('https://example.larksuite.com/wiki/xyz')
    expect(normalizeFeishuDocumentUrl('')).toBeNull()
    for (const url of [
      'http://my.feishu.cn/docx/abc',
      'https://evil.example/docx/abc',
      'https://user:pass@my.feishu.cn/docx/abc',
      'https://my.feishu.cn/'
    ]) expect(() => normalizeFeishuDocumentUrl(url)).toThrow('只允许保存飞书或Lark的HTTPS文档链接')
  })

  it('copies clean plain text without editor marks or dangerous block contents', () => {
    const text = feishuClipboardText('AI浏览器', '<h2>结论</h2><p><mark data-link-index="2" data-color="#fff">真实体验</mark></p><script>steal()</script><style>.secret{}</style>')
    expect(text).toBe('AI浏览器\n\n结论\n\n真实体验')
    expect(text).not.toMatch(/data-link|steal|secret|<mark/)
    expect(feishuWordFileName('项目/标题', '我的:账号')).toBe('项目-标题-我的-账号-飞书.docx')
  })

  it('removes nested dangerous blocks from the exported Word document', async () => {
    const bytes = await buildScriptDocx(
      '飞书送审',
      '<p>可见正文<script>outer<script>inner</script>HIDDEN_SCRIPT</script><style>outer<style>inner</style>HIDDEN_STYLE</style><template><svg><text>HIDDEN_SVG</text></svg>HIDDEN_TEMPLATE</template>结尾</p>'
    )
    const archive = await JSZip.loadAsync(bytes)
    const documentXml = await archive.file('word/document.xml')!.async('string')
    expect(documentXml).toContain('可见正文')
    expect(documentXml).toContain('结尾')
    expect(documentXml).not.toMatch(/HIDDEN_SCRIPT|HIDDEN_STYLE|HIDDEN_SVG|HIDDEN_TEMPLATE|outer|inner/)
    const copied = feishuClipboardText(
      '飞书送审',
      '<p>可见<script>outer<script>inner</script>HIDDEN_SCRIPT</script><template><svg>HIDDEN_SVG</svg></template>结尾</p>'
    )
    expect(copied).toContain('可见结尾')
    expect(copied).not.toMatch(/HIDDEN_SCRIPT|HIDDEN_SVG|outer|inner/)
  })

  it('binds every record to the current final version and persists account, mode and original link', async () => {
    const { store, directory } = await createStore()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>确定送审正文</p>')
    const finalVersion = store.repository.setFinalVersion('ai-browser', draft.id)
    const common = {
      id: crypto.randomUUID(),
      projectId: 'ai-browser',
      sourceVersionId: finalVersion.id,
      targetHandoffId: null,
      accountName: '我的飞书账号',
      contentSha256: 'a'.repeat(64)
    }
    const created = store.repository.saveFeishuHandoff({ ...common, mode: 'new_document', documentUrl: null, markCopied: true })
    expect(created).toMatchObject({ mode: 'new_document', accountName: '我的飞书账号', documentUrl: null, copiedAt: expect.any(String), wordExportedAt: null })
    expect(() => store.repository.saveFeishuHandoff({ ...common, id: crypto.randomUUID(), mode: 'merge_update', documentUrl: null })).toThrow('必须选择另一条已保存')
    expect(() => store.repository.saveFeishuHandoff({
      ...common,
      id: crypto.randomUUID(),
      targetHandoffId: crypto.randomUUID(),
      mode: 'merge_update',
      documentUrl: 'https://my.feishu.cn/docx/not-saved'
    })).toThrow('必须选择当前项目已保存')
    const linked = store.repository.saveFeishuHandoff({ ...common, mode: 'new_document', documentUrl: 'https://my.feishu.cn/docx/abc' })
    const mergeId = crypto.randomUUID()
    expect(() => store.repository.saveFeishuHandoff({
      ...common,
      id: mergeId,
      targetHandoffId: linked.id,
      mode: 'merge_update',
      documentUrl: 'https://my.feishu.cn/docx/other'
    })).toThrow('不能替换已保存')
    const merged = store.repository.saveFeishuHandoff({
      ...common,
      id: mergeId,
      targetHandoffId: linked.id,
      mode: 'merge_update',
      documentUrl: linked.documentUrl,
      markWordExported: true
    })
    expect(merged).toMatchObject({ mode: 'merge_update', targetHandoffId: linked.id, documentUrl: 'https://my.feishu.cn/docx/abc', wordExportedAt: expect.any(String) })

    const replacement = store.repository.saveScript('ai-browser', 'user_edit', '<p>新的定稿</p>')
    const replacementFinal = store.repository.setFinalVersion('ai-browser', replacement.id)
    expect(() => store.repository.saveFeishuHandoff({ ...common, mode: 'new_document', documentUrl: null })).toThrow('定稿已经变化')
    expect(() => store.repository.saveFeishuHandoff({
      ...common,
      sourceVersionId: replacementFinal.id,
      contentSha256: 'b'.repeat(64),
      mode: 'new_document',
      documentUrl: linked.documentUrl,
      markCopied: true
    })).toThrow('已经绑定旧定稿')
    expect(store.repository.getFeishuHandoff('ai-browser', common.id)).toMatchObject({
      sourceVersionId: finalVersion.id,
      contentSha256: 'a'.repeat(64)
    })
    const replacementMerge = store.repository.saveFeishuHandoff({
      ...common,
      id: crypto.randomUUID(),
      sourceVersionId: replacementFinal.id,
      targetHandoffId: linked.id,
      mode: 'merge_update',
      documentUrl: linked.documentUrl,
      contentSha256: 'b'.repeat(64),
      markCopied: true
    })
    const beforeRestart = store.repository.listFeishuHandoffs('ai-browser')
    expect(beforeRestart).toHaveLength(3)
    expect(beforeRestart.find((record) => record.id === linked.id)?.sourceVersionId).toBe(finalVersion.id)
    expect(beforeRestart.find((record) => record.id === merged.id)?.sourceVersionId).toBe(finalVersion.id)
    expect(replacementMerge.sourceVersionId).toBe(replacementFinal.id)

    store.close()
    stores.splice(stores.indexOf(store), 1)
    const reopened = await openWorkspaceStore(directory)
    stores.push(reopened)
    expect(reopened.repository.listFeishuHandoffs('ai-browser')).toHaveLength(3)
    expect(reopened.repository.getFeishuHandoff('ai-browser', common.id)).toMatchObject({
      accountName: '我的飞书账号',
      documentUrl: 'https://my.feishu.cn/docx/abc',
      sourceVersionId: finalVersion.id,
      targetHandoffId: null
    })
  })

  it('rejects a handoff id that already belongs to another project', async () => {
    const { store } = await createStore()
    const first = store.repository.saveScript('ai-browser', 'user_edit', '<p>项目一</p>')
    store.repository.setFinalVersion('ai-browser', first.id)
    const id = crypto.randomUUID()
    store.repository.saveFeishuHandoff({
      id, projectId: 'ai-browser', sourceVersionId: first.id, targetHandoffId: null, mode: 'new_document', accountName: '账号一',
      documentUrl: null, contentSha256: 'a'.repeat(64)
    })
    const second = store.repository.saveScript('ios', 'user_edit', '<p>项目二</p>')
    store.repository.setFinalVersion('ios', second.id)
    expect(() => store.repository.saveFeishuHandoff({
      id, projectId: 'ios', sourceVersionId: second.id, targetHandoffId: null, mode: 'new_document', accountName: '账号二',
      documentUrl: null, contentSha256: 'b'.repeat(64)
    })).toThrow('与项目不匹配')
  })
})
