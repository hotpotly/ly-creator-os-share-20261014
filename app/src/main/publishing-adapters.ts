import { PUBLISHING_PLATFORM_CAPABILITIES, platformTitleLimit, type ProjectDetail, type PublishingAccount, type PublishingHandoff, type PublishingPlatformCapability } from '../shared/domain'

export type PublishingAdapter = PublishingPlatformCapability
export const PUBLISHING_ADAPTERS = PUBLISHING_PLATFORM_CAPABILITIES

export const SUPPORTED_PUBLISHING_PLATFORMS = PUBLISHING_ADAPTERS.map((adapter) => adapter.platform)

function material(project: ProjectDetail, platform: string, kind: 'title' | 'description' | 'tags' | 'cover' | 'subtitle' | 'video') {
  return project.publishingMaterials.find((item) => item.platform === platform && item.materialKind === kind)
}

export function preparePublishingPackage(project: ProjectDetail, platform: string, account: PublishingAccount | null = null): Omit<PublishingHandoff, 'id' | 'status' | 'openedAt' | 'confirmedAt' | 'createdAt' | 'updatedAt'> {
  const adapter = PUBLISHING_ADAPTERS.find((item) => item.platform === platform)
  if (!adapter) throw new Error('该平台暂不支持发布交接')
  const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
  const title = material(project, platform, 'title')
  const description = material(project, platform, 'description')
  const tags = material(project, platform, 'tags')
  const cover = material(project, platform, 'cover')
  const subtitle = material(project, platform, 'subtitle')
  const video = material(project, platform, 'video')
  const issues: string[] = []
  if (!account) issues.push('请先选择发布账号')
  else if (account.status !== 'active') issues.push('所选发布账号已停用')
  if (!finalVersion) issues.push('请先设置文案定稿')
  if (!title?.textValue?.trim()) issues.push('请先补齐标题')
  if (!description?.textValue?.trim()) issues.push('请先补齐简介')
  if (!tags?.textValue?.trim()) issues.push('请先补齐标签')
  if (!cover?.fileId || !cover.fileName) issues.push('请先选择封面')
  if (!video?.fileId || !video.fileName) issues.push('请先关联要发布的视频')
  for (const item of [title, description, tags, cover].filter(Boolean)) {
    if (finalVersion && item?.sourceVersionId !== finalVersion.id) { issues.push('存在基于旧稿的必需物料'); break }
  }
  const titleLimit = platformTitleLimit(adapter.platform)
  if (titleLimit && (title?.textValue?.trim().length ?? 0) > titleLimit) issues.push(`标题超过${titleLimit}字的本地预检上限`)
  const tagList = (tags?.textValue ?? '').split(/[,，#\n]+/).map((item) => item.trim()).filter(Boolean)
  return {
    projectId: project.id,
    platform,
    adapterId: adapter.id,
    targetUrl: adapter.targetUrl,
    packageSnapshot: {
      title: title?.textValue?.trim() ?? '',
      description: description?.textValue?.trim() ?? '',
      tags: tagList,
      coverFileId: cover?.fileId ?? '',
      coverFileName: cover?.fileName ?? '',
      subtitleFileId: subtitle?.fileId ?? null,
      subtitleFileName: subtitle?.fileName ?? null,
      videoFileId: video?.fileId ?? '',
      videoFileName: video?.fileName ?? '',
      accountId: account?.id ?? '',
      accountName: account?.accountName ?? '',
      sourceVersionId: finalVersion?.id ?? ''
    },
    checklist: [`确认当前网页账号为${account?.accountName || '所选账号'}`, '在Finder中核对视频、封面与字幕文件', ...adapter.checklist, '网页内必须由你最后确认并点击发布'],
    issues: [...new Set(issues)]
  }
}

export function publishingClipboardText(handoff: PublishingHandoff): string {
  const value = handoff.packageSnapshot
  return [`【${handoff.platform}发布包】`, `标题：${value.title}`, '', value.description, '', `标签：${value.tags.map((tag) => `#${tag}`).join(' ')}`].join('\n')
}

export function publishingFieldText(handoff: PublishingHandoff, field: 'title' | 'description' | 'tags'): string {
  if (field === 'title') return handoff.packageSnapshot.title
  if (field === 'description') return handoff.packageSnapshot.description
  return handoff.packageSnapshot.tags.map((tag) => `#${tag}`).join(' ')
}

export function assertPublishingHandoffCurrent(
  handoff: PublishingHandoff,
  current: Omit<PublishingHandoff, 'id' | 'status' | 'openedAt' | 'confirmedAt' | 'createdAt' | 'updatedAt'>
): void {
  if (current.issues.length) throw new Error(`发布包已过期：${current.issues.join('；')}。请重新检查发布包`)
  if (
    current.adapterId !== handoff.adapterId ||
    current.targetUrl !== handoff.targetUrl ||
    JSON.stringify(current.packageSnapshot) !== JSON.stringify(handoff.packageSnapshot)
  ) throw new Error('发布包已过期：定稿、账号或发布物料已变化，请重新检查发布包')
}
