part of 'workspace_store.dart';

class _V2SnapshotBudgetExceeded extends StateError {
  _V2SnapshotBudgetExceeded() : super('完整快照正文超过本机256MiB暂存上限');
}

abstract interface class WorkspaceV2Persistence {
  Future<Map<String, dynamic>> v2Status();
  Future<int> reserveV2Counter();
  Future<void> setV2ApprovedScopes(List<String> scopes);
  Future<Map<String, dynamic>> prepareV2Upgrade(
    Map<String, dynamic> capabilitiesRequest,
    Map<String, dynamic> capabilitiesResponse,
  );
  Future<void> attachV2Manifest(
    String upgradeId,
    Map<String, dynamic> manifest,
  );
  Future<void> appendV2StagePage(
    String upgradeId,
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  );
  Future<void> putV2StageJsonChunk(
    String upgradeId, {
    required String sha256,
    required int index,
    required List<int> bytes,
    required String chunkHash,
  });
  Future<void> activateV2Stage(String upgradeId);
  Future<void> cancelV2Stage();
  Future<List<Map<String, dynamic>>> loadV2Records();
  Future<List<WorkspaceRecord>> loadV2ReviewDrafts();
}

Future<void> _createV2Tables(DatabaseExecutor db) async {
  for (final table in ['state', 'stage']) {
    await db.execute(
      'CREATE TABLE workspace_v2_$table(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)',
    );
  }
  await db.execute(
    'CREATE TABLE workspace_v2_pages(page_index INTEGER PRIMARY KEY,payload TEXT NOT NULL)',
  );
  for (final table in ['staged_records', 'records', 'baselines']) {
    await db.execute(
      'CREATE TABLE workspace_v2_$table(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
    );
  }
  await db.execute(
    'CREATE TABLE workspace_v2_json_objects(sha256 TEXT PRIMARY KEY,payload TEXT NOT NULL)',
  );
  await db.execute(
    'CREATE TABLE workspace_v2_json_chunks(sha256 TEXT NOT NULL,chunk_index INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(sha256,chunk_index))',
  );
  await db.execute(
    'CREATE TABLE workspace_v2_outbox(operation_id TEXT PRIMARY KEY,payload TEXT NOT NULL)',
  );
}

