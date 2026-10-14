import { ProjectStageWorkspace } from './ProjectStageWorkspace'
import { ProjectContentDialog } from './ProjectContentDialog'
import { AppSelect } from './AppSelect'
import { AlertTriangle, BookOpen, CalendarDays, Captions, Check, CheckCircle2, Download, ExternalLink, Eye, FileInput, FilePenLine, FileVideo, Globe2, GripVertical, Image as ImageIcon, Link2, Maximize2, Plus, RefreshCw, Save, Search, Sparkles, Square, Trash2, UploadCloud, WandSparkles, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import { PROJECT_FRAMEWORK_MATERIAL_ID_PREFIX, PROJECT_SCRATCH_NOTE_MATERIAL_ID_PREFIX, type DraftVersion, type ProjectAssetImportBatchResult, type ExternalFileRelation, type MaterialResearchSession, type OptionalProjectModuleKey, type ProjectDetail, type ProjectMaterialRole, type ProjectModule, type ProjectModuleKey, type ProjectProductionNotes, type ResourceRecord, type StagePlanEdit, type StageTimeKey, type StageTimePoint, type StageTimeRecord, type StageTimeUpdateResult, type TaskResourcePreparation } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'
import { navigate } from '../utils/router'
import { projectModuleLabels } from '../utils/project-labels'
import { ProjectContextMenu, type ProjectMenuTarget } from './ProjectContextMenu'
import { StageTimeEditor } from './ProjectTimeline'
import { BusinessModule } from './BusinessModule'
import { FileDropZone, ProjectAssetBatchResult, ProjectAssetItem } from './ProjectAssetInput'
import { PrimaryReferencePanel } from './PrimaryReferencePanel'
import { CaptureAttachmentList } from './CaptureAttachmentList'
import { PublishingPanel } from './PublishingPanel'
import { ProjectHeader } from './ProjectHeader'
import { ProjectOverview } from './ProjectOverview'
import { NasArchiveDialog } from './NasArchiveDialog'
import { AnchoredPopover } from './AnchoredPopover'
import { CalendarDatePicker } from './CalendarDatePicker'
import { ProductionMemoEditor } from './ProductionMemoEditor'
import { ReadableMarkdown } from './ReadableMarkdown'

const moduleLabels = projectModuleLabels
const optionalKeys: OptionalProjectModuleKey[] = ['materials', 'outline', 'script', 'shooting', 'editing', 'postproduction', 'publishing', 'business']
const MODULE_DRAG_MIME = 'application/x-ly-project-module'
const stageSegmentLabels: Record<StageTimePoint['segment'], string> = { morning: '上午', afternoon: '下午', evening: '晚上' }
const formatStagePoint = (point: StageTimePoint | null): string => point ? `${Number(point.localDate.slice(5, 7))}月${Number(point.localDate.slice(8, 10))}日${stageSegmentLabels[point.segment]}` : '—'
const shootingSegmentOrder: Record<StageTimePoint['segment'], number> = { morning: 0, afternoon: 1, evening: 2 }
const shootingDateLabel = (date: string | null, today: string): string => {
  if (!date) return '未安排日期'
  const calendar = new Date(`${date}T12:00:00`)
  return `${date === today ? '今天·' : ''}${calendar.getMonth() + 1}月${calendar.getDate()}日`
}

interface OutlineDocumentView { id: string; name: string; items: { id: string; text: string }[]; versionId: string | null }

function parseOutlineDocument(version?: DraftVersion): OutlineDocumentView {
  if (!version) return { id: crypto.randomUUID(), name: '大纲', items: [{ id: crypto.randomUUID(), text: '' }], versionId: null }
  try {
    const value = JSON.parse(version.content) as { id: string; text: string }[] | { outlineId: string; name: string; items: { id: string; text: string }[] }
    if (Array.isArray(value)) return { id: 'legacy-default', name: '大纲', items: value.length ? value : [{ id: crypto.randomUUID(), text: '' }], versionId: version.id }
    return { id: value.outlineId, name: value.name, items: value.items.length ? value.items : [{ id: crypto.randomUUID(), text: '' }], versionId: version.id }
  } catch { return { id: 'legacy-default', name: '大纲', items: [{ id: crypto.randomUUID(), text: version.content }], versionId: version.id } }
}

function parseOutline(version?: DraftVersion): { id: string; text: string }[] { return parseOutlineDocument(version).items }

function PdfMaterialPreview({ dataUrl, title }: { dataUrl: string; title: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('正在渲染PDF…')
  useEffect(() => {
    let canceled = false
    let loadingTask: { destroy(): Promise<void> } | null = null
    const render = async (): Promise<void> => {
      try {
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
        const binary = atob(encoded)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        const task = getDocument({ data: bytes, disableAutoFetch: true, disableStream: true, useSystemFonts: true, verbosity: 0 })
        loadingTask = task
        const document = await task.promise
        const page = await document.getPage(1)
        const viewport = page.getViewport({ scale: 1.35 })
        const canvas = canvasRef.current
        if (!canvas || canceled) return
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise
        if (!canceled) setStatus(`第1页／共${document.numPages}页`)
        page.cleanup()
      } catch {
        if (!canceled) setStatus('PDF预览失败，可关闭后使用系统默认应用打开')
      }
    }
    void render()
    return () => { canceled = true; void loadingTask?.destroy() }
  }, [dataUrl])
  return <div className="pdf-canvas-preview"><canvas ref={canvasRef} aria-label={`${title}第1页预览`} /><span role="status">{status}</span></div>
}

function listOutlineDocuments(versions: DraftVersion[]): OutlineDocumentView[] {
  const documents = new Map<string, OutlineDocumentView>()
  for (const version of versions.filter((item) => item.documentType === 'outline' && item.kind === 'user_edit')) {
    const document = parseOutlineDocument(version)
    if (!documents.has(document.id)) documents.set(document.id, document)
  }
  return [...documents.values()]
}

interface OutlineTemplateView { id: string; name: string; sourceName: string; items: string[] }

function parseOutlineTemplate(resource: ResourceRecord): OutlineTemplateView | null {
  if (resource.resourceType !== 'template' || resource.origin !== 'own' || resource.payload.kind !== 'outline_template') return null
  const items = Array.isArray(resource.payload.items) ? resource.payload.items.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
  if (items.length === 0) return null
  return { id: resource.id, name: resource.name, sourceName: typeof resource.payload.sourceName === 'string' ? resource.payload.sourceName : resource.name, items }
}

export function ProjectDetailPage({ projectId, moduleKey }: { projectId: string; moduleKey: ProjectModuleKey }): React.JSX.Element {
  const refresh = useWorkspaceStore((state) => state.refresh)
  const resources = useWorkspaceStore((state) => state.snapshot.resources)
  const preferences = useWorkspaceStore((state) => state.snapshot.preferences)
  const setPreferences = useWorkspaceStore((state) => state.setPreferences)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false)
  const [moduleOrder, setModuleOrder] = useState<OptionalProjectModuleKey[]>([])
  const [moduleOrderSaving, setModuleOrderSaving] = useState(false)
  const [draggedModuleKey, setDraggedModuleKey] = useState<OptionalProjectModuleKey | null>(null)
  const [dragOverModuleKey, setDragOverModuleKey] = useState<OptionalProjectModuleKey | null>(null)
  const [description, setDescription] = useState('')
  const [outlineItems, setOutlineItems] = useState<{ id: string; text: string }[]>([])
  const [outlineDocumentId, setOutlineDocumentId] = useState('')
  const [outlineDocumentName, setOutlineDocumentName] = useState('大纲')
  const [outlineParentVersionIds, setOutlineParentVersionIds] = useState<string[]>([])
  const [externalFileRelations, setExternalFileRelations] = useState<ExternalFileRelation[]>([])
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<ProjectMenuTarget | null>(null)
  const [nasArchiveOpen, setNasArchiveOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [stageToast, setStageToast] = useState<{ eventId: string; message: string } | null>(null)
  const [stageEditor, setStageEditor] = useState<{ anchor: HTMLElement; stageKey: StageTimeKey } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const outlineTemplateInputRef = useRef<HTMLInputElement>(null)
  const loadGenerationRef = useRef(0)
  const workspaceRefreshTimerRef = useRef<number | null>(null)

  const load = useCallback(async (options: { silent?: boolean; preserveEditors?: boolean } = {}): Promise<void> => {
    const generation = ++loadGenerationRef.current
    if (!options.silent) setLoading(true)
    setError('')
    try {
      if (!window.creatorOS) throw new Error('项目详情需要在App中打开')
      const [next, relations] = await Promise.all([
        window.creatorOS.getProject(projectId, !options.silent),
        window.creatorOS.listExternalFileRelations()
      ])
      if (generation !== loadGenerationRef.current) return
      setProject(next)
      if (!options.preserveEditors) setDescription(next.description)
      setExternalFileRelations(relations.filter((relation) => relation.projectId === projectId))
      if (!options.preserveEditors) {
        const outline = next.versions.find((version) => version.id === next.activeOutlineVersionId)
          ?? next.versions.find((version) => version.documentType === 'outline' && version.kind === 'user_edit')
        const document = parseOutlineDocument(outline)
        setOutlineItems(document.items)
        setOutlineDocumentId(document.id)
        setOutlineDocumentName(document.name)
        setOutlineParentVersionIds(outline ? [outline.id] : [])
      }
      if (!options.silent) await refresh()
    } catch (reason) { if (generation === loadGenerationRef.current) setError(reason instanceof Error ? reason.message : '项目加载失败') }
    finally { if (!options.silent && generation === loadGenerationRef.current) setLoading(false) }
  }, [projectId, refresh])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const unsubscribe = window.creatorOS?.onWorkspaceChanged(() => {
      if (workspaceRefreshTimerRef.current !== null) window.clearTimeout(workspaceRefreshTimerRef.current)
      workspaceRefreshTimerRef.current = window.setTimeout(() => { workspaceRefreshTimerRef.current = null; void load({ silent: true, preserveEditors: true }) }, 300)
    })
    return () => {
      unsubscribe?.()
      if (workspaceRefreshTimerRef.current !== null) window.clearTimeout(workspaceRefreshTimerRef.current)
      loadGenerationRef.current += 1
    }
  }, [load])
  useEffect(() => {
    if (!moduleMenuOpen) return
    const close = (event: MouseEvent): void => { if (!menuRef.current?.contains(event.target as Node)) setModuleMenuOpen(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setModuleMenuOpen(false) }
    document.addEventListener('mousedown', close); window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [moduleMenuOpen])
  useEffect(() => {
    if (!moduleMenuOpen || !project || moduleOrderSaving) return
    const available = optionalKeys.filter((key) => project.isCommercial || key !== 'business')
    const positions = new Map(project.modules.map((module) => [module.key, module.position]))
    const ordered = [...available].sort((left, right) => (positions.get(left) ?? optionalKeys.indexOf(left) + 100) - (positions.get(right) ?? optionalKeys.indexOf(right) + 100))
    setModuleOrder([...ordered.filter((key) => key !== 'business'), ...ordered.filter((key) => key === 'business')])
  }, [moduleMenuOpen, moduleOrderSaving, project])

  const enabledModules = useMemo(() => project?.modules.filter((module) => module.enabled && module.key !== 'feedback').sort((a, b) => a.position - b.position) ?? [], [project])
  const stageModules = useMemo(() => enabledModules.filter((module) => module.key !== 'overview'), [enabledModules])
  const activeModule = (moduleKey === 'production' && project?.modules.some(module => module.key === 'production')) || enabledModules.some((module) => module.key === moduleKey) ? moduleKey : 'overview'
  const activeStageModule = activeModule === 'overview' || !project?.stageTimeRecords.some((record) => record.stageKey === activeModule)
    ? null
    : stageModules.find((module) => module.key === activeModule) ?? null
  const stageEditorRecord = stageEditor ? project?.stageTimeRecords.find((record) => record.stageKey === stageEditor.stageKey) ?? null : null
  const outlineTemplates = useMemo(() => resources.map(parseOutlineTemplate).filter((template): template is OutlineTemplateView => template !== null), [resources])

  useEffect(() => {
    if (!project || preferences.lastProjectModuleById[project.id] === 'overview') return
    void setPreferences({
      lastProjectModuleById: { ...preferences.lastProjectModuleById, [project.id]: 'overview' }
    })
  }, [activeModule, preferences.lastProjectModuleById, project, setPreferences])

  const toggleModule = async (key: OptionalProjectModuleKey, enabled: boolean): Promise<void> => {
    if (!window.creatorOS || !project) return
    try {
      const next = await window.creatorOS.setProjectModule(project.id, key, enabled)
      setProject(next); await refresh()
      setNotice(enabled ? `已恢复“${moduleLabels[key]}”，原内容仍在` : `已移除“${moduleLabels[key]}”，内容仍保留`)
      if (!enabled && activeModule === key) navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '模块设置失败') }
  }
  const persistModuleOrder = async (nextOrder: OptionalProjectModuleKey[]): Promise<void> => {
    if (!window.creatorOS || !project || moduleOrderSaving) return
    const previous = moduleOrder
    setModuleOrder(nextOrder); setModuleOrderSaving(true)
    try {
      const next = await window.creatorOS.reorderProjectModules(project.id, nextOrder)
      setProject(next); await refresh(); setNotice('项目模块顺序已更新')
    } catch (reason) {
      setModuleOrder(previous); setNotice(reason instanceof Error ? reason.message : '项目模块排序失败')
    } finally { setModuleOrderSaving(false); setDraggedModuleKey(null); setDragOverModuleKey(null) }
  }
  const moveModule = (source: OptionalProjectModuleKey, target: OptionalProjectModuleKey): void => {
    if (source === target || moduleOrderSaving || source === 'business' || target === 'business') return
    const sourceIndex = moduleOrder.indexOf(source); const targetIndex = moduleOrder.indexOf(target)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...moduleOrder]; next.splice(sourceIndex, 1); next.splice(targetIndex, 0, source)
    void persistModuleOrder(next)
  }
  const moveModuleByKeyboard = (key: OptionalProjectModuleKey, direction: -1 | 1): void => {
    const index = moduleOrder.indexOf(key); const target = moduleOrder[index + direction]
    if (target) moveModule(key, target)
  }
  const toggleModuleCompleted = async (module: ProjectModule): Promise<void> => {
    if (!window.creatorOS || !project) return
    const next = !module.completedAt
    try {
      const result = await window.creatorOS.setModuleCompleted(project.id, module.key, next)
      setProject(result.project); await refresh()
      if (next) setStageToast({ eventId: result.eventId, message: `${moduleLabels[module.key]}完成于${formatStagePoint(result.record.completedAt)}` })
      else setStageToast({ eventId: result.eventId, message: `已重新打开${moduleLabels[module.key]}` })
      if (module.key === 'publishing' && next) setNotice('发布完成，项目已标记为已发布')
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '阶段状态保存失败') }
  }
  const updateStageTime = async (
    record: StageTimeRecord,
    patch: { startedAt?: StageTimePoint | null; completedAt?: StageTimePoint | null; actualEffortHalfDayUnits?: number | null; planEdit?: StagePlanEdit; source: 'manual' | 'backfill' },
    requestId: string
  ): Promise<StageTimeUpdateResult> => {
    if (!window.creatorOS || !project) throw new Error('App尚未准备好')
    try {
      const result = await window.creatorOS.updateStageTime(project.id, record.stageKey, patch, requestId)
      setProject(result.project); await refresh()
      if (result.changed) setStageToast({ eventId: result.eventId, message: `已更新${moduleLabels[record.stageKey]}阶段时间` })
      return result
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '阶段时间保存失败')
      throw reason
    }
  }
  const startStage = async (stageKey: StageTimeKey): Promise<void> => {
    if (!window.creatorOS || !project) throw new Error('App尚未准备好')
    const result = await window.creatorOS.updateStageTime(project.id, stageKey, { startNow: true, source: 'manual' })
    setProject(result.project); await refresh()
    if (result.changed) setStageToast({ eventId: result.eventId, message: `${moduleLabels[stageKey]}开始于${formatStagePoint(result.record.startedAt)}` })
    else setNotice('阶段状态已更新，已有开始时间保持不变')
  }
  const undoStageTime = async (): Promise<void> => {
    if (!window.creatorOS || !project || !stageToast) return
    try {
      const result = await window.creatorOS.undoStageTimeEvent(project.id, stageToast.eventId)
      setProject(result.project); await refresh(); setStageToast(null); setStageEditor(null); setNotice(`已撤销${moduleLabels[result.record.stageKey]}阶段修改`)
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '阶段修改撤销失败') }
  }

  const saveDescription = async (): Promise<void> => {
    if (!window.creatorOS || !project) throw new Error('项目尚未加载，请稍后重试')
    const next = await window.creatorOS.updateProjectDescription(project.id, description)
    setProject(next); setDescription(next.description); await refresh(); setNotice('项目描述已保存为新版本')
  }

  const saveRename = (title: string): void => {
    const current = project
    if (!current) return
    void (async () => {
      try { await window.creatorOS?.renameProject(current.id, title); await load({ silent: true, preserveEditors: true }); await refresh() }
      catch (reason) { setNotice(reason instanceof Error ? reason.message : '重命名失败') }
      finally { setEditingName(false) }
    })()
  }

  const changeContentType = async (contentTypeId: string): Promise<void> => {
    if (!window.creatorOS || !project) return
    try {
      const wasCommercial = project.isCommercial
      const next = await window.creatorOS.updateProjectContentType(project.id, contentTypeId)
      setProject(next); await refresh()
      setNotice(wasCommercial && !next.isCommercial ? `主要内容方向已改为“${next.contentTypeName}”；商单与反馈已隐藏但内容仍保留` : `主要内容方向已改为“${next.contentTypeName}”，现有模块和内容没有被替换`)
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '主要内容方向修改失败'); throw reason }
  }

  const changePlatforms = async (platformTargets: string[], reportError = false): Promise<void> => {
    if (!window.creatorOS || !project) { if (reportError) throw new Error('App尚未准备好'); return }
    try {
      const next = await window.creatorOS.updateProjectPlatforms(project.id, platformTargets)
      setProject(next)
      await refresh()
      setNotice(platformTargets.length ? `发布平台已更新为${platformTargets.join('、')}` : '已清空发布平台')
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '发布平台修改失败')
      if (reportError) throw reason
    }
  }

  const applyTemplate = async (templateId: string | null): Promise<void> => {
    if (!window.creatorOS || !project) return
    try {
      const next = await window.creatorOS.applyProjectTemplate(project.id, templateId)
      setProject(next); await refresh(); setNotice(next.appliedTemplateName ? `已应用“${next.appliedTemplateName}”；原有模块和内容均已保留` : '已切换为从空白开始；原有模块和内容均已保留')
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '项目模板应用失败'); throw reason }
  }

  const saveOutline = async (): Promise<void> => {
    if (!window.creatorOS || !project) return
    const validItems = outlineItems.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text)
    if (validItems.length === 0) { setNotice('至少保留一条大纲内容'); return }
    const version = await window.creatorOS.saveOutline(project.id, validItems, outlineParentVersionIds.length ? outlineParentVersionIds : undefined, { id: outlineDocumentId || crypto.randomUUID(), name: outlineDocumentName || '大纲' })
    await window.creatorOS.setActiveOutlineVersion(project.id, version.id)
    setOutlineItems(validItems); setOutlineParentVersionIds([]); setNotice('大纲已保存为新版本，旧版本仍可回看'); await load()
  }

  const importScriptFile = async (file: File): Promise<void> => {
    if (!window.creatorOS || !project) return
    if (file.size > 10 * 1024 * 1024) { setNotice('导入文件不能超过10MB'); return }
    try {
      const result = await window.creatorOS.importScriptFile(project.id, file.name, new Uint8Array(await file.arrayBuffer()))
      if (!result.canceled) { setNotice(`已导入${result.sourceName ?? file.name}并创建新版本`); await load(); await refresh() }
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '外部文案导入失败') }
  }

  const importOutlineTemplate = async (file: File): Promise<void> => {
    if (!window.creatorOS) return
    if (!file.name.toLowerCase().endsWith('.docx')) { setNotice('大纲模板只支持Word .docx文件'); return }
    if (file.size > 10 * 1024 * 1024) { setNotice('导入文件不能超过10MB'); return }
    try {
      const template = await window.creatorOS.importOutlineTemplateFile(file.name, new Uint8Array(await file.arrayBuffer()))
      setNotice(`已导入“${template.name}”的结构；Word原文没有进入项目大纲`)
      await refresh()
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '大纲模板导入失败') }
  }

  const deleteOutlineTemplate = async (resourceId: string): Promise<void> => {
    if (!window.creatorOS) return
    try { await window.creatorOS.deleteOutlineTemplate(resourceId); setNotice('大纲模板已移除，现有项目大纲不受影响'); await refresh() }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : '大纲模板移除失败') }
  }

  const linkExternalScript = async (): Promise<void> => {
    if (!window.creatorOS || !project) return
    try {
      const result = await window.creatorOS.importScript(project.id)
      if (!result.canceled) {
        setNotice(`已关联${result.sourceName ?? '外部文案'}，后续变化会自动创建新版本`)
        await load(); await refresh()
      }
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '外部文案关联失败') }
  }

  if (loading) return <main className="page"><div className="loading-state">正在打开项目…</div></main>
  if (!project || error) return <main className="page"><div className="empty-state"><b>{error || '项目不存在'}</b><button className="primary-action" onClick={() => navigate({ page: 'projects' })}>返回内容项目</button></div></main>

  return <main className="page project-detail-page">
    <ProjectOverview project={project} description={description} setDescription={setDescription} onSave={saveDescription} onChangeContentType={changeContentType} onChangePlatforms={next => changePlatforms(next, true)} onApplyTemplate={applyTemplate} header={<ProjectHeader
      project={project}
      activeModule={activeModule}
      editingName={editingName}
      actionsRef={menuRef}
      fileInputRef={fileInputRef}
      menuExpanded={Boolean(menu) || moduleMenuOpen}
      onRenameStart={() => setEditingName(true)}
      onRenameSave={saveRename}
      onRenameCancel={() => setEditingName(false)}
      onImportScript={(file) => void importScriptFile(file)}
      onOpenMenu={(anchor) => { setModuleMenuOpen(false); setMenu({ project, anchor, view: 'active', context: 'detail' }) }}
      moduleManager={moduleMenuOpen ? <div className="module-menu" role="menu" aria-label="管理阶段模块"><header><b>显示与排列阶段模块</b><span>拖动调整顺序；关闭只会隐藏内容</span></header><label className="locked"><input type="checkbox" checked disabled /><span>概览</span><small>固定入口</small></label>{moduleOrder.map((key) => {
        const module = project.modules.find((item) => item.key === key); const enabled = module?.enabled ?? false
        return <div className={`module-menu-row${key === 'business' ? ' amount-fixed' : ''}${draggedModuleKey === key ? ' dragging' : ''}${dragOverModuleKey === key ? ' drag-over' : ''}`} role="menuitem" key={key} onDragOver={(event) => { if (moduleOrderSaving || key === 'business') return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverModuleKey(key) }} onDragLeave={() => { if (dragOverModuleKey === key) setDragOverModuleKey(null) }} onDrop={(event) => { event.preventDefault(); const source = draggedModuleKey ?? event.dataTransfer.getData(MODULE_DRAG_MIME); if (optionalKeys.includes(source as OptionalProjectModuleKey)) moveModule(source as OptionalProjectModuleKey, key) }}>
          <button type="button" className="module-drag-handle" draggable={!moduleOrderSaving && key !== 'business'} disabled={moduleOrderSaving || key === 'business'} aria-label={key === 'business' ? '金额固定在末尾' : `拖动排序${moduleLabels[key]}`} aria-keyshortcuts={key === 'business' ? undefined : 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown'} title={key === 'business' ? '金额不属于创作阶段，固定在末尾' : '拖动排序，或按Alt+Shift+↑/↓'} onDragStart={(event) => { setDraggedModuleKey(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(MODULE_DRAG_MIME, key) }} onDragEnd={() => { setDraggedModuleKey(null); setDragOverModuleKey(null) }} onKeyDown={(event) => { if (!event.altKey || !event.shiftKey || key === 'business') return; if (event.key === 'ArrowUp') { event.preventDefault(); moveModuleByKeyboard(key, -1) } else if (event.key === 'ArrowDown') { event.preventDefault(); moveModuleByKeyboard(key, 1) } }}><GripVertical size={13} /></button>
          <label><input type="checkbox" checked={enabled} disabled={moduleOrderSaving} onChange={(event) => void toggleModule(key, event.currentTarget.checked)} /><span>{moduleLabels[key]}</span>{key === 'business' ? <small>商单独有·固定末尾</small> : !enabled && module ? <small>内容已保留</small> : null}</label>
        </div>
      })}<label className="locked"><input type="checkbox" checked disabled /><span>版本</span><small>固定</small></label></div> : null}
    />} />
    <ProjectStageWorkspace project={project} onEditStage={(stageKey, anchor) => setStageEditor({ stageKey, anchor })} onComplete={toggleModuleCompleted} onStart={startStage} onOpen={key => navigate({ page: 'project', projectId: project.id, moduleKey: key })} />
    {notice ? <div className="inline-notice" role="status"><Check size={14} />{notice}<button onClick={() => setNotice('')}>关闭</button></div> : null}
    {activeModule !== 'overview' ? <ProjectContentDialog stageKey={activeModule} title={moduleLabels[activeModule]} onClose={() => navigate({ page: 'project', projectId: project.id, moduleKey: 'overview' })}><section className="project-panel">
      {activeStageModule ? <button className="stage-editor-complete" onClick={() => void toggleModuleCompleted(activeStageModule)}>{activeStageModule.completedAt ? '重新打开阶段' : '标记阶段完成'}</button> : null}
      {activeModule === 'outline' ? <OutlinePanel project={project} items={outlineItems} templates={outlineTemplates} parentVersionIds={outlineParentVersionIds} outlineDocumentId={outlineDocumentId} outlineDocumentName={outlineDocumentName} setItems={setOutlineItems} setParentVersionIds={setOutlineParentVersionIds} setOutlineDocumentName={setOutlineDocumentName} onSelectOutline={(document) => { setOutlineDocumentId(document.id); setOutlineDocumentName(document.name); setOutlineItems(document.items); setOutlineParentVersionIds(document.versionId ? [document.versionId] : []); if (document.versionId) void window.creatorOS?.setActiveOutlineVersion(project.id, document.versionId) }} onCreateOutline={() => { const documents = listOutlineDocuments(project.versions); setOutlineDocumentId(crypto.randomUUID()); setOutlineDocumentName(`大纲${documents.length + 1}`); setOutlineItems([{ id: crypto.randomUUID(), text: '' }]); setOutlineParentVersionIds([]); setNotice('已新建一份大纲草稿，保存后才会写入版本历史') }} onNotice={setNotice} onSave={() => void saveOutline()} onImport={() => outlineTemplateInputRef.current?.click()} onApply={(template) => { setOutlineItems(template.items.map((text) => ({ id: crypto.randomUUID(), text }))); setOutlineParentVersionIds([]); setNotice(`已把“${template.name}”载入当前草稿；点击保存后才会创建新版本`) }} onDelete={(resourceId) => void deleteOutlineTemplate(resourceId)} /> : null}
      {activeModule === 'script' ? <ScriptPanel project={project} relations={externalFileRelations} onImport={() => fileInputRef.current?.click()} onImportFile={(file) => void importScriptFile(file)} onLink={() => void linkExternalScript()} /> : null}
      {activeModule === 'versions' ? <VersionsPanel project={project} onChanged={() => void load({ silent: true, preserveEditors: true })} onNotice={setNotice} /> : null}
      {activeModule === 'materials' ? <MaterialsPanel project={project} onChanged={() => void load({ silent: true, preserveEditors: true })} onNotice={setNotice} /> : null}
      {['production', 'shooting', 'editing'].includes(activeModule) ? <ProductionPanel key={activeModule} project={project} mode={activeModule as 'production' | 'shooting' | 'editing'} onNotice={setNotice} /> : null}
      {activeModule === 'postproduction' ? <PostProductionPanel project={project} onChanged={() => void load({ silent: true, preserveEditors: true })} onNotice={setNotice} /> : null}
      {activeModule === 'publishing' ? <PublishingPanel project={project} onChanged={() => void load({ silent: true, preserveEditors: true })} onNotice={setNotice} /> : null}
      {activeModule === 'business' ? <BusinessModule project={project} onChanged={() => void load({ silent: true, preserveEditors: true })} onNotice={setNotice} /> : null}
    </section></ProjectContentDialog> : null}
    <input ref={outlineTemplateInputRef} className="visually-hidden" type="file" accept=".docx" aria-label="选择要导入的大纲Word模板" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importOutlineTemplate(file); event.currentTarget.value = '' }} />
    <StageTimeEditor
      anchor={stageEditor?.anchor ?? null}
      record={stageEditorRecord}
      onClose={() => setStageEditor(null)}
      onSave={(patch, requestId) => {
        if (!stageEditorRecord) return Promise.reject(new Error('阶段不存在'))
        return updateStageTime(stageEditorRecord, patch, requestId)
      }}
    />
    {stageToast ? <div className="project-stage-toast" role="status"><span>{stageToast.message}</span><button onClick={() => void undoStageTime()}>撤销</button><button aria-label="关闭阶段提示" onClick={() => setStageToast(null)}><X size={13} /></button></div> : null}
    <ProjectContextMenu target={menu} onClose={() => setMenu(null)} onDone={(action) => { if (action === 'trashed') navigate({ page: 'recycle' }); else if (action === 'completed' || action === 'archived') navigate({ page: 'topics' }) }} onRename={() => setEditingName(true)} onManageModules={() => setModuleMenuOpen(true)} onArchiveToNas={() => setNasArchiveOpen(true)} />
    {nasArchiveOpen ? <NasArchiveDialog projectId={project.id} onClose={() => setNasArchiveOpen(false)} onNotice={setNotice} /> : null}
  </main>
}

