import { createHash } from 'node:crypto'
import type {
  ContentAtomScores,
  ContentAtomType,
  ContentDerivativeType,
  PrivacyFinding,
  PrivacyFindingKind
} from '../shared/domain'

export interface ContentAtomDraft {
  atomType: ContentAtomType
  title: string
  content: string
  scores: ContentAtomScores
  start: number
  end: number
  contentHash: string
}

const findingLabels: Record<PrivacyFindingKind, string> = {
  credential: '已遮盖密钥或凭据',
  phone: '已遮盖手机号',
  email: '已遮盖邮箱',
  possible_private: '已遮盖可能的隐私内容',
  custom_sensitive: '已遮盖自定义敏感词'
}

const normalizeForHash = (value: string): string => value.toLowerCase().replace(/\s+/g, '').replace(/[，,。.!！?？；;：“”"'‘’（）()【】]/g, '')
export const hashContent = (value: string): string => createHash('sha256').update(normalizeForHash(value)).digest('hex')

function collectMatches(content: string, pattern: RegExp, kind: PrivacyFindingKind): PrivacyFinding[] {
  return [...content.matchAll(pattern)].flatMap((match) => {
    const start = match.index
    if (start === undefined || !match[0]) return []
    return [{ kind, label: findingLabels[kind], start, end: start + match[0].length }]
  })
}

function privateSentenceFindings(content: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = []
  const sentencePattern = /[^。！？!?\n]*(?:严格保密|保密信息|NDA|未公开|客户隐私|甲方隐私|内部资料|仅供内部|禁止外传)[^。！？!?\n]*[。！？!?]?/gi
  for (const match of content.matchAll(sentencePattern)) {
    const start = match.index
    const text = match[0]?.trim()
    if (start === undefined || !text) continue
    const leadingWhitespace = match[0].length - match[0].trimStart().length
    findings.push({ kind: 'possible_private', label: findingLabels.possible_private, start: start + leadingWhitespace, end: start + leadingWhitespace + text.length })
  }
  return findings
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function scanAndSanitizeContent(rawContent: string, customSensitiveTerms: readonly string[] = []): { sanitizedContent: string; findings: PrivacyFinding[] } {
  const content = rawContent.replace(/\r\n?/g, '\n').trim()
  const normalizedCustomTerms = [...new Set(customSensitiveTerms.map((term) => term.trim()).filter((term) => term.length >= 2 && term.length <= 80))].slice(0, 50)
  const findings = [
    ...collectMatches(content, /\b(?:sk-ant-[a-z0-9_-]{16,}|sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/gi, 'credential'),
    ...collectMatches(content, /(?:api[_-]?key|access[_-]?token|token|secret|password|密码|密钥)\s*[:=：]\s*["']?[^\s,"'；;]{6,}/gi, 'credential'),
    ...collectMatches(content, /(?:[?&](?:api[_-]?key|access[_-]?token|token|secret)=)[^\s&#]{6,}/gi, 'credential'),
    ...collectMatches(content, /(?:\+?86[- ]?)?1[3-9]\d{9}/g, 'phone'),
    ...collectMatches(content, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'email'),
    ...privateSentenceFindings(content),
    ...normalizedCustomTerms.flatMap((term) => collectMatches(content, new RegExp(escapeRegExp(term), 'gi'), 'custom_sensitive'))
  ].sort((left, right) => left.start - right.start || right.end - left.end)

  const replacementRanges: Array<{ start: number; end: number; labels: Set<string> }> = []
  for (const finding of findings) {
    const current = replacementRanges.at(-1)
    if (current && finding.start <= current.end) {
      current.end = Math.max(current.end, finding.end)
      current.labels.add(finding.label)
    } else {
      replacementRanges.push({ start: finding.start, end: finding.end, labels: new Set([finding.label]) })
    }
  }

  let sanitizedContent = content
  for (const range of replacementRanges.reverse()) {
    const replacement = range.labels.size === 1 ? `[${[...range.labels][0]}]` : '[已遮盖敏感内容]'
    sanitizedContent = `${sanitizedContent.slice(0, range.start)}${replacement}${sanitizedContent.slice(range.end)}`
  }
  return { sanitizedContent, findings }
}

function splitSegments(content: string): Array<{ content: string; start: number; end: number }> {
  const segments: Array<{ content: string; start: number; end: number }> = []
  const paragraphs = [...content.matchAll(/\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g)]
  for (const paragraph of paragraphs) {
    const block = paragraph[0]
    const blockStart = paragraph.index ?? 0
    if (block.trim().length <= 360) {
      const leading = block.length - block.trimStart().length
      const value = block.trim()
      if (value.length >= 12) segments.push({ content: value, start: blockStart + leading, end: blockStart + leading + value.length })
      continue
    }
    const sentences = [...block.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/g)]
    let buffer = ''
    let bufferStart = blockStart
    let bufferEnd = blockStart
    const flush = (): void => {
      const value = buffer.trim()
      if (value.length >= 12) segments.push({ content: value, start: bufferStart, end: bufferEnd })
      buffer = ''
    }
    for (const sentence of sentences) {
      const value = sentence[0].trim()
      if (!value) continue
      const start = blockStart + (sentence.index ?? 0) + sentence[0].indexOf(value)
      const end = start + value.length
      if (!buffer) { buffer = value; bufferStart = start; bufferEnd = end; continue }
      if (buffer.length + value.length > 260) flush()
      if (!buffer) bufferStart = start
      buffer = buffer ? `${buffer}${value}` : value
      bufferEnd = end
    }
    flush()
  }
  if (segments.length === 0 && content.trim()) return [{ content: content.trim(), start: 0, end: content.trim().length }]
  return segments.slice(0, 40)
}

function atomType(content: string): ContentAtomType {
  if (/(?:踩坑|翻车|失败|报错|没想到|问题在于|错误|避坑)/i.test(content)) return 'pitfall'
  if (/(?:对比|相比|区别|不如|优于|更适合|vs\.?)/i.test(content)) return 'comparison'
  if (/(?:如何|怎么|步骤|方法|先.+再|首先|然后|最后|解决办法|可以通过)/i.test(content)) return 'method'
  if (/(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?倍|版本|参数|数据|官方|支持|发布于|测试结果)/i.test(content)) return 'verifiable_fact'
  if (/(?:我|我们|当时|后来|一开始|这次|昨天|今天|亲自|实际用)/i.test(content)) return 'story'
  return 'viewpoint'
}

const clampScore = (value: number): number => Math.max(1, Math.min(5, value))
function scoreAtom(content: string, type: ContentAtomType): ContentAtomScores {
  const personal = /(?:我|我们|亲自|实际|这次|当时|后来)/.test(content)
  const fresh = /(?:今天|昨天|刚刚|最近|最新|新版|更新|这次)/.test(content)
  return {
    freshness: clampScore(fresh ? 5 : type === 'verifiable_fact' ? 4 : 3),
    usefulness: clampScore(type === 'method' || type === 'pitfall' ? 5 : type === 'comparison' || type === 'verifiable_fact' ? 4 : 3),
    personalExperience: clampScore(personal ? 5 : type === 'story' ? 4 : 2),
    narrative: clampScore(type === 'story' || type === 'pitfall' ? 5 : type === 'comparison' ? 4 : 3)
  }
}

function atomTitle(content: string): string {
  const clean = content
    .replace(/^\s*(?:user|assistant|用户|助手|codex|claude)\s*[:：]\s*/i, '')
    .replace(/\[[^\]]*已遮盖[^\]]*\]/g, '敏感信息已遮盖')
    .trim()
  const firstClause = clean.split(/[。！？!?；;\n]/)[0]?.trim() || '来源片段'
  return firstClause.length > 28 ? `${firstClause.slice(0, 27)}…` : firstClause
}

export function extractContentAtomDrafts(sanitizedContent: string): ContentAtomDraft[] {
  return splitSegments(sanitizedContent).map((segment) => {
    const type = atomType(segment.content)
    return {
      atomType: type,
      title: atomTitle(segment.content),
      content: segment.content,
      scores: scoreAtom(segment.content, type),
      start: segment.start,
      end: segment.end,
      contentHash: hashContent(segment.content)
    }
  })
}

function compact(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized
}

export function buildDerivedContent(outputType: ContentDerivativeType, atoms: Array<{ title: string; content: string; atomType: ContentAtomType }>): string {
  if (atoms.length === 0) throw new Error('至少保留一张洞察卡')
  if (outputType === 'x_single') {
    const headline = compact(atoms[0]?.title ?? '这次AI实践的一个发现', 42)
    const body = compact(atoms.map((atom) => atom.content).join(' '), 230)
    return `${headline}\n\n${body}`
  }
  if (outputType === 'x_thread') {
    const items = atoms.slice(0, 8)
    return items.map((atom, index) => `${index + 1}/${items.length} ${compact(atom.content, 260)}`).join('\n\n')
  }
  const first = atoms[0]!
  const methods = atoms.filter((atom) => atom.atomType === 'method')
  const turns = atoms.filter((atom) => atom.atomType === 'pitfall' || atom.atomType === 'comparison')
  const conclusions = atoms.filter((atom) => atom.atomType === 'viewpoint' || atom.atomType === 'verifiable_fact')
  return [
    `【起因】\n${compact(first.content, 360)}`,
    `【过程】\n${compact(atoms.slice(1).map((atom) => atom.content).join(' '), 520) || '围绕这次真实任务继续补充操作过程。'}`,
    `【关键转折】\n${compact(turns.map((atom) => atom.content).join(' '), 360) || '暂未提取到明确转折，确认前可以补充。'}`,
    `【可复用方法】\n${compact(methods.map((atom) => atom.content).join(' '), 420) || '暂未提取到明确方法，确认前可以补充。'}`,
    `【结果与观点】\n${compact(conclusions.map((atom) => atom.content).join(' '), 360) || compact(first.title, 120)}`,
    '【来源画面】\n优先展示已确认的对话片段、操作过程和可核验结果；已遮盖内容不得重新补写。'
  ].join('\n\n')
}
