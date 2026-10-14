import { z } from 'zod'
import { useEffect, useRef, useState } from 'react'
import { GripVertical, ImagePlus, MoreHorizontal, Trash2 } from 'lucide-react'
import { emptyReviewBody, reviewEntrySaveSchema, reviewPlainText, reviewRange, type ReviewEntry, type ReviewEntrySave, type ReviewQuery } from '../../../../shared/personal-review'
import { ReviewRichEditor } from './ReviewRichEditor'
import { ReviewImage } from './ReviewEntryEditor'
import { clearReviewDraft, readReviewDraft, writeReviewDraft } from './review-draft'
const draftSchema = reviewEntrySaveSchema.extend({ title: z.string().max(200) })
const labels = { life: '生活记录', checkin: '打卡记录' }
const dragType = 'application/x-review-entry'
const order = (entry: ReviewEntry): number => entry.sortOrder ?? -Date.parse(entry.updatedAt)
const editable = (entry: ReviewEntry): ReviewEntrySave => reviewEntrySaveSchema.parse(Object.fromEntries(Object.entries(entry).filter(([key]) => !['attachments', 'updatedAt'].includes(key))))
function blank(query: ReviewQuery, kind: 'life' | 'checkin'): ReviewEntrySave {
  const range = reviewRange(query)
  return { id: crypto.randomUUID(), revision: 0, kind, date: query.anchor, title: labels[kind], body: emptyReviewBody(), tags: [], sourceKind: query.kind, sourceAnchor: range.start, trashed: false, sortOrder: -Date.now(), displayWidth: 100 }
}
async function imageBytes(files: File[]): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  if (!files.length || files.length > 20) throw new Error('每次最多20张图片')
  for (const file of files) if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}不是有效图片或超过20MB`)
  return Promise.all(files.map(async file => ({ name: file.name || '粘贴图片.png', bytes: new Uint8Array(await file.arrayBuffer()) })))
}
function ReviewInlineRecord({ entry, kind, query, onSaved, incoming, onReorder, onEdit, onConsumed }: { entry?: ReviewEntry; kind: 'life' | 'checkin'; query: ReviewQuery; onSaved(): void; incoming?: { id: string; files: File[] }; onReorder?(id: string, beforeId: string): void; onEdit?(entry:ReviewEntry):void; onConsumed?(id:string):void }): React.JSX.Element {
  const key = `review-canvas-draft:${entry?.id ?? `${reviewRange(query).id}:${kind}:${query.anchor}`}`
  const [draft, setDraft] = useState<ReviewEntrySave>(() => readReviewDraft(key, draftSchema) ?? (entry ? editable(entry) : blank(query, kind)))
  const draftRef = useRef(draft), baseline = useRef(entry ? JSON.stringify(editable(entry)) : JSON.stringify(draft)), dirty = useRef(!!readReviewDraft(key, draftSchema))
  const [busy, setBusy] = useState(false), pending = useRef(false), [error, setError] = useState(''), [remove, setRemove] = useState(false), [saved, setSaved] = useState(entry)
  const handled = useRef(''), failedFiles = useRef<File[]>([]), resize = useRef<{ x: number; width: number; parent: number } | null>(null)
  const update = (patch: Partial<ReviewEntrySave>): void => {
    if (pending.current) return
    const next = { ...draftRef.current, ...patch }
    if (JSON.stringify(next) === JSON.stringify(draftRef.current)) return
    draftRef.current = next; dirty.current = true; setError(''); setDraft(next); writeReviewDraft(key, next)
  }
  useEffect(() => {
    if (!entry || pending.current || dirty.current || entry.revision < draftRef.current.revision) return
    const next = editable(entry)
    if (JSON.stringify(next) !== baseline.current) { draftRef.current = next; baseline.current = JSON.stringify(next); setDraft(next) }
    setSaved(entry)
  }, [entry])
  const persist = async (files: File[] = [], patch: Partial<ReviewEntrySave> = {}): Promise<void> => {
    if (pending.current || (!files.length && !dirty.current && !Object.keys(patch).length)) return
    const current = draftRef.current, text = reviewPlainText(current.body).trim()
    if (!entry && !files.length && !text) return
    pending.current = true; setBusy(true); setError(''); failedFiles.current = files
    try {
      const next = { ...current, ...patch, title: current.title.trim() && current.title !== labels[kind] ? current.title.trim() : (text.split('\n')[0] || files[0]?.name || labels[kind]).slice(0, 200), sortOrder: current.sortOrder ?? -Date.now() }
      const result = files.length ? await window.creatorOS!.importReviewImages(next, await imageBytes(files)) : await window.creatorOS!.saveReviewEntry(next)
      dirty.current = false; failedFiles.current = []; clearReviewDraft(key)
      const value = entry ? editable(result) : blank(query, kind)
      draftRef.current = value; baseline.current = JSON.stringify(value); setDraft(value); setSaved(entry ? result : undefined); onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，草稿仍保留'); writeReviewDraft(key, draftRef.current) }
    finally { pending.current = false; setBusy(false) }
  }
  const persistRef = useRef(persist); persistRef.current = persist
  useEffect(() => {
    if (!incoming || handled.current === incoming.id || pending.current) return
    handled.current = incoming.id; void persistRef.current(incoming.files).finally(() => onConsumed?.(incoming.id))
  }, [incoming, busy, onConsumed])
  useEffect(() => {
    if (!entry || !dirty.current) return
    const timer = setTimeout(() => { void persistRef.current() }, 900)
    return () => clearTimeout(timer)
  }, [draft, entry])
  return <article className={`review-inline-record${entry ? '' : ' review-inline-composer'}`} data-review-entry={entry?.id} data-kind={kind}
    style={entry ? { width: `${draft.displayWidth ?? 100}%` } : undefined}
    onBlur={event => { if (!error && !event.currentTarget.contains(event.relatedTarget)) void persist() }}
    onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void persist() } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.stopPropagation() } }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); const files = Array.from(event.dataTransfer.files); if (files.length) void persist(files); else if (entry) onReorder?.(event.dataTransfer.getData(dragType), entry.id) }}
    onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); event.stopPropagation(); void persist(files) } }}>
    {entry && <header className="review-inline-meta"><button className="review-block-grip" aria-label={`拖动${draft.title}`} title="拖动排序" draggable={!busy} onDragStart={event => { event.dataTransfer.setData(dragType, entry.id); event.dataTransfer.effectAllowed = 'move' }}><GripVertical size={14} /></button><input aria-label={`记录日期${entry.id}`} type="date" min={reviewRange({kind:draft.sourceKind,anchor:draft.sourceAnchor}).start} max={reviewRange({kind:draft.sourceKind,anchor:draft.sourceAnchor}).end} value={draft.date} disabled={busy} onChange={event => { if(event.target.value) update({date:event.target.value}) }} />
      <button disabled={busy} aria-label={`上移${draft.title}`} onClick={() => onReorder?.(entry.id, 'previous')}>↑</button><button disabled={busy} aria-label={`下移${draft.title}`} onClick={() => onReorder?.(entry.id, 'next')}>↓</button>
      <button disabled={busy} aria-label={`更多${draft.title}`} onClick={()=>void persist().then(async()=>{ if(!dirty.current)onEdit?.(await window.creatorOS!.getReviewEntry(entry.id)) }).catch(cause=>setError(String(cause)))}><MoreHorizontal size={13}/></button><button disabled={busy} aria-label={`删除${draft.title}`} onClick={() => setRemove(v=>!v)}><Trash2 size={13} /></button></header>}
    {entry && <input data-auto-title={draft.title === reviewPlainText(draft.body).trim().split('\n')[0] || saved?.attachments.some(file => file.name === draft.title)} className="review-inline-title" aria-label={`记录标题${entry.id}`} value={draft.title} maxLength={200} disabled={busy} onChange={event=>update({title:event.target.value})} />}
    <ReviewRichEditor value={draft.body} disabled={busy} label={entry ? `${labels[kind]}正文${entry.id}` : `${labels[kind]}新内容`} placeholder={entry ? '写点什么…' : '直接写，或拖入图片'} onChange={body => update({body})} />
    {!!saved?.attachments.length && <div className="review-canvas-images">{saved.attachments.map(file=><ReviewImage key={file.id} entry={saved} fileId={file.id} name={file.name} />)}</div>}
    {entry && <div className="review-image-resize" role="separator" tabIndex={0} aria-label={`调整${draft.title}宽度`} aria-orientation="vertical" aria-valuemin={25} aria-valuemax={100} aria-valuenow={draft.displayWidth ?? 100}
      onPointerDown={event=>{ event.currentTarget.setPointerCapture(event.pointerId);resize.current={x:event.clientX,width:draft.displayWidth??100,parent:event.currentTarget.parentElement!.parentElement!.clientWidth} }}
      onPointerMove={event=>{ if(!resize.current || !event.currentTarget.hasPointerCapture(event.pointerId))return;update({displayWidth:Math.min(100,Math.max(25,resize.current.width+(event.clientX-resize.current.x)/resize.current.parent*100))}) }}
      onPointerUp={event=>{resize.current=null;event.currentTarget.releasePointerCapture(event.pointerId);void persist()}} onPointerCancel={()=>{resize.current=null;void persist()}}
      onKeyDown={event=>{ if(event.key==='ArrowLeft'||event.key==='ArrowRight'||event.key==='Home'){event.preventDefault();update({displayWidth:event.key==='Home'?100:Math.min(100,Math.max(25,(draft.displayWidth??100)+(event.key==='ArrowRight'?5:-5)))});void persist()} }} />}
    {remove && <div className="review-inline-meta"><button disabled={busy} onClick={()=>void persist([], {trashed:true})}>确认移入已删除</button><button onClick={()=>setRemove(false)}>取消</button></div>}
    {(busy || dirty.current) && <span role="status" className="review-inline-state">{busy ? '保存中…' : '未保存'}</span>}
    {error && <div role="alert" className="review-error">{error}<button disabled={busy} onClick={()=>void persist(failedFiles.current)}>重试</button>{entry && <button onClick={()=>{ const next=editable(entry);draftRef.current=next;dirty.current=false;setDraft(next);setSaved(entry);setError('');clearReviewDraft(key) }}>放弃草稿并加载已保存记录</button>}</div>}
  </article>
}
export function ReviewEntryCanvas({ kind, entries, query, onSaved, onEdit }: { kind:'life'|'checkin'; entries:ReviewEntry[]; query:ReviewQuery; onSaved():void; onEdit(entry:ReviewEntry):void }):React.JSX.Element {
  const [queue,setQueue]=useState<Array<{id:string;files:File[]}>>([]),[error,setError]=useState(''),[dragging,setDragging]=useState(false)
  const input=useRef<HTMLInputElement>(null), pending=useRef(false)
  const ordered=entries.filter(entry=>entry.kind===kind&&!entry.trashed).sort((a,b)=>order(a)-order(b)||a.id.localeCompare(b.id))
  const ingest=(files:File[]):void=>{ if(files.length)setQueue(value=>[...value,{id:crypto.randomUUID(),files}]) }
  const reorder=async(id:string,beforeId:string):Promise<void>=>{
    if(pending.current || !id || id===beforeId)return
    const source=entries.find(entry=>entry.id===id&&!entry.trashed&&entry.kind!=='experience')
    if(!source)return
    let index=beforeId==='end'?ordered.length:ordered.findIndex(entry=>entry.id===beforeId)
    const sourceIndex=ordered.indexOf(source)
    if(beforeId==='previous')index=sourceIndex-1
    if(beforeId==='next')index=sourceIndex+2
    const rest=ordered.filter(entry=>entry.id!==id)
    if(beforeId==='next')index=Math.min(rest.length,sourceIndex+1)
    else if(sourceIndex>=0&&index>sourceIndex)index--
    if(index<0)return
    const next=rest[index],prev=rest[index-1],rank=next?(prev?(order(prev)+order(next))/2:order(next)-1024):(prev?order(prev)+1024:-Date.now())
    pending.current=true;setError('')
    try{ await window.creatorOS!.saveReviewEntry({...editable(source),kind,sortOrder:rank});onSaved() }catch(cause){setError(String(cause))}finally{pending.current=false}
  }
  return <section className="review-panel review-canvas" data-canvas-kind={kind} data-dragging={dragging} aria-label={labels[kind]} tabIndex={0}
    onDragOver={event=>{if(event.dataTransfer.types.includes('Files')||event.dataTransfer.types.includes(dragType)){event.preventDefault();setDragging(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}}
    onDropCapture={()=>setDragging(false)} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();setDragging(false);ingest(Array.from(event.dataTransfer.files))}else if(event.dataTransfer.types.includes(dragType)){event.preventDefault();void reorder(event.dataTransfer.getData(dragType),'end')}}}
    onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();ingest(files)}}}>
    <header><h2>{labels[kind]}</h2><button aria-label={`选择${labels[kind]}图片`} title="选择图片" onClick={()=>input.current?.click()}><ImagePlus size={16}/></button><input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={`${labels[kind]}图片文件`} onChange={event=>{ingest(Array.from(event.target.files??[]));event.target.value=''}} /></header>
    {error && <p className="review-error" role="alert">{error}</p>}
    <div className="review-canvas-blocks">{ordered.map(entry=><ReviewInlineRecord key={entry.id} entry={entry} kind={kind} query={query} onSaved={onSaved} onEdit={onEdit} onReorder={(id,before)=>void reorder(id,before)} />)}</div>
    <ReviewInlineRecord key={`${kind}:${query.anchor}`} kind={kind} query={query} onSaved={onSaved} incoming={queue[0]} onConsumed={id=>setQueue(value=>value.filter(item=>item.id!==id))} />
  </section>
}
