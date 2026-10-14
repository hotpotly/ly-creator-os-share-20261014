import { Eye, EyeOff, GripVertical, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import {
  DEFAULT_PROJECT_TABLE_LAYOUT,
  PROJECT_TABLE_COLUMNS,
  type ProjectTableColumnKey,
  type ProjectTableLayout
} from '../utils/project-table-columns'
import { AnchoredPopover } from './AnchoredPopover'

const DRAG_MIME = 'application/x-creator-project-column'

export function ProjectColumnManager({
  anchor,
  layout,
  onChange,
  onClose
}: {
  anchor: HTMLElement
  layout: ProjectTableLayout
  onChange(layout: ProjectTableLayout): void
  onClose(): void
}): React.JSX.Element {
  const [dragId, setDragId] = useState<ProjectTableColumnKey | null>(null)
  const [dragOverId, setDragOverId] = useState<ProjectTableColumnKey | null>(null)
  const definitions = new Map(PROJECT_TABLE_COLUMNS.map((column) => [column.key, column]))
  const visible = layout.order.filter((key) => !layout.hidden.includes(key))
  const hidden = layout.order.filter((key) => layout.hidden.includes(key))

  const changeOrder = (nextOrder: ProjectTableColumnKey[]): void => onChange({ ...layout, order: nextOrder })
  const dropBefore = (source: ProjectTableColumnKey, target: ProjectTableColumnKey): void => {
    if (source === target) return
    const order = layout.order.filter((key) => key !== source)
    const index = order.indexOf(target)
    if (index < 0) return
    order.splice(index, 0, source)
    changeOrder(order)
  }
  const nudge = (key: ProjectTableColumnKey, delta: -1 | 1): void => {
    const index = layout.order.indexOf(key)
    const target = index + delta
    if (index < 0 || target < 0 || target >= layout.order.length) return
    const order = [...layout.order]
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    changeOrder(order)
  }
  const setVisible = (key: ProjectTableColumnKey, isVisible: boolean): void => {
    const definition = definitions.get(key)
    if (definition?.required && !isVisible) return
    onChange({
      ...layout,
      hidden: isVisible ? layout.hidden.filter((item) => item !== key) : [...layout.hidden, key]
    })
  }

  return <AnchoredPopover anchor={anchor} ariaLabel="管理内容项目列" className="topic-column-manager project-column-manager" role="dialog" onDismiss={onClose}>
    <header><div><b>管理列</b><span>拖动排序，隐藏暂时不需要的列。</span></div><button aria-label="关闭列管理" onClick={onClose}><X size={13} /></button></header>
    <div className="topic-column-list">{visible.map((key) => {
      const column = definitions.get(key)!
      return <article
        className={`topic-column-article${dragId === key ? ' dragging' : ''}${dragOverId === key ? ' drag-over' : ''}`}
        draggable
        key={key}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DRAG_MIME, key); setDragId(key) }}
        onDragEnd={() => { setDragId(null); setDragOverId(null) }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes(DRAG_MIME)) { event.preventDefault(); setDragOverId(key) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverId((current) => current === key ? null : current) }}
        onDrop={(event) => {
          event.preventDefault()
          const source = event.dataTransfer.getData(DRAG_MIME) as ProjectTableColumnKey
          setDragId(null); setDragOverId(null)
          if (source) dropBefore(source, key)
        }}
      >
        <div className="topic-column-row">
          <button className="topic-column-drag" aria-label={`拖动排序${column.label}，或按Alt+Shift+上下方向键移动`} title="拖动调整顺序" onKeyDown={(event) => {
            if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
              event.preventDefault()
              nudge(key, event.key === 'ArrowUp' ? -1 : 1)
            }
          }}><GripVertical size={12} /></button>
          <span><b>{column.label}</b><small>{column.defaultVisible ? '常用列' : '可选列'}</small></span>
          <button aria-label={`隐藏${column.label}`} disabled={column.required} onClick={() => setVisible(key, false)}><EyeOff size={12} /></button>
        </div>
      </article>
    })}</div>
    {hidden.length ? <div className="topic-column-hidden"><span>可重新添加</span>{hidden.map((key) => <button key={key} onClick={() => setVisible(key, true)}><Eye size={12} />{definitions.get(key)?.label}</button>)}</div> : null}
    <button className="project-column-reset" onClick={() => onChange({
      ...DEFAULT_PROJECT_TABLE_LAYOUT,
      order: [...DEFAULT_PROJECT_TABLE_LAYOUT.order],
      hidden: [...DEFAULT_PROJECT_TABLE_LAYOUT.hidden],
      widths: {}
    })}><RotateCcw size={12} />恢复默认</button>
  </AnchoredPopover>
}
