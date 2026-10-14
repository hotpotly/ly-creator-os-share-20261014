part of 'workspace_store.dart';

class WorkspaceV2PrepareTooLarge implements Exception {
  const WorkspaceV2PrepareTooLarge();
  @override
  String toString() => '同步批次过大';
}

abstract interface class WorkspaceV2Store {
  Future<Map<String, dynamic>> loadV2Workspace();
  Future<void> invalidateV2Capabilities();
  Future<void> refreshV2Capabilities(
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  );
  Future<Map<String, dynamic>> saveV2Todo(
    Map<String, dynamic> command,
    int expectedLocalRevision,
  );
  Future<List<Map<String, dynamic>>> saveV2Todos(
    List<Map<String, dynamic>> commands,
  );
  Future<Map<String, dynamic>> saveV2WorkLog(
    Map<String, dynamic> command,
    int expectedLocalRevision,
  );
  Future<Map<String, dynamic>> prepareV2Sync({int operationLimit = 100});
  Future<Map<String, dynamic>> loadV2UploadChunk(
    String operationId,
    String sha256,
    int index,
  );
  Future<void> saveV2UploadCheckpoint(
    String operationId,
    String sha256,
    Map<String, dynamic> checkpoint,
  );
  Future<void> resetV2Upload(
    String operationId,
    String sha256, {
    required String reason,
  });
  Future<void> markV2UploadCommitted(
    String operationId,
    String sha256,
    Map<String, dynamic> response,
  );
  Future<Map<String, dynamic>> stageV2SyncResponse(
    Map<String, dynamic> request,
    Map<String, dynamic> response, {
    String? permissionContext,
  });
  Future<void> putV2ResponseJsonChunk(
    String responseId, {
    required String sha256,
    required int index,
    required List<int> bytes,
    required String chunkHash,
  });
  Future<void> commitV2SyncResponse(String responseId);
  Future<Map<String, dynamic>> loadV2BlockedPreview(String kind, String id);
  Future<void> discardV2Blocked(
    String kind,
    String id, {
    required int expectedLocalRevision,
    required String expectedOperationId,
    required int expectedRemoteRevision,
  });
  Future<String?> resolveV2Conflict(
    String kind,
    String id, {
    required bool keepLocal,
    required int expectedLocalRevision,
    required int expectedRemoteRevision,
  });
}

Future<void> _createV2IncrementalTables(DatabaseExecutor db) async {
  for (final table in ['live', 'response']) {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS workspace_v2_$table(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)',
    );
  }
  for (final table in ['pending', 'inflight', 'conflicts', 'blocked']) {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS workspace_v2_$table(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
    );
  }
  await db.execute(
    'CREATE TABLE IF NOT EXISTS workspace_v2_history(id TEXT PRIMARY KEY,payload TEXT NOT NULL)',
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS workspace_v2_uploads(id TEXT PRIMARY KEY,payload TEXT NOT NULL)',
  );
}

