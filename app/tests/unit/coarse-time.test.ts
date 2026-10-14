import { describe, expect, it } from 'vitest'
import {
  calculateScheduleVariance,
  diffSegments,
  formatCoarseDuration,
  normalizeCreationDay,
  recentStageTimePoints,
  shiftStageTimePoint,
  toSegmentOrdinal
} from '../../src/shared/domain/coarse-time'

describe('coarse time domain', () => {
  it('assigns the hours before 04:00 to the previous evening', () => {
    expect(normalizeCreationDay(new Date('2026-07-20T03:59:00+08:00'), 'Asia/Shanghai')).toEqual({
      localDate: '2026-07-19',
      segment: 'evening'
    })
    expect(normalizeCreationDay(new Date('2026-07-20T04:00:00+08:00'), 'Asia/Shanghai')).toEqual({
      localDate: '2026-07-20',
      segment: 'morning'
    })
  })

  it('uses the agreed morning, afternoon and evening boundaries', () => {
    expect(normalizeCreationDay(new Date('2026-07-20T11:59:00+08:00'), 'Asia/Shanghai').segment).toBe('morning')
    expect(normalizeCreationDay(new Date('2026-07-20T12:00:00+08:00'), 'Asia/Shanghai').segment).toBe('afternoon')
    expect(normalizeCreationDay(new Date('2026-07-20T18:00:00+08:00'), 'Asia/Shanghai').segment).toBe('evening')
  })

  it('calculates segment differences across dates from one shared ordinal', () => {
    const start = { localDate: '2026-07-18', segment: 'afternoon' } as const
    const end = { localDate: '2026-07-20', segment: 'evening' } as const
    expect(diffSegments(start, end)).toBe(7)
    expect(toSegmentOrdinal(end) - toSegmentOrdinal(start)).toBe(7)
  })

  it('builds recent quick choices from complete coarse time points across date boundaries', () => {
    const current = { localDate: '2026-01-01', segment: 'morning' } as const
    expect(recentStageTimePoints(current, 5)).toEqual([
      { localDate: '2026-01-01', segment: 'morning' },
      { localDate: '2025-12-31', segment: 'evening' },
      { localDate: '2025-12-31', segment: 'afternoon' },
      { localDate: '2025-12-31', segment: 'morning' },
      { localDate: '2025-12-30', segment: 'evening' }
    ])
    expect(shiftStageTimePoint({ localDate: '2026-07-20', segment: 'afternoon' }, -1)).toEqual({
      localDate: '2026-07-20',
      segment: 'morning'
    })
  })

  it('formats durations with the three-segments-per-day rule', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(formatCoarseDuration)).toEqual([
      '半天内',
      '约半天',
      '约半天',
      '约1天',
      '约1.5天',
      '约1.5天',
      '约2天',
      '约2.5天'
    ])
  })

  it('calculates early, delayed and unfinished schedule variance', () => {
    expect(calculateScheduleVariance('2026-07-20', '2026-07-18', '2026-07-24')).toBe(-2)
    expect(calculateScheduleVariance('2026-07-20', '2026-07-23', '2026-07-24')).toBe(3)
    expect(calculateScheduleVariance('2026-07-20', null, '2026-07-24')).toBe(4)
    expect(calculateScheduleVariance('2026-07-25', null, '2026-07-24')).toBeNull()
    expect(calculateScheduleVariance(null, null, '2026-07-24')).toBeNull()
  })
})
