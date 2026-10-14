import { useEffect, useRef, useState } from 'react'
import { TODO_STAGE_START_OFFER, type TodoStageStartOffer } from '../utils/todo-completion'
import { projectModuleLabels } from '../utils/project-labels'
import { useWorkspaceStore } from '../store/workspace'
import { AnchoredPopover } from './AnchoredPopover'
import { AppSelect } from './AppSelect'
import type { StageTimeKey, TodoSegment } from '../../../shared/domain'

function StartPrompt({ offer, onClose }: { offer: TodoStageStartOffer; onClose(): void }): React.JSX.Element {
  const candidate = offer.candidate
  const [stageKey, setStageKey] = useState<StageTimeKey | ''>(candidate?.stageKey ?? '')
  const [date, setDate] = useState(candidate?.plannedDate ?? '')
  const [segment, setSegment] = useState<TodoSegment>(candidate?.segment ?? 'morning')
  const [editingDate, setEditingDate] = useState(!candidate?.plannedDate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(offer.error ?? '')
  const pending = useRef(false)
  const requestId = useRef(crypto.randomUUID())
  const confirm = async (): Promise<void> => {
    if (!candidate || !stageKey || !date || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      if (!window.creatorOS) throw new Error('App尚未准备好')
      await window.creatorOS.confirmTodoStageStart({ todoId: candidate.todoId, projectId: candidate.projectId, stageKey, expectedTitle: candidate.title, expectedLinkedStageKey: candidate.linkedStageKey, expectedStageLinkSource: candidate.stageLinkSource, expectedPlannedDate: candidate.plannedDate, expectedSegment: candidate.segment, startedAt: { localDate: date, segment }, requestId: requestId.current })
      await useWorkspaceStore.getState().refresh()
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '阶段开始失败') }
    finally { pending.current = false; setBusy(false) }
  }
  return <AnchoredPopover anchor={offer.anchor?.isConnected ? offer.anchor : document.body} anchorPoint={offer.point} ariaLabel="确认阶段开始" className="todo-stage-start-prompt" onDismiss={() => { if (!pending.current) onClose() }}>
    {candidate ? <>
      <header><b>{stageKey ? `开始${projectModuleLabels[stageKey]}阶段？` : '选择要开始的阶段'}</b></header>
      <p className="todo-stage-start-project">{candidate.projectTitle}</p>
      <div className="todo-stage-start-choice">
        <AppSelect aria-label="要开始的阶段" value={stageKey} disabled={busy} onChange={event => setStageKey(event.currentTarget.value as StageTimeKey | '')}>
          <option value="" disabled>请选择阶段</option>
          {candidate.availableStageKeys.map(key => <option key={key} value={key}>{projectModuleLabels[key]}{candidate.recommendedStageKey === key ? '（文字推荐）' : ''}</option>)}
        </AppSelect>
        {candidate.reason === 'manual' ? <span>已手动指定</span> : !candidate.stageKey ? <span>{candidate.reason === 'ambiguous' ? '涉及多个阶段，请选择' : '暂时无法判断，请选择'}</span> : null}
      </div>
      {stageKey && stageKey !== candidate.linkedStageKey ? <p className="todo-stage-start-change">{candidate.linkedStageKey ? `将待办从${projectModuleLabels[candidate.linkedStageKey]}改为${projectModuleLabels[stageKey]}` : `同时将待办关联到${projectModuleLabels[stageKey]}`}</p> : null}
      <div className="todo-stage-start-date">
        {editingDate ? <input type="date" aria-label="阶段开始日期" value={date} disabled={busy} onChange={event => setDate(event.currentTarget.value)} /> : <strong>{date.replaceAll('-', '/')}</strong>}
        <AppSelect aria-label="阶段开始时段" value={segment} disabled={busy} onChange={event => setSegment(event.currentTarget.value as TodoSegment)}><option value="morning">上午</option><option value="afternoon">下午</option><option value="evening">晚上</option></AppSelect>
        {!editingDate ? <button disabled={busy} onClick={() => setEditingDate(true)}>改日期</button> : null}
      </div>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    <footer><button disabled={busy} onClick={onClose}>暂不</button>{candidate ? <button className="primary-action" disabled={busy || !date || !stageKey} onClick={() => void confirm()}>{busy ? '保存中…' : '确认开始'}</button> : null}</footer>
  </AnchoredPopover>
}

export function TodoStageStartPrompt(): React.JSX.Element | null {
  const [offers, setOffers] = useState<TodoStageStartOffer[]>([])
  useEffect(() => {
    const receive = (event: Event): void => {
      const offer = (event as CustomEvent<TodoStageStartOffer>).detail
      setOffers(current => current.some(item => item.candidate && item.candidate.todoId === offer.candidate?.todoId) ? current : [...current, offer])
    }
    window.addEventListener(TODO_STAGE_START_OFFER, receive)
    return () => window.removeEventListener(TODO_STAGE_START_OFFER, receive)
  }, [])
  return offers[0] ? <StartPrompt key={offers[0].candidate?.todoId ?? 'error'} offer={offers[0]} onClose={() => setOffers(current => current.slice(1))} /> : null
}
