import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalSha256, sha256, structuredReferenceSourceKey } from '../../src/main/content-instruction-request'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { WorkspaceRepository } from '../../src/main/db/repository'
import { seedWorkspace } from '../../src/main/db/seed'
import type {
  ContentInstructionTargetPreparation,
  StructuredReferenceCatalogItem,
  StructuredReferenceUse
} from '../../src/shared/domain'

const databases: BetterSqlite3.Database[] = []
const SESSION_SCOPE = 'r16c-test'

function createRepository(): WorkspaceRepository {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runMigrations(database)
  seedWorkspace(database, true)
  return new WorkspaceRepository(database)
}

function referenceUse(item: StructuredReferenceCatalogItem, role: Exclude<StructuredReferenceUse['role'], 'pending'> = 'ordinary_reference'): StructuredReferenceUse {
  return {
    occurrenceId: `occurrence-${item.sourceId}`,
    sourceKey: item.sourceKey,
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceLocator: {},
    label: item.label,
    role,
    roleOrigin: 'manual',
    runtimeRole: role,
    aspect: null,
    scope: item.sourceKind === 'project_material_group' ? 'frozen_group_members' : 'whole_source',
    ruleEvidence: null,
    ruleConflicts: [],
    manualConflictResolution: null
  }
}

function providerTarget(provider: 'codex_cli' | 'claude_cli', suffix: string): ContentInstructionTargetPreparation {
  const historyMessageIds: string[] = []
  const providerThreadId = null
  return {
    providerConfigId: `${provider}-${suffix}`,
    providerSecurity: {
      provider,
      providerConfigId: `${provider}-${suffix}`,
      displayName: provider === 'codex_cli' ? 'Codex' : 'Claude',
      cliVersion: '1.2.3',
      fingerprint: `${provider}-security-fingerprint`,
      policyVersion: 'policy-v1'
    },
    requestedModel: provider === 'codex_cli' ? 'auto' : 'claude-default',
    actualModel: provider === 'codex_cli' ? 'gpt-5.6' : null,
    requestedReasoningEffort: provider === 'codex_cli' ? 'xhigh' : null,
    actualReasoningEffort: provider === 'codex_cli' ? 'xhigh' : null,
    historyThreadId: null,
    providerThreadId,
    historyMessageIds,
    historyHash: canonicalSha256({ providerThreadId, historyMessageIds })
  }
}

