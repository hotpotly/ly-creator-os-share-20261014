import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const contentTypes = sqliteTable('content_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  defaultProjectTemplateId: text('default_project_template_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('content_types_name_unique').on(table.name)])

export const generalRecordCategories = sqliteTable('general_record_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('general_record_categories_name_unique').on(table.name)])

export const projectTemplates = sqliteTable('project_templates', {
  recommendedVideoFormatsJson: text('recommended_video_formats_json').notNull().default('[]'),
  recommendedProjectKindsJson: text('recommended_project_kinds_json').notNull().default('[]'),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  moduleKeysJson: text('module_keys_json').notNull().default('[]'),
  recommendedContentTypeIdsJson: text('recommended_content_type_ids_json').notNull().default('[]'),
  sortOrder: integer('sort_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('project_templates_name_unique').on(table.name)])

export const projects = sqliteTable('projects', {
  videoFormat: text('video_format').$type<import('../../shared/content-classification').VideoFormat>(),
  isCommercial: integer('is_commercial', { mode: 'boolean' }).notNull().default(false),
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  contentTypeId: text('content_type_id').notNull().references(() => contentTypes.id),
  appliedTemplateId: text('applied_template_id').references(() => projectTemplates.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  colorToken: text('project_color_token').notNull(),
  platformTargetsJson: text('platform_targets_json').notNull().default('[]'),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  ledgerOnly: integer('ledger_only', { mode: 'boolean' }).notNull().default(false),
  trashedAt: text('trashed_at'),
  lastOpenedAt: text('last_opened_at'),
  aiSuggestedContentTypeId: text('ai_suggested_content_type_id'),
  referenceRequirements: text('reference_requirements').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('projects_content_type_idx').on(table.contentTypeId), index('projects_status_idx').on(table.status)])

export const classificationLearningSamples = sqliteTable('classification_learning_samples', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  aiSuggestedContentTypeId: text('ai_suggested_content_type_id'),
  finalContentTypeId: text('final_content_type_id').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [index('classification_learning_samples_project_idx').on(table.projectId, table.createdAt)])

export const projectContentTypeHistory = sqliteTable('project_content_type_history', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  previousContentTypeId: text('previous_content_type_id').notNull().references(() => contentTypes.id),
  nextContentTypeId: text('next_content_type_id').notNull().references(() => contentTypes.id),
  source: text('source').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [index('project_content_type_history_project_idx').on(table.projectId, table.createdAt)])

export const projectModules = sqliteTable('project_modules', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  moduleKey: text('module_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  position: integer('position').notNull(),
  disabledAt: text('disabled_at'),
  completedAt: text('completed_at'),
  lastChangedBy: text('last_changed_by').notNull(),
  contentRootId: text('content_root_id').notNull()
}, (table) => [primaryKey({ columns: [table.projectId, table.moduleKey] })])

export const stageTimeRecords = sqliteTable('stage_time_records', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  stageKey: text('stage_key').notNull(),
  status: text('status').notNull(),
  startedDate: text('started_date'),
  startedSegment: text('started_segment'),
  completedDate: text('completed_date'),
  completedSegment: text('completed_segment'),
  startSource: text('start_source'),
  completionSource: text('completion_source'),
  actualEffortHalfDayUnits: integer('actual_effort_half_day_units'),
  plannedStartedDate: text('planned_started_date'),
  plannedStartedSegment: text('planned_started_segment'),
  plannedCompletedDate: text('planned_completed_date'),
  plannedCompletedSegment: text('planned_completed_segment'),
  estimatedDurationHalfDayUnits: integer('estimated_duration_half_day_units'),
  planManualFieldsJson: text('plan_manual_fields_json').notNull().default('[]'),
  planAutoField: text('plan_auto_field'),
  autoStartActionId: text('auto_start_action_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('stage_time_records_project_stage_unique').on(table.projectId, table.stageKey), index('stage_time_records_project_idx').on(table.projectId, table.stageKey)])

export const stagePlanBaselines = sqliteTable('stage_plan_baselines', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  stageKey: text('stage_key').notNull(),
  source: text('source').$type<'first_saved' | 'legacy'>().notNull(),
  capturedAt: text('captured_at').notNull(),
  schedules: text('schedules_json', { mode: 'json' }).$type<Array<{ id: string; projectId: string; actionType: string; startAt: string | null; endAt: string | null; scheduleKind: import('../../shared/domain').ScheduleKind }>>().notNull()
}, (table) => [primaryKey({ columns: [table.projectId, table.stageKey] })])

export const stageTimeEvents = sqliteTable('stage_time_events', {
  id: text('id').primaryKey(),
  recordId: text('record_id').notNull().references(() => stageTimeRecords.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  stageKey: text('stage_key').notNull(),
  action: text('action').notNull(),
  beforeJson: text('before_json').notNull(),
  afterJson: text('after_json').notNull(),
  actor: text('actor').notNull(),
  source: text('source').notNull(),
  recordedAt: text('recorded_at').notNull(),
  undoneAt: text('undone_at')
}, (table) => [index('stage_time_events_record_idx').on(table.recordId, table.recordedAt)])

export const operationLogs = sqliteTable('operation_log', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sessionId: text('session_id').notNull(),
  requestId: text('request_id').notNull(),
  commandType: text('command_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  label: text('label').notNull(),
  forwardPayloadJson: text('forward_payload_json').notNull(),
  resultJson: text('result_json'),
  inversePayloadJson: text('inverse_payload_json'),
  inversePayloadBytes: integer('inverse_payload_bytes').notNull().default(0),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  undoneAt: text('undone_at'),
  redoneAt: text('redone_at'),
  expiresAt: text('expires_at')
}, (table) => [
  uniqueIndex('operation_log_request_unique').on(table.requestId),
  index('operation_log_session_status_idx').on(table.sessionId, table.status, table.createdAt),
  index('operation_log_status_expiry_idx').on(table.status, table.expiresAt),
  index('operation_log_entity_idx').on(table.entityType, table.entityId, table.status)
])

export const creationReportSnapshots = sqliteTable('creation_report_snapshots', {
  id: text('id').primaryKey(),
  reportKind: text('report_kind').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  inputHash: text('input_hash').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  generatedAt: text('generated_at').notNull()
}, (table) => [
  index('creation_report_period_idx').on(table.reportKind, table.periodStart, table.generatedAt),
  index('creation_report_input_idx').on(table.reportKind, table.periodStart, table.inputHash)
])

export const creationReportThreads = sqliteTable('creation_report_threads', {
  id: text('id').primaryKey(),
  reportSnapshotId: text('report_snapshot_id').notNull().references(() => creationReportSnapshots.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('creation_report_threads_snapshot_unique').on(table.reportSnapshotId),
  index('creation_report_threads_updated_idx').on(table.updatedAt)
])

export const creationReportMessages = sqliteTable('creation_report_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => creationReportThreads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  provider: text('provider').notNull(),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('creation_report_messages_thread_idx').on(table.threadId, table.createdAt),
  uniqueIndex('creation_report_messages_task_role_unique').on(table.taskId, table.role)
])

export const scriptRevisionThreads = sqliteTable('script_revision_threads', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  baseVersionId: text('base_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  surface: text('surface').notNull().default('conversation'),
  providerFingerprint: text('provider_fingerprint').notNull(),
  providerThreadId: text('provider_thread_id'),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  webSearchMode: text('web_search_mode').notNull().default('automatic'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('script_revision_threads_project_idx').on(table.projectId, table.updatedAt),
  index('script_revision_threads_surface_idx').on(table.projectId, table.provider, table.surface, table.updatedAt),
  index('script_revision_threads_base_version_idx').on(table.baseVersionId)
])

export const scriptRevisionMessages = sqliteTable('script_revision_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => scriptRevisionThreads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  provider: text('provider').notNull(),
  selectedText: text('selected_text'),
  selectionHash: text('selection_hash'),
  selectionSnapshotJson: text('selection_snapshot_json'),
  suggestionJson: text('suggestion_json'),
  suggestionStatus: text('suggestion_status'),
  suggestionDecidedAt: text('suggestion_decided_at'),
  candidateGroupId: text('candidate_group_id'),
  candidateNumber: integer('candidate_number'),
  generationRound: integer('generation_round'),
  candidateInstruction: text('candidate_instruction'),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  contextSnapshotJson: text('context_snapshot_json'),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  sourceSelectionsJson: text('source_selections_json').notNull().default('[]'),
  conflictsJson: text('conflicts_json').notNull().default('[]'),
  webSearchMode: text('web_search_mode'),
  webSearchesJson: text('web_searches_json').notNull().default('[]'),
  factAnnotationsJson: text('fact_annotations_json').notNull().default('[]'),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('script_revision_messages_thread_idx').on(table.threadId, table.createdAt),
  index('script_revision_messages_candidate_group_idx').on(table.candidateGroupId, table.generationRound),
  uniqueIndex('script_revision_messages_task_role_unique').on(table.taskId, table.role)
])

export const draftComparisonWorkspaces = sqliteTable('draft_comparison_workspaces', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  currentDocumentBaseRevision: integer('current_document_base_revision'),
  currentDocumentBaseContentHash: text('current_document_base_content_hash'),
  claudeContent: text('claude_content').notNull().default(''),
  codexContent: text('codex_content').notNull().default(''),
  claudeSourceJson: text('claude_source_json').notNull().default('{"sourceKind":"freeform","providerConfigId":null,"provider":null,"model":null,"providerFingerprint":null,"taskId":null}'),
  codexSourceJson: text('codex_source_json').notNull().default('{"sourceKind":"freeform","providerConfigId":null,"provider":null,"model":null,"providerFingerprint":null,"taskId":null}'),
  claudeUpdatedAt: text('claude_updated_at'),
  codexUpdatedAt: text('codex_updated_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const draftComparisonSessions = sqliteTable('draft_comparison_sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  alignmentProviderConfigId: text('alignment_provider_config_id'),
  alignmentProvider: text('alignment_provider'),
  alignmentProviderKind: text('alignment_provider_kind'),
  alignmentModel: text('alignment_model'),
  alignmentProviderFingerprint: text('alignment_provider_fingerprint'),
  alignmentTaskId: text('alignment_task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('draft_comparison_sessions_project_idx').on(table.projectId, table.updatedAt),
  index('draft_comparison_sessions_task_idx').on(table.alignmentTaskId)
])

export const draftSourceSnapshots = sqliteTable('draft_source_snapshots', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => draftComparisonSessions.id, { onDelete: 'cascade' }),
  side: text('side').notNull(),
  sourceKind: text('source_kind').notNull(),
  providerConfigId: text('provider_config_id'),
  provider: text('provider'),
  providerKind: text('provider_kind'),
  model: text('model'),
  providerFingerprint: text('provider_fingerprint'),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  paragraphsJson: text('paragraphs_json').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('draft_source_snapshots_session_side_unique').on(table.sessionId, table.side),
  index('draft_source_snapshots_session_idx').on(table.sessionId)
])

export const draftAlignmentGroups = sqliteTable('draft_alignment_groups', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => draftComparisonSessions.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  labelIndex: integer('label_index').notNull(),
  matchType: text('match_type').notNull(),
  outlinePlacement: text('outline_placement').notNull().default('outside_outline'),
  outlineItemId: text('outline_item_id'),
  claudeParagraphIdsJson: text('claude_paragraph_ids_json').notNull().default('[]'),
  codexParagraphIdsJson: text('codex_paragraph_ids_json').notNull().default('[]'),
  manuallyAdjusted: integer('manually_adjusted', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('draft_alignment_groups_session_position_unique').on(table.sessionId, table.position),
  uniqueIndex('draft_alignment_groups_session_label_unique').on(table.sessionId, table.labelIndex)
])

export const draftCandidateRevisions = sqliteTable('draft_candidate_revisions', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => draftAlignmentGroups.id, { onDelete: 'cascade' }),
  parentCandidateId: text('parent_candidate_id'),
  parentTraceId: text('parent_trace_id'),
  sourceKind: text('source_kind').notNull(),
  providerConfigId: text('provider_config_id'),
  provider: text('provider'),
  providerKind: text('provider_kind'),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  providerFingerprint: text('provider_fingerprint'),
  requirement: text('requirement').notNull(),
  content: text('content').notNull(),
  summary: text('summary').notNull().default(''),
  rationale: text('rationale').notNull().default(''),
  contentHash: text('content_hash').notNull().default(''),
  characterCount: integer('character_count').notNull().default(0),
  revisionRound: integer('revision_round').notNull().default(1),
  status: text('status').notNull().default('active'),
  inputRelationChanged: integer('input_relation_changed', { mode: 'boolean' }).notNull().default(false),
  targetDecisionFingerprint: text('target_decision_fingerprint'),
  targetKind: text('target_kind'),
  targetContent: text('target_content').notNull().default(''),
  sourceSelectionsJson: text('source_selections_json').notNull().default('[]'),
  conflictsJson: text('conflicts_json').notNull().default('[]'),
  factAnnotationsJson: text('fact_annotations_json').notNull().default('[]'),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('draft_candidate_revisions_group_position_unique').on(table.groupId, table.position),
  index('draft_candidate_revisions_group_idx').on(table.groupId, table.createdAt),
  index('draft_candidate_revisions_task_idx').on(table.taskId)
])

export const draftGroupDecisions = sqliteTable('draft_group_decisions', {
  groupId: text('group_id').primaryKey().references(() => draftAlignmentGroups.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  sourceId: text('source_id'),
  sourceIdsJson: text('source_ids_json').notNull().default('[]'),
  content: text('content').notNull().default(''),
  note: text('note').notNull().default(''),
  markersJson: text('markers_json').notNull().default('[]'),
  updatedAt: text('updated_at').notNull()
})

export const draftComparisonHistory = sqliteTable('draft_comparison_history', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => draftComparisonSessions.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('draft_comparison_history_project_idx').on(table.projectId, table.createdAt),
  index('draft_comparison_history_session_idx').on(table.sessionId, table.createdAt)
])

export const draftSplitMatchCache = sqliteTable('draft_split_match_cache', {
  contentHash: text('content_hash').primaryKey(),
  matchedParagraphIdsJson: text('matched_paragraph_ids_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const scriptMaterialWorkspaces = sqliteTable('script_material_workspaces', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  workingContent: text('working_content').notNull().default(''),
  workingBaseRevisionId: text('working_base_revision_id'),
  requirement: text('requirement').notNull().default(''),
  aiCount: integer('ai_count').notNull().default(1),
  selectedAiSide: text('selected_ai_side').notNull().default('codex'),
  selectedCodexDraftId: text('selected_codex_draft_id'),
  selectedClaudeDraftId: text('selected_claude_draft_id'),
  restoredSnapshotVersionId: text('restored_snapshot_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  webSearchMode: text('web_search_mode').notNull().default('automatic'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const scriptMaterialIgnoredTasks = sqliteTable('script_material_ignored_tasks', {
  taskId: text('task_id').primaryKey().references(() => taskRuns.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  ignoredAt: text('ignored_at').notNull()
}, (table) => [index('script_material_ignored_tasks_project_idx').on(table.projectId, table.ignoredAt)])

export const scriptMaterialRevisions = sqliteTable('script_material_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  pointsConfirmed: integer('points_confirmed', { mode: 'boolean' }).notNull().default(false),
  confirmedAt: text('confirmed_at'),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('script_material_revisions_project_revision_unique').on(table.projectId, table.revision),
  index('script_material_revisions_project_created_idx').on(table.projectId, table.createdAt)
])

export const scriptMaterialPoints = sqliteTable('script_material_points', {
  id: text('id').primaryKey(),
  stableId: text('stable_id').notNull(),
  revisionId: text('revision_id').notNull().references(() => scriptMaterialRevisions.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  sourceStart: integer('source_start').notNull(),
  sourceEnd: integer('source_end').notNull(),
  sourceText: text('source_text').notNull(),
  summary: text('summary').notNull(),
  requirement: text('requirement').notNull().default(''),
  adoption: text('adoption').notNull().default('required'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('script_material_points_revision_position_unique').on(table.revisionId, table.position),
  uniqueIndex('script_material_points_revision_stable_unique').on(table.revisionId, table.stableId),
  index('script_material_points_revision_idx').on(table.revisionId)
])

export const scriptMaterialDrafts = sqliteTable('script_material_drafts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id').notNull().references(() => scriptMaterialRevisions.id, { onDelete: 'cascade' }),
  side: text('side').notNull(),
  sourceKind: text('source_kind').notNull(),
  providerConfigId: text('provider_config_id'),
  providerKind: text('provider_kind'),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  providerFingerprint: text('provider_fingerprint'),
  requirement: text('requirement').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  draftVersion: integer('draft_version').notNull().default(1),
  mappingState: text('mapping_state').notNull().default('ready'),
  mappingTaskId: text('mapping_task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  mappingError: text('mapping_error'),
  currentContentHash: text('current_content_hash'),
  currentMappingsJson: text('current_mappings_json').notNull().default('[]'),
  paragraphsJson: text('paragraphs_json').notNull().default('[]'),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('script_material_drafts_revision_side_version_unique').on(table.revisionId, table.side, table.draftVersion),
  index('script_material_drafts_project_idx').on(table.projectId, table.updatedAt),
  index('script_material_drafts_task_idx').on(table.taskId)
])

export const scriptMaterialRewriteCandidates = sqliteTable('script_material_rewrite_candidates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id').notNull().references(() => scriptMaterialRevisions.id, { onDelete: 'cascade' }),
  draftId: text('draft_id').notNull().references(() => scriptMaterialDrafts.id, { onDelete: 'cascade' }),
  side: text('side').notNull(),
  parentCandidateId: text('parent_candidate_id'),
  applicationTargetJson: text('application_target_json'),
  paragraphIdsJson: text('paragraph_ids_json').notNull().default('[]'),
  selectedText: text('selected_text').notNull().default(''),
  selectedStart: integer('selected_start'),
  selectedEnd: integer('selected_end'),
  requirement: text('requirement').notNull(),
  content: text('content').notNull(),
  sourcePointIdsJson: text('source_point_ids_json').notNull().default('[]'),
  annotationsJson: text('annotations_json').notNull().default('[]'),
  providerConfigId: text('provider_config_id'),
  providerKind: text('provider_kind'),
  model: text('model'),
  reasoningEffort: text('reasoning_effort'),
  sourceSelectionsJson: text('source_selections_json').notNull().default('[]'),
  conflictsJson: text('conflicts_json').notNull().default('[]'),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('script_material_rewrite_candidates_revision_idx').on(table.revisionId, table.createdAt),
  index('script_material_rewrite_candidates_draft_idx').on(table.draftId, table.createdAt),
  index('script_material_rewrite_candidates_parent_idx').on(table.parentCandidateId, table.createdAt),
  uniqueIndex('script_material_rewrite_candidates_task_unique').on(table.taskId)
])

export const scriptMaterialMessages = sqliteTable('script_material_messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id').notNull().references(() => scriptMaterialRevisions.id, { onDelete: 'cascade' }),
  side: text('side').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('script_material_messages_revision_side_idx').on(table.revisionId, table.side, table.createdAt),
  index('script_material_messages_task_idx').on(table.taskId)
])

export const scriptMaterialChecks = sqliteTable('script_material_checks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id').notNull().references(() => scriptMaterialRevisions.id, { onDelete: 'cascade' }),
  target: text('target').notNull(),
  targetIdentity: text('target_identity').notNull().default(''),
  targetContentHash: text('target_content_hash').notNull(),
  inputFingerprint: text('input_fingerprint').notNull().default(''),
  state: text('state').notNull(),
  pointCoverageJson: text('point_coverage_json').notNull().default('[]'),
  paragraphFindingsJson: text('paragraph_findings_json').notNull().default('[]'),
  allowedOmissionPointIdsJson: text('allowed_omission_point_ids_json').notNull().default('[]'),
  taskId: text('task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  errorMessage: text('error_message'),
  checkedAt: text('checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('script_material_checks_revision_identity_unique').on(table.revisionId, table.targetIdentity),
  index('script_material_checks_project_idx').on(table.projectId, table.updatedAt),
  index('script_material_checks_task_idx').on(table.taskId)
])

export const scriptMaterialVersionSnapshots = sqliteTable('script_material_version_snapshots', {
  versionId: text('version_id').primaryKey().references(() => draftVersions.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull().default(2),
  sourceRevisionId: text('source_revision_id').notNull(),
  sourceRevisionHash: text('source_revision_hash').notNull(),
  currentContentHash: text('current_content_hash').notNull(),
  workspaceContentHash: text('workspace_content_hash').notNull().default(''),
  auditInputFingerprint: text('audit_input_fingerprint').notNull(),
  workspaceSnapshotJson: text('workspace_snapshot_json').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  finalizationJson: text('finalization_json'),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('script_material_version_snapshots_project_idx').on(table.projectId, table.createdAt)
])

export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(),
  resourceType: text('resource_type').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  contentTypeId: text('content_type_id').references(() => contentTypes.id, { onDelete: 'set null' }),
  origin: text('origin').notNull(),
  selectionMode: text('selection_mode').notNull(),
  version: integer('version').notNull().default(1),
  payloadJson: text('payload_json').notNull().default('{}'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('resources_content_type_idx').on(table.contentTypeId, table.selectionMode), index('resources_active_idx').on(table.isActive, table.resourceType)])

export const projectResourceReferences = sqliteTable('project_resource_references', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  selectionSource: text('selection_source').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [primaryKey({ columns: [table.projectId, table.resourceId] }), index('project_resource_references_project_idx').on(table.projectId, table.enabled)])

export const fileReferences = sqliteTable('file_references', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().default('file'),
  relativePath: text('relative_path').notNull(),
  managedLocator: text('managed_locator').notNull().default(''),
  originalName: text('original_name').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  mimeType: text('mime_type').notNull(),
  sourceModifiedAt: text('source_modified_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull().default(''),
  encryptedSourcePath: text('encrypted_source_path'),
  sourceBookmark: text('source_bookmark'),
  sourceOrigin: text('source_origin').notNull().default('managed_import'),
  availability: text('availability').notNull().default('available'),
  processState: text('process_state').notNull().default('ready'),
  capabilitiesJson: text('capabilities_json').notNull().default('[]')
}, (table) => [
  uniqueIndex('file_references_relative_path_unique').on(table.relativePath),
  uniqueIndex('file_references_managed_locator_unique').on(table.managedLocator).where(sql`${table.managedLocator} <> ''`),
  index('file_references_sha256_idx').on(table.sha256, table.kind)
])

// Personal review records own goals and prose, but reference the shared managed-file registry.
export const personalReviewPeriods = sqliteTable('personal_review_periods', {
  id: text('id').primaryKey(), payload: text('payload').notNull(),
  revision: integer('revision').notNull(), updatedAt: text('updated_at').notNull()
})
export const personalReviewEntries = sqliteTable('personal_review_entries', {
  id: text('id').primaryKey(), day: text('day').notNull(), kind: text('kind').notNull(),
  payload: text('payload').notNull(), revision: integer('revision').notNull(),
  trashed: integer('trashed').notNull().default(0), updatedAt: text('updated_at').notNull()
}, table => [index('personal_review_entries_day').on(table.day, table.trashed)])
export const personalReviewFiles = sqliteTable('personal_review_files', {
  entryId: text('entry_id').notNull().references(() => personalReviewEntries.id, { onDelete: 'cascade' }),
  fileId: text('file_id').notNull().references(() => fileReferences.id)
}, table => [primaryKey({ columns: [table.entryId, table.fileId] })])

export const projectMaterials = sqliteTable('project_materials', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  sourceKind: text('source_kind').notNull(),
  title: text('title').notNull(),
  textContent: text('text_content'),
  sourceUrl: text('source_url'),
  fileId: text('file_reference_id').references(() => fileReferences.id, { onDelete: 'set null' }),
  pageCount: integer('page_count'),
  parseStatus: text('parse_status').notNull(),
  isPrimaryReference: integer('is_primary_reference', { mode: 'boolean' }).notNull().default(false),
  attentionNote: text('attention_note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('project_materials_project_idx').on(table.projectId, table.createdAt), index('project_materials_role_idx').on(table.projectId, table.role)])

export const projectAssetLinks = sqliteTable('project_asset_links', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  projectMaterialId: text('project_material_id').notNull().references(() => projectMaterials.id, { onDelete: 'cascade' }),
  fileReferenceId: text('file_reference_id').notNull().references(() => fileReferences.id, { onDelete: 'cascade' }),
  parentLinkId: text('parent_link_id'),
  relativePath: text('relative_path').notNull(),
  position: integer('position').notNull(),
  usageType: text('usage_type'),
  isPrimaryReference: integer('is_primary_reference', { mode: 'boolean' }).notNull().default(false),
  attentionNote: text('attention_note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('project_asset_links_material_file_unique').on(table.projectMaterialId, table.fileReferenceId),
  uniqueIndex('project_asset_links_material_path_unique').on(table.projectMaterialId, table.relativePath),
  index('project_asset_links_project_idx').on(table.projectId, table.position),
  index('project_asset_links_parent_idx').on(table.parentLinkId, table.position),
  index('project_asset_links_primary_idx').on(table.projectId, table.isPrimaryReference, table.position)
])

export const draftVersions = sqliteTable('draft_versions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  documentType: text('document_type').notNull(),
  kind: text('kind').notNull(),
  parentVersionIdsJson: text('parent_version_ids_json').notNull().default('[]'),
  content: text('content').notNull(),
  workspaceContent: text('workspace_content'),
  sourceFilePath: text('source_file_path'),
  sourceFileId: text('source_file_id').references(() => fileReferences.id),
  sourceTaskId: text('source_task_id'),
  sourceCandidateId: text('source_candidate_id'),
  resourceSnapshotJson: text('resource_snapshot_json'),
  revision: integer('revision').notNull(),
  resolvedAt: text('resolved_at'),
  isFinal: integer('is_final', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [index('draft_versions_project_document_idx').on(table.projectId, table.documentType, table.createdAt), uniqueIndex('draft_versions_project_document_revision_unique').on(table.projectId, table.documentType, table.revision)])

export const projectCurrentScriptDocuments = sqliteTable('project_current_script_documents', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  workingDocumentId: text('working_document_id').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  revision: integer('revision').notNull().default(1),
  editorDocumentJson: text('editor_document_json').notNull(),
  contentHash: text('content_hash').notNull(),
  lastSavedVersionId: text('last_saved_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  lastMutationId: text('last_mutation_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('project_current_script_documents_working_unique').on(table.workingDocumentId),
  index('project_current_script_documents_saved_version_idx').on(table.lastSavedVersionId)
])

export const currentScriptSourceRelations = sqliteTable('current_script_source_relations', {
  id: text('id').primaryKey(),
  workingDocumentId: text('working_document_id').notNull().references(() => projectCurrentScriptDocuments.workingDocumentId, { onDelete: 'cascade' }),
  targetBlockId: text('target_block_id').notNull(),
  targetStart: integer('target_start').notNull(),
  targetEnd: integer('target_end').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceVersion: text('source_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('current_script_source_relations_target_idx').on(table.workingDocumentId, table.targetBlockId, table.targetStart, table.targetEnd),
  index('current_script_source_relations_source_idx').on(table.sourceKind, table.sourceId, table.sourceVersion),
  uniqueIndex('current_script_source_relations_unique').on(table.workingDocumentId, table.targetBlockId, table.targetStart, table.targetEnd, table.sourceKind, table.sourceId, table.sourceVersion)
])

export const scriptTextAnnotations = sqliteTable('script_text_annotations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceVersion: text('source_version').notNull(),
  coordinateSpace: text('coordinate_space').notNull().default('block_text'),
  blockId: text('block_id').notNull(),
  blockStart: integer('block_start').notNull(),
  blockEnd: integer('block_end').notNull(),
  selectedText: text('selected_text').notNull(),
  style: text('style').notNull(),
  note: text('note').notNull().default(''),
  evidenceIdsJson: text('evidence_ids_json').notNull().default('[]'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('script_text_annotations_source_idx').on(table.projectId, table.sourceKind, table.sourceId, table.sourceVersion, table.blockId),
  index('script_text_annotations_status_idx').on(table.projectId, table.status, table.updatedAt)
])

export const contentReferenceGroups = sqliteTable('content_reference_groups', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('content_reference_groups_project_idx').on(table.projectId, table.updatedAt)
])

export const contentReferenceGroupMembers = sqliteTable('content_reference_group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => contentReferenceGroups.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceLocatorJson: text('source_locator_json').notNull().default('{}'),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('content_reference_group_members_position_unique').on(table.groupId, table.position),
  index('content_reference_group_members_group_idx').on(table.groupId, table.position)
])

export const contentTemporaryAttachments = sqliteTable('content_temporary_attachments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sessionScope: text('session_scope').notNull(),
  fileReferenceId: text('file_reference_id').notNull().references(() => fileReferences.id, { onDelete: 'restrict' }),
  contentSha256: text('content_sha256').notNull(),
  state: text('state').notNull().default('ready'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('content_temporary_attachments_project_idx').on(table.projectId, table.sessionScope, table.createdAt),
  uniqueIndex('content_temporary_attachments_project_file_unique').on(table.projectId, table.sessionScope, table.fileReferenceId)
])

export const projectReferenceRolePreferences = sqliteTable('project_reference_role_preferences', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  role: text('role').notNull(),
  aspect: text('aspect'),
  scope: text('scope').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.projectId, table.sourceKey, table.scope] }),
  index('project_reference_role_preferences_project_idx').on(table.projectId, table.updatedAt)
])

export const projectReferenceRecentUses = sqliteTable('project_reference_recent_uses', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  lastUsedAt: text('last_used_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.projectId, table.sourceKey] }),
  index('project_reference_recent_uses_project_idx').on(table.projectId, table.lastUsedAt)
])

export const contentInstructionRequests = sqliteTable('content_instruction_requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  surface: text('surface').notNull(),
  supersedesRequestId: text('supersedes_request_id'),
  generationId: text('generation_id'),
  requestJson: text('request_json').notNull(),
  commonFingerprint: text('common_fingerprint').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('content_instruction_requests_fingerprint_unique').on(table.id, table.commonFingerprint),
  index('content_instruction_requests_project_idx').on(table.projectId, table.createdAt),
  index('content_instruction_requests_supersedes_idx').on(table.supersedesRequestId)
])

