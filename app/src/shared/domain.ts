import type { VideoFormat } from './content-classification'
import type { WeatherCondition, WeatherPeriod } from './weather'

export const OPTIONAL_MODULE_KEYS = ['materials', 'outline', 'script', 'production', 'shooting', 'editing', 'postproduction', 'publishing', 'business', 'feedback'] as const
export const MODULE_KEYS = ['overview', ...OPTIONAL_MODULE_KEYS, 'versions'] as const
export type ProjectModuleKey = (typeof MODULE_KEYS)[number]
export type OptionalProjectModuleKey = (typeof OPTIONAL_MODULE_KEYS)[number]
export type ProjectStageShortcutKey = Exclude<ProjectModuleKey, 'overview' | 'business'>

export interface ProjectStageShortcutPreference {
  projectId: string
  moduleKey: ProjectStageShortcutKey
}

export const PROJECT_STATUSES = ['candidate', 'preparing', 'producing', 'paused', 'published', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export const TOPIC_STAGE_ROLES = ['standard', 'project_created', 'completed', 'archived', 'shelved'] as const
export type TopicStageRole = (typeof TOPIC_STAGE_ROLES)[number]

export interface ContentTypeDefinition {
  id: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  defaultProjectTemplateId: string | null
}

export interface GeneralRecordCategory {
  id: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
}

export interface ClassificationDefinitionSnapshot {
  contentTypes: Array<Pick<ContentTypeDefinition, 'id' | 'name' | 'description' | 'isActive'>>
  generalRecordCategories: Array<Pick<GeneralRecordCategory, 'id' | 'name' | 'description' | 'isActive'>>
}

export interface ProjectTemplateDefinition {
  recommendedVideoFormats?: VideoFormat[]
  recommendedProjectKinds?: import('./project-template-rules').ProjectKind[]
  id: string
  name: string
  description: string
  moduleKeys: OptionalProjectModuleKey[]
  recommendedContentTypeIds: string[]
  sortOrder: number
  isActive: boolean
}

export interface ProjectContentTypeHistoryEntry {
  id: string
  projectId: string
  previousContentTypeId: string
  previousContentTypeName: string
  nextContentTypeId: string
  nextContentTypeName: string
  source: 'user' | 'system'
  createdAt: string
}

export interface ProjectTemplateDiff {
  templateId: string | null
  templateName: string
  add: OptionalProjectModuleKey[]
  enable: OptionalProjectModuleKey[]
  preserve: OptionalProjectModuleKey[]
  suggestHide: OptionalProjectModuleKey[]
  blocked: OptionalProjectModuleKey[]
}

export interface ProjectModule {
  key: ProjectModuleKey
  enabled: boolean
  position: number
  contentRootId: string
  disabledAt: string | null
  completedAt: string | null
}

export interface ProductionChecklistItem {
  id: string
  text: string
  completed: boolean
  scheduleDate: string | null
  scheduleSegment: StageTimeSegment | null
}

export interface ProjectProductionNotes {
  projectId: string
  shootingItems: ProductionChecklistItem[]
  editingNotes: string
  editingNotesFormat: 'plain_text' | 'html'
  updatedAt: string
}

export interface ProductionChecklistSummary extends ProductionChecklistItem {
  projectId: string
}

export const STAGE_TIME_SEGMENTS = ['morning', 'afternoon', 'evening'] as const
export type StageTimeSegment = (typeof STAGE_TIME_SEGMENTS)[number]
export const STAGE_TIME_STATUSES = ['not_started', 'in_progress', 'completed', 'skipped'] as const
export type StageTimeStatus = (typeof STAGE_TIME_STATUSES)[number]
export const STAGE_TIME_SOURCES = ['automatic', 'manual', 'backfill'] as const
export type StageTimeSource = (typeof STAGE_TIME_SOURCES)[number]
export type StageTimeKey = Exclude<ProjectModuleKey, 'overview' | 'business'>
export const STAGE_PLAN_FIELDS = ['start', 'duration', 'end'] as const
export type StagePlanField = (typeof STAGE_PLAN_FIELDS)[number]

export interface StageTimePoint {
  localDate: string
  segment: StageTimeSegment
}

export type StagePlanEdit =
  | { field: 'start'; point: StageTimePoint | null }
  | { field: 'duration'; durationHalfDayUnits: number | null }
  | { field: 'end'; point: StageTimePoint | null }

export interface StageTimeRecord {
  id: string
  projectId: string
  stageKey: StageTimeKey
  status: StageTimeStatus
  startedAt: StageTimePoint | null
  completedAt: StageTimePoint | null
  startSource: StageTimeSource | null
  completionSource: StageTimeSource | null
  actualEffortHalfDayUnits: number | null
  plannedStartedAt: StageTimePoint | null
  plannedCompletedAt: StageTimePoint | null
  estimatedDurationHalfDayUnits: number | null
  planManualFields: StagePlanField[]
  planAutoField: StagePlanField | null
  autoStartActionId: string | null
  durationSegments: number | null
  durationLabel: string | null
  createdAt: string
  updatedAt: string
}

export interface StageTimeMutationResult {
  project: ProjectDetail
  record: StageTimeRecord
  eventId: string
}

export interface StageTimeContext {
  currentPoint: StageTimePoint
  timeZone: string
  cutoffHour: number
}

export type StageTimeUpdateResult =
  | {
      changed: true
      project: ProjectDetail
      record: StageTimeRecord
      eventId: string
    }
  | {
      changed: false
      project: ProjectDetail
      record: StageTimeRecord
      eventId: null
    }

export const OPERATION_LOG_STATUSES = ['undoable', 'undone', 'audit_only', 'conflicted'] as const
export type OperationLogStatus = (typeof OPERATION_LOG_STATUSES)[number]

export interface WorkspaceUndoState {
  canUndo: boolean
  operationId: string | null
  commandType: string | null
  label: string | null
  createdAt: string | null
}

export interface WorkspaceUndoResult {
  operationId: string
  commandType: string
  entityType: string
  entityId: string | null
  label: string
  undoneAt: string
}

export const CREATION_REPORT_KINDS = ['weekly', 'monthly'] as const
export type CreationReportKind = (typeof CREATION_REPORT_KINDS)[number]

export interface CreationReportPeriod {
  kind: CreationReportKind
  startDate: string
  endDate: string
  label: string
  comparisonLabel: '上周' | '上月'
}

export interface CreationReportStageSummary {
  stageKey: StageTimeKey
  completedCount: number
  durationSampleCount: number
  averageDurationSegments: number | null
  averageDurationLabel: string | null
  actualEffortSampleCount: number
  totalActualEffortHalfDayUnits: number
  averageActualEffortHalfDayUnits: number | null
  scheduledSampleCount: number
  notDueSampleCount: number
  delayedCompletedCount: number
  openOverdueCount: number
  averageDelaySegments: number | null
  averageDelayLabel: string | null
  previousAverageDurationSegments: number | null
  durationDeltaSegments: number | null
}

export interface CreationReportPublishedProject {
  projectId: string
  title: string
  colorToken: ProjectColorToken
  contentTypeId: string
  contentTypeName: string
  platformTargets: string[]
  publishedAt: StageTimePoint
  projectDurationSegments: number | null
  projectDurationLabel: string | null
  actualEffortHalfDayUnits: number
  actualEffortStageCount: number
  delayedStageCount: number
}

export interface CreationReportPayloadV1 {
  version: 1
  period: CreationReportPeriod
  publishedCount: number
  projectDurationSampleCount: number
  averageProjectDurationSegments: number | null
  averageProjectDurationLabel: string | null
  completedStageCount: number
  durationStageSampleCount: number
  actualEffortStageSampleCount: number
  delayedCompletedCount: number
  openOverdueCount: number
  publishedProjects: CreationReportPublishedProject[]
  stageSummaries: CreationReportStageSummary[]
  comparison: {
    periodLabel: string
    publishedCount: number
    publishedCountDelta: number
    averageProjectDurationSegments: number | null
    averageProjectDurationDeltaSegments: number | null
  }
}

export type ScheduleVarianceState = 'no_schedule' | 'not_due' | 'early' | 'on_time' | 'late_completed' | 'overdue_open'

export interface CreationReportProjectStage {
  stageKey: StageTimeKey
  enabled: boolean
  position: number
  stateAtCutoff: StageTimeStatus
  startedAt: StageTimePoint | null
  completedAt: StageTimePoint | null
  durationSegments: number | null
  elapsedSegments: number | null
  actualEffortHalfDayUnits: number | null
  plannedStartAt: StageTimePoint | null
  plannedEndAt: StageTimePoint | null
  varianceDeadlineAt: StageTimePoint | null
  varianceInPeriod: boolean
  varianceSegments: number | null
  varianceState: ScheduleVarianceState
}

export interface CreationReportPeriodProject {
  projectId: string
  title: string
  colorToken: ProjectColorToken
  projectStatus: ProjectStatus
  actualStageKeys: StageTimeKey[]
  scheduledStageKeys: StageTimeKey[]
  lifecycleDurationSegments: number | null
  summaryActualEffortHalfDayUnits: number
  summaryActualEffortStageCount: number
  completeTimeSampleCount: number
  completedStageCount: number
  delayedStageCount: number
  openOverdueCount: number
  stages: CreationReportProjectStage[]
}

export interface CreationReportPayloadV2 extends Omit<CreationReportPayloadV1, 'version'> {
  version: 2
  calculatedThrough: StageTimePoint
  timeZone: string
  periodProjects: CreationReportPeriodProject[]
}

export type CreationReportPayload = CreationReportPayloadV1 | CreationReportPayloadV2

export interface CreationReportSnapshot {
  id: string
  kind: CreationReportKind
  periodStart: string
  periodEnd: string
  inputHash: string
  payload: CreationReportPayload
  generatedAt: string
}

export interface CreationReportSnapshotSummary {
  id: string
  kind: CreationReportKind
  periodStart: string
  periodEnd: string
  version: CreationReportPayload['version']
  generatedAt: string
}

export interface StagePlanBaseline {
  source: 'first_saved' | 'legacy'
  capturedAt: string
  plannedStartAt: StageTimePoint | null
  plannedEndAt: StageTimePoint | null
  varianceDeadlineAt: StageTimePoint | null
  startVarianceSegments: number | null
  varianceSegments: number | null
  varianceState: ScheduleVarianceState
}

export interface ProjectCreationReviewStage {
  baseline: StagePlanBaseline | null
  startVarianceSegments: number | null
  stageKey: StageTimeKey
  enabled: boolean
  position: number
  status: StageTimeStatus
  startedAt: StageTimePoint | null
  completedAt: StageTimePoint | null
  durationSegments: number | null
  elapsedSegments: number | null
  actualEffortHalfDayUnits: number | null
  plannedStartAt: StageTimePoint | null
  plannedEndAt: StageTimePoint | null
  varianceDeadlineAt: StageTimePoint | null
  varianceSegments: number | null
  varianceState: ScheduleVarianceState
}

export interface ProjectCreationReview {
  projectId: string
  title: string
  colorToken: ProjectColorToken
  projectStatus: ProjectStatus
  lifecycleStartedAt: StageTimePoint | null
  lifecycleEndedAt: StageTimePoint | null
  lifecycleDurationSegments: number | null
  lifecycleOngoing: boolean
  lifecycleEndKind: 'published' | 'ongoing' | 'archived_without_publish' | 'missing_start'
  summaryActualEffortHalfDayUnits: number
  summaryActualEffortStageCount: number
  completeTimeSampleCount: number
  completedStageCount: number
  largestAbsoluteVarianceStageKey: StageTimeKey | null
  largestAbsoluteVarianceSegments: number | null
  stages: ProjectCreationReviewStage[]
  calculatedAt: string
  calculatedThrough: StageTimePoint
  timeZone: string
}

export type CreationReportMessageRole = 'user' | 'assistant'

export interface CreationReportMessage {
  id: string
  threadId: string
  role: CreationReportMessageRole
  content: string
  provider: Extract<ProviderKind, 'codex_cli' | 'claude_cli'>
  taskId: string | null
  createdAt: string
}

export interface CreationReportConversation {
  reportSnapshotId: string
  threadId: string | null
  messages: CreationReportMessage[]
  createdAt: string | null
  updatedAt: string | null
}

export type ScriptRevisionProvider = Extract<ProviderKind, 'codex_cli' | 'claude_cli'>
export type ScriptRevisionSurface = 'conversation' | 'version_compare'
export type ScriptRevisionSuggestionAction = 'replace' | 'insert_after'
export type ScriptRevisionSuggestionStatus = 'pending' | 'applied' | 'copied' | 'discarded'

export interface ProviderSecuritySnapshot {
  provider: ScriptRevisionProvider
  cliVersion: string
  fingerprint: string
  policyVersion: string
}

export interface ScriptRevisionSelectionSnapshot {
  baseVersionId: string
  targetSelectionId: string | null
  selectedText: string | null
  selectionHash: string | null
  contextBefore: string
  contextAfter: string
  occurrenceIndex: number | null
  from: number | null
  to: number | null
  applicationTarget?: {
    surface: 'version_compare'
    side: 'left' | 'right'
    sourceId: string
    contentHash: string
    content: string
    range: { from: number; to: number; selectedText: string } | null
    inheritedConflicts?: ContentSelectionConflict[]
  } | null
}

export interface ScriptRevisionSuggestion {
  originalText: string
  replacementText: string
  action: ScriptRevisionSuggestionAction
  summary: string
  rationale: string
}

export interface ContentFactAnnotation {
  id: string
  start: number
  end: number
  text: string
  provenance: 'ai_supplement' | 'web_supplement' | 'needs_confirmation'
  note: string
  webSources: Array<{ title: string; url: string }>
  evidenceIds?: string[]
}

export interface ContentFactEvidence {
  id: string
  projectId: string
  requestId: string
  targetId: string
  taskId: string
  annotationId: string
  claim: string
  sourceTitle: string
  sourceUrl: string
  accessedAt: string
  market: string
  factAsOf: string
  evidenceType: 'fact' | 'price'
  priceKind: 'launch_official' | 'current_official' | 'current_channel' | 'user_actual' | null
  currency: string | null
  runtimeAccessId: string
  createdAt: string
}

export interface ScriptRevisionInputBudget {
  estimatedCharacters: number
  maximumCharacters: number
}

export const SCRIPT_REVISION_WEB_SEARCH_MODES = ['automatic', 'required', 'disabled'] as const
export type ScriptRevisionWebSearchMode = (typeof SCRIPT_REVISION_WEB_SEARCH_MODES)[number]

export interface ScriptRevisionWebSearchRecord {
  type: 'search' | 'open_page' | 'find_in_page' | 'other'
  query: string | null
  url: string | null
  runtimeAccessId?: string | null
  accessedAt?: string | null
}

export interface ScriptRevisionContextSnapshot {
  version: 1
  baseVersion: {
    id: string
    revision: number
    content: string
  }
  selection: ScriptRevisionSelectionSnapshot
  resourceSnapshot: TaskResourceSnapshot | null
  providerSecurity: ProviderSecuritySnapshot
  inputBudget: ScriptRevisionInputBudget
}

export interface ScriptRevisionMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant'
  content: string
  provider: ScriptRevisionProvider
  selectedText: string | null
  selectionHash: string | null
  selectionSnapshot: ScriptRevisionSelectionSnapshot | null
  suggestion: ScriptRevisionSuggestion | null
  suggestionStatus: ScriptRevisionSuggestionStatus | null
  candidateGroupId: string | null
  candidateNumber: number | null
  generationRound: number | null
  candidateInstruction: string | null
  taskId: string | null
  contextSnapshot: ScriptRevisionContextSnapshot | null
  model: string | null
  reasoningEffort: string | null
  sourceSelections: ContentSourceSelectionSnapshot[]
  conflicts: ContentSelectionConflict[]
  webSearchMode: ScriptRevisionWebSearchMode | null
  webSearches: ScriptRevisionWebSearchRecord[]
  factAnnotations: ContentFactAnnotation[]
  createdAt: string
}

