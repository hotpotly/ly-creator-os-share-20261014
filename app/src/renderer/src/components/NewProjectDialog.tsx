import { templateMatchesClassification } from '../../../shared/project-template-rules'
import { ClassificationFields } from './ClassificationFields'
import type { VideoFormat } from '../../../shared/content-classification'
import { ContentTypeLabel } from './ContentTypeLabel'
import { Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_PLATFORMS, type ContentTypeDefinition } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { ProjectPlatformControl } from './ProjectPlatformControl'

interface Props { open: boolean; onClose(): void }

export function NewProjectDialog({ open, onClose }: Props): React.JSX.Element | null {
  const allContentTypes = useWorkspaceStore((state) => state.snapshot.contentTypes)
  const projectTemplates = useWorkspaceStore((state) => state.snapshot.projectTemplates)
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const contentTypes = useMemo(() => allContentTypes.filter((type) => type.isActive), [allContentTypes])
  const activeTemplates = useMemo(() => projectTemplates.filter((template) => template.isActive), [projectTemplates])
  const refresh = useWorkspaceStore((state) => state.refresh)
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contentTypeId, setContentTypeId] = useState('')
  const [videoFormat, setVideoFormat] = useState<VideoFormat | null>(null)
  const [isCommercial, setIsCommercial] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [platforms, setPlatforms] = useState<string[]>([])
  const [classifying, setClassifying] = useState(false)
  const [classifyNote, setClassifyNote] = useState('')
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const defaultType = useMemo(() => contentTypes.find((type) => type.id === preferences.defaultContentTypeId) ?? contentTypes.find((type) => type.id === 'type-digital') ?? contentTypes[0], [contentTypes, preferences.defaultContentTypeId])

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setContentTypeId(defaultType?.id ?? ''); setVideoFormat(null); setIsCommercial(false)
    setTemplateId(activeTemplates.some(t => t.id === defaultType?.defaultProjectTemplateId) ? defaultType?.defaultProjectTemplateId ?? null : null)
    setPlatforms(preferences.defaultPlatforms.filter((platform) => PROJECT_PLATFORMS.includes(platform as typeof PROJECT_PLATFORMS[number])))
    setClassifying(false)
    setClassifyNote('')
    setAiSuggestion(null)
    setSaving(false)
    setError('')
    window.setTimeout(() => titleRef.current?.focus(), 0)
    // 只在对话框打开时初始化一次；若把 preferences/defaultType 列入依赖，后台 task 刷新导致 preferences 引用变化会重跑，
    // 把用户已展开或已改的分类重置回默认——实际使用中会突然塌回去。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const runClassify = useCallback(async (): Promise<void> => {
    if (!window.creatorOS || !title.trim()) return
    setClassifying(true)
    try {
      const result = await window.creatorOS.classifyProjectDraft(title.trim(), description.trim())
      setAiSuggestion(result.contentTypeId)
      if (result.contentTypeId && result.confidence >= 0.6) {
        setContentTypeId(result.contentTypeId); setTemplateId(activeTemplates.some(t => t.id === result.templateId) ? result.templateId : null)
        setClassifyNote(`AI 已归类·${result.reason}`)
      } else {
        setClassifyNote('AI没把握，请手动选择')
      }
    } catch { setClassifyNote('') } finally { setClassifying(false) }
  }, [description, title, activeTemplates])

  useEffect(() => {
    if (!open || !preferences.autoClassifyNewProject || !title.trim()) return
    const timer = window.setTimeout(() => void runClassify(), 700)
    return () => window.clearTimeout(timer)
  }, [open, preferences.autoClassifyNewProject, title, description, runClassify])

  if (!open) return null

  const typeName = contentTypes.find((type) => type.id === contentTypeId)?.name ?? '未定方向'
  const templateName = templateId === null ? '从空白开始' : activeTemplates.find((template) => template.id === templateId)?.name ?? '从空白开始'

  const create = async (): Promise<void> => {
    if (!title.trim() || !window.creatorOS) return
    setSaving(true); setError('')
    try {
      const project = await window.creatorOS.createProject({ title: title.trim(), description: description.trim(), contentTypeId, videoFormat, isCommercial, templateId, platformTargets: platforms, aiSuggestedContentTypeId: aiSuggestion })
      await refresh()
      onClose()
      navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '项目创建失败')
    } finally { setSaving(false) }
  }

  const selectContentType = (type: ContentTypeDefinition): void => { setContentTypeId(type.id); setTemplateId(activeTemplates.some(t => t.id === type.defaultProjectTemplateId) ? type.defaultProjectTemplateId : null) }

  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && event.metaKey) void create() }}>
      <header><div><span>内容项目</span><h2 id="new-project-title">新建项目</h2></div><button aria-label="关闭新建项目" onClick={onClose}><X size={18} /></button></header>
      <div className="dialog-body">
        <div className="np-title-row">
          <input ref={titleRef} aria-label="项目名称" value={title} maxLength={80} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="项目名称，例如：新款耳机一周体验" />
          <button type="button" className="np-ai" aria-label="AI 自动归类" title="让 AI 按标题重新归类" disabled={classifying || !title.trim()} onClick={() => void runClassify()}><Sparkles size={17} /></button>
        </div>
        <textarea className="np-desc" aria-label="项目描述" value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="这期内容是什么、核心角度是什么（选填）" />
        <div className="np-smart np-smart-expanded">
            <div className="np-smart-head"><span>{classifying ? 'AI归类中…' : classifyNote || `内容分类·${typeName} / ${templateName}`}</span></div>
            <div className="np-grp" role="group" aria-label="内容方向"><p>内容方向</p><div className="np-chips">{contentTypes.map((type) => <button type="button" key={type.id} className={`np-chip${contentTypeId === type.id ? ' on' : ''}`} aria-pressed={contentTypeId === type.id} onClick={() => selectContentType(type)}><ContentTypeLabel id={type.id} name={type.name} /></button>)}</div></div>
            <ClassificationFields videoFormat={videoFormat} isCommercial={isCommercial} disabled={saving} onChange={patch => { if (patch.videoFormat !== undefined) setVideoFormat(patch.videoFormat); if (patch.isCommercial !== undefined) setIsCommercial(patch.isCommercial) }} />
            <div className="np-grp" role="group" aria-label="项目模板"><p>项目模板</p><div className="np-chips">{activeTemplates.map((template) => <button type="button" key={template.id} className={`np-chip${templateId === template.id ? ' on' : ''}`} aria-pressed={templateId === template.id} onClick={() => setTemplateId(template.id)}>{template.name}{templateMatchesClassification(template, { contentTypeId, videoFormat, isCommercial }) ? <em>推荐</em> : null}</button>)}<button type="button" className={`np-chip${templateId === null ? ' on' : ''}`} aria-pressed={templateId === null} onClick={() => setTemplateId(null)}>从空白开始</button></div></div>
            <div className="np-grp"><p>发布平台</p><ProjectPlatformControl compact platforms={platforms} onChange={setPlatforms} /></div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer><span>⌘Enter 创建</span><button onClick={onClose}>取消</button><button className="primary-action" disabled={!title.trim() || saving} onClick={() => void create()}>{saving ? '正在创建…' : '创建项目'}</button></footer>
    </section>
  </div>
}
