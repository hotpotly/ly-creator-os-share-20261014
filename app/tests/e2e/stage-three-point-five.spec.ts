import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
  innerHeight: number
  innerWidth: number
  document: {
    documentElement: { dataset: { theme?: string } }
    querySelector: (selector: string) => { scrollWidth: number; clientWidth: number } | null
  }
  getComputedStyle: (element: unknown) => { gridTemplateColumns: string }
}
let electronApp: ElectronApplication; let mainWindow: Page

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data'); rmSync(userDataPath, { recursive: true, force: true })
  const codexRoot = testInfo.outputPath('codex-source'); const claudeRoot = testInfo.outputPath('claude-source')
  mkdirSync(join(codexRoot, 'sessions'), { recursive: true }); mkdirSync(join(claudeRoot, 'project-a'), { recursive: true })
  const codexId = '019f-e2e-codex-0001'
  writeFileSync(join(codexRoot, 'session_index.jsonl'), `${JSON.stringify({ id: codexId, thread_name: 'Codex隐私筛选测试', updated_at: '2026-07-20T08:00:00.000Z' })}\n`)
  writeFileSync(join(codexRoot, 'sessions', `rollout-${codexId}.jsonl`), [
    { type: 'response_item', timestamp: '2026-07-20T08:00:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '我的测试电话是13800138000' }] } },
    { type: 'response_item', timestamp: '2026-07-20T08:01:00.000Z', payload: { type: 'function_call', arguments: 'TOOL_BLOCK_MUST_NOT_APPEAR' } }
  ].map((record) => JSON.stringify(record)).join('\n') + '\n')
  writeFileSync(join(claudeRoot, 'project-a', 'session-a.jsonl'), [
    { type: 'ai-title', sessionId: 'session-a', aiTitle: 'Claude方法复盘' },
    { type: 'user', uuid: 'message-e2e-0001', timestamp: '2026-07-20T09:00:00.000Z', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: '这是Claude里的普通对话内容' }, { type: 'tool_result', content: 'CLAUDE_TOOL_BLOCK' }] } }
  ].map((record) => JSON.stringify(record)).join('\n') + '\n')
  electronApp = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: userDataPath, CREATOR_OS_TEST_CODEX_ROOT: codexRoot, CREATOR_OS_TEST_CLAUDE_ROOT: claudeRoot } })
  mainWindow = await electronApp.firstWindow(); await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.projects.length) ?? 0)).toBeGreaterThan(0)
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('工作区标签保留独立页面并支持当前标签的前进后退', async () => {
  await expect(mainWindow.getByRole('tab', { name: '首页' })).toHaveAttribute('aria-selected', 'true')
  const back = mainWindow.getByRole('button', { name: '后退' }); const forward = mainWindow.getByRole('button', { name: '前进' })
  await expect(back).toBeDisabled(); await expect(forward).toBeDisabled()
  await mainWindow.getByRole('button', { name: '排期', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '排期', level: 1 })).toBeVisible()
  await expect(mainWindow.getByRole('tab', { name: '排期' })).toHaveAttribute('aria-selected', 'true')
  await back.click(); await expect(mainWindow.getByRole('heading', { name: '7月18日，星期六' })).toBeVisible()
  await forward.click(); await expect(mainWindow.getByRole('heading', { name: '排期', level: 1 })).toBeVisible()

  const addTab = mainWindow.getByRole('button', { name: '新建工作区标签' })
  await addTab.click()
  const addMenu = mainWindow.getByRole('menu', { name: '选择新标签起点' })
  await expect(addMenu).toBeVisible()
  await expect(addMenu.getByRole('menuitem')).toHaveText(['首页', '灵感库', '选题管理', '内容项目', '收入台账', '商单收入', '其他收入', '创作工具', '排期', '资源'])
  const menuBox = await addMenu.boundingBox()
  expect(menuBox).not.toBeNull()
  expect(menuBox!.width).toBeLessThanOrEqual(140)
  expect(menuBox!.x).toBeGreaterThanOrEqual(8)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(await mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).innerWidth - 8))
  await mainWindow.keyboard.press('Escape')
  await expect(addMenu).toBeHidden()
  await expect(addTab).toBeFocused()
  await addTab.click(); await addTab.click()
  await expect(addMenu).toBeHidden()
  await addTab.click()
  await mainWindow.locator('.topbar').click({ position: { x: 5, y: 5 } })
  await expect(addMenu).toBeHidden()
  await addTab.click()
  await addMenu.getByRole('menuitem', { name: '选题管理' }).click()
  await expect(mainWindow.getByRole('tab')).toHaveCount(2)
  await expect(mainWindow.getByRole('tab', { name: '选题管理' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('heading', { name: '选题管理' })).toBeVisible()
  await mainWindow.getByRole('region', { name: '常用，可拖入项目标题或项目阶段' }).getByRole('button', { name: 'AI浏览器入门教学', exact: true }).click()
  await expect(mainWindow.getByRole('tab', { name: 'AI浏览器入门教学' })).toHaveAttribute('aria-selected', 'true')
  await mainWindow.getByRole('tab', { name: '排期' }).click()
  await expect(mainWindow.getByRole('heading', { name: '排期', level: 1 })).toBeVisible()
  await mainWindow.getByRole('tab', { name: 'AI浏览器入门教学' }).click()
  await mainWindow.getByRole('button', { name: '关闭AI浏览器入门教学' }).click()
  await expect(mainWindow.getByRole('tab')).toHaveCount(1)
  await expect(mainWindow.getByRole('heading', { name: '排期', level: 1 })).toBeVisible()

  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(680, 720) })
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).innerWidth)).toBeLessThanOrEqual(700)
  await addTab.click()
  const narrowMenuBox = await addMenu.boundingBox()
  const narrowViewport = await mainWindow.evaluate(() => ({ height: (globalThis as unknown as BrowserGlobals).innerHeight, width: (globalThis as unknown as BrowserGlobals).innerWidth }))
  expect(narrowMenuBox).not.toBeNull()
  expect(narrowMenuBox!.x).toBeGreaterThanOrEqual(8)
  expect(narrowMenuBox!.y).toBeGreaterThanOrEqual(8)
  expect(narrowMenuBox!.x + narrowMenuBox!.width).toBeLessThanOrEqual(narrowViewport.width - 8)
  expect(narrowMenuBox!.y + narrowMenuBox!.height).toBeLessThanOrEqual(narrowViewport.height - 8)
  await mainWindow.keyboard.press('Escape')
})

