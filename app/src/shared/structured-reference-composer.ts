import type {
  ResolvedStructuredReferenceRole,
  StructuredReferenceCatalogItem,
  StructuredReferenceRole,
  StructuredReferenceScope,
  StructuredReferenceUse
} from './domain'

export interface StructuredComposerSnapshot {
  displayText: string
  editorDocument: Record<string, unknown>
  references: StructuredReferenceUse[]
}

export interface StructuredReferencePickerGroup {
  id: string
  label: string
  items: StructuredReferenceCatalogItem[]
}

const pickerGroups: ReadonlyArray<{ id: string; label: string; sourceGroups: StructuredReferenceCatalogItem['group'][] }> = [
  { id: 'current', label: '本次素材', sourceGroups: ['current_material'] },
  { id: 'project', label: 'Brief与项目资料', sourceGroups: ['brief', 'client_feedback', 'project_material'] },
  { id: 'visual', label: '图片和资料组', sourceGroups: ['project_image', 'material_group'] },
  { id: 'outline', label: '大纲', sourceGroups: ['outline'] },
  { id: 'history', label: '历史', sourceGroups: ['history'] },
  { id: 'style', label: '风格', sourceGroups: ['style'] },
  { id: 'conversation', label: '本次对话', sourceGroups: ['conversation'] },
  { id: 'temporary', label: '临时', sourceGroups: ['temporary'] }
]

export function allowedStructuredReferenceScopes(
  sourceKind: StructuredReferenceUse['sourceKind'],
  sourceLocator: StructuredReferenceUse['sourceLocator'] = {},
  options: { hasCurrentTarget?: boolean; allowWholeScript?: boolean } = {}
): StructuredReferenceScope[] {
  const primary: StructuredReferenceScope = sourceKind === 'project_material_group'
    ? 'frozen_group_members'
    : sourceKind === 'outline_version' ? 'whole_outline'
      : sourceKind === 'outline_module' ? 'outline_module'
        : sourceKind === 'outline_point' ? 'outline_point'
          : 'whole_source'
  const fragmentReady = typeof sourceLocator.from === 'number' && typeof sourceLocator.to === 'number'
    && typeof sourceLocator.expectedSourceVersion === 'string' && typeof sourceLocator.selectedTextSha256 === 'string'
  return [...new Set<StructuredReferenceScope>([
    primary,
    ...(fragmentReady ? ['source_fragment' as const] : []),
    ...(options.hasCurrentTarget === false ? [] : ['current_target' as const]),
    ...(options.allowWholeScript === false ? [] : ['whole_script' as const])
  ])]
}

export function executableReferenceScope(item: Pick<StructuredReferenceCatalogItem, 'sourceKind'>): StructuredReferenceScope {
  return allowedStructuredReferenceScopes(item.sourceKind)[0]!
}

export function groupStructuredReferenceCatalog(items: StructuredReferenceCatalogItem[], query = ''): StructuredReferencePickerGroup[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  const filtered = normalized
    ? items.filter((item) => `${item.label}\n${item.summary}`.toLocaleLowerCase('zh-CN').includes(normalized))
    : items
  const current = filtered.filter((item) => item.group === 'current_material')
  const recent = filtered.filter((item) => item.group !== 'current_material' && item.lastUsedAt !== null)
    .sort((left, right) => right.lastUsedAt!.localeCompare(left.lastUsedAt!) || left.sourceKey.localeCompare(right.sourceKey))
  const recentKeys = new Set(recent.map((item) => item.sourceKey))
  const remaining = filtered.filter((item) => item.group !== 'current_material' && !recentKeys.has(item.sourceKey))
  return [
    ...(current.length ? [{ id: 'current', label: '本次素材', items: current }] : []),
    ...(recent.length ? [{ id: 'recent', label: '最近使用', items: recent }] : []),
    ...pickerGroups.flatMap((group) => {
    if (group.id === 'current') return []
    const grouped = remaining.filter((item) => group.sourceGroups.includes(item.group))
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN') || left.sourceKey.localeCompare(right.sourceKey))
    return grouped.length ? [{ id: group.id, label: group.label, items: grouped }] : []
    })
  ]
}

