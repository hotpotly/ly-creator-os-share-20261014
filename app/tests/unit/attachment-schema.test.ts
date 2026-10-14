import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_MIGRATION_ID, runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { WorkspaceRepository } from '../../src/main/db/repository'
import { seedWorkspace } from '../../src/main/db/seed'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'

const databases: BetterSqlite3.Database[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('unified attachment schema', () => {
  it('adds optional daily totals without changing historic category minutes', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    runMigrationsThrough(database, '0088_r24_manual_invoice_received')
    database.prepare("INSERT INTO daily_work_logs(day,self_media_minutes,ai_minutes,other_work_minutes,updated_at) VALUES('2026-09-11',120,60,30,'before')").run()
    runMigrations(database); runMigrations(database)
    expect(database.prepare('SELECT * FROM daily_work_logs').get()).toEqual({ day: '2026-09-11', self_media_minutes: 120, ai_minutes: 60, other_work_minutes: 30, updated_at: 'before', total_minutes: null })
    expect(() => database.prepare('UPDATE daily_work_logs SET total_minutes=1441').run()).toThrow()
  })

  it('initializes a clean production workspace without personal demo content', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrations(database)

    seedWorkspace(database, true, false)

    expect(database.prepare('SELECT COUNT(*) AS count FROM content_types WHERE is_active=1').get()).toEqual({ count: 5 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM resources').get()).toEqual({ count: 6 })
    for (const table of ['projects', 'captures', 'topics', 'schedule_items', 'task_runs']) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 })
    }
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('adds the launch-event category to an existing income ledger without duplicating categories', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0068_r30_income_ledger')

    expect(database.prepare('SELECT name FROM other_income_categories ORDER BY sort_order,name').all()).toEqual([
      { name: '顾问服务' },
      { name: '课程讲座' },
      { name: '内容授权' },
      { name: '平台分成' },
      { name: '其他' }
    ])

    runMigrations(database)
    runMigrations(database)

    expect(database.prepare('SELECT name,sort_order AS sortOrder FROM other_income_categories ORDER BY sort_order,name').all()).toEqual([
      { name: '顾问服务', sortOrder: 10 },
      { name: '课程讲座', sortOrder: 20 },
      { name: '内容授权', sortOrder: 30 },
      { name: '平台分成', sortOrder: 40 },
      { name: '发布会', sortOrder: 50 },
      { name: '其他', sortOrder: 60 }
    ])
  })

  it('adds a nullable manual invoice receipt marker without rewriting existing business records', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0087_r31_other_income_launch_event_category')
    seedWorkspace(database, true)
    database.prepare(`INSERT INTO business_records(project_id,created_at,updated_at) VALUES('sponsor','2026-08-13T00:00:00.000Z','2026-08-13T00:00:00.000Z')`).run()

    expect((database.pragma(`table_info('business_records')`) as Array<{ name: string }>).map((column) => column.name))
      .not.toContain('invoice_received_manually_at')

    runMigrations(database)

    expect(LATEST_MIGRATION_ID).toBe('0104_m3_workspace_access')
    expect((database.pragma(`table_info('business_records')`) as Array<{ name: string }>).map((column) => column.name))
      .toContain('invoice_received_manually_at')
    expect(database.prepare(`SELECT invoice_received_manually_at AS receivedAt FROM business_records WHERE project_id='sponsor'`).get())
      .toEqual({ receivedAt: null })
  })

  it('preserves R16c target events and role memories through the R16d table rebuilds', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0082_r16c_structured_reference_domain')
    seedWorkspace(database, true)
    const timestamp = '2026-08-04T00:00:00.000Z'
    database.prepare(`INSERT INTO content_instruction_requests(id,project_id,surface,supersedes_request_id,generation_id,request_json,common_fingerprint,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('request-r16c', 'ios', 'script_conversation', null, null, '{}', 'a'.repeat(64), timestamp)
    database.prepare(`INSERT INTO content_instruction_request_targets(id,request_id,provider,provider_config_id,target_json,provider_security_fingerprint,provider_policy_version,runtime_version,requested_model,requested_reasoning_effort,history_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('target-r16c', 'request-r16c', 'codex_cli', 'codex-r16c', '{}', 'fingerprint', 'policy', 'runtime', 'auto', 'xhigh', 'b'.repeat(64), timestamp)
    database.prepare(`INSERT INTO content_instruction_request_target_events(id,target_id,sequence,event_kind,actual_model,actual_reasoning_effort,provider_thread_id,task_id,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('event-link-r16c', 'target-r16c', 1, 'task_linked', null, null, null, 'task-r16c', 'queued', timestamp)
    database.prepare(`INSERT INTO content_instruction_request_target_events(id,target_id,sequence,event_kind,actual_model,actual_reasoning_effort,provider_thread_id,task_id,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('event-start-r16c', 'target-r16c', 2, 'started', 'gpt-5.6', 'xhigh', 'thread-r16c', 'task-r16c', 'running', timestamp)
    database.prepare(`INSERT INTO project_reference_role_preferences(project_id,source_key,source_kind,source_id,role,aspect,scope,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('ios', 'ref_v1_1234567890abcdef1234567890abcdef', 'project_material', 'material-r16c', 'style_reference', '语气', 'whole_source', timestamp, timestamp)

    runMigrations(database)

    expect(database.prepare(`SELECT id,sequence,event_kind AS eventKind,task_id AS taskId,status FROM content_instruction_request_target_events ORDER BY sequence`).all()).toEqual([
      { id: 'event-link-r16c', sequence: 1, eventKind: 'task_linked', taskId: 'task-r16c', status: 'queued' },
      { id: 'event-start-r16c', sequence: 2, eventKind: 'started', taskId: 'task-r16c', status: 'running' }
    ])
    const eventIndexes = (database.pragma(`index_list('content_instruction_request_target_events')`) as Array<{ name: string }>).map((index) => index.name)
    expect(eventIndexes).toEqual(expect.arrayContaining([
      'content_instruction_request_target_events_target_idx',
      'content_instruction_request_target_events_sequence_unique',
      'content_instruction_request_target_events_task_link_unique'
    ]))
    expect(database.prepare(`SELECT role,aspect,scope FROM project_reference_role_preferences WHERE project_id='ios'`).get())
      .toEqual({ role: 'style_reference', aspect: '语气', scope: 'whole_source' })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('adds the project current-script foundation without silently choosing legacy content', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0075_script_version_workspace_content')
    seedWorkspace(database, true)
    const before = database.prepare(`SELECT id,content,workspace_content AS workspaceContent FROM draft_versions ORDER BY id`).all()

    runMigrations(database)

    expect(LATEST_MIGRATION_ID).toBe('0104_m3_workspace_access')
    const candidateColumns = (database.pragma(`table_info('draft_candidate_revisions')`) as Array<{ name: string }>).map((column) => column.name)
    expect(candidateColumns).toEqual(expect.arrayContaining(['reasoning_effort', 'target_decision_fingerprint', 'target_kind', 'target_content', 'source_selections_json', 'conflicts_json']))
    const materialCandidateColumns = (database.pragma(`table_info('script_material_rewrite_candidates')`) as Array<{ name: string }>).map((column) => column.name)
    expect(materialCandidateColumns).toEqual(expect.arrayContaining(['source_selections_json', 'conflicts_json', 'parent_candidate_id', 'application_target_json']))
    const revisionMessageColumns = (database.pragma(`table_info('script_revision_messages')`) as Array<{ name: string }>).map((column) => column.name)
    expect(revisionMessageColumns).toEqual(expect.arrayContaining(['source_selections_json', 'conflicts_json']))
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('project_current_script_documents','current_script_source_relations','script_text_annotations','script_working_document_revisions') ORDER BY name`).all())
      .toEqual([
        { name: 'current_script_source_relations' },
        { name: 'project_current_script_documents' },
        { name: 'script_text_annotations' },
        { name: 'script_working_document_revisions' }
      ])
    expect(database.prepare(`SELECT COUNT(*) AS count FROM project_current_script_documents`).get()).toEqual({ count: 0 })
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='project_reference_recent_uses'`).get())
      .toEqual({ name: 'project_reference_recent_uses' })
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('content_provider_input_snapshots','content_fact_evidence') ORDER BY name`).all())
      .toEqual([{ name: 'content_fact_evidence' }, { name: 'content_provider_input_snapshots' }])
    expect((database.pragma(`table_info('script_text_annotations')`) as Array<{ name: string }>).map((column) => column.name))
      .toContain('evidence_ids_json')
    expect((database.pragma(`table_info('content_fact_evidence')`) as Array<{ name: string }>).map((column) => column.name))
      .toContain('price_kind')
    expect(database.prepare(`SELECT id,content,workspace_content AS workspaceContent FROM draft_versions ORDER BY id`).all()).toEqual(before)
    const revisionColumns = (database.pragma(`table_info('script_working_document_revisions')`) as Array<{ name: string }>).map((column) => column.name)
    expect(revisionColumns).toEqual(expect.arrayContaining([
      'head_revision_snapshot_id', 'snapshot_saved_version_id', 'recovery_conflict_id', 'mutation_fingerprint', 'saved_version_id',
      'document_updated_at', 'source_relation_snapshots_json', 'annotation_snapshots_json',
      'resolution_kind', 'resolved_revision_snapshot_id', 'resolved_at'
    ]))
    const revisionIndexes = (database.pragma(`index_list('script_working_document_revisions')`) as Array<{ name: string }>).map((index) => index.name)
    expect(revisionIndexes).toEqual(expect.arrayContaining([
      'script_working_document_revisions_mutation_unique',
      'script_working_document_revisions_saved_version_unique',
      'script_working_document_revisions_head_snapshot_idx',
      'script_working_document_revisions_recovery_conflict_idx',
      'script_working_document_revisions_resolution_snapshot_idx'
    ]))
    const revisionSql = database.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='script_working_document_revisions'`).pluck().get() as string
    expect(revisionSql).toContain("resolution_kind IN ('kept_server','replaced_with_attempt','saved_attempt_as_version')")
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades R42 checks to per-draft identities and invalidates the legacy audit contract', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0073_script_material_rewrite_candidates')
    seedWorkspace(database, true)
    const timestamp = '2026-07-30T08:00:00.000Z'
    database.prepare(`INSERT INTO script_material_workspaces(project_id,working_content,working_base_revision_id,requirement,ai_count,selected_ai_side,web_search_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('ios', '原稿', 'revision-r42e', '', 1, 'codex', 'automatic', timestamp, timestamp)
    database.prepare(`INSERT INTO script_material_revisions(id,project_id,revision,content,content_hash,points_confirmed,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run('revision-r42e', 'ios', 1, '原稿', 'source-hash', 1, timestamp, timestamp)
    const oldAuditTask = { id: 'legacy-audit-task' }
    database.prepare(`INSERT INTO task_runs(
      id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,
      output_target,requires_confirmation,requested_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      oldAuditTask.id, 'script_material_audit', 'ios', '旧检查', 'codex_cli', 'queued', 0,
      JSON.stringify({ version: 1 }),
      JSON.stringify({ network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }),
      'script-material-check:ios:revision-r42e:current', 0, timestamp
    )
    database.prepare(`INSERT INTO script_material_checks(id,project_id,revision_id,target,target_content_hash,state,point_coverage_json,paragraph_findings_json,allowed_omission_point_ids_json,task_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('legacy-check', 'ios', 'revision-r42e', 'current', 'content-hash', 'ready', '[]', '[]', '[]', oldAuditTask.id, timestamp, timestamp)
    const nextScriptRevision = ((database.prepare(`SELECT COALESCE(MAX(revision),0) AS revision FROM draft_versions WHERE project_id='ios' AND document_type='script'`).get() as { revision: number }).revision) + 1
    const legacyAnnotatedContent = '<p><span data-script-marker-id="legacy-marker" data-script-marker-note="不要交付"><u>正文</u></span><mark data-color="#fff">参数</mark><s>删改</s></p>'
    database.prepare(`INSERT INTO draft_versions(
      id,project_id,document_type,kind,parent_version_ids_json,content,revision,is_final,created_by,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'legacy-annotated-script', 'ios', 'script', 'user_edit', '[]', legacyAnnotatedContent,
      nextScriptRevision, 0, 'user', timestamp
    )

    runMigrations(database)

    expect(database.prepare(`SELECT target_identity AS targetIdentity,input_fingerprint AS inputFingerprint,state,checked_at AS checkedAt FROM script_material_checks WHERE id='legacy-check'`).get()).toEqual({
      targetIdentity: 'current',
      inputFingerprint: '',
      state: 'stale',
      checkedAt: null
    })
    expect(database.prepare(`SELECT status,error_code AS errorCode FROM task_runs WHERE id=?`).get(oldAuditTask.id)).toEqual({
      status: 'canceled',
      errorCode: 'SCRIPT_MATERIAL_AUDIT_CONTRACT_UPGRADED'
    })
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='script_material_version_snapshots'`).get()).toEqual({
      name: 'script_material_version_snapshots'
    })
    expect((database.pragma('table_info(draft_versions)') as Array<{ name: string }>).some((column) => column.name === 'workspace_content')).toBe(true)
    expect((database.pragma('table_info(script_material_version_snapshots)') as Array<{ name: string }>).some((column) => column.name === 'workspace_content_hash')).toBe(true)
    const migratedVersion = new WorkspaceRepository(database).getProject('ios', false).versions.find((version) => version.id === 'legacy-annotated-script')
    expect(migratedVersion?.workspaceContent).toBe(legacyAnnotatedContent)
    expect(migratedVersion?.content).toBe('<p><u>正文</u><mark data-color="#fff">参数</mark><s>删改</s></p>')
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades existing material drafts into selectable version-one drafts', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0071_script_material_conversation')
    seedWorkspace(database, true)
    const timestamp = '2026-07-29T08:00:00.000Z'
    database.prepare(`INSERT INTO script_material_workspaces(project_id,working_content,requirement,ai_count,selected_ai_side,web_search_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run('ios', '原稿', '', 1, 'codex', 'automatic', timestamp, timestamp)
    database.prepare(`INSERT INTO script_material_revisions(id,project_id,revision,content,content_hash,points_confirmed,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('revision-1', 'ios', 1, '原稿', 'source-hash', 1, timestamp)
    database.prepare(`INSERT INTO script_material_drafts(id,project_id,revision_id,side,source_kind,requirement,input_fingerprint,content,content_hash,paragraphs_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('draft-1', 'ios', 'revision-1', 'codex', 'provider', '', 'input-hash', '成稿', 'draft-hash', '[]', timestamp, timestamp)
    const legacyMapTask = { id: 'legacy-map-task' }
    database.prepare(`INSERT INTO task_runs(
      id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,
      output_target,requires_confirmation,requested_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      legacyMapTask.id, 'script_material_map', 'ios', '旧版首次映射', 'codex_cli', 'queued', 0,
      JSON.stringify({ version: 1 }),
      JSON.stringify({ network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }),
      'script-material-map:ios:revision-1:codex', 0, timestamp
    )

    runMigrations(database)

    expect(database.prepare(`SELECT selected_codex_draft_id AS selectedDraftId FROM script_material_workspaces WHERE project_id='ios'`).get()).toEqual({ selectedDraftId: 'draft-1' })
    expect(database.prepare(`SELECT draft_version AS draftVersion,mapping_state AS mappingState,current_mappings_json AS currentMappingsJson FROM script_material_drafts WHERE id='draft-1'`).get()).toEqual({
      draftVersion: 1,
      mappingState: 'ready',
      currentMappingsJson: '[]'
    })
    expect(database.prepare(`SELECT status,error_code AS errorCode FROM task_runs WHERE id=?`).get(legacyMapTask.id)).toEqual({
      status: 'canceled',
      errorCode: 'MAPPING_CONTRACT_UPGRADED'
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('applies R17 annotations and outline relations after an already-applied 0058 database', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0058_script_revision_candidate_groups')

    runMigrations(database)

    const decisionColumns = new Set((database.pragma('table_info(draft_group_decisions)') as Array<{ name: string }>).map((column) => column.name))
    const groupColumns = new Set((database.pragma('table_info(draft_alignment_groups)') as Array<{ name: string }>).map((column) => column.name))
    expect([...decisionColumns]).toEqual(expect.arrayContaining(['note', 'markers_json']))
    expect([...groupColumns]).toEqual(expect.arrayContaining(['outline_placement', 'outline_item_id']))
    expect(database.prepare(`SELECT id FROM schema_migrations WHERE id IN ('0059_r17_draft_group_annotations','0060_r17_draft_outline_relations','0061_r19_draft_split_history','0062_r20_lightweight_todos') ORDER BY id`).all())
      .toEqual([
        { id: '0059_r17_draft_group_annotations' },
        { id: '0060_r17_draft_outline_relations' },
        { id: '0061_r19_draft_split_history' },
        { id: '0062_r20_lightweight_todos' }
      ])
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('draft_comparison_history','draft_split_match_cache') ORDER BY name`).all())
      .toEqual([{ name: 'draft_comparison_history' }, { name: 'draft_split_match_cache' }])
  })

  it('normalizes legacy publishing handoffs after the C5 migration', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0043_nas_archive_runs')
    seedWorkspace(database, true)
    const timestamp = '2026-07-24T08:00:00.000Z'
    database.prepare(`INSERT INTO publishing_handoffs(id,project_id,platform,adapter_id,target_url,status,package_snapshot_json,checklist_json,issues_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run('legacy-handoff', 'ai-browser', 'B站', 'bilibili-web', 'https://member.bilibili.com/platform/upload/video/frame', 'prepared', JSON.stringify({
        title: '旧发布标题', description: '旧简介', tags: ['旧标签'], coverFileName: '旧封面.png', subtitleFileName: null, sourceVersionId: 'legacy-version'
      }), '[]', '[]', timestamp, timestamp)

    runMigrations(database)

    const project = RESPONSE_SCHEMAS.projectDetailSchema.parse(new WorkspaceRepository(database).getProject('ai-browser', false))
    expect(project.publishingHandoffs.find((handoff) => handoff.id === 'legacy-handoff')?.packageSnapshot).toEqual({
      title: '旧发布标题', description: '旧简介', tags: ['旧标签'],
      coverFileId: '', coverFileName: '旧封面.png', subtitleFileId: null, subtitleFileName: null,
      videoFileId: '', videoFileName: '', accountId: '', accountName: '', sourceVersionId: 'legacy-version'
    })
  })

  it('marks existing mobile devices as legacy until they finish the v2 upgrade', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0035_unified_attachment_foundation')
    database.prepare(`INSERT INTO mobile_sync_devices(id,name,encrypted_secret,created_at) VALUES(?,?,?,?)`)
      .run('legacy-device', 'Android', 'protected-secret', '2026-07-21T08:00:00.000Z')

    runMigrations(database)

    expect(database.prepare(`SELECT protocol_version AS protocolVersion,trust_state AS trustState,identity_public_key AS identityPublicKey,upgraded_at AS upgradedAt FROM mobile_sync_devices WHERE id='legacy-device'`).get()).toEqual({
      protocolVersion: 1, trustState: 'legacy_v1', identityPublicKey: null, upgradedAt: null
    })
  })

  it('upgrades a database created by the Android worktree without replaying its mobile migration', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0047_drop_dead_topic_columns')
    database.exec(`
      ALTER TABLE captures ADD COLUMN mobile_title TEXT;
      ALTER TABLE captures ADD COLUMN mobile_source_app TEXT;
      ALTER TABLE captures ADD COLUMN mobile_source_title TEXT;
      ALTER TABLE captures ADD COLUMN mobile_source_url TEXT;
      ALTER TABLE captures ADD COLUMN mobile_notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE asset_upload_sessions ADD COLUMN mobile_title TEXT;
      ALTER TABLE asset_upload_sessions ADD COLUMN mobile_source_app TEXT;
      ALTER TABLE asset_upload_sessions ADD COLUMN mobile_source_title TEXT;
      ALTER TABLE asset_upload_sessions ADD COLUMN mobile_source_url TEXT;
      ALTER TABLE asset_upload_sessions ADD COLUMN mobile_notes TEXT NOT NULL DEFAULT '';
      INSERT INTO schema_migrations(id,applied_at) VALUES('0048_mobile_capture_metadata','2026-07-25T00:00:00.000Z');
    `)

    runMigrations(database)

    expect(database.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE id='0048_mobile_capture_metadata'`).get()).toEqual({ count: 1 })
    expect(database.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE id='0048_topic_stage_next_action_label'`).get()).toEqual({ count: 1 })
    expect((database.pragma('table_info(captures)') as Array<{ name: string }>).filter((column) => column.name === 'mobile_title')).toHaveLength(1)
    expect((database.pragma('table_info(topic_stage_definitions)') as Array<{ name: string }>).some((column) => column.name === 'next_action_label')).toBe(true)
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('backfills postproduction as complete from the topic lifecycle even when the legacy project status is still producing', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0054_draft_comparison_audit_hardening')
    seedWorkspace(database, true)
    database.prepare(`UPDATE projects SET status='producing',updated_at='2026-07-25T08:00:00.000Z' WHERE id='archived-demo'`).run()
    database.prepare(`UPDATE project_modules SET completed_at=NULL WHERE project_id='archived-demo' AND module_key='publishing'`).run()

    runMigrations(database)

    expect(database.prepare(`SELECT status,started_date AS startedDate,completed_date AS completedDate FROM stage_time_records WHERE project_id='archived-demo' AND stage_key='postproduction'`).get()).toEqual({
      status: 'completed', startedDate: '2026-07-25', completedDate: '2026-07-25'
    })
    expect(database.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id='archived-demo' AND module_key='postproduction'`).get()).toEqual({
      completedAt: '2026-07-25T08:00:00.000Z'
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('keeps migrated legacy stage events undoable after planned fields are added', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0054_draft_comparison_audit_hardening')
    seedWorkspace(database, true)
    const row = database.prepare(`SELECT id FROM stage_time_records WHERE project_id='ios' AND stage_key='materials'`).get() as { id: string }
    const before = {
      status: 'not_started', startedDate: null, startedSegment: null, completedDate: null, completedSegment: null,
      startSource: null, completionSource: null, actualEffortHalfDayUnits: null, autoStartActionId: null
    }
    const after = { ...before, status: 'in_progress', startedDate: '2026-07-24', startedSegment: 'afternoon', startSource: 'manual' }
    database.prepare(`UPDATE stage_time_records SET status='in_progress',started_date='2026-07-24',started_segment='afternoon',start_source='manual' WHERE id=?`).run(row.id)
    database.prepare(`INSERT INTO stage_time_events(id,record_id,project_id,stage_key,action,before_json,after_json,actor,source,recorded_at,undone_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`)
      .run('legacy-stage-event', row.id, 'ios', 'materials', 'update', JSON.stringify(before), JSON.stringify(after), 'user', 'manual', '2026-07-24T08:00:00.000Z')

    runMigrations(database)

    const result = new WorkspaceRepository(database).undoStageTimeEvent('ios', 'legacy-stage-event')
    expect(result.record).toMatchObject({ status: 'not_started', startedAt: null, planManualFields: [], planAutoField: null })
    expect(database.prepare(`SELECT undone_at IS NOT NULL AS undone FROM stage_time_events WHERE id='legacy-stage-event'`).get()).toEqual({ undone: 1 })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades legacy project files without losing source locators and backfills project links', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0034_script_revision_conversations')
    seedWorkspace(database, true)

    const timestamp = '2026-07-22T08:00:00.000Z'
    database.prepare(`INSERT INTO file_references(id,relative_path,original_name,sha256,size_bytes,mime_type,created_at,encrypted_source_path) VALUES(?,?,?,?,?,?,?,?)`)
      .run('legacy-pdf', 'project-materials/ssd/legacy.pdf', 'legacy.pdf', 'a'.repeat(64), 120, 'application/pdf', timestamp, 'encrypted-legacy-path')
    database.prepare(`INSERT INTO project_materials(id,project_id,role,source_kind,title,text_content,source_url,file_id,page_count,parse_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('legacy-material', 'ssd', 'project_material', 'pdf', '旧PDF', '已解析正文', null, 'legacy-pdf', 2, 'ready', timestamp, timestamp)
    database.prepare(`INSERT INTO classification_learning_samples(id,title,ai_suggested_content_type_id,final_content_type_id,created_at) SELECT 'legacy-learning',title,ai_suggested_content_type_id,content_type_id,? FROM projects WHERE id='ssd'`)
      .run(timestamp)
    database.prepare(`UPDATE projects SET status='published',updated_at=? WHERE id='ssd'`).run(timestamp)

    runMigrations(database)

    expect(LATEST_MIGRATION_ID).toBe('0104_m3_workspace_access')
    expect(database.prepare(`SELECT kind,managed_locator AS managedLocator,source_bookmark AS sourceBookmark,source_origin AS sourceOrigin,process_state AS processState,updated_at AS updatedAt FROM file_references WHERE id='legacy-pdf'`).get()).toEqual({
      kind: 'file', managedLocator: 'project-materials/ssd/legacy.pdf', sourceBookmark: 'encrypted-legacy-path', sourceOrigin: 'file_picker', processState: 'ready', updatedAt: timestamp
    })
    expect(database.prepare(`SELECT source_kind AS sourceKind,file_reference_id AS fileReferenceId FROM project_materials WHERE id='legacy-material'`).get()).toEqual({ sourceKind: 'file', fileReferenceId: 'legacy-pdf' })
    expect(database.prepare(`SELECT project_id AS projectId FROM classification_learning_samples WHERE id='legacy-learning'`).get()).toEqual({ projectId: 'ssd' })

    const repository = new WorkspaceRepository(database)
    expect(repository.listProjectAssetLinks('ssd')).toEqual([expect.objectContaining({
      projectMaterialId: 'legacy-material', fileReferenceId: 'legacy-pdf', relativePath: 'legacy.pdf', position: 0, isPrimaryReference: false
    })])
    expect(database.prepare(`SELECT reference_requirements AS value FROM projects WHERE id='ssd'`).get()).toEqual({ value: '' })
    expect(database.prepare(`SELECT system_role AS role FROM topic_stage_definitions WHERE id='topic-stage-completed'`).get()).toEqual({ role: 'completed' })
    expect(database.prepare(`SELECT system_role AS role FROM topic_stage_definitions WHERE id='topic-stage-archived'`).get()).toEqual({ role: 'archived' })
    expect(database.prepare(`SELECT next_action_label AS nextActionLabel FROM topic_stage_definitions WHERE id='topic-stage-evaluation'`).get()).toEqual({ nextActionLabel: '决定是否制作' })
    expect(database.prepare(`SELECT next_action_label AS nextActionLabel FROM topic_stage_definitions WHERE id='topic-stage-created'`).get()).toEqual({ nextActionLabel: null })
    expect(database.prepare(`SELECT stage_id AS stageId,actual_completion_at AS actualCompletionAt FROM topics WHERE created_project_id='ssd'`).get()).toEqual({ stageId: 'topic-stage-created', actualCompletionAt: null })
    expect(database.prepare(`SELECT stage_id AS stageId FROM topics WHERE created_project_id='archived-demo'`).get()).toEqual({ stageId: 'topic-stage-archived' })
    expect(database.prepare(`SELECT status,started_date AS startedDate,completed_date AS completedDate FROM stage_time_records WHERE project_id='ssd' AND stage_key='postproduction'`).get()).toEqual({
      status: 'completed', startedDate: '2026-07-22', completedDate: '2026-07-22'
    })
    expect(database.prepare(`SELECT completed_at AS completedAt FROM project_modules WHERE project_id='ssd' AND module_key='postproduction'`).get()).toEqual({ completedAt: timestamp })
    const receiptColumns = database.pragma('table_info(mobile_capture_receipts)') as Array<{ name: string; notnull: number; dflt_value: unknown }>
    expect(receiptColumns
      .filter((column) => column.name === 'last_note_revision' || column.name === 'last_note_sha256')
      .map((column) => ({ name: column.name, notNull: column.notnull, defaultValue: column.dflt_value })))
      .toEqual([
        { name: 'last_note_revision', notNull: 1, defaultValue: '0' },
        { name: 'last_note_sha256', notNull: 0, defaultValue: null }
      ])
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('migrates automatic schedule todos out of execution while preserving manually owned items', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0066_target_day_and_business_labels')
    seedWorkspace(database, true)
    const scheduleIds = database.prepare(`SELECT id FROM schedule_items ORDER BY id LIMIT 2`).all() as Array<{ id: string }>
    expect(scheduleIds).toHaveLength(2)
    const timestamp = '2026-07-28T08:00:00.000Z'
    const insert = database.prepare(`INSERT INTO todo_items(
      id,title,planned_date,segment,category,project_id,status,tracking_mode,progress,progress_before_complete,
      source,source_schedule_id,source_planned_date,source_segment,schedule_sync_enabled,completed_at,dismissed_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    insert.run('legacy-auto-todo', '自动排期副本', '2026-07-28', 'afternoon', 'self_media', 'ios', 'open', 'checklist', 0, null, 'schedule', scheduleIds[0]!.id, '2026-07-28', 'afternoon', 1, null, null, timestamp, timestamp)
    insert.run('legacy-owned-todo', '已经人工调整', '2026-07-29', 'morning', 'self_media', 'ios', 'open', 'checklist', 0, null, 'schedule', scheduleIds[1]!.id, '2026-07-28', 'afternoon', 0, null, null, timestamp, timestamp)

    runMigrations(database)

    expect(database.prepare(`SELECT status,source,schedule_sync_enabled AS syncEnabled FROM todo_items WHERE id='legacy-auto-todo'`).get())
      .toEqual({ status: 'dismissed', source: 'schedule', syncEnabled: 0 })
    expect(database.prepare(`SELECT status,source,source_schedule_id AS scheduleId,source_planned_date AS sourceDate FROM todo_items WHERE id='legacy-owned-todo'`).get())
      .toEqual({ status: 'open', source: 'manual', scheduleId: null, sourceDate: null })
    expect(new WorkspaceRepository(database).listTodoItems().map((item) => item.id)).toContain('legacy-owned-todo')
    expect(new WorkspaceRepository(database).listTodoItems().map((item) => item.id)).not.toContain('legacy-auto-todo')
  })

  it('backfills legacy script candidates into stable numbered groups and rounds', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0034_script_revision_conversations')
    seedWorkspace(database, true)
    const timestamp = '2026-07-22T08:00:00.000Z'
    const baseVersion = database.prepare(`SELECT id FROM draft_versions WHERE project_id='ssd' ORDER BY revision LIMIT 1`).get() as { id: string }
    database.prepare(`INSERT INTO script_revision_threads(id,project_id,base_version_id,provider,provider_fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('legacy-script-thread', 'ssd', baseVersion.id, 'codex_cli', 'legacy-fingerprint', timestamp, timestamp)
    const insert = database.prepare(`INSERT INTO script_revision_messages(id,thread_id,role,content,provider,selected_text,selection_hash,selection_snapshot_json,suggestion_json,suggestion_status,suggestion_decided_at,task_id,context_snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const selection = JSON.stringify({
      baseVersionId: baseVersion.id, targetSelectionId: 'legacy-target', selectedText: '旧目标',
      selectionHash: 'legacy-hash', contextBefore: '', contextAfter: '', occurrenceIndex: 0, from: 1, to: 4
    })
    const suggestion = JSON.stringify({ originalText: '旧目标', replacementText: '旧候选', action: 'replace', summary: '旧改写', rationale: '' })
    insert.run('legacy-candidate-one', 'legacy-script-thread', 'assistant', '第一轮', 'codex_cli', '旧目标', 'legacy-hash', selection, suggestion, 'pending', null, null, null, timestamp)
    insert.run('legacy-candidate-two', 'legacy-script-thread', 'assistant', '第二轮', 'codex_cli', '旧目标', 'legacy-hash', selection, suggestion, 'pending', null, null, null, '2026-07-22T08:01:00.000Z')

    runMigrations(database)

    expect(database.prepare(`SELECT id,candidate_group_id AS candidateGroupId,candidate_number AS candidateNumber,generation_round AS generationRound,candidate_instruction AS candidateInstruction FROM script_revision_messages WHERE thread_id='legacy-script-thread' ORDER BY created_at`).all()).toEqual([
      { id: 'legacy-candidate-one', candidateGroupId: 'legacy-script-thread:legacy-target', candidateNumber: 1, generationRound: 1, candidateInstruction: '' },
      { id: 'legacy-candidate-two', candidateGroupId: 'legacy-script-thread:legacy-target', candidateNumber: 1, generationRound: 2, candidateInstruction: '' }
    ])
  })

  it('splits legacy version candidates out of a mixed ordinary conversation during 0081', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0080_r16b_material_candidate_lineage')
    seedWorkspace(database, true)
    const timestamp = '2026-08-04T00:00:00.000Z'
    const baseVersion = database.prepare(`SELECT id FROM draft_versions WHERE project_id='ai-browser' ORDER BY revision LIMIT 1`).get() as { id: string }
    database.prepare(`INSERT INTO script_revision_threads(id,project_id,base_version_id,provider,provider_fingerprint,provider_thread_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run('mixed-script-thread', 'ai-browser', baseVersion.id, 'codex_cli', 'legacy-fingerprint', 'polluted-provider-thread', timestamp, timestamp)
    database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run('legacy-version-task', 'script_revision', 'ai-browser', '旧版本候选', 'codex_cli', 'succeeded', 100, '{}', '{}', timestamp)
    const selection = JSON.stringify({
      baseVersionId: baseVersion.id, targetSelectionId: 'legacy-version-target', selectedText: '旧版本文字', selectionHash: 'legacy-hash',
      contextBefore: '', contextAfter: '', occurrenceIndex: 0, from: 1, to: 6,
      applicationTarget: { surface: 'version_compare', side: 'left', sourceId: 'version-a', contentHash: 'a'.repeat(64), content: '<p>版本A</p>', range: null }
    })
    const insert = database.prepare(`INSERT INTO script_revision_messages(id,thread_id,role,content,provider,selected_text,selection_hash,selection_snapshot_json,suggestion_json,suggestion_status,task_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    insert.run('ordinary-message', 'mixed-script-thread', 'user', '普通对话必须保留', 'codex_cli', null, null, null, null, null, null, timestamp)
    insert.run('version-user-message', 'mixed-script-thread', 'user', '版本候选要求', 'codex_cli', '旧版本文字', 'legacy-hash', selection, null, null, 'legacy-version-task', '2026-08-04T00:01:00.000Z')
    insert.run('version-assistant-message', 'mixed-script-thread', 'assistant', '版本候选结果', 'codex_cli', '旧版本文字', 'legacy-hash', selection, JSON.stringify({ originalText: '旧版本文字', replacementText: '新版本文字', action: 'replace', summary: '改写', rationale: '' }), 'pending', 'legacy-version-task', '2026-08-04T00:02:00.000Z')

    runMigrations(database)

    const threads = database.prepare(`SELECT id,surface,provider_thread_id AS providerThreadId FROM script_revision_threads WHERE project_id='ai-browser' AND provider='codex_cli' ORDER BY surface,id`).all() as Array<{ id: string; surface: string; providerThreadId: string | null }>
    expect(threads).toEqual(expect.arrayContaining([
      { id: 'mixed-script-thread', surface: 'conversation', providerThreadId: null },
      expect.objectContaining({ surface: 'version_compare', providerThreadId: null })
    ]))
    const repository = new WorkspaceRepository(database)
    expect(repository.getScriptRevisionConversation('ai-browser', null, 'codex_cli').messages.map((message) => message.content)).toEqual(['普通对话必须保留'])
    const versionConversation = repository.getScriptRevisionConversation('ai-browser', null, 'codex_cli', 'version_compare')
    expect(versionConversation.threadId).toBeNull()
    expect(versionConversation.messages.map((message) => message.content)).toEqual(['版本候选要求', '版本候选结果'])
    expect(new Set(versionConversation.messages.map((message) => message.threadId)).size).toBe(1)
  })

  it('leaves ambiguous legacy classification samples unassigned', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0050_classification_learning_project')
    seedWorkspace(database, true)
    const projectColumns = (database.pragma('table_info(projects)') as { name: string }[]).map((column) => column.name)
    const sourceProject = database.prepare(`SELECT * FROM projects WHERE id='ai-browser'`).get() as Record<string, unknown>
    const insertProject = database.prepare(`INSERT INTO projects(${projectColumns.join(',')}) VALUES(${projectColumns.map(() => '?').join(',')})`)
    for (const [id, color] of [['duplicate-topic-1', 'project-10'], ['duplicate-topic-2', 'project-11']] as const) {
      const clone: Record<string, unknown> = { ...sourceProject, id, title: '同名选题', project_color_token: color, ai_suggested_content_type_id: 'type-digital' }
      insertProject.run(...projectColumns.map((column) => clone[column]))
    }
    database.prepare(`INSERT INTO classification_learning_samples(id,title,ai_suggested_content_type_id,final_content_type_id,created_at,project_id) VALUES(?,?,?,?,?,NULL)`)
      .run('ambiguous-learning', '同名选题', 'type-digital', 'type-ai', '2026-07-20T00:00:00.000Z')

    runMigrations(database)
    expect(database.prepare(`SELECT project_id AS projectId FROM classification_learning_samples WHERE id='ambiguous-learning'`).get()).toEqual({ projectId: null })
  })

  it('audits and merges historical multi-rebate rows before enforcing one rebate per project', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0048_topic_stage_next_action_label')
    seedWorkspace(database, true)
    const firstAt = '2026-07-20T08:00:00.000Z'
    const secondAt = '2026-07-21T08:00:00.000Z'
    database.prepare(`INSERT INTO business_records(project_id,rebate_requirement,invoice_requirement,created_at,updated_at) VALUES(?,?,?,?,?)`)
      .run('sponsor', 'required', 'not_required', firstAt, firstAt)
    database.prepare(`INSERT INTO rebate_payments(id,project_id,amount_cents,paid_date,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('legacy-rebate-1', 'sponsor', 50_000, '2026-07-20', '第一笔', firstAt, firstAt)
    database.prepare(`INSERT INTO rebate_payments(id,project_id,amount_cents,paid_date,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('legacy-rebate-2', 'sponsor', 90_000, '2026-07-21', '第二笔', secondAt, secondAt)
    database.prepare(`INSERT INTO file_references(id,relative_path,original_name,sha256,size_bytes,mime_type,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('legacy-rebate-proof-file', 'business-files/sponsor/proof.pdf', 'proof.pdf', 'a'.repeat(64), 120, 'application/pdf', firstAt)
    database.prepare(`INSERT INTO business_files(id,project_id,role,file_id,rebate_payment_id,invoice_id,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('legacy-rebate-proof', 'sponsor', 'rebate_payment_proof', 'legacy-rebate-proof-file', 'legacy-rebate-2', null, secondAt)

    runMigrations(database)

    expect(database.prepare(`SELECT id,amount_cents AS amountCents,paid_date AS paidDate,notes FROM rebate_payments WHERE project_id='sponsor'`).all()).toEqual([
      expect.objectContaining({ id: 'legacy-rebate-1', amountCents: 140_000, paidDate: '2026-07-21', notes: expect.stringContaining('原始记录已保留审计') })
    ])
    expect(database.prepare(`SELECT COUNT(*) AS count FROM rebate_payment_migration_audit WHERE project_id='sponsor'`).get()).toEqual({ count: 2 })
    expect(database.prepare(`SELECT rebate_payment_id AS rebatePaymentId FROM business_files WHERE id='legacy-rebate-proof'`).get()).toEqual({ rebatePaymentId: 'legacy-rebate-1' })
    expect(database.prepare(`SELECT project_id AS projectId FROM business_file_project_links WHERE business_file_id='legacy-rebate-proof'`).all()).toEqual([{ projectId: 'sponsor' }])
    expect(database.prepare(`SELECT payment_status AS paymentStatus,payment_received_date AS paymentReceivedDate FROM business_records WHERE project_id='sponsor'`).get()).toEqual({ paymentStatus: 'received', paymentReceivedDate: null })
    expect(new WorkspaceRepository(database).getBusinessProjectData('sponsor').record).toMatchObject({
      paymentStatus: 'received', rebateExecutionStatus: 'completed', ledgerStatus: 'completed'
    })
    expect(() => database.prepare(`INSERT INTO rebate_payments(id,project_id,amount_cents,paid_date,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('forbidden-second-rebate', 'sponsor', 1, '2026-07-22', '', secondAt, secondAt)).toThrow()
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('promotes legacy stages named 已完成 or 已归档 instead of creating duplicate lifecycle stages', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0037_production_outputs_and_publishing_handoffs')
    seedWorkspace(database, true)
    database.prepare(`INSERT INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .run('legacy-stage-completed', '已完成', 60, 'standard', '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z')
    database.prepare(`INSERT INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .run('legacy-stage-archived', '已归档', 70, 'standard', '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z')

    runMigrations(database)

    const lifecycle = database.prepare(`SELECT id,name,system_role AS role,position FROM topic_stage_definitions WHERE system_role IS NOT NULL ORDER BY position`).all()
    expect(lifecycle).toEqual([
      expect.objectContaining({ name: '已立项', role: 'project_created' }),
      expect.objectContaining({ id: 'legacy-stage-completed', name: '已完成', role: 'completed' }),
      expect.objectContaining({ id: 'legacy-stage-archived', name: '已归档', role: 'archived' }),
      expect.objectContaining({ name: '已搁置', role: 'shelved' })
    ])
    expect(database.prepare(`SELECT COUNT(*) AS count FROM topic_stage_definitions WHERE name IN ('已完成','已归档')`).get()).toEqual({ count: 2 })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades legacy conversation candidates into the AI topic screening lifecycle', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0040_bilingual_ass_subtitle_artifacts')
    seedWorkspace(database, true)
    const timestamp = '2026-07-24T08:00:00.000Z'
    database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,model,status,progress,input_snapshot,project_description_snapshot,permission_profile_json,output_target,result_summary,error_code,error_message,retry_of_id,requires_confirmation,requested_at,started_at,finished_at,task_content_type_id,task_template_id,resource_snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('legacy-filter-task', 'conversation_filter', null, '旧筛选', 'codex_cli', null, 'succeeded', 100, '{}', null, '{"network":"provider_only","readableRefs":[],"writableTarget":"candidate_fact","shell":false}', 'conversation_filter_candidates', null, null, null, null, 0, timestamp, timestamp, timestamp, null, null, null)
    database.prepare(`INSERT INTO conversation_filter_candidates(id,task_id,candidate_key,atom_type,title,content,value_reason,risk_notes_json,source_refs_json,approximate_duplicate_group_key,content_hash,status,destination_kind,destination_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('legacy-candidate', 'legacy-filter-task', 'legacy-key', 'method', '旧候选标题', '旧候选正文', '旧价值理由', '[]', '[]', null, 'a'.repeat(64), 'kept', 'topic', 'ssd-topic', timestamp, timestamp)

    runMigrations(database)

    expect(database.prepare(`SELECT theme_title AS themeTitle,direction_title AS directionTitle,review_group AS reviewGroup,status,destination_kind AS destinationKind FROM conversation_filter_candidates WHERE id='legacy-candidate'`).get()).toEqual({
      themeTitle: '旧候选标题',
      directionTitle: '旧候选标题',
      reviewGroup: 'needs_judgment',
      status: 'confirmed',
      destinationKind: 'topic'
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('preserves existing subtitle artifacts while adding bilingual ASS support', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0037_production_outputs_and_publishing_handoffs')
    seedWorkspace(database, true)

    const timestamp = '2026-07-22T08:00:00.000Z'
    database.prepare(`INSERT INTO file_references(id,relative_path,original_name,sha256,size_bytes,mime_type,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('subtitle-source', 'subtitle/source.wav', 'source.wav', 'a'.repeat(64), 120, 'audio/wav', timestamp)
    database.prepare(`INSERT INTO file_references(id,relative_path,original_name,sha256,size_bytes,mime_type,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('subtitle-zh', 'subtitle/zh.srt', 'zh.srt', 'b'.repeat(64), 80, 'application/x-subrip', timestamp)
    database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,status,progress,input_snapshot,permission_profile_json,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run('subtitle-task', 'subtitle_generate', 'ssd', '中文字幕', 'local_subtitle', 'completed', 100, '{}', '{}', timestamp)
    database.prepare(`INSERT INTO subtitle_jobs(id,project_id,task_id,input_file_id,schema,engine,style_preset_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('subtitle-job', 'ssd', 'subtitle-task', 'subtitle-source', 'zh', 'subtitle-skill', '{}', timestamp, timestamp)
    database.prepare(`INSERT INTO subtitle_artifacts(id,job_id,project_id,file_id,artifact_kind,created_at) VALUES(?,?,?,?,?,?)`)
      .run('subtitle-artifact', 'subtitle-job', 'ssd', 'subtitle-zh', 'zh_srt', timestamp)

    runMigrations(database)

    expect(database.prepare(`SELECT artifact_kind AS artifactKind FROM subtitle_artifacts WHERE id='subtitle-artifact'`).get()).toEqual({ artifactKind: 'zh_srt' })
    database.prepare(`INSERT INTO subtitle_artifacts(id,job_id,project_id,file_id,artifact_kind,created_at) VALUES(?,?,?,?,?,?)`)
      .run('subtitle-ass-artifact', 'subtitle-job', 'ssd', 'subtitle-zh', 'bilingual_ass', timestamp)
    expect(database.prepare(`SELECT artifact_kind AS artifactKind FROM subtitle_artifacts WHERE id='subtitle-ass-artifact'`).get()).toEqual({ artifactKind: 'bilingual_ass' })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('keeps Capture relations separate and enforces resumable upload identities', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrations(database)
    seedWorkspace(database, true)

    const timestamp = '2026-07-22T09:00:00.000Z'
    database.prepare(`INSERT INTO file_references(id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,source_origin,availability,process_state,capabilities_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('capture-image', 'file', 'mobile/capture-image.jpg', 'mobile/capture-image.jpg', 'capture-image.jpg', 'b'.repeat(64), 240, 'image/jpeg', 'mobile_android', 'available', 'ready', '["preview","ocr"]', timestamp, timestamp)
    database.prepare(`INSERT INTO capture_asset_links(id,capture_id,file_reference_id,attachment_kind,position,created_at) VALUES(?,?,?,?,?,?)`)
      .run('capture-link-1', 'capture-1', 'capture-image', 'image', 0, timestamp)

    const repository = new WorkspaceRepository(database)
    expect(repository.listCaptureAssetLinks('capture-1')).toEqual([expect.objectContaining({ fileReferenceId: 'capture-image', attachmentKind: 'image', position: 0 })])
    expect(repository.listProjectAssetLinks('ssd')).toEqual([])

    database.prepare(`INSERT INTO mobile_sync_devices(id,name,encrypted_secret,created_at) VALUES(?,?,?,?)`).run('device-1', 'Android', 'protected', timestamp)
    database.prepare(`INSERT INTO asset_upload_sessions(id,device_id,mobile_capture_id,protocol_version,expected_attachment_count,capture_kind_hint,original_content,capture_created_at,state,created_at,updated_at,last_activity_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('session-1', 'device-1', 'mobile-capture-1', 2, 1, 'inspiration', '手机分享图片', timestamp, 'receiving', timestamp, timestamp, timestamp, '2026-07-23T09:00:00.000Z')
    expect(() => database.prepare(`INSERT INTO asset_upload_sessions(id,device_id,mobile_capture_id,protocol_version,expected_attachment_count,capture_created_at,state,created_at,updated_at,last_activity_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run('session-duplicate', 'device-1', 'mobile-capture-1', 2, 1, timestamp, 'receiving', timestamp, timestamp, timestamp, '2026-07-23T09:00:00.000Z')).toThrow()

    database.prepare(`INSERT INTO asset_upload_attachments(id,session_id,attachment_id,attachment_kind,position,name,mime_type,byte_size,sha256,chunk_count,received_count,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('upload-attachment-1', 'session-1', 'phone-attachment-1', 'image', 0, 'photo.jpg', 'image/jpeg', 240, 'b'.repeat(64), 2, 1, 'receiving', timestamp, timestamp)
    database.prepare(`INSERT INTO asset_upload_chunks(upload_attachment_id,chunk_index,byte_size,sha256,nonce,auth_tag,staged_locator,received_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run('upload-attachment-1', 0, 120, 'c'.repeat(64), 'nonce-0', 'tag-0', 'upload/session-1/0.part', timestamp)
    expect(() => database.prepare(`INSERT INTO asset_upload_chunks(upload_attachment_id,chunk_index,byte_size,sha256,nonce,auth_tag,staged_locator,received_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run('upload-attachment-1', 0, 120, 'd'.repeat(64), 'nonce-other', 'tag-other', 'upload/session-1/0-other.part', timestamp)).toThrow()
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('preserves in-flight uploads while adding video support and non-expiring retries', () => {
    const database = new BetterSqlite3(':memory:'); databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0049_mobile_recording_metadata')
    seedWorkspace(database, true)

    const timestamp = '2026-07-25T05:00:00.000Z'
    database.prepare(`INSERT INTO mobile_sync_devices(id,name,encrypted_secret,created_at) VALUES(?,?,?,?)`)
      .run('migration-device', 'Android真机', 'protected', timestamp)
    database.prepare(`INSERT INTO asset_upload_sessions(id,device_id,mobile_capture_id,protocol_version,expected_attachment_count,capture_kind_hint,original_content,capture_created_at,state,created_at,updated_at,last_activity_at,expires_at,mobile_recording_markers_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('migration-session', 'migration-device', 'migration-capture', 2, 1, 'inspiration', '录音草稿', timestamp, 'receiving', timestamp, timestamp, timestamp, '2026-07-26T05:00:00.000Z', '[1200]')
    database.prepare(`INSERT INTO asset_upload_attachments(id,session_id,attachment_id,attachment_kind,name,mime_type,byte_size,sha256,chunk_count,received_count,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('migration-attachment', 'migration-session', 'phone-audio', 'audio', 'recording.m4a', 'audio/mp4', 240, 'a'.repeat(64), 2, 1, 'receiving', timestamp, timestamp)
    database.prepare(`INSERT INTO asset_upload_chunks(upload_attachment_id,chunk_index,byte_size,sha256,nonce,auth_tag,staged_locator,received_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run('migration-attachment', 0, 120, 'b'.repeat(64), 'nonce-0', 'tag-0', 'mobile-upload/migration/0.part', timestamp)

    runMigrations(database)

    expect(database.prepare(`SELECT attachment_kind AS attachmentKind,position,received_count AS receivedCount FROM asset_upload_attachments WHERE id='migration-attachment'`).get())
      .toEqual({ attachmentKind: 'audio', position: 0, receivedCount: 1 })
    expect(database.prepare(`SELECT chunk_index AS chunkIndex,staged_locator AS stagedLocator FROM asset_upload_chunks WHERE upload_attachment_id='migration-attachment'`).get())
      .toEqual({ chunkIndex: 0, stagedLocator: 'mobile-upload/migration/0.part' })
    expect(database.prepare(`SELECT expires_at AS expiresAt,mobile_recording_markers_json AS markers FROM asset_upload_sessions WHERE id='migration-session'`).get())
      .toEqual({ expiresAt: '9999-12-31T23:59:59.999Z', markers: '[1200]' })

    database.prepare(`INSERT INTO asset_upload_attachments(id,session_id,attachment_id,attachment_kind,position,name,mime_type,byte_size,sha256,chunk_count,received_count,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('migration-video', 'migration-session', 'phone-video', 'video', 1, 'clip.mp4', 'video/mp4', 1, 'c'.repeat(64), 1, 0, 'receiving', timestamp, timestamp)
    expect(database.prepare(`SELECT attachment_kind AS attachmentKind FROM asset_upload_attachments WHERE id='migration-video'`).get())
      .toEqual({ attachmentKind: 'video' })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })
})
