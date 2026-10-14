import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
let electronApp: ElectronApplication
let mainWindow: Page
let pageErrors: string[]

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  pageErrors = []
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_TEST_R17_READY: '1',
      CREATOR_OS_TEST_R18_REWRITE: '1',
      CREATOR_OS_TEST_R16B_REWRITE: '1',
      CREATOR_OS_TEST_R18_REWRITE_DELAY_MS: '600',
      CREATOR_OS_TEST_CURRENT_SCRIPT_RESTORE_DELAY_MS: '600',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  mainWindow.on('pageerror', (error) => pageErrors.push(error.message))
  await mainWindow.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => { await electronApp?.close().catch(() => undefined) })

test('R16a版本对比窄窗三Tab和子页控件按项目恢复', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await mainWindow.setViewportSize({ width: 820, height: 760 })
  const tabs = mainWindow.getByRole('tablist', { name: '版本对比窄窗栏目' })
  await expect(tabs.getByRole('tab')).toHaveText(['版本A', '版本B', '当前文案'])
  for (const tab of await tabs.getByRole('tab').all()) {
    const controls = await tab.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    await expect(mainWindow.locator(`#${controls!}`)).toHaveCount(1)
  }
  await tabs.getByRole('tab', { name: '版本B' }).click()
  await expect(mainWindow.locator('#version-working-right-panel')).toBeVisible()
  await expect(mainWindow.locator('#version-working-left-panel')).toBeHidden()
  await expect(mainWindow.locator('#version-working-right-panel')).toHaveAttribute('aria-labelledby', 'version-working-right-panel-tab')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: testInfo.outputPath('r16a-version-b-narrow.png') })
  await tabs.getByRole('tab', { name: '版本A' }).click()
  const sourceButtons = mainWindow.locator('.version-source-select')
  expect(await sourceButtons.count()).toBeGreaterThan(2)
  const chosenLabel = (await sourceButtons.nth(2).locator('b').textContent())?.trim() ?? ''
  await sourceButtons.nth(2).click()
  await expect(mainWindow.locator('#version-working-left-panel header b')).toHaveText(chosenLabel)
  await tabs.getByRole('tab', { name: '当前文案' }).click()
  await tabs.getByRole('tab', { name: '版本A' }).click()
  await expect(mainWindow.locator('#version-working-left-panel header b')).toHaveText(chosenLabel)
  await tabs.getByRole('tab', { name: '版本B' }).click()
  await mainWindow.getByRole('button', { name: '收起来源' }).click()
  await mainWindow.getByRole('button', { name: '差异' }).click()
  await expect(mainWindow.locator('.version-source-panel')).toHaveCount(0)
  await tabs.getByRole('tab', { name: '当前文案' }).click()
  await expect(mainWindow.locator('.version-current-script-layout .current-script-pane')).toBeVisible()
  await expect(mainWindow.getByRole('tabpanel')).toHaveCount(1)
  const currentScroll = mainWindow.locator('.version-current-script-layout .editor-scroll')
  await currentScroll.evaluate((element) => {
    element.querySelector('.tiptap')?.setAttribute('style', 'padding-bottom:1000px')
    element.scrollTop = 137
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchVersionCurrentScrollTop)).toBe(137)
  await tabs.getByRole('tab', { name: '版本B' }).click()
  await tabs.getByRole('tab', { name: '当前文案' }).click()
  await expect.poll(() => currentScroll.evaluate((element) => element.scrollTop)).toBe(137)
  await mainWindow.reload()
  await mainWindow.waitForLoadState('domcontentloaded')
  const restoredTabs = mainWindow.getByRole('tablist', { name: '版本对比窄窗栏目' })
  await expect(restoredTabs.getByRole('tab', { name: '当前文案' })).toHaveAttribute('aria-selected', 'true')
  const restoredScroll = mainWindow.locator('.version-current-script-layout .editor-scroll')
  await restoredScroll.evaluate((element) => {
    element.querySelector('.tiptap')?.setAttribute('style', 'padding-bottom:1000px')
  })
  await restoredTabs.getByRole('tab', { name: '版本B' }).click()
  await restoredTabs.getByRole('tab', { name: '当前文案' }).click()
  await expect.poll(() => restoredScroll.evaluate((element) => element.scrollTop)).toBe(137)
  await restoredTabs.getByRole('tab', { name: '版本B' }).click()
  await expect(mainWindow.locator('#version-working-right-panel')).toBeVisible()
  await expect(mainWindow.locator('.version-source-panel')).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '差异' })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => mainWindow.evaluate(async () => {
    const preferences = await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
    return {
      surface: preferences.workbenchVersionSurface,
      side: preferences.workbenchVersionMobileSide,
      sourceOpen: preferences.workbenchVersionSourcePanelOpen,
      diffVisible: preferences.workbenchVersionDiffVisible
    }
  })).toEqual({ surface: 'compare', side: 'right', sourceOpen: false, diffVisible: false })
  expect(pageErrors).toEqual([])
})

