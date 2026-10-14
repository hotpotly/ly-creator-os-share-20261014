import { ProjectTemplateSettings } from './ProjectTemplateSettings'
import { ContentTypeLabel } from './ContentTypeLabel'
import { AppSelect } from './AppSelect'
import { AlertTriangle, ArrowDown, ArrowUp, Captions, Check, CheckCircle2, ChevronDown, CloudSun, Film, Fingerprint, HardDrive, Image, KeyRound, LayoutGrid, Library, LockKeyhole, MessageSquareText, Music2, PenTool, Plus, RefreshCw, Settings2, ShieldCheck, Smartphone, Tags, Trash2, Unplug, Wifi, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ARCHIVE_CATEGORIES, BUILTIN_TEXT_PROVIDER_CONFIG_IDS, DEFAULT_TODO_CATEGORY_COLORS, DEFAULT_TODO_CATEGORY_LABELS, DEFAULT_TODO_CATEGORY_WEIGHTS, EXTERNAL_PROVIDER_KINDS, PROJECT_COLOR_TOKENS, PROJECT_PLATFORMS, TODO_CATEGORY_ORDER, type AppearanceSnapshot, type ArchiveCategory, type ExternalProviderConfig, type ExternalProviderConfigInput, type ExternalProviderKind, type MobileSyncStatus, type NasArchiveDestinationStatus, type NasBackupStatus, type ProjectColorToken, type ProviderSettings, type PublishingAccount, type PublishingAccountState, type ResourceRecord, type TodoCategory, type VisualStyle } from '../../../shared/domain'
import type { BusinessLedgerLockStatus } from '../../../shared/domain'
import type { AppInfo } from '../../../shared/ipc'
import { calculateDailyTodoGrowth } from '../../../shared/todo-growth'
import { WEATHER_CITY_OPTIONS, type WeatherCondition } from '../../../shared/weather'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { showStagePreview } from '../utils/stage-preview'
import { AnchoredPopover } from './AnchoredPopover'
import { ProjectPlatformControl } from './ProjectPlatformControl'
import { ScheduleCard } from './ScheduleCard'
import { WorkspaceManagementSettings } from './WorkspaceManagementSettings'
import { WorkspaceDeviceAccess } from './WorkspaceDeviceAccess'

