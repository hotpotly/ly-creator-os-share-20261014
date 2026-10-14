export const DEFAULT_BUSINESS_PLATFORMS = ['B站', '小红书', '抖音', '油管', '线下直签', '其他'] as const

const BUSINESS_PLATFORM_ALIASES: Record<string, string> = {
  B站花火: 'B站',
  花火: 'B站',
  小红书蒲公英: '小红书',
  蒲公英: '小红书',
  抖音星图: '抖音',
  星图: '抖音',
  YouTube: '油管',
  youtube: '油管'
}

const REMOVED_BUSINESS_PLATFORMS = new Set(['微信', '淘宝／天猫', '淘宝/天猫', '淘宝天猫'])

export function normalizeBusinessPlatform(value: string): string {
  const trimmed = value.trim()
  return BUSINESS_PLATFORM_ALIASES[trimmed] ?? trimmed
}

export function normalizeBusinessPlatforms(values: readonly string[]): string[] {
  const normalized = values
    .map(normalizeBusinessPlatform)
    .filter((value) => value && !REMOVED_BUSINESS_PLATFORMS.has(value))
  const preferred = DEFAULT_BUSINESS_PLATFORMS.filter((value) => normalized.includes(value) || ['B站', '小红书', '抖音', '油管'].includes(value))
  return [...new Set([...preferred, ...normalized])]
}
