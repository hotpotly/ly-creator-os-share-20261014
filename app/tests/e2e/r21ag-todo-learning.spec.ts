import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi; __focusTest: { create(mode: string): void; schedule(): void } }
let app: ElectronApplication, main: Page, tray: Page, widget: Page
const read = () => main.evaluate(() => (globalThis as Globals).creatorOS.getWorkspace())
const row = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"]`)
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  const root = join(import.meta.dirname, '../..'), harness = info.outputPath('harness.cjs')
  mkdirSync(info.outputPath(), { recursive: true })
  writeFileSync(harness, `const Module=require('node:module'), fs=require('node:fs'), file=${JSON.stringify(join(root, 'out/main/index.js'))}; const m=new Module(file); m.filename=file; m.paths=Module._nodeModulePaths(${JSON.stringify(root)}); m._compile(fs.readFileSync(file,'utf8')+'\\n;globalThis.__focusTest={create:createTodoWindow,schedule:createSchedulePanelWindow};',file);`)
  app = await electron.launch({ args: [harness], cwd: root, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: info.outputPath('user-data') } })
  main = await app.firstWindow()
  await expect.poll(async () => (await read()).today).toBeTruthy()
  await main.evaluate(async () => { const api = (globalThis as Globals).creatorOS; const s = await api.getWorkspace(); for (const t of s.todos) await api.dismissTodo(t.id) })
  let opened = app.waitForEvent('window'); await app.evaluate(() => (globalThis as Globals).__focusTest.create('tray')); tray = await opened
  await expect(tray.getByRole('button', { name: '这一步做到了' })).toBeVisible()
  opened = app.waitForEvent('window'); await app.evaluate(() => (globalThis as Globals).__focusTest.create('widget')); widget = await opened
  await expect(widget.getByRole('button', { name: '这一步做到了' })).toBeVisible()
  await tray.getByRole('button', { name: '普通待办', exact: true }).click()
})
test.afterEach(async () => { await app?.close() })

const draft = (page: Page) => page.locator('.todo-companion-drafts')
const picker = (page: Page) => page.getByRole('dialog', { name: '关联待办项目' })
async function startDraft(page: Page, title: string) {
  await page.getByRole('button', { name: '展开新建待办' }).click()
  await page.getByLabel('批量新建待办', { exact: true }).fill(title)
}

test('manual stage and category corrections teach future quantity variants across home and companion windows', async () => {
  const projectTitle = (await read()).projects.find(p => p.id === 'ios')!.title
  const title = `${projectTitle}处理开场200字(2)`
  await startDraft(tray, title)
  await draft(tray).getByRole('button', { name: '查看关联项目', exact: true }).click()
  await picker(tray).getByLabel('所属阶段').selectOption('script')
  await picker(tray).getByRole('button', { name: '关闭项目选择' }).click()
  expect((await read()).preferences.todoStageMemories).toHaveLength(0)
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveValue('')
  await tray.getByRole('button', { name: '收起新建待办' }).click()
  const first = (await read()).todos.find(t => t.title === title)!
  expect(first.stageKey).toBe('script')
  await row(tray, first.id).locator('.todo-category-tag').click()
  await tray.getByRole('menuitemradio', { name: '生活', exact: true }).click()
  await expect.poll(async () => (await read()).preferences.todoStageMemories?.length).toBe(1)
  await startDraft(widget, `${projectTitle}处理开场500字(1)`)
  await expect(draft(widget).locator('.todo-draft-stage')).toHaveText('文案')
  await widget.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(widget.getByLabel('批量新建待办', { exact: true })).toHaveValue('')
  const second = (await read()).todos.find(t => t.title.includes('处理开场500字'))!
  expect(second).toMatchObject({ stageKey: 'script', category: 'life' })
  expect((await read()).preferences.todoStageMemories).toHaveLength(1)
  await main.locator('.todo-create-button').click()
  const home = main.getByRole('dialog', { name: '批量新建待办' })
  await home.locator('textarea').fill(`${projectTitle}处理开场900字`)
  await expect(home.locator('.todo-draft-stage')).toHaveText('文案')
  await expect(home.getByLabel('待办分类')).toHaveValue('life')
  await main.keyboard.press('Escape')
  await widget.reload()
  await startDraft(widget, `${projectTitle}处理开场800字`)
  await expect(draft(widget).locator('.todo-draft-stage')).toHaveText('文案')
})

test('word counts suggest script, cancelled drafts do not teach and explicit clearing defeats future suggestions', async () => {
  const projectTitle = (await read()).projects.find(p => p.id === 'ios')!.title
  await startDraft(tray, `${projectTitle}写到3000字`)
  await expect(draft(tray).locator('.todo-draft-stage')).toHaveText('文案')
  await draft(tray).getByRole('button', { name: '查看关联项目', exact: true }).click()
  await picker(tray).getByLabel('所属阶段').selectOption('outline')
  await picker(tray).getByRole('button', { name: '关闭项目选择' }).click()
  await tray.getByRole('button', { name: '收起新建待办' }).click()
  expect((await read()).preferences.todoStageMemories).toHaveLength(0)
  await tray.reload()
  await startDraft(tray, `${projectTitle}写到3000字`)
  await expect(draft(tray).locator('.todo-draft-stage')).toHaveText('文案')
  await tray.getByRole('button', { name: '创建1条', exact: true }).click()
  await expect(tray.getByLabel('批量新建待办', { exact: true })).toHaveValue('')
  await tray.getByRole('button', { name: '收起新建待办' }).click()
  expect((await read()).preferences.todoStageMemories).toHaveLength(0)
  const todo = (await read()).todos.find(t => t.title.includes('写到3000字'))!
  await row(tray, todo.id).locator('.todo-project-link').click()
  await picker(tray).getByLabel('所属阶段').selectOption('')
  await picker(tray).getByRole('button', { name: '关闭项目选择' }).click()
  await startDraft(widget, `${projectTitle}写到5000字`)
  await expect(draft(widget).locator('.todo-draft-stage')).toHaveCount(0)
  expect((await read()).preferences.todoStageMemories?.[0]?.stageKey).toBeNull()
})
