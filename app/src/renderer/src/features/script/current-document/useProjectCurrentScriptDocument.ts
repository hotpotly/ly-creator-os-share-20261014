import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CurrentScriptConflictResult,
  CurrentScriptInitializationCandidate,
  CurrentScriptRecoveryCandidate,
  DraftVersion,
  ProjectCurrentScriptSnapshot,
  ScriptMaterialWorkspace
} from '../../../../../shared/domain'
import { sourceContentToRichTextHtml } from '../../../../../shared/script-version-content'
import { ensureCurrentScriptEditorIdentity, setAuthoritativeCurrentScriptEditorContent } from './CurrentScriptEditorIdentity'
import {
  buildCurrentScriptFacts,
  canonicalCurrentScriptValue,
  currentScriptSnapshotInputs,
  projectCurrentScriptFactsToEditorDocument
} from './current-script-adapter'

export type CurrentScriptLifecyclePhase = 'disabled' | 'loading' | 'ready' | 'selection_required' | 'confirmation_required' | 'error'
export type CurrentScriptSaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

export interface PendingInitialization {
  candidateId: string | null
  editorDocument: Record<string, unknown>
  sourceRelations: ReturnType<typeof buildCurrentScriptFacts>['sourceRelations']
  annotations: ReturnType<typeof buildCurrentScriptFacts>['annotations']
  message: string
}

export interface ProjectCurrentScriptController {
  phase: CurrentScriptLifecyclePhase
  saveState: CurrentScriptSaveState
  error: string
  localJournalError: string
  authoritativeEpoch: number
  snapshot: ProjectCurrentScriptSnapshot | null
  candidates: CurrentScriptInitializationCandidate[]
  pendingInitialization: PendingInitialization | null
  conflict: CurrentScriptConflictResult | null
  recoveryCandidates: CurrentScriptRecoveryCandidate[]
  initializeFromCandidate(candidateId: string | null): Promise<void>
  confirmInitialization(): Promise<void>
  flush(): Promise<ProjectCurrentScriptSnapshot | null>
  saveVersion(kind: 'merged_draft' | 'user_edit', displayName?: string, finalize?: boolean): Promise<DraftVersion | null>
  applySnapshot(snapshot: ProjectCurrentScriptSnapshot): Promise<boolean>
  restoreVersion(input: { snapshot?: ProjectCurrentScriptSnapshot; content?: string; sourceVersionId: string | null; displayName?: string }): Promise<{ version: DraftVersion; materialWorkspace: ScriptMaterialWorkspace | null } | null>
  resolveRecovery(conflictId: string, resolution: 'keep_server' | 'replace_with_attempt' | 'save_attempt_as_version'): Promise<string>
  discardLocalJournal(): Promise<void>
  reload(): Promise<void>
}

type CurrentScriptRecoveryJournal = ReturnType<typeof currentScriptSnapshotInputs> & {
  projectId: string
  workingDocumentId: string
  clientMutationId: string
  expectedRevision: number
  expectedContentHash: string
}

function recoveryJournalKey(projectId: string): string {
  return `current-script-recovery-journal:${projectId}`
}

function readRecoveryJournal(projectId: string): CurrentScriptRecoveryJournal | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recoveryJournalKey(projectId)) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const value = parsed as Partial<CurrentScriptRecoveryJournal>
    if (value.projectId !== projectId || typeof value.workingDocumentId !== 'string' || typeof value.expectedRevision !== 'number' || typeof value.expectedContentHash !== 'string'
      || !value.editorDocument || typeof value.editorDocument !== 'object' || !Array.isArray(value.sourceRelations) || !Array.isArray(value.annotations)) return null
    const normalized = {
      ...value,
      clientMutationId: typeof value.clientMutationId === 'string' && value.clientMutationId
        ? value.clientMutationId
        : crypto.randomUUID()
    } as CurrentScriptRecoveryJournal
    if (value.clientMutationId !== normalized.clientMutationId) {
      window.localStorage.setItem(recoveryJournalKey(projectId), JSON.stringify(normalized))
    }
    return normalized
  } catch {
    return null
  }
}

function hasRecoveryJournal(projectId: string): boolean {
  try {
    return window.localStorage.getItem(recoveryJournalKey(projectId)) !== null
  } catch {
    return false
  }
}

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function inputFingerprint(value: ReturnType<typeof currentScriptSnapshotInputs>): string {
  return canonicalCurrentScriptValue(value)
}

function recoveryCandidateFromConflict(projectId: string, result: CurrentScriptConflictResult): CurrentScriptRecoveryCandidate {
  return {
    id: result.conflictId,
    projectId,
    workingDocumentId: result.expected.workingDocumentId,
    expectedRevision: result.expected.revision,
    expectedContentHash: result.expected.contentHash,
    headRevisionAtWrite: result.actual.document.revision,
    headContentHashAtWrite: result.actual.document.contentHash,
    reason: result.reason,
    actual: result.actual,
    editorDocument: result.attempted.editorDocument,
    contentHash: result.attempted.contentHash,
    sourceRelations: result.attempted.sourceRelations,
    annotations: result.attempted.annotations,
    resolvedAt: null,
    createdAt: new Date().toISOString()
  }
}

