import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectStageTimeUpdatePayloadSchema } from '../../src/shared/ipc'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-stage-time-')); roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => {
  delete process.env.CREATOR_OS_TEST_STAGE_DATETIME
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('project stage time records', () => {
  it('manually starts independent stages, preserves existing starts and supports undo', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-13T10:00:00'
    const todosBefore = store.repository.native.prepare('SELECT * FROM todo_items ORDER BY id').all()
    const first = store.repository.updateStageTime('ios', 'shooting', { startNow: true, source: 'manual' })
    const second = store.repository.updateStageTime('ios', 'editing', { startNow: true, source: 'manual' })
    expect(first.record).toMatchObject({ status: 'in_progress', startedAt: { localDate: '2026-09-13', segment: 'morning' }, startSource: 'manual', completedAt: null, actualEffortHalfDayUnits: null })
    expect(second.record.status).toBe('in_progress')
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-14T15:00:00'
    const repeated = store.repository.updateStageTime('ios', 'shooting', { startNow: true, source: 'manual' })
    expect(repeated).toMatchObject({ changed: false, eventId: null, record: { startedAt: first.record.startedAt } })
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM stage_time_events WHERE record_id=?').get(first.record.id)).toEqual({ count: 1 })
    expect(store.repository.native.prepare('SELECT * FROM todo_items ORDER BY id').all()).toEqual(todosBefore)
    if (!second.changed) throw new Error('expected start')
    store.repository.undoStageTimeEvent('ios', second.eventId)
    const project = store.repository.getProject('ios', false)
    expect(project.stageTimeRecords.find(record => record.stageKey === 'editing')?.status).toBe('not_started')
    expect(project.stageTimeRecords.find(record => record.stageKey === 'shooting')?.startedAt).toEqual(first.record.startedAt)
    store.close()
  })

  it('does not restart completed, skipped, or automatically started stages', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-13T10:00:00'
    store.repository.setModuleCompleted('ios', 'shooting', true)
    store.repository.setStageTimeStatus('ios', 'editing', 'skip')
    store.repository.createProjectTextMaterial({ projectId: 'ios', role: 'project_material', title: '真实记录', textContent: '保留自动开始时间' })
    const before = store.repository.getProject('ios', false).stageTimeRecords
    for (const stage of ['shooting', 'editing', 'materials'] as const) {
      const result = store.repository.updateStageTime('ios', stage, { startNow: true, source: 'manual' })
      expect(result.changed).toBe(false)
      expect(result.record).toEqual(before.find(record => record.stageKey === stage))
    }
    store.close()
  })

  it('validates start-now intent without permitting mixed edits', () => {
    const input = { projectId: 'ios', stageKey: 'shooting', startNow: true, source: 'manual', requestId: '12345678-1234-4234-8234-123456789004' }
    expect(projectStageTimeUpdatePayloadSchema.safeParse(input).success).toBe(true)
    expect(projectStageTimeUpdatePayloadSchema.safeParse({ ...input, completedAt: null }).success).toBe(false)
    expect(projectStageTimeUpdatePayloadSchema.safeParse({ ...input, source: 'backfill' }).success).toBe(false)
  })

  it('auto-starts only once from a real module action and keeps actual effort manual', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-20T10:00:00'
    const material = store.repository.createProjectTextMaterial({ projectId: 'ios', role: 'project_material', title: '首次资料', textContent: '实际体验内容' })
    const started = store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'materials')!
    expect(started).toMatchObject({ status: 'in_progress', startedAt: { localDate: '2026-07-20', segment: 'morning' }, startSource: 'automatic', autoStartActionId: material.id, actualEffortHalfDayUnits: null })

    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-22T19:00:00'
    store.repository.createProjectTextMaterial({ projectId: 'ios', role: 'project_material', title: '第二份资料', textContent: '不会覆盖开始时间' })
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'materials')?.startedAt).toEqual({ localDate: '2026-07-20', segment: 'morning' })

    const updated = store.repository.updateStageTime('ios', 'materials', {
      startedAt: { localDate: '2026-07-18', segment: 'afternoon' }, completedAt: { localDate: '2026-07-20', segment: 'evening' }, actualEffortHalfDayUnits: 3, source: 'backfill'
    })
    expect(updated.record).toMatchObject({ status: 'completed', durationSegments: 7, durationLabel: '约2.5天', actualEffortHalfDayUnits: 3 })
    expect(() => store.repository.updateStageTime('ios', 'materials', { startedAt: { localDate: '2026-07-21', segment: 'morning' }, source: 'backfill' })).toThrow('完成时间不能早于开始时间')
    expect(() => store.repository.updateStageTime('ios', 'materials', { actualEffortHalfDayUnits: 0, source: 'manual' })).toThrow('实际投入必须是0.5天的倍数')
    store.close()
  })

  it('records completion, skip, reopen and undo as restorable snapshots', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-21T15:30:00'
    const completed = store.repository.setModuleCompleted('ios', 'outline', true)
    expect(completed.record).toMatchObject({ status: 'completed', completedAt: { localDate: '2026-07-21', segment: 'afternoon' }, durationLabel: null })
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM stage_time_events WHERE record_id=?').get(completed.record.id)).toMatchObject({ count: 1 })

    const undone = store.repository.undoStageTimeEvent('ios', completed.eventId)
    expect(undone.record).toMatchObject({ status: 'not_started', completedAt: null })
    expect(undone.project.modules.find((module) => module.key === 'outline')?.completedAt).toBeNull()
    expect(() => store.repository.undoStageTimeEvent('ios', completed.eventId)).toThrow('已无法撤销')

    const skipped = store.repository.setStageTimeStatus('ios', 'outline', 'skip')
    expect(skipped.record.status).toBe('skipped')
    expect(store.repository.updateStageTime('ios', 'outline', { startedAt: null, completedAt: null, actualEffortHalfDayUnits: 1, source: 'manual' }).record).toMatchObject({ status: 'skipped', actualEffortHalfDayUnits: 1 })
    const reopened = store.repository.setStageTimeStatus('ios', 'outline', 'reopen')
    expect(reopened.record.status).toBe('not_started')
    store.close()
  })

  it('assigns automatic actions before 04:00 to the previous evening', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-21T02:30:00'
    store.repository.saveOutline('ios', [{ id: 'one', text: '凌晨补记的大纲' }])
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'outline')?.startedAt).toEqual({ localDate: '2026-07-20', segment: 'evening' })
    store.close()
  })

  it('keeps time edits idempotent and records same-value edits as audit-only without a stage event', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-24T14:00:00+08:00'
    const requestId = '12345678-1234-4234-8234-123456789001'
    const first = store.repository.updateStageTime('ios', 'outline', {
      startedAt: { localDate: '2026-07-24', segment: 'morning' },
      source: 'backfill'
    }, requestId)
    const replay = store.repository.updateStageTime('ios', 'outline', {
      startedAt: { localDate: '2026-07-24', segment: 'morning' },
      source: 'backfill'
    }, requestId)
    expect(first).toMatchObject({ changed: true, eventId: first.eventId })
    expect(replay).toEqual(first)
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM stage_time_events WHERE record_id=?').get(first.record.id)).toEqual({ count: 1 })

    const noChangeRequestId = '12345678-1234-4234-8234-123456789002'
    const noChange = store.repository.updateStageTime('ios', 'outline', {
      startedAt: { localDate: '2026-07-24', segment: 'morning' },
      source: 'manual'
    }, noChangeRequestId)
    expect(noChange).toMatchObject({ changed: false, eventId: null })
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM stage_time_events WHERE record_id=?').get(first.record.id)).toEqual({ count: 1 })
    expect(store.repository.native.prepare('SELECT status FROM operation_log WHERE request_id=?').get(noChangeRequestId)).toEqual({ status: 'audit_only' })

    store.repository.updateStageTime('ios', 'outline', { actualEffortHalfDayUnits: 2, source: 'manual' }, '12345678-1234-4234-8234-123456789003')
    expect(store.repository.updateStageTime('ios', 'outline', {
      startedAt: { localDate: '2026-07-24', segment: 'morning' },
      source: 'manual'
    }, noChangeRequestId)).toEqual(noChange)
    store.close()
  })

  it('undoes publishing time completion with its project status and classification learning sample', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-24T14:00:00+08:00'
    store.repository.native.prepare(`UPDATE projects SET status='paused',ai_suggested_content_type_id='type-ai' WHERE id='ios'`).run()
    const before = store.repository.native.prepare('SELECT COUNT(*) AS count FROM classification_learning_samples').get() as { count: number }
    const completed = store.repository.updateStageTime('ios', 'publishing', {
      completedAt: { localDate: '2026-07-24', segment: 'afternoon' },
      source: 'manual'
    }, '12345678-1234-4234-8234-123456789004')
    expect(completed.changed).toBe(true)
    expect(completed.project.status).toBe('published')
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM classification_learning_samples').get()).toEqual({ count: before.count + 1 })
    const publishedModule = store.repository.native.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id=? AND module_key='publishing'`).get('ios') as { completedAt: string | null }
    const publishedProject = store.repository.native.prepare('SELECT status,updated_at AS updatedAt FROM projects WHERE id=?').get('ios') as { status: string; updatedAt: string }
    const publishedSample = store.repository.native.prepare('SELECT id,project_id AS projectId,title FROM classification_learning_samples WHERE project_id=?').get('ios') as { id: string; projectId: string; title: string }
    expect(publishedSample).toMatchObject({ projectId: 'ios' })

    const effortOnly = store.repository.updateStageTime('ios', 'publishing', {
      actualEffortHalfDayUnits: 3,
      source: 'manual'
    }, '12345678-1234-4234-8234-123456789005')
    expect(store.repository.native.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id=? AND module_key='publishing'`).get('ios')).toEqual(publishedModule)
    expect(store.repository.native.prepare('SELECT status,updated_at AS updatedAt FROM projects WHERE id=?').get('ios')).toEqual(publishedProject)
    if (!effortOnly.changed) throw new Error('expected effort mutation')
    store.repository.undoStageTimeEvent('ios', effortOnly.eventId)

    const cleared = store.repository.updateStageTime('ios', 'publishing', {
      completedAt: null,
      source: 'manual'
    }, '12345678-1234-4234-8234-123456789006')
    expect(cleared).toMatchObject({ changed: true, project: { status: 'producing' }, record: { status: 'not_started', completedAt: null } })
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM classification_learning_samples WHERE project_id=?').get('ios')).toEqual({ count: 0 })
    if (!cleared.changed) throw new Error('expected clearing mutation')
    store.repository.undoStageTimeEvent('ios', cleared.eventId)
    expect(store.repository.native.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id=? AND module_key='publishing'`).get('ios')).toEqual(publishedModule)
    expect(store.repository.native.prepare('SELECT status FROM projects WHERE id=?').get('ios')).toEqual({ status: 'published' })
    expect(store.repository.native.prepare('SELECT id,project_id AS projectId,title FROM classification_learning_samples WHERE project_id=?').get('ios')).toEqual(publishedSample)

    if (!completed.changed) throw new Error('expected mutation')
    store.repository.undoStageTimeEvent('ios', completed.eventId)
    expect(store.repository.getProject('ios', false).status).toBe('paused')
    expect(store.repository.getProject('ios', false).stageTimeRecords.find((record) => record.stageKey === 'publishing')?.completedAt).toBeNull()
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM classification_learning_samples').get()).toEqual(before)
    store.close()
  })

  it('routes publishing skip through the reversible command side effects', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-24T14:00:00+08:00'
    store.repository.native.prepare(`UPDATE projects SET status='paused',ai_suggested_content_type_id='type-ai' WHERE id='ios'`).run()
    const completed = store.repository.updateStageTime('ios', 'publishing', {
      completedAt: { localDate: '2026-07-24', segment: 'afternoon' },
      source: 'manual'
    })
    if (!completed.changed) throw new Error('expected completion')
    const completedAt = store.repository.native.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id='ios' AND module_key='publishing'`).get()
    const sample = store.repository.native.prepare(`SELECT id,project_id AS projectId,title FROM classification_learning_samples WHERE project_id='ios'`).get()

    const skipped = store.repository.setStageTimeStatus('ios', 'publishing', 'skip')
    expect(skipped).toMatchObject({ project: { status: 'producing' }, record: { status: 'skipped', completedAt: null } })
    expect(store.repository.native.prepare(`SELECT COUNT(*) AS count FROM classification_learning_samples WHERE project_id='ios'`).get()).toEqual({ count: 0 })
    store.repository.undoStageTimeEvent('ios', skipped.eventId)
    expect(store.repository.getProject('ios', false)).toMatchObject({ status: 'published' })
    expect(store.repository.native.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id='ios' AND module_key='publishing'`).get()).toEqual(completedAt)
    expect(store.repository.native.prepare(`SELECT id,project_id AS projectId,title FROM classification_learning_samples WHERE project_id='ios'`).get()).toEqual(sample)
    store.close()
  })

  it('does not claim ambiguous unlinked learning samples when clearing publication', async () => {
    const { store } = await createStore()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-24T14:00:00+08:00'
    const first = store.repository.createProject({ title: '重复标题', description: '', contentTypeId: 'type-ai', colorToken: 'project-10', platformTargets: [] })
    const second = store.repository.createProject({ title: '重复标题', description: '', contentTypeId: 'type-ai', colorToken: 'project-11', platformTargets: [] })
    store.repository.native.prepare(`UPDATE projects SET ai_suggested_content_type_id='type-digital' WHERE id IN (?,?)`).run(first.id, second.id)
    store.repository.native.prepare(`INSERT INTO classification_learning_samples(id,title,ai_suggested_content_type_id,final_content_type_id,created_at,project_id) VALUES(?,?,?,?,?,NULL)`)
      .run('ambiguous-legacy', '重复标题', 'type-digital', 'type-ai', '2026-07-20T00:00:00.000Z')
    const completed = store.repository.updateStageTime(first.id, 'publishing', {
      completedAt: { localDate: '2026-07-24', segment: 'afternoon' },
      source: 'manual'
    })
    if (!completed.changed) throw new Error('expected completion')
    const cleared = store.repository.updateStageTime(first.id, 'publishing', { completedAt: null, source: 'manual' })
    if (!cleared.changed) throw new Error('expected clearing')
    expect(store.repository.native.prepare(`SELECT project_id AS projectId FROM classification_learning_samples WHERE id='ambiguous-legacy'`).get()).toEqual({ projectId: null })
    expect(store.repository.native.prepare(`SELECT COUNT(*) AS count FROM classification_learning_samples WHERE project_id=?`).get(first.id)).toEqual({ count: 0 })
    store.repository.undoStageTimeEvent(first.id, cleared.eventId)
    expect(store.repository.native.prepare(`SELECT project_id AS projectId FROM classification_learning_samples WHERE id='ambiguous-legacy'`).get()).toEqual({ projectId: null })
    expect(store.repository.native.prepare(`SELECT COUNT(*) AS count FROM classification_learning_samples WHERE project_id=?`).get(first.id)).toEqual({ count: 1 })
    store.close()
  })
})
