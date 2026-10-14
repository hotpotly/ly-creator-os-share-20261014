import { Check, ChevronDown, ChevronUp, File, FileText, Folder, Link2, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectAssetLinkRecord, ProjectDetail } from '../../../shared/domain'

interface PrimaryReferenceInput {
  linkId: string
  attentionNote: string
}

interface PrimaryMaterialReferenceInput {
  materialId: string
  attentionNote: string
}

interface PrimaryReferencePanelProps {
  project: ProjectDetail
  onSave(referenceRequirements: string, references: PrimaryReferenceInput[], materialReferences: PrimaryMaterialReferenceInput[]): Promise<void>
}

const statusLabels: Record<ProjectAssetLinkRecord['processState'], string> = {
  ready: '已读取', pending: '待处理', stored_only: '仅保存', failed: '处理失败'
}

function initialNotes(project: ProjectDetail): Record<string, string> {
  return Object.fromEntries([
    ...project.assetLinks.filter((link) => link.isPrimaryReference).map((link) => [`asset:${link.id}`, link.attentionNote] as const),
    ...project.materials.filter((material) => material.isPrimaryReference).map((material) => [`material:${material.id}`, material.attentionNote] as const)
  ])
}

function stateKey(requirements: string, notes: Record<string, string>): string {
  return JSON.stringify({ requirements, references: Object.entries(notes).sort(([left], [right]) => left.localeCompare(right)) })
}

