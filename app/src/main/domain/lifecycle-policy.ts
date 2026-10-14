import type {
  ProjectStatus,
  TopicRecord,
  TopicStageDefinition,
  TopicStageRole
} from '../../shared/domain'

export type ProjectLifecycleTarget = Exclude<TopicStageRole, 'standard'>
export type ProjectLifecycleTransitionAction =
  | { type: 'set'; lifecycle: Exclude<ProjectLifecycleTarget, 'shelved'> }
  | { type: 'trash' }
  | { type: 'restore' }
  | { type: 'permanently_delete' }

export interface ProjectLifecycleTransitionInput {
  action: ProjectLifecycleTransitionAction
  projectStatus: ProjectStatus
  topicStageRole: TopicStageRole | null
  trashedAt: string | null
  hasBusinessData?: boolean
}

export interface ProjectLifecycleTransitionDecision {
  noOp: boolean
  targetRole: ProjectLifecycleTarget
  normalizeLegacyArchivedProject: boolean
  recordActualCompletion: boolean
}

export function deriveTopicNextAction(
  stages: TopicStageDefinition[],
  stageId: string,
  createdProjectId: string | null
): Pick<TopicRecord, 'nextActionKind' | 'nextStageId'> {
  const stage = stages.find((item) => item.id === stageId)
  if (!stage) throw new Error('选题阶段配置为空')
  const standardStages = stages.filter((item) => item.role === 'standard')
  const standardIndex = standardStages.findIndex((item) => item.id === stage.id)
  const nextStage = standardIndex >= 0 ? standardStages[standardIndex + 1] ?? null : null
  // project_created且createdProjectId为空的组合正常流程不会出现（永久删除会把阶段改为shelved），
  // create_project分支仅作为数据被外部改坏时的防御回退。
  const nextActionKind: TopicRecord['nextActionKind'] = stage.role === 'project_created'
    ? createdProjectId ? 'open_project' : 'create_project'
    : ['completed', 'archived', 'shelved'].includes(stage.role)
      ? 'restart_project'
      : nextStage
        ? 'advance_stage'
        : 'create_project'
  return {
    nextActionKind,
    nextStageId: nextActionKind === 'advance_stage' ? nextStage?.id ?? null : null
  }
}

export function requireLifecycleStage(
  stages: TopicStageDefinition[],
  role: ProjectLifecycleTarget
): TopicStageDefinition {
  const stage = stages.find((item) => item.role === role)
  if (!stage) throw new Error(`缺少${role}系统阶段`)
  return stage
}

export function decideProjectLifecycleTransition(
  input: ProjectLifecycleTransitionInput
): ProjectLifecycleTransitionDecision {
  const { action } = input
  if (action.type === 'set') {
    if (input.trashedAt) throw new Error('项目已在回收站，请先恢复')
    const normalizeLegacyArchivedProject = action.lifecycle === 'project_created' && input.projectStatus === 'archived'
    return {
      noOp: input.topicStageRole === action.lifecycle && !normalizeLegacyArchivedProject,
      targetRole: action.lifecycle,
      normalizeLegacyArchivedProject,
      recordActualCompletion: action.lifecycle === 'completed'
    }
  }
  if (action.type === 'trash') {
    return {
      noOp: Boolean(input.trashedAt),
      targetRole: 'shelved',
      normalizeLegacyArchivedProject: false,
      recordActualCompletion: false
    }
  }
  if (action.type === 'restore') {
    return {
      noOp: !input.trashedAt,
      targetRole: 'project_created',
      normalizeLegacyArchivedProject: input.projectStatus === 'archived',
      recordActualCompletion: false
    }
  }
  if (!input.trashedAt) throw new Error('项目必须先移入回收站')
  if (input.hasBusinessData) throw new Error('已有商务记录，不能永久删除；请恢复后在选题管理中改为已归档')
  return {
    noOp: false,
    targetRole: 'shelved',
    normalizeLegacyArchivedProject: false,
    recordActualCompletion: false
  }
}

export function shouldUpdateTopicExpectedCompletion(
  source: 'topic_deadline_marker' | 'hard_deadline_item' | 'schedule_item'
): boolean {
  // 只有选题旗帜和项目目标日可以回写同一日期事实；普通排期不得改写。
  return source === 'topic_deadline_marker' || source === 'hard_deadline_item'
}

export const lifecyclePolicy = {
  deriveTopicNextAction,
  requireLifecycleStage,
  decideProjectLifecycleTransition,
  shouldUpdateTopicExpectedCompletion
}
