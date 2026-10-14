import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { PROJECT_COLOR_TOKENS, projectColorForIndex } from '../../src/shared/domain'
import { preferencesPatchSchema, projectCreatePayloadSchema, projectSetColorPayloadSchema } from '../../src/shared/ipc'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-project-colors-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('R5b project colors and schedule panel preferences', () => {
  it('keeps one ordered 12-color pool and wraps allocation through the shared helper', () => {
    expect(PROJECT_COLOR_TOKENS).toHaveLength(12)
    expect(new Set(PROJECT_COLOR_TOKENS).size).toBe(12)
    expect(projectColorForIndex(0)).toBe('project-1')
    expect(projectColorForIndex(11)).toBe('project-12')
    expect(projectColorForIndex(12)).toBe('project-1')
    expect(projectColorForIndex(Number.NaN)).toBe('project-1')
  })

  it('accepts only strict project color mutations at the IPC boundary', () => {
    expect(projectSetColorPayloadSchema.parse({ projectId: 'ios', colorToken: 'project-12' })).toEqual({
      projectId: 'ios',
      colorToken: 'project-12'
    })
    expect(projectSetColorPayloadSchema.safeParse({ projectId: 'ios', colorToken: 'project-13' }).success).toBe(false)
    expect(projectSetColorPayloadSchema.safeParse({ projectId: 'ios', colorToken: 'project-1', extra: true }).success).toBe(false)
  })

  it('allows project creation to omit a color while still rejecting invalid explicit colors', () => {
    const base = { title: '自动分配项目色', description: '', contentTypeId: 'type-digital', platformTargets: [] }
    expect(projectCreatePayloadSchema.safeParse(base).success).toBe(true)
    expect(projectCreatePayloadSchema.safeParse({ ...base, colorToken: 'project-12' }).success).toBe(true)
    expect(projectCreatePayloadSchema.safeParse({ ...base, colorToken: 'project-13' }).success).toBe(false)
  })

  it('allocates every unused color before wrapping, regardless of content direction', async () => {
    const { store } = await createStore()
    const usedBefore = new Set(store.repository.listProjects(true, false).filter((project) =>
      project.status !== 'archived' && (project.topicStageRole === null || project.topicStageRole === 'project_created')
    ).map((project) => project.colorToken))
    const remaining = PROJECT_COLOR_TOKENS.length - usedBefore.size
    const created = Array.from({ length: remaining }, (_, index) => store.repository.createProject({
      title: `同方向项目${index + 1}`,
      description: '',
      contentTypeId: 'type-digital',
      platformTargets: []
    }))
    const createdColors = created.map((project) => project.colorToken)

    expect(new Set(createdColors).size).toBe(remaining)
    expect(createdColors.every((color) => !usedBefore.has(color))).toBe(true)
    expect(PROJECT_COLOR_TOKENS).toContain(store.repository.createProject({
      title: '颜色池用尽后的项目',
      description: '',
      contentTypeId: 'type-digital',
      platformTargets: []
    }).colorToken)
    store.close()
  })

  it('does not let completed or archived lifecycle records occupy the active color pool', async () => {
    const { store } = await createStore()
    const otherActiveColors = new Set(store.repository.listProjects(true, false)
      .filter((project) => project.id !== 'ios' && (project.topicStageRole === null || project.topicStageRole === 'project_created'))
      .map((project) => project.colorToken))
    const reusableColor = PROJECT_COLOR_TOKENS.find((color) => !otherActiveColors.has(color))
    expect(reusableColor).toBeTruthy()

    store.repository.setProjectColor('ios', reusableColor!)
    store.repository.setProjectLifecycle('ios', 'archived')
    expect(store.repository.createProject({
      title: '归档色复用项目',
      description: '',
      contentTypeId: 'type-digital',
      platformTargets: []
    }).colorToken).toBe(reusableColor)
    store.close()
  })

  it('persists a project color and exposes it through the normalized workspace snapshot', async () => {
    const { store } = await createStore()
    expect(store.repository.setProjectColor('ios', 'project-12').colorToken).toBe('project-12')
    expect(store.repository.getSnapshot().projects.find((project) => project.id === 'ios')?.colorToken).toBe('project-12')
    expect(() => store.repository.setProjectColor('missing-project', 'project-1')).toThrow('项目不存在')
    store.close()
  })

  it('validates sidebar, schedule panel widths, collapse states and the 220px inspector minimum', () => {
    expect(preferencesPatchSchema.safeParse({
      sidebarWidth: 184,
      inspectorWidth: 220,
      scheduleUnscheduledWidth: 132,
      scheduleUnscheduledCollapsed: true,
      scheduleInspectorCollapsed: true
    }).success).toBe(true)
    expect(preferencesPatchSchema.safeParse({ sidebarWidth: 340 }).success).toBe(true)
    expect(preferencesPatchSchema.safeParse({ sidebarWidth: 183 }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({ sidebarWidth: 341 }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({ inspectorWidth: 219 }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({ scheduleUnscheduledWidth: 131 }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({ scheduleUnscheduledWidth: 321 }).success).toBe(false)
  })
})
