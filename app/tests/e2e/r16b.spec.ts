import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }
interface BrowserRect { bottom: number; height: number; left: number; right: number; top: number; width: number }
interface BrowserElement { getBoundingClientRect(): BrowserRect }
interface BrowserGeometryGlobals {
  document: {
    querySelector(selector: string): BrowserElement | null
    querySelectorAll(selector: string): Iterable<BrowserElement>
  }
}
let electronApp: ElectronApplication
let mainWindow: Page
let pageErrors: string[]
let userDataPath: string

async function launchApp(): Promise<void> {
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
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  mainWindow = await electronApp.firstWindow()
  mainWindow.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).projects.length)).toBeGreaterThan(2)
}

async function selectText(locator: Locator, selectedText: string): Promise<void> {
  await locator.evaluate((element, text) => {
    const browser = globalThis as unknown as {
      NodeFilter: { SHOW_TEXT: number }
      MouseEvent: new (type: string, options: { bubbles: boolean }) => Parameters<typeof element.dispatchEvent>[0]
    }
    const walker = element.ownerDocument.createTreeWalker(element, browser.NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const value = node.textContent ?? ''
      const index = value.indexOf(text)
      if (index >= 0) {
        const range = element.ownerDocument.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + text.length)
        const selection = element.ownerDocument.defaultView?.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        element.dispatchEvent(new browser.MouseEvent('mouseup', { bubbles: true }))
        return
      }
      node = walker.nextNode()
    }
    throw new Error(`cannot select: ${text}`)
  }, selectedText)
}

async function expectVersionFusionBasketClearOfFooter(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const browser = globalThis as unknown as BrowserGeometryGlobals
    const basket = browser.document.querySelector('.version-fusion-basket')
    const footers = Array.from(browser.document.querySelectorAll('.version-working-editor > footer'))
      .filter((footer) => {
        const rect = footer.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
    if (!basket) return { basketFound: false, footerCount: footers.length, intersections: [] as number[] }
    const basketRect = basket.getBoundingClientRect()
    return {
      basketFound: true,
      footerCount: footers.length,
      intersections: footers.flatMap((footer, index) => {
        const footerRect = footer.getBoundingClientRect()
        const overlaps = basketRect.left < footerRect.right
          && basketRect.right > footerRect.left
          && basketRect.top < footerRect.bottom
          && basketRect.bottom > footerRect.top
        return overlaps ? [index] : []
      })
    }
  })
  expect(geometry.basketFound).toBe(true)
  expect(geometry.footerCount).toBeGreaterThan(0)
  expect(geometry.intersections).toEqual([])
  const visibleFooter = page.locator('.version-working-editor:visible > footer').first()
  await visibleFooter.locator('input').click({ trial: true })
  await visibleFooter.getByRole('button', { name: '另存新版本' }).click({ trial: true })
}

async function expectVersionCandidateDockClearOfBasketAndFooter(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const browser = globalThis as unknown as BrowserGeometryGlobals
    const basket = browser.document.querySelector('.version-fusion-basket')
    const dock = browser.document.querySelector('.version-candidate-dock')
    const footers = Array.from(browser.document.querySelectorAll('.version-working-editor > footer'))
      .filter((footer) => {
        const rect = footer.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
    if (!basket || !dock) return { basketFound: Boolean(basket), dockFound: Boolean(dock), footerCount: footers.length, overlaps: true }
    const basketRect = basket.getBoundingClientRect()
    const dockRect = dock.getBoundingClientRect()
    const intersects = (left: BrowserRect, right: BrowserRect): boolean => left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top
    return {
      basketFound: true,
      dockFound: true,
      footerCount: footers.length,
      overlaps: intersects(dockRect, basketRect) || footers.some((footer) => intersects(dockRect, footer.getBoundingClientRect()))
    }
  })
  expect(geometry.basketFound).toBe(true)
  expect(geometry.dockFound).toBe(true)
  expect(geometry.footerCount).toBeGreaterThan(0)
  expect(geometry.overlaps).toBe(false)
}

