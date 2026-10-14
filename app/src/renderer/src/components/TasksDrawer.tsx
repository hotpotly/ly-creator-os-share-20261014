import { Activity, CheckCircle2, Clock3, Play, RefreshCw, Square, X, XCircle } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderCapability, TaskRun } from '../../../shared/domain'
import { taskNeedsAttention } from '../../../shared/task-visibility'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'

interface Props { open: boolean; onClose(): void }
const statusLabel: Record<TaskRun['status'], string> = { queued: '排队中', running: '运行中', waiting_confirmation: '等待确认', succeeded: '已完成', failed: '失败', canceled: '已取消' }
const providerStatusLabel: Record<ProviderCapability['status'], string> = { available: '可用', not_installed: '未安装', verification_required: '待验证', verifying: '验证中', verification_failed: '验证失败' }

export function TasksDrawer({ open, onClose }: Props): React.JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null); const drawerRef = useRef<HTMLElement>(null)
  const { tasks, projects, providerCapabilities } = useWorkspaceStore((state) => state.snapshot)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [showCompleted, setShowCompleted] = useState(false); const [error, setError] = useState(''); const [verifyingProvider, setVerifyingProvider] = useState<string | null>(null)
  const [fallbackProviderConfigId, setFallbackProviderConfigId] = useState<string | null>(null)
  const [fallbackRetryingTaskIds, setFallbackRetryingTaskIds] = useState<Set<string>>(() => new Set())
  const activeTasks = useMemo(() => tasks.filter(taskNeedsAttention), [tasks])
  const activeRetrySourceIds = useMemo(() => new Set(tasks.filter((task) => task.retryOfId && ['queued', 'running', 'waiting_confirmation'].includes(task.status)).map((task) => task.retryOfId!)), [tasks])
  const visibleTasks = showCompleted ? tasks : activeTasks
  useEffect(() => { if (!open) return; const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeRef.current?.focus(); return () => previousFocus?.focus() }, [open])
  useEffect(() => {
    if (!open || !window.creatorOS) return
    void window.creatorOS.getProviderSettings().then((settings) => setFallbackProviderConfigId(settings.fallbackProviderConfigId)).catch(() => setFallbackProviderConfigId(null))
  }, [open])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') { onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? [])
    if (!focusable.length) return
    const first = focusable[0]; const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault() }
    else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault() }
  }
  const act = async (action: () => Promise<unknown>): Promise<void> => { try { setError(''); await action(); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : '任务操作失败') } }
  const retryWithFallback = async (taskId: string): Promise<void> => {
    if (!window.creatorOS || fallbackRetryingTaskIds.has(taskId) || activeRetrySourceIds.has(taskId)) return
    setFallbackRetryingTaskIds((current) => new Set(current).add(taskId))
    try { await act(() => window.creatorOS!.retryTaskWithFallback(taskId)) }
    finally {
      setFallbackRetryingTaskIds((current) => {
        const next = new Set(current)
        next.delete(taskId)
        return next
      })
    }
  }
  const validateProvider = async (provider: 'codex_cli' | 'claude_cli'): Promise<void> => {
    if (!window.creatorOS || verifyingProvider) return
    setVerifyingProvider(provider)
    try { await act(() => window.creatorOS!.validateProviderSecurity(provider)) }
    finally { setVerifyingProvider(null) }
  }
  const runMock = (): void => { const project = projects.find((item) => item.id === 'ai-browser') ?? projects[0]; if (!project || !window.creatorOS) return; void act(() => window.creatorOS!.createTask({ taskType: 'mock_demo', projectId: project.id, title: 'Mock流程检查', provider: 'mock', input: '检查进度、取消、重试与日志脱敏链路。' })) }
  if (!open) return null
  return <div className="drawer-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside id="tasks-drawer" ref={drawerRef} className="tasks-drawer" role="dialog" aria-modal="true" aria-labelledby="tasks-title" onKeyDown={onKeyDown}>
    <header><div><span>全局任务</span><h2 id="tasks-title">运行任务</h2></div><button ref={closeRef} aria-label="关闭运行任务" onClick={onClose}><X size={18} /></button></header>
    <div className="task-summary"><b>{activeTasks.length}</b><span>正在处理、失败或等待你确认</span><button onClick={runMock}><Play size={13} />运行Mock</button></div>
    <div className="provider-strip">{providerCapabilities.filter((item) => item.provider !== 'none').map((item) => <span key={item.provider} className={item.available ? 'available' : item.status}><i />{item.displayName}{providerStatusLabel[item.status]}{item.provider === 'codex_cli' || item.provider === 'claude_cli' ? <button title={`${item.detail}。刷新状态会重新调用一次CLI安全验证，可能计入用量。`} disabled={Boolean(verifyingProvider)} onClick={() => void validateProvider(item.provider as 'codex_cli' | 'claude_cli')}>{verifyingProvider === item.provider ? '刷新中…' : '刷新状态'}</button> : null}</span>)}</div>
    {error ? <div className="task-error" role="alert">{error}</div> : null}
    <div className="task-list">{visibleTasks.map((task) => { const project = projects.find((item) => item.id === task.projectId); const icon = task.status === 'succeeded' ? <CheckCircle2 size={15} /> : task.status === 'failed' ? <XCircle size={15} /> : task.status === 'waiting_confirmation' ? <Clock3 size={15} /> : <Activity size={15} />; const fallbackRetrying = fallbackRetryingTaskIds.has(task.id) || activeRetrySourceIds.has(task.id); return <article className={`task-item ${task.status}`} key={task.id}><span className="square-mark">{icon}</span><div><b>{task.title}</b>{project ? <button className="inline-project-link" onClick={() => { onClose(); navigate(task.taskType === 'distribution_analysis' ? { page: 'distribution' } : task.taskType === 'draft_generation' ? { page: 'workbench', projectId: project.id } : { page: 'project', projectId: project.id, moduleKey: task.taskType === 'outline_generation' ? 'outline' : task.taskType === 'material_research' ? 'materials' : 'overview' }) }}>{project.title} · {task.progress}%</button> : task.taskType === 'distribution_analysis' ? <button className="inline-project-link" onClick={() => { onClose(); navigate({ page: 'distribution' }) }}>批量分发 · {task.progress}%</button> : <span>{task.errorMessage ?? task.resultSummary ?? task.inputSnapshot}</span>}{['running', 'queued'].includes(task.status) ? <progress aria-label={`${task.title}进度`} value={task.progress} max="100" /> : null}{task.status === 'failed' && task.errorMessage ? <small>{task.errorMessage}</small> : null}</div><div className="task-controls"><span className={`status-pill ${task.status === 'running' || task.status === 'queued' ? 'running' : task.status === 'succeeded' ? 'success' : 'waiting'}`}>{statusLabel[task.status]}</span>{['running', 'queued', 'waiting_confirmation'].includes(task.status) ? <button aria-label={`取消${task.title}`} onClick={() => void act(() => window.creatorOS!.cancelTask(task.id))}><Square size={13} /></button> : null}{task.status === 'waiting_confirmation' ? <button className="task-action" onClick={() => void act(() => window.creatorOS!.confirmTask(task.id))}>确认继续</button> : null}{task.status === 'failed' ? <button className="task-action" aria-label={`关闭${task.title}`} title="关闭并移入已取消历史" onClick={() => void act(() => window.creatorOS!.dismissTask(task.id))}><X size={12} />关闭</button> : null}{['failed', 'canceled'].includes(task.status) ? <button className="task-action" onClick={() => void act(() => window.creatorOS!.retryTask(task.id))}><RefreshCw size={12} />重试</button> : null}{fallbackProviderConfigId && task.taskType === 'conversation_filter' && ['failed', 'canceled'].includes(task.status) ? <button className="task-action" disabled={fallbackRetrying} onClick={() => void retryWithFallback(task.id)}>{fallbackRetrying ? '备用重试中…' : '用备用AI重试'}</button> : null}</div></article> })}</div>
    <footer className="tasks-footer"><button onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? '隐藏已完成' : '查看已完成与已取消'}</button><span>任务状态保存在本机SQLite</span></footer>
  </aside></div>
}
