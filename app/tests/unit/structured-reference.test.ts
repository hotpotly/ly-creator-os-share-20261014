import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_REFERENCE_GOLDEN_CORPUS,
  resolveStructuredReferenceRoles,
  type FrozenStructuredReference,
  type StructuredReferenceUse
} from '../../src/shared/domain'
import {
  allocateContentInstructionBudget,
  assertContentInstructionTargetsMatchRequest,
  buildContentInstructionRequest,
  canonicalSha256,
  contentInstructionCommonFingerprint,
  freezeStructuredReference,
  structuredReferenceSourceKey
} from '../../src/main/content-instruction-request'
import { contentInstructionRequestPreparePayloadSchema, structuredReferenceUseSchema } from '../../src/shared/structured-reference-schema'

function reference(label: string, patch: Partial<StructuredReferenceUse> = {}): StructuredReferenceUse {
  return {
    occurrenceId: `occurrence-${label}`,
    sourceKey: `source-${label}`,
    sourceKind: 'project_material',
    sourceId: `id-${label}`,
    sourceLocator: {},
    label,
    role: 'pending',
    roleOrigin: 'pending',
    runtimeRole: null,
    aspect: null,
    scope: 'whole_source',
    ruleEvidence: null,
    manualConflictResolution: null,
    ...patch
  }
}

function frozen(label: string, role: FrozenStructuredReference['role'], text: string): FrozenStructuredReference {
  return freezeStructuredReference({
    use: reference(label, { role, roleOrigin: role === 'pending' ? 'pending' : 'manual', runtimeRole: role === 'pending' ? null : role }),
    sourceVersion: 'v1',
    textContent: text,
    managedAssetId: null,
    binarySha256: null,
    visualCapability: null,
    visualSummaryVersion: null,
    availability: 'ready'
  })
}

