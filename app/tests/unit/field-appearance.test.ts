import { describe, expect, it } from 'vitest'
import { dateLabelParts, platformToken, topicStageToken, videoFormatToken } from '../../src/shared/field-appearance'

describe('compact field identity', () => {
  it('uses yellow for long video, blue for short video and neutral for unset values', () => {
    expect(videoFormatToken('long')).toBe('project-5')
    expect(videoFormatToken('short')).toBe('project-2')
    for (const value of [null, undefined, '', 'undetermined', 'commercial']) expect(videoFormatToken(value)).toBeUndefined()
  })
  it('uses stable calendar months across years, including leap days', () => {
    for (let month = 1; month <= 12; month++) {
      for (const year of [2026, 2027]) expect(dateLabelParts(`${year}-${String(month).padStart(2, '0')}-09`)).toEqual({ month, day: 9 })
    }
    expect(dateLabelParts('2028-02-29')).toEqual({ month: 2, day: 29 })
  })
  it('does not color unset, invalid or rolled-over calendar dates', () => {
    for (const value of [null, undefined, '', 'abc', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-09-00']) expect(dateLabelParts(value)).toBeNull()
  })
  it('colors timestamps by the displayed local month, not the UTC string prefix', () => {
    for (const value of ['2026-08-31T23:30:00Z', '2027-01-01T00:30:00+08:00']) {
      const local = new Date(value)
      expect(dateLabelParts(value)).toEqual({ month: local.getMonth() + 1, day: local.getDate() })
    }
  })
  it('keeps lifecycle meanings and unknown values neutral', () => {
    expect(topicStageToken({ id: 'renamed-or-custom', role: 'completed' })).toBe('project-6')
    expect(topicStageToken({ id: 'topic-stage-evaluation', role: 'standard' })).toBe('project-4')
    expect(topicStageToken({ id: 'custom', role: 'standard' })).toBeUndefined()
    expect(topicStageToken()).toBeUndefined()
    expect(platformToken('B站')).toBe('project-2')
    expect(platformToken('toString')).toBeUndefined()
  })
})
