import { describe, expect, it } from 'vitest'
import { locateUniqueRawSelection } from '../../src/shared/text-selection'

describe('readable Markdown selection', () => {
  it('maps visible heading text back to the raw Markdown offsets', () => {
    expect(locateUniqueRawSelection('# 标题', '标题', 12)).toEqual({ start: 14, end: 16 })
  })

  it('does not invent offsets when the selected text appears more than once', () => {
    expect(locateUniqueRawSelection('重复 **重复**', '重复')).toBeNull()
  })
})
