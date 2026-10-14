import { BrowserWindow, nativeImage, screen, shell, Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC_CHANNELS } from '../shared/ipc'
import { hardenWindow, type WindowRole } from './security'
import { isAppQuitting, shouldHideMainWindow } from './window-lifecycle'

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let todoPanelWindow: BrowserWindow | null = null
let todoWidgetWindow: BrowserWindow | null = null
let todoTray: Tray | null = null
let captureTargetProjectId: string | null = null
let captureTargetKind: 'project_content' | 'client_feedback' | null = null

export const isBackgroundTestMode = process.env.NODE_ENV === 'test' && process.env.CREATOR_OS_TEST_BACKGROUND === '1'
const TODO_TRAY_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAEOSURBVFiF7dQxSsRAGIbhJ4uFCN5gO8EzWHgAy61k2c4jWHkFLyGihY0X8AhW2tiJnSdYFgUF1yYLQ0yys9lMsJgXBkL+P5k3M5OPTKY/zjHHsmHMcYvjoYQWLTLh+MD+EEIxMku8pJQoKkIrTnFfXl/gMqgd4hUnOOrB4REPdYXqSlzhrOY+TDZY0ZgxiRFqGjDtWWi6kmjasjcclNc/GAW1AnuYYdx1nwLecVf+LI1CbRQRPZ0Jv/wzoj+mZytCoeeI/qeELn+ICcZFaol/d4Z2Iietkx00GNfVkgXjqGbyGHY7Prf2fU1nqG3LcjC2kYMxB2OVHIw5GDuQg3EjQqEbfLf0fuE6tVAmsy2/xFnNRAr83eAAAAAASUVORK5CYII='

function rendererUrl(hash = ''): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const url = devUrl ? new URL(devUrl) : pathToFileURL(join(__dirname, '../renderer/index.html'))
  url.hash = hash
  return url.toString()
}

async function loadRenderer(window: BrowserWindow, hash = ''): Promise<void> {
  await window.loadURL(rendererUrl(hash))
}

function loadRendererOrClose(window: BrowserWindow, hash = ''): void {
  void loadRenderer(window, hash).catch((error: unknown) => {
    console.error('Renderer加载失败', error)
    if (!window.isDestroyed()) window.destroy()
  })
}

const sharedWebPreferences = {
  preload: join(__dirname, '../preload/index.cjs'),
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  backgroundThrottling: !isBackgroundTestMode
} as const

function secureWindow(window: BrowserWindow, role: WindowRole, hash = ''): void {
  hardenWindow(window, role, rendererUrl(hash))
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error('Renderer导航失败', { errorCode, errorDescription, validatedUrl, role })
  })
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'LY Creator OS', width: 1280, height: 720, minWidth: 680, minHeight: 560,
    useContentSize: true, show: false, skipTaskbar: isBackgroundTestMode,
    backgroundColor: '#FAF8F3', webPreferences: sharedWebPreferences
  })

  mainWindow = window
  secureWindow(window, 'main')
  window.webContents.on('before-input-event', (event, input) => {
    const commandPressed = process.platform === 'darwin' ? input.meta : input.control
    if (input.type !== 'keyDown' || input.isAutoRepeat || !commandPressed || input.key.toLowerCase() !== 'j') return
    event.preventDefault()
    window.webContents.send(IPC_CHANNELS.workbenchQuickLocatorRequested)
  })
  window.once('ready-to-show', () => { if (!isBackgroundTestMode) window.show() })
  window.on('close', (event) => {
    if (!shouldHideMainWindow(isBackgroundTestMode, isAppQuitting())) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
  loadRendererOrClose(window)
  return window
}

export function revealMainWindow(): BrowserWindow {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow()
  if (!isBackgroundTestMode) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  return window
}

export function openCaptureWindow(
  projectId: string | null = null,
  captureKind: 'project_content' | 'client_feedback' | null = null
): BrowserWindow {
  captureTargetProjectId = projectId
  captureTargetKind = projectId ? captureKind ?? 'project_content' : null
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.webContents.send(IPC_CHANNELS.captureActivated)
    if (!isBackgroundTestMode) {
      captureWindow.show()
      captureWindow.focus()
    }
    return captureWindow
  }

  const window = new BrowserWindow({
    title: '快速记录', width: 420, height: 300, minWidth: 380, minHeight: 300,
    useContentSize: true, show: false, alwaysOnTop: !isBackgroundTestMode, skipTaskbar: isBackgroundTestMode,
    frame: false, hasShadow: true, resizable: true, maximizable: false, fullscreenable: false,
    backgroundColor: '#FAF8F3', webPreferences: sharedWebPreferences
  })

  captureWindow = window
  secureWindow(window, 'capture', '/capture')
  if (!isBackgroundTestMode) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.once('ready-to-show', () => {
    if (!isBackgroundTestMode) {
      window.show()
      window.focus()
    }
  })
  window.on('closed', () => {
    if (captureWindow === window) {
      captureWindow = null
      captureTargetProjectId = null
      captureTargetKind = null
    }
  })
  loadRendererOrClose(window, '/capture')
  return window
}

