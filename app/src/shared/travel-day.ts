import type { ScheduleItem } from './domain'
import { businessTripsForDate, TRAVEL_KINDS, TRAVEL_KIND_LABELS, type TravelKind } from './business-trip'

export function travelLabel(item: Pick<ScheduleItem, 'trip'>): string { return TRAVEL_KIND_LABELS[item.trip?.kind ?? 'business'] }
export type TravelTone = TravelKind | 'mixed' | 'business-rest' | 'home-rest' | 'all'
export function travelDayHighlight(items: ScheduleItem[], day: string): { tone: TravelTone; label: string } | undefined {
  const entries = businessTripsForDate(items, day, day)
  if (!entries.length) return undefined
  const kinds = TRAVEL_KINDS.filter(kind => entries.some(entry => (entry.item.trip?.kind ?? 'business') === kind))
  const tone: TravelTone = kinds.length === 3 ? 'all' : kinds.length === 1 ? kinds[0]! : kinds.includes('rest') ? kinds.includes('home') ? 'home-rest' : 'business-rest' : 'mixed'
  return { tone, label: entries.map(entry => `${travelLabel(entry.item)}·${entry.item.title}`).join('；') }
}
export function travelToneLabel(tone: TravelTone): string {
  const kinds: TravelKind[] = tone === 'all' ? [...TRAVEL_KINDS] : tone === 'mixed' ? ['business', 'home'] : tone === 'business-rest' ? ['business', 'rest'] : tone === 'home-rest' ? ['home', 'rest'] : [tone]
  return kinds.map(kind => TRAVEL_KIND_LABELS[kind]).join('／')
}
