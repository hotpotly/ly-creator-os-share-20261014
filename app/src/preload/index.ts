import { todoCopyResultSchema } from '../shared/todo-reschedule'
import { workspaceAccessStateSchema } from '../shared/workspace-access'
import { todoDaySchema } from '../shared/todo-day'
import { REVIEW_CHANNELS, reviewDataSchema, reviewPeriodSchema, reviewEntrySchema } from '../shared/personal-review'
import { todoProjectStagesSchema, todoStageStartCandidateSchema } from '../shared/ipc'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  appInfoSchema,
  appearanceSnapshotSchema,
  captureContextSchema,
  codexWritingModelOptionSchema,
  contentFactEvidenceSchema,
  contentInstructionDispatchResultSchema,
  importedDraftResultSchema,
  IPC_CHANNELS,
  linkGroupSchema,
  preferencesSchema,
  projectProductionNotesSchema,
  workbenchPreferencesSchema,
  RESPONSE_SCHEMAS,
  type CreatorOSApi
} from '../shared/ipc'

function workLogExpected(input: Parameters<CreatorOSApi['setDailyWorkLog']>[2]): Parameters<CreatorOSApi['setDailyWorkLog']>[2] {
  if (!input) return undefined
  return { selfMediaMinutes: input.selfMediaMinutes, aiMinutes: input.aiMinutes, otherWorkMinutes: input.otherWorkMinutes, ...(input.totalMinutes === undefined ? {} : { totalMinutes: input.totalMinutes }) }
}

