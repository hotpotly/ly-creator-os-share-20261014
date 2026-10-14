import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { formatTodoDuration, todoDurationMinutes } from '../../src/shared/todo-duration'
import type { CreateTodoInput } from '../../src/shared/domain'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const directories: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-todo-'))
  directories.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => {
  delete process.env.CREATOR_OS_TEST_STAGE_DATETIME
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const input = (patch: Partial<CreateTodoInput> = {}): CreateTodoInput => ({ title: '修改开头(2)', plannedDate: '2026-09-11', segment: null, category: 'self_media', projectId: 'ios', stageKey: 'script', trackingMode: 'checklist', progress: 0, ...patch })

describe('R21n linked todo stages', () => {
  it('migrates legacy rows without inferring a stage or hours', () => {
    const db = new Database(':memory:')
    runMigrationsThrough(db, '0089_r21i_daily_total_minutes')
    db.prepare("INSERT INTO todo_items(id,title,category,status,tracking_mode,source,created_at,updated_at) VALUES(?,?,'life','open','checklist','manual','2026-09-11','2026-09-11')").run(randomUUID(), '跑步(0.5)')
    runMigrations(db); runMigrations(db)
    expect(db.prepare('SELECT stage_key FROM todo_items').get()).toEqual({ stage_key: null })
    db.close()
  })
  it('preserves stage links across reopen and clears them when moving or unlinking the project', async () => {
    const { store, directory } = await createStore()
    const [todo] = store.repository.createTodoItems([input()])
    expect(todo!.stageKey).toBe('script')
    expect(store.repository.updateTodoItem(todo!.id, { projectId: 'ai-browser' }).stageKey).toBeNull()
    expect(store.repository.updateTodoItem(todo!.id, { projectId: 'ios', stageKey: 'script' }).stageKey).toBe('script')
    expect(store.repository.updateTodoItem(todo!.id, { projectId: null }).stageKey).toBeNull()
    expect(() => store.repository.updateTodoItem(todo!.id, { stageKey: 'script' })).toThrow('请先关联项目')
    store.repository.updateTodoItem(todo!.id, { projectId: 'ios', stageKey: 'script' })
    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.listTodoItems().find((item) => item.id === todo!.id)?.stageKey).toBe('script')
    reopened.close()
  })
  it('does not count title edits twice or move an undated completed todo to the edit day', async () => {
    const { store } = await createStore()
    const [todo] = store.repository.createTodoItems([input({ plannedDate: null, progress: 100 })])
    const stage = store.repository.getProject('ios', false).stageTimeRecords
    const edited = store.repository.updateTodoItem(todo!.id, { title: '修改开头（3.5）' })
    expect(edited.completedAt).toBe(todo!.completedAt)
    expect(formatTodoDuration(edited.title)).toBe('3小时30分钟')
    expect(store.repository.listTodoItems()).toHaveLength(1)
    expect(store.repository.getProject('ios', false).stageTimeRecords).toEqual(stage)
    store.close()
  })
  it('keeps hidden links readable but rejects newly binding or completing hidden stages', async () => {
    const { store } = await createStore()
    const [todo] = store.repository.createTodoItems([input()])
    store.repository.setModule('ios', 'script', false)
    expect(store.repository.updateTodoItem(todo!.id, { title: '修改正文(3)' }).stageKey).toBe('script')
    expect(() => store.repository.createTodoItems([input()])).toThrow('阶段不存在或已隐藏')
    expect(() => store.repository.createTodoItems([input({ stageKey: 'feedback' })])).toThrow()
    expect(store.repository.updateTodoItem(todo!.id, { stageKey: null }).stageKey).toBeNull()
    store.close()
  })
  it('requires confirmation of the current open set, keeps todos and schedules untouched, supports retry and reopen', async () => {
    const { store } = await createStore()
    store.repository.setModuleCompleted('ios', 'script', false)
    const [todo] = store.repository.createTodoItems([input()])
    const beforeSchedules = store.repository.listScheduleItems()
    const base = { todoId: todo!.id, projectId: 'ios', stageKey: 'script' as const, expectedCompletedAt: null, completed: true, requestId: randomUUID() }
    expect(() => store.repository.setTodoLinkedStageCompleted(base)).toThrow('未完成待办')
    const [second] = store.repository.createTodoItems([input({ title: '另一条' })])
    expect(() => store.repository.setTodoLinkedStageCompleted({ ...base, confirmedOpenTodoIds: [todo!.id] })).toThrow('清单已变化')
    expect(store.repository.setTodoLinkedStageCompleted({ ...base, confirmedOpenTodoIds: [todo!.id, second!.id] })).toBe(true)
    const completedAt = store.repository.getTodoProjectStages('ios').find((stage) => stage.key === 'script')!.completedAt
    expect(completedAt).toBeTruthy()
    expect(store.repository.listTodoItems().every((item) => item.status === 'open')).toBe(true)
    expect(store.repository.listScheduleItems()).toEqual(beforeSchedules)
    store.repository.setTodoLinkedStageCompleted({ ...base, requestId: randomUUID() })
    expect(store.repository.getTodoProjectStages('ios').find((stage) => stage.key === 'script')!.completedAt).toBe(completedAt)
    expect(() => store.repository.setTodoLinkedStageCompleted({ ...base, completed: false })).toThrow('状态已变化')
    store.repository.setTodoLinkedStageCompleted({ ...base, completed: false, expectedCompletedAt: completedAt, requestId: randomUUID() })
    expect(store.repository.getTodoProjectStages('ios').find((stage) => stage.key === 'script')!.completedAt).toBeNull()
    store.repository.updateTodoItem(todo!.id, { projectId: 'ai-browser' })
    expect(() => store.repository.setTodoLinkedStageCompleted(base)).toThrow('关联已变化')
    store.close()
  })
  it('reads only the final numeric suffix and distinguishes missing from zero', () => {
    expect(todoDurationMinutes('工作(2)')).toBe(120)
    expect(todoDurationMinutes('跑步（0.5）')).toBe(30)
    expect(todoDurationMinutes('写方案(0)')).toBe(0)
    for (const title of ['项目2026', '修改(版本2)', '工作(2)明天', '工作(-2)', '没填']) expect(todoDurationMinutes(title)).toBeNull()
    expect(formatTodoDuration('修改(1)(3)')).toBe('3小时')
  })
})

