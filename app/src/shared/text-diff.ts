export interface TextDiffPart {
  kind: 'same' | 'added' | 'removed' | 'omitted'
  text: string
}

const MAX_LCS_CELLS = 250_000
const MAX_RENDERED_PARTS = 4_000

function normalizedLines(value: string): string[] {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean)
}

function linearFallback(left: string[], right: string[]): TextDiffPart[] {
  const side = MAX_RENDERED_PARTS / 2
  const head: TextDiffPart[] = []
  const tail = new Array<TextDiffPart>(side)
  let tailCount = 0
  let tailCursor = 0
  let total = 0
  const append = (part: TextDiffPart): void => {
    total += 1
    if (head.length < side) {
      head.push(part)
      return
    }
    tail[tailCursor] = part
    tailCursor = (tailCursor + 1) % side
    tailCount = Math.min(side, tailCount + 1)
  }
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    if (left[index] === right[index] && left[index] !== undefined) {
      append({ kind: 'same', text: left[index]! })
      continue
    }
    if (left[index] !== undefined) append({ kind: 'removed', text: left[index]! })
    if (right[index] !== undefined) append({ kind: 'added', text: right[index]! })
  }
  const orderedTail = tailCount < side
    ? tail.slice(0, tailCount)
    : [...tail.slice(tailCursor), ...tail.slice(0, tailCursor)]
  if (total <= MAX_RENDERED_PARTS) return [...head, ...orderedTail]
  return [
    ...head,
    { kind: 'omitted', text: `内容较长，中间${total - head.length - orderedTail.length}行已折叠；载入和原文内容不受影响。` },
    ...orderedTail
  ]
}

function limitRenderedParts(parts: TextDiffPart[]): TextDiffPart[] {
  if (parts.length <= MAX_RENDERED_PARTS) return parts
  const side = MAX_RENDERED_PARTS / 2
  return [
    ...parts.slice(0, side),
    { kind: 'omitted', text: `内容较长，中间${parts.length - MAX_RENDERED_PARTS}行已折叠；载入和原文内容不受影响。` },
    ...parts.slice(-side)
  ]
}

export function lineDiff(base: string, target: string): TextDiffPart[] {
  const left = normalizedLines(base)
  const right = normalizedLines(target)
  if (left.length + right.length > MAX_RENDERED_PARTS || left.length * right.length > MAX_LCS_CELLS) return linearFallback(left, right)

  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  for (let l = left.length - 1; l >= 0; l -= 1) {
    for (let r = right.length - 1; r >= 0; r -= 1) {
      table[l]![r] = left[l] === right[r] ? 1 + table[l + 1]![r + 1]! : Math.max(table[l + 1]![r]!, table[l]![r + 1]!)
    }
  }
  const result: TextDiffPart[] = []
  let l = 0
  let r = 0
  while (l < left.length || r < right.length) {
    if (l < left.length && r < right.length && left[l] === right[r]) {
      result.push({ kind: 'same', text: left[l]! }); l += 1; r += 1
    } else if (r < right.length && (l >= left.length || table[l]![r + 1]! > table[l + 1]![r]!)) {
      result.push({ kind: 'added', text: right[r]! }); r += 1
    } else if (l < left.length) {
      result.push({ kind: 'removed', text: left[l]! }); l += 1
    }
  }
  return limitRenderedParts(result)
}
