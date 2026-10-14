import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'

const directories: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-todo-'))
  directories.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('lightweight todo repository', () => {
  it('keeps schedules and daily todos independent', async () => {
    const { store } = await createStore()
    const schedule = store.repository.createScheduleItem({
      projectId: 'ios',
      title: '拍摄系统变化',
      actionType: 'shooting',
      startAt: '2026-07-27T09:00:00+08:00',
      endAt: null,
      scheduleKind: 'plan',
      waitingFor: null
    })
    expect(store.repository.listTodoItems()).toHaveLength(0)
    store.repository.moveScheduleItem(schedule.id, '2026-07-28T15:00:00+08:00', null)
    expect(store.repository.listTodoItems()).toHaveLength(0)
    expect(store.repository.listScheduleItems().find((item) => item.id === schedule.id)?.startAt).toBe('2026-07-28T15:00:00+08:00')
    store.repository.deleteScheduleItem(schedule.id)
    expect(store.repository.listTodoItems(true)).toHaveLength(0)
    store.close()
  })

  it('defaults to checkboxes, restores the last progress after reopening, and stores manual work time', async () => {
    const { store } = await createStore()
    const [todo] = store.repository.createTodoItems([{
      title: '整理长视频素材',
      plannedDate: '2026-07-27',
      segment: 'afternoon',
      category: 'self_media',
      projectId: null,
      trackingMode: 'checklist',
      progress: 0
    }])
    expect(todo).toMatchObject({ trackingMode: 'checklist', progress: 0, status: 'open' })
    const partial = store.repository.updateTodoItem(todo!.id, { trackingMode: 'progress', progress: 65 })
    expect(partial).toMatchObject({ trackingMode: 'progress', progress: 65, status: 'open' })
    expect(store.repository.updateTodoItem(todo!.id, { completed: true })).toMatchObject({ progress: 100, status: 'completed', progressBeforeComplete: 65 })
    expect(store.repository.updateTodoItem(todo!.id, { completed: false })).toMatchObject({ progress: 65, status: 'open' })

    expect(store.repository.setDailyWorkLog('2026-07-27', {
      selfMediaMinutes: 240,
      aiMinutes: 90,
      otherWorkMinutes: 30
    })).toMatchObject({ selfMediaMinutes: 240, aiMinutes: 90, otherWorkMinutes: 30 })
    expect(store.repository.getSnapshot()).toMatchObject({
      todos: [expect.objectContaining({ id: todo!.id, progress: 65 })],
      dailyWorkLog: { selfMediaMinutes: expect.any(Number), aiMinutes: expect.any(Number), otherWorkMinutes: expect.any(Number) }
    })
    store.close()
  })

  it('stores manual category corrections locally, replaces repeated corrections, and keeps them after restart', async () => {
    const { store, directory } = await createStore()
    const [todo] = store.repository.createTodoItems([{
      title: 'NAS人像拍完',
      plannedDate: '2026-08-05',
      segment: null,
      category: 'life',
      suggestedCategory: 'self_media',
      projectId: null,
      trackingMode: 'checklist',
      progress: 0
    }])
    expect(store.repository.getPreferences().todoCategoryMemories).toMatchObject([
      { title: 'NAS人像拍完', normalizedTitle: 'nas人像拍完', category: 'life', projectId: null }
    ])

    store.repository.updateTodoItem(todo!.id, { category: 'ai' })
    expect(store.repository.getPreferences().todoCategoryMemories).toMatchObject([
      { title: 'NAS人像拍完', normalizedTitle: 'nas人像拍完', category: 'ai', projectId: null }
    ])
    expect(store.repository.getPreferences().todoCategoryMemories).toHaveLength(1)
    store.close()

    const reopened = await openWorkspaceStore(directory)
    expect(reopened.repository.getPreferences().todoCategoryMemories).toMatchObject([
      { normalizedTitle: 'nas人像拍完', category: 'ai' }
    ])
    reopened.close()
  })
})
