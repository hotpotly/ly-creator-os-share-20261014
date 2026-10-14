import type { ScriptMaterialDraftParagraph, ScriptMaterialPoint } from './domain'

export interface ImmediateScriptMaterialPoint {
  id: string
  sourceStart: number
  sourceEnd: number
  sourceText: string
  summary: string
  paragraphIds: string[]
}

type SourceRange = Pick<ImmediateScriptMaterialPoint, 'id' | 'sourceStart' | 'sourceEnd' | 'sourceText' | 'summary'>

function trimRange(source: string, start: number, end: number): { start: number; end: number } | null {
  while (start < end && /\s/.test(source[start]!)) start += 1
  while (end > start && /\s/.test(source[end - 1]!)) end -= 1
  return end > start ? { start, end } : null
}

function splitLongRange(source: string, start: number, end: number): Array<{ start: number; end: number }> {
  if (end - start <= 320) return [{ start, end }]
  const ranges: Array<{ start: number; end: number }> = []
  let cursor = start
  for (let index = start; index < end; index += 1) {
    if (!/[。！？!?；;]/.test(source[index]!)) continue
    const range = trimRange(source, cursor, index + 1)
    if (range) ranges.push(range)
    cursor = index + 1
  }
  const tail = trimRange(source, cursor, end)
  if (tail) ranges.push(tail)
  if (ranges.length > 1) return ranges
  const slices: Array<{ start: number; end: number }> = []
  for (let sliceStart = start; sliceStart < end; sliceStart += 280) {
    const range = trimRange(source, sliceStart, Math.min(end, sliceStart + 280))
    if (range) slices.push(range)
  }
  return slices
}

export function splitImmediateScriptMaterialSource(source: string): SourceRange[] {
  const ranges: Array<{ start: number; end: number }> = []
  const linePattern = /[^\n]+/g
  let match: RegExpExecArray | null
  while ((match = linePattern.exec(source)) !== null) {
    const trimmed = trimRange(source, match.index, match.index + match[0].length)
    if (trimmed) ranges.push(...splitLongRange(source, trimmed.start, trimmed.end))
  }
  if (!ranges.length) {
    const trimmed = trimRange(source, 0, source.length)
    if (trimmed) ranges.push(...splitLongRange(source, trimmed.start, trimmed.end))
  }
  return ranges.map((range) => {
    const sourceText = source.slice(range.start, range.end)
    return {
      id: `local-source-${range.start}-${range.end}`,
      sourceStart: range.start,
      sourceEnd: range.end,
      sourceText,
      summary: sourceText.replace(/\s+/g, ' ').slice(0, 80)
    }
  })
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('zh-CN')
    .replace(/^#{1,6}\s*/, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>()
  if (value.length < 2) {
    if (value) counts.set(value, 1)
    return counts
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function similarity(left: string, right: string, rightBigrams: Map<string, number>): number {
  if (!left || !right) return 0
  if (right.includes(left) || left.includes(right)) return Math.min(left.length, right.length) / Math.max(left.length, right.length) * .45 + .55
  const leftBigrams = bigramCounts(left)
  let intersection = 0
  let leftTotal = 0
  let rightTotal = 0
  leftBigrams.forEach((count, gram) => {
    leftTotal += count
    intersection += Math.min(count, rightBigrams.get(gram) ?? 0)
  })
  rightBigrams.forEach((count) => { rightTotal += count })
  const dice = leftTotal + rightTotal ? 2 * intersection / (leftTotal + rightTotal) : 0
  const leftCharacters = new Set(left)
  const rightCharacters = new Set(right)
  let sharedCharacters = 0
  leftCharacters.forEach((character) => { if (rightCharacters.has(character)) sharedCharacters += 1 })
  const characterJaccard = sharedCharacters / Math.max(1, new Set([...leftCharacters, ...rightCharacters]).size)
  return dice * .78 + characterJaccard * .22
}

export function buildImmediateScriptMaterialMapping(
  source: string,
  paragraphs: Array<Pick<ScriptMaterialDraftParagraph, 'id' | 'text'>>,
  existingPoints: Array<Pick<ScriptMaterialPoint, 'id' | 'sourceStart' | 'sourceEnd' | 'sourceText' | 'summary'>> = []
): ImmediateScriptMaterialPoint[] {
  const points: SourceRange[] = existingPoints.length
    ? existingPoints.map((point) => ({ ...point }))
    : splitImmediateScriptMaterialSource(source)
  const paragraphProfiles = paragraphs
    .map((paragraph) => {
      const text = normalize(paragraph.text)
      return { id: paragraph.id, text, bigrams: bigramCounts(text) }
    })
  const pointProfiles = points.map((point) => ({
    point,
    text: normalize(point.sourceText),
    paragraphIds: new Set<string>()
  }))

  pointProfiles.forEach((profile) => {
    const sourceText = profile.text
    const matches: Array<{ id: string; score: number }> = []
    for (const paragraph of paragraphProfiles) {
      const score = similarity(sourceText, paragraph.text, paragraph.bigrams)
      matches.push({ id: paragraph.id, score })
    }
    matches.sort((left, right) => right.score - left.score)
    const best = matches[0]
    const paragraphIds = best && best.score >= .115
      ? matches
        .filter((match, index) => index === 0 || (sourceText.length >= 55 && index < 3 && match.score >= Math.max(.18, best.score * .52)))
        .map((match) => match.id)
      : []
    paragraphIds.forEach((paragraphId) => profile.paragraphIds.add(paragraphId))
  })

  const assignedParagraphIds = new Set(pointProfiles.flatMap((profile) => [...profile.paragraphIds]))
  paragraphProfiles.forEach((paragraph) => {
    if (assignedParagraphIds.has(paragraph.id) || !paragraph.text) return
    const matches = pointProfiles
      .map((profile) => ({
        profile,
        score: similarity(profile.text, paragraph.text, paragraph.bigrams)
      }))
      .sort((left, right) => right.score - left.score)
    const best = matches[0]
    if (!best || best.score < .1) return
    best.profile.paragraphIds.add(paragraph.id)
  })

  return pointProfiles.map(({ point, paragraphIds }) => {
    return {
      ...point,
      paragraphIds: [...paragraphIds]
    }
  })
}