export function PrimaryReferencePanel({ project, onSave }: PrimaryReferencePanelProps): React.JSX.Element {
  const projectRef = useRef(project)
  projectRef.current = project
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>(() => initialNotes(project))
  const [requirements, setRequirements] = useState(project.referenceRequirements)
  const [savedKey, setSavedKey] = useState(() => stateKey(project.referenceRequirements, initialNotes(project)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const currentProject = projectRef.current
    const nextNotes = initialNotes(currentProject)
    setNotes(nextNotes)
    setRequirements(currentProject.referenceRequirements)
    setSavedKey(stateKey(currentProject.referenceRequirements, nextNotes))
  }, [project.id])

  const materialNames = useMemo(() => new Map(project.materials.map((material) => [material.id, material.title])), [project.materials])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleLinks = useMemo(() => project.assetLinks.filter((link) => {
    if (normalizedQuery) return `${materialNames.get(link.projectMaterialId) ?? ''} ${link.relativePath} ${link.fileName}`.toLocaleLowerCase().includes(normalizedQuery)
    return link.parentLinkId === null || Object.prototype.hasOwnProperty.call(notes, `asset:${link.id}`)
  }).slice(0, 100), [materialNames, normalizedQuery, notes, project.assetLinks])
  const visibleMaterials = useMemo(() => project.materials.filter((material) => ['text', 'link'].includes(material.sourceKind)).filter((material) => (
    !normalizedQuery || `${material.title} ${material.textContent ?? ''} ${material.sourceUrl ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
  )).slice(0, 100), [normalizedQuery, project.materials])
  const currentKey = stateKey(requirements, notes)
  const selectedCount = Object.keys(notes).length
  const dirty = currentKey !== savedKey

  const toggle = (key: string, attentionNote: string): void => {
    setNotes((current) => {
      const next = { ...current }
      if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key]
      else next[key] = attentionNote
      return next
    })
    setError('')
  }
  const save = async (): Promise<void> => {
    if (saving || !dirty) return
    setSaving(true); setError('')
    try {
      const references = Object.entries(notes).filter(([key]) => key.startsWith('asset:')).map(([key, attentionNote]) => ({ linkId: key.slice(6), attentionNote: attentionNote.trim() }))
      const materialReferences = Object.entries(notes).filter(([key]) => key.startsWith('material:')).map(([key, attentionNote]) => ({ materialId: key.slice(9), attentionNote: attentionNote.trim() }))
      await onSave(requirements.trim(), references, materialReferences)
      setRequirements(requirements.trim())
      const nextNotes = Object.fromEntries([
        ...references.map((item) => [`asset:${item.linkId}`, item.attentionNote] as const),
        ...materialReferences.map((item) => [`material:${item.materialId}`, item.attentionNote] as const)
      ])
      setNotes(nextNotes)
      setSavedKey(stateKey(requirements.trim(), nextNotes))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '主要参考保存失败') }
    finally { setSaving(false) }
  }

  return <section className={`primary-reference-panel${expanded ? ' expanded' : ''}`} aria-label="主要参考">
    <header>
      <div><span className="primary-reference-icon"><Check size={15} /></span><div><h3>主要参考</h3></div></div>
      <div><em>{selectedCount ? `已选${selectedCount}项` : '未设置'}</em><button aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '设置'}{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button></div>
    </header>
    {expanded ? <div className="primary-reference-body">
      {project.assetLinks.length || visibleMaterials.length ? <>
        <label className="primary-reference-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索资料、文件或文件夹" /></label>
        <div className="primary-reference-list">
          {visibleMaterials.map((material) => {
            const key = `material:${material.id}`
            const selected = Object.prototype.hasOwnProperty.call(notes, key)
            return <article className={selected ? 'selected' : ''} key={key}>
              <button className="primary-reference-choice" aria-pressed={selected} onClick={() => toggle(key, material.attentionNote)}>
                <span className="primary-reference-check">{selected ? <Check size={12} /> : null}</span>
                <span className="primary-reference-kind">{material.sourceKind === 'link' ? <Link2 size={14} /> : <FileText size={14} />}</span>
                <span><b>{material.title}</b><small>{material.sourceKind === 'link' ? '网页链接·正文未读取' : `文字资料·${material.textContent?.length ?? 0}字`}</small></span>
              </button>
              {selected ? <label className="primary-reference-note"><span>尤其要注意什么（可选）</span><textarea maxLength={2000} value={notes[key] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setNotes((current) => ({ ...current, [key]: value })) }} placeholder="例如：优先核对这份联网资料中的来源和冲突项" /></label> : null}
            </article>
          })}
          {visibleLinks.map((link) => {
            const key = `asset:${link.id}`
            const selected = Object.prototype.hasOwnProperty.call(notes, key)
            const unavailable = link.availability !== 'available'
            return <article className={selected ? 'selected' : ''} key={key}>
              <button className="primary-reference-choice" aria-pressed={selected} onClick={() => toggle(key, link.attentionNote)}>
                <span className="primary-reference-check">{selected ? <Check size={12} /> : null}</span>
                <span className="primary-reference-kind">{link.fileKind === 'folder' ? <Folder size={14} /> : <File size={14} />}</span>
                <span><b>{link.relativePath || link.fileName}</b><small>{materialNames.get(link.projectMaterialId)}·{unavailable ? '原始位置不可用' : statusLabels[link.processState]}</small></span>
              </button>
              {selected ? <label className="primary-reference-note"><span>尤其要注意什么（可选）</span><textarea maxLength={2000} value={notes[key] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setNotes((current) => ({ ...current, [key]: value })) }} placeholder="例如：必须保留这份Brief的交付要求" /></label> : null}
            </article>
          })}
          {!visibleLinks.length && !visibleMaterials.length ? <p className="primary-reference-empty">没有匹配的资料</p> : null}
        </div>
      </> : <p className="primary-reference-empty">暂无资料</p>}
      <label className="primary-reference-requirements"><span>总体要求（可选）</span><textarea maxLength={4000} value={requirements} onChange={(event) => setRequirements(event.currentTarget.value)} placeholder="例如：先给真实结论，再讲规格与实测差异" /></label>
      <footer><span>{dirty ? '有未保存修改' : '已保存'}</span>{error ? <p role="alert">{error}</p> : null}<button className="primary-action" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存参考设置'}</button></footer>
    </div> : null}
  </section>
}
