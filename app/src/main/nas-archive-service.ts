import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import {
  ARCHIVE_SLOTS,
  type ArchiveCategory,
  type ArchivePlan,
  type ArchivePlanItem,
  type ArchiveRun,
  type ArchiveRunItem,
  type ArchiveRunStatus,
  type ArchiveSelectionStatus,
  type ArchiveSlot,
  type FileReferenceInput,
  type NasBackupStatus
} from '../shared/domain'
import { localDateForInstant } from '../shared/domain/coarse-time'
import type { WorkspaceStore } from './db'
import { validateWorkspaceBackupDirectory, validateWorkspaceBackupMarker } from './db/backup'
import { buildScriptDocx } from './docx-export'
import { resolveManagedFilePath } from './managed-files'
import type { NasArchiveConfigService } from './nas-archive-config-service'

interface SourceCandidate {
  slot: ArchiveSlot
  ordinal: number
  status: ArchiveSelectionStatus
  displayName: string
  file: FileReferenceInput | null
  version: { id: string; content: string } | null
}

interface PreparedPlan {
  publicPlan: ArchivePlan
  sources: SourceCandidate[]
}

interface ArchiveRunRow {
  id: string
  project_id: string
  task_run_id: string
  destination_revision: string
  category: ArchiveCategory
  category_label: string
  year: number
  sequence: number
  folder_name: string
  relative_directory: string
  commercial_snapshot: number
  status: ArchiveRunStatus
  plan_hash: string
  confirmed_at: string
  manifest_sha256: string | null
  manifest_relative_path: string | null
  missing_count: number
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface ArchiveItemRow {
  id: string
  run_id: string
  slot: ArchiveSlot
  ordinal: number
  selection_status: ArchiveSelectionStatus
  source_file_id: string | null
  source_version_id: string | null
  source_name: string
  source_locator: string | null
  source_origin: string | null
  size_bytes: number | null
  source_sha256: string | null
  target_sha256: string | null
  temporary_relative_path: string | null
  final_relative_path: string | null
  status: ArchiveRunItem['status']
  error_code: string | null
  temporary_removed: number | null
  created_at: string
  updated_at: string
}

interface InternalArchiveItem {
  row: ArchiveItemRow
  source: SourceCandidate
}

const PLAN_TTL_MS = 15 * 60_000
const SLOT_ORDER = new Map(ARCHIVE_SLOTS.map((slot, index) => [slot, index]))

function archiveYearDirectory(year: number): string {
  return `@${String(year).slice(-2)}年`
}

function safeSourceLocator(file: FileReferenceInput): string {
  const locator = file.managedLocator ?? file.relativePath
  return isAbsolute(locator) ? `external-reference:${file.id}` : locator.replaceAll('\\', '/')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function safeName(value: string, fallback: string): string {
  const normalized = value.normalize('NFKC').replace(/[\0/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  return (normalized || fallback).slice(0, 120)
}

function fileNameForSlot(slot: ArchiveSlot, sourceName: string, ordinal: number): string {
  const extension = extname(sourceName).toLowerCase()
  const base: Record<ArchiveSlot, string> = {
    landscape_cover: '横屏封面',
    portrait_cover: '竖屏封面',
    business_files: safeName(sourceName.replace(extension, ''), `商务文件${ordinal + 1}`),
    subtitle_srt: '字幕',
    video_clean: '成片无字幕',
    video_burned_in: '成片有字幕',
    final_script_docx: '最终文案'
  }
  return `${base[slot]}${extension || (slot === 'final_script_docx' ? '.docx' : '')}`
}

function publicItem(row: ArchiveItemRow): ArchiveRunItem {
  return {
    id: row.id,
    slot: row.slot,
    ordinal: row.ordinal,
    selectionStatus: row.selection_status,
    sourceFileId: row.source_file_id,
    sourceVersionId: row.source_version_id,
    sourceName: row.source_name,
    sizeBytes: row.size_bytes,
    sourceSha256: row.source_sha256,
    targetSha256: row.target_sha256,
    finalName: row.final_relative_path ? basename(row.final_relative_path) : null,
    status: row.status,
    errorCode: row.error_code,
    temporaryRemoved: row.temporary_removed === null ? null : Boolean(row.temporary_removed),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class NasArchiveService {
  private readonly plans = new Map<string, PreparedPlan>()
  private readonly confirmingProjects = new Set<string>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly executions = new Map<string, Promise<void>>()
  private backupPromise: Promise<NasBackupStatus> | null = null
  private backupTimer: NodeJS.Timeout | null = null
  private backupController: AbortController | null = null
  private backupDetached = false

  constructor(
    private readonly store: WorkspaceStore,
    private readonly configs: NasArchiveConfigService,
    private readonly notifyChanged: () => void
  ) {}

  private get database(): BetterSqlite3.Database {
    return this.store.repository.native
  }

  private file(fileId: string): FileReferenceInput {
    return this.store.repository.getFileReference(fileId)
  }

  private sourceCandidates(projectId: string): SourceCandidate[] {
    const project = this.store.repository.getProject(projectId, false)
    const overrides = new Map((this.database.prepare('SELECT slot,selection_status,file_id FROM project_archive_slots WHERE project_id=?').all(projectId) as Array<{ slot: ArchiveSlot; selection_status: ArchiveSelectionStatus; file_id: string | null }>).map((row) => [row.slot, row]))
    const sources: SourceCandidate[] = []
    const append = (candidate: SourceCandidate): void => { sources.push(candidate) }
    const automaticFiles = new Map<ArchiveSlot, FileReferenceInput[]>()

    for (const cover of project.coverCandidates.filter((candidate) => candidate.isSelected)) {
      const slot = cover.layout === 'bilibili_landscape' ? 'landscape_cover' : 'portrait_cover'
      automaticFiles.set(slot, [...automaticFiles.get(slot) ?? [], this.file(cover.fileId)])
    }
    const subtitleJob = project.subtitleJobs.find((job) => job.confirmedZhArtifactId)
    const subtitleArtifact = subtitleJob?.artifacts.find((artifact) => artifact.id === subtitleJob.confirmedZhArtifactId && artifact.artifactKind === 'zh_srt')
    if (subtitleArtifact) automaticFiles.set('subtitle_srt', [this.file(subtitleArtifact.fileId)])
    const businessRows = this.database.prepare('SELECT file_id FROM business_files WHERE project_id=? ORDER BY created_at,id').all(projectId) as Array<{ file_id: string }>
    if (businessRows.length) automaticFiles.set('business_files', businessRows.map((row) => this.file(row.file_id)))
    const finalVersion = project.versions.find((version) => version.documentType === 'script' && version.isFinal) ?? null

    for (const slot of ARCHIVE_SLOTS) {
      const override = overrides.get(slot)
      if (override && override.selection_status !== 'selected') {
        append({ slot, ordinal: 0, status: override.selection_status, displayName: override.selection_status === 'not_required' ? '不需要' : '尚未准备', file: null, version: null })
        continue
      }
      if (slot === 'final_script_docx') {
        if (finalVersion) append({ slot, ordinal: 0, status: 'selected', displayName: '最终文案.docx', file: null, version: { id: finalVersion.id, content: finalVersion.content } })
        else append({ slot, ordinal: 0, status: 'not_ready', displayName: '尚未定稿', file: null, version: null })
        continue
      }
      const selected = override?.file_id ? [this.file(override.file_id)] : automaticFiles.get(slot) ?? []
      if (!override?.file_id && (slot === 'landscape_cover' || slot === 'portrait_cover') && selected.length > 1) {
        append({ slot, ordinal: 0, status: 'not_ready', displayName: `有${selected.length}张已选封面，请明确选择最终文件`, file: null, version: null })
        continue
      }
      if (!selected.length) {
        append({ slot, ordinal: 0, status: 'not_ready', displayName: '尚未准备', file: null, version: null })
        continue
      }
      selected.forEach((file, ordinal) => append({ slot, ordinal, status: 'selected', displayName: file.originalName, file, version: null }))
    }
    return sources.sort((a, b) => (SLOT_ORDER.get(a.slot)! - SLOT_ORDER.get(b.slot)!) || a.ordinal - b.ordinal)
  }

  private identity(projectId: string): { category: ArchiveCategory; year: number; sequence: number; category_label: string; relative_directory: string; commercial_snapshot: number; title_snapshot: string } | null {
    return (this.database.prepare('SELECT category,year,sequence,category_label,relative_directory,commercial_snapshot,title_snapshot FROM project_archive_identities WHERE project_id=?').get(projectId) as {
      category: ArchiveCategory; year: number; sequence: number; category_label: string; relative_directory: string; commercial_snapshot: number; title_snapshot: string
    } | undefined) ?? null
  }

  private async nextSequence(category: ArchiveCategory, categoryLabel: string, year: number): Promise<number> {
    const dbMax = (this.database.prepare('SELECT MAX(sequence) AS value FROM project_archive_identities WHERE category=? AND year=?').get(category, year) as { value: number | null }).value ?? 0
    const counter = (this.database.prepare('SELECT next_sequence FROM archive_sequences WHERE category=? AND year=?').get(category, year) as { next_sequence: number } | undefined)?.next_sequence ?? 1
    let remoteMax = 0
    const transport = await this.configs.createTransport()
    try {
      const names = await transport.listDirectories(`${safeName(categoryLabel, '视频')}/${archiveYearDirectory(year)}`)
      for (const name of names) remoteMax = Math.max(remoteMax, Number.parseInt(name.match(/^(\d+)/)?.[1] ?? '0', 10) || 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return Math.max(dbMax + 1, counter, remoteMax + 1)
  }

  private buildHash(input: Omit<ArchivePlan, 'id' | 'planHash' | 'expiresAt' | 'destination'>): string {
    return sha256Text(JSON.stringify({
      projectId: input.projectId,
      category: input.category,
      categoryLabel: input.categoryLabel,
      destinationRevision: input.destinationRevision,
      year: input.year,
      yearDirectory: input.yearDirectory,
      sequence: input.sequence,
      folderName: input.folderName,
      items: input.items.map((item) => ({
        slot: item.slot,
        ordinal: item.ordinal,
        status: item.status,
        sourceFileId: item.sourceFileId,
        sourceVersionId: item.sourceVersionId,
        sourceSha256: item.sourceSha256,
        sizeBytes: item.sizeBytes,
        displayName: item.displayName
      }))
    }))
  }

  async preparePlan(projectId: string, category: ArchiveCategory): Promise<ArchivePlan> {
    const destination = await this.configs.getStatus()
    if (!destination.configured) throw new Error('请先在设置里选择NAS归档目录')
    if (destination.availability !== 'ready') throw new Error('NAS归档目录当前不可用')
    const project = this.store.repository.getProject(projectId, false)
    const identity = this.identity(projectId)
    if (identity && identity.category !== category) throw new Error('项目首次归档后不能修改归档分类')
    const year = identity?.year ?? new Date().getFullYear()
    const categoryLabel = identity?.category_label ?? destination.categoryLabels[category]
    const sequence = identity?.sequence ?? await this.nextSequence(category, categoryLabel, year)
    const folderName = identity ? basename(identity.relative_directory) : `${sequence}${project.isCommercial ? '商' : ''}-${safeName(project.title, '未命名项目')}`
    const sources = this.sourceCandidates(projectId)
    const items: ArchivePlanItem[] = sources.map((source) => ({
      slot: source.slot,
      ordinal: source.ordinal,
      status: source.status,
      displayName: source.displayName,
      sizeBytes: source.file?.sizeBytes ?? null,
      sourceFileId: source.file?.id ?? null,
      sourceVersionId: source.version?.id ?? null,
      sourceSha256: source.file?.sha256 ?? (source.version ? sha256Text(`version:${source.version.id}:${source.version.content}`) : null)
    }))
    const selectedBytes = items.filter((item) => item.status === 'selected').reduce((total, item) => total + (item.sizeBytes ?? 0), 0)
    if (destination.freeBytes !== null && selectedBytes > destination.freeBytes) throw new Error('NAS可用空间不足，不能开始归档')
    if (!destination.revision) throw new Error('NAS归档设置缺少版本信息，请重新选择目录')
    const base = {
      projectId, category, categoryLabel, year, yearDirectory: archiveYearDirectory(year), sequence, folderName, destinationRevision: destination.revision,
      identityFrozen: Boolean(identity), items,
      missingCount: items.filter((item) => item.status === 'not_ready').length,
      notRequiredCount: items.filter((item) => item.status === 'not_required').length
    }
    const id = randomUUID()
    const publicPlan: ArchivePlan = {
      id,
      ...base,
      planHash: this.buildHash(base),
      expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
      destination
    }
    this.plans.set(id, { publicPlan, sources })
    for (const [planId, plan] of this.plans) if (Date.parse(plan.publicPlan.expiresAt) <= Date.now()) this.plans.delete(planId)
    return publicPlan
  }

  private reserveIdentityUnsafe(projectId: string, plan: ArchivePlan, project: { isCommercial: boolean; title: string }, timestamp: string): void {
    const existing = this.identity(projectId)
    const relativeDirectory = `${plan.categoryLabel}/${plan.yearDirectory}/${plan.folderName}`
    if (existing) {
      if (existing.category !== plan.category || existing.year !== plan.year || existing.sequence !== plan.sequence || existing.relative_directory !== relativeDirectory) throw new Error('项目归档身份已经变化，请重新确认')
      return
    }
    const counter = (this.database.prepare('SELECT next_sequence FROM archive_sequences WHERE category=? AND year=?').get(plan.category, plan.year) as { next_sequence: number } | undefined)?.next_sequence ?? 1
    const max = (this.database.prepare('SELECT MAX(sequence) AS value FROM project_archive_identities WHERE category=? AND year=?').get(plan.category, plan.year) as { value: number | null }).value ?? 0
    if (Math.max(counter, max + 1) > plan.sequence) throw new Error('归档编号已经被占用，请重新确认')
    this.database.prepare('INSERT INTO project_archive_identities(project_id,category,year,sequence,category_label,relative_directory,commercial_snapshot,title_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(projectId, plan.category, plan.year, plan.sequence, plan.categoryLabel, relativeDirectory, Number(project.isCommercial), project.title, timestamp)
    this.database.prepare(`INSERT INTO archive_sequences(category,year,next_sequence,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(category,year) DO UPDATE SET next_sequence=excluded.next_sequence,updated_at=excluded.updated_at`).run(plan.category, plan.year, plan.sequence + 1, timestamp)
  }

  async confirmPlan(planId: string, expectedHash: string): Promise<ArchiveRun> {
    const prepared = this.plans.get(planId)
    if (!prepared || Date.parse(prepared.publicPlan.expiresAt) <= Date.now()) throw new Error('归档预览已过期，请重新生成')
    this.plans.delete(planId)
    if (prepared.publicPlan.planHash !== expectedHash) throw new Error('归档预览校验失败')
    const projectId = prepared.publicPlan.projectId
    if (this.confirmingProjects.has(projectId)) throw new Error('该项目正在确认归档，请稍候')
    this.confirmingProjects.add(projectId)
    let refreshedId: string | null = null
    let claimedDirectory: string | null = null
    let createdClaim = false
    let identityReserved = false
    let transport: Awaited<ReturnType<NasArchiveConfigService['createTransport']>> | null = null
    try {
      const refreshed = await this.preparePlan(projectId, prepared.publicPlan.category)
      refreshedId = refreshed.id
      if (refreshed.destinationRevision !== prepared.publicPlan.destinationRevision) throw new Error('NAS归档位置或分类设置已变化，请重新确认')
      if (refreshed.planHash !== expectedHash) throw new Error('归档内容已变化，请重新确认')
      const currentDestination = await this.configs.getStatus()
      if (currentDestination.availability !== 'ready' || currentDestination.revision !== refreshed.destinationRevision) throw new Error('NAS归档位置或连接状态已变化，请重新确认')

      const project = this.store.repository.getProject(refreshed.projectId, false)
      const taskId = randomUUID()
      const runId = randomUUID()
      const timestamp = new Date().toISOString()
      const sources = this.plans.get(refreshed.id)?.sources ?? prepared.sources
      claimedDirectory = `${refreshed.categoryLabel}/${refreshed.yearDirectory}/${refreshed.folderName}`
      transport = await this.configs.createTransport()
      createdClaim = await transport.claimDirectory(claimedDirectory, refreshed.projectId)

      this.database.transaction(() => {
        this.reserveIdentityUnsafe(refreshed.projectId, refreshed, project, timestamp)
        this.database.prepare(`INSERT INTO task_runs(id,task_type,project_id,title,provider,model,status,progress,input_snapshot,project_description_snapshot,task_content_type_id,task_template_id,resource_snapshot_json,permission_profile_json,output_target,result_summary,error_code,error_message,retry_of_id,requires_confirmation,requested_at,started_at,finished_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          taskId, 'nas_archive', refreshed.projectId, `归档到NAS：${refreshed.folderName}`, 'none', null, 'running', 0,
          JSON.stringify({ version: 1, planHash: expectedHash, category: refreshed.category, year: refreshed.year, sequence: refreshed.sequence }),
          project.description, project.contentTypeId, project.appliedTemplateId, null,
          JSON.stringify({ network: 'off', readableRefs: [], writableTarget: 'archive', shell: false }), 'archive:nas',
          null, null, null, null, 0, timestamp, timestamp, null
        )
        this.database.prepare(`INSERT INTO archive_runs(id,project_id,task_run_id,destination_id,destination_revision,category,category_label,year,sequence,folder_name,relative_directory,commercial_snapshot,status,plan_hash,confirmed_at,missing_count,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          runId, refreshed.projectId, taskId, 'primary', refreshed.destinationRevision, refreshed.category, refreshed.categoryLabel,
          refreshed.year, refreshed.sequence, refreshed.folderName, claimedDirectory, Number(project.isCommercial), 'prepared',
          expectedHash, timestamp, refreshed.missingCount, timestamp, timestamp
        )
        const insert = this.database.prepare(`INSERT INTO archive_items(id,run_id,slot,ordinal,selection_status,source_file_id,source_version_id,source_name,source_locator,source_origin,size_bytes,source_sha256,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        for (const source of sources) insert.run(
          randomUUID(), runId, source.slot, source.ordinal, source.status, source.file?.id ?? null, source.version?.id ?? null,
          source.displayName,
          source.file ? safeSourceLocator(source.file) : source.version ? `draft-version:${source.version.id}` : null,
          source.file?.sourceOrigin ?? (source.version ? 'draft_version' : null),
          source.file?.sizeBytes ?? null, source.file?.sha256 ?? (source.version ? sha256Text(`version:${source.version.id}:${source.version.content}`) : null),
          source.status === 'selected' ? 'pending' : source.status === 'not_required' ? 'not_required' : 'missing', timestamp, timestamp
        )
      }).immediate()
      identityReserved = true
      const internal = new Map(sources.map((source) => [`${source.slot}:${source.ordinal}`, source]))
      this.launchExecute(runId, internal)
      return this.getRun(runId)
    } catch (error) {
      if (createdClaim && !identityReserved && transport && claimedDirectory) await transport.releaseEmptyClaim(claimedDirectory, projectId).catch(() => undefined)
      throw error
    } finally {
      if (refreshedId) this.plans.delete(refreshedId)
      this.confirmingProjects.delete(projectId)
    }
  }

  private getRunRow(runId: string): ArchiveRunRow {
    const row = this.database.prepare('SELECT * FROM archive_runs WHERE id=?').get(runId) as ArchiveRunRow | undefined
    if (!row) throw new Error('NAS归档记录不存在')
    return row
  }

  private itemRows(runId: string): ArchiveItemRow[] {
    return this.database.prepare(`SELECT * FROM archive_items WHERE run_id=? ORDER BY CASE slot WHEN 'landscape_cover' THEN 0 WHEN 'portrait_cover' THEN 1 WHEN 'business_files' THEN 2 WHEN 'subtitle_srt' THEN 3 WHEN 'video_clean' THEN 4 WHEN 'video_burned_in' THEN 5 ELSE 6 END,ordinal`).all(runId) as ArchiveItemRow[]
  }

  getRun(runId: string): ArchiveRun {
    const row = this.getRunRow(runId)
    return {
      id: row.id,
      projectId: row.project_id,
      taskRunId: row.task_run_id,
      category: row.category,
      year: row.year,
      sequence: row.sequence,
      folderName: row.folder_name,
      status: row.status,
      planHash: row.plan_hash,
      confirmedAt: row.confirmed_at,
      manifestSha256: row.manifest_sha256,
      manifestFileName: row.manifest_relative_path ? basename(row.manifest_relative_path) : null,
      missingCount: row.missing_count,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      items: this.itemRows(runId).map(publicItem)
    }
  }

  listRuns(projectId: string): ArchiveRun[] {
    return (this.database.prepare('SELECT id FROM archive_runs WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Array<{ id: string }>).map((row) => this.getRun(row.id))
  }

  getRunByTaskId(taskRunId: string): ArchiveRun {
    const row = this.database.prepare('SELECT id FROM archive_runs WHERE task_run_id=?').get(taskRunId) as { id: string } | undefined
    if (!row) throw new Error('NAS归档记录不存在')
    return this.getRun(row.id)
  }

  async setSlotStatus(projectId: string, slot: ArchiveSlot, status: Extract<ArchiveSelectionStatus, 'not_required' | 'not_ready'> | 'automatic'): Promise<void> {
    this.store.repository.getProject(projectId, false)
    if (status === 'automatic') {
      this.database.prepare('DELETE FROM project_archive_slots WHERE project_id=? AND slot=?').run(projectId, slot)
      this.notifyChanged()
      return
    }
    const timestamp = new Date().toISOString()
    this.database.prepare(`INSERT INTO project_archive_slots(project_id,slot,selection_status,file_id,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id,slot) DO UPDATE SET selection_status=excluded.selection_status,file_id=NULL,updated_at=excluded.updated_at`).run(projectId, slot, status, null, timestamp)
    this.notifyChanged()
  }

  setSlotFile(projectId: string, slot: ArchiveSlot, file: FileReferenceInput): void {
    this.store.repository.getProject(projectId, false)
    if (!['landscape_cover', 'portrait_cover', 'video_clean', 'video_burned_in'].includes(slot)) throw new Error('这个归档项目不支持手动选择单个文件')
    if ((slot === 'landscape_cover' || slot === 'portrait_cover') && !file.mimeType.startsWith('image/')) throw new Error('封面只能选择图片文件')
    if ((slot === 'video_clean' || slot === 'video_burned_in') && !file.mimeType.startsWith('video/')) throw new Error('成片只能选择视频文件')
    const timestamp = new Date().toISOString()
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO file_references(id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,created_at,updated_at,encrypted_source_path,source_bookmark,source_origin,availability,process_state,capabilities_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        file.id, file.kind ?? 'file', file.relativePath, file.managedLocator ?? file.relativePath, file.originalName, file.sha256, file.sizeBytes, file.mimeType,
        file.createdAt, file.updatedAt ?? file.createdAt, file.encryptedSourcePath ?? null, file.sourceBookmark ?? null, file.sourceOrigin ?? 'file_picker',
        file.availability ?? 'available', file.processState ?? 'ready', file.capabilitiesJson ?? '["preview"]'
      )
      this.database.prepare(`INSERT INTO project_archive_slots(project_id,slot,selection_status,file_id,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(project_id,slot) DO UPDATE SET selection_status='selected',file_id=excluded.file_id,updated_at=excluded.updated_at`).run(projectId, slot, 'selected', file.id, timestamp)
    })()
    this.notifyChanged()
  }

  private sourceForItem(row: ArchiveItemRow): SourceCandidate {
    if (row.source_file_id) return { slot: row.slot, ordinal: row.ordinal, status: row.selection_status, displayName: row.source_name, file: this.file(row.source_file_id), version: null }
    if (row.source_version_id) {
      const version = this.database.prepare('SELECT id,content FROM draft_versions WHERE id=?').get(row.source_version_id) as { id: string; content: string } | undefined
      if (!version) throw new Error('SOURCE_MISSING')
      return { slot: row.slot, ordinal: row.ordinal, status: row.selection_status, displayName: row.source_name, file: null, version }
    }
    return { slot: row.slot, ordinal: row.ordinal, status: row.selection_status, displayName: row.source_name, file: null, version: null }
  }

  private updateRun(runId: string, status: ArchiveRunStatus, changes: { errorCode?: string | null; errorMessage?: string | null; completedAt?: string | null; manifestSha?: string | null; manifestPath?: string | null } = {}): void {
    const timestamp = new Date().toISOString()
    this.database.prepare(`UPDATE archive_runs SET status=?,error_code=?,error_message=?,completed_at=?,manifest_sha256=COALESCE(?,manifest_sha256),manifest_relative_path=COALESCE(?,manifest_relative_path),updated_at=? WHERE id=?`)
      .run(status, changes.errorCode ?? null, changes.errorMessage ?? null, changes.completedAt ?? null, changes.manifestSha ?? null, changes.manifestPath ?? null, timestamp, runId)
  }

  private updateItem(itemId: string, status: ArchiveRunItem['status'], changes: { size?: number | null; sourceSha?: string | null; targetSha?: string | null; temp?: string | null; final?: string | null; errorCode?: string | null; temporaryRemoved?: boolean | null } = {}): void {
    this.database.prepare(`UPDATE archive_items SET status=?,size_bytes=COALESCE(?,size_bytes),source_sha256=COALESCE(?,source_sha256),target_sha256=COALESCE(?,target_sha256),temporary_relative_path=COALESCE(?,temporary_relative_path),final_relative_path=COALESCE(?,final_relative_path),error_code=?,temporary_removed=COALESCE(?,temporary_removed),updated_at=? WHERE id=?`)
      .run(status, changes.size ?? null, changes.sourceSha ?? null, changes.targetSha ?? null, changes.temp ?? null, changes.final ?? null, changes.errorCode ?? null, changes.temporaryRemoved === undefined || changes.temporaryRemoved === null ? null : Number(changes.temporaryRemoved), new Date().toISOString(), itemId)
  }

  private async cleanupRegisteredTemps(runId: string, transport: Awaited<ReturnType<NasArchiveConfigService['createTransport']>>): Promise<void> {
    const rows = this.itemRows(runId)
    for (const item of rows) {
      if (item.status === 'committed' || !item.temporary_relative_path || !basename(item.temporary_relative_path).includes(runId)) continue
      await transport.remove(item.temporary_relative_path).catch(() => undefined)
    }
    const run = this.getRunRow(runId)
    await transport.remove(`${run.relative_directory}/.${runId}-manifest.partial`).catch(() => undefined)
  }

  private async materializeSource(runId: string, item: InternalArchiveItem): Promise<{ path: string; sha256: string; size: number }> {
    if (item.source.file) {
      const managed = resolveManagedFilePath(dirname(this.store.databasePath), item.source.file.managedLocator ?? item.source.file.relativePath)
      const path = await realpath(managed)
      const info = await stat(path)
      if (!info.isFile()) throw new Error('SOURCE_MISSING')
      if (info.size !== item.source.file.sizeBytes) throw new Error('SOURCE_CHANGED')
      return { path, sha256: item.source.file.sha256, size: info.size }
    }
    if (item.source.version) {
      const staging = join(dirname(this.store.databasePath), 'archive-staging', runId)
      await mkdir(staging, { recursive: true, mode: 0o700 })
      const path = join(staging, `${item.source.version.id}.docx`)
      const project = this.store.repository.getProject(this.getRunRow(runId).project_id, false)
      await writeFile(path, await buildScriptDocx(project.title, item.source.version.content), { mode: 0o600 })
      const info = await stat(path)
      return { path, sha256: await sha256File(path), size: info.size }
    }
    throw new Error('SOURCE_MISSING')
  }

  getBackupStatus(): NasBackupStatus {
    const row = this.database.prepare('SELECT status,backup_date,last_attempt_at,last_succeeded_at,error_message FROM nas_backup_state WHERE id=?').get('primary') as {
      status: NasBackupStatus['status']; backup_date: string | null; last_attempt_at: string | null; last_succeeded_at: string | null; error_message: string | null
    }
    return {
      status: row.status,
      backupDate: row.backup_date,
      lastAttemptAt: row.last_attempt_at,
      lastSucceededAt: row.last_succeeded_at,
      errorMessage: row.error_message
    }
  }

  private setBackupStatus(status: NasBackupStatus['status'], changes: { backupDate?: string | null; succeededAt?: string | null; errorMessage?: string | null } = {}): NasBackupStatus {
    const timestamp = new Date().toISOString()
    this.database.prepare(`UPDATE nas_backup_state SET status=?,backup_date=COALESCE(?,backup_date),last_attempt_at=?,last_succeeded_at=COALESCE(?,last_succeeded_at),error_message=?,updated_at=? WHERE id='primary'`)
      .run(status, changes.backupDate ?? null, timestamp, changes.succeededAt ?? null, changes.errorMessage ?? null, timestamp)
    this.notifyChanged()
    return this.getBackupStatus()
  }

  private async pruneRemoteBackups(transport: Awaited<ReturnType<NasArchiveConfigService['createTransport']>>): Promise<void> {
    const privateRoot = await this.configs.getPrivateRoot()
    const systemRoot = join(privateRoot, '系统备份')
    const entries = await readdir(systemRoot, { withFileTypes: true }).catch(() => [])
    const automatic: Array<{ name: string; createdAt: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue
      try {
        const manifest = await validateWorkspaceBackupDirectory(join(systemRoot, entry.name), { requireMarker: true })
        if (manifest.version === 2 && manifest.kind === 'nas_daily') automatic.push({ name: entry.name, createdAt: manifest.createdAt })
      } catch { /* 不是App生成的完整备份，绝不自动删除 */ }
    }
    automatic.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const keep = new Set<string>()
    const days = new Set<string>()
    const months = new Set<string>()
    for (const backup of automatic) {
      const day = localDateForInstant(new Date(backup.createdAt), 'Asia/Shanghai')
      const month = day.slice(0, 7)
      if (!days.has(day) && days.size < 30) { days.add(day); keep.add(backup.name) }
      if (!months.has(month) && months.size < 12) { months.add(month); keep.add(backup.name) }
    }
    for (const backup of automatic) if (!keep.has(backup.name)) await transport.remove(`系统备份/${backup.name}`, true)
  }

  private async syncDailyBackup(transport: Awaited<ReturnType<NasArchiveConfigService['createTransport']>>, expectedRevision: string, signal: AbortSignal): Promise<void> {
    const day = localDateForInstant(new Date(), 'Asia/Shanghai')
    const root = `系统备份/${day}`
    const ownerId = `nas-backup:${day}`
    const privateRoot = await this.configs.getPrivateRoot()
    const removeOwnedRoot = async (conflictMessage: string): Promise<void> => {
      const marked = await validateWorkspaceBackupMarker(join(privateRoot, root)).then(() => true).catch(() => false)
      if (marked) {
        await transport.remove(root, true)
        return
      }
      try {
        const created = await transport.claimDirectory(root, ownerId)
        if (created) {
          await transport.remove(root, true)
          return
        }
        await transport.remove(root, true)
      } catch {
        throw new Error(conflictMessage)
      }
    }
    if (await transport.stat(`${root}/manifest.json`)) {
      try {
        const manifest = await validateWorkspaceBackupDirectory(join(privateRoot, root), { requireMarker: true })
        if (manifest.version !== 2 || manifest.kind !== 'nas_daily') throw new Error('NAS当日备份目录不是本App生成的日备份')
        await this.pruneRemoteBackups(transport)
        return
      } catch {
        await removeOwnedRoot('NAS当日备份损坏且无法确认归属，未执行覆盖')
      }
    }
    if (await transport.stat(root)) {
      await removeOwnedRoot('NAS当日备份目录已存在且不属于本App，未执行覆盖')
    }
    await transport.claimDirectory(root, ownerId)
    const backup = await this.store.createBackup('nas-daily')
    const localManifest = await validateWorkspaceBackupDirectory(backup, { requireMarker: true })
    if (localManifest.version !== 2 || localManifest.kind !== 'nas_daily') throw new Error('本机日备份清单无效')
    const walk = async (directory: string): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...await walk(path))
        else if (entry.isFile()) files.push(path)
      }
      return files
    }
    const files = (await walk(backup)).sort((left, right) => {
      const rank = (path: string): number => basename(path) === 'creator-os-backup.json' ? -1 : basename(path) === 'manifest.json' ? 1 : 0
      return rank(left) - rank(right)
    })
    try {
      for (const sourcePath of files) {
        if (signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
        const currentDestination = await this.configs.getStatus()
        if (currentDestination.revision !== expectedRevision) throw new Error('NAS归档位置或分类设置已变化')
        const relativePath = relative(backup, sourcePath).replaceAll('\\', '/')
        const finalPath = `${root}/${relativePath}`
        const temporary = `${dirname(finalPath)}/.${randomUUID()}.partial`
        try {
          const copied = await transport.copyFromLocal({ sourcePath, destinationRelativePath: temporary }, signal, () => undefined)
          const target = await transport.checksum(temporary, signal)
          if (copied.sourceChecksum !== target) throw new Error('VERIFY_FAILED')
          const committed = await transport.commitNoReplace(temporary, finalPath)
          if (committed.relativePath !== finalPath) throw new Error('VERIFY_FAILED')
        } catch (error) {
          await transport.remove(temporary).catch(() => undefined)
          throw error
        }
      }
      await transport.remove(`${root}/.creator-os-archive-owner`)
      await validateWorkspaceBackupDirectory(join(privateRoot, root), { requireMarker: true })
      await this.pruneRemoteBackups(transport)
    } catch (error) {
      await removeOwnedRoot('NAS日备份失败且无法确认临时目录归属').catch(() => undefined)
      throw error
    }
  }

  runDailyBackup(): Promise<NasBackupStatus> {
    if (this.backupPromise) return this.backupPromise
    const operation = (async (): Promise<NasBackupStatus> => {
      const day = localDateForInstant(new Date(), 'Asia/Shanghai')
      this.setBackupStatus('running', { backupDate: day })
      const controller = new AbortController()
      this.backupController = controller
      try {
        const destination = await this.configs.getStatus()
        if (!destination.configured) throw new Error('尚未设置NAS归档目录')
        if (destination.availability !== 'ready') throw new Error('NAS当前未挂载，日备份将在恢复连接后重试')
        if (!destination.revision) throw new Error('NAS归档设置缺少版本信息')
        await this.syncDailyBackup(await this.configs.createTransport(), destination.revision, controller.signal)
        const completedAt = new Date().toISOString()
        if (this.backupDetached) return { status: 'succeeded', backupDate: day, lastAttemptAt: completedAt, lastSucceededAt: completedAt, errorMessage: null }
        return this.setBackupStatus('succeeded', { backupDate: day, succeededAt: completedAt })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'NAS日备份失败'
        if (this.backupDetached) return { status: 'failed', backupDate: day, lastAttemptAt: new Date().toISOString(), lastSucceededAt: null, errorMessage: message }
        return this.setBackupStatus('failed', { backupDate: day, errorMessage: message })
      } finally {
        if (this.backupController === controller) this.backupController = null
      }
    })()
    this.backupPromise = operation.finally(() => { this.backupPromise = null })
    return this.backupPromise
  }

  startDailyBackupSchedule(): void {
    if (this.backupTimer) return
    void this.runDailyBackup()
    this.backupTimer = setInterval(() => void this.runDailyBackup(), 6 * 60 * 60_000)
    this.backupTimer.unref()
  }

  async close(): Promise<void> {
    if (this.backupTimer) clearInterval(this.backupTimer)
    this.backupTimer = null
    this.backupController?.abort()
    for (const controller of this.controllers.values()) controller.abort()
    const work = [...this.executions.values(), ...(this.backupPromise ? [this.backupPromise] : [])]
    if (!work.length) return
    const completed = await Promise.race([
      Promise.allSettled(work).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000))
    ])
    if (!completed) {
      this.backupDetached = true
      throw new Error('NAS任务未能在30秒内停止，将直接退出以避免关闭仍在使用的数据库')
    }
  }

  private async execute(runId: string, preparedSources?: Map<string, SourceCandidate>): Promise<void> {
    if (this.controllers.has(runId)) throw new Error('归档任务已经在运行')
    const controller = new AbortController()
    this.controllers.set(runId, controller)
    let transport: Awaited<ReturnType<NasArchiveConfigService['createTransport']>> | null = null
    try {
      const row = this.getRunRow(runId)
      const destination = await this.configs.getStatus()
      if (destination.revision !== row.destination_revision) throw new Error('DESTINATION_CHANGED')
      if (destination.availability !== 'ready') {
        this.updateRun(runId, 'waiting_for_nas', { errorCode: 'NAS_OFFLINE', errorMessage: 'NAS归档目录当前未挂载' })
        this.database.prepare(`UPDATE task_runs SET status='failed',error_code='NAS_OFFLINE',error_message='NAS归档目录当前未挂载',finished_at=? WHERE id=?`).run(new Date().toISOString(), row.task_run_id)
        return
      }
      const assertDestinationRevision = async (): Promise<void> => {
        if ((await this.configs.getStatus()).revision !== row.destination_revision) throw new Error('DESTINATION_CHANGED')
      }
      transport = await this.configs.createTransport()
      await transport.claimDirectory(row.relative_directory, row.project_id)
      await this.cleanupRegisteredTemps(runId, transport)
      if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
      this.updateRun(runId, 'copying')
      const itemRows = this.itemRows(runId)
      const selected = itemRows.filter((item) => item.selection_status === 'selected')
      let completed = 0
      for (const itemRow of selected) {
        if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
        await assertDestinationRevision()
        if (itemRow.status === 'committed' && itemRow.final_relative_path && itemRow.target_sha256) {
          const remote = await transport.stat(itemRow.final_relative_path)
          if (remote?.kind === 'file' && await transport.checksum(itemRow.final_relative_path, controller.signal) === itemRow.target_sha256) {
            completed += 1
            continue
          }
        }
        const source = preparedSources?.get(`${itemRow.slot}:${itemRow.ordinal}`) ?? this.sourceForItem(itemRow)
        const item: InternalArchiveItem = { row: itemRow, source }
        this.updateItem(itemRow.id, 'copying')
        const materialized = await this.materializeSource(runId, item)
        const finalName = fileNameForSlot(itemRow.slot, itemRow.source_name, itemRow.ordinal)
        const folder = row.relative_directory
        const temporary = `${folder}/.${runId}-${itemRow.id}.partial`
        this.updateItem(itemRow.id, 'copying', { temp: temporary })
        const copied = await transport.copyFromLocal({ sourcePath: materialized.path, destinationRelativePath: temporary }, controller.signal, () => undefined)
        if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
        await assertDestinationRevision()
        if (copied.sourceChecksum !== materialized.sha256) throw new Error('SOURCE_CHANGED')
        this.updateItem(itemRow.id, 'verifying', { size: materialized.size, sourceSha: materialized.sha256, temp: temporary })
        const targetSha = await transport.checksum(temporary, controller.signal)
        if (targetSha !== materialized.sha256) throw new Error('VERIFY_FAILED')
        if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
        await assertDestinationRevision()
        const committed = await transport.commitNoReplace(temporary, `${folder}/${finalName}`)
        this.updateItem(itemRow.id, 'committed', { sourceSha: materialized.sha256, targetSha, temp: temporary, final: committed.relativePath, temporaryRemoved: committed.temporaryRemoved })
        completed += 1
        this.database.prepare('UPDATE task_runs SET progress=? WHERE id=?').run(selected.length ? Math.floor(completed / (selected.length + 1) * 100) : 90, row.task_run_id)
      }
      this.updateRun(runId, 'verifying')
      const run = this.getRun(runId)
      const staging = join(dirname(this.store.databasePath), 'archive-staging', run.id)
      await mkdir(staging, { recursive: true, mode: 0o700 })
      const manifestPath = join(staging, 'manifest.json')
      const manifestItems = this.itemRows(runId)
      const manifest = {
        version: 1, runId: run.id, projectId: run.projectId,
        identity: { category: run.category, year: run.year, sequence: run.sequence },
        commercialSnapshot: Boolean(row.commercial_snapshot),
        folderName: run.folderName, confirmedAt: run.confirmedAt, completedAt: new Date().toISOString(),
        slots: await Promise.all(manifestItems.map(async (item) => {
          let originalSourcePath: string | null = item.source_locator
          if (item.source_file_id) {
            const file = this.file(item.source_file_id)
            originalSourcePath = await realpath(resolveManagedFilePath(dirname(this.store.databasePath), file.managedLocator ?? file.relativePath)).catch(() => item.source_locator)
          } else if (item.source_version_id) originalSourcePath = `draft-version:${item.source_version_id}`
          return {
            slot: item.slot, ordinal: item.ordinal, selectionStatus: item.selection_status, status: item.status,
            sourceFileId: item.source_file_id, sourceVersionId: item.source_version_id, sourceName: item.source_name,
            sourceLocator: item.source_locator, originalSourcePath, sourceOrigin: item.source_origin,
            sizeBytes: item.size_bytes, sourceSha256: item.source_sha256, targetSha256: item.target_sha256,
            destinationRelativePath: item.final_relative_path, archivedAt: item.updated_at
          }
        })),
        missingCount: run.missingCount
      }
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      const folder = row.relative_directory
      const manifestTemporary = `${folder}/.${runId}-manifest.partial`
      await assertDestinationRevision()
      const manifestCopy = await transport.copyFromLocal({ sourcePath: manifestPath, destinationRelativePath: manifestTemporary }, controller.signal, () => undefined)
      if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
      const manifestTargetSha = await transport.checksum(manifestTemporary, controller.signal)
      if (manifestCopy.sourceChecksum !== manifestTargetSha) throw new Error('VERIFY_FAILED')
      if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
      await assertDestinationRevision()
      const committedManifest = await transport.commitNoReplace(manifestTemporary, `${folder}/manifest.json`)
      const completedAt = new Date().toISOString()
      this.updateRun(runId, 'committed', { completedAt, manifestSha: manifestTargetSha, manifestPath: committedManifest.relativePath })
      this.database.prepare(`UPDATE task_runs SET status='succeeded',progress=100,result_summary=?,finished_at=? WHERE id=?`).run(`已归档${selected.length}个文件`, completedAt, row.task_run_id)
    } catch (error) {
      const row = this.getRunRow(runId)
      const canceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const code = canceled ? 'USER_CANCELED' : error instanceof Error && /^(SOURCE_CHANGED|SOURCE_MISSING|VERIFY_FAILED|DESTINATION_CHANGED|DESTINATION_EXISTS)$/.test(error.message) ? error.message : 'ARCHIVE_FAILED'
      if (transport) await this.cleanupRegisteredTemps(runId, transport)
      const finishedAt = new Date().toISOString()
      this.database.prepare(`UPDATE archive_items SET status=?,error_code=?,updated_at=? WHERE run_id=? AND status IN ('copying','verifying')`).run(canceled ? 'canceled' : 'failed', code, finishedAt, runId)
      this.database.prepare('UPDATE task_runs SET status=?,error_code=?,error_message=?,finished_at=? WHERE id=?').run(canceled ? 'canceled' : 'failed', code, canceled ? '归档已取消' : '归档失败', finishedAt, row.task_run_id)
      this.updateRun(runId, canceled ? 'canceled' : 'failed', { errorCode: code, errorMessage: canceled ? '归档已取消' : code === 'ARCHIVE_FAILED' ? '归档失败，可在NAS恢复后重试' : code })
    } finally {
      this.controllers.delete(runId)
      await rm(join(dirname(this.store.databasePath), 'archive-staging', runId), { recursive: true, force: true }).catch(() => undefined)
      this.notifyChanged()
    }
  }

  private launchExecute(runId: string, preparedSources?: Map<string, SourceCandidate>): void {
    if (this.executions.has(runId)) throw new Error('归档任务已经在运行')
    const execution = this.execute(runId, preparedSources).finally(() => { this.executions.delete(runId) })
    this.executions.set(runId, execution)
    void execution
  }

  cancel(runId: string): ArchiveRun {
    const run = this.getRun(runId)
    if (['committed', 'canceled'].includes(run.status)) return run
    this.controllers.get(runId)?.abort()
    if (!this.controllers.has(runId)) {
      this.updateRun(runId, 'canceled', { errorCode: 'USER_CANCELED', errorMessage: '归档已取消' })
      this.database.prepare(`UPDATE task_runs SET status='canceled',error_code='USER_CANCELED',error_message='归档已取消',finished_at=? WHERE id=?`).run(new Date().toISOString(), run.taskRunId)
    }
    return this.getRun(runId)
  }

  retry(runId: string): ArchiveRun {
    if (this.controllers.has(runId)) throw new Error('归档任务已经在运行')
    const run = this.getRun(runId)
    if (!['failed', 'waiting_for_nas', 'canceled'].includes(run.status)) throw new Error('当前归档记录不能重试')
    this.database.prepare(`UPDATE archive_items SET status='pending',error_code=NULL,updated_at=? WHERE run_id=? AND selection_status='selected' AND status<>'committed'`).run(new Date().toISOString(), runId)
    this.database.prepare(`UPDATE task_runs SET status='running',progress=0,error_code=NULL,error_message=NULL,started_at=?,finished_at=NULL WHERE id=?`).run(new Date().toISOString(), run.taskRunId)
    this.launchExecute(runId)
    return this.getRun(runId)
  }

  recoverInterruptedRuns(): void {
    const rows = this.database.prepare(`SELECT id FROM archive_runs WHERE status IN ('prepared','copying','verifying')`).all() as Array<{ id: string }>
    for (const row of rows) {
      this.updateRun(row.id, 'waiting_for_nas', { errorCode: 'APP_INTERRUPTED', errorMessage: 'App上次退出时归档未完成，请重试' })
      this.database.prepare(`UPDATE archive_items SET status='pending',error_code='APP_INTERRUPTED',updated_at=? WHERE run_id=? AND selection_status='selected' AND status<>'committed'`).run(new Date().toISOString(), row.id)
      const run = this.getRunRow(row.id)
      this.database.prepare(`UPDATE task_runs SET status='failed',progress=0,error_code='APP_INTERRUPTED',error_message='App上次退出时归档未完成，请重试',finished_at=? WHERE id=?`).run(new Date().toISOString(), run.task_run_id)
    }
  }
}
