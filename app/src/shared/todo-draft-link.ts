import { recommendedTodoStageForProject } from './todo-stage-recommendation'
import type { TodoStageMemory } from './todo-stage-memory'
import type { StageTimeKey } from './domain'

export function draftProjectPatch(draft: { title?: string; projectId: string | null; stageKey?: StageTimeKey | null }, projectId: string | null, project?: { id?: string; title: string; enabledModuleKeys?: readonly string[] }, memories: TodoStageMemory[] = []): { projectId: string | null; stageKey: StageTimeKey | null } {
  return { projectId, stageKey: projectId ? projectId === draft.projectId ? draft.stageKey ?? null : draft.title ? recommendedTodoStageForProject(draft.title, project, memories) : null : null }
}

export function retainDraftOverrides<T>(overrides: Record<string, T>, keys: readonly string[]): Record<string, T> {
  const valid = new Set(keys)
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => valid.has(key)))
}
