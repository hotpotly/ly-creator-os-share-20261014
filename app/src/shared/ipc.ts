import type { TodoCopyToTodayInput, TodoCopyResult } from './todo-reschedule'
import type { WorkspaceAccessState, WorkspaceAccessUpdate } from './workspace-access'
import { todoDaySchema, type TodoDay, type TodoDayWrite } from './todo-day'
import type { PersonalReviewApi } from './personal-review'
import type { ProjectTemplateDefinition } from './domain'
import { PROJECT_KINDS, type SaveProjectTemplateInput } from './project-template-rules'
import { VIDEO_FORMATS, type VideoFormat } from './content-classification'
import { businessTripMetaSchema, type BusinessTripSaveInput } from './business-trip'
import type { BusinessRecordPatch, OtherIncomeRecordPatch } from './domain'
import type { TodoStageTimeInput, TodoTimeMoveInput, TodoBatchLinkInput, TodoProjectStage, TodoStageCompletionInput, TodoStageStartCandidate, TodoStageStartInput } from './domain'
import { z } from 'zod'
import { GLOBAL_SEARCH_KINDS, type GlobalSearchResult } from './global-search'
import {
  ARCHIVE_CATEGORIES,
  ARCHIVE_ITEM_STATUSES,
  ARCHIVE_RUN_STATUSES,
  ARCHIVE_SELECTION_STATUSES,
  ARCHIVE_SLOTS,
  DISTRIBUTION_BATCH_STATUSES,
  DISTRIBUTION_SOURCE_KINDS,
  DISTRIBUTION_TARGET_STATUSES,
  EXTERNAL_PROVIDER_KINDS,
  SIDEBAR_NAVIGATION_ITEM_IDS,
  TODO_CATEGORIES,
  TODO_SEGMENTS,
  TODO_TRACKING_MODES,
  type ArchiveCategory,
  type ArchivePlan,
  type ArchiveRun,
  type ArchiveSelectionStatus,
  type ArchiveSlot,
  type DistributionBatch,
  type DistributionCompletionResult,
  type ExternalProviderConfig,
  type ExternalProviderConfigInput,
  type NasArchiveDestinationStatus,
  type NasBackupStatus,
  type ProviderSettings,
  type CreateTodoInput,
  type DailyWorkLog,
  type TodoItem,
  type UpdateTodoInput
} from './domain'
import { BUSINESS_DEAL_STATUSES, BUSINESS_EVENT_ACTIONS, BUSINESS_FILE_ROLES, BUSINESS_LEDGER_STATUSES, BUSINESS_LIFECYCLE_STATUSES, BUSINESS_PAYMENT_STATUSES, CONTENT_ATOM_STATUSES, CONTENT_ATOM_TYPES, CONTENT_DERIVATIVE_STATUSES, CONTENT_DERIVATIVE_TYPES, CONTENT_SOURCE_KINDS, CONVERSATION_FILTER_CANDIDATE_STATUSES, CONVERSATION_HISTORY_SOURCES, CREATION_REPORT_KINDS, FEISHU_HANDOFF_MODES, INVOICE_EXECUTION_STATUSES, INVOICE_REQUIREMENTS, INVOICE_STATUSES, MODULE_KEYS, OPTIONAL_MODULE_KEYS, PRIVACY_FINDING_KINDS, PROJECT_ASSET_IMPORT_STATUSES, PROJECT_ASSET_USAGE_TYPES, PROJECT_COLOR_TOKENS, PROJECT_PLATFORMS, PROJECT_MATERIAL_PARSE_STATUSES, PROJECT_MATERIAL_ROLES, PROJECT_MATERIAL_SOURCE_KINDS, PROJECT_RESOURCE_ROLES, PROJECT_STATUSES, RECYCLE_CATEGORIES, TOPIC_STAGE_ROLES, PROVIDER_CAPABILITY_STATUSES, PROVIDER_KINDS, PUBLISHING_MATERIAL_KINDS, REBATE_EXECUTION_STATUSES, REBATE_INPUT_MODES, REBATE_PROCEDURE_STATUSES, REBATE_RECIPIENT_TYPES, REBATE_REQUIREMENTS, RESOURCE_ORIGINS, RESOURCE_SELECTION_MODES, RESOURCE_SELECTION_SOURCES, RESOURCE_TYPES, SCHEDULE_KINDS, SCHEDULE_STATES, STAGE_TIME_SEGMENTS, STAGE_TIME_SOURCES, STAGE_TIME_STATUSES, TASK_REQUIRED_INPUT_KEYS, TASK_STATUSES, TASK_TYPES, type AppearanceSnapshot, type BusinessAutofillResult, type BusinessFileRole, type BusinessFolderScanResult, type BusinessProjectData, type BusinessRecordInput, type CaptureContext, type CaptureDeduplicationResult, type CaptureDestinationCandidate, type CaptureRecord, type ContentAtomRecord, type ContentAtomStatus, type ContentDerivationPreparation, type ContentDerivativeRecord, type ContentDerivativeType, type ContentEngineSnapshot, type ContentSourceImportResult, type ContentSourceKind, type ContentTypeDefinition, type ConversationFilterBatchDecisionResult, type ConversationFilterCandidate, type ConversationFilterDecisionInput, type ConversationFilterDestinationInput, type ConversationFilterDestinationResult, type ConversationHistorySource, type ConversationMetadataResult, type ConversationScanPlan, type ConversationScanPreflight, type ConversationScanPreflightBatch, type ConversationScanProgress, type ConversationScanStartResult, type ConversationSelectionPreview, type CreationReportConversation, type CreationReportKind, type CreationReportSnapshot, type CreateProjectInput, type CreateScheduleInput, type CreateTopicInput, type DraftVersion, type ExternalFileRelation, type FeishuHandoffRecord, type GeneralRecordCategory, type ImportedDraftResult, type InvoiceStatus, type LinkGroupRecord, type MobileSyncStatus, type OptionalProjectModuleKey, type ProjectAssetImportBatchResult, type ProjectAssetUsageType, type ProjectColorToken, type ProjectDetail, type ProjectGenerationContext, type ProjectMaterialRecord, type ProjectMaterialRole, type ProjectModuleKey, type ProjectDraftClassification, type ProjectResourceReference, type ProjectResourceRole, type ProjectSummary, type ProjectTemplateDiff, type ProviderCapability, type RecycleEmptyResult, type PublishingAccount, type PublishingAccountState, type PublishingComputerUsePilot, type PublishingDraft, type PublishingHandoff, type PublishingMaterial, type ResourceRecord, type ResourceSelectionSource, type ScheduleItem, type ScriptRevisionApplyValidation, type ScriptRevisionConversation, type ScriptRevisionMessage, type ScriptRevisionProvider, type ScriptRevisionSelectionSnapshot, type ScriptRevisionSuggestionStatus, type StagePlanEdit, type StageTimeContext, type StageTimeKey, type StageTimeMutationResult, type StageTimePoint, type StageTimeUpdateResult, type StylePreferenceEntry, type SubtitleJob, type TaskResourcePreparation, type TaskRun, type TopicColumnDataType, type TopicColumnDefinition, type TopicRecord, type TopicStageDefinition, type TopicStageDeleteResult, type UpdateTopicInput, type WorkbenchPreferences, type WorkspacePreferences, type WorkspaceSnapshot, type WorkspaceUndoResult, type WorkspaceUndoState } from './domain'
import type { CodexWritingModelOption, CreationReportSnapshotSummary, MaterialResearchSession, ProjectCreationReview } from './domain'
import type { ContentFactEvidence } from './domain'
import type { BusinessLedgerEntry, BusinessLedgerLockStatus } from './domain'
import { OTHER_INCOME_RECORD_STATUSES } from './domain'
import { CURRENT_SCRIPT_BLOCK_KINDS, CURRENT_SCRIPT_RECOVERY_RESOLUTION_KINDS, CURRENT_SCRIPT_SOURCE_KINDS, SCRIPT_TEXT_ANNOTATION_STATUSES, SCRIPT_TEXT_ANNOTATION_STYLES } from './domain'
import type { ApplyProjectCurrentScriptInput, ApplyProjectCurrentScriptResult, CurrentScriptRecoveryCandidate, InitializeProjectCurrentScriptInput, ProjectCurrentScriptLoadResult, ResolvedCurrentScriptRecovery, ResolveCurrentScriptRecoveryInput, RestoreProjectCurrentScriptVersionInput, RestoreProjectCurrentScriptVersionResult, SaveProjectCurrentScriptVersionInput, SaveProjectCurrentScriptVersionResult } from './domain'
import type {
  OtherIncomeCategory,
  OtherIncomeCompanyAlias,
  OtherIncomeImportCandidate,
  OtherIncomeImportRule,
  OtherIncomeImportRuleConditions,
  OtherIncomeRecord,
  OtherIncomeRecordInput
} from './domain'
import type {
  DraftAlignmentSplitStartResult,
  DraftCandidateRevision,
  DraftComparisonHistoryEntry,
  DraftComparisonSplitScope,
  DraftComparisonSplitStrategy,
  DraftComparisonWorkspace,
  DraftGroupDecision,
  DraftGroupDecisionKind
} from './domain'
import type { ScriptMaterialFinalizationGate, ScriptMaterialManualMark, ScriptMaterialPointAdoption, ScriptMaterialVersionSnapshot, ScriptMaterialWorkspace } from './domain'
import type { ProjectProductionNotes } from './domain'
import { WEATHER_CONDITIONS, WEATHER_PERIODS, weatherSceneSnapshotSchema, type WeatherSceneSnapshot } from './weather'
import {
  contentInstructionRequestPreparePayloadSchema,
  contentInstructionRequestRecordSchema,
  projectReferenceRolePreferenceRemovePayloadSchema,
  projectReferenceRolePreferenceSchema,
  projectReferenceRolePreferenceSetPayloadSchema,
  structuredReferenceRolesResolvePayloadSchema,
  structuredReferenceRuleEvidenceSchema,
  structuredReferenceUseSchema
} from './structured-reference-schema'
import type {
  ContentInstructionRequestRecord,
  ProjectReferenceRolePreference,
  StructuredReferenceCatalogItem,
  StructuredReferenceRoleResolution
} from './domain'
import { STRUCTURED_REFERENCE_AVAILABILITIES, STRUCTURED_REFERENCE_SCOPES, STRUCTURED_REFERENCE_SOURCE_KINDS } from './domain'

export {
  contentInstructionRequestGetByTaskPayloadSchema,
  contentInstructionRequestGetPayloadSchema,
  contentInstructionRequestPreparePayloadSchema,
  projectReferenceRolePreferenceRemovePayloadSchema,
  projectReferenceRolePreferenceSetPayloadSchema,
  structuredReferenceCatalogListPayloadSchema,
  structuredReferenceRolesResolvePayloadSchema
} from './structured-reference-schema'

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  externalLinkOpen: 'external-link:open',
  codexWritingModelsList: 'codex-writing-models:list',
  structuredReferenceCatalogList: 'structured-reference:catalog-list',
  structuredReferenceRolesResolve: 'structured-reference:roles-resolve',
  projectReferenceRolePreferenceSet: 'structured-reference:role-preference-set',
  projectReferenceRolePreferenceRemove: 'structured-reference:role-preference-remove',
  contentInstructionDispatch: 'content-instruction-request:dispatch',
  contentInstructionRequestGet: 'content-instruction-request:get',
  contentInstructionRequestGetByTask: 'content-instruction-request:get-by-task',
  contentFactEvidenceGet: 'content-fact-evidence:get',
  openCapture: 'window:open-capture',
  closeCapture: 'window:close-capture',
  todoWindowOpenWidget: 'todo-window:open-widget',
  todoWindowOpenMain: 'todo-window:open-main',
  todoWindowClose: 'todo-window:close',
  workspaceGet: 'workspace:get',
  weatherGet: 'weather:get',
  workspaceBackupCreate: 'workspace-backup:create',
  workspaceBackupRestoreChoose: 'workspace-backup-restore:choose',
  globalSearch: 'global-search:query',
  workspaceUndoStateGet: 'workspace-undo-state:get',
  workspaceUndo: 'workspace:undo',
  projectGet: 'project:get',
  projectCreate: 'project:create',
  projectTrash: 'project:trash',
  projectRename: 'project:rename',
  projectSetPinned: 'project:set-pinned',
  projectSetColor: 'project:set-color',
  projectClassifyDraft: 'project:classify-draft',
  projectRestore: 'project:restore',
  projectDeletePermanently: 'project:delete-permanently',
  projectSetLifecycle: 'project:set-lifecycle',
  projectUpdateContentType: 'project:update-content-type',
  projectUpdateClassification: 'project:update-classification',
  projectUpdatePlatforms: 'project:update-platforms',
  projectTemplateSave: 'project-template:save',
  projectTemplatePreview: 'project-template:preview',
  projectTemplateApply: 'project-template:apply',
  projectSetModule: 'project:set-module',
  projectReorderModules: 'project:reorder-modules',
  projectSetModuleCompleted: 'project:set-module-completed',
  projectProductionNotesGet: 'project-production-notes:get',
  projectProductionNotesSet: 'project-production-notes:set',
  projectStageTimeContextGet: 'project-stage-time-context:get',
  projectStageTimeUpdate: 'project-stage-time:update',
  projectStageTimeSetStatus: 'project-stage-time:set-status',
  projectStageTimeUndo: 'project-stage-time:undo',
  creationReportGet: 'creation-report:get',
  creationReportSnapshotList: 'creation-report-snapshot:list',
  creationReportSnapshotGetById: 'creation-report-snapshot:get-by-id',
  projectCreationReviewGet: 'project-creation-review:get',
  creationReportConversationGet: 'creation-report-conversation:get',
  creationReportMessageSend: 'creation-report-message:send',
  scriptRevisionConversationGet: 'script-revision-conversation:get',
  scriptRevisionMessageSend: 'script-revision-message:send',
  scriptRevisionApplyValidate: 'script-revision-apply:validate',
  scriptRevisionSuggestionStatusSet: 'script-revision-suggestion-status:set',
  scriptMaterialGet: 'script-material:get',
  scriptMaterialWorkspaceSave: 'script-material-workspace:save',
  scriptMaterialRevisionCreate: 'script-material-revision:create',
  scriptMaterialPointsReplace: 'script-material-points:replace',
  scriptMaterialPointsConfirm: 'script-material-points:confirm',
  scriptMaterialPointUpdate: 'script-material-point:update',
  scriptMaterialAnnotationConfirm: 'script-material-annotation:confirm',
  scriptMaterialManualMarksSet: 'script-material-manual-marks:set',
  scriptMaterialExtractStart: 'script-material-extract:start',
  scriptMaterialGenerateStart: 'script-material-generate:start',
  scriptMaterialAuditStart: 'script-material-audit:start',
  scriptMaterialAllowedOmissionsSet: 'script-material-allowed-omissions:set',
  scriptMaterialFindingConfirm: 'script-material-finding:confirm',
  scriptMaterialFinalizationGateGet: 'script-material-finalization-gate:get',
  scriptMaterialVersionSnapshotGet: 'script-material-version-snapshot:get',
  scriptMaterialVersionSnapshotRestore: 'script-material-version-snapshot:restore',
  scriptMaterialMapStart: 'script-material-map:start',
  draftComparisonGet: 'draft-comparison:get',
  draftComparisonDraftsSave: 'draft-comparison-drafts:save',
  draftComparisonCurrentDocumentBaseSet: 'draft-comparison-current-document-base:set',
  draftSourceGenerate: 'draft-source:generate',
  draftAlignmentStart: 'draft-alignment:start',
  draftCandidateFreeformAdd: 'draft-candidate-freeform:add',
  draftCandidateDelete: 'draft-candidate:delete',
  draftCandidateMove: 'draft-candidate:move',
  draftCandidateReorder: 'draft-candidate:reorder',
  draftDecisionSet: 'draft-decision:set',
  draftDecisionNoteSet: 'draft-decision-note:set',
  draftDecisionMarkersSet: 'draft-decision-markers:set',
  draftGroupMerge: 'draft-group:merge',
  draftGroupSplit: 'draft-group:split',
  draftAlignmentSplitStart: 'draft-alignment-split:start',
  draftGroupReorder: 'draft-group:reorder',
  draftParagraphMove: 'draft-paragraph:move',
  draftParagraphsMove: 'draft-paragraphs:move',
  draftComparisonHistoryList: 'draft-comparison-history:list',
  draftComparisonHistoryRestore: 'draft-comparison-history:restore',
  projectUpdateDescription: 'project:update-description',
  projectSaveOutline: 'project:save-outline',
  projectOutlineSelectionSet: 'project-outline-selection:set',
  outlineGenerationStart: 'outline-generation:start',
  projectSaveScript: 'project:save-script',
  projectCurrentScriptLoad: 'project-current-script:load',
  projectCurrentScriptInitialize: 'project-current-script:initialize',
  projectCurrentScriptApply: 'project-current-script:apply',
  projectCurrentScriptVersionSave: 'project-current-script-version:save',
  projectCurrentScriptVersionRestore: 'project-current-script-version:restore',
  projectCurrentScriptVersionSnapshotGet: 'project-current-script-version-snapshot:get',
  projectCurrentScriptRecoveryList: 'project-current-script-recovery:list',
  projectCurrentScriptRecoveryResolve: 'project-current-script-recovery:resolve',
  sourceScriptAnnotationsList: 'source-script-annotations:list',
  sourceScriptAnnotationUpsert: 'source-script-annotation:upsert',
  sourceScriptAnnotationDelete: 'source-script-annotation:delete',
  projectSaveAndFinalizeScript: 'project:save-and-finalize-script',
  scriptExportWord: 'script:export-word',
  feishuHandoffList: 'feishu-handoff:list',
  feishuHandoffCopy: 'feishu-handoff:copy',
  feishuHandoffExportWord: 'feishu-handoff:export-word',
  feishuHandoffSaveLink: 'feishu-handoff:save-link',
  feishuHandoffOpen: 'feishu-handoff:open',
  nasArchiveDestinationGet: 'nas-archive-destination:get',
  nasArchiveDestinationChoose: 'nas-archive-destination:choose',
  nasArchiveDestinationClear: 'nas-archive-destination:clear',
  nasArchiveCategoryLabelsSet: 'nas-archive-category-labels:set',
  nasArchiveSlotChoose: 'nas-archive-slot:choose',
  nasArchiveSlotStatusSet: 'nas-archive-slot-status:set',
  nasArchivePlanPrepare: 'nas-archive-plan:prepare',
  nasArchivePlanConfirm: 'nas-archive-plan:confirm',
  nasArchiveRunsList: 'nas-archive-runs:list',
  nasArchiveRunGet: 'nas-archive-run:get',
  nasArchiveRunCancel: 'nas-archive-run:cancel',
  nasArchiveRunRetry: 'nas-archive-run:retry',
  nasBackupStatusGet: 'nas-backup-status:get',
  nasBackupRun: 'nas-backup:run',
  projectSetFinalVersion: 'project:set-final-version',
  stylePreferenceConfirm: 'style-preference:confirm',
  projectImportScript: 'project:import-script',
  projectImportScriptFile: 'project:import-script-file',
  linkGroupCreate: 'link-group:create',
  linkGroupList: 'link-group:list',
  linkGroupDelete: 'link-group:delete',
  captureContextGet: 'capture:context-get',
  captureSave: 'capture:save',
  captureClassificationStart: 'capture-classification:start',
  captureDeduplicateExact: 'capture:deduplicate-exact',
  captureConfirmClassification: 'capture:confirm-classification',
  captureUndoClassification: 'capture:undo-classification',
  captureDestinationsList: 'capture:destinations-list',
  captureSetUseStatus: 'capture:set-use-status',
  captureAttachTopic: 'capture:attach-topic',
  generalCategoryCreate: 'general-category:create',
  generalCategoryUpdate: 'general-category:update',
  topicCreate: 'topic:create',
  topicUpdate: 'topic:update',
  topicCreateProject: 'topic:create-project',
  topicStageCreate: 'topic-stage:create',
  topicStageUpdate: 'topic-stage:update',
  topicStageReorder: 'topic-stage:reorder',
  topicStageDelete: 'topic-stage:delete',
  topicColumnCreate: 'topic-column:create',
  topicColumnUpdate: 'topic-column:update',
  topicColumnReorder: 'topic-column:reorder',
  topicColumnDelete: 'topic-column:delete',
  topicCustomValueSet: 'topic-custom-value:set',
  topicTrash: 'topic:trash',
  topicRestore: 'topic:restore',
  topicDeletePermanently: 'topic:delete-permanently',
  captureDeletePermanently: 'capture:delete-permanently',
  filterCandidateRestore: 'filter-candidate:restore',
  filterCandidateDeletePermanently: 'filter-candidate:delete-permanently',
  recycleEmpty: 'recycle:empty',
  projectRevealFolder: 'project:reveal-folder',
  contentTypeCreate: 'content-type:create',
  contentTypeUpdate: 'content-type:update',
  contentTypeReorder: 'content-type:reorder',
  businessTripSave: 'schedule:save-business-trip',
  scheduleCreate: 'schedule:create',
  scheduleCreateBatch: 'schedule:create-batch',
  scheduleUpdate: 'schedule:update',
  scheduleMove: 'schedule:move',
  scheduleSetState: 'schedule:set-state',
  scheduleSetColor: 'schedule:set-color',
  scheduleDelete: 'schedule:delete',
  todoProjectStages: 'todo:project-stages',
  todoStageComplete: 'todo:stage-complete',
  todoStageTime: 'todo:stage-time',
  todoStageStartCandidate: 'todo:stage-start-candidate',
  todoStageStart: 'todo:stage-start',
  todoDayWrite: 'todo:day-write',
  todoCreateBatch: 'todo:create-batch',
  todoUpdate: 'todo:update',
  todoTimeMove: 'todo:time-move',
  todoBatchLink: 'todo:batch-link',
  todoCopyToToday: 'todo:copy-to-today',
  todoCopyUndo: 'todo:copy-undo',
  todoDismiss: 'todo:dismiss',
  dailyWorkLogGet: 'daily-work-log:get',
  dailyWorkLogSet: 'daily-work-log:set',
  dailyWorkLogAdjust: 'daily-work-log:adjust',
  dailyWorkLogTotalSet: 'daily-work-log:total-set',
  scheduleWindowClose: 'schedule-window:close',
  scheduleWindowResize: 'schedule-window:resize',
  scheduleWindowOpenMain: 'schedule-window:open-main',
  scheduleNavigate: 'schedule:navigate',
  resourcesList: 'resources:list',
  outlineTemplateImportFile: 'outline-template:import-file',
  outlineTemplateDelete: 'outline-template:delete',
  projectMaterialSaveText: 'project-material:save-text',
  projectFrameworkSave: 'project-framework:save',
  projectScratchNoteSave: 'project-scratch-note:save',
  projectMaterialImportPdf: 'project-material:import-pdf',
  projectMaterialImportPdfFromFile: 'project-material:import-pdf-from-file',
  projectMaterialChooseBatch: 'project-material:choose-batch',
  projectMaterialImportBatch: 'project-material:import-batch',
  projectMaterialSaveLink: 'project-material:save-link',
  projectMaterialOpen: 'project-material:open',
  projectMaterialPreviewGet: 'project-material-preview:get',
  projectMaterialDelete: 'project-material:delete',
  projectPrimaryReferencesSave: 'project-primary-references:save',
  projectMaterialResearchStart: 'project-material-research:start',
  projectMaterialResearchGet: 'project-material-research:get',
  projectMaterialResearchSave: 'project-material-research:save',
  projectGenerationContextGet: 'project-generation-context:get',
  businessScreenshotExtract: 'business-screenshot:extract',
  businessTextExtract: 'business-text:extract',
  businessImportLinkOpen: 'business-import-link:open',
  businessImportLinkCapture: 'business-import-link:capture',
  businessProjectDataGet: 'business-project-data:get',
  businessRecordSave: 'business-record:save',
  businessRecordPatch: 'business-record:patch',
  businessLedgerStandaloneSave: 'business-ledger:standalone-save',
  businessLedgerStandaloneBatchSave: 'business-ledger:standalone-batch-save',
  businessLedgerTrashList: 'business-ledger-trash:list',
  businessLedgerTrash: 'business-ledger:trash',
  businessLedgerRestore: 'business-ledger:restore',
  businessLedgerPermanentDelete: 'business-ledger:permanent-delete',
  businessLedgerRelink: 'business-ledger:relink',
  businessFolderScan: 'business-folder:scan',
  businessFolderImport: 'business-folder:import',
  businessLedgerLockStatusGet: 'business-ledger-lock:status-get',
  businessLedgerLockEnable: 'business-ledger-lock:enable',
  businessLedgerLockDisable: 'business-ledger-lock:disable',
  businessLedgerLockUnlockPassword: 'business-ledger-lock:unlock-password',
  businessLedgerLockUnlockTouchId: 'business-ledger-lock:unlock-touch-id',
  businessLedgerLockNow: 'business-ledger-lock:lock-now',
  rebatePaymentSave: 'rebate-payment:save',
  rebatePaymentDelete: 'rebate-payment:delete',
  businessInvoiceSave: 'business-invoice:save',
  businessInvoiceDelete: 'business-invoice:delete',
  businessFileImport: 'business-file:import',
  businessFileProjectsSet: 'business-file-projects:set',
  businessFileDelete: 'business-file:delete',
  businessFileReveal: 'business-file:reveal',
  otherIncomeCategorySave: 'other-income-category:save',
  otherIncomeCategoryReorder: 'other-income-category:reorder',
  otherIncomeRecordSave: 'other-income-record:save',
  otherIncomeRecordPatch: 'other-income-record:patch',
  otherIncomeRecordBatchSave: 'other-income-record:batch-save',
  otherIncomeAttachmentImport: 'other-income-attachment:import',
  otherIncomeRecordTrashList: 'other-income-record-trash:list',
  otherIncomeRecordTrash: 'other-income-record:trash',
  otherIncomeRecordRestore: 'other-income-record:restore',
  otherIncomeRecordPermanentDelete: 'other-income-record:permanent-delete',
  otherIncomeAliasSave: 'other-income-alias:save',
  otherIncomeAliasDelete: 'other-income-alias:delete',
  otherIncomeRuleSave: 'other-income-rule:save',
  otherIncomeRuleDelete: 'other-income-rule:delete',
  otherIncomeImportPreview: 'other-income-import:preview',
  publishingMaterialSaveText: 'publishing-material:save-text',
  publishingDraftPrepare: 'publishing-draft:prepare',
  publishingMaterialImportFile: 'publishing-material:import-file',
  publishingVideoChoose: 'publishing-video:choose',
  publishingMaterialReveal: 'publishing-material:reveal',
  publishingAccountStateGet: 'publishing-account-state:get',
  publishingAccountSave: 'publishing-account:save',
  publishingAccountStatusSet: 'publishing-account:set-status',
  publishingAccountSelect: 'publishing-account:select',
  coverGenerationStart: 'cover-generation:start',
  coverCandidatePreview: 'cover-candidate:preview',
  coverCandidateSelect: 'cover-candidate:select',
  subtitleGenerationStart: 'subtitle-generation:start',
  subtitleArtifactReveal: 'subtitle-artifact:reveal',
  subtitleArtifactConfirm: 'subtitle-artifact:confirm',
  subtitleArtifactUse: 'subtitle-artifact:use',
  titleGenerationStart: 'title-generation:start',
  titleCandidateSelect: 'title-candidate:select',
  publishingHandoffPrepare: 'publishing-handoff:prepare',
  publishingHandoffOpen: 'publishing-handoff:open',
  publishingHandoffConfirm: 'publishing-handoff:confirm',
  publishingHandoffCopyField: 'publishing-handoff:copy-field',
  publishingComputerUsePilotStart: 'publishing-computer-use-pilot:start',
  publishingComputerUsePilotReady: 'publishing-computer-use-pilot:ready',
  publishingComputerUsePilotStop: 'publishing-computer-use-pilot:stop',
  distributionBatchesList: 'distribution-batches:list',
  distributionBatchCreate: 'distribution-batch:create',
  distributionAnalysisStart: 'distribution-analysis:start',
  distributionSegmentCreate: 'distribution-segment:create',
  distributionSegmentUpdate: 'distribution-segment:update',
  distributionFilesLink: 'distribution-files:link',
  distributionTargetsReplace: 'distribution-targets:replace',
  distributionTargetStatusSet: 'distribution-target:set-status',
  distributionBatchComplete: 'distribution-batch:complete',
  distributionBatchReopen: 'distribution-batch:reopen',
  distributionFileOpen: 'distribution-file:open',
  distributionFileReveal: 'distribution-file:reveal',
  projectSetResourceReference: 'project:set-resource-reference',
  taskPrepareResources: 'task:prepare-resources',
  contentEngineGet: 'content-engine:get',
  contentSourceImport: 'content-source:import',
  conversationSourcesList: 'conversation-sources:list',
  conversationSelectionPrepare: 'conversation-selection:prepare',
  conversationFilterStart: 'conversation-filter:start',
  conversationFilterCandidatesList: 'conversation-filter-candidates:list',
  conversationFilterCandidateSetStatus: 'conversation-filter-candidate:set-status',
  conversationFilterCandidateRoute: 'conversation-filter-candidate:route',
  conversationScanPlan: 'conversation-scan:plan',
  conversationScanPrepare: 'conversation-scan:prepare',
  conversationScanPreflightBatch: 'conversation-scan:preflight-batch',
  conversationScanStart: 'conversation-scan:start',
  conversationScanProgress: 'conversation-scan:progress',
  conversationScanPause: 'conversation-scan:pause',
  conversationScanResume: 'conversation-scan:resume',
  conversationFilterCandidateDecide: 'conversation-filter-candidate:decide',
  conversationFilterCandidatesConfirm: 'conversation-filter-candidates:confirm',
  conversationFilterCandidateDelete: 'conversation-filter-candidate:delete',
  contentAtomSetStatus: 'content-atom:set-status',
  contentAtomMerge: 'content-atom:merge',
  contentDerivativePrepare: 'content-derivative:prepare',
  contentDerivativeCreate: 'content-derivative:create',
  contentDerivativeConfirm: 'content-derivative:confirm',
  contentDerivativeCopy: 'content-derivative:copy',
  contentDerivativeCreateProject: 'content-derivative:create-project',
  taskCreate: 'task:create',
  taskCancel: 'task:cancel',
  taskDismiss: 'task:dismiss',
  taskRetry: 'task:retry',
  taskRetryWithFallback: 'task:retry-with-fallback',
  taskConfirm: 'task:confirm',
  providerSecurityValidate: 'provider-security:validate',
  providerSettingsGet: 'provider-settings:get',
  externalProviderConfigSave: 'external-provider-config:save',
  externalProviderConfigDelete: 'external-provider-config:delete',
  externalProviderConfigValidate: 'external-provider-config:validate',
  providerRoutingSet: 'provider-routing:set',
  externalFileRelationsList: 'external-file-relations:list',
  mobileSyncStatusGet: 'mobile-sync:status-get',
  mobileSyncSetEnabled: 'mobile-sync:set-enabled',
  mobileSyncPairingApprove: 'mobile-sync:pairing-approve',
  mobileSyncPairingReject: 'mobile-sync:pairing-reject',
  mobileSyncDeviceRevoke: 'mobile-sync:device-revoke',
  workspaceAccessGet: 'workspace-access:get',
  workspaceAccessUpdate: 'workspace-access:update',
  preferencesSet: 'preferences:set',
  workbenchPreferencesGet: 'workbench-preferences:get',
  workbenchPreferencesSet: 'workbench-preferences:set',
  workspaceChanged: 'workspace:changed',
  appearanceChanged: 'appearance:changed',
  captureActivated: 'capture:activated',
  workbenchQuickLocatorRequested: 'workbench:quick-locator-requested'
} as const

export const emptyPayloadSchema = z.object({}).strict()
export const projectIdSchema = z.string().min(1).max(128)
export const requestIdSchema = z.string().uuid()
const nullableProjectIdSchema = projectIdSchema.nullable()

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  captureShortcut: z.string(),
  buildId: z.string().default('development'),
  builtAt: z.string().datetime().nullable().default(null),
  installPath: z.string().default(''),
  isInstalledBuild: z.boolean().default(false)
})

const contentTypeSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), sortOrder: z.number().int(), isActive: z.boolean(), defaultProjectTemplateId: z.string().nullable() })
const projectTemplateSchema = z.object({
  recommendedVideoFormats: z.array(z.enum(VIDEO_FORMATS)).default([]), recommendedProjectKinds: z.array(z.enum(PROJECT_KINDS)).default([]),
  id: z.string(), name: z.string(), description: z.string(), moduleKeys: z.array(z.enum(OPTIONAL_MODULE_KEYS)),
  recommendedContentTypeIds: z.array(z.string()), sortOrder: z.number().int(), isActive: z.boolean()
})
const projectContentTypeHistorySchema = z.object({
  id: z.string(), projectId: z.string(), previousContentTypeId: z.string(), previousContentTypeName: z.string(),
  nextContentTypeId: z.string(), nextContentTypeName: z.string(), source: z.enum(['user', 'system']), createdAt: z.string()
})
const projectTemplateDiffSchema = z.object({
  templateId: z.string().nullable(), templateName: z.string(), add: z.array(z.enum(OPTIONAL_MODULE_KEYS)),
  enable: z.array(z.enum(OPTIONAL_MODULE_KEYS)), preserve: z.array(z.enum(OPTIONAL_MODULE_KEYS)),
  suggestHide: z.array(z.enum(OPTIONAL_MODULE_KEYS)), blocked: z.array(z.enum(OPTIONAL_MODULE_KEYS))
})
const projectSummarySchema = z.object({
  videoFormat: z.enum(VIDEO_FORMATS).nullable().default(null),
  id: z.string(), title: z.string(), description: z.string(), contentTypeId: z.string(), contentTypeName: z.string(),
  appliedTemplateId: z.string().nullable(), appliedTemplateName: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES), topicStageRole: z.enum(TOPIC_STAGE_ROLES).nullable(), colorToken: z.enum(PROJECT_COLOR_TOKENS), platformTargets: z.array(z.string()), isPinned: z.boolean(),
  isCommercial: z.boolean(), ledgerOnly: z.boolean().default(false), trashedAt: z.string().nullable(), lastOpenedAt: z.string().nullable(), updatedAt: z.string(), pendingExternalDrafts: z.number().int().nonnegative(),
  enabledModuleKeys: z.array(z.enum(OPTIONAL_MODULE_KEYS)),
  currentStageKey: z.enum(['materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'feedback', 'versions']).nullable(),
  progressPercent: z.number().int().min(0).max(100).optional()
})
const projectModuleSchema = z.object({
  key: z.enum(MODULE_KEYS), enabled: z.boolean(), position: z.number().int(), contentRootId: z.string(), disabledAt: z.string().nullable(), completedAt: z.string().nullable()
})
const resourcePayloadSchema = z.record(z.string(), z.unknown())
const resourceSchema = z.object({
  id: z.string(), resourceType: z.enum(RESOURCE_TYPES), name: z.string(), description: z.string(), contentTypeId: z.string().nullable(),
  origin: z.enum(RESOURCE_ORIGINS), selectionMode: z.enum(RESOURCE_SELECTION_MODES), version: z.number().int().positive(), payload: resourcePayloadSchema,
  isActive: z.boolean(), createdAt: z.string(), updatedAt: z.string()
})
const projectResourceReferenceSchema = z.object({
  projectId: z.string(), resourceId: z.string(), role: z.enum(PROJECT_RESOURCE_ROLES), enabled: z.boolean(), selectionSource: z.enum(RESOURCE_SELECTION_SOURCES),
  resource: resourceSchema, createdAt: z.string(), updatedAt: z.string()
})
const taskRequiredInputSchema = z.object({
  key: z.enum(TASK_REQUIRED_INPUT_KEYS), label: z.string(), required: z.boolean(), status: z.enum(['included', 'missing', 'empty', 'not_applicable']),
  items: z.array(z.object({ id: z.string(), label: z.string(), content: z.string() }))
})
const taskResourceSnapshotItemSchema = resourceSchema.omit({ isActive: true, createdAt: true, updatedAt: true })
const taskPrimaryReferenceSchema = z.object({
  linkId: z.string(), projectMaterialId: z.string(), fileReferenceId: z.string().nullable(), materialTitle: z.string(), materialRole: z.enum(PROJECT_MATERIAL_ROLES),
  sourceKind: z.enum(PROJECT_MATERIAL_SOURCE_KINDS), relativePath: z.string().nullable(), fileName: z.string(), fileKind: z.enum(['file', 'folder']).nullable(), mimeType: z.string().nullable(),
  materialUpdatedAt: z.string(), status: z.enum(['included', 'unread', 'stored_only', 'missing']), isPrimaryReference: z.literal(true), attentionNote: z.string(),
  content: z.string().nullable().default(null)
})
const taskSupportingMaterialSchema = z.object({
  id: z.string(), kind: z.enum(['project_material', 'real_experience', 'scratch_note']), title: z.string(), content: z.string(), updatedAt: z.string()
})
const projectGenerationVersionSchema = z.object({
  id: z.string(), documentType: z.enum(['outline', 'script']), kind: z.enum(['claude_candidate', 'codex_candidate', 'merged_draft', 'user_edit', 'final', 'external_draft', 'content_candidate']),
  revision: z.number().int().positive(), content: z.string(), isFinal: z.boolean(), createdAt: z.string()
})
const projectGenerationContextSchema = z.object({
  version: z.literal(1), createdAt: z.string(),
  project: z.object({
    id: z.string(), title: z.string(), description: z.string(), contentTypeId: z.string(), contentTypeName: z.string(),
    templateId: z.string().nullable(), isCommercial: z.boolean()
  }),
  selectedOutline: projectGenerationVersionSchema.nullable(),
  finalizedScript: projectGenerationVersionSchema.nullable(),
  primaryReferences: z.array(taskPrimaryReferenceSchema),
  supportingMaterials: z.array(taskSupportingMaterialSchema),
  brief: taskRequiredInputSchema.nullable(),
  confirmedRequirements: z.array(taskRequiredInputSchema),
  platformAccounts: z.array(taskResourceSnapshotItemSchema)
})
const taskResourceSnapshotSchema = z.object({
  version: z.literal(1), createdAt: z.string(), projectId: z.string(), contentTypeId: z.string(), templateId: z.string().nullable(),
  requiredInputs: z.array(taskRequiredInputSchema), primaryReferences: z.array(taskPrimaryReferenceSchema).default([]),
  supportingMaterials: z.array(taskSupportingMaterialSchema).default([]), referenceRequirements: z.string().default(''), automaticResources: z.array(taskResourceSnapshotItemSchema),
  recommendedResources: z.array(taskResourceSnapshotItemSchema), manualResources: z.array(taskResourceSnapshotItemSchema),
  generationContext: projectGenerationContextSchema.optional()
})
const taskResourcePreparationSchema = z.object({
  projectId: z.string(), taskContentTypeId: z.string(), taskTemplateId: z.string().nullable(), requiredInputs: z.array(taskRequiredInputSchema),
  primaryReferences: z.array(taskPrimaryReferenceSchema), supportingMaterials: z.array(taskSupportingMaterialSchema), referenceRequirements: z.string(),
  automaticResources: z.array(resourceSchema), recommendedResources: z.array(resourceSchema), manualResources: z.array(resourceSchema),
  excludedRecommendedResourceIds: z.array(z.string()), selectedManualResourceIds: z.array(z.string()), selectedSupportingMaterialIds: z.array(z.string())
})
const privacyFindingSchema = z.object({ kind: z.enum(PRIVACY_FINDING_KINDS), label: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive() })
const contentSourceSchema = z.object({
  id: z.string(), sourceKind: z.enum(CONTENT_SOURCE_KINDS), title: z.string(), scopeLabel: z.string(), sanitizedContent: z.string(),
  privacyFindings: z.array(privacyFindingSchema), contentSha256: z.string(), duplicateAtomCount: z.number().int().nonnegative(), createdAt: z.string()
})
const contentAtomScoresSchema = z.object({ freshness: z.number().int().min(1).max(5), usefulness: z.number().int().min(1).max(5), personalExperience: z.number().int().min(1).max(5), narrative: z.number().int().min(1).max(5) })
const contentAtomSourceRefSchema = z.object({ sourceId: z.string(), excerpt: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
const contentAtomSchema = z.object({
  id: z.string(), atomType: z.enum(CONTENT_ATOM_TYPES), title: z.string(), content: z.string(), scores: contentAtomScoresSchema,
  sourceRefs: z.array(contentAtomSourceRefSchema), status: z.enum(CONTENT_ATOM_STATUSES), mergedFromIds: z.array(z.string()), contentHash: z.string(), createdAt: z.string(), updatedAt: z.string()
})
const contentDerivationSnapshotSchema = z.object({
  version: z.literal(1), createdAt: z.string(), contentTypeId: z.string(), templateId: z.string().nullable(),
  atoms: z.array(contentAtomSchema.pick({ id: true, atomType: true, title: true, content: true, scores: true, sourceRefs: true })),
  automaticResources: z.array(taskResourceSnapshotItemSchema), recommendedResources: z.array(taskResourceSnapshotItemSchema), manualResources: z.array(taskResourceSnapshotItemSchema),
  privacy: z.array(z.object({ sourceId: z.string(), sourceTitle: z.string(), findingCount: z.number().int().nonnegative(), findingKinds: z.array(z.enum(PRIVACY_FINDING_KINDS)) }))
})
const contentDerivativeSchema = z.object({
  id: z.string(), outputType: z.enum(CONTENT_DERIVATIVE_TYPES), title: z.string(), atomIds: z.array(z.string()), generatedContent: z.string(), currentContent: z.string(),
  status: z.enum(CONTENT_DERIVATIVE_STATUSES), provider: z.literal('local_rules'), parentCandidateId: z.string().nullable(), derivationSnapshot: contentDerivationSnapshotSchema,
  projectId: z.string().nullable(), draftVersionId: z.string().nullable(), confirmedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const contentEngineSnapshotSchema = z.object({ sources: z.array(contentSourceSchema), atoms: z.array(contentAtomSchema), derivatives: z.array(contentDerivativeSchema) })
const contentSourceImportResultSchema = z.object({ source: contentSourceSchema, atoms: z.array(contentAtomSchema), duplicateAtomCount: z.number().int().nonnegative() })
const conversationSourceAvailabilitySchema = z.object({ source: z.enum(CONVERSATION_HISTORY_SOURCES), displayName: z.string(), detected: z.boolean(), detail: z.string() })
const conversationMetadataSchema = z.object({
  id: z.string(), source: z.enum(CONVERSATION_HISTORY_SOURCES), title: z.string(), updatedAt: z.string(), sizeBytes: z.number().int().nonnegative().nullable(), lengthLabel: z.string()
})
const conversationMetadataIssueSchema = z.object({ source: z.enum(CONVERSATION_HISTORY_SOURCES), code: z.string(), message: z.string() })
const conversationMetadataResultSchema = z.object({ sources: z.array(conversationSourceAvailabilitySchema), conversations: z.array(conversationMetadataSchema), issues: z.array(conversationMetadataIssueSchema) })
const conversationSelectionIssueSchema = z.object({ sourceId: z.string().nullable(), code: z.string(), message: z.string() })
const conversationSelectionPreviewSchema = z.object({
  selected: z.array(conversationMetadataSchema), sanitizedContent: z.string(), contentSha256: z.string().length(64),
  sourceCursors: z.array(z.object({
    sourceId: z.string(), updatedAt: z.string(), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative(),
    lastMessageTimestamp: z.string().nullable(), contentHash: z.string().length(64)
  })).default([]),
  privacy: z.object({ findingCount: z.number().int().nonnegative(), findingKinds: z.array(z.enum(PRIVACY_FINDING_KINDS)), customSensitiveTermCount: z.number().int().nonnegative() }),
  excludedBlocks: z.array(z.object({ blockType: z.string(), count: z.number().int().positive() })),
  input: z.object({ conversationCount: z.number().int().nonnegative(), turnCount: z.number().int().nonnegative(), characterCount: z.number().int().nonnegative(), estimatedTokens: z.number().int().nonnegative(), truncated: z.boolean() }),
  budget: z.object({ status: z.enum(['within', 'warning', 'blocked']), softTokenLimit: z.number().int().positive(), hardTokenLimit: z.number().int().positive(), message: z.string() }),
  issues: z.array(conversationSelectionIssueSchema)
})
const conversationFilterCandidateSchema = z.object({
  id: z.string(), taskId: z.string(), atomType: z.enum(CONTENT_ATOM_TYPES),
  themeTitle: z.string(), themeKey: z.string(), directionTitle: z.string(), directionKey: z.string(),
  title: z.string(), content: z.string(), valueReason: z.string(),
  riskNotes: z.array(z.string()), sourceRefs: z.array(z.object({ sourceId: z.string(), messageId: z.string(), quote: z.string(), sourceTitle: z.string().optional(), sourceUpdatedAt: z.string().optional() })),
  approximateDuplicateGroupKey: z.string().nullable(), contentHash: z.string().length(64),
  reviewGroup: z.enum(['recommended', 'needs_judgment', 'not_topic']),
  similarities: z.array(z.object({ kind: z.enum(['published_project', 'active_project', 'existing_topic', 'parked_direction']), targetId: z.string(), targetTitle: z.string(), score: z.number().min(0).max(1) })),
  sourceOccurrenceCount: z.number().int().positive(), suppressionKind: z.enum(['discarded', 'done']).nullable(),
  status: z.enum(CONVERSATION_FILTER_CANDIDATE_STATUSES),
  destinationKind: z.enum(['content_inspiration', 'topic', 'project']).nullable(), destinationId: z.string().nullable(),
  parkedAt: z.string().nullable(), discardedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const conversationFilterDestinationResultSchema = z.object({ candidate: conversationFilterCandidateSchema, captureId: z.string().nullable(), topicId: z.string().nullable(), projectId: z.string().nullable() })
const conversationScanPlanSchema = z.object({
  mode: z.enum(['deep', 'incremental']), sourceScope: z.enum(['codex', 'claude', 'both']),
  totalConversationCount: z.number().int().nonnegative(), eligibleConversationCount: z.number().int().nonnegative(), previouslyScannedCount: z.number().int().nonnegative(),
  estimatedCharacters: z.number().int().nonnegative(), estimatedTokens: z.number().int().nonnegative(), estimateIsPartial: z.boolean()
})
const conversationScanStartResultSchema = z.object({
  scanId: z.string(), mode: z.enum(['deep', 'incremental']), conversationCount: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(), tasks: z.array(z.lazy(() => taskRunSchema)), skippedIssues: z.array(conversationSelectionIssueSchema)
})
const conversationScanPreflightSchema = z.object({
  preflightId: z.string(), mode: z.enum(['deep', 'incremental']), sourceScope: z.enum(['codex', 'claude', 'both']),
  providerConfigId: z.string(), providerLabel: z.string(), providerTransport: z.enum(['cli', 'api']),
  conversationCount: z.number().int().nonnegative(), batchCount: z.number().int().positive(), estimatedTokens: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(), privacyFindingCount: z.number().int().nonnegative(),
  privacyFindingKinds: z.array(z.enum(PRIVACY_FINDING_KINDS)), excludedBlocks: z.array(z.object({ blockType: z.string(), count: z.number().int().positive() })),
  issues: z.array(conversationSelectionIssueSchema)
})
const conversationScanPreflightBatchSchema = z.object({
  preflightId: z.string(), batchIndex: z.number().int().positive(), batchCount: z.number().int().positive(), sourceTitles: z.array(z.string()),
  sanitizedContent: z.string(), privacyFindingCount: z.number().int().nonnegative(), privacyFindingKinds: z.array(z.enum(PRIVACY_FINDING_KINDS)),
  excludedBlocks: z.array(z.object({ blockType: z.string(), count: z.number().int().positive() })),
  characterCount: z.number().int().nonnegative(), estimatedTokens: z.number().int().nonnegative()
})
const conversationScanProgressSchema = z.object({
  scanId: z.string().nullable(), mode: z.enum(['deep', 'incremental']).nullable(), totalBatches: z.number().int().nonnegative(),
  completedBatches: z.number().int().nonnegative(), failedBatches: z.number().int().nonnegative(), activeBatches: z.number().int().nonnegative(),
  pausedBatches: z.number().int().nonnegative(), status: z.enum(['idle', 'running', 'paused', 'completed', 'failed'])
})
const conversationFilterBatchDecisionResultSchema = z.object({
  candidates: z.array(conversationFilterCandidateSchema), topicIds: z.array(z.string()), captureIds: z.array(z.string()), projectIds: z.array(z.string())
})
const contentDerivationPreparationSchema = z.object({
  contentTypeId: z.string(), templateId: z.string().nullable(), automaticResources: z.array(resourceSchema), recommendedResources: z.array(resourceSchema), manualResources: z.array(resourceSchema),
  excludedRecommendedResourceIds: z.array(z.string()), selectedManualResourceIds: z.array(z.string())
})
const draftVersionSchema = z.object({
  id: z.string(), projectId: z.string(), displayName: z.string().nullable(), documentType: z.enum(['script', 'outline', 'project_description']),
  kind: z.enum(['claude_candidate', 'codex_candidate', 'content_candidate', 'merged_draft', 'final', 'external_draft', 'user_edit']), content: z.string(), workspaceContent: z.string().nullable(),
  parentVersionIds: z.array(z.string()), sourceFilePath: z.string().nullable(), sourceFileId: z.string().nullable(), sourceFileName: z.string().nullable(), sourceTaskId: z.string().nullable(), sourceCandidateId: z.string().nullable(), resourceSnapshot: taskResourceSnapshotSchema.nullable(), revision: z.number().int().positive(), resolvedAt: z.string().nullable(), isFinal: z.boolean(),
  createdBy: z.enum(['user', 'provider', 'importer', 'system']), createdAt: z.string()
})
const stylePreferenceSchema = z.object({ id: z.string(), projectId: z.string(), sourceVersionId: z.string(), finalVersionId: z.string(), note: z.string(), createdAt: z.string() })
const publishingMaterialSchema = z.object({
  id: z.string(), projectId: z.string(), platform: z.string(), materialKind: z.enum(PUBLISHING_MATERIAL_KINDS), textValue: z.string().nullable(),
  fileId: z.string().nullable(), fileName: z.string().nullable(), sourceVersionId: z.string().nullable(), revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string()
})
const publishingDraftSchema = z.object({
  projectId: z.string(), platform: z.string(), title: z.string(), description: z.string(), tags: z.array(z.string()), sourceVersionId: z.string()
})
const publishingAccountSchema = z.object({
  id: z.string(), platform: z.string(), accountName: z.string(), positioning: z.string(),
  maskedPhone: z.string().nullable(), maskedEmail: z.string().nullable(), status: z.enum(['active', 'disabled']),
  sortOrder: z.number().int(), createdAt: z.string(), updatedAt: z.string()
})
const publishingAccountSelectionSchema = z.object({
  projectId: z.string(), platform: z.string(), accountId: z.string(), updatedAt: z.string()
})
const publishingAccountStateSchema = z.object({
  accounts: z.array(publishingAccountSchema), selections: z.array(publishingAccountSelectionSchema), secureStorageAvailable: z.boolean()
})
const distributionTargetSchema = z.object({
  id: z.string(), segmentId: z.string(), platform: z.string(), accountId: z.string(), accountName: z.string(),
  status: z.enum(DISTRIBUTION_TARGET_STATUSES), note: z.string(), updatedAt: z.string()
})
const distributionSegmentSchema = z.object({
  id: z.string(), batchId: z.string(), position: z.number().int().nonnegative(),
  startTimecode: z.string(), endTimecode: z.string(), theme: z.string(), summary: z.string(),
  fileId: z.string().nullable(), fileName: z.string().nullable(), fileAvailability: z.enum(['available', 'source_missing', 'permission_required', 'failed']).nullable(),
  targets: z.array(distributionTargetSchema), createdAt: z.string(), updatedAt: z.string()
})
const distributionBatchSchema = z.object({
  id: z.string(), title: z.string(), sourceKind: z.enum(DISTRIBUTION_SOURCE_KINDS),
  sourceProjectId: z.string().nullable(), sourceProjectTitle: z.string().nullable(), sourceVersionId: z.string().nullable(),
  sourceText: z.string(), status: z.enum(DISTRIBUTION_BATCH_STATUSES), analysisTaskId: z.string().nullable(),
  completedAt: z.string().nullable(), segments: z.array(distributionSegmentSchema), createdAt: z.string(), updatedAt: z.string()
})
const distributionCompletionResultSchema = z.object({
  batch: distributionBatchSchema, pendingTargetCount: z.number().int().nonnegative(), requiresConfirmation: z.boolean()
})
const coverCandidateSchema = z.object({
  id: z.string(), projectId: z.string(), taskId: z.string(), fileId: z.string(), fileName: z.string(), platform: z.string(),
  layout: z.enum(['bilibili_landscape', 'xiaohongshu_portrait']), generationMode: z.enum(['ai_finished', 'stable_layers']),
  headline: z.string(), promptSnapshot: z.string(), sourceVersionId: z.string(), position: z.number().int().nonnegative(), isSelected: z.boolean(), createdAt: z.string()
})
const titleCandidateSchema = z.object({
  id: z.string(), projectId: z.string(), taskId: z.string(), platform: z.string(), provider: z.enum(['codex_cli', 'claude_cli']),
  angle: z.string(), title: z.string(), coverText: z.string(), sourceVersionId: z.string(), masterTitleSnapshot: z.string().nullable(), isSelected: z.boolean(), createdAt: z.string()
})
const subtitleArtifactSchema = z.object({
  id: z.string(), jobId: z.string(), projectId: z.string(), fileId: z.string(), fileName: z.string(),
  artifactKind: z.enum(['zh_srt', 'bilingual_srt', 'bilingual_ass', 'plain_transcript']), createdAt: z.string()
})
const subtitleJobSchema = z.object({
  id: z.string(), projectId: z.string(), taskId: z.string(), inputFileId: z.string(), inputFileName: z.string(), schema: z.enum(['zh', 'bilingual']),
  engine: z.string(), language: z.string().nullable(), sourceVersionId: z.string().nullable(), confirmedZhArtifactId: z.string().nullable(),
  anomalies: z.array(z.object({ segmentIndex: z.number().int().nonnegative(), start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string(), confidence: z.number().min(0).max(1) })),
  stylePreset: z.record(z.string(), z.unknown()), artifacts: z.array(subtitleArtifactSchema), createdAt: z.string(), updatedAt: z.string()
})
const publishingHandoffSchema = z.object({
  id: z.string(), projectId: z.string(), platform: z.string(), adapterId: z.string(), targetUrl: z.string().url(), status: z.enum(['prepared', 'opened', 'confirmed', 'failed']),
  packageSnapshot: z.object({
    title: z.string(), description: z.string(), tags: z.array(z.string()), coverFileId: z.string(), coverFileName: z.string(),
    subtitleFileId: z.string().nullable(), subtitleFileName: z.string().nullable(),
    videoFileId: z.string(), videoFileName: z.string(), accountId: z.string(), accountName: z.string(), sourceVersionId: z.string()
  }),
  checklist: z.array(z.string()), issues: z.array(z.string()), openedAt: z.string().nullable(), confirmedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const publishingComputerUsePilotSchema = z.object({
  id: z.string().uuid(), handoffId: z.string().uuid(), projectId: z.string(), platform: z.literal('B站'),
  status: z.enum(['prepared', 'page_opened', 'ready_for_review', 'completed', 'failed', 'canceled']),
  accountName: z.string(), lastError: z.string().nullable(), openedAt: z.string().nullable(), readyForReviewAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string()
})
const feishuHandoffSchema = z.object({
  id: z.string(), projectId: z.string(), sourceVersionId: z.string(), targetHandoffId: z.string().nullable(), mode: z.enum(FEISHU_HANDOFF_MODES),
  accountName: z.string(), documentUrl: z.string().nullable(), contentSha256: z.string(),
  copiedAt: z.string().nullable(), wordExportedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const nasArchiveDestinationStatusSchema = z.object({
  id: z.literal('primary'),
  revision: z.string().uuid().nullable(),
  configured: z.boolean(),
  displayName: z.string().nullable(),
  categoryLabels: z.record(z.enum(ARCHIVE_CATEGORIES), z.string()),
  availability: z.enum(['not_configured', 'ready', 'not_mounted', 'not_writable', 'insufficient_space', 'unavailable']),
  freeBytes: z.number().int().nonnegative().nullable(),
  liveSmbValidated: z.boolean(),
  lastCheckedAt: z.string().nullable()
})
const nasBackupStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'succeeded', 'failed']),
  backupDate: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  lastSucceededAt: z.string().nullable(),
  errorMessage: z.string().nullable()
})
const archivePlanItemSchema = z.object({
  slot: z.enum(ARCHIVE_SLOTS),
  ordinal: z.number().int().nonnegative(),
  status: z.enum(ARCHIVE_SELECTION_STATUSES),
  displayName: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sourceFileId: z.string().nullable(),
  sourceVersionId: z.string().nullable(),
  sourceSha256: z.string().length(64).nullable()
})
const archivePlanSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  category: z.enum(ARCHIVE_CATEGORIES),
  categoryLabel: z.string(),
  year: z.number().int(),
  yearDirectory: z.string(),
  sequence: z.number().int().positive(),
  folderName: z.string(),
  planHash: z.string().length(64),
  expiresAt: z.string(),
  identityFrozen: z.boolean(),
  items: z.array(archivePlanItemSchema),
  missingCount: z.number().int().nonnegative(),
  notRequiredCount: z.number().int().nonnegative(),
  destination: nasArchiveDestinationStatusSchema,
  destinationRevision: z.string().uuid()
})
const archiveRunItemSchema = z.object({
  id: z.string(), slot: z.enum(ARCHIVE_SLOTS), ordinal: z.number().int().nonnegative(),
  selectionStatus: z.enum(ARCHIVE_SELECTION_STATUSES), sourceFileId: z.string().nullable(), sourceVersionId: z.string().nullable(),
  sourceName: z.string(), sizeBytes: z.number().int().nonnegative().nullable(), sourceSha256: z.string().nullable(), targetSha256: z.string().nullable(),
  finalName: z.string().nullable(), status: z.enum(ARCHIVE_ITEM_STATUSES), errorCode: z.string().nullable(),
  temporaryRemoved: z.boolean().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const archiveRunSchema = z.object({
  id: z.string(), projectId: z.string(), taskRunId: z.string(), category: z.enum(ARCHIVE_CATEGORIES), year: z.number().int(),
  sequence: z.number().int().positive(), folderName: z.string(), status: z.enum(ARCHIVE_RUN_STATUSES), planHash: z.string().length(64),
  confirmedAt: z.string(), manifestSha256: z.string().nullable(), manifestFileName: z.string().nullable(), missingCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable(),
  items: z.array(archiveRunItemSchema)
})
const projectMaterialSchema = z.object({
  id: z.string(), projectId: z.string(), role: z.enum(PROJECT_MATERIAL_ROLES), sourceKind: z.enum(PROJECT_MATERIAL_SOURCE_KINDS), title: z.string(),
  textContent: z.string().nullable(), sourceUrl: z.string().nullable(), fileId: z.string().nullable(), fileName: z.string().nullable(), pageCount: z.number().int().positive().nullable(),
  parseStatus: z.enum(PROJECT_MATERIAL_PARSE_STATUSES), isPrimaryReference: z.boolean(), attentionNote: z.string(), createdAt: z.string(), updatedAt: z.string()
})
const materialResearchSourceSchema = z.object({
  id: z.string(), title: z.string(), url: z.string().url(), publisher: z.string(), domain: z.string(),
  sourceType: z.enum(['official', 'primary', 'media', 'commerce', 'community', 'other']),
  publishedAt: z.string().nullable(), accessedAt: z.string()
}).strict()
const materialResearchResultSchema = z.object({
  suggestedTitle: z.string(), overview: z.string(),
  claims: z.array(z.object({
    id: z.string(), heading: z.string(), content: z.string(),
    status: z.enum(['supported', 'conflict', 'unverified']), sourceIds: z.array(z.string())
  }).strict()),
  conflicts: z.array(z.object({ topic: z.string(), details: z.string(), sourceIds: z.array(z.string()) }).strict()),
  unresolved: z.array(z.string()), sources: z.array(materialResearchSourceSchema), searchedAt: z.string()
}).strict()
const materialResearchSessionSchema = z.object({
  id: z.string().uuid(), taskId: z.string(), projectId: z.string(), request: z.string(), requestedTitle: z.string(),
  status: z.enum(TASK_STATUSES), progress: z.number().int().min(0).max(100), result: materialResearchResultSchema.nullable(),
  savedMaterialId: z.string().nullable(), errorMessage: z.string().nullable(), requestedAt: z.string(), finishedAt: z.string().nullable()
}).strict()
const projectAssetLinkSchema = z.object({
  id: z.string(), projectId: z.string(), projectMaterialId: z.string(), fileReferenceId: z.string(), parentLinkId: z.string().nullable(), relativePath: z.string(),
  position: z.number().int().nonnegative(), usageType: z.enum(PROJECT_ASSET_USAGE_TYPES).nullable(), isPrimaryReference: z.boolean(), attentionNote: z.string(),
  fileName: z.string(), fileKind: z.enum(['file', 'folder']), mimeType: z.string(), availability: z.enum(['available', 'source_missing', 'permission_required', 'failed']), processState: z.enum(['pending', 'ready', 'failed', 'stored_only']),
  capabilities: z.array(z.string()), createdAt: z.string(), updatedAt: z.string()
})
const projectAssetImportItemResultSchema = z.object({
  sourceName: z.string(), status: z.enum(PROJECT_ASSET_IMPORT_STATUSES), materialId: z.string().nullable(), fileCount: z.number().int().nonnegative(),
  folderCount: z.number().int().nonnegative(), storedOnlyCount: z.number().int().nonnegative(),
  failedEntries: z.array(z.object({ relativePath: z.string(), message: z.string() })), message: z.string().nullable()
})
const projectAssetImportBatchResultSchema = z.object({
  canceled: z.boolean(), items: z.array(projectAssetImportItemResultSchema), importedRootCount: z.number().int().nonnegative(),
  storedOnlyFileCount: z.number().int().nonnegative(), failedEntryCount: z.number().int().nonnegative()
})
const nullableMoneyCentsSchema = z.number().int().nonnegative().nullable()
const businessRecordSchema = z.object({
  projectId: z.string(), dealStatus: z.enum(BUSINESS_DEAL_STATUSES), lifecycleStatus: z.enum(BUSINESS_LIFECYCLE_STATUSES),
  manualSettledAt: z.string().nullable(), settlementMode: z.enum(['automatic', 'manual']).nullable(),
  orderPlatform: z.string(), orderPlatformManuallySet: z.boolean(), orderDate: z.string().nullable(), revenueMonth: z.string().nullable(), quotedAmountCents: nullableMoneyCentsSchema,
  platformOrderAmountCents: nullableMoneyCentsSchema, rebateInputMode: z.enum(REBATE_INPUT_MODES), finalRebateRatePercent: z.number().min(0).max(100).nullable(), finalRebateAmountCents: nullableMoneyCentsSchema,
  effectiveFinalRebateAmountCents: nullableMoneyCentsSchema, rebateRequirement: z.enum(REBATE_REQUIREMENTS), rebateRecipientType: z.enum(REBATE_RECIPIENT_TYPES),
  rebateRecipientName: z.string(), rebateExecutionStatus: z.enum(REBATE_EXECUTION_STATUSES),
  rebateProcedureStatus: z.enum(REBATE_PROCEDURE_STATUSES), plannedRebateDate: z.string().nullable(),
  paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES), paymentReceivedDate: z.string().nullable(), invoiceRequirement: z.enum(INVOICE_REQUIREMENTS),
  invoiceReceivedManuallyAt: z.string().nullable(),
  invoiceExecutionStatus: z.enum(INVOICE_EXECUTION_STATUSES), ledgerStatus: z.enum(BUSINESS_LEDGER_STATUSES),
  videoProductionCostCents: z.number().int().nonnegative(), trafficPromotionCostCents: z.number().int().nonnegative(), incomeAttributionDate: z.string().nullable(),
  effectiveIncomeAttributionDate: z.string().nullable(), totalPaidRebateCents: z.number().int().nonnegative(), remainingRebateCents: nullableMoneyCentsSchema,
  expectedIncomeCents: z.number().int().nullable(), expectedIncomeRatePercent: z.number().nullable(), notes: z.string(), trashedAt: z.string().nullable(), createdAt: z.string().nullable(), updatedAt: z.string().nullable()
})
const rebatePaymentSchema = z.object({
  id: z.string(), projectId: z.string(), amountCents: z.number().int().positive(), paidDate: z.string(), notes: z.string(), createdAt: z.string(), updatedAt: z.string()
})
const businessInvoiceSchema = z.object({
  id: z.string(), projectId: z.string(), issuerName: z.string(), amountCents: z.number().int().positive(), issuedDate: z.string().nullable(), status: z.enum(INVOICE_STATUSES),
  deliveredToClient: z.boolean(), notes: z.string(), linkedProjectIds: z.array(z.string()), sharedProjectCount: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string()
})
const businessFileSchema = z.object({
  id: z.string(), projectId: z.string(), role: z.enum(BUSINESS_FILE_ROLES), fileId: z.string(), fileName: z.string(), rebatePaymentId: z.string().nullable(), invoiceId: z.string().nullable(),
  linkedProjectIds: z.array(z.string()), sharedProjectCount: z.number().int().positive(), createdAt: z.string()
})
const businessEventSchema = z.object({
  id: z.string(), projectId: z.string(), action: z.enum(BUSINESS_EVENT_ACTIONS), summary: z.string(), createdAt: z.string()
})
const businessProjectDataSchema = z.object({ record: businessRecordSchema, rebatePayment: rebatePaymentSchema.nullable(), invoices: z.array(businessInvoiceSchema), files: z.array(businessFileSchema), events: z.array(businessEventSchema) })
const businessAutofillResultSchema = z.object({
  title: z.string().nullable(), dealStatus: z.enum(BUSINESS_DEAL_STATUSES).nullable(),
  orderPlatform: z.string().nullable(), orderDate: z.string().nullable(), revenueMonth: z.string().nullable(), quotedAmountCents: nullableMoneyCentsSchema, platformOrderAmountCents: nullableMoneyCentsSchema,
  finalRebateRatePercent: z.number().min(0).max(100).nullable(), finalRebateAmountCents: nullableMoneyCentsSchema,
  rebateRequirement: z.enum(REBATE_REQUIREMENTS).nullable(), rebateRecipientType: z.enum(REBATE_RECIPIENT_TYPES).nullable(), rebateRecipientName: z.string().nullable(),
  paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES).nullable(), paymentReceivedDate: z.string().nullable(), invoiceRequirement: z.enum(INVOICE_REQUIREMENTS).nullable(),
  videoProductionCostCents: nullableMoneyCentsSchema, trafficPromotionCostCents: nullableMoneyCentsSchema, notes: z.string().nullable(),
  recognizedFields: z.array(z.string()), warnings: z.array(z.string()), model: z.string()
}).strict()
const businessLedgerEntrySchema = businessRecordSchema.extend({
  projectTitle: z.string(), projectColorToken: z.string(), projectStatus: z.enum(PROJECT_STATUSES), invoiceIssuedCents: z.number().int().nonnegative(),
  linkedProjectTrashedAt: z.string().nullable(), ledgerOnly: z.boolean().default(false), businessFileCount: z.number().int().nonnegative(), sharedBusinessFileCount: z.number().int().nonnegative()
})
const otherIncomeCategorySchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), sortOrder: z.number().int(), isActive: z.boolean(), createdAt: z.string(), updatedAt: z.string()
}).strict()
const otherIncomeRecordSchema = z.object({
  id: z.string(), title: z.string(), categoryId: z.string().nullable(), categoryName: z.string(), sourceName: z.string(),
  revenueMonth: z.string().nullable(), incomeDate: z.string().nullable(), amountCents: z.number().int().nonnegative(), directCostCents: z.number().int().nonnegative(),
  expectedIncomeCents: z.number().int(), paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES), paymentReceivedDate: z.string().nullable(),
  status: z.enum(OTHER_INCOME_RECORD_STATUSES), currency: z.string(), notes: z.string(), sourceReference: z.string(), sourceTransactionId: z.string(), sourceHash: z.string(),
  originalFileId: z.string().nullable(), originalFileName: z.string().nullable(), trashedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
}).strict()
const otherIncomeRuleConditionsSchema = z.object({
  companies: z.array(z.string()), excludedCompanies: z.array(z.string()), includeKeywords: z.array(z.string()), excludeKeywords: z.array(z.string()),
  startDate: z.string().nullable(), endDate: z.string().nullable(), minimumAmountCents: z.number().int().nonnegative().nullable(), maximumAmountCents: z.number().int().nonnegative().nullable(),
  direction: z.literal('income'), paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES).nullable(), categoryId: z.string().nullable(), revenueMonth: z.string().nullable()
}).strict()
const otherIncomeImportRuleSchema = z.object({
  id: z.string(), name: z.string(), instruction: z.string(), conditions: otherIncomeRuleConditionsSchema, createdAt: z.string(), updatedAt: z.string()
}).strict()
const otherIncomeCompanyAliasSchema = z.object({ id: z.string(), companyName: z.string(), alias: z.string(), createdAt: z.string() }).strict()
const otherIncomeImportCandidateSchema = z.object({
  id: z.string(), rowNumber: z.number().int().positive(), title: z.string(), payer: z.string(), transactionDate: z.string().nullable(), revenueMonth: z.string().nullable(),
  amountCents: z.number().int().nonnegative().nullable(), direction: z.enum(['income', 'expense', 'refund', 'transfer', 'unknown']),
  paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES).nullable(), externalTransactionId: z.string(), summary: z.string(), currency: z.string(), rawText: z.string(),
  selected: z.boolean(), categoryId: z.string().nullable(), directCostCents: z.number().int().nonnegative(), matched: z.boolean(),
  matchReasons: z.array(z.string()), exclusionReasons: z.array(z.string()), evidence: z.array(z.string()), warnings: z.array(z.string()),
  duplicateConfidence: z.enum(['none', 'possible', 'exact']), duplicateRecordId: z.string().nullable(), suspectedBusiness: z.boolean(), sourceHash: z.string()
}).strict()
const incomeLedgerTotalsSchema = z.object({
  totalIncomeCents: z.number().int(), actualNetIncomeCents: z.number().int(),
  actualNetKnownCount: z.number().int().nonnegative(), actualNetEligibleCount: z.number().int().nonnegative(),
  expectedIncomeCents: z.number().int(),
  expectedNetKnownCount: z.number().int().nonnegative(), expectedNetEligibleCount: z.number().int().nonnegative(),
  receivedCents: z.number().int(), pendingCents: z.number().int(), recordCount: z.number().int().nonnegative()
}).strict()
const incomeLedgerSummarySchema = z.object({
  combined: incomeLedgerTotalsSchema, business: incomeLedgerTotalsSchema, other: incomeLedgerTotalsSchema
}).strict()
const businessFolderScanResultSchema = z.object({
  canceled: z.boolean(), scanId: z.string().nullable(), rootName: z.string(), ignoredCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()), candidates: z.array(z.object({
    id: z.string(), relativePath: z.string(), fileName: z.string(), suggestedRole: z.enum(BUSINESS_FILE_ROLES),
    reason: z.string(), sizeBytes: z.number().int().nonnegative()
  }))
}).strict()
export const businessLedgerLockStatusSchema = z.object({
  enabled: z.boolean(),
  unlocked: z.boolean(),
  securityAvailable: z.boolean(),
  touchIdAvailable: z.boolean()
}).strict()
const stageTimePointSchema = z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), segment: z.enum(STAGE_TIME_SEGMENTS) })
const stageTimeKeySchema = z.enum(['materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'feedback', 'versions'])
const stagePlanFieldSchema = z.enum(['start', 'duration', 'end'])
const stageTimeRecordSchema = z.object({
  id: z.string(), projectId: z.string(), stageKey: stageTimeKeySchema, status: z.enum(STAGE_TIME_STATUSES),
  startedAt: stageTimePointSchema.nullable(), completedAt: stageTimePointSchema.nullable(), startSource: z.enum(STAGE_TIME_SOURCES).nullable(), completionSource: z.enum(STAGE_TIME_SOURCES).nullable(),
  actualEffortHalfDayUnits: z.number().int().positive().nullable(),
  plannedStartedAt: stageTimePointSchema.nullable(), plannedCompletedAt: stageTimePointSchema.nullable(),
  estimatedDurationHalfDayUnits: z.number().int().positive().nullable(), planManualFields: z.array(stagePlanFieldSchema).max(2), planAutoField: stagePlanFieldSchema.nullable(),
  autoStartActionId: z.string().nullable(), durationSegments: z.number().int().nonnegative().nullable(), durationLabel: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const projectDetailSchema = projectSummarySchema.extend({ activeOutlineVersionId: z.string().nullable(), modules: z.array(projectModuleSchema), latestVersions: z.array(draftVersionSchema), versions: z.array(draftVersionSchema), contentTypeHistory: z.array(projectContentTypeHistorySchema), stylePreferences: z.array(stylePreferenceSchema), resourceReferences: z.array(projectResourceReferenceSchema), stageTimeRecords: z.array(stageTimeRecordSchema), materials: z.array(projectMaterialSchema), assetLinks: z.array(projectAssetLinkSchema), referenceRequirements: z.string(), publishingMaterials: z.array(publishingMaterialSchema), coverCandidates: z.array(coverCandidateSchema), titleCandidates: z.array(titleCandidateSchema), subtitleJobs: z.array(subtitleJobSchema), publishingHandoffs: z.array(publishingHandoffSchema), publishingComputerUsePilots: z.array(publishingComputerUsePilotSchema), business: businessProjectDataSchema.nullable() })
const stageTimeMutationResultSchema = z.object({ project: projectDetailSchema, record: stageTimeRecordSchema, eventId: z.string() })
const stageTimeContextSchema = z.object({
  currentPoint: stageTimePointSchema,
  timeZone: z.string().min(1).max(128),
  cutoffHour: z.number().int().min(0).max(23)
}).strict()
const stageTimeUpdateResultSchema = z.discriminatedUnion('changed', [
  z.object({ changed: z.literal(true), project: projectDetailSchema, record: stageTimeRecordSchema, eventId: z.string() }).strict(),
  z.object({ changed: z.literal(false), project: projectDetailSchema, record: stageTimeRecordSchema, eventId: z.null() }).strict()
])
const workspaceUndoStateSchema = z.object({
  canUndo: z.boolean(),
  operationId: z.string().uuid().nullable(),
  commandType: z.string().nullable(),
  label: z.string().nullable(),
  createdAt: z.string().nullable()
})
const workspaceUndoResultSchema = z.object({
  operationId: z.string().uuid(),
  commandType: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  label: z.string(),
  undoneAt: z.string()
})
const creationReportPeriodSchema = z.object({
  kind: z.enum(CREATION_REPORT_KINDS), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string(), comparisonLabel: z.enum(['上周', '上月'])
})
const nullableMetricSchema = z.number().nonnegative().nullable()
const creationReportStageSummarySchema = z.object({
  stageKey: stageTimeKeySchema, completedCount: z.number().int().nonnegative(), durationSampleCount: z.number().int().nonnegative(),
  averageDurationSegments: nullableMetricSchema, averageDurationLabel: z.string().nullable(), actualEffortSampleCount: z.number().int().nonnegative(),
  totalActualEffortHalfDayUnits: z.number().int().nonnegative(), averageActualEffortHalfDayUnits: nullableMetricSchema,
  scheduledSampleCount: z.number().int().nonnegative(), notDueSampleCount: z.number().int().nonnegative().default(0), delayedCompletedCount: z.number().int().nonnegative(), openOverdueCount: z.number().int().nonnegative(),
  averageDelaySegments: nullableMetricSchema, averageDelayLabel: z.string().nullable(), previousAverageDurationSegments: nullableMetricSchema,
  durationDeltaSegments: z.number().nullable()
})
const creationReportPublishedProjectSchema = z.object({
  projectId: z.string(), title: z.string(), colorToken: z.enum(PROJECT_COLOR_TOKENS), publishedAt: stageTimePointSchema,
  contentTypeId: z.string().default(''), contentTypeName: z.string().default('未分类'), platformTargets: z.array(z.string()).default([]),
  projectDurationSegments: nullableMetricSchema, projectDurationLabel: z.string().nullable(), actualEffortHalfDayUnits: z.number().int().nonnegative(),
  actualEffortStageCount: z.number().int().nonnegative(), delayedStageCount: z.number().int().nonnegative()
})
const creationReportPayloadV1Schema = z.object({
  version: z.literal(1), period: creationReportPeriodSchema, publishedCount: z.number().int().nonnegative(), projectDurationSampleCount: z.number().int().nonnegative(),
  averageProjectDurationSegments: nullableMetricSchema, averageProjectDurationLabel: z.string().nullable(), completedStageCount: z.number().int().nonnegative(),
  durationStageSampleCount: z.number().int().nonnegative(), actualEffortStageSampleCount: z.number().int().nonnegative(),
  delayedCompletedCount: z.number().int().nonnegative(), openOverdueCount: z.number().int().nonnegative(),
  publishedProjects: z.array(creationReportPublishedProjectSchema), stageSummaries: z.array(creationReportStageSummarySchema),
  comparison: z.object({
    periodLabel: z.string(), publishedCount: z.number().int().nonnegative(), publishedCountDelta: z.number().int(),
    averageProjectDurationSegments: nullableMetricSchema, averageProjectDurationDeltaSegments: z.number().nullable()
  })
}).strict()
const scheduleVarianceStateSchema = z.enum(['no_schedule', 'not_due', 'early', 'on_time', 'late_completed', 'overdue_open'])
const creationReportProjectStageSchema = z.object({
  stageKey: stageTimeKeySchema,
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
  stateAtCutoff: z.enum(STAGE_TIME_STATUSES),
  startedAt: stageTimePointSchema.nullable(),
  completedAt: stageTimePointSchema.nullable(),
  durationSegments: nullableMetricSchema,
  elapsedSegments: nullableMetricSchema,
  actualEffortHalfDayUnits: z.number().int().positive().nullable(),
  plannedStartAt: stageTimePointSchema.nullable(),
  plannedEndAt: stageTimePointSchema.nullable(),
  varianceDeadlineAt: stageTimePointSchema.nullable().default(null),
  varianceInPeriod: z.boolean().default(false),
  varianceSegments: z.number().nullable(),
  varianceState: scheduleVarianceStateSchema
}).strict()
const creationReportPeriodProjectSchema = z.object({
  projectId: z.string(),
  title: z.string(),
  colorToken: z.enum(PROJECT_COLOR_TOKENS),
  projectStatus: z.enum(PROJECT_STATUSES),
  actualStageKeys: z.array(stageTimeKeySchema),
  scheduledStageKeys: z.array(stageTimeKeySchema),
  lifecycleDurationSegments: nullableMetricSchema,
  summaryActualEffortHalfDayUnits: z.number().int().nonnegative(),
  summaryActualEffortStageCount: z.number().int().nonnegative(),
  completeTimeSampleCount: z.number().int().nonnegative(),
  completedStageCount: z.number().int().nonnegative(),
  delayedStageCount: z.number().int().nonnegative(),
  openOverdueCount: z.number().int().nonnegative(),
  stages: z.array(creationReportProjectStageSchema)
}).strict()
const creationReportPayloadV2Schema = creationReportPayloadV1Schema.omit({ version: true }).extend({
  version: z.literal(2),
  calculatedThrough: stageTimePointSchema,
  timeZone: z.string().min(1).max(128),
  periodProjects: z.array(creationReportPeriodProjectSchema)
}).strict()
export const creationReportPayloadSchema = z.discriminatedUnion('version', [creationReportPayloadV1Schema, creationReportPayloadV2Schema])
const creationReportSnapshotSchema = z.object({
  id: z.string(), kind: z.enum(CREATION_REPORT_KINDS), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputHash: z.string().length(64), payload: creationReportPayloadSchema, generatedAt: z.string()
}).strict()
const creationReportSnapshotSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(CREATION_REPORT_KINDS),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version: z.union([z.literal(1), z.literal(2)]),
  generatedAt: z.string()
}).strict()
const projectCreationReviewStageSchema = creationReportProjectStageSchema.omit({ stateAtCutoff: true, varianceInPeriod: true }).extend({
  status: z.enum(STAGE_TIME_STATUSES),
  startVarianceSegments: z.number().nullable(),
  baseline: z.object({
    source: z.enum(['first_saved', 'legacy']), capturedAt: z.string(),
    plannedStartAt: stageTimePointSchema.nullable(), plannedEndAt: stageTimePointSchema.nullable(),
    varianceDeadlineAt: stageTimePointSchema.nullable(),
    startVarianceSegments: z.number().nullable(), varianceSegments: z.number().nullable(),
    varianceState: scheduleVarianceStateSchema
  }).strict().nullable()
}).strict()
const projectCreationReviewSchema = z.object({
  projectId: z.string(),
  title: z.string(),
  colorToken: z.enum(PROJECT_COLOR_TOKENS),
  projectStatus: z.enum(PROJECT_STATUSES),
  lifecycleStartedAt: stageTimePointSchema.nullable(),
  lifecycleEndedAt: stageTimePointSchema.nullable(),
  lifecycleDurationSegments: nullableMetricSchema,
  lifecycleOngoing: z.boolean(),
  lifecycleEndKind: z.enum(['published', 'ongoing', 'archived_without_publish', 'missing_start']),
  summaryActualEffortHalfDayUnits: z.number().int().nonnegative(),
  summaryActualEffortStageCount: z.number().int().nonnegative(),
  completeTimeSampleCount: z.number().int().nonnegative(),
  completedStageCount: z.number().int().nonnegative(),
  largestAbsoluteVarianceStageKey: stageTimeKeySchema.nullable(),
  largestAbsoluteVarianceSegments: z.number().nullable(),
  stages: z.array(projectCreationReviewStageSchema),
  calculatedAt: z.string(),
  calculatedThrough: stageTimePointSchema,
  timeZone: z.string().min(1).max(128)
}).strict()
const creationReportMessageSchema = z.object({
  id: z.string(), threadId: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), provider: z.enum(['codex_cli', 'claude_cli']), taskId: z.string().nullable(), createdAt: z.string()
})
const creationReportConversationSchema = z.object({
  reportSnapshotId: z.string(), threadId: z.string().nullable(), messages: z.array(creationReportMessageSchema), createdAt: z.string().nullable(), updatedAt: z.string().nullable()
})
const scriptRevisionSuggestionSchema = z.object({
  originalText: z.string(), replacementText: z.string(), action: z.enum(['replace', 'insert_after']), summary: z.string(), rationale: z.string()
})
const scriptRevisionSelectionSnapshotSchema = z.object({
  baseVersionId: z.string(), targetSelectionId: z.string().nullable().optional().transform((value) => value ?? null),
  selectedText: z.string().nullable(), selectionHash: z.string().nullable(), contextBefore: z.string(), contextAfter: z.string(),
  occurrenceIndex: z.number().int().nonnegative().nullable(), from: z.number().int().nonnegative().nullable(), to: z.number().int().nonnegative().nullable(),
  applicationTarget: z.object({
    surface: z.literal('version_compare'), side: z.enum(['left', 'right']), sourceId: z.string(), contentHash: z.string(), content: z.string(),
    range: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), selectedText: z.string() }).strict().nullable(),
    inheritedConflicts: z.array(z.object({
      id: z.string(), kind: z.enum(['fact', 'brief', 'real_experience']), summary: z.string(),
      sourceSelectionIds: z.array(z.string()), sourceExcerpts: z.array(z.string())
    }).strict()).optional()
  }).strict().nullable().optional()
})
const providerSecuritySnapshotSchema = z.object({
  provider: z.enum(['codex_cli', 'claude_cli']), cliVersion: z.string(), fingerprint: z.string(), policyVersion: z.string()
})
const scriptRevisionContextSnapshotSchema = z.object({
  version: z.literal(1),
  baseVersion: z.object({ id: z.string(), revision: z.number().int().positive(), content: z.string() }),
  selection: scriptRevisionSelectionSnapshotSchema,
  resourceSnapshot: taskResourceSnapshotSchema.nullable(),
  providerSecurity: providerSecuritySnapshotSchema,
  inputBudget: z.object({ estimatedCharacters: z.number().int().nonnegative(), maximumCharacters: z.number().int().positive() })
})
const contentFactAnnotationSchema = z.object({
  id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string(),
  provenance: z.enum(['ai_supplement', 'web_supplement', 'needs_confirmation']), note: z.string(),
  webSources: z.array(z.object({ title: z.string(), url: z.string().url() }).strict()),
  evidenceIds: z.array(z.string().min(1).max(128)).max(20).optional().default([])
}).strict().refine((value) => value.end >= value.start, { message: '事实标注结束位置不能早于开始位置', path: ['end'] })
const scriptRevisionMessageSchema = z.object({
  id: z.string(), threadId: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), provider: z.enum(['codex_cli', 'claude_cli']),
  selectedText: z.string().nullable(), selectionHash: z.string().nullable(), selectionSnapshot: scriptRevisionSelectionSnapshotSchema.nullable(),
  suggestion: scriptRevisionSuggestionSchema.nullable(), suggestionStatus: z.enum(['pending', 'applied', 'copied', 'discarded']).nullable(),
  candidateGroupId: z.string().nullable(), candidateNumber: z.number().int().positive().nullable(),
  generationRound: z.number().int().positive().nullable(), candidateInstruction: z.string().nullable(),
  taskId: z.string().nullable(), contextSnapshot: scriptRevisionContextSnapshotSchema.nullable(),
  model: z.string().nullable(), reasoningEffort: z.string().nullable(),
  sourceSelections: z.array(z.object({
    selectionId: z.string(), position: z.number().int().nonnegative(),
    sourceKind: z.enum(['current_script', 'material_draft', 'comparison_source', 'comparison_candidate', 'draft_version']),
    sourceId: z.string(), sourceVersion: z.string(), sourceContentHash: z.string(), sourceLabel: z.string(),
    semanticGroupId: z.string().nullable(), blockId: z.string(), blockStart: z.number().int().nonnegative(),
    blockEnd: z.number().int().positive(), selectedText: z.string()
  }).strict()),
  conflicts: z.array(z.object({
    id: z.string(), kind: z.enum(['fact', 'brief', 'real_experience']), summary: z.string(),
    sourceSelectionIds: z.array(z.string()), sourceExcerpts: z.array(z.string())
  }).strict()),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']).nullable(),
  webSearches: z.array(z.object({
    type: z.enum(['search', 'open_page', 'find_in_page', 'other']), query: z.string().nullable(), url: z.string().nullable(),
    runtimeAccessId: z.string().nullable().optional(), accessedAt: z.string().nullable().optional()
  })),
  factAnnotations: z.array(contentFactAnnotationSchema),
  createdAt: z.string()
})
const scriptRevisionConversationSchema = z.object({
  projectId: z.string(), surface: z.enum(['conversation', 'version_compare']), threadId: z.string().nullable(), baseVersionId: z.string().nullable(), baseVersionRevision: z.number().int().positive().nullable(),
  provider: z.enum(['codex_cli', 'claude_cli']).nullable(), providerFingerprint: z.string().nullable(), messages: z.array(scriptRevisionMessageSchema),
  providerThreadId: z.string().nullable(), model: z.string().nullable(), reasoningEffort: z.string().nullable(),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']),
  createdAt: z.string().nullable(), updatedAt: z.string().nullable()
})
const scriptRevisionApplyValidationSchema = z.object({ status: z.enum(['allowed', 'target_changed', 'target_ambiguous']), suggestion: scriptRevisionSuggestionSchema })
const draftParagraphSnapshotSchema = z.object({
  id: z.string(), position: z.number().int().nonnegative(), text: z.string()
})
const draftTextProviderSchema = z.enum(['codex_cli', 'claude_cli', 'external_api'])
const draftWorkingSourceSchema = z.object({
  sourceKind: z.enum(['freeform', 'provider']), providerConfigId: z.string().nullable(), provider: draftTextProviderSchema.nullable(),
  model: z.string().nullable(), providerFingerprint: z.string().nullable(), taskId: z.string().nullable()
})
const draftSourceSnapshotSchema = z.object({
  id: z.string(), sessionId: z.string(), side: z.enum(['claude', 'codex']), sourceKind: z.enum(['freeform', 'provider']),
  providerConfigId: z.string().nullable(), provider: draftTextProviderSchema.nullable(), model: z.string().nullable(),
  providerFingerprint: z.string().nullable(), content: z.string(), contentHash: z.string(),
  paragraphs: z.array(draftParagraphSnapshotSchema), createdAt: z.string()
})
const contentSourceSelectionSnapshotSchema = z.object({
  selectionId: z.string().min(1).max(128), position: z.number().int().nonnegative(),
  sourceKind: z.enum(['current_script', 'material_draft', 'comparison_source', 'comparison_candidate', 'draft_version']),
  sourceId: z.string().min(1).max(256), sourceVersion: z.string().min(1).max(256),
  sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/), sourceLabel: z.string().min(1).max(160),
  semanticGroupId: z.string().min(1).max(128).nullable(), blockId: z.string().min(1).max(128),
  blockStart: z.number().int().nonnegative(), blockEnd: z.number().int().nonnegative(), selectedText: z.string().min(1).max(80_000)
}).strict().refine((value) => value.blockEnd >= value.blockStart, { message: '选区结束位置不能早于开始位置', path: ['blockEnd'] })
const contentSelectionConflictSchema = z.object({
  id: z.string().min(1).max(128), kind: z.enum(['fact', 'brief', 'real_experience']),
  summary: z.string().min(1).max(2_000), sourceSelectionIds: z.array(z.string().min(1).max(128)).max(20),
  sourceExcerpts: z.array(z.string().max(4_000)).max(20)
}).strict()
const draftCandidateRevisionSchema = z.object({
  id: z.string(), groupId: z.string(), parentCandidateId: z.string().nullable(), parentTraceId: z.string().nullable(), sourceKind: z.enum(['freeform', 'provider']),
  providerConfigId: z.string().nullable(), provider: draftTextProviderSchema.nullable(), model: z.string().nullable(), reasoningEffort: z.string().nullable(),
  providerFingerprint: z.string().nullable(), requirement: z.string(), content: z.string(), summary: z.string(), rationale: z.string(),
  contentHash: z.string(), characterCount: z.number().int().nonnegative(), revisionRound: z.number().int().positive(),
  status: z.enum(['active', 'input_changed']), inputRelationChanged: z.boolean(),
  targetDecisionFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  targetKind: z.enum(['group', 'claude', 'codex', 'candidate', 'current']).nullable(), targetContent: z.string(),
  sourceSelections: z.array(contentSourceSelectionSnapshotSchema).max(100), conflicts: z.array(contentSelectionConflictSchema).max(100),
  factAnnotations: z.array(contentFactAnnotationSchema).max(500),
  taskId: z.string().nullable(), position: z.number().int().nonnegative(), createdAt: z.string()
})
const draftGroupDecisionSchema = z.object({
  groupId: z.string(), kind: z.enum(['claude', 'codex', 'candidate', 'freeform', 'combination', 'omit', 'unresolved']),
  sourceId: z.string().nullable(), sourceIds: z.array(z.string()), content: z.string(), note: z.string(),
  markers: z.array(z.object({
    id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
    text: z.string(), note: z.string(), status: z.enum(['active', 'position_changed'])
  }).strict()),
  updatedAt: z.string()
})
const draftAlignmentGroupSchema = z.object({
  id: z.string(), sessionId: z.string(), position: z.number().int().nonnegative(), labelIndex: z.number().int().positive(),
  matchType: z.enum(['exact', 'related', 'claude_only', 'codex_only', 'needs_review']),
  outlinePlacement: z.enum(['outline_item', 'outside_outline']), outlineItemId: z.string().nullable(),
  outlineItemTitle: z.string().nullable(), outlineLabel: z.string().nullable(),
  claudeParagraphs: z.array(draftParagraphSnapshotSchema), codexParagraphs: z.array(draftParagraphSnapshotSchema),
  candidates: z.array(draftCandidateRevisionSchema), decision: draftGroupDecisionSchema.nullable(), manuallyAdjusted: z.boolean(),
  createdAt: z.string(), updatedAt: z.string()
})
const draftComparisonSessionSchema = z.object({
  id: z.string(), projectId: z.string(), status: z.enum(['empty', 'aligning', 'ready', 'failed']),
  alignmentProviderConfigId: z.string().nullable(), alignmentProvider: draftTextProviderSchema.nullable(),
  alignmentModel: z.string().nullable(), alignmentProviderFingerprint: z.string().nullable(), alignmentTaskId: z.string().nullable(),
  errorMessage: z.string().nullable(), claudeSnapshot: draftSourceSnapshotSchema, codexSnapshot: draftSourceSnapshotSchema,
  groups: z.array(draftAlignmentGroupSchema), createdAt: z.string(), updatedAt: z.string()
})
const draftComparisonWorkspaceSchema = z.object({
  projectId: z.string(), currentDocumentBaseRevision: z.number().int().positive().nullable(), currentDocumentBaseContentHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  claudeContent: z.string(), codexContent: z.string(),
  claudeSource: draftWorkingSourceSchema, codexSource: draftWorkingSourceSchema,
  claudeUpdatedAt: z.string().nullable(), codexUpdatedAt: z.string().nullable(), updatedAt: z.string().nullable(),
  activeSession: draftComparisonSessionSchema.nullable(),
  sessionHistory: z.array(z.object({
    id: z.string(), status: z.enum(['empty', 'aligning', 'ready', 'failed']), groupCount: z.number().int().nonnegative(),
    createdAt: z.string(), updatedAt: z.string()
  }))
})
const draftComparisonHistoryEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  label: z.string(),
  createdAt: z.string()
}).strict()
const scriptMaterialPointSchema = z.object({
  id: z.string(), revisionId: z.string(), position: z.number().int().nonnegative(),
  sourceStart: z.number().int().nonnegative(), sourceEnd: z.number().int().nonnegative(),
  sourceText: z.string(), summary: z.string(), requirement: z.string(),
  adoption: z.enum(['required', 'excluded']), createdAt: z.string(), updatedAt: z.string()
}).strict()
const scriptMaterialRevisionSchema = z.object({
  id: z.string(), projectId: z.string(), revision: z.number().int().positive(),
  content: z.string(), contentHash: z.string(), pointsConfirmed: z.boolean(),
  confirmedAt: z.string().nullable(), createdAt: z.string()
}).strict()
const scriptMaterialDraftParagraphSchema = z.object({
  id: z.string(), position: z.number().int().nonnegative(), text: z.string(),
  sourcePointIds: z.array(z.string()),
  transform: z.enum(['preserved', 'polished', 'expanded', 'combined', 'reordered']),
  provenance: z.array(z.enum(['source', 'ai_supplement', 'web_supplement', 'needs_confirmation'])),
  webSources: z.array(z.object({ title: z.string(), url: z.string() }).strict()),
  annotations: z.array(z.object({
    id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string(),
    provenance: z.enum(['ai_supplement', 'web_supplement', 'needs_confirmation']), note: z.string(),
    webSources: z.array(z.object({ title: z.string(), url: z.string() }).strict()),
    evidenceIds: z.array(z.string().min(1).max(128)).max(20).optional().default([]),
    status: z.enum(['active', 'confirmed'])
  }).strict()).default([]),
  manualMarks: z.array(z.object({
    id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive(),
    text: z.string(), style: z.enum(['highlight', 'underline', 'strike'])
  }).strict()).default([])
}).strict()
const scriptMaterialDraftSchema = z.object({
  id: z.string(), projectId: z.string(), revisionId: z.string(), side: z.enum(['codex', 'claude']),
  sourceKind: z.enum(['freeform', 'provider']), providerConfigId: z.string().nullable(),
  provider: draftTextProviderSchema.nullable(), model: z.string().nullable(), reasoningEffort: z.string().nullable(),
  providerFingerprint: z.string().nullable(), requirement: z.string(), inputFingerprint: z.string(),
  content: z.string(), contentHash: z.string(), draftVersion: z.number().int().positive(),
  mappingState: z.enum(['pending', 'ready', 'failed']), mappingTaskId: z.string().nullable(), mappingError: z.string().nullable(),
  currentContentHash: z.string().nullable(),
  currentMappings: z.array(z.object({
    currentParagraphId: z.string(), currentParagraphText: z.string(),
    sourcePointIds: z.array(z.string()), draftParagraphIds: z.array(z.string())
  }).strict()),
  paragraphs: z.array(scriptMaterialDraftParagraphSchema),
  taskId: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
}).strict()
const scriptMaterialRewriteCandidateSchema = z.object({
  id: z.string(), projectId: z.string(), revisionId: z.string(), draftId: z.string(), side: z.enum(['codex', 'claude']),
  parentCandidateId: z.string().nullable(),
  applicationTarget: z.object({
    targetId: z.string(), selectedText: z.string(), contentHash: z.string(),
    from: z.number().int().nonnegative(), to: z.number().int().nonnegative()
  }).strict().nullable(),
  paragraphIds: z.array(z.string()), selectedText: z.string(),
  selectedStart: z.number().int().nonnegative().nullable(), selectedEnd: z.number().int().positive().nullable(),
  requirement: z.string(), content: z.string(), sourcePointIds: z.array(z.string()),
  annotations: z.array(z.object({
    id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string(),
    provenance: z.enum(['ai_supplement', 'web_supplement', 'needs_confirmation']), note: z.string(),
    webSources: z.array(z.object({ title: z.string(), url: z.string() }).strict()),
    evidenceIds: z.array(z.string().min(1).max(128)).max(20).optional().default([]),
    status: z.enum(['active', 'confirmed'])
  }).strict()),
  providerConfigId: z.string().nullable(), provider: draftTextProviderSchema.nullable(),
  model: z.string().nullable(), reasoningEffort: z.string().nullable(),
  sourceSelections: z.array(contentSourceSelectionSnapshotSchema).max(100), conflicts: z.array(contentSelectionConflictSchema).max(100),
  taskId: z.string().nullable(), taskStatusAtSnapshot: z.enum(TASK_STATUSES).nullable().optional(),
  taskErrorAtSnapshot: z.string().nullable().optional(), createdAt: z.string()
}).strict()
const scriptMaterialCheckSchema = z.object({
  id: z.string(), projectId: z.string(), revisionId: z.string(), target: z.enum(['codex', 'claude', 'current']),
  targetIdentity: z.string(), targetContentHash: z.string(), inputFingerprint: z.string(),
  state: z.enum(['unchecked', 'checking', 'ready', 'stale', 'failed']),
  pointCoverage: z.array(z.object({
    pointId: z.string(), status: z.enum(['complete', 'partial', 'missing', 'excluded', 'allowed_omission']),
    paragraphIds: z.array(z.string()), rationale: z.string()
  }).strict()),
  paragraphFindings: z.array(z.object({
    id: z.string(), paragraphId: z.string(), sourcePointIds: z.array(z.string()),
    provenance: z.enum(['source', 'ai_supplement', 'web_supplement', 'needs_confirmation']), note: z.string(),
    status: z.enum(['active', 'confirmed']), resolutionNote: z.string(), confirmedAt: z.string().nullable()
  }).strict()),
  allowedOmissionPointIds: z.array(z.string()), taskId: z.string().nullable(), errorMessage: z.string().nullable(), checkedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string()
}).strict()
const scriptMaterialWorkspaceSchema = z.object({
  projectId: z.string(), workingContent: z.string(), workingBaseRevisionId: z.string().nullable(),
  requirement: z.string(), aiCount: z.union([z.literal(1), z.literal(2)]),
  selectedAiSide: z.enum(['codex', 'claude']),
  selectedCodexDraftId: z.string().nullable(), selectedClaudeDraftId: z.string().nullable(),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']),
  updatedAt: z.string().nullable(), activeRevision: scriptMaterialRevisionSchema.nullable(),
  points: z.array(scriptMaterialPointSchema), drafts: z.array(scriptMaterialDraftSchema),
  checks: z.array(scriptMaterialCheckSchema),
  rewriteCandidates: z.array(scriptMaterialRewriteCandidateSchema),
  messages: z.array(z.object({
    id: z.string(), projectId: z.string(), revisionId: z.string(), side: z.enum(['codex', 'claude']),
    role: z.enum(['user', 'assistant']), content: z.string(), taskId: z.string().nullable(), createdAt: z.string()
  }).strict())
}).strict()
const scriptMaterialFinalizationGateSchema = z.object({
  hasMaterialContext: z.boolean(), canFinalize: z.boolean(),
  state: z.enum(['not_required', 'unchecked', 'checking', 'stale', 'failed', 'blocked', 'ready']),
  currentContentHash: z.string(), check: scriptMaterialCheckSchema.nullable(),
  blockingPointIds: z.array(z.string()), unresolvedFindingIds: z.array(z.string()), message: z.string()
}).strict()
const scriptMaterialVersionSnapshotSchema = z.object({
  versionId: z.string(), projectId: z.string(), sourceRevisionId: z.string(), sourceRevisionHash: z.string(),
  currentContentHash: z.string(), workspaceContentHash: z.string(), auditInputFingerprint: z.string(), snapshotHash: z.string(),
  workspace: scriptMaterialWorkspaceSchema,
  finalization: z.object({
    allowedOmissionPointIds: z.array(z.string()), confirmedFindingIds: z.array(z.string()), finalizedAt: z.string()
  }).strict().nullable(),
  createdAt: z.string()
}).strict()
const captureAttachmentSchema = z.object({
  id: z.string(), captureId: z.string(), fileReferenceId: z.string(), attachmentKind: z.enum(['image', 'video', 'audio', 'pdf', 'word', 'file']),
  position: z.number().int().nonnegative(), fileName: z.string(), mimeType: z.string(), sizeBytes: z.number().int().nonnegative(),
  processState: z.enum(['pending', 'ready', 'failed', 'stored_only']), capabilities: z.array(z.string()), createdAt: z.string()
})
const captureSchema = z.object({
  id: z.string(), captureKind: z.enum(['topic_idea', 'project_content', 'general_record', 'unknown', 'client_feedback']), primaryProjectId: z.string().nullable(),
  referencedProjectIds: z.array(z.string()), linkedTopicId: z.string().nullable(), discardedAt: z.string().nullable(),
  classificationStatus: z.enum(['unprocessed', 'suggested', 'confirmed']), classificationConfidence: z.number().nullable(),
  classificationActor: z.enum(['user', 'system']).nullable(),
  suggestedContentTypeId: z.string().nullable(), suggestedProjectId: z.string().nullable(), classificationReason: z.string().nullable(),
  classifiedAt: z.string().nullable(), useStatus: z.enum(['active', 'parked', 'discarded']), usageType: z.enum(['parameter_fact', 'opinion', 'material_clue']).nullable(), generalCategoryId: z.string().nullable(),
  originalContent: z.string(),
  mobileTitle: z.string().nullable().default(null),
  mobileSourceApp: z.string().nullable().default(null),
  mobileSourceTitle: z.string().nullable().default(null),
  mobileSourceUrl: z.string().nullable().default(null),
  mobileNotes: z.string().default(''),
  mobileRecordingMarkersMs: z.array(z.number().int().nonnegative()).default([]),
  mobileRecordingInterruptionReason: z.string().nullable().default(null),
  attachments: z.array(captureAttachmentSchema).default([]), sourceType: z.enum(['quick_capture', 'web_bookmark', 'notion_import', 'project', 'conversation_filter', 'mobile_android']), createdAt: z.string()
})
const captureDestinationCandidateSchema = z.object({ projectId: z.string(), title: z.string(), contentTypeId: z.string(), score: z.number().min(0).max(1), reason: z.string() })
const captureDeduplicationResultSchema = z.object({
  scannedCount: z.number().int().nonnegative(),
  duplicateGroupCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  retainedCaptureIds: z.array(z.string()),
  discarded: z.array(z.object({ captureId: z.string(), previousUseStatus: z.literal('active') }))
})
const generalRecordCategorySchema = z.object({ id: z.string(), name: z.string(), description: z.string(), sortOrder: z.number().int(), isActive: z.boolean() })
export const captureContextSchema = z.object({
  projects: z.array(projectSummarySchema.pick({ id: true, title: true, contentTypeName: true, status: true, isCommercial: true })),
  preferredProjectId: z.string().nullable(),
  preferredCaptureKind: z.enum(['project_content', 'client_feedback']).nullable(),
  theme: z.enum(['light', 'dark']),
  visualStyle: z.enum(['warm', 'feishu'])
})
const topicDirectionSchema = z.object({
  id: z.string(), topicId: z.string(), themeTitle: z.string(), themeKey: z.string(), title: z.string(), summary: z.string(), isPrimary: z.boolean(),
  sourceRefs: z.array(z.object({ sourceId: z.string(), messageId: z.string(), quote: z.string(), sourceTitle: z.string().optional(), sourceUpdatedAt: z.string().optional() })),
  sourceCandidateId: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const topicSchema = z.object({
  videoFormat: z.enum(VIDEO_FORMATS).nullable().default(null),
  isCommercial: z.boolean().default(false),
  id: z.string(), title: z.string(), coreAngle: z.string(), contentTypeId: z.string(), importanceLevel: z.number().int().min(0).max(3), needsMoreExperience: z.boolean(),
  startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), expectedCompletionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), actualCompletionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), scheduleVarianceDays: z.number().int().nullable(),
  nextActionKind: z.enum(['advance_stage', 'create_project', 'open_project', 'restart_project', 'none']), nextStageId: z.string().nullable(), stageId: z.string(),
  customValues: z.record(z.string(), z.string().nullable()), sourceCaptureIds: z.array(z.string()), createdProjectId: z.string().nullable(), lastProjectDeletedAt: z.string().nullable(), trashedAt: z.string().nullable(),
  directions: z.array(topicDirectionSchema)
})
const topicStageDefinitionSchema = z.object({ id: z.string(), name: z.string(), nextActionLabel: z.string().nullable(), position: z.number().int(), role: z.enum(TOPIC_STAGE_ROLES), createdAt: z.string(), updatedAt: z.string() })
const topicStageDeleteResultSchema = z.object({ stages: z.array(topicStageDefinitionSchema), reassignedTopicCount: z.number().int().nonnegative(), replacementStageName: z.string() })
const topicColumnDefinitionSchema = z.object({ id: z.string(), name: z.string(), position: z.number().int(), dataType: z.enum(['text', 'number', 'date', 'relation', 'action']), builtinKey: z.enum(['video', 'kind', 'title', 'importance', 'direction', 'stage', 'start', 'expected', 'actual', 'variance', 'next', 'inspirations']).nullable(), isVisible: z.boolean(), createdAt: z.string(), updatedAt: z.string() })
const scheduleItemSchema = z.object({
  groupId: z.string().nullable().optional(),
  trip: businessTripMetaSchema.nullable().optional(),
  id: z.string(), projectId: z.string().nullable(), colorToken: z.enum(PROJECT_COLOR_TOKENS).nullable(), title: z.string(), actionType: z.string(), startAt: z.string().nullable(), endAt: z.string().nullable(),
  scheduleKind: z.enum(SCHEDULE_KINDS), state: z.enum(SCHEDULE_STATES), waitingFor: z.string().nullable(),
  source: z.enum(['user', 'project_node', 'synchronized']), isMovable: z.boolean(), createdAt: z.string(), updatedAt: z.string()
})
const todoDateRangeSchema = z.object({
  startDate: z.iso.date(), endDate: z.iso.date(), name: z.string().trim().max(60)
}).strict().refine(range => range.startDate <= range.endDate, '结束日期不能早于开始日期')
const todoItemSchema = z.object({
  isExtra: z.boolean().optional(),
  dateRange: todoDateRangeSchema.nullable().optional(),
  stageLinkSource: z.literal('manual').nullable().optional(),
  stageKey: stageTimeKeySchema.nullable().optional(),
  id: z.string().uuid(),
  title: z.string().min(1).max(300),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  segment: z.enum(TODO_SEGMENTS).nullable(),
  category: z.enum(TODO_CATEGORIES),
  projectId: z.string().nullable(),
  status: z.enum(['open', 'completed', 'dismissed']),
  trackingMode: z.enum(TODO_TRACKING_MODES),
  progress: z.number().int().min(0).max(100),
  progressBeforeComplete: z.number().int().min(0).max(99).nullable(),
  source: z.enum(['manual', 'schedule']),
  sourceScheduleId: z.string().nullable(),
  sourcePlannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sourceSegment: z.enum(TODO_SEGMENTS).nullable(),
  scheduleSyncEnabled: z.boolean(),
  completedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
const dailyWorkLogSchema = z.object({
  totalMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  selfMediaMinutes: z.number().int().min(0).max(1440),
  aiMinutes: z.number().int().min(0).max(1440),
  otherWorkMinutes: z.number().int().min(0).max(1440),
  updatedAt: z.string()
}).strict()
const taskPermissionProfileSchema = z.object({
  network: z.enum(['off', 'web_search', 'provider_only']), readableRefs: z.array(z.string()),
  writableTarget: z.enum(['new_version', 'candidate_fact', 'candidate_asset', 'archive', 'none']), shell: z.literal(false)
})
const taskRunSchema = z.object({
  id: z.string(), taskType: z.enum(TASK_TYPES), projectId: z.string().nullable(), title: z.string(), provider: z.enum(PROVIDER_KINDS),
  model: z.string().nullable(), status: z.enum(TASK_STATUSES), progress: z.number().int().min(0).max(100), inputSnapshot: z.string(),
  projectDescriptionSnapshot: z.string().nullable(), taskContentTypeId: z.string().nullable(), taskTemplateId: z.string().nullable(), resourceSnapshot: taskResourceSnapshotSchema.nullable(), permissionProfile: taskPermissionProfileSchema, outputTarget: z.string().nullable(),
  resultSummary: z.string().nullable(), errorCode: z.string().nullable(), errorMessage: z.string().nullable(), retryOfId: z.string().nullable(),
  requiresConfirmation: z.boolean(), requestedAt: z.string(), startedAt: z.string().nullable(), finishedAt: z.string().nullable()
})
const draftAlignmentSplitStartResultSchema = z.object({
  workspace: draftComparisonWorkspaceSchema,
  task: taskRunSchema.nullable()
}).strict()
const providerCapabilitySchema = z.object({ provider: z.enum(PROVIDER_KINDS), available: z.boolean(), status: z.enum(PROVIDER_CAPABILITY_STATUSES), displayName: z.string(), executablePath: z.string().nullable(), detail: z.string() })
const externalProviderConfigSchema = z.object({
  id: z.string().uuid(), kind: z.enum(EXTERNAL_PROVIDER_KINDS), displayName: z.string(), baseUrl: z.string(), model: z.string(),
  hasApiKey: z.boolean(), status: z.enum(['unverified', 'available', 'failed']), lastValidatedAt: z.string().nullable(),
  lastError: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
})
const providerSettingsSchema = z.object({
  securityAvailable: z.boolean(), configs: z.array(externalProviderConfigSchema),
  defaultProviderConfigId: z.string(), fallbackProviderConfigId: z.string().nullable()
})
const externalFileRelationSchema = z.object({ id: z.string(), projectId: z.string(), displayName: z.string(), lastVersionId: z.string(), status: z.enum(['active', 'missing', 'paused']), lastSyncedAt: z.string() })
const mobileSyncDeviceSchema = z.object({
  id: z.string(), name: z.string(), protocolVersion: z.union([z.literal(1), z.literal(2)]), trustState: z.enum(['legacy_v1', 'trusted_v2']),
  createdAt: z.string(), lastSeenAt: z.string().nullable(), revokedAt: z.string().nullable(), upgradedAt: z.string().nullable()
})
const mobileSyncPendingPairingSchema = z.object({
  sessionId: z.string().uuid(), deviceName: z.string(), shortAuthenticationString: z.string().regex(/^\d{6}$/),
  requestedAt: z.string(), expiresAt: z.string(), upgradeDeviceId: z.string().uuid().nullable()
})
export const mobileSyncStatusSchema = z.object({
  enabled: z.boolean(), running: z.boolean(), securityAvailable: z.boolean(), port: z.number().int().min(1).max(65535).nullable(),
  serviceName: z.string().nullable(), serviceId: z.string(), advertised: z.boolean(), protocolVersion: z.literal(2),
  addresses: z.array(z.string()), error: z.string().nullable(), pendingPairings: z.array(mobileSyncPendingPairingSchema), devices: z.array(mobileSyncDeviceSchema)
})
const workspaceTabSchema = z.object({
  id: z.string().min(1).max(128), history: z.array(z.string().startsWith('#/').max(2048)).min(1).max(40),
  historyIndex: z.number().int().min(0).max(39), lastUsedAt: z.string().max(64)
}).refine((tab) => tab.historyIndex < tab.history.length, '工作区标签历史位置无效')
const sidebarNavigationItemIdSchema = z.enum(SIDEBAR_NAVIGATION_ITEM_IDS)
const requiredSidebarGroups = new Map([
  ['workspace', '工作区'],
  ['creation', '创作'],
  ['income', '收入台账'],
  ['more', '更多']
])
const sidebarNavigationGroupSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(40),
  itemIds: z.array(sidebarNavigationItemIdSchema).max(SIDEBAR_NAVIGATION_ITEM_IDS.length),
  expanded: z.boolean(),
  isCustom: z.boolean()
}).strict()
const sidebarLayoutSchema = z.object({
  version: z.literal(1),
  groups: z.array(sidebarNavigationGroupSchema).min(4).max(12),
  hiddenItemIds: z.array(sidebarNavigationItemIdSchema).max(SIDEBAR_NAVIGATION_ITEM_IDS.length)
}).strict().superRefine((layout, context) => {
  const groupIds = layout.groups.map((group) => group.id)
  if (new Set(groupIds).size !== groupIds.length) context.addIssue({ code: 'custom', message: '侧栏分组不能重复', path: ['groups'] })
  layout.groups.forEach((group, index) => {
    const systemName = requiredSidebarGroups.get(group.id)
    if (systemName && (group.isCustom || group.name !== systemName)) {
      context.addIssue({ code: 'custom', message: '默认侧栏分组不能改为自定义分组或改名', path: ['groups', index] })
    }
    if (!systemName && !group.isCustom) {
      context.addIssue({ code: 'custom', message: '非默认侧栏分组必须标记为自定义分组', path: ['groups', index] })
    }
  })
  requiredSidebarGroups.forEach((_name, groupId) => {
    if (!groupIds.includes(groupId)) context.addIssue({ code: 'custom', message: `缺少默认侧栏分组${groupId}`, path: ['groups'] })
  })
  const incomeItems = layout.groups.find((group) => group.id === 'income')?.itemIds
  if (!incomeItems || incomeItems.length !== 2 || incomeItems[0] !== 'business' || incomeItems[1] !== 'other-income') {
    context.addIssue({ code: 'custom', message: '收入台账必须固定包含商单收入和其他收入', path: ['groups'] })
  }
  const itemIds = layout.groups.flatMap((group) => group.itemIds)
  if (new Set(itemIds).size !== itemIds.length || itemIds.length !== SIDEBAR_NAVIGATION_ITEM_IDS.length) {
    context.addIssue({ code: 'custom', message: '每个侧栏入口必须且只能出现一次', path: ['groups'] })
  }
  if (layout.hiddenItemIds.includes('home')) context.addIssue({ code: 'custom', message: '首页不能隐藏', path: ['hiddenItemIds'] })
  if (layout.hiddenItemIds.includes('business') || layout.hiddenItemIds.includes('other-income')) context.addIssue({ code: 'custom', message: '收入台账子入口不能隐藏', path: ['hiddenItemIds'] })
  if (new Set(layout.hiddenItemIds).size !== layout.hiddenItemIds.length) context.addIssue({ code: 'custom', message: '隐藏入口不能重复', path: ['hiddenItemIds'] })
})
const lastProjectModuleByIdSchema = z.record(z.string().min(1).max(128), z.enum(MODULE_KEYS))
  .refine((value) => Object.keys(value).length <= 500, '最多记忆500个项目位置')
