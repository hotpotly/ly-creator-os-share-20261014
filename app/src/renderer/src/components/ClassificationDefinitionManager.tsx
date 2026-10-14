import { ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface ClassificationDefinition {
  id: string
  name: string
  description: string
  isActive: boolean
}

interface ClassificationDefinitionManagerProps {
  ariaLabel: string
  title: string
  definitions: ClassificationDefinition[]
  newNameLabel: string
  newNamePlaceholder: string
  addButtonLabel: string
  descriptionPlaceholder: string
  canReorder?: boolean
  onClose(): void
  onChanged(): Promise<unknown>
  onCreate(name: string): Promise<unknown>
  onUpdate(id: string, patch: { name?: string; description?: string; isActive?: boolean }): Promise<unknown>
  onReorder?(ids: string[]): Promise<unknown>
}

export function ClassificationDefinitionManager({
  ariaLabel,
  title,
  definitions,
  newNameLabel,
  newNamePlaceholder,
  addButtonLabel,
  descriptionPlaceholder,
  canReorder = false,
  onClose,
  onChanged,
  onCreate,
  onUpdate,
  onReorder
}: ClassificationDefinitionManagerProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { dialogRef.current?.focus() }, [])

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setWorking(true)
    setError('')
    try {
      await action()
      await onChanged()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
      return false
    } finally {
      setWorking(false)
    }
  }

  const beginEditing = (definition: ClassificationDefinition): void => {
    setEditingId(definition.id)
    setEditingName(definition.name)
    setEditingDescription(definition.description)
    setDescriptionOpen(true)
    setError('')
  }

  const stopEditing = (): void => {
    setEditingId(null)
    setEditingName('')
    setEditingDescription('')
    setDescriptionOpen(false)
    setError('')
  }

  const move = (id: string, delta: -1 | 1): void => {
    const index = definitions.findIndex((item) => item.id === id)
    const target = index + delta
    if (!onReorder || index < 0 || target < 0 || target >= definitions.length) return
    const ids = definitions.map((item) => item.id)
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    void run(() => onReorder(ids))
  }

  return <section ref={dialogRef} className="direction-manager" role="dialog" aria-label={ariaLabel} tabIndex={-1} onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (editingId) stopEditing()
    else onClose()
  }}>
    <header>
      <div><b>{title}</b></div>
      <button aria-label={`关闭${title.replace(/^管理/, '')}管理`} onClick={onClose}><X size={14} /></button>
    </header>
    <div className="direction-manager-list">
      {definitions.map((definition, index) => {
        const isEditing = editingId === definition.id
        return <article className={`direction-manager-item${definition.isActive ? '' : ' inactive'}${isEditing ? ' editing' : ''}`} key={definition.id}>
          <div className="direction-manager-row">
            <div className="direction-manager-summary">
              <b>{definition.name}</b>
              <span>{definition.description || '尚未填写描述'}</span>
            </div>
            {canReorder ? <>
              <button aria-label={`上移${definition.name}`} disabled={working || isEditing || index === 0} onClick={() => move(definition.id, -1)}><ArrowUp size={12} /></button>
              <button aria-label={`下移${definition.name}`} disabled={working || isEditing || index === definitions.length - 1} onClick={() => move(definition.id, 1)}><ArrowDown size={12} /></button>
            </> : <span className="direction-manager-spacer" />}
            <button aria-label={`编辑${definition.name}`} aria-expanded={isEditing} disabled={working} onClick={() => isEditing ? stopEditing() : beginEditing(definition)}>{isEditing ? <X size={12} /> : <Pencil size={12} />}</button>
            <button className="direction-state-action" disabled={working || isEditing} onClick={() => void run(() => onUpdate(definition.id, { isActive: !definition.isActive }))}>{definition.isActive ? '停用' : '启用'}</button>
          </div>
          {isEditing ? <div className="direction-manager-editor">
            <label>名称<input autoFocus aria-label={`编辑${definition.name}名称`} value={editingName} onChange={(event) => setEditingName(event.currentTarget.value)} /></label>
            <button className="direction-description-toggle" type="button" aria-expanded={descriptionOpen} onClick={() => setDescriptionOpen((value) => !value)}>{descriptionOpen ? '收起描述' : editingDescription ? '编辑描述' : '＋添加描述'}</button>
            {descriptionOpen ? <label>描述（可选）<textarea aria-label={`编辑${definition.name}描述`} maxLength={2000} value={editingDescription} onChange={(event) => setEditingDescription(event.currentTarget.value)} placeholder={descriptionPlaceholder} /><small>{editingDescription.length}/2000</small></label> : null}
            <div className="direction-manager-editor-actions"><button type="button" onClick={stopEditing}>取消</button><button className="primary-action" type="button" disabled={working || !editingName.trim()} onClick={() => void run(() => onUpdate(definition.id, { name: editingName.trim(), description: editingDescription })).then((saved) => { if (saved) stopEditing() })}>{working ? '保存中…' : '保存'}</button></div>
          </div> : null}
        </article>
      })}
    </div>
    <div className="direction-manager-add"><input aria-label={newNameLabel} value={newName} onChange={(event) => setNewName(event.currentTarget.value)} placeholder={newNamePlaceholder} /><button aria-label={addButtonLabel} disabled={working || !newName.trim()} onClick={() => void run(() => onCreate(newName.trim())).then((saved) => { if (saved) setNewName('') })}><Plus size={12} />新增</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>
}
