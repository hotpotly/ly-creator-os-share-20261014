import { resizeScheduleRange } from '../../src/shared/schedule-range'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { businessTripSaveSchema, businessTripsForDate, tripDate, type BusinessTripSaveInput } from '../../src/shared/business-trip'
import { RESPONSE_SCHEMAS, scheduleCreatePayloadSchema } from '../../src/shared/ipc'

const roots: string[] = [], stores: WorkspaceStore[] = []
async function createStore() {
  vi.stubEnv('CREATOR_OS_TEST_DATE', '2026-09-19')
  vi.stubEnv('CREATOR_OS_TEST_STAGE_DATETIME', '2026-09-19T10:00:00')
  const root = join(import.meta.dirname, '../../test-results/unit')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'business-trip-')); roots.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store)
  return store.repository
}
const draft = (patch: Partial<BusinessTripSaveInput> = {}): BusinessTripSaveInput => ({ scheduleId: null, expectedUpdatedAt: null, action: 'save', title: '上海出差', projectId: null, startDate: '2026-09-18', endDate: '2026-09-22', notes: '发布会', ...patch })
afterEach(async () => { stores.splice(0).forEach(store => store.close()); await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); vi.unstubAllEnvs() })

describe('R21w business trip schedule', () => {
  it('migrates old schedules without inference, replacement or date changes', () => {
    const db = new BetterSqlite3(':memory:')
    runMigrationsThrough(db, '0092_r21s_todo_stage_choice_source')
    db.prepare(`INSERT INTO schedule_items (id,project_id,title,action_type,start_at,end_at,schedule_kind,state,source,is_movable,created_at,updated_at) VALUES ('old',NULL,'出差','overview','2026-09-19T12:00:00',NULL,'plan','normal','user',1,'old','old')`).run()
    const old = db.prepare('SELECT * FROM schedule_items').get() as object
    runMigrations(db); runMigrations(db)
    expect(db.prepare('SELECT * FROM schedule_items').get()).toEqual({ ...old, trip_json: null, group_id: null })
    db.close()
  })
  it('retains trips and edits after reopening the database', async () => {
    const repo = await createStore(), trip = repo.saveBusinessTrip(draft())
    stores.pop()!.close()
    const reopened = await openWorkspaceStore(roots.at(-1)!)
    stores.push(reopened)
    expect(reopened.repository.listScheduleItems().find(row => row.id === trip.id)).toEqual(trip)
  })
  it('validates complete ranges, real dates, strict fields and lifecycle versions', () => {
    for (const patch of [{ startDate: '2026-02-30' }, { endDate: '2026-09-01' }, { title: ' ' }, { action: 'cancel' as const }, { scheduleId: 'missing' }]) expect(businessTripSaveSchema.safeParse(draft(patch)).success).toBe(false)
    expect(businessTripSaveSchema.safeParse({ ...draft(), state: 'done' }).success).toBe(false)
    expect(scheduleCreatePayloadSchema.safeParse({ projectId: null, title: '普通', actionType: 'overview', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null, trip: { notes: '', cancelled: false, endedEarly: false } }).success).toBe(false)
  })
  it('persists one schedule, roundtrips metadata, and changes no todos, stage facts or work logs', async () => {
    const repo = await createStore(), before = repo.listTodoItems(), stages = repo.getProject('ios', false).stageTimeRecords, log = repo.getDailyWorkLog('2026-09-19')
    const review = repo.getProjectCreationReview('ios')
    const item = repo.saveBusinessTrip(draft({ projectId: 'ios' }))
    expect(item).toMatchObject({ actionType: 'overview', scheduleKind: 'plan', trip: { notes: '发布会', cancelled: false, endedEarly: false } })
    expect(RESPONSE_SCHEMAS.scheduleItemSchema.parse(item)).toEqual(item)
    expect(repo.listScheduleItems().filter(row => row.id === item.id)).toEqual([item])
    expect(repo.listTodoItems()).toEqual(before)
    expect(repo.getProject('ios', false).stageTimeRecords).toEqual(stages)
    expect(repo.getDailyWorkLog('2026-09-19')).toEqual(log)
    expect({ ...repo.getProjectCreationReview('ios'), calculatedAt: '' }).toEqual({ ...review, calculatedAt: '' })
  })
  it('projects inclusive single-day, cross-month, overlap and past/future labels', async () => {
    const repo = await createStore()
    const trip = repo.saveBusinessTrip(draft({ startDate: '2026-09-30', endDate: '2026-10-02' }))
    const single = repo.saveBusinessTrip(draft({ startDate: '2026-10-01', endDate: '2026-10-01' }))
    expect(businessTripsForDate([trip], '2026-09-29', '2026-10-01')).toEqual([])
    expect(businessTripsForDate([trip], '2026-10-03', '2026-10-01')).toEqual([])
    expect(businessTripsForDate([trip], '2026-09-30', '2026-10-01')[0]).toMatchObject({ label: '出差记录', progress: '第1天／共3天' })
    expect(businessTripsForDate([trip, single], '2026-10-01', '2026-10-01').map(entry => entry.label)).toEqual(['出差中', '出差中'])
    expect(businessTripsForDate([trip], '2026-10-02', '2026-10-01')[0]).toMatchObject({ label: '出差安排', progress: '第3天／共3天' })
    expect(businessTripsForDate([{ ...trip, trip: null }], '2026-10-01', '2026-10-01')).toEqual([])
  })
  it('uses optimistic edits and rejects converting arbitrary schedules or invalid projects', async () => {
    const repo = await createStore(), trip = repo.saveBusinessTrip(draft())
    const edited = repo.saveBusinessTrip(draft({ scheduleId: trip.id, expectedUpdatedAt: trip.updatedAt, title: '杭州出差' }))
    expect(edited.title).toBe('杭州出差')
    expect(() => repo.saveBusinessTrip(draft({ scheduleId: trip.id, expectedUpdatedAt: trip.updatedAt }))).toThrow('其他窗口')
    const before = repo.listScheduleItems()
    expect(() => repo.saveBusinessTrip(draft({ projectId: 'missing' }))).toThrow()
    expect(repo.listScheduleItems()).toEqual(before)
    const ordinary = before.find(row => !row.trip)!
    expect(() => repo.saveBusinessTrip(draft({ scheduleId: ordinary.id, expectedUpdatedAt: ordinary.updatedAt }))).toThrow()
    expect(() => repo.updateScheduleItem(edited.id, { actionType: 'script' })).toThrow('不关联项目阶段')
    expect(repo.setScheduleState(edited.id, 'done').state).toBe('done')
    expect(repo.listScheduleItems().find(item => item.id === edited.id)?.trip).toEqual(edited.trip)
    expect(repo.setScheduleState(edited.id, 'normal').state).toBe('normal')
    expect(() => repo.moveScheduleItem(edited.id, null, null)).toThrow('完整')
  })
  it('moves one underlying schedule and synchronizes date projections', async () => {
    const repo = await createStore(), item = repo.saveBusinessTrip(draft())
    const moved = repo.moveScheduleItem(item.id, '2026-10-01T12:00:00+08:00', '2026-10-03T12:00:00+08:00')
    const shrunk = resizeScheduleRange(moved, 'end', -10)
    expect(shrunk.endAt).toBe(shrunk.startAt)
    expect(() => repo.moveScheduleItem(moved.id, shrunk.startAt, shrunk.endAt)).not.toThrow()
    expect(moved.trip).toEqual(item.trip)
    expect(() => repo.saveBusinessTrip(draft({ scheduleId: item.id, expectedUpdatedAt: item.updatedAt }))).toThrow('其他窗口')
    expect(businessTripsForDate([moved], '2026-09-19', '2026-09-19')).toEqual([])
    expect(businessTripsForDate([moved], tripDate(moved.startAt)!, '2026-09-19')).toHaveLength(1)
  })
  it('cancels without deleting history and ends early without erasing previous days', async () => {
    const repo = await createStore(), trip = repo.saveBusinessTrip(draft())
    const ended = repo.saveBusinessTrip(draft({ scheduleId: trip.id, expectedUpdatedAt: trip.updatedAt, action: 'end_early' }))
    expect(tripDate(ended.endAt)).toBe('2026-09-19')
    expect(businessTripsForDate([ended], '2026-09-20', '2026-09-19')).toEqual([])
    expect(businessTripsForDate([ended], '2026-09-18', '2026-09-19')[0]?.label).toBe('出差记录')
    expect(businessTripsForDate([ended], '2026-09-19', '2026-09-19')[0]?.label).toBe('出差已结束')
    expect(businessTripsForDate([ended], '2026-09-19', '2026-09-20')[0]?.label).toBe('出差记录')
    expect(() => repo.moveScheduleItem(ended.id, trip.startAt, trip.endAt)).toThrow('不能改期')
    const cancelled = repo.saveBusinessTrip(draft({ scheduleId: ended.id, expectedUpdatedAt: ended.updatedAt, action: 'cancel' }))
    expect(businessTripsForDate([cancelled], '2026-09-18', '2026-09-19')).toEqual([])
    expect(repo.listScheduleItems().find(row => row.id === trip.id)?.trip?.cancelled).toBe(true)
    const future = repo.saveBusinessTrip(draft({ startDate: '2026-10-01', endDate: '2026-10-03' }))
    expect(() => repo.saveBusinessTrip(draft({ scheduleId: future.id, expectedUpdatedAt: future.updatedAt, action: 'end_early' }))).toThrow('正在进行')
  })
})

