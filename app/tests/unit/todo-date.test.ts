import { describe, expect, it } from 'vitest'
import type { TodoItem } from '../../src/shared/domain'
import { todoVisibleOnDate } from '../../src/shared/todo-date'

function todo(patch: Partial<TodoItem>): TodoItem {
  return {
    id: patch.id ?? crypto.randomUUID(),
    title: patch.title ?? '待办',
    plannedDate: 'plannedDate' in patch ? (patch.plannedDate ?? null) : '2026-07-28',
    segment: patch.segment ?? null,
    category: patch.category ?? 'self_media',
    projectId: patch.projectId ?? null,
    status: patch.status ?? 'open',
    trackingMode: patch.trackingMode ?? 'checklist',
    progress: patch.progress ?? 0,
    progressBeforeComplete: patch.progressBeforeComplete ?? null,
    source: patch.source ?? 'manual',
    sourceScheduleId: patch.sourceScheduleId ?? null,
    sourcePlannedDate: patch.sourcePlannedDate ?? null,
    sourceSegment: patch.sourceSegment ?? null,
    scheduleSyncEnabled: patch.scheduleSyncEnabled ?? false,
    completedAt: patch.completedAt ?? null,
    dismissedAt: patch.dismissedAt ?? null,
    createdAt: patch.createdAt ?? '2026-07-28T00:00:00.000Z',
    updatedAt: patch.updatedAt ?? '2026-07-28T00:00:00.000Z'
  }
}

describe('todo date visibility', () => {
  it('keeps unfinished dated todos on their original day instead of carrying them into today', () => {
    const yesterday = todo({ plannedDate: '2026-07-28', status: 'open' })
    expect(todoVisibleOnDate(yesterday, '2026-07-28', '2026-07-29')).toBe(true)
    expect(todoVisibleOnDate(yesterday, '2026-07-29', '2026-07-29')).toBe(false)
  })

  it('shows today tasks today and keeps future tasks on their planned dates', () => {
    const today = todo({ plannedDate: '2026-07-29' })
    const tomorrow = todo({ plannedDate: '2026-07-30' })
    expect(todoVisibleOnDate(today, '2026-07-29', '2026-07-29')).toBe(true)
    expect(todoVisibleOnDate(tomorrow, '2026-07-29', '2026-07-29')).toBe(false)
    expect(todoVisibleOnDate(tomorrow, '2026-07-30', '2026-07-29')).toBe(true)
  })

  it('keeps an undated manual capture visible today without inventing a historical date', () => {
    const undated = todo({ plannedDate: null, source: 'manual' })
    expect(todoVisibleOnDate(undated, '2026-07-29', '2026-07-29')).toBe(true)
    expect(todoVisibleOnDate(undated, '2026-07-28', '2026-07-29')).toBe(false)
  })

  it('keeps a dated item only on its planned day when it is completed later', () => {
    const completed = todo({
      plannedDate: '2026-07-28',
      status: 'completed',
      completedAt: '2026-07-29T09:30:00.000Z'
    })
    expect(todoVisibleOnDate(completed, '2026-07-28', '2026-07-29')).toBe(true)
    expect(todoVisibleOnDate(completed, '2026-07-29', '2026-07-29')).toBe(false)
  })

  it('keeps an undated manual item on its completion day after it is checked', () => {
    const completed = todo({
      plannedDate: null,
      status: 'completed',
      completedAt: '2026-07-29T09:30:00.000Z'
    })
    expect(todoVisibleOnDate(completed, '2026-07-28', '2026-07-29')).toBe(false)
    expect(todoVisibleOnDate(completed, '2026-07-29', '2026-07-29')).toBe(true)
  })
})
