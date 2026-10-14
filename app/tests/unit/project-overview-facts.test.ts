import { describe, expect, it } from 'vitest'
import type { DraftVersion, ProjectDetail, ProjectModule, StageTimeRecord } from '../../src/shared/domain'
import { projectOverviewFacts, projectStageProgress } from '../../src/renderer/src/utils/project-overview-facts'
const module = (key: ProjectModule['key'], enabled = true, done = false): ProjectModule => ({ key, enabled, completedAt: done ? '2026-09-13' : null } as ProjectModule)
const record = (stageKey: StageTimeRecord['stageKey'], day: string | null): StageTimeRecord => ({ stageKey, startedAt: day ? { localDate: day, segment: 'morning' } : null, plannedStartedAt: { localDate: '2020-01-01', segment: 'morning' } } as StageTimeRecord)
const project = (patch: Partial<ProjectDetail> = {}): ProjectDetail => ({ id:'p', modules:[], stageTimeRecords:[], versions:[], ...patch } as ProjectDetail)
describe('project overview read-only facts', () => {
 it('counts enabled stages and versions but not old combined/business records', () => {
  expect(projectStageProgress(project({ modules:[module('materials'),module('shooting',true,true),module('versions',true,true),module('script',false,true),module('production',true,true),module('business',true,true),module('overview')] }))).toEqual({total:3,completed:2})
 })
 it('leaves missing actual dates and empty data unset instead of using planned dates', () => {
  const result=projectOverviewFacts(project({stageTimeRecords:[record('shooting',null)]}),[],'2026-09-13')
  expect(result).toMatchObject({start:null,elapsedDays:null,todoTotal:0,versionCount:0,total:0})
 })
 it('uses earliest actual date including preserved history and handles leap days', () => {
  const result=projectOverviewFacts(project({stageTimeRecords:[record('shooting','2024-03-01'),record('production','2024-02-28')]}),[],'2024-03-01')
  expect(result).toMatchObject({start:'2024-02-28',elapsedDays:2})
 })
 it('uses calendar days across year/DST changes, allowing same or future dates', () => {
  expect(projectOverviewFacts(project({stageTimeRecords:[record('script','2025-12-31')]}),[],'2026-01-01').elapsedDays).toBe(1)
  expect(projectOverviewFacts(project({stageTimeRecords:[record('script','2026-03-08')]}),[],'2026-03-09').elapsedDays).toBe(1)
  expect(projectOverviewFacts(project({stageTimeRecords:[record('script','2026-09-13')]}),[],'2026-09-13').elapsedDays).toBe(0)
  expect(projectOverviewFacts(project({stageTimeRecords:[record('script','2026-09-14')]}),[],'2026-09-13').elapsedDays).toBe(-1)
 })
 it('counts linked manual tasks across dates, not other projects/dismissed/system tasks', () => {
  const result=projectOverviewFacts(project(),[{projectId:'p',source:'manual',status:'open'},{projectId:'p',source:'manual',status:'completed'},{projectId:'p',source:'manual',status:'dismissed'},{projectId:'other',source:'manual',status:'completed'},{projectId:'p',source:'schedule',status:'completed'}],'2026-09-13')
  expect(result).toMatchObject({todoTotal:2,todoCompleted:1,completed:0})
 })
 it('reports saved version count and newest actual record without mutating input', () => {
  const versions=[{id:'a',createdAt:'2026-01-01T00:00:00Z'},{id:'b',createdAt:'2026-01-03T00:00:00Z'}] as DraftVersion[]
  const result=projectOverviewFacts(project({versions}),[],'2026-09-13')
  expect(result.versionCount).toBe(2);expect(result.latestVersion?.id).toBe('b');expect(versions[0]?.id).toBe('a')
 })
})
