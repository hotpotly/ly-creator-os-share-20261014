import { describe, expect, it } from 'vitest'
import {
  IPC_CHANNELS,
  RESPONSE_SCHEMAS,
  contentInstructionRequestGetPayloadSchema,
  contentInstructionRequestPreparePayloadSchema,
  structuredReferenceCatalogListPayloadSchema,
  structuredReferenceRolesResolvePayloadSchema
} from '../../src/shared/ipc'

const sourceKey = `ref_v1_${'a'.repeat(32)}`
const sha256 = 'b'.repeat(64)

function referenceUse() {
  return {
    occurrenceId: 'occurrence-brief',
    sourceKey,
    sourceKind: 'brief' as const,
    sourceId: 'brief-a',
    sourceLocator: { mentionFrom: 1, mentionTo: 7 },
    label: 'Brief',
    role: 'pending' as const,
    roleOrigin: 'pending' as const,
    runtimeRole: null,
    aspect: null,
    scope: 'whole_source' as const,
    ruleEvidence: null,
    manualConflictResolution: null
  }
}

function preparePayload() {
  return {
    projectId: 'project-a',
    sessionScope: 'script-conversation-a',
    surface: 'script_conversation' as const,
    target: null,
    displayText: '@Brief',
    editorDocument: { type: 'doc' },
    references: [referenceUse()],
    constraints: [],
    includeProjectContext: true,
    webSearchMode: 'automatic' as const,
    factRegion: 'CN',
    factAsOf: '2026-08-04T00:00:00.000Z',
    aiCount: 1 as const,
    targets: [{ providerConfigId: 'codex_cli_text_v1', requestedModel: 'auto' }]
  }
}

function requestRecord() {
  return {
    request: {
      id: 'request-a',
      projectId: 'project-a',
      sessionScope: 'script-conversation-a',
      surface: 'script_conversation' as const,
      supersedesRequestId: null,
      generationId: null,
      target: null,
      materialRevisionId: null,
      materialRevisionContentHash: null,
      briefVersionId: null,
      briefVersionContentHash: null,
      outlineVersionId: null,
      outlineVersionContentHash: null,
      adoptedOpeningSnapshots: [],
      displayText: '@Brief',
      editorDocument: { type: 'doc' },
      currentDocumentParagraphs: [],
      references: [],
      constraints: [],
      projectContextSnapshot: null,
      projectContextFingerprint: null,
      resourceSnapshotId: null,
      resourceSnapshot: null,
      resourceSnapshotFingerprint: null,
      webSearchMode: 'automatic' as const,
      factRegion: 'CN',
      factAsOf: '2026-08-04T00:00:00.000Z',
      inputBudget: { maxTokens: 120_000, estimatedTokens: 12, hardConstraintTokens: 0, truncatedOrdinaryReferenceIds: [] },
      aiCount: 1 as const,
      commonFingerprint: sha256,
      createdAt: '2026-08-04T00:00:00.000Z'
    },
    targets: [{
      id: 'target-a',
      requestId: 'request-a',
      provider: 'codex_cli' as const,
      providerConfigId: 'codex_cli_text_v1',
      providerSecurityFingerprint: 'provider-sha',
      providerPolicyVersion: 'policy-v1',
      runtimeVersion: 'codex-cli 1.0',
      requestedModel: 'auto',
      actualModel: 'gpt-5.6',
      requestedReasoningEffort: null,
      actualReasoningEffort: 'xhigh',
      historyThreadId: null,
      providerThreadId: null,
      historyMessageIds: [],
      historyHash: sha256,
      historyEstimatedTokens: 0,
      estimatedInputTokens: 12,
      taskId: null,
      status: 'queued' as const
    }],
    targetEvents: []
  }
}