const projectStageShortcutSchema = z.object({
  projectId: z.string().min(1).max(128),
  moduleKey: z.enum(MODULE_KEYS).refine((value) => value !== 'overview' && value !== 'business', '概览和金额不是项目阶段')
}).strict()
const projectStageShortcutsSchema = z.array(projectStageShortcutSchema).max(100)
  .refine((value) => new Set(value.map((item) => `${item.projectId}:${item.moduleKey}`)).size === value.length, '常用中的项目阶段不能重复')
const otherIncomeSourceTemplatesSchema = z.array(z.string().trim().min(1).max(160)).max(100)
const todoCategoryMemorySchema = z.object({
  title: z.string().trim().min(1).max(300),
  normalizedTitle: z.string().min(1).max(300),
  category: z.enum(TODO_CATEGORIES),
  projectId: z.string().min(1).max(128).nullable(),
  updatedAt: z.iso.datetime({ offset: true })
}).strict()
export const codexWritingModelOptionSchema = z.object({
  id: z.string().min(1).max(160),
  displayName: z.string().min(1).max(240),
  isDefault: z.boolean(),
  reasoningEfforts: z.array(z.string().min(1).max(40)).max(20)
}).strict()
export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark']), visualStyle: z.enum(['warm', 'feishu']), homeSplit: z.number().min(0).max(100),
  companionTodoView: z.enum(['all', 'time', 'category']).optional(),
  companionTodoOrder: z.array(z.string().uuid()).max(10000).optional(),
  homeTodoView: z.enum(['time', 'category']), lastProjectModuleById: lastProjectModuleByIdSchema,
  workbenchLayout: z.enum(['equal', 'models', 'merged']),
  workbenchModelSplit: z.number().min(20).max(80), workbenchMergedSplit: z.number().min(35).max(85), workbenchMergedVisible: z.boolean(),
  workbenchView: z.enum(['single', 'dual', 'comparison']), workbenchSingleProvider: z.enum(['codex', 'claude']),
  workbenchDualActiveProvider: z.enum(['codex', 'claude']), workbenchConversationTab: z.enum(['claude', 'codex', 'current']), workbenchHiddenProviders: z.array(z.enum(['claude', 'codex'])).max(2),
  workbenchConversationScrollTops: z.object({ claude: z.number().int().nonnegative().max(10_000_000), codex: z.number().int().nonnegative().max(10_000_000), current: z.number().int().nonnegative().max(10_000_000) }).strict(), workbenchComparisonSide: z.enum(['claude', 'codex']),
  workbenchComparisonSplit: z.number().min(30).max(70), workbenchComparisonPreviewSplit: z.number().min(20).max(45),
  workbenchComparisonScrollTop: z.number().int().nonnegative().max(10_000_000),
  workbenchComparisonColorMode: z.enum(['all', 'left', 'none']),
  workbenchComparisonDocumentMode: z.enum(['groups', 'clean']),
  workbenchComparisonUseOutline: z.boolean(),
  workbenchComparisonSplitScope: z.enum(['current', 'matched']),
  workbenchDraftCurrentScrollTop: z.number().int().nonnegative().max(10_000_000),
  workbenchPrimaryView: z.enum(['conversation', 'comparison', 'versions']),
  workbenchComparisonKind: z.enum(['drafts', 'materials']),
  workbenchDraftSurface: z.enum(['organize', 'current']),
  workbenchVersionSurface: z.enum(['compare', 'current']),
  workbenchVersionMobileSide: z.enum(['left', 'right']),
  workbenchVersionSourcePanelOpen: z.boolean(),
  workbenchVersionDiffVisible: z.boolean(),
  workbenchVersionScrollTops: z.object({ left: z.number().int().nonnegative().max(10_000_000), right: z.number().int().nonnegative().max(10_000_000) }).strict(),
  workbenchVersionCurrentScrollTop: z.number().int().nonnegative().max(10_000_000),
  workbenchMaterialTab: z.enum(['source', 'ai', 'current']),
  workbenchMaterialScrollTops: z.object({ source: z.number().int().nonnegative().max(10_000_000), ai: z.number().int().nonnegative().max(10_000_000), current: z.number().int().nonnegative().max(10_000_000) }).strict(),
  workbenchCodexModel: z.string().min(1).max(160).nullable(),
  sidebarCollapsed: z.boolean(), sidebarWidth: z.number().int().min(184).max(340), sidebarPinnedExpanded: z.boolean(), sidebarStageShortcutsExpanded: z.boolean(),
  sidebarLayout: sidebarLayoutSchema,
  pinnedProjectOrder: z.array(z.string().min(1).max(128)).max(100),
  pinnedProjectStages: projectStageShortcutsSchema,
  inspectorWidth: z.number().min(220).max(520),
  scheduleUnscheduledWidth: z.number().min(132).max(320),
  scheduleUnscheduledCollapsed: z.boolean(),
  scheduleInspectorCollapsed: z.boolean(),
  workspaceTabs: z.array(workspaceTabSchema).min(1).max(8), activeWorkspaceTabId: z.string().min(1).max(128),
  defaultPlatforms: z.array(z.string().min(1).max(20)).max(20), businessPlatforms: z.array(z.string().trim().min(1).max(40)).max(50), otherIncomeSourceTemplates: otherIncomeSourceTemplatesSchema, defaultContentTypeId: z.string().nullable(), autoClassifyNewProject: z.boolean(),
  computerUsePublishBilibili: z.boolean(),
  weatherCity: z.string().trim().max(80),
  weatherPreviewCondition: z.enum(WEATHER_CONDITIONS).nullable(),
  weatherPreviewPeriod: z.enum(WEATHER_PERIODS).nullable(),
  todoCategoryColors: z.object({
    self_media: z.enum(PROJECT_COLOR_TOKENS),
    life: z.enum(PROJECT_COLOR_TOKENS),
    ai: z.enum(PROJECT_COLOR_TOKENS),
    other_work: z.enum(PROJECT_COLOR_TOKENS)
  }).strict(),
  todoCategoryLabels: z.object({
    self_media: z.string().trim().min(1).max(16),
    life: z.string().trim().min(1).max(16),
    ai: z.string().trim().min(1).max(16),
    other_work: z.string().trim().min(1).max(16)
  }).strict(),
  todoCategoryWeights: z.object({
    self_media: z.number().int().min(0).max(100),
    life: z.number().int().min(0).max(100),
    ai: z.number().int().min(0).max(100),
    other_work: z.number().int().min(0).max(100)
  }).strict(),
  todoStageMemories: z.array(z.object({ title: z.string().min(1).max(300), action: z.string().min(1).max(300), projectId: z.string().min(1).max(128), stageKey: stageTimeKeySchema.nullable(), updatedAt: z.iso.datetime({ offset: true }) }).strict()).max(200).optional(),
  todoCategoryMemories: z.array(todoCategoryMemorySchema).max(200)
})
export const workspaceSnapshotSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contentTypes: z.array(contentTypeSchema), generalRecordCategories: z.array(generalRecordCategorySchema), projectTemplates: z.array(projectTemplateSchema), resources: z.array(resourceSchema), projects: z.array(projectSummarySchema), businessLedger: z.array(businessLedgerEntrySchema),
  otherIncomeCategories: z.array(otherIncomeCategorySchema), otherIncomeRecords: z.array(otherIncomeRecordSchema), otherIncomeImportRules: z.array(otherIncomeImportRuleSchema),
  otherIncomeCompanyAliases: z.array(otherIncomeCompanyAliasSchema), incomeLedgerSummary: incomeLedgerSummarySchema, captures: z.array(captureSchema),
  captureSummary: z.object({ creativeDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), newRecords: z.number().int().nonnegative(), pendingReview: z.number().int().nonnegative(), todayAutoProcessed: z.number().int().nonnegative() }),
  topics: z.array(topicSchema), topicStages: z.array(topicStageDefinitionSchema), topicColumns: z.array(topicColumnDefinitionSchema),
  discardedFilterCandidates: z.array(conversationFilterCandidateSchema),
  schedules: z.array(scheduleItemSchema),
  todoDays: z.array(todoDaySchema).optional(),
  todos: z.array(todoItemSchema).max(50_000),
  dailyWorkLog: dailyWorkLogSchema,
  productionChecklist: z.array(z.object({
    projectId: projectIdSchema,
    id: z.string().uuid(),
    text: z.string().max(500),
    completed: z.boolean(),
    scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    scheduleSegment: z.enum(STAGE_TIME_SEGMENTS).nullable()
  }).strict()).max(30_000),
  tasks: z.array(taskRunSchema), providerCapabilities: z.array(providerCapabilitySchema), preferences: preferencesSchema
})
export const globalSearchPayloadSchema = z.object({
  query: z.string().max(120),
  limit: z.number().int().min(1).max(80).optional()
}).strict()
export const globalSearchResultSchema = z.object({
  kind: z.enum(GLOBAL_SEARCH_KINDS),
  id: z.string().min(1).max(128),
  title: z.string().max(240),
  subtitle: z.string().max(500),
  preview: z.string().max(20_000),
  updatedAt: z.string().max(64),
  projectId: z.string().min(1).max(128).nullable(),
  score: z.number().finite()
})

