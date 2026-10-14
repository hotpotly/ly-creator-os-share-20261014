import { AlertTriangle, Check, FileText, Image, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StructuredReferenceCatalogItem, StructuredReferenceUse } from '../../../../../shared/domain'
import { AnchoredPopover } from '../../../components/AnchoredPopover'
import { allowedStructuredReferenceScopes, groupStructuredReferenceCatalog, nextUnusedReferenceScope, referenceAlreadyUsed } from './structured-reference-composer-state'

function availabilityLabel(value: StructuredReferenceCatalogItem['availability']): string {
  return ({
    ready: '已读取', stored_only: '尚未读取', processing: '处理中', authorization_required: '等待授权',
    reauthorization_required: '需要重新授权', stale: '内容已更新', missing: '来源缺失', unsupported: '暂不支持'
  } satisfies Record<StructuredReferenceCatalogItem['availability'], string>)[value]
}

export function ReferencePickerPopover({ anchor, anchorPoint, items, references, hasCurrentTarget, query, onQueryChange, onSelect, onDismiss }: {
  anchor: HTMLElement | null
  anchorPoint: { x: number; y: number } | null
  items: StructuredReferenceCatalogItem[]
  references: StructuredReferenceUse[]
  hasCurrentTarget: boolean
  query: string
  onQueryChange(value: string): void
  onSelect(item: StructuredReferenceCatalogItem, scope?: StructuredReferenceUse['scope']): void
  onDismiss(): void
}): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)
  const groups = useMemo(() => groupStructuredReferenceCatalog(items, ''), [items])
  const rows = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => { window.requestAnimationFrame(() => inputRef.current?.focus()) }, [])
  const selectActive = (): void => {
    const item = rows[activeIndex]
    const availableScopes = item ? allowedStructuredReferenceScopes(item.sourceKind, {}, { hasCurrentTarget }) : []
    const scope = item ? nextUnusedReferenceScope(references, item, availableScopes) : null
    if (item && scope) onSelect(item, scope)
  }
  return <AnchoredPopover anchor={anchor} anchorPoint={anchorPoint} ariaLabel="选择本次引用" className="reference-picker-popover" onDismiss={onDismiss}>
    <header>
      <div><b>引用项目资料</b></div>
      <button aria-label="关闭引用选择" onClick={onDismiss}><X size={14} /></button>
    </header>
    <label className="reference-picker-search">
      <Search size={14} />
      <input
        ref={inputRef}
        role="combobox"
        aria-label="搜索本次引用"
        aria-controls="reference-picker-results"
        aria-expanded="true"
        aria-activedescendant={rows[activeIndex] ? `reference-picker-option-${rows[activeIndex]!.sourceKey}` : undefined}
        value={query}
        placeholder="搜索本次素材、Brief、项目资料、图片、大纲、版本和对话……"
        onChange={(event) => { setActiveIndex(0); onQueryChange(event.currentTarget.value) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => rows.length ? (value + 1) % rows.length : 0) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => rows.length ? (value - 1 + rows.length) % rows.length : 0) }
          else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0) }
          else if (event.key === 'End') { event.preventDefault(); setActiveIndex(Math.max(0, rows.length - 1)) }
          else if (event.key === 'Enter') { event.preventDefault(); selectActive() }
        }}
      />
    </label>
    <div id="reference-picker-results" className="reference-picker-results" role="listbox">
      {groups.length ? groups.map((group) => <section key={group.id} aria-label={group.label}>
        <h3>{group.label}</h3>
        {group.items.map((item) => {
          const rowIndex = rows.indexOf(item)
          const availableScopes = allowedStructuredReferenceScopes(item.sourceKind, {}, { hasCurrentTarget })
          const used = referenceAlreadyUsed(references, item, availableScopes)
          const nextScope = nextUnusedReferenceScope(references, item, availableScopes)
          const hasSameSource = references.some((reference) => reference.sourceKey === item.sourceKey)
          const available = item.availability === 'ready'
          return <button
            id={`reference-picker-option-${item.sourceKey}`}
            key={item.sourceKey}
            role="option"
            aria-selected={rowIndex === activeIndex}
            aria-disabled={used}
            className={rowIndex === activeIndex ? 'active' : ''}
            onMouseMove={() => setActiveIndex(rowIndex)}
            onClick={() => { if (!used && nextScope) onSelect(item, nextScope) }}
          >
            <span className="reference-picker-icon">{item.group === 'project_image' ? <Image size={14} /> : <FileText size={14} />}</span>
            <span className="reference-picker-copy"><b>{item.label}</b><small>{item.summary}</small></span>
            <span className={`reference-picker-state${available ? '' : ' is-warning'}`}>{used ? <><Check size={11} />已引用</> : hasSameSource ? '换范围引用' : !available ? <><AlertTriangle size={11} />{availabilityLabel(item.availability)}</> : availabilityLabel(item.availability)}</span>
          </button>
        })}
      </section>) : <div className="reference-picker-empty">没有找到匹配的项目资料</div>}
    </div>
  </AnchoredPopover>
}
