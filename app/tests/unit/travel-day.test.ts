import { expect, test } from 'vitest'
import type { ScheduleItem } from '../../src/shared/domain'
import { travelDayHighlight, travelToneLabel } from '../../src/shared/travel-day'
const trip = (kind?: 'business' | 'home' | 'rest'): ScheduleItem => ({ id: kind ?? 'legacy', title: '行程', startAt: '2026-09-30T12:00:00', endAt: '2026-10-02T12:00:00', trip: { kind, notes: '', cancelled: false, endedEarly: false } } as ScheduleItem)
test('legacy trips are purple; home blue; overlaps retain both without inferring from ordinary titles', () => {
 expect(travelDayHighlight([trip()], '2026-09-30')?.tone).toBe('business')
 expect(travelDayHighlight([trip('home')], '2026-10-02')?.tone).toBe('home')
 expect(travelDayHighlight([trip(), trip('home')], '2026-10-01')).toEqual({ tone: 'mixed', label: '回家·行程；出差·行程' })
 expect(travelDayHighlight([trip()], '2026-10-03')).toBeUndefined()
 expect(travelDayHighlight([trip()], '2026-09-29')).toBeUndefined()
 expect(travelDayHighlight([{...trip(),trip:null,title:'回家出差'}], '2026-10-01')).toBeUndefined()
 expect(travelDayHighlight([{...trip(),trip:{...trip().trip!,cancelled:true}}], '2026-10-01')).toBeUndefined()
})

test('rest and every overlap retain type identity without filling missing hours', () => {
 expect(travelDayHighlight([trip('rest')], '2026-10-01')).toEqual({ tone: 'rest', label: '休息·行程' })
 for (const [kinds, tone, label] of [
  [['business', 'rest'], 'business-rest', '出差／休息'],
  [['home', 'rest'], 'home-rest', '回家／休息'],
  [['business', 'home', 'rest'], 'all', '出差／回家／休息']
 ] as const) {
  expect(travelDayHighlight(kinds.map(kind => trip(kind)), '2026-10-01')?.tone).toBe(tone)
  expect(travelToneLabel(tone)).toBe(label)
 }
 expect(travelDayHighlight([trip('rest'), trip('rest')], '2026-10-01')?.tone).toBe('rest')
 expect(travelDayHighlight([{ ...trip('rest'), trip: { ...trip('rest').trip!, cancelled: true } }], '2026-10-01')).toBeUndefined()
})
