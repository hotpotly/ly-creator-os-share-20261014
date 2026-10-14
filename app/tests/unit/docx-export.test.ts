import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildScriptDocx, htmlToPlainParagraphs } from '../../src/main/docx-export'

describe('Word script export', () => {
  it('turns editor HTML into readable paragraphs and a valid DOCX package', async () => {
    expect(htmlToPlainParagraphs('<h1>开头</h1><p>第一段&amp;重点</p><ul><li>体验一</li></ul>')).toEqual(['开头', '第一段&重点', '• 体验一'])
    const bytes = await buildScriptDocx('测试文案', '<h2>第一段</h2><p><strong>第二段</strong><mark data-color="#F3D9A3">暖黄</mark><mark data-color="#BFD9C1">暖绿</mark><s>删除</s></p>')
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']))
    const document = await zip.file('word/document.xml')!.async('string')
    expect(document).toContain('测试文案')
    expect(document).toContain('第一段')
    expect(document).toContain('第二段')
    expect(document).toContain('<w:b/>')
    expect(document).toContain('<w:shd w:val="clear" w:color="auto" w:fill="F3D9A3"/>')
    expect(document).toContain('<w:shd w:val="clear" w:color="auto" w:fill="BFD9C1"/>')
    expect(document).toContain('<w:strike/>')
  })
})
