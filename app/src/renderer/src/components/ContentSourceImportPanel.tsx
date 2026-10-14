import { AppSelect } from './AppSelect'
import { FileText, ScanSearch, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { ContentSourceImportResult, ContentSourceKind } from '../../../shared/domain'

const sourceLabels: Record<ContentSourceKind, string> = {
  codex_export: 'Codex导出内容',
  claude_export: 'Claude导出内容',
  pasted_text: '粘贴文字'
}

export function ContentSourceImportPanel({ onImported }: { onImported(result: ContentSourceImportResult): void }): React.JSX.Element {
  const [sourceKind, setSourceKind] = useState<ContentSourceKind>('codex_export')
  const [title, setTitle] = useState('')
  const [scopeLabel, setScopeLabel] = useState('本次手动选择的对话范围')
  const [rawContent, setRawContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (!window.creatorOS) { setError('请在LY Creator OS中打开'); return }
    setSubmitting(true); setError('')
    try {
      const result = await window.creatorOS.importContentSource({ sourceKind, title, scopeLabel, rawContent })
      onImported(result); setRawContent(''); setTitle('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '来源片段导入失败') }
    finally { setSubmitting(false) }
  }

  return <section className="content-source-import content-card" aria-labelledby="content-source-title">
    <header><div><span>1·明确导入范围</span><h2 id="content-source-title">来源片段</h2></div><FileText size={18} /></header>
    <div className="content-engine-safety-note"><ShieldCheck size={15} /><div><b>不会扫描全部私人对话</b><span>只处理你在下方明确粘贴的内容；原文仅保存在本机，候选只读取遮盖后的文本。</span></div></div>
    <div className="content-source-fields">
      <label><span>来源类型</span><AppSelect value={sourceKind} onChange={(event) => setSourceKind(event.currentTarget.value as ContentSourceKind)}>{Object.entries(sourceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</AppSelect></label>
      <label><span>来源标题（可选）</span><input value={title} maxLength={160} placeholder={`${sourceLabels[sourceKind]}·例如：项目复盘`} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label><span>选择范围说明</span><input value={scopeLabel} maxLength={300} onChange={(event) => setScopeLabel(event.currentTarget.value)} /></label>
      <label className="content-source-text"><span>粘贴明确选择的内容</span><textarea value={rawContent} maxLength={200_000} placeholder="粘贴一段Codex/Claude导出内容或普通文字。链接抓取和图片OCR尚未接通，因此不会伪装成已读取。" onChange={(event) => setRawContent(event.currentTarget.value)} /></label>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <footer><span>{rawContent.trim().length.toLocaleString('zh-CN')}字·导入前执行密钥与隐私扫描</span><button className="primary-action" disabled={submitting || rawContent.trim().length < 12} onClick={() => void submit()}><ScanSearch size={14} />{submitting ? '正在扫描…' : '扫描并生成洞察卡'}</button></footer>
  </section>
}