describe('structured reference deterministic roles', () => {
  it('keeps the real-expression Golden Corpus reproducible without a Provider', () => {
    for (const sample of STRUCTURED_REFERENCE_GOLDEN_CORPUS) {
      const result = resolveStructuredReferenceRoles(sample.text, [reference(sample.label)])[0]!
      expect(result.reference.role, sample.id).toBe(sample.expectedRole)
      if (sample.expectedAspect !== undefined) expect(result.reference.aspect, sample.id).toBe(sample.expectedAspect)
      expect(result.conflict, sample.id).toBe(sample.expectedConflict ?? false)
      if (sample.expectedRole !== 'pending') expect(result.reference.ruleEvidence, sample.id).not.toBeNull()
    }
  })

  it('does not overwrite a manual role and exposes the rule conflict', () => {
    const result = resolveStructuredReferenceRoles('必须按@Brief的参数来写。', [reference('Brief', {
      role: 'ordinary_reference',
      roleOrigin: 'manual',
      runtimeRole: 'ordinary_reference'
    })])[0]!

    expect(result.reference.role).toBe('ordinary_reference')
    expect(result.reference.roleOrigin).toBe('manual')
    expect(result.reference.manualConflictResolution).toBe('unresolved')
    expect(result.reference.ruleEvidence).toMatchObject({ ruleId: 'hard-mandatory-v1', resolvedRole: 'hard_constraint' })
    expect(result.conflict).toBe(true)
  })

  it('honors an explicit manual conflict decision and only uses project memory without a current cue', () => {
    const keepManual = resolveStructuredReferenceRoles('必须按@Brief的参数来写。', [reference('Brief', {
      role: 'ordinary_reference',
      roleOrigin: 'manual',
      runtimeRole: 'ordinary_reference',
      manualConflictResolution: 'keep_manual'
    })])[0]!
    expect(keepManual.reference.role).toBe('ordinary_reference')
    expect(keepManual.reference.roleOrigin).toBe('manual')
    expect(keepManual.conflict).toBe(false)

    const acceptRule = resolveStructuredReferenceRoles('必须按@Brief的参数来写。', [reference('Brief', {
      role: 'ordinary_reference',
      roleOrigin: 'manual',
      runtimeRole: 'ordinary_reference',
      manualConflictResolution: 'accept_rule'
    })])[0]!
    expect(acceptRule.reference.role).toBe('hard_constraint')
    expect(acceptRule.reference.roleOrigin).toBe('deterministic_rule')
    expect(acceptRule.conflict).toBe(false)

    const memory = reference('Brief', {
      role: 'style_reference',
      roleOrigin: 'project_memory',
      runtimeRole: 'style_reference',
      projectMemory: { role: 'style_reference', aspect: '语气', scope: 'whole_source' },
      aspect: '语气'
    })
    expect(resolveStructuredReferenceRoles('这个@Brief可能有用。', [memory])[0]!.reference.role).toBe('style_reference')
    const explicit = resolveStructuredReferenceRoles('必须按@Brief的参数来写。', [memory])[0]!.reference
    expect(explicit).toMatchObject({ role: 'hard_constraint', roleOrigin: 'deterministic_rule', projectMemory: memory.projectMemory })
    const restored = resolveStructuredReferenceRoles('这个@Brief可能有用。', [explicit])[0]!.reference
    expect(restored).toMatchObject({ role: 'style_reference', roleOrigin: 'project_memory', aspect: '语气', projectMemory: memory.projectMemory })
  })

  it('uses explicit mention coordinates when labels repeat', () => {
    const text = '参考@资料。重点采用@资料。'
    const firstFrom = text.indexOf('@资料')
    const secondFrom = text.indexOf('@资料', firstFrom + 1)
    const first = reference('资料', { occurrenceId: 'first', sourceLocator: { mentionFrom: firstFrom, mentionTo: firstFrom + 3 } })
    const second = reference('资料', { occurrenceId: 'second', sourceLocator: { mentionFrom: secondFrom, mentionTo: secondFrom + 3 } })
    const resolved = resolveStructuredReferenceRoles(text, [first, second])
    expect(resolved[0]!.reference.role).toBe('ordinary_reference')
    expect(resolved[1]!.reference.role).toBe('key_adoption')
  })

  it('does not leak role cues between different references in the same sentence', () => {
    const text = '重点采用@资料A，只参考@资料B的语气。'
    const firstFrom = text.indexOf('@资料A')
    const secondFrom = text.indexOf('@资料B')
    const resolved = resolveStructuredReferenceRoles(text, [
      reference('资料A', { occurrenceId: 'a', sourceLocator: { mentionFrom: firstFrom, mentionTo: firstFrom + 4 } }),
      reference('资料B', { occurrenceId: 'b', sourceLocator: { mentionFrom: secondFrom, mentionTo: secondFrom + 4 } })
    ])
    expect(resolved[0]!.reference.role).toBe('key_adoption')
    expect(resolved[1]!.reference.role).toBe('style_reference')
  })

  it('rejects stale mention coordinates and inconsistent display/runtime roles', () => {
    const text = '参考@Brief。'
    expect(() => resolveStructuredReferenceRoles(text, [reference('Brief', {
      sourceLocator: { mentionFrom: 0, mentionTo: 6 }
    })])).toThrow('提及位置已变化')
    expect(() => structuredReferenceUseSchema.parse(reference('Brief', {
      sourceKey: `ref_v1_${'a'.repeat(32)}`,
      role: 'hard_constraint', roleOrigin: 'manual', runtimeRole: 'ordinary_reference'
    }))).toThrow('显示用途与运行时用途必须一致')
    expect(() => structuredReferenceUseSchema.parse(reference('Brief', {
      sourceKey: `ref_v1_${'a'.repeat(32)}`,
      roleOrigin: 'runtime_fallback', runtimeRole: 'hard_constraint'
    }))).toThrow('待定引用只能')
    expect(structuredReferenceUseSchema.parse(reference('Brief', {
      sourceKey: `ref_v1_${'a'.repeat(32)}`,
      roleOrigin: 'runtime_fallback', runtimeRole: 'ordinary_reference'
    }))).toMatchObject({ role: 'pending', roleOrigin: 'runtime_fallback', runtimeRole: 'ordinary_reference' })
  })
})