type MaterialInputMode = 'pdf' | 'text' | 'link'
type AssetImportTarget = 'materials' | 'experience'

function MaterialsPanel({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  const captures = useWorkspaceStore((state) => state.snapshot.captures)
  const tasks = useWorkspaceStore((state) => state.snapshot.tasks)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [inputMode, setInputMode] = useState<MaterialInputMode | null>(null)
  const [role, setRole] = useState<ProjectMaterialRole>(project.isCommercial ? 'brief' : 'project_material')
  const [title, setTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [assetImportTarget, setAssetImportTarget] = useState<AssetImportTarget | null>(null)
  const [batchResults, setBatchResults] = useState<Partial<Record<AssetImportTarget, ProjectAssetImportBatchResult>>>({})
  const [error, setError] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [scratchEditor, setScratchEditor] = useState<{ noteId: string | null; title: string; markdown: string } | null>(null)
  const [previewMaterialId, setPreviewMaterialId] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<{ kind: 'image' | 'pdf'; dataUrl: string } | null>(null)
  const [researchOpen, setResearchOpen] = useState(false)
  const [researchSession, setResearchSession] = useState<MaterialResearchSession | null>(null)
  const [recentResearch, setRecentResearch] = useState<MaterialResearchSession | null>(null)
  const [researchTitle, setResearchTitle] = useState('')
  const [researchRequest, setResearchRequest] = useState('')
  const [selectedResearchClaimIds, setSelectedResearchClaimIds] = useState<string[]>([])
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchError, setResearchError] = useState('')
  const addMenuRef = useRef<HTMLDivElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const accepted = captures.filter((capture) => capture.captureKind === 'project_content' && capture.classificationStatus === 'confirmed' && capture.useStatus === 'active' && (capture.primaryProjectId === project.id || capture.referencedProjectIds.includes(project.id)))
  const pending = captures.filter((capture) => capture.captureKind === 'project_content' && capture.classificationStatus === 'suggested' && capture.suggestedProjectId === project.id)
  const legacyFrameworkId = `${PROJECT_FRAMEWORK_MATERIAL_ID_PREFIX}${project.id}`
  const scratchNotes = project.materials.filter((material) => material.id === legacyFrameworkId || material.id.startsWith(PROJECT_SCRATCH_NOTE_MATERIAL_ID_PREFIX))
  const scratchNoteIds = new Set(scratchNotes.map((material) => material.id))
  const rootAssetLinks = project.assetLinks.filter((link) => link.parentLinkId === null)
  const rootAssetLinkByMaterial = new Map(rootAssetLinks.map((link) => [link.projectMaterialId, link]))
  const experienceMaterialIds = new Set(rootAssetLinks.filter((link) => link.usageType !== null).map((link) => link.projectMaterialId))
  const listedMaterials = project.materials.filter((material) => !scratchNoteIds.has(material.id) && !experienceMaterialIds.has(material.id))
  const experienceMaterials = project.materials.filter((material) => experienceMaterialIds.has(material.id))
  const removableMaterials = [...listedMaterials, ...experienceMaterials, ...scratchNotes]
  const usageLabel: Record<NonNullable<(typeof captures)[number]['usageType']>, string> = { parameter_fact: '参数事实', opinion: '观点想法', material_clue: '素材线索' }
  const sourceLabel: Record<(typeof captures)[number]['sourceType'], string> = { quick_capture: '快速记录', web_bookmark: '网页收藏', notion_import: 'Notion导入', project: '项目内记录', conversation_filter: 'AI对话筛选', mobile_android: 'Android快速记录' }
  const latestResearchTask = tasks.find((task) => task.projectId === project.id && task.taskType === 'material_research') ?? null
  useEffect(() => {
    if (!addMenuOpen) return
    const close = (event: MouseEvent): void => { if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setAddMenuOpen(false) }
    document.addEventListener('mousedown', close); window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [addMenuOpen])
  useEffect(() => {
    if (!inputMode && !pendingDeleteId) return
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !saving) { setInputMode(null); setPendingDeleteId(null) } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [inputMode, pendingDeleteId, saving])
  useEffect(() => {
    if (!researchOpen) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !researchBusy) setResearchOpen(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [researchBusy, researchOpen])
  useEffect(() => {
    if (!window.creatorOS || !latestResearchTask?.outputTarget?.startsWith('material-research:')) {
      setRecentResearch(null)
      return
    }
    const researchId = latestResearchTask.outputTarget.slice('material-research:'.length)
    void window.creatorOS.getProjectMaterialResearch(project.id, researchId).then((session) => {
      setRecentResearch(session)
      if (researchOpen && researchSession?.id === session.id) {
        setResearchSession(session)
        if (session.result && selectedResearchClaimIds.length === 0) {
          setSelectedResearchClaimIds(session.result.claims.filter((claim) => claim.sourceIds.length > 0).map((claim) => claim.id))
          setResearchTitle((current) => current || session.requestedTitle || session.result!.suggestedTitle)
        }
      }
    }).catch(() => setRecentResearch(null))
  }, [latestResearchTask?.id, latestResearchTask?.outputTarget, latestResearchTask?.progress, latestResearchTask?.status, project.id, researchOpen, researchSession?.id, selectedResearchClaimIds.length])
  const openInput = (mode: MaterialInputMode): void => {
    setInputMode(mode); setAddMenuOpen(false); setRole(project.isCommercial ? 'brief' : 'project_material')
    setTitle(''); setTextContent(''); setSourceUrl(''); setPdfFile(null); setError('')
  }
  const save = async (): Promise<void> => {
    if (!window.creatorOS || !inputMode || saving) return
    setSaving(true); setError('')
    try {
      if (inputMode === 'pdf') {
        if (!pdfFile) throw new Error('请先选择PDF文件')
        if (pdfFile.size > 10 * 1024 * 1024) throw new Error('PDF文件必须小于10MB')
        await window.creatorOS.importProjectPdfMaterialFromFile(project.id, role, title, pdfFile)
        onNotice(`已解析并保存${role === 'brief' ? 'Brief' : '项目资料'}“${title.trim() || pdfFile.name.replace(/\.pdf$/i, '')}”`)
      } else if (inputMode === 'text') {
        await window.creatorOS.saveProjectTextMaterial(project.id, role, title, textContent)
        onNotice(`已保存${role === 'brief' ? 'Brief' : '项目资料'}文字`)
      } else {
        await window.creatorOS.saveProjectLinkMaterial(project.id, role, title, sourceUrl)
        onNotice('网页链接已保存；正文尚未读取，生成前会明确提示')
      }
      setInputMode(null); onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '项目资料保存失败') }
    finally { setSaving(false) }
  }
  const importAssets = async (target: AssetImportTarget, files?: File[]): Promise<void> => {
    if (!window.creatorOS || assetImportTarget) return
    setAssetImportTarget(target); setAddMenuOpen(false)
    try {
      const importRole: ProjectMaterialRole = target === 'experience' ? 'project_material' : role
      const usageType = target === 'experience' ? 'material_clue' as const : null
      const result = files
        ? await window.creatorOS.importProjectAssetFiles(project.id, importRole, usageType, files)
        : await window.creatorOS.chooseProjectAssetSources(project.id, importRole, usageType)
      if (!result.canceled) {
        setBatchResults((current) => ({ ...current, [target]: result }))
        if (result.importedRootCount > 0) onChanged()
        onNotice(result.importedRootCount > 0 ? `已添加${result.importedRootCount}项${result.failedEntryCount ? `，${result.failedEntryCount}项未完成` : ''}` : result.items[0]?.message ?? '没有添加资料')
      }
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '批量添加失败') }
    finally { setAssetImportTarget(null) }
  }
  const remove = async (materialId: string): Promise<void> => {
    if (!window.creatorOS || saving) return
    setSaving(true)
    try { await window.creatorOS.deleteProjectMaterial(project.id, materialId); setPendingDeleteId(null); onChanged(); onNotice('项目资料已删除') }
    catch (reason) { setPendingDeleteId(null); onNotice(reason instanceof Error ? reason.message : '项目资料删除失败') }
    finally { setSaving(false) }
  }
  const openMaterial = async (material: ProjectDetail['materials'][number]): Promise<void> => {
    if (!window.creatorOS) return
    try {
      const result = await window.creatorOS.openProjectMaterial(project.id, material.id)
      onNotice(result === 'source' ? '已打开原始位置' : result === 'managed' ? '原始位置不可用，已打开App受管副本' : '已用默认浏览器打开链接')
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '项目资料打开失败') }
  }
  const previewOrOpenMaterial = async (material: ProjectDetail['materials'][number]): Promise<void> => {
    if (material.sourceKind === 'text') { setPreviewData(null); setPreviewMaterialId(material.id); return }
    const root = rootAssetLinkByMaterial.get(material.id)
    if (material.sourceKind === 'file' && root && (root.mimeType === 'application/pdf' || (root.mimeType.startsWith('image/') && root.mimeType !== 'image/svg+xml'))) {
      try {
        const preview = await window.creatorOS?.getProjectMaterialPreview(project.id, material.id)
        if (preview?.dataUrl && preview.kind !== 'unsupported') {
          setPreviewData({ kind: preview.kind, dataUrl: preview.dataUrl }); setPreviewMaterialId(material.id); return
        }
      } catch { /* 预览失败时仍允许使用系统默认应用打开 */ }
    }
    await openMaterial(material)
  }
  const materialMeta = (material: ProjectDetail['materials'][number]): string => {
    const links = project.assetLinks.filter((link) => link.projectMaterialId === material.id)
    const root = rootAssetLinkByMaterial.get(material.id)
    if (material.sourceKind === 'folder') {
      const fileCount = links.filter((link) => link.fileKind === 'file').length
      const folderCount = links.filter((link) => link.fileKind === 'folder').length
      const storedOnly = links.filter((link) => link.fileKind === 'file' && link.processState === 'stored_only').length
      return `文件夹·${fileCount}个文件·${folderCount}个文件夹${storedOnly ? `·${storedOnly}个仅保存` : ''}`
    }
    if (material.sourceKind === 'file') {
      if (material.pageCount) return `${material.fileName ?? 'PDF文件'}·${material.pageCount}页·已解析`
      if (root?.processState === 'stored_only' || material.parseStatus === 'stored_only') return `${material.fileName ?? material.title}·仅保存，当前不解析`
      if (root?.processState === 'failed' || material.parseStatus === 'failed') return `${material.fileName ?? material.title}·处理失败，文件已保留`
      if (root?.processState === 'pending' || material.parseStatus === 'pending') return `${material.fileName ?? material.title}·已保存，待处理`
      return `${material.fileName ?? material.title}·已保存`
    }
    if (material.sourceKind === 'text') return `文字·${material.textContent?.length ?? 0}字`
    return '网页链接·仅保存，未读取正文'
  }
  const renderMaterial = (material: ProjectDetail['materials'][number], experience = false): React.JSX.Element => {
    const root = rootAssetLinkByMaterial.get(material.id)
    const badge = experience && root?.usageType ? usageLabel[root.usageType] : material.role === 'brief' ? 'Brief' : '项目资料'
    return <ProjectAssetItem
      key={material.id}
      title={material.title}
      badge={badge}
      meta={materialMeta(material)}
      detail={material.sourceKind === 'link' ? material.sourceUrl : null}
      kind={material.sourceKind}
      onOpen={() => void previewOrOpenMaterial(material)}
      onDelete={() => setPendingDeleteId(material.id)}
    />
  }
  const pendingDelete = removableMaterials.find((material) => material.id === pendingDeleteId)
  const previewMaterial = project.materials.find((material) => material.id === previewMaterialId) ?? null
  useEffect(() => {
    if (!previewMaterial) return
    const closePreview = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === ' ') { event.preventDefault(); setPreviewMaterialId(null); setPreviewData(null) }
    }
    window.addEventListener('keydown', closePreview)
    return () => window.removeEventListener('keydown', closePreview)
  }, [previewMaterial])
  const savePrimaryReferences = async (
    referenceRequirements: string,
    references: { linkId: string; attentionNote: string }[],
    materialReferences: { materialId: string; attentionNote: string }[]
  ): Promise<void> => {
    if (!window.creatorOS) throw new Error('项目详情需要在App中打开')
    await window.creatorOS.saveProjectPrimaryReferences(project.id, referenceRequirements, references, materialReferences)
    onChanged(); onNotice('主要参考已保存，会随后续AI任务冻结')
  }
  const openNewResearch = (): void => {
    setAddMenuOpen(false)
    setResearchOpen(true)
    setResearchSession(null)
    setResearchTitle('')
    setResearchRequest('')
    setSelectedResearchClaimIds([])
    setResearchError('')
  }
  const openExistingResearch = async (session: MaterialResearchSession): Promise<void> => {
    setResearchOpen(true)
    setResearchBusy(true)
    setResearchError('')
    try {
      const current = await window.creatorOS?.getProjectMaterialResearch(project.id, session.id)
      if (!current) throw new Error('联网收集结果读取失败')
      setResearchSession(current)
      setResearchTitle(current.requestedTitle || current.result?.suggestedTitle || '')
      setResearchRequest(current.request)
      setSelectedResearchClaimIds(current.result?.claims.filter((claim) => claim.sourceIds.length > 0).map((claim) => claim.id) ?? [])
    } catch (reason) { setResearchError(reason instanceof Error ? reason.message : '联网收集结果读取失败') }
    finally { setResearchBusy(false) }
  }
  const startResearch = async (): Promise<void> => {
    if (!window.creatorOS || researchBusy || researchRequest.trim().length < 2) return
    setResearchBusy(true); setResearchError('')
    try {
      const task = await window.creatorOS.startProjectMaterialResearch(project.id, researchTitle.trim(), researchRequest.trim())
      const researchId = task.outputTarget?.startsWith('material-research:') ? task.outputTarget.slice('material-research:'.length) : null
      if (!researchId) throw new Error('联网收集任务没有返回候选标识')
      const session = await window.creatorOS.getProjectMaterialResearch(project.id, researchId)
      setResearchSession(session)
      setRecentResearch(session)
      onNotice('已开始联网收集；关闭窗口后任务仍会继续')
    } catch (reason) { setResearchError(reason instanceof Error ? reason.message : '联网收集启动失败') }
    finally { setResearchBusy(false) }
  }
  const cancelResearch = async (): Promise<void> => {
    if (!window.creatorOS || !researchSession || researchBusy) return
    setResearchBusy(true); setResearchError('')
    try {
      await window.creatorOS.cancelTask(researchSession.taskId)
      const current = await window.creatorOS.getProjectMaterialResearch(project.id, researchSession.id)
      setResearchSession(current); setRecentResearch(current)
    } catch (reason) { setResearchError(reason instanceof Error ? reason.message : '联网收集取消失败') }
    finally { setResearchBusy(false) }
  }
  const retryResearch = async (): Promise<void> => {
    if (!window.creatorOS || !researchSession || researchBusy) return
    setResearchBusy(true); setResearchError('')
    try {
      await window.creatorOS.retryTask(researchSession.taskId)
      const current = await window.creatorOS.getProjectMaterialResearch(project.id, researchSession.id)
      setResearchSession(current); setRecentResearch(current); setSelectedResearchClaimIds([])
    } catch (reason) { setResearchError(reason instanceof Error ? reason.message : '联网收集重试失败') }
    finally { setResearchBusy(false) }
  }
  const saveResearch = async (): Promise<void> => {
    if (!window.creatorOS || !researchSession?.result || researchBusy || selectedResearchClaimIds.length === 0) return
    setResearchBusy(true); setResearchError('')
    try {
      const material = await window.creatorOS.saveProjectMaterialResearch(project.id, researchSession.id, researchTitle.trim() || researchSession.result.suggestedTitle, selectedResearchClaimIds)
      const current = await window.creatorOS.getProjectMaterialResearch(project.id, researchSession.id)
      setResearchSession(current); setRecentResearch(current)
      onChanged(); onNotice(`已保存联网参考资料“${material.title}”`)
    } catch (reason) { setResearchError(reason instanceof Error ? reason.message : '联网资料保存失败') }
    finally { setResearchBusy(false) }
  }
  const renderResearchSourceLinks = (sourceIds: string[]): React.JSX.Element | null => {
    if (!researchSession?.result || sourceIds.length === 0) return null
    const sources = sourceIds.flatMap((sourceId) => {
      const index = researchSession.result!.sources.findIndex((source) => source.id === sourceId)
      return index >= 0 ? [{ source: researchSession.result!.sources[index]!, index }] : []
    })
    if (sources.length === 0) return null
    return <div className="material-research-source-links" aria-label="这条内容对应的来源">{sources.map(({ source, index }) => <button key={source.id} title={`打开${source.title}`} onClick={() => void window.creatorOS?.openExternalLink(source.url)}><ExternalLink size={10} />来源{index + 1}·{source.title}</button>)}</div>
  }
  return <section className="content-card project-module-surface materials-workspace">
    <header><div><span>项目资料</span><h2>资料</h2></div><div className="material-add-anchor" ref={addMenuRef}><button className="primary-action" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((value) => !value)}>添加资料</button>{addMenuOpen ? <div className="material-add-menu" role="menu"><button role="menuitem" className="material-research-menu-item" onClick={openNewResearch}><Search size={14} /><span><b>联网收集资料</b></span></button><button role="menuitem" onClick={() => void importAssets('materials')}><UploadCloud size={14} /><span><b>文件或文件夹</b><small>可多选，逐项保存结果</small></span></button><button role="menuitem" onClick={() => openInput('pdf')}><UploadCloud size={14} /><span><b>导入并解析PDF</b><small>单份PDF立即提取文字</small></span></button><button role="menuitem" onClick={() => openInput('text')}><FileInput size={14} /><span><b>粘贴文字</b><small>粘贴后直接保存</small></span></button><button role="menuitem" onClick={() => openInput('link')}><Link2 size={14} /><span><b>保存网页链接</b><small>只保存，不假装已读取</small></span></button></div> : null}</div></header>
    {recentResearch && !recentResearch.savedMaterialId && ['queued', 'running', 'failed', 'succeeded', 'canceled'].includes(recentResearch.status) ? <button className={`material-research-resume ${recentResearch.status}`} onClick={() => void openExistingResearch(recentResearch)}><span><Globe2 size={16} /><span><b>{recentResearch.status === 'succeeded' ? '联网资料等待确认' : recentResearch.status === 'failed' ? '联网收集需要处理' : recentResearch.status === 'canceled' ? '联网收集已取消' : '正在联网收集资料'}</b><small>{recentResearch.status === 'running' || recentResearch.status === 'queued' ? `${recentResearch.progress}%·可以关闭项目，任务会继续` : recentResearch.errorMessage ?? recentResearch.request}</small></span></span><em>{recentResearch.status === 'succeeded' ? '查看并保存' : recentResearch.status === 'failed' || recentResearch.status === 'canceled' ? '查看' : '查看进度'}</em></button> : null}
    <section className="scratch-note-card"><header><span className="framework-document-icon"><BookOpen size={18} /></span><div><h3>随手笔记</h3></div><button onClick={() => setScratchEditor({ noteId: null, title: `随手笔记${scratchNotes.length + 1}`, markdown: '' })}><Plus size={14} />新建</button></header>{scratchNotes.length ? <div className="scratch-note-list">{scratchNotes.map((note) => <article key={note.id}><button onClick={() => setScratchEditor({ noteId: note.id, title: note.title === '项目框架' ? '随手笔记' : note.title, markdown: note.textContent ?? '' })}><b>{note.title === '项目框架' ? '随手笔记' : note.title}</b><span>{note.textContent?.length ?? 0}字</span></button><button aria-label={`删除随手笔记${note.title}`} onClick={() => setPendingDeleteId(note.id)}><Trash2 size={13} /></button></article>)}</div> : <span className="scratch-note-empty">还没有笔记；可直接在App里写，不必先建文件。</span>}{scratchEditor ? <ScratchNoteEditor projectId={project.id} noteId={scratchEditor.noteId} initialTitle={scratchEditor.title} initialMarkdown={scratchEditor.markdown} onNotice={onNotice} onSaved={onChanged} onClose={() => setScratchEditor(null)} /> : null}</section>
    <PrimaryReferencePanel project={project} onSave={savePrimaryReferences} />
    <div className="materials-columns">
      <section className="project-material-list"><header><div><h3>Brief与文件</h3></div><span>{listedMaterials.length}条</span></header>
        {project.isCommercial ? <div className="material-import-role" role="group" aria-label="新资料保存为"><span>新资料保存为</span><button className={role === 'brief' ? 'active' : ''} onClick={() => setRole('brief')}>Brief</button><button className={role === 'project_material' ? 'active' : ''} onClick={() => setRole('project_material')}>项目资料</button></div> : null}
        <FileDropZone label="选择或拖入文件、文件夹" description="支持多选；单项失败不影响其他项" busy={assetImportTarget === 'materials'} onChoose={() => void importAssets('materials')} onFiles={(files) => void importAssets('materials', files)} />
        {batchResults.materials ? <ProjectAssetBatchResult result={batchResults.materials} onDismiss={() => setBatchResults((current) => ({ ...current, materials: undefined }))} /> : null}
        {listedMaterials.length ? <div>{listedMaterials.map((material) => renderMaterial(material))}</div> : <div className="module-empty-state"><b>还没有Brief或文件</b><span>可一次拖入多个文件或文件夹，也可粘贴文字和保存网页链接。</span></div>}
      </section>
      <section className="inspiration-landing project-material-list"><header><div><h3>体验与参数</h3></div>{pending.length ? <button onClick={() => navigate({ page: 'ideas', projectId: project.id })}>{pending.length}条待确认</button> : null}</header>
        <FileDropZone label="添加体验文件或文件夹" description="默认标记为素材线索，之后可调整用途" busy={assetImportTarget === 'experience'} onChoose={() => void importAssets('experience')} onFiles={(files) => void importAssets('experience', files)} />
        {batchResults.experience ? <ProjectAssetBatchResult result={batchResults.experience} onDismiss={() => setBatchResults((current) => ({ ...current, experience: undefined }))} /> : null}
        {experienceMaterials.length ? <div className="experience-asset-list">{experienceMaterials.map((material) => renderMaterial(material, true))}</div> : null}
        {accepted.length ? <div className="inspiration-landing-list">{accepted.map((capture) => <article key={capture.id}><div><b>{capture.originalContent || '附件记录'}</b><span>{sourceLabel[capture.sourceType]}·{capture.classificationActor === 'system' ? 'AI已归类' : '手动归类'}</span><CaptureAttachmentList capture={capture} compact /></div><footer><em>{capture.usageType ? usageLabel[capture.usageType] : '未标用途'}</em><span>{capture.usageType === 'parameter_fact' ? '未发起核验' : '无需事实核验'}</span></footer></article>)}</div> : null}
        {!experienceMaterials.length && !accepted.length ? <div className="module-empty-state"><b>还没有体验与参数</b><span>可从灵感库归入，也可直接拖入图片、音频、文档和文件夹。</span><button onClick={() => navigate({ page: 'ideas', projectId: project.id })}>打开灵感库</button></div> : null}
      </section>
    </div>
    {researchOpen ? <div className="modal-backdrop material-research-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !researchBusy) setResearchOpen(false) }}><section className="material-research-dialog" role="dialog" aria-modal="true" aria-labelledby="material-research-title">
      <header><div><span><Globe2 size={13} />项目资料·联网收集</span><h2 id="material-research-title">{researchSession?.result ? '核对后保存参考资料' : researchSession ? '正在收集资料' : '想让系统帮你收集什么？'}</h2><p>只发送项目名称、项目描述和本次要求；不会读取或上传已有文件。</p></div><button aria-label="关闭联网收集" disabled={researchBusy} onClick={() => setResearchOpen(false)}><X size={17} /></button></header>
      {!researchSession ? <div className="material-research-request">
        <label><span>资料标题·可稍后修改</span><input value={researchTitle} maxLength={160} onChange={(event) => setResearchTitle(event.currentTarget.value)} placeholder="例如：无线鼠标核心参数与发布时间" /></label>
        <label><span>具体收集要求</span><textarea autoFocus value={researchRequest} maxLength={8_000} onChange={(event) => setResearchRequest(event.currentTarget.value)} placeholder={'例如：收集近三年主流无线鼠标的重量、续航、传感器、首发价格和发布时间。优先官方产品页与说明书，价格注明地区和采集日期；来源冲突时并列展示。'} /></label>
        <div className="material-research-guard"><CheckCircle2 size={15} /><span><b>结果不会直接写入项目</b><small>Codex会强制联网查证；完成后由你逐条核实来源、选择结论，再保存为当前资料阶段的一份参考资料。</small></span></div>
      </div> : researchSession.status === 'queued' || researchSession.status === 'running' ? <div className="material-research-running"><span className="material-research-orbit"><Globe2 size={25} /></span><b>{researchSession.status === 'queued' ? '正在等待开始' : '正在搜索并核对来源网页'}</b><p>{researchSession.request}</p><progress aria-label="联网收集进度" value={researchSession.progress} max="100" /><small>{researchSession.progress}%·关闭这个窗口不会取消任务</small></div> : researchSession.status === 'failed' || researchSession.status === 'canceled' ? <div className="material-research-failed"><AlertTriangle size={24} /><b>{researchSession.status === 'canceled' ? '这次联网收集已取消' : '这次联网收集没有完成'}</b><p>{researchSession.errorMessage ?? '原始要求仍然保留，可以直接重试或返回修改。'}</p><blockquote>{researchSession.request}</blockquote></div> : researchSession.result ? <div className="material-research-result">
        <section className="material-research-result-summary"><label><span>保存后的资料标题</span><input value={researchTitle} maxLength={200} onChange={(event) => setResearchTitle(event.currentTarget.value)} /></label><p>{researchSession.result.overview}</p><small>采集于{new Date(researchSession.result.searchedAt).toLocaleString('zh-CN')}·{researchSession.result.sources.length}个可核实来源</small></section>
        <section className="material-research-claims"><header><div><b>选择要保存的结论</b><span>{selectedResearchClaimIds.length}/{researchSession.result.claims.length}条</span></div><button onClick={() => setSelectedResearchClaimIds(selectedResearchClaimIds.length === researchSession.result!.claims.length ? [] : researchSession.result!.claims.map((claim) => claim.id))}>{selectedResearchClaimIds.length === researchSession.result.claims.length ? '取消全选' : '全选'}</button></header>{researchSession.result.claims.map((claim) => <article className={`material-research-claim ${claim.status}`} key={claim.id}><label><input type="checkbox" checked={selectedResearchClaimIds.includes(claim.id)} onChange={() => setSelectedResearchClaimIds((current) => current.includes(claim.id) ? current.filter((id) => id !== claim.id) : [...current, claim.id])} /><span><b>{claim.heading}</b><p>{claim.content}</p><small>{claim.status === 'supported' ? '已有来源支持' : claim.status === 'conflict' ? '来源存在冲突' : '仍待核实'}·{claim.sourceIds.length ? `${claim.sourceIds.length}个来源` : '没有可靠来源'}</small></span></label>{renderResearchSourceLinks(claim.sourceIds)}</article>)}</section>
        {researchSession.result.conflicts.length ? <section className="material-research-conflicts"><header><AlertTriangle size={15} /><b>来源冲突</b></header>{researchSession.result.conflicts.map((conflict) => <article key={`${conflict.topic}:${conflict.details}`}><b>{conflict.topic}</b><p>{conflict.details}</p>{renderResearchSourceLinks(conflict.sourceIds)}</article>)}</section> : null}
        {researchSession.result.unresolved.length ? <section className="material-research-unresolved"><b>仍待核实</b><ul>{researchSession.result.unresolved.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
        <section className="material-research-sources"><header><b>来源</b><span>点击打开原网页核实</span></header>{researchSession.result.sources.map((source, index) => <button key={source.id} onClick={() => void window.creatorOS?.openExternalLink(source.url)}><span><em>{index + 1}</em><span><b>{source.title}</b><small>{source.publisher || source.domain}·{source.domain}{source.publishedAt ? `·${source.publishedAt}` : ''}</small></span></span><ExternalLink size={13} /></button>)}</section>
      </div> : <div className="material-research-failed"><AlertTriangle size={24} /><b>没有可预览的结果</b><p>任务已经结束，但没有留下通过来源校验的候选资料。</p></div>}
      {researchError ? <p className="form-error material-research-error" role="alert">{researchError}</p> : null}
      <footer><span>{researchSession?.savedMaterialId ? '已经保存为当前项目资料' : researchSession?.status === 'succeeded' ? '保存后会保留原始要求、采集时间、冲突和来源' : '结果只接受本轮联网查证得到的HTTPS来源'}</span><div><button disabled={researchBusy} onClick={() => setResearchOpen(false)}>关闭</button>{!researchSession ? <button className="primary-action" disabled={researchBusy || researchRequest.trim().length < 2} onClick={() => void startResearch()}>{researchBusy ? '正在准备Codex…' : <><Search size={14} />开始联网收集</>}</button> : researchSession.status === 'queued' || researchSession.status === 'running' ? <button disabled={researchBusy} onClick={() => void cancelResearch()}><Square size={13} />取消任务</button> : researchSession.status === 'failed' || researchSession.status === 'canceled' ? <><button disabled={researchBusy} onClick={() => { setResearchSession(null); setSelectedResearchClaimIds([]) }}>修改要求</button><button className="primary-action" disabled={researchBusy} onClick={() => void retryResearch()}><RefreshCw size={13} />{researchBusy ? '重试中…' : '按原要求重试'}</button></> : researchSession.savedMaterialId ? <button className="primary-action" onClick={() => setResearchOpen(false)}><Check size={13} />已保存</button> : <button className="primary-action" disabled={researchBusy || selectedResearchClaimIds.length === 0 || !researchTitle.trim()} onClick={() => void saveResearch()}><Save size={14} />{researchBusy ? '保存中…' : '保存为项目资料'}</button>}</div></footer>
    </section></div> : null}
    {previewMaterial ? <div className="modal-backdrop material-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPreviewMaterialId(null); setPreviewData(null) } }}><section className="material-preview-dialog" role="dialog" aria-modal="true" aria-label={`查看资料${previewMaterial.title}`}><header><div><span>{previewMaterial.role === 'brief' ? 'Brief' : '项目资料'}</span><h2>{previewMaterial.title}</h2></div><button aria-label="关闭资料预览" onClick={() => { setPreviewMaterialId(null); setPreviewData(null) }}><X size={17} /></button></header><article className={previewData ? `media-preview ${previewData.kind}` : 'material-text-preview'}>{previewData?.kind === 'image' ? <img src={previewData.dataUrl} alt={previewMaterial.title} /> : previewData?.kind === 'pdf' ? <PdfMaterialPreview dataUrl={previewData.dataUrl} title={previewMaterial.title} /> : <ReadableMarkdown content={previewMaterial.textContent ?? ''} />}</article><footer><span>{previewData ? '空格关闭预览' : `${previewMaterial.textContent?.length ?? 0}字`}</span><button onClick={() => { setPreviewMaterialId(null); setPreviewData(null) }}>关闭</button></footer></section></div> : null}
    {inputMode ? <div className="modal-backdrop material-input-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setInputMode(null) }}><section className="material-input-dialog" role="dialog" aria-modal="true" aria-label={inputMode === 'pdf' ? '导入PDF资料' : inputMode === 'text' ? '粘贴文字' : '保存网页链接'}><header><div><span>项目资料</span><h2>{inputMode === 'pdf' ? '导入并解析PDF' : inputMode === 'text' ? '粘贴文字' : '保存网页链接'}</h2></div><button aria-label="关闭资料输入" disabled={saving} onClick={() => setInputMode(null)}><X size={17} /></button></header><div className="material-input-body">{project.isCommercial ? <fieldset><legend>保存为</legend><button className={role === 'brief' ? 'selected' : ''} onClick={() => setRole('brief')}><Check size={13} />商单Brief</button><button className={role === 'project_material' ? 'selected' : ''} onClick={() => setRole('project_material')}><Check size={13} />项目资料</button></fieldset> : null}<label><span>标题·可选</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} placeholder={role === 'brief' ? '例如：新品合作Brief' : '例如：产品规格资料'} /></label>{inputMode === 'pdf' ? <><input ref={pdfInputRef} aria-label="选择PDF资料文件" className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => setPdfFile(event.currentTarget.files?.[0] ?? null)} /><button className="material-pdf-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) setPdfFile(file) }} onClick={() => pdfInputRef.current?.click()}><UploadCloud size={19} /><b>{pdfFile?.name ?? '选择或拖入PDF'}</b><small>{pdfFile ? `${Math.ceil(pdfFile.size / 1024)}KB` : '最多10MB·受限进程解析·原文件私有保存'}</small></button></> : inputMode === 'text' ? <label><span>资料文字</span><textarea autoFocus value={textContent} maxLength={400_000} onChange={(event) => setTextContent(event.currentTarget.value)} placeholder="粘贴Brief或资料正文" /></label> : <><label><span>网页链接</span><input autoFocus value={sourceUrl} maxLength={2_000} onChange={(event) => setSourceUrl(event.currentTarget.value)} placeholder="https://..." /></label><p className="material-link-notice"><AlertTriangle size={13} />这里只保存链接，不读取网页正文；仅有链接不会满足商单Brief必填。</p></>}{error ? <p className="form-error" role="alert">{error}</p> : null}</div><footer><button disabled={saving} onClick={() => setInputMode(null)}>取消</button><button className="primary-action" disabled={saving || (inputMode === 'pdf' ? !pdfFile : inputMode === 'text' ? !textContent.trim() : !sourceUrl.trim())} onClick={() => void save()}>{saving ? inputMode === 'pdf' ? '正在解析…' : '正在保存…' : inputMode === 'pdf' ? '解析并保存' : '保存'}</button></footer></section></div> : null}
    {pendingDelete ? <div className="modal-backdrop material-delete-backdrop"><section className="material-delete-dialog" role="alertdialog" aria-modal="true" aria-label="删除项目资料"><h2>删除“{pendingDelete.title}”？</h2><p>{pendingDelete.fileId ? 'App内保存的文件副本和关联记录都会删除。' : '这条资料会从项目和后续AI任务输入中移除。'}这不是隐藏操作。</p><footer><button disabled={saving} onClick={() => setPendingDeleteId(null)}>取消</button><button className="danger-action" disabled={saving} onClick={() => void remove(pendingDelete.id)}>{saving ? '正在删除…' : '确认删除'}</button></footer></section></div> : null}
  </section>
}

