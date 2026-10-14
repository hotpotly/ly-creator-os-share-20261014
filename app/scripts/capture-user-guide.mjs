import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..'), output = resolve(root, '../docs/images')
mkdirSync(output, { recursive: true }); mkdirSync(join(root, 'tmp'), { recursive: true })
const work = mkdtempSync(join(root, 'tmp/user-guide-')), harness = join(work, 'harness.cjs')
writeFileSync(harness, `const Module=require('node:module'),fs=require('node:fs'),file=${JSON.stringify(join(root, 'out/main/index.js'))}; const m=new Module(file); m.filename=file;m.paths=Module._nodeModulePaths(${JSON.stringify(root)}); let source=fs.readFileSync(file,'utf8'); const original='const includeDemoContent = process.env.NODE_ENV === "test" || process.env.CREATOR_OS_DEMO_SEED === "1";'; if(!source.includes(original))throw new Error('Cannot isolate guide seed'); source=source.replace(original,'const includeDemoContent = false;');m._compile(source+'\\n;globalThis.__guide={create:createTodoWindow};',file);`)
const app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_DATE: '2026-10-14', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: join(work, 'user-data') } })
try {
  const main = await app.firstWindow()
  await expect.poll(() => main.evaluate(async () => Boolean((await window.creatorOS.getWorkspace()).today))).toBe(true)
  const ids = await main.evaluate(async () => {
    const api = window.creatorOS, ws = await api.getWorkspace()
    if (ws.projects.length || ws.todos.length) throw new Error('Guide must start with an empty workspace')
    await api.setPreferences({ theme: 'light', visualStyle: 'feishu' })
    const project = await api.createProject({ title: '演示项目：书桌整理', description: '纯虚构说明书示例', contentTypeId: ws.contentTypes[0].id, platformTargets: [], isCommercial: false })
    const base = { plannedDate: ws.today, segment: null, projectId: null, stageKey: null, category: 'life', trackingMode: 'checklist', progress: 0 }
    const items = await api.createTodoBatch([
      { ...base, title: '整理书桌', segment: 'morning' },
      { ...base, title: '演示项目：整理素材(1)', category: 'self_media', projectId: project.id, stageKey: 'editing', segment: 'afternoon', trackingMode: 'progress', progress: 40 },
      { ...base, title: '阅读十页', segment: 'evening' },
      { ...base, title: '额外：给绿植浇水', isExtra: true },
      { ...base, title: '昨天的练习待办', plannedDate: '2026-10-13' }
    ])
    return { items, projectId: project.id }
  })
  const opened = app.waitForEvent('window'); await app.evaluate(() => globalThis.__guide.create('tray')); const tray = await opened
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setContentSize(win.webContents.getURL().includes('/todo-') ? 440 : 1680, 680) })
  await expect(tray.getByRole('button', { name: '这一步做到了' })).toBeVisible()
  const shot = async (page, file) => { await page.screenshot({ path: join(output, file), animations: 'disabled', scale: 'css' }); console.log(file) }
  await shot(tray, '01-small-step.png')
  await tray.getByRole('button', { name: '普通待办', exact: true }).click()
  await expect(tray.locator(`[data-todo-id="${ids.items[0].id}"]`)).toBeVisible()
  await shot(tray, '02-todo-panel.png')
  await main.locator('.todo-workspace').screenshot({ path: join(output, '03-home-todos.png'), animations: 'disabled', scale: 'css' })
  await tray.getByRole('button', { name: '展开新建待办' }).click()
  await tray.getByLabel('批量新建待办', { exact: true }).fill('明天下午整理抽屉\n晚上阅读二十页')
  await shot(tray, '04-batch-create.png')
  await tray.getByRole('button', { name: /新建待办日期：/ }).click()
  await tray.getByLabel('待办安排方式').selectOption('range')
  await tray.getByLabel('范围结束日期').fill('2026-10-16')
  await tray.getByLabel('日期范围名称').fill('三天整理计划')
  await shot(tray, '05-date-range.png')
  await tray.keyboard.press('Escape'); await tray.getByRole('button', { name: '收起新建待办' }).click()
  await tray.locator(`[data-todo-id="${ids.items[1].id}"]`).click({ button: 'right' })
  await shot(tray, '06-context-menu.png')
  await tray.getByRole('menuitem', { name: '调整进度' }).click()
  await shot(tray, '07-progress.png'); await tray.keyboard.press('Escape')
  await tray.locator(`[data-todo-id="${ids.items[1].id}"]`).getByRole('button', { name: '查看关联项目', exact: true }).click()
  await shot(tray, '08-project-stage.png'); await tray.keyboard.press('Escape')
  await tray.getByRole('button', { name: '更多待办操作', exact: true }).click()
  await tray.getByRole('button', { name: '批量关联待办', exact: true }).click()
  await tray.getByRole('checkbox').first().check()
  await shot(tray, '09-batch-link.png'); await tray.keyboard.press('Escape')
  await tray.getByRole('button', { name: /昨日未完成/ }).click()
  await tray.getByLabel('复制：昨天的练习待办').check()
  await shot(tray, '10-copy-to-today.png'); await tray.keyboard.press('Escape')
  await tray.getByRole('button', { name: '记录', exact: true }).click()
  await tray.getByRole('spinbutton').fill('2.5')
  await shot(tray, '11-work-hours.png'); await tray.keyboard.press('Escape')
  await tray.getByRole('button', { name: '待办视图', exact: true }).click()
  await shot(tray, '12-views.png')
  console.log('Guide images captured with synthetic data only')
} finally { await app.close() }
