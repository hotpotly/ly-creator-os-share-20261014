import { BusinessTripStatus } from '../../components/BusinessTripStatus'
import { travelDayHighlight } from '../../../../shared/travel-day'
import { TodoCompletionButton } from '../../components/TodoCompletionButton'
import { TodoTitleEditor } from '../../components/TodoTitleEditor'
import { updateTodoWithStageOffer } from '../../utils/todo-completion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Plus, Save, Search } from 'lucide-react'
import { REVIEW_CATEGORIES, reviewPeriodDraftSchema, reviewPlainText, reviewRange, type ReviewData, type ReviewEntry, type ReviewPeriod, type ReviewQuery } from '../../../../shared/personal-review'
import { addTodoDateDays, todoVisibleOnDate } from '../../../../shared/todo-date'
import { navigate, type AppRoute } from '../../utils/router'
import { useWorkspaceStore } from '../../store/workspace'
import { TodoWorkspace } from '../../components/TodoWorkspace'
import { DailyWorkLogEditor } from '../../components/DailyWorkLogEditor'
import { ReviewHoursChart } from './ReviewHoursChart'
import { ReviewRichEditor } from './ReviewRichEditor'
import { ReviewEntryEditor, ReviewImage } from './ReviewEntryEditor'
import { clearReviewDraft, readReviewDraft, writeReviewDraft } from './review-draft'
import { ReviewEntryCanvas } from './ReviewEntryCanvas'
import { ReviewColumns } from './ReviewColumns'
import './reviews.css'
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' })
const names = { life: '生活记录', checkin: '打卡记录', experience: '经验沉淀' }
const hours = (minutes: number): string => (minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
function editableEntry(entry: ReviewEntry) { return { id: entry.id, revision: entry.revision, date: entry.date, kind: entry.kind, title: entry.title, body: entry.body, tags: entry.tags, sourceKind: entry.sourceKind, sourceAnchor: entry.sourceAnchor, trashed: entry.trashed, displayWidth: entry.displayWidth, sortOrder: entry.sortOrder } }
export function ReviewPage({ route }: { route: AppRoute }): React.JSX.Element {
  const snapshot = useWorkspaceStore(state => state.snapshot)
  const kind = route.reportKind ?? 'monthly'
  const anchor = route.anchorDate ?? snapshot.today
  // Invalid external links fall back to the actual day rather than requesting an invalid range.
  let query: ReviewQuery = { kind, anchor }
  try { reviewRange(query) } catch { query = { kind, anchor: snapshot.today } }
  const key = reviewRange(query).id
  return <ReviewWorkspace key={`${key}:${route.reviewView ?? 'period'}:${route.reviewView === 'daily' ? query.anchor : ''}`} daily={route.reviewView === 'daily'} query={query} focusedEntryId={route.reviewEntryId} experiences={route.reviewView === 'experiences'} />
}
function ReviewWorkspace({ query, focusedEntryId, experiences, daily }: { daily: boolean; query: ReviewQuery; focusedEntryId?: string; experiences: boolean }): React.JSX.Element {
  const { today, todos } = useWorkspaceStore(state => state.snapshot)
  const refresh = useWorkspaceStore(state => state.refresh)
  const snapshot = useWorkspaceStore(state => state.snapshot)
  const range = useMemo(() => reviewRange(query), [query])
  const draftKey = `review-period-draft:${range.id}`
  const [data, setData] = useState<ReviewData | null>(null), [draft, setDraft] = useState<ReviewPeriod | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  const [entryEditor, setEntryEditor] = useState<{ kind: ReviewEntry['kind']; entry?: ReviewEntry } | null>(null)
  const [search, setSearch] = useState(''), [results, setResults] = useState<ReviewEntry[]>([]), [searching, setSearching] = useState(false)
  const [goalTitle, setGoalTitle] = useState(''), [category, setCategory] = useState<typeof REVIEW_CATEGORIES[number]>('工作'), [goalTarget, setGoalTarget] = useState(1), [showGoalForm, setShowGoalForm] = useState(false)
  const [trash, setTrash] = useState(false), [deleteId, setDeleteId] = useState(''), [focused, setFocused] = useState<ReviewEntry | null>(null)
  const pending = useRef(false), initialized = useRef(false)
  const refreshed = (): void => setReload(v => v + 1)
  useEffect(() => {
    let active = true
    void window.creatorOS!.getPersonalReview(query).then(value => {
      if (!active) return
      setData(value); setError('')
      if (!initialized.current) { initialized.current = true; setDraft(readReviewDraft(draftKey, reviewPeriodDraftSchema) ?? value.period) }
    }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [query, draftKey, reload, snapshot])
  useEffect(() => {
    if (!experiences) return
    let active = true
    setSearching(true)
    const timer = setTimeout(() => { void window.creatorOS!.searchReviewEntries(search).then(value => { if (active) { setResults(value); setError('') } }).catch(e => { if (active) setError(String(e)) }).finally(() => { if (active) setSearching(false) }) }, 150)
    return () => { active = false; clearTimeout(timer) }
  }, [experiences, search, reload])
  useEffect(() => {
    if (!focusedEntryId) { setFocused(null); return }
    let active = true
    void window.creatorOS!.getReviewEntry(focusedEntryId).then(value => { if (active) { if (value.sourceKind !== query.kind || value.sourceAnchor !== range.start) navigate({ page: 'reviews', reportKind: value.sourceKind, anchorDate: value.sourceAnchor, reviewEntryId: value.id }); else setFocused(value) } }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [focusedEntryId, reload, query.kind, range.start])
  const update = (patch: Partial<ReviewPeriod>): void => setDraft(value => {
    if (pending.current) return value
    if (!value) return value
    const next = { ...value, ...patch }; writeReviewDraft(draftKey, next); return next
  })
  const dirty = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.period)
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败；草稿仍保留') } finally { pending.current = false; setBusy(false) }
  }
  const save = (): void => { if (draft) void run(async () => { const result = await window.creatorOS!.savePersonalReview(draft); setDraft(result); setData(value => value ? { ...value, period: result } : value); clearReviewDraft(draftKey) }) }
  const changePeriod = (direction: number): void => {
    const date = new Date(`${range.start}T12:00:00Z`)
    if (query.kind === 'monthly') date.setUTCMonth(date.getUTCMonth() + direction)
    const next = query.kind === 'monthly' ? date.toISOString().slice(0, 10) : addTodoDateDays(range.start, direction * 7)
    if (next < '1900-01-01' || next > '2199-12-31') return
    navigate({ page: 'reviews', reportKind: query.kind, anchorDate: next })
  }
  const openSource = (entry: ReviewEntry): void => navigate({ page: 'reviews', reportKind: entry.sourceKind, anchorDate: entry.sourceAnchor, reviewEntryId: entry.id })
  const renderEntry = (entry: ReviewEntry): React.JSX.Element => <article className="review-entry-card" key={entry.id} data-review-entry={entry.id}>
    <header><span>{entry.date} · {names[entry.kind]}</span>{entry.trashed ? <button disabled={busy} onClick={() => void run(async () => { await window.creatorOS!.saveReviewEntry({ ...editableEntry(entry), trashed: false }); refreshed() })}>恢复</button> : <button onClick={() => setEntryEditor({ entry, kind: entry.kind })}>编辑</button>}</header>
    <h3>{entry.title}</h3>{entry.tags.length > 0 && <div className="review-tags">{entry.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    <p className="review-entry-excerpt">{reviewPlainText(entry.body)}</p>
    {!!entry.attachments.length && <div className="review-card-images">{entry.attachments.slice(0, 3).map(file => <ReviewImage key={file.id} entry={entry} fileId={file.id} name={file.name} />)}{entry.attachments.length > 3 && <span>另有{entry.attachments.length - 3}张</span>}</div>}
    <footer><button onClick={() => openSource(entry)}>查看原文与来源</button>{!entry.trashed && (deleteId === entry.id ? <span><button disabled={busy} onClick={() => void run(async () => { await window.creatorOS!.saveReviewEntry({ ...editableEntry(entry), trashed: true }); setDeleteId(''); refreshed() })}>确认移入已删除</button><button onClick={() => setDeleteId('')}>取消</button></span> : <button aria-label={`删除${entry.title}`} onClick={() => setDeleteId(entry.id)}>删除</button>)}</footer>
  </article>
  const logs = data?.logs ?? [], recorded = logs.filter(l => l.minutes !== null), minutes = recorded.reduce((sum, log) => sum + log.minutes!, 0)
  const openDay = (day: string): void => navigate({ page: 'reviews', reportKind: query.kind, anchorDate: day, reviewView: 'daily' })
  const activeEntries = (data?.entries ?? []).filter(e => e.trashed === trash && (!daily || e.date === query.anchor))
  const entrySection = (type: ReviewEntry['kind']): React.JSX.Element => <section className="review-panel" key={type}><header><div><h2>{names[type]}</h2></div><button disabled={busy} onClick={() => setEntryEditor({ kind: type })}><Plus size={14} />添加{type === 'experience' ? '经验' : '记录'}</button></header><div className="review-entry-grid">{activeEntries.filter(entry => entry.kind === type).map(renderEntry)}</div>{!activeEntries.some(e => e.kind === type) && <div className="review-empty"><p>{trash ? '暂无已删除记录' : '暂无记录'}</p></div>}</section>
  const lifeCanvas = <ReviewEntryCanvas kind="life" entries={activeEntries} query={query} onSaved={refreshed} onEdit={entry => setEntryEditor({ entry, kind: entry.kind })} />
  return <main className="page review-page" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.shiftKey && !event.altKey && !entryEditor) { event.preventDefault(); if (dirty && !experiences && !daily) save() } }}>
    <header className="review-page-header"><div><h1>计划与复盘</h1></div><div><button className="secondary-action" onClick={() => navigate({ page: 'reports', reportKind: query.kind, anchorDate: query.anchor })}>创作报表</button>{!experiences && !daily && <button className="primary-action" title="保存复盘（⌘S）" aria-keyshortcuts="Meta+S Control+S" disabled={!dirty || busy} onClick={save}><Save size={14} />{busy ? '保存中…' : dirty ? '保存复盘' : '已保存'}</button>}</div></header>
    <nav className="review-nav" aria-label="复盘视图"><div>{([['daily', '每日记录'], ['monthly', '月复盘'], ['weekly', '周复盘'], ['experiences', '经验检索']] as const).map(([value, label]) => <button key={value} aria-current={value === (daily ? 'daily' : experiences ? 'experiences' : query.kind) ? 'page' : undefined} onClick={() => navigate({ page: 'reviews', reportKind: value === 'experiences' || value === 'daily' ? query.kind : value, anchorDate: query.anchor, reviewView: value === 'daily' ? 'daily' : value === 'experiences' ? 'experiences' : 'period' })}>{label}</button>)}</div>{!experiences && !daily && <div className="review-period-nav"><button aria-label="上一周期" onClick={() => changePeriod(-1)}><ChevronLeft size={16} /></button><strong>{query.kind === 'monthly' ? `${range.start.slice(0, 4)}年${Number(range.start.slice(5, 7))}月` : `${range.start} — ${range.end.slice(5)}`}</strong><button aria-label="下一周期" onClick={() => changePeriod(1)}><ChevronRight size={16} /></button><input aria-label="选择复盘日期" type="date" min="1900-01-01" max="2199-12-31" value={query.anchor} onChange={event => { if (event.target.value) navigate({ page: 'reviews', reportKind: query.kind, anchorDate: event.target.value }) }} /></div>}</nav>
    {error && <div className="review-error" role="alert">{error}<button onClick={refreshed}>重新读取</button></div>}
    {!data || !draft ? <section className="review-panel" role="status">{error ? '未能读取复盘，请重试。' : '正在读取复盘…'}</section> : experiences ? <>
      <section className="review-panel review-search"><Search size={17} /><input aria-label="搜索经验" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} placeholder="搜索经验" /></section>
      <div className="review-entry-grid">{results.map(renderEntry)}</div>{searching ? <p role="status">搜索中…</p> : !results.length && <div className="review-empty"><BookOpen size={24} /><p>{search ? '无匹配结果' : '暂无经验'}</p></div>}
    </> : <>
      {daily ? <div className="review-daily" aria-label="每日记录"><TodoWorkspace day={query.anchor} onDayChange={openDay} /></div> : <>
      {dirty && data.period.revision !== draft.revision && <p className="review-error">有更新版本，当前草稿不会覆盖。请复制需保留的文字，再<button onClick={() => { clearReviewDraft(draftKey); setDraft(data.period) }}>放弃草稿并加载已保存版本</button></p>}
      <ReviewColumns first={<><section className="review-panel review-goals-panel"><header><div><h2>{query.kind === 'monthly' ? '本月' : '本周'}目标</h2></div><button onClick={() => setShowGoalForm(v => !v)}><Plus size={14} />添加目标</button></header>
        <div className="review-goal-grid">{REVIEW_CATEGORIES.filter(group => draft.goals.some(goal => goal.category === group)).map(group => <section className="review-goal-group" key={group}><h3>{group}</h3>{draft.goals.filter(g => g.category === group).map(goal => <div className="review-goal" key={goal.id}>
          <input type="checkbox" aria-label={`完成${goal.title}`} checked={goal.done === goal.target} onChange={e => update({ goals: draft.goals.map(g => g.id === goal.id ? { ...g, done: e.target.checked ? g.target : 0 } : g) })} />
          <input className={goal.done === goal.target ? 'completed' : ''} aria-label={`目标内容${goal.title}`} maxLength={300} value={goal.title} onChange={e => update({ goals: draft.goals.map(g => g.id === goal.id ? { ...g, title: e.target.value } : g) })} />
          {goal.target > 1 && <label className="review-goal-count"><input aria-label={`${goal.title}完成次数`} type="number" min={0} max={goal.target} value={goal.done} onChange={e => update({ goals: draft.goals.map(g => g.id === goal.id ? { ...g, done: Math.max(0, Math.min(goal.target, Math.round(Number(e.target.value)))) } : g) })} />/{goal.target}</label>}
          <button aria-label={`移除目标${goal.title}`} onClick={() => update({ goals: draft.goals.filter(g => g.id !== goal.id) })}>×</button>
        </div>)}</section>)}</div>
        {showGoalForm && <form className="review-goal-form" onSubmit={e => { e.preventDefault(); if (!goalTitle.trim() || draft.goals.length >= 100) return; update({ goals: [...draft.goals, { id: crypto.randomUUID(), title: goalTitle.trim(), category, target: goalTarget, done: 0 }] }); setGoalTitle(''); setShowGoalForm(false) }}><select aria-label="目标分类" value={category} onChange={e => setCategory(e.target.value as typeof category)}>{REVIEW_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select><input autoFocus aria-label="新目标" placeholder="目标内容" maxLength={300} value={goalTitle} onChange={e => setGoalTitle(e.target.value)} /><label>次数<input aria-label="目标次数" type="number" min={1} max={999} value={goalTarget} onChange={e => setGoalTarget(Math.max(1, Math.min(999, Math.round(Number(e.target.value)))))} /></label><button className="primary-action" type="submit">添加</button></form>}
      </section>{!trash && <ReviewEntryCanvas kind="checkin" entries={activeEntries} query={query} onSaved={refreshed} onEdit={entry=>setEntryEditor({entry,kind:entry.kind})} />}</>}
      second={<section className="review-panel review-hours"><header><div><h2>工作投入</h2></div></header><div className="review-hour-number"><strong>{hours(minutes)}</strong><span>小时</span></div><label className="review-hour-target">工时目标<input aria-label="周期工时目标" type="number" min={0} max={range.days.length * 24} step="0.5" placeholder="—" value={draft.targetMinutes === null ? '' : draft.targetMinutes / 60} onChange={e => update({ targetMinutes: e.target.value === '' ? null : Math.max(0, Math.min(range.days.length * 1440, Math.round(Number(e.target.value) * 60))) })} />小时</label>
      <ReviewHoursChart logs={logs} schedules={snapshot.schedules} onOpenDay={openDay} /><p className="review-coverage">{recorded.length}/{logs.length}天已记录</p>
      </section>}
      third={<details open className="review-panel review-schedule"><summary>每天做了什么</summary><div>{logs.map(log => {
        const travel = travelDayHighlight(snapshot.schedules, log.day)
        const dayTodos = todos.filter(todo => todoVisibleOnDate(todo, log.day, today))
        return <section key={log.day} data-day={log.day} data-travel-kind={travel?.tone} className={`review-day-card${travel ? ` travel-surface-${travel.tone}` : ''}`}>
          <header><button aria-label={`查看${log.day}记录`} onClick={() => openDay(log.day)}><time dateTime={log.day} className="review-day-date"><strong>{Number(log.day.slice(5, 7))}月{Number(log.day.slice(8))}日</strong><span>{weekdayFormatter.format(new Date(`${log.day}T12:00:00Z`))}</span></time><ChevronRight size={14} /></button><DailyWorkLogEditor day={log.day} compact /></header>
          <BusinessTripStatus day={log.day} compact showCreate={false} />
          {dayTodos.map(todo => <article className={`review-todo-row${todo.status === 'completed' ? ' completed' : ''}`} data-todo-id={todo.id} key={todo.id}><TodoCompletionButton todo={todo} disabled={busy} onToggle={() => void run(async () => { await updateTodoWithStageOffer(todo, { completed: todo.status !== 'completed' }); await refresh() })} /><TodoTitleEditor todo={todo} /></article>)}
          {!dayTodos.length && <p className="review-hint">暂无待办</p>}
        </section>
      })}</div></details>} />
      {!trash && <ReviewColumns variant="writing" first={<section className="review-panel"><header><div><h2>自由复盘</h2></div></header><ReviewRichEditor value={draft.body} disabled={busy} label="复盘正文" onChange={body => update({ body })} /></section>} second={lifeCanvas} third={entrySection('experience')} />}
      </>}
      {!trash && daily && lifeCanvas}
      {!trash && daily && <ReviewEntryCanvas kind="checkin" entries={activeEntries} query={query} onSaved={refreshed} onEdit={entry=>setEntryEditor({entry,kind:entry.kind})} />}
      {(trash ? (['life', 'checkin', 'experience'] as const) : daily ? (['experience'] as const) : []).map(entrySection)}
      <button className="review-trash-toggle" onClick={() => setTrash(v => !v)}>{trash ? '返回正常记录' : `已删除记录（${data.entries.filter(e => e.trashed && (!daily || e.date === query.anchor)).length}）`}</button>
    </>}
    {focused && <section className="review-panel review-source" aria-label="原文与来源"><header><div><h2>{focused.title}</h2><p>来源：{focused.sourceAnchor}起的{focused.sourceKind === 'monthly' ? '月复盘' : '周复盘'} · {focused.date}{focused.trashed ? ' · 已删除' : ''}</p></div><button onClick={() => setFocused(null)}>收起原文</button></header><ReviewRichEditor key={focused.id} value={focused.body} label="原文" readOnly /><div className="review-attachment-grid">{focused.attachments.map(file => <ReviewImage key={file.id} entry={focused} fileId={file.id} name={file.name} />)}</div><button onClick={() => setEntryEditor({ kind: focused.kind, entry: focused })}>编辑这条记录</button></section>}
    {entryEditor && <ReviewEntryEditor key={entryEditor.entry?.id ?? entryEditor.kind} {...entryEditor} query={entryEditor.entry ? { kind: entryEditor.entry.sourceKind, anchor: entryEditor.entry.sourceAnchor } : query} today={daily ? query.anchor : today} onClose={() => setEntryEditor(null)} onSaved={refreshed} />}
  </main>
}