export function ToolsPage(): React.JSX.Element {
  const allProjects = useWorkspaceStore((state) => state.snapshot.projects)
  const projects = useMemo(() => allProjects.filter((project) => project.topicStageRole === 'project_created' && !project.trashedAt), [allProjects])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]
  const tools = [
    { key: 'content-engine', icon: MessageSquareText, title: 'AI选题筛选', ready: true },
    { key: 'script', icon: PenTool, title: '文案对话与写作', ready: true },
    { key: 'subtitle', icon: Captions, title: '字幕' },
    { key: 'cover', icon: Image, title: '封面制作' },
    { key: 'distribution', icon: Film, title: '批量分发', ready: true },
    { key: 'music', icon: Music2, title: '配乐与音效' },
    { key: 'ai-video', icon: Film, title: 'AI视频制作' }
  ]
  const openTool = (key?: string): void => {
    if (key === 'content-engine') { navigate({ page: 'content-engine' }); return }
    if (key === 'distribution') { navigate({ page: 'distribution' }); return }
    if (key === 'music') { showStagePreview('配乐与音效是额外创作工具，将在后续阶段接通'); return }
    if (!selectedProject) { showStagePreview('请先创建一个内容项目'); return }
    if (key === 'script') { navigate({ page: 'workbench', projectId: selectedProject.id }); return }
    if (key === 'subtitle' || key === 'cover') { navigate({ page: 'project', projectId: selectedProject.id, moduleKey: 'postproduction' }); return }
    if (key === 'ai-video') {
      if (selectedProject.contentTypeId !== 'type-ai') { showStagePreview('AI视频制作当前只在AI内容项目中提供'); return }
      navigate({ page: 'project', projectId: selectedProject.id, moduleKey: 'production' }); return
    }
    showStagePreview('该创作工具将在后续阶段接通')
  }
  return <main className="page tools-page"><header className="page-header tools-header"><div><h1>创作工具</h1></div><label className="tool-project-context"><span>当前项目</span><AppSelect value={selectedProject?.id ?? ''} onChange={(event) => setSelectedProjectId(event.currentTarget.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</AppSelect></label></header><div className="tool-grid">{tools.map(({ key, icon: Icon, title, ready }) => <section className="content-card tool-card" key={title}><span className="tool-icon"><Icon size={20} /></span><h2>{title}</h2><button className={ready ? 'primary-action' : ''} onClick={() => openTool(key)}>{key === 'content-engine' ? '选择对话并筛选' : key === 'distribution' ? '管理分发批次' : key === 'script' ? '进入文案工作台' : key === 'subtitle' || key === 'cover' || key === 'ai-video' ? '进入项目制作' : '查看规划'}</button></section>)}</div></main>
}

export function SchedulePage({ projectId, anchorDate }: { projectId?: string; anchorDate?: string }): React.JSX.Element {
  return <main className="page schedule-page"><header className="page-header"><div><h1>排期</h1></div></header><ScheduleCard full initialProjectFilter={projectId} initialDate={anchorDate} /></main>
}

export function ResourcesPage({ highlightedResourceId }: { highlightedResourceId?: string }): React.JSX.Element {
  const resourceRecords = useWorkspaceStore((state) => state.snapshot.resources)
  const [accountState, setAccountState] = useState<PublishingAccountState | null>(null)
  const resources = [
    { title: '存量文案与风格', types: ['style_profile'] as ResourceRecord['resourceType'][] },
    { title: '封面风格库', types: ['cover_style_profile'] as ResourceRecord['resourceType'][] },
    { title: '素材库', types: ['material'] as ResourceRecord['resourceType'][] },
    { title: '内容模板', types: ['template'] as ResourceRecord['resourceType'][] },
    { title: '账号矩阵', types: ['account'] as ResourceRecord['resourceType'][] }
  ]
  useEffect(() => { void window.creatorOS?.getPublishingAccountState().then(setAccountState) }, [])
  useEffect(() => {
    if (!highlightedResourceId) return
    window.requestAnimationFrame(() => document.getElementById(`resource-row-${highlightedResourceId}`)?.scrollIntoView({ block: 'center' }))
  }, [highlightedResourceId, resourceRecords])
  return <main className="page resources-page"><header className="page-header"><div><h1>资源</h1></div></header><div className="resource-grid">{resources.map((resource) => { const records = resourceRecords.filter((record) => resource.types.includes(record.resourceType)); const highlighted = records.find((record) => record.id === highlightedResourceId); const shown = highlighted && !records.slice(0, 4).some((record) => record.id === highlighted.id) ? [...records.slice(0, 3), highlighted] : records.slice(0, 4); const isAccounts = resource.title === '账号矩阵'; return <section className="content-card" key={resource.title}><Library size={19} /><h2>{resource.title}</h2>{isAccounts ? accountState?.accounts.length ? <ul className="resource-preview-list">{accountState.accounts.slice(0, 6).map((account) => <li key={account.id}><span>{account.accountName}<small>{[account.platform, account.maskedPhone, account.maskedEmail].filter(Boolean).join(' · ')}</small></span><em>{account.status === 'active' ? '使用中' : '停用'}</em></li>)}</ul> : <small className="resource-empty-label">暂无平台账号</small> : records.length ? <ul className="resource-preview-list">{shown.map((record) => <li id={`resource-row-${record.id}`} className={highlightedResourceId === record.id ? 'search-highlighted' : ''} key={record.id}><span>{record.name}</span><em>{record.selectionMode === 'automatic' ? '自动' : record.selectionMode === 'recommended' ? '推荐' : '手动'}</em></li>)}</ul> : <small className="resource-empty-label">暂无已保存资源</small>}<button onClick={() => isAccounts ? navigate({ page: 'settings' }) : showStagePreview(records.length ? `已有${records.length}项资源接入项目任务；完整管理页后续开放` : `${resource.title}将在对应实施阶段开放添加`)}>{isAccounts ? '在设置中管理' : records.length ? `已接入${records.length}项` : '查看规划'}</button></section> })}</div></main>
}

const externalProviderLabels: Record<ExternalProviderKind, string> = {
  openai_api: 'OpenAI',
  anthropic_api: 'Anthropic',
  gemini_api: 'Gemini',
  deepseek_api: 'DeepSeek',
  openai_compatible: 'OpenAI兼容API'
}
const providerModelPlaceholders: Record<ExternalProviderKind, string> = {
  openai_api: '例如：gpt-5.4-mini',
  anthropic_api: '例如：claude-sonnet-4-6',
  gemini_api: '例如：gemini-3-flash-preview',
  deepseek_api: '例如：deepseek-chat',
  openai_compatible: '填写服务提供的模型ID'
}

function ProviderSettingsSection(): React.JSX.Element {
  const capabilities = useWorkspaceStore((state) => state.snapshot.providerCapabilities)
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [editing, setEditing] = useState<ExternalProviderConfig | 'new' | null>(null)
  const [input, setInput] = useState<ExternalProviderConfigInput>({ kind: 'deepseek_api', displayName: 'DeepSeek', model: '', apiKey: '' })
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const refreshSettings = async (): Promise<void> => {
    if (!window.creatorOS) return
    setSettings(await window.creatorOS.getProviderSettings())
  }
  useEffect(() => { void refreshSettings().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '无法读取AI配置')) }, [])
  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(key); setMessage('')
    try { await action(); await refreshSettings() } catch (error) { setMessage(error instanceof Error ? error.message : 'AI配置操作失败') }
    finally { setBusy('') }
  }
  const beginCreate = (): void => {
    setEditing('new')
    setInput({ kind: 'deepseek_api', displayName: 'DeepSeek', model: '', apiKey: '' })
    setDeleteConfirmId(null); setMessage('')
  }
  const beginEdit = (config: ExternalProviderConfig): void => {
    setEditing(config)
    setInput({ id: config.id, kind: config.kind, displayName: config.displayName, baseUrl: config.baseUrl, model: config.model, apiKey: '' })
    setDeleteConfirmId(null); setMessage('')
  }
  const save = (): void => {
    void run('save', async () => {
      await window.creatorOS!.saveExternalProviderConfig({
        ...input,
        apiKey: input.apiKey?.trim() || undefined,
        baseUrl: input.kind === 'openai_compatible' ? input.baseUrl : undefined
      })
      setEditing(null)
    })
  }
  const cliChoices = [
    { id: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex, label: 'Codex CLI', capability: capabilities.find((item) => item.provider === 'codex_cli') },
    { id: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude, label: 'Claude CLI', capability: capabilities.find((item) => item.provider === 'claude_cli') }
  ]
  const choices = [
    ...cliChoices.map((choice) => ({ id: choice.id, label: choice.label })),
    ...(settings?.configs.map((config) => ({ id: config.id, label: config.displayName })) ?? [])
  ]
  const customAddressChanged = editing && editing !== 'new' && input.kind === 'openai_compatible'
    ? (input.baseUrl ?? '').replace(/\/+$/, '') !== editing.baseUrl.replace(/\/+$/, '')
    : false
  if (!settings) return <section className="settings-group card provider-settings"><header className="settings-group-head"><b>AI与模型</b><span>{message || '正在读取本机配置…'}</span></header>{message ? <p className="form-error" role="alert">{message}</p> : null}</section>
  return <section className="settings-group card provider-settings">
    <header className="settings-group-head provider-settings-head"><div><KeyRound size={17} /><div><b>AI与模型</b><span>本机CLI优先；外部API key仅以macOS安全存储密文落盘</span></div></div><button onClick={beginCreate} disabled={!settings.securityAvailable || Boolean(editing)}><Plus size={14} />添加API</button></header>
    <div className="provider-routing-grid">
      <label><span>默认AI</span><AppSelect aria-label="默认AI" value={settings.defaultProviderConfigId} onChange={(event) => { const providerConfigId = event.currentTarget.value; void run('routing', async () => { await window.creatorOS!.setProviderRouting(providerConfigId, settings.fallbackProviderConfigId === providerConfigId ? null : settings.fallbackProviderConfigId) }) }}>{choices.map((choice) => <option value={choice.id} key={choice.id}>{choice.label}</option>)}</AppSelect><small>新任务只有明确采用默认路由时才使用；不会静默替换用户已选Provider。</small></label>
      <label><span>备用AI</span><AppSelect aria-label="备用AI" value={settings.fallbackProviderConfigId ?? ''} onChange={(event) => { const fallbackProviderConfigId = event.currentTarget.value || null; void run('routing', async () => { await window.creatorOS!.setProviderRouting(settings.defaultProviderConfigId, fallbackProviderConfigId) }) }}><option value="">不设置</option>{choices.filter((choice) => choice.id !== settings.defaultProviderConfigId).map((choice) => <option value={choice.id} key={choice.id}>{choice.label}</option>)}</AppSelect><small>默认AI失败后只提供“用备用AI重试”，不会自动调用或产生费用。</small></label>
    </div>
    <div className="provider-config-list">
      {cliChoices.map(({ id, label, capability }) => <article className="provider-config-row builtin" key={id}><span className="provider-kind-mark">CLI</span><div><b>{label}</b><small>{capability?.detail ?? '正在检测本机登录状态'}</small></div><em className={`provider-config-status ${capability?.available ? 'available' : ''}`}>{capability?.available ? '可用' : capability?.status === 'not_installed' ? '未安装' : '待安全验证'}</em></article>)}
      {settings.configs.map((config) => <article className="provider-config-row" key={config.id}><span className="provider-kind-mark">API</span><div><b>{config.displayName}</b><small>{externalProviderLabels[config.kind]} · {config.model} · key已安全保存</small>{config.lastError ? <small className="provider-config-error">{config.lastError}</small> : null}</div><em className={`provider-config-status ${config.status}`}>{config.status === 'available' ? '连接正常' : config.status === 'failed' ? '连接失败' : '待验证'}</em><div className="provider-config-actions"><button disabled={Boolean(busy)} onClick={() => void run(`validate:${config.id}`, async () => { await window.creatorOS!.validateExternalProviderConfig(config.id) })}>{busy === `validate:${config.id}` ? '验证中…' : <><RefreshCw size={12} />验证连接</>}</button><button disabled={Boolean(busy || editing)} onClick={() => beginEdit(config)}>编辑</button>{deleteConfirmId === config.id ? <><button className="danger" disabled={Boolean(busy)} onClick={() => void run(`delete:${config.id}`, async () => { await window.creatorOS!.deleteExternalProviderConfig(config.id); setDeleteConfirmId(null) })}>确认删除</button><button onClick={() => setDeleteConfirmId(null)}>取消</button></> : <button aria-label={`删除${config.displayName}`} disabled={Boolean(busy || editing)} onClick={() => setDeleteConfirmId(config.id)}><Trash2 size={13} /></button>}</div></article>)}
      {!settings.configs.length && !editing ? <p className="provider-config-empty">还没有外部API。Codex与Claude CLI仍是默认优先路径。</p> : null}
    </div>
    {editing ? <div className="provider-config-form">
      <header><div><b>{editing === 'new' ? '添加外部API' : `编辑${editing.displayName}`}</b><span>{editing === 'new' ? '首次保存需要API key' : 'API key留空会保留当前密钥'}</span></div><button aria-label="关闭API配置" onClick={() => setEditing(null)}><X size={15} /></button></header>
      <div className="provider-config-fields">
        <label><span>类型</span><AppSelect value={input.kind} disabled={editing !== 'new'} onChange={(event) => { const kind = event.currentTarget.value as ExternalProviderKind; setInput((current) => ({ ...current, kind, displayName: editing === 'new' ? externalProviderLabels[kind] : current.displayName, baseUrl: '' })) }}>{EXTERNAL_PROVIDER_KINDS.map((kind) => <option key={kind} value={kind}>{externalProviderLabels[kind]}</option>)}</AppSelect></label>
        <label><span>显示名称</span><input value={input.displayName} maxLength={80} onChange={(event) => { const displayName = event.currentTarget.value; setInput((current) => ({ ...current, displayName })) }} /></label>
        <label><span>模型ID</span><input value={input.model} maxLength={160} placeholder={providerModelPlaceholders[input.kind]} onChange={(event) => { const model = event.currentTarget.value; setInput((current) => ({ ...current, model })) }} /></label>
        {input.kind === 'openai_compatible' ? <label className="provider-base-url"><span>API地址</span><input type="url" value={input.baseUrl ?? ''} maxLength={2_000} placeholder="https://example.com/v1" onChange={(event) => { const baseUrl = event.currentTarget.value; setInput((current) => ({ ...current, baseUrl })) }} /></label> : null}
        <label className="provider-secret"><span>API key</span><input type="password" autoComplete="new-password" value={input.apiKey ?? ''} maxLength={8_000} placeholder={editing === 'new' ? '粘贴API key' : '留空保留现有key'} onChange={(event) => { const apiKey = event.currentTarget.value; setInput((current) => ({ ...current, apiKey })) }} /></label>
      </div>
      <footer><span><ShieldCheck size={13} />{customAddressChanged ? '修改API地址时必须重新填写key。' : 'Renderer不会读取、显示或回传已保存的key。'}</span><button onClick={() => setEditing(null)}>取消</button><button className="primary-action" disabled={Boolean(busy) || !input.displayName.trim() || !input.model.trim() || (editing === 'new' && !input.apiKey?.trim()) || (customAddressChanged && !input.apiKey?.trim()) || (input.kind === 'openai_compatible' && !input.baseUrl?.trim())} onClick={save}>{busy === 'save' ? '保存中…' : <><Check size={13} />安全保存</>}</button></footer>
    </div> : null}
    <p className="provider-cloud-note"><AlertTriangle size={13} />本机CLI和外部API都会把你确认的任务内容发送到对应云端；添加配置不会自动发起请求，只有“验证连接”或明确运行任务才会调用。</p>
    {message ? <p className="form-error" role="alert">{message}</p> : null}
  </section>
}

