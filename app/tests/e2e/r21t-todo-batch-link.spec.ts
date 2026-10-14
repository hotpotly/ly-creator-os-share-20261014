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

async function seedBatch() {
 return main.evaluate(async()=>{
  const api=(globalThis as Globals).creatorOS, ws=await api.getWorkspace()
  const todos=await api.createTodoBatch(['精剪(3)','文字(1)','调色(1)','明天补拍(2)'].map((title,index)=>({title,plannedDate:index===3?'2026-10-01':ws.today,segment:index===1?'evening' as const:'morning' as const,projectId:index===1?'ai-browser':null,stageKey:null,category:'self_media' as const,trackingMode:'checklist' as const,progress:index===2?100:0})))
  return {ids:todos.map(todo=>todo.id),projectTitle:ws.projects.find(project=>project.id==='ios')!.title}
 })
}
async function chooseProject(panel: ReturnType<Page['getByRole']>, title: string) {
 await panel.getByRole('button',{name:'关联项目（可选）',exact:true}).click()
 const picker=tray.getByRole('dialog',{name:'关联待办项目',exact:true})
 await picker.getByLabel('搜索关联项目').fill(title)
 await picker.getByRole('button',{name:title,exact:true}).click()
 await expect(picker).toHaveCount(0)
}

test('batch link spans visible groups, previews overwrite, changes only selected tasks and synchronizes home/project',async({browserName},info)=>{
 expect(browserName).toBe('chromium')
 const {ids,projectTitle}=await seedBatch()
 if (!await tray.getByRole('button',{name:'批量关联待办',exact:true}).isVisible()) await tray.getByRole('button',{name:'更多待办操作',exact:true}).click()
 await tray.getByRole('button',{name:'批量关联待办',exact:true}).click()
 const panel=tray.getByRole('dialog',{name:'批量关联待办',exact:true})
 await expect(panel.getByRole('checkbox',{name:'选择待办：明天补拍(2)',exact:true})).toHaveCount(0)
 await expect(panel.getByRole('button',{name:'确认关联',exact:true})).toBeDisabled()
 await panel.getByLabel('选择待办：精剪(3)',{exact:true}).check()
 await panel.getByLabel('选择待办：文字(1)',{exact:true}).check()
 await chooseProject(panel,projectTitle)
 await expect(panel).toContainText('将更改1条已有的关联')
 await panel.getByLabel('统一设置阶段',{exact:true}).check()
 await panel.getByLabel('批量关联阶段',{exact:true}).selectOption('editing')
 for(const theme of ['light','dark']) {
  await tray.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
  const box=await panel.boundingBox(),viewport=await tray.evaluate(()=>({width:innerWidth,height:innerHeight}))
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height)
  await tray.screenshot({path:info.outputPath(`batch-link-${theme}.png`)})
 }
 await panel.getByRole('button',{name:'确认关联（2条）',exact:true}).click()
 await expect(panel).toHaveCount(0)
 const todos=await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos)
 expect(todos.filter(todo=>ids.slice(0,2).includes(todo.id)).every(todo=>todo.projectId==='ios'&&todo.stageKey==='editing')).toBe(true)
 expect(todos.find(todo=>todo.id===ids[2])?.projectId).toBeNull()
 expect(todos.find(todo=>todo.id===ids[2])?.status).toBe('completed')
 await expect(tray.getByRole('dialog',{name:'确认阶段开始'})).toHaveCount(0)
 await main.evaluate(()=>{window.location.hash='#/project/ios/overview'})
 await expect(main.locator(`.project-todo-row[data-todo-id="${ids[0]}"]`).first()).toBeVisible()
 await expect(main.getByRole('button',{name:'批量关联待办',exact:true}).first()).toBeVisible()
})

test('cancel writes nothing; stale edits reject the entire batch; changing date clears the open selection',async()=>{
 const {ids,projectTitle}=await seedBatch()
 if (!await tray.getByRole('button',{name:'批量关联待办',exact:true}).isVisible()) await tray.getByRole('button',{name:'更多待办操作',exact:true}).click()
 await tray.getByRole('button',{name:'批量关联待办',exact:true}).click()
 const panel=tray.getByRole('dialog',{name:'批量关联待办',exact:true})
 await panel.getByRole('button',{name:'全选当前列表'}).click()
 await chooseProject(panel,projectTitle)
 await panel.getByRole('button',{name:'取消',exact:true}).click()
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(todo=>todo.id===id)?.projectId,ids[0]!)).toBeNull()
 if (!await tray.getByRole('button',{name:'批量关联待办',exact:true}).isVisible()) await tray.getByRole('button',{name:'更多待办操作',exact:true}).click()
 await tray.getByRole('button',{name:'批量关联待办',exact:true}).click()
 await panel.getByRole('button',{name:'全选当前列表'}).click()
 await chooseProject(panel,projectTitle)
 await main.evaluate(async id=>{await (globalThis as Globals).creatorOS.updateTodo(id,{projectId:'ai-browser',stageKey:'script'})},ids[0]!)
 await panel.getByRole('button',{name:'确认关联（3条）',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('未保存任何关联')
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(todo=>todo.id===id)?.projectId,ids[2]!)).toBeNull()
 // The popup intentionally covers the toolbar; dispatch its existing date action to verify scope reset.
 await tray.getByRole('button',{name:'查看后一天待办'}).evaluate(button => (button as HTMLButtonElement).click())
 await expect(panel).toHaveCount(0)
})

test('widget and home reuse the same batch entry',async()=>{
 await seedBatch()
 const opened=app.waitForEvent('window');await app.evaluate(()=>{(globalThis as Globals).__workLogTest!.create('widget')});const widget=await opened
 if (!await widget.getByRole('button',{name:'批量关联待办',exact:true}).isVisible()) await widget.getByRole('button',{name:'更多待办操作',exact:true}).click()
 await widget.getByRole('button',{name:'批量关联待办',exact:true}).click()
 await expect(widget.getByRole('dialog',{name:'批量关联待办',exact:true})).toBeVisible()
 await widget.getByRole('button',{name:'关闭批量关联'}).click()
 await main.getByRole('button',{name:'批量关联待办',exact:true}).first().click()
 await expect(main.getByRole('dialog',{name:'批量关联待办',exact:true})).toBeVisible()
})
