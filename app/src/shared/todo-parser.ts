import { normalizeTodoAction, type TodoStageMemory } from './todo-stage-memory'
import { recommendedTodoStageForProject } from './todo-stage-recommendation'
import { matchTodoProjects } from './todo-project-match'
import type { CreateTodoInput, ProjectSummary, TodoCategory, TodoCategoryMemory, TodoSegment } from './domain'

export interface TodoParseProject {
  id: string
  title: string
  status?: string
  topicStageRole?: string | null
  ledgerOnly?: boolean
  trashedAt?: string | null
  enabledModuleKeys?: readonly string[]
}

export interface TodoBatchParseOptions {
  today: string
  defaultDate?: string
  projects?: TodoParseProject[] | Pick<ProjectSummary, 'id' | 'title' | 'trashedAt'>[]
  defaultSegment?: TodoSegment | null
  categoryLabels?: Record<TodoCategory, string>
  categoryMemories?: TodoCategoryMemory[]
  stageMemories?: TodoStageMemory[]
}

export interface ParsedTodoInput extends CreateTodoInput {
  projectCandidateIds: string[]
  sourceText: string
  categorySource: 'explicit' | 'memory' | 'rule'
}

const ACTION_START = '(?:整理|研究|拍摄|剪辑|写|改|做|准备|确认|联系|回复|发布|上传|导出|学习|开发|测试|购买|买|取|送|洗|打扫|运动|复盘|规划|处理|完成|检查|阅读|看|录制|录|制作|收集|找|跟进)'
const DATE_PREFIX = /^(?:(今天|今日|明天|后天)\s*)/
const SEGMENT_PREFIX = /^(?:(上午|早上|中午|下午|傍晚|晚上|今晚)\s*)/

function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const value = new Date(Date.UTC(year!, month! - 1, date! + amount))
  return value.toISOString().slice(0, 10)
}

function dateFromText(text: string, today: string): { date: string | null; text: string } {
  const relative = text.match(DATE_PREFIX)
  if (relative) {
    const amount = relative[1] === '明天' ? 1 : relative[1] === '后天' ? 2 : 0
    return { date: addDays(today, amount), text: text.slice(relative[0].length) }
  }
  const iso = text.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*/)
  if (iso) {
    const [year, month, day] = iso[1]!.split('-').map(Number)
    return { date: `${year!.toString().padStart(4, '0')}-${month!.toString().padStart(2, '0')}-${day!.toString().padStart(2, '0')}`, text: text.slice(iso[0].length) }
  }
  const chinese = text.match(/^(\d{1,2})月(\d{1,2})日?\s*/)
  if (chinese) {
    return { date: `${today.slice(0, 4)}-${chinese[1]!.padStart(2, '0')}-${chinese[2]!.padStart(2, '0')}`, text: text.slice(chinese[0].length) }
  }
  return { date: null, text }
}

function segmentFromText(text: string): { segment: TodoSegment | null; text: string } {
  const match = text.match(SEGMENT_PREFIX)
  if (!match) return { segment: null, text }
  const segment: TodoSegment = ['上午', '早上'].includes(match[1]!)
    ? 'morning'
    : ['中午', '下午', '傍晚'].includes(match[1]!)
      ? 'afternoon'
      : 'evening'
  return { segment, text: text.slice(match[0].length) }
}

function progressFromText(text: string): { progress: number; explicit: boolean; text: string } {
  const percent = text.match(/(?:做到|完成到|进度到|完成)?\s*(\d{1,3})\s*[%％]/)
  if (percent) {
    const progress = Math.max(0, Math.min(100, Number(percent[1])))
    return { progress, explicit: true, text: text.replace(percent[0], '').trim() }
  }
  const semanticValues: Array<[RegExp, number]> = [
    [/(?:做到|完成)?一半/, 50],
    [/(?:做到|完成)?四分之一/, 25],
    [/(?:做到|完成)?四分之三/, 75],
    [/(?:做到|完成)?三分之一/, 33],
    [/(?:做到|完成)?三分之二/, 67]
  ]
  for (const [pattern, progress] of semanticValues) {
    if (pattern.test(text)) return { progress, explicit: true, text: text.replace(pattern, '').trim() }
  }
  return { progress: 0, explicit: false, text }
}