function NasArchiveSettingsSection(): React.JSX.Element {
  const [status, setStatus] = useState<NasArchiveDestinationStatus | null>(null)
  const [labels, setLabels] = useState<Record<ArchiveCategory, string> | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [backup, setBackup] = useState<NasBackupStatus | null>(null)
  const load = useCallback(async (): Promise<void> => {
    if (!window.creatorOS) return
    const [next, backupStatus] = await Promise.all([window.creatorOS.getNasArchiveDestination(), window.creatorOS.getNasBackupStatus()])
    setStatus(next); setLabels(next.categoryLabels); setBackup(backupStatus)
  }, [])
  useEffect(() => { void load().catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : '无法读取NAS设置')) }, [load])
  useEffect(() => {
    if (backup?.status !== 'running') return
    const timer = window.setInterval(() => void load(), 1_000)
    return () => window.clearInterval(timer)
  }, [backup?.status, load])
  const run = async (key: string, action: () => Promise<NasArchiveDestinationStatus>): Promise<void> => {
    if (busy) return
    setBusy(key); setMessage('')
    try { const next = await action(); setStatus(next); setLabels(next.categoryLabels); setEditing(false) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'NAS设置保存失败') }
    finally { setBusy('') }
  }
  return <section className="settings-group card nas-settings">
    <header className="settings-group-head nas-settings-head"><div><HardDrive size={17} /><div><b>NAS归档</b><span>只保存最终产物；成片保持外部关联，不复制进App</span></div></div>{status?.availability === 'ready' ? <span className="status-pill running">已连接</span> : <span className="status-pill">{status?.configured ? '未挂载' : '未设置'}</span>}</header>
    <div className="nas-settings-location"><span><b>{status?.displayName ?? '尚未选择归档目录'}</b><small>{status?.configured ? '真实路径仅保留在Main进程安全存储中' : '请选择Finder中已经挂载的NAS文件夹'}</small></span><button disabled={Boolean(busy)} onClick={() => void run('choose', () => window.creatorOS!.chooseNasArchiveDestination())}>{status?.configured ? '重新选择' : '选择目录'}</button>{status?.configured ? <button disabled={Boolean(busy)} onClick={() => setEditing((value) => !value)}>分类名称</button> : null}{status?.configured ? <button className="danger" disabled={Boolean(busy)} onClick={() => void run('clear', () => window.creatorOS!.clearNasArchiveDestination())}>解除关联</button> : null}</div>
    {status?.configured ? <div className="nas-backup-status"><span><b>数据库日备份</b><small>{backup?.status === 'running' ? '正在同步到NAS…' : backup?.status === 'failed' ? backup.errorMessage : backup?.lastSucceededAt ? `最近成功：${new Date(backup.lastSucceededAt).toLocaleString('zh-CN')}` : '连接后自动执行，每日最多一份'}</small></span><button disabled={backup?.status === 'running' || status.availability !== 'ready'} onClick={() => { setBackup((current) => current ? { ...current, status: 'running' } : current); void window.creatorOS?.runNasBackup().then(setBackup) }}>{backup?.status === 'running' ? '备份中…' : '立即同步'}</button></div> : null}
    {editing && labels ? <div className="nas-category-settings">{ARCHIVE_CATEGORIES.map((category) => <label key={category}><span>{category === 'long_video' ? '长视频' : category === 'short_video' ? '短视频' : 'AI视频'}</span><input value={labels[category]} maxLength={40} onChange={(event) => { const label = event.currentTarget.value; setLabels((current) => current ? { ...current, [category]: label } : current) }} /></label>)}<button onClick={() => setEditing(false)}>取消</button><button className="primary-action" disabled={Boolean(busy)} onClick={() => void run('labels', () => window.creatorOS!.setNasArchiveCategoryLabels(labels))}>保存</button></div> : null}
    {status?.configured && !status.liveSmbValidated ? <p className="provider-cloud-note"><AlertTriangle size={13} />当前只完成本机挂载目录传输测试，尚未在所选NAS的真实SMB挂载上通过大文件、断线与重试验证；正式归档前请先做一次实机验证。</p> : null}
    {message ? <p className="form-error" role="alert">{message}</p> : null}
  </section>
}

