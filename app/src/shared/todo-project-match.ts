import { isActiveTodoProject } from './todo-project-eligibility'
/** Conservative local name matching: only distinctive, unambiguous fragments bind. */
export interface MatchableTodoProject { id: string; title: string; trashedAt?: string | null; status?: string; topicStageRole?: string | null; ledgerOnly?: boolean }
const normalize = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s·•|｜:：/\\—–_.,，。()（）【】[\]-]+/g, '')
const generic = /演示|项目|内容|整理|研究|拍摄|剪辑|准备|确认|联系|回复|发布|上传|导出|学习|开发|测试|购买|检查|阅读|录制|制作|收集|跟进|文案|脚本|素材|视频|封面|字幕|选题|大纲|口播|测评|评测|体验|分享|计划|完成|修改|今天|明天|下午|上午|晚上/g
const identity = (value: string): string => normalize(value).replace(generic, '').replace(/^(?:给|把|为|帮|写|改|做|看|录|的)+/, '').replace(/(?:写|改|做|的)+$/, '')
function distinctive(value: string): boolean {
  if (!value || /^(?:ai|app|pro|max|ultra|工作|系统|手机|电脑|产品|一下|这个|那个|一版|一遍|小时|分钟|\d+)$/.test(value)) return false
  return /[\u4e00-\u9fff]{2}/.test(value) || /[a-z]{3}/.test(value) || /[a-z]\d|\d[a-z]/.test(value)
}
export function matchTodoProjects(text: string, projects: readonly MatchableTodoProject[]): { projectId: string | null; candidateIds: string[] } {
  const task = identity(text)
  if (!task) return { projectId: null, candidateIds: [] }
  const ranked = projects.filter(isActiveTodoProject).map((project) => {
    const title = identity(project.title)
    const fullName = normalize(project.title)
    let score = title && fullName.length >= 3 && normalize(text).includes(fullName) ? 2000 + fullName.length : 0
    if (!distinctive(task)) return { id: project.id, score }
    // Exact product/model names outrank prefixes; model digits are never discarded.
    if (distinctive(title) && task.includes(title)) score = 1000 + title.length
    if (title.includes(task)) score = Math.max(score, task.length)
    // A brand/model at any position in the task can match a title prefix.
    for (let length = title.length; length >= 2; length -= 1) {
      const fragment = title.slice(0, length)
      if (distinctive(fragment) && task.includes(fragment)) { score = Math.max(score, length); break }
    }
    return { id: project.id, score }
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) return { projectId: null, candidateIds: [] }
  const ambiguous = ranked[1] && (ranked[1].score === best.score || (best.score < 1000 && best.score - ranked[1].score < 2))
  return { projectId: ambiguous ? null : best.id, candidateIds: ranked.map((item) => item.id) }
}
