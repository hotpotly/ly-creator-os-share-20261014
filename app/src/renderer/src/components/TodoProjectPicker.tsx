import { TodoStageTimeControls } from './TodoStageTimeControls'
import { recommendedTodoStageForProject } from '../../../shared/todo-stage-recommendation'
import { isActiveTodoProject } from '../../../shared/todo-project-eligibility'
import { Check, LockKeyhole, UnlockKeyhole, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { StageTimeKey, TodoItem, TodoProjectStage } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { AnchoredPopover } from './AnchoredPopover'
import { AppSelect } from './AppSelect'

export function TodoProjectPicker({ draftTitle, value, stageKey = null, todo, onChange, candidateIds = [], automatic = false, disabled = false, allowStageSelection = true, closeAfterChoose = false, triggerLabel }: {
  triggerLabel?: string
  draftTitle?: string
  value: string | null
  stageKey?: StageTimeKey | null
  todo?: TodoItem
  onChange(value: string | null, stageKey: StageTimeKey | null, selection?: 'manual' | 'suggested'): void | Promise<void>
  candidateIds?: string[]
  automatic?: boolean
  disabled?: boolean
  closeAfterChoose?: boolean
  allowStageSelection?: boolean
}): React.JSX.Element {
  const snapshot = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const projects = snapshot.projects.filter((project) => !project.trashedAt)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectingProject, setSelectingProject] = useState(!value)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stageData, setStageData] = useState<{ projectId: string; stages: TodoProjectStage[] } | null>(null)
  const pending = useRef(false)
  const selected = projects.find((project) => project.id === value)
  const stages = stageData?.projectId === value ? stageData.stages : []
  const linkedStage = stages.find((stage) => stage.key === stageKey)
  const normalize = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s/g, '')
  const visible = projects.filter(project => includeClosed || isActiveTodoProject(project)).filter((project) => normalize(project.title).includes(normalize(query))).sort((a, b) => Number(candidateIds.includes(b.id)) - Number(candidateIds.includes(a.id)))

  useEffect(() => {
    if (!anchor || !value) return
    let canceled = false
    void window.creatorOS?.getTodoProjectStages(value).then((stages) => {
      if (!canceled) setStageData({ projectId: value, stages })
    }).catch((reason: unknown) => { if (!canceled) { setStageData(null); setError(reason instanceof Error ? reason.message : '阶段读取失败') } })
    return () => { canceled = true }
  }, [anchor, value, snapshot])

  const choose = async (id: string | null, stage: StageTimeKey | null, selection: 'manual' | 'suggested' = 'manual'): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await onChange(id, stage, selection); setSelectingProject(!id); if (closeAfterChoose) setAnchor(null) } catch (reason) { setError(reason instanceof Error ? reason.message : '关联保存失败') }
    finally { pending.current = false; setBusy(false) }
  }
  const label = selected?.title ?? (value ? '项目已移入回收站' : candidateIds.length > 1 ? `选择项目（${candidateIds.length}个可能）` : '关联项目')
  return <>
    <button className={`todo-project-link${value ? ' linked' : ''}${triggerLabel ? ' with-label' : ''}`} type="button" data-project-id={value ?? ''} disabled={disabled} title={value ? '查看关联项目和阶段' : '关联项目（可选）'} aria-label={triggerLabel ?? (value ? '查看关联项目' : candidateIds.length > 1 ? `关联项目（${candidateIds.length}个可能）` : '关联项目（可选）')} aria-expanded={Boolean(anchor)} onClick={(event) => { setQuery(''); setIncludeClosed(false); setSelectingProject(!value); setError(''); setAnchor(event.currentTarget) }}>{value ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}{triggerLabel ? <span>{triggerLabel}</span> : null}</button>
    {anchor ? <AnchoredPopover anchor={anchor} ariaLabel="关联待办项目" className="todo-project-picker" onDismiss={() => { if (!pending.current) setAnchor(null) }}>
      <header><b>项目与阶段<span>可选</span></b><button aria-label="关闭项目选择" disabled={busy} onClick={() => setAnchor(null)}><X size={13} /></button></header>
      <p>{automatic && value ? '自动关联：' : value ? '当前关联：' : ''}{label}</p>
      {value && !selectingProject && allowStageSelection ? <section className="todo-linked-stage">
        <label>所属阶段<AppSelect aria-label="所属阶段" value={stageKey ?? ''} disabled={busy || !selected || stageData?.projectId !== value} onChange={(event) => void choose(value, event.currentTarget.value as StageTimeKey || null)}>
          <option value="">未指定阶段</option>
          {stageKey && !stages.some((stage) => stage.key === stageKey) ? <option value={stageKey} disabled>{projectModuleLabels[stageKey]}（不可用）</option> : null}
          {stages.filter((stage) => stage.enabled || stage.key === stageKey).map((stage) => <option key={stage.key} value={stage.key} disabled={!stage.enabled}>{projectModuleLabels[stage.key]}{stage.enabled ? '' : '（已隐藏）'}</option>)}
        </AppSelect></label>
        {todo && linkedStage?.enabled ? <TodoStageTimeControls key={`${todo.id}:${value}:${stageKey}`} todo={todo} stage={linkedStage} onBusyChange={value => { pending.current = value; setBusy(value) }} onChanged={async () => { if (value) setStageData({ projectId: value, stages: await window.creatorOS!.getTodoProjectStages(value) }); await refresh() }} /> : null}
      </section> : null}
      {value && !selectingProject ? <div className="todo-link-actions"><button disabled={busy} onClick={() => { setSelectingProject(true) }}>更换关联项目</button><button disabled={busy} onClick={() => void choose(null, null)}>不关联项目</button></div> : <>
      {value ? <button className="todo-link-back" onClick={() => setSelectingProject(false)}>返回当前关联</button> : null}
      <input autoFocus aria-label="搜索关联项目" placeholder="搜索项目名称或简称" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      <label className="todo-project-history"><input type="checkbox" checked={includeClosed} onChange={event => setIncludeClosed(event.currentTarget.checked)} />显示已完成／归档项目</label>
      <div className="todo-project-options" role="group" aria-label="可关联项目">
        <button disabled={busy} onClick={() => void choose(null, null)}>不关联项目{!value ? <Check size={12} /> : null}</button>
        {visible.map((project) => <button key={project.id} disabled={busy} onClick={() => void choose(project.id, project.id === value ? stageKey : draftTitle ? recommendedTodoStageForProject(draftTitle, project, snapshot.preferences.todoStageMemories) : null, 'suggested')}><span>{project.title}{candidateIds.includes(project.id) ? <small>可能相关</small> : null}</span>{value === project.id ? <Check size={12} /> : null}</button>)}
        {!visible.length ? <p>没有匹配项目，可以保持不关联</p> : null}
      </div>
      </>}
      {error ? <p role="alert">{error}</p> : null}
    </AnchoredPopover> : null}
  </>
}
