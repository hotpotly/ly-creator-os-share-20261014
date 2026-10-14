import { registerWorkspaceV2ProjectionFunctions } from '../../src/main/db/workspace-sync-v2-projections'
import BetterSqlite3 from 'better-sqlite3'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, restoreWorkspaceBackup, type WorkspaceStore } from '../../src/main/db'
import { shiftStageTimePoint } from '../../src/shared/domain/coarse-time'

const directories: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-stage2-'))
  directories.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('stage-two workspace repository', () => {
  it('persists customized todo category names, colors and growth weights', async () => {
    const { store } = await createStore()
    expect(store.repository.getPreferences().todoCategoryColors).toMatchObject({
      life: 'project-2',
      other_work: 'project-1'
    })
    store.repository.setPreferences({
      todoCategoryColors: {
        ...store.repository.getPreferences().todoCategoryColors,
        life: 'project-1',
        other_work: 'project-12'
      },
      todoCategoryLabels: {
        ...store.repository.getPreferences().todoCategoryLabels,
        self_media: '频道制作',
        other_work: '运动'
      },
      todoCategoryWeights: {
        self_media: 45,
        ai: 15,
        life: 10,
        other_work: 30
      }
    })
    expect(store.repository.getPreferences()).toMatchObject({
      todoCategoryColors: { life: 'project-1', other_work: 'project-12' },
      todoCategoryLabels: { self_media: '频道制作', other_work: '运动' },
      todoCategoryWeights: { self_media: 45, ai: 15, life: 10, other_work: 30 }
    })
    store.close()
  })

  it('migrates the old split scope once and then keeps every workbench preference project-scoped', async () => {
    const { store } = await createStore()
    store.repository.setPreferences({ workbenchComparisonSplitScope: 'matched' })
    expect(store.repository.getWorkbenchPreferences('ai-browser').workbenchComparisonSplitScope).toBe('matched')
    store.repository.setPreferences({ workbenchComparisonSplitScope: 'current' })
    expect(store.repository.getWorkbenchPreferences('ai-browser').workbenchComparisonSplitScope).toBe('matched')
    expect(store.repository.getWorkbenchPreferences('ios').workbenchComparisonSplitScope).toBe('current')
    store.repository.setWorkbenchPreferences('ios', { workbenchComparisonSplitScope: 'matched' })
    expect(store.repository.getWorkbenchPreferences('ai-browser').workbenchComparisonSplitScope).toBe('matched')
    expect(store.repository.getPreferences().workbenchComparisonSplitScope).toBe('current')
    store.close()
  })

  it('persists the home todo view, project position and exact per-project writing view', async () => {
    const { store } = await createStore()
    store.repository.setPreferences({
      homeTodoView: 'category',
      lastProjectModuleById: { 'ai-browser': 'script' }
    })
    store.repository.setWorkbenchPreferences('ai-browser', {
      workbenchPrimaryView: 'comparison',
      workbenchComparisonKind: 'materials',
      workbenchDraftSurface: 'current',
      workbenchVersionSurface: 'current',
      workbenchVersionMobileSide: 'right',
      workbenchVersionSourcePanelOpen: false,
      workbenchVersionDiffVisible: false,
      workbenchVersionScrollTops: { left: 120, right: 360 },
      workbenchVersionCurrentScrollTop: 480,
      workbenchMaterialTab: 'current',
      workbenchMaterialScrollTops: { source: 40, ai: 80, current: 160 },
      workbenchConversationTab: 'current',
      workbenchHiddenProviders: ['claude'],
      workbenchConversationScrollTops: { claude: 25, codex: 50, current: 75 },
      workbenchDraftCurrentScrollTop: 240,
      workbenchCodexModel: 'gpt-5.6-terra'
    })
    expect(store.repository.getPreferences()).toMatchObject({
      homeTodoView: 'category',
      lastProjectModuleById: { 'ai-browser': 'script' }
    })
    expect(store.repository.getWorkbenchPreferences('ai-browser')).toMatchObject({
      workbenchPrimaryView: 'comparison',
      workbenchComparisonKind: 'materials',
      workbenchDraftSurface: 'current',
      workbenchVersionSurface: 'current',
      workbenchVersionMobileSide: 'right',
      workbenchVersionSourcePanelOpen: false,
      workbenchVersionDiffVisible: false,
      workbenchVersionScrollTops: { left: 120, right: 360 },
      workbenchVersionCurrentScrollTop: 480,
      workbenchMaterialTab: 'current',
      workbenchMaterialScrollTops: { source: 40, ai: 80, current: 160 },
      workbenchConversationTab: 'current',
      workbenchHiddenProviders: ['claude'],
      workbenchConversationScrollTops: { claude: 25, codex: 50, current: 75 },
      workbenchDraftCurrentScrollTop: 240,
      workbenchCodexModel: 'gpt-5.6-terra'
    })
    expect(store.repository.getWorkbenchPreferences('ios')).toMatchObject({
      workbenchPrimaryView: 'conversation',
      workbenchComparisonKind: 'drafts',
      workbenchDraftSurface: 'organize',
      workbenchVersionSurface: 'compare',
      workbenchVersionMobileSide: 'left',
      workbenchMaterialTab: 'ai',
      workbenchConversationTab: 'claude',
      workbenchHiddenProviders: [],
      workbenchCodexModel: null
    })
    store.close()
  })

  it('falls back safely when legacy workspace and project preferences do not contain newer workbench surfaces', async () => {
    const { store, directory } = await createStore()
    store.repository.setPreferences({
      workbenchPrimaryView: 'conversation',
      workbenchComparisonKind: 'drafts',
      workbenchComparisonSplitScope: 'matched',
      workbenchView: 'comparison'
    })
    store.close()

    const database = new BetterSqlite3(join(directory, 'creator-os.sqlite3'))
    registerWorkspaceV2ProjectionFunctions(database)
    const row = database.prepare('SELECT value_json AS valueJson FROM preferences WHERE key = ?').get('workspace') as { valueJson: string }
    const value = JSON.parse(row.valueJson) as Record<string, unknown>
    for (const field of ['workbenchMaterialTab', 'workbenchMaterialScrollTops', 'workbenchDraftSurface', 'workbenchDraftCurrentScrollTop', 'workbenchVersionSurface', 'workbenchVersionMobileSide', 'workbenchVersionSourcePanelOpen', 'workbenchVersionDiffVisible', 'workbenchVersionScrollTops', 'workbenchVersionCurrentScrollTop', 'workbenchConversationTab', 'workbenchHiddenProviders', 'workbenchConversationScrollTops']) delete value[field]
    database.prepare('UPDATE preferences SET value_json = ? WHERE key = ?').run(JSON.stringify(value), 'workspace')
    database.prepare('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?)').run('workbench:ai-browser', JSON.stringify({
      workbenchPrimaryView: 'comparison',
      workbenchComparisonKind: 'materials',
      workbenchComparisonSplitScope: 'matched',
      workbenchView: 'comparison'
    }), new Date().toISOString())
    database.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getPreferences().workbenchMaterialTab).toBe('ai')
    expect(reopened.repository.getWorkbenchPreferences('ai-browser')).toMatchObject({
      workbenchPrimaryView: 'comparison',
      workbenchComparisonKind: 'materials',
      workbenchDraftSurface: 'organize',
      workbenchVersionSurface: 'compare',
      workbenchVersionMobileSide: 'left',
      workbenchMaterialTab: 'ai',
      workbenchConversationTab: 'claude',
      workbenchHiddenProviders: [],
      workbenchConversationScrollTops: { claude: 0, codex: 0, current: 0 },
      workbenchDraftCurrentScrollTop: 0,
      workbenchVersionCurrentScrollTop: 0,
      workbenchView: 'dual',
      workbenchComparisonSplitScope: 'matched'
    })
    reopened.repository.setPreferences({ workbenchComparisonSplitScope: 'current', workbenchPrimaryView: 'conversation' })
    expect(reopened.repository.getWorkbenchPreferences('ai-browser')).toMatchObject({
      workbenchPrimaryView: 'comparison',
      workbenchComparisonSplitScope: 'matched'
    })
    reopened.close()
  })

  it('derives the capture summary creative day from the same 04:00 repository clock', async () => {
    const previousNow = process.env.CREATOR_OS_TEST_NOW
    const previousTimeZone = process.env.CREATOR_OS_TEST_TIME_ZONE
    process.env.CREATOR_OS_TEST_TIME_ZONE = 'Asia/Shanghai'
    const { store } = await createStore()
    try {
      process.env.CREATOR_OS_TEST_NOW = '2026-07-20T03:59:00+08:00'
      expect(store.repository.getSnapshot()).toMatchObject({
        today: '2026-07-20',
        captureSummary: { creativeDay: '2026-07-19' }
      })
      process.env.CREATOR_OS_TEST_NOW = '2026-07-20T04:00:00+08:00'
      expect(store.repository.getSnapshot()).toMatchObject({
        today: '2026-07-20',
        captureSummary: { creativeDay: '2026-07-20' }
      })
    } finally {
      store.close()
      if (previousNow === undefined) delete process.env.CREATOR_OS_TEST_NOW
      else process.env.CREATOR_OS_TEST_NOW = previousNow
      if (previousTimeZone === undefined) delete process.env.CREATOR_OS_TEST_TIME_ZONE
      else process.env.CREATOR_OS_TEST_TIME_ZONE = previousTimeZone
    }
  })

  it('seeds the canonical five extensible content types and only lists established projects as active', async () => {
    const { store } = await createStore()
    expect(store.repository.listContentTypes().map((type) => type.name)).toEqual([
      '数码', '手机系统', 'AI', '开箱', '待定方向'
    ])
    expect(store.repository.listProjects(false).every((project) => project.topicStageRole === 'project_created')).toBe(true)
    expect(store.repository.listProjects().some((project) => project.id === 'archived-demo')).toBe(true)
    store.close()
  })

  it('derives project progress and current stage from enabled creative modules', async () => {
    const { store } = await createStore()
    store.repository.native.prepare(`UPDATE project_modules SET completed_at=NULL WHERE project_id='ios' AND module_key NOT IN ('overview','business','feedback')`).run()
    const total = (store.repository.native.prepare(`SELECT COUNT(*) AS count FROM project_modules WHERE project_id='ios' AND enabled=1 AND module_key NOT IN ('overview','business','feedback')`).get() as { count: number }).count
    expect(total).toBeGreaterThan(1)
    const stages = store.repository.native.prepare(`SELECT module_key AS moduleKey FROM project_modules WHERE project_id='ios' AND enabled=1 AND module_key NOT IN ('overview','business','feedback') ORDER BY position`).all() as Array<{ moduleKey: string }>
    expect(store.repository.listProjects().find((project) => project.id === 'ios')?.currentStageKey).toBe(stages[0]?.moduleKey)
    store.repository.native.prepare(`UPDATE project_modules SET completed_at='2026-07-24T12:00:00.000Z' WHERE project_id='ios' AND module_key=?`).run(stages[0]?.moduleKey)
    expect(store.repository.listProjects().find((project) => project.id === 'ios')).toMatchObject({
      currentStageKey: stages[1]?.moduleKey,
      progressPercent: Math.round(100 / total)
    })
    store.close()
  })

  it('keeps project trash separate from archive and requires trash before permanent deletion', async () => {
    const { store } = await createStore()
    expect(() => store.repository.permanentlyDeleteProject('ios')).toThrow('必须先移入回收站')
    store.repository.setProjectPinned('ios', true)
    const trashed = store.repository.trashProject('ios')
    expect(trashed).toMatchObject({ id: 'ios', status: 'producing', topicStageRole: 'shelved', isPinned: true })
    expect(trashed.trashedAt).toBeTruthy()
    expect(store.repository.listProjects(false).some((project) => project.id === 'ios')).toBe(false)
    expect(store.repository.listProjects().find((project) => project.id === 'ios')?.trashedAt).toBeTruthy()
    expect(() => store.repository.getProject('ios', false)).toThrow('回收站')
    expect(store.repository.restoreProject('ios')).toMatchObject({ id: 'ios', trashedAt: null, status: 'producing', topicStageRole: 'project_created', isPinned: true })

    store.repository.trashProject('ios')
    expect(store.repository.permanentlyDeleteProject('ios')).toBe(true)
    expect(store.repository.listProjects().some((project) => project.id === 'ios')).toBe(false)
    const shelvedTopic = store.repository.getSnapshot().topics.find((topic) => topic.title === 'iOS 27第一周体验')!
    expect(shelvedTopic).toMatchObject({ createdProjectId: null, stageId: 'topic-stage-shelved', nextActionKind: 'restart_project', lastProjectDeletedAt: expect.any(String) })
    const restarted = store.repository.updateTopic(shelvedTopic.id, { stageId: 'topic-stage-created' })
    expect(restarted).toMatchObject({ stageId: 'topic-stage-created', createdProjectId: expect.any(String), lastProjectDeletedAt: null })
    store.close()
  })

  it('uses protected topic lifecycle stages for completion, archive and restart', async () => {
    const { store } = await createStore()
    const systemStages = store.repository.listTopicStages().filter((stage) => stage.role !== 'standard')
    expect(systemStages.map((stage) => stage.role)).toEqual(['project_created', 'completed', 'archived', 'shelved'])
    expect(() => store.repository.updateTopicStage('topic-stage-completed', '做完')).toThrow('系统阶段不能修改')
    expect(() => store.repository.deleteTopicStage('topic-stage-archived')).toThrow('系统阶段不能删除')

    expect(store.repository.setProjectLifecycle('ios', 'completed')).toMatchObject({ status: 'producing', topicStageRole: 'completed' })
    expect(store.repository.listProjects(false).some((project) => project.id === 'ios')).toBe(false)
    expect(store.repository.setProjectLifecycle('ios', 'project_created')).toMatchObject({ status: 'producing', topicStageRole: 'project_created' })
    store.repository.setProjectPinned('ios', true)
    expect(store.repository.setProjectLifecycle('ios', 'archived')).toMatchObject({ status: 'producing', topicStageRole: 'archived', isPinned: false })
    const topic = store.repository.getSnapshot().topics.find((item) => item.createdProjectId === 'ios')!
    expect(store.repository.updateTopic(topic.id, { stageId: 'topic-stage-created' })).toMatchObject({ stageId: 'topic-stage-created', nextActionKind: 'open_project' })
    expect(store.repository.getProject('ios', false)).toMatchObject({ status: 'producing', isPinned: false })
    expect(store.repository.setProjectLifecycle('ai-browser', 'project_created')).toMatchObject({ status: 'preparing', topicStageRole: 'project_created' })
    expect(() => store.repository.trashTopic(topic.id)).toThrow('不能单独删除')
    store.close()
  })

  it('persists a standard stage display label without changing its lifecycle action', async () => {
    const { store } = await createStore()
    const before = store.repository.getSnapshot().topics.find((topic) => topic.stageId === 'topic-stage-evaluation')!
    expect(before.nextActionKind).toBe('advance_stage')

    expect(store.repository.updateTopicStage('topic-stage-evaluation', '待评估', '补齐体验后决定')).toMatchObject({
      name: '待评估',
      nextActionLabel: '补齐体验后决定',
      role: 'standard'
    })

    const after = store.repository.getSnapshot().topics.find((topic) => topic.id === before.id)!
    expect(after).toMatchObject({ nextActionKind: 'advance_stage', nextStageId: 'topic-stage-decided' })
    expect(() => store.repository.updateTopicStage('topic-stage-created', '已立项', '打开项目')).toThrow('系统阶段不能修改')
    store.close()
  })

  it('classifies a new project draft by keyword and falls back to no match', async () => {
    const { store } = await createStore()
    const ios = store.repository.classifyProjectDraft('iOS 26 深度体验', '记录系统通知变化')
    expect(ios).toMatchObject({ contentTypeId: 'type-system', templateId: 'template-system-experience' })
    expect(ios.confidence).toBeGreaterThanOrEqual(0.6)
    expect(store.repository.classifyProjectDraft('随身固态硬盘SSD横评', '').contentTypeId).toBe('type-digital')
    expect(store.repository.classifyProjectDraft('完全没有关键词的随手标题', '')).toMatchObject({ contentTypeId: null, templateId: null, confidence: 0 })
    store.close()
  })

  it('manages extensible content directions independently from non-destructive project templates', async () => {
    const { store } = await createStore()
    expect(store.repository.listProjectTemplates().map((template) => template.name)).toEqual(['数码长视频', '商单', '手机系统测评', 'AI教学', '数码短视频'])

    const custom = store.repository.createContentType('AI实战日志')
    expect(custom.defaultProjectTemplateId).toBeNull()
    expect(store.repository.updateContentType(custom.id, { name: 'AI实战与复盘' }).name).toBe('AI实战与复盘')
    const reordered = store.repository.reorderContentTypes([custom.id, ...store.repository.listContentTypes().filter((type) => type.id !== custom.id).map((type) => type.id)])
    expect(reordered[0]?.id).toBe(custom.id)

    const project = store.repository.createProject({
      title: '自定义AI项目', description: '验证方向和模板互不绑定。', contentTypeId: custom.id,
      templateId: 'template-ai-tutorial', colorToken: 'project-7', platformTargets: ['B站']
    })
    expect(project.contentTypeName).toBe('AI实战与复盘')
    expect(store.repository.getSnapshot().topics.find((topic) => topic.createdProjectId === project.id)).toMatchObject({ title: project.title, contentTypeId: custom.id, stageId: 'topic-stage-created' })
    expect(project.appliedTemplateName).toBe('AI教学')
    expect(project.modules.find((module) => module.key === 'outline')?.enabled).toBe(true)

    const blank = store.repository.createProject({
      title: '空白项目', description: '', contentTypeId: custom.id, templateId: null, colorToken: 'project-8', platformTargets: []
    })
    expect(blank.modules.filter((module) => module.enabled).map((module) => module.key)).toEqual(['overview', 'versions'])

    const commercialBefore = store.repository.getProject('sponsor', false)
    expect(commercialBefore.modules.find((module) => module.key === 'postproduction')?.enabled).toBe(true)
    expect(commercialBefore.modules.some((module) => module.key === 'feedback' && module.enabled)).toBe(false)
    const changed = store.repository.updateProjectContentType('sponsor', custom.id)
    expect(changed.contentTypeId).toBe(custom.id)
    expect(changed.appliedTemplateId).toBe('template-commercial')
    expect(changed.modules.find((module) => module.key === 'business')?.enabled).toBe(true)
    expect(changed.isCommercial).toBe(true)
    expect(changed.contentTypeHistory[0]).toMatchObject({ previousContentTypeId: 'type-undetermined', nextContentTypeId: custom.id })
    expect(store.repository.getSnapshot().topics.find((topic) => topic.createdProjectId === 'sponsor')?.contentTypeId).toBe(custom.id)

    expect(store.repository.renameProject(project.id, '项目端统一命名').title).toBe('项目端统一命名')
    expect(store.repository.getSnapshot().topics.find((topic) => topic.createdProjectId === project.id)?.title).toBe('项目端统一命名')
    const linkedTopic = store.repository.getSnapshot().topics.find((topic) => topic.createdProjectId === project.id)!
    expect(store.repository.updateTopic(linkedTopic.id, { title: '选题端也能改名' }).title).toBe('选题端也能改名')
    expect(store.repository.getProject(project.id, false).title).toBe('选题端也能改名')
    expect(store.repository.updateProjectPlatforms(project.id, ['YouTube', 'B站', 'B站']).platformTargets).toEqual(['YouTube', 'B站'])
    expect(() => store.repository.updateProjectPlatforms(project.id, ['不存在的平台'])).toThrow('目标平台不可用')

    const preview = store.repository.previewProjectTemplate('sponsor', 'template-commercial')
    expect(preview.blocked).toEqual([])
    expect(preview.suggestHide).toEqual([])
    const applied = store.repository.applyProjectTemplate('sponsor', 'template-quick-content')
    expect(applied.appliedTemplateId).toBe('template-quick-content')
    expect(applied.modules.find((module) => module.key === 'materials')?.enabled).toBe(true)
    expect(applied.modules.some((module) => module.key === 'feedback' && module.enabled)).toBe(false)

    store.repository.updateContentType(custom.id, { isActive: false })
    expect(store.repository.getProject(project.id, false).contentTypeName).toBe('AI实战与复盘')
    expect(() => store.repository.createProject({ title: '不可用方向', description: '', contentTypeId: custom.id, templateId: null, colorToken: 'project-1', platformTargets: [] })).toThrow('所选内容方向不可用')
    store.close()
  })

  it('preserves hidden module content roots and keeps feedback inside outline and script', async () => {
    const { store } = await createStore()
    const before = store.repository.getProject('ios', false)
    const outline = before.modules.find((module) => module.key === 'outline')
    expect(outline?.enabled).toBe(true)
    const hidden = store.repository.setModule('ios', 'outline', false)
    expect(hidden.modules.find((module) => module.key === 'outline')?.enabled).toBe(false)
    const restored = store.repository.setModule('ios', 'outline', true)
    expect(restored.modules.find((module) => module.key === 'outline')?.contentRootId).toBe(outline?.contentRootId)
    const reordered = store.repository.reorderModules('ios', ['publishing', 'postproduction', 'shooting', 'editing', 'script', 'outline', 'materials'])
    expect(reordered.modules.filter((module) => module.key !== 'feedback').map((module) => module.key)).toEqual(['overview', 'publishing', 'postproduction', 'shooting', 'editing', 'script', 'outline', 'materials', 'production', 'versions'])
    expect(reordered.modules.find((module) => module.key === 'outline')?.contentRootId).toBe(outline?.contentRootId)
    expect(() => store.repository.reorderModules('ios', ['materials', 'outline', 'script', 'production', 'production', 'publishing'])).toThrow('项目模块顺序与当前项目不匹配')
    expect(() => store.repository.setModule('ios', 'feedback', true)).toThrow('甲方反馈已合并到大纲和文案')
    store.close()
  })

  it('creates new outline and description versions instead of overwriting history', async () => {
    const { store } = await createStore()
    const before = store.repository.getProject('ios', false).latestVersions
    const outline = store.repository.saveOutline('ios', [{ id: 'one', text: '新的第一段' }])
    const updated = store.repository.updateDescription('ios', '新的项目角度')
    expect(outline.parentVersionIds).toHaveLength(1)
    expect(updated.description).toBe('新的项目角度')
    const versionRows = store.repository.native.prepare(`SELECT document_type,COUNT(*) AS count FROM draft_versions WHERE project_id = 'ios' GROUP BY document_type`).all() as { document_type: string; count: number }[]
    expect(versionRows.find((row) => row.document_type === 'outline')?.count).toBeGreaterThan(1)
    expect(versionRows.find((row) => row.document_type === 'project_description')?.count).toBeGreaterThan(1)
    expect(before.length).toBeGreaterThan(0)
    store.close()
  })

  it('keeps one current final script and persists confirmed style preferences', async () => {
    const { store } = await createStore()
    const first = store.repository.saveScript('ai-browser', 'user_edit', '<p>AI初稿表达</p>', undefined, '影像部分修改版')
    expect(first.displayName).toBe('影像部分修改版')
    expect(store.repository.getProject('ai-browser', false).versions.find((version) => version.id === first.id)?.displayName).toBe('影像部分修改版')
    const finalOne = store.repository.saveScript('ai-browser', 'final', '<p>第一次定稿</p>')
    expect(store.repository.getProject('ai-browser', false).versions.filter((version) => version.isFinal)).toHaveLength(1)

    const finalTwo = store.repository.saveScript('ai-browser', 'user_edit', '<p>第二次定稿</p>')
    store.repository.setFinalVersion('ai-browser', finalTwo.id)
    const detail = store.repository.getProject('ai-browser', false)
    expect(detail.versions.find((version) => version.id === finalOne.id)?.isFinal).toBe(false)
    expect(detail.versions.find((version) => version.id === finalTwo.id)?.isFinal).toBe(true)

    const preference = store.repository.confirmStylePreference('ai-browser', first.id, finalTwo.id, '保留更直接的口语表达')
    expect(preference.note).toBe('保留更直接的口语表达')
    expect(store.repository.getProject('ai-browser', false).stylePreferences).toEqual([expect.objectContaining({ sourceVersionId: first.id, finalVersionId: finalTwo.id })])
    store.close()
  })

  it('only creates exact link groups with matching script versions from the same project', async () => {
    const { store } = await createStore()
    const versions = store.repository.listLatestScriptVersions('ai-browser')
    const merged = versions.find((version) => version.kind === 'merged_draft')
    const claude = versions.find((version) => version.kind === 'claude_candidate')
    const codex = versions.find((version) => version.kind === 'codex_candidate')
    expect(merged && claude && codex).toBeTruthy()
    const group = store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-1', labelIndex: 1, selectedText: '找到资料、核对来源',
      mergedVersionId: merged!.id, claudeVersionId: claude!.id, codexVersionId: codex!.id
    })
    expect(group.matchType).toBe('exact')
    expect(store.repository.listLinkGroups('ai-browser', merged!.id)).toHaveLength(1)

    expect(() => store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-2', labelIndex: 2, selectedText: '这段文字并不存在',
      mergedVersionId: merged!.id, claudeVersionId: claude!.id, codexVersionId: null
    })).toThrow('所选文字不在指定合并稿版本中')

    const wrongKind = store.repository.saveScript('ai-browser', 'user_edit', '<p>找到资料、核对来源</p>')
    expect(() => store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-2', labelIndex: 2, selectedText: '找到资料、核对来源',
      mergedVersionId: merged!.id, claudeVersionId: wrongKind.id, codexVersionId: null
    })).toThrow('联动标记的文案版本类型不匹配')

    const foreignCandidate = store.repository.saveScript('ios', 'claude_candidate', '<p>另一个项目的候选稿</p>')
    expect(() => store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-2', labelIndex: 2, selectedText: '错误关联',
      mergedVersionId: merged!.id, claudeVersionId: foreignCandidate.id, codexVersionId: codex!.id
    })).toThrow('联动标记只能关联当前项目的文案版本')
    expect(store.repository.deleteLinkGroup('ai-browser', group.id)).toBe(true)
    expect(store.repository.listLinkGroups('ai-browser', merged!.id)).toHaveLength(0)

    const inlineMerged = store.repository.saveScript('ai-browser', 'merged_draft', '<p>跨<strong>节点</strong>匹配</p>')
    const inlineClaude = store.repository.saveScript('ai-browser', 'claude_candidate', '<p>跨<em>节点</em>匹配</p>')
    expect(store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-1', labelIndex: 1, selectedText: '跨节点匹配',
      mergedVersionId: inlineMerged.id, claudeVersionId: inlineClaude.id, codexVersionId: null
    }).matchType).toBe('exact')
    const savedMerged = store.repository.saveScript('ai-browser', 'merged_draft', '<p><mark data-color="#F3D9A3" data-link-index="1">跨<strong>节点</strong>匹配</mark></p>')
    expect(savedMerged.content).not.toContain('data-link-index')
    expect(savedMerged.parentVersionIds).toEqual([inlineMerged.id])
    expect(store.repository.listLinkGroups('ai-browser', savedMerged.id)).toMatchObject([{
      labelIndex: 1, selectedText: '跨节点匹配', mergedVersionId: savedMerged.id, claudeVersionId: inlineClaude.id
    }])
    const external = store.repository.importScript('ai-browser', '# 外部稿', { id: randomUUID(), relativePath: 'imports/ai-browser/external.md', originalName: 'external.md', sha256: 'a'.repeat(64), sizeBytes: 12, mimeType: 'text/markdown', createdAt: new Date().toISOString() })
    const newerExternal = store.repository.importScript('ai-browser', '# 更新的外部稿', { id: randomUUID(), relativePath: 'imports/ai-browser/newer-external.md', originalName: 'newer-external.md', sha256: 'b'.repeat(64), sizeBytes: 15, mimeType: 'text/markdown', createdAt: new Date().toISOString() })
    const resolved = store.repository.saveScript('ai-browser', 'merged_draft', '<p>外部稿</p>', external.id)
    expect(resolved.parentVersionIds).toContain(external.id)
    expect(resolved.parentVersionIds).not.toContain(newerExternal.id)
    expect(store.repository.listLinkGroups('ai-browser', resolved.id)).toHaveLength(0)

    const punctuationMerged = store.repository.saveScript('ai-browser', 'merged_draft', '<p>数值1 &lt; 2 &gt; 0</p><p>第二段</p>')
    const punctuationClaude = store.repository.saveScript('ai-browser', 'claude_candidate', '<p>数值1 &lt; <strong>2</strong> &gt; 0</p><div>第二段</div>')
    expect(store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-2', labelIndex: 1, selectedText: '1 < 2 > 0',
      mergedVersionId: punctuationMerged.id, claudeVersionId: punctuationClaude.id, codexVersionId: null
    }).selectedText).toBe('1 < 2 > 0')
    const codeMerged = store.repository.saveScript('ai-browser', 'merged_draft', '<p>代码&lt;button&gt;可见</p>')
    const codeClaude = store.repository.saveScript('ai-browser', 'claude_candidate', '<p>代码<strong>&lt;button&gt;</strong>可见</p>')
    expect(store.repository.createLinkGroup({
      projectId: 'ai-browser', colorToken: 'highlight-3', labelIndex: 1, selectedText: '<button>',
      mergedVersionId: codeMerged.id, claudeVersionId: codeClaude.id, codexVersionId: null
    }).selectedText).toBe('<button>')

    const malformedMerged = store.repository.saveScript('ai-browser', 'merged_draft', '<p>正常内容</p>')
    store.repository.native.prepare(`INSERT INTO link_groups(id,project_id,color_token,label_index,selected_text,merged_version_id,claude_version_id,codex_version_id,match_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), 'ai-browser', 'highlight-4', 1, '<b>', malformedMerged.id, codeClaude.id, null, 'exact', new Date().toISOString())
    expect(() => store.repository.saveScript('ai-browser', 'merged_draft', '<p>正常内容已更新</p>')).not.toThrow()
    store.close()
  })

  it('persists captures and preferences across restart and produces a bounded backup', async () => {
    const { store, directory } = await createStore()
    const capture = store.repository.createCapture({ captureKind: 'project_content', primaryProjectId: 'ssd', originalContent: '补测发热', sourceType: 'quick_capture' })
    store.repository.setPreferences({ theme: 'dark', visualStyle: 'feishu', workbenchMergedVisible: false })
    await store.createBackup('unit')
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getSnapshot().captures.some((item) => item.id === capture.id)).toBe(true)
    expect(reopened.repository.getPreferences()).toMatchObject({ theme: 'dark', visualStyle: 'feishu', workbenchMergedVisible: false })
    expect((await readdir(join(directory, 'backups'))).some((file) => file.endsWith('-unit'))).toBe(true)
    expect(() => reopened.repository.createCapture({ captureKind: 'client_feedback', primaryProjectId: 'ios', originalContent: '不允许', sourceType: 'quick_capture' })).toThrow('甲方反馈只能关联商单项目')
    reopened.close()
  })

  it('moves ideas and topics through the recycle bin and requires soft delete before purge', async () => {
    const { store } = await createStore()
    const stageId = store.repository.listTopicStages()[0]!.id
    const topic = store.repository.createTopic({ title: '临时选题', coreAngle: '', contentTypeId: 'type-digital', importanceLevel: 0, needsMoreExperience: false, startAt: null, expectedCompletionAt: null, actualCompletionAt: null, stageId })
    expect(() => store.repository.permanentlyDeleteTopic(topic.id)).toThrow('必须先移入回收站')
    expect(store.repository.trashTopic(topic.id).trashedAt).toBeTruthy()
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)?.trashedAt).toBeTruthy()
    expect(store.repository.restoreTopic(topic.id).trashedAt).toBeNull()
    store.repository.trashTopic(topic.id)
    expect(store.repository.permanentlyDeleteTopic(topic.id)).toBe(true)
    expect(store.repository.getSnapshot().topics.some((item) => item.id === topic.id)).toBe(false)

    const capture = store.repository.createCapture({ captureKind: 'general_record', primaryProjectId: null, originalContent: '临时灵感', sourceType: 'quick_capture' })
    expect(() => store.repository.permanentlyDeleteCapture(capture.id)).toThrow('先弃用')
    expect(store.repository.setCaptureUseStatus(capture.id, 'discarded').discardedAt).toBeTruthy()
    expect(store.repository.setCaptureUseStatus(capture.id, 'active').discardedAt).toBeNull()
    store.repository.setCaptureUseStatus(capture.id, 'discarded')
    expect(store.repository.permanentlyDeleteCapture(capture.id)).toBe(true)
    expect(store.repository.getSnapshot().captures.some((item) => item.id === capture.id)).toBe(false)
    store.close()
  })

  it('keeps old recycle entries after the workspace is reopened', async () => {
    const { store, directory } = await createStore()
    const stageId = store.repository.listTopicStages()[0]!.id
    const base = { coreAngle: '', contentTypeId: 'type-digital', importanceLevel: 0, needsMoreExperience: false, startAt: null, expectedCompletionAt: null, actualCompletionAt: null, stageId }
    const stale = store.repository.createTopic({ title: '陈旧选题', ...base })
    store.repository.trashTopic(stale.id)
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    store.repository.native.prepare('UPDATE topics SET trashed_at=? WHERE id=?').run(longAgo, stale.id)
    store.close()
    const reopened = await openWorkspaceStore(directory)
    const saved = reopened.repository.getSnapshot().topics.find((item) => item.id === stale.id)
    expect(saved?.trashedAt).toBe(longAgo)
    reopened.close()
  })

  it('marks project stages complete and treats publishing completion as project published', async () => {
    const { store } = await createStore()
    expect(store.repository.getProject('ios', false).modules.map((module) => module.key)).toContain('publishing')
    const afterMaterials = store.repository.setModuleCompleted('ios', 'materials', true)
    expect(afterMaterials.project.modules.find((module) => module.key === 'materials')?.completedAt).toBeTruthy()
    expect(afterMaterials.record).toMatchObject({ stageKey: 'materials', status: 'completed', completedAt: { localDate: '2026-07-18', segment: 'afternoon' } })
    expect(afterMaterials.project.status).not.toBe('published')
    const published = store.repository.setModuleCompleted('ios', 'publishing', true)
    expect(published.project.status).toBe('published')
    expect(published.project.modules.find((module) => module.key === 'publishing')?.completedAt).toBeTruthy()
    const reverted = store.repository.setModuleCompleted('ios', 'publishing', false)
    expect(reverted.project.status).toBe('producing')
    expect(reverted.project.modules.find((module) => module.key === 'publishing')?.completedAt).toBeNull()
    store.close()
  })

  it('derives the third planned field from the two most recently edited fields without completing the stage', async () => {
    const { store } = await createStore()
    const first = store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'start', point: { localDate: '2026-07-25', segment: 'evening' } },
      source: 'manual'
    })
    expect(first.changed && first.record).toMatchObject({ plannedStartedAt: { localDate: '2026-07-25', segment: 'evening' }, planAutoField: null })
    const second = store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'duration', durationHalfDayUnits: 3 },
      source: 'manual'
    })
    expect(second.changed && second.record).toMatchObject({
      status: 'not_started',
      plannedCompletedAt: { localDate: '2026-07-26', segment: 'afternoon' },
      estimatedDurationHalfDayUnits: 3,
      planManualFields: ['start', 'duration'],
      planAutoField: 'end'
    })
    expect(store.repository.getProject('ios', false).modules.find((module) => module.key === 'production')?.completedAt).toBeNull()
    const ignoredAutoClear = store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'end', point: null },
      source: 'manual'
    })
    expect(ignoredAutoClear.changed).toBe(false)
    expect(ignoredAutoClear.record).toMatchObject({
      plannedCompletedAt: { localDate: '2026-07-26', segment: 'afternoon' },
      planManualFields: ['start', 'duration'],
      planAutoField: 'end'
    })
    const overridden = store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'end', point: { localDate: '2026-07-27', segment: 'morning' } },
      source: 'manual'
    })
    expect(overridden.changed && overridden.record).toMatchObject({
      plannedStartedAt: { localDate: '2026-07-26', segment: 'afternoon' },
      planManualFields: ['duration', 'end'],
      planAutoField: 'start'
    })
    expect(() => store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'start', point: { localDate: '2026-07-28', segment: 'morning' } },
      source: 'manual'
    })).toThrow('结束时间不能早于开始时间')
    store.close()
  })

  it('accepts a 100-day derived stage plan and rejects a longer one before writing to SQLite', async () => {
    const { store } = await createStore()
    const start = { localDate: '2026-07-25', segment: 'morning' as const }
    store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'start', point: start },
      source: 'manual'
    })
    const maximum = store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'end', point: shiftStageTimePoint(start, 199) },
      source: 'manual'
    })
    expect(maximum.changed && maximum.record).toMatchObject({
      estimatedDurationHalfDayUnits: 200,
      planAutoField: 'duration'
    })
    expect(() => store.repository.updateStageTime('ios', 'shooting', {
      planEdit: { field: 'end', point: shiftStageTimePoint(start, 200) },
      source: 'manual'
    })).toThrow('阶段计划最多支持100天')
    store.close()
  })

  it('opens the project capture window in a dedicated client feedback mode', async () => {
    const { store } = await createStore()
    expect(store.repository.getCaptureContext('sponsor', 'client_feedback')).toMatchObject({
      preferredProjectId: 'sponsor',
      preferredCaptureKind: 'client_feedback',
      theme: 'light',
      visualStyle: 'warm'
    })
    store.close()
  })

  it('learns from a completed project to steer classification of similar titles', async () => {
    const { store } = await createStore()
    expect(store.repository.classifyProjectDraft('iPhone相机夜拍数码横评', '').contentTypeId).toBe('type-digital')
    const project = store.repository.createProject({ title: 'iPhone相机夜拍数码', description: '', contentTypeId: 'type-system', colorToken: 'project-1', platformTargets: [], aiSuggestedContentTypeId: 'type-digital' })
    store.repository.setModuleCompleted(project.id, 'publishing', true)
    expect(store.repository.classifyProjectDraft('iPhone相机夜拍数码横评', '').contentTypeId).toBe('type-system')
    store.close()
  })

  it('creates a complete manifest backup and restores the database with retained imports', async () => {
    const { store, directory } = await createStore()
    const importsDirectory = join(directory, 'imports', 'ai-browser')
    await mkdir(importsDirectory, { recursive: true, mode: 0o700 })
    const originalName = 'unit-external.md'
    const relativePath = join('imports', 'ai-browser', `${randomUUID()}-${originalName}`)
    const absolutePath = join(directory, relativePath)
    const bytes = Buffer.from('# 单元测试外部稿\n\n保留原件。')
    await writeFile(absolutePath, bytes, { mode: 0o600 }); await chmod(absolutePath, 0o600)
    const version = store.repository.importScript('ai-browser', bytes.toString('utf8'), {
      id: randomUUID(), relativePath, originalName, sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'text/markdown', createdAt: new Date().toISOString()
    })
    store.repository.native.prepare('UPDATE draft_versions SET source_file_path=?,source_file_id=NULL WHERE id=?').run(absolutePath, version.id)
    const backup = await store.createBackup('complete-unit')
    store.close()

    const target = await mkdtemp(join(unitRoot, 'creator-os-restored-')); directories.push(target)
    await restoreWorkspaceBackup(backup, target)
    const restored = await openWorkspaceStore(target)
    const restoredVersion = restored.repository.getProject('ai-browser', false).versions.find((item) => item.id === version.id)
    expect(restoredVersion?.sourceFileId).toBeTruthy()
    expect(restoredVersion?.sourceFilePath).toBeNull()
    expect(await readFile(join(target, relativePath), 'utf8')).toContain('保留原件')
    expect((await stat(join(target, relativePath))).mode & 0o777).toBe(0o600)
    restored.close()

    await writeFile(join(backup, 'undeclared.bin'), 'not in manifest')
    const rejectedTarget = await mkdtemp(join(unitRoot, 'creator-os-rejected-')); directories.push(rejectedTarget)
    await expect(restoreWorkspaceBackup(backup, rejectedTarget)).rejects.toThrow('封闭清单不一致')
    expect(await readdir(rejectedTarget)).toHaveLength(0)
  })

  it('creates a pre-migration snapshot before changing an existing database and remains idempotent', async () => {
    await mkdir(unitRoot, { recursive: true })
    const directory = await mkdtemp(join(unitRoot, 'creator-os-legacy-')); directories.push(directory)
    const legacy = new BetterSqlite3(join(directory, 'creator-os.sqlite3'))
    legacy.exec('CREATE TABLE legacy_marker(value TEXT NOT NULL); INSERT INTO legacy_marker(value) VALUES(\'before migration\')')
    legacy.close()

    const store = await openWorkspaceStore(directory); store.close()
    const backups = (await readdir(join(directory, 'backups'))).filter((name) => name.includes('pre-migration'))
    expect(backups).toHaveLength(1)
    const snapshot = new BetterSqlite3(join(directory, 'backups', backups[0]!, 'workspace.sqlite3'), { readonly: true })
    expect((snapshot.prepare('SELECT value FROM legacy_marker').get() as { value: string }).value).toBe('before migration')
    snapshot.close()

    const reopened = await openWorkspaceStore(directory); reopened.close()
    const after = (await readdir(join(directory, 'backups'))).filter((name) => name.includes('pre-migration'))
    expect(after).toHaveLength(1)
  })
})

describe('dead topic columns removed by migration 0047', () => {
  it('drops next_action and planned_window while keeping topic data intact', async () => {
    const { store } = await createStore()
    const columns = (store.repository.native.prepare('PRAGMA table_info(topics)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).not.toContain('next_action')
    expect(columns).not.toContain('planned_window')
    expect(store.repository.getSnapshot().topics.length).toBeGreaterThan(0)
    store.close()
  })
})

describe('recycle bin emptying and AI filter discard category', () => {
  const insertDiscardedCandidate = (store: WorkspaceStore, id: string): void => {
    store.repository.native.prepare(`INSERT INTO conversation_filter_candidates (id, task_id, candidate_key, atom_type, theme_title, theme_key, direction_title, direction_key, title, content, value_reason, source_refs_json, content_hash, review_group, status, discarded_at, created_at, updated_at)
      VALUES (?, 'task-cover-done', ?, 'viewpoint', '主题', 'theme-key', '方向', ?, ?, '正文', '有价值', '[]', ?, 'recommended', 'discarded', '2026-07-24T10:00:00.000Z', '2026-07-24T09:00:00.000Z', '2026-07-24T10:00:00.000Z')`)
      .run(id, `key-${id}`, `direction-${id}`, `候选${id}`, `hash-${id}`)
  }

  it('lists discarded filter candidates in the snapshot and restores them to review_pending', async () => {
    const { store } = await createStore()
    insertDiscardedCandidate(store, 'cand-restore')
    const listed = store.repository.getSnapshot().discardedFilterCandidates
    expect(listed.map((candidate) => candidate.id)).toContain('cand-restore')
    const restored = store.repository.restoreFilterCandidate('cand-restore')
    expect(restored.status).toBe('review_pending')
    expect(restored.discardedAt).toBeNull()
    expect(store.repository.getSnapshot().discardedFilterCandidates.some((candidate) => candidate.id === 'cand-restore')).toBe(false)
    expect(() => store.repository.restoreFilterCandidate('cand-restore')).toThrow('候选不在回收站中')
    store.close()
  })

  it('requires discarded status before permanently deleting a filter candidate', async () => {
    const { store } = await createStore()
    insertDiscardedCandidate(store, 'cand-delete')
    store.repository.restoreFilterCandidate('cand-delete')
    expect(() => store.repository.permanentlyDeleteFilterCandidate('cand-delete')).toThrow('需先弃用')
    store.repository.setConversationFilterCandidateStatus('cand-delete', 'discarded')
    expect(store.repository.permanentlyDeleteFilterCandidate('cand-delete')).toBe(true)
    expect(store.repository.permanentlyDeleteFilterCandidate('cand-delete')).toBe(false)
    store.close()
  })

  it('empties the recycle bin item by item and keeps project business facts as a standalone ledger', async () => {
    const { store } = await createStore()
    store.repository.native.prepare(`INSERT INTO business_records (project_id, created_at, updated_at) VALUES ('sponsor', '2026-07-24T09:00:00.000Z', '2026-07-24T09:00:00.000Z')`).run()
    store.repository.trashProject('ios')
    store.repository.trashProject('sponsor')
    const capture = store.repository.getSnapshot().captures[0]!
    store.repository.setCaptureUseStatus(capture.id, 'discarded')
    const freeTopic = store.repository.getSnapshot().topics.find((topic) => !topic.createdProjectId && !topic.trashedAt)!
    store.repository.trashTopic(freeTopic.id)
    insertDiscardedCandidate(store, 'cand-empty')

    const result = store.repository.emptyRecycleBin()
    expect(result.deletedCount).toBe(5)
    expect(result.skipped).toHaveLength(0)

    const snapshot = store.repository.getSnapshot()
    expect(snapshot.projects.some((project) => project.id === 'ios')).toBe(false)
    expect(snapshot.businessLedger.find((entry) => entry.projectId === 'sponsor')).toMatchObject({ ledgerOnly: true, trashedAt: null })
    expect(snapshot.captures.some((item) => item.id === capture.id)).toBe(false)
    expect(snapshot.topics.some((topic) => topic.id === freeTopic.id)).toBe(false)
    expect(snapshot.discardedFilterCandidates).toHaveLength(0)

    const again = store.repository.emptyRecycleBin()
    expect(again.deletedCount).toBe(0)
    expect(again.skipped).toHaveLength(0)
    store.close()
  })
})

describe('topic lifecycle remains reversible after project creation', () => {
  it('creates directly in a system stage and reuses the same project after returning to a standard stage', async () => {
    const { store } = await createStore()
    const created = store.repository.createTopic({
      title: '直接立项测试',
      coreAngle: '先建项目再随时退回',
      contentTypeId: 'type-digital',
      importanceLevel: 2,
      needsMoreExperience: false,
      startAt: null,
      expectedCompletionAt: '2026-09-08',
      actualCompletionAt: null,
      stageId: 'topic-stage-created'
    })
    expect(created.createdProjectId).toBeTruthy()
    const projectId = created.createdProjectId!
    const originalProjectStatus = store.repository.getProject(projectId, false).status
    expect(store.repository.listProjects(false).some((project) => project.id === projectId)).toBe(true)

    const reverted = store.repository.updateTopic(created.id, { stageId: 'topic-stage-evaluation' })
    expect(reverted.createdProjectId).toBe(projectId)
    expect(reverted.stageId).toBe('topic-stage-evaluation')
    expect(store.repository.listProjects(false).some((project) => project.id === projectId)).toBe(false)
    expect(store.repository.getProject(projectId, false).status).toBe(originalProjectStatus)

    const reestablished = store.repository.updateTopic(created.id, { stageId: 'topic-stage-created' })
    expect(reestablished.createdProjectId).toBe(projectId)
    expect(store.repository.listProjects(false).some((project) => project.id === projectId)).toBe(true)
    expect(store.repository.getProject(projectId, false).status).toBe(originalProjectStatus)
    store.close()
  })
})

describe('topic expected completion wired to project hard deadline', () => {
  it('migrates topic expected completion into a hard deadline on establishment', async () => {
    const { store } = await createStore()
    const topic = store.repository.getSnapshot().topics.find((item) => !item.createdProjectId && !item.trashedAt)!
    store.repository.updateTopic(topic.id, { expectedCompletionAt: '2026-08-15' })
    const established = store.repository.updateTopic(topic.id, { stageId: 'topic-stage-created' })
    expect(established.createdProjectId).toBeTruthy()
    const deadline = store.repository.getSnapshot().schedules.find((item) => item.projectId === established.createdProjectId && item.scheduleKind === 'hard_deadline')
    expect(deadline).toBeTruthy()
    expect(deadline!.source).toBe('synchronized')
    expect(deadline!.startAt).toContain('2026-08-15')
    store.close()
  })

  it('edits established topic expected completion and syncs only the project target marker', async () => {
    const { store } = await createStore()
    const topic = store.repository.getSnapshot().topics.find((item) => item.createdProjectId === 'ios')!
    store.repository.updateTopic(topic.id, { expectedCompletionAt: '2026-09-01' })
    let saved = store.repository.getSnapshot().topics.find((item) => item.id === topic.id)!
    expect(saved.expectedCompletionAt).toBe('2026-09-01')
    const projection = store.repository.getSnapshot().schedules.find((item) => item.projectId === 'ios' && item.scheduleKind === 'hard_deadline' && item.source === 'synchronized')!
    expect(projection.startAt).toContain('2026-09-01')

    store.repository.createScheduleItem({ projectId: 'ios', title: '阶段硬截止', actionType: 'publishing', startAt: '2026-08-20T18:00:00', endAt: null, scheduleKind: 'hard_deadline', waitingFor: null })
    saved = store.repository.getSnapshot().topics.find((item) => item.id === topic.id)!
    expect(saved.expectedCompletionAt).toBe('2026-09-01')

    store.repository.moveScheduleItem(projection.id, '2026-09-05T18:00:00', null)
    saved = store.repository.getSnapshot().topics.find((item) => item.id === topic.id)!
    expect(saved.expectedCompletionAt).toBe('2026-09-05')

    store.repository.deleteScheduleItem(projection.id)
    saved = store.repository.getSnapshot().topics.find((item) => item.id === topic.id)!
    expect(saved.expectedCompletionAt).toBeNull()
    store.close()
  })

  it('keeps plain plan schedules away from topic expected completion', async () => {
    const { store } = await createStore()
    const topic = store.repository.getSnapshot().topics.find((item) => item.createdProjectId === 'ios')!
    const before = topic.expectedCompletionAt
    store.repository.createScheduleItem({ projectId: 'ios', title: '补拍', actionType: 'shooting', startAt: '2026-08-22T10:00:00', endAt: null, scheduleKind: 'plan', waitingFor: null })
    const after = store.repository.getSnapshot().topics.find((item) => item.id === topic.id)!
    expect(after.expectedCompletionAt).toBe(before)
    store.close()
  })
})
