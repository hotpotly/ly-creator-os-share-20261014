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

async function title(id='ios') {
 return main.evaluate(async id=>(await (globalThis as Globals).creatorOS.getWorkspace()).projects.find(p=>p.id===id)!.title,id)
}
async function bind(page: Page, name: string) {
 await page.getByRole('button',{name:'绑定项目',exact:true}).click()
 const picker=page.getByRole('dialog',{name:'关联待办项目',exact:true})
 await picker.getByLabel('搜索关联项目').fill(name)
 await picker.getByRole('button',{name,exact:true}).click()
 await expect(picker).toHaveCount(0)
}
async function saved() { return main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getWorkspace()).todos) }

test('tray selects draft rows, binds different projects or unlinks, and writes only on Create',async({browserName},info)=>{
 expect(browserName).toBe('chromium')
 const projectTitle=await title(), secondTitle=await title('ai-browser')
 const before=await saved()
 const stages=await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords)
 await tray.getByRole('button',{name:'展开新建待办'}).click()
 await tray.getByRole('textbox',{name:'批量新建待办'}).fill('下午精剪(3)\n晚上字幕(1)\n封面(1)\n买菜')
 const preview=tray.getByRole('region',{name:'待办项目预览'})
 await expect(preview.getByRole('button',{name:'绑定项目'})).toBeDisabled()
 await preview.getByRole('checkbox',{name:'选择草稿：精剪(3)',exact:true}).check()
 await preview.getByRole('checkbox',{name:'选择草稿：字幕(1)',exact:true}).check()
 await bind(tray,projectTitle)
 await expect(preview.locator('[data-project-id="ios"]')).toHaveCount(2)
 await preview.getByRole('checkbox',{name:'选择草稿：封面(1)',exact:true}).check()
 await bind(tray,secondTitle)
 await expect(preview.locator('[data-project-id="ai-browser"]')).toHaveCount(1)
 // R21ab: newly bound drafts show enabled stage recommendations, but do not start phases.
 await expect(preview.locator('.todo-draft-stage')).toHaveText(['剪辑','后期','后期'])
 expect(await saved()).toEqual(before)
 for (const theme of ['light','dark']) {
  await tray.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
  await preview.screenshot({path:info.outputPath(`draft-${theme}.png`)})
 }
 await tray.getByRole('button',{name:'创建4条',exact:true}).click()
 await expect(preview).toHaveCount(0)
 await expect.poll(async()=>(await saved()).length).toBe(before.length+4)
 const rows=(await saved()).filter(t=>!before.some(old=>old.id===t.id))
 expect(rows.map(t=>[t.title,t.projectId,t.stageKey])).toEqual([['精剪(3)','ios','editing'],['字幕(1)','ios','postproduction'],['封面(1)','ai-browser','postproduction'],['买菜',null,null]])
 expect(rows[0]!.segment).toBe('afternoon');expect(rows[1]!.segment).toBe('evening')
 expect(await main.evaluate(async()=>(await (globalThis as Globals).creatorOS.getProject('ios',false)).stageTimeRecords)).toEqual(stages)
})

test('input changes clear selection and obsolete links; cancel picker and close composer never create rows',async()=>{
 const before=await saved(), projectTitle=await title()
 await tray.getByRole('button',{name:'展开新建待办'}).click()
 const input=tray.getByRole('textbox',{name:'批量新建待办'})
 await input.fill('精剪(3)\n字幕(1)')
 await tray.getByRole('checkbox',{name:'全选草稿'}).check()
 await bind(tray,projectTitle)
 await tray.getByRole('checkbox',{name:'全选草稿'}).check()
 await tray.getByRole('button',{name:'绑定项目',exact:true}).click()
 await tray.getByRole('button',{name:'关闭项目选择'}).click()
 await input.fill('精剪(3)\n新字幕(1)')
 await expect(tray.getByRole('button',{name:'绑定项目',exact:true})).toBeDisabled()
 await expect(tray.locator('.todo-companion-drafts [data-project-id="ios"]')).toHaveCount(1)
 await input.fill('精剪(3)\n字幕(1)')
 await expect(tray.locator('.todo-companion-drafts [data-project-id="ios"]')).toHaveCount(1)
 await tray.getByRole('checkbox',{name:'全选草稿'}).check()
 await tray.getByRole('button',{name:'绑定项目',exact:true}).click()
 await tray.getByRole('dialog',{name:'关联待办项目'}).getByRole('button',{name:'不关联项目',exact:true}).click()
 await expect(tray.locator('.todo-companion-drafts [data-project-id="ios"]')).toHaveCount(0)
 await tray.getByRole('button',{name:'收起新建待办'}).click()
 expect(await saved()).toEqual(before)
})

test('home and widget share draft selection; failed create preserves choices and retry has no duplicates',async()=>{
 const projectTitle=await title()
 await main.locator('.todo-create-button').click()
 const composer=main.getByRole('dialog',{name:'批量新建待办'})
 await composer.locator('textarea').fill('精剪(3)\n买菜')
 await composer.getByRole('checkbox',{name:'选择草稿：精剪(3)',exact:true}).check()
 await bind(main,projectTitle)
 await composer.locator('.todo-draft-title-row .todo-project-link').first().click()
 const picker=main.getByRole('dialog',{name:'关联待办项目'})
 await picker.getByLabel('所属阶段').selectOption('editing')
 await picker.getByRole('button',{name:'关闭项目选择'}).click()
 // Appending another line retains the deliberate project and stage on the unchanged first row.
 await composer.locator('textarea').fill('精剪(3)\n买菜\n洗衣服')
 await composer.getByRole('checkbox',{name:'选择草稿：精剪(3)',exact:true}).check()
 await bind(main,projectTitle)
 await composer.getByRole('textbox',{name:'待办标题',exact:true}).last().press('End')
 await composer.getByRole('textbox',{name:'待办标题',exact:true}).last().pressSequentially('修改')
 await expect(composer.getByRole('textbox',{name:'待办标题',exact:true}).last()).toHaveValue('洗衣服修改')
 await expect(composer.getByRole('textbox',{name:'待办标题',exact:true}).last()).toBeFocused()
 await composer.getByRole('textbox',{name:'待办日期',exact:true}).last().fill('bad-date')
 const before=await saved()
 await composer.getByRole('button',{name:'创建3条待办'}).click()
 await expect.poll(async()=>(await saved()).length).toBe(before.length)
 await expect(composer.locator('[data-project-id="ios"]')).toHaveCount(1)
 await composer.getByRole('textbox',{name:'待办日期',exact:true}).last().fill('2026-09-14')
 await composer.getByRole('button',{name:'创建3条待办'}).click()
 await expect(composer).toHaveCount(0)
 const newRows=(await saved()).filter(t=>!before.some(old=>old.id===t.id))
 expect(newRows).toHaveLength(3)
 expect(newRows.find(t=>t.title==='精剪(3)')).toMatchObject({projectId:'ios',stageKey:'editing'})
 const opened=app.waitForEvent('window')
 await app.evaluate(()=>{(globalThis as Globals).__workLogTest!.create('widget')})
 const widget=await opened
 await widget.getByRole('button',{name:'展开新建待办'}).click()
 await widget.getByRole('textbox',{name:'批量新建待办'}).fill('调色(1)\n运动')
 await widget.getByRole('checkbox',{name:'选择草稿：调色(1)',exact:true}).check()
 await bind(widget,projectTitle)
 await widget.getByRole('button',{name:'创建2条',exact:true}).click()
 await expect.poll(async()=>(await saved()).length).toBe(before.length+5)
})