export function closeCaptureWindow(): void { captureWindow?.hide() }
function createTodoWindow(mode: 'tray' | 'widget'): BrowserWindow {
  const isWidget = mode === 'widget'
  const window = new BrowserWindow({
    title: isWidget ? '桌面待办' : '今日待办',
    width: isWidget ? 300 : 280,
    height: isWidget ? 420 : 380,
    minWidth: 240,
    minHeight: 220,
    useContentSize: true,
    show: false,
    skipTaskbar: true,
    frame: false,
    hasShadow: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: !isBackgroundTestMode,
    backgroundColor: '#FAF8F3',
    webPreferences: sharedWebPreferences
  })
  secureWindow(window, 'todo', `/todo-${mode}`)
  if (!isBackgroundTestMode) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('closed', () => {
    if (mode === 'tray' && todoPanelWindow === window) todoPanelWindow = null
    if (mode === 'widget' && todoWidgetWindow === window) todoWidgetWindow = null
  })
  if (!isWidget) window.on('blur', () => { if (!window.isDestroyed()) window.hide() })
  loadRendererOrClose(window, `/todo-${mode}`)
  return window
}

function placeTodoPanel(window: BrowserWindow): void {
  if (!todoTray) return
  const trayBounds = todoTray.getBounds()
  const display = screen.getDisplayNearestPoint({ x: Math.round(trayBounds.x), y: Math.round(trayBounds.y) })
  const bounds = window.getBounds()
  const x = Math.round(Math.min(Math.max(trayBounds.x + trayBounds.width / 2 - bounds.width / 2, display.workArea.x + 8), display.workArea.x + display.workArea.width - bounds.width - 8))
  const y = process.platform === 'darwin' ? Math.round(trayBounds.y + trayBounds.height + 5) : Math.round(trayBounds.y - bounds.height - 5)
  window.setPosition(x, y, false)
}

export function toggleTodoPanelWindow(): void {
  const window = todoPanelWindow && !todoPanelWindow.isDestroyed() ? todoPanelWindow : (todoPanelWindow = createTodoWindow('tray'))
  if (window.isVisible()) {
    window.hide()
    return
  }
  placeTodoPanel(window)
  window.show()
  window.focus()
}

export function openTodoWidgetWindow(): void {
  const window = todoWidgetWindow && !todoWidgetWindow.isDestroyed() ? todoWidgetWindow : (todoWidgetWindow = createTodoWindow('widget'))
  if (!isBackgroundTestMode) {
    window.show()
    window.focus()
  }
  todoPanelWindow?.hide()
}

export function closeTodoWindow(webContentsId: number): void {
  const target = [todoPanelWindow, todoWidgetWindow].find((window) => window?.webContents.id === webContentsId)
  if (target && !target.isDestroyed()) target.close()
}

export function createTodoTray(): Tray | null {
  if (isBackgroundTestMode || todoTray) return todoTray
  let icon = nativeImage.createFromBuffer(Buffer.from(TODO_TRAY_ICON_PNG, 'base64'), { scaleFactor: 2 })
  if (icon.isEmpty()) icon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
  icon.setTemplateImage(process.platform === 'darwin')
  todoTray = new Tray(icon)
  todoTray.setToolTip('LY Creator OS·今日待办')
  todoTray.on('click', toggleTodoPanelWindow)
  return todoTray
}

export function destroyTodoTray(): void {
  todoTray?.destroy()
  todoTray = null
}
export function getMainWindow(): BrowserWindow | null { return mainWindow }
export function getCaptureTargetProjectId(): string | null { return captureTargetProjectId }
export function getCaptureTargetKind(): 'project_content' | 'client_feedback' | null { return captureTargetKind }

export async function openExternalSafely(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('只允许打开HTTPS链接')
  await shell.openExternal(url.toString())
}

