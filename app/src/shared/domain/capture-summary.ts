import type { CaptureRecord, CaptureSummary } from '../domain'
import { normalizeCreationDay } from './coarse-time'

export function summarizeCapturesForCreativeDay(
  captures: CaptureRecord[],
  creativeDay: string,
  timeZone = 'Asia/Shanghai'
): CaptureSummary {
  return captures.reduce<CaptureSummary>((summary, capture) => {
    if (capture.useStatus !== 'active') return summary
    if (capture.classificationStatus === 'unprocessed') summary.newRecords += 1
    if (capture.classificationStatus === 'suggested') summary.pendingReview += 1
    const classifiedInstant = capture.classifiedAt ? new Date(capture.classifiedAt) : null
    if (
      capture.classificationStatus === 'confirmed'
      && capture.classificationActor === 'system'
      && classifiedInstant
      && Number.isFinite(classifiedInstant.getTime())
      && normalizeCreationDay(classifiedInstant, timeZone).localDate === creativeDay
    ) summary.todayAutoProcessed += 1
    return summary
  }, { creativeDay, newRecords: 0, pendingReview: 0, todayAutoProcessed: 0 })
}
