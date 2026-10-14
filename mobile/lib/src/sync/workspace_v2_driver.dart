import 'dart:convert';

import '../model/desktop_connection.dart';
import '../workspace/workspace_sync_models.dart';
import '../workspace/workspace_store.dart';
import '../workspace/workspace_v2_contract.dart';
import 'sync_policy.dart';
import 'workspace_v2_client.dart';

typedef WorkspaceV2Exchange =
    Future<Map<String, dynamic>> Function(
      DesktopConnection connection,
      String purpose,
      Map<String, dynamic> payload, {
      required Future<int> Function() reserveCounter,
      Map<String, dynamic>? expectedBlob,
      List<Map<String, dynamic>>? approvedPermissions,
    });
typedef WorkspaceV2Apply =
    Future<void> Function(Future<void> Function() action);

enum WorkspaceV2RunState {
  complete,
  needsUpgrade,
  disabled,
  paused,
  deferred,
  awaitingAuthorization,
  permissionBlocked,
  needsAttention,
}

class WorkspaceV2RunResult {
  const WorkspaceV2RunResult(
    this.state, {
    this.permissionsRefreshRequired = false,
    this.unconfirmedCount,
    this.permissionBlockReason,
  });
  final WorkspaceV2RunState state;
  final bool permissionsRefreshRequired;
  final int? unconfirmedCount;
  final String? permissionBlockReason;
}

class _DriverYield implements Exception {
  const _DriverYield(this.state);
  final WorkspaceV2RunState state;
}

class _DriverRound {
  _DriverRound(this.generation, this.connection, this.background);
  final int generation;
  final DesktopConnection connection;
  final bool background;
  int requests = 0;
  bool uploadRestarted = false;
  bool permissionsRefreshRequired = false;
  int? unconfirmedCount;
  String? permissionBlockReason;
  Map<String, dynamic> get identity => {
    'protocolVersion': 2,
    'workspaceId': connection.serviceId,
    'deviceId': connection.deviceId,
  };
}

class WorkspaceV2Driver {
  WorkspaceV2Driver({
    required this.store,
    required this.connection,
    required this.apply,
    WorkspaceV2Client? client,
    this.exchange,
    SyncEnvironmentProvider? environment,
    this.maxRequests = 256,
  }) : client = client ?? WorkspaceV2Client(),
       environment = environment ?? const NativeSyncEnvironmentProvider() {
    if (maxRequests < 1 || maxRequests > 10000) {
      throw ArgumentError.value(maxRequests, 'maxRequests');
    }
  }

  static const supportedScopes = [
    'preferences.todo',
    'project.catalog',
    'todo.full',
    'work_log',
  ];
  final SqliteWorkspaceStore store;
  final Future<DesktopConnection?> Function() connection;
  final WorkspaceV2Apply apply;
  final WorkspaceV2Client client;
  final SyncEnvironmentProvider environment;
  final int maxRequests;
  final WorkspaceV2Exchange? exchange;
  Future<WorkspaceV2RunResult>? _running;
  int _generation = 0;

  bool get busy => _running != null;
  Future<void> get settled async {
    try {
      await _running;
    } catch (_) {}
  }

  void cancel() {
    _generation++;
    client.cancel();
  }

  Future<void> cancelUpgrade() async {
    cancel();
    await settled;
    await apply(store.cancelV2Stage);
  }

  Future<WorkspaceV2RunResult> upgrade({required List<String> approvedScopes}) {
    final scopes = List<String>.of(approvedScopes);
    workspaceV2ValidateScopes(scopes);
    if (!scopes.contains('todo.full') ||
        !scopes.contains('work_log') ||
        scopes.any((scope) => !supportedScopes.contains(scope))) {
      throw const FormatException('完整工作区范围无效');
    }
    return _start(scopes, false);
  }

  Future<WorkspaceV2RunResult> resume({bool background = false}) =>
      synchronize(background: background);
  Future<WorkspaceV2RunResult> synchronize({bool background = false}) =>
      _start(null, background);

