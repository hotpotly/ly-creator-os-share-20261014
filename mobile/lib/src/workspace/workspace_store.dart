import 'dart:convert';

import 'package:cryptography/dart.dart' show DartSha256;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';

import '../storage/capture_payload_cipher.dart';
import 'workspace_models.dart';
import 'workspace_sync_models.dart';
import 'workspace_snapshot_guard.dart';
import 'workspace_upgrade_guard.dart';
import 'workspace_v2_contract.dart';
import 'workspace_domain_v2.dart';

part 'workspace_sync_store.dart';
part 'workspace_v2_persistence.dart';
part 'workspace_v2_incremental.dart';
part 'workspace_v2_permissions.dart';

abstract interface class WorkspaceStore {
  Future<List<WorkspaceRecord>> load();
  Future<WorkspaceRecord> save(WorkspaceRecord record);
  Future<List<WorkspaceRecord>> saveAll(List<WorkspaceRecord> records);
  Future<int> pendingCount();
  Future<void> close();
}

abstract interface class WorkspaceSyncStore {
  Future<Map<String, dynamic>> syncStatus();
  Future<void> bindSync(String workspaceId, String deviceId);
  Future<void> setSyncEnabled(bool enabled);
  Future<Map<String, dynamic>> prepareSyncRequest({
    int operationLimit = workspaceSyncBatchLimit,
  });
  Future<void> applySyncResponse(
    Map<String, dynamic> requestPayload,
    Map<String, dynamic> response,
  );
  Future<void> resolveSyncConflict(
    String kind,
    String id, {
    required bool keepLocal,
    int? expectedLocalRevision,
    int? expectedRemoteRevision,
  });
}