function PublishingAccountsSettingsSection(): React.JSX.Element {
  const emptyInput = { accountId: null as string | null, platform: 'B站', accountName: '', positioning: '', phone: '', email: '', clearContact: false }
  const [state, setState] = useState<PublishingAccountState | null>(null)
  const [input, setInput] = useState(emptyInput)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(async (): Promise<void> => {
    if (window.creatorOS) setState(await window.creatorOS.getPublishingAccountState())
  }, [])
  useEffect(() => { void load().catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : '无法读取发布账号')) }, [load])
  const edit = (account: PublishingAccount): void => {
    setInput({ accountId: account.id, platform: account.platform, accountName: account.accountName, positioning: account.positioning, phone: '', email: '', clearContact: false })
    setEditing(true); setMessage('')
  }
  const save = async (): Promise<void> => {
    if (!window.creatorOS || busy) return
    setBusy(true); setMessage('')
    try {
      await window.creatorOS.savePublishingAccount({
        accountId: input.accountId,
        platform: input.platform,
        accountName: input.accountName,
        positioning: input.positioning,
        clearContact: input.clearContact,
        ...(input.phone.trim() ? { phone: input.phone.trim() } : {}),
        ...(input.email.trim() ? { email: input.email.trim() } : {})
      })
      setInput(emptyInput); setEditing(false); await load()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '发布账号保存失败') }
    finally { setBusy(false) }
  }
  return <section className="settings-group card publishing-account-settings">
    <header className="settings-group-head"><div><b>平台账号</b><span>按平台保存自定义账号名和内容定位；手机号与邮箱只显示脱敏结果</span></div><button onClick={() => { setInput(emptyInput); setEditing(true); setMessage('') }}><Plus size={13} />添加账号</button></header>
    <div className="publishing-account-list">{state?.accounts.length ? state.accounts.map((account) => <article key={account.id} className={account.status === 'disabled' ? 'disabled' : ''}><div><b>{account.accountName}</b><small>{account.platform}{account.positioning ? ` · ${account.positioning}` : ''}</small><small>{[account.maskedPhone, account.maskedEmail].filter(Boolean).join(' · ') || '未保存联系方式'}</small></div><em>{account.status === 'active' ? '使用中' : '已停用'}</em><button onClick={() => edit(account)}>编辑</button><button disabled={busy} onClick={() => { setBusy(true); void window.creatorOS?.setPublishingAccountStatus(account.id, account.status === 'active' ? 'disabled' : 'active').then(load).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : '账号状态修改失败')).finally(() => setBusy(false)) }}>{account.status === 'active' ? '停用' : '启用'}</button></article>) : <p className="provider-config-empty">还没有平台账号。发布前会要求先选择一个账号。</p>}</div>
    {editing ? <div className="publishing-account-form"><label><span>平台</span><AppSelect value={input.platform} disabled={Boolean(input.accountId)} onChange={(event) => { const nextValue = event.currentTarget.value; setInput((value) => ({ ...value, platform: nextValue })) }}>{PROJECT_PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}</AppSelect></label><label><span>账号名</span><input value={input.accountName} maxLength={80} placeholder="填写你自己的平台账号名" onChange={(event) => { const nextValue = event.currentTarget.value; setInput((value) => ({ ...value, accountName: nextValue })) }} /></label><label><span>内容定位</span><input value={input.positioning} maxLength={500} placeholder="例如：AI教程、数码长视频" onChange={(event) => { const nextValue = event.currentTarget.value; setInput((value) => ({ ...value, positioning: nextValue })) }} /></label><label><span>手机号</span><input value={input.phone} maxLength={40} placeholder={input.accountId ? '留空保留原号码' : '可选'} disabled={state?.secureStorageAvailable === false || input.clearContact} onChange={(event) => { const nextValue = event.currentTarget.value; setInput((value) => ({ ...value, phone: nextValue })) }} /></label><label><span>邮箱</span><input type="email" value={input.email} maxLength={200} placeholder={input.accountId ? '留空保留原邮箱' : '可选'} disabled={state?.secureStorageAvailable === false || input.clearContact} onChange={(event) => { const nextValue = event.currentTarget.value; setInput((value) => ({ ...value, email: nextValue })) }} /></label><footer><span>{state?.secureStorageAvailable === false ? '系统安全存储不可用，仍可保存不含联系方式的账号。' : '敏感联系方式使用macOS安全存储加密。'}</span>{input.accountId ? <button aria-pressed={input.clearContact} onClick={() => setInput((value) => ({ ...value, clearContact: !value.clearContact, phone: '', email: '' }))}>{input.clearContact ? '保留原联系方式' : '清除联系方式'}</button> : null}<button onClick={() => setEditing(false)}>取消</button><button className="primary-action" disabled={busy || !input.accountName.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存账号'}</button></footer></div> : null}
    {message ? <p className="form-error" role="alert">{message}</p> : null}
  </section>
}

function AppearanceSettings({
  appearance,
  onToggleTheme,
  onSetVisualStyle
}: {
  appearance: AppearanceSnapshot
  onToggleTheme(): void
  onSetVisualStyle(visualStyle: VisualStyle): void
}): React.JSX.Element {
  const styles: { id: VisualStyle; title: string; description: string }[] = [
    { id: 'warm', title: '暖灰绿创作工作台', description: '温和、低刺激，适合长时间写作' },
    { id: 'feishu', title: '飞书式专业工作台', description: '清晰、理性，适合项目和报表管理' }
  ]
  return <section className="settings-group card appearance-settings" aria-label="外观">
    <header className="settings-group-head"><div><Settings2 size={17} /><div><b>外观</b><span>界面风格与明暗模式独立保存，切换不会改变排版和内容</span></div></div></header>
    <div className="appearance-setting-row">
      <div><b>界面风格</b><span>两套风格共用同一套页面、字体和组件尺寸</span></div>
      <div className="appearance-style-options" role="radiogroup" aria-label="界面风格">
        {styles.map((style) => <button
          type="button"
          role="radio"
          aria-checked={appearance.visualStyle === style.id}
          className={appearance.visualStyle === style.id ? 'active' : ''}
          key={style.id}
          onClick={() => onSetVisualStyle(style.id)}
        >
          <span className={`appearance-swatch ${style.id}`} aria-hidden="true"><i /><i /><i /></span>
          <span><b>{style.title}</b><small>{style.description}</small></span>
          <CheckCircle2 size={16} />
        </button>)}
      </div>
    </div>
    <div className="appearance-setting-row compact">
      <div><b>明暗模式</b><span>顶栏太阳／月亮按钮也只切换这一项</span></div>
      <div className="appearance-scheme-options" role="group" aria-label="明暗模式">
        <button type="button" className={appearance.theme === 'light' ? 'active' : ''} aria-pressed={appearance.theme === 'light'} onClick={() => { if (appearance.theme !== 'light') onToggleTheme() }}>浅色</button>
        <button type="button" className={appearance.theme === 'dark' ? 'active' : ''} aria-pressed={appearance.theme === 'dark'} onClick={() => { if (appearance.theme !== 'dark') onToggleTheme() }}>深色</button>
      </div>
    </div>
  </section>
}

function BusinessLedgerPrivacySettings(): React.JSX.Element {
  const [status, setStatus] = useState<BusinessLedgerLockStatus | null>(null)
  const [mode, setMode] = useState<'enable' | 'disable' | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void window.creatorOS?.getBusinessLedgerLockStatus()
      .then((value) => { if (active) setStatus(value) })
      .catch((reason: unknown) => { if (active) setMessage(reason instanceof Error ? reason.message : '无法读取隐私锁状态') })
    return () => { active = false }
  }, [])
  const close = (): void => { if (!busy) { setMode(null); setPassword(''); setConfirmation(''); setMessage('') } }
  const submit = async (): Promise<void> => {
    if (!window.creatorOS || !mode || busy) return
    if (mode === 'enable' && password !== confirmation) { setMessage('两次输入的密码不一致'); return }
    setBusy(true); setMessage('')
    try {
      const next = mode === 'enable'
        ? await window.creatorOS.enableBusinessLedgerLock(password)
        : await window.creatorOS.disableBusinessLedgerLock(password)
      setStatus(next)
      setMode(null); setPassword(''); setConfirmation('')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '隐私锁设置失败') }
    finally { setBusy(false) }
  }
  return <section className="settings-group card business-ledger-privacy-settings">
    <header className="settings-group-head"><div><LockKeyhole size={17} /><div><b>收入台账隐私锁</b><span>打开收入台账前验证密码，支持的Mac也可使用Touch ID</span></div></div><button
      type="button"
      className={status?.enabled ? 'enabled' : ''}
      disabled={!status || (!status.securityAvailable && !status.enabled)}
      onClick={() => { setMode(status?.enabled ? 'disable' : 'enable'); setMessage('') }}
    >{status?.enabled ? '已开启' : status?.securityAvailable === false ? '系统安全存储不可用' : '已关闭'}</button></header>
    <p>{status?.enabled
      ? `密码校验值由macOS安全存储保护${status.touchIdAvailable ? '；当前Mac可使用Touch ID解锁' : '；仍可使用密码解锁'}。`
      : '开启后，收入台账的数据页会先显示锁定界面；密码不会写入工作区数据库。'}</p>
    {mode ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <form className="business-ledger-lock-dialog" role="dialog" aria-modal="true" aria-label={mode === 'enable' ? '开启收入台账隐私锁' : '关闭收入台账隐私锁'} onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <header><div>{mode === 'enable' ? <Fingerprint size={17} /> : <KeyRound size={17} />}<span><b>{mode === 'enable' ? '开启隐私锁' : '关闭隐私锁'}</b><small>{mode === 'enable' ? '以后可用密码或Touch ID解锁' : '需要先验证当前密码'}</small></span></div><button type="button" aria-label="关闭" onClick={close}><X size={14} /></button></header>
        <label><span>{mode === 'enable' ? '设置密码' : '当前密码'}</span><input autoFocus type="password" value={password} minLength={4} maxLength={128} onChange={(event) => { setPassword(event.currentTarget.value); setMessage('') }} placeholder="至少4个字符" /></label>
        {mode === 'enable' ? <label><span>再次输入</span><input type="password" value={confirmation} minLength={4} maxLength={128} onChange={(event) => { setConfirmation(event.currentTarget.value); setMessage('') }} /></label> : null}
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        <footer><button type="button" onClick={close}>取消</button><button className="primary-action" disabled={busy || password.length < 4 || (mode === 'enable' && confirmation.length < 4)}>{busy ? '处理中…' : mode === 'enable' ? '开启' : '关闭隐私锁'}</button></footer>
      </form>
    </div> : null}
  </section>
}