it('home kind persists, older callers preserve it, and lifecycle has no todo side effects', async () => {
 const repo = await createStore(), before = repo.listTodoItems()
 const home = repo.saveBusinessTrip(draft({ kind: 'home', title: '回老家' }))
 expect(home.trip?.kind).toBe('home')
 expect(businessTripsForDate([home], '2026-09-19', '2026-09-19')[0]?.label).toBe('在老家')
 const edited = repo.saveBusinessTrip(draft({ scheduleId: home.id, expectedUpdatedAt: home.updatedAt, title: '回老家探亲' }))
 expect(edited.trip?.kind).toBe('home')
 const ended = repo.saveBusinessTrip(draft({ scheduleId: edited.id, expectedUpdatedAt: edited.updatedAt, action: 'end_early' }))
 expect(ended.trip?.kind).toBe('home')
 expect(businessTripsForDate([ended], '2026-09-20', '2026-09-19')).toEqual([])
 expect(businessTripsForDate([ended], '2026-09-19', '2026-09-19')[0]?.label).toBe('回家已结束')
 const cancelled = repo.saveBusinessTrip(draft({ scheduleId: ended.id, expectedUpdatedAt: ended.updatedAt, action: 'cancel' }))
 expect(businessTripsForDate([cancelled], '2026-09-18', '2026-09-19')).toEqual([])
 expect(repo.listTodoItems()).toEqual(before)
 expect(businessTripSaveSchema.safeParse(draft({ kind: 'invalid' as 'home' })).success).toBe(false)
})

