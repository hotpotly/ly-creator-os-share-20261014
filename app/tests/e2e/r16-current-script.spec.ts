import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string; reload(): void }
}

async function launch(userDataPath: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect.poll(() => window.evaluate(async () => (
    await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
  ).projects.length)).toBeGreaterThan(2)
  return { app, window }
}

async function waitForCurrentScriptAutosave(window: Page): Promise<void> {
  const status = window.locator('.current-script-save-status')
  await expect(status).not.toHaveText('已自动保存', { timeout: 2_000 })
  await expect(status).toHaveText('已自动保存', { timeout: 10_000 })
}

test('R16唯一当前文案自动保存、版本冻结、冲突双保留并跨模式重开', async ({ browserName }, testInfo) => {
  test.setTimeout(90_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  let running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      await api.saveScript('ai-browser', 'merged_draft', '# 活动文案起点\n\n这是初始正文。', undefined, 'R16起点')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    let editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor).toContainText('活动文案起点')
    await expect(running.window.locator('.current-script-save-status')).toHaveText('已自动保存')

    await editor.fill('模式共享的第一版当前文案。')
    await expect(running.window.locator('.current-script-save-status')).toHaveText('已自动保存', { timeout: 10_000 })
    const savedText = await running.window.evaluate(async () => {
      const result = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return result.status === 'ready' ? result.snapshot.blocks.map((block) => block.text).join('\n') : ''
    })
    expect(savedText).toContain('模式共享的第一版当前文案')

    await running.window.getByRole('tab', { name: '对照筛选' }).click()
    await running.window.getByRole('tab', { name: '素材成稿' }).click()
    await expect(running.window.locator('.current-script-pane .tiptap')).toContainText('模式共享的第一版当前文案')
    await running.window.screenshot({ path: testInfo.outputPath('r16-current-script-wide.png') })
    await running.window.getByRole('tab', { name: '对话模式' }).click()

    await running.window.getByLabel('本次版本名称').fill('共享活动文案')
    await running.window.getByRole('button', { name: '保存当前文案' }).click()
    await expect(running.window.getByRole('status')).toContainText('已保存')
    const frozen = await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript('ai-browser')
      if (current.status !== 'ready' || !current.snapshot.document.lastSavedVersionId) return null
      return api.getCurrentScriptVersionSnapshot('ai-browser', current.snapshot.document.lastSavedVersionId)
    })
    expect(frozen?.blocks.map((block) => block.text).join('\n')).toContain('模式共享的第一版当前文案')

    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript('ai-browser')
      if (current.status !== 'ready') throw new Error('expected current script')
      const editorDocument = structuredClone(current.snapshot.document.editorDocument)
      const content = (editorDocument.content as Array<Record<string, unknown>>)
      content[0] = {
        ...content[0],
        type: 'paragraph',
        content: [{ type: 'text', text: '服务端已保存的新内容。' }]
      }
      await api.applyProjectCurrentScriptTransaction({
        projectId: 'ai-browser',
        workingDocumentId: current.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(),
        expectedRevision: current.snapshot.document.revision,
        expectedContentHash: current.snapshot.document.contentHash,
        editorDocument,
        sourceRelations: [],
        annotations: []
      })
    })
    await editor.fill('本地还没来得及保存的内容。')
    let recoveryDialog = running.window.getByRole('alertdialog', { name: '选择如何处理文案冲突' })
    await expect(recoveryDialog).toBeVisible({ timeout: 10_000 })
    await running.window.screenshot({ path: testInfo.outputPath('r16-recovery-wide.png') })
    await running.window.setViewportSize({ width: 420, height: 720 })
    await expect(recoveryDialog).toBeVisible()
    await running.window.screenshot({ path: testInfo.outputPath('r16-recovery-narrow.png') })
    expect(await running.window.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.listCurrentScriptRecoveryCandidates('ai-browser').then((items) => items.length))).toBe(1)
    await running.app.close()
    running = await launch(userDataPath)
    await running.window.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
    editor = running.window.locator('.current-script-pane .tiptap')
    recoveryDialog = running.window.getByRole('alertdialog', { name: '选择如何处理文案冲突' })
    await expect(recoveryDialog).toBeVisible()
    await running.window.setViewportSize({ width: 880, height: 720 })
    expect(await running.window.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.listCurrentScriptRecoveryCandidates('ai-browser').then((items) => items.length))).toBe(1)
    for (const appearance of [
      { visualStyle: 'warm', theme: 'light' },
      { visualStyle: 'warm', theme: 'dark' },
      { visualStyle: 'feishu', theme: 'light' },
      { visualStyle: 'feishu', theme: 'dark' }
    ] as const) {
      await running.window.evaluate(async (next) => { await (globalThis as unknown as BrowserGlobals).creatorOS!.setPreferences(next) }, appearance)
      await expect(running.window.locator('html')).toHaveAttribute('data-theme', appearance.theme)
      await expect(running.window.locator('html')).toHaveAttribute('data-visual-style', appearance.visualStyle)
      await running.window.screenshot({ path: testInfo.outputPath(`r16-recovery-${appearance.visualStyle}-${appearance.theme}.png`) })
    }
    await recoveryDialog.getByRole('button', { name: /另存副本/ }).click()
    await expect(recoveryDialog).toHaveCount(0)
    await expect(editor).toContainText('服务端已保存的新内容')
    await running.window.setViewportSize({ width: 420, height: 720 })
    await running.window.screenshot({ path: testInfo.outputPath('r16-current-script-narrow.png') })
    const recoveryState = await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const [recovery, project] = await Promise.all([
        api.listCurrentScriptRecoveryCandidates('ai-browser'),
        api.getProject('ai-browser')
      ])
      return {
        recoveryCount: recovery.length,
        hasConflictCopy: project?.versions.some((version) => version.displayName === '冲突副本') ?? false
      }
    })
    expect(recoveryState).toEqual({ recoveryCount: 0, hasConflictCopy: true })

    await running.app.close()
    running = await launch(userDataPath)
    await running.window.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
    await expect(running.window.locator('.current-script-pane .tiptap')).toContainText('服务端已保存的新内容')
    await expect(running.window.locator('.current-script-save-status')).toHaveText('已自动保存')
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16显式保存版本遇到并发修改时仍显示恢复选择', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      await api.saveScript('ai-browser', 'merged_draft', '显式保存冲突起点。', undefined, 'R16显式保存起点')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    const editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor).toContainText('显式保存冲突起点')
    await expect(running.window.locator('.current-script-save-status')).toHaveText('已自动保存')

    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript('ai-browser')
      if (current.status !== 'ready') throw new Error('expected current script')
      const editorDocument = structuredClone(current.snapshot.document.editorDocument)
      const content = editorDocument.content as Array<Record<string, unknown>>
      content[0] = {
        ...content[0],
        type: 'paragraph',
        content: [{ type: 'text', text: '显式保存前，服务端已有新内容。' }]
      }
      await api.applyProjectCurrentScriptTransaction({
        projectId: 'ai-browser',
        workingDocumentId: current.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(),
        expectedRevision: current.snapshot.document.revision,
        expectedContentHash: current.snapshot.document.contentHash,
        editorDocument,
        sourceRelations: [],
        annotations: []
      })
    })

    await running.window.getByRole('button', { name: '保存当前文案' }).click()
    const recoveryDialog = running.window.getByRole('alertdialog', { name: '选择如何处理文案冲突' })
    await expect(recoveryDialog).toBeVisible({ timeout: 10_000 })
    await recoveryDialog.getByRole('button', { name: /放弃本地副本/ }).click()
    await expect(recoveryDialog).toHaveCount(0)
    await expect(editor).toContainText('显式保存前，服务端已有新内容')
    await editor.click()
    await running.window.keyboard.press('Meta+z')
    await expect(editor).toContainText('显式保存前，服务端已有新内容')

    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript('ai-browser')
      if (current.status !== 'ready') throw new Error('expected current script')
      const editorDocument = structuredClone(current.snapshot.document.editorDocument)
      const content = editorDocument.content as Array<Record<string, unknown>>
      content[0] = { ...content[0], content: [{ type: 'text', text: '替换前服务端再次更新。' }] }
      await api.applyProjectCurrentScriptTransaction({
        projectId: 'ai-browser', workingDocumentId: current.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(), expectedRevision: current.snapshot.document.revision,
        expectedContentHash: current.snapshot.document.contentHash, editorDocument, sourceRelations: [], annotations: []
      })
    })
    await editor.fill('用户明确选择保留的本地替换稿。')
    const replaceDialog = running.window.getByRole('alertdialog', { name: '选择如何处理文案冲突' })
    await expect(replaceDialog).toContainText('替换前服务端再次更新')
    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript('ai-browser')
      if (current.status !== 'ready') throw new Error('expected current script')
      const editorDocument = structuredClone(current.snapshot.document.editorDocument)
      const content = editorDocument.content as Array<Record<string, unknown>>
      content[0] = { ...content[0], content: [{ type: 'text', text: '确认替换前，服务端第三次更新。' }] }
      await api.applyProjectCurrentScriptTransaction({
        projectId: 'ai-browser', workingDocumentId: current.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(), expectedRevision: current.snapshot.document.revision,
        expectedContentHash: current.snapshot.document.contentHash, editorDocument, sourceRelations: [], annotations: []
      })
    })
    await replaceDialog.getByRole('button', { name: /用副本替换/ }).click()
    await expect(replaceDialog).toContainText('服务端刚刚又有修改')
    await expect(replaceDialog).toContainText('确认替换前，服务端第三次更新')
    await replaceDialog.getByRole('button', { name: /用副本替换/ }).click()
    await expect(replaceDialog).toHaveCount(0)
    await expect(editor).toContainText('用户明确选择保留的本地替换稿')
    expect(await running.window.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.listCurrentScriptRecoveryCandidates('ai-browser').then((items) => items.length))).toBe(0)
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16在自动保存前关闭也会恢复本地文案且不会重复制造冲突副本', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  let running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      await api.saveScript('ai-browser', 'merged_draft', '崩溃恢复起点。', undefined, '崩溃恢复起点')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    const editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor).toContainText('崩溃恢复起点')
    await expect(running.window.locator('.current-script-save-status')).toHaveText('已自动保存')
    await editor.fill('自动保存计时器触发前也不能丢失的本地文案。')
    await expect.poll(() => running.window.evaluate(() => Boolean(localStorage.getItem('current-script-recovery-journal:ai-browser')))).toBe(true)
    await running.app.close()

    running = await launch(userDataPath)
    await running.window.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser' })
    const reopenedEditor = running.window.locator('.current-script-pane .tiptap')
    await expect(reopenedEditor).toContainText('自动保存计时器触发前也不能丢失的本地文案')
    await expect(running.window.getByRole('alertdialog', { name: '选择如何处理文案冲突' })).toHaveCount(0)
    await expect.poll(() => running.window.evaluate(() => Boolean(localStorage.getItem('current-script-recovery-journal:ai-browser'))), { timeout: 10_000 }).toBe(false)
    const recovered = await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const [head, recovery] = await Promise.all([
        api.loadProjectCurrentScript('ai-browser'),
        api.listCurrentScriptRecoveryCandidates('ai-browser')
      ])
      return {
        text: head.status === 'ready' ? head.snapshot.blocks.map((block) => block.text).join('\n') : '',
        recoveryCount: recovery.length,
        journalExists: Boolean(localStorage.getItem('current-script-recovery-journal:ai-browser'))
      }
    })
    expect(recovered).toEqual({
      text: expect.stringContaining('自动保存计时器触发前也不能丢失的本地文案'),
      recoveryCount: 0,
      journalExists: false
    })
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16提交成功但响应丢失后若服务端继续前进会显示双稿冲突而不是回退', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      await api.saveScript('ai-browser', 'merged_draft', '响应丢失测试起点。', undefined, '响应丢失起点')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    await expect(running.window.locator('.current-script-pane .tiptap')).toContainText('响应丢失测试起点')
    await running.window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript('ai-browser')
      if (current.status !== 'ready') throw new Error('expected current script')
      const localDocument = structuredClone(current.snapshot.document.editorDocument)
      const localContent = localDocument.content as Array<Record<string, unknown>>
      localContent[0] = { ...localContent[0], content: [{ type: 'text', text: '其实已经提交成功的本地A稿。' }] }
      const journal = {
        projectId: 'ai-browser',
        workingDocumentId: current.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(),
        expectedRevision: current.snapshot.document.revision,
        expectedContentHash: current.snapshot.document.contentHash,
        editorDocument: localDocument,
        sourceRelations: [],
        annotations: []
      }
      localStorage.setItem('current-script-recovery-journal:ai-browser', JSON.stringify(journal))
      const committed = await api.applyProjectCurrentScriptTransaction(journal)
      if (committed.status !== 'applied') throw new Error('expected committed A')
      const serverDocument = structuredClone(committed.snapshot.document.editorDocument)
      const serverContent = serverDocument.content as Array<Record<string, unknown>>
      serverContent[0] = { ...serverContent[0], content: [{ type: 'text', text: 'A之后服务端继续写成B稿。' }] }
      const advanced = await api.applyProjectCurrentScriptTransaction({
        projectId: 'ai-browser',
        workingDocumentId: committed.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(),
        expectedRevision: committed.snapshot.document.revision,
        expectedContentHash: committed.snapshot.document.contentHash,
        editorDocument: serverDocument,
        sourceRelations: [],
        annotations: []
      })
      if (advanced.status !== 'applied') throw new Error('expected advanced B')
      ;(globalThis as unknown as BrowserGlobals).location.reload()
    })
    await running.window.waitForLoadState('domcontentloaded')
    const dialog = running.window.getByRole('alertdialog', { name: '选择如何处理文案冲突' })
    await expect(dialog).toContainText('A之后服务端继续写成B稿', { timeout: 10_000 })
    await expect(dialog).toContainText('其实已经提交成功的本地A稿')
    const live = await running.window.evaluate(async () => {
      const result = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return result.status === 'ready' ? result.snapshot.blocks.map((block) => block.text).join('\n') : ''
    })
    expect(live).toContain('A之后服务端继续写成B稿')
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16段落拆分与合并会生成新block身份并保留双向血缘', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      await (globalThis as unknown as BrowserGlobals).creatorOS!.saveScript('ai-browser', 'merged_draft', '甲乙', undefined, '血缘起点')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    const editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor).toContainText('甲乙')
    const origin = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks[0]!.blockId : ''
    })
    await editor.click()
    await editor.evaluate((element) => {
      ;(element as unknown as { focus(): void }).focus()
      const textNode = element.querySelector('p')?.firstChild
      if (!textNode) throw new Error('expected paragraph text')
      const browser = globalThis as unknown as {
        document: { createRange(): { setStart(node: unknown, offset: number): void; collapse(value: boolean): void } }
        getSelection(): { removeAllRanges(): void; addRange(range: unknown): void } | null
      }
      const selection = browser.getSelection()
      const range = browser.document.createRange()
      range.setStart(textNode, 1)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await running.window.waitForTimeout(80)
    await running.window.keyboard.press('Enter')
    await expect(editor.locator('p')).toHaveCount(2)
    await waitForCurrentScriptAutosave(running.window)
    const split = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks : []
    })
    expect(split).toHaveLength(2)
    expect(split.every((block) => block.parentBlockIds.includes(origin))).toBe(true)
    const splitDomIds = await editor.locator('p').evaluateAll((paragraphs) => paragraphs.map((paragraph) => paragraph.getAttribute('data-current-script-block-id')))
    expect(splitDomIds).toEqual(split.map((block) => block.blockId))
    await editor.locator('p').nth(1).click()
    await running.window.keyboard.press('Meta+ArrowLeft')
    await running.window.keyboard.press('Backspace')
    await expect(editor.locator('p')).toHaveCount(1)
    await expect(editor.locator('p')).toHaveText('甲乙')
    const mergedDomId = await editor.locator('p').getAttribute('data-current-script-block-id')
    expect(mergedDomId).not.toBe(split[0]!.blockId)
    await waitForCurrentScriptAutosave(running.window)
    const merged = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks : []
    })
    expect(merged).toHaveLength(1)
    expect(merged[0]!.blockId).not.toBe(split[0]!.blockId)
    expect(merged[0]!.parentBlockIds).toEqual(expect.arrayContaining(split.map((block) => block.blockId)))
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16单独删除中间段落不会误判为相邻段落合并', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      await (globalThis as unknown as BrowserGlobals).creatorOS!.saveScript(
        'ai-browser', 'merged_draft', '<p>第一段</p><p>中间段</p><p>第三段</p>', undefined, '独立删除起点'
      )
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    const editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor.locator('p')).toHaveCount(3)
    const before = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks : []
    })
    await editor.locator('p').nth(1).click()
    await running.window.keyboard.press('Meta+ArrowLeft')
    await running.window.keyboard.press('Shift+Meta+ArrowRight')
    await running.window.keyboard.press('Backspace')
    await expect(editor.locator('p').nth(1)).toHaveText('')
    await running.window.keyboard.press('Delete')
    await expect(editor.locator('p')).toHaveCount(2)
    await waitForCurrentScriptAutosave(running.window)
    const after = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks : []
    })
    expect(after.map((block) => block.text)).toEqual(['第一段', '第三段'])
    expect(after.map((block) => block.blockId)).toEqual([before[0]!.blockId, before[2]!.blockId])
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16跨标题与正文合并仍生成新block并保留两边血缘', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      await (globalThis as unknown as BrowserGlobals).creatorOS!.saveScript(
        'ai-browser', 'merged_draft', '<h1>跨类型标题</h1><p>跨类型正文</p>', undefined, '跨类型血缘起点'
      )
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    const editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor.locator('h1')).toHaveText('跨类型标题')
    await expect(editor.locator('p')).toHaveText('跨类型正文')
    const before = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks : []
    })
    expect(before).toHaveLength(2)
    await editor.locator('p').click()
    await editor.locator('p').evaluate((element) => {
      ;(element as HTMLElement).focus()
      const node = element.firstChild
      if (!node) throw new Error('expected paragraph text')
      const range = element.ownerDocument.createRange()
      range.setStart(node, 0)
      range.collapse(true)
      const selection = element.ownerDocument.defaultView?.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      element.ownerDocument.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    })
    await running.window.waitForTimeout(80)
    await running.window.keyboard.press('Backspace')
    await expect.poll(() => editor.locator('p, h1').evaluateAll((elements) => (
      elements.filter((element) => element.textContent?.trim()).length
    ))).toBe(1)
    await expect(editor).toContainText('跨类型标题跨类型正文')
    await waitForCurrentScriptAutosave(running.window)
    const after = await running.window.evaluate(async () => {
      const head = await (globalThis as unknown as BrowserGlobals).creatorOS!.loadProjectCurrentScript('ai-browser')
      return head.status === 'ready' ? head.snapshot.blocks : []
    })
    const merged = after.filter((block) => block.text)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.blockId).not.toBe(before[0]!.blockId)
    expect(merged[0]!.parentBlockIds).toEqual(expect.arrayContaining(before.map((block) => block.blockId)))
  } finally {
    await running.app.close().catch(() => undefined)
  }
})

