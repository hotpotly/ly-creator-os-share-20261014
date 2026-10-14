import type { TaskRun } from './domain'

const ATTENTION_TASK_STATUSES: ReadonlySet<TaskRun['status']> = new Set([
  'queued',
  'running',
  'waiting_confirmation',
  'failed'
])

export function taskNeedsAttention(task: Pick<TaskRun, 'status'>): boolean {
  return ATTENTION_TASK_STATUSES.has(task.status)
}

export function countAttentionTasks(tasks: readonly Pick<TaskRun, 'status'>[]): number {
  return tasks.filter(taskNeedsAttention).length
}
