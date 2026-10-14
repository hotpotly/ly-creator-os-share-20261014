import { AlertTriangle, Bookmark, FileAudio, FileText, FileVideo, Image, Paperclip } from 'lucide-react'
import type { CaptureRecord } from '../../../shared/domain'

function statusLabel(attachment: CaptureRecord['attachments'][number]): string {
  if (attachment.processState === 'stored_only') return '仅保存'
  if (attachment.processState === 'failed') return '处理失败'
  if (attachment.processState === 'pending') return '处理中'
  return '已保存'
}

function attachmentIcon(kind: CaptureRecord['attachments'][number]['attachmentKind']): React.JSX.Element {
  if (kind === 'image') return <Image size={14} />
  if (kind === 'video') return <FileVideo size={14} />
  if (kind === 'audio') return <FileAudio size={14} />
  if (kind === 'pdf' || kind === 'word') return <FileText size={14} />
  return <Paperclip size={14} />
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`
}

function markerLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function sourceTimeLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.valueOf())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(timestamp)
}

export function CaptureAttachmentList({ capture, compact = false }: { capture: CaptureRecord; compact?: boolean }): React.JSX.Element | null {
  const hasRecordingMetadata = capture.mobileRecordingMarkersMs.length > 0 || Boolean(capture.mobileRecordingInterruptionReason)
  if (!capture.attachments.length && !hasRecordingMetadata) return null
  if (compact) return <span className="capture-attachment-count">
    {capture.attachments.length ? <><Paperclip size={11} />{capture.attachments.length}个附件</> : null}
    {capture.mobileRecordingMarkersMs.length ? <><Bookmark size={11} />重点{capture.mobileRecordingMarkersMs.length}处</> : null}
    {capture.mobileRecordingInterruptionReason ? <><AlertTriangle size={11} />录音中断</> : null}
  </span>
  return <>
    {capture.attachments.length ? <section className="capture-attachment-list" aria-label={`${capture.attachments.length}个附件`}>
      <header><b>附件</b><span>{capture.attachments.length}个</span></header>
      {capture.attachments.map((attachment) => <article className="capture-attachment-item" key={attachment.id}>
        <span className="capture-attachment-icon">{attachmentIcon(attachment.attachmentKind)}</span>
        <div><b title={attachment.fileName}>{attachment.fileName}</b><small>{fileSizeLabel(attachment.sizeBytes)}·{attachment.mimeType}{sourceTimeLabel(attachment.sourceModifiedAt) ? `·来源于${sourceTimeLabel(attachment.sourceModifiedAt)}` : ''}</small></div>
        <em data-state={attachment.processState}>{statusLabel(attachment)}</em>
      </article>)}
    </section> : null}
    {hasRecordingMetadata ? <section className="capture-recording-metadata" aria-label="录音重点与中断信息">
      <header><b>录音时间线</b><span>{capture.mobileRecordingMarkersMs.length}个重点</span></header>
      {capture.mobileRecordingMarkersMs.length ? <div>{capture.mobileRecordingMarkersMs.map((marker, index) => <span key={`${marker}-${index}`}><Bookmark size={11} />{markerLabel(marker)}</span>)}</div> : null}
      {capture.mobileRecordingInterruptionReason ? <p><AlertTriangle size={13} />{capture.mobileRecordingInterruptionReason}</p> : null}
    </section> : null}
  </>
}
