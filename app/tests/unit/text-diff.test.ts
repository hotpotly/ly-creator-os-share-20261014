import { describe, expect, it } from 'vitest'
import { lineDiff } from '../../src/shared/text-diff'

describe('version text diff', () => {
  it('keeps normal line comparisons readable', () => {
    expect(lineDiff('第一行\n第二行', '第一行\n新第二行')).toEqual([
      { kind: 'same', text: '第一行' },
      { kind: 'removed', text: '第二行' },
      { kind: 'added', text: '新第二行' }
    ])
  })

  it('uses bounded memory for large pasted drafts', () => {
    const left = Array.from({ length: 60_000 }, (_, index) => `原稿${index}`).join('\n')
    const right = Array.from({ length: 60_000 }, (_, index) => index === 30_000 ? '改写30000' : `原稿${index}`).join('\n')
    const result = lineDiff(left, right)
    expect(result.length).toBeLessThanOrEqual(4_001)
    expect(result).toContainEqual(expect.objectContaining({ kind: 'omitted' }))
  })

  it('also bounds a near-limit draft when the other side is empty', () => {
    const result = lineDiff('', Array.from({ length: 300_000 }, () => '字').join('\n'))
    expect(result.length).toBe(4_001)
    expect(result[2_000]).toMatchObject({ kind: 'omitted' })
  })
})
