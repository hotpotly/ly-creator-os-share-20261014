import { pinyin } from 'pinyin-pro'

export const GLOBAL_SEARCH_KINDS = ['project', 'topic', 'inspiration', 'script', 'account', 'review'] as const
export type GlobalSearchKind = (typeof GLOBAL_SEARCH_KINDS)[number]

export interface GlobalSearchDocument {
  kind: GlobalSearchKind
  id: string
  title: string
  subtitle: string
  searchableText: string
  updatedAt: string
  projectId: string | null
}

export interface GlobalSearchResult {
  kind: GlobalSearchKind
  id: string
  title: string
  subtitle: string
  preview: string
  updatedAt: string
  projectId: string | null
  score: number
}

interface PreparedField {
  normalized: string
  compact: string
  pinyin: string
  initials: string
  fuzzyCandidate: string
  tokens: string[]
}

export interface GlobalSearchIndexedDocument {
  document: GlobalSearchDocument
  title: PreparedField
  subtitle: PreparedField
  body: PreparedField
}

const KIND_ORDER = new Map<GlobalSearchKind, number>(GLOBAL_SEARCH_KINDS.map((kind, index) => [kind, index]))
const PINYIN_FIELD_LIMIT = 512
const BODY_FUZZY_LIMIT = 4_000

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim()
}

function compactNormalized(value: string): string {
  return value.replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function compact(value: string): string {
  return compactNormalized(normalize(value))
}

function prepareField(value: string, includePinyin: boolean): PreparedField {
  const normalized = normalize(value)
  const compressed = compactNormalized(normalized)
  const pinyinSource = includePinyin ? value.slice(0, PINYIN_FIELD_LIMIT) : ''
  const romanized = pinyinSource
    ? compact(pinyin(pinyinSource, { toneType: 'none', type: 'array' }).join(''))
    : ''
  const initials = pinyinSource
    ? compact(pinyin(pinyinSource, { pattern: 'first', toneType: 'none', type: 'array' }).join(''))
    : ''
  const fuzzyCandidate = compressed.slice(0, BODY_FUZZY_LIMIT)
  return {
    normalized,
    compact: compressed,
    pinyin: romanized,
    initials,
    fuzzyCandidate,
    tokens: [
      ...normalized.slice(0, BODY_FUZZY_LIMIT).split(/[^\p{Letter}\p{Number}]+/gu),
      ...(romanized ? [romanized, initials] : [])
    ].filter(Boolean)
  }
}

export function buildGlobalSearchIndex(documents: GlobalSearchDocument[]): GlobalSearchIndexedDocument[] {
  return documents.map((document) => ({
    document,
    // 拼音只为短字段建立一次索引；长正文只保留本机规范化文本，避免每次按键阻塞Main线程。
    title: prepareField(document.title, true),
    subtitle: prepareField(document.subtitle, true),
    body: prepareField(document.searchableText.slice(0, 20_000), false)
  }))
}

function isSubsequence(query: string, candidate: string): boolean {
  if (!query || query.length > candidate.length) return false
  let queryIndex = 0
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return false
}

function editDistance(left: string, right: string, ceiling: number): number {
  if (Math.abs(left.length - right.length) > ceiling) return ceiling + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    let rowMinimum = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const value = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > ceiling) return ceiling + 1
    previous = current
  }
  return previous[right.length] ?? ceiling + 1
}

function fuzzyTokenScore(query: string, candidates: string[]): number {
  if (query.length < 3) return 0
  const ceiling = query.length >= 7 ? 2 : 1
  let best = 0
  for (const candidate of candidates) {
    if (candidate.length < 2 || Math.abs(query.length - candidate.length) > ceiling) continue
    const distance = editDistance(query, candidate, ceiling)
    if (distance <= ceiling) best = Math.max(best, 46 - distance * 7)
  }
  return best
}

