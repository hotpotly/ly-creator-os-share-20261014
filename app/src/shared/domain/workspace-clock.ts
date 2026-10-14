import { localDateForInstant, normalizeCreationDay } from './coarse-time'

export function shouldRefreshWorkspaceClock(
  snapshotToday: string,
  snapshotCreativeDay: string,
  instant = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): boolean {
  return localDateForInstant(instant, timeZone) !== snapshotToday
    || normalizeCreationDay(instant, timeZone).localDate !== snapshotCreativeDay
}
