import { useState } from 'react'
import { OPTIONAL_MODULE_KEYS, type ProjectTemplateDefinition } from '../../../shared/domain'
import { type SaveProjectTemplateInput } from '../../../shared/project-template-rules'
import { useWorkspaceStore } from '../store/workspace'
import { projectModuleLabels } from '../utils/project-labels'
import { ContentTypeLabel } from './ContentTypeLabel'
import { AppSelect } from './AppSelect'

function draftFor(template?: ProjectTemplateDefinition): SaveProjectTemplateInput {
  return template ? { id: template.id, name: template.name, description: template.description, moduleKeys: [...template.moduleKeys], recommendedContentTypeIds: [...template.recommendedContentTypeIds], recommendedVideoFormats: [...template.recommendedVideoFormats ?? []], recommendedProjectKinds: [...template.recommendedProjectKinds ?? []], isActive: template.isActive }
    : { name: '', description: '', moduleKeys: ['script', 'publishing'], recommendedContentTypeIds: [], recommendedVideoFormats: [], recommendedProjectKinds: [], isActive: true }
}
export function ProjectTemplateSettings(): React.JSX.Element {
  const { projectTemplates, contentTypes } = useWorkspaceStore(state => state.snapshot)
  const refresh = useWorkspaceStore(state => state.refresh)
  const [draft, setDraft] = useState(() => draftFor(projectTemplates.find(t => t.isActive)))
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const patch = (value: Partial<SaveProjectTemplateInput>): void => { setDraft(current => ({ ...current, ...value })); setDirty(true); setMessage('') }
  const switchTo = (id: string): void => {
    if (dirty) { setMessage('请先保存或取消当前修改，再切换模板。'); return }
    setDraft(draftFor(projectTemplates.find(t => t.id === id))); setMessage('')
  }
  const toggle = <T extends string,>(values: T[], value: T): T[] => values.includes(value) ? values.filter(item => item !== value) : [...values, value]
  const save = async (): Promise<void> => {
    if (!window.creatorOS) return
    setBusy(true); setMessage('')
    try { const saved = await window.creatorOS.saveProjectTemplate(draft); await refresh(); setDraft(draftFor(saved)); setDirty(false); setMessage('已保存；已有项目的阶段和内容不会自动改变。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请重试') }
    finally { setBusy(false) }
  }
  return <section className="settings-group card project-template-settings" aria-label="项目模板管理">
    <header className="settings-group-head"><div><b>项目模板</b><span>配置阶段与适用分类；修改只影响以后选择和应用模板，不批量重设已有项目。</span></div></header>
    <div className="template-settings-toolbar"><AppSelect aria-label="编辑项目模板" value={draft.id ?? ''} disabled={busy} onChange={event => switchTo(event.currentTarget.value)}><option value="">新建模板</option>{projectTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : '（已停用）'}</option>)}</AppSelect><button disabled={busy} onClick={() => switchTo('')}>新建模板</button></div>
    <fieldset disabled={busy} className="template-settings-form">
      <label>模板名称<input aria-label="模板名称" maxLength={80} value={draft.name} onChange={event => patch({ name: event.currentTarget.value })} /></label>
      <label>描述（可选）<textarea aria-label="模板描述" maxLength={2000} value={draft.description} onChange={event => patch({ description: event.currentTarget.value })} /></label>
      <div className="settings-field"><p>适用内容方向<span>不限定时适用于全部方向</span></p><div className="np-chips" role="group" aria-label="模板适用内容方向">{contentTypes.filter(t => t.isActive || draft.recommendedContentTypeIds.includes(t.id)).map(t => <button type="button" key={t.id} className={`np-chip${draft.recommendedContentTypeIds.includes(t.id) ? ' on' : ''}`} aria-pressed={draft.recommendedContentTypeIds.includes(t.id)} onClick={() => patch({ recommendedContentTypeIds: toggle(draft.recommendedContentTypeIds, t.id) })}><ContentTypeLabel id={t.id} name={t.name} /></button>)}</div></div>
      <div className="settings-field"><p>适用视频形式<span>不选表示不限定</span></p><div className="np-chips" role="group" aria-label="模板适用视频形式">{([['long', '长视频'], ['short', '短视频']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={draft.recommendedVideoFormats.includes(value)} className={`np-chip${draft.recommendedVideoFormats.includes(value) ? ' on' : ''}`} onClick={() => patch({ recommendedVideoFormats: toggle(draft.recommendedVideoFormats, value) })}>{label}</button>)}</div></div>
      <div className="settings-field"><p>适用项目类型<span>不选表示商单、普通都适用</span></p><div className="np-chips" role="group" aria-label="模板适用项目类型">{([['ordinary', '普通'], ['commercial', '商单']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={draft.recommendedProjectKinds.includes(value)} className={`np-chip${draft.recommendedProjectKinds.includes(value) ? ' on' : ''}`} onClick={() => patch({ recommendedProjectKinds: toggle(draft.recommendedProjectKinds, value) })}>{label}</button>)}</div></div>
      <div className="settings-field"><p>默认阶段模块<span>概览、版本始终保留；金额仅在商单项目生效。</span></p><div className="template-module-options" role="group" aria-label="模板默认阶段">{OPTIONAL_MODULE_KEYS.filter(key => key !== 'feedback' && key !== 'production').map(key => <label key={key}><input type="checkbox" checked={draft.moduleKeys.includes(key)} onChange={() => patch({ moduleKeys: toggle(draft.moduleKeys, key) })} />{projectModuleLabels[key]}</label>)}</div></div>
      <label className="template-active-toggle"><input type="checkbox" checked={draft.isActive} onChange={event => patch({ isActive: event.currentTarget.checked })} />启用此模板<span>停用后仍保留已有项目和模板配置</span></label>
    </fieldset>
    <footer><span role="status">{message}</span><button disabled={busy || !dirty} onClick={() => { setDraft(draftFor(projectTemplates.find(t => t.id === draft.id))); setDirty(false); setMessage('') }}>取消修改</button><button className="primary-action" disabled={busy || !draft.name.trim() || !dirty} onClick={() => void save()}>{busy ? '保存中…' : '保存模板'}</button></footer>
  </section>
}
