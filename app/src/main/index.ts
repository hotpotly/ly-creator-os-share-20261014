import { app, dialog, globalShortcut, safeStorage, systemPreferences } from 'electron'
import { execFileSync } from 'node:child_process'
import { readlinkSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openWorkspaceStore, type WorkspaceStore } from './db'
import { ExternalProviderConfigService } from './external-provider-config-service'
import { BusinessLedgerLockService } from './business-ledger-lock-service'
import { ExternalDraftWatcher } from './external-draft-watcher'
import { CAPTURE_SHORTCUT, notifyWorkspaceChanged, registerIpcHandlers } from './ipc'
import { configurePermissionPolicy } from './security'
import { MobileSyncService, type SecretProtector } from './mobile-sync-service'
import { NasArchiveConfigService } from './nas-archive-config-service'
import { NasArchiveService } from './nas-archive-service'
import { TaskRunner } from './task-runner'
import { JsonWeatherCacheStore, WeatherService } from './weather-service'
import { applyPendingWorkspaceRestore } from './workspace-restore'
import { markAppQuitting } from './window-lifecycle'
import { createScheduleTray, destroyScheduleTray, createMainWindow, createTodoTray, destroyTodoTray, isBackgroundTestMode, openCaptureWindow, revealMainWindow } from './windows'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../shared/domain'

if (process.platform === 'win32') app.setAppUserModelId('com.ly.creatoros')
if (process.env.CREATOR_OS_USER_DATA && (!app.isPackaged || process.env.NODE_ENV === 'test')) app.setPath('userData', resolve(process.env.CREATOR_OS_USER_DATA))

// 崩溃或被强杀后，Electron 的 SingletonLock 会残留；若它指向的进程号已被系统复用为别的进程，
// Electron 会误判“已有实例在运行”而让新实例自杀，表现为 App 再也打不开。这里在拿锁前主动识别并清理 stale 锁。
function clearStaleSingletonLock(userDataPath: string): void {
  try {
    const lockPath = join(userDataPath, 'SingletonLock')
    const pid = Number.parseInt(readlinkSync(lockPath).split('-').pop() ?? '', 10)
    if (!Number.isInteger(pid) || pid <= 0) return
    let alive: boolean
    try { process.kill(pid, 0); alive = true } catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM' }
    if (alive) {
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
      // 只有另一个本 app 主进程（打包产物名、且非 --type 辅助进程）才是真实例，保留其锁；
      // 辅助进程（含 --type）或被复用为别的进程，都视为可清理的 stale 锁。
      if (command.includes('LY Creator OS') && !command.includes('--type=')) return
    }
    unlinkSync(lockPath)
  } catch { /* 无锁或无法解析时交给 Electron 默认处理 */ }
}
// 仅打包版启用：开发模式主进程命令行为 `Electron .`，信息不足以区分实例与 stale 锁，开发期改用手动清理。
if (app.isPackaged && process.platform !== 'win32' && !isBackgroundTestMode) clearStaleSingletonLock(app.getPath('userData'))

let workspaceStore: WorkspaceStore | null = null
let taskRunner: TaskRunner | null = null
let externalDraftWatcher: ExternalDraftWatcher | null = null
let mobileSync: MobileSyncService | null = null
let nasArchive: NasArchiveService | null = null
let quitPrepared = false
let preparingQuit = false

function seedR17ComparisonForTest(store: WorkspaceStore): void {
  if (process.env.NODE_ENV !== 'test' || process.env.CREATOR_OS_TEST_R17_READY !== '1') return
  if (store.repository.getDraftComparisonWorkspace('ai-browser').activeSession) return
  const markdownSelectionFixture = process.env.CREATOR_OS_TEST_R18_MARKDOWN === '1'
  store.repository.saveDraftComparisonDrafts('ai-browser', {
    codexContent: markdownSelectionFixture ? '# 重复短语与**重复短语**\nCodex参数段\nCodex结尾' : 'Codex开头\nCodex参数段\nCodex结尾',
    claudeContent: 'Claude开头\nClaude体验段\nClaude结尾'
  })
  const task = store.repository.startDraftAlignment({
    projectId: 'ai-browser',
    useOutline: false,
    providerSecurity: {
      provider: 'codex_cli',
      providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
      displayName: 'Codex CLI',
      cliVersion: 'test',
      fingerprint: 'r17-e2e',
      policyVersion: 'test'
    }
  })
  const workspace = store.repository.saveDraftAlignmentResult(task.id, {
    groups: [
      { codexParagraphIds: ['codex-p-1'], claudeParagraphIds: ['claude-p-1'], matchType: 'related' },
      { codexParagraphIds: ['codex-p-2'], claudeParagraphIds: ['claude-p-2'], matchType: 'related' },
      { codexParagraphIds: ['codex-p-3'], claudeParagraphIds: ['claude-p-3'], matchType: 'related' }
    ]
  })
  store.repository.updateTaskRun(task.id, {
    status: 'succeeded',
    progress: 100,
    resultSummary: 'R17测试语义对照已生成',
    finishedAt: new Date().toISOString()
  })
  const [first, second] = workspace.activeSession!.groups
  store.repository.setDraftGroupDecision({ projectId: 'ai-browser', groupId: first!.id, kind: 'codex' })
  store.repository.addFreeformDraftCandidate('ai-browser', second!.id, '候选体验段')
}