  Future<WorkspaceV2RunResult> _start(List<String>? scopes, bool background) {
    if (_running != null) throw StateError('完整工作区正在同步');
    final running = _run(scopes, background, _generation);
    _running = running;
    return running.whenComplete(() {
      if (identical(_running, running)) _running = null;
    });
  }

  Future<void> _guard(_DriverRound round, {bool enabled = true}) async {
    if (round.generation != _generation) {
      throw const WorkspaceV2Failure('同步已暂停', cancelled: true);
    }
    final current = await connection();
    if (current == null ||
        current.needsSecurityUpgrade ||
        current.serviceId != round.connection.serviceId ||
        current.deviceId != round.connection.deviceId ||
        current.secretBase64 != round.connection.secretBase64) {
      throw const WorkspaceV2Failure('连接身份已改变，本机数据已保留', requiresPairing: true);
    }
    final status = await store.syncStatus();
    if (status['workspaceId'] != current.serviceId ||
        status['deviceId'] != current.deviceId) {
      throw const WorkspaceV2Failure('工作区绑定不匹配', requiresPairing: true);
    }
    if (round.generation != _generation) {
      throw const WorkspaceV2Failure('同步已暂停', cancelled: true);
    }
    if (enabled && status['enabled'] != true) {
      throw const _DriverYield(WorkspaceV2RunState.disabled);
    }
  }

  Future<void> _apply(_DriverRound round, Future<void> Function() action) =>
      apply(() async {
        await _guard(round);
        await action();
      });

  List<Map<String, dynamic>> _permissions(List<String> scopes) => [
    for (final scope in scopes)
      {
        'scope': scope,
        'read': true,
        'write': scope == 'todo.full' || scope == 'work_log',
      },
  ];

  Future<Map<String, dynamic>> _call(
    _DriverRound round,
    String purpose,
    Map<String, dynamic> payload, {
    Map<String, dynamic>? ref,
    List<String>? scopes,
  }) async {
    await _guard(round);
    final policy = await environment.read();
    if (!policy.allows(
      attachments: purpose.startsWith('blob.'),
      background: round.background,
    )) {
      throw const _DriverYield(WorkspaceV2RunState.paused);
    }
    await _guard(round);
    if (round.requests >= maxRequests) {
      throw const _DriverYield(WorkspaceV2RunState.deferred);
    }
    round.requests++;
    final result = await (exchange ?? client.request)(
      round.connection,
      purpose,
      payload,
      reserveCounter: () async {
        await _guard(round);
        return store.reserveV2Counter();
      },
      expectedBlob: ref,
      approvedPermissions: scopes == null ? null : _permissions(scopes),
    );
    await _guard(round);
    return result;
  }

  Future<Map<String, dynamic>> _capabilities(
    _DriverRound round,
    List<String> scopes,
  ) async {
    if (scopes.any((scope) => !supportedScopes.contains(scope))) {
      throw const FormatException('本机尚未启用此工作区范围');
    }
    final request = {...round.identity, 'clientScopes': scopes};
    final response = await _call(
      round,
      'capabilities',
      request,
      scopes: scopes,
    );
    workspaceV2AssertCapabilities(request, response, _permissions(scopes));
    return {'request': request, 'response': response};
  }

