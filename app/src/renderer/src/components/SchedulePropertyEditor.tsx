import type { ScheduleDisplayItem } from '../../../shared/schedule-group'
import { useRef, useState } from 'react'
import type { ProjectSummary, ScheduleItem, ProjectModuleKey } from '../../../shared/domain'
import { projectModuleLabels } from '../utils/project-labels'
import { AnchoredPopover } from './AnchoredPopover'
import { AppSelect } from './AppSelect'

export type ScheduleProperty = 'title' | 'stage' | 'projectTitle'
export function SchedulePropertyEditor({ anchor, point, item, project, field, onSaved, onClose }: {
  anchor: HTMLElement; point?: { x: number; y: number }; item: ScheduleDisplayItem; project?: ProjectSummary; field: ScheduleProperty
  onSaved(): Promise<unknown>; onClose(): void
}): React.JSX.Element {
  const [title, setTitle] = useState(field === 'projectTitle' ? project?.title ?? '' : item.members ? item.title.slice(0, -(item.members.map(member => projectModuleLabels[member.actionType as ProjectModuleKey] ?? member.actionType).join('／').length)).replace(/·$/, '') : item.title)
  const [memberId, setMemberId] = useState(item.id)
  const [stage, setStage] = useState(item.actionType)
  const selectedMember = item.members?.find(member => member.id === memberId) ?? item
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const label = field === 'stage' ? '修改排期阶段' : field === 'projectTitle' ? '修改项目名称' : '修改排期名称'
  const stages = (project?.enabledModuleKeys ?? []).filter((key) => !['business', 'feedback'].includes(key))
  const save = async (): Promise<void> => {
    if (busyRef.current || !window.creatorOS) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      if (field === 'projectTitle') {
        if (!project) throw new Error('这条安排没有关联项目')
        await window.creatorOS.renameProject(project.id, title.trim())
      } else if (field === 'stage') {
        const oldLabel = projectModuleLabels[selectedMember.actionType as ProjectModuleKey] ?? selectedMember.actionType
        const nextLabel = stage === 'overview' ? '项目推进' : projectModuleLabels[stage as ProjectModuleKey] ?? stage
        const nextTitle = selectedMember.title === oldLabel ? nextLabel : item.members && selectedMember.title.endsWith(`·${oldLabel}`) ? `${selectedMember.title.slice(0, -oldLabel.length)}${nextLabel}` : selectedMember.title
        await window.creatorOS.updateSchedule(memberId, { actionType: stage, title: nextTitle })
      } else await window.creatorOS.updateSchedule(item.id, { title: title.trim() })
      await onSaved(); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <AnchoredPopover anchor={anchor} anchorPoint={point} ariaLabel={label} className="schedule-property-editor" onDismiss={() => { if (!busy) onClose() }}>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <header><b>{label}</b><small>{project?.title ?? '其他安排'}</small></header>
      {field === 'stage' && item.members ? <label>要修改的阶段<AppSelect aria-label="要修改的阶段" disabled={busy} value={memberId} onChange={event => { const member = item.members!.find(member => member.id === event.target.value)!; setMemberId(member.id); setStage(member.actionType) }}>{item.members.map(member => <option key={member.id} value={member.id}>{projectModuleLabels[member.actionType as ProjectModuleKey] ?? member.actionType}</option>)}</AppSelect></label> : null}
      {field === 'stage' ? <label>排期阶段<AppSelect autoFocus aria-label="排期阶段" value={stage} onChange={(event) => setStage(event.target.value as ScheduleItem['actionType'])} disabled={busy}>
        {!item.members && item.scheduleKind !== 'hard_deadline' ? <option value="overview">不关联阶段</option> : null}
        {!stages.includes(selectedMember.actionType as typeof stages[number]) && selectedMember.actionType !== 'overview' ? <option value={selectedMember.actionType} disabled>{(projectModuleLabels[selectedMember.actionType as ProjectModuleKey] ?? selectedMember.actionType)}（已停用）</option> : null}
        {stages.map((key) => <option key={key} value={key} disabled={item.members?.some(member => member.id !== memberId && member.actionType === key)}>{projectModuleLabels[key]}</option>)}
      </AppSelect></label> : <label>{field === 'projectTitle' ? '项目名称' : '排期名称'}<input autoFocus aria-label={field === 'projectTitle' ? '项目名称' : '排期名称'} value={title} maxLength={field === 'projectTitle' ? 80 : 300} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>}
      <p>{field === 'stage' ? '只调整这条排期的关联阶段，不改变项目当前进度；自定义名称保留。' : field === 'projectTitle' ? '项目名称会同步更新到所有页面。' : item.members ? '名称应用于整组，项目名称不变。' : '只修改这条排期，项目名称不变。'}</p>
      {field === 'stage' && item.scheduleKind === 'publish_date' && stage !== 'publishing' ? <p>离开发布阶段后，这条安排将改为普通计划。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-action" disabled={busy || (field !== 'stage' && !title.trim())}>{busy ? '保存中…' : '保存'}</button></footer>
    </form>
  </AnchoredPopover>
}