function ScratchNoteEditor({ projectId, noteId, initialTitle, initialMarkdown, onNotice, onSaved, onClose }: { projectId: string; noteId: string | null; initialTitle: string; initialMarkdown: string; onNotice(message: string): void; onSaved(): void; onClose(): void }): React.JSX.Element {
  const [currentNoteId, setCurrentNoteId] = useState(noteId)
  const [title, setTitle] = useState(initialTitle)
  const [savedTitle, setSavedTitle] = useState(initialTitle)
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [fullScreen, setFullScreen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [closeArmed, setCloseArmed] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const changed = markdown !== savedMarkdown || title !== savedTitle
  const save = useCallback(async (): Promise<void> => {
    if (!window.creatorOS || saving || !markdown.trim()) return
    setSaving(true); setError('')
    try {
      const saved = await window.creatorOS.saveProjectScratchNote(projectId, currentNoteId, title, markdown)
      setCurrentNoteId(saved.id); setSavedTitle(saved.title); setSavedMarkdown(markdown); setCloseArmed(false); onSaved(); onNotice('随手笔记已保存；生成时可按需勾选')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '随手笔记保存失败') }
    finally { setSaving(false) }
  }, [currentNoteId, markdown, onNotice, onSaved, projectId, saving, title])
  const requestClose = (): void => {
    if (!changed || closeArmed) { onClose(); return }
    setCloseArmed(true); setError('还有未保存修改；再次关闭会放弃这些修改')
  }
  useEffect(() => {
    textareaRef.current?.focus()
    const shortcut = (event: KeyboardEvent): void => {
      if (event.metaKey && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
      else if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [save]) // eslint-disable-line react-hooks/exhaustive-deps
  const previewLines = markdown.split('\n')
  return <div className={fullScreen ? 'framework-editor-layer' : 'scratch-note-editor-inline'}><section className="framework-editor" role={fullScreen ? 'dialog' : undefined} aria-modal={fullScreen ? 'true' : undefined} aria-label="随手笔记Markdown编辑器"><header><label><span className="visually-hidden">随手笔记标题</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.currentTarget.value)} /></label><nav aria-label="随手笔记显示模式"><button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}><FilePenLine size={14} />编辑</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}><Eye size={14} />预览</button><button onClick={() => setFullScreen((value) => !value)}><Maximize2 size={14} />{fullScreen ? '退出全屏' : '全屏'}</button></nav><button aria-label="关闭随手笔记" onClick={requestClose}><X size={17} /></button></header><main>{mode === 'edit' ? <textarea ref={textareaRef} aria-label="随手笔记Markdown" value={markdown} maxLength={400_000} onChange={(event) => { setMarkdown(event.currentTarget.value); setCloseArmed(false); setError('') }} placeholder={'# 先随便记\n\n- 没有固定顺序\n- 想到什么先扔进来\n- 之后生成时再勾选'} /> : <article className="framework-markdown-preview">{previewLines.map((line, index) => line.startsWith('### ') ? <h4 key={index}>{line.slice(4)}</h4> : line.startsWith('## ') ? <h3 key={index}>{line.slice(3)}</h3> : line.startsWith('# ') ? <h2 key={index}>{line.slice(2)}</h2> : /^\s*[-*]\s+/.test(line) ? <p className="markdown-list-item" key={index}>{line.replace(/^\s*[-*]\s+/, '')}</p> : line.trim() ? <p key={index}>{line}</p> : <br key={index} />)}</article>}</main><footer><span>{markdown.length}字{changed ? '·未保存' : '·已保存'}·⌘S保存</span>{error ? <p role="alert">{error}</p> : null}<button disabled={saving || !changed || !title.trim() || !markdown.trim()} className="primary-action" onClick={() => void save()}><Save size={14} />{saving ? '保存中…' : '保存笔记'}</button></footer></section></div>
}

