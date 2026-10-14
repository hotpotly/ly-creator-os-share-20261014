import { Check } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react'
import { AnchoredPopover } from './AnchoredPopover'

interface AppSelectOption {
  disabled: boolean
  label: string
  value: string
}

export const AppSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { renderOption?(option: AppSelectOption): ReactNode }>(function AppSelect({
  children,
  renderOption,
  disabled,
  onClick,
  onKeyDown,
  onMouseDown,
  ...selectProps
}, forwardedRef): React.JSX.Element {
  const selectRef = useRef<HTMLSelectElement>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLSelectElement | null>(null)
  const [popoverWidth, setPopoverWidth] = useState(152)
  const [options, setOptions] = useState<AppSelectOption[]>([])
  useImperativeHandle(forwardedRef, () => selectRef.current!, [])

  const readOptions = useCallback((): void => {
    const select = selectRef.current
    if (!select) return
    setOptions(Array.from(select.options).map((option) => ({
      disabled: option.disabled,
      label: option.textContent?.trim() || option.label || option.value,
      value: option.value
    })))
  }, [])

  useEffect(() => {
    const select = selectRef.current
    if (!open || !select) return
    readOptions()
    const observer = new MutationObserver(readOptions)
    observer.observe(select, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [open, readOptions])

  const toggle = (event: MouseEvent<HTMLSelectElement>): void => {
    onMouseDown?.(event)
    if (event.defaultPrevented || disabled) return
    event.preventDefault()
    const select = selectRef.current
    select?.focus()
    if (!open && select) {
      setAnchor(select)
      setPopoverWidth(Math.max(152, Math.min(320, select.getBoundingClientRect().width)))
      readOptions()
    }
    setOpen((value) => !value)
  }

  const handleClick = (event: MouseEvent<HTMLSelectElement>): void => {
    onClick?.(event)
    if (!disabled) event.preventDefault()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSelectElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented || disabled) return
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const select = selectRef.current
    if (select) {
      setAnchor(select)
      setPopoverWidth(Math.max(152, Math.min(320, select.getBoundingClientRect().width)))
      readOptions()
    }
    setOpen(true)
  }

  const choose = (value: string): void => {
    const select = selectRef.current
    if (!select) return
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    setOpen(false)
    window.requestAnimationFrame(() => select.focus())
  }

  const currentValue = String(selectProps.value ?? selectProps.defaultValue ?? '')

  return <>
    <select
      {...selectProps}
      ref={selectRef}
      disabled={disabled}
      aria-expanded={open}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={toggle}
    >
      {children}
    </select>
    {open ? <AnchoredPopover
      anchor={anchor}
      ariaLabel={selectProps['aria-label'] ? `${selectProps['aria-label']}选项` : '下拉选项'}
      className="app-select-popover"
      role="menu"
      style={{ width: popoverWidth }}
      onDismiss={() => setOpen(false)}
    >
      {options.length ? options.map((option, index) => <button
        key={`${option.value}:${index}`}
        className={currentValue === option.value ? 'selected' : ''}
        disabled={option.disabled}
        role="menuitemradio"
        aria-checked={currentValue === option.value}
        onClick={() => choose(option.value)}
      >
        <Check size={13} />
        <span>{renderOption ? renderOption(option) : option.label}</span>
      </button>) : <div className="app-select-empty">没有可用选项</div>}
    </AnchoredPopover> : null}
  </>
})
