import { BarChart3, CircleHelp, Inbox, Sparkles } from 'lucide-react'
import { navigate } from '../utils/router'
import { ResizableSplitPane } from './ResizableSplitPane'
import { ScheduleCard } from './ScheduleCard'
import { useWorkspaceStore } from '../store/workspace'
import { TodoWorkspace } from './TodoWorkspace'
import { DailyGrowthPlant } from './DailyGrowthPlant'

function ConfirmationCard(): React.JSX.Element | null {
  const { tasks, projects } = useWorkspaceStore((state) => state.snapshot)
  const waiting = tasks.filter((task) => task.status === 'waiting_confirmation')
  if (waiting.length === 0) return null
  return (
    <section className="card side-card">
      <header className="card-header"><h2>等待我确认</h2><span className="count-badge">{waiting.length}</span></header>
      {waiting.slice(0, 3).map((item) => { const project = projects.find((entry) => entry.id === item.projectId); return <article className="confirm-row" key={item.id}>
        <span className="square-mark">确</span><div><b>{item.title}</b>{project ? <button className="inline-project-link" onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })}>{project.title}</button> : <span>{item.inputSnapshot}</span>}</div><button onClick={() => document.querySelector<HTMLButtonElement>('[aria-controls="tasks-drawer"]')?.click()}>去确认</button>
      </article> })}
    </section>
  )
}

function InboxCard(): React.JSX.Element {
  const summary = useWorkspaceStore((state) => state.snapshot.captureSummary)
  const items = [
    { queue: 'inbox', label: '新记录', count: summary.newRecords, icon: Inbox },
    { queue: 'review', label: '待我确认', count: summary.pendingReview, icon: CircleHelp },
    { queue: 'processed', label: '今日已自动处理', count: summary.todayAutoProcessed, icon: Sparkles }
  ] as const
  return (
    <section className="card side-card inbox-card" aria-label="选题与灵感">
      <header className="card-header"><h2>选题与灵感</h2></header>
      <div className="idea-summary-list">
        {items.map(({ queue, label, count, icon: Icon }) => <button className="idea-summary-row" key={queue} onClick={() => navigate({ page: 'ideas', queue })}>
          <span className="square-mark"><Icon size={15} /></span><span>{label}</span><b>{count}</b>
        </button>)}
      </div>
    </section>
  )
}

export function HomePage(): React.JSX.Element {
  const today = useWorkspaceStore((state) => state.snapshot.today)
  const [year, month, day] = today.split('-').map(Number)
  const date = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1, 12)
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()]
  return (
    <main className="page home-page">
      <header className="page-header"><div><h1>{date.getMonth() + 1}月{date.getDate()}日，{weekday}</h1></div><div className="home-header-actions"><time dateTime={today}>{date.getFullYear()}年</time><button className="secondary-action" onClick={() => navigate({ page: 'reviews' })}>计划与复盘</button><button className="secondary-action" onClick={() => navigate({ page: 'reports' })}><BarChart3 size={14} />查看创作报表</button></div></header>
      <ResizableSplitPane
        left={<><TodoWorkspace /><ScheduleCard /></>}
        right={<><DailyGrowthPlant /><InboxCard /><ConfirmationCard /></>}
      />
    </main>
  )
}