export const openCapturePayloadSchema = z.object({
  projectId: nullableProjectIdSchema.optional(),
  captureKind: z.enum(['project_content', 'client_feedback']).nullable().optional()
}).strict()
export const mobileSyncSetEnabledPayloadSchema = z.object({ enabled: z.boolean() }).strict()
export const mobileSyncPairingDecisionPayloadSchema = z.object({ sessionId: z.string().uuid() }).strict()
export const mobileSyncDeviceRevokePayloadSchema = z.object({ deviceId: z.string().uuid() }).strict()
export const projectGetPayloadSchema = z.object({ projectId: projectIdSchema, touch: z.boolean().optional() }).strict()
export const projectTrashPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const projectSetPinnedPayloadSchema = z.object({ projectId: projectIdSchema, pinned: z.boolean(), requestId: requestIdSchema }).strict()
export const projectSetColorPayloadSchema = z.object({ projectId: projectIdSchema, colorToken: z.enum(PROJECT_COLOR_TOKENS) }).strict()
export const projectSetLifecyclePayloadSchema = z.object({ projectId: projectIdSchema, lifecycle: z.enum(['completed', 'archived', 'project_created']) }).strict()
export const projectRenamePayloadSchema = z.object({ projectId: projectIdSchema, title: z.string().trim().min(1, '项目名称不能为空').max(80, '项目名称最多80个字符') }).strict()
export const projectClassifyDraftPayloadSchema = z.object({ title: z.string().max(80), description: z.string().max(500) }).strict()
export const projectDraftClassificationSchema = z.object({ contentTypeId: z.string().nullable(), templateId: z.string().nullable(), confidence: z.number(), reason: z.string() })
export const projectCreatePayloadSchema = z.object({
  videoFormat: z.enum(VIDEO_FORMATS).nullable().optional(), isCommercial: z.boolean().optional(),
  title: z.string().trim().min(1).max(160), description: z.string().max(12000), contentTypeId: z.string().min(1), colorToken: z.enum(PROJECT_COLOR_TOKENS).optional(),
  templateId: z.string().min(1).max(128).nullable().optional(), platformTargets: z.array(z.string().min(1).max(40)).max(20),
  aiSuggestedContentTypeId: z.string().min(1).max(128).nullable().optional()
}).strict()
export const projectUpdateClassificationPayloadSchema = z.object({ projectId: projectIdSchema, patch: z.object({ videoFormat: z.enum(VIDEO_FORMATS).nullable().optional(), isCommercial: z.boolean().optional() }).strict().refine(patch => Object.keys(patch).length > 0, '请选择要修改的属性') }).strict()
export const projectUpdateContentTypePayloadSchema = z.object({ projectId: projectIdSchema, contentTypeId: z.string().min(1).max(128) }).strict()
export const projectUpdatePlatformsPayloadSchema = z.object({
  projectId: projectIdSchema,
  platformTargets: z.array(z.enum(PROJECT_PLATFORMS)).max(PROJECT_PLATFORMS.length)
}).strict()
export const projectTemplateSavePayloadSchema = z.object({
  id: z.string().min(1).max(128).optional(), name: z.string().trim().min(1).max(80), description: z.string().max(2000),
  moduleKeys: z.array(z.enum(OPTIONAL_MODULE_KEYS)).max(20), recommendedContentTypeIds: z.array(z.string().min(1).max(128)).max(100),
  recommendedVideoFormats: z.array(z.enum(VIDEO_FORMATS)).max(2), recommendedProjectKinds: z.array(z.enum(PROJECT_KINDS)).max(2), isActive: z.boolean()
}).strict()
export const projectTemplatePayloadSchema = z.object({ projectId: projectIdSchema, templateId: z.string().min(1).max(128).nullable() }).strict()
export const projectSetModulePayloadSchema = z.object({
  projectId: projectIdSchema, moduleKey: z.enum(OPTIONAL_MODULE_KEYS), enabled: z.boolean()
}).strict()
export const projectReorderModulesPayloadSchema = z.object({
  projectId: projectIdSchema,
  moduleKeys: z.array(z.enum(OPTIONAL_MODULE_KEYS)).min(6).max(7)
    .refine((keys) => new Set(keys).size === keys.length, '项目模块顺序不能重复')
}).strict()
export const projectSetModuleCompletedPayloadSchema = z.object({
  projectId: projectIdSchema, moduleKey: z.enum(['overview', 'materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'feedback', 'versions']), completed: z.boolean(), requestId: requestIdSchema
}).strict()
const stagePlanEditSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('start'), point: stageTimePointSchema.nullable() }).strict(),
  z.object({ field: z.literal('duration'), durationHalfDayUnits: z.number().int().min(1).max(200).nullable() }).strict(),
  z.object({ field: z.literal('end'), point: stageTimePointSchema.nullable() }).strict()
])
export const projectStageTimeUpdatePayloadSchema = z.object({
  projectId: projectIdSchema, stageKey: stageTimeKeySchema, startedAt: stageTimePointSchema.nullable().optional(), completedAt: stageTimePointSchema.nullable().optional(),
  actualEffortHalfDayUnits: z.number().int().min(1).max(200).nullable().optional(),
  planEdit: stagePlanEditSchema.optional(),
  startNow: z.literal(true).optional(),
  source: z.enum(['manual', 'backfill']), requestId: requestIdSchema
}).strict().refine((input) => input.startNow || input.startedAt !== undefined || input.completedAt !== undefined || input.actualEffortHalfDayUnits !== undefined || input.planEdit !== undefined, '阶段时间修改不能为空')
  .refine(input => !input.startNow || (input.source === 'manual' && input.startedAt === undefined && input.completedAt === undefined && input.actualEffortHalfDayUnits === undefined && input.planEdit === undefined), '现在开始不能同时修改其他阶段字段')
