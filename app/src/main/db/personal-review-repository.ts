import { recordedWorkMinutes } from '../../shared/daily-work-log'
import type { WorkspaceRepository } from './repository'
import type { FileReferenceInput } from '../../shared/domain'
import type { GlobalSearchDocument } from '../../shared/global-search'
import { buildGlobalSearchIndex, searchGlobalIndex } from '../../shared/global-search'
import { emptyReviewBody, reviewEntrySaveSchema, reviewEntrySchema, reviewPeriodSchema, reviewPlainText, reviewRange, type ReviewData, type ReviewEntry, type ReviewEntrySave, type ReviewPeriod, type ReviewQuery } from '../../shared/personal-review'
import { fileReferences } from './schema'

type Row = { payload: string; revision: number; updated_at: string }
export class PersonalReviewRepository {
  constructor(private readonly workspace: WorkspaceRepository) {}
  private get db() { return this.workspace.native }
  get(query: ReviewQuery): ReviewData {
    const range = reviewRange(query)
    const row = this.db.prepare('SELECT * FROM personal_review_periods WHERE id=?').get(range.id) as Row | undefined
    const period = row ? reviewPeriodSchema.parse(JSON.parse(row.payload)) : { ...query, anchor: range.start, revision: 0, goals: [], body: emptyReviewBody(), targetMinutes: null, updatedAt: '' }
    const entries = (this.db.prepare('SELECT id FROM personal_review_entries WHERE day BETWEEN ? AND ? ORDER BY day DESC, updated_at DESC').all(range.start, range.end) as { id: string }[]).map(row => this.entry(row.id))
    const logs = range.days.map(day => { const log = this.workspace.getDailyWorkLog(day); return { day, minutes: recordedWorkMinutes(log) } })
    return { period, entries, logs }
  }
  save(raw: ReviewPeriod): ReviewPeriod {
    const input = reviewPeriodSchema.parse(raw), range = reviewRange(input)
    if (input.targetMinutes !== null && input.targetMinutes > range.days.length * 1440) throw new Error('目标时长超过周期总时长')
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT revision FROM personal_review_periods WHERE id=?').get(range.id) as { revision: number } | undefined
      if ((current?.revision ?? 0) !== input.revision) throw new Error('复盘已在其他窗口更新。草稿已保留，请重新读取后合并。')
      const saved: ReviewPeriod = { ...input, anchor: range.start, revision: input.revision + 1, updatedAt: new Date().toISOString() }
      this.db.prepare('INSERT INTO personal_review_periods(id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at').run(range.id, JSON.stringify(saved), saved.revision, saved.updatedAt)
      return saved
    })()
  }
  entry(id: string): ReviewEntry {
    const row = this.db.prepare('SELECT * FROM personal_review_entries WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('记录不存在')
    const attachments = this.db.prepare('SELECT f.id, f.original_name AS name FROM personal_review_files r JOIN file_references f ON f.id=r.file_id WHERE r.entry_id=? ORDER BY f.created_at,f.id').all(id)
    return reviewEntrySchema.parse({ ...JSON.parse(row.payload), attachments })
  }
  saveEntry(raw: ReviewEntrySave): ReviewEntry {
    const input = reviewEntrySaveSchema.parse(raw)
    const range = reviewRange({ kind: input.sourceKind, anchor: input.sourceAnchor })
    if (input.date < range.start || input.date > range.end) throw new Error('记录日期必须位于来源周期内')
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM personal_review_entries WHERE id=?').get(input.id) as Row | undefined
      if ((row?.revision ?? 0) !== input.revision) throw new Error('这条记录已更新。草稿已保留，请重新读取后合并。')
      const saved = { ...input, sourceAnchor: range.start, revision: input.revision + 1, tags: [...new Set(input.tags)], updatedAt: new Date().toISOString() }
      this.db.prepare('INSERT INTO personal_review_entries(id,day,kind,payload,revision,trashed,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,kind=excluded.kind,payload=excluded.payload,revision=excluded.revision,trashed=excluded.trashed,updated_at=excluded.updated_at').run(saved.id, saved.date, saved.kind, JSON.stringify(saved), saved.revision, Number(saved.trashed), saved.updatedAt)
      return this.entry(saved.id)
    })()
  }
  saveEntryWithFiles(entry: ReviewEntrySave, files: FileReferenceInput[]): ReviewEntry {
    return this.db.transaction(() => { this.saveEntry(entry); return this.attach(entry.id, files) })()
  }
  attach(id: string, files: FileReferenceInput[]): ReviewEntry {
    return this.db.transaction(() => {
      const entry = this.entry(id)
      if (entry.trashed) throw new Error('请先恢复这条记录')
      if (entry.attachments.length + files.length > 20) throw new Error('每条记录最多20张图片')
      for (const file of files) {
        this.workspace.orm.insert(fileReferences).values({ ...file, updatedAt: file.updatedAt ?? file.createdAt }).run()
        this.db.prepare('INSERT INTO personal_review_files(entry_id,file_id) VALUES(?,?)').run(id, file.id)
      }
      return this.entry(id)
    })()
  }
  detach(entryId: string, fileId: string): ReviewEntry {
    this.file(entryId, fileId)
    this.db.prepare('DELETE FROM personal_review_files WHERE entry_id=? AND file_id=?').run(entryId, fileId)
    // The existing orphan sweeper reclaims unlinked managed files at the next startup.
    return this.entry(entryId)
  }
  file(entryId: string, fileId: string): FileReferenceInput {
    if (!this.db.prepare('SELECT 1 FROM personal_review_files WHERE entry_id=? AND file_id=?').get(entryId, fileId)) throw new Error('图片不属于这条记录')
    const file = this.workspace.getFileReference(fileId)
    if (!file) throw new Error('图片文件不存在')
    return file
  }
  searchDocuments(): GlobalSearchDocument[] {
    const entries: GlobalSearchDocument[] = (this.db.prepare('SELECT id FROM personal_review_entries WHERE trashed=0 ORDER BY updated_at DESC').all() as { id: string }[]).map(row => {
      const entry = this.entry(row.id)
      return { kind: 'review', id: entry.id, title: entry.title, subtitle: `${entry.date} · ${entry.kind === 'experience' ? '经验' : entry.kind === 'life' ? '生活' : '打卡'} · ${entry.tags.join(' / ')}`.slice(0, 500), searchableText: `${entry.tags.join(' ')}\n${reviewPlainText(entry.body)}`, updatedAt: entry.updatedAt, projectId: null }
    })
    const periods: GlobalSearchDocument[] = (this.db.prepare('SELECT payload FROM personal_review_periods ORDER BY updated_at DESC').all() as { payload: string }[]).map(row => {
      const period = reviewPeriodSchema.parse(JSON.parse(row.payload)), range = reviewRange(period)
      return { kind: 'review', id: `period:${range.id}`, title: `${range.start} · ${period.kind === 'monthly' ? '月复盘' : '周复盘'}`, subtitle: '个人目标与自由复盘', searchableText: [reviewPlainText(period.body), ...period.goals.map(goal => `${goal.category}：${goal.title}`)].join('\n'), updatedAt: period.updatedAt, projectId: null }
    })
    return [...entries, ...periods]
  }
  search(query: string): ReviewEntry[] {
    const docs = this.searchDocuments().filter(doc => !doc.id.startsWith('period:') && this.entry(doc.id).kind === 'experience')
    return (query.trim() ? searchGlobalIndex(buildGlobalSearchIndex(docs), query, 100).map(doc => doc.id) : docs.slice(0, 100).map(doc => doc.id)).map(id => this.entry(id))
  }
}