test('R16损坏的本地恢复稿不会被静默删除且只能显式放弃', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const running = await launch(userDataPath)
  try {
    await running.window.evaluate(async () => {
      await (globalThis as unknown as BrowserGlobals).creatorOS!.saveScript('ai-browser', 'merged_draft', '服务端安全正文。', undefined, '损坏恢复稿测试')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/ai-browser'
    })
    const editor = running.window.locator('.current-script-pane .tiptap')
    await expect(editor).toContainText('服务端安全正文')
    await running.window.evaluate(() => {
      localStorage.setItem('current-script-recovery-journal:ai-browser', '{损坏的恢复稿')
      ;(globalThis as unknown as BrowserGlobals).location.reload()
    })
    await running.window.waitForLoadState('domcontentloaded')
    const dialog = running.window.getByRole('alertdialog', { name: '当前文案没有载入' })
    await expect(dialog).toContainText('本地恢复稿已保留')
    await expect(dialog).toContainText('数据不完整或格式已损坏')
    await running.window.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await running.window.keyboard.press('Meta+j')
    await expect(dialog).toBeVisible()
    await running.window.setViewportSize({ width: 420, height: 720 })
    await running.window.screenshot({ path: testInfo.outputPath('r16-load-error-narrow.png') })
    expect(await running.window.evaluate(() => localStorage.getItem('current-script-recovery-journal:ai-browser'))).toBe('{损坏的恢复稿')
    await dialog.getByRole('button', { name: /重试恢复/ }).click()
    await expect(dialog).toContainText('本地恢复稿已保留')
    await dialog.getByRole('button', { name: '放弃本地恢复稿，载入服务端' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(running.window.locator('.current-script-pane .tiptap')).toContainText('服务端安全正文')
    await expect.poll(() => running.window.evaluate(() => localStorage.getItem('current-script-recovery-journal:ai-browser')), { timeout: 10_000 }).toBeNull()
  } finally {
    await running.app.close().catch(() => undefined)
  }
})
