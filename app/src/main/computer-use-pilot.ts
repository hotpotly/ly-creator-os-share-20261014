import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PublishingHandoff } from '../shared/domain'

export const BILIBILI_COMPUTER_USE_PILOT_VERSION = 1
export const BILIBILI_COMPUTER_USE_TARGET_URL = 'https://member.bilibili.com/platform/upload/video/frame'

export const bilibiliComputerUseTaskPacketSchema = z.object({
  version: z.literal(BILIBILI_COMPUTER_USE_PILOT_VERSION),
  task: z.literal('bilibili_publish_form_assist'),
  sourceHandoffId: z.string().uuid(),
  target: z.object({
    platform: z.literal('B站'),
    url: z.literal(BILIBILI_COMPUTER_USE_TARGET_URL),
    expectedAccountName: z.string().min(1).max(120)
  }).strict(),
  fields: z.object({
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(5_000),
    tags: z.array(z.string().min(1).max(80)).min(1).max(20)
  }).strict(),
  files: z.object({
    videoPath: z.string().min(1),
    coverPath: z.string().min(1),
    subtitlePath: z.string().min(1).nullable()
  }).strict(),
  policy: z.object({
    preconditions: z.array(z.string()).min(1),
    abortConditions: z.array(z.string()).min(1),
    allowedActions: z.array(z.string()).min(1),
    forbiddenActions: z.array(z.string()).min(1),
    stopCondition: z.string().min(1)
  }).strict()
}).strict()

export type BilibiliComputerUseTaskPacket = z.infer<typeof bilibiliComputerUseTaskPacketSchema>

export function buildBilibiliComputerUseTaskPacket(input: {
  handoff: PublishingHandoff
  videoPath: string
  coverPath: string
  subtitlePath: string | null
}): BilibiliComputerUseTaskPacket {
  const { handoff } = input
  if (handoff.platform !== 'B站' || handoff.adapterId !== 'bilibili-web') throw new Error('C7只开放B站单平台试验')
  if (handoff.targetUrl !== BILIBILI_COMPUTER_USE_TARGET_URL) throw new Error('B站投稿地址已经变化，请先停用试验并检查')
  if (handoff.status !== 'prepared' || handoff.issues.length) throw new Error('请先生成可用的B站发布包')
  if (![input.videoPath, input.coverPath, input.subtitlePath].filter(Boolean).every((value) => isAbsolute(value!))) throw new Error('Computer Use文件路径必须由Main进程解析')
  return bilibiliComputerUseTaskPacketSchema.parse({
    version: BILIBILI_COMPUTER_USE_PILOT_VERSION,
    task: 'bilibili_publish_form_assist',
    sourceHandoffId: handoff.id,
    target: {
      platform: 'B站',
      url: BILIBILI_COMPUTER_USE_TARGET_URL,
      expectedAccountName: handoff.packageSnapshot.accountName
    },
    fields: {
      title: handoff.packageSnapshot.title,
      description: handoff.packageSnapshot.description,
      tags: handoff.packageSnapshot.tags
    },
    files: {
      videoPath: input.videoPath,
      coverPath: input.coverPath,
      subtitlePath: input.subtitlePath
    },
    policy: {
      preconditions: ['页面已经登录B站创作中心', '当前页面显示的账号与expectedAccountName完全一致'],
      abortConditions: ['无法确认当前登录账号', '当前账号与expectedAccountName不一致', '页面要求切换账号、重新登录或接受新授权'],
      allowedActions: ['核对当前B站账号', '仅在账号前置条件通过后上传指定视频／封面／字幕', '仅在账号前置条件通过后填写标题／简介／标签', '读取页面错误并返回App'],
      forbiddenActions: ['点击发布／提交／确认发布', '切换到其他账号', '接受新的协议或授权', '修改可见范围或商业声明'],
      stopCondition: '任何账号前置条件不满足时必须在上传和填写前立即停止；全部字段和指定文件进入页面后也必须立即停止，等待用户逐项检查并亲自点击发布'
    }
  })
}

export function serializeBilibiliComputerUseTaskPacket(packet: BilibiliComputerUseTaskPacket): string {
  return `CREATOR_OS_COMPUTER_USE_PILOT_V1\n${JSON.stringify(bilibiliComputerUseTaskPacketSchema.parse(packet), null, 2)}`
}
