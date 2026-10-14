import type { z } from 'zod'
export function readReviewDraft<T>(key: string, schema: z.ZodType<T>): T | null {
  try { const raw = localStorage.getItem(key); return raw ? schema.parse(JSON.parse(raw)) : null } catch { return null }
}
export function writeReviewDraft(key: string, value: unknown): void {
  // Local recovery is additional protection; the explicit SQLite save is the authoritative record.
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* The editor remains dirty and can still save to SQLite. */ }
}
export function clearReviewDraft(key: string): void { try { localStorage.removeItem(key) } catch { /* Storage may be unavailable. */ } }