function OutlinePanel({ project, items, templates, parentVersionIds, outlineDocumentId, outlineDocumentName, setItems, setParentVersionIds, setOutlineDocumentName, onSelectOutline, onCreateOutline, onNotice, onSave, onImport, onApply, onDelete }: {
  project: ProjectDetail; items: { id: string; text: string }[]; templates: OutlineTemplateView[]; parentVersionIds: string[]; outlineDocumentId: string; outlineDocumentName: string;
  setItems(value: { id: string; text: string }[]): void; setParentVersionIds(value: string[]): void; setOutlineDocumentName(value: string): void;
  onSelectOutline(document: OutlineDocumentView): void; onCreateOutline(): void; onNotice(message: string): void;
  onSave(): void; onImport(): void; onApply(template: OutlineTemplateView): void; onDelete(resourceId: string): void
}): React.JSX.Element {
  const providerCapabilities = useWorkspaceStore((state) => state.snapshot.providerCapabilities)
  const tasks = useWorkspaceStore((state) => state.snapshot.tasks)
  const refresh = useWorkspaceStore((state) => state.refresh)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [generationOpen, setGenerationOpen] = useState(false)
  const [preparation, setPreparation] = useState<TaskResourcePreparation | null>(null)
  const [briefText, setBriefText] = useState('')
  const [ideas, setIdeas] = useState('')
  const [supportingMaterialIds, setSupportingMaterialIds] = useState<string[]>([])
  const [generationError, setGenerationError] = useState('')
  const [outlineMenuOpen, setOutlineMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [validating, setValidating] = useState<'codex_cli' | 'claude_cli' | null>(null)
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null
  const currentStructure = useMemo(() => ({
    name: selectedTemplate?.name ?? '当前大纲结构',
    items: (selectedTemplate?.items ?? items.map((item) => item.text)).map((item) => item.trim()).filter(Boolean)
  }), [items, selectedTemplate])
  const outlineTasks = tasks.filter((task) => task.projectId === project.id && task.taskType === 'outline_generation')
  const taskFor = (provider: 'codex_cli' | 'claude_cli') => outlineTasks.find((task) => task.provider === provider)
  const candidateFor = (kind: Extract<DraftVersion['kind'], 'codex_candidate' | 'claude_candidate'>) => project.versions.find((version) => version.documentType === 'outline' && version.kind === kind)
  const candidates = [candidateFor('claude_candidate'), candidateFor('codex_candidate')].filter((version): version is DraftVersion => Boolean(version))
  const outlineDocuments = listOutlineDocuments(project.versions)
  const hasActiveGeneration = outlineTasks.some((task) => ['queued', 'running', 'waiting_confirmation'].includes(task.status))
  const update = (id: string, text: string): void => setItems(items.map((item) => item.id === id ? { ...item, text } : item))
  const move = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
    const next = [...items]; const [moved] = next.splice(from, 1); if (!moved) return
    next.splice(to, 0, moved); setItems(next)
  }
  const openGeneration = async (): Promise<void> => {
    setGenerationOpen(true); setGenerationError(''); setSupportingMaterialIds([])
    try { setPreparation(await window.creatorOS?.prepareTaskResources(project.id) ?? null) }
    catch (reason) { setGenerationError(reason instanceof Error ? reason.message : '大纲输入核对失败') }
  }
  const validateProvider = async (provider: 'codex_cli' | 'claude_cli'): Promise<void> => {
    if (!window.creatorOS) return
    setValidating(provider); setGenerationError('')
    try { await window.creatorOS.validateProviderSecurity(provider); await refresh() }
    catch (reason) { setGenerationError(reason instanceof Error ? reason.message : 'Provider安全验证失败') }
    finally { setValidating(null) }
  }
  const startGeneration = async (): Promise<void> => {
    if (!window.creatorOS) return
    if (currentStructure.items.length === 0) { setGenerationError('请先载入模板，或在当前大纲中保留至少一项结构'); return }
    setCreating(true); setGenerationError('')
    try {
      const created = await window.creatorOS.startOutlineGeneration({ projectId: project.id, briefText, ideas, structure: currentStructure, supportingMaterialIds })
      onNotice(`已交给Codex和Claude各生成一版；${created.length}项任务已进入后台`); setGenerationOpen(false)
    } catch (reason) { setGenerationError(reason instanceof Error ? reason.message : '双模型大纲任务创建失败') }
    finally { setCreating(false) }
  }
  const applyWholeCandidate = (version: DraftVersion): void => {
    const next = parseOutline(version).map((item) => ({ id: crypto.randomUUID(), text: item.text }))
    setItems(next); setParentVersionIds([version.id]); onNotice(`已载入${version.kind === 'claude_candidate' ? 'Claude' : 'Codex'}大纲v${version.revision}；保存前不会写入新版本`)
  }
  const addCandidateItem = (version: DraftVersion, text: string): void => {
    setItems([...items, { id: crypto.randomUUID(), text }]); setParentVersionIds([...new Set([...parentVersionIds, version.id])])
    onNotice(`已把${version.kind === 'claude_candidate' ? 'Claude' : 'Codex'}的这一项加入当前大纲`)
  }
  const outlineDocumentControls = <div className="outline-document-menu-anchor"><button aria-label="管理多份大纲" aria-expanded={outlineMenuOpen} onClick={() => setOutlineMenuOpen((value) => !value)}>•••</button>{outlineMenuOpen ? <div className="outline-document-menu" role="menu"><header><b>大纲</b><button onClick={() => { onCreateOutline(); setOutlineMenuOpen(false) }}><Plus size={13} />新建大纲</button></header>{outlineDocuments.length > 1 ? <div>{outlineDocuments.map((document) => <button className={document.id === outlineDocumentId ? 'active' : ''} key={document.id} onClick={() => { onSelectOutline(document); setOutlineMenuOpen(false) }}>{document.name}</button>)}</div> : null}<label><span>当前名称</span><input value={outlineDocumentName} maxLength={120} onChange={(event) => setOutlineDocumentName(event.currentTarget.value)} /></label></div> : null}</div>
  return <section className="content-card project-module-surface outline-card"><header><div><span>直接修改，明确保存{outlineDocuments.length > 1 ? ` · ${outlineDocumentName}` : ''}</span><h2>内容大纲</h2></div><div className="module-header-actions"><button disabled={hasActiveGeneration} onClick={() => void openGeneration()}><WandSparkles size={14} />{hasActiveGeneration ? '双模型生成中…' : '从Brief和资料生成大纲'}</button>{outlineDocumentControls}<button className="primary-action" onClick={onSave}>保存为新版本</button></div></header>{project.isCommercial ? <CommercialFeedbackBlock project={project} /> : null}<div className="outline-template-library"><div><b>大纲模板</b><span>导入Word时只提取段落结构</span></div>{templates.length ? <><label><span className="visually-hidden">选择大纲模板</span><AppSelect value={selectedTemplate?.id ?? ''} onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}·{template.items.length}项</option>)}</AppSelect></label><button onClick={() => selectedTemplate && onApply(selectedTemplate)}>载入模板</button><button className="outline-template-delete" aria-label={`移除大纲模板${selectedTemplate?.name ?? ''}`} disabled={!selectedTemplate} onClick={() => selectedTemplate && onDelete(selectedTemplate.id)}><Trash2 size={14} /></button></> : <span className="outline-template-empty">还没有模板</span>}<button onClick={onImport}><FileInput size={14} />导入Word模板</button></div>{hasActiveGeneration || candidates.length ? <section className="outline-candidate-workspace" aria-label="双模型大纲候选"><header><div><b>Codex / Claude大纲候选</b><span>逐项加入或整版载入；不会覆盖当前大纲</span></div>{hasActiveGeneration ? <em>后台生成中</em> : <em>候选已就绪</em>}</header><div className="outline-candidate-grid">{(['claude_candidate', 'codex_candidate'] as const).map((kind) => { const version = candidateFor(kind); const provider = kind === 'claude_candidate' ? 'claude_cli' : 'codex_cli'; const task = taskFor(provider); const label = provider === 'claude_cli' ? 'Claude' : 'Codex'; return <article key={kind}><header><div><b>{label}</b><span>{version ? `大纲v${version.revision}` : '还没有候选'}</span></div>{task && ['queued', 'running'].includes(task.status) ? <em>{task.status === 'queued' ? '排队中' : `${task.progress}%`}</em> : task?.status === 'failed' ? <em className="failed">生成失败</em> : null}</header>{version ? <><ol>{parseOutline(version).map((item, index) => <li key={item.id}><span>{index + 1}</span><p>{item.text}</p><button onClick={() => addCandidateItem(version, item.text)}>加入</button></li>)}</ol><button className="candidate-load-all" onClick={() => applyWholeCandidate(version)}>载入{label}整版</button></> : <div className="outline-candidate-empty">{task?.status === 'failed' ? task.errorMessage ?? '可在运行任务中重试' : hasActiveGeneration ? '任务完成后会自动出现' : '点击上方生成双模型候选'}</div>}</article> })}</div></section> : null}<div className="outline-list">{items.map((item, index) => <div className={`outline-item${draggedIndex === index ? ' dragging' : ''}`} key={item.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedIndex !== null) move(draggedIndex, index); setDraggedIndex(null) }}><button className="outline-drag-handle" draggable aria-label={`移动大纲第${index + 1}项`} title="拖拽排序；聚焦后可用上下方向键" onDragStart={() => setDraggedIndex(index)} onDragEnd={() => setDraggedIndex(null)} onKeyDown={(event) => { if (event.key === 'ArrowUp') { event.preventDefault(); move(index, index - 1) } if (event.key === 'ArrowDown') { event.preventDefault(); move(index, index + 1) } }}><GripVertical size={15} /></button><span>{index + 1}</span><textarea value={item.text} onChange={(event) => update(item.id, event.currentTarget.value)} aria-label={`大纲第${index + 1}项`} /><button aria-label={`删除大纲第${index + 1}项`} onClick={() => setItems(items.filter((value) => value.id !== item.id))}><Trash2 size={15} /></button></div>)}</div><button className="add-outline" onClick={() => setItems([...items, { id: crypto.randomUUID(), text: '' }])}><Plus size={15} />新增一项</button>{generationOpen ? <OutlineGenerationDialog project={project} preparation={preparation} structure={currentStructure} providerCapabilities={providerCapabilities} briefText={briefText} ideas={ideas} supportingMaterialIds={supportingMaterialIds} creating={creating} validating={validating} error={generationError} onBriefText={setBriefText} onIdeas={setIdeas} onToggleSupportingMaterial={(id) => setSupportingMaterialIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])} onValidate={(provider) => void validateProvider(provider)} onClose={() => !creating && setGenerationOpen(false)} onStart={() => void startGeneration()} /> : null}</section>
}

