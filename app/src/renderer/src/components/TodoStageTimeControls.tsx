import { useRef, useState } from 'react'
import type { StageTimePoint, TodoItem, TodoProjectStage, TodoStageTimeInput } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { AppSelect } from './AppSelect'

const segments = { morning: '上午', afternoon: '下午', evening: '晚上' }
function formatTodoStagePoint(point: StageTimePoint | null): string {
  return point ? `${point.localDate.replaceAll('-', '/')} ${segments[point.segment]}` : '未记录'
}
function PointInput({ label, point, defaultPoint, disabled, onChange }: { label: string; point: StageTimePoint | null; defaultPoint: StageTimePoint; disabled: boolean; onChange(value: StageTimePoint | null): void }): React.JSX.Element {
  return <div className="todo-stage-time-point"><label>{label}<input type="date" aria-label={`${label}日期`} value={point?.localDate ?? ''} disabled={disabled} onChange={event => onChange(event.currentTarget.value ? { localDate: event.currentTarget.value, segment: point?.segment ?? defaultPoint.segment } : null)} /></label><AppSelect aria-label={`${label}时段`} value={point?.segment ?? defaultPoint.segment} disabled={disabled || !point} onChange={event => point && onChange({ ...point, segment: event.currentTarget.value as StageTimePoint['segment'] })}>{Object.entries(segments).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</AppSelect></div>
}

export function TodoStageTimeControls({ todo, stage, onBusyChange, onChanged }: { todo: TodoItem; stage: TodoProjectStage; onBusyChange(busy: boolean): void; onChanged(): Promise<void> }): React.JSX.Element {
  const todos = useWorkspaceStore(state => state.snapshot.todos)
  const [draft, setDraft] = useState<{ input: TodoStageTimeInput; currentPoint: StageTimePoint; wasCompleted: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const name = projectModuleLabels[stage.key]
  const open = (action: TodoStageTimeInput['action']): void => {
    setError(''); setNotice('')
    setDraft({ currentPoint: stage.currentPoint, wasCompleted: Boolean(stage.completedAt), input: {
      todoId: todo.id, projectId: todo.projectId!, stageKey: stage.key, expectedRevision: stage.revision, expectedTodoUpdatedAt: todo.updatedAt,
      action, startedAt: action === 'start' ? stage.currentPoint : stage.startedAt,
      completedAt: action === 'complete' ? stage.currentPoint : stage.actualCompletedAt,
      confirmedOpenTodoIds: todos.filter(item => item.projectId === todo.projectId && item.stageKey === stage.key && item.status === 'open').map(item => item.id), requestId: crypto.randomUUID()
    } })
  }
  const save = async (): Promise<void> => {
    if (!draft || pending.current || !window.creatorOS) return
    pending.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      await window.creatorOS.setTodoLinkedStageTime(draft.input)
      setDraft(null); setNotice('阶段时间已保存，待办与排期保持原样')
      await onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '阶段时间保存失败') }
    finally { pending.current = false; setBusy(false); onBusyChange(false) }
  }
  const reopen = async (): Promise<void> => {
    if (pending.current || !window.creatorOS) return
    pending.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      await window.creatorOS.setTodoLinkedStageCompleted({ todoId: todo.id, projectId: todo.projectId!, stageKey: stage.key, completed: false, expectedCompletedAt: stage.completedAt, requestId: crypto.randomUUID() })
      setNotice('阶段已重新打开'); await onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '阶段保存失败') }
    finally { pending.current = false; setBusy(false); onBusyChange(false) }
  }
  const completing = draft?.input.completedAt && !draft.wasCompleted
  return <section className="todo-stage-time-controls" aria-label={`${name}阶段时间`}>
    {!draft ? <dl className="todo-stage-time-summary"><div><dt>当前排期</dt><dd>{stage.plannedStartAt || stage.plannedEndAt ? `${formatTodoStagePoint(stage.plannedStartAt)} → ${formatTodoStagePoint(stage.plannedEndAt)}` : '未排期'}</dd></div><div><dt>实际开始</dt><dd>{formatTodoStagePoint(stage.startedAt)}</dd></div><div><dt>实际完成</dt><dd>{formatTodoStagePoint(stage.actualCompletedAt)}</dd></div></dl> : null}
    {!draft ? <div className="todo-stage-time-actions">
      {stage.status === 'not_started' && !stage.startedAt && !stage.completedAt ? <button className="todo-stage-action" disabled={busy} onClick={() => open('start')}>开始{name}阶段</button> : null}
      <button className="todo-stage-action" disabled={busy} onClick={() => stage.completedAt ? void reopen() : open('complete')}>{stage.completedAt ? `重新打开${name}阶段` : `完成${name}阶段`}</button>
      <button className="todo-stage-action" disabled={busy} onClick={() => open('edit')}>补记／更正时间</button>
    </div> : <div className="todo-stage-confirm" role="group" aria-label={draft.input.action === 'complete' ? '确认完成阶段' : draft.input.action === 'start' ? '确认开始阶段' : '补记阶段时间'}>
      <PointInput label="实际开始" point={draft.input.startedAt} defaultPoint={draft.currentPoint} disabled={busy} onChange={startedAt => setDraft({ ...draft, input: { ...draft.input, startedAt } })} />
      {draft.input.action !== 'start' ? <PointInput label="实际完成" point={draft.input.completedAt} defaultPoint={draft.currentPoint} disabled={busy} onChange={completedAt => setDraft({ ...draft, input: { ...draft.input, completedAt } })} /> : null}
      {completing ? <><p>{draft.input.confirmedOpenTodoIds.length ? `还有${draft.input.confirmedOpenTodoIds.length}条待办未完成，仍要结束这个阶段吗？` : '确认完成这个阶段？'}待办不会被一起勾选。</p>{stage.key === 'publishing' ? <p>发布阶段完成后，项目也会标记为已发布。</p> : null}</> : null}
      <button disabled={busy} onClick={() => { setDraft(null); setError('') }}>取消</button><button disabled={busy || (!draft.input.startedAt && !draft.input.completedAt)} onClick={() => void save()}>{busy ? '保存中…' : draft.input.action === 'complete' ? '确认完成阶段' : draft.input.action === 'start' ? '确认开始阶段' : '保存阶段时间'}</button>
    </div>}
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>
}
