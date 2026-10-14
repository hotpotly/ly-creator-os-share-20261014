import { ClipboardPaste, Save } from 'lucide-react'
import { useState } from 'react'

export function FreeformContentEditor({
  title,
  eyebrow,
  value,
  placeholder,
  disabled = false,
  onChange,
  onSave
}: {
  title: string
  eyebrow: string
  value: string
  placeholder: string
  disabled?: boolean
  onChange(value: string): void
  onSave(value: string): Promise<void>
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(value)
    } finally {
      setSaving(false)
    }
  }

  return <section className="workbench-pane freeform-content-pane">
    <header>
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      <button className="is-dirty" disabled={saving} onClick={() => void save()}>
        <Save size={13} />{saving ? '保存中…' : '保存'}
      </button>
    </header>
    <div className="freeform-editor-body">
      <textarea
        aria-label={`${title}自由编辑区`}
        value={value}
        maxLength={1_000_000}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void save()
          }
        }}
      />
    </div>
    <footer><ClipboardPaste size={12} />可直接粘贴、输入、删除和调整顺序；⌘S保存。</footer>
  </section>
}
