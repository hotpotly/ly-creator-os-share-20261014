import { describe, expect, it } from 'vitest'
import {
  clampHomeSplit,
  clampHomeSplitForWidth,
  homeSplitBoundsForWidth,
  HOME_SECONDARY_MIN_PX,
  HOME_SPLIT_DEFAULT,
  HOME_SPLIT_FIXED_PX,
  HOME_SPLIT_MAX,
  HOME_SPLIT_MIN
} from '../../src/renderer/src/utils/layout'

describe('home split contract', () => {
  it('uses the approved default', () => {
    expect(HOME_SPLIT_DEFAULT).toBe(63)
  })

  it('clamps the configured ratio bounds', () => {
    expect(clampHomeSplit(10)).toBe(HOME_SPLIT_MIN)
    expect(clampHomeSplit(62)).toBe(62)
    expect(clampHomeSplit(90)).toBe(HOME_SPLIT_MAX)
  })

  it('keeps both columns readable after fixed divider gaps', () => {
    expect(clampHomeSplitForWidth(72, 997)).toBe(72)
    expect(clampHomeSplitForWidth(46, 801)).toBeCloseTo(54.93, 1)
    expect(clampHomeSplitForWidth(63, 997)).toBe(63)
    expect(homeSplitBoundsForWidth(801).min).toBeCloseTo(54.93, 1)
    expect(homeSplitBoundsForWidth(801).max).toBeCloseTo(67.04, 1)
  })

  it('lets the secondary column be dragged down to its minimum width', () => {
    for (const width of [801, 997, 1200, 1600]) {
      const secondary = width - HOME_SPLIT_FIXED_PX - (homeSplitBoundsForWidth(width).max / 100) * width
      expect(secondary).toBeGreaterThanOrEqual(HOME_SECONDARY_MIN_PX - 0.01)
    }
    expect(801 - HOME_SPLIT_FIXED_PX - (homeSplitBoundsForWidth(801).max / 100) * 801).toBeCloseTo(HOME_SECONDARY_MIN_PX, 1)
  })
})
