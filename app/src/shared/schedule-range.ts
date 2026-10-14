import type { ScheduleItem } from './domain'

export type ScheduleRangeEdge = 'start' | 'end'

export interface ScheduleRangeSegment {
  item: ScheduleItem
  startColumn: number
  span: number
  lane: number
  startsRange: boolean
  endsRange: boolean
}

// Schedule items are timed instants rather than all-day values. Calendar grouping
// therefore follows the device's current local timezone, matching the renderer's
// Date/Intl formatting and the date selected in the local calendar UI.
function localDateKeyForInstant(value: string): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function calendarDayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000
}

function dayDifference(later: string, earlier: string): number {
  return calendarDayNumber(later) - calendarDayNumber(earlier)
}

function addCalendarDays(value: string, days: number): string {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

export function isCrossDaySchedule(item: ScheduleItem): boolean {
  return Boolean(item.startAt && item.endAt && localDateKeyForInstant(item.endAt) > localDateKeyForInstant(item.startAt))
}

export function scheduleOccursOnDate(item: ScheduleItem, date: Date): boolean {
  if (!item.startAt) return false
  const target = localDateKey(date)
  const start = localDateKeyForInstant(item.startAt)
  const end = item.endAt ? localDateKeyForInstant(item.endAt) : start
  return start <= target && target <= end
}

export function scheduleRangeSegmentsForWeek(items: ScheduleItem[], weekStart: Date): ScheduleRangeSegment[] {
  const weekStartKey = localDateKey(weekStart)
  const weekEndDate = new Date(weekStart)
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  const weekEndKey = localDateKey(weekEndDate)
  const candidates = items.flatMap((item) => {
    if (!item.startAt || !item.endAt || !isCrossDaySchedule(item)) return []
    const startKey = localDateKeyForInstant(item.startAt)
    const endKey = localDateKeyForInstant(item.endAt)
    if (endKey < weekStartKey || startKey > weekEndKey) return []
    const segmentStart = startKey < weekStartKey ? weekStartKey : startKey
    const segmentEnd = endKey > weekEndKey ? weekEndKey : endKey
    const startColumn = dayDifference(segmentStart, weekStartKey)
    const endColumn = dayDifference(segmentEnd, weekStartKey)
    return [{
      item,
      startColumn,
      endColumn,
      span: endColumn - startColumn + 1,
      startsRange: segmentStart === startKey,
      endsRange: segmentEnd === endKey
    }]
  }).sort((a, b) => a.startColumn - b.startColumn || b.endColumn - a.endColumn || a.item.createdAt.localeCompare(b.item.createdAt) || a.item.id.localeCompare(b.item.id))

  const laneEnds: number[] = []
  return candidates.map(({ endColumn, ...segment }) => {
    let lane = laneEnds.findIndex((occupiedThrough) => occupiedThrough < segment.startColumn)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = endColumn
    return { ...segment, lane }
  })
}

export function resizeScheduleRange(item: ScheduleItem, edge: ScheduleRangeEdge, deltaDays: number): { startAt: string | null; endAt: string | null } {
  if (!item.startAt || deltaDays === 0) return { startAt: item.startAt, endAt: item.endAt }
  const startKey = localDateKeyForInstant(item.startAt)
  if (edge === 'end') {
    const baseEnd = item.endAt ?? item.startAt
    const nextEnd = addCalendarDays(baseEnd, deltaDays)
    if (localDateKeyForInstant(nextEnd) <= startKey) return { startAt: item.startAt, endAt: item.trip ? item.startAt : null }
    return { startAt: item.startAt, endAt: nextEnd }
  }
  if (!item.endAt) return { startAt: item.startAt, endAt: item.endAt }
  const endKey = localDateKeyForInstant(item.endAt)
  const nextStart = addCalendarDays(item.startAt, deltaDays)
  if (localDateKeyForInstant(nextStart) >= endKey) return { startAt: item.endAt, endAt: item.trip ? item.endAt : null }
  return { startAt: nextStart, endAt: item.endAt }
}

export function scheduleResizeDeltaForDate(item: ScheduleItem, edge: ScheduleRangeEdge, targetDateKey: string): number {
  if (!item.startAt) return 0
  const source = edge === 'start' ? item.startAt : item.endAt ?? item.startAt
  return dayDifference(targetDateKey, localDateKeyForInstant(source))
}

/** Reserve the highest occupied row, not the number of bars: lanes may have holes. */
export function scheduleOccupiedRows(segments: ScheduleRangeSegment[], dayIndex: number): number {
  return Math.max(0, ...segments.filter((s) => s.startColumn <= dayIndex && dayIndex < s.startColumn + s.span).map((s) => s.lane + 1))
}

/** Keep the grabbed calendar date under the pointer, including continued week segments. */
export function moveScheduleToDate(item: ScheduleItem, target: Date, grabbedDate?: string | null): { startAt: string; endAt: string | null } {
  const base = item.startAt ?? new Date(target.getFullYear(), target.getMonth(), target.getDate(), 14).toISOString()
  const delta = dayDifference(localDateKey(target), grabbedDate && /^\d{4}-\d{2}-\d{2}$/.test(grabbedDate) ? grabbedDate : localDateKeyForInstant(base))
  return { startAt: addCalendarDays(base, delta), endAt: item.endAt ? addCalendarDays(item.endAt, delta) : null }
}
