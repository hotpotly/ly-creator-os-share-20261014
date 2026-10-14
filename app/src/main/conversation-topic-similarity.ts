import type { ConversationFilterSimilarity, ConversationFilterSimilarityKind } from '../shared/domain'

export interface SimilarityTarget {
  id: string
  title: string
  text: string
  kind: ConversationFilterSimilarityKind
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function grams(value: string): Set<string> {
  const text = normalized(value)
  const size = /[\u3400-\u9fff]/u.test(text) ? 2 : 3
  if (text.length <= size) return new Set(text ? [text] : [])
  return new Set(Array.from({ length: text.length - size + 1 }, (_, index) => text.slice(index, index + size)))
}

export function textSimilarity(left: string, right: string): number {
  const a = normalized(left)
  const b = normalized(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 4 && b.includes(a)) return Math.min(0.98, 0.82 + (a.length / b.length) * 0.16)
  if (b.length >= 4 && a.includes(b)) return Math.min(0.98, 0.82 + (b.length / a.length) * 0.16)
  const leftGrams = grams(a)
  const rightGrams = grams(b)
  let intersection = 0
  for (const gram of leftGrams) if (rightGrams.has(gram)) intersection += 1
  return intersection === 0 ? 0 : (2 * intersection) / (leftGrams.size + rightGrams.size)
}

export function findConversationTopicSimilarities(
  candidate: { title: string; content: string },
  targets: readonly SimilarityTarget[],
  threshold = 0.32
): ConversationFilterSimilarity[] {
  const candidateText = `${candidate.title}\n${candidate.content}`
  return targets
    .map((target) => ({
      kind: target.kind,
      targetId: target.id,
      targetTitle: target.title,
      score: Math.max(textSimilarity(candidate.title, target.title), textSimilarity(candidateText, target.text))
    }))
    .filter((match) => match.score >= threshold)
    .sort((left, right) => right.score - left.score || left.targetTitle.localeCompare(right.targetTitle, 'zh-CN'))
    .slice(0, 3)
}
