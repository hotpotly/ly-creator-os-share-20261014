part of 'workspace_store.dart';

const workspaceV2PermissionBytes = 16 * 1024 * 1024;

class WorkspaceV2PermissionBudgetExceeded extends StateError {
  WorkspaceV2PermissionBudgetExceeded() : super('权限快照超过16MiB，原记录已保留');
}

abstract interface class WorkspaceV2PermissionStore {
  Future<Map<String, dynamic>> v2PermissionStatus();
  Future<Map<String, dynamic>> beginV2PermissionRefresh({bool retry = false});
  Future<void> attachV2PermissionManifest(
    String refreshId,
    Map<String, dynamic> manifest,
  );
  Future<void> appendV2PermissionPage(
    String refreshId,
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  );
  Future<void> commitV2Permissions(String refreshId);
  Future<void> cancelV2PermissionRefresh(String refreshId);
}

Future<void> _createV2PermissionTables(DatabaseExecutor db) async {
  await db.execute(
    'CREATE TABLE workspace_v2_permission_state(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)',
  );
  await db.execute(
    'CREATE TABLE workspace_v2_permission_pages(page_index INTEGER PRIMARY KEY,payload TEXT NOT NULL)',
  );
  await db.execute(
    'CREATE TABLE workspace_v2_permission_records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
  );
}

