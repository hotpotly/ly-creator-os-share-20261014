const RICH_TEXT_TAG = /<\s*\/?\s*(?:p|div|br|h[1-3]|blockquote|ul|ol|li|strong|b|em|i|u|s|strike|del|code|pre|mark|span)\b/i
const ALLOWED_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'u', 's', 'code', 'pre', 'mark', 'span'])
const SAFE_SPAN_ATTRIBUTES = [
  'data-script-marker-id',
  'data-script-marker-note',
  'data-script-marker-block-id',
  'data-script-material-relation-id',
  'data-script-material-draft-id',
  'data-script-material-draft-paragraph-ids',
  'data-script-material-source-point-ids',
  'data-script-material-source-point-version',
  'data-script-material-relation-block-id',
  'data-script-source-relations'
] as const
const SAFE_BLOCK_ATTRIBUTES = ['data-current-script-block-id', 'data-current-script-parent-block-ids'] as const
const SAFE_ANNOTATION_ATTRIBUTES = ['data-script-annotation-id', 'data-script-annotation-note', 'data-script-annotation-block-id'] as const

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeDataAttributes(rawAttributes: string, names: readonly string[]): string[] {
  return names.flatMap((name) => {
    const attribute = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(rawAttributes)
    return attribute?.[2] ? [`${name}="${escapeHtml(decodeHtmlEntities(attribute[2]))}"`] : []
  })
}

function sanitizeRichTextHtml(value: string): string {
  const withoutExecutableBlocks = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  return withoutExecutableBlocks.replace(/<[^>]*>/g, (token) => {
    const match = /^<\s*(\/?)\s*([a-z0-9]+)\b([^>]*)>/i.exec(token)
    if (!match) return ''
    const closing = Boolean(match[1])
    const rawTag = match[2]!.toLowerCase()
    const tag = rawTag === 'div' ? 'p'
      : rawTag === 'b' ? 'strong'
        : rawTag === 'i' ? 'em'
          : rawTag === 'strike' || rawTag === 'del' ? 's'
            : rawTag
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (closing) return tag === 'br' ? '' : `</${tag}>`
    if (tag === 'br') return '<br>'
    if (tag === 'span') {
      const rawAttributes = match[3] ?? ''
      const safeAttributes = safeDataAttributes(rawAttributes, SAFE_SPAN_ATTRIBUTES)
      return safeAttributes.length ? `<span ${safeAttributes.join(' ')}>` : '<span>'
    }
    if (tag === 'ol') {
      const start = /\bstart\s*=\s*(["']?)(\d+)\1/i.exec(match[3] ?? '')?.[2]
      const value = start ? Number(start) : 1
      return Number.isSafeInteger(value) && value > 1 && value <= 1_000_000 ? `<ol start="${value}">` : '<ol>'
    }
    const rawAttributes = match[3] ?? ''
    if (['p', 'h1', 'h2', 'h3', 'blockquote', 'li', 'pre'].includes(tag)) {
      const safeAttributes = safeDataAttributes(rawAttributes, SAFE_BLOCK_ATTRIBUTES)
      return safeAttributes.length ? `<${tag} ${safeAttributes.join(' ')}>` : `<${tag}>`
    }
    if (tag === 'u' || tag === 's') {
      const safeAttributes = safeDataAttributes(rawAttributes, SAFE_ANNOTATION_ATTRIBUTES)
      return safeAttributes.length ? `<${tag} ${safeAttributes.join(' ')}>` : `<${tag}>`
    }
    if (tag !== 'mark') return `<${tag}>`
    const color = /\bdata-color\s*=\s*["'](#[0-9a-f]{3,8}|rgba?\([^"'()]+\))["']/i.exec(match[3] ?? '')?.[1]
      ?? /\bbackground-color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^;'"()]+\))/i.exec(match[3] ?? '')?.[1]
    const linkIndex = /\bdata-link-index\s*=\s*(["'])(.*?)\1/i.exec(match[3] ?? '')?.[2]
    const targetSelectionId = /\bdata-target-selection-id\s*=\s*(["'])(.*?)\1/i.exec(match[3] ?? '')?.[2]
    const attributes = [
      color ? `data-color="${escapeHtml(color)}" style="background-color: ${escapeHtml(color)}; color: inherit"` : '',
      linkIndex ? `data-link-index="${escapeHtml(linkIndex)}"` : '',
      targetSelectionId ? `data-target-selection-id="${escapeHtml(targetSelectionId)}"` : '',
      ...safeDataAttributes(rawAttributes, SAFE_ANNOTATION_ATTRIBUTES)
    ].filter(Boolean)
    return attributes.length ? `<mark ${attributes.join(' ')}>` : '<mark>'
  })
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<span>$1</span>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
}

function markdownToRichTextHtml(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim() || /^\s*---+\s*$/.test(line)) {
      index += 1
      continue
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push(`<h${heading[1]!.length}>${inlineMarkdown(heading[2]!)}</h${heading[1]!.length}>`)
      index += 1
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      blocks.push(`<blockquote><p>${inlineMarkdown(quote[1]!)}</p></blockquote>`)
      index += 1
      continue
    }
    const list = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line)
    if (list) {
      const ordered = /\d+\./.test(list[1]!)
      const items: string[] = []
      while (index < lines.length) {
        const item = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(lines[index] ?? '')
        if (!item || /\d+\./.test(item[1]!) !== ordered) break
        items.push(`<li>${inlineMarkdown(item[2]!)}</li>`)
        index += 1
      }
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    const paragraph = [line]
    index += 1
    while (
      index < lines.length
      && Boolean(lines[index]?.trim())
      && !/^(#{1,3})\s+/.test(lines[index]!)
      && !/^\s*([-*]|\d+\.)\s+/.test(lines[index]!)
      && !/^\s*>\s?/.test(lines[index]!)
      && !/^\s*```/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!)
      index += 1
    }
    blocks.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return blocks.join('') || '<p></p>'
}

export function sourceContentToRichTextHtml(value: string): string {
  const normalized = value.trim()
  if (!normalized) return '<p></p>'
  return RICH_TEXT_TAG.test(normalized) ? sanitizeRichTextHtml(normalized) : markdownToRichTextHtml(normalized)
}

export function stripScriptWorkbenchAnnotations(value: string): string {
  const removableStack: Array<{ tag: string; removable: boolean }> = []
  return value.replace(/<\s*(\/?)\s*(mark|u|s|strike|del|span)\b[^>]*>/gi, (token, closingValue: string, rawTag: string) => {
    const tag = rawTag.toLowerCase()
    const closing = Boolean(closingValue)
    if (closing) {
      for (let index = removableStack.length - 1; index >= 0; index -= 1) {
        if (removableStack[index]?.tag !== tag) continue
        const entry = removableStack.splice(index, 1)[0]
        return entry?.removable ? '' : token
      }
      return token
    }
    const removable = tag === 'span'
      ? /\bdata-script-(?:marker-id|material-relation-id)\s*=/i.test(token)
      : /\bdata-script-annotation-id\s*=/i.test(token)
        || (tag === 'mark' && /\bdata-(?:target-selection-id|link-index)\s*=/i.test(token))
    removableStack.push({ tag, removable })
    return removable ? '' : token
  })
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number(code)
      return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const value = Number.parseInt(code, 16)
      return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
    })
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

export function richTextHtmlToPlainText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|blockquote|li|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
