import type { ScriptRevisionMessage } from './domain'

export function messageTargetId(message: ScriptRevisionMessage): string | null {
  return message.selectionSnapshot?.targetSelectionId
    ?? message.contextSnapshot?.selection.targetSelectionId
    ?? (message.selectionHash ? `legacy-${message.selectionHash}` : null)
}

export interface CandidateMessageGroup {
  key: string
  number: number
  revisions: ScriptRevisionMessage[]
}

export function groupCandidateMessages(messages: ScriptRevisionMessage[]): {
  latestIds: Set<string>
  groupByMessageId: Map<string, CandidateMessageGroup>
} {
  const groups = new Map<string, CandidateMessageGroup>()
  let nextFallbackNumber = 1
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.suggestion) continue
    const key = message.candidateGroupId ?? messageTargetId(message) ?? `message-${message.id}`
    let group = groups.get(key)
    if (!group) {
      const number = message.candidateNumber ?? nextFallbackNumber
      group = { key, number, revisions: [] }
      groups.set(key, group)
      nextFallbackNumber = Math.max(nextFallbackNumber, number + 1)
    }
    group.revisions.push(message)
  }
  groups.forEach((group) => group.revisions.sort((left, right) => {
    if (left.generationRound && right.generationRound && left.generationRound !== right.generationRound) {
      return left.generationRound - right.generationRound
    }
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  }))
  const latestIds = new Set(Array.from(groups.values()).map((group) => group.revisions.at(-1)?.id).filter(Boolean) as string[])
  const groupByMessageId = new Map<string, CandidateMessageGroup>()
  groups.forEach((group) => group.revisions.forEach((message) => groupByMessageId.set(message.id, group)))
  return { latestIds, groupByMessageId }
}
