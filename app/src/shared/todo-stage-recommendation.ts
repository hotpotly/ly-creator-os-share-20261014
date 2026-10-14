import { recallTodoStage, type TodoStageMemory } from './todo-stage-memory'
import type { StageTimeKey } from './domain'

export const TODO_START_STAGE_KEYS: readonly StageTimeKey[] = ['materials', 'outline', 'script', 'shooting', 'editing']

const rules: ReadonlyArray<readonly [StageTimeKey, RegExp]> = [
  ['materials', /查资料|找资料|收集资料|整理资料|资料整理|体验记录/],
  ['outline', /大纲/],
  ['script', /文案|脚本|写稿|改稿|口播稿/],
  ['shooting', /拍摄|补拍|实拍|拍素材|拍镜头|录屏|录制画面/],
  ['editing', /粗剪|精剪|剪辑|剪片|剪(?=[\s()+＋、，,]|$)/],
  ['postproduction', /字幕|封面/],
  ['publishing', /发布|上传/],
  ['versions', /整理版本|版本整理|版本管理|版本归档/]
]

export function recommendTodoStage(title: string, projectTitle = ''): {
  stageKey: StageTimeKey | null
  reason: 'text' | 'ambiguous' | 'unknown'
} {
  let text = title.normalize('NFKC').replace(/\(\s*\d+(?:\.\d+)?\s*\)\s*$/, '').trim()
  const project = projectTitle.normalize('NFKC').trim()
  if (project) text = text.replaceAll(project, '')
  const matches = rules.filter(([, pattern]) => pattern.test(text)).map(([key]) => key)
  if (!matches.length && /(?:写|撰写).{0,30}(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万两]+|多少)字/.test(text)) matches.push('script')
  return { stageKey: matches.length === 1 ? matches[0]! : null, reason: matches.length === 1 ? 'text' : matches.length ? 'ambiguous' : 'unknown' }
}

export function recommendedTodoStageForProject(title: string, project: { id?: string; title: string; enabledModuleKeys?: readonly string[] } | undefined, memories: TodoStageMemory[] = []): StageTimeKey | null {
  if (!project?.enabledModuleKeys) return null
  const learned = recallTodoStage(title, project, memories)
  const key = learned ? learned.stageKey : recommendTodoStage(title, project.title).stageKey
  return key && project.enabledModuleKeys.includes(key) ? key : null
}
