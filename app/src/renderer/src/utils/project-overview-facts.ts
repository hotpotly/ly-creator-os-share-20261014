import type { ProjectDetail, TodoItem } from '../../../shared/domain'

/** Read-only projections; never infer hours or project completion from elapsed dates/todos. */
export function projectStageProgress(project: Pick<ProjectDetail, 'modules'>): { completed: number; total: number } {
  const stages = project.modules.filter(module => module.enabled && !['overview', 'business', 'production', 'feedback'].includes(module.key))
  return { completed: stages.filter(module => module.completedAt).length, total: stages.length }
}

export function projectOverviewFacts(project: Pick<ProjectDetail, 'modules' | 'id' | 'stageTimeRecords' | 'versions'>, todos: Pick<TodoItem, 'projectId' | 'source' | 'status'>[], today: string) {
  const start = project.stageTimeRecords.flatMap(record => record.startedAt ? [record.startedAt.localDate] : []).sort()[0] ?? null
  const elapsedDays = start ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) : null
  const linked = todos.filter(todo => todo.projectId === project.id && todo.source === 'manual' && todo.status !== 'dismissed')
  const latestVersion = [...project.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  return { ...projectStageProgress(project), start, elapsedDays, todoTotal: linked.length, todoCompleted: linked.filter(todo => todo.status === 'completed').length, versionCount: project.versions.length, latestVersion }
}
