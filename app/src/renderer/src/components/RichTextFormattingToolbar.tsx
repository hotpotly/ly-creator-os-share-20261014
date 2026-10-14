import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, Heading1, Heading2, Heading3, List, Strikethrough, Underline } from 'lucide-react'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../../../shared/rich-text-format'
export function RichTextFormattingToolbar({ editor, disabled = false, textColors = false }: { editor: Editor | null; disabled?: boolean; textColors?: boolean }): React.JSX.Element {
  useEditorState({ editor, selector: ({ transactionNumber }) => transactionNumber })
  return <fieldset disabled={disabled || !editor} className="script-format-toolbar" role="toolbar" aria-label="文案格式">
    {[
      { name: '加粗', icon: <Bold size={14} />, mark: 'bold', shortcut: '⌘B', run: () => editor?.chain().focus().toggleBold().run() },
      { name: '下划线', icon: <Underline size={14} />, mark: 'underline', shortcut: '⌘U', run: () => editor?.chain().focus().toggleUnderline().run() },
      { name: '删除线', icon: <Strikethrough size={14} />, mark: 'strike', shortcut: '⌘⇧S', run: () => editor?.chain().focus().toggleStrike().run() },
      { name: '正文', icon: '正文', mark: 'paragraph', shortcut: '⌘⌥0', run: () => editor?.chain().focus().setParagraph().run() },
      ...([1, 2, 3] as const).map((level, i) => ({ name: ['一级标题', '二级标题', '三级标题'][i]!, icon: [<Heading1 size={15} />, <Heading2 size={15} />, <Heading3 size={15} />][i], mark: `heading-${level}`, shortcut: `⌘⌥${level}`, run: () => editor?.chain().focus().toggleHeading({ level }).run() })),
      { name: '无序列表', icon: <List size={15} />, mark: 'bulletList', shortcut: '⌘⇧8', run: () => editor?.chain().focus().toggleBulletList().run() }
    ].map(item => <button type="button" key={item.name} title={`${item.name}（${item.shortcut}）`} aria-label={item.name} aria-pressed={(item.mark.startsWith('heading-') ? editor?.isActive('heading', { level: Number(item.mark.slice(-1)) }) : editor?.isActive(item.mark)) ?? false} onMouseDown={event => event.preventDefault()} onClick={item.run}>{item.icon}</button>)}
    <i />{HIGHLIGHT_COLORS.map((color, index) => <button type="button" className="format-highlight" title={`高亮颜色${index + 1}`} aria-label={`高亮颜色${index + 1}`} aria-pressed={editor?.isActive('highlight', { color }) ?? false} key={color} style={{ '--format-highlight': color } as React.CSSProperties} onMouseDown={event => event.preventDefault()} onClick={() => editor?.chain().focus().toggleHighlight({ color, targetSelectionId: null } as never).run()} />)}
    <button type="button" title="清除高亮" aria-label="清除高亮" onMouseDown={event => event.preventDefault()} onClick={() => editor?.chain().focus().unsetHighlight().run()}>清除</button>
    {textColors && <><i />{TEXT_COLORS.map((color, i) => <button type="button" key={color} className="format-text-color" style={{ '--review-text-color': color } as React.CSSProperties} title={`文字颜色${i + 1}`} aria-label={`文字颜色${i + 1}`} aria-pressed={editor?.isActive('textColor', { color }) ?? false} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().setMark('textColor', { color }).run()}>A</button>)}<button type="button" onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().unsetMark('textColor').run()}>默认文字色</button></>}
  </fieldset>
}