export interface ScriptRevisionConversation {
  projectId: string
  surface: ScriptRevisionSurface
  threadId: string | null
  baseVersionId: string | null
  baseVersionRevision: number | null
  provider: ScriptRevisionProvider | null
  providerFingerprint: string | null
  providerThreadId: string | null
  model: string | null
  reasoningEffort: string | null
  webSearchMode: ScriptRevisionWebSearchMode
  messages: ScriptRevisionMessage[]
  createdAt: string | null
  updatedAt: string | null
}

export interface ScriptRevisionApplyValidation {
  status: 'allowed' | 'target_changed' | 'target_ambiguous'
  suggestion: ScriptRevisionSuggestion
}

export const SCRIPT_WORKBENCH_VIEWS = ['single', 'dual', 'comparison'] as const
export type ScriptWorkbenchView = (typeof SCRIPT_WORKBENCH_VIEWS)[number]
export type ScriptWorkbenchSingleProvider = 'claude' | 'codex'
export type ScriptWorkbenchConversationTab = ScriptWorkbenchSingleProvider | 'current'
export type DraftComparisonSide = 'claude' | 'codex'
export type DraftComparisonColorMode = 'all' | 'left' | 'none'
export type DraftComparisonDocumentMode = 'groups' | 'clean'
export type DraftComparisonSplitScope = 'current' | 'matched'
export type DraftComparisonSplitStrategy = 'original_order' | 'extract_below'
export type DraftSourceKind = 'freeform' | 'provider'
export type DraftTextProvider = 'codex_cli' | 'claude_cli' | 'external_api'
export type DraftAlignmentMatchType = 'exact' | 'related' | 'claude_only' | 'codex_only' | 'needs_review'
export type DraftComparisonStatus = 'empty' | 'aligning' | 'ready' | 'failed'
export type DraftGroupDecisionKind = 'claude' | 'codex' | 'candidate' | 'freeform' | 'combination' | 'omit' | 'unresolved'

export interface DraftWorkingSource {
  sourceKind: DraftSourceKind
  providerConfigId: string | null
  provider: DraftTextProvider | null
  model: string | null
  providerFingerprint: string | null
  taskId: string | null
}

export interface DraftParagraphSnapshot {
  id: string
  position: number
  text: string
}

export interface DraftSourceSnapshot {
  id: string
  sessionId: string
  side: DraftComparisonSide
  sourceKind: DraftSourceKind
  providerConfigId: string | null
  provider: DraftTextProvider | null
  model: string | null
  providerFingerprint: string | null
  content: string
  contentHash: string
  paragraphs: DraftParagraphSnapshot[]
  createdAt: string
}

export interface DraftCandidateRevision {
  id: string
  groupId: string
  parentCandidateId: string | null
  parentTraceId: string | null
  sourceKind: DraftSourceKind
  providerConfigId: string | null
  provider: DraftTextProvider | null
  model: string | null
  reasoningEffort: string | null
  providerFingerprint: string | null
  requirement: string
  content: string
  summary: string
  rationale: string
  contentHash: string
  characterCount: number
  revisionRound: number
  status: 'active' | 'input_changed'
  inputRelationChanged: boolean
  targetDecisionFingerprint: string | null
  targetKind: 'group' | 'claude' | 'codex' | 'candidate' | 'current' | null
  targetContent: string
  sourceSelections: ContentSourceSelectionSnapshot[]
  conflicts: ContentSelectionConflict[]
  factAnnotations: ContentFactAnnotation[]
  taskId: string | null
  position: number
  createdAt: string
}

export function canonicalDraftGroupDecisionFingerprintInput(decision: DraftGroupDecision | null | undefined, contentOverride?: string): string {
  return JSON.stringify({
    kind: decision?.kind ?? null,
    sourceId: decision?.sourceId ?? null,
    sourceIds: decision?.sourceIds ?? [],
    content: contentOverride ?? decision?.content ?? ''
  })
}

export interface DraftGroupDecision {
  groupId: string
  kind: DraftGroupDecisionKind
  sourceId: string | null
  sourceIds: string[]
  content: string
  note: string
  markers: DraftTextMarker[]
  updatedAt: string
}

export interface DraftTextMarker {
  id: string
  start: number
  end: number
  text: string
  note: string
  status: 'active' | 'position_changed'
}

export interface DraftAlignmentGroup {
  id: string
  sessionId: string
  position: number
  labelIndex: number
  matchType: DraftAlignmentMatchType
  outlinePlacement: 'outline_item' | 'outside_outline'
  outlineItemId: string | null
  outlineItemTitle: string | null
  outlineLabel: string | null
  claudeParagraphs: DraftParagraphSnapshot[]
  codexParagraphs: DraftParagraphSnapshot[]
  candidates: DraftCandidateRevision[]
  decision: DraftGroupDecision | null
  manuallyAdjusted: boolean
  createdAt: string
  updatedAt: string
}

export interface DraftComparisonSession {
  id: string
  projectId: string
  status: DraftComparisonStatus
  alignmentProviderConfigId: string | null
  alignmentProvider: DraftTextProvider | null
  alignmentModel: string | null
  alignmentProviderFingerprint: string | null
  alignmentTaskId: string | null
  errorMessage: string | null
  claudeSnapshot: DraftSourceSnapshot
  codexSnapshot: DraftSourceSnapshot
  groups: DraftAlignmentGroup[]
  createdAt: string
  updatedAt: string
}

export interface DraftComparisonSessionSummary {
  id: string
  status: DraftComparisonStatus
  groupCount: number
  createdAt: string
  updatedAt: string
}

export interface DraftComparisonWorkspace {
  projectId: string
  currentDocumentBaseRevision: number | null
  currentDocumentBaseContentHash: string | null
  claudeContent: string
  codexContent: string
  claudeSource: DraftWorkingSource
  codexSource: DraftWorkingSource
  claudeUpdatedAt: string | null
  codexUpdatedAt: string | null
  updatedAt: string | null
  activeSession: DraftComparisonSession | null
  sessionHistory: DraftComparisonSessionSummary[]
}

export interface DraftComparisonHistoryEntry {
  id: string
  sessionId: string
  label: string
  createdAt: string
}

export interface DraftAlignmentSplitStartResult {
  workspace: DraftComparisonWorkspace
  task: TaskRun | null
}

export type ScriptMaterialAiSide = 'codex' | 'claude'
export type ScriptMaterialMobileTab = 'source' | 'ai' | 'current'
export interface ScriptMaterialScrollTops {
  source: number
  ai: number
  current: number
}
export interface ScriptConversationScrollTops {
  claude: number
  codex: number
  current: number
}
export interface ScriptVersionScrollTops {
  left: number
  right: number
}
export type ScriptMaterialPointAdoption = 'required' | 'excluded'
export type ScriptMaterialTransform = 'preserved' | 'polished' | 'expanded' | 'combined' | 'reordered'
export type ScriptMaterialProvenance = 'source' | 'ai_supplement' | 'web_supplement' | 'needs_confirmation'
export type ScriptMaterialCoverageStatus = 'complete' | 'partial' | 'missing' | 'excluded' | 'allowed_omission'
export type ScriptMaterialCheckTarget = ScriptMaterialAiSide | 'current'
export type ScriptMaterialCheckState = 'unchecked' | 'checking' | 'ready' | 'stale' | 'failed'

export interface ScriptMaterialPoint {
  id: string
  revisionId: string
  position: number
  sourceStart: number
  sourceEnd: number
  sourceText: string
  summary: string
  requirement: string
  adoption: ScriptMaterialPointAdoption
  createdAt: string
  updatedAt: string
}

export interface ScriptMaterialRevision {
  id: string
  projectId: string
  revision: number
  content: string
  contentHash: string
  pointsConfirmed: boolean
  confirmedAt: string | null
  createdAt: string
}

export interface ScriptMaterialWebSource {
  title: string
  url: string
}

export interface ScriptMaterialDraftAnnotation {
  id: string
  start: number
  end: number
  text: string
  provenance: Exclude<ScriptMaterialProvenance, 'source'>
  note: string
  webSources: ScriptMaterialWebSource[]
  evidenceIds?: string[]
  status: 'active' | 'confirmed'
}

export type ScriptMaterialManualMarkStyle = 'highlight' | 'underline' | 'strike'

export interface ScriptMaterialManualMark {
  id: string
  start: number
  end: number
  text: string
  style: ScriptMaterialManualMarkStyle
}

export interface ScriptMaterialDraftParagraph {
  id: string
  position: number
  text: string
  sourcePointIds: string[]
  transform: ScriptMaterialTransform
  provenance: ScriptMaterialProvenance[]
  webSources: ScriptMaterialWebSource[]
  annotations: ScriptMaterialDraftAnnotation[]
  manualMarks: ScriptMaterialManualMark[]
}

export interface ScriptMaterialCurrentParagraphMapping {
  currentParagraphId: string
  currentParagraphText: string
  sourcePointIds: string[]
  draftParagraphIds: string[]
}

export interface ScriptMaterialDraft {
  id: string
  projectId: string
  revisionId: string
  side: ScriptMaterialAiSide
  sourceKind: DraftSourceKind
  providerConfigId: string | null
  provider: DraftTextProvider | null
  model: string | null
  reasoningEffort: string | null
  providerFingerprint: string | null
  requirement: string
  inputFingerprint: string
  content: string
  contentHash: string
  draftVersion: number
  mappingState: 'pending' | 'ready' | 'failed'
  mappingTaskId: string | null
  mappingError: string | null
  currentContentHash: string | null
  currentMappings: ScriptMaterialCurrentParagraphMapping[]
  paragraphs: ScriptMaterialDraftParagraph[]
  taskId: string | null
  createdAt: string
  updatedAt: string
}

export interface ScriptMaterialPointCoverage {
  pointId: string
  status: ScriptMaterialCoverageStatus
  paragraphIds: string[]
  rationale: string
}

export interface ScriptMaterialParagraphFinding {
  id: string
  paragraphId: string
  sourcePointIds: string[]
  provenance: ScriptMaterialProvenance
  note: string
  status: 'active' | 'confirmed'
  resolutionNote: string
  confirmedAt: string | null
}

