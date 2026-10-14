import type {
  CreationReportKind,
  CreationReportPayloadV2,
  CreationReportPeriod,
  CreationReportPeriodProject,
  CreationReportProjectStage,
  CreationReportPublishedProject,
  CreationReportStageSummary,
  ProjectColorToken,
  ProjectCreationReview,
  ProjectCreationReviewStage,
  ProjectStatus,
  ScheduleKind,
  ScheduleVarianceState,
  StageTimeKey,
  StageTimePoint,
  StageTimeRecord,
  StageTimeStatus
} from '../shared/domain'
import {
  formatCoarseDuration,
  normalizeCreationDay,
  toSegmentOrdinal
} from '../shared/domain/coarse-time'

export const REPORT_STAGE_KEYS: StageTimeKey[] = ['materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'versions']

export interface ReportProjectModuleInput {
  stageKey: StageTimeKey
  enabled: boolean
  position: number
}

export interface ReportProjectInput {
  id: string
  title: string
  colorToken: ProjectColorToken
  contentTypeId?: string
  contentTypeName?: string
  platformTargets?: string[]
  status?: ProjectStatus
  modules?: ReportProjectModuleInput[]
}

export interface ReportScheduleInput {
  projectId: string
  actionType: string
  startAt: string | null
  endAt: string | null
  scheduleKind: ScheduleKind
}

export interface CreationReportBuildInput {
  kind: CreationReportKind
  anchorDate: string
  asOf: StageTimePoint
  timeZone: string
  projects: ReportProjectInput[]
  stageRecords: StageTimeRecord[]
  stageEvents?: ReportStageTimeEventInput[]
  schedules: ReportScheduleInput[]
}

export interface ReportStageTimeStateInput {
  status: StageTimeStatus
  startedAt: StageTimePoint | null
  completedAt: StageTimePoint | null
  actualEffortHalfDayUnits: number | null
}

export interface ReportStageTimeEventInput {
  projectId: string
  stageKey: StageTimeKey
  before: ReportStageTimeStateInput
  after: ReportStageTimeStateInput
  recordedAt: string
}

export interface ReportPlanBaselineInput {
  projectId: string
  stageKey: string
  source: 'first_saved' | 'legacy'
  capturedAt: string
  schedules: ReportScheduleInput[]
}

export interface ProjectCreationReviewBuildInput {
  baselines?: ReportPlanBaselineInput[]
  project: ReportProjectInput
  asOf: StageTimePoint
  calculatedAt: string
  timeZone: string
  stageRecords: StageTimeRecord[]
  schedules: ReportScheduleInput[]
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const schedulePriority: Record<ScheduleKind, number> = { plan: 0, publish_date: 1, hard_deadline: 2 }

function parseDateKey(value: string): Date {
  if (!DATE_KEY.test(value)) throw new Error('报表日期格式无效')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('报表日期格式无效')
  return date
}

function dateKey(date: Date): string { return date.toISOString().slice(0, 10) }
function addDays(value: string, days: number): string { return dateKey(new Date(parseDateKey(value).getTime() + days * DAY_MS)) }

function rangeLabel(startDate: string, endDate: string, kind: CreationReportKind): string {
  const start = parseDateKey(startDate); const end = parseDateKey(endDate)
  const startYear = start.getUTCFullYear(); const startMonth = start.getUTCMonth() + 1; const startDay = start.getUTCDate()
  if (kind === 'monthly') return `${startYear}年${startMonth}月`
  const endYear = end.getUTCFullYear(); const endMonth = end.getUTCMonth() + 1; const endDay = end.getUTCDate()
  if (startYear !== endYear) return `${startYear}年${startMonth}月${startDay}日—${endYear}年${endMonth}月${endDay}日`
  if (startMonth !== endMonth) return `${startYear}年${startMonth}月${startDay}日—${endMonth}月${endDay}日`
  return `${startYear}年${startMonth}月${startDay}日—${endDay}日`
}

export function resolveCreationReportPeriod(kind: CreationReportKind, anchorDate: string): CreationReportPeriod {
  const anchor = parseDateKey(anchorDate)
  if (kind === 'weekly') {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7
    const startDate = addDays(anchorDate, -mondayOffset); const endDate = addDays(startDate, 6)
    return { kind, startDate, endDate, label: rangeLabel(startDate, endDate, kind), comparisonLabel: '上周' }
  }
  const startDate = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}-01`
  const nextMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1))
  const endDate = dateKey(new Date(nextMonth.getTime() - DAY_MS))
  return { kind, startDate, endDate, label: rangeLabel(startDate, endDate, kind), comparisonLabel: '上月' }
}

export function previousCreationReportPeriod(period: CreationReportPeriod): CreationReportPeriod {
  return resolveCreationReportPeriod(period.kind, addDays(period.startDate, -1))
}

export function shiftCreationReportAnchor(kind: CreationReportKind, anchorDate: string, direction: -1 | 1): string {
  const period = resolveCreationReportPeriod(kind, anchorDate)
  if (kind === 'weekly') return addDays(period.startDate, direction * 7)
  const start = parseDateKey(period.startDate)
  return dateKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + direction, 1)))
}

export function stagePointIndex(point: StageTimePoint): number { return toSegmentOrdinal(point) }

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function formatReportDuration(segments: number | null): string | null { return formatCoarseDuration(segments) }

function isoDateTimePoint(value: string | null, timeZone: string): StageTimePoint | null {
  if (!value) return null
  if (DATE_KEY.test(value)) return { localDate: value, segment: 'evening' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return normalizeCreationDay(date, timeZone)
}

function average(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : null
}

function projectModules(project: ReportProjectInput, records: StageTimeRecord[], schedules: ReportScheduleInput[]): ReportProjectModuleInput[] {
  const configured = project.modules?.filter((module) => REPORT_STAGE_KEYS.includes(module.stageKey)) ?? []
  const positions = new Map(configured.map((module) => [module.stageKey, module.position]))
  const facts = new Set<StageTimeKey>()
  records.filter((record) => record.projectId === project.id).forEach((record) => {
    if (record.startedAt || record.completedAt || record.actualEffortHalfDayUnits !== null || record.status === 'skipped') facts.add(record.stageKey)
  })
  schedules.filter((item) => item.projectId === project.id && REPORT_STAGE_KEYS.includes(item.actionType as StageTimeKey))
    .forEach((item) => facts.add(item.actionType as StageTimeKey))
  const merged = new Map<StageTimeKey, ReportProjectModuleInput>()
  configured.forEach((module) => merged.set(module.stageKey, module))
  facts.forEach((stageKey) => {
    if (!merged.has(stageKey)) merged.set(stageKey, {
      stageKey,
      enabled: false,
      position: positions.get(stageKey) ?? REPORT_STAGE_KEYS.indexOf(stageKey) + 100
    })
  })
  return [...merged.values()]
    .filter((module) => module.enabled || facts.has(module.stageKey))
    .sort((left, right) => left.position - right.position || REPORT_STAGE_KEYS.indexOf(left.stageKey) - REPORT_STAGE_KEYS.indexOf(right.stageKey))
}

interface StageScheduleWindow {
  plannedStartAt: StageTimePoint | null
  plannedEndAt: StageTimePoint | null
  varianceDeadlineAt: StageTimePoint | null
}

export function buildStageScheduleWindow(schedules: ReportScheduleInput[], timeZone: string): StageScheduleWindow {
  const parsed = schedules.flatMap((schedule) => {
    const start = isoDateTimePoint(schedule.startAt, timeZone)
    const end = isoDateTimePoint(schedule.endAt ?? schedule.startAt, timeZone)
    return start || end ? [{ schedule, start: start ?? end!, end: end ?? start! }] : []
  })
  if (!parsed.length) return { plannedStartAt: null, plannedEndAt: null, varianceDeadlineAt: null }
  const plannedStartAt = parsed.reduce((best, item) => stagePointIndex(item.start) < stagePointIndex(best) ? item.start : best, parsed[0]!.start)
  const plannedEndAt = parsed.reduce((best, item) => stagePointIndex(item.end) > stagePointIndex(best) ? item.end : best, parsed[0]!.end)
  const maxPriority = Math.max(...parsed.map((item) => schedulePriority[item.schedule.scheduleKind]))
  const deadlineCandidates = parsed.filter((item) => schedulePriority[item.schedule.scheduleKind] === maxPriority)
  const varianceDeadlineAt = deadlineCandidates.reduce((best, item) => stagePointIndex(item.end) > stagePointIndex(best) ? item.end : best, deadlineCandidates[0]!.end)
  return { plannedStartAt, plannedEndAt, varianceDeadlineAt }
}

function startVarianceFor(startedAt: StageTimePoint | null, schedules: ReportScheduleInput[], timeZone: string): number | null {
  if (!startedAt) return null
  // A deadline-only point is not a planned start; never manufacture a start from it.
  const starts = schedules.filter(item => item.scheduleKind === 'plan' && item.startAt && item.endAt && item.startAt !== item.endAt)
    .flatMap(item => { const start = isoDateTimePoint(item.startAt, timeZone), end = isoDateTimePoint(item.endAt, timeZone); return start && end && stagePointIndex(end) > stagePointIndex(start) ? [start] : [] })
  return starts.length ? stagePointIndex(startedAt) - Math.min(...starts.map(stagePointIndex)) : null
}

function varianceFor(
  status: StageTimeStatus,
  completedAt: StageTimePoint | null,
  deadline: StageTimePoint | null,
  cutoff: StageTimePoint
): { varianceSegments: number | null; varianceState: ScheduleVarianceState } {
  if (!deadline) return { varianceSegments: null, varianceState: 'no_schedule' }
  if (status === 'skipped') return { varianceSegments: null, varianceState: 'not_due' }
  const due = stagePointIndex(deadline)
  if (completedAt) {
    const varianceSegments = stagePointIndex(completedAt) - due
    return { varianceSegments, varianceState: varianceSegments < 0 ? 'early' : varianceSegments === 0 ? 'on_time' : 'late_completed' }
  }
  const varianceSegments = stagePointIndex(cutoff) - due
  return varianceSegments > 0
    ? { varianceSegments, varianceState: 'overdue_open' }
    : { varianceSegments: null, varianceState: 'not_due' }
}

function clippedStage(
  state: ReportStageTimeStateInput | null,
  cutoff: StageTimePoint
): Pick<CreationReportProjectStage, 'stateAtCutoff' | 'startedAt' | 'completedAt' | 'durationSegments' | 'elapsedSegments' | 'actualEffortHalfDayUnits'> {
  if (!state) return { stateAtCutoff: 'not_started', startedAt: null, completedAt: null, durationSegments: null, elapsedSegments: null, actualEffortHalfDayUnits: null }
  const cutoffIndex = stagePointIndex(cutoff)
  const startIndex = state.startedAt ? stagePointIndex(state.startedAt) : null
  const completeIndex = state.completedAt ? stagePointIndex(state.completedAt) : null
  if (startIndex !== null && startIndex > cutoffIndex) {
    return { stateAtCutoff: 'not_started', startedAt: null, completedAt: null, durationSegments: null, elapsedSegments: null, actualEffortHalfDayUnits: null }
  }
  if (state.status === 'skipped') {
    return { stateAtCutoff: 'skipped', startedAt: state.startedAt, completedAt: null, durationSegments: null, elapsedSegments: null, actualEffortHalfDayUnits: state.actualEffortHalfDayUnits }
  }
  if (completeIndex !== null && completeIndex <= cutoffIndex) {
    return {
      stateAtCutoff: 'completed',
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      durationSegments: state.startedAt ? Math.max(0, completeIndex - stagePointIndex(state.startedAt)) : null,
      elapsedSegments: null,
      actualEffortHalfDayUnits: state.actualEffortHalfDayUnits
    }
  }
  if (state.startedAt) {
    return {
      stateAtCutoff: 'in_progress',
      startedAt: state.startedAt,
      completedAt: null,
      durationSegments: null,
      elapsedSegments: Math.max(0, cutoffIndex - stagePointIndex(state.startedAt)),
      actualEffortHalfDayUnits: state.actualEffortHalfDayUnits
    }
  }
  return { stateAtCutoff: 'not_started', startedAt: null, completedAt: null, durationSegments: null, elapsedSegments: null, actualEffortHalfDayUnits: state.actualEffortHalfDayUnits }
}

function recordState(record: StageTimeRecord | undefined): ReportStageTimeStateInput | null {
  return record ? {
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    actualEffortHalfDayUnits: record.actualEffortHalfDayUnits
  } : null
}

function stageStateAtCutoff(
  record: StageTimeRecord | undefined,
  events: ReportStageTimeEventInput[],
  cutoff: StageTimePoint,
  timeZone: string
): ReportStageTimeStateInput | null {
  const relevant = events.filter((event) => event.projectId === record?.projectId && event.stageKey === record.stageKey)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
  if (!relevant.length) return recordState(record)
  const atOrBefore = relevant.filter((event) => {
    const completedChanged = JSON.stringify(event.before.completedAt) !== JSON.stringify(event.after.completedAt)
    const startedChanged = JSON.stringify(event.before.startedAt) !== JSON.stringify(event.after.startedAt)
    const completionCorrectionPoint = completedChanged && event.before.completedAt && event.after.completedAt
      ? stagePointIndex(event.before.completedAt) <= stagePointIndex(event.after.completedAt) ? event.before.completedAt : event.after.completedAt
      : completedChanged ? event.after.completedAt : null
    const startCorrectionPoint = startedChanged && event.before.startedAt && event.after.startedAt
      ? stagePointIndex(event.before.startedAt) <= stagePointIndex(event.after.startedAt) ? event.before.startedAt : event.after.startedAt
      : startedChanged ? event.after.startedAt : null
    const point = completionCorrectionPoint
      ? completionCorrectionPoint
      : startCorrectionPoint
        ? startCorrectionPoint
        : isoDateTimePoint(event.recordedAt, timeZone)
    return point ? stagePointIndex(point) <= stagePointIndex(cutoff) : false
  })
  return atOrBefore.at(-1)?.after ?? relevant[0]?.before ?? recordState(record)
}

function buildPeriodStage(
  module: ReportProjectModuleInput,
  record: StageTimeRecord | undefined,
  events: ReportStageTimeEventInput[],
  schedules: ReportScheduleInput[],
  cutoff: StageTimePoint,
  timeZone: string,
  periodRange: { start: number; end: number }
): CreationReportProjectStage {
  const clipped = clippedStage(stageStateAtCutoff(record, events, cutoff, timeZone), cutoff)
  const plan = buildStageScheduleWindow(schedules, timeZone)
  const deadlineIndex = plan.varianceDeadlineAt ? stagePointIndex(plan.varianceDeadlineAt) : null
  return {
    stageKey: module.stageKey,
    enabled: module.enabled,
    position: module.position,
    ...clipped,
    plannedStartAt: plan.plannedStartAt,
    plannedEndAt: plan.plannedEndAt,
    varianceDeadlineAt: plan.varianceDeadlineAt,
    varianceInPeriod: deadlineIndex !== null && deadlineIndex >= periodRange.start && deadlineIndex <= periodRange.end,
    ...varianceFor(clipped.stateAtCutoff, clipped.completedAt, plan.varianceDeadlineAt, cutoff)
  }
}

function intersects(start: StageTimePoint | null, end: StageTimePoint | null, rangeStart: number, rangeEnd: number): boolean {
  if (!start && !end) return false
  const startIndex = stagePointIndex(start ?? end!)
  const endIndex = stagePointIndex(end ?? start!)
  return startIndex <= rangeEnd && endIndex >= rangeStart
}

function lifecycleSummary(stages: CreationReportProjectStage[], projectStatus: ProjectStatus, cutoff: StageTimePoint): {
  duration: number | null
  effort: number
  effortCount: number
} {
  const starts = stages.flatMap((stage) => stage.startedAt ? [stagePointIndex(stage.startedAt)] : [])
  const publishing = stages.find((stage) => stage.stageKey === 'publishing' && stage.completedAt)
  const publishingPosition = stages.find((stage) => stage.stageKey === 'publishing')?.position ?? Number.POSITIVE_INFINITY
  const end = publishing?.completedAt ? stagePointIndex(publishing.completedAt) : projectStatus === 'archived' ? null : stagePointIndex(cutoff)
  const duration = starts.length && end !== null && Math.min(...starts) <= end ? end - Math.min(...starts) : null
  const effortStages = stages.filter((stage) => stage.actualEffortHalfDayUnits !== null && (!publishing || stage.position <= publishingPosition))
  return {
    duration,
    effort: effortStages.reduce((sum, stage) => sum + (stage.actualEffortHalfDayUnits ?? 0), 0),
    effortCount: effortStages.length
  }
}

function buildPeriodProjects(input: CreationReportBuildInput, period: CreationReportPeriod, cutoff: StageTimePoint): CreationReportPeriodProject[] {
  const rangeStart = stagePointIndex({ localDate: period.startDate, segment: 'morning' })
  const periodRangeEnd = stagePointIndex({ localDate: period.endDate, segment: 'evening' })
  const actualRangeEnd = Math.min(periodRangeEnd, stagePointIndex(cutoff))
  return input.projects.flatMap((project): CreationReportPeriodProject[] => {
    const records = input.stageRecords.filter((record) => record.projectId === project.id)
    const schedules = input.schedules.filter((schedule) => schedule.projectId === project.id)
    const modules = projectModules(project, records, schedules)
    const stages = modules.map((module) => buildPeriodStage(
      module,
      records.find((record) => record.stageKey === module.stageKey),
      input.stageEvents ?? [],
      schedules.filter((schedule) => schedule.actionType === module.stageKey),
      cutoff,
      input.timeZone,
      { start: rangeStart, end: periodRangeEnd }
    ))
    const actualStageKeys = stages.filter((stage) => intersects(
      stage.startedAt,
      stage.completedAt ?? (stage.stateAtCutoff === 'in_progress' ? cutoff : null),
      rangeStart,
      actualRangeEnd
    )).map((stage) => stage.stageKey)
    const scheduledStageKeys = stages.filter((stage) => {
      if (actualStageKeys.includes(stage.stageKey)) return false
      return schedules.filter((schedule) => schedule.actionType === stage.stageKey).some((schedule) => {
        const start = isoDateTimePoint(schedule.startAt ?? schedule.endAt, input.timeZone)
        const end = isoDateTimePoint(schedule.endAt ?? schedule.startAt, input.timeZone)
        return intersects(start, end, rangeStart, periodRangeEnd)
      })
    }).map((stage) => stage.stageKey)
    if (!actualStageKeys.length && !scheduledStageKeys.length) return []
    const summary = lifecycleSummary(stages, project.status ?? 'preparing', cutoff)
    return [{
      projectId: project.id,
      title: project.title,
      colorToken: project.colorToken,
      projectStatus: project.status ?? 'preparing',
      actualStageKeys,
      scheduledStageKeys,
      lifecycleDurationSegments: summary.duration,
      summaryActualEffortHalfDayUnits: summary.effort,
      summaryActualEffortStageCount: summary.effortCount,
      completeTimeSampleCount: stages.filter((stage) => stage.startedAt && stage.completedAt).length,
      completedStageCount: stages.filter((stage) => stage.stateAtCutoff === 'completed').length,
      delayedStageCount: stages.filter((stage) => stage.varianceInPeriod && stage.varianceState === 'late_completed').length,
      openOverdueCount: stages.filter((stage) => stage.varianceInPeriod && stage.varianceState === 'overdue_open').length,
      stages
    }]
  }).sort((left, right) => right.openOverdueCount - left.openOverdueCount || right.delayedStageCount - left.delayedStageCount || left.title.localeCompare(right.title))
}

interface BaseStageSummary {
  stageKey: StageTimeKey
  completedCount: number
  durations: number[]
  actualEfforts: number[]
  scheduledSampleCount: number
  notDueSampleCount: number
  delayedCompletedCount: number
  openOverdueCount: number
  delays: number[]
}

interface BaseReportMetrics {
  period: CreationReportPeriod
  publishedProjects: CreationReportPublishedProject[]
  stageSummaries: BaseStageSummary[]
}

function buildBaseMetrics(input: CreationReportBuildInput & { period: CreationReportPeriod }): BaseReportMetrics {
  const projectMap = new Map(input.projects.map((project) => [project.id, project]))
  const rangeStart = stagePointIndex({ localDate: input.period.startDate, segment: 'morning' })
  const rangeEnd = stagePointIndex({ localDate: input.period.endDate, segment: 'evening' })
  const cutoff = Math.min(stagePointIndex(input.asOf), rangeEnd)
  const periodProjects = buildPeriodProjects(input, input.period, input.asOf)
  const stageSummaries = REPORT_STAGE_KEYS.map((stageKey): BaseStageSummary => {
    const stages = periodProjects.flatMap((project) => project.stages.filter((stage) => stage.stageKey === stageKey))
    const completed = stages.filter((stage) => stage.completedAt && stagePointIndex(stage.completedAt) >= rangeStart && stagePointIndex(stage.completedAt) <= cutoff)
    const durations = completed.flatMap((stage) => stage.durationSegments === null ? [] : [stage.durationSegments])
    const actualEfforts = completed.flatMap((stage) => stage.actualEffortHalfDayUnits === null ? [] : [stage.actualEffortHalfDayUnits])
    const scheduled = stages.filter((stage) => stage.varianceInPeriod)
    const dueSchedules = scheduled.filter((stage) => stage.varianceDeadlineAt && stagePointIndex(stage.varianceDeadlineAt) <= cutoff)
    const delayed = dueSchedules.flatMap((stage) => stage.varianceState === 'late_completed' && stage.varianceSegments !== null ? [stage.varianceSegments] : [])
    return {
      stageKey,
      completedCount: completed.length,
      durations,
      actualEfforts,
      scheduledSampleCount: scheduled.length,
      notDueSampleCount: scheduled.filter((stage) => stage.varianceState === 'not_due').length,
      delayedCompletedCount: delayed.length,
      openOverdueCount: dueSchedules.filter((stage) => stage.varianceState === 'overdue_open').length,
      delays: delayed
    }
  })
  const publishing = periodProjects.flatMap((periodProject) => {
    const stage = periodProject.stages.find((item) => item.stageKey === 'publishing' && item.completedAt)
    return stage?.completedAt && stagePointIndex(stage.completedAt) >= rangeStart && stagePointIndex(stage.completedAt) <= cutoff
      ? [{ periodProject, completedAt: stage.completedAt }]
      : []
  })
  const publishedProjects = publishing.flatMap(({ periodProject, completedAt }): CreationReportPublishedProject[] => {
    const project = projectMap.get(periodProject.projectId)
    if (!project) return []
    const projectStages = periodProject.stages
    const summary = lifecycleSummary(projectStages, 'published', completedAt)
    return [{
      projectId: project.id,
      title: project.title,
      colorToken: project.colorToken,
      contentTypeId: project.contentTypeId ?? '',
      contentTypeName: project.contentTypeName ?? '未分类',
      platformTargets: project.platformTargets ?? [],
      publishedAt: completedAt,
      projectDurationSegments: summary.duration,
      projectDurationLabel: formatReportDuration(summary.duration),
      actualEffortHalfDayUnits: summary.effort,
      actualEffortStageCount: summary.effortCount,
      delayedStageCount: projectStages.filter((stage) => stage.varianceState === 'late_completed').length
    }]
  }).sort((left, right) => stagePointIndex(right.publishedAt) - stagePointIndex(left.publishedAt))
  return { period: input.period, publishedProjects, stageSummaries }
}

export function buildCreationReportPayload(input: CreationReportBuildInput): CreationReportPayloadV2 {
  const period = resolveCreationReportPeriod(input.kind, input.anchorDate)
  const previousPeriod = previousCreationReportPeriod(period)
  const calculatedThrough = stagePointIndex(input.asOf) < stagePointIndex({ localDate: period.endDate, segment: 'evening' })
    ? input.asOf
    : { localDate: period.endDate, segment: 'evening' as const }
  const current = buildBaseMetrics({ ...input, period, asOf: calculatedThrough })
  const previousCutoff = { localDate: previousPeriod.endDate, segment: 'evening' as const }
  const previous = buildBaseMetrics({ ...input, period: previousPeriod, asOf: previousCutoff })
  const projectDurations = current.publishedProjects.flatMap((project) => project.projectDurationSegments === null ? [] : [project.projectDurationSegments])
  const previousProjectDurations = previous.publishedProjects.flatMap((project) => project.projectDurationSegments === null ? [] : [project.projectDurationSegments])
  const averageProjectDurationSegments = average(projectDurations)
  const previousAverageProjectDuration = average(previousProjectDurations)
  const stageSummaries: CreationReportStageSummary[] = current.stageSummaries.map((summary) => {
    const previousSummary = previous.stageSummaries.find((item) => item.stageKey === summary.stageKey)!
    const averageDurationSegments = average(summary.durations); const previousAverageDurationSegments = average(previousSummary.durations)
    return {
      stageKey: summary.stageKey,
      completedCount: summary.completedCount,
      durationSampleCount: summary.durations.length,
      averageDurationSegments,
      averageDurationLabel: formatReportDuration(averageDurationSegments),
      actualEffortSampleCount: summary.actualEfforts.length,
      totalActualEffortHalfDayUnits: summary.actualEfforts.reduce((sum, value) => sum + value, 0),
      averageActualEffortHalfDayUnits: average(summary.actualEfforts),
      scheduledSampleCount: summary.scheduledSampleCount,
      notDueSampleCount: summary.notDueSampleCount,
      delayedCompletedCount: summary.delayedCompletedCount,
      openOverdueCount: summary.openOverdueCount,
      averageDelaySegments: average(summary.delays),
      averageDelayLabel: formatReportDuration(average(summary.delays)),
      previousAverageDurationSegments,
      durationDeltaSegments: averageDurationSegments !== null && previousAverageDurationSegments !== null ? round(averageDurationSegments - previousAverageDurationSegments, 2) : null
    }
  })
  return {
    version: 2,
    period,
    calculatedThrough,
    timeZone: input.timeZone,
    periodProjects: buildPeriodProjects(input, period, calculatedThrough),
    publishedCount: current.publishedProjects.length,
    projectDurationSampleCount: projectDurations.length,
    averageProjectDurationSegments,
    averageProjectDurationLabel: formatReportDuration(averageProjectDurationSegments),
    completedStageCount: stageSummaries.reduce((sum, item) => sum + item.completedCount, 0),
    durationStageSampleCount: stageSummaries.reduce((sum, item) => sum + item.durationSampleCount, 0),
    actualEffortStageSampleCount: stageSummaries.reduce((sum, item) => sum + item.actualEffortSampleCount, 0),
    delayedCompletedCount: stageSummaries.reduce((sum, item) => sum + item.delayedCompletedCount, 0),
    openOverdueCount: stageSummaries.reduce((sum, item) => sum + item.openOverdueCount, 0),
    publishedProjects: current.publishedProjects,
    stageSummaries,
    comparison: {
      periodLabel: previousPeriod.label,
      publishedCount: previous.publishedProjects.length,
      publishedCountDelta: current.publishedProjects.length - previous.publishedProjects.length,
      averageProjectDurationSegments: previousAverageProjectDuration,
      averageProjectDurationDeltaSegments: averageProjectDurationSegments !== null && previousAverageProjectDuration !== null ? round(averageProjectDurationSegments - previousAverageProjectDuration, 2) : null
    }
  }
}

export function buildProjectCreationReview(input: ProjectCreationReviewBuildInput): ProjectCreationReview {
  const records = input.stageRecords.filter((record) => record.projectId === input.project.id)
  const schedules = input.schedules.filter((schedule) => schedule.projectId === input.project.id)
  const baselines = (input.baselines ?? []).filter(item => item.projectId === input.project.id)
  const modules = projectModules(input.project, records, [...schedules, ...baselines.flatMap(item => item.schedules)])
  const stages: ProjectCreationReviewStage[] = modules.map((module) => {
    const record = records.find((item) => item.stageKey === module.stageKey)
    const plan = buildStageScheduleWindow(schedules.filter((item) => item.actionType === module.stageKey), input.timeZone)
    const status = record?.status ?? 'not_started'
    const completedAt = record?.completedAt ?? null
    const original = baselines.find(item => item.stageKey === module.stageKey)
    const baselinePlan = original ? buildStageScheduleWindow(original.schedules, input.timeZone) : null
    return {
      baseline: original && baselinePlan ? {
        source: original.source, capturedAt: original.capturedAt, ...baselinePlan,
        startVarianceSegments: startVarianceFor(status === 'skipped' ? null : record?.startedAt ?? null, original.schedules, input.timeZone),
        ...varianceFor(status, completedAt, baselinePlan.varianceDeadlineAt, input.asOf)
      } : null,
      startVarianceSegments: startVarianceFor(status === 'skipped' ? null : record?.startedAt ?? null, schedules.filter(item => item.actionType === module.stageKey), input.timeZone),
      stageKey: module.stageKey,
      enabled: module.enabled,
      position: module.position,
      status,
      startedAt: record?.startedAt ?? null,
      completedAt,
      durationSegments: record?.durationSegments ?? null,
      elapsedSegments: !completedAt && record?.startedAt ? Math.max(0, stagePointIndex(input.asOf) - stagePointIndex(record.startedAt)) : null,
      actualEffortHalfDayUnits: record?.actualEffortHalfDayUnits ?? null,
      plannedStartAt: plan.plannedStartAt,
      plannedEndAt: plan.plannedEndAt,
      varianceDeadlineAt: plan.varianceDeadlineAt,
      ...varianceFor(status, completedAt, plan.varianceDeadlineAt, input.asOf)
    }
  })
  const lifecycleStartedAt = stages.flatMap((stage) => stage.startedAt ? [stage.startedAt] : [])
    .sort((left, right) => stagePointIndex(left) - stagePointIndex(right))[0] ?? null
  const publishing = stages.find((stage) => stage.stageKey === 'publishing' && stage.completedAt)
  const lifecycleEndedAt = publishing?.completedAt ?? (input.project.status === 'archived' ? null : input.asOf)
  const lifecycleEndKind: ProjectCreationReview['lifecycleEndKind'] = publishing
    ? 'published'
    : input.project.status === 'archived'
      ? 'archived_without_publish'
      : !lifecycleStartedAt ? 'missing_start' : 'ongoing'
  const lifecycleDurationSegments = lifecycleStartedAt && lifecycleEndedAt && stagePointIndex(lifecycleStartedAt) <= stagePointIndex(lifecycleEndedAt)
    ? stagePointIndex(lifecycleEndedAt) - stagePointIndex(lifecycleStartedAt)
    : null
  const publishingPosition = stages.find((stage) => stage.stageKey === 'publishing')?.position ?? Number.POSITIVE_INFINITY
  const effortStages = stages.filter((stage) => stage.actualEffortHalfDayUnits !== null && (!publishing || stage.position <= publishingPosition))
  const varianceStages = stages.filter((stage) => stage.varianceSegments !== null)
    .sort((left, right) => Math.abs(right.varianceSegments!) - Math.abs(left.varianceSegments!) || left.position - right.position)
  return {
    projectId: input.project.id,
    title: input.project.title,
    colorToken: input.project.colorToken,
    projectStatus: input.project.status ?? 'preparing',
    lifecycleStartedAt,
    lifecycleEndedAt,
    lifecycleDurationSegments,
    lifecycleOngoing: lifecycleEndKind === 'ongoing',
    lifecycleEndKind,
    summaryActualEffortHalfDayUnits: effortStages.reduce((sum, stage) => sum + (stage.actualEffortHalfDayUnits ?? 0), 0),
    summaryActualEffortStageCount: effortStages.length,
    completeTimeSampleCount: stages.filter((stage) => stage.startedAt && stage.completedAt).length,
    completedStageCount: stages.filter((stage) => stage.status === 'completed').length,
    largestAbsoluteVarianceStageKey: varianceStages[0]?.stageKey ?? null,
    largestAbsoluteVarianceSegments: varianceStages[0]?.varianceSegments ?? null,
    stages,
    calculatedAt: input.calculatedAt,
    calculatedThrough: input.asOf,
    timeZone: input.timeZone
  }
}
