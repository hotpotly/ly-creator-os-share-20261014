import type {
  FrozenStructuredReference,
  StructuredReferenceAvailability,
  StructuredReferenceCatalogItem,
  StructuredReferenceSourceKind,
  StructuredReferenceUse
} from '../shared/domain'
import {
  freezeStructuredReference,
  sha256,
  structuredReferenceSourceKey
} from './content-instruction-request'

export interface StructuredReferenceFact {
  projectId: string
  sourceKind: StructuredReferenceSourceKind
  sourceId: string
  label: string
  summary: string
  group: StructuredReferenceCatalogItem['group']
  sourceVersion: string
  availability: StructuredReferenceAvailability
  mimeType: string | null
  textContent: string | null
  managedAssetId: string | null
  binarySha256: string | null
  visualCapability: FrozenStructuredReference['visualCapability']
  visualSummaryVersion: string | null
}

const LOCATOR_KEYS = new Set([
  'mentionFrom',
  'mentionTo',
  'from',
  'to',
  'page',
  'paragraphId',
  'moduleId',
  'pointId',
  'expectedSourceVersion',
  'selectedTextSha256'
])

function safeCatalogText(value: string, fallback: string): string {
  const normalized = value.replace(/[\r\n\t]+/gu, ' ').replace(/\s{2,}/gu, ' ').trim()
  return (normalized || fallback).slice(0, 160)
}

export function toStructuredReferenceCatalogItem(fact: StructuredReferenceFact): StructuredReferenceCatalogItem {
  return {
    sourceKey: structuredReferenceSourceKey(fact.projectId, fact.sourceKind, fact.sourceId),
    sourceKind: fact.sourceKind,
    sourceId: fact.sourceId,
    label: safeCatalogText(fact.label, '未命名资料'),
    summary: safeCatalogText(fact.summary, '暂无摘要'),
    group: fact.group,
    sourceVersion: fact.sourceVersion,
    availability: fact.availability,
    mimeType: fact.mimeType,
    contentCharacters: fact.textContent?.length ?? 0,
    rememberedUse: null,
    rememberedUses: [],
    lastUsedAt: null
  }
}

export function assertSafeStructuredReferenceLocator(locator: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(locator)) {
    if (!LOCATOR_KEYS.has(key)) throw new Error('引用位置包含不允许的字段')
    if (typeof value === 'string' && (value.length > 256 || /(?:^|_)(?:path|url|token|secret|password|key)$/iu.test(key))) {
      throw new Error('引用位置可能包含未授权数据')
    }
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error('引用位置无效')
  }
}

function selectedFactText(fact: StructuredReferenceFact, use: StructuredReferenceUse): string | null {
  if (use.scope !== 'source_fragment') return fact.textContent
  if (fact.textContent === null) return null
  const from = use.sourceLocator.from
  const to = use.sourceLocator.to
  const expectedSourceVersion = use.sourceLocator.expectedSourceVersion
  const selectedTextSha256 = use.sourceLocator.selectedTextSha256
  if (typeof from !== 'number' || typeof to !== 'number' || to <= from || to > fact.textContent.length) {
    throw new Error('引用片段已变化，请重新选择')
  }
  if (typeof expectedSourceVersion !== 'string' || expectedSourceVersion !== fact.sourceVersion) {
    throw new Error('引用来源版本已变化，请重新选择')
  }
  const selected = fact.textContent.slice(from, to)
  if (typeof selectedTextSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(selectedTextSha256) || selectedTextSha256 !== sha256(selected)) {
    throw new Error('引用片段内容已变化，请重新选择')
  }
  return selected
}

function assertStructuredReferenceRoleSemantics(use: StructuredReferenceUse): void {
  if (use.role === 'pending') {
    const validFallback = use.roleOrigin === 'runtime_fallback' && use.runtimeRole === 'ordinary_reference'
    const unresolved = use.roleOrigin === 'pending' && use.runtimeRole === null
    if (!validFallback && !unresolved) throw new Error(`引用“${use.label}”的待定用途状态无效`)
    return
  }
  if (use.roleOrigin === 'pending' || use.roleOrigin === 'runtime_fallback' || use.runtimeRole !== use.role) {
    throw new Error(`引用“${use.label}”的显示用途与运行时用途不一致`)
  }
}

export function resolveStructuredReferenceFact(
  projectId: string,
  use: StructuredReferenceUse,
  facts: StructuredReferenceFact[]
): FrozenStructuredReference {
  assertSafeStructuredReferenceLocator(use.sourceLocator)
  assertStructuredReferenceRoleSemantics(use)
  const expectedSourceKey = structuredReferenceSourceKey(projectId, use.sourceKind, use.sourceId)
  if (use.sourceKey !== expectedSourceKey) throw new Error('引用身份校验失败')
  const fact = facts.find((candidate) => (
    candidate.projectId === projectId
    && candidate.sourceKind === use.sourceKind
    && candidate.sourceId === use.sourceId
  ))
  if (!fact) throw new Error('引用不存在或不属于当前项目')
  const role = use.runtimeRole ?? (use.role === 'pending' ? null : use.role)
  if ((role === 'hard_constraint' || role === 'key_adoption') && fact.availability !== 'ready') {
    throw new Error(`必须使用的引用“${fact.label}”当前不可读`)
  }
  return freezeStructuredReference({
    use: { ...use, label: safeCatalogText(fact.label, use.label) },
    sourceVersion: fact.sourceVersion,
    textContent: selectedFactText(fact, use),
    managedAssetId: fact.managedAssetId,
    binarySha256: fact.binarySha256,
    visualCapability: fact.visualCapability,
    visualSummaryVersion: fact.visualSummaryVersion,
    availability: fact.availability
  })
}

export function availabilityForMaterial(parseStatus: string, hasText: boolean): StructuredReferenceAvailability {
  if (parseStatus === 'ready' && hasText) return 'ready'
  if (parseStatus === 'pending') return 'processing'
  if (parseStatus === 'stored_only' || parseStatus === 'link_only') return 'stored_only'
  if (parseStatus === 'failed') return 'unsupported'
  return 'missing'
}

export function availabilityForFile(availability: string, processState: string): StructuredReferenceAvailability {
  if (availability === 'permission_required') return 'authorization_required'
  if (availability === 'source_missing') return 'missing'
  if (availability === 'failed' || processState === 'failed') return 'unsupported'
  if (processState === 'pending') return 'processing'
  if (processState === 'stored_only') return 'stored_only'
  return availability === 'available' && processState === 'ready' ? 'ready' : 'missing'
}