test('R19段落多选可按当前侧拆分，并通过历史记录撤销重做', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const workspace = await api.getDraftComparisonWorkspace('ai-browser')
    const groupIds = workspace.activeSession?.groups.slice(0, 2).map((group) => group.id) ?? []
    if (groupIds.length === 2) await api.mergeDraftAlignmentGroups('ai-browser', groupIds)
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
  })
  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await expect(mainWindow.getByRole('group', { name: '拆分范围' })).toBeVisible()
  await expect(mainWindow.locator('.comparison-reasoning-provider')).toHaveText('Codex高推理')
  await expect(mainWindow.getByLabel('双稿对照AI')).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '仅当前侧' }).click()

  const groupCards = mainWindow.locator('[data-comparison-group-id]')
  let selectedParagraphs = mainWindow.locator('never-match')
  for (let groupIndex = 0; groupIndex < await groupCards.count(); groupIndex += 1) {
    for (const side of ['codex', 'claude'] as const) {
      const paragraphs = groupCards.nth(groupIndex).locator(`[data-comparison-side="${side}"] .comparison-paragraph`)
      if (await paragraphs.count() > 1) {
        selectedParagraphs = paragraphs
        break
      }
    }
    if (await selectedParagraphs.count()) break
  }
  expect(await selectedParagraphs.count()).toBeGreaterThan(1)
  await selectedParagraphs.nth(0).click()
  await selectedParagraphs.nth(1).click({ modifiers: ['Meta'] })
  await expect(selectedParagraphs.nth(0)).toHaveClass(/paragraph-selected/)
  await expect(selectedParagraphs.nth(1)).toHaveClass(/paragraph-selected/)
  await selectedParagraphs.nth(0).dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 340 })
  const contextMenu = mainWindow.getByRole('menu')
  await expect(contextMenu).toContainText('选用所选段落')
  await expect(contextMenu).not.toContainText('选用全文')
  await contextMenu.getByText('拆分所选段落…').click()
  const beforeCount = await groupCards.count()
  await contextMenu.getByRole('button', { name: '提取到下方新组' }).click()
  await expect(groupCards).toHaveCount(beforeCount + 1)

  const tabs = mainWindow.locator('.comparison-group-tabs button')
  await expect.poll(async () => tabs.evaluateAll((items) => items.map((item) => item.textContent?.trim()))).toEqual(
    Array.from({ length: beforeCount + 1 }, (_, index) => String(index + 1))
  )
  await mainWindow.getByRole('button', { name: '历史操作' }).click()
  await expect(mainWindow.getByRole('dialog', { name: '历史操作记录' })).toContainText('提取到下方新组')
  await mainWindow.keyboard.press('Escape')
  await mainWindow.locator('body').click({ position: { x: 2, y: 2 } })
  await mainWindow.keyboard.press('Meta+z')
  await expect(groupCards).toHaveCount(beforeCount)
  await mainWindow.keyboard.press('Meta+Shift+z')
  await expect(groupCards).toHaveCount(beforeCount + 1)

  const rewriteParagraph = mainWindow.locator('[data-comparison-side="codex"] .comparison-paragraph').first()
  await rewriteParagraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 340 })
  await mainWindow.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const rewriteRequest = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await rewriteRequest.getByRole('button', { name: '润色' }).click()
  await rewriteRequest.getByRole('button', { name: '生成候选' }).click()
  await mainWindow.getByRole('button', { name: '纯净' }).click()
  const unsavedCleanEditor = mainWindow.getByLabel('纯净文案编辑区')
  await unsavedCleanEditor.fill('历史恢复后仍保留的未失焦文字')
  await expect(mainWindow.getByRole('dialog', { name: '局部改写候选' })).toBeVisible()
  await expect(unsavedCleanEditor).toHaveValue('历史恢复后仍保留的未失焦文字')
  await mainWindow.getByRole('dialog', { name: '局部改写候选' }).getByRole('button', { name: '关闭候选' }).click()
  const documentSyncPrompt = mainWindow.getByRole('alertdialog', { name: '确认对照整理同步' })
  if (await documentSyncPrompt.isVisible()) await documentSyncPrompt.getByRole('button', { name: '保留当前文案' }).click()
  await mainWindow.getByRole('button', { name: '组模式' }).click()

  await mainWindow.getByRole('button', { name: '匹配两侧' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')).workbenchComparisonSplitScope)).toBe('matched')
  expect(pageErrors).toEqual([])
})

