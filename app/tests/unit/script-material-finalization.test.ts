import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { parseScriptMaterialAuditTaskSnapshot, validateScriptMaterialAuditOutput } from '../../src/main/script-material'
import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../../src/shared/domain'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')
const providerSecurity = {
  provider: 'codex_cli' as const,
  providerConfigId: BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex,
  displayName: 'Codex CLI',
  cliVersion: 'test',
  fingerprint: 'script-material-finalization-test',
  policyVersion: 'test-policy'
}

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-script-material-finalization-'))
  roots.push(directory)
  const store = await openWorkspaceStore(directory)
  stores.push(store)
  return store
}

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function prepareMaterial(store: WorkspaceStore): Promise<{
  firstPointId: string
  secondPointId: string
}> {
  store.repository.saveScriptMaterialWorkspace('ios', { workingContent: '第一点。\n第二点。' })
  let workspace = store.repository.createScriptMaterialRevision('ios')
  workspace = store.repository.replaceScriptMaterialPoints('ios', workspace.activeRevision!.id, [{
    sourceStart: 0, sourceEnd: 4, sourceText: '第一点。', summary: '第一点'
  }, {
    sourceStart: 5, sourceEnd: 9, sourceText: '第二点。', summary: '第二点'
  }])
  workspace = store.repository.confirmScriptMaterialPoints('ios', workspace.activeRevision!.id)
  return { firstPointId: workspace.points[0]!.id, secondPointId: workspace.points[1]!.id }
}

