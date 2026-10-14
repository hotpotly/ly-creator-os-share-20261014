import { describe, expect, it } from 'vitest'
import { shouldRefreshWorkspaceClock } from '../../src/shared/domain/workspace-clock'

describe('workspace clock refresh', () => {
  it('refreshes when the 04:00 creative-day boundary changes without a natural-day change', () => {
    expect(shouldRefreshWorkspaceClock(
      '2026-07-20',
      '2026-07-19',
      new Date('2026-07-20T03:59:00+08:00'),
      'Asia/Shanghai'
    )).toBe(false)
    expect(shouldRefreshWorkspaceClock(
      '2026-07-20',
      '2026-07-19',
      new Date('2026-07-20T04:00:00+08:00'),
      'Asia/Shanghai'
    )).toBe(true)
  })

  it('also refreshes when the natural date changes before the creative-day cutoff', () => {
    expect(shouldRefreshWorkspaceClock(
      '2026-07-19',
      '2026-07-19',
      new Date('2026-07-20T00:00:00+08:00'),
      'Asia/Shanghai'
    )).toBe(true)
  })
})
