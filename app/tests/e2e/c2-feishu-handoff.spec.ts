import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'

interface BrowserGlobals {
  creatorOS?: CreatorOSApi
  location: { hash: string }
}

let electronApp: ElectronApplication
let mainWindow: Page
let userDataPath = ''

async function launchApp(): Promise<void> {
  electronApp = await electron.launch({
    args: ['.'],
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CREATOR_OS_USER_DATA: userDataPath,
      CREATOR_OS_TEST_BACKGROUND: '1'
    }
  })
  mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')
  await expect.poll(() => mainWindow.evaluate(async () => {
    return (globalThis as unknown as BrowserGlobals).creatorOS?.getAppInfo().then((info) => info.name) ?? ''
  })).toBe('LY Creator OS')
}

async function setRoute(route: string): Promise<void> {
  await mainWindow.evaluate((nextRoute) => {
    (globalThis as unknown as BrowserGlobals).location.hash = nextRoute
  }, route)
}

test.beforeEach(async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  userDataPath = testInfo.outputPath('user-data')
  await rm(userDataPath, { recursive: true, force: true })
  await launchApp()
})

test.afterEach(async () => {
  await electronApp.close().catch(() => undefined)
})

test('飞书第一版只做人工交接，绑定定稿并在重启后恢复账号与原链接', async () => {
  const ids = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as BrowserGlobals).creatorOS!
    const withoutFinal = await api.createProject({
      title: '飞书未定稿项目',
      description: '没有定稿时必须阻止交接。',
      contentTypeId: 'type-ai',
      templateId: 'template-ai-tutorial',
      colorToken: 'project-8',
      platformTargets: ['B站']
    })
    const withFinal = await api.createProject({
      title: '飞书人工交接项目',
      description: '验证第一版的复制、链接和重启恢复。',
      contentTypeId: 'type-ai',
      templateId: 'template-ai-tutorial',
      colorToken: 'project-7',
      platformTargets: ['B站']
    })
    const version = await api.saveScript(
      withFinal.id,
      'final',
      '<h2>飞书交接定稿</h2><p>只复制干净正文，不自动创建文档。</p><script>不要复制我</script>'
    )
    await api.setFinalVersion(withFinal.id, version.id)
    return { withoutFinalId: withoutFinal.id, withFinalId: withFinal.id }
  })

  await setRoute(`#/workbench/${ids.withoutFinalId}`)
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await mainWindow.getByRole('button', { name: '更多文案操作' }).click()
  await mainWindow.getByRole('button', { name: '飞书交接' }).click()
  const missingFinalDialog = mainWindow.getByRole('dialog', { name: '复制定稿或导出Word' })
  await expect(missingFinalDialog.getByText('还没有定稿文案')).toBeVisible()
  await expect(missingFinalDialog.getByText('不会导出未保存的编辑内容')).toBeVisible()
  await missingFinalDialog.getByRole('button', { name: '完成' }).click()

  await setRoute(`#/workbench/${ids.withFinalId}`)
  await mainWindow.getByRole('button', { name: '更多文案操作' }).click()
  await mainWindow.getByRole('button', { name: '飞书交接' }).click()
  const dialog = mainWindow.getByRole('dialog', { name: '复制定稿或导出Word' })
  await expect(dialog.getByRole('button', { name: /新建文档/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: /合并更新/ })).toBeDisabled()
  await expect(dialog).toContainText('不会登录飞书、不会自动创建或更新文档')
  await dialog.getByLabel('飞书账号名').fill('我的飞书账号')
  await dialog.getByPlaceholder('新建后粘贴 https://…feishu.cn/docx/…').fill('https://example.feishu.cn/docx/C2Document')
  await dialog.getByRole('button', { name: '保存链接' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('飞书原文档链接已保存')
  await dialog.getByRole('button', { name: '复制定稿内容' }).click()
  await expect(mainWindow.getByRole('status')).toContainText('请在飞书手动新建文档并粘贴')
  await expect(mainWindow.getByRole('status')).not.toContainText(/已创建|已发送|已更新/)

  await mainWindow.setViewportSize({ width: 620, height: 720 })
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewport: element.ownerDocument.defaultView?.innerWidth ?? 0 }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1)
  await dialog.getByRole('button', { name: '完成' }).click()

  await electronApp.close()
  await launchApp()
  await setRoute(`#/workbench/${ids.withFinalId}`)
  await expect(mainWindow.getByRole('heading', { name: '文案', exact: true })).toBeVisible()
  await mainWindow.getByRole('button', { name: '更多文案操作' }).click()
  await mainWindow.getByRole('button', { name: '飞书交接' }).click()
  const restoredDialog = mainWindow.getByRole('dialog', { name: '复制定稿或导出Word' })
  await expect(restoredDialog.getByLabel('飞书账号名')).toHaveValue('我的飞书账号')
  await expect(restoredDialog.getByRole('button', { name: /新建文档/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(restoredDialog.getByRole('button', { name: /合并更新/ })).toBeEnabled()
  await restoredDialog.getByRole('button', { name: /合并更新/ }).click()
  await expect(restoredDialog.getByLabel('当前项目的原文档')).toContainText('我的飞书账号')
  await expect(restoredDialog.getByRole('button', { name: '打开原文档' })).toBeVisible()
  await expect(restoredDialog).toContainText('打开原链接后手动粘贴')
  await restoredDialog.getByRole('button', { name: '复制定稿内容' }).dblclick()
  await expect(mainWindow.getByRole('status')).toContainText('请打开原文档后手动合并')
  const history = await mainWindow.evaluate(async (projectId) => {
    return (globalThis as unknown as BrowserGlobals).creatorOS!.listFeishuHandoffs(projectId)
  }, ids.withFinalId)
  expect(history).toHaveLength(2)
  const original = history.find((record) => record.mode === 'new_document')!
  const merge = history.find((record) => record.mode === 'merge_update')!
  expect(merge.id).not.toBe(original.id)
  expect(merge.targetHandoffId).toBe(original.id)
  expect(merge.sourceVersionId).toBe(original.sourceVersionId)
})