  Future<WorkspaceV2RunResult> _run(
    List<String>? scopes,
    bool background,
    int generation,
  ) async {
    _DriverRound? round;
    var acquired = false;
    try {
      final status = await store.v2Status();
      if (status['enabled'] != true) {
        return const WorkspaceV2RunResult(WorkspaceV2RunState.disabled);
      }
      if (scopes == null &&
          status['activeProtocol'] == 1 &&
          status['upgrade'] == null) {
        return const WorkspaceV2RunResult(WorkspaceV2RunState.needsUpgrade);
      }
      if (scopes != null && status['activeProtocol'] != 1) {
        throw StateError('完整工作区已经启用');
      }
      final current = await connection();
      if (current == null) {
        throw const WorkspaceV2Failure('请先连接电脑', requiresPairing: true);
      }
      round = _DriverRound(generation, current, background);
      await _guard(round);
      acquired = await environment.acquireWifi();
      if (!acquired) {
        return const WorkspaceV2RunResult(WorkspaceV2RunState.paused);
      }
      if (status['activeProtocol'] == 1) {
        if (scopes != null) {
          if (status['upgrade'] != null) throw StateError('请先继续或取消当前升级');
          await _apply(round, () => store.setV2ApprovedScopes(scopes));
          final caps = await _capabilities(round, scopes);
          if (!workspaceJsonEqual(
            (caps['response'] as Map)['supportedScopes'],
            scopes,
          )) {
            throw const WorkspaceV2Failure('电脑尚未授权全部选定范围');
          }
          await _apply(round, () async {
            await store.prepareV2Upgrade(
              workspaceV2Map(caps['request']),
              workspaceV2Map(caps['response']),
            );
          });
        }
        await _upgrade(round);
      }
      final result = await _synchronize(round);
      return WorkspaceV2RunResult(
        result,
        permissionsRefreshRequired: round.permissionsRefreshRequired,
        unconfirmedCount: round.unconfirmedCount,
        permissionBlockReason: round.permissionBlockReason,
      );
    } on _DriverYield catch (yielded) {
      return WorkspaceV2RunResult(
        yielded.state,
        permissionsRefreshRequired: round?.permissionsRefreshRequired ?? false,
        unconfirmedCount: round?.unconfirmedCount,
        permissionBlockReason: round?.permissionBlockReason,
      );
    } on WorkspaceV2Failure catch (failure) {
      if (failure.requiresPairing &&
          round != null &&
          round.generation == _generation) {
        await apply(() async {
          if (round!.generation != _generation) return;
          final status = await store.v2Status();
          if (status['workspaceId'] != round.connection.serviceId ||
              status['deviceId'] != round.connection.deviceId) {
            return;
          }
          if (status['activeProtocol'] == 2) {
            await store.invalidateV2Capabilities();
          } else {
            await store.cancelV2Stage();
          }
        });
      }
      rethrow;
    } finally {
      if (acquired) await environment.releaseWifi();
    }
  }

  Future<Map<String, dynamic>> _stage(_DriverRound round, String id) async {
    await _guard(round);
    final stage = (await store.v2Status())['upgrade'];
    if (stage is! Map || stage['upgradeId'] != id) {
      throw StateError('本机记录已改变，升级已取消');
    }
    return workspaceV2Map(stage);
  }

  Future<void> _checkStageCapabilities(_DriverRound round, String id) async {
    final stage = await _stage(round, id);
    final scopes =
        ((stage['capabilitiesRequest'] as Map)['clientScopes'] as List)
            .cast<String>();
    final caps = workspaceV2Map(
      (await _capabilities(round, scopes))['response'],
    );
    final frozen = workspaceV2Map(stage['capabilitiesResponse']);
    if (!workspaceJsonEqual(
          caps['supportedScopes'],
          frozen['supportedScopes'],
        ) ||
        !workspaceJsonEqual(caps['permissions'], frozen['permissions'])) {
      await _apply(round, store.cancelV2Stage);
      throw const WorkspaceV2Failure('授权范围已改变，本次升级已取消');
    }
  }

  Future<void> _upgrade(_DriverRound round) async {
    final initial = (await store.v2Status())['upgrade'];
    if (initial is! Map) throw StateError('没有可继续的升级');
    final id = initial['upgradeId'] as String;
    await _checkStageCapabilities(round, id);
    var stage = await _stage(round, id);
    if (stage['manifest'] == null) {
      final scopes =
          ((stage['capabilitiesResponse'] as Map)['supportedScopes'] as List)
              .cast<String>();
      final manifest = await _call(round, 'snapshot.start', {
        ...round.identity,
        'scopes': scopes,
        'scopeDigest': workspaceV2ScopeDigest(scopes),
      });
      await _guard(round);
      await store.attachV2Manifest(id, manifest);
    }
    var pageLimit = 100;
    while (true) {
      stage = await _stage(round, id);
      final checkpoint = workspaceV2Map(stage['checkpoint']);
      if (checkpoint['finished'] == true) break;
      final request = {
        ...round.identity,
        'manifestId': (stage['manifest'] as Map)['manifestId'],
        'after': checkpoint['nextToken'],
        'limit': pageLimit,
      };
      try {
        final response = await _call(round, 'snapshot.page', request);
        await store.appendV2StagePage(id, request, response);
      } on WorkspaceV2Failure catch (failure) {
        if (!failure.tooLarge || pageLimit == 1) rethrow;
        pageLimit = (pageLimit ~/ 2).clamp(1, 100);
      }
    }
    await _download(
      round,
      (await store.v2Status())['downloads'] as List,
      (hash, index, bytes, chunkHash) => store.putV2StageJsonChunk(
        id,
        sha256: hash,
        index: index,
        bytes: bytes,
        chunkHash: chunkHash,
      ),
    );
    await _checkStageCapabilities(round, id);
    await _apply(round, () => store.activateV2Stage(id));
  }

