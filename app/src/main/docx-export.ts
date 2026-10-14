import JSZip from 'jszip'

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function decodeHtml(value: string): string {
  return value.replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')
}

const DANGEROUS_BLOCK_TAGS = new Set(['script', 'style', 'template', 'svg'])

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '>') return index
  }
  return -1
}

function stripDangerousBlocks(html: string): string {
  const safe: string[] = []
  const dangerousStack: string[] = []
  let cursor = 0
  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor)
    if (tagStart < 0) {
      if (!dangerousStack.length) safe.push(html.slice(cursor))
      break
    }
    if (!dangerousStack.length) safe.push(html.slice(cursor, tagStart))
    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4)
      cursor = commentEnd < 0 ? html.length : commentEnd + 3
      continue
    }
    const tagEnd = findTagEnd(html, tagStart)
    if (tagEnd < 0) {
      if (!dangerousStack.length) safe.push(html.slice(tagStart))
      break
    }
    const token = html.slice(tagStart, tagEnd + 1)
    const match = token.match(/^<\s*(\/?)\s*([a-zA-Z][\w:-]*)\b/)
    if (!match) {
      if (!dangerousStack.length) safe.push(token)
      cursor = tagEnd + 1
      continue
    }
    const closing = match[1] === '/'
    const tagName = (match[2] ?? '').toLowerCase()
    const dangerous = DANGEROUS_BLOCK_TAGS.has(tagName)
    if (dangerous) {
      if (closing) {
        if (dangerousStack.at(-1) === tagName) dangerousStack.pop()
      } else if (!/\/\s*>$/.test(token)) {
        dangerousStack.push(tagName)
      }
    } else if (!dangerousStack.length && !/^<\s*!/.test(token)) {
      safe.push(token)
    }
    cursor = tagEnd + 1
  }
  return safe.join('')
}

export function htmlToPlainParagraphs(html: string): string[] {
  const normalized = stripDangerousBlocks(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/(?:p|div|h[1-6]|li|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
  return decodeHtml(normalized).split(/\n+/).map((line) => line.trim()).filter(Boolean)
}

interface HtmlBlock { tag: string; inner: string }

function parseBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  const safeHtml = stripDangerousBlocks(html)
  const pattern = /<(p|div|h[1-6]|li|blockquote)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi
  for (const match of safeHtml.matchAll(pattern)) blocks.push({ tag: (match[1] ?? 'p').toLowerCase(), inner: match[2] ?? '' })
  return blocks.length ? blocks : htmlToPlainParagraphs(safeHtml).map((inner) => ({ tag: 'p', inner }))
}

function inlineRuns(inner: string): string {
  let bold = false; let strike = false; let highlightColor: string | null = null
  const parts = inner.split(/(<[^>]+>)/g).filter(Boolean)
  const runs: string[] = []
  for (const part of parts) {
    if (part.startsWith('<')) {
      const tag = part.toLowerCase()
      if (/^<(strong|b)(\s|>)/.test(tag)) bold = true
      else if (/^<\/(strong|b)>/.test(tag)) bold = false
      else if (/^<(s|strike|del)(\s|>)/.test(tag)) strike = true
      else if (/^<\/(s|strike|del)>/.test(tag)) strike = false
      else if (/^<mark(\s|>)/.test(tag)) {
        const color = /data-color\s*=\s*["']#?([0-9a-f]{6})["']/i.exec(part)?.[1]
          ?? /background-color\s*:\s*#?([0-9a-f]{6})/i.exec(part)?.[1]
        highlightColor = (color ?? 'FFFF00').toUpperCase()
      } else if (/^<\/mark>/.test(tag)) highlightColor = null
      else if (/^<br(\s|\/|>)/.test(tag)) runs.push('<w:r><w:br/></w:r>')
      continue
    }
    const text = decodeHtml(part)
    if (!text) continue
    const properties = `${bold ? '<w:b/>' : ''}${strike ? '<w:strike/>' : ''}${highlightColor ? `<w:shd w:val="clear" w:color="auto" w:fill="${highlightColor}"/>` : ''}`
    runs.push(`<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`)
  }
  return runs.join('')
}

function blockToXml(block: HtmlBlock): string {
  const headingLevel = /^h([1-6])$/.exec(block.tag)?.[1]
  const paragraphProperties = headingLevel
    ? `<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:rPr><w:b/><w:sz w:val="${Math.max(24, 38 - Number(headingLevel) * 4)}"/></w:rPr>`
    : block.tag === 'blockquote' ? '<w:ind w:left="480"/><w:spacing w:before="80" w:after="80"/>' : '<w:spacing w:after="120"/>'
  const prefix = block.tag === 'li' ? '<w:r><w:t xml:space="preserve">• </w:t></w:r>' : ''
  return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${prefix}${inlineRuns(block.inner)}</w:p>`
}

export async function buildScriptDocx(title: string, html: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.folder('_rels')?.file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const titleParagraph = `<w:p><w:pPr><w:keepNext/><w:spacing w:after="240"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t xml:space="preserve">${escapeXml(title.trim())}</w:t></w:r></w:p>`
  const body = `${titleParagraph}${parseBlocks(html).map(blockToXml).join('')}`
  zip.folder('word')?.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
