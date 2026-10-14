import type { ReactNode } from 'react'

export interface ReadableMarkdownAnnotation {
  start: number
  end: number
  provenance: 'ai_supplement' | 'web_supplement' | 'needs_confirmation'
  label: string
}

export interface ReadableMarkdownManualMark {
  start: number
  end: number
  style: 'highlight' | 'underline' | 'strike' | 'flag'
  note?: string
  status?: 'active' | 'position_changed' | 'not_migrated'
}

export function ReadableMarkdown({
  content,
  className = '',
  annotations = [],
  manualMarks = []
}: {
  content: string
  className?: string
  annotations?: ReadableMarkdownAnnotation[]
  manualMarks?: ReadableMarkdownManualMark[]
}): React.JSX.Element {
  const rawLines = content.split('\n')
  const lines = rawLines.map((line) => line.endsWith('\r') ? line.slice(0, -1) : line)
  const lineStarts: number[] = []
  let rawCursor = 0
  rawLines.forEach((line) => {
    lineStarts.push(rawCursor)
    rawCursor += line.length + 1
  })
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim() || /^\s*(```|---+)\s*$/.test(line)) { index += 1; continue }
    const quote = /^\s*>\s*(.+)$/.exec(line)
    if (quote) {
      blocks.push(<blockquote key={`quote-${index}`}>{renderInlineMarkdown(quote[1]!, `quote-${index}`, lineStarts[index]! + line.indexOf(quote[1]!), annotations, manualMarks)}</blockquote>)
      index += 1
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const text = renderInlineMarkdown(heading[2]!, `heading-${index}`, lineStarts[index]! + line.indexOf(heading[2]!), annotations, manualMarks)
      blocks.push(heading[1]!.length === 1 ? <h3 key={index}>{text}</h3> : <h4 key={index}>{text}</h4>)
      index += 1
      continue
    }
    const listMatch = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line)
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]!)
      const items: ReactNode[] = []
      while (index < lines.length) {
        const item = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(lines[index] ?? '')
        if (!item || /\d+\./.test(item[1]!) !== ordered) break
        items.push(<li key={index}>{renderInlineMarkdown(item[2]!, `item-${index}`, lineStarts[index]! + lines[index]!.indexOf(item[2]!), annotations, manualMarks)}</li>)
        index += 1
      }
      blocks.push(ordered ? <ol key={`list-${index}`}>{items}</ol> : <ul key={`list-${index}`}>{items}</ul>)
      continue
    }
    const paragraph = [{ line, index }]
    index += 1
    while (index < lines.length && lines[index]?.trim() && !/^(#{1,3})\s+/.test(lines[index]!) && !/^\s*([-*]|\d+\.)\s+/.test(lines[index]!) && !/^\s*>\s+/.test(lines[index]!)) {
      paragraph.push({ line: lines[index]!, index })
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.flatMap((entry, paragraphIndex) => [
      ...(paragraphIndex ? ['\n'] : []),
      ...renderInlineMarkdown(entry.line, `paragraph-${entry.index}`, lineStarts[entry.index]!, annotations, manualMarks)
    ])}</p>)
  }
  return <div className={`readable-markdown ${className}`.trim()}>{blocks}</div>
}

// eslint-disable-next-line react-refresh/only-export-components
export function markdownToReadableText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function renderInlineMarkdown(
  value: string,
  keyPrefix: string,
  rawBase: number,
  annotations: ReadableMarkdownAnnotation[],
  manualMarks: ReadableMarkdownManualMark[]
): ReactNode[] {
  const result: ReactNode[] = []
  const pattern = /(\[[^\]]+\]\(https:\/\/[^)\s]+\)|\*\*[^*]+\*\*|`[^`\n]+`)/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const offset = match.index ?? 0
    if (offset > cursor) result.push(...renderDecoratedText(value.slice(cursor, offset), `${keyPrefix}-plain-${cursor}`, rawBase + cursor, annotations, manualMarks))
    const token = match[0]
    const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(token)
    if (link) {
      result.push(<a key={`${keyPrefix}-${offset}`} data-raw-start={rawBase + offset + 1} data-raw-end={rawBase + offset + 1 + link[1]!.length} href={link[2]} onClick={(event) => {
        event.preventDefault()
        void window.creatorOS?.openExternalLink(link[2]!)
      }}>{renderDecoratedText(link[1]!, `${keyPrefix}-link-${offset}`, rawBase + offset + 1, annotations, manualMarks)}</a>)
    } else if (token.startsWith('**')) {
      result.push(<strong key={`${keyPrefix}-${offset}`} data-raw-start={rawBase + offset + 2} data-raw-end={rawBase + offset + token.length - 2}>{renderDecoratedText(token.slice(2, -2), `${keyPrefix}-strong-${offset}`, rawBase + offset + 2, annotations, manualMarks)}</strong>)
    } else {
      result.push(<code key={`${keyPrefix}-${offset}`} data-raw-start={rawBase + offset + 1} data-raw-end={rawBase + offset + token.length - 1}>{renderDecoratedText(token.slice(1, -1), `${keyPrefix}-code-${offset}`, rawBase + offset + 1, annotations, manualMarks)}</code>)
    }
    cursor = offset + token.length
  }
  if (cursor < value.length) result.push(...renderDecoratedText(value.slice(cursor), `${keyPrefix}-plain-${cursor}`, rawBase + cursor, annotations, manualMarks))
  return result
}