const SCHEDULE_TRAY_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAZUlEQVR4nO2WMQ4AIAjE+P+ncXFyUchhxLQJC+rZgRjN4HN8VtX+MAipL5AJ+aXqL3Tar87pI6TiH6Hnhvo5oSoQkufv3o91LdtHqFxIBULy/DYzhFD6QBCE5PnZ/020+goBnDIAUYM02nWSbZgAAAAASUVORK5CYII='
let scheduleTray: Tray | null = null
let schedulePanelWindow: BrowserWindow | null = null
let schedulePanelOpenRequest = 0
let schedulePanelOpening = false
let schedulePanelAnchor: Electron.Rectangle | undefined
export function createSchedulePanelWindow(): BrowserWindow {
  if (schedulePanelWindow && !schedulePanelWindow.isDestroyed()) return schedulePanelWindow
  const window = new BrowserWindow({ title: '排期速览', width: 360, height: 480, useContentSize: true, show: false, skipTaskbar: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: !isBackgroundTestMode, webPreferences: sharedWebPreferences })
  schedulePanelWindow = window
  secureWindow(window, 'schedule', '/schedule-tray')
  window.on('blur', () => closeSchedulePanelWindow())
  window.on('closed', () => { if (schedulePanelWindow === window) schedulePanelWindow = null })
  loadRendererOrClose(window, '/schedule-tray')
  return window
}
/** Content-driven height only: never show, focus, or create a window from a resize request. */
export function resizeSchedulePanelWindow(height: number): void {
  const window = schedulePanelWindow
  if (!window || window.isDestroyed()) return
  const bounds = window.getBounds()
  const anchor = schedulePanelAnchor
  const area = screen.getDisplayNearestPoint(anchor ? { x: anchor.x, y: anchor.y } : { x: bounds.x, y: bounds.y }).workArea
  const nextHeight = Math.min(Math.max(200, Math.ceil(height)), 600, area.height - 16)
  if (window.getContentSize()[1] !== nextHeight) window.setContentSize(360, nextHeight, false)
  if (anchor) window.setPosition(
    Math.round(Math.max(area.x + 8, Math.min(anchor.x + anchor.width / 2 - 180, area.x + area.width - 368))),
    Math.round(Math.max(area.y + 5, Math.min(anchor.y + anchor.height + 5, area.y + area.height - nextHeight - 8)))
  )
}
export function closeSchedulePanelWindow(): void {
  schedulePanelOpenRequest += 1
  schedulePanelOpening = false
  if (schedulePanelWindow && !schedulePanelWindow.isDestroyed()) schedulePanelWindow.hide()
}
export function openMainScheduleWindow(day: string): void {
  const window = revealMainWindow()
  const send = (): void => { if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.scheduleNavigate, day) }
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
  else send()
  closeSchedulePanelWindow()
}
// A tray click only toggles its own small panel. It never reveals/navigates main.
export function toggleSchedulePanelWindow(anchor = scheduleTray?.getBounds()): void {
  if (!anchor) return
  const window = createSchedulePanelWindow()
  if (window.isVisible() || schedulePanelOpening) { closeSchedulePanelWindow(); return }
  schedulePanelAnchor = anchor
  const request = ++schedulePanelOpenRequest
  schedulePanelOpening = true
  const show = (): void => {
    if (window.isDestroyed() || request !== schedulePanelOpenRequest) return
    schedulePanelOpening = false
    const area = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea
    const size = window.getBounds()
    window.setPosition(
      Math.round(Math.max(area.x + 8, Math.min(anchor.x + anchor.width / 2 - size.width / 2, area.x + area.width - size.width - 8))),
      Math.round(Math.max(area.y + 5, Math.min(anchor.y + anchor.height + 5, area.y + area.height - size.height - 8)))
    )
    todoPanelWindow?.hide()
    if (!isBackgroundTestMode) { window.show(); window.focus() }
  }
  // Avoid displaying the initial blank BrowserWindow while the renderer loads.
  if (window.webContents.isLoadingMainFrame()) window.once('ready-to-show', show)
  else show()
}
export function createScheduleTray(): Tray | null {
  if (isBackgroundTestMode || scheduleTray) return scheduleTray
  const icon = nativeImage.createFromBuffer(Buffer.from(SCHEDULE_TRAY_ICON_PNG, 'base64'), { scaleFactor: 2 })
  icon.setTemplateImage(process.platform === 'darwin')
  scheduleTray = new Tray(icon)
  scheduleTray.setToolTip('LY Creator OS·排期')
  scheduleTray.on('click', () => toggleSchedulePanelWindow())
  return scheduleTray
}
export function destroyScheduleTray(): void { scheduleTray?.destroy(); scheduleTray = null }
