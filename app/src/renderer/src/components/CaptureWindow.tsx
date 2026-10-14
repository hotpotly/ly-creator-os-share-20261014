import { Image, Mic, Paperclip, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureContext } from '../../../shared/domain'
import { applyAppearance } from '../utils/appearance'

export function CaptureWindow(): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [context, setContext] = useState<CaptureContext>({ projects: [], preferredProjectId: null, preferredCaptureKind: null, theme: 'light', visualStyle: 'warm' })
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const close = useCallback((): void => { void window.creatorOS?.closeCapture() }, [])

  const applyContext = useCallback((next: CaptureContext): void => {
    setContext(next)
    applyAppearance(next)
  }, [])

  const loadContext = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) return
    applyContext(await window.creatorOS.getCaptureContext())
  }, [applyContext])

  const activate = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) return
    applyContext(await window.creatorOS.getCaptureContext())
    setContent(''); setError('')
    inputRef.current?.focus()
  }, [applyContext])

  useEffect(() => {
    void loadContext()
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    const reloadOnFocus = (): void => { void loadContext(); inputRef.current?.focus() }
    const unsubscribeAppearance = window.creatorOS?.onAppearanceChanged((appearance) => { applyAppearance(appearance) })
    const unsubscribeActivated = window.creatorOS?.onCaptureActivated(() => { void activate() })
    window.addEventListener('keydown', closeOnEscape); window.addEventListener('focus', reloadOnFocus)
    return () => { unsubscribeAppearance?.(); unsubscribeActivated?.(); window.removeEventListener('keydown', closeOnEscape); window.removeEventListener('focus', reloadOnFocus) }
  }, [activate, close, loadContext])

  const canSave = content.trim().length > 0
  const save = async (): Promise<void> => {
    if (!window.creatorOS || !canSave || saving) return
    setSaving(true); setError('')
    const preferredProjectId = context.preferredProjectId
    try {
      await window.creatorOS.saveCapture({
        captureKind: preferredProjectId ? context.preferredCaptureKind ?? 'project_content' : 'unknown',
        primaryProjectId: preferredProjectId,
        originalContent: content.trim()
      })
      setContent('')
      await window.creatorOS.closeCapture()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setSaving(false) }
  }

  return (
    <main className="capture-page" onKeyDown={(event) => { if (event.key.toLowerCase() === 's' && event.metaKey) { event.preventDefault(); void save() } }}>
      <header className="capture-titlebar"><div><span className="brand-avatar">LY</span><div><h1>{context.preferredCaptureKind === 'client_feedback' ? '记录甲方反馈' : '快速记录'}</h1><span>{context.preferredProjectId ? '保存后自动关联当前项目' : '先记下来，保存后再分类'}</span></div></div><button aria-label="关闭快速记录" onClick={close}><X size={17} /></button></header>
      <label className="capture-input-label" htmlFor="capture-input">{context.preferredCaptureKind === 'client_feedback' ? '反馈内容' : '记录内容'}</label>
      <textarea ref={inputRef} id="capture-input" aria-describedby="capture-save-note" autoFocus value={content} onChange={(event) => setContent(event.currentTarget.value)} placeholder={context.preferredCaptureKind === 'client_feedback' ? '粘贴甲方修改意见或反馈内容……' : '输入灵感、感悟或任何想记录的内容……'} />
      <footer className="capture-footer"><div><button disabled title="阶段4接通语音导入" aria-label="添加语音"><Mic size={16} /></button><button disabled title="阶段4接通图片导入" aria-label="添加图片"><Image size={16} /></button><button disabled title="阶段4接通文件导入" aria-label="添加文件"><Paperclip size={16} /></button></div><div>{error ? <span className="capture-error" role="alert">{error}</span> : <span id="capture-save-note">⌘S保存</span>}<button className="capture-save" disabled={!canSave || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button></div></footer>
    </main>
  )
}