export function createStructuredReferenceUse(
  item: StructuredReferenceCatalogItem,
  requestedScope?: StructuredReferenceScope,
  availableScopes = allowedStructuredReferenceScopes(item.sourceKind)
): StructuredReferenceUse {
  const remembered = requestedScope
    ? item.rememberedUses.find((preference) => preference.scope === requestedScope) ?? null
    : item.rememberedUse
  const scope = requestedScope ?? remembered?.scope ?? executableReferenceScope(item)
  if (!availableScopes.includes(scope)) throw new Error('引用作用范围与当前任务不匹配')
  const usesRememberedDefault = Boolean(remembered && (!requestedScope || requestedScope === remembered.scope))
  return {
    occurrenceId: `reference-${crypto.randomUUID()}`,
    sourceKey: item.sourceKey,
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceLocator: {},
    label: item.label,
    role: usesRememberedDefault ? remembered!.role : 'pending',
    roleOrigin: usesRememberedDefault ? 'project_memory' : 'pending',
    runtimeRole: usesRememberedDefault ? remembered!.role : null,
    projectMemory: usesRememberedDefault ? { ...remembered! } : null,
    aspect: usesRememberedDefault ? remembered!.aspect : null,
    scope,
    ruleEvidence: null,
    ruleConflicts: [],
    manualConflictResolution: null
  }
}

export function referenceAlreadyUsed(references: StructuredReferenceUse[], item: StructuredReferenceCatalogItem, availableScopes = allowedStructuredReferenceScopes(item.sourceKind)): boolean {
  const usedScopes = new Set(references.filter((reference) => reference.sourceKey === item.sourceKey).map((reference) => reference.scope))
  return availableScopes.every((scope) => usedScopes.has(scope))
}

export function nextUnusedReferenceScope(references: StructuredReferenceUse[], item: StructuredReferenceCatalogItem, availableScopes = allowedStructuredReferenceScopes(item.sourceKind)): StructuredReferenceScope | null {
  const usedScopes = new Set(references.filter((reference) => reference.sourceKey === item.sourceKey).map((reference) => reference.scope))
  return availableScopes.find((scope) => !usedScopes.has(scope)) ?? null
}

export function referenceRoleLabel(role: StructuredReferenceRole): string {
  return ({
    pending: '待定',
    hard_constraint: '硬性遵守',
    key_adoption: '重点采用',
    ordinary_reference: '普通参考',
    style_reference: '只参考风格'
  } satisfies Record<StructuredReferenceRole, string>)[role]
}

export function referenceScopeLabel(scope: StructuredReferenceScope): string {
  return ({
    whole_source: '整份资料',
    source_fragment: '所选片段',
    frozen_group_members: '资料组全部成员',
    outline_module: '大纲模块',
    outline_point: '大纲要点',
    current_target: '当前修改目标',
    whole_outline: '完整大纲',
    whole_script: '完整文案'
  } satisfies Record<StructuredReferenceScope, string>)[scope]
}

export function withManualReferenceRole(
  reference: StructuredReferenceUse,
  role: ResolvedStructuredReferenceRole,
  scope: StructuredReferenceScope,
  aspect: string | null,
  conflictResolution: StructuredReferenceUse['manualConflictResolution'] = null,
  remembered = false
): StructuredReferenceUse {
  return {
    ...reference,
    role,
    roleOrigin: remembered ? 'project_memory' : 'manual',
    runtimeRole: role,
    projectMemory: remembered ? { role, scope, aspect: aspect?.trim() || null } : null,
    scope,
    aspect: aspect?.trim() || null,
    manualConflictResolution: conflictResolution,
    ruleEvidence: remembered ? null : reference.ruleEvidence
  }
}

export function withRuntimeFallback(reference: StructuredReferenceUse): StructuredReferenceUse {
  if (reference.role !== 'pending') return reference
  return {
    ...reference,
    roleOrigin: 'runtime_fallback',
    runtimeRole: 'ordinary_reference',
    manualConflictResolution: null
  }
}

export function composerBlockingReferences(references: StructuredReferenceUse[]): StructuredReferenceUse[] {
  return references.filter((reference) => (
    (reference.ruleConflicts?.length ?? 0) > 0
    || reference.manualConflictResolution === 'unresolved'
  ))
}

export function composerPendingReferences(references: StructuredReferenceUse[]): StructuredReferenceUse[] {
  return references.filter((reference) => reference.role === 'pending' && reference.roleOrigin !== 'runtime_fallback')
}