function prepareInput(projectId: string, targets: ContentInstructionTargetPreparation[], supersedesRequestId: string | null = null) {
  return {
    projectId,
    sessionScope: SESSION_SCOPE,
    surface: 'script_conversation' as const,
    supersedesRequestId,
    target: null,
    displayText: '请优化这段文案',
    editorDocument: { type: 'doc', content: [] },
    references: [],
    constraints: [],
    includeProjectContext: true,
    webSearchMode: 'automatic' as const,
    factRegion: '中国大陆',
    factAsOf: '2026-08-04T00:00:00.000Z',
    aiCount: targets.length as 1 | 2,
    targets
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('R16c structured reference repository', () => {
  it('migrates 0081 data without changing existing message, candidate, or task counts', () => {
    const database = new BetterSqlite3(':memory:')
    databases.push(database)
    database.pragma('foreign_keys = ON')
    runMigrationsThrough(database, '0081_r16b_revision_thread_surfaces')
    seedWorkspace(database, true)
    const before = {
      messages: database.prepare('SELECT COUNT(*) AS count FROM script_revision_messages').get(),
      candidates: database.prepare('SELECT COUNT(*) AS count FROM script_material_rewrite_candidates').get(),
      tasks: database.prepare('SELECT COUNT(*) AS count FROM task_runs').get()
    }
    runMigrations(database)
    expect(database.prepare('SELECT COUNT(*) AS count FROM script_revision_messages').get()).toEqual(before.messages)
    expect(database.prepare('SELECT COUNT(*) AS count FROM script_material_rewrite_candidates').get()).toEqual(before.candidates)
    expect(database.prepare('SELECT COUNT(*) AS count FROM task_runs').get()).toEqual(before.tasks)
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('builds a project-scoped metadata-only catalog across every current source family', () => {
    const repository = createRepository()
    repository.saveScriptMaterialWorkspace('ios', { workingContent: '素材机密正文\n第二段' })
    const workspace = repository.createScriptMaterialRevision('ios')
    repository.replaceScriptMaterialPoints('ios', workspace.activeRevision!.id, [{
      sourceStart: 0, sourceEnd: 6, sourceText: '素材机密正文', summary: '机密要点'
    }])
    repository.native.prepare(`INSERT INTO project_materials(
      id,project_id,role,source_kind,title,text_content,source_url,file_reference_id,page_count,parse_status,is_primary_reference,attention_note,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'brief-r16c', 'ios', 'brief', 'text', 'R16c Brief', 'Brief机密正文\n第二条', null, null, null, 'ready', 0, '',
      '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    const projectMaterial = repository.createProjectTextMaterial({
      projectId: 'ios', role: 'project_material', title: '参数表', textContent: '项目资料secret-token-never-leak'
    })
    const imageSha = sha256('image-r16c')
    repository.createProjectAssetMaterial({
      projectId: 'ios', role: 'project_material', title: '外观图', usageType: 'parameter_fact', entries: [{
        parentFileId: null,
        importRelativePath: 'appearance.png',
        file: {
          id: 'file-r16c-image', relativePath: '/Users/secret/private/appearance.png', managedLocator: 'managed/r16c-image',
          originalName: 'appearance.png', sha256: imageSha, sizeBytes: 120, mimeType: 'image/png',
          createdAt: '2026-08-04T00:00:00.000Z'
        }
      }]
    })
    repository.native.prepare(`INSERT INTO captures(
      id,capture_kind,primary_project_id,referenced_project_ids_json,linked_topic_id,classification_status,classification_actor,classification_confidence,
      suggested_content_type_id,suggested_project_id,classification_reason,classified_at,use_status,usage_type,general_category_id,original_content,
      mobile_title,mobile_source_app,mobile_source_title,mobile_source_url,mobile_notes,mobile_recording_markers_json,mobile_recording_interruption_reason,source_type,created_at,discarded_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'feedback-r16c', 'client_feedback', 'ios', '[]', null, 'confirmed', 'user', 1, null, null, null, null,
      'active', null, null, '客户机密修改', '客户修改', null, null, null, '', '[]', null, 'manual', '2026-08-04T00:00:00.000Z', null
    )
    repository.saveOutline('ios', [{ id: 'outline-point-r16c', text: '大纲机密正文' }], undefined, { id: 'outline-document-r16c', name: '评测大纲' })
    repository.createVersion('ios', 'script', 'user_edit', '历史文案机密正文', 'user')
    repository.createContentTemporaryAttachment({
      projectId: 'ios', sessionScope: SESSION_SCOPE, file: {
        id: 'temporary-r16c-file', relativePath: '/Users/secret/private/temp.png', managedLocator: 'managed/temp-r16c',
        originalName: 'temp.png', sha256: sha256('temp-image'), sizeBytes: 99, mimeType: 'image/png',
        createdAt: '2026-08-04T00:00:00.000Z'
      }
    })
    const member = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE).find((item) => item.sourceId === projectMaterial.id)!
    repository.createContentReferenceGroup({ projectId: 'ios', sessionScope: SESSION_SCOPE, name: '参考资料组', members: [{ sourceKind: member.sourceKind, sourceId: member.sourceId, sourceLocator: {} }] })

    const catalog = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
    expect(catalog.map((item) => item.sourceKind)).toEqual(expect.arrayContaining([
      'material_revision', 'material_point', 'brief', 'brief_point', 'client_feedback', 'project_material',
      'project_image', 'project_material_group', 'outline_version', 'outline_point', 'draft_version', 'temporary_attachment'
    ]))
    const serialized = JSON.stringify(catalog)
    expect(serialized).not.toContain('机密正文')
    expect(serialized).not.toContain('secret-token-never-leak')
    expect(serialized).not.toContain('/Users/secret')
    expect(serialized.toLowerCase()).not.toContain('token')
    expect(catalog.length).toBeGreaterThan(0)
    expect(catalog.length).toBeLessThanOrEqual(2_000)
    expect(repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE, 'secret-token-never-leak'))
      .toEqual([expect.objectContaining({ sourceId: projectMaterial.id, label: '参数表' })])
  })

  it('isolates temporary attachments by explicit session scope', () => {
    const repository = createRepository()
    const createTemporary = (id: string, sessionScope: string) => repository.createContentTemporaryAttachment({
      projectId: 'ios', sessionScope, file: {
        id: `file-${id}`, relativePath: `managed/${id}.png`, originalName: `${id}.png`, sha256: sha256(id),
        sizeBytes: 12, mimeType: 'image/png', createdAt: '2026-08-04T00:00:00.000Z'
      }
    })
    const current = createTemporary('current-session', 'session-current')
    const other = createTemporary('other-session', 'session-other')
    const currentCatalog = repository.listStructuredReferenceCatalog('ios', 'session-current')
    expect(currentCatalog.some((item) => item.sourceId === current.sourceId)).toBe(true)
    expect(currentCatalog.some((item) => item.sourceId === other.sourceId)).toBe(false)
    expect(() => repository.resolveStructuredReferences('ios', 'session-current', [referenceUse(other)]))
      .toThrow('不存在或不属于当前项目')
    expect(repository.resolveStructuredReferences('ios', 'session-current', [referenceUse(current)])[0]?.sourceId).toBe(current.sourceId)
    expect(() => repository.createContentReferenceGroup({
      projectId: 'ios', sessionScope: 'session-current', name: '错误的持久资料组',
      members: [{ sourceKind: current.sourceKind, sourceId: current.sourceId, sourceLocator: {} }]
    })).toThrow('临时附件不能保存到项目资料组')
  })

  it('requires source fragments to retain their exact source version and selected text hash', () => {
    const repository = createRepository()
    const material = repository.createProjectTextMaterial({
      projectId: 'ios', role: 'project_material', title: '片段资料', textContent: '甲乙丙丁'
    })
    const item = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE).find((candidate) => candidate.sourceId === material.id)!
    const fragment = {
      ...referenceUse(item),
      scope: 'source_fragment' as const,
      sourceLocator: {
        from: 1,
        to: 3,
        expectedSourceVersion: item.sourceVersion,
        selectedTextSha256: sha256('乙丙')
      }
    }
    expect(repository.resolveStructuredReferences('ios', SESSION_SCOPE, [fragment])[0]?.frozenTextContent).toBe('乙丙')
    repository.native.prepare('UPDATE project_materials SET text_content=?,updated_at=? WHERE id=?')
      .run('甲丑寅丁', '2026-08-04T00:00:01.000Z', material.id)
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [fragment])).toThrow('引用来源版本已变化')
  })

  it('saves, updates, exposes, and removes an exact project-scoped role preference', () => {
    const repository = createRepository()
    const material = repository.createProjectTextMaterial({
      projectId: 'ios', role: 'project_material', title: '用途记忆资料', textContent: '正文'
    })
    const source = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!
    const first = repository.setProjectReferenceRolePreference({
      projectId: 'ios', sourceKind: source.sourceKind, sourceId: source.sourceId,
      role: 'style_reference', aspect: '语气', scope: 'whole_source'
    })
    const remembered = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!
    expect(remembered.rememberedUse).toEqual({ role: 'style_reference', aspect: '语气', scope: 'whole_source' })
    const second = repository.setProjectReferenceRolePreference({
      projectId: 'ios', sourceKind: source.sourceKind, sourceId: source.sourceId,
      role: 'key_adoption', aspect: '体验', scope: 'whole_source'
    })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt >= first.updatedAt).toBe(true)
    repository.removeProjectReferenceRolePreference('ios', source.sourceKind, source.sourceId, 'whole_source')
    expect(repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!.rememberedUse).toBeNull()
    expect(() => repository.setProjectReferenceRolePreference({
      projectId: 'sponsor', sourceKind: source.sourceKind, sourceId: source.sourceId,
      role: 'ordinary_reference', aspect: null, scope: 'whole_source'
    })).toThrow('不存在或不属于当前项目')
  })

  it('keeps role memories for two scopes of the same source independently', () => {
    const repository = createRepository()
    const material = repository.createProjectTextMaterial({
      projectId: 'ios', role: 'project_material', title: '双范围记忆资料', textContent: '正文'
    })
    const source = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!
    repository.setProjectReferenceRolePreference({
      projectId: 'ios', sourceKind: source.sourceKind, sourceId: source.sourceId,
      role: 'style_reference', aspect: '语气', scope: 'whole_source'
    })
    repository.setProjectReferenceRolePreference({
      projectId: 'ios', sourceKind: source.sourceKind, sourceId: source.sourceId,
      role: 'hard_constraint', aspect: '当前段', scope: 'current_target'
    })
    const remembered = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!
    expect(remembered.rememberedUses).toEqual(expect.arrayContaining([
      { role: 'style_reference', aspect: '语气', scope: 'whole_source' },
      { role: 'hard_constraint', aspect: '当前段', scope: 'current_target' }
    ]))
    const whole = {
      ...referenceUse(source, 'style_reference'), occurrenceId: 'memory-whole', aspect: '语气',
      roleOrigin: 'project_memory' as const, projectMemory: { role: 'style_reference' as const, aspect: '语气', scope: 'whole_source' as const }
    }
    const current = {
      ...referenceUse(source, 'hard_constraint'), occurrenceId: 'memory-current', scope: 'current_target' as const, aspect: '当前段',
      roleOrigin: 'project_memory' as const, projectMemory: { role: 'hard_constraint' as const, aspect: '当前段', scope: 'current_target' as const }
    }
    expect(repository.resolveStructuredReferences('ios', SESSION_SCOPE, [whole, current])).toHaveLength(2)
    repository.removeProjectReferenceRolePreference('ios', source.sourceKind, source.sourceId, 'current_target')
    expect(repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!.rememberedUses)
      .toEqual([{ role: 'style_reference', aspect: '语气', scope: 'whole_source' }])
  })

  it('rejects duplicate source scopes and current-target scope without a target', () => {
    const repository = createRepository()
    const material = repository.createProjectTextMaterial({ projectId: 'ios', role: 'project_material', title: '范围审核', textContent: '正文' })
    const source = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE).find((candidate) => candidate.sourceId === material.id)!
    const first = referenceUse(source)
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [first, { ...first, occurrenceId: 'duplicate' }]))
      .toThrow('同一作用范围不能重复')
    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('codex_cli', 'scope')]),
      references: [{ ...first, occurrenceId: 'current-target', scope: 'current_target' }]
    })).toThrow('没有可供限定的修改目标')
  })

  it('accepts a project-memory role only when the exact saved preference still matches', () => {
    const repository = createRepository()
    const material = repository.createProjectTextMaterial({
      projectId: 'ios', role: 'project_material', title: '记忆用途资料', textContent: '正文'
    })
    const item = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((candidate) => candidate.sourceId === material.id)!
    const rememberedUse: StructuredReferenceUse = {
      ...referenceUse(item, 'style_reference'),
      roleOrigin: 'project_memory',
      aspect: '语气'
    }
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [rememberedUse]))
      .toThrow('项目记忆不存在或已变化')
    repository.native.prepare(`INSERT INTO project_reference_role_preferences(
      project_id,source_key,source_kind,source_id,role,aspect,scope,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      'ios', item.sourceKey, item.sourceKind, item.sourceId, 'style_reference', '语气', 'whole_source',
      '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    expect(repository.resolveStructuredReferences('ios', SESSION_SCOPE, [rememberedUse])[0]).toMatchObject({
      role: 'style_reference', roleOrigin: 'project_memory', aspect: '语气'
    })
    const temporarilyOverridden: StructuredReferenceUse = {
      ...rememberedUse,
      role: 'hard_constraint', roleOrigin: 'deterministic_rule', runtimeRole: 'hard_constraint', aspect: '参数',
      projectMemory: { role: 'style_reference', aspect: '语气', scope: 'whole_source' }
    }
    expect(repository.resolveStructuredReferences('ios', SESSION_SCOPE, [temporarilyOverridden])[0]).toMatchObject({
      role: 'hard_constraint', projectMemory: { role: 'style_reference', aspect: '语气', scope: 'whole_source' }
    })
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [{
      ...temporarilyOverridden, projectMemory: { role: 'ordinary_reference', aspect: null, scope: 'whole_source' }
    }])).toThrow('项目记忆不存在或已变化')
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [{ ...rememberedUse, aspect: '结构' }]))
      .toThrow('项目记忆不存在或已变化')
  })

  it('rejects cross-project and forged identities, blocks unavailable hard references, and freezes group order and hashes', () => {
    const repository = createRepository()
    const first = repository.createProjectTextMaterial({ projectId: 'ios', role: 'project_material', title: '第一份', textContent: '第一份正文' })
    const second = repository.createProjectTextMaterial({ projectId: 'ios', role: 'project_material', title: '第二份', textContent: '第二份正文' })
    const catalog = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
    const firstItem = catalog.find((item) => item.sourceId === first.id)!
    const secondItem = catalog.find((item) => item.sourceId === second.id)!
    const group = repository.createContentReferenceGroup({
      projectId: 'ios', sessionScope: SESSION_SCOPE, name: '有序资料组', members: [
        { sourceKind: secondItem.sourceKind, sourceId: secondItem.sourceId, sourceLocator: {} },
        { sourceKind: firstItem.sourceKind, sourceId: firstItem.sourceId, sourceLocator: {} }
      ]
    })
    const frozen = repository.resolveStructuredReferences('ios', SESSION_SCOPE, [referenceUse(group)])[0]!
    expect(frozen.frozenMembers.map((member) => member.sourceKey)).toEqual([secondItem.sourceKey, firstItem.sourceKey])
    expect(frozen.frozenMembers.map((member) => member.contentSha256)).toEqual([sha256('第二份正文'), sha256('第一份正文')])
    expect(frozen.sourceVersion).toMatch(/^1:[a-f0-9]{64}$/u)
    expect(frozen.frozenTextContent).toContain('第二份正文')
    const scopedGroupReferences = repository.resolveStructuredReferences('ios', SESSION_SCOPE, [
      { ...referenceUse(group), occurrenceId: 'group-current-target', scope: 'current_target' },
      { ...referenceUse(group), occurrenceId: 'group-whole-script', scope: 'whole_script' }
    ])
    expect(scopedGroupReferences.map((reference) => reference.scope)).toEqual(['current_target', 'whole_script'])
    expect(scopedGroupReferences.every((reference) => reference.frozenMembers.length === 2)).toBe(true)

    const pending = { ...referenceUse(firstItem), role: 'pending' as const, roleOrigin: 'pending' as const, runtimeRole: null }
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [pending])).toThrow('请先确认引用')
    const fallback = { ...pending, roleOrigin: 'runtime_fallback' as const, runtimeRole: 'ordinary_reference' as const }
    expect(repository.resolveStructuredReferences('ios', SESSION_SCOPE, [fallback])[0]).toMatchObject({
      role: 'pending', roleOrigin: 'runtime_fallback', runtimeRole: 'ordinary_reference'
    })
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [{
      ...referenceUse(firstItem), scope: 'outline_point'
    }])).toThrow('作用范围与来源不匹配')
    expect(repository.resolveStructuredReferences('ios', SESSION_SCOPE, [
      referenceUse(firstItem),
      { ...referenceUse(firstItem), occurrenceId: 'occurrence-same-source-whole-script', scope: 'whole_script' }
    ])).toHaveLength(2)
    repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('codex_cli', 'recent-use')]),
      includeProjectContext: false,
      displayText: '请参考@第一份',
      references: [referenceUse(firstItem)]
    })
    expect(repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE).find((item) => item.sourceKey === firstItem.sourceKey)?.lastUsedAt)
      .toMatch(/^\d{4}-\d{2}-\d{2}T/u)

    const crossProject = { ...referenceUse(firstItem), sourceKey: structuredReferenceSourceKey('desktop', firstItem.sourceKind, firstItem.sourceId) }
    expect(() => repository.resolveStructuredReferences('desktop', SESSION_SCOPE, [crossProject])).toThrow('不存在或不属于当前项目')
    expect(() => repository.resolveStructuredReferences('desktop', SESSION_SCOPE, [referenceUse(firstItem)])).toThrow('身份校验失败')
    expect(() => repository.resolveStructuredReferences('desktop', SESSION_SCOPE, [{ ...referenceUse(group), sourceKey: structuredReferenceSourceKey('desktop', 'project_material_group', group.sourceId) }])).toThrow('不存在或不属于当前项目')

    const link = repository.createProjectLinkMaterial({ projectId: 'ios', role: 'project_material', title: '未读网页', sourceUrl: 'https://example.com/source' })
    const unavailable = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE).find((item) => item.sourceId === link.id)!
    expect(unavailable.availability).toBe('stored_only')
    expect(() => repository.resolveStructuredReferences('ios', SESSION_SCOPE, [referenceUse(unavailable, 'hard_constraint')])).toThrow('当前不可读')

    const imageSha = sha256('cross-project-image')
    repository.createProjectAssetMaterial({
      projectId: 'ios', role: 'project_material', title: '跨项目图片', entries: [{ parentFileId: null, importRelativePath: 'cross.png', file: {
        id: 'cross-project-image-file', relativePath: 'managed/cross.png', originalName: 'cross.png', sha256: imageSha,
        sizeBytes: 12, mimeType: 'image/png', createdAt: '2026-08-04T00:00:00.000Z'
      } }]
    })
    const feedback = repository.createCapture({ captureKind: 'client_feedback', primaryProjectId: 'sponsor', originalContent: '客户修改' })
    const version = repository.createVersion('ios', 'script', 'user_edit', '跨项目历史文案', 'user')
    const temporary = repository.createContentTemporaryAttachment({ projectId: 'ios', sessionScope: SESSION_SCOPE, file: {
      id: 'cross-project-temp-file', relativePath: 'managed/cross-temp.png', originalName: 'cross-temp.png', sha256: sha256('cross-temp'),
      sizeBytes: 12, mimeType: 'image/png', createdAt: '2026-08-04T00:00:00.000Z'
    } })
    const expandedCatalog = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
    const sponsorCatalog = repository.listStructuredReferenceCatalog('sponsor', SESSION_SCOPE)
    const crossItems = [
      expandedCatalog.find((item) => item.sourceKind === 'project_image' && item.label === 'cross.png'),
      sponsorCatalog.find((item) => item.sourceKind === 'client_feedback' && item.sourceId === feedback.id),
      expandedCatalog.find((item) => item.sourceKind === 'draft_version' && item.sourceId === version.id),
      expandedCatalog.find((item) => item.sourceKind === 'temporary_attachment' && item.sourceId === temporary.sourceId)
    ].filter((item): item is StructuredReferenceCatalogItem => Boolean(item))
    expect(crossItems.map((item) => item.sourceKind)).toEqual(expect.arrayContaining(['project_image', 'client_feedback', 'draft_version', 'temporary_attachment']))
    crossItems.forEach((item) => expect(() => repository.resolveStructuredReferences('desktop', SESSION_SCOPE, [{
      ...referenceUse(item), sourceKey: structuredReferenceSourceKey('desktop', item.sourceKind, item.sourceId)
    }])).toThrow('不存在或不属于当前项目'))
  })

  it('freezes actual project context, source hashes, resources, and freshly recomputed roles', () => {
    const repository = createRepository()
    repository.saveScriptMaterialWorkspace('sponsor', { workingContent: '当前素材原稿' })
    const materialRevision = repository.createScriptMaterialRevision('sponsor').activeRevision!
    const brief = repository.createProjectTextMaterial({
      projectId: 'sponsor', role: 'brief', title: '商单Brief', textContent: '价格与型号要求'
    })
    const primary = repository.createProjectTextMaterial({
      projectId: 'sponsor', role: 'project_material', title: '主要参考', textContent: '主要参考全文'
    })
    repository.saveProjectPrimaryReferences({
      projectId: 'sponsor', referenceRequirements: '必须以实测为准', references: [],
      materialReferences: [{ materialId: primary.id, attentionNote: '关注做工' }]
    })
    const outline = repository.saveOutline('sponsor', [{ id: 'context-outline-point', text: '先讲外观' }], undefined, {
      id: 'context-outline', name: '上下文大纲'
    })
    repository.native.prepare(`INSERT INTO captures(
      id,capture_kind,primary_project_id,referenced_project_ids_json,linked_topic_id,classification_status,classification_actor,classification_confidence,
      suggested_content_type_id,suggested_project_id,classification_reason,classified_at,use_status,usage_type,general_category_id,original_content,
      mobile_title,mobile_source_app,mobile_source_title,mobile_source_url,mobile_notes,mobile_recording_markers_json,mobile_recording_interruption_reason,source_type,created_at,discarded_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'context-feedback', 'client_feedback', 'sponsor', '[]', null, 'confirmed', 'user', 1, null, null, null,
      '2026-08-04T00:00:00.000Z', 'active', null, null, '甲方要求删除禁用词', '客户修改', null, null, null, '', '[]', null,
      'project', '2026-08-04T00:00:00.000Z', null
    )
    const experience = repository.createCapture({
      captureKind: 'project_content', primaryProjectId: 'sponsor', originalContent: '只在本次选择后使用的真实体验'
    })
    repository.native.prepare(`UPDATE captures SET classification_status='confirmed',classification_actor='user',classification_confidence=1,
      classified_at=?,use_status='active',usage_type='opinion' WHERE id=?`)
      .run('2026-08-04T00:00:00.000Z', experience.id)
    const insertResource = repository.native.prepare(`INSERT INTO resources(
      id,resource_type,name,description,content_type_id,origin,selection_mode,version,payload_json,is_active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    insertResource.run(
      'resource-r16c-automatic', 'style_profile', 'R16c自动资源', '自动资源', null, 'system', 'automatic', 1,
      '{"instruction":"automatic"}', 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    insertResource.run(
      'resource-r16c-recommended', 'style_profile', 'R16c推荐资源', '推荐资源', null, 'system', 'recommended', 1,
      '{"instruction":"recommended"}', 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    insertResource.run(
      'resource-r16c-disabled', 'style_profile', 'R16c禁用资源', '禁用资源', null, 'system', 'recommended', 1,
      '{"instruction":"disabled"}', 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    insertResource.run(
      'resource-r16c-manual', 'style_profile', 'R16c手动资源', '手动资源', null, 'own', 'manual_only', 1,
      '{"instruction":"manual"}', 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    repository.native.prepare(`INSERT INTO project_resource_references(
      project_id,resource_id,role,enabled,selection_source,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?)`).run(
      'sponsor', 'resource-r16c-disabled', 'reference_style', 0, 'recommended',
      '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    const withContext = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'context')]),
      surface: 'script_material_chat',
      materialRevisionId: materialRevision.id,
      briefVersionId: brief.id,
      outlineVersionId: outline.id,
      resourceSelection: {
        excludedRecommendedResourceIds: ['resource-r16c-recommended'],
        manualResourceIds: ['resource-r16c-manual'],
        supportingMaterialIds: [experience.id]
      }
    })
    expect(withContext.request).toMatchObject({
      materialRevisionContentHash: materialRevision.contentHash,
      briefVersionContentHash: sha256('价格与型号要求'),
      outlineVersionContentHash: sha256(outline.content),
      projectContextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      resourceSnapshotFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    const context = withContext.request.projectContextSnapshot as {
      materialRevision: { content: string }
      brief: { items: Array<{ content: string }> }
      selectedOutline: { content: string }
      primaryReferences: Array<{ content: string }>
      confirmedRequirements: Array<{ items: Array<{ content: string }> }>
      supportingMaterials: Array<{ id: string; content: string }>
    }
    expect(context.materialRevision.content).toBe('当前素材原稿')
    expect(context.brief.items.map((item) => item.content)).toContain('价格与型号要求')
    expect(context.selectedOutline.content).toBe(outline.content)
    expect(context.primaryReferences.map((item) => item.content)).toContain('主要参考全文')
    expect(context.confirmedRequirements.flatMap((item) => item.items).map((item) => item.content)).toContain('甲方要求删除禁用词')
    expect(context.supportingMaterials).toEqual([expect.objectContaining({ id: experience.id, content: '只在本次选择后使用的真实体验' })])
    const resources = withContext.request.resourceSnapshot as {
      contentTypeId: string
      templateId: string | null
      requiredInputs: Array<{ key: string; status: string }>
      automaticResources: Array<{ id: string }>
      recommendedResources: Array<{ id: string }>
      manualResources: Array<{ id: string }>
      generationContext?: unknown
    }
    expect(resources).toMatchObject({
      contentTypeId: repository.getProject('sponsor', false).contentTypeId,
      templateId: repository.getProject('sponsor', false).appliedTemplateId,
      requiredInputs: expect.arrayContaining([expect.objectContaining({ key: 'commercial_brief', status: 'included' })])
    })
    expect(resources.automaticResources.map((item) => item.id)).toContain('resource-r16c-automatic')
    expect(resources.recommendedResources.map((item) => item.id)).toContain('resource-reference-authentic-structure')
    expect(resources.recommendedResources.map((item) => item.id)).not.toContain('resource-r16c-recommended')
    expect(resources.recommendedResources.map((item) => item.id)).not.toContain('resource-r16c-disabled')
    expect(resources.manualResources.map((item) => item.id)).toEqual(['resource-r16c-manual'])
    expect(resources.generationContext).toBeUndefined()

    const withoutContext = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'no-context')]),
      includeProjectContext: false,
      resourceSelection: { manualResourceIds: ['resource-r16c-manual'], supportingMaterialIds: [experience.id] }
    })
    expect(withoutContext.request).toMatchObject({
      projectContextSnapshot: null, projectContextFingerprint: null,
      resourceSnapshot: null, resourceSnapshotId: null, resourceSnapshotFingerprint: null
    })

    const briefItem = repository.listStructuredReferenceCatalog('sponsor', SESSION_SCOPE)
      .find((item) => item.sourceKind === 'brief' && item.sourceId === brief.id)!
    const displayText = `参考一下@${briefItem.label}。`
    const mentionFrom = displayText.indexOf(`@${briefItem.label}`)
    const staleRuleUse: StructuredReferenceUse = {
      ...referenceUse(briefItem, 'hard_constraint'),
      roleOrigin: 'deterministic_rule',
      sourceLocator: { mentionFrom, mentionTo: mentionFrom + briefItem.label.length + 1 },
      ruleEvidence: { ruleId: 'old-hard-rule', text: '必须', from: 0, to: 2, resolvedRole: 'hard_constraint' }
    }
    const recomputed = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'role-recompute')]),
      displayText, references: [staleRuleUse]
    })
    expect(recomputed.request.references[0]).toMatchObject({
      role: 'ordinary_reference', runtimeRole: 'ordinary_reference', roleOrigin: 'deterministic_rule'
    })
    const deduplicatedBrief = (recomputed.request.projectContextSnapshot as {
      brief: { items: Array<{ id: string; content: string | null; includedBy: string }> }
    }).brief.items.find((item) => item.id === brief.id)
    expect(deduplicatedBrief).toMatchObject({ content: null, includedBy: 'explicit_reference' })
    expect((recomputed.request.projectContextSnapshot as { supportingMaterials: unknown[] }).supportingMaterials).toHaveLength(0)
    expect((recomputed.request.resourceSnapshot as { manualResources: unknown[] }).manualResources).toHaveLength(0)

    const briefPointItem = repository.listStructuredReferenceCatalog('sponsor', SESSION_SCOPE)
      .find((item) => item.sourceKind === 'brief_point' && item.sourceId.startsWith(`${brief.id}:`))!
    const briefPointText = `参考@${briefPointItem.label}`
    const briefPointMentionFrom = briefPointText.indexOf('@')
    const briefPointContext = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'brief-point-context')]),
      displayText: briefPointText,
      references: [{
        ...referenceUse(briefPointItem),
        sourceLocator: {
          mentionFrom: briefPointMentionFrom,
          mentionTo: briefPointMentionFrom + briefPointItem.label.length + 1
        }
      }]
    })
    expect((briefPointContext.request.projectContextSnapshot as {
      brief: { items: Array<{ id: string; content: string | null; includedBy: string }> }
    }).brief.items.find((item) => item.id === brief.id)).toMatchObject({
      content: '价格与型号要求', includedBy: 'project_context'
    })

    const briefGroup = repository.createContentReferenceGroup({
      projectId: 'sponsor', sessionScope: SESSION_SCOPE, name: '整份Brief组',
      members: [{ sourceKind: briefItem.sourceKind, sourceId: briefItem.sourceId, sourceLocator: {} }]
    })
    const briefGroupText = `参考@${briefGroup.label}`
    const briefGroupMentionFrom = briefGroupText.indexOf('@')
    const groupedBriefContext = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'brief-group-context')]),
      displayText: briefGroupText,
      references: [{
        ...referenceUse(briefGroup),
        sourceLocator: {
          mentionFrom: briefGroupMentionFrom,
          mentionTo: briefGroupMentionFrom + briefGroup.label.length + 1
        }
      }]
    })
    expect((groupedBriefContext.request.projectContextSnapshot as {
      brief: { items: Array<{ id: string; content: string | null; includedBy: string }> }
    }).brief.items.find((item) => item.id === brief.id)).toMatchObject({
      content: null, includedBy: 'explicit_reference'
    })

    const primaryItem = repository.listStructuredReferenceCatalog('sponsor', SESSION_SCOPE)
      .find((item) => item.sourceKind === 'project_material' && item.sourceId === primary.id)!
    const primaryFragmentText = `参考@${primaryItem.label}`
    const primaryMentionFrom = primaryFragmentText.indexOf('@')
    const primaryFragmentContext = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'primary-fragment-context')]),
      displayText: primaryFragmentText,
      references: [{
        ...referenceUse(primaryItem),
        scope: 'source_fragment',
        manualConflictResolution: 'keep_manual',
        sourceLocator: {
          mentionFrom: primaryMentionFrom,
          mentionTo: primaryMentionFrom + primaryItem.label.length + 1,
          from: 0,
          to: 2,
          expectedSourceVersion: primaryItem.sourceVersion,
          selectedTextSha256: sha256('主要')
        }
      }]
    })
    expect((primaryFragmentContext.request.projectContextSnapshot as {
      primaryReferences: Array<{ projectMaterialId: string; content: string | null; includedBy: string }>
    }).primaryReferences.find((item) => item.projectMaterialId === primary.id)).toMatchObject({
      content: '主要参考全文', includedBy: 'project_context'
    })
    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'forged-label')]),
      displayText: '参考一下@伪造Brief。',
      references: [{
        ...staleRuleUse,
        label: '伪造Brief',
        sourceLocator: { mentionFrom: 4, mentionTo: 12 }
      }]
    })).toThrow('名称已变化')
  })

  it('keeps long Brief content intact for the R16c budget gate instead of silently truncating it', () => {
    const repository = createRepository()
    const longBrief = `${'长'.repeat(95_100)}完整结尾标记`
    const brief = repository.createProjectTextMaterial({
      projectId: 'sponsor', role: 'brief', title: '超长Brief', textContent: longBrief
    })
    const record = repository.prepareContentInstructionRequest({
      ...prepareInput('sponsor', [providerTarget('codex_cli', 'long-brief')]),
      briefVersionId: brief.id
    })
    const item = (record.request.projectContextSnapshot as {
      brief: { items: Array<{ id: string; content: string }> }
    }).brief.items.find((candidate) => candidate.id === brief.id)
    expect(item?.content).toBe(longBrief)
    expect(item?.content).not.toContain('本次快照只包含前94950字')
  })

  it('keeps non-commercial Brief and client feedback out through the existing required-input policy', () => {
    const repository = createRepository()
    repository.native.prepare(`INSERT INTO project_materials(
      id,project_id,role,source_kind,title,text_content,source_url,file_reference_id,page_count,parse_status,
      is_primary_reference,attention_note,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'legacy-non-commercial-brief', 'ios', 'brief', 'text', '不应自动进入的Brief', '非商单Brief正文',
      null, null, null, 'ready', 0, '', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    repository.native.prepare(`INSERT INTO captures(
      id,capture_kind,primary_project_id,referenced_project_ids_json,linked_topic_id,classification_status,classification_actor,classification_confidence,
      suggested_content_type_id,suggested_project_id,classification_reason,classified_at,use_status,usage_type,general_category_id,original_content,
      mobile_title,mobile_source_app,mobile_source_title,mobile_source_url,mobile_notes,mobile_recording_markers_json,mobile_recording_interruption_reason,source_type,created_at,discarded_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'legacy-non-commercial-feedback', 'client_feedback', 'ios', '[]', null, 'confirmed', 'user', 1, null, null, null,
      '2026-08-04T00:00:00.000Z', 'active', null, null, '非商单客户修改', '客户修改', null, null, null, '', '[]', null,
      'project', '2026-08-04T00:00:00.000Z', null
    )
    const record = repository.prepareContentInstructionRequest(
      prepareInput('ios', [providerTarget('codex_cli', 'non-commercial-context')])
    )
    expect(record.request.projectContextSnapshot).toMatchObject({ brief: null, confirmedRequirements: [] })
    expect((record.request.resourceSnapshot as {
      requiredInputs: Array<{ key: string; status: string }>
    }).requiredInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'commercial_brief', status: 'not_applicable' }),
      expect.objectContaining({ key: 'client_requirements', status: 'not_applicable' })
    ]))
  })

  it('persists immutable revisions and independent dual-provider append-only histories', () => {
    const repository = createRepository()
    const first = repository.prepareContentInstructionRequest(prepareInput('ios', [providerTarget('codex_cli', 'one')]))
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.request)).toBe(true)
    expect(first.targets).toHaveLength(1)
    expect(first.targets[0]).toMatchObject({
      requestedModel: 'auto', actualModel: 'gpt-5.6', providerPolicyVersion: 'policy-v1',
      historyEstimatedTokens: expect.any(Number), estimatedInputTokens: expect.any(Number), status: 'queued'
    })

    const revision = repository.prepareContentInstructionRequest(prepareInput('ios', [providerTarget('codex_cli', 'revision')], first.request.id))
    expect(revision.request.supersedesRequestId).toBe(first.request.id)
    expect(revision.request.id).not.toBe(first.request.id)
    expect(repository.getContentInstructionRequest(first.request.id).request.commonFingerprint).toBe(first.request.commonFingerprint)
    expect(repository.native.prepare('SELECT COUNT(*) AS count FROM content_instruction_requests').get()).toEqual({ count: 2 })

    const dual = repository.prepareContentInstructionRequest(prepareInput('ios', [
      providerTarget('codex_cli', 'dual'), providerTarget('claude_cli', 'dual')
    ]))
    const codex = dual.targets.find((target) => target.provider === 'codex_cli')!
    const claude = dual.targets.find((target) => target.provider === 'claude_cli')!
    const createLinkedTask = (provider: 'codex_cli' | 'claude_cli', targetId: string) => {
      const task = repository.createTaskRun({
        taskType: 'script_revision', projectId: 'ios', title: `${provider}事件测试`, provider, inputSnapshot: '{}',
        permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
      })
      repository.appendContentInstructionTargetEvent({
        targetId, eventKind: 'task_linked', actualModel: null, actualReasoningEffort: null,
        providerThreadId: null, taskId: task.id, status: 'queued'
      })
      return task
    }
    const codexTask = createLinkedTask('codex_cli', codex.id)
    const claudeTask = createLinkedTask('claude_cli', claude.id)
    repository.native.prepare(`UPDATE task_runs SET status='running' WHERE id IN (?,?)`).run(codexTask.id, claudeTask.id)
    let current = repository.appendContentInstructionTargetEvent({
      targetId: codex.id, eventKind: 'started', actualModel: 'gpt-5.6', actualReasoningEffort: 'xhigh',
      providerThreadId: 'codex-thread-runtime', taskId: codexTask.id, status: 'running',
      createdAt: '2026-08-04T01:00:00.000Z'
    })
    expect(current.targets.find((target) => target.id === codex.id)?.status).toBe('running')
    expect(current.targets.find((target) => target.id === claude.id)?.status).toBe('queued')
    expect(() => repository.appendContentInstructionTargetEvent({
      targetId: claude.id, eventKind: 'completed', actualModel: 'claude-sonnet', actualReasoningEffort: null,
      providerThreadId: null, taskId: null, status: 'completed'
    })).toThrow('尚未开始')
    current = repository.appendContentInstructionTargetEvent({
      targetId: claude.id, eventKind: 'started', actualModel: 'claude-sonnet', actualReasoningEffort: null,
      providerThreadId: 'claude-thread-runtime', taskId: claudeTask.id, status: 'running',
      createdAt: '2026-08-04T01:00:00.000Z'
    })
    expect(() => repository.appendContentInstructionTargetEvent({
      targetId: codex.id, eventKind: 'runtime_resolved', actualModel: 'gpt-5.5', actualReasoningEffort: 'xhigh',
      providerThreadId: 'codex-thread-runtime', taskId: codexTask.id, status: 'running',
      createdAt: '2026-08-04T01:00:00.000Z'
    })).toThrow('实际模型已冻结')
    expect(() => repository.appendContentInstructionTargetEvent({
      targetId: codex.id, eventKind: 'task_linked', actualModel: 'gpt-5.6', actualReasoningEffort: 'xhigh',
      providerThreadId: 'codex-thread-runtime', taskId: codexTask.id, status: 'completed'
    })).toThrow('终态必须使用对应的终态事件')
    repository.native.prepare(`UPDATE task_runs SET status='succeeded' WHERE id=?`).run(codexTask.id)
    current = repository.appendContentInstructionTargetEvent({
      targetId: codex.id, eventKind: 'completed', actualModel: 'gpt-5.6', actualReasoningEffort: 'xhigh',
      providerThreadId: 'codex-thread-runtime', taskId: codexTask.id, status: 'completed',
      createdAt: '2026-08-04T01:00:00.000Z'
    })
    expect(current.targets.find((target) => target.id === codex.id)?.status).toBe('completed')
    expect(current.targets.find((target) => target.id === claude.id)?.status).toBe('running')
    expect(current.targetEvents.filter((event) => event.targetId === codex.id)).toHaveLength(3)
    expect(current.targetEvents.filter((event) => event.targetId === claude.id)).toHaveLength(2)
    expect(current.targetEvents.filter((event) => event.targetId === codex.id).map((event) => event.sequence)).toEqual([1, 2, 3])

    expect(() => repository.native.prepare('UPDATE content_instruction_requests SET surface=? WHERE id=?').run('current_script_rewrite', dual.request.id)).toThrow('immutable')
    expect(() => repository.native.prepare('UPDATE content_instruction_request_targets SET requested_model=? WHERE id=?').run('forged', codex.id)).toThrow('immutable')
    expect(() => repository.native.prepare('UPDATE content_instruction_request_target_events SET status=? WHERE target_id=?').run('queued', codex.id)).toThrow('immutable')
    expect(repository.native.pragma('foreign_key_check')).toEqual([])
  })

  it('keeps linked Provider targets synchronized with task running and terminal states', () => {
    const repository = createRepository()
    const makeLinked = (suffix: string) => {
      const record = repository.prepareContentInstructionRequest(prepareInput('ios', [providerTarget('codex_cli', suffix)]))
      const task = repository.createTaskRun({
        taskType: 'script_revision', projectId: 'ios', title: `状态同步${suffix}`, provider: 'codex_cli', inputSnapshot: '{}',
        permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'new_version', shell: false }
      })
      repository.appendContentInstructionTargetEvent({
        targetId: record.targets[0]!.id, eventKind: 'task_linked', actualModel: null, actualReasoningEffort: null,
        providerThreadId: null, taskId: task.id, status: 'queued'
      })
      return task
    }
    const success = makeLinked('success')
    repository.updateTaskRun(success.id, { status: 'running', progress: 20 })
    expect(repository.getContentInstructionRequestByTaskId(success.id).targets[0]?.status).toBe('running')
    repository.updateTaskRun(success.id, { status: 'succeeded', progress: 100 })
    const completed = repository.getContentInstructionRequestByTaskId(success.id)
    expect(completed.targets[0]?.status).toBe('completed')
    expect(completed.targetEvents.map((event) => event.eventKind)).toEqual(['task_linked', 'started', 'completed'])

    const failed = makeLinked('failed')
    repository.updateTaskRun(failed.id, { status: 'failed' })
    expect(repository.getContentInstructionRequestByTaskId(failed.id).targets[0]?.status).toBe('failed')
    const canceled = makeLinked('canceled')
    repository.updateTaskRun(canceled.id, { status: 'canceled' })
    expect(repository.getContentInstructionRequestByTaskId(canceled.id).targets[0]?.status).toBe('canceled')

    const recovered = makeLinked('recovered')
    repository.updateTaskRun(recovered.id, { status: 'running', progress: 30, startedAt: '2026-08-04T03:00:00.000Z' })
    repository.recoverInterruptedTasks()
    expect(repository.getTaskRun(recovered.id)).toMatchObject({ status: 'queued', progress: 0, errorCode: 'APP_RESTARTED' })
    expect(repository.getContentInstructionRequestByTaskId(recovered.id)).toMatchObject({
      targets: [expect.objectContaining({ status: 'queued' })],
      targetEvents: [
        expect.objectContaining({ eventKind: 'task_linked' }),
        expect.objectContaining({ eventKind: 'started' }),
        expect.objectContaining({ eventKind: 'requeued' })
      ]
    })
    repository.updateTaskRun(recovered.id, { status: 'running' })
    repository.updateTaskRun(recovered.id, { status: 'succeeded' })
    expect(repository.getContentInstructionRequestByTaskId(recovered.id).targetEvents.map((event) => event.eventKind)).toEqual([
      'task_linked', 'started', 'requeued', 'started', 'completed'
    ])
  })

  it('binds history to one matching provider thread and budgets each target history', () => {
    const repository = createRepository()
    const base = repository.createVersion('ios', 'script', 'user_edit', '基础文案', 'user')
    const insertThread = (id: string, providerThreadId: string) => repository.native.prepare(`INSERT INTO script_revision_threads(
      id,project_id,base_version_id,provider,surface,provider_fingerprint,provider_thread_id,model,reasoning_effort,web_search_mode,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, 'ios', base.id, 'codex_cli', 'conversation', 'codex_cli-security-fingerprint', providerThreadId,
      'gpt-5.6', 'xhigh', 'automatic', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    const insertMessage = (id: string, threadId: string, content: string) => repository.native.prepare(`INSERT INTO script_revision_messages(
      id,thread_id,role,content,provider,source_selections_json,conflicts_json,web_searches_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id, threadId, 'assistant', content, 'codex_cli', '[]', '[]', '[]', '2026-08-04T00:00:00.000Z'
    )
    insertThread('history-thread-a', 'provider-history-a')
    insertThread('history-thread-b', 'provider-history-b')
    insertMessage('history-message-a', 'history-thread-a', '第一条历史')
    insertMessage('history-message-b', 'history-thread-b', '第二条历史')
    const validTarget = {
      ...providerTarget('codex_cli', 'history'),
      historyThreadId: 'history-thread-a',
      providerThreadId: 'provider-history-a',
      historyMessageIds: ['history-message-a']
    }
    const valid = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [validTarget]), includeProjectContext: false
    })
    expect(valid.targets[0]).toMatchObject({
      providerThreadId: 'provider-history-a', historyMessageIds: ['history-message-a'],
      historyEstimatedTokens: expect.any(Number), estimatedInputTokens: expect.any(Number)
    })
    expect(valid.targets[0]!.historyEstimatedTokens).toBeGreaterThan(0)

    const changedRuntimeTarget = {
      ...validTarget,
      providerConfigId: 'codex_cli-history-new-runtime',
      providerSecurity: { ...validTarget.providerSecurity, providerConfigId: 'codex_cli-history-new-runtime' },
      requestedModel: 'gpt-5.7', actualModel: 'gpt-5.7',
      requestedReasoningEffort: 'high', actualReasoningEffort: 'high'
    }
    const changedRuntime = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [changedRuntimeTarget]), includeProjectContext: false
    })
    expect(changedRuntime.targets[0]).toMatchObject({
      requestedModel: 'gpt-5.7', actualModel: 'gpt-5.7',
      requestedReasoningEffort: 'high', actualReasoningEffort: 'high',
      historyThreadId: 'history-thread-a'
    })

    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [{
        ...validTarget,
        providerConfigId: 'codex_cli-outline-cross-surface',
        providerSecurity: { ...validTarget.providerSecurity, providerConfigId: 'codex_cli-outline-cross-surface' }
      }]),
      surface: 'outline_conversation', includeProjectContext: false
    })).toThrow('大纲入口不能复用文案Provider历史')

    const assistantHistoryHash = valid.targets[0]!.historyHash
    repository.native.pragma('ignore_check_constraints = ON')
    repository.native.prepare('UPDATE script_revision_messages SET role=? WHERE id=?').run('system', 'history-message-a')
    repository.native.pragma('ignore_check_constraints = OFF')
    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [{
        ...validTarget,
        providerConfigId: 'codex_cli-history-invalid-role',
        providerSecurity: { ...validTarget.providerSecurity, providerConfigId: 'codex_cli-history-invalid-role' }
      }]),
      includeProjectContext: false
    })).toThrow('Provider历史消息角色无效')
    repository.native.prepare('UPDATE script_revision_messages SET role=? WHERE id=?').run('user', 'history-message-a')
    const roleChangedTarget = {
      ...validTarget,
      providerConfigId: 'codex_cli-history-role-changed',
      providerSecurity: { ...validTarget.providerSecurity, providerConfigId: 'codex_cli-history-role-changed' }
    }
    const roleChanged = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [roleChangedTarget]), includeProjectContext: false
    })
    expect(roleChanged.targets[0]!.historyHash).not.toBe(assistantHistoryHash)

    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [{ ...validTarget, providerConfigId: 'codex_cli-history-mixed', providerSecurity: {
        ...validTarget.providerSecurity, providerConfigId: 'codex_cli-history-mixed'
      }, providerThreadId: null, historyMessageIds: ['history-message-a', 'history-message-b'] }]),
      includeProjectContext: false
    })).toThrow('不能混用多个线程')

    insertMessage('history-message-huge', 'history-thread-a', '长'.repeat(121_000))
    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [{ ...validTarget, providerConfigId: 'codex_cli-history-huge', providerSecurity: {
        ...validTarget.providerSecurity, providerConfigId: 'codex_cli-history-huge'
      }, historyMessageIds: ['history-message-huge'] }]),
      includeProjectContext: false
    })).toThrow('历史消息使本次输入超过预算')
  })

  it('rejects stale current-script and material-draft targets before creating a request', () => {
    const repository = createRepository()
    const project = repository.createProject({
      title: 'R16c目标校验', description: '', contentTypeId: 'type-ai', colorToken: 'project-12', platformTargets: []
    })
    const current = repository.initializeProjectCurrentScript({
      projectId: project.id, clientMutationId: 'initialize-r16c-current', sourceVersionId: null, expectedSourceContentHash: null,
      editorDocument: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'block-r16c', parentBlockIds: [] }, content: [] }] },
      sourceRelations: [], annotations: []
    })
    if (current.status !== 'ready') throw new Error('当前文案初始化失败')
    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput(project.id, [providerTarget('codex_cli', 'current-target')]),
      target: {
        kind: 'current_script', workingDocumentId: current.snapshot.document.workingDocumentId,
        revision: current.snapshot.document.revision + 1, contentHash: current.snapshot.document.contentHash, blockSelections: []
      }
    })).toThrow('当前文案已变化')

    repository.native.prepare(`INSERT INTO script_material_revisions(id,project_id,revision,content,content_hash,points_confirmed,confirmed_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('revision-target-r16c', 'ios', 999, '素材', sha256('素材'), 1, null, '2026-08-04T00:00:00.000Z')
    repository.native.prepare(`INSERT INTO script_material_drafts(
      id,project_id,revision_id,side,source_kind,provider_config_id,provider_kind,model,reasoning_effort,provider_fingerprint,requirement,input_fingerprint,
      content,content_hash,draft_version,mapping_state,mapping_task_id,mapping_error,current_content_hash,current_mappings_json,paragraphs_json,task_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'draft-target-r16c', 'ios', 'revision-target-r16c', 'codex', 'freeform', null, null, null, null, null, '', sha256('input'),
      '素材稿正文', sha256('素材稿正文'), 1, 'ready', null, null, null, '[]',
      JSON.stringify([{ id: 'paragraph-target-r16c', position: 0, text: '素材稿正文' }]), null,
      '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    )
    expect(() => repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('codex_cli', 'draft-target')]),
      surface: 'script_material_rewrite',
      materialRevisionId: 'revision-target-r16c',
      target: { kind: 'material_draft', draftId: 'draft-target-r16c', contentHash: sha256('已变更'), paragraphSelections: [], applicationTarget: null }
    })).toThrow('素材稿已变化')
    expect(repository.native.prepare('SELECT COUNT(*) AS count FROM content_instruction_requests').get()).toEqual({ count: 0 })
  })

  it('freezes one immutable layered Provider input per task and gates hard images by real capability', () => {
    const repository = createRepository()
    const imageSha = sha256('r16e-image-bytes')
    repository.createProjectAssetMaterial({
      projectId: 'ios', role: 'project_material', title: 'R16e外观图', usageType: 'parameter_fact', entries: [{
        parentFileId: null, importRelativePath: 'r16e.png', file: {
          id: 'file-r16e-image', relativePath: 'managed-files/r16e/image.png', managedLocator: 'managed-files/r16e/image.png',
          originalName: 'image.png', sha256: imageSha, sizeBytes: 17, mimeType: 'image/png',
          availability: 'available', processState: 'ready', createdAt: '2026-08-05T00:00:00.000Z'
        }
      }]
    })
    repository.native.prepare('UPDATE project_materials SET attention_note=? WHERE project_id=? AND file_reference_id=?')
      .run('用于开头，必须保留', 'ios', 'file-r16e-image')
    const notedMaterialItem = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((item) => item.sourceKind === 'project_material' && item.label === 'R16e外观图')!
    const notedClaudeRecord = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('claude_cli', 'r16e-note-is-not-summary')]), includeProjectContext: false,
      displayText: '必须看@R16e外观图再写', references: [referenceUse(notedMaterialItem, 'hard_constraint')]
    })
    expect(notedClaudeRecord.request.references[0]).toMatchObject({ frozenTextContent: null, visualSummaryVersion: null })
    const notedClaudeTask = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: '普通备注不能冒充视觉摘要', provider: 'claude_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    expect(() => repository.bindContentProviderInput(notedClaudeRecord.request.id, notedClaudeRecord.targets[0]!.id, notedClaudeTask.id))
      .toThrow('硬性图片')
    repository.native.prepare('UPDATE project_materials SET text_content=? WHERE project_id=? AND file_reference_id=?')
      .run('图片OCR文字：ALUMINUM', 'ios', 'file-r16e-image')
    const ocrMaterialItem = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((item) => item.sourceKind === 'project_material' && item.label === 'R16e外观图')!
    const visualUse = { ...referenceUse(ocrMaterialItem, 'hard_constraint'), aspect: '外观、材质和做工' }
    const ocrClaudeRecord = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('claude_cli', 'r16e-ocr-is-not-vision')]), includeProjectContext: false,
      displayText: '必须按@R16e外观图的外观、材质和做工来写', references: [visualUse]
    })
    const ocrClaudeTask = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: 'OCR不能冒充视觉理解', provider: 'claude_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    expect(() => repository.bindContentProviderInput(ocrClaudeRecord.request.id, ocrClaudeRecord.targets[0]!.id, ocrClaudeTask.id))
      .toThrow('只能读取文字')
    const imageItem = repository.listStructuredReferenceCatalog('ios', SESSION_SCOPE)
      .find((item) => item.sourceKind === 'project_image' && item.label === 'image.png')!
    const codexRecord = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('codex_cli', 'r16e-image')]), includeProjectContext: false,
      displayText: '参考@image.png描述外观', references: [referenceUse(imageItem, 'ordinary_reference')]
    })
    const codexTask = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: 'R16e图片输入', provider: 'codex_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    const input = repository.bindContentProviderInput(codexRecord.request.id, codexRecord.targets[0]!.id, codexTask.id)
    repository.appendContentInstructionTargetEvent({
      targetId: codexRecord.targets[0]!.id, eventKind: 'task_linked', actualModel: null, actualReasoningEffort: null,
      providerThreadId: null, taskId: codexTask.id, status: 'queued'
    })
    expect(input).toMatchObject({
      requestId: codexRecord.request.id, targetId: codexRecord.targets[0]!.id, provider: 'codex_cli',
      actualModel: 'gpt-5.6', images: [expect.objectContaining({
        managedAssetId: 'file-r16e-image', binarySha256: imageSha, capability: 'native_image_input', required: false
      })]
    })
    expect(repository.getContentProviderInputByTaskId(codexTask.id)?.inputFingerprint).toBe(input.inputFingerprint)
    expect(() => repository.bindContentProviderInput(codexRecord.request.id, codexRecord.targets[0]!.id, codexTask.id))
      .toThrow('已经绑定任务')
    expect(() => repository.native.prepare('UPDATE content_provider_input_snapshots SET input_fingerprint=? WHERE task_id=?')
      .run('f'.repeat(64), codexTask.id)).toThrow('immutable')
    repository.recordContentProviderRuntime(codexTask.id, {
      model: 'gpt-5.6', reasoningEffort: 'xhigh', providerThreadId: 'runtime-thread-r16e'
    })
    expect(repository.getContentInstructionRequestByTaskId(codexTask.id).targets[0]).toMatchObject({
      actualModel: 'gpt-5.6', actualReasoningEffort: 'xhigh', providerThreadId: 'runtime-thread-r16e'
    })
    repository.updateTaskRun(codexTask.id, { status: 'failed', errorCode: 'TEST', errorMessage: '测试重试' })
    const retry = repository.retryTaskRun(codexTask.id)
    expect(repository.getContentProviderInputByTaskId(retry.id)).toEqual(input)
    expect(repository.getContentInstructionRequestByTaskId(retry.id)).toMatchObject({
      request: { id: codexRecord.request.id },
      targets: [{ taskId: retry.id, status: 'queued' }]
    })

    const claudeRecord = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('claude_cli', 'r16e-hard-image')]), includeProjectContext: false,
      displayText: '必须看@image.png再写', references: [referenceUse(imageItem, 'hard_constraint')]
    })
    const claudeTask = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: 'R16e硬性图片', provider: 'claude_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    expect(() => repository.bindContentProviderInput(claudeRecord.request.id, claudeRecord.targets[0]!.id, claudeTask.id))
      .toThrow('硬性图片')
    const ordinaryClaudeRecord = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('claude_cli', 'r16e-ordinary-image')]), includeProjectContext: false,
      displayText: '参考@image.png描述外观', references: [referenceUse(imageItem, 'ordinary_reference')]
    })
    const ordinaryClaudeTask = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: '不可读普通图片不能静默忽略', provider: 'claude_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    expect(() => repository.bindContentProviderInput(ordinaryClaudeRecord.request.id, ordinaryClaudeRecord.targets[0]!.id, ordinaryClaudeTask.id))
      .toThrow('无法被Claude真实读取')
    expect(repository.native.prepare('SELECT COUNT(*) AS count FROM content_provider_input_snapshots WHERE task_id=?').get(claudeTask.id))
      .toEqual({ count: 0 })
    expect(repository.native.pragma('foreign_key_check')).toEqual([])
  })

  it('rebinds a failed Claude retry to its new runtime session without changing the frozen model', () => {
    const repository = createRepository()
    const record = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('claude_cli', 'r16e-claude-retry')]), includeProjectContext: false
    })
    const task = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: 'Claude结构化重试', provider: 'claude_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    repository.bindContentProviderInput(record.request.id, record.targets[0]!.id, task.id)
    repository.appendContentInstructionTargetEvent({
      targetId: record.targets[0]!.id, eventKind: 'task_linked', actualModel: null, actualReasoningEffort: null,
      providerThreadId: null, taskId: task.id, status: 'queued'
    })
    repository.updateTaskRun(task.id, { status: 'running' })
    repository.recordContentProviderRuntime(task.id, {
      model: 'claude-opus-4-8', reasoningEffort: 'max', providerThreadId: 'session-first'
    })
    repository.updateTaskRun(task.id, { status: 'failed', errorCode: 'SAVE_FAILED', errorMessage: '结果完成门失败' })
    const retry = repository.retryTaskRun(task.id)
    repository.updateTaskRun(retry.id, { status: 'running' })
    expect(() => repository.recordContentProviderRuntime(retry.id, {
      model: 'claude-opus-4-8', reasoningEffort: 'max', providerThreadId: 'session-second'
    })).not.toThrow()
    expect(repository.getContentInstructionRequestByTaskId(retry.id).targets[0]).toMatchObject({
      taskId: retry.id, status: 'running', actualModel: 'claude-opus-4-8', providerThreadId: 'session-second'
    })
  })

  it('rebinds a failed Codex retry to its new runtime thread without changing the frozen model', () => {
    const repository = createRepository()
    const record = repository.prepareContentInstructionRequest({
      ...prepareInput('ios', [providerTarget('codex_cli', 'r16e-codex-retry')]), includeProjectContext: false
    })
    const task = repository.createTaskRun({
      taskType: 'script_revision', projectId: 'ios', title: 'Codex结构化重试', provider: 'codex_cli', inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false }
    })
    repository.bindContentProviderInput(record.request.id, record.targets[0]!.id, task.id)
    repository.appendContentInstructionTargetEvent({
      targetId: record.targets[0]!.id, eventKind: 'task_linked', actualModel: null, actualReasoningEffort: null,
      providerThreadId: null, taskId: task.id, status: 'queued'
    })
    repository.updateTaskRun(task.id, { status: 'running' })
    repository.recordContentProviderRuntime(task.id, {
      model: 'gpt-5.6', reasoningEffort: 'xhigh', providerThreadId: 'thread-first'
    })
    repository.updateTaskRun(task.id, { status: 'failed', errorCode: 'SAVE_FAILED', errorMessage: '结果完成门失败' })
    const retry = repository.retryTaskRun(task.id)
    repository.updateTaskRun(retry.id, { status: 'running' })
    expect(() => repository.recordContentProviderRuntime(retry.id, {
      model: 'gpt-5.6', reasoningEffort: 'xhigh', providerThreadId: 'thread-second'
    })).not.toThrow()
    expect(repository.getContentInstructionRequestByTaskId(retry.id).targets[0]).toMatchObject({
      taskId: retry.id, status: 'running', actualModel: 'gpt-5.6', providerThreadId: 'thread-second'
    })
  })

  it('persists revision fact annotations only with matching runtime evidence and keeps failures atomic', () => {
    const repository = createRepository()
    const startTask = (message: string) => repository.startScriptRevisionDiscussion({
      projectId: 'ios', currentDocumentContent: '<p></p>', includeProjectContext: false,
      provider: 'codex_cli', webSearchMode: 'automatic', message,
      selection: { targetSelectionId: null, selectedText: null, contextBefore: '', contextAfter: '', occurrenceIndex: null, from: null, to: null },
      providerSecurity: { provider: 'codex_cli', cliVersion: '1.2.3', fingerprint: 'revision-evidence', policyVersion: 'policy-v1' }
    })
    const bindTask = (taskId: string, suffix: string) => {
      const record = repository.prepareContentInstructionRequest({
        ...prepareInput('ios', [providerTarget('codex_cli', suffix)]), includeProjectContext: false
      })
      repository.bindContentProviderInput(record.request.id, record.targets[0]!.id, taskId)
    }
    const task = startTask('核对官方售价')
    bindTask(task.id, 'revision-evidence')
    const answer = repository.saveScriptRevisionAnswer(task.id, {
      answer: '官方售价是1999元。', suggestion: null, conflicts: [],
      annotations: [{
        text: '1999元', provenance: 'web_supplement', note: '来自官网价格页', claim: '官方售价为1999元',
        factType: 'price', priceKind: 'current_official', currency: 'CNY', confirmationKind: null,
        webSources: [{ title: '官网价格页', url: 'https://example.com/product#price' }]
      }]
    }, {
      providerThreadId: 'revision-evidence-thread', model: 'gpt-5.6', reasoningEffort: 'xhigh', webSearchMode: 'automatic',
      webSearches: [{
        type: 'open_page', query: null, url: 'https://example.com/product', runtimeAccessId: 'runtime-open-1', accessedAt: '2026-08-05T01:02:03.000Z'
      }]
    })
    expect(answer.factAnnotations).toEqual([expect.objectContaining({
      start: 5, end: 10, text: '1999元', provenance: 'web_supplement',
      webSources: [{ title: '官网价格页', url: 'https://example.com/product' }],
      evidenceIds: [expect.any(String)]
    })])
    expect(repository.listContentFactEvidence(task.id)).toEqual([expect.objectContaining({
      claim: '官方售价为1999元', sourceUrl: 'https://example.com/product', accessedAt: '2026-08-05T01:02:03.000Z',
      evidenceType: 'price', priceKind: 'current_official', currency: 'CNY', runtimeAccessId: 'runtime-open-1'
    })])
    expect(answer.factAnnotations[0]!.evidenceIds).toEqual([repository.listContentFactEvidence(task.id)[0]!.id])
    const missingPriceKindTask = startTask('核对没有价格类型的官方售价')
    bindTask(missingPriceKindTask.id, 'revision-missing-price-kind')
    expect(() => repository.saveScriptRevisionAnswer(missingPriceKindTask.id, {
      answer: '官方售价是2599元。', suggestion: null, conflicts: [],
      annotations: [{
        text: '2599元', provenance: 'web_supplement', note: '官网价格页', claim: '官方售价为2599元',
        factType: 'price', priceKind: null, currency: 'CNY', confirmationKind: null,
        webSources: [{ title: '官网价格页', url: 'https://example.com/product-price-kind' }]
      }]
    }, {
      providerThreadId: 'revision-missing-price-kind-thread', model: 'gpt-5.6', reasoningEffort: 'xhigh', webSearchMode: 'automatic',
      webSearches: [{ type: 'open_page', query: null, url: 'https://example.com/product-price-kind', runtimeAccessId: 'runtime-open-price-kind', accessedAt: '2026-08-05T01:02:04.000Z' }]
    })).toThrow('PROVIDER_FACT_EVIDENCE_INCOMPLETE')
    const missingTimeTask = startTask('核对另一个官方售价')
    bindTask(missingTimeTask.id, 'revision-missing-access-time')
    expect(() => repository.saveScriptRevisionAnswer(missingTimeTask.id, {
      answer: '官方售价是2999元。', suggestion: null, conflicts: [],
      annotations: [{
        text: '2999元', provenance: 'web_supplement', note: '官网价格页', claim: '官方售价为2999元',
        factType: 'price', priceKind: 'current_official', currency: 'CNY', confirmationKind: null,
        webSources: [{ title: '官网价格页', url: 'https://example.com/product-2' }]
      }]
    }, {
      providerThreadId: 'revision-missing-time-thread', model: 'gpt-5.6', reasoningEffort: 'xhigh', webSearchMode: 'automatic',
      webSearches: [{ type: 'open_page', query: null, url: 'https://example.com/product-2', runtimeAccessId: 'runtime-open-no-time' }]
    })).toThrow('PROVIDER_FACT_EVIDENCE_RUNTIME_ACCESS_MISSING')

    const invalidTask = startTask('补一个官方价格')
    bindTask(invalidTask.id, 'revision-invalid-red')
    expect(() => repository.saveScriptRevisionAnswer(invalidTask.id, {
      answer: '官方售价请用户填写。', suggestion: null, conflicts: [],
      annotations: [{
        text: '官方售价', provenance: 'needs_confirmation', note: '我实际购买价需要用户填写', claim: null,
        factType: null, currency: null, confirmationKind: 'user_only', webSources: []
      }]
    })).toThrow('PROVIDER_USER_FACT_CONFIRMATION_INVALID')
    expect(repository.getScriptRevisionConversation('ios').messages.filter((message) => message.taskId === invalidTask.id && message.role === 'assistant')).toHaveLength(0)
    expect(repository.listContentFactEvidence(invalidTask.id)).toEqual([])
  })
})
