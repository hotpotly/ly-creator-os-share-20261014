import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import type { CreateTodoInput, TodoTimeMoveInput, TodoItem } from '../../src/shared/domain'
import { todoTimeMovePayloadSchema } from '../../src/shared/ipc'

const stores: WorkspaceStore[] = [], directories: string[] = []
async function setup() {
 const root=join(import.meta.dirname,'../../test-results/unit'); await mkdir(root,{recursive:true})
 const dir=await mkdtemp(join(root,'time-move-')); directories.push(dir)
 const store=await openWorkspaceStore(dir); stores.push(store); return store.repository
}
afterEach(async()=>{ stores.splice(0).forEach(store=>store.close()); await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true}))) })
const create=(patch: Partial<CreateTodoInput>={}): CreateTodoInput => ({title:'精剪(3)',projectId:'ios',stageKey:'editing',plannedDate:'2026-09-15',segment:'afternoon',category:'self_media',trackingMode:'checklist',progress:0,...patch})
const request=(todo: TodoItem, target: TodoItem | null, patch: Partial<TodoTimeMoveInput>={}): TodoTimeMoveInput=>({todoId:todo.id,expectedUpdatedAt:todo.updatedAt,day:'2026-09-15',segment:target?.segment??null,target:target?{todoId:target.id,expectedUpdatedAt:target.updatedAt}:null,after:false,...patch})
describe('atomic time-group sorting',()=>{
 it('moves before/after across segments, preserving hidden date slots and every unrelated field',async()=>{
  const repo=await setup(), [a,h,b,c]=repo.createTodoItems([create({progress:100}),create({plannedDate:'2026-09-16'}),create({title:'文字(1)',segment:'evening'}),create({title:'调色(1)',segment:'evening'})])
  repo.setPreferences({companionTodoOrder:[a!.id,h!.id,b!.id,c!.id]})
  const stages=repo.getProject('ios',false).stageTimeRecords
  repo.moveTodoInTime(request(a!,b!,{after:true}))
  let moved=repo.listTodoItems().find(t=>t.id===a!.id)!
  expect(moved).toEqual({...a,segment:'evening',updatedAt:moved.updatedAt})
  expect(repo.getPreferences().companionTodoOrder).toEqual([b!.id,h!.id,a!.id,c!.id])
  repo.moveTodoInTime(request(moved,b!))
  expect(repo.getPreferences().companionTodoOrder).toEqual([a!.id,h!.id,b!.id,c!.id])
  repo.moveTodoInTime(request(repo.listTodoItems().find(t=>t.id===a!.id)!,null,{segment:'morning'}))
  moved=repo.listTodoItems().find(t=>t.id===a!.id)!
  expect(moved.segment).toBe('morning')
  repo.moveTodoInTime(request(moved,null,{segment:null}))
  expect(repo.listTodoItems().find(t=>t.id===a!.id)?.segment).toBeNull()
  expect(repo.listTodoItems().find(t=>t.id===h!.id)).toEqual(h)
  expect(repo.getProject('ios',false).stageTimeRecords).toEqual(stages)
 })
 it('group background appends to the destination and self-drop is a no-op',async()=>{
  const repo=await setup(), [a,b,c]=repo.createTodoItems([create(),create({segment:'evening'}),create({segment:'evening'})])
  repo.setPreferences({companionTodoOrder:[a!.id,b!.id,c!.id]})
  expect(repo.moveTodoInTime(request(a!,a!))).toBe(false)
  repo.moveTodoInTime(request(a!,null,{segment:'evening'}))
  expect(repo.getPreferences().companionTodoOrder).toEqual([b!.id,c!.id,a!.id])
 })
 it('rejects stale source/target, wrong group/day and dismissed target without saving',async()=>{
  const repo=await setup(), [a,b]=repo.createTodoItems([create(),create({segment:'evening'})])
  const before=repo.getPreferences()
  for(const input of [request(a!,b!,{expectedUpdatedAt:'old'}),request(a!,b!,{target:{todoId:b!.id,expectedUpdatedAt:'old'}}),request(a!,b!,{segment:'morning'}),request(a!,b!,{day:'2026-09-16'}),request(a!,b!,{target:{todoId:randomUUID(),expectedUpdatedAt:'old'}})]) expect(()=>repo.moveTodoInTime(input)).toThrow('已变化')
  repo.dismissTodoItem(b!.id)
  expect(()=>repo.moveTodoInTime(request(a!,b!))).toThrow('已变化')
  expect(repo.getPreferences()).toEqual(before)
  expect(repo.listTodoItems().find(t=>t.id===a!.id)).toEqual(a)
 })
 it('rolls back segment and audit writes if preference save fails',async()=>{
  const repo=await setup(), [a,b]=repo.createTodoItems([create(),create({segment:'evening'})])
  repo.setPreferences({companionTodoOrder:[a!.id,b!.id]})
  const before=repo.getPreferences(), db=new Database(stores.at(-1)!.databasePath)
  const events=db.prepare('SELECT * FROM todo_events ORDER BY id').all()
  try {
   db.exec("CREATE TRIGGER fail_move_test BEFORE UPDATE ON preferences BEGIN SELECT RAISE(ABORT,'injected order failure'); END")
   expect(()=>repo.moveTodoInTime(request(a!,b!))).toThrow('injected order failure')
   expect(repo.listTodoItems().find(t=>t.id===a!.id)).toEqual(a)
   expect(repo.getPreferences()).toEqual(before)
   expect(db.prepare('SELECT * FROM todo_events ORDER BY id').all()).toEqual(events)
  } finally {db.close()}
 })
 it('rejects widened or invalid IPC payloads',()=>{
  const input=request({id:randomUUID(),updatedAt:'date'} as TodoItem,null)
  expect(todoTimeMovePayloadSchema.safeParse(input).success).toBe(true)
  for(const patch of [{completed:true},{segment:'night'},{day:'bad'},{target:{todoId:'bad'}}]) expect(todoTimeMovePayloadSchema.safeParse({...input,...patch}).success).toBe(false)
 })
})