describe('immutable content instruction request', () => {
  it('creates opaque project-scoped source keys', () => {
    expect(structuredReferenceSourceKey('project-a', 'brief', 'brief-1')).toMatch(/^ref_v1_[a-f0-9]{32}$/)
    expect(structuredReferenceSourceKey('project-a', 'brief', 'brief-1')).not.toBe(structuredReferenceSourceKey('project-b', 'brief', 'brief-1'))
    expect(structuredReferenceSourceKey('project-a', 'brief', 'brief-1')).not.toContain('brief-1')
  })

  it('never truncates hard references and reports omitted ordinary references', () => {
    const hard = frozen('Brief', 'hard_constraint', '硬性参数'.repeat(20))
    const ordinary = frozen('普通资料', 'ordinary_reference', '普通参考'.repeat(200))
    const budget = allocateContentInstructionBudget({ maxTokens: 300, baseText: '写一篇文案', references: [hard, ordinary] })
    expect(budget.hardConstraintTokens).toBeGreaterThan(0)
    expect(budget.truncatedOrdinaryReferenceIds).toEqual([ordinary.occurrenceId])

    expect(() => allocateContentInstructionBudget({
      maxTokens: 256,
      baseText: '写一篇文案',
      references: [frozen('超长Brief', 'hard_constraint', '必须保留'.repeat(300))]
    })).toThrow('不能静默截断')

    const hardImage = freezeStructuredReference({
      use: reference('外观图', { role: 'hard_constraint', roleOrigin: 'manual', runtimeRole: 'hard_constraint' }),
      sourceVersion: 'image-v1', textContent: null, managedAssetId: 'image-a', binarySha256: 'b'.repeat(64),
      visualCapability: 'native_image_input', visualSummaryVersion: null, availability: 'ready'
    })
    expect(allocateContentInstructionBudget({ maxTokens: 2_000, baseText: '', references: [hardImage] }).hardConstraintTokens).toBe(1_024)

    const hardImageGroup = freezeStructuredReference({
      use: reference('外观图组', { role: 'hard_constraint', roleOrigin: 'manual', runtimeRole: 'hard_constraint' }),
      sourceVersion: 'group-v1', textContent: '[]', managedAssetId: null, binarySha256: null,
      visualCapability: null, visualSummaryVersion: null, availability: 'ready',
      frozenMembers: [0, 1].map((order) => ({
        occurrenceId: `group-member-${order}`, sourceKey: `ref_v1_${String(order).repeat(32)}`,
        sourceKind: 'project_image' as const, sourceVersion: 'v1', contentSha256: 'c'.repeat(64),
        managedAssetId: `image-${order}`, binarySha256: 'd'.repeat(64), order
      }))
    })
    expect(allocateContentInstructionBudget({ maxTokens: 3_000, baseText: '', references: [hardImageGroup] }).hardConstraintTokens).toBeGreaterThanOrEqual(2_048)
  })

  it('freezes target, context, region, fact time, budget and a stable common fingerprint', () => {
    const build = (id: string) => buildContentInstructionRequest({
      id,
      projectId: 'project-a',
      sessionScope: 'script-conversation-a',
      surface: 'current_script_rewrite',
      target: { kind: 'current_script', workingDocumentId: 'working-a', revision: 3, contentHash: 'a'.repeat(64), blockSelections: [{ blockId: 'block-a', from: 0, to: 2, text: '原文' }] },
      displayText: '按@Brief参数改写',
      editorDocument: { type: 'doc', content: [] },
      references: [frozen('Brief', 'hard_constraint', '价格为100元')],
      constraints: [{ id: 'constraint-a', kind: 'hard_constraint', sourceOccurrenceId: 'occurrence-Brief', description: '价格必须准确' }],
      projectContextSnapshot: { projectTitle: '项目A', enabled: true },
      resourceSnapshotId: 'resource-snapshot-a',
      resourceSnapshot: { sources: ['brief-a'], version: 1 },
      webSearchMode: 'required',
      factRegion: 'CN',
      factAsOf: '2026-08-04T00:00:00.000Z',
      maxInputTokens: 2_000,
      aiCount: 2,
      createdAt: '2026-08-04T00:00:00.000Z'
    })
    const first = build('request-a')
    const second = build('request-b')
    expect(first.commonFingerprint).toBe(second.commonFingerprint)
    expect(contentInstructionCommonFingerprint(first)).toBe(first.commonFingerprint)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.references[0])).toBe(true)
    expect(first).toMatchObject({
      aiCount: 2,
      factRegion: 'CN',
      factAsOf: '2026-08-04T00:00:00.000Z',
      projectContextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      resourceSnapshotFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      inputBudget: { maxTokens: 2_000, truncatedOrdinaryReferenceIds: [] }
    })
  })

  it('clones mutable caller input and canonicalizes object keys without locale-dependent ordering', () => {
    const editorDocument = { z: { value: '原始' }, a: 1 }
    const request = buildContentInstructionRequest({
      projectId: 'project-a',
      sessionScope: 'script-conversation-a',
      surface: 'script_conversation',
      target: null,
      displayText: '生成文案',
      editorDocument,
      references: [],
      constraints: [],
      projectContextSnapshot: null,
      resourceSnapshot: null,
      webSearchMode: 'automatic',
      factRegion: 'CN',
      factAsOf: '2026-08-04T00:00:00.000Z',
      maxInputTokens: 1_000,
      aiCount: 1,
      createdAt: '2026-08-04T00:00:00.000Z'
    })
    editorDocument.z.value = '篡改'
    expect(request.editorDocument).toEqual({ z: { value: '原始' }, a: 1 })
    expect(canonicalSha256({ z: 1, a: 2 })).toBe(canonicalSha256({ a: 2, z: 1 }))
    expect(contentInstructionCommonFingerprint(request)).toBe(request.commonFingerprint)
  })

  it('keeps the input ceiling under Main control instead of accepting it from Renderer', () => {
    const payload = {
      projectId: 'project-a',
      sessionScope: 'script-conversation-a',
      surface: 'script_conversation',
      target: null,
      displayText: '生成文案',
      editorDocument: {},
      references: [],
      constraints: [],
      includeProjectContext: false,
      webSearchMode: 'automatic',
      factRegion: 'CN',
      factAsOf: '2026-08-04T00:00:00.000Z',
      aiCount: 1,
      targets: [{ providerConfigId: 'codex-default', requestedModel: 'gpt-5.6' }]
    }
    expect(contentInstructionRequestPreparePayloadSchema.parse(payload)).not.toHaveProperty('maxInputTokens')
    expect(() => contentInstructionRequestPreparePayloadSchema.parse({ ...payload, maxInputTokens: 2_000_000 })).toThrow()
  })

  it('keeps the requested auto choice while requiring a concrete Codex runtime model', () => {
    const request = buildContentInstructionRequest({
      projectId: 'project-a', surface: 'script_conversation', target: null,
      sessionScope: 'script-conversation-a',
      displayText: '生成文案', editorDocument: {}, references: [], constraints: [],
      projectContextSnapshot: null, resourceSnapshot: null, webSearchMode: 'automatic',
      factRegion: 'CN', factAsOf: '2026-08-04T00:00:00.000Z', maxInputTokens: 1_000, aiCount: 1
    })
    const target = {
      providerConfigId: 'codex_cli_text_v1',
      providerSecurity: {
        provider: 'codex_cli' as const,
        providerConfigId: 'codex_cli_text_v1',
        displayName: 'Codex CLI',
        cliVersion: '1.0.0',
        fingerprint: 'provider-fingerprint',
        policyVersion: 'policy-v1'
      },
      requestedModel: 'auto',
      actualModel: 'gpt-5.6',
      requestedReasoningEffort: null,
      actualReasoningEffort: 'xhigh',
      historyThreadId: null,
      providerThreadId: null,
      historyMessageIds: [],
      historyHash: 'a'.repeat(64)
    }
    expect(() => assertContentInstructionTargetsMatchRequest(request, [target])).not.toThrow()
    expect(() => assertContentInstructionTargetsMatchRequest(request, [{ ...target, actualModel: null }])).toThrow('必须在发送前冻结')
    const requiredWebRequest = { ...request, webSearchMode: 'required' as const }
    const claudeTarget = {
      ...target,
      providerConfigId: 'claude_cli_text_v1',
      providerSecurity: {
        ...target.providerSecurity,
        provider: 'claude_cli' as const,
        providerConfigId: 'claude_cli_text_v1'
      },
      requestedModel: 'claude-default',
      actualModel: null,
      actualReasoningEffort: null
    }
    expect(() => assertContentInstructionTargetsMatchRequest(requiredWebRequest, [claudeTarget])).toThrow('Claude当前不支持必须联网')
  })

  it('requires every optional source version id and content hash to be frozen together', () => {
    expect(() => buildContentInstructionRequest({
      projectId: 'project-a', sessionScope: 'script-conversation-a', surface: 'script_conversation', target: null,
      materialRevisionId: 'revision-a', displayText: '生成文案', editorDocument: {}, references: [], constraints: [],
      projectContextSnapshot: null, resourceSnapshot: null, webSearchMode: 'automatic', factRegion: 'CN',
      factAsOf: '2026-08-04T00:00:00.000Z', maxInputTokens: 1_000, aiCount: 1
    })).toThrow('素材修订身份与内容哈希必须同时冻结')
  })
})
