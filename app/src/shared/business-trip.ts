import { z } from 'zod'
import type { ScheduleItem } from './domain'

export const TRAVEL_KINDS = ['business', 'home', 'rest'] as const
export type TravelKind = typeof TRAVEL_KINDS[number]
export const TRAVEL_KIND_LABELS: Record<TravelKind, string> = { business: '出差', home: '回家', rest: '休息' }
export const TRAVEL_DEFAULT_TITLES: Record<TravelKind, string> = { business: '出差', home: '回老家', rest: '休息' }
export const TRAVEL_CURRENT_LABELS: Record<TravelKind, string> = { business: '出差中', home: '在老家', rest: '休息中' }
export const businessTripMetaSchema = z.object({
  kind: z.enum(TRAVEL_KINDS).optional(),
  notes: z.string().max(2000), cancelled: z.boolean(), endedEarly: z.boolean()
}).strict()
export type BusinessTripMeta = z.infer<typeof businessTripMetaSchema>
export const businessTripSaveSchema = z.object({
  kind: z.enum(TRAVEL_KINDS).optional(),
  scheduleId: z.string().min(1).max(128).nullable(),
  expectedUpdatedAt: z.string().nullable(),
  action: z.enum(['save', 'cancel', 'end_early']),
  title: z.string().trim().min(1, '请填写行程名称或目的地').max(300),
  projectId: z.string().min(1).max(128).nullable(),
  startDate: z.iso.date(), endDate: z.iso.date(), notes: z.string().trim().max(2000)
}).strict().superRefine((input, ctx) => {
  if (input.endDate < input.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: '结束日期不能早于开始日期' })
  if (Boolean(input.scheduleId) !== Boolean(input.expectedUpdatedAt) || (!input.scheduleId && input.action !== 'save')) {
    ctx.addIssue({ code: 'custom', message: '行程记录版本无效，请重新打开' })
  }
})
export type BusinessTripSaveInput = z.infer<typeof businessTripSaveSchema>
export function tripDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function dayNumber(day: string): number { return Date.parse(`${day}T00:00:00Z`) / 86400000 }
export function tripStatusLabel(item: ScheduleItem, day: string, today: string): string {
  const kind = item.trip?.kind ?? 'business', label = TRAVEL_KIND_LABELS[kind]
  if (item.state === 'done') return `${label}已完成`
  if (item.trip?.cancelled) return `已取消${label}`
  if (item.trip?.endedEarly && day === today && day === tripDate(item.endAt)) return `${label}已结束`
  return day < today ? `${label}记录` : day > today ? `${label}安排` : TRAVEL_CURRENT_LABELS[kind]
}
export function businessTripsForDate(items: ScheduleItem[], day: string, today: string): Array<{ item: ScheduleItem; label: string; range: string; progress: string }> {
  return items.flatMap(item => {
    const start = tripDate(item.startAt), end = tripDate(item.endAt) ?? start
    if (!item.trip || item.trip.cancelled || !start || !end || day < start || day > end) return []
    return [{ item, label: tripStatusLabel(item, day, today), range: start === end ? start : `${start}—${end}`, progress: `第${dayNumber(day) - dayNumber(start) + 1}天／共${dayNumber(end) - dayNumber(start) + 1}天` }]
  }).sort((a, b) => (a.item.startAt ?? '').localeCompare(b.item.startAt ?? '') || a.item.id.localeCompare(b.item.id))
}
