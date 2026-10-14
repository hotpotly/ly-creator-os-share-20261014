import { htmlToPlainParagraphs } from './docx-export'

const FEISHU_DOCUMENT_PATH = /^\/(?:docx?|wiki|base|sheets|mindnotes|minutes|file)\//i

export function normalizeFeishuDocumentUrl(rawValue: string | null | undefined): string | null {
  const raw = rawValue?.trim() ?? ''
  if (!raw) return null
  if (raw.length > 2_000) throw new Error('飞书原文档链接过长')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('飞书原文档链接格式无效') }
  const hostname = url.hostname.toLowerCase()
  const allowedHost = hostname === 'feishu.cn' || hostname.endsWith('.feishu.cn')
    || hostname === 'larksuite.com' || hostname.endsWith('.larksuite.com')
  if (url.protocol !== 'https:' || url.username || url.password || !allowedHost || !FEISHU_DOCUMENT_PATH.test(url.pathname)) {
    throw new Error('只允许保存飞书或Lark的HTTPS文档链接')
  }
  return url.toString()
}

export function feishuClipboardText(projectTitle: string, html: string): string {
  const paragraphs = htmlToPlainParagraphs(html)
  if (!paragraphs.length) throw new Error('定稿文案没有可复制的正文')
  return `${projectTitle.trim()}\n\n${paragraphs.join('\n\n')}`
}

export function feishuWordFileName(projectTitle: string, accountName: string): string {
  const safe = `${projectTitle.trim()}-${accountName.trim()}-飞书`
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 140)
  return `${safe || '飞书文案'}.docx`
}
