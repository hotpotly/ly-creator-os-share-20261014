import type { TodoItem } from '../../../shared/domain'
import { formatEstimatedMinutes, summarizeTodoEstimates } from '../../../shared/todo-duration'

export function TodoEstimateSummary({ todos }: { todos: readonly TodoItem[] }): React.JSX.Element | null {
  const summary = summarizeTodoEstimates(todos)
  if (!summary.totalCount) return null
  return <p className="todo-estimate-summary" title="仅按最新标题的数字括号汇总，不是实际工时；历史记录可能混用预计与实际。未完成不按百分比折算，多日重复事项需人工核对。">
    待办预计：{summary.totalMinutes === null ? '未填写' : formatEstimatedMinutes(summary.totalMinutes)}
    {' · '}已完成条目预计：{summary.completedMinutes === null ? '未记录' : formatEstimatedMinutes(summary.completedMinutes)}
    {' · '}{summary.filledCount}/{summary.totalCount}条有时长{summary.missingCount ? `，${summary.missingCount}条未填` : ''}
  </p>
}
