import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { recommendedTodoStageForProject, recommendTodoStage } from '../../src/shared/todo-stage-recommendation'
import { normalizeTodoAction, normalizeTodoStageMemories, recallTodoStage, type TodoStageMemory } from '../../src/shared/todo-stage-memory'
import { parseTodoBatch } from '../../src/shared/todo-parser'
import type { CreateTodoInput } from '../../src/shared/domain'
const dirs: string[] = [], stores: WorkspaceStore[] = []
async function setup() {
  const root = join(import.meta.dirname, '../../test-results/unit'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'learning-')); dirs.push(dir)
  const store = await openWorkspaceStore(dir); stores.push(store); return store.repository
}
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
const input = (patch: Partial<CreateTodoInput> = {}): CreateTodoInput => ({ title: '修改开场200字(2)', stageSelection: 'manual', plannedDate: '2026-10-03', projectId: 'ios', category: 'self_media', trackingMode: 'checklist', progress: 0, segment: null, ...patch })
const project = { id: 'ios', title: 'iOS 27', enabledModuleKeys: ['script', 'outline', 'editing'] }
const memory = (stageKey: TodoStageMemory['stageKey'], projectId = 'ios', updatedAt = '2026-10-03T00:00:00Z'): TodoStageMemory => ({ title: '修改开场200字(2)', action: normalizeTodoAction('修改开场200字(2)'), projectId, stageKey, updatedAt })
describe('todo correction learning', () => {
  it('understands word-count writing without overriding explicit outline or ambiguous actions', () => {
    for (const title of ['写到3000字', '写完两千字', '写到介绍部分多少字']) expect(recommendTodoStage(title).stageKey).toBe('script')
    expect(recommendTodoStage('大纲写到1000字').stageKey).toBe('outline')
    expect(recommendTodoStage('文案和剪辑').stageKey).toBeNull()
    expect(recommendTodoStage('阅读3000字').stageKey).toBeNull()
    expect(recommendedTodoStageForProject('写到3000字', undefined)).toBeNull()
  })
  it('uses latest local corrections, portable consistent actions, explicit clears and enabled stages', () => {
    expect(normalizeTodoAction('iOS 27 写到３０００字（2）', 'iOS 27')).toBe('写#字')
    expect(recommendedTodoStageForProject('修改开场900字(1)', project, [memory('script')])).toBe('script')
    expect(recommendedTodoStageForProject('修改开场900字', { ...project, id: 'new' }, [memory('script')])).toBe('script')
    expect(recallTodoStage('修改开场900字', { ...project, id: 'new' }, [memory('script'), memory('editing', 'other')])).toBeNull()
    expect(recommendedTodoStageForProject('修改开场900字', project, [memory('script'), memory(null, 'ios', '2026-10-03T01:00:00Z')])).toBeNull()
    expect(recommendedTodoStageForProject('修改开场900字', { ...project, enabledModuleKeys: ['outline'] }, [memory('script')])).toBeNull()
    expect(recallTodoStage('修改开场900字', { ...project, id: 'new' }, [memory(null)])).toBeNull()
    expect(normalizeTodoStageMemories([memory('script'), memory('editing', 'ios', '2026-10-03T01:00:00Z')])).toHaveLength(1)
  })
  it('learns manual creation and edits, not suggestions or unrelated progress, persists and rolls back failed batches', async () => {
    const r = await setup()
    const [auto] = r.createTodoItems([input({ stageKey: 'script', stageSelection: 'suggested', categorySelection: 'suggested' })])
    expect(r.getPreferences().todoStageMemories).toHaveLength(0)
    r.updateTodoItem(auto!.id, { title: auto!.title, stageKey: 'script', category: 'self_media' })
    expect(r.getPreferences().todoStageMemories).toHaveLength(0)
    r.updateTodoItem(auto!.id, { progress: 30 })
    expect(r.getPreferences().todoStageMemories).toHaveLength(0)
    r.updateTodoItem(auto!.id, { stageKey: 'outline', category: 'ai' })
    let prefs = r.getPreferences()
    expect(recommendedTodoStageForProject('修改开场500字', project, prefs.todoStageMemories)).toBe('outline')
    r.updateTodoItem(auto!.id, { stageKey: null })
    expect(r.getPreferences().todoStageMemories?.[0]?.stageKey).toBeNull()
    const count = r.listTodoItems().length, before = r.getPreferences()
    expect(() => r.createTodoItems([input({ stageKey: 'script', categorySelection: 'manual' }), input({ title: '' })])).toThrow()
    expect(r.listTodoItems()).toHaveLength(count); expect(r.getPreferences()).toEqual(before)
    r.createTodoItems([input({ stageKey: 'script', category: 'life', categorySelection: 'manual' })])
    const reopened = await openWorkspaceStore(dirs[0]!); stores.push(reopened); prefs = reopened.repository.getPreferences()
    expect(recommendedTodoStageForProject('修改开场500字', project, prefs.todoStageMemories)).toBe('script')
    const parsed = parseTodoBatch('修改开场500字(1)', { today: '2026-10-03', categoryMemories: prefs.todoCategoryMemories })
    expect(parsed[0]?.category).toBe('life')
  })
  it('parser carries source provenance and explicit categories win over learned labels', () => {
    const options = { today: '2026-10-03', projects: [project], stageMemories: [memory('outline')], categoryLabels: { self_media: '自媒体', life: '生活', ai: 'AI', other_work: '健康' }, categoryMemories: [{ title: '阅读200页', normalizedTitle: '阅读200页', projectId: null, category: 'life' as const, updatedAt: '2026-10-03T00:00:00Z' }] }
    expect(parseTodoBatch('iOS 27修改开场500字', options)[0]).toMatchObject({ stageKey: 'outline', stageSelection: 'suggested' })
    expect(parseTodoBatch('阅读500页', options)[0]).toMatchObject({ category: 'life', categorySource: 'memory', categorySelection: 'suggested' })
    expect(parseTodoBatch('健康：阅读500页', options)[0]).toMatchObject({ category: 'other_work', categorySelection: 'manual' })
  })
})
