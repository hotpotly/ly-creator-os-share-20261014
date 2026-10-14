import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { seedWorkspace } from '../../src/main/db/seed'
import { WorkspaceRepository } from '../../src/main/db/repository'

describe('R21p production split', () => {
  it('preserves old facts, children, constraints and totals with an idempotent migration', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrationsThrough(db, '0090_r21n_todo_stage_link')
    seedWorkspace(db, true)
    const repo = new WorkspaceRepository(db)
    db.prepare("UPDATE stage_time_records SET status='in_progress',started_date='2025-09-01',started_segment='morning',start_source='backfill',actual_effort_half_day_units=2 WHERE project_id='ios' AND stage_key='production'").run()
    // Seed the historical shape directly; today's repository requires today's schema.
    const todo = { id: randomUUID(), title: '旧剪辑(2)', status: 'completed', progress: 100, stageKey: 'production' }
    db.prepare(`INSERT INTO todo_items(id,title,planned_date,project_id,stage_key,category,status,tracking_mode,progress,source,created_at,updated_at,completed_at)
      VALUES(?,?,'2026-09-02','ios','production','self_media','completed','checklist',100,'manual','2026-09-02','2026-09-02','2026-09-02')`).run(todo.id,todo.title)
    db.prepare("INSERT INTO todo_events(id,todo_id,action,after_json,recorded_at) VALUES(?,?,'completed',?,'2026-09-02')").run(randomUUID(),todo.id,JSON.stringify(todo))
    db.prepare("INSERT INTO todo_daily_snapshots(todo_id,day,ending_status,ending_progress,progress_delta,recorded_at) VALUES(?,'2026-09-02','completed',100,100,'2026-09-02')").run(todo.id)
    const beforeRecord = db.prepare("SELECT * FROM stage_time_records WHERE project_id='ios' AND stage_key='production'").get()
    const beforeEvents = db.prepare('SELECT * FROM stage_time_events').all()
    const beforeTodo = db.prepare('SELECT * FROM todo_items WHERE id=?').get(todo!.id)
    const beforeTodoEvents = db.prepare('SELECT * FROM todo_events').all()
    const beforeSnapshots = db.prepare('SELECT * FROM todo_daily_snapshots').all()
    runMigrations(db);runMigrations(db)
    expect(db.prepare("SELECT * FROM stage_time_records WHERE project_id='ios' AND stage_key='production'").get()).toEqual(beforeRecord)
    expect(db.prepare('SELECT * FROM stage_time_events').all()).toEqual(beforeEvents)
    expect(db.prepare('SELECT * FROM todo_events').all()).toEqual(beforeTodoEvents)
    expect(db.prepare('SELECT * FROM todo_daily_snapshots').all()).toEqual(beforeSnapshots)
    expect(db.prepare('SELECT * FROM todo_items WHERE id=?').get(todo!.id)).toEqual({ ...beforeTodo as object, stage_link_source: null, date_range_json: null, is_extra: 0 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('foreign_keys',{simple:true})).toBe(1)
    const project=repo.getProject('ios',false)
    for (const key of ['shooting','editing']) {
      expect(project.modules.find(m=>m.key===key)?.enabled).toBe(true)
      expect(project.stageTimeRecords.find(r=>r.stageKey===key)).toMatchObject({status:'not_started',startedAt:null,completedAt:null,actualEffortHalfDayUnits:null})
    }
    expect(project.modules.find(m=>m.key==='production')?.enabled).toBe(false)
    expect(repo.updateTodoItem(todo!.id,{stageKey:'editing'}).stageKey).toBe('editing')
    expect(repo.updateTodoItem(todo!.id,{projectId:null}).stageKey).toBeNull()
    expect(()=>db.prepare("UPDATE todo_items SET stage_key='invalid' WHERE id=?").run(todo!.id)).toThrow()
    expect(project.stageTimeRecords.find(r=>r.stageKey==='production')?.actualEffortHalfDayUnits).toBe(2)
    expect(repo.updateStageTime('ios','production',{actualEffortHalfDayUnits:3,source:'backfill'}).record.actualEffortHalfDayUnits).toBe(3)
    db.close()
  })
  it('new projects have two independent stages and no merged default', () => {
    const db=new Database(':memory:');db.pragma('foreign_keys = ON');runMigrations(db);seedWorkspace(db,true)
    const repo=new WorkspaceRepository(db)
    const project=repo.createProject({title:'独立阶段项目',description:'',contentTypeId:'type-digital',platformTargets:[]})
    expect(project.modules.filter(m=>m.enabled).map(m=>m.key)).toEqual(expect.arrayContaining(['shooting','editing']))
    expect(project.modules.some(m=>m.key==='production')).toBe(false)
    const [todo]=repo.createTodoItems([{title:'拍摄(2)',plannedDate:null,projectId:project.id,stageKey:'shooting',category:'self_media',segment:null,trackingMode:'checklist',progress:0}])
    repo.setModuleCompleted(project.id,'shooting',true)
    expect(repo.getProject(project.id,false).modules.find(m=>m.key==='editing')?.completedAt).toBeNull()
    expect(repo.listTodoItems().find(t=>t.id===todo!.id)?.status).toBe('open')
    const stale=repo.getProjectProductionNotes(project.id)
    repo.setProjectProductionNotes(project.id,{...stale,scope:'editing',editingNotes:'new edit'})
    expect(repo.setProjectProductionNotes(project.id,{...stale,scope:'shooting'}).editingNotes).toBe('new edit')

    db.close()
  })
})
