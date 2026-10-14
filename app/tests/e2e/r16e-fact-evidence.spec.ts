import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: userDataPath }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS.getWorkspace()
  ).projects.length)).toBeGreaterThan(2)

  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  database.exec('PRAGMA busy_timeout = 5000')
  const baseVersion = database.prepare(`SELECT id FROM draft_versions WHERE project_id=? AND document_type='script' ORDER BY revision DESC LIMIT 1`)
    .get('ai-browser') as { id: string }
  // Keep the seeded thread newer than the fixture's built-in conversations so
  // the workbench's "latest conversation" lookup deterministically selects it.
  const now = '2099-08-05T06:00:00.000Z'
  database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,requested_at,started_at,finished_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'r16e-evidence-task', 'script_revision', 'ai-browser', 'R16e事实标注', 'codex_cli', 'succeeded', 100, '{}',
    '{"network":"provider_only","readableRefs":[],"writableTarget":"none","shell":false}', now, now, now
  )
  database.prepare(`INSERT INTO content_instruction_requests(id,project_id,surface,request_json,common_fingerprint,created_at) VALUES(?,?,?,?,?,?)`)
    .run('r16e-evidence-request', 'ai-browser', 'script_conversation', '{}', 'a'.repeat(64), now)
  database.prepare(`INSERT INTO content_instruction_request_targets(
    id,request_id,provider,provider_config_id,target_json,provider_security_fingerprint,provider_policy_version,runtime_version,requested_model,requested_reasoning_effort,history_hash,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'r16e-evidence-target', 'r16e-evidence-request', 'codex_cli', 'builtin-codex-cli', '{}', 'fingerprint', 'policy-v1', 'runtime-v1',
    'gpt-5.6-sol', 'ultra', 'b'.repeat(64), now
  )
  database.prepare(`INSERT INTO script_revision_threads(
    id,project_id,base_version_id,provider,surface,provider_fingerprint,provider_thread_id,model,reasoning_effort,web_search_mode,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'r16e-evidence-thread', 'ai-browser', baseVersion.id, 'codex_cli', 'conversation', 'fingerprint', 'runtime-thread',
    'gpt-5.6-sol', 'ultra', 'automatic', now, now
  )
  const content = '联网价是**2999元**，另一处还是2999元。AI补写过渡句。购买时间待填。'
  const firstPriceStart = content.indexOf('2999元')
  const secondPriceStart = content.indexOf('2999元', firstPriceStart + 1)
  const aiStart = content.indexOf('AI补写过渡句')
  const userStart = content.indexOf('购买时间待填')
  const annotations = [{
    id: 'r16e-fact-1', start: firstPriceStart, end: firstPriceStart + 5, text: '2999元', provenance: 'web_supplement',
    note: '官方售价', webSources: [{ title: '官方价格页', url: 'https://example.com/product' }], evidenceIds: ['r16e-evidence-1']
  }, {
    id: 'r16e-fact-2', start: secondPriceStart, end: secondPriceStart + 5, text: '2999元', provenance: 'web_supplement',
    note: '官方售价', webSources: [{ title: '官方价格页', url: 'https://example.com/product' }], evidenceIds: ['r16e-evidence-2']
  }, {
    id: 'r16e-ai-1', start: aiStart, end: aiStart + 8, text: 'AI补写过渡句', provenance: 'ai_supplement',
    note: '根据上下文补写', webSources: [], evidenceIds: []
  }, {
    id: 'r16e-user-1', start: userStart, end: userStart + 8, text: '购买时间待填', provenance: 'needs_confirmation',
    note: '只有用户本人知道', webSources: [], evidenceIds: []
  }]
  database.prepare(`INSERT INTO script_revision_messages(
    id,thread_id,role,content,provider,task_id,model,reasoning_effort,source_selections_json,conflicts_json,web_search_mode,web_searches_json,fact_annotations_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'r16e-evidence-message', 'r16e-evidence-thread', 'assistant', content, 'codex_cli', 'r16e-evidence-task', 'gpt-5.6-sol', 'ultra',
    '[]', '[]', 'automatic', '[]', JSON.stringify(annotations), now
  )
  const insertEvidence = database.prepare(`INSERT INTO content_fact_evidence(
    id,project_id,request_id,target_id,task_id,annotation_id,claim,source_title,source_url,accessed_at,market,fact_as_of,evidence_type,price_kind,currency,runtime_access_id,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (const [index, annotationId] of ['r16e-fact-1', 'r16e-fact-2'].entries()) {
    insertEvidence.run(
      `r16e-evidence-${index + 1}`, 'ai-browser', 'r16e-evidence-request', 'r16e-evidence-target', 'r16e-evidence-task', annotationId,
      '官方当前售价为2999元', '官方价格页', 'https://example.com/product', now, '中国大陆', now,
      'price', 'current_official', 'CNY', `runtime-access-${index + 1}`, now
    )
  }
  database.close()
  await mainWindow.evaluate(() => {
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
  })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
})

test('R16e重复事实精确标注，证据可打开且自动保存重开不丢失', async () => {
  test.setTimeout(60_000)
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  const seededConversation = await mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS.getScriptRevisionConversation('ai-browser', null, 'codex_cli')
  ))
  expect(seededConversation.messages.map((message) => message.id)).toContain('r16e-evidence-message')
  await expect(mainWindow.getByText('联网价是2999元')).toBeVisible()
  await mainWindow.getByRole('button', { name: '加入文案' }).click()
  const current = mainWindow.locator('.current-script-pane')
  await expect(current.locator('mark[data-script-annotation-note^="联网补充："]')).toHaveCount(2)
  await expect(current.locator('mark[data-script-annotation-note^="AI补写："]')).toHaveCount(1)
  await expect(current.locator('u[data-script-annotation-note^="需要你补充："]')).toHaveCount(1)
  await current.locator('[data-content-fact-evidence-ids]').first().click()
  const evidence = mainWindow.getByRole('dialog', { name: '联网证据' })
  await expect(evidence).toContainText('官方当前售价为2999元')
  await expect(evidence.getByRole('button').filter({ hasText: '官方价格页' })).toBeVisible()
  await evidence.getByRole('button', { name: '关闭联网证据' }).click()

  await mainWindow.evaluate(async () => {
    await (globalThis as unknown as BrowserGlobals).creatorOS.setPreferences({ theme: 'dark' })
  })
  await expect(mainWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  const colors = await current.locator('mark[data-script-annotation-note^="联网补充："], mark[data-script-annotation-note^="AI补写："]').evaluateAll((nodes) => (
    nodes.map((node) => node.ownerDocument.defaultView!.getComputedStyle(node).color)
  ))
  expect(colors).toHaveLength(3)
  expect(colors).not.toContain('rgb(32, 35, 31)')

  await expect.poll(() => mainWindow.evaluate(async () => {
    const loaded = await (globalThis as unknown as BrowserGlobals).creatorOS.loadProjectCurrentScript('ai-browser')
    if (loaded.status !== 'ready') return []
    return loaded.snapshot.annotations.filter((annotation) => annotation.note.startsWith('联网补充：'))
      .map((annotation) => annotation.evidenceIds)
  })).toEqual([['r16e-evidence-1'], ['r16e-evidence-2']])
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.locator('.current-script-pane [data-content-fact-evidence-ids]')).toHaveCount(2)
  await expect(mainWindow.locator('.current-script-pane mark[data-script-annotation-note^="联网补充："]')).toHaveCount(2)
})
