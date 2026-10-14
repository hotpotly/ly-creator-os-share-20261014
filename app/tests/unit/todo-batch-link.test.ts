import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import type { CreateTodoInput, TodoBatchLinkInput, TodoItem } from '../../src/shared/domain'
import { todoBatchLinkPayloadSchema } from '../../src/shared/ipc'

const stores: WorkspaceStore[] = [], directories: string[] = []
async function setup() {
 const root=join(import.meta.dirname,'../../test-results/unit'); await mkdir(root,{recursive:true})
 const dir=await mkdtemp(join(root,'batch-link-')); directories.push(dir)
 const store=await openWorkspaceStore(dir); stores.push(store); return store.repository
}
afterEach(async()=>{ stores.splice(0).forEach(store=>store.close()); await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true}))) })
const create=(patch: Partial<CreateTodoInput>={}): CreateTodoInput => ({title:'精剪(3)',projectId:null,stageKey:null,plannedDate:'2026-09-15',segment:'evening',category:'self_media',trackingMode:'checklist',progress:0,...patch})
const request=(todos: TodoItem[], patch: Partial<TodoBatchLinkInput>={}): TodoBatchLinkInput=>({items:todos.map(todo=>({todoId:todo.id,expectedUpdatedAt:todo.updatedAt,expectedProjectId:todo.projectId,expectedStageKey:todo.stageKey??null})),projectId:'ios',stageMode:'preserve',stageKey:null,includeClosed:false,...patch})

describe('atomic explicit todo batch associations',()=>{
 it('links selected todos only, preserving completion, durations, dates, ordering and all stage records',async()=>{
  const repo=await setup(), todos=repo.createTodoItems([create(),create({title:'调色(1)',progress:100}),create({title:'不选的'})])
  const stages=repo.getProject('ios',false).stageTimeRecords, schedules=repo.listScheduleItems()
  const result=repo.batchLinkTodos(request(todos.slice(0,2),{stageMode:'replace',stageKey:'editing'}))
  expect(result).toHaveLength(2)
  result.forEach((todo,index)=>{ expect(todo).toMatchObject({...todos[index],projectId:'ios',stageKey:'editing',stageLinkSource:'manual',updatedAt:todo.updatedAt}) })
  expect(repo.listTodoItems().find(todo=>todo.id===todos[2]!.id)).toEqual(todos[2])
  expect(repo.getProject('ios',false).stageTimeRecords).toEqual(stages)
  expect(repo.listScheduleItems()).toEqual(schedules)
 })
 it('preserves same-project stages but clears them when moving projects; explicit replace/unlink works',async()=>{
  const repo=await setup(), todos=repo.createTodoItems([create({projectId:'ios',stageKey:'editing'}),create({projectId:'ai-browser',stageKey:'script'})])
  const result=repo.batchLinkTodos(request(todos))
  expect(result.map(todo=>todo.stageKey)).toEqual(['editing',null])
  const cleared=repo.batchLinkTodos(request(result,{stageMode:'replace',stageKey:null}))
  expect(cleared.every(todo=>!todo.stageKey)).toBe(true)
  const unlinked=repo.batchLinkTodos(request(cleared,{projectId:null}))
  expect(unlinked.every(todo=>!todo.projectId&&!todo.stageKey&&!todo.stageLinkSource)).toBe(true)
 })
 it('rejects a stale, deleted or missing row before writing any selected row',async()=>{
  const repo=await setup(), todos=repo.createTodoItems([create(),create({title:'第二条'})])
  const input=request(todos)
  repo.updateTodoItem(todos[1]!.id,{projectId:'ai-browser',stageKey:'script'})
  expect(()=>repo.batchLinkTodos(input)).toThrow('已变化')
  expect(repo.listTodoItems().find(todo=>todo.id===todos[0]!.id)).toEqual(todos[0])
  repo.dismissTodoItem(todos[1]!.id)
  expect(()=>repo.batchLinkTodos(input)).toThrow('已变化')
  expect(()=>repo.batchLinkTodos({...input,items:[input.items[0]!,{...input.items[1]!,todoId:randomUUID()}]})).toThrow('已变化')
  expect(repo.listTodoItems().find(todo=>todo.id===todos[0]!.id)).toEqual(todos[0])
 })
 it('rejects invalid targets and duplicate selections; closed targets require explicit inclusion',async()=>{
  const repo=await setup(), todos=repo.createTodoItems([create(),create({title:'第二条'})])
  repo.setModule('ios','editing',false)
  expect(()=>repo.batchLinkTodos(request(todos,{stageMode:'replace',stageKey:'editing'}))).toThrow('已隐藏')
  expect(()=>repo.batchLinkTodos(request([todos[0]!,todos[0]!]))).toThrow('不同')
  repo.setProjectLifecycle('ios','completed')
  expect(()=>repo.batchLinkTodos(request(todos))).toThrow('已结束')
  expect(repo.listTodoItems().every(todo=>!todo.projectId)).toBe(true)
  expect(repo.batchLinkTodos(request(todos,{includeClosed:true})).every(todo=>todo.projectId==='ios')).toBe(true)
 })
 it('rolls back earlier rows and their audit events if a later write fails',async()=>{
  const repo=await setup(), todos=repo.createTodoItems([create(),create({title:'第二条'})])
  const db=new Database(stores.at(-1)!.databasePath)
  const beforeEvents=db.prepare('SELECT * FROM todo_events ORDER BY id').all()
  db.exec(`CREATE TRIGGER fail_batch_test BEFORE UPDATE ON todo_items WHEN NEW.id='${todos[1]!.id}' BEGIN SELECT RAISE(ABORT,'injected write failure'); END`)
  expect(()=>repo.batchLinkTodos(request(todos))).toThrow('injected write failure')
  expect(repo.listTodoItems()).toEqual(todos)
  expect(db.prepare('SELECT * FROM todo_events ORDER BY id').all()).toEqual(beforeEvents)
  db.close()
 })
 it('uses a strict narrow IPC contract without a completion/status patch',()=>{
  const input=request([{id:randomUUID(),updatedAt:'date',projectId:null,stageKey:null} as TodoItem])
  expect(todoBatchLinkPayloadSchema.safeParse(input).success).toBe(true)
  expect(todoBatchLinkPayloadSchema.safeParse({...input,completed:true}).success).toBe(false)
  expect(todoBatchLinkPayloadSchema.safeParse({...input,items:[...input.items,...input.items]}).success).toBe(false)
  expect(todoBatchLinkPayloadSchema.safeParse({...input,stageKey:'editing'}).success).toBe(false)
  expect(todoBatchLinkPayloadSchema.safeParse({...input,items:[]}).success).toBe(false)
 })
})