test('侧边栏可隐藏、持久化并通过快捷键恢复', async () => {
  await mainWindow.getByRole('button', { name: '隐藏侧边栏' }).click()
  await expect(mainWindow.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.sidebarCollapsed)).toBe(true)
  await mainWindow.reload(); await mainWindow.waitForLoadState('domcontentloaded')
  await expect(mainWindow.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await mainWindow.keyboard.press('Meta+b')
  await expect(mainWindow.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/)
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).preferences.sidebarCollapsed)).toBe(false)
})

test('侧边栏可从右边缘拖动调整宽度并持久化', async () => {
  const handle = mainWindow.getByRole('separator', { name: '拖拽调整侧边栏宽度' })
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  await mainWindow.mouse.move(box!.x + box!.width / 2, box!.y + 120)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(box!.x + box!.width / 2 + 56, box!.y + 120, { steps: 4 })
  await mainWindow.mouse.up()
  const resizedWidth = Number(await handle.getAttribute('aria-valuenow'))
  expect(resizedWidth).toBeGreaterThanOrEqual(270)
  expect(resizedWidth).toBeLessThanOrEqual(282)
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).preferences.sidebarWidth)).toBe(resizedWidth)

  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  const reloadedHandle = mainWindow.getByRole('separator', { name: '拖拽调整侧边栏宽度' })
  await expect(reloadedHandle).toHaveAttribute('aria-valuenow', String(resizedWidth))
  await reloadedHandle.focus()
  await mainWindow.keyboard.press('Home')
  await expect(reloadedHandle).toHaveAttribute('aria-valuenow', '220')
})

