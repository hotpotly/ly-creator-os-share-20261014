import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { DEFAULT_TODO_CATEGORY_COLORS, DEFAULT_TODO_CATEGORY_LABELS, DEFAULT_TODO_CATEGORY_WEIGHTS, TODO_CATEGORY_ORDER } from '../../shared/domain'
import { WORKSPACE_DOMAIN_V2_STAGE_KEYS } from '../../shared/workspace-domain-v2'
import { mapStageTimeRecord } from './stage-time-record'
import type * as schema from './schema'

export function workspaceV2StageRevision(record: ReturnType<typeof mapStageTimeRecord> | null, enabled: boolean, completedAt: string | null): string {
  return createHash('sha256').update(JSON.stringify({ record, enabled, completedAt })).digest('hex')
}
function stringifyProjection(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && !Number.isFinite(item)
    ? (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON(item < 0 ? '-1e400' : '1e400') : item)
}
export function workspaceV2TodoPreferences(value: string): string {
  let stored: Record<string, unknown> = {}
  try {
    const parse = JSON.parse as (text: string, reviver: (key: string, item: unknown, context: { source?: string }) => unknown) => unknown
    const parsed = parse(value, (_key, item, context) => typeof item === 'number' && (!Number.isFinite(item) || Math.abs(item) > Number.MAX_SAFE_INTEGER)
      ? (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON(context.source!) : item)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch { stored = {} }
  const mapping = (key: string): Record<string, unknown> => stored[key] && typeof stored[key] === 'object' && !Array.isArray(stored[key]) ? stored[key] as Record<string, unknown> : {}
  const labels = mapping('todoCategoryLabels'), colors = mapping('todoCategoryColors'), weights = mapping('todoCategoryWeights')
  return stringifyProjection({
    todoCategoryLabels: Object.fromEntries(TODO_CATEGORY_ORDER.map(category => [category, (typeof labels[category] === 'string' ? labels[category].trim().slice(0, 16) : '') || DEFAULT_TODO_CATEGORY_LABELS[category]])),
    todoCategoryColors: Object.fromEntries(TODO_CATEGORY_ORDER.map(category => [category, colors[category] ?? DEFAULT_TODO_CATEGORY_COLORS[category]])),
    todoCategoryWeights: Object.fromEntries(TODO_CATEGORY_ORDER.map(category => [category, Object.hasOwn(weights, category) ? weights[category] : DEFAULT_TODO_CATEGORY_WEIGHTS[category]])),
    companionTodoView: stored.companionTodoView ?? 'all', companionTodoOrder: stored.companionTodoOrder ?? []
  })
}
export function registerWorkspaceV2ProjectionFunctions(db: Database.Database): void {
  db.function('workspace_v2_preferences_json', { deterministic: true }, (value: unknown) => workspaceV2TodoPreferences(String(value)))
  db.function('workspace_v2_catalog_json', { deterministic: true }, (projectJson: unknown, stagesJson: unknown) => {
    const stages = (JSON.parse(String(stagesJson)) as { key: string; enabled: boolean; completedAt: string | null; record: typeof schema.stageTimeRecords.$inferSelect | null }[]).map(stage => {
      const record = stage.record ? mapStageTimeRecord(stage.record) : null
      return { key: stage.key, enabled: stage.enabled, completedAt: stage.completedAt, status: record?.status ?? 'not_started', revision: workspaceV2StageRevision(record, stage.enabled, stage.completedAt) }
    })
    return JSON.stringify({ ...JSON.parse(String(projectJson)), stages })
  })
}
const stageColumns = ['id', 'projectId', 'stageKey', 'status', 'startedDate', 'startedSegment', 'completedDate', 'completedSegment', 'startSource', 'completionSource', 'actualEffortHalfDayUnits', 'plannedStartedDate', 'plannedStartedSegment', 'plannedCompletedDate', 'plannedCompletedSegment', 'estimatedDurationHalfDayUnits', 'planManualFieldsJson', 'planAutoField', 'autoStartActionId', 'createdAt', 'updatedAt']
const rawStage = `json_object(${stageColumns.map(key => `'${key}',r.${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`).join(',')})`
const projectJson = `json_object('id',p.id,'title',p.title,'status',p.status,'topicStageRole',(SELECT COALESCE(d.system_role,d.role) FROM topics t JOIN topic_stage_definitions d ON d.id=t.stage_id WHERE t.created_project_id=p.id ORDER BY t.rowid DESC LIMIT 1),'trashedAt',p.trashed_at,'ledgerOnly',json(CASE WHEN p.ledger_only THEN 'true' ELSE 'false' END))`
const stagesJson = `(SELECT json_group_array(json(item)) FROM (SELECT json_object('key',m.module_key,'enabled',json(CASE WHEN m.enabled THEN 'true' ELSE 'false' END),'completedAt',m.completed_at,'record',json(CASE WHEN r.id IS NULL THEN 'null' ELSE ${rawStage} END)) AS item FROM project_modules m LEFT JOIN stage_time_records r ON r.project_id=m.project_id AND r.stage_key=m.module_key WHERE m.project_id=p.id AND m.module_key IN(${WORKSPACE_DOMAIN_V2_STAGE_KEYS.map(key => `'${key}'`).join(',')}) ORDER BY m.position,m.module_key))`
const append = (kind: string, source: string, condition = '1') => `INSERT INTO workspace_v2_changes(kind,entity_id,revision,deleted,payload_json,source) SELECT '${kind}',v.entity_id,COALESCE((SELECT MAX(revision) FROM workspace_v2_changes WHERE kind='${kind}' AND entity_id=v.entity_id),0)+1,0,v.payload_json,NULL FROM ${source} v WHERE (${condition}) AND NOT EXISTS(SELECT 1 FROM workspace_v2_changes old WHERE old.kind='${kind}' AND old.entity_id=v.entity_id AND old.revision=(SELECT MAX(revision) FROM workspace_v2_changes WHERE kind='${kind}' AND entity_id=v.entity_id) AND old.deleted=0 AND old.payload_json=v.payload_json)`
const catalogAppend = (condition: string) => append('project_catalog', 'workspace_v2_catalog_projection', `${condition} AND NOT EXISTS(SELECT 1 FROM workspace_v2_catalog_deleting d WHERE d.id=v.entity_id)`)
const prefsAppend = append('todo_preferences', 'workspace_v2_preferences_projection')
export const workspaceV2DomainStatements = [
  `ALTER TABLE workspace_v2_uploads ADD COLUMN consumed_at INTEGER`,
  `ALTER TABLE workspace_v2_upload_keys ADD COLUMN declaration_json TEXT CHECK(declaration_json IS NULL OR json_valid(declaration_json))`,
  `UPDATE workspace_v2_upload_keys SET declaration_json=(SELECT json_object('scope',u.scope,'entity',json_object('kind',u.kind,'id',u.entity_id),'purpose',u.purpose,'sha256',u.sha256,'byteLength',u.byte_length,'mediaType',u.media_type) FROM workspace_v2_uploads u WHERE u.id=workspace_v2_upload_keys.session_id)`,
  `CREATE INDEX workspace_v2_upload_key_sessions ON workspace_v2_upload_keys(device_id,session_id)`,
  `CREATE VIEW workspace_v2_catalog_projection AS SELECT p.id AS entity_id,workspace_v2_catalog_json(${projectJson},${stagesJson}) AS payload_json FROM projects p`,
  `CREATE VIEW workspace_v2_preferences_projection AS SELECT 'workspace' AS entity_id,workspace_v2_preferences_json(COALESCE((SELECT value_json FROM preferences WHERE key='workspace'),'{}')) AS payload_json`,
  `CREATE TABLE workspace_v2_catalog_deleting(id TEXT PRIMARY KEY)`,
  catalogAppend('1'), prefsAppend,
  ...(['INSERT', 'UPDATE'] as const).map(event => `CREATE TRIGGER workspace_v2_catalog_project_${event.toLowerCase()} AFTER ${event} ON projects BEGIN ${catalogAppend('v.entity_id=NEW.id')}; END`),
  `CREATE TRIGGER workspace_v2_catalog_project_before_delete BEFORE DELETE ON projects BEGIN INSERT OR IGNORE INTO workspace_v2_catalog_deleting(id) VALUES(OLD.id); INSERT INTO workspace_v2_changes(kind,entity_id,revision,deleted,payload_json,source) SELECT 'project_catalog',entity_id,COALESCE((SELECT MAX(revision) FROM workspace_v2_changes WHERE kind='project_catalog' AND entity_id=OLD.id),0)+1,1,payload_json,NULL FROM workspace_v2_catalog_projection WHERE entity_id=OLD.id; END`,
  `CREATE TRIGGER workspace_v2_catalog_project_after_delete AFTER DELETE ON projects BEGIN DELETE FROM workspace_v2_catalog_deleting WHERE id=OLD.id; END`,
  ...(['project_modules', 'stage_time_records'] as const).flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(event => `CREATE TRIGGER workspace_v2_catalog_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ${catalogAppend(`v.entity_id=${event === 'DELETE' ? 'OLD' : 'NEW'}.project_id`)}; ${event === 'UPDATE' ? catalogAppend('v.entity_id=OLD.project_id') + ';' : ''} END`)),
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(event => `CREATE TRIGGER workspace_v2_catalog_topics_${event.toLowerCase()} AFTER ${event} ON topics BEGIN ${catalogAppend(`v.entity_id=${event === 'DELETE' ? 'OLD' : 'NEW'}.created_project_id`)}; ${event === 'UPDATE' ? catalogAppend('v.entity_id=OLD.created_project_id') + ';' : ''} END`),
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(event => `CREATE TRIGGER workspace_v2_catalog_stage_def_${event.toLowerCase()} AFTER ${event} ON topic_stage_definitions BEGIN ${catalogAppend('1')}; END`),
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(event => `CREATE TRIGGER workspace_v2_preferences_${event.toLowerCase()} AFTER ${event} ON preferences WHEN ${event === 'DELETE' ? 'OLD' : 'NEW'}.key='workspace' BEGIN ${prefsAppend}; END`)
]
