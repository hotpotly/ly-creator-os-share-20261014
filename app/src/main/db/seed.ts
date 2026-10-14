import { normalizeContentClassification } from './content-classification-migration'
import type BetterSqlite3 from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const now = '2026-07-18T08:00:00.000Z'

const typeSeeds = [
  ['type-digital', '数码', '数码产品、配件、硬件和真实使用体验；不包含单纯的手机系统功能。', 10, 'template-digital-review'],
  ['type-commercial', '商单', '包含品牌Brief和商务合作要求的商单内容。', 20, 'template-commercial'],
  ['type-system', '手机系统', 'iOS、Android、手机系统功能、系统更新和长期体验。', 30, 'template-system-experience'],
  ['type-ai', 'AI', 'AI工具、模型、自动化、生成式创作和AI实战过程。', 40, 'template-ai-tutorial'],
  ['type-quick', '短视频', '短视频内容，以及暂时无法归入其他方向的轻量内容。', 50, 'template-quick-content']
] as const

const baseStyleSeeds: Record<string, { name: string; description: string; instruction: string }> = {
  'type-digital': { name: '数码基础风格', description: '以真实体验、实测与明确适用人群为主，不照搬规格表。', instruction: '优先使用项目资料和真实体验，把参数转换为可感知的差异。' },
  'type-commercial': { name: '商单基础风格', description: '以Brief、项目资料和已确认要求为边界，保留真实体验表达，不使用官方人称。', instruction: '完整覆盖Brief与已确认要求，不虚构体验，不使用品牌官方人称。' },
  'type-system': { name: '手机系统基础风格', description: '以一段时间后的真实使用感知组织内容，不按功能清单逐条复述。', instruction: '按日常感知强弱组织内容，区分短期新鲜感与长期价值。' },
  'type-ai': { name: 'AI基础风格', description: '用真实任务和可复查步骤讲清楚AI工具，不夸大无法验证的能力。', instruction: '优先演示真实任务，说明输入、步骤、结果和可复查点。' },
  'type-quick': { name: '短视频基础风格', description: '快速表达一个清晰观点，优先使用已确认资料与真实体验。', instruction: '围绕一个清晰观点快速成稿，不为了完整而填充未确认信息。' }
}

const projectSeeds = [
  ['ios', 'iOS 27第一周体验', '这期视频记录iOS 27第一周的真实使用体验，重点讲日常感知明显的变化，而不是照着功能清单逐条念。', 'type-system', 'producing', 'project-1', ['B站', '小红书'], 1, '2026-07-18T07:50:00.000Z'],
  ['ssd', '随身SSD横评', '比较三款随身SSD的持续写入、发热和跨设备体验，结论以自己的实测数据为主。', 'type-digital', 'producing', 'project-5', ['B站'], 0, '2026-07-18T07:20:00.000Z'],
  ['ai-browser', 'AI浏览器入门教学', '用一个真实任务演示AI浏览器的完整使用过程，确保没有接触过的人也能跟着做完。', 'type-ai', 'preparing', 'project-2', ['B站', '小红书'], 1, '2026-07-18T07:40:00.000Z'],
  ['desktop', '桌面改造计划', '记录桌面从杂乱到顺手的改造过程，强调真实使用逻辑和预算取舍。', 'type-digital', 'producing', 'project-3', ['小红书'], 0, '2026-07-17T13:10:00.000Z'],
  ['sponsor', '无线麦克风商单', '在真实户外收音体验中说明新品的连接稳定性和降噪表现，并完整覆盖Brief必说点。', 'type-commercial', 'producing', 'project-4', ['B站', '小红书'], 0, '2026-07-18T06:30:00.000Z'],
  ['archived-demo', '旧款充电器对比', '已完成并归档的历史项目。', 'type-digital', 'archived', 'project-6', ['B站'], 0, '2026-06-02T08:00:00.000Z']
] as const

const modulesByType: Record<string, string[]> = {
  'type-digital': ['overview', 'materials', 'outline', 'script', 'production', 'postproduction', 'publishing', 'versions'],
  'type-commercial': ['overview', 'materials', 'outline', 'script', 'production', 'postproduction', 'publishing', 'business', 'versions'],
  'type-system': ['overview', 'materials', 'outline', 'script', 'production', 'postproduction', 'publishing', 'versions'],
  'type-ai': ['overview', 'materials', 'outline', 'script', 'production', 'postproduction', 'publishing', 'versions'],
  'type-quick': ['overview', 'script', 'publishing', 'versions']
}

