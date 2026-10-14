import { ContentTypeSelect } from './ContentTypeSelect'
import { AppSelect } from './AppSelect'
import { Check, Clipboard, ExternalLink, FilePlus2, LockKeyhole, Save } from 'lucide-react'
import { useState } from 'react'
import type { ContentDerivativeRecord, ContentTypeDefinition, ProjectTemplateDefinition } from '../../../shared/domain'
import { navigate } from '../utils/router'

const outputLabels: Record<ContentDerivativeRecord['outputType'], string> = { x_single: 'X单帖', x_thread: 'X串文', ai_short_video_script: 'AI短视频文案' }

export function ContentDerivativeCandidate({ candidate, contentTypes, templates, busy, onConfirm, onCopy, onCreateProject }: {
  candidate: ContentDerivativeRecord
  contentTypes: ContentTypeDefinition[]
  templates: ProjectTemplateDefinition[]
  busy: boolean
  onConfirm(content: string): void
  onCopy(): void
  onCreateProject(input: { title: string; contentTypeId: string; templateId: string | null }): void
}): React.JSX.Element {
  const [content, setContent] = useState(candidate.currentContent)
  const [projectTitle, setProjectTitle] = useState(candidate.title.replace(/^[^：]+：/, ''))
  const [contentTypeId, setContentTypeId] = useState(candidate.derivationSnapshot.contentTypeId)
  const [templateId, setTemplateId] = useState<string | null>(candidate.derivationSnapshot.templateId)

  const confirmed = candidate.status === 'confirmed' || candidate.status === 'project_created'
  return <article className={`content-derivative-candidate ${candidate.status}`}>
    <header><div><span>{outputLabels[candidate.outputType]}·本机规则初稿</span><h3>{candidate.title}</h3></div><span className={`derivative-status ${candidate.status}`}>{candidate.status === 'candidate' ? '待确认' : candidate.status === 'confirmed' ? '已确认' : '已建项目'}</span></header>
    <label className="derivative-editor"><span>编辑候选</span><textarea value={content} disabled={candidate.status === 'project_created'} onChange={(event) => setContent(event.currentTarget.value)} /></label>
    <details className="derivative-trace"><summary><LockKeyhole size={13} />查看来源与不可变快照</summary><dl><div><dt>内容原子</dt><dd>{candidate.derivationSnapshot.atoms.map((atom) => atom.title).join('｜')}</dd></div><div><dt>资源</dt><dd>{[...candidate.derivationSnapshot.automaticResources, ...candidate.derivationSnapshot.recommendedResources, ...candidate.derivationSnapshot.manualResources].map((resource) => `${resource.name}@v${resource.version}`).join('｜') || '无'}</dd></div><div><dt>隐私扫描</dt><dd>{candidate.derivationSnapshot.privacy.reduce((total, item) => total + item.findingCount, 0)}处已扫描并在派生输入中遮盖</dd></div></dl></details>
    <div className="derivative-actions"><button className="primary-action" disabled={busy || candidate.status === 'project_created' || !content.trim()} onClick={() => onConfirm(content)}>{confirmed ? <Save size={13} /> : <Check size={13} />}{confirmed ? '重新确认修改' : '确认候选'}</button><button className="secondary-action" disabled={busy || !confirmed} onClick={onCopy}><Clipboard size={13} />复制</button></div>
    {candidate.status === 'confirmed' ? <section className="derivative-project-create"><header><div><span>确认后进入项目</span><h4>创建内容项目</h4></div><FilePlus2 size={16} /></header><div><label><span>项目名称</span><input value={projectTitle} maxLength={160} onChange={(event) => setProjectTitle(event.currentTarget.value)} /></label><label><span>内容方向</span><ContentTypeSelect value={contentTypeId} onChange={(event) => { const next = event.currentTarget.value; setContentTypeId(next); setTemplateId(contentTypes.find((item) => item.id === next)?.defaultProjectTemplateId ?? null) }}>{contentTypes.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ContentTypeSelect></label><label><span>项目模板</span><AppSelect value={templateId ?? ''} onChange={(event) => setTemplateId(event.currentTarget.value || null)}><option value="">从空白开始</option>{templates.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</AppSelect></label></div><button className="primary-action" disabled={busy || !projectTitle.trim()} onClick={() => onCreateProject({ title: projectTitle, contentTypeId, templateId })}><FilePlus2 size={13} />创建项目并保留来源</button></section> : null}
    {candidate.status === 'project_created' && candidate.projectId ? <button className="secondary-action derivative-open-project" onClick={() => navigate({ page: 'project', projectId: candidate.projectId!, moduleKey: 'versions' })}>打开已创建项目<ExternalLink size={13} /></button> : null}
  </article>
}