export const projectStageTimeSetStatusPayloadSchema = z.object({ projectId: projectIdSchema, stageKey: stageTimeKeySchema, action: z.enum(['skip', 'reopen']) }).strict()
export const projectStageTimeUndoPayloadSchema = z.object({ projectId: projectIdSchema, eventId: z.string().min(1).max(128) }).strict()
export const workspaceUndoPayloadSchema = z.object({ operationId: z.string().uuid().nullable().optional() }).strict()
export const creationReportGetPayloadSchema = z.object({ kind: z.enum(CREATION_REPORT_KINDS), anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), force: z.boolean().optional() }).strict()
export const creationReportSnapshotListPayloadSchema = z.object({
  kind: z.enum(CREATION_REPORT_KINDS).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).strict()
export const creationReportSnapshotGetByIdPayloadSchema = z.object({ snapshotId: z.string().min(1).max(128) }).strict()
export const projectCreationReviewGetPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const creationReportConversationGetPayloadSchema = z.object({ snapshotId: z.string().min(1).max(128) }).strict()
export const creationReportMessageSendPayloadSchema = z.object({
  snapshotId: z.string().min(1).max(128), provider: z.enum(['codex_cli', 'claude_cli']), message: z.string().trim().min(1).max(4_000)
}).strict()
export const scriptRevisionConversationGetPayloadSchema = z.object({
  projectId: projectIdSchema,
  threadId: z.string().min(1).max(128).nullable().optional(),
  provider: z.enum(['codex_cli', 'claude_cli']).nullable().optional(),
  surface: z.enum(['conversation', 'version_compare']).default('conversation')
}).strict()
export const scriptRevisionMessageSendPayloadSchema = z.object({
  projectId: projectIdSchema,
  threadId: z.string().min(1).max(128).nullable().optional(),
  surface: z.enum(['conversation', 'version_compare']).default('conversation'),
  baseVersionId: z.string().min(1).max(128).nullable().optional(),
  currentDocumentContent: z.string().max(1_000_000),
  includeProjectContext: z.boolean().default(false),
  provider: z.enum(['codex_cli', 'claude_cli']),
  preferredModel: z.string().trim().min(1).max(128).nullable().optional(),
  preferredReasoningEffort: z.string().trim().min(1).max(64).nullable().optional(),
  sourceSelections: z.array(contentSourceSelectionSnapshotSchema).max(100).optional(),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']).default('automatic'),
  message: z.string().trim().min(1).max(30_000),
  selection: z.object({
    targetSelectionId: z.string().min(1).max(128).nullable().optional(),
    selectedText: z.string().max(80_000).nullable(), contextBefore: z.string().max(2_000), contextAfter: z.string().max(2_000),
    occurrenceIndex: z.number().int().nonnegative().nullable(), from: z.number().int().nonnegative().nullable(), to: z.number().int().nonnegative().nullable(),
    applicationTarget: z.object({
      surface: z.literal('version_compare'), side: z.enum(['left', 'right']), sourceId: z.string().min(1).max(128),
      contentHash: z.string().min(1).max(128), content: z.string().max(1_000_000),
      range: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), selectedText: z.string().max(80_000) }).strict().nullable(),
      inheritedConflicts: z.array(contentSelectionConflictSchema).max(100).optional()
    }).strict().nullable().optional()
  }).strict()
}).strict()
export const scriptRevisionApplyValidatePayloadSchema = z.object({ projectId: projectIdSchema, messageId: z.string().min(1).max(128), currentText: z.string().max(1_000_000) }).strict()
export const scriptRevisionSuggestionStatusSetPayloadSchema = z.object({
  projectId: projectIdSchema, messageId: z.string().min(1).max(128), status: z.enum(['pending', 'applied', 'copied', 'discarded'])
}).strict()
export const scriptMaterialGetPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const scriptMaterialWorkspaceSavePayloadSchema = z.object({
  projectId: projectIdSchema,
  workingContent: z.string().max(1_000_000).optional(),
  requirement: z.string().max(30_000).optional(),
  aiCount: z.union([z.literal(1), z.literal(2)]).optional(),
  selectedAiSide: z.enum(['codex', 'claude']).optional(),
  selectedCodexDraftId: z.string().min(1).max(128).nullable().optional(),
  selectedClaudeDraftId: z.string().min(1).max(128).nullable().optional(),
  webSearchMode: z.enum(['automatic', 'required', 'disabled']).optional()
}).strict().refine((input) => (
  input.workingContent !== undefined
  || input.requirement !== undefined
  || input.aiCount !== undefined
  || input.selectedAiSide !== undefined
  || input.selectedCodexDraftId !== undefined
  || input.selectedClaudeDraftId !== undefined
  || input.webSearchMode !== undefined
), '保存内容不能为空')
export const scriptMaterialRevisionCreatePayloadSchema = z.object({ projectId: projectIdSchema }).strict()
const scriptMaterialPointInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  sourceStart: z.number().int().min(0).max(1_000_000),
  sourceEnd: z.number().int().min(0).max(1_000_000),
  sourceText: z.string().max(80_000),
  summary: z.string().max(4_000),
  requirement: z.string().max(4_000).optional(),
  adoption: z.enum(['required', 'excluded']).optional()
}).strict().refine((point) => point.sourceEnd >= point.sourceStart, '素材要点结束位置不能早于开始位置')
export const scriptMaterialPointsReplacePayloadSchema = z.object({
  projectId: projectIdSchema, revisionId: z.string().min(1).max(128),
  points: z.array(scriptMaterialPointInputSchema).max(2_000)
}).strict()
export const scriptMaterialPointsConfirmPayloadSchema = z.object({
  projectId: projectIdSchema, revisionId: z.string().min(1).max(128)
}).strict()
export const scriptMaterialPointUpdatePayloadSchema = z.object({
  projectId: projectIdSchema, revisionId: z.string().min(1).max(128), pointId: z.string().min(1).max(128),
  summary: z.string().max(4_000).optional(), requirement: z.string().max(4_000).optional(),
  adoption: z.enum(['required', 'excluded']).optional()
}).strict().refine((input) => (
  input.summary !== undefined || input.requirement !== undefined || input.adoption !== undefined
), '更新内容不能为空')
export const scriptMaterialAnnotationConfirmPayloadSchema = z.object({
  projectId: projectIdSchema,
  draftId: z.string().min(1).max(128),
  paragraphId: z.string().min(1).max(128),
  annotationIds: z.array(z.string().min(1).max(128)).min(1).max(100)
}).strict()
export const scriptMaterialManualMarksSetPayloadSchema = z.object({
  projectId: projectIdSchema,
  draftId: z.string().min(1).max(128),
  paragraphId: z.string().min(1).max(128),
  marks: z.array(z.object({
    id: z.string().min(1).max(128),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(30_000),
    style: z.enum(['highlight', 'underline', 'strike'])
  }).strict()).max(500)
}).strict()
export const scriptMaterialExtractStartPayloadSchema = z.object({
  projectId: projectIdSchema, providerConfigId: z.string().min(1).max(128),
  includeProjectContext: z.boolean().default(false)
}).strict()
export const scriptMaterialGenerateStartPayloadSchema = z.object({
  projectId: projectIdSchema, side: z.enum(['codex', 'claude']),
  providerConfigId: z.string().min(1).max(128), includeProjectContext: z.boolean().default(false)
}).strict()
export const scriptMaterialAuditStartPayloadSchema = z.object({
  projectId: projectIdSchema, target: z.enum(['codex', 'claude', 'current']),
  draftId: z.string().min(1).max(128).optional(),
  currentContent: z.string().max(1_000_000).optional(),
  currentParagraphs: z.array(z.object({
    id: z.string().min(1).max(128), position: z.number().int().nonnegative(), text: z.string().min(1).max(80_000)
  }).strict()).max(2_000).optional(),
  providerConfigId: z.string().min(1).max(128)
}).strict()
  .refine((input) => input.target !== 'current' || Boolean(input.currentContent?.trim()), '当前文案不能为空')
  .refine((input) => input.target === 'current' || Boolean(input.draftId), '检查AI稿时必须指定稿次')
export const scriptMaterialAllowedOmissionsSetPayloadSchema = z.object({
  projectId: projectIdSchema,
  targetIdentity: z.string().min(1).max(128),
  pointIds: z.array(z.string().min(1).max(128)).max(500)
}).strict()
export const scriptMaterialFindingConfirmPayloadSchema = z.object({
  projectId: projectIdSchema,
  targetIdentity: z.string().min(1).max(128),
  findingId: z.string().min(1).max(128),
  resolutionNote: z.string().trim().min(1).max(4_000)
}).strict()
export const scriptMaterialFinalizationGateGetPayloadSchema = z.object({
  projectId: projectIdSchema,
  currentContent: z.string().max(1_000_000)
}).strict()
export const scriptMaterialVersionSnapshotGetPayloadSchema = z.object({
  projectId: projectIdSchema,
  versionId: z.string().min(1).max(128)
}).strict()
export const scriptMaterialChatStartPayloadSchema = z.object({
  projectId: projectIdSchema, side: z.enum(['codex', 'claude']),
  message: z.string().max(30_000).default(''),
  providerConfigId: z.string().min(1).max(128),
  includeProjectContext: z.boolean().default(false),
  preferredModel: z.string().min(1).max(160).nullable().default(null),
  preferredReasoningEffort: z.string().min(1).max(64).nullable().default(null),
  currentDocumentParagraphs: z.array(z.object({
    id: z.string().min(1).max(128),
    position: z.number().int().nonnegative(),
    text: z.string().min(1).max(80_000)
  }).strict()).max(2_000).default([])
}).strict()
export const scriptMaterialChatBatchStartPayloadSchema = z.object({
  projectId: projectIdSchema,
  message: z.string().max(30_000).default(''),
  includeProjectContext: z.boolean().default(false),
  requests: z.array(z.object({
    side: z.enum(['codex', 'claude']),
    providerConfigId: z.string().min(1).max(128),
    preferredModel: z.string().min(1).max(160).nullable().default(null)
  }).strict()).min(1).max(2),
  currentDocumentParagraphs: z.array(z.object({
    id: z.string().min(1).max(128),
    position: z.number().int().nonnegative(),
    text: z.string().min(1).max(80_000)
  }).strict()).max(2_000).default([])
}).strict().superRefine((input, context) => {
  if (new Set(input.requests.map((request) => request.side)).size !== input.requests.length) {
    context.addIssue({ code: 'custom', path: ['requests'], message: '同一AI侧不能重复启动' })
  }
})
export const scriptMaterialRewriteStartPayloadSchema = z.object({
  projectId: projectIdSchema,
  draftId: z.string().min(1).max(128),
  parentCandidateId: z.string().min(1).max(128).nullable().default(null),
  applicationTarget: z.object({
    targetId: z.string().min(1).max(256), selectedText: z.string().max(80_000), contentHash: z.string().min(1).max(128),
    from: z.number().int().nonnegative(), to: z.number().int().nonnegative()
  }).strict().nullable().default(null),
  paragraphIds: z.array(z.string().min(1).max(128)).min(1).max(2_000),
  selectedParagraphId: z.string().min(1).max(128).nullable().default(null),
  selectedText: z.string().max(30_000).default(''),
  selectedStart: z.number().int().nonnegative().nullable().default(null),
  selectedEnd: z.number().int().positive().nullable().default(null),
  requirement: z.string().trim().min(1).max(30_000),
  providerConfigId: z.string().min(1).max(128),
  includeProjectContext: z.boolean().default(false),
  preferredModel: z.string().min(1).max(160).nullable().default(null),
  preferredReasoningEffort: z.string().min(1).max(64).nullable().default(null)
}).strict()
export const scriptMaterialMapStartPayloadSchema = z.object({
  projectId: projectIdSchema,
  draftId: z.string().min(1).max(128),
  providerConfigId: z.string().min(1).max(128),
  currentDocumentParagraphs: z.array(z.object({
    id: z.string().min(1).max(128),
    position: z.number().int().nonnegative(),
    text: z.string().min(1).max(80_000)
  }).strict()).max(2_000).default([])
}).strict()
export const draftComparisonGetPayloadSchema = z.object({
  projectId: projectIdSchema, sessionId: z.string().min(1).max(128).nullable().optional()
}).strict()
export const draftComparisonDraftsSavePayloadSchema = z.object({
  projectId: projectIdSchema,
  claudeContent: z.string().max(1_000_000).optional(),
  codexContent: z.string().max(1_000_000).optional()
}).strict().refine((input) => input.claudeContent !== undefined || input.codexContent !== undefined, '保存内容不能为空')
export const draftComparisonCurrentDocumentBaseSetPayloadSchema = z.object({
  projectId: projectIdSchema,
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/)
}).strict()
export const draftAlignmentStartPayloadSchema = z.object({
  projectId: projectIdSchema, providerConfigId: z.string().min(1).max(128), includeProjectContext: z.boolean().default(false),
  useOutline: z.boolean().default(true), confirmFull: z.boolean().default(false)
}).strict()
export const draftSourceGeneratePayloadSchema = z.object({
  projectId: projectIdSchema, side: z.enum(['claude', 'codex']), requirement: z.string().trim().min(1).max(30_000),
  providerConfigId: z.string().min(1).max(128), includeProjectContext: z.boolean().default(false)
}).strict()
export const draftCandidateGeneratePayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128), parentCandidateId: z.string().min(1).max(128).nullable().optional(),
  requirement: z.string().trim().max(30_000).default(''),
  quickIntent: z.enum(['regenerate', 'polish', 'concise', 'humorous', 'expand', 'conversational']).nullable().optional(),
  targetKind: z.enum(['group', 'claude', 'codex', 'candidate', 'current']).optional(),
  targetSourceId: z.string().min(1).max(128).nullable().optional(),
  sourceKind: z.enum(['claude', 'codex', 'candidate', 'current']).optional(),
  sourceId: z.string().min(1).max(128).nullable().optional(),
  selectedText: z.string().max(80_000).nullable().optional(),
  selectionStart: z.number().int().min(0).max(1_000_000).optional(),
  selectionEnd: z.number().int().min(0).max(1_000_000).optional(),
  sourceSelections: z.array(z.object({
    sourceKind: z.enum(['claude', 'codex', 'candidate', 'current']),
    sourceId: z.string().min(1).max(128).nullable().optional(),
    selectedText: z.string().min(1).max(80_000),
    selectionStart: z.number().int().min(0).max(1_000_000),
    selectionEnd: z.number().int().min(1).max(1_000_000)
  }).strict()).min(2).max(20).optional(),
  providerConfigId: z.string().min(1).max(128),
  preferredModel: z.string().min(1).max(160).nullable().default(null),
  preferredReasoningEffort: z.string().min(1).max(64).nullable().default(null),
  includeProjectContext: z.boolean().default(false)
}).strict().refine((input) => Boolean(input.requirement || input.quickIntent), '请选择快捷改写方式或输入具体要求')

export const contentInstructionDispatchPayloadSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('script_revision'),
    instruction: contentInstructionRequestPreparePayloadSchema,
    requests: z.array(scriptRevisionMessageSendPayloadSchema).min(1).max(2)
  }).strict(),
  z.object({
    operation: z.literal('script_material_chat'),
    instruction: contentInstructionRequestPreparePayloadSchema,
    request: scriptMaterialChatBatchStartPayloadSchema
  }).strict(),
  z.object({
    operation: z.literal('script_material_rewrite'),
    instruction: contentInstructionRequestPreparePayloadSchema,
    request: scriptMaterialRewriteStartPayloadSchema
  }).strict(),
  z.object({
    operation: z.literal('draft_candidate'),
    instruction: contentInstructionRequestPreparePayloadSchema,
    request: draftCandidateGeneratePayloadSchema
  }).strict()
]).superRefine((value, context) => {
  const count = value.operation === 'script_revision'
    ? value.requests.length
    : value.operation === 'script_material_chat'
      ? value.request.requests.length
      : 1
  if (value.instruction.targets.length !== count || value.instruction.aiCount !== count) {
    context.addIssue({ code: 'custom', path: ['instruction', 'targets'], message: '结构化请求目标必须与实际AI任务一一对应' })
  }
  if (value.operation === 'script_revision' && value.requests.some((request) => request.projectId !== value.instruction.projectId)) {
    context.addIssue({ code: 'custom', path: ['requests'], message: '文案任务与结构化请求不属于同一项目' })
  }
  if (value.operation !== 'script_revision' && value.request.projectId !== value.instruction.projectId) {
    context.addIssue({ code: 'custom', path: ['request', 'projectId'], message: '文案任务与结构化请求不属于同一项目' })
  }
})

export type ContentInstructionDispatchPayload = z.output<typeof contentInstructionDispatchPayloadSchema>

export const contentInstructionDispatchResultSchema = z.object({
  request: contentInstructionRequestRecordSchema,
  tasks: z.array(taskRunSchema).min(1).max(2)
}).strict()
export const draftCandidateFreeformAddPayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128), content: z.string().trim().min(1).max(80_000),
  requirement: z.string().trim().max(30_000).optional()
}).strict()
export const draftCandidateDeletePayloadSchema = z.object({
  projectId: projectIdSchema, candidateId: z.string().min(1).max(128)
}).strict()
export const draftCandidateMovePayloadSchema = z.object({
  projectId: projectIdSchema, candidateId: z.string().min(1).max(128), toGroupId: z.string().min(1).max(128)
}).strict()
export const draftCandidateReorderPayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128),
  candidateIds: z.array(z.string().min(1).max(128)).max(100)
}).strict()
export const draftDecisionSetPayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128),
  kind: z.enum(['claude', 'codex', 'candidate', 'freeform', 'combination', 'omit', 'unresolved']),
  sourceId: z.string().min(1).max(128).nullable().optional(), sourceIds: z.array(z.string().min(1).max(128)).max(102).optional(),
  content: z.string().max(80_000).optional()
}).strict()
export const draftDecisionNoteSetPayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128), note: z.string().max(2_000)
}).strict()
export const draftTextMarkerSchema = z.object({
  id: z.string().min(1).max(128), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  text: z.string().max(20_000), note: z.string().max(2_000), status: z.enum(['active', 'position_changed'])
}).strict().refine((marker) => marker.end >= marker.start, '标记结束位置不能早于开始位置')
export const draftDecisionMarkersSetPayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128), markers: z.array(draftTextMarkerSchema).max(200)
}).strict()
export const draftGroupMergePayloadSchema = z.object({
  projectId: projectIdSchema, groupIds: z.array(z.string().min(1).max(128)).min(2).max(2_000)
}).strict()
export const draftGroupSplitPayloadSchema = z.object({
  projectId: projectIdSchema, groupId: z.string().min(1).max(128),
  firstClaudeParagraphIds: z.array(z.string().min(1).max(128)).max(2_000),
  firstCodexParagraphIds: z.array(z.string().min(1).max(128)).max(2_000)
}).strict()
export const draftAlignmentSplitStartPayloadSchema = z.object({
  projectId: projectIdSchema,
  groupId: z.string().min(1).max(128),
  side: z.enum(['claude', 'codex']),
  paragraphIds: z.array(z.string().min(1).max(128)).min(1).max(2_000),
  strategy: z.enum(['original_order', 'extract_below']),
  scope: z.enum(['current', 'matched'])
}).strict()
export const draftGroupReorderPayloadSchema = z.object({
  projectId: projectIdSchema, groupIds: z.array(z.string().min(1).max(128)).min(1).max(2_000)
}).strict()
export const draftParagraphMovePayloadSchema = z.object({
  projectId: projectIdSchema, side: z.enum(['claude', 'codex']), paragraphId: z.string().min(1).max(128),
  fromGroupId: z.string().min(1).max(128), toGroupId: z.string().min(1).max(128),
  toIndex: z.number().int().nonnegative().max(2_000).optional()
}).strict()
export const draftParagraphsMovePayloadSchema = z.object({
  projectId: projectIdSchema,
  moves: z.array(draftParagraphMovePayloadSchema.omit({ projectId: true })).min(1).max(2_000)
}).strict()
export const draftComparisonHistoryListPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const draftComparisonHistoryRestorePayloadSchema = z.object({
  projectId: projectIdSchema,
  historyId: z.string().min(1).max(128)
}).strict()
export const updateDescriptionPayloadSchema = z.object({ projectId: projectIdSchema, description: z.string().max(12000) }).strict()
export const outlineItemSchema = z.object({ id: z.string().min(1).max(128), text: z.string().trim().min(1).max(4000) })
export const saveOutlinePayloadSchema = z.object({
  projectId: projectIdSchema, items: z.array(outlineItemSchema).min(1).max(200),
  parentVersionIds: z.array(z.string().min(1).max(128)).min(1).max(10).optional(),
  outlineId: z.string().min(1).max(128).optional(),
  outlineName: z.string().trim().min(1).max(120).optional()
}).strict().refine((value) => Boolean(value.outlineId) === Boolean(value.outlineName), '大纲标识与名称必须同时提供')
export const projectOutlineSelectionSetPayloadSchema = z.object({ projectId: projectIdSchema, versionId: z.string().min(1).max(128) }).strict()
export const outlineGenerationStartPayloadSchema = z.object({
  projectId: projectIdSchema, briefText: z.string().max(40_000), ideas: z.string().max(40_000),
  structure: z.object({ name: z.string().trim().min(1).max(200), items: z.array(z.string().trim().min(1).max(4000)).min(1).max(200) }).strict(),
  supportingMaterialIds: z.array(z.string().min(1).max(128)).max(500).default([])
}).strict()
const currentScriptHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const currentScriptStableIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/)
const currentScriptEditorDocumentSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  if (value.type !== 'doc') context.addIssue({ code: 'custom', message: '当前文案编辑器文档必须是doc', path: ['type'] })
  if (JSON.stringify(value).length > 1_000_000) context.addIssue({ code: 'custom', message: '当前文案不能超过1MB' })
})
const currentScriptBlockSchema = z.object({
  blockId: currentScriptStableIdSchema,
  kind: z.enum(CURRENT_SCRIPT_BLOCK_KINDS),
  parentBlockIds: z.array(currentScriptStableIdSchema).max(32),
  text: z.string().max(1_000_000)
}).strict()
const currentScriptSourceRelationInputSchema = z.object({
  id: currentScriptStableIdSchema,
  targetBlockId: currentScriptStableIdSchema,
  targetStart: z.number().int().nonnegative(),
  targetEnd: z.number().int().nonnegative(),
  sourceKind: z.enum(CURRENT_SCRIPT_SOURCE_KINDS),
  sourceId: z.string().trim().min(1).max(256),
  sourceVersion: z.string().trim().min(1).max(256)
}).strict().refine((value) => value.targetEnd >= value.targetStart, { message: '来源关系结束位置不能早于开始位置', path: ['targetEnd'] })
const scriptTextAnnotationInputSchema = z.object({
  id: currentScriptStableIdSchema,
  blockId: currentScriptStableIdSchema,
  blockStart: z.number().int().nonnegative(),
  blockEnd: z.number().int().nonnegative(),
  selectedText: z.string().max(1_000_000),
  style: z.enum(SCRIPT_TEXT_ANNOTATION_STYLES),
  note: z.string().max(2_000),
  evidenceIds: z.array(currentScriptStableIdSchema).max(20).optional().default([]),
  status: z.enum(SCRIPT_TEXT_ANNOTATION_STATUSES)
}).strict().refine((value) => value.blockEnd >= value.blockStart, { message: '标注结束位置不能早于开始位置', path: ['blockEnd'] })
const currentScriptDocumentSchema = z.object({
  projectId: projectIdSchema,
  workingDocumentId: currentScriptStableIdSchema,
  schemaVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  editorDocument: currentScriptEditorDocumentSchema,
  contentHash: currentScriptHashSchema,
  lastSavedVersionId: z.string().min(1).nullable(),
  updatedAt: z.string()
}).strict()
const currentScriptSourceRelationSchema = currentScriptSourceRelationInputSchema.extend({
  workingDocumentId: currentScriptStableIdSchema,
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
const scriptTextAnnotationSchema = scriptTextAnnotationInputSchema.extend({
  projectId: projectIdSchema,
  sourceKind: z.enum(['current_script', 'material_draft', 'comparison_source', 'comparison_candidate', 'draft_version']),
  sourceId: z.string().min(1),
  sourceVersion: z.string().min(1),
  coordinateSpace: z.literal('block_text'),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export const sourceScriptAnnotationsListPayloadSchema = z.object({
  projectId: projectIdSchema,
  sourceKind: z.enum(['material_draft', 'comparison_source', 'comparison_candidate', 'draft_version']).optional(),
  sourceId: z.string().min(1).max(256).optional(),
  sourceVersion: z.string().min(1).max(256).optional()
}).strict()
export const sourceScriptAnnotationUpsertPayloadSchema = scriptTextAnnotationInputSchema.extend({
  projectId: projectIdSchema,
  sourceKind: z.enum(['material_draft', 'comparison_source', 'comparison_candidate', 'draft_version']),
  sourceId: z.string().min(1).max(256),
  sourceVersion: z.string().min(1).max(256)
}).strict()
export const sourceScriptAnnotationDeletePayloadSchema = z.object({
  projectId: projectIdSchema,
  annotationId: currentScriptStableIdSchema
}).strict()
const projectCurrentScriptSnapshotSchema = z.object({
  document: currentScriptDocumentSchema,
  blocks: z.array(currentScriptBlockSchema).min(1).max(10_000),
  sourceRelations: z.array(currentScriptSourceRelationSchema).max(2_000),
  annotations: z.array(scriptTextAnnotationSchema).max(2_000)
}).strict()
const currentScriptInitializationCandidateSchema = z.object({
  versionId: z.string().min(1),
  displayName: z.string().nullable(),
  revision: z.number().int().positive(),
  kind: z.enum(['claude_candidate', 'codex_candidate', 'content_candidate', 'merged_draft', 'final', 'external_draft', 'user_edit']),
  isFinal: z.boolean(),
  createdAt: z.string(),
  sourceContent: z.string().max(1_000_000),
  sourceContentHash: currentScriptHashSchema,
  selectionReason: z.enum(['current_final', 'latest_saved_script', 'saved_version_requires_selection'])
}).strict()
const projectCurrentScriptLoadResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), snapshot: projectCurrentScriptSnapshotSchema }).strict(),
  z.object({
    status: z.literal('initialization_required'),
    candidates: z.array(currentScriptInitializationCandidateSchema).max(1_000),
    recommendedVersionId: z.string().min(1).nullable(),
    requiresSelection: z.boolean()
  }).strict()
])
export const projectCurrentScriptLoadPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const projectCurrentScriptInitializePayloadSchema = z.object({
  projectId: projectIdSchema,
  clientMutationId: z.string().uuid(),
  sourceVersionId: z.string().min(1).nullable(),
  expectedSourceContentHash: currentScriptHashSchema.nullable(),
  editorDocument: currentScriptEditorDocumentSchema,
  sourceRelations: z.array(currentScriptSourceRelationInputSchema).max(2_000),
  annotations: z.array(scriptTextAnnotationInputSchema).max(2_000),
  confirmedLegacyAnnotationIds: z.array(currentScriptStableIdSchema).max(2_000).optional(),
  confirmedLegacyRelationIds: z.array(currentScriptStableIdSchema).max(2_000).optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.sourceVersionId) !== Boolean(value.expectedSourceContentHash)) {
    context.addIssue({ code: 'custom', message: '初始化来源版本和哈希必须同时提供', path: ['sourceVersionId'] })
  }
})
export const projectCurrentScriptApplyPayloadSchema = z.object({
  projectId: projectIdSchema,
  workingDocumentId: currentScriptStableIdSchema,
  clientMutationId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  expectedContentHash: currentScriptHashSchema,
  editorDocument: currentScriptEditorDocumentSchema,
  sourceRelations: z.array(currentScriptSourceRelationInputSchema).max(2_000),
  annotations: z.array(scriptTextAnnotationInputSchema).max(2_000),
  recoveryConflictId: z.string().uuid().nullable().optional()
}).strict()
const currentScriptConflictResultSchema = z.object({
    status: z.literal('conflict'),
    code: z.literal('CURRENT_SCRIPT_CAS_CONFLICT'),
    reason: z.enum(['working_document_mismatch', 'revision_mismatch', 'content_hash_mismatch']),
    conflictId: z.string().uuid(),
    expected: z.object({
      workingDocumentId: currentScriptStableIdSchema,
      revision: z.number().int().positive(),
      contentHash: currentScriptHashSchema
    }).strict(),
    actual: projectCurrentScriptSnapshotSchema,
    attempted: z.object({
      editorDocument: currentScriptEditorDocumentSchema,
      contentHash: currentScriptHashSchema,
      sourceRelations: z.array(currentScriptSourceRelationInputSchema).max(2_000),
      annotations: z.array(scriptTextAnnotationInputSchema).max(2_000)
    }).strict(),
    message: z.string().min(1)
  }).strict()
const applyProjectCurrentScriptResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('applied'),
    snapshot: projectCurrentScriptSnapshotSchema,
    revisionSnapshotId: z.string().uuid()
  }).strict(),
  currentScriptConflictResultSchema
])
export const projectCurrentScriptVersionSavePayloadSchema = projectCurrentScriptApplyPayloadSchema.extend({
  kind: z.enum(['merged_draft', 'user_edit']),
  displayName: z.string().trim().max(80).optional(),
  finalize: z.boolean().optional()
}).strict()
export const projectCurrentScriptVersionRestorePayloadSchema = projectCurrentScriptApplyPayloadSchema.extend({
  sourceVersionId: z.string().min(1).nullable(),
  displayName: z.string().trim().max(80).optional()
}).strict()
export const projectCurrentScriptVersionSnapshotGetPayloadSchema = z.object({
  projectId: projectIdSchema,
  versionId: z.string().min(1)
}).strict()
const saveProjectCurrentScriptVersionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('saved'),
    version: draftVersionSchema,
    snapshot: projectCurrentScriptSnapshotSchema,
    revisionSnapshotId: z.string().uuid()
  }).strict(),
  currentScriptConflictResultSchema
])
const restoreProjectCurrentScriptVersionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('restored'),
    version: draftVersionSchema,
    snapshot: projectCurrentScriptSnapshotSchema,
    revisionSnapshotId: z.string().uuid(),
    materialWorkspace: scriptMaterialWorkspaceSchema.nullable()
  }).strict(),
  currentScriptConflictResultSchema
])
export const projectCurrentScriptRecoveryListPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const projectCurrentScriptRecoveryResolvePayloadSchema = z.object({
  projectId: projectIdSchema,
  conflictId: z.string().uuid(),
  resolutionKind: z.enum(CURRENT_SCRIPT_RECOVERY_RESOLUTION_KINDS),
  resolvedRevisionSnapshotId: z.string().uuid().nullable(),
  expectedHeadWorkingDocumentId: currentScriptStableIdSchema.optional(),
  expectedHeadRevision: z.number().int().positive().optional(),
  expectedHeadContentHash: currentScriptHashSchema.optional(),
  versionKind: z.literal('user_edit').optional(),
  displayName: z.string().trim().max(80).optional()
}).strict().superRefine((value, context) => {
  if (value.resolutionKind === 'saved_attempt_as_version' && value.resolvedRevisionSnapshotId) {
    context.addIssue({ code: 'custom', message: '另存为版本时由系统原子创建冻结快照', path: ['resolvedRevisionSnapshotId'] })
  }
  if (value.resolutionKind === 'saved_attempt_as_version' && !value.versionKind) {
    context.addIssue({ code: 'custom', message: '将未保存内容另存为版本时必须选择版本类型', path: ['versionKind'] })
  }
  if (value.resolutionKind !== 'saved_attempt_as_version' && (value.versionKind || value.displayName)) {
    context.addIssue({ code: 'custom', message: '只有另存为版本时才能设置版本类型和名称', path: ['versionKind'] })
  }
  const hasExpectedHead = Boolean(value.expectedHeadWorkingDocumentId && value.expectedHeadRevision && value.expectedHeadContentHash)
  if (value.resolutionKind === 'replaced_with_attempt' && !hasExpectedHead) {
    context.addIssue({ code: 'custom', message: '用副本替换前必须锁定用户已确认的服务端文案', path: ['expectedHeadRevision'] })
  }
  if (value.resolutionKind !== 'replaced_with_attempt' && (
    value.expectedHeadWorkingDocumentId || value.expectedHeadRevision || value.expectedHeadContentHash
  )) {
    context.addIssue({ code: 'custom', message: '只有用副本替换时才能锁定服务端文案', path: ['expectedHeadRevision'] })
  }
})
const currentScriptRecoveryCandidateSchema = z.object({
  id: z.string().uuid(),
  projectId: projectIdSchema,
  workingDocumentId: currentScriptStableIdSchema,
  expectedRevision: z.number().int().positive(),
  expectedContentHash: currentScriptHashSchema,
  headRevisionAtWrite: z.number().int().positive(),
  headContentHashAtWrite: currentScriptHashSchema,
  reason: z.enum(['working_document_mismatch', 'revision_mismatch', 'content_hash_mismatch']),
  actual: projectCurrentScriptSnapshotSchema,
  editorDocument: currentScriptEditorDocumentSchema,
  contentHash: currentScriptHashSchema,
  sourceRelations: z.array(currentScriptSourceRelationInputSchema).max(2_000),
  annotations: z.array(scriptTextAnnotationInputSchema).max(2_000),
  resolvedAt: z.string().nullable(),
  createdAt: z.string()
}).strict()
const resolvedCurrentScriptRecoverySchema = z.object({
  id: z.string().uuid(),
  resolutionKind: z.enum(CURRENT_SCRIPT_RECOVERY_RESOLUTION_KINDS),
  resolvedRevisionSnapshotId: z.string().uuid().nullable(),
  savedVersionId: z.string().min(1).nullable(),
  resolvedAt: z.string()
}).strict()
export const saveScriptPayloadSchema = z.object({ projectId: projectIdSchema, kind: z.enum(['merged_draft', 'final', 'user_edit']), content: z.string().max(1_000_000), sourceVersionId: z.string().min(1).optional(), displayName: z.string().trim().max(80).optional() }).strict()
export const saveAndFinalizeScriptPayloadSchema = saveScriptPayloadSchema
  .omit({ kind: true })
  .strict()
