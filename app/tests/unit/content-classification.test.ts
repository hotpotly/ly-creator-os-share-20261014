import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { runMigrations, runMigrationsThrough } from '../../src/main/db/migrations'
import { seedWorkspace } from '../../src/main/db/seed'
import { projectUpdateClassificationPayloadSchema, RESPONSE_SCHEMAS } from '../../src/shared/ipc'
import { projectKindLabel } from '../../src/shared/content-classification'

const roots: string[] = [], stores: WorkspaceStore[] = []
async function setup(): Promise<WorkspaceStore> {
  const parent = join(import.meta.dirname, '../../test-results/unit'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'classification-')); roots.push(root)
  const store = await openWorkspaceStore(root); stores.push(store); return store
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
describe('R10h independent content classification', () => {
  it('migrates legacy categories without modifying business, stages, drafts, resources or templates', () => {
    const db = new BetterSqlite3(':memory:'); db.pragma('foreign_keys=ON')
    try {
      runMigrationsThrough(db, '0094_r21ac_stage_plan_baselines'); seedWorkspace(db, true, true)
      db.prepare("UPDATE preferences SET value_json=json_set(value_json,'$.defaultContentTypeId','type-commercial') WHERE key='workspace'").run()
      const tables = ['business_records', 'stage_time_records', 'schedule_items', 'draft_versions', 'project_modules', 'project_resource_references']
      const before = tables.map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())
      const legacy = db.prepare('SELECT id,content_type_id,applied_template_id FROM projects').all() as Array<{ id: string; content_type_id: string; applied_template_id: string }>
      runMigrations(db)
      tables.forEach((table, index) => expect(db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).toEqual(table === 'schedule_items' ? before[index]!.map(row => ({ ...(row as object), group_id: null })) : before[index]))
      for (const row of legacy) {
        expect(db.prepare('SELECT content_type_id,video_format,is_commercial,applied_template_id FROM projects WHERE id=?').get(row.id)).toEqual({
          content_type_id: ['type-commercial', 'type-quick'].includes(row.content_type_id) ? 'type-undetermined' : row.content_type_id,
          video_format: row.content_type_id === 'type-quick' ? 'short' : null,
          is_commercial: row.content_type_id === 'type-commercial' ? 1 : 0, applied_template_id: row.applied_template_id
        })
      }
      expect(db.prepare("SELECT json_extract(value_json,'$.defaultContentTypeId') value FROM preferences WHERE key='workspace'").get()).toEqual({ value: 'type-undetermined' })
      expect(db.prepare('SELECT count(*) n FROM topics t JOIN projects p ON t.created_project_id=p.id WHERE t.video_format IS NOT p.video_format OR t.is_commercial<>p.is_commercial').get()).toEqual({ n: 0 })
      const history = db.prepare('SELECT * FROM project_content_type_history').all()
      runMigrations(db)
      expect(db.prepare('SELECT * FROM project_content_type_history').all()).toEqual(history)
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('preserves custom same-name IDs and safely initializes both new builtins', () => {
    const db = new BetterSqlite3(':memory:')
    try {
      runMigrationsThrough(db, '0094_r21ac_stage_plan_baselines'); seedWorkspace(db, true, false)
      for (const [id, name] of [['custom-unbox', '开箱'], ['custom-unknown', '待定方向']]) db.prepare("INSERT INTO content_types(id,name,sort_order,is_active,created_at,updated_at) VALUES(?,?,99,1,'now','now')").run(id, name)
      runMigrations(db)
      expect(db.prepare("SELECT name FROM content_types WHERE id='custom-unbox'").get()).toEqual({ name: '开箱' })
      expect(db.prepare("SELECT name FROM content_types WHERE id='type-unboxing'").get()).toEqual({ name: '开箱（内置）' })
      expect(db.prepare("SELECT name FROM content_types WHERE id='type-undetermined'").get()).toEqual({ name: '待定方向（内置）' })
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('supports all AI video and kind combinations, retaining business data when changing direction or kind', async () => {
    const { repository: r } = await setup()
    for (const videoFormat of ['long', 'short'] as const) for (const isCommercial of [false, true]) {
      const project = r.createProject({ title: 'AI产品体验', description: '', contentTypeId: 'type-ai', videoFormat, isCommercial, platformTargets: [], templateId: 'template-ai-tutorial' })
      expect(project).toMatchObject({ contentTypeId: 'type-ai', videoFormat, isCommercial })
      expect(project.modules.find(m => m.key === 'business')?.enabled ?? false).toBe(isCommercial)
      expect(RESPONSE_SCHEMAS.projectDetailSchema.safeParse(project).success).toBe(true)
      const before = r.native.prepare('SELECT * FROM project_modules WHERE project_id=?').all(project.id)
      const changed = r.updateProjectContentType(project.id, 'type-unboxing')
      expect(changed).toMatchObject({ videoFormat, isCommercial, appliedTemplateId: project.appliedTemplateId })
      expect(r.native.prepare('SELECT * FROM project_modules WHERE project_id=?').all(project.id)).toEqual(before)
      if (isCommercial) {
        const business = r.native.prepare('SELECT * FROM business_records WHERE project_id=?').get(project.id)
        r.updateProjectClassification(project.id, { isCommercial: false })
        expect(r.native.prepare('SELECT * FROM business_records WHERE project_id=?').get(project.id)).toEqual(business)
        r.updateProjectClassification(project.id, { isCommercial: true })
        expect(r.native.prepare('SELECT * FROM business_records WHERE project_id=?').get(project.id)).toEqual(business)
      }
    }
    expect(projectKindLabel(false)).toBe('普通')
    expect(() => r.updateContentType('type-commercial', { isActive: true })).toThrow('旧分类已迁移')
    expect(r.getProject('sponsor', false).contentTypeHistory.some(row => row.previousContentTypeName === '商单')).toBe(true)
  })
  it('keeps topic classification through promotion and synchronizes edits in both directions', async () => {
    const { repository: r } = await setup()
    const topic = r.createTopic({ title: 'AI短视频合作', coreAngle: '', contentTypeId: 'type-ai', videoFormat: 'short', isCommercial: true, importanceLevel: 0, needsMoreExperience: false, stageId: 'topic-stage-new', startAt: null, expectedCompletionAt: null, actualCompletionAt: null })
    const project = r.createProjectFromTopic(topic.id)
    expect(project).toMatchObject({ contentTypeId: 'type-ai', videoFormat: 'short', isCommercial: true })
    r.updateTopic(topic.id, { videoFormat: 'long', isCommercial: false, contentTypeId: 'type-unboxing' })
    expect(r.getProject(project.id, false)).toMatchObject({ contentTypeId: 'type-unboxing', videoFormat: 'long', isCommercial: false })
    r.updateProjectClassification(project.id, { videoFormat: null, isCommercial: true })
    expect(r.getSnapshot().topics.find(t => t.id === topic.id)).toMatchObject({ videoFormat: null, isCommercial: true })
    expect(projectUpdateClassificationPayloadSchema.safeParse({ projectId: project.id, patch: { videoFormat: 'AI' } }).success).toBe(false)
    expect(projectUpdateClassificationPayloadSchema.safeParse({ projectId: project.id, patch: {} }).success).toBe(false)
  })
  it('normalizes old creation requests while new unspecified formats remain unknown', async () => {
    const { repository: r } = await setup()
    const base = { title: '旧入口', description: '', platformTargets: [] }
    expect(r.createProject({ ...base, contentTypeId: 'type-commercial' })).toMatchObject({ contentTypeId: 'type-undetermined', isCommercial: true, videoFormat: null, appliedTemplateId: 'template-commercial' })
    expect(r.createProject({ ...base, contentTypeId: 'type-quick' })).toMatchObject({ contentTypeId: 'type-undetermined', isCommercial: false, videoFormat: 'short', appliedTemplateId: 'template-quick-content' })
    expect(r.createProject({ ...base, contentTypeId: 'type-ai' })).toMatchObject({ videoFormat: null, isCommercial: false })
  })
})
