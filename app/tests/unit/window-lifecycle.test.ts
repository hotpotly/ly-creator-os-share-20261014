import { describe, expect, it } from 'vitest'
import { shouldHideMainWindow } from '../../src/main/window-lifecycle'

describe('main window lifecycle', () => {
  it('hides an ordinary user close without intercepting tests or real quit', () => {
    expect(shouldHideMainWindow(false, false)).toBe(true)
    expect(shouldHideMainWindow(true, false)).toBe(false)
    expect(shouldHideMainWindow(false, true)).toBe(false)
  })
})
