import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_STORAGE_KEYS,
  applyAppearance,
  normalizeAppearance,
  readCachedAppearance
} from '../../src/renderer/src/utils/appearance'

function memoryStorage(initial: Record<string, string> = {}): { getItem(key: string): string | null; setItem(key: string, value: string): void; values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) }
  }
}

describe('appearance preferences', () => {
  it('keeps warm light as the safe default and rejects unknown values', () => {
    expect(normalizeAppearance(undefined)).toEqual({ theme: 'light', visualStyle: 'warm' })
    expect(normalizeAppearance({ theme: 'dark', visualStyle: 'feishu' })).toEqual({ theme: 'dark', visualStyle: 'feishu' })
    expect(normalizeAppearance({ theme: 'unknown', visualStyle: 'notion' } as never)).toEqual({ theme: 'light', visualStyle: 'warm' })
  })

  it('reads color scheme and visual style independently from the local cache', () => {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEYS.theme]: 'dark',
      [APPEARANCE_STORAGE_KEYS.visualStyle]: 'feishu'
    })
    expect(readCachedAppearance(storage)).toEqual({ theme: 'dark', visualStyle: 'feishu' })
  })

  it('applies one complete snapshot to the root and cache', () => {
    const root = { dataset: {} }
    const storage = memoryStorage()
    expect(applyAppearance({ theme: 'dark', visualStyle: 'feishu' }, root, storage)).toEqual({ theme: 'dark', visualStyle: 'feishu' })
    expect(root.dataset).toEqual({ theme: 'dark', visualStyle: 'feishu' })
    expect(storage.values.get(APPEARANCE_STORAGE_KEYS.theme)).toBe('dark')
    expect(storage.values.get(APPEARANCE_STORAGE_KEYS.visualStyle)).toBe('feishu')
  })
})