test('R19拍摄待办可批量设置日期时段，首页合并展示并去掉重复大排期', async () => {
  await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const today = (await api.getWorkspace()).today
    await api.createSchedule({
      projectId: 'ai-browser',
      title: '整体拍摄剪辑排期',
      actionType: 'production',
      startAt: `${today}T08:00:00+08:00`,
      endAt: `${today}T20:00:00+08:00`,
      scheduleKind: 'plan',
      waitingFor: null
    })
    ;(globalThis as unknown as BrowserGlobals).location.hash = '#/project/ai-browser/production'
  })
  for (const text of ['上午拍产品特写', '下午录制口播']) {
    await mainWindow.getByPlaceholder('例如：周六去公园拍外景').fill(text)
    await mainWindow.getByRole('button', { name: '添加' }).click()
  }
  const items = mainWindow.locator('.shooting-items > div')
  await expect(items).toHaveCount(2)
  await mainWindow.getByPlaceholder('例如：周六去公园拍外景').fill('临时待办')
  await mainWindow.getByRole('button', { name: '添加' }).click()
  await items.nth(2).getByRole('button', { name: '删除拍摄待办' }).click()
  const deleteDialog = mainWindow.getByRole('alertdialog', { name: '确认删除拍摄待办' })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: '取消' }).click()
  await expect(items).toHaveCount(3)
  await items.nth(2).getByRole('button', { name: '删除拍摄待办' }).click()
  await deleteDialog.getByRole('button', { name: '确认删除' }).click()
  await expect(items).toHaveCount(2)
  await expect(mainWindow.locator('.shooting-select-button')).toHaveCount(0)
  const firstBounds = await items.nth(0).boundingBox()
  const secondBounds = await items.nth(1).boundingBox()
  expect(firstBounds).not.toBeNull()
  expect(secondBounds).not.toBeNull()
  await mainWindow.mouse.move(firstBounds!.x + firstBounds!.width * 0.55, firstBounds!.y + 9)
  await mainWindow.mouse.down()
  await mainWindow.mouse.move(secondBounds!.x + secondBounds!.width * 0.65, secondBounds!.y + secondBounds!.height - 5, { steps: 5 })
  await mainWindow.mouse.up()
  await expect(items.nth(0)).toHaveClass(/selected/)
  await expect(items.nth(1)).toHaveClass(/selected/)
  await items.nth(0).dispatchEvent('click', { metaKey: true })
  await expect(items.nth(0)).not.toHaveClass(/selected/)
  await items.nth(0).dispatchEvent('click', { metaKey: true })
  await items.nth(1).dispatchEvent('click', { metaKey: true })
  await expect(items.nth(1)).not.toHaveClass(/selected/)
  await items.nth(1).dispatchEvent('click', { metaKey: true })
  await expect(items.nth(0)).toHaveClass(/selected/)
  await expect(items.nth(1)).toHaveClass(/selected/)
  await mainWindow.getByRole('button', { name: '批量设置时间' }).click()
  const dateEditor = mainWindow.getByRole('dialog', { name: '设置拍摄待办时间' })
  await expect(dateEditor.locator('.calendar-date-grid button.today')).toHaveCount(1)
  await expect(dateEditor.locator('.calendar-date-grid button.today')).toContainText('今')
  await dateEditor.getByRole('button', { name: '今天' }).click()
  await expect(dateEditor.getByRole('button', { name: '下午' })).toBeEnabled()
  await dateEditor.getByRole('button', { name: '下午' }).click()
  await expect(dateEditor.getByRole('button', { name: '下午' })).toHaveAttribute('aria-pressed', 'true')
  await dateEditor.getByRole('button', { name: '完成', exact: true }).click()
  await expect(items.nth(0)).toContainText('下午')
  await expect(items.nth(1)).toContainText('下午')
  await mainWindow.getByRole('button', { name: '按时间', exact: true }).click()
  await expect(mainWindow.locator('.shooting-day-divider')).toContainText('今天')

  await mainWindow.getByRole('textbox', { name: '剪辑备忘录' }).fill('## 节奏\n\n- 开头加快\n- 保留环境声')
  await mainWindow.getByRole('button', { name: '标题' }).click()
  await mainWindow.getByRole('button', { name: '高亮颜色1' }).click()
  await mainWindow.getByRole('button', { name: '保存', exact: true }).click()
  await expect(mainWindow.getByRole('status')).toContainText('剪辑备忘录已保存')

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/home' })
  const todayCard = mainWindow.locator('.todo-workspace')
  await expect(todayCard).toContainText('上午拍产品特写')
  await expect(todayCard).toContainText('下午录制口播')
  await expect(todayCard).not.toContainText('整体拍摄剪辑排期')
  await todayCard.getByRole('button', { name: '完成上午拍产品特写' }).click()
  await expect(todayCard).not.toContainText('上午拍产品特写')
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProjectProductionNotes('ai-browser')).shootingItems.find((item) => item.text === '上午拍产品特写')?.completed)).toBe(true)
  expect(pageErrors).toEqual([])
})

