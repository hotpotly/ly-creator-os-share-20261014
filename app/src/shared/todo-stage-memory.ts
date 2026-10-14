import { MODULE_KEYS, type StageTimeKey } from './domain'

export interface TodoStageMemory {
  title: string
  action: string
  projectId: string
  stageKey: StageTimeKey | null
  updatedAt: string
}

export function normalizeTodoAction(title: string, projectTitle = ''): string {
  let text = title.normalize('NFKC').toLowerCase()
  const project = projectTitle.normalize('NFKC').toLowerCase().trim()
  if (project) text = text.replaceAll(project, '')
  return text.replace(/\(\s*\d+(?:\.\d+)?\s*\)\s*$/, '')
    .replace(/(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万两]+)(?=字|小时|分钟|秒|页|张|条|遍)/g, '#')
    .replace(/写(?:到|完|够|出)(?=#字)/g, '写')
    .replace(/[\s·•|｜:：/\\—–_.,，。！？!?；;、()（）【】[\]{}「」『』<>《》'"“”‘’`~～^]+/g, '')
    .slice(0, 300)
}

export function normalizeTodoStageMemories(value: TodoStageMemory[] = []): TodoStageMemory[] {
  const seen = new Set<string>()
  return [...value].filter(item => item && typeof item.title === 'string' && typeof item.action === 'string' && typeof item.projectId === 'string' && item.projectId && (item.stageKey === null || MODULE_KEYS.filter(key => key !== 'overview' && key !== 'business').includes(item.stageKey)) && typeof item.updatedAt === 'string' && !Number.isNaN(Date.parse(item.updatedAt)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap(item => {
      const action = normalizeTodoAction(item.action), key = `${item.projectId}:${action}`
      if (!action || seen.has(key)) return []
      seen.add(key)
      return [{ ...item, title: item.title.slice(0, 300), action, projectId: item.projectId.slice(0, 128) }]
    }).slice(0, 200)
}

export function recallTodoStage(title: string, project: { id?: string; title: string }, memories: TodoStageMemory[]): { stageKey: StageTimeKey | null } | null {
  const action = normalizeTodoAction(title, project.title)
  if (!action) return null
  const matches = normalizeTodoStageMemories(memories).filter(memory => memory.action === action)
  const local = matches.find(memory => memory.projectId === project.id)
  if (local) return { stageKey: local.stageKey }
  if (action.length < 3 || !matches.length || matches[0]!.stageKey === null || new Set(matches.map(memory => memory.stageKey)).size !== 1) return null
  return { stageKey: matches[0]!.stageKey }
}
