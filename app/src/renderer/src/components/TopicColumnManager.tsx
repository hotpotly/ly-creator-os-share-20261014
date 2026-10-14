import { AppSelect } from './AppSelect'
import { Eye, EyeOff, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { TopicColumnDataType, TopicColumnDefinition } from '../../../shared/domain'
import { AnchoredPopover } from './AnchoredPopover'

interface Props {
  anchor: HTMLElement
  columns: TopicColumnDefinition[]
  onChanged(): Promise<unknown>
  onClose(): void
}

const typeLabels: Record<'text' | 'number' | 'date', string> = { text: '文字', number: '数字', date: '日期' }
const DRAG_MIME = 'application/x-creator-topic-column'

export function TopicColumnManager({ anchor, columns, onChanged, onClose }: Props): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'text' | 'number' | 'date'>('text')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const visible = columns.filter((column) => column.isVisible)
  const hidden = columns.filter((column) => !column.isVisible)

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setWorking(true); setError('')
    try { await action(); await onChanged(); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : '列保存失败'); return false }
    finally { setWorking(false) }
  }

  // 只重排可见列，隐藏列保持原槽位；reorderTopicColumns 要求全量、不重不缺的 id 顺序
  const applyVisibleOrder = (orderedVisibleIds: string[]): void => {
    if (!window.creatorOS) return
    let cursor = 0
    const ids = columns.map((column) => column.isVisible ? orderedVisibleIds[cursor++]! : column.id)
    void run(() => window.creatorOS!.reorderTopicColumns(ids))
  }

  const dropBefore = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return
    const order = visible.map((column) => column.id).filter((id) => id !== sourceId)
    const target = order.indexOf(targetId)
    if (target < 0) return
    order.splice(target, 0, sourceId)
    applyVisibleOrder(order)
  }

  const nudge = (columnId: string, delta: -1 | 1): void => {
    const index = visible.findIndex((column) => column.id === columnId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= visible.length) return
    const order = visible.map((column) => column.id)
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    applyVisibleOrder(order)
  }

  return <AnchoredPopover anchor={anchor} ariaLabel="管理选题列" className="topic-column-manager" role="dialog" onDismiss={onClose}>
    <header><div><b>管理列</b><span>可改名、增删，拖动手柄调整顺序。</span></div><button aria-label="关闭列管理" onClick={onClose}><X size={13} /></button></header>
    <div className="topic-column-list">{visible.map((column) => <article
      key={column.id}
      className={`topic-column-article${dragId === column.id ? ' dragging' : ''}${dragOverId === column.id ? ' drag-over' : ''}`}
      draggable={editingId !== column.id && deletingId !== column.id && !working}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DRAG_MIME, column.id); setDragId(column.id) }}
      onDragEnd={() => { setDragId(null); setDragOverId(null) }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(DRAG_MIME)) { event.preventDefault(); setDragOverId(column.id) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverId((current) => current === column.id ? null : current) }}
      onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData(DRAG_MIME); setDragId(null); setDragOverId(null); if (sourceId) dropBefore(sourceId, column.id) }}
    >
      {editingId === column.id
        ? <div className="topic-column-edit"><input autoFocus maxLength={40} value={editingName} onChange={(event) => setEditingName(event.currentTarget.value)} /><button onClick={() => setEditingId(null)}>取消</button><button className="primary-action" disabled={working || !editingName.trim()} onClick={() => void run(() => window.creatorOS!.updateTopicColumn(column.id, { name: editingName })).then((saved) => { if (saved) setEditingId(null) })}>保存</button></div>
        : <div className="topic-column-row"><button className="topic-column-drag" aria-label={`拖动排序${column.name}，或按Alt+Shift+上下方向键移动`} title="拖动调整顺序" disabled={working} onKeyDown={(event) => { if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); nudge(column.id, event.key === 'ArrowUp' ? -1 : 1) } }}><GripVertical size={12} /></button><span><b>{column.name}</b><small>{column.builtinKey ? '系统列' : typeLabels[column.dataType as keyof typeof typeLabels]}</small></span><button aria-label={`改名${column.name}`} disabled={working} onClick={() => { setEditingId(column.id); setEditingName(column.name); setDeletingId(null) }}><Pencil size={12} /></button><button aria-label={`删除${column.name}`} disabled={working || column.builtinKey === 'title'} onClick={() => setDeletingId((current) => current === column.id ? null : column.id)}>{column.builtinKey ? <EyeOff size={12} /> : <Trash2 size={12} />}</button></div>}
      {deletingId === column.id ? <div className="topic-column-delete-confirm"><span>{column.builtinKey ? '隐藏后可以随时重新添加。' : '删除后，这一列填写的内容也会删除。'}</span><button onClick={() => setDeletingId(null)}>取消</button><button className="danger-text" onClick={() => void run(() => window.creatorOS!.deleteTopicColumn(column.id)).then((saved) => { if (saved) setDeletingId(null) })}>{column.builtinKey ? '隐藏' : '删除'}</button></div> : null}
    </article>)}</div>
    {hidden.length ? <div className="topic-column-hidden"><span>可重新添加</span>{hidden.map((column) => <button key={column.id} disabled={working} onClick={() => void run(() => window.creatorOS!.updateTopicColumn(column.id, { isVisible: true }))}><Eye size={12} />{column.name}</button>)}</div> : null}
    <div className="topic-column-add"><input maxLength={40} placeholder="新列名称" value={newName} onChange={(event) => setNewName(event.currentTarget.value)} /><AppSelect aria-label="新列类型" value={newType} onChange={(event) => setNewType(event.currentTarget.value as Extract<TopicColumnDataType, 'text' | 'number' | 'date'>)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AppSelect><button disabled={working || !newName.trim()} onClick={() => void run(() => window.creatorOS!.createTopicColumn(newName, newType)).then((saved) => { if (saved) setNewName('') })}><Plus size={12} />新增</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </AnchoredPopover>
}
