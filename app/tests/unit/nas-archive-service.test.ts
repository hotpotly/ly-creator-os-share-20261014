import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { NasArchiveConfigService } from '../../src/main/nas-archive-config-service'
import { NasArchiveService } from '../../src/main/nas-archive-service'
import { retainLinkedFileFromPath } from '../../src/main/managed-files'
import { localDateForInstant } from '../../src/shared/domain/coarse-time'

const roots: string[] = []
const stores: WorkspaceStore[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit-nas-archive')
const protector = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

async function fixture(): Promise<{ store: WorkspaceStore; destination: string; configs: NasArchiveConfigService; service: NasArchiveService }> {
  await mkdir(unitRoot, { recursive: true })
  const userData = await mkdtemp(join(unitRoot, 'workspace-'))
  const destination = await mkdtemp(join(unitRoot, 'destination-'))
  roots.push(userData, destination)
  const store = await openWorkspaceStore(userData)
  stores.push(store)
  const configs = new NasArchiveConfigService(join(userData, 'nas-archive-config.json'), protector)
  await configs.setRoot(destination)
  return { store, destination, configs, service: new NasArchiveService(store, configs, () => undefined) }
}

async function waitForTerminal(service: NasArchiveService, runId: string): Promise<ReturnType<NasArchiveService['getRun']>> {
  for (let index = 0; index < 200; index += 1) {
    const run = service.getRun(runId)
    if (['committed', 'failed', 'canceled', 'waiting_for_nas'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('归档测试等待超时')
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('NAS archive service', () => {
  it('does not write before confirmation, freezes identity and writes a closed manifest without absolute paths', async () => {
    const { store, destination, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<h1>结论</h1><p>这是最终文案。</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    for (const slot of ['landscape_cover', 'portrait_cover', 'business_files', 'subtitle_srt', 'video_clean', 'video_burned_in'] as const) {
      await service.setSlotStatus('ai-browser', slot, 'not_required')
    }
    const currentYear = new Date().getFullYear()
    const yearDirectory = `@${String(currentYear).slice(-2)}年`
    await mkdir(join(destination, '长视频成片', yearDirectory, '12-existing'), { recursive: true })
    await mkdir(join(destination, '长视频成片', yearDirectory, '14coloros深度系统'), { recursive: true })
    const plan = await service.preparePlan('ai-browser', 'long_video')
    expect(plan).toMatchObject({ sequence: 15, missingCount: 0, notRequiredCount: 6, identityFrozen: false })
    expect(JSON.stringify(plan)).not.toContain(destination)
    expect(await readdir(join(destination, '长视频成片', yearDirectory))).toEqual(['12-existing', '14coloros深度系统'])

    const started = await service.confirmPlan(plan.id, plan.planHash)
    const completed = await waitForTerminal(service, started.id)
    expect(completed.status).toBe('committed')
    expect(completed.sequence).toBe(15)
    expect(completed.items.find((item) => item.slot === 'final_script_docx')).toMatchObject({ status: 'committed', finalName: '最终文案.docx' })
    expect(JSON.stringify(completed)).not.toContain(destination)
    const target = join(destination, '长视频成片', yearDirectory, completed.folderName)
    const names = await readdir(target)
    expect(names).toEqual(expect.arrayContaining(['最终文案.docx', 'manifest.json']))
    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      version: 1,
      projectId: 'ai-browser',
      identity: { category: 'long_video', year: currentYear, sequence: 15 },
      missingCount: 0
    })
    expect(manifest).toMatchObject({
      slots: expect.arrayContaining([expect.objectContaining({
        slot: 'final_script_docx',
        sourceLocator: `draft-version:${draft.id}`,
        originalSourcePath: `draft-version:${draft.id}`,
        sourceOrigin: 'draft_version'
      })])
    })
    expect(JSON.stringify(manifest)).not.toContain(destination)
    const nextPlan = await service.preparePlan('ai-browser', 'long_video')
    expect(nextPlan).toMatchObject({ sequence: 15, identityFrozen: true })
    await expect(service.preparePlan('ai-browser', 'ai_video')).rejects.toThrow('不能修改归档分类')
  })

  it('records the original external source path only inside the NAS manifest', async () => {
    const { store, destination, service } = await fixture()
    const sourceRoot = await mkdtemp(join(unitRoot, 'external-source-'))
    roots.push(sourceRoot)
    const sourcePath = join(sourceRoot, 'clean.mp4')
    await writeFile(sourcePath, 'linked-video-source')
    const retained = await retainLinkedFileFromPath(join(store.databasePath, '..'), {
      sourcePath,
      managedDirectory: 'archive-links/ai-browser',
      sourceOrigin: 'file_picker',
      maximumBytes: 1024
    })
    service.setSlotFile('ai-browser', 'video_clean', retained.file)
    for (const slot of ['landscape_cover', 'portrait_cover', 'business_files', 'subtitle_srt', 'video_burned_in', 'final_script_docx'] as const) {
      await service.setSlotStatus('ai-browser', slot, 'not_required')
    }
    const plan = await service.preparePlan('ai-browser', 'long_video')
    expect(JSON.stringify(plan)).not.toContain(sourcePath)
    const run = await service.confirmPlan(plan.id, plan.planHash)
    const completed = await waitForTerminal(service, run.id)
    expect(completed.status).toBe('committed')
    const manifest = JSON.parse(await readFile(join(destination, plan.categoryLabel, plan.yearDirectory, plan.folderName, 'manifest.json'), 'utf8')) as {
      slots: Array<{ slot: string; originalSourcePath: string | null; destinationRelativePath: string | null; archivedAt: string }>
    }
    expect(manifest.slots.find((item) => item.slot === 'video_clean')).toMatchObject({
      originalSourcePath: await realpath(sourcePath),
      destinationRelativePath: expect.stringContaining('/成片无字幕.mp4'),
      archivedAt: expect.any(String)
    })
  })

  it('rejects a changed plan before any archive run or destination write', async () => {
    const { store, destination, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>第一版定稿</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    const plan = await service.preparePlan('ai-browser', 'long_video')
    const replacement = store.repository.saveScript('ai-browser', 'user_edit', '<p>第二版定稿</p>')
    store.repository.setFinalVersion('ai-browser', replacement.id)
    await expect(service.confirmPlan(plan.id, plan.planHash)).rejects.toThrow('内容已变化')
    expect(service.listRuns('ai-browser')).toEqual([])
    expect(await readdir(destination)).toEqual([])
  })

  it('invalidates a frozen preview when the destination configuration changes', async () => {
    const { store, destination, configs, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>归档位置变更测试</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    const plan = await service.preparePlan('ai-browser', 'long_video')
    await configs.updateCategoryLabels({ long_video: '长视频归档', short_video: '短视频成片', ai_video: 'AI视频' })
    await expect(service.confirmPlan(plan.id, plan.planHash)).rejects.toThrow('位置或分类设置已变化')
    expect(service.listRuns('ai-browser')).toEqual([])
    expect(await readdir(destination)).toEqual([])
  })

  it('stops before commit when the configured NAS destination changes during a copy', async () => {
    const { store, destination, configs, service } = await fixture()
    const replacementDestination = await mkdtemp(join(unitRoot, 'destination-replacement-'))
    roots.push(replacementDestination)
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>归档中切换NAS</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    for (const slot of ['landscape_cover', 'portrait_cover', 'business_files', 'subtitle_srt', 'video_clean', 'video_burned_in'] as const) {
      await service.setSlotStatus('ai-browser', slot, 'not_required')
    }
    const transport = await configs.createTransport()
    const copy = transport.copyFromLocal.bind(transport)
    let switched = false
    vi.spyOn(configs, 'createTransport').mockResolvedValue(transport)
    vi.spyOn(transport, 'copyFromLocal').mockImplementation(async (...args) => {
      const receipt = await copy(...args)
      if (!switched) {
        switched = true
        await configs.setRoot(replacementDestination)
      }
      return receipt
    })
    const plan = await service.preparePlan('ai-browser', 'long_video')
    const run = await service.confirmPlan(plan.id, plan.planHash)
    const failed = await waitForTerminal(service, run.id)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'DESTINATION_CHANGED' })
    const target = join(destination, plan.categoryLabel, plan.yearDirectory, plan.folderName)
    expect(await readdir(target)).toEqual(['.creator-os-archive-owner'])
    expect(await readdir(replacementDestination)).toEqual([])
  })

  it('records an item as committed when cancellation arrives at the commit boundary', async () => {
    const { store, destination, configs, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>提交边界取消</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    for (const slot of ['landscape_cover', 'portrait_cover', 'business_files', 'subtitle_srt', 'video_clean', 'video_burned_in'] as const) {
      await service.setSlotStatus('ai-browser', slot, 'not_required')
    }
    const transport = await configs.createTransport()
    const commit = transport.commitNoReplace.bind(transport)
    vi.spyOn(configs, 'createTransport').mockResolvedValue(transport)
    vi.spyOn(transport, 'commitNoReplace').mockImplementation(async (temporary, preferred) => {
      const receipt = await commit(temporary, preferred)
      if (preferred.endsWith('/最终文案.docx')) {
        const runId = temporary.match(/\.([0-9a-f-]{36})-/)?.[1]
        if (runId) service.cancel(runId)
      }
      return receipt
    })
    const plan = await service.preparePlan('ai-browser', 'long_video')
    const started = await service.confirmPlan(plan.id, plan.planHash)
    const canceled = await waitForTerminal(service, started.id)
    expect(canceled.status).toBe('canceled')
    expect(canceled.items.find((item) => item.slot === 'final_script_docx')).toMatchObject({ status: 'committed', finalName: '最终文案.docx' })
    const target = join(destination, plan.categoryLabel, plan.yearDirectory, plan.folderName)
    expect(await readdir(target)).toContain('最终文案.docx')
    expect(await readdir(target)).not.toContain('manifest.json')
  })

  it('normalizes custom category folders once, keeps numbering in that folder and protects the backup namespace', async () => {
    const { destination, configs, service } = await fixture()
    const status = await configs.updateCategoryLabels({ long_video: '  我的:长视频  ', short_video: '短视频', ai_video: 'AI视频' })
    expect(status.categoryLabels.long_video).toBe('我的 长视频')
    const year = new Date().getFullYear()
    await mkdir(join(destination, '我的 长视频', `@${String(year).slice(-2)}年`, '8旧项目'), { recursive: true })
    expect(await service.preparePlan('ai-browser', 'long_video')).toMatchObject({ sequence: 9, categoryLabel: '我的 长视频' })
    await expect(configs.updateCategoryLabels({ long_video: '系统备份', short_video: '短视频', ai_video: 'AI视频' })).rejects.toThrow('保留目录')
    await expect(configs.updateCategoryLabels({ long_video: '.', short_video: '短视频', ai_video: 'AI视频' })).rejects.toThrow('不能为空')
    await expect(configs.updateCategoryLabels({ long_video: '视频', short_video: '视频', ai_video: 'AI视频' })).rejects.toThrow('不能使用相同名称')
  })

  it('does not freeze archive identity when a preview is invalidated by a newly occupied directory', async () => {
    const { store, destination, service } = await fixture()
    const plan = await service.preparePlan('ai-browser', 'long_video')
    const target = join(destination, plan.categoryLabel, plan.yearDirectory, plan.folderName)
    await mkdir(target, { recursive: true })
    await writeFile(join(target, '.creator-os-archive-owner'), 'another-project')
    await expect(service.confirmPlan(plan.id, plan.planHash)).rejects.toThrow('内容已变化')
    expect(service.listRuns('ai-browser')).toEqual([])
    expect(store.repository.native.prepare('SELECT * FROM project_archive_identities WHERE project_id=?').get('ai-browser')).toBeUndefined()
    expect((await service.preparePlan('ai-browser', 'long_video')).sequence).toBe(plan.sequence + 1)
  })

  it('consumes a preview exactly once when confirmation is submitted twice', async () => {
    const { store, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>只允许确认一次</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    for (const slot of ['landscape_cover', 'portrait_cover', 'business_files', 'subtitle_srt', 'video_clean', 'video_burned_in'] as const) {
      await service.setSlotStatus('ai-browser', slot, 'not_required')
    }
    const plan = await service.preparePlan('ai-browser', 'long_video')
    const results = await Promise.allSettled([
      service.confirmPlan(plan.id, plan.planHash),
      service.confirmPlan(plan.id, plan.planHash)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const run = (results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<NasArchiveService['confirmPlan']>>>).value
    expect((await waitForTerminal(service, run.id)).status).toBe('committed')
    expect(service.listRuns('ai-browser')).toHaveLength(1)
  })

  it('honors an explicit not-ready override instead of silently reselecting an automatic final script', async () => {
    const { store, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>已有定稿，但这次不归档</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    await service.setSlotStatus('ai-browser', 'final_script_docx', 'not_ready')
    const plan = await service.preparePlan('ai-browser', 'long_video')
    expect(plan.items.find((item) => item.slot === 'final_script_docx')).toMatchObject({
      status: 'not_ready',
      sourceVersionId: null,
      displayName: '尚未准备'
    })
  })

  it('restores automatic slot discovery after an item was marked unnecessary', async () => {
    const { store, service } = await fixture()
    const draft = store.repository.saveScript('ai-browser', 'user_edit', '<p>恢复自动检查</p>')
    store.repository.setFinalVersion('ai-browser', draft.id)
    await service.setSlotStatus('ai-browser', 'final_script_docx', 'not_required')
    expect((await service.preparePlan('ai-browser', 'long_video')).items.find((item) => item.slot === 'final_script_docx')).toMatchObject({ status: 'not_required' })
    await service.setSlotStatus('ai-browser', 'final_script_docx', 'automatic')
    expect((await service.preparePlan('ai-browser', 'long_video')).items.find((item) => item.slot === 'final_script_docx')).toMatchObject({
      status: 'selected',
      sourceVersionId: draft.id
    })
  })

  it('copies a closed daily backup with nested managed files and reuses the same day without duplicate versions', async () => {
    const { store, destination, service } = await fixture()
    const userData = join(store.databasePath, '..')
    const bytes = Buffer.from('NAS日备份嵌套文件')
    await mkdir(join(userData, 'managed-files', 'nested'), { recursive: true })
    await writeFile(join(userData, 'managed-files', 'nested', 'note.txt'), bytes)
    const now = new Date().toISOString()
    store.repository.native.prepare(`INSERT INTO file_references(
      id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,source_origin,availability,process_state,capabilities_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'nas-backup-note', 'file', 'managed-files/nested/note.txt', 'managed-files/nested/note.txt', 'note.txt',
      createHash('sha256').update(bytes).digest('hex'), bytes.byteLength, 'text/plain', 'managed_import', 'available', 'ready', '["preview"]', now, now
    )
    expect((await service.runDailyBackup()).status).toBe('succeeded')
    const day = localDateForInstant(new Date(), 'Asia/Shanghai')
    const root = join(destination, '系统备份', day)
    expect(await readFile(join(root, 'files', 'managed-files', 'nested', 'note.txt'), 'utf8')).toBe('NAS日备份嵌套文件')
    expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))).toMatchObject({ version: 2, kind: 'nas_daily' })
    expect((await service.runDailyBackup()).status).toBe('succeeded')
    expect((await readdir(root)).filter((name) => name.startsWith('manifest v'))).toEqual([])
    await writeFile(join(root, 'files', 'managed-files', 'nested', 'note.txt'), '损坏')
    expect((await service.runDailyBackup()).status).toBe('succeeded')
    expect(await readFile(join(root, 'files', 'managed-files', 'nested', 'note.txt'), 'utf8')).toBe('NAS日备份嵌套文件')
  })

  it('never removes a conflicting daily folder that only imitates the App marker filename', async () => {
    const { destination, service } = await fixture()
    const day = localDateForInstant(new Date(), 'Asia/Shanghai')
    const root = join(destination, '系统备份', day)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'creator-os-backup.json'), '{"app":"someone-else","format":2}\n')
    await writeFile(join(root, 'keep.txt'), '不能删除')
    expect((await service.runDailyBackup()).status).toBe('failed')
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('不能删除')
  })

  it('cleans an owned pre-marker failure and succeeds automatically on the next daily attempt', async () => {
    const { destination, configs, service } = await fixture()
    const transport = await configs.createTransport()
    const copy = transport.copyFromLocal.bind(transport)
    let failFirstCopy = true
    vi.spyOn(configs, 'createTransport').mockResolvedValue(transport)
    vi.spyOn(transport, 'copyFromLocal').mockImplementation(async (...args) => {
      if (failFirstCopy) {
        failFirstCopy = false
        throw new Error('模拟首个文件提交前断线')
      }
      return copy(...args)
    })
    expect((await service.runDailyBackup()).status).toBe('failed')
    const day = localDateForInstant(new Date(), 'Asia/Shanghai')
    await expect(readFile(join(destination, '系统备份', day, '.creator-os-archive-owner'), 'utf8')).rejects.toThrow()
    expect((await service.runDailyBackup()).status).toBe('succeeded')
    expect(JSON.parse(await readFile(join(destination, '系统备份', day, 'manifest.json'), 'utf8'))).toMatchObject({ version: 2, kind: 'nas_daily' })
  })

  it('recovers interrupted archive runs as retryable instead of feeding them to the generic task runner', async () => {
    const { store, service } = await fixture()
    const timestamp = new Date().toISOString()
    const task = store.repository.createTaskRun({
      taskType: 'nas_archive', projectId: 'ai-browser', title: '归档中断测试', provider: 'none', inputSnapshot: '{}',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'archive', shell: false }, outputTarget: 'archive:nas', requiresConfirmation: true
    })
    store.repository.native.prepare(`INSERT INTO archive_runs(id,project_id,task_run_id,destination_id,destination_revision,category,category_label,year,sequence,folder_name,relative_directory,commercial_snapshot,status,plan_hash,confirmed_at,missing_count,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('archive-interrupted', 'ai-browser', task.id, 'primary', crypto.randomUUID(), 'long_video', '长视频成片', 2026, 1, '1-test', '长视频成片/2026/1-test', 0, 'copying', 'a'.repeat(64), timestamp, 0, timestamp, timestamp)
    service.recoverInterruptedRuns()
    expect(service.getRun('archive-interrupted')).toMatchObject({ status: 'waiting_for_nas', errorCode: 'APP_INTERRUPTED' })
    expect(store.repository.getNextQueuedTask()?.taskType).not.toBe('nas_archive')
    expect(() => store.repository.retryTaskRun(task.id)).toThrow('只能在归档记录中重试')
  })

  it('preserves files referenced only by archive slots or retryable archive runs across a store restart', async () => {
    const { store } = await fixture()
    const userData = join(store.databasePath, '..')
    await mkdir(join(userData, 'archive-links', 'ai-browser'), { recursive: true })
    await writeFile(join(userData, 'archive-links', 'ai-browser', 'slot.mp4'), 'slot-only')
    await writeFile(join(userData, 'archive-links', 'ai-browser', 'run.mp4'), 'run-only')
    const timestamp = new Date().toISOString()
    const insertFile = store.repository.native.prepare(`INSERT INTO file_references(
      id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,source_origin,availability,process_state,capabilities_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    insertFile.run('archive-slot-file', 'file', 'archive-links/ai-browser/slot.mp4', 'archive-links/ai-browser/slot.mp4', 'slot.mp4', createHash('sha256').update('slot-only').digest('hex'), 9, 'video/mp4', 'file_picker', 'available', 'ready', '["preview"]', timestamp, timestamp)
    insertFile.run('archive-run-file', 'file', 'archive-links/ai-browser/run.mp4', 'archive-links/ai-browser/run.mp4', 'run.mp4', createHash('sha256').update('run-only').digest('hex'), 8, 'video/mp4', 'file_picker', 'available', 'ready', '["preview"]', timestamp, timestamp)
    store.repository.native.prepare('INSERT INTO project_archive_slots(project_id,slot,selection_status,file_id,updated_at) VALUES(?,?,?,?,?)')
      .run('ai-browser', 'video_clean', 'selected', 'archive-slot-file', timestamp)
    const task = store.repository.createTaskRun({
      taskType: 'nas_archive', projectId: 'ai-browser', title: '待重试归档', provider: 'none', inputSnapshot: '{}',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'archive', shell: false }, outputTarget: 'archive:nas', requiresConfirmation: true
    })
    store.repository.native.prepare(`INSERT INTO archive_runs(id,project_id,task_run_id,destination_id,destination_revision,category,category_label,year,sequence,folder_name,relative_directory,commercial_snapshot,status,plan_hash,confirmed_at,missing_count,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('archive-file-retry', 'ai-browser', task.id, 'primary', crypto.randomUUID(), 'long_video', '长视频成片', 2026, 2, '2-retry', '长视频成片/@26年/2-retry', 0, 'failed', 'b'.repeat(64), timestamp, 0, timestamp, timestamp)
    store.repository.native.prepare(`INSERT INTO archive_items(id,run_id,slot,ordinal,selection_status,source_file_id,source_version_id,source_name,source_locator,source_origin,size_bytes,source_sha256,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('archive-file-item', 'archive-file-retry', 'video_burned_in', 0, 'selected', 'archive-run-file', null, 'run.mp4', 'archive-links/ai-browser/run.mp4', 'file_picker', 8, createHash('sha256').update('run-only').digest('hex'), 'failed', timestamp, timestamp)

    store.close()
    stores.splice(stores.indexOf(store), 1)
    const reopened = await openWorkspaceStore(userData)
    stores.push(reopened)
    expect(reopened.repository.getFileReference('archive-slot-file').id).toBe('archive-slot-file')
    expect(reopened.repository.getFileReference('archive-run-file').id).toBe('archive-run-file')
    expect(reopened.repository.native.prepare('SELECT file_id FROM project_archive_slots WHERE project_id=? AND slot=?').get('ai-browser', 'video_clean')).toEqual({ file_id: 'archive-slot-file' })
    expect(reopened.repository.native.prepare('SELECT source_file_id FROM archive_items WHERE id=?').get('archive-file-item')).toEqual({ source_file_id: 'archive-run-file' })
    expect(await readFile(join(userData, 'archive-links', 'ai-browser', 'slot.mp4'), 'utf8')).toBe('slot-only')
    expect(await readFile(join(userData, 'archive-links', 'ai-browser', 'run.mp4'), 'utf8')).toBe('run-only')
  })
})
