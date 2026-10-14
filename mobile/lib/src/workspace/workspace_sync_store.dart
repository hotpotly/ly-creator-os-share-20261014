part of 'workspace_store.dart';

mixin _WorkspaceSyncPersistence implements WorkspaceSyncStore {
  Database get _database;
  CapturePayloadCipher get _cipher;
  Future<void> _assertV1Transport(DatabaseExecutor db);
  Future<void> _assertV1Records(DatabaseExecutor db);
  Future<void> _noteV1Mutation(DatabaseExecutor db);
  Future<void> _cancelV2Stage(DatabaseExecutor db);

  Future<Map<String, dynamic>> _decode(String payload) async =>
      workspaceSyncMap(jsonDecode(await _cipher.decrypt(payload)));
  Future<String> _encode(Map<String, dynamic> value) =>
      _cipher.encrypt(jsonEncode(value));
  Future<WorkspaceRecord> _decodeLocal(Map<String, Object?> row) async =>
      WorkspaceRecord.fromJson(await _decode(row['payload'] as String));

  Future<Map<String, Object?>?> _row(
    DatabaseExecutor db,
    String table,
    String kind,
    String id, {
    bool entityId = false,
  }) async {
    final rows = await db.query(
      table,
      where: 'kind=? AND ${entityId ? 'entity_id' : 'id'}=?',
      whereArgs: [kind, id],
    );
    return rows.firstOrNull;
  }

  Future<WorkspaceRecord?> _local(
    DatabaseExecutor db,
    String kind,
    String id,
  ) async {
    final row = await _row(db, 'workspace_records', kind, id);
    return row == null ? null : _decodeLocal(row);
  }

  Future<Map<String, Object?>?> _pending(
    DatabaseExecutor db,
    String kind,
    String id,
  ) => _row(db, 'workspace_outbox', kind, id, entityId: true);

  Future<Map<String, dynamic>?> _baseline(
    DatabaseExecutor db,
    String kind,
    String id,
  ) async {
    final row = await _row(db, 'workspace_sync_baselines', kind, id);
    return row == null ? null : _decode(row['payload'] as String);
  }

  Future<Map<String, dynamic>?> _conflict(
    DatabaseExecutor db,
    String kind,
    String id,
  ) async {
    final row = await _row(db, 'workspace_sync_conflicts', kind, id);
    return row == null ? null : _decode(row['payload'] as String);
  }

  Map<String, dynamic>? _remoteSnapshot(Map<String, dynamic>? remote) =>
      remote == null
      ? null
      : {'deleted': remote['deleted'], 'data': remote['data']};

  Future<void> _writeLocal(DatabaseExecutor db, WorkspaceRecord record) async {
    await db.insert('workspace_records', {
      'kind': record.kind,
      'id': record.id,
      'revision': record.revision,
      'payload': await _encode(record.toJson()),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> _writePending(
    DatabaseExecutor db,
    WorkspaceRecord record, {
    String? operationId,
    required int baseRevision,
    required Map<String, dynamic>? base,
  }) async {
    await db.insert('workspace_outbox', {
      'operation_id': operationId ?? workspaceId(),
      'kind': record.kind,
      'entity_id': record.id,
      'base_revision': baseRevision,
      'local_revision': record.revision,
      'payload': await _encode(record.toJson()),
      'base_payload': base == null ? null : await _encode(base),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> _writeConflict(
    DatabaseExecutor db,
    WorkspaceRecord local,
    Map<String, dynamic> remote,
  ) async {
    await db.insert('workspace_sync_conflicts', {
      'kind': local.kind,
      'id': local.id,
      'payload': await _encode({
        'kind': local.kind,
        'id': local.id,
        'local': local.toJson(),
        'remote': remote,
      }),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<Map<String, dynamic>> _state(DatabaseExecutor db) async {
    final rows = await db.query('workspace_sync_state');
    final state = rows.isEmpty
        ? <String, dynamic>{
            'enabled': false,
            'workspaceId': null,
            'deviceId': null,
            'cursor': 0,
            'through': null,
            'counter': 0,
          }
        : await _decode(rows.single['payload'] as String);
    workspaceSyncFields(state, {
      'enabled',
      'workspaceId',
      'deviceId',
      'cursor',
      'through',
      'counter',
    });
    if (state['enabled'] is! bool ||
        !workspaceSyncInteger(state['cursor']) ||
        !workspaceSyncInteger(state['counter']) ||
        (state['through'] != null &&
            (!workspaceSyncInteger(state['through']) ||
                (state['through'] as int) < (state['cursor'] as int))) ||
        ((state['workspaceId'] == null) != (state['deviceId'] == null)) ||
        (state['workspaceId'] != null &&
            (!workspaceSyncUuid(state['workspaceId']) ||
                !workspaceSyncUuid(state['deviceId']))) ||
        (state['workspaceId'] == null &&
            (state['enabled'] == true ||
                state['cursor'] != 0 ||
                state['counter'] != 0 ||
                state['through'] != null))) {
      throw const FormatException('工作区同步状态无效');
    }
    return state;
  }

  Future<void> _writeState(
    DatabaseExecutor db,
    Map<String, dynamic> state,
  ) async {
    await db.insert('workspace_sync_state', {
      'id': 1,
      'payload': await _encode(state),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> _validateSyncRows(
    DatabaseExecutor db,
    List<WorkspaceRecord> records,
  ) async {
    final state = await _state(db);
    final baselines = <String, Map<String, dynamic>>{};
    final flights = <String, Map<String, dynamic>>{};
    final pendingKeys = {
      for (final row in await db.query('workspace_outbox'))
        '${row['kind']}:${row['entity_id']}',
    };
    for (final row in await db.query('workspace_sync_baselines')) {
      final remote = await _decode(row['payload'] as String);
      final record = workspaceRemoteRecord(remote);
      baselines['${record.kind}:${record.id}'] = remote;
      if (record.kind != row['kind'] ||
          record.id != row['id'] ||
          state['workspaceId'] == null ||
          !records.any(
            (local) => local.kind == record.kind && local.id == record.id,
          )) {
        throw const FormatException('同步基线校验失败');
      }
    }
    for (final row in await db.query('workspace_sync_inflight')) {
      final operation = workspaceValidateOperation(
        await _decode(row['payload'] as String),
      );
      flights['${operation['kind']}:${operation['id']}'] = operation;
      final local = records
          .where((r) => r.kind == row['kind'] && r.id == row['entity_id'])
          .firstOrNull;
      if (state['workspaceId'] == null ||
          local == null ||
          operation['operationId'] != row['operation_id'] ||
          operation['kind'] != row['kind'] ||
          operation['id'] != row['entity_id'] ||
          operation['localRevision'] != row['local_revision'] ||
          local.revision < (operation['localRevision'] as int)) {
        throw const FormatException('在途同步操作校验失败');
      }
    }
    for (final record in records) {
      final key = '${record.kind}:${record.id}';
      if (pendingKeys.contains(key)) continue;
      final flight = flights[key];
      final baseline = baselines[key];
      if (flight != null) {
        if (flight['localRevision'] != record.revision ||
            !workspaceJsonEqual(flight['next'], workspaceSnapshot(record))) {
          throw const FormatException('在途操作的后继变更队列缺失');
        }
      } else if (baseline == null ||
          !workspaceJsonEqual(
            _remoteSnapshot(baseline),
            workspaceSnapshot(record),
          ) ||
          !workspaceJsonEqual(baseline['metadata'], record.metadata)) {
        throw const FormatException('工作区变更队列或同步基线缺失');
      }
    }
    for (final row in await db.query('workspace_sync_conflicts')) {
      final conflict = await _decode(row['payload'] as String);
      workspaceSyncFields(conflict, {'kind', 'id', 'local', 'remote'});
      final local = WorkspaceRecord.fromJson(
        workspaceSyncMap(conflict['local']),
      );
      final remote = workspaceRemoteRecord(
        workspaceSyncMap(conflict['remote']),
      );
      final current = records
          .where((r) => r.kind == row['kind'] && r.id == row['id'])
          .firstOrNull;
      if (state['workspaceId'] == null ||
          conflict['kind'] != row['kind'] ||
          conflict['id'] != row['id'] ||
          local.kind != row['kind'] ||
          local.id != row['id'] ||
          remote.kind != row['kind'] ||
          remote.id != row['id'] ||
          current == null ||
          !workspaceJsonEqual(current.toJson(), local.toJson())) {
        throw const FormatException('同步冲突记录校验失败');
      }
    }
  }

  @override
  Future<Map<String, dynamic>> syncStatus() => _database.transaction((
    txn,
  ) async {
    final state = await _state(txn);
    final conflicts = <Map<String, dynamic>>[];
    for (final row in await txn.query(
      'workspace_sync_conflicts',
      orderBy: 'rowid',
    )) {
      conflicts.add(await _decode(row['payload'] as String));
    }
    final count =
        Sqflite.firstIntValue(
          await txn.rawQuery(
            "SELECT COUNT(*) FROM (SELECT kind,entity_id FROM workspace_outbox WHERE kind IN ('todo','work_log') UNION SELECT kind,entity_id FROM workspace_sync_inflight)",
          ),
        ) ??
        0;
    final sendable =
        Sqflite.firstIntValue(
          await txn.rawQuery(
            "SELECT COUNT(*) FROM (SELECT kind,entity_id FROM workspace_outbox WHERE kind IN ('todo','work_log') UNION SELECT kind,entity_id FROM workspace_sync_inflight) q WHERE NOT EXISTS (SELECT 1 FROM workspace_sync_conflicts c WHERE c.kind=q.kind AND c.id=q.entity_id)",
          ),
        ) ??
        0;
    return {
      ...state,
      'pendingCount': count,
      'sendableCount': sendable,
      'conflicts': conflicts,
    };
  });

  @override
  Future<void> bindSync(String workspaceId, String deviceId) async {
    if (!workspaceSyncUuid(workspaceId) || !workspaceSyncUuid(deviceId)) {
      throw const FormatException('工作区绑定身份无效');
    }
    await _database.transaction((txn) async {
      final state = await _state(txn);
      if (state['workspaceId'] != null &&
          (state['workspaceId'] != workspaceId ||
              state['deviceId'] != deviceId)) {
        throw StateError('此工作区已绑定其他电脑或设备身份，原记录与队列已保留');
      }
      await _writeState(txn, {
        ...state,
        'enabled': true,
        'workspaceId': workspaceId,
        'deviceId': deviceId,
      });
    });
  }

  @override
  Future<void> setSyncEnabled(bool enabled) async {
    await _database.transaction((txn) async {
      final state = await _state(txn);
      if (enabled && state['workspaceId'] == null) {
        throw StateError('请先绑定电脑工作区');
      }
      await _writeState(txn, {...state, 'enabled': enabled});
      if (!enabled) await _cancelV2Stage(txn);
    });
  }

  @override
  Future<Map<String, dynamic>> prepareSyncRequest({
    int operationLimit = workspaceSyncBatchLimit,
  }) => _database.transaction((txn) async {
    await _assertV1Transport(txn);
    final state = await _state(txn);
    if (state['enabled'] != true) throw StateError('工作台同步未开启');
    if (operationLimit < 1 || operationLimit > workspaceSyncBatchLimit) {
      throw const FormatException('同步批次大小无效');
    }
    if ((state['counter'] as int) >= 9007199254740991) {
      throw StateError('同步计数已达上限');
    }
    final operations = <Map<String, dynamic>>[];
    final request = <String, dynamic>{
      'protocolVersion': 1,
      'workspaceId': state['workspaceId'],
      'deviceId': state['deviceId'],
      'cursor': state['cursor'],
      'through': state['through'],
      'operations': operations,
    };
    for (final row in await txn.query(
      'workspace_sync_inflight',
      orderBy: 'rowid',
      limit: operationLimit,
    )) {
      operations.add(
        workspaceValidateOperation(await _decode(row['payload'] as String)),
      );
    }
    if (state['through'] == null) {
      final rows = await txn.rawQuery(
        "SELECT o.* FROM workspace_outbox o LEFT JOIN workspace_sync_inflight f ON o.kind=f.kind AND o.entity_id=f.entity_id LEFT JOIN workspace_sync_conflicts c ON o.kind=c.kind AND o.entity_id=c.id WHERE o.kind IN ('todo','work_log') AND f.operation_id IS NULL AND c.id IS NULL ORDER BY o.rowid",
      );
      for (final row in rows) {
        if (operations.length >= operationLimit) break;
        final local = await _decodeLocal(row);
        final operation = workspaceValidateOperation({
          'operationId': row['operation_id'],
          'kind': local.kind,
          'id': local.id,
          'localRevision': local.revision,
          'baseRevision': row['base_revision'],
          'base': row['base_payload'] == null
              ? null
              : await _decode(row['base_payload'] as String),
          'next': workspaceSnapshot(local),
        });
        operations.add(operation);
        if (utf8.encode(jsonEncode(request)).length > workspaceSyncByteLimit) {
          operations.removeLast();
          if (operations.isEmpty) {
            throw const FormatException('单条待同步内容超过256KiB，原记录已保留');
          }
          break;
        }
        await txn.insert('workspace_sync_inflight', {
          'operation_id': operation['operationId'],
          'kind': local.kind,
          'entity_id': local.id,
          'local_revision': local.revision,
          'payload': await _encode(operation),
        });
        await txn.delete(
          'workspace_outbox',
          where: 'operation_id=? AND local_revision=?',
          whereArgs: [row['operation_id'], local.revision],
        );
      }
    }
    workspaceValidateRequest(request);
    final counter = (state['counter'] as int) + 1;
    await _writeState(txn, {...state, 'counter': counter});
    return {'counter': counter, 'payload': request};
  });

  Future<bool> _writeBaseline(
    DatabaseExecutor db,
    Map<String, dynamic> remote,
  ) async {
    final current = await _baseline(
      db,
      remote['kind'] as String,
      remote['id'] as String,
    );
    if (current != null) {
      if ((remote['revision'] as int) < (current['revision'] as int)) {
        return false;
      }
      if (remote['revision'] == current['revision']) {
        if (!workspaceJsonEqual(current, remote)) {
          throw const FormatException('相同远端版本内容不一致');
        }
        return false;
      }
      if ((remote['sequence'] as int) <= (current['sequence'] as int)) {
        throw const FormatException('远端版本序列回退');
      }
    }
    await db.insert('workspace_sync_baselines', {
      'kind': remote['kind'],
      'id': remote['id'],
      'payload': await _encode(remote),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    return true;
  }

  Future<void> _acceptReceipt(
    DatabaseExecutor db,
    Map<String, dynamic> operation,
    Map<String, dynamic> receipt,
  ) async {
    final kind = operation['kind'] as String;
    final id = operation['id'] as String;
    final current = await _local(db, kind, id);
    if (current == null ||
        current.revision < (operation['localRevision'] as int)) {
      throw const FormatException('同步回执没有对应本地版本');
    }
    final remote = workspaceSyncMap(receipt['record']);
    await _writeBaseline(db, remote);
    final latest = (await _baseline(db, kind, id))!;
    final pending = await _pending(db, kind, id);
    if (receipt['status'] == 'conflict') {
      await _writeConflict(db, current, latest);
      if (pending == null) {
        await _writePending(
          db,
          current,
          baseRevision: latest['revision'] as int,
          base: _remoteSnapshot(latest),
        );
      }
    } else if (pending == null) {
      await _writeLocal(
        db,
        workspaceRemoteRecord(latest, localRevision: current.revision + 1),
      );
    } else {
      if ((pending['local_revision'] as int) <=
          (operation['localRevision'] as int)) {
        throw const FormatException('后继待同步版本无效');
      }
      final sent = workspaceSyncMap(operation['next']);
      final sentData = workspaceSyncMap(sent['data']);
      final remoteData = workspaceSyncMap(remote['data']);
      final merged = <String, dynamic>{...remoteData};
      for (final key in current.data.keys) {
        if (!workspaceJsonEqual(current.data[key], sentData[key])) {
          merged[key] = current.data[key];
        }
      }
      final next = WorkspaceRecord.fromJson({
        'kind': kind,
        'id': id,
        'revision': current.revision + 1,
        'deleted':
            current.deleted != sent['deleted'] ||
                !workspaceJsonEqual(current.data, sentData)
            ? current.deleted
            : remote['deleted'],
        'data': merged,
        'metadata': latest['metadata'],
      });
      await _writeLocal(db, next);
      await _writePending(
        db,
        next,
        operationId: pending['operation_id'] as String,
        baseRevision: remote['revision'] as int,
        base: _remoteSnapshot(remote),
      );
    }
    await db.delete(
      'workspace_sync_inflight',
      where: 'operation_id=? AND local_revision=?',
      whereArgs: [operation['operationId'], operation['localRevision']],
    );
  }

  Future<void> _applyRemote(
    DatabaseExecutor db,
    Map<String, dynamic> remote,
  ) async {
    final changed = await _writeBaseline(db, remote);
    if (!changed) return;
    final kind = remote['kind'] as String;
    final id = remote['id'] as String;
    final current = await _local(db, kind, id);
    final conflict = await _conflict(db, kind, id);
    if (conflict != null) {
      if (current == null) throw const FormatException('缺少本地冲突内容');
      await _writeConflict(db, current, remote);
      return;
    }
    final pending = await _pending(db, kind, id);
    final inflight = await _row(
      db,
      'workspace_sync_inflight',
      kind,
      id,
      entityId: true,
    );
    if (pending != null || inflight != null) return;
    await _writeLocal(
      db,
      workspaceRemoteRecord(
        remote,
        localRevision: (current?.revision ?? 0) + 1,
      ),
    );
  }

  @override
  Future<void> applySyncResponse(
    Map<String, dynamic> requestPayload,
    Map<String, dynamic> response,
  ) async {
    final request = workspaceSyncMap(jsonDecode(jsonEncode(requestPayload)));
    final received = workspaceSyncMap(jsonDecode(jsonEncode(response)));
    workspaceValidateResponse(request, received);
    await _database.transaction((txn) async {
      await _assertV1Transport(txn);
      final state = await _state(txn);
      if (state['workspaceId'] != request['workspaceId'] ||
          state['deviceId'] != request['deviceId'] ||
          state['cursor'] != request['cursor'] ||
          state['through'] != request['through']) {
        throw const FormatException('响应不属于当前工作区或同步页');
      }
      if (request['through'] == null) {
        for (final row in await txn.query(
          'workspace_sync_baselines',
          columns: ['payload'],
        )) {
          final baseline = await _decode(row['payload'] as String);
          if ((received['through'] as int) < (baseline['sequence'] as int)) {
            throw const FormatException('电脑工作区历史已回退，本机数据已保留');
          }
        }
      }
      final operations = <String, Map<String, dynamic>>{};
      for (final value in request['operations'] as List) {
        final operation = workspaceSyncMap(value);
        final rows = await txn.query(
          'workspace_sync_inflight',
          where: 'operation_id=?',
          whereArgs: [operation['operationId']],
        );
        if (rows.length != 1 ||
            !workspaceJsonEqual(
              await _decode(rows.single['payload'] as String),
              operation,
            )) {
          throw const FormatException('同步回执不能确认未发送或已改变的操作');
        }
        operations[operation['operationId'] as String] = operation;
      }
      for (final value in received['receipts'] as List) {
        final receipt = workspaceSyncMap(value);
        await _acceptReceipt(txn, operations[receipt['operationId']]!, receipt);
      }
      for (final value in received['changes'] as List) {
        await _applyRemote(txn, workspaceSyncMap(value));
      }
      await _writeState(txn, {
        ...state,
        'cursor': received['cursor'],
        'through': received['hasMore'] == true ? received['through'] : null,
      });
    });
  }

  @override
  Future<void> resolveSyncConflict(
    String kind,
    String id, {
    required bool keepLocal,
    int? expectedLocalRevision,
    int? expectedRemoteRevision,
  }) async {
    await _database.transaction((txn) async {
      await _assertV1Records(txn);
      final conflict = await _conflict(txn, kind, id);
      if (conflict == null) throw StateError('同步冲突已处理或不存在');
      final current = await _local(txn, kind, id);
      if (current == null) throw const FormatException('缺少本地冲突内容');
      final remote =
          (await _baseline(txn, kind, id)) ??
          workspaceSyncMap(conflict['remote']);
      if ((expectedLocalRevision != null &&
              expectedLocalRevision != current.revision) ||
          (expectedRemoteRevision != null &&
              expectedRemoteRevision != remote['revision'])) {
        throw const WorkspaceConflict();
      }
      final remoteRecord = workspaceRemoteRecord(
        remote,
        localRevision: current.revision + 1,
      );
      await txn.delete(
        'workspace_sync_inflight',
        where: 'kind=? AND entity_id=?',
        whereArgs: [kind, id],
      );
      await txn.delete(
        'workspace_outbox',
        where: 'kind=? AND entity_id=?',
        whereArgs: [kind, id],
      );
      if (keepLocal &&
          kind == 'todo' &&
          remoteRecord.deleted &&
          !current.deleted) {
        if (!workspaceCanCopyDeletedTodo(current, remoteRecord)) {
          throw const FormatException('此待办请在电脑端恢复');
        }
        final copy = WorkspaceRecord(
          kind: 'todo',
          id: workspaceId(),
          data: current.data,
          revision: 1,
        );
        await _writeLocal(txn, remoteRecord);
        await _writeLocal(txn, copy);
        await _writePending(txn, copy, baseRevision: 0, base: null);
      } else if (keepLocal) {
        final next = WorkspaceRecord.fromJson({
          ...current.toJson(),
          'revision': current.revision + 1,
          'metadata': remoteRecord.metadata,
        });
        workspaceValidateLocalChange(
          remoteRecord,
          next,
          permissions: remoteRecord.metadata,
        );
        await _writeLocal(txn, next);
        await _writePending(
          txn,
          next,
          baseRevision: remote['revision'] as int,
          base: _remoteSnapshot(remote),
        );
      } else {
        await _writeLocal(txn, remoteRecord);
      }
      await txn.delete(
        'workspace_sync_conflicts',
        where: 'kind=? AND id=?',
        whereArgs: [kind, id],
      );
      await _noteV1Mutation(txn);
    });
  }
}
