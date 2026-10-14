import { RotateCcw, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RecycleCategory, RecycleEmptyResult } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'

interface RecycleEntry { id: string; title: string; meta: string; category: RecycleCategory; colorToken?: string }

function captureTitle(content: string): string {
  const first = content.trim().split(/[。！？\n]/).find(Boolean) ?? content.trim()
  return first.length > 32 ? `${first.slice(0, 32)}…` : first
}
function deletedLabel(at: string | null): string {
  return at ? `删除于 ${new Date(at).toLocaleDateString('zh-CN')}` : '删除时间未知'
}
function purgeTitle(category: RecycleCategory): string {
  return category === 'projects' ? '永久删除项目？' : category === 'ideas' ? '永久删除灵感？' : category === 'topics' ? '永久删除选题？' : '永久删除筛选候选？'
}
function purgeCopy(entry: RecycleEntry): string {
  if (entry.category === 'projects') return `「${entry.title}」及项目内版本、资料和任务记录将永久删除，无法恢复。`
  if (entry.category === 'ideas') return `「${entry.title}」这条灵感将永久删除，无法恢复。`
  if (entry.category === 'topics') return `「${entry.title}」这个选题将永久删除，关联灵感会解除关联，无法恢复。`
  return `「${entry.title}」这条AI筛选候选将永久删除，之后的扫描可能重新发现同主题内容。`
}
function emptyCopy(category: RecycleCategory): string {
  return category === 'projects' ? '删除的项目会先放在这里，可以恢复。'
    : category === 'ideas' ? '弃用的灵感会收到这里，可以恢复或永久删除。'
    : category === 'topics' ? '移入回收站的选题会收到这里，可以恢复。'
    : 'AI选题筛选中弃用的候选会收到这里，可以恢复或永久删除。'
}