function classify(title: string, projectId: string | null): TodoCategory {
  const hasSelfMediaWork = /文案|脚本|拍摄|剪辑|素材|视频|封面|字幕|发布|选题|大纲|资料|口播|录屏|标题/.test(title)
  const hasAiResearch = /(?:研究|学习|开发|测试|搭建|调试).*(?:AI|ai|Codex|Claude|Agent|模型|提示词)|(?:AI|ai|Codex|Claude|Agent|模型|提示词).*(?:研究|学习|开发|测试|搭建|调试)/.test(title)
  if (hasAiResearch && !hasSelfMediaWork) return 'ai'
  if (projectId || hasSelfMediaWork) return 'self_media'
  if (/运动|健身|跑步|散步|走路|游泳|骑行|瑜伽|拉伸|体检|看病|吃药|服药|睡眠|早睡|喝水|健康/.test(title)) return 'other_work'
  if (/^(?:买|购买|取|送|洗|打扫|做饭|遛|缴费|收快递)|洗衣液|家务|生活|猫|狗|超市|快递/.test(title)) return 'life'
  if (/(?:AI|ai|Codex|Claude|Agent|模型|提示词)/.test(title)) return 'ai'
  return 'self_media'
}

export function normalizeTodoCategoryMemoryTitle(value: string): string {
  return normalizeTodoAction(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•|｜:：/\\—–_.,，。！？!?；;、()（）【】[\]{}「」『』<>《》'"“”‘’`~～^]+/g, '')
    .slice(0, 300)
}

function bigramContainment(left: string, right: string): number {
  const bigrams = (value: string): Set<string> => {
    const result = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
    return result
  }
  const leftBigrams = bigrams(left)
  const rightBigrams = bigrams(right)
  const smaller = leftBigrams.size <= rightBigrams.size ? leftBigrams : rightBigrams
  const larger = smaller === leftBigrams ? rightBigrams : leftBigrams
  if (smaller.size === 0) return 0
  let overlap = 0
  for (const bigram of smaller) if (larger.has(bigram)) overlap += 1
  return overlap / smaller.size
}

function categoryMemoryScore(normalizedTitle: string, projectId: string | null, memory: TodoCategoryMemory): number {
  const rememberedTitle = memory.normalizedTitle
  if (!normalizedTitle || !rememberedTitle) return 0
  const sameProject = memory.projectId === projectId
  if (sameProject && normalizeTodoAction(normalizedTitle) === normalizeTodoAction(rememberedTitle)) return 1100
  if (normalizedTitle === rememberedTitle) return 1_000 + (sameProject ? 100 : 0)
  if (!sameProject || normalizedTitle.length < 4 || rememberedTitle.length < 4) return 0
  const shorter = Math.min(normalizedTitle.length, rememberedTitle.length)
  const longer = Math.max(normalizedTitle.length, rememberedTitle.length)
  if ((normalizedTitle.includes(rememberedTitle) || rememberedTitle.includes(normalizedTitle)) && shorter / longer >= 0.6) {
    return 800 + shorter
  }
  const prefix = commonPrefixLength(normalizedTitle, rememberedTitle)
  if (prefix >= 4 && prefix / shorter >= 0.65) return 700 + prefix
  const bigramScore = bigramContainment(normalizedTitle, rememberedTitle)
  if (shorter >= 5 && bigramScore >= 0.75) return 600 + Math.round(bigramScore * 100)
  return 0
}

function matchCategoryMemory(normalizedTitle: string, projectId: string | null, memories: TodoCategoryMemory[]): TodoCategory | null {
  const ranked = memories
    .map((memory) => ({ memory, score: categoryMemoryScore(normalizedTitle, projectId, memory) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt))
  const best = ranked[0]
  if (!best) return null
  const tiedCategories = new Set(ranked.filter((candidate) => candidate.score === best.score).map((candidate) => candidate.memory.category))
  return tiedCategories.size === 1 ? best.memory.category : null
}

function explicitCategoryFromText(text: string, labels: Record<TodoCategory, string> | undefined): { category: TodoCategory | null; text: string } {
  if (!labels) return { category: null, text }
  for (const [category, rawLabel] of Object.entries(labels) as Array<[TodoCategory, string]>) {
    const label = rawLabel.trim()
    if (!label) continue
    const prefix = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[：:]\\s*`, 'i')
    if (prefix.test(text)) return { category, text: text.replace(prefix, '').trim() }
  }
  return { category: null, text }
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function splitClauses(text: string): string[] {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/(?:今天|今日)?\s*(?:要办的事|待办事项|待办)(?:是|：|:)?/g, '')
  return normalized
    .split(/[\n，,；;。！？!?]+/)
    .flatMap((part) => part.split(new RegExp(`(?:和|以及|还有|、)(?=${ACTION_START})`, 'g')))
    .map((part) => part.trim())
    .filter(Boolean)
}

export function parseTodoBatch(text: string, options: TodoBatchParseOptions): ParsedTodoInput[] {
  const projects = [...(options.projects ?? [])]
    .filter((project) => !project.trashedAt)
    .sort((a, b) => b.title.length - a.title.length)
  const categoryMemories = (options.categoryMemories ?? []).map((memory) => ({
    ...memory,
    normalizedTitle: normalizeTodoCategoryMemoryTitle(memory.title || memory.normalizedTitle)
  })).filter((memory) => memory.normalizedTitle)
  let inheritedDate = options.defaultDate ?? options.today
  let inheritedSegment = options.defaultSegment ?? null
  const results: ParsedTodoInput[] = []

  for (const sourceText of splitClauses(text)) {
    let remaining = sourceText
    const parsedDate = dateFromText(remaining, options.today)
    if (parsedDate.date) inheritedDate = parsedDate.date
    remaining = parsedDate.text.trim()
    const parsedSegment = segmentFromText(remaining)
    if (parsedSegment.segment) inheritedSegment = parsedSegment.segment
    remaining = parsedSegment.text.trim()
    const parsedCategory = explicitCategoryFromText(remaining, options.categoryLabels)
    remaining = parsedCategory.text
    const parsedProgress = progressFromText(remaining)
    remaining = parsedProgress.text.replace(/^(?:要|需要|记得|计划)\s*/, '').trim()
    if (!remaining) continue
    const projectMatch = matchTodoProjects(remaining, projects)
    const project = projects.find((item) => item.id === projectMatch.projectId)
    const normalizedTitle = normalizeTodoCategoryMemoryTitle(remaining)
    const rememberedCategory = parsedCategory.category
      ? null
      : matchCategoryMemory(normalizedTitle, project?.id ?? null, categoryMemories)
    const suggestedCategory = rememberedCategory ?? classify(remaining, project?.id ?? null)
    const progress = parsedProgress.progress
    results.push({
      stageSelection: 'suggested',
      categorySelection: parsedCategory.category ? 'manual' : 'suggested',
      projectCandidateIds: projectMatch.candidateIds,
      sourceText,
      title: remaining.slice(0, 300),
      plannedDate: inheritedDate,
      segment: inheritedSegment,
      category: parsedCategory.category ?? suggestedCategory,
      categorySource: parsedCategory.category ? 'explicit' : rememberedCategory ? 'memory' : 'rule',
      ...(parsedCategory.category ? {} : { suggestedCategory }),
      projectId: project?.id ?? null,
      ...(recommendedTodoStageForProject(remaining, project, options.stageMemories) ? { stageKey: recommendedTodoStageForProject(remaining, project, options.stageMemories) } : {}),
      trackingMode: parsedProgress.explicit ? 'progress' : 'checklist',
      progress
    })
  }
  return results
}
