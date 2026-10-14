import { templateMatchesClassification } from '../../../shared/project-template-rules'
import { SavedClassificationControl } from './ClassificationFields'
import { ContentTypeLabel } from './ContentTypeLabel'
import { projectOverviewFacts } from '../utils/project-overview-facts'
import { useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, Files, ListTodo, Pencil, Plus, Target, X } from 'lucide-react'
import { type OptionalProjectModuleKey, type ProjectDetail, type ProjectTemplateDiff } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { projectModuleLabels } from '../utils/project-labels'
import { ProjectColorPicker } from './ProjectColorPicker'
import { ProjectPlatformSummary } from './ProjectPlatformControl'
import { ProjectPlatformPopover } from './ProjectPlatformPopover'
import { ProjectTimeline } from './ProjectTimeline'
import { AnchoredPopover } from './AnchoredPopover'

type ConfigKind = 'direction' | 'template' | 'platforms' | 'color'

export function ProjectOverview({ project, description, setDescription, onSave, onChangeContentType, onChangePlatforms, onApplyTemplate, header }: {
  header: ReactNode
  project: ProjectDetail
  description: string
  setDescription(value: string): void
  onSave(): Promise<void>
  onChangeContentType(contentTypeId: string): Promise<void>
  onChangePlatforms(platformTargets: string[]): Promise<void>
  onApplyTemplate(templateId: string | null): Promise<void>
}): React.JSX.Element {
  const { contentTypes, projectTemplates, todos, today } = useWorkspaceStore(state => state.snapshot)
  const facts = projectOverviewFacts(project, todos, today)
  const [config, setConfig] = useState<{ kind: ConfigKind; anchor: HTMLElement } | null>(null)
  const [templateDiff, setTemplateDiff] = useState<ProjectTemplateDiff | null>(null)
  const [configError, setConfigError] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const descriptionTrigger = useRef<HTMLButtonElement>(null)
  const open = (kind: ConfigKind, anchor: HTMLElement): void => {
    setConfig(config?.kind === kind ? null : { kind, anchor }); setTemplateDiff(null); setConfigError('')
  }
  const run = async (action: () => Promise<void>, close = true): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setConfigError('')
    try { await action(); if (close) setConfig(null) }
    catch (reason) { setConfigError(reason instanceof Error ? reason.message : '保存失败，请重试') }
    finally { pending.current = false; setBusy(false) }
  }
  const previewTemplate = (templateId: string | null): Promise<void> => run(async () => {
    if (!window.creatorOS) throw new Error('App尚未准备好')
    setTemplateDiff(await window.creatorOS.previewProjectTemplate(project.id, templateId))
  }, false)
  const diffLabels = (keys: OptionalProjectModuleKey[]): string => keys.map(key => projectModuleLabels[key]).join('、') || '无'
  const finishDescription = (): void => {
    setEditing(false)
    window.requestAnimationFrame(() => descriptionTrigger.current?.focus())
  }
  const cancelDescription = (): void => { setDescription(project.description); setConfigError(''); finishDescription() }
  return <section className="project-overview-summary" id="project-overview" aria-label="项目概览">
    <div className="project-profile-surface">
      {header}
    <div className="project-overview-description">
      <span>项目描述</span>
      {editing ? <form onSubmit={event => { event.preventDefault(); void run(async () => { await onSave(); finishDescription() }) }}>
        <textarea autoFocus aria-label="项目描述" value={description} disabled={busy} onChange={event => setDescription(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelDescription() } }} placeholder="这期内容是什么、为什么做、核心角度是什么" />
        <footer><button type="button" disabled={busy} onClick={cancelDescription}>取消</button><button className="primary-action" disabled={busy || description === project.description} type="submit">{busy ? '正在保存…' : '保存新版本'}</button></footer>
        {configError ? <p role="alert">{configError}</p> : null}
      </form> : <button ref={descriptionTrigger} className="project-description-preview" aria-label="编辑项目描述" onClick={() => { setConfigError(''); setEditing(true) }}><span>{project.description || '添加这期内容的描述'}</span><Pencil size={13} /></button>}
    </div>
    <dl className="project-overview-fields">
      <div><dt>视频形式</dt><dd><SavedClassificationControl dimension="video" name={project.title} videoFormat={project.videoFormat} onSave={async patch => { if (!window.creatorOS) throw new Error('App尚未准备好'); return window.creatorOS.updateProjectClassification(project.id, patch) }} /></dd></div>
      <div><dt>项目类型</dt><dd><SavedClassificationControl dimension="kind" name={project.title} isCommercial={project.isCommercial} onSave={async patch => { if (!window.creatorOS) throw new Error('App尚未准备好'); return window.creatorOS.updateProjectClassification(project.id, patch) }} /></dd></div>
      <div><dt>内容方向</dt><dd><button aria-label="更改主要内容方向" aria-expanded={config?.kind === 'direction'} onClick={event => open('direction', event.currentTarget)}><ContentTypeLabel id={project.contentTypeId} name={project.contentTypeName} /><ChevronDown size={12} /></button></dd></div>
      <div><dt>项目模板</dt><dd><button aria-label="选择项目模板" aria-expanded={config?.kind === 'template'} onClick={event => open('template', event.currentTarget)}><span className="overview-config-value">{project.appliedTemplateName ?? '从空白开始'}</span><ChevronDown size={12} /></button></dd></div>
      <div className="project-overview-platforms"><dt>发布平台</dt><dd><button className="stage-platform-trigger" aria-label="修改发布平台" aria-expanded={config?.kind === 'platforms'} onClick={event => open('platforms', event.currentTarget)}><ProjectPlatformSummary platforms={project.platformTargets} variant="chips" /><Plus size={14} /></button></dd></div>
      <div><dt>项目色</dt><dd><button aria-label="更改项目色" aria-expanded={config?.kind === 'color'} onClick={event => open('color', event.currentTarget)}><i className="project-overview-color" style={{ background: `var(--${project.colorToken})` }} />更改<ChevronDown size={12} /></button></dd></div>
    </dl>
    </div>
    <header className="project-overview-heading"><h2>概览</h2><button className="overview-review-link" onClick={() => navigate({ page: 'reports', reportMode: 'project', reportKind: 'weekly', projectId: project.id, source: 'project' })}>查看项目复盘</button></header>
    <div className="project-overview-metrics" aria-label="项目关键信息">
      <article className="project-overview-metric"><span className="overview-metric-icon progress"><Target size={18} /></span><div><h3>项目阶段</h3><ProjectTimeline project={project} /></div></article>
      <article className="project-overview-metric date"><span className="overview-metric-icon date"><CalendarDays size={18} /></span><div><h3>开始日期</h3><strong>{facts.start?.replaceAll('-', '/') ?? '未记录'}</strong><p title="取最早实际阶段开始，包含保留历史；自然日跨度不代表实际工时">{facts.elapsedDays === null ? '' : facts.elapsedDays < 0 ? `距开始还有${-facts.elapsedDays}天` : `距今${facts.elapsedDays}天`}</p></div></article>
      <article className="project-overview-metric"><span className="overview-metric-icon todos"><ListTodo size={18} /></span><div><h3>关联待办</h3><strong>{facts.todoTotal ? `${facts.todoCompleted}/${facts.todoTotal}` : '暂无待办'}</strong><p>{facts.todoTotal ? '已完成 · 全部日期' : ''}</p></div></article>
      <button className="project-overview-metric version" onClick={() => navigate({ page: 'project', projectId: project.id, moduleKey: 'versions' })}><span className="overview-metric-icon versions"><Files size={18} /></span><div><h3>内容版本</h3><strong>{facts.versionCount}份</strong><p>{facts.latestVersion ? `最近保存 ${new Date(facts.latestVersion.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}` : ''}</p></div></button>
    </div>
    {config?.kind === 'platforms' ? <ProjectPlatformPopover anchor={config.anchor} platforms={project.platformTargets} onChange={onChangePlatforms} onClose={() => setConfig(null)} /> : null}
    {config?.kind === 'color' ? <AnchoredPopover anchor={config.anchor} ariaLabel="选择项目色" className="project-overview-popover" onDismiss={() => setConfig(null)}><header><b>项目色</b><button aria-label="关闭项目色选择" onClick={() => setConfig(null)}><X size={14} /></button></header><ProjectColorPicker projectId={project.id} value={project.colorToken} autoFocus onChanged={() => setConfig(null)} /></AnchoredPopover> : null}
    {config?.kind === 'direction' ? <AnchoredPopover anchor={config.anchor} ariaLabel="更改主要内容方向" className="project-overview-popover" onDismiss={() => setConfig(null)}><header><b>主要内容方向</b><button aria-label="关闭内容方向选择" onClick={() => setConfig(null)}><X size={14} /></button></header><div className="project-config-options">{contentTypes.filter(type => type.isActive || type.id === project.contentTypeId).map(type => <button className={type.id === project.contentTypeId ? 'selected' : ''} disabled={busy || !type.isActive} key={type.id} onClick={() => void run(() => onChangeContentType(type.id))}><ContentTypeLabel id={type.id} name={type.name} />{type.id === project.contentTypeId ? <small>当前</small> : null}</button>)}</div>{configError ? <p role="alert">{configError}</p> : null}</AnchoredPopover> : null}
    {config?.kind === 'template' ? <AnchoredPopover anchor={config.anchor} ariaLabel="选择项目模板" className="project-overview-popover template-picker-popover" onDismiss={() => setConfig(null)}><header><b>选择项目模板</b><button onClick={() => { setConfig(null); navigate({ page: 'settings', settingsSection: 'templates' }) }}>管理项目模板</button></header>{templateDiff ? <div className="template-diff"><h3>{templateDiff.templateName}</h3><dl><div><dt>将新增</dt><dd>{diffLabels(templateDiff.add)}</dd></div><div><dt>将恢复</dt><dd>{diffLabels(templateDiff.enable)}</dd></div><div><dt>继续保留</dt><dd>{diffLabels(templateDiff.preserve)}</dd></div><div><dt>不会自动隐藏</dt><dd>{diffLabels(templateDiff.suggestHide)}</dd></div>{templateDiff.blocked.length ? <div><dt>当前不可用</dt><dd>{diffLabels(templateDiff.blocked)}（仅商单）</dd></div> : null}</dl><div className="template-diff-actions"><button onClick={() => setTemplateDiff(null)}>返回</button><button className="primary-action" disabled={busy} onClick={() => void run(() => onApplyTemplate(templateDiff.templateId))}>确认应用</button></div></div> : <div className="project-config-options template-options"><button className={project.appliedTemplateId === null ? 'selected' : ''} disabled={busy} onClick={() => void previewTemplate(null)}><span>从空白开始</span><small>不移除已有内容</small></button>{projectTemplates.filter((template) => template.isActive).map((template) => <button className={template.id === project.appliedTemplateId ? 'selected' : ''} key={template.id} disabled={busy} onClick={() => void previewTemplate(template.id)}><span>{template.name}</span><small>{(templateMatchesClassification(template, project) ? '推荐 · ' : '') + template.moduleKeys.map((key) => projectModuleLabels[key]).join('、')}</small></button>)}</div>}{configError ? <p className="form-error" role="alert">{configError}</p> : null}</AnchoredPopover> : null}
  </section>
}
