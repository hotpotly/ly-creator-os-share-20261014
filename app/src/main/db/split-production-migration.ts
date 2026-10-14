import type BetterSqlite3 from 'better-sqlite3'

/** Rebuild only constrained parent tables, retaining every row, index and trigger.
 * The migration runner disables FK actions outside the transaction and verifies
 * all references before commit, so child audit/snapshot records cannot cascade.
 */
export function splitProductionStages(db: BetterSqlite3.Database): void {
  for (const table of ['stage_time_records', 'todo_items']) {
    const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string }
    const dependents = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table) as { sql: string }[]
    const next = `${table}_r21p`
    const create = definition.sql.replace(new RegExp(`CREATE TABLE (?:"${table}"|${table})`), `CREATE TABLE ${next}`)
      .replace(/'production'/g, "'production','shooting','editing'")
    db.exec(create)
    db.exec(`INSERT INTO ${next} SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${next} RENAME TO ${table}`)
    for (const { sql } of dependents) db.exec(sql)
  }
  // Template JSON is rewritten structurally, including custom templates.
  const templates = db.prepare('SELECT id,module_keys_json FROM project_templates').all() as { id: string; module_keys_json: string }[]
  for (const template of templates) {
    const keys = JSON.parse(template.module_keys_json) as string[]
    const next = [...new Set(keys.flatMap(key => key === 'production' ? ['shooting', 'editing'] : [key]))]
    db.prepare('UPDATE project_templates SET module_keys_json=? WHERE id=?').run(JSON.stringify(next), template.id)
  }
  const old = db.prepare(`SELECT m.*,p.status AS project_status FROM project_modules m JOIN projects p ON p.id=m.project_id WHERE m.module_key='production'`).all() as { project_id: string; enabled: number; position: number; project_status: string }[]
  for (const row of old) {
    const enabled = row.enabled && !['published', 'archived'].includes(row.project_status) ? 1 : 0
    db.prepare('UPDATE project_modules SET position=position+2 WHERE project_id=? AND position>?').run(row.project_id, row.position)
    for (const [index, key] of ['shooting', 'editing'].entries()) {
      db.prepare(`INSERT OR IGNORE INTO project_modules(project_id,module_key,enabled,position,disabled_at,completed_at,last_changed_by,content_root_id) VALUES(?,?,?,?,CASE WHEN ?=1 THEN NULL ELSE datetime('now') END,NULL,'system',lower(hex(randomblob(16))))`).run(row.project_id, key, enabled, row.position + index, enabled)
      db.prepare(`INSERT OR IGNORE INTO stage_time_records(id,project_id,stage_key,status,created_at,updated_at) VALUES(lower(hex(randomblob(16))),?,?,'not_started',datetime('now'),datetime('now'))`).run(row.project_id, key)
    }
    // Preserve all legacy facts and their IDs, only demote its normal navigation.
    db.prepare(`UPDATE project_modules SET enabled=0,disabled_at=COALESCE(disabled_at,datetime('now')),position=position+2 WHERE project_id=? AND module_key='production'`).run(row.project_id)
  }
}
