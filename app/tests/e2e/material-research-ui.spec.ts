import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication
let mainWindow: Page
let userDataPath: string

async function launchApp(): Promise<void> {
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_BACKGROUND: '1' }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.projects.length) ?? 0)).toBeGreaterThan(0)
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  await launchApp()
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('项目资料阶段提供联网收集入口、来源承诺与人工确认门', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ssd/materials' })
  await expect(mainWindow.getByRole('heading', { name: '资料', exact: true })).toBeVisible()

  await mainWindow.getByRole('button', { name: '添加资料' }).click()
  const menu = mainWindow.getByRole('menu')
  const researchEntry = menu.getByRole('menuitem', { name: /联网收集资料/ })
  await expect(researchEntry).toBeVisible()
  await expect(menu.getByRole('menuitem').first()).toContainText('联网收集资料')
  await researchEntry.click()

  const dialog = mainWindow.getByRole('dialog', { name: /想让系统帮你收集什么/ })
  await expect(dialog).toContainText('不会读取或上传已有文件')
  await expect(dialog).toContainText('结果不会直接写入项目')
  const request = dialog.getByLabel('具体收集要求')
  await expect(request).toBeFocused()
  await request.fill('收集近三年主流无线鼠标的重量、续航和首发价格，优先官方来源；冲突时并列展示。')
  await dialog.getByLabel('资料标题·可稍后修改').fill('无线鼠标参数核验')
  await expect(dialog.getByRole('button', { name: /开始联网收集/ })).toBeEnabled()

  await mainWindow.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(mainWindow.getByText('正在联网收集资料')).toHaveCount(0)
})

test('联网候选逐条标明来源并可确认保存为项目资料', async () => {
  await electronApp.close()
  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  const requestedAt = '2026-07-28T02:45:00.000Z'
  const taskId = 'e2e-material-research-task'
  const researchId = '2b9db9ce-530c-4de6-bd31-29ee442333cb'
  const result = {
    suggestedTitle: '无线鼠标参数核验',
    overview: '固定候选用于验证来源对应和人工保存。',
    claims: [
      { id: 'weight', heading: '产品重量', content: '官方规格标注重量为63克。', status: 'supported', sourceIds: ['official'] },
      { id: 'price', heading: '首发价格', content: '当前没有稳定的一手价格来源。', status: 'unverified', sourceIds: [] }
    ],
    conflicts: [{ topic: '连接方式表述', details: '两个来源的适用型号范围不同。', sourceIds: ['official', 'media'] }],
    unresolved: ['不同地区首发价格仍待核实'],
    sources: [
      { id: 'official', title: '官方规格页', url: 'https://example.com/spec', publisher: 'Example', domain: 'example.com', sourceType: 'official', publishedAt: null, accessedAt: requestedAt },
      { id: 'media', title: '媒体复核页', url: 'https://example.org/review', publisher: 'Review', domain: 'example.org', sourceType: 'media', publishedAt: '2026-07-20', accessedAt: requestedAt }
    ],
    searchedAt: requestedAt
  }
  database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,output_target,result_summary,requires_confirmation,requested_at,started_at,finished_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    taskId, 'material_research', 'ssd', '联网收集·无线鼠标参数核验', 'codex_cli', 'succeeded', 100, '{}', '{"network":"web_search","readableRefs":[],"writableTarget":"candidate_fact","shell":false}',
    `material-research:${researchId}`, '联网资料已整理', 0, requestedAt, requestedAt, requestedAt
  )
  database.prepare(`INSERT INTO material_research_results(id,project_id,task_id,request,requested_title,result_json,runtime_json,result_hash,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    researchId, 'ssd', taskId, '收集重量与首发价格并写明来源', '无线鼠标参数核验', JSON.stringify(result),
    '{"providerThreadId":"e2e","model":"gpt-test","reasoningEffort":"high","webSearchMode":"required","webSearches":[]}', 'e2e-hash', 'ready', requestedAt, requestedAt
  )
  for (const source of result.sources) {
    database.prepare(`INSERT INTO material_research_sources(id,result_id,source_key,title,url,publisher,domain,source_type,published_at,accessed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      `e2e-source-${source.id}`, researchId, source.id, source.title, source.url, source.publisher, source.domain, source.sourceType, source.publishedAt, source.accessedAt
    )
  }
  database.close()
  await launchApp()

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ssd/materials' })
  await mainWindow.getByRole('button', { name: /联网资料等待确认/ }).click()
  const dialog = mainWindow.getByRole('dialog', { name: /核对后保存参考资料/ })
  await expect(dialog.getByRole('button', { name: /来源1·官方规格页/ })).toHaveCount(2)
  await expect(dialog.getByRole('button', { name: /来源1·官方规格页/ }).first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: /来源2·媒体复核页/ })).toBeVisible()
  await expect(dialog.locator('.material-research-claim').filter({ hasText: '首发价格' }).getByRole('checkbox')).not.toBeChecked()
  await dialog.getByRole('button', { name: '保存为项目资料' }).click()
  await expect(dialog).toContainText('已经保存为当前项目资料')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()

  await mainWindow.getByRole('button', { name: '查看无线鼠标参数核验' }).click()
  const preview = mainWindow.getByRole('dialog', { name: /查看资料无线鼠标参数核验/ })
  await expect(preview).toContainText('官方来源')
  await expect(preview).not.toContainText('official')
  await expect(preview).not.toContainText('2026-07-28T02:45:00.000Z')
  await expect(preview.getByRole('link', { name: '官方规格页' })).toHaveAttribute('href', 'https://example.com/spec')
})
