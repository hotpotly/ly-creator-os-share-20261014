import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { globalSearchResultSchema } from '../../src/shared/ipc'
import { restoreWorkspaceBackup } from '../../src/main/db/backup'
import { PersonalReviewRepository } from '../../src/main/db/personal-review-repository'
import { emptyReviewBody, reviewBodySchema, reviewDateSchema, reviewEntrySaveSchema, reviewRange, type ReviewEntrySave } from '../../src/shared/personal-review'
import { retainManagedFileFromBytes } from '../../src/main/managed-files'
let store: WorkspaceStore, directory: string, reviews: PersonalReviewRepository
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'review-')); store = await openWorkspaceStore(directory); reviews = new PersonalReviewRepository(store.repository)
}
afterEach(async () => { store?.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
const query = { kind: 'monthly', anchor: '2026-09-27' } as const
function entry(): ReviewEntrySave { return { id: randomUUID(), revision: 0, date: query.anchor, kind: 'experience', title: 'Final Cut人声经验', tags: ['剪辑'], body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '保留原声', marks: [{ type: 'highlight', attrs: { color: '#F3D9A3' } }, { type: 'textColor', attrs: { color: '#B44436' } }] }] }] }, sourceKind: query.kind, sourceAnchor: '2026-09-01', trashed: false } }
test('calendar ranges handle leap months, Monday and cross-year weeks; reject invalid dates', () => {
  expect(reviewRange({ kind: 'monthly', anchor: '2024-02-10' }).days).toHaveLength(29)
  expect(reviewRange({ kind: 'weekly', anchor: '2026-01-01' })).toMatchObject({ start: '2025-12-29', end: '2026-01-04' })
  for (const date of ['2026-02-30','2026-2-01','2200-01-01','bad']) expect(reviewDateSchema.safeParse(date).success).toBe(false)
})
test('independent goals, real work totals, missing vs zero and concurrent edit protection persist', async () => {
  await setup()
  const before = JSON.stringify(store.repository.listTodoItems())
  const month = reviews.get(query).period
  month.goals.push({ id: randomUUID(), title: '去爬山', category: '生活', target: 3, done: 1 })
  month.targetMinutes = 6000
  const saved = reviews.save(month)
  expect(store.repository.searchGlobal('爬山')[0]?.id).toBe('period:monthly:2026-09-01')
  expect(reviews.get({ kind: 'weekly', anchor: query.anchor }).period.goals).toEqual([])
  expect(() => reviews.save(month)).toThrow('其他窗口更新')
  expect(JSON.stringify(store.repository.listTodoItems())).toBe(before)
  store.repository.setDailyWorkLog(query.anchor, { selfMediaMinutes: 120, aiMinutes: 60, otherWorkMinutes: 0 })
  store.repository.setDailyWorkLogTotal(query.anchor, 240, store.repository.getDailyWorkLog(query.anchor))
  store.repository.setDailyWorkLogTotal('2026-09-26', 0, store.repository.getDailyWorkLog('2026-09-26'))
  expect(reviews.get(query).logs.filter(log => log.minutes !== null)).toEqual([{ day: '2026-09-26', minutes: 0 }, { day: '2026-09-27', minutes: 240 }])
  store.close(); store = await openWorkspaceStore(directory); reviews = new PersonalReviewRepository(store.repository)
  expect(reviews.get(query).period).toEqual(saved)
})
test('one entry serves period and global search; soft delete and restore, stale save cannot overwrite', async () => {
  await setup()
  const input = entry(), saved = reviews.saveEntry(input)
  expect(reviews.get(query).entries).toHaveLength(1)
  expect(reviews.get({ kind: 'weekly', anchor: query.anchor }).entries[0]?.id).toBe(saved.id)
  const result = store.repository.searchGlobal('保留原声')[0]
  expect(result).toMatchObject({ kind: 'review', id: saved.id })
  expect(globalSearchResultSchema.safeParse(result).success).toBe(true)
  expect(reviews.search('剪辑')[0]?.id).toBe(saved.id)
  expect(() => reviews.saveEntry(input)).toThrow('已更新')
  const deleted = reviews.saveEntry({ ...input, revision: saved.revision, trashed: true })
  expect(reviews.search('剪辑')).toHaveLength(0)
  expect(store.repository.searchGlobal('保留原声')).toHaveLength(0)
  reviews.saveEntry({ ...input, revision: deleted.revision })
  expect(reviews.entry(input.id).body).toEqual(input.body)
})
test('images remain referenced through startup, deletion and backup; foreign ownership is rejected', async () => {
  await setup()
  const saved = reviews.saveEntry(entry())
  const retained = await retainManagedFileFromBytes(directory, { managedDirectory: 'managed-files/reviews', sourceName: 'picture.png' }, Buffer.from('preserved original test bytes'))
  reviews.attach(saved.id, [retained.file])
  expect(() => reviews.file(randomUUID(), retained.file.id)).toThrow('不属于')
  const backup = await store.createBackup('review-test')
  expect(backup).toBeTruthy()
  const restoredPath = join(directory, 'restored')
  await restoreWorkspaceBackup(backup, restoredPath)
  const restored = await openWorkspaceStore(restoredPath)
  try {
    const recovered = new PersonalReviewRepository(restored.repository).entry(saved.id)
    expect(recovered.body).toEqual(saved.body)
    expect(recovered.attachments).toHaveLength(1)
    expect(await readFile(join(restoredPath, retained.file.relativePath), 'utf8')).toBe('preserved original test bytes')
  } finally { restored.close() }
  store.close(); store = await openWorkspaceStore(directory); reviews = new PersonalReviewRepository(store.repository)
  expect(reviews.entry(saved.id).attachments).toHaveLength(1)
  expect(reviews.file(saved.id, retained.file.id).sha256).toBe(retained.file.sha256)
  reviews.detach(saved.id, retained.file.id)
  expect(reviews.entry(saved.id).attachments).toHaveLength(0)
})
test('strict rich text and entry validation rejects active content, paths, extreme nesting and invalid source dates', async () => {
  expect(reviewBodySchema.safeParse(entry().body).success).toBe(true)
  for (const body of [{ type: 'doc', content: [{ type: 'image', attrs: { src: 'file:///tmp/private' } }] }, { type: 'doc', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }, { type: 'doc', attrs: { onclick: 'alert(1)' } }]) expect(reviewBodySchema.safeParse(body).success).toBe(false)
  let deep = emptyReviewBody(); for (let i = 0; i < 25; i++) deep = { type: 'doc', content: [deep] }
  expect(reviewBodySchema.safeParse(deep).success).toBe(false)
  expect(reviewEntrySaveSchema.safeParse({ ...entry(), filePath: '/tmp/private' }).success).toBe(false)
  await setup(); expect(() => reviews.saveEntry({ ...entry(), date: '2026-10-01' })).toThrow('来源周期')
})
test('canvas presentation survives old records, saves and reload; image batch failure rolls back entry', async () => {
  await setup()
  const old = reviews.saveEntry(entry())
  expect(old.displayWidth).toBeUndefined()
  const input = { ...entry(), displayWidth: 55, sortOrder: 1024 }
  const retained = await retainManagedFileFromBytes(directory, { managedDirectory: 'managed-files/reviews', sourceName: 'canvas.png' }, Buffer.from('canvas original'))
  expect(() => reviews.saveEntryWithFiles(input, Array(21).fill(retained.file))).toThrow('20张')
  expect(() => reviews.entry(input.id)).toThrow('不存在')
  const saved = reviews.saveEntryWithFiles(input, [retained.file])
  expect(saved).toMatchObject({displayWidth:55,sortOrder:1024})
  expect(saved.attachments).toHaveLength(1)
  expect(() => reviews.saveEntryWithFiles(input, [])).toThrow('已更新')
  expect(reviews.get({kind:'weekly',anchor:input.date}).entries.find(e=>e.id===input.id)).toEqual(saved)
  for(const displayWidth of [0,24,101,NaN]) expect(reviewEntrySaveSchema.safeParse({...input,displayWidth}).success).toBe(false)
})