class SqliteWorkspaceStore
    with
        _WorkspaceSyncPersistence,
        _WorkspaceV2Persistence,
        _WorkspaceV2Incremental,
        _WorkspaceV2Permissions
    implements
        WorkspaceStore,
        WorkspaceSyncStore,
        WorkspaceV2Persistence,
        WorkspaceV2Store,
        WorkspaceV2PermissionStore {
  SqliteWorkspaceStore._(this._database, this._cipher, this._now);
  @override
  final Database _database;
  @override
  final CapturePayloadCipher _cipher;
  @override
  final DateTime Function() _now;

  static Future<void> _createSyncTables(DatabaseExecutor db) async {
    await db.execute(
      'ALTER TABLE workspace_outbox ADD COLUMN base_payload TEXT',
    );
    await db.execute(
      'CREATE TABLE workspace_sync_baselines(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
    );
    await db.execute(
      'CREATE TABLE workspace_sync_inflight(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL,local_revision INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(kind,entity_id))',
    );
    await db.execute(
      'CREATE TABLE workspace_sync_conflicts(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
    );
    await db.execute(
      'CREATE TABLE workspace_sync_state(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)',
    );
  }

  static Future<SqliteWorkspaceStore> create({
    DatabaseFactory? factory,
    String? databasePath,
    CapturePayloadCipher? cipher,
    DateTime Function()? now,
  }) async {
    final database = await (factory ?? databaseFactory).openDatabase(
      databasePath ??
          path.join(await getDatabasesPath(), 'ly_creator_workspace.sqlite'),
      options: OpenDatabaseOptions(
        version: 5,
        onConfigure: (db) async {
          await db.rawQuery('PRAGMA journal_mode=WAL');
          await db.execute('PRAGMA synchronous=FULL');
        },
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE workspace_records(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
          );
          await db.execute(
            'CREATE TABLE workspace_outbox(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL,base_revision INTEGER NOT NULL,local_revision INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(kind,entity_id))',
          );
          await _createSyncTables(db);
          await _createV2Tables(db);
          await _createV2IncrementalTables(db);
          await _createV2PermissionTables(db);
        },
        onUpgrade: (db, oldVersion, _) async {
          if (oldVersion < 2) {
            final invalid =
                Sqflite.firstIntValue(
                  await db.rawQuery(
                    'SELECT COUNT(*) FROM workspace_records r LEFT JOIN workspace_outbox o ON r.kind=o.kind AND r.id=o.entity_id WHERE o.operation_id IS NULL OR o.local_revision != r.revision',
                  ),
                ) ??
                0;
            final orphan =
                Sqflite.firstIntValue(
                  await db.rawQuery(
                    'SELECT COUNT(*) FROM workspace_outbox o LEFT JOIN workspace_records r ON r.kind=o.kind AND r.id=o.entity_id WHERE r.id IS NULL',
                  ),
                ) ??
                0;
            if (invalid != 0 || orphan != 0) {
              throw const FormatException('旧工作区变更队列不完整');
            }
            await _createSyncTables(db);
            await db.update('workspace_outbox', {
              'base_revision': 0,
            }, where: "kind IN ('todo','work_log')");
          }
          if (oldVersion < 3) await _createV2Tables(db);
          if (oldVersion < 4) await _createV2IncrementalTables(db);
          if (oldVersion < 5) await _createV2PermissionTables(db);
        },
      ),
    );
    try {
      final selectedCipher =
          cipher ??
          SecureCapturePayloadCipher(
            keyName: 'creator_workspace_database_key_v1',
            allowLegacyPlaintext: false,
            storage: const FlutterSecureStorage(
              aOptions: AndroidOptions(
                resetOnError: false,
                migrateOnAlgorithmChange: true,
                migrateWithBackup: true,
                storageNamespace: 'ly_creator_workspace',
              ),
            ),
          );
      final count =
          Sqflite.firstIntValue(
            await database.rawQuery(
              'SELECT (SELECT COUNT(*) FROM workspace_records) + (SELECT COUNT(*) FROM workspace_outbox) + (SELECT COUNT(*) FROM workspace_sync_baselines) + (SELECT COUNT(*) FROM workspace_sync_inflight) + (SELECT COUNT(*) FROM workspace_sync_conflicts) + (SELECT COUNT(*) FROM workspace_sync_state) + (SELECT COUNT(*) FROM workspace_v2_state) + (SELECT COUNT(*) FROM workspace_v2_stage) + (SELECT COUNT(*) FROM workspace_v2_records) + (SELECT COUNT(*) FROM workspace_v2_json_chunks) + (SELECT COUNT(*) FROM workspace_v2_pages) + (SELECT COUNT(*) FROM workspace_v2_staged_records) + (SELECT COUNT(*) FROM workspace_v2_baselines) + (SELECT COUNT(*) FROM workspace_v2_json_objects) + (SELECT COUNT(*) FROM workspace_v2_outbox) + (SELECT COUNT(*) FROM workspace_v2_live) + (SELECT COUNT(*) FROM workspace_v2_response) + (SELECT COUNT(*) FROM workspace_v2_pending) + (SELECT COUNT(*) FROM workspace_v2_inflight) + (SELECT COUNT(*) FROM workspace_v2_conflicts) + (SELECT COUNT(*) FROM workspace_v2_blocked) + (SELECT COUNT(*) FROM workspace_v2_uploads) + (SELECT COUNT(*) FROM workspace_v2_history) + (SELECT COUNT(*) FROM workspace_v2_permission_state) + (SELECT COUNT(*) FROM workspace_v2_permission_pages) + (SELECT COUNT(*) FROM workspace_v2_permission_records)',
            ),
          ) ??
          0;
      await selectedCipher.prepare(hasEncryptedData: count > 0);
      final store = SqliteWorkspaceStore._(
        database,
        selectedCipher,
        now ?? DateTime.now,
      );
      await database.transaction((txn) async {
        await store._loadV1Archive(txn);
        await store._recoverV2(txn);
      });
      return store;
    } catch (_) {
      await database.close();
      rethrow;
    }
  }

  @override
  Future<List<WorkspaceRecord>> load() => _database.transaction((txn) async {
    await _assertV1Records(txn);
    return _loadV1Archive(txn);
  });

  Future<List<WorkspaceRecord>> _loadV1Archive(DatabaseExecutor txn) async {
    final rows = await txn.query('workspace_records', orderBy: 'rowid');
    final result = <WorkspaceRecord>[];
    for (final row in rows) {
      final record = await _decodeLocal(row);
      if (record.kind != row['kind'] ||
          record.id != row['id'] ||
          record.revision != row['revision']) {
        throw const FormatException('本地工作区记录校验失败');
      }
      result.add(record);
    }
    for (final row in await txn.query('workspace_outbox')) {
      final record = await _decodeLocal(row);
      final entity = result
          .where((r) => r.kind == row['kind'] && r.id == row['entity_id'])
          .firstOrNull;
      if (entity == null ||
          record.revision != row['local_revision'] ||
          !workspaceJsonEqual(record.toJson(), entity.toJson()) ||
          !workspaceSyncInteger(row['base_revision']) ||
          !workspaceSyncUuid(row['operation_id'])) {
        throw const FormatException('工作区待同步队列校验失败');
      }
      if (workspaceSyncKinds.contains(record.kind)) {
        final base = row['base_payload'] == null
            ? null
            : await _decode(row['base_payload'] as String);
        workspaceValidateOperation({
          'operationId': row['operation_id'],
          'kind': record.kind,
          'id': record.id,
          'localRevision': record.revision,
          'baseRevision': row['base_revision'],
          'base': base,
          'next': workspaceSnapshot(record),
        });
      }
    }
    await _validateSyncRows(txn, result);
    return result;
  }

  @override
  Future<WorkspaceRecord> save(WorkspaceRecord record) async =>
      (await saveAll([record])).single;

  @override
  Future<List<WorkspaceRecord>> saveAll(List<WorkspaceRecord> records) async {
    final inputs = records
        .map(
          (record) => WorkspaceRecord.fromJson(
            workspaceSyncMap(jsonDecode(jsonEncode(record.toJson()))),
          ),
        )
        .toList();
    if (inputs.map((r) => '${r.kind}:${r.id}').toSet().length !=
        inputs.length) {
      throw const FormatException('同一批次不能重复写入同一记录');
    }
    return _database.transaction((txn) async {
      if (inputs.any((record) => workspaceSyncKinds.contains(record.kind))) {
        await _assertV1Records(txn);
      }
      final saved = <WorkspaceRecord>[];
      for (final record in inputs) {
        final current = await _local(txn, record.kind, record.id);
        if ((current?.revision ?? 0) != record.revision) {
          throw const WorkspaceConflict();
        }
        final baseline = await _baseline(txn, record.kind, record.id);
        workspaceValidateLocalChange(
          current,
          record,
          permissions: baseline == null
              ? null
              : workspaceSyncMap(baseline['metadata']),
        );
        final next = record.copy(
          revision: record.revision + 1,
          metadata: current?.metadata ?? const {},
        );
        await _writeLocal(txn, next);
        final pending = await _pending(txn, record.kind, record.id);
        await _writePending(
          txn,
          next,
          operationId: pending?['operation_id'] as String?,
          baseRevision:
              pending?['base_revision'] as int? ??
              baseline?['revision'] as int? ??
              0,
          base: pending == null
              ? _remoteSnapshot(baseline)
              : pending['base_payload'] == null
              ? null
              : await _decode(pending['base_payload'] as String),
        );
        final conflict = await _conflict(txn, record.kind, record.id);
        if (conflict != null) {
          await _writeConflict(txn, next, workspaceSyncMap(conflict['remote']));
        }
        saved.add(next);
      }
      if (saved.any((record) => workspaceSyncKinds.contains(record.kind))) {
        await _noteV1Mutation(txn);
      }
      return saved;
    });
  }

  @override
  Future<int> pendingCount() async =>
      Sqflite.firstIntValue(
        await _database.rawQuery(
          'SELECT COUNT(*) FROM (SELECT kind,entity_id FROM workspace_outbox UNION SELECT kind,entity_id FROM workspace_sync_inflight)',
        ),
      ) ??
      0;

  @override
  Future<void> close() => _database.close();
}
