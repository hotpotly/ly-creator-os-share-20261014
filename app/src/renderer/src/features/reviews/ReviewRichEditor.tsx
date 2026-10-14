import { Mark, mergeAttributes } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import { useEffect, useId, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../../../../shared/rich-text-format'
import type { RichNode } from '../../../../shared/personal-review'
import { RichTextFormattingToolbar } from '../../components/RichTextFormattingToolbar'
const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: TEXT_COLORS[0], parseHTML: element => element.getAttribute('data-review-color') } }),
  parseHTML: () => TEXT_COLORS.map(color => ({ tag: `span[data-review-color="${color}"]` })),
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes({ 'data-review-color': HTMLAttributes.color, style: `color:${HTMLAttributes.color};--review-text-color:${HTMLAttributes.color}` }), 0]
})
const ReviewHighlight = Highlight.extend({
  parseHTML: () => HIGHLIGHT_COLORS.map(color => ({ tag: `mark[data-color="${color}"]` })),
  addKeyboardShortcuts() { return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight({ color: HIGHLIGHT_COLORS[0] }) } }
}).configure({ multicolor: true })
export function ReviewRichEditor({ value, onChange, label, readOnly = false, disabled = false, placeholder }: { value: RichNode; onChange?(value: RichNode): void; label: string; readOnly?: boolean; disabled?: boolean; placeholder?: string }): React.JSX.Element {
  const toolbarId = useId()
  const [stylesOpen, setStylesOpen] = useState(false)
  const changed = useRef(onChange)
  useEffect(() => { changed.current = onChange }, [onChange])
  const editor = useEditor({
    extensions: [StarterKit.configure({ underline: false, link: false, heading: { levels: [1, 2, 3] } }), Underline, ReviewHighlight, TextColor],
    content: value, editable: !readOnly && !disabled,
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'false', 'data-placeholder': placeholder ?? '' } },
    onUpdate: ({ editor }) => changed.current?.(editor.getJSON() as RichNode)
  })
  useEffect(() => { if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false }) }, [editor, value])
  useEffect(() => { editor?.setEditable(!readOnly && !disabled, false) }, [editor, readOnly, disabled])
  const toggleStyles = (): void => {
    if (disabled || readOnly) return
    setStylesOpen(open => !open)
    editor?.commands.focus()
  }
  return <div className={`review-rich-editor${readOnly ? ' read-only' : ''}`} data-styles-open={!readOnly && stylesOpen}
    onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'm' && !event.nativeEvent.isComposing && !disabled && !readOnly) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) toggleStyles()
      }
    }}>
    {!readOnly && <>
      <div className="review-style-actions"><button type="button" className="review-style-toggle" disabled={disabled}
        aria-label={stylesOpen ? '收起样式面板' : '展开样式面板'} aria-expanded={stylesOpen} aria-controls={toolbarId}
        aria-keyshortcuts="Meta+Shift+M Control+Shift+M" title={`${stylesOpen ? '收起' : '展开'}样式面板（⌘⇧M）`}
        onMouseDown={event => event.preventDefault()} onClick={toggleStyles}>样式</button></div>
      <div id={toolbarId} hidden={!stylesOpen}><RichTextFormattingToolbar editor={editor} disabled={disabled} textColors /></div>
    </>}
    <EditorContent editor={editor} />
  </div>
}
