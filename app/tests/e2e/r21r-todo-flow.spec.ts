import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __workLogTest?: { create(mode: string): void; schedule(): void; toggle(bounds: { x: number; y: number; width: number; height: number }): void } }
let app: ElectronApplication
let main: Page
let tray: Page
// Test-only bootstrap exposes the existing window factory from the built module;
// no production hooks, fabricated sender roles, or visible windows are introduced.
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..')
  const harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module = require('node:module'); const fs = require('node:fs'); const file = ${JSON.stringify(join(root, 'out/main/index.js'))}; const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file, 'utf8') + '\\n;globalThis.__workLogTest = { create: createTodoWindow, schedule: createSchedulePanelWindow, toggle: toggleSchedulePanelWindow };', file);`)
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-14T10:00:00', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
})
test.afterEach(async () => { await app?.close() })

async function seed(): Promise<string> {
 return main.evaluate(async () => {
   const api=(globalThis as Globals).creatorOS
   await api.setModuleCompleted('ios','script',false)
   await api.updateStageTime('ios','script',{startedAt:null,completedAt:null,source:'manual'})
   const workspace=await api.getWorkspace()
   return (await api.createTodoBatch([{title:'首条文案(2)',plannedDate:workspace.today,segment:'morning',projectId:'ios',stageKey:'script',category:'self_media',trackingMode:'checklist',progress:0}]))[0]!.id
 })
}
async function overview(): Promise<void> {
  await main.evaluate(() => { window.location.hash = '#/project/ios/overview' })
  await expect(main.locator('.project-stage-grid')).toBeVisible()
}

test('R21r first completion asks; postpone keeps the stage untouched; a confirmed date starts only the stage', async ({browserName}, info) => {
 expect(browserName).toBe('chromium')
 const id=await seed(), row=tray.locator(`[data-todo-id="${id}"]`)
 await expect(tray.getByRole('dialog',{name:'确认阶段开始'})).toHaveCount(0)
 await row.getByRole('button',{name:'完成首条文案(2)',exact:true}).click()
 const prompt=tray.getByRole('dialog',{name:'确认阶段开始'})
 await expect(prompt).toBeVisible()
 const today=await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getWorkspace()).today)
 await expect(prompt).toContainText(today.replaceAll('-','/'))
 for (const theme of ['light','dark']) {
   await tray.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
   const box=await prompt.boundingBox(), viewport=await tray.evaluate(()=>({width:innerWidth,height:innerHeight}))
   expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width)
   expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height)
   await tray.screenshot({path:info.outputPath(`stage-start-${theme}.png`)})
 }

 await prompt.getByRole('button',{name:'暂不',exact:true}).click()
 await expect(row).toHaveClass('completed')
 expect(await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords.find(r=>r.stageKey==='script')?.startedAt)).toBeNull()
 await row.getByRole('button',{name:'重新打开首条文案(2)',exact:true}).click()
 await row.getByRole('button',{name:'完成首条文案(2)',exact:true}).click()
 await prompt.getByRole('button',{name:'改日期'}).click()
 await prompt.getByLabel('阶段开始日期').fill('2026-07-01')
 await prompt.getByLabel('阶段开始时段').selectOption('afternoon')
 await prompt.getByRole('button',{name:'确认开始'}).click()
 await expect(prompt).toHaveCount(0)
 await expect.poll(()=>main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords.find(r=>r.stageKey==='script')?.startedAt)).toEqual({localDate:'2026-07-01',segment:'afternoon'})
 await overview()
 await expect(main.locator('[data-stage-key="script"] .stage-card-status')).toHaveText('进行中')
 await main.locator(`.project-todo-row[data-todo-id="${id}"] .todo-project-link`).click()
 await main.getByRole('dialog',{name:'关联待办项目'}).getByRole('button',{name:'不关联项目',exact:true}).click()
 expect(await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords.find(r=>r.stageKey==='script')?.startedAt)).toEqual({localDate:'2026-07-01',segment:'afternoon'})
})

test('R21r backfill proposes task date; a stale association cannot start the wrong project', async () => {
 const id=await seed()
 await main.evaluate(async id=>{await (globalThis as Globals).creatorOS.updateTodo(id,{plannedDate:'2026-06-05',segment:'evening'})},id)
 await overview()
 await main.locator(`.project-todo-row[data-todo-id="${id}"] .todo-check`).click()
 const prompt=main.getByRole('dialog',{name:'确认阶段开始'})
 await expect(prompt).toContainText('2026/06/05')
 await expect(prompt.getByLabel('阶段开始时段')).toHaveValue('evening')
 await tray.evaluate(async id=>{await (globalThis as Globals).creatorOS.updateTodo(id,{projectId:'ai-browser',stageKey:null})},id)
 await prompt.getByRole('button',{name:'确认开始'}).click()
 await expect(prompt.getByRole('alert')).toContainText('已变化')
 expect(await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords.find(r=>r.stageKey==='script')?.startedAt)).toBeNull()
})

test('R21r project picker hides completed projects by default but retains historical links', async () => {
 const id=await seed()
 const title=await main.evaluate(async()=>{
   const api=(globalThis as Globals).creatorOS
   const project=await api.getProject('ios',false)
   await api.setProjectLifecycle('ios','completed')
   return project.title
 })
 const row=tray.locator(`[data-todo-id="${id}"]`)
 await row.locator('.todo-project-link').click()
 const picker=tray.getByRole('dialog',{name:'关联待办项目'})
 await expect(picker).toContainText(title)
 await picker.getByRole('button',{name:'更换关联项目'}).click()
 await picker.getByLabel('搜索关联项目').fill(title)
 await expect(picker.getByRole('button',{name:title,exact:true})).toHaveCount(0)
 await picker.getByLabel('显示已完成／归档项目').check()
 await expect(picker.getByRole('button',{name:title,exact:true})).toBeVisible()
 await picker.getByRole('button',{name:'关闭项目选择'}).click()
 await row.getByRole('button',{name:'完成首条文案(2)',exact:true}).click()
 await expect(tray.getByRole('dialog',{name:'确认阶段开始'})).toHaveCount(0)
 await expect(row.locator('.todo-project-link')).toHaveAttribute('data-project-id','ios')
})

test('R21r dragging and keyboard sorting work in time/category/all without changing task fields', async () => {
 const ids=await main.evaluate(async()=>{
   const api=(globalThis as Globals).creatorOS, ws=await api.getWorkspace()
   return (await api.createTodoBatch(['排序甲','排序乙','排序丙'].map(title=>({title,plannedDate:ws.today,segment:null,projectId:null,category:'self_media',trackingMode:'checklist',progress:0})))).map(t=>t.id)
 })
 for (const view of ['按时间','按分类','全部']) {
   await tray.getByRole('button',{name:view,exact:true}).click()
   const rows=tray.locator('.todo-companion-group article')
   const before=await rows.evaluateAll(items=>items.map(item=>item.getAttribute('data-todo-id')))
   const source=tray.locator(`[data-todo-id="${before[2]}"] .todo-reorder-handle`)
   await source.dragTo(tray.locator(`[data-todo-id="${before[0]}"]`),{targetPosition:{x:50,y:2}})
   await expect.poll(()=>rows.evaluateAll(items=>items.map(item=>item.getAttribute('data-todo-id')))).toEqual([before[2],before[0],before[1]])
   await source.press('Alt+ArrowDown')
   await expect.poll(()=>rows.evaluateAll(items=>items.map(item=>item.getAttribute('data-todo-id')))).toEqual([before[0],before[2],before[1]])
 }
 await tray.reload()
 await expect(tray.locator('.todo-reorder-handle')).toHaveCount(3)
 await expect(main.locator('.todo-row .todo-reorder-handle')).toHaveCount(3)
 const order=await tray.locator('.todo-companion-group article').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-todo-id')))
 await expect.poll(()=>main.locator('.todo-row[data-todo-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-todo-id')))).toEqual(order)
 const latest=await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos)
 for(const id of ids) expect(latest.find(t=>t.id===id)).toMatchObject({segment:null,projectId:null,category:'self_media'})
 await expect.poll(()=>tray.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('R21s project-only editing task recommends editing; cancel preserves link; confirmation links and starts', async ({ browserName }, info) => {
 expect(browserName).toBe('chromium')
 const id=await main.evaluate(async()=>{
   const api=(globalThis as Globals).creatorOS, ws=await api.getWorkspace()
   await api.setProjectModule('ios','editing',true)
   await api.setModuleCompleted('ios','editing',false)
   await api.updateStageTime('ios','editing',{startedAt:null,completedAt:null,source:'manual'})
   return (await api.createTodoBatch([{title:'19 DemoOS17录音+剪 (1)',plannedDate:ws.today,segment:'morning',projectId:'ios',stageKey:null,category:'self_media',trackingMode:'checklist',progress:0}]))[0]!.id
 })
 const row=tray.locator(`[data-todo-id="${id}"]`), prompt=tray.getByRole('dialog',{name:'确认阶段开始'})
 await row.getByRole('button',{name:'完成19 DemoOS17录音+剪 (1)',exact:true}).click()
 await expect(prompt.getByLabel('要开始的阶段')).toHaveValue('editing')
 await expect(prompt).toContainText('同时将待办关联到剪辑')
 for (const theme of ['light','dark']) {
   await tray.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
   const box=await prompt.boundingBox(), viewport=await tray.evaluate(()=>({width:innerWidth,height:innerHeight}))
   expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width)
   expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height)
   await tray.screenshot({path:info.outputPath(`stage-recommendation-${theme}.png`)})
 }
 await prompt.getByRole('button',{name:'暂不',exact:true}).click()
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id)?.stageKey,id)).toBeNull()
 await row.getByRole('button',{name:'重新打开19 DemoOS17录音+剪 (1)',exact:true}).click()
 await row.getByRole('button',{name:'完成19 DemoOS17录音+剪 (1)',exact:true}).click()
 await prompt.getByRole('button',{name:'确认开始'}).click()
 await expect(prompt).toHaveCount(0)
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id)?.stageKey,id)).toBe('editing')
 expect(await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords.find(r=>r.stageKey==='editing')?.startedAt)).toBeTruthy()
})

test('R21s manual choice has priority; stage menu can correct it with an explicit link change', async () => {
 const id=await main.evaluate(async()=>{
   const api=(globalThis as Globals).creatorOS, ws=await api.getWorkspace()
   for (const key of ['shooting','editing'] as const) {
     await api.setProjectModule('ios',key,true); await api.setModuleCompleted('ios',key,false)
     await api.updateStageTime('ios',key,{startedAt:null,completedAt:null,source:'manual'})
   }
   return (await api.createTodoBatch([{title:'录音+剪(1)',plannedDate:ws.today,segment:'morning',projectId:'ios',stageKey:'shooting',category:'self_media',trackingMode:'checklist',progress:0}]))[0]!.id
 })
 await tray.locator(`[data-todo-id="${id}"]`).getByRole('button',{name:'完成录音+剪(1)',exact:true}).click()
 const prompt=tray.getByRole('dialog',{name:'确认阶段开始'})
 await expect(prompt.getByLabel('要开始的阶段')).toHaveValue('shooting')
 await expect(prompt).toContainText('已手动指定')
 // Real shared dropdown interaction, rather than only programmatic selectOption.
 await prompt.getByLabel('要开始的阶段').click()
 await tray.getByRole('menuitemradio',{name:'剪辑（文字推荐）',exact:true}).click()
 await expect(prompt).toContainText('将待办从拍摄改为剪辑')
 await prompt.getByRole('button',{name:'确认开始'}).click()
 await expect(prompt).toHaveCount(0)
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id)?.stageKey,id)).toBe('editing')
 expect(await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords.find(r=>r.stageKey==='shooting')?.startedAt)).toBeNull()
})

test('R21s ambiguous title requires selection and a later title edit invalidates the prompt', async () => {
 const id=await seed()
 await main.evaluate(async id=>{await (globalThis as Globals).creatorOS.updateTodo(id,{title:'拍摄＋剪辑(2)',stageKey:null})},id)
 await tray.locator(`[data-todo-id="${id}"]`).getByRole('button',{name:'完成拍摄＋剪辑(2)',exact:true}).click()
 const prompt=tray.getByRole('dialog',{name:'确认阶段开始'})
 await expect(prompt.getByLabel('要开始的阶段')).toHaveValue('')
 await expect(prompt.getByRole('button',{name:'确认开始'})).toBeDisabled()
 await expect(prompt).toContainText('涉及多个阶段，请选择')
 const options=await prompt.getByLabel('要开始的阶段').locator('option').evaluateAll(items=>items.map(item=>(item as HTMLOptionElement).value).filter(Boolean))
 expect(options.every(key=>['materials','outline','script','shooting','editing'].includes(key))).toBe(true)
 await prompt.getByLabel('要开始的阶段').click()
 const menu=tray.getByRole('menu',{name:'要开始的阶段选项'})
 await expect(menu).toBeVisible()
 await expect(menu.getByRole('menuitemradio',{name:/后期|发布|版本/})).toHaveCount(0)
 await tray.keyboard.press('Escape')
 await prompt.getByLabel('要开始的阶段').selectOption('script')
 await main.evaluate(async id=>{await (globalThis as Globals).creatorOS.updateTodo(id,{title:'改了最终事项(3)'})},id)
 await prompt.getByRole('button',{name:'确认开始'}).click()
 await expect(prompt.getByRole('alert')).toContainText('已变化')
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id)?.stageKey,id)).toBeNull()
})


test('R21s short stage completion does not prompt or delete its association', async () => {
 const id=await main.evaluate(async()=>{
   const api=(globalThis as Globals).creatorOS, ws=await api.getWorkspace()
   return (await api.createTodoBatch([{title:'做封面(0.2)',plannedDate:ws.today,segment:null,projectId:'ios',stageKey:'postproduction',category:'self_media',trackingMode:'checklist',progress:0}]))[0]!.id
 })
 const row=tray.locator(`[data-todo-id="${id}"]`)
 await row.getByRole('button',{name:'完成做封面(0.2)',exact:true}).click()
 await expect(row).toHaveClass('completed')
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id)?.stageKey,id)).toBe('postproduction')
 expect(await main.evaluate(async id=>await (globalThis as Globals).creatorOS.getTodoStageStartCandidate(id),id)).toBeNull()
 await expect(tray.getByRole('dialog',{name:'确认阶段开始'})).toHaveCount(0)
})
