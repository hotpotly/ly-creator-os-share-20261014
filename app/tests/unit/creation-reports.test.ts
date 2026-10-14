import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import {
  buildCreationReportPayload,
  buildProjectCreationReview,
  buildStageScheduleWindow,
  resolveCreationReportPeriod,
  shiftCreationReportAnchor
} from '../../src/main/reporting'
import type { StageTimeRecord } from '../../src/shared/domain'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-reports-')); roots.push(directory)
  return (await openWorkspaceStore(directory))
}

function stageRecord(patch: Partial<StageTimeRecord> & Pick<StageTimeRecord, 'projectId' | 'stageKey'>): StageTimeRecord {
  return {
    id: `${patch.projectId}-${patch.stageKey}`,
    status: 'not_started',
    startedAt: null,
    completedAt: null,
    startSource: null,
    completionSource: null,
    actualEffortHalfDayUnits: null,
    plannedStartedAt: null,
    plannedCompletedAt: null,
    estimatedDurationHalfDayUnits: null,
    planManualFields: [],
    planAutoField: null,
    autoStartActionId: null,
    durationSegments: null,
    durationLabel: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...patch
  }
}

afterEach(async () => {
  delete process.env.CREATOR_OS_TEST_STAGE_DATETIME
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('creation reports', () => {
  it('resolves Monday weeks and calendar months without locale-dependent dates', () => {
    expect(resolveCreationReportPeriod('weekly', '2026-07-21')).toMatchObject({ startDate: '2026-07-20', endDate: '2026-07-26', comparisonLabel: '上周' })
    expect(resolveCreationReportPeriod('monthly', '2026-02-18')).toMatchObject({ startDate: '2026-02-01', endDate: '2026-02-28', comparisonLabel: '上月' })
    expect(shiftCreationReportAnchor('weekly', '2026-07-21', -1)).toBe('2026-07-13')
    expect(shiftCreationReportAnchor('monthly', '2026-01-21', -1)).toBe('2025-12-01')
  })

  it('persists deterministic snapshots and keeps missing time samples empty', async () => {
    const store = await createStore(); store.repository.native.prepare('DELETE FROM schedule_items').run()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-18T14:00:00'
    const complete = store.repository.createProject({
      title: '七月完整样本', description: '有阶段起止与人工投入', contentTypeId: 'type-digital', colorToken: 'project-7', platformTargets: ['B站']
    })
    store.repository.updateStageTime(complete.id, 'materials', {
      startedAt: { localDate: '2026-07-02', segment: 'morning' }, completedAt: { localDate: '2026-07-04', segment: 'afternoon' },
      actualEffortHalfDayUnits: 2, source: 'backfill'
    })
    store.repository.createScheduleItem({
      projectId: complete.id, title: '资料计划完成', actionType: 'materials', startAt: '2026-07-03T09:00:00+08:00', endAt: null, scheduleKind: 'plan', waitingFor: null
    })
    store.repository.updateStageTime(complete.id, 'publishing', {
      startedAt: { localDate: '2026-07-08', segment: 'morning' }, completedAt: { localDate: '2026-07-10', segment: 'afternoon' }, source: 'backfill'
    })
    store.repository.updateStageTime(complete.id, 'versions', {
      startedAt: { localDate: '2026-07-11', segment: 'morning' }, completedAt: { localDate: '2026-07-11', segment: 'evening' },
      actualEffortHalfDayUnits: 4, source: 'backfill'
    })

    const missingStart = store.repository.createProject({
      title: '七月缺少起点', description: '只补记发布完成', contentTypeId: 'type-quick', colorToken: 'project-8', platformTargets: ['小红书']
    })
    store.repository.updateStageTime(missingStart.id, 'publishing', { completedAt: { localDate: '2026-07-12', segment: 'evening' }, source: 'backfill' })

    const first = store.repository.getCreationReport('monthly', '2026-07-18')
    expect(first.payload).toMatchObject({ version: 2, publishedCount: 2, projectDurationSampleCount: 1, timeZone: expect.any(String) })
    expect(first.payload.averageProjectDurationLabel).not.toBeNull()
    expect(first.payload.publishedProjects.find((project) => project.projectId === missingStart.id)?.projectDurationSegments).toBeNull()
    const materials = first.payload.stageSummaries.find((stage) => stage.stageKey === 'materials')!
    expect(materials).toMatchObject({ completedCount: 1, durationSampleCount: 1, actualEffortSampleCount: 1, delayedCompletedCount: 1 })

    const reused = store.repository.getCreationReport('monthly', '2026-07-18')
    expect(reused.id).toBe(first.id)
    const regenerated = store.repository.getCreationReport('monthly', '2026-07-18', true)
    expect(regenerated.id).not.toBe(first.id)
    expect(store.repository.native.prepare('SELECT COUNT(*) AS count FROM creation_report_snapshots').get()).toMatchObject({ count: 2 })
    expect(store.repository.listCreationReportSnapshots('monthly', '2026-07-01')).toHaveLength(2)
    expect(store.repository.getCreationReportSnapshotById(first.id)).toEqual(first)
    const review = store.repository.getProjectCreationReview(complete.id)
    expect(review).toMatchObject({
      projectId: complete.id,
      lifecycleEndKind: 'published',
      summaryActualEffortHalfDayUnits: 2,
      largestAbsoluteVarianceStageKey: 'materials'
    })
    expect(review.stages.find((stage) => stage.stageKey === 'materials')).toMatchObject({
      varianceState: 'late_completed',
      varianceSegments: 4
    })
    store.close()
  })

  it('keeps old v1 snapshots readable without inventing v2 project details', async () => {
    const store = await createStore()
    const report = store.repository.getCreationReport('weekly', '2026-07-18')
    if (report.payload.version !== 2) throw new Error('expected v2')
    const legacyPayload: Record<string, unknown> = { ...report.payload, version: 1 }
    delete legacyPayload.calculatedThrough
    delete legacyPayload.timeZone
    delete legacyPayload.periodProjects
    store.repository.native.prepare('UPDATE creation_report_snapshots SET snapshot_json=? WHERE id=?').run(JSON.stringify(legacyPayload), report.id)
    const restored = store.repository.getCreationReportSnapshotById(report.id)
    expect(restored.payload).toMatchObject({ version: 1, period: report.payload.period })
    expect(store.repository.listCreationReportSnapshots('weekly', report.periodStart)).toEqual([
      expect.objectContaining({ id: report.id, version: 1 })
    ])
    store.close()
  })

  it('compares a month with the previous calendar month', async () => {
    const store = await createStore(); store.repository.native.prepare('DELETE FROM schedule_items').run()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-18T14:00:00'
    const june = store.repository.createProject({ title: '六月发布', description: '', contentTypeId: 'type-quick', colorToken: 'project-6', platformTargets: [] })
    store.repository.updateStageTime(june.id, 'publishing', {
      startedAt: { localDate: '2026-06-02', segment: 'morning' }, completedAt: { localDate: '2026-06-03', segment: 'morning' }, source: 'backfill'
    })
    const july = store.repository.createProject({ title: '七月发布', description: '', contentTypeId: 'type-quick', colorToken: 'project-7', platformTargets: [] })
    store.repository.updateStageTime(july.id, 'publishing', {
      startedAt: { localDate: '2026-07-02', segment: 'morning' }, completedAt: { localDate: '2026-07-05', segment: 'morning' }, source: 'backfill'
    })
    const report = store.repository.getCreationReport('monthly', '2026-07-18')
    expect(report.payload.comparison).toMatchObject({ periodLabel: '2026年6月', publishedCount: 1, publishedCountDelta: 0 })
    expect(report.payload.comparison.averageProjectDurationDeltaSegments).toBeGreaterThan(0)
    store.close()
  })

  it('uses deadline priority and clips future completion facts at the report cutoff', async () => {
    const window = buildStageScheduleWindow([
      { projectId: 'p', actionType: 'script', startAt: '2026-07-01T09:00:00+08:00', endAt: '2026-07-20T18:00:00+08:00', scheduleKind: 'plan' },
      { projectId: 'p', actionType: 'script', startAt: '2026-07-02T09:00:00+08:00', endAt: '2026-07-18T18:00:00+08:00', scheduleKind: 'hard_deadline' },
      { projectId: 'p', actionType: 'script', startAt: '2026-07-03T09:00:00+08:00', endAt: '2026-07-19T18:00:00+08:00', scheduleKind: 'hard_deadline' }
    ], 'Asia/Shanghai')
    expect(window.plannedEndAt).toEqual({ localDate: '2026-07-20', segment: 'evening' })
    expect(window.varianceDeadlineAt).toEqual({ localDate: '2026-07-19', segment: 'evening' })

    const store = await createStore()
    store.repository.native.prepare('DELETE FROM schedule_items').run()
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-07-18T14:00:00+08:00'
    const project = store.repository.createProject({ title: '跨截止项目', description: '', contentTypeId: 'type-ai', colorToken: 'project-5', platformTargets: [] })
    store.repository.updateStageTime(project.id, 'script', {
      startedAt: { localDate: '2026-07-17', segment: 'morning' },
      completedAt: { localDate: '2026-07-18', segment: 'afternoon' },
      source: 'backfill'
    })
    store.repository.native.prepare(`UPDATE stage_time_records SET completed_date='2026-07-20',completed_segment='evening',status='completed' WHERE project_id=? AND stage_key='script'`).run(project.id)
    store.repository.native.prepare(`DELETE FROM stage_time_events WHERE project_id=? AND stage_key='script'`).run(project.id)
    const report = store.repository.getCreationReport('monthly', '2026-07-18', true)
    if (report.payload.version !== 2) throw new Error('expected v2')
    const stage = report.payload.periodProjects.find((item) => item.projectId === project.id)?.stages.find((item) => item.stageKey === 'script')
    expect(stage).toMatchObject({ stateAtCutoff: 'in_progress', completedAt: null, durationSegments: null })
    expect(stage?.elapsedSegments).toBe(4)
    store.close()
  })

  it('keeps future in-period plans visible without treating them as overdue', () => {
    const payload = buildCreationReportPayload({
      kind: 'weekly',
      anchorDate: '2026-07-21',
      asOf: { localDate: '2026-07-21', segment: 'afternoon' },
      timeZone: 'Asia/Shanghai',
      projects: [{ id: 'future', title: '本周稍后项目', colorToken: 'project-1', modules: [{ stageKey: 'outline', enabled: true, position: 1 }] }],
      stageRecords: [],
      schedules: [{
        projectId: 'future',
        actionType: 'outline',
        startAt: '2026-07-24T09:00:00+08:00',
        endAt: '2026-07-24T18:00:00+08:00',
        scheduleKind: 'plan'
      }]
    })
    const project = payload.periodProjects.find((item) => item.projectId === 'future')
    expect(project).toMatchObject({ actualStageKeys: [], scheduledStageKeys: ['outline'], delayedStageCount: 0, openOverdueCount: 0 })
    expect(project?.stages[0]).toMatchObject({ varianceInPeriod: true, varianceState: 'not_due', varianceSegments: null })
    expect(payload.stageSummaries.find((item) => item.stageKey === 'outline')).toMatchObject({ scheduledSampleCount: 1, notDueSampleCount: 1, openOverdueCount: 0 })
  })

  it('does not bridge disjoint schedules across the report period or count outside deadlines', () => {
    const base = {
      kind: 'weekly' as const,
      anchorDate: '2026-07-21',
      asOf: { localDate: '2026-07-25', segment: 'afternoon' as const },
      timeZone: 'Asia/Shanghai',
      projects: [{ id: 'gap', title: '排期空档项目', colorToken: 'project-2' as const, modules: [{ stageKey: 'script' as const, enabled: true, position: 1 }] }],
      stageRecords: [],
      schedules: [
        { projectId: 'gap', actionType: 'script', startAt: '2026-07-13T09:00:00+08:00', endAt: null, scheduleKind: 'plan' as const },
        { projectId: 'gap', actionType: 'script', startAt: '2026-08-01T09:00:00+08:00', endAt: null, scheduleKind: 'plan' as const }
      ]
    }
    expect(buildCreationReportPayload(base).periodProjects).toEqual([])

    const completed = stageRecord({
      projectId: 'gap',
      stageKey: 'script',
      status: 'completed',
      startedAt: { localDate: '2026-07-20', segment: 'morning' },
      completedAt: { localDate: '2026-07-21', segment: 'afternoon' },
      durationSegments: 4,
      durationLabel: '约1.5天'
    })
    const payload = buildCreationReportPayload({
      ...base,
      stageRecords: [completed],
      schedules: [{ projectId: 'gap', actionType: 'script', startAt: '2026-07-10T09:00:00+08:00', endAt: null, scheduleKind: 'hard_deadline' }]
    })
    const project = payload.periodProjects[0]!
    expect(project.stages[0]).toMatchObject({ varianceInPeriod: false, varianceState: 'late_completed' })
    expect(project).toMatchObject({ delayedStageCount: 0, openOverdueCount: 0 })
    expect(payload.stageSummaries.find((item) => item.stageKey === 'script')).toMatchObject({ scheduledSampleCount: 0, delayedCompletedCount: 0 })
  })

  it('reconstructs historical stage state from events instead of leaking later reopen and effort', () => {
    const record = stageRecord({
      projectId: 'history',
      stageKey: 'script',
      status: 'not_started',
      actualEffortHalfDayUnits: 4,
      updatedAt: '2026-07-20T12:00:00.000Z'
    })
    const empty = {
      status: 'not_started' as const,
      startedAt: null,
      completedAt: null,
      actualEffortHalfDayUnits: null
    }
    const completed = {
      status: 'completed' as const,
      startedAt: { localDate: '2026-07-14', segment: 'morning' as const },
      completedAt: { localDate: '2026-07-15', segment: 'afternoon' as const },
      actualEffortHalfDayUnits: 2
    }
    const reopened = { ...empty, actualEffortHalfDayUnits: 4 }
    const payload = buildCreationReportPayload({
      kind: 'weekly',
      anchorDate: '2026-07-15',
      asOf: { localDate: '2026-07-19', segment: 'evening' },
      timeZone: 'Asia/Shanghai',
      projects: [{ id: 'history', title: '历史项目', colorToken: 'project-3', modules: [{ stageKey: 'script', enabled: true, position: 1 }] }],
      stageRecords: [record],
      stageEvents: [
        { projectId: 'history', stageKey: 'script', before: empty, after: completed, recordedAt: '2026-07-15T06:00:00.000Z' },
        { projectId: 'history', stageKey: 'script', before: completed, after: reopened, recordedAt: '2026-07-20T06:00:00.000Z' }
      ],
      schedules: []
    })
    const stage = payload.periodProjects[0]?.stages[0]
    expect(stage).toMatchObject({
      stateAtCutoff: 'completed',
      startedAt: completed.startedAt,
      completedAt: completed.completedAt,
      actualEffortHalfDayUnits: 2
    })
    expect(payload.stageSummaries.find((item) => item.stageKey === 'script')).toMatchObject({ completedCount: 1, totalActualEffortHalfDayUnits: 2 })
  })

  it('keeps historical publication after a later reopen and applies cross-cutoff completion corrections', () => {
    const empty = {
      status: 'in_progress' as const,
      startedAt: { localDate: '2026-07-14', segment: 'morning' as const },
      completedAt: null,
      actualEffortHalfDayUnits: null
    }
    const completed = {
      ...empty,
      status: 'completed' as const,
      completedAt: { localDate: '2026-07-15', segment: 'afternoon' as const }
    }
    const reopened = { ...empty }
    const publishingRecord = stageRecord({ projectId: 'published-history', stageKey: 'publishing', ...reopened })
    const historicalPublication = buildCreationReportPayload({
      kind: 'weekly',
      anchorDate: '2026-07-15',
      asOf: { localDate: '2026-07-19', segment: 'evening' },
      timeZone: 'Asia/Shanghai',
      projects: [{ id: 'published-history', title: '历史发布', colorToken: 'project-4', modules: [{ stageKey: 'publishing', enabled: true, position: 1 }] }],
      stageRecords: [publishingRecord],
      stageEvents: [
        { projectId: 'published-history', stageKey: 'publishing', before: empty, after: completed, recordedAt: '2026-07-15T06:00:00.000Z' },
        { projectId: 'published-history', stageKey: 'publishing', before: completed, after: reopened, recordedAt: '2026-07-20T06:00:00.000Z' }
      ],
      schedules: []
    })
    expect(historicalPublication).toMatchObject({ publishedCount: 1 })
    expect(historicalPublication.publishedProjects[0]).toMatchObject({ projectId: 'published-history', publishedAt: completed.completedAt })

    const movedAfterCutoff = {
      ...completed,
      completedAt: { localDate: '2026-07-20', segment: 'afternoon' as const }
    }
    const corrected = buildCreationReportPayload({
      kind: 'weekly',
      anchorDate: '2026-07-15',
      asOf: { localDate: '2026-07-15', segment: 'evening' },
      timeZone: 'Asia/Shanghai',
      projects: [{ id: 'corrected', title: '修正完成时间', colorToken: 'project-5', modules: [{ stageKey: 'script', enabled: true, position: 1 }] }],
      stageRecords: [stageRecord({ projectId: 'corrected', stageKey: 'script', ...movedAfterCutoff })],
      stageEvents: [
        { projectId: 'corrected', stageKey: 'script', before: empty, after: completed, recordedAt: '2026-07-15T06:00:00.000Z' },
        { projectId: 'corrected', stageKey: 'script', before: completed, after: movedAfterCutoff, recordedAt: '2026-07-20T06:00:00.000Z' }
      ],
      schedules: []
    })
    expect(corrected.periodProjects[0]?.stages[0]).toMatchObject({
      stateAtCutoff: 'in_progress',
      completedAt: null,
      durationSegments: null
    })

    const noStart = { ...empty, status: 'not_started' as const, startedAt: null }
    const movedStart = { ...empty, startedAt: { localDate: '2026-07-20', segment: 'morning' as const } }
    const correctedStart = buildCreationReportPayload({
      kind: 'weekly',
      anchorDate: '2026-07-15',
      asOf: { localDate: '2026-07-15', segment: 'evening' },
      timeZone: 'Asia/Shanghai',
      projects: [{ id: 'corrected-start', title: '修正开始时间', colorToken: 'project-6', modules: [{ stageKey: 'script', enabled: true, position: 1 }] }],
      stageRecords: [stageRecord({ projectId: 'corrected-start', stageKey: 'script', ...movedStart })],
      stageEvents: [
        { projectId: 'corrected-start', stageKey: 'script', before: noStart, after: empty, recordedAt: '2026-07-14T06:00:00.000Z' },
        { projectId: 'corrected-start', stageKey: 'script', before: empty, after: movedStart, recordedAt: '2026-07-20T06:00:00.000Z' }
      ],
      schedules: [{ projectId: 'corrected-start', actionType: 'script', startAt: '2026-07-15T09:00:00+08:00', endAt: null, scheduleKind: 'plan' }]
    })
    expect(correctedStart.periodProjects[0]?.stages[0]).toMatchObject({
      stateAtCutoff: 'not_started',
      startedAt: null,
      completedAt: null
    })
  })

  it('uses the topic archive lifecycle and never invents an archive endpoint', async () => {
    const store = await createStore()
    const project = store.repository.createProject({ title: '未发布归档项目', description: '', contentTypeId: 'type-quick', colorToken: 'project-8', platformTargets: [] })
    store.repository.setProjectLifecycle(project.id, 'archived')
    const review = store.repository.getProjectCreationReview(project.id)
    expect(review).toMatchObject({
      projectId: project.id,
      projectStatus: 'archived',
      lifecycleEndKind: 'archived_without_publish',
      lifecycleOngoing: false,
      lifecycleStartedAt: null,
      lifecycleEndedAt: null,
      lifecycleDurationSegments: null
    })
    store.close()

    const direct = buildProjectCreationReview({
      project: { id: 'archived', title: '归档', colorToken: 'project-8', status: 'archived', modules: [] },
      asOf: { localDate: '2026-07-25', segment: 'afternoon' },
      calculatedAt: '2026-07-25T06:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      stageRecords: [],
      schedules: []
    })
    expect(direct.lifecycleEndKind).toBe('archived_without_publish')
  })

  it('surfaces damaged historical snapshots instead of attaching current payload to the old id', async () => {
    const store = await createStore()
    const report = store.repository.getCreationReport('weekly', '2026-07-18')
    store.repository.native.prepare('UPDATE creation_report_snapshots SET snapshot_json=? WHERE id=?').run(JSON.stringify({ version: 2, broken: true }), report.id)
    expect(() => store.repository.getCreationReportSnapshotById(report.id)).toThrow('历史快照已损坏')
    expect(() => store.repository.listCreationReportSnapshots('weekly', report.periodStart)).toThrow('历史快照已损坏')
    store.close()
  })

  it('keeps older report snapshots readable when publication metadata is missing', async () => {
    const store = await createStore()
    store.repository.updateStageTime('ios', 'publishing', {
      completedAt: { localDate: '2026-07-18', segment: 'afternoon' },
      source: 'backfill'
    })
    const current = store.repository.getCreationReport('weekly', '2026-07-18', true)
    const legacy = structuredClone(current) as unknown as {
      payload: { publishedProjects: Array<Record<string, unknown>> }
    }
    legacy.payload.publishedProjects.forEach((project) => {
      delete project.contentTypeId
      delete project.contentTypeName
      delete project.platformTargets
    })
    const parsed = RESPONSE_SCHEMAS.creationReportSnapshotSchema.parse(legacy)
    expect(parsed.payload.publishedProjects[0]).toMatchObject({ contentTypeId: '', contentTypeName: '未分类', platformTargets: [] })
    store.close()
  })
})
