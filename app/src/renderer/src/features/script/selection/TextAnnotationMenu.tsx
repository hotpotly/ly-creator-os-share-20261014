import { Eraser, Flag, Highlighter, MessageSquarePlus, Strikethrough, Underline, X } from 'lucide-react'
import { AnchoredPopover } from '../../../components/AnchoredPopover'

interface Props {
  anchor: HTMLElement | null
  anchorPoint?: { x: number; y: number } | null
  note: string
  onNoteChange(note: string): void
  onApply(style: 'highlight' | 'underline' | 'strike' | 'flag', note: string): void
  onClear(): void
  onDismiss(): void
}

export function TextAnnotationMenu({ anchor, anchorPoint, note, onNoteChange, onApply, onClear, onDismiss }: Props): React.JSX.Element | null {
  return <AnchoredPopover anchor={anchor} anchorPoint={anchorPoint} ariaLabel="工作台标记" className="text-annotation-popover" onDismiss={onDismiss}>
    <header><div><b>工作台标记</b><small>不会进入正文导出</small></div><button aria-label="关闭标记" onClick={onDismiss}><X size={14} /></button></header>
    <div className="text-annotation-actions">
      <button onClick={() => onApply('highlight', note)}><Highlighter size={14} />高亮</button>
      <button onClick={() => onApply('underline', note)}><Underline size={14} />下划线</button>
      <button onClick={() => onApply('strike', note)}><Strikethrough size={14} />删除线</button>
      <button onClick={() => onApply('flag', note)}><Flag size={14} />旗标</button>
    </div>
    <label><span><MessageSquarePlus size={13} />备注（可单独保存）</span><textarea autoFocus value={note} onChange={(event) => onNoteChange(event.currentTarget.value)} placeholder="记下需要核对或修改的内容" /></label>
    <button className="annotation-save-note" disabled={!note.trim()} onClick={() => onApply('flag', note)}><MessageSquarePlus size={13} />保存备注并添加旗标</button>
    <button className="annotation-clear" onClick={onClear}><Eraser size={13} />清除当前范围的工作台标记</button>
  </AnchoredPopover>
}
