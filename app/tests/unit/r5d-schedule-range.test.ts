import { describe, expect, it } from 'vitest'
import type { ScheduleItem } from '../../src/shared/domain'
import { isCrossDaySchedule, moveScheduleToDate, scheduleOccupiedRows, resizeScheduleRange, scheduleOccursOnDate, scheduleRangeSegmentsForWeek, scheduleResizeDeltaForDate } from '../../src/shared/schedule-range'

function schedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'range-1',
    projectId: 'ios',
    colorToken: null,
    title: '跨周拍摄',
    actionType: 'production',
    startAt: new Date(2026, 6, 17, 9).toISOString(),
    endAt: new Date(2026, 6, 22, 9).toISOString(),
    scheduleKind: 'plan',
    state: 'normal',
    waitingFor: null,
    source: 'user',
    isMovable: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('R5d schedule ranges', () => {
  it('calculates resize distance from the date under the pointer across calendar rows', () => {
    const item = schedule({
      startAt: new Date(2026, 6, 29, 9).toISOString(),
      endAt: new Date(2026, 6, 31, 9).toISOString()
    })
    expect(scheduleResizeDeltaForDate(item, 'end', '2026-08-05')).toBe(5)
    expect(scheduleResizeDeltaForDate(item, 'start', '2026-07-27')).toBe(-2)
  })

  it('splits a cross-week schedule into rounded start and end segments', () => {
    const item = schedule()
    const firstWeek = scheduleRangeSegmentsForWeek([item], new Date(2026, 6, 13, 12))
    const secondWeek = scheduleRangeSegmentsForWeek([item], new Date(2026, 6, 20, 12))

    expect(firstWeek).toMatchObject([{ startColumn: 4, span: 3, lane: 0, startsRange: true, endsRange: false }])
    expect(secondWeek).toMatchObject([{ startColumn: 0, span: 3, lane: 0, startsRange: false, endsRange: true }])
    expect(isCrossDaySchedule(item)).toBe(true)
    expect(scheduleOccursOnDate(item, new Date(2026, 6, 20, 12))).toBe(true)
  })

  it('allocates overlapping ranges to separate lanes', () => {
    const segments = scheduleRangeSegmentsForWeek([
      schedule(),
      schedule({ id: 'range-2', startAt: new Date(2026, 6, 18, 9).toISOString(), endAt: new Date(2026, 6, 21, 9).toISOString() })
    ], new Date(2026, 6, 13, 12))

    expect(segments.map((segment) => segment.lane)).toEqual([0, 1])
  })

  it('extends a single-day schedule from the right and can collapse a range again', () => {
    const single = schedule({ startAt: new Date(2026, 6, 15, 9).toISOString(), endAt: null })
    const extended = resizeScheduleRange(single, 'end', 2)
    expect(extended.endAt?.slice(0, 10)).toBe('2026-07-17')

    const collapsed = resizeScheduleRange(schedule(), 'start', 10)
    expect(collapsed.startAt).toBe(schedule().endAt)
    expect(collapsed.endAt).toBeNull()
  })

  it('keeps device-local calendar dates stable while splitting a range across a month boundary', () => {
    const item = schedule({
      startAt: new Date(2026, 6, 30, 9).toISOString(),
      endAt: new Date(2026, 7, 3, 9).toISOString()
    })
    const julyWeek = scheduleRangeSegmentsForWeek([item], new Date(2026, 6, 27, 12))
    const augustWeek = scheduleRangeSegmentsForWeek([item], new Date(2026, 7, 3, 12))

    expect(julyWeek).toMatchObject([{ startColumn: 3, span: 4, startsRange: true, endsRange: false }])
    expect(augustWeek).toMatchObject([{ startColumn: 0, span: 1, startsRange: false, endsRange: true }])
  })
})

describe('R5e sparse lanes and anchored calendar moves', () => {
  it('reserves the highest occupied lane when an earlier range has ended', () => {
    const rows = scheduleRangeSegmentsForWeek([
      schedule({ id: 'a', startAt: new Date(2026, 6, 13, 9).toISOString(), endAt: new Date(2026, 6, 15, 9).toISOString() }),
      schedule({ id: 'b', startAt: new Date(2026, 6, 14, 9).toISOString(), endAt: new Date(2026, 6, 17, 9).toISOString() })
    ], new Date(2026, 6, 13))
    expect(rows.filter((s) => s.startColumn <= 3 && s.startColumn + s.span > 3)).toHaveLength(1)
    expect(scheduleOccupiedRows(rows, 3)).toBe(2)
  })

  it('1000 deterministic mixed layouts never share a lane on the same date and stay stable across input order', () => {
    let seed = 718
    const next = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
    for (let run = 0; run < 1000; run++) {
      const items = Array.from({ length: 5 + next() % 30 }, (_, index) => {
        const start = 1 + next() % 29
        return schedule({ id: `s-${index}`, startAt: new Date(2026, 6, start, 9).toISOString(), endAt: new Date(2026, 6, start + 1 + next() % 14, 19).toISOString() })
      })
      const week = new Date(2026, 6, 13)
      const rows = scheduleRangeSegmentsForWeek(items, week)
      expect(scheduleRangeSegmentsForWeek([...items].reverse(), week)).toEqual(rows)
      for (let day = 0; day < 7; day++) {
        const covered = rows.filter((s) => s.startColumn <= day && day < s.startColumn + s.span)
        expect(new Set(covered.map((s) => s.lane)).size).toBe(covered.length)
        expect(covered.every((s) => s.lane < scheduleOccupiedRows(rows, day))).toBe(true)
      }
    }
  })

  it('moves a continued segment by the grabbed date rather than jumping its start to the drop date', () => {
    const item = schedule()
    const moved = moveScheduleToDate(item, new Date(2026, 6, 23), '2026-07-21')
    expect(new Date(moved.startAt).getDate()).toBe(19)
    expect(new Date(moved.endAt!).getDate()).toBe(24)
    expect(new Date(moved.startAt).getHours()).toBe(9)
    expect(moveScheduleToDate(item, new Date(2026, 6, 21), '2026-07-21')).toEqual({ startAt: item.startAt, endAt: item.endAt })
  })

  it('handles year/month boundaries, leap day and single/unscheduled items', () => {
    const item = schedule({ startAt: new Date(2028, 1, 28, 19).toISOString(), endAt: new Date(2028, 2, 2, 9).toISOString() })
    const moved = moveScheduleToDate(item, new Date(2028, 11, 31))
    expect(new Date(moved.startAt).getDate()).toBe(31)
    expect(new Date(moved.endAt!).getFullYear()).toBe(2029)
    expect(new Date(moved.endAt!).getDate()).toBe(3)
    expect(new Date(moved.endAt!).getHours()).toBe(9)
    expect(moveScheduleToDate(schedule({ startAt: null, endAt: null }), new Date(2026, 6, 20)).endAt).toBeNull()
  })
})
