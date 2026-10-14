import { AlertTriangle, FileClock, RefreshCw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectCurrentScriptController } from './useProjectCurrentScriptDocument'

function visibleText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const node = value as Record<string, unknown>
  if (node.type === 'hardBreak') return '\n'
  if (typeof node.text === 'string') return node.text
  return Array.isArray(node.content) ? node.content.map(visibleText).join('') : ''
}

function candidateLabel(kind: string, isFinal: boolean): string {
  if (isFinal) return '当前定稿'
  if (kind === 'user_edit') return '用户保存版本'
  if (kind === 'merged_draft') return '已保存文案'
  if (kind === 'external_draft') return '导入文案'
  return '历史文案'
}

function conflictSnippets(server: string, local: string): { server: string; local: string } {
  let difference = 0
  const limit = Math.min(server.length, local.length)
  while (difference < limit && server[difference] === local[difference]) difference += 1
  const start = Math.max(0, difference - 54)
  const slice = (value: string): string => `${start > 0 ? '…' : ''}${value.slice(start, start + 180)}${value.length > start + 180 ? '…' : ''}` || '（空白文案）'
  return { server: slice(server), local: slice(local) }
}

function locationPreviews(controller: ProjectCurrentScriptController): string[] {
  const pending = controller.pendingInitialization
  if (!pending) return []
  const blockTexts = new Map<string, string>()
  const collect = (value: unknown): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    const node = value as Record<string, unknown>
    if (node.type === 'hardBreak') return '\n'
    if (typeof node.text === 'string') return node.text
    const text = Array.isArray(node.content) ? node.content.map(collect).join('') : ''
    const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
      ? node.attrs as Record<string, unknown>
      : {}
    if (typeof attrs.blockId === 'string') blockTexts.set(attrs.blockId, text)
    return text
  }
  collect(pending.editorDocument)
  return pending.annotations.filter((annotation) => annotation.status === 'active').slice(0, 8).map((annotation) => {
    const block = blockTexts.get(annotation.blockId) ?? annotation.selectedText
    const start = Math.max(0, annotation.blockStart - 18)
    const end = Math.min(block.length, annotation.blockEnd + 18)
    const before = block.slice(start, annotation.blockStart)
    const selected = block.slice(annotation.blockStart, annotation.blockEnd) || annotation.selectedText
    const after = block.slice(annotation.blockEnd, end)
    return `${before}【${selected}】${after}`
  })
}