describe('script material R42e finalization gate', () => {
  it('keeps checks independent for each AI draft identity', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const revisionId = store.repository.getScriptMaterialWorkspace('ios').activeRevision!.id
    const timestamp = new Date().toISOString()
    const insertDraft = store.repository.native.prepare(`INSERT INTO script_material_drafts(
      id,project_id,revision_id,side,source_kind,requirement,input_fingerprint,content,content_hash,
      draft_version,mapping_state,current_mappings_json,paragraphs_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    insertDraft.run(
      'draft-one', 'ios', revisionId, 'codex', 'provider', '', 'input-one', '第一稿完整覆盖两点', 'hash-one',
      1, 'ready', '[]', JSON.stringify([{ id: 'draft-one-p1', position: 0, text: '第一稿完整覆盖两点', sourcePointIds: [points.firstPointId, points.secondPointId], transform: 'combined', provenance: ['source'], webSources: [], annotations: [], manualMarks: [] }]), timestamp, timestamp
    )
    insertDraft.run(
      'draft-two', 'ios', revisionId, 'codex', 'provider', '', 'input-two', '第二稿只覆盖一点', 'hash-two',
      2, 'ready', '[]', JSON.stringify([{ id: 'draft-two-p1', position: 0, text: '第二稿只覆盖一点', sourcePointIds: [points.firstPointId], transform: 'polished', provenance: ['source'], webSources: [], annotations: [], manualMarks: [] }]), timestamp, timestamp
    )

    for (const draft of [
      { id: 'draft-one', paragraphId: 'draft-one-p1', secondStatus: 'complete' as const },
      { id: 'draft-two', paragraphId: 'draft-two-p1', secondStatus: 'missing' as const }
    ]) {
      const task = store.repository.startScriptMaterialAudit({
        projectId: 'ios', target: 'codex', draftId: draft.id, providerSecurity
      })
      const snapshot = parseScriptMaterialAuditTaskSnapshot(task.inputSnapshot)
      store.repository.saveScriptMaterialAuditResult(task.id, validateScriptMaterialAuditOutput(snapshot, {
        pointCoverage: [{
          pointId: points.firstPointId, status: 'complete', paragraphIds: [draft.paragraphId], rationale: '已覆盖'
        }, {
          pointId: points.secondPointId,
          status: draft.secondStatus,
          paragraphIds: draft.secondStatus === 'complete' ? [draft.paragraphId] : [],
          rationale: draft.secondStatus === 'complete' ? '已覆盖' : '未出现'
        }],
        paragraphFindings: []
      }))
    }

    const checks = store.repository.getScriptMaterialWorkspace('ios').checks
    expect(checks).toHaveLength(2)
    expect(checks.map((check) => check.targetIdentity)).toEqual(['draft-one', 'draft-two'])
    expect(checks.find((check) => check.targetIdentity === 'draft-one')?.pointCoverage[1]?.status).toBe('complete')
    expect(checks.find((check) => check.targetIdentity === 'draft-two')?.pointCoverage[1]?.status).toBe('missing')
  })

  it('keeps omissions version-scoped and requires every unsupported fact to be resolved', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const currentContent = '第一点。\n新增了两个需要本人确认的事实。'
    const task = store.repository.startScriptMaterialAudit({
      projectId: 'ios',
      target: 'current',
      currentContent,
      currentParagraphs: [
        { id: 'current-0', position: 0, text: '第一点。' },
        { id: 'current-5', position: 1, text: '新增了两个需要本人确认的事实。' }
      ],
      providerSecurity
    })
    const snapshot = parseScriptMaterialAuditTaskSnapshot(task.inputSnapshot)
    const output = validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: points.firstPointId, status: 'complete', paragraphIds: ['current-0'], rationale: '已覆盖'
      }, {
        pointId: points.secondPointId, status: 'missing', paragraphIds: [], rationale: '未出现'
      }],
      paragraphFindings: [{
        paragraphId: 'current-5', sourcePointIds: [], provenance: 'needs_confirmation', note: '事实A没有原稿依据'
      }, {
        paragraphId: 'current-5', sourcePointIds: [], provenance: 'needs_confirmation', note: '事实B没有原稿依据'
      }]
    })
    let workspace = store.repository.saveScriptMaterialAuditResult(task.id, output)
    expect(workspace.checks[0]).toMatchObject({
      targetIdentity: 'current',
      state: 'ready',
      checkedAt: expect.any(String)
    })
    expect(new Set(workspace.checks[0]!.paragraphFindings.map((finding) => finding.id)).size).toBe(2)
    expect(store.repository.getScriptMaterialFinalizationGate('ios', currentContent)).toMatchObject({
      canFinalize: false,
      state: 'blocked',
      blockingPointIds: [points.secondPointId],
      unresolvedFindingIds: expect.arrayContaining(workspace.checks[0]!.paragraphFindings.map((finding) => finding.id))
    })

    workspace = store.repository.setScriptMaterialAllowedOmissions('ios', 'current', [points.secondPointId])
    const [findingA, findingB] = workspace.checks[0]!.paragraphFindings
    workspace = store.repository.confirmScriptMaterialFinding('ios', 'current', findingA!.id, '来自本人实测记录A')
    expect(store.repository.getScriptMaterialFinalizationGate('ios', currentContent).unresolvedFindingIds).toEqual([findingB!.id])
    workspace = store.repository.confirmScriptMaterialFinding('ios', 'current', findingB!.id, '来自本人实测记录B')
    expect(store.repository.getScriptMaterialFinalizationGate('ios', currentContent)).toMatchObject({
      canFinalize: true,
      state: 'ready'
    })

    const version = store.repository.saveScript('ios', 'merged_draft', `<p>第一点。</p><p>新增了两个需要本人确认的事实。</p>`)
    const frozenBeforeFinal = store.repository.getScriptMaterialVersionSnapshot('ios', version.id)
    expect(frozenBeforeFinal?.workspace.checks[0]?.allowedOmissionPointIds).toEqual([points.secondPointId])
    store.repository.setFinalVersion('ios', version.id)
    const frozen = store.repository.getScriptMaterialVersionSnapshot('ios', version.id)
    expect(frozen?.finalization).toMatchObject({
      allowedOmissionPointIds: [points.secondPointId],
      confirmedFindingIds: expect.arrayContaining([findingA!.id, findingB!.id])
    })
    expect(store.repository.getScriptMaterialWorkspace('ios').points.find((point) => point.id === points.secondPointId)?.adoption).toBe('required')
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]?.allowedOmissionPointIds).toEqual([])
    const restored = store.repository.restoreScriptMaterialVersionSnapshot('ios', version.id)
    expect(restored.checks[0]?.allowedOmissionPointIds).toEqual([points.secondPointId])
    expect(restored.checks[0]?.paragraphFindings.every((finding) => finding.status === 'confirmed')).toBe(true)
  })

  it('treats changed content as stale, snapshots it honestly and blocks direct finalization', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const checkedContent = '第一点。\n第二点。'
    const task = store.repository.startScriptMaterialAudit({
      projectId: 'ios',
      target: 'current',
      currentContent: checkedContent,
      providerSecurity
    })
    const snapshot = parseScriptMaterialAuditTaskSnapshot(task.inputSnapshot)
    store.repository.saveScriptMaterialAuditResult(task.id, validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: points.firstPointId, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
      }, {
        pointId: points.secondPointId, status: 'complete', paragraphIds: ['current-p-2'], rationale: '已覆盖'
      }],
      paragraphFindings: []
    }))

    const changed = store.repository.saveScript('ios', 'merged_draft', '<p>第一点。</p><p>第二点改过了。</p>')
    expect(store.repository.getScriptMaterialVersionSnapshot('ios', changed.id)?.workspace.checks[0]?.state).toBe('stale')
    expect(store.repository.getScriptMaterialFinalizationGate('ios', '第一点。\n第二点改过了。')).toMatchObject({
      canFinalize: false,
      state: 'stale'
    })
    expect(() => store.repository.setFinalVersion('ios', changed.id)).toThrow('最新检查')
  })

  it('saves and finalizes atomically so a failed gate cannot leave a stray version', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const checkedContent = '第一点。\n第二点。'
    const task = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent: checkedContent, providerSecurity
    })
    const snapshot = parseScriptMaterialAuditTaskSnapshot(task.inputSnapshot)
    store.repository.saveScriptMaterialAuditResult(task.id, validateScriptMaterialAuditOutput(snapshot, {
      pointCoverage: [{
        pointId: points.firstPointId, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
      }, {
        pointId: points.secondPointId, status: 'complete', paragraphIds: ['current-p-2'], rationale: '已覆盖'
      }],
      paragraphFindings: []
    }))
    const before = store.repository.getProject('ios').versions.filter((version) => version.documentType === 'script').length
    expect(() => store.repository.saveAndFinalizeScript('ios', '<p>正文已经变化。</p>')).toThrow('最新检查')
    expect(() => store.repository.saveScript('ios', 'final', '<p>旧接口也不能绕过检查。</p>')).toThrow('最新检查')
    expect(store.repository.getProject('ios').versions.filter((version) => version.documentType === 'script')).toHaveLength(before)

    const finalVersion = store.repository.saveAndFinalizeScript(
      'ios',
      '<p><span data-script-marker-id="marker-1" data-script-marker-note="核实"><u>第一点。</u></span></p><p><mark data-color="#F3D9A3">第二点。</mark></p>',
      undefined,
      '原子定稿'
    )
    expect(finalVersion.isFinal).toBe(true)
    expect(finalVersion.content).toBe('<p><u>第一点。</u></p><p><mark data-color="#F3D9A3">第二点。</mark></p>')
    expect(finalVersion.workspaceContent).toContain('data-script-marker-id="marker-1"')
    expect(finalVersion.workspaceContent).toContain('<u>第一点。</u>')
    const finalizedSnapshot = store.repository.getScriptMaterialVersionSnapshot('ios', finalVersion.id)
    expect(finalizedSnapshot?.finalization).not.toBeNull()
    expect(finalizedSnapshot?.workspaceContentHash).toHaveLength(64)
    const legacyFinalVersion = store.repository.saveScript('ios', 'final', '<p>第一点。</p><p>第二点。</p>')
    expect(legacyFinalVersion.isFinal).toBe(true)
    expect(store.repository.getScriptMaterialVersionSnapshot('ios', legacyFinalVersion.id)?.finalization).not.toBeNull()
    store.repository.setFinalVersion('ios', finalVersion.id)
    expect(store.repository.getScriptMaterialVersionSnapshot('ios', finalVersion.id)).toMatchObject({
      snapshotHash: finalizedSnapshot?.snapshotHash,
      finalization: finalizedSnapshot?.finalization
    })
  })

  it('restores exact frozen points and marks an ended in-flight historical check stale', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const currentContent = '第一点。\n第二点。'
    const readyTask = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent, providerSecurity
    })
    const readySnapshot = parseScriptMaterialAuditTaskSnapshot(readyTask.inputSnapshot)
    store.repository.saveScriptMaterialAuditResult(readyTask.id, validateScriptMaterialAuditOutput(readySnapshot, {
      pointCoverage: readySnapshot.points.map((point, index) => ({
        pointId: point.id,
        status: 'complete',
        paragraphIds: [readySnapshot.paragraphs[index]?.id ?? readySnapshot.paragraphs[0]!.id],
        rationale: '已覆盖'
      })),
      paragraphFindings: []
    }))
    const saved = store.repository.saveScript('ios', 'merged_draft', '<p>第一点。</p><p>第二点。</p>')
    store.repository.replaceScriptMaterialPoints('ios', readySnapshot.revisionId, [{
      id: points.firstPointId,
      sourceStart: 0,
      sourceEnd: 4,
      sourceText: '第一点。',
      summary: '第一点已经重新定义'
    }, {
      id: points.secondPointId,
      sourceStart: 5,
      sourceEnd: 9,
      sourceText: '第二点。',
      summary: '第二点'
    }])
    store.repository.confirmScriptMaterialPoints('ios', readySnapshot.revisionId)
    let restored = store.repository.restoreScriptMaterialVersionSnapshot('ios', saved.id)
    expect(restored.points[0]?.summary).toBe('第一点')
    expect(restored.checks.find((check) => check.targetIdentity === 'current')).toMatchObject({
      state: 'ready',
      errorMessage: null
    })
    expect(store.repository.getScriptMaterialFinalizationGate('ios', currentContent).state).toBe('ready')

    const checkingTask = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent, providerSecurity
    })
    const checkingVersion = store.repository.saveScript('ios', 'merged_draft', '<p>第一点。</p><p>第二点。</p>')
    store.repository.updateTaskRun(checkingTask.id, {
      status: 'succeeded',
      progress: 100,
      finishedAt: new Date().toISOString()
    })
    restored = store.repository.restoreScriptMaterialVersionSnapshot('ios', checkingVersion.id)
    expect(restored.checks.find((check) => check.targetIdentity === 'current')).toMatchObject({
      state: 'stale',
      taskId: null,
      errorMessage: expect.stringContaining('历史检查任务已经结束')
    })
    const restarted = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent, providerSecurity
    })
    expect(store.repository.getScriptMaterialWorkspace('ios').checks.find((check) => check.targetIdentity === 'current')).toMatchObject({
      state: 'checking',
      taskId: restarted.id
    })
  })

  it('does not clear a newer current check when an older frozen version is finalized', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const runAudit = (currentContent: string, note: string): { findingId: string } => {
      const task = store.repository.startScriptMaterialAudit({
        projectId: 'ios', target: 'current', currentContent, providerSecurity
      })
      const snapshot = parseScriptMaterialAuditTaskSnapshot(task.inputSnapshot)
      const output = validateScriptMaterialAuditOutput(snapshot, {
        pointCoverage: [{
          pointId: points.firstPointId,
          status: 'complete',
          paragraphIds: [snapshot.paragraphs[0]!.id],
          rationale: '已覆盖'
        }, {
          pointId: points.secondPointId,
          status: 'missing',
          paragraphIds: [],
          rationale: '未覆盖'
        }],
        paragraphFindings: [{
          paragraphId: snapshot.paragraphs.at(-1)!.id,
          sourcePointIds: [],
          provenance: 'needs_confirmation',
          note
        }]
      })
      let workspace = store.repository.saveScriptMaterialAuditResult(task.id, output)
      workspace = store.repository.setScriptMaterialAllowedOmissions('ios', 'current', [points.secondPointId])
      const findingId = workspace.checks.find((check) => check.targetIdentity === 'current')!.paragraphFindings[0]!.id
      store.repository.confirmScriptMaterialFinding('ios', 'current', findingId, `${note}的本人依据`)
      return { findingId }
    }

    runAudit('第一点。\n旧事实。', '旧事实')
    const oldVersion = store.repository.saveScript('ios', 'merged_draft', '<p>第一点。</p><p>旧事实。</p>')
    const newer = runAudit('第一点。\n新事实。', '新事实')
    const newerCheckBefore = store.repository.getScriptMaterialWorkspace('ios').checks.find((check) => check.targetIdentity === 'current')!
    store.repository.setFinalVersion('ios', oldVersion.id)
    const newerCheckAfter = store.repository.getScriptMaterialWorkspace('ios').checks.find((check) => check.targetIdentity === 'current')!
    expect(newerCheckAfter.inputFingerprint).toBe(newerCheckBefore.inputFingerprint)
    expect(newerCheckAfter.allowedOmissionPointIds).toEqual([points.secondPointId])
    expect(newerCheckAfter.paragraphFindings.find((finding) => finding.id === newer.findingId)).toMatchObject({
      status: 'confirmed',
      resolutionNote: '新事实的本人依据'
    })
  })

  it('freezes local rewrite task status instead of reading its later mutable TaskRun state', async () => {
    const store = await createStore()
    await prepareMaterial(store)
    const revisionId = store.repository.getScriptMaterialWorkspace('ios').activeRevision!.id
    const timestamp = new Date().toISOString()
    store.repository.native.prepare(`INSERT INTO script_material_drafts(
      id,project_id,revision_id,side,source_kind,requirement,input_fingerprint,content,content_hash,
      draft_version,mapping_state,current_mappings_json,paragraphs_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'rewrite-draft', 'ios', revisionId, 'codex', 'provider', '', 'rewrite-draft-input',
      '需要局部修改的AI稿', 'rewrite-draft-hash', 1, 'ready', '[]',
      JSON.stringify([{
        id: 'rewrite-paragraph',
        position: 0,
        text: '需要局部修改的AI稿',
        sourcePointIds: [],
        transform: 'polished',
        provenance: ['source'],
        webSources: [],
        annotations: [],
        manualMarks: []
      }]),
      timestamp,
      timestamp
    )
    const task = store.repository.createTaskRun({
      taskType: 'script_material_chat',
      projectId: 'ios',
      title: '局部改写候选',
      provider: 'codex_cli',
      inputSnapshot: '{}',
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'none', shell: false },
      outputTarget: 'script-material-rewrite:ios'
    })
    store.repository.native.prepare(`INSERT INTO script_material_rewrite_candidates(
      id,project_id,revision_id,draft_id,side,paragraph_ids_json,selected_text,requirement,content,
      source_point_ids_json,annotations_json,task_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'rewrite-candidate', 'ios', revisionId, 'rewrite-draft', 'codex',
      JSON.stringify(['rewrite-paragraph']), '', '更口语', '', '[]', '[]', task.id, timestamp
    )
    const version = store.repository.saveScript('ios', 'merged_draft', '<p>当前文案。</p>')
    store.repository.updateTaskRun(task.id, {
      status: 'failed',
      errorCode: 'LATER_FAILURE',
      errorMessage: '保存版本之后才失败',
      finishedAt: new Date().toISOString()
    })
    const frozenCandidate = store.repository.getScriptMaterialVersionSnapshot('ios', version.id)?.workspace.rewriteCandidates[0]
    expect(frozenCandidate).toMatchObject({
      id: 'rewrite-candidate',
      taskStatusAtSnapshot: 'queued',
      taskErrorAtSnapshot: null
    })
    expect(store.repository.getTaskRun(task.id).status).toBe('failed')
  })

  it('uses task and input fingerprint CAS so a late audit cannot overwrite the newer check', async () => {
    const store = await createStore()
    const points = await prepareMaterial(store)
    const currentContent = '第一点。\n第二点。'
    const firstTask = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent, providerSecurity
    })
    const secondTask = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent, providerSecurity
    })
    const outputFor = (taskId: string) => {
      const snapshot = parseScriptMaterialAuditTaskSnapshot(store.repository.getTaskRun(taskId).inputSnapshot)
      return validateScriptMaterialAuditOutput(snapshot, {
        pointCoverage: [{
          pointId: points.firstPointId, status: 'complete', paragraphIds: ['current-p-1'], rationale: '已覆盖'
        }, {
          pointId: points.secondPointId, status: 'complete', paragraphIds: ['current-p-2'], rationale: '已覆盖'
        }],
        paragraphFindings: []
      })
    }
    store.repository.saveScriptMaterialAuditResult(firstTask.id, outputFor(firstTask.id))
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]).toMatchObject({
      state: 'checking',
      taskId: secondTask.id
    })
    store.repository.saveScriptMaterialAuditResult(secondTask.id, outputFor(secondTask.id))
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]).toMatchObject({
      state: 'ready',
      taskId: secondTask.id
    })
  })

  it('binds the audit fingerprint to provider security and rejects mismatched renderer paragraph snapshots', async () => {
    const store = await createStore()
    await prepareMaterial(store)
    const currentContent = '第一点。\n第二点。'
    expect(() => store.repository.startScriptMaterialAudit({
      projectId: 'ios',
      target: 'current',
      currentContent,
      currentParagraphs: [{ id: 'current-0', position: 0, text: '正文已经不同' }],
      providerSecurity
    })).toThrow('段落快照与正文不一致')

    const first = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent, providerSecurity
    })
    const second = store.repository.startScriptMaterialAudit({
      projectId: 'ios',
      target: 'current',
      currentContent,
      providerSecurity: { ...providerSecurity, fingerprint: 'different-provider-safety-fingerprint' }
    })
    expect(parseScriptMaterialAuditTaskSnapshot(first.inputSnapshot).inputFingerprint)
      .not.toBe(parseScriptMaterialAuditTaskSnapshot(second.inputSnapshot).inputFingerprint)
  })

  it('moves failed, retried and canceled audits out of the checking state', async () => {
    const store = await createStore()
    await prepareMaterial(store)
    const task = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent: '第一点。\n第二点。', providerSecurity
    })
    store.repository.updateTaskRun(task.id, {
      status: 'failed',
      errorCode: 'TEST_FAILURE',
      errorMessage: '检查失败',
      finishedAt: new Date().toISOString()
    })
    store.repository.failScriptMaterialAudit(task.id, '检查失败')
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]).toMatchObject({
      state: 'failed',
      errorMessage: '检查失败'
    })
    const retry = store.repository.retryTaskRun(task.id)
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]).toMatchObject({
      state: 'checking',
      taskId: retry.id
    })
    store.repository.cancelTaskRun(retry.id)
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]).toMatchObject({
      state: 'failed',
      errorMessage: '检查任务已取消'
    })
    const newer = store.repository.startScriptMaterialAudit({
      projectId: 'ios', target: 'current', currentContent: '第一点。\n第二点。', providerSecurity
    })
    const newerSnapshot = parseScriptMaterialAuditTaskSnapshot(newer.inputSnapshot)
    store.repository.saveScriptMaterialAuditResult(newer.id, validateScriptMaterialAuditOutput(newerSnapshot, {
      pointCoverage: newerSnapshot.points.map((point, index) => ({
        pointId: point.id,
        status: 'complete',
        paragraphIds: [newerSnapshot.paragraphs[index]?.id ?? newerSnapshot.paragraphs[0]!.id],
        rationale: '已覆盖'
      })),
      paragraphFindings: []
    }))
    const taskCount = store.repository.listTaskRuns().length
    expect(() => store.repository.retryTaskRun(retry.id)).toThrow('更新的任务替代')
    expect(store.repository.listTaskRuns()).toHaveLength(taskCount)
    store.repository.failScriptMaterialAudit(retry.id, '迟到的失败不能覆盖最新结果')
    expect(store.repository.getScriptMaterialWorkspace('ios').checks[0]).toMatchObject({
      state: 'ready',
      taskId: newer.id
    })
  })
})
