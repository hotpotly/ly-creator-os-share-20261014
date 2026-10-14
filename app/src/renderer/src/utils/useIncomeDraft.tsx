import { useCallback, useState, type KeyboardEvent } from 'react'
import { IncomeDraftGuard } from '../components/IncomeDraftGuard'

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => {
    // Evidence is refreshed independently of the editable income facts.
    if (key === 'invoiceReceivedFromEvidence') return undefined
    return item instanceof File ? [item.name, item.size, item.lastModified, item.type] : item
  })
}

/** Shared draft lifecycle for both income types. Opening never writes to storage. */
export function useIncomeDraft<T>(initial: T | null = null) {
  const [editor, setEditor] = useState<T | null>(initial)
  const [baseline, setBaseline] = useState(() => fingerprint(initial))
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const dirty = editor !== null && fingerprint(editor) !== baseline
  const openEditor = useCallback((value: T | null) => {
    setBaseline(fingerprint(value))
    setEditor(value)
    setPendingLeave(null)
  }, [])
  const requestLeave = (action: () => void): void => {
    if (dirty) setPendingLeave(() => action)
    else action()
  }
  return {
    editor, setEditor, openEditor, dirty, requestLeave,
    guard: pendingLeave ? <IncomeDraftGuard
      onContinue={() => setPendingLeave(null)}
      onDiscard={() => { setPendingLeave(null); pendingLeave() }}
    /> : null
  }
}


/** Keep keyboard navigation in the income window without consuming a child popover's Escape. */
export function handleIncomeDialogKey(event: KeyboardEvent<HTMLElement>, onClose: () => void): void {
  if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return
  if (document.querySelector('.app-select-popover, .income-source-template-popover')) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
  if (event.key !== 'Tab') return
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'))
    .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]') && !element.classList.contains('visually-hidden'))
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
