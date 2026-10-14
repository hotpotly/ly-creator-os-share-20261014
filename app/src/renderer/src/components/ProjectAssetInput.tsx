import { AlertTriangle, CheckCircle2, File, Folder, Link2, LoaderCircle, Trash2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ProjectAssetImportBatchResult, ProjectAssetImportStatus } from '../../../shared/domain'

export function FileDropZone({
  label,
  description,
  busy,
  onChoose,
  onFiles
}: {
  label: string
  description: string
  busy: boolean
  onChoose(): void
  onFiles(files: File[]): void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  return <><input
    className="visually-hidden"
    type="file"
    multiple
    aria-label={`${label}文件选择`}
    onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length > 0) onFiles(files) }}
  /><button
    type="button"
    className={`project-file-dropzone${dragging ? ' dragging' : ''}`}
    disabled={busy}
    onClick={onChoose}
    onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true) }}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
    onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
    onDrop={(event) => {
      event.preventDefault(); dragDepth.current = 0; setDragging(false)
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    }}
  >
    {busy ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />}
    <span><b>{busy ? '正在添加…' : label}</b><small>{description}</small></span>
  </button></>
}

const batchStatusLabel: Record<ProjectAssetImportStatus, string> = {
  success: '已添加',
  stored_only: '仅保存',
  partial: '部分完成',
  failed: '失败'
}

export function ProjectAssetBatchResult({ result, onDismiss }: { result: ProjectAssetImportBatchResult; onDismiss(): void }): React.JSX.Element | null {
  if (result.canceled || result.items.length === 0) return null
  return <section className="project-asset-batch-result" aria-label="本次添加结果">
    <header>
      <div><b>本次添加</b><span>{result.importedRootCount}项完成{result.storedOnlyFileCount ? `·${result.storedOnlyFileCount}个文件仅保存` : ''}{result.failedEntryCount ? `·${result.failedEntryCount}项失败` : ''}</span></div>
      <button type="button" onClick={onDismiss}>收起</button>
    </header>
    <ul>{result.items.map((item, index) => <li className={item.status} key={`${item.sourceName}-${index}`}>
      {item.status === 'failed' || item.status === 'partial' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
      <span><b title={item.sourceName}>{item.sourceName}</b><small>{item.fileCount ? `${item.fileCount}个文件` : ''}{item.folderCount ? `${item.fileCount ? '·' : ''}${item.folderCount}个文件夹` : ''}{item.message ? `${item.fileCount || item.folderCount ? '·' : ''}${item.message}` : ''}</small></span>
      <em>{batchStatusLabel[item.status]}</em>
    </li>)}</ul>
  </section>
}

export type ProjectAssetItemKind = 'file' | 'folder' | 'text' | 'link'

export function ProjectAssetItem({
  title,
  badge,
  meta,
  detail,
  kind,
  onOpen,
  onDelete
}: {
  title: string
  badge: string
  meta: string
  detail?: string | null
  kind: ProjectAssetItemKind
  onOpen?: () => void
  onDelete(): void
}): React.JSX.Element {
  const icon = kind === 'folder' ? <Folder size={15} /> : kind === 'link' ? <Link2 size={15} /> : <File size={15} />
  const content = <>
    <span className="material-source-icon">{icon}</span>
    <div><header><b title={title}>{title}</b><em>{badge}</em></header><p>{meta}</p>{detail ? <small title={detail}>{detail}</small> : null}</div>
  </>
  return <article className={kind === 'link' ? 'link-only' : ''}>
    {onOpen ? <button type="button" className="material-open" aria-label={`${kind === 'text' ? '查看' : '打开'}${title}`} onClick={onOpen}>{content}</button> : <div className="material-open static">{content}</div>}
    <button type="button" className="material-delete" aria-label={`删除资料${title}`} onClick={onDelete}><Trash2 size={14} /></button>
  </article>
}
