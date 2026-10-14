import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page
let userDataPath: string

function createTextPdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1')
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let output = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xrefOffset = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, '0')} 00000 n \n` })
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(output)
}

async function launchApp(path: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: join(import.meta.dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_USER_DATA: path } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect.poll(() => page.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getWorkspace().then((workspace) => workspace.contentTypes.length) ?? 0)).toBe(5)
  return { app, page }
}

async function setRoute(hash: string): Promise<void> {
  await mainWindow.evaluate((nextHash) => { (globalThis as unknown as BrowserGlobals).location.hash = nextHash }, hash)
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  rmSync(userDataPath, { recursive: true, force: true })
  const launched = await launchApp(userDataPath)
  electronApp = launched.app; mainWindow = launched.page
})

test.afterEach(async () => { await electronApp.close().catch(() => undefined) })

test('Notion式导航、内容方向和项目标题使用真实深链', async () => {
  await mainWindow.getByRole('button', { name: '灵感库' }).click()
  await expect(mainWindow.getByRole('heading', { name: '灵感库' })).toBeVisible()
  await setRoute('#/ideas?type=type-digital&project=ssd')
  await mainWindow.getByRole('button', { name: /已自动处理/ }).click()
  const captureRow = mainWindow.locator('.inspiration-record').filter({ hasText: 'SSD连续写入到70%以后速度开始波动' })
  await expect(captureRow).toBeVisible()
  await captureRow.getByRole('button', { name: /随身SSD横评/ }).click()
  await expect.poll(() => mainWindow.url()).toContain('#/project/ssd/materials')

  await mainWindow.locator('.sidebar .primary-nav').getByRole('button', { name: '内容项目', exact: true }).click()
  await expect(mainWindow.getByRole('heading', { name: '内容项目' })).toBeVisible()
  await expect(mainWindow.getByLabel('筛选发布平台').locator('option')).toHaveText(['全部平台', 'B站', '小红书', '抖音', '视频号'])
  await mainWindow.getByLabel('筛选内容方向').selectOption('type-ai')
  await expect.poll(() => mainWindow.url()).toContain('type=type-ai')
  await expect(mainWindow.locator('.project-table article')).toHaveCount(1)
  const aiRow = mainWindow.locator('.project-table article').filter({ hasText: 'AI浏览器入门教学' })
  await aiRow.locator('.project-cell-title button').click()
  await expect(mainWindow.getByRole('heading', { name: 'AI浏览器入门教学' })).toBeVisible()
  await expect(mainWindow.locator('.breadcrumb')).toContainText('AI浏览器入门教学')
})

test('项目模块可非破坏性移除恢复，描述与大纲保存为新版本', async () => {
  await setRoute('#/project/ios/overview')
  await expect(mainWindow.getByRole('heading', { name: 'iOS 27第一周体验' })).toBeVisible()
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '概览', exact: true })).toHaveCount(0)
  await expect(mainWindow.locator('.project-overview-nav')).toHaveAttribute('aria-current', 'page')
  await expect(mainWindow.getByRole('button', { name: '快速记录到项目' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '重命名项目iOS 27第一周体验' }).click()
  await expect(mainWindow.getByLabel('重命名项目')).toBeFocused()
  await mainWindow.getByLabel('重命名项目').press('Escape')
  await mainWindow.getByRole('button', { name: '项目操作' }).click()
  const projectMenu = mainWindow.getByRole('menu', { name: 'iOS 27第一周体验的操作' })
  await expect(projectMenu.getByRole('menuitem', { name: '打开项目', exact: true })).toHaveCount(0)
  await expect(projectMenu.getByRole('menuitem', { name: '重命名' })).toBeVisible()
  await expect(projectMenu.getByRole('menuitem', { name: '移到回收站' })).toBeVisible()
  await projectMenu.getByRole('menuitem', { name: '管理阶段模块' }).click()
  const menu = mainWindow.getByRole('menu', { name: '管理阶段模块' })
  await expect(menu.getByText('反馈')).toHaveCount(0)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/project-module-manager-review.png'), fullPage: true })
  await menu.getByRole('button', { name: '拖动排序资料' }).press('Alt+Shift+ArrowDown')
  await expect.poll(async () => mainWindow.locator('.project-tab').allTextContents()).toEqual(expect.arrayContaining(['大纲', '资料', '文案', '拍摄剪辑', '后期', '发布', '版本']))
  await expect.poll(async () => (await mainWindow.locator('.project-tab').allTextContents()).slice(0, 2)).toEqual(['大纲', '资料'])
  const outlineCheckbox = menu.getByRole('checkbox', { name: /大纲/ })
  await outlineCheckbox.uncheck()
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true })).toHaveCount(0)
  await menu.getByRole('checkbox', { name: /大纲/ }).check()
  await expect(mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true })).toBeVisible()

  await expect(mainWindow.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)
  await mainWindow.getByRole('textbox', { name: '项目描述' }).fill('E2E更新后的项目描述，用来验证版本保存。')
  await mainWindow.getByRole('button', { name: '保存新版本' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('项目描述已保存为新版本')

  await mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true }).click()
  await mainWindow.getByRole('textbox', { name: '大纲第1项' }).fill('E2E更新后的第一条大纲')
  await mainWindow.getByRole('button', { name: '保存为新版本' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('大纲已保存为新版本')
  await mainWindow.locator('.project-tabs').getByRole('button', { name: '版本', exact: true }).click()
  // 版本历史按§2.41不再展示项目描述版本；描述已在上方保存为新版本（状态提示已验证）
  await expect(mainWindow.locator('.versions-card article').filter({ hasText: '项目描述' })).toHaveCount(0)
  await expect(mainWindow.locator('.versions-card article').filter({ hasText: '大纲' })).toHaveCount(2)
  const originalOutline = mainWindow.locator('.versions-card article').filter({ hasText: '大纲' }).last()
  await originalOutline.getByRole('button', { name: '查看该版本' }).click()
  await expect(mainWindow.getByRole('region', { name: '版本内容' })).toContainText('开头：先说清楚这期为什么值得看')

  const policyError = await mainWindow.evaluate(async () => {
    try { await (globalThis as unknown as BrowserGlobals).creatorOS?.setProjectModule('ios', 'feedback', true); return '' } catch (error) { return String(error) }
  })
  expect(policyError).toContain('甲方反馈已合并到大纲和文案')
})

test('资料大纲制作和版本使用全宽无框项目工作区，制作入口保留项目上下文', async () => {
  const expectFullWidthSurface = async (): Promise<void> => {
    const geometry = await mainWindow.locator('.project-module-surface').evaluate((element) => {
      const parent = element.parentElement
      const surface = element.getBoundingClientRect(); const panel = parent?.getBoundingClientRect()
      const style = (globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }).getComputedStyle(element)
      return { surfaceWidth: surface.width, panelWidth: panel?.width ?? 0, borderTop: style.borderTopWidth }
    })
    expect(Math.abs(geometry.surfaceWidth - geometry.panelWidth)).toBeLessThanOrEqual(1)
    expect(geometry.borderTop).toBe('0px')
  }

  await setRoute('#/project/ios/materials')
  await expect(mainWindow.getByRole('heading', { name: '资料', exact: true })).toBeVisible()
  await expectFullWidthSurface()

  await setRoute('#/project/ios/outline')
  await expect(mainWindow.getByRole('heading', { name: '内容大纲' })).toBeVisible()
  await expectFullWidthSurface()
  await expect(mainWindow.locator('.outline-item').first()).toHaveCSS('border-bottom-width', '0px')

  await setRoute('#/project/ios/versions')
  await expect(mainWindow.getByRole('heading', { name: '版本历史' })).toBeVisible()
  await expectFullWidthSurface()
  await expect(mainWindow.locator('.versions-card article').first()).toHaveCSS('border-bottom-width', '0px')

  await setRoute('#/project/ios/postproduction')
  await expect(mainWindow.getByRole('heading', { name: '字幕', exact: true })).toBeVisible()
  await expect(mainWindow.getByText('本机离线执行')).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: /选择视频或音频/ })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '带时间码文本' })).toHaveCount(0)
  await mainWindow.getByRole('combobox', { name: '用于平台' }).selectOption('YouTube')
  await expect(mainWindow.getByText(/苹方Semibold 52pt/)).toBeVisible()
  await expect(mainWindow.getByText(/Avenir Next Demi Bold 31pt/)).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '先确认中文字幕' })).toBeDisabled()
  await expect(mainWindow.getByRole('heading', { name: '封面', exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: 'AI视频制作' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '打开创作工具' })).toHaveCount(0)
  await expectFullWidthSurface()

  await setRoute('#/project/ai-browser/production')
  await expect(mainWindow.getByRole('heading', { name: 'AI视频制作' })).toBeVisible()
})

test('项目资料保存文字、解析PDF并把网页链接保持为仅保存', async () => {
  await setRoute('#/project/sponsor/materials')
  await expect(mainWindow.getByRole('heading', { name: '资料', exact: true })).toBeVisible()

  await mainWindow.getByRole('button', { name: '新建', exact: true }).click()
  const inlineNoteEditor = mainWindow.locator('.scratch-note-editor-inline')
  await inlineNoteEditor.getByRole('textbox', { name: '随手笔记Markdown' }).fill('# 商单整体框架\n\n## 核心结论\n\n- 先讲真实体验\n- 再核对Brief')
  await inlineNoteEditor.getByRole('button', { name: '全屏' }).click()
  const frameworkEditor = mainWindow.getByRole('dialog', { name: '随手笔记Markdown编辑器' })
  await mainWindow.keyboard.press('Meta+s')
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('sponsor', false)).materials.find((item) => item.id.startsWith('project-scratch-note:'))?.textContent)).toContain('商单整体框架')
  await frameworkEditor.getByRole('button', { name: '预览' }).click()
  await expect(frameworkEditor.getByRole('heading', { name: '商单整体框架' })).toBeVisible()
  await frameworkEditor.getByRole('button', { name: '关闭随手笔记' }).click()

  await mainWindow.getByRole('button', { name: '添加资料' }).click()
  await mainWindow.getByRole('menuitem', { name: /粘贴文字/ }).click()
  let dialog = mainWindow.getByRole('dialog', { name: '粘贴文字' })
  await dialog.getByRole('textbox', { name: '标题·可选' }).fill('微信确认版Brief')
  await dialog.getByRole('textbox', { name: '资料文字' }).fill('必须说明户外收音稳定性，不能使用绝对化宣传。')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(mainWindow.getByText('微信确认版Brief')).toBeVisible()

  await mainWindow.getByRole('button', { name: '添加资料' }).click()
  await mainWindow.getByRole('menuitem', { name: /保存网页链接/ }).click()
  dialog = mainWindow.getByRole('dialog', { name: '保存网页链接' })
  await dialog.getByRole('textbox', { name: '标题·可选' }).fill('网页原始Brief')
  await dialog.getByRole('textbox', { name: '网页链接' }).fill('https://example.com/brand/brief#comment')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(mainWindow.locator('.project-material-list').getByText('网页链接·仅保存，未读取正文')).toBeVisible()

  await mainWindow.getByRole('button', { name: '添加资料' }).click()
  await mainWindow.getByRole('menuitem', { name: /导入并解析PDF/ }).click()
  dialog = mainWindow.getByRole('dialog', { name: '导入PDF资料' })
  await dialog.getByRole('textbox', { name: '标题·可选' }).fill('PDF合作要求')
  await dialog.getByLabel('选择PDF资料文件').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: createTextPdf('Mandatory brief point: outdoor stability. Forbidden claim: best ever.') })
  await dialog.getByRole('button', { name: '解析并保存' }).click()
  await expect(mainWindow.getByText('PDF合作要求', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(mainWindow.locator('.materials-columns > section').first()).toContainText('1页·已解析')
  expect(readdirSync(join(userDataPath, 'project-materials', 'sponsor'))).toHaveLength(1)
  await mainWindow.getByRole('button', { name: '打开PDF合作要求' }).click()
  const pdfPreview = mainWindow.getByRole('dialog', { name: '查看资料PDF合作要求' })
  await expect(pdfPreview).toBeVisible()
  await expect(pdfPreview.getByRole('status')).toContainText('第1页／共1页', { timeout: 15_000 })
  await expect.poll(() => pdfPreview.locator('canvas[aria-label="PDF合作要求第1页预览"]').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement
    return element.width > 0 && element.height > 0
  })).toBe(true)
  await mainWindow.keyboard.press('Space')
  await expect(pdfPreview).toBeHidden()

  const resourceState = await mainWindow.evaluate(async () => ({
    project: await (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('sponsor'),
    preparation: await (globalThis as unknown as BrowserGlobals).creatorOS?.prepareTaskResources('sponsor')
  }))
  expect(resourceState.project?.materials).toHaveLength(4)
  expect(resourceState.preparation?.supportingMaterials).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'scratch_note', content: expect.stringContaining('商单整体框架') })
  ]))
  expect(resourceState.preparation?.requiredInputs.find((item) => item.key === 'project_materials')?.items).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ content: expect.stringContaining('商单整体框架') })
  ]))
  const brief = resourceState.preparation?.requiredInputs.find((item) => item.key === 'commercial_brief')
  expect(brief?.status).toBe('included')
  expect(brief?.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '微信确认版Brief', content: expect.stringContaining('户外收音稳定性') }),
    expect.objectContaining({ label: 'PDF合作要求', content: expect.stringContaining('Mandatory brief point') }),
    expect.objectContaining({ label: '网页原始Brief', content: expect.stringContaining('仅保存，未读取正文') })
  ]))

  await mainWindow.locator('.project-tabs').getByRole('button', { name: '大纲', exact: true }).click()
  await mainWindow.getByRole('button', { name: '从Brief和资料生成大纲' }).click()
  const generationDialog = mainWindow.getByRole('dialog', { name: '生成Codex和Claude大纲' })
  await expect(generationDialog.locator('.outline-input-summary span').filter({ hasText: 'Brief' })).toContainText('3条')
  await expect(generationDialog.getByText('随手笔记1')).toBeVisible()
  await generationDialog.getByRole('button', { name: '关闭大纲生成' }).click()
  await mainWindow.locator('.project-tabs').getByRole('button', { name: '资料', exact: true }).click()

  await mainWindow.locator('.project-material-list article').filter({ hasText: 'PDF合作要求' }).getByRole('button', { name: '删除资料PDF合作要求' }).click()
  const deleteDialog = mainWindow.getByRole('alertdialog', { name: '删除项目资料' })
  await deleteDialog.getByRole('button', { name: '确认删除' }).click()
  await expect(mainWindow.getByText('PDF合作要求', { exact: true })).toHaveCount(0)
  const materialDirectory = join(userDataPath, 'project-materials', 'sponsor')
  expect(existsSync(materialDirectory) ? readdirSync(materialDirectory) : []).toHaveLength(0)

  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.setViewportSize({ width: 1440, height: 900 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/project-materials-review.png'), fullPage: true })
  }
})

test('资料与体验支持多文件导入并逐项显示结果', async () => {
  const sourceRoot = join(userDataPath, 'drop-sources')
  mkdirSync(sourceRoot, { recursive: true })
  const notesPath = join(sourceRoot, '实测记录.txt')
  const archivePath = join(sourceRoot, '原始数据.xyz')
  const audioPath = join(sourceRoot, '现场录音.mp3')
  writeFileSync(notesPath, '连续写入后温度升高')
  writeFileSync(archivePath, 'binary-placeholder')
  writeFileSync(audioPath, 'audio-placeholder')

  await setRoute('#/project/ssd/materials')
  await mainWindow.getByLabel('选择或拖入文件、文件夹文件选择').setInputFiles([notesPath, archivePath])
  const materialBatch = mainWindow.locator('.materials-columns > section').first().getByLabel('本次添加结果')
  await expect(materialBatch).toContainText('2项完成')
  await expect(materialBatch).toContainText('1个文件仅保存')
  await expect(mainWindow.getByRole('button', { name: '打开实测记录.txt' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '打开原始数据.xyz' })).toBeVisible()

  await mainWindow.getByLabel('添加体验文件或文件夹文件选择').setInputFiles(audioPath)
  const experienceColumn = mainWindow.locator('.materials-columns > section').nth(1)
  await expect(experienceColumn.getByLabel('本次添加结果')).toContainText('1项完成')
  await expect(experienceColumn.getByRole('button', { name: '打开现场录音.mp3' })).toBeVisible()
  await expect(experienceColumn.locator('.experience-asset-list').getByText('素材线索', { exact: true })).toBeVisible()

  const project = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ssd', false))
  const audioMaterial = project.materials.find((material) => material.title === '现场录音.mp3')!
  expect(project.assetLinks.find((link) => link.projectMaterialId === audioMaterial.id && link.parentLinkId === null)).toMatchObject({
    usageType: 'material_clue', mimeType: 'audio/mpeg', processState: 'pending', capabilities: ['preview', 'transcribe']
  })

  const primaryPanel = mainWindow.getByRole('region', { name: '主要参考' })
  await primaryPanel.getByRole('button', { name: /设置/ }).click()
  await primaryPanel.locator('.primary-reference-choice').filter({ hasText: '实测记录.txt' }).click()
  await primaryPanel.locator('.primary-reference-choice').filter({ hasText: '现场录音.mp3' }).click()
  const notes = primaryPanel.locator('.primary-reference-note textarea')
  await expect(notes).toHaveCount(2)
  await notes.nth(0).fill('重点看连续写入后的温度。')
  await notes.nth(1).fill('这份录音只用于补充现场感受。')
  await primaryPanel.locator('.primary-reference-requirements textarea').fill('先讲真实体验，再核对参数。')
  await primaryPanel.getByRole('button', { name: '保存参考设置' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('主要参考已保存')
  const frozen = await mainWindow.evaluate(async () => ({
    project: await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ssd', false),
    preparation: await (globalThis as unknown as BrowserGlobals).creatorOS!.prepareTaskResources('ssd')
  }))
  expect(frozen.project.assetLinks.filter((link) => link.isPrimaryReference)).toHaveLength(2)
  expect(frozen.project.referenceRequirements).toBe('先讲真实体验，再核对参数。')
  expect(frozen.preparation.primaryReferences).toEqual(expect.arrayContaining([
    expect.objectContaining({ attentionNote: '重点看连续写入后的温度。' }),
    expect.objectContaining({ attentionNote: '这份录音只用于补充现场感受。', status: 'unread' })
  ]))
})

test('创作工具是需要明确项目的附加入口', async () => {
  await setRoute('#/tools')
  const projectSelect = mainWindow.getByLabel('当前项目')
  await expect(projectSelect).toBeVisible()
  await projectSelect.selectOption('ios')
  await mainWindow.locator('.tool-card').filter({ hasText: '封面制作' }).getByRole('button', { name: '进入项目制作' }).click()
  await expect(mainWindow).toHaveURL(/#\/project\/ios\/postproduction$/)
  await expect(mainWindow.getByRole('heading', { name: '封面', exact: true })).toBeVisible()
})

test('商单模板默认包含商单，并在大纲和文案内显示甲方反馈', async () => {
  await mainWindow.getByRole('button', { name: '新建项目' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '新建项目' })
  await dialog.getByLabel('项目名称').fill('E2E新品商单')
  await expect(dialog.getByRole('group', { name: '内容方向' })).toBeVisible()
  await dialog.getByLabel('项目类型', { exact: true }).selectOption('commercial')
  await dialog.getByRole('group', { name: '项目模板' }).getByRole('button', { name: /^商单/ }).click()
  await expect(dialog.getByRole('group', { name: '项目模板' }).getByRole('button', { name: /^商单/ })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByLabel('项目描述').fill('验证商单默认商务与反馈模块和项目描述。')
  await dialog.getByRole('button', { name: '创建项目' }).click()
  await expect(mainWindow.getByRole('heading', { name: 'E2E新品商单' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '金额', exact: true })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '反馈', exact: true })).toHaveCount(0)
  await mainWindow.getByRole('button', { name: '打开当前大纲', exact: true }).click()
  await expect(mainWindow.getByText('甲方反馈', { exact: true })).toBeVisible()
  await mainWindow.keyboard.press('Escape')
  await mainWindow.getByRole('button', { name: '项目操作' }).click()
  await mainWindow.getByRole('menuitem', { name: '管理阶段模块' }).click()
  await expect(mainWindow.getByRole('menu', { name: '管理阶段模块' }).getByRole('checkbox', { name: '金额 商单独有·固定末尾', exact: true })).toBeChecked()
  await expect(mainWindow.getByRole('menu', { name: '管理阶段模块' }).getByRole('checkbox', { name: /反馈/ })).toHaveCount(0)
})

test('文案工作台使用Claude自由稿、Codex对话与当前文案三栏，并保留保存和格式能力', async () => {
  await setRoute('#/workbench/ai-browser')
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await expect(mainWindow.locator('.script-conversation-pane')).toHaveCount(1)
  await expect(mainWindow.locator('.freeform-content-pane')).toBeVisible()
  await expect(mainWindow.locator('.current-script-pane')).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '候选对比' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '改稿对话' })).toHaveCount(0)
  const currentScript = mainWindow.locator('.current-script-pane .tiptap')
  await expect(currentScript).toContainText('找到资料、核对来源')
  await mainWindow.getByRole('button', { name: '格式' }).click()
  await expect(mainWindow.getByRole('toolbar', { name: '文案格式' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '加粗' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '无序列表' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '高亮颜色1' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: 'Claude' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: 'Codex' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '更多文案操作' }).click()
  await expect(mainWindow.getByRole('button', { name: '飞书交接' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '导出Word' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: '导入文案' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '更多文案操作' }).click()
  await mainWindow.getByRole('button', { name: '保存当前文案' }).click()
  await expect(mainWindow.getByRole('status')).toContainText(/文案v\d+已保存/)
  await mainWindow.getByRole('button', { name: '定稿', exact: true }).click()
  await expect(mainWindow.getByRole('status')).toContainText('已定稿')
  await expect.poll(() => mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject('ai-browser', false)).versions.some((version) => version.documentType === 'script' && version.isFinal))).toBe(true)
  await setRoute('#/project/ai-browser/versions')
  const versionFilters = mainWindow.getByRole('navigation', { name: '按模块筛选版本' })
  await expect(versionFilters.getByRole('button')).toHaveText(['全部', '文案', '大纲', '标题', '封面', '字幕'])
  await expect(versionFilters.getByRole('button', { name: '项目描述' })).toHaveCount(0)
  await expect(mainWindow.getByRole('button', { name: '设为定稿' })).toHaveCount(0)
})

test('文案工作台在同一页面保留双稿来源、共享发送区与选区', async () => {
  await setRoute('#/workbench/ai-browser')
  await expect(mainWindow.locator('.script-conversation-pane')).toHaveCount(1)
  await expect(mainWindow.locator('.freeform-content-pane')).toBeVisible()
  await expect(mainWindow.locator('.script-shared-composer')).toBeVisible()
  const currentScript = mainWindow.locator('.current-script-pane .tiptap')
  await currentScript.click()
  await currentScript.press('Meta+A')
  await expect(mainWindow.locator('.revision-selection-chip')).toContainText('已选：')
  await expect(mainWindow.getByLabel('文案对话要求')).toHaveAttribute('placeholder', /针对所选文字提要求/)
  await expect(mainWindow.getByRole('button', { name: /发送/ })).toBeVisible()
  await expect(mainWindow.locator('.current-script-pane > footer')).toHaveCount(0)
  await currentScript.dispatchEvent('contextmenu', { bubbles: true, clientX: 920, clientY: 320 })
  await expect(mainWindow.getByRole('menuitem', { name: /针对性修改/ })).toBeVisible()
})

test('没有文案版本时也能直接输入普通对话，不要求先保存', async () => {
  const projectId = await mainWindow.evaluate(async () => {
    const project = await (globalThis as unknown as BrowserGlobals).creatorOS!.createProject({
      title: '空白文案自由对话', description: '', contentTypeId: 'type-ai',
      templateId: 'template-ai-tutorial', colorToken: 'project-8', platformTargets: ['B站']
    })
    return project.id
  })
  await setRoute(`#/workbench/${projectId}`)
  const composer = mainWindow.getByLabel('文案对话要求')
  await expect(composer).toBeEnabled()
  await expect(composer).toHaveAttribute('placeholder', /直接和AI对话/)
  await composer.fill('先不带项目资料，和我自由讨论一个新问题。')
  await expect(composer).toHaveValue('先不带项目资料，和我自由讨论一个新问题。')
  await expect(mainWindow.getByText('普通对话', { exact: true })).toBeVisible()
  const projectContext = mainWindow.getByRole('button', { name: '项目上下文' })
  await expect(projectContext).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => mainWindow.evaluate(async (id) => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getProject(id, false)).versions.filter((version) => version.documentType === 'script').length, projectId)).toBe(0)

  await projectContext.click()
  await expect(projectContext).toHaveAttribute('aria-pressed', 'true')
  await setRoute('#/workbench/ai-browser')
  await expect(mainWindow.getByRole('button', { name: '项目上下文' })).toHaveAttribute('aria-pressed', 'false')
  await expect(mainWindow.getByLabel('文案对话要求')).toHaveValue('')

  const versions = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const first = await api.saveScript('ai-browser', 'user_edit', '<p>快速切换版本A。</p>')
    const second = await api.saveScript('ai-browser', 'user_edit', '<p>快速切换版本B。</p>')
    return { firstId: first.id, secondId: second.id }
  })
  await setRoute(`#/workbench/ai-browser?draft=${versions.firstId}`)
  await setRoute(`#/workbench/ai-browser?draft=${versions.secondId}`)
  await expect(mainWindow.locator('.current-script-pane .tiptap')).toContainText('快速切换版本B')
  await expect(mainWindow.locator('.current-script-pane .tiptap')).not.toContainText('快速切换版本A')
  await expect(mainWindow.getByRole('button', { name: '项目上下文' })).toHaveAttribute('aria-pressed', 'false')
  await expect(mainWindow.getByLabel('文案对话要求')).toHaveValue('')
})

