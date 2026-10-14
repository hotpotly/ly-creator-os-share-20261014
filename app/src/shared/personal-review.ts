import { HIGHLIGHT_COLORS, TEXT_COLORS } from './rich-text-format'
import { z } from 'zod'
import { addTodoDateDays } from './todo-date'

export const REVIEW_CATEGORIES = ['工作', 'AI与学习', '生活', '运动与健康'] as const
export interface RichNode { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: RichNode[] }
export const emptyReviewBody = (): RichNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })
function validRich(value: unknown): value is RichNode {
  let count = 0
  function node(v: unknown, depth: number): boolean {
    if (++count > 20000 || depth > 16 || !v || typeof v !== 'object') return false
    const n = v as RichNode
    if (!['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'horizontalRule', 'codeBlock'].includes(n.type)) return false
    if (Object.keys(n).some(k => !['type', 'text', 'attrs', 'marks', 'content'].includes(k))) return false
    if (n.text !== undefined && (typeof n.text !== 'string' || n.text.length > 100000 || n.type !== 'text')) return false
    if (n.attrs && Object.entries(n.attrs).some(([k, v]) => !((k === 'level' && [1, 2, 3].includes(Number(v))) || (k === 'start' && Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 9999) || (k === 'language' && (v === null || typeof v === 'string' && v.length < 40)) || (k === 'type' && v === null)))) return false
    if (n.marks && (!Array.isArray(n.marks) || n.marks.length > 8 || n.marks.some(m => {
      if (!m || !['bold', 'italic', 'strike', 'underline', 'code', 'highlight', 'textColor'].includes(m.type)) return true
      return m.attrs ? Object.entries(m.attrs).some(([k, v]) => k !== 'color' || typeof v !== 'string' || !(m.type === 'highlight' ? HIGHLIGHT_COLORS : TEXT_COLORS).some(c => c === v.toUpperCase())) : false
    }))) return false
    return !n.content || Array.isArray(n.content) && n.content.every(c => node(c, depth + 1))
  }
  try { return JSON.stringify(value).length <= 500000 && node(value, 0) && (value as RichNode).type === 'doc' } catch { return false }
}
export const reviewBodySchema = z.custom<RichNode>(validRich, '文字格式无效或超过50万字符')
export function reviewPlainText(node: RichNode): string { return node.text ?? (node.content ?? []).map(reviewPlainText).join(node.type === 'paragraph' || node.type === 'heading' ? '' : '\n') }
export const reviewDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => value >= '1900-01-01' && value <= '2199-12-31' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '日期无效')
export const reviewQuerySchema = z.object({ kind: z.enum(['weekly', 'monthly']), anchor: reviewDateSchema }).strict()
export type ReviewQuery = z.infer<typeof reviewQuerySchema>
export function reviewRange(input: ReviewQuery): { id: string; start: string; end: string; days: string[] } {
  const { kind, anchor } = reviewQuerySchema.parse({ kind: input.kind, anchor: input.anchor })
  const date = new Date(`${anchor}T12:00:00Z`)
  const start = kind === 'monthly' ? `${anchor.slice(0, 7)}-01` : addTodoDateDays(anchor, -((date.getUTCDay() + 6) % 7))
  const end = kind === 'weekly' ? addTodoDateDays(start, 6) : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
  const days: string[] = []; for (let day = start; day <= end; day = addTodoDateDays(day, 1)) days.push(day)
  return { id: `${kind}:${start}`, start, end, days }
}
const id = z.string().uuid()
const goal = z.object({ id, title: z.string().trim().min(1).max(300), category: z.enum(REVIEW_CATEGORIES), target: z.number().int().min(1).max(999), done: z.number().int().min(0).max(999) }).strict().refine(g => g.done <= g.target, '完成次数不能超过目标')
export const reviewPeriodSchema = z.object({ kind: z.enum(['weekly', 'monthly']), anchor: reviewDateSchema, revision: z.number().int().nonnegative(), goals: z.array(goal).max(100).refine(gs => new Set(gs.map(g => g.id)).size === gs.length), body: reviewBodySchema, targetMinutes: z.number().int().min(0).max(44640).nullable(), updatedAt: z.string() }).strict()
export const reviewPeriodDraftSchema = reviewPeriodSchema.extend({ goals: z.array(goal.safeExtend({ title: z.string().max(300) })).max(100) })
export type ReviewPeriod = z.infer<typeof reviewPeriodSchema>
export const reviewAttachmentSchema = z.object({ id: z.string(), name: z.string() })
export const reviewEntrySchema = z.object({ id, revision: z.number().int().nonnegative(), date: reviewDateSchema, kind: z.enum(['life', 'checkin', 'experience']), title: z.string().trim().min(1).max(200), body: reviewBodySchema, tags: z.array(z.string().trim().min(1).max(40)).max(12), sourceKind: z.enum(['weekly', 'monthly']), sourceAnchor: reviewDateSchema, trashed: z.boolean(), displayWidth: z.number().min(25).max(100).optional(), sortOrder: z.number().finite().optional(), updatedAt: z.string(), attachments: z.array(reviewAttachmentSchema).max(20) }).strict()
export type ReviewEntry = z.infer<typeof reviewEntrySchema>
export const reviewEntrySaveSchema = reviewEntrySchema.omit({ attachments: true, updatedAt: true })
export type ReviewEntrySave = z.infer<typeof reviewEntrySaveSchema>
export const reviewDataSchema = z.object({ period: reviewPeriodSchema, entries: z.array(reviewEntrySchema), logs: z.array(z.object({ day: reviewDateSchema, minutes: z.number().nonnegative().nullable() })) })
export type ReviewData = z.infer<typeof reviewDataSchema>
export const reviewFileQuerySchema = z.object({ entryId: id, fileId: z.string().min(1).max(100) }).strict()
export const REVIEW_CHANNELS = { get: 'review:get', save: 'review:save', entrySave: 'review:entry-save', entryGet: 'review:entry-get', search: 'review:search', attach: 'review:attach', importImages: 'review:import-images', preview: 'review:preview', detach: 'review:detach' } as const
export interface PersonalReviewApi {
  getPersonalReview(query: ReviewQuery): Promise<ReviewData>
  savePersonalReview(period: ReviewPeriod): Promise<ReviewPeriod>
  saveReviewEntry(entry: ReviewEntrySave): Promise<ReviewEntry>
  getReviewEntry(id: string): Promise<ReviewEntry>
  searchReviewEntries(query: string): Promise<ReviewEntry[]>
  importReviewImages(entry: ReviewEntrySave, images: Array<{ name: string; bytes: Uint8Array }>): Promise<ReviewEntry>
  attachReviewImages(entryId: string): Promise<ReviewEntry>
  previewReviewImage(entryId: string, fileId: string): Promise<string>
  detachReviewImage(entryId: string, fileId: string): Promise<ReviewEntry>
}