const scriptSeeds: Record<string, { claude: string; codex: string; merged: string }> = {
  'ai-browser': {
    claude: '<p>虚构演示文案：这是一段用于验证编辑、比较与定稿的claude版本测试文字，不包含真实项目内容。</p><p>虚构测试任务：找到资料、核对来源，结果能追溯。</p>',
    codex: '<p>虚构演示文案：这是一段用于验证编辑、比较与定稿的codex版本测试文字，不包含真实项目内容。</p><p>虚构测试任务：找到资料、核对来源，结果能追溯。</p>',
    merged: '<p>虚构演示文案：这是一段用于验证编辑、比较与定稿的merged版本测试文字，不包含真实项目内容。</p><p>虚构测试任务：找到资料、核对来源，结果能追溯。</p>'
  }
}

const scheduleSeeds = [
  ['e1', 'desktop', '资料整理', 'materials', '2026-07-01T09:00:00.000+08:00', 'plan', 'done'],
  ['e2', 'ssd', '测试计划', 'materials', '2026-07-03T09:00:00.000+08:00', 'plan', 'normal'],
  ['e3', 'ai-browser', '整理大纲', 'outline', '2026-07-06T09:00:00.000+08:00', 'plan', 'normal'],
  ['e4', 'sponsor', '等甲方确认大纲', 'outline', '2026-07-08T09:00:00.000+08:00', 'plan', 'waiting'],
  ['e5', 'desktop', '补拍', 'production', '2026-07-10T09:00:00.000+08:00', 'plan', 'normal'],
  ['e6', 'ios', '体验记录', 'materials', '2026-07-12T09:00:00.000+08:00', 'plan', 'done'],
  ['e7', 'ssd', '持续写入', 'materials', '2026-07-13T09:00:00.000+08:00', 'plan', 'normal'],
  ['e8', 'ai-browser', '双模型文案', 'script', '2026-07-15T09:00:00.000+08:00', 'plan', 'normal'],
  ['e9', 'sponsor', '客户初审文案', 'script', '2026-07-16T09:00:00.000+08:00', 'plan', 'waiting'],
  ['e10', 'desktop', '封面候选', 'postproduction', '2026-07-17T09:00:00.000+08:00', 'plan', 'normal'],
  ['e11', 'ios', '大纲截止', 'outline', '2026-07-18T18:00:00.000+08:00', 'hard_deadline', 'normal'],
  ['e12', 'ssd', '补实测', 'materials', '2026-07-18T10:00:00.000+08:00', 'plan', 'normal'],
  ['e13', 'ai-browser', '对比文案', 'script', '2026-07-18T14:00:00.000+08:00', 'plan', 'normal'],
  ['e14', 'ssd', '拍摄', 'production', '2026-07-19T09:00:00.000+08:00', 'plan', 'normal'],
  ['e15', 'ios', '计划发布', 'publishing', '2026-07-20T10:00:00.000+08:00', 'publish_date', 'normal'],
  ['e16', 'ai-browser', '计划发布', 'publishing', '2026-07-20T18:00:00.000+08:00', 'publish_date', 'normal'],
  ['e17', 'desktop', '剪辑', 'production', '2026-07-21T09:00:00.000+08:00', 'plan', 'normal'],
  ['e18', 'sponsor', '文案终审截止', 'script', '2026-07-23T18:00:00.000+08:00', 'hard_deadline', 'normal'],
  ['e19', 'desktop', '发布包', 'publishing', '2026-07-25T09:00:00.000+08:00', 'plan', 'normal'],
  ['e20', 'ssd', '整理终稿', 'script', '2026-07-27T09:00:00.000+08:00', 'plan', 'normal'],
  ['e21', 'ai-browser', '场景草稿', 'production', '2026-07-29T09:00:00.000+08:00', 'plan', 'normal'],
  ['e22', 'desktop', '补一组桌面细节镜头', 'production', null, 'plan', 'normal']
] as const

