// Stable IDs, never display names or list positions: renaming/reordering keeps recognition.
const appearances = {
  'type-digital': { tone: 'digital' },
  'type-commercial': { tone: 'commercial' },
  'type-system': { tone: 'system' },
  'type-ai': { tone: 'ai' },
  'type-quick': { tone: 'quick' },
  'type-unboxing': { tone: 'quick' }
} as const
const fallback = { tone: 'custom' } as const
export function contentTypeAppearance(id: string) {
  return Object.hasOwn(appearances, id) ? appearances[id as keyof typeof appearances] : fallback
}
