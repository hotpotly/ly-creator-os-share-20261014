import { todoDateLabel } from '../../../shared/todo-date'
import { ListChecks, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { StageTimeKey, TodoItem, TodoProjectStage } from '../../../shared/domain'
import { isActiveTodoProject } from '../../../shared/todo-project-eligibility'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { AnchoredPopover } from './AnchoredPopover'
import { AppSelect } from './AppSelect'
import { TodoProjectPicker } from './TodoProjectPicker'

export function TodoBatchLinkButton({ todos, iconOnly = false }: { todos: TodoItem[]; iconOnly?: boolean }): React.JSX.Element {
  const [session, setSession] = useState<{ anchor: HTMLElement; items: TodoItem[] } | null>(null)
  return <>
    <button className="todo-batch-link-button" type="button" aria-label="批量关联待办" title="批量关联待办" disabled={!todos.length} onClick={event => setSession({ anchor: event.currentTarget, items: todos.filter(todo => todo.source === 'manual' && todo.status !== 'dismissed') })}><ListChecks size={13} />{iconOnly ? null : '批量关联'}</button>
    {session ? <BatchLinkPanel anchor={session.anchor} items={session.items} onClose={() => setSession(null)} /> : null}
  </>
}

function BatchLinkPanel({ anchor, items, onClose }: { anchor: HTMLElement; items: TodoItem[]; onClose(): void }): React.JSX.Element {
  const { projects } = useWorkspaceStore(state => state.snapshot)
  const refresh = useWorkspaceStore(state => state.refresh)
  const [ids, setIds] = useState<string[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [chosen, setChosen] = useState(false)
  const [stageKey, setStageKey] = useState<StageTimeKey | null>(null)
  const [replaceStage, setReplaceStage] = useState(false)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [stageData, setStageData] = useState<{ id: string; stages: TodoProjectStage[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  useEffect(() => {
    if (!projectId) return
    let canceled = false
    void window.creatorOS?.getTodoProjectStages(projectId).then(stages => { if (!canceled) setStageData({ id: projectId, stages }) }).catch(() => { if (!canceled) setError('阶段读取失败，可关闭后重试') })
    return () => { canceled = true }
  }, [projectId])
  const selected = items.filter(todo => ids.includes(todo.id))
  const projectName = (id: string | null): string => id ? projects.find(project => project.id === id)?.title ?? '原项目不可用' : '未关联'
  const stageName = (key: StageTimeKey | null | undefined): string => key ? projectModuleLabels[key] : '未指定阶段'
  const nextStage = (todo: TodoItem): StageTimeKey | null => !projectId ? null : replaceStage ? stageKey : todo.projectId === projectId ? todo.stageKey ?? null : null
  const showDates = new Set(items.map(todo => todoDateLabel(todo))).size > 1
  const associationPreview = (todo: TodoItem): string => `${todo.status === 'completed' ? '已完成 · ' : ''}${showDates ? `${todoDateLabel(todo)} · ` : ''}${projectName(todo.projectId)}${todo.stageKey ? `／${stageName(todo.stageKey)}` : ''}${chosen && ids.includes(todo.id) ? ` → ${projectName(projectId)}${projectId ? `／${stageName(nextStage(todo))}` : ''}` : ''}`
  const overwriteCount = selected.filter(todo => todo.projectId && (todo.projectId !== projectId || (todo.stageKey ?? null) !== nextStage(todo))).length
  const save = async (): Promise<void> => {
    if (!chosen || !selected.length || pending.current || !window.creatorOS) return
    pending.current = true; setBusy(true); setError('')
    try {
      await window.creatorOS.batchLinkTodos({ items: selected.map(todo => ({ todoId: todo.id, expectedUpdatedAt: todo.updatedAt, expectedProjectId: todo.projectId, expectedStageKey: todo.stageKey ?? null })), projectId,
        stageMode: replaceStage ? 'replace' : 'preserve', stageKey: projectId && replaceStage ? stageKey : null, includeClosed })
      await refresh(); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批量关联失败，尚未保存') }
    finally { pending.current = false; setBusy(false) }
  }
  return <AnchoredPopover anchor={anchor} ariaLabel="批量关联待办" className="todo-batch-link-panel" onDismiss={() => { if (!pending.current) onClose() }}>
    <header><b>批量关联</b><button type="button" aria-label="关闭批量关联" disabled={busy} onClick={onClose}><X size={14} /></button></header>
    <div className="todo-batch-selection"><span>已选{ids.length}条</span><button disabled={busy} onClick={() => setIds(items.slice(0, 100).map(todo => todo.id))}>{items.length > 100 ? '选择前100条' : '全选当前列表'}</button><button disabled={busy || !ids.length} onClick={() => setIds([])}>清空</button></div>
    <div className="todo-batch-items" role="group" aria-label="选择要关联的待办">
      {items.map(todo => <label key={todo.id} className={ids.includes(todo.id) ? 'selected' : ''}>
        <input type="checkbox" aria-label={`选择待办：${todo.title}`} checked={ids.includes(todo.id)} disabled={busy || (ids.length >= 100 && !ids.includes(todo.id))} onChange={event => setIds(current => event.target.checked ? [...current, todo.id] : current.filter(id => id !== todo.id))} />
        <span><b title={todo.title}>{todo.title}</b><small title={associationPreview(todo)}>{associationPreview(todo)}</small></span>
      </label>)}
    </div>
    <div className="todo-batch-target"><span>关联到</span><strong>{chosen ? projectId ? projectName(projectId) : '不关联项目' : '选择项目'}</strong><TodoProjectPicker value={projectId} stageKey={stageKey} disabled={busy} allowStageSelection={false} closeAfterChoose onChange={(id, stage) => { setChosen(true); setProjectId(id); setStageKey(stage); setIncludeClosed(Boolean(id && projects.some(project => project.id === id && !isActiveTodoProject(project)))) }} /></div>
    {projectId ? <>
      <label className="todo-batch-stage-policy"><input type="checkbox" checked={replaceStage} disabled={busy} onChange={event => { setReplaceStage(event.target.checked); setStageKey(null) }} />统一设置阶段</label>
      {replaceStage ? <AppSelect aria-label="批量关联阶段" value={stageKey ?? ''} disabled={busy || stageData?.id !== projectId} onChange={event => setStageKey(event.currentTarget.value as StageTimeKey || null)}><option value="">未指定阶段</option>{(stageData?.id === projectId ? stageData.stages : []).filter(stage => stage.enabled).map(stage => <option key={stage.key} value={stage.key}>{stageName(stage.key)}</option>)}</AppSelect> : <p className="todo-batch-stage-summary">同项目保留原阶段；换项目后清除旧阶段</p>}
    </> : null}
    {chosen && overwriteCount > 0 ? <p className="todo-batch-warning">将更改{overwriteCount}条已有的关联</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <footer><button disabled={busy} onClick={onClose}>取消</button><button className="primary-action" disabled={busy || !chosen || !ids.length || (replaceStage && Boolean(projectId) && stageData?.id !== projectId)} onClick={() => void save()}>{busy ? '保存中…' : chosen && !projectId ? '确认取消关联' : `确认关联${ids.length ? `（${ids.length}条）` : ''}`}</button></footer>
  </AnchoredPopover>
}