async function expectCurrentCandidateDockClearOfHeader(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const browser = globalThis as unknown as BrowserGeometryGlobals
    const dock = browser.document.querySelector('.current-candidate-dock')
    const header = browser.document.querySelector('.current-script-pane > header')
    const controls = Array.from(browser.document.querySelectorAll('.current-script-pane > header button, .current-script-pane > header input, .current-script-pane > header select'))
      .filter((control) => {
        const rect = control.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
    if (!dock || !header) return { dockFound: Boolean(dock), headerFound: Boolean(header), controlCount: controls.length, overlaps: true }
    const dockRect = dock.getBoundingClientRect()
    const intersects = (left: BrowserRect, right: BrowserRect): boolean => left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top
    return {
      dockFound: true,
      headerFound: true,
      controlCount: controls.length,
      overlaps: intersects(dockRect, header.getBoundingClientRect()) || controls.some((control) => intersects(dockRect, control.getBoundingClientRect()))
    }
  })
  expect(geometry.dockFound).toBe(true)
  expect(geometry.headerFound).toBe(true)
  expect(geometry.controlCount).toBeGreaterThan(0)
  expect(geometry.overlaps).toBe(false)
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  pageErrors = []
  await launchApp()
})

test.afterEach(async () => { await electronApp?.close().catch(() => undefined) })