describe('R16c structured-reference IPC contracts', () => {
  it('exposes Renderer-safe structured-reference channels without low-level mutation access', () => {
    const channels = [
      IPC_CHANNELS.structuredReferenceCatalogList,
      IPC_CHANNELS.structuredReferenceRolesResolve,
      IPC_CHANNELS.contentInstructionDispatch,
      IPC_CHANNELS.contentInstructionRequestGet
    ]
    expect(channels).toEqual([
      'structured-reference:catalog-list',
      'structured-reference:roles-resolve',
      'content-instruction-request:dispatch',
      'content-instruction-request:get'
    ])
    expect(new Set(channels).size).toBe(channels.length)
    expect(Object.values(IPC_CHANNELS)).not.toContain('content-instruction-request:prepare')
    expect(Object.values(IPC_CHANNELS)).not.toContain('content-instruction-request:target-event-append')
    expect(Object.values(IPC_CHANNELS)).not.toContain('script-material-chat:start')
    expect(Object.values(IPC_CHANNELS)).not.toContain('script-material-chat-batch:start')
    expect(Object.values(IPC_CHANNELS)).not.toContain('script-material-rewrite:start')
    expect(Object.values(IPC_CHANNELS)).not.toContain('draft-candidate:generate')
  })

  it('keeps catalog payloads bounded and catalog responses free of file paths or full content', () => {
    expect(structuredReferenceCatalogListPayloadSchema.parse({ projectId: 'project-a', sessionScope: 'script-conversation-a' }))
      .toEqual({ projectId: 'project-a', sessionScope: 'script-conversation-a', query: '' })
    expect(() => structuredReferenceCatalogListPayloadSchema.parse({ projectId: 'project-a', sessionScope: 'script-conversation-a', query: '', limit: 1 })).toThrow()
    expect(() => structuredReferenceCatalogListPayloadSchema.parse({ projectId: 'project-a' })).toThrow()
    const item = {
      sourceKey,
      sourceKind: 'brief' as const,
      sourceId: 'brief-a',
      label: 'Brief',
      summary: '产品容量和价格要求',
      group: 'brief' as const,
      sourceVersion: 'v1',
      availability: 'ready' as const,
      mimeType: 'text/plain',
      contentCharacters: 120,
      rememberedUse: null,
      rememberedUses: [],
      lastUsedAt: null
    }
    expect(RESPONSE_SCHEMAS.structuredReferenceCatalogItemSchema.parse(item)).toEqual(item)
    expect(() => RESPONSE_SCHEMAS.structuredReferenceCatalogItemSchema.parse({ ...item, absolutePath: '/private/brief.txt' })).toThrow()
    expect(() => RESPONSE_SCHEMAS.structuredReferenceCatalogItemSchema.parse({ ...item, frozenTextContent: '全文' })).toThrow()
  })

  it('validates deterministic role requests and responses without a Provider field', () => {
    const input = { text: '必须按@Brief的参数写。', references: [referenceUse()] }
    expect(structuredReferenceRolesResolvePayloadSchema.parse(input)).toEqual(input)
    expect(() => structuredReferenceRolesResolvePayloadSchema.parse({ ...input, providerConfigId: 'codex_cli_text_v1' })).toThrow()
    const response = { reference: referenceUse(), matchedEvidence: [], conflict: false }
    expect(RESPONSE_SCHEMAS.structuredReferenceRoleResolutionSchema.parse(response)).toEqual(response)
  })

  it('rejects Renderer budget ceilings and mismatched AI target counts', () => {
    expect(contentInstructionRequestPreparePayloadSchema.parse(preparePayload()).targets).toHaveLength(1)
    expect(contentInstructionRequestPreparePayloadSchema.parse({
      ...preparePayload(),
      resourceSelection: {
        excludedRecommendedResourceIds: ['resource-recommended-a'],
        manualResourceIds: ['resource-manual-a'],
        supportingMaterialIds: ['material-a']
      }
    }).resourceSelection).toEqual({
      excludedRecommendedResourceIds: ['resource-recommended-a'],
      manualResourceIds: ['resource-manual-a'],
      supportingMaterialIds: ['material-a']
    })
    expect(() => contentInstructionRequestPreparePayloadSchema.parse({ ...preparePayload(), maxInputTokens: 2_000_000 })).toThrow()
    expect(() => contentInstructionRequestPreparePayloadSchema.parse({ ...preparePayload(), aiCount: 2 })).toThrow()
  })

  it('requires strict get payloads and returns request, targets and append-only target events together', () => {
    expect(contentInstructionRequestGetPayloadSchema.parse({ requestId: 'request-a' })).toEqual({ requestId: 'request-a' })
    expect(() => contentInstructionRequestGetPayloadSchema.parse({ requestId: 'request-a', projectId: 'project-a' })).toThrow()
    const record = requestRecord()
    expect(RESPONSE_SCHEMAS.contentInstructionRequestRecordSchema.parse(record)).toEqual(record)
    const incomplete: Partial<typeof record> = { ...record }
    delete incomplete.targetEvents
    expect(() => RESPONSE_SCHEMAS.contentInstructionRequestRecordSchema.parse(incomplete)).toThrow()
  })
})