function OutlineGenerationDialog({ project, preparation, structure, providerCapabilities, briefText, ideas, supportingMaterialIds, creating, validating, error, onBriefText, onIdeas, onToggleSupportingMaterial, onValidate, onClose, onStart }: {
  project: ProjectDetail; preparation: TaskResourcePreparation | null; structure: { name: string; items: string[] };
  providerCapabilities: ReturnType<typeof useWorkspaceStore.getState>['snapshot']['providerCapabilities']; briefText: string; ideas: string; creating: boolean;
  supportingMaterialIds: string[];
  validating: 'codex_cli' | 'claude_cli' | null; error: string; onBriefText(value: string): void; onIdeas(value: string): void;
  onToggleSupportingMaterial(id: string): void;
  onValidate(provider: 'codex_cli' | 'claude_cli'): void; onClose(): void; onStart(): void
}): React.JSX.Element {
  const required = (key: string) => preparation?.requiredInputs.find((item) => item.key === key)
  const providers = (['codex_cli', 'claude_cli'] as const).map((provider) => providerCapabilities.find((item) => item.provider === provider))
  const bothAvailable = providers.every((provider) => provider?.available)
  const briefReady = !project.isCommercial || Boolean(briefText.trim()) || required('commercial_brief')?.status === 'included'
  const inputStatus = (key: string): string => { const item = required(key); return item?.status === 'included' ? `${item.items.length}条` : item?.status === 'not_applicable' ? '本次无需' : item?.status === 'empty' ? '仅链接，待补正文' : '待补' }
  return <div className="modal-backdrop outline-generation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) onClose() }}><section className="outline-generation-dialog" role="dialog" aria-modal="true" aria-label="生成Codex和Claude大纲"><header><div><span>双模型大纲</span><h2>确认本次输入</h2></div><button aria-label="关闭大纲生成" disabled={creating} onClick={onClose}><X size={17} /></button></header><div className="outline-generation-body"><section className="outline-input-summary"><header><b>固定项目上下文</b><span>主要参考优先；其余资料由你选择</span></header><div><span>项目说明<b>{inputStatus('project_description')}</b></span><span>主要参考<b>{preparation?.primaryReferences.length ?? 0}条</b></span><span>Brief<b className={briefReady ? '' : 'missing'}>{briefText.trim() ? '本次已粘贴' : inputStatus('commercial_brief')}</b></span><span>结构<b>{structure.name}·{structure.items.length}项</b></span></div></section>{preparation?.supportingMaterials.length ? <section className="outline-supporting-materials"><header><b>补充参与本次生成</b><span>不选也不会自动带入</span></header><div>{preparation.supportingMaterials.map((material) => <label key={material.id}><input type="checkbox" checked={supportingMaterialIds.includes(material.id)} onChange={() => onToggleSupportingMaterial(material.id)} /><span><b>{material.title}</b><small>{material.kind === 'real_experience' ? '真实体验' : material.kind === 'scratch_note' ? '随手笔记' : '项目资料'}</small></span></label>)}</div></section> : null}<div className="outline-generation-fields"><label><span>本次补充资料{project.isCommercial ? '·资料中已有Brief时可留空' : '·可选'}</span><textarea value={briefText} maxLength={40_000} onChange={(event) => onBriefText(event.currentTarget.value)} placeholder={project.isCommercial ? '临时补充不会写回资料；长期使用的Brief请先在资料模块保存' : '有本次临时补充可粘贴在这里'} /></label><label><span>你自己的想法与必讲重点</span><textarea value={ideas} maxLength={40_000} onChange={(event) => onIdeas(event.currentTarget.value)} placeholder="例如：开头先说真实结论，重点讲我实际遇到的问题" /></label></div><section className="outline-provider-pair"><header><b>调用方式</b><span>使用本机已登录的CLI，不需API key</span></header><div>{(['codex_cli', 'claude_cli'] as const).map((provider) => { const capability = providerCapabilities.find((item) => item.provider === provider); const label = provider === 'codex_cli' ? 'Codex' : 'Claude'; return <article className={capability?.available ? 'available' : ''} key={provider}><span><b>{label}</b><small>{capability?.detail ?? '未检测'}</small></span>{capability?.available ? <em><Check size={13} />可用</em> : capability?.status === 'not_installed' ? <em>未安装</em> : <button disabled={Boolean(validating)} onClick={() => onValidate(provider)}>{validating === provider ? '验证中…' : '安全验证'}</button>}</article> })}</div><p><AlertTriangle size={13} />本机CLI不等于本地模型：上述已确认内容会发送到Codex和Claude的云端模型，不会带入工具输出或未选文件。</p></section>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><footer><span>候选只会新建版本，不覆盖当前大纲。</span><button disabled={creating} onClick={onClose}>取消</button><button className="primary-action" disabled={creating || !preparation || !bothAvailable || !briefReady || structure.items.length === 0} onClick={onStart}>{creating ? '正在创建两项任务…' : '交给Codex和Claude'}</button></footer></section></div>
}

