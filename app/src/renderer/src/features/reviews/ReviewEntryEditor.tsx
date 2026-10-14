import { z } from 'zod'
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { emptyReviewBody, reviewEntrySaveSchema, reviewRange, type ReviewEntry, type ReviewEntrySave, type ReviewQuery } from '../../../../shared/personal-review'
import { ReviewRichEditor } from './ReviewRichEditor'
import { clearReviewDraft, readReviewDraft, writeReviewDraft } from './review-draft'
function editable(entry: ReviewEntry): ReviewEntrySave { return reviewEntrySaveSchema.parse(Object.fromEntries(Object.entries(entry).filter(([key]) => !['attachments', 'updatedAt'].includes(key)))) }
const labels = { life: '生活记录', checkin: '打卡记录', experience: '经验' }
export function ReviewImage({ entry, fileId, name }: { entry: ReviewEntry; fileId: string; name: string }): React.JSX.Element {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [open, setOpen] = useState(false), [retry, setRetry] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let active = true
    void window.creatorOS!.previewReviewImage(entry.id, fileId).then(value => { if (active) { setUrl(value); setError('') } }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [entry.id, fileId, retry])
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  return <>{url ? <button className="review-thumbnail" title={`查看${name}`} onClick={() => setOpen(true)}><img src={url} alt={name} loading="lazy" /></button> : <button className="review-image-failed" onClick={() => setRetry(v => v + 1)} title={error}>{error ? '图片读取失败，点击重试' : '读取图片…'}</button>}
    <dialog ref={dialog} className="review-image-dialog" onCancel={() => setOpen(false)} aria-label={name}><header><span>{name}</span><button aria-label="关闭图片" onClick={() => setOpen(false)}><X size={18} /></button></header>{url && <img src={url} alt={name} />}</dialog></>
}
export function ReviewEntryEditor({ entry, kind, query, today, onClose, onSaved }: { entry?: ReviewEntry; kind: ReviewEntry['kind']; query: ReviewQuery; today: string; onClose(): void; onSaved(): void }): React.JSX.Element {
  const range = reviewRange(query), key = `review-entry-draft:${entry?.id ?? `${range.id}:${kind}`}`
  const [draft, setDraft] = useState<ReviewEntrySave>(() => readReviewDraft(key, reviewEntrySaveSchema.extend({ title: z.string().max(200), tags: z.array(z.string().max(480)).max(480) })) ?? (entry ? editable(entry) : { id: crypto.randomUUID(), revision: 0, date: today >= range.start && today <= range.end ? today : range.start, kind, title: '', body: emptyReviewBody(), tags: [], sourceKind: query.kind, sourceAnchor: range.start, trashed: false }))
  const [saved, setSaved] = useState(entry), [busy, setBusy] = useState(false), [error, setError] = useState(''), [tagText, setTagText] = useState(draft.tags.join('，')), [removeFileId, setRemoveFileId] = useState('')
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const update = (patch: Partial<ReviewEntrySave>): void => setDraft(value => { const next = { ...value, ...patch }; writeReviewDraft(key, next); return next })
  const persist = async (): Promise<ReviewEntry> => {
    const result = await window.creatorOS!.saveReviewEntry(reviewEntrySaveSchema.parse({ ...draft, tags: tagText.split(/[,，]/).map(s => s.trim()).filter(Boolean) }))
    setDraft(editable(result)); setSaved(result); clearReviewDraft(key); onSaved(); return result
  }
  const act = async (action: () => Promise<void>): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '保存失败') } finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="review-entry-dialog" aria-label={`编辑${labels[kind]}`} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopPropagation()
      if (draft.title.trim()) void act(async () => { await persist() })
    }
  }} onCancel={e => { e.preventDefault(); if (!busy) onClose() }}>
    <header><div><h2>{entry ? '编辑' : '添加'}{labels[kind]}</h2></div><button disabled={busy} aria-label="关闭记录" onClick={onClose}><X size={18} /></button></header>
    <fieldset disabled={busy} className="review-entry-fields"><label>标题<input autoFocus aria-label="记录标题" maxLength={200} value={draft.title} onChange={e => update({ title: e.target.value })} /></label>
      <div className="review-form-row"><label>记录日期<input type="date" min={range.start} max={range.end} value={draft.date} onChange={e => update({ date: e.target.value })} /></label><label>标签<input aria-label="记录标签" value={tagText} maxLength={480} onChange={e => { setTagText(e.target.value); update({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }) }} title="多个标签用逗号分隔" /></label></div>
      <ReviewRichEditor value={draft.body} disabled={busy} label="记录正文" onChange={body => update({ body })} />
      <div className="review-attachment-grid">{saved?.attachments.map(file => <figure key={file.id}><ReviewImage entry={saved} fileId={file.id} name={file.name} /><figcaption>{file.name}</figcaption><button type="button" onClick={() => { if (removeFileId !== file.id) { setRemoveFileId(file.id); return }; void act(async () => { const result = await window.creatorOS!.detachReviewImage(saved.id, file.id); setSaved(result); setRemoveFileId(''); onSaved() }) }}>{removeFileId === file.id ? '确认移除图片' : '移除图片'}</button>{removeFileId === file.id && <button type="button" onClick={() => setRemoveFileId('')}>取消</button>}</figure>)}</div>
      <button className="secondary-action" onClick={() => void act(async () => { const current = await persist(); const result = await window.creatorOS!.attachReviewImages(current.id); setSaved(result); onSaved() })}><ImagePlus size={14} />保存文字并添加图片</button>
    </fieldset>
    {error && <p className="review-error" role="alert">{error}{saved && <button disabled={busy} onClick={() => void act(async () => { const current = await window.creatorOS!.getReviewEntry(saved.id); setSaved(current); setDraft(editable(current)); setTagText(current.tags.join('，')); clearReviewDraft(key) })}>放弃草稿并加载已保存记录</button>}</p>}
    <footer><button disabled={busy} onClick={() => { clearReviewDraft(key); onClose() }}>放弃本机草稿</button><button className="primary-action" title="保存记录（⌘S）" aria-keyshortcuts="Meta+S Control+S" disabled={busy || !draft.title.trim()} onClick={() => void act(async () => { await persist(); onClose() })}>{busy ? '保存中…' : '保存记录'}</button></footer>
  </dialog>
}