describe('R21r explicit stage start confirmation', () => {
 it('linking does nothing; first completion suggests its own date; confirmation starts only that stage', async () => {
   process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-14T10:00:00'
   const {store} = await createStore(), repo = store.repository
   repo.setModuleCompleted('ios','script',false)
   repo.updateStageTime('ios','script',{startedAt:null,completedAt:null,source:'manual'})
   const [todo] = repo.createTodoItems([input({plannedDate:'2026-08-01',segment:'afternoon'})])
   expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
   repo.updateTodoItem(todo!.id,{completed:true})
   expect(repo.getProject('ios',false).stageTimeRecords.find(r=>r.stageKey==='script')?.startedAt).toBeNull()
   expect(repo.getTodoStageStartCandidate(todo!.id)).toMatchObject({plannedDate:'2026-08-01',segment:'afternoon'})
   const start={expectedTitle:todo!.title,expectedLinkedStageKey:todo!.stageKey ?? null,expectedStageLinkSource:todo!.stageLinkSource ?? null,todoId:todo!.id,projectId:'ios',stageKey:'script' as const,expectedPlannedDate:'2026-08-01',expectedSegment:'afternoon' as const,startedAt:{localDate:'2026-07-31',segment:'afternoon' as const},requestId:randomUUID()}
   expect(repo.confirmTodoStageStart(start)).toBe(true)
   const record = repo.getProject('ios',false).stageTimeRecords.find(r=>r.stageKey==='script')!
   expect(record).toMatchObject({startedAt:start.startedAt,status:'in_progress',completedAt:null,startSource:'manual'})
   expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
   expect(()=>repo.confirmTodoStageStart({...start,startedAt:{localDate:'2026-07-30',segment:'morning'},requestId:randomUUID()})).toThrow('已变化')
   repo.updateTodoItem(todo!.id,{projectId:'ai-browser',stageKey:null})
   expect(repo.getProject('ios',false).stageTimeRecords.find(r=>r.stageKey==='script')?.startedAt).toEqual(start.startedAt)
   store.close()
 })
 it('stale associations/dates, undoing completion and subsequent completions cannot silently start a stage', async () => {
   const {store} = await createStore(), repo=store.repository
   repo.setModuleCompleted('ios','script',false)
   repo.updateStageTime('ios','script',{startedAt:null,completedAt:null,source:'manual'})
   const [todo] = repo.createTodoItems([input({progress:100})])
   const start={expectedTitle:todo!.title,expectedLinkedStageKey:todo!.stageKey ?? null,expectedStageLinkSource:todo!.stageLinkSource ?? null,todoId:todo!.id,projectId:'ios',stageKey:'script' as const,expectedPlannedDate:todo!.plannedDate,expectedSegment:null,startedAt:{localDate:'2026-08-01',segment:'morning' as const},requestId:randomUUID()}
   repo.updateTodoItem(todo!.id,{plannedDate:'2026-08-02'})
   expect(()=>repo.confirmTodoStageStart(start)).toThrow('已变化')
   repo.updateTodoItem(todo!.id,{plannedDate:todo!.plannedDate,completed:false})
   expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
   repo.updateTodoItem(todo!.id,{completed:true,projectId:'ai-browser',stageKey:null})
   expect(()=>repo.confirmTodoStageStart(start)).toThrow('已变化')
   repo.updateTodoItem(todo!.id,{projectId:'ios',stageKey:'script'})
   repo.createTodoItems([input({progress:100})])
   expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
   store.close()
 })
})

