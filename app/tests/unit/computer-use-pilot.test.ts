import { dirname, join } from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import {
  BILIBILI_COMPUTER_USE_TARGET_URL,
  bilibiliComputerUseTaskPacketSchema,
  buildBilibiliComputerUseTaskPacket,
  serializeBilibiliComputerUseTaskPacket
} from '../../src/main/computer-use-pilot'
import { retainManagedFileFromBytes } from '../../src/main/managed-files'
import { preparePublishingPackage } from '../../src/main/publishing-adapters'
import { retainPublishingAsset } from '../../src/main/publishing-assets'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')
const clipboardSha256 = 'a'.repeat(64)

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-computer-use-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function prepareBilibiliHandoff(store: WorkspaceStore) {
  const project = store.repository.getProject('ai-browser', false)
  const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
  store.repository.setFinalVersion(project.id, final.id)
  for (const [materialKind, textValue] of [
    ['title', 'AI浏览器真实体验'],
    ['description', '这是一次真实体验。'],
    ['tags', 'AI,浏览器,效率']
  ] as const) {
    store.repository.savePublishingTextMaterial({ projectId: project.id, platform: 'B站', materialKind, textValue })
  }
  const root = dirname(store.databasePath)
  const cover = await retainPublishingAsset(root, project.id, 'cover', '封面.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  store.repository.savePublishingFileMaterial({ projectId: project.id, platform: 'B站', materialKind: 'cover', file: cover })
  const video = await retainManagedFileFromBytes(root, {
    managedDirectory: join('publishing-assets', project.id),
    sourceName: '成片.mp4',
    maximumBytes: 100
  }, new Uint8Array([0, 0, 0, 20]))
  store.repository.savePublishingFileMaterial({ projectId: project.id, platform: 'B站', materialKind: 'video', file: video.file })
  const account = store.repository.savePublishingAccount({ platform: 'B站', accountName: 'LY数码', positioning: '数码长视频' })
  store.repository.selectPublishingAccount(project.id, 'B站', account.id)
  const handoff = store.repository.createPublishingHandoff(preparePublishingPackage(
    store.repository.getProject(project.id, false),
    'B站',
    store.repository.getSelectedPublishingAccount(project.id, 'B站')
  ))
  return { handoff, projectId: project.id }
}

describe('B站Computer Use试验', () => {
  it('只生成上传与填写任务包，并明确禁止最终发布', async () => {
    const { store, directory } = await createStore()
    const { handoff } = await prepareBilibiliHandoff(store)
    const packet = buildBilibiliComputerUseTaskPacket({
      handoff,
      videoPath: join(directory, '成片.mp4'),
      coverPath: join(directory, '封面.png'),
      subtitlePath: null
    })

    expect(packet.target).toEqual({
      platform: 'B站',
      url: BILIBILI_COMPUTER_USE_TARGET_URL,
      expectedAccountName: 'LY数码'
    })
    expect(packet.policy.allowedActions.some((action) => action.includes('填写标题／简介／标签'))).toBe(true)
    expect(packet.policy.preconditions).toContain('当前页面显示的账号与expectedAccountName完全一致')
    expect(packet.policy.abortConditions).toContain('当前账号与expectedAccountName不一致')
    expect(packet.policy.forbiddenActions).toContain('点击发布／提交／确认发布')
    expect(packet.policy.stopCondition).toContain('在上传和填写前立即停止')
    expect(packet.policy.stopCondition).toContain('等待用户逐项检查并亲自点击发布')
    const serialized = serializeBilibiliComputerUseTaskPacket(packet)
    expect(serialized).toMatch(/^CREATOR_OS_COMPUTER_USE_PILOT_V1\n/)
    expect(bilibiliComputerUseTaskPacketSchema.parse(JSON.parse(serialized.split('\n').slice(1).join('\n')))).toEqual(packet)

    expect(() => buildBilibiliComputerUseTaskPacket({
      handoff: { ...handoff, platform: '小红书' },
      videoPath: join(directory, '成片.mp4'),
      coverPath: join(directory, '封面.png'),
      subtitlePath: null
    })).toThrow('只开放B站')
    expect(() => buildBilibiliComputerUseTaskPacket({
      handoff: { ...handoff, targetUrl: 'https://example.com' },
      videoPath: join(directory, '成片.mp4'),
      coverPath: join(directory, '封面.png'),
      subtitlePath: null
    })).toThrow('投稿地址已经变化')
    expect(() => buildBilibiliComputerUseTaskPacket({
      handoff,
      videoPath: '成片.mp4',
      coverPath: join(directory, '封面.png'),
      subtitlePath: null
    })).toThrow('必须由Main进程解析')
    store.close()
  })

  it('按准备、打开页面、等待检查推进，并支持取消未完成试验', async () => {
    const { store } = await createStore()
    const { handoff, projectId } = await prepareBilibiliHandoff(store)
    const prepared = store.repository.createPublishingComputerUsePilot(handoff.id, clipboardSha256)
    expect(prepared).toMatchObject({ projectId, handoffId: handoff.id, platform: 'B站', status: 'prepared', accountName: 'LY数码' })
    expect(store.repository.createPublishingComputerUsePilot(handoff.id, clipboardSha256).id).toBe(prepared.id)
    expect(store.repository.getPublishingComputerUsePilotClipboardSha256(prepared.id)).toBe(clipboardSha256)

    const opened = store.repository.markPublishingComputerUsePilotPageOpened(prepared.id)
    expect(opened.status).toBe('page_opened')
    expect(opened.openedAt).toBeTruthy()
    const ready = store.repository.markPublishingComputerUsePilotReady(prepared.id)
    expect(ready.status).toBe('ready_for_review')
    expect(ready.readyForReviewAt).toBeTruthy()
    expect(() => store.repository.createPublishingHandoff(preparePublishingPackage(
      store.repository.getProject(projectId, false),
      'B站',
      store.repository.getSelectedPublishingAccount(projectId, 'B站')
    ))).toThrow('已有Computer Use试验')
    expect(store.repository.completePublishingComputerUsePilotForHandoff(handoff.id)?.status).toBe('completed')
    expect(store.repository.stopPublishingComputerUsePilot(prepared.id, 'canceled').status).toBe('completed')

    const secondHandoff = store.repository.createPublishingHandoff(preparePublishingPackage(
      store.repository.getProject(projectId, false),
      'B站',
      store.repository.getSelectedPublishingAccount(projectId, 'B站')
    ))
    const secondPilot = store.repository.createPublishingComputerUsePilot(secondHandoff.id, clipboardSha256)
    expect(store.repository.stopPublishingComputerUsePilot(secondPilot.id, 'canceled').status).toBe('canceled')
    expect(() => store.repository.markPublishingComputerUsePilotReady(secondPilot.id)).toThrow('请先打开')
    const supersededHandoff = store.repository.createPublishingHandoff(preparePublishingPackage(
      store.repository.getProject(projectId, false),
      'B站',
      store.repository.getSelectedPublishingAccount(projectId, 'B站')
    ))
    store.repository.createPublishingHandoff(preparePublishingPackage(
      store.repository.getProject(projectId, false),
      'B站',
      store.repository.getSelectedPublishingAccount(projectId, 'B站')
    ))
    expect(() => store.repository.createPublishingComputerUsePilot(supersededHandoff.id, clipboardSha256)).toThrow('不是最新版本')
    expect(store.repository.getProject(projectId, false).publishingComputerUsePilots.map((pilot) => pilot.status)).toEqual(['canceled', 'completed'])
    store.close()
  })
})
