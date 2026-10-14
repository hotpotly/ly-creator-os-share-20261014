import { registerWorkspaceV2ProjectionFunctions, workspaceV2DomainStatements } from './workspace-sync-v2-projections'
import { workspaceV2Statements } from './workspace-sync-v2-migration'
import { workspaceSyncStatements } from './workspace-sync-migration'
import { canGroupSchedules } from '../../shared/schedule-group'
import { normalizeContentClassification, contentClassificationStatements } from './content-classification-migration'
import type BetterSqlite3 from 'better-sqlite3'
import { stagePlanBaselineStatements } from './stage-plan-baseline-migration'
import { splitProductionStages } from './split-production-migration'

interface Migration { id: string; statements: string[]; rebuild?: (database: BetterSqlite3.Database) => void }

const migrations: Migration[] = [{
  id: '0001_stage2_core',
  statements: [
    `CREATE TABLE IF NOT EXISTS content_types (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1 NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS content_types_name_unique ON content_types(name)`,
    `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '' NOT NULL, content_type_id TEXT NOT NULL REFERENCES content_types(id), status TEXT NOT NULL, project_color_token TEXT NOT NULL, platform_targets_json TEXT DEFAULT '[]' NOT NULL, is_pinned INTEGER DEFAULT 0 NOT NULL, last_opened_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS projects_content_type_idx ON projects(content_type_id)`,
    `CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status)`,
    `CREATE TABLE IF NOT EXISTS project_modules (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, module_key TEXT NOT NULL, enabled INTEGER DEFAULT 1 NOT NULL, position INTEGER NOT NULL, disabled_at TEXT, last_changed_by TEXT NOT NULL, content_root_id TEXT NOT NULL, PRIMARY KEY(project_id,module_key))`,
    `CREATE TABLE IF NOT EXISTS draft_versions (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, document_type TEXT NOT NULL, kind TEXT NOT NULL, parent_version_ids_json TEXT DEFAULT '[]' NOT NULL, content TEXT NOT NULL, source_file_path TEXT, is_final INTEGER DEFAULT 0 NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS draft_versions_project_document_idx ON draft_versions(project_id,document_type,created_at)`,
    `CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY NOT NULL, capture_kind TEXT NOT NULL, primary_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, referenced_project_ids_json TEXT DEFAULT '[]' NOT NULL, classification_status TEXT NOT NULL, classification_confidence REAL, suggested_content_type_id TEXT REFERENCES content_types(id) ON DELETE SET NULL, original_content TEXT NOT NULL, source_type TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS captures_classification_idx ON captures(classification_status,created_at)`,
    `CREATE INDEX IF NOT EXISTS captures_project_idx ON captures(primary_project_id)`,
    `CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, core_angle TEXT DEFAULT '' NOT NULL, content_type_id TEXT NOT NULL REFERENCES content_types(id), priority INTEGER DEFAULT 0 NOT NULL, needs_more_experience INTEGER DEFAULT 0 NOT NULL, planned_window TEXT, next_action TEXT DEFAULT '' NOT NULL, status TEXT NOT NULL, source_capture_ids_json TEXT DEFAULT '[]' NOT NULL, created_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS link_groups (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, color_token TEXT NOT NULL, label_index INTEGER NOT NULL, selected_text TEXT NOT NULL, merged_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, claude_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, codex_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, match_type TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS link_groups_project_idx ON link_groups(project_id,created_at)`,
    `CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ]
}, {
  id: '0002_stage2_integrity',
  statements: [
    `CREATE TABLE IF NOT EXISTS file_references (id TEXT PRIMARY KEY NOT NULL, relative_path TEXT NOT NULL, original_name TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, mime_type TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS file_references_relative_path_unique ON file_references(relative_path)`,
    `ALTER TABLE draft_versions ADD COLUMN source_file_id TEXT REFERENCES file_references(id)`,
    `ALTER TABLE draft_versions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE draft_versions ADD COLUMN resolved_at TEXT`,
    `WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id,document_type ORDER BY created_at,id) AS revision FROM draft_versions) UPDATE draft_versions SET revision=(SELECT revision FROM ranked WHERE ranked.id=draft_versions.id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS draft_versions_project_document_revision_unique ON draft_versions(project_id,document_type,revision)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS link_groups_project_version_label_unique ON link_groups(project_id,merged_version_id,label_index)`
  ]
}, {
  id: '0003_stage3_schedule_tasks',
  statements: [
    `ALTER TABLE captures ADD COLUMN suggested_project_id TEXT REFERENCES projects(id)`,
    `ALTER TABLE captures ADD COLUMN classification_reason TEXT`,
    `ALTER TABLE captures ADD COLUMN classified_at TEXT`,
    `CREATE TABLE IF NOT EXISTS classification_actions (id TEXT PRIMARY KEY NOT NULL, capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE, previous_status TEXT NOT NULL, previous_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, previous_content_type_id TEXT REFERENCES content_types(id) ON DELETE SET NULL, previous_confidence REAL, previous_reason TEXT, previous_classified_at TEXT, next_status TEXT NOT NULL, next_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, next_content_type_id TEXT REFERENCES content_types(id) ON DELETE SET NULL, reason TEXT, confidence REAL, created_at TEXT NOT NULL, undone_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS classification_actions_capture_idx ON classification_actions(capture_id,created_at)`,
    `CREATE TABLE IF NOT EXISTS schedule_items (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, action_type TEXT NOT NULL, start_at TEXT, end_at TEXT, schedule_kind TEXT NOT NULL, state TEXT NOT NULL, waiting_for TEXT, source TEXT NOT NULL, is_movable INTEGER DEFAULT 1 NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS schedule_items_range_idx ON schedule_items(start_at,end_at)`,
    `CREATE INDEX IF NOT EXISTS schedule_items_project_idx ON schedule_items(project_id,start_at)`,
    `CREATE TABLE IF NOT EXISTS task_runs (id TEXT PRIMARY KEY NOT NULL, task_type TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, title TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, status TEXT NOT NULL, progress INTEGER DEFAULT 0 NOT NULL, input_snapshot TEXT NOT NULL, project_description_snapshot TEXT, permission_profile_json TEXT NOT NULL, output_target TEXT, result_summary TEXT, error_code TEXT, error_message TEXT, retry_of_id TEXT, requires_confirmation INTEGER DEFAULT 0 NOT NULL, requested_at TEXT NOT NULL, started_at TEXT, finished_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS task_runs_status_idx ON task_runs(status,requested_at)`,
    `CREATE INDEX IF NOT EXISTS task_runs_project_idx ON task_runs(project_id,requested_at)`,
    `CREATE TABLE IF NOT EXISTS external_file_relations (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_path TEXT NOT NULL, display_name TEXT NOT NULL, last_sha256 TEXT NOT NULL, last_mtime_ms REAL NOT NULL, last_size_bytes INTEGER NOT NULL, last_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, status TEXT NOT NULL, created_at TEXT NOT NULL, last_synced_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS external_file_relations_source_path_unique ON external_file_relations(source_path)`,
    `CREATE INDEX IF NOT EXISTS external_file_relations_project_idx ON external_file_relations(project_id)`
  ]
}, {
  id: '0004_stage3_classification_side_effects',
  statements: [
    `ALTER TABLE classification_actions ADD COLUMN created_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL`,
    `UPDATE schedule_items SET is_movable=1`
  ]
}, {
  id: '0005_stage35_content_directions_templates',
  statements: [
    `CREATE TABLE IF NOT EXISTS project_templates (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '' NOT NULL, module_keys_json TEXT DEFAULT '[]' NOT NULL, recommended_content_type_ids_json TEXT DEFAULT '[]' NOT NULL, sort_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1 NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS project_templates_name_unique ON project_templates(name)`,
    `ALTER TABLE content_types ADD COLUMN default_project_template_id TEXT REFERENCES project_templates(id)`,
    `ALTER TABLE projects ADD COLUMN applied_template_id TEXT REFERENCES project_templates(id) ON DELETE SET NULL`,
    `CREATE TABLE IF NOT EXISTS project_content_type_history (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, previous_content_type_id TEXT NOT NULL REFERENCES content_types(id), next_content_type_id TEXT NOT NULL REFERENCES content_types(id), source TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS project_content_type_history_project_idx ON project_content_type_history(project_id,created_at)`,
    `INSERT OR IGNORE INTO project_templates(id,name,description,module_keys_json,recommended_content_type_ids_json,sort_order,is_active,created_at,updated_at) VALUES('template-digital-review','数码长视频','适合自用数码体验与横评，先保留资料和实测，再进入文案与制作。','["materials","script","production","publishing"]','["type-digital"]',10,1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO project_templates(id,name,description,module_keys_json,recommended_content_type_ids_json,sort_order,is_active,created_at,updated_at) VALUES('template-commercial','商单','包含Brief、大纲、文案、制作、发布与商单独有反馈。','["materials","outline","script","production","publishing","feedback"]','["type-commercial"]',20,1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO project_templates(id,name,description,module_keys_json,recommended_content_type_ids_json,sort_order,is_active,created_at,updated_at) VALUES('template-system-experience','手机系统测评','适合手机系统长期体验，默认保留资料、文案、制作与发布。','["materials","script","production","publishing"]','["type-system"]',30,1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO project_templates(id,name,description,module_keys_json,recommended_content_type_ids_json,sort_order,is_active,created_at,updated_at) VALUES('template-ai-tutorial','AI教学','从资料和大纲开始，可继续进入无录屏AI视频制作。','["materials","outline","script","production","publishing"]','["type-ai"]',40,1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO project_templates(id,name,description,module_keys_json,recommended_content_type_ids_json,sort_order,is_active,created_at,updated_at) VALUES('template-quick-content','数码短视频','轻量起步，只预选文案和发布。','["script","publishing"]','["type-quick"]',50,1,datetime('now'),datetime('now'))`,
    `UPDATE content_types SET default_project_template_id=CASE id WHEN 'type-digital' THEN 'template-digital-review' WHEN 'type-commercial' THEN 'template-commercial' WHEN 'type-system' THEN 'template-system-experience' WHEN 'type-ai' THEN 'template-ai-tutorial' WHEN 'type-quick' THEN 'template-quick-content' ELSE default_project_template_id END`,
    `UPDATE projects SET applied_template_id=CASE content_type_id WHEN 'type-digital' THEN 'template-digital-review' WHEN 'type-commercial' THEN 'template-commercial' WHEN 'type-system' THEN 'template-system-experience' WHEN 'type-ai' THEN 'template-ai-tutorial' WHEN 'type-quick' THEN 'template-quick-content' ELSE NULL END WHERE applied_template_id IS NULL`
  ]
}, {
  id: '0006_project_template_names',
  statements: [
    `UPDATE project_templates SET name='数码长视频', updated_at=datetime('now') WHERE id='template-digital-review'`,
    `UPDATE project_templates SET name='商单', updated_at=datetime('now') WHERE id='template-commercial'`,
    `UPDATE project_templates SET name='手机系统测评', updated_at=datetime('now') WHERE id='template-system-experience'`,
    `UPDATE project_templates SET name='AI教学', updated_at=datetime('now') WHERE id='template-ai-tutorial'`,
    `UPDATE project_templates SET name='数码短视频', updated_at=datetime('now') WHERE id='template-quick-content'`
  ]
}, {
  id: '0007_inspiration_topic_workspace',
  statements: [
    `ALTER TABLE captures ADD COLUMN linked_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL`,
    `ALTER TABLE captures ADD COLUMN classification_actor TEXT`,
    `ALTER TABLE captures ADD COLUMN use_status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE captures ADD COLUMN usage_type TEXT`,
    `ALTER TABLE topics ADD COLUMN deadline_at TEXT`,
    `UPDATE captures SET classification_actor=CASE WHEN classification_status='confirmed' AND classification_reason='\u7528\u6237\u5728\u5feb\u901f\u8bb0\u5f55\u4e2d\u6307\u5b9a\u9879\u76ee' THEN 'user' WHEN classification_status IN ('confirmed','suggested') THEN 'system' ELSE NULL END`,
    `UPDATE topics SET priority=CASE WHEN priority<0 THEN 0 WHEN priority>3 THEN 3 ELSE priority END`,
    `UPDATE topics SET status=CASE status WHEN 'evaluating' THEN 'evaluation_pending' WHEN 'decided' THEN 'decided_to_produce' ELSE status END`
  ]
}, {
  id: '0008_content_direction_names',
  statements: [
    `UPDATE content_types SET name=name||'（自定义）' WHERE id<>'type-digital' AND name='数码'`,
    `UPDATE content_types SET name=name||'（自定义）' WHERE id<>'type-system' AND name='手机系统'`,
    `UPDATE content_types SET name=name||'（自定义）' WHERE id<>'type-ai' AND name='AI'`,
    `UPDATE content_types SET name='数码',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='type-digital'`,
    `UPDATE content_types SET name='手机系统',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='type-system'`,
    `UPDATE content_types SET name='AI',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='type-ai'`
  ]
}, {
  id: '0009_capture_path_action_snapshots',
  statements: [
    `ALTER TABLE classification_actions ADD COLUMN previous_capture_kind TEXT`,
    `ALTER TABLE classification_actions ADD COLUMN previous_linked_topic_id TEXT`,
    `ALTER TABLE classification_actions ADD COLUMN previous_usage_type TEXT`,
    `ALTER TABLE classification_actions ADD COLUMN next_capture_kind TEXT`,
    `ALTER TABLE classification_actions ADD COLUMN next_linked_topic_id TEXT`,
    `ALTER TABLE classification_actions ADD COLUMN next_usage_type TEXT`
  ]
}, {
  id: '0010_general_record_categories',
  statements: [
    `CREATE TABLE IF NOT EXISTS general_record_categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1 NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS general_record_categories_name_unique ON general_record_categories(name)`,
    `INSERT OR IGNORE INTO general_record_categories(id,name,sort_order,is_active,created_at,updated_at) VALUES('general-daily-reflection','日常感悟',10,1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO general_record_categories(id,name,sort_order,is_active,created_at,updated_at) VALUES('general-investment-observation','投资观察',20,1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO general_record_categories(id,name,sort_order,is_active,created_at,updated_at) VALUES('general-work-method','工作方法',30,1,datetime('now'),datetime('now'))`,
    `ALTER TABLE captures ADD COLUMN general_category_id TEXT REFERENCES general_record_categories(id) ON DELETE SET NULL`,
    `ALTER TABLE classification_actions ADD COLUMN previous_general_category_id TEXT`,
    `ALTER TABLE classification_actions ADD COLUMN next_general_category_id TEXT`
  ]
}, {
  id: '0011_final_versions_and_style_preferences',
  statements: [
    `CREATE TABLE IF NOT EXISTS style_preferences (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, final_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, note TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS style_preferences_project_idx ON style_preferences(project_id,created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS style_preferences_version_pair_unique ON style_preferences(project_id,source_version_id,final_version_id)`,
    `UPDATE draft_versions SET is_final=0 WHERE document_type='script' AND is_final=1 AND id NOT IN (SELECT id FROM draft_versions latest WHERE latest.document_type='script' AND latest.is_final=1 AND latest.revision=(SELECT MAX(revision) FROM draft_versions scoped WHERE scoped.project_id=latest.project_id AND scoped.document_type='script' AND scoped.is_final=1))`
  ]
}, {
  id: '0012_topic_start_time',
  statements: [
    `ALTER TABLE topics ADD COLUMN start_at TEXT`
  ]
}, {
  id: '0013_classification_definition_descriptions',
  statements: [
    `ALTER TABLE content_types ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE general_record_categories ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE classification_actions ADD COLUMN definition_snapshot_json TEXT`,
    `UPDATE content_types SET description=CASE id WHEN 'type-digital' THEN '数码产品、配件、硬件和真实使用体验；不包含单纯的手机系统功能。' WHEN 'type-commercial' THEN '包含品牌Brief和商务合作要求的商单内容。' WHEN 'type-system' THEN 'iOS、Android、手机系统功能、系统更新和长期体验。' WHEN 'type-ai' THEN 'AI工具、模型、自动化、生成式创作和AI实战过程。' WHEN 'type-quick' THEN '暂时无法归入其他方向的轻量快速内容。' ELSE description END WHERE description=''`,
    `UPDATE general_record_categories SET description=CASE id WHEN 'general-daily-reflection' THEN '个人生活感受、随想、情绪和日常观察。' WHEN 'general-investment-observation' THEN '股票、基金、财报、估值和市场变化的个人观察；不表示投资建议。' WHEN 'general-work-method' THEN '工作流、效率方法、任务管理和做事复盘。' ELSE description END WHERE description=''`
  ]
}, {
  id: '0014_task_resource_snapshots',
  statements: [
    `CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY NOT NULL, resource_type TEXT NOT NULL CHECK(resource_type IN ('template','style_profile','cover_style_profile','material','account')), name TEXT NOT NULL, description TEXT DEFAULT '' NOT NULL, content_type_id TEXT REFERENCES content_types(id) ON DELETE SET NULL, origin TEXT NOT NULL CHECK(origin IN ('system','own','other_creator')), selection_mode TEXT NOT NULL CHECK(selection_mode IN ('automatic','recommended','manual_only')), version INTEGER DEFAULT 1 NOT NULL, payload_json TEXT DEFAULT '{}' NOT NULL, is_active INTEGER DEFAULT 1 NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(origin<>'other_creator' OR selection_mode='manual_only'))`,
    `CREATE INDEX IF NOT EXISTS resources_content_type_idx ON resources(content_type_id,selection_mode)`,
    `CREATE INDEX IF NOT EXISTS resources_active_idx ON resources(is_active,resource_type)`,
    `CREATE TABLE IF NOT EXISTS project_resource_references (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('base_style','reference_style','sample_script','cover_style','material','account')), enabled INTEGER DEFAULT 1 NOT NULL, selection_source TEXT NOT NULL CHECK(selection_source IN ('automatic','recommended','manual')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,resource_id))`,
    `CREATE INDEX IF NOT EXISTS project_resource_references_project_idx ON project_resource_references(project_id,enabled)`,
    `ALTER TABLE task_runs ADD COLUMN task_content_type_id TEXT REFERENCES content_types(id) ON DELETE SET NULL`,
    `ALTER TABLE task_runs ADD COLUMN task_template_id TEXT REFERENCES project_templates(id) ON DELETE SET NULL`,
    `ALTER TABLE task_runs ADD COLUMN resource_snapshot_json TEXT`,
    `ALTER TABLE draft_versions ADD COLUMN source_task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL`,
    `ALTER TABLE draft_versions ADD COLUMN resource_snapshot_json TEXT`,
    `INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) VALUES('resource-reference-authentic-structure','style_profile','真实体验叙事参考','从具体场景进入，先说真实感受，再用资料和参数解释原因。',NULL,'system','recommended',1,'{"instruction":"可优先使用场景—感受—证据—适用人群的结构，但不强制套用。"}',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) SELECT 'resource-base-style-type-digital','style_profile','数码基础风格','以真实体验、实测与明确适用人群为主，不照搬规格表。',id,'system','automatic',1,'{"instruction":"优先使用项目资料和真实体验，把参数转换为可感知的差异。"}',1,datetime('now'),datetime('now') FROM content_types WHERE id='type-digital'`,
    `INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) SELECT 'resource-base-style-type-commercial','style_profile','商单基础风格','以Brief、项目资料和已确认要求为边界，保留真实体验表达，不使用官方人称。',id,'system','automatic',1,'{"instruction":"完整覆盖Brief与已确认要求，不虚构体验，不使用品牌官方人称。"}',1,datetime('now'),datetime('now') FROM content_types WHERE id='type-commercial'`,
    `INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) SELECT 'resource-base-style-type-system','style_profile','手机系统基础风格','以一段时间后的真实使用感知组织内容，不按功能清单逐条复述。',id,'system','automatic',1,'{"instruction":"按日常感知强弱组织内容，区分短期新鲜感与长期价值。"}',1,datetime('now'),datetime('now') FROM content_types WHERE id='type-system'`,
    `INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) SELECT 'resource-base-style-type-ai','style_profile','AI基础风格','用真实任务和可复查步骤讲清楚AI工具，不夸大无法验证的能力。',id,'system','automatic',1,'{"instruction":"优先演示真实任务，说明输入、步骤、结果和可复查点。"}',1,datetime('now'),datetime('now') FROM content_types WHERE id='type-ai'`,
    `INSERT OR IGNORE INTO resources(id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at) SELECT 'resource-base-style-type-quick','style_profile','快速内容基础风格','快速表达一个清晰观点，优先使用已确认资料与真实体验。',id,'system','automatic',1,'{"instruction":"围绕一个清晰观点快速成稿，不为了完整而填充未确认信息。"}',1,datetime('now'),datetime('now') FROM content_types WHERE id='type-quick'`,
    `INSERT OR IGNORE INTO project_resource_references(project_id,resource_id,role,enabled,selection_source,created_at,updated_at) SELECT projects.id,resources.id,'base_style',1,'automatic',datetime('now'),datetime('now') FROM projects INNER JOIN resources ON resources.content_type_id=projects.content_type_id AND resources.selection_mode='automatic' AND resources.resource_type='style_profile'`
  ]
}, {
  id: '0015_ai_conversation_content_engine',
  statements: [
    `CREATE TABLE IF NOT EXISTS content_sources (id TEXT PRIMARY KEY NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('codex_export','claude_export','pasted_text')), title TEXT NOT NULL, scope_label TEXT NOT NULL, raw_content TEXT NOT NULL, sanitized_content TEXT NOT NULL, privacy_findings_json TEXT NOT NULL DEFAULT '[]', content_sha256 TEXT NOT NULL, duplicate_atom_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS content_sources_created_idx ON content_sources(created_at)`,
    `CREATE TABLE IF NOT EXISTS content_atoms (id TEXT PRIMARY KEY NOT NULL, atom_type TEXT NOT NULL CHECK(atom_type IN ('story','method','viewpoint','comparison','pitfall','verifiable_fact')), title TEXT NOT NULL, content TEXT NOT NULL, scores_json TEXT NOT NULL, source_refs_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('review_pending','kept','discarded','merged')), merged_from_ids_json TEXT NOT NULL DEFAULT '[]', content_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS content_atoms_status_idx ON content_atoms(status,updated_at)`,
    `CREATE INDEX IF NOT EXISTS content_atoms_hash_idx ON content_atoms(content_hash)`,
    `CREATE TABLE IF NOT EXISTS content_derivatives (id TEXT PRIMARY KEY NOT NULL, output_type TEXT NOT NULL CHECK(output_type IN ('x_single','x_thread','ai_short_video_script')), title TEXT NOT NULL, atom_ids_json TEXT NOT NULL, generated_content TEXT NOT NULL, current_content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','project_created')), provider TEXT NOT NULL CHECK(provider IN ('local_rules')), parent_candidate_id TEXT REFERENCES content_derivatives(id) ON DELETE SET NULL, derivation_snapshot_json TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, draft_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS content_derivatives_status_idx ON content_derivatives(status,updated_at)`,
    `ALTER TABLE draft_versions ADD COLUMN source_candidate_id TEXT REFERENCES content_derivatives(id) ON DELETE SET NULL`
  ]
}, {
  id: '0016_real_conversation_filtering',
  statements: [
    `CREATE TABLE IF NOT EXISTS conversation_filter_results (task_id TEXT PRIMARY KEY NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, raw_output_json TEXT NOT NULL, validated_output_json TEXT NOT NULL, candidate_count INTEGER NOT NULL, exact_duplicate_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS conversation_filter_candidates (id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, candidate_key TEXT NOT NULL, atom_type TEXT NOT NULL CHECK(atom_type IN ('story','method','viewpoint','comparison','pitfall','verifiable_fact')), title TEXT NOT NULL, content TEXT NOT NULL, value_reason TEXT NOT NULL, risk_notes_json TEXT NOT NULL DEFAULT '[]', source_refs_json TEXT NOT NULL, approximate_duplicate_group_key TEXT, content_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('review_pending','kept','discarded')), destination_kind TEXT CHECK(destination_kind IN ('content_inspiration','topic','project')), destination_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS conversation_filter_candidates_task_idx ON conversation_filter_candidates(task_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS conversation_filter_candidates_status_idx ON conversation_filter_candidates(status,updated_at)`,
    `CREATE INDEX IF NOT EXISTS conversation_filter_candidates_hash_idx ON conversation_filter_candidates(content_hash)`
  ]
}, {
  id: '0017_configurable_topic_stages',
  statements: [
    `CREATE TABLE IF NOT EXISTS topic_stage_definitions (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('standard','project_created','shelved')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS topic_stage_definitions_name_unique ON topic_stage_definitions(name)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS topic_stage_definitions_position_unique ON topic_stage_definitions(position)`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES('topic-stage-new','新候选',10,'standard',datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES('topic-stage-evaluation','待评估',20,'standard',datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES('topic-stage-decided','已决定制作',30,'standard',datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES('topic-stage-created','已立项',40,'project_created',datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,created_at,updated_at) VALUES('topic-stage-shelved','已搁置',50,'shelved',datetime('now'),datetime('now'))`,
    `ALTER TABLE topics ADD COLUMN stage_id TEXT REFERENCES topic_stage_definitions(id) ON DELETE SET NULL`,
    `UPDATE topics SET stage_id=CASE status WHEN 'evaluation_pending' THEN 'topic-stage-evaluation' WHEN 'decided_to_produce' THEN 'topic-stage-decided' WHEN 'created' THEN 'topic-stage-created' WHEN 'shelved' THEN 'topic-stage-shelved' ELSE 'topic-stage-new' END, next_action=''`
  ]
}, {
  id: '0018_topic_actual_completion',
  statements: [
    `ALTER TABLE topics ADD COLUMN actual_completion_at TEXT`
  ]
}, {
  id: '0019_configurable_topic_columns',
  statements: [
    `CREATE TABLE IF NOT EXISTS topic_column_definitions (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, data_type TEXT NOT NULL CHECK(data_type IN ('text','number','date','relation','action')), builtin_key TEXT UNIQUE, is_visible INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS topic_column_definitions_position_unique ON topic_column_definitions(position)`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-title','选题名称',10,'text','title',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-importance','重要程度',20,'number','importance',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-direction','内容方向',30,'relation','direction',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-stage','阶段',40,'relation','stage',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-start','开始时间',50,'date','start',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-expected','预期完成',60,'date','expected',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-actual','实际完成',70,'date','actual',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-variance','提前/延迟',80,'number','variance',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-next','下一步',90,'action','next',1,datetime('now'),datetime('now'))`,
    `INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) VALUES('topic-column-inspirations','关联灵感',100,'relation','inspirations',1,datetime('now'),datetime('now'))`,
    `CREATE TABLE IF NOT EXISTS topic_custom_values (topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, column_id TEXT NOT NULL REFERENCES topic_column_definitions(id) ON DELETE CASCADE, value_text TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(topic_id,column_id))`,
    `CREATE INDEX IF NOT EXISTS topic_custom_values_column_idx ON topic_custom_values(column_id,topic_id)`
  ]
}, {
  id: '0020_project_trash',
  statements: [
    `ALTER TABLE projects ADD COLUMN trashed_at TEXT`
  ]
}, {
  id: '0021_topic_trash',
  statements: [
    `ALTER TABLE topics ADD COLUMN trashed_at TEXT`
  ]
}, {
  id: '0022_capture_discarded_at',
  statements: [
    `ALTER TABLE captures ADD COLUMN discarded_at TEXT`,
    `UPDATE captures SET discarded_at = created_at WHERE use_status = 'discarded' AND discarded_at IS NULL`
  ]
}, {
  id: '0023_project_module_completion',
  statements: [
    `ALTER TABLE project_modules ADD COLUMN completed_at TEXT`
  ]
}, {
  id: '0024_project_classification_learning',
  statements: [
    `ALTER TABLE projects ADD COLUMN ai_suggested_content_type_id TEXT`,
    `CREATE TABLE IF NOT EXISTS classification_learning_samples (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, ai_suggested_content_type_id TEXT, final_content_type_id TEXT NOT NULL, created_at TEXT NOT NULL)`
  ]
}, {
  id: '0025_short_video_rename',
  statements: [
    `UPDATE content_types SET name=name||'（自定义）' WHERE id<>'type-quick' AND name='短视频'`,
    `UPDATE content_types SET name='短视频',description='短视频内容，以及暂时无法归入其他方向的轻量内容。',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='type-quick'`,
    `UPDATE resources SET name='短视频基础风格',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='resource-base-style-type-quick'`
  ]
}, {
  id: '0026_publishing_materials',
  statements: [
    `CREATE TABLE IF NOT EXISTS project_publishing_materials (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, platform TEXT NOT NULL, material_kind TEXT NOT NULL CHECK(material_kind IN ('title','description','cover','tags','subtitle')), text_value TEXT, file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, source_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((material_kind IN ('title','description','tags') AND file_id IS NULL) OR (material_kind IN ('cover','subtitle') AND text_value IS NULL)))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS project_publishing_material_unique ON project_publishing_materials(project_id,platform,material_kind)`,
    `CREATE INDEX IF NOT EXISTS project_publishing_material_project_idx ON project_publishing_materials(project_id,platform)`
  ]
}, {
  id: '0027_project_materials',
  statements: [
    `CREATE TABLE IF NOT EXISTS project_materials (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('brief','project_material')), source_kind TEXT NOT NULL CHECK(source_kind IN ('pdf','wechat_text','feishu_link')), title TEXT NOT NULL, text_content TEXT, source_url TEXT, file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, page_count INTEGER, parse_status TEXT NOT NULL CHECK(parse_status IN ('ready','link_only')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((source_kind='pdf' AND file_id IS NOT NULL AND text_content IS NOT NULL AND source_url IS NULL AND page_count>0 AND parse_status='ready') OR (source_kind='wechat_text' AND file_id IS NULL AND text_content IS NOT NULL AND source_url IS NULL AND page_count IS NULL AND parse_status='ready') OR (source_kind='feishu_link' AND file_id IS NULL AND text_content IS NULL AND source_url IS NOT NULL AND page_count IS NULL AND parse_status='link_only')))`,
    `CREATE INDEX IF NOT EXISTS project_materials_project_idx ON project_materials(project_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS project_materials_role_idx ON project_materials(project_id,role)`
  ]
}, {
  id: '0028_stage_time_records',
  statements: [
    `CREATE TABLE IF NOT EXISTS stage_time_records (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_key TEXT NOT NULL CHECK(stage_key IN ('materials','outline','script','production','publishing','feedback','versions')), status TEXT NOT NULL CHECK(status IN ('not_started','in_progress','completed','skipped')), started_date TEXT, started_segment TEXT CHECK(started_segment IN ('morning','afternoon','evening')), completed_date TEXT, completed_segment TEXT CHECK(completed_segment IN ('morning','afternoon','evening')), start_source TEXT CHECK(start_source IN ('automatic','manual','backfill')), completion_source TEXT CHECK(completion_source IN ('automatic','manual','backfill')), actual_effort_half_day_units INTEGER CHECK(actual_effort_half_day_units IS NULL OR (actual_effort_half_day_units>=1 AND actual_effort_half_day_units<=200)), auto_start_action_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((started_date IS NULL)=(started_segment IS NULL)), CHECK((completed_date IS NULL)=(completed_segment IS NULL)), CHECK((started_date IS NULL)=(start_source IS NULL)), CHECK((completed_date IS NULL)=(completion_source IS NULL)), UNIQUE(project_id,stage_key))`,
    `CREATE INDEX IF NOT EXISTS stage_time_records_project_idx ON stage_time_records(project_id,stage_key)`,
    `CREATE TABLE IF NOT EXISTS stage_time_events (id TEXT PRIMARY KEY NOT NULL, record_id TEXT NOT NULL REFERENCES stage_time_records(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_key TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('auto_start','complete','update','skip','reopen','undo')), before_json TEXT NOT NULL, after_json TEXT NOT NULL, actor TEXT NOT NULL CHECK(actor IN ('user','system')), source TEXT NOT NULL CHECK(source IN ('automatic','manual','backfill')), recorded_at TEXT NOT NULL, undone_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS stage_time_events_record_idx ON stage_time_events(record_id,recorded_at)`,
    `INSERT OR IGNORE INTO stage_time_records(id,project_id,stage_key,status,started_date,started_segment,completed_date,completed_segment,start_source,completion_source,actual_effort_half_day_units,auto_start_action_id,created_at,updated_at) SELECT project_id||':'||module_key,project_id,module_key,CASE WHEN completed_at IS NULL THEN 'not_started' ELSE 'completed' END,NULL,NULL,CASE WHEN completed_at IS NULL THEN NULL WHEN CAST(strftime('%H',completed_at,'localtime') AS INTEGER)<4 THEN date(completed_at,'localtime','-1 day') ELSE date(completed_at,'localtime') END,CASE WHEN completed_at IS NULL THEN NULL WHEN CAST(strftime('%H',completed_at,'localtime') AS INTEGER)<4 THEN 'evening' WHEN CAST(strftime('%H',completed_at,'localtime') AS INTEGER)<12 THEN 'morning' WHEN CAST(strftime('%H',completed_at,'localtime') AS INTEGER)<18 THEN 'afternoon' ELSE 'evening' END,NULL,CASE WHEN completed_at IS NULL THEN NULL ELSE 'manual' END,NULL,NULL,COALESCE(completed_at,datetime('now')),COALESCE(completed_at,datetime('now')) FROM project_modules WHERE module_key<>'overview'`
  ]
}, {
  id: '0029_creation_report_snapshots',
  statements: [
    `CREATE TABLE IF NOT EXISTS creation_report_snapshots (id TEXT PRIMARY KEY NOT NULL, report_kind TEXT NOT NULL CHECK(report_kind IN ('weekly','monthly')), period_start TEXT NOT NULL, period_end TEXT NOT NULL, input_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, generated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS creation_report_period_idx ON creation_report_snapshots(report_kind,period_start,generated_at)`,
    `CREATE INDEX IF NOT EXISTS creation_report_input_idx ON creation_report_snapshots(report_kind,period_start,input_hash)`
  ]
}, {
  id: '0030_creation_report_conversations',
  statements: [
    `CREATE TABLE IF NOT EXISTS creation_report_threads (id TEXT PRIMARY KEY NOT NULL, report_snapshot_id TEXT NOT NULL REFERENCES creation_report_snapshots(id) ON DELETE CASCADE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS creation_report_threads_snapshot_unique ON creation_report_threads(report_snapshot_id)`,
    `CREATE INDEX IF NOT EXISTS creation_report_threads_updated_idx ON creation_report_threads(updated_at)`,
    `CREATE TABLE IF NOT EXISTS creation_report_messages (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL REFERENCES creation_report_threads(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('codex_cli','claude_cli')), task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS creation_report_messages_thread_idx ON creation_report_messages(thread_id,created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS creation_report_messages_task_role_unique ON creation_report_messages(task_id,role)`
  ]
}, {
  id: '0031_mobile_capture_sync',
  statements: [
    `CREATE TABLE IF NOT EXISTS mobile_sync_devices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, encrypted_secret TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS mobile_sync_devices_active_idx ON mobile_sync_devices(revoked_at,created_at)`,
    `CREATE TABLE IF NOT EXISTS mobile_capture_receipts (device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE, mobile_capture_id TEXT NOT NULL, capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE, received_at TEXT NOT NULL, PRIMARY KEY(device_id,mobile_capture_id))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mobile_capture_receipts_capture_unique ON mobile_capture_receipts(capture_id)`,
    `CREATE INDEX IF NOT EXISTS mobile_capture_receipts_received_idx ON mobile_capture_receipts(received_at)`
  ]
}, {
  id: '0032_business_ledger',
  statements: [
    `CREATE TABLE IF NOT EXISTS business_records (project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE, order_platform TEXT NOT NULL DEFAULT '', order_date TEXT, quoted_amount_cents INTEGER CHECK(quoted_amount_cents IS NULL OR quoted_amount_cents>=0), platform_order_amount_cents INTEGER CHECK(platform_order_amount_cents IS NULL OR platform_order_amount_cents>=0), final_rebate_rate_percent REAL CHECK(final_rebate_rate_percent IS NULL OR (final_rebate_rate_percent>=0 AND final_rebate_rate_percent<=100)), final_rebate_amount_cents INTEGER CHECK(final_rebate_amount_cents IS NULL OR final_rebate_amount_cents>=0), rebate_requirement TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK(rebate_requirement IN ('pending_confirmation','not_required','required')), rebate_recipient_type TEXT NOT NULL DEFAULT 'unknown' CHECK(rebate_recipient_type IN ('unknown','corporate','personal')), rebate_recipient_name TEXT NOT NULL DEFAULT '', rebate_procedure_status TEXT NOT NULL DEFAULT 'preparing' CHECK(rebate_procedure_status IN ('not_required','preparing','incomplete','complete')), planned_rebate_date TEXT, invoice_requirement TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK(invoice_requirement IN ('pending_confirmation','not_required','required')), video_production_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(video_production_cost_cents>=0), traffic_promotion_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(traffic_promotion_cost_cents>=0), income_attribution_date TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS business_records_income_date_idx ON business_records(income_attribution_date,order_date)`,
    `CREATE TABLE IF NOT EXISTS rebate_payments (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), paid_date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS rebate_payments_project_date_idx ON rebate_payments(project_id,paid_date)`,
    `CREATE TABLE IF NOT EXISTS business_invoices (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), issued_date TEXT, status TEXT NOT NULL CHECK(status IN ('pending','issued','voided','red_flushed')), delivered_to_client INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS business_invoices_project_date_idx ON business_invoices(project_id,issued_date)`,
    `CREATE TABLE IF NOT EXISTS business_files (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('rebate_contract','invoice_file','rebate_payment_proof')), file_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, rebate_payment_id TEXT REFERENCES rebate_payments(id) ON DELETE SET NULL, invoice_id TEXT REFERENCES business_invoices(id) ON DELETE SET NULL, created_at TEXT NOT NULL, CHECK(role='rebate_payment_proof' OR rebate_payment_id IS NULL), CHECK(role='invoice_file' OR invoice_id IS NULL))`,
    `CREATE INDEX IF NOT EXISTS business_files_project_role_idx ON business_files(project_id,role)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS business_files_file_unique ON business_files(file_id)`,
    `UPDATE project_templates SET module_keys_json='["materials","outline","script","production","publishing","business","feedback"]',description='包含Brief、大纲、文案、制作、发布、商单商务与反馈。',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='template-commercial'`,
    `UPDATE project_modules SET position=position+1 WHERE project_id IN (SELECT id FROM projects WHERE content_type_id='type-commercial') AND position>=6`,
    `INSERT OR IGNORE INTO project_modules(project_id,module_key,enabled,position,disabled_at,last_changed_by,content_root_id) SELECT id,'business',1,6,NULL,'system',lower(hex(randomblob(16))) FROM projects WHERE content_type_id='type-commercial'`
  ]
}, {
  id: '0033_project_material_source_locator',
  statements: [
    `ALTER TABLE file_references ADD COLUMN encrypted_source_path TEXT`
  ]
}, {
  id: '0034_script_revision_conversations',
  statements: [
    `CREATE TABLE IF NOT EXISTS script_revision_threads (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, base_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, provider TEXT NOT NULL CHECK(provider IN ('codex_cli','claude_cli')), provider_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS script_revision_threads_project_idx ON script_revision_threads(project_id,updated_at)`,
    `CREATE INDEX IF NOT EXISTS script_revision_threads_base_version_idx ON script_revision_threads(base_version_id)`,
    `CREATE TABLE IF NOT EXISTS script_revision_messages (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL REFERENCES script_revision_threads(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('codex_cli','claude_cli')), selected_text TEXT, selection_hash TEXT, selection_snapshot_json TEXT, suggestion_json TEXT, suggestion_status TEXT CHECK(suggestion_status IS NULL OR suggestion_status IN ('pending','applied','copied','discarded')), suggestion_decided_at TEXT, task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, context_snapshot_json TEXT, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS script_revision_messages_thread_idx ON script_revision_messages(thread_id,created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS script_revision_messages_task_role_unique ON script_revision_messages(task_id,role)`
  ]
}, {
  id: '0035_unified_attachment_foundation',
  statements: [
    `ALTER TABLE projects ADD COLUMN reference_requirements TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE file_references ADD COLUMN kind TEXT NOT NULL DEFAULT 'file' CHECK(kind IN ('file','folder'))`,
    `ALTER TABLE file_references ADD COLUMN managed_locator TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE file_references ADD COLUMN source_bookmark TEXT`,
    `ALTER TABLE file_references ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'managed_import' CHECK(source_origin IN ('finder_drop','file_picker','mobile_android','managed_import','generated'))`,
    `ALTER TABLE file_references ADD COLUMN availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','source_missing','permission_required','failed'))`,
    `ALTER TABLE file_references ADD COLUMN process_state TEXT NOT NULL DEFAULT 'ready' CHECK(process_state IN ('pending','ready','failed','stored_only'))`,
    `ALTER TABLE file_references ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE file_references ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`,
    `UPDATE file_references SET managed_locator=relative_path,source_bookmark=encrypted_source_path,source_origin=CASE WHEN encrypted_source_path IS NULL THEN 'managed_import' ELSE 'file_picker' END,capabilities_json=CASE WHEN mime_type='application/pdf' THEN '["preview","parse"]' WHEN mime_type LIKE 'image/%' THEN '["preview","ocr"]' WHEN mime_type LIKE 'audio/%' THEN '["preview","transcribe"]' ELSE '["preview"]' END,updated_at=created_at`,
    `CREATE UNIQUE INDEX IF NOT EXISTS file_references_managed_locator_unique ON file_references(managed_locator) WHERE managed_locator<>''`,
    `CREATE INDEX IF NOT EXISTS file_references_sha256_idx ON file_references(sha256,kind)`,
    `DROP INDEX IF EXISTS project_materials_project_idx`,
    `DROP INDEX IF EXISTS project_materials_role_idx`,
    `ALTER TABLE project_materials RENAME TO project_materials_0035_legacy`,
    `CREATE TABLE project_materials (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('brief','project_material')), source_kind TEXT NOT NULL CHECK(source_kind IN ('file','folder','text','link')), title TEXT NOT NULL, text_content TEXT, source_url TEXT, file_reference_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, page_count INTEGER, parse_status TEXT NOT NULL CHECK(parse_status IN ('pending','ready','failed','stored_only','link_only')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((source_kind IN ('file','folder') AND file_reference_id IS NOT NULL AND source_url IS NULL) OR (source_kind='text' AND file_reference_id IS NULL AND text_content IS NOT NULL AND source_url IS NULL) OR (source_kind='link' AND file_reference_id IS NULL AND source_url IS NOT NULL)))`,
    `INSERT INTO project_materials(id,project_id,role,source_kind,title,text_content,source_url,file_reference_id,page_count,parse_status,created_at,updated_at) SELECT id,project_id,role,CASE source_kind WHEN 'pdf' THEN 'file' WHEN 'wechat_text' THEN 'text' WHEN 'feishu_link' THEN 'link' ELSE source_kind END,title,text_content,source_url,file_id,page_count,parse_status,created_at,updated_at FROM project_materials_0035_legacy`,
    `DROP TABLE project_materials_0035_legacy`,
    `CREATE INDEX project_materials_project_idx ON project_materials(project_id,created_at)`,
    `CREATE INDEX project_materials_role_idx ON project_materials(project_id,role)`,
    `CREATE TABLE project_asset_links (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, project_material_id TEXT NOT NULL REFERENCES project_materials(id) ON DELETE CASCADE, file_reference_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, parent_link_id TEXT REFERENCES project_asset_links(id) ON DELETE CASCADE, relative_path TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0), usage_type TEXT CHECK(usage_type IS NULL OR usage_type IN ('opinion','parameter_fact','material_clue')), is_primary_reference INTEGER NOT NULL DEFAULT 0 CHECK(is_primary_reference IN (0,1)), attention_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_material_id,file_reference_id), UNIQUE(project_material_id,relative_path))`,
    `CREATE INDEX project_asset_links_project_idx ON project_asset_links(project_id,position)`,
    `CREATE INDEX project_asset_links_parent_idx ON project_asset_links(parent_link_id,position)`,
    `CREATE INDEX project_asset_links_primary_idx ON project_asset_links(project_id,is_primary_reference,position)`,
    `INSERT INTO project_asset_links(id,project_id,project_material_id,file_reference_id,parent_link_id,relative_path,position,usage_type,is_primary_reference,attention_note,created_at,updated_at) SELECT pm.id||':asset',pm.project_id,pm.id,pm.file_reference_id,NULL,fr.original_name,ROW_NUMBER() OVER (PARTITION BY pm.project_id ORDER BY pm.created_at,pm.id)-1,NULL,0,'',pm.created_at,pm.updated_at FROM project_materials pm JOIN file_references fr ON fr.id=pm.file_reference_id WHERE pm.file_reference_id IS NOT NULL`,
    `CREATE TABLE capture_asset_links (id TEXT PRIMARY KEY NOT NULL, capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE, file_reference_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('image','audio','pdf','word','file')), position INTEGER NOT NULL CHECK(position>=0), created_at TEXT NOT NULL, UNIQUE(capture_id,file_reference_id), UNIQUE(capture_id,position))`,
    `CREATE INDEX capture_asset_links_capture_idx ON capture_asset_links(capture_id,position)`,
    `CREATE TABLE asset_upload_sessions (id TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE, mobile_capture_id TEXT NOT NULL, protocol_version INTEGER NOT NULL CHECK(protocol_version>=2), expected_attachment_count INTEGER NOT NULL CHECK(expected_attachment_count>=0), capture_kind_hint TEXT NOT NULL DEFAULT 'unknown', original_content TEXT NOT NULL DEFAULT '', capture_created_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('receiving','assembling','ready_to_commit','committed','failed','expired')), committed_capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL, failure_code TEXT, failure_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE(device_id,mobile_capture_id))`,
    `CREATE INDEX asset_upload_sessions_state_expiry_idx ON asset_upload_sessions(state,expires_at)`,
    `CREATE TABLE asset_upload_attachments (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES asset_upload_sessions(id) ON DELETE CASCADE, attachment_id TEXT NOT NULL, attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('image','audio','pdf','word','file')), name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>=0), sha256 TEXT NOT NULL, chunk_count INTEGER NOT NULL CHECK(chunk_count>0), received_count INTEGER NOT NULL DEFAULT 0 CHECK(received_count>=0 AND received_count<=chunk_count), relative_path TEXT, state TEXT NOT NULL CHECK(state IN ('receiving','complete','assembling','assembled','failed')), assembled_locator TEXT, failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id,attachment_id))`,
    `CREATE INDEX asset_upload_attachments_session_idx ON asset_upload_attachments(session_id,state)`,
    `CREATE TABLE asset_upload_chunks (upload_attachment_id TEXT NOT NULL REFERENCES asset_upload_attachments(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL CHECK(chunk_index>=0), byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL, nonce TEXT NOT NULL, auth_tag TEXT NOT NULL, staged_locator TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(upload_attachment_id,chunk_index))`,
    `CREATE INDEX asset_upload_chunks_attachment_idx ON asset_upload_chunks(upload_attachment_id,chunk_index)`
  ]
}, {
  id: '0036_mobile_sync_protocol_v2',
  statements: [
    `ALTER TABLE mobile_sync_devices ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1 CHECK(protocol_version IN (1,2))`,
    `ALTER TABLE mobile_sync_devices ADD COLUMN identity_public_key TEXT`,
    `ALTER TABLE mobile_sync_devices ADD COLUMN trust_state TEXT NOT NULL DEFAULT 'legacy_v1' CHECK(trust_state IN ('legacy_v1','trusted_v2'))`,
    `ALTER TABLE mobile_sync_devices ADD COLUMN upgraded_at TEXT`,
    `CREATE INDEX mobile_sync_devices_protocol_idx ON mobile_sync_devices(protocol_version,trust_state,revoked_at)`
  ]
}, {
  id: '0037_production_outputs_and_publishing_handoffs',
  statements: [
    `CREATE TABLE cover_candidates (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, platform TEXT NOT NULL, layout TEXT NOT NULL CHECK(layout IN ('bilibili_landscape','xiaohongshu_portrait')), generation_mode TEXT NOT NULL CHECK(generation_mode IN ('ai_finished','stable_layers')), headline TEXT NOT NULL DEFAULT '', prompt_snapshot TEXT NOT NULL, source_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), is_selected INTEGER NOT NULL DEFAULT 0 CHECK(is_selected IN (0,1)), created_at TEXT NOT NULL, UNIQUE(task_id,position))`,
    `CREATE INDEX cover_candidates_project_platform_idx ON cover_candidates(project_id,platform,created_at)`,
    `CREATE TABLE title_candidates (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, platform TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('codex_cli','claude_cli')), angle TEXT NOT NULL, title TEXT NOT NULL, cover_text TEXT NOT NULL, source_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE, is_selected INTEGER NOT NULL DEFAULT 0 CHECK(is_selected IN (0,1)), created_at TEXT NOT NULL)`,
    `CREATE INDEX title_candidates_project_platform_idx ON title_candidates(project_id,platform,created_at)`,
    `CREATE INDEX title_candidates_task_idx ON title_candidates(task_id)`,
    `CREATE TABLE subtitle_jobs (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, input_file_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE RESTRICT, schema TEXT NOT NULL CHECK(schema IN ('zh','bilingual')), engine TEXT NOT NULL, language TEXT, source_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, transcript_json TEXT, anomalies_json TEXT NOT NULL DEFAULT '[]', style_preset_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(task_id))`,
    `CREATE INDEX subtitle_jobs_project_idx ON subtitle_jobs(project_id,created_at)`,
    `CREATE TABLE subtitle_artifacts (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL REFERENCES subtitle_jobs(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('zh_srt','bilingual_srt','plain_transcript')), created_at TEXT NOT NULL, UNIQUE(job_id,artifact_kind))`,
    `CREATE INDEX subtitle_artifacts_project_idx ON subtitle_artifacts(project_id,created_at)`,
    `CREATE TABLE publishing_handoffs (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, platform TEXT NOT NULL, adapter_id TEXT NOT NULL, target_url TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','opened','confirmed','failed')), package_snapshot_json TEXT NOT NULL, checklist_json TEXT NOT NULL, issues_json TEXT NOT NULL, opened_at TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX publishing_handoffs_project_platform_idx ON publishing_handoffs(project_id,platform,created_at)`
  ]
}, {
  id: '0038_topic_project_lifecycle',
  statements: [
    `ALTER TABLE topics ADD COLUMN last_project_deleted_at TEXT`,
    `ALTER TABLE topic_stage_definitions ADD COLUMN system_role TEXT CHECK(system_role IS NULL OR system_role IN ('project_created','completed','archived','shelved'))`,
    `UPDATE topic_stage_definitions SET system_role=CASE role WHEN 'project_created' THEN 'project_created' WHEN 'shelved' THEN 'shelved' ELSE NULL END`,
    `UPDATE topic_stage_definitions SET position=-position`,
    `UPDATE topic_stage_definitions AS current SET position=(SELECT COUNT(*)*10 FROM topic_stage_definitions AS candidate WHERE candidate.system_role IS NULL AND candidate.position>=current.position) WHERE current.system_role IS NULL`,
    `UPDATE topic_stage_definitions SET position=((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+1)*10 WHERE system_role='project_created'`,
    `UPDATE topic_stage_definitions SET position=((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+4)*10 WHERE system_role='shelved'`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,system_role,created_at,updated_at) VALUES('topic-stage-completed','已完成',((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+2)*10,'standard','completed',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    `INSERT OR IGNORE INTO topic_stage_definitions(id,name,position,role,system_role,created_at,updated_at) VALUES('topic-stage-archived','已归档',((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+3)*10,'standard','archived',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    `UPDATE topic_stage_definitions SET system_role='completed' WHERE name='已完成' AND system_role IS NULL AND NOT EXISTS(SELECT 1 FROM topic_stage_definitions WHERE system_role='completed')`,
    `UPDATE topic_stage_definitions SET system_role='archived' WHERE name='已归档' AND system_role IS NULL AND NOT EXISTS(SELECT 1 FROM topic_stage_definitions WHERE system_role='archived')`,
    `UPDATE topic_stage_definitions SET position=-position`,
    `UPDATE topic_stage_definitions AS current SET position=(SELECT COUNT(*)*10 FROM topic_stage_definitions AS candidate WHERE candidate.system_role IS NULL AND candidate.position>=current.position) WHERE current.system_role IS NULL`,
    `UPDATE topic_stage_definitions SET position=((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+1)*10 WHERE system_role='project_created'`,
    `UPDATE topic_stage_definitions SET position=((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+2)*10 WHERE system_role='completed'`,
    `UPDATE topic_stage_definitions SET position=((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+3)*10 WHERE system_role='archived'`,
    `UPDATE topic_stage_definitions SET position=((SELECT COUNT(*) FROM topic_stage_definitions WHERE system_role IS NULL)+4)*10 WHERE system_role='shelved'`,
    `CREATE UNIQUE INDEX topic_stage_definitions_system_role_unique ON topic_stage_definitions(system_role) WHERE system_role IS NOT NULL`,
    `UPDATE topics SET created_project_id=NULL,stage_id=(SELECT id FROM topic_stage_definitions WHERE system_role='shelved'),status='shelved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_project_id IS NOT NULL AND rowid NOT IN (SELECT MIN(rowid) FROM topics WHERE created_project_id IS NOT NULL GROUP BY created_project_id)`,
    `UPDATE topics SET stage_id=CASE WHEN EXISTS(SELECT 1 FROM projects p WHERE p.id=topics.created_project_id AND p.trashed_at IS NOT NULL) THEN (SELECT id FROM topic_stage_definitions WHERE system_role='shelved') WHEN EXISTS(SELECT 1 FROM projects p WHERE p.id=topics.created_project_id AND p.status='archived') THEN (SELECT id FROM topic_stage_definitions WHERE system_role='archived') ELSE (SELECT id FROM topic_stage_definitions WHERE system_role='project_created') END,status=CASE WHEN EXISTS(SELECT 1 FROM projects p WHERE p.id=topics.created_project_id AND p.trashed_at IS NOT NULL) THEN 'shelved' WHEN EXISTS(SELECT 1 FROM projects p WHERE p.id=topics.created_project_id AND p.status='archived') THEN 'archived' ELSE 'created' END,trashed_at=NULL WHERE created_project_id IS NOT NULL`,
    `INSERT INTO topics(id,title,core_angle,content_type_id,priority,needs_more_experience,planned_window,start_at,deadline_at,actual_completion_at,next_action,stage_id,status,source_capture_ids_json,created_project_id,created_at,updated_at,trashed_at) SELECT 'topic-project-'||lower(hex(randomblob(16))),p.title,p.description,p.content_type_id,0,0,NULL,NULL,NULL,NULL,'',CASE WHEN p.trashed_at IS NOT NULL THEN (SELECT id FROM topic_stage_definitions WHERE system_role='shelved') WHEN p.status='archived' THEN (SELECT id FROM topic_stage_definitions WHERE system_role='archived') ELSE (SELECT id FROM topic_stage_definitions WHERE system_role='project_created') END,CASE WHEN p.trashed_at IS NOT NULL THEN 'shelved' WHEN p.status='archived' THEN 'archived' ELSE 'created' END,'[]',p.id,p.created_at,p.updated_at,NULL FROM projects p WHERE NOT EXISTS(SELECT 1 FROM topics t WHERE t.created_project_id=p.id)`,
    `UPDATE topics SET stage_id=(SELECT id FROM topic_stage_definitions WHERE system_role='shelved'),status='shelved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_project_id IS NULL AND stage_id=(SELECT id FROM topic_stage_definitions WHERE system_role='project_created')`,
    `CREATE UNIQUE INDEX topics_created_project_unique ON topics(created_project_id) WHERE created_project_id IS NOT NULL`
  ]
}, {
  id: '0039_operation_log',
  statements: [
    `CREATE TABLE operation_log (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, request_id TEXT NOT NULL, command_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, label TEXT NOT NULL, forward_payload_json TEXT NOT NULL, result_json TEXT, inverse_payload_json TEXT, inverse_payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK(inverse_payload_bytes>=0), status TEXT NOT NULL CHECK(status IN ('undoable','undone','audit_only','conflicted')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, undone_at TEXT, redone_at TEXT, expires_at TEXT)`,
    `CREATE UNIQUE INDEX operation_log_request_unique ON operation_log(request_id)`,
    `CREATE INDEX operation_log_session_status_idx ON operation_log(session_id,status,created_at)`,
    `CREATE INDEX operation_log_status_expiry_idx ON operation_log(status,expires_at)`,
    `CREATE INDEX operation_log_entity_idx ON operation_log(entity_type,entity_id,status)`
  ]
}, {
  id: '0040_bilingual_ass_subtitle_artifacts',
  statements: [
    `ALTER TABLE title_candidates ADD COLUMN master_title_snapshot TEXT`,
    `ALTER TABLE subtitle_artifacts RENAME TO subtitle_artifacts_0039_legacy`,
    `CREATE TABLE subtitle_artifacts (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL REFERENCES subtitle_jobs(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('zh_srt','bilingual_srt','bilingual_ass','plain_transcript')), created_at TEXT NOT NULL, UNIQUE(job_id,artifact_kind))`,
    `INSERT INTO subtitle_artifacts(id,job_id,project_id,file_id,artifact_kind,created_at) SELECT id,job_id,project_id,file_id,artifact_kind,created_at FROM subtitle_artifacts_0039_legacy`,
    `DROP TABLE subtitle_artifacts_0039_legacy`,
    `CREATE INDEX subtitle_artifacts_project_idx ON subtitle_artifacts(project_id,created_at)`,
    `ALTER TABLE subtitle_jobs ADD COLUMN confirmed_zh_artifact_id TEXT REFERENCES subtitle_artifacts(id) ON DELETE SET NULL`
  ]
}, {
  id: '0041_ai_topic_screening',
  statements: [
    `ALTER TABLE conversation_filter_candidates RENAME TO conversation_filter_candidates_0040_legacy`,
    `CREATE TABLE conversation_filter_candidates (id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, candidate_key TEXT NOT NULL, atom_type TEXT NOT NULL CHECK(atom_type IN ('story','method','viewpoint','comparison','pitfall','verifiable_fact')), theme_title TEXT NOT NULL, theme_key TEXT NOT NULL, direction_title TEXT NOT NULL, direction_key TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, value_reason TEXT NOT NULL, risk_notes_json TEXT NOT NULL DEFAULT '[]', source_refs_json TEXT NOT NULL, approximate_duplicate_group_key TEXT, content_hash TEXT NOT NULL, review_group TEXT NOT NULL CHECK(review_group IN ('recommended','needs_judgment','not_topic')), similarities_json TEXT NOT NULL DEFAULT '[]', source_occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(source_occurrence_count>0), suppression_kind TEXT CHECK(suppression_kind IN ('discarded','done')), status TEXT NOT NULL CHECK(status IN ('review_pending','confirmed','parked','discarded','not_topic')), destination_kind TEXT CHECK(destination_kind IN ('content_inspiration','topic','project')), destination_id TEXT, parked_at TEXT, discarded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `INSERT INTO conversation_filter_candidates(id,task_id,candidate_key,atom_type,theme_title,theme_key,direction_title,direction_key,title,content,value_reason,risk_notes_json,source_refs_json,approximate_duplicate_group_key,content_hash,review_group,similarities_json,source_occurrence_count,suppression_kind,status,destination_kind,destination_id,parked_at,discarded_at,created_at,updated_at) SELECT id,task_id,candidate_key,atom_type,title,lower(hex(randomblob(8))),title,lower(hex(randomblob(8))),title,content,value_reason,risk_notes_json,source_refs_json,approximate_duplicate_group_key,content_hash,'needs_judgment','[]',1,CASE WHEN status='discarded' THEN 'discarded' ELSE NULL END,CASE WHEN status='discarded' THEN 'discarded' WHEN status='kept' AND destination_kind IS NOT NULL THEN 'confirmed' ELSE 'review_pending' END,destination_kind,destination_id,NULL,CASE WHEN status='discarded' THEN updated_at ELSE NULL END,created_at,updated_at FROM conversation_filter_candidates_0040_legacy`,
    `DROP TABLE conversation_filter_candidates_0040_legacy`,
    `CREATE INDEX conversation_filter_candidates_task_idx ON conversation_filter_candidates(task_id,created_at)`,
    `CREATE INDEX conversation_filter_candidates_status_idx ON conversation_filter_candidates(status,updated_at)`,
    `CREATE INDEX conversation_filter_candidates_hash_idx ON conversation_filter_candidates(content_hash)`,
    `CREATE INDEX conversation_filter_candidates_direction_idx ON conversation_filter_candidates(theme_key,direction_key,status)`,
    `CREATE TABLE conversation_scan_source_state (source_id TEXT PRIMARY KEY NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('codex','claude')), source_updated_at TEXT NOT NULL, last_scanned_offset INTEGER NOT NULL DEFAULT 0 CHECK(last_scanned_offset>=0), last_message_timestamp TEXT, last_content_hash TEXT NOT NULL, scan_status TEXT NOT NULL DEFAULT 'completed' CHECK(scan_status IN ('completed','reset_required')), last_task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE, last_scanned_at TEXT NOT NULL)`,
    `CREATE INDEX conversation_scan_source_state_updated_idx ON conversation_scan_source_state(source_kind,source_updated_at)`,
    `CREATE TABLE topic_directions (id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, theme_title TEXT NOT NULL, theme_key TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, source_refs_json TEXT NOT NULL DEFAULT '[]', source_candidate_id TEXT REFERENCES conversation_filter_candidates(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX topic_directions_topic_idx ON topic_directions(topic_id,is_primary,created_at)`,
    `CREATE INDEX topic_directions_theme_idx ON topic_directions(theme_key,title)`
  ]
}, {
  id: '0042_feishu_handoffs',
  statements: [
    `CREATE TABLE feishu_handoffs (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE RESTRICT, target_handoff_id TEXT, mode TEXT NOT NULL CHECK(mode IN ('new_document','merge_update')), account_name TEXT NOT NULL, document_url TEXT, content_sha256 TEXT NOT NULL, copied_at TEXT, word_exported_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX feishu_handoffs_project_updated_idx ON feishu_handoffs(project_id,updated_at)`,
    `CREATE INDEX feishu_handoffs_project_url_idx ON feishu_handoffs(project_id,document_url)`,
    `CREATE INDEX feishu_handoffs_target_idx ON feishu_handoffs(target_handoff_id)`
  ]
}, {
  id: '0043_nas_archive_runs',
  statements: [
    `CREATE TABLE archive_sequences (category TEXT NOT NULL, year INTEGER NOT NULL, next_sequence INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(category,year))`,
    `CREATE TABLE project_archive_identities (project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE, category TEXT NOT NULL CHECK(category IN ('long_video','short_video','ai_video')), year INTEGER NOT NULL, sequence INTEGER NOT NULL, category_label TEXT NOT NULL, relative_directory TEXT NOT NULL, commercial_snapshot INTEGER NOT NULL, title_snapshot TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX project_archive_identity_number_unique ON project_archive_identities(category,year,sequence)`,
    `CREATE TABLE project_archive_slots (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, slot TEXT NOT NULL CHECK(slot IN ('landscape_cover','portrait_cover','business_files','subtitle_srt','video_clean','video_burned_in','final_script_docx')), selection_status TEXT NOT NULL CHECK(selection_status IN ('selected','not_required','not_ready')), file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,slot))`,
    `CREATE INDEX project_archive_slots_file_idx ON project_archive_slots(file_id)`,
    `CREATE TABLE archive_runs (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT, destination_id TEXT NOT NULL, destination_revision TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('long_video','short_video','ai_video')), category_label TEXT NOT NULL, year INTEGER NOT NULL, sequence INTEGER NOT NULL, folder_name TEXT NOT NULL, relative_directory TEXT NOT NULL, commercial_snapshot INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','copying','verifying','committed','waiting_for_nas','failed','canceled')), plan_hash TEXT NOT NULL, confirmed_at TEXT NOT NULL, manifest_sha256 TEXT, manifest_relative_path TEXT, missing_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)`,
    `CREATE UNIQUE INDEX archive_runs_task_unique ON archive_runs(task_run_id)`,
    `CREATE INDEX archive_runs_project_created_idx ON archive_runs(project_id,created_at)`,
    `CREATE INDEX archive_runs_status_idx ON archive_runs(status,updated_at)`,
    `CREATE TABLE archive_items (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES archive_runs(id) ON DELETE CASCADE, slot TEXT NOT NULL CHECK(slot IN ('landscape_cover','portrait_cover','business_files','subtitle_srt','video_clean','video_burned_in','final_script_docx')), ordinal INTEGER NOT NULL, selection_status TEXT NOT NULL CHECK(selection_status IN ('selected','not_required','not_ready')), source_file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, source_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, source_name TEXT NOT NULL, source_locator TEXT, source_origin TEXT, size_bytes INTEGER, source_sha256 TEXT, target_sha256 TEXT, temporary_relative_path TEXT, final_relative_path TEXT, status TEXT NOT NULL CHECK(status IN ('pending','copying','verifying','committed','missing','not_required','failed','canceled')), error_code TEXT, temporary_removed INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX archive_items_run_slot_ordinal_unique ON archive_items(run_id,slot,ordinal)`,
    `CREATE INDEX archive_items_run_status_idx ON archive_items(run_id,status)`,
    `CREATE TABLE nas_backup_state (id TEXT PRIMARY KEY NOT NULL CHECK(id='primary'), status TEXT NOT NULL CHECK(status IN ('idle','running','succeeded','failed')), backup_date TEXT, last_attempt_at TEXT, last_succeeded_at TEXT, error_message TEXT, updated_at TEXT NOT NULL)`,
    `INSERT INTO nas_backup_state(id,status,updated_at) VALUES('primary','idle',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ]
}, {
  id: '0044_publishing_accounts',
  statements: [
    `ALTER TABLE project_publishing_materials RENAME TO project_publishing_materials_0043_legacy`,
    `CREATE TABLE project_publishing_materials (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, platform TEXT NOT NULL, material_kind TEXT NOT NULL CHECK(material_kind IN ('title','description','cover','tags','subtitle','video')), text_value TEXT, file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, source_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((material_kind IN ('title','description','tags') AND file_id IS NULL) OR (material_kind IN ('cover','subtitle','video') AND text_value IS NULL)))`,
    `INSERT INTO project_publishing_materials(id,project_id,platform,material_kind,text_value,file_id,source_version_id,revision,created_at,updated_at) SELECT id,project_id,platform,material_kind,text_value,file_id,source_version_id,revision,created_at,updated_at FROM project_publishing_materials_0043_legacy`,
    `DROP TABLE project_publishing_materials_0043_legacy`,
    `CREATE UNIQUE INDEX project_publishing_material_unique ON project_publishing_materials(project_id,platform,material_kind)`,
    `CREATE INDEX project_publishing_material_project_idx ON project_publishing_materials(project_id,platform)`,
    `CREATE TABLE publishing_accounts (id TEXT PRIMARY KEY NOT NULL, platform TEXT NOT NULL, account_name TEXT NOT NULL, positioning TEXT NOT NULL DEFAULT '', contact_ciphertext TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX publishing_accounts_platform_order_idx ON publishing_accounts(platform,sort_order,created_at)`,
    `CREATE UNIQUE INDEX publishing_accounts_platform_name_unique ON publishing_accounts(platform,account_name)`,
    `CREATE TABLE project_publishing_accounts (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, platform TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES publishing_accounts(id) ON DELETE RESTRICT, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,platform))`,
    `CREATE INDEX project_publishing_accounts_account_idx ON project_publishing_accounts(account_id)`
  ]
}, {
  id: '0045_distribution_batches',
  statements: [
    `CREATE TABLE distribution_batches (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('project_final','manual_script','subtitle')), source_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, source_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL, source_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed')), analysis_task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX distribution_batches_status_updated_idx ON distribution_batches(status,updated_at)`,
    `CREATE INDEX distribution_batches_project_idx ON distribution_batches(source_project_id,updated_at)`,
    `CREATE TABLE distribution_segments (id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL REFERENCES distribution_batches(id) ON DELETE CASCADE, position INTEGER NOT NULL, start_timecode TEXT NOT NULL, end_timecode TEXT NOT NULL, theme TEXT NOT NULL, summary TEXT NOT NULL, file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX distribution_segments_batch_position_unique ON distribution_segments(batch_id,position)`,
    `CREATE INDEX distribution_segments_file_idx ON distribution_segments(file_id)`,
    `CREATE TABLE distribution_targets (id TEXT PRIMARY KEY NOT NULL, segment_id TEXT NOT NULL REFERENCES distribution_segments(id) ON DELETE CASCADE, platform TEXT NOT NULL CHECK(platform<>'B站'), account_id TEXT NOT NULL REFERENCES publishing_accounts(id) ON DELETE RESTRICT, account_name_snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','skipped')), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX distribution_targets_segment_account_unique ON distribution_targets(segment_id,account_id)`,
    `CREATE INDEX distribution_targets_segment_status_idx ON distribution_targets(segment_id,status)`
  ]
}, {
  id: '0046_bilibili_computer_use_pilots',
  statements: [
    `CREATE TABLE publishing_computer_use_pilots (id TEXT PRIMARY KEY NOT NULL, handoff_id TEXT NOT NULL REFERENCES publishing_handoffs(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, platform TEXT NOT NULL CHECK(platform='B站'), status TEXT NOT NULL CHECK(status IN ('prepared','page_opened','ready_for_review','completed','failed','canceled')), account_name TEXT NOT NULL, clipboard_sha256 TEXT NOT NULL CHECK(length(clipboard_sha256)=64), last_error TEXT, opened_at TEXT, ready_for_review_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX publishing_computer_use_pilots_project_created_idx ON publishing_computer_use_pilots(project_id,created_at)`,
    `CREATE INDEX publishing_computer_use_pilots_handoff_status_idx ON publishing_computer_use_pilots(handoff_id,status)`
  ]
}, {
  id: '0047_drop_dead_topic_columns',
  statements: [
    // next_action自2026-07重构后恒为空串、planned_window恒为NULL且均无任何读取方；无索引或约束引用，可安全删除。
    `ALTER TABLE topics DROP COLUMN next_action`,
    `ALTER TABLE topics DROP COLUMN planned_window`
  ]
}, {
  id: '0048_topic_stage_next_action_label',
  statements: [
    `ALTER TABLE topic_stage_definitions ADD COLUMN next_action_label TEXT`,
    `UPDATE topic_stage_definitions SET next_action_label='进入待评估' WHERE id='topic-stage-new' AND system_role IS NULL`,
    `UPDATE topic_stage_definitions SET next_action_label='决定是否制作' WHERE id='topic-stage-evaluation' AND system_role IS NULL`,
    `UPDATE topic_stage_definitions SET next_action_label='建立内容项目' WHERE id='topic-stage-decided' AND system_role IS NULL`
  ]
}, {
  id: '0049_business_ledger_single_rebate',
  statements: [
    `ALTER TABLE business_records ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','received'))`,
    `ALTER TABLE business_records ADD COLUMN payment_received_date TEXT`,
    `INSERT INTO business_records(project_id,rebate_requirement,payment_status,created_at,updated_at) SELECT payment.project_id,'required','received',MIN(payment.created_at),MAX(payment.updated_at) FROM rebate_payments payment LEFT JOIN business_records record ON record.project_id=payment.project_id WHERE record.project_id IS NULL GROUP BY payment.project_id`,
    `UPDATE business_records SET payment_status='received',rebate_requirement=CASE WHEN rebate_requirement='pending_confirmation' THEN 'required' ELSE rebate_requirement END WHERE project_id IN (SELECT DISTINCT project_id FROM rebate_payments)`,
    `CREATE TABLE rebate_payment_migration_audit (original_payment_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, canonical_payment_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, paid_date TEXT NOT NULL, notes TEXT NOT NULL, original_created_at TEXT NOT NULL, original_updated_at TEXT NOT NULL, migrated_at TEXT NOT NULL)`,
    `CREATE INDEX rebate_payment_migration_audit_project_idx ON rebate_payment_migration_audit(project_id,migrated_at)`,
    `INSERT INTO rebate_payment_migration_audit(original_payment_id,project_id,canonical_payment_id,amount_cents,paid_date,notes,original_created_at,original_updated_at,migrated_at) SELECT payment.id,payment.project_id,(SELECT canonical.id FROM rebate_payments canonical WHERE canonical.project_id=payment.project_id ORDER BY canonical.created_at,canonical.id LIMIT 1),payment.amount_cents,payment.paid_date,payment.notes,payment.created_at,payment.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM rebate_payments payment WHERE (SELECT COUNT(*) FROM rebate_payments grouped WHERE grouped.project_id=payment.project_id)>1`,
    `UPDATE business_files SET rebate_payment_id=(SELECT canonical.id FROM rebate_payments canonical WHERE canonical.project_id=business_files.project_id ORDER BY canonical.created_at,canonical.id LIMIT 1) WHERE rebate_payment_id IS NOT NULL AND (SELECT COUNT(*) FROM rebate_payments grouped WHERE grouped.project_id=business_files.project_id)>1`,
    `UPDATE rebate_payments AS canonical SET amount_cents=(SELECT SUM(history.amount_cents) FROM rebate_payments history WHERE history.project_id=canonical.project_id),paid_date=(SELECT MAX(history.paid_date) FROM rebate_payments history WHERE history.project_id=canonical.project_id),notes=CASE WHEN canonical.notes='' THEN '由历史多笔返点合并；原始记录已保留审计' ELSE canonical.notes||char(10)||'由历史多笔返点合并；原始记录已保留审计' END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE canonical.id=(SELECT first_payment.id FROM rebate_payments first_payment WHERE first_payment.project_id=canonical.project_id ORDER BY first_payment.created_at,first_payment.id LIMIT 1) AND (SELECT COUNT(*) FROM rebate_payments grouped WHERE grouped.project_id=canonical.project_id)>1`,
    `DELETE FROM rebate_payments WHERE id<>(SELECT canonical.id FROM rebate_payments canonical WHERE canonical.project_id=rebate_payments.project_id ORDER BY canonical.created_at,canonical.id LIMIT 1)`,
    `CREATE UNIQUE INDEX rebate_payments_project_unique ON rebate_payments(project_id)`,
    `CREATE TABLE business_file_project_links (business_file_id TEXT NOT NULL REFERENCES business_files(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(business_file_id,project_id))`,
    `CREATE INDEX business_file_project_links_project_idx ON business_file_project_links(project_id,business_file_id)`,
    `INSERT INTO business_file_project_links(business_file_id,project_id,created_at) SELECT id,project_id,created_at FROM business_files`
  ]
}, {
  id: '0050_classification_learning_project',
  statements: [
    `ALTER TABLE classification_learning_samples ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`,
    `CREATE INDEX classification_learning_samples_project_idx ON classification_learning_samples(project_id,created_at)`
  ]
}, {
  id: '0051_backfill_classification_learning_project',
  statements: [
    `UPDATE classification_learning_samples AS sample SET project_id=(SELECT project.id FROM projects AS project WHERE project.title=sample.title AND project.content_type_id=sample.final_content_type_id AND ((project.ai_suggested_content_type_id IS NULL AND sample.ai_suggested_content_type_id IS NULL) OR project.ai_suggested_content_type_id=sample.ai_suggested_content_type_id) LIMIT 1) WHERE sample.project_id IS NULL AND (SELECT COUNT(*) FROM projects AS project WHERE project.title=sample.title AND project.content_type_id=sample.final_content_type_id AND ((project.ai_suggested_content_type_id IS NULL AND sample.ai_suggested_content_type_id IS NULL) OR project.ai_suggested_content_type_id=sample.ai_suggested_content_type_id))=1`
  ]
}, {
  id: '0052_draft_comparison_workspace',
  statements: [
    `CREATE TABLE draft_comparison_workspaces (project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE, claude_content TEXT NOT NULL DEFAULT '', codex_content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE draft_comparison_sessions (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, alignment_provider_config_id TEXT, alignment_provider TEXT CHECK(alignment_provider IS NULL OR alignment_provider IN ('codex_cli','claude_cli')), alignment_model TEXT, alignment_provider_fingerprint TEXT, alignment_task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, status TEXT NOT NULL CHECK(status IN ('aligning','ready','failed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX draft_comparison_sessions_project_idx ON draft_comparison_sessions(project_id,updated_at)`,
    `CREATE INDEX draft_comparison_sessions_task_idx ON draft_comparison_sessions(alignment_task_id)`,
    `CREATE TABLE draft_source_snapshots (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES draft_comparison_sessions(id) ON DELETE CASCADE, side TEXT NOT NULL CHECK(side IN ('claude','codex')), source_kind TEXT NOT NULL CHECK(source_kind IN ('freeform','provider')), provider_config_id TEXT, provider TEXT CHECK(provider IS NULL OR provider IN ('codex_cli','claude_cli')), model TEXT, provider_fingerprint TEXT, content TEXT NOT NULL, content_hash TEXT NOT NULL, paragraphs_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX draft_source_snapshots_session_side_unique ON draft_source_snapshots(session_id,side)`,
    `CREATE INDEX draft_source_snapshots_session_idx ON draft_source_snapshots(session_id)`,
    `CREATE TABLE draft_alignment_groups (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES draft_comparison_sessions(id) ON DELETE CASCADE, position INTEGER NOT NULL, label_index INTEGER NOT NULL, match_type TEXT NOT NULL CHECK(match_type IN ('exact','related','claude_only','codex_only','needs_review')), claude_paragraph_ids_json TEXT NOT NULL DEFAULT '[]', codex_paragraph_ids_json TEXT NOT NULL DEFAULT '[]', manually_adjusted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX draft_alignment_groups_session_position_unique ON draft_alignment_groups(session_id,position)`,
    `CREATE UNIQUE INDEX draft_alignment_groups_session_label_unique ON draft_alignment_groups(session_id,label_index)`,
    `CREATE TABLE draft_candidate_revisions (id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL REFERENCES draft_alignment_groups(id) ON DELETE CASCADE, parent_candidate_id TEXT REFERENCES draft_candidate_revisions(id) ON DELETE SET NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('freeform','provider')), provider_config_id TEXT, provider TEXT CHECK(provider IS NULL OR provider IN ('codex_cli','claude_cli')), model TEXT, provider_fingerprint TEXT, requirement TEXT NOT NULL, content TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', rationale TEXT NOT NULL DEFAULT '', task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX draft_candidate_revisions_group_position_unique ON draft_candidate_revisions(group_id,position)`,
    `CREATE INDEX draft_candidate_revisions_group_idx ON draft_candidate_revisions(group_id,created_at)`,
    `CREATE INDEX draft_candidate_revisions_task_idx ON draft_candidate_revisions(task_id)`,
    `CREATE TABLE draft_group_decisions (group_id TEXT PRIMARY KEY NOT NULL REFERENCES draft_alignment_groups(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('claude','codex','candidate','freeform','combination','omit','unresolved')), source_id TEXT, source_ids_json TEXT NOT NULL DEFAULT '[]', content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`
  ]
}, {
  id: '0053_draft_comparison_provider_provenance',
  statements: [
    `ALTER TABLE draft_comparison_workspaces ADD COLUMN claude_source_json TEXT NOT NULL DEFAULT '{"sourceKind":"freeform","providerConfigId":null,"provider":null,"model":null,"providerFingerprint":null,"taskId":null}'`,
    `ALTER TABLE draft_comparison_workspaces ADD COLUMN codex_source_json TEXT NOT NULL DEFAULT '{"sourceKind":"freeform","providerConfigId":null,"provider":null,"model":null,"providerFingerprint":null,"taskId":null}'`,
    `ALTER TABLE draft_comparison_sessions ADD COLUMN alignment_provider_kind TEXT`,
    `ALTER TABLE draft_source_snapshots ADD COLUMN provider_kind TEXT`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN provider_kind TEXT`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN character_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN revision_round INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN input_relation_changed INTEGER NOT NULL DEFAULT 0`,
    `UPDATE draft_comparison_sessions SET alignment_provider_kind=alignment_provider WHERE alignment_provider_kind IS NULL`,
    `UPDATE draft_source_snapshots SET provider_kind=provider WHERE provider_kind IS NULL`,
    `UPDATE draft_candidate_revisions SET provider_kind=provider WHERE provider_kind IS NULL`,
    `UPDATE draft_candidate_revisions SET character_count=length(content) WHERE character_count=0`
  ]
}, {
  id: '0054_draft_comparison_audit_hardening',
  statements: [
    `ALTER TABLE draft_comparison_workspaces ADD COLUMN claude_updated_at TEXT`,
    `ALTER TABLE draft_comparison_workspaces ADD COLUMN codex_updated_at TEXT`,
    `UPDATE draft_comparison_workspaces SET claude_updated_at=updated_at WHERE claude_content<>''`,
    `UPDATE draft_comparison_workspaces SET codex_updated_at=updated_at WHERE codex_content<>''`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN parent_trace_id TEXT`,
    `UPDATE draft_candidate_revisions SET parent_trace_id=parent_candidate_id WHERE parent_candidate_id IS NOT NULL`
  ]
}, {
  id: '0055_postproduction_and_stage_plans',
  statements: [
    `ALTER TABLE stage_time_records RENAME TO stage_time_records_legacy`,
    `ALTER TABLE stage_time_events RENAME TO stage_time_events_legacy`,
    `DROP INDEX stage_time_records_project_idx`,
    `DROP INDEX stage_time_events_record_idx`,
    `CREATE TABLE stage_time_records (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_key TEXT NOT NULL CHECK(stage_key IN ('materials','outline','script','production','postproduction','publishing','feedback','versions')), status TEXT NOT NULL CHECK(status IN ('not_started','in_progress','completed','skipped')), started_date TEXT, started_segment TEXT CHECK(started_segment IN ('morning','afternoon','evening')), completed_date TEXT, completed_segment TEXT CHECK(completed_segment IN ('morning','afternoon','evening')), start_source TEXT CHECK(start_source IN ('automatic','manual','backfill')), completion_source TEXT CHECK(completion_source IN ('automatic','manual','backfill')), actual_effort_half_day_units INTEGER CHECK(actual_effort_half_day_units IS NULL OR (actual_effort_half_day_units>=1 AND actual_effort_half_day_units<=200)), planned_started_date TEXT, planned_started_segment TEXT CHECK(planned_started_segment IN ('morning','afternoon','evening')), planned_completed_date TEXT, planned_completed_segment TEXT CHECK(planned_completed_segment IN ('morning','afternoon','evening')), estimated_duration_half_day_units INTEGER CHECK(estimated_duration_half_day_units IS NULL OR (estimated_duration_half_day_units>=1 AND estimated_duration_half_day_units<=200)), plan_manual_fields_json TEXT NOT NULL DEFAULT '[]', plan_auto_field TEXT CHECK(plan_auto_field IS NULL OR plan_auto_field IN ('start','duration','end')), auto_start_action_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK((started_date IS NULL)=(started_segment IS NULL)), CHECK((completed_date IS NULL)=(completed_segment IS NULL)), CHECK((started_date IS NULL)=(start_source IS NULL)), CHECK((completed_date IS NULL)=(completion_source IS NULL)), CHECK((planned_started_date IS NULL)=(planned_started_segment IS NULL)), CHECK((planned_completed_date IS NULL)=(planned_completed_segment IS NULL)), UNIQUE(project_id,stage_key))`,
    `CREATE INDEX stage_time_records_project_idx ON stage_time_records(project_id,stage_key)`,
    `INSERT INTO stage_time_records(id,project_id,stage_key,status,started_date,started_segment,completed_date,completed_segment,start_source,completion_source,actual_effort_half_day_units,planned_started_date,planned_started_segment,planned_completed_date,planned_completed_segment,estimated_duration_half_day_units,plan_manual_fields_json,plan_auto_field,auto_start_action_id,created_at,updated_at) SELECT id,project_id,stage_key,status,started_date,started_segment,completed_date,completed_segment,start_source,completion_source,actual_effort_half_day_units,NULL,NULL,NULL,NULL,NULL,'[]',NULL,auto_start_action_id,created_at,updated_at FROM stage_time_records_legacy`,
    `CREATE TABLE stage_time_events (id TEXT PRIMARY KEY NOT NULL, record_id TEXT NOT NULL REFERENCES stage_time_records(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_key TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('auto_start','complete','update','skip','reopen','undo')), before_json TEXT NOT NULL, after_json TEXT NOT NULL, actor TEXT NOT NULL CHECK(actor IN ('user','system')), source TEXT NOT NULL CHECK(source IN ('automatic','manual','backfill')), recorded_at TEXT NOT NULL, undone_at TEXT)`,
    `CREATE INDEX stage_time_events_record_idx ON stage_time_events(record_id,recorded_at)`,
    `INSERT INTO stage_time_events SELECT * FROM stage_time_events_legacy`,
    `UPDATE stage_time_events SET before_json=json_set(before_json,'$.plannedStartedDate',NULL,'$.plannedStartedSegment',NULL,'$.plannedCompletedDate',NULL,'$.plannedCompletedSegment',NULL,'$.estimatedDurationHalfDayUnits',NULL,'$.planManualFieldsJson','[]','$.planAutoField',NULL),after_json=json_set(after_json,'$.plannedStartedDate',NULL,'$.plannedStartedSegment',NULL,'$.plannedCompletedDate',NULL,'$.plannedCompletedSegment',NULL,'$.estimatedDurationHalfDayUnits',NULL,'$.planManualFieldsJson','[]','$.planAutoField',NULL)`,
    `DROP TABLE stage_time_events_legacy`,
    `DROP TABLE stage_time_records_legacy`,
    `UPDATE project_templates SET module_keys_json=replace(module_keys_json,'"production","publishing"','"production","postproduction","publishing"'),description=replace(replace(description,'制作','拍摄剪辑与后期'),'与商单独有反馈',''),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    `UPDATE project_templates SET module_keys_json=replace(module_keys_json,',"feedback"','')`,
    `UPDATE project_modules SET enabled=0,disabled_at=COALESCE(disabled_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),last_changed_by='system' WHERE module_key='feedback'`,
    `INSERT OR IGNORE INTO project_modules(project_id,module_key,enabled,position,disabled_at,completed_at,last_changed_by,content_root_id) SELECT production.project_id,'postproduction',production.enabled,production.position+1,CASE WHEN production.enabled=1 THEN NULL ELSE COALESCE(production.disabled_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL THEN COALESCE(publishing.completed_at,project.updated_at) ELSE NULL END,'system',lower(hex(randomblob(16))) FROM project_modules production JOIN projects project ON project.id=production.project_id LEFT JOIN project_modules publishing ON publishing.project_id=production.project_id AND publishing.module_key='publishing' LEFT JOIN topics topic ON topic.created_project_id=production.project_id LEFT JOIN topic_stage_definitions lifecycle ON lifecycle.id=topic.stage_id WHERE production.module_key='production'`,
    `UPDATE project_modules SET position=position+1 WHERE module_key NOT IN ('postproduction','feedback') AND position>(SELECT MIN(p2.position) FROM project_modules p2 WHERE p2.project_id=project_modules.project_id AND p2.module_key='production')`,
    `INSERT OR IGNORE INTO stage_time_records(id,project_id,stage_key,status,started_date,started_segment,completed_date,completed_segment,start_source,completion_source,actual_effort_half_day_units,planned_started_date,planned_started_segment,planned_completed_date,planned_completed_segment,estimated_duration_half_day_units,plan_manual_fields_json,plan_auto_field,auto_start_action_id,created_at,updated_at) SELECT lower(hex(randomblob(16))),postproduction.project_id,'postproduction',CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL THEN 'completed' WHEN EXISTS(SELECT 1 FROM cover_candidates cover WHERE cover.project_id=postproduction.project_id) OR EXISTS(SELECT 1 FROM subtitle_jobs subtitle WHERE subtitle.project_id=postproduction.project_id) THEN 'in_progress' ELSE 'not_started' END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL THEN substr(COALESCE(publishing.completed_at,project.updated_at),1,10) WHEN EXISTS(SELECT 1 FROM cover_candidates cover WHERE cover.project_id=postproduction.project_id) OR EXISTS(SELECT 1 FROM subtitle_jobs subtitle WHERE subtitle.project_id=postproduction.project_id) THEN substr((SELECT MIN(created_at) FROM (SELECT cover.created_at AS created_at FROM cover_candidates cover WHERE cover.project_id=postproduction.project_id UNION ALL SELECT subtitle.created_at AS created_at FROM subtitle_jobs subtitle WHERE subtitle.project_id=postproduction.project_id)),1,10) ELSE NULL END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL OR EXISTS(SELECT 1 FROM cover_candidates cover WHERE cover.project_id=postproduction.project_id) OR EXISTS(SELECT 1 FROM subtitle_jobs subtitle WHERE subtitle.project_id=postproduction.project_id) THEN 'afternoon' ELSE NULL END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL THEN substr(COALESCE(publishing.completed_at,project.updated_at),1,10) ELSE NULL END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL THEN 'afternoon' ELSE NULL END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL OR EXISTS(SELECT 1 FROM cover_candidates cover WHERE cover.project_id=postproduction.project_id) OR EXISTS(SELECT 1 FROM subtitle_jobs subtitle WHERE subtitle.project_id=postproduction.project_id) THEN 'automatic' ELSE NULL END,CASE WHEN project.status IN ('published','archived') OR lifecycle.system_role IN ('completed','archived') OR publishing.completed_at IS NOT NULL THEN 'automatic' ELSE NULL END,NULL,NULL,NULL,NULL,NULL,NULL,'[]',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM project_modules postproduction JOIN projects project ON project.id=postproduction.project_id LEFT JOIN project_modules publishing ON publishing.project_id=postproduction.project_id AND publishing.module_key='publishing' LEFT JOIN topics topic ON topic.created_project_id=postproduction.project_id LEFT JOIN topic_stage_definitions lifecycle ON lifecycle.id=topic.stage_id WHERE postproduction.module_key='postproduction'`
  ]
}, {
  id: '0056_codex_enhanced_writing',
  statements: [
    `ALTER TABLE script_revision_threads ADD COLUMN provider_thread_id TEXT`,
    `ALTER TABLE script_revision_threads ADD COLUMN model TEXT`,
    `ALTER TABLE script_revision_threads ADD COLUMN reasoning_effort TEXT`,
    `ALTER TABLE script_revision_threads ADD COLUMN web_search_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(web_search_mode IN ('automatic','required','disabled'))`,
    `ALTER TABLE script_revision_messages ADD COLUMN model TEXT`,
    `ALTER TABLE script_revision_messages ADD COLUMN reasoning_effort TEXT`,
    `ALTER TABLE script_revision_messages ADD COLUMN web_search_mode TEXT CHECK(web_search_mode IS NULL OR web_search_mode IN ('automatic','required','disabled'))`,
    `ALTER TABLE script_revision_messages ADD COLUMN web_searches_json TEXT NOT NULL DEFAULT '[]'`
  ]
}, {
  id: '0057_standalone_business_ledger',
  statements: [
    `ALTER TABLE projects ADD COLUMN ledger_only INTEGER NOT NULL DEFAULT 0 CHECK(ledger_only IN (0,1))`,
    `CREATE INDEX projects_ledger_only_idx ON projects(ledger_only,trashed_at)`
  ]
}, {
  id: '0058_script_revision_candidate_groups',
  statements: [
    `ALTER TABLE script_revision_messages ADD COLUMN candidate_group_id TEXT`,
    `ALTER TABLE script_revision_messages ADD COLUMN candidate_number INTEGER CHECK(candidate_number IS NULL OR candidate_number>0)`,
    `ALTER TABLE script_revision_messages ADD COLUMN generation_round INTEGER CHECK(generation_round IS NULL OR generation_round>0)`,
    `ALTER TABLE script_revision_messages ADD COLUMN candidate_instruction TEXT`,
    `UPDATE script_revision_messages AS candidate SET candidate_group_id=candidate.thread_id||':'||COALESCE(json_extract(candidate.selection_snapshot_json,'$.targetSelectionId'),CASE WHEN candidate.selection_hash IS NOT NULL THEN 'legacy-'||candidate.selection_hash ELSE 'message-'||candidate.id END),candidate_instruction=COALESCE((SELECT request.content FROM script_revision_messages request WHERE request.task_id=candidate.task_id AND request.role='user' LIMIT 1),'') WHERE candidate.role='assistant' AND candidate.suggestion_json IS NOT NULL`,
    `WITH groups AS (SELECT candidate_group_id,ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY MIN(created_at),MIN(id)) AS candidate_number FROM script_revision_messages WHERE candidate_group_id IS NOT NULL GROUP BY thread_id,candidate_group_id) UPDATE script_revision_messages SET candidate_number=(SELECT groups.candidate_number FROM groups WHERE groups.candidate_group_id=script_revision_messages.candidate_group_id) WHERE candidate_group_id IS NOT NULL`,
    `WITH revisions AS (SELECT id,ROW_NUMBER() OVER (PARTITION BY candidate_group_id ORDER BY created_at,id) AS generation_round FROM script_revision_messages WHERE candidate_group_id IS NOT NULL) UPDATE script_revision_messages SET generation_round=(SELECT revisions.generation_round FROM revisions WHERE revisions.id=script_revision_messages.id) WHERE candidate_group_id IS NOT NULL`,
    `CREATE INDEX script_revision_messages_candidate_group_idx ON script_revision_messages(candidate_group_id,generation_round)`
  ]
}, {
  id: '0048_mobile_capture_metadata',
  statements: [
    `ALTER TABLE captures ADD COLUMN mobile_title TEXT`,
    `ALTER TABLE captures ADD COLUMN mobile_source_app TEXT`,
    `ALTER TABLE captures ADD COLUMN mobile_source_title TEXT`,
    `ALTER TABLE captures ADD COLUMN mobile_source_url TEXT`,
    `ALTER TABLE captures ADD COLUMN mobile_notes TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_title TEXT`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_source_app TEXT`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_source_title TEXT`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_source_url TEXT`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_notes TEXT NOT NULL DEFAULT ''`
  ]
}, {
  id: '0049_mobile_recording_metadata',
  statements: [
    `ALTER TABLE captures ADD COLUMN mobile_recording_markers_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE captures ADD COLUMN mobile_recording_interruption_reason TEXT`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_recording_markers_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE asset_upload_sessions ADD COLUMN mobile_recording_interruption_reason TEXT`
  ]
}, {
  id: '0050_mobile_video_attachments',
  statements: [
    `DROP INDEX IF EXISTS capture_asset_links_capture_idx`,
    `ALTER TABLE capture_asset_links RENAME TO capture_asset_links_0049_legacy`,
    `CREATE TABLE capture_asset_links (id TEXT PRIMARY KEY NOT NULL, capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE, file_reference_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE CASCADE, attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('image','video','audio','pdf','word','file')), position INTEGER NOT NULL CHECK(position>=0), created_at TEXT NOT NULL, UNIQUE(capture_id,file_reference_id), UNIQUE(capture_id,position))`,
    `INSERT INTO capture_asset_links SELECT * FROM capture_asset_links_0049_legacy`,
    `DROP TABLE capture_asset_links_0049_legacy`,
    `CREATE INDEX capture_asset_links_capture_idx ON capture_asset_links(capture_id,position)`,
    `DROP INDEX IF EXISTS asset_upload_chunks_attachment_idx`,
    `DROP INDEX IF EXISTS asset_upload_attachments_session_idx`,
    `ALTER TABLE asset_upload_chunks RENAME TO asset_upload_chunks_0049_legacy`,
    `ALTER TABLE asset_upload_attachments RENAME TO asset_upload_attachments_0049_legacy`,
    `CREATE TABLE asset_upload_attachments (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES asset_upload_sessions(id) ON DELETE CASCADE, attachment_id TEXT NOT NULL, attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('image','video','audio','pdf','word','file')), name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>=0), sha256 TEXT NOT NULL, chunk_count INTEGER NOT NULL CHECK(chunk_count>0), received_count INTEGER NOT NULL DEFAULT 0 CHECK(received_count>=0 AND received_count<=chunk_count), relative_path TEXT, state TEXT NOT NULL CHECK(state IN ('receiving','complete','assembling','assembled','failed')), assembled_locator TEXT, failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id,attachment_id))`,
    `INSERT INTO asset_upload_attachments SELECT * FROM asset_upload_attachments_0049_legacy`,
    `CREATE TABLE asset_upload_chunks (upload_attachment_id TEXT NOT NULL REFERENCES asset_upload_attachments(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL CHECK(chunk_index>=0), byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL, nonce TEXT NOT NULL, auth_tag TEXT NOT NULL, staged_locator TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(upload_attachment_id,chunk_index))`,
    `INSERT INTO asset_upload_chunks SELECT * FROM asset_upload_chunks_0049_legacy`,
    `DROP TABLE asset_upload_chunks_0049_legacy`,
    `DROP TABLE asset_upload_attachments_0049_legacy`,
    `CREATE INDEX asset_upload_attachments_session_idx ON asset_upload_attachments(session_id,state)`,
    `CREATE INDEX asset_upload_chunks_attachment_idx ON asset_upload_chunks(upload_attachment_id,chunk_index)`
  ]
}, {
  id: '0051_mobile_uploads_never_expire',
  statements: [
    `UPDATE asset_upload_sessions SET expires_at='9999-12-31T23:59:59.999Z' WHERE state<>'committed'`
  ]
}, {
  id: '0052_mobile_attachment_order',
  statements: [
    `DROP INDEX IF EXISTS asset_upload_chunks_attachment_idx`,
    `DROP INDEX IF EXISTS asset_upload_attachments_session_idx`,
    `ALTER TABLE asset_upload_chunks RENAME TO asset_upload_chunks_0051_legacy`,
    `ALTER TABLE asset_upload_attachments RENAME TO asset_upload_attachments_0051_legacy`,
    `CREATE TABLE asset_upload_attachments (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES asset_upload_sessions(id) ON DELETE CASCADE, attachment_id TEXT NOT NULL, attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('image','video','audio','pdf','word','file')), position INTEGER NOT NULL CHECK(position>=0), name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>=0), sha256 TEXT NOT NULL, chunk_count INTEGER NOT NULL CHECK(chunk_count>0), received_count INTEGER NOT NULL DEFAULT 0 CHECK(received_count>=0 AND received_count<=chunk_count), relative_path TEXT, state TEXT NOT NULL CHECK(state IN ('receiving','complete','assembling','assembled','failed')), assembled_locator TEXT, failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id,attachment_id), UNIQUE(session_id,position))`,
    `INSERT INTO asset_upload_attachments(id,session_id,attachment_id,attachment_kind,position,name,mime_type,byte_size,sha256,chunk_count,received_count,relative_path,state,assembled_locator,failure_code,created_at,updated_at)
      SELECT id,session_id,attachment_id,attachment_kind,ROW_NUMBER() OVER(PARTITION BY session_id ORDER BY created_at,id)-1,name,mime_type,byte_size,sha256,chunk_count,received_count,relative_path,state,assembled_locator,failure_code,created_at,updated_at
      FROM asset_upload_attachments_0051_legacy`,
    `CREATE TABLE asset_upload_chunks (upload_attachment_id TEXT NOT NULL REFERENCES asset_upload_attachments(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL CHECK(chunk_index>=0), byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL, nonce TEXT NOT NULL, auth_tag TEXT NOT NULL, staged_locator TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(upload_attachment_id,chunk_index))`,
    `INSERT INTO asset_upload_chunks SELECT * FROM asset_upload_chunks_0051_legacy`,
    `DROP TABLE asset_upload_chunks_0051_legacy`,
    `DROP TABLE asset_upload_attachments_0051_legacy`,
    `CREATE INDEX asset_upload_attachments_session_idx ON asset_upload_attachments(session_id,state)`,
    `CREATE INDEX asset_upload_chunks_attachment_idx ON asset_upload_chunks(upload_attachment_id,chunk_index)`
  ]
}, {
  id: '0053_mobile_attachment_source_time',
  statements: [
    `ALTER TABLE file_references ADD COLUMN source_modified_at TEXT`,
    `ALTER TABLE asset_upload_attachments ADD COLUMN source_modified_at TEXT`
  ]
}, {
  id: '0054_mobile_note_updates',
  statements: [
    `ALTER TABLE mobile_capture_receipts ADD COLUMN last_note_revision INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE mobile_capture_receipts ADD COLUMN last_note_sha256 TEXT`
  ]
}, {
  id: '0055_script_version_display_names',
  statements: [
    `ALTER TABLE draft_versions ADD COLUMN display_name TEXT`
  ]
}, {
  id: '0059_r17_draft_group_annotations',
  statements: [
    `ALTER TABLE draft_group_decisions ADD COLUMN note TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE draft_group_decisions ADD COLUMN markers_json TEXT NOT NULL DEFAULT '[]'`,
    `UPDATE draft_group_decisions SET note=content,content='' WHERE kind='unresolved' AND content<>''`
  ]
}, {
  id: '0060_r17_draft_outline_relations',
  statements: [
    `ALTER TABLE draft_alignment_groups ADD COLUMN outline_placement TEXT NOT NULL DEFAULT 'outside_outline'`,
    `ALTER TABLE draft_alignment_groups ADD COLUMN outline_item_id TEXT`
  ]
}, {
  id: '0061_r19_draft_split_history',
  statements: [
    `CREATE TABLE draft_comparison_history (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES draft_comparison_sessions(id) ON DELETE CASCADE, label TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX draft_comparison_history_project_idx ON draft_comparison_history(project_id,created_at)`,
    `CREATE INDEX draft_comparison_history_session_idx ON draft_comparison_history(session_id,created_at)`,
    `CREATE TABLE draft_split_match_cache (content_hash TEXT PRIMARY KEY NOT NULL, matched_paragraph_ids_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ]
}, {
  id: '0062_r20_lightweight_todos',
  statements: [
    `CREATE TABLE todo_items (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, planned_date TEXT, segment TEXT CHECK(segment IS NULL OR segment IN ('morning','afternoon','evening')), category TEXT NOT NULL CHECK(category IN ('self_media','ai','life','other_work')), project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, status TEXT NOT NULL CHECK(status IN ('open','completed','dismissed')), tracking_mode TEXT NOT NULL CHECK(tracking_mode IN ('checklist','progress')), progress INTEGER NOT NULL DEFAULT 0 CHECK(progress>=0 AND progress<=100), progress_before_complete INTEGER CHECK(progress_before_complete IS NULL OR (progress_before_complete>=0 AND progress_before_complete<=99)), source TEXT NOT NULL CHECK(source IN ('manual','schedule')), source_schedule_id TEXT REFERENCES schedule_items(id) ON DELETE SET NULL, source_planned_date TEXT, source_segment TEXT CHECK(source_segment IS NULL OR source_segment IN ('morning','afternoon','evening')), schedule_sync_enabled INTEGER NOT NULL DEFAULT 1, completed_at TEXT, dismissed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX todo_items_source_schedule_unique ON todo_items(source_schedule_id)`,
    `CREATE INDEX todo_items_day_status_idx ON todo_items(planned_date,status)`,
    `CREATE INDEX todo_items_project_idx ON todo_items(project_id,planned_date)`,
    `CREATE TABLE todo_events (id TEXT PRIMARY KEY NOT NULL, todo_id TEXT NOT NULL REFERENCES todo_items(id) ON DELETE CASCADE, action TEXT NOT NULL, before_json TEXT, after_json TEXT, recorded_at TEXT NOT NULL)`,
    `CREATE INDEX todo_events_todo_time_idx ON todo_events(todo_id,recorded_at)`,
    `CREATE TABLE todo_daily_snapshots (todo_id TEXT NOT NULL REFERENCES todo_items(id) ON DELETE CASCADE, day TEXT NOT NULL, ending_status TEXT NOT NULL CHECK(ending_status IN ('open','completed','dismissed')), ending_progress INTEGER NOT NULL CHECK(ending_progress>=0 AND ending_progress<=100), progress_delta INTEGER NOT NULL DEFAULT 0, recorded_at TEXT NOT NULL, PRIMARY KEY(todo_id,day))`,
    `CREATE INDEX todo_daily_snapshots_day_idx ON todo_daily_snapshots(day,ending_status)`,
    `CREATE TABLE daily_work_logs (day TEXT PRIMARY KEY NOT NULL, self_media_minutes INTEGER NOT NULL DEFAULT 0 CHECK(self_media_minutes>=0 AND self_media_minutes<=1440), ai_minutes INTEGER NOT NULL DEFAULT 0 CHECK(ai_minutes>=0 AND ai_minutes<=1440), other_work_minutes INTEGER NOT NULL DEFAULT 0 CHECK(other_work_minutes>=0 AND other_work_minutes<=1440), updated_at TEXT NOT NULL)`,
    `INSERT INTO todo_items(id,title,planned_date,segment,category,project_id,status,tracking_mode,progress,progress_before_complete,source,source_schedule_id,source_planned_date,source_segment,schedule_sync_enabled,completed_at,dismissed_at,created_at,updated_at)
      SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
      title,substr(start_at,1,10),
      CASE WHEN CAST(substr(start_at,12,2) AS INTEGER)<12 THEN 'morning' WHEN CAST(substr(start_at,12,2) AS INTEGER)<18 THEN 'afternoon' ELSE 'evening' END,
      'self_media',project_id,'open','checklist',0,NULL,'schedule',id,substr(start_at,1,10),
      CASE WHEN CAST(substr(start_at,12,2) AS INTEGER)<12 THEN 'morning' WHEN CAST(substr(start_at,12,2) AS INTEGER)<18 THEN 'afternoon' ELSE 'evening' END,
      1,NULL,NULL,created_at,updated_at
      FROM schedule_items WHERE start_at IS NOT NULL AND state<>'done'`
  ]
}, {
  id: '0063_r24_business_ingestion',
  statements: [
    `ALTER TABLE business_records ADD COLUMN revenue_month TEXT`,
    `ALTER TABLE business_records ADD COLUMN rebate_input_mode TEXT NOT NULL DEFAULT 'rate' CHECK(rebate_input_mode IN ('rate','amount'))`,
    `ALTER TABLE business_records ADD COLUMN trashed_at TEXT`,
    `UPDATE business_records SET rebate_input_mode='amount' WHERE final_rebate_amount_cents IS NOT NULL AND final_rebate_rate_percent IS NULL`,
    `CREATE INDEX business_records_revenue_month_idx ON business_records(revenue_month,trashed_at)`,
    `CREATE TABLE business_invoice_project_links (invoice_id TEXT NOT NULL REFERENCES business_invoices(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(invoice_id,project_id))`,
    `CREATE INDEX business_invoice_project_links_project_idx ON business_invoice_project_links(project_id,invoice_id)`,
    `INSERT INTO business_invoice_project_links(invoice_id,project_id,created_at) SELECT id,project_id,created_at FROM business_invoices`
  ]
}, {
  id: '0064_r24_business_workflow',
  statements: [
    `ALTER TABLE business_records ADD COLUMN deal_status TEXT NOT NULL DEFAULT 'ordered' CHECK(deal_status IN ('agreed_pending_order','ordered','canceled'))`,
    `ALTER TABLE business_records ADD COLUMN manual_settled_at TEXT`,
    `ALTER TABLE business_records ADD COLUMN order_platform_manually_set INTEGER NOT NULL DEFAULT 0 CHECK(order_platform_manually_set IN (0,1))`,
    `UPDATE business_records SET deal_status='agreed_pending_order' WHERE platform_order_amount_cents IS NULL AND order_date IS NULL`,
    `ALTER TABLE business_invoices ADD COLUMN issuer_name TEXT NOT NULL DEFAULT ''`,
    `CREATE TABLE business_events (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, action TEXT NOT NULL CHECK(action IN ('created','updated','imported','project_linked','project_detached','manual_settled','manual_settlement_canceled','trashed','restored','invoice_saved','file_imported')), summary TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX business_events_project_created_idx ON business_events(project_id,created_at)`,
    `INSERT INTO business_events(id,project_id,action,summary,created_at) SELECT lower(hex(randomblob(16))),project_id,'created','迁移既有商务记录',created_at FROM business_records`
  ]
}, {
  id: '0065_r24_business_lifecycle_backfill',
  statements: [
    `UPDATE business_records
      SET deal_status='ordered'
      WHERE deal_status='agreed_pending_order'
        AND (
          payment_status='received'
          OR EXISTS(SELECT 1 FROM rebate_payments WHERE rebate_payments.project_id=business_records.project_id)
          OR EXISTS(SELECT 1 FROM business_invoices WHERE business_invoices.project_id=business_records.project_id)
        )`
  ]
}, {
  id: '0066_target_day_and_business_labels',
  statements: [
    `UPDATE topic_column_definitions SET name='目标日',updated_at=datetime('now') WHERE builtin_key='expected' AND name='预期完成'`,
    `UPDATE schedule_items SET title='目标日',updated_at=datetime('now') WHERE action_type='overview' AND schedule_kind='hard_deadline' AND title='预期完成'`
  ]
}, {
  id: '0067_independent_daily_todos',
  statements: [
    `UPDATE todo_items
      SET source='manual',
          source_schedule_id=NULL,
          source_planned_date=NULL,
          source_segment=NULL,
          updated_at=datetime('now')
      WHERE source='schedule' AND schedule_sync_enabled=0 AND status<>'dismissed'`,
    `UPDATE todo_items
      SET status='dismissed',
          schedule_sync_enabled=0,
          dismissed_at=COALESCE(dismissed_at,datetime('now')),
          updated_at=datetime('now')
      WHERE source='schedule' AND status<>'dismissed'`
  ]
}, {
  id: '0068_material_web_research',
  statements: [
    `ALTER TABLE project_materials ADD COLUMN is_primary_reference INTEGER NOT NULL DEFAULT 0 CHECK(is_primary_reference IN (0,1))`,
    `ALTER TABLE project_materials ADD COLUMN attention_note TEXT NOT NULL DEFAULT ''`,
    `CREATE TABLE material_research_results (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      request TEXT NOT NULL,
      requested_title TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      runtime_json TEXT,
      result_hash TEXT,
      status TEXT NOT NULL DEFAULT 'researching' CHECK(status IN ('researching','ready','saved','discarded')),
      saved_material_id TEXT REFERENCES project_materials(id) ON DELETE SET NULL,
      refresh_of_result_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX material_research_results_task_unique ON material_research_results(task_id)`,
    `CREATE UNIQUE INDEX material_research_results_saved_material_unique ON material_research_results(saved_material_id) WHERE saved_material_id IS NOT NULL`,
    `CREATE INDEX material_research_results_project_idx ON material_research_results(project_id,created_at)`,
    `CREATE TABLE material_research_sources (
      id TEXT PRIMARY KEY NOT NULL,
      result_id TEXT NOT NULL REFERENCES material_research_results(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      publisher TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('official','primary','media','commerce','community','other')),
      published_at TEXT,
      accessed_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX material_research_sources_result_key_unique ON material_research_sources(result_id,source_key)`,
    `CREATE INDEX material_research_sources_result_idx ON material_research_sources(result_id,accessed_at)`
  ]
}, {
  id: '0068_r30_income_ledger',
  statements: [
    `CREATE TABLE other_income_categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX other_income_categories_active_sort_idx ON other_income_categories(is_active,sort_order)`,
    `INSERT INTO other_income_categories(id,name,description,sort_order,is_active,created_at,updated_at) VALUES
      ('income-consulting','顾问服务','顾问、咨询和专业服务收入',10,1,datetime('now'),datetime('now')),
      ('income-course','课程讲座','课程、培训和讲座收入',20,1,datetime('now'),datetime('now')),
      ('income-licensing','内容授权','内容、素材和版权授权收入',30,1,datetime('now'),datetime('now')),
      ('income-platform-share','平台分成','平台激励、创作分成和流量收益',40,1,datetime('now'),datetime('now')),
      ('income-other','其他','暂时无法归入其他已确认类型的收入',50,1,datetime('now'),datetime('now'))`,
    `CREATE TABLE other_income_records (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, category_id TEXT REFERENCES other_income_categories(id) ON DELETE SET NULL, source_name TEXT NOT NULL DEFAULT '', revenue_month TEXT CHECK(revenue_month IS NULL OR revenue_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'), income_date TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), direct_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(direct_cost_cents>=0), payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','received')), payment_received_date TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','canceled')), currency TEXT NOT NULL DEFAULT 'CNY', notes TEXT NOT NULL DEFAULT '', source_reference TEXT NOT NULL DEFAULT '', source_transaction_id TEXT NOT NULL DEFAULT '', source_hash TEXT NOT NULL DEFAULT '', original_file_id TEXT REFERENCES file_references(id) ON DELETE SET NULL, trashed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX other_income_records_stats_idx ON other_income_records(revenue_month,income_date,status,trashed_at)`,
    `CREATE INDEX other_income_records_category_idx ON other_income_records(category_id,created_at)`,
    `CREATE INDEX other_income_records_transaction_idx ON other_income_records(source_transaction_id)`,
    `CREATE INDEX other_income_records_hash_idx ON other_income_records(source_hash)`,
    `CREATE TABLE other_income_company_aliases (id TEXT PRIMARY KEY NOT NULL, company_name TEXT NOT NULL, alias TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(company_name,alias))`,
    `CREATE INDEX other_income_company_alias_lookup_idx ON other_income_company_aliases(alias)`,
    `CREATE TABLE other_income_import_rules (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, instruction TEXT NOT NULL, conditions_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ]
}, {
  id: '0069_unbound_schedule_items',
  statements: [
    `CREATE TEMP TABLE schedule_todo_links AS
      SELECT id AS todo_id,source_schedule_id AS schedule_id
      FROM todo_items
      WHERE source_schedule_id IS NOT NULL`,
    `CREATE TABLE schedule_items_next (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      color_token TEXT CHECK(color_token IS NULL OR color_token IN ('project-1','project-2','project-3','project-4','project-5','project-6','project-7','project-8','project-9','project-10','project-11','project-12')),
      title TEXT NOT NULL,
      action_type TEXT NOT NULL,
      start_at TEXT,
      end_at TEXT,
      schedule_kind TEXT NOT NULL,
      state TEXT NOT NULL,
      waiting_for TEXT,
      source TEXT NOT NULL,
      is_movable INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `INSERT INTO schedule_items_next(id,project_id,color_token,title,action_type,start_at,end_at,schedule_kind,state,waiting_for,source,is_movable,created_at,updated_at)
      SELECT id,project_id,NULL,title,action_type,start_at,end_at,schedule_kind,state,waiting_for,source,is_movable,created_at,updated_at
      FROM schedule_items`,
    `DROP TABLE schedule_items`,
    `ALTER TABLE schedule_items_next RENAME TO schedule_items`,
    `CREATE INDEX schedule_items_range_idx ON schedule_items(start_at,end_at)`,
    `CREATE INDEX schedule_items_project_idx ON schedule_items(project_id,start_at)`,
    `UPDATE todo_items
      SET source_schedule_id=(SELECT schedule_id FROM schedule_todo_links WHERE todo_id=todo_items.id)
      WHERE EXISTS(SELECT 1 FROM schedule_todo_links WHERE todo_id=todo_items.id)`,
    `DROP TABLE schedule_todo_links`
  ]
}, {
  id: '0070_script_material_traceability',
  statements: [
    `CREATE TABLE script_material_workspaces (project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE, working_content TEXT NOT NULL DEFAULT '', working_base_revision_id TEXT, requirement TEXT NOT NULL DEFAULT '', ai_count INTEGER NOT NULL DEFAULT 1 CHECK(ai_count IN (1,2)), selected_ai_side TEXT NOT NULL DEFAULT 'codex' CHECK(selected_ai_side IN ('codex','claude')), web_search_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(web_search_mode IN ('automatic','required','disabled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE script_material_revisions (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision>0), content TEXT NOT NULL, content_hash TEXT NOT NULL, points_confirmed INTEGER NOT NULL DEFAULT 0, confirmed_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX script_material_revisions_project_revision_unique ON script_material_revisions(project_id,revision)`,
    `CREATE INDEX script_material_revisions_project_created_idx ON script_material_revisions(project_id,created_at)`,
    `CREATE TABLE script_material_points (id TEXT PRIMARY KEY NOT NULL, stable_id TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES script_material_revisions(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), source_start INTEGER NOT NULL CHECK(source_start>=0), source_end INTEGER NOT NULL CHECK(source_end>=source_start), source_text TEXT NOT NULL, summary TEXT NOT NULL, requirement TEXT NOT NULL DEFAULT '', adoption TEXT NOT NULL DEFAULT 'required' CHECK(adoption IN ('required','excluded')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX script_material_points_revision_position_unique ON script_material_points(revision_id,position)`,
    `CREATE UNIQUE INDEX script_material_points_revision_stable_unique ON script_material_points(revision_id,stable_id)`,
    `CREATE INDEX script_material_points_revision_idx ON script_material_points(revision_id)`,
    `CREATE TABLE script_material_drafts (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision_id TEXT NOT NULL REFERENCES script_material_revisions(id) ON DELETE CASCADE, side TEXT NOT NULL CHECK(side IN ('codex','claude')), source_kind TEXT NOT NULL CHECK(source_kind IN ('freeform','provider')), provider_config_id TEXT, provider_kind TEXT CHECK(provider_kind IS NULL OR provider_kind IN ('codex_cli','claude_cli','external_api')), model TEXT, reasoning_effort TEXT, provider_fingerprint TEXT, requirement TEXT NOT NULL, input_fingerprint TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, paragraphs_json TEXT NOT NULL DEFAULT '[]', task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX script_material_drafts_revision_side_unique ON script_material_drafts(revision_id,side)`,
    `CREATE INDEX script_material_drafts_project_idx ON script_material_drafts(project_id,updated_at)`,
    `CREATE INDEX script_material_drafts_task_idx ON script_material_drafts(task_id)`,
    `CREATE TABLE script_material_checks (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision_id TEXT NOT NULL REFERENCES script_material_revisions(id) ON DELETE CASCADE, target TEXT NOT NULL CHECK(target IN ('codex','claude','current')), target_content_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('unchecked','checking','ready','stale','failed')), point_coverage_json TEXT NOT NULL DEFAULT '[]', paragraph_findings_json TEXT NOT NULL DEFAULT '[]', allowed_omission_point_ids_json TEXT NOT NULL DEFAULT '[]', task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX script_material_checks_revision_target_unique ON script_material_checks(revision_id,target)`,
    `CREATE INDEX script_material_checks_project_idx ON script_material_checks(project_id,updated_at)`,
    `CREATE INDEX script_material_checks_task_idx ON script_material_checks(task_id)`
  ]
}, {
  id: '0071_script_material_conversation',
  statements: [
    `CREATE TABLE script_material_messages (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision_id TEXT NOT NULL REFERENCES script_material_revisions(id) ON DELETE CASCADE, side TEXT NOT NULL CHECK(side IN ('codex','claude')), role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX script_material_messages_revision_side_idx ON script_material_messages(revision_id,side,created_at)`,
    `CREATE INDEX script_material_messages_task_idx ON script_material_messages(task_id)`
  ]
}, {
  id: '0072_script_material_draft_versions_and_ai_mapping',
  statements: [
    `ALTER TABLE script_material_workspaces ADD COLUMN selected_codex_draft_id TEXT`,
    `ALTER TABLE script_material_workspaces ADD COLUMN selected_claude_draft_id TEXT`,
    `ALTER TABLE script_material_drafts ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE script_material_drafts ADD COLUMN mapping_state TEXT NOT NULL DEFAULT 'ready' CHECK(mapping_state IN ('pending','ready','failed'))`,
    `ALTER TABLE script_material_drafts ADD COLUMN mapping_task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL`,
    `ALTER TABLE script_material_drafts ADD COLUMN mapping_error TEXT`,
    `ALTER TABLE script_material_drafts ADD COLUMN current_content_hash TEXT`,
    `ALTER TABLE script_material_drafts ADD COLUMN current_mappings_json TEXT NOT NULL DEFAULT '[]'`,
    `DROP INDEX script_material_drafts_revision_side_unique`,
    `CREATE UNIQUE INDEX script_material_drafts_revision_side_version_unique ON script_material_drafts(revision_id,side,draft_version)`,
    `UPDATE task_runs
      SET status='canceled',error_code='MAPPING_CONTRACT_UPGRADED',error_message='旧版首次映射已停止；AI稿仍保留，需要时可手动重新匹配',finished_at=COALESCE(finished_at,CURRENT_TIMESTAMP)
      WHERE task_type='script_material_map' AND status IN ('queued','running','waiting_confirmation')`,
    `UPDATE script_material_workspaces
      SET selected_codex_draft_id=(
        SELECT draft.id FROM script_material_drafts draft
        WHERE draft.project_id=script_material_workspaces.project_id AND draft.side='codex'
        ORDER BY draft.updated_at DESC,draft.id DESC LIMIT 1
      ),
      selected_claude_draft_id=(
        SELECT draft.id FROM script_material_drafts draft
        WHERE draft.project_id=script_material_workspaces.project_id AND draft.side='claude'
        ORDER BY draft.updated_at DESC,draft.id DESC LIMIT 1
      )`
  ]
}, {
  id: '0073_script_material_rewrite_candidates',
  statements: [
    `CREATE TABLE script_material_rewrite_candidates (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES script_material_revisions(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES script_material_drafts(id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK(side IN ('codex','claude')),
      paragraph_ids_json TEXT NOT NULL DEFAULT '[]',
      selected_text TEXT NOT NULL DEFAULT '',
      selected_start INTEGER,
      selected_end INTEGER,
      requirement TEXT NOT NULL,
      content TEXT NOT NULL,
      source_point_ids_json TEXT NOT NULL DEFAULT '[]',
      annotations_json TEXT NOT NULL DEFAULT '[]',
      provider_config_id TEXT,
      provider_kind TEXT CHECK(provider_kind IS NULL OR provider_kind IN ('codex_cli','claude_cli','external_api')),
      model TEXT,
      reasoning_effort TEXT,
      task_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX script_material_rewrite_candidates_revision_idx ON script_material_rewrite_candidates(revision_id,created_at)`,
    `CREATE INDEX script_material_rewrite_candidates_draft_idx ON script_material_rewrite_candidates(draft_id,created_at)`,
    `CREATE UNIQUE INDEX script_material_rewrite_candidates_task_unique ON script_material_rewrite_candidates(task_id)`
  ]
}, {
  id: '0074_script_material_version_snapshots',
  statements: [
    `ALTER TABLE script_material_checks ADD COLUMN target_identity TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE script_material_checks ADD COLUMN input_fingerprint TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE script_material_checks ADD COLUMN checked_at TEXT`,
    `UPDATE script_material_checks SET target_identity=CASE WHEN target='current' THEN 'current' ELSE target END,state='stale'`,
    `DROP INDEX script_material_checks_revision_target_unique`,
    `CREATE UNIQUE INDEX script_material_checks_revision_identity_unique ON script_material_checks(revision_id,target_identity)`,
    `UPDATE task_runs
      SET status='canceled',error_code='SCRIPT_MATERIAL_AUDIT_CONTRACT_UPGRADED',error_message='检查合同已升级，请手动重新更新检查',finished_at=COALESCE(finished_at,CURRENT_TIMESTAMP)
      WHERE task_type='script_material_audit' AND status IN ('queued','running','waiting_confirmation')`,
    `CREATE TABLE script_material_version_snapshots (
      version_id TEXT PRIMARY KEY NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL DEFAULT 1,
      source_revision_id TEXT NOT NULL,
      source_revision_hash TEXT NOT NULL,
      current_content_hash TEXT NOT NULL,
      audit_input_fingerprint TEXT NOT NULL,
      workspace_snapshot_json TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      finalization_json TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX script_material_version_snapshots_project_idx ON script_material_version_snapshots(project_id,created_at)`
  ]
}, {
  id: '0075_script_version_workspace_content',
  statements: [
    `ALTER TABLE draft_versions ADD COLUMN workspace_content TEXT`,
    `UPDATE draft_versions SET workspace_content=content WHERE document_type='script'`,
    `ALTER TABLE script_material_version_snapshots ADD COLUMN workspace_content_hash TEXT NOT NULL DEFAULT ''`
  ]
}, {
  id: '0076_project_current_script_documents',
  statements: [
    `CREATE TABLE project_current_script_documents (
      project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      working_document_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version>0),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      editor_document_json TEXT NOT NULL,
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
      last_saved_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL,
      last_mutation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX project_current_script_documents_saved_version_idx ON project_current_script_documents(last_saved_version_id)`,
    `CREATE TABLE current_script_source_relations (
      id TEXT PRIMARY KEY NOT NULL,
      working_document_id TEXT NOT NULL REFERENCES project_current_script_documents(working_document_id) ON DELETE CASCADE,
      target_block_id TEXT NOT NULL,
      target_start INTEGER NOT NULL CHECK(target_start>=0),
      target_end INTEGER NOT NULL CHECK(target_end>=target_start),
      source_kind TEXT NOT NULL CHECK(source_kind IN ('material_point','material_draft_paragraph','outline_point','brief_point','comparison_source','generation')),
      source_id TEXT NOT NULL,
      source_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX current_script_source_relations_target_idx ON current_script_source_relations(working_document_id,target_block_id,target_start,target_end)`,
    `CREATE INDEX current_script_source_relations_source_idx ON current_script_source_relations(source_kind,source_id,source_version)`,
    `CREATE UNIQUE INDEX current_script_source_relations_unique ON current_script_source_relations(working_document_id,target_block_id,target_start,target_end,source_kind,source_id,source_version)`,
    `CREATE TABLE script_text_annotations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('current_script','material_draft','comparison_source','comparison_candidate','draft_version')),
      source_id TEXT NOT NULL,
      source_version TEXT NOT NULL,
      coordinate_space TEXT NOT NULL DEFAULT 'block_text' CHECK(coordinate_space='block_text'),
      block_id TEXT NOT NULL,
      block_start INTEGER NOT NULL CHECK(block_start>=0),
      block_end INTEGER NOT NULL CHECK(block_end>=block_start),
      selected_text TEXT NOT NULL,
      style TEXT NOT NULL CHECK(style IN ('highlight','underline','strike','flag')),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','position_changed','not_migrated')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX script_text_annotations_source_idx ON script_text_annotations(project_id,source_kind,source_id,source_version,block_id)`,
    `CREATE INDEX script_text_annotations_status_idx ON script_text_annotations(project_id,status,updated_at)`,
    `CREATE TABLE script_working_document_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      working_document_id TEXT NOT NULL,
      snapshot_kind TEXT NOT NULL CHECK(snapshot_kind IN ('committed','conflict_attempt','version_snapshot')),
      conflict_reason TEXT CHECK(conflict_reason IS NULL OR conflict_reason IN ('working_document_mismatch','revision_mismatch','content_hash_mismatch')),
      head_revision_snapshot_id TEXT,
      snapshot_saved_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL,
      recovery_conflict_id TEXT,
      base_revision INTEGER NOT NULL CHECK(base_revision>=0),
      base_content_hash TEXT NOT NULL CHECK(length(base_content_hash)=64),
      result_revision INTEGER CHECK(result_revision IS NULL OR result_revision>0),
      head_revision_at_write INTEGER NOT NULL CHECK(head_revision_at_write>0),
      head_content_hash_at_write TEXT NOT NULL CHECK(length(head_content_hash_at_write)=64),
      document_updated_at TEXT NOT NULL,
      editor_document_json TEXT NOT NULL,
      source_relations_json TEXT NOT NULL DEFAULT '[]',
      annotations_json TEXT NOT NULL DEFAULT '[]',
      source_relation_snapshots_json TEXT NOT NULL DEFAULT '[]',
      annotation_snapshots_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
      snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
      client_mutation_id TEXT NOT NULL,
      mutation_fingerprint TEXT NOT NULL CHECK(length(mutation_fingerprint)=64),
      saved_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL,
      resolution_kind TEXT CHECK(resolution_kind IS NULL OR resolution_kind IN ('kept_server','replaced_with_attempt','saved_attempt_as_version')),
      resolved_revision_snapshot_id TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX script_working_document_revisions_mutation_unique ON script_working_document_revisions(project_id,client_mutation_id)`,
    `CREATE UNIQUE INDEX script_working_document_revisions_saved_version_unique ON script_working_document_revisions(saved_version_id)`,
    `CREATE INDEX script_working_document_revisions_head_snapshot_idx ON script_working_document_revisions(head_revision_snapshot_id)`,
    `CREATE INDEX script_working_document_revisions_recovery_conflict_idx ON script_working_document_revisions(recovery_conflict_id)`,
    `CREATE INDEX script_working_document_revisions_resolution_snapshot_idx ON script_working_document_revisions(resolved_revision_snapshot_id)`,
    `CREATE INDEX script_working_document_revisions_document_idx ON script_working_document_revisions(working_document_id,snapshot_kind,result_revision)`,
    `CREATE INDEX script_working_document_revisions_project_idx ON script_working_document_revisions(project_id,created_at)`
  ]
}, {
  id: '0077_script_material_restore_overlay',
  statements: [
    `ALTER TABLE script_material_workspaces ADD COLUMN restored_snapshot_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL`,
    `ALTER TABLE script_working_document_revisions ADD COLUMN snapshot_hash_version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE script_working_document_revisions ADD COLUMN material_snapshot_version_id TEXT REFERENCES draft_versions(id) ON DELETE SET NULL`,
    `CREATE TABLE script_material_ignored_tasks (
      task_id TEXT PRIMARY KEY NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ignored_at TEXT NOT NULL
    )`,
    `CREATE INDEX script_material_ignored_tasks_project_idx ON script_material_ignored_tasks(project_id,ignored_at)`
  ]
}, {
  id: '0078_draft_comparison_current_document_base',
  statements: [
    `ALTER TABLE draft_comparison_workspaces ADD COLUMN current_document_base_revision INTEGER CHECK(current_document_base_revision IS NULL OR current_document_base_revision>0)`,
    `ALTER TABLE draft_comparison_workspaces ADD COLUMN current_document_base_content_hash TEXT CHECK(current_document_base_content_hash IS NULL OR length(current_document_base_content_hash)=64)`
  ]
}, {
  id: '0079_r16b_unified_selection_annotations',
  statements: [
    `ALTER TABLE draft_candidate_revisions ADD COLUMN reasoning_effort TEXT`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN target_decision_fingerprint TEXT`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN target_kind TEXT`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN target_content TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN source_selections_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN conflicts_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE script_material_rewrite_candidates ADD COLUMN source_selections_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE script_material_rewrite_candidates ADD COLUMN conflicts_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE script_revision_messages ADD COLUMN source_selections_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE script_revision_messages ADD COLUMN conflicts_json TEXT NOT NULL DEFAULT '[]'`
  ]
}, {
  id: '0080_r16b_material_candidate_lineage',
  statements: [
    `ALTER TABLE script_material_rewrite_candidates ADD COLUMN parent_candidate_id TEXT`,
    `ALTER TABLE script_material_rewrite_candidates ADD COLUMN application_target_json TEXT`,
    `CREATE INDEX script_material_rewrite_candidates_parent_idx ON script_material_rewrite_candidates(parent_candidate_id,created_at)`
  ]
}, {
  id: '0081_r16b_revision_thread_surfaces',
  statements: [
    `ALTER TABLE script_revision_threads ADD COLUMN surface TEXT NOT NULL DEFAULT 'conversation' CHECK(surface IN ('conversation','version_compare'))`,
    `CREATE TEMP TABLE _r16b_version_thread_moves (old_thread_id TEXT NOT NULL, group_key TEXT NOT NULL, new_thread_id TEXT NOT NULL, PRIMARY KEY(old_thread_id,group_key))`,
    `INSERT INTO _r16b_version_thread_moves(old_thread_id,group_key,new_thread_id)
      SELECT keys.old_thread_id,keys.group_key,'version-migration-' || lower(hex(randomblob(16)))
      FROM (
        SELECT DISTINCT thread_id AS old_thread_id,COALESCE(task_id,id) AS group_key
        FROM script_revision_messages
        WHERE (selection_snapshot_json IS NOT NULL AND json_valid(selection_snapshot_json) AND json_extract(selection_snapshot_json,'$.applicationTarget.surface')='version_compare')
           OR (context_snapshot_json IS NOT NULL AND json_valid(context_snapshot_json) AND json_extract(context_snapshot_json,'$.selection.applicationTarget.surface')='version_compare')
      ) keys`,
    `INSERT INTO script_revision_threads(id,project_id,base_version_id,provider,surface,provider_fingerprint,provider_thread_id,model,reasoning_effort,web_search_mode,created_at,updated_at)
      SELECT moves.new_thread_id,threads.project_id,threads.base_version_id,threads.provider,'version_compare',threads.provider_fingerprint,NULL,threads.model,threads.reasoning_effort,threads.web_search_mode,threads.created_at,threads.updated_at
      FROM _r16b_version_thread_moves moves
      INNER JOIN script_revision_threads threads ON threads.id=moves.old_thread_id`,
    `UPDATE script_revision_messages
      SET thread_id=(SELECT moves.new_thread_id FROM _r16b_version_thread_moves moves WHERE moves.old_thread_id=script_revision_messages.thread_id AND moves.group_key=COALESCE(script_revision_messages.task_id,script_revision_messages.id))
      WHERE (selection_snapshot_json IS NOT NULL AND json_valid(selection_snapshot_json) AND json_extract(selection_snapshot_json,'$.applicationTarget.surface')='version_compare')
         OR (context_snapshot_json IS NOT NULL AND json_valid(context_snapshot_json) AND json_extract(context_snapshot_json,'$.selection.applicationTarget.surface')='version_compare')`,
    `UPDATE script_revision_threads SET provider_thread_id=NULL WHERE id IN (SELECT old_thread_id FROM _r16b_version_thread_moves)`,
    `DELETE FROM script_revision_threads WHERE id IN (SELECT old_thread_id FROM _r16b_version_thread_moves) AND NOT EXISTS (SELECT 1 FROM script_revision_messages WHERE script_revision_messages.thread_id=script_revision_threads.id)`,
    `DROP TABLE _r16b_version_thread_moves`,
    `CREATE INDEX script_revision_threads_surface_idx ON script_revision_threads(project_id,provider,surface,updated_at)`
  ]
}, {
  id: '0082_r16c_structured_reference_domain',
  statements: [
    `CREATE TABLE content_reference_groups (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX content_reference_groups_project_idx ON content_reference_groups(project_id,updated_at)`,
    `CREATE TABLE content_reference_group_members (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES content_reference_groups(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position>=0),
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_locator_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX content_reference_group_members_position_unique ON content_reference_group_members(group_id,position)`,
    `CREATE INDEX content_reference_group_members_group_idx ON content_reference_group_members(group_id,position)`,
    `CREATE TABLE content_temporary_attachments (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_scope TEXT NOT NULL,
      file_reference_id TEXT NOT NULL REFERENCES file_references(id) ON DELETE RESTRICT,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','processing','missing','expired')),
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX content_temporary_attachments_project_idx ON content_temporary_attachments(project_id,session_scope,created_at)`,
    `CREATE UNIQUE INDEX content_temporary_attachments_project_file_unique ON content_temporary_attachments(project_id,session_scope,file_reference_id)`,
    `CREATE TABLE project_reference_role_preferences (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('hard_constraint','key_adoption','ordinary_reference','style_reference')),
      aspect TEXT,
      scope TEXT NOT NULL CHECK(scope IN ('whole_source','source_fragment','frozen_group_members','outline_module','outline_point','current_target','whole_outline','whole_script')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id,source_key)
    )`,
    `CREATE INDEX project_reference_role_preferences_project_idx ON project_reference_role_preferences(project_id,updated_at)`,
    `CREATE TABLE content_instruction_requests (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      surface TEXT NOT NULL CHECK(surface IN ('outline_conversation','outline_generation','outline_rewrite','outline_comparison','script_conversation','script_material_first_draft','script_material_chat','script_material_rewrite','script_draft_comparison','script_version_comparison','current_script_rewrite')),
      supersedes_request_id TEXT,
      generation_id TEXT,
      request_json TEXT NOT NULL,
      common_fingerprint TEXT NOT NULL CHECK(length(common_fingerprint)=64),
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX content_instruction_requests_fingerprint_unique ON content_instruction_requests(id,common_fingerprint)`,
    `CREATE INDEX content_instruction_requests_project_idx ON content_instruction_requests(project_id,created_at)`,
    `CREATE INDEX content_instruction_requests_supersedes_idx ON content_instruction_requests(supersedes_request_id)`,
    `CREATE TRIGGER content_instruction_requests_immutable BEFORE UPDATE ON content_instruction_requests BEGIN SELECT RAISE(ABORT,'content instruction requests are immutable'); END`,
    `CREATE TABLE content_instruction_request_targets (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES content_instruction_requests(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('codex_cli','claude_cli')),
      provider_config_id TEXT NOT NULL,
      target_json TEXT NOT NULL,
      provider_security_fingerprint TEXT NOT NULL,
      provider_policy_version TEXT NOT NULL,
      runtime_version TEXT NOT NULL,
      requested_model TEXT NOT NULL,
      requested_reasoning_effort TEXT,
      history_hash TEXT NOT NULL CHECK(length(history_hash)=64),
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX content_instruction_request_targets_provider_unique ON content_instruction_request_targets(request_id,provider_config_id)`,
    `CREATE INDEX content_instruction_request_targets_request_idx ON content_instruction_request_targets(request_id,created_at)`,
    `CREATE TRIGGER content_instruction_request_targets_immutable BEFORE UPDATE ON content_instruction_request_targets BEGIN SELECT RAISE(ABORT,'content instruction request targets are immutable'); END`,
    `CREATE TABLE content_instruction_request_target_events (
      id TEXT PRIMARY KEY NOT NULL,
      target_id TEXT NOT NULL REFERENCES content_instruction_request_targets(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence>0),
      event_kind TEXT NOT NULL CHECK(event_kind IN ('started','runtime_resolved','task_linked','completed','failed','canceled')),
      actual_model TEXT,
      actual_reasoning_effort TEXT,
      provider_thread_id TEXT,
      task_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX content_instruction_request_target_events_target_idx ON content_instruction_request_target_events(target_id,created_at)`,
    `CREATE UNIQUE INDEX content_instruction_request_target_events_sequence_unique ON content_instruction_request_target_events(target_id,sequence)`,
    `CREATE UNIQUE INDEX content_instruction_request_target_events_task_kind_unique ON content_instruction_request_target_events(task_id,event_kind)`,
    `CREATE TRIGGER content_instruction_request_target_events_immutable BEFORE UPDATE ON content_instruction_request_target_events BEGIN SELECT RAISE(ABORT,'content instruction request target events are immutable'); END`
  ]
}, {
  id: '0083_r16d_request_lifecycle_and_recent_uses',
  statements: [
    `CREATE TABLE project_reference_recent_uses (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      PRIMARY KEY(project_id,source_key)
    )`,
    `CREATE INDEX project_reference_recent_uses_project_idx ON project_reference_recent_uses(project_id,last_used_at)`,
    `ALTER TABLE content_instruction_request_target_events RENAME TO _content_instruction_request_target_events_r16c`,
    `CREATE TABLE content_instruction_request_target_events (
      id TEXT PRIMARY KEY NOT NULL,
      target_id TEXT NOT NULL REFERENCES content_instruction_request_targets(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence>0),
      event_kind TEXT NOT NULL CHECK(event_kind IN ('started','requeued','runtime_resolved','task_linked','completed','failed','canceled')),
      actual_model TEXT,
      actual_reasoning_effort TEXT,
      provider_thread_id TEXT,
      task_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),
      created_at TEXT NOT NULL
    )`,
    `INSERT INTO content_instruction_request_target_events(id,target_id,sequence,event_kind,actual_model,actual_reasoning_effort,provider_thread_id,task_id,status,created_at)
      SELECT id,target_id,sequence,event_kind,actual_model,actual_reasoning_effort,provider_thread_id,task_id,status,created_at
      FROM _content_instruction_request_target_events_r16c`,
    `DROP TABLE _content_instruction_request_target_events_r16c`,
    `CREATE INDEX content_instruction_request_target_events_target_idx ON content_instruction_request_target_events(target_id,created_at)`,
    `CREATE UNIQUE INDEX content_instruction_request_target_events_sequence_unique ON content_instruction_request_target_events(target_id,sequence)`,
    `CREATE UNIQUE INDEX content_instruction_request_target_events_task_link_unique ON content_instruction_request_target_events(task_id) WHERE event_kind='task_linked' AND task_id IS NOT NULL`,
    `CREATE TRIGGER content_instruction_request_target_events_immutable BEFORE UPDATE ON content_instruction_request_target_events BEGIN SELECT RAISE(ABORT,'content instruction request target events are immutable'); END`
  ]
}, {
  id: '0084_r16d_reference_scope_preferences',
  statements: [
    `ALTER TABLE project_reference_role_preferences RENAME TO _project_reference_role_preferences_r16c`,
    `CREATE TABLE project_reference_role_preferences (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('hard_constraint','key_adoption','ordinary_reference','style_reference')),
      aspect TEXT,
      scope TEXT NOT NULL CHECK(scope IN ('whole_source','source_fragment','frozen_group_members','outline_module','outline_point','current_target','whole_outline','whole_script')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id,source_key,scope)
    )`,
    `INSERT INTO project_reference_role_preferences(project_id,source_key,source_kind,source_id,role,aspect,scope,created_at,updated_at)
      SELECT project_id,source_key,source_kind,source_id,role,aspect,scope,created_at,updated_at
      FROM _project_reference_role_preferences_r16c`,
    `DROP TABLE _project_reference_role_preferences_r16c`,
    `CREATE INDEX project_reference_role_preferences_project_idx ON project_reference_role_preferences(project_id,updated_at)`
  ]
}, {
  id: '0085_r16e_provider_input_and_fact_evidence',
  statements: [
    `ALTER TABLE script_revision_messages ADD COLUMN fact_annotations_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE draft_candidate_revisions ADD COLUMN fact_annotations_json TEXT NOT NULL DEFAULT '[]'`,
    `CREATE TABLE content_provider_input_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES content_instruction_requests(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES content_instruction_request_targets(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      input_json TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL CHECK(length(input_fingerprint)=64),
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX content_provider_input_snapshots_target_idx ON content_provider_input_snapshots(target_id,created_at)`,
    `CREATE UNIQUE INDEX content_provider_input_snapshots_task_unique ON content_provider_input_snapshots(task_id)`,
    `CREATE INDEX content_provider_input_snapshots_request_idx ON content_provider_input_snapshots(request_id,created_at)`,
    `CREATE INDEX content_provider_input_snapshots_project_idx ON content_provider_input_snapshots(project_id,created_at)`,
    `CREATE TRIGGER content_provider_input_snapshots_immutable BEFORE UPDATE ON content_provider_input_snapshots BEGIN SELECT RAISE(ABORT,'content provider input snapshots are immutable'); END`,
    `CREATE TABLE content_fact_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES content_instruction_requests(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES content_instruction_request_targets(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      annotation_id TEXT NOT NULL,
      claim TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL CHECK(source_url LIKE 'https://%'),
      accessed_at TEXT NOT NULL,
      market TEXT NOT NULL,
      fact_as_of TEXT NOT NULL,
      evidence_type TEXT NOT NULL CHECK(evidence_type IN ('fact','price')),
      currency TEXT,
      runtime_access_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX content_fact_evidence_annotation_source_unique ON content_fact_evidence(annotation_id,source_url)`,
    `CREATE INDEX content_fact_evidence_task_idx ON content_fact_evidence(task_id,created_at)`,
    `CREATE INDEX content_fact_evidence_request_idx ON content_fact_evidence(request_id,created_at)`,
    `CREATE INDEX content_fact_evidence_project_idx ON content_fact_evidence(project_id,created_at)`,
    `CREATE TRIGGER content_fact_evidence_immutable BEFORE UPDATE ON content_fact_evidence BEGIN SELECT RAISE(ABORT,'content fact evidence is immutable'); END`
  ]
}, {
  id: '0086_r16e_price_kind_and_current_fact_links',
  statements: [
    `ALTER TABLE content_fact_evidence ADD COLUMN price_kind TEXT CHECK(price_kind IS NULL OR price_kind IN ('launch_official','current_official','current_channel','user_actual'))`,
    `ALTER TABLE script_text_annotations ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]'`
  ]
}, {
  id: '0087_r31_other_income_launch_event_category',
  statements: [
    `UPDATE other_income_categories SET sort_order=60,updated_at=datetime('now') WHERE id='income-other' AND name='其他' AND sort_order=50`,
    `INSERT OR IGNORE INTO other_income_categories(id,name,description,sort_order,is_active,created_at,updated_at) VALUES('income-launch-event','发布会','品牌发布会、活动出席和现场内容合作收入',50,1,datetime('now'),datetime('now'))`
  ]
}, {
  id: '0088_r24_manual_invoice_received',
  statements: [
    `ALTER TABLE business_records ADD COLUMN invoice_received_manually_at TEXT`
  ]
}, {
  id: '0089_r21i_daily_total_minutes',
  statements: [`ALTER TABLE daily_work_logs ADD COLUMN total_minutes INTEGER CHECK(total_minutes IS NULL OR (total_minutes >= 0 AND total_minutes <= 1440))`]
}, {
  id: '0090_r21n_todo_stage_link',
  statements: [
    `ALTER TABLE todo_items ADD COLUMN stage_key TEXT CHECK(stage_key IS NULL OR stage_key IN ('materials','outline','script','production','postproduction','publishing','versions'))`,
    `CREATE INDEX todo_items_project_stage_idx ON todo_items(project_id,stage_key,planned_date)`,
    `CREATE TRIGGER todo_project_unlink_stage AFTER UPDATE OF project_id ON todo_items WHEN NEW.project_id IS NULL BEGIN UPDATE todo_items SET stage_key=NULL WHERE id=NEW.id; END`
  ]
}]

migrations.push({ id: '0091_r21p_split_production_stages', statements: [], rebuild: splitProductionStages })

migrations.push({ id: '0092_r21s_todo_stage_choice_source', statements: [
  `ALTER TABLE todo_items ADD COLUMN stage_link_source TEXT CHECK(stage_link_source IS NULL OR stage_link_source = 'manual')`,
  `CREATE TRIGGER todo_stage_unlink_source AFTER UPDATE OF stage_key ON todo_items WHEN NEW.stage_key IS NULL BEGIN UPDATE todo_items SET stage_link_source=NULL WHERE id=NEW.id; END`
] })

migrations.push({ id: '0093_r21w_business_trip', statements: [
  `ALTER TABLE schedule_items ADD COLUMN trip_json TEXT`
] })

migrations.push({ id: '0094_r21ac_stage_plan_baselines', statements: stagePlanBaselineStatements })

migrations.push({ id: '0095_r10h_content_classification', statements: contentClassificationStatements, rebuild: normalizeContentClassification })

migrations.push({ id: '0096_r10j_template_rules', statements: [
  "ALTER TABLE project_templates ADD COLUMN recommended_video_formats_json TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE project_templates ADD COLUMN recommended_project_kinds_json TEXT NOT NULL DEFAULT '[]'",
  `UPDATE project_templates SET recommended_video_formats_json='["long"]',recommended_content_type_ids_json=json_insert(recommended_content_type_ids_json,'$[#]','type-unboxing') WHERE id='template-digital-review'`,
  `UPDATE project_templates SET recommended_video_formats_json='["short"]' WHERE id='template-quick-content'`,
  `UPDATE project_templates SET recommended_project_kinds_json='["commercial"]' WHERE id='template-commercial'`
] })

migrations.push({ id: '0097_r21ae_todo_date_range', statements: [
  `ALTER TABLE todo_items ADD COLUMN date_range_json TEXT CHECK(date_range_json IS NULL OR json_valid(date_range_json))`
] })

migrations.push({ id: '0098_r46_personal_reviews', statements: [
  `CREATE TABLE personal_review_periods (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE personal_review_entries (id TEXT PRIMARY KEY NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('life','checkin','experience')), payload TEXT NOT NULL, revision INTEGER NOT NULL, trashed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
  `CREATE INDEX personal_review_entries_day ON personal_review_entries(day,trashed)`,
  `CREATE TABLE personal_review_files (entry_id TEXT NOT NULL REFERENCES personal_review_entries(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES file_references(id), PRIMARY KEY(entry_id,file_id))`
] })

migrations.push({ id: '0099_r27j_schedule_groups', statements: [
  `ALTER TABLE schedule_items ADD COLUMN group_id TEXT`,
  `CREATE INDEX schedule_items_group_idx ON schedule_items(group_id)`
], rebuild(database) {
  const logs = database.prepare("SELECT id,result_json,inverse_payload_json FROM operation_log WHERE command_type='schedule.batch-create' AND result_json IS NOT NULL").all() as { id: string; result_json: string; inverse_payload_json: string | null }[]
  for (const log of logs) {
    const items = JSON.parse(log.result_json) as import('../../shared/domain').ScheduleItem[]
    if (!Array.isArray(items) || !canGroupSchedules(items)) continue
    const rows = items.map(item => database.prepare('SELECT updated_at,group_id FROM schedule_items WHERE id=?').get(item.id) as { updated_at: string; group_id: string | null } | undefined)
    if (rows.some((row, index) => !row || row.group_id || row.updated_at !== items[index]!.updatedAt)) continue
    for (const item of items) database.prepare('UPDATE schedule_items SET group_id=? WHERE id=?').run(log.id, item.id)
    const result = items.map(item => ({ ...item, groupId: log.id }))
    const inverse = log.inverse_payload_json ? JSON.stringify({ items: result }) : null
    database.prepare('UPDATE operation_log SET result_json=?,inverse_payload_json=?,inverse_payload_bytes=? WHERE id=?').run(JSON.stringify(result), inverse, inverse ? Buffer.byteLength(inverse) : 0, log.id)
  }
} })

migrations.push({ id: '0100_r21af_todo_day_focus', statements: [
  `ALTER TABLE todo_items ADD COLUMN is_extra INTEGER NOT NULL DEFAULT 0 CHECK(is_extra IN (0,1))`,
  `CREATE TABLE todo_day_focus (day TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)))`
] })

migrations.push({ id: '0101_m2_workspace_sync', statements: workspaceSyncStatements })

migrations.push({ id: '0102_m3_workspace_v2', statements: workspaceV2Statements })

migrations.push({ id: '0103_m3_workspace_v2_domains', statements: workspaceV2DomainStatements })

migrations.push({ id: '0104_m3_workspace_access', statements: [
  `CREATE TABLE workspace_v2_grant_revisions (device_id TEXT PRIMARY KEY NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE, revision TEXT NOT NULL CHECK(length(revision)=64))`
] })

export const LATEST_MIGRATION_ID = migrations.at(-1)?.id ?? ''

export function hasPendingMigrations(database: BetterSqlite3.Database): boolean {
  const exists = database.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get()
  if (!exists) return true
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
  return migrations.some((migration) => !applied.get(migration.id))
}

function runSelectedMigrations(database: BetterSqlite3.Database, throughId: string | null): void {
  registerWorkspaceV2ProjectionFunctions(database)
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`)
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
  const record = database.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)')
  for (const migration of migrations) {
    if (applied.get(migration.id)) {
      if (migration.id === throughId) return
      continue
    }
    const foreignKeys = database.pragma('foreign_keys', { simple: true })
    if (migration.rebuild) {
      if (database.inTransaction) throw new Error('Table rebuild requires an outer migration transaction')
      database.pragma('foreign_keys = OFF')
    }
    try {
      database.transaction(() => {
        for (const statement of migration.statements) database.exec(statement)
        migration.rebuild?.(database)
        if (migration.rebuild && (database.pragma('foreign_key_check') as unknown[]).length) throw new Error('Migration foreign-key verification failed')
        record.run(migration.id, new Date().toISOString())
      })()
    } finally {
      if (migration.rebuild) database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
    }
    if (migration.id === throughId) return
  }
  if (throughId && !migrations.some((migration) => migration.id === throughId)) throw new Error(`未知迁移：${throughId}`)
}

export function runMigrations(database: BetterSqlite3.Database): void {
  runSelectedMigrations(database, null)
}

export function runMigrationsThrough(database: BetterSqlite3.Database, throughId: string): void {
  runSelectedMigrations(database, throughId)
}
