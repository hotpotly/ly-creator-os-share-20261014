import { describe, expect, it } from 'vitest'
import { stageActualTimeLabel } from '../../src/shared/stage-review'
import type { StageTimePoint } from '../../src/shared/domain'
const point: StageTimePoint = { localDate: '2026-09-20', segment: 'morning' }
const format = (p: StageTimePoint): string => p.localDate

describe('stage review missing dates', () => {
  it('keeps an actual completion without inventing a start', () => {
    expect(stageActualTimeLabel({ status: 'completed', startedAt: null, completedAt: point }, format)).toBe('已完成于2026-09-20，开始时间未记录')
    expect(stageActualTimeLabel({ status: 'completed', startedAt: null, completedAt: null }, format)).toBe('已完成，起止时间未记录')
  })
  it('distinguishes not started, skipped and incomplete recording', () => {
    expect(stageActualTimeLabel({ status: 'not_started', startedAt: null, completedAt: null }, format)).toBe('未开始')
    expect(stageActualTimeLabel({ status: 'in_progress', startedAt: null, completedAt: null }, format)).toBe('进行中，开始时间未记录')
    expect(stageActualTimeLabel({ status: 'skipped', startedAt: null, completedAt: null }, format)).toBe('已跳过')
    expect(stageActualTimeLabel({ status: 'completed', startedAt: point, completedAt: null }, format)).toBe('2026-09-20—完成时间未记录')
  })
})
