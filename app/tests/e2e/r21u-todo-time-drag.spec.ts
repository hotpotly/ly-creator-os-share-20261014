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

async function seed() {
 return main.evaluate(async()=>{
  const api=(globalThis as Globals).creatorOS, ws=await api.getWorkspace()
  const rows=await api.createTodoBatch(['补拍(2)','文字(1)','调色(1)'].map((title,i)=>({title,plannedDate:ws.today,segment:i===0?'afternoon' as const:'evening' as const,projectId:'ios',stageKey:i===0?'shooting' as const:'editing' as const,category:'self_media' as const,trackingMode:'checklist' as const,progress:i===0?100:0})))
  await api.setPreferences({companionTodoOrder:rows.map(t=>t.id),companionTodoView:'time',homeTodoView:'time'})
  return rows
 })
}
const row=(page: Page,id: string)=>page.locator(`[data-todo-id="${id}"]`)
const order=(page:Page,key:string)=>page.locator(`[data-time-group="${key}"] [data-todo-id]`).evaluateAll(items=>items.map(item=>item.getAttribute('data-todo-id')))
test('cross-time exact insertion persists, syncs home/tray, preserves completion and supports keyboard boundary',async()=>{
 const [a,b,c]=await seed()
 await expect(row(tray,a!.id)).toBeVisible()
 await row(tray,a!.id).locator('.todo-reorder-handle').dragTo(row(tray,c!.id),{targetPosition:{x:80,y:2}})
 await expect.poll(()=>order(tray,'evening')).toEqual([b!.id,a!.id,c!.id])
 await expect.poll(()=>order(main,'evening')).toEqual([b!.id,a!.id,c!.id])
 const after=await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id),a!.id)
 expect(after).toEqual({...a,segment:'evening',updatedAt:after!.updatedAt})
 await tray.reload()
 await expect.poll(()=>order(tray,'evening')).toEqual([b!.id,a!.id,c!.id])
 // Home row insertion uses the same atomic command in the opposite direction.
 await main.evaluate(async id=>{await (globalThis as Globals).creatorOS.updateTodo(id,{segment:'morning'})},b!.id)
 await expect.poll(()=>order(main,'morning')).toEqual([b!.id])
 await row(main,a!.id).locator('.todo-reorder-handle').dragTo(row(main,b!.id),{targetPosition:{x:80,y:2}})
 await expect.poll(()=>order(tray,'morning')).toEqual([a!.id,b!.id])
 await row(tray,c!.id).locator('.todo-reorder-handle').press('Alt+ArrowUp')
 await expect.poll(()=>order(tray,'morning')).toEqual([a!.id,c!.id,b!.id])
 await expect(row(tray,c!.id).locator('.todo-reorder-handle')).toBeFocused()
 await row(tray,b!.id).locator('.todo-reorder-handle').press('Alt+ArrowUp')
 await expect.poll(()=>order(main,'morning')).toEqual([a!.id,b!.id,c!.id])

})
test('empty destinations are available during drag; cancel does not save; quiet handle works in both themes',async({browserName},info)=>{
 expect(browserName).toBe('chromium')
 const [a]=await seed()
 const handle=row(tray,a!.id).locator('.todo-reorder-handle')
 await expect(handle).toBeVisible()
 for(const theme of ['light','dark'] as const) {
  await main.evaluate(async theme=>{await (globalThis as Globals).creatorOS.setPreferences({theme})},theme)
  await tray.mouse.move(1,1)
  await expect(handle).toHaveCSS('opacity','0.18')
  await row(tray,a!.id).hover()
  await expect(handle).toHaveCSS('opacity','0.75')
  await tray.locator('.todo-companion-list').screenshot({path:info.outputPath(`handle-${theme}.png`)})
 }
 // Start a native drag, then locate the newly exposed empty target (no synthetic drops).
 let box=(await handle.boundingBox())!
 await tray.mouse.move(box.x+box.width/2,box.y+box.height/2);await tray.mouse.down();await tray.mouse.move(box.x+50,box.y+10,{steps:6})
 const slot=tray.locator('.todo-empty-time-targets [data-time-group="morning"]')
 await expect(slot).toBeVisible()
 await tray.keyboard.press('Escape');await tray.mouse.up()
 await expect(tray.locator('.todo-empty-time-targets')).toHaveCount(0)
 expect(await main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos.find(t=>t.id===id)?.segment,a!.id)).toBe('afternoon')
 box=(await handle.boundingBox())!
 await tray.mouse.move(box.x+box.width/2,box.y+box.height/2);await tray.mouse.down();await tray.mouse.move(box.x+50,box.y+10,{steps:6})
 await expect(slot).toBeVisible()
 const destination=(await slot.boundingBox())!
 await tray.mouse.move(destination.x+destination.width/2,destination.y+destination.height/2,{steps:8});await tray.mouse.up()
 await expect.poll(()=>order(tray,'morning')).toEqual([a!.id])
 await expect.poll(()=>tray.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