export function useProjectCurrentScriptDocument(input: {
  projectId: string
  editor: Editor | null
  enabled: boolean
  materialWorkspace: ScriptMaterialWorkspace | null
}): ProjectCurrentScriptController {
  const { projectId, editor, enabled, materialWorkspace } = input
  const [phase, setPhase] = useState<CurrentScriptLifecyclePhase>(enabled ? 'loading' : 'disabled')
  const [saveState, setSaveState] = useState<CurrentScriptSaveState>('saved')
  const [error, setError] = useState('')
  const [localJournalError, setLocalJournalError] = useState('')
  const [authoritativeEpoch, setAuthoritativeEpoch] = useState(0)
  const [snapshot, setSnapshot] = useState<ProjectCurrentScriptSnapshot | null>(null)
  const [candidates, setCandidates] = useState<CurrentScriptInitializationCandidate[]>([])
  const [pendingInitialization, setPendingInitialization] = useState<PendingInitialization | null>(null)
  const [conflict, setConflict] = useState<CurrentScriptConflictResult | null>(null)
  const [recoveryCandidates, setRecoveryCandidates] = useState<CurrentScriptRecoveryCandidate[]>([])
  const recoveryCandidatesRef = useRef<CurrentScriptRecoveryCandidate[]>([])
  const candidatesRef = useRef<CurrentScriptInitializationCandidate[]>([])
  const materialRevisionIdRef = useRef<string | null>(materialWorkspace?.activeRevision?.id ?? null)
  const snapshotRef = useRef<ProjectCurrentScriptSnapshot | null>(null)
  const phaseRef = useRef<CurrentScriptLifecyclePhase>(phase)
  const conflictRef = useRef<CurrentScriptConflictResult | null>(null)
  const hydrationRef = useRef(false)
  const identityRef = useRef(false)
  const loadTokenRef = useRef(0)
  const editGenerationRef = useRef(0)
  const savedGenerationRef = useRef(0)
  const autosaveTimerRef = useRef<number | null>(null)
  const flushPromiseRef = useRef<Promise<ProjectCurrentScriptSnapshot | null> | null>(null)
  const versionWritePromiseRef = useRef<Promise<DraftVersion | null> | null>(null)
  const versionSaveRequestRef = useRef<{ lifecycleToken: number; requestKey: string; promise: Promise<DraftVersion | null> } | null>(null)
  const generatedIdsRef = useRef(new Map<string, string>())
  materialRevisionIdRef.current = materialWorkspace?.activeRevision?.id ?? null

  const setLifecyclePhase = (next: CurrentScriptLifecyclePhase): void => {
    phaseRef.current = next
    setPhase(next)
  }
  const setCurrentConflict = (next: CurrentScriptConflictResult | null): void => {
    conflictRef.current = next
    setConflict(next)
  }
  const setCurrentSnapshot = (next: ProjectCurrentScriptSnapshot | null): void => {
    snapshotRef.current = next
    setSnapshot(next)
  }

  const hydrate = useCallback((next: ProjectCurrentScriptSnapshot): void => {
    if (!editor) return
    hydrationRef.current = true
    try {
      setAuthoritativeCurrentScriptEditorContent(editor, projectCurrentScriptFactsToEditorDocument(next))
      setCurrentSnapshot(next)
      setAuthoritativeEpoch((value) => value + 1)
      editGenerationRef.current = 0
      savedGenerationRef.current = 0
      generatedIdsRef.current.clear()
      setCurrentConflict(null)
      setSaveState('saved')
      setError('')
      setLifecyclePhase('ready')
    } finally {
      hydrationRef.current = false
    }
  }, [editor])

  const factsFor = useCallback((editorDocument: Record<string, unknown>, previous: ProjectCurrentScriptSnapshot | null) => (
    buildCurrentScriptFacts(editorDocument, {
      previous,
      materialRevisionId: materialRevisionIdRef.current,
      createId: () => crypto.randomUUID(),
      generatedIds: generatedIdsRef.current
    })
  ), [])

  const ingestConflict = useCallback(async (
    result: CurrentScriptConflictResult,
    lifecycleToken: number
  ): Promise<void> => {
    const api = window.creatorOS
    const attemptedInputs = {
      editorDocument: result.attempted.editorDocument,
      sourceRelations: result.attempted.sourceRelations,
      annotations: result.attempted.annotations
    }
    const journal = readRecoveryJournal(projectId)
    if (api && journal && inputFingerprint({
      editorDocument: journal.editorDocument,
      sourceRelations: journal.sourceRelations,
      annotations: journal.annotations
    }) !== inputFingerprint(attemptedInputs)) {
      try {
        const latestAttempt = await api.applyProjectCurrentScriptTransaction(journal)
        if (lifecycleToken !== loadTokenRef.current) return
        if (latestAttempt.status === 'applied') {
          window.localStorage.removeItem(recoveryJournalKey(projectId))
          hydrate(latestAttempt.snapshot)
          return
        }
      } catch {
        // Keep the newer local journal. The visible conflict remains resolvable and reload will retry it.
      }
    }
    const persistedRecovery = await api?.listCurrentScriptRecoveryCandidates(projectId).catch(() => []) ?? []
    if (lifecycleToken !== loadTokenRef.current) return
    // Keep the authoritative head current without replacing the local editor attempt.
    // The recovery dialog can then preview exactly the server revision that rejected the write.
    setCurrentSnapshot(result.actual)
    setCurrentConflict(result)
    const nextRecovery = persistedRecovery.some((candidate) => candidate.id === result.conflictId)
      ? persistedRecovery
      : [...persistedRecovery, recoveryCandidateFromConflict(projectId, result)]
    recoveryCandidatesRef.current = nextRecovery
    setRecoveryCandidates(nextRecovery)
    setSaveState('conflict')
    setError(result.message)
    const remainingJournal = readRecoveryJournal(projectId)
    if (remainingJournal && persistedRecovery.some((candidate) => inputFingerprint({
      editorDocument: candidate.editorDocument,
      sourceRelations: candidate.sourceRelations,
      annotations: candidate.annotations
    }) === inputFingerprint({
      editorDocument: remainingJournal.editorDocument,
      sourceRelations: remainingJournal.sourceRelations,
      annotations: remainingJournal.annotations
    }))) window.localStorage.removeItem(recoveryJournalKey(projectId))
  }, [hydrate, projectId])

  const recoverJournal = useCallback(async (
    server: ProjectCurrentScriptSnapshot,
    lifecycleToken: number
  ): Promise<boolean> => {
    const api = window.creatorOS
    const journal = readRecoveryJournal(projectId)
    if (!api) return false
    if (!journal) {
      if (!hasRecoveryJournal(projectId)) return false
      if (lifecycleToken !== loadTokenRef.current) return true
      hydrate(server)
      const detail = '本地恢复稿数据不完整或格式已损坏'
      setLocalJournalError(detail)
      setError(`${detail}。这份本地恢复稿仍然保留，你可以重试或明确放弃后载入服务端文案。`)
      setLifecyclePhase('error')
      return true
    }
    const journalInputs = {
      editorDocument: journal.editorDocument,
      sourceRelations: journal.sourceRelations,
      annotations: journal.annotations
    }
    if (inputFingerprint(journalInputs) === inputFingerprint(currentScriptSnapshotInputs(server))) {
      window.localStorage.removeItem(recoveryJournalKey(projectId))
      return false
    }
    let result
    try {
      result = await api.applyProjectCurrentScriptTransaction(journal)
    } catch (reason) {
      if (lifecycleToken !== loadTokenRef.current) return true
      hydrate(server)
      const detail = messageOf(reason, '本地恢复稿格式无法读取')
      setLocalJournalError(detail)
      setError(`本地恢复稿未删除，但其中有当前不支持的格式：${detail}`)
      setLifecyclePhase('error')
      return true
    }
    if (lifecycleToken !== loadTokenRef.current) return true
    if (result.status === 'applied') {
      const latest = await api.loadProjectCurrentScript(projectId)
      if (lifecycleToken !== loadTokenRef.current) return true
      if (latest.status !== 'ready') throw new Error('当前文案状态已经变化，请重新载入')
      const replayIsCurrent = result.snapshot.document.workingDocumentId === latest.snapshot.document.workingDocumentId
        && result.snapshot.document.revision === latest.snapshot.document.revision
        && result.snapshot.document.contentHash === latest.snapshot.document.contentHash
      if (replayIsCurrent) {
        window.localStorage.removeItem(recoveryJournalKey(projectId))
        hydrate(latest.snapshot)
        return true
      }
      const recoveryMutation: CurrentScriptRecoveryJournal = {
        ...journal,
        workingDocumentId: result.snapshot.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(),
        expectedRevision: result.snapshot.document.revision,
        expectedContentHash: result.snapshot.document.contentHash
      }
      window.localStorage.setItem(recoveryJournalKey(projectId), JSON.stringify(recoveryMutation))
      const divergence = await api.applyProjectCurrentScriptTransaction(recoveryMutation)
      if (lifecycleToken !== loadTokenRef.current) return true
      if (divergence.status === 'applied') {
        window.localStorage.removeItem(recoveryJournalKey(projectId))
        hydrate(divergence.snapshot)
        return true
      }
      hydrate(divergence.actual)
      hydrationRef.current = true
      try {
        if (editor) setAuthoritativeCurrentScriptEditorContent(editor, journal.editorDocument)
        editGenerationRef.current = 1
        savedGenerationRef.current = 0
      } finally {
        hydrationRef.current = false
      }
      await ingestConflict(divergence, lifecycleToken)
      return true
    }
    window.localStorage.removeItem(recoveryJournalKey(projectId))
    hydrate(result.actual)
    hydrationRef.current = true
    try {
      if (editor) setAuthoritativeCurrentScriptEditorContent(editor, journal.editorDocument)
      editGenerationRef.current = 1
      savedGenerationRef.current = 0
    } finally {
      hydrationRef.current = false
    }
    await ingestConflict(result, lifecycleToken)
    return true
  }, [editor, hydrate, ingestConflict, projectId])

  const initializePrepared = useCallback(async (
    candidateId: string | null,
    editorDocument: Record<string, unknown>,
    confirmed: boolean,
    lifecycleToken: number
  ): Promise<void> => {
    if (!window.creatorOS) throw new Error('当前文案服务尚未就绪')
    if (lifecycleToken !== loadTokenRef.current) return
    const candidate = candidateId ? candidatesRef.current.find((item) => item.versionId === candidateId) ?? null : null
    const facts = factsFor(editorDocument, null)
    try {
      const result = await window.creatorOS.initializeProjectCurrentScript({
        projectId,
        clientMutationId: crypto.randomUUID(),
        sourceVersionId: candidate?.versionId ?? null,
        expectedSourceContentHash: candidate?.sourceContentHash ?? null,
        editorDocument,
        sourceRelations: facts.sourceRelations,
        annotations: facts.annotations,
        ...(confirmed ? {
          confirmedLegacyAnnotationIds: facts.annotations.map((annotation) => annotation.id),
          confirmedLegacyRelationIds: facts.sourceRelations.map((relation) => relation.id)
        } : {})
      })
      if (lifecycleToken !== loadTokenRef.current) return
      if (result.status !== 'ready') throw new Error('当前文案初始化没有完成')
      setPendingInitialization(null)
      hydrate(result.snapshot)
    } catch (reason) {
      if (lifecycleToken !== loadTokenRef.current) return
      const message = messageOf(reason, '当前文案初始化失败')
      if (!confirmed && message.includes('必须人工确认迁移位置')) {
        setPendingInitialization({ candidateId, editorDocument, ...facts, message })
        setLifecyclePhase('confirmation_required')
        setError(message)
        return
      }
      setLifecyclePhase('error')
      setError(message)
      throw reason
    }
  }, [factsFor, hydrate, projectId])

  const initializeFromCandidate = useCallback(async (candidateId: string | null): Promise<void> => {
    if (!editor) return
    const lifecycleToken = loadTokenRef.current
    const candidate = candidateId ? candidatesRef.current.find((item) => item.versionId === candidateId) : null
    if (candidateId && !candidate) throw new Error('选择的文案版本已变化，请重新载入')
    setError('')
    setLifecyclePhase('loading')
    hydrationRef.current = true
    try {
      if (lifecycleToken !== loadTokenRef.current) return
      setAuthoritativeCurrentScriptEditorContent(editor, sourceContentToRichTextHtml(candidate?.sourceContent ?? ''))
      await initializePrepared(candidateId, editor.getJSON(), false, lifecycleToken)
    } catch (reason) {
      if (lifecycleToken !== loadTokenRef.current) return
      if (phaseRef.current !== 'confirmation_required') {
        setLifecyclePhase('error')
        setError(messageOf(reason, '当前文案初始化失败'))
      }
    } finally {
      hydrationRef.current = false
    }
  }, [editor, initializePrepared])

  const confirmInitialization = useCallback(async (): Promise<void> => {
    if (!pendingInitialization) return
    const lifecycleToken = loadTokenRef.current
    setLifecyclePhase('loading')
    await initializePrepared(pendingInitialization.candidateId, pendingInitialization.editorDocument, true, lifecycleToken)
  }, [initializePrepared, pendingInitialization])

  const load = useCallback(async (): Promise<void> => {
    if (!enabled || !editor) {
      setLifecyclePhase('disabled')
      return
    }
    if (!window.creatorOS) {
      setLifecyclePhase('error')
      setError('当前文案服务需要在App中使用')
      return
    }
    const token = ++loadTokenRef.current
    setLifecyclePhase('loading')
    setError('')
    setLocalJournalError('')
    setCandidates([])
    setPendingInitialization(null)
    try {
      const [result, recovery] = await Promise.all([
        window.creatorOS.loadProjectCurrentScript(projectId),
        window.creatorOS.listCurrentScriptRecoveryCandidates(projectId)
      ])
      if (token !== loadTokenRef.current) return
      recoveryCandidatesRef.current = recovery
      setRecoveryCandidates(recovery)
      if (result.status === 'ready') {
        if (await recoverJournal(result.snapshot, token)) return
        hydrate(result.snapshot)
        return
      }
      candidatesRef.current = result.candidates
      setCandidates(result.candidates)
      const automaticCandidateId = result.requiresSelection ? null : result.recommendedVersionId
      if (result.requiresSelection) {
        setLifecyclePhase('selection_required')
        return
      }
      await initializeFromCandidate(automaticCandidateId)
    } catch (reason) {
      if (token !== loadTokenRef.current || phaseRef.current === 'confirmation_required') return
      setLifecyclePhase('error')
      setError(messageOf(reason, '当前文案载入失败'))
    }
  }, [editor, enabled, hydrate, initializeFromCandidate, projectId, recoverJournal])

  const discardLocalJournal = useCallback(async (): Promise<void> => {
    window.localStorage.removeItem(recoveryJournalKey(projectId))
    setLocalJournalError('')
    await load()
  }, [load, projectId])

  const prepareMutation = useCallback(() => {
    const current = snapshotRef.current
    if (!editor || !current || current.document.projectId !== projectId) return null
    identityRef.current = true
    try { ensureCurrentScriptEditorIdentity(editor) } finally { identityRef.current = false }
    const editorDocument = editor.getJSON()
    const facts = factsFor(editorDocument, current)
    const currentInputs = {
      editorDocument,
      sourceRelations: facts.sourceRelations,
      annotations: facts.annotations
    }
    const journal = readRecoveryJournal(projectId)
    const reusableJournal = journal
      && journal.workingDocumentId === current.document.workingDocumentId
      && journal.expectedRevision === current.document.revision
      && journal.expectedContentHash === current.document.contentHash
      && inputFingerprint(currentInputs) === inputFingerprint({
        editorDocument: journal.editorDocument,
        sourceRelations: journal.sourceRelations,
        annotations: journal.annotations
      })
    return {
      projectId,
      workingDocumentId: current.document.workingDocumentId,
      clientMutationId: reusableJournal ? journal.clientMutationId : crypto.randomUUID(),
      expectedRevision: current.document.revision,
      expectedContentHash: current.document.contentHash,
      ...currentInputs
    }
  }, [editor, factsFor, projectId])

  const flush = useCallback(async (): Promise<ProjectCurrentScriptSnapshot | null> => {
    const api = window.creatorOS
    const invocationToken = loadTokenRef.current
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    if (snapshotRef.current?.document.projectId !== projectId) return null
    if (!enabled || !api) return snapshotRef.current
    if (phaseRef.current !== 'ready' || conflictRef.current || recoveryCandidatesRef.current.length) return null
    if (versionWritePromiseRef.current) {
      await versionWritePromiseRef.current
      if (invocationToken !== loadTokenRef.current || snapshotRef.current?.document.projectId !== projectId) return null
      if (editGenerationRef.current !== savedGenerationRef.current && !conflictRef.current) return flush()
      return snapshotRef.current
    }
    if (flushPromiseRef.current) {
      await flushPromiseRef.current
      if (invocationToken !== loadTokenRef.current || snapshotRef.current?.document.projectId !== projectId) return null
      if (editGenerationRef.current !== savedGenerationRef.current && !conflictRef.current) return flush()
      return snapshotRef.current
    }
    const run = async (): Promise<ProjectCurrentScriptSnapshot | null> => {
      const mutation = prepareMutation()
      const current = snapshotRef.current
      if (!mutation || !current) return null
      const currentInputs = currentScriptSnapshotInputs(current)
      if (inputFingerprint({
        editorDocument: mutation.editorDocument,
        sourceRelations: mutation.sourceRelations,
        annotations: mutation.annotations
      }) === inputFingerprint(currentInputs)) {
        const journal = readRecoveryJournal(projectId)
        if (journal && inputFingerprint({
          editorDocument: journal.editorDocument,
          sourceRelations: journal.sourceRelations,
          annotations: journal.annotations
        }) === inputFingerprint(currentInputs)) window.localStorage.removeItem(recoveryJournalKey(projectId))
        savedGenerationRef.current = editGenerationRef.current
        setSaveState('saved')
        return current
      }
      const generation = editGenerationRef.current
      const lifecycleToken = loadTokenRef.current
      setSaveState('saving')
      try {
        const result = await api.applyProjectCurrentScriptTransaction(mutation)
        if (lifecycleToken !== loadTokenRef.current) return result.status === 'applied' ? result.snapshot : null
        if (result.status === 'conflict') {
          await ingestConflict(result, lifecycleToken)
          return null
        }
        setCurrentSnapshot(result.snapshot)
        const journal = readRecoveryJournal(projectId)
        if (journal && inputFingerprint({
          editorDocument: journal.editorDocument,
          sourceRelations: journal.sourceRelations,
          annotations: journal.annotations
        }) === inputFingerprint({
          editorDocument: mutation.editorDocument,
          sourceRelations: mutation.sourceRelations,
          annotations: mutation.annotations
        })) window.localStorage.removeItem(recoveryJournalKey(projectId))
        if (editGenerationRef.current === generation) savedGenerationRef.current = generation
        setSaveState(editGenerationRef.current === savedGenerationRef.current ? 'saved' : 'unsaved')
        setError('')
        return result.snapshot
      } catch (reason) {
        if (lifecycleToken !== loadTokenRef.current) return null
        setSaveState('error')
        setError(messageOf(reason, '当前文案自动保存失败'))
        return null
      }
    }
    const promise = run()
    flushPromiseRef.current = promise
    try {
      return await promise
    } finally {
      if (flushPromiseRef.current === promise) flushPromiseRef.current = null
    }
  }, [enabled, ingestConflict, prepareMutation, projectId])

  const saveVersion = useCallback((kind: 'merged_draft' | 'user_edit', displayName?: string, finalize = false): Promise<DraftVersion | null> => {
    const api = window.creatorOS
    if (!api) return Promise.resolve(null)
    const lifecycleTokenAtStart = loadTokenRef.current
    const requestKey = JSON.stringify({ kind, displayName: displayName?.trim() || null, finalize })
    const existingRequest = versionSaveRequestRef.current
    if (existingRequest?.lifecycleToken === lifecycleTokenAtStart) {
      return existingRequest.requestKey === requestKey ? existingRequest.promise : Promise.resolve(null)
    }
    const execute = async (): Promise<DraftVersion | null> => {
      let flushed = await flush()
      if (lifecycleTokenAtStart !== loadTokenRef.current) return null
      if (editGenerationRef.current !== savedGenerationRef.current && !conflictRef.current) flushed = await flush()
      if (lifecycleTokenAtStart !== loadTokenRef.current || !flushed || flushed.document.projectId !== projectId || conflictRef.current || recoveryCandidatesRef.current.length) return null
      const generation = savedGenerationRef.current
      const inputs = currentScriptSnapshotInputs(flushed)
      const persist = async (): Promise<DraftVersion | null> => {
        setSaveState('saving')
        try {
          const result = await api.saveProjectCurrentScriptVersion({
            projectId,
            workingDocumentId: flushed.document.workingDocumentId,
            clientMutationId: crypto.randomUUID(),
            expectedRevision: flushed.document.revision,
            expectedContentHash: flushed.document.contentHash,
            ...inputs,
            kind,
            finalize,
            ...(displayName?.trim() ? { displayName: displayName.trim() } : {})
          })
          if (lifecycleTokenAtStart !== loadTokenRef.current) return result.status === 'saved' ? result.version : null
          if (result.status === 'conflict') {
            await ingestConflict(result, lifecycleTokenAtStart)
            return null
          }
          setCurrentSnapshot(result.snapshot)
          setSaveState(editGenerationRef.current === generation ? 'saved' : 'unsaved')
          setError('')
          return result.version
        } catch (reason) {
          if (lifecycleTokenAtStart !== loadTokenRef.current) return null
          setSaveState('error')
          setError(messageOf(reason, '当前文案版本保存失败'))
          throw reason
        }
      }
      const persistPromise = persist()
      versionWritePromiseRef.current = persistPromise
      try {
        return await persistPromise
      } finally {
        if (versionWritePromiseRef.current === persistPromise) versionWritePromiseRef.current = null
        if (lifecycleTokenAtStart === loadTokenRef.current && editGenerationRef.current !== savedGenerationRef.current && !conflictRef.current) void flush()
      }
    }
    const promise = execute()
    const entry = { lifecycleToken: lifecycleTokenAtStart, requestKey, promise }
    versionSaveRequestRef.current = entry
    void promise.then(
      () => { if (versionSaveRequestRef.current === entry) versionSaveRequestRef.current = null },
      () => { if (versionSaveRequestRef.current === entry) versionSaveRequestRef.current = null }
    )
    return promise
  }, [flush, ingestConflict, projectId])

  const resolveRecovery = useCallback(async (
    conflictId: string,
    resolution: 'keep_server' | 'replace_with_attempt' | 'save_attempt_as_version'
  ): Promise<string> => {
    if (!window.creatorOS) throw new Error('当前文案服务尚未就绪')
    const lifecycleToken = loadTokenRef.current
    const candidate = recoveryCandidatesRef.current.find((item) => item.id === conflictId)
    if (!candidate) throw new Error('这份未保存内容已处理')
    if (resolution === 'keep_server') {
      await window.creatorOS.resolveCurrentScriptRecovery({
        projectId, conflictId, resolutionKind: 'kept_server', resolvedRevisionSnapshotId: null
      })
      const latest = await window.creatorOS.loadProjectCurrentScript(projectId)
      if (lifecycleToken !== loadTokenRef.current) return '已在原项目保留服务端当前文案'
      if (latest.status !== 'ready') throw new Error('当前文案状态已变化，请重新打开')
      hydrate(latest.snapshot)
      recoveryCandidatesRef.current = recoveryCandidatesRef.current.filter((item) => item.id !== conflictId)
      setRecoveryCandidates(recoveryCandidatesRef.current)
      if (await recoverJournal(latest.snapshot, lifecycleToken)) return '已放弃这份本地副本；还有一份更新的本地内容待处理'
      return '已保留服务端当前文案，未保存副本已标记为已处理'
    }
    if (resolution === 'save_attempt_as_version') {
      const resolved = await window.creatorOS.resolveCurrentScriptRecovery({
        projectId,
        conflictId,
        resolutionKind: 'saved_attempt_as_version',
        resolvedRevisionSnapshotId: null,
        versionKind: 'user_edit',
        displayName: '冲突副本'
      })
      const latest = await window.creatorOS.loadProjectCurrentScript(projectId)
      if (lifecycleToken !== loadTokenRef.current) return resolved.savedVersionId ? '未保存内容已在原项目另存' : '原项目恢复已处理'
      if (latest.status !== 'ready') throw new Error('当前文案状态已变化，请重新打开')
      hydrate(latest.snapshot)
      recoveryCandidatesRef.current = recoveryCandidatesRef.current.filter((item) => item.id !== conflictId)
      setRecoveryCandidates(recoveryCandidatesRef.current)
      if (await recoverJournal(latest.snapshot, lifecycleToken)) return '这份未保存内容已另存；还有一份更新的本地内容待处理'
      return resolved.savedVersionId ? '未保存内容已另存为“冲突副本”，当前文案保持不变' : '未保存内容已另存'
    }

    const previewedServer = snapshotRef.current
    const latestBeforeReplace = await window.creatorOS.loadProjectCurrentScript(projectId)
    if (lifecycleToken !== loadTokenRef.current) return '已取消原项目的替换操作'
    if (latestBeforeReplace.status !== 'ready') throw new Error('当前文案状态已变化，请重新打开')
    if (!previewedServer
      || previewedServer.document.revision !== latestBeforeReplace.snapshot.document.revision
      || previewedServer.document.contentHash !== latestBeforeReplace.snapshot.document.contentHash) {
      hydrate(latestBeforeReplace.snapshot)
      throw new Error('服务端刚刚又有修改，上方已换成最新内容。请核对后再选择是否替换。')
    }
    try {
      await window.creatorOS.resolveCurrentScriptRecovery({
        projectId,
        conflictId,
        resolutionKind: 'replaced_with_attempt',
        resolvedRevisionSnapshotId: null,
        expectedHeadWorkingDocumentId: latestBeforeReplace.snapshot.document.workingDocumentId,
        expectedHeadRevision: latestBeforeReplace.snapshot.document.revision,
        expectedHeadContentHash: latestBeforeReplace.snapshot.document.contentHash
      })
    } catch (reason) {
      if (!messageOf(reason, '').includes('CURRENT_SCRIPT_RECOVERY_HEAD_CHANGED')) throw reason
      const newest = await window.creatorOS.loadProjectCurrentScript(projectId)
      if (lifecycleToken === loadTokenRef.current && newest.status === 'ready') hydrate(newest.snapshot)
      throw new Error('服务端刚刚又有修改，上方已换成最新内容。请核对后再选择是否替换。')
    }
    const latest = await window.creatorOS.loadProjectCurrentScript(projectId)
    if (lifecycleToken !== loadTokenRef.current) return '已在原项目应用未保存副本'
    if (latest.status !== 'ready') throw new Error('当前文案状态已变化，请重新打开')
    hydrate(latest.snapshot)
    recoveryCandidatesRef.current = recoveryCandidatesRef.current.filter((item) => item.id !== conflictId)
    setRecoveryCandidates(recoveryCandidatesRef.current)
    if (await recoverJournal(latest.snapshot, lifecycleToken)) return '已用这份副本替换；还有一份更新的本地内容待处理'
    return '已用未保存副本替换当前文案'
  }, [hydrate, projectId, recoverJournal])

  const applySnapshot = useCallback(async (restored: ProjectCurrentScriptSnapshot): Promise<boolean> => {
    const api = window.creatorOS
    if (!api || !editor || phaseRef.current !== 'ready' || conflictRef.current || recoveryCandidatesRef.current.length) return false
    await flush()
    const current = snapshotRef.current
    const lifecycleToken = loadTokenRef.current
    if (!current || current.document.projectId !== projectId) return false
    const editorDocument = projectCurrentScriptFactsToEditorDocument(restored)
    hydrationRef.current = true
    try {
      setAuthoritativeCurrentScriptEditorContent(editor, editorDocument)
    } finally {
      hydrationRef.current = false
    }
    const result = await api.applyProjectCurrentScriptTransaction({
      projectId,
      workingDocumentId: current.document.workingDocumentId,
      clientMutationId: crypto.randomUUID(),
      expectedRevision: current.document.revision,
      expectedContentHash: current.document.contentHash,
      editorDocument,
      sourceRelations: currentScriptSnapshotInputs(restored).sourceRelations,
      annotations: currentScriptSnapshotInputs(restored).annotations
    })
    if (lifecycleToken !== loadTokenRef.current) return false
    if (result.status === 'conflict') {
      await ingestConflict(result, lifecycleToken)
      return false
    }
    hydrate(result.snapshot)
    return true
  }, [editor, flush, hydrate, ingestConflict, projectId])

  const restoreVersion = useCallback(async (input: {
    snapshot?: ProjectCurrentScriptSnapshot
    content?: string
    sourceVersionId: string | null
    displayName?: string
  }): Promise<{ version: DraftVersion; materialWorkspace: ScriptMaterialWorkspace | null } | null> => {
    const api = window.creatorOS
    if (!api || !editor || phaseRef.current !== 'ready' || conflictRef.current || recoveryCandidatesRef.current.length) return null
    const current = await flush()
    const lifecycleToken = loadTokenRef.current
    if (!current || lifecycleToken !== loadTokenRef.current || conflictRef.current || recoveryCandidatesRef.current.length) return null
    const historicalMaterialSnapshot = input.sourceVersionId && !input.snapshot
      ? await api.getScriptMaterialVersionSnapshot(projectId, input.sourceVersionId)
      : null
    if (lifecycleToken !== loadTokenRef.current) return null
    let editorDocument: Record<string, unknown>
    let facts: ReturnType<typeof buildCurrentScriptFacts>
    hydrationRef.current = true
    try {
      if (input.snapshot) {
        editorDocument = projectCurrentScriptFactsToEditorDocument(input.snapshot)
        setAuthoritativeCurrentScriptEditorContent(editor, editorDocument)
        facts = {
          sourceRelations: currentScriptSnapshotInputs(input.snapshot).sourceRelations,
          annotations: currentScriptSnapshotInputs(input.snapshot).annotations
        }
      } else {
        setAuthoritativeCurrentScriptEditorContent(editor, sourceContentToRichTextHtml(input.content ?? ''))
        ensureCurrentScriptEditorIdentity(editor)
        editorDocument = editor.getJSON()
        facts = buildCurrentScriptFacts(editorDocument, {
          previous: null,
          materialRevisionId: input.sourceVersionId
            ? historicalMaterialSnapshot?.sourceRevisionId ?? null
            : materialRevisionIdRef.current,
          createId: () => crypto.randomUUID(),
          generatedIds: generatedIdsRef.current
        })
      }
    } finally {
      hydrationRef.current = false
    }
    setSaveState('saving')
    try {
      const result = await api.restoreProjectCurrentScriptVersion({
        projectId,
        workingDocumentId: current.document.workingDocumentId,
        clientMutationId: crypto.randomUUID(),
        expectedRevision: current.document.revision,
        expectedContentHash: current.document.contentHash,
        editorDocument,
        sourceRelations: facts.sourceRelations,
        annotations: facts.annotations,
        sourceVersionId: input.sourceVersionId,
        ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {})
      })
      if (lifecycleToken !== loadTokenRef.current) return null
      if (result.status === 'conflict') {
        await ingestConflict(result, lifecycleToken)
        return null
      }
      hydrate(result.snapshot)
      return { version: result.version, materialWorkspace: result.materialWorkspace }
    } catch (reason) {
      if (lifecycleToken === loadTokenRef.current) {
        hydrate(current)
        setSaveState('error')
        setError(messageOf(reason, '历史文案恢复失败'))
      }
      throw reason
    }
  }, [editor, flush, hydrate, ingestConflict, projectId])

  useEffect(() => {
    loadTokenRef.current += 1
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
    setCurrentSnapshot(null)
    setCurrentConflict(null)
    recoveryCandidatesRef.current = []
    setRecoveryCandidates([])
    setPendingInitialization(null)
    candidatesRef.current = []
    setCandidates([])
    setSaveState('saved')
    setError('')
    setLocalJournalError('')
    generatedIdsRef.current.clear()
    if (!enabled) {
      setLifecyclePhase('disabled')
      return
    }
    void load()
    return () => {
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
      if (editGenerationRef.current !== savedGenerationRef.current && phaseRef.current === 'ready' && !conflictRef.current) void flush()
      loadTokenRef.current += 1
    }
  }, [enabled, editor, flush, load, projectId])

  useEffect(() => {
    if (!editor || !enabled) return
    const onUpdate = ({ transaction }: { transaction: Transaction }): void => {
      if (hydrationRef.current || identityRef.current || phaseRef.current !== 'ready' || conflictRef.current) return
      identityRef.current = true
      try { ensureCurrentScriptEditorIdentity(editor, transaction.before) } finally { identityRef.current = false }
      editGenerationRef.current += 1
      setSaveState('unsaved')
      setError('')
      const journal = prepareMutation()
      if (journal) {
        try {
          window.localStorage.setItem(recoveryJournalKey(projectId), JSON.stringify({
            projectId: journal.projectId,
            workingDocumentId: journal.workingDocumentId,
            clientMutationId: journal.clientMutationId,
            expectedRevision: journal.expectedRevision,
            expectedContentHash: journal.expectedContentHash,
            editorDocument: journal.editorDocument,
            sourceRelations: journal.sourceRelations,
            annotations: journal.annotations
          } satisfies CurrentScriptRecoveryJournal))
        } catch {
          setError('本地恢复副本保存失败；请立即手动保存版本')
          setSaveState('error')
        }
      }
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = window.setTimeout(() => {
        autosaveTimerRef.current = null
        void flush()
      }, 650)
    }
    editor.on('update', onUpdate)
    return () => { editor.off('update', onUpdate) }
  }, [editor, enabled, flush, prepareMutation, projectId])

  return {
    phase,
    saveState,
    error,
    localJournalError,
    authoritativeEpoch,
    snapshot,
    candidates,
    pendingInitialization,
    conflict,
    recoveryCandidates,
    initializeFromCandidate,
    confirmInitialization,
    flush,
    saveVersion,
    applySnapshot,
    restoreVersion,
    resolveRecovery,
    discardLocalJournal,
    reload: load
  }
}