test('Markdown导入保留原稿并新增版本，重启后数据仍在', async () => {
  await setRoute('#/project/ai-browser/script')
  await expect(mainWindow.getByRole('heading', { name: 'AI浏览器入门教学' })).toBeVisible()
  const before = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  await mainWindow.getByLabel('选择要导入的外部文案').setInputFiles({ name: '外部文案.md', mimeType: 'text/markdown', buffer: Buffer.from('# 外部文案\n\n这是一份不会覆盖当前稿的文案。') })
  await expect(mainWindow.getByRole('status')).toContainText('已导入外部文案.md并创建新版本')
  const after = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  const external = after?.latestVersions.find((version) => version.kind === 'external_draft')
  expect(external?.content).toContain('这是一份不会覆盖当前稿的文案')
  expect(external?.sourceFileId).toBeTruthy()
  const markdownCopies = readdirSync(join(userDataPath, 'imports', 'ai-browser')).filter((name) => name.endsWith('外部文案.md'))
  expect(markdownCopies).toHaveLength(1)
  expect(statSync(join(userDataPath, 'imports', 'ai-browser', markdownCopies[0]!)).mode & 0o777).toBe(0o600)
  expect(after?.latestVersions.find((version) => version.kind === 'claude_candidate')?.id).toBe(before?.latestVersions.find((version) => version.kind === 'claude_candidate')?.id)
  expect(after?.latestVersions.find((version) => version.kind === 'merged_draft')?.id).toBe(before?.latestVersions.find((version) => version.kind === 'merged_draft')?.id)

  await mainWindow.getByRole('button', { name: /外部文案\.md/ }).click()
  await expect(mainWindow.getByText(/正在整理：外部文案\.md/)).toBeVisible()
  await expect(mainWindow.locator('.current-script-pane .tiptap')).toContainText('这是一份不会覆盖当前稿的文案')
  await mainWindow.getByRole('button', { name: '保存当前文案' }).click()
  await expect(mainWindow.getByRole('status')).toContainText(/文案v\d+已保存/)
  await expect.poll(() => mainWindow.url()).not.toContain('draft=')
  const resolved = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  expect(resolved?.versions.find((version) => version.id === external?.id)?.resolvedAt).toBeTruthy()

  await electronApp.close()
  const relaunched = await launchApp(userDataPath); electronApp = relaunched.app; mainWindow = relaunched.page
  const persisted = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  expect(persisted?.latestVersions.some((version) => version.id === external?.id)).toBe(true)
  expect(persisted?.versions.find((version) => version.id === external?.id)?.resolvedAt).toBeTruthy()
})

