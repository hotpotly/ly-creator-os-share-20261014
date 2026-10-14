import { ChevronDown, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { WORKSPACE_ACCESS_OPTIONS, type WorkspaceAccessGrant, type WorkspaceAccessState } from '../../../shared/workspace-access'
import './workspace-device-access.css'

type AccessProps = { deviceId: string; deviceName: string; disabled: boolean }

export function WorkspaceDeviceAccess(props: AccessProps): React.JSX.Element {
  return <WorkspaceDeviceAccessPanel key={props.deviceId} {...props} />
}

function WorkspaceDeviceAccessPanel({ deviceId, deviceName, disabled }: AccessProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<WorkspaceAccessState | null>(null)
  const [draft, setDraft] = useState<WorkspaceAccessGrant[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  useEffect(() => () => { generation.current++; pending.current = false }, [deviceId])
  const dirty = saved !== null && JSON.stringify(saved.grants) !== JSON.stringify(draft)
  const load = async (): Promise<void> => {
    if (pending.current || disabled) return
    const request = ++generation.current
    pending.current = true; setBusy(true); setMessage('')
    try {
      const result = await window.creatorOS!.getWorkspaceV2Access(deviceId)
      if (request !== generation.current) return
      if (result.deviceId !== deviceId) throw Error('授权设备不匹配')
      setSaved(result); setDraft(result.grants)
    } catch (error) { if (request === generation.current) setMessage(error instanceof Error ? error.message : '无法读取授权') }
    finally { if (request === generation.current) { pending.current = false; setBusy(false) } }
  }
  const toggle = (): void => {
    if (pending.current) return
    if (open) { setOpen(false); setConfirmation(false); setMessage(''); if (saved) setDraft(saved.grants) }
    else { setOpen(true); void load() }
  }
  const save = async (): Promise<void> => {
    if (!saved || pending.current || disabled || !confirmation || !dirty) return
    const request = ++generation.current
    pending.current = true; setBusy(true); setMessage('')
    try {
      const result = await window.creatorOS!.updateWorkspaceV2Access({ deviceId, expectedRevision: saved.revision, grants: draft })
      if (request !== generation.current) return
      if (result.deviceId !== deviceId) throw Error('授权设备不匹配')
      setSaved(result); setDraft(result.grants); setConfirmation(false)
    } catch (error) { if (request === generation.current) setMessage(error instanceof Error ? error.message : '授权保存失败') }
    finally { if (request === generation.current) { pending.current = false; setBusy(false) } }
  }
  const choose = (scope: WorkspaceAccessGrant['scope'], value: 'none' | 'read' | 'write'): void => {
    setDraft([...draft.filter(grant => grant.scope !== scope), ...(value === 'none' ? [] : [{ scope, write: value === 'write' }])].sort((a, b) => a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0))
    setConfirmation(false); setMessage('')
  }
  return <>
    <button type="button" className="workspace-access-trigger" aria-label={`${deviceName}的工作台授权`} aria-expanded={open} disabled={disabled || busy} onClick={toggle}><ShieldCheck size={14} />工作台授权<ChevronDown size={13} /></button>
    {open ? <section className="workspace-access" aria-label={`${deviceName}的工作台授权设置`} aria-busy={busy}>
      {!saved ? <div className="workspace-access-empty">{busy ? <span role="status">正在读取…</span> : <button type="button" disabled={disabled} onClick={() => void load()}>重新读取</button>}</div> : <>
        <div className="workspace-access-rows">{WORKSPACE_ACCESS_OPTIONS.map(option => {
          const grant = draft.find(value => value.scope === option.scope), selected = !grant ? 'none' : grant.write ? 'write' : 'read'
          return <div className="workspace-access-row" key={option.scope}><span>{option.label}</span><div className="workspace-access-choices" role="group" aria-label={`${option.label}权限`}>{([['none', '未授权'], ['read', '只读'], ...(option.editable ? [['write', '可编辑']] : [])] as ['none' | 'read' | 'write', string][]).map(([value, label]) => <button type="button" key={value} aria-pressed={selected === value} disabled={disabled || busy} onClick={() => choose(option.scope, value)}>{label}</button>)}</div></div>
        })}</div>
        {confirmation ? <div className="workspace-access-confirm" role="group" aria-label="确认工作台授权"><p>{draft.length ? `允许“${deviceName}”读取所选工作台资料${draft.some(grant => grant.write) ? '，可编辑权限允许修改电脑记录' : ''}。` : `停止“${deviceName}”的工作台同步。`}手机已有副本仍会保留。</p><div><button type="button" disabled={busy || disabled} onClick={() => setConfirmation(false)}>返回</button><button type="button" className="primary-action" autoFocus disabled={busy || disabled} onClick={() => void save()}>{busy ? '保存中…' : '确认授权'}</button></div></div> : <footer><button type="button" disabled={busy || disabled} onClick={() => void load()}>重新载入</button><button type="button" className="primary-action" disabled={busy || disabled || !dirty} onClick={() => setConfirmation(true)}>保存授权</button></footer>}
      </>}
      {message ? <p className="form-error" role="alert">{message}</p> : null}
    </section> : null}
  </>
}
