import Highlight from '@tiptap/extension-highlight'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Heading2, Highlighter, List, Save, Strikethrough } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react'

export type ProductionMemoFormat = 'plain_text' | 'html'

export interface ProductionMemoEditorProps {
  value: string
  format: ProductionMemoFormat
  saving: boolean
  onChange(value: string, format: 'html'): void
  onSave(value: string, format: 'html'): void | Promise<void>
  ariaLabel?: string
  className?: string
}

const highlightColors = ['#F3D9A3', '#BFD9C1', '#BDD8E5'] as const
const allowedTags = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'S', 'STRIKE', 'DEL',
  'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'MARK'
])
const discardWithContentTags = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE',
  'META', 'LINK', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
  'OPTION', 'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS'
])

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function plainTextToProductionMemoHtml(value: string): string {
  if (!value) return '<p></p>'
  return `<p>${escapeHtml(value).replaceAll('\n', '<br>')}</p>`
}

/**
 * Keep only the formatting supported by this editor. Unknown layout tags are
 * unwrapped, while active or embedded content is removed with its descendants.
 * In a non-DOM environment the conservative fallback treats the input as text.
 */
function sanitizeProductionMemoHtml(value: string): string {
  if (!value) return '<p></p>'
  if (typeof document === 'undefined') return plainTextToProductionMemoHtml(value)

  const template = document.createElement('template')
  template.innerHTML = value

  const sanitizeNode = (node: Node): void => {
    if (!(node instanceof Element)) return
    const children = Array.from(node.childNodes)
    children.forEach(sanitizeNode)

    if (discardWithContentTags.has(node.tagName)) {
      node.remove()
      return
    }
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes))
      return
    }

    const highlightColor = node.tagName === 'MARK'
      ? highlightColors.find((color) => node.getAttribute('data-color')?.toUpperCase() === color)
      : undefined
    Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name))
    if (highlightColor) {
      node.setAttribute('data-color', highlightColor)
      ;(node as HTMLElement).style.backgroundColor = highlightColor
    }
  }

  Array.from(template.content.childNodes).forEach(sanitizeNode)
  return template.innerHTML || '<p></p>'
}

function normalizeProductionMemoContent(value: string, format: ProductionMemoFormat): string {
  return format === 'html' ? sanitizeProductionMemoHtml(value) : plainTextToProductionMemoHtml(value)
}

function ProductionMemoToolbar({ editor }: { editor: Editor | null }): React.JSX.Element {
  const run = (event: MouseEvent<HTMLButtonElement>, command: () => void): void => {
    event.preventDefault()
    command()
  }
  return <div className="script-format-toolbar production-memo-toolbar" role="toolbar" aria-label="剪辑备忘录格式">
    <button type="button" title="加粗" aria-label="加粗" aria-pressed={editor?.isActive('bold') ?? false} onMouseDown={(event) => run(event, () => { editor?.chain().focus().toggleBold().run() })}><Bold size={14} /></button>
    <button type="button" title="删除线" aria-label="删除线" aria-pressed={editor?.isActive('strike') ?? false} onMouseDown={(event) => run(event, () => { editor?.chain().focus().toggleStrike().run() })}><Strikethrough size={14} /></button>
    <i />
    <button type="button" title="标题" aria-label="标题" aria-pressed={editor?.isActive('heading', { level: 2 }) ?? false} onMouseDown={(event) => run(event, () => { editor?.chain().focus().toggleHeading({ level: 2 }).run() })}><Heading2 size={15} /></button>
    <button type="button" title="无序列表" aria-label="无序列表" aria-pressed={editor?.isActive('bulletList') ?? false} onMouseDown={(event) => run(event, () => { editor?.chain().focus().toggleBulletList().run() })}><List size={15} /></button>
    <i />
    {highlightColors.map((color, index) => <button
      type="button"
      className="format-highlight"
      title={`高亮颜色${index + 1}`}
      aria-label={`高亮颜色${index + 1}`}
      aria-pressed={editor?.isActive('highlight', { color }) ?? false}
      key={color}
      style={{ '--format-highlight': color } as React.CSSProperties}
      onMouseDown={(event) => run(event, () => { editor?.chain().focus().toggleHighlight({ color }).run() })}
    />)}
    <button type="button" title="清除高亮" aria-label="清除高亮" onMouseDown={(event) => run(event, () => { editor?.chain().focus().unsetHighlight().run() })}><Highlighter size={14} /></button>
  </div>
}

export function ProductionMemoEditor({
  value,
  format,
  saving,
  onChange,
  onSave,
  ariaLabel = '剪辑备忘录',
  className = ''
}: ProductionMemoEditorProps): React.JSX.Element {
  const normalizedContent = useMemo(() => normalizeProductionMemoContent(value, format), [format, value])
  const onChangeRef = useRef(onChange)
  const lastEmittedHtmlRef = useRef<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [textLength, setTextLength] = useState(0)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const editor = useEditor({
    extensions: [StarterKit, Highlight.configure({ multicolor: true })],
    content: normalizedContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        role: 'textbox'
      }
    },
    onCreate: ({ editor: createdEditor }) => setTextLength(createdEditor.getText().length),
    onUpdate: ({ editor: updatedEditor }) => {
      const html = updatedEditor.getHTML()
      lastEmittedHtmlRef.current = html
      setTextLength(updatedEditor.getText().length)
      onChangeRef.current(html, 'html')
    }
  })

  useEffect(() => {
    if (!editor || value === lastEmittedHtmlRef.current) return
    if (editor.getHTML() === normalizedContent) return
    editor.commands.setContent(normalizedContent, { emitUpdate: false })
    const frame = window.requestAnimationFrame(() => setTextLength(editor.getText().length))
    return () => window.cancelAnimationFrame(frame)
  }, [editor, normalizedContent, value])

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setFocused(false)
  }
  const save = (): void => {
    if (!editor || saving) return
    void onSave(editor.getHTML(), 'html')
  }

  return <div
    className={`production-memo-editor${focused ? ' focused' : ''}${className ? ` ${className}` : ''}`}
    style={{ display: 'grid', gridTemplateRows: focused ? 'auto minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto', minHeight: 0 }}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={handleBlur}
  >
    {focused ? <ProductionMemoToolbar editor={editor} /> : null}
    <div className="editor-scroll production-memo-scroll" style={{ minHeight: 0, padding: 10 }}>
      {textLength === 0 ? <p className="production-memo-placeholder">添加剪辑备注</p> : null}
      <EditorContent editor={editor} />
    </div>
    <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
      <span aria-live="polite">{textLength}字</span>
      <button type="button" className="primary-action" disabled={saving || !editor} onClick={save}><Save size={13} />{saving ? '保存中…' : '保存'}</button>
    </footer>
  </div>
}
