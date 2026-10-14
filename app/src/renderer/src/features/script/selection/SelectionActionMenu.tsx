import { Eraser, Flag, Highlighter, Layers3, MessageSquarePlus, PencilLine, Strikethrough, Underline } from 'lucide-react'
import { AnchoredPopover } from '../../../components/AnchoredPopover'

interface Props {
  anchor: HTMLElement | null
  anchorPoint?: { x: number; y: number } | null
  selectionLabel: string
  allowFusion?: boolean
  onDismiss(): void
  onRewrite(): void
  onFusion?(): void
  onAnnotation(style: 'highlight' | 'underline' | 'strike' | 'flag'): void
  onNote(): void
  onClear?(): void
  children?: React.ReactNode
}

export function SelectionActionMenu({ anchor, anchorPoint, selectionLabel, allowFusion = false, onDismiss, onRewrite, onFusion, onAnnotation, onNote, onClear, children }: Props): React.JSX.Element | null {
  return <AnchoredPopover anchor={anchor} anchorPoint={anchorPoint} ariaLabel="选区操作" role="menu" className="selection-action-popover" onDismiss={onDismiss}>
    <div className="selection-action-summary"><span>已选内容</span><p>{selectionLabel}</p></div>
    <button role="menuitem" onClick={onRewrite}><PencilLine size={15} /><span><b>按具体要求修改…</b><small>先生成局部候选，不会直接覆盖</small></span></button>
    {allowFusion ? <button role="menuitem" onClick={onFusion}><Layers3 size={15} /><span><b>加入综合候选…</b><small>可继续从其他来源选取</small></span></button> : null}
    <div className="selection-annotation-grid" role="group" aria-label="工作台标记">
      <button role="menuitem" title="高亮" onClick={() => onAnnotation('highlight')}><Highlighter size={14} /><span>高亮</span></button>
      <button role="menuitem" title="下划线" onClick={() => onAnnotation('underline')}><Underline size={14} /><span>下划线</span></button>
      <button role="menuitem" title="删除线" onClick={() => onAnnotation('strike')}><Strikethrough size={14} /><span>删除线</span></button>
      <button role="menuitem" title="旗标" onClick={() => onAnnotation('flag')}><Flag size={14} /><span>旗标</span></button>
    </div>
    <button role="menuitem" onClick={onNote}><MessageSquarePlus size={15} /><span><b>添加备注…</b><small>工作台标记·不会进入正文导出</small></span></button>
    {onClear ? <button role="menuitem" onClick={onClear}><Eraser size={15} /><span><b>清除标记</b><small>只清除所选范围内的工作台标记</small></span></button> : null}
    {children ? <div className="selection-workbench-actions">{children}</div> : null}
  </AnchoredPopover>
}
