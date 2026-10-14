import { Archive, Check, FolderInput, HardDrive, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ARCHIVE_CATEGORIES, type ArchiveCategory, type ArchivePlan, type ArchiveRun, type ArchiveSlot, type NasArchiveDestinationStatus } from '../../../shared/domain'

const slotLabels: Record<ArchiveSlot, string> = {
  landscape_cover: '横屏封面',
  portrait_cover: '竖屏封面',
  business_files: '商务文件',
  subtitle_srt: 'SRT字幕',
  video_clean: '成片无字幕',
  video_burned_in: '成片有字幕',
  final_script_docx: '最终文案'
}
const categoryLabels: Record<ArchiveCategory, string> = { long_video: '长视频', short_video: '短视频', ai_video: 'AI视频' }
const selectableSlots = new Set<ArchiveSlot>(['landscape_cover', 'portrait_cover', 'video_clean', 'video_burned_in'])

function runStatus(run: ArchiveRun): string {
  if (run.status === 'committed') return '已完成'
  if (run.status === 'waiting_for_nas') return '等待NAS'
  if (run.status === 'failed') return '失败'
  if (run.status === 'canceled') return '已取消'
  return '归档中'
}

export function NasArchiveDialog({ projectId, onClose, onNotice }: { projectId: string; onClose(): void; onNotice(message: string): void }): React.JSX.Element {
  const [destination, setDestination] = useState<NasArchiveDestinationStatus | null>(null)
  const [category, setCategory] = useState<ArchiveCategory>('long_video')
  const [plan, setPlan] = useState<ArchivePlan | null>(null)
  const [runs, setRuns] = useState<ArchiveRun[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) return
    const [nextDestination, nextRuns] = await Promise.all([
      window.creatorOS.getNasArchiveDestination(),
      window.creatorOS.listNasArchiveRuns(projectId)
    ])
    setDestination(nextDestination); setRuns(nextRuns)
    const identity = nextRuns[0]
    if (identity) setCategory(identity.category)
  }, [projectId])

  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '无法读取归档设置')) }, [load])
  useEffect(() => {
    if (!runs.some((run) => ['prepared', 'copying', 'verifying'].includes(run.status))) return
    const timer = window.setInterval(() => void load(), 800)
    return () => window.clearInterval(timer)
  }, [load, runs])

  const prepare = async (): Promise<void> => {
    if (!window.creatorOS || busy) return
    setBusy('prepare'); setError('')
    try { setPlan(await window.creatorOS.prepareNasArchivePlan(projectId, category)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法生成归档预览') }
    finally { setBusy('') }
  }
  const mutateSlot = async (slot: ArchiveSlot, action: 'choose' | 'not_required' | 'automatic'): Promise<void> => {
    if (!window.creatorOS || busy) return
    setBusy(slot); setError('')
    try {
      if (action === 'choose' && selectableSlots.has(slot)) await window.creatorOS.chooseNasArchiveSlotFile(projectId, slot as Extract<ArchiveSlot, 'landscape_cover' | 'portrait_cover' | 'video_clean' | 'video_burned_in'>)
      else if (action !== 'choose') await window.creatorOS.setNasArchiveSlotStatus(projectId, slot, action)
      setPlan(await window.creatorOS.prepareNasArchivePlan(projectId, category))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '归档项目修改失败') }
    finally { setBusy('') }
  }
  const confirm = async (): Promise<void> => {
    if (!window.creatorOS || !plan || busy) return
    setBusy('confirm'); setError('')
    try {
      const run = await window.creatorOS.confirmNasArchivePlan(plan.id, plan.planHash)
      setPlan(null); await load(); onNotice(`已开始归档：${run.folderName}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '归档启动失败') }
    finally { setBusy('') }
  }
  const retry = async (runId: string): Promise<void> => {
    if (!window.creatorOS || busy) return
    setBusy(runId); setError('')
    try { await window.creatorOS.retryNasArchiveRun(runId); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '归档重试失败') }
    finally { setBusy('') }
  }
  const cancel = async (runId: string): Promise<void> => {
    if (!window.creatorOS || busy) return
    setBusy(runId); setError('')
    try { await window.creatorOS.cancelNasArchiveRun(runId); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '归档取消失败') }
    finally { setBusy('') }
  }

  return <div className="modal-backdrop nas-archive-backdrop"><section className="nas-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="nas-archive-title">
    <header><div><Archive size={17} /><div><h2 id="nas-archive-title">归档到NAS</h2><span>只复制最终产物，不删除本机文件</span></div></div><button aria-label="关闭NAS归档" onClick={onClose}><X size={16} /></button></header>
    {!destination ? <p className="nas-archive-loading">正在读取归档设置…</p> : !destination.configured ? <div className="nas-archive-empty"><HardDrive size={22} /><b>尚未设置NAS目录</b><p>先到设置中选择已挂载的归档目录。</p></div> : <>
      <div className="nas-archive-destination"><HardDrive size={15} /><span><b>{destination.displayName}</b><small>{destination.availability === 'ready' ? '已连接' : '当前未挂载'}</small></span>{!destination.liveSmbValidated ? <em>实机SMB待验证</em> : null}</div>
      <div className="nas-archive-category">{ARCHIVE_CATEGORIES.map((item) => <button key={item} className={category === item ? 'active' : ''} disabled={Boolean(runs[0])} onClick={() => { setCategory(item); setPlan(null) }}>{categoryLabels[item]}</button>)}</div>
      {!plan ? <div className="nas-archive-start"><p>先生成一份冻结预览，再确认写入。项目编号在首次确认后固定，不会自动改名。</p><button className="primary-action" disabled={busy === 'prepare' || destination.availability !== 'ready'} onClick={() => void prepare()}>{busy === 'prepare' ? '检查中…' : '检查归档内容'}</button></div> : <div className="nas-archive-plan">
        <div className="nas-archive-plan-head"><span><b>{plan.categoryLabel}/{plan.yearDirectory}/{plan.folderName}</b><small>{plan.identityFrozen ? '编号已固定' : '确认后固定编号'}</small></span><button onClick={() => void prepare()}><RefreshCw size={13} />重新检查</button></div>
        <div className="nas-archive-slots">{plan.items.map((item) => <article key={`${item.slot}:${item.ordinal}`} className={item.status}>
          <span className="nas-slot-state">{item.status === 'selected' ? <Check size={13} /> : item.status === 'not_required' ? '—' : '!'}</span>
          <div><b>{slotLabels[item.slot]}{item.ordinal ? ` ${item.ordinal + 1}` : ''}</b><small>{item.displayName}</small></div>
          <div className="nas-slot-actions">{selectableSlots.has(item.slot) ? <button disabled={Boolean(busy)} onClick={() => void mutateSlot(item.slot, 'choose')}><FolderInput size={12} />选择</button> : null}<button disabled={Boolean(busy)} onClick={() => void mutateSlot(item.slot, item.status === 'not_required' ? 'automatic' : 'not_required')}>{item.status === 'not_required' ? '恢复检查' : '不需要'}</button></div>
        </article>)}</div>
        <footer><span>{plan.missingCount ? `${plan.missingCount}项尚未准备，将记录在清单中` : '归档内容已准备'}</span><button onClick={() => setPlan(null)}>返回</button><button className="primary-action" disabled={Boolean(busy)} onClick={() => void confirm()}>{busy === 'confirm' ? '启动中…' : '确认并开始归档'}</button></footer>
      </div>}
      {runs.length ? <div className="nas-archive-runs"><header><b>最近归档</b><span>{runs.length}次</span></header>{runs.slice(0, 4).map((run) => <article key={run.id}><span><b>{run.folderName}</b><small>{runStatus(run)}{run.errorMessage ? ` · ${run.errorMessage}` : ''}</small></span><em className={run.status}>{runStatus(run)}</em>{['prepared', 'copying', 'verifying'].includes(run.status) ? <button disabled={busy === run.id} onClick={() => void cancel(run.id)}><X size={12} />取消</button> : null}{['failed', 'waiting_for_nas', 'canceled'].includes(run.status) ? <button disabled={busy === run.id} onClick={() => void retry(run.id)}><RotateCcw size={12} />重试</button> : null}</article>)}</div> : null}
    </>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section></div>
}