mixin _WorkspaceV2Incremental on _WorkspaceV2Persistence
    implements WorkspaceV2Store {
  Map<String, dynamic> _copyV2(Map<String, dynamic> value) =>
      workspaceV2Map(jsonDecode(jsonEncode(value)));
  Future<Map<String, dynamic>?> _singleV2(
    DatabaseExecutor db,
    String table,
  ) async {
    final rows = await db.query('workspace_v2_$table');
    return rows.isEmpty ? null : _decode(rows.single['payload'] as String);
  }

  Future<void> _putSingleV2(
    DatabaseExecutor db,
    String table,
    Map<String, dynamic> value,
  ) async {
    await db.insert('workspace_v2_$table', {
      'id': 1,
      'payload': await _encode(value),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<Map<String, dynamic>?> _entityV2(
    DatabaseExecutor db,
    String table,
    String kind,
    String id,
  ) async {
    final rows = await db.query(
      'workspace_v2_$table',
      where: 'kind=? AND id=?',
      whereArgs: [kind, id],
    );
    if (rows.isEmpty) return null;
    final value = await _decode(rows.single['payload'] as String);
    if (value['kind'] != kind || value['id'] != id) {
      throw const FormatException('完整实体索引损坏');
    }
    return value;
  }

  Future<List<Map<String, dynamic>>> _entitiesV2(
    DatabaseExecutor db,
    String table,
  ) async {
    final result = <Map<String, dynamic>>[];
    for (final row in await db.query(
      'workspace_v2_$table',
      orderBy: 'kind,id',
    )) {
      result.add(
        (await _entityV2(
          db,
          table,
          row['kind'] as String,
          row['id'] as String,
        ))!,
      );
    }
    return result;
  }

  Future<void> _putEntityV2(
    DatabaseExecutor db,
    String table,
    Map<String, dynamic> value,
  ) async {
    await db.insert('workspace_v2_$table', {
      'kind': value['kind'],
      'id': value['id'],
      'payload': await _encode(value),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> _deleteEntityV2(
    DatabaseExecutor db,
    String table,
    String kind,
    String id,
  ) => db.delete(
    'workspace_v2_$table',
    where: 'kind=? AND id=?',
    whereArgs: [kind, id],
  );
  Map<String, dynamic> _identityV2(Map<String, dynamic> live) => {
    'protocolVersion': 2,
    'workspaceId': live['workspaceId'],
    'deviceId': live['deviceId'],
  };
  int _nextV2Revision(int revision) {
    if (!workspaceV2SafeInteger(revision + 1, minimum: 1)) {
      throw StateError('本地修订计数已达上限');
    }
    return revision + 1;
  }

  Map<String, dynamic> _localV2(
    String kind,
    String id,
    int revision,
    String json,
    bool deleted,
    Map<String, dynamic> metadata,
  ) {
    final bytes = utf8.encode(json);
    if (bytes.length > workspaceV2JsonBytes) throw StateError('完整正文超过16MiB');
    workspaceV2Map(jsonDecode(json));
    return {
      'kind': kind,
      'id': id,
      'localRevision': revision,
      'json': json,
      'sha256': workspaceV2Sha256Sync(bytes),
      'deleted': deleted,
      'metadata': metadata,
    };
  }

  Map<String, dynamic> _payloadV2(String json) {
    final bytes = utf8.encode(json), hash = workspaceV2Sha256Sync(bytes);
    if (bytes.length > workspaceV2JsonBytes) throw StateError('完整正文超过16MiB');
    return bytes.length <= workspaceV2InlineBytes
        ? {
            'encoding': 'json',
            'json': json,
            'sha256': hash,
            'byteLength': bytes.length,
          }
        : {
            'encoding': 'blob',
            'ref': {
              'sha256': hash,
              'byteLength': bytes.length,
              'mediaType': 'application/json',
            },
          };
  }

  Future<Map<String, dynamic>> _liveV2(DatabaseExecutor db) async {
    final state = await _v2State(db);
    if (state['activeProtocol'] != 2) throw StateError('完整工作区尚未激活');
    var live = await _singleV2(db, 'live');
    if (live == null) {
      await super._recoverV2(db);
      final active = workspaceV2Map(state['active']),
          manifest = workspaceV2Map(active['manifest']);
      final records = await _v2Rows(db, 'workspace_v2_records');
      final caps = active['capabilitiesResponse'];
      live = {
        ..._identityV2(manifest),
        'scopes': manifest['scopes'],
        'scopeDigest': manifest['scopeDigest'],
        'cursor': manifest['through'],
        'through': null,
        'knownSequence': manifest['through'],
        'suspended': false,
        'capabilitiesRequest': active['capabilitiesRequest'],
        'capabilitiesResponse': caps,
      };
      for (final remote in records) {
        await _putEntityV2(
          db,
          'records',
          _localV2(
            remote['kind'] as String,
            remote['id'] as String,
            1,
            await _v2Body(db, remote),
            remote['deleted'] as bool,
            workspaceV2Map(remote['metadata']),
          ),
        );
      }
      await _putSingleV2(db, 'live', live);
    }
    workspaceV2Fields(live, {
      'protocolVersion',
      'workspaceId',
      'deviceId',
      'scopes',
      'scopeDigest',
      'cursor',
      'through',
      'knownSequence',
      'capabilitiesRequest',
      'capabilitiesResponse',
      'suspended',
    });
    final binding = await _state(db),
        manifest = workspaceV2Map((state['active'] as Map)['manifest']);
    if (live['protocolVersion'] != 2 ||
        live['workspaceId'] != binding['workspaceId'] ||
        live['deviceId'] != binding['deviceId'] ||
        live['scopeDigest'] != manifest['scopeDigest'] ||
        !workspaceJsonEqual(live['scopes'], manifest['scopes']) ||
        !workspaceV2SafeInteger(live['cursor']) ||
        !workspaceV2SafeInteger(live['knownSequence']) ||
        (live['knownSequence'] as int) < (live['cursor'] as int) ||
        live['through'] != null &&
            (!workspaceV2SafeInteger(live['through']) ||
                (live['through'] as int) < (live['cursor'] as int))) {
      throw const FormatException('活动同步状态损坏');
    }
    if (live['capabilitiesResponse'] != null) {
      _validateCapabilitiesV2(
        live,
        workspaceV2Map(live['capabilitiesRequest']),
        workspaceV2Map(live['capabilitiesResponse']),
      );
    }
    return live;
  }

  void _validateCapabilitiesV2(
    Map<String, dynamic> live,
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  ) {
    workspaceV2AssertCapabilities(request, response, [
      for (final scope in live['scopes'] as List)
        {'scope': scope, 'read': true, 'write': scope != 'project.catalog'},
    ]);
    if (request['workspaceId'] != live['workspaceId'] ||
        request['deviceId'] != live['deviceId'] ||
        !workspaceJsonEqual(response['supportedScopes'], live['scopes'])) {
      throw StateError('范围变更需要新的完整快照');
    }
  }

  @override
  Future<void> invalidateV2Capabilities() => _database.transaction((txn) async {
    final live = await _liveV2(txn);
    await _v2PermissionsChanged(txn, live, {
      ...live,
      'suspended': true,
    }, invalidated: true);
    await _putSingleV2(txn, 'live', {...live, 'suspended': true});
  });

  @override
  Future<void> refreshV2Capabilities(
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  ) async {
    final sent = _copyV2(request), received = _copyV2(response);
    await _database.transaction((txn) async {
      final live = await _liveV2(txn);
      workspaceV2AssertCapabilities(sent, received, [
        for (final scope in live['scopes'] as List)
          {'scope': scope, 'read': true, 'write': scope != 'project.catalog'},
      ]);
      _assertIdentityV2(live, sent);
      if (!workspaceJsonEqual(received['supportedScopes'], live['scopes'])) {
        await _v2PermissionsChanged(txn, live, {
          ...live,
          'suspended': true,
        }, invalidated: true);
        await _putSingleV2(txn, 'live', {...live, 'suspended': true});
        return;
      }
      _validateCapabilitiesV2(live, sent, received);
      await _v2PermissionsChanged(txn, live, {
        ...live,
        'capabilitiesResponse': received,
        'suspended': false,
      });
      await _putSingleV2(txn, 'live', {
        ...live,
        'capabilitiesRequest': sent,
        'capabilitiesResponse': received,
        'suspended': false,
      });
    });
  }

  bool _scopeWritableV2(Map<String, dynamic> live, String kind) =>
      live['suspended'] != true &&
      ((live['capabilitiesResponse'] as Map?)?['permissions'] as List? ?? [])
          .any(
            (p) =>
                p['scope'] == workspaceV2KindScopes[kind] && p['write'] == true,
          );
  Future<void> _v2PermissionsChanged(
    DatabaseExecutor db,
    Map<String, dynamic> oldLive,
    Map<String, dynamic> nextLive, {
    bool invalidated = false,
  }) async {}
  Future<Map<String, dynamic>> _effectiveV2Metadata(
    DatabaseExecutor db,
    Map<String, dynamic> live,
    Map<String, dynamic> local,
  ) async => workspaceV2Map(local['metadata']);
  Future<String?> _v2PreparePermissionOrigin(
    DatabaseExecutor db,
    Map<String, dynamic> request,
  ) async => null;
  Future<bool> _v2CurrentRequestPermissions(
    DatabaseExecutor db,
    Map<String, dynamic> request,
    String? context,
  ) async => false;
  Future<void> _v2ResponsePermissionOrigin(
    DatabaseExecutor db,
    String responseId,
    Map<String, dynamic> request,
    String? context,
  ) async {}
  Future<bool> _v2HistoricalPermissionResponse(
    DatabaseExecutor db,
    String responseId,
  ) async => false;
  Future<void> _v2ResponsePermissionsCommitted(
    DatabaseExecutor db,
    String responseId,
    List<Map<String, dynamic>> changes,
    Map<String, Map<String, dynamic>?> priorBaselines,
  ) async {}

  Future<void> _assertWriteV2(
    DatabaseExecutor db,
    Map<String, dynamic> live,
    String kind,
    Map<String, dynamic>? local, {
    bool deleting = false,
  }) async {
    if (!_scopeWritableV2(live, kind)) throw StateError('当前范围只读');
    if (local != null) {
      final metadata = await _effectiveV2Metadata(db, live, local);
      if (metadata['write'] != true ||
          deleting && metadata['deletable'] != true) {
        throw StateError('当前记录只读');
      }
    }
  }

  Map<String, dynamic> _newMetadataV2(String kind) => {
    'scope': workspaceV2KindScopes[kind],
    'read': true,
    'write': true,
    'deletable': true,
    'editableFields': kind == 'todo'
        ? workspaceDomainV2TodoUnits.values.expand((v) => v).toList()
        : ['totalMinutes'],
    'source': kind == 'todo' ? 'manual' : null,
  };
  Future<void> _projectV2(
    DatabaseExecutor db,
    Map<String, dynamic> body,
    Map<String, dynamic>? before,
  ) async {
    final changed =
        before == null ||
        !workspaceDomainV2Equal(
          {for (final k in workspaceDomainV2TodoUnits['P']!) k: body[k]},
          {for (final k in workspaceDomainV2TodoUnits['P']!) k: before[k]},
        );
    if (!changed || body['projectId'] == null) return;
    final project = await _entityV2(
      db,
      'records',
      'project_catalog',
      body['projectId'] as String,
    );
    if (project == null || project['deleted'] == true) {
      throw StateError('项目当前不可用');
    }
    final record = workspaceDomainV2MapBody(project);
    if (workspaceDomainV2Inspect(
              'project_catalog',
              body['projectId'] as String,
              project['json'] as String,
            )['supported'] !=
            true ||
        record['trashedAt'] != null ||
        record['ledgerOnly'] == true ||
        ['published', 'archived'].contains(record['status']) ||
        [
          'completed',
          'archived',
          'shelved',
        ].contains(record['topicStageRole'])) {
      throw StateError('项目当前不可用');
    }
    if (body['stageKey'] != null &&
        !(record['stages'] as List).any(
          (s) => s['key'] == body['stageKey'] && s['enabled'] == true,
        )) {
      throw StateError('阶段当前不可用');
    }
  }

  Map<String, dynamic> workspaceDomainV2MapBody(Map<String, dynamic> local) =>
      workspaceV2Map(jsonDecode(local['json'] as String));
  Future<Map<String, dynamic>> _saveV2(
    DatabaseExecutor db,
    String kind,
    String id,
    Map<String, dynamic>? body,
    bool deleted,
    int expected,
  ) async {
    final live = await _liveV2(db),
        old = await _entityV2(db, 'records', kind, id),
        baseline = await _entityV2(db, 'baselines', kind, id),
        inflight = await _entityV2(db, 'inflight', kind, id);
    if (!workspaceV2SafeInteger(expected) ||
        (old?['localRevision'] ?? 0) != expected) {
      throw const WorkspaceConflict();
    }
    await _assertWriteV2(db, live, kind, old, deleting: deleted);
    if (await _entityV2(db, 'conflicts', kind, id) != null) {
      throw StateError('请先处理此记录冲突');
    }
    if (baseline != null &&
        workspaceDomainV2Inspect(
              kind,
              id,
              old!['json'] as String,
            )['writable'] !=
            true) {
      throw StateError('当前正文只读');
    }
    if (kind == 'todo' && deleted && baseline == null && inflight == null) {
      if (old != null) {
        for (final table in ['records', 'pending', 'blocked']) {
          await _deleteEntityV2(db, table, kind, id);
        }
      }
      return {
        'kind': kind,
        'id': id,
        'localRevision': expected,
        'deleted': true,
        'cancelled': true,
      };
    }
    final oldBody = old == null ? null : workspaceDomainV2MapBody(old);
    if (!deleted && kind == 'todo' && old?['deleted'] == true) {
      throw StateError('已删除待办不能原ID恢复');
    }
    String json;
    if (deleted) {
      json = baseline == null
          ? kind == 'work_log'
                ? jsonEncode({'day': id, 'totalMinutes': null})
                : old!['json'] as String
          : await _v2Body(db, baseline);
    } else {
      if (body == null) throw const FormatException('正文缺失');
      if (baseline == null) {
        workspaceDomainV2Validate(
          kind == 'todo' ? 'todoCreate' : 'workLogCreate',
          body,
        );
      } else {
        final baseBody = oldBody!;
        final resolution = workspaceDomainV2Resolve({
          'kind': kind,
          'id': id,
          'baseRevision': baseline['revision'],
          'currentRevision': baseline['revision'],
          'base': {'deleted': old!['deleted'], 'body': baseBody},
          'next': {'deleted': false, 'body': body},
          'current': {'deleted': old['deleted'], 'body': baseBody},
        });
        if (!['apply', 'noop'].contains(resolution['status'])) {
          throw const FormatException('领域变更无效');
        }
        final editable =
            (await _effectiveV2Metadata(db, live, old))['editableFields']
                as List;
        for (final key in {...baseBody.keys, ...body.keys}) {
          if (!workspaceDomainV2Equal(
                {if (baseBody.containsKey(key)) key: baseBody[key]},
                {if (body.containsKey(key)) key: body[key]},
              ) &&
              !editable.contains(key)) {
            throw StateError('字段不可修改');
          }
        }
      }
      if (kind == 'todo') await _projectV2(db, body, oldBody);
      if (baseline != null &&
          await _entityV2(db, 'blocked', kind, id) != null) {
        final remoteBody = workspaceV2Map(
          jsonDecode(await _v2Body(db, baseline)),
        );
        final keys = kind == 'todo'
            ? workspaceDomainV2TodoUnits.values.expand((v) => v).toSet()
            : {'totalMinutes'};
        body = {
          ...remoteBody,
          for (final k in keys)
            if (body.containsKey(k)) k: body[k],
        };
      }
      json = jsonEncode(body);
    }
    if (old != null &&
        workspaceDomainV2Equal(
          jsonDecode(old['json'] as String),
          jsonDecode(json),
        ) &&
        old['deleted'] == deleted) {
      return old;
    }
    final revision = _nextV2Revision(expected),
        local = _localV2(
          kind,
          id,
          revision,
          json,
          deleted,
          old == null ? _newMetadataV2(kind) : workspaceV2Map(old['metadata']),
        );
    final pending = {
      'kind': kind,
      'id': id,
      'localRevision': revision,
      'operationId': workspaceId(),
      'base': baseline,
      'baseJson': baseline == null ? null : await _v2Body(db, baseline),
      'json': json,
      'deleted': deleted,
    };
    await _putEntityV2(db, 'records', local);
    await _putEntityV2(db, 'pending', pending);
    final blocked = await _entityV2(db, 'blocked', kind, id);
    if (blocked != null && await _correctedV2(db, pending, blocked)) {
      await _putEntityV2(db, 'blocked', {...blocked, 'active': false});
    }
    return local;
  }

  @override
  Future<Map<String, dynamic>> saveV2Todo(
    Map<String, dynamic> command,
    int expectedLocalRevision,
  ) async {
    final value = _copyV2(command);
    return _database.transaction(
      (txn) => _saveTodoCommandV2(txn, value, expectedLocalRevision),
    );
  }

  Future<Map<String, dynamic>> _saveTodoCommandV2(
    DatabaseExecutor db,
    Map<String, dynamic> command,
    int expected,
  ) {
    workspaceV2Fields(command, {'id'}, optional: {'body', 'deleted'});
    if (!workspaceV2Uuid(command['id']) ||
        command['deleted'] != null && command['deleted'] is! bool) {
      throw const FormatException('待办指令无效');
    }
    return _saveV2(
      db,
      'todo',
      command['id'] as String,
      command['body'] == null ? null : workspaceV2Map(command['body']),
      command['deleted'] == true,
      expected,
    );
  }

  @override
  Future<List<Map<String, dynamic>>> saveV2Todos(
    List<Map<String, dynamic>> commands,
  ) async {
    final values = [for (final c in commands) _copyV2(c)];
    if (values.isEmpty || values.length > 100) {
      throw const FormatException('批量待办须为1至100项');
    }
    return _database.transaction((txn) async {
      final result = <Map<String, dynamic>>[], ids = <String>{};
      for (final value in values) {
        workspaceV2Fields(value, {'command', 'expectedLocalRevision'});
        final command = workspaceV2Map(value['command']);
        if (!ids.add(command['id'] as String) ||
            !workspaceV2SafeInteger(value['expectedLocalRevision'])) {
          throw const FormatException('批量待办重复或版本无效');
        }
        result.add(
          await _saveTodoCommandV2(
            txn,
            command,
            value['expectedLocalRevision'] as int,
          ),
        );
      }
      return result;
    });
  }

  @override
  Future<Map<String, dynamic>> saveV2WorkLog(
    Map<String, dynamic> command,
    int expectedLocalRevision,
  ) async {
    final value = _copyV2(command);
    workspaceV2Fields(value, {'day'}, optional: {'minutes', 'clear'});
    if (!workspaceV2Day(value['day']) ||
        value['clear'] != null && value['clear'] is! bool ||
        value['clear'] != true &&
            !workspaceV2SafeInteger(value['minutes'], maximum: 1440)) {
      throw const FormatException('工时指令无效');
    }
    return _database.transaction((txn) async {
      await _liveV2(txn);
      final id = value['day'] as String,
          old = await _entityV2(txn, 'records', 'work_log', id);
      if (value['clear'] == true && old == null) {
        final live = await _liveV2(txn);
        await _assertWriteV2(txn, live, 'work_log', null);
        if (expectedLocalRevision != 0) throw const WorkspaceConflict();
        final json = jsonEncode({'day': id, 'totalMinutes': null});
        final local = _localV2(
          'work_log',
          id,
          1,
          json,
          true,
          _newMetadataV2('work_log'),
        );
        await _putEntityV2(txn, 'records', local);
        await _putEntityV2(txn, 'pending', {
          'kind': 'work_log',
          'id': id,
          'localRevision': 1,
          'operationId': workspaceId(),
          'base': null,
          'baseJson': null,
          'json': json,
          'deleted': true,
        });
        return local;
      }
      final body = old == null
          ? {'day': id, 'totalMinutes': value['minutes']}
          : {
              ...workspaceDomainV2MapBody(old),
              'totalMinutes': value['minutes'],
            };
      return _saveV2(
        txn,
        'work_log',
        id,
        body,
        value['clear'] == true,
        expectedLocalRevision,
      );
    });
  }

  Future<bool> _correctedV2(
    DatabaseExecutor db,
    Map<String, dynamic> pending,
    Map<String, dynamic> blocked,
  ) async {
    final frozen = workspaceV2Map(blocked['frozen']);
    if ((pending['localRevision'] as int) <= (frozen['localRevision'] as int) ||
        pending['json'] == frozen['json'] &&
            pending['deleted'] == frozen['deleted']) {
      return false;
    }
    final code = (blocked['receipt'] as Map)['code'];
    if (code == 'record_read_only') return false;
    final body = workspaceV2Map(jsonDecode(pending['json'] as String)),
        previous = workspaceV2Map(jsonDecode(frozen['json'] as String));
    if (code == 'project_unavailable' &&
        body['projectId'] == previous['projectId']) {
      return false;
    }
    if (code == 'stage_unavailable' &&
        body['projectId'] == previous['projectId'] &&
        body['stageKey'] == previous['stageKey']) {
      return false;
    }
    try {
      if (pending['kind'] == 'todo') await _projectV2(db, body, null);
      return true;
    } on StateError {
      return false;
    }
  }

  Future<void> _freezeV2(
    DatabaseExecutor db,
    Map<String, dynamic> pending,
  ) async {
    final base = pending['base'] as Map?,
        operation = {
          'type': 'record',
          'operationId': pending['operationId'],
          'kind': pending['kind'],
          'id': pending['id'],
          'localRevision': pending['localRevision'],
          'baseRevision': base?['revision'] ?? 0,
          'base': base == null
              ? null
              : {'deleted': base['deleted'], 'payload': base['payload']},
          'next': {
            'deleted': pending['deleted'],
            'payload': _payloadV2(pending['json'] as String),
          },
        };
    workspaceV2Validate('operation', operation);
    final frozen = {...pending, 'operation': operation};
    await _putEntityV2(db, 'inflight', frozen);
    await _deleteEntityV2(
      db,
      'pending',
      pending['kind'] as String,
      pending['id'] as String,
    );
    final nextPayload = workspaceV2Map((operation['next'] as Map)['payload']);
    if (nextPayload['encoding'] == 'blob') {
      final ref = workspaceV2Map(nextPayload['ref']);
      await _putUploadV2(db, {
        'operationId': pending['operationId'],
        'kind': pending['kind'],
        'id': pending['id'],
        'scope': workspaceV2KindScopes[pending['kind']],
        'uploadId': workspaceId(),
        'ref': ref,
        'checkpoint': null,
        'committed': false,
      });
    }
  }

  Future<List<Map<String, dynamic>>> _uploadsV2(DatabaseExecutor db) async => [
    for (final row in await db.query('workspace_v2_uploads', orderBy: 'id'))
      await _decode(row['payload'] as String),
  ];
  Future<void> _putUploadV2(
    DatabaseExecutor db,
    Map<String, dynamic> upload,
  ) async {
    await db.insert('workspace_v2_uploads', {
      'id': "${upload['operationId']}:${(upload['ref'] as Map)['sha256']}",
      'payload': await _encode(upload),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<Map<String, dynamic>> _uploadV2(
    DatabaseExecutor db,
    String operationId,
    String hash,
  ) async {
    final rows = await db.query(
      'workspace_v2_uploads',
      where: 'id=?',
      whereArgs: ['$operationId:$hash'],
    );
    if (rows.length != 1) throw StateError('在途上传不存在');
    final value = await _decode(rows.single['payload'] as String);
    final inflight = await _entityV2(
      db,
      'inflight',
      value['kind'] as String,
      value['id'] as String,
    );
    if (value['operationId'] != operationId ||
        (value['ref'] as Map)['sha256'] != hash ||
        inflight?['operationId'] != operationId ||
        workspaceV2Sha256Sync(utf8.encode(inflight!['json'] as String)) !=
            hash) {
      throw const FormatException('上传原稿绑定损坏');
    }
    return value;
  }

  @override
  Future<Map<String, dynamic>> prepareV2Sync({int operationLimit = 100}) async {
    if (operationLimit < 1 || operationLimit > 100) {
      throw const FormatException('同步批次无效');
    }
    return _database.transaction((txn) async {
      final live = await _liveV2(txn);
      if (live['suspended'] == true) throw StateError('工作区权限范围已改变');
      if ((await _state(txn))['enabled'] != true) throw StateError('工作台同步未开启');
      if (await _singleV2(txn, 'response') != null) {
        throw StateError('请先提交待处理响应');
      }
      if (live['through'] == null) {
        var count = (await _entitiesV2(
          txn,
          'inflight',
        )).where((f) => _scopeWritableV2(live, f['kind'] as String)).length;
        for (final pending in await _entitiesV2(txn, 'pending')) {
          if (count >= operationLimit) break;
          final kind = pending['kind'] as String, id = pending['id'] as String;
          if (await _entityV2(txn, 'inflight', kind, id) != null ||
              await _entityV2(txn, 'conflicts', kind, id) != null ||
              (await _entityV2(txn, 'blocked', kind, id))?['active'] == true) {
            continue;
          }
          final local = (await _entityV2(txn, 'records', kind, id))!;
          final metadata = await _effectiveV2Metadata(txn, live, local);
          if (!_scopeWritableV2(live, kind) ||
              metadata['write'] != true ||
              pending['deleted'] == true && metadata['deletable'] != true) {
            continue;
          }
          await _freezeV2(txn, pending);
          count++;
        }
      }
      final selected = live['through'] == null
          ? (await _entitiesV2(txn, 'inflight'))
                .where((f) => _scopeWritableV2(live, f['kind'] as String))
                .take(operationLimit)
                .toList()
          : <Map<String, dynamic>>[];
      final payload = {
        ..._identityV2(live),
        'scopes': live['scopes'],
        'scopeDigest': live['scopeDigest'],
        'cursor': live['cursor'],
        'through': live['through'],
        'operations': [for (final frozen in selected) frozen['operation']],
      };
      if (utf8.encode(workspaceV2CanonicalJson(payload)).length >
          workspaceV2PageBytes) {
        throw const WorkspaceV2PrepareTooLarge();
      }
      workspaceV2Validate('syncRequest', payload);
      final ids = selected.map((f) => f['operationId']).toSet();
      final uploads = (await _uploadsV2(
        txn,
      )).where((u) => ids.contains(u['operationId'])).toList();
      return {
        'payload': payload,
        'uploads': uploads,
        'ready': uploads.every((u) => u['committed'] == true),
        'permissionContext': await _v2PreparePermissionOrigin(txn, payload),
      };
    });
  }

  @override
  Future<Map<String, dynamic>> loadV2UploadChunk(
    String operationId,
    String sha256,
    int index,
  ) => _database.transaction((txn) async {
    await _liveV2(txn);
    final upload = await _uploadV2(txn, operationId, sha256),
        ref = workspaceV2Map(upload['ref']);
    final length = workspaceV2ExpectedChunkLength(
      ref['byteLength'] as int,
      index,
    );
    final frozen = (await _entityV2(
      txn,
      'inflight',
      upload['kind'] as String,
      upload['id'] as String,
    ))!;
    final bytes = utf8
        .encode(frozen['json'] as String)
        .sublist(
          index * workspaceV2ChunkBytes,
          index * workspaceV2ChunkBytes + length,
        );
    return {
      'bytes': bytes,
      'chunkHash': workspaceV2Sha256Sync(bytes),
      'ref': ref,
    };
  });
  void _assertIdentityV2(
    Map<String, dynamic> live,
    Map<String, dynamic> value,
  ) {
    if (value['workspaceId'] != live['workspaceId'] ||
        value['deviceId'] != live['deviceId']) {
      throw const FormatException('同步身份不匹配');
    }
  }

  @override
  Future<void> saveV2UploadCheckpoint(
    String operationId,
    String sha256,
    Map<String, dynamic> checkpoint,
  ) async {
    final value = workspaceV2Validate('blobSession', _copyV2(checkpoint));
    await _database.transaction((txn) async {
      final live = await _liveV2(txn),
          upload = await _uploadV2(txn, operationId, sha256);
      _assertIdentityV2(live, value);
      if (DateTime.parse(value['expiresAt'] as String).isBefore(_now())) {
        throw StateError('上传会话已过期');
      }
      final count =
          (((upload['ref'] as Map)['byteLength'] as int) +
              workspaceV2ChunkBytes -
              1) ~/
          workspaceV2ChunkBytes;
      if ((value['receivedIndexes'] as List).any((i) => (i as int) >= count)) {
        throw const FormatException('上传检查点越界');
      }
      final old = upload['checkpoint'] as Map?;
      if (old != null &&
          DateTime.parse(old['expiresAt'] as String).isAfter(_now()) &&
          (old['sessionId'] != value['sessionId'] ||
              !(old['receivedIndexes'] as List).every(
                (i) => (value['receivedIndexes'] as List).contains(i),
              ))) {
        throw const FormatException('上传检查点回退');
      }
      final others = (await _uploadsV2(txn))
          .where(
            (u) =>
                u['operationId'] != operationId &&
                u['checkpoint'] != null &&
                u['committed'] != true &&
                DateTime.parse(
                  (u['checkpoint'] as Map)['expiresAt'] as String,
                ).isAfter(_now()),
          )
          .toList();
      final reserved = others.fold<int>(
        0,
        (n, u) => n + ((u['ref'] as Map)['byteLength'] as int),
      );
      if (others.length >= workspaceV2ConcurrentUploads ||
          reserved + (upload['ref'] as Map)['byteLength'] as int >
              workspaceV2DeviceTemporaryBytes) {
        throw StateError('上传暂存已达上限');
      }
      await _putUploadV2(txn, {...upload, 'checkpoint': value});
    });
  }

  @override
  Future<void> resetV2Upload(
    String operationId,
    String sha256, {
    required String reason,
  }) => _database.transaction((txn) async {
    await _liveV2(txn);
    final upload = await _uploadV2(txn, operationId, sha256),
        checkpoint = upload['checkpoint'] as Map?;
    if (!['local_expired', 'server_expired'].contains(reason)) {
      throw const FormatException('上传重试原因无效');
    }
    if (reason == 'local_expired' &&
        (checkpoint == null ||
            DateTime.parse(
              checkpoint['expiresAt'] as String,
            ).isAfter(_now()))) {
      throw StateError('上传会话尚未过期');
    }
    await _putUploadV2(txn, {
      ...upload,
      'uploadId': workspaceId(),
      'checkpoint': null,
      'committed': false,
    });
  });
  @override
  Future<void> markV2UploadCommitted(
    String operationId,
    String sha256,
    Map<String, dynamic> response,
  ) async {
    final value = workspaceV2Validate('blobCommitResponse', _copyV2(response));
    await _database.transaction((txn) async {
      final live = await _liveV2(txn),
          upload = await _uploadV2(txn, operationId, sha256);
      _assertIdentityV2(live, value);
      if (!workspaceJsonEqual(value['ref'], upload['ref']) ||
          (upload['checkpoint'] as Map?)?['sessionId'] != value['sessionId']) {
        throw const FormatException('上传确认不匹配');
      }
      await _putUploadV2(txn, {...upload, 'committed': true});
    });
  }

  List<Map<String, dynamic>> _responseRecordsV2(
    Map<String, dynamic> response,
  ) => [
    for (final raw in response['receipts'] as List)
      if ((raw as Map)['record'] != null) workspaceV2Map(raw['record']),
    for (final raw in response['changes'] as List) workspaceV2Map(raw),
  ];
  Future<void> _validateResponseV2(
    DatabaseExecutor db,
    Map<String, dynamic> live,
    Map<String, dynamic> request,
    Map<String, dynamic> response, {
    bool historicalPermissions = false,
  }) async {
    if ((await _state(db))['enabled'] != true) throw StateError('工作台同步未开启');
    if (live['suspended'] == true) throw StateError('工作区权限范围已改变');
    workspaceV2AssertSyncResponse(request, response);
    _assertIdentityV2(live, request);
    if (request['scopeDigest'] != live['scopeDigest'] ||
        !workspaceJsonEqual(request['scopes'], live['scopes']) ||
        request['cursor'] != live['cursor'] ||
        request['through'] != live['through'] ||
        request['through'] == null &&
            (response['through'] as int) < (live['knownSequence'] as int)) {
      throw const FormatException('响应水位已过期或回退');
    }
    for (final raw in request['operations'] as List) {
      final op = workspaceV2Map(raw),
          frozen = await _entityV2(
            db,
            'inflight',
            op['kind'] as String,
            op['id'] as String,
          );
      if (frozen == null || !workspaceJsonEqual(frozen['operation'], op)) {
        throw const FormatException('响应不属于冻结操作');
      }
      for (final upload in await _uploadsV2(db)) {
        if (upload['operationId'] == op['operationId'] &&
            upload['committed'] != true) {
          throw StateError('操作正文尚未上传');
        }
      }
    }
    for (final raw in response['changes'] as List) {
      final record = workspaceV2Map(raw);
      final metadata = workspaceV2Map(record['metadata']);
      if (!historicalPermissions &&
          metadata['write'] == true &&
          !_scopeWritableV2(live, record['kind'] as String)) {
        throw const FormatException('响应扩大写权限');
      }
    }
  }

  Future<List<Map<String, dynamic>>> _responseDownloadsV2(
    DatabaseExecutor db,
    Map<String, dynamic> response,
  ) async {
    final downloads = <Map<String, dynamic>>[], seen = <String>{};
    for (final record in _responseRecordsV2(response)) {
      final payload = workspaceV2Map(record['payload']);
      if (payload['encoding'] != 'blob') continue;
      final ref = workspaceV2Map(payload['ref']);
      if (!seen.add(ref['sha256'] as String)) continue;
      final objects = await db.query(
        'workspace_v2_json_objects',
        where: 'sha256=?',
        whereArgs: [ref['sha256']],
      );
      final object = objects.isEmpty
          ? null
          : await _jsonObject(db, ref['sha256'] as String);
      if (object != null && object['byteLength'] != ref['byteLength']) {
        throw const FormatException('正文长度冲突');
      }
      downloads.add({
        ...ref,
        'record': {
          'kind': record['kind'],
          'id': record['id'],
          'revision': record['revision'],
        },
        'complete': object?['complete'] == true,
        'receivedIndexes': [
          for (final row in await db.query(
            'workspace_v2_json_chunks',
            columns: ['chunk_index'],
            where: 'sha256=?',
            whereArgs: [ref['sha256']],
            orderBy: 'chunk_index',
          ))
            row['chunk_index'],
        ],
      });
    }
    return downloads;
  }

  @override
  Future<Map<String, dynamic>> stageV2SyncResponse(
    Map<String, dynamic> request,
    Map<String, dynamic> response, {
    String? permissionContext,
  }) async {
    final sent = _copyV2(request), received = _copyV2(response);
    return _database.transaction((txn) async {
      final live = await _liveV2(txn);
      await _pruneExpiredV2Json(txn);
      await _validateResponseV2(
        txn,
        live,
        sent,
        received,
        historicalPermissions: !await _v2CurrentRequestPermissions(
          txn,
          sent,
          permissionContext,
        ),
      );
      final sizes = <String, int>{};
      for (final record in _responseRecordsV2(received)) {
        final payload = workspaceV2Map(record['payload']),
            hash = workspaceV2PayloadHash(payload);
        final length =
            (payload['encoding'] == 'json'
                    ? payload['byteLength']
                    : (payload['ref'] as Map)['byteLength'])
                as int;
        if (sizes.containsKey(hash) && sizes[hash] != length) {
          throw const FormatException('响应正文长度声明冲突');
        }
        sizes[hash] = length;
      }
      if (sizes.values.fold<int>(0, (a, b) => a + b) >
          workspaceV2DeviceTemporaryBytes) {
        throw StateError('本页必要正文超过本机暂存上限');
      }
      final old = await _singleV2(txn, 'response');
      if (old != null &&
          (!workspaceJsonEqual(old['request'], sent) ||
              !workspaceJsonEqual(old['response'], received))) {
        throw StateError('已有待处理响应');
      }
      final stage =
          old ??
          {
            'responseId': workspaceId(),
            'request': sent,
            'response': received,
            'createdAt': _now().millisecondsSinceEpoch,
          };
      await _putSingleV2(txn, 'response', stage);
      if (old == null) {
        await _v2ResponsePermissionOrigin(
          txn,
          stage['responseId'] as String,
          sent,
          permissionContext,
        );
      }
      return {
        'responseId': stage['responseId'],
        'downloads': await _responseDownloadsV2(txn, received),
      };
    });
  }

  Future<Map<String, dynamic>> _requireResponseV2(
    DatabaseExecutor db,
    String responseId,
  ) async {
    final stage = await _singleV2(db, 'response');
    if (stage == null || stage['responseId'] != responseId) {
      throw StateError('待处理响应不存在');
    }
    final live = await _liveV2(db);
    await _validateResponseV2(
      db,
      live,
      workspaceV2Map(stage['request']),
      workspaceV2Map(stage['response']),
      historicalPermissions: await _v2HistoricalPermissionResponse(
        db,
        responseId,
      ),
    );
    return stage;
  }

  @override
  Future<void> putV2ResponseJsonChunk(
    String responseId, {
    required String sha256,
    required int index,
    required List<int> bytes,
    required String chunkHash,
  }) async {
    final input = List<int>.of(bytes);
    if (!workspaceV2Hash(sha256) ||
        !workspaceV2Hash(chunkHash) ||
        input.any((b) => b < 0 || b > 255) ||
        workspaceV2Sha256Sync(input) != chunkHash) {
      throw const FormatException('正文分块无效');
    }
    await _database.transaction((txn) async {
      final stage = await _requireResponseV2(txn, responseId);
      final refs = _responseRecordsV2(workspaceV2Map(stage['response']))
          .map((r) => workspaceV2Map(r['payload']))
          .where((p) => p['encoding'] == 'blob')
          .map((p) => workspaceV2Map(p['ref']))
          .where((r) => r['sha256'] == sha256)
          .toList();
      if (refs.isEmpty ||
          refs.any((r) => r['byteLength'] != refs.first['byteLength'])) {
        throw const FormatException('正文不属于本次响应');
      }
      await _putVerifiedV2JsonChunk(txn, refs.first, index, input, chunkHash);
    });
  }

  Future<Map<String, dynamic>> _baselineV2(
    DatabaseExecutor db,
    Map<String, dynamic> remote,
  ) async {
    workspaceV2Validate('record', remote);
    final kind = remote['kind'] as String,
        id = remote['id'] as String,
        previous = await _entityV2(db, 'baselines', kind, id);
    if (previous != null) {
      if ((remote['revision'] as int) < (previous['revision'] as int)) {
        return previous;
      }
      if (remote['revision'] == previous['revision']) {
        if (remote['sequence'] != previous['sequence'] ||
            remote['deleted'] != previous['deleted'] ||
            workspaceV2PayloadHash(workspaceV2Map(remote['payload'])) !=
                workspaceV2PayloadHash(workspaceV2Map(previous['payload']))) {
          throw const FormatException('远端不可变版本已改变');
        }
      } else if ((remote['sequence'] as int) <= (previous['sequence'] as int)) {
        throw const FormatException('远端实体水位回退');
      }
    }
    await _v2Body(db, remote);
    await _putEntityV2(db, 'baselines', remote);
    return remote;
  }

  Map<String, dynamic> _fullCreateV2(
    Map<String, dynamic> body,
    Map<String, dynamic> remote,
  ) {
    final keys = workspaceDomainV2TodoUnits.values.expand((v) => v).toSet();
    return {
      ...remote,
      for (final key in keys)
        if (body.containsKey(key)) key: body[key],
      'stageLinkSource': body['stageKey'] == null ? null : 'manual',
    };
  }

  Future<void> _conflictV2(
    DatabaseExecutor db,
    Map<String, dynamic> local,
    Map<String, dynamic> remote,
  ) async {
    await _putEntityV2(db, 'conflicts', {
      'kind': local['kind'],
      'id': local['id'],
      'localRevision': local['localRevision'],
      'remoteRevision': remote['revision'],
      'local': local,
      'remote': {'record': remote, 'json': await _v2Body(db, remote)},
    });
  }

  Future<void> _cleanLocalV2(
    DatabaseExecutor db,
    Map<String, dynamic> remote,
    Map<String, dynamic>? old,
  ) async {
    await _putEntityV2(
      db,
      'records',
      _localV2(
        remote['kind'] as String,
        remote['id'] as String,
        _nextV2Revision((old?['localRevision'] as int?) ?? 0),
        await _v2Body(db, remote),
        remote['deleted'] as bool,
        workspaceV2Map(remote['metadata']),
      ),
    );
  }

  Future<void> _rebaseV2(
    DatabaseExecutor db,
    Map<String, dynamic> remote, {
    Map<String, dynamic>? accepted,
  }) async {
    final kind = remote['kind'] as String, id = remote['id'] as String;
    final old = await _entityV2(db, 'records', kind, id),
        pending = await _entityV2(db, 'pending', kind, id),
        inflight = await _entityV2(db, 'inflight', kind, id),
        blocked = await _entityV2(db, 'blocked', kind, id);
    final intent = pending ?? inflight;
    if (intent == null) {
      if (blocked != null && blocked['active'] != false) {
        if (old != null) await _conflictV2(db, old, remote);
        return;
      }
      await _cleanLocalV2(db, remote, old);
      return;
    }
    final priorConflict = await _entityV2(db, 'conflicts', kind, id);
    if (priorConflict != null) {
      await _conflictV2(db, old!, remote);
      return;
    }
    final remoteJson = await _v2Body(db, remote),
        remoteBody = workspaceV2Map(jsonDecode(remoteJson));
    final base = accepted ?? intent;
    final baseRecord = base['base'] as Map?;
    if (accepted == null && baseRecord == null) {
      await _conflictV2(db, old!, remote);
      return;
    }
    var baseBody = workspaceV2Map(
      jsonDecode(
        (accepted != null ? accepted['json'] : intent['baseJson']) as String,
      ),
    );
    var nextBody = workspaceV2Map(jsonDecode(intent['json'] as String));
    if (accepted != null &&
        kind == 'todo' &&
        (accepted['base'] as Map?) == null) {
      baseBody = _fullCreateV2(baseBody, remoteBody);
      nextBody = _fullCreateV2(nextBody, remoteBody);
    }
    if (intent['deleted'] == true) nextBody = baseBody;
    Map<String, dynamic> result;
    if (accepted != null && intent['deleted'] == true) {
      result = {
        'status': remote['deleted'] == true ? 'noop' : 'apply',
        'body': remoteBody,
        'deleted': true,
        'changedUnits': ['deleted'],
      };
    } else if (accepted != null && kind == 'work_log') {
      result = {
        'status': 'apply',
        'body': intent['deleted'] == true
            ? remoteBody
            : {...remoteBody, 'totalMinutes': nextBody['totalMinutes']},
        'deleted': intent['deleted'],
        'changedUnits': ['totalMinutes'],
      };
    } else {
      result = workspaceDomainV2Resolve({
        'kind': kind,
        'id': id,
        'baseRevision': accepted != null ? 1 : baseRecord!['revision'],
        'currentRevision': accepted != null ? 2 : remote['revision'],
        'base': {
          'deleted': accepted != null
              ? accepted['deleted']
              : baseRecord!['deleted'],
          'body': baseBody,
        },
        'next': {'deleted': intent['deleted'], 'body': nextBody},
        'current': {'deleted': remote['deleted'], 'body': remoteBody},
      });
    }
    if (!['apply', 'noop'].contains(result['status']) ||
        (remote['metadata'] as Map)['write'] != true) {
      await _conflictV2(db, old!, remote);
      return;
    }
    final json = result['deleted'] == true || result['status'] == 'noop'
        ? remoteJson
        : jsonEncode(result['body']);
    final changed =
        old!['json'] != json ||
        old['deleted'] != result['deleted'] ||
        !workspaceJsonEqual(old['metadata'], remote['metadata']);
    final revision = changed
        ? _nextV2Revision(old['localRevision'] as int)
        : old['localRevision'] as int;
    final local = _localV2(
      kind,
      id,
      revision,
      json,
      result['deleted'] as bool,
      workspaceV2Map(remote['metadata']),
    );
    await _putEntityV2(db, 'records', local);
    if (pending != null) {
      if (result['status'] == 'noop' && inflight == null) {
        await _deleteEntityV2(db, 'pending', kind, id);
      } else {
        await _putEntityV2(db, 'pending', {
          ...pending,
          'localRevision': revision,
          'operationId': workspaceId(),
          'base': remote,
          'baseJson': remoteJson,
          'json': json,
          'deleted': result['deleted'],
        });
      }
    }
  }

  Future<void> _receiveV2(
    DatabaseExecutor db,
    Map<String, dynamic> incoming,
  ) async {
    final kind = incoming['kind'] as String,
        id = incoming['id'] as String,
        previous = await _entityV2(db, 'baselines', kind, id);
    final remote = await _baselineV2(db, incoming);
    if (previous != null &&
        (incoming['revision'] as int) <= (previous['revision'] as int)) {
      if (incoming['revision'] == previous['revision']) {
        final local = await _entityV2(db, 'records', kind, id);
        if (local != null &&
            !workspaceJsonEqual(local['metadata'], remote['metadata'])) {
          final revision = _nextV2Revision(local['localRevision'] as int);
          final next = {
            ...local,
            'metadata': remote['metadata'],
            'localRevision': revision,
          };
          await _putEntityV2(db, 'records', next);
          final pending = await _entityV2(db, 'pending', kind, id);
          if (pending != null) {
            await _putEntityV2(db, 'pending', {
              ...pending,
              'localRevision': revision,
            });
          }
          if (await _entityV2(db, 'conflicts', kind, id) != null) {
            await _conflictV2(db, next, remote);
          }
        }
      }
      return;
    }
    await _rebaseV2(db, remote);
  }

  Future<void> _retireV2(
    DatabaseExecutor db,
    Map<String, dynamic> frozen,
  ) async {
    await _deleteEntityV2(
      db,
      'inflight',
      frozen['kind'] as String,
      frozen['id'] as String,
    );
    for (final upload in await _uploadsV2(db)) {
      if (upload['operationId'] == frozen['operationId']) {
        await db.delete(
          'workspace_v2_uploads',
          where: 'id=?',
          whereArgs: [
            "${upload['operationId']}:${(upload['ref'] as Map)['sha256']}",
          ],
        );
      }
    }
  }

  @override
  Future<void> commitV2SyncResponse(
    String responseId,
  ) => _database.transaction((txn) async {
    final stage = await _requireResponseV2(txn, responseId),
        response = workspaceV2Map(stage['response']);
    final live = await _liveV2(txn);
    final priorBaselines = <String, Map<String, dynamic>?>{};
    for (final remote in _responseRecordsV2(response)) {
      priorBaselines['${remote['kind']}:${remote['id']}'] = await _entityV2(
        txn,
        'baselines',
        remote['kind'] as String,
        remote['id'] as String,
      );
      await _v2Body(txn, remote);
    }
    for (final raw in response['receipts'] as List) {
      final receipt = workspaceV2Map(raw);
      final sent = (stage['request'] as Map)['operations'] as List;
      final op = workspaceV2Map(
        sent.firstWhere((o) => o['operationId'] == receipt['operationId']),
      );
      final kind = op['kind'] as String,
          id = op['id'] as String,
          frozen = (await _entityV2(txn, 'inflight', kind, id))!;
      final local = (await _entityV2(txn, 'records', kind, id))!,
          successor = await _entityV2(txn, 'pending', kind, id);
      final remote = receipt['record'] == null
          ? null
          : await _baselineV2(txn, workspaceV2Map(receipt['record']));
      await _retireV2(txn, frozen);
      if (receipt['status'] == 'accepted') {
        await _deleteEntityV2(txn, 'conflicts', kind, id);
        if (successor == null) {
          await _cleanLocalV2(txn, remote!, local);
        } else {
          final acknowledged = workspaceV2Map(receipt['record']);
          if ((remote!['revision'] as int) >
              (acknowledged['revision'] as int)) {
            await _rebaseV2(txn, acknowledged, accepted: frozen);
            await _rebaseV2(txn, remote);
          } else {
            await _rebaseV2(txn, remote, accepted: frozen);
          }
        }
      } else if (receipt['status'] == 'conflict') {
        if (successor == null) {
          await _putEntityV2(txn, 'pending', {...frozen}..remove('operation'));
        }
        await _conflictV2(txn, local, remote!);
      } else {
        final blocked = {
          'kind': kind,
          'id': id,
          'active': true,
          'frozen': frozen,
          'receipt': receipt,
          'localRevision': frozen['localRevision'],
        };
        await _putEntityV2(txn, 'blocked', blocked);
        if (successor == null) {
          await _putEntityV2(txn, 'pending', {...frozen}..remove('operation'));
        }
        if (successor != null && await _correctedV2(txn, successor, blocked)) {
          await _putEntityV2(txn, 'blocked', {...blocked, 'active': false});
          if (remote != null) await _rebaseV2(txn, remote);
        }
      }
    }
    for (final raw in response['changes'] as List) {
      await _receiveV2(txn, workspaceV2Map(raw));
    }
    await _v2ResponsePermissionsCommitted(
      txn,
      responseId,
      (response['changes'] as List).map(workspaceV2Map).toList(),
      priorBaselines,
    );
    var known = live['knownSequence'] as int;
    for (final remote in _responseRecordsV2(response)) {
      if ((remote['sequence'] as int) > known) {
        known = remote['sequence'] as int;
      }
    }
    if ((response['through'] as int) > known) {
      known = response['through'] as int;
    }
    await _putSingleV2(txn, 'live', {
      ...live,
      'cursor': response['cursor'],
      'through': response['hasMore'] == true ? response['through'] : null,
      'knownSequence': known,
    });
    await txn.delete('workspace_v2_response');
    await _collectCompletedV2Json(txn);
  });
  Future<void> _verifyLiveV2(DatabaseExecutor db) async {
    final live = await _liveV2(db), records = await _entitiesV2(db, 'records');
    final identities = records.map((r) => '${r['kind']}:${r['id']}').toSet();
    for (final local in records) {
      workspaceV2Fields(local, {
        'kind',
        'id',
        'localRevision',
        'json',
        'sha256',
        'deleted',
        'metadata',
      });
      if (!workspaceV2SafeInteger(local['localRevision'], minimum: 1) ||
          local['deleted'] is! bool ||
          local['json'] is! String ||
          workspaceV2Sha256Sync(utf8.encode(local['json'] as String)) !=
              local['sha256'] ||
          utf8.encode(local['json'] as String).length > workspaceV2JsonBytes) {
        throw const FormatException('活动正文或版本损坏');
      }
      workspaceV2Map(jsonDecode(local['json'] as String));
      workspaceV2Validate('metadata', local['metadata']);
      if (!(live['scopes'] as List).contains(
            workspaceV2KindScopes[local['kind']],
          ) ||
          (local['metadata'] as Map)['scope'] !=
              workspaceV2KindScopes[local['kind']]) {
        throw const FormatException('活动记录超出范围');
      }
      var sources = 0;
      for (final table in ['baselines', 'pending', 'inflight', 'blocked']) {
        if (await _entityV2(
              db,
              table,
              local['kind'] as String,
              local['id'] as String,
            ) !=
            null) {
          sources++;
        }
      }
      if (sources == 0) throw const FormatException('活动记录丢失同步来源');
      final kind = local['kind'] as String, id = local['id'] as String;
      final base = await _entityV2(db, 'baselines', kind, id),
          pending = await _entityV2(db, 'pending', kind, id),
          inflight = await _entityV2(db, 'inflight', kind, id),
          blocked = await _entityV2(db, 'blocked', kind, id),
          conflict = await _entityV2(db, 'conflicts', kind, id);
      if (pending == null &&
          inflight == null &&
          blocked?['active'] != true &&
          conflict == null &&
          (base == null ||
              local['json'] != await _v2Body(db, base) ||
              local['deleted'] != base['deleted'])) {
        throw const FormatException('本地变更丢失同步队列');
      }
      if (pending != null &&
          inflight != null &&
          (pending['localRevision'] as int) <=
              (inflight['localRevision'] as int)) {
        throw const FormatException('在途后继版本没有递增');
      }
    }
    for (final baseline in await _entitiesV2(db, 'baselines')) {
      workspaceV2Validate('record', baseline);
      await _v2Body(db, baseline);
      if (!identities.contains('${baseline['kind']}:${baseline['id']}') ||
          (baseline['sequence'] as int) > (live['knownSequence'] as int)) {
        throw const FormatException('基线版本关系损坏');
      }
    }
    for (final table in ['pending', 'inflight', 'conflicts', 'blocked']) {
      for (final value in await _entitiesV2(db, table)) {
        if (!identities.contains('${value['kind']}:${value['id']}')) {
          throw const FormatException('同步队列存在孤儿');
        }
        final local = (await _entityV2(
          db,
          'records',
          value['kind'] as String,
          value['id'] as String,
        ))!;
        if (!workspaceV2SafeInteger(value['localRevision'], minimum: 1) ||
            (value['localRevision'] as int) > (local['localRevision'] as int)) {
          throw const FormatException('队列本地版本关系损坏');
        }
        if (table == 'blocked') {
          workspaceV2Fields(value, {
            'kind',
            'id',
            'active',
            'frozen',
            'receipt',
            'localRevision',
          });
          final frozen = workspaceV2Map(value['frozen']),
              op = workspaceV2Validate('operation', frozen['operation']),
              receipt = workspaceV2Validate('receipt', value['receipt']);
          if (value['active'] is! bool ||
              receipt['status'] != 'rejected' ||
              frozen['kind'] != value['kind'] ||
              frozen['id'] != value['id'] ||
              frozen['localRevision'] != value['localRevision'] ||
              receipt['operationId'] != op['operationId'] ||
              receipt['localRevision'] != op['localRevision'] ||
              receipt['operationHash'] != workspaceV2OperationHash(op) ||
              (receipt['target'] as Map)['kind'] != value['kind'] ||
              (receipt['target'] as Map)['id'] != value['id'] ||
              !workspaceJsonEqual(
                (op['next'] as Map)['payload'],
                _payloadV2(frozen['json'] as String),
              )) {
            throw const FormatException('拒绝证明与原稿不匹配');
          }
        }
        if (table == 'conflicts') {
          final remote = await _entityV2(
                db,
                'baselines',
                value['kind'] as String,
                value['id'] as String,
              ),
              two = workspaceV2Map(value['remote']);
          if (value['localRevision'] != local['localRevision'] ||
              value['remoteRevision'] != remote?['revision'] ||
              !workspaceJsonEqual(value['local'], local) ||
              !workspaceJsonEqual(two['record'], remote) ||
              two['json'] != await _v2Body(db, remote!)) {
            throw const FormatException('冲突双版本关系损坏');
          }
        }
        if (table == 'pending' || table == 'inflight') {
          if (!workspaceV2Uuid(value['operationId']) ||
              value['deleted'] is! bool ||
              value['json'] is! String) {
            throw const FormatException('队列内容无效');
          }
          final payload = _payloadV2(value['json'] as String);
          if (value['base'] != null) {
            workspaceV2Validate('record', value['base']);
            if ((value['base'] as Map)['kind'] != value['kind'] ||
                (value['base'] as Map)['id'] != value['id']) {
              throw const FormatException('操作基线身份不匹配');
            }
            if (value['baseJson'] is! String ||
                workspaceV2Sha256Sync(
                      utf8.encode(value['baseJson'] as String),
                    ) !=
                    workspaceV2PayloadHash(
                      workspaceV2Map((value['base'] as Map)['payload']),
                    )) {
              throw const FormatException('操作基线原文损坏');
            }
          }
          if (table == 'inflight') {
            final op = workspaceV2Validate('operation', value['operation']);
            if (op['operationId'] != value['operationId'] ||
                op['localRevision'] != value['localRevision'] ||
                op['kind'] != value['kind'] ||
                op['id'] != value['id'] ||
                !workspaceJsonEqual((op['next'] as Map)['payload'], payload) ||
                (op['next'] as Map)['deleted'] != value['deleted'] ||
                op['baseRevision'] !=
                    ((value['base'] as Map?)?['revision'] ?? 0) ||
                !workspaceJsonEqual(
                  op['base'],
                  value['base'] == null
                      ? null
                      : {
                          'deleted': (value['base'] as Map)['deleted'],
                          'payload': (value['base'] as Map)['payload'],
                        },
                )) {
              throw const FormatException('冻结操作已改变');
            }
          } else if (value['localRevision'] != local['localRevision'] ||
              value['json'] != local['json'] ||
              value['deleted'] != local['deleted']) {
            throw const FormatException('后继草稿与当前记录不一致');
          }
        }
      }
    }
    for (final upload in await _uploadsV2(db)) {
      await _uploadV2(
        db,
        upload['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
      );
    }
  }

  @override
  Future<Set<String>> _retainedV2JsonHashes(DatabaseExecutor db) async {
    final hashes = await super._retainedV2JsonHashes(db);
    for (final blocked in await _entitiesV2(db, 'blocked')) {
      final record = (blocked['receipt'] as Map?)?['record'];
      if (record != null) {
        hashes.add(
          workspaceV2PayloadHash(workspaceV2Map((record as Map)['payload'])),
        );
      }
    }
    return hashes;
  }

  Future<void> _collectCompletedV2Json(DatabaseExecutor db) async {
    final retained = await _retainedV2JsonHashes(db);
    for (final row in await db.query('workspace_v2_json_objects')) {
      if (retained.contains(row['sha256'])) continue;
      final object = await _decode(row['payload'] as String);
      if (object['complete'] == true) {
        await db.delete(
          'workspace_v2_json_chunks',
          where: 'sha256=?',
          whereArgs: [row['sha256']],
        );
        await db.delete(
          'workspace_v2_json_objects',
          where: 'sha256=?',
          whereArgs: [row['sha256']],
        );
      }
    }
  }

  Future<void> _pruneExpiredV2Json(DatabaseExecutor db) async {
    final protected = await _retainedV2JsonHashes(db);
    for (final row in await db.query('workspace_v2_json_objects')) {
      if (protected.contains(row['sha256'])) continue;
      final object = await _decode(row['payload'] as String);
      if (object['complete'] != true &&
          _now().millisecondsSinceEpoch >=
              workspaceV2SessionExpiry(
                object['createdAt'] as int,
                object['lastActivityAt'] as int,
              )) {
        await db.delete(
          'workspace_v2_json_chunks',
          where: 'sha256=?',
          whereArgs: [row['sha256']],
        );
        await db.delete(
          'workspace_v2_json_objects',
          where: 'sha256=?',
          whereArgs: [row['sha256']],
        );
      }
    }
  }

  Future<void> _discardResponseV2(DatabaseExecutor db) async {
    final protected = await _retainedV2JsonHashes(db);
    for (final row in await db.query('workspace_v2_json_objects')) {
      if (protected.contains(row['sha256'])) continue;
      await db.delete(
        'workspace_v2_json_chunks',
        where: 'sha256=?',
        whereArgs: [row['sha256']],
      );
      await db.delete(
        'workspace_v2_json_objects',
        where: 'sha256=?',
        whereArgs: [row['sha256']],
      );
    }
    await db.delete('workspace_v2_response');
  }

  @override
  Future<void> _recoverV2(DatabaseExecutor db) async {
    if ((await _v2State(db))['activeProtocol'] != 2) {
      for (final table in [
        'live',
        'response',
        'pending',
        'inflight',
        'conflicts',
        'blocked',
        'uploads',
        'history',
      ]) {
        if ((await db.query(
          'workspace_v2_$table',
          columns: ['payload'],
          limit: 1,
        )).isNotEmpty) {
          throw const FormatException('未激活工作区存在完整同步事实');
        }
      }
      await super._recoverV2(db);
      return;
    }
    await _verifyLiveV2(db);
    try {
      final stage = await _singleV2(db, 'response');
      if (stage != null) {
        workspaceV2Fields(stage, {
          'responseId',
          'request',
          'response',
          'createdAt',
        });
        if (!workspaceV2Uuid(stage['responseId']) ||
            !workspaceV2SafeInteger(stage['createdAt']) ||
            _now().millisecondsSinceEpoch - (stage['createdAt'] as int) >
                workspaceV2AbsoluteTtlSeconds * 1000) {
          throw const FormatException('响应暂存已过期');
        }
        await _requireResponseV2(db, stage['responseId'] as String);
        for (final ref in await _responseDownloadsV2(
          db,
          workspaceV2Map(stage['response']),
        )) {
          final rows = await db.query(
            'workspace_v2_json_objects',
            where: 'sha256=?',
            whereArgs: [ref['sha256']],
          );
          if (rows.isNotEmpty) {
            final object = await _jsonObject(db, ref['sha256'] as String);
            for (final i in ref['receivedIndexes'] as List) {
              await _jsonChunk(db, object, i as int);
            }
            if (object['complete'] == true) await _verifiedJson(db, object);
          }
        }
      }
    } on FormatException {
      await _discardResponseV2(db);
    } on StateError {
      await _discardResponseV2(db);
    }
  }

  @override
  Future<Map<String, dynamic>> loadV2Workspace() =>
      _database.transaction((txn) async {
        await _recoverV2(txn);
        final live = await _liveV2(txn), records = <Map<String, dynamic>>[];
        var pendingCount = 0, sendable = 0, inflightCount = 0;
        for (final local in await _entitiesV2(txn, 'records')) {
          final kind = local['kind'] as String, id = local['id'] as String;
          final baseline = await _entityV2(txn, 'baselines', kind, id),
              pending = await _entityV2(txn, 'pending', kind, id),
              inflight = await _entityV2(txn, 'inflight', kind, id),
              conflict = await _entityV2(txn, 'conflicts', kind, id),
              blocked = await _entityV2(txn, 'blocked', kind, id);
          if (pending != null) pendingCount++;
          if (inflight != null) inflightCount++;
          final metadata = await _effectiveV2Metadata(txn, live, local);
          if ((inflight != null ||
                  pending != null &&
                      metadata['write'] == true &&
                      (pending['deleted'] != true ||
                          metadata['deletable'] == true)) &&
              conflict == null &&
              blocked?['active'] != true &&
              _scopeWritableV2(live, kind)) {
            sendable++;
          }
          records.add({
            ...local,
            'metadata': metadata,
            'remoteRevision': baseline?['revision'] ?? 0,
            'remoteSequence': baseline?['sequence'] ?? 0,
            'pending': pending,
            'inflight': inflight,
            'conflict': conflict,
            'blocked': blocked?['active'] == true ? blocked : null,
            'writable':
                _scopeWritableV2(live, kind) &&
                metadata['write'] == true &&
                (baseline == null ||
                    workspaceDomainV2Inspect(
                          kind,
                          id,
                          local['json'] as String,
                        )['writable'] ==
                        true),
          });
        }
        final stage = await _singleV2(txn, 'response');
        return {
          ...live,
          'records': records,
          'pendingCount': pendingCount,
          'sendableCount': sendable,
          'inflightCount': inflightCount,
          'response': stage == null
              ? null
              : {
                  'responseId': stage['responseId'],
                  'downloads': await _responseDownloadsV2(
                    txn,
                    workspaceV2Map(stage['response']),
                  ),
                },
        };
      });
  @override
  Future<List<Map<String, dynamic>>> loadV2Records() =>
      _database.transaction((txn) async {
        await _recoverV2(txn);
        final result = <Map<String, dynamic>>[];
        for (final local in await _entitiesV2(txn, 'records')) {
          final base = await _entityV2(
            txn,
            'baselines',
            local['kind'] as String,
            local['id'] as String,
          );
          result.add({
            ...?base,
            'kind': local['kind'],
            'id': local['id'],
            'deleted': local['deleted'],
            'json': local['json'],
            'metadata': local['metadata'],
            if (base == null) 'payload': _payloadV2(local['json'] as String),
          });
        }
        return result;
      });

  @override
  Future<Map<String, dynamic>> v2Status() => _database.transaction((txn) async {
    await _recoverV2(txn);
    final state = await _v2State(txn);
    if (state['activeProtocol'] != 2) return await _legacyV2Status(txn);
    final binding = await _state(txn), live = await _liveV2(txn);
    return {
      ...state,
      'workspaceId': binding['workspaceId'],
      'deviceId': binding['deviceId'],
      'enabled': binding['enabled'],
      'upgrade': null,
      'downloads': <Map<String, dynamic>>[],
      'live': live,
    };
  });
  Future<Map<String, dynamic>> _legacyV2Status(DatabaseExecutor db) async {
    final state = await _v2State(db),
        binding = await _state(db),
        stage = await _v2Stage(db);
    final downloads = <Map<String, dynamic>>[], seen = <String>{};
    if (stage?['manifest'] != null) {
      for (final record in await _v2Rows(db, 'workspace_v2_staged_records')) {
        final payload = workspaceV2Map(record['payload']);
        if (payload['encoding'] != 'blob') continue;
        final ref = workspaceV2Map(payload['ref']);
        if (!seen.add(ref['sha256'] as String)) continue;
        final rows = await db.query(
          'workspace_v2_json_objects',
          where: 'sha256=?',
          whereArgs: [ref['sha256']],
        );
        final object = rows.isEmpty
            ? null
            : await _jsonObject(db, ref['sha256'] as String);
        downloads.add({
          ...ref,
          'record': {
            'kind': record['kind'],
            'id': record['id'],
            'revision': record['revision'],
            'manifestId': (stage!['manifest'] as Map)['manifestId'],
          },
          'complete': object?['complete'] == true,
          'receivedIndexes': [
            for (final row in await db.query(
              'workspace_v2_json_chunks',
              columns: ['chunk_index'],
              where: 'sha256=?',
              whereArgs: [ref['sha256']],
              orderBy: 'chunk_index',
            ))
              row['chunk_index'],
          ],
        });
      }
    }
    return {
      ...state,
      'workspaceId': binding['workspaceId'],
      'deviceId': binding['deviceId'],
      'enabled': binding['enabled'],
      'upgrade': stage,
      'downloads': downloads,
    };
  }

  @override
  Future<Map<String, dynamic>> loadV2BlockedPreview(String kind, String id) =>
      _database.transaction((txn) async {
        final snapshot = await _blockedSnapshotV2(txn, kind, id);
        final local = workspaceV2Map(snapshot['local']),
            blocked = workspaceV2Map(snapshot['blocked']),
            remote = snapshot['baseline'] as Map?;
        return _copyV2({
          'kind': kind,
          'id': id,
          'expectedLocalRevision': local['localRevision'],
          'expectedOperationId': (blocked['receipt'] as Map)['operationId'],
          'expectedRemoteRevision':
              (remote?['record'] as Map?)?['revision'] ?? 0,
          'code': (blocked['receipt'] as Map)['code'],
          'local': {'json': local['json'], 'deleted': local['deleted']},
          'remote': remote,
        });
      });

  void _verifyArchivedPayloadV2(Object? payload, Object? raw) {
    final value = workspaceV2ValidatePayload(payload);
    if (raw is! String) throw const FormatException('拒绝原稿缺失');
    final bytes = utf8.encode(raw);
    final ref = value['encoding'] == 'json'
        ? value
        : workspaceV2Map(value['ref']);
    if (bytes.length != ref['byteLength'] ||
        workspaceV2Sha256Sync(bytes) != ref['sha256'] ||
        value['encoding'] == 'json' && value['json'] != raw) {
      throw const FormatException('拒绝原稿校验失败');
    }
    workspaceV2Map(jsonDecode(raw));
  }

  Future<Map<String, dynamic>> _blockedSnapshotV2(
    DatabaseExecutor db,
    String kind,
    String id,
  ) async {
    if (!['todo', 'work_log'].contains(kind)) {
      throw const FormatException('不支持放弃此类记录');
    }
    await _verifyLiveV2(db);
    final local = await _entityV2(db, 'records', kind, id),
        blocked = await _entityV2(db, 'blocked', kind, id),
        baseline = await _entityV2(db, 'baselines', kind, id),
        pending = await _entityV2(db, 'pending', kind, id);
    if (local == null || blocked == null || blocked['active'] != true) {
      throw const WorkspaceConflict();
    }
    final frozen = workspaceV2Map(blocked['frozen']);
    workspaceV2Fields(frozen, {
      'kind',
      'id',
      'localRevision',
      'operationId',
      'base',
      'baseJson',
      'json',
      'deleted',
      'operation',
    });
    final operation = workspaceV2Validate('operation', frozen['operation']),
        receipt = workspaceV2Validate('receipt', blocked['receipt']),
        base = frozen['base'] == null
            ? null
            : workspaceV2Validate('record', frozen['base']);
    if (operation['type'] != 'record' ||
        operation['kind'] != kind ||
        operation['id'] != id ||
        frozen['operationId'] != operation['operationId'] ||
        frozen['localRevision'] != operation['localRevision'] ||
        frozen['deleted'] != (operation['next'] as Map)['deleted'] ||
        operation['baseRevision'] != (base?['revision'] ?? 0) ||
        (base == null && frozen['baseJson'] != null) ||
        base != null && (base['kind'] != kind || base['id'] != id) ||
        !workspaceJsonEqual(
          operation['base'],
          base == null
              ? null
              : {'deleted': base['deleted'], 'payload': base['payload']},
        )) {
      throw const FormatException('拒绝冻结操作绑定损坏');
    }
    _verifyArchivedPayloadV2(
      (operation['next'] as Map)['payload'],
      frozen['json'],
    );
    if (base != null) {
      _verifyArchivedPayloadV2(base['payload'], frozen['baseJson']);
    }
    final receiptRecord = receipt['record'] == null
        ? null
        : workspaceV2Validate('record', receipt['record']);
    if (receiptRecord != null &&
        (receiptRecord['kind'] != kind || receiptRecord['id'] != id)) {
      throw const FormatException('拒绝回执实体不匹配');
    }
    return {
      'kind': kind,
      'id': id,
      'local': local,
      'pending': pending,
      'blocked': blocked,
      'baseline': baseline == null
          ? null
          : {'record': baseline, 'json': await _v2Body(db, baseline)},
      'receiptRecord': receiptRecord == null
          ? null
          : {'record': receiptRecord, 'json': await _v2Body(db, receiptRecord)},
    };
  }

  @override
  Future<void> discardV2Blocked(
    String kind,
    String id, {
    required int expectedLocalRevision,
    required String expectedOperationId,
    required int expectedRemoteRevision,
  }) => _database.transaction((txn) async {
    final snapshot = await _blockedSnapshotV2(txn, kind, id),
        local = workspaceV2Map(snapshot['local']),
        blocked = workspaceV2Map(snapshot['blocked']),
        baseline = snapshot['baseline'] as Map?;
    if (local['localRevision'] != expectedLocalRevision ||
        (blocked['receipt'] as Map)['operationId'] != expectedOperationId ||
        ((baseline?['record'] as Map?)?['revision'] ?? 0) !=
            expectedRemoteRevision) {
      throw const WorkspaceConflict();
    }
    if (await _entityV2(txn, 'inflight', kind, id) != null ||
        await _singleV2(txn, 'response') != null) {
      throw StateError('请先取得并处理在途同步回执');
    }
    await txn.insert('workspace_v2_history', {
      'id': workspaceId(),
      'payload': await _encode({
        ...snapshot,
        'decision': 'discard_blocked',
        'resolvedAt': _now().toUtc().toIso8601String(),
      }),
    });
    if (baseline == null) {
      await _deleteEntityV2(txn, 'records', kind, id);
    } else {
      await _cleanLocalV2(txn, workspaceV2Map(baseline['record']), local);
    }
    for (final table in ['pending', 'blocked', 'conflicts']) {
      await _deleteEntityV2(txn, table, kind, id);
    }
  });

  @override
  Future<String?> resolveV2Conflict(
    String kind,
    String id, {
    required bool keepLocal,
    required int expectedLocalRevision,
    required int expectedRemoteRevision,
  }) => _database.transaction((txn) async {
    final live = await _liveV2(txn),
        conflict = await _entityV2(txn, 'conflicts', kind, id),
        local = await _entityV2(txn, 'records', kind, id),
        remote = await _entityV2(txn, 'baselines', kind, id);
    if (conflict == null ||
        local == null ||
        remote == null ||
        local['localRevision'] != expectedLocalRevision ||
        remote['revision'] != expectedRemoteRevision ||
        conflict['localRevision'] != expectedLocalRevision ||
        conflict['remoteRevision'] != expectedRemoteRevision) {
      throw const WorkspaceConflict();
    }
    if (await _entityV2(txn, 'inflight', kind, id) != null) {
      throw StateError('请先取得在途操作回执');
    }
    String? newId;
    Map<String, dynamic>? next;
    if (keepLocal) {
      if (kind == 'todo' &&
          remote['deleted'] == true &&
          local['deleted'] != true) {
        await _assertWriteV2(txn, live, 'todo', null);
        final body = workspaceDomainV2MapBody(local);
        if (workspaceDomainV2Inspect(
                  'todo',
                  id,
                  local['json'] as String,
                )['writable'] !=
                true ||
            workspaceDomainV2Inspect(
                  'todo',
                  id,
                  await _v2Body(txn, remote),
                )['writable'] !=
                true ||
            (local['metadata'] as Map)['source'] != 'manual' ||
            (remote['metadata'] as Map)['source'] != 'manual') {
          throw StateError('请在电脑恢复此待办');
        }
        final create = {
          for (final key in [
            'title',
            'category',
            'isExtra',
            'plannedDate',
            'segment',
            'dateRange',
            'projectId',
            'stageKey',
            'status',
            'trackingMode',
            'progress',
            'progressBeforeComplete',
            'completedAt',
          ])
            key: body.containsKey(key)
                ? body[key]
                : key == 'isExtra'
                ? false
                : null,
        };
        workspaceDomainV2Validate('todoCreate', create);
        newId = workspaceId();
        next = await _saveV2(txn, 'todo', newId, create, false, 0);
      } else {
        await _assertWriteV2(
          txn,
          live,
          kind,
          local,
          deleting: local['deleted'] == true,
        );
        final remoteBody = workspaceV2Map(
              jsonDecode(await _v2Body(txn, remote)),
            ),
            localBody = workspaceDomainV2MapBody(local);
        final body = kind == 'todo'
            ? {
                ...remoteBody,
                for (final key in workspaceDomainV2TodoUnits.values.expand(
                  (v) => v,
                ))
                  if (localBody.containsKey(key)) key: localBody[key],
              }
            : {...remoteBody, 'totalMinutes': localBody['totalMinutes']};
        if (kind == 'todo') await _projectV2(txn, body, null);
        final resolution = workspaceDomainV2Resolve({
          'kind': kind,
          'id': id,
          'baseRevision': remote['revision'],
          'currentRevision': remote['revision'],
          'base': {'deleted': remote['deleted'], 'body': remoteBody},
          'current': {'deleted': remote['deleted'], 'body': remoteBody},
          'next': {
            'deleted': local['deleted'],
            'body': local['deleted'] == true ? remoteBody : body,
          },
        });
        if (!['apply', 'noop'].contains(resolution['status'])) {
          throw StateError('此版本不能覆盖远端，请在电脑处理');
        }
        final json = local['deleted'] == true
            ? await _v2Body(txn, remote)
            : jsonEncode(resolution['body']);
        next = _localV2(
          kind,
          id,
          _nextV2Revision(expectedLocalRevision),
          json,
          local['deleted'] as bool,
          workspaceV2Map(remote['metadata']),
        );
      }
    }
    await txn.insert('workspace_v2_history', {
      'id': workspaceId(),
      'payload': await _encode({
        'conflict': conflict,
        'decision': keepLocal ? 'local' : 'remote',
        'newId': newId,
        'resolvedAt': _now().toUtc().toIso8601String(),
      }),
    });
    for (final table in ['pending', 'conflicts', 'blocked']) {
      await _deleteEntityV2(txn, table, kind, id);
    }
    if (next != null && newId == null) {
      await _putEntityV2(txn, 'records', next);
      await _putEntityV2(txn, 'pending', {
        'kind': kind,
        'id': id,
        'localRevision': next['localRevision'],
        'operationId': workspaceId(),
        'base': remote,
        'baseJson': await _v2Body(txn, remote),
        'json': next['json'],
        'deleted': next['deleted'],
      });
    } else {
      await _cleanLocalV2(txn, remote, local);
    }
    return newId;
  });
}
