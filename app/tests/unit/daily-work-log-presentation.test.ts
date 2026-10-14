import { describe, expect, it } from 'vitest'
import { dailyWorkTone, recordedWorkMinutes } from '../../src/shared/daily-work-log'
describe('daily work hours presentation', () => {
  it('distinguishes missing records from saved zero and keeps category totals', () => {
    const record = { day: '2026-09-27', totalMinutes: null, selfMediaMinutes: 0, aiMinutes: 0, otherWorkMinutes: 0, updatedAt: '' }
    expect(recordedWorkMinutes(record)).toBeNull()
    expect(recordedWorkMinutes({ ...record, updatedAt: 'saved' })).toBe(0)
    expect(recordedWorkMinutes({ ...record, updatedAt: 'saved', aiMinutes: 360 })).toBe(360)
    expect(recordedWorkMinutes({ ...record, updatedAt: 'saved', aiMinutes: 360, totalMinutes: 150 })).toBe(150)
  })
  it('uses exact minutes around the inclusive six hour boundary', () => {
    expect([null, 0, 1, 359, 360, 361, 1440].map(dailyWorkTone)).toEqual(['missing', 'zero', 'low', 'low', 'enough', 'enough', 'enough'])
  })
})
