import { todoCopyToTodaySchema, todoCopyUndoSchema } from '../shared/todo-reschedule'
import { workspaceAccessQuerySchema, workspaceAccessUpdateSchema } from '../shared/workspace-access'
import { playTodoCompletionFeedback } from './todo-completion-feedback'
import { getTodoDay, writeTodoDay } from './db/todo-day-repository'
import { todoDayWriteSchema } from '../shared/todo-day'
import { registerPersonalReviewIpc } from './personal-review-ipc'
import { businessTripSaveSchema } from '../shared/business-trip'
import { businessRecordPatchPayloadSchema, otherIncomeRecordPatchPayloadSchema } from '../shared/ipc'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { assertContentInstructionDispatchMatchesExecution, assertMaterialInstructionMatchesWorkspace } from './content-instruction-dispatch'
import { parseScriptRevisionTaskSnapshot } from './script-revision'
import { parseScriptMaterialChatTaskSnapshot } from './script-material'
import {
  captureClassifyPayloadSchema,
  captureConfirmClassificationPayloadSchema,
  captureContextPayloadSchema,
  captureAttachTopicPayloadSchema,
  captureSavePayloadSchema,
  captureSetUseStatusPayloadSchema,
  captureUndoClassificationPayloadSchema,
  confirmStylePreferencePayloadSchema,
  contentAtomMergePayloadSchema,
  contentAtomSetStatusPayloadSchema,
  contentDerivativeConfirmPayloadSchema,
  contentDerivativeCreatePayloadSchema,
  contentDerivativeCreateProjectPayloadSchema,
  contentDerivativeIdPayloadSchema,
  contentDerivativePreparePayloadSchema,
  contentSourceImportPayloadSchema,
  contentInstructionRequestGetPayloadSchema,
  contentInstructionRequestGetByTaskPayloadSchema,
  contentFactEvidenceGetPayloadSchema,
  contentInstructionRequestPreparePayloadSchema,
  contentInstructionDispatchPayloadSchema,
  projectReferenceRolePreferenceRemovePayloadSchema,
  projectReferenceRolePreferenceSetPayloadSchema,
  structuredReferenceCatalogListPayloadSchema,
  structuredReferenceRolesResolvePayloadSchema,
  conversationSelectionPreparePayloadSchema,
  conversationSourcesListPayloadSchema,
  conversationFilterCandidateSetStatusPayloadSchema,
  conversationFilterCandidateRoutePayloadSchema,
  conversationFilterCandidateDecidePayloadSchema,
  conversationFilterCandidatesConfirmPayloadSchema,
  conversationFilterCandidateDeletePayloadSchema,
  conversationFilterCandidatesListPayloadSchema,
  conversationFilterStartPayloadSchema,
  conversationScanIdPayloadSchema,
  conversationScanPlanPayloadSchema,
  conversationScanPreparePayloadSchema,
  conversationScanPreflightBatchPayloadSchema,
  conversationScanStartPayloadSchema,
  creationReportConversationGetPayloadSchema,
  creationReportGetPayloadSchema,
  creationReportMessageSendPayloadSchema,
  creationReportSnapshotGetByIdPayloadSchema,
  creationReportSnapshotListPayloadSchema,
  projectCreationReviewGetPayloadSchema,
  projectProductionNotesGetPayloadSchema,
  projectProductionNotesSetPayloadSchema,
  scriptRevisionApplyValidatePayloadSchema,
  scriptRevisionConversationGetPayloadSchema,
  scriptRevisionMessageSendPayloadSchema,
  scriptRevisionSuggestionStatusSetPayloadSchema,
  projectCurrentScriptLoadPayloadSchema,
  projectCurrentScriptInitializePayloadSchema,
  projectCurrentScriptApplyPayloadSchema,
  projectCurrentScriptVersionSavePayloadSchema,
  projectCurrentScriptVersionRestorePayloadSchema,
  projectCurrentScriptVersionSnapshotGetPayloadSchema,
  projectCurrentScriptRecoveryListPayloadSchema,
  projectCurrentScriptRecoveryResolvePayloadSchema,
  sourceScriptAnnotationsListPayloadSchema,
  sourceScriptAnnotationUpsertPayloadSchema,
  sourceScriptAnnotationDeletePayloadSchema,
  scriptMaterialGetPayloadSchema,
  scriptMaterialWorkspaceSavePayloadSchema,
  scriptMaterialRevisionCreatePayloadSchema,
  scriptMaterialPointsReplacePayloadSchema,
  scriptMaterialPointsConfirmPayloadSchema,
  scriptMaterialPointUpdatePayloadSchema,
  scriptMaterialAnnotationConfirmPayloadSchema,
  scriptMaterialManualMarksSetPayloadSchema,
  scriptMaterialExtractStartPayloadSchema,
  scriptMaterialGenerateStartPayloadSchema,
  scriptMaterialAuditStartPayloadSchema,
  scriptMaterialAllowedOmissionsSetPayloadSchema,
  scriptMaterialFindingConfirmPayloadSchema,
  scriptMaterialFinalizationGateGetPayloadSchema,
  scriptMaterialVersionSnapshotGetPayloadSchema,
  scriptMaterialMapStartPayloadSchema,
  draftAlignmentStartPayloadSchema,
  draftCandidateDeletePayloadSchema,
  draftCandidateMovePayloadSchema,
  draftCandidateReorderPayloadSchema,
  draftCandidateFreeformAddPayloadSchema,
  draftComparisonDraftsSavePayloadSchema,
  draftComparisonGetPayloadSchema,
  draftComparisonCurrentDocumentBaseSetPayloadSchema,
  draftSourceGeneratePayloadSchema,
  draftDecisionSetPayloadSchema,
  draftDecisionNoteSetPayloadSchema,
  draftDecisionMarkersSetPayloadSchema,
  draftGroupMergePayloadSchema,
  draftGroupReorderPayloadSchema,
  draftGroupSplitPayloadSchema,
  draftAlignmentSplitStartPayloadSchema,
  draftParagraphMovePayloadSchema,
  draftParagraphsMovePayloadSchema,
  draftComparisonHistoryListPayloadSchema,
  draftComparisonHistoryRestorePayloadSchema,
  scriptExportWordPayloadSchema,
  feishuHandoffListPayloadSchema,
  feishuHandoffMutationPayloadSchema,
  feishuHandoffOpenPayloadSchema,
  nasArchiveCategoryLabelsSetPayloadSchema,
  nasArchivePlanConfirmPayloadSchema,
  nasArchivePlanPreparePayloadSchema,
  nasArchiveProjectPayloadSchema,
  nasArchiveRunPayloadSchema,
  nasArchiveSlotChoosePayloadSchema,
  nasArchiveSlotStatusSetPayloadSchema,
  generalCategoryCreatePayloadSchema,
  generalCategoryUpdatePayloadSchema,
  globalSearchPayloadSchema,
  contentTypeCreatePayloadSchema,
  contentTypeReorderPayloadSchema,
  contentTypeUpdatePayloadSchema,
  emptyPayloadSchema,
  externalLinkOpenPayloadSchema,
  importScriptPayloadSchema,
  importScriptFilePayloadSchema,
  importOutlineTemplateFilePayloadSchema,
  projectOutlineSelectionSetPayloadSchema,
  businessFileImportPayloadSchema,
  businessFileProjectsSetPayloadSchema,
  businessFilePayloadSchema,
  businessInvoiceDeletePayloadSchema,
  businessInvoiceSavePayloadSchema,
  businessScreenshotExtractPayloadSchema,
  businessTextExtractPayloadSchema,
  businessImportLinkOpenPayloadSchema,
  businessRecordSavePayloadSchema,
  businessLedgerEntryPayloadSchema,
  businessLedgerRelinkPayloadSchema,
  businessLedgerStandaloneBatchSavePayloadSchema,
  businessLedgerStandaloneSavePayloadSchema,
  businessLedgerLockPasswordPayloadSchema,
  businessFolderImportPayloadSchema,
  otherIncomeCategorySavePayloadSchema,
  otherIncomeCategoryReorderPayloadSchema,
  otherIncomeAttachmentImportPayloadSchema,
  otherIncomeRecordSavePayloadSchema,
  otherIncomeRecordBatchSavePayloadSchema,
  otherIncomeRecordPayloadSchema,
  otherIncomeAliasSavePayloadSchema,
  otherIncomeAliasDeletePayloadSchema,
  otherIncomeRuleSavePayloadSchema,
  otherIncomeRuleDeletePayloadSchema,
  otherIncomeImportPreviewPayloadSchema,
  IPC_CHANNELS,
  linkGroupCreatePayloadSchema,
  linkGroupDeletePayloadSchema,
  linkGroupListPayloadSchema,
  mobileSyncDeviceRevokePayloadSchema,
  mobileSyncPairingDecisionPayloadSchema,
  mobileSyncSetEnabledPayloadSchema,
  openCapturePayloadSchema,
  outlineItemSchema,
  outlineGenerationStartPayloadSchema,
  outlineTemplateDeletePayloadSchema,
  projectMaterialDeletePayloadSchema,
  projectMaterialChooseBatchPayloadSchema,
  projectMaterialImportBatchPayloadSchema,
  projectMaterialImportPdfFromFilePayloadSchema,
  projectMaterialImportPdfPayloadSchema,
  projectMaterialOpenPayloadSchema,
  projectMaterialSaveLinkPayloadSchema,
  projectMaterialSaveTextPayloadSchema,
  projectFrameworkSavePayloadSchema,
  projectScratchNoteSavePayloadSchema,
  projectMaterialResearchGetPayloadSchema,
  projectMaterialResearchSavePayloadSchema,
  projectMaterialResearchStartPayloadSchema,
  projectGenerationContextGetPayloadSchema,
  projectPrimaryReferencesSavePayloadSchema,
  rebatePaymentDeletePayloadSchema,
  rebatePaymentSavePayloadSchema,
  publishingMaterialImportFilePayloadSchema,
  publishingMaterialSaveTextPayloadSchema,
  publishingDraftPreparePayloadSchema,
  publishingVideoChoosePayloadSchema,
  publishingMaterialRevealPayloadSchema,
  publishingAccountStatePayloadSchema,
  publishingAccountSavePayloadSchema,
  publishingAccountStatusPayloadSchema,
  publishingAccountSelectPayloadSchema,
  coverGenerationStartPayloadSchema,
  coverCandidatePayloadSchema,
  subtitleGenerationStartPayloadSchema,
  subtitleArtifactPayloadSchema,
  subtitleArtifactUsePayloadSchema,
  titleGenerationStartPayloadSchema,
  titleCandidatePayloadSchema,
  publishingHandoffPreparePayloadSchema,
  publishingHandoffPayloadSchema,
  publishingHandoffCopyFieldPayloadSchema,
  publishingComputerUsePilotPayloadSchema,
  publishingComputerUsePilotStopPayloadSchema,
  distributionBatchCreatePayloadSchema,
  distributionBatchPayloadSchema,
  distributionAnalysisStartPayloadSchema,
  distributionSegmentUpdatePayloadSchema,
  distributionFilesLinkPayloadSchema,
  distributionTargetsReplacePayloadSchema,
  distributionTargetStatusPayloadSchema,
  distributionBatchCompletePayloadSchema,
  distributionFilePayloadSchema,
  preferencesPatchSchema,
  providerSecurityValidatePayloadSchema,
  externalProviderConfigSavePayloadSchema,
  externalProviderConfigIdPayloadSchema,
  providerRoutingSetPayloadSchema,
  projectCreatePayloadSchema,
  projectGetPayloadSchema,
  projectTrashPayloadSchema,
  projectSetColorPayloadSchema,
  projectSetPinnedPayloadSchema,
  projectSetLifecyclePayloadSchema,
  projectSetResourceReferencePayloadSchema,
  projectReorderModulesPayloadSchema,
  projectSetModulePayloadSchema,
  projectSetModuleCompletedPayloadSchema,
  projectStageTimeSetStatusPayloadSchema,
  projectStageTimeUndoPayloadSchema,
  projectStageTimeUpdatePayloadSchema,
  projectTemplatePayloadSchema,
  projectTemplateSavePayloadSchema,
  projectUpdateContentTypePayloadSchema,
  projectUpdateClassificationPayloadSchema,
  projectUpdatePlatformsPayloadSchema,
  projectRenamePayloadSchema,
  projectClassifyDraftPayloadSchema,
  topicTrashPayloadSchema,
  captureDeletePayloadSchema,
  filterCandidatePayloadSchema,
  saveOutlinePayloadSchema,
  saveScriptPayloadSchema,
  saveAndFinalizeScriptPayloadSchema,
  setFinalVersionPayloadSchema,
  scheduleCreatePayloadSchema,
  scheduleCreateBatchPayloadSchema,
  scheduleDeletePayloadSchema,
  scheduleMovePayloadSchema,
  scheduleSetColorPayloadSchema,
  scheduleUpdatePayloadSchema,
  scheduleSetStatePayloadSchema,
  todoProjectStagesPayloadSchema,
  todoStageCompletePayloadSchema,
  todoStageTimePayloadSchema,
  todoStageStartCandidatePayloadSchema,
  todoStageStartPayloadSchema,
  todoCreateBatchPayloadSchema,
  todoDismissPayloadSchema,
  todoUpdatePayloadSchema,
  todoTimeMovePayloadSchema,
  todoBatchLinkPayloadSchema,
  dailyWorkLogGetPayloadSchema,
  dailyWorkLogSetPayloadSchema,
  dailyWorkLogAdjustPayloadSchema,
  dailyWorkLogTotalSetPayloadSchema,
  scheduleWindowOpenMainPayloadSchema,
  scheduleWindowResizePayloadSchema,
  taskCreatePayloadSchema,
  taskIdPayloadSchema,
  taskPrepareResourcesPayloadSchema,
  topicCreatePayloadSchema,
  topicColumnCreatePayloadSchema,
  topicColumnDeletePayloadSchema,
  topicColumnReorderPayloadSchema,
  topicColumnUpdatePayloadSchema,
  topicCustomValueSetPayloadSchema,
  topicIdPayloadSchema,
  topicStageCreatePayloadSchema,
  topicStageDeletePayloadSchema,
  topicStageReorderPayloadSchema,
  topicStageUpdatePayloadSchema,
  topicUpdatePayloadSchema,
  updateDescriptionPayloadSchema,
  workbenchPreferencesGetPayloadSchema,
  workbenchPreferencesSetPayloadSchema,
  weatherGetPayloadSchema,
  workspaceUndoPayloadSchema
} from '../shared/ipc'
import { buildScriptDocx } from './docx-export'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS, PROJECT_PLATFORMS, type CodexWritingModelOption, type ContentSourceSelectionSnapshot, type ConversationMetadata, type ConversationScanPlan, type ConversationScanPreflight, type ConversationScanProgress, type ConversationSelectionPreview, type FileReferenceInput, type ProjectAssetImportBatchResult, type ProjectAssetImportItemResult, type ProjectAssetUsageType, type ProjectMaterialRole, type PublishingHandoff, type TaskRun, type TextProviderExecutionContext } from '../shared/domain'
import type { WorkspaceStore } from './db'
import type { ExternalProviderConfigService } from './external-provider-config-service'
import type { BusinessLedgerLockService } from './business-ledger-lock-service'
import type { ExternalDraftWatcher } from './external-draft-watcher'
import type { MobileSyncService, SecretProtector } from './mobile-sync-service'
import type { NasArchiveConfigService } from './nas-archive-config-service'
import type { NasArchiveService } from './nas-archive-service'
import { ConversationSourceService } from './conversation-sources'
import { discardRetainedImport, parseRetainedImport, retainImportFromBytes, retainImportFromPath, type RetainedImport } from './imported-files'
import { feishuClipboardText, feishuWordFileName, normalizeFeishuDocumentUrl } from './feishu-handoff'
import { cleanupReleasedManagedFiles, discardManagedLocator, discardManagedLocators, resolveManagedFilePath, retainLinkedFileFromPath, retainManagedFileFromBytes, retainManagedTreeFromPath, verifyLinkedFileSnapshot } from './managed-files'
import { extractOutlineTemplateItems, outlineTemplateName } from './outline-template'
import { createOutlineGenerationTaskSnapshot } from './outline-generation'
import { materialResearchTaskSnapshotSchema } from './material-research'
import { distributionAnalysisTaskSnapshotSchema } from './distribution-analysis'
import { coverGenerationTaskSnapshotSchema, subtitleGenerationTaskSnapshotSchema, subtitleStylePreset } from './production-executor'
import { PreflightRegistry } from './preflight-registry'
import { assertPublishingHandoffCurrent, preparePublishingPackage, publishingClipboardText, publishingFieldText } from './publishing-adapters'
import { buildBilibiliComputerUseTaskPacket, serializeBilibiliComputerUseTaskPacket } from './computer-use-pilot'
import { platformTitleLimit, titleGenerationTaskSnapshotSchema } from './title-generation'
import { discardPublishingAsset, retainPublishingAsset } from './publishing-assets'
import { discardBusinessFile, retainBusinessFile } from './business-files'
import { resolveBusinessFolderCandidates, scanBusinessFolderPath } from './business-folder-scan'
import { extractOtherIncomeImportText } from './other-income-import-file'
import { buildOtherIncomeImportCandidates, parseDelimitedIncomeRows, parseOtherIncomeRuleInstruction } from '../shared/other-income-import'
import { discardRetainedProjectPdf, parseRetainedProjectPdf, retainProjectPdfFromBytes, retainProjectPdfFromPath } from './project-material-files'
import { resolveProjectMaterialRevealTarget } from './project-material-open'
import { assertTrustedSender } from './security'
import type { TaskRunner } from './task-runner'
import type { WeatherService } from './weather-service'
import { scheduleWorkspaceRestore } from './workspace-restore'
import { resizeSchedulePanelWindow, closeSchedulePanelWindow, openMainScheduleWindow, closeCaptureWindow, closeTodoWindow, getCaptureTargetKind, getCaptureTargetProjectId, isBackgroundTestMode, openCaptureWindow, openExternalSafely, openTodoWidgetWindow, revealMainWindow } from './windows'
import { resolveStructuredReferenceRoles } from '../shared/domain/structured-reference-role'

export const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+Space'
const PRODUCT_NAME = 'LY Creator OS'
let businessImportWindow: BrowserWindow | null = null

type FrozenContentInstructionTargetPreparation = {
  providerConfigId: string
  providerSecurity: Extract<TextProviderExecutionContext, { provider: 'codex_cli' | 'claude_cli' }>
  requestedModel: string
  actualModel: string | null
  requestedReasoningEffort: string | null
  actualReasoningEffort: string | null
  historyThreadId: string | null
  providerThreadId: string | null
  historyMessageIds: string[]
  historyHash: string
}

const CODEX_MODEL_PREFERENCE = ['gpt-5.6-sol', 'gpt-5.6', 'gpt-5.5', 'gpt-5.4', 'gpt-5'] as const
const CODEX_REASONING_PREFERENCE = ['ultra', 'max', 'xhigh', 'high', 'medium', 'low', 'none'] as const

function resolveCodexInstructionTarget(
  models: CodexWritingModelOption[],
  requestedModel: string,
  requestedReasoningEffort: string | null
): { actualModel: string; actualReasoningEffort: string } {
  const model = requestedModel === 'auto'
    ? CODEX_MODEL_PREFERENCE.map((id) => models.find((candidate) => candidate.id === id)).find(Boolean)
      ?? models.find((candidate) => candidate.isDefault)
      ?? models[0]
    : models.find((candidate) => candidate.id === requestedModel)
  if (!model) throw new Error(requestedModel === 'auto' ? 'Codex当前没有可用模型' : '所选Codex模型已不可用，请重新选择')
  const requestedEffort = requestedReasoningEffort === 'auto' ? null : requestedReasoningEffort
  if (requestedEffort && !model.reasoningEfforts.includes(requestedEffort)) throw new Error('所选Codex推理强度已不可用，请重新选择')
  const actualReasoningEffort = requestedEffort
    ?? CODEX_REASONING_PREFERENCE.find((effort) => model.reasoningEfforts.includes(effort))
    ?? model.reasoningEfforts[0]
  if (!actualReasoningEffort) throw new Error('所选Codex模型没有可用的推理强度')
  return { actualModel: model.id, actualReasoningEffort }
}