export const scriptExportWordPayloadSchema = z.object({ projectId: projectIdSchema, title: z.string().trim().min(1).max(200), html: z.string().max(1_000_000) }).strict()
export const feishuHandoffListPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const feishuHandoffMutationPayloadSchema = z.object({
  id: z.string().uuid(), projectId: projectIdSchema, sourceVersionId: z.string().min(1).max(128),
  targetHandoffId: z.string().uuid().nullable(),
  mode: z.enum(FEISHU_HANDOFF_MODES), accountName: z.string().trim().min(1).max(80),
  documentUrl: z.string().trim().max(2_000).nullable()
}).strict().superRefine((value, context) => {
  if (value.mode === 'new_document' && value.targetHandoffId) context.addIssue({ code: 'custom', path: ['targetHandoffId'], message: '新建文档不能引用旧交接' })
  if (value.mode === 'merge_update' && !value.targetHandoffId) context.addIssue({ code: 'custom', path: ['targetHandoffId'], message: '合并更新必须选择旧交接' })
})
export const feishuHandoffOpenPayloadSchema = z.object({ projectId: projectIdSchema, handoffId: z.string().uuid() }).strict()
export const nasArchiveCategoryLabelsSetPayloadSchema = z.object({
  labels: z.record(z.enum(ARCHIVE_CATEGORIES), z.string().trim().min(1).max(40))
}).strict()
export const nasArchiveSlotChoosePayloadSchema = z.object({ projectId: projectIdSchema, slot: z.enum(['landscape_cover', 'portrait_cover', 'video_clean', 'video_burned_in']) }).strict()
export const nasArchiveSlotStatusSetPayloadSchema = z.object({
  projectId: projectIdSchema, slot: z.enum(ARCHIVE_SLOTS), status: z.enum(['not_required', 'not_ready', 'automatic'])
}).strict()
export const nasArchivePlanPreparePayloadSchema = z.object({ projectId: projectIdSchema, category: z.enum(ARCHIVE_CATEGORIES) }).strict()
export const nasArchivePlanConfirmPayloadSchema = z.object({ planId: z.string().uuid(), planHash: z.string().length(64) }).strict()
export const nasArchiveProjectPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const nasArchiveRunPayloadSchema = z.object({ runId: z.string().uuid() }).strict()
export const setFinalVersionPayloadSchema = z.object({ projectId: projectIdSchema, versionId: z.string().min(1).max(128) }).strict()
export const confirmStylePreferencePayloadSchema = z.object({ projectId: projectIdSchema, sourceVersionId: z.string().min(1).max(128), finalVersionId: z.string().min(1).max(128), note: z.string().trim().min(1).max(2000) }).strict()
export const importScriptPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const importScriptFilePayloadSchema = z.object({ projectId: projectIdSchema, name: z.string().min(1).max(260), bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 10 * 1024 * 1024, '导入文件不能超过10MB') }).strict()
export const importOutlineTemplateFilePayloadSchema = z.object({
  name: z.string().trim().min(1).max(260).refine((value) => value.toLowerCase().endsWith('.docx'), '只支持Word .docx模板'),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 10 * 1024 * 1024, '导入文件必须小于10MB')
}).strict()
export const outlineTemplateDeletePayloadSchema = z.object({ resourceId: z.string().min(1).max(128) }).strict()
export const projectMaterialSaveTextPayloadSchema = z.object({
  projectId: projectIdSchema, role: z.enum(PROJECT_MATERIAL_ROLES), title: z.string().max(200), textContent: z.string().trim().min(1).max(400_000)
}).strict()
export const projectFrameworkSavePayloadSchema = z.object({ projectId: projectIdSchema, markdown: z.string().trim().min(1).max(400_000) }).strict()
export const projectScratchNoteSavePayloadSchema = z.object({
  projectId: projectIdSchema,
  noteId: z.string().min(1).max(128).nullable(),
  title: z.string().trim().min(1).max(120),
  markdown: z.string().trim().min(1).max(400_000)
}).strict()
export const projectMaterialImportPdfPayloadSchema = z.object({
  projectId: projectIdSchema, role: z.enum(PROJECT_MATERIAL_ROLES), title: z.string().max(200),
  name: z.string().trim().min(1).max(260).refine((value) => value.toLowerCase().endsWith('.pdf'), '只支持PDF文件'),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 10 * 1024 * 1024, 'PDF文件必须小于10MB')
}).strict()
export const projectMaterialImportPdfFromFilePayloadSchema = z.object({
  projectId: projectIdSchema, role: z.enum(PROJECT_MATERIAL_ROLES), title: z.string().max(200),
  sourcePath: z.string().min(1).max(4_096)
}).strict()
const projectAssetImportContextSchema = z.object({
  projectId: projectIdSchema, role: z.enum(PROJECT_MATERIAL_ROLES), usageType: z.enum(PROJECT_ASSET_USAGE_TYPES).nullable()
}).strict()
export const projectMaterialChooseBatchPayloadSchema = projectAssetImportContextSchema
export const projectMaterialImportBatchPayloadSchema = projectAssetImportContextSchema.extend({
  sourcePaths: z.array(z.string().min(1).max(4_096)).min(1).max(100)
}).strict()
export const projectMaterialSaveLinkPayloadSchema = z.object({
  projectId: projectIdSchema, role: z.enum(PROJECT_MATERIAL_ROLES), title: z.string().max(200), sourceUrl: z.string().trim().min(1).max(2_000)
}).strict()
export const projectMaterialDeletePayloadSchema = z.object({ projectId: projectIdSchema, materialId: z.string().min(1).max(128) }).strict()
export const projectMaterialOpenPayloadSchema = z.object({ projectId: projectIdSchema, materialId: z.string().min(1).max(128) }).strict()
export const projectMaterialPreviewSchema = z.object({ kind: z.enum(['image', 'pdf', 'unsupported']), dataUrl: z.string().nullable(), mimeType: z.string() })
export const projectPrimaryReferencesSavePayloadSchema = z.object({
  projectId: projectIdSchema,
  referenceRequirements: z.string().max(4_000),
  references: z.array(z.object({ linkId: z.string().min(1).max(128), attentionNote: z.string().max(2_000) }).strict()).max(500),
  materialReferences: z.array(z.object({ materialId: z.string().min(1).max(128), attentionNote: z.string().max(2_000) }).strict()).max(500).default([])
}).strict()
export const projectMaterialResearchStartPayloadSchema = z.object({
  projectId: projectIdSchema,
  requestedTitle: z.string().trim().max(160).default(''),
  request: z.string().trim().min(2).max(8_000)
}).strict()
export const projectMaterialResearchGetPayloadSchema = z.object({
  projectId: projectIdSchema,
  researchId: z.string().uuid().nullable().default(null)
}).strict()
export const projectMaterialResearchSavePayloadSchema = z.object({
  projectId: projectIdSchema,
  researchId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  claimIds: z.array(z.string().min(1).max(80)).min(1).max(60)
}).strict()
export const projectGenerationContextGetPayloadSchema = z.object({
  projectId: projectIdSchema,
  supportingMaterialIds: z.array(z.string().min(1).max(128)).max(500).optional()
}).strict()
export const businessScreenshotExtractPayloadSchema = z.object({
  projectId: projectIdSchema.nullable(), name: z.string().trim().min(1).max(260),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength >= 32 && value.byteLength <= 12 * 1024 * 1024, '商务截图必须小于12MB')
}).strict()
export const businessTextExtractPayloadSchema = z.object({
  projectId: projectIdSchema.nullable(),
  text: z.string().trim().min(1).max(100_000)
}).strict()
export const businessImportLinkOpenPayloadSchema = z.object({
  url: z.string().trim().url().max(2_000).refine((value) => value.startsWith('https://'), '只支持HTTPS账单链接')
}).strict()
export const businessImportLinkCaptureResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  text: z.string()
}).strict()
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nullableInputMoneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()
export const businessRecordSavePayloadSchema = z.object({
  projectId: projectIdSchema, dealStatus: z.enum(BUSINESS_DEAL_STATUSES).optional(), manualSettled: z.boolean().optional(),
  orderPlatform: z.string().max(80), orderPlatformManuallySet: z.boolean().optional(), orderDate: dateKeySchema.nullable(), revenueMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).nullable().optional().default(null), quotedAmountCents: nullableInputMoneySchema,
  platformOrderAmountCents: nullableInputMoneySchema, rebateInputMode: z.enum(REBATE_INPUT_MODES).optional().default('rate'), finalRebateRatePercent: z.number().min(0).max(100).nullable(), finalRebateAmountCents: nullableInputMoneySchema,
  rebateRequirement: z.enum(REBATE_REQUIREMENTS), rebateRecipientType: z.enum(REBATE_RECIPIENT_TYPES), rebateRecipientName: z.string().max(160),
  rebateProcedureStatus: z.enum(REBATE_PROCEDURE_STATUSES), plannedRebateDate: dateKeySchema.nullable(),
  paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES), paymentReceivedDate: dateKeySchema.nullable(), invoiceRequirement: z.enum(INVOICE_REQUIREMENTS),
  invoiceReceivedManually: z.boolean().optional(),
  videoProductionCostCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), trafficPromotionCostCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  incomeAttributionDate: dateKeySchema.nullable(), notes: z.string().max(5_000)
}).strict()
const incomeFieldDateSchema = dateKeySchema.refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, '日期格式无效')
export const businessRecordPatchPayloadSchema = z.object({
  projectId: projectIdSchema,
  patch: z.object({
    dealStatus: z.enum(BUSINESS_DEAL_STATUSES).optional(), manualSettled: z.boolean().optional(),
    orderPlatform: z.string().max(80).optional(), orderPlatformManuallySet: z.boolean().optional(),
    orderDate: incomeFieldDateSchema.nullable().optional(), revenueMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).nullable().optional(),
    platformOrderAmountCents: nullableInputMoneySchema.optional(), paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES).optional(), paymentReceivedDate: incomeFieldDateSchema.nullable().optional(),
    rebateRequirement: z.enum(REBATE_REQUIREMENTS).optional(), rebateInputMode: z.enum(REBATE_INPUT_MODES).optional(),
    finalRebateRatePercent: z.number().min(0).max(100).nullable().optional(), finalRebateAmountCents: nullableInputMoneySchema.optional(), rebateRecipientName: z.string().max(160).optional(),
    invoiceRequirement: z.enum(INVOICE_REQUIREMENTS).optional(), invoiceReceivedManually: z.boolean().optional()
  }).strict().refine((patch) => Object.values(patch).some((value) => value !== undefined), '请选择修改项')
}).strict()
export const businessLedgerStandaloneSavePayloadSchema = businessRecordSavePayloadSchema.omit({ projectId: true }).extend({
  ledgerId: projectIdSchema.nullable(),
  title: z.string().trim().min(1).max(80)
}).strict()
export const businessLedgerStandaloneBatchSavePayloadSchema = z.object({
  items: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    record: businessRecordSavePayloadSchema.omit({ projectId: true })
  }).strict()).min(1).max(500)
}).strict()
export const businessLedgerEntryPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const businessLedgerRelinkPayloadSchema = z.object({
  sourceProjectId: projectIdSchema,
  targetProjectId: projectIdSchema
}).strict()
export const businessFolderImportPayloadSchema = z.object({
  projectId: projectIdSchema, scanId: z.string().uuid(), candidateIds: z.array(z.string().uuid()).min(1).max(100)
}).strict()
export const businessLedgerLockPasswordPayloadSchema = z.object({ password: z.string().min(4).max(128) }).strict()
export const rebatePaymentSavePayloadSchema = z.object({
  projectId: projectIdSchema, paymentId: z.string().min(1).max(128).nullable(), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  paidDate: dateKeySchema, notes: z.string().max(2_000)
}).strict()
export const rebatePaymentDeletePayloadSchema = z.object({ projectId: projectIdSchema, paymentId: z.string().min(1).max(128) }).strict()
export const businessInvoiceSavePayloadSchema = z.object({
  projectId: projectIdSchema, invoiceId: z.string().min(1).max(128).nullable(), issuerName: z.string().trim().max(160).optional().default(''), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issuedDate: dateKeySchema.nullable(), status: z.enum(INVOICE_STATUSES), deliveredToClient: z.boolean(), notes: z.string().max(2_000),
  linkedProjectIds: z.array(projectIdSchema).max(50).optional().default([])
}).strict()
export const businessInvoiceDeletePayloadSchema = z.object({ projectId: projectIdSchema, invoiceId: z.string().min(1).max(128) }).strict()
export const businessFileImportPayloadSchema = z.object({
  projectId: projectIdSchema, role: z.enum(BUSINESS_FILE_ROLES), name: z.string().trim().min(1).max(260),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024, '商务文件必须小于25MB'),
  rebatePaymentId: z.string().min(1).max(128).nullable(), invoiceId: z.string().min(1).max(128).nullable(),
  linkedProjectIds: z.array(projectIdSchema).max(50).optional()
}).strict()
export const businessFilePayloadSchema = z.object({ projectId: projectIdSchema, businessFileId: z.string().min(1).max(128) }).strict()
export const businessFileProjectsSetPayloadSchema = businessFilePayloadSchema.extend({ projectIds: z.array(projectIdSchema).min(1).max(50) }).strict()
const optionalMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).nullable()
export const otherIncomeCategorySavePayloadSchema = z.object({
  categoryId: z.string().min(1).max(128).nullable(), name: z.string().trim().min(1).max(40), description: z.string().max(500), isActive: z.boolean()
}).strict()
export const otherIncomeCategoryReorderPayloadSchema = z.object({ categoryIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict()
const otherIncomeRecordInputSchema = z.object({
  title: z.string().trim().min(1).max(120), categoryId: z.string().min(1).max(128).nullable(), sourceName: z.string().trim().max(160),
  revenueMonth: optionalMonthSchema, incomeDate: dateKeySchema.nullable(), amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  directCostCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES),
  paymentReceivedDate: dateKeySchema.nullable(), status: z.enum(OTHER_INCOME_RECORD_STATUSES), currency: z.string().trim().regex(/^[A-Z]{3}$/),
  notes: z.string().max(5_000), sourceReference: z.string().max(1_000).optional(), sourceTransactionId: z.string().max(200).optional(), sourceHash: z.string().max(128).optional()
}).strict()
export const otherIncomeRecordPatchPayloadSchema = z.object({
  recordId: z.string().min(1).max(128),
  patch: z.object({
    categoryId: z.string().min(1).max(128).nullable().optional(), sourceName: z.string().trim().max(160).optional(),
    revenueMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).nullable().optional(), incomeDate: incomeFieldDateSchema.nullable().optional(),
    amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    paymentStatus: z.enum(BUSINESS_PAYMENT_STATUSES).optional(), paymentReceivedDate: incomeFieldDateSchema.nullable().optional(), status: z.enum(OTHER_INCOME_RECORD_STATUSES).optional()
  }).strict().refine((patch) => Object.values(patch).some((value) => value !== undefined), '请选择修改项')
}).strict()
export const otherIncomeRecordSavePayloadSchema = otherIncomeRecordInputSchema.extend({ recordId: z.string().min(1).max(128).nullable() }).strict()
export const otherIncomeRecordBatchSavePayloadSchema = z.object({ records: z.array(otherIncomeRecordInputSchema).min(1).max(1_000) }).strict()
export const otherIncomeAttachmentImportPayloadSchema = z.object({
  recordIds: z.array(z.string().min(1).max(128)).min(1).max(1_000),
  name: z.string().trim().min(1).max(260),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024, '收入附件必须小于25MB')
}).strict()
export const otherIncomeRecordPayloadSchema = z.object({ recordId: z.string().min(1).max(128) }).strict()
export const otherIncomeAliasSavePayloadSchema = z.object({ companyName: z.string().trim().min(1).max(160), alias: z.string().trim().min(1).max(160) }).strict()
export const otherIncomeAliasDeletePayloadSchema = z.object({ aliasId: z.string().min(1).max(128) }).strict()
export const otherIncomeRuleSavePayloadSchema = z.object({
  ruleId: z.string().min(1).max(128).nullable(), name: z.string().trim().min(1).max(80), instruction: z.string().trim().min(1).max(2_000), conditions: otherIncomeRuleConditionsSchema
}).strict()
export const otherIncomeRuleDeletePayloadSchema = z.object({ ruleId: z.string().min(1).max(128) }).strict()
export const otherIncomeImportPreviewPayloadSchema = z.object({
  sourceName: z.string().trim().min(1).max(260), mimeType: z.string().max(120), text: z.string().max(2_000_000).optional(),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024, '收入导入文件必须小于25MB').optional(),
  instruction: z.string().trim().max(2_000), categoryId: z.string().min(1).max(128).nullable(), today: dateKeySchema,
  conditions: otherIncomeRuleConditionsSchema.optional()
}).strict().refine((value) => Boolean(value.text?.trim()) !== Boolean(value.bytes?.byteLength), '文字和文件必须且只能提供一种')
export const publishingMaterialSaveTextPayloadSchema = z.object({
  projectId: projectIdSchema, platform: z.string().trim().min(1).max(40), materialKind: z.enum(['title', 'description', 'tags']), textValue: z.string().max(5000)
}).strict()
export const publishingDraftPreparePayloadSchema = z.object({ projectId: projectIdSchema, platform: z.string().trim().min(1).max(40) }).strict()
export const publishingMaterialImportFilePayloadSchema = z.object({
  projectId: projectIdSchema, platform: z.string().trim().min(1).max(40), materialKind: z.enum(['cover', 'subtitle']), name: z.string().trim().min(1).max(260),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 20 * 1024 * 1024, '发布物料文件必须小于20MB')
}).strict()
export const publishingVideoChoosePayloadSchema = z.object({ projectId: projectIdSchema, platform: z.string().trim().min(1).max(40) }).strict()
export const publishingMaterialRevealPayloadSchema = z.object({
  projectId: projectIdSchema, platform: z.string().trim().min(1).max(40), materialKind: z.enum(['cover', 'subtitle', 'video'])
}).strict()
export const publishingAccountStatePayloadSchema = z.object({ projectId: projectIdSchema.nullable() }).strict()
export const publishingAccountSavePayloadSchema = z.object({
  accountId: z.string().min(1).max(128).nullable(),
  platform: z.string().trim().min(1).max(40),
  accountName: z.string().trim().min(1).max(80),
  positioning: z.string().max(500),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  clearContact: z.boolean().default(false)
}).strict()
export const publishingAccountStatusPayloadSchema = z.object({ accountId: z.string().min(1).max(128), status: z.enum(['active', 'disabled']) }).strict()
export const publishingAccountSelectPayloadSchema = z.object({
  projectId: projectIdSchema, platform: z.string().trim().min(1).max(40), accountId: z.string().min(1).max(128)
}).strict()
export const coverGenerationStartPayloadSchema = z.object({
  projectId: projectIdSchema, platform: z.string().trim().min(1).max(40), layout: z.enum(['bilibili_landscape', 'xiaohongshu_portrait']),
  generationMode: z.enum(['ai_finished', 'stable_layers']), batchCount: z.number().int().min(1).max(5), headline: z.string().trim().min(1).max(40),
  materialLinkIds: z.array(z.string().min(1).max(128)).max(12), groupNote: z.string().max(2_000)
}).strict()
export const coverCandidatePayloadSchema = z.object({ projectId: projectIdSchema, candidateId: z.string().min(1).max(128) }).strict()
export const subtitleGenerationStartPayloadSchema = z.object({
  projectId: projectIdSchema, schema: z.enum(['zh', 'bilingual']), confirmedJobId: z.string().min(1).max(128).optional()
}).strict().refine((value) => value.schema === 'zh' || Boolean(value.confirmedJobId), '生成中英字幕前必须确认中文字幕')
export const subtitleArtifactPayloadSchema = z.object({ projectId: projectIdSchema, artifactId: z.string().min(1).max(128) }).strict()
export const subtitleArtifactUsePayloadSchema = subtitleArtifactPayloadSchema.extend({ platform: z.string().trim().min(1).max(40) }).strict()
export const titleGenerationStartPayloadSchema = z.object({
  projectId: projectIdSchema, platform: z.string().trim().min(1).max(40),
  mode: z.enum(['master', 'platform_adaptation']).default('master'), masterTitle: z.string().trim().min(1).max(300).optional(),
  instruction: z.string().max(2_000).default('')
}).strict().refine((value) => value.mode === 'master' || Boolean(value.masterTitle), '平台标题必须基于已选主标题')
export const titleCandidatePayloadSchema = z.object({ projectId: projectIdSchema, candidateId: z.string().min(1).max(128) }).strict()
export const publishingHandoffPreparePayloadSchema = z.object({ projectId: projectIdSchema, platform: z.string().trim().min(1).max(40) }).strict()
export const publishingHandoffPayloadSchema = z.object({ handoffId: z.string().min(1).max(128) }).strict()
export const publishingHandoffCopyFieldPayloadSchema = publishingHandoffPayloadSchema.extend({ field: z.enum(['title', 'description', 'tags']) }).strict()
export const publishingComputerUsePilotPayloadSchema = z.object({ pilotId: z.string().uuid() }).strict()
export const publishingComputerUsePilotStopPayloadSchema = publishingComputerUsePilotPayloadSchema.extend({
  status: z.enum(['failed', 'canceled']),
  message: z.string().max(500).default('')
}).strict()
export const distributionBatchCreatePayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sourceKind: z.enum(DISTRIBUTION_SOURCE_KINDS),
  sourceProjectId: projectIdSchema.nullable(),
  sourceText: z.string().max(500_000)
}).strict().superRefine((value, context) => {
  if (value.sourceKind === 'project_final' && !value.sourceProjectId) context.addIssue({ code: 'custom', message: '项目来源必须选择项目' })
  if (value.sourceKind !== 'project_final' && value.sourceProjectId) context.addIssue({ code: 'custom', message: '手动来源不能绑定项目' })
  if (value.sourceKind !== 'project_final' && !value.sourceText.trim()) context.addIssue({ code: 'custom', message: '请粘贴文案或字幕' })
})
export const distributionBatchPayloadSchema = z.object({ batchId: z.string().min(1).max(128) }).strict()
export const distributionAnalysisStartPayloadSchema = distributionBatchPayloadSchema.extend({ providerConfigId: z.string().min(1).max(128) }).strict()
export const distributionSegmentUpdatePayloadSchema = distributionBatchPayloadSchema.extend({
  segmentId: z.string().min(1).max(128), startTimecode: z.string().max(12), endTimecode: z.string().max(12),
  theme: z.string().max(120), summary: z.string().max(1_000)
}).strict()
export const distributionFilesLinkPayloadSchema = distributionBatchPayloadSchema.extend({
  sourcePaths: z.array(z.string().min(1).max(4_000)).max(80),
  segmentId: z.string().min(1).max(128).nullable()
}).strict()
export const distributionTargetsReplacePayloadSchema = distributionBatchPayloadSchema.extend({
  segmentId: z.string().min(1).max(128), accountIds: z.array(z.string().min(1).max(128)).max(50)
}).strict()
export const distributionTargetStatusPayloadSchema = distributionBatchPayloadSchema.extend({
  targetId: z.string().min(1).max(128), status: z.enum(DISTRIBUTION_TARGET_STATUSES), note: z.string().max(1_000)
}).strict()
export const distributionBatchCompletePayloadSchema = distributionBatchPayloadSchema.extend({ force: z.boolean() }).strict()
export const distributionFilePayloadSchema = distributionBatchPayloadSchema.extend({ segmentId: z.string().min(1).max(128) }).strict()
export const importedDraftResultSchema = z.object({ canceled: z.boolean(), version: draftVersionSchema.optional(), sourceName: z.string().optional() })
export const captureContextPayloadSchema = z.object({
  preferredProjectId: nullableProjectIdSchema.optional(),
  preferredCaptureKind: z.enum(['project_content', 'client_feedback']).nullable().optional()
}).strict()
export const captureSavePayloadSchema = z.object({
  captureKind: z.enum(['topic_idea', 'project_content', 'general_record', 'unknown', 'client_feedback']), primaryProjectId: nullableProjectIdSchema, originalContent: z.string().trim().min(1).max(100_000)
}).strict()
export const captureClassifyPayloadSchema = z.object({ captureId: z.string().min(1).max(128) }).strict()
export const captureConfirmClassificationPayloadSchema = z.object({ captureId: z.string().min(1).max(128), projectId: nullableProjectIdSchema, contentTypeId: z.string().min(1).max(128).nullable(), captureKind: z.enum(['topic_idea', 'project_content', 'general_record']).optional(), generalCategoryId: z.string().min(1).max(128).nullable().optional() }).strict()
export const captureUndoClassificationPayloadSchema = captureClassifyPayloadSchema
export const captureSetUseStatusPayloadSchema = z.object({ captureId: z.string().min(1).max(128), useStatus: z.enum(['active', 'parked', 'discarded']) }).strict()
export const captureDeletePayloadSchema = z.object({ captureId: z.string().min(1).max(128) }).strict()
export const topicTrashPayloadSchema = z.object({ topicId: z.string().min(1).max(128) }).strict()
export const captureAttachTopicPayloadSchema = z.object({ captureId: z.string().min(1).max(128), topicId: z.string().min(1).max(128) }).strict()
export const generalCategoryCreatePayloadSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict()
export const generalCategoryUpdatePayloadSchema = z.object({ generalCategoryId: z.string().min(1).max(128), name: z.string().trim().min(1).max(80).optional(), description: z.string().max(2000).optional(), isActive: z.boolean().optional() }).strict()
export const topicCreatePayloadSchema = z.object({
  videoFormat: z.enum(VIDEO_FORMATS).nullable().optional(), isCommercial: z.boolean().optional(),
  title: z.string().trim().min(1).max(80), coreAngle: z.string().max(12_000), contentTypeId: z.string().min(1).max(128), importanceLevel: z.number().int().min(0).max(3),
  needsMoreExperience: z.boolean(), startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), expectedCompletionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), actualCompletionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), stageId: z.string().min(1).max(128)
}).strict()
  .refine((value) => !value.startAt || !value.expectedCompletionAt || value.startAt <= value.expectedCompletionAt, '开始时间不能晚于目标日')
  .refine((value) => !value.startAt || !value.actualCompletionAt || value.startAt <= value.actualCompletionAt, '实际完成时间不能早于开始时间')
