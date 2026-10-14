import { useState, type ReactNode } from 'react'
import { TodoProjectPicker } from './TodoProjectPicker'

/** Draft-only selection: choosing a project never writes a todo until Create. */
export function TodoDraftBatchSelection({ items, disabled = false, onApply, children }: {
  items: { id: string; title: string }[]
  disabled?: boolean
  onApply(ids: string[], projectId: string | null): void
  children(checkbox: (id: string, title: string) => ReactNode): ReactNode
}): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const ids = selected.filter(id => items.some(item => item.id === id))
  const all = items.length > 0 && ids.length === items.length
  const checkbox = (id: string, title: string): ReactNode => <input className="todo-draft-checkbox" type="checkbox" aria-label={`选择草稿：${title}`} disabled={disabled} checked={ids.includes(id)} onChange={event => { setNotice(''); setSelected(current => event.target.checked ? [...current, id] : current.filter(value => value !== id)) }} />
  return <>
    <div className="todo-draft-batch-toolbar" role="group" aria-label="创建前批量关联">
      <label><input className="todo-draft-checkbox" type="checkbox" aria-label="全选草稿" disabled={disabled || !items.length} checked={all} ref={node => { if (node) node.indeterminate = ids.length > 0 && !all }} onChange={() => { setNotice(''); setSelected(all ? [] : items.map(item => item.id)) }} />全选</label>
      <span>{ids.length ? `已选${ids.length}条` : `共${items.length}条`}</span>
      <TodoProjectPicker value={null} triggerLabel="绑定项目" disabled={disabled || !ids.length} allowStageSelection={false} closeAfterChoose onChange={projectId => { onApply(ids, projectId); setNotice(projectId ? `已绑定${ids.length}条` : `已取消${ids.length}条关联`); setSelected([]) }} />
      <span className="visually-hidden" role="status">{notice}</span>
    </div>
    {children(checkbox)}
  </>
}