function broadcast(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function notifyWorkspaceChanged(): void { broadcast(IPC_CHANNELS.workspaceChanged) }

async function importExternalScript(store: WorkspaceStore, watcher: ExternalDraftWatcher, projectId: string): Promise<{ canceled: boolean; version?: ReturnType<typeof store.repository.importScript>; sourceName?: string }> {
  store.repository.getProject(projectId, false)
  const owner = BrowserWindow.getFocusedWindow() ?? undefined
  const options: Electron.OpenDialogOptions = {
    title: '导入外部文案',
    buttonLabel: '导入为新版本',
    properties: ['openFile'],
    filters: [{ name: 'Markdown、纯文本或Word', extensions: ['md', 'markdown', 'txt', 'text', 'docx'] }]
  }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  const sourcePath = await realpath(result.filePaths[0])
  let retained: RetainedImport | null = null
  try {
    retained = await retainImportFromPath(dirname(store.databasePath), projectId, sourcePath)
    if (!retained.sourceStat) throw new Error('无法读取外部文案文件状态')
    const content = await parseRetainedImport(retained)
    const sourceName = retained.file.originalName
    const version = store.repository.importScriptWithExternalRelation(projectId, content, retained.file, {
      path: sourcePath, displayName: basename(sourcePath), mtimeMs: retained.sourceStat.mtimeMs, sizeBytes: retained.sourceStat.sizeBytes
    })
    retained = null
    await watcher.sync().catch((error: unknown) => console.error('外部文案已导入，但监听启动失败', error))
    return { canceled: false, version, sourceName }
  } catch (error) {
    if (retained) await discardRetainedImport(retained)
    throw error
  }
}

async function importExternalScriptBytes(store: WorkspaceStore, projectId: string, sourceName: string, bytes: Uint8Array): Promise<{ canceled: false; version: ReturnType<typeof store.repository.importScript>; sourceName: string }> {
  store.repository.getProject(projectId, false)
  let retained: RetainedImport | null = null
  try {
    retained = await retainImportFromBytes(dirname(store.databasePath), projectId, sourceName, bytes)
    const content = await parseRetainedImport(retained)
    return { canceled: false, version: store.repository.importScript(projectId, content, retained.file), sourceName: retained.file.originalName }
  } catch (error) {
    if (retained) await discardRetainedImport(retained)
    throw error
  }
}

async function importOutlineTemplateBytes(store: WorkspaceStore, sourceName: string, bytes: Uint8Array): Promise<ReturnType<typeof store.repository.saveOutlineTemplate>> {
  let retained: RetainedImport | null = null
  try {
    retained = await retainImportFromBytes(dirname(store.databasePath), 'outline-templates', sourceName, bytes)
    const items = extractOutlineTemplateItems(await parseRetainedImport(retained))
    return store.repository.saveOutlineTemplate({ name: outlineTemplateName(sourceName), sourceName: basename(sourceName), items })
  } finally {
    if (retained) await discardRetainedImport(retained)
  }
}

function safeAssetImportMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const safeMessages = [
    '不支持导入符号链接', '已跳过符号链接', '只能导入普通文件或文件夹', '不能把App受管目录作为导入来源',
    '文件为空或大小无效', '外部文件在读取过程中发生变化，请重试', '外部文件在读取过程中提前结束',
    '受管文件副本写入中断', '项目资料文件数量无效', '项目资料必须只有一个根文件或文件夹',
    '项目资料相对路径无效', '项目资料包含重复文件或路径', '项目资料文件夹层级无效'
  ]
  return safeMessages.includes(message) || /^(单个文件不能超过|文件夹层级不能超过|单次最多导入|单次导入总大小不能超过)/.test(message)
    ? message
    : '无法读取或复制这项内容'
}

function summarizeAssetImportItem(input: {
  sourceName: string
  materialId: string
  entries: Awaited<ReturnType<typeof retainManagedTreeFromPath>>['entries']
  failures: Awaited<ReturnType<typeof retainManagedTreeFromPath>>['failures']
}): ProjectAssetImportItemResult {
  const fileCount = input.entries.filter((entry) => entry.file.kind === 'file').length
  const folderCount = input.entries.length - fileCount
  const storedOnlyCount = input.entries.filter((entry) => entry.file.kind === 'file' && entry.file.processState === 'stored_only').length
  return {
    sourceName: input.sourceName,
    status: input.failures.length > 0 ? 'partial' : fileCount > 0 && storedOnlyCount === fileCount ? 'stored_only' : 'success',
    materialId: input.materialId,
    fileCount,
    folderCount,
    storedOnlyCount,
    failedEntries: input.failures.map((failure) => ({ relativePath: failure.relativePath, message: safeAssetImportMessage(new Error(failure.message)) })),
    message: input.failures.length > 0 ? `有${input.failures.length}项未导入` : null
  }
}

export async function importProjectAssetPaths(
  store: WorkspaceStore,
  services: { secretProtector: SecretProtector },
  input: { projectId: string; role: ProjectMaterialRole; usageType: ProjectAssetUsageType | null; sourcePaths: string[] }
): Promise<ProjectAssetImportBatchResult> {
  store.repository.getProject(input.projectId, false)
  const userDataPath = dirname(store.databasePath)
  const items: ProjectAssetImportItemResult[] = []
  for (const requestedPath of input.sourcePaths) {
    const sourceName = basename(requestedPath) || '未命名项目'
    let retained: Awaited<ReturnType<typeof retainManagedTreeFromPath>> | null = null
    try {
      const sourcePath = resolve(requestedPath)
      let sourceBookmark: string | null = null
      if (services.secretProtector.isAvailable()) {
        try { sourceBookmark = services.secretProtector.encrypt(sourcePath) } catch { sourceBookmark = null }
      }
      retained = await retainManagedTreeFromPath(userDataPath, {
        scopeId: input.projectId,
        sourcePath,
        sourceBookmark,
        sourceOrigin: 'finder_drop'
      })
      const material = store.repository.createProjectAssetMaterial({
        projectId: input.projectId,
        role: input.role,
        title: retained.root.file.originalName,
        entries: retained.entries.map((entry) => ({ file: entry.file, importRelativePath: entry.importRelativePath, parentFileId: entry.parentFileId })),
        usageType: input.usageType
      })
      items.push(summarizeAssetImportItem({ sourceName: retained.root.file.originalName, materialId: material.id, entries: retained.entries, failures: retained.failures }))
      retained = null
    } catch (error) {
      if (retained) await discardManagedLocators(userDataPath, retained.entries.map((entry) => entry.file.managedLocator ?? entry.file.relativePath))
      items.push({
        sourceName,
        status: 'failed',
        materialId: null,
        fileCount: 0,
        folderCount: 0,
        storedOnlyCount: 0,
        failedEntries: [],
        message: safeAssetImportMessage(error)
      })
    }
  }
  return {
    canceled: false,
    items,
    importedRootCount: items.filter((item) => item.materialId).length,
    storedOnlyFileCount: items.reduce((sum, item) => sum + item.storedOnlyCount, 0),
    failedEntryCount: items.reduce((sum, item) => sum + item.failedEntries.length + (item.status === 'failed' ? 1 : 0), 0)
  }
}

