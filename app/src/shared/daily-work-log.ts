import type { DailyWorkLog } from './domain'

export function recordedWorkMinutes(record: DailyWorkLog): number | null {
  return record.updatedAt ? record.totalMinutes ?? record.selfMediaMinutes + record.aiMinutes + record.otherWorkMinutes : null
}
export function dailyWorkTone(minutes: number | null): 'missing' | 'zero' | 'low' | 'enough' {
  return minutes === null ? 'missing' : minutes === 0 ? 'zero' : minutes >= 360 ? 'enough' : 'low'
}