test('内容方向可新增改名，项目方向和模板可分别更改', async () => {
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await mainWindow.getByRole('button', { name: '更多操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '管理内容方向' }).click()
  const manager = mainWindow.getByRole('dialog', { name: '管理内容方向' })
  await manager.getByLabel('新内容方向名称').fill('AI实战日志')
  await manager.getByRole('button', { name: '新增内容方向' }).click()
  await expect(manager.getByText('AI实战日志')).toBeVisible()
  await manager.getByRole('button', { name: '编辑AI实战日志', exact: true }).click()
  await manager.getByLabel('编辑AI实战日志名称').fill('AI实战与复盘')
  await manager.getByRole('button', { name: '保存', exact: true }).click()
  await expect(manager.getByText('AI实战与复盘')).toBeVisible()
  await manager.getByRole('button', { name: '关闭内容方向管理' }).click()

  await mainWindow.getByRole('button', { name: '新建项目' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建项目' })
  const initialDialogBox = await dialog.boundingBox()
  await dialog.getByLabel('项目名称').fill('AI工作流复盘')
  await expect(dialog.getByRole('group', { name: '内容方向' })).toBeVisible()
  await mainWindow.waitForTimeout(850)
  await expect(dialog.getByLabel('项目名称')).toBeFocused()
  const classifiedDialogBox = await dialog.boundingBox()
  expect(Math.abs((classifiedDialogBox?.height ?? 0) - (initialDialogBox?.height ?? 0))).toBeLessThanOrEqual(1)
  await dialog.getByRole('group', { name: '内容方向' }).getByRole('button', { name: 'AI实战与复盘', exact: true }).click()
  await dialog.getByRole('group', { name: '项目模板' }).getByRole('button', { name: /AI教学/ }).click()
  await dialog.getByRole('button', { name: '创建项目' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'AI工作流复盘' })).toBeVisible()
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true })).toBeVisible()

  const basic = mainWindow.locator('.basic-info-card')
  await basic.getByRole('button', { name: '更改' }).click()
  await mainWindow.getByRole('dialog', { name: '更改主要内容方向' }).getByRole('button', { name: /商单/ }).click()
  await expect(mainWindow.getByRole('status')).toContainText('现有模块和内容没有被替换')
  await expect(mainWindow.locator('.project-tabs-amount').getByRole('button', { name: '金额', exact: true })).toHaveCount(0)
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '反馈', exact: true })).toHaveCount(0)

  await basic.locator('dl > div').filter({ hasText: '项目模板' }).getByRole('button').click()
  await mainWindow.getByRole('dialog', { name: '选择项目模板' }).getByRole('button', { name: /^商单/ }).click()
  await expect(mainWindow.getByText('将新增')).toBeVisible()
  await mainWindow.getByRole('button', { name: '确认应用' }).click()
  await expect(mainWindow.locator('.project-tabs-amount').getByRole('button', { name: '金额', exact: true })).toBeVisible()
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '反馈', exact: true })).toHaveCount(0)
  await mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true }).click()
  await expect(mainWindow.getByText('甲方反馈', { exact: true })).toBeVisible()
  await mainWindow.locator('.project-overview-nav').click()

  await basic.getByRole('button', { name: '更改' }).click()
  await mainWindow.getByRole('dialog', { name: '更改主要内容方向' }).getByRole('button', { name: /AI实战与复盘/ }).click()
  await expect(mainWindow.getByRole('status')).toContainText('商单与反馈已隐藏但内容仍保留')
  await expect(mainWindow.locator('.project-tabs-amount').getByRole('button', { name: '金额', exact: true })).toHaveCount(0)
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '反馈', exact: true })).toHaveCount(0)
})

