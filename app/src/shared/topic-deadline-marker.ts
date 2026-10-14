import type { TopicRecord, TopicStageDefinition } from './domain'

export interface TopicDeadlineMarker {
  topicId: string
  title: string
  date: string
  overdue: boolean
}

export function deriveTopicDeadlineMarkers(
  topics: TopicRecord[],
  stages: TopicStageDefinition[],
  today: string
): TopicDeadlineMarker[] {
  const standardStageIds = new Set(stages.filter((stage) => stage.role === 'standard').map((stage) => stage.id))
  const seen = new Set<string>()
  const markers: TopicDeadlineMarker[] = []

  for (const topic of topics) {
    if (
      seen.has(topic.id)
      || topic.trashedAt
      || !topic.expectedCompletionAt
      || !standardStageIds.has(topic.stageId)
    ) continue

    seen.add(topic.id)
    markers.push({
      topicId: topic.id,
      title: topic.title,
      date: topic.expectedCompletionAt,
      overdue: topic.expectedCompletionAt < today
    })
  }

  return markers.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title))
}
