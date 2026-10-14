import { _electron as electron, expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals { creatorOS?: CreatorOSApi; location: { hash: string } }

test('R16d结构化Composer支持@搜索、键盘、待定回退、用途设置和项目记忆', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  const app = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_TEST_R16C_PREPARE: '1',
      CREATOR_OS_TEST_R16D_DISPATCH: '1',
      CREATOR_OS_TEST_R16D_ROLLBACK: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect.poll(() => window.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).projects.length)).toBeGreaterThan(2)
    await window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      await api.saveProjectTextMaterial('sponsor', 'brief', 'R16d客户Brief', '16T版本，参数必须以客户Brief为准')
      await api.saveProjectTextMaterial('sponsor', 'project_material', 'R16d外观资料', '机身为铝合金，正面有状态灯')
      ;(globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/sponsor'
    })
    const composer = window.getByLabel('文案对话要求')
    await expect(composer).toBeVisible()
    await composer.click()
    await window.keyboard.insertText('@')
    const picker = window.getByRole('dialog', { name: '选择本次引用' })
    await expect(picker).toBeVisible()
    const search = window.getByRole('combobox', { name: '搜索本次引用' })
    await expect(search).toHaveAttribute('placeholder', '搜索本次素材、Brief、项目资料、图片、大纲、版本和对话……')
    await search.fill('R16d')
    await expect(picker.getByRole('option')).toHaveCount(2)
    await search.press('End')
    await expect(search).toHaveAttribute('aria-activedescendant', /reference-picker-option-/)
    await search.press('Home')
    await search.press('ArrowUp')
    await expect(picker.getByRole('option').last()).toHaveAttribute('aria-selected', 'true')
    await search.fill('R16d客户')
    await expect(picker.getByRole('option')).toHaveCount(1)
    await search.press('ArrowDown')
    await search.press('Enter')
    const chip = window.locator('.structured-reference-chip', { hasText: 'R16d客户Brief' })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveClass(/role-pending/)
    await expect(window.getByText('1个引用用途待定')).toBeVisible()
    await window.getByRole('button', { name: '本轮按普通参考继续' }).click()
    await expect(window.getByText('1个引用用途待定')).toHaveCount(0)

    await chip.click()
    const roleDialog = window.getByRole('dialog', { name: '设置引用用途' })
    await expect(roleDialog).toBeVisible()
    await roleDialog.getByLabel('引用用途').click()
    await expect(window.getByRole('menu', { name: '引用用途选项' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(roleDialog).toBeVisible()
    await expect(roleDialog.getByLabel('引用用途')).toBeFocused()
    await roleDialog.getByLabel('引用用途').click()
    await window.getByRole('menuitemradio', { name: '只参考风格' }).click()
    await roleDialog.getByLabel('限定方面（可不填）').fill('语气')
    await roleDialog.getByText('记住这份引用的用法').click()
    const memoryCheckbox = roleDialog.getByRole('checkbox')
    expect((await memoryCheckbox.boundingBox())?.width).toBeLessThanOrEqual(16)
    await roleDialog.getByRole('button', { name: '应用本次设置' }).click()
    await expect(chip).toHaveClass(/role-style_reference/)
    const remembered = await window.evaluate(async () => {
      const items = await (globalThis as unknown as BrowserGlobals).creatorOS!.listStructuredReferenceCatalog('sponsor', 'script-conversation:sponsor')
      return items.find((item) => item.label === 'R16d客户Brief')?.rememberedUse ?? null
    })
    expect(remembered).toEqual({ role: 'style_reference', aspect: '语气', scope: 'whole_source' })

    const beforeScriptTaskIds = await window.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.map((task) => task.id))
    const contextButton = window.getByRole('button', { name: '项目上下文' }).first()
    if (await contextButton.getAttribute('aria-pressed') !== 'true') await contextButton.click()
    await composer.click()
    await window.keyboard.press('End')
    await window.keyboard.insertText(' 只参考语气')
    await window.locator('.structured-reference-submit').click()
    const loadTrace = async () => window.evaluate(async (knownIds) => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const task = (await api.getWorkspace()).tasks
        .filter((item) => item.projectId === 'sponsor' && item.taskType === 'script_revision' && !knownIds.includes(item.id))
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0]
      if (!task) return null
      return { task, record: await api.getContentInstructionRequestByTask(task.id) }
    }, beforeScriptTaskIds)
    await expect.poll(async () => Boolean(await loadTrace())).toBe(true)
    const trace = await loadTrace()
    if (!trace) throw new Error('Composer没有建立真实文案任务')
    expect(trace.record.request.surface).toBe('script_conversation')
    expect(trace.record.request.references).toHaveLength(1)
    expect(trace.record.request.references[0]?.role).toBe('style_reference')
    const traceTarget = trace.record.targets.find((target) => target.taskId === trace.task.id)
    expect(traceTarget?.taskId).toBe(trace.task.id)
    const traceSnapshot = JSON.parse(trace.task.inputSnapshot) as { threadId: string; historyMessageIds: string[] }
    expect(traceTarget).toMatchObject({ historyThreadId: traceSnapshot.threadId, historyMessageIds: traceSnapshot.historyMessageIds })
    const actualResourceSelection = structuredClone(trace.task.resourceSnapshot) as Record<string, unknown> | null
    if (actualResourceSelection) delete actualResourceSelection.generationContext
    expect(trace.record.request.resourceSnapshot).toEqual(actualResourceSelection)
    expect(trace.record.targetEvents.some((event) => event.eventKind === 'task_linked')).toBe(true)
    expect(await window.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!
      .listStructuredReferenceCatalog('sponsor', 'script-conversation:sponsor'))
      .find((item) => item.label === 'R16d客户Brief')?.lastUsedAt ?? null)).not.toBeNull()
    await composer.click()
    await window.keyboard.insertText('@')
    await expect(picker.getByRole('heading', { name: '最近使用' })).toBeVisible()
    await expect(picker.getByRole('option', { name: /R16d客户Brief/ })).toHaveCount(1)
    await search.press('Escape')

    const beforeSwitchTaskIds = await window.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).tasks.map((task) => task.id))
    if (await contextButton.getAttribute('aria-pressed') === 'true') await contextButton.click()
    await composer.fill('关闭项目上下文后必须建立干净线程')
    await window.locator('.structured-reference-submit').click()
    const loadSwitchedTrace = async () => window.evaluate(async (knownIds) => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const task = (await api.getWorkspace()).tasks
        .filter((item) => item.projectId === 'sponsor' && item.taskType === 'script_revision' && !knownIds.includes(item.id))
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0]
      if (!task) return null
      return { task, record: await api.getContentInstructionRequestByTask(task.id) }
    }, beforeSwitchTaskIds)
    await expect.poll(async () => Boolean(await loadSwitchedTrace())).toBe(true)
    const switchedTrace = await loadSwitchedTrace()
    if (!switchedTrace) throw new Error('关闭项目上下文后的UI发送没有建立任务')
    const switchedHistory = { firstThreadId: traceSnapshot.threadId, ...switchedTrace }
    const switchedSnapshot = JSON.parse(switchedHistory.task.inputSnapshot) as { threadId: string; historyMessageIds: string[] }
    expect(switchedSnapshot.threadId).not.toBe(switchedHistory.firstThreadId)
    expect(switchedHistory.record.targets.find((target) => target.taskId === switchedHistory.task.id)).toMatchObject({
      historyThreadId: switchedSnapshot.threadId,
      historyMessageIds: switchedSnapshot.historyMessageIds
    })

    await composer.click()
    await window.keyboard.insertText('@')
    await search.fill('R16d客户')
    await search.press('Enter')
    await composer.click()
    await window.keyboard.press('End')
    await window.keyboard.insertText('@')
    await search.fill('R16d客户')
    await expect(picker.getByRole('option', { name: /R16d客户Brief/ })).toContainText('换范围引用')
    await search.press('Enter')
    const repeatedChips = window.locator('.structured-reference-chip', { hasText: 'R16d客户Brief' })
    await expect(repeatedChips).toHaveCount(2)
    await repeatedChips.last().click()
    await roleDialog.getByLabel('引用范围').click()
    const scopeMenu = window.getByRole('menu', { name: '引用范围选项' })
    await expect(scopeMenu.getByRole('menuitemradio', { name: '整份资料' })).toHaveCount(0)
    await expect(scopeMenu.getByRole('menuitemradio', { name: '完整文案' })).toBeVisible()
    await window.keyboard.press('Escape')
    await roleDialog.getByRole('button', { name: '取消' }).click()
    await composer.fill('')

    const rollback = await window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const project = await api.createProject({
        title: 'R16d原子回滚', description: '', contentTypeId: 'type-ai', templateId: 'template-ai-tutorial', colorToken: 'project-9', platformTargets: ['B站']
      })
      await api.saveScriptMaterialWorkspace(project.id, { workingContent: '回滚测试原稿。' })
      const material = await api.createScriptMaterialRevision(project.id)
      if (!material.activeRevision) throw new Error('回滚测试素材修订没有建立')
      const before = (await api.getWorkspace()).tasks.length
      const beforeMessages = material.messages.length
      let error = ''
      let requestMissing = false
      try {
        await api.dispatchContentInstruction({
          operation: 'script_material_chat',
          instruction: {
            projectId: project.id, sessionScope: `script-material:${project.id}:${material.activeRevision.id}`,
            surface: 'script_material_first_draft', target: null, materialRevisionId: material.activeRevision.id,
            displayText: 'R16D_TEST_FAIL_AFTER_FIRST_LINK',
            editorDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'R16D_TEST_FAIL_AFTER_FIRST_LINK' }] }] },
            currentDocumentParagraphs: [],
            references: [], constraints: [], includeProjectContext: false,
            webSearchMode: 'automatic', factRegion: '中国大陆', factAsOf: new Date().toISOString(), aiCount: 2,
            targets: [
              { providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: 'xhigh', historyMessageIds: [] },
              { providerConfigId: 'claude_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: null, historyMessageIds: [] }
            ]
          },
          request: {
            projectId: project.id, message: 'R16D_TEST_FAIL_AFTER_FIRST_LINK', includeProjectContext: false, currentDocumentParagraphs: [],
            requests: [
              { side: 'codex', providerConfigId: 'codex_cli_text_v1', preferredModel: null },
              { side: 'claude', providerConfigId: 'claude_cli_text_v1', preferredModel: null }
            ]
          }
        })
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason)
        const requestId = error.match(/R16D_TEST_ROLLBACK:([^:]+):/u)?.[1]
        if (requestId) {
          try { await api.getContentInstructionRequest(requestId) } catch { requestMissing = true }
        }
      }
      const after = (await api.getWorkspace()).tasks.length
      const afterMessages = (await api.getScriptMaterialWorkspace(project.id)).messages.length
      return { before, after, beforeMessages, afterMessages, error, requestMissing }
    })
    expect(rollback.error).toContain('R16D_TEST_ROLLBACK')
    expect(rollback.after).toBe(rollback.before)
    expect(rollback.afterMessages).toBe(rollback.beforeMessages)
    expect(rollback.requestMissing).toBe(true)

    const materialTraces = await window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const create = async (title: string) => {
        const project = await api.createProject({
          title, description: '', contentTypeId: 'type-ai', templateId: 'template-ai-tutorial', colorToken: 'project-8', platformTargets: ['B站']
        })
        await api.saveScript(project.id, 'user_edit', `${project.id}的可信当前文案。`, undefined, 'R16d可信冻结')
        return project.id
      }
      return { singleId: await create('R16d单AI首稿'), dualId: await create('R16d双AI首稿') }
    })
    const generateFirstDraft = async (projectId: string, aiCount: 1 | 2) => {
      await window.evaluate((id) => { (globalThis as unknown as BrowserGlobals).location.hash = `#/workbench/${id}` }, projectId)
      await window.getByRole('tab', { name: '对照筛选' }).click()
      await window.getByRole('tab', { name: '素材成稿' }).click()
      await expect(window.locator('.script-material-workspace')).toBeVisible()
      await expect(window.locator('.current-script-pane .tiptap')).toContainText(`${projectId}的可信当前文案。`)
      await window.getByLabel('整理前的原始文案编辑区').fill(`${projectId}的素材原稿，请主动重构。`)
      if (aiCount === 2) await window.locator('.script-material-ai-count').getByRole('button').last().click()
      await window.getByRole('button', { name: '直接成稿' }).click()
      await expect.poll(async () => window.evaluate(async (id) => (
        await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()
      ).tasks.filter((task) => task.projectId === id && task.taskType === 'script_material_chat').map((task) => task.id), projectId)).toHaveLength(aiCount)
      return window.evaluate(async (id) => {
        const api = (globalThis as unknown as BrowserGlobals).creatorOS!
        const tasks = (await api.getWorkspace()).tasks.filter((task) => task.projectId === id && task.taskType === 'script_material_chat')
        return Promise.all(tasks.map(async (task) => ({ task, record: await api.getContentInstructionRequestByTask(task.id) })))
      }, projectId)
    }
    const single = await generateFirstDraft(materialTraces.singleId, 1)
    expect(single).toHaveLength(1)
    expect(single[0]?.record.request.surface).toBe('script_material_first_draft')
    expect(single[0]?.record.request.target).toBeNull()
    const singleTaskSnapshot = JSON.parse(single[0]!.task.inputSnapshot) as {
      currentDocumentParagraphs: Array<{ id: string; position: number; text: string }>
      resourceSnapshot: Record<string, unknown> | null
    }
    expect(singleTaskSnapshot.currentDocumentParagraphs.map((paragraph) => paragraph.text).join('\n'))
      .toContain(`${materialTraces.singleId}的可信当前文案。`)
    expect(single[0]?.record.request.currentDocumentParagraphs).toEqual(singleTaskSnapshot.currentDocumentParagraphs)
    expect(singleTaskSnapshot.resourceSnapshot).toEqual(single[0]?.task.resourceSnapshot)
    const trustedFreeze = await window.evaluate(async (projectId) => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const workspace = await api.getScriptMaterialWorkspace(projectId)
      if (!workspace.activeRevision) throw new Error('可信冻结测试缺少素材修订')
      const forgedParagraphs = [{ id: 'renderer-forged', position: 0, text: 'Renderer伪造的当前文案。' }]
      const result = await api.dispatchContentInstruction({
        operation: 'script_material_chat',
        instruction: {
          projectId, sessionScope: `script-material:${projectId}:${workspace.activeRevision.id}`,
          surface: 'script_material_first_draft', target: null, materialRevisionId: workspace.activeRevision.id,
          displayText: '验证Main可信冻结', editorDocument: { type: 'doc' }, currentDocumentParagraphs: forgedParagraphs,
          references: [], constraints: [], includeProjectContext: true,
          webSearchMode: workspace.webSearchMode, factRegion: '中国大陆', factAsOf: new Date().toISOString(), aiCount: 1,
          targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: 'xhigh', historyMessageIds: [] }]
        },
        request: {
          projectId, message: '验证Main可信冻结', includeProjectContext: true, currentDocumentParagraphs: forgedParagraphs,
          requests: [{ side: 'codex', providerConfigId: 'codex_cli_text_v1', preferredModel: null }]
        }
      })
      return result
    }, materialTraces.singleId)
    const trustedTaskSnapshot = JSON.parse(trustedFreeze.tasks[0]!.inputSnapshot) as {
      currentDocumentParagraphs: Array<{ id: string; position: number; text: string }>
      resourceSnapshot: Record<string, unknown> | null
    }
    expect(trustedTaskSnapshot.currentDocumentParagraphs).toEqual(trustedFreeze.request.request.currentDocumentParagraphs)
    expect(trustedTaskSnapshot.currentDocumentParagraphs.map((paragraph) => paragraph.text).join('\n'))
      .toContain(`${materialTraces.singleId}的可信当前文案。`)
    expect(trustedTaskSnapshot.currentDocumentParagraphs).not.toContainEqual(expect.objectContaining({ id: 'renderer-forged' }))
    expect(trustedTaskSnapshot.resourceSnapshot).toEqual(trustedFreeze.tasks[0]!.resourceSnapshot)
    const dual = await generateFirstDraft(materialTraces.dualId, 2)
    const dualCommonRequest = [...new Map(dual.map(({ record }) => [record.request.id, record])).values()]
      .find((record) => record.targets.length === 2)
    expect(dualCommonRequest?.targets).toHaveLength(2)
    expect(dualCommonRequest?.request.surface).toBe('script_material_first_draft')
    expect(dualCommonRequest?.request.target).toBeNull()
    dual.forEach(({ task, record }) => {
      const snapshot = JSON.parse(task.inputSnapshot) as {
        currentDocumentParagraphs: Array<{ id: string; position: number; text: string }>
        resourceSnapshot: Record<string, unknown> | null
      }
      expect(snapshot.currentDocumentParagraphs).toEqual(record.request.currentDocumentParagraphs)
      expect(snapshot.resourceSnapshot).toEqual(task.resourceSnapshot)
    })

    await window.evaluate(() => { (globalThis as unknown as BrowserGlobals).location.hash = '#/workbench/sponsor' })
    await expect(composer).toBeVisible()
    await window.setViewportSize({ width: 680, height: 720 })
    expect(await window.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true)
    await composer.click()
    await window.keyboard.insertText('@')
    await expect(picker).toBeVisible()
    const box = await picker.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(8)
    expect(box!.x + box!.width).toBeLessThanOrEqual(672)
    await search.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(composer).toBeFocused()
    await window.screenshot({ path: testInfo.outputPath('r16d-composer-narrow.png') })
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('R16d素材局部候选由Main重算当前文案应用目标且失败不留任务', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const userDataPath = testInfo.outputPath('trusted-application-target')
  await rm(userDataPath, { recursive: true, force: true })
  const launch = () => electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_TEST_BACKGROUND: '1',
      CREATOR_OS_TEST_R16C_PREPARE: '1',
      CREATOR_OS_TEST_R16D_DISPATCH: '1',
      CREATOR_OS_USER_DATA: userDataPath
    }
  })
  let app = await launch()
  let setup: { projectId: string; revisionId: string }
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    setup = await window.evaluate(async () => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const project = await api.createProject({
        title: 'R16d可信应用目标', description: '', contentTypeId: 'type-ai', templateId: 'template-ai-tutorial',
        colorToken: 'project-10', platformTargets: ['B站']
      })
      await api.saveScript(project.id, 'user_edit', '前缀目标正文后缀', undefined, '可信当前文案')
      await api.saveScriptMaterialWorkspace(project.id, { workingContent: '素材原稿。', webSearchMode: 'automatic' })
      const material = await api.createScriptMaterialRevision(project.id)
      if (!material.activeRevision) throw new Error('素材修订建立失败')
      ;(globalThis as unknown as BrowserGlobals).location.hash = `#/workbench/${project.id}`
      return { projectId: project.id, revisionId: material.activeRevision.id }
    })
    await expect(window.locator('.current-script-pane .tiptap')).toContainText('前缀目标正文后缀')
  } finally {
    await app.close().catch(() => undefined)
  }

  const database = new DatabaseSync(join(userDataPath, 'creator-os.sqlite3'))
  const draftId = 'r16d-trusted-draft'
  const paragraphId = 'r16d-trusted-paragraph'
  const draftContent = '需要改写的素材段落'
  const draftHash = createHash('sha256').update(draftContent).digest('hex')
  const createdAt = new Date().toISOString()
  database.prepare(`INSERT INTO script_material_drafts (
    id, project_id, revision_id, side, source_kind, provider_config_id, provider_kind, model,
    reasoning_effort, provider_fingerprint, requirement, input_fingerprint, content, content_hash,
    paragraphs_json, task_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    draftId, setup.projectId, setup.revisionId, 'codex', 'provider', 'builtin-codex-cli', 'codex_cli',
    'gpt-5.6', 'xhigh', 'r16d-e2e', '可信应用目标', 'r16d-input', draftContent, draftHash,
    JSON.stringify([{ id: paragraphId, position: 0, text: draftContent, sourcePointIds: [], transform: 'preserved', provenance: [], webSources: [], annotations: [], manualMarks: [] }]),
    createdAt, createdAt
  )
  database.close()

  app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    const result = await window.evaluate(async ({ projectId, revisionId, draftId, paragraphId, draftContent, draftHash, mutationId }) => {
      const api = (globalThis as unknown as BrowserGlobals).creatorOS!
      const current = await api.loadProjectCurrentScript(projectId)
      if (current.status !== 'ready') throw new Error('当前文案未就绪')
      const blockId = current.snapshot.blocks[0]!.blockId
      const targetText = '目标正文'
      const targetFrom = 2
      const targetTo = targetFrom + targetText.length
      const relationId = 'r16d-trusted-relation'
      const applied = await api.applyProjectCurrentScriptTransaction({
        projectId,
        workingDocumentId: current.snapshot.document.workingDocumentId,
        clientMutationId: mutationId,
        expectedRevision: current.snapshot.document.revision,
        expectedContentHash: current.snapshot.document.contentHash,
        editorDocument: {
          type: 'doc',
          content: [{
            type: 'paragraph', attrs: { blockId, parentBlockIds: [] },
            content: [
              { type: 'text', text: '前缀' },
              { type: 'text', text: targetText, marks: [{ type: 'scriptMaterialRelation', attrs: {
                relationId, relationBlockId: blockId, sourcePointIds: '', sourcePointVersion: revisionId,
                draftId, draftParagraphIds: paragraphId
              } }] },
              { type: 'text', text: '后缀' }
            ]
          }]
        },
        sourceRelations: [{
          id: relationId, targetBlockId: blockId, targetStart: targetFrom, targetEnd: targetTo,
          sourceKind: 'material_draft_paragraph', sourceId: paragraphId, sourceVersion: draftId
        }],
        annotations: []
      })
      if (applied.status !== 'applied') throw new Error('素材关系当前文案保存失败')
      const forgedApplicationTarget = {
        targetId: `material-relation:${draftId}:${paragraphId}`,
        selectedText: targetText,
        contentHash: 'f'.repeat(64),
        from: 99,
        to: 103
      }
      const paragraphSelection = { paragraphId, from: 0, to: draftContent.length, text: draftContent }
      const dispatch = async (applicationTarget: typeof forgedApplicationTarget) => api.dispatchContentInstruction({
        operation: 'script_material_rewrite',
        instruction: {
          projectId, sessionScope: `script-material-rewrite:${projectId}:${draftId}`,
          surface: 'script_material_rewrite', materialRevisionId: revisionId,
          target: { kind: 'material_draft', draftId, contentHash: draftHash, paragraphSelections: [paragraphSelection], applicationTarget },
          displayText: '改得更口语', editorDocument: { type: 'doc' }, currentDocumentParagraphs: [{ id: 'renderer-forged', position: 0, text: '伪造当前文案' }],
          references: [], constraints: [], includeProjectContext: false, webSearchMode: 'automatic', factRegion: '中国大陆', factAsOf: new Date().toISOString(),
          aiCount: 1, targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto', requestedReasoningEffort: 'xhigh', historyMessageIds: [] }]
        },
        request: {
          projectId, draftId, parentCandidateId: null, applicationTarget, paragraphIds: [paragraphId], selectedParagraphId: null,
          selectedText: '', selectedStart: null, selectedEnd: null, requirement: '改得更口语', providerConfigId: 'codex_cli_text_v1',
          includeProjectContext: false, preferredModel: null, preferredReasoningEffort: 'xhigh'
        }
      })
      const before = (await api.getWorkspace()).tasks.filter((task) => task.projectId === projectId).length
      const succeeded = await dispatch(forgedApplicationTarget)
      const task = succeeded.tasks[0]!
      const taskSnapshot = JSON.parse(task.inputSnapshot) as { rewriteTarget: { applicationTarget: typeof forgedApplicationTarget } }
      const canonical = taskSnapshot.rewriteTarget.applicationTarget
      const afterSuccess = (await api.getWorkspace()).tasks.filter((item) => item.projectId === projectId).length
      let rejection = ''
      try {
        await dispatch({ ...forgedApplicationTarget, selectedText: '伪造文字' })
      } catch (reason) {
        rejection = reason instanceof Error ? reason.message : String(reason)
      }
      const afterFailure = (await api.getWorkspace()).tasks.filter((item) => item.projectId === projectId).length
      return { before, afterSuccess, afterFailure, rejection, canonical, requestTarget: succeeded.request.request.target }
    }, { ...setup, draftId, paragraphId, draftContent, draftHash, mutationId: randomUUID() })
    const expectedCanonical = {
      targetId: `material-relation:${draftId}:${paragraphId}`,
      selectedText: '目标正文',
      contentHash: createHash('sha256').update('目标正文').digest('hex'),
      from: 2,
      to: 6
    }
    expect(result.canonical).toEqual(expectedCanonical)
    expect(result.requestTarget).toMatchObject({ applicationTarget: expectedCanonical })
    expect(result.afterSuccess).toBe(result.before + 1)
    expect(result.rejection).toContain('当前文案应用目标已变化')
    expect(result.afterFailure).toBe(result.afterSuccess)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
  }
})