test('文案对话默认不带项目资料，并允许用户明确启用项目上下文', async () => {
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/overview' })
  const resourceSummary = mainWindow.locator('.project-resource-summary')
  await expect(resourceSummary.getByText('AI基础风格')).toBeVisible()
  await resourceSummary.getByRole('button', { name: '检查本次引用' }).click()
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  const contextButton = mainWindow.getByRole('button', { name: '项目上下文' })
  await expect(contextButton).toHaveAttribute('aria-pressed', 'false')
  await contextButton.click()
  await expect(contextButton).toHaveAttribute('aria-pressed', 'true')
  await contextButton.click()
  await expect(contextButton).toHaveAttribute('aria-pressed', 'false')
})

test('AI选题筛选首次只显示来源范围、Provider与深度扫描计划', async () => {
  await mainWindow.getByRole('button', { name: '创作工具', exact: true }).click()
  await mainWindow.getByRole('button', { name: '选择对话并筛选' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'AI选题筛选' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: 'Codex＋Claude（2）' })).toBeVisible()
  await expect(mainWindow.getByText('2条待扫描')).toBeVisible()
  await expect(mainWindow.getByText('首次深度扫描', { exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: /开始首次扫描/ })).toBeDisabled()
  await expect(mainWindow.locator('.ai-topic-filter-page')).not.toContainText(/13800138000|这是Claude里的普通对话内容|TOOL_BLOCK_MUST_NOT_APPEAR|CLAUDE_TOOL_BLOCK|新鲜度\d|实用性\d|个人经历\d|可讲性\d/)
  const preflight = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const prepared = await api.prepareConversationScan({ mode: 'deep', sourceScope: 'both', provider: 'codex_cli' })
    const batch = await api.getConversationScanPreflightBatch(prepared.preflightId, 1)
    return { prepared, batch }
  })
  expect(preflight.prepared).toMatchObject({ conversationCount: 2, privacyFindingCount: 1, batchCount: 1 })
  expect(preflight.prepared.excludedBlocks).toEqual(expect.arrayContaining([
    expect.objectContaining({ blockType: 'tool_use', count: 1 }),
    expect.objectContaining({ blockType: 'tool_result', count: 1 })
  ]))
  expect(preflight.batch.sanitizedContent).toContain('[已遮盖手机号]')
  expect(preflight.batch.sanitizedContent).toContain('这是Claude里的普通对话内容')
  expect(preflight.batch.sanitizedContent).not.toMatch(/13800138000|TOOL_BLOCK_MUST_NOT_APPEAR|CLAUDE_TOOL_BLOCK/)

  await mainWindow.getByRole('button', { name: '切换到深色模式' }).click()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).document.documentElement.dataset.theme)).toBe('dark')
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(680, 720) })
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as BrowserGlobals).innerWidth)).toBeLessThanOrEqual(700)
  const responsiveLayout = await mainWindow.evaluate(() => {
    const browser = globalThis as unknown as BrowserGlobals
    const page = browser.document.querySelector('.ai-topic-filter-page')
    const setup = browser.document.querySelector('.ai-topic-scan-bar')
    if (!page || !setup) return null
    return {
      overflow: page.scrollWidth - page.clientWidth,
      setupColumns: browser.getComputedStyle(setup).gridTemplateColumns.split(' ').length
    }
  })
  expect(responsiveLayout).not.toBeNull()
  expect(responsiveLayout?.overflow).toBeLessThanOrEqual(1)
  expect(responsiveLayout?.setupColumns).toBe(1)
})

