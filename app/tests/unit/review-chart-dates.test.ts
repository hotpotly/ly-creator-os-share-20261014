import { expect, test } from 'vitest'
import { layoutReviewChartDates } from '../../src/shared/review-chart-dates'

test('dense months use one non-overlapping row without changing data positions', () => {
  for (const length of [28, 29, 30, 31]) for (const width of [140, 240, 370, 720, 1000]) {
    const dates = layoutReviewChartDates(Array.from({ length }, () => 'business'), width, null)
    expect(dates[0]!.index).toBe(0)
    expect(dates.at(-1)!.index).toBe(length - 1)
    for (const [i, date] of dates.entries()) {
      expect(date.center).toBeGreaterThanOrEqual(11)
      expect(date.center).toBeLessThanOrEqual(width - 11)
      if (i) expect(date.center - dates[i - 1]!.center).toBeGreaterThanOrEqual(26)
    }
  }
})
test('active dates are always visible and displace only overlapping labels', () => {
  const tones = Array.from({ length: 30 }, (_, index) => index < 20 ? 'business' : 'home-rest')
  for (const index of tones.keys()) {
    const dates = layoutReviewChartDates(tones, 240, index)
    expect(dates.some(date => date.index === index)).toBe(true)
    for (let i = 1; i < dates.length; i++) expect(dates[i]!.center - dates[i - 1]!.center).toBeGreaterThanOrEqual(26)
  }
})
test('weekly dates, single days and unmeasured charts stay bounded', () => {
  expect(layoutReviewChartDates(Array(7).fill(undefined), 200, null)).toHaveLength(7)
  expect(layoutReviewChartDates(['home'], 200, null)).toEqual([{ index: 0, center: 100 }])
  expect(layoutReviewChartDates([], 200, null)).toEqual([])
  expect(layoutReviewChartDates(['home'], 0, null)).toEqual([])
  expect(layoutReviewChartDates(['home'], 22, 9)).toEqual([{ index: 0, center: 11 }])
})
test('travel boundaries take precedence over optional interior ticks', () => {
  const tones = Array<string | undefined>(30).fill(undefined)
  for (const index of [5, 6, 7, 15, 16, 18, 19, 21, 22, 23]) tones[index] = 'business'
  const dates = layoutReviewChartDates(tones, 370, null)
  for (const index of [0, 5, 15, 18, 21, 29]) expect(dates.some(date => date.index === index)).toBe(true)
  expect(dates.length).toBeLessThan(15)
})
