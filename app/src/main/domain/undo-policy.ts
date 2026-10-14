export const MAX_INVERSE_PAYLOAD_BYTES = 64 * 1024
export const DEFAULT_UNDO_TTL_MS = 24 * 60 * 60 * 1000

const SENSITIVE_KEY_PATTERN = /(api.?key|token|password|passphrase|secret|private.?key|file.?content|binary|bytes)/i
const SAFE_NON_CREDENTIAL_KEYS = new Set(['color_token'])
const CONTENT_BODY_KEY_PATTERN = /(^|_)(content|text|body|transcript|document|prompt)(_|$)/i
const CREDENTIAL_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\b(?:ghp|github_pat|glpat)-[A-Za-z0-9_-]{12,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|access[_-]?token|password|passphrase|secret)\s*[:=]\s*\S+/i
]
const MAX_INVERSE_STRING_BYTES = 16 * 1024

export interface SerializedUndoPayload {
  json: string | null
  bytes: number
  reason: 'safe' | 'too_large' | 'unsafe'
}

function containsUnsafeValue(value: unknown, seen: Set<object>): boolean {
  if (value === null || ['boolean', 'number'].includes(typeof value)) return false
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8') > MAX_INVERSE_STRING_BYTES
      || CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  }
  if (typeof value !== 'object') return true
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return true
  if (seen.has(value)) return true
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsUnsafeValue(item, seen))
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    return (!SAFE_NON_CREDENTIAL_KEYS.has(normalizedKey.toLowerCase()) && SENSITIVE_KEY_PATTERN.test(normalizedKey))
      || CONTENT_BODY_KEY_PATTERN.test(normalizedKey)
      || containsUnsafeValue(item, seen)
  })
}

export function serializeUndoPayload(payload: unknown): SerializedUndoPayload {
  if (containsUnsafeValue(payload, new Set())) return { json: null, bytes: 0, reason: 'unsafe' }
  let json: string
  try {
    json = JSON.stringify(payload)
  } catch {
    return { json: null, bytes: 0, reason: 'unsafe' }
  }
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > MAX_INVERSE_PAYLOAD_BYTES) return { json: null, bytes, reason: 'too_large' }
  return { json, bytes, reason: 'safe' }
}

export function undoExpiresAt(now: string, ttlMs = DEFAULT_UNDO_TTL_MS): string {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('撤销过期时间无效')
  return new Date(timestamp + ttlMs).toISOString()
}

export class UndoConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UndoConflictError'
  }
}