test('AI选题筛选兼容入口仍可从明确片段生成可追溯项目', async () => {
  await mainWindow.getByRole('button', { name: '创作工具', exact: true }).click()
  await mainWindow.getByRole('button', { name: '选择对话并筛选' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'AI选题筛选' })).toBeVisible()
  await mainWindow.getByText('手动粘贴（兼容入口）', { exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '从明确片段生成旧版洞察卡' })).toBeVisible()

  const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
  await mainWindow.getByLabel('来源标题（可选）').fill('AI工具复盘对话')
  await mainWindow.getByLabel('粘贴明确选择的内容').fill([
    `这次我实际用AI工具整理选题，但第一版把新闻与个人经验混在了一起。测试密钥是${secret}。`,
    '我后来的方法是先把每段对话分成故事、方法和观点，再手动决定保留哪些，最后才生成候选。',
    '对比直接让AI写完稿，先审核洞察卡更适合我，因为来源能够回看，而且不会把私密内容带进候选。'
  ].join('\n\n'))
  await mainWindow.getByRole('button', { name: '扫描并生成洞察卡' }).click()
  await expect(mainWindow.locator('.content-atom-card')).toHaveCount(3)
  await expect(mainWindow.getByRole('main')).not.toContainText(secret)
  await expect(mainWindow.locator('.content-atom-card').first()).toContainText('已遮盖')

  await mainWindow.locator('.content-atom-card.review_pending').first().getByRole('button', { name: '保留' }).click()
  await mainWindow.locator('.content-atom-card.review_pending').first().getByRole('button', { name: '保留' }).click()
  const unselectedKept = mainWindow.locator('.content-atom-card.kept:not(.merge-selected)')
  await unselectedKept.first().getByRole('button', { name: '选择合并' }).click()
  await unselectedKept.first().getByRole('button', { name: '选择合并' }).click()
  await mainWindow.getByRole('button', { name: '合并所选' }).click()
  await expect(mainWindow.getByText(/^合并洞察：/).first()).toBeVisible()

  await mainWindow.getByRole('button', { name: 'X串文' }).click()
  await mainWindow.getByRole('button', { name: '生成X串文' }).click()
  const candidate = mainWindow.locator('.content-derivative-candidate').first()
  await expect(candidate.getByText('X串文·本机规则初稿')).toBeVisible()
  await candidate.getByLabel('编辑候选').fill('这是我确认后的X串文。\n\n1/2 先审核洞察卡。\n\n2/2 再生成可追溯候选。')
  await candidate.getByRole('button', { name: '确认候选' }).click()
  await expect(candidate.getByText('已确认', { exact: true })).toBeVisible()
  await candidate.getByRole('button', { name: '复制' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('已复制确认后的内容')

  await candidate.getByLabel('项目名称').fill('AI对话引擎闭环验证')
  await candidate.getByRole('button', { name: '创建项目并保留来源' }).click()
  await expect(candidate.getByText('已建项目', { exact: true })).toBeVisible()
  await candidate.getByRole('button', { name: '打开已创建项目' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'AI对话引擎闭环验证' })).toBeVisible()
  await expect(mainWindow.getByText('对话候选', { exact: true })).toBeVisible()

  await expect.poll(() => mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const engine = await api.getContentEngine()
    const derivative = engine.derivatives.find((item) => item.projectId)
    if (!derivative?.projectId) return null
    const project = await api.getProject(derivative.projectId, false)
    const version = project.versions.find((item) => item.sourceCandidateId === derivative.id)
    return {
      provider: derivative.provider,
      atomCount: derivative.derivationSnapshot.atoms.length,
      privacyCount: derivative.derivationSnapshot.privacy.reduce((total, item) => total + item.findingCount, 0),
      sourceCandidateId: version?.sourceCandidateId,
      projectTitle: project.title
    }
  })).toMatchObject({ provider: 'local_rules', atomCount: 1, privacyCount: 1, sourceCandidateId: expect.any(String), projectTitle: 'AI对话引擎闭环验证' })
})