export function RecyclePage(): React.JSX.Element {
  const { projects, captures, topics, discardedFilterCandidates } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [category, setCategory] = useState<RecycleCategory>('projects')
  const [pendingDelete, setPendingDelete] = useState<RecycleEntry | null>(null)
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false)
  const [emptyResult, setEmptyResult] = useState<RecycleEmptyResult | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState('')

  const trashedProjects = useMemo(() => projects.filter((project) => project.trashedAt).sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '')), [projects])
  const discardedCaptures = useMemo(() => captures.filter((capture) => capture.useStatus === 'discarded').sort((a, b) => (b.discardedAt ?? b.createdAt).localeCompare(a.discardedAt ?? a.createdAt)), [captures])
  const trashedTopics = useMemo(() => topics.filter((topic) => topic.trashedAt).sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '')), [topics])
  const totalCount = trashedProjects.length + discardedCaptures.length + trashedTopics.length + discardedFilterCandidates.length

  const entries = useMemo<RecycleEntry[]>(() => {
    if (category === 'projects') return trashedProjects.map((project) => ({ id: project.id, title: project.title, meta: deletedLabel(project.trashedAt), category: 'projects', colorToken: project.colorToken }))
    if (category === 'ideas') return discardedCaptures.map((capture) => ({ id: capture.id, title: captureTitle(capture.originalContent), meta: deletedLabel(capture.discardedAt), category: 'ideas' }))
    if (category === 'topics') return trashedTopics.map((topic) => ({ id: topic.id, title: topic.title, meta: deletedLabel(topic.trashedAt), category: 'topics' }))
    return discardedFilterCandidates.map((candidate) => ({ id: candidate.id, title: candidate.title, meta: deletedLabel(candidate.discardedAt), category: 'filter_candidates' }))
  }, [category, trashedProjects, discardedCaptures, trashedTopics, discardedFilterCandidates])

  const restore = async (entry: RecycleEntry): Promise<void> => {
    if (!window.creatorOS || working) return
    setWorking(entry.id); setError('')
    try {
      if (entry.category === 'projects') await window.creatorOS.restoreProject(entry.id)
      else if (entry.category === 'ideas') await window.creatorOS.setCaptureUseStatus(entry.id, 'active')
      else if (entry.category === 'topics') await window.creatorOS.restoreTopic(entry.id)
      else await window.creatorOS.restoreFilterCandidate(entry.id)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败') }
    finally { setWorking(null) }
  }
  const confirmPurge = async (): Promise<void> => {
    if (!window.creatorOS || !pendingDelete || working) return
    setWorking(pendingDelete.id); setError('')
    try {
      if (pendingDelete.category === 'projects') await window.creatorOS.permanentlyDeleteProject(pendingDelete.id)
      else if (pendingDelete.category === 'ideas') await window.creatorOS.permanentlyDeleteCapture(pendingDelete.id)
      else if (pendingDelete.category === 'topics') await window.creatorOS.permanentlyDeleteTopic(pendingDelete.id)
      else await window.creatorOS.permanentlyDeleteFilterCandidate(pendingDelete.id)
      setPendingDelete(null); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '永久删除失败') }
    finally { setWorking(null) }
  }
  const confirmEmpty = async (): Promise<void> => {
    if (!window.creatorOS || working) return
    setWorking('empty'); setError('')
    try {
      const result = await window.creatorOS.emptyRecycleBin()
      setEmptyConfirmOpen(false)
      setEmptyResult(result)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '清空回收站失败') }
    finally { setWorking(null) }
  }

  return <main className="page recycle-page">
    <header className="page-header"><div><h1>回收站</h1></div>
      {totalCount ? <button className="recycle-empty-all danger" disabled={working !== null} onClick={() => setEmptyConfirmOpen(true)}><Trash2 size={14} />清空回收站</button> : null}
    </header>
    {error ? <div className="inline-notice form-error" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div> : null}
    {emptyResult ? <div className="inline-notice recycle-empty-report" role="status">
      <span>已永久删除{emptyResult.deletedCount}项{emptyResult.skipped.length ? `，${emptyResult.skipped.length}项被保护跳过：` : '。'}</span>
      {emptyResult.skipped.length ? <ul>{emptyResult.skipped.map((item) => <li key={item.id}><b>{item.title}</b>·{item.reason}</li>)}</ul> : null}
      <button onClick={() => setEmptyResult(null)}>知道了</button>
    </div> : null}
    <div className="recycle-shell">
      <nav className="recycle-nav" aria-label="回收站分类">
        <button className={category === 'projects' ? 'active' : ''} aria-pressed={category === 'projects'} onClick={() => setCategory('projects')}>项目<span>{trashedProjects.length}</span></button>
        <button className={category === 'ideas' ? 'active' : ''} aria-pressed={category === 'ideas'} onClick={() => setCategory('ideas')}>灵感<span>{discardedCaptures.length}</span></button>
        <button className={category === 'topics' ? 'active' : ''} aria-pressed={category === 'topics'} onClick={() => setCategory('topics')}>选题<span>{trashedTopics.length}</span></button>
        <button className={category === 'filter_candidates' ? 'active' : ''} aria-pressed={category === 'filter_candidates'} onClick={() => setCategory('filter_candidates')}>AI筛选弃用<span>{discardedFilterCandidates.length}</span></button>
      </nav>
      <section className="recycle-list" aria-label="回收站内容">
        {entries.length ? entries.map((entry) => <article key={entry.id} className="recycle-item">
          <span className="recycle-dot" style={{ background: entry.colorToken ? `var(--${entry.colorToken})` : 'var(--line)' }} />
          <div className="recycle-item-main"><b>{entry.title}</b><span>{entry.meta}</span></div>
          <div className="recycle-item-actions">
            <button disabled={working === entry.id} onClick={() => void restore(entry)}><RotateCcw size={13} />恢复</button>
            <button className="danger" disabled={working === entry.id} onClick={() => setPendingDelete(entry)}><Trash2 size={13} />永久删除</button>
          </div>
        </article>) : <div className="empty-state"><Trash2 size={22} /><b>回收站是空的</b><span>{emptyCopy(category)}</span></div>}
      </section>
    </div>
    {pendingDelete ? <div className="modal-backdrop"><section className="confirm-dialog project-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="recycle-purge-title">
      <header><div><Trash2 size={16} /><h2 id="recycle-purge-title">{purgeTitle(pendingDelete.category)}</h2></div><button aria-label="关闭确认" onClick={() => setPendingDelete(null)}><X size={15} /></button></header>
      <p>{purgeCopy(pendingDelete)}</p>
      <footer><button onClick={() => setPendingDelete(null)}>取消</button><button className="danger-action" disabled={working === pendingDelete.id} onClick={() => void confirmPurge()}>{working === pendingDelete.id ? '删除中…' : '永久删除'}</button></footer>
    </section></div> : null}
    {emptyConfirmOpen ? <div className="modal-backdrop"><section className="confirm-dialog project-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="recycle-empty-title">
      <header><div><Trash2 size={16} /><h2 id="recycle-empty-title">清空回收站？</h2></div><button aria-label="关闭确认" onClick={() => setEmptyConfirmOpen(false)}><X size={15} /></button></header>
      <p>将永久删除回收站中的{totalCount}项内容，无法恢复。有商务记录的项目会自动跳过并列出，不会被删除。</p>
      <footer><button onClick={() => setEmptyConfirmOpen(false)}>取消</button><button className="danger-action" disabled={working === 'empty'} onClick={() => void confirmEmpty()}>{working === 'empty' ? '清空中…' : '清空回收站'}</button></footer>
    </section></div> : null}
  </main>
}