export interface ScriptMaterialCheck {
  id: string
  projectId: string
  revisionId: string
  target: ScriptMaterialCheckTarget
  targetIdentity: string
  targetContentHash: string
  inputFingerprint: string
  state: ScriptMaterialCheckState
  pointCoverage: ScriptMaterialPointCoverage[]
  paragraphFindings: ScriptMaterialParagraphFinding[]
  allowedOmissionPointIds: string[]
  taskId: string | null
  errorMessage: string | null
  checkedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ScriptMaterialChatMessage {
  id: string
  projectId: string
  revisionId: string
  side: ScriptMaterialAiSide
  role: 'user' | 'assistant'
  content: string
  taskId: string | null
  createdAt: string
}

export interface ScriptMaterialRewriteCandidate {
  id: string
  projectId: string
  revisionId: string
  draftId: string
  side: ScriptMaterialAiSide
  parentCandidateId: string | null
  applicationTarget: {
    targetId: string
    selectedText: string
    contentHash: string
    from: number
    to: number
  } | null
  paragraphIds: string[]
  selectedText: string
  selectedStart: number | null
  selectedEnd: number | null
  requirement: string
  content: string
  sourcePointIds: string[]
  annotations: ScriptMaterialDraftAnnotation[]
  providerConfigId: string | null
  provider: DraftTextProvider | null
  model: string | null
  reasoningEffort: string | null
  sourceSelections: ContentSourceSelectionSnapshot[]
  conflicts: ContentSelectionConflict[]
  taskId: string | null
  taskStatusAtSnapshot?: TaskStatus | null
  taskErrorAtSnapshot?: string | null
  createdAt: string
}

export interface ScriptMaterialWorkspace {
  projectId: string
  workingContent: string
  workingBaseRevisionId: string | null
  requirement: string
  aiCount: 1 | 2
  selectedAiSide: ScriptMaterialAiSide
  selectedCodexDraftId: string | null
  selectedClaudeDraftId: string | null
  webSearchMode: ScriptRevisionWebSearchMode
  updatedAt: string | null
  activeRevision: ScriptMaterialRevision | null
  points: ScriptMaterialPoint[]
  drafts: ScriptMaterialDraft[]
  checks: ScriptMaterialCheck[]
  messages: ScriptMaterialChatMessage[]
  rewriteCandidates: ScriptMaterialRewriteCandidate[]
}

export interface ScriptMaterialFinalizationGate {
  hasMaterialContext: boolean
  canFinalize: boolean
  state: 'not_required' | 'unchecked' | 'checking' | 'stale' | 'failed' | 'blocked' | 'ready'
  currentContentHash: string
  check: ScriptMaterialCheck | null
  blockingPointIds: string[]
  unresolvedFindingIds: string[]
  message: string
}

export interface ScriptMaterialVersionSnapshot {
  versionId: string
  projectId: string
  sourceRevisionId: string
  sourceRevisionHash: string
  currentContentHash: string
  workspaceContentHash: string
  auditInputFingerprint: string
  snapshotHash: string
  workspace: ScriptMaterialWorkspace
  finalization: {
    allowedOmissionPointIds: string[]
    confirmedFindingIds: string[]
    finalizedAt: string
  } | null
  createdAt: string
}

export interface ProjectSummary {
  videoFormat?: VideoFormat | null
  id: string
  title: string
  description: string
  contentTypeId: string
  contentTypeName: string
  appliedTemplateId: string | null
  appliedTemplateName: string | null
  status: ProjectStatus
  topicStageRole: TopicStageRole | null
  colorToken: ProjectColorToken
  platformTargets: string[]
  isPinned: boolean
  isCommercial: boolean
  ledgerOnly: boolean
  trashedAt: string | null
  lastOpenedAt: string | null
  updatedAt: string
  pendingExternalDrafts: number
  enabledModuleKeys: OptionalProjectModuleKey[]
  currentStageKey: StageTimeKey | null
  progressPercent?: number
}

export interface DraftVersion {
  id: string
  projectId: string
  displayName: string | null
  documentType: 'script' | 'outline' | 'project_description'
  kind: 'claude_candidate' | 'codex_candidate' | 'content_candidate' | 'merged_draft' | 'final' | 'external_draft' | 'user_edit'
  content: string
  workspaceContent?: string | null
  parentVersionIds: string[]
  sourceFilePath: string | null
  sourceFileId: string | null
  sourceFileName: string | null
  sourceTaskId: string | null
  sourceCandidateId: string | null
  resourceSnapshot: TaskResourceSnapshot | null
  revision: number
  resolvedAt: string | null
  isFinal: boolean
  createdBy: 'user' | 'provider' | 'importer' | 'system'
  createdAt: string
}

export const CURRENT_SCRIPT_BLOCK_KINDS = ['heading', 'paragraph', 'list_item', 'quote', 'code'] as const
export type CurrentScriptBlockKind = (typeof CURRENT_SCRIPT_BLOCK_KINDS)[number]
export const CURRENT_SCRIPT_SOURCE_KINDS = ['material_point', 'material_draft_paragraph', 'outline_point', 'brief_point', 'comparison_source', 'generation'] as const
export type CurrentScriptSourceKind = (typeof CURRENT_SCRIPT_SOURCE_KINDS)[number]
export const SCRIPT_TEXT_ANNOTATION_SOURCE_KINDS = ['current_script', 'material_draft', 'comparison_source', 'comparison_candidate', 'draft_version'] as const
export type ScriptTextAnnotationSourceKind = (typeof SCRIPT_TEXT_ANNOTATION_SOURCE_KINDS)[number]
export const SCRIPT_TEXT_ANNOTATION_STYLES = ['highlight', 'underline', 'strike', 'flag'] as const
export type ScriptTextAnnotationStyle = (typeof SCRIPT_TEXT_ANNOTATION_STYLES)[number]
export const SCRIPT_TEXT_ANNOTATION_STATUSES = ['active', 'position_changed', 'not_migrated'] as const
export type ScriptTextAnnotationStatus = (typeof SCRIPT_TEXT_ANNOTATION_STATUSES)[number]

export interface ContentSourceSelectionSnapshot {
  selectionId: string
  position: number
  sourceKind: ScriptTextAnnotationSourceKind
  sourceId: string
  sourceVersion: string
  sourceContentHash: string
  sourceLabel: string
  semanticGroupId: string | null
  blockId: string
  blockStart: number
  blockEnd: number
  selectedText: string
}

export type ContentSelectionConflictKind = 'fact' | 'brief' | 'real_experience'

export interface ContentSelectionConflict {
  id: string
  kind: ContentSelectionConflictKind
  summary: string
  sourceSelectionIds: string[]
  sourceExcerpts: string[]
}

export interface ProjectCurrentScriptDocument {
  projectId: string
  workingDocumentId: string
  schemaVersion: number
  revision: number
  editorDocument: Record<string, unknown>
  contentHash: string
  lastSavedVersionId: string | null
  updatedAt: string
}

export interface CurrentScriptBlock {
  blockId: string
  kind: CurrentScriptBlockKind
  parentBlockIds: string[]
  text: string
}

export interface CurrentScriptSourceRelation {
  id: string
  workingDocumentId: string
  targetBlockId: string
  targetStart: number
  targetEnd: number
  sourceKind: CurrentScriptSourceKind
  sourceId: string
  sourceVersion: string
  createdAt: string
  updatedAt: string
}

export interface ScriptTextAnnotation {
  id: string
  projectId: string
  sourceKind: ScriptTextAnnotationSourceKind
  sourceId: string
  sourceVersion: string
  coordinateSpace: 'block_text'
  blockId: string
  blockStart: number
  blockEnd: number
  selectedText: string
  style: ScriptTextAnnotationStyle
  note: string
  evidenceIds?: string[]
  status: ScriptTextAnnotationStatus
  createdAt: string
  updatedAt: string
}

export interface ProjectCurrentScriptSnapshot {
  document: ProjectCurrentScriptDocument
  blocks: CurrentScriptBlock[]
  sourceRelations: CurrentScriptSourceRelation[]
  annotations: ScriptTextAnnotation[]
}

export interface CurrentScriptInitializationCandidate {
  versionId: string
  displayName: string | null
  revision: number
  kind: DraftVersion['kind']
  isFinal: boolean
  createdAt: string
  sourceContent: string
  sourceContentHash: string
  selectionReason: 'current_final' | 'latest_saved_script' | 'saved_version_requires_selection'
}

export type ProjectCurrentScriptLoadResult =
  | { status: 'ready'; snapshot: ProjectCurrentScriptSnapshot }
  | {
    status: 'initialization_required'
    candidates: CurrentScriptInitializationCandidate[]
    recommendedVersionId: string | null
    requiresSelection: boolean
  }

export interface InitializeProjectCurrentScriptInput {
  projectId: string
  clientMutationId: string
  sourceVersionId: string | null
  expectedSourceContentHash: string | null
  editorDocument: Record<string, unknown>
  sourceRelations: CurrentScriptSourceRelationInput[]
  annotations: ScriptTextAnnotationInput[]
  confirmedLegacyAnnotationIds?: string[]
  confirmedLegacyRelationIds?: string[]
}

export interface CurrentScriptSourceRelationInput {
  id: string
  targetBlockId: string
  targetStart: number
  targetEnd: number
  sourceKind: CurrentScriptSourceKind
  sourceId: string
  sourceVersion: string
}

export interface ScriptTextAnnotationInput {
  id: string
  blockId: string
  blockStart: number
  blockEnd: number
  selectedText: string
  style: ScriptTextAnnotationStyle
  note: string
  evidenceIds?: string[]
  status: ScriptTextAnnotationStatus
}

export interface SourceScriptTextAnnotationInput extends ScriptTextAnnotationInput {
  projectId: string
  sourceKind: Exclude<ScriptTextAnnotationSourceKind, 'current_script'>
  sourceId: string
  sourceVersion: string
}

export interface ApplyProjectCurrentScriptInput {
  projectId: string
  workingDocumentId: string
  clientMutationId: string
  expectedRevision: number
  expectedContentHash: string
  editorDocument: Record<string, unknown>
  sourceRelations: CurrentScriptSourceRelationInput[]
  annotations: ScriptTextAnnotationInput[]
  recoveryConflictId?: string | null
}

export type ApplyProjectCurrentScriptResult =
  | { status: 'applied'; snapshot: ProjectCurrentScriptSnapshot; revisionSnapshotId: string }
  | CurrentScriptConflictResult

export interface CurrentScriptConflictResult {
  status: 'conflict'
  code: 'CURRENT_SCRIPT_CAS_CONFLICT'
  reason: 'working_document_mismatch' | 'revision_mismatch' | 'content_hash_mismatch'
  conflictId: string
  expected: { workingDocumentId: string; revision: number; contentHash: string }
  actual: ProjectCurrentScriptSnapshot
  attempted: {
    editorDocument: Record<string, unknown>
    contentHash: string
    sourceRelations: CurrentScriptSourceRelationInput[]
    annotations: ScriptTextAnnotationInput[]
  }
  message: string
}

export interface SaveProjectCurrentScriptVersionInput extends ApplyProjectCurrentScriptInput {
  kind: 'merged_draft' | 'user_edit'
  displayName?: string
  finalize?: boolean
  /** Internal restore-operation context; omitted by ordinary explicit saves. */
  restoreSourceVersionId?: string | null
}

export type SaveProjectCurrentScriptVersionResult =
  | {
    status: 'saved'
    version: DraftVersion
    snapshot: ProjectCurrentScriptSnapshot
    revisionSnapshotId: string
  }
  | CurrentScriptConflictResult

export interface RestoreProjectCurrentScriptVersionInput extends ApplyProjectCurrentScriptInput {
  sourceVersionId: string | null
  displayName?: string
}

export type RestoreProjectCurrentScriptVersionResult =
  | {
    status: 'restored'
    version: DraftVersion
    snapshot: ProjectCurrentScriptSnapshot
    revisionSnapshotId: string
    materialWorkspace: ScriptMaterialWorkspace | null
  }
  | CurrentScriptConflictResult

export const CURRENT_SCRIPT_RECOVERY_RESOLUTION_KINDS = ['kept_server', 'replaced_with_attempt', 'saved_attempt_as_version'] as const
export type CurrentScriptRecoveryResolutionKind = (typeof CURRENT_SCRIPT_RECOVERY_RESOLUTION_KINDS)[number]

export interface ResolveCurrentScriptRecoveryInput {
  projectId: string
  conflictId: string
  resolutionKind: CurrentScriptRecoveryResolutionKind
  resolvedRevisionSnapshotId: string | null
  expectedHeadWorkingDocumentId?: string
  expectedHeadRevision?: number
  expectedHeadContentHash?: string
  versionKind?: 'user_edit'
  displayName?: string
}

export interface ResolvedCurrentScriptRecovery {
  id: string
  resolutionKind: CurrentScriptRecoveryResolutionKind
  resolvedRevisionSnapshotId: string | null
  savedVersionId: string | null
  resolvedAt: string
}

export interface CurrentScriptRecoveryCandidate {
  id: string
  projectId: string
  workingDocumentId: string
  expectedRevision: number
  expectedContentHash: string
  headRevisionAtWrite: number
  headContentHashAtWrite: string
  reason: 'working_document_mismatch' | 'revision_mismatch' | 'content_hash_mismatch'
  actual: ProjectCurrentScriptSnapshot
  editorDocument: Record<string, unknown>
  contentHash: string
  sourceRelations: CurrentScriptSourceRelationInput[]
  annotations: ScriptTextAnnotationInput[]
  resolvedAt: string | null
  createdAt: string
}

export const RESOURCE_TYPES = ['template', 'style_profile', 'cover_style_profile', 'material', 'account'] as const
export type ResourceType = (typeof RESOURCE_TYPES)[number]
export const RESOURCE_ORIGINS = ['system', 'own', 'other_creator'] as const
export type ResourceOrigin = (typeof RESOURCE_ORIGINS)[number]
export const RESOURCE_SELECTION_MODES = ['automatic', 'recommended', 'manual_only'] as const
export type ResourceSelectionMode = (typeof RESOURCE_SELECTION_MODES)[number]
export const PROJECT_RESOURCE_ROLES = ['base_style', 'reference_style', 'sample_script', 'cover_style', 'material', 'account'] as const
export type ProjectResourceRole = (typeof PROJECT_RESOURCE_ROLES)[number]
export const RESOURCE_SELECTION_SOURCES = ['automatic', 'recommended', 'manual'] as const
export type ResourceSelectionSource = (typeof RESOURCE_SELECTION_SOURCES)[number]

export interface ResourceRecord {
  id: string
  resourceType: ResourceType
  name: string
  description: string
  contentTypeId: string | null
  origin: ResourceOrigin
  selectionMode: ResourceSelectionMode
  version: number
  payload: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProjectResourceReference {
  projectId: string
  resourceId: string
  role: ProjectResourceRole
  enabled: boolean
  selectionSource: ResourceSelectionSource
  resource: ResourceRecord
  createdAt: string
  updatedAt: string
}

export const TASK_REQUIRED_INPUT_KEYS = ['project_description', 'project_materials', 'real_experience', 'commercial_brief', 'client_requirements'] as const
export type TaskRequiredInputKey = (typeof TASK_REQUIRED_INPUT_KEYS)[number]
export type TaskRequiredInputStatus = 'included' | 'missing' | 'empty' | 'not_applicable'

export interface TaskRequiredInputItem {
  id: string
  label: string
  content: string
}

export interface TaskRequiredInput {
  key: TaskRequiredInputKey
  label: string
  required: boolean
  status: TaskRequiredInputStatus
  items: TaskRequiredInputItem[]
}

export interface TaskResourceSnapshotItem {
  id: string
  resourceType: ResourceType
  name: string
  description: string
  contentTypeId: string | null
  origin: ResourceOrigin
  selectionMode: ResourceSelectionMode
  version: number
  payload: Record<string, unknown>
}

export type TaskPrimaryReferenceStatus = 'included' | 'unread' | 'stored_only' | 'missing'

export interface TaskPrimaryReferenceSnapshot {
  linkId: string
  projectMaterialId: string
  fileReferenceId: string | null
  materialTitle: string
  materialRole: ProjectMaterialRole
  sourceKind: ProjectMaterialSourceKind
  relativePath: string | null
  fileName: string
  fileKind: 'file' | 'folder' | null
  mimeType: string | null
  materialUpdatedAt: string
  status: TaskPrimaryReferenceStatus
  isPrimaryReference: true
  attentionNote: string
  content: string | null
}

export type TaskSupportingMaterialKind = 'project_material' | 'real_experience' | 'scratch_note'

export interface TaskSupportingMaterialSnapshot {
  id: string
  kind: TaskSupportingMaterialKind
  title: string
  content: string
  updatedAt: string
}

export interface ProjectGenerationVersionSnapshot {
  id: string
  documentType: Extract<DraftVersion['documentType'], 'outline' | 'script'>
  kind: DraftVersion['kind']
  revision: number
  content: string
  isFinal: boolean
  createdAt: string
}

export interface ProjectGenerationContext {
  version: 1
  createdAt: string
  project: {
    id: string
    title: string
    description: string
    contentTypeId: string
    contentTypeName: string
    templateId: string | null
    isCommercial: boolean
  }
  selectedOutline: ProjectGenerationVersionSnapshot | null
  finalizedScript: ProjectGenerationVersionSnapshot | null
  primaryReferences: TaskPrimaryReferenceSnapshot[]
  supportingMaterials: TaskSupportingMaterialSnapshot[]
  brief: TaskRequiredInput | null
  confirmedRequirements: TaskRequiredInput[]
  platformAccounts: TaskResourceSnapshotItem[]
}

export interface TaskResourceSnapshot {
  version: 1
  createdAt: string
  projectId: string
  contentTypeId: string
  templateId: string | null
  requiredInputs: TaskRequiredInput[]
  primaryReferences: TaskPrimaryReferenceSnapshot[]
  supportingMaterials: TaskSupportingMaterialSnapshot[]
  referenceRequirements: string
  automaticResources: TaskResourceSnapshotItem[]
  recommendedResources: TaskResourceSnapshotItem[]
  manualResources: TaskResourceSnapshotItem[]
  generationContext?: ProjectGenerationContext
}

export interface TaskResourcePreparation {
  projectId: string
  taskContentTypeId: string
  taskTemplateId: string | null
  requiredInputs: TaskRequiredInput[]
  primaryReferences: TaskPrimaryReferenceSnapshot[]
  supportingMaterials: TaskSupportingMaterialSnapshot[]
  referenceRequirements: string
  automaticResources: ResourceRecord[]
  recommendedResources: ResourceRecord[]
  manualResources: ResourceRecord[]
  excludedRecommendedResourceIds: string[]
  selectedManualResourceIds: string[]
  selectedSupportingMaterialIds: string[]
}

export const CONTENT_SOURCE_KINDS = ['codex_export', 'claude_export', 'pasted_text'] as const
export type ContentSourceKind = (typeof CONTENT_SOURCE_KINDS)[number]
export const PRIVACY_FINDING_KINDS = ['credential', 'phone', 'email', 'possible_private', 'custom_sensitive'] as const
export type PrivacyFindingKind = (typeof PRIVACY_FINDING_KINDS)[number]

export interface PrivacyFinding {
  kind: PrivacyFindingKind
  label: string
  start: number
  end: number
}

export interface ContentSourceRecord {
  id: string
  sourceKind: ContentSourceKind
  title: string
  scopeLabel: string
  sanitizedContent: string
  privacyFindings: PrivacyFinding[]
  contentSha256: string
  duplicateAtomCount: number
  createdAt: string
}

export const CONTENT_ATOM_TYPES = ['story', 'method', 'viewpoint', 'comparison', 'pitfall', 'verifiable_fact'] as const
export type ContentAtomType = (typeof CONTENT_ATOM_TYPES)[number]
export const CONTENT_ATOM_STATUSES = ['review_pending', 'kept', 'discarded', 'merged'] as const
export type ContentAtomStatus = (typeof CONTENT_ATOM_STATUSES)[number]

export interface ContentAtomScores {
  freshness: number
  usefulness: number
  personalExperience: number
  narrative: number
}

export interface ContentAtomSourceRef {
  sourceId: string
  excerpt: string
  start: number
  end: number
}

export interface ContentAtomRecord {
  id: string
  atomType: ContentAtomType
  title: string
  content: string
  scores: ContentAtomScores
  sourceRefs: ContentAtomSourceRef[]
  status: ContentAtomStatus
  mergedFromIds: string[]
  contentHash: string
  createdAt: string
  updatedAt: string
}

export const CONTENT_DERIVATIVE_TYPES = ['x_single', 'x_thread', 'ai_short_video_script'] as const
export type ContentDerivativeType = (typeof CONTENT_DERIVATIVE_TYPES)[number]
export const CONTENT_DERIVATIVE_STATUSES = ['candidate', 'confirmed', 'project_created'] as const
export type ContentDerivativeStatus = (typeof CONTENT_DERIVATIVE_STATUSES)[number]

export interface ContentDerivationAtomSnapshot {
  id: string
  atomType: ContentAtomType
  title: string
  content: string
  scores: ContentAtomScores
  sourceRefs: ContentAtomSourceRef[]
}

export interface ContentDerivationPrivacySummary {
  sourceId: string
  sourceTitle: string
  findingCount: number
  findingKinds: PrivacyFindingKind[]
}

export interface ContentDerivationSnapshot {
  version: 1
  createdAt: string
  contentTypeId: string
  templateId: string | null
  atoms: ContentDerivationAtomSnapshot[]
  automaticResources: TaskResourceSnapshotItem[]
  recommendedResources: TaskResourceSnapshotItem[]
  manualResources: TaskResourceSnapshotItem[]
  privacy: ContentDerivationPrivacySummary[]
}

export interface ContentDerivativeRecord {
  id: string
  outputType: ContentDerivativeType
  title: string
  atomIds: string[]
  generatedContent: string
  currentContent: string
  status: ContentDerivativeStatus
  provider: 'local_rules'
  parentCandidateId: string | null
  derivationSnapshot: ContentDerivationSnapshot
  projectId: string | null
  draftVersionId: string | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ContentEngineSnapshot {
  sources: ContentSourceRecord[]
  atoms: ContentAtomRecord[]
  derivatives: ContentDerivativeRecord[]
}

export interface ContentSourceImportResult {
  source: ContentSourceRecord
  atoms: ContentAtomRecord[]
  duplicateAtomCount: number
}

export const CONVERSATION_HISTORY_SOURCES = ['codex', 'claude'] as const
export type ConversationHistorySource = (typeof CONVERSATION_HISTORY_SOURCES)[number]

export interface ConversationSourceAvailability {
  source: ConversationHistorySource
  displayName: string
  detected: boolean
  detail: string
}

export interface ConversationMetadata {
  id: string
  source: ConversationHistorySource
  title: string
  updatedAt: string
  sizeBytes: number | null
  lengthLabel: string
}

export interface ConversationMetadataIssue {
  source: ConversationHistorySource
  code: string
  message: string
}

export interface ConversationMetadataResult {
  sources: ConversationSourceAvailability[]
  conversations: ConversationMetadata[]
  issues: ConversationMetadataIssue[]
}

export interface ConversationExcludedBlockSummary {
  blockType: string
  count: number
}

export interface ConversationSelectionIssue {
  sourceId: string | null
  code: string
  message: string
}

export interface ConversationSelectionPreview {
  selected: ConversationMetadata[]
  sanitizedContent: string
  contentSha256: string
  sourceCursors: ConversationSourceCursor[]
  privacy: {
    findingCount: number
    findingKinds: PrivacyFindingKind[]
    customSensitiveTermCount: number
  }
  excludedBlocks: ConversationExcludedBlockSummary[]
  input: {
    conversationCount: number
    turnCount: number
    characterCount: number
    estimatedTokens: number
    truncated: boolean
  }
  budget: {
    status: 'within' | 'warning' | 'blocked'
    softTokenLimit: number
    hardTokenLimit: number
    message: string
  }
  issues: ConversationSelectionIssue[]
}

export interface ConversationSourceCursor {
  sourceId: string
  updatedAt: string
  startOffset: number
  endOffset: number
  lastMessageTimestamp: string | null
  contentHash: string
}

export interface ConversationFilterSourceRef {
  sourceId: string
  messageId: string
  quote: string
  sourceTitle?: string
  sourceUpdatedAt?: string
}

export const CONVERSATION_FILTER_CANDIDATE_STATUSES = ['review_pending', 'confirmed', 'parked', 'discarded', 'not_topic'] as const
export type ConversationFilterCandidateStatus = (typeof CONVERSATION_FILTER_CANDIDATE_STATUSES)[number]
export const CONVERSATION_FILTER_DESTINATION_KINDS = ['content_inspiration', 'topic', 'project'] as const
export type ConversationFilterDestinationKind = (typeof CONVERSATION_FILTER_DESTINATION_KINDS)[number]
export const CONVERSATION_FILTER_REVIEW_GROUPS = ['recommended', 'needs_judgment', 'not_topic'] as const
export type ConversationFilterReviewGroup = (typeof CONVERSATION_FILTER_REVIEW_GROUPS)[number]
export const CONVERSATION_FILTER_SIMILARITY_KINDS = ['published_project', 'active_project', 'existing_topic', 'parked_direction'] as const
export type ConversationFilterSimilarityKind = (typeof CONVERSATION_FILTER_SIMILARITY_KINDS)[number]

export interface ConversationFilterSimilarity {
  kind: ConversationFilterSimilarityKind
  targetId: string
  targetTitle: string
  score: number
}

export interface ConversationFilterCandidate {
  id: string
  taskId: string
  atomType: ContentAtomType
  themeTitle: string
  themeKey: string
  directionTitle: string
  directionKey: string
  title: string
  content: string
  valueReason: string
  riskNotes: string[]
  sourceRefs: ConversationFilterSourceRef[]
  approximateDuplicateGroupKey: string | null
  contentHash: string
  reviewGroup: ConversationFilterReviewGroup
  similarities: ConversationFilterSimilarity[]
  sourceOccurrenceCount: number
  suppressionKind: 'discarded' | 'done' | null
  status: ConversationFilterCandidateStatus
  destinationKind: ConversationFilterDestinationKind | null
  destinationId: string | null
  parkedAt: string | null
  discardedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ConversationFilterTaskSnapshot {
  version: 1
  createdAt: string
  selection: ConversationSelectionPreview
  providerSecurity: TextProviderExecutionContext
  scan?: {
    scanId: string
    mode: 'deep' | 'incremental'
    batchIndex: number
    batchCount: number
    sourceVersions: ConversationSourceCursor[]
  }
}

export interface ConversationScanPlan {
  mode: 'deep' | 'incremental'
  sourceScope: 'codex' | 'claude' | 'both'
  totalConversationCount: number
  eligibleConversationCount: number
  previouslyScannedCount: number
  estimatedCharacters: number
  estimatedTokens: number
  estimateIsPartial: boolean
}

export interface ConversationScanStartResult {
  scanId: string
  mode: 'deep' | 'incremental'
  conversationCount: number
  estimatedTokens: number
  tasks: TaskRun[]
  skippedIssues: ConversationSelectionIssue[]
}

export interface ConversationScanPreflight {
  preflightId: string
  mode: 'deep' | 'incremental'
  sourceScope: 'codex' | 'claude' | 'both'
  providerConfigId: string
  providerLabel: string
  providerTransport: 'cli' | 'api'
  conversationCount: number
  batchCount: number
  estimatedTokens: number
  characterCount: number
  privacyFindingCount: number
  privacyFindingKinds: PrivacyFindingKind[]
  excludedBlocks: ConversationExcludedBlockSummary[]
  issues: ConversationSelectionIssue[]
}

export interface ConversationScanPreflightBatch {
  preflightId: string
  batchIndex: number
  batchCount: number
  sourceTitles: string[]
  sanitizedContent: string
  privacyFindingCount: number
  privacyFindingKinds: PrivacyFindingKind[]
  excludedBlocks: ConversationExcludedBlockSummary[]
  characterCount: number
  estimatedTokens: number
}

export interface ConversationScanProgress {
  scanId: string | null
  mode: 'deep' | 'incremental' | null
  totalBatches: number
  completedBatches: number
  failedBatches: number
  activeBatches: number
  pausedBatches: number
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
}

export type ConversationFilterDecisionInput =
  | { action: 'confirm' }
  | { action: 'confirm_new_direction' }
  | { action: 'append_topic'; topicId: string }
  | { action: 'append_project'; projectId: string }
  | { action: 'park' }
  | { action: 'discard' }
  | { action: 'mark_done' }
  | { action: 'restore' }

export interface ConversationFilterBatchDecisionResult {
  candidates: ConversationFilterCandidate[]
  topicIds: string[]
  captureIds: string[]
  projectIds: string[]
}

export interface TopicDirectionRecord {
  id: string
  topicId: string
  themeTitle: string
  themeKey: string
  title: string
  summary: string
  isPrimary: boolean
  sourceRefs: ConversationFilterSourceRef[]
  sourceCandidateId: string | null
  createdAt: string
  updatedAt: string
}

export type ConversationFilterDestinationInput =
  | { kind: 'content_inspiration'; contentTypeId: string }
  | { kind: 'topic'; contentTypeId: string }
  | { kind: 'existing_project'; projectId: string }
  | { kind: 'new_project'; title: string; contentTypeId: string; templateId: string | null }

export interface ConversationFilterDestinationResult {
  candidate: ConversationFilterCandidate
  captureId: string | null
  topicId: string | null
  projectId: string | null
}

export interface ContentDerivationPreparation {
  contentTypeId: string
  templateId: string | null
  automaticResources: ResourceRecord[]
  recommendedResources: ResourceRecord[]
  manualResources: ResourceRecord[]
  excludedRecommendedResourceIds: string[]
  selectedManualResourceIds: string[]
}

export interface StylePreferenceEntry {
  id: string
  projectId: string
  sourceVersionId: string
  finalVersionId: string
  note: string
  createdAt: string
}

export interface FileReferenceInput {
  id: string
  kind?: 'file' | 'folder'
  relativePath: string
  managedLocator?: string
  originalName: string
  sha256: string
  sizeBytes: number
  mimeType: string
  sourceModifiedAt?: string | null
  createdAt: string
  updatedAt?: string
  encryptedSourcePath?: string | null
  sourceBookmark?: string | null
  sourceOrigin?: 'finder_drop' | 'file_picker' | 'mobile_android' | 'managed_import' | 'generated'
  availability?: 'available' | 'source_missing' | 'permission_required' | 'failed'
  processState?: 'pending' | 'ready' | 'failed' | 'stored_only'
  capabilitiesJson?: string
}

export const PROJECT_MATERIAL_ROLES = ['brief', 'project_material'] as const
export type ProjectMaterialRole = (typeof PROJECT_MATERIAL_ROLES)[number]
export const PROJECT_MATERIAL_SOURCE_KINDS = ['file', 'folder', 'text', 'link'] as const
export type ProjectMaterialSourceKind = (typeof PROJECT_MATERIAL_SOURCE_KINDS)[number]
export const PROJECT_MATERIAL_PARSE_STATUSES = ['pending', 'ready', 'failed', 'stored_only', 'link_only'] as const
export type ProjectMaterialParseStatus = (typeof PROJECT_MATERIAL_PARSE_STATUSES)[number]
export const PROJECT_ASSET_USAGE_TYPES = ['opinion', 'parameter_fact', 'material_clue'] as const
export type ProjectAssetUsageType = (typeof PROJECT_ASSET_USAGE_TYPES)[number]

export interface ProjectMaterialRecord {
  id: string
  projectId: string
  role: ProjectMaterialRole
  sourceKind: ProjectMaterialSourceKind
  title: string
  textContent: string | null
  sourceUrl: string | null
  fileId: string | null
  fileName: string | null
  pageCount: number | null
  parseStatus: ProjectMaterialParseStatus
  isPrimaryReference: boolean
  attentionNote: string
  createdAt: string
  updatedAt: string
}

export const MATERIAL_RESEARCH_SOURCE_TYPES = ['official', 'primary', 'media', 'commerce', 'community', 'other'] as const
export type MaterialResearchSourceType = (typeof MATERIAL_RESEARCH_SOURCE_TYPES)[number]
export const MATERIAL_RESEARCH_CLAIM_STATUSES = ['supported', 'conflict', 'unverified'] as const
export type MaterialResearchClaimStatus = (typeof MATERIAL_RESEARCH_CLAIM_STATUSES)[number]

export interface MaterialResearchSource {
  id: string
  title: string
  url: string
  publisher: string
  domain: string
  sourceType: MaterialResearchSourceType
  publishedAt: string | null
  accessedAt: string
}

export interface MaterialResearchClaim {
  id: string
  heading: string
  content: string
  status: MaterialResearchClaimStatus
  sourceIds: string[]
}

export interface MaterialResearchResult {
  suggestedTitle: string
  overview: string
  claims: MaterialResearchClaim[]
  conflicts: Array<{ topic: string; details: string; sourceIds: string[] }>
  unresolved: string[]
  sources: MaterialResearchSource[]
  searchedAt: string
}

export interface MaterialResearchSession {
  id: string
  taskId: string
  projectId: string
  request: string
  requestedTitle: string
  status: TaskStatus
  progress: number
  result: MaterialResearchResult | null
  savedMaterialId: string | null
  errorMessage: string | null
  requestedAt: string
  finishedAt: string | null
}

export interface ProjectAssetLinkRecord {
  id: string
  projectId: string
  projectMaterialId: string
  fileReferenceId: string
  parentLinkId: string | null
  relativePath: string
  position: number
  usageType: ProjectAssetUsageType | null
  isPrimaryReference: boolean
  attentionNote: string
  fileName: string
  fileKind: 'file' | 'folder'
  mimeType: string
  availability: 'available' | 'source_missing' | 'permission_required' | 'failed'
  processState: 'pending' | 'ready' | 'failed' | 'stored_only'
  capabilities: string[]
  createdAt: string
  updatedAt: string
}

export const PROJECT_ASSET_IMPORT_STATUSES = ['success', 'stored_only', 'partial', 'failed'] as const
export type ProjectAssetImportStatus = (typeof PROJECT_ASSET_IMPORT_STATUSES)[number]

export interface ProjectAssetImportItemResult {
  sourceName: string
  status: ProjectAssetImportStatus
  materialId: string | null
  fileCount: number
  folderCount: number
  storedOnlyCount: number
  failedEntries: { relativePath: string; message: string }[]
  message: string | null
}

export interface ProjectAssetImportBatchResult {
  canceled: boolean
  items: ProjectAssetImportItemResult[]
  importedRootCount: number
  storedOnlyFileCount: number
  failedEntryCount: number
}

export const CAPTURE_ATTACHMENT_KINDS = ['image', 'video', 'audio', 'pdf', 'word', 'file'] as const
export type CaptureAttachmentKind = (typeof CAPTURE_ATTACHMENT_KINDS)[number]

export interface CaptureAssetLinkRecord {
  id: string
  captureId: string
  fileReferenceId: string
  attachmentKind: CaptureAttachmentKind
  position: number
  fileName: string
  mimeType: string
  sizeBytes: number
  sourceModifiedAt?: string | null
  processState: 'pending' | 'ready' | 'failed' | 'stored_only'
  capabilities: string[]
  createdAt: string
}

export const PUBLISHING_MATERIAL_KINDS = ['title', 'description', 'cover', 'tags', 'subtitle', 'video'] as const
export type PublishingMaterialKind = (typeof PUBLISHING_MATERIAL_KINDS)[number]

export interface PublishingMaterial {
  id: string
  projectId: string
  platform: string
  materialKind: PublishingMaterialKind
  textValue: string | null
  fileId: string | null
  fileName: string | null
  sourceVersionId: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface PublishingDraft {
  projectId: string
  platform: string
  title: string
  description: string
  tags: string[]
  sourceVersionId: string
}

export const PUBLISHING_ACCOUNT_STATUSES = ['active', 'disabled'] as const
export type PublishingAccountStatus = (typeof PUBLISHING_ACCOUNT_STATUSES)[number]

export interface PublishingAccount {
  id: string
  platform: string
  accountName: string
  positioning: string
  maskedPhone: string | null
  maskedEmail: string | null
  status: PublishingAccountStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface PublishingAccountSelection {
  projectId: string
  platform: string
  accountId: string
  updatedAt: string
}

export interface PublishingAccountState {
  accounts: PublishingAccount[]
  selections: PublishingAccountSelection[]
  secureStorageAvailable: boolean
}

export const DISTRIBUTION_BATCH_STATUSES = ['draft', 'completed'] as const
export type DistributionBatchStatus = (typeof DISTRIBUTION_BATCH_STATUSES)[number]
export const DISTRIBUTION_SOURCE_KINDS = ['project_final', 'manual_script', 'subtitle'] as const
export type DistributionSourceKind = (typeof DISTRIBUTION_SOURCE_KINDS)[number]
export const DISTRIBUTION_TARGET_STATUSES = ['pending', 'published', 'skipped'] as const
export type DistributionTargetStatus = (typeof DISTRIBUTION_TARGET_STATUSES)[number]

export interface DistributionTarget {
  id: string
  segmentId: string
  platform: string
  accountId: string
  accountName: string
  status: DistributionTargetStatus
  note: string
  updatedAt: string
}

export interface DistributionSegment {
  id: string
  batchId: string
  position: number
  startTimecode: string
  endTimecode: string
  theme: string
  summary: string
  fileId: string | null
  fileName: string | null
  fileAvailability: 'available' | 'source_missing' | 'permission_required' | 'failed' | null
  targets: DistributionTarget[]
  createdAt: string
  updatedAt: string
}

export interface DistributionBatch {
  id: string
  title: string
  sourceKind: DistributionSourceKind
  sourceProjectId: string | null
  sourceProjectTitle: string | null
  sourceVersionId: string | null
  sourceText: string
  status: DistributionBatchStatus
  analysisTaskId: string | null
  completedAt: string | null
  segments: DistributionSegment[]
  createdAt: string
  updatedAt: string
}

export interface DistributionCompletionResult {
  batch: DistributionBatch
  pendingTargetCount: number
  requiresConfirmation: boolean
}

export const COVER_LAYOUTS = ['bilibili_landscape', 'xiaohongshu_portrait'] as const
export type CoverLayout = (typeof COVER_LAYOUTS)[number]
export const COVER_GENERATION_MODES = ['ai_finished', 'stable_layers'] as const
export type CoverGenerationMode = (typeof COVER_GENERATION_MODES)[number]

export interface CoverCandidate {
  id: string
  projectId: string
  taskId: string
  fileId: string
  fileName: string
  platform: string
  layout: CoverLayout
  generationMode: CoverGenerationMode
  headline: string
  promptSnapshot: string
  sourceVersionId: string
  position: number
  isSelected: boolean
  createdAt: string
}

export interface TitleCandidate {
  id: string
  projectId: string
  taskId: string
  platform: string
  provider: Extract<ProviderKind, 'codex_cli' | 'claude_cli'>
  angle: string
  title: string
  coverText: string
  sourceVersionId: string
  masterTitleSnapshot: string | null
  isSelected: boolean
  createdAt: string
}

export interface PublishingPlatformCapability {
  id: string
  platform: string
  targetUrl: string
  titleLimit: number
  handoffMode: 'manual_only' | 'manual_fallback'
  supportsSubtitle: boolean
  checklist: readonly string[]
}

export const PUBLISHING_PLATFORM_CAPABILITIES: readonly PublishingPlatformCapability[] = Object.freeze([
  { id: 'bilibili-web', platform: 'B站', targetUrl: 'https://member.bilibili.com/platform/upload/video/frame', titleLimit: 80, handoffMode: 'manual_fallback', supportsSubtitle: true, checklist: ['确认分区与类型', '确认封面在各端裁切正常', '发布前检查简介与标签'] },
  { id: 'xiaohongshu-web', platform: '小红书', targetUrl: 'https://creator.xiaohongshu.com/publish/publish', titleLimit: 20, handoffMode: 'manual_only', supportsSubtitle: false, checklist: ['确认笔记类型', '检查首图和关键词', '发布前确认话题'] },
  { id: 'douyin-web', platform: '抖音', targetUrl: 'https://creator.douyin.com/', titleLimit: 55, handoffMode: 'manual_fallback', supportsSubtitle: false, checklist: ['确认作品封面', '检查作品描述和话题', '确认发布设置'] },
  { id: 'toutiao-web', platform: '头条', targetUrl: 'https://mp.toutiao.com/', titleLimit: 30, handoffMode: 'manual_fallback', supportsSubtitle: true, checklist: ['确认发布类型', '检查标题和封面', '确认原创与声明'] },
  { id: 'weixin-channels-web', platform: '视频号', targetUrl: 'https://channels.weixin.qq.com/', titleLimit: 30, handoffMode: 'manual_fallback', supportsSubtitle: false, checklist: ['确认视频与封面', '检查描述和活动链接', '发布前确认可见范围'] },
  { id: 'weibo-web', platform: '微博', targetUrl: 'https://weibo.com/', titleLimit: 30, handoffMode: 'manual_fallback', supportsSubtitle: false, checklist: ['确认视频与首图', '检查文案和话题', '发布前确认可见范围'] },
  { id: 'youtube-studio', platform: 'YouTube', targetUrl: 'https://studio.youtube.com/', titleLimit: 100, handoffMode: 'manual_fallback', supportsSubtitle: true, checklist: ['确认频道与可见范围', '检查缩略图和播放列表', '确认字幕语言与儿童内容声明'] }
])

export const PLATFORM_TITLE_LIMITS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(
  PUBLISHING_PLATFORM_CAPABILITIES.map((capability) => [capability.platform, capability.titleLimit])
))

export function platformTitleLimit(platform: string): number | null {
  return PLATFORM_TITLE_LIMITS[platform] ?? null
}

export const SUBTITLE_ARTIFACT_KINDS = ['zh_srt', 'bilingual_srt', 'bilingual_ass', 'plain_transcript'] as const
export type SubtitleArtifactKind = (typeof SUBTITLE_ARTIFACT_KINDS)[number]

export interface SubtitleArtifact {
  id: string
  jobId: string
  projectId: string
  fileId: string
  fileName: string
  artifactKind: SubtitleArtifactKind
  createdAt: string
}

export interface SubtitleAnomaly {
  segmentIndex: number
  start: number
  end: number
  text: string
  confidence: number
}

export interface SubtitleJob {
  id: string
  projectId: string
  taskId: string
  inputFileId: string
  inputFileName: string
  schema: 'zh' | 'bilingual'
  engine: string
  language: string | null
  sourceVersionId: string | null
  confirmedZhArtifactId: string | null
  anomalies: SubtitleAnomaly[]
  stylePreset: Record<string, unknown>
  artifacts: SubtitleArtifact[]
  createdAt: string
  updatedAt: string
}

export const PUBLISHING_HANDOFF_STATUSES = ['prepared', 'opened', 'confirmed', 'failed'] as const
export type PublishingHandoffStatus = (typeof PUBLISHING_HANDOFF_STATUSES)[number]

export interface PublishingHandoff {
  id: string
  projectId: string
  platform: string
  adapterId: string
  targetUrl: string
  status: PublishingHandoffStatus
  packageSnapshot: {
    title: string
    description: string
    tags: string[]
    coverFileId: string
    coverFileName: string
    subtitleFileId: string | null
    subtitleFileName: string | null
    videoFileId: string
    videoFileName: string
    accountId: string
    accountName: string
    sourceVersionId: string
  }
  checklist: string[]
  issues: string[]
  openedAt: string | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export const PUBLISHING_COMPUTER_USE_PILOT_STATUSES = ['prepared', 'page_opened', 'ready_for_review', 'completed', 'failed', 'canceled'] as const
export type PublishingComputerUsePilotStatus = (typeof PUBLISHING_COMPUTER_USE_PILOT_STATUSES)[number]

export interface PublishingComputerUsePilot {
  id: string
  handoffId: string
  projectId: string
  platform: 'B站'
  status: PublishingComputerUsePilotStatus
  accountName: string
  lastError: string | null
  openedAt: string | null
  readyForReviewAt: string | null
  createdAt: string
  updatedAt: string
}

export const FEISHU_HANDOFF_MODES = ['new_document', 'merge_update'] as const
export type FeishuHandoffMode = (typeof FEISHU_HANDOFF_MODES)[number]

export interface FeishuHandoffRecord {
  id: string
  projectId: string
  sourceVersionId: string
  targetHandoffId: string | null
  mode: FeishuHandoffMode
  accountName: string
  documentUrl: string | null
  contentSha256: string
  copiedAt: string | null
  wordExportedAt: string | null
  createdAt: string
  updatedAt: string
}

export const ARCHIVE_CATEGORIES = ['long_video', 'short_video', 'ai_video'] as const
export type ArchiveCategory = (typeof ARCHIVE_CATEGORIES)[number]
export const ARCHIVE_SLOTS = ['landscape_cover', 'portrait_cover', 'business_files', 'subtitle_srt', 'video_clean', 'video_burned_in', 'final_script_docx'] as const
export type ArchiveSlot = (typeof ARCHIVE_SLOTS)[number]
export const ARCHIVE_SELECTION_STATUSES = ['selected', 'not_required', 'not_ready'] as const
export type ArchiveSelectionStatus = (typeof ARCHIVE_SELECTION_STATUSES)[number]
export const ARCHIVE_RUN_STATUSES = ['prepared', 'copying', 'verifying', 'committed', 'waiting_for_nas', 'failed', 'canceled'] as const
export type ArchiveRunStatus = (typeof ARCHIVE_RUN_STATUSES)[number]
export const ARCHIVE_ITEM_STATUSES = ['pending', 'copying', 'verifying', 'committed', 'missing', 'not_required', 'failed', 'canceled'] as const
export type ArchiveItemStatus = (typeof ARCHIVE_ITEM_STATUSES)[number]

export interface NasArchiveDestinationStatus {
  id: 'primary'
  revision: string | null
  configured: boolean
  displayName: string | null
  categoryLabels: Record<ArchiveCategory, string>
  availability: 'not_configured' | 'ready' | 'not_mounted' | 'not_writable' | 'insufficient_space' | 'unavailable'
  freeBytes: number | null
  liveSmbValidated: boolean
  lastCheckedAt: string | null
}

export interface NasBackupStatus {
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  backupDate: string | null
  lastAttemptAt: string | null
  lastSucceededAt: string | null
  errorMessage: string | null
}

export interface ArchivePlanItem {
  slot: ArchiveSlot
  ordinal: number
  status: ArchiveSelectionStatus
  displayName: string
  sizeBytes: number | null
  sourceFileId: string | null
  sourceVersionId: string | null
  sourceSha256: string | null
}

export interface ArchivePlan {
  id: string
  projectId: string
  category: ArchiveCategory
  categoryLabel: string
  year: number
  yearDirectory: string
  sequence: number
  folderName: string
  planHash: string
  expiresAt: string
  identityFrozen: boolean
  items: ArchivePlanItem[]
  missingCount: number
  notRequiredCount: number
  destination: NasArchiveDestinationStatus
  destinationRevision: string
}

export interface ArchiveRunItem {
  id: string
  slot: ArchiveSlot
  ordinal: number
  selectionStatus: ArchiveSelectionStatus
  sourceFileId: string | null
  sourceVersionId: string | null
  sourceName: string
  sizeBytes: number | null
  sourceSha256: string | null
  targetSha256: string | null
  finalName: string | null
  status: ArchiveItemStatus
  errorCode: string | null
  temporaryRemoved: boolean | null
  createdAt: string
  updatedAt: string
}

export interface ArchiveRun {
  id: string
  projectId: string
  taskRunId: string
  category: ArchiveCategory
  year: number
  sequence: number
  folderName: string
  status: ArchiveRunStatus
  planHash: string
  confirmedAt: string
  manifestSha256: string | null
  manifestFileName: string | null
  missingCount: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  items: ArchiveRunItem[]
}

export const REBATE_REQUIREMENTS = ['pending_confirmation', 'not_required', 'required'] as const
export type RebateRequirement = (typeof REBATE_REQUIREMENTS)[number]
export const REBATE_INPUT_MODES = ['rate', 'amount'] as const
export type RebateInputMode = (typeof REBATE_INPUT_MODES)[number]
export const BUSINESS_PAYMENT_STATUSES = ['pending', 'received'] as const
export type BusinessPaymentStatus = (typeof BUSINESS_PAYMENT_STATUSES)[number]
export const BUSINESS_DEAL_STATUSES = ['agreed_pending_order', 'ordered', 'canceled'] as const
export type BusinessDealStatus = (typeof BUSINESS_DEAL_STATUSES)[number]
export const BUSINESS_LIFECYCLE_STATUSES = ['agreed_pending_order', 'ordered', 'settled', 'canceled'] as const
export type BusinessLifecycleStatus = (typeof BUSINESS_LIFECYCLE_STATUSES)[number]
export const REBATE_EXECUTION_STATUSES = ['pending_confirmation', 'not_required', 'waiting_payment', 'pending', 'missing_transfer_proof', 'completed'] as const
export type RebateExecutionStatus = (typeof REBATE_EXECUTION_STATUSES)[number]
export const REBATE_PROCEDURE_STATUSES = ['not_required', 'preparing', 'incomplete', 'complete'] as const
export type RebateProcedureStatus = (typeof REBATE_PROCEDURE_STATUSES)[number]
export const REBATE_RECIPIENT_TYPES = ['unknown', 'corporate', 'personal'] as const
export type RebateRecipientType = (typeof REBATE_RECIPIENT_TYPES)[number]
export const INVOICE_REQUIREMENTS = ['pending_confirmation', 'not_required', 'required'] as const
export type InvoiceRequirement = (typeof INVOICE_REQUIREMENTS)[number]
export const INVOICE_STATUSES = ['pending', 'issued', 'voided', 'red_flushed'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export const INVOICE_EXECUTION_STATUSES = ['pending_confirmation', 'not_required', 'pending', 'issued'] as const
export type InvoiceExecutionStatus = (typeof INVOICE_EXECUTION_STATUSES)[number]
export const BUSINESS_LEDGER_STATUSES = ['agreed_pending_order', 'missing_transfer_proof', 'rebate_pending', 'invoice_pending', 'payment_pending', 'completed', 'canceled'] as const
export type BusinessLedgerStatus = (typeof BUSINESS_LEDGER_STATUSES)[number]
export const BUSINESS_FILE_ROLES = ['rebate_contract', 'invoice_file', 'rebate_payment_proof', 'chat_screenshot'] as const
export type BusinessFileRole = (typeof BUSINESS_FILE_ROLES)[number]
export const BUSINESS_EVENT_ACTIONS = ['created', 'updated', 'imported', 'project_linked', 'project_detached', 'manual_settled', 'manual_settlement_canceled', 'trashed', 'restored', 'invoice_saved', 'file_imported'] as const
export type BusinessEventAction = (typeof BUSINESS_EVENT_ACTIONS)[number]

export interface BusinessRecord {
  projectId: string
  dealStatus: BusinessDealStatus
  lifecycleStatus: BusinessLifecycleStatus
  manualSettledAt: string | null
  settlementMode: 'automatic' | 'manual' | null
  orderPlatform: string
  orderPlatformManuallySet: boolean
  orderDate: string | null
  revenueMonth: string | null
  quotedAmountCents: number | null
  platformOrderAmountCents: number | null
  rebateInputMode: RebateInputMode
  finalRebateRatePercent: number | null
  finalRebateAmountCents: number | null
  effectiveFinalRebateAmountCents: number | null
  rebateRequirement: RebateRequirement
  rebateRecipientType: RebateRecipientType
  rebateRecipientName: string
  rebateExecutionStatus: RebateExecutionStatus
  rebateProcedureStatus: RebateProcedureStatus
  plannedRebateDate: string | null
  paymentStatus: BusinessPaymentStatus
  paymentReceivedDate: string | null
  invoiceRequirement: InvoiceRequirement
  invoiceReceivedManuallyAt: string | null
  invoiceExecutionStatus: InvoiceExecutionStatus
  ledgerStatus: BusinessLedgerStatus
  videoProductionCostCents: number
  trafficPromotionCostCents: number
  incomeAttributionDate: string | null
  effectiveIncomeAttributionDate: string | null
  totalPaidRebateCents: number
  remainingRebateCents: number | null
  expectedIncomeCents: number | null
  expectedIncomeRatePercent: number | null
  notes: string
  trashedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface BusinessRecordInput {
  dealStatus?: BusinessDealStatus
  manualSettled?: boolean
  orderPlatform: string
  orderPlatformManuallySet?: boolean
  orderDate: string | null
  revenueMonth?: string | null
  quotedAmountCents: number | null
  platformOrderAmountCents: number | null
  rebateInputMode?: RebateInputMode
  finalRebateRatePercent: number | null
  finalRebateAmountCents: number | null
  rebateRequirement: RebateRequirement
  rebateRecipientType: RebateRecipientType
  rebateRecipientName: string
  rebateProcedureStatus: RebateProcedureStatus
  plannedRebateDate: string | null
  paymentStatus: BusinessPaymentStatus
  paymentReceivedDate: string | null
  invoiceRequirement: InvoiceRequirement
  invoiceReceivedManually?: boolean
  videoProductionCostCents: number
  trafficPromotionCostCents: number
  incomeAttributionDate: string | null
  notes: string
}

// Field-level income edits never accept titles, provenance, attachments or computed values.
export type BusinessRecordPatch = Partial<Pick<BusinessRecordInput,
  'dealStatus' | 'manualSettled' | 'orderPlatform' | 'orderPlatformManuallySet' | 'orderDate' | 'revenueMonth' |
  'platformOrderAmountCents' | 'paymentStatus' | 'paymentReceivedDate' | 'rebateRequirement' |
  'rebateInputMode' | 'finalRebateRatePercent' | 'finalRebateAmountCents' | 'rebateRecipientName' |
  'invoiceRequirement' | 'invoiceReceivedManually'
>>
export type OtherIncomeRecordPatch = Partial<Pick<OtherIncomeRecordInput,
  'categoryId' | 'sourceName' | 'revenueMonth' | 'incomeDate' | 'amountCents' |
  'paymentStatus' | 'paymentReceivedDate' | 'status'
>>

export interface RebatePayment {
  id: string
  projectId: string
  amountCents: number
  paidDate: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface BusinessInvoice {
  id: string
  projectId: string
  issuerName: string
  amountCents: number
  issuedDate: string | null
  status: InvoiceStatus
  deliveredToClient: boolean
  notes: string
  linkedProjectIds: string[]
  sharedProjectCount: number
  createdAt: string
  updatedAt: string
}

export interface BusinessFile {
  id: string
  projectId: string
  role: BusinessFileRole
  fileId: string
  fileName: string
  rebatePaymentId: string | null
  invoiceId: string | null
  linkedProjectIds: string[]
  sharedProjectCount: number
  createdAt: string
}

export interface BusinessProjectData {
  record: BusinessRecord
  rebatePayment: RebatePayment | null
  invoices: BusinessInvoice[]
  files: BusinessFile[]
  events: BusinessEvent[]
}

export interface BusinessEvent {
  id: string
  projectId: string
  action: BusinessEventAction
  summary: string
  createdAt: string
}

export interface BusinessAutofillResult {
  title: string | null
  dealStatus: BusinessDealStatus | null
  orderPlatform: string | null
  orderDate: string | null
  revenueMonth: string | null
  quotedAmountCents: number | null
  platformOrderAmountCents: number | null
  finalRebateRatePercent: number | null
  finalRebateAmountCents: number | null
  rebateRequirement: RebateRequirement | null
  rebateRecipientType: RebateRecipientType | null
  rebateRecipientName: string | null
  paymentStatus: BusinessPaymentStatus | null
  paymentReceivedDate: string | null
  invoiceRequirement: InvoiceRequirement | null
  videoProductionCostCents: number | null
  trafficPromotionCostCents: number | null
  notes: string | null
  recognizedFields: string[]
  warnings: string[]
  model: string
}

export interface BusinessFolderScanCandidate {
  id: string
  relativePath: string
  fileName: string
  suggestedRole: BusinessFileRole
  reason: string
  sizeBytes: number
}

export interface BusinessFolderScanResult {
  canceled: boolean
  scanId: string | null
  rootName: string
  candidates: BusinessFolderScanCandidate[]
  ignoredCount: number
  warnings: string[]
}

export interface BusinessLedgerEntry extends BusinessRecord {
  projectTitle: string
  projectColorToken: string
  projectStatus: ProjectStatus
  linkedProjectTrashedAt: string | null
  ledgerOnly: boolean
  invoiceIssuedCents: number
  businessFileCount: number
  sharedBusinessFileCount: number
}

export interface BusinessLedgerLockStatus {
  enabled: boolean
  unlocked: boolean
  securityAvailable: boolean
  touchIdAvailable: boolean
}

export const OTHER_INCOME_RECORD_STATUSES = ['active', 'canceled'] as const
export type OtherIncomeRecordStatus = (typeof OTHER_INCOME_RECORD_STATUSES)[number]
export const OTHER_INCOME_IMPORT_DIRECTIONS = ['income', 'expense', 'refund', 'transfer', 'unknown'] as const
export type OtherIncomeImportDirection = (typeof OTHER_INCOME_IMPORT_DIRECTIONS)[number]
export const OTHER_INCOME_DUPLICATE_CONFIDENCES = ['none', 'possible', 'exact'] as const
export type OtherIncomeDuplicateConfidence = (typeof OTHER_INCOME_DUPLICATE_CONFIDENCES)[number]

export interface OtherIncomeCategory {
  id: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface OtherIncomeRecord {
  id: string
  title: string
  categoryId: string | null
  categoryName: string
  sourceName: string
  revenueMonth: string | null
  incomeDate: string | null
  amountCents: number
  directCostCents: number
  expectedIncomeCents: number
  paymentStatus: BusinessPaymentStatus
  paymentReceivedDate: string | null
  status: OtherIncomeRecordStatus
  currency: string
  notes: string
  sourceReference: string
  sourceTransactionId: string
  sourceHash: string
  originalFileId: string | null
  originalFileName: string | null
  trashedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OtherIncomeRecordInput {
  title: string
  categoryId: string | null
  sourceName: string
  revenueMonth: string | null
  incomeDate: string | null
  amountCents: number
  directCostCents: number
  paymentStatus: BusinessPaymentStatus
  paymentReceivedDate: string | null
  status: OtherIncomeRecordStatus
  currency: string
  notes: string
  sourceReference?: string
  sourceTransactionId?: string
  sourceHash?: string
}

export interface OtherIncomeCompanyAlias {
  id: string
  companyName: string
  alias: string
  createdAt: string
}

export interface OtherIncomeImportRuleConditions {
  companies: string[]
  excludedCompanies: string[]
  includeKeywords: string[]
  excludeKeywords: string[]
  startDate: string | null
  endDate: string | null
  minimumAmountCents: number | null
  maximumAmountCents: number | null
  direction: 'income'
  paymentStatus: BusinessPaymentStatus | null
  categoryId: string | null
  revenueMonth: string | null
}

export interface OtherIncomeImportRule {
  id: string
  name: string
  instruction: string
  conditions: OtherIncomeImportRuleConditions
  createdAt: string
  updatedAt: string
}

export interface OtherIncomeImportSourceRow {
  rowNumber: number
  title: string
  payer: string
  transactionDate: string | null
  revenueMonth: string | null
  amountCents: number | null
  direction: OtherIncomeImportDirection
  paymentStatus: BusinessPaymentStatus | null
  externalTransactionId: string
  summary: string
  currency: string
  rawText: string
}

export interface OtherIncomeImportCandidate extends OtherIncomeImportSourceRow {
  id: string
  selected: boolean
  categoryId: string | null
  directCostCents: number
  matched: boolean
  matchReasons: string[]
  exclusionReasons: string[]
  evidence: string[]
  warnings: string[]
  duplicateConfidence: OtherIncomeDuplicateConfidence
  duplicateRecordId: string | null
  suspectedBusiness: boolean
  sourceHash: string
}

export interface IncomeLedgerTotals {
  totalIncomeCents: number
  actualNetIncomeCents: number
  actualNetKnownCount: number
  actualNetEligibleCount: number
  expectedIncomeCents: number
  expectedNetKnownCount: number
  expectedNetEligibleCount: number
  receivedCents: number
  pendingCents: number
  recordCount: number
}

export interface IncomeLedgerSummary {
  combined: IncomeLedgerTotals
  business: IncomeLedgerTotals
  other: IncomeLedgerTotals
}

export interface ProjectDetail extends ProjectSummary {
  activeOutlineVersionId: string | null
  modules: ProjectModule[]
  latestVersions: DraftVersion[]
  versions: DraftVersion[]
  contentTypeHistory: ProjectContentTypeHistoryEntry[]
  stylePreferences: StylePreferenceEntry[]
  resourceReferences: ProjectResourceReference[]
  stageTimeRecords: StageTimeRecord[]
  materials: ProjectMaterialRecord[]
  assetLinks: ProjectAssetLinkRecord[]
  referenceRequirements: string
  publishingMaterials: PublishingMaterial[]
  coverCandidates: CoverCandidate[]
  titleCandidates: TitleCandidate[]
  subtitleJobs: SubtitleJob[]
  publishingHandoffs: PublishingHandoff[]
  publishingComputerUsePilots: PublishingComputerUsePilot[]
  business: BusinessProjectData | null
}

export const PROJECT_FRAMEWORK_MATERIAL_ID_PREFIX = 'project-framework:'
export const PROJECT_SCRATCH_NOTE_MATERIAL_ID_PREFIX = 'project-scratch-note:'

export interface CaptureRecord {
  id: string
  captureKind: 'topic_idea' | 'project_content' | 'general_record' | 'unknown' | 'client_feedback'
  primaryProjectId: string | null
  referencedProjectIds: string[]
  linkedTopicId: string | null
  classificationStatus: 'unprocessed' | 'suggested' | 'confirmed'
  classificationActor: 'user' | 'system' | null
  classificationConfidence: number | null
  suggestedContentTypeId: string | null
  suggestedProjectId: string | null
  classificationReason: string | null
  classifiedAt: string | null
  useStatus: 'active' | 'parked' | 'discarded'
  discardedAt: string | null
  usageType: 'parameter_fact' | 'opinion' | 'material_clue' | null
  generalCategoryId: string | null
  originalContent: string
  mobileTitle: string | null
  mobileSourceApp: string | null
  mobileSourceTitle: string | null
  mobileSourceUrl: string | null
  mobileNotes: string
  mobileRecordingMarkersMs: number[]
  mobileRecordingInterruptionReason: string | null
  attachments: CaptureAssetLinkRecord[]
  sourceType: 'quick_capture' | 'web_bookmark' | 'notion_import' | 'project' | 'conversation_filter' | 'mobile_android'
  createdAt: string
}

export interface CaptureDeduplicationResult {
  scannedCount: number
  duplicateGroupCount: number
  duplicateCount: number
  retainedCaptureIds: string[]
  discarded: Array<{
    captureId: string
    previousUseStatus: 'active'
  }>
}

export interface CaptureSummary {
  creativeDay: string
  newRecords: number
  pendingReview: number
  todayAutoProcessed: number
}

export interface CaptureDestinationCandidate {
  projectId: string
  title: string
  contentTypeId: string
  score: number
  reason: string
}

export const SCHEDULE_KINDS = ['plan', 'hard_deadline', 'publish_date'] as const
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number]
export const SCHEDULE_STATES = ['normal', 'waiting', 'done', 'overdue'] as const
export type ScheduleState = (typeof SCHEDULE_STATES)[number]

export interface ScheduleItem {
  groupId?: string | null
  trip?: import('./business-trip').BusinessTripMeta | null
  id: string
  projectId: string | null
  colorToken: ProjectColorToken | null
  title: string
  actionType: string
  startAt: string | null
  endAt: string | null
  scheduleKind: ScheduleKind
  state: ScheduleState
  waitingFor: string | null
  source: 'user' | 'project_node' | 'synchronized'
  isMovable: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateScheduleInput {
  projectId: string | null
  colorToken?: ProjectColorToken | null
  title: string
  actionType: 'overview' | OptionalProjectModuleKey
  startAt: string | null
  endAt: string | null
  scheduleKind: ScheduleKind
  waitingFor: string | null
}

export const TODO_SEGMENTS = ['morning', 'afternoon', 'evening'] as const
export type TodoSegment = (typeof TODO_SEGMENTS)[number]
export const TODO_CATEGORIES = ['self_media', 'ai', 'life', 'other_work'] as const
export type TodoCategory = (typeof TODO_CATEGORIES)[number]
export const TODO_CATEGORY_LABELS: Record<TodoCategory, string> = {
  self_media: '自媒体',
  ai: 'AI',
  life: '生活',
  other_work: '健康'
}
export const TODO_CATEGORY_ORDER: TodoCategory[] = ['self_media', 'life', 'ai', 'other_work']
export const TODO_STATUSES = ['open', 'completed', 'dismissed'] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]
export const TODO_TRACKING_MODES = ['checklist', 'progress'] as const
export type TodoTrackingMode = (typeof TODO_TRACKING_MODES)[number]
export const TODO_SOURCES = ['manual', 'schedule'] as const
export type TodoSource = (typeof TODO_SOURCES)[number]

export interface TodoTimeMoveInput {
  todoId: string
  expectedUpdatedAt: string
  day: string
  segment: TodoSegment | null
  target: { todoId: string; expectedUpdatedAt: string } | null
  after: boolean
}

export interface TodoBatchLinkInput {
  items: { todoId: string; expectedUpdatedAt: string; expectedProjectId: string | null; expectedStageKey: StageTimeKey | null }[]
  projectId: string | null
  stageMode: 'preserve' | 'replace'
  stageKey: StageTimeKey | null
  includeClosed: boolean
}

export interface TodoStageStartCandidate {
  todoId: string
  projectId: string
  projectTitle: string
  title: string
  stageKey: StageTimeKey | null
  linkedStageKey: StageTimeKey | null
  stageLinkSource: 'manual' | null
  recommendedStageKey: StageTimeKey | null
  reason: 'manual' | 'text' | 'ambiguous' | 'unknown'
  availableStageKeys: StageTimeKey[]
  plannedDate: string | null
  segment: TodoSegment | null
}
export interface TodoStageStartInput {
  expectedTitle: string
  expectedLinkedStageKey: StageTimeKey | null
  expectedStageLinkSource: 'manual' | null
  todoId: string
  projectId: string
  stageKey: StageTimeKey
  expectedPlannedDate: string | null
  expectedSegment: TodoSegment | null
  startedAt: StageTimePoint
  requestId: string
}

export interface TodoProjectStage {
  key: StageTimeKey
  enabled: boolean
  completedAt: string | null
  startedAt: StageTimePoint | null
  actualCompletedAt: StageTimePoint | null
  plannedStartAt: StageTimePoint | null
  plannedEndAt: StageTimePoint | null
  status: StageTimeStatus
  revision: string
  currentPoint: StageTimePoint
}
export interface TodoStageTimeInput {
  todoId: string
  projectId: string
  stageKey: StageTimeKey
  expectedRevision: string
  expectedTodoUpdatedAt: string
  action: 'start' | 'complete' | 'edit'
  startedAt: StageTimePoint | null
  completedAt: StageTimePoint | null
  confirmedOpenTodoIds: string[]
  requestId: string
}
export interface TodoStageCompletionInput {
  todoId: string
  projectId: string
  stageKey: StageTimeKey
  expectedCompletedAt: string | null
  completed: boolean
  confirmedOpenTodoIds?: string[]
  requestId: string
}

export interface TodoDateRange {
  startDate: string
  endDate: string
  name: string
}

export interface TodoItem {
  isExtra?: boolean
  dateRange?: TodoDateRange | null
  stageLinkSource?: 'manual' | null
  stageKey?: StageTimeKey | null
  id: string
  title: string
  plannedDate: string | null
  segment: TodoSegment | null
  category: TodoCategory
  projectId: string | null
  status: TodoStatus
  trackingMode: TodoTrackingMode
  progress: number
  progressBeforeComplete: number | null
  source: TodoSource
  sourceScheduleId: string | null
  sourcePlannedDate: string | null
  sourceSegment: TodoSegment | null
  scheduleSyncEnabled: boolean
  completedAt: string | null
  dismissedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTodoInput {
  stageSelection?: 'manual' | 'suggested'
  categorySelection?: 'manual' | 'suggested'
  isExtra?: boolean
  dateRange?: TodoDateRange | null
  stageKey?: StageTimeKey | null
  title: string
  plannedDate: string | null
  segment: TodoSegment | null
  category: TodoCategory
  suggestedCategory?: TodoCategory
  projectId: string | null
  trackingMode: TodoTrackingMode
  progress: number
}

export interface UpdateTodoInput {
  expectedUpdatedAt?: string
  isExtra?: boolean
  dateRange?: TodoDateRange | null
  stageKey?: StageTimeKey | null
  title?: string
  plannedDate?: string | null
  segment?: TodoSegment | null
  category?: TodoCategory
  projectId?: string | null
  trackingMode?: TodoTrackingMode
  progress?: number
  completed?: boolean
}

export interface DailyWorkLog {
  totalMinutes?: number | null
  day: string
  selfMediaMinutes: number
  aiMinutes: number
  otherWorkMinutes: number
  updatedAt: string
}

export interface ClassificationSuggestion {
  captureId: string
  status: 'unprocessed' | 'suggested' | 'confirmed'
  projectId: string | null
  contentTypeId: string | null
  confidence: number | null
  reason: string | null
  actor: 'user' | 'system'
  captureKind?: 'topic_idea' | 'project_content' | 'general_record'
  generalCategoryId?: string | null
}

export const TASK_STATUSES = ['queued', 'running', 'waiting_confirmation', 'succeeded', 'failed', 'canceled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_TYPES = ['draft_generation', 'outline_generation', 'conversation_filter', 'capture_classification', 'report_discussion', 'script_revision', 'script_material_extract', 'script_material_generate', 'script_material_chat', 'script_material_map', 'script_material_audit', 'draft_source_generation', 'draft_alignment', 'draft_split_match', 'draft_candidate', 'title_generation', 'distribution_analysis', 'subtitle_generation', 'fact_verification', 'material_research', 'external_import', 'image_generation', 'publishing_handoff', 'feedback_ingest', 'nas_archive', 'mock_demo'] as const
export type TaskType = (typeof TASK_TYPES)[number]
export const PROVIDER_KINDS = ['mock', 'codex_cli', 'claude_cli', 'external_api', 'none'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]
export const PROVIDER_CAPABILITY_STATUSES = ['available', 'not_installed', 'verification_required', 'verifying', 'verification_failed'] as const
export type ProviderCapabilityStatus = (typeof PROVIDER_CAPABILITY_STATUSES)[number]

export interface TaskPermissionProfile {
  network: 'off' | 'web_search' | 'provider_only'
  readableRefs: string[]
  writableTarget: 'new_version' | 'candidate_fact' | 'candidate_asset' | 'archive' | 'none'
  shell: false
}

export interface TaskRun {
  id: string
  taskType: TaskType
  projectId: string | null
  title: string
  provider: ProviderKind
  model: string | null
  status: TaskStatus
  progress: number
  inputSnapshot: string
  projectDescriptionSnapshot: string | null
  taskContentTypeId: string | null
  taskTemplateId: string | null
  resourceSnapshot: TaskResourceSnapshot | null
  permissionProfile: TaskPermissionProfile
  outputTarget: string | null
  resultSummary: string | null
  errorCode: string | null
  errorMessage: string | null
  retryOfId: string | null
  requiresConfirmation: boolean
  requestedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface ProviderCapability {
  provider: ProviderKind
  available: boolean
  status: ProviderCapabilityStatus
  displayName: string
  executablePath: string | null
  detail: string
}

export interface CodexWritingModelOption {
  id: string
  displayName: string
  isDefault: boolean
  reasoningEfforts: string[]
}

export const EXTERNAL_PROVIDER_KINDS = ['openai_api', 'anthropic_api', 'gemini_api', 'deepseek_api', 'openai_compatible'] as const
export type ExternalProviderKind = (typeof EXTERNAL_PROVIDER_KINDS)[number]
export const EXTERNAL_PROVIDER_STATUSES = ['unverified', 'available', 'failed'] as const
export type ExternalProviderStatus = (typeof EXTERNAL_PROVIDER_STATUSES)[number]
export const BUILTIN_TEXT_PROVIDER_CONFIG_IDS = {
  codex: 'codex_cli_text_v1',
  claude: 'claude_cli_text_v1'
} as const

export interface ExternalProviderConfig {
  id: string
  kind: ExternalProviderKind
  displayName: string
  baseUrl: string
  model: string
  hasApiKey: boolean
  status: ExternalProviderStatus
  lastValidatedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface ProviderSettings {
  securityAvailable: boolean
  configs: ExternalProviderConfig[]
  defaultProviderConfigId: string
  fallbackProviderConfigId: string | null
}

export interface ExternalProviderConfigInput {
  id?: string
  kind: ExternalProviderKind
  displayName: string
  baseUrl?: string
  model: string
  apiKey?: string
}

export type TextProviderExecutionContext =
  | {
      provider: 'codex_cli' | 'claude_cli'
      providerConfigId: string
      displayName: string
      cliVersion: string
      fingerprint: string
      policyVersion: string
    }
  | {
      provider: 'external_api'
      providerConfigId: string
      displayName: string
      kind: ExternalProviderKind
      baseUrl: string
      model: string
      configurationUpdatedAt: string
    }

export interface ExternalFileRelation {
  id: string
  projectId: string
  displayName: string
  lastVersionId: string
  status: 'active' | 'missing' | 'paused'
  lastSyncedAt: string
}

export interface TopicRecord {
  videoFormat?: VideoFormat | null
  isCommercial?: boolean
  id: string
  title: string
  coreAngle: string
  contentTypeId: string
  importanceLevel: number
  needsMoreExperience: boolean
  startAt: string | null
  expectedCompletionAt: string | null
  actualCompletionAt: string | null
  scheduleVarianceDays: number | null
  nextActionKind: 'advance_stage' | 'create_project' | 'open_project' | 'restart_project' | 'none'
  nextStageId: string | null
  stageId: string
  customValues: Record<string, string | null>
  sourceCaptureIds: string[]
  createdProjectId: string | null
  lastProjectDeletedAt: string | null
  trashedAt: string | null
  directions: TopicDirectionRecord[]
}

export type TopicBuiltinColumnKey = 'video' | 'kind' | 'title' | 'importance' | 'direction' | 'stage' | 'start' | 'expected' | 'actual' | 'variance' | 'next' | 'inspirations'
export type TopicColumnDataType = 'text' | 'number' | 'date' | 'relation' | 'action'

export interface TopicColumnDefinition {
  id: string
  name: string
  position: number
  dataType: TopicColumnDataType
  builtinKey: TopicBuiltinColumnKey | null
  isVisible: boolean
  createdAt: string
  updatedAt: string
}

export interface TopicStageDefinition {
  id: string
  name: string
  nextActionLabel: string | null
  position: number
  role: TopicStageRole
  createdAt: string
  updatedAt: string
}

export interface TopicStageDeleteResult {
  stages: TopicStageDefinition[]
  reassignedTopicCount: number
  replacementStageName: string
}

export interface CreateTopicInput {
  videoFormat?: VideoFormat | null
  isCommercial?: boolean
  title: string
  coreAngle: string
  contentTypeId: string
  importanceLevel: number
  needsMoreExperience: boolean
  startAt: string | null
  expectedCompletionAt: string | null
  actualCompletionAt: string | null
  stageId: string
}

export type UpdateTopicInput = Partial<CreateTopicInput>

export interface LinkGroupRecord {
  id: string
  projectId: string
  colorToken: string
  labelIndex: number
  selectedText: string
  mergedVersionId: string
  claudeVersionId: string | null
  codexVersionId: string | null
  matchType: 'exact'
  createdAt: string
}

export interface WorkspaceTabState {
  id: string
  history: string[]
  historyIndex: number
  lastUsedAt: string
}

export const SIDEBAR_NAVIGATION_ITEM_IDS = ['home', 'ideas', 'topics', 'projects', 'schedule', 'tools', 'business', 'other-income', 'resources'] as const
export type SidebarNavigationItemId = (typeof SIDEBAR_NAVIGATION_ITEM_IDS)[number]

export interface SidebarNavigationGroupPreference {
  id: string
  name: string
  itemIds: SidebarNavigationItemId[]
  expanded: boolean
  isCustom: boolean
}

export interface SidebarLayoutPreference {
  version: 1
  groups: SidebarNavigationGroupPreference[]
  hiddenItemIds: SidebarNavigationItemId[]
}

export const createDefaultSidebarLayout = (): SidebarLayoutPreference => ({
  version: 1,
  groups: [
    { id: 'workspace', name: '工作区', itemIds: ['home', 'ideas', 'topics', 'projects', 'schedule'], expanded: true, isCustom: false },
    { id: 'creation', name: '创作', itemIds: ['tools'], expanded: true, isCustom: false },
    { id: 'income', name: '收入台账', itemIds: ['business', 'other-income'], expanded: true, isCustom: false },
    { id: 'more', name: '更多', itemIds: ['resources'], expanded: true, isCustom: false }
  ],
  hiddenItemIds: []
})

// 目标平台的固定清单与顺序；头条紧邻抖音，与新建项目、设置默认共用同一来源
export const PROJECT_PLATFORMS = ['B站', '小红书', '抖音', '头条', '视频号', '微博', 'YouTube'] as const
export const PROJECT_COLOR_TOKENS = [
  'project-1', 'project-2', 'project-3', 'project-4', 'project-5', 'project-6',
  'project-7', 'project-8', 'project-9', 'project-10', 'project-11', 'project-12'
] as const
export type ProjectColorToken = (typeof PROJECT_COLOR_TOKENS)[number]
export const DEFAULT_TODO_CATEGORY_COLORS: Record<TodoCategory, ProjectColorToken> = {
  self_media: 'project-4',
  ai: 'project-8',
  life: 'project-2',
  other_work: 'project-1'
}
export const DEFAULT_TODO_CATEGORY_LABELS: Record<TodoCategory, string> = { ...TODO_CATEGORY_LABELS }
export const DEFAULT_TODO_CATEGORY_WEIGHTS: Record<TodoCategory, number> = {
  self_media: 30,
  ai: 20,
  life: 20,
  other_work: 30
}

export function isProjectColorToken(value: unknown): value is ProjectColorToken {
  return typeof value === 'string' && PROJECT_COLOR_TOKENS.includes(value as ProjectColorToken)
}

export function projectColorForIndex(index: number): ProjectColorToken {
  const normalized = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0
  return PROJECT_COLOR_TOKENS[normalized % PROJECT_COLOR_TOKENS.length] ?? PROJECT_COLOR_TOKENS[0]
}

// 新建项目时对标题+描述的自动归类结果；confidence 低于阈值时前端自动展开分类让用户手选
export interface ProjectDraftClassification {
  contentTypeId: string | null
  templateId: string | null
  confidence: number
  reason: string
}

export type ColorScheme = 'light' | 'dark'
export type VisualStyle = 'warm' | 'feishu'

export interface AppearanceSnapshot {
  theme: ColorScheme
  visualStyle: VisualStyle
}

export interface TodoCategoryMemory {
  title: string
  normalizedTitle: string
  category: TodoCategory
  projectId: string | null
  updatedAt: string
}

export interface WorkspacePreferences {
  theme: ColorScheme
  visualStyle: VisualStyle
  homeSplit: number
  companionTodoView?: 'all' | 'time' | 'category'
  companionTodoOrder?: string[]
  homeTodoView: 'time' | 'category'
  lastProjectModuleById: Record<string, ProjectModuleKey>
  workbenchLayout: 'equal' | 'models' | 'merged'
  workbenchModelSplit: number
  workbenchMergedSplit: number
  workbenchMergedVisible: boolean
  workbenchView: ScriptWorkbenchView
  workbenchSingleProvider: ScriptWorkbenchSingleProvider
  workbenchDualActiveProvider: ScriptWorkbenchSingleProvider
  workbenchConversationTab: ScriptWorkbenchConversationTab
  workbenchHiddenProviders: ScriptWorkbenchSingleProvider[]
  workbenchConversationScrollTops: ScriptConversationScrollTops
  workbenchComparisonSide: DraftComparisonSide
  workbenchComparisonSplit: number
  workbenchComparisonPreviewSplit: number
  workbenchComparisonScrollTop: number
  workbenchComparisonColorMode: DraftComparisonColorMode
  workbenchComparisonDocumentMode: DraftComparisonDocumentMode
  workbenchComparisonUseOutline: boolean
  workbenchComparisonSplitScope: 'current' | 'matched'
  workbenchDraftCurrentScrollTop: number
  workbenchPrimaryView: 'conversation' | 'comparison' | 'versions'
  workbenchComparisonKind: 'drafts' | 'materials'
  workbenchDraftSurface: 'organize' | 'current'
  workbenchVersionSurface: 'compare' | 'current'
  workbenchVersionMobileSide: 'left' | 'right'
  workbenchVersionSourcePanelOpen: boolean
  workbenchVersionDiffVisible: boolean
  workbenchVersionScrollTops: ScriptVersionScrollTops
  workbenchVersionCurrentScrollTop: number
  workbenchMaterialTab: ScriptMaterialMobileTab
  workbenchMaterialScrollTops: ScriptMaterialScrollTops
  workbenchCodexModel: string | null
  sidebarCollapsed: boolean
  sidebarWidth: number
  sidebarPinnedExpanded: boolean
  sidebarStageShortcutsExpanded: boolean
  sidebarLayout: SidebarLayoutPreference
  pinnedProjectOrder: string[]
  pinnedProjectStages: ProjectStageShortcutPreference[]
  inspectorWidth: number
  scheduleUnscheduledWidth: number
  scheduleUnscheduledCollapsed: boolean
  scheduleInspectorCollapsed: boolean
  workspaceTabs: WorkspaceTabState[]
  activeWorkspaceTabId: string
  defaultPlatforms: string[]
  businessPlatforms: string[]
  otherIncomeSourceTemplates: string[]
  defaultContentTypeId: string | null
  autoClassifyNewProject: boolean
  computerUsePublishBilibili: boolean
  weatherCity: string
  weatherPreviewCondition: WeatherCondition | null
  weatherPreviewPeriod: WeatherPeriod | null
  todoCategoryColors: Record<TodoCategory, ProjectColorToken>
  todoCategoryLabels: Record<TodoCategory, string>
  todoCategoryWeights: Record<TodoCategory, number>
  todoStageMemories?: import('./todo-stage-memory').TodoStageMemory[]
  todoCategoryMemories: TodoCategoryMemory[]
}

export type WorkbenchPreferences = Pick<WorkspacePreferences, 'workbenchLayout' | 'workbenchModelSplit' | 'workbenchMergedSplit' | 'workbenchMergedVisible' | 'workbenchView' | 'workbenchSingleProvider' | 'workbenchDualActiveProvider' | 'workbenchConversationTab' | 'workbenchHiddenProviders' | 'workbenchConversationScrollTops' | 'workbenchComparisonSide' | 'workbenchComparisonSplit' | 'workbenchComparisonPreviewSplit' | 'workbenchComparisonScrollTop' | 'workbenchComparisonColorMode' | 'workbenchComparisonDocumentMode' | 'workbenchComparisonUseOutline' | 'workbenchComparisonSplitScope' | 'workbenchDraftCurrentScrollTop' | 'workbenchPrimaryView' | 'workbenchComparisonKind' | 'workbenchDraftSurface' | 'workbenchVersionSurface' | 'workbenchVersionMobileSide' | 'workbenchVersionSourcePanelOpen' | 'workbenchVersionDiffVisible' | 'workbenchVersionScrollTops' | 'workbenchVersionCurrentScrollTop' | 'workbenchMaterialTab' | 'workbenchMaterialScrollTops' | 'workbenchCodexModel'>

export const RECYCLE_CATEGORIES = ['projects', 'ideas', 'topics', 'filter_candidates'] as const
export type RecycleCategory = (typeof RECYCLE_CATEGORIES)[number]

export interface RecycleEmptySkippedItem {
  id: string
  title: string
  category: RecycleCategory
  reason: string
}

export interface RecycleEmptyResult {
  deletedCount: number
  skipped: RecycleEmptySkippedItem[]
}

export interface WorkspaceSnapshot {
  today: string
  contentTypes: ContentTypeDefinition[]
  generalRecordCategories: GeneralRecordCategory[]
  projectTemplates: ProjectTemplateDefinition[]
  resources: ResourceRecord[]
  projects: ProjectSummary[]
  businessLedger: BusinessLedgerEntry[]
  otherIncomeCategories: OtherIncomeCategory[]
  otherIncomeRecords: OtherIncomeRecord[]
  otherIncomeImportRules: OtherIncomeImportRule[]
  otherIncomeCompanyAliases: OtherIncomeCompanyAlias[]
  incomeLedgerSummary: IncomeLedgerSummary
  captures: CaptureRecord[]
  captureSummary: CaptureSummary
  topics: TopicRecord[]
  topicStages: TopicStageDefinition[]
  topicColumns: TopicColumnDefinition[]
  discardedFilterCandidates: ConversationFilterCandidate[]
  schedules: ScheduleItem[]
  todoDays?: import('./todo-day').TodoDay[]
  todos: TodoItem[]
  dailyWorkLog: DailyWorkLog
  productionChecklist: ProductionChecklistSummary[]
  tasks: TaskRun[]
  providerCapabilities: ProviderCapability[]
  preferences: WorkspacePreferences
}

export interface CaptureContext {
  projects: Pick<ProjectSummary, 'id' | 'title' | 'contentTypeName' | 'status' | 'isCommercial'>[]
  preferredProjectId: string | null
  preferredCaptureKind: 'project_content' | 'client_feedback' | null
  theme: ColorScheme
  visualStyle: VisualStyle
}

export interface MobileSyncDevice {
  id: string
  name: string
  protocolVersion: 1 | 2
  trustState: 'legacy_v1' | 'trusted_v2'
  createdAt: string
  lastSeenAt: string | null
  upgradedAt: string | null
  revokedAt: string | null
}

export interface MobileSyncPendingPairing {
  sessionId: string
  deviceName: string
  shortAuthenticationString: string
  requestedAt: string
  expiresAt: string
  upgradeDeviceId: string | null
}

export interface MobileSyncStatus {
  enabled: boolean
  running: boolean
  securityAvailable: boolean
  port: number | null
  addresses: string[]
  serviceName: string | null
  serviceId: string
  advertised: boolean
  protocolVersion: 2
  error: string | null
  pendingPairings: MobileSyncPendingPairing[]
  devices: MobileSyncDevice[]
}

export interface MobileCaptureReceipt {
  mobileCaptureId: string
  desktopCaptureId: string
  duplicate: boolean
  classificationStatus: CaptureRecord['classificationStatus']
}

export interface ImportedDraftResult {
  canceled: boolean
  version?: DraftVersion
  sourceName?: string
}

export interface CreateProjectInput {
  videoFormat?: VideoFormat | null
  isCommercial?: boolean
  title: string
  description: string
  contentTypeId: string
  templateId?: string | null
  colorToken?: ProjectColorToken
  platformTargets: string[]
  aiSuggestedContentTypeId?: string | null
}

export * from './domain/structured-reference'
export * from './domain/structured-reference-role'
