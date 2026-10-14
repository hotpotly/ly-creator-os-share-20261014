import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { seedWorkspace } from '../../src/main/db/seed'
import { templateMatchesClassification, type SaveProjectTemplateInput } from '../../src/shared/project-template-rules'
import { projectTemplateSavePayloadSchema } from '../../src/shared/ipc'
const roots: string[] = [], stores: WorkspaceStore[] = []
async function setup(): Promise<WorkspaceStore> {
  const parent = join(import.meta.dirname, '../../test-results/unit'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'template-rules-')); roots.push(root)
  const store = await openWorkspaceStore(root); stores.push(store); return store
}
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const draft: SaveProjectTemplateInput = { name: 'AI产品短视频', description: '明确适用范围', moduleKeys: ['script', 'publishing'], recommendedContentTypeIds: ['type-ai'], recommendedVideoFormats: ['short'], recommendedProjectKinds: ['ordinary'], isActive: true }
it('persists template edits and AND-matches all three independent dimensions', async () => {
  const { repository: r } = await setup()
  const template = r.saveProjectTemplate(draft)
  expect(templateMatchesClassification(template, { contentTypeId: 'type-ai', videoFormat: 'short', isCommercial: false })).toBe(true)
  for (const change of [{ contentTypeId: 'type-unboxing' }, { videoFormat: 'long' as const }, { videoFormat: null }, { isCommercial: true }]) expect(templateMatchesClassification(template, { contentTypeId: 'type-ai', videoFormat: 'short', isCommercial: false, ...change })).toBe(false)
  const renamed = r.saveProjectTemplate({ ...draft, id: template.id, name: '开箱长视频', recommendedContentTypeIds: ['type-unboxing'], recommendedVideoFormats: ['long'], recommendedProjectKinds: [] })
  expect(templateMatchesClassification(renamed, { contentTypeId: 'type-unboxing', videoFormat: 'long', isCommercial: true })).toBe(true)
  const reopened = await openWorkspaceStore(roots[0]!); stores.push(reopened)
  expect(reopened.repository.listProjectTemplates().find(t => t.id === template.id)).toEqual(renamed)
})
it('does not reapply modules or touch versions, stages or classification on existing projects', async () => {
  const { repository: r } = await setup()
  const template = r.saveProjectTemplate(draft)
  const project = r.createProject({ title: '已采用模板', description: '原内容', contentTypeId: 'type-ai', videoFormat: 'short', isCommercial: true, platformTargets: [], templateId: template.id })
  const tables = ['project_modules', 'stage_time_records', 'draft_versions', 'business_records']
  const before = tables.map(table => r.native.prepare('SELECT * FROM ' + table + ' WHERE project_id=?').all(project.id))
  r.saveProjectTemplate({ ...draft, id: template.id, name: '更新配置', moduleKeys: ['materials', 'editing'], isActive: false })
  tables.forEach((table, i) => expect(r.native.prepare('SELECT * FROM ' + table + ' WHERE project_id=?').all(project.id)).toEqual(before[i]))
  expect(r.getProject(project.id, false)).toMatchObject({ contentTypeId: 'type-ai', videoFormat: 'short', isCommercial: true, appliedTemplateId: template.id })
  expect(() => r.createProject({ title: '停用模板', description: '', contentTypeId: 'type-ai', platformTargets: [], templateId: template.id })).toThrow('模板不可用')
  r.saveProjectTemplate({ ...draft, id: template.id, isActive: true })
  expect(r.previewProjectTemplate(project.id, template.id).preserve).toContain('script')
})
it('preserves old projects and template IDs on migration and matches default short videos in new directions', () => {
  const db = new Database(':memory:')
  try {
    runMigrationsThrough(db, '0095_r10h_content_classification'); seedWorkspace(db, true, true)
    const projects = db.prepare('SELECT * FROM projects').all(), modules = db.prepare('SELECT * FROM project_modules').all()
    const templates = db.prepare('SELECT id,name,module_keys_json FROM project_templates').all()
    runMigrations(db); runMigrations(db)
    expect(db.prepare('SELECT * FROM projects').all()).toEqual(projects)
    expect(db.prepare('SELECT * FROM project_modules').all()).toEqual(modules)
    expect(db.prepare('SELECT id,name,module_keys_json FROM project_templates').all()).toEqual(templates)
    expect(db.prepare("SELECT recommended_video_formats_json value FROM project_templates WHERE id='template-quick-content'").get()).toEqual({ value: '["short"]' })
    expect(db.pragma('foreign_key_check')).toEqual([])
  } finally { db.close() }
})
it('validates names, definitions and payload boundaries without mutating existing templates', async () => {
  const { repository: r } = await setup()
  r.saveProjectTemplate(draft)
  expect(() => r.saveProjectTemplate(draft)).toThrow('同名')
  expect(() => r.saveProjectTemplate({ ...draft, name: '坏方向', recommendedContentTypeIds: ['type-commercial'] })).toThrow('已迁移')
  expect(projectTemplateSavePayloadSchema.safeParse({ ...draft, moduleKeys: ['unknown'] }).success).toBe(false)
  expect(projectTemplateSavePayloadSchema.safeParse({ ...draft, isCommercial: true }).success).toBe(false)
  expect(projectTemplateSavePayloadSchema.safeParse({ ...draft, name: '' }).success).toBe(false)
})
it('deactivated defaults do not prevent automatic project creation', async () => {
  const { repository: r } = await setup()
  const template = r.listProjectTemplates().find(t => t.id === 'template-ai-tutorial')!
  r.saveProjectTemplate({ ...draft, ...template, recommendedVideoFormats: [], recommendedProjectKinds: [], isActive: false })
  expect(r.createProject({ title: 'AI无默认模板', description: '', contentTypeId: 'type-ai', platformTargets: [] }).id).toBeTruthy()
})