function BusinessPlatformSettings(): React.JSX.Element {
  const platforms = useWorkspaceStore((state) => state.snapshot.preferences.businessPlatforms)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [newPlatform, setNewPlatform] = useState('')
  const save = (next: string[]): void => { void setPreferences({ businessPlatforms: [...new Set(next.map((item) => item.trim()).filter(Boolean))] }) }
  const rename = (index: number, value: string): void => {
    const next = [...platforms]
    next[index] = value
    save(next)
  }
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= platforms.length) return
    const next = [...platforms]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    save(next)
  }
  return <section className="settings-group card business-platform-settings">
    <header className="settings-group-head"><div><Settings2 size={17} /><div><b>商务接单平台</b><span>与内容发布平台分开；历史商单不会因停用平台而改变</span></div></div></header>
    <div>{platforms.map((platform, index) => <article key={`${platform}-${index}`}><input aria-label={`编辑接单平台${platform}`} defaultValue={platform} onBlur={(event) => rename(index, event.currentTarget.value)} /><button aria-label={`上移${platform}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button><button aria-label={`下移${platform}`} disabled={index === platforms.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button><button aria-label={`停用${platform}`} onClick={() => save(platforms.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></article>)}</div>
    <footer><input value={newPlatform} onChange={(event) => setNewPlatform(event.currentTarget.value)} placeholder="新增接单平台" /><button className="primary-action" disabled={!newPlatform.trim()} onClick={() => { save([...platforms, newPlatform]); setNewPlatform('') }}><Plus size={13} />添加</button></footer>
  </section>
}

const todoCategoryColorNames: Record<ProjectColorToken, string> = {
  'project-1': '鼠尾草绿',
  'project-2': '湖水蓝',
  'project-3': '薰衣草紫',
  'project-4': '暖橙',
  'project-5': '麦穗黄',
  'project-6': '薄荷绿',
  'project-7': '珊瑚红',
  'project-8': '靛青',
  'project-9': '玫瑰粉',
  'project-10': '青绿色',
  'project-11': '琥珀色',
  'project-12': '雾灰'
}

function TodoCategorySettings(): React.JSX.Element {
  const { preferences, todos, today } = useWorkspaceStore((state) => state.snapshot)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [labels, setLabels] = useState({ ...preferences.todoCategoryLabels })
  const [colors, setColors] = useState({ ...preferences.todoCategoryColors })
  const [weights, setWeights] = useState({ ...preferences.todoCategoryWeights })
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLabels({ ...preferences.todoCategoryLabels })
    setColors({ ...preferences.todoCategoryColors })
    setWeights({ ...preferences.todoCategoryWeights })
  }, [preferences.todoCategoryColors, preferences.todoCategoryLabels, preferences.todoCategoryWeights])

  const normalizedLabels = TODO_CATEGORY_ORDER.map((category) => labels[category].trim())
  const hasBlankLabel = normalizedLabels.some((label) => !label)
  const hasDuplicateLabel = new Set(normalizedLabels).size !== normalizedLabels.length
  const totalWeight = TODO_CATEGORY_ORDER.reduce((sum, category) => sum + weights[category], 0)
  const canSave = !saving && !hasBlankLabel && !hasDuplicateLabel && totalWeight > 0
  const todayGrowth = useMemo(
    () => calculateDailyTodoGrowth(todos, today, weights),
    [today, todos, weights]
  )
  const todayWeightSummary = TODO_CATEGORY_ORDER
    .filter((category) => todayGrowth.effectiveCategoryWeights[category] > 0)
    .map((category) => `${labels[category].trim() || preferences.todoCategoryLabels[category]}${Math.round(todayGrowth.effectiveCategoryWeights[category] * 1_000) / 10}%`)
    .join(' · ')

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    setMessage('')
    try {
      await setPreferences({
        todoCategoryLabels: Object.fromEntries(TODO_CATEGORY_ORDER.map((category) => [category, labels[category].trim()])) as Record<TodoCategory, string>,
        todoCategoryColors: colors,
        todoCategoryWeights: weights
      })
      setMessage('待办分类已保存，首页、浮窗和成长植物已同步')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '待办分类保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reset = async (): Promise<void> => {
    setSaving(true)
    setMessage('')
    try {
      await setPreferences({
        todoCategoryLabels: { ...DEFAULT_TODO_CATEGORY_LABELS },
        todoCategoryColors: { ...DEFAULT_TODO_CATEGORY_COLORS },
        todoCategoryWeights: { ...DEFAULT_TODO_CATEGORY_WEIGHTS }
      })
      setMessage('已恢复默认分类')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '恢复默认分类失败')
    } finally {
      setSaving(false)
    }
  }

  return <section className="settings-group card todo-category-settings">
    <header className="settings-group-head"><div><Tags size={17} /><div><b>待办分类</b><span>权重是长期偏好，只在今天实际有任务的分类之间自动换算</span></div></div></header>
    <div className="todo-category-settings-grid">
      {TODO_CATEGORY_ORDER.map((category) => <article key={category}>
        <label className="todo-category-name-field"><span>分类名称</span><input aria-label={`${preferences.todoCategoryLabels[category]}分类名称`} value={labels[category]} maxLength={16} onChange={(event) => { const label = event.currentTarget.value; setLabels((current) => ({ ...current, [category]: label })); setMessage('') }} /></label>
        <label className="todo-category-color-field"><span>颜色</span><div><i style={{ background: `var(--${colors[category]})` }} /><AppSelect aria-label={`${labels[category] || '待办'}分类颜色`} value={colors[category]} onChange={(event) => { const color = event.currentTarget.value as ProjectColorToken; setColors((current) => ({ ...current, [category]: color })); setMessage('') }}>{PROJECT_COLOR_TOKENS.map((token) => <option key={token} value={token}>{todoCategoryColorNames[token]}</option>)}</AppSelect></div></label>
        <label className="todo-category-weight-field"><span>相对权重</span><div><input aria-label={`${labels[category] || '待办'}相对权重`} type="number" min={0} max={100} step={5} value={weights[category]} onChange={(event) => { const value = Math.max(0, Math.min(100, Math.round(Number(event.currentTarget.value) || 0))); setWeights((current) => ({ ...current, [category]: value })); setMessage('') }} /><em>份</em></div></label>
      </article>)}
    </div>
    <footer className="todo-category-settings-footer">
      <span>{hasBlankLabel
        ? '分类名称不能为空'
        : hasDuplicateLabel
          ? '分类名称不能重复'
          : totalWeight === 0
            ? '至少一个分类需要有权重'
            : todayGrowth.todoCount === 0
              ? `相对权重合计${totalWeight}份；今天没有待办，植物保持0%`
              : todayWeightSummary
                ? `今天实际占比：${todayWeightSummary}；没有任务的分类不占比例`
                : '今天已有待办，但对应分类的相对权重均为0'}</span>
      <button type="button" disabled={saving} onClick={() => void reset()}>恢复默认</button>
      <button type="button" className="primary-action" disabled={!canSave} onClick={() => void save()}>{saving ? '保存中…' : '保存分类'}</button>
    </footer>
    {message ? <p>{message}</p> : null}
  </section>
}

function WeatherSceneSettings(): React.JSX.Element {
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const savedCity = preferences.weatherCity
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [cityAnchor, setCityAnchor] = useState<HTMLElement | null>(null)
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const cityOptions = useMemo(() => (
    savedCity && !WEATHER_CITY_OPTIONS.includes(savedCity as (typeof WEATHER_CITY_OPTIONS)[number])
      ? [savedCity, ...WEATHER_CITY_OPTIONS]
      : [...WEATHER_CITY_OPTIONS]
  ), [savedCity])
  const conditionLabels: Record<WeatherCondition, string> = {
    clear: '晴天',
    cloudy: '多云',
    rain: '下雨',
    snow: '下雪'
  }
  const chooseCity = async (next: string): Promise<void> => {
    await setPreferences({ weatherCity: next })
    setMessage(next ? `已选择${next}，返回首页会自动更新` : '请选择天气城市')
    setCityAnchor(null)
  }
  const refresh = async (): Promise<void> => {
    if (!savedCity || refreshing) return
    setRefreshing(true)
    setMessage('正在更新天气…')
    try {
      const snapshot = await window.creatorOS?.getWeather(true)
      setMessage(snapshot
        ? `已更新：${snapshot.city ?? savedCity}·${conditionLabels[snapshot.condition]}`
        : '天气更新失败，请稍后重试')
    } catch {
      setMessage('天气更新失败，已保留上一次结果')
    } finally {
      setRefreshing(false)
    }
  }
  return <section className="settings-group card weather-scene-settings">
    <header className="settings-group-head"><div><CloudSun size={17} /><div><b>首页窗外天气</b><span>城市只保存在本机；天气获取失败会保留上一次结果</span></div></div></header>
    <div className="weather-city-control">
      <button
        type="button"
        className="weather-city-picker-trigger"
        aria-label="首页天气城市"
        aria-haspopup="menu"
        aria-expanded={Boolean(cityAnchor)}
        onClick={(event) => {
          const anchor = event.currentTarget
          setCityAnchor((current) => current ? null : anchor)
        }}
      >
        <span>{savedCity || '选择城市'}</span>
        <ChevronDown size={13} />
      </button>
      <button className="weather-refresh-button" type="button" disabled={!savedCity || refreshing} onClick={() => void refresh()}>{refreshing ? '更新中…' : '立即更新天气'}</button>
    </div>
    {cityAnchor ? <AnchoredPopover
      anchor={cityAnchor}
      ariaLabel="选择天气城市"
      className="weather-city-picker-menu"
      role="menu"
      onDismiss={() => setCityAnchor(null)}
    >
      <div className="weather-city-picker-scroll">
        {cityOptions.map((city) => <button
          type="button"
          role="menuitemradio"
          aria-checked={city === savedCity}
          className={city === savedCity ? 'selected' : ''}
          key={city}
          onClick={() => void chooseCity(city)}
        >
          <span>{city}</span>
          {city === savedCity ? <Check size={12} /> : null}
        </button>)}
      </div>
    </AnchoredPopover> : null}
    <div className="weather-preview-controls">
      <div><span>天气预览</span><div className="np-chips">
        {([['', '跟随天气'], ['clear', '晴天'], ['cloudy', '多云'], ['rain', '下雨'], ['snow', '下雪']] as const).map(([value, label]) => <button type="button" className={`np-chip${(preferences.weatherPreviewCondition ?? '') === value ? ' on' : ''}`} aria-pressed={(preferences.weatherPreviewCondition ?? '') === value} key={value || 'live'} onClick={() => void setPreferences({ weatherPreviewCondition: value || null })}>{label}</button>)}
      </div></div>
      <div><span>时间预览</span><div className="np-chips">
        {([['', '跟随时间'], ['sunrise', '日出'], ['day', '白天'], ['sunset', '夕阳'], ['night', '夜晚']] as const).map(([value, label]) => <button type="button" className={`np-chip${(preferences.weatherPreviewPeriod ?? '') === value ? ' on' : ''}`} aria-pressed={(preferences.weatherPreviewPeriod ?? '') === value} key={value || 'live'} onClick={() => void setPreferences({ weatherPreviewPeriod: value || null })}>{label}</button>)}
      </div></div>

    </div>
    {message ? <p>{message}</p> : null}
  </section>
}

type SettingsSectionKey = 'templates' | 'general' | 'workspace' | 'home' | 'ai-publishing' | 'data-device'

const SETTINGS_SECTIONS = [
  { key: 'general', label: '通用', description: '外观与App信息', icon: Settings2 },
  { key: 'workspace', label: '工作区', description: '侧栏与新建项目', icon: LayoutGrid },
  { key: 'templates', label: '项目模板', description: '阶段与适用分类', icon: LayoutGrid },
  { key: 'home', label: '首页与待办', description: '分类、权重与天气', icon: Tags },
  { key: 'ai-publishing', label: 'AI与发布', description: '模型、账号与平台', icon: KeyRound },
  { key: 'data-device', label: '数据与设备', description: '备份、安全与同步', icon: HardDrive }
] as const satisfies ReadonlyArray<{ key: SettingsSectionKey; label: string; description: string; icon: typeof Settings2 }>

export function SettingsPage({ appearance, onToggleTheme, onSetVisualStyle, section }: { section?: 'templates'; appearance: AppearanceSnapshot; onToggleTheme(): void; onSetVisualStyle(visualStyle: VisualStyle): void }): React.JSX.Element {
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const contentTypes = useWorkspaceStore((state) => state.snapshot.contentTypes).filter((type) => type.isActive)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(section ?? 'general')
  useEffect(() => { if (section) setActiveSection(section) }, [section])
  const [sectionMenuAnchor, setSectionMenuAnchor] = useState<HTMLButtonElement | null>(null)
  const [mobileSync, setMobileSync] = useState<MobileSyncStatus | null>(null)
  const [mobileBusy, setMobileBusy] = useState(false)
  const [mobileMessage, setMobileMessage] = useState('')
  const [backupMessage, setBackupMessage] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    if (activeSection !== 'data-device') return
    let active = true
    const refresh = (): void => { void window.creatorOS?.getMobileSyncStatus().then((status) => { if (active) setMobileSync(status) }).catch((error: unknown) => { if (active) setMobileMessage(error instanceof Error ? error.message : '无法读取局域网接收状态') }) }
    refresh()
    const timer = window.setInterval(refresh, 3_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [activeSection])
  useEffect(() => { void window.creatorOS?.getAppInfo().then(setAppInfo).catch(() => setAppInfo(null)) }, [])
  const runMobileAction = async (action: () => Promise<MobileSyncStatus>): Promise<void> => {
    if (mobileBusy) return
    setMobileBusy(true); setMobileMessage('')
    try { setMobileSync(await action()) } catch (error) { setMobileMessage(error instanceof Error ? error.message : '操作失败') }
    finally { setMobileBusy(false) }
  }
  const showSection = (section: SettingsSectionKey): void => {
    setActiveSection(section)
    setSectionMenuAnchor(null)
    window.requestAnimationFrame(() => document.querySelector('.settings-section-content')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const activeSectionDefinition = SETTINGS_SECTIONS.find((section) => section.key === activeSection) ?? SETTINGS_SECTIONS[0]
  const ActiveSectionIcon = activeSectionDefinition.icon
  return <main className="page settings-page"><header className="page-header settings-page-header"><div><h1>设置</h1></div><button
    type="button"
    className="settings-section-trigger"
    aria-label={`当前设置分类：${activeSectionDefinition.label}`}
    aria-haspopup="menu"
    aria-expanded={Boolean(sectionMenuAnchor)}
    onClick={(event) => {
      const anchor = event.currentTarget
      setSectionMenuAnchor((current) => current ? null : anchor)
    }}
  ><ActiveSectionIcon size={15} /><span><b>{activeSectionDefinition.label}</b><small>{activeSectionDefinition.description}</small></span><ChevronDown size={13} /></button></header>
    {sectionMenuAnchor ? <AnchoredPopover
      anchor={sectionMenuAnchor}
      ariaLabel="切换设置分类"
      className="settings-section-menu"
      role="menu"
      onDismiss={() => setSectionMenuAnchor(null)}
    >{SETTINGS_SECTIONS.map(({ key, label, description, icon: Icon }) => <button
      type="button"
      role="menuitemradio"
      aria-label={label}
      aria-checked={activeSection === key}
      className={activeSection === key ? 'selected' : ''}
      key={key}
      onClick={() => showSection(key)}
    ><Icon size={15} /><span><b>{label}</b><small>{description}</small></span>{activeSection === key ? <Check size={13} /> : null}</button>)}</AnchoredPopover> : null}
    <div className="settings-section-content" aria-label={`${SETTINGS_SECTIONS.find((section) => section.key === activeSection)?.label ?? '设置'}二级设置`}>
      {activeSection === 'general' ? <>
        <AppearanceSettings appearance={appearance} onToggleTheme={onToggleTheme} onSetVisualStyle={onSetVisualStyle} />
        <section className="settings-list card"><article><span className="square-mark">版</span><div><b>当前App版本</b><span>{appInfo ? `${appInfo.version}·构建${appInfo.buildId}` : '正在读取构建信息…'}</span></div><span className={`app-install-state${appInfo?.isInstalledBuild ? ' current' : ''}`}>{appInfo?.isInstalledBuild ? 'Applications安装版' : '临时运行版'}</span></article></section>
      </> : null}
      {activeSection === 'workspace' ? <>
        <WorkspaceManagementSettings />
        <section className="settings-group card">
          <header className="settings-group-head"><b>新建项目默认</b><span>新建项目时的初始平台、方向和归类方式</span></header>
          <div className="settings-field"><p>默认发布平台</p><ProjectPlatformControl compact platforms={preferences.defaultPlatforms} onChange={(defaultPlatforms) => void setPreferences({ defaultPlatforms })} /></div>
          <div className="settings-field"><p>默认内容方向</p><div className="np-chips"><button type="button" className={`np-chip${preferences.defaultContentTypeId === null ? ' on' : ''}`} aria-pressed={preferences.defaultContentTypeId === null} onClick={() => void setPreferences({ defaultContentTypeId: null })}>交给AI归类</button>{contentTypes.map((type) => <button type="button" key={type.id} className={`np-chip${preferences.defaultContentTypeId === type.id ? ' on' : ''}`} aria-pressed={preferences.defaultContentTypeId === type.id} onClick={() => void setPreferences({ defaultContentTypeId: type.id })}><ContentTypeLabel id={type.id} name={type.name} /></button>)}</div></div>
          <div className="settings-field"><p>创建后自动归类</p><div className="np-chips"><button type="button" className={`np-chip${preferences.autoClassifyNewProject ? ' on' : ''}`} aria-pressed={preferences.autoClassifyNewProject} onClick={() => void setPreferences({ autoClassifyNewProject: true })}>打完标题自动归类</button><button type="button" className={`np-chip${!preferences.autoClassifyNewProject ? ' on' : ''}`} aria-pressed={!preferences.autoClassifyNewProject} onClick={() => void setPreferences({ autoClassifyNewProject: false })}>仅手动点图标</button></div></div>
        </section>
        <section className="settings-list card"><article><span className="square-mark">栏</span><div><b>首页分栏</b><span>当前比例：{Math.round(preferences.homeSplit)}%</span></div><button onClick={() => showStagePreview('双击首页分隔条即可恢复默认比例')}>查看说明</button></article></section>
      </> : null}
      {activeSection === 'templates' ? <ProjectTemplateSettings /> : null}
      {activeSection === 'home' ? <><TodoCategorySettings /><WeatherSceneSettings /></> : null}
      {activeSection === 'ai-publishing' ? <>
        <ProviderSettingsSection />
        <PublishingAccountsSettingsSection />
        <BusinessPlatformSettings />
        <section className="settings-group card computer-use-pilot-settings">
          <header className="settings-group-head"><div><ShieldCheck size={17} /><div><b>B站Computer Use试验</b><span>只辅助上传与填写，最终发布仍由你在B站网页内亲自确认</span></div></div><button
            type="button"
            className={preferences.computerUsePublishBilibili ? 'enabled' : ''}
            aria-pressed={preferences.computerUsePublishBilibili}
            onClick={() => void setPreferences({ computerUsePublishBilibili: !preferences.computerUsePublishBilibili })}
          >{preferences.computerUsePublishBilibili ? '试验已开启' : '已关闭（推荐）'}</button></header>
          <p>当前只开放B站低频试验；小红书继续使用复制文案＋手动发布。启动时会把标题、简介和本机文件路径复制到系统剪贴板，标记完成或取消后会在内容未被替换时自动清除；任何失败都可直接回到人工发布交接。</p>
        </section>
      </> : null}
      {activeSection === 'data-device' ? <>
        <section className="settings-list card"><article><span className="square-mark">库</span><div><b>本地数据库与备份</b><span>{backupMessage || '启动时自动备份；自动备份保留30个日点与12个月点'}</span></div><span className="settings-inline-actions"><button onClick={() => { setBackupMessage('备份中…'); void window.creatorOS?.createManualBackup().then((result) => setBackupMessage(`已备份·${new Date(result.createdAt).toLocaleString('zh-CN')}`)).catch((reason: unknown) => setBackupMessage(reason instanceof Error ? reason.message : '备份失败')) }}>立即备份</button><button onClick={() => { void window.creatorOS?.chooseWorkspaceBackupToRestore().then((result) => { if (!result.scheduled) setBackupMessage('已取消恢复') }).catch((reason: unknown) => setBackupMessage(reason instanceof Error ? reason.message : '无法恢复备份')) }}>恢复备份</button></span></article></section>
        <BusinessLedgerPrivacySettings />
        <NasArchiveSettingsSection />
        <section className="settings-group card mobile-sync-settings">
          <header className="settings-group-head mobile-sync-head"><div><Smartphone size={17} /><div><b>Android快速记录</b><span>手机离线保存后，在同一可信Wi-Fi内加密发送到灵感库</span></div></div>{mobileSync?.running ? <span className="status-pill running"><Wifi size={12} />正在接收</span> : <span className="status-pill">已关闭</span>}</header>
          {!mobileSync ? <p className="mobile-sync-loading">正在读取本机状态…</p> : !mobileSync.running ? <div className="mobile-sync-off"><p>{mobileSync.securityAvailable ? '开启后，Android会在同一Wi-Fi中自动发现这台Mac，不用填写地址或同步码。' : '系统安全存储当前不可用，不能以明文保存手机密钥，因此无法开启。'}</p><button className="primary-action" disabled={mobileBusy || !mobileSync.securityAvailable} onClick={() => void runMobileAction(() => window.creatorOS!.setMobileSyncEnabled(true))}>开启局域网接收</button></div> : <>
            <div className="mobile-sync-service"><div><ShieldCheck size={16} /><span><b>{mobileSync.serviceName}</b><small>{mobileSync.advertised ? 'Bonjour已广播 · 安全协议v2' : '正在准备自动发现…'}</small></span></div><details><summary>技术信息</summary><p>{mobileSync.addresses.length ? mobileSync.addresses.join('、') : '暂无局域网IPv4地址'}{mobileSync.port ? ` · 端口${mobileSync.port}` : ''}</p></details></div>
            {mobileSync.pendingPairings.length ? <div className="mobile-sync-pending"><header><b>待批准设备</b><span>请确认手机显示相同数字</span></header>{mobileSync.pendingPairings.map((pairing) => <article className="mobile-device-approval" key={pairing.sessionId}><div className="mobile-device-approval-copy"><Smartphone size={17} /><span><b>{pairing.upgradeDeviceId ? '安全升级' : '新设备'}：{pairing.deviceName}</b><small>两边数字一致才批准</small></span></div><strong aria-label={`核对数字${pairing.shortAuthenticationString}`}>{pairing.shortAuthenticationString.slice(0, 3)} {pairing.shortAuthenticationString.slice(3)}</strong><div className="mobile-device-approval-actions"><button disabled={mobileBusy} onClick={() => void runMobileAction(() => window.creatorOS!.rejectMobileSyncPairing(pairing.sessionId))}><X size={13} />拒绝</button><button className="primary-action" disabled={mobileBusy} onClick={() => void runMobileAction(() => window.creatorOS!.approveMobileSyncPairing(pairing.sessionId))}><CheckCircle2 size={13} />数字一致，信任设备</button></div></article>)}</div> : null}
            <div className="mobile-sync-devices"><header><b>已信任设备</b><span>{mobileSync.devices.length}台</span></header>{mobileSync.devices.length ? mobileSync.devices.map((device) => <article key={device.id}><div><Smartphone size={15} /><span><b>{device.name}</b><small>{device.lastSeenAt ? `最近接收：${new Date(device.lastSeenAt).toLocaleString('zh-CN')}` : '尚未收到记录'}</small></span></div><div className="mobile-sync-device-actions">{device.trustState === 'trusted_v2' ? <em className="mobile-sync-trust safe"><ShieldCheck size={12} />安全连接·v2</em> : <em className="mobile-sync-trust legacy" title="请在Android发起安全升级"><AlertTriangle size={12} />旧版连接</em>}<button aria-label={`撤销设备${device.name}`} disabled={mobileBusy} onClick={() => void runMobileAction(() => window.creatorOS!.revokeMobileSyncDevice(device.id))}><Unplug size={14} />撤销</button></div>{device.trustState === 'trusted_v2' ? <WorkspaceDeviceAccess deviceId={device.id} deviceName={device.name} disabled={mobileBusy} /> : null}</article>) : <p>暂无已信任设备</p>}</div>
            <footer className="mobile-sync-footer"><span>首次信任后会自动同步；换Wi-Fi不需重新批准。记录内容使用AES-256-GCM加密。</span><button disabled={mobileBusy} onClick={() => void runMobileAction(() => window.creatorOS!.setMobileSyncEnabled(false))}>停止接收</button></footer>
          </>}
          {mobileSync?.error || mobileMessage ? <p className="form-error" role="alert">{mobileMessage || mobileSync?.error}</p> : null}
        </section>
      </> : null}
    </div>
  </main>
}
