import { ArrowDown, ArrowUp, LockKeyhole, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { TopicStageDefinition } from '../../../shared/domain'
import { AnchoredPopover } from './AnchoredPopover'

interface TopicStageManagerProps {
  anchor: HTMLElement
  stages: TopicStageDefinition[]
  topicCounts: Map<string, number>
  onChanged(): Promise<unknown>
  onClose(): void
}

export function TopicStageManager({ anchor, stages, topicCounts, onChanged, onClose }: TopicStageManagerProps): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingNextActionLabel, setEditingNextActionLabel] = useState('')
  const [newName, setNewName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setWorking(true); setError(''); setNotice('')
    try { await action(); await onChanged(); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : '阶段保存失败'); return false }
    finally { setWorking(false) }
  }

  const move = (stageId: string, delta: -1 | 1): void => {
    const standardStages = stages.filter((stage) => stage.role === 'standard')
    const index = standardStages.findIndex((stage) => stage.id === stageId)
    const target = index + delta
    if (!window.creatorOS || index < 0 || target < 0 || target >= standardStages.length) return
    const standardIds = standardStages.map((stage) => stage.id)
    ;[standardIds[index], standardIds[target]] = [standardIds[target]!, standardIds[index]!]
    const ids = [...standardIds, ...stages.filter((stage) => stage.role !== 'standard').map((stage) => stage.id)]
    void run(() => window.creatorOS!.reorderTopicStages(ids))
  }

  const beginEdit = (stage: TopicStageDefinition): void => {
    setEditingId(stage.id); setEditingName(stage.name); setEditingNextActionLabel(stage.nextActionLabel ?? ''); setDeletingId(null); setError(''); setNotice('')
  }

  const deleteStage = async (stage: TopicStageDefinition): Promise<void> => {
    if (!window.creatorOS) return
    let message = ''
    const saved = await run(async () => {
      const result = await window.creatorOS!.deleteTopicStage(stage.id)
      message = result.reassignedTopicCount ? `已删除，${result.reassignedTopicCount}个选题移到「${result.replacementStageName}」` : '阶段已删除'
    })
    if (saved) { setDeletingId(null); setNotice(message) }
  }

  return <AnchoredPopover anchor={anchor} ariaLabel="管理选题阶段" className="topic-stage-manager" role="dialog" onDismiss={onClose}>
    <header><div><b>管理阶段</b><span>顺序决定真实动作；显示文案只负责说明</span></div><button aria-label="关闭阶段管理" onClick={onClose}><X size={13} /></button></header>
    <div className="topic-stage-list">{stages.map((stage) => { const standardStages = stages.filter((item) => item.role === 'standard'); const standardIndex = standardStages.findIndex((item) => item.id === stage.id); const system = stage.role !== 'standard'; return <article key={stage.id}>
      {editingId === stage.id ? <div className="topic-stage-edit"><div className="topic-stage-edit-fields"><label>阶段名称<input autoFocus aria-label={`编辑${stage.name}阶段名称`} maxLength={40} value={editingName} onChange={(event) => setEditingName(event.currentTarget.value)} /></label><label>下一步显示文案<input aria-label={`编辑${stage.name}下一步显示文案`} maxLength={80} placeholder="留空时显示下一阶段名称" value={editingNextActionLabel} onChange={(event) => setEditingNextActionLabel(event.currentTarget.value)} /></label></div><div className="topic-stage-edit-actions"><button onClick={() => setEditingId(null)}>取消</button><button className="primary-action" disabled={working || !editingName.trim()} onClick={() => void run(() => window.creatorOS!.updateTopicStage(stage.id, editingName, editingNextActionLabel)).then((saved) => { if (saved) setEditingId(null) })}>保存</button></div></div> : <div className="topic-stage-row">
        <span><b>{stage.name}{system ? <LockKeyhole size={11} aria-label="系统阶段" /> : null}</b><small>{topicCounts.get(stage.id) ?? 0}个选题{system ? '·系统阶段' : stage.nextActionLabel ? `·下一步：${stage.nextActionLabel}` : '·使用下一阶段名称'}</small></span>
        <button aria-label={`上移${stage.name}`} disabled={working || system || standardIndex === 0} onClick={() => move(stage.id, -1)}><ArrowUp size={12} /></button>
        <button aria-label={`下移${stage.name}`} disabled={working || system || standardIndex === standardStages.length - 1} onClick={() => move(stage.id, 1)}><ArrowDown size={12} /></button>
        <button aria-label={`改名${stage.name}`} disabled={working || system} onClick={() => beginEdit(stage)}><Pencil size={12} /></button>
        <button className="topic-stage-delete" aria-label={`删除${stage.name}`} disabled={working || system || standardStages.length <= 1} onClick={() => setDeletingId((current) => current === stage.id ? null : stage.id)}><Trash2 size={12} /></button>
      </div>}
      {deletingId === stage.id ? <div className="topic-stage-delete-confirm"><span>{(topicCounts.get(stage.id) ?? 0) > 0 ? `删除后，${topicCounts.get(stage.id)}个选题会自动移到相邻阶段。` : '删除这个阶段？'}</span><button onClick={() => setDeletingId(null)}>取消</button><button className="danger-text" disabled={working} onClick={() => void deleteStage(stage)}>删除</button></div> : null}
    </article> })}</div>
    <div className="topic-stage-add"><input aria-label="新阶段名称" maxLength={40} placeholder="新增阶段" value={newName} onChange={(event) => setNewName(event.currentTarget.value)} /><button disabled={working || !newName.trim()} onClick={() => void run(() => window.creatorOS!.createTopicStage(newName)).then((saved) => { if (saved) setNewName('') })}><Plus size={12} />新增</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p className="topic-stage-notice" role="status">{notice}</p> : null}
  </AnchoredPopover>
}
