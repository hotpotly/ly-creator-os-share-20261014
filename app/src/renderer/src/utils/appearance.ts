import type { AppearanceSnapshot, ColorScheme, VisualStyle } from '../../../shared/domain'

interface AppearanceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface AppearanceRoot {
  dataset: Record<string, string | undefined>
}

export const APPEARANCE_STORAGE_KEYS = {
  theme: 'ly.creator-os.theme',
  visualStyle: 'ly.creator-os.visual-style'
} as const

export const DEFAULT_APPEARANCE: AppearanceSnapshot = {
  theme: 'light',
  visualStyle: 'warm'
}

function isColorScheme(value: string | null): value is ColorScheme {
  return value === 'light' || value === 'dark'
}

function isVisualStyle(value: string | null): value is VisualStyle {
  return value === 'warm' || value === 'feishu'
}

export function normalizeAppearance(value: Partial<AppearanceSnapshot> | null | undefined): AppearanceSnapshot {
  return {
    theme: value?.theme === 'dark' ? 'dark' : 'light',
    visualStyle: value?.visualStyle === 'feishu' ? 'feishu' : 'warm'
  }
}

function defaultStorage(): AppearanceStorage | null {
  return (globalThis as typeof globalThis & { localStorage?: AppearanceStorage }).localStorage ?? null
}

function defaultRoot(): AppearanceRoot {
  const root = (globalThis as typeof globalThis & { document?: { documentElement: AppearanceRoot } }).document?.documentElement
  if (!root) throw new Error('Appearance root is unavailable')
  return root
}

export function readCachedAppearance(storage: Pick<AppearanceStorage, 'getItem'> | null = defaultStorage()): AppearanceSnapshot {
  if (!storage) return DEFAULT_APPEARANCE
  const theme = storage.getItem(APPEARANCE_STORAGE_KEYS.theme)
  const visualStyle = storage.getItem(APPEARANCE_STORAGE_KEYS.visualStyle)
  return {
    theme: isColorScheme(theme) ? theme : DEFAULT_APPEARANCE.theme,
    visualStyle: isVisualStyle(visualStyle) ? visualStyle : DEFAULT_APPEARANCE.visualStyle
  }
}

export function applyAppearance(
  value: Partial<AppearanceSnapshot>,
  root: AppearanceRoot = defaultRoot(),
  storage: Pick<AppearanceStorage, 'setItem'> | null = defaultStorage()
): AppearanceSnapshot {
  const appearance = normalizeAppearance(value)
  root.dataset.theme = appearance.theme
  root.dataset.visualStyle = appearance.visualStyle
  storage?.setItem(APPEARANCE_STORAGE_KEYS.theme, appearance.theme)
  storage?.setItem(APPEARANCE_STORAGE_KEYS.visualStyle, appearance.visualStyle)
  return appearance
}
