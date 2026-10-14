import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { seedWorkspace } from '../../src/main/db/seed'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'
import type { CreateScheduleInput } from '../../src/shared/domain'
const roots: string[] = [], stores: WorkspaceStore[] = []
async function setup(): Promise<WorkspaceStore> {
  const parent = join(import.meta.dirname, '../../test-results/unit'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'plan-baseline-')); roots.push(root)
  const store = await openWorkspaceStore(root); stores.push(store)
  store.repository.native.exec('DELETE FROM schedule_items; DELETE FROM stage_plan_baselines;')
  process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-21T15:00:00'
  process.env.CREATOR_OS_TEST_TIME_ZONE = 'Asia/Shanghai'
  return store
}
const plan = (patch: Partial<CreateScheduleInput> = {}): CreateScheduleInput => ({ projectId: 'ios', title: '剪辑计划', actionType: 'editing', startAt: '2026-09-10T09:00:00+08:00', endAt: '2026-09-12T17:00:00+08:00', scheduleKind: 'plan', waitingFor: null, ...patch })
afterEach(async () => { for (const s of stores.splice(0)) s.close(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); delete process.env.CREATOR_OS_TEST_STAGE_DATETIME; delete process.env.CREATOR_OS_TEST_TIME_ZONE })

describe('stage original plans', () => {
  it('preserves original windows across repeated moves, deletion, replacement and restart', async () => {
    const store = await setup(), r = store.repository
    const item = r.createScheduleItem(plan())
    r.updateStageTime('ios', 'editing', { startedAt: { localDate: '2026-09-11', segment: 'morning' }, completedAt: { localDate: '2026-09-13', segment: 'afternoon' }, source: 'backfill' })
    const original = r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!
    expect(original.baseline).toMatchObject({ source: 'first_saved', plannedStartAt: { localDate: '2026-09-10' }, startVarianceSegments: 3, varianceSegments: 3 })
    r.moveScheduleItem(item.id, '2026-09-11T09:00:00+08:00', '2026-09-13T17:00:00+08:00')
    let stage = r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!
    expect(stage).toMatchObject({ startVarianceSegments: 0, varianceSegments: 0, baseline: original.baseline })
    r.moveScheduleItem(item.id, '2026-09-12T09:00:00+08:00', '2026-09-14T17:00:00+08:00')
    r.deleteScheduleItem(item.id)
    stage = r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!
    expect(stage).toMatchObject({ plannedStartAt: null, varianceState: 'no_schedule', baseline: original.baseline })
    r.createScheduleItem(plan({ startAt: '2026-09-20T09:00:00+08:00', endAt: '2026-09-21T17:00:00+08:00' }))
    const reopened = await openWorkspaceStore(roots[0]!); stores.push(reopened)
    expect(reopened.repository.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!.baseline).toEqual(original.baseline)
    expect(RESPONSE_SCHEMAS.projectCreationReviewSchema.safeParse(r.getProjectCreationReview('ios')).success).toBe(true)
  })
  it('does not freeze undated actions, free schedules, trips or overview, nor infer a start from a deadline', async () => {
    const { repository: r } = await setup()
    const action = r.createScheduleItem(plan({ startAt: null, endAt: null }))
    r.createScheduleItem(plan({ projectId: null, actionType: 'overview' }))
    const trip = r.createScheduleItem(plan({ actionType: 'overview' }))
    r.native.prepare("UPDATE schedule_items SET trip_json='{}',action_type='shooting' WHERE id=?").run(trip.id)
    expect(r.native.prepare('SELECT count(*) n FROM stage_plan_baselines').get()).toEqual({ n: 0 })
    r.moveScheduleItem(action.id, '2026-09-12T17:00:00+08:00', null)
    r.updateStageTime('ios', 'editing', { startedAt: { localDate: '2026-09-11', segment: 'morning' }, completedAt: { localDate: '2026-09-13', segment: 'afternoon' }, source: 'backfill' })
    const stage = r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!
    expect(stage.startVarianceSegments).toBeNull()
    expect(stage.baseline).toMatchObject({ startVarianceSegments: null, varianceSegments: 3 })
  })
  it('captures a full first batch and rolls back both evidence and schedules on undo or failure', async () => {
    const { repository: r } = await setup()
    r.createScheduleItems([plan(), plan({ startAt: '2026-09-14T09:00:00+08:00', endAt: '2026-09-15T17:00:00+08:00' })])
    expect(r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!.baseline?.plannedEndAt?.localDate).toBe('2026-09-15')
    r.undoWorkspaceOperation()
    expect(r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!.baseline).toBeNull()
    expect(() => r.createScheduleItems([plan(), plan({ endAt: '2026-09-09T09:00:00+08:00' })])).toThrow()
    expect(r.native.prepare('SELECT count(*) n FROM stage_plan_baselines').get()).toEqual({ n: 0 })
  })
  it('does not discard original evidence when undoing later additions and refuses destructive first-plan undo', async () => {
    const { repository: r } = await setup()
    r.createScheduleItems([plan()])
    const original = r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!.baseline
    r.createScheduleItem(plan({ title: '后续计划' }))
    expect(() => r.undoWorkspaceOperation()).toThrow('阶段已有后续排期')
    expect(r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!.baseline).toEqual(original)
    r.createScheduleItems([plan({ title: '另一次添加' })]); r.undoWorkspaceOperation()
    expect(r.getProjectCreationReview('ios').stages.find(s => s.stageKey === 'editing')!.baseline).toEqual(original)
  })
  it('preserves each stage independently after retargeting a schedule', async () => {
    const { repository: r } = await setup()
    const item = r.createScheduleItem(plan())
    r.updateScheduleItem(item.id, { actionType: 'shooting' })
    const stages = r.getProjectCreationReview('ios').stages
    expect(stages.find(s => s.stageKey === 'editing')!.baseline).not.toBeNull()
    expect(stages.find(s => s.stageKey === 'shooting')!.baseline).not.toBeNull()
    expect(stages.find(s => s.stageKey === 'editing')!.plannedStartAt).toBeNull()
  })
  it('marks migration snapshots as adopted plans without changing dates, effort or schedule rows', () => {
    const db = new BetterSqlite3(':memory:'); db.pragma('foreign_keys=ON')
    try {
      runMigrationsThrough(db, '0093_r21w_business_trip'); seedWorkspace(db, true, true)
      const before = db.prepare('SELECT * FROM schedule_items ORDER BY id').all()
      const stageBefore = db.prepare('SELECT * FROM stage_time_records ORDER BY id').all()
      runMigrations(db)
      const rows = db.prepare('SELECT * FROM stage_plan_baselines').all() as Array<{ source: string; schedules_json: string }>
      expect(rows.length).toBeGreaterThan(0); expect(rows.every(r => r.source === 'legacy')).toBe(true)
      expect(rows.every(r => JSON.parse(r.schedules_json).length > 0)).toBe(true)
      expect(db.prepare('SELECT * FROM schedule_items ORDER BY id').all()).toEqual(before.map(row => ({ ...(row as object), group_id: null })))
      expect(db.prepare('SELECT * FROM stage_time_records ORDER BY id').all()).toEqual(stageBefore)
      runMigrations(db); expect(db.prepare('SELECT * FROM stage_plan_baselines').all()).toEqual(rows)
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
})