function SubtitleTaskFlow({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  const tasks = useWorkspaceStore((state) => state.snapshot.tasks)
  const [busy, setBusy] = useState(false)
  const [targetPlatform, setTargetPlatform] = useState(project.platformTargets[0] ?? 'B站')
  const latestJob = project.subtitleJobs[0] ?? null
  const task = latestJob ? tasks.find((item) => item.id === latestJob.taskId) : null
  const latestZhJob = project.subtitleJobs.find((job) => job.schema === 'zh') ?? null
  const confirmedZhJob = latestZhJob?.confirmedZhArtifactId ? latestZhJob : null
  const platforms = [...new Set([...project.platformTargets, 'B站', '小红书', 'YouTube'])]
  const youtubeSelected = targetPlatform === 'YouTube'
  const start = async (targetSchema: 'zh' | 'bilingual'): Promise<void> => {
    if (!window.creatorOS) return
    setBusy(true)
    try {
      const created = await window.creatorOS.startSubtitleGeneration(project.id, targetSchema, targetSchema === 'bilingual' ? confirmedZhJob?.id : undefined)
      if (created) {
        onNotice(targetSchema === 'bilingual' ? '已复用确认过的中文字幕与原音视频，开始生成YouTube中英ASS' : '中文字幕任务已进入后台；原视频或音频只会读取，不会被修改')
        onChanged()
      }
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '字幕任务启动失败') }
    finally { setBusy(false) }
  }
  const confirmZh = async (artifactId: string): Promise<void> => {
    try { await window.creatorOS?.confirmSubtitleArtifact(project.id, artifactId); onNotice('中文字幕已确认；选择YouTube后可继续生成中英ASS'); onChanged() }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '中文字幕确认失败') }
  }
  const applyArtifact = async (artifactId: string): Promise<void> => {
    try { await window.creatorOS?.useSubtitleArtifact(project.id, artifactId, targetPlatform); onNotice(`已把字幕用于${targetPlatform}发布包`); onChanged() }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '字幕加入发布包失败') }
  }
  const artifactLabels = { zh_srt: '中文字幕SRT', bilingual_srt: '中英双语SRT', bilingual_ass: '中英双语ASS', plain_transcript: '无标点字幕稿' } as const
  const progressLabel = task?.status === 'running' ? `${task.progress}%` : task?.status === 'queued' ? '排队中' : task?.status === 'failed' ? '失败·可在运行任务中重试' : latestJob?.artifacts.length ? '已完成' : '尚未启动'
  const subtitleStages = ['转写', '校对', '分行', '时间码']
  const subtitleDone = (latestJob?.artifacts.length ?? 0) > 0
  const subtitleRunning = task?.status === 'running'
  const subtitleActive = subtitleDone ? subtitleStages.length : subtitleRunning ? Math.min(subtitleStages.length - 1, Math.floor((task?.progress ?? 0) / 25)) : -1
  return <article className="production-task-flow subtitle-task-flow"><header><span className="production-icon"><Captions size={19} /></span><div><h3>字幕</h3><p>先生成并确认中文字幕；只有选择YouTube时，才复用同一音视频继续生成中英ASS。</p></div><em className={`subtitle-skill-status${latestJob?.artifacts.length ? ' ready' : ''}`}>{latestJob?.artifacts.length ? <Check size={12} /> : <Captions size={12} />}{latestJob?.artifacts.length ? '本机产物已就绪' : '本机离线执行'}</em></header><div className="subtitle-body"><button className="task-dropzone" disabled={busy || ['queued', 'running'].includes(task?.status ?? '')} onClick={() => void start('zh')}><FileVideo size={18} /><b>{latestJob?.inputFileName ?? (busy ? '正在打开文件选择…' : '选择视频或音频')}</b><small>生成中文字幕SRT与无标点字幕稿 · 文件留在本机</small></button><div className={`subtitle-progress${task?.status === 'failed' ? ' failed' : ''}`}><span className="progress-label">后台任务</span><ol className="progress-steps">{subtitleStages.map((name, index) => <li key={name} className={subtitleDone || index < subtitleActive ? 'done' : subtitleRunning && index === subtitleActive ? 'current' : ''}>{name}</li>)}</ol><span className="progress-status">{progressLabel}</span></div>{task?.errorMessage ? <small className="production-task-error">{task.errorMessage}</small> : null}<div className="subtitle-products"><div className="subtitle-products-head"><span>产物与异常</span><label className="subtitle-platform-select">用于平台<AppSelect value={targetPlatform} onChange={(event) => setTargetPlatform(event.currentTarget.value)}>{platforms.map((item) => <option key={item}>{item}</option>)}</AppSelect></label></div>{youtubeSelected ? <div className="subtitle-style-preset"><span><b>中文</b>苹方Semibold 52pt·纯白·阴影3 / 315° / 模糊8</span><span><b>英文</b>Avenir Next Demi Bold 31pt·纯白·较轻阴影</span><button className="primary-action" disabled={!confirmedZhJob || busy || ['queued', 'running'].includes(task?.status ?? '')} onClick={() => void start('bilingual')}>{confirmedZhJob ? '生成YouTube中英ASS' : '先确认中文字幕'}</button></div> : null}<div className="subtitle-output-list">{latestJob?.artifacts.map((artifact) => <div className="subtitle-output-item" key={artifact.id}><button onClick={() => void window.creatorOS?.revealSubtitleArtifact(project.id, artifact.id)}><Download size={13} />{artifactLabels[artifact.artifactKind]}</button>{artifact.artifactKind === 'zh_srt' && latestJob.schema === 'zh' ? <button className={latestJob.confirmedZhArtifactId === artifact.id ? 'confirmed' : ''} disabled={latestJob.confirmedZhArtifactId === artifact.id} onClick={() => void confirmZh(artifact.id)}>{latestJob.confirmedZhArtifactId === artifact.id ? '已确认' : '确认中文字幕'}</button> : null}{artifact.artifactKind !== 'plain_transcript' ? <button onClick={() => void applyArtifact(artifact.id)}>用于发布</button> : null}</div>) ?? null}</div>{latestJob?.artifacts.length ? latestJob.anomalies.length ? <div className="subtitle-anomaly-list"><b>{latestJob.anomalies.length}处建议确认</b>{latestJob.anomalies.slice(0, 4).map((item) => <span key={item.segmentIndex}>{Math.floor(item.start / 60)}:{String(Math.floor(item.start % 60)).padStart(2, '0')}·{item.text}</span>)}</div> : <div className="anomaly-empty"><Check size={14} /><span>没有发现需要上浮的低置信片段。</span></div> : <div className="anomaly-empty"><Check size={14} /><span>任务完成后会在这里提供中文字幕与无标点字幕稿。</span></div>}</div></div></article>
}

function CoverTaskFlow({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  const tasks = useWorkspaceStore((state) => state.snapshot.tasks)
  const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
  const [layout, setLayout] = useState<'bilibili_landscape' | 'xiaohongshu_portrait'>('bilibili_landscape')
  const [mode, setMode] = useState<'ai_finished' | 'stable_layers'>('stable_layers')
  const [count, setCount] = useState(5)
  const [headline, setHeadline] = useState(project.title.slice(0, 40))
  const [groupNote, setGroupNote] = useState('')
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generatingHeadlines, setGeneratingHeadlines] = useState(false)
  const platform = layout === 'bilibili_landscape' ? 'B站' : '小红书'
  const imageLinks = project.assetLinks.filter((link) => link.fileKind === 'file' && link.mimeType.startsWith('image/') && link.availability === 'available')
  const candidates = project.coverCandidates.filter((candidate) => candidate.layout === layout && candidate.platform === platform)
  const activeTask = tasks.find((task) => task.projectId === project.id && task.taskType === 'image_generation' && ['queued', 'running'].includes(task.status))
  const activeTitleTask = tasks.find((task) => task.projectId === project.id && task.taskType === 'title_generation' && ['queued', 'running'].includes(task.status))
  const headlineCandidates = [...new Map(project.titleCandidates.filter((candidate) => ['主标题', platform].includes(candidate.platform) && candidate.coverText.trim()).map((candidate) => [candidate.coverText, candidate])).values()]
  useEffect(() => {
    const missing = candidates.filter((candidate) => !previews[candidate.id])
    if (!window.creatorOS || !missing.length) return
    let active = true
    void Promise.all(missing.map(async (candidate) => [candidate.id, await window.creatorOS!.getCoverCandidatePreview(project.id, candidate.id)] as const)).then((items) => {
      if (active) setPreviews((current) => ({ ...current, ...Object.fromEntries(items) }))
    }).catch(() => undefined)
    return () => { active = false }
  }, [candidates, previews, project.id])
  useEffect(() => {
    if (!previewId) return
    const navigatePreview = (direction: -1 | 1): void => {
      const index = candidates.findIndex((candidate) => candidate.id === previewId)
      const next = candidates[(index + direction + candidates.length) % candidates.length]
      if (next) setPreviewId(next.id)
    }
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === ' ') { event.preventDefault(); setPreviewId(null) }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); navigatePreview(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); navigatePreview(1) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [candidates, previewId])
  const generate = async (batchCount = count): Promise<void> => {
    if (!window.creatorOS || !finalVersion) return
    setBusy(true)
    try {
      const created = await window.creatorOS.startCoverGeneration({ projectId: project.id, platform, layout, generationMode: mode, batchCount, headline, materialLinkIds: selectedMaterialIds, groupNote })
      onNotice(`已创建${created.length}项后台任务；封面完成后会自动出现在候选区`); onChanged()
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '封面任务启动失败') }
    finally { setBusy(false) }
  }
  const generateHeadlines = async (): Promise<void> => {
    if (!window.creatorOS || !finalVersion) return
    setGeneratingHeadlines(true)
    try {
      await window.creatorOS.startTitleGeneration(project.id, '主标题', { mode: 'master' })
      onNotice('已生成20条主标题与封面文字候选；完成后在下方挑选'); onChanged()
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '封面文字候选生成失败') }
    finally { setGeneratingHeadlines(false) }
  }
  const selectCandidate = async (candidateId: string): Promise<void> => {
    try { await window.creatorOS?.selectCoverCandidate(project.id, candidateId); onNotice(`已选为${platform}发布封面`); onChanged() }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '封面选择失败') }
  }
  return <article className="production-task-flow cover-task-flow"><header><span className="production-icon"><ImageIcon size={19} /></span><div><h3>封面</h3><p>稳定图层在本机排版；AI成品只开放无Shell的Codex图像工具，再叠加可控文字层。</p></div></header>{finalVersion ? <div className="prerequisite-notice ready"><Check size={14} />引用定稿v{finalVersion.revision}；更换定稿后，旧候选会显示“基于旧稿”。</div> : <div className="prerequisite-notice warning"><AlertTriangle size={14} />请先在“文案”中保存并设为定稿。</div>}<div className="cover-settings"><label>平台版式<AppSelect value={layout} onChange={(event) => setLayout(event.currentTarget.value as typeof layout)}><option value="bilibili_landscape">B站4:3横版</option><option value="xiaohongshu_portrait">小红书3:4竖版</option></AppSelect></label><label>生成模式<AppSelect value={mode} onChange={(event) => setMode(event.currentTarget.value as typeof mode)}><option value="stable_layers">稳定图层</option><option value="ai_finished">AI成品·Codex</option></AppSelect></label><label>每批张数<AppSelect value={count} onChange={(event) => setCount(Number(event.currentTarget.value))}><option value="1">1张</option><option value="2">2张</option><option value="3">3张</option><option value="4">4张</option><option value="5">5张</option></AppSelect></label><label>风格备注<input value={groupNote} maxLength={2000} onChange={(event) => setGroupNote(event.currentTarget.value)} placeholder="可选" /></label></div><div className="cover-headline"><div className="cover-headline-head"><b>封面文字</b><button disabled={!finalVersion || generatingHeadlines || Boolean(activeTitleTask)} onClick={() => void generateHeadlines()}>{generatingHeadlines || activeTitleTask ? '生成中…' : 'AI 生成候选'}</button></div><input value={headline} maxLength={40} onChange={(event) => setHeadline(event.currentTarget.value)} placeholder="AI 生成或自己填，短而醒目" />{headlineCandidates.length ? <div className="cover-headline-candidates">{headlineCandidates.map((candidate) => <button key={candidate.id} className={headline === candidate.coverText ? 'active' : ''} onClick={() => setHeadline(candidate.coverText)}>{candidate.coverText}<small>{candidate.provider === 'codex_cli' ? 'Codex' : 'Claude'}·{candidate.angle}</small></button>)}</div> : <p className="cover-headline-hint">{finalVersion ? '点“AI 生成候选”，像标题一样给你几条封面文字；也可直接手填。' : '生成候选需先在“文案”设为定稿；也可直接手填。'}</p>}</div>{imageLinks.length ? <div className="cover-material-picker"><b>本期图片参考·可多选</b>{imageLinks.slice(0, 12).map((link) => <label key={link.id}><input type="checkbox" checked={selectedMaterialIds.includes(link.id)} onChange={(event) => setSelectedMaterialIds(event.currentTarget.checked ? [...selectedMaterialIds, link.id] : selectedMaterialIds.filter((id) => id !== link.id))} />{link.fileName}</label>)}</div> : null}{mode === 'ai_finished' ? <div className="prerequisite-notice warning"><AlertTriangle size={14} />AI成品每张都会消耗模型用量；任务不能使用Shell、读取项目目录或调用其他工具。</div> : null}<div className="cover-candidates"><header><b>{platform}候选</b><span>{activeTask ? `${activeTask.status === 'queued' ? '排队中' : `${activeTask.progress}%`}` : `${candidates.length}张`}</span></header><div className="cover-empty-grid">{candidates.length ? candidates.map((candidate) => <article className={`${candidate.isSelected ? 'selected' : ''}${finalVersion && candidate.sourceVersionId !== finalVersion.id ? ' stale' : ''}`} key={candidate.id}><button className="cover-preview-button" title="点按或按空格预览" onClick={() => setPreviewId(candidate.id)}>{previews[candidate.id] ? <img src={previews[candidate.id]} alt={`${platform}封面候选`} /> : <ImageIcon size={20} />}</button><footer><span>{candidate.isSelected ? '当前封面' : finalVersion && candidate.sourceVersionId !== finalVersion.id ? '基于旧稿' : candidate.generationMode === 'ai_finished' ? 'AI成品' : '稳定图层'}</span><div><button disabled={busy || Boolean(activeTask)} onClick={() => void generate(1)}>重生成</button><button onClick={() => void selectCandidate(candidate.id)}>{candidate.isSelected ? '已选择' : '选择'}</button></div></footer></article>) : Array.from({ length: count }, (_, index) => <div key={index}><ImageIcon size={20} /><span>候选{String.fromCharCode(65 + index)}</span></div>)}</div><footer><button className="primary-action" disabled={!finalVersion || busy || Boolean(activeTask) || !headline.trim()} onClick={() => void generate()}><Sparkles size={14} />{busy || activeTask ? '生成中…' : `生成${count}张候选`}</button></footer></div>{previewId && previews[previewId] ? <div className="modal-backdrop cover-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewId(null) }}><section className="cover-preview-dialog" role="dialog" aria-modal="true" aria-label="封面大图预览"><button aria-label="关闭预览" onClick={() => setPreviewId(null)}><X size={16} /></button><img src={previews[previewId]} alt="封面候选大图" /><small>← →切换·空格或Esc关闭</small></section></div> : null}</article>
}

