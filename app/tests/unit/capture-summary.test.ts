import { describe, expect, it } from 'vitest'
import type { CaptureRecord } from '../../src/shared/domain'
import { summarizeCapturesForCreativeDay } from '../../src/shared/domain/capture-summary'

function capture(overrides: Partial<CaptureRecord>): CaptureRecord {
  return {
    id: crypto.randomUUID(),
    captureKind: 'unknown',
    primaryProjectId: null,
    referencedProjectIds: [],
    linkedTopicId: null,
    classificationStatus: 'unprocessed',
    classificationActor: null,
    classificationConfidence: null,
    suggestedContentTypeId: null,
    suggestedProjectId: null,
    classificationReason: null,
    classifiedAt: null,
    useStatus: 'active',
    discardedAt: null,
    usageType: null,
    generalCategoryId: null,
    originalContent: '测试记录',
    mobileTitle: null,
    mobileSourceApp: null,
    mobileSourceTitle: null,
    mobileSourceUrl: null,
    mobileNotes: '',
    mobileRecordingMarkersMs: [],
    mobileRecordingInterruptionReason: null,
    attachments: [],
    sourceType: 'quick_capture',
    createdAt: '2026-07-20T08:00:00.000+08:00',
    ...overrides
  }
}

describe('capture summary', () => {
  it('counts active inbox and review records only', () => {
    const result = summarizeCapturesForCreativeDay([
      capture({ classificationStatus: 'unprocessed' }),
      capture({ classificationStatus: 'suggested' }),
      capture({ classificationStatus: 'unprocessed', useStatus: 'parked' }),
      capture({ classificationStatus: 'suggested', useStatus: 'discarded' })
    ], '2026-07-20')
    expect(result).toMatchObject({ creativeDay: '2026-07-20', newRecords: 1, pendingReview: 1 })
  })

  it('uses the 04:00 creative-day cutoff for automatic processing', () => {
    const result = summarizeCapturesForCreativeDay([
      capture({ classificationStatus: 'confirmed', classificationActor: 'system', classifiedAt: '2026-07-20T03:59:00+08:00' }),
      capture({ classificationStatus: 'confirmed', classificationActor: 'system', classifiedAt: '2026-07-20T04:00:00+08:00' }),
      capture({ classificationStatus: 'confirmed', classificationActor: 'user', classifiedAt: '2026-07-20T12:00:00+08:00' }),
      capture({ classificationStatus: 'confirmed', classificationActor: 'system', classifiedAt: 'not-a-date' })
    ], '2026-07-19')
    expect(result.todayAutoProcessed).toBe(1)
    expect(summarizeCapturesForCreativeDay([
      capture({ classificationStatus: 'confirmed', classificationActor: 'system', classifiedAt: '2026-07-20T04:00:00+08:00' })
    ], '2026-07-20').todayAutoProcessed).toBe(1)
  })
})