test('R16b当前文案、成稿对比和版本对比共用候选与冲突决定', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(90_000)
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
  const currentEditor = mainWindow.locator('.current-script-pane .tiptap')
  await expect(currentEditor).toBeVisible()
  await currentEditor.fill('需要润色的原句。第二句保留。')
  await expect(mainWindow.locator('.current-script-save-status')).toHaveText('已自动保存', { timeout: 10_000 })

  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await currentEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 760, clientY: 330 })
  const selectionMenu = mainWindow.getByRole('menu', { name: '选区操作' })
  await expect(selectionMenu).toContainText('按具体要求修改')
  await selectionMenu.getByRole('menuitem', { name: '高亮' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready' ? current.snapshot.annotations.map((annotation) => annotation.style) : []
  })).toContain('highlight')

  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await currentEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 760, clientY: 330 })
  await selectionMenu.getByRole('menuitem', { name: /添加备注/ }).click()
  const annotationPanel = mainWindow.getByRole('dialog', { name: '工作台标记' })
  await annotationPanel.getByLabel('备注（可单独保存）').fill('待复核备注')
  await annotationPanel.getByRole('button', { name: '保存备注并添加旗标' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready'
      ? current.snapshot.annotations.map((annotation) => ({ note: annotation.note, style: annotation.style }))
      : []
  })).toContainEqual({ note: '待复核备注', style: 'flag' })

  await currentEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await currentEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 760, clientY: 330 })
  await selectionMenu.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const requestPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await expect(requestPanel.getByLabel('具体修改要求')).toBeFocused()
  await mainWindow.keyboard.press('Escape')
  await expect(requestPanel).toBeHidden()
  await expect(currentEditor).toBeFocused()
  await mainWindow.setViewportSize({ width: 820, height: 760 })
  await mainWindow.getByRole('tablist', { name: '对话模式窄窗栏目' }).getByRole('tab', { name: '当前文案' }).click()
  await expect(currentEditor).toBeVisible()
  await mainWindow.keyboard.press('Meta+a')
  await currentEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 760, clientY: 330 })
  await selectionMenu.getByRole('menuitem', { name: /按具体要求修改/ }).click()
  await expect(requestPanel.getByLabel('局部修改模型').locator('option')).toContainText(['自动选择·gpt-5.6', 'gpt-5.6（默认）'])
  await requestPanel.getByLabel('局部修改模型').selectOption('gpt-5.6')
  await requestPanel.getByLabel('局部修改推理档位').selectOption('xhigh')
  await requestPanel.getByRole('button', { name: '润色' }).click()
  await requestPanel.getByRole('button', { name: '生成候选' }).click()
  const currentCandidate = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(currentCandidate).toContainText('Codex·gpt-5.6·xhigh')
  await expectCurrentCandidateDockClearOfHeader(mainWindow)
  await mainWindow.setViewportSize({ width: 2048, height: 1152 })
  await expect(currentEditor).toContainText('需要润色的原句')
  await currentCandidate.getByRole('button', { name: '继续修改' }).click()
  const currentContinuationPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await expect(currentContinuationPanel).toContainText('上一轮候选')
  await currentContinuationPanel.getByRole('button', { name: '更精简' }).click()
  await currentContinuationPanel.getByRole('button', { name: '生成候选' }).click()
  await expect(currentCandidate).toContainText('局部改写候选·第2轮')
  await expect(currentCandidate).toContainText('R16b统一候选：R16b统一候选')
  await currentCandidate.getByRole('button', { name: '替换' }).click()
  await expect(currentEditor).toContainText('R16b统一候选')
  const currentCandidateDock = mainWindow.getByRole('complementary', { name: '当前文案局部候选任务' })
  await expect(currentCandidateDock.getByRole('button')).toHaveCount(1)
  await expect(currentCandidateDock).toContainText('已完成·查看')

  await mainWindow.getByRole('tab', { name: '对照筛选' }).click()
  await mainWindow.getByRole('tab', { name: '成稿对比' }).click()
  const firstGroup = mainWindow.locator('[data-comparison-group-id]').first()
  for (const side of ['claude', 'codex'] as const) {
    const paragraph = firstGroup.locator(`[data-comparison-side="${side}"] .comparison-paragraph`).first()
    const paragraphText = (await paragraph.textContent())?.trim() ?? ''
    expect(paragraphText.length).toBeGreaterThan(0)
    await selectText(paragraph, paragraphText.slice(0, Math.min(8, paragraphText.length)))
    await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: side === 'claude' ? 300 : 520, clientY: 330 })
    const draftSelectionMenu = mainWindow.getByRole('menu', { name: '选区操作' })
    await expect(draftSelectionMenu).toHaveClass(/selection-action-popover/)
    await expect(draftSelectionMenu).toContainText(paragraphText.slice(0, Math.min(8, paragraphText.length)))
    await draftSelectionMenu.getByRole('menuitem', { name: /加入综合候选/ }).click()
    expect(pageErrors).toEqual([])
    await expect(mainWindow.getByLabel('综合候选选区')).toContainText(`·${side === 'claude' ? 1 : 3}个范围`)
    if (side === 'claude') {
      const secondRange = paragraphText.slice(-Math.min(3, paragraphText.length))
      await selectText(paragraph, secondRange)
      await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 330, clientY: 330 })
      await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: /加入综合候选/ }).click()
      const sameSourceBasket = mainWindow.getByLabel('综合候选选区')
      await expect(sameSourceBasket).toContainText('已冻结1个来源·2个范围')
      await expect(sameSourceBasket.getByRole('button', { name: /综合成统一候选/ })).toBeDisabled()
    }
  }
  const draftFusion = mainWindow.getByLabel('综合候选选区')
  await expect(draftFusion).toContainText('已冻结2个来源·3个范围')
  await draftFusion.getByRole('button', { name: /综合成统一候选/ }).click()
  const fusionPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await fusionPanel.getByRole('button', { name: '润色' }).click()
  await fusionPanel.getByRole('button', { name: '生成候选' }).click()
  const fusionCandidate = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(fusionCandidate.getByLabel('来源冲突')).toContainText('需要人工决定')
  await expect(fusionCandidate.getByLabel('来源冲突')).toContainText('Claude稿')
  await expect(fusionCandidate.getByLabel('来源冲突')).toContainText('Codex稿')
  await expect(fusionCandidate.getByRole('button', { name: '追加' })).toBeDisabled()
  await expect(fusionCandidate).toBeFocused()
  await mainWindow.keyboard.press('Shift+Tab')
  await expect(fusionCandidate.getByRole('button', { name: '继续修改' })).toBeFocused()
  await mainWindow.keyboard.press('Tab')
  await expect(fusionCandidate.getByRole('button', { name: '关闭候选' })).toBeFocused()
  // Readable text may scroll at larger type sizes; keyboard users must be able
  // to enter each reading region without the dialog trap resetting to Close.
  for (const label of ['冻结的多来源输入', '统一候选', '多来源输入与统一候选差异']) {
    await mainWindow.keyboard.press('Tab')
    await expect(fusionCandidate.getByLabel(label, { exact: true })).toBeFocused()
  }
  await mainWindow.keyboard.press('Tab')
  const conflictConfirmation = fusionCandidate.getByRole('checkbox', { name: /我已看过上述冲突/ })
  await expect(conflictConfirmation).toBeFocused()
  await expect(conflictConfirmation).not.toBeChecked()
  await expect(fusionCandidate.getByRole('button', { name: '追加' })).toBeDisabled()
  await fusionCandidate.getByRole('button', { name: '继续修改' }).click()
  const continuationPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await continuationPanel.getByRole('button', { name: '更精简' }).click()
  await continuationPanel.getByRole('button', { name: '生成候选' }).click()
  await expect(fusionCandidate).toContainText('多来源统一候选·第2轮')
  await expect(fusionCandidate.getByLabel('来源冲突')).toContainText('需要人工决定')
  await expect(fusionCandidate.getByRole('button', { name: '追加' })).toBeDisabled()
  await fusionCandidate.getByRole('checkbox', { name: /我已看过上述冲突/ }).check()
  await expect(fusionCandidate.getByRole('button', { name: '追加' })).toBeEnabled()
  await fusionCandidate.getByRole('button', { name: '保留候选' }).click()

  await mainWindow.getByRole('tab', { name: '版本对比' }).click()
  const leftVersionEditor = mainWindow.getByLabel('左侧版本编辑器').locator('.tiptap')
  await leftVersionEditor.click()
  await mainWindow.keyboard.press('Meta+a')
  await leftVersionEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 420 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: /加入综合候选/ }).click()
  await mainWindow.locator('.version-compare-picker').getByRole('button', { name: /当前文案/ }).click()
  const versionFusion = mainWindow.getByRole('complementary', { name: '版本综合来源' })
  await expect(versionFusion).toContainText('已冻结2个来源')
  await versionFusion.getByRole('button', { name: /综合成统一候选/ }).click()
  const versionPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await versionPanel.getByRole('button', { name: '润色' }).click()
  await versionPanel.getByRole('button', { name: '生成候选' }).click()
  const versionCandidate = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(versionCandidate).toContainText('多个冻结来源')
  await mainWindow.setViewportSize({ width: 2048, height: 1152 })
  await expectVersionCandidateDockClearOfBasketAndFooter(mainWindow)
  await mainWindow.setViewportSize({ width: 820, height: 760 })
  await expectVersionCandidateDockClearOfBasketAndFooter(mainWindow)
  await mainWindow.setViewportSize({ width: 2048, height: 1152 })
  await versionCandidate.getByRole('button', { name: '继续修改' }).click()
  const versionContinuationPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await versionContinuationPanel.getByRole('button', { name: '更精简' }).click()
  await versionContinuationPanel.getByRole('button', { name: '生成候选' }).click()
  await expect(versionCandidate).toContainText('多来源统一候选·第2轮')
  await expect(versionCandidate.getByLabel('来源冲突')).toContainText('多个冻结来源')
  await expect(versionCandidate.getByRole('button', { name: '追加' })).toBeDisabled()
  await versionCandidate.getByRole('checkbox', { name: /我已看过上述冲突/ }).check()
  await versionCandidate.getByRole('button', { name: '追加' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('原版本和当前文案未改动')

  const isolatedConversations = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const [ordinary, versions] = await Promise.all([
      api.getScriptRevisionConversation('ai-browser', null, 'codex_cli'),
      api.getScriptRevisionConversation('ai-browser', null, 'codex_cli', 'version_compare')
    ])
    const taskIds = versions.messages.filter((message) => message.role === 'user' && message.taskId).map((message) => message.taskId!)
    const traces = await Promise.all(taskIds.map((taskId) => api.getContentInstructionRequestByTask(taskId)))
    return { ordinary, versions, traces }
  })
  expect(isolatedConversations.ordinary.surface).toBe('conversation')
  expect(isolatedConversations.ordinary.messages.some((message) => message.selectionSnapshot?.applicationTarget?.surface === 'version_compare')).toBe(false)
  expect(isolatedConversations.versions.surface).toBe('version_compare')
  expect(isolatedConversations.versions.threadId).toBeNull()
  expect(isolatedConversations.versions.messages.some((message) => message.selectionSnapshot?.applicationTarget?.surface === 'version_compare')).toBe(true)
  const continuedTrace = isolatedConversations.traces.find((record) => record.targets.some((target) => target.historyMessageIds.length > 0))
  expect(continuedTrace?.request.surface).toBe('script_version_comparison')
  expect(continuedTrace?.targets[0]?.historyThreadId).toBeTruthy()
  expect(continuedTrace?.targets[0]?.historyMessageIds.length).toBeGreaterThan(0)

  const sideSelector = mainWindow.getByRole('group', { name: '选择要更换的对比栏' })
  await sideSelector.getByRole('button').nth(1).click()
  await mainWindow.getByLabel('粘贴对比文字').fill('右侧安全对照稿，不能被左侧候选覆盖。')
  await mainWindow.getByRole('button', { name: '加入B' }).click()
  const rightVersionEditor = mainWindow.getByLabel('右侧版本编辑器').locator('.tiptap')
  const leftBeforeLocalRewrite = (await leftVersionEditor.textContent()) ?? ''
  const rightBeforeLocalRewrite = (await rightVersionEditor.textContent()) ?? ''
  const localSelection = leftBeforeLocalRewrite.trim().slice(0, Math.min(8, leftBeforeLocalRewrite.trim().length))
  expect(localSelection.length).toBeGreaterThan(0)
  await selectText(leftVersionEditor, localSelection)
  await leftVersionEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 420 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: /按具体要求修改/ }).click()
  const localVersionPanel = mainWindow.getByRole('dialog', { name: '按具体要求修改' })
  await localVersionPanel.getByRole('button', { name: '润色' }).click()
  await localVersionPanel.getByRole('button', { name: '生成候选' }).click()
  const localVersionCandidate = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await mainWindow.waitForTimeout(1_000)
  expect(pageErrors).toEqual([])
  await expect(localVersionCandidate).toBeVisible()
  await rightVersionEditor.evaluate((element) => (element as HTMLElement).focus())
  await expect(localVersionCandidate).toBeVisible()
  await localVersionCandidate.getByRole('button', { name: '替换' }).click()
  await expect.poll(() => rightVersionEditor.textContent()).toBe(rightBeforeLocalRewrite)
  await expect.poll(() => leftVersionEditor.textContent()).not.toBe(leftBeforeLocalRewrite)

  const leftAfterLocalRewrite = (await leftVersionEditor.textContent()) ?? ''
  const staleSelection = leftAfterLocalRewrite.trim().slice(-Math.min(8, leftAfterLocalRewrite.trim().length))
  expect(staleSelection.length).toBeGreaterThan(0)
  await selectText(leftVersionEditor, staleSelection)
  await leftVersionEditor.dispatchEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 420 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: /按具体要求修改/ }).click()
  await localVersionPanel.getByRole('button', { name: '润色' }).click()
  await localVersionPanel.getByRole('button', { name: '生成候选' }).click()
  await expect(localVersionCandidate).toBeVisible()
  expect(pageErrors).toEqual([])
  await leftVersionEditor.evaluate((element) => (element as HTMLElement).focus())
  await mainWindow.keyboard.press('Meta+ArrowRight')
  await mainWindow.keyboard.type('目标变更')
  await expect(localVersionCandidate).toContainText('原目标已变化')
  await expect(localVersionCandidate.getByRole('button', { name: '追加' })).toBeDisabled()
  await expect(localVersionCandidate.getByRole('button', { name: '替换' })).toBeDisabled()
  await localVersionCandidate.getByRole('button', { name: '保留候选' }).click()
  const versionCandidateDock = mainWindow.getByRole('complementary', { name: '版本局部候选任务' })
  await expect(versionCandidateDock).toContainText('已完成·查看')
  await versionCandidateDock.getByRole('button').last().click()
  await expect(localVersionCandidate).toContainText('原目标已变化')
  await localVersionCandidate.getByRole('button', { name: '保留候选' }).click()

  await mainWindow.setViewportSize({ width: 2048, height: 1152 })
  await expectVersionFusionBasketClearOfFooter(mainWindow)
  await mainWindow.screenshot({ path: testInfo.outputPath('r16b-unified-workbench-wide.png') })
  await mainWindow.setViewportSize({ width: 820, height: 760 })
  await expectVersionFusionBasketClearOfFooter(mainWindow)
  await mainWindow.screenshot({ path: testInfo.outputPath('r16b-unified-workbench-narrow.png') })
  expect(pageErrors).toEqual([])
})