export function registerIpcHandlers(store: WorkspaceStore, services: { taskRunner: TaskRunner; externalDraftWatcher: ExternalDraftWatcher; mobileSync: MobileSyncService; secretProtector: SecretProtector; providerConfigs: ExternalProviderConfigService; nasArchiveConfigs: NasArchiveConfigService; nasArchive: NasArchiveService; businessLedgerLock: BusinessLedgerLockService; weather: WeatherService }): void {
  registerPersonalReviewIpc(store, notifyWorkspaceChanged)
  const publishingPilotClipboardPackets = new Map<string, string>()
  const freezeContentInstructionTargets = async (
    input: ReturnType<typeof contentInstructionRequestPreparePayloadSchema.parse>
  ): Promise<FrozenContentInstructionTargetPreparation[]> => {
    const deterministicTestPrepare = process.env.NODE_ENV === 'test' && process.env.CREATOR_OS_TEST_R16C_PREPARE === '1'
    const providerContexts = deterministicTestPrepare
      ? input.targets.map((target) => {
        if (target.providerConfigId === BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex) return {
          provider: 'codex_cli' as const,
          providerConfigId: target.providerConfigId,
          displayName: 'Codex R16c测试运行时',
          cliVersion: 'test',
          fingerprint: 'r16c-e2e-codex',
          policyVersion: 'test'
        }
        if (target.providerConfigId === BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude) return {
          provider: 'claude_cli' as const,
          providerConfigId: target.providerConfigId,
          displayName: 'Claude R16c测试运行时',
          cliVersion: 'test',
          fingerprint: 'r16c-e2e-claude',
          policyVersion: 'test'
        }
        throw new Error('R16c测试不允许未知Provider配置')
      })
      : await Promise.all(input.targets.map((target) => (
        services.taskRunner.freezeTextProviderExecutionContext(target.providerConfigId)
      )))
    providerContexts.forEach((providerSecurity) => {
      if (providerSecurity.provider === 'external_api') throw new Error('结构化引用请求暂不支持外部API Provider')
    })
    const codexModels = deterministicTestPrepare
      ? [{ id: 'gpt-5.6', displayName: 'gpt-5.6', isDefault: true, reasoningEfforts: ['xhigh', 'high', 'medium', 'low'] }]
      : providerContexts.some((context) => context.provider === 'codex_cli')
        ? await services.taskRunner.listCodexWritingModels()
        : []
    return input.targets.map((target, index): FrozenContentInstructionTargetPreparation => {
      const providerSecurity = providerContexts[index]
      if (!providerSecurity || providerSecurity.provider === 'external_api') throw new Error('Provider运行时快照不完整')
      let actualModel: string | null = null
      let actualReasoningEffort: string | null = null
      let requestedModel = target.requestedModel
      let requestedReasoningEffort = target.requestedReasoningEffort ?? null
      if (providerSecurity.provider === 'codex_cli') {
        const resolved = resolveCodexInstructionTarget(codexModels, target.requestedModel, target.requestedReasoningEffort ?? null)
        actualModel = resolved.actualModel
        actualReasoningEffort = resolved.actualReasoningEffort
      } else {
        requestedModel = target.requestedModel === 'auto' ? 'opus' : target.requestedModel
        requestedReasoningEffort = target.requestedReasoningEffort && target.requestedReasoningEffort !== 'auto'
          ? target.requestedReasoningEffort
          : 'max'
      }
      return {
        providerConfigId: target.providerConfigId,
        providerSecurity: structuredClone(providerSecurity),
        requestedModel,
        actualModel,
        requestedReasoningEffort,
        actualReasoningEffort,
        historyThreadId: target.historyThreadId ?? null,
        providerThreadId: target.providerThreadId ?? null,
        historyMessageIds: [...(target.historyMessageIds ?? [])],
        historyHash: createHash('sha256').update(JSON.stringify(target.historyMessageIds ?? [])).digest('hex')
      }
    })
  }
  const testDraftBaseFailureCall = process.env.NODE_ENV === 'test'
    ? Number(process.env.CREATOR_OS_TEST_DRAFT_BASE_FAILURE_CALL ?? 0)
    : 0
  let draftBaseSetCallCount = 0
  const clearPublishingPilotClipboard = (pilotId: string): void => {
    const packet = publishingPilotClipboardPackets.get(pilotId)
    const current = clipboard.readText()
    const persistedHash = store.repository.getPublishingComputerUsePilotClipboardSha256(pilotId)
    if ((packet && current === packet) || (persistedHash && createHash('sha256').update(current).digest('hex') === persistedHash)) clipboard.clear()
    publishingPilotClipboardPackets.delete(pilotId)
  }
  const decodePublishingContact = (accountId: string): { phone: string | null; email: string | null } => {
    const ciphertext = store.repository.getPublishingAccountCiphertext(accountId)
    if (!ciphertext || !services.secretProtector.isAvailable()) return { phone: null, email: null }
    try {
      const parsed = JSON.parse(services.secretProtector.decrypt(ciphertext)) as { phone?: unknown; email?: unknown }
      return {
        phone: typeof parsed.phone === 'string' && parsed.phone ? parsed.phone : null,
        email: typeof parsed.email === 'string' && parsed.email ? parsed.email : null
      }
    } catch { return { phone: null, email: null } }
  }
  const maskPhone = (value: string | null): string | null => value ? `${value.slice(0, Math.min(3, Math.max(0, value.length - 4)))}••••${value.slice(-4)}` : null
  const maskEmail = (value: string | null): string | null => {
    if (!value) return null
    const [local, domain] = value.split('@')
    return domain ? `${local?.slice(0, 1) || '•'}•••@${domain}` : '••••'
  }
  const publishingAccountState = (projectId: string | null) => ({
    accounts: store.repository.listPublishingAccounts(true).map((account) => {
      const contact = decodePublishingContact(account.id)
      return { ...account, maskedPhone: maskPhone(contact.phone), maskedEmail: maskEmail(contact.email) }
    }),
    selections: projectId ? store.repository.listPublishingAccountSelections(projectId) : [],
    secureStorageAvailable: services.secretProtector.isAvailable()
  })
  const assertCurrentPublishingHandoff = (handoff: PublishingHandoff): void => {
    const project = store.repository.getProject(handoff.projectId, false)
    const account = store.repository.getSelectedPublishingAccount(handoff.projectId, handoff.platform)
    assertPublishingHandoffCurrent(handoff, preparePublishingPackage(project, handoff.platform, account))
  }
  const createTitleGenerationTasks = async (projectId: string, platform: string, options: { mode: 'master' | 'platform_adaptation'; masterTitle?: string; instruction: string } = { mode: 'master', instruction: '' }) => {
    const project = store.repository.getProject(projectId, false)
    const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
    if (!finalVersion) throw new Error('请先在文案中设置定稿')
    const sourceText = finalVersion.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
    if (!sourceText) throw new Error('定稿没有可用正文')
    const providers = ['codex_cli', 'claude_cli'] as const
    const contexts = await Promise.all(providers.map((provider) => services.taskRunner.getProviderExecutionContext(provider)))
    const tasks = providers.map((provider, index) => {
      const snapshot = titleGenerationTaskSnapshotSchema.parse({
        version: 1, projectId, projectTitle: project.title, platform, sourceVersionId: finalVersion.id,
        sourceRevision: finalVersion.revision, sourceText, providerSecurity: contexts[index],
        mode: options.mode, masterTitle: options.masterTitle ?? null, instruction: options.instruction,
        candidateCount: options.mode === 'master' ? 10 : 2, platformTitleLimit: options.mode === 'platform_adaptation' ? platformTitleLimit(platform) : null
      })
      return store.repository.createTaskRun({
        taskType: 'title_generation', projectId, title: `${provider === 'codex_cli' ? 'Codex' : 'Claude'}生成${options.mode === 'master' ? '主标题' : `${platform}短标题`}`, provider,
        inputSnapshot: JSON.stringify(snapshot), permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_asset', shell: false },
        outputTarget: 'candidate:title'
      })
    })
    tasks.forEach((task) => services.taskRunner.enqueue(task))
    return tasks
  }
  const conversationSources = new ConversationSourceService({
    cacheDirectory: join(dirname(store.databasePath), 'conversation-source-cache'),
    codexRoot: process.env.NODE_ENV === 'test' ? process.env.CREATOR_OS_TEST_CODEX_ROOT : undefined,
    claudeRoot: process.env.NODE_ENV === 'test' ? process.env.CREATOR_OS_TEST_CLAUDE_ROOT : undefined
  })
  type PreparedScan = {
    preflight: ConversationScanPreflight
    providerExecution: TextProviderExecutionContext
    selections: { sources: ConversationMetadata[]; selection: ConversationSelectionPreview }[]
    skippedIssues: ConversationSelectionPreview['issues']
    createdAt: number
  }
  const preparedScans = new PreflightRegistry<PreparedScan>()
  const prunePreparedScans = (): void => {
    const cutoff = Date.now() - 30 * 60 * 1_000
    preparedScans.pruneOlderThan(cutoff)
  }
  const scanMetadata = async (input: { mode: 'deep' | 'incremental'; sourceScope: 'codex' | 'claude' | 'both' }): Promise<{ all: ConversationMetadata[]; eligible: ConversationMetadata[]; plan: ConversationScanPlan }> => {
    const listed = await conversationSources.listMetadata({ limit: 1_000 })
    const all = listed.conversations.filter((conversation) => input.sourceScope === 'both' || conversation.source === input.sourceScope)
    const scannedStates = store.repository.getConversationScanSourceStates()
    const eligible = input.mode === 'deep'
      ? all
      : all.filter((conversation) => scannedStates.get(conversation.id)?.updatedAt !== conversation.updatedAt)
    const estimateIsPartial = eligible.some((conversation) => conversation.sizeBytes === null)
    const estimatedCharacters = eligible.reduce((total, conversation) => {
      const previousOffset = input.mode === 'incremental' ? scannedStates.get(conversation.id)?.lastScannedOffset ?? 0 : 0
      return total + (conversation.sizeBytes === null ? 12_000 : Math.max(0, conversation.sizeBytes - previousOffset))
    }, 0)
    return {
      all,
      eligible,
      plan: {
        mode: input.mode,
        sourceScope: input.sourceScope,
        totalConversationCount: all.length,
        eligibleConversationCount: eligible.length,
        previouslyScannedCount: all.filter((conversation) => scannedStates.has(conversation.id)).length,
        estimatedCharacters,
        estimatedTokens: Math.ceil(estimatedCharacters / 2),
        estimateIsPartial
      }
    }
  }
  const scanTaskDescriptor = (task: TaskRun): { scanId: string; mode: 'deep' | 'incremental'; batchIndex: number } | null => {
    try {
      const value = JSON.parse(task.inputSnapshot) as { scan?: { scanId?: unknown; mode?: unknown; batchIndex?: unknown } }
      if (!value.scan || typeof value.scan.scanId !== 'string' || !['deep', 'incremental'].includes(String(value.scan.mode)) || !Number.isInteger(value.scan.batchIndex)) return null
      return { scanId: value.scan.scanId, mode: value.scan.mode as 'deep' | 'incremental', batchIndex: value.scan.batchIndex as number }
    } catch { return null }
  }
  const scanProgress = (requestedScanId?: string | null): ConversationScanProgress => {
    const described = store.repository.listConversationScanTaskRuns(requestedScanId).map((task) => ({ task, scan: scanTaskDescriptor(task) })).filter((item): item is { task: TaskRun; scan: NonNullable<ReturnType<typeof scanTaskDescriptor>> } => Boolean(item.scan))
    const scanId = requestedScanId ?? described[0]?.scan.scanId ?? null
    if (!scanId) return { scanId: null, mode: null, totalBatches: 0, completedBatches: 0, failedBatches: 0, activeBatches: 0, pausedBatches: 0, status: 'idle' }
    const latestByBatch = new Map<number, { task: TaskRun; scan: NonNullable<ReturnType<typeof scanTaskDescriptor>> }>()
    described.filter((item) => item.scan.scanId === scanId).forEach((item) => {
      const current = latestByBatch.get(item.scan.batchIndex)
      if (!current || current.task.requestedAt < item.task.requestedAt) latestByBatch.set(item.scan.batchIndex, item)
    })
    const items = [...latestByBatch.values()]
    if (!items.length) return { scanId, mode: null, totalBatches: 0, completedBatches: 0, failedBatches: 0, activeBatches: 0, pausedBatches: 0, status: 'idle' }
    const completedBatches = items.filter(({ task }) => task.status === 'succeeded').length
    const failedBatches = items.filter(({ task }) => task.status === 'failed').length
    const activeBatches = items.filter(({ task }) => task.status === 'queued' || task.status === 'running').length
    const pausedBatches = items.filter(({ task }) => task.status === 'canceled').length
    const status = activeBatches ? 'running' : pausedBatches ? 'paused' : failedBatches ? 'failed' : completedBatches === items.length ? 'completed' : 'idle'
    return { scanId, mode: items[0]!.scan.mode, totalBatches: items.length, completedBatches, failedBatches, activeBatches, pausedBatches, status }
  }
  ipcMain.handle(IPC_CHANNELS.getAppInfo, async (event, payload) => {
    assertTrustedSender(event, ['main', 'capture', 'todo', 'schedule'])
    emptyPayloadSchema.parse(payload)
    let buildId = 'development'
    let builtAt: string | null = null
    try {
      const buildInfo = JSON.parse(await readFile(join(process.resourcesPath, 'build-info.json'), 'utf8')) as { buildId?: unknown; builtAt?: unknown }
      if (typeof buildInfo.buildId === 'string' && buildInfo.buildId.trim()) buildId = buildInfo.buildId
      if (typeof buildInfo.builtAt === 'string' && !Number.isNaN(Date.parse(buildInfo.builtAt))) builtAt = buildInfo.builtAt
    } catch {
      // Development and unpackaged test runs intentionally have no build manifest.
    }
    const installPath = app.getPath('exe')
    return {
      name: PRODUCT_NAME,
      version: app.getVersion(),
      platform: process.platform,
      captureShortcut: CAPTURE_SHORTCUT,
      buildId,
      builtAt,
      installPath,
      isInstalledBuild: installPath.startsWith('/Applications/LY Creator OS.app/')
    }
  })

  ipcMain.handle(IPC_CHANNELS.externalLinkOpen, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = externalLinkOpenPayloadSchema.parse(payload)
    if (!isBackgroundTestMode) await openExternalSafely(input.url)
  })

  ipcMain.handle(IPC_CHANNELS.codexWritingModelsList, async (event) => {
    assertTrustedSender(event, ['main'])
    try {
      return await services.taskRunner.listCodexWritingModels()
    } catch {
      const capability = await services.taskRunner.validateProvider('codex_cli')
      if (!capability.available) throw new Error(capability.detail || 'Codex安全验证未通过')
      return services.taskRunner.listCodexWritingModels()
    }
  })

  ipcMain.handle(IPC_CHANNELS.structuredReferenceCatalogList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = structuredReferenceCatalogListPayloadSchema.parse(payload)
    return store.repository.listStructuredReferenceCatalog(input.projectId, input.sessionScope, input.query)
  })

  ipcMain.handle(IPC_CHANNELS.structuredReferenceRolesResolve, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = structuredReferenceRolesResolvePayloadSchema.parse(payload)
    return resolveStructuredReferenceRoles(input.text, input.references)
  })

  ipcMain.handle(IPC_CHANNELS.projectReferenceRolePreferenceSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectReferenceRolePreferenceSetPayloadSchema.parse(payload)
    const preference = store.repository.setProjectReferenceRolePreference(input)
    notifyWorkspaceChanged()
    return preference
  })

  ipcMain.handle(IPC_CHANNELS.projectReferenceRolePreferenceRemove, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectReferenceRolePreferenceRemovePayloadSchema.parse(payload)
    store.repository.removeProjectReferenceRolePreference(input.projectId, input.sourceKind, input.sourceId, input.scope)
    notifyWorkspaceChanged()
  })

  ipcMain.handle(IPC_CHANNELS.contentInstructionDispatch, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentInstructionDispatchPayloadSchema.parse(payload)
    assertContentInstructionDispatchMatchesExecution(input)
    if (input.operation === 'script_material_chat' || input.operation === 'script_material_rewrite') {
      assertMaterialInstructionMatchesWorkspace(input, store.repository.getScriptMaterialWorkspace(input.request.projectId))
    }
    const targetPreparations = await freezeContentInstructionTargets(input.instruction)
    const result = store.repository.native.transaction(() => {
      const preparationAt = (index: number): FrozenContentInstructionTargetPreparation => {
        const preparation = targetPreparations[index]
        if (!preparation) throw new Error('结构化请求缺少对应的Provider运行时')
        return preparation
      }
      let instruction = input.instruction
      const frozenResourceSnapshot = instruction.includeProjectContext
        ? store.repository.buildTaskResourceSnapshot(instruction.projectId, {
          ...(instruction.resourceSelection ?? {}),
          preserveFullContext: true
        })
        : null
      let tasks: TaskRun[]
      if (input.operation === 'script_revision') {
        const frozenCurrentScriptContent = instruction.target?.kind === 'current_script' && !instruction.supersedesRequestId
          ? store.repository.getFrozenCurrentScriptTargetContent(instruction.projectId, instruction.target)
          : null
        tasks = input.requests.map((request, index) => {
          const preparation = preparationAt(index)
          if (preparation.providerSecurity.provider !== request.provider) throw new Error('文案任务Provider与冻结目标不一致')
          return store.repository.startScriptRevisionDiscussion({
            ...request,
            currentDocumentContent: frozenCurrentScriptContent ?? request.currentDocumentContent,
            preferredModel: preparation.actualModel ?? request.preferredModel,
            preferredReasoningEffort: preparation.actualReasoningEffort ?? request.preferredReasoningEffort,
            frozenResourceSnapshot,
            selection: { ...request.selection, targetSelectionId: request.selection.targetSelectionId ?? null },
            providerSecurity: preparation.providerSecurity
          })
        })
      } else if (input.operation === 'script_material_chat') {
        const currentDocumentParagraphs = store.repository.getFrozenCurrentScriptParagraphs(input.request.projectId)
        instruction = contentInstructionRequestPreparePayloadSchema.parse({ ...instruction, currentDocumentParagraphs })
        tasks = input.request.requests.map((request, index) => {
          const preparation = preparationAt(index)
          if (preparation.providerConfigId !== request.providerConfigId) throw new Error('素材成稿Provider与冻结目标不一致')
          return store.repository.startScriptMaterialChat({
            projectId: input.request.projectId,
            side: request.side,
            message: input.request.message,
            includeProjectContext: input.request.includeProjectContext,
            preferredModel: preparation.actualModel ?? request.preferredModel,
            preferredReasoningEffort: preparation.actualReasoningEffort,
            currentDocumentParagraphs,
            frozenResourceSnapshot,
            providerSecurity: preparation.providerSecurity
          })
        })
      } else if (input.operation === 'script_material_rewrite') {
        const preparation = preparationAt(0)
        if (preparation.providerConfigId !== input.request.providerConfigId) throw new Error('局部候选Provider与冻结目标不一致')
        const currentDocumentParagraphs = store.repository.getFrozenCurrentScriptParagraphs(input.request.projectId)
        const applicationTarget = store.repository.freezeScriptMaterialApplicationTarget(
          input.request.projectId,
          input.request.draftId,
          input.request.paragraphIds,
          input.request.applicationTarget
        )
        instruction = contentInstructionRequestPreparePayloadSchema.parse({
          ...instruction,
          currentDocumentParagraphs,
          target: instruction.target?.kind === 'material_draft'
            ? { ...instruction.target, applicationTarget }
            : instruction.target
        })
        tasks = [store.repository.startScriptMaterialRewriteCandidate({
          projectId: input.request.projectId,
          draftId: input.request.draftId,
          parentCandidateId: input.request.parentCandidateId,
          applicationTarget,
          paragraphIds: input.request.paragraphIds,
          selectedParagraphId: input.request.selectedParagraphId,
          selectedText: input.request.selectedText,
          selectedStart: input.request.selectedStart,
          selectedEnd: input.request.selectedEnd,
          requirement: input.request.requirement,
          includeProjectContext: input.request.includeProjectContext,
          preferredModel: preparation.actualModel ?? input.request.preferredModel,
          preferredReasoningEffort: preparation.actualReasoningEffort ?? input.request.preferredReasoningEffort,
          providerSecurity: preparation.providerSecurity,
          currentDocumentParagraphs,
          frozenResourceSnapshot
        })]
      } else {
        const preparation = preparationAt(0)
        if (preparation.providerConfigId !== input.request.providerConfigId) throw new Error('双稿候选Provider与冻结目标不一致')
        const task = store.repository.startDraftCandidateGeneration({
          ...input.request,
          webSearchMode: instruction.webSearchMode,
          frozenResourceSnapshot,
          preferredModel: preparation.actualModel ?? input.request.preferredModel,
          preferredReasoningEffort: preparation.actualReasoningEffort ?? input.request.preferredReasoningEffort,
          providerSecurity: preparation.providerSecurity
        })
        const taskSnapshot = JSON.parse(task.inputSnapshot) as {
          requirement?: string
          sourceSelections?: ContentSourceSelectionSnapshot[]
        }
        if (!taskSnapshot.sourceSelections?.length) throw new Error('候选任务没有冻结可信来源，请重新发起')
        instruction = contentInstructionRequestPreparePayloadSchema.parse({
          ...instruction,
          displayText: taskSnapshot.requirement ?? instruction.displayText,
          target: { kind: 'draft_comparison', groupId: input.request.groupId, sourceSelections: taskSnapshot.sourceSelections }
        })
        tasks = [task]
      }
      if (tasks.length !== targetPreparations.length) throw new Error('AI任务数量与冻结目标不一致')
      if (input.operation === 'script_revision' && instruction.target?.kind === 'current_script') {
        tasks.forEach((task) => store.repository.assertScriptRevisionTaskMatchesCurrentTarget(
          task,
          instruction.target as Extract<NonNullable<typeof instruction.target>, { kind: 'current_script' }>,
          Boolean(instruction.supersedesRequestId)
        ))
      }
      const effectiveTargetPreparations = targetPreparations.map((preparation, index): FrozenContentInstructionTargetPreparation => {
        const task = tasks[index]
        if (!task) throw new Error('结构化请求缺少对应的实际任务')
        if (input.operation === 'script_revision') {
          const snapshot = parseScriptRevisionTaskSnapshot(task.inputSnapshot)
          if (snapshot.historyMessageIds.length !== snapshot.history.length) throw new Error('文案任务历史身份不完整')
          return {
            ...preparation,
            historyThreadId: snapshot.threadId,
            providerThreadId: snapshot.providerRuntime.providerThreadId,
            historyMessageIds: [...snapshot.historyMessageIds]
          }
        }
        if (input.operation === 'script_material_chat' || input.operation === 'script_material_rewrite') {
          const snapshot = parseScriptMaterialChatTaskSnapshot(task.inputSnapshot)
          if (snapshot.historyMessageIds.length !== snapshot.history.length) throw new Error('素材任务历史身份不完整')
          return { ...preparation, historyThreadId: null, providerThreadId: null, historyMessageIds: [...snapshot.historyMessageIds] }
        }
        return preparation
      })
      let request = store.repository.prepareContentInstructionRequest({ ...instruction, targets: effectiveTargetPreparations }, frozenResourceSnapshot)
      const unlinkedIndexes = new Set(effectiveTargetPreparations.map((_, index) => index))
      request.targets.forEach((target) => {
        const index = [...unlinkedIndexes].find((candidate) => (
          effectiveTargetPreparations[candidate]?.providerConfigId === target.providerConfigId
          && tasks[candidate]?.provider === target.provider
        ))
        if (index === undefined) throw new Error('AI任务与结构化目标没有一一对应')
        unlinkedIndexes.delete(index)
        const task = tasks[index]
        const preparation = effectiveTargetPreparations[index]
        if (!task || !preparation || task.provider !== target.provider) throw new Error('AI任务与结构化目标没有一一对应')
        store.repository.bindContentProviderInput(request.request.id, target.id, task.id)
        request = store.repository.appendContentInstructionTargetEvent({
          targetId: target.id,
          eventKind: 'task_linked',
          actualModel: preparation.actualModel,
          actualReasoningEffort: preparation.actualReasoningEffort,
          providerThreadId: preparation.providerThreadId,
          taskId: task.id,
          status: task.status === 'running' ? 'running' : 'queued'
        })
        if (
          process.env.NODE_ENV === 'test'
          && process.env.CREATOR_OS_TEST_R16D_ROLLBACK === '1'
          && instruction.displayText === 'R16D_TEST_FAIL_AFTER_FIRST_LINK'
          && request.targetEvents.filter((event) => event.eventKind === 'task_linked').length === 1
        ) {
          throw new Error(`R16D_TEST_ROLLBACK:${request.request.id}:${task.id}`)
        }
      })
      return { request, tasks }
    })()
    const handledTaskIds = new Set<string>()
    const deterministicRevision = process.env.NODE_ENV === 'test' && process.env.CREATOR_OS_TEST_R16B_REWRITE === '1'
    if (deterministicRevision && input.operation === 'script_revision') {
      input.requests.forEach((request, index) => {
        const task = result.tasks[index]
        if (!task || request.provider !== 'codex_cli') return
        const selectedText = request.selection.selectedText?.trim() ?? ''
        const sourceSelectionIds = (request.sourceSelections ?? []).map((selection) => selection.selectionId)
        store.repository.saveScriptRevisionAnswer(task.id, {
          answer: '已根据冻结选区生成候选，原文没有被自动覆盖。',
          suggestion: selectedText ? {
            originalText: selectedText,
            replacementText: `R16b统一候选：${selectedText}`,
            action: 'replace',
            summary: '实际候选先预览',
            rationale: '验证保留、继续修改、追加和替换。'
          } : null,
          conflicts: sourceSelectionIds.length > 1 ? [{
            id: 'r16b-visible-conflict',
            kind: 'fact',
            summary: '多个冻结来源存在需要人工决定的事实差异',
            sourceSelectionIds,
            sourceExcerpts: (request.sourceSelections ?? []).map((selection) => selection.selectedText)
          }] : []
        }, {
          providerThreadId: 'r16b-e2e-thread',
          model: request.preferredModel ?? 'gpt-5.6',
          reasoningEffort: request.preferredReasoningEffort ?? 'high',
          webSearchMode: request.webSearchMode ?? 'automatic',
          webSearches: []
        })
        store.repository.updateTaskRun(task.id, {
          status: 'succeeded', progress: 100, resultSummary: '候选已生成', finishedAt: new Date().toISOString()
        })
        handledTaskIds.add(task.id)
      })
    }
    const deterministicDraft = process.env.NODE_ENV === 'test' && process.env.CREATOR_OS_TEST_R18_REWRITE === '1'
    if (deterministicDraft && input.operation === 'draft_candidate') {
      const task = result.tasks[0]
      if (task) {
        const complete = (): void => {
          const snapshot = JSON.parse(task.inputSnapshot) as { sourceSelections?: Array<{ selectionId: string; selectedText: string }> }
          const sourceSelections = snapshot.sourceSelections ?? []
          store.repository.saveDraftCandidateResult(task.id, {
            content: input.request.selectedText ? `重新生成的${input.request.selectedText}` : '这是重新生成的候选文案，不会直接替换当前内容。',
            summary: 'R18测试改写候选',
            rationale: '验证候选先预览、再加入或替换',
            conflicts: sourceSelections.length > 1 ? [{
              id: 'r16b-draft-visible-conflict', kind: 'fact',
              summary: '多个来源的事实表述不同，需要人工决定',
              sourceSelectionIds: sourceSelections.map((selection) => selection.selectionId),
              sourceExcerpts: sourceSelections.map((selection) => selection.selectedText)
            }] : []
          }, { model: input.request.preferredModel ?? 'gpt-5.6', reasoningEffort: input.request.preferredReasoningEffort ?? 'high' })
          store.repository.updateTaskRun(task.id, { status: 'succeeded', progress: 100, resultSummary: '候选已生成', finishedAt: new Date().toISOString() })
          notifyWorkspaceChanged()
        }
        const delay = Number(process.env.CREATOR_OS_TEST_R18_REWRITE_DELAY_MS ?? 0)
        if (Number.isSafeInteger(delay) && delay > 0) setTimeout(complete, Math.min(delay, 2_000))
        else complete()
        handledTaskIds.add(task.id)
      }
    }
    const deterministicDispatch = process.env.NODE_ENV === 'test' && process.env.CREATOR_OS_TEST_R16D_DISPATCH === '1'
    if (!deterministicDispatch) result.tasks.filter((task) => !handledTaskIds.has(task.id)).forEach((task) => services.taskRunner.enqueue(task))
    else result.tasks.filter((task) => !handledTaskIds.has(task.id)).forEach((task) => store.repository.updateTaskRun(task.id, {
      status: 'succeeded', progress: 100, resultSummary: 'R16d结构化发送测试已完成', finishedAt: new Date().toISOString()
    }))
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.contentInstructionRequestGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentInstructionRequestGetPayloadSchema.parse(payload)
    return store.repository.getContentInstructionRequest(input.requestId)
  })

  ipcMain.handle(IPC_CHANNELS.contentInstructionRequestGetByTask, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentInstructionRequestGetByTaskPayloadSchema.parse(payload)
    return store.repository.getContentInstructionRequestByTaskId(input.taskId)
  })

  ipcMain.handle(IPC_CHANNELS.contentFactEvidenceGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentFactEvidenceGetPayloadSchema.parse(payload)
    return store.repository.getContentFactEvidence(input.projectId, input.evidenceIds)
  })

  ipcMain.handle(IPC_CHANNELS.openCapture, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = openCapturePayloadSchema.parse(payload)
    openCaptureWindow(input.projectId ?? null, input.captureKind ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.closeCapture, (event, payload) => {
    assertTrustedSender(event, ['capture'])
    emptyPayloadSchema.parse(payload)
    closeCaptureWindow()
  })

  ipcMain.handle(IPC_CHANNELS.scheduleWindowResize, (event, payload) => {
    assertTrustedSender(event, ['schedule'])
    const { height } = scheduleWindowResizePayloadSchema.parse(payload)
    resizeSchedulePanelWindow(height)
  })
  ipcMain.handle(IPC_CHANNELS.scheduleWindowClose, (event, payload) => {
    assertTrustedSender(event, ['schedule'])
    emptyPayloadSchema.parse(payload)
    closeSchedulePanelWindow()
  })
  ipcMain.handle(IPC_CHANNELS.scheduleWindowOpenMain, (event, payload) => {
    assertTrustedSender(event, ['schedule'])
    const { day } = scheduleWindowOpenMainPayloadSchema.parse(payload)
    openMainScheduleWindow(day)
  })

  ipcMain.handle(IPC_CHANNELS.todoWindowOpenWidget, (event, payload) => {
    assertTrustedSender(event, ['todo'])
    emptyPayloadSchema.parse(payload)
    openTodoWidgetWindow()
  })

  ipcMain.handle(IPC_CHANNELS.todoWindowOpenMain, (event, payload) => {
    assertTrustedSender(event, ['todo'])
    emptyPayloadSchema.parse(payload)
    revealMainWindow()
  })

  ipcMain.handle(IPC_CHANNELS.todoWindowClose, (event, payload) => {
    assertTrustedSender(event, ['todo'])
    emptyPayloadSchema.parse(payload)
    closeTodoWindow(event.sender.id)
  })

  ipcMain.handle(IPC_CHANNELS.workspaceGet, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo', 'schedule'])
    emptyPayloadSchema.parse(payload)
    return { ...store.repository.getSnapshot(), providerCapabilities: services.taskRunner.getCapabilities() }
  })

  ipcMain.handle(IPC_CHANNELS.weatherGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = weatherGetPayloadSchema.parse(payload)
    return services.weather.getSnapshot(store.repository.getPreferences().weatherCity, input.force)
  })

  ipcMain.handle(IPC_CHANNELS.workspaceBackupCreate, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    await store.createBackup('manual')
    return { createdAt: new Date().toISOString(), label: '手动备份' }
  })

  ipcMain.handle(IPC_CHANNELS.workspaceBackupRestoreChoose, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: '选择LY Creator OS备份文件夹', buttonLabel: '选择备份', properties: ['openDirectory'] }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) return { scheduled: false }
    const confirmationOptions: Electron.MessageBoxOptions = {
      type: 'warning', buttons: ['取消', '恢复并重启'], defaultId: 0, cancelId: 0,
      title: '恢复工作区备份？', message: 'App会先备份当前数据，再安全重启并恢复所选备份。'
    }
    const confirmation = owner ? await dialog.showMessageBox(owner, confirmationOptions) : await dialog.showMessageBox(confirmationOptions)
    if (confirmation.response !== 1) return { scheduled: false }
    await scheduleWorkspaceRestore(dirname(store.databasePath), await realpath(selection.filePaths[0]), services.secretProtector)
    setTimeout(() => { app.relaunch(); app.quit() }, 100)
    return { scheduled: true }
  })

  ipcMain.handle(IPC_CHANNELS.globalSearch, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = globalSearchPayloadSchema.parse(payload)
    return store.repository.searchGlobal(input.query, input.limit)
  })

  ipcMain.handle(IPC_CHANNELS.workspaceUndoStateGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.getWorkspaceUndoState()
  })

  ipcMain.handle(IPC_CHANNELS.workspaceUndo, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = workspaceUndoPayloadSchema.parse(payload)
    try {
      return store.repository.undoWorkspaceOperation(input.operationId)
    } finally {
      notifyWorkspaceChanged()
    }
  })

  ipcMain.handle(IPC_CHANNELS.projectGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectGetPayloadSchema.parse(payload)
    return store.repository.getProject(input.projectId, input.touch ?? true)
  })

  ipcMain.handle(IPC_CHANNELS.projectCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCreatePayloadSchema.parse(payload)
    const project = store.repository.createProject(input)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectTrash, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectTrashPayloadSchema.parse(payload)
    const project = store.repository.trashProject(input.projectId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectRename, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectRenamePayloadSchema.parse(payload)
    const project = store.repository.renameProject(input.projectId, input.title)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectSetPinned, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectSetPinnedPayloadSchema.parse(payload)
    const project = store.repository.setProjectPinned(input.projectId, input.pinned, input.requestId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectSetColor, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectSetColorPayloadSchema.parse(payload)
    const project = store.repository.setProjectColor(input.projectId, input.colorToken)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectClassifyDraft, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectClassifyDraftPayloadSchema.parse(payload)
    return store.repository.classifyProjectDraft(input.title, input.description)
  })

  ipcMain.handle(IPC_CHANNELS.projectRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectTrashPayloadSchema.parse(payload)
    const project = store.repository.restoreProject(input.projectId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectDeletePermanently, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectTrashPayloadSchema.parse(payload)
    const deleted = store.repository.permanentlyDeleteProject(input.projectId)
    if (deleted) {
      const released = store.repository.releaseOrphanFileReferences()
      await cleanupReleasedManagedFiles(dirname(store.databasePath), released.managedLocators, store.repository.listManagedFileLocators())
    }
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.projectSetLifecycle, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectSetLifecyclePayloadSchema.parse(payload)
    const project = store.repository.setProjectLifecycle(input.projectId, input.lifecycle)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.topicTrash, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicTrashPayloadSchema.parse(payload)
    const topic = store.repository.trashTopic(input.topicId)
    notifyWorkspaceChanged()
    return topic
  })

  ipcMain.handle(IPC_CHANNELS.topicRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicTrashPayloadSchema.parse(payload)
    const topic = store.repository.restoreTopic(input.topicId)
    notifyWorkspaceChanged()
    return topic
  })

  ipcMain.handle(IPC_CHANNELS.topicDeletePermanently, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicTrashPayloadSchema.parse(payload)
    const deleted = store.repository.permanentlyDeleteTopic(input.topicId)
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.captureDeletePermanently, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = captureDeletePayloadSchema.parse(payload)
    const deleted = store.repository.permanentlyDeleteCapture(input.captureId)
    if (deleted) {
      const released = store.repository.releaseOrphanFileReferences()
      await cleanupReleasedManagedFiles(dirname(store.databasePath), released.managedLocators, store.repository.listManagedFileLocators())
    }
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.filterCandidateRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = filterCandidatePayloadSchema.parse(payload)
    const candidate = store.repository.restoreFilterCandidate(input.candidateId)
    notifyWorkspaceChanged()
    return candidate
  })

  ipcMain.handle(IPC_CHANNELS.filterCandidateDeletePermanently, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = filterCandidatePayloadSchema.parse(payload)
    const deleted = store.repository.permanentlyDeleteFilterCandidate(input.candidateId)
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.recycleEmpty, async (event) => {
    assertTrustedSender(event, ['main'])
    const result = store.repository.emptyRecycleBin()
    if (result.deletedCount > 0) {
      const released = store.repository.releaseOrphanFileReferences()
      await cleanupReleasedManagedFiles(dirname(store.databasePath), released.managedLocators, store.repository.listManagedFileLocators())
    }
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectRevealFolder, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectTrashPayloadSchema.parse(payload)
    store.repository.getProject(input.projectId, false)
    const safeProject = input.projectId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
    const folder = join(dirname(store.databasePath), 'project-materials', safeProject)
    const exists = await stat(folder).then((entry) => entry.isDirectory()).catch(() => false)
    if (!exists) throw new Error('这个项目还没有本机资料文件；先在资料模块导入文件后再打开文件夹')
    if (!isBackgroundTestMode) shell.showItemInFolder(folder)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.projectUpdateClassification, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectUpdateClassificationPayloadSchema.parse(payload)
    const project = store.repository.updateProjectClassification(input.projectId, input.patch)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectUpdateContentType, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectUpdateContentTypePayloadSchema.parse(payload)
    const project = store.repository.updateProjectContentType(input.projectId, input.contentTypeId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectUpdatePlatforms, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectUpdatePlatformsPayloadSchema.parse(payload)
    const project = store.repository.updateProjectPlatforms(input.projectId, input.platformTargets)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectTemplateSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const template = store.repository.saveProjectTemplate(projectTemplateSavePayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return template
  })

  ipcMain.handle(IPC_CHANNELS.projectTemplatePreview, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectTemplatePayloadSchema.parse(payload)
    return store.repository.previewProjectTemplate(input.projectId, input.templateId)
  })

  ipcMain.handle(IPC_CHANNELS.projectTemplateApply, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectTemplatePayloadSchema.parse(payload)
    const project = store.repository.applyProjectTemplate(input.projectId, input.templateId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectSetModule, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectSetModulePayloadSchema.parse(payload)
    const project = store.repository.setModule(input.projectId, input.moduleKey, input.enabled)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectReorderModules, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectReorderModulesPayloadSchema.parse(payload)
    const project = store.repository.reorderModules(input.projectId, input.moduleKeys)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectSetModuleCompleted, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectSetModuleCompletedPayloadSchema.parse(payload)
    const result = store.repository.setModuleCompleted(input.projectId, input.moduleKey, input.completed, input.requestId)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectStageTimeContextGet, (event) => {
    assertTrustedSender(event, ['main'])
    return store.repository.getStageTimeContext()
  })

  ipcMain.handle(IPC_CHANNELS.projectStageTimeUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectStageTimeUpdatePayloadSchema.parse(payload)
    const result = store.repository.updateStageTime(input.projectId, input.stageKey, input, input.requestId)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectStageTimeSetStatus, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectStageTimeSetStatusPayloadSchema.parse(payload)
    const result = store.repository.setStageTimeStatus(input.projectId, input.stageKey, input.action)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectStageTimeUndo, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectStageTimeUndoPayloadSchema.parse(payload)
    const result = store.repository.undoStageTimeEvent(input.projectId, input.eventId)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.creationReportGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = creationReportGetPayloadSchema.parse(payload)
    return store.repository.getCreationReport(input.kind, input.anchorDate, input.force ?? false)
  })

  ipcMain.handle(IPC_CHANNELS.creationReportSnapshotList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = creationReportSnapshotListPayloadSchema.parse(payload)
    return store.repository.listCreationReportSnapshots(input.kind, input.periodStart)
  })

  ipcMain.handle(IPC_CHANNELS.creationReportSnapshotGetById, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = creationReportSnapshotGetByIdPayloadSchema.parse(payload)
    return store.repository.getCreationReportSnapshotById(input.snapshotId)
  })

  ipcMain.handle(IPC_CHANNELS.projectCreationReviewGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCreationReviewGetPayloadSchema.parse(payload)
    return store.repository.getProjectCreationReview(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.creationReportConversationGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = creationReportConversationGetPayloadSchema.parse(payload)
    return store.repository.getCreationReportConversation(input.snapshotId)
  })

  ipcMain.handle(IPC_CHANNELS.creationReportMessageSend, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = creationReportMessageSendPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getProviderExecutionContext(input.provider)
    const task = store.repository.startCreationReportDiscussion({ ...input, providerSecurity })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.scriptRevisionConversationGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptRevisionConversationGetPayloadSchema.parse(payload)
    return store.repository.getScriptRevisionConversation(input.projectId, input.threadId, input.provider, input.surface)
  })

  ipcMain.handle(IPC_CHANNELS.scriptRevisionMessageSend, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptRevisionMessageSendPayloadSchema.parse(payload)
    const deterministicTestRewrite = process.env.NODE_ENV === 'test'
      && process.env.CREATOR_OS_TEST_R16B_REWRITE === '1'
      && input.provider === 'codex_cli'
    const providerSecurity = deterministicTestRewrite
      ? { provider: 'codex_cli' as const, cliVersion: 'test', fingerprint: 'r16b-e2e', policyVersion: 'test' }
      : await services.taskRunner.getProviderExecutionContext(input.provider)
    const task = store.repository.startScriptRevisionDiscussion({
      ...input,
      selection: { ...input.selection, targetSelectionId: input.selection.targetSelectionId ?? null },
      providerSecurity
    })
    if (deterministicTestRewrite) {
      const selectedText = input.selection.selectedText?.trim() ?? ''
      const sourceSelectionIds = (input.sourceSelections ?? []).map((selection) => selection.selectionId)
      store.repository.saveScriptRevisionAnswer(task.id, {
        answer: '已根据冻结选区生成候选，原文没有被自动覆盖。',
        suggestion: selectedText ? {
          originalText: selectedText,
          replacementText: `R16b统一候选：${selectedText}`,
          action: 'replace',
          summary: '实际候选先预览',
          rationale: '验证保留、继续修改、追加和替换。'
        } : null,
        conflicts: sourceSelectionIds.length > 1 ? [{
          id: 'r16b-visible-conflict',
          kind: 'fact',
          summary: '多个冻结来源存在需要人工决定的事实差异',
          sourceSelectionIds,
          sourceExcerpts: (input.sourceSelections ?? []).map((selection) => selection.selectedText)
        }] : []
      }, {
        providerThreadId: 'r16b-e2e-thread',
        model: input.preferredModel ?? 'gpt-5.6',
        reasoningEffort: input.preferredReasoningEffort ?? 'high',
        webSearchMode: input.webSearchMode ?? 'automatic',
        webSearches: []
      })
      store.repository.updateTaskRun(task.id, {
        status: 'succeeded', progress: 100, resultSummary: '候选已生成', finishedAt: new Date().toISOString()
      })
      notifyWorkspaceChanged()
      return store.repository.getTaskRun(task.id)
    }
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.scriptRevisionApplyValidate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptRevisionApplyValidatePayloadSchema.parse(payload)
    return store.repository.validateScriptRevisionApply(input.projectId, input.messageId, input.currentText)
  })

  ipcMain.handle(IPC_CHANNELS.scriptRevisionSuggestionStatusSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptRevisionSuggestionStatusSetPayloadSchema.parse(payload)
    const message = store.repository.setScriptRevisionSuggestionStatus(input.projectId, input.messageId, input.status)
    notifyWorkspaceChanged()
    return message
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptLoad, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptLoadPayloadSchema.parse(payload)
    return store.repository.loadProjectCurrentScript(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptInitialize, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptInitializePayloadSchema.parse(payload)
    const result = store.repository.initializeProjectCurrentScript(input)
    if (result.status === 'ready') notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptApply, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptApplyPayloadSchema.parse(payload)
    const result = store.repository.applyProjectCurrentScriptTransaction(input)
    if (result.status === 'applied') notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptVersionSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptVersionSavePayloadSchema.parse(payload)
    const result = store.repository.saveProjectCurrentScriptVersion(input)
    if (result.status === 'saved') notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptVersionRestore, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptVersionRestorePayloadSchema.parse(payload)
    const restoreDelay = process.env.NODE_ENV === 'test'
      ? Number(process.env.CREATOR_OS_TEST_CURRENT_SCRIPT_RESTORE_DELAY_MS ?? 0)
      : 0
    if (Number.isSafeInteger(restoreDelay) && restoreDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(restoreDelay, 2_000)))
    }
    const result = store.repository.restoreProjectCurrentScriptVersion(input)
    if (result.status === 'restored') notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptVersionSnapshotGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptVersionSnapshotGetPayloadSchema.parse(payload)
    return store.repository.getCurrentScriptVersionSnapshot(input.projectId, input.versionId)
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptRecoveryList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptRecoveryListPayloadSchema.parse(payload)
    return store.repository.listCurrentScriptRecoveryCandidates(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.projectCurrentScriptRecoveryResolve, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectCurrentScriptRecoveryResolvePayloadSchema.parse(payload)
    const result = store.repository.resolveCurrentScriptRecovery(input)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.sourceScriptAnnotationsList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = sourceScriptAnnotationsListPayloadSchema.parse(payload)
    return store.repository.listSourceScriptAnnotations(input.projectId, input)
  })

  ipcMain.handle(IPC_CHANNELS.sourceScriptAnnotationUpsert, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = sourceScriptAnnotationUpsertPayloadSchema.parse(payload)
    const annotation = store.repository.upsertSourceScriptAnnotation(input)
    notifyWorkspaceChanged()
    return annotation
  })

  ipcMain.handle(IPC_CHANNELS.sourceScriptAnnotationDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = sourceScriptAnnotationDeletePayloadSchema.parse(payload)
    const deleted = store.repository.deleteSourceScriptAnnotation(input.projectId, input.annotationId)
    if (deleted) notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialGetPayloadSchema.parse(payload)
    return store.repository.getScriptMaterialWorkspace(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialWorkspaceSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialWorkspaceSavePayloadSchema.parse(payload)
    const workspace = store.repository.saveScriptMaterialWorkspace(input.projectId, {
      workingContent: input.workingContent,
      requirement: input.requirement,
      aiCount: input.aiCount,
      selectedAiSide: input.selectedAiSide,
      selectedCodexDraftId: input.selectedCodexDraftId,
      selectedClaudeDraftId: input.selectedClaudeDraftId,
      webSearchMode: input.webSearchMode
    })
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialRevisionCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialRevisionCreatePayloadSchema.parse(payload)
    const workspace = store.repository.createScriptMaterialRevision(input.projectId)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialPointsReplace, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialPointsReplacePayloadSchema.parse(payload)
    const workspace = store.repository.replaceScriptMaterialPoints(input.projectId, input.revisionId, input.points)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialPointsConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialPointsConfirmPayloadSchema.parse(payload)
    const workspace = store.repository.confirmScriptMaterialPoints(input.projectId, input.revisionId)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialPointUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialPointUpdatePayloadSchema.parse(payload)
    const workspace = store.repository.updateScriptMaterialPoint(input.projectId, input.revisionId, input.pointId, {
      summary: input.summary,
      requirement: input.requirement,
      adoption: input.adoption
    })
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialAnnotationConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialAnnotationConfirmPayloadSchema.parse(payload)
    const workspace = store.repository.confirmScriptMaterialAnnotations(
      input.projectId,
      input.draftId,
      input.paragraphId,
      input.annotationIds
    )
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialManualMarksSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialManualMarksSetPayloadSchema.parse(payload)
    const workspace = store.repository.setScriptMaterialManualMarks(
      input.projectId,
      input.draftId,
      input.paragraphId,
      input.marks
    )
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialExtractStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialExtractStartPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getTextProviderExecutionContext(input.providerConfigId)
    const task = store.repository.startScriptMaterialExtraction({
      projectId: input.projectId,
      includeProjectContext: input.includeProjectContext,
      providerSecurity
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialGenerateStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialGenerateStartPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getTextProviderExecutionContext(input.providerConfigId)
    const task = store.repository.startScriptMaterialGeneration({
      projectId: input.projectId,
      side: input.side,
      includeProjectContext: input.includeProjectContext,
      providerSecurity
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialAuditStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialAuditStartPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getTextProviderExecutionContext(input.providerConfigId)
    const task = store.repository.startScriptMaterialAudit({
      projectId: input.projectId,
      target: input.target,
      draftId: input.draftId,
      currentContent: input.currentContent,
      currentParagraphs: input.currentParagraphs,
      providerSecurity
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialAllowedOmissionsSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialAllowedOmissionsSetPayloadSchema.parse(payload)
    const workspace = store.repository.setScriptMaterialAllowedOmissions(input.projectId, input.targetIdentity, input.pointIds)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialFindingConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialFindingConfirmPayloadSchema.parse(payload)
    const workspace = store.repository.confirmScriptMaterialFinding(input.projectId, input.targetIdentity, input.findingId, input.resolutionNote)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialFinalizationGateGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialFinalizationGateGetPayloadSchema.parse(payload)
    return store.repository.getScriptMaterialFinalizationGate(input.projectId, input.currentContent)
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialVersionSnapshotGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialVersionSnapshotGetPayloadSchema.parse(payload)
    return store.repository.getScriptMaterialVersionSnapshot(input.projectId, input.versionId)
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialVersionSnapshotRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialVersionSnapshotGetPayloadSchema.parse(payload)
    return store.repository.restoreScriptMaterialVersionSnapshot(input.projectId, input.versionId)
  })

  ipcMain.handle(IPC_CHANNELS.scriptMaterialMapStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptMaterialMapStartPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getTextProviderExecutionContext(input.providerConfigId)
    const task = store.repository.startScriptMaterialMapping({
      projectId: input.projectId,
      draftId: input.draftId,
      currentDocumentParagraphs: input.currentDocumentParagraphs,
      providerSecurity
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.draftComparisonGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftComparisonGetPayloadSchema.parse(payload)
    return store.repository.getDraftComparisonWorkspace(input.projectId, input.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.draftComparisonDraftsSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftComparisonDraftsSavePayloadSchema.parse(payload)
    const workspace = store.repository.saveDraftComparisonDrafts(input.projectId, {
      claudeContent: input.claudeContent,
      codexContent: input.codexContent
    })
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftComparisonCurrentDocumentBaseSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftComparisonCurrentDocumentBaseSetPayloadSchema.parse(payload)
    draftBaseSetCallCount += 1
    if (testDraftBaseFailureCall > 0 && draftBaseSetCallCount === testDraftBaseFailureCall) {
      throw new Error('当前文案整理基线保存失败（测试注入）')
    }
    const workspace = store.repository.setDraftComparisonCurrentDocumentBase(input.projectId, input.revision, input.contentHash)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftAlignmentStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftAlignmentStartPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getTextProviderExecutionContext(BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex)
    const task = store.repository.startDraftAlignment({
      projectId: input.projectId,
      includeProjectContext: input.includeProjectContext,
      useOutline: input.useOutline,
      confirmFull: input.confirmFull,
      providerSecurity
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.draftSourceGenerate, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftSourceGeneratePayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.getTextProviderExecutionContext(input.providerConfigId)
    const task = store.repository.startDraftSourceGeneration({ ...input, providerSecurity })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.draftCandidateFreeformAdd, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftCandidateFreeformAddPayloadSchema.parse(payload)
    const candidate = store.repository.addFreeformDraftCandidate(input.projectId, input.groupId, input.content, input.requirement)
    notifyWorkspaceChanged()
    return candidate
  })

  ipcMain.handle(IPC_CHANNELS.draftCandidateDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftCandidateDeletePayloadSchema.parse(payload)
    const workspace = store.repository.deleteDraftCandidate(input.projectId, input.candidateId)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftCandidateMove, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftCandidateMovePayloadSchema.parse(payload)
    const workspace = store.repository.moveDraftCandidate(input.projectId, input.candidateId, input.toGroupId)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftCandidateReorder, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftCandidateReorderPayloadSchema.parse(payload)
    const workspace = store.repository.reorderDraftCandidates(input.projectId, input.groupId, input.candidateIds)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftDecisionSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftDecisionSetPayloadSchema.parse(payload)
    const workspace = store.repository.setDraftGroupDecision(input)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftDecisionNoteSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftDecisionNoteSetPayloadSchema.parse(payload)
    const workspace = store.repository.setDraftGroupNote(input.projectId, input.groupId, input.note)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftDecisionMarkersSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftDecisionMarkersSetPayloadSchema.parse(payload)
    const workspace = store.repository.setDraftGroupMarkers(input.projectId, input.groupId, input.markers)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftGroupMerge, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftGroupMergePayloadSchema.parse(payload)
    const workspace = store.repository.mergeDraftAlignmentGroups(input.projectId, input.groupIds)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftGroupSplit, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftGroupSplitPayloadSchema.parse(payload)
    const workspace = store.repository.splitDraftAlignmentGroup(input)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftAlignmentSplitStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftAlignmentSplitStartPayloadSchema.parse(payload)
    const providerContext = input.scope === 'matched'
      ? await services.taskRunner.getProviderExecutionContext('codex_cli')
      : undefined
    if (providerContext && providerContext.provider !== 'codex_cli') throw new Error('Codex安全上下文无效')
    const providerSecurity = providerContext
      ? { ...providerContext, provider: 'codex_cli' as const }
      : undefined
    const result = store.repository.startDraftAlignmentSplit({ ...input, providerSecurity })
    if (result.task) services.taskRunner.enqueue(result.task)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.draftGroupReorder, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftGroupReorderPayloadSchema.parse(payload)
    const workspace = store.repository.reorderDraftAlignmentGroups(input.projectId, input.groupIds)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftParagraphMove, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftParagraphMovePayloadSchema.parse(payload)
    const workspace = store.repository.moveDraftParagraph(input)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftParagraphsMove, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftParagraphsMovePayloadSchema.parse(payload)
    const workspace = store.repository.moveDraftParagraphs(input)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.draftComparisonHistoryList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftComparisonHistoryListPayloadSchema.parse(payload)
    return store.repository.listDraftComparisonHistory(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.draftComparisonHistoryRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = draftComparisonHistoryRestorePayloadSchema.parse(payload)
    const workspace = store.repository.restoreDraftComparisonHistory(input.projectId, input.historyId)
    notifyWorkspaceChanged()
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.projectUpdateDescription, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = updateDescriptionPayloadSchema.parse(payload)
    const project = store.repository.updateDescription(input.projectId, input.description)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectSaveOutline, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = saveOutlinePayloadSchema.parse(payload)
    const items = input.items.map((item) => outlineItemSchema.parse(item))
    const version = store.repository.saveOutline(input.projectId, items, input.parentVersionIds, input.outlineId && input.outlineName ? { id: input.outlineId, name: input.outlineName } : undefined)
    notifyWorkspaceChanged()
    return version
  })

  ipcMain.handle(IPC_CHANNELS.projectOutlineSelectionSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectOutlineSelectionSetPayloadSchema.parse(payload)
    const project = store.repository.setActiveOutlineVersion(input.projectId, input.versionId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.scriptExportWord, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scriptExportWordPayloadSchema.parse(payload)
    store.repository.getProject(input.projectId, false)
    const defaultName = `${input.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || '文案'}.docx`
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '导出Word文案', defaultPath: defaultName, filters: [{ name: 'Word文档', extensions: ['docx'] }] }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true, path: null }
    await writeFile(result.filePath, await buildScriptDocx(input.title, input.html), { mode: 0o600 })
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle(IPC_CHANNELS.feishuHandoffList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = feishuHandoffListPayloadSchema.parse(payload)
    return store.repository.listFeishuHandoffs(input.projectId)
  })

  const prepareFeishuHandoff = (payload: unknown) => {
    const input = feishuHandoffMutationPayloadSchema.parse(payload)
    const project = store.repository.getProject(input.projectId, false)
    const version = store.repository.getFinalScriptVersion(input.projectId)
    if (version.id !== input.sourceVersionId) throw new Error('定稿已经变化，请重新打开飞书交接')
    let documentUrl = normalizeFeishuDocumentUrl(input.documentUrl)
    if (input.mode === 'merge_update') {
      const target = store.repository.getFeishuHandoff(input.projectId, input.targetHandoffId!)
      const targetUrl = normalizeFeishuDocumentUrl(target.documentUrl)
      if (!targetUrl) throw new Error('合并更新必须选择已保存的飞书原文档')
      if (documentUrl && documentUrl !== targetUrl) throw new Error('合并更新不能替换已保存的飞书原文档')
      documentUrl = targetUrl
    }
    return {
      input,
      project,
      version,
      documentUrl,
      contentSha256: createHash('sha256').update(version.content).digest('hex')
    }
  }

  ipcMain.handle(IPC_CHANNELS.feishuHandoffCopy, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const prepared = prepareFeishuHandoff(payload)
    clipboard.writeText(feishuClipboardText(prepared.project.title, prepared.version.content))
    const record = store.repository.saveFeishuHandoff({
      ...prepared.input,
      documentUrl: prepared.documentUrl,
      contentSha256: prepared.contentSha256,
      markCopied: true
    })
    notifyWorkspaceChanged()
    return record
  })

  ipcMain.handle(IPC_CHANNELS.feishuHandoffExportWord, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const prepared = prepareFeishuHandoff(payload)
    const defaultName = feishuWordFileName(prepared.project.title, prepared.input.accountName)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '导出飞书交接Word', defaultPath: defaultName, filters: [{ name: 'Word文档', extensions: ['docx'] }] }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true, path: null, record: null }
    await writeFile(result.filePath, await buildScriptDocx(prepared.project.title, prepared.version.content), { mode: 0o600 })
    const record = store.repository.saveFeishuHandoff({
      ...prepared.input,
      documentUrl: prepared.documentUrl,
      contentSha256: prepared.contentSha256,
      markWordExported: true
    })
    notifyWorkspaceChanged()
    return { canceled: false, path: result.filePath, record }
  })

  ipcMain.handle(IPC_CHANNELS.feishuHandoffSaveLink, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const prepared = prepareFeishuHandoff(payload)
    if (!prepared.documentUrl) throw new Error('请粘贴飞书原文档链接')
    const record = store.repository.saveFeishuHandoff({
      ...prepared.input,
      documentUrl: prepared.documentUrl,
      contentSha256: prepared.contentSha256
    })
    notifyWorkspaceChanged()
    return record
  })

  ipcMain.handle(IPC_CHANNELS.feishuHandoffOpen, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = feishuHandoffOpenPayloadSchema.parse(payload)
    const record = store.repository.getFeishuHandoff(input.projectId, input.handoffId)
    const target = normalizeFeishuDocumentUrl(record.documentUrl)
    if (!target) throw new Error('这条飞书交接还没有保存原文档链接')
    await shell.openExternal(target)
    return record
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveDestinationGet, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.nasArchiveConfigs.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveDestinationChoose, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    const testRoot = process.env.NODE_ENV === 'test' ? process.env.CREATOR_OS_TEST_NAS_ROOT : undefined
    let rootPath = testRoot
    if (!rootPath) {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { title: '选择已挂载的NAS归档目录', buttonLabel: '使用此目录', properties: ['openDirectory', 'createDirectory'] }
      const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths[0]) return services.nasArchiveConfigs.getStatus()
      rootPath = selection.filePaths[0]
    }
    const status = await services.nasArchiveConfigs.setRoot(await realpath(rootPath), { markLiveSmbValidated: false })
    void services.nasArchive.runDailyBackup()
    return status
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveDestinationClear, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.nasArchiveConfigs.clear()
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveCategoryLabelsSet, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = nasArchiveCategoryLabelsSetPayloadSchema.parse(payload)
    return services.nasArchiveConfigs.updateCategoryLabels(input.labels)
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveSlotChoose, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = nasArchiveSlotChoosePayloadSchema.parse(payload)
    store.repository.getProject(input.projectId, false)
    const testFile = process.env.NODE_ENV === 'test' ? process.env.CREATOR_OS_TEST_ARCHIVE_SLOT_FILE : undefined
    let sourcePath = testFile
    if (!sourcePath) {
      const isVideo = input.slot === 'video_clean' || input.slot === 'video_burned_in'
      const options: Electron.OpenDialogOptions = {
        title: isVideo ? '选择成片（只关联，不复制进App）' : '选择最终封面',
        buttonLabel: '关联',
        properties: ['openFile'],
        filters: [{ name: isVideo ? '视频' : '图片', extensions: isVideo ? ['mp4', 'mov', 'm4v', 'mkv', 'webm'] : ['png', 'jpg', 'jpeg', 'webp'] }]
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths[0]) return false
      sourcePath = selection.filePaths[0]
    }
    const canonical = await realpath(sourcePath)
    let bookmark: string | null = null
    try { bookmark = services.secretProtector.encrypt(canonical) } catch { bookmark = null }
    const retained = await retainLinkedFileFromPath(dirname(store.databasePath), {
      sourcePath: canonical,
      managedDirectory: join('archive-links', input.projectId),
      sourceOrigin: 'file_picker',
      sourceBookmark: bookmark,
      maximumBytes: 20 * 1024 * 1024 * 1024
    })
    try {
      services.nasArchive.setSlotFile(input.projectId, input.slot, retained.file)
      return true
    } catch (error) {
      await discardManagedLocator(dirname(store.databasePath), retained.file.managedLocator ?? retained.file.relativePath)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveSlotStatusSet, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = nasArchiveSlotStatusSetPayloadSchema.parse(payload)
    await services.nasArchive.setSlotStatus(input.projectId, input.slot, input.status)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.nasArchivePlanPrepare, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = nasArchivePlanPreparePayloadSchema.parse(payload)
    return services.nasArchive.preparePlan(input.projectId, input.category)
  })

  ipcMain.handle(IPC_CHANNELS.nasArchivePlanConfirm, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = nasArchivePlanConfirmPayloadSchema.parse(payload)
    return services.nasArchive.confirmPlan(input.planId, input.planHash)
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveRunsList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = nasArchiveProjectPayloadSchema.parse(payload)
    return services.nasArchive.listRuns(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveRunGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    return services.nasArchive.getRun(nasArchiveRunPayloadSchema.parse(payload).runId)
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveRunCancel, (event, payload) => {
    assertTrustedSender(event, ['main'])
    return services.nasArchive.cancel(nasArchiveRunPayloadSchema.parse(payload).runId)
  })

  ipcMain.handle(IPC_CHANNELS.nasArchiveRunRetry, (event, payload) => {
    assertTrustedSender(event, ['main'])
    return services.nasArchive.retry(nasArchiveRunPayloadSchema.parse(payload).runId)
  })

  ipcMain.handle(IPC_CHANNELS.nasBackupStatusGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.nasArchive.getBackupStatus()
  })

  ipcMain.handle(IPC_CHANNELS.nasBackupRun, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.nasArchive.runDailyBackup()
  })

  ipcMain.handle(IPC_CHANNELS.outlineGenerationStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = outlineGenerationStartPayloadSchema.parse(payload)
    const project = store.repository.getProject(input.projectId, false)
    const preparation = store.repository.prepareTaskResources(project.id, { supportingMaterialIds: input.supportingMaterialIds })
    const commercialBrief = preparation.requiredInputs.find((item) => item.key === 'commercial_brief')
    if (project.isCommercial && !input.briefText.trim() && commercialBrief?.status !== 'included') throw new Error(commercialBrief?.status === 'empty' ? '商单Brief目前只有网页链接，尚无可读取正文；请导入PDF或粘贴文字' : '商单大纲需要先在资料中导入Brief，或在本次运行前粘贴文字')
    const hasProjectInput = preparation.requiredInputs.some((item) => item.status === 'included') || Boolean(input.briefText.trim()) || Boolean(input.ideas.trim())
    if (!hasProjectInput) throw new Error('项目还没有可用的描述、资料、真实体验或本次想法')
    const providers = ['codex_cli', 'claude_cli'] as const
    await Promise.all(providers.map((provider) => services.taskRunner.getProviderExecutionContext(provider)))
    const resourceSnapshot = store.repository.buildTaskResourceSnapshot(project.id, {
      excludedRecommendedResourceIds: preparation.recommendedResources.map((resource) => resource.id),
      supportingMaterialIds: input.supportingMaterialIds
    })
    const snapshot = createOutlineGenerationTaskSnapshot({
      projectId: project.id, projectTitle: project.title, contentTypeName: project.contentTypeName, isCommercial: project.isCommercial,
      briefText: input.briefText.trim(), ideas: input.ideas.trim(), structure: input.structure, resourceSnapshot
    })
    const inputSnapshot = JSON.stringify(snapshot)
    const tasks = providers.map((provider) => store.repository.createTaskRun({
      taskType: 'outline_generation', projectId: project.id, title: `${provider === 'codex_cli' ? 'Codex' : 'Claude'}生成大纲`, provider,
      inputSnapshot, resourceSnapshot,
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'new_version', shell: false },
      outputTarget: 'candidate:outline'
    }))
    tasks.forEach((task) => services.taskRunner.enqueue(task))
    notifyWorkspaceChanged()
    return tasks
  })

  ipcMain.handle(IPC_CHANNELS.projectSaveScript, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = saveScriptPayloadSchema.parse(payload)
    const version = store.repository.saveScript(input.projectId, input.kind, input.content, input.sourceVersionId, input.displayName)
    notifyWorkspaceChanged()
    return version
  })

  ipcMain.handle(IPC_CHANNELS.projectSaveAndFinalizeScript, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = saveAndFinalizeScriptPayloadSchema.parse(payload)
    const version = store.repository.saveAndFinalizeScript(input.projectId, input.content, input.sourceVersionId, input.displayName)
    notifyWorkspaceChanged()
    return version
  })

  ipcMain.handle(IPC_CHANNELS.projectSetFinalVersion, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = setFinalVersionPayloadSchema.parse(payload)
    const version = store.repository.setFinalVersion(input.projectId, input.versionId)
    notifyWorkspaceChanged()
    return version
  })

  ipcMain.handle(IPC_CHANNELS.stylePreferenceConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = confirmStylePreferencePayloadSchema.parse(payload)
    const preference = store.repository.confirmStylePreference(input.projectId, input.sourceVersionId, input.finalVersionId, input.note)
    notifyWorkspaceChanged()
    return preference
  })

  ipcMain.handle(IPC_CHANNELS.projectImportScript, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = importScriptPayloadSchema.parse(payload)
    const result = await importExternalScript(store, services.externalDraftWatcher, input.projectId)
    if (!result.canceled) notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectImportScriptFile, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = importScriptFilePayloadSchema.parse(payload)
    const result = await importExternalScriptBytes(store, input.projectId, input.name, input.bytes)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.linkGroupCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = linkGroupCreatePayloadSchema.parse(payload)
    const group = store.repository.createLinkGroup(input)
    notifyWorkspaceChanged()
    return group
  })

  ipcMain.handle(IPC_CHANNELS.linkGroupList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = linkGroupListPayloadSchema.parse(payload)
    return store.repository.listLinkGroups(input.projectId, input.mergedVersionId)
  })

  ipcMain.handle(IPC_CHANNELS.linkGroupDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = linkGroupDeletePayloadSchema.parse(payload)
    const deleted = store.repository.deleteLinkGroup(input.projectId, input.linkGroupId)
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.captureContextGet, (event, payload) => {
    assertTrustedSender(event, ['capture'])
    const input = captureContextPayloadSchema.parse(payload)
    return store.repository.getCaptureContext(
      input.preferredProjectId ?? getCaptureTargetProjectId(),
      input.preferredCaptureKind ?? getCaptureTargetKind()
    )
  })

  ipcMain.handle(IPC_CHANNELS.captureSave, (event, payload) => {
    assertTrustedSender(event, ['capture'])
    const input = captureSavePayloadSchema.parse(payload)
    const capture = store.repository.createCapture(input)
    void services.taskRunner.scheduleCaptureClassification()
    notifyWorkspaceChanged()
    return capture
  })

  ipcMain.handle(IPC_CHANNELS.captureClassificationStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.taskRunner.scheduleCaptureClassification(true)
  })

  ipcMain.handle(IPC_CHANNELS.captureDeduplicateExact, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    const result = store.repository.deduplicateCapturesExact()
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.captureConfirmClassification, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = captureConfirmClassificationPayloadSchema.parse(payload)
    const capture = store.repository.confirmCaptureClassification(input.captureId, input.projectId, input.contentTypeId, input.captureKind, input.generalCategoryId)
    notifyWorkspaceChanged()
    return capture
  })

  ipcMain.handle(IPC_CHANNELS.captureUndoClassification, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = captureUndoClassificationPayloadSchema.parse(payload)
    const capture = store.repository.undoCaptureClassification(input.captureId)
    notifyWorkspaceChanged()
    return capture
  })

  ipcMain.handle(IPC_CHANNELS.captureDestinationsList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = captureClassifyPayloadSchema.parse(payload)
    return store.repository.listCaptureDestinationCandidates(input.captureId)
  })

  ipcMain.handle(IPC_CHANNELS.captureSetUseStatus, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = captureSetUseStatusPayloadSchema.parse(payload)
    const capture = store.repository.setCaptureUseStatus(input.captureId, input.useStatus)
    notifyWorkspaceChanged()
    return capture
  })

  ipcMain.handle(IPC_CHANNELS.captureAttachTopic, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = captureAttachTopicPayloadSchema.parse(payload)
    const capture = store.repository.attachCaptureToTopic(input.captureId, input.topicId)
    notifyWorkspaceChanged()
    return capture
  })

  ipcMain.handle(IPC_CHANNELS.generalCategoryCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = generalCategoryCreatePayloadSchema.parse(payload)
    const category = store.repository.createGeneralRecordCategory(input.name)
    notifyWorkspaceChanged()
    return category
  })

  ipcMain.handle(IPC_CHANNELS.generalCategoryUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = generalCategoryUpdatePayloadSchema.parse(payload)
    const category = store.repository.updateGeneralRecordCategory(input.generalCategoryId, { name: input.name, description: input.description, isActive: input.isActive })
    notifyWorkspaceChanged()
    return category
  })

  ipcMain.handle(IPC_CHANNELS.topicCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicCreatePayloadSchema.parse(payload)
    const topic = store.repository.createTopic(input)
    notifyWorkspaceChanged()
    return topic
  })

  ipcMain.handle(IPC_CHANNELS.topicUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicUpdatePayloadSchema.parse(payload)
    const topic = store.repository.updateTopic(input.topicId, input.patch)
    notifyWorkspaceChanged()
    return topic
  })

  ipcMain.handle(IPC_CHANNELS.topicCreateProject, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicIdPayloadSchema.parse(payload)
    const project = store.repository.createProjectFromTopic(input.topicId)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.topicStageCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicStageCreatePayloadSchema.parse(payload)
    const stage = store.repository.createTopicStage(input.name)
    notifyWorkspaceChanged()
    return stage
  })

  ipcMain.handle(IPC_CHANNELS.topicStageUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicStageUpdatePayloadSchema.parse(payload)
    const stage = store.repository.updateTopicStage(input.stageId, input.name, input.nextActionLabel)
    notifyWorkspaceChanged()
    return stage
  })

  ipcMain.handle(IPC_CHANNELS.topicStageReorder, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicStageReorderPayloadSchema.parse(payload)
    const stages = store.repository.reorderTopicStages(input.stageIds)
    notifyWorkspaceChanged()
    return stages
  })

  ipcMain.handle(IPC_CHANNELS.topicStageDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicStageDeletePayloadSchema.parse(payload)
    const result = store.repository.deleteTopicStage(input.stageId)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.topicColumnCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicColumnCreatePayloadSchema.parse(payload)
    const column = store.repository.createTopicColumn(input.name, input.dataType)
    notifyWorkspaceChanged()
    return column
  })

  ipcMain.handle(IPC_CHANNELS.topicColumnUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicColumnUpdatePayloadSchema.parse(payload)
    const column = store.repository.updateTopicColumn(input.columnId, input.patch)
    notifyWorkspaceChanged()
    return column
  })

  ipcMain.handle(IPC_CHANNELS.topicColumnReorder, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicColumnReorderPayloadSchema.parse(payload)
    const columns = store.repository.reorderTopicColumns(input.columnIds)
    notifyWorkspaceChanged()
    return columns
  })

  ipcMain.handle(IPC_CHANNELS.topicColumnDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicColumnDeletePayloadSchema.parse(payload)
    const columns = store.repository.deleteTopicColumn(input.columnId)
    notifyWorkspaceChanged()
    return columns
  })

  ipcMain.handle(IPC_CHANNELS.topicCustomValueSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = topicCustomValueSetPayloadSchema.parse(payload)
    const topic = store.repository.setTopicCustomValue(input.topicId, input.columnId, input.value)
    notifyWorkspaceChanged()
    return topic
  })

  ipcMain.handle(IPC_CHANNELS.contentTypeCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentTypeCreatePayloadSchema.parse(payload)
    const contentType = store.repository.createContentType(input.name)
    notifyWorkspaceChanged()
    return contentType
  })

  ipcMain.handle(IPC_CHANNELS.contentTypeUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentTypeUpdatePayloadSchema.parse(payload)
    const contentType = store.repository.updateContentType(input.contentTypeId, { name: input.name, description: input.description, isActive: input.isActive })
    notifyWorkspaceChanged()
    return contentType
  })

  ipcMain.handle(IPC_CHANNELS.contentTypeReorder, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentTypeReorderPayloadSchema.parse(payload)
    const contentTypes = store.repository.reorderContentTypes(input.contentTypeIds)
    notifyWorkspaceChanged()
    return contentTypes
  })

  ipcMain.handle(IPC_CHANNELS.businessTripSave, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const item = store.repository.saveBusinessTrip(businessTripSaveSchema.parse(payload))
    notifyWorkspaceChanged()
    return item
  })
  ipcMain.handle(IPC_CHANNELS.scheduleCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scheduleCreatePayloadSchema.parse(payload)
    const item = store.repository.createScheduleItem(input)
    notifyWorkspaceChanged()
    return item
  })
  ipcMain.handle(IPC_CHANNELS.scheduleCreateBatch, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scheduleCreateBatchPayloadSchema.parse(payload)
    const items = store.repository.createScheduleItems(input.items, input.requestId)
    notifyWorkspaceChanged()
    return items
  })

  ipcMain.handle(IPC_CHANNELS.scheduleUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scheduleUpdatePayloadSchema.parse(payload)
    const item = store.repository.updateScheduleItem(input.scheduleId, input.patch)
    notifyWorkspaceChanged()
    return item
  })

  ipcMain.handle(IPC_CHANNELS.scheduleMove, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scheduleMovePayloadSchema.parse(payload)
    const item = store.repository.moveScheduleItem(input.scheduleId, input.startAt, input.endAt)
    notifyWorkspaceChanged()
    return item
  })

  ipcMain.handle(IPC_CHANNELS.scheduleSetState, (event, payload) => {
    const role = assertTrustedSender(event, ['main', 'schedule'])
    const input = scheduleSetStatePayloadSchema.parse(payload)
    if (role === 'schedule' && input.state !== 'normal' && input.state !== 'done') throw new Error('排期速览只支持完成或取消完成')
    const item = store.repository.setScheduleState(input.scheduleId, input.state)
    notifyWorkspaceChanged()
    return item
  })

  ipcMain.handle(IPC_CHANNELS.scheduleSetColor, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scheduleSetColorPayloadSchema.parse(payload)
    const item = store.repository.setScheduleColor(input.scheduleId, input.colorToken)
    notifyWorkspaceChanged()
    return item
  })

  ipcMain.handle(IPC_CHANNELS.todoStageStartCandidate, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    return store.repository.getTodoStageStartCandidate(todoStageStartCandidatePayloadSchema.parse(payload).todoId)
  })
  ipcMain.handle(IPC_CHANNELS.todoStageStart, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const result = store.repository.confirmTodoStageStart(todoStageStartPayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return result
  })
  ipcMain.handle(IPC_CHANNELS.todoProjectStages, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    return store.repository.getTodoProjectStages(todoProjectStagesPayloadSchema.parse(payload).projectId)
  })
  ipcMain.handle(IPC_CHANNELS.todoStageTime, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const result = store.repository.setTodoLinkedStageTime(todoStageTimePayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return result
  })
  ipcMain.handle(IPC_CHANNELS.todoStageComplete, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const result = store.repository.setTodoLinkedStageCompleted(todoStageCompletePayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return result
  })
  ipcMain.handle(IPC_CHANNELS.todoDayWrite, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = todoDayWriteSchema.parse(payload)
    const previous = getTodoDay(store.repository.native, input.day)
    const result = writeTodoDay(store.repository.native, input)
    playTodoCompletionFeedback(previous.smallCompleted, result.smallCompleted, BrowserWindow.fromWebContents(event.sender)?.isVisible() ?? false)
    notifyWorkspaceChanged()
    return result
  })
  ipcMain.handle(IPC_CHANNELS.todoCreateBatch, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = todoCreateBatchPayloadSchema.parse(payload)
    const items = store.repository.createTodoItems(input.items)
    notifyWorkspaceChanged()
    return items
  })

  ipcMain.handle(IPC_CHANNELS.todoTimeMove, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const result = store.repository.moveTodoInTime(todoTimeMovePayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.todoCopyToToday, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const result = store.repository.copyTodosToToday(todoCopyToTodaySchema.parse(payload))
    notifyWorkspaceChanged()
    return result
  })
  ipcMain.handle(IPC_CHANNELS.todoCopyUndo, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    try { return store.repository.undoTodoCopy(todoCopyUndoSchema.parse(payload).operationId) }
    finally { notifyWorkspaceChanged() }
  })

  ipcMain.handle(IPC_CHANNELS.todoBatchLink, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const items = store.repository.batchLinkTodos(todoBatchLinkPayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return items
  })

  ipcMain.handle(IPC_CHANNELS.todoUpdate, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = todoUpdatePayloadSchema.parse(payload)
    const item = store.repository.updateTodoItem(input.todoId, input.patch)
    notifyWorkspaceChanged()
    return item
  })

  ipcMain.handle(IPC_CHANNELS.todoDismiss, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = todoDismissPayloadSchema.parse(payload)
    const result = store.repository.dismissTodoItem(input.todoId)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.dailyWorkLogGet, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    return store.repository.getDailyWorkLog(dailyWorkLogGetPayloadSchema.parse(payload).day)
  })

  ipcMain.handle(IPC_CHANNELS.dailyWorkLogTotalSet, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = dailyWorkLogTotalSetPayloadSchema.parse(payload)
    const result = store.repository.setDailyWorkLogTotal(input.day, input.totalMinutes, input.expected)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.dailyWorkLogAdjust, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = dailyWorkLogAdjustPayloadSchema.parse(payload)
    const result = store.repository.adjustDailyWorkLog(input.day, input.field, input.deltaMinutes)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.dailyWorkLogSet, (event, payload) => {
    assertTrustedSender(event, ['main', 'todo'])
    const input = dailyWorkLogSetPayloadSchema.parse(payload)
    const result = store.repository.setDailyWorkLog(input.day, input, input.expected)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.scheduleDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = scheduleDeletePayloadSchema.parse(payload)
    const deleted = store.repository.deleteScheduleItem(input.scheduleId)
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.resourcesList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.listResources()
  })

  ipcMain.handle(IPC_CHANNELS.outlineTemplateImportFile, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = importOutlineTemplateFilePayloadSchema.parse(payload)
    const resource = await importOutlineTemplateBytes(store, input.name, input.bytes)
    notifyWorkspaceChanged()
    return resource
  })

  ipcMain.handle(IPC_CHANNELS.outlineTemplateDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = outlineTemplateDeletePayloadSchema.parse(payload)
    const deleted = store.repository.deleteOutlineTemplate(input.resourceId)
    notifyWorkspaceChanged()
    return deleted
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialSaveText, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialSaveTextPayloadSchema.parse(payload)
    const material = store.repository.createProjectTextMaterial(input)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.projectFrameworkSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectFrameworkSavePayloadSchema.parse(payload)
    const material = store.repository.saveProjectFramework(input.projectId, input.markdown)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.projectScratchNoteSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectScratchNoteSavePayloadSchema.parse(payload)
    const material = store.repository.saveProjectScratchNote(input.projectId, input.noteId, input.title, input.markdown)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.projectPrimaryReferencesSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectPrimaryReferencesSavePayloadSchema.parse(payload)
    const project = store.repository.saveProjectPrimaryReferences(input)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialResearchStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialResearchStartPayloadSchema.parse(payload)
    const project = store.repository.getProject(input.projectId, false)
    let providerSecurity: Awaited<ReturnType<TaskRunner['getProviderExecutionContext']>>
    try {
      providerSecurity = await services.taskRunner.getProviderExecutionContext('codex_cli')
    } catch {
      const capability = await services.taskRunner.validateProvider('codex_cli')
      if (!capability.available) throw new Error(capability.detail || 'Codex安全验证未通过')
      providerSecurity = await services.taskRunner.getProviderExecutionContext('codex_cli')
    }
    const researchId = randomUUID()
    const requestedAt = new Date().toISOString()
    const snapshot = materialResearchTaskSnapshotSchema.parse({
      version: 1,
      researchId,
      projectId: project.id,
      projectTitle: project.title,
      projectDescription: project.description.slice(0, 20_000),
      requestedTitle: input.requestedTitle,
      request: input.request,
      requestedAt,
      providerSecurity
    })
    const task = store.repository.createMaterialResearchTask({
      researchId,
      projectId: project.id,
      request: input.request,
      requestedTitle: input.requestedTitle,
      inputSnapshot: JSON.stringify(snapshot)
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialResearchGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialResearchGetPayloadSchema.parse(payload)
    return store.repository.getMaterialResearchSession(input.projectId, input.researchId)
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialResearchSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialResearchSavePayloadSchema.parse(payload)
    const material = store.repository.saveMaterialResearchAsMaterial(input)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.projectGenerationContextGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectGenerationContextGetPayloadSchema.parse(payload)
    return store.repository.buildProjectGenerationContext(input.projectId, input.supportingMaterialIds)
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialImportPdf, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialImportPdfPayloadSchema.parse(payload)
    const retained = await retainProjectPdfFromBytes(dirname(store.databasePath), input.projectId, input.name, input.bytes)
    try {
      const parsed = await parseRetainedProjectPdf(retained)
      const material = store.repository.createProjectPdfMaterial({
        projectId: input.projectId, role: input.role, title: input.title, textContent: parsed.text, pageCount: parsed.pageCount, file: retained.file
      })
      notifyWorkspaceChanged()
      return material
    } catch (error) {
      await discardRetainedProjectPdf(retained)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialImportPdfFromFile, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialImportPdfFromFilePayloadSchema.parse(payload)
    const sourcePath = await realpath(input.sourcePath)
    let encryptedSourcePath: string | null = null
    if (services.secretProtector.isAvailable()) {
      try { encryptedSourcePath = services.secretProtector.encrypt(sourcePath) } catch { encryptedSourcePath = null }
    }
    const retained = await retainProjectPdfFromPath(dirname(store.databasePath), input.projectId, sourcePath, encryptedSourcePath)
    try {
      const parsed = await parseRetainedProjectPdf(retained)
      const material = store.repository.createProjectPdfMaterial({
        projectId: input.projectId, role: input.role, title: input.title, textContent: parsed.text, pageCount: parsed.pageCount, file: retained.file
      })
      notifyWorkspaceChanged()
      return material
    } catch (error) {
      await discardRetainedProjectPdf(retained)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialChooseBatch, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const context = projectMaterialChooseBatchPayloadSchema.parse(payload)
    store.repository.getProject(context.projectId, false)
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const options: Electron.OpenDialogOptions = {
      title: context.usageType ? '添加体验与参数' : '添加项目资料',
      buttonLabel: '添加',
      properties: ['openFile', 'openDirectory', 'multiSelections']
    }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true, items: [], importedRootCount: 0, storedOnlyFileCount: 0, failedEntryCount: 0 } satisfies ProjectAssetImportBatchResult
    }
    const input = projectMaterialImportBatchPayloadSchema.parse({ ...context, sourcePaths: selection.filePaths })
    const result = await importProjectAssetPaths(store, services, input)
    if (result.importedRootCount > 0) notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialImportBatch, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialImportBatchPayloadSchema.parse(payload)
    const result = await importProjectAssetPaths(store, services, input)
    if (result.importedRootCount > 0) notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialSaveLink, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialSaveLinkPayloadSchema.parse(payload)
    const material = store.repository.createProjectLinkMaterial(input)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialOpen, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialOpenPayloadSchema.parse(payload)
    const target = store.repository.getProjectMaterialOpenTarget(input.projectId, input.materialId)
    if (target.kind === 'link') {
      const url = new URL(target.sourceUrl)
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error('资料链接不安全')
      if (!isBackgroundTestMode) await shell.openExternal(url.toString())
      return 'link' as const
    }
    const reveal = await resolveProjectMaterialRevealTarget({
      userDataPath: dirname(store.databasePath), relativePath: target.relativePath, encryptedSourcePath: target.encryptedSourcePath,
      expectedKind: target.kind,
      decryptSourcePath: (encrypted) => services.secretProtector.decrypt(encrypted)
    })
    if (!isBackgroundTestMode) {
      await shell.openPath(reveal.path)
    }
    return reveal.kind
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialPreviewGet, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialOpenPayloadSchema.parse(payload)
    const target = store.repository.getProjectMaterialOpenTarget(input.projectId, input.materialId)
    if (target.kind !== 'file') return { kind: 'unsupported' as const, dataUrl: null, mimeType: '' }
    const previewKind = target.mimeType === 'application/pdf' ? 'pdf' as const
      : target.mimeType.startsWith('image/') && target.mimeType !== 'image/svg+xml' ? 'image' as const
        : 'unsupported' as const
    if (previewKind === 'unsupported') return { kind: previewKind, dataUrl: null, mimeType: target.mimeType }
    const reveal = await resolveProjectMaterialRevealTarget({
      userDataPath: dirname(store.databasePath), relativePath: target.relativePath, encryptedSourcePath: target.encryptedSourcePath,
      expectedKind: 'file', decryptSourcePath: (encrypted) => services.secretProtector.decrypt(encrypted)
    })
    if ((await stat(reveal.path)).size > 15 * 1024 * 1024) return { kind: 'unsupported' as const, dataUrl: null, mimeType: target.mimeType }
    const bytes = await readFile(reveal.path)
    return { kind: previewKind, dataUrl: `data:${target.mimeType};base64,${bytes.toString('base64')}`, mimeType: target.mimeType }
  })

  ipcMain.handle(IPC_CHANNELS.projectMaterialDelete, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectMaterialDeletePayloadSchema.parse(payload)
    const result = store.repository.deleteProjectMaterial(input.projectId, input.materialId)
    await cleanupReleasedManagedFiles(dirname(store.databasePath), result.managedLocators, store.repository.listManagedFileLocators())
    notifyWorkspaceChanged()
    return result.deleted
  })

  ipcMain.handle(IPC_CHANNELS.businessScreenshotExtract, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessScreenshotExtractPayloadSchema.parse(payload)
    const platforms = input.projectId
      ? (() => {
          const project = store.repository.getProject(input.projectId!, false)
          if (!project.isCommercial) throw new Error('金额识别只用于商单项目')
          return project.platformTargets
        })()
      : PROJECT_PLATFORMS
    return services.taskRunner.extractBusinessFieldsFromImage(input.name, input.bytes, [...platforms])
  })

  ipcMain.handle(IPC_CHANNELS.businessTextExtract, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessTextExtractPayloadSchema.parse(payload)
    const platforms = input.projectId
      ? (() => {
          const project = store.repository.getProject(input.projectId!, false)
          if (!project.isCommercial) throw new Error('商务识别只用于商单项目')
          return project.platformTargets
        })()
      : store.repository.getPreferences().businessPlatforms
    return services.taskRunner.extractBusinessFieldsFromText(input.text, [...platforms])
  })

  ipcMain.handle(IPC_CHANNELS.businessImportLinkOpen, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessImportLinkOpenPayloadSchema.parse(payload)
    if (!businessImportWindow || businessImportWindow.isDestroyed()) {
      businessImportWindow = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 760,
        minHeight: 560,
        title: '商务账单登录与导入',
        webPreferences: {
          partition: 'persist:ly-creator-os-business-import',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      businessImportWindow.on('closed', () => { businessImportWindow = null })
      businessImportWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) void businessImportWindow?.loadURL(url)
        return { action: 'deny' }
      })
    }
    await businessImportWindow.loadURL(input.url)
    businessImportWindow.show()
    businessImportWindow.focus()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.businessImportLinkCapture, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    if (!businessImportWindow || businessImportWindow.isDestroyed()) throw new Error('请先打开账单链接并完成登录')
    const url = businessImportWindow.webContents.getURL()
    if (!url.startsWith('https://')) throw new Error('当前页面不是安全的HTTPS账单页面')
    const title = businessImportWindow.webContents.getTitle().slice(0, 300)
    const text = await businessImportWindow.webContents.executeJavaScript(
      `(() => String(document.body?.innerText ?? '').slice(0, 1000000))()`,
      true
    ) as string
    if (!text.trim()) throw new Error('当前页面没有可读取的账单文字')
    businessImportWindow.close()
    return { url, title, text }
  })

  ipcMain.handle(IPC_CHANNELS.businessProjectDataGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerEntryPayloadSchema.parse(payload)
    return store.repository.getBusinessProjectData(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.businessRecordPatch, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessRecordPatchPayloadSchema.parse(payload)
    const data = store.repository.patchBusinessRecord(input.projectId, input.patch)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.businessRecordSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessRecordSavePayloadSchema.parse(payload)
    const data = store.repository.saveBusinessRecord(input.projectId, input)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerStandaloneSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerStandaloneSavePayloadSchema.parse(payload)
    const { ledgerId, title, ...record } = input
    const entry = store.repository.saveStandaloneBusinessLedgerEntry(ledgerId, title, record)
    notifyWorkspaceChanged()
    return entry
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerStandaloneBatchSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerStandaloneBatchSavePayloadSchema.parse(payload)
    const entries = store.repository.saveStandaloneBusinessLedgerEntriesBatch(input.items.map((item) => ({ title: item.title, input: item.record })))
    notifyWorkspaceChanged()
    return entries
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerTrashList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.listBusinessLedger(true)
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerTrash, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerEntryPayloadSchema.parse(payload)
    store.repository.trashBusinessLedgerEntry(input.projectId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerEntryPayloadSchema.parse(payload)
    store.repository.restoreBusinessLedgerEntry(input.projectId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerPermanentDelete, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerEntryPayloadSchema.parse(payload)
    const releasedLocators = store.repository.permanentlyDeleteBusinessLedgerEntry(input.projectId)
    await cleanupReleasedManagedFiles(dirname(store.databasePath), releasedLocators, store.repository.listManagedFileLocators())
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerRelink, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerRelinkPayloadSchema.parse(payload)
    const entry = store.repository.relinkBusinessLedgerEntry(input.sourceProjectId, input.targetProjectId)
    notifyWorkspaceChanged()
    return entry
  })

  ipcMain.handle(IPC_CHANNELS.businessFolderScan, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    const owner = BrowserWindow.getFocusedWindow() ?? undefined
    const options: Electron.OpenDialogOptions = { title: '选择商务资料文件夹', buttonLabel: '扫描文件夹', properties: ['openDirectory'] }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true, scanId: null, rootName: '', candidates: [], ignoredCount: 0, warnings: [] }
    return scanBusinessFolderPath(selection.filePaths[0])
  })

  ipcMain.handle(IPC_CHANNELS.businessFolderImport, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessFolderImportPayloadSchema.parse(payload)
    let latest = store.repository.getBusinessProjectData(input.projectId)
    const candidates = await resolveBusinessFolderCandidates(input.scanId, input.candidateIds)
    for (const candidate of candidates) {
      const bytes = await readFile(candidate.sourcePath)
      let sourceBookmark: string | null = null
      try { sourceBookmark = services.secretProtector.encrypt(candidate.sourcePath) } catch { sourceBookmark = null }
      const file = await retainBusinessFile(dirname(store.databasePath), input.projectId, candidate.suggestedRole, candidate.fileName, bytes, sourceBookmark)
      if (store.repository.hasBusinessFileContent(input.projectId, file.sha256)) {
        await discardBusinessFile(dirname(store.databasePath), file.relativePath)
        continue
      }
      try {
        latest = store.repository.createBusinessFile({
          projectId: input.projectId,
          role: candidate.suggestedRole,
          file,
          rebatePaymentId: null,
          invoiceId: null
        })
      } catch (error) {
        await discardBusinessFile(dirname(store.databasePath), file.relativePath)
        throw error
      }
    }
    notifyWorkspaceChanged()
    return latest
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerLockStatusGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.businessLedgerLock.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerLockEnable, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerLockPasswordPayloadSchema.parse(payload)
    return services.businessLedgerLock.enable(input.password)
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerLockDisable, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerLockPasswordPayloadSchema.parse(payload)
    return services.businessLedgerLock.disable(input.password)
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerLockUnlockPassword, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessLedgerLockPasswordPayloadSchema.parse(payload)
    return services.businessLedgerLock.unlockWithPassword(input.password)
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerLockUnlockTouchId, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.businessLedgerLock.unlockWithTouchId()
  })

  ipcMain.handle(IPC_CHANNELS.businessLedgerLockNow, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.businessLedgerLock.lock()
  })

  ipcMain.handle(IPC_CHANNELS.rebatePaymentSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = rebatePaymentSavePayloadSchema.parse(payload)
    const data = store.repository.saveRebatePayment(input.projectId, input.paymentId, input)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.rebatePaymentDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = rebatePaymentDeletePayloadSchema.parse(payload)
    const data = store.repository.deleteRebatePayment(input.projectId, input.paymentId)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.businessInvoiceSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessInvoiceSavePayloadSchema.parse(payload)
    const data = store.repository.saveBusinessInvoice(input.projectId, input.invoiceId, input)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.businessInvoiceDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessInvoiceDeletePayloadSchema.parse(payload)
    const data = store.repository.deleteBusinessInvoice(input.projectId, input.invoiceId)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.businessFileImport, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessFileImportPayloadSchema.parse(payload)
    const file = await retainBusinessFile(dirname(store.databasePath), input.projectId, input.role, input.name, input.bytes)
    if (store.repository.hasBusinessFileContent(input.projectId, file.sha256)) {
      await discardBusinessFile(dirname(store.databasePath), file.relativePath)
      return store.repository.getBusinessProjectData(input.projectId)
    }
    try {
      const data = store.repository.createBusinessFile({
        projectId: input.projectId,
        role: input.role,
        file,
        rebatePaymentId: input.rebatePaymentId,
        invoiceId: input.invoiceId,
        linkedProjectIds: input.linkedProjectIds
      })
      notifyWorkspaceChanged()
      return data
    } catch (error) {
      await discardBusinessFile(dirname(store.databasePath), file.relativePath)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.businessFileProjectsSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessFileProjectsSetPayloadSchema.parse(payload)
    const data = store.repository.setBusinessFileProjects(input.projectId, input.businessFileId, input.projectIds)
    notifyWorkspaceChanged()
    return data
  })

  ipcMain.handle(IPC_CHANNELS.businessFileDelete, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessFilePayloadSchema.parse(payload)
    const result = store.repository.deleteBusinessFile(input.projectId, input.businessFileId)
    await cleanupReleasedManagedFiles(dirname(store.databasePath), result.managedLocators, store.repository.listManagedFileLocators())
    notifyWorkspaceChanged()
    return result.data
  })

  ipcMain.handle(IPC_CHANNELS.businessFileReveal, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = businessFilePayloadSchema.parse(payload)
    const target = store.repository.getBusinessFileRevealTarget(input.projectId, input.businessFileId)
    if (target.sourceBookmark) {
      try {
        const sourcePath = services.secretProtector.decrypt(target.sourceBookmark)
        void stat(sourcePath).then(() => shell.showItemInFolder(sourcePath)).catch(() => shell.showItemInFolder(join(dirname(store.databasePath), target.relativePath)))
        return true
      } catch { /* fall back to the managed copy */ }
    }
    shell.showItemInFolder(join(dirname(store.databasePath), target.relativePath))
    return true
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeCategorySave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeCategorySavePayloadSchema.parse(payload)
    const category = store.repository.saveOtherIncomeCategory(input.categoryId, input)
    notifyWorkspaceChanged()
    return category
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeCategoryReorder, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeCategoryReorderPayloadSchema.parse(payload)
    const categories = store.repository.reorderOtherIncomeCategories(input.categoryIds)
    notifyWorkspaceChanged()
    return categories
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordPatch, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRecordPatchPayloadSchema.parse(payload)
    const record = store.repository.patchOtherIncomeRecord(input.recordId, input.patch)
    notifyWorkspaceChanged()
    return record
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRecordSavePayloadSchema.parse(payload)
    const { recordId, ...record } = input
    const saved = store.repository.saveOtherIncomeRecord(recordId, record)
    notifyWorkspaceChanged()
    return saved
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordBatchSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRecordBatchSavePayloadSchema.parse(payload)
    const records = store.repository.saveOtherIncomeRecordsBatch(input.records)
    notifyWorkspaceChanged()
    return records
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordTrashList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.listOtherIncomeRecords(true).filter((record) => Boolean(record.trashedAt))
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordTrash, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRecordPayloadSchema.parse(payload)
    store.repository.trashOtherIncomeRecord(input.recordId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordRestore, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRecordPayloadSchema.parse(payload)
    store.repository.restoreOtherIncomeRecord(input.recordId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRecordPermanentDelete, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRecordPayloadSchema.parse(payload)
    const releasedLocators = store.repository.permanentlyDeleteOtherIncomeRecord(input.recordId)
    await cleanupReleasedManagedFiles(dirname(store.databasePath), releasedLocators, store.repository.listManagedFileLocators())
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeAttachmentImport, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeAttachmentImportPayloadSchema.parse(payload)
    const retained = await retainManagedFileFromBytes(dirname(store.databasePath), {
      managedDirectory: 'other-income-files',
      sourceName: input.name,
      maximumBytes: 25 * 1024 * 1024,
      sourceOrigin: 'managed_import'
    }, input.bytes)
    try {
      const attached = store.repository.attachOtherIncomeFile(input.recordIds, retained.file)
      await cleanupReleasedManagedFiles(dirname(store.databasePath), attached.releasedManagedLocators, store.repository.listManagedFileLocators())
      notifyWorkspaceChanged()
      return attached.records
    } catch (error) {
      await discardManagedLocator(dirname(store.databasePath), retained.file.relativePath)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeAliasSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeAliasSavePayloadSchema.parse(payload)
    const alias = store.repository.saveOtherIncomeCompanyAlias(input.companyName, input.alias)
    notifyWorkspaceChanged()
    return alias
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeAliasDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeAliasDeletePayloadSchema.parse(payload)
    store.repository.deleteOtherIncomeCompanyAlias(input.aliasId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRuleSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRuleSavePayloadSchema.parse(payload)
    const rule = store.repository.saveOtherIncomeImportRule(input.ruleId, input.name, input.instruction, input.conditions)
    notifyWorkspaceChanged()
    return rule
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeRuleDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeRuleDeletePayloadSchema.parse(payload)
    store.repository.deleteOtherIncomeImportRule(input.ruleId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.otherIncomeImportPreview, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = otherIncomeImportPreviewPayloadSchema.parse(payload)
    let sourceText = input.text ?? ''
    if (input.bytes) {
      if (input.mimeType.startsWith('image/')) {
        const result = await services.taskRunner.extractBusinessFieldsFromImage(input.sourceName, input.bytes, [...PROJECT_PLATFORMS])
        const amount = result.platformOrderAmountCents === null ? '' : String(result.platformOrderAmountCents / 100)
        sourceText = [
          '收入名称\t付款方\t收入日期\t收益月份\t收入金额\t收支方向\t到账状态\t备注',
          [
            result.title ?? input.sourceName,
            result.rebateRecipientName ?? result.orderPlatform ?? '',
            result.orderDate ?? result.paymentReceivedDate ?? '',
            result.revenueMonth ?? '',
            amount,
            '收入',
            result.paymentStatus === 'received' ? '已到账' : '未回款',
            result.notes ?? `来源截图：${input.sourceName}`
          ].join('\t')
        ].join('\n')
      } else sourceText = await extractOtherIncomeImportText(input.sourceName, input.mimeType, input.bytes)
    }
    const conditions = input.conditions ?? parseOtherIncomeRuleInstruction(input.instruction, { today: input.today, categoryId: input.categoryId })
    const parsed = parseDelimitedIncomeRows(sourceText)
    const defaultCategoryId = input.categoryId
      ?? store.repository.listOtherIncomeCategories(false).find((category) => category.id === 'income-other')?.id
      ?? store.repository.listOtherIncomeCategories(false)[0]?.id
      ?? null
    const candidates = buildOtherIncomeImportCandidates(
      parsed.rows,
      conditions,
      store.repository.listOtherIncomeCompanyAliases(),
      store.repository.listOtherIncomeRecords(),
      defaultCategoryId
    )
    return { conditions, candidates, errors: parsed.errors }
  })

  ipcMain.handle(IPC_CHANNELS.publishingMaterialSaveText, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingMaterialSaveTextPayloadSchema.parse(payload)
    const material = store.repository.savePublishingTextMaterial(input)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.publishingDraftPrepare, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingDraftPreparePayloadSchema.parse(payload)
    return store.repository.preparePublishingDraft(input.projectId, input.platform)
  })

  ipcMain.handle(IPC_CHANNELS.publishingMaterialImportFile, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingMaterialImportFilePayloadSchema.parse(payload)
    const userDataPath = dirname(store.databasePath)
    const file = await retainPublishingAsset(userDataPath, input.projectId, input.materialKind, input.name, input.bytes)
    try {
      const result = store.repository.savePublishingFileMaterial({ projectId: input.projectId, platform: input.platform, materialKind: input.materialKind, file })
      await cleanupReleasedManagedFiles(userDataPath, result.replacedManagedLocators, store.repository.listManagedFileLocators())
      notifyWorkspaceChanged()
      return result.material
    } catch (error) {
      await discardPublishingAsset(userDataPath, file.relativePath)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.publishingVideoChoose, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingVideoChoosePayloadSchema.parse(payload)
    store.repository.getProject(input.projectId, false)
    let sourcePath = process.env.NODE_ENV === 'test' ? process.env.CREATOR_OS_TEST_PUBLISHING_VIDEO : undefined
    if (!sourcePath) {
      const options: Electron.OpenDialogOptions = {
        title: '选择要发布的视频（只关联，不复制进App）',
        buttonLabel: '关联视频',
        properties: ['openFile'],
        filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm'] }]
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths[0]) return null
      sourcePath = selection.filePaths[0]
    }
    const canonical = await realpath(sourcePath)
    let bookmark: string | null = null
    try { bookmark = services.secretProtector.encrypt(canonical) } catch { bookmark = null }
    const retained = await retainLinkedFileFromPath(dirname(store.databasePath), {
      sourcePath: canonical,
      managedDirectory: join('archive-links', input.projectId),
      sourceOrigin: 'file_picker',
      sourceBookmark: bookmark,
      maximumBytes: 20 * 1024 * 1024 * 1024
    })
    try {
      const result = store.repository.savePublishingFileMaterial({ projectId: input.projectId, platform: input.platform, materialKind: 'video', file: retained.file })
      await cleanupReleasedManagedFiles(dirname(store.databasePath), result.replacedManagedLocators, store.repository.listManagedFileLocators())
      notifyWorkspaceChanged()
      return result.material
    } catch (error) {
      await discardManagedLocator(dirname(store.databasePath), retained.file.managedLocator ?? retained.file.relativePath)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.publishingMaterialReveal, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingMaterialRevealPayloadSchema.parse(payload)
    const material = store.repository.getProject(input.projectId, false).publishingMaterials.find((item) => item.platform === input.platform && item.materialKind === input.materialKind)
    if (!material?.fileId) throw new Error('该发布物料尚未选择')
    const file = store.repository.getFileReference(material.fileId)
    const managedPath = resolveManagedFilePath(dirname(store.databasePath), file.managedLocator || file.relativePath)
    const revealPath = await realpath(managedPath).catch(() => managedPath)
    if (!isBackgroundTestMode) shell.showItemInFolder(revealPath)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.publishingAccountStateGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingAccountStatePayloadSchema.parse(payload)
    if (input.projectId) store.repository.getProject(input.projectId, false)
    return publishingAccountState(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.publishingAccountSave, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingAccountSavePayloadSchema.parse(payload)
    const hasContactPatch = input.clearContact || input.phone !== undefined || input.email !== undefined
    let contactCiphertext: string | null | undefined
    if (hasContactPatch) {
      if (!services.secretProtector.isAvailable() && !input.clearContact) throw new Error('系统安全存储不可用，暂时不能保存手机号或邮箱')
      const previous = input.accountId ? decodePublishingContact(input.accountId) : { phone: null, email: null }
      const contact = input.clearContact ? { phone: null, email: null } : {
        phone: input.phone === undefined ? previous.phone : input.phone || null,
        email: input.email === undefined ? previous.email : input.email || null
      }
      contactCiphertext = contact.phone || contact.email ? services.secretProtector.encrypt(JSON.stringify(contact)) : null
    }
    const account = store.repository.savePublishingAccount({
      id: input.accountId ?? undefined,
      platform: input.platform,
      accountName: input.accountName,
      positioning: input.positioning,
      contactCiphertext
    })
    notifyWorkspaceChanged()
    return publishingAccountState(null).accounts.find((item) => item.id === account.id)!
  })

  ipcMain.handle(IPC_CHANNELS.publishingAccountStatusSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingAccountStatusPayloadSchema.parse(payload)
    const account = store.repository.setPublishingAccountStatus(input.accountId, input.status)
    notifyWorkspaceChanged()
    return publishingAccountState(null).accounts.find((item) => item.id === account.id)!
  })

  ipcMain.handle(IPC_CHANNELS.publishingAccountSelect, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingAccountSelectPayloadSchema.parse(payload)
    store.repository.selectPublishingAccount(input.projectId, input.platform, input.accountId)
    notifyWorkspaceChanged()
    return publishingAccountState(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.coverGenerationStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = coverGenerationStartPayloadSchema.parse(payload)
    const project = store.repository.getProject(input.projectId, false)
    const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
    if (!finalVersion) throw new Error('请先在文案中设置定稿')
    const sourceExcerpt = finalVersion.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim().slice(0, 20_000)
    if (!sourceExcerpt) throw new Error('定稿没有可用正文')
    const selectedLinks = project.assetLinks.filter((link) => input.materialLinkIds.includes(link.id) && link.fileKind === 'file' && link.mimeType.startsWith('image/') && link.availability === 'available')
    if (selectedLinks.length !== input.materialLinkIds.length) throw new Error('封面参考素材不存在或不是可用图片')
    const promptSnapshot = [project.description, project.contentTypeName, input.groupNote, sourceExcerpt.slice(0, 1_500)].filter(Boolean).join('\n')
    const imageProviderSecurity = input.generationMode === 'ai_finished' ? await services.taskRunner.getImageProviderExecutionContext() : null
    const snapshot = coverGenerationTaskSnapshotSchema.parse({
      version: 1, projectId: project.id, projectTitle: project.title, platform: input.platform, layout: input.layout,
      generationMode: input.generationMode, batchCount: input.batchCount, headline: input.headline, groupNote: input.groupNote,
      sourceVersionId: finalVersion.id, sourceRevision: finalVersion.revision, sourceExcerpt,
      materialFileIds: selectedLinks.map((link) => link.fileReferenceId), promptSnapshot,
      providerConfigId: input.generationMode === 'ai_finished' ? 'codex_cli_image_generation_v1' : null,
      providerSecurity: imageProviderSecurity
    })
    const coverTask = store.repository.createTaskRun({
      taskType: 'image_generation', projectId: project.id, title: `生成${input.platform}封面候选`, provider: input.generationMode === 'ai_finished' ? 'codex_cli' : 'none',
      inputSnapshot: JSON.stringify(snapshot), permissionProfile: {
        network: input.generationMode === 'ai_finished' ? 'provider_only' : 'off',
        readableRefs: selectedLinks.map((link) => link.fileReferenceId), writableTarget: 'candidate_asset', shell: false
      }, outputTarget: 'candidate:cover'
    })
    services.taskRunner.enqueue(coverTask)
    notifyWorkspaceChanged()
    return [coverTask]
  })

  ipcMain.handle(IPC_CHANNELS.coverCandidatePreview, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = coverCandidatePayloadSchema.parse(payload)
    const file = store.repository.getCoverCandidateFile(input.projectId, input.candidateId)
    const image = nativeImage.createFromPath(resolveManagedFilePath(dirname(store.databasePath), file.managedLocator || file.relativePath))
    if (image.isEmpty()) throw new Error('封面候选无法预览')
    return image.resize({ width: 720, quality: 'good' }).toDataURL()
  })

  ipcMain.handle(IPC_CHANNELS.coverCandidateSelect, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = coverCandidatePayloadSchema.parse(payload)
    const material = store.repository.selectCoverCandidate(input.projectId, input.candidateId)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.subtitleGenerationStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = subtitleGenerationStartPayloadSchema.parse(payload)
    const project = store.repository.getProject(input.projectId, false)
    let inputFile: FileReferenceInput
    let newlyRetainedLocator: string | null = null
    let confirmedZhArtifactId: string | null = null
    let subtitleSourceVersionId: string | null = null
    let subtitleSourceRevision: number | null = null
    let subtitleReferenceText: string | null = null
    if (input.schema === 'bilingual') {
      const sourceJob = store.repository.getLatestChineseSubtitleJob(project.id)
      if (!sourceJob?.confirmedZhArtifactId || sourceJob.id !== input.confirmedJobId) throw new Error('请先确认本项目最新生成的中文字幕')
      store.repository.getConfirmedChineseSubtitleSource(project.id, sourceJob.confirmedZhArtifactId)
      inputFile = store.repository.getFileReference(sourceJob.inputFileId)
      confirmedZhArtifactId = sourceJob.confirmedZhArtifactId
      const sourceSnapshot = subtitleGenerationTaskSnapshotSchema.parse(JSON.parse(store.repository.getTaskRun(sourceJob.taskId).inputSnapshot))
      subtitleSourceVersionId = sourceSnapshot.sourceVersionId
      subtitleSourceRevision = sourceSnapshot.sourceRevision
      subtitleReferenceText = sourceSnapshot.referenceText
    } else {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
      const options: Electron.OpenDialogOptions = {
        title: '选择要生成字幕的视频或音频', buttonLabel: '开始生成', properties: ['openFile'],
        filters: [{ name: '视频或音频', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'aiff', 'aac', 'flac', 'ogg', 'opus'] }]
      }
      const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths[0]) return null
      const sourcePath = await realpath(selection.filePaths[0])
      let sourceBookmark: string | null = null
      try { sourceBookmark = services.secretProtector.encrypt(sourcePath) } catch { sourceBookmark = null }
      const retained = await retainLinkedFileFromPath(dirname(store.databasePath), {
        sourcePath, managedDirectory: join('publishing-assets', project.id), sourceOrigin: 'file_picker', sourceBookmark, maximumBytes: 4 * 1024 * 1024 * 1024
      })
      inputFile = retained.file
      newlyRetainedLocator = retained.file.managedLocator || retained.file.relativePath
      const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal) ?? null
      subtitleSourceVersionId = finalVersion?.id ?? null
      subtitleSourceRevision = finalVersion?.revision ?? null
      subtitleReferenceText = finalVersion?.content
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n').replace(/<[^>]+>/g, '')
        .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').trim().slice(0, 20_000) || null
    }
    const jobId = randomUUID()
    const snapshot = subtitleGenerationTaskSnapshotSchema.parse({
      version: 1, projectId: project.id, jobId, schema: input.schema, inputFileId: inputFile.id, confirmedZhArtifactId,
      sourceVersionId: subtitleSourceVersionId, sourceRevision: subtitleSourceRevision, referenceText: subtitleReferenceText
    })
    const task = store.repository.createTaskRun({
      taskType: 'subtitle_generation', projectId: project.id, title: `生成${input.schema === 'bilingual' ? '中英双语' : '中文'}字幕`, provider: 'none',
      inputSnapshot: JSON.stringify(snapshot), permissionProfile: { network: 'off', readableRefs: [inputFile.id], writableTarget: 'candidate_asset', shell: false },
      outputTarget: 'candidate:subtitle'
    })
    try {
      store.repository.createSubtitleJob({ id: jobId, taskId: task.id, projectId: project.id, inputFile, schema: input.schema, engine: 'faster-whisper-small', stylePreset: subtitleStylePreset(), sourceVersionId: subtitleSourceVersionId })
    } catch (error) {
      if (newlyRetainedLocator) await discardManagedLocator(dirname(store.databasePath), newlyRetainedLocator)
      throw error
    }
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.subtitleArtifactReveal, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = subtitleArtifactPayloadSchema.parse(payload)
    const file = store.repository.getSubtitleArtifactFile(input.projectId, input.artifactId)
    if (!isBackgroundTestMode) shell.showItemInFolder(resolveManagedFilePath(dirname(store.databasePath), file.managedLocator || file.relativePath))
    return true
  })

  ipcMain.handle(IPC_CHANNELS.subtitleArtifactConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = subtitleArtifactPayloadSchema.parse(payload)
    const job = store.repository.confirmSubtitleArtifact(input.projectId, input.artifactId)
    notifyWorkspaceChanged()
    return job
  })

  ipcMain.handle(IPC_CHANNELS.subtitleArtifactUse, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = subtitleArtifactUsePayloadSchema.parse(payload)
    const material = store.repository.useSubtitleArtifact(input.projectId, input.artifactId, input.platform)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.titleGenerationStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = titleGenerationStartPayloadSchema.parse(payload)
    const tasks = await createTitleGenerationTasks(input.projectId, input.platform, { mode: input.mode, masterTitle: input.masterTitle, instruction: input.instruction })
    notifyWorkspaceChanged()
    return tasks
  })

  ipcMain.handle(IPC_CHANNELS.titleCandidateSelect, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = titleCandidatePayloadSchema.parse(payload)
    const material = store.repository.selectTitleCandidate(input.projectId, input.candidateId)
    notifyWorkspaceChanged()
    return material
  })

  ipcMain.handle(IPC_CHANNELS.publishingHandoffPrepare, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingHandoffPreparePayloadSchema.parse(payload)
    const account = store.repository.getSelectedPublishingAccount(input.projectId, input.platform)
    const handoff = store.repository.createPublishingHandoff(preparePublishingPackage(store.repository.getProject(input.projectId, false), input.platform, account))
    notifyWorkspaceChanged()
    return handoff
  })

  ipcMain.handle(IPC_CHANNELS.publishingHandoffOpen, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingHandoffPayloadSchema.parse(payload)
    const handoff = store.repository.getPublishingHandoff(input.handoffId)
    if (handoff.status === 'failed' || handoff.issues.length) throw new Error('发布包还有未完成项')
    assertCurrentPublishingHandoff(handoff)
    clipboard.writeText(publishingClipboardText(handoff))
    if (!isBackgroundTestMode) await shell.openExternal(handoff.targetUrl)
    const updated = store.repository.updatePublishingHandoff(handoff.id, 'opened')
    notifyWorkspaceChanged()
    return updated
  })

  ipcMain.handle(IPC_CHANNELS.publishingHandoffConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingHandoffPayloadSchema.parse(payload)
    const current = store.repository.getPublishingHandoff(input.handoffId)
    assertCurrentPublishingHandoff(current)
    const handoff = store.repository.updatePublishingHandoff(current.id, 'confirmed')
    const completedPilot = store.repository.completePublishingComputerUsePilotForHandoff(handoff.id)
    if (completedPilot) clearPublishingPilotClipboard(completedPilot.id)
    notifyWorkspaceChanged()
    return handoff
  })

  ipcMain.handle(IPC_CHANNELS.publishingHandoffCopyField, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingHandoffCopyFieldPayloadSchema.parse(payload)
    const handoff = store.repository.getPublishingHandoff(input.handoffId)
    if (handoff.status === 'failed' || handoff.issues.length) throw new Error('发布包还有未完成项')
    assertCurrentPublishingHandoff(handoff)
    clipboard.writeText(publishingFieldText(handoff, input.field))
    return true
  })

  const resolvePublishingPilotFile = async (fileId: string, label: string): Promise<string> => {
    const file = store.repository.getFileReference(fileId)
    const managedPath = resolveManagedFilePath(dirname(store.databasePath), file.managedLocator || file.relativePath)
    const info = await lstat(managedPath).catch(() => { throw new Error(`${label}已经移动或删除，请重新关联`) })
    if (info.isSymbolicLink()) await verifyLinkedFileSnapshot(managedPath, file)
    return realpath(managedPath).catch(() => { throw new Error(`${label}已经移动或删除，请重新关联`) })
  }

  ipcMain.handle(IPC_CHANNELS.publishingComputerUsePilotStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingHandoffPayloadSchema.parse(payload)
    if (!store.repository.getPreferences().computerUsePublishBilibili) throw new Error('请先在设置中开启B站Computer Use试验')
    const handoff = store.repository.getPublishingHandoff(input.handoffId)
    assertCurrentPublishingHandoff(handoff)
    const [videoPath, coverPath, subtitlePath] = await Promise.all([
      resolvePublishingPilotFile(handoff.packageSnapshot.videoFileId, '发布视频'),
      resolvePublishingPilotFile(handoff.packageSnapshot.coverFileId, '封面'),
      handoff.packageSnapshot.subtitleFileId ? resolvePublishingPilotFile(handoff.packageSnapshot.subtitleFileId, '字幕') : Promise.resolve(null)
    ])
    const packet = buildBilibiliComputerUseTaskPacket({ handoff, videoPath, coverPath, subtitlePath })
    const packetText = serializeBilibiliComputerUseTaskPacket(packet)
    const pilot = store.repository.createPublishingComputerUsePilot(handoff.id, createHash('sha256').update(packetText).digest('hex'))
    clipboard.writeText(packetText)
    publishingPilotClipboardPackets.set(pilot.id, packetText)
    try {
      if (!isBackgroundTestMode) await shell.openExternal(handoff.targetUrl)
      store.repository.updatePublishingHandoff(handoff.id, 'opened')
      const opened = store.repository.markPublishingComputerUsePilotPageOpened(pilot.id)
      notifyWorkspaceChanged()
      return opened
    } catch (error) {
      if (clipboard.readText() === packetText) clipboard.clear()
      publishingPilotClipboardPackets.delete(pilot.id)
      const failed = store.repository.stopPublishingComputerUsePilot(pilot.id, 'failed', error instanceof Error ? error.message : 'B站投稿页打开失败')
      notifyWorkspaceChanged()
      return failed
    }
  })

  ipcMain.handle(IPC_CHANNELS.publishingComputerUsePilotReady, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingComputerUsePilotPayloadSchema.parse(payload)
    const pilot = store.repository.getPublishingComputerUsePilot(input.pilotId)
    assertCurrentPublishingHandoff(store.repository.getPublishingHandoff(pilot.handoffId))
    const ready = store.repository.markPublishingComputerUsePilotReady(pilot.id)
    clearPublishingPilotClipboard(ready.id)
    notifyWorkspaceChanged()
    return ready
  })

  ipcMain.handle(IPC_CHANNELS.publishingComputerUsePilotStop, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = publishingComputerUsePilotStopPayloadSchema.parse(payload)
    const pilot = store.repository.stopPublishingComputerUsePilot(input.pilotId, input.status, input.message)
    clearPublishingPilotClipboard(pilot.id)
    notifyWorkspaceChanged()
    return pilot
  })

  ipcMain.handle(IPC_CHANNELS.distributionBatchesList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.listDistributionBatches()
  })

  ipcMain.handle(IPC_CHANNELS.distributionBatchCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionBatchCreatePayloadSchema.parse(payload)
    let sourceText = input.sourceText.trim()
    let sourceVersionId: string | null = null
    if (input.sourceKind === 'project_final') {
      const project = store.repository.getProject(input.sourceProjectId!, false)
      const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
      if (!finalVersion) throw new Error('所选项目还没有定稿文案')
      sourceVersionId = finalVersion.id
      sourceText = finalVersion.content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .split(/\n+/).map((line) => line.trim()).filter(Boolean).join('\n')
    }
    const batch = store.repository.createDistributionBatch({
      title: input.title,
      sourceKind: input.sourceKind,
      sourceProjectId: input.sourceKind === 'project_final' ? input.sourceProjectId : null,
      sourceVersionId,
      sourceText
    })
    notifyWorkspaceChanged()
    return batch
  })

  ipcMain.handle(IPC_CHANNELS.distributionAnalysisStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionAnalysisStartPayloadSchema.parse(payload)
    const providerSecurity = await services.taskRunner.freezeTextProviderExecutionContext(input.providerConfigId)
    const batch = store.repository.assertDistributionAnalysisCanStart(input.batchId)
    const snapshot = distributionAnalysisTaskSnapshotSchema.parse({
      version: 1,
      batchId: batch.id,
      sourceKind: batch.sourceKind,
      sourceTitle: batch.title,
      sourceText: batch.sourceText,
      providerSecurity
    })
    const task = store.repository.createTaskRun({
      taskType: 'distribution_analysis',
      projectId: batch.sourceProjectId,
      title: `分析短视频片段·${batch.title}`,
      provider: providerSecurity.provider,
      model: providerSecurity.provider === 'external_api' ? providerSecurity.model : null,
      inputSnapshot: JSON.stringify(snapshot),
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_asset', shell: false },
      outputTarget: `distribution:${batch.id}`
    })
    store.repository.attachDistributionAnalysisTask(batch.id, task.id)
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.distributionSegmentUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const batch = store.repository.updateDistributionSegment(distributionSegmentUpdatePayloadSchema.parse(payload))
    notifyWorkspaceChanged()
    return batch
  })

  ipcMain.handle(IPC_CHANNELS.distributionSegmentCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionBatchPayloadSchema.parse(payload)
    const batch = store.repository.createDistributionSegment(input.batchId)
    notifyWorkspaceChanged()
    return batch
  })

  ipcMain.handle(IPC_CHANNELS.distributionFilesLink, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionFilesLinkPayloadSchema.parse(payload)
    const batch = store.repository.getDistributionBatch(input.batchId)
    let sourcePaths = input.sourcePaths
    if (!sourcePaths.length) {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: '关联已经手动剪好的短视频（只保存外部路径）',
        buttonLabel: '关联到片段',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm'] }]
      }
      const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths.length) return null
      sourcePaths = selection.filePaths
    }
    const openSegmentCount = input.segmentId ? Number(batch.segments.some((segment) => segment.id === input.segmentId)) : batch.segments.filter((segment) => !segment.fileId).length
    if (!openSegmentCount) throw new Error('所有片段都已经关联文件')
    if (sourcePaths.length > openSegmentCount) throw new Error(`当前最多还能关联${openSegmentCount}个文件`)
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
    const retained: Awaited<ReturnType<typeof retainLinkedFileFromPath>>[] = []
    try {
      for (const sourcePath of [...sourcePaths].sort((left, right) => collator.compare(basename(left), basename(right)))) {
        const canonical = await realpath(sourcePath)
        let bookmark: string | null = null
        try { bookmark = services.secretProtector.encrypt(canonical) } catch { bookmark = null }
        retained.push(await retainLinkedFileFromPath(dirname(store.databasePath), {
          sourcePath: canonical,
          managedDirectory: join('distribution-links', batch.id),
          sourceOrigin: 'file_picker',
          sourceBookmark: bookmark,
          maximumBytes: 20 * 1024 * 1024 * 1024
        }))
      }
      const updated = store.repository.attachDistributionFiles(batch.id, retained.map((item) => item.file), input.segmentId)
      await cleanupReleasedManagedFiles(dirname(store.databasePath), updated.releasedManagedLocators, store.repository.listManagedFileLocators())
      notifyWorkspaceChanged()
      return updated.batch
    } catch (error) {
      await Promise.all(retained.map((item) => discardManagedLocator(dirname(store.databasePath), item.file.managedLocator ?? item.file.relativePath)))
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.distributionTargetsReplace, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionTargetsReplacePayloadSchema.parse(payload)
    const batch = store.repository.replaceDistributionTargets(input.batchId, input.segmentId, input.accountIds)
    notifyWorkspaceChanged()
    return batch
  })

  ipcMain.handle(IPC_CHANNELS.distributionTargetStatusSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionTargetStatusPayloadSchema.parse(payload)
    const batch = store.repository.setDistributionTargetStatus(input.batchId, input.targetId, input.status, input.note)
    notifyWorkspaceChanged()
    return batch
  })

  ipcMain.handle(IPC_CHANNELS.distributionBatchComplete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionBatchCompletePayloadSchema.parse(payload)
    const result = store.repository.completeDistributionBatch(input.batchId, input.force)
    if (!result.requiresConfirmation) notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.distributionBatchReopen, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionBatchPayloadSchema.parse(payload)
    const batch = store.repository.reopenDistributionBatch(input.batchId)
    notifyWorkspaceChanged()
    return batch
  })

  const distributionFilePath = async (batchId: string, segmentId: string): Promise<string> => {
    const segment = store.repository.getDistributionBatch(batchId).segments.find((item) => item.id === segmentId)
    if (!segment?.fileId) throw new Error('片段还没有关联本地文件')
    const file = store.repository.getFileReference(segment.fileId)
    const managedPath = resolveManagedFilePath(dirname(store.databasePath), file.managedLocator || file.relativePath)
    return realpath(managedPath).catch(() => { throw new Error('外部文件已经移动或删除，请重新关联') })
  }

  ipcMain.handle(IPC_CHANNELS.distributionFileOpen, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionFilePayloadSchema.parse(payload)
    const path = await distributionFilePath(input.batchId, input.segmentId)
    if (!isBackgroundTestMode) {
      const result = await shell.openPath(path)
      if (result) throw new Error(result)
    }
    return true
  })

  ipcMain.handle(IPC_CHANNELS.distributionFileReveal, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = distributionFilePayloadSchema.parse(payload)
    const path = await distributionFilePath(input.batchId, input.segmentId)
    if (!isBackgroundTestMode) shell.showItemInFolder(path)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.projectSetResourceReference, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectSetResourceReferencePayloadSchema.parse(payload)
    const reference = store.repository.setProjectResourceReference(input)
    notifyWorkspaceChanged()
    return reference
  })

  ipcMain.handle(IPC_CHANNELS.taskPrepareResources, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskPrepareResourcesPayloadSchema.parse(payload)
    return store.repository.prepareTaskResources(input.projectId, input)
  })

  ipcMain.handle(IPC_CHANNELS.contentEngineGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.getContentEngineSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.contentSourceImport, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentSourceImportPayloadSchema.parse(payload)
    const result = store.repository.importContentSource(input)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.conversationSourcesList, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationSourcesListPayloadSchema.parse(payload)
    return conversationSources.listMetadata(input)
  })

  ipcMain.handle(IPC_CHANNELS.conversationSelectionPrepare, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationSelectionPreparePayloadSchema.parse(payload)
    return conversationSources.prepareSelection(input)
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterStartPayloadSchema.parse(payload)
    const selection = await conversationSources.prepareSelection(input)
    if (selection.budget.status === 'blocked' || selection.input.truncated || selection.input.turnCount === 0) throw new Error(selection.budget.message)
    const providerSecurity = await services.taskRunner.getProviderExecutionContext(input.provider)
    const snapshot = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), selection, providerSecurity })
    const task = store.repository.createTaskRun({
      taskType: 'conversation_filter',
      projectId: null,
      title: `AI对话筛选·${selection.input.conversationCount}条`,
      provider: input.provider,
      model: null,
      inputSnapshot: snapshot,
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_fact', shell: false },
      outputTarget: 'conversation_filter_candidates'
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanPlan, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanPlanPayloadSchema.parse(payload)
    return (await scanMetadata(input)).plan
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanPrepare, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanPreparePayloadSchema.parse(payload)
    if (['running', 'paused'].includes(scanProgress().status)) throw new Error('已有AI选题扫描尚未结束，请先继续或完成当前扫描')
    const providerConfigId = input.providerConfigId ?? (input.provider === 'claude_cli' ? BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude : BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex)
    const { eligible } = await scanMetadata(input)
    if (!eligible.length) throw new Error(input.mode === 'incremental' ? '没有新增或变化的对话' : '没有可扫描的对话')
    const skippedIssues: { sourceId: string | null; code: string; message: string }[] = []
    const prepared: { sources: ConversationMetadata[]; selection: Awaited<ReturnType<ConversationSourceService['prepareSelection']>> }[] = []
    const scannedStates = store.repository.getConversationScanSourceStates()
    let acceptedTokens = 0
    const prepareBatch = async (sources: ConversationMetadata[]): Promise<void> => {
      const selection = await conversationSources.prepareSelection({
        ids: sources.map((source) => source.id),
        customSensitiveTerms: input.customSensitiveTerms,
        afterOffsets: input.mode === 'incremental'
          ? Object.fromEntries(sources.map((source) => [source.id, scannedStates.get(source.id)?.lastScannedOffset ?? 0]))
          : undefined
      })
      if ((selection.budget.status === 'blocked' || selection.input.truncated) && sources.length > 1) {
        const split = Math.ceil(sources.length / 2)
        await prepareBatch(sources.slice(0, split))
        await prepareBatch(sources.slice(split))
        return
      }
      if (selection.budget.status === 'blocked' || selection.input.truncated || selection.input.turnCount === 0) {
        skippedIssues.push(...(selection.issues.length ? selection.issues : sources.map((source) => ({ sourceId: source.id, code: 'SCAN_SOURCE_SKIPPED', message: `${source.title}超出单批预算或没有可用普通文本` }))))
        return
      }
      if (input.budgetTokenLimit && acceptedTokens + selection.input.estimatedTokens > input.budgetTokenLimit) {
        skippedIssues.push(...sources.map((source) => ({ sourceId: source.id, code: 'SCAN_BUDGET_PAUSED', message: `${source.title}留待下次增量扫描：已达到本次输入Token上限` })))
        return
      }
      acceptedTokens += selection.input.estimatedTokens
      prepared.push({ sources, selection })
    }
    for (let index = 0; index < eligible.length; index += 10) await prepareBatch(eligible.slice(index, index + 10))
    if (!prepared.length) throw new Error(skippedIssues[0]?.message ?? '没有可以进入AI筛选的普通对话文本')
    const excludedBlocks = new Map<string, number>()
    for (const item of prepared) {
      for (const block of item.selection.excludedBlocks) excludedBlocks.set(block.blockType, (excludedBlocks.get(block.blockType) ?? 0) + block.count)
    }
    const providerExecution = await services.taskRunner.freezeTextProviderExecutionContext(providerConfigId)
    prunePreparedScans()
    const preflightId = randomUUID()
    const preflight: ConversationScanPreflight = {
      preflightId,
      mode: input.mode,
      sourceScope: input.sourceScope,
      providerConfigId,
      providerLabel: providerExecution.displayName,
      providerTransport: providerExecution.provider === 'external_api' ? 'api' : 'cli',
      conversationCount: prepared.reduce((total, item) => total + item.sources.length, 0),
      batchCount: prepared.length,
      estimatedTokens: acceptedTokens,
      characterCount: prepared.reduce((total, item) => total + item.selection.input.characterCount, 0),
      privacyFindingCount: prepared.reduce((total, item) => total + item.selection.privacy.findingCount, 0),
      privacyFindingKinds: [...new Set(prepared.flatMap((item) => item.selection.privacy.findingKinds))],
      excludedBlocks: [...excludedBlocks.entries()].map(([blockType, count]) => ({ blockType, count })).sort((left, right) => right.count - left.count),
      issues: [...skippedIssues, ...prepared.flatMap((item) => item.selection.issues)]
    }
    preparedScans.set(preflightId, { preflight, providerExecution, selections: prepared, skippedIssues, createdAt: Date.now() })
    return preflight
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanPreflightBatch, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanPreflightBatchPayloadSchema.parse(payload)
    prunePreparedScans()
    const prepared = preparedScans.peek(input.preflightId)
    if (!prepared) throw new Error('发送前检查已过期，请重新检查')
    const item = prepared.selections[input.batchIndex - 1]
    if (!item) throw new Error('发送前检查批次不存在')
    return {
      preflightId: input.preflightId,
      batchIndex: input.batchIndex,
      batchCount: prepared.selections.length,
      sourceTitles: item.sources.map((source) => source.title),
      sanitizedContent: item.selection.sanitizedContent,
      privacyFindingCount: item.selection.privacy.findingCount,
      privacyFindingKinds: item.selection.privacy.findingKinds,
      excludedBlocks: item.selection.excludedBlocks,
      characterCount: item.selection.input.characterCount,
      estimatedTokens: item.selection.input.estimatedTokens
    }
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanStart, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanStartPayloadSchema.parse(payload)
    if (['running', 'paused'].includes(scanProgress().status)) throw new Error('已有AI选题扫描尚未结束，请先继续或完成当前扫描')
    prunePreparedScans()
    const prepared = preparedScans.consume(input.preflightId)
    if (!prepared) throw new Error('发送前检查已过期，请重新检查')
    await services.taskRunner.assertTextProviderExecutionContextCurrent(prepared.providerExecution)
    const providerExecution = prepared.providerExecution
    const scanId = randomUUID()
    const tasks = prepared.selections.map(({ selection }, index) => store.repository.createTaskRun({
      taskType: 'conversation_filter',
      projectId: null,
      title: `AI选题${prepared.preflight.mode === 'deep' ? '深度' : '增量'}扫描·${index + 1}/${prepared.selections.length}`,
      provider: providerExecution.provider,
      model: providerExecution.provider === 'external_api' ? providerExecution.model : null,
      inputSnapshot: JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        selection,
        providerSecurity: providerExecution,
        scan: {
          scanId,
          mode: prepared.preflight.mode,
          batchIndex: index + 1,
          batchCount: prepared.selections.length,
          sourceVersions: selection.sourceCursors
        }
      }),
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_fact', shell: false },
      outputTarget: 'ai_topic_candidates'
    }))
    tasks.forEach((task) => services.taskRunner.enqueue(task))
    notifyWorkspaceChanged()
    return {
      scanId,
      mode: prepared.preflight.mode,
      conversationCount: prepared.preflight.conversationCount,
      estimatedTokens: prepared.preflight.estimatedTokens,
      tasks,
      skippedIssues: prepared.skippedIssues
    }
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanProgress, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanIdPayloadSchema.parse(payload)
    return scanProgress(input.scanId)
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanPause, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanIdPayloadSchema.parse(payload)
    if (!input.scanId) throw new Error('扫描批次不存在')
    for (const task of store.repository.listConversationScanTaskRuns(input.scanId)) {
      if (scanTaskDescriptor(task)?.scanId === input.scanId && ['queued', 'running'].includes(task.status)) services.taskRunner.cancel(task.id)
    }
    notifyWorkspaceChanged()
    return scanProgress(input.scanId)
  })

  ipcMain.handle(IPC_CHANNELS.conversationScanResume, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationScanIdPayloadSchema.parse(payload)
    if (!input.scanId) throw new Error('扫描批次不存在')
    const latestByBatch = new Map<number, TaskRun>()
    for (const task of store.repository.listConversationScanTaskRuns(input.scanId)) {
      const descriptor = scanTaskDescriptor(task)
      if (descriptor?.scanId !== input.scanId) continue
      const current = latestByBatch.get(descriptor.batchIndex)
      if (!current || current.requestedAt < task.requestedAt) latestByBatch.set(descriptor.batchIndex, task)
    }
    let resumed = 0
    for (const task of latestByBatch.values()) {
      if (task.status !== 'canceled' && task.status !== 'failed') continue
      services.taskRunner.retry(task.id)
      resumed += 1
    }
    if (!resumed) throw new Error('没有可继续或重试的扫描批次')
    notifyWorkspaceChanged()
    return scanProgress(input.scanId)
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterCandidatesList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterCandidatesListPayloadSchema.parse(payload)
    return store.repository.listConversationFilterCandidates(input.taskId)
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterCandidateSetStatus, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterCandidateSetStatusPayloadSchema.parse(payload)
    const candidate = store.repository.setConversationFilterCandidateStatus(input.candidateId, input.status)
    notifyWorkspaceChanged()
    return candidate
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterCandidateRoute, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterCandidateRoutePayloadSchema.parse(payload)
    const result = store.repository.routeConversationFilterCandidate(input.candidateId, input.destination)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterCandidateDecide, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterCandidateDecidePayloadSchema.parse(payload)
    const result = store.repository.decideConversationFilterCandidate(input.candidateId, input.decision)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterCandidatesConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterCandidatesConfirmPayloadSchema.parse(payload)
    const result = store.repository.confirmConversationFilterCandidates(input.candidateIds)
    notifyWorkspaceChanged()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.conversationFilterCandidateDelete, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = conversationFilterCandidateDeletePayloadSchema.parse(payload)
    store.repository.permanentlyDeleteConversationFilterCandidate(input.candidateId)
    notifyWorkspaceChanged()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.contentAtomSetStatus, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentAtomSetStatusPayloadSchema.parse(payload)
    const atom = store.repository.setContentAtomStatus(input.atomId, input.status)
    notifyWorkspaceChanged()
    return atom
  })

  ipcMain.handle(IPC_CHANNELS.contentAtomMerge, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentAtomMergePayloadSchema.parse(payload)
    const atom = store.repository.mergeContentAtoms(input.atomIds, input.title)
    notifyWorkspaceChanged()
    return atom
  })

  ipcMain.handle(IPC_CHANNELS.contentDerivativePrepare, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentDerivativePreparePayloadSchema.parse(payload)
    return store.repository.prepareContentDerivation(input)
  })

  ipcMain.handle(IPC_CHANNELS.contentDerivativeCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentDerivativeCreatePayloadSchema.parse(payload)
    const candidate = store.repository.createContentDerivative(input)
    notifyWorkspaceChanged()
    return candidate
  })

  ipcMain.handle(IPC_CHANNELS.contentDerivativeConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentDerivativeConfirmPayloadSchema.parse(payload)
    const candidate = store.repository.confirmContentDerivative(input.candidateId, input.currentContent)
    notifyWorkspaceChanged()
    return candidate
  })

  ipcMain.handle(IPC_CHANNELS.contentDerivativeCopy, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentDerivativeIdPayloadSchema.parse(payload)
    clipboard.writeText(store.repository.getConfirmedContentForCopy(input.candidateId))
    return true
  })

  ipcMain.handle(IPC_CHANNELS.contentDerivativeCreateProject, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = contentDerivativeCreateProjectPayloadSchema.parse(payload)
    const project = store.repository.createProjectFromContentDerivative(input.candidateId, input)
    notifyWorkspaceChanged()
    return project
  })

  ipcMain.handle(IPC_CHANNELS.taskCreate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskCreatePayloadSchema.parse(payload)
    if (input.taskType === 'draft_generation' && !input.projectId) throw new Error('文案任务必须关联内容项目')
    const capability = services.taskRunner.getCapabilities().find((item) => item.provider === input.provider)
    if (!capability?.available) throw new Error('所选Provider当前不可用')
    const resourceSnapshot = input.taskType === 'draft_generation' && input.projectId
      ? store.repository.buildTaskResourceSnapshot(input.projectId, input)
      : null
    const inputSnapshot = resourceSnapshot && input.projectId
      ? store.repository.composeDraftTaskInput(input.projectId, input.input, resourceSnapshot)
      : input.input
    const task = store.repository.createTaskRun({
      taskType: input.taskType, projectId: input.projectId, title: input.title, provider: input.provider,
      inputSnapshot,
      taskContentTypeId: resourceSnapshot?.contentTypeId ?? null,
      taskTemplateId: resourceSnapshot?.templateId ?? null,
      resourceSnapshot,
      permissionProfile: {
        network: input.provider === 'mock' ? 'off' : 'provider_only', readableRefs: [],
        writableTarget: input.taskType === 'draft_generation' ? 'new_version' : 'none', shell: false
      },
      outputTarget: input.taskType === 'draft_generation' ? 'candidate:script' : null
    })
    services.taskRunner.enqueue(task)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.taskCancel, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskIdPayloadSchema.parse(payload)
    if (store.repository.getTaskRun(input.taskId).taskType === 'nas_archive') {
      services.nasArchive.cancel(services.nasArchive.getRunByTaskId(input.taskId).id)
      return store.repository.getTaskRun(input.taskId)
    }
    return services.taskRunner.cancel(input.taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskDismiss, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskIdPayloadSchema.parse(payload)
    const task = store.repository.dismissTaskRun(input.taskId)
    notifyWorkspaceChanged()
    return task
  })

  ipcMain.handle(IPC_CHANNELS.taskRetry, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskIdPayloadSchema.parse(payload)
    if (store.repository.getTaskRun(input.taskId).taskType === 'nas_archive') {
      services.nasArchive.retry(services.nasArchive.getRunByTaskId(input.taskId).id)
      return store.repository.getTaskRun(input.taskId)
    }
    return services.taskRunner.retry(input.taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskRetryWithFallback, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskIdPayloadSchema.parse(payload)
    return services.taskRunner.retryWithFallback(input.taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskConfirm, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = taskIdPayloadSchema.parse(payload)
    if (store.repository.getTaskRun(input.taskId).taskType === 'nas_archive') throw new Error('NAS归档必须在预览中核对内容后确认')
    return services.taskRunner.confirm(input.taskId)
  })

  ipcMain.handle(IPC_CHANNELS.providerSecurityValidate, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = providerSecurityValidatePayloadSchema.parse(payload)
    const capability = await services.taskRunner.validateProvider(input.provider)
    if (input.provider === 'codex_cli' && capability.available) void services.taskRunner.scheduleCaptureClassification()
    return capability
  })

  ipcMain.handle(IPC_CHANNELS.providerSettingsGet, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.providerConfigs.getSettings()
  })

  ipcMain.handle(IPC_CHANNELS.externalProviderConfigSave, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = externalProviderConfigSavePayloadSchema.parse(payload)
    return services.providerConfigs.saveConfig(input)
  })

  ipcMain.handle(IPC_CHANNELS.externalProviderConfigDelete, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = externalProviderConfigIdPayloadSchema.parse(payload)
    return services.providerConfigs.deleteConfig(input.id)
  })

  ipcMain.handle(IPC_CHANNELS.externalProviderConfigValidate, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = externalProviderConfigIdPayloadSchema.parse(payload)
    return services.providerConfigs.validateConfig(input.id)
  })

  ipcMain.handle(IPC_CHANNELS.providerRoutingSet, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = providerRoutingSetPayloadSchema.parse(payload)
    return services.providerConfigs.setRouting(input.defaultProviderConfigId, input.fallbackProviderConfigId)
  })

  ipcMain.handle(IPC_CHANNELS.externalFileRelationsList, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return store.repository.listExternalFileRelations()
  })

  ipcMain.handle(IPC_CHANNELS.workspaceAccessGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    return services.mobileSync.getWorkspaceV2Access(workspaceAccessQuerySchema.parse(payload).deviceId)
  })

  ipcMain.handle(IPC_CHANNELS.workspaceAccessUpdate, (event, payload) => {
    assertTrustedSender(event, ['main'])
    return services.mobileSync.updateWorkspaceV2Access(workspaceAccessUpdateSchema.parse(payload))
  })

  ipcMain.handle(IPC_CHANNELS.mobileSyncStatusGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    emptyPayloadSchema.parse(payload)
    return services.mobileSync.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.mobileSyncSetEnabled, async (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = mobileSyncSetEnabledPayloadSchema.parse(payload)
    return services.mobileSync.setEnabled(input.enabled)
  })

  ipcMain.handle(IPC_CHANNELS.mobileSyncPairingApprove, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = mobileSyncPairingDecisionPayloadSchema.parse(payload)
    return services.mobileSync.approvePairing(input.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.mobileSyncPairingReject, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = mobileSyncPairingDecisionPayloadSchema.parse(payload)
    return services.mobileSync.rejectPairing(input.sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.mobileSyncDeviceRevoke, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = mobileSyncDeviceRevokePayloadSchema.parse(payload)
    return services.mobileSync.revokeDevice(input.deviceId)
  })

  ipcMain.handle(IPC_CHANNELS.preferencesSet, (event, payload) => {
    const role = assertTrustedSender(event, ['main', 'todo'])
    const patch = preferencesPatchSchema.parse(payload)
    if (role === 'todo' && Object.keys(patch).some((key) => !['companionTodoView', 'companionTodoOrder'].includes(key))) throw new Error('待办窗口只能修改查看方式和排列顺序')
    const preferences = store.repository.setPreferences(patch)
    if (patch.theme || patch.visualStyle) {
      broadcast(IPC_CHANNELS.appearanceChanged, {
        theme: preferences.theme,
        visualStyle: preferences.visualStyle
      })
    }
    notifyWorkspaceChanged()
    return preferences
  })

  ipcMain.handle(IPC_CHANNELS.workbenchPreferencesGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = workbenchPreferencesGetPayloadSchema.parse(payload)
    return store.repository.getWorkbenchPreferences(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.workbenchPreferencesSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = workbenchPreferencesSetPayloadSchema.parse(payload)
    return store.repository.setWorkbenchPreferences(input.projectId, input.patch)
  })

  ipcMain.handle(IPC_CHANNELS.projectProductionNotesGet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectProductionNotesGetPayloadSchema.parse(payload)
    return store.repository.getProjectProductionNotes(input.projectId)
  })

  ipcMain.handle(IPC_CHANNELS.projectProductionNotesSet, (event, payload) => {
    assertTrustedSender(event, ['main'])
    const input = projectProductionNotesSetPayloadSchema.parse(payload)
    const notes = store.repository.setProjectProductionNotes(input.projectId, {
      scope: input.scope,
      shootingItems: input.shootingItems,
      editingNotes: input.editingNotes,
      editingNotesFormat: input.editingNotesFormat
    })
    notifyWorkspaceChanged()
    return notes
  })
}
