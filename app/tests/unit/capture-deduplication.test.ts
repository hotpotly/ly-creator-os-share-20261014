import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<WorkspaceStore> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-capture-dedup-'))
  roots.push(directory)
  return (await openWorkspaceStore(directory))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('exact capture deduplication', () => {
  it('keeps the richer exact text record and moves duplicates to the recycle bin', async () => {
    const store = await createStore()
    const plain = store.repository.createCapture({
      captureKind: 'unknown',
      primaryProjectId: null,
      originalContent: '完全相同的待查重文字',
      sourceType: 'quick_capture'
    })
    const linked = store.repository.createCapture({
      captureKind: 'project_content',
      primaryProjectId: 'ssd',
      originalContent: '完全相同的待查重文字',
      sourceType: 'quick_capture'
    })

    const result = store.repository.deduplicateCapturesExact()
    expect(result).toMatchObject({ duplicateGroupCount: 1, duplicateCount: 1 })
    expect(result.retainedCaptureIds).toContain(linked.id)
    expect(result.discarded).toEqual([{ captureId: plain.id, previousUseStatus: 'active' }])
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === plain.id)?.useStatus).toBe('discarded')
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === linked.id)?.useStatus).toBe('active')

    store.repository.setCaptureUseStatus(plain.id, result.discarded[0]!.previousUseStatus)
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === plain.id)?.useStatus).toBe('active')
    store.close()
  })

  it('uses attachment SHA-256 and does not merge records whose notes differ', async () => {
    const store = await createStore()
    const first = store.repository.createCapture({
      captureKind: 'unknown',
      primaryProjectId: null,
      originalContent: '同一张图片',
      sourceType: 'mobile_android'
    })
    const second = store.repository.createCapture({
      captureKind: 'unknown',
      primaryProjectId: null,
      originalContent: '同一张图片',
      sourceType: 'mobile_android'
    })
    const third = store.repository.createCapture({
      captureKind: 'unknown',
      primaryProjectId: null,
      originalContent: '同一张图片',
      sourceType: 'mobile_android'
    })
    const timestamp = new Date().toISOString()
    store.repository.native.prepare(`
      INSERT INTO file_references (
        id,kind,relative_path,managed_locator,original_name,sha256,size_bytes,mime_type,
        created_at,updated_at,source_origin,availability,process_state,capabilities_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'dedup-file', 'file', 'captures/dedup-image.png', 'captures/dedup-image.png',
      'dedup-image.png', 'f'.repeat(64), 1024, 'image/png',
      timestamp, timestamp, 'managed_import', 'available', 'ready', '["preview","ocr"]'
    )
    const insertLink = store.repository.native.prepare(`
      INSERT INTO capture_asset_links (id,capture_id,file_reference_id,attachment_kind,position,created_at)
      VALUES (?,?,?,?,?,?)
    `)
    insertLink.run('dedup-link-1', first.id, 'dedup-file', 'image', 0, timestamp)
    insertLink.run('dedup-link-2', second.id, 'dedup-file', 'image', 0, timestamp)
    insertLink.run('dedup-link-3', third.id, 'dedup-file', 'image', 0, timestamp)
    store.repository.native.prepare('UPDATE captures SET mobile_notes=? WHERE id=?').run('这条备注不同，不能合并', third.id)

    const result = store.repository.deduplicateCapturesExact()
    expect(result.duplicateCount).toBe(1)
    expect([first.id, second.id]).toContain(result.discarded[0]?.captureId)
    expect(result.discarded.map((item) => item.captureId)).not.toContain(third.id)
    expect(store.repository.getSnapshot().captures.find((capture) => capture.id === third.id)?.useStatus).toBe('active')
    store.close()
  })
})
