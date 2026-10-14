// Immutable phase-level planning evidence. It survives schedule edits/deletion,
// but follows project deletion. Existing dates are labelled as adoption snapshots.
const eligible = `project_id IS NOT NULL AND trip_json IS NULL AND action_type IN ('materials','outline','script','production','shooting','editing','postproduction','publishing','versions') AND (start_at IS NOT NULL OR end_at IS NOT NULL)`
const snapshot = `json_group_array(json_object('id',id,'projectId',project_id,'actionType',action_type,'startAt',start_at,'endAt',end_at,'scheduleKind',schedule_kind))`
const capture = `INSERT OR IGNORE INTO stage_plan_baselines(project_id,stage_key,source,captured_at,schedules_json)
  SELECT project_id,action_type,'first_saved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),${snapshot}
  FROM schedule_items WHERE ${eligible} AND project_id=NEW.project_id AND action_type=NEW.action_type GROUP BY project_id,action_type;`
export const stagePlanBaselineStatements = [
  `CREATE TABLE stage_plan_baselines (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_key TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('first_saved','legacy')), captured_at TEXT NOT NULL, schedules_json TEXT NOT NULL CHECK(json_valid(schedules_json)), PRIMARY KEY(project_id,stage_key))`,
  `INSERT INTO stage_plan_baselines(project_id,stage_key,source,captured_at,schedules_json)
    SELECT project_id,action_type,'legacy',strftime('%Y-%m-%dT%H:%M:%fZ','now'),${snapshot}
    FROM schedule_items WHERE ${eligible} GROUP BY project_id,action_type`,
  `CREATE TRIGGER stage_plan_baseline_insert AFTER INSERT ON schedule_items BEGIN ${capture} END`,
  `CREATE TRIGGER stage_plan_baseline_update AFTER UPDATE OF start_at,end_at,action_type,project_id,schedule_kind ON schedule_items BEGIN ${capture} END`
]
