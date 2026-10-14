import { Check, Footprints, Pencil, Undo2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import type { TodoDay } from '../../../shared/todo-day'

type ConfettiStyle = CSSProperties & { '--confetti-x': string; '--confetti-y': string; '--confetti-turn': string; '--confetti-delay': string }
const confetti = Array.from({ length: 24 }, (_, index): ConfettiStyle => {
  const angle = ((index * 137.5) % 360) * Math.PI / 180
  const radius = 65 + index % 4 * 16
  return { '--confetti-x': `${Math.cos(angle) * radius}px`, '--confetti-y': `${Math.sin(angle) * radius - 28}px`, '--confetti-turn': `${index % 2 ? 210 : -180}deg`, '--confetti-delay': `${index % 4 * 18}ms` }
})

export function TodoSmallStep({ entry, busy, celebrating = false, onSave, onDismissCelebration }: { entry: TodoDay; busy: boolean; celebrating?: boolean; onSave(patch: Partial<Omit<TodoDay, 'day' | 'revision'>>, expectedRevision?: number): Promise<boolean>; onDismissCelebration(): void }): React.JSX.Element {
  const [revision, setRevision] = useState(entry.revision)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.smallStep)
  return <section className="todo-small-step" data-celebrating={celebrating || undefined} data-completed={entry.smallCompleted || undefined} aria-label="一小步">
    <div className="todo-small-content">
      <div className="todo-small-emblem" data-completed={entry.smallCompleted || undefined} aria-hidden="true">
        {entry.smallCompleted ? <Check size={28} strokeWidth={2.4} /> : <Footprints size={28} strokeWidth={1.7} />}
        {celebrating ? <div className="todo-small-confetti">{confetti.map((style, index) => <i key={index} style={style} />)}</div> : null}
      </div>
      {editing ? <form onSubmit={event => { event.preventDefault(); if (draft.trim()) void onSave({ smallStep: draft.trim(), smallCompleted: false }, revision).then(saved => { if (saved) setEditing(false); else setRevision(useWorkspaceStore.getState().snapshot.todoDays?.find(value => value.day === entry.day)?.revision ?? entry.revision) }) }}>
        <textarea autoFocus aria-label="一小步内容" maxLength={300} rows={3} value={draft} disabled={busy} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
        }} />
        <div><button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button><button type="submit" disabled={busy || !draft.trim()}>保存</button></div>
      </form> : <>
        <div className="todo-small-copy"><h2>{entry.smallCompleted ? '一小步已完成' : entry.smallStep}</h2>{entry.smallCompleted ? <p className="todo-small-result">{entry.smallStep}</p> : null}{!entry.smallCompleted ? <button className="todo-small-edit" type="button" aria-label="修改一小步" disabled={busy || celebrating} onClick={() => { setRevision(entry.revision); setDraft(entry.smallStep); setEditing(true) }}><Pencil size={14} /></button> : null}</div>
        {!entry.smallCompleted ? <button type="button" className="primary-action todo-small-complete" disabled={busy} onClick={() => void onSave({ smallCompleted: true, view: 'regular' })}><Check size={16} />这一步做到了</button> : null}
        {entry.smallCompleted ? <button type="button" className="todo-small-undo" aria-label={celebrating ? '撤销一小步完成' : '撤销完成'} disabled={busy} onClick={() => { onDismissCelebration(); void onSave({ smallCompleted: false, view: 'small' }) }}><Undo2 size={12} />撤销完成</button> : null}
      </>}
      <span className="todo-small-status" role="status">{celebrating ? '一小步已完成' : ''}</span>
    </div>
  </section>
}