function scoreField(query: string, field: PreparedField, titleField: boolean): number {
  if (!field.normalized || !query) return 0
  const base = titleField ? 28 : 0
  if (field.compact === query) return 120 + base
  if (field.compact.startsWith(query)) return 104 + base
  if (field.compact.includes(query)) return 88 + base
  if (field.initials === query || field.pinyin === query) return 82 + base
  if (field.initials.startsWith(query) || field.pinyin.startsWith(query)) return 74 + base
  if (field.initials.includes(query) || field.pinyin.includes(query)) return 66 + base
  if (query.length >= 3 && (
    isSubsequence(query, field.fuzzyCandidate)
    || isSubsequence(query, field.initials)
    || isSubsequence(query, field.pinyin)
  )) return 36 + base
  const fuzzyScore = fuzzyTokenScore(query, field.tokens)
  return fuzzyScore > 0 ? fuzzyScore + base : 0
}

function resultPreview(document: GlobalSearchDocument, query: string): string {
  const plain = document.searchableText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return document.subtitle
  const normalized = normalize(plain)
  const matchedAt = normalized.indexOf(query)
  if (matchedAt < 0) return plain.length > 116 ? `${plain.slice(0, 116)}…` : plain
  const start = Math.max(0, matchedAt - 32)
  const end = Math.min(plain.length, matchedAt + query.length + 76)
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}

function compareInsideGroup(left: GlobalSearchResult, right: GlobalSearchResult): number {
  return right.score - left.score
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.title.localeCompare(right.title, 'zh-CN')
}

export function searchGlobalIndex(index: GlobalSearchIndexedDocument[], rawQuery: string, limit = 40): GlobalSearchResult[] {
  const boundedLimit = Math.max(1, Math.min(limit, 80))
  const query = compact(rawQuery).slice(0, 120)
  if (!query) {
    return index
      .map(({ document }) => document)
      .filter((document) => document.kind === 'project')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.min(boundedLimit, 8))
      .map((document) => ({ ...document, preview: document.searchableText || document.subtitle, score: 1 }))
  }

  const matches = index.flatMap(({ document, title, subtitle, body }): Array<{ document: GlobalSearchDocument; score: number }> => {
    const score = Math.max(
      scoreField(query, title, true),
      scoreField(query, subtitle, false),
      scoreField(query, body, false)
    )
    if (score <= 0) return []
    return [{ document, score }]
  })

  const groups = new Map(GLOBAL_SEARCH_KINDS.map((kind) => [
    kind,
    matches
      .filter(({ document }) => document.kind === kind)
      .sort((left, right) => right.score - left.score
        || right.document.updatedAt.localeCompare(left.document.updatedAt)
        || left.document.title.localeCompare(right.document.title, 'zh-CN'))
  ]))
  const activeKinds = GLOBAL_SEARCH_KINDS.filter((kind) => (groups.get(kind)?.length ?? 0) > 0)
  const baseCapacity = Math.floor(boundedLimit / Math.max(1, activeKinds.length))
  const remainder = boundedLimit % Math.max(1, activeKinds.length)
  const capacityPriority = [...activeKinds].sort((left, right) => {
    const leftBest = groups.get(left)?.[0]?.score ?? 0
    const rightBest = groups.get(right)?.[0]?.score ?? 0
    return rightBest - leftBest || (KIND_ORDER.get(left) ?? 99) - (KIND_ORDER.get(right) ?? 99)
  })
  const capacities = new Map(capacityPriority.map((kind, index) => [
    kind,
    baseCapacity + (index < remainder ? 1 : 0)
  ]))

  // 有空间时每组都获得独立配额；先选Top N后才生成预览，避免为被截断的长正文做无用处理。
  return GLOBAL_SEARCH_KINDS.flatMap((kind) => (groups.get(kind) ?? [])
    .slice(0, capacities.get(kind) ?? 0)
    .map(({ document, score }): GlobalSearchResult => ({
      kind: document.kind,
      id: document.id,
      title: document.title,
      subtitle: document.subtitle,
      preview: resultPreview(document, query),
      updatedAt: document.updatedAt,
      projectId: document.projectId,
      score
    })))
    .sort((left, right) => (KIND_ORDER.get(left.kind) ?? 99) - (KIND_ORDER.get(right.kind) ?? 99)
      || compareInsideGroup(left, right))
}

export function searchGlobalDocuments(documents: GlobalSearchDocument[], rawQuery: string, limit = 40): GlobalSearchResult[] {
  return searchGlobalIndex(buildGlobalSearchIndex(documents), rawQuery, limit)
}