mixin _WorkspaceV2Persistence on _WorkspaceSyncPersistence
    implements WorkspaceV2Persistence {
  DateTime Function() get _now;

  Future<Map<String, dynamic>> _v2State(DatabaseExecutor db) async {
    final rows = await db.query('workspace_v2_state');
    final state = rows.isEmpty
        ? <String, dynamic>{
            'activeProtocol': 1,
            'localMutationEpoch': 0,
            'counter': 0,
            'approvedScopes': <String>[],
            'active': null,
          }
        : await _decode(rows.single['payload'] as String);
    workspaceV2Fields(
      state,
      {
        'activeProtocol',
        'localMutationEpoch',
        'counter',
        'approvedScopes',
        'active',
      },
      optional: {'permissionsInitialized'},
    );
    if (state.containsKey('permissionsInitialized') &&
        state['permissionsInitialized'] != true) {
      throw const FormatException('权限初始化标识损坏');
    }
    if (![1, 2].contains(state['activeProtocol']) ||
        !workspaceV2SafeInteger(state['localMutationEpoch']) ||
        !workspaceV2SafeInteger(state['counter'])) {
      throw const FormatException('升级状态无效');
    }
    workspaceV2ValidateScopes(state['approvedScopes'], allowEmpty: true);
    if ((state['activeProtocol'] == 1) != (state['active'] == null)) {
      throw const FormatException('活动工作区合同无效');
    }
    if (state['active'] != null) {
      final active = workspaceV2Map(state['active']);
      workspaceV2Fields(
        active,
        {'manifest', 'barrier', 'upgradeId'},
        optional: {'capabilitiesRequest', 'capabilitiesResponse'},
      );
      workspaceV2Validate('manifest', active['manifest']);
      WorkspaceUpgradeBarrier.fromJson(workspaceV2Map(active['barrier']));
      if (!workspaceV2Uuid(active['upgradeId'])) {
        throw const FormatException('升级标识无效');
      }
      final binding = await _state(db);
      final manifest = workspaceV2Map(active['manifest']);
      if (manifest['workspaceId'] != binding['workspaceId'] ||
          manifest['deviceId'] != binding['deviceId'] ||
          !(manifest['scopes'] as List).every(
            (scope) => (state['approvedScopes'] as List).contains(scope),
          )) {
        throw const FormatException('活动工作区身份无效');
      }
    }
    return state;
  }

  Future<void> _putV2State(
    DatabaseExecutor db,
    Map<String, dynamic> value,
  ) async {
    await db.insert('workspace_v2_state', {
      'id': 1,
      'payload': await _encode(value),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<Map<String, dynamic>?> _v2Stage(DatabaseExecutor db) async {
    final rows = await db.query('workspace_v2_stage');
    if (rows.isEmpty) return null;
    final stage = await _decode(rows.single['payload'] as String);
    workspaceV2Fields(stage, {
      'upgradeId',
      'barrier',
      'capabilitiesRequest',
      'capabilitiesResponse',
      'createdAt',
      'manifest',
      'checkpoint',
    });
    if (!workspaceV2Uuid(stage['upgradeId']) ||
        !workspaceV2SafeInteger(stage['createdAt'])) {
      throw const FormatException('升级暂存状态无效');
    }
    WorkspaceUpgradeBarrier.fromJson(workspaceV2Map(stage['barrier']));
    workspaceV2Validate('capabilitiesRequest', stage['capabilitiesRequest']);
    workspaceV2Validate('capabilitiesResponse', stage['capabilitiesResponse']);
    if ((stage['manifest'] == null) != (stage['checkpoint'] == null)) {
      throw const FormatException('升级检查点缺失');
    }
    if (stage['manifest'] != null) {
      workspaceV2Validate('manifest', stage['manifest']);
      WorkspaceSnapshotCheckpoint.fromJson(workspaceV2Map(stage['checkpoint']));
    }
    return stage;
  }

  Future<void> _putV2Stage(
    DatabaseExecutor db,
    Map<String, dynamic> value,
  ) async {
    await db.insert('workspace_v2_stage', {
      'id': 1,
      'payload': await _encode(value),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<void> _cancelV2Stage(DatabaseExecutor db) async {
    for (final table in ['stage', 'pages', 'staged_records']) {
      await db.delete('workspace_v2_$table');
    }
    if ((await _v2State(db))['activeProtocol'] == 1) {
      await db.delete('workspace_v2_json_chunks');
      await db.delete('workspace_v2_json_objects');
    }
  }

  @override
  Future<void> _assertV1Records(DatabaseExecutor db) async {
    if ((await _v2State(db))['activeProtocol'] != 1) {
      throw StateError('工作区已升级，请使用完整工作区接口');
    }
  }

  @override
  Future<void> _assertV1Transport(DatabaseExecutor db) async {
    await _assertV1Records(db);
    if ((await _state(db))['enabled'] != true) {
      throw StateError('工作台同步未开启');
    }
    if ((await db.query('workspace_v2_stage', columns: ['id'])).isNotEmpty) {
      throw StateError('工作区升级中，旧同步已暂停');
    }
  }

  @override
  Future<void> _noteV1Mutation(DatabaseExecutor db) async {
    final state = await _v2State(db);
    final epoch = (state['localMutationEpoch'] as int) + 1;
    if (!workspaceV2SafeInteger(epoch)) throw StateError('本地修订计数已达上限');
    await _putV2State(db, {...state, 'localMutationEpoch': epoch});
    await _cancelV2Stage(db);
  }

  Future<Map<String, int>> _v1QueueCounts(DatabaseExecutor db) async {
    final result = <String, int>{};
    for (final entry in {
      'pending': 'workspace_outbox',
      'inflight': 'workspace_sync_inflight',
      'conflicts': 'workspace_sync_conflicts',
    }.entries) {
      result[entry.key] =
          Sqflite.firstIntValue(
            await db.rawQuery(
              "SELECT COUNT(*) FROM ${entry.value} WHERE kind IN ('todo','work_log')",
            ),
          ) ??
          0;
    }
    return result;
  }

  Future<WorkspaceUpgradeBarrier> _v2Barrier(
    DatabaseExecutor db,
    String scopesHash,
  ) async {
    final v1 = await _state(db);
    final v2 = await _v2State(db);
    final records = <Map<String, dynamic>>[];
    for (final row in await db.query(
      'workspace_records',
      where: "kind IN ('todo','work_log')",
      orderBy: 'kind,id',
    )) {
      final record = await _decodeLocal(row);
      if (record.id != row['id'] ||
          record.kind != row['kind'] ||
          record.revision != row['revision']) {
        throw const FormatException('本地工作区记录校验失败');
      }
      records.add(record.toJson());
    }
    var known = 0;
    for (final row in await db.query('workspace_sync_baselines')) {
      final remote = await _decode(row['payload'] as String);
      workspaceRemoteRecord(remote);
      if ((remote['sequence'] as int) > known) {
        known = remote['sequence'] as int;
      }
    }
    return WorkspaceUpgradeBarrier(
      workspaceId: v1['workspaceId'] as String,
      deviceId: v1['deviceId'] as String,
      scopesHash: scopesHash,
      localMutationEpoch: v2['localMutationEpoch'] as int,
      localRecordsHash: workspaceV2Sha256Sync(utf8.encode(jsonEncode(records))),
      v1Cursor: v1['cursor'] as int,
      v1Counter: v1['counter'] as int,
      v1KnownSequence: known,
    );
  }

  Future<void> _verifyFrozen(
    DatabaseExecutor db,
    Map<String, dynamic> stage,
  ) async {
    final v1 = await _state(db);
    final v2 = await _v2State(db);
    final frozen = WorkspaceUpgradeBarrier.fromJson(
      workspaceV2Map(stage['barrier']),
    );
    final now = _now().millisecondsSinceEpoch;
    if (v1['enabled'] != true ||
        v2['activeProtocol'] != 1 ||
        now >=
            (stage['createdAt'] as int) +
                workspaceV2AbsoluteTtlSeconds * 1000 ||
        v1['workspaceId'] != frozen.workspaceId ||
        v1['deviceId'] != frozen.deviceId ||
        v1['through'] != null ||
        (await _v1QueueCounts(db)).values.any((count) => count != 0) ||
        !workspaceJsonEqual(
          (await _v2Barrier(db, frozen.scopesHash)).toJson(),
          frozen.toJson(),
        )) {
      throw StateError('升级期间工作区已改变，原记录已保留');
    }
    final approved = (v2['approvedScopes'] as List).cast<String>();
    workspaceV2AssertCapabilities(
      stage['capabilitiesRequest'],
      stage['capabilitiesResponse'],
      [
        for (final scope in approved)
          {'scope': scope, 'read': true, 'write': scope != 'project.catalog'},
      ],
    );
    if (workspaceV2ScopeDigest(
          (workspaceV2Map(stage['capabilitiesResponse'])['supportedScopes']
                  as List)
              .cast<String>(),
        ) !=
        frozen.scopesHash) {
      throw const FormatException('能力范围与升级屏障不匹配');
    }
    if (stage['manifest'] != null) {
      final manifest = workspaceV2Map(stage['manifest']);
      if (manifest['workspaceId'] != frozen.workspaceId ||
          manifest['deviceId'] != frozen.deviceId ||
          manifest['scopeDigest'] != frozen.scopesHash) {
        throw const FormatException('升级清单与屏障不匹配');
      }
      beginWorkspaceSnapshot(manifest, now: _now());
    }
  }

  Future<Map<String, dynamic>> _requireStage(
    DatabaseExecutor db,
    String upgradeId, {
    bool manifestRequired = true,
  }) async {
    final stage = await _v2Stage(db);
    if (stage == null ||
        stage['upgradeId'] != upgradeId ||
        (manifestRequired && stage['manifest'] == null)) {
      throw StateError('升级已取消或尚未取得清单');
    }
    await _verifyFrozen(db, stage);
    return stage;
  }

  @override
  Future<void> setV2ApprovedScopes(List<String> scopes) async {
    final approved = List<String>.from(scopes);
    workspaceV2ValidateScopes(approved, allowEmpty: true);
    await _database.transaction((txn) async {
      final state = await _v2State(txn);
      if (state['activeProtocol'] != 1) throw StateError('范围变更需要新的完整快照');
      if (!workspaceJsonEqual(state['approvedScopes'], approved)) {
        await _cancelV2Stage(txn);
        await _putV2State(txn, {...state, 'approvedScopes': approved});
      }
    });
  }

  @override
  Future<int> reserveV2Counter() => _database.transaction((txn) async {
    final binding = await _state(txn);
    if (binding['enabled'] != true) throw StateError('工作台同步未开启');
    final state = await _v2State(txn);
    final next = (state['counter'] as int) + 1;
    if (!workspaceV2SafeInteger(next, minimum: 1)) throw StateError('同步计数已达上限');
    await _putV2State(txn, {...state, 'counter': next});
    return next;
  });

  @override
  Future<Map<String, dynamic>> prepareV2Upgrade(
    Map<String, dynamic> capabilitiesRequest,
    Map<String, dynamic> capabilitiesResponse,
  ) async {
    final request = workspaceV2Map(
      jsonDecode(workspaceV2CanonicalJson(capabilitiesRequest)),
    );
    final response = workspaceV2Map(
      jsonDecode(workspaceV2CanonicalJson(capabilitiesResponse)),
    );
    return _database.transaction((txn) async {
      await _assertV1Transport(txn);
      final binding = await _state(txn);
      final state = await _v2State(txn);
      if (binding['enabled'] != true ||
          request['workspaceId'] != binding['workspaceId'] ||
          request['deviceId'] != binding['deviceId']) {
        throw StateError('升级身份无效或同步未开启');
      }
      workspaceV2AssertCapabilities(request, response, [
        for (final scope in state['approvedScopes'] as List)
          {'scope': scope, 'read': true, 'write': scope != 'project.catalog'},
      ]);
      final scopes = (response['supportedScopes'] as List).cast<String>();
      if (!scopes.contains('todo.full') || !scopes.contains('work_log')) {
        throw StateError('电脑尚不支持完整基础工作区');
      }
      if (binding['through'] != null ||
          (await _v1QueueCounts(txn)).values.any((count) => count != 0)) {
        throw StateError('请先完成旧同步并处理冲突');
      }
      final digest = workspaceV2ScopeDigest(scopes);
      final barrier = await _v2Barrier(txn, digest);
      final upgradeId = workspaceId();
      final stage = <String, dynamic>{
        'upgradeId': upgradeId,
        'barrier': barrier.toJson(),
        'capabilitiesRequest': request,
        'capabilitiesResponse': response,
        'createdAt': _now().millisecondsSinceEpoch,
        'manifest': null,
        'checkpoint': null,
      };
      await _putV2Stage(txn, stage);
      return {
        'upgradeId': upgradeId,
        'request': {
          'protocolVersion': 2,
          'workspaceId': binding['workspaceId'],
          'deviceId': binding['deviceId'],
          'scopes': scopes,
          'scopeDigest': digest,
        },
      };
    });
  }

  @override
  Future<void> attachV2Manifest(
    String upgradeId,
    Map<String, dynamic> manifest,
  ) async {
    final value = workspaceV2Validate(
      'manifest',
      workspaceV2Map(jsonDecode(workspaceV2CanonicalJson(manifest))),
    );
    await _database.transaction((txn) async {
      final stage = await _requireStage(
        txn,
        upgradeId,
        manifestRequired: false,
      );
      final barrier = WorkspaceUpgradeBarrier.fromJson(
        workspaceV2Map(stage['barrier']),
      );
      if (value['workspaceId'] != barrier.workspaceId ||
          value['deviceId'] != barrier.deviceId ||
          value['scopeDigest'] != barrier.scopesHash) {
        throw const FormatException('升级清单身份或范围不匹配');
      }
      if (stage['manifest'] != null) {
        if (!workspaceJsonEqual(stage['manifest'], value)) {
          throw StateError('不能替换在途升级清单');
        }
        return;
      }
      final checkpoint = beginWorkspaceSnapshot(value, now: _now());
      await _putV2Stage(txn, {
        ...stage,
        'manifest': value,
        'checkpoint': checkpoint.toJson(),
      });
    });
  }

  @override
  Future<void> appendV2StagePage(
    String upgradeId,
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  ) async {
    final sent = workspaceV2Map(jsonDecode(workspaceV2CanonicalJson(request)));
    final received = workspaceV2Map(
      jsonDecode(workspaceV2CanonicalJson(response)),
    );
    try {
      await _database.transaction((txn) async {
        final stage = await _requireStage(txn, upgradeId);
        final manifest = workspaceV2Map(stage['manifest']);
        final rows = await txn.query(
          'workspace_v2_pages',
          orderBy: 'page_index',
        );
        if (rows.isNotEmpty) {
          final previous = await _decode(rows.last['payload'] as String);
          if (workspaceJsonEqual(previous['request'], sent) &&
              workspaceJsonEqual(previous['response'], received)) {
            return;
          }
        }
        final checkpoint = advanceWorkspaceSnapshot(
          manifest: manifest,
          request: sent,
          response: received,
          checkpoint: WorkspaceSnapshotCheckpoint.fromJson(
            workspaceV2Map(stage['checkpoint']),
          ),
          now: _now(),
        );
        for (final raw in received['records'] as List) {
          final record = workspaceV2Map(raw);
          _assertV2RecordPermissions(stage, record);
          await txn.insert('workspace_v2_staged_records', {
            'kind': record['kind'],
            'id': record['id'],
            'payload': await _encode(record),
          });
        }
        final sizes = <String, int>{};
        for (final record in await _v2Rows(
          txn,
          'workspace_v2_staged_records',
        )) {
          final payload = workspaceV2Map(record['payload']);
          final hash = workspaceV2PayloadHash(payload);
          final length =
              (payload['encoding'] == 'json'
                      ? payload['byteLength']
                      : (payload['ref'] as Map)['byteLength'])
                  as int;
          if (sizes.containsKey(hash) && sizes[hash] != length) {
            throw const FormatException('快照正文长度声明冲突');
          }
          sizes[hash] = length;
        }
        if (sizes.values.fold<int>(0, (a, b) => a + b) >
            workspaceV2DeviceTemporaryBytes) {
          throw _V2SnapshotBudgetExceeded();
        }
        await txn.insert('workspace_v2_pages', {
          'page_index': rows.length,
          'payload': await _encode({'request': sent, 'response': received}),
        });
        await _putV2Stage(txn, {...stage, 'checkpoint': checkpoint.toJson()});
      });
    } on _V2SnapshotBudgetExceeded {
      await _database.transaction((txn) async {
        final stage = await _v2Stage(txn);
        if (stage?['upgradeId'] == upgradeId) await _cancelV2Stage(txn);
      });
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> _v2Rows(
    DatabaseExecutor db,
    String table,
  ) async {
    final records = <Map<String, dynamic>>[];
    for (final row in await db.query(table, orderBy: 'kind,id')) {
      final record = workspaceV2Validate(
        'record',
        await _decode(row['payload'] as String),
      );
      if (record['kind'] != row['kind'] || record['id'] != row['id']) {
        throw const FormatException('完整记录索引无效');
      }
      records.add(record);
    }
    records.sort((a, b) {
      final byKind = (a['kind'] as String).compareTo(b['kind'] as String);
      return byKind != 0
          ? byKind
          : (a['id'] as String).compareTo(b['id'] as String);
    });
    return records;
  }

  Future<Map<String, dynamic>> _jsonObject(
    DatabaseExecutor db,
    String hash,
  ) async {
    final rows = await db.query(
      'workspace_v2_json_objects',
      where: 'sha256=?',
      whereArgs: [hash],
    );
    if (rows.length != 1) throw StateError('正文尚未下载');
    final object = await _decode(rows.single['payload'] as String);
    workspaceV2Fields(object, {
      'sha256',
      'byteLength',
      'createdAt',
      'lastActivityAt',
      'complete',
    });
    if (object['sha256'] != hash ||
        !workspaceV2Hash(hash) ||
        !workspaceV2SafeInteger(
          object['byteLength'],
          minimum: 1,
          maximum: workspaceV2JsonBytes,
        ) ||
        !workspaceV2SafeInteger(object['createdAt']) ||
        !workspaceV2SafeInteger(object['lastActivityAt']) ||
        (object['lastActivityAt'] as int) < (object['createdAt'] as int) ||
        object['complete'] is! bool) {
      throw const FormatException('正文下载状态无效');
    }
    if (object['complete'] != true &&
        _now().millisecondsSinceEpoch >=
            workspaceV2SessionExpiry(
              object['createdAt'] as int,
              object['lastActivityAt'] as int,
            )) {
      throw StateError('正文下载已过期');
    }
    return object;
  }

  Future<List<int>> _jsonChunk(
    DatabaseExecutor db,
    Map<String, dynamic> object,
    int index,
  ) async {
    final rows = await db.query(
      'workspace_v2_json_chunks',
      where: 'sha256=? AND chunk_index=?',
      whereArgs: [object['sha256'], index],
    );
    if (rows.length != 1) throw StateError('正文分块不完整');
    final value = await _decode(rows.single['payload'] as String);
    workspaceV2Fields(value, {'sha256', 'index', 'chunkHash', 'bytesBase64'});
    if (value['sha256'] != object['sha256'] ||
        value['index'] != index ||
        !workspaceV2Hash(value['chunkHash'])) {
      throw const FormatException('正文分块索引无效');
    }
    final bytes = workspaceV2DecodeBase64(
      value['bytesBase64'],
      expectedLength: workspaceV2ExpectedChunkLength(
        object['byteLength'] as int,
        index,
      ),
    );
    if (workspaceV2Sha256Sync(bytes) != value['chunkHash']) {
      throw const FormatException('正文分块校验失败');
    }
    return bytes;
  }

  Future<String> _verifiedJson(
    DatabaseExecutor db,
    Map<String, dynamic> object,
  ) async {
    final hash = const DartSha256().newHashSink();
    final text = StringBuffer();
    final decoder = utf8.decoder.startChunkedConversion(
      StringConversionSink.fromStringSink(text),
    );
    final length = object['byteLength'] as int;
    final count = (length + workspaceV2ChunkBytes - 1) ~/ workspaceV2ChunkBytes;
    final actual = Sqflite.firstIntValue(
      await db.rawQuery(
        'SELECT COUNT(*) FROM workspace_v2_json_chunks WHERE sha256=?',
        [object['sha256']],
      ),
    );
    if (actual != count) throw StateError('正文分块不完整');
    for (var index = 0; index < count; index++) {
      final bytes = await _jsonChunk(db, object, index);
      hash.add(bytes);
      decoder.add(bytes);
    }
    hash.close();
    decoder.close();
    final digest = hash
        .hashSync()
        .bytes
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    if (digest != object['sha256']) throw const FormatException('正文完整哈希不匹配');
    final json = text.toString();
    workspaceV2Map(jsonDecode(json));
    return json;
  }

  Future<String> _v2Body(
    DatabaseExecutor db,
    Map<String, dynamic> record,
  ) async {
    final payload = workspaceV2Map(record['payload']);
    if (payload['encoding'] == 'json') return payload['json'] as String;
    final ref = workspaceV2Map(payload['ref']);
    final object = await _jsonObject(db, ref['sha256'] as String);
    if (object['byteLength'] != ref['byteLength'] ||
        object['complete'] != true) {
      throw StateError('正文尚未完整验证');
    }
    return _verifiedJson(db, object);
  }

  @override
  Future<void> putV2StageJsonChunk(
    String upgradeId, {
    required String sha256,
    required int index,
    required List<int> bytes,
    required String chunkHash,
  }) async {
    final input = List<int>.of(bytes);
    if (!workspaceV2Hash(sha256) ||
        !workspaceV2Hash(chunkHash) ||
        !workspaceV2SafeInteger(index) ||
        input.any((b) => b < 0 || b > 255) ||
        workspaceV2Sha256Sync(input) != chunkHash) {
      throw const FormatException('正文分块校验失败');
    }
    await _database.transaction((txn) async {
      await _requireStage(txn, upgradeId);
      final records = await _v2Rows(txn, 'workspace_v2_staged_records');
      final refs = records
          .map((r) => workspaceV2Map(r['payload']))
          .where((p) => p['encoding'] == 'blob')
          .map((p) => workspaceV2Map(p['ref']))
          .where((r) => r['sha256'] == sha256)
          .toList();
      if (refs.isEmpty ||
          refs.any((r) => r['byteLength'] != refs.first['byteLength'])) {
        throw const FormatException('正文不属于本次快照');
      }
      await _putVerifiedV2JsonChunk(txn, refs.first, index, input, chunkHash);
    });
  }

  Future<Set<String>> _retainedV2JsonHashes(DatabaseExecutor db) async => {
    for (final record in await _v2Rows(db, 'workspace_v2_baselines'))
      workspaceV2PayloadHash(workspaceV2Map(record['payload'])),
  };

  Future<void> _putVerifiedV2JsonChunk(
    DatabaseExecutor txn,
    Map<String, dynamic> ref,
    int index,
    List<int> input,
    String chunkHash,
  ) async {
    final sha256 = ref['sha256'] as String;
    final length = ref['byteLength'] as int;
    if (input.length != workspaceV2ExpectedChunkLength(length, index)) {
      throw const FormatException('正文分块长度无效');
    }
    Map<String, dynamic> object;
    final existing = await txn.query(
      'workspace_v2_json_objects',
      where: 'sha256=?',
      whereArgs: [sha256],
    );
    final now = _now().millisecondsSinceEpoch;
    if (existing.isEmpty) {
      var reserved = 0, active = 0;
      final retained = await _retainedV2JsonHashes(txn);
      for (final row in await txn.query('workspace_v2_json_objects')) {
        final value = await _jsonObject(txn, row['sha256'] as String);
        if (!retained.contains(value['sha256'])) {
          reserved += value['byteLength'] as int;
        }
        if (value['complete'] != true) active++;
      }
      if (active >= workspaceV2Limits['concurrentDownloads']! ||
          reserved + length > workspaceV2DeviceTemporaryBytes) {
        throw StateError('正文暂存已达上限');
      }
      object = {
        'sha256': sha256,
        'byteLength': length,
        'createdAt': now,
        'lastActivityAt': now,
        'complete': false,
      };
    } else {
      object = await _jsonObject(txn, sha256);
      if (object['byteLength'] != length) {
        throw const FormatException('正文声明已改变');
      }
    }
    final old = await txn.query(
      'workspace_v2_json_chunks',
      where: 'sha256=? AND chunk_index=?',
      whereArgs: [sha256, index],
    );
    if (old.isNotEmpty) {
      final oldBytes = await _jsonChunk(txn, object, index);
      if (base64Encode(oldBytes) != base64Encode(input)) {
        throw const FormatException('不能替换已确认分块');
      }
    } else {
      if (object['complete'] == true) {
        throw const FormatException('已提交正文缺失分块');
      }
      await txn.insert('workspace_v2_json_chunks', {
        'sha256': sha256,
        'chunk_index': index,
        'payload': await _encode({
          'sha256': sha256,
          'index': index,
          'chunkHash': chunkHash,
          'bytesBase64': base64Encode(input),
        }),
      });
    }
    final count =
        Sqflite.firstIntValue(
          await txn.rawQuery(
            'SELECT COUNT(*) FROM workspace_v2_json_chunks WHERE sha256=?',
            [sha256],
          ),
        ) ??
        0;
    if (count ==
        (length + workspaceV2ChunkBytes - 1) ~/ workspaceV2ChunkBytes) {
      await _verifiedJson(txn, object);
      object = {...object, 'complete': true};
    }
    await txn.insert('workspace_v2_json_objects', {
      'sha256': sha256,
      'payload': await _encode({...object, 'lastActivityAt': now}),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Map<String, dynamic>>> _verifyStagePages(
    DatabaseExecutor db,
    Map<String, dynamic> stage,
  ) async {
    final manifest = workspaceV2Map(stage['manifest']);
    var checkpoint = beginWorkspaceSnapshot(manifest, now: _now());
    final all = <Map<String, dynamic>>[];
    final rows = await db.query('workspace_v2_pages', orderBy: 'page_index');
    for (var index = 0; index < rows.length; index++) {
      if (rows[index]['page_index'] != index) {
        throw const FormatException('升级分页缺失');
      }
      final page = await _decode(rows[index]['payload'] as String);
      workspaceV2Fields(page, {'request', 'response'});
      final request = workspaceV2Map(page['request']),
          response = workspaceV2Map(page['response']);
      checkpoint = advanceWorkspaceSnapshot(
        manifest: manifest,
        request: request,
        response: response,
        checkpoint: checkpoint,
        now: _now(),
      );
      for (final raw in response['records'] as List) {
        final record = workspaceV2Map(raw);
        _assertV2RecordPermissions(stage, record);
        all.add(record);
      }
    }
    if (!workspaceJsonEqual(stage['checkpoint'], checkpoint.toJson()) ||
        !workspaceJsonEqual(
          all,
          await _v2Rows(db, 'workspace_v2_staged_records'),
        )) {
      throw const FormatException('升级页链与暂存记录不一致');
    }
    return all;
  }

  void _assertV2RecordPermissions(
    Map<String, dynamic> stage,
    Map<String, dynamic> record,
  ) {
    final metadata = workspaceV2Map(record['metadata']);
    final permissions =
        (stage['capabilitiesResponse'] as Map)['permissions'] as List;
    final permission = permissions
        .where((entry) => entry['scope'] == metadata['scope'])
        .firstOrNull;
    if (permission == null ||
        (metadata['write'] == true && permission['write'] != true)) {
      throw const FormatException('快照记录超出批准权限');
    }
  }

  @override
  Future<void> activateV2Stage(String upgradeId) =>
      _database.transaction((txn) async {
        final stage = await _requireStage(txn, upgradeId);
        final manifest = workspaceV2Map(stage['manifest']);
        final records = await _verifyStagePages(txn, stage);
        final checkpoint = WorkspaceSnapshotCheckpoint.fromJson(
          workspaceV2Map(stage['checkpoint']),
        );
        workspaceV2VerifyManifest(manifest, records);
        for (final record in records) {
          await _v2Body(txn, record);
        }
        final counts = await _v1QueueCounts(txn),
            binding = await _state(txn),
            state = await _v2State(txn);
        final frozen = WorkspaceUpgradeBarrier.fromJson(
          workspaceV2Map(stage['barrier']),
        );
        verifyWorkspaceUpgradeActivation(
          frozen: frozen,
          current: await _v2Barrier(txn, frozen.scopesHash),
          proof: WorkspaceUpgradeProof(
            manifestId: manifest['manifestId'] as String,
            workspaceId: manifest['workspaceId'] as String,
            deviceId: manifest['deviceId'] as String,
            scopesHash: manifest['scopeDigest'] as String,
            expectedRecords: manifest['entityCount'] as int,
            verifiedRecords: records.length,
            expectedDigest: manifest['entriesSha256'] as String,
            actualDigest: workspaceV2ManifestDigest(records),
            allPagesVerified: checkpoint.finished,
            pendingJsonObjects: 0,
            manifestValid: true,
          ),
          activeProtocol: state['activeProtocol'] as int,
          pendingV1: counts['pending']!,
          inflightV1: counts['inflight']!,
          conflictsV1: counts['conflicts']!,
          v1Through: binding['through'] as int?,
          invalidated: false,
        );
        if ((await txn.query('workspace_v2_records')).isNotEmpty ||
            (await txn.query('workspace_v2_baselines')).isNotEmpty ||
            (await txn.query('workspace_v2_outbox')).isNotEmpty) {
          throw const FormatException('完整工作区目标不为空');
        }
        for (final record in records) {
          final row = {
            'kind': record['kind'],
            'id': record['id'],
            'payload': await _encode(record),
          };
          await txn.insert('workspace_v2_records', row);
          await txn.insert('workspace_v2_baselines', row);
        }
        await _putV2State(txn, {
          ...state,
          'activeProtocol': 2,
          'active': {
            'manifest': manifest,
            'barrier': frozen.toJson(),
            'upgradeId': upgradeId,
            'capabilitiesRequest': stage['capabilitiesRequest'],
            'capabilitiesResponse': stage['capabilitiesResponse'],
          },
        });
        await _cancelV2Stage(txn);
      });

  Future<void> _recoverV2(DatabaseExecutor db) async {
    final state = await _v2State(db);
    if (state['activeProtocol'] == 2) {
      final records = await _v2Rows(db, 'workspace_v2_records');
      if (!workspaceJsonEqual(
        records,
        await _v2Rows(db, 'workspace_v2_baselines'),
      )) {
        throw const FormatException('完整工作区基线损坏');
      }
      workspaceV2VerifyManifest(
        workspaceV2Map((state['active'] as Map)['manifest']),
        records,
      );
      for (final record in records) {
        await _v2Body(db, record);
      }
      return;
    }
    if ((await db.query('workspace_v2_records')).isNotEmpty ||
        (await db.query('workspace_v2_baselines')).isNotEmpty ||
        (await db.query('workspace_v2_outbox')).isNotEmpty) {
      throw const FormatException('未激活的完整工作区含正式记录');
    }
    try {
      final stage = await _v2Stage(db);
      if (stage == null) {
        await _cancelV2Stage(db);
        return;
      }
      await _verifyFrozen(db, stage);
      if (stage['manifest'] != null) {
        final records = await _verifyStagePages(db, stage);
        for (final row in await db.query('workspace_v2_json_objects')) {
          final object = await _jsonObject(db, row['sha256'] as String);
          if (!records.any(
            (r) =>
                workspaceV2PayloadHash(workspaceV2Map(r['payload'])) ==
                object['sha256'],
          )) {
            throw const FormatException('正文不属于暂存清单');
          }
          for (final chunk in await db.query(
            'workspace_v2_json_chunks',
            where: 'sha256=?',
            whereArgs: [object['sha256']],
          )) {
            await _jsonChunk(db, object, chunk['chunk_index'] as int);
          }
          if (object['complete'] == true) await _verifiedJson(db, object);
        }
        for (final row in await db.query('workspace_v2_json_chunks')) {
          await _jsonObject(db, row['sha256'] as String);
        }
      }
    } on FormatException {
      await _cancelV2Stage(db);
    } on StateError {
      await _cancelV2Stage(db);
    }
  }

  @override
  Future<Map<String, dynamic>> v2Status() => _database.transaction((txn) async {
    await _recoverV2(txn);
    final state = await _v2State(txn), binding = await _state(txn);
    final stage = await _v2Stage(txn);
    final downloads = <Map<String, dynamic>>[];
    if (stage?['manifest'] != null) {
      final seen = <String>{};
      for (final record in await _v2Rows(txn, 'workspace_v2_staged_records')) {
        final payload = workspaceV2Map(record['payload']);
        if (payload['encoding'] != 'blob') continue;
        final ref = workspaceV2Map(payload['ref']);
        if (!seen.add(ref['sha256'] as String)) continue;
        final rows = await txn.query(
          'workspace_v2_json_objects',
          where: 'sha256=?',
          whereArgs: [ref['sha256']],
        );
        final object = rows.isEmpty
            ? null
            : await _jsonObject(txn, ref['sha256'] as String);
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
            for (final row in await txn.query(
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
  });

  @override
  Future<void> cancelV2Stage() => _database.transaction(_cancelV2Stage);

  @override
  Future<List<Map<String, dynamic>>> loadV2Records() =>
      _database.transaction((txn) async {
        if ((await _v2State(txn))['activeProtocol'] != 2) {
          throw StateError('完整工作区尚未激活');
        }
        final records = await _v2Rows(txn, 'workspace_v2_records');
        return [
          for (final record in records)
            {...record, 'json': await _v2Body(txn, record)},
        ];
      });

  @override
  Future<List<WorkspaceRecord>> loadV2ReviewDrafts() =>
      _database.transaction((txn) async {
        return [
          for (final row in await txn.query(
            'workspace_records',
            where: 'kind=?',
            whereArgs: ['review_draft'],
            orderBy: 'id',
          ))
            await _decodeLocal(row),
        ];
      });
}