test('Word导入提取正文、保留原文件并新增独立版本', async () => {
  await setRoute('#/project/ai-browser/script')
  await expect(mainWindow.getByRole('heading', { name: 'AI浏览器入门教学' })).toBeVisible()
  await mainWindow.getByLabel('选择要导入的外部文案').setInputFiles(join(import.meta.dirname, '../fixtures/external-script.docx'))
  await expect(mainWindow.getByRole('status')).toContainText('已导入external-script.docx并创建新版本')
  const project = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  const external = project?.latestVersions.find((version) => version.kind === 'external_draft')
  expect(external?.content).toContain('这是一份导入后保留原件并新增版本的Word文案')
  expect(external?.sourceFileId).toBeTruthy()
  expect(external?.sourceFileName).toBe('external-script.docx')
  const wordCopies = readdirSync(join(userDataPath, 'imports', 'ai-browser')).filter((name) => name.endsWith('external-script.docx'))
  expect(wordCopies).toHaveLength(1)

  const forged = Buffer.from(readFileSync(join(import.meta.dirname, '../fixtures/external-script.docx')))
  const centralOffset = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  expect(centralOffset).toBeGreaterThan(0)
  forged.writeUInt32LE(60 * 1024 * 1024, centralOffset + 24)
  const beforeFiles = readdirSync(join(userDataPath, 'imports', 'ai-browser')).length
  await mainWindow.getByLabel('选择要导入的外部文案').setInputFiles({ name: '异常压缩.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: forged })
  await expect(mainWindow.getByRole('status')).toContainText('Word文件解压规模异常')
  expect(readdirSync(join(userDataPath, 'imports', 'ai-browser'))).toHaveLength(beforeFiles)

  const understated = Buffer.from(readFileSync(join(import.meta.dirname, '../fixtures/external-script.docx')))
  const understatedCentral = understated.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  understated.writeUInt32LE(1, understatedCentral + 24)
  await mainWindow.getByLabel('选择要导入的外部文案').setInputFiles({ name: '伪造小声明.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: understated })
  await expect(mainWindow.getByRole('status')).toContainText('Word文件实际解压规模异常')
  expect(readdirSync(join(userDataPath, 'imports', 'ai-browser'))).toHaveLength(beforeFiles)
})

test('Word大纲模板只保存结构，可载入当前草稿并从模板库移除', async () => {
  await setRoute('#/project/ios/outline')
  await expect(mainWindow.getByRole('heading', { name: '内容大纲' })).toBeVisible()
  await mainWindow.getByLabel('选择要导入的大纲Word模板').setInputFiles(join(import.meta.dirname, '../fixtures/external-script.docx'))
  await expect(mainWindow.getByRole('status')).toContainText('已导入“external-script”的结构')
  await expect(mainWindow.getByLabel('选择大纲模板')).toHaveValue(/.+/)

  await mainWindow.getByRole('button', { name: '载入模板' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('载入当前草稿')
  await expect(mainWindow.getByRole('textbox', { name: '大纲第1项' })).toHaveValue('Word外部文案')
  await expect(mainWindow.getByRole('textbox', { name: '大纲第2项' })).toHaveValue(/这是一份导入后保留原件并新增版本的Word文案/)
  await mainWindow.getByRole('button', { name: '保存为新版本' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('大纲已保存为新版本')

  const resources = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.listResources())
  expect(resources?.find((resource) => resource.name === 'external-script')).toMatchObject({ resourceType: 'template', origin: 'own', selectionMode: 'manual_only' })
  expect(readdirSync(join(userDataPath, 'imports', 'outline-templates'))).toHaveLength(0)

  await mainWindow.getByRole('button', { name: '移除大纲模板external-script' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('大纲模板已移除')
  await expect(mainWindow.getByText('还没有模板')).toBeVisible()
  await expect(mainWindow.getByRole('textbox', { name: '大纲第1项' })).toHaveValue('Word外部文案')
  await expect(mainWindow.getByRole('textbox', { name: '大纲第2项' })).toHaveValue(/这是一份导入后保留原件并新增版本的Word文案/)
})

test('大纲二级菜单可低噪新建并切换多份大纲', async () => {
  await setRoute('#/project/ai-browser/outline')
  await mainWindow.getByRole('button', { name: '管理多份大纲' }).click()
  await mainWindow.getByRole('menu').getByRole('button', { name: '新建大纲' }).click()
  await mainWindow.getByRole('textbox', { name: '大纲第1项' }).fill('第二份大纲的独立开头')
  await mainWindow.getByRole('button', { name: '保存为新版本' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('大纲已保存为新版本')
  await expect(mainWindow.locator('.outline-card > header')).toContainText('大纲2')
  await mainWindow.getByRole('button', { name: '管理多份大纲' }).click()
  const menu = mainWindow.getByRole('menu')
  await expect(menu.getByRole('button', { name: '大纲2' })).toBeVisible()
  await expect(menu.locator('div > button')).toHaveCount(2)
})

test('双模型大纲候选可逐项合并且不会伪装本地AI', async () => {
  await electronApp.close()
  const claudeId = 'e2e-outline-claude'; const codexId = 'e2e-outline-codex'
  const seedScript = `
    const Database = require('better-sqlite3');
    const db = new Database(${JSON.stringify(join(userDataPath, 'creator-os.sqlite3'))});
    const insert = db.prepare("INSERT INTO draft_versions (id,project_id,document_type,kind,parent_version_ids_json,content,is_final,created_by,created_at,revision) VALUES (@id,'ai-browser','outline',@kind,'[]',@content,0,'provider',@createdAt,@revision)");
    const nextRevision = () => db.prepare("SELECT COALESCE(MAX(revision),0)+1 AS value FROM draft_versions WHERE project_id='ai-browser' AND document_type='outline'").get().value;
    insert.run({ id: '${claudeId}', kind: 'claude_candidate', content: JSON.stringify([{id:'claude-1',text:'Claude开头：先讲真实痛点'},{id:'claude-2',text:'Claude结尾：适合哪些人'}]), createdAt: new Date().toISOString(), revision: nextRevision() });
    insert.run({ id: '${codexId}', kind: 'codex_candidate', content: JSON.stringify([{id:'codex-1',text:'Codex第一项：一周体验结论'},{id:'codex-2',text:'Codex第二项：三个实际场景'}]), createdAt: new Date(Date.now()+1).toISOString(), revision: nextRevision() });
    db.close();
  `
  execFileSync(join(import.meta.dirname, '../../node_modules/.bin/electron'), ['-e', seedScript], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const relaunched = await launchApp(userDataPath); electronApp = relaunched.app; mainWindow = relaunched.page
  await setRoute('#/project/ai-browser/outline')
  const workspace = mainWindow.getByRole('region', { name: '双模型大纲候选' })
  await expect(workspace).toBeVisible()
  await expect(mainWindow.getByRole('textbox', { name: '大纲第1项' })).not.toHaveValue(/Claude|Codex/)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.setViewportSize({ width: 1440, height: 900 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/outline-candidates-review.png'), fullPage: true })
  }

  await workspace.getByRole('button', { name: '载入Codex整版' }).click()
  await expect(mainWindow.getByRole('textbox', { name: '大纲第1项' })).toHaveValue('Codex第一项：一周体验结论')
  const claudeColumn = workspace.locator('.outline-candidate-grid > article').filter({ hasText: 'Claude' }).first()
  await claudeColumn.getByRole('button', { name: '加入' }).first().click()
  await expect(mainWindow.getByRole('textbox', { name: '大纲第3项' })).toHaveValue('Claude开头：先讲真实痛点')
  await mainWindow.getByRole('button', { name: '保存为新版本' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('大纲已保存为新版本')
  const persisted = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  const merged = persisted?.versions.find((version) => version.documentType === 'outline' && version.kind === 'user_edit')
  expect(merged?.parentVersionIds).toEqual(expect.arrayContaining([codexId, claudeId]))

  await mainWindow.getByRole('button', { name: '从Brief和资料生成大纲' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '生成Codex和Claude大纲' })
  await expect(dialog).toContainText('本机CLI不等于本地模型')
  await expect(dialog).toContainText('Codex')
  await expect(dialog).toContainText('Claude')
  await expect(dialog).not.toContainText('本机测试（不调用模型）')
  await expect(dialog.getByRole('button', { name: '交给Codex和Claude' })).toBeDisabled()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/outline-generation-dialog-review.png'), fullPage: true })
})

test('发布任务卡保存真实平台物料并在定稿变化后标记旧稿', async () => {
  const versions = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  const merged = versions?.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')
  const codex = versions?.versions.find((version) => version.documentType === 'script' && version.kind === 'codex_candidate')
  expect(merged).toBeTruthy(); expect(codex).toBeTruthy()
  await mainWindow.evaluate(async (versionId) => (globalThis as unknown as BrowserGlobals).creatorOS?.setFinalVersion('ai-browser', versionId), merged!.id)
  await setRoute('#/project/ai-browser/publishing')
  const card = mainWindow.getByRole('region', { name: 'B站发布任务卡' })
  await expect(card).toContainText('0/5项就绪')
  await card.getByRole('textbox', { name: '标题' }).fill('AI浏览器真实体验：哪些地方真的省时间')
  await card.getByRole('textbox', { name: '简介' }).fill('一周真实使用后的优缺点和适用人群。')
  await card.getByRole('textbox', { name: '标签' }).fill('AI浏览器,效率工具,真实体验')
  await card.getByRole('button', { name: '保存发布信息' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('已保存B站发布信息')
  await mainWindow.getByLabel('选择B站发布封面').setInputFiles({ name: 'bilibili-cover.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) })
  await expect(mainWindow.getByRole('status')).toContainText('bilibili-cover.png')
  await mainWindow.getByLabel('选择B站发布字幕').setInputFiles({ name: 'bilibili.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\n真实字幕\n') })
  await expect(mainWindow.getByRole('status')).toContainText('bilibili.srt')
  await expect(card).toContainText('4/5项就绪')
  await expect(card.getByText('已就绪')).toHaveCount(5)
  expect(readdirSync(join(userDataPath, 'publishing-assets', 'ai-browser'))).toHaveLength(2)
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.setViewportSize({ width: 1440, height: 900 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/publishing-task-review.png'), fullPage: true })
    await mainWindow.setViewportSize({ width: 680, height: 760 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/publishing-task-review-narrow.png'), fullPage: true })
  }

  await mainWindow.evaluate(async (versionId) => (globalThis as unknown as BrowserGlobals).creatorOS?.setFinalVersion('ai-browser', versionId), codex!.id)
  await expect(card).toContainText('0/5项就绪')
  await expect(card.getByText('基于旧稿')).toHaveCount(5)
  const persisted = await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.getProject('ai-browser'))
  expect(persisted?.publishingMaterials).toHaveLength(5)
  expect(persisted?.publishingMaterials.every((material) => material.sourceVersionId === merged!.id)).toBe(true)
})

test('快速记录零摩擦，项目内静默关联且全局入口不显示分类模式', async () => {
  await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.openCapture('sponsor'))
  const capture = await electronApp.waitForEvent('window')
  await capture.waitForLoadState('domcontentloaded')
  await expect(capture.getByRole('tab')).toHaveCount(0)
  await expect(capture.getByText('保存后自动关联当前项目')).toBeVisible()
  await capture.getByLabel('记录内容').fill('商单项目内的普通内容记录')
  await capture.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === '快速记录')?.isVisible() ?? false)).toBe(false)
  await mainWindow.evaluate(async () => (globalThis as unknown as BrowserGlobals).creatorOS?.openCapture())
  await expect(capture.getByRole('tab')).toHaveCount(0)
  await expect(capture.getByText('先记下来，保存后再分类')).toBeVisible()
  await expect(capture.getByLabel('记录内容')).toHaveValue('')
  const saved = await mainWindow.evaluate(async () => (await (globalThis as unknown as BrowserGlobals).creatorOS!.getWorkspace()).captures.find((item) => item.originalContent === '商单项目内的普通内容记录'))
  expect(saved).toMatchObject({ captureKind: 'project_content', primaryProjectId: 'sponsor' })
})

test('创作报表按真实发布与阶段时间生成并保存周报月报', async () => {
  const pageErrors: string[] = []
  mainWindow.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  const projectId = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const project = await api.createProject({
      title: '报表E2E样本', description: '验证确定性统计', contentTypeId: 'type-digital', colorToken: 'project-7', platformTargets: ['B站']
    })
    await api.updateStageTime(project.id, 'materials', {
      startedAt: { localDate: '2026-07-13', segment: 'morning' }, completedAt: { localDate: '2026-07-15', segment: 'afternoon' }, actualEffortHalfDayUnits: 2, source: 'backfill'
    })
    await api.createSchedule({ projectId: project.id, title: '资料截止', actionType: 'materials', startAt: '2026-07-14T09:00:00+08:00', endAt: null, scheduleKind: 'plan', waitingFor: null })
    await api.updateStageTime(project.id, 'publishing', {
      startedAt: { localDate: '2026-07-16', segment: 'morning' }, completedAt: { localDate: '2026-07-17', segment: 'afternoon' }, source: 'backfill'
    })
    const noEffort = await api.createProject({
      title: '报表无投入样本', description: '验证缺失投入不显示为0', contentTypeId: 'type-digital', colorToken: 'project-8', platformTargets: ['小红书']
    })
    await api.updateStageTime(noEffort.id, 'publishing', {
      startedAt: { localDate: '2026-07-17', segment: 'morning' }, completedAt: { localDate: '2026-07-18', segment: 'afternoon' }, source: 'backfill'
    })
    return project.id
  })
  await setRoute('#/home')
  await mainWindow.getByRole('button', { name: '查看创作报表' }).click()
  await expect(mainWindow.getByRole('heading', { name: '创作报表', level: 1 })).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)).toContain('snapshot=')
  await mainWindow.getByRole('button', { name: '后退', exact: true }).click()
  await expect(mainWindow.getByRole('button', { name: '查看创作报表' })).toBeVisible()
  await mainWindow.getByRole('button', { name: '查看创作报表' }).click()
  await expect(mainWindow.getByRole('heading', { name: '创作报表', level: 1 })).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)).toContain('snapshot=')
  const firstSnapshotHash = await mainWindow.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)
  await expect(mainWindow.getByText('2026年7月13日—19日')).toBeVisible()
  await expect(mainWindow.locator('.report-metric').filter({ hasText: '发布条数' })).toContainText('2条')
  await expect(mainWindow.locator('.report-stage-row').filter({ hasText: '资料' })).toContainText('1晚完成')
  await expect(mainWindow.locator('.report-project-row').filter({ hasText: '报表E2E样本' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '项目 × 阶段' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '各项目阶段总计' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '阶段历时与实际投入' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '项目排期偏差' })).toBeVisible()
  await expect(mainWindow.getByRole('region', { name: '和AI讨论本期报表' })).toBeVisible()
  await expect(mainWindow.getByText('这份报表还没有对话')).toBeVisible()
  await expect(mainWindow.getByLabel('报表对话问题')).toBeEnabled()
  await expect(mainWindow.getByText('Claude', { exact: true })).toHaveCount(0)
  await expect(mainWindow.getByText(/对话固定引用这份.*生成的快照/)).toBeVisible()
  await mainWindow.getByRole('button', { name: /查看本期\d+条发布详情/ }).click()
  await expect(mainWindow.getByRole('heading', { name: '发布详情' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '内容方向分布' })).toBeVisible()
  await expect(mainWindow.getByRole('heading', { name: '具体发布' })).toBeVisible()
  await expect(mainWindow.getByText('报表E2E样本', { exact: true })).toBeVisible()
  await expect(mainWindow.locator('.published-detail-metrics .report-metric').filter({ hasText: '实际投入合计' })).toContainText('1/2条有投入记录')
  await expect(mainWindow.locator('.published-project-list button').filter({ hasText: '报表无投入样本' })).toContainText('实际投入—')
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-published-detail.png'), fullPage: true })
  await mainWindow.getByRole('button', { name: /返回周期总览/ }).click()
  await expect(mainWindow.getByRole('heading', { name: '创作报表' })).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.setViewportSize({ width: 1440, height: 900 })
    await mainWindow.locator('.reports-page').evaluate((element) => { element.scrollTop = 0 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-review.png'), fullPage: true })
    await mainWindow.locator('.report-conversation').scrollIntoViewIfNeeded()
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-chat-review.png'), fullPage: true })
    await mainWindow.setViewportSize({ width: 680, height: 760 })
    await mainWindow.locator('.report-conversation').scrollIntoViewIfNeeded()
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-chat-review-narrow.png'), fullPage: true })
    await mainWindow.locator('.reports-page').evaluate((element) => { element.scrollTop = 0 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-review-narrow.png'), fullPage: true })
  }
  await mainWindow.locator('.report-project-row').filter({ hasText: '报表E2E样本' }).click()
  await mainWindow.waitForTimeout(300)
  await mainWindow.setViewportSize({ width: 1440, height: 900 })
  if (pageErrors.length) throw new Error(pageErrors.join('\n'))
  await expect(mainWindow.getByRole('button', { name: '项目复盘', exact: true })).toHaveClass(/active/)
  await expect(mainWindow.getByRole('heading', { name: '计划与实际时间线' })).toBeVisible()
  await expect(mainWindow.locator('.report-optional-effort > summary')).toContainText('手动实际投入（选填）')
  await expect(mainWindow.locator('.report-optional-effort')).not.toHaveAttribute('open', '')
  await mainWindow.locator('.report-optional-effort > summary').click()
  const stageDetailGeometry = await mainWindow.locator('.project-review-row.head').evaluate((row) => {
    const cells = [...row.children]
    return { rowWidth: row.getBoundingClientRect().width, scheduleWidth: cells[2]?.getBoundingClientRect().width ?? 0 }
  })
  expect(stageDetailGeometry.rowWidth).toBeLessThanOrEqual(570)
  expect(stageDetailGeometry.scheduleWidth).toBeLessThanOrEqual(120)
  const effortChart = mainWindow.getByLabel('项目阶段实际投入')
  await effortChart.getByRole('listitem').filter({ hasText: '发布' }).click()
  const effortEditor = mainWindow.getByRole('dialog', { name: '修改发布阶段时间' })
  await expect(effortEditor.locator('.stage-effort-view')).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-effort-editor.png'), fullPage: true })
  }
  await effortEditor.getByRole('button', { name: '1天', exact: true }).click()
  await expect(effortEditor).toBeHidden()
  await expect(effortChart.getByRole('listitem').filter({ hasText: '发布' })).toContainText('1天')
  await expect(mainWindow.getByRole('button', { name: /返回周期总览/ })).toBeVisible()
  if (process.env.CREATOR_OS_VISUAL_CAPTURE === '1') {
    await mainWindow.setViewportSize({ width: 1440, height: 900 })
    await mainWindow.screenshot({ path: join(import.meta.dirname, '../../test-results/creation-report-project-review.png'), fullPage: true })
  }
  await mainWindow.getByRole('button', { name: /返回周期总览/ }).click()
  await expect(mainWindow.getByRole('button', { name: '周期总览', exact: true })).toHaveClass(/active/)
  await mainWindow.getByRole('button', { name: '重新生成' }).click()
  await expect(mainWindow.getByText(/生成并保存/)).toBeVisible()
  await expect(mainWindow.locator('.report-snapshot-picker select')).toBeVisible()
  await expect.poll(() => mainWindow.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)).not.toBe(firstSnapshotHash)
  await mainWindow.getByRole('button', { name: '月报' }).click()
  await expect(mainWindow.getByText('2026年7月')).toBeVisible()
  const persisted = await mainWindow.evaluate(async ({ id }) => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const report = await api.getCreationReport('monthly', '2026-07-18')
    let blockedMessage = ''
    try { await api.sendCreationReportMessage(report.id, 'codex_cli', '这条不应绕过安全验证') }
    catch (error) { blockedMessage = String(error) }
    return { report, project: await api.getProject(id, false), blockedMessage, conversation: await api.getCreationReportConversation(report.id) }
  }, { id: projectId })
  expect(persisted.report.payload.publishedProjects.some((project) => project.projectId === projectId)).toBe(true)
  expect(persisted.project.stageTimeRecords.find((stage) => stage.stageKey === 'materials')?.actualEffortHalfDayUnits).toBe(2)
  expect(persisted.blockedMessage).toContain('尚未通过当前安全验证')
  expect(persisted.conversation.messages).toEqual([])
})