function ProductionPanel({ project, mode = 'production', onNotice }: { project: ProjectDetail; mode?: 'production' | 'shooting' | 'editing'; onNotice(message: string): void }): React.JSX.Element {
  const [notes, setNotes] = useState<ProjectProductionNotes | null>(null)
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState(false)
  const [shootingOrder, setShootingOrder] = useState<'manual' | 'time'>('manual')
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [dateEditor, setDateEditor] = useState<{ anchor: HTMLElement; itemIds: string[] } | null>(null)
  const [itemMenu, setItemMenu] = useState<{ anchor: HTMLElement; anchorPoint: { x: number; y: number }; itemIds: string[] } | null>(null)
  const [deleteItemIds, setDeleteItemIds] = useState<string[]>([])
  const [selectionRect, setSelectionRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const shootingItemsRef = useRef<HTMLDivElement>(null)
  const selectionDragRef = useRef<{ x: number; y: number; additive: boolean; initial: Set<string> } | null>(null)
  const today = useWorkspaceStore((state) => state.snapshot.today)
  useEffect(() => {
    let active = true
    void window.creatorOS?.getProjectProductionNotes(project.id)
      .then((value) => { if (active) setNotes(value) })
      .catch((reason) => onNotice(reason instanceof Error ? reason.message : '制作记录读取失败'))
    return () => { active = false }
  }, [project.id, onNotice])
  const persist = async (next: Pick<ProjectProductionNotes, 'shootingItems' | 'editingNotes' | 'editingNotesFormat'>, message?: string): Promise<void> => {
    if (!window.creatorOS) return
    setSaving(true)
    try {
      const saved = await window.creatorOS.setProjectProductionNotes(project.id, { ...next, scope: mode === 'production' ? undefined : mode })
      setNotes(saved)
      if (message) onNotice(message)
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : '制作记录保存失败') }
    finally { setSaving(false) }
  }
  const addItem = (): void => {
    if (!notes || !newItem.trim()) return
    const shootingItems = [...notes.shootingItems, { id: crypto.randomUUID(), text: newItem.trim(), completed: false, scheduleDate: null, scheduleSegment: null }]
    setNewItem('')
    void persist({ shootingItems, editingNotes: notes.editingNotes, editingNotesFormat: notes.editingNotesFormat })
  }
  const saveItems = (shootingItems: ProjectProductionNotes['shootingItems'], message?: string): Promise<void> => {
    if (!notes) return Promise.resolve()
    return persist({ shootingItems, editingNotes: notes.editingNotes, editingNotesFormat: notes.editingNotesFormat }, message)
  }
  const updateScheduledItems = (itemIds: string[], patch: { scheduleDate?: string | null; scheduleSegment?: ProjectProductionNotes['shootingItems'][number]['scheduleSegment'] }): void => {
    if (!notes) return
    const ids = new Set(itemIds)
    const shootingItems = notes.shootingItems.map((item) => {
      if (!ids.has(item.id)) return item
      const scheduleDate = patch.scheduleDate !== undefined ? patch.scheduleDate : item.scheduleDate
      const scheduleSegment = scheduleDate
        ? patch.scheduleSegment !== undefined ? patch.scheduleSegment : item.scheduleSegment
        : null
      return { ...item, scheduleDate, scheduleSegment }
    })
    setNotes({ ...notes, shootingItems })
    void saveItems(shootingItems)
  }
  const toggleSelection = (itemId: string, additive = true): void => {
    setSelectedItemIds((current) => {
      if (!additive) return new Set([itemId])
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }
  const beginSelection = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,textarea,select')) return
    const container = shootingItemsRef.current
    if (!container) return
    const bounds = container.getBoundingClientRect()
    selectionDragRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      additive: event.metaKey || event.ctrlKey,
      initial: new Set(selectedItemIds)
    }
    setItemMenu(null)
    setSelectionRect({ left: selectionDragRef.current.x, top: selectionDragRef.current.y, width: 0, height: 0 })
  }
  const moveSelection = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = selectionDragRef.current
    const container = shootingItemsRef.current
    if (!drag || !container) return
    const bounds = container.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const rect = { left: Math.min(drag.x, x), top: Math.min(drag.y, y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) }
    setSelectionRect(rect)
    if (rect.width < 3 && rect.height < 3) return
    if (!container.hasPointerCapture(event.pointerId)) container.setPointerCapture(event.pointerId)
    event.preventDefault()
    const next = drag.additive ? new Set(drag.initial) : new Set<string>()
    container.querySelectorAll<HTMLElement>('[data-shooting-item-id]').forEach((row) => {
      const rowBounds = row.getBoundingClientRect()
      const rowRect = { left: rowBounds.left - bounds.left, top: rowBounds.top - bounds.top, right: rowBounds.right - bounds.left, bottom: rowBounds.bottom - bounds.top }
      if (rect.left < rowRect.right && rect.left + rect.width > rowRect.left && rect.top < rowRect.bottom && rect.top + rect.height > rowRect.top) {
        const itemId = row.dataset.shootingItemId
        if (itemId) next.add(itemId)
      }
    })
    setSelectedItemIds(next)
  }
  const endSelection = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = selectionDragRef.current
    if (!drag) return
    if ((selectionRect?.width ?? 0) < 3 && (selectionRect?.height ?? 0) < 3 && !drag.additive) setSelectedItemIds(new Set())
    selectionDragRef.current = null
    setSelectionRect(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (!notes) return <section className="content-card project-module-surface production-workspace"><div className="loading-state">正在读取制作记录…</div></section>
  const visibleShootingItems = shootingOrder === 'manual'
    ? notes.shootingItems
    : [...notes.shootingItems].sort((left, right) => {
      if (left.scheduleDate !== right.scheduleDate) return (left.scheduleDate ?? '9999-99-99').localeCompare(right.scheduleDate ?? '9999-99-99')
      return shootingSegmentOrder[left.scheduleSegment ?? 'evening'] - shootingSegmentOrder[right.scheduleSegment ?? 'evening']
    })
  const dateEditorItem = dateEditor ? notes.shootingItems.find((item) => dateEditor.itemIds.includes(item.id)) : null
  return <><section className="content-card project-module-surface production-workspace"><header><div><span>制作记录</span><h2>{moduleLabels[mode]}</h2><span className="visually-hidden" role="heading" aria-level={3}>AI视频制作</span></div><small>{saving ? '保存中…' : `最近保存${new Date(notes.updatedAt).toLocaleString('zh-CN')}`}</small></header><div className={`production-simple-grid production-mode-${mode}`}>
    {mode !== 'editing' ? <article className="shooting-checklist">
      <header><div><FileVideo size={17} /><b>拍摄待办</b></div><div className="shooting-selection-actions"><div className="shooting-order-switch" role="group" aria-label="拍摄待办排列方式"><button className={shootingOrder === 'manual' ? 'active' : ''} aria-pressed={shootingOrder === 'manual'} onClick={() => setShootingOrder('manual')}>默认</button><button className={shootingOrder === 'time' ? 'active' : ''} aria-pressed={shootingOrder === 'time'} onClick={() => setShootingOrder('time')}>按时间</button></div><span>{notes.shootingItems.filter((item) => item.completed).length}/{notes.shootingItems.length}</span></div></header>
      <div className="shooting-add-row"><input value={newItem} maxLength={500} placeholder="例如：周六去公园拍外景" onChange={(event) => setNewItem(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem() } }} /><button disabled={!newItem.trim()} onClick={addItem}><Plus size={13} />添加</button></div>
      {selectedItemIds.size && !selectionRect ? <div className="shooting-batch-bar" role="toolbar" aria-label="批量设置拍摄待办">
        <span>已选{selectedItemIds.size}条</span>
        <button onClick={(event) => setDateEditor({ anchor: event.currentTarget, itemIds: [...selectedItemIds] })}><CalendarDays size={12} />批量设置时间</button>
        <button onClick={() => void saveItems(notes.shootingItems.map((item) => selectedItemIds.has(item.id) ? { ...item, completed: true } : item), '所选待办已完成')}>完成</button>
        <button onClick={() => void saveItems(notes.shootingItems.map((item) => selectedItemIds.has(item.id) ? { ...item, completed: false } : item), '已取消所选待办完成状态')}>取消完成</button>
        <button className="danger" onClick={() => setDeleteItemIds([...selectedItemIds])}><Trash2 size={11} />删除</button>
      </div> : null}
      <div className="shooting-items" ref={shootingItemsRef} onPointerDown={beginSelection} onPointerMove={moveSelection} onPointerUp={endSelection} onPointerCancel={endSelection}>
        {selectionRect ? <i className="shooting-selection-rect" style={selectionRect} /> : null}
        {visibleShootingItems.map((item, index) => <Fragment key={item.id}>
        {shootingOrder === 'time' && (index === 0 || visibleShootingItems[index - 1]?.scheduleDate !== item.scheduleDate) ? <p className="shooting-day-divider">{shootingDateLabel(item.scheduleDate, today)}</p> : null}
        <div
        className={`${item.completed ? 'completed' : ''}${selectedItemIds.has(item.id) ? ' selected' : ''}`}
        data-shooting-item-id={item.id}
        onClick={(event) => { if (event.metaKey || event.ctrlKey) { event.preventDefault(); toggleSelection(item.id) } }}
        onContextMenu={(event) => {
          event.preventDefault()
          const itemIds = selectedItemIds.has(item.id) ? [...selectedItemIds] : [item.id]
          if (!selectedItemIds.has(item.id)) setSelectedItemIds(new Set([item.id]))
          setItemMenu({ anchor: event.currentTarget, anchorPoint: { x: event.clientX, y: event.clientY }, itemIds })
        }}
      >
        <button className="shooting-complete-button" aria-label={item.completed ? '取消完成' : '标记完成'} onClick={(event) => { event.stopPropagation(); void saveItems(notes.shootingItems.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry)) }}>{item.completed ? <Check size={9} strokeWidth={2.8} /> : null}</button>
        <div className="shooting-item-copy"><input value={item.text} onChange={(event) => setNotes({ ...notes, shootingItems: notes.shootingItems.map((entry) => entry.id === item.id ? { ...entry, text: event.currentTarget.value } : entry) })} onBlur={() => void saveItems(notes.shootingItems)} /><button className={item.scheduleDate ? 'scheduled' : ''} onClick={(event) => { event.stopPropagation(); setDateEditor({ anchor: event.currentTarget, itemIds: [item.id] }) }}><CalendarDays size={11} />{item.scheduleDate ? `${Number(item.scheduleDate.slice(5, 7))}月${Number(item.scheduleDate.slice(8, 10))}日${item.scheduleSegment ? stageSegmentLabels[item.scheduleSegment] : ''}` : '设置日期'}</button></div>
        <button className="danger" aria-label="删除拍摄待办" onClick={(event) => { event.stopPropagation(); setDeleteItemIds([item.id]) }}><Trash2 size={12} /></button>
      </div></Fragment>)}</div>
      {!notes.shootingItems.length ? <p>还没有拍摄待办，从上面添加第一条。</p> : null}
    </article> : null}
    {mode !== 'shooting' ? <article className="editing-memo"><header><div><FilePenLine size={17} /><b>剪辑备忘录</b></div></header><ProductionMemoEditor value={notes.editingNotes} format={notes.editingNotesFormat} saving={saving} onChange={(editingNotes, editingNotesFormat) => setNotes({ ...notes, editingNotes, editingNotesFormat })} onSave={(editingNotes, editingNotesFormat) => persist({ shootingItems: notes.shootingItems, editingNotes, editingNotesFormat }, '剪辑备忘录已保存')} /></article> : null}
  </div></section>
  {dateEditor ? <AnchoredPopover anchor={dateEditor.anchor} ariaLabel="设置拍摄待办时间" className="shooting-date-editor" onDismiss={() => setDateEditor(null)}><header><b>{dateEditor.itemIds.length > 1 ? `批量设置${dateEditor.itemIds.length}条待办` : '设置待办时间'}</b><button aria-label="关闭时间设置" onClick={() => setDateEditor(null)}><X size={12} /></button></header><CalendarDatePicker label="预计日期" today={today} value={dateEditorItem?.scheduleDate ?? null} onChange={(scheduleDate) => updateScheduledItems(dateEditor.itemIds, { scheduleDate })} /><div className="stage-segment-options">{(['morning', 'afternoon', 'evening'] as const).map((scheduleSegment) => <button className={dateEditorItem?.scheduleSegment === scheduleSegment ? 'selected' : ''} aria-pressed={dateEditorItem?.scheduleSegment === scheduleSegment} disabled={!dateEditorItem?.scheduleDate} key={scheduleSegment} onClick={() => updateScheduledItems(dateEditor.itemIds, { scheduleSegment })}>{stageSegmentLabels[scheduleSegment]}</button>)}</div><footer><button onClick={() => updateScheduledItems(dateEditor.itemIds, { scheduleDate: null })}>清除时间</button><button className="primary-action" onClick={() => setDateEditor(null)}>完成</button></footer></AnchoredPopover> : null}
  {itemMenu ? <AnchoredPopover anchor={itemMenu.anchor} anchorPoint={itemMenu.anchorPoint} ariaLabel="拍摄待办操作" className="shooting-item-menu" role="menu" onDismiss={() => setItemMenu(null)}>
    <button role="menuitem" onClick={() => { setDateEditor({ anchor: itemMenu.anchor, itemIds: itemMenu.itemIds }); setItemMenu(null) }}><CalendarDays size={12} />设置日期</button>
    <button role="menuitem" onClick={() => { void saveItems(notes.shootingItems.map((item) => itemMenu.itemIds.includes(item.id) ? { ...item, completed: true } : item), '所选待办已完成'); setItemMenu(null) }}><Check size={12} />标记完成</button>
    <button role="menuitem" onClick={() => { void saveItems(notes.shootingItems.map((item) => itemMenu.itemIds.includes(item.id) ? { ...item, completed: false } : item), '已取消完成状态'); setItemMenu(null) }}><RefreshCw size={12} />取消完成</button>
    <button className="danger" role="menuitem" onClick={() => { setDeleteItemIds(itemMenu.itemIds); setItemMenu(null) }}><Trash2 size={12} />删除</button>
  </AnchoredPopover> : null}
  {deleteItemIds.length ? <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="确认删除拍摄待办"><h2>删除{deleteItemIds.length > 1 ? `这${deleteItemIds.length}条` : '这条'}拍摄待办？</h2><p>删除后不会进入回收站，请确认不再需要。</p><footer><button onClick={() => setDeleteItemIds([])}>取消</button><button className="danger-action" onClick={() => { void saveItems(notes.shootingItems.filter((item) => !deleteItemIds.includes(item.id)), deleteItemIds.length > 1 ? '所选待办已删除' : '拍摄待办已删除'); setSelectedItemIds((current) => new Set([...current].filter((id) => !deleteItemIds.includes(id)))); setDeleteItemIds([]) }}>确认删除</button></footer></section></div> : null}
  </>
}