export function CurrentScriptLifecycleDialogs({
  controller,
  onNotice
}: {
  controller: ProjectCurrentScriptController
  onNotice(message: string): void
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const dialogRef = useRef<HTMLElement | null>(null)
  const recovery = controller.recoveryCandidates[0] ?? null
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      const preferred = dialog?.querySelector<HTMLElement>('.primary-action:not(:disabled)')
        ?? dialog?.querySelector<HTMLElement>('button:not(:disabled)')
      ;(preferred ?? dialog)?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (previous?.isConnected) previous.focus()
    }
  }, [controller.phase, recovery?.id])
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return
      if (busy) {
        dialog.focus()
        return
      }
      if (document.activeElement !== dialog) return
      const preferred = dialog.querySelector<HTMLElement>('.primary-action:not(:disabled)')
        ?? dialog.querySelector<HTMLElement>('button:not(:disabled)')
      preferred?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [busy])
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j')) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    if (!focusable.length) {
      event.preventDefault()
      event.currentTarget.focus()
      return
    }
    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (!focusable.includes(document.activeElement as HTMLElement)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const resolve = async (resolution: 'keep_server' | 'replace_with_attempt' | 'save_attempt_as_version'): Promise<void> => {
    if (!recovery) return
    setBusy(true)
    setLocalError('')
    try {
      onNotice(await controller.resolveRecovery(recovery.id, resolution))
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : '未保存内容处理失败')
    } finally {
      setBusy(false)
    }
  }

  if (controller.phase === 'selection_required') {
    return <div className="modal-backdrop current-script-lifecycle-backdrop"><section ref={dialogRef} tabIndex={-1} onKeyDown={trapFocus} className="confirm-dialog current-script-lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="current-script-initialize-title">
      <header><FileClock size={18} /><div><span>首次建立</span><h2 id="current-script-initialize-title">选择当前文案起点</h2></div></header>
      <p>项目里有多份已保存文案，App不会悄悄帮你覆盖。选一份作为唯一当前文案，其他版本继续保留。</p>
      <div className="current-script-candidate-list">{controller.candidates.map((candidate) => <button key={candidate.versionId} disabled={busy} onClick={() => {
        setBusy(true)
        void controller.initializeFromCandidate(candidate.versionId).catch(() => undefined).finally(() => setBusy(false))
      }}><span><b>{candidate.displayName || `文案v${candidate.revision}`}</b><small>{candidateLabel(candidate.kind, candidate.isFinal)}·{new Date(candidate.createdAt).toLocaleString('zh-CN', { hour12: false })}</small><small className="current-script-candidate-preview">{visibleText({ type: 'doc', content: [{ type: 'text', text: candidate.sourceContent.replace(/<[^>]*>/g, ' ') }] }).replace(/\s+/g, ' ').trim().slice(0, 72) || '（空白文案）'}</small></span><em>以此建立</em></button>)}</div>
      <footer><span>只有明确选中的版本会进入当前文案。</span>{!controller.candidates.length ? <button className="primary-action" disabled={busy} onClick={() => void controller.initializeFromCandidate(null)}>建立空白文案</button> : null}</footer>
    </section></div>
  }

  if (controller.phase === 'confirmation_required' && controller.pendingInitialization) {
    return <div className="modal-backdrop current-script-lifecycle-backdrop"><section ref={dialogRef} tabIndex={-1} onKeyDown={trapFocus} className="confirm-dialog current-script-lifecycle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="current-script-confirm-migration-title">
      <header><AlertTriangle size={18} /><div><span>位置需确认</span><h2 id="current-script-confirm-migration-title">旧标记在正文里有重复文字</h2></div></header>
      <p>旧版本只记了被标记文字，没有可靠的原坐标。请核对下面括号中的当前落点；未确认前不会建立当前文案。</p>
      {locationPreviews(controller).length ? <div className="current-script-location-list" aria-label="待确认标记位置">{locationPreviews(controller).map((preview, index) => <p key={`${index}:${preview}`}><span>位置{index + 1}</span>{preview}</p>)}</div> : null}
      <div className="current-script-lifecycle-warning">{controller.pendingInitialization.message}</div>
      <footer><button disabled={busy} onClick={() => void controller.reload()}><RefreshCw size={13} />重新选择</button><button className="primary-action" disabled={busy} onClick={() => {
        setBusy(true)
        void controller.confirmInitialization().catch(() => undefined).finally(() => setBusy(false))
      }}>确认当前位置</button></footer>
    </section></div>
  }

  if (controller.phase === 'error') {
    const hasPreservedLocalJournal = Boolean(controller.localJournalError)
    return <div className="modal-backdrop current-script-lifecycle-backdrop"><section ref={dialogRef} tabIndex={-1} onKeyDown={trapFocus} className="confirm-dialog current-script-lifecycle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="current-script-load-error-title">
      <header><AlertTriangle size={18} /><div><span>{hasPreservedLocalJournal ? '本地恢复稿已保留' : '未改动正文'}</span><h2 id="current-script-load-error-title">当前文案没有载入</h2></div></header>
      <p>{controller.error || '请重试；重试前App不会用其他版本覆盖当前文案。'}</p>
      {!hasPreservedLocalJournal && controller.candidates.length ? <div className="current-script-candidate-list" aria-label="改用其他已保存版本">{controller.candidates.map((candidate) => <button key={candidate.versionId} disabled={busy} onClick={() => {
        setBusy(true)
        void controller.initializeFromCandidate(candidate.versionId).catch(() => undefined).finally(() => setBusy(false))
      }}><span><b>{candidate.displayName || `文案v${candidate.revision}`}</b><small>{candidateLabel(candidate.kind, candidate.isFinal)}·{new Date(candidate.createdAt).toLocaleString('zh-CN', { hour12: false })}</small></span><em>改用这版</em></button>)}</div> : null}
      <footer><button className="danger-outline-action" disabled={busy} onClick={() => {
        setBusy(true)
        const action = hasPreservedLocalJournal ? controller.discardLocalJournal() : controller.initializeFromCandidate(null)
        void action.catch((reason) => setLocalError(reason instanceof Error ? reason.message : '操作失败')).finally(() => setBusy(false))
      }}>{hasPreservedLocalJournal ? '放弃本地恢复稿，载入服务端' : '不采用旧稿，建立空白文案'}</button><button className="primary-action" disabled={busy} onClick={() => {
        setBusy(true)
        void controller.reload().finally(() => setBusy(false))
      }}><RefreshCw size={13} />{hasPreservedLocalJournal ? '重试恢复' : '重新载入'}</button></footer>
      {localError ? <div className="current-script-lifecycle-warning" role="alert">{localError}</div> : null}
    </section></div>
  }

  if (!recovery || controller.phase !== 'ready') return null
  const localText = visibleText(recovery.editorDocument).trim()
  const latestServer = controller.snapshot
    && controller.snapshot.document.revision >= recovery.actual.document.revision
    ? controller.snapshot
    : recovery.actual
  const serverAdvanced = latestServer.document.revision > recovery.actual.document.revision
    || (latestServer.document.revision === recovery.actual.document.revision
      && latestServer.document.contentHash !== recovery.actual.document.contentHash)
  const serverText = visibleText(latestServer.document.editorDocument).trim()
  const previews = conflictSnippets(serverText, localText)
  const sameVisibleText = serverText === localText
  const formatChanged = JSON.stringify(recovery.actual.document.editorDocument) !== JSON.stringify(recovery.editorDocument)
  return <div className="modal-backdrop current-script-lifecycle-backdrop"><section ref={dialogRef} tabIndex={-1} onKeyDown={trapFocus} className="confirm-dialog current-script-lifecycle-dialog current-script-recovery-dialog" role="alertdialog" aria-modal="true" aria-labelledby="current-script-recovery-title">
    <header><AlertTriangle size={18} /><div><span>发现未保存副本</span><h2 id="current-script-recovery-title">选择如何处理文案冲突</h2></div></header>
    <p>另一个页面或上次异常退出后，当前文案已经发生变化。App保留了两份内容，不会自动取舍。</p>
    <div className="current-script-recovery-previews"><section><b>当前服务端稿·修订{latestServer.document.revision}</b><blockquote>{previews.server}</blockquote><small>{latestServer.annotations.length}个标记·{latestServer.sourceRelations.length}条来源关系</small></section><section><b>本地未保存副本·基于修订{recovery.expectedRevision}</b><blockquote>{previews.local}</blockquote><small>{recovery.annotations.length}个标记·{recovery.sourceRelations.length}条来源关系</small></section></div>
    {serverAdvanced ? <div className="current-script-lifecycle-warning">冲突发生后，服务端又更新到了修订{latestServer.document.revision}。上方已显示最新内容；选择替换会覆盖这份最新稿，冲突时的修订{recovery.actual.document.revision}仍保留在恢复记录中。</div> : null}
    {sameVisibleText && formatChanged ? <div className="current-script-lifecycle-warning">两份正文文字相同，差异来自格式、标记、备注或来源关系；请根据上方数量再选择。</div> : null}
    {localError ? <div className="current-script-lifecycle-warning" role="alert">{localError}</div> : null}
    <div className="current-script-recovery-actions">
      <button className="primary-action" disabled={busy} onClick={() => void resolve('save_attempt_as_version')}><Save size={14} /><span><b>另存副本</b><small>两份都保留，当前文案不变</small></span></button>
      <button className="danger-outline-action" disabled={busy} onClick={() => void resolve('keep_server')}><span><b>放弃本地副本</b><small>保留服务端较新稿</small></span></button>
      <button className="danger-outline-action" disabled={busy} onClick={() => void resolve('replace_with_attempt')}><span><b>用副本替换</b><small>覆盖上方当前服务端稿</small></span></button>
    </div>
    <footer><span>{controller.recoveryCandidates.length > 1 ? `处理完还有${controller.recoveryCandidates.length - 1}份副本` : '选择后才会继续编辑'}</span><em>{busy ? '正在处理…' : '内容已安全保留'}</em></footer>
  </section></div>
}