const hasSingleInstanceLock = isBackgroundTestMode || app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.whenReady().then(async () => {
    if (isBackgroundTestMode && process.platform === 'darwin') app.dock?.hide()
    configurePermissionPolicy()
    const secretProtector: SecretProtector = {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (secret) => safeStorage.encryptString(secret).toString('base64'),
      decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    }
    let restoreFailure: string | null = null
    try {
      await applyPendingWorkspaceRestore(app.getPath('userData'), secretProtector)
    } catch (error) {
      restoreFailure = error instanceof Error ? error.message : '备份恢复失败'
      console.error('工作区恢复失败，继续打开原工作区', error)
    }
    workspaceStore = await openWorkspaceStore(app.getPath('userData'))
    seedR17ComparisonForTest(workspaceStore)
    await workspaceStore.createBackup('startup')
    const providerConfigs = new ExternalProviderConfigService(join(app.getPath('userData'), 'provider-configs.json'), secretProtector)
    const nasArchiveConfigs = new NasArchiveConfigService(join(app.getPath('userData'), 'nas-archive-config.json'), secretProtector)
    const businessLedgerLock = new BusinessLedgerLockService(
      join(app.getPath('userData'), 'business-ledger-lock.json'),
      secretProtector,
      {
        isAvailable: () => {
          if (process.env.CREATOR_OS_TEST_TOUCH_ID === '1') return true
          if (isBackgroundTestMode || process.platform !== 'darwin') return false
          try { return systemPreferences.canPromptTouchID() } catch { return false }
        },
        authenticate: async (reason) => {
          if (process.env.CREATOR_OS_TEST_TOUCH_ID === '1') return
          await systemPreferences.promptTouchID(reason)
        }
      }
    )
    await businessLedgerLock.initialize()
    taskRunner = new TaskRunner(workspaceStore, notifyWorkspaceChanged, providerConfigs)
    externalDraftWatcher = new ExternalDraftWatcher(workspaceStore, notifyWorkspaceChanged)
    mobileSync = new MobileSyncService(workspaceStore, secretProtector, () => {
      notifyWorkspaceChanged()
      void taskRunner?.scheduleCaptureClassification()
    }, { onWorkspaceChanged: notifyWorkspaceChanged })
    nasArchive = new NasArchiveService(workspaceStore, nasArchiveConfigs, notifyWorkspaceChanged)
    const weather = new WeatherService(new JsonWeatherCacheStore(join(app.getPath('userData'), 'weather-cache.json')))
    nasArchive.recoverInterruptedRuns()
    registerIpcHandlers(workspaceStore, { taskRunner, externalDraftWatcher, mobileSync, secretProtector, providerConfigs, nasArchiveConfigs, nasArchive, businessLedgerLock, weather })
    await externalDraftWatcher.start()
    await taskRunner.start()
    await mobileSync.startFromPreference()
    nasArchive.startDailyBackupSchedule()
    createMainWindow()
    createTodoTray()
    createScheduleTray()
    if (restoreFailure && !isBackgroundTestMode) {
      void dialog.showMessageBox({
        type: 'warning',
        title: '备份恢复失败',
        message: '恢复失败，原数据未更改',
        detail: restoreFailure,
        buttons: ['知道了'],
        defaultId: 0
      })
    }

    if (!isBackgroundTestMode) {
      const registered = globalShortcut.register(CAPTURE_SHORTCUT, () => openCaptureWindow())
      if (!registered) console.warn(`无法注册快速记录快捷键：${CAPTURE_SHORTCUT}`)
    }

    app.on('activate', () => { revealMainWindow() })
  }).catch((error: unknown) => { console.error('应用初始化失败', error); app.quit() })

  app.on('before-quit', (event) => {
    markAppQuitting()
    if (quitPrepared) return
    event.preventDefault()
    if (preparingQuit) return
    preparingQuit = true; globalShortcut.unregisterAll(); destroyTodoTray(); destroyScheduleTray(); taskRunner?.close(); taskRunner = null
    const watcher = externalDraftWatcher; externalDraftWatcher = null
    const syncService = mobileSync; mobileSync = null
    const archiveService = nasArchive; nasArchive = null
    void (async () => {
      await watcher?.close().catch((error: unknown) => console.error('外部文案监听关闭失败', error))
      await syncService?.stop().catch((error: unknown) => console.error('局域网接收关闭失败', error))
      try {
        await archiveService?.close()
      } catch (error) {
        console.error('NAS任务关闭超时，将直接退出', error)
        quitPrepared = true
        app.exit(0)
        return
      }
      workspaceStore?.close(); workspaceStore = null; quitPrepared = true; app.quit()
    })()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
