import { describe, expect, it } from 'vitest'
import type { TodoItem } from '../../src/shared/domain'
import { calculateDailyTodoGrowth, parseTodoEstimatedMinutes } from '../../src/shared/todo-growth'

function todo(patch: Partial<TodoItem>): TodoItem {
  return {
    id: patch.id ?? crypto.randomUUID(),
    title: patch.title ?? '普通待办',
    plannedDate: patch.plannedDate ?? '2026-07-28',
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

describe('daily todo growth', () => {
  it('keeps an empty day at zero instead of treating missing todos as completed', () => {
    expect(calculateDailyTodoGrowth([], '2026-07-28')).toEqual({
      ratio: 0,
      todoCount: 0,
      groupRatios: { workAi: 0, life: 0, health: 0 },
      categoryRatios: { self_media: 0, ai: 0, life: 0, other_work: 0 },
      effectiveCategoryWeights: { self_media: 0, ai: 0, life: 0, other_work: 0 }
    })
  })

  it('parses Chinese, minute and H duration expressions and sums multiple values', () => {
    expect(parseTodoEstimatedMinutes('拍摄2小时')).toBe(120)
    expect(parseTodoEstimatedMinutes('剪辑1.5小时')).toBe(90)
    expect(parseTodoEstimatedMinutes('整理30分钟')).toBe(30)
    expect(parseTodoEstimatedMinutes('复盘半小时')).toBe(30)
    expect(parseTodoEstimatedMinutes('上午1H，下午0.5h')).toBe(90)
    expect(parseTodoEstimatedMinutes('没有写时长')).toBeNull()
  })

  it('uses explicit partial progress and completed checkmarks in the weighted ratio', () => {
    const growth = calculateDailyTodoGrowth([
      todo({ title: '写稿2小时', trackingMode: 'progress', progress: 50 }),
      todo({ title: '整理资料1H', status: 'completed', progress: 100 }),
      todo({ title: '拍摄1小时' })
    ], '2026-07-28')

    expect(growth.ratio).toBeCloseTo(0.5)
    expect(growth.groupRatios).toMatchObject({ workAi: 0.5, life: 0, health: 0 })
    expect(growth.todoCount).toBe(3)
  })

  it('counts today and undated manual todos while excluding old, future and schedule rows', () => {
    const growth = calculateDailyTodoGrowth([
      todo({ title: '今天完成1小时', status: 'completed' }),
      todo({ title: '随手完成1小时', plannedDate: null, status: 'completed' }),
      todo({ title: '历史积压4小时', plannedDate: '2026-07-27', status: 'completed' }),
      todo({ title: '明天任务4小时', plannedDate: '2026-07-29', status: 'completed' }),
      todo({ title: '排期投影4小时', source: 'schedule', status: 'completed' })
    ], '2026-07-28')

    expect(growth.todoCount).toBe(2)
    expect(growth.ratio).toBe(1)
  })

  it('keeps work and AI in 50%, life in 20%, and health in 30% when all groups are present', () => {
    const growth = calculateDailyTodoGrowth([
      todo({ title: '完成工作1小时', status: 'completed', category: 'self_media' }),
      todo({ title: '完成AI任务1小时', status: 'completed', category: 'ai' }),
      ...Array.from({ length: 10 }, (_, index) => todo({
        title: `生活事项${index + 1}`,
        status: index === 0 ? 'completed' : 'open',
        category: 'life'
      })),
      todo({ title: '健康打卡', status: 'completed', category: 'other_work' })
    ], '2026-07-28')

    expect(growth.groupRatios).toMatchObject({ workAi: 1, life: 0.1, health: 1 })
    expect(growth.ratio).toBeCloseTo(0.82)
  })

  it('lets any completed health item fill the health pool while partial progress remains live', () => {
    const completed = calculateDailyTodoGrowth([
      todo({ title: '跑步30分钟', status: 'completed', category: 'other_work' }),
      todo({ title: '拉伸30分钟', status: 'open', category: 'other_work' })
    ], '2026-07-28')
    expect(completed.groupRatios.health).toBe(1)
    expect(completed.ratio).toBe(1)

    const partial = calculateDailyTodoGrowth([
      todo({ title: '运动30分钟', trackingMode: 'progress', progress: 60, category: 'other_work' })
    ], '2026-07-28')
    expect(partial.groupRatios.health).toBe(0.6)
    expect(partial.ratio).toBeCloseTo(0.6)
  })

  it('normalizes the available weight across only the groups present today', () => {
    expect(calculateDailyTodoGrowth([
      todo({ title: '所有生活待办完成', status: 'completed', category: 'life' })
    ], '2026-07-28').ratio).toBe(1)
    expect(calculateDailyTodoGrowth([
      todo({ title: '健康打卡完成', status: 'completed', category: 'other_work' })
    ], '2026-07-28').ratio).toBe(1)

    const mixed = calculateDailyTodoGrowth([
      todo({ title: '生活事项完成', status: 'completed', category: 'life' }),
      todo({ title: '健康事项未完成', category: 'other_work' })
    ], '2026-07-28')
    expect(mixed.ratio).toBeCloseTo(0.4)
  })

  it('removes absent AI work and lets the remaining categories fill the full day', () => {
    const growth = calculateDailyTodoGrowth([
      todo({ title: '完成自媒体工作', status: 'completed', category: 'self_media' }),
      todo({ title: '生活事项未完成', category: 'life' }),
      todo({ title: '健康事项未完成', category: 'other_work' })
    ], '2026-07-28')

    expect(growth.effectiveCategoryWeights).toMatchObject({
      self_media: 0.375,
      ai: 0,
      life: 0.25,
      other_work: 0.375
    })
    expect(growth.ratio).toBeCloseTo(0.375)
  })

  it('lets the only category present take the full day regardless of its configured share', () => {
    const growth = calculateDailyTodoGrowth([
      todo({ title: '唯一工作', trackingMode: 'progress', progress: 60, category: 'self_media' })
    ], '2026-07-28', {
      self_media: 10,
      ai: 60,
      life: 20,
      other_work: 10
    })

    expect(growth.effectiveCategoryWeights).toMatchObject({
      self_media: 1,
      ai: 0,
      life: 0,
      other_work: 0
    })
    expect(growth.ratio).toBeCloseTo(0.6)
  })

  it('uses the saved category weights while still normalizing only categories present today', () => {
    const growth = calculateDailyTodoGrowth([
      todo({ title: '工作已完成', status: 'completed', category: 'self_media' }),
      todo({ title: '生活未完成', category: 'life' })
    ], '2026-07-28', {
      self_media: 80,
      ai: 0,
      life: 20,
      other_work: 0
    })

    expect(growth.categoryRatios).toMatchObject({ self_media: 1, life: 0 })
    expect(growth.ratio).toBeCloseTo(0.8)
  })
})