mixin _WorkspaceV2Permissions on _WorkspaceV2Incremental
    implements WorkspaceV2PermissionStore {
  String _permissionDigest(Map<String, dynamic> live) => workspaceV2Sha256Sync(
    utf8.encode(
      workspaceV2CanonicalJson({
        'workspaceId': live['workspaceId'],
        'deviceId': live['deviceId'],
        'scopes': live['scopes'],
        'permissions': (live['capabilitiesResponse'] as Map?)?['permissions'],
      }),
    ),
  );

  Future<Map<String, dynamic>> _permissionState(DatabaseExecutor db) async {
    final saved = await _singleV2(db, 'permission_state');
    if (saved == null) {
      final v2 = await _v2State(db);
      if (v2['permissionsInitialized'] == true) {
        throw const FormatException('已初始化的权限状态缺失');
      }
      for (final table in ['permission_pages', 'permission_records']) {
        if ((await db.query(
          'workspace_v2_$table',
          columns: ['payload'],
          limit: 1,
        )).isNotEmpty) {
          throw const FormatException('权限证明缺少来源');
        }
      }
      final live = await _liveV2(db);
      final state = <String, dynamic>{
        'epoch': 0,
        'digest': _permissionDigest(live),
        'completed': null,
        'stage': null,
        'response': null,
        'blockedReason': null,
        'requests': <Map<String, dynamic>>[],
      };
      for (final baseline in await _entitiesV2(db, 'baselines')) {
        await _putPermissionProof(db, state, baseline);
      }
      await _putSingleV2(db, 'permission_state', state);
      await _putV2State(db, {...v2, 'permissionsInitialized': true});
      return state;
    }
    if ((await _v2State(db))['permissionsInitialized'] != true) {
      throw const FormatException('权限初始化标识缺失');
    }
    workspaceV2Fields(saved, {
      'epoch',
      'digest',
      'completed',
      'stage',
      'response',
      'blockedReason',
      'requests',
    });
    if (saved['blockedReason'] != null &&
        saved['blockedReason'] != 'too_large') {
      throw const FormatException('权限暂存失败状态损坏');
    }
    if (!workspaceV2SafeInteger(saved['epoch']) ||
        !workspaceV2Hash(saved['digest'])) {
      throw const FormatException('权限证明状态损坏');
    }
    final requests = saved['requests'];
    if (requests is! List || requests.length > 16) {
      throw const FormatException('权限请求来源损坏');
    }
    final ids = <String>{};
    for (final raw in requests) {
      final request = workspaceV2Map(raw);
      workspaceV2Fields(request, {'context', 'epoch', 'digest', 'requestHash'});
      if (!workspaceV2Uuid(request['context']) ||
          !ids.add(request['context'] as String) ||
          !workspaceV2SafeInteger(request['epoch']) ||
          (request['epoch'] as int) > (saved['epoch'] as int) ||
          !workspaceV2Hash(request['digest']) ||
          !workspaceV2Hash(request['requestHash'])) {
        throw const FormatException('权限请求来源损坏');
      }
    }
    if (saved['completed'] != null) {
      final completed = workspaceV2Map(saved['completed']);
      workspaceV2Fields(completed, {'epoch', 'digest', 'manifestHash'});
      if (completed['epoch'] != saved['epoch'] ||
          completed['digest'] != saved['digest'] ||
          !workspaceV2Hash(completed['manifestHash'])) {
        throw const FormatException('权限完成证明损坏');
      }
    }
    if (saved['response'] != null) {
      final response = workspaceV2Map(saved['response']);
      workspaceV2Fields(response, {'responseId', 'epoch', 'digest'});
      if (!workspaceV2Uuid(response['responseId']) ||
          !workspaceV2SafeInteger(response['epoch']) ||
          !workspaceV2Hash(response['digest'])) {
        throw const FormatException('权限响应来源损坏');
      }
    }
    return saved;
  }

  Future<void> _cancelPermissionStage(
    DatabaseExecutor db,
    Map<String, dynamic> state,
  ) async {
    await db.delete('workspace_v2_permission_pages');
    await _putSingleV2(db, 'permission_state', {...state, 'stage': null});
  }

  @override
  Future<void> _v2PermissionsChanged(
    DatabaseExecutor db,
    Map<String, dynamic> oldLive,
    Map<String, dynamic> nextLive, {
    bool invalidated = false,
  }) async {
    final state = await _permissionState(db),
        digest = _permissionDigest(nextLive);
    if (!invalidated &&
        state['digest'] == digest &&
        oldLive['suspended'] == nextLive['suspended']) {
      return;
    }
    final epoch = (state['epoch'] as int) + 1;
    if (!workspaceV2SafeInteger(epoch)) throw StateError('权限版本已达上限');
    await db.delete('workspace_v2_permission_records');
    await _cancelPermissionStage(db, {
      ...state,
      'epoch': epoch,
      'digest': digest,
      'completed': null,
      'blockedReason': null,
    });
  }

  Map<String, dynamic> _proofRecord(Map<String, dynamic> raw) {
    final record = workspaceV2Validate('record', raw),
        payload = workspaceV2Map(record['payload']);
    final ref = payload['encoding'] == 'blob'
        ? workspaceV2Map(payload['ref'])
        : <String, dynamic>{
            'sha256': payload['sha256'],
            'byteLength': payload['byteLength'],
            'mediaType': 'application/json',
          };
    return {
      ...record,
      'payload': {'encoding': 'blob', 'ref': ref},
    };
  }

  bool _samePermissionRecord(
    Map<String, dynamic> proof,
    Map<String, dynamic> record,
  ) =>
      [
        'kind',
        'id',
        'revision',
        'sequence',
        'deleted',
      ].every((key) => proof[key] == record[key]) &&
      workspaceJsonEqual(
        _proofRecord(proof)['payload'],
        _proofRecord(record)['payload'],
      );

  Map<String, dynamic> _deniedMetadata(Map<String, dynamic> metadata) => {
    ...metadata,
    'write': false,
    'deletable': false,
    'editableFields': <String>[],
  };

  @override
  Future<Map<String, dynamic>> _effectiveV2Metadata(
    DatabaseExecutor db,
    Map<String, dynamic> live,
    Map<String, dynamic> local,
  ) async {
    final metadata = workspaceV2Map(local['metadata']);
    if (!_scopeWritableV2(live, local['kind'] as String)) {
      return _deniedMetadata(metadata);
    }
    final baseline = await _entityV2(
      db,
      'baselines',
      local['kind'] as String,
      local['id'] as String,
    );
    if (baseline == null) return metadata;
    final state = await _permissionState(db);
    final proof = await _entityV2(
      db,
      'permission_records',
      local['kind'] as String,
      local['id'] as String,
    );
    if (proof != null &&
        proof['epoch'] == state['epoch'] &&
        proof['digest'] == _permissionDigest(live) &&
        _samePermissionRecord(workspaceV2Map(proof['record']), baseline)) {
      return workspaceV2Map((proof['record'] as Map)['metadata']);
    }
    return _deniedMetadata(metadata);
  }

  @override
  Future<String?> _v2PreparePermissionOrigin(
    DatabaseExecutor db,
    Map<String, dynamic> request,
  ) async {
    final state = await _permissionState(db), context = workspaceId();
    final requests = [
      ...(state['requests'] as List),
      {
        'context': context,
        'epoch': state['epoch'],
        'digest': state['digest'],
        'requestHash': workspaceV2Sha256Sync(
          utf8.encode(workspaceV2CanonicalJson(request)),
        ),
      },
    ];
    await _putSingleV2(db, 'permission_state', {
      ...state,
      'requests': requests
          .skip(requests.length > 16 ? requests.length - 16 : 0)
          .toList(),
    });
    return context;
  }

  Map<String, dynamic>? _permissionRequest(
    Map<String, dynamic> state,
    Map<String, dynamic> request,
    String? context,
  ) {
    final hash = workspaceV2Sha256Sync(
      utf8.encode(workspaceV2CanonicalJson(request)),
    );
    for (final raw in state['requests'] as List) {
      final origin = workspaceV2Map(raw);
      if (origin['context'] == context && origin['requestHash'] == hash) {
        return origin;
      }
    }
    return null;
  }

  @override
  Future<bool> _v2CurrentRequestPermissions(
    DatabaseExecutor db,
    Map<String, dynamic> request,
    String? context,
  ) async {
    final state = await _permissionState(db),
        origin = _permissionRequest(state, request, context);
    return origin?['epoch'] == state['epoch'] &&
        origin?['digest'] == state['digest'];
  }

  @override
  Future<void> _v2ResponsePermissionOrigin(
    DatabaseExecutor db,
    String responseId,
    Map<String, dynamic> request,
    String? context,
  ) async {
    final state = await _permissionState(db);
    if ((state['response'] as Map?)?['responseId'] == responseId) return;
    final origin = _permissionRequest(state, request, context);
    await _putSingleV2(db, 'permission_state', {
      ...state,
      'response': origin == null
          ? null
          : {
              'responseId': responseId,
              'epoch': origin['epoch'],
              'digest': origin['digest'],
            },
      'requests': (state['requests'] as List)
          .where((r) => r['context'] != context)
          .toList(),
    });
  }

  @override
  Future<bool> _v2HistoricalPermissionResponse(
    DatabaseExecutor db,
    String responseId,
  ) async {
    final state = await _permissionState(db),
        origin = state['response'] as Map?;
    return origin?['responseId'] != responseId ||
        origin?['epoch'] != state['epoch'] ||
        origin?['digest'] != state['digest'];
  }

  Future<void> _putPermissionProof(
    DatabaseExecutor db,
    Map<String, dynamic> state,
    Map<String, dynamic> record,
  ) => _putEntityV2(db, 'permission_records', {
    'kind': record['kind'],
    'id': record['id'],
    'epoch': state['epoch'],
    'digest': state['digest'],
    'record': _proofRecord(record),
  });

  Future<bool> _hasPermissionProof(
    DatabaseExecutor db,
    Map<String, dynamic> state,
    Map<String, dynamic> baseline,
  ) async {
    final proof = await _entityV2(
      db,
      'permission_records',
      baseline['kind'] as String,
      baseline['id'] as String,
    );
    return proof != null &&
        proof['epoch'] == state['epoch'] &&
        proof['digest'] == state['digest'] &&
        _samePermissionRecord(workspaceV2Map(proof['record']), baseline);
  }

  @override
  Future<void> _v2ResponsePermissionsCommitted(
    DatabaseExecutor db,
    String responseId,
    List<Map<String, dynamic>> changes,
    Map<String, Map<String, dynamic>?> priorBaselines,
  ) async {
    final state = await _permissionState(db),
        origin = state['response'] as Map?;
    final live = await _liveV2(db);
    if (origin?['responseId'] == responseId &&
        origin?['epoch'] == state['epoch'] &&
        origin?['digest'] == _permissionDigest(live) &&
        live['suspended'] != true) {
      for (final record in changes) {
        final base = await _entityV2(
          db,
          'baselines',
          record['kind'] as String,
          record['id'] as String,
        );
        if (base != null && _samePermissionRecord(record, base)) {
          await _putPermissionProof(db, state, record);
        }
      }
    }
    var gap = false;
    for (final entry in priorBaselines.entries) {
      final split = entry.key.indexOf(':');
      final baseline = await _entityV2(
        db,
        'baselines',
        entry.key.substring(0, split),
        entry.key.substring(split + 1),
      );
      if (baseline != null &&
          (entry.value == null ||
              !_samePermissionRecord(entry.value!, baseline)) &&
          !await _hasPermissionProof(db, state, baseline)) {
        gap = true;
        break;
      }
    }
    final next = {...state, 'response': null};
    if (gap) {
      await _cancelPermissionStage(db, {...next, 'completed': null});
    } else {
      await _putSingleV2(db, 'permission_state', next);
    }
  }

  Future<Map<String, dynamic>> _requirePermissionStage(
    DatabaseExecutor db,
    String refreshId, {
    bool requireEnabled = true,
  }) async {
    final state = await _permissionState(db),
        stage = workspaceV2Map(state['stage']);
    workspaceV2Fields(stage, {
      'refreshId',
      'epoch',
      'digest',
      'knownSequence',
      'createdAt',
      'manifest',
      'checkpoint',
      'bytes',
    });
    final live = await _liveV2(db), binding = await _state(db);
    if (stage['refreshId'] != refreshId ||
        !workspaceV2Uuid(refreshId) ||
        stage['epoch'] != state['epoch'] ||
        stage['digest'] != state['digest'] ||
        stage['digest'] != _permissionDigest(live) ||
        requireEnabled && binding['enabled'] != true ||
        live['suspended'] == true ||
        !workspaceV2SafeInteger(stage['knownSequence']) ||
        !workspaceV2SafeInteger(stage['createdAt']) ||
        !workspaceV2SafeInteger(
          stage['bytes'],
          maximum: workspaceV2PermissionBytes,
        ) ||
        _now().millisecondsSinceEpoch - (stage['createdAt'] as int) >=
            24 * 60 * 60 * 1000) {
      throw StateError('权限快照已失效，原记录已保留');
    }
    if ((stage['manifest'] == null) != (stage['checkpoint'] == null)) {
      throw const FormatException('权限快照检查点缺失');
    }
    if (stage['manifest'] != null) {
      final manifest = workspaceV2Map(stage['manifest']);
      beginWorkspaceSnapshot(manifest, now: _now());
      if (manifest['workspaceId'] != live['workspaceId'] ||
          manifest['deviceId'] != live['deviceId'] ||
          manifest['scopeDigest'] != live['scopeDigest'] ||
          !workspaceJsonEqual(manifest['scopes'], live['scopes']) ||
          (manifest['through'] as int) < (stage['knownSequence'] as int)) {
        throw const FormatException('权限快照身份或水位不匹配');
      }
    }
    return stage;
  }

  Future<List<Map<String, dynamic>>> _permissionPages(
    DatabaseExecutor db,
    Map<String, dynamic> stage,
  ) async {
    final rows = await db.query(
      'workspace_v2_permission_pages',
      orderBy: 'page_index',
    );
    if (stage['manifest'] == null) {
      if (rows.isNotEmpty) throw const FormatException('权限页缺少清单');
      return [];
    }
    final manifest = workspaceV2Map(stage['manifest']);
    var checkpoint = beginWorkspaceSnapshot(manifest, now: _now()), bytes = 0;
    final records = <Map<String, dynamic>>[];
    for (var index = 0; index < rows.length; index++) {
      if (rows[index]['page_index'] != index) {
        throw const FormatException('权限页链缺失');
      }
      final page = await _decode(rows[index]['payload'] as String);
      workspaceV2Fields(page, {'request', 'response'});
      bytes += utf8.encode(workspaceV2CanonicalJson(page)).length;
      if (bytes > workspaceV2PermissionBytes) {
        throw WorkspaceV2PermissionBudgetExceeded();
      }
      checkpoint = advanceWorkspaceSnapshot(
        manifest: manifest,
        request: workspaceV2Map(page['request']),
        response: workspaceV2Map(page['response']),
        checkpoint: checkpoint,
        now: _now(),
      );
      records.addAll(
        ((page['response'] as Map)['records'] as List).map(workspaceV2Map),
      );
    }
    if (bytes + utf8.encode(workspaceV2CanonicalJson(stage)).length >
        workspaceV2PermissionBytes) {
      throw WorkspaceV2PermissionBudgetExceeded();
    }
    if (bytes != stage['bytes'] ||
        !workspaceJsonEqual(checkpoint.toJson(), stage['checkpoint'])) {
      throw const FormatException('权限检查点损坏');
    }
    if (checkpoint.finished) {
      workspaceV2VerifyManifest(manifest, records);
    }
    return records;
  }

  @override
  Future<Map<String, dynamic>> v2PermissionStatus() =>
      _database.transaction((txn) async {
        await _recoverV2(txn);
        final state = await _permissionState(txn);
        var missing = false;
        if (state['completed'] == null && state['blockedReason'] == null) {
          for (final baseline in await _entitiesV2(txn, 'baselines')) {
            if (!await _hasPermissionProof(txn, state, baseline)) {
              missing = true;
              break;
            }
          }
        }
        return _copyV2({
          ...state,
          'required':
              state['completed'] == null &&
              ((state['epoch'] as int) > 0 || missing) &&
              state['blockedReason'] == null,
        });
      });

  @override
  Future<Map<String, dynamic>> beginV2PermissionRefresh({bool retry = false}) =>
      _database.transaction((txn) async {
        final live = await _liveV2(txn), state = await _permissionState(txn);
        if (state['blockedReason'] != null && !retry) {
          throw WorkspaceV2PermissionBudgetExceeded();
        }
        if ((await _state(txn))['enabled'] != true ||
            live['suspended'] == true ||
            live['capabilitiesResponse'] == null ||
            state['digest'] != _permissionDigest(live)) {
          throw StateError('工作区权限尚未就绪');
        }
        if (state['stage'] == null) {
          await _putSingleV2(txn, 'permission_state', {
            ...state,
            'blockedReason': null,
            'stage': {
              'refreshId': workspaceId(),
              'epoch': state['epoch'],
              'digest': state['digest'],
              'knownSequence': live['knownSequence'],
              'createdAt': _now().millisecondsSinceEpoch,
              'manifest': null,
              'checkpoint': null,
              'bytes': 0,
            },
          });
        }
        final current = await _permissionState(txn);
        final stage = await _requirePermissionStage(
          txn,
          (current['stage'] as Map)['refreshId'] as String,
        );
        return _copyV2({
          ...stage,
          'request': {
            'protocolVersion': 2,
            'workspaceId': live['workspaceId'],
            'deviceId': live['deviceId'],
            'scopes': live['scopes'],
          },
        });
      });

  @override
  Future<void> attachV2PermissionManifest(
    String refreshId,
    Map<String, dynamic> manifest,
  ) async {
    final received = _copyV2(manifest);
    await _database.transaction((txn) async {
      final state = await _permissionState(txn),
          stage = await _requirePermissionStage(txn, refreshId);
      if (stage['manifest'] != null) {
        if (!workspaceJsonEqual(stage['manifest'], received)) {
          throw StateError('权限清单已存在');
        }
        return;
      }
      final checkpoint = beginWorkspaceSnapshot(received, now: _now());
      await _putSingleV2(txn, 'permission_state', {
        ...state,
        'stage': {
          ...stage,
          'manifest': received,
          'checkpoint': checkpoint.toJson(),
        },
      });
      await _requirePermissionStage(txn, refreshId);
    });
  }

  @override
  Future<void> appendV2PermissionPage(
    String refreshId,
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  ) async {
    final sent = _copyV2(request), received = _copyV2(response);
    workspaceV2Validate('snapshotPageRequest', sent);
    workspaceV2Validate('snapshotPageResponse', received);
    final sanitized = {
      ...received,
      'records': (received['records'] as List)
          .map((r) => _proofRecord(workspaceV2Map(r)))
          .toList(),
    };
    final page = {'request': sent, 'response': sanitized};
    final size = utf8.encode(workspaceV2CanonicalJson(page)).length;
    final success = await _database.transaction((txn) async {
      final state = await _permissionState(txn),
          stage = await _requirePermissionStage(txn, refreshId);
      final bytes = (stage['bytes'] as int) + size;
      final checkpoint = advanceWorkspaceSnapshot(
        manifest: workspaceV2Map(stage['manifest']),
        request: sent,
        response: sanitized,
        checkpoint: WorkspaceSnapshotCheckpoint.fromJson(
          workspaceV2Map(stage['checkpoint']),
        ),
        now: _now(),
      );
      final next = {
        ...stage,
        'bytes': bytes,
        'checkpoint': checkpoint.toJson(),
      };
      if (bytes + utf8.encode(workspaceV2CanonicalJson(next)).length >
          workspaceV2PermissionBytes) {
        await _cancelPermissionStage(txn, {
          ...state,
          'blockedReason': 'too_large',
        });
        return false;
      }
      final live = await _liveV2(txn);
      for (final r in sanitized['records'] as List) {
        if ((r['metadata'] as Map)['write'] == true &&
            !_scopeWritableV2(live, r['kind'] as String)) {
          throw const FormatException('权限快照扩大授权');
        }
      }
      final count = Sqflite.firstIntValue(
        await txn.rawQuery(
          'SELECT COUNT(*) FROM workspace_v2_permission_pages',
        ),
      )!;
      await txn.insert('workspace_v2_permission_pages', {
        'page_index': count,
        'payload': await _encode(page),
      });
      await _putSingleV2(txn, 'permission_state', {...state, 'stage': next});
      return true;
    });
    if (!success) throw WorkspaceV2PermissionBudgetExceeded();
  }

  @override
  Future<void> commitV2Permissions(String refreshId) =>
      _database.transaction((txn) async {
        final state = await _permissionState(txn),
            stage = await _requirePermissionStage(txn, refreshId);
        final records = await _permissionPages(txn, stage),
            checkpoint = WorkspaceSnapshotCheckpoint.fromJson(
              workspaceV2Map(stage['checkpoint']),
            );
        if (!checkpoint.finished) throw StateError('权限快照尚未完整');
        workspaceV2VerifyManifest(workspaceV2Map(stage['manifest']), records);
        for (final record in records) {
          final base = await _entityV2(
            txn,
            'baselines',
            record['kind'] as String,
            record['id'] as String,
          );
          if (base != null && _samePermissionRecord(record, base)) {
            await _putPermissionProof(txn, state, record);
          }
        }
        await _cancelPermissionStage(txn, {
          ...state,
          'completed': {
            'epoch': state['epoch'],
            'digest': state['digest'],
            'manifestHash': checkpoint.manifestHash,
          },
        });
      });

  @override
  Future<void> cancelV2PermissionRefresh(String refreshId) =>
      _database.transaction((txn) async {
        final state = await _permissionState(txn);
        if ((state['stage'] as Map?)?['refreshId'] == refreshId) {
          await _cancelPermissionStage(txn, state);
        }
      });

  @override
  Future<void> _recoverV2(DatabaseExecutor db) async {
    await super._recoverV2(db);
    if ((await _v2State(db))['activeProtocol'] != 2) {
      for (final table in [
        'permission_state',
        'permission_pages',
        'permission_records',
      ]) {
        if ((await db.query(
          'workspace_v2_$table',
          columns: ['payload'],
          limit: 1,
        )).isNotEmpty) {
          throw const FormatException('未激活工作区存在权限事实');
        }
      }
      return;
    }
    final state = await _permissionState(db);
    for (final proof in await _entitiesV2(db, 'permission_records')) {
      workspaceV2Fields(proof, {'kind', 'id', 'epoch', 'digest', 'record'});
      final record = workspaceV2Validate('record', proof['record']);
      if (!workspaceV2SafeInteger(proof['epoch']) ||
          (proof['epoch'] as int) > (state['epoch'] as int) ||
          !workspaceV2Hash(proof['digest']) ||
          proof['kind'] != record['kind'] ||
          proof['id'] != record['id']) {
        throw const FormatException('有效权限证明损坏');
      }
    }
    if (state['stage'] != null) {
      try {
        final stage = await _requirePermissionStage(
          db,
          (state['stage'] as Map)['refreshId'] as String,
          requireEnabled: false,
        );
        await _permissionPages(db, stage);
      } on FormatException {
        await _cancelPermissionStage(db, state);
      } on StateError {
        await _cancelPermissionStage(db, state);
      }
    } else if ((await db.query(
      'workspace_v2_permission_pages',
      columns: ['payload'],
      limit: 1,
    )).isNotEmpty) {
      await db.delete('workspace_v2_permission_pages');
    }
  }
}
