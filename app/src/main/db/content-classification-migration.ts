import type BetterSqlite3 from 'better-sqlite3'

/** Also called after an empty workspace is seeded. Never infer a subject from titles. */
export function normalizeContentClassification(database: BetterSqlite3.Database): void {
  if (!(database.pragma('table_info(projects)') as Array<{ name: string }>).some(column => column.name === 'video_format')) return
  if (!(database.prepare('SELECT count(*) n FROM content_types').get() as { n: number }).n) return
  // Preserve custom IDs/names if the user already created a same-named direction.
  for (const [id, name, description, order, template] of [
    ['type-unboxing', '开箱', '产品开箱与初次体验，可为长视频、短视频或商单。', 45, 'template-digital-review'],
    ['type-undetermined', '待定方向', '题材尚未明确；形式和项目类型单独填写。', 90, null]
  ] as const) {
    if (database.prepare('SELECT id FROM content_types WHERE id=?').get(id)) continue
    let availableName: string = name
    for (let suffix = 1; database.prepare('SELECT id FROM content_types WHERE name=?').get(availableName); suffix++) availableName = `${name}（内置${suffix === 1 ? '' : suffix}）`
    database.prepare('INSERT INTO content_types(id,name,description,sort_order,is_active,default_project_template_id,created_at,updated_at) VALUES(?,?,?,?,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(id, availableName, description, order, template)
  }
  database.exec(`
    INSERT INTO project_content_type_history(id,project_id,previous_content_type_id,next_content_type_id,source,created_at)
      SELECT lower(hex(randomblob(16))),id,content_type_id,'type-undetermined','system',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE content_type_id IN ('type-commercial','type-quick');
    UPDATE projects SET is_commercial=1 WHERE content_type_id='type-commercial';
    UPDATE projects SET video_format='short' WHERE content_type_id='type-quick';
    UPDATE topics SET is_commercial=1 WHERE content_type_id='type-commercial';
    UPDATE topics SET video_format='short' WHERE content_type_id='type-quick';
    UPDATE projects SET content_type_id='type-undetermined' WHERE content_type_id IN ('type-commercial','type-quick');
    UPDATE topics SET content_type_id='type-undetermined' WHERE content_type_id IN ('type-commercial','type-quick');
    UPDATE topics SET video_format=(SELECT video_format FROM projects WHERE id=topics.created_project_id),is_commercial=(SELECT is_commercial FROM projects WHERE id=topics.created_project_id) WHERE created_project_id IN (SELECT id FROM projects);
    INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) SELECT 'topic-column-video','视频形式',COALESCE(MAX(position),0)+10,'relation','video',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM topic_column_definitions;
    INSERT OR IGNORE INTO topic_column_definitions(id,name,position,data_type,builtin_key,is_visible,created_at,updated_at) SELECT 'topic-column-kind','项目类型',COALESCE(MAX(position),0)+10,'relation','kind',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM topic_column_definitions;
    UPDATE content_types SET is_active=0 WHERE id IN ('type-commercial','type-quick');
    UPDATE project_templates SET recommended_content_type_ids_json='[]' WHERE id IN ('template-commercial','template-quick-content');
    UPDATE preferences SET value_json=json_set(value_json,'$.defaultContentTypeId','type-undetermined') WHERE key='workspace' AND json_extract(value_json,'$.defaultContentTypeId') IN ('type-commercial','type-quick');
  `)
}
export const contentClassificationStatements = [
  `ALTER TABLE projects ADD COLUMN video_format TEXT CHECK(video_format IN ('long','short') OR video_format IS NULL)`,
  `ALTER TABLE projects ADD COLUMN is_commercial INTEGER NOT NULL DEFAULT 0 CHECK(is_commercial IN (0,1))`,
  `ALTER TABLE topics ADD COLUMN video_format TEXT CHECK(video_format IN ('long','short') OR video_format IS NULL)`,
  `ALTER TABLE topics ADD COLUMN is_commercial INTEGER NOT NULL DEFAULT 0 CHECK(is_commercial IN (0,1))`
]
