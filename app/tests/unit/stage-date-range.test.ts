import { describe, expect, it } from 'vitest'
import { formatStageDateRange } from '../../src/renderer/src/utils/stage-date-range'
import type { StageTimePoint } from '../../src/shared/domain'
const point = (localDate: string): StageTimePoint => ({ localDate, segment: 'morning' })
describe('compact stage date ranges', () => {
  it('offers an action for unset dates', () => expect(formatStageDateRange(null, null)).toBe('设置阶段时间'))
  it('describes an open start rather than displaying two dashes', () => expect(formatStageDateRange(point('2026-07-28'), null)).toBe('07/28开始'))
  it('describes an end-only record', () => expect(formatStageDateRange(null, point('2026-09-13'))).toBe('09/13结束'))
  it('does not repeat the same day', () => expect(formatStageDateRange(point('2026-09-13'), point('2026-09-13'))).toBe('09/13'))
  it('renders a date range', () => expect(formatStageDateRange(point('2026-09-01'), point('2026-09-13'))).toBe('09/01—09/13'))
  it('keeps both years for cross-year work', () => expect(formatStageDateRange(point('2025-12-28'), point('2026-01-03'))).toBe('2025/12/28—2026/01/03'))
})
