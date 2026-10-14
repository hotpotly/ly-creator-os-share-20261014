const todoFields: Record<string, string> = {
  id: 'id', title: 'title', plannedDate: 'planned_date', segment: 'segment', category: 'category',
  projectId: 'project_id', stageKey: 'stage_key', stageLinkSource: 'stage_link_source', status: 'status',
  trackingMode: 'tracking_mode', progress: 'progress', progressBeforeComplete: 'progress_before_complete',
  source: 'source', sourceScheduleId: 'source_schedule_id', sourcePlannedDate: 'source_planned_date',
  sourceSegment: 'source_segment', completedAt: 'completed_at', dismissedAt: 'dismissed_at',
  createdAt: 'created_at', updatedAt: 'updated_at'
}

function todoProjection(row: string): { data: string; metadata: string } {
  const fields = Object.entries(todoFields).map(([key, column]) => `'${key}',${row}.${column}`).join(',')
  const todo = `json_object(${fields},'isExtra',json(CASE WHEN ${row}.is_extra THEN 'true' ELSE 'false' END),'scheduleSyncEnabled',json(CASE WHEN ${row}.schedule_sync_enabled THEN 'true' ELSE 'false' END),'dateRange',json(${row}.date_range_json))`
  const editable = `${row}.source='manual' AND ${row}.date_range_json IS NULL`
  return {
    data: `json_object('title',${row}.title,'category',${row}.category,'plannedDate',${row}.planned_date,'completedAt',${row}.completed_at)`,
    metadata: `json_object('todo',${todo},'editableFields',json(CASE WHEN ${editable} THEN '["title","category","plannedDate","completedAt"]' ELSE '[]' END),'deletable',json(CASE WHEN ${editable} THEN 'true' ELSE 'false' END))`
  }
}

function logProjection(row: string, deleted = false): { data: string; metadata: string } {
  return {
    data: `json_object('minutes',${deleted ? 'NULL' : `COALESCE(${row}.total_minutes,${row}.self_media_minutes+${row}.ai_minutes+${row}.other_work_minutes)`})`,
    metadata: `json_object('day',${row}.day,'totalMinutes',${row}.total_minutes,'selfMediaMinutes',${row}.self_media_minutes,'aiMinutes',${row}.ai_minutes,'otherWorkMinutes',${row}.other_work_minutes,'updatedAt',${row}.updated_at)`
  }
}

function capture(kind: 'todo' | 'work_log', row: string, deleted = false): string {
  const id = `${row}.${kind === 'todo' ? 'id' : 'day'}`
  const projection = kind === 'todo' ? todoProjection(row) : logProjection(row, deleted)
  const removed = deleted ? '1' : kind === 'todo' ? `CASE WHEN ${row}.status='dismissed' THEN 1 ELSE 0 END` : '0'
  return `INSERT INTO workspace_sync_changes(kind,entity_id,revision,deleted,data_json,metadata_json)
    SELECT '${kind}',${id},COALESCE((SELECT MAX(revision) FROM workspace_sync_changes WHERE kind='${kind}' AND entity_id=${id}),0)+1,${removed},${projection.data},${projection.metadata}`
}

export const workspaceSyncStatements: string[] = [
  `CREATE TABLE workspace_sync_changes (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('todo','work_log')),
    entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0),
    deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
    data_json TEXT NOT NULL CHECK(json_valid(data_json)),
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
    UNIQUE(kind,entity_id,revision)
  )`,
  `CREATE INDEX workspace_sync_entity_latest ON workspace_sync_changes(kind,entity_id,revision DESC)`,
  `CREATE TRIGGER workspace_sync_changes_immutable BEFORE UPDATE ON workspace_sync_changes BEGIN SELECT RAISE(ABORT,'workspace history is immutable'); END`,
  `CREATE TRIGGER workspace_sync_changes_retained BEFORE DELETE ON workspace_sync_changes BEGIN SELECT RAISE(ABORT,'workspace history must be retained'); END`,
  `CREATE TABLE workspace_sync_devices (device_id TEXT PRIMARY KEY NOT NULL REFERENCES mobile_sync_devices(id), counter INTEGER NOT NULL CHECK(counter>0))`,
  `CREATE TABLE workspace_sync_receipts (device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),PRIMARY KEY(device_id,operation_id))`,
  `${capture('todo', 'todo_items')} FROM todo_items ORDER BY created_at,id`,
  `${capture('work_log', 'daily_work_logs')} FROM daily_work_logs ORDER BY day`,
  ...(['todo', 'work_log'] as const).flatMap(kind => {
    const table = kind === 'todo' ? 'todo_items' : 'daily_work_logs'
    return ['INSERT', 'UPDATE', 'DELETE'].map(event =>
      `CREATE TRIGGER workspace_sync_${kind}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ${capture(kind, event === 'DELETE' ? 'OLD' : 'NEW', event === 'DELETE')}; END`)
  })
]