  Future<void> _download(
    _DriverRound round,
    List<dynamic> downloads,
    Future<void> Function(String, int, List<int>, String) put,
  ) async {
    for (final raw in downloads) {
      final download = workspaceV2Map(raw);
      if (download['complete'] == true) continue;
      final ref = {
        'sha256': download['sha256'],
        'byteLength': download['byteLength'],
        'mediaType': download['mediaType'],
      };
      final count =
          ((ref['byteLength'] as int) + workspaceV2ChunkBytes - 1) ~/
          workspaceV2ChunkBytes;
      for (var index = 0; index < count; index++) {
        if ((download['receivedIndexes'] as List).contains(index)) continue;
        final chunk = await _call(round, 'blob.read', {
          ...round.identity,
          'record': download['record'],
          'sha256': ref['sha256'],
          'index': index,
        }, ref: ref);
        await _guard(round);
        await put(
          ref['sha256'] as String,
          index,
          workspaceV2DecodeBase64(chunk['bytesBase64']),
          chunk['chunkSha256'] as String,
        );
      }
    }
  }

  Future<void> _finishResponse(
    _DriverRound round,
    Map<String, dynamic> response,
  ) async {
    final id = response['responseId'] as String;
    await _download(
      round,
      response['downloads'] as List,
      (hash, index, bytes, chunkHash) => store.putV2ResponseJsonChunk(
        id,
        sha256: hash,
        index: index,
        bytes: bytes,
        chunkHash: chunkHash,
      ),
    );
    await _apply(round, () => store.commitV2SyncResponse(id));
  }

