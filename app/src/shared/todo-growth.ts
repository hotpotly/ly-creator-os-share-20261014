import { DEFAULT_TODO_CATEGORY_WEIGHTS, TODO_CATEGORY_ORDER, type TodoCategory, type TodoItem } from './domain'

const DEFAULT_ESTIMATED_MINUTES = 30

export const TODO_GROWTH_GROUP_WEIGHTS = {
  workAi: 0.5,
  life: 0.2,
  health: 0.3
} as const

type TodoGrowthGroup = keyof typeof TODO_GROWTH_GROUP_WEIGHTS

const categoryGroup: Record<TodoCategory, TodoGrowthGroup> = {
  self_media: 'workAi',
  ai: 'workAi',
  life: 'life',
  other_work: 'health'
}

const durationPattern = /半(?:个)?小时|(\d+(?:\.\d+)?)\s*(?:个)?小时|(\d+(?:\.\d+)?)\s*[hH](?![a-zA-Z])|(\d+(?:\.\d+)?)\s*分钟/g

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function parseTodoEstimatedMinutes(title: string): number | null {
  let total = 0
  let found = false
  for (const match of title.matchAll(durationPattern)) {
    found = true
    if (match[0].startsWith('半')) total += 30
    else if (match[1]) total += Number(match[1]) * 60
    else if (match[2]) total += Number(match[2]) * 60
    else if (match[3]) total += Number(match[3])
  }
  if (!found || !Number.isFinite(total) || total <= 0) return null
  return total
}

export function todoCompletionRatio(todo: TodoItem): number {
  if (todo.status === 'completed') return 1
  if (todo.status !== 'open' || todo.trackingMode !== 'progress') return 0
  return clampProgress(todo.progress) / 100
}

export interface DailyTodoGrowth {
  ratio: number
  todoCount: number
  groupRatios: Record<TodoGrowthGroup, number>
  categoryRatios: Record<TodoCategory, number>
  effectiveCategoryWeights: Record<TodoCategory, number>
}

export function calculateDailyTodoGrowth(
  todos: TodoItem[],
  today: string,
  weights: Record<TodoCategory, number> = DEFAULT_TODO_CATEGORY_WEIGHTS
): DailyTodoGrowth {
  const eligible = todos.filter((todo) => (
    !todo.isExtra && !todo.dateRange && todo.source === 'manual'
    && todo.status !== 'dismissed'
    && (todo.plannedDate === today || todo.plannedDate === null)
  ))

  if (eligible.length === 0) {
    return {
      ratio: 0,
      todoCount: 0,
      groupRatios: { workAi: 0, life: 0, health: 0 },
      categoryRatios: { self_media: 0, ai: 0, life: 0, other_work: 0 },
      effectiveCategoryWeights: { self_media: 0, ai: 0, life: 0, other_work: 0 }
    }
  }

  const totalMinutes: Record<TodoGrowthGroup, number> = { workAi: 0, life: 0, health: 0 }
  const completedMinutes: Record<TodoGrowthGroup, number> = { workAi: 0, life: 0, health: 0 }
  const categoryMinutes: Record<TodoCategory, number> = { self_media: 0, ai: 0, life: 0, other_work: 0 }
  const categoryCompletedMinutes: Record<TodoCategory, number> = { self_media: 0, ai: 0, life: 0, other_work: 0 }
  for (const todo of eligible) {
    const estimatedMinutes = parseTodoEstimatedMinutes(todo.title) ?? DEFAULT_ESTIMATED_MINUTES
    const group = categoryGroup[todo.category]
    const ratio = todoCompletionRatio(todo)
    totalMinutes[group] += estimatedMinutes
    completedMinutes[group] += estimatedMinutes * ratio
    categoryMinutes[todo.category] += estimatedMinutes
    categoryCompletedMinutes[todo.category] += estimatedMinutes * ratio
  }

  const categoryRatios: Record<TodoCategory, number> = {
    self_media: categoryMinutes.self_media === 0 ? 0 : categoryCompletedMinutes.self_media / categoryMinutes.self_media,
    ai: categoryMinutes.ai === 0 ? 0 : categoryCompletedMinutes.ai / categoryMinutes.ai,
    life: categoryMinutes.life === 0 ? 0 : categoryCompletedMinutes.life / categoryMinutes.life,
    other_work: eligible
      .filter((todo) => todo.category === 'other_work')
      .reduce((highest, todo) => Math.max(highest, todoCompletionRatio(todo)), 0)
  }
  const groupRatios: Record<TodoGrowthGroup, number> = {
    workAi: totalMinutes.workAi === 0 ? 0 : completedMinutes.workAi / totalMinutes.workAi,
    life: categoryRatios.life,
    health: categoryRatios.other_work
  }
  const activeWeight = TODO_CATEGORY_ORDER.reduce(
    (sum, category) => categoryMinutes[category] > 0 ? sum + Math.max(0, weights[category] ?? 0) : sum,
    0
  )
  const effectiveCategoryWeights = Object.fromEntries(TODO_CATEGORY_ORDER.map((category) => [
    category,
    activeWeight === 0 || categoryMinutes[category] === 0
      ? 0
      : Math.max(0, weights[category] ?? 0) / activeWeight
  ])) as Record<TodoCategory, number>
  const ratio = TODO_CATEGORY_ORDER.reduce(
    (sum, category) => sum + categoryRatios[category] * effectiveCategoryWeights[category],
    0
  )
  return {
    ratio: Math.max(0, Math.min(1, ratio)),
    todoCount: eligible.length,
    groupRatios,
    categoryRatios,
    effectiveCategoryWeights
  }
}