export const topicUpdatePayloadSchema = z.object({
  topicId: z.string().min(1).max(128), patch: z.object({
    videoFormat: z.enum(VIDEO_FORMATS).nullable().optional(), isCommercial: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(), coreAngle: z.string().max(12_000).optional(), contentTypeId: z.string().min(1).max(128).optional(),
    importanceLevel: z.number().int().min(0).max(3).optional(), needsMoreExperience: z.boolean().optional(),
    startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), expectedCompletionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), actualCompletionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), stageId: z.string().min(1).max(128).optional()
  }).strict()
}).strict()
export const topicIdPayloadSchema = z.object({ topicId: z.string().min(1).max(128) }).strict()
export const topicStageCreatePayloadSchema = z.object({ name: z.string().trim().min(1).max(40) }).strict()
export const topicStageUpdatePayloadSchema = z.object({ stageId: z.string().min(1).max(128), name: z.string().trim().min(1).max(40), nextActionLabel: z.string().trim().max(80).nullable().optional() }).strict()
export const topicStageReorderPayloadSchema = z.object({ stageIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict()
export const topicStageDeletePayloadSchema = z.object({ stageId: z.string().min(1).max(128) }).strict()
export const topicColumnCreatePayloadSchema = z.object({ name: z.string().trim().min(1).max(40), dataType: z.enum(['text', 'number', 'date']) }).strict()
export const topicColumnUpdatePayloadSchema = z.object({ columnId: z.string().min(1).max(128), patch: z.object({ name: z.string().trim().min(1).max(40).optional(), isVisible: z.boolean().optional() }).strict() }).strict()
export const topicColumnReorderPayloadSchema = z.object({ columnIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict()
export const topicColumnDeletePayloadSchema = z.object({ columnId: z.string().min(1).max(128) }).strict()
export const topicCustomValueSetPayloadSchema = z.object({ topicId: z.string().min(1).max(128), columnId: z.string().min(1).max(128), value: z.string().max(12_000).nullable() }).strict()
export const contentTypeCreatePayloadSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict()
export const contentTypeUpdatePayloadSchema = z.object({
  contentTypeId: z.string().min(1).max(128), name: z.string().trim().min(1).max(80).optional(), description: z.string().max(2000).optional(), isActive: z.boolean().optional()
}).strict().refine((value) => value.name !== undefined || value.description !== undefined || value.isActive !== undefined, '至少修改一个内容方向字段')
export const contentTypeReorderPayloadSchema = z.object({ contentTypeIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict()
export const scheduleCreatePayloadSchema = z.object({
  projectId: projectIdSchema.nullable(), colorToken: z.enum(PROJECT_COLOR_TOKENS).nullable().optional(), title: z.string().trim().min(1).max(300), actionType: z.enum(['overview', ...OPTIONAL_MODULE_KEYS]),
  startAt: z.iso.datetime({ offset: true }).nullable(), endAt: z.iso.datetime({ offset: true }).nullable(), scheduleKind: z.enum(SCHEDULE_KINDS), waitingFor: z.string().trim().max(120).nullable()
}).strict().superRefine((value, context) => {
  if (value.projectId === null && value.actionType !== 'overview') {
    context.addIssue({ code: 'custom', path: ['actionType'], message: '不关联项目的排期不能绑定项目阶段' })
  }
})
export const scheduleCreateBatchPayloadSchema = z.object({
  items: z.array(scheduleCreatePayloadSchema).min(1).max(20),
  requestId: requestIdSchema
}).strict()
export const scheduleUpdatePayloadSchema = z.object({ scheduleId: z.string().min(1).max(128), patch: z.object({ title: z.string().trim().min(1).max(300).optional(), actionType: z.enum(['overview', ...OPTIONAL_MODULE_KEYS]).optional() }).strict().refine((p) => p.title !== undefined || p.actionType !== undefined, '至少修改一个排期字段') }).strict()
export const scheduleMovePayloadSchema = z.object({ scheduleId: z.string().min(1).max(128), startAt: z.iso.datetime({ offset: true }).nullable(), endAt: z.iso.datetime({ offset: true }).nullable() }).strict()
export const scheduleSetStatePayloadSchema = z.object({ scheduleId: z.string().min(1).max(128), state: z.enum(SCHEDULE_STATES) }).strict()
export const scheduleSetColorPayloadSchema = z.object({ scheduleId: z.string().min(1).max(128), colorToken: z.enum(PROJECT_COLOR_TOKENS) }).strict()
export const scheduleDeletePayloadSchema = z.object({ scheduleId: z.string().min(1).max(128) }).strict()
const todoCreateInputSchema = z.object({
  stageSelection: z.enum(['manual', 'suggested']).optional(),
  categorySelection: z.enum(['manual', 'suggested']).optional(),
  isExtra: z.boolean().optional(),
  dateRange: todoDateRangeSchema.nullable().optional(),
  stageKey: stageTimeKeySchema.nullable().optional(),
  title: z.string().trim().min(1).max(300),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  segment: z.enum(TODO_SEGMENTS).nullable(),
  category: z.enum(TODO_CATEGORIES),
  suggestedCategory: z.enum(TODO_CATEGORIES).optional(),
  projectId: z.string().min(1).max(128).nullable(),
  trackingMode: z.enum(TODO_TRACKING_MODES),
  progress: z.number().int().min(0).max(100)
}).strict()
export const todoCreateBatchPayloadSchema = z.object({ items: z.array(todoCreateInputSchema).min(1).max(50) }).strict()
export const todoTimeMovePayloadSchema = z.object({
  todoId: z.string().uuid(), expectedUpdatedAt: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), segment: z.enum(TODO_SEGMENTS).nullable(),
  target: z.object({ todoId: z.string().uuid(), expectedUpdatedAt: z.string().min(1) }).strict().nullable(),
  after: z.boolean()
}).strict()
export const todoBatchLinkPayloadSchema = z.object({
  items: z.array(z.object({ todoId: z.string().uuid(), expectedUpdatedAt: z.string(), expectedProjectId: z.string().nullable(), expectedStageKey: stageTimeKeySchema.nullable() }).strict()).min(1).max(100).refine(items => new Set(items.map(item => item.todoId)).size === items.length, '不能重复选择待办'),
  projectId: z.string().min(1).max(128).nullable(),
  stageMode: z.enum(['preserve', 'replace']), stageKey: stageTimeKeySchema.nullable(), includeClosed: z.boolean()
}).strict().refine(input => (input.stageMode === 'replace' && input.projectId !== null) || input.stageKey === null, '阶段选择无效')
export const todoUpdatePayloadSchema = z.object({
  todoId: z.string().uuid(),
  patch: z.object({
    expectedUpdatedAt: z.string().optional(),
    isExtra: z.boolean().optional(),
    dateRange: todoDateRangeSchema.nullable().optional(),
    stageKey: stageTimeKeySchema.nullable().optional(),
    title: z.string().trim().min(1).max(300).optional(),
    plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    segment: z.enum(TODO_SEGMENTS).nullable().optional(),
    category: z.enum(TODO_CATEGORIES).optional(),
    projectId: z.string().min(1).max(128).nullable().optional(),
    trackingMode: z.enum(TODO_TRACKING_MODES).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    completed: z.boolean().optional()
  }).strict()
}).strict()
export const todoProjectStagesPayloadSchema = z.object({ projectId: z.string().min(1).max(128) }).strict()
const todoStagePointSchema = z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), segment: z.enum(TODO_SEGMENTS) }).strict()
export const todoProjectStagesSchema = z.array(z.object({
  key: stageTimeKeySchema, enabled: z.boolean(), completedAt: z.string().nullable(),
  startedAt: todoStagePointSchema.nullable(), actualCompletedAt: todoStagePointSchema.nullable(),
  plannedStartAt: todoStagePointSchema.nullable(), plannedEndAt: todoStagePointSchema.nullable(),
  status: z.enum(STAGE_TIME_STATUSES), revision: z.string(), currentPoint: todoStagePointSchema
}).strict())
export const todoStageTimePayloadSchema = z.object({
  todoId: z.string().uuid(), projectId: z.string().min(1).max(128), stageKey: stageTimeKeySchema,
  expectedRevision: z.string().length(64), expectedTodoUpdatedAt: z.string(), action: z.enum(['start', 'complete', 'edit']),
  startedAt: todoStagePointSchema.nullable(), completedAt: todoStagePointSchema.nullable(),
  confirmedOpenTodoIds: z.array(z.string().uuid()).max(10000), requestId: z.string().uuid()
}).strict()
export const todoStageStartCandidatePayloadSchema = z.object({ todoId: z.string().uuid() }).strict()
export const todoStageStartCandidateSchema = z.object({
  todoId: z.string().uuid(), projectId: z.string(), projectTitle: z.string(), stageKey: stageTimeKeySchema.nullable(),
  title: z.string(), linkedStageKey: stageTimeKeySchema.nullable(), stageLinkSource: z.literal('manual').nullable(),
  recommendedStageKey: stageTimeKeySchema.nullable(), reason: z.enum(['manual', 'text', 'ambiguous', 'unknown']), availableStageKeys: z.array(stageTimeKeySchema),
  plannedDate: z.string().nullable(), segment: z.enum(TODO_SEGMENTS).nullable()
}).strict().nullable()
export const todoStageStartPayloadSchema = z.object({
  expectedTitle: z.string(), expectedLinkedStageKey: stageTimeKeySchema.nullable(), expectedStageLinkSource: z.literal('manual').nullable(),
  todoId: z.string().uuid(), projectId: z.string().min(1).max(128), stageKey: stageTimeKeySchema,
  expectedPlannedDate: z.string().nullable(), expectedSegment: z.enum(TODO_SEGMENTS).nullable(), startedAt: z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), segment: z.enum(TODO_SEGMENTS) }).strict(), requestId: z.string().uuid()
}).strict()
export const todoStageCompletePayloadSchema = z.object({
  todoId: z.string().uuid(), projectId: z.string().min(1).max(128), stageKey: stageTimeKeySchema,
  expectedCompletedAt: z.string().nullable(), completed: z.boolean(),
  confirmedOpenTodoIds: z.array(z.string().uuid()).max(10000).optional(), requestId: z.string().uuid()
}).strict()
export const todoDismissPayloadSchema = z.object({ todoId: z.string().uuid() }).strict()
const workLogMinutesSchema = z.object({
  totalMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  selfMediaMinutes: z.number().int().min(0).max(1440),
  aiMinutes: z.number().int().min(0).max(1440),
  otherWorkMinutes: z.number().int().min(0).max(1440)
}).strict()
export const scheduleWindowResizePayloadSchema = z.object({ height: z.number().int().min(200).max(600) }).strict()
export const scheduleWindowOpenMainPayloadSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()
export const dailyWorkLogGetPayloadSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()
export const dailyWorkLogTotalSetPayloadSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalMinutes: z.number().int().min(0).max(1440),
  expected: workLogMinutesSchema
}).strict()
export const dailyWorkLogAdjustPayloadSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field: z.enum(['selfMediaMinutes', 'aiMinutes', 'otherWorkMinutes']),
  deltaMinutes: z.number().int().min(-1440).max(1440).refine((value) => value !== 0)
}).strict()
export const dailyWorkLogSetPayloadSchema = z.object({
  expected: workLogMinutesSchema.optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  selfMediaMinutes: z.number().int().min(0).max(1440),
  aiMinutes: z.number().int().min(0).max(1440),
  otherWorkMinutes: z.number().int().min(0).max(1440)
}).strict()
const taskResourceOptionsShape = {
  taskContentTypeId: z.string().min(1).max(128).optional(),
  taskTemplateId: z.string().min(1).max(128).nullable().optional(),
  excludedRecommendedResourceIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  manualResourceIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  supportingMaterialIds: z.array(z.string().min(1).max(128)).max(500).optional()
}
export const taskPrepareResourcesPayloadSchema = z.object({ projectId: projectIdSchema, ...taskResourceOptionsShape }).strict()
export const projectSetResourceReferencePayloadSchema = z.object({
  projectId: projectIdSchema, resourceId: z.string().min(1).max(128), enabled: z.boolean(),
  role: z.enum(PROJECT_RESOURCE_ROLES).optional(), selectionSource: z.enum(RESOURCE_SELECTION_SOURCES).optional()
}).strict()
const contentDerivationOptionsShape = {
  contentTypeId: z.string().min(1).max(128).optional(),
  templateId: z.string().min(1).max(128).nullable().optional(),
  excludedRecommendedResourceIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  manualResourceIds: z.array(z.string().min(1).max(128)).max(100).optional()
}
export const contentSourceImportPayloadSchema = z.object({
  sourceKind: z.enum(CONTENT_SOURCE_KINDS), title: z.string().trim().max(160), scopeLabel: z.string().trim().max(300), rawContent: z.string().trim().min(12).max(200_000)
}).strict()
export const conversationSourcesListPayloadSchema = z.object({
  text: z.string().trim().max(160).optional(), source: z.enum(CONVERSATION_HISTORY_SOURCES).optional(), limit: z.number().int().min(1).max(1_000).optional()
}).strict()
export const conversationSelectionPreparePayloadSchema = z.object({
  ids: z.array(z.string().min(1).max(220)).min(1).max(30), customSensitiveTerms: z.array(z.string().trim().min(2).max(80)).max(50).optional()
}).strict()
export const conversationFilterStartPayloadSchema = conversationSelectionPreparePayloadSchema.extend({ provider: z.enum(['codex_cli', 'claude_cli']) }).strict()
export const conversationFilterCandidatesListPayloadSchema = z.object({ taskId: z.string().min(1).max(128).optional() }).strict()
export const conversationFilterCandidateSetStatusPayloadSchema = z.object({ candidateId: z.string().min(1).max(128), status: z.enum(CONVERSATION_FILTER_CANDIDATE_STATUSES) }).strict()
export const filterCandidatePayloadSchema = z.object({ candidateId: z.string().min(1).max(128) }).strict()
export const recycleEmptySkippedItemSchema = z.object({ id: z.string(), title: z.string(), category: z.enum(RECYCLE_CATEGORIES), reason: z.string() })
export const recycleEmptyResultSchema = z.object({ deletedCount: z.number().int().nonnegative(), skipped: z.array(recycleEmptySkippedItemSchema) })
const conversationFilterDestinationInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('content_inspiration'), contentTypeId: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('topic'), contentTypeId: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('existing_project'), projectId: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('new_project'), title: z.string().trim().min(1).max(160), contentTypeId: z.string().min(1).max(128), templateId: z.string().min(1).max(128).nullable() }).strict()
])
export const conversationFilterCandidateRoutePayloadSchema = z.object({ candidateId: z.string().min(1).max(128), destination: conversationFilterDestinationInputSchema }).strict()
export const conversationScanPlanPayloadSchema = z.object({
  mode: z.enum(['deep', 'incremental']), sourceScope: z.enum(['codex', 'claude', 'both'])
}).strict()
export const conversationScanPreparePayloadSchema = conversationScanPlanPayloadSchema.extend({
  provider: z.enum(['codex_cli', 'claude_cli']).optional(),
  providerConfigId: z.string().min(1).max(128).optional(),
  customSensitiveTerms: z.array(z.string().trim().min(2).max(80)).max(50).optional(),
  budgetTokenLimit: z.number().int().min(1_000).max(10_000_000).nullable().optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.provider) === Boolean(value.providerConfigId)) context.addIssue({ code: 'custom', message: '必须且只能选择一个Provider配置' })
})
export const conversationScanStartPayloadSchema = z.object({ preflightId: z.string().uuid() }).strict()
export const conversationScanPreflightBatchPayloadSchema = z.object({ preflightId: z.string().uuid(), batchIndex: z.number().int().positive() }).strict()
export const conversationScanIdPayloadSchema = z.object({ scanId: z.string().min(1).max(128).nullable().optional() }).strict()
export const conversationFilterCandidateDecidePayloadSchema = z.object({
  candidateId: z.string().min(1).max(128),
  decision: z.discriminatedUnion('action', [
    z.object({ action: z.literal('confirm') }).strict(),
    z.object({ action: z.literal('confirm_new_direction') }).strict(),
    z.object({ action: z.literal('append_topic'), topicId: z.string().min(1).max(128) }).strict(),
    z.object({ action: z.literal('append_project'), projectId: z.string().min(1).max(128) }).strict(),
    z.object({ action: z.literal('park') }).strict(),
    z.object({ action: z.literal('discard') }).strict(),
    z.object({ action: z.literal('mark_done') }).strict(),
    z.object({ action: z.literal('restore') }).strict()
  ])
}).strict()
export const conversationFilterCandidatesConfirmPayloadSchema = z.object({ candidateIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict()
export const conversationFilterCandidateDeletePayloadSchema = z.object({ candidateId: z.string().min(1).max(128) }).strict()
export const contentAtomSetStatusPayloadSchema = z.object({ atomId: z.string().min(1).max(128), status: z.enum(['review_pending', 'kept', 'discarded']) }).strict()
export const contentAtomMergePayloadSchema = z.object({ atomIds: z.array(z.string().min(1).max(128)).min(2).max(20), title: z.string().trim().max(160).optional() }).strict()
export const contentDerivativePreparePayloadSchema = z.object({ ...contentDerivationOptionsShape }).strict()
export const contentDerivativeCreatePayloadSchema = z.object({ atomIds: z.array(z.string().min(1).max(128)).min(1).max(20), outputType: z.enum(CONTENT_DERIVATIVE_TYPES), ...contentDerivationOptionsShape }).strict()
export const contentDerivativeConfirmPayloadSchema = z.object({ candidateId: z.string().min(1).max(128), currentContent: z.string().trim().min(1).max(100_000) }).strict()
export const contentDerivativeIdPayloadSchema = z.object({ candidateId: z.string().min(1).max(128) }).strict()
export const contentDerivativeCreateProjectPayloadSchema = z.object({
  candidateId: z.string().min(1).max(128), title: z.string().trim().min(1).max(160), contentTypeId: z.string().min(1).max(128), templateId: z.string().min(1).max(128).nullable()
}).strict()
export const taskCreatePayloadSchema = z.object({
  taskType: z.enum(['mock_demo', 'draft_generation']), projectId: nullableProjectIdSchema,
  title: z.string().trim().min(1).max(200), provider: z.enum(['mock', 'codex_cli', 'claude_cli']), input: z.string().max(100_000),
  ...taskResourceOptionsShape
}).strict()
export const taskIdPayloadSchema = z.object({ taskId: z.string().min(1).max(128) }).strict()
export const providerSecurityValidatePayloadSchema = z.object({ provider: z.enum(['codex_cli', 'claude_cli']) }).strict()
export const externalProviderConfigSavePayloadSchema = z.object({
  id: z.string().uuid().optional(), kind: z.enum(EXTERNAL_PROVIDER_KINDS), displayName: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().max(2_000).optional(), model: z.string().trim().min(1).max(160), apiKey: z.string().trim().min(1).max(8_000).optional()
}).strict()
export const externalProviderConfigIdPayloadSchema = z.object({ id: z.string().uuid() }).strict()
export const providerRoutingSetPayloadSchema = z.object({
  defaultProviderConfigId: z.string().min(1).max(128),
  fallbackProviderConfigId: z.string().min(1).max(128).nullable()
}).strict()
export const preferencesPatchSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(), visualStyle: z.enum(['warm', 'feishu']).optional(), homeSplit: z.number().min(0).max(100).optional(),
  companionTodoView: z.enum(['all', 'time', 'category']).optional(),
  companionTodoOrder: z.array(z.string().uuid()).max(10000).optional(),
  homeTodoView: z.enum(['time', 'category']).optional(), lastProjectModuleById: lastProjectModuleByIdSchema.optional(),
  workbenchLayout: z.enum(['equal', 'models', 'merged']).optional(),
  workbenchModelSplit: z.number().min(20).max(80).optional(), workbenchMergedSplit: z.number().min(35).max(85).optional(), workbenchMergedVisible: z.boolean().optional(),
  workbenchView: z.enum(['single', 'dual', 'comparison']).optional(), workbenchSingleProvider: z.enum(['codex', 'claude']).optional(),
  workbenchDualActiveProvider: z.enum(['codex', 'claude']).optional(), workbenchConversationTab: z.enum(['claude', 'codex', 'current']).optional(), workbenchHiddenProviders: z.array(z.enum(['claude', 'codex'])).max(2).optional(),
  workbenchConversationScrollTops: z.object({ claude: z.number().int().nonnegative().max(10_000_000), codex: z.number().int().nonnegative().max(10_000_000), current: z.number().int().nonnegative().max(10_000_000) }).strict().optional(), workbenchComparisonSide: z.enum(['claude', 'codex']).optional(),
  workbenchComparisonSplit: z.number().min(30).max(70).optional(), workbenchComparisonPreviewSplit: z.number().min(20).max(45).optional(),
  workbenchComparisonScrollTop: z.number().int().nonnegative().max(10_000_000).optional(),
  workbenchComparisonColorMode: z.enum(['all', 'left', 'none']).optional(),
  workbenchComparisonDocumentMode: z.enum(['groups', 'clean']).optional(),
  workbenchComparisonUseOutline: z.boolean().optional(),
  workbenchComparisonSplitScope: z.enum(['current', 'matched']).optional(),
  workbenchDraftCurrentScrollTop: z.number().int().nonnegative().max(10_000_000).optional(),
  workbenchPrimaryView: z.enum(['conversation', 'comparison', 'versions']).optional(),
  workbenchComparisonKind: z.enum(['drafts', 'materials']).optional(),
  workbenchDraftSurface: z.enum(['organize', 'current']).optional(),
  workbenchVersionSurface: z.enum(['compare', 'current']).optional(),
  workbenchVersionMobileSide: z.enum(['left', 'right']).optional(),
  workbenchVersionSourcePanelOpen: z.boolean().optional(),
  workbenchVersionDiffVisible: z.boolean().optional(),
  workbenchVersionScrollTops: z.object({ left: z.number().int().nonnegative().max(10_000_000), right: z.number().int().nonnegative().max(10_000_000) }).strict().optional(),
  workbenchVersionCurrentScrollTop: z.number().int().nonnegative().max(10_000_000).optional(),
  workbenchMaterialTab: z.enum(['source', 'ai', 'current']).optional(),
  workbenchMaterialScrollTops: z.object({ source: z.number().int().nonnegative().max(10_000_000), ai: z.number().int().nonnegative().max(10_000_000), current: z.number().int().nonnegative().max(10_000_000) }).strict().optional(),
  workbenchCodexModel: z.string().min(1).max(160).nullable().optional(),
  sidebarCollapsed: z.boolean().optional(), sidebarWidth: z.number().int().min(184).max(340).optional(), sidebarPinnedExpanded: z.boolean().optional(), sidebarStageShortcutsExpanded: z.boolean().optional(),
  sidebarLayout: sidebarLayoutSchema.optional(),
  pinnedProjectOrder: z.array(z.string().min(1).max(128)).max(100).optional(),
  pinnedProjectStages: projectStageShortcutsSchema.optional(),
  inspectorWidth: z.number().min(220).max(520).optional(),
  scheduleUnscheduledWidth: z.number().min(132).max(320).optional(),
  scheduleUnscheduledCollapsed: z.boolean().optional(),
  scheduleInspectorCollapsed: z.boolean().optional(),
  workspaceTabs: z.array(workspaceTabSchema).min(1).max(8).optional(), activeWorkspaceTabId: z.string().min(1).max(128).optional(),
  defaultPlatforms: z.array(z.string().min(1).max(20)).max(20).optional(), businessPlatforms: z.array(z.string().trim().min(1).max(40)).max(50).optional(), otherIncomeSourceTemplates: otherIncomeSourceTemplatesSchema.optional(), defaultContentTypeId: z.string().nullable().optional(), autoClassifyNewProject: z.boolean().optional(),
  computerUsePublishBilibili: z.boolean().optional(),
  weatherCity: z.string().trim().max(80).optional(),
  weatherPreviewCondition: z.enum(WEATHER_CONDITIONS).nullable().optional(),
  weatherPreviewPeriod: z.enum(WEATHER_PERIODS).nullable().optional(),
  todoCategoryColors: z.object({
    self_media: z.enum(PROJECT_COLOR_TOKENS),
    life: z.enum(PROJECT_COLOR_TOKENS),
    ai: z.enum(PROJECT_COLOR_TOKENS),
    other_work: z.enum(PROJECT_COLOR_TOKENS)
  }).strict().optional(),
  todoCategoryLabels: z.object({
    self_media: z.string().trim().min(1).max(16),
    life: z.string().trim().min(1).max(16),
    ai: z.string().trim().min(1).max(16),
    other_work: z.string().trim().min(1).max(16)
  }).strict().optional(),
  todoCategoryWeights: z.object({
    self_media: z.number().int().min(0).max(100),
    life: z.number().int().min(0).max(100),
    ai: z.number().int().min(0).max(100),
    other_work: z.number().int().min(0).max(100)
  }).strict().optional()
}).strict()
export const workbenchPreferencesSchema = preferencesSchema.pick({
  workbenchLayout: true, workbenchModelSplit: true, workbenchMergedSplit: true, workbenchMergedVisible: true,
  workbenchView: true, workbenchSingleProvider: true, workbenchDualActiveProvider: true, workbenchConversationTab: true, workbenchHiddenProviders: true, workbenchConversationScrollTops: true, workbenchComparisonSide: true,
  workbenchComparisonSplit: true, workbenchComparisonPreviewSplit: true, workbenchComparisonScrollTop: true,
  workbenchComparisonColorMode: true, workbenchComparisonDocumentMode: true, workbenchComparisonUseOutline: true,
  workbenchComparisonSplitScope: true, workbenchDraftCurrentScrollTop: true,
  workbenchPrimaryView: true, workbenchComparisonKind: true, workbenchDraftSurface: true,
  workbenchVersionSurface: true, workbenchVersionMobileSide: true, workbenchVersionSourcePanelOpen: true, workbenchVersionDiffVisible: true, workbenchVersionScrollTops: true, workbenchVersionCurrentScrollTop: true,
  workbenchMaterialTab: true, workbenchMaterialScrollTops: true, workbenchCodexModel: true
})
export const workbenchPreferencesGetPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const workbenchPreferencesSetPayloadSchema = z.object({ projectId: projectIdSchema, patch: workbenchPreferencesSchema.partial().strict() }).strict()
export const productionChecklistItemSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(500),
  completed: z.boolean(),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  scheduleSegment: z.enum(STAGE_TIME_SEGMENTS).nullable().optional().default(null)
}).strict().superRefine((item, context) => {
  if (item.scheduleSegment && !item.scheduleDate) context.addIssue({ code: 'custom', message: '设置时段前需要先选择日期', path: ['scheduleSegment'] })
})
export const projectProductionNotesSchema = z.object({
  projectId: projectIdSchema,
  shootingItems: z.array(productionChecklistItemSchema).max(300),
  editingNotes: z.string().max(200_000),
  editingNotesFormat: z.enum(['plain_text', 'html']).optional().default('plain_text'),
  updatedAt: z.string().datetime()
}).strict()
export const projectProductionNotesGetPayloadSchema = z.object({ projectId: projectIdSchema }).strict()
export const projectProductionNotesSetPayloadSchema = z.object({
  projectId: projectIdSchema,
  scope: z.enum(['shooting', 'editing']).optional(),
  shootingItems: z.array(productionChecklistItemSchema).max(300),
  editingNotes: z.string().max(200_000),
  editingNotesFormat: z.enum(['plain_text', 'html']).optional().default('plain_text')
}).strict()
export const externalLinkOpenPayloadSchema = z.object({ url: z.string().url().max(8_000) }).strict()
export const weatherGetPayloadSchema = z.object({ force: z.boolean().optional().default(false) }).strict()
export const linkGroupCreatePayloadSchema = z.object({
  projectId: projectIdSchema, colorToken: z.string().regex(/^highlight-[1-6]$/), labelIndex: z.number().int().min(1), selectedText: z.string().trim().min(2).max(20_000),
  mergedVersionId: z.string().min(1), claudeVersionId: z.string().nullable(), codexVersionId: z.string().nullable()
}).strict()
export const linkGroupListPayloadSchema = z.object({ projectId: projectIdSchema, mergedVersionId: z.string().min(1) }).strict()
export const linkGroupDeletePayloadSchema = z.object({ projectId: projectIdSchema, linkGroupId: z.string().min(1) }).strict()
export const linkGroupSchema = z.object({
  id: z.string(), projectId: z.string(), colorToken: z.string(), labelIndex: z.number().int(), selectedText: z.string(), mergedVersionId: z.string(),
  claudeVersionId: z.string().nullable(), codexVersionId: z.string().nullable(), matchType: z.literal('exact'), createdAt: z.string()
})

export const structuredReferenceCatalogItemSchema = z.object({
  sourceKey: z.string().regex(/^ref_v1_[a-f0-9]{32}$/u),
  sourceKind: z.enum(STRUCTURED_REFERENCE_SOURCE_KINDS),
  sourceId: z.string().min(1).max(256),
  label: z.string().trim().min(1).max(160),
  summary: z.string().max(2_000),
  group: z.enum(['current_material', 'brief', 'client_feedback', 'project_material', 'project_image', 'material_group', 'outline', 'history', 'style', 'conversation', 'temporary']),
  sourceVersion: z.string().min(1).max(500),
  availability: z.enum(STRUCTURED_REFERENCE_AVAILABILITIES),
  mimeType: z.string().max(300).nullable(),
  contentCharacters: z.number().int().nonnegative(),
  rememberedUse: z.object({
    role: z.enum(['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']),
    aspect: z.string().max(200).nullable(),
    scope: z.enum(STRUCTURED_REFERENCE_SCOPES)
  }).strict().nullable(),
  rememberedUses: z.array(z.object({
    role: z.enum(['hard_constraint', 'key_adoption', 'ordinary_reference', 'style_reference']),
    aspect: z.string().max(200).nullable(),
    scope: z.enum(STRUCTURED_REFERENCE_SCOPES)
  }).strict()).max(STRUCTURED_REFERENCE_SCOPES.length),
  lastUsedAt: z.string().datetime().nullable()
}).strict()

export const structuredReferenceRoleResolutionSchema = z.object({
  reference: structuredReferenceUseSchema,
  matchedEvidence: z.array(structuredReferenceRuleEvidenceSchema).max(20),
  conflict: z.boolean()
}).strict()

export type AppInfo = z.infer<typeof appInfoSchema>

export const contentFactEvidenceGetPayloadSchema = z.object({
  projectId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1).max(128)).min(1).max(20)
}).strict()

export const contentFactEvidenceSchema: z.ZodType<ContentFactEvidence> = z.object({
  id: z.string(), projectId: z.string(), requestId: z.string(), targetId: z.string(), taskId: z.string(), annotationId: z.string(),
  claim: z.string(), sourceTitle: z.string(), sourceUrl: z.string().url(), accessedAt: z.string(), market: z.string(), factAsOf: z.string(),
  evidenceType: z.enum(['fact', 'price']), priceKind: z.enum(['launch_official', 'current_official', 'current_channel', 'user_actual']).nullable(),
  currency: z.string().nullable(), runtimeAccessId: z.string(), createdAt: z.string()
}).strict()

