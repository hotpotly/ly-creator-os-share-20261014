import { AppSelect } from './AppSelect'
import { Copy, Download, ExternalLink, FileText, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DraftVersion, FeishuHandoffMode, FeishuHandoffRecord, ProjectDetail } from '../../../shared/domain'

interface Props {
  open: boolean
  project: ProjectDetail
  finalVersion: DraftVersion | null
  onClose(): void
  onNotice(message: string): void
}

function recordLabel(record: FeishuHandoffRecord): string {
  if (!record.documentUrl) return `${record.accountName}·链接待保存`
  try { return `${record.accountName}·${new URL(record.documentUrl).hostname}` } catch { return `${record.accountName}·已保存链接` }
}

export function FeishuHandoffDialog({ open, project, finalVersion, onClose, onNotice }: Props): React.JSX.Element | null {
  const [records, setRecords] = useState<FeishuHandoffRecord[]>([])
  const [mode, setMode] = useState<FeishuHandoffMode>('new_document')
  const [handoffId, setHandoffId] = useState<string>(() => crypto.randomUUID())
  const [targetHandoffId, setTargetHandoffId] = useState<string | null>(null)
  const [accountName, setAccountName] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [busy, setBusy] = useState<'copy' | 'word' | 'link' | 'open' | null>(null)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const linkedRecords = useMemo(() => records.filter((record) => Boolean(record.documentUrl)), [records])
  const selectedRecord = records.find((record) => record.id === handoffId) ?? null
  const selectedTargetRecord = records.find((record) => record.id === targetHandoffId) ?? null

  const replaceRecord = (record: FeishuHandoffRecord): void => {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)])
    setHandoffId(record.id)
    setAccountName(record.accountName)
    setDocumentUrl(record.documentUrl ?? '')
  }

  useEffect(() => {
    if (!open || !window.creatorOS) return
    setMode('new_document')
    setHandoffId(crypto.randomUUID())
    setTargetHandoffId(null)
    setDocumentUrl('')
    setError('')
    void window.creatorOS.listFeishuHandoffs(project.id).then((items) => {
      setRecords(items)
      setAccountName(items[0]?.accountName ?? '')
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '飞书交接记录加载失败'))
  }, [open, project.id])

  const chooseMode = (next: FeishuHandoffMode): void => {
    setMode(next)
    setError('')
    if (next === 'new_document') {
      setHandoffId(crypto.randomUUID())
      setTargetHandoffId(null)
      setDocumentUrl('')
      setAccountName(records[0]?.accountName ?? accountName)
      return
    }
    const linked = linkedRecords[0]
    if (linked) {
      setHandoffId(crypto.randomUUID())
      setTargetHandoffId(linked.id)
      setAccountName(linked.accountName)
      setDocumentUrl(linked.documentUrl ?? '')
    }
  }

  const selectLinkedRecord = (id: string): void => {
    const record = linkedRecords.find((item) => item.id === id)
    if (!record) return
    if (selectedRecord) setHandoffId(crypto.randomUUID())
    setTargetHandoffId(record.id)
    setAccountName(record.accountName)
    setDocumentUrl(record.documentUrl ?? '')
    setError('')
  }

  const input = (): { id: string; projectId: string; sourceVersionId: string; targetHandoffId: string | null; mode: FeishuHandoffMode; accountName: string; documentUrl: string | null } => {
    if (!finalVersion) throw new Error('请先定稿文案，再交接到飞书')
    if (!accountName.trim()) throw new Error('请填写这次使用的飞书账号名')
    if (mode === 'merge_update' && !selectedTargetRecord?.documentUrl) throw new Error('请先选择当前项目已保存的飞书原文档')
    return {
      id: handoffId,
      projectId: project.id,
      sourceVersionId: finalVersion.id,
      targetHandoffId,
      mode,
      accountName: accountName.trim(),
      documentUrl: mode === 'merge_update' ? null : documentUrl.trim() || null
    }
  }

  const run = async (kind: NonNullable<typeof busy>, operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    setError('')
    try { await operation() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '飞书交接操作失败') }
    finally { busyRef.current = false; setBusy(null) }
  }

  const copy = (): void => {
    void run('copy', async () => {
      const record = await window.creatorOS!.copyFeishuHandoff(input())
      replaceRecord(record)
      onNotice(mode === 'new_document' ? '定稿已复制；请在飞书手动新建文档并粘贴' : '定稿已复制；请打开原文档后手动合并')
    })
  }

  const exportWord = (): void => {
    void run('word', async () => {
      const result = await window.creatorOS!.exportFeishuHandoffWord(input())
      if (result.canceled || !result.record) return
      replaceRecord(result.record)
      onNotice('飞书交接Word已导出到所选位置')
    })
  }

  const saveLink = (): void => {
    void run('link', async () => {
      if (!documentUrl.trim()) throw new Error('请先粘贴新建后的飞书原文档链接')
      const record = await window.creatorOS!.saveFeishuHandoffLink(input())
      replaceRecord(record)
      onNotice('飞书原文档链接已保存')
    })
  }

  const openLink = (): void => {
    void run('open', async () => {
      const record = selectedTargetRecord ?? selectedRecord
      if (!record?.documentUrl) throw new Error('这条交接还没有保存飞书原文档链接')
      await window.creatorOS!.openFeishuHandoff(project.id, record.id)
    })
  }

  if (!open) return null
  return <div className="modal-backdrop feishu-handoff-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="feishu-handoff-dialog" role="dialog" aria-modal="true" aria-labelledby="feishu-handoff-title">
      <header><div><span>飞书第一版·人工交接</span><h2 id="feishu-handoff-title">复制定稿或导出Word</h2></div><button aria-label="关闭飞书交接" disabled={Boolean(busy)} onClick={onClose}><X size={17} /></button></header>
      {!finalVersion ? <div className="feishu-final-required"><FileText size={17} /><div><b>还没有定稿文案</b><span>请先在工作台点“定稿”；这里不会导出未保存的编辑内容。</span></div></div> : <div className="feishu-handoff-body">
        <section className="feishu-mode-switch" aria-label="飞书交接方式">
          <button className={mode === 'new_document' ? 'active' : ''} aria-pressed={mode === 'new_document'} onClick={() => chooseMode('new_document')}><b>新建文档</b><span>默认·复制后手动新建</span></button>
          <button className={mode === 'merge_update' ? 'active' : ''} aria-pressed={mode === 'merge_update'} disabled={!linkedRecords.length} onClick={() => chooseMode('merge_update')}><b>合并更新</b><span>{linkedRecords.length ? '打开原链接后手动粘贴' : '暂无已保存原链接'}</span></button>
        </section>
        <label>飞书账号名<input value={accountName} maxLength={80} onChange={(event) => setAccountName(event.currentTarget.value)} placeholder="例如：你的飞书账号名" /></label>
        {mode === 'merge_update' ? <label>当前项目的原文档<AppSelect value={targetHandoffId ?? ''} onChange={(event) => selectLinkedRecord(event.currentTarget.value)}>{linkedRecords.map((record) => <option value={record.id} key={record.id}>{recordLabel(record)}</option>)}</AppSelect></label> : <label>新文档链接·可稍后保存<div className="feishu-link-row"><input value={documentUrl} maxLength={2_000} onChange={(event) => setDocumentUrl(event.currentTarget.value)} placeholder="新建后粘贴 https://…feishu.cn/docx/…" /><button disabled={Boolean(busy) || !documentUrl.trim()} onClick={saveLink}>{busy === 'link' ? '保存中…' : '保存链接'}</button></div></label>}
        <div className="feishu-handoff-actions">
          <button className="primary-action" disabled={Boolean(busy) || !accountName.trim()} onClick={copy}><Copy size={14} />{busy === 'copy' ? '复制中…' : '复制定稿内容'}</button>
          <button disabled={Boolean(busy) || !accountName.trim()} onClick={exportWord}><Download size={14} />{busy === 'word' ? '导出中…' : '导出Word'}</button>
          {(selectedTargetRecord ?? selectedRecord)?.documentUrl ? <button disabled={Boolean(busy)} onClick={openLink}><ExternalLink size={14} />{busy === 'open' ? '打开中…' : '打开原文档'}</button> : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>}
      <footer><span>不会登录飞书、不会自动创建或更新文档；所有粘贴和合并仍由你确认。</span><button disabled={Boolean(busy)} onClick={onClose}>完成</button></footer>
    </section>
  </div>
}
