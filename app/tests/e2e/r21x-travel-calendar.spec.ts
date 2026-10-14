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
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_DATE: '2026-09-19', CREATOR_OS_TEST_STAGE_DATETIME: '2026-09-19T10:00:00', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  app.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(info.outputPath('electron.log'), chunk))
  main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => (await (globalThis as Globals).creatorOS.getWorkspace()).today)).toBeTruthy()
  const opened = app.waitForEvent('window')
  await app.evaluate(() => { (globalThis as Globals).__workLogTest!.create('tray') })
  tray = await opened
  await expect(tray.locator('.todo-work-log')).toContainText('未记录')
})
test.afterEach(async () => { await app?.close() })

test('home roundtrip and purple/blue/mixed date circles synchronize in main, tray and schedule panel', async ({browserName},info) => {
 expect(browserName).toBe('chromium')
 const before=await main.evaluate(()=>(globalThis as Globals).creatorOS.getWorkspace())
 await tray.getByRole('button',{name:'安排行程',exact:true}).click()
 await tray.getByRole('group',{name:'行程类型'}).getByRole('button',{name:'回家',exact:true}).click()
 const editor=tray.getByRole('dialog',{name:'安排回家',exact:true})
 await expect(editor.getByLabel('回家名称或目的地')).toBeHidden()
 await editor.getByRole('gridcell',{name:'选择2026年9月21日',exact:true}).click({modifiers:['Shift']})
 await editor.getByRole('button',{name:'保存回家',exact:true}).click()
 await expect(tray.locator('.business-trip-summary')).toContainText('在老家·回老家')
 await expect(main.locator('.business-trip-summary')).toContainText('在老家·回老家')
 await main.evaluate(async()=>{await (globalThis as Globals).creatorOS.saveBusinessTrip({scheduleId:null,expectedUpdatedAt:null,action:'save',title:'上海出差',startDate:'2026-09-20',endDate:'2026-09-22',projectId:null,notes:''})})
 await main.getByRole('button',{name:'排期',exact:true}).click()
 await main.getByRole('button',{name:'月',exact:true}).click()
 const number=(day:string)=>main.locator(`.month-day[data-calendar-date="${day}"] time`)
 await expect(number('2026-09-19')).toHaveAttribute('data-travel-tone','home')
 await expect(number('2026-09-20')).toHaveAttribute('data-travel-tone','mixed')
 await expect(number('2026-09-22')).toHaveAttribute('data-travel-tone','business')
 await expect(number('2026-09-23')).not.toHaveAttribute('data-travel-tone')
 const opened=app.waitForEvent('window');await app.evaluate(()=>{(globalThis as Globals).__workLogTest!.schedule()});const panel=await opened
 const cell=(day:number)=>panel.getByRole('gridcell',{name:new RegExp(`选择2026年9月${day}日`)})
 await expect(cell(19).locator('.calendar-date-number')).toHaveAttribute('data-travel-tone','home')
 await expect(cell(20).locator('.calendar-date-number')).toHaveAttribute('data-travel-tone','mixed')
 await expect(cell(22).locator('.calendar-date-number')).toHaveAttribute('data-travel-tone','business')
 for(const theme of ['light','dark']) {
  await main.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);await panel.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
  await main.locator('.schedule-canvas').screenshot({path:info.outputPath(`month-${theme}.png`)})
  await panel.locator('.schedule-companion-calendar').screenshot({path:info.outputPath(`calendar-${theme}.png`)})
  const background=await number('2026-09-19').evaluate(el=>getComputedStyle(el,'::before').backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  expect(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
 // Cancelling home removes only its date tint; overlapping business stays purple.
 await tray.locator('.business-trip-summary').filter({hasText:'回老家'}).click()
 const edit=tray.getByRole('dialog',{name:'编辑回家安排'})
 await edit.getByRole('button',{name:'更多设置'}).click()
 await edit.getByRole('button',{name:'取消回家',exact:true}).click()
 await edit.getByRole('button',{name:'确认取消回家',exact:true}).click()
 await expect(number('2026-09-19')).not.toHaveAttribute('data-travel-tone')
 await expect(number('2026-09-20')).toHaveAttribute('data-travel-tone','business')
 await expect(cell(20).locator('.calendar-date-number')).toHaveAttribute('data-travel-tone','business')
 const after=await main.evaluate(()=>(globalThis as Globals).creatorOS.getWorkspace())
 expect(after.todos).toEqual(before.todos)
 expect(after.schedules.find(item=>item.trip?.kind==='home')?.trip?.cancelled).toBe(true)
})

test('editing explicitly switches kind without duplicating the schedule and widget uses home wording',async()=>{
 const item=await main.evaluate(async()=> (globalThis as Globals).creatorOS.saveBusinessTrip({scheduleId:null,expectedUpdatedAt:null,action:'save',title:'回乡',startDate:'2026-09-19',endDate:'2026-09-19',projectId:null,notes:''}))
 await tray.locator('.business-trip-summary').click()
 await tray.getByRole('group',{name:'行程类型'}).getByRole('button',{name:'回家',exact:true}).click()
 const editor=tray.getByRole('dialog',{name:'编辑回家安排'})
 await editor.getByRole('button',{name:'保存回家',exact:true}).click()
 await expect(tray.locator('.business-trip-summary')).toContainText('在老家·回乡')
 const opened=app.waitForEvent('window');await app.evaluate(()=>{(globalThis as Globals).__workLogTest!.create('widget')});const widget=await opened
 await expect(widget.locator('.business-trip-summary')).toContainText('在老家·回乡')
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).schedules.filter(item=>item.id===id).map(item=>item.trip?.kind),item.id)).toEqual(['home'])
})