export interface CreatorOSApi extends PersonalReviewApi {
  getAppInfo(): Promise<AppInfo>
  openExternalLink(url: string): Promise<void>
  listCodexWritingModels(): Promise<CodexWritingModelOption[]>
  listStructuredReferenceCatalog(projectId: string, sessionScope: string, query?: string): Promise<StructuredReferenceCatalogItem[]>
  resolveStructuredReferenceRoles(input: z.input<typeof structuredReferenceRolesResolvePayloadSchema>): Promise<StructuredReferenceRoleResolution[]>
  setProjectReferenceRolePreference(input: z.input<typeof projectReferenceRolePreferenceSetPayloadSchema>): Promise<ProjectReferenceRolePreference>
  removeProjectReferenceRolePreference(input: z.input<typeof projectReferenceRolePreferenceRemovePayloadSchema>): Promise<void>
  dispatchContentInstruction(input: z.input<typeof contentInstructionDispatchPayloadSchema>): Promise<{ request: ContentInstructionRequestRecord; tasks: TaskRun[] }>
  getContentInstructionRequest(requestId: string): Promise<ContentInstructionRequestRecord>
  getContentInstructionRequestByTask(taskId: string): Promise<ContentInstructionRequestRecord>
  getContentFactEvidence(projectId: string, evidenceIds: string[]): Promise<ContentFactEvidence[]>
  openCapture(projectId?: string | null, captureKind?: 'project_content' | 'client_feedback' | null): Promise<void>
  closeCapture(): Promise<void>
  openTodoWidget(): Promise<void>
  openTodoMainWindow(): Promise<void>
  closeTodoWindow(): Promise<void>
  getWorkspace(): Promise<WorkspaceSnapshot>
  getWeather(force?: boolean): Promise<WeatherSceneSnapshot>
  createManualBackup(): Promise<{ createdAt: string; label: string }>
  chooseWorkspaceBackupToRestore(): Promise<{ scheduled: boolean }>
  searchGlobal(query: string, limit?: number): Promise<GlobalSearchResult[]>
  getWorkspaceUndoState(): Promise<WorkspaceUndoState>
  undoWorkspaceOperation(operationId?: string | null): Promise<WorkspaceUndoResult>
  getProject(projectId: string, touch?: boolean): Promise<ProjectDetail>
  createProject(input: CreateProjectInput): Promise<ProjectDetail>
  trashProject(projectId: string): Promise<ProjectSummary>
  renameProject(projectId: string, title: string): Promise<ProjectSummary>
  setProjectPinned(projectId: string, pinned: boolean): Promise<ProjectSummary>
  setProjectColor(projectId: string, colorToken: ProjectSummary['colorToken']): Promise<ProjectSummary>
  classifyProjectDraft(title: string, description: string): Promise<ProjectDraftClassification>
  restoreProject(projectId: string): Promise<ProjectSummary>
  permanentlyDeleteProject(projectId: string): Promise<boolean>
  setProjectLifecycle(projectId: string, lifecycle: 'completed' | 'archived' | 'project_created'): Promise<ProjectSummary>
  updateProjectClassification(projectId: string, patch: { videoFormat?: VideoFormat | null; isCommercial?: boolean }): Promise<ProjectDetail>
  updateProjectContentType(projectId: string, contentTypeId: string): Promise<ProjectDetail>
  updateProjectPlatforms(projectId: string, platformTargets: string[]): Promise<ProjectDetail>
  saveProjectTemplate(input: SaveProjectTemplateInput): Promise<ProjectTemplateDefinition>
  previewProjectTemplate(projectId: string, templateId: string | null): Promise<ProjectTemplateDiff>
  applyProjectTemplate(projectId: string, templateId: string | null): Promise<ProjectDetail>
  setProjectModule(projectId: string, moduleKey: OptionalProjectModuleKey, enabled: boolean): Promise<ProjectDetail>
  reorderProjectModules(projectId: string, moduleKeys: OptionalProjectModuleKey[]): Promise<ProjectDetail>
  setModuleCompleted(projectId: string, moduleKey: ProjectModuleKey, completed: boolean): Promise<StageTimeMutationResult>
  getStageTimeContext(): Promise<StageTimeContext>
  updateStageTime(projectId: string, stageKey: StageTimeKey, patch: { startNow?: true; startedAt?: StageTimePoint | null; completedAt?: StageTimePoint | null; actualEffortHalfDayUnits?: number | null; planEdit?: StagePlanEdit; source: 'manual' | 'backfill' }, requestId?: string): Promise<StageTimeUpdateResult>
  setStageTimeStatus(projectId: string, stageKey: StageTimeKey, action: 'skip' | 'reopen'): Promise<StageTimeMutationResult>
  undoStageTimeEvent(projectId: string, eventId: string): Promise<StageTimeMutationResult>
  getCreationReport(kind: CreationReportKind, anchorDate: string, force?: boolean): Promise<CreationReportSnapshot>
  listCreationReportSnapshots(kind?: CreationReportKind, periodStart?: string): Promise<CreationReportSnapshotSummary[]>
  getCreationReportSnapshotById(snapshotId: string): Promise<CreationReportSnapshot>
  getProjectCreationReview(projectId: string): Promise<ProjectCreationReview>
  getCreationReportConversation(snapshotId: string): Promise<CreationReportConversation>
  sendCreationReportMessage(snapshotId: string, provider: 'codex_cli' | 'claude_cli', message: string): Promise<TaskRun>
  getScriptRevisionConversation(projectId: string, threadId?: string | null, provider?: ScriptRevisionProvider | null, surface?: import('./domain').ScriptRevisionSurface): Promise<ScriptRevisionConversation>
  sendScriptRevisionMessage(input: {
    projectId: string
    threadId?: string | null
    surface?: import('./domain').ScriptRevisionSurface
    baseVersionId?: string | null
    currentDocumentContent: string
    includeProjectContext: boolean
    provider: 'codex_cli' | 'claude_cli'
    preferredModel?: string | null
    preferredReasoningEffort?: string | null
    sourceSelections?: import('./domain').ContentSourceSelectionSnapshot[]
    webSearchMode?: 'automatic' | 'required' | 'disabled'
    message: string
    selection: Omit<ScriptRevisionSelectionSnapshot, 'baseVersionId' | 'selectionHash'>
  }): Promise<TaskRun>
  validateScriptRevisionApply(projectId: string, messageId: string, currentText: string): Promise<ScriptRevisionApplyValidation>
  setScriptRevisionSuggestionStatus(projectId: string, messageId: string, status: ScriptRevisionSuggestionStatus): Promise<ScriptRevisionMessage>
  loadProjectCurrentScript(projectId: string): Promise<ProjectCurrentScriptLoadResult>
  initializeProjectCurrentScript(input: InitializeProjectCurrentScriptInput): Promise<ProjectCurrentScriptLoadResult>
  applyProjectCurrentScriptTransaction(input: ApplyProjectCurrentScriptInput): Promise<ApplyProjectCurrentScriptResult>
  saveProjectCurrentScriptVersion(input: SaveProjectCurrentScriptVersionInput): Promise<SaveProjectCurrentScriptVersionResult>
  restoreProjectCurrentScriptVersion(input: RestoreProjectCurrentScriptVersionInput): Promise<RestoreProjectCurrentScriptVersionResult>
  getCurrentScriptVersionSnapshot(projectId: string, versionId: string): Promise<import('./domain').ProjectCurrentScriptSnapshot | null>
  listCurrentScriptRecoveryCandidates(projectId: string): Promise<CurrentScriptRecoveryCandidate[]>
  resolveCurrentScriptRecovery(input: ResolveCurrentScriptRecoveryInput): Promise<ResolvedCurrentScriptRecovery>
  listSourceScriptAnnotations(projectId: string, query?: {
    sourceKind?: 'material_draft' | 'comparison_source' | 'comparison_candidate' | 'draft_version'
    sourceId?: string
    sourceVersion?: string
  }): Promise<import('./domain').ScriptTextAnnotation[]>
  upsertSourceScriptAnnotation(input: import('./domain').SourceScriptTextAnnotationInput): Promise<import('./domain').ScriptTextAnnotation>
  deleteSourceScriptAnnotation(projectId: string, annotationId: string): Promise<boolean>
  getScriptMaterialWorkspace(projectId: string): Promise<ScriptMaterialWorkspace>
  saveScriptMaterialWorkspace(projectId: string, patch: {
    workingContent?: string
    requirement?: string
    aiCount?: 1 | 2
    selectedAiSide?: 'codex' | 'claude'
    selectedCodexDraftId?: string | null
    selectedClaudeDraftId?: string | null
    webSearchMode?: 'automatic' | 'required' | 'disabled'
  }): Promise<ScriptMaterialWorkspace>
  createScriptMaterialRevision(projectId: string): Promise<ScriptMaterialWorkspace>
  replaceScriptMaterialPoints(projectId: string, revisionId: string, points: Array<{
    id?: string
    sourceStart: number
    sourceEnd: number
    sourceText: string
    summary: string
    requirement?: string
    adoption?: ScriptMaterialPointAdoption
  }>): Promise<ScriptMaterialWorkspace>
  confirmScriptMaterialPoints(projectId: string, revisionId: string): Promise<ScriptMaterialWorkspace>
  updateScriptMaterialPoint(projectId: string, revisionId: string, pointId: string, patch: {
    summary?: string
    requirement?: string
    adoption?: ScriptMaterialPointAdoption
  }): Promise<ScriptMaterialWorkspace>
  confirmScriptMaterialAnnotations(projectId: string, draftId: string, paragraphId: string, annotationIds: string[]): Promise<ScriptMaterialWorkspace>
  setScriptMaterialManualMarks(projectId: string, draftId: string, paragraphId: string, marks: ScriptMaterialManualMark[]): Promise<ScriptMaterialWorkspace>
  startScriptMaterialExtraction(projectId: string, providerConfigId: string, includeProjectContext: boolean): Promise<TaskRun>
  startScriptMaterialGeneration(projectId: string, side: 'codex' | 'claude', providerConfigId: string, includeProjectContext: boolean): Promise<TaskRun>
  startScriptMaterialAudit(projectId: string, target: 'codex' | 'claude' | 'current', providerConfigId: string, currentContent?: string, draftId?: string, currentParagraphs?: Array<{ id: string; position: number; text: string }>): Promise<TaskRun>
  setScriptMaterialAllowedOmissions(projectId: string, targetIdentity: string, pointIds: string[]): Promise<ScriptMaterialWorkspace>
  confirmScriptMaterialFinding(projectId: string, targetIdentity: string, findingId: string, resolutionNote: string): Promise<ScriptMaterialWorkspace>
  getScriptMaterialFinalizationGate(projectId: string, currentContent: string): Promise<ScriptMaterialFinalizationGate>
  getScriptMaterialVersionSnapshot(projectId: string, versionId: string): Promise<ScriptMaterialVersionSnapshot | null>
  restoreScriptMaterialVersionSnapshot(projectId: string, versionId: string): Promise<ScriptMaterialWorkspace>
  startScriptMaterialMapping(projectId: string, draftId: string, providerConfigId: string, currentDocumentParagraphs?: Array<{ id: string; position: number; text: string }>): Promise<TaskRun>
  getDraftComparisonWorkspace(projectId: string, sessionId?: string | null): Promise<DraftComparisonWorkspace>
  saveDraftComparisonDrafts(projectId: string, patch: { claudeContent?: string; codexContent?: string }): Promise<DraftComparisonWorkspace>
  setDraftComparisonCurrentDocumentBase(projectId: string, revision: number, contentHash: string): Promise<DraftComparisonWorkspace>
  generateDraftSource(input: { projectId: string; side: 'claude' | 'codex'; requirement: string; providerConfigId: string; includeProjectContext: boolean }): Promise<TaskRun>
  startDraftAlignment(projectId: string, providerConfigId: string, includeProjectContext: boolean, options?: { useOutline?: boolean; confirmFull?: boolean }): Promise<TaskRun>
  addFreeformDraftCandidate(projectId: string, groupId: string, content: string, requirement?: string): Promise<DraftCandidateRevision>
  deleteDraftCandidate(projectId: string, candidateId: string): Promise<DraftComparisonWorkspace>
  moveDraftCandidate(projectId: string, candidateId: string, toGroupId: string): Promise<DraftComparisonWorkspace>
  reorderDraftCandidates(projectId: string, groupId: string, candidateIds: string[]): Promise<DraftComparisonWorkspace>
  setDraftGroupDecision(input: { projectId: string; groupId: string; kind: DraftGroupDecisionKind; sourceId?: string | null; sourceIds?: string[]; content?: string }): Promise<DraftComparisonWorkspace>
  setDraftGroupNote(projectId: string, groupId: string, note: string): Promise<DraftComparisonWorkspace>
  setDraftGroupMarkers(projectId: string, groupId: string, markers: DraftGroupDecision['markers']): Promise<DraftComparisonWorkspace>
  mergeDraftAlignmentGroups(projectId: string, groupIds: string[]): Promise<DraftComparisonWorkspace>
  splitDraftAlignmentGroup(input: { projectId: string; groupId: string; firstClaudeParagraphIds: string[]; firstCodexParagraphIds: string[] }): Promise<DraftComparisonWorkspace>
  startDraftAlignmentSplit(input: {
    projectId: string
    groupId: string
    side: 'claude' | 'codex'
    paragraphIds: string[]
    strategy: DraftComparisonSplitStrategy
    scope: DraftComparisonSplitScope
  }): Promise<DraftAlignmentSplitStartResult>
  reorderDraftAlignmentGroups(projectId: string, groupIds: string[]): Promise<DraftComparisonWorkspace>
  moveDraftParagraph(input: { projectId: string; side: 'claude' | 'codex'; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }): Promise<DraftComparisonWorkspace>
  moveDraftParagraphs(input: {
    projectId: string
    moves: Array<{ side: 'claude' | 'codex'; paragraphId: string; fromGroupId: string; toGroupId: string; toIndex?: number }>
  }): Promise<DraftComparisonWorkspace>
  listDraftComparisonHistory(projectId: string): Promise<DraftComparisonHistoryEntry[]>
  restoreDraftComparisonHistory(projectId: string, historyId: string): Promise<DraftComparisonWorkspace>
  updateProjectDescription(projectId: string, description: string): Promise<ProjectDetail>
  saveOutline(projectId: string, items: { id: string; text: string }[], parentVersionIds?: string[], outline?: { id: string; name: string }): Promise<DraftVersion>
  setActiveOutlineVersion(projectId: string, versionId: string): Promise<ProjectDetail>
  startOutlineGeneration(input: { projectId: string; briefText: string; ideas: string; structure: { name: string; items: string[] }; supportingMaterialIds?: string[] }): Promise<TaskRun[]>
  saveScript(projectId: string, kind: 'merged_draft' | 'final' | 'user_edit', content: string, sourceVersionId?: string, displayName?: string): Promise<DraftVersion>
  saveAndFinalizeScript(projectId: string, content: string, sourceVersionId?: string, displayName?: string): Promise<DraftVersion>
  exportScriptWord(projectId: string, title: string, html: string): Promise<{ canceled: boolean; path: string | null }>
  listFeishuHandoffs(projectId: string): Promise<FeishuHandoffRecord[]>
  copyFeishuHandoff(input: { id: string; projectId: string; sourceVersionId: string; targetHandoffId: string | null; mode: FeishuHandoffRecord['mode']; accountName: string; documentUrl: string | null }): Promise<FeishuHandoffRecord>
  exportFeishuHandoffWord(input: { id: string; projectId: string; sourceVersionId: string; targetHandoffId: string | null; mode: FeishuHandoffRecord['mode']; accountName: string; documentUrl: string | null }): Promise<{ canceled: boolean; path: string | null; record: FeishuHandoffRecord | null }>
  saveFeishuHandoffLink(input: { id: string; projectId: string; sourceVersionId: string; targetHandoffId: string | null; mode: FeishuHandoffRecord['mode']; accountName: string; documentUrl: string | null }): Promise<FeishuHandoffRecord>
  openFeishuHandoff(projectId: string, handoffId: string): Promise<FeishuHandoffRecord>
  getNasArchiveDestination(): Promise<NasArchiveDestinationStatus>
  chooseNasArchiveDestination(): Promise<NasArchiveDestinationStatus>
  clearNasArchiveDestination(): Promise<NasArchiveDestinationStatus>
  setNasArchiveCategoryLabels(labels: Record<ArchiveCategory, string>): Promise<NasArchiveDestinationStatus>
  chooseNasArchiveSlotFile(projectId: string, slot: Extract<ArchiveSlot, 'landscape_cover' | 'portrait_cover' | 'video_clean' | 'video_burned_in'>): Promise<boolean>
  setNasArchiveSlotStatus(projectId: string, slot: ArchiveSlot, status: Extract<ArchiveSelectionStatus, 'not_required' | 'not_ready'> | 'automatic'): Promise<boolean>
  prepareNasArchivePlan(projectId: string, category: ArchiveCategory): Promise<ArchivePlan>
  confirmNasArchivePlan(planId: string, planHash: string): Promise<ArchiveRun>
  listNasArchiveRuns(projectId: string): Promise<ArchiveRun[]>
  getNasArchiveRun(runId: string): Promise<ArchiveRun>
  cancelNasArchiveRun(runId: string): Promise<ArchiveRun>
  retryNasArchiveRun(runId: string): Promise<ArchiveRun>
  getNasBackupStatus(): Promise<NasBackupStatus>
  runNasBackup(): Promise<NasBackupStatus>
  setFinalVersion(projectId: string, versionId: string): Promise<DraftVersion>
  confirmStylePreference(projectId: string, sourceVersionId: string, finalVersionId: string, note: string): Promise<StylePreferenceEntry>
  importScript(projectId: string): Promise<ImportedDraftResult>
  importScriptFile(projectId: string, name: string, bytes: Uint8Array): Promise<ImportedDraftResult>
  createLinkGroup(input: Omit<LinkGroupRecord, 'id' | 'createdAt' | 'matchType'>): Promise<LinkGroupRecord>
  listLinkGroups(projectId: string, mergedVersionId: string): Promise<LinkGroupRecord[]>
  deleteLinkGroup(projectId: string, linkGroupId: string): Promise<boolean>
  getCaptureContext(preferredProjectId?: string | null, preferredCaptureKind?: 'project_content' | 'client_feedback' | null): Promise<CaptureContext>
  saveCapture(input: Pick<CaptureRecord, 'captureKind' | 'primaryProjectId' | 'originalContent'>): Promise<CaptureRecord>
  startCaptureClassification(): Promise<TaskRun | null>
  deduplicateCapturesExact(): Promise<CaptureDeduplicationResult>
  confirmCaptureClassification(captureId: string, projectId: string | null, contentTypeId: string | null, captureKind?: 'topic_idea' | 'project_content' | 'general_record', generalCategoryId?: string | null): Promise<CaptureRecord>
  undoCaptureClassification(captureId: string): Promise<CaptureRecord>
  listCaptureDestinationCandidates(captureId: string): Promise<CaptureDestinationCandidate[]>
  setCaptureUseStatus(captureId: string, useStatus: CaptureRecord['useStatus']): Promise<CaptureRecord>
  attachCaptureToTopic(captureId: string, topicId: string): Promise<CaptureRecord>
  createGeneralRecordCategory(name: string): Promise<GeneralRecordCategory>
  updateGeneralRecordCategory(generalCategoryId: string, patch: { name?: string; description?: string; isActive?: boolean }): Promise<GeneralRecordCategory>
  createTopic(input: CreateTopicInput): Promise<TopicRecord>
  updateTopic(topicId: string, patch: UpdateTopicInput): Promise<TopicRecord>
  createProjectFromTopic(topicId: string): Promise<ProjectDetail>
  createTopicStage(name: string): Promise<TopicStageDefinition>
  updateTopicStage(stageId: string, name: string, nextActionLabel?: string | null): Promise<TopicStageDefinition>
  reorderTopicStages(stageIds: string[]): Promise<TopicStageDefinition[]>
  deleteTopicStage(stageId: string): Promise<TopicStageDeleteResult>
  createTopicColumn(name: string, dataType: Extract<TopicColumnDataType, 'text' | 'number' | 'date'>): Promise<TopicColumnDefinition>
  updateTopicColumn(columnId: string, patch: { name?: string; isVisible?: boolean }): Promise<TopicColumnDefinition>
  reorderTopicColumns(columnIds: string[]): Promise<TopicColumnDefinition[]>
  deleteTopicColumn(columnId: string): Promise<TopicColumnDefinition[]>
  setTopicCustomValue(topicId: string, columnId: string, value: string | null): Promise<TopicRecord>
  trashTopic(topicId: string): Promise<TopicRecord>
  restoreTopic(topicId: string): Promise<TopicRecord>
  permanentlyDeleteTopic(topicId: string): Promise<boolean>
  permanentlyDeleteCapture(captureId: string): Promise<boolean>
  restoreFilterCandidate(candidateId: string): Promise<ConversationFilterCandidate>
  permanentlyDeleteFilterCandidate(candidateId: string): Promise<boolean>
  emptyRecycleBin(): Promise<RecycleEmptyResult>
  revealProjectFolder(projectId: string): Promise<boolean>
  createContentType(name: string): Promise<ContentTypeDefinition>
  updateContentType(contentTypeId: string, patch: { name?: string; description?: string; isActive?: boolean }): Promise<ContentTypeDefinition>
  reorderContentTypes(contentTypeIds: string[]): Promise<ContentTypeDefinition[]>
  saveBusinessTrip(input: BusinessTripSaveInput): Promise<ScheduleItem>
  createSchedule(input: CreateScheduleInput): Promise<ScheduleItem>
  createScheduleBatch(inputs: CreateScheduleInput[], requestId?: string): Promise<ScheduleItem[]>
  updateSchedule(scheduleId: string, patch: { title?: string; actionType?: ScheduleItem['actionType'] }): Promise<ScheduleItem>
  moveSchedule(scheduleId: string, startAt: string | null, endAt: string | null): Promise<ScheduleItem>
  setScheduleState(scheduleId: string, state: ScheduleItem['state']): Promise<ScheduleItem>
  setScheduleColor(scheduleId: string, colorToken: ProjectColorToken): Promise<ScheduleItem>
  deleteSchedule(scheduleId: string): Promise<boolean>
  getTodoStageStartCandidate(todoId: string): Promise<TodoStageStartCandidate | null>
  confirmTodoStageStart(input: TodoStageStartInput): Promise<boolean>
  getTodoProjectStages(projectId: string): Promise<TodoProjectStage[]>
  setTodoLinkedStageCompleted(input: TodoStageCompletionInput): Promise<boolean>
  setTodoLinkedStageTime(input: TodoStageTimeInput): Promise<boolean>
  writeTodoDay(input: TodoDayWrite): Promise<TodoDay>
  createTodoBatch(inputs: CreateTodoInput[]): Promise<TodoItem[]>
  moveTodoInTime(input: TodoTimeMoveInput): Promise<boolean>
  copyTodosToToday(input: TodoCopyToTodayInput): Promise<TodoCopyResult>
  undoTodoCopy(operationId: string): Promise<WorkspaceUndoResult>
  batchLinkTodos(input: TodoBatchLinkInput): Promise<TodoItem[]>
  updateTodo(todoId: string, patch: UpdateTodoInput): Promise<TodoItem>
  dismissTodo(todoId: string): Promise<boolean>
  resizeScheduleWindow(height: number): Promise<void>
  closeScheduleWindow(): Promise<void>
  openScheduleMainWindow(day: string): Promise<void>
  onScheduleNavigate(listener: (day: string) => void): () => void
  getDailyWorkLog(day: string): Promise<DailyWorkLog>
  setDailyWorkLogTotal(day: string, totalMinutes: number, expected: Pick<DailyWorkLog, 'selfMediaMinutes' | 'aiMinutes' | 'otherWorkMinutes' | 'totalMinutes'>): Promise<DailyWorkLog>
  adjustDailyWorkLog(day: string, field: 'selfMediaMinutes' | 'aiMinutes' | 'otherWorkMinutes', deltaMinutes: number): Promise<DailyWorkLog>
  setDailyWorkLog(day: string, input: Pick<DailyWorkLog, 'selfMediaMinutes' | 'aiMinutes' | 'otherWorkMinutes'>, expected?: Pick<DailyWorkLog, 'selfMediaMinutes' | 'aiMinutes' | 'otherWorkMinutes' | 'totalMinutes'>): Promise<DailyWorkLog>
  listResources(): Promise<ResourceRecord[]>
  importOutlineTemplateFile(name: string, bytes: Uint8Array): Promise<ResourceRecord>
  deleteOutlineTemplate(resourceId: string): Promise<boolean>
  saveProjectTextMaterial(projectId: string, role: ProjectMaterialRole, title: string, textContent: string): Promise<ProjectMaterialRecord>
  saveProjectFramework(projectId: string, markdown: string): Promise<ProjectMaterialRecord>
  saveProjectScratchNote(projectId: string, noteId: string | null, title: string, markdown: string): Promise<ProjectMaterialRecord>
  importProjectPdfMaterial(projectId: string, role: ProjectMaterialRole, title: string, name: string, bytes: Uint8Array): Promise<ProjectMaterialRecord>
  importProjectPdfMaterialFromFile(projectId: string, role: ProjectMaterialRole, title: string, file: File): Promise<ProjectMaterialRecord>
  chooseProjectAssetSources(projectId: string, role: ProjectMaterialRole, usageType: ProjectAssetUsageType | null): Promise<ProjectAssetImportBatchResult>
  importProjectAssetFiles(projectId: string, role: ProjectMaterialRole, usageType: ProjectAssetUsageType | null, files: File[]): Promise<ProjectAssetImportBatchResult>
  saveProjectLinkMaterial(projectId: string, role: ProjectMaterialRole, title: string, sourceUrl: string): Promise<ProjectMaterialRecord>
  openProjectMaterial(projectId: string, materialId: string): Promise<'source' | 'managed' | 'link'>
  getProjectMaterialPreview(projectId: string, materialId: string): Promise<{ kind: 'image' | 'pdf' | 'unsupported'; dataUrl: string | null; mimeType: string }>
  deleteProjectMaterial(projectId: string, materialId: string): Promise<boolean>
  saveProjectPrimaryReferences(
    projectId: string,
    referenceRequirements: string,
    references: { linkId: string; attentionNote: string }[],
    materialReferences?: { materialId: string; attentionNote: string }[]
  ): Promise<ProjectDetail>
  startProjectMaterialResearch(projectId: string, requestedTitle: string, request: string): Promise<TaskRun>
  getProjectMaterialResearch(projectId: string, researchId?: string | null): Promise<MaterialResearchSession>
  saveProjectMaterialResearch(projectId: string, researchId: string, title: string, claimIds: string[]): Promise<ProjectMaterialRecord>
  getProjectGenerationContext(projectId: string, supportingMaterialIds?: string[]): Promise<ProjectGenerationContext>
  extractBusinessScreenshot(projectId: string | null, name: string, bytes: Uint8Array): Promise<BusinessAutofillResult>
  extractBusinessText(projectId: string | null, text: string): Promise<BusinessAutofillResult>
  openBusinessImportLink(url: string): Promise<boolean>
  captureBusinessImportLink(): Promise<{ url: string; title: string; text: string }>
  getBusinessProjectData(projectId: string): Promise<BusinessProjectData>
  patchBusinessRecord(projectId: string, patch: BusinessRecordPatch): Promise<BusinessProjectData>
  saveBusinessRecord(projectId: string, input: BusinessRecordInput): Promise<BusinessProjectData>
  saveStandaloneBusinessLedgerEntry(ledgerId: string | null, title: string, input: BusinessRecordInput): Promise<BusinessLedgerEntry>
  saveStandaloneBusinessLedgerEntriesBatch(items: Array<{ title: string; record: BusinessRecordInput }>): Promise<BusinessLedgerEntry[]>
  listTrashedBusinessLedgerEntries(): Promise<BusinessLedgerEntry[]>
  trashBusinessLedgerEntry(projectId: string): Promise<boolean>
  restoreBusinessLedgerEntry(projectId: string): Promise<boolean>
  permanentlyDeleteBusinessLedgerEntry(projectId: string): Promise<boolean>
  relinkBusinessLedgerEntry(sourceProjectId: string, targetProjectId: string): Promise<BusinessLedgerEntry>
  scanBusinessFolder(): Promise<BusinessFolderScanResult>
  importBusinessFolderCandidates(projectId: string, scanId: string, candidateIds: string[]): Promise<BusinessProjectData>
  getBusinessLedgerLockStatus(): Promise<BusinessLedgerLockStatus>
  enableBusinessLedgerLock(password: string): Promise<BusinessLedgerLockStatus>
  disableBusinessLedgerLock(password: string): Promise<BusinessLedgerLockStatus>
  unlockBusinessLedgerWithPassword(password: string): Promise<BusinessLedgerLockStatus>
  unlockBusinessLedgerWithTouchId(): Promise<BusinessLedgerLockStatus>
  lockBusinessLedger(): Promise<BusinessLedgerLockStatus>
  saveRebatePayment(projectId: string, paymentId: string | null, input: { amountCents: number; paidDate: string; notes: string }): Promise<BusinessProjectData>
  deleteRebatePayment(projectId: string, paymentId: string): Promise<BusinessProjectData>
  saveBusinessInvoice(projectId: string, invoiceId: string | null, input: { issuerName?: string; amountCents: number; issuedDate: string | null; status: InvoiceStatus; deliveredToClient: boolean; notes: string; linkedProjectIds?: string[] }): Promise<BusinessProjectData>
  deleteBusinessInvoice(projectId: string, invoiceId: string): Promise<BusinessProjectData>
  importBusinessFile(projectId: string, role: BusinessFileRole, name: string, bytes: Uint8Array, options?: { rebatePaymentId?: string | null; invoiceId?: string | null; linkedProjectIds?: string[] }): Promise<BusinessProjectData>
  setBusinessFileProjects(projectId: string, businessFileId: string, projectIds: string[]): Promise<BusinessProjectData>
  deleteBusinessFile(projectId: string, businessFileId: string): Promise<BusinessProjectData>
  revealBusinessFile(projectId: string, businessFileId: string): Promise<boolean>
  saveOtherIncomeCategory(categoryId: string | null, input: { name: string; description: string; isActive: boolean }): Promise<OtherIncomeCategory>
  reorderOtherIncomeCategories(categoryIds: string[]): Promise<OtherIncomeCategory[]>
  patchOtherIncomeRecord(recordId: string, patch: OtherIncomeRecordPatch): Promise<OtherIncomeRecord>
  saveOtherIncomeRecord(recordId: string | null, input: OtherIncomeRecordInput): Promise<OtherIncomeRecord>
  saveOtherIncomeRecordsBatch(records: OtherIncomeRecordInput[]): Promise<OtherIncomeRecord[]>
  importOtherIncomeAttachment(recordIds: string[], name: string, bytes: Uint8Array): Promise<OtherIncomeRecord[]>
  listTrashedOtherIncomeRecords(): Promise<OtherIncomeRecord[]>
  trashOtherIncomeRecord(recordId: string): Promise<boolean>
  restoreOtherIncomeRecord(recordId: string): Promise<boolean>
  permanentlyDeleteOtherIncomeRecord(recordId: string): Promise<boolean>
  saveOtherIncomeCompanyAlias(companyName: string, alias: string): Promise<OtherIncomeCompanyAlias>
  deleteOtherIncomeCompanyAlias(aliasId: string): Promise<boolean>
  saveOtherIncomeImportRule(ruleId: string | null, name: string, instruction: string, conditions: OtherIncomeImportRuleConditions): Promise<OtherIncomeImportRule>
  deleteOtherIncomeImportRule(ruleId: string): Promise<boolean>
  previewOtherIncomeImport(input: { sourceName: string; mimeType: string; text?: string; bytes?: Uint8Array; instruction: string; categoryId: string | null; today: string; conditions?: OtherIncomeImportRuleConditions }): Promise<{ conditions: OtherIncomeImportRuleConditions; candidates: OtherIncomeImportCandidate[]; errors: string[] }>
  savePublishingTextMaterial(projectId: string, platform: string, materialKind: Extract<PublishingMaterial['materialKind'], 'title' | 'description' | 'tags'>, textValue: string): Promise<PublishingMaterial>
  preparePublishingDraft(projectId: string, platform: string): Promise<PublishingDraft>
  importPublishingFileMaterial(projectId: string, platform: string, materialKind: Extract<PublishingMaterial['materialKind'], 'cover' | 'subtitle'>, name: string, bytes: Uint8Array): Promise<PublishingMaterial>
  choosePublishingVideo(projectId: string, platform: string): Promise<PublishingMaterial | null>
  revealPublishingMaterial(projectId: string, platform: string, materialKind: Extract<PublishingMaterial['materialKind'], 'cover' | 'subtitle' | 'video'>): Promise<boolean>
  getPublishingAccountState(projectId?: string | null): Promise<PublishingAccountState>
  savePublishingAccount(input: { accountId?: string | null; platform: string; accountName: string; positioning: string; phone?: string | null; email?: string | null; clearContact?: boolean }): Promise<PublishingAccount>
  setPublishingAccountStatus(accountId: string, status: PublishingAccount['status']): Promise<PublishingAccount>
  selectPublishingAccount(projectId: string, platform: string, accountId: string): Promise<PublishingAccountState>
  startCoverGeneration(input: { projectId: string; platform: string; layout: 'bilibili_landscape' | 'xiaohongshu_portrait'; generationMode: 'ai_finished' | 'stable_layers'; batchCount: number; headline: string; materialLinkIds: string[]; groupNote: string }): Promise<TaskRun[]>
  getCoverCandidatePreview(projectId: string, candidateId: string): Promise<string>
  selectCoverCandidate(projectId: string, candidateId: string): Promise<PublishingMaterial>
  startSubtitleGeneration(projectId: string, schema: 'zh' | 'bilingual', confirmedJobId?: string): Promise<TaskRun | null>
  revealSubtitleArtifact(projectId: string, artifactId: string): Promise<boolean>
  confirmSubtitleArtifact(projectId: string, artifactId: string): Promise<SubtitleJob>
  useSubtitleArtifact(projectId: string, artifactId: string, platform: string): Promise<PublishingMaterial>
  startTitleGeneration(projectId: string, platform: string, options?: { mode?: 'master' | 'platform_adaptation'; masterTitle?: string; instruction?: string }): Promise<TaskRun[]>
  selectTitleCandidate(projectId: string, candidateId: string): Promise<PublishingMaterial>
  preparePublishingHandoff(projectId: string, platform: string): Promise<PublishingHandoff>
  openPublishingHandoff(handoffId: string): Promise<PublishingHandoff>
  confirmPublishingHandoff(handoffId: string): Promise<PublishingHandoff>
  copyPublishingHandoffField(handoffId: string, field: 'title' | 'description' | 'tags'): Promise<boolean>
  startPublishingComputerUsePilot(handoffId: string): Promise<PublishingComputerUsePilot>
  markPublishingComputerUsePilotReady(pilotId: string): Promise<PublishingComputerUsePilot>
  stopPublishingComputerUsePilot(pilotId: string, status: 'failed' | 'canceled', message?: string): Promise<PublishingComputerUsePilot>
  listDistributionBatches(): Promise<DistributionBatch[]>
  createDistributionBatch(input: { title: string; sourceKind: DistributionBatch['sourceKind']; sourceProjectId: string | null; sourceText: string }): Promise<DistributionBatch>
  startDistributionAnalysis(batchId: string, providerConfigId: string): Promise<TaskRun>
  createDistributionSegment(batchId: string): Promise<DistributionBatch>
  updateDistributionSegment(input: { batchId: string; segmentId: string; startTimecode: string; endTimecode: string; theme: string; summary: string }): Promise<DistributionBatch>
  linkDistributionFiles(batchId: string, files?: File[], segmentId?: string): Promise<DistributionBatch | null>
  replaceDistributionTargets(batchId: string, segmentId: string, accountIds: string[]): Promise<DistributionBatch>
  setDistributionTargetStatus(batchId: string, targetId: string, status: 'pending' | 'published' | 'skipped', note: string): Promise<DistributionBatch>
  completeDistributionBatch(batchId: string, force: boolean): Promise<DistributionCompletionResult>
  reopenDistributionBatch(batchId: string): Promise<DistributionBatch>
  openDistributionFile(batchId: string, segmentId: string): Promise<boolean>
  revealDistributionFile(batchId: string, segmentId: string): Promise<boolean>
  setProjectResourceReference(projectId: string, resourceId: string, enabled: boolean, role?: ProjectResourceRole, selectionSource?: ResourceSelectionSource): Promise<ProjectResourceReference>
  prepareTaskResources(projectId: string, options?: { taskContentTypeId?: string; taskTemplateId?: string | null; excludedRecommendedResourceIds?: string[]; manualResourceIds?: string[]; supportingMaterialIds?: string[] }): Promise<TaskResourcePreparation>
  getContentEngine(): Promise<ContentEngineSnapshot>
  importContentSource(input: { sourceKind: ContentSourceKind; title: string; scopeLabel: string; rawContent: string }): Promise<ContentSourceImportResult>
  listConversationSources(query?: { text?: string; source?: ConversationHistorySource; limit?: number }): Promise<ConversationMetadataResult>
  prepareConversationSelection(input: { ids: string[]; customSensitiveTerms?: string[] }): Promise<ConversationSelectionPreview>
  startConversationFilter(input: { ids: string[]; customSensitiveTerms?: string[]; provider: 'codex_cli' | 'claude_cli' }): Promise<TaskRun>
  getConversationScanPlan(input: { mode: 'deep' | 'incremental'; sourceScope: 'codex' | 'claude' | 'both' }): Promise<ConversationScanPlan>
  prepareConversationScan(input: { mode: 'deep' | 'incremental'; sourceScope: 'codex' | 'claude' | 'both'; provider?: 'codex_cli' | 'claude_cli'; providerConfigId?: string; customSensitiveTerms?: string[]; budgetTokenLimit?: number | null }): Promise<ConversationScanPreflight>
  getConversationScanPreflightBatch(preflightId: string, batchIndex: number): Promise<ConversationScanPreflightBatch>
  startConversationScan(preflightId: string): Promise<ConversationScanStartResult>
  getConversationScanProgress(scanId?: string | null): Promise<ConversationScanProgress>
  pauseConversationScan(scanId: string): Promise<ConversationScanProgress>
  resumeConversationScan(scanId: string): Promise<ConversationScanProgress>
  listConversationFilterCandidates(taskId?: string): Promise<ConversationFilterCandidate[]>
  setConversationFilterCandidateStatus(candidateId: string, status: ConversationFilterCandidate['status']): Promise<ConversationFilterCandidate>
  routeConversationFilterCandidate(candidateId: string, destination: ConversationFilterDestinationInput): Promise<ConversationFilterDestinationResult>
  decideConversationFilterCandidate(candidateId: string, decision: ConversationFilterDecisionInput): Promise<ConversationFilterBatchDecisionResult>
  confirmConversationFilterCandidates(candidateIds: string[]): Promise<ConversationFilterBatchDecisionResult>
  permanentlyDeleteConversationFilterCandidate(candidateId: string): Promise<boolean>
  setContentAtomStatus(atomId: string, status: Exclude<ContentAtomStatus, 'merged'>): Promise<ContentAtomRecord>
  mergeContentAtoms(atomIds: string[], title?: string): Promise<ContentAtomRecord>
  prepareContentDerivation(options?: { contentTypeId?: string; templateId?: string | null; excludedRecommendedResourceIds?: string[]; manualResourceIds?: string[] }): Promise<ContentDerivationPreparation>
  createContentDerivative(input: { atomIds: string[]; outputType: ContentDerivativeType; contentTypeId?: string; templateId?: string | null; excludedRecommendedResourceIds?: string[]; manualResourceIds?: string[] }): Promise<ContentDerivativeRecord>
  confirmContentDerivative(candidateId: string, currentContent: string): Promise<ContentDerivativeRecord>
  copyContentDerivative(candidateId: string): Promise<boolean>
  createProjectFromContentDerivative(candidateId: string, input: { title: string; contentTypeId: string; templateId: string | null }): Promise<ProjectDetail>
  createTask(input: { taskType: 'mock_demo' | 'draft_generation'; projectId: string | null; title: string; provider: 'mock' | 'codex_cli' | 'claude_cli'; input: string; taskContentTypeId?: string; taskTemplateId?: string | null; excludedRecommendedResourceIds?: string[]; manualResourceIds?: string[]; supportingMaterialIds?: string[] }): Promise<TaskRun>
  cancelTask(taskId: string): Promise<TaskRun>
  dismissTask(taskId: string): Promise<TaskRun>
  retryTask(taskId: string): Promise<TaskRun>
  retryTaskWithFallback(taskId: string): Promise<TaskRun>
  confirmTask(taskId: string): Promise<TaskRun>
  validateProviderSecurity(provider: 'codex_cli' | 'claude_cli'): Promise<ProviderCapability>
  getProviderSettings(): Promise<ProviderSettings>
  saveExternalProviderConfig(input: ExternalProviderConfigInput): Promise<ExternalProviderConfig>
  deleteExternalProviderConfig(id: string): Promise<boolean>
  validateExternalProviderConfig(id: string): Promise<ExternalProviderConfig>
  setProviderRouting(defaultProviderConfigId: string, fallbackProviderConfigId: string | null): Promise<ProviderSettings>
  listExternalFileRelations(): Promise<ExternalFileRelation[]>
  getWorkspaceV2Access(deviceId: string): Promise<WorkspaceAccessState>
  updateWorkspaceV2Access(input: WorkspaceAccessUpdate): Promise<WorkspaceAccessState>
  getMobileSyncStatus(): Promise<MobileSyncStatus>
  setMobileSyncEnabled(enabled: boolean): Promise<MobileSyncStatus>
  approveMobileSyncPairing(sessionId: string): Promise<MobileSyncStatus>
  rejectMobileSyncPairing(sessionId: string): Promise<MobileSyncStatus>
  revokeMobileSyncDevice(deviceId: string): Promise<MobileSyncStatus>
  setPreferences(patch: Partial<WorkspacePreferences>): Promise<WorkspacePreferences>
  getWorkbenchPreferences(projectId: string): Promise<WorkbenchPreferences>
  setWorkbenchPreferences(projectId: string, patch: Partial<WorkbenchPreferences>): Promise<WorkbenchPreferences>
  getProjectProductionNotes(projectId: string): Promise<ProjectProductionNotes>
  setProjectProductionNotes(projectId: string, input: Pick<ProjectProductionNotes, 'shootingItems' | 'editingNotes' | 'editingNotesFormat'> & { scope?: 'shooting' | 'editing' }): Promise<ProjectProductionNotes>
  onAppearanceChanged(listener: (appearance: AppearanceSnapshot) => void): () => void
  onWorkspaceChanged(listener: () => void): () => void
  onCaptureActivated(listener: () => void): () => void
  onWorkbenchQuickLocatorRequested(listener: () => void): () => void
}

export const appearanceSnapshotSchema = preferencesSchema.pick({ theme: true, visualStyle: true })

export const RESPONSE_SCHEMAS = { projectReferenceRolePreferenceSchema, projectSummarySchema, contentTypeSchema, generalRecordCategorySchema, projectTemplateSchema, projectTemplateDiffSchema, projectDetailSchema, projectResourceReferenceSchema, resourceSchema, projectMaterialSchema, materialResearchSessionSchema, projectMaterialPreviewSchema, projectAssetLinkSchema, projectAssetImportBatchResultSchema, publishingMaterialSchema, publishingDraftSchema, publishingAccountSchema, publishingAccountStateSchema, publishingComputerUsePilotSchema, distributionBatchSchema, distributionCompletionResultSchema, coverCandidateSchema, titleCandidateSchema, subtitleJobSchema, publishingHandoffSchema, feishuHandoffSchema, nasArchiveDestinationStatusSchema, nasBackupStatusSchema, archivePlanSchema, archiveRunSchema, businessRecordSchema, rebatePaymentSchema, businessInvoiceSchema, businessProjectDataSchema, businessAutofillResultSchema, businessImportLinkCaptureResultSchema, businessLedgerEntrySchema, businessFolderScanResultSchema, businessLedgerLockStatusSchema, otherIncomeCategorySchema, otherIncomeRecordSchema, otherIncomeRuleConditionsSchema, otherIncomeImportRuleSchema, otherIncomeCompanyAliasSchema, otherIncomeImportCandidateSchema, incomeLedgerSummarySchema, stageTimeRecordSchema, stageTimeMutationResultSchema, stageTimeContextSchema, stageTimeUpdateResultSchema, workspaceUndoStateSchema, workspaceUndoResultSchema, creationReportSnapshotSchema, creationReportSnapshotSummarySchema, projectCreationReviewSchema, creationReportConversationSchema, scriptRevisionConversationSchema, scriptRevisionMessageSchema, scriptRevisionApplyValidationSchema, scriptTextAnnotationSchema, projectCurrentScriptSnapshotSchema, projectCurrentScriptLoadResultSchema, applyProjectCurrentScriptResultSchema, saveProjectCurrentScriptVersionResultSchema, restoreProjectCurrentScriptVersionResultSchema, currentScriptRecoveryCandidateSchema, resolvedCurrentScriptRecoverySchema, scriptMaterialWorkspaceSchema, scriptMaterialFinalizationGateSchema, scriptMaterialVersionSnapshotSchema, draftComparisonWorkspaceSchema, draftComparisonHistoryEntrySchema, draftAlignmentSplitStartResultSchema, draftCandidateRevisionSchema, projectGenerationContextSchema, taskResourcePreparationSchema, taskResourceSnapshotSchema, structuredReferenceCatalogItemSchema, structuredReferenceRoleResolutionSchema, contentInstructionRequestRecordSchema, contentSourceSchema, contentAtomSchema, contentDerivativeSchema, contentEngineSnapshotSchema, contentSourceImportResultSchema, conversationMetadataResultSchema, conversationSelectionPreviewSchema, conversationFilterCandidateSchema, conversationFilterDestinationResultSchema, conversationScanPlanSchema, conversationScanPreflightSchema, conversationScanPreflightBatchSchema, conversationScanStartResultSchema, conversationScanProgressSchema, conversationFilterBatchDecisionResultSchema, contentDerivationPreparationSchema, draftVersionSchema, stylePreferenceSchema, captureSchema, captureDestinationCandidateSchema, captureDeduplicationResultSchema, topicSchema, topicStageDefinitionSchema, topicStageDeleteResultSchema, topicColumnDefinitionSchema, linkGroupSchema, scheduleItemSchema, todoItemSchema, dailyWorkLogSchema, taskRunSchema, providerCapabilitySchema, externalProviderConfigSchema, providerSettingsSchema, externalFileRelationSchema, mobileSyncStatusSchema, preferencesSchema, appearanceSnapshotSchema, projectDraftClassificationSchema, projectProductionNotesSchema, weatherSceneSnapshotSchema, workspaceSnapshotSchema, globalSearchResultSchema, recycleEmptyResultSchema }
