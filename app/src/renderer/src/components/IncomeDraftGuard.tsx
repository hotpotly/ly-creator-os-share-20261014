import { useEffect, useRef } from 'react'

export function IncomeDraftGuard({ onContinue, onDiscard }: { onContinue(): void; onDiscard(): void }): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onContinue() }}>
    <section ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="收入修改尚未保存" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onContinue() }
      if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll('button')
        if (!buttons?.length) return
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus() }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus() }
      }
    }}>
      <header><h2>收入修改尚未保存</h2></header>
      <p>离开会放弃本次未保存的收入修改。已单独保存的资料、发票和常用模板不受影响。</p>
      <footer><button onClick={onContinue}>继续编辑</button><button className="danger-action" onClick={onDiscard}>放弃修改</button></footer>
    </section>
  </div>
}
