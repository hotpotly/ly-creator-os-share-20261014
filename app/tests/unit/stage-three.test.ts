import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseCaptureClassificationTaskSnapshot,
  type CaptureClassificationProviderOutput,
  type CaptureClassificationTaskSnapshot
} from '../../src/main/capture-classification'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { ExternalDraftWatcher } from '../../src/main/external-draft-watcher'
import { parseRetainedImport, retainImportFromPath } from '../../src/main/imported-files'
import type { TextProviderExecutionContext } from '../../src/shared/domain'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-stage3-')); roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

const codexSecurity: TextProviderExecutionContext = {
  provider: 'codex_cli',
  providerConfigId: 'builtin:codex-cli',
  displayName: 'Codex CLI',
  cliVersion: 'test',
  fingerprint: 'test-fingerprint',
  policyVersion: 'test-policy'
}

function incompleteClassification(capture: CaptureClassificationTaskSnapshot['captures'][number]): CaptureClassificationProviderOutput['results'][number] {
  return {
    captureId: capture.id,
    captureKind: capture.explicitPath,
    contentTypeId: null,
    projectId: null,
    generalCategoryId: null,
    confidence: 0.2,
    reason: '测试中保留为待处理'
  }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('stage-three schedule, classification and native task persistence', () => {
  it('persists schedules and directly moves normal plans or hard deadlines', async () => {
    const { store } = await createStore()
    expect(store.repository.listScheduleItems()).toHaveLength(22)
    const unscheduled = store.repository.createScheduleItem({ projectId: 'ssd', title: '等待决定日期', actionType: 'materials', startAt: null, endAt: null, scheduleKind: 'plan', waitingFor: null })
    expect(unscheduled.startAt).toBeNull()
    const scheduled = store.repository.moveScheduleItem(unscheduled.id, '2026-07-30T09:00:00.000+08:00', null)
    expect(scheduled.startAt).toContain('2026-07-30')
    expect(store.repository.moveScheduleItem(unscheduled.id, null, null).startAt).toBeNull()
    expect(store.repository.deleteScheduleItem(unscheduled.id)).toBe(true)
    expect(store.repository.listScheduleItems().some((item) => item.id === unscheduled.id)).toBe(false)
    const hard = store.repository.listScheduleItems().find((item) => item.scheduleKind === 'hard_deadline')!
    expect(store.repository.moveScheduleItem(hard.id, '2026-07-31T18:00:00.000+08:00', null).startAt).toContain('2026-07-31')
    store.close()
  })

  it('applies verified Codex results, keeps uncertain suggestions and supports undo', async () => {
    const { store } = await createStore()
    const direct = store.repository.createCapture({ captureKind: 'project_content', primaryProjectId: null, originalContent: 'SSD连续写入需要再补一轮', sourceType: 'quick_capture' })
    const uncertain = store.repository.createCapture({ captureKind: 'topic_idea', primaryProjectId: null, originalContent: 'AI提示词可以单独讲一期', sourceType: 'quick_capture' })
    const topicOnly = store.repository.createCapture({ captureKind: 'topic_idea', primaryProjectId: null, originalContent: '手机系统通知变化可以单独讲一期', sourceType: 'quick_capture' })
    const general = store.repository.createCapture({ captureKind: 'unknown', primaryProjectId: null, originalContent: '今天想到投资市场里估值变化值得继续观察', sourceType: 'quick_capture' })
    expect([direct, uncertain, topicOnly, general].every((capture) => capture.classificationStatus === 'unprocessed')).toBe(true)

    const task = store.repository.createCaptureClassificationTask(codexSecurity, true)!
    const snapshot = parseCaptureClassificationTaskSnapshot(task.inputSnapshot)
    const output: CaptureClassificationProviderOutput = {
      results: snapshot.captures.map((capture) => {
        if (capture.id === direct.id) return {
          captureId: capture.id, captureKind: 'project_content', contentTypeId: 'type-digital',
          projectId: 'ssd', generalCategoryId: null, confidence: 0.96, reason: '内容明确属于SSD项目'
        }
        if (capture.id === uncertain.id) return {
          captureId: capture.id, captureKind: 'topic_idea', contentTypeId: 'type-ai',
          projectId: null, generalCategoryId: null, confidence: 0.72, reason: '方向明确但仍需用户确认'
        }
        if (capture.id === general.id) return {
          captureId: capture.id, captureKind: 'general_record', contentTypeId: null,
          projectId: null, generalCategoryId: 'general-investment-observation', confidence: 0.95, reason: '属于投资观察'
        }
        return incompleteClassification(capture)
      })
    }
    expect(store.repository.saveCaptureClassificationResult(task.id, output)).toMatchObject({ confirmedCount: 2, suggestedCount: 1 })

    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === direct.id)).toMatchObject({
      classificationStatus: 'confirmed', primaryProjectId: 'ssd', suggestedProjectId: 'ssd',
      classificationReason: 'Codex：内容明确属于SSD项目'
    })
    expect(store.repository.undoCaptureClassification(direct.id)).toMatchObject({ classificationStatus: 'suggested', primaryProjectId: null, suggestedProjectId: 'ssd' })
    const savedUncertain = store.repository.getSnapshot().captures.find((capture) => capture.id === uncertain.id)!
    expect(savedUncertain).toMatchObject({ classificationStatus: 'suggested', suggestedContentTypeId: 'type-ai', primaryProjectId: null })
    const confirmed = store.repository.confirmCaptureClassification(uncertain.id, 'ai-browser', null)
    expect(confirmed).toMatchObject({ classificationStatus: 'confirmed', primaryProjectId: 'ai-browser' })
    expect(store.repository.undoCaptureClassification(uncertain.id)).toMatchObject({
      classificationStatus: 'suggested', classificationConfidence: savedUncertain.classificationConfidence,
      classificationReason: savedUncertain.classificationReason, suggestedContentTypeId: 'type-ai'
    })
    const topicCount = store.repository.getSnapshot().topics.length
    expect(store.repository.confirmCaptureClassification(topicOnly.id, null, 'type-system')).toMatchObject({ classificationStatus: 'confirmed', primaryProjectId: null })
    expect(store.repository.getSnapshot().topics).toEqual(expect.arrayContaining([expect.objectContaining({ title: topicOnly.originalContent, contentTypeId: 'type-system' })]))
    expect(store.repository.getSnapshot().topics).toHaveLength(topicCount + 1)
    expect(store.repository.undoCaptureClassification(topicOnly.id).classificationStatus).toBe('unprocessed')
    expect(store.repository.getSnapshot().topics).toHaveLength(topicCount)
    const savedGeneral = store.repository.getSnapshot().captures.find((capture) => capture.id === general.id)!
    expect(savedGeneral).toMatchObject({ captureKind: 'general_record', classificationStatus: 'confirmed', generalCategoryId: 'general-investment-observation' })
    expect(store.repository.undoCaptureClassification(general.id)).toMatchObject({ captureKind: 'general_record', classificationStatus: 'suggested', generalCategoryId: 'general-investment-observation' })
    expect(() => store.repository.createGeneralRecordCategory('投资建议')).toThrow('投资观察')
    const readingCategory = store.repository.createGeneralRecordCategory('阅读摘录')
    const manualGeneral = store.repository.confirmCaptureClassification(topicOnly.id, null, null, 'general_record', readingCategory.id)
    expect(manualGeneral).toMatchObject({ captureKind: 'general_record', generalCategoryId: readingCategory.id, linkedTopicId: null, usageType: null })
    expect(store.repository.undoCaptureClassification(topicOnly.id)).toMatchObject({ captureKind: 'topic_idea' })
    store.close()
  })

  it('persists detailed descriptions and sends only active definitions to Codex snapshots', async () => {
    const { store, directory } = await createStore()
    const contentType = store.repository.createContentType('知识管理')
    const describedType = store.repository.updateContentType(contentType.id, { description: '第二大脑、知识库和笔记软件的使用方法。' })
    expect(describedType.description).toContain('第二大脑')

    const historical = store.repository.createCapture({ captureKind: 'topic_idea', primaryProjectId: null, originalContent: '第二大脑可以单独讲一期', sourceType: 'quick_capture' })
    const reading = store.repository.createGeneralRecordCategory('阅读摘录')
    store.repository.updateGeneralRecordCategory(reading.id, { description: '书籍、文章和论文中的阅读摘录。' })
    const general = store.repository.createCapture({ captureKind: 'general_record', primaryProjectId: null, originalContent: '这篇论文中的实验方法值得摘录', sourceType: 'quick_capture' })
    const task = store.repository.createCaptureClassificationTask(codexSecurity, true)!
    const taskSnapshot = parseCaptureClassificationTaskSnapshot(task.inputSnapshot)
    expect(taskSnapshot.definitions.contentTypes).toEqual(expect.arrayContaining([expect.objectContaining({
      id: contentType.id, description: expect.stringContaining('第二大脑')
    })]))
    expect(taskSnapshot.definitions.generalRecordCategories).toEqual(expect.arrayContaining([expect.objectContaining({
      id: reading.id, description: expect.stringContaining('论文')
    })]))
    store.repository.saveCaptureClassificationResult(task.id, {
      results: taskSnapshot.captures.map((capture) => {
        if (capture.id === historical.id) return {
          captureId: capture.id, captureKind: 'topic_idea', contentTypeId: contentType.id,
          projectId: null, generalCategoryId: null, confidence: 0.76, reason: '详细说明匹配知识管理'
        }
        if (capture.id === general.id) return {
          captureId: capture.id, captureKind: 'general_record', contentTypeId: null,
          projectId: null, generalCategoryId: reading.id, confidence: 0.93, reason: '详细说明明确包含论文摘录'
        }
        return incompleteClassification(capture)
      })
    })
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === historical.id)).toMatchObject({
      classificationStatus: 'suggested', suggestedContentTypeId: contentType.id,
      classificationReason: expect.stringContaining('详细说明')
    })
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === general.id)).toMatchObject({
      classificationStatus: 'confirmed', generalCategoryId: reading.id,
      classificationReason: expect.stringContaining('详细说明')
    })
    store.repository.updateTaskRun(task.id, { status: 'succeeded' })

    store.repository.updateGeneralRecordCategory(reading.id, { isActive: false, description: '停用后的新描述不应进入新任务。' })
    store.repository.createCapture({ captureKind: 'unknown', primaryProjectId: null, originalContent: '新的待归类记录', sourceType: 'quick_capture' })
    const nextTask = store.repository.createCaptureClassificationTask(codexSecurity)!
    const nextTaskSnapshot = parseCaptureClassificationTaskSnapshot(nextTask.inputSnapshot)
    expect(nextTaskSnapshot.definitions.generalRecordCategories.some((category) => category.id === reading.id)).toBe(false)
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === general.id)).toMatchObject({ generalCategoryId: reading.id, classificationStatus: 'confirmed' })

    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.listContentTypes().find((type) => type.id === contentType.id)?.description).toContain('第二大脑')
    expect(reopened.repository.listGeneralRecordCategories().find((category) => category.id === reading.id)).toMatchObject({ isActive: false, description: '停用后的新描述不应进入新任务。' })
    reopened.close()
  })

  it('keeps configurable topic stages and derived next actions synchronized', async () => {
    const { store } = await createStore()
    const created = store.repository.createTopicStage('脚本验证')
    expect(store.repository.updateTopicStage(created.id, '文案验证')).toMatchObject({ name: '文案验证' })
    const original = store.repository.listTopicStages()
    const reorderedIds = [original[0]!.id, created.id, ...original.slice(1).filter((stage) => stage.id !== created.id).map((stage) => stage.id)]
    expect(store.repository.reorderTopicStages(reorderedIds).map((stage) => stage.id)).toEqual(reorderedIds)

    const topic = store.repository.createTopic({
      title: '阶段同步测试', coreAngle: '验证下一步由阶段顺序生成', contentTypeId: 'type-ai',
      importanceLevel: 1, needsMoreExperience: false, startAt: null, expectedCompletionAt: null, actualCompletionAt: null, stageId: reorderedIds[0]!
    })
    expect(topic).toMatchObject({ nextActionKind: 'advance_stage', nextStageId: created.id })
    expect(store.repository.updateTopic(topic.id, { stageId: created.id })).toMatchObject({ stageId: created.id, nextStageId: 'topic-stage-evaluation' })

    const deletion = store.repository.deleteTopicStage(created.id)
    expect(deletion).toMatchObject({ reassignedTopicCount: 1, replacementStageName: '待评估' })
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)).toMatchObject({ stageId: 'topic-stage-evaluation', nextActionKind: 'advance_stage' })

    const customColumn = store.repository.createTopicColumn('实测轮次', 'number')
    expect(store.repository.setTopicCustomValue(topic.id, customColumn.id, '3').customValues[customColumn.id]).toBe('3')
    expect(store.repository.updateTopicColumn(customColumn.id, { name: '体验轮次' })).toMatchObject({ name: '体验轮次' })
    expect(() => store.repository.setTopicCustomValue(topic.id, customColumn.id, '三')).toThrow('请输入数字')
    expect(store.repository.deleteTopicColumn('topic-column-importance').find((column) => column.id === 'topic-column-importance')).toMatchObject({ isVisible: false })
    expect(store.repository.updateTopicColumn('topic-column-importance', { isVisible: true })).toMatchObject({ isVisible: true })
    expect(store.repository.deleteTopicColumn(customColumn.id).some((column) => column.id === customColumn.id)).toBe(false)
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)?.customValues[customColumn.id]).toBeUndefined()
    store.close()
  })

  it('ranks likely destinations and keeps topic linkage, stars and project creation consistent', async () => {
    const { store } = await createStore()
    const initialStageId = store.repository.listTopicStages()[0]!.id
    const capture = store.repository.createCapture({ captureKind: 'unknown', primaryProjectId: null, originalContent: 'SSD持续写入时发热比我预期明显，想放进长期体验', sourceType: 'quick_capture' })
    const candidates = store.repository.listCaptureDestinationCandidates(capture.id)
    expect(candidates[0]).toMatchObject({ projectId: 'ssd', contentTypeId: 'type-digital' })
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(0.6)

    const topic = store.repository.createTopic({
      title: 'SSD长期体验值不值做', coreAngle: '只讲真实剪辑工程里的差异', contentTypeId: 'type-digital',
      importanceLevel: 2, needsMoreExperience: true, startAt: null, expectedCompletionAt: null, actualCompletionAt: null, stageId: initialStageId
    })
    expect(topic).toMatchObject({ importanceLevel: 2, stageId: initialStageId, nextActionKind: 'advance_stage' })
    const customType = store.repository.createContentType('效率工具')
    expect(store.repository.listResources().find((resource) => resource.contentTypeId === customType.id)).toMatchObject({ selectionMode: 'automatic', resourceType: 'style_profile' })
    expect(store.repository.createTopic({
      title: '效率工具新方向选题', coreAngle: '验证新增方向能被选题直接使用', contentTypeId: customType.id,
      importanceLevel: 1, needsMoreExperience: false, startAt: null, expectedCompletionAt: null, actualCompletionAt: null, stageId: initialStageId
    })).toMatchObject({ contentTypeId: customType.id, stageId: initialStageId })
    const linked = store.repository.attachCaptureToTopic(capture.id, topic.id)
    expect(linked).toMatchObject({ linkedTopicId: topic.id, captureKind: 'topic_idea', classificationStatus: 'confirmed' })
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)?.sourceCaptureIds).toContain(capture.id)
    expect(store.repository.undoCaptureClassification(capture.id)).toMatchObject({ linkedTopicId: null })
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)?.sourceCaptureIds).not.toContain(capture.id)

    const retyped = store.repository.attachCaptureToTopic(capture.id, topic.id)
    expect(retyped).toMatchObject({ captureKind: 'topic_idea', linkedTopicId: topic.id })
    expect(store.repository.confirmCaptureClassification(capture.id, 'ssd', 'type-digital', 'project_content')).toMatchObject({ captureKind: 'project_content', primaryProjectId: 'ssd', linkedTopicId: null })
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)?.sourceCaptureIds).not.toContain(capture.id)
    expect(store.repository.undoCaptureClassification(capture.id)).toMatchObject({ captureKind: 'topic_idea', linkedTopicId: topic.id, primaryProjectId: null })
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)?.sourceCaptureIds).toContain(capture.id)

    expect(store.repository.updateTopic(topic.id, { importanceLevel: 3, stageId: 'topic-stage-decided' })).toMatchObject({ importanceLevel: 3, stageId: 'topic-stage-decided', nextActionKind: 'create_project' })
    expect(store.repository.updateTopic(topic.id, { startAt: '2026-07-20', expectedCompletionAt: '2026-07-24', actualCompletionAt: '2026-07-22' })).toMatchObject({ startAt: '2026-07-20', expectedCompletionAt: '2026-07-24', actualCompletionAt: '2026-07-22', scheduleVarianceDays: -2 })
    expect(store.repository.updateTopic(topic.id, { actualCompletionAt: '2026-07-26' })).toMatchObject({ scheduleVarianceDays: 2 })
    expect(store.repository.updateTopic(topic.id, { startAt: null, expectedCompletionAt: '2020-01-01', actualCompletionAt: null }).scheduleVarianceDays).toBeGreaterThan(0)
    expect(() => store.repository.updateTopic(topic.id, { startAt: '2026-07-27' })).toThrow('开始时间不能晚于目标日')
    const established = store.repository.updateTopic(topic.id, { stageId: 'topic-stage-created' })
    expect(established).toMatchObject({ stageId: 'topic-stage-created', nextActionKind: 'open_project' })
    const project = store.repository.getProject(established.createdProjectId!, false)
    expect(project).toMatchObject({ title: topic.title, contentTypeId: 'type-digital' })
    expect(project.resourceReferences).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'base_style', enabled: true })]))
    expect(store.repository.getSnapshot().topics.find((item) => item.id === topic.id)).toMatchObject({ stageId: 'topic-stage-created', nextActionKind: 'open_project', createdProjectId: project.id })
    expect(store.repository.updateTopic(topic.id, { stageId: 'topic-stage-shelved' })).toMatchObject({ nextActionKind: 'restart_project' })
    expect(store.repository.updateTopic(topic.id, { stageId: 'topic-stage-created' })).toMatchObject({ nextActionKind: 'open_project' })
    store.close()
  })

  it('records least-privilege task packets, restart recovery, cancellation and retry lineage', async () => {
    const { store } = await createStore()
    const task = store.repository.createTaskRun({
      taskType: 'draft_generation', projectId: 'ai-browser', title: '单元测试文案', provider: 'mock', inputSnapshot: '只生成候选',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'new_version', shell: false }, outputTarget: 'candidate:script'
    })
    expect(task.projectDescriptionSnapshot).toContain('真实任务')
    store.repository.updateTaskRun(task.id, { status: 'running', progress: 42, startedAt: new Date().toISOString() })
    store.repository.recoverInterruptedTasks()
    expect(store.repository.getTaskRun(task.id)).toMatchObject({ status: 'queued', progress: 0, errorCode: 'APP_RESTARTED' })
    expect(store.repository.cancelTaskRun(task.id).status).toBe('canceled')
    const retried = store.repository.retryTaskRun(task.id)
    expect(retried).toMatchObject({ status: 'queued', retryOfId: task.id })
    expect(retried.permissionProfile.shell).toBe(false)
    const confirmationOnly = store.repository.getTaskRun('task-transcript-confirm')
    expect(confirmationOnly).toMatchObject({ provider: 'none', status: 'waiting_confirmation' })
    expect(store.repository.confirmTaskRun(confirmationOnly.id)).toMatchObject({ status: 'succeeded', progress: 100, requiresConfirmation: false })
    const retryableConfirmation = store.repository.createTaskRun({
      taskType: 'external_import', projectId: null, title: '待确认测试', provider: 'none', inputSnapshot: '确认后完成',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'none', shell: false }, requiresConfirmation: true
    })
    store.repository.cancelTaskRun(retryableConfirmation.id)
    expect(store.repository.retryTaskRun(retryableConfirmation.id)).toMatchObject({ provider: 'none', status: 'waiting_confirmation', requiresConfirmation: true })
    const failed = store.repository.createTaskRun({
      taskType: 'mock_demo', projectId: null, title: '可关闭失败任务', provider: 'mock', inputSnapshot: '失败后不再上浮',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'none', shell: false }
    })
    store.repository.updateTaskRun(failed.id, { status: 'failed', errorCode: 'TEST_FAILURE', errorMessage: '测试失败', finishedAt: new Date().toISOString() })
    expect(store.repository.dismissTaskRun(failed.id)).toMatchObject({ status: 'canceled', errorCode: 'USER_DISMISSED' })
    expect(() => store.repository.dismissTaskRun(task.id)).toThrow('只有失败任务可以关闭')
    store.close()
  })

  it('builds immutable task resource snapshots with mandatory, automatic, recommended and manual inputs', async () => {
    const { store } = await createStore()
    const resources = store.repository.listResources()
    expect(resources.filter((resource) => resource.selectionMode === 'automatic')).toHaveLength(5)
    expect(resources).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'resource-reference-authentic-structure', selectionMode: 'recommended' })]))
    expect(store.repository.getProject('ssd', false).resourceReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'base_style', enabled: true, resource: expect.objectContaining({ contentTypeId: 'type-digital', selectionMode: 'automatic' }) })
    ]))

    const timestamp = new Date().toISOString()
    store.repository.native.prepare(`INSERT INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('resource-other-creator-sample', 'style_profile', '其他博主参考样本', '只在本次任务手动选择。', 'type-digital', 'other_creator', 'manual_only', 1, '{"excerpt":"外部参考摘要"}', 1, timestamp, timestamp)
    expect(() => store.repository.native.prepare(`INSERT INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('invalid-other-creator', 'style_profile', '错误资源', '', null, 'other_creator', 'recommended', 1, '{}', 1, timestamp, timestamp)).toThrow()

    const preparation = store.repository.prepareTaskResources('ssd')
    expect(preparation.requiredInputs.find((input) => input.key === 'project_description')).toMatchObject({ status: 'included', required: true })
    expect(preparation.requiredInputs.find((input) => input.key === 'real_experience')).toMatchObject({ status: 'missing', required: false })
    expect(preparation.requiredInputs.find((input) => input.key === 'project_materials')).toMatchObject({ status: 'missing', required: false })
    expect(preparation.automaticResources).toEqual([expect.objectContaining({ contentTypeId: 'type-digital', selectionMode: 'automatic' })])
    expect(preparation.recommendedResources).toEqual([expect.objectContaining({ id: 'resource-reference-authentic-structure' })])
    expect(preparation.manualResources).toEqual([expect.objectContaining({ id: 'resource-other-creator-sample', origin: 'other_creator' })])

    const snapshot = store.repository.buildTaskResourceSnapshot('ssd', {
      excludedRecommendedResourceIds: ['resource-reference-authentic-structure'], manualResourceIds: ['resource-other-creator-sample']
    })
    expect(snapshot.recommendedResources).toHaveLength(0)
    expect(snapshot.manualResources).toEqual([expect.objectContaining({ id: 'resource-other-creator-sample' })])
    const taskInput = store.repository.composeDraftTaskInput('ssd', '根据已确认体验生成候选', snapshot)
    expect(taskInput).toContain('【强制引用输入】')
    expect(taskInput).toContain('主要参考与补充资料：missing')
    expect(taskInput).toContain('其他博主参考样本')

    const task = store.repository.createTaskRun({
      taskType: 'draft_generation', projectId: 'ssd', title: '资源快照文案', provider: 'mock', inputSnapshot: taskInput,
      resourceSnapshot: snapshot, permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'new_version', shell: false }, outputTarget: 'candidate:script'
    })
    store.repository.native.prepare(`UPDATE resources SET description='资源已修改',version=2 WHERE id='resource-other-creator-sample'`).run()
    expect(task.resourceSnapshot?.manualResources[0]).toMatchObject({ description: '只在本次任务手动选择。', version: 1 })
    expect(store.repository.cancelTaskRun(task.id).status).toBe('canceled')
    const retried = store.repository.retryTaskRun(task.id)
    expect(retried.resourceSnapshot).toEqual(task.resourceSnapshot)
    expect(retried.inputSnapshot).toBe(task.inputSnapshot)
    const version = store.repository.createVersion('ssd', 'script', 'codex_candidate', '<p>候选</p>', 'provider', null, undefined, { sourceTaskId: retried.id, resourceSnapshot: retried.resourceSnapshot })
    expect(version).toMatchObject({ sourceTaskId: retried.id, resourceSnapshot: retried.resourceSnapshot })

    const commercial = store.repository.prepareTaskResources('sponsor')
    expect(commercial.requiredInputs.find((input) => input.key === 'commercial_brief')).toMatchObject({ status: 'missing', required: true })
    expect(commercial.requiredInputs.find((input) => input.key === 'client_requirements')).toMatchObject({ status: 'empty', required: true })
    const retyped = store.repository.updateProjectContentType('ssd', 'type-ai')
    expect(retyped.resourceReferences.filter((reference) => reference.role === 'base_style' && reference.enabled).map((reference) => reference.resource.contentTypeId)).toEqual(expect.arrayContaining(['type-digital', 'type-ai']))
    expect(store.repository.prepareTaskResources('ssd').automaticResources).toEqual([expect.objectContaining({ contentTypeId: 'type-ai' })])
    const aiBaseStyle = retyped.resourceReferences.find((reference) => reference.resource.contentTypeId === 'type-ai')!
    expect(() => store.repository.setProjectResourceReference({ projectId: 'ssd', resourceId: aiBaseStyle.resourceId, enabled: false })).toThrow('不能从项目任务中移除')
    store.close()
  })

  it('provides a deterministic local date only in tests', async () => {
    const { store } = await createStore()
    expect(store.repository.getSnapshot().today).toBe(process.env.CREATOR_OS_TEST_DATE ?? '2026-07-18')
    store.close()
  })

  it('debounces a managed external Markdown change into a new version without exposing source paths to the renderer model', async () => {
    const { store, directory } = await createStore()
    const externalDirectory = await mkdtemp(join(unitRoot, 'external-watch-')); roots.push(externalDirectory)
    const sourcePath = join(externalDirectory, 'watch.md')
    await writeFile(sourcePath, '# 第一版\n\n初始内容。')
    const retained = await retainImportFromPath(directory, 'ai-browser', sourcePath)
    const info = await stat(sourcePath)
    const version = store.repository.importScriptWithExternalRelation('ai-browser', await parseRetainedImport(retained), retained.file, { path: sourcePath, displayName: 'watch.md', mtimeMs: info.mtimeMs, sizeBytes: info.size })
    expect(store.repository.listExternalFileRelations()).toEqual([expect.objectContaining({ displayName: 'watch.md', lastVersionId: version.id, status: 'active' })])
    expect(JSON.stringify(store.repository.listExternalFileRelations())).not.toContain(sourcePath)
    let changed = 0
    const watcher = new ExternalDraftWatcher(store, () => { changed += 1 })
    await watcher.start()
    await writeFile(sourcePath, '# 第二版\n\n外部变化已生成新版本。')
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const content = store.repository.getProject('ai-browser', false).versions.find((item) => item.kind === 'external_draft')?.content ?? ''
      if (content.includes('外部变化已生成新版本')) break
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    await watcher.close()
    expect(changed).toBeGreaterThan(0)
    const latest = store.repository.getProject('ai-browser', false).versions.find((item) => item.kind === 'external_draft')
    expect(latest?.content).toContain('外部变化已生成新版本')
    expect(await readFile(sourcePath, 'utf8')).toContain('第二版')
    store.close()
  }, 12_000)

  it('keeps a linked plain text draft synchronized after the source changes', async () => {
    const { store, directory } = await createStore()
    const externalDirectory = await mkdtemp(join(unitRoot, 'external-text-watch-')); roots.push(externalDirectory)
    const sourcePath = join(externalDirectory, 'watch.txt')
    await writeFile(sourcePath, '纯文本第一版')
    const retained = await retainImportFromPath(directory, 'ai-browser', sourcePath)
    const info = await stat(sourcePath)
    store.repository.importScriptWithExternalRelation('ai-browser', await parseRetainedImport(retained), retained.file, {
      path: sourcePath, displayName: 'watch.txt', mtimeMs: info.mtimeMs, sizeBytes: info.size
    })
    const watcher = new ExternalDraftWatcher(store, () => undefined)
    await watcher.start()
    await writeFile(sourcePath, '纯文本第二版\n持续同步正常')
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const content = store.repository.getProject('ai-browser', false).versions.find((item) => item.kind === 'external_draft')?.content ?? ''
      if (content.includes('持续同步正常')) break
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    await watcher.close()
    expect(store.repository.listExternalFileRelations()).toEqual([expect.objectContaining({ displayName: 'watch.txt', status: 'active' })])
    expect(store.repository.getProject('ai-browser', false).versions.find((item) => item.kind === 'external_draft')?.content).toContain('持续同步正常')
    store.close()
  }, 12_000)

  it('refuses a symbolic-link source and does not re-seed schedules after a user clears them', async () => {
    const { store, directory } = await createStore()
    const externalDirectory = await mkdtemp(join(unitRoot, 'external-symlink-')); roots.push(externalDirectory)
    const target = join(externalDirectory, 'target.md'); const link = join(externalDirectory, 'link.md')
    await writeFile(target, '# 不应跟随的目标')
    await symlink(target, link)
    await expect(retainImportFromPath(directory, 'ai-browser', link)).rejects.toThrow()
    store.repository.native.exec('DELETE FROM schedule_items; DELETE FROM task_runs')
    store.close()
    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.listScheduleItems()).toHaveLength(0)
    expect(reopened.repository.listTaskRuns()).toHaveLength(0)
    reopened.close()
  })
})