function renderDecoratedText(
  value: string,
  keyPrefix: string,
  rawBase: number,
  annotations: ReadableMarkdownAnnotation[],
  manualMarks: ReadableMarkdownManualMark[]
): ReactNode[] {
  if (!value) return []
  const rawEnd = rawBase + value.length
  const relevant = annotations
    .filter((annotation) => annotation.end > rawBase && annotation.start < rawEnd)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const relevantMarks = manualMarks
    .filter((mark) => mark.end > rawBase && mark.start < rawEnd)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  if (!relevant.length && !relevantMarks.length) {
    return [<span key={keyPrefix} data-raw-start={rawBase} data-raw-end={rawEnd}>{value}</span>]
  }
  const boundaries = new Set([rawBase, rawEnd])
  relevant.forEach((annotation) => {
    boundaries.add(Math.max(rawBase, annotation.start))
    boundaries.add(Math.min(rawEnd, annotation.end))
  })
  relevantMarks.forEach((mark) => {
    boundaries.add(Math.max(rawBase, mark.start))
    boundaries.add(Math.min(rawEnd, mark.end))
  })
  const ordered = [...boundaries].sort((left, right) => left - right)
  return ordered.slice(0, -1).flatMap((start, index): ReactNode[] => {
    const end = ordered[index + 1]!
    if (end <= start) return []
    const text = value.slice(start - rawBase, end - rawBase)
    const annotation = relevant.find((item) => item.start <= start && item.end >= end)
    const appliedMarks = relevantMarks.filter((item) => item.start <= start && item.end >= end)
    if (!annotation && !appliedMarks.length) {
      return [<span key={`${keyPrefix}-${start}`} data-raw-start={start} data-raw-end={end}>{text}</span>]
    }
    const className = [
      annotation ? `readable-annotation ${annotation.provenance.replaceAll('_', '-')}` : '',
      ...appliedMarks.map((mark) => `manual-${mark.style}`)
    ].filter(Boolean).join(' ')
    const status = appliedMarks.find((mark) => mark.status && mark.status !== 'active')?.status
    const statusLabel = status === 'position_changed' ? '位置已变化' : status === 'not_migrated' ? '未迁移' : ''
    const noteTitle = appliedMarks.map((mark) => mark.note).filter(Boolean).join('\n')
    const attributes = {
      key: `${keyPrefix}-${start}`,
      className,
      'data-raw-start': start,
      'data-raw-end': end,
      title: annotation?.label ?? ([noteTitle, statusLabel].filter(Boolean).join('\n') || undefined),
      'data-annotation-status': status,
      'data-annotation-status-label': statusLabel || undefined,
      'aria-label': statusLabel ? `${text}，工作台标记状态：${statusLabel}` : undefined
    }
    return annotation
      ? [<mark {...attributes}>{text}</mark>]
      : [<span {...attributes}>{text}</span>]
  })
}
