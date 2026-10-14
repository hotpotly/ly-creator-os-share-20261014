import type { TopicStageDefinition } from './domain'

/** Stable semantic mappings, independent of editable names and display order. */
export function topicStageToken(stage?: Pick<TopicStageDefinition, 'id' | 'role'>): string | undefined {
  if (!stage) return undefined
  const roles = { project_created: 'project-2', completed: 'project-6', archived: 'project-12', shelved: 'project-12' }
  if (stage.role !== 'standard') return roles[stage.role]
  const stages: Record<string, string> = { 'topic-stage-new': 'project-9', 'topic-stage-evaluation': 'project-4', 'topic-stage-decided': 'project-3' }
  return Object.hasOwn(stages, stage.id) ? stages[stage.id] : undefined
}

export function platformToken(platform: string): string | undefined {
  const platforms: Record<string, string> = { 'B站': 'project-2', '小红书': 'project-7', '抖音': 'project-3', '头条': 'project-4', '视频号': 'project-6', '微博': 'project-9', YouTube: 'project-1' }
  return Object.hasOwn(platforms, platform) ? platforms[platform] : undefined
}

/** Video duration is independent of content direction and commercial identity. */
export function videoFormatToken(value?: string | null): string | undefined {
  return value === 'long' ? 'project-5' : value === 'short' ? 'project-2' : undefined
}

/** Date-only fields stay calendar dates; timestamps follow the same local month as their visible label. */
export function dateLabelParts(value: string | null | undefined): { month: number; day: number } | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(`${value}T12:00:00`)
    return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? { month, day } : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : { month: date.getMonth() + 1, day: date.getDate() }
}
