import type { StageTimePoint, StageTimeSegment } from '../domain'

export const CREATION_DAY_CUTOFF_HOUR = 4

const DAY_MS = 86_400_000
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SEGMENT_INDEX: Record<StageTimeSegment, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2
}

interface ZonedDateParts {
  localDate: string
  hour: number
}

function zonedDateParts(instant: Date, timeZone: string): ZonedDateParts {
  if (!Number.isFinite(instant.getTime())) throw new Error('时间无效')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  const localDate = `${read('year')}-${read('month')}-${read('day')}`
  const hour = Number(read('hour'))
  if (!isValidLocalDate(localDate) || !Number.isFinite(hour)) throw new Error('时间无效')
  return { localDate, hour }
}

export function shiftDateKey(localDate: string, days: number): string {
  if (!isValidLocalDate(localDate)) throw new Error('日期格式无效')
  return new Date(Date.parse(`${localDate}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function dateKeyDifferenceInDays(actual: string, expected: string): number {
  if (!isValidLocalDate(actual) || !isValidLocalDate(expected)) throw new Error('日期格式无效')
  return Math.round((Date.parse(`${actual}T00:00:00.000Z`) - Date.parse(`${expected}T00:00:00.000Z`)) / DAY_MS)
}

export function isValidLocalDate(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function localDateForInstant(instant: Date, timeZone: string): string {
  return zonedDateParts(instant, timeZone).localDate
}

export function normalizeCreationDay(
  instant: Date,
  timeZone = 'Asia/Shanghai',
  cutoffHour = CREATION_DAY_CUTOFF_HOUR
): StageTimePoint {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) throw new Error('凌晨归属切点无效')
  const { localDate, hour } = zonedDateParts(instant, timeZone)
  if (hour < cutoffHour) return { localDate: shiftDateKey(localDate, -1), segment: 'evening' }
  return {
    localDate,
    segment: hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  }
}

export function toSegmentOrdinal(point: StageTimePoint): number {
  if (!isValidLocalDate(point.localDate) || !(point.segment in SEGMENT_INDEX)) throw new Error('阶段时间格式无效')
  return Math.floor(Date.parse(`${point.localDate}T00:00:00.000Z`) / DAY_MS) * 3 + SEGMENT_INDEX[point.segment]
}

export function shiftStageTimePoint(point: StageTimePoint, segments: number): StageTimePoint {
  if (!Number.isInteger(segments)) throw new Error('阶段时段偏移必须是整数')
  const ordinal = toSegmentOrdinal(point) + segments
  const dayOrdinal = Math.floor(ordinal / 3)
  const segmentIndex = ((ordinal % 3) + 3) % 3
  const segment = (Object.keys(SEGMENT_INDEX) as StageTimeSegment[])
    .find((candidate) => SEGMENT_INDEX[candidate] === segmentIndex)
  if (!segment) throw new Error('阶段时段无效')
  return {
    localDate: new Date(dayOrdinal * DAY_MS).toISOString().slice(0, 10),
    segment
  }
}

export function recentStageTimePoints(currentPoint: StageTimePoint, count = 6): StageTimePoint[] {
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('快捷时间数量无效')
  return Array.from({ length: count }, (_, index) => shiftStageTimePoint(currentPoint, -index))
}

export function diffSegments(startedAt: StageTimePoint, completedAt: StageTimePoint): number {
  return toSegmentOrdinal(completedAt) - toSegmentOrdinal(startedAt)
}

export function formatCoarseDuration(segments: number | null): string | null {
  if (segments === null) return null
  if (!Number.isFinite(segments) || segments < 0) throw new Error('阶段历时不能为负数')
  if (segments <= 0.5) return '半天内'
  if (segments <= 2) return '约半天'
  const days = Math.floor((segments / 3) * 2 + 0.5) / 2
  return `约${Number.isInteger(days) ? days.toFixed(0) : days}天`
}

export function calculateScheduleVariance(
  expectedCompletionAt: string | null,
  actualCompletionAt: string | null,
  today: string
): number | null {
  if (!expectedCompletionAt) return null
  if (!isValidLocalDate(expectedCompletionAt) || !isValidLocalDate(today) || (actualCompletionAt && !isValidLocalDate(actualCompletionAt))) {
    throw new Error('日期格式无效')
  }
  if (actualCompletionAt) return dateKeyDifferenceInDays(actualCompletionAt, expectedCompletionAt)
  return today > expectedCompletionAt ? dateKeyDifferenceInDays(today, expectedCompletionAt) : null
}
