import { session, type BrowserWindow, type Event, type IpcMainInvokeEvent } from 'electron'
import { isSameRendererDocument } from './security-origin'

export type WindowRole = 'main' | 'capture' | 'todo' | 'schedule'

interface TrustedRenderer {
  role: WindowRole
  documentUrl: string
}

const trustedRenderers = new Map<number, TrustedRenderer>()

export function assertTrustedSender(event: IpcMainInvokeEvent, allowedRoles: readonly WindowRole[]): WindowRole {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('拒绝来自非主Frame的IPC请求')

  const trusted = trustedRenderers.get(event.sender.id)
  if (!trusted || !allowedRoles.includes(trusted.role)) {
    throw new Error('拒绝来自未登记窗口或越权窗口的IPC请求')
  }
  if (!isSameRendererDocument(event.senderFrame.url, trusted.documentUrl)) {
    throw new Error(`拒绝来自非受信Renderer文档的请求：${event.senderFrame.url || 'unknown'}`)
  }
  return trusted.role
}

export function hardenWindow(window: BrowserWindow, role: WindowRole, documentUrl: string): void {
  trustedRenderers.set(window.webContents.id, { role, documentUrl })
  window.webContents.once('destroyed', () => trustedRenderers.delete(window.webContents.id))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event: Event, url: string) => {
    if (!isSameRendererDocument(url, documentUrl)) event.preventDefault()
  })
}

export function configurePermissionPolicy(): void {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
}
