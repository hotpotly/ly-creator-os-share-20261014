import type { CreateScheduleInput, ScheduleItem } from './domain'

export function canGroupSchedules(items: (CreateScheduleInput | ScheduleItem)[]): boolean {
  const first = items[0]
  if (!first) return false
  return items.length > 1 && Boolean(first.projectId && first.startAt) &&
    new Set(items.map(item => item.actionType)).size === items.length &&
    items.every(item => item.actionType !== 'overview' && item.projectId === first.projectId &&
      item.startAt === first.startAt && item.endAt === first.endAt && item.scheduleKind === first.scheduleKind)
}

export type ScheduleDisplayItem = ScheduleItem & { members?: ScheduleItem[] }

export function groupScheduleItems(items: ScheduleItem[], labels: Record<string, string>): ScheduleDisplayItem[] {
  const groups = new Map<string, ScheduleItem[]>()
  for (const item of items) if (item.groupId) groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item])
  const seen = new Set<string>()
  return items.flatMap(item => {
    if (!item.groupId) return [item]
    if (seen.has(item.groupId)) return []
    seen.add(item.groupId)
    const members = groups.get(item.groupId)!
    if (members.length === 1) return [item]
    const stages = members.map(member => labels[member.actionType] ?? member.actionType).join('／')
    const notes = [...new Set(members.map(member => {
      const label = labels[member.actionType] ?? member.actionType
      return member.title === label ? '' : member.title.endsWith(`·${label}`) ? member.title.slice(0, -label.length - 1) : member.title
    }).filter(Boolean))]
    return [{ ...item, members, title: [...notes, stages].join('·'), state: members.every(member => member.state === 'done') ? 'done' : members.find(member => member.state !== 'done')!.state }]
  })
}
