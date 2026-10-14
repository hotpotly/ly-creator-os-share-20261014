import { useState } from 'react'

// 项目重命名的就地输入框：Enter/失焦保存，Esc 取消；侧边栏、内容项目列表和项目详情共用。
export function InlineRename({ initialValue, ariaLabel, className, onSave, onCancel }: {
  initialValue: string
  ariaLabel: string
  className?: string
  onSave(value: string): void
  onCancel(): void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const commit = (): void => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initialValue) onCancel()
    else onSave(trimmed)
  }
  return <input
    className={`inline-rename${className ? ` ${className}` : ''}`}
    aria-label={ariaLabel}
    autoFocus
    maxLength={80}
    value={value}
    onChange={(event) => setValue(event.currentTarget.value)}
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); commit() }
      else if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }}
    onBlur={commit}
  />
}
