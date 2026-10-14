import { useState } from 'react'
import { videoFormatToken } from '../../../shared/field-appearance'
import { VIDEO_FORMATS, type VideoFormat, videoFormatLabel, projectKindLabel } from '../../../shared/content-classification'
import { AppSelect } from './AppSelect'
import { FieldLabel } from './FieldLabel'
export type ClassificationPatch = { videoFormat?: VideoFormat | null; isCommercial?: boolean }
export function ClassificationSelect({ dimension, value, onChange, filter = false, disabled = false, label }: { dimension: 'video' | 'kind'; value: string; onChange(value: string): void; filter?: boolean; disabled?: boolean; label?: string }): React.JSX.Element {
  const options = dimension === 'video' ? [['long', videoFormatLabel('long')], ['short', videoFormatLabel('short')], [filter ? 'undetermined' : '', videoFormatLabel(null)]] : [['commercial', projectKindLabel(true)], ['ordinary', projectKindLabel(false)]]
  return <AppSelect className="classification-select" aria-label={label ?? (dimension === 'video' ? '视频形式' : '项目类型')} value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} renderOption={option => <FieldLabel token={dimension === 'video' ? videoFormatToken(option.value) : option.value === 'commercial' ? 'project-4' : undefined}>{option.label}</FieldLabel>}>
    {filter ? <option value="">{dimension === 'video' ? '全部形式' : '全部类型'}</option> : null}{options.map(([key, name]) => <option value={key} key={key}>{name}</option>)}
  </AppSelect>
}
export function ClassificationFields({ videoFormat, isCommercial, onChange, disabled }: ClassificationPatch & { onChange(patch: ClassificationPatch): void; disabled?: boolean }): React.JSX.Element {
  return <div className="classification-fields"><div className="classification-field"><span>视频形式</span><div className="np-chips classification-format-options" role="group" aria-label="视频形式">{[...VIDEO_FORMATS, null].map(value => <button type="button" key={value ?? 'undetermined'} className={`np-chip${(videoFormat ?? null) === value ? ' on' : ''}`} aria-pressed={(videoFormat ?? null) === value} disabled={disabled} onClick={() => onChange({ videoFormat: value })}><FieldLabel token={videoFormatToken(value)}>{videoFormatLabel(value)}</FieldLabel></button>)}</div></div><label><span>项目类型</span><ClassificationSelect dimension="kind" value={isCommercial ? 'commercial' : 'ordinary'} disabled={disabled} onChange={value => onChange({ isCommercial: value === 'commercial' })} /></label></div>
}
export function SavedClassificationControl({ dimension, videoFormat, isCommercial, onSave, name }: ClassificationPatch & { dimension: 'video' | 'kind'; name: string; onSave(patch: ClassificationPatch): Promise<unknown> }): React.JSX.Element {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const save = async (value: string): Promise<void> => {
    setBusy(true); setError('')
    try { await onSave(dimension === 'video' ? { videoFormat: (value || null) as VideoFormat | null } : { isCommercial: value === 'commercial' }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试') }
    finally { setBusy(false) }
  }
  const displayLabel = dimension === 'video' ? videoFormatLabel(videoFormat) : projectKindLabel(Boolean(isCommercial))
  const token = dimension === 'video' ? videoFormatToken(videoFormat) : isCommercial ? 'project-4' : undefined
  return <div className="saved-classification-control" title={dimension === 'video' ? videoFormatLabel(videoFormat) : `${projectKindLabel(Boolean(isCommercial))}；改为普通不删除已有商务资料`}><span className="classification-value" aria-hidden="true"><FieldLabel token={token}>{displayLabel}</FieldLabel></span><ClassificationSelect dimension={dimension} value={dimension === 'video' ? videoFormat ?? '' : isCommercial ? 'commercial' : 'ordinary'} disabled={busy} label={`${name}的${dimension === 'video' ? '视频形式' : '项目类型'}`} onChange={value => { void save(value) }} />{error ? <small role="alert">{error}</small> : null}</div>
}
