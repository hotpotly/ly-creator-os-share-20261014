import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

type AccessProps = { deviceId: string; deviceName: string; disabled: boolean }
interface Globals { creatorOS: CreatorOSApi; mountAccess: (devices: AccessProps[]) => void }
const cwd = join(import.meta.dirname, '../..')
let app: ElectronApplication, page: Page, deviceId: string, otherId: string
let bundle: { script: string; css: string }
let pageErrors: string[] = []
test.beforeAll(async () => {
  const compiled = await build({ absWorkingDir: cwd, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {WorkspaceDeviceAccess} from './src/renderer/src/components/WorkspaceDeviceAccess'; const host=document.createElement('div'); host.id='access-fixture'; host.style.cssText='position:fixed;inset:0;overflow:auto;background:var(--surface);padding:24px;z-index:9999'; document.body.append(host); const root=createRoot(host); window.mountAccess=devices=>flushSync(()=>root.render(React.createElement('div',{className:'mobile-sync-devices',style:{maxWidth:520,margin:'0 auto'}},...devices.map((props,index)=>React.createElement('article',{key:index},React.createElement('div',null,React.createElement('b',null,props.deviceName)),React.createElement(WorkspaceDeviceAccess,props))))));`, resolveDir: cwd, loader: 'tsx' }, bundle: true, write: false, outdir: 'out/test-access', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic' })
  bundle = { script: compiled.outputFiles.find(file => file.path.endsWith('.js'))!.text, css: compiled.outputFiles.find(file => file.path.endsWith('.css'))!.text }
})
async function launch(path: string) {
  app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, NODE_ENV: 'test', CREATOR_OS_TEST_BACKGROUND: '1', CREATOR_OS_USER_DATA: path } })
  page = await app.firstWindow(); page.on('pageerror', error => pageErrors.push(error.message)); await page.waitForLoadState('domcontentloaded')
  await expect.poll(() => page.evaluate(async () => (await (globalThis as unknown as Globals).creatorOS.getWorkspace()).projects.length)).toBeGreaterThan(5)
}
test.beforeEach(async ({ browserName }, info) => {
  expect(browserName).toBe('chromium'); pageErrors = []; deviceId = randomUUID(); otherId = randomUUID()
  const path = info.outputPath('user-data'); await launch(path); await app.close()
  execFileSync(join(cwd, 'node_modules/.bin/electron'), ['-e', `const D=require('better-sqlite3'),db=new D(${JSON.stringify(join(path, 'creator-os.sqlite3'))}); const add=db.prepare("INSERT INTO mobile_sync_devices(id,name,encrypted_secret,protocol_version,identity_public_key,trust_state,created_at) VALUES(?,?,?,2,?,'trusted_v2',?)"); for(const [id,name] of ${JSON.stringify([[deviceId, '测试手机A'], [otherId, '测试手机B']])})add.run(id,name,'fake-only',Buffer.alloc(32,1).toString('base64'),'2026-10-03T00:00:00Z'); db.prepare("INSERT INTO mobile_sync_devices(id,name,encrypted_secret,created_at,trust_state,protocol_version) VALUES(?,?,?,?,'legacy_v1',1)").run('legacy-device','旧版测试手机','fake-only','2026-10-03T00:00:00Z'); add.run('revoked-device','已撤销测试手机','fake-only',Buffer.alloc(32,2).toString('base64'),'2026-10-03T00:00:00Z'); db.prepare("UPDATE mobile_sync_devices SET revoked_at=? WHERE id='revoked-device'").run('2026-10-03T01:00:00Z'); db.close();`], { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  await launch(path)
})
test.afterEach(async () => { await app?.close().catch(() => undefined); expect(pageErrors).toEqual([]) })
async function mount(devices: AccessProps[]) {
  if (await page.locator('#access-fixture').count() === 0) { await page.addStyleTag({ content: bundle.css }); await page.evaluate(bundle.script) }
  await page.evaluate(devices => (globalThis as unknown as Globals).mountAccess(devices), devices)
}
const access = (id: string) => page.evaluate(id => (globalThis as unknown as Globals).creatorOS.getWorkspaceV2Access(id), id)

test('main-only IPC exposes no automatic grants and rejects Capture access', async () => {
  expect((await access(deviceId)).grants).toEqual([])
  const invalid = await page.evaluate(async id => {
    const api = (globalThis as unknown as Globals).creatorOS, current = await api.getWorkspaceV2Access(id)
    try { await api.updateWorkspaceV2Access({ deviceId: id, expectedRevision: current.revision, grants: [{ scope: 'project.catalog', write: true }] }); return '' } catch (error) { return String(error) }
  }, deviceId)
  expect(invalid).toContain('仅可读取'); expect((await access(deviceId)).grants).toEqual([])
  await page.evaluate(async () => { await (globalThis as unknown as Globals).creatorOS.openCapture() })
  await expect.poll(() => app.windows().length).toBe(2)
  const capture = app.windows().find(window => window !== page)!
  await capture.waitForLoadState('domcontentloaded')
  const denied = await capture.evaluate(async id => {
    const api = (globalThis as unknown as Globals).creatorOS, errors: string[] = []
    try { await api.getWorkspaceV2Access(id) } catch (error) { errors.push(String(error)) }
    try { await api.updateWorkspaceV2Access({ deviceId: id, expectedRevision: 'a'.repeat(64), grants: [] }) } catch (error) { errors.push(String(error)) }
    return errors
  }, deviceId)
  expect(denied).toHaveLength(2); denied.forEach(error => expect(error).toContain('越权窗口'))
  expect((await access(deviceId)).grants).toEqual([])
})

test('independent panel confirms grants, preserves failed drafts and never saves a different device', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await mount([{ deviceId, deviceName: '测试手机A', disabled: false }, { deviceId: otherId, deviceName: '测试手机B', disabled: false }])
  await page.getByRole('button', { name: '测试手机A的工作台授权', exact: true }).click()
  const panel = page.getByRole('region', { name: '测试手机A的工作台授权设置' })
  const todo = panel.getByRole('group', { name: '待办权限', exact: true })
  await expect(todo.getByRole('button', { name: '未授权', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await panel.getByRole('group', { name: '项目目录权限', exact: true }).getByRole('button', { name: '可编辑' }).count()).toBe(0)
  await todo.getByRole('button', { name: '可编辑' }).click()
  await panel.getByRole('button', { name: '保存授权', exact: true }).click()
  expect((await access(deviceId)).grants).toEqual([])
  await expect(panel.getByRole('group', { name: '确认工作台授权' })).toContainText('手机已有副本仍会保留')
  await page.evaluate(async id => {
    const api = (globalThis as unknown as Globals).creatorOS, saved = await api.getWorkspaceV2Access(id)
    await api.updateWorkspaceV2Access({ deviceId: id, expectedRevision: saved.revision, grants: [{ scope: 'todo.full', write: false }] })
  }, deviceId)
  await panel.getByRole('button', { name: '确认授权', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('其他窗口')
  await expect(todo.getByRole('button', { name: '可编辑' })).toHaveAttribute('aria-pressed', 'true')
  expect((await access(deviceId)).grants).toEqual([{ scope: 'todo.full', write: false }])
  expect((await access(otherId)).grants).toEqual([])
  await panel.getByRole('button', { name: '返回', exact: true }).click()
  await panel.getByRole('button', { name: '重新载入', exact: true }).click()
  await expect(todo.getByRole('button', { name: '只读', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await todo.getByRole('button', { name: '可编辑' }).click()
  await panel.getByRole('button', { name: '保存授权', exact: true }).click()
  await panel.getByRole('button', { name: '确认授权', exact: true }).click()
  await expect(panel.getByRole('button', { name: '保存授权', exact: true })).toBeDisabled()
  expect((await access(deviceId)).grants).toEqual([{ scope: 'todo.full', write: true }])
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.visualStyle = 'warm'; document.documentElement.dataset.theme = theme }, theme)
    await page.setViewportSize({ width: 420, height: 640 })
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    if (theme === 'light') await page.locator('#access-fixture').screenshot({ path: info.outputPath('workspace-access.png') })
  }
  await mount([{ deviceId: otherId, deviceName: '测试手机B', disabled: false }])
  await expect(page.getByRole('region', { name: '测试手机A的工作台授权设置' })).toHaveCount(0)
  await page.getByRole('button', { name: '测试手机B的工作台授权', exact: true }).click()
  const other = page.getByRole('region', { name: '测试手机B的工作台授权设置' })
  await expect(other.getByRole('group', { name: '待办权限', exact: true }).getByRole('button', { name: '未授权', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await other.getByRole('group', { name: '待办权限', exact: true }).getByRole('button', { name: '可编辑' }).click()
  await page.evaluate(async id => { await (globalThis as unknown as Globals).creatorOS.revokeMobileSyncDevice(id) }, otherId)
  await other.getByRole('button', { name: '保存授权', exact: true }).click()
  await other.getByRole('button', { name: '确认授权', exact: true }).click()
  await expect(other.getByRole('alert')).toContainText('设备已撤销')
  await expect(other.getByRole('group', { name: '待办权限', exact: true }).getByRole('button', { name: '可编辑' })).toHaveAttribute('aria-pressed', 'true')
  expect((await access(deviceId)).grants).toEqual([{ scope: 'todo.full', write: true }])
})


test('settings navigation exposes explicit independent grants only for trusted v2 devices', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '当前设置分类：通用' }).click()
  await page.getByRole('menuitemradio', { name: '数据与设备' }).click()
  const settings = page.locator('.mobile-sync-settings')
  await settings.getByRole('button', { name: '开启局域网接收', exact: true }).click()
  await expect(settings.getByText('已信任设备', { exact: true })).toBeVisible()
  await expect(settings.getByText('旧版测试手机', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: '旧版测试手机的工作台授权' })).toHaveCount(0)
  await expect(settings.getByText('已撤销测试手机', { exact: true })).toHaveCount(0)
  await expect(settings.getByRole('button', { name: '已撤销测试手机的工作台授权' })).toHaveCount(0)
  expect((await access(deviceId)).grants).toEqual([])
  expect((await access(otherId)).grants).toEqual([])
  await settings.getByRole('button', { name: '测试手机A的工作台授权', exact: true }).click()
  const panel = settings.getByRole('region', { name: '测试手机A的工作台授权设置' })
  const todo = panel.getByRole('group', { name: '待办权限', exact: true })
  await expect(todo.getByRole('button', { name: '未授权', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await todo.getByRole('button', { name: '可编辑', exact: true }).click()
  await panel.getByRole('button', { name: '保存授权', exact: true }).click()
  expect((await access(deviceId)).grants).toEqual([])
  await expect(panel.getByRole('group', { name: '确认工作台授权' })).toBeVisible()
  await panel.getByRole('button', { name: '确认授权', exact: true }).click()
  await expect(panel.getByRole('button', { name: '保存授权', exact: true })).toBeDisabled()
  expect((await access(deviceId)).grants).toEqual([{ scope: 'todo.full', write: true }])
  expect((await access(otherId)).grants).toEqual([])
  await settings.getByRole('button', { name: '测试手机B的工作台授权', exact: true }).click()
  const other = settings.getByRole('region', { name: '测试手机B的工作台授权设置' })
  await expect(other.getByRole('group', { name: '待办权限', exact: true }).getByRole('button', { name: '未授权', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await settings.getByRole('button', { name: '测试手机B的工作台授权', exact: true }).click()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.visualStyle = 'warm'; document.documentElement.dataset.theme = theme }, theme)
    await page.setViewportSize({ width: 880, height: 720 })
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeInViewport()
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    for (const button of await panel.getByRole('button').all()) {
      const box = await button.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(881)
    }
    await settings.screenshot({ path: info.outputPath(`settings-workspace-access-${theme}.png`) })
  }
  await settings.getByRole('button', { name: '停止接收', exact: true }).click()
  expect((await access(deviceId)).grants).toEqual([{ scope: 'todo.full', write: true }])
  expect((await access(otherId)).grants).toEqual([])
})