export const contentInstructionRequestTargets = sqliteTable('content_instruction_request_targets', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => contentInstructionRequests.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerConfigId: text('provider_config_id').notNull(),
  targetJson: text('target_json').notNull(),
  providerSecurityFingerprint: text('provider_security_fingerprint').notNull(),
  providerPolicyVersion: text('provider_policy_version').notNull(),
  runtimeVersion: text('runtime_version').notNull(),
  requestedModel: text('requested_model').notNull(),
  requestedReasoningEffort: text('requested_reasoning_effort'),
  historyHash: text('history_hash').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('content_instruction_request_targets_provider_unique').on(table.requestId, table.providerConfigId),
  index('content_instruction_request_targets_request_idx').on(table.requestId, table.createdAt)
])

export const contentInstructionRequestTargetEvents = sqliteTable('content_instruction_request_target_events', {
  id: text('id').primaryKey(),
  targetId: text('target_id').notNull().references(() => contentInstructionRequestTargets.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  eventKind: text('event_kind').notNull(),
  actualModel: text('actual_model'),
  actualReasoningEffort: text('actual_reasoning_effort'),
  providerThreadId: text('provider_thread_id'),
  taskId: text('task_id'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('content_instruction_request_target_events_target_idx').on(table.targetId, table.createdAt),
  uniqueIndex('content_instruction_request_target_events_sequence_unique').on(table.targetId, table.sequence),
  uniqueIndex('content_instruction_request_target_events_task_link_unique').on(table.taskId)
    .where(sql`${table.eventKind} = 'task_linked' AND ${table.taskId} IS NOT NULL`)
])

export const contentProviderInputSnapshots = sqliteTable('content_provider_input_snapshots', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => contentInstructionRequests.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => contentInstructionRequestTargets.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull(),
  inputJson: text('input_json').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('content_provider_input_snapshots_target_idx').on(table.targetId, table.createdAt),
  uniqueIndex('content_provider_input_snapshots_task_unique').on(table.taskId),
  index('content_provider_input_snapshots_request_idx').on(table.requestId, table.createdAt),
  index('content_provider_input_snapshots_project_idx').on(table.projectId, table.createdAt)
])

export const contentFactEvidence = sqliteTable('content_fact_evidence', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull().references(() => contentInstructionRequests.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => contentInstructionRequestTargets.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull(),
  annotationId: text('annotation_id').notNull(),
  claim: text('claim').notNull(),
  sourceTitle: text('source_title').notNull(),
  sourceUrl: text('source_url').notNull(),
  accessedAt: text('accessed_at').notNull(),
  market: text('market').notNull(),
  factAsOf: text('fact_as_of').notNull(),
  evidenceType: text('evidence_type').notNull(),
  priceKind: text('price_kind'),
  currency: text('currency'),
  runtimeAccessId: text('runtime_access_id').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('content_fact_evidence_annotation_source_unique').on(table.annotationId, table.sourceUrl),
  index('content_fact_evidence_task_idx').on(table.taskId, table.createdAt),
  index('content_fact_evidence_request_idx').on(table.requestId, table.createdAt),
  index('content_fact_evidence_project_idx').on(table.projectId, table.createdAt)
])

export const scriptWorkingDocumentRevisions = sqliteTable('script_working_document_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workingDocumentId: text('working_document_id').notNull(),
  snapshotKind: text('snapshot_kind').notNull(),
  conflictReason: text('conflict_reason'),
  headRevisionSnapshotId: text('head_revision_snapshot_id'),
  snapshotSavedVersionId: text('snapshot_saved_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  materialSnapshotVersionId: text('material_snapshot_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  recoveryConflictId: text('recovery_conflict_id'),
  baseRevision: integer('base_revision').notNull(),
  baseContentHash: text('base_content_hash').notNull(),
  resultRevision: integer('result_revision'),
  headRevisionAtWrite: integer('head_revision_at_write').notNull(),
  headContentHashAtWrite: text('head_content_hash_at_write').notNull(),
  documentUpdatedAt: text('document_updated_at').notNull(),
  editorDocumentJson: text('editor_document_json').notNull(),
  sourceRelationsJson: text('source_relations_json').notNull().default('[]'),
  annotationsJson: text('annotations_json').notNull().default('[]'),
  sourceRelationSnapshotsJson: text('source_relation_snapshots_json').notNull().default('[]'),
  annotationSnapshotsJson: text('annotation_snapshots_json').notNull().default('[]'),
  contentHash: text('content_hash').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  snapshotHashVersion: integer('snapshot_hash_version').notNull().default(1),
  clientMutationId: text('client_mutation_id').notNull(),
  mutationFingerprint: text('mutation_fingerprint').notNull(),
  savedVersionId: text('saved_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  resolutionKind: text('resolution_kind'),
  resolvedRevisionSnapshotId: text('resolved_revision_snapshot_id'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('script_working_document_revisions_mutation_unique').on(table.projectId, table.clientMutationId),
  uniqueIndex('script_working_document_revisions_saved_version_unique').on(table.savedVersionId),
  index('script_working_document_revisions_head_snapshot_idx').on(table.headRevisionSnapshotId),
  index('script_working_document_revisions_recovery_conflict_idx').on(table.recoveryConflictId),
  index('script_working_document_revisions_resolution_snapshot_idx').on(table.resolvedRevisionSnapshotId),
  index('script_working_document_revisions_document_idx').on(table.workingDocumentId, table.snapshotKind, table.resultRevision),
  index('script_working_document_revisions_project_idx').on(table.projectId, table.createdAt)
])

export const projectPublishingMaterials = sqliteTable('project_publishing_materials', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  materialKind: text('material_kind').notNull(),
  textValue: text('text_value'),
  fileId: text('file_id').references(() => fileReferences.id, { onDelete: 'set null' }),
  sourceVersionId: text('source_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('project_publishing_material_unique').on(table.projectId, table.platform, table.materialKind), index('project_publishing_material_project_idx').on(table.projectId, table.platform)])

export const coverCandidates = sqliteTable('cover_candidates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  fileId: text('file_id').notNull().references(() => fileReferences.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  layout: text('layout').notNull(),
  generationMode: text('generation_mode').notNull(),
  headline: text('headline').notNull().default(''),
  promptSnapshot: text('prompt_snapshot').notNull(),
  sourceVersionId: text('source_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  isSelected: integer('is_selected', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('cover_candidates_task_position_unique').on(table.taskId, table.position),
  index('cover_candidates_project_platform_idx').on(table.projectId, table.platform, table.createdAt)
])

export const titleCandidates = sqliteTable('title_candidates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  provider: text('provider').notNull(),
  angle: text('angle').notNull(),
  title: text('title').notNull(),
  coverText: text('cover_text').notNull(),
  sourceVersionId: text('source_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  masterTitleSnapshot: text('master_title_snapshot'),
  isSelected: integer('is_selected', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('title_candidates_project_platform_idx').on(table.projectId, table.platform, table.createdAt),
  index('title_candidates_task_idx').on(table.taskId)
])

export const subtitleJobs = sqliteTable('subtitle_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  inputFileId: text('input_file_id').notNull().references(() => fileReferences.id, { onDelete: 'restrict' }),
  schema: text('schema').notNull(),
  engine: text('engine').notNull(),
  language: text('language'),
  sourceVersionId: text('source_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  confirmedZhArtifactId: text('confirmed_zh_artifact_id'),
  transcriptJson: text('transcript_json'),
  anomaliesJson: text('anomalies_json').notNull().default('[]'),
  stylePresetJson: text('style_preset_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('subtitle_jobs_task_unique').on(table.taskId),
  index('subtitle_jobs_project_idx').on(table.projectId, table.createdAt)
])

export const subtitleArtifacts = sqliteTable('subtitle_artifacts', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => subtitleJobs.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  fileId: text('file_id').notNull().references(() => fileReferences.id, { onDelete: 'cascade' }),
  artifactKind: text('artifact_kind').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('subtitle_artifacts_job_kind_unique').on(table.jobId, table.artifactKind),
  index('subtitle_artifacts_project_idx').on(table.projectId, table.createdAt)
])

export const publishingHandoffs = sqliteTable('publishing_handoffs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  adapterId: text('adapter_id').notNull(),
  targetUrl: text('target_url').notNull(),
  status: text('status').notNull(),
  packageSnapshotJson: text('package_snapshot_json').notNull(),
  checklistJson: text('checklist_json').notNull(),
  issuesJson: text('issues_json').notNull(),
  openedAt: text('opened_at'),
  confirmedAt: text('confirmed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('publishing_handoffs_project_platform_idx').on(table.projectId, table.platform, table.createdAt)])

export const publishingComputerUsePilots = sqliteTable('publishing_computer_use_pilots', {
  id: text('id').primaryKey(),
  handoffId: text('handoff_id').notNull().references(() => publishingHandoffs.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  status: text('status').notNull(),
  accountName: text('account_name').notNull(),
  clipboardSha256: text('clipboard_sha256').notNull(),
  lastError: text('last_error'),
  openedAt: text('opened_at'),
  readyForReviewAt: text('ready_for_review_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('publishing_computer_use_pilots_project_created_idx').on(table.projectId, table.createdAt),
  index('publishing_computer_use_pilots_handoff_status_idx').on(table.handoffId, table.status)
])

export const publishingAccounts = sqliteTable('publishing_accounts', {
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  accountName: text('account_name').notNull(),
  positioning: text('positioning').notNull().default(''),
  contactCiphertext: text('contact_ciphertext'),
  status: text('status').notNull().default('active'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('publishing_accounts_platform_order_idx').on(table.platform, table.sortOrder, table.createdAt),
  uniqueIndex('publishing_accounts_platform_name_unique').on(table.platform, table.accountName)
])

export const projectPublishingAccounts = sqliteTable('project_publishing_accounts', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  accountId: text('account_id').notNull().references(() => publishingAccounts.id, { onDelete: 'restrict' }),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.projectId, table.platform] }),
  index('project_publishing_accounts_account_idx').on(table.accountId)
])

export const distributionBatches = sqliteTable('distribution_batches', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceProjectId: text('source_project_id').references(() => projects.id, { onDelete: 'set null' }),
  sourceVersionId: text('source_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  sourceText: text('source_text').notNull(),
  status: text('status').notNull().default('draft'),
  analysisTaskId: text('analysis_task_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('distribution_batches_status_updated_idx').on(table.status, table.updatedAt),
  index('distribution_batches_project_idx').on(table.sourceProjectId, table.updatedAt)
])

export const distributionSegments = sqliteTable('distribution_segments', {
  id: text('id').primaryKey(),
  batchId: text('batch_id').notNull().references(() => distributionBatches.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  startTimecode: text('start_timecode').notNull(),
  endTimecode: text('end_timecode').notNull(),
  theme: text('theme').notNull(),
  summary: text('summary').notNull(),
  fileId: text('file_id').references(() => fileReferences.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('distribution_segments_batch_position_unique').on(table.batchId, table.position),
  index('distribution_segments_file_idx').on(table.fileId)
])

export const distributionTargets = sqliteTable('distribution_targets', {
  id: text('id').primaryKey(),
  segmentId: text('segment_id').notNull().references(() => distributionSegments.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  accountId: text('account_id').notNull().references(() => publishingAccounts.id, { onDelete: 'restrict' }),
  accountNameSnapshot: text('account_name_snapshot').notNull(),
  status: text('status').notNull().default('pending'),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('distribution_targets_segment_account_unique').on(table.segmentId, table.accountId),
  index('distribution_targets_segment_status_idx').on(table.segmentId, table.status)
])

export const feishuHandoffs = sqliteTable('feishu_handoffs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceVersionId: text('source_version_id').notNull().references(() => draftVersions.id, { onDelete: 'restrict' }),
  targetHandoffId: text('target_handoff_id'),
  mode: text('mode').notNull(),
  accountName: text('account_name').notNull(),
  documentUrl: text('document_url'),
  contentSha256: text('content_sha256').notNull(),
  copiedAt: text('copied_at'),
  wordExportedAt: text('word_exported_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('feishu_handoffs_project_updated_idx').on(table.projectId, table.updatedAt),
  index('feishu_handoffs_project_url_idx').on(table.projectId, table.documentUrl),
  index('feishu_handoffs_target_idx').on(table.targetHandoffId)
])

export const archiveSequences = sqliteTable('archive_sequences', {
  category: text('category').notNull(),
  year: integer('year').notNull(),
  nextSequence: integer('next_sequence').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [primaryKey({ columns: [table.category, table.year] })])

export const projectArchiveIdentities = sqliteTable('project_archive_identities', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  year: integer('year').notNull(),
  sequence: integer('sequence').notNull(),
  categoryLabel: text('category_label').notNull(),
  relativeDirectory: text('relative_directory').notNull(),
  commercialSnapshot: integer('commercial_snapshot', { mode: 'boolean' }).notNull(),
  titleSnapshot: text('title_snapshot').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [uniqueIndex('project_archive_identity_number_unique').on(table.category, table.year, table.sequence)])

export const projectArchiveSlots = sqliteTable('project_archive_slots', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  slot: text('slot').notNull(),
  selectionStatus: text('selection_status').notNull(),
  fileId: text('file_id').references(() => fileReferences.id, { onDelete: 'set null' }),
  updatedAt: text('updated_at').notNull()
}, (table) => [primaryKey({ columns: [table.projectId, table.slot] }), index('project_archive_slots_file_idx').on(table.fileId)])

export const archiveRuns = sqliteTable('archive_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskRunId: text('task_run_id').notNull().references(() => taskRuns.id, { onDelete: 'restrict' }),
  destinationId: text('destination_id').notNull(),
  destinationRevision: text('destination_revision').notNull(),
  category: text('category').notNull(),
  categoryLabel: text('category_label').notNull(),
  year: integer('year').notNull(),
  sequence: integer('sequence').notNull(),
  folderName: text('folder_name').notNull(),
  relativeDirectory: text('relative_directory').notNull(),
  commercialSnapshot: integer('commercial_snapshot', { mode: 'boolean' }).notNull(),
  status: text('status').notNull(),
  planHash: text('plan_hash').notNull(),
  confirmedAt: text('confirmed_at').notNull(),
  manifestSha256: text('manifest_sha256'),
  manifestRelativePath: text('manifest_relative_path'),
  missingCount: integer('missing_count').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at')
}, (table) => [
  uniqueIndex('archive_runs_task_unique').on(table.taskRunId),
  index('archive_runs_project_created_idx').on(table.projectId, table.createdAt),
  index('archive_runs_status_idx').on(table.status, table.updatedAt)
])

export const archiveItems = sqliteTable('archive_items', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => archiveRuns.id, { onDelete: 'cascade' }),
  slot: text('slot').notNull(),
  ordinal: integer('ordinal').notNull(),
  selectionStatus: text('selection_status').notNull(),
  sourceFileId: text('source_file_id').references(() => fileReferences.id, { onDelete: 'set null' }),
  sourceVersionId: text('source_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  sourceName: text('source_name').notNull(),
  sourceLocator: text('source_locator'),
  sourceOrigin: text('source_origin'),
  sizeBytes: integer('size_bytes'),
  sourceSha256: text('source_sha256'),
  targetSha256: text('target_sha256'),
  temporaryRelativePath: text('temporary_relative_path'),
  finalRelativePath: text('final_relative_path'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  temporaryRemoved: integer('temporary_removed', { mode: 'boolean' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('archive_items_run_slot_ordinal_unique').on(table.runId, table.slot, table.ordinal),
  index('archive_items_run_status_idx').on(table.runId, table.status)
])

export const nasBackupState = sqliteTable('nas_backup_state', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  backupDate: text('backup_date'),
  lastAttemptAt: text('last_attempt_at'),
  lastSucceededAt: text('last_succeeded_at'),
  errorMessage: text('error_message'),
  updatedAt: text('updated_at').notNull()
})

export const businessRecords = sqliteTable('business_records', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  dealStatus: text('deal_status').notNull().default('ordered'),
  manualSettledAt: text('manual_settled_at'),
  orderPlatform: text('order_platform').notNull().default(''),
  orderPlatformManuallySet: integer('order_platform_manually_set', { mode: 'boolean' }).notNull().default(false),
  orderDate: text('order_date'),
  revenueMonth: text('revenue_month'),
  quotedAmountCents: integer('quoted_amount_cents'),
  platformOrderAmountCents: integer('platform_order_amount_cents'),
  rebateInputMode: text('rebate_input_mode').notNull().default('rate'),
  finalRebateRatePercent: real('final_rebate_rate_percent'),
  finalRebateAmountCents: integer('final_rebate_amount_cents'),
  rebateRequirement: text('rebate_requirement').notNull().default('pending_confirmation'),
  rebateRecipientType: text('rebate_recipient_type').notNull().default('unknown'),
  rebateRecipientName: text('rebate_recipient_name').notNull().default(''),
  rebateProcedureStatus: text('rebate_procedure_status').notNull().default('preparing'),
  plannedRebateDate: text('planned_rebate_date'),
  paymentStatus: text('payment_status').notNull().default('pending'),
  paymentReceivedDate: text('payment_received_date'),
  invoiceRequirement: text('invoice_requirement').notNull().default('pending_confirmation'),
  invoiceReceivedManuallyAt: text('invoice_received_manually_at'),
  videoProductionCostCents: integer('video_production_cost_cents').notNull().default(0),
  trafficPromotionCostCents: integer('traffic_promotion_cost_cents').notNull().default(0),
  incomeAttributionDate: text('income_attribution_date'),
  notes: text('notes').notNull().default(''),
  trashedAt: text('trashed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('business_records_income_date_idx').on(table.incomeAttributionDate, table.orderDate)])

export const otherIncomeCategories = sqliteTable('other_income_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('other_income_categories_name_unique').on(table.name),
  index('other_income_categories_active_sort_idx').on(table.isActive, table.sortOrder)
])

export const otherIncomeRecords = sqliteTable('other_income_records', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  categoryId: text('category_id').references(() => otherIncomeCategories.id, { onDelete: 'set null' }),
  sourceName: text('source_name').notNull().default(''),
  revenueMonth: text('revenue_month'),
  incomeDate: text('income_date'),
  amountCents: integer('amount_cents').notNull(),
  directCostCents: integer('direct_cost_cents').notNull().default(0),
  paymentStatus: text('payment_status').notNull().default('pending'),
  paymentReceivedDate: text('payment_received_date'),
  status: text('status').notNull().default('active'),
  currency: text('currency').notNull().default('CNY'),
  notes: text('notes').notNull().default(''),
  sourceReference: text('source_reference').notNull().default(''),
  sourceTransactionId: text('source_transaction_id').notNull().default(''),
  sourceHash: text('source_hash').notNull().default(''),
  originalFileId: text('original_file_id').references(() => fileReferences.id, { onDelete: 'set null' }),
  trashedAt: text('trashed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('other_income_records_stats_idx').on(table.revenueMonth, table.incomeDate, table.status, table.trashedAt),
  index('other_income_records_category_idx').on(table.categoryId, table.createdAt),
  index('other_income_records_transaction_idx').on(table.sourceTransactionId),
  index('other_income_records_hash_idx').on(table.sourceHash)
])

export const otherIncomeCompanyAliases = sqliteTable('other_income_company_aliases', {
  id: text('id').primaryKey(),
  companyName: text('company_name').notNull(),
  alias: text('alias').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('other_income_company_alias_unique').on(table.companyName, table.alias),
  index('other_income_company_alias_lookup_idx').on(table.alias)
])

export const otherIncomeImportRules = sqliteTable('other_income_import_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  instruction: text('instruction').notNull(),
  conditionsJson: text('conditions_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('other_income_import_rules_name_unique').on(table.name)])

export const rebatePayments = sqliteTable('rebate_payments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  paidDate: text('paid_date').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('rebate_payments_project_unique').on(table.projectId),
  index('rebate_payments_project_date_idx').on(table.projectId, table.paidDate)
])

export const businessInvoices = sqliteTable('business_invoices', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  issuerName: text('issuer_name').notNull().default(''),
  amountCents: integer('amount_cents').notNull(),
  issuedDate: text('issued_date'),
  status: text('status').notNull(),
  deliveredToClient: integer('delivered_to_client', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('business_invoices_project_date_idx').on(table.projectId, table.issuedDate)])

export const businessEvents = sqliteTable('business_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [index('business_events_project_created_idx').on(table.projectId, table.createdAt)])

export const businessInvoiceProjectLinks = sqliteTable('business_invoice_project_links', {
  invoiceId: text('invoice_id').notNull().references(() => businessInvoices.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.invoiceId, table.projectId] }),
  index('business_invoice_project_links_project_idx').on(table.projectId, table.invoiceId)
])

export const businessFiles = sqliteTable('business_files', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  fileId: text('file_id').notNull().references(() => fileReferences.id, { onDelete: 'cascade' }),
  rebatePaymentId: text('rebate_payment_id').references(() => rebatePayments.id, { onDelete: 'set null' }),
  invoiceId: text('invoice_id').references(() => businessInvoices.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull()
}, (table) => [index('business_files_project_role_idx').on(table.projectId, table.role), uniqueIndex('business_files_file_unique').on(table.fileId)])

export const businessFileProjectLinks = sqliteTable('business_file_project_links', {
  businessFileId: text('business_file_id').notNull().references(() => businessFiles.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.businessFileId, table.projectId] }),
  index('business_file_project_links_project_idx').on(table.projectId, table.businessFileId)
])

export const rebatePaymentMigrationAudit = sqliteTable('rebate_payment_migration_audit', {
  originalPaymentId: text('original_payment_id').primaryKey(),
  projectId: text('project_id').notNull(),
  canonicalPaymentId: text('canonical_payment_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  paidDate: text('paid_date').notNull(),
  notes: text('notes').notNull(),
  originalCreatedAt: text('original_created_at').notNull(),
  originalUpdatedAt: text('original_updated_at').notNull(),
  migratedAt: text('migrated_at').notNull()
}, (table) => [index('rebate_payment_migration_audit_project_idx').on(table.projectId, table.migratedAt)])

export const stylePreferences = sqliteTable('style_preferences', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceVersionId: text('source_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  finalVersionId: text('final_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [index('style_preferences_project_idx').on(table.projectId, table.createdAt), uniqueIndex('style_preferences_version_pair_unique').on(table.projectId, table.sourceVersionId, table.finalVersionId)])

export const captures = sqliteTable('captures', {
  id: text('id').primaryKey(),
  captureKind: text('capture_kind').notNull(),
  primaryProjectId: text('primary_project_id').references(() => projects.id, { onDelete: 'set null' }),
  referencedProjectIdsJson: text('referenced_project_ids_json').notNull().default('[]'),
  linkedTopicId: text('linked_topic_id'),
  classificationStatus: text('classification_status').notNull(),
  classificationActor: text('classification_actor'),
  classificationConfidence: real('classification_confidence'),
  suggestedContentTypeId: text('suggested_content_type_id').references(() => contentTypes.id, { onDelete: 'set null' }),
  suggestedProjectId: text('suggested_project_id').references(() => projects.id, { onDelete: 'set null' }),
  classificationReason: text('classification_reason'),
  classifiedAt: text('classified_at'),
  useStatus: text('use_status').notNull().default('active'),
  usageType: text('usage_type'),
  generalCategoryId: text('general_category_id').references(() => generalRecordCategories.id, { onDelete: 'set null' }),
  originalContent: text('original_content').notNull(),
  mobileTitle: text('mobile_title'),
  mobileSourceApp: text('mobile_source_app'),
  mobileSourceTitle: text('mobile_source_title'),
  mobileSourceUrl: text('mobile_source_url'),
  mobileNotes: text('mobile_notes').notNull().default(''),
  mobileRecordingMarkersJson: text('mobile_recording_markers_json').notNull().default('[]'),
  mobileRecordingInterruptionReason: text('mobile_recording_interruption_reason'),
  sourceType: text('source_type').notNull(),
  createdAt: text('created_at').notNull(),
  discardedAt: text('discarded_at')
}, (table) => [index('captures_classification_idx').on(table.classificationStatus, table.createdAt), index('captures_project_idx').on(table.primaryProjectId)])

export const captureAssetLinks = sqliteTable('capture_asset_links', {
  id: text('id').primaryKey(),
  captureId: text('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  fileReferenceId: text('file_reference_id').notNull().references(() => fileReferences.id, { onDelete: 'cascade' }),
  attachmentKind: text('attachment_kind').notNull(),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  uniqueIndex('capture_asset_links_capture_file_unique').on(table.captureId, table.fileReferenceId),
  uniqueIndex('capture_asset_links_capture_position_unique').on(table.captureId, table.position),
  index('capture_asset_links_capture_idx').on(table.captureId, table.position)
])

export const classificationActions = sqliteTable('classification_actions', {
  id: text('id').primaryKey(),
  captureId: text('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  previousStatus: text('previous_status').notNull(),
  previousProjectId: text('previous_project_id').references(() => projects.id, { onDelete: 'set null' }),
  previousContentTypeId: text('previous_content_type_id').references(() => contentTypes.id, { onDelete: 'set null' }),
  previousConfidence: real('previous_confidence'),
  previousReason: text('previous_reason'),
  previousClassifiedAt: text('previous_classified_at'),
  previousCaptureKind: text('previous_capture_kind'),
  previousLinkedTopicId: text('previous_linked_topic_id'),
  previousUsageType: text('previous_usage_type'),
  previousGeneralCategoryId: text('previous_general_category_id'),
  nextStatus: text('next_status').notNull(),
  nextProjectId: text('next_project_id').references(() => projects.id, { onDelete: 'set null' }),
  nextContentTypeId: text('next_content_type_id').references(() => contentTypes.id, { onDelete: 'set null' }),
  reason: text('reason'),
  confidence: real('confidence'),
  nextCaptureKind: text('next_capture_kind'),
  nextLinkedTopicId: text('next_linked_topic_id'),
  nextUsageType: text('next_usage_type'),
  nextGeneralCategoryId: text('next_general_category_id'),
  definitionSnapshotJson: text('definition_snapshot_json'),
  createdTopicId: text('created_topic_id'),
  createdAt: text('created_at').notNull(),
  undoneAt: text('undone_at')
}, (table) => [index('classification_actions_capture_idx').on(table.captureId, table.createdAt)])

export const scheduleItems = sqliteTable('schedule_items', {
  groupId: text('group_id'),
  trip: text('trip_json', { mode: 'json' }).$type<import('../../shared/business-trip').BusinessTripMeta>(),
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  colorToken: text('color_token'),
  title: text('title').notNull(),
  actionType: text('action_type').notNull(),
  startAt: text('start_at'),
  endAt: text('end_at'),
  scheduleKind: text('schedule_kind').notNull(),
  state: text('state').notNull(),
  waitingFor: text('waiting_for'),
  source: text('source').notNull(),
  isMovable: integer('is_movable', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('schedule_items_range_idx').on(table.startAt, table.endAt), index('schedule_items_project_idx').on(table.projectId, table.startAt)])

export const todoItems = sqliteTable('todo_items', {
  isExtra: integer('is_extra', { mode: 'boolean' }).notNull().default(false),
  dateRangeJson: text('date_range_json'),
  stageLinkSource: text('stage_link_source'),
  stageKey: text('stage_key'),
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  plannedDate: text('planned_date'),
  segment: text('segment'),
  category: text('category').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  trackingMode: text('tracking_mode').notNull(),
  progress: integer('progress').notNull().default(0),
  progressBeforeComplete: integer('progress_before_complete'),
  source: text('source').notNull(),
  sourceScheduleId: text('source_schedule_id').references(() => scheduleItems.id, { onDelete: 'set null' }),
  sourcePlannedDate: text('source_planned_date'),
  sourceSegment: text('source_segment'),
  scheduleSyncEnabled: integer('schedule_sync_enabled', { mode: 'boolean' }).notNull().default(true),
  completedAt: text('completed_at'),
  dismissedAt: text('dismissed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('todo_items_source_schedule_unique').on(table.sourceScheduleId),
  index('todo_items_day_status_idx').on(table.plannedDate, table.status),
  index('todo_items_project_idx').on(table.projectId, table.plannedDate)
])

export const todoEvents = sqliteTable('todo_events', {
  id: text('id').primaryKey(),
  todoId: text('todo_id').notNull().references(() => todoItems.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  recordedAt: text('recorded_at').notNull()
}, (table) => [index('todo_events_todo_time_idx').on(table.todoId, table.recordedAt)])

export const todoDailySnapshots = sqliteTable('todo_daily_snapshots', {
  todoId: text('todo_id').notNull().references(() => todoItems.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  endingStatus: text('ending_status').notNull(),
  endingProgress: integer('ending_progress').notNull(),
  progressDelta: integer('progress_delta').notNull().default(0),
  recordedAt: text('recorded_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.todoId, table.day] }),
  index('todo_daily_snapshots_day_idx').on(table.day, table.endingStatus)
])

export const dailyWorkLogs = sqliteTable('daily_work_logs', {
  totalMinutes: integer('total_minutes'),
  day: text('day').primaryKey(),
  selfMediaMinutes: integer('self_media_minutes').notNull().default(0),
  aiMinutes: integer('ai_minutes').notNull().default(0),
  otherWorkMinutes: integer('other_work_minutes').notNull().default(0),
  updatedAt: text('updated_at').notNull()
})

export const taskRuns = sqliteTable('task_runs', {
  id: text('id').primaryKey(),
  taskType: text('task_type').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  provider: text('provider').notNull(),
  model: text('model'),
  status: text('status').notNull(),
  progress: integer('progress').notNull().default(0),
  inputSnapshot: text('input_snapshot').notNull(),
  projectDescriptionSnapshot: text('project_description_snapshot'),
  taskContentTypeId: text('task_content_type_id').references(() => contentTypes.id, { onDelete: 'set null' }),
  taskTemplateId: text('task_template_id').references(() => projectTemplates.id, { onDelete: 'set null' }),
  resourceSnapshotJson: text('resource_snapshot_json'),
  permissionProfileJson: text('permission_profile_json').notNull(),
  outputTarget: text('output_target'),
  resultSummary: text('result_summary'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  retryOfId: text('retry_of_id'),
  requiresConfirmation: integer('requires_confirmation', { mode: 'boolean' }).notNull().default(false),
  requestedAt: text('requested_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at')
}, (table) => [index('task_runs_status_idx').on(table.status, table.requestedAt), index('task_runs_project_idx').on(table.projectId, table.requestedAt)])

export const materialResearchResults = sqliteTable('material_research_results', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  request: text('request').notNull(),
  requestedTitle: text('requested_title').notNull().default(''),
  resultJson: text('result_json'),
  runtimeJson: text('runtime_json'),
  resultHash: text('result_hash'),
  status: text('status').notNull().default('researching'),
  savedMaterialId: text('saved_material_id').references(() => projectMaterials.id, { onDelete: 'set null' }),
  refreshOfResultId: text('refresh_of_result_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('material_research_results_task_unique').on(table.taskId),
  uniqueIndex('material_research_results_saved_material_unique').on(table.savedMaterialId),
  index('material_research_results_project_idx').on(table.projectId, table.createdAt)
])

export const materialResearchSources = sqliteTable('material_research_sources', {
  id: text('id').primaryKey(),
  resultId: text('result_id').notNull().references(() => materialResearchResults.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  publisher: text('publisher').notNull().default(''),
  domain: text('domain').notNull(),
  sourceType: text('source_type').notNull(),
  publishedAt: text('published_at'),
  accessedAt: text('accessed_at').notNull()
}, (table) => [
  uniqueIndex('material_research_sources_result_key_unique').on(table.resultId, table.sourceKey),
  index('material_research_sources_result_idx').on(table.resultId, table.accessedAt)
])

export const contentSources = sqliteTable('content_sources', {
  id: text('id').primaryKey(),
  sourceKind: text('source_kind').notNull(),
  title: text('title').notNull(),
  scopeLabel: text('scope_label').notNull(),
  rawContent: text('raw_content').notNull(),
  sanitizedContent: text('sanitized_content').notNull(),
  privacyFindingsJson: text('privacy_findings_json').notNull().default('[]'),
  contentSha256: text('content_sha256').notNull(),
  duplicateAtomCount: integer('duplicate_atom_count').notNull().default(0),
  createdAt: text('created_at').notNull()
}, (table) => [index('content_sources_created_idx').on(table.createdAt)])

export const contentAtoms = sqliteTable('content_atoms', {
  id: text('id').primaryKey(),
  atomType: text('atom_type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  scoresJson: text('scores_json').notNull(),
  sourceRefsJson: text('source_refs_json').notNull(),
  status: text('status').notNull(),
  mergedFromIdsJson: text('merged_from_ids_json').notNull().default('[]'),
  contentHash: text('content_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('content_atoms_status_idx').on(table.status, table.updatedAt), index('content_atoms_hash_idx').on(table.contentHash)])

export const conversationFilterResults = sqliteTable('conversation_filter_results', {
  taskId: text('task_id').primaryKey().references(() => taskRuns.id, { onDelete: 'cascade' }),
  rawOutputJson: text('raw_output_json').notNull(),
  validatedOutputJson: text('validated_output_json').notNull(),
  candidateCount: integer('candidate_count').notNull(),
  exactDuplicateCount: integer('exact_duplicate_count').notNull().default(0),
  createdAt: text('created_at').notNull()
})

export const conversationFilterCandidates = sqliteTable('conversation_filter_candidates', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  candidateKey: text('candidate_key').notNull(),
  atomType: text('atom_type').notNull(),
  themeTitle: text('theme_title').notNull(),
  themeKey: text('theme_key').notNull(),
  directionTitle: text('direction_title').notNull(),
  directionKey: text('direction_key').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  valueReason: text('value_reason').notNull(),
  riskNotesJson: text('risk_notes_json').notNull().default('[]'),
  sourceRefsJson: text('source_refs_json').notNull(),
  approximateDuplicateGroupKey: text('approximate_duplicate_group_key'),
  contentHash: text('content_hash').notNull(),
  reviewGroup: text('review_group').notNull(),
  similaritiesJson: text('similarities_json').notNull().default('[]'),
  sourceOccurrenceCount: integer('source_occurrence_count').notNull().default(1),
  suppressionKind: text('suppression_kind'),
  status: text('status').notNull(),
  destinationKind: text('destination_kind'),
  destinationId: text('destination_id'),
  parkedAt: text('parked_at'),
  discardedAt: text('discarded_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('conversation_filter_candidates_task_idx').on(table.taskId, table.createdAt),
  index('conversation_filter_candidates_status_idx').on(table.status, table.updatedAt),
  index('conversation_filter_candidates_hash_idx').on(table.contentHash),
  index('conversation_filter_candidates_direction_idx').on(table.themeKey, table.directionKey, table.status)
])

export const conversationScanSourceState = sqliteTable('conversation_scan_source_state', {
  sourceId: text('source_id').primaryKey(),
  sourceKind: text('source_kind').notNull(),
  sourceUpdatedAt: text('source_updated_at').notNull(),
  lastScannedOffset: integer('last_scanned_offset').notNull().default(0),
  lastMessageTimestamp: text('last_message_timestamp'),
  lastContentHash: text('last_content_hash').notNull(),
  scanStatus: text('scan_status').notNull().default('completed'),
  lastTaskId: text('last_task_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  lastScannedAt: text('last_scanned_at').notNull()
}, (table) => [index('conversation_scan_source_state_updated_idx').on(table.sourceKind, table.sourceUpdatedAt)])

export const contentDerivatives = sqliteTable('content_derivatives', {
  id: text('id').primaryKey(),
  outputType: text('output_type').notNull(),
  title: text('title').notNull(),
  atomIdsJson: text('atom_ids_json').notNull(),
  generatedContent: text('generated_content').notNull(),
  currentContent: text('current_content').notNull(),
  status: text('status').notNull(),
  provider: text('provider').notNull(),
  parentCandidateId: text('parent_candidate_id'),
  derivationSnapshotJson: text('derivation_snapshot_json').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  draftVersionId: text('draft_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  confirmedAt: text('confirmed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('content_derivatives_status_idx').on(table.status, table.updatedAt)])

export const externalFileRelations = sqliteTable('external_file_relations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourcePath: text('source_path').notNull(),
  displayName: text('display_name').notNull(),
  lastSha256: text('last_sha256').notNull(),
  lastMtimeMs: real('last_mtime_ms').notNull(),
  lastSizeBytes: integer('last_size_bytes').notNull(),
  lastVersionId: text('last_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  lastSyncedAt: text('last_synced_at').notNull()
}, (table) => [uniqueIndex('external_file_relations_source_path_unique').on(table.sourcePath), index('external_file_relations_project_idx').on(table.projectId)])

export const topicStageDefinitions = sqliteTable('topic_stage_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nextActionLabel: text('next_action_label'),
  position: integer('position').notNull(),
  role: text('role').notNull(),
  systemRole: text('system_role'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('topic_stage_definitions_name_unique').on(table.name), uniqueIndex('topic_stage_definitions_position_unique').on(table.position)])

export const topicColumnDefinitions = sqliteTable('topic_column_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  dataType: text('data_type').notNull(),
  builtinKey: text('builtin_key').unique(),
  isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('topic_column_definitions_position_unique').on(table.position)])

export const topics = sqliteTable('topics', {
  videoFormat: text('video_format').$type<import('../../shared/content-classification').VideoFormat>(),
  isCommercial: integer('is_commercial', { mode: 'boolean' }).notNull().default(false),
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  coreAngle: text('core_angle').notNull().default(''),
  contentTypeId: text('content_type_id').notNull().references(() => contentTypes.id),
  priority: integer('priority').notNull().default(0),
  needsMoreExperience: integer('needs_more_experience', { mode: 'boolean' }).notNull().default(false),
  startAt: text('start_at'),
  deadlineAt: text('deadline_at'),
  actualCompletionAt: text('actual_completion_at'),
  stageId: text('stage_id').references(() => topicStageDefinitions.id, { onDelete: 'set null' }),
  // status是stage系统角色的遗留镜像，仅用于stage_id丢失时的迁移兜底；生命周期唯一事实来源是阶段的systemRole。
  status: text('status').notNull(),
  sourceCaptureIdsJson: text('source_capture_ids_json').notNull().default('[]'),
  createdProjectId: text('created_project_id').references(() => projects.id, { onDelete: 'set null' }),
  lastProjectDeletedAt: text('last_project_deleted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  trashedAt: text('trashed_at')
})

export const topicDirections = sqliteTable('topic_directions', {
  id: text('id').primaryKey(),
  topicId: text('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  themeTitle: text('theme_title').notNull(),
  themeKey: text('theme_key').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  sourceRefsJson: text('source_refs_json').notNull().default('[]'),
  sourceCandidateId: text('source_candidate_id').references(() => conversationFilterCandidates.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('topic_directions_topic_idx').on(table.topicId, table.isPrimary, table.createdAt),
  index('topic_directions_theme_idx').on(table.themeKey, table.title)
])

export const topicCustomValues = sqliteTable('topic_custom_values', {
  topicId: text('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  columnId: text('column_id').notNull().references(() => topicColumnDefinitions.id, { onDelete: 'cascade' }),
  valueText: text('value_text'),
  updatedAt: text('updated_at').notNull()
}, (table) => [primaryKey({ columns: [table.topicId, table.columnId] }), index('topic_custom_values_column_idx').on(table.columnId, table.topicId)])

export const linkGroups = sqliteTable('link_groups', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  colorToken: text('color_token').notNull(),
  labelIndex: integer('label_index').notNull(),
  selectedText: text('selected_text').notNull(),
  mergedVersionId: text('merged_version_id').notNull().references(() => draftVersions.id, { onDelete: 'cascade' }),
  claudeVersionId: text('claude_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  codexVersionId: text('codex_version_id').references(() => draftVersions.id, { onDelete: 'set null' }),
  matchType: text('match_type').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [index('link_groups_project_idx').on(table.projectId, table.createdAt), uniqueIndex('link_groups_project_version_label_unique').on(table.projectId, table.mergedVersionId, table.labelIndex)])

export const preferences = sqliteTable('preferences', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const mobileSyncDevices = sqliteTable('mobile_sync_devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  protocolVersion: integer('protocol_version').notNull().default(1),
  identityPublicKey: text('identity_public_key'),
  trustState: text('trust_state').notNull().default('legacy_v1'),
  upgradedAt: text('upgraded_at'),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at')
}, (table) => [index('mobile_sync_devices_active_idx').on(table.revokedAt, table.createdAt)])

export const mobileCaptureReceipts = sqliteTable('mobile_capture_receipts', {
  deviceId: text('device_id').notNull().references(() => mobileSyncDevices.id, { onDelete: 'cascade' }),
  mobileCaptureId: text('mobile_capture_id').notNull(),
  captureId: text('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  receivedAt: text('received_at').notNull(),
  lastNoteRevision: integer('last_note_revision').notNull().default(0),
  lastNoteSha256: text('last_note_sha256')
}, (table) => [
  primaryKey({ columns: [table.deviceId, table.mobileCaptureId] }),
  uniqueIndex('mobile_capture_receipts_capture_unique').on(table.captureId),
  index('mobile_capture_receipts_received_idx').on(table.receivedAt)
])

export const assetUploadSessions = sqliteTable('asset_upload_sessions', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => mobileSyncDevices.id, { onDelete: 'cascade' }),
  mobileCaptureId: text('mobile_capture_id').notNull(),
  protocolVersion: integer('protocol_version').notNull(),
  expectedAttachmentCount: integer('expected_attachment_count').notNull(),
  captureKindHint: text('capture_kind_hint').notNull().default('unknown'),
  originalContent: text('original_content').notNull().default(''),
  mobileTitle: text('mobile_title'),
  mobileSourceApp: text('mobile_source_app'),
  mobileSourceTitle: text('mobile_source_title'),
  mobileSourceUrl: text('mobile_source_url'),
  mobileNotes: text('mobile_notes').notNull().default(''),
  mobileRecordingMarkersJson: text('mobile_recording_markers_json').notNull().default('[]'),
  mobileRecordingInterruptionReason: text('mobile_recording_interruption_reason'),
  captureCreatedAt: text('capture_created_at').notNull(),
  state: text('state').notNull(),
  committedCaptureId: text('committed_capture_id').references(() => captures.id, { onDelete: 'set null' }),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  expiresAt: text('expires_at').notNull()
}, (table) => [
  uniqueIndex('asset_upload_sessions_device_capture_unique').on(table.deviceId, table.mobileCaptureId),
  index('asset_upload_sessions_state_expiry_idx').on(table.state, table.expiresAt)
])

export const assetUploadAttachments = sqliteTable('asset_upload_attachments', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => assetUploadSessions.id, { onDelete: 'cascade' }),
  attachmentId: text('attachment_id').notNull(),
  attachmentKind: text('attachment_kind').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sourceModifiedAt: text('source_modified_at'),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  chunkCount: integer('chunk_count').notNull(),
  receivedCount: integer('received_count').notNull().default(0),
  relativePath: text('relative_path'),
  state: text('state').notNull(),
  assembledLocator: text('assembled_locator'),
  failureCode: text('failure_code'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  uniqueIndex('asset_upload_attachments_session_attachment_unique').on(table.sessionId, table.attachmentId),
  uniqueIndex('asset_upload_attachments_session_position_unique').on(table.sessionId, table.position),
  index('asset_upload_attachments_session_idx').on(table.sessionId, table.state)
])

export const assetUploadChunks = sqliteTable('asset_upload_chunks', {
  uploadAttachmentId: text('upload_attachment_id').notNull().references(() => assetUploadAttachments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  nonce: text('nonce').notNull(),
  authTag: text('auth_tag').notNull(),
  stagedLocator: text('staged_locator').notNull(),
  receivedAt: text('received_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.uploadAttachmentId, table.chunkIndex] }),
  index('asset_upload_chunks_attachment_idx').on(table.uploadAttachmentId, table.chunkIndex)
])
