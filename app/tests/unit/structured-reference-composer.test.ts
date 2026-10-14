import { describe, expect, it } from 'vitest'
import type { StructuredReferenceCatalogItem } from '../../src/shared/domain'
import {
  composerBlockingReferences,
  composerPendingReferences,
  createStructuredReferenceUse,
  groupStructuredReferenceCatalog,
  allowedStructuredReferenceScopes,
  nextUnusedReferenceScope,
  referenceAlreadyUsed,
  withManualReferenceRole,
  withRuntimeFallback
} from '../../src/shared/structured-reference-composer'

function item(id: string, group: StructuredReferenceCatalogItem['group'], label = id): StructuredReferenceCatalogItem {
  return {
    sourceKey: `ref_v1_${id.padEnd(32, 'a').slice(0, 32)}`,
    sourceKind: group === 'brief' ? 'brief' : group === 'project_image' ? 'project_image' : 'project_material',
    sourceId: id,
    label,
    summary: `${label}摘要`,
    group,
    sourceVersion: 'v1',
    availability: 'ready',
    mimeType: 'text/plain',
    contentCharacters: 12,
    rememberedUse: null,
    rememberedUses: [],
    lastUsedAt: null
  }
}

describe('R16d structured reference composer state', () => {
  it('groups the compact picker in the confirmed project order and searches labels or summaries', () => {
    const catalog = [
      item('history', 'history', '历史稿'), item('image', 'project_image', '外观图'), item('brief', 'brief', '客户Brief'),
      item('temporary', 'temporary', '临时附件'), item('material', 'current_material', '当前素材'), item('style', 'style', '语气样本'),
      item('outline', 'outline', '大纲v2'), item('conversation', 'conversation', '本次讨论')
    ]
    expect(groupStructuredReferenceCatalog(catalog).map((group) => group.label)).toEqual([
      '本次素材', 'Brief与项目资料', '图片和资料组', '大纲', '历史', '风格', '本次对话', '临时'
    ])
    expect(groupStructuredReferenceCatalog(catalog, '外观').flatMap((group) => group.items).map((entry) => entry.sourceId)).toEqual(['image'])
    expect(groupStructuredReferenceCatalog(catalog, '摘要').flatMap((group) => group.items)).toHaveLength(catalog.length)
  })

  it('places remembered project sources in a single recent group before the normal catalog', () => {
    const remembered = {
      ...item('brief', 'brief', '客户Brief'),
      rememberedUse: { role: 'hard_constraint' as const, aspect: '参数', scope: 'whole_source' as const },
      rememberedUses: [{ role: 'hard_constraint' as const, aspect: '参数', scope: 'whole_source' as const }],
      lastUsedAt: '2026-08-04T10:00:00.000Z'
    }
    const groups = groupStructuredReferenceCatalog([item('material', 'current_material', '当前素材'), remembered])
    expect(groups.map((group) => group.label)).toEqual(['本次素材', '最近使用'])
    expect(groups.flatMap((group) => group.items).filter((entry) => entry.sourceId === 'brief')).toHaveLength(1)
  })

  it('creates executable pending chips and prevents duplicate occurrences of the same source', () => {
    const catalogItem = item('brief', 'brief', 'Brief')
    const reference = createStructuredReferenceUse(catalogItem)
    expect(reference).toMatchObject({ role: 'pending', roleOrigin: 'pending', runtimeRole: null, projectMemory: null, scope: 'whole_source' })
    expect(referenceAlreadyUsed([reference], catalogItem)).toBe(false)
    expect(nextUnusedReferenceScope([reference], catalogItem)).toBe('current_target')
    const allScopes = ['whole_source', 'current_target', 'whole_script'].map((scope, index) => ({
      ...reference, occurrenceId: `reference-${index}`, scope: scope as typeof reference.scope
    }))
    expect(referenceAlreadyUsed(allScopes, catalogItem)).toBe(true)
    expect(createStructuredReferenceUse({ ...catalogItem, sourceKind: 'project_material_group' })).toMatchObject({ scope: 'frozen_group_members' })
  })

  it('does not offer a nonexistent current target and keeps alternate scopes distinct', () => {
    const catalogItem = item('brief', 'brief', 'Brief')
    const availableScopes = allowedStructuredReferenceScopes(catalogItem.sourceKind, {}, { hasCurrentTarget: false })
    expect(availableScopes).toEqual(['whole_source', 'whole_script'])
    const first = createStructuredReferenceUse(catalogItem, 'whole_source', availableScopes)
    expect(nextUnusedReferenceScope([first], catalogItem, availableScopes)).toBe('whole_script')
    expect(() => createStructuredReferenceUse(catalogItem, 'current_target', availableScopes)).toThrow('当前任务不匹配')
  })

  it('keeps manual roles explicit and only converts pending chips to an auditable one-round fallback', () => {
    const reference = createStructuredReferenceUse(item('brief', 'brief', 'Brief'))
    expect(composerPendingReferences([reference])).toEqual([reference])
    const fallback = withRuntimeFallback(reference)
    expect(fallback).toMatchObject({ role: 'pending', roleOrigin: 'runtime_fallback', runtimeRole: 'ordinary_reference' })
    expect(composerPendingReferences([fallback])).toHaveLength(0)

    const manual = withManualReferenceRole(reference, 'style_reference', 'whole_source', '语气', 'keep_manual')
    expect(manual).toMatchObject({ role: 'style_reference', roleOrigin: 'manual', runtimeRole: 'style_reference', aspect: '语气' })
    expect(composerBlockingReferences([{ ...manual, manualConflictResolution: 'unresolved' }])).toHaveLength(1)
  })

  it('restores an exact remembered use when the catalog carries project memory', () => {
    const catalogItem = {
      ...item('style', 'style', '风格稿'),
      rememberedUse: { role: 'style_reference' as const, aspect: '节奏', scope: 'whole_source' as const },
      rememberedUses: [{ role: 'style_reference' as const, aspect: '节奏', scope: 'whole_source' as const }]
    }
    expect(createStructuredReferenceUse(catalogItem)).toMatchObject({
      role: 'style_reference', roleOrigin: 'project_memory', runtimeRole: 'style_reference',
      projectMemory: { role: 'style_reference', aspect: '节奏', scope: 'whole_source' }, aspect: '节奏'
    })
  })
})