it('rest persists through reopen, legacy edits and lifecycle without inventing work or changing todos', async () => {
 const repo = await createStore(), before = repo.listTodoItems(), hours = repo.getDailyWorkLog('2026-09-19')
 const rest = repo.saveBusinessTrip(draft({ kind: 'rest', title: '休息', notes: '' }))
 expect(rest.trip?.kind).toBe('rest')
 expect(businessTripsForDate([rest], '2026-09-19', '2026-09-19')[0]?.label).toBe('休息中')
 expect(businessTripsForDate([rest], '2026-09-18', '2026-09-19')[0]?.label).toBe('休息记录')
 expect(businessTripsForDate([rest], '2026-09-20', '2026-09-19')[0]?.label).toBe('休息安排')
 expect(repo.getDailyWorkLog('2026-09-19')).toEqual(hours)
 expect(repo.listTodoItems()).toEqual(before)
 stores.pop()!.close()
 const reopened = await openWorkspaceStore(roots.at(-1)!); stores.push(reopened)
 const saved = reopened.repository.listScheduleItems().find(item => item.id === rest.id)!
 expect(saved.trip?.kind).toBe('rest')
 const edited = reopened.repository.saveBusinessTrip(draft({ scheduleId: saved.id, expectedUpdatedAt: saved.updatedAt, title: '周末休息' }))
 expect(edited.trip?.kind).toBe('rest')
 const ended = reopened.repository.saveBusinessTrip(draft({ scheduleId: edited.id, expectedUpdatedAt: edited.updatedAt, action: 'end_early' }))
 expect(ended.trip?.kind).toBe('rest')
 expect(businessTripsForDate([ended], '2026-09-20', '2026-09-19')).toEqual([])
 const cancelled = reopened.repository.saveBusinessTrip(draft({ scheduleId: ended.id, expectedUpdatedAt: ended.updatedAt, action: 'cancel' }))
 expect(businessTripsForDate([cancelled], '2026-09-19', '2026-09-19')).toEqual([])
 expect(reopened.repository.getDailyWorkLog('2026-09-19')).toEqual(hours)
 expect(reopened.repository.listTodoItems()).toEqual(before)
})
