export const HOME_SPLIT_DEFAULT = 63
export const HOME_SPLIT_MIN = 46
export const HOME_SPLIT_MAX = 82
export const HOME_PRIMARY_MIN_PX = 440
// 与app.css的--home-primary-min/--home-secondary-min保持一致，改一处必须同步另一处
export const HOME_SECONDARY_MIN_PX = 240
export const HOME_SPLIT_FIXED_PX = 24

export interface HomeSplitBounds { min: number; max: number }

export function clampHomeSplit(value: number): number {
  return Math.min(HOME_SPLIT_MAX, Math.max(HOME_SPLIT_MIN, value))
}

export function homeSplitBoundsForWidth(width: number): HomeSplitBounds {
  if (width <= HOME_SPLIT_FIXED_PX + HOME_PRIMARY_MIN_PX + HOME_SECONDARY_MIN_PX) {
    return { min: HOME_SPLIT_MIN, max: HOME_SPLIT_MAX }
  }
  return {
    min: Math.max(HOME_SPLIT_MIN, (HOME_PRIMARY_MIN_PX / width) * 100),
    max: Math.min(HOME_SPLIT_MAX, ((width - HOME_SPLIT_FIXED_PX - HOME_SECONDARY_MIN_PX) / width) * 100)
  }
}

export function clampHomeSplitForWidth(value: number, width: number): number {
  const bounds = homeSplitBoundsForWidth(width)
  return Math.min(bounds.max, Math.max(bounds.min, value))
}