test('R19版本对比折叠来源后仍可双栏编辑并反复另存新版本', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const before = await mainWindow.evaluate(async () => {
    const versions = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')).versions
    return { count: versions.length, sourceId: versions.find((version) => version.documentType === 'script')!.id }
  })
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await expect(mainWindow.locator('.version-working-grid')).toBeVisible()
  const left = mainWindow.getByRole('article', { name: '左侧版本编辑器' })
  const editor = left.locator('[contenteditable="true"]')
  await editor.fill('第一版独立工作副本')
  await mainWindow.keyboard.press('Meta+s')
  await expect(mainWindow.getByRole('status')).toContainText('没有保存隐藏的当前文案')
  expect(await mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')
  ).versions.length)).toBe(before.count)
  await left.getByLabel('左侧新版本名称').fill('版本对比副本A')
  await left.getByRole('button', { name: '另存新版本' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('原版本保持不变')
  await left.getByLabel('左侧新版本名称').fill('版本对比副本B')
  await left.getByRole('button', { name: '另存新版本' }).click()

  await mainWindow.getByRole('button', { name: '收起来源' }).click()
  await expect(mainWindow.locator('.version-source-panel')).toHaveCount(0)
  await expect(editor).toContainText('第一版独立工作副本')

  await mainWindow.getByRole('tab', { name: '当前文案', exact: true }).click()
  const currentEditor = mainWindow.locator('.version-current-script-layout .current-script-pane .tiptap')
  await expect(currentEditor).toBeVisible()
  await expect(mainWindow.locator('.version-working-grid')).not.toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '保存当前文案' })).toBeVisible()
  await currentEditor.fill('# 版本页共享当前文案\n\n这不是版本工作副本。')
  await expect(mainWindow.locator('.current-script-save-status')).toHaveText('已自动保存', { timeout: 10_000 })
  await mainWindow.setViewportSize({ width: 880, height: 720 })
  await mainWindow.screenshot({ path: testInfo.outputPath('r16-version-current-wide.png') })
  await mainWindow.setViewportSize({ width: 420, height: 720 })
  await mainWindow.screenshot({ path: testInfo.outputPath('r16-version-current-narrow.png') })
  await mainWindow.setViewportSize({ width: 1280, height: 820 })

  await mainWindow.getByRole('tab', { name: '版本选择与差异' }).click()
  await expect(editor).toContainText('第一版独立工作副本')
  await expect(mainWindow.locator('.version-source-panel')).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '保存当前文案' })).toHaveCount(0)
  await mainWindow.getByRole('tab', { name: '当前文案', exact: true }).click()
  await expect(currentEditor).toContainText('版本页共享当前文案')
  await mainWindow.getByRole('tab', { name: '对话模式' }).click()
  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await expect(mainWindow.getByRole('tab', { name: '当前文案', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(currentEditor).toContainText('版本页共享当前文案')
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/home' })
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  await expect(mainWindow.getByRole('tab', { name: '版本对比' })).toHaveAttribute('aria-selected', 'true')
  await expect(mainWindow.getByRole('tab', { name: '当前文案', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(currentEditor).toContainText('版本页共享当前文案')
  expect(await mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkbenchPreferences('ai-browser')
  ).workbenchVersionSurface)).toBe('current')

  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser?mode=materials' })
  await expect(mainWindow.locator('.script-material-workspace')).toBeVisible()
  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await mainWindow.getByRole('tab', { name: '当前文案', exact: true }).click()
  await currentEditor.fill('恢复前刚输入、尚在自动保存防抖中的文案。')
  await mainWindow.getByRole('tab', { name: '版本选择与差异' }).click()
  const restoreButton = left.getByRole('button', { name: '恢复到工作台' })
  await restoreButton.click()
  await expect(mainWindow.getByRole('tab', { name: '对话模式' })).toBeDisabled()
  await expect(mainWindow.getByRole('tab', { name: '当前文案', exact: true })).toBeDisabled()
  await expect(mainWindow.locator('.script-material-workspace')).toBeVisible({ timeout: 10_000 })
  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  await expect(restoreButton).toBeEnabled()
  await mainWindow.getByRole('tab', { name: '当前文案', exact: true }).click()
  await expect(currentEditor).toContainText('第一版独立工作副本')
  const result = await mainWindow.evaluate(async ({ beforeCount, sourceId }) => {
    const versions = (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser')).versions
    const source = versions.find((version) => version.id === sourceId)!
    const saved = versions.filter((version) => ['版本对比副本A', '版本对比副本B'].includes(version.displayName ?? ''))
    return {
      added: versions.length - beforeCount,
      sourceContent: source.content,
      saved: saved.map((version) => ({ name: version.displayName, parents: version.parentVersionIds }))
    }
  }, { beforeCount: before.count, sourceId: before.sourceId })
  expect(result.added).toBeGreaterThanOrEqual(2)
  expect(result.sourceContent).not.toContain('第一版独立工作副本')
  expect(result.saved).toHaveLength(2)
  expect(result.saved.every((version) => version.parents.length === 1)).toBe(true)
  expect(pageErrors).toEqual([])
})