const api: CreatorOSApi = {
  async getPersonalReview(query) { return reviewDataSchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.get, query)) },
  async savePersonalReview(period) { return reviewPeriodSchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.save, period)) },
  async saveReviewEntry(entry) { return reviewEntrySchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.entrySave, entry)) },
  async getReviewEntry(id) { return reviewEntrySchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.entryGet, id)) },
  async searchReviewEntries(query) { return reviewEntrySchema.array().parse(await ipcRenderer.invoke(REVIEW_CHANNELS.search, query)) },
  async importReviewImages(entry, images) { return reviewEntrySchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.importImages, { entry, images })) },
  async attachReviewImages(id) { return reviewEntrySchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.attach, id)) },
  async detachReviewImage(entryId, fileId) { return reviewEntrySchema.parse(await ipcRenderer.invoke(REVIEW_CHANNELS.detach, { entryId, fileId })) },
  async previewReviewImage(entryId, fileId) {
    const result: unknown = await ipcRenderer.invoke(REVIEW_CHANNELS.preview, { entryId, fileId })
    if (typeof result !== 'string' || !result.startsWith('data:image/png;base64,')) throw new Error('图片响应无效')
    return result
  },
  async getAppInfo() {
    return appInfoSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.getAppInfo, {}))
  },
  async openExternalLink(url) {
    await ipcRenderer.invoke(IPC_CHANNELS.externalLinkOpen, { url })
  },
  async listCodexWritingModels() {
    return codexWritingModelOptionSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.codexWritingModelsList, {}))
  },
  async listStructuredReferenceCatalog(projectId, sessionScope, query = '') {
    return RESPONSE_SCHEMAS.structuredReferenceCatalogItemSchema.array().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.structuredReferenceCatalogList, { projectId, sessionScope, query })
    )
  },
  async resolveStructuredReferenceRoles(input) {
    return RESPONSE_SCHEMAS.structuredReferenceRoleResolutionSchema.array().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.structuredReferenceRolesResolve, input)
    )
  },
  async setProjectReferenceRolePreference(input) {
    return RESPONSE_SCHEMAS.projectReferenceRolePreferenceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectReferenceRolePreferenceSet, input)
    )
  },
  async removeProjectReferenceRolePreference(input) {
    await ipcRenderer.invoke(IPC_CHANNELS.projectReferenceRolePreferenceRemove, input)
  },
  async dispatchContentInstruction(input) {
    return contentInstructionDispatchResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.contentInstructionDispatch, input)
    )
  },
  async getContentInstructionRequest(requestId) {
    return RESPONSE_SCHEMAS.contentInstructionRequestRecordSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.contentInstructionRequestGet, { requestId })
    )
  },
  async getContentInstructionRequestByTask(taskId) {
    return RESPONSE_SCHEMAS.contentInstructionRequestRecordSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.contentInstructionRequestGetByTask, { taskId })
    )
  },
  async getContentFactEvidence(projectId, evidenceIds) {
    return contentFactEvidenceSchema.array().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.contentFactEvidenceGet, { projectId, evidenceIds })
    )
  },
  async openCapture(projectId, captureKind) {
    await ipcRenderer.invoke(IPC_CHANNELS.openCapture, { projectId: projectId ?? null, captureKind: captureKind ?? null })
  },
  async closeCapture() {
    await ipcRenderer.invoke(IPC_CHANNELS.closeCapture, {})
  },
  async openTodoWidget() {
    await ipcRenderer.invoke(IPC_CHANNELS.todoWindowOpenWidget, {})
  },
  async openTodoMainWindow() {
    await ipcRenderer.invoke(IPC_CHANNELS.todoWindowOpenMain, {})
  },
  async closeTodoWindow() {
    await ipcRenderer.invoke(IPC_CHANNELS.todoWindowClose, {})
  },
  async getWorkspace() {
    return RESPONSE_SCHEMAS.workspaceSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workspaceGet, {}))
  },
  async getWeather(force) {
    return RESPONSE_SCHEMAS.weatherSceneSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.weatherGet, { force: force ?? false }))
  },
  async createManualBackup() {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.workspaceBackupCreate, {}) as { createdAt?: unknown; label?: unknown }
    if (typeof result.createdAt !== 'string' || typeof result.label !== 'string') throw new Error('备份结果无效')
    return { createdAt: result.createdAt, label: result.label }
  },
  async chooseWorkspaceBackupToRestore() {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.workspaceBackupRestoreChoose, {}) as { scheduled?: unknown }
    return { scheduled: result.scheduled === true }
  },
  async searchGlobal(query, limit) {
    return RESPONSE_SCHEMAS.globalSearchResultSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.globalSearch, { query, limit }))
  },
  async getWorkspaceUndoState() {
    return RESPONSE_SCHEMAS.workspaceUndoStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workspaceUndoStateGet, {}))
  },
  async undoWorkspaceOperation(operationId) {
    return RESPONSE_SCHEMAS.workspaceUndoResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workspaceUndo, { operationId: operationId ?? null }))
  },
  async getProject(projectId, touch) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectGet, { projectId, touch }))
  },
  async createProject(input) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectCreate, input))
  },
  async trashProject(projectId) {
    return RESPONSE_SCHEMAS.projectSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectTrash, { projectId }))
  },
  async renameProject(projectId, title) {
    return RESPONSE_SCHEMAS.projectSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectRename, { projectId, title }))
  },
  async setProjectPinned(projectId, pinned) {
    return RESPONSE_SCHEMAS.projectSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetPinned, {
      projectId,
      pinned,
      requestId: globalThis.crypto.randomUUID()
    }))
  },
  async setProjectColor(projectId, colorToken) {
    return RESPONSE_SCHEMAS.projectSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetColor, { projectId, colorToken }))
  },
  async classifyProjectDraft(title, description) {
    return RESPONSE_SCHEMAS.projectDraftClassificationSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectClassifyDraft, { title, description }))
  },
  async restoreProject(projectId) {
    return RESPONSE_SCHEMAS.projectSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectRestore, { projectId }))
  },
  async permanentlyDeleteProject(projectId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.projectDeletePermanently, { projectId }))
  },
  async setProjectLifecycle(projectId, lifecycle) {
    return RESPONSE_SCHEMAS.projectSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetLifecycle, { projectId, lifecycle }))
  },
  async updateProjectClassification(projectId, patch) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectUpdateClassification, { projectId, patch }))
  },
  async updateProjectContentType(projectId, contentTypeId) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectUpdateContentType, { projectId, contentTypeId }))
  },
  async updateProjectPlatforms(projectId, platformTargets) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectUpdatePlatforms, { projectId, platformTargets }))
  },
  async saveProjectTemplate(input) {
    return RESPONSE_SCHEMAS.projectTemplateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectTemplateSave, input))
  },
  async previewProjectTemplate(projectId, templateId) {
    return RESPONSE_SCHEMAS.projectTemplateDiffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectTemplatePreview, { projectId, templateId }))
  },
  async applyProjectTemplate(projectId, templateId) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectTemplateApply, { projectId, templateId }))
  },
  async setProjectModule(projectId, moduleKey, enabled) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetModule, { projectId, moduleKey, enabled }))
  },
  async reorderProjectModules(projectId, moduleKeys) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectReorderModules, { projectId, moduleKeys }))
  },
  async setModuleCompleted(projectId, moduleKey, completed) {
    return RESPONSE_SCHEMAS.stageTimeMutationResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetModuleCompleted, {
      projectId,
      moduleKey,
      completed,
      requestId: globalThis.crypto.randomUUID()
    }))
  },
  async getStageTimeContext() {
    return RESPONSE_SCHEMAS.stageTimeContextSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectStageTimeContextGet, {}))
  },
  async updateStageTime(projectId, stageKey, patch, requestId) {
    return RESPONSE_SCHEMAS.stageTimeUpdateResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectStageTimeUpdate, {
      projectId,
      stageKey,
      ...patch,
      requestId: requestId ?? globalThis.crypto.randomUUID()
    }))
  },
  async setStageTimeStatus(projectId, stageKey, action) {
    return RESPONSE_SCHEMAS.stageTimeMutationResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectStageTimeSetStatus, { projectId, stageKey, action }))
  },
  async undoStageTimeEvent(projectId, eventId) {
    return RESPONSE_SCHEMAS.stageTimeMutationResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectStageTimeUndo, { projectId, eventId }))
  },
  async getCreationReport(kind, anchorDate, force) {
    return RESPONSE_SCHEMAS.creationReportSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.creationReportGet, { kind, anchorDate, force: force ?? false }))
  },
  async listCreationReportSnapshots(kind, periodStart) {
    return RESPONSE_SCHEMAS.creationReportSnapshotSummarySchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.creationReportSnapshotList, {
      kind,
      periodStart
    }))
  },
  async getCreationReportSnapshotById(snapshotId) {
    return RESPONSE_SCHEMAS.creationReportSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.creationReportSnapshotGetById, { snapshotId }))
  },
  async getProjectCreationReview(projectId) {
    return RESPONSE_SCHEMAS.projectCreationReviewSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectCreationReviewGet, { projectId }))
  },
  async getCreationReportConversation(snapshotId) {
    return RESPONSE_SCHEMAS.creationReportConversationSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.creationReportConversationGet, { snapshotId }))
  },
  async sendCreationReportMessage(snapshotId, provider, message) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.creationReportMessageSend, { snapshotId, provider, message }))
  },
  async getScriptRevisionConversation(projectId, threadId, provider, surface) {
    return RESPONSE_SCHEMAS.scriptRevisionConversationSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scriptRevisionConversationGet, {
      projectId, threadId: threadId ?? null, provider: provider ?? null, surface: surface ?? 'conversation'
    }))
  },
  async sendScriptRevisionMessage(input) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scriptRevisionMessageSend, input))
  },
  async validateScriptRevisionApply(projectId, messageId, currentText) {
    return RESPONSE_SCHEMAS.scriptRevisionApplyValidationSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scriptRevisionApplyValidate, { projectId, messageId, currentText }))
  },
  async setScriptRevisionSuggestionStatus(projectId, messageId, status) {
    return RESPONSE_SCHEMAS.scriptRevisionMessageSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scriptRevisionSuggestionStatusSet, { projectId, messageId, status }))
  },
  async loadProjectCurrentScript(projectId) {
    return RESPONSE_SCHEMAS.projectCurrentScriptLoadResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptLoad, { projectId })
    )
  },
  async initializeProjectCurrentScript(input) {
    return RESPONSE_SCHEMAS.projectCurrentScriptLoadResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptInitialize, input)
    )
  },
  async applyProjectCurrentScriptTransaction(input) {
    return RESPONSE_SCHEMAS.applyProjectCurrentScriptResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptApply, input)
    )
  },
  async saveProjectCurrentScriptVersion(input) {
    return RESPONSE_SCHEMAS.saveProjectCurrentScriptVersionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptVersionSave, input)
    )
  },
  async restoreProjectCurrentScriptVersion(input) {
    return RESPONSE_SCHEMAS.restoreProjectCurrentScriptVersionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptVersionRestore, input)
    )
  },
  async getCurrentScriptVersionSnapshot(projectId, versionId) {
    return RESPONSE_SCHEMAS.projectCurrentScriptSnapshotSchema.nullable().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptVersionSnapshotGet, { projectId, versionId })
    )
  },
  async listCurrentScriptRecoveryCandidates(projectId) {
    return RESPONSE_SCHEMAS.currentScriptRecoveryCandidateSchema.array().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptRecoveryList, { projectId })
    )
  },
  async resolveCurrentScriptRecovery(input) {
    return RESPONSE_SCHEMAS.resolvedCurrentScriptRecoverySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCurrentScriptRecoveryResolve, input)
    )
  },
  async listSourceScriptAnnotations(projectId, query) {
    return RESPONSE_SCHEMAS.scriptTextAnnotationSchema.array().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sourceScriptAnnotationsList, { projectId, ...query })
    )
  },
  async upsertSourceScriptAnnotation(input) {
    return RESPONSE_SCHEMAS.scriptTextAnnotationSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sourceScriptAnnotationUpsert, input)
    )
  },
  async deleteSourceScriptAnnotation(projectId, annotationId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.sourceScriptAnnotationDelete, { projectId, annotationId }))
  },
  async getScriptMaterialWorkspace(projectId) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialGet, { projectId })
    )
  },
  async saveScriptMaterialWorkspace(projectId, patch) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialWorkspaceSave, { projectId, ...patch })
    )
  },
  async createScriptMaterialRevision(projectId) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialRevisionCreate, { projectId })
    )
  },
  async replaceScriptMaterialPoints(projectId, revisionId, points) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialPointsReplace, { projectId, revisionId, points })
    )
  },
  async confirmScriptMaterialPoints(projectId, revisionId) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialPointsConfirm, { projectId, revisionId })
    )
  },
  async updateScriptMaterialPoint(projectId, revisionId, pointId, patch) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialPointUpdate, { projectId, revisionId, pointId, ...patch })
    )
  },
  async confirmScriptMaterialAnnotations(projectId, draftId, paragraphId, annotationIds) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialAnnotationConfirm, { projectId, draftId, paragraphId, annotationIds })
    )
  },
  async setScriptMaterialManualMarks(projectId, draftId, paragraphId, marks) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialManualMarksSet, { projectId, draftId, paragraphId, marks })
    )
  },
  async startScriptMaterialExtraction(projectId, providerConfigId, includeProjectContext) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialExtractStart, { projectId, providerConfigId, includeProjectContext })
    )
  },
  async startScriptMaterialGeneration(projectId, side, providerConfigId, includeProjectContext) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialGenerateStart, { projectId, side, providerConfigId, includeProjectContext })
    )
  },
  async startScriptMaterialAudit(projectId, target, providerConfigId, currentContent, draftId, currentParagraphs) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialAuditStart, { projectId, target, providerConfigId, currentContent, draftId, currentParagraphs })
    )
  },
  async setScriptMaterialAllowedOmissions(projectId, targetIdentity, pointIds) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialAllowedOmissionsSet, { projectId, targetIdentity, pointIds })
    )
  },
  async confirmScriptMaterialFinding(projectId, targetIdentity, findingId, resolutionNote) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialFindingConfirm, { projectId, targetIdentity, findingId, resolutionNote })
    )
  },
  async getScriptMaterialFinalizationGate(projectId, currentContent) {
    return RESPONSE_SCHEMAS.scriptMaterialFinalizationGateSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialFinalizationGateGet, { projectId, currentContent })
    )
  },
  async getScriptMaterialVersionSnapshot(projectId, versionId) {
    return RESPONSE_SCHEMAS.scriptMaterialVersionSnapshotSchema.nullable().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialVersionSnapshotGet, { projectId, versionId })
    )
  },
  async restoreScriptMaterialVersionSnapshot(projectId, versionId) {
    return RESPONSE_SCHEMAS.scriptMaterialWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialVersionSnapshotRestore, { projectId, versionId })
    )
  },
  async startScriptMaterialMapping(projectId, draftId, providerConfigId, currentDocumentParagraphs) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.scriptMaterialMapStart, {
        projectId,
        draftId,
        providerConfigId,
        currentDocumentParagraphs: currentDocumentParagraphs ?? []
      })
    )
  },
  async getDraftComparisonWorkspace(projectId, sessionId) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftComparisonGet, { projectId, sessionId: sessionId ?? null }))
  },
  async saveDraftComparisonDrafts(projectId, patch) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftComparisonDraftsSave, { projectId, ...patch }))
  },
  async setDraftComparisonCurrentDocumentBase(projectId, revision, contentHash) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftComparisonCurrentDocumentBaseSet, { projectId, revision, contentHash }))
  },
  async generateDraftSource(input) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftSourceGenerate, input))
  },
  async startDraftAlignment(projectId, providerConfigId, includeProjectContext, options) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftAlignmentStart, {
      projectId,
      providerConfigId,
      includeProjectContext,
      useOutline: options?.useOutline ?? true,
      confirmFull: options?.confirmFull ?? false
    }))
  },
  async addFreeformDraftCandidate(projectId, groupId, content, requirement) {
    return RESPONSE_SCHEMAS.draftCandidateRevisionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftCandidateFreeformAdd, { projectId, groupId, content, requirement }))
  },
  async deleteDraftCandidate(projectId, candidateId) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftCandidateDelete, { projectId, candidateId }))
  },
  async moveDraftCandidate(projectId, candidateId, toGroupId) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftCandidateMove, { projectId, candidateId, toGroupId }))
  },
  async reorderDraftCandidates(projectId, groupId, candidateIds) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftCandidateReorder, { projectId, groupId, candidateIds }))
  },
  async setDraftGroupDecision(input) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftDecisionSet, input))
  },
  async setDraftGroupNote(projectId, groupId, note) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftDecisionNoteSet, { projectId, groupId, note }))
  },
  async setDraftGroupMarkers(projectId, groupId, markers) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftDecisionMarkersSet, { projectId, groupId, markers }))
  },
  async mergeDraftAlignmentGroups(projectId, groupIds) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftGroupMerge, { projectId, groupIds }))
  },
  async splitDraftAlignmentGroup(input) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftGroupSplit, input))
  },
  async startDraftAlignmentSplit(input) {
    return RESPONSE_SCHEMAS.draftAlignmentSplitStartResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.draftAlignmentSplitStart, input)
    )
  },
  async reorderDraftAlignmentGroups(projectId, groupIds) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftGroupReorder, { projectId, groupIds }))
  },
  async moveDraftParagraph(input) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftParagraphMove, input))
  },
  async moveDraftParagraphs(input) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.draftParagraphsMove, input))
  },
  async listDraftComparisonHistory(projectId) {
    return RESPONSE_SCHEMAS.draftComparisonHistoryEntrySchema.array().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.draftComparisonHistoryList, { projectId })
    )
  },
  async restoreDraftComparisonHistory(projectId, historyId) {
    return RESPONSE_SCHEMAS.draftComparisonWorkspaceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.draftComparisonHistoryRestore, { projectId, historyId })
    )
  },
  async updateProjectDescription(projectId, description) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectUpdateDescription, { projectId, description }))
  },
  async saveOutline(projectId, items, parentVersionIds, outline) {
    return RESPONSE_SCHEMAS.draftVersionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSaveOutline, { projectId, items, parentVersionIds, outlineId: outline?.id, outlineName: outline?.name }))
  },
  async setActiveOutlineVersion(projectId, versionId) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectOutlineSelectionSet, { projectId, versionId }))
  },
  async startOutlineGeneration(input) {
    return RESPONSE_SCHEMAS.taskRunSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.outlineGenerationStart, input))
  },
  async saveScript(projectId, kind, content, sourceVersionId, displayName) {
    return RESPONSE_SCHEMAS.draftVersionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSaveScript, { projectId, kind, content, sourceVersionId, displayName }))
  },
  async saveAndFinalizeScript(projectId, content, sourceVersionId, displayName) {
    return RESPONSE_SCHEMAS.draftVersionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSaveAndFinalizeScript, { projectId, content, sourceVersionId, displayName }))
  },
  async exportScriptWord(projectId, title, html) {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.scriptExportWord, { projectId, title, html }) as { canceled: boolean; path: string | null }
    return { canceled: Boolean(result.canceled), path: typeof result.path === 'string' ? result.path : null }
  },
  async listFeishuHandoffs(projectId) {
    return RESPONSE_SCHEMAS.feishuHandoffSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.feishuHandoffList, { projectId }))
  },
  async copyFeishuHandoff(input) {
    return RESPONSE_SCHEMAS.feishuHandoffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.feishuHandoffCopy, input))
  },
  async exportFeishuHandoffWord(input) {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.feishuHandoffExportWord, input) as { canceled?: unknown; path?: unknown; record?: unknown }
    return {
      canceled: Boolean(result.canceled),
      path: typeof result.path === 'string' ? result.path : null,
      record: result.record ? RESPONSE_SCHEMAS.feishuHandoffSchema.parse(result.record) : null
    }
  },
  async saveFeishuHandoffLink(input) {
    return RESPONSE_SCHEMAS.feishuHandoffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.feishuHandoffSaveLink, input))
  },
  async openFeishuHandoff(projectId, handoffId) {
    return RESPONSE_SCHEMAS.feishuHandoffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.feishuHandoffOpen, { projectId, handoffId }))
  },
  async getNasArchiveDestination() {
    return RESPONSE_SCHEMAS.nasArchiveDestinationStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveDestinationGet, {}))
  },
  async chooseNasArchiveDestination() {
    return RESPONSE_SCHEMAS.nasArchiveDestinationStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveDestinationChoose, {}))
  },
  async clearNasArchiveDestination() {
    return RESPONSE_SCHEMAS.nasArchiveDestinationStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveDestinationClear, {}))
  },
  async setNasArchiveCategoryLabels(labels) {
    return RESPONSE_SCHEMAS.nasArchiveDestinationStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveCategoryLabelsSet, { labels }))
  },
  async chooseNasArchiveSlotFile(projectId, slot) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveSlotChoose, { projectId, slot }))
  },
  async setNasArchiveSlotStatus(projectId, slot, status) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveSlotStatusSet, { projectId, slot, status }))
  },
  async prepareNasArchivePlan(projectId, category) {
    return RESPONSE_SCHEMAS.archivePlanSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchivePlanPrepare, { projectId, category }))
  },
  async confirmNasArchivePlan(planId, planHash) {
    return RESPONSE_SCHEMAS.archiveRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchivePlanConfirm, { planId, planHash }))
  },
  async listNasArchiveRuns(projectId) {
    return RESPONSE_SCHEMAS.archiveRunSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveRunsList, { projectId }))
  },
  async getNasArchiveRun(runId) {
    return RESPONSE_SCHEMAS.archiveRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveRunGet, { runId }))
  },
  async cancelNasArchiveRun(runId) {
    return RESPONSE_SCHEMAS.archiveRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveRunCancel, { runId }))
  },
  async retryNasArchiveRun(runId) {
    return RESPONSE_SCHEMAS.archiveRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasArchiveRunRetry, { runId }))
  },
  async getNasBackupStatus() {
    return RESPONSE_SCHEMAS.nasBackupStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasBackupStatusGet, {}))
  },
  async runNasBackup() {
    return RESPONSE_SCHEMAS.nasBackupStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.nasBackupRun, {}))
  },
  async setFinalVersion(projectId, versionId) {
    return RESPONSE_SCHEMAS.draftVersionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetFinalVersion, { projectId, versionId }))
  },
  async confirmStylePreference(projectId, sourceVersionId, finalVersionId, note) {
    return RESPONSE_SCHEMAS.stylePreferenceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.stylePreferenceConfirm, { projectId, sourceVersionId, finalVersionId, note }))
  },
  async importScript(projectId) {
    return importedDraftResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectImportScript, { projectId }))
  },
  async importScriptFile(projectId, name, bytes) {
    return importedDraftResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectImportScriptFile, { projectId, name, bytes }))
  },
  async createLinkGroup(input) {
    return linkGroupSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.linkGroupCreate, input))
  },
  async listLinkGroups(projectId, mergedVersionId) {
    return linkGroupSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.linkGroupList, { projectId, mergedVersionId }))
  },
  async deleteLinkGroup(projectId, linkGroupId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.linkGroupDelete, { projectId, linkGroupId }))
  },
  async getCaptureContext(preferredProjectId, preferredCaptureKind) {
    return captureContextSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureContextGet, {
      preferredProjectId: preferredProjectId ?? null,
      preferredCaptureKind: preferredCaptureKind ?? null
    }))
  },
  async saveCapture(input) {
    return RESPONSE_SCHEMAS.captureSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureSave, input))
  },
  async startCaptureClassification() {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.captureClassificationStart, {})
    return result ? RESPONSE_SCHEMAS.taskRunSchema.parse(result) : null
  },
  async deduplicateCapturesExact() {
    return RESPONSE_SCHEMAS.captureDeduplicationResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureDeduplicateExact, {}))
  },
  async confirmCaptureClassification(captureId, projectId, contentTypeId, captureKind, generalCategoryId) {
    return RESPONSE_SCHEMAS.captureSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureConfirmClassification, { captureId, projectId, contentTypeId, captureKind, generalCategoryId }))
  },
  async undoCaptureClassification(captureId) {
    return RESPONSE_SCHEMAS.captureSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureUndoClassification, { captureId }))
  },
  async listCaptureDestinationCandidates(captureId) {
    return RESPONSE_SCHEMAS.captureDestinationCandidateSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.captureDestinationsList, { captureId }))
  },
  async setCaptureUseStatus(captureId, useStatus) {
    return RESPONSE_SCHEMAS.captureSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureSetUseStatus, { captureId, useStatus }))
  },
  async permanentlyDeleteCapture(captureId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.captureDeletePermanently, { captureId }))
  },
  async restoreFilterCandidate(candidateId) {
    return RESPONSE_SCHEMAS.conversationFilterCandidateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.filterCandidateRestore, { candidateId }))
  },
  async permanentlyDeleteFilterCandidate(candidateId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.filterCandidateDeletePermanently, { candidateId }))
  },
  async emptyRecycleBin() {
    return RESPONSE_SCHEMAS.recycleEmptyResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.recycleEmpty))
  },
  async revealProjectFolder(projectId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.projectRevealFolder, { projectId }))
  },
  async trashTopic(topicId) {
    return RESPONSE_SCHEMAS.topicSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicTrash, { topicId }))
  },
  async restoreTopic(topicId) {
    return RESPONSE_SCHEMAS.topicSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicRestore, { topicId }))
  },
  async permanentlyDeleteTopic(topicId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.topicDeletePermanently, { topicId }))
  },
  async attachCaptureToTopic(captureId, topicId) {
    return RESPONSE_SCHEMAS.captureSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.captureAttachTopic, { captureId, topicId }))
  },
  async createGeneralRecordCategory(name) {
    return RESPONSE_SCHEMAS.generalRecordCategorySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.generalCategoryCreate, { name }))
  },
  async updateGeneralRecordCategory(generalCategoryId, patch) {
    return RESPONSE_SCHEMAS.generalRecordCategorySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.generalCategoryUpdate, { generalCategoryId, ...patch }))
  },
  async createTopic(input) {
    return RESPONSE_SCHEMAS.topicSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicCreate, input))
  },
  async updateTopic(topicId, patch) {
    return RESPONSE_SCHEMAS.topicSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicUpdate, { topicId, patch }))
  },
  async createProjectFromTopic(topicId) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicCreateProject, { topicId }))
  },
  async createTopicStage(name) {
    return RESPONSE_SCHEMAS.topicStageDefinitionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicStageCreate, { name }))
  },
  async updateTopicStage(stageId, name, nextActionLabel) {
    return RESPONSE_SCHEMAS.topicStageDefinitionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicStageUpdate, { stageId, name, nextActionLabel }))
  },
  async reorderTopicStages(stageIds) {
    return RESPONSE_SCHEMAS.topicStageDefinitionSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.topicStageReorder, { stageIds }))
  },
  async deleteTopicStage(stageId) {
    return RESPONSE_SCHEMAS.topicStageDeleteResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicStageDelete, { stageId }))
  },
  async createTopicColumn(name, dataType) {
    return RESPONSE_SCHEMAS.topicColumnDefinitionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicColumnCreate, { name, dataType }))
  },
  async updateTopicColumn(columnId, patch) {
    return RESPONSE_SCHEMAS.topicColumnDefinitionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicColumnUpdate, { columnId, patch }))
  },
  async reorderTopicColumns(columnIds) {
    return RESPONSE_SCHEMAS.topicColumnDefinitionSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.topicColumnReorder, { columnIds }))
  },
  async deleteTopicColumn(columnId) {
    return RESPONSE_SCHEMAS.topicColumnDefinitionSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.topicColumnDelete, { columnId }))
  },
  async setTopicCustomValue(topicId, columnId, value) {
    return RESPONSE_SCHEMAS.topicSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.topicCustomValueSet, { topicId, columnId, value }))
  },
  async createContentType(name) {
    return RESPONSE_SCHEMAS.contentTypeSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentTypeCreate, { name }))
  },
  async updateContentType(contentTypeId, patch) {
    return RESPONSE_SCHEMAS.contentTypeSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentTypeUpdate, { contentTypeId, ...patch }))
  },
  async reorderContentTypes(contentTypeIds) {
    return RESPONSE_SCHEMAS.contentTypeSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.contentTypeReorder, { contentTypeIds }))
  },
  async saveBusinessTrip(input) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessTripSave, input))
  },
  async createSchedule(input) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scheduleCreate, input))
  },
  async createScheduleBatch(inputs, requestId) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.scheduleCreateBatch, {
      items: inputs,
      requestId: requestId ?? globalThis.crypto.randomUUID()
    }))
  },
  async updateSchedule(scheduleId, patch) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scheduleUpdate, { scheduleId, patch }))
  },
  async moveSchedule(scheduleId, startAt, endAt) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scheduleMove, { scheduleId, startAt, endAt }))
  },
  async setScheduleState(scheduleId, state) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scheduleSetState, { scheduleId, state }))
  },
  async setScheduleColor(scheduleId, colorToken) {
    return RESPONSE_SCHEMAS.scheduleItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.scheduleSetColor, { scheduleId, colorToken }))
  },
  async deleteSchedule(scheduleId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.scheduleDelete, { scheduleId }))
  },
  async getTodoStageStartCandidate(todoId) {
    return todoStageStartCandidateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.todoStageStartCandidate, { todoId }))
  },
  async confirmTodoStageStart(input) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.todoStageStart, input))
  },
  async getTodoProjectStages(projectId) {
    return todoProjectStagesSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.todoProjectStages, { projectId }))
  },
  async setTodoLinkedStageTime(input) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.todoStageTime, input))
  },
  async setTodoLinkedStageCompleted(input) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.todoStageComplete, input))
  },
  async writeTodoDay(input) {
    return todoDaySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.todoDayWrite, input))
  },
  async createTodoBatch(inputs) {
    return RESPONSE_SCHEMAS.todoItemSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.todoCreateBatch, { items: inputs }))
  },
  async moveTodoInTime(input) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.todoTimeMove, input))
  },
  async copyTodosToToday(input) {
    return todoCopyResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.todoCopyToToday, input))
  },
  async undoTodoCopy(operationId) {
    return RESPONSE_SCHEMAS.workspaceUndoResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.todoCopyUndo, { operationId }))
  },
  async batchLinkTodos(input) {
    return RESPONSE_SCHEMAS.todoItemSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.todoBatchLink, input))
  },
  async updateTodo(todoId, patch) {
    return RESPONSE_SCHEMAS.todoItemSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.todoUpdate, { todoId, patch }))
  },
  async dismissTodo(todoId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.todoDismiss, { todoId }))
  },
  async resizeScheduleWindow(height) { await ipcRenderer.invoke(IPC_CHANNELS.scheduleWindowResize, { height }) },
  async closeScheduleWindow() { await ipcRenderer.invoke(IPC_CHANNELS.scheduleWindowClose, {}) },
  async openScheduleMainWindow(day) { await ipcRenderer.invoke(IPC_CHANNELS.scheduleWindowOpenMain, { day }) },
  onScheduleNavigate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, day: string): void => { if (/^\d{4}-\d{2}-\d{2}$/.test(day)) listener(day) }
    ipcRenderer.on(IPC_CHANNELS.scheduleNavigate, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.scheduleNavigate, handler) }
  },
  async getDailyWorkLog(day) {
    return RESPONSE_SCHEMAS.dailyWorkLogSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.dailyWorkLogGet, { day }))
  },
  async setDailyWorkLogTotal(day, totalMinutes, expected) {
    return RESPONSE_SCHEMAS.dailyWorkLogSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.dailyWorkLogTotalSet, { day, totalMinutes, expected: workLogExpected(expected) }))
  },
  async adjustDailyWorkLog(day, field, deltaMinutes) {
    return RESPONSE_SCHEMAS.dailyWorkLogSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.dailyWorkLogAdjust, { day, field, deltaMinutes }))
  },
  async setDailyWorkLog(day, input, expected) {
    return RESPONSE_SCHEMAS.dailyWorkLogSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.dailyWorkLogSet, { day, ...input, expected: workLogExpected(expected) }))
  },
  async listResources() {
    return RESPONSE_SCHEMAS.resourceSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.resourcesList, {}))
  },
  async importOutlineTemplateFile(name, bytes) {
    return RESPONSE_SCHEMAS.resourceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.outlineTemplateImportFile, { name, bytes }))
  },
  async deleteOutlineTemplate(resourceId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.outlineTemplateDelete, { resourceId }))
  },
  async saveProjectTextMaterial(projectId, role, title, textContent) {
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialSaveText, { projectId, role, title, textContent }))
  },
  async saveProjectFramework(projectId, markdown) {
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectFrameworkSave, { projectId, markdown }))
  },
  async saveProjectScratchNote(projectId, noteId, title, markdown) {
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectScratchNoteSave, { projectId, noteId, title, markdown }))
  },
  async saveProjectPrimaryReferences(projectId, referenceRequirements, references, materialReferences = []) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectPrimaryReferencesSave, { projectId, referenceRequirements, references, materialReferences }))
  },
  async startProjectMaterialResearch(projectId, requestedTitle, request) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialResearchStart, { projectId, requestedTitle, request }))
  },
  async getProjectMaterialResearch(projectId, researchId = null) {
    return RESPONSE_SCHEMAS.materialResearchSessionSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialResearchGet, { projectId, researchId }))
  },
  async saveProjectMaterialResearch(projectId, researchId, title, claimIds) {
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialResearchSave, { projectId, researchId, title, claimIds }))
  },
  async getProjectGenerationContext(projectId, supportingMaterialIds) {
    return RESPONSE_SCHEMAS.projectGenerationContextSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectGenerationContextGet, { projectId, supportingMaterialIds }))
  },
  async importProjectPdfMaterial(projectId, role, title, name, bytes) {
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialImportPdf, { projectId, role, title, name, bytes }))
  },
  async importProjectPdfMaterialFromFile(projectId, role, title, file) {
    const sourcePath = webUtils.getPathForFile(file)
    if (!sourcePath) {
      return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialImportPdf, {
        projectId, role, title, name: file.name, bytes: new Uint8Array(await file.arrayBuffer())
      }))
    }
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialImportPdfFromFile, { projectId, role, title, sourcePath }))
  },
  async chooseProjectAssetSources(projectId, role, usageType) {
    return RESPONSE_SCHEMAS.projectAssetImportBatchResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialChooseBatch, { projectId, role, usageType }))
  },
  async importProjectAssetFiles(projectId, role, usageType, files) {
    const sourcePaths: string[] = []
    const unavailable = []
    for (const file of files) {
      const sourcePath = webUtils.getPathForFile(file)
      if (sourcePath && !sourcePaths.includes(sourcePath)) sourcePaths.push(sourcePath)
      else if (!sourcePath) unavailable.push({
        sourceName: file.name || '未命名项目', status: 'failed' as const, materialId: null, fileCount: 0, folderCount: 0,
        storedOnlyCount: 0, failedEntries: [], message: '无法取得这项内容的本机位置'
      })
    }
    const imported = sourcePaths.length > 0
      ? RESPONSE_SCHEMAS.projectAssetImportBatchResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialImportBatch, { projectId, role, usageType, sourcePaths }))
      : { canceled: false, items: [], importedRootCount: 0, storedOnlyFileCount: 0, failedEntryCount: 0 }
    return RESPONSE_SCHEMAS.projectAssetImportBatchResultSchema.parse({
      ...imported,
      items: [...imported.items, ...unavailable],
      failedEntryCount: imported.failedEntryCount + unavailable.length
    })
  },
  async saveProjectLinkMaterial(projectId, role, title, sourceUrl) {
    return RESPONSE_SCHEMAS.projectMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialSaveLink, { projectId, role, title, sourceUrl }))
  },
  async openProjectMaterial(projectId, materialId) {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialOpen, { projectId, materialId })
    if (result !== 'source' && result !== 'managed' && result !== 'link') throw new Error('项目资料打开结果无效')
    return result
  },
  async getProjectMaterialPreview(projectId, materialId) {
    return RESPONSE_SCHEMAS.projectMaterialPreviewSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialPreviewGet, { projectId, materialId }))
  },
  async deleteProjectMaterial(projectId, materialId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.projectMaterialDelete, { projectId, materialId }))
  },
  async extractBusinessScreenshot(projectId, name, bytes) {
    return RESPONSE_SCHEMAS.businessAutofillResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessScreenshotExtract, { projectId, name, bytes }))
  },
  async extractBusinessText(projectId, text) {
    return RESPONSE_SCHEMAS.businessAutofillResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessTextExtract, { projectId, text }))
  },
  async openBusinessImportLink(url) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.businessImportLinkOpen, { url }))
  },
  async captureBusinessImportLink() {
    return RESPONSE_SCHEMAS.businessImportLinkCaptureResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessImportLinkCapture, {}))
  },
  async getBusinessProjectData(projectId) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessProjectDataGet, { projectId }))
  },
  async patchBusinessRecord(projectId, patch) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessRecordPatch, { projectId, patch }))
  },
  async saveBusinessRecord(projectId, input) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessRecordSave, { projectId, ...input }))
  },
  async saveStandaloneBusinessLedgerEntry(ledgerId, title, input) {
    return RESPONSE_SCHEMAS.businessLedgerEntrySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerStandaloneSave, { ledgerId, title, ...input }))
  },
  async saveStandaloneBusinessLedgerEntriesBatch(items) {
    return RESPONSE_SCHEMAS.businessLedgerEntrySchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerStandaloneBatchSave, { items }))
  },
  async listTrashedBusinessLedgerEntries() {
    return RESPONSE_SCHEMAS.businessLedgerEntrySchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerTrashList, {}))
  },
  async trashBusinessLedgerEntry(projectId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerTrash, { projectId }))
  },
  async restoreBusinessLedgerEntry(projectId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerRestore, { projectId }))
  },
  async permanentlyDeleteBusinessLedgerEntry(projectId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerPermanentDelete, { projectId }))
  },
  async relinkBusinessLedgerEntry(sourceProjectId, targetProjectId) {
    return RESPONSE_SCHEMAS.businessLedgerEntrySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerRelink, { sourceProjectId, targetProjectId }))
  },
  async scanBusinessFolder() {
    return RESPONSE_SCHEMAS.businessFolderScanResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessFolderScan, {}))
  },
  async importBusinessFolderCandidates(projectId, scanId, candidateIds) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessFolderImport, { projectId, scanId, candidateIds }))
  },
  async getBusinessLedgerLockStatus() {
    return RESPONSE_SCHEMAS.businessLedgerLockStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerLockStatusGet, {}))
  },
  async enableBusinessLedgerLock(password) {
    return RESPONSE_SCHEMAS.businessLedgerLockStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerLockEnable, { password }))
  },
  async disableBusinessLedgerLock(password) {
    return RESPONSE_SCHEMAS.businessLedgerLockStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerLockDisable, { password }))
  },
  async unlockBusinessLedgerWithPassword(password) {
    return RESPONSE_SCHEMAS.businessLedgerLockStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerLockUnlockPassword, { password }))
  },
  async unlockBusinessLedgerWithTouchId() {
    return RESPONSE_SCHEMAS.businessLedgerLockStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerLockUnlockTouchId, {}))
  },
  async lockBusinessLedger() {
    return RESPONSE_SCHEMAS.businessLedgerLockStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessLedgerLockNow, {}))
  },
  async saveRebatePayment(projectId, paymentId, input) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.rebatePaymentSave, { projectId, paymentId, ...input }))
  },
  async deleteRebatePayment(projectId, paymentId) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.rebatePaymentDelete, { projectId, paymentId }))
  },
  async saveBusinessInvoice(projectId, invoiceId, input) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessInvoiceSave, { projectId, invoiceId, ...input }))
  },
  async deleteBusinessInvoice(projectId, invoiceId) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessInvoiceDelete, { projectId, invoiceId }))
  },
  async importBusinessFile(projectId, role, name, bytes, options = {}) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessFileImport, {
      projectId,
      role,
      name,
      bytes,
      rebatePaymentId: options.rebatePaymentId ?? null,
      invoiceId: options.invoiceId ?? null,
      linkedProjectIds: options.linkedProjectIds
    }))
  },
  async setBusinessFileProjects(projectId, businessFileId, projectIds) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessFileProjectsSet, { projectId, businessFileId, projectIds }))
  },
  async deleteBusinessFile(projectId, businessFileId) {
    return RESPONSE_SCHEMAS.businessProjectDataSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.businessFileDelete, { projectId, businessFileId }))
  },
  async revealBusinessFile(projectId, businessFileId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.businessFileReveal, { projectId, businessFileId }))
  },
  async saveOtherIncomeCategory(categoryId, input) {
    return RESPONSE_SCHEMAS.otherIncomeCategorySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeCategorySave, { categoryId, ...input }))
  },
  async reorderOtherIncomeCategories(categoryIds) {
    return RESPONSE_SCHEMAS.otherIncomeCategorySchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeCategoryReorder, { categoryIds }))
  },
  async patchOtherIncomeRecord(recordId, patch) {
    return RESPONSE_SCHEMAS.otherIncomeRecordSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordPatch, { recordId, patch }))
  },
  async saveOtherIncomeRecord(recordId, input) {
    return RESPONSE_SCHEMAS.otherIncomeRecordSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordSave, { recordId, ...input }))
  },
  async saveOtherIncomeRecordsBatch(records) {
    return RESPONSE_SCHEMAS.otherIncomeRecordSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordBatchSave, { records }))
  },
  async importOtherIncomeAttachment(recordIds, name, bytes) {
    return RESPONSE_SCHEMAS.otherIncomeRecordSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeAttachmentImport, { recordIds, name, bytes }))
  },
  async listTrashedOtherIncomeRecords() {
    return RESPONSE_SCHEMAS.otherIncomeRecordSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordTrashList, {}))
  },
  async trashOtherIncomeRecord(recordId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordTrash, { recordId }))
  },
  async restoreOtherIncomeRecord(recordId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordRestore, { recordId }))
  },
  async permanentlyDeleteOtherIncomeRecord(recordId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRecordPermanentDelete, { recordId }))
  },
  async saveOtherIncomeCompanyAlias(companyName, alias) {
    return RESPONSE_SCHEMAS.otherIncomeCompanyAliasSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeAliasSave, { companyName, alias }))
  },
  async deleteOtherIncomeCompanyAlias(aliasId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeAliasDelete, { aliasId }))
  },
  async saveOtherIncomeImportRule(ruleId, name, instruction, conditions) {
    return RESPONSE_SCHEMAS.otherIncomeImportRuleSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRuleSave, { ruleId, name, instruction, conditions }))
  },
  async deleteOtherIncomeImportRule(ruleId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeRuleDelete, { ruleId }))
  },
  async previewOtherIncomeImport(input) {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.otherIncomeImportPreview, input) as { conditions?: unknown; candidates?: unknown; errors?: unknown }
    return {
      conditions: RESPONSE_SCHEMAS.otherIncomeRuleConditionsSchema.parse(result.conditions),
      candidates: RESPONSE_SCHEMAS.otherIncomeImportCandidateSchema.array().parse(result.candidates),
      errors: Array.isArray(result.errors) ? result.errors.filter((item): item is string => typeof item === 'string') : []
    }
  },
  async savePublishingTextMaterial(projectId, platform, materialKind, textValue) {
    return RESPONSE_SCHEMAS.publishingMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingMaterialSaveText, { projectId, platform, materialKind, textValue }))
  },
  async preparePublishingDraft(projectId, platform) {
    return RESPONSE_SCHEMAS.publishingDraftSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingDraftPrepare, { projectId, platform }))
  },
  async importPublishingFileMaterial(projectId, platform, materialKind, name, bytes) {
    return RESPONSE_SCHEMAS.publishingMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingMaterialImportFile, { projectId, platform, materialKind, name, bytes }))
  },
  async choosePublishingVideo(projectId, platform) {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.publishingVideoChoose, { projectId, platform })
    return result === null ? null : RESPONSE_SCHEMAS.publishingMaterialSchema.parse(result)
  },
  async revealPublishingMaterial(projectId, platform, materialKind) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.publishingMaterialReveal, { projectId, platform, materialKind }))
  },
  async getPublishingAccountState(projectId = null) {
    return RESPONSE_SCHEMAS.publishingAccountStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingAccountStateGet, { projectId }))
  },
  async savePublishingAccount(input) {
    return RESPONSE_SCHEMAS.publishingAccountSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingAccountSave, {
      accountId: input.accountId ?? null,
      platform: input.platform,
      accountName: input.accountName,
      positioning: input.positioning,
      phone: input.phone,
      email: input.email,
      clearContact: input.clearContact ?? false
    }))
  },
  async setPublishingAccountStatus(accountId, status) {
    return RESPONSE_SCHEMAS.publishingAccountSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingAccountStatusSet, { accountId, status }))
  },
  async selectPublishingAccount(projectId, platform, accountId) {
    return RESPONSE_SCHEMAS.publishingAccountStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingAccountSelect, { projectId, platform, accountId }))
  },
  async startCoverGeneration(input) {
    return RESPONSE_SCHEMAS.taskRunSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.coverGenerationStart, input))
  },
  async getCoverCandidatePreview(projectId, candidateId) {
    return String(await ipcRenderer.invoke(IPC_CHANNELS.coverCandidatePreview, { projectId, candidateId }))
  },
  async selectCoverCandidate(projectId, candidateId) {
    return RESPONSE_SCHEMAS.publishingMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.coverCandidateSelect, { projectId, candidateId }))
  },
  async startSubtitleGeneration(projectId, schema, confirmedJobId) {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.subtitleGenerationStart, { projectId, schema, confirmedJobId })
    return result === null ? null : RESPONSE_SCHEMAS.taskRunSchema.parse(result)
  },
  async revealSubtitleArtifact(projectId, artifactId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.subtitleArtifactReveal, { projectId, artifactId }))
  },
  async confirmSubtitleArtifact(projectId, artifactId) {
    return RESPONSE_SCHEMAS.subtitleJobSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.subtitleArtifactConfirm, { projectId, artifactId }))
  },
  async useSubtitleArtifact(projectId, artifactId, platform) {
    return RESPONSE_SCHEMAS.publishingMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.subtitleArtifactUse, { projectId, artifactId, platform }))
  },
  async startTitleGeneration(projectId, platform, options) {
    return RESPONSE_SCHEMAS.taskRunSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.titleGenerationStart, { projectId, platform, ...options }))
  },
  async selectTitleCandidate(projectId, candidateId) {
    return RESPONSE_SCHEMAS.publishingMaterialSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.titleCandidateSelect, { projectId, candidateId }))
  },
  async preparePublishingHandoff(projectId, platform) {
    return RESPONSE_SCHEMAS.publishingHandoffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingHandoffPrepare, { projectId, platform }))
  },
  async openPublishingHandoff(handoffId) {
    return RESPONSE_SCHEMAS.publishingHandoffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingHandoffOpen, { handoffId }))
  },
  async confirmPublishingHandoff(handoffId) {
    return RESPONSE_SCHEMAS.publishingHandoffSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingHandoffConfirm, { handoffId }))
  },
  async copyPublishingHandoffField(handoffId, field) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.publishingHandoffCopyField, { handoffId, field }))
  },
  async startPublishingComputerUsePilot(handoffId) {
    return RESPONSE_SCHEMAS.publishingComputerUsePilotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingComputerUsePilotStart, { handoffId }))
  },
  async markPublishingComputerUsePilotReady(pilotId) {
    return RESPONSE_SCHEMAS.publishingComputerUsePilotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingComputerUsePilotReady, { pilotId }))
  },
  async stopPublishingComputerUsePilot(pilotId, status, message) {
    return RESPONSE_SCHEMAS.publishingComputerUsePilotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.publishingComputerUsePilotStop, { pilotId, status, message: message ?? '' }))
  },
  async listDistributionBatches() {
    return RESPONSE_SCHEMAS.distributionBatchSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionBatchesList, {}))
  },
  async createDistributionBatch(input) {
    return RESPONSE_SCHEMAS.distributionBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionBatchCreate, input))
  },
  async startDistributionAnalysis(batchId, providerConfigId) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionAnalysisStart, { batchId, providerConfigId }))
  },
  async createDistributionSegment(batchId) {
    return RESPONSE_SCHEMAS.distributionBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionSegmentCreate, { batchId }))
  },
  async updateDistributionSegment(input) {
    return RESPONSE_SCHEMAS.distributionBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionSegmentUpdate, input))
  },
  async linkDistributionFiles(batchId, files, segmentId) {
    const sourcePaths = files?.map((file) => webUtils.getPathForFile(file)).filter(Boolean) ?? []
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.distributionFilesLink, { batchId, sourcePaths, segmentId: segmentId ?? null })
    return result === null ? null : RESPONSE_SCHEMAS.distributionBatchSchema.parse(result)
  },
  async replaceDistributionTargets(batchId, segmentId, accountIds) {
    return RESPONSE_SCHEMAS.distributionBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionTargetsReplace, { batchId, segmentId, accountIds }))
  },
  async setDistributionTargetStatus(batchId, targetId, status, note) {
    return RESPONSE_SCHEMAS.distributionBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionTargetStatusSet, { batchId, targetId, status, note }))
  },
  async completeDistributionBatch(batchId, force) {
    return RESPONSE_SCHEMAS.distributionCompletionResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionBatchComplete, { batchId, force }))
  },
  async reopenDistributionBatch(batchId) {
    return RESPONSE_SCHEMAS.distributionBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.distributionBatchReopen, { batchId }))
  },
  async openDistributionFile(batchId, segmentId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.distributionFileOpen, { batchId, segmentId }))
  },
  async revealDistributionFile(batchId, segmentId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.distributionFileReveal, { batchId, segmentId }))
  },
  async setProjectResourceReference(projectId, resourceId, enabled, role, selectionSource) {
    return RESPONSE_SCHEMAS.projectResourceReferenceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectSetResourceReference, { projectId, resourceId, enabled, role, selectionSource }))
  },
  async prepareTaskResources(projectId, options = {}) {
    return RESPONSE_SCHEMAS.taskResourcePreparationSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskPrepareResources, { projectId, ...options }))
  },
  async getContentEngine() {
    return RESPONSE_SCHEMAS.contentEngineSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentEngineGet, {}))
  },
  async importContentSource(input) {
    return RESPONSE_SCHEMAS.contentSourceImportResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentSourceImport, input))
  },
  async listConversationSources(query = {}) {
    return RESPONSE_SCHEMAS.conversationMetadataResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationSourcesList, query))
  },
  async prepareConversationSelection(input) {
    return RESPONSE_SCHEMAS.conversationSelectionPreviewSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationSelectionPrepare, input))
  },
  async startConversationFilter(input) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterStart, input))
  },
  async getConversationScanPlan(input) {
    return RESPONSE_SCHEMAS.conversationScanPlanSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanPlan, input))
  },
  async prepareConversationScan(input) {
    return RESPONSE_SCHEMAS.conversationScanPreflightSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanPrepare, input))
  },
  async getConversationScanPreflightBatch(preflightId, batchIndex) {
    return RESPONSE_SCHEMAS.conversationScanPreflightBatchSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanPreflightBatch, { preflightId, batchIndex }))
  },
  async startConversationScan(preflightId) {
    return RESPONSE_SCHEMAS.conversationScanStartResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanStart, { preflightId }))
  },
  async getConversationScanProgress(scanId) {
    return RESPONSE_SCHEMAS.conversationScanProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanProgress, { scanId }))
  },
  async pauseConversationScan(scanId) {
    return RESPONSE_SCHEMAS.conversationScanProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanPause, { scanId }))
  },
  async resumeConversationScan(scanId) {
    return RESPONSE_SCHEMAS.conversationScanProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationScanResume, { scanId }))
  },
  async listConversationFilterCandidates(taskId) {
    return RESPONSE_SCHEMAS.conversationFilterCandidateSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterCandidatesList, { taskId }))
  },
  async setConversationFilterCandidateStatus(candidateId, status) {
    return RESPONSE_SCHEMAS.conversationFilterCandidateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterCandidateSetStatus, { candidateId, status }))
  },
  async routeConversationFilterCandidate(candidateId, destination) {
    return RESPONSE_SCHEMAS.conversationFilterDestinationResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterCandidateRoute, { candidateId, destination }))
  },
  async decideConversationFilterCandidate(candidateId, decision) {
    return RESPONSE_SCHEMAS.conversationFilterBatchDecisionResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterCandidateDecide, { candidateId, decision }))
  },
  async confirmConversationFilterCandidates(candidateIds) {
    return RESPONSE_SCHEMAS.conversationFilterBatchDecisionResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterCandidatesConfirm, { candidateIds }))
  },
  async permanentlyDeleteConversationFilterCandidate(candidateId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.conversationFilterCandidateDelete, { candidateId }))
  },
  async setContentAtomStatus(atomId, status) {
    return RESPONSE_SCHEMAS.contentAtomSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentAtomSetStatus, { atomId, status }))
  },
  async mergeContentAtoms(atomIds, title) {
    return RESPONSE_SCHEMAS.contentAtomSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentAtomMerge, { atomIds, title }))
  },
  async prepareContentDerivation(options = {}) {
    return RESPONSE_SCHEMAS.contentDerivationPreparationSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentDerivativePrepare, options))
  },
  async createContentDerivative(input) {
    return RESPONSE_SCHEMAS.contentDerivativeSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentDerivativeCreate, input))
  },
  async confirmContentDerivative(candidateId, currentContent) {
    return RESPONSE_SCHEMAS.contentDerivativeSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentDerivativeConfirm, { candidateId, currentContent }))
  },
  async copyContentDerivative(candidateId) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.contentDerivativeCopy, { candidateId }))
  },
  async createProjectFromContentDerivative(candidateId, input) {
    return RESPONSE_SCHEMAS.projectDetailSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.contentDerivativeCreateProject, { candidateId, ...input }))
  },
  async createTask(input) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskCreate, input))
  },
  async cancelTask(taskId) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskCancel, { taskId }))
  },
  async dismissTask(taskId) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskDismiss, { taskId }))
  },
  async retryTask(taskId) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskRetry, { taskId }))
  },
  async retryTaskWithFallback(taskId) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskRetryWithFallback, { taskId }))
  },
  async confirmTask(taskId) {
    return RESPONSE_SCHEMAS.taskRunSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.taskConfirm, { taskId }))
  },
  async validateProviderSecurity(provider) {
    return RESPONSE_SCHEMAS.providerCapabilitySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.providerSecurityValidate, { provider }))
  },
  async getProviderSettings() {
    return RESPONSE_SCHEMAS.providerSettingsSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.providerSettingsGet, {}))
  },
  async saveExternalProviderConfig(input) {
    return RESPONSE_SCHEMAS.externalProviderConfigSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.externalProviderConfigSave, input))
  },
  async deleteExternalProviderConfig(id) {
    return Boolean(await ipcRenderer.invoke(IPC_CHANNELS.externalProviderConfigDelete, { id }))
  },
  async validateExternalProviderConfig(id) {
    return RESPONSE_SCHEMAS.externalProviderConfigSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.externalProviderConfigValidate, { id }))
  },
  async setProviderRouting(defaultProviderConfigId, fallbackProviderConfigId) {
    return RESPONSE_SCHEMAS.providerSettingsSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.providerRoutingSet, { defaultProviderConfigId, fallbackProviderConfigId }))
  },
  async listExternalFileRelations() {
    return RESPONSE_SCHEMAS.externalFileRelationSchema.array().parse(await ipcRenderer.invoke(IPC_CHANNELS.externalFileRelationsList, {}))
  },
  async getWorkspaceV2Access(deviceId) {
    return workspaceAccessStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workspaceAccessGet, { deviceId }))
  },
  async updateWorkspaceV2Access(input) {
    return workspaceAccessStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workspaceAccessUpdate, input))
  },
  async getMobileSyncStatus() {
    return RESPONSE_SCHEMAS.mobileSyncStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.mobileSyncStatusGet, {}))
  },
  async setMobileSyncEnabled(enabled) {
    return RESPONSE_SCHEMAS.mobileSyncStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.mobileSyncSetEnabled, { enabled }))
  },
  async approveMobileSyncPairing(sessionId) {
    return RESPONSE_SCHEMAS.mobileSyncStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.mobileSyncPairingApprove, { sessionId }))
  },
  async rejectMobileSyncPairing(sessionId) {
    return RESPONSE_SCHEMAS.mobileSyncStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.mobileSyncPairingReject, { sessionId }))
  },
  async revokeMobileSyncDevice(deviceId) {
    return RESPONSE_SCHEMAS.mobileSyncStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.mobileSyncDeviceRevoke, { deviceId }))
  },
  async setPreferences(patch) {
    return preferencesSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.preferencesSet, patch))
  },
  async getWorkbenchPreferences(projectId) {
    return workbenchPreferencesSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workbenchPreferencesGet, { projectId }))
  },
  async setWorkbenchPreferences(projectId, patch) {
    return workbenchPreferencesSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.workbenchPreferencesSet, { projectId, patch }))
  },
  async getProjectProductionNotes(projectId) {
    return projectProductionNotesSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectProductionNotesGet, { projectId }))
  },
  async setProjectProductionNotes(projectId, input) {
    return projectProductionNotesSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectProductionNotesSet, { projectId, ...input }))
  },
  onAppearanceChanged(listener) {
    const handler = (_event: Electron.IpcRendererEvent, appearance: unknown): void => {
      const parsed = appearanceSnapshotSchema.safeParse(appearance)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on(IPC_CHANNELS.appearanceChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appearanceChanged, handler)
  },
  onWorkspaceChanged(listener) {
    const handler = (): void => listener()
    ipcRenderer.on(IPC_CHANNELS.workspaceChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceChanged, handler)
  },
  onCaptureActivated(listener) {
    const handler = (): void => listener()
    ipcRenderer.on(IPC_CHANNELS.captureActivated, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.captureActivated, handler)
  },
  onWorkbenchQuickLocatorRequested(listener) {
    const handler = (): void => listener()
    ipcRenderer.on(IPC_CHANNELS.workbenchQuickLocatorRequested, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workbenchQuickLocatorRequested, handler)
  }
}

contextBridge.exposeInMainWorld('creatorOS', api)
