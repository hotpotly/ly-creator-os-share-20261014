import { describe, expect, it } from 'vitest'
import { contentTypeAppearance } from '../../src/shared/content-type-appearance'

describe('content direction identity', () => {
  it('gives each built-in a distinct text background tone using stable IDs, without icons', () => {
    const values = ['digital', 'commercial', 'system', 'ai', 'quick'].map(id => contentTypeAppearance(`type-${id}`))
    expect(values.every(value => !('icon' in value))).toBe(true)
    expect(new Set(values.map(value => value.tone)).size).toBe(5)
  })
  it('does not infer a built-in from display names and handles custom or missing IDs', () => {
    for (const id of ['数码', 'custom-1', 'toString', '__proto__', '']) expect(contentTypeAppearance(id)).toEqual({ tone: 'custom' })
  })
})
