import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const installedApp = resolve(process.env.LY_CREATOR_SMOKE_APP ?? '/Applications/LY Creator OS.app')
const executable = resolve(installedApp, 'Contents/MacOS/LY Creator OS')
const userData = resolve(appRoot, 'test-results/packaged-user-data')
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

await Promise.all([
  access(resolve(installedApp, 'Contents/Resources/whisper_transcribe.py')),
  access(resolve(installedApp, 'Contents/Resources/whisper-python/faster_whisper')),
  access(resolve(installedApp, 'Contents/Resources/whisper-model-small/model.bin'))
])

function createTextPdf(text) {
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

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('unable to allocate smoke-test port')
  await new Promise((resolveClose) => server.close(resolveClose))
  return address.port
}

await rm(userData, { recursive: true, force: true })
await mkdir(userData, { recursive: true })
const port = await freePort()
const child = spawn(executable, [
  `--user-data-dir=${userData}`,
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1'
], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CREATOR_OS_TEST_BACKGROUND: process.env.CREATOR_OS_TEST_BACKGROUND ?? '1',
    CREATOR_OS_USER_DATA: userData
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })
const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))

let browser
try {
  const endpoint = `http://127.0.0.1:${port}`
  let connected = false
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const earlyExit = await Promise.race([exited, delay(100).then(() => null)])
    if (earlyExit) throw new Error(`packaged app exited early: ${JSON.stringify(earlyExit)}\n${output}`)
    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) { connected = true; break }
    } catch {
      // The DevTools endpoint appears shortly after the process starts.
    }
  }
  if (!connected) throw new Error(`packaged app did not expose its local smoke endpoint\n${output}`)

  browser = await chromium.connectOverCDP(endpoint)
  let page
  for (let attempt = 0; attempt < 50; attempt += 1) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('index.html'))
    if (page) break
    const earlyExit = await Promise.race([exited, delay(100).then(() => null)])
    if (earlyExit) throw new Error(`packaged app exited before renderer became ready: ${JSON.stringify(earlyExit)}\n${output}`)
  }
  if (!page) {
    const pageUrls = browser.contexts().flatMap((context) => context.pages()).map((candidate) => candidate.url())
    throw new Error(`packaged renderer page was not found; pages=${JSON.stringify(pageUrls)}\n${output}`)
  }
  await page.getByRole('heading', { name: '待办', exact: true }).waitFor()
  const appInfo = await page.evaluate(async () => globalThis.creatorOS?.getAppInfo() ?? null)
  if (appInfo?.name !== 'LY Creator OS') throw new Error(`packaged preload bridge unavailable: ${appInfo?.name || 'empty'}`)
  if (!appInfo.buildId || appInfo.buildId === 'development') throw new Error('packaged build identity is missing')
  if (!appInfo.isInstalledBuild) throw new Error(`smoke test did not start the Applications install: ${appInfo.installPath || 'unknown path'}`)
  const restSmoke = await page.evaluate(async () => {
    const api = globalThis.creatorOS
    const before = await api.getDailyWorkLog('2026-09-27')
    const rest = await api.saveBusinessTrip({ kind: 'rest', scheduleId: null, expectedUpdatedAt: null, action: 'save', title: '安装版休息验证', projectId: null, startDate: '2026-09-27', endDate: '2026-09-27', notes: '' })
    const snapshot = await api.getWorkspace(), after = await api.getDailyWorkLog('2026-09-27')
    return snapshot.schedules.some(item => item.id === rest.id && item.trip?.kind === 'rest') && JSON.stringify(before) === JSON.stringify(after)
  })
  if (!restSmoke) throw new Error('packaged rest travel persistence or hours isolation failed')
  const carryoverSmoke = await page.evaluate(async () => {
    const api = globalThis.creatorOS, today = (await api.getWorkspace()).today
    const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 1)
    const yesterday = date.toISOString().slice(0, 10)
    const [todo] = await api.createTodoBatch([{ title: '安装版手动接续', plannedDate: yesterday, segment: 'morning', projectId: null, stageKey: null, category: 'self_media', trackingMode: 'progress', progress: 40 }])
    return { today, yesterday, id: todo.id }
  })
  await page.getByRole('button', { name: /昨日未完成/ }).click()
  const carryoverPanel = page.getByRole('dialog', { name: '选择复制到今天的待办' })
  if (await carryoverPanel.getByRole('checkbox', { checked: true }).count()) throw new Error('packaged carryover preselects tasks')
  await carryoverPanel.getByLabel('复制：安装版手动接续').check()
  await carryoverPanel.getByRole('button', { name: '复制到今天（1）' }).click()
  await page.locator('.todo-copy-notice').waitFor()
  const copiedTodos = await page.evaluate(async () => (await globalThis.creatorOS.getWorkspace()).todos)
  const originalTodo = copiedTodos.find(todo => todo.id === carryoverSmoke.id)
  if (originalTodo.plannedDate !== carryoverSmoke.yesterday || originalTodo.segment !== 'morning') throw new Error('packaged copy changed original')
  const copiedTodo = copiedTodos.find(todo => todo.title === '安装版手动接续' && todo.id !== carryoverSmoke.id)
  if (copiedTodo.plannedDate !== carryoverSmoke.today || copiedTodo.segment !== null || copiedTodo.progress !== 40) throw new Error('packaged carryover lost task fields')
  await page.locator('.todo-copy-notice').getByRole('button', { name: '撤销', exact: true }).click()
  await page.locator('.todo-copy-notice').waitFor({ state: 'hidden' })
  const restoredTodo = await page.evaluate(async id => (await globalThis.creatorOS.getWorkspace()).todos.find(todo => todo.id === id), carryoverSmoke.id)
  if (await page.evaluate(async id => (await globalThis.creatorOS.getWorkspace()).todos.some(todo => todo.id === id), copiedTodo.id)) throw new Error('packaged undo retained copy')
  if (restoredTodo.plannedDate !== carryoverSmoke.yesterday || restoredTodo.segment !== 'morning') throw new Error('packaged carryover undo failed')
  const reviewSmoke = await page.evaluate(async () => {
    const api = globalThis.creatorOS
    const query = { kind: 'monthly', anchor: '2026-09-27' }
    const { period } = await api.getPersonalReview(query)
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '安装版多色复盘验证', marks: [{ type: 'highlight', attrs: { color: '#F3D9A3' } }, { type: 'textColor', attrs: { color: '#B44436' } }] }] }] }
    await api.savePersonalReview({ ...period, body, goals: [{ id: crypto.randomUUID(), title: '生活独立目标', category: '生活', target: 2, done: 1 }] })
    const note = await api.saveReviewEntry({ id: crypto.randomUUID(), revision: 0, date: query.anchor, kind: 'experience', title: '安装版经验检索', body, tags: ['剪辑'], sourceKind: query.kind, sourceAnchor: '2026-09-01', trashed: false })
    const month = await api.getPersonalReview(query), week = await api.getPersonalReview({ ...query, kind: 'weekly' })
    const results = await api.searchGlobal('安装版经验检索')
    return month.period.goals.length === 1 && week.period.goals.length === 0 && results.some(item => item.id === note.id && item.kind === 'review')
  })
  if (!reviewSmoke) throw new Error('packaged personal review persistence or search failed')
  await page.evaluate(() => { globalThis.location.hash = '#/reviews?kind=monthly&anchor=2026-09-27' })
  await page.getByRole('heading', { name: '计划与复盘', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '复盘正文', exact: true }).locator('mark[data-color="#F3D9A3"] [data-review-color="#B44436"], [data-review-color="#B44436"] mark[data-color="#F3D9A3"]').waitFor()
  await page.locator('[data-canvas-kind="checkin"]').evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
    const context = canvas.getContext('2d'); context.fillStyle = '#46724B'; context.fillRect(0, 0, 8, 8)
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), value => value.charCodeAt(0))
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], '安装版打卡.png', { type: 'image/png' }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await page.locator('[data-canvas-kind="checkin"] .review-thumbnail img').waitFor()
  const restPoint = page.locator('.review-chart-points button[data-day="2026-09-27"][data-travel-kind="rest"]')
  await restPoint.waitFor()
  await restPoint.hover()
  await page.locator('.review-chart-date[data-day="2026-09-27"][data-travel-kind="rest"]').waitFor()
  if (await page.locator('.review-goal-group').count() !== 1) throw new Error('packaged review still displays empty goal categories')
  const datesAligned = await page.locator('.review-chart-dates').evaluate(element => {
    const top = element.getBoundingClientRect().top
    return Array.from(element.children).every(child => Math.abs(child.getBoundingClientRect().top - top) < 1)
  })
  if (!datesAligned) throw new Error('packaged chart dates are not aligned')
  await page.getByLabel('每日工时读数').filter({ hasText: '休息' }).waitFor()
  await page.locator('.review-schedule[open]').waitFor()
  const restDayCard = page.locator('.review-day-card[data-day="2026-09-27"][data-travel-kind="rest"]')
  await restDayCard.locator('.business-trip-summary[data-travel-kind="rest"]').waitFor()
  const reviewBody = page.getByRole('textbox', { name: '复盘正文', exact: true })
  const reviewEditor = reviewBody.locator('xpath=ancestor::div[contains(@class,"review-rich-editor")]')
  await reviewBody.focus()
  if (await reviewEditor.getByRole('toolbar').isVisible()) throw new Error('packaged review styles opened on focus')
  await reviewBody.press('Meta+Shift+m')
  await reviewEditor.getByRole('toolbar').waitFor({ state: 'visible' })
  await reviewEditor.getByRole('button', { name: '收起样式面板' }).click()
  await reviewEditor.getByRole('toolbar').waitFor({ state: 'hidden' })
  const writingColumns = page.locator('.review-columns-writing')
  await writingColumns.waitFor()
  if (await writingColumns.locator(':scope > :not([role="separator"])').count() !== 3) throw new Error('packaged writing columns missing')
  if ((await restDayCard.locator('time').textContent()) !== '9月27日周日') throw new Error('packaged compact date incorrect')
  if ((await restDayCard.getByRole('button', { name: '记录', exact: true }).textContent()) !== '') throw new Error('packaged hours edit is not icon-only')
  await restPoint.click()
  const dailyLog = page.locator('.review-daily .todo-work-log[data-day="2026-09-27"]')
  await dailyLog.waitFor()
  await dailyLog.getByRole('button', { name: '记录', exact: true }).click()
  const dailyEditor = page.getByRole('dialog').filter({ has: page.getByLabel('总时长') })
  await dailyEditor.getByLabel('总时长').fill('3.25')
  await dailyEditor.getByRole('button', { name: '保存', exact: true }).click()
  await dailyLog.filter({ hasText: '3小时15分钟' }).waitFor()
  await dailyLog.locator('b[data-work-tone="low"]').waitFor()
  if ((await page.evaluate(() => globalThis.creatorOS.getDailyWorkLog('2026-09-27'))).totalMinutes !== 195) throw new Error('packaged daily record edit did not persist')

  await page.evaluate(() => { globalThis.location.hash = '#/settings' })
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await page.getByText('Applications安装版', { exact: true }).waitFor()
  await page.getByText(`${appInfo.version}·构建${appInfo.buildId}`, { exact: true }).waitFor()
  await page.evaluate(() => { globalThis.location.hash = '#/project/ai-browser/script' })
  await page.getByRole('heading', { name: 'AI浏览器入门教学' }).waitFor()
  await page.getByLabel('选择要导入的外部文案').setInputFiles(resolve(appRoot, 'tests/fixtures/external-script.docx'))
  await page.getByRole('status').filter({ hasText: '已导入external-script.docx并创建新版本' }).waitFor()
  const imported = await page.evaluate(async () => globalThis.creatorOS?.getProject('ai-browser').then((project) => project.latestVersions.find((version) => version.kind === 'external_draft')?.content) ?? '')
  if (!imported.includes('保留原件并新增版本')) throw new Error('packaged utilityProcess Word import failed')
  await page.evaluate(() => { globalThis.location.hash = '#/project/sponsor/materials' })
  await page.getByRole('dialog', { name: '资料', exact: true }).waitFor()
  await page.locator('.project-stage-grid').waitFor()
  await page.getByRole('button', { name: '添加资料' }).click()
  await page.getByRole('menuitem', { name: /导入并解析PDF/ }).click()
  const materialDialog = page.getByRole('dialog', { name: '导入PDF资料' })
  await materialDialog.getByRole('textbox', { name: '标题·可选' }).fill('打包PDF解析验证')
  await materialDialog.getByLabel('选择PDF资料文件').setInputFiles({ name: 'packaged-brief.pdf', mimeType: 'application/pdf', buffer: createTextPdf('Packaged PDF parser can extract this mandatory brief point.') })
  await materialDialog.getByRole('button', { name: '解析并保存' }).click()
  await page.getByText('打包PDF解析验证', { exact: true }).waitFor()
  const parsedBrief = await page.evaluate(async () => globalThis.creatorOS?.getProject('sponsor').then((project) => project.materials.find((material) => material.title === '打包PDF解析验证')?.textContent) ?? '')
  if (!parsedBrief.includes('mandatory brief point')) throw new Error('packaged utilityProcess PDF import failed')
  const taskId = await page.evaluate(async () => globalThis.creatorOS?.createTask({
    taskType: 'mock_demo', projectId: 'ai-browser', title: '打包任务进程验证', provider: 'mock', input: '确认打包后的Task Worker可运行'
  }).then((task) => task.id) ?? '')
  if (!taskId) throw new Error('packaged task creation failed')
  let taskStatus = ''
  for (let attempt = 0; attempt < 80; attempt += 1) {
    taskStatus = await page.evaluate(async (id) => globalThis.creatorOS?.getWorkspace().then((workspace) => workspace.tasks.find((task) => task.id === id)?.status ?? '') ?? '', taskId)
    if (taskStatus === 'succeeded') break
    await delay(100)
  }
  if (taskStatus !== 'succeeded') throw new Error(`packaged task worker failed: ${taskStatus || 'missing'}`)
  const coverTaskId = await page.evaluate(async () => {
    const api = globalThis.creatorOS
    if (!api) return ''
    const project = await api.getProject('ai-browser')
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')
    if (!final) return ''
    await api.setFinalVersion(project.id, final.id)
    return api.startCoverGeneration({ projectId: project.id, platform: 'B站', layout: 'bilibili_landscape', generationMode: 'stable_layers', batchCount: 1, headline: '打包封面验证', materialLinkIds: [], groupNote: '本机稳定图层' }).then((tasks) => tasks[0]?.id ?? '')
  })
  if (!coverTaskId) throw new Error('packaged cover task creation failed')
  let coverStatus = ''
  for (let attempt = 0; attempt < 120; attempt += 1) {
    coverStatus = await page.evaluate(async (id) => globalThis.creatorOS?.getWorkspace().then((workspace) => workspace.tasks.find((task) => task.id === id)?.status ?? '') ?? '', coverTaskId)
    if (['succeeded', 'failed'].includes(coverStatus)) break
    await delay(100)
  }
  if (coverStatus !== 'succeeded') throw new Error(`packaged stable cover task failed: ${coverStatus || 'missing'}`)
  const coverPreview = await page.evaluate(async () => {
    const project = await globalThis.creatorOS?.getProject('ai-browser')
    const candidate = project?.coverCandidates[0]
    return candidate ? globalThis.creatorOS?.getCoverCandidatePreview(project.id, candidate.id) : ''
  })
  if (!coverPreview?.startsWith('data:image/png;base64,')) throw new Error('packaged cover preview failed')
  console.log('packaged app smoke passed: renderer + preload + IPC + SQLite + personal reviews/rich text/search + rest travel/chart tooltip/daily edit/canvas drop + Word/PDF + Task Worker + stable cover + bundled Whisper runtime')
} finally {
  await browser?.close().catch(() => undefined)
  if (child.exitCode === null) child.kill('SIGTERM')
  await Promise.race([exited, delay(5000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}