describe('R21s text recommendation and confirmed correction', () => {
  const confirmation = (candidate: NonNullable<ReturnType<WorkspaceStore['repository']['getTodoStageStartCandidate']>>, stageKey: 'editing' | 'shooting' = 'editing') => ({
    todoId: candidate.todoId, projectId: candidate.projectId, stageKey,
    expectedTitle: candidate.title, expectedLinkedStageKey: candidate.linkedStageKey,
    expectedStageLinkSource: candidate.stageLinkSource, expectedPlannedDate: candidate.plannedDate,
    expectedSegment: candidate.segment, startedAt: { localDate: '2026-09-10', segment: 'morning' as const }, requestId: randomUUID()
  })
  async function setup() {
    process.env.CREATOR_OS_TEST_STAGE_DATETIME = '2026-09-14T10:00:00'
    const result = await createStore()
    for (const key of ['shooting', 'editing'] as const) {
      result.store.repository.setModule('ios', key, true)
      result.store.repository.setModuleCompleted('ios', key, false)
      result.store.repository.updateStageTime('ios', key, { startedAt: null, completedAt: null, source: 'manual' })
    }
    return result
  }
  it('migrates old links as unknown without inventing manual provenance', () => {
    const db = new Database(':memory:')
    runMigrationsThrough(db, '0091_r21p_split_production_stages')
    db.prepare("INSERT INTO todo_items(id,title,stage_key,category,status,tracking_mode,source,created_at,updated_at) VALUES(?,?,'shooting','self_media','open','checklist','manual','2026-09-11','2026-09-11')").run(randomUUID(), '录音＋剪(1)')
    runMigrations(db); runMigrations(db)
    expect(db.prepare('SELECT stage_key,stage_link_source FROM todo_items').get()).toEqual({ stage_key: 'shooting', stage_link_source: null })
    db.close()
  })
  it('corrects the legacy screenshot only on confirmation; failure rolls back link and dates', async () => {
    const { store, directory } = await setup(), repo = store.repository
    const [todo] = repo.createTodoItems([input({ title: '19 DemoOS17录音+剪 (1)', stageKey: 'shooting', progress: 100 })])
    const db = new Database(join(directory, 'creator-os.sqlite3'))
    db.prepare('UPDATE todo_items SET stage_link_source=NULL WHERE id=?').run(todo!.id); db.close()
    const before = repo.getProject('ios', false).stageTimeRecords
    const candidate = repo.getTodoStageStartCandidate(todo!.id)!
    expect(candidate).toMatchObject({ stageKey: 'editing', linkedStageKey: 'shooting', reason: 'text' })
    expect(repo.listTodoItems()[0]!.stageKey).toBe('shooting')
    expect(repo.getProject('ios', false).stageTimeRecords).toEqual(before)
    const start = confirmation(candidate)
    expect(() => repo.confirmTodoStageStart({ ...start, startedAt: { localDate: '2099-01-01', segment: 'morning' } })).toThrow()
    expect(repo.listTodoItems()[0]).toMatchObject({ stageKey: 'shooting', stageLinkSource: null })
    expect(repo.getProject('ios', false).stageTimeRecords).toEqual(before)
    expect(repo.confirmTodoStageStart({ ...start, requestId: randomUUID() })).toBe(true)
    expect(repo.listTodoItems()[0]).toMatchObject({ stageKey: 'editing', stageLinkSource: 'manual', status: 'completed' })
    const after = repo.getProject('ios', false).stageTimeRecords
    expect(after.find(r => r.stageKey === 'editing')?.startedAt).toEqual(start.startedAt)
    expect(after.find(r => r.stageKey === 'shooting')).toEqual(before.find(r => r.stageKey === 'shooting'))
    store.close()
  })
  it('keeps explicit manual choices, but allows an explicit correction', async () => {
    const { store } = await setup(), repo = store.repository
    const [todo] = repo.createTodoItems([input({ title: '录音＋剪(1)', stageKey: 'shooting', progress: 100 })])
    const candidate = repo.getTodoStageStartCandidate(todo!.id)!
    expect(candidate).toMatchObject({ stageKey: 'shooting', recommendedStageKey: 'editing', reason: 'manual' })
    repo.updateTodoItem(todo!.id, { title: '精剪(3)' })
    expect(() => repo.confirmTodoStageStart(confirmation(candidate))).toThrow('已变化')
    const next = repo.getTodoStageStartCandidate(todo!.id)!
    expect(next.stageKey).toBe('shooting')
    repo.confirmTodoStageStart(confirmation(next))
    expect(repo.listTodoItems()[0]!.stageKey).toBe('editing')
    expect(repo.getProject('ios', false).stageTimeRecords.find(r => r.stageKey === 'shooting')?.startedAt).toBeNull()
    store.close()
  })
  it('recommends for project-only links; ambiguous tasks require a stage; stale manual choices reject', async () => {
    const { store } = await setup(), repo = store.repository
    const [todo] = repo.createTodoItems([input({ title: '录音+剪(1)', stageKey: null, progress: 100 })])
    expect(repo.getTodoStageStartCandidate(todo!.id)).toMatchObject({ stageKey: 'editing', linkedStageKey: null })
    repo.updateTodoItem(todo!.id, { title: '拍摄+剪辑(1)' })
    const candidate = repo.getTodoStageStartCandidate(todo!.id)!
    expect(candidate).toMatchObject({ stageKey: null, reason: 'ambiguous' })
    repo.updateTodoItem(todo!.id, { stageKey: 'shooting' })
    expect(() => repo.confirmTodoStageStart(confirmation(candidate))).toThrow('已变化')
    repo.updateTodoItem(todo!.id, { stageKey: null, title: '继续弄一下(2)' })
    expect(repo.getTodoStageStartCandidate(todo!.id)).toMatchObject({ stageKey: null, reason: 'unknown' })
    repo.confirmTodoStageStart(confirmation(repo.getTodoStageStartCandidate(todo!.id)!))
    expect(repo.listTodoItems()[0]!.stageKey).toBe('editing')
    store.close()
  })
  it('does not repeat an editing offer for later project-only completed tasks after postponing', async () => {
    const { store } = await setup(), repo = store.repository
    const [first] = repo.createTodoItems([input({ title: '粗剪(1)', stageKey: null, progress: 100 })])
    expect(repo.getTodoStageStartCandidate(first!.id)?.stageKey).toBe('editing')
    const [second] = repo.createTodoItems([input({ title: '精剪(2)', stageKey: null, progress: 100 })])
    expect(repo.getTodoStageStartCandidate(second!.id)).toBeNull()
    expect(repo.listTodoItems().every(t => !t.stageKey)).toBe(true)
    store.close()
  })
  it('offers only substantial stages and rejects excluded targets without changing project stages or links', async () => {
    const { store } = await setup(), repo = store.repository
    const [todo] = repo.createTodoItems([input({ title: '处理一下(1)', stageKey: null, progress: 100 })])
    const before = repo.getProject('ios', false)
    const candidate = repo.getTodoStageStartCandidate(todo!.id)!
    expect(candidate.availableStageKeys.length).toBeGreaterThan(0)
    expect(candidate.availableStageKeys.every(key => ['materials', 'outline', 'script', 'shooting', 'editing'].includes(key))).toBe(true)
    for (const stageKey of ['postproduction', 'publishing', 'versions'] as const) {
      expect(() => repo.confirmTodoStageStart({ ...confirmation(candidate), stageKey })).toThrow('已变化')
      repo.updateTodoItem(todo!.id, { stageKey })
      expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
      expect(repo.listTodoItems()[0]!.stageKey).toBe(stageKey)
    }
    expect(repo.getProject('ios', false).modules).toEqual(before.modules)
    expect(repo.getProject('ios', false).stageTimeRecords).toEqual(before.stageTimeRecords)
    store.close()
  })
  it.each(['做字幕(0.1)', '做封面(0.2)', '上传视频(0.1)', '发布(0.1)', '整理版本(0.1)'])('does not ask to start a short-work stage: %s', async title => {
    const { store } = await setup(), repo = store.repository
    const [todo] = repo.createTodoItems([input({ title, stageKey: null, progress: 100 })])
    expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
    expect(repo.listTodoItems()[0]!.stageKey).toBeNull()
    store.close()
  })
  it('never recommends a hidden, started, completed or already-worked target as another stage', async () => {
    const { store } = await setup(), repo = store.repository
    const [todo] = repo.createTodoItems([input({ title: '精剪(1)', stageKey: null, progress: 100 })])
    repo.setModule('ios', 'editing', false)
    expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
    repo.setModule('ios', 'editing', true)
    const stale = repo.getTodoStageStartCandidate(todo!.id)!
    repo.updateStageTime('ios', 'editing', { startedAt: { localDate: '2026-09-01', segment: 'morning' }, source: 'manual' })
    expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
    expect(() => repo.confirmTodoStageStart(confirmation(stale))).toThrow('已变化')
    repo.setModuleCompleted('ios', 'editing', true)
    expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
    repo.setModuleCompleted('ios', 'editing', false)
    repo.updateStageTime('ios', 'editing', { startedAt: null, completedAt: null, source: 'manual' })
    repo.createTodoItems([input({ stageKey: 'editing', progress: 100 })])
    expect(repo.getTodoStageStartCandidate(todo!.id)).toBeNull()
    expect(repo.listTodoItems().find(t => t.id === todo!.id)?.stageKey).toBeNull()
    store.close()
  })
})
