const projection = (row: string) => `SELECT ${row}.kind,${row}.entity_id,
  COALESCE((SELECT MAX(revision) FROM workspace_v2_changes WHERE kind=${row}.kind AND entity_id=${row}.entity_id),0)+1,
  ${row}.deleted,CASE WHEN ${row}.kind='todo' THEN json_extract(${row}.metadata_json,'$.todo') ELSE ${row}.metadata_json END,
  CASE WHEN ${row}.kind='todo' THEN json_extract(${row}.metadata_json,'$.todo.source') ELSE NULL END`

export const workspaceV2Statements: string[] = [
  `CREATE TABLE workspace_v2_changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),deleted INTEGER NOT NULL CHECK(deleted IN(0,1)),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),source TEXT,UNIQUE(kind,entity_id,revision))`,
  `CREATE INDEX workspace_v2_latest ON workspace_v2_changes(kind,entity_id,revision DESC)`,
  `CREATE TRIGGER workspace_v2_changes_immutable BEFORE UPDATE ON workspace_v2_changes BEGIN SELECT RAISE(ABORT,'v2 history is immutable'); END`,
  `CREATE TRIGGER workspace_v2_changes_retained BEFORE DELETE ON workspace_v2_changes BEGIN SELECT RAISE(ABORT,'v2 history must be retained'); END`,
  `INSERT INTO workspace_v2_changes(kind,entity_id,revision,deleted,payload_json,source) SELECT kind,entity_id,revision,deleted,CASE WHEN kind='todo' THEN json_extract(metadata_json,'$.todo') ELSE metadata_json END,CASE WHEN kind='todo' THEN json_extract(metadata_json,'$.todo.source') ELSE NULL END FROM workspace_sync_changes ORDER BY sequence`,
  `CREATE TRIGGER workspace_v2_capture AFTER INSERT ON workspace_sync_changes BEGIN INSERT INTO workspace_v2_changes(kind,entity_id,revision,deleted,payload_json,source) ${projection('NEW')}; END`,
  `CREATE TABLE workspace_v2_hashes(sequence INTEGER PRIMARY KEY REFERENCES workspace_v2_changes(sequence),sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL)`,
  `CREATE TABLE workspace_v2_devices(device_id TEXT PRIMARY KEY REFERENCES mobile_sync_devices(id),counter INTEGER NOT NULL CHECK(counter>0))`,
  `CREATE TABLE workspace_v2_receipts(device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),PRIMARY KEY(device_id,operation_id))`,
  `CREATE TABLE workspace_v2_grants(device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),scope TEXT NOT NULL,write_allowed INTEGER NOT NULL CHECK(write_allowed IN(0,1)),approved_at TEXT NOT NULL,PRIMARY KEY(device_id,scope))`,
  `CREATE TABLE workspace_v2_cursor_bindings(device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),scope_digest TEXT NOT NULL,max_cursor INTEGER NOT NULL,PRIMARY KEY(device_id,scope_digest))`,
  `CREATE TABLE workspace_v2_windows(device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),scope_digest TEXT NOT NULL,through INTEGER NOT NULL,PRIMARY KEY(device_id,scope_digest,through))`,
  `CREATE TABLE workspace_v2_upload_keys(device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),upload_id TEXT NOT NULL,declaration_hash TEXT NOT NULL,session_id TEXT NOT NULL,PRIMARY KEY(device_id,upload_id))`,
  `CREATE TABLE workspace_v2_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
  `CREATE TABLE workspace_v2_manifests(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),scope_digest TEXT NOT NULL,scopes_json TEXT NOT NULL,through INTEGER NOT NULL,entity_count INTEGER NOT NULL,entries_sha256 TEXT NOT NULL,expires_at INTEGER NOT NULL,token_key BLOB NOT NULL)`,
  `CREATE TABLE workspace_v2_manifest_entries(manifest_id TEXT NOT NULL REFERENCES workspace_v2_manifests(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,sequence INTEGER NOT NULL REFERENCES workspace_v2_changes(sequence),metadata_json TEXT NOT NULL,PRIMARY KEY(manifest_id,ordinal),UNIQUE(manifest_id,sequence))`,
  `CREATE TABLE workspace_v2_uploads(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id),upload_id TEXT NOT NULL,declaration_hash TEXT NOT NULL,scope TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,purpose TEXT NOT NULL,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(byte_length>0),media_type TEXT NOT NULL,created_at INTEGER NOT NULL,last_activity INTEGER NOT NULL,committed_at INTEGER,UNIQUE(device_id,upload_id))`,
  `CREATE TABLE workspace_v2_chunks(session_id TEXT NOT NULL REFERENCES workspace_v2_uploads(id) ON DELETE CASCADE,chunk_index INTEGER NOT NULL,sha256 TEXT NOT NULL,nonce BLOB NOT NULL,tag BLOB NOT NULL,ciphertext BLOB NOT NULL,PRIMARY KEY(session_id,chunk_index))`,
  `CREATE TABLE workspace_v2_blob_links(scope TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,sha256 TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES workspace_v2_uploads(id),PRIMARY KEY(kind,entity_id,revision,sha256))`
]