function seedStageThree(database: BetterSqlite3.Database): void {
  const scheduleCount = (database.prepare('SELECT COUNT(*) AS count FROM schedule_items').get() as { count: number }).count
  if (scheduleCount === 0) {
    const insert = database.prepare(`INSERT INTO schedule_items(id,project_id,title,action_type,start_at,end_at,schedule_kind,state,waiting_for,source,is_movable,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const [id, projectId, title, actionType, startAt, kind, state] of scheduleSeeds) {
      insert.run(id, projectId, title, actionType, startAt, null, kind, state, state === 'waiting' ? '甲方' : null, 'project_node', 1, now, now)
    }
  }
  const taskCount = (database.prepare('SELECT COUNT(*) AS count FROM task_runs').get() as { count: number }).count
  if (taskCount === 0) {
    const insert = database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,model,status,progress,input_snapshot,project_description_snapshot,permission_profile_json,output_target,result_summary,error_code,error_message,retry_of_id,requires_confirmation,requested_at,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const draftPermission = JSON.stringify({ network: 'off', readableRefs: [], writableTarget: 'new_version', shell: false })
    const emptyPermission = JSON.stringify({ network: 'off', readableRefs: [], writableTarget: 'none', shell: false })
    insert.run('task-mock-draft', 'mock_demo', 'ai-browser', 'Mock生成文案', 'mock', 'mock-v1', 'queued', 0, '用真实任务演示AI浏览器', '用一个真实任务演示AI浏览器的完整使用过程。', draftPermission, 'candidate:script', null, null, null, null, 0, '2026-07-18T07:52:00.000Z', null, null)
    insert.run('task-transcript-confirm', 'external_import', null, '字幕转写', 'none', null, 'waiting_confirmation', 72, '需确认人名“Remotion”', null, emptyPermission, null, null, null, null, null, 1, '2026-07-18T07:45:00.000Z', '2026-07-18T07:46:00.000Z', null)
    insert.run('task-cover-done', 'image_generation', 'desktop', '封面候选生成', 'mock', 'mock-image-v1', 'succeeded', 100, '生成4组候选', '记录桌面改造的真实使用逻辑。', emptyPermission, 'candidate:cover', '已生成4组候选', null, null, null, 0, '2026-07-18T07:10:00.000Z', '2026-07-18T07:10:10.000Z', '2026-07-18T07:10:35.000Z')
    insert.run('task-failed-demo', 'mock_demo', 'ssd', '实测表格整理', 'mock', 'mock-v1', 'failed', 36, '整理SSD实测结果', '比较三款随身SSD的持续写入、发热和跨设备体验。', draftPermission, 'candidate:script', null, 'MOCK_INTERRUPTED', '测试任务曾中断，可以重试', null, 0, '2026-07-18T07:20:00.000Z', '2026-07-18T07:20:03.000Z', '2026-07-18T07:20:08.000Z')
  }
}

function insertVersion(database: BetterSqlite3.Database, projectId: string, documentType: string, kind: string, content: string, createdBy = 'user'): string {
  const id = randomUUID()
  const { revision } = database.prepare('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM draft_versions WHERE project_id=? AND document_type=?').get(projectId, documentType) as { revision: number }
  database.prepare(`INSERT INTO draft_versions(id,project_id,document_type,kind,parent_version_ids_json,content,source_file_path,source_file_id,revision,is_final,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, projectId, documentType, kind, '[]', content, null, null, revision, 0, createdBy, now)
  return id
}

export function seedWorkspace(database: BetterSqlite3.Database, allowInitialization: boolean, includeDemoContent = true): void {
  const existing = database.prepare('SELECT COUNT(*) AS count FROM content_types').get() as { count: number }
  if (existing.count > 0 || !allowInitialization) return
  const stageTimeDefinition = database.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='stage_time_records'`).get() as { sql?: string | null } | undefined
  const supportsSplitProduction = Boolean(stageTimeDefinition?.sql?.includes(`'shooting'`))
  const supportsPostproduction = Boolean(stageTimeDefinition?.sql?.includes(`'postproduction'`))

  database.transaction(() => {
    const insertType = database.prepare('INSERT INTO content_types(id,name,description,sort_order,is_active,default_project_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    for (const [id, name, description, sortOrder, defaultTemplateId] of typeSeeds) insertType.run(id, name, description, sortOrder, 1, defaultTemplateId, now, now)

    const insertResource = database.prepare(`INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const [contentTypeId, resource] of Object.entries(baseStyleSeeds)) {
      insertResource.run(`resource-base-style-${contentTypeId}`, 'style_profile', resource.name, resource.description, contentTypeId, 'system', 'automatic', 1, JSON.stringify({ instruction: resource.instruction }), 1, now, now)
    }

    if (includeDemoContent) {
      const insertProject = database.prepare(`INSERT INTO projects(id,title,description,content_type_id,applied_template_id,status,project_color_token,platform_targets_json,is_pinned,last_opened_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      const insertModule = database.prepare(`INSERT INTO project_modules(project_id,module_key,enabled,position,disabled_at,last_changed_by,content_root_id) VALUES(?,?,?,?,?,?,?)`)
      const insertStageTime = database.prepare(`INSERT INTO stage_time_records(id,project_id,stage_key,status,started_date,started_segment,completed_date,completed_segment,start_source,completion_source,actual_effort_half_day_units,auto_start_action_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const [id, title, description, typeId, status, color, platforms, pinned, lastOpenedAt] of projectSeeds) {
        const templateId = typeSeeds.find(([seedTypeId]) => seedTypeId === typeId)?.[4] ?? null
        insertProject.run(id, title, description, typeId, templateId, status, color, JSON.stringify(platforms), pinned, lastOpenedAt, now, now)
        const projectModules = (modulesByType[typeId] ?? modulesByType['type-quick'] ?? [])
          .filter((moduleKey) => moduleKey !== 'postproduction' || supportsPostproduction)
          .flatMap(moduleKey => moduleKey === 'production' && supportsSplitProduction ? ['shooting', 'editing', 'production'] : [moduleKey])
        projectModules.forEach((moduleKey, position) => {
          insertModule.run(id, moduleKey, moduleKey === 'production' && supportsSplitProduction ? 0 : 1, position, moduleKey === 'production' && supportsSplitProduction ? now : null, 'system', randomUUID())
          if (moduleKey !== 'overview' && moduleKey !== 'business') insertStageTime.run(randomUUID(), id, moduleKey, 'not_started', null, null, null, null, null, null, null, null, now, now)
        })
        database.prepare(`INSERT INTO project_resource_references(project_id,resource_id,role,enabled,selection_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
          .run(id, `resource-base-style-${typeId}`, 'base_style', 1, 'automatic', now, now)
        insertVersion(database, id, 'project_description', 'user_edit', description)
        if (id !== 'archived-demo') insertVersion(database, id, 'outline', 'user_edit', JSON.stringify([
          { id: randomUUID(), text: '开头：先说清楚这期为什么值得看' },
          { id: randomUUID(), text: '主体：按真实体验组织重点' },
          { id: randomUUID(), text: '结尾：给出适合谁的明确结论' }
        ]))
      }

      const scripts = scriptSeeds['ai-browser']
      if (scripts) {
        insertVersion(database, 'ai-browser', 'script', 'claude_candidate', scripts.claude, 'provider')
        insertVersion(database, 'ai-browser', 'script', 'codex_candidate', scripts.codex, 'provider')
        insertVersion(database, 'ai-browser', 'script', 'merged_draft', scripts.merged)
      }

      const insertCapture = database.prepare(`INSERT INTO captures(id,capture_kind,primary_project_id,referenced_project_ids_json,classification_status,classification_confidence,suggested_content_type_id,original_content,source_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      insertCapture.run('capture-1', 'unknown', null, '[]', 'unprocessed', null, null, '试试把手机系统里的通知变化单独讲一期', 'quick_capture', '2026-07-18T06:00:00.000Z')
      insertCapture.run('capture-2', 'project_content', 'ssd', '[]', 'confirmed', 0.96, 'type-digital', 'SSD连续写入到70%以后速度开始波动，需要补一轮温度记录', 'quick_capture', '2026-07-18T06:20:00.000Z')
      insertCapture.run('capture-3', 'project_content', null, '[]', 'suggested', 0.64, 'type-ai', 'AI浏览器的来源核对可以做成三步演示', 'web_bookmark', '2026-07-18T06:40:00.000Z')

      const insertTopic = database.prepare(`INSERT INTO topics(id,title,core_angle,content_type_id,priority,needs_more_experience,stage_id,status,source_capture_ids_json,created_project_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      insertTopic.run('topic-1', '系统通知管理到底有没有变好', '只谈一周后真正影响日常的变化', 'type-system', 3, 1, 'topic-stage-evaluation', 'evaluation_pending', '["capture-1"]', null, now, now)
      const hasArchivedTopicStage = Boolean(database.prepare(`SELECT 1 FROM topic_stage_definitions WHERE id='topic-stage-archived'`).get())
      for (const [projectId, title, description, typeId, status] of projectSeeds) {
        const archived = status === 'archived' && hasArchivedTopicStage
        insertTopic.run(`topic-project-${projectId}`, title, description, typeId, 0, 0, archived ? 'topic-stage-archived' : 'topic-stage-created', archived ? 'archived' : 'created', '[]', projectId, now, now)
      }
    }

    const insertPreference = database.prepare(`INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?)`)
    insertPreference.run('workspace', JSON.stringify({
      theme: 'light', visualStyle: 'warm', homeSplit: 63, workbenchLayout: 'equal', workbenchModelSplit: 50, workbenchMergedSplit: 67,
      workbenchMergedVisible: true, workbenchView: 'dual', workbenchSingleProvider: 'codex',
      workbenchDualActiveProvider: 'claude', workbenchComparisonSide: 'claude',
      workbenchComparisonSplit: 50, workbenchComparisonPreviewSplit: 29, workbenchComparisonScrollTop: 0,
      workbenchMaterialTab: 'ai'
    }), now)
  })()
  if (includeDemoContent) seedStageThree(database)
  normalizeContentClassification(database)
}