  Future<void> _resetUploads(
    _DriverRound round,
    List<Map<String, dynamic>> uploads,
  ) async {
    if (round.uploadRestarted || uploads.isEmpty) {
      throw const WorkspaceV2Failure(
        '上传暂存无法恢复，本机原稿已保留',
        uploadSessionExpired: true,
      );
    }
    round.uploadRestarted = true;
    for (final upload in uploads) {
      await _guard(round);
      await store.resetV2Upload(
        upload['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        reason: 'server_expired',
      );
    }
  }

  Future<void> _upload(_DriverRound round, Map<String, dynamic> upload) async {
    if (upload['committed'] == true) return;
    final ref = workspaceV2Map(upload['ref']),
        operationId = upload['operationId'] as String;
    final hash = ref['sha256'] as String;
    var session = upload['checkpoint'] == null
        ? await _call(round, 'blob.start', {
            ...round.identity,
            'uploadId': upload['uploadId'],
            'scope': upload['scope'],
            'entity': {'kind': upload['kind'], 'id': upload['id']},
            'purpose': 'document',
            ...ref,
          })
        : await _call(round, 'blob.status', {
            ...round.identity,
            'sessionId': (upload['checkpoint'] as Map)['sessionId'],
          });
    await store.saveV2UploadCheckpoint(operationId, hash, session);
    final count =
        ((ref['byteLength'] as int) + workspaceV2ChunkBytes - 1) ~/
        workspaceV2ChunkBytes;
    for (var index = 0; index < count; index++) {
      if ((session['receivedIndexes'] as List).contains(index)) continue;
      final chunk = await store.loadV2UploadChunk(operationId, hash, index);
      await _call(round, 'blob.chunk', {
        ...round.identity,
        'sessionId': session['sessionId'],
        'index': index,
        'sha256': chunk['chunkHash'],
        'bytesBase64': base64Encode(List<int>.from(chunk['bytes'] as List)),
      });
      session = await _call(round, 'blob.status', {
        ...round.identity,
        'sessionId': session['sessionId'],
      });
      await store.saveV2UploadCheckpoint(operationId, hash, session);
    }
    final committed = await _call(
      round,
      'blob.commit',
      {...round.identity, 'sessionId': session['sessionId'], ...ref}
        ..remove('mediaType'),
    );
    await store.markV2UploadCommitted(operationId, hash, committed);
  }

  Future<void> _refreshCapabilities(_DriverRound round) async {
    final live = await store.loadV2Workspace();
    final scopes = (live['scopes'] as List).cast<String>();
    final caps = await _capabilities(round, scopes);
    await _apply(
      round,
      () => store.refreshV2Capabilities(
        workspaceV2Map(caps['request']),
        workspaceV2Map(caps['response']),
      ),
    );
  }

  Future<Map<String, dynamic>> _permissionProgress(_DriverRound round) async {
    final state = await store.v2PermissionStatus();
    round.permissionsRefreshRequired =
        state['required'] == true ||
        state['stage'] != null ||
        state['blockedReason'] != null;
    round.permissionBlockReason = state['blockedReason'] as String?;
    return state;
  }

  Future<Map<String, dynamic>> _permissionStage(
    _DriverRound round,
    String refreshId,
    int epoch,
  ) async {
    await _guard(round);
    final state = await store.v2PermissionStatus();
    final stage = state['stage'];
    if (state['epoch'] != epoch ||
        stage is! Map ||
        stage['refreshId'] != refreshId) {
      throw const _DriverYield(WorkspaceV2RunState.deferred);
    }
    return workspaceV2Map(stage);
  }

  Future<void> _refreshPermissionMetadata(_DriverRound round) async {
    final initial = await store.beginV2PermissionRefresh();
    final id = initial['refreshId'] as String, epoch = initial['epoch'] as int;
    var stage = await _permissionStage(round, id, epoch);
    if (stage['manifest'] == null) {
      final request = workspaceV2Map(initial['request']);
      request['scopeDigest'] = workspaceV2ScopeDigest(
        (request['scopes'] as List).cast<String>(),
      );
      final manifest = await _call(round, 'snapshot.start', request);
      await _permissionStage(round, id, epoch);
      await store.attachV2PermissionManifest(id, manifest);
    }
    var pageLimit = 100;
    while (true) {
      stage = await _permissionStage(round, id, epoch);
      final checkpoint = workspaceV2Map(stage['checkpoint']);
      if (checkpoint['finished'] == true) break;
      final request = {
        ...round.identity,
        'manifestId': (stage['manifest'] as Map)['manifestId'],
        'after': checkpoint['nextToken'],
        'limit': pageLimit,
      };
      Map<String, dynamic> response;
      try {
        response = await _call(round, 'snapshot.page', request);
      } on WorkspaceV2Failure catch (failure) {
        if (failure.snapshotExpired) {
          await _apply(round, () => store.cancelV2PermissionRefresh(id));
          throw const _DriverYield(WorkspaceV2RunState.deferred);
        }
        if (failure.tooLarge && pageLimit > 1) {
          pageLimit = (pageLimit ~/ 2).clamp(1, 100);
          continue;
        }
        rethrow;
      }
      await _permissionStage(round, id, epoch);
      await store.appendV2PermissionPage(id, request, response);
    }
    await _refreshCapabilities(round);
    await _permissionStage(round, id, epoch);
    await _apply(round, () async {
      await _permissionStage(round, id, epoch);
      await store.commitV2Permissions(id);
    });
    await _permissionProgress(round);
  }

  List<Map<String, dynamic>> _unconfirmed(
    _DriverRound round,
    Map<String, dynamic> live,
  ) {
    final records = (live['records'] as List)
        .map(workspaceV2Map)
        .where(
          (record) =>
              record['pending'] != null ||
              record['inflight'] != null ||
              record['conflict'] != null ||
              record['blocked'] != null,
        )
        .toList();
    round.unconfirmedCount = records.length;
    return records;
  }

  Future<WorkspaceV2RunState> _synchronize(_DriverRound round) async {
    await _refreshCapabilities(round);
    var live = await store.loadV2Workspace();
    if (live['suspended'] == true) {
      throw const WorkspaceV2Failure('授权范围已改变，本机记录已保留');
    }
    _unconfirmed(round, live);
    await _permissionProgress(round);
    if (live['response'] != null) {
      await _finishResponse(round, workspaceV2Map(live['response']));
      await _permissionProgress(round);
    }
    var operationLimit = 100;
    while (true) {
      await _guard(round);
      Map<String, dynamic> prepared;
      try {
        prepared = await store.prepareV2Sync(operationLimit: operationLimit);
      } on WorkspaceV2PrepareTooLarge {
        if (operationLimit == 1) rethrow;
        operationLimit = (operationLimit ~/ 2).clamp(1, 100);
        continue;
      }
      final uploads = (prepared['uploads'] as List)
          .map(workspaceV2Map)
          .toList();
      var restart = false;
      for (final upload in uploads) {
        try {
          await _upload(round, upload);
        } on WorkspaceV2Failure catch (failure) {
          if (!failure.uploadSessionExpired) rethrow;
          await _resetUploads(round, [upload]);
          restart = true;
          break;
        }
      }
      if (restart) continue;
      final request = workspaceV2Map(prepared['payload']);
      Map<String, dynamic> response;
      try {
        response = await _call(round, 'sync', request);
      } on WorkspaceV2Failure catch (failure) {
        final count = (request['operations'] as List).length;
        if (failure.tooLarge && count > 1) {
          operationLimit = (count ~/ 2).clamp(1, 100);
          continue;
        }
        if (failure.uploadSessionExpired) {
          await _resetUploads(round, uploads);
          continue;
        }
        rethrow;
      }
      await _guard(round);
      final staged = await store.stageV2SyncResponse(
        request,
        response,
        permissionContext: prepared['permissionContext'] as String?,
      );
      await _finishResponse(round, staged);
      live = await store.loadV2Workspace();
      _unconfirmed(round, live);
      final permissionState = await _permissionProgress(round);
      if (live['through'] != null ||
          live['sendableCount'] != 0 ||
          (live['knownSequence'] as int) > (live['cursor'] as int)) {
        continue;
      }
      if (permissionState['blockedReason'] != null) {
        round.permissionBlockReason =
            permissionState['blockedReason'] as String;
        return WorkspaceV2RunState.permissionBlocked;
      }
      if (permissionState['required'] == true ||
          permissionState['stage'] != null) {
        try {
          await _refreshPermissionMetadata(round);
        } on WorkspaceV2PermissionBudgetExceeded {
          round.permissionBlockReason =
              (await store.v2PermissionStatus())['blockedReason'] as String?;
          return WorkspaceV2RunState.permissionBlocked;
        }
        live = await store.loadV2Workspace();
        _unconfirmed(round, live);
        if (live['sendableCount'] != 0 ||
            live['through'] != null ||
            (live['knownSequence'] as int) > (live['cursor'] as int)) {
          continue;
        }
      }
      final unresolved = _unconfirmed(round, live);
      final authorizationNeeded = unresolved.any((record) {
        if (record['conflict'] != null || record['blocked'] != null) {
          return false;
        }
        final intent = record['pending'] ?? record['inflight'];
        return intent != null &&
            (record['writable'] != true ||
                intent['deleted'] == true &&
                    (record['metadata'] as Map)['deletable'] != true);
      });
      return authorizationNeeded
          ? WorkspaceV2RunState.awaitingAuthorization
          : unresolved.isNotEmpty
          ? WorkspaceV2RunState.needsAttention
          : WorkspaceV2RunState.complete;
    }
  }
}
