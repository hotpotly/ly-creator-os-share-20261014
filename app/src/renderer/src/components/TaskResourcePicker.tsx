import { ContentTypeSelect } from './ContentTypeSelect'
import { AppSelect } from './AppSelect'
import { AlertTriangle, Check, ChevronRight, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProjectDetail, ProviderKind, TaskResourcePreparation, TaskRun } from '../../../shared/domain'
import { useWorkspaceStore } from '../store/workspace'

const inputStatusLabels: Record<TaskResourcePreparation['requiredInputs'][number]['status'], string> = {
  included: '已引用', missing: '待补', empty: '暂无', not_applicable: '不适用'
}

const providerOrder: ProviderKind[] = ['codex_cli', 'claude_cli', 'mock']

export function TaskResourcePicker({ open, project, onClose, onCreated }: {
  open: boolean
  project: ProjectDetail
  onClose(): void
  onCreated(task: TaskRun): void
}): React.JSX.Element | null {
  const { contentTypes, projectTemplates, providerCapabilities } = useWorkspaceStore((state) => state.snapshot)
  const [preparation, setPreparation] = useState<TaskResourcePreparation | null>(null)
  const [taskContentTypeId, setTaskContentTypeId] = useState(project.contentTypeId)
  const [taskTemplateId, setTaskTemplateId] = useState<string | null>(project.appliedTemplateId)
  const [excludedRecommendedIds, setExcludedRecommendedIds] = useState<string[]>([])
  const [manualResourceIds, setManualResourceIds] = useState<string[]>([])
  const [supportingMaterialIds, setSupportingMaterialIds] = useState<string[]>([])
  const [provider, setProvider] = useState<'mock' | 'codex_cli' | 'claude_cli'>('mock')
  const [instruction, setInstruction] = useState('请基于本次项目资料和真实体验，生成一版可继续编辑的文案候选。')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const providers = useMemo(() => providerOrder.map((kind) => providerCapabilities.find((item) => item.provider === kind)).filter((item): item is NonNullable<typeof item> => Boolean(item)), [providerCapabilities])

  const loadPreparation = async (nextContentTypeId: string, nextTemplateId: string | null): Promise<void> => {
    if (!window.creatorOS) { setError('资源选择器需要在App中打开'); return }
    setLoading(true); setError('')
    try {
      const next = await window.creatorOS.prepareTaskResources(project.id, { taskContentTypeId: nextContentTypeId, taskTemplateId: nextTemplateId })
      setPreparation(next)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务资源加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!open) return
    const availableProvider = providers.find((item) => item.available && item.provider !== 'none')?.provider
    setProvider(availableProvider === 'codex_cli' || availableProvider === 'claude_cli' ? availableProvider : 'mock')
    setTaskContentTypeId(project.contentTypeId); setTaskTemplateId(project.appliedTemplateId)
    setExcludedRecommendedIds([]); setManualResourceIds([]); setSupportingMaterialIds([]); setError('')
    void loadPreparation(project.contentTypeId, project.appliedTemplateId)
  }, [open, project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !submitting) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open, submitting])

  if (!open) return null

  const changeDirection = (contentTypeId: string): void => {
    setTaskContentTypeId(contentTypeId); setExcludedRecommendedIds([]); setManualResourceIds([])
    void loadPreparation(contentTypeId, taskTemplateId)
  }
  const changeTemplate = (templateId: string | null): void => {
    setTaskTemplateId(templateId); setExcludedRecommendedIds([]); setManualResourceIds([])
    void loadPreparation(taskContentTypeId, templateId)
  }
  const toggleManual = (resourceId: string): void => setManualResourceIds((current) => current.includes(resourceId) ? current.filter((id) => id !== resourceId) : [...current, resourceId])
  const submit = async (): Promise<void> => {
    if (!window.creatorOS || !preparation) return
    setSubmitting(true); setError('')
    try {
      const task = await window.creatorOS.createTask({
        taskType: 'draft_generation', projectId: project.id,
        title: `${provider === 'claude_cli' ? 'Claude' : provider === 'codex_cli' ? 'Codex' : '本机测试'}生成文案`, provider, input: instruction,
        taskContentTypeId, taskTemplateId, excludedRecommendedResourceIds: excludedRecommendedIds, manualResourceIds, supportingMaterialIds
      })
      onCreated(task); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '文案任务创建失败') }
    finally { setSubmitting(false) }
  }

  return <div className="modal-backdrop task-resource-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
    <section className="task-resource-picker" role="dialog" aria-modal="true" aria-labelledby="task-resource-title">
      <header><div><span>文案任务</span><h2 id="task-resource-title">确认本次引用</h2></div><button aria-label="关闭资源选择器" disabled={submitting} onClick={onClose}><X size={17} /></button></header>
      <div className="task-resource-config"><label><span>本次内容方向</span><ContentTypeSelect value={taskContentTypeId} onChange={(event) => changeDirection(event.currentTarget.value)}>{contentTypes.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ContentTypeSelect></label><label><span>本次项目模板</span><AppSelect value={taskTemplateId ?? ''} onChange={(event) => changeTemplate(event.currentTarget.value || null)}><option value="">从空白开始</option>{projectTemplates.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</AppSelect></label></div>
      <div className="task-resource-scroll">
        {loading ? <div className="loading-state">正在核对项目资源…</div> : null}
        {preparation && !loading ? <>
          <ResourceSection title="固定项目上下文" description="项目说明、商单Brief与已确认要求按项目事实带入">
            <div className="required-input-list">{preparation.requiredInputs.filter((item) => item.status !== 'not_applicable' && (item.required || item.status === 'included')).map((item) => <div className={`required-input-row ${item.status}`} key={item.key}><span className="resource-state-icon">{item.status === 'included' ? <Check size={13} /> : <AlertTriangle size={13} />}</span><div><b>{item.label}</b><small>{item.items.length ? `${item.items.length}条已确认内容` : item.required ? '快照中会明确标记待补，AI不得虚构' : '本次没有选择'}</small></div><em>{inputStatusLabels[item.status]}</em></div>)}</div>
          </ResourceSection>
          <ResourceSection title="主要参考" description="必须优先阅读，但不会覆盖Brief、官方规格或你的实测结论">
            {preparation.primaryReferences.length ? <div className="task-resource-rows">{preparation.primaryReferences.map((reference) => <div className="task-resource-row selected" key={reference.linkId}><div><b>{reference.fileName}</b><small>{reference.attentionNote || '未填写额外注意事项'}·{reference.status === 'included' ? '正文已读取' : reference.status === 'unread' ? '仅带入来源信息' : '当前不可完整读取'}</small></div><em>主要</em></div>)}</div> : <p className="task-resource-empty">尚未设置主要参考</p>}
          </ResourceSection>
          <ResourceSection title="补充资料与真实体验" description="默认不全量带入；只勾选本次确实需要的内容">
            {preparation.supportingMaterials.length ? <div className="task-resource-rows">{preparation.supportingMaterials.map((material) => {
              const selected = supportingMaterialIds.includes(material.id)
              const label = material.kind === 'real_experience' ? '真实体验' : material.kind === 'scratch_note' ? '随手笔记' : '项目资料'
              return <label className={`task-resource-row${selected ? ' selected' : ''}`} key={material.id}><div><b>{material.title}</b><small>{label}·{material.content.length}字</small></div><span><input type="checkbox" checked={selected} onChange={() => setSupportingMaterialIds((current) => current.includes(material.id) ? current.filter((id) => id !== material.id) : [...current, material.id])} />{selected ? '已选' : '选择'}</span></label>
            })}</div> : <p className="task-resource-empty">当前没有可选择的补充资料</p>}
          </ResourceSection>
          <ResourceSection title="自动引用" description="根据本次内容方向锁定"><ResourceRows resources={preparation.automaticResources} empty="当前方向没有自动资源" /></ResourceSection>
          <ResourceSection title="推荐参考" description="默认带入，可以一键移除"><ResourceRows resources={preparation.recommendedResources} empty="暂无推荐参考" excludedIds={excludedRecommendedIds} onToggleExcluded={(resourceId) => setExcludedRecommendedIds((current) => current.includes(resourceId) ? current.filter((id) => id !== resourceId) : [...current, resourceId])} /></ResourceSection>
          <ResourceSection title="手动选择" description="其他博主的蒸馏内容不会自动带入"><ResourceRows resources={preparation.manualResources} empty="暂无可手动选择的其他博主或专项资源" selectedIds={manualResourceIds} onToggleSelected={toggleManual} /></ResourceSection>
        </> : null}
      </div>
      <div className="task-resource-request"><label><span>本次要求</span><textarea value={instruction} maxLength={100_000} onChange={(event) => setInstruction(event.currentTarget.value)} /></label><label><span>调用方式</span><AppSelect value={provider} onChange={(event) => setProvider(event.currentTarget.value as typeof provider)}>{providers.map((item) => <option key={item.provider} value={item.provider} disabled={!item.available}>{item.displayName}{item.available ? '' : `（${item.detail}）`}</option>)}</AppSelect></label></div>
      {error ? <p className="form-error task-resource-error" role="alert">{error}</p> : null}
      <footer><span><Sparkles size={13} />创建时会固化不可变快照，重试不会偷换参考。</span><button disabled={submitting} onClick={onClose}>取消</button><button className="primary-action" disabled={submitting || loading || !preparation || !instruction.trim()} onClick={() => void submit()}>{submitting ? '正在创建…' : '生成候选'}<ChevronRight size={14} /></button></footer>
    </section>
  </div>
}

export function ResourceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="task-resource-section"><header><div><h3>{title}</h3><p>{description}</p></div></header>{children}</section>
}

export function ResourceRows({ resources, empty, excludedIds = [], selectedIds = [], onToggleExcluded, onToggleSelected }: {
  resources: TaskResourcePreparation['automaticResources']
  empty: string
  excludedIds?: string[]
  selectedIds?: string[]
  onToggleExcluded?(resourceId: string): void
  onToggleSelected?(resourceId: string): void
}): React.JSX.Element {
  if (resources.length === 0) return <p className="task-resource-empty">{empty}</p>
  return <div className="task-resource-rows">{resources.map((resource) => {
    const excluded = excludedIds.includes(resource.id); const selected = selectedIds.includes(resource.id)
    return <div className={`task-resource-row${excluded ? ' excluded' : ''}${selected ? ' selected' : ''}`} key={resource.id}><div><b>{resource.name}</b><small>{resource.description || '暂无说明'}</small></div>{onToggleExcluded ? <button onClick={() => onToggleExcluded(resource.id)}>{excluded ? <><RotateCcw size={12} />恢复</> : <><X size={12} />移除</>}</button> : onToggleSelected ? <label><input type="checkbox" checked={selected} onChange={() => onToggleSelected(resource.id)} />{selected ? '已选' : '选择'}</label> : <em>已引用</em>}</div>
  })}</div>
}
