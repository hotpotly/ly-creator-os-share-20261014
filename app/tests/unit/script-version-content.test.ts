import { describe, expect, it } from 'vitest'
import { renderCurrentScriptEditorDocumentHtml } from '../../src/main/db/current-script-document'
import { richTextHtmlToPlainText, sourceContentToRichTextHtml, stripScriptWorkbenchAnnotations } from '../../src/shared/script-version-content'

describe('version comparison rich text conversion', () => {
  it('turns Markdown and plain text into safe editable rich text', () => {
    const html = sourceContentToRichTextHtml('# 标题\n\n**重点**与<script>alert(1)</script>\n\n- 第一项\n- 第二项')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<ul><li>第一项</li><li>第二项</li></ul>')
  })

  it('sanitizes imported HTML while preserving supported formatting and highlight color', () => {
    const html = sourceContentToRichTextHtml('<p onclick="alert(1)">正文<script>alert(2)</script><strong>重点</strong><img src=x onerror=alert(3)><mark style="background-color: #F3D9A3">标记</mark></p>')
    expect(html).toBe('<p>正文<strong>重点</strong><mark data-color="#F3D9A3" style="background-color: #F3D9A3; color: inherit">标记</mark></p>')
  })

  it('preserves safe local relationship metadata and strips executable span attributes', () => {
    const html = sourceContentToRichTextHtml('<p><span class="bad" onclick="alert(1)" data-script-material-relation-id="relation-1" data-script-material-draft-id="draft-1" data-script-material-draft-paragraph-ids="p1,p2" data-script-material-source-point-ids="s1,s2">正文</span><span data-script-marker-id="marker-1" data-script-marker-note="核实数字"><u>标记</u></span></p>')
    expect(html).toContain('data-script-material-relation-id="relation-1"')
    expect(html).toContain('data-script-material-draft-paragraph-ids="p1,p2"')
    expect(html).toContain('data-script-material-source-point-ids="s1,s2"')
    expect(html).toContain('data-script-marker-id="marker-1"')
    expect(html).toContain('<u>标记</u>')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('class=')
  })

  it('preserves stable block, annotation and complete source identity through the history HTML fallback', () => {
    const relations = '[{"id":"source-1","sourceKind":"brief_point"}]'
    const html = sourceContentToRichTextHtml(`<p data-current-script-block-id="block-1" data-current-script-parent-block-ids="parent-a,parent-b"><mark data-color="#F3D9A3" data-script-annotation-id="annotation-1" data-script-annotation-note="必须保留" data-script-annotation-block-id="block-1">参数</mark><span data-script-material-relation-id="relation-1" data-script-material-draft-id="draft-1" data-script-material-draft-paragraph-ids="p1" data-script-material-source-point-ids="s1" data-script-material-source-point-version="revision-1" data-script-material-relation-block-id="block-1" data-script-source-relations='${relations}'>来源</span><u data-script-annotation-id="annotation-2" data-script-annotation-block-id="block-1">下划线</u></p>`)
    expect(html).toContain('data-current-script-block-id="block-1"')
    expect(html).toContain('data-current-script-parent-block-ids="parent-a,parent-b"')
    expect(html).toContain('data-script-annotation-id="annotation-1"')
    expect(html).toContain('data-script-annotation-note="必须保留"')
    expect(html).toContain('data-script-material-source-point-version="revision-1"')
    expect(html).toContain('data-script-material-relation-block-id="block-1"')
    expect(html).toContain('data-script-source-relations="[{&quot;id&quot;:&quot;source-1&quot;,&quot;sourceKind&quot;:&quot;brief_point&quot;}]"')
    expect(html).toContain('<u data-script-annotation-id="annotation-2" data-script-annotation-block-id="block-1">下划线</u>')
  })

  it('keeps encoded source relations stable across render and repeated sanitization', () => {
    const rendered = renderCurrentScriptEditorDocumentHtml({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { blockId: 'block-1', parentBlockIds: [] },
        content: [{
          type: 'text',
          text: '来源段',
          marks: [{
            type: 'scriptMaterialRelation',
            attrs: {
              relationId: 'relation-1',
              sourceRelationsJson: JSON.stringify([{ id: 'source-1', sourceKind: 'brief_point', note: '甲方说“必写”' }])
            }
          }]
        }]
      }]
    })
    const once = sourceContentToRichTextHtml(rendered)
    const twice = sourceContentToRichTextHtml(once)
    expect(twice).toBe(once)
    expect(twice).toContain('data-script-source-relations="[{&quot;id&quot;:&quot;source-1&quot;')
    expect(twice).not.toContain('&amp;quot;')
  })

  it('removes only workbench annotations while preserving ordinary body formatting', () => {
    expect(stripScriptWorkbenchAnnotations(
      '<h2>标题</h2><p><span data-script-marker-id="m1"><u data-script-annotation-id="a1">核实</u></span><mark data-color="#fff">参数</mark><strong>重点</strong><s>正文删除线</s><u>正文下划线</u><mark data-script-annotation-id="a2">工作台高亮</mark><span>普通文字</span></p>'
    )).toBe('<h2>标题</h2><p>核实<mark data-color="#fff">参数</mark><strong>重点</strong><s>正文删除线</s><u>正文下划线</u>工作台高亮<span>普通文字</span></p>')
  })

  it('creates readable plain text without leaking markup', () => {
    expect(richTextHtmlToPlainText('<h1>标题</h1><p>第一段<br>第二行 &amp; 参数</p><ul><li>条目</li></ul>')).toBe('标题\n第一段\n第二行 & 参数\n条目')
  })
})