test('R16b素材来源标记只在精确对应时迁入当前文案', async () => {
  test.setTimeout(60_000)
  const setup = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    await api.saveScriptMaterialWorkspace('ai-browser', { workingContent: '素材原稿。', requirement: '保留参数。' })
    const workspace = await api.createScriptMaterialRevision('ai-browser')
    return workspace.activeRevision!.id
  })
  await electronApp.close()
  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  const content = '官方参数是120克，真实体验很轻巧。'
  const createdAt = new Date().toISOString()
  database.prepare(`INSERT INTO script_material_drafts (
    id, project_id, revision_id, side, source_kind, provider_config_id, provider_kind, model,
    reasoning_effort, provider_fingerprint, requirement, input_fingerprint, content, content_hash,
    paragraphs_json, task_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    'r16b-material-draft', 'ai-browser', setup, 'codex', 'provider', 'builtin-codex-cli', 'codex_cli',
    'gpt-5.6', 'xhigh', 'r16b-e2e', '素材标记迁移', 'r16b-input', content,
    createHash('sha256').update(content).digest('hex'),
    JSON.stringify([{ id: 'r16b-material-p-1', position: 0, text: content, sourcePointIds: [], transform: 'preserved', provenance: [], webSources: [], annotations: [], manualMarks: [] }]),
    createdAt, createdAt
  )
  const contentHash = createHash('sha256').update(content).digest('hex')
  database.prepare(`INSERT INTO script_material_rewrite_candidates (
    id,project_id,revision_id,draft_id,side,parent_candidate_id,application_target_json,paragraph_ids_json,selected_text,
    selected_start,selected_end,requirement,content,source_point_ids_json,annotations_json,
    provider_config_id,provider_kind,model,reasoning_effort,source_selections_json,conflicts_json,task_id,created_at
  ) VALUES (?,?,?,?,?,?,?,?,'',NULL,NULL,?,?,?,?,?,?,?,?,?,? ,NULL,?)`).run(
    'r16b-material-candidate', 'ai-browser', setup, 'r16b-material-draft', 'codex', null,
    JSON.stringify({ targetId: 'material-relation:r16b-material-draft:r16b-material-p-1', selectedText: content, contentHash, from: 1, to: content.length + 1 }),
    JSON.stringify(['r16b-material-p-1']), '更精简', '官方参数120克，手感轻巧。', JSON.stringify([]), JSON.stringify([]),
    'builtin-codex-cli', 'codex_cli', 'gpt-5.6', 'xhigh', JSON.stringify([{
      selectionId: 'r16b-material-selection', position: 0, sourceKind: 'material_draft', sourceId: 'r16b-material-draft',
      sourceVersion: contentHash, sourceContentHash: contentHash, sourceLabel: 'Codex稿·第1段', semanticGroupId: null,
      blockId: 'r16b-material-p-1', blockStart: 0, blockEnd: content.length, selectedText: content
    }]), JSON.stringify([]), createdAt
  )
  database.close()
  await launchApp()
  await mainWindow.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser?mode=materials' })
  const paragraph = mainWindow.locator('.script-material-paragraph-content').filter({ hasText: '官方参数是120克' }).first()
  await expect(paragraph).toBeVisible()
  await selectText(paragraph, '官方参数')
  await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 520, clientY: 360 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: '高亮' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('高亮已保存为工作台标记')
  await selectText(paragraph, '参数')
  await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 540, clientY: 360 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: '清除标记' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.listSourceScriptAnnotations('ai-browser')
  ).map((annotation) => ({ text: annotation.selectedText, start: annotation.blockStart, end: annotation.blockEnd })))).toContainEqual({ text: '官方', start: 0, end: 2 })
  await mainWindow.getByRole('button', { name: '替换当前文案' }).click()
  await expect.poll(() => mainWindow.evaluate(async () => {
    const current = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
    return current.status === 'ready'
      ? current.snapshot.annotations.map((annotation) => ({ text: annotation.selectedText, style: annotation.style }))
      : []
  })).toContainEqual({ text: '官方', style: 'highlight' })
  const currentMaterialEditor = mainWindow.locator('.current-script-pane .tiptap')
  await currentMaterialEditor.fill('用户手动修改过的当前文案。')
  await expect(mainWindow.locator('.current-script-save-status')).toHaveText('已自动保存', { timeout: 10_000 })
  await paragraph.dispatchEvent('contextmenu', { bubbles: true, clientX: 520, clientY: 360 })
  await mainWindow.getByRole('menu', { name: '选区操作' }).getByRole('menuitem', { name: /查看最近候选/ }).click()
  const staleMaterialCandidate = mainWindow.getByRole('dialog', { name: '局部改写候选' })
  await expect(staleMaterialCandidate).toContainText('原目标已变化')
  await expect(staleMaterialCandidate.getByRole('button', { name: '追加' })).toBeDisabled()
  await expect(staleMaterialCandidate.getByRole('button', { name: '替换' })).toBeDisabled()
  expect(pageErrors).toEqual([])
})