function PostProductionPanel({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  return <section className="content-card project-module-surface production-workspace"><header><div><span>发布前产物</span><h2>后期</h2></div></header><div className="production-task-stack"><SubtitleTaskFlow project={project} onChanged={onChanged} onNotice={onNotice} /><CoverTaskFlow project={project} onChanged={onChanged} onNotice={onNotice} /></div></section>
}

function CommercialFeedbackBlock({ project }: { project: ProjectDetail }): React.JSX.Element {
  const captures = useWorkspaceStore((state) => state.snapshot.captures)
    .filter((capture) => capture.captureKind === 'client_feedback' && capture.useStatus === 'active' && (capture.primaryProjectId === project.id || capture.referencedProjectIds.includes(project.id)))
  return <section className="commercial-feedback-inline"><header><div><b>甲方反馈</b><span>同一份反馈会同时出现在大纲与文案，并参与后续生成</span></div><button onClick={() => void window.creatorOS?.openCapture(project.id, 'client_feedback')}><Plus size={13} />记录反馈</button></header>{captures.length ? <div>{captures.slice(0, 4).map((capture) => <p key={capture.id}>{capture.originalContent || '附件反馈'}</p>)}{captures.length > 4 ? <details><summary>查看全部{captures.length}条反馈</summary>{captures.slice(4).map((capture) => <p key={capture.id}>{capture.originalContent || '附件反馈'}</p>)}</details> : null}</div> : <small>还没有反馈；收到修改意见后可从这里快速记录。</small>}</section>
}

function ScriptPanel({ project, relations, onImport, onImportFile, onLink }: { project: ProjectDetail; relations: ExternalFileRelation[]; onImport(): void; onImportFile(file: File): void; onLink(): void }): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const external = project.versions.filter((version) => version.kind === 'external_draft' && !version.resolvedAt)
  const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal)
  const finalText = finalVersion ? new DOMParser().parseFromString(finalVersion.content, 'text/html').body.textContent?.replace(/\s+/g, '') ?? '' : ''
  const relationStatus: Record<ExternalFileRelation['status'], { label: string; icon: React.JSX.Element }> = {
    active: { label: '持续同步中', icon: <RefreshCw size={12} /> },
    missing: { label: '原文件暂时不可用', icon: <AlertTriangle size={12} /> },
    paused: { label: '同步已暂停', icon: <AlertTriangle size={12} /> }
  }
  return <div className="script-entry-grid">
    <section className="content-card tool-entry built-in-writing-entry">
      <span>内置工作台</span>
      <h2>文案对话与写作</h2>

      <div className="script-workbench-entry-primary" role="group" aria-label="文案工作台主视图">
        <button className="primary-action" onClick={() => navigate({ page: 'workbench', projectId: project.id, workbenchMode: 'conversation' })}>对话模式</button>
        <button onClick={() => navigate({ page: 'workbench', projectId: project.id, workbenchMode: 'comparison' })}>对照筛选</button>
        <button onClick={() => navigate({ page: 'workbench', projectId: project.id, workbenchMode: 'versions' })}>版本对比</button>
      </div>
      <div className="script-workbench-entry-secondary">
        <span>对照类型</span>
        <div role="group" aria-label="文案对照类型">
          <button onClick={() => navigate({ page: 'workbench', projectId: project.id, workbenchMode: 'drafts' })}>成稿对比</button>
          <button onClick={() => navigate({ page: 'workbench', projectId: project.id, workbenchMode: 'materials' })}>素材成稿</button>
        </div>
      </div>
    </section>
    <section
      className={`content-card tool-entry external-writing-entry${dragging ? ' dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); Array.from(event.dataTransfer.files).forEach(onImportFile) }}
    >
      <span>外部写作</span>
      <h2>Markdown / Word文案</h2>

      <div className="external-drop-hint"><UploadCloud size={17} /><span>拖入文件直接导入</span></div>
      <div className="external-writing-actions"><button className="primary-action" onClick={onLink}><Link2 size={14} />关联外部文案</button><button onClick={onImport}><FileInput size={14} />导入文件副本</button></div>
      {relations.length > 0 ? <div className="external-relation-list" aria-label="已关联的外部文案">{relations.map((relation) => <div key={relation.id} className={`external-relation ${relation.status}`}><span title={relation.displayName}>{relation.displayName}</span><em>{relationStatus[relation.status].icon}{relationStatus[relation.status].label}</em></div>)}</div> : null}
      {external.length > 0 ? <div className="external-draft-list">{external.map((version) => <button key={version.id} onClick={() => navigate({ page: 'workbench', projectId: project.id, draftVersionId: version.id, workbenchMode: 'conversation' })}><span>{version.sourceFileName ?? `外部稿v${version.revision}`}</span><em>整理</em></button>)}</div> : null}
    </section>
    <section className={`content-card script-final-entry${finalVersion ? ' ready' : ''}`} aria-label="当前定稿">
      <div><span>当前定稿</span>{finalVersion ? <><b>定稿v{finalVersion.revision}</b><small>{finalText.length}字</small></> : <b>还没有定稿</b>}</div>
      {finalVersion ? <time dateTime={finalVersion.createdAt}>最近编辑{new Date(finalVersion.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time> : <span>在工作台确认内容后，再明确点击“定稿”。</span>}
      <button className={finalVersion ? '' : 'primary-action'} onClick={() => navigate({
        page: 'workbench',
        projectId: project.id,
        draftVersionId: finalVersion?.id,
        workbenchMode: 'conversation'
      })}>{finalVersion ? '查看定稿' : '进入工作台定稿'}</button>
    </section>
    {project.isCommercial ? <CommercialFeedbackBlock project={project} /> : null}
  </div>
}

function VersionsPanel({ project, onChanged, onNotice }: { project: ProjectDetail; onChanged(): void; onNotice(message: string): void }): React.JSX.Element {
  type VersionFilter = 'all' | 'script' | 'outline' | 'title' | 'cover' | 'subtitle'
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [filter, setFilter] = useState<VersionFilter>('all')
  const [compareSourceId, setCompareSourceId] = useState<string | null>(null)
  const [preferenceNote, setPreferenceNote] = useState('保留人工定稿中的表达、结构与取舍，作为同类项目的写作偏好。')
  const [saving, setSaving] = useState(false)
  const readableContent = (version: DraftVersion): string => {
    if (version.documentType === 'outline') return parseOutline(version).map((item, index) => `${index + 1}. ${item.text}`).join('\n')
    const document = new DOMParser().parseFromString(version.content, 'text/html')
    return document.body.textContent?.trim() || version.content
  }
  const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal) ?? null
  const sourceVersion = project.versions.find((version) => version.id === compareSourceId && version.documentType === 'script') ?? null
  const visibleVersions = project.versions.filter((version) => ['script', 'outline'].includes(version.documentType) && (filter === 'all' || version.documentType === filter))
  const visibleMaterials = project.publishingMaterials.filter((material) => ['title', 'cover', 'subtitle'].includes(material.materialKind) && (filter === 'all' || material.materialKind === filter))
  const labels: Record<Exclude<VersionFilter, 'all'>, string> = { script: '文案', outline: '大纲', title: '标题', cover: '封面', subtitle: '字幕' }
  const kindLabel = (version: DraftVersion): string => version.kind === 'external_draft' ? '外部稿' : version.kind === 'claude_candidate' ? 'Claude候选' : version.kind === 'codex_candidate' ? 'Codex候选' : version.kind === 'content_candidate' ? '对话候选' : version.kind === 'merged_draft' ? '合并稿' : version.kind === 'final' ? '终稿版本' : '用户保存'
  const confirmPreference = async (): Promise<void> => {
    if (!window.creatorOS || !sourceVersion || !finalVersion) return
    setSaving(true)
    try { await window.creatorOS.confirmStylePreference(project.id, sourceVersion.id, finalVersion.id, preferenceNote); onNotice('已加入风格偏好档；后续同类文案任务可引用'); onChanged() }
    catch (reason) { onNotice(reason instanceof Error ? reason.message : '风格偏好保存失败') }
    finally { setSaving(false) }
  }
  const sourceLines = sourceVersion ? readableContent(sourceVersion).split(/\n+/).filter(Boolean) : []
  const finalLines = finalVersion ? readableContent(finalVersion).split(/\n+/).filter(Boolean) : []
  return <section className="content-card project-module-surface versions-card"><header><div><span>内容版本与改稿学习</span><h2>版本历史</h2></div><div className="version-header-tools"><nav aria-label="按模块筛选版本">{(['all', 'script', 'outline', 'title', 'cover', 'subtitle'] as const).map((value) => <button className={filter === value ? 'active' : ''} key={value} onClick={() => setFilter(value)}>{value === 'all' ? '全部' : labels[value]}</button>)}</nav><span>{project.stylePreferences.length}条风格偏好</span></div></header>{visibleVersions.map((version) => <Fragment key={version.id}><article className={version.isFinal ? 'is-final' : ''}><span className="version-kind">{labels[version.documentType as 'script' | 'outline']}</span><div><b>{kindLabel(version)}{version.isFinal ? <em>定稿</em> : null}</b><span>{version.createdBy === 'importer' ? '由外部文件导入' : `v${version.revision}·保留上一版本，可回看`}</span></div><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><div className="version-row-actions"><button aria-label="查看该版本" aria-expanded={previewId === version.id} onClick={() => setPreviewId((current) => current === version.id ? null : version.id)}>查看</button>{version.documentType === 'script' ? <button onClick={() => { setCompareSourceId(version.id); setPreviewId(null) }}>对比</button> : null}</div></article>{previewId === version.id ? <div className="version-preview" role="region" aria-label="版本内容"><pre>{readableContent(version)}</pre>{version.sourceFileName ? <small>已保留导入原件：{version.sourceFileName}</small> : null}</div> : null}</Fragment>)}{visibleMaterials.map((material) => { const materialPreviewId = `material:${material.id}`; const materialLabel = labels[material.materialKind as 'title' | 'cover' | 'subtitle']; return <Fragment key={materialPreviewId}><article><span className="version-kind">{materialLabel}</span><div><b>{material.platform}{materialLabel}</b><span>v{material.revision}·{material.textValue?.trim() || material.fileName || '空内容'}</span></div><time dateTime={material.updatedAt}>{new Date(material.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><div className="version-row-actions">{material.materialKind === 'title' ? <button aria-label="查看该标题" aria-expanded={previewId === materialPreviewId} onClick={() => setPreviewId((current) => current === materialPreviewId ? null : materialPreviewId)}>查看</button> : null}</div></article>{previewId === materialPreviewId ? <div className="version-preview" role="region" aria-label={`${material.platform}${materialLabel}`}><pre>{material.textValue}</pre></div> : null}</Fragment> })}{visibleVersions.length === 0 && visibleMaterials.length === 0 ? <div className="module-empty-state version-empty-state"><b>还没有{filter === 'all' ? '内容' : labels[filter]}版本</b><span>保存对应内容后会出现在这里。</span></div> : null}{sourceVersion ? <section className="version-compare" aria-label="版本对比"><header><div><span>改稿学习</span><h3>{kindLabel(sourceVersion)}v{sourceVersion.revision}对比{finalVersion ? `定稿v${finalVersion.revision}` : '定稿'}</h3></div><button onClick={() => setCompareSourceId(null)}>关闭</button></header>{finalVersion && finalVersion.id !== sourceVersion.id ? <><div className="diff-columns"><section><b>AI初稿/来源稿</b>{sourceLines.length ? sourceLines.map((line, index) => <p className={line === finalLines[index] ? 'same' : 'removed'} key={`${index}-${line}`}>{line}</p>) : <p>空内容</p>}</section><section><b>你的定稿</b>{finalLines.length ? finalLines.map((line, index) => <p className={line === sourceLines[index] ? 'same' : 'added'} key={`${index}-${line}`}>{line}</p>) : <p>空内容</p>}</section></div><label>确认要进入风格偏好档的规则<textarea value={preferenceNote} onChange={(event) => setPreferenceNote(event.currentTarget.value)} /></label><footer><span>确认后只成为可追溯偏好，不会直接训练或静默覆盖全局规则。</span><button className="primary-action" disabled={saving || !preferenceNote.trim()} onClick={() => void confirmPreference()}>确认加入风格偏好档</button></footer></> : <div className="prerequisite-notice warning"><AlertTriangle size={14} />{finalVersion ? '当前选择的就是定稿，请选择一份AI初稿或来源稿进行对比。' : '请先在文案工作台保存并设为定稿，再进行AI初稿与定稿对比。'}</div>}</section> : null}</section>
}
