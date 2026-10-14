import 'dart:async';
import 'package:flutter/foundation.dart';
import '../model/desktop_connection.dart';
import '../model/desktop_service.dart';
import '../storage/connection_store.dart';
import '../workspace/workspace_controller.dart';
import '../workspace/workspace_store.dart';
import 'mobile_sync_client.dart';
import 'sync_policy.dart';
import 'workspace_sync_client.dart';
import 'workspace_v2_client.dart';
import 'workspace_v2_driver.dart';

class WorkspaceSyncEngine extends ChangeNotifier {
  WorkspaceSyncEngine({
    required this.store,
    required this.controller,
    required this.connections,
    WorkspaceSyncClient? client,
    SyncEnvironmentProvider? environment,
    WorkspaceV2Client? v2Client,
    WorkspaceV2Exchange? v2Exchange,
    int v2MaxRequests = 256,
    Future<List<DesktopService>> Function()? discover,
  }) : client = client ?? WorkspaceSyncClient(),
       environment = environment ?? const NativeSyncEnvironmentProvider(),
       discover = discover ?? MobileSyncClient().discoverServices {
    if (store is SqliteWorkspaceStore) {
      _v2 = WorkspaceV2Driver(
        store: store as SqliteWorkspaceStore,
        connection: () async {
          _checkDriverOwner();
          final current = await connections.load();
          _checkDriverOwner();
          return current;
        },
        apply: (action) => controller.updateFromSync(() async {
          _checkDriverOwner();
          await action();
        }),
        client: v2Client,
        exchange: v2Exchange,
        environment: this.environment,
        maxRequests: v2MaxRequests,
      );
    }
  }

  final WorkspaceSyncStore store;
  final WorkspaceController controller;
  final ConnectionStore connections;
  final WorkspaceSyncClient client;
  final SyncEnvironmentProvider environment;
  final Future<List<DesktopService>> Function() discover;
  Map<String, dynamic> status = {};
  DesktopConnection? connection;
  bool busy = false;
  bool active = false;
  String? error;
  bool _disposed = false;
  bool _hasConfirmed = false;
  bool _queued = false;
  int _generation = 0;
  Timer? _debounce;
  Future<void>? _running;
  Future<void> _controlTail = Future.value();
  int _controlCount = 0;
  bool _statusReady = false;
  WorkspaceV2Driver? _v2;
  int? _driverGeneration;
  WorkspaceV2RunState? _v2Result;

  int get activeProtocol => status['activeProtocol'] as int? ?? 1;
  bool get upgrading => status['upgrade'] != null;
  int get inflight => status['inflightCount'] as int? ?? 0;
  int get unconfirmed => status['unconfirmedCount'] as int? ?? pending;
  List<Map<String, dynamic>> get blocked => (status['blocked'] as List? ?? [])
      .map((e) => Map<String, dynamic>.from(e as Map))
      .toList();
  bool get permissionsRefreshRequired =>
      status['permissionsRefreshRequired'] == true;
  String? get permissionBlockReason =>
      status['permissionBlockReason'] as String?;

  bool get enabled => status['enabled'] == true;
  int get pending => status['pendingCount'] as int? ?? 0;
  int get sendable => status['sendableCount'] as int? ?? pending;
  List<Map<String, dynamic>> get conflicts =>
      (status['conflicts'] as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
  String get label =>
      error ??
      (busy
          ? '正在同步'
          : !enabled
          ? '仅本机'
          : upgrading
          ? '完整工作区升级待继续'
          : conflicts.isNotEmpty
          ? '${conflicts.length}项待合并'
          : blocked.isNotEmpty
          ? '${blocked.length}项需修正'
          : permissionBlockReason != null
          ? '权限更新待处理'
          : status['suspended'] == true
          ? '等待授权'
          : permissionsRefreshRequired
          ? '待更新权限'
          : (status['authorizationPendingCount'] as int? ?? 0) > 0
          ? '等待写入授权'
          : unconfirmed > 0
          ? '$unconfirmed项待同步'
          : status['through'] != null ||
                (status['knownSequence'] as int? ?? 0) >
                    (status['cursor'] as int? ?? 0) ||
                status['response'] != null
          ? '待接收更新'
          : _hasConfirmed &&
                (activeProtocol == 1 ||
                    _v2Result == WorkspaceV2RunState.complete)
          ? '已同步'
          : '等待同步');

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() async {
    try {
      Map<String, dynamic> next;
      if (store is SqliteWorkspaceStore) {
        final fullStore = store as SqliteWorkspaceStore;
        final protocol = await fullStore.v2Status();
        if (protocol['activeProtocol'] == 2) {
          final live = await fullStore.loadV2Workspace();
          final permissions = await fullStore.v2PermissionStatus();
          final records = (live['records'] as List)
              .map((row) => Map<String, dynamic>.from(row as Map))
              .toList();
          final unresolved = records
              .where(
                (row) =>
                    row['pending'] != null ||
                    row['inflight'] != null ||
                    row['conflict'] != null ||
                    row['blocked'] != null,
              )
              .toList();
          next = {
            ...protocol,
            ...live,
            'records': null,
            'conflicts': [
              for (final row in records)
                if (row['conflict'] != null) row['conflict'],
            ],
            'blocked': [
              for (final row in records)
                if (row['blocked'] != null) row['blocked'],
            ],
            'unconfirmedCount': unresolved.length,
            'authorizationPendingCount': unresolved.where((row) {
              if (row['conflict'] != null || row['blocked'] != null) {
                return false;
              }
              final intent = row['pending'] ?? row['inflight'];
              return intent != null &&
                  (row['writable'] != true ||
                      intent['deleted'] == true &&
                          (row['metadata'] as Map)['deletable'] != true);
            }).length,
            'permissionsRefreshRequired':
                permissions['required'] == true ||
                permissions['stage'] != null ||
                permissions['blockedReason'] != null,
            'permissionBlockReason': permissions['blockedReason'],
            'permissionStatus': permissions,
          };
        } else {
          next = {...await store.syncStatus(), ...protocol};
        }
      } else {
        next = {...await store.syncStatus(), 'activeProtocol': 1};
      }
      final paired = await connections.load();
      if (paired == null ||
          paired.needsSecurityUpgrade ||
          paired.serviceId != next['workspaceId'] ||
          paired.deviceId != next['deviceId'] ||
          paired.serviceId != connection?.serviceId ||
          paired.deviceId != connection?.deviceId ||
          paired.secretBase64 != connection?.secretBase64) {
        _hasConfirmed = false;
        _v2Result = null;
      }
      status = next;
      connection = paired;
      _statusReady = true;
    } catch (_) {
      _statusReady = false;
      _hasConfirmed = false;
      error = '同步状态无法读取，本机数据已保留';
    }
    _notify();
  }

  void _cancelCurrent() {
    _generation++;
    _hasConfirmed = false;
    _v2Result = null;
    _queued = false;
    _debounce?.cancel();
    client.cancel();
    _v2?.cancel();
  }

  void cancel() => _cancelCurrent();

  void setActive(bool value) {
    if (active == value || _disposed) return;
    active = value;
    if (!value) {
      _cancelCurrent();
    } else {
      requestSync();
    }
  }

  void localChanged() {
    _hasConfirmed = false;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), requestSync);
  }

  void requestSync() {
    if (_disposed || !active) return;
    _queued = true;
    if (_running != null || _controlCount > 0) return;
    _running = _drain().whenComplete(() {
      _running = null;
      if (_queued && active && !_disposed) requestSync();
    });
  }

  Future<void> get settled async {
    while (true) {
      final controls = _controlTail, running = _running;
      await controls;
      await running;
      if (identical(controls, _controlTail) && _running == null) return;
    }
  }

  Future<void> _exclusive(
    Future<void> Function(int) operation, {
    bool resumeQueued = true,
  }) {
    _cancelCurrent();
    final generation = _generation;
    _controlCount++;
    final result = _controlTail.then((_) async {
      await _running;
      _checkCommandGeneration(generation);
      busy = true;
      error = null;
      _notify();
      try {
        await operation(generation);
      } catch (failure) {
        if (generation == _generation) _queued = false;
        if (generation == _generation && !_disposed) {
          error = _failureMessage(failure);
        }
        rethrow;
      } finally {
        busy = false;
        await refresh();
      }
    });
    _controlTail = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return result.whenComplete(() {
      _controlCount--;
      if (resumeQueued &&
          _controlCount == 0 &&
          _queued &&
          active &&
          !_disposed) {
        requestSync();
      }
    });
  }

  void _checkCommandGeneration(int generation) {
    if (_disposed || generation != _generation) {
      throw const WorkspaceSyncFailure('同步操作已取消');
    }
  }

  Future<DesktopConnection> _commandGuard(
    int generation, {
    bool requireEnabled = true,
  }) async {
    if (!_current(generation)) throw const WorkspaceSyncFailure('请回到前台后继续');
    await refresh();
    if (!_statusReady || requireEnabled && !enabled) {
      throw const WorkspaceSyncFailure('请先启用同步');
    }
    final current = await connections.load();
    if (current == null ||
        current.needsSecurityUpgrade ||
        current.serviceId == null ||
        requireEnabled &&
            (current.serviceId != status['workspaceId'] ||
                current.deviceId != status['deviceId'])) {
      throw const WorkspaceSyncFailure('电脑连接已改变，同步已暂停');
    }
    if (!_current(generation)) throw const WorkspaceSyncFailure('同步操作已取消');
    return current;
  }

  Future<void> setEnabled(bool value) async {
    await _exclusive((generation) async {
      if (value) {
        final current = await connections.load();
        _checkCommandGeneration(generation);
        if (current == null ||
            current.needsSecurityUpgrade ||
            current.serviceId == null) {
          throw const WorkspaceSyncFailure('请先连接电脑');
        }
        await store.bindSync(current.serviceId!, current.deviceId);
      }
      _checkCommandGeneration(generation);
      await store.setSyncEnabled(value);
      _hasConfirmed = false;
    });
    if (value && _running == null) requestSync();
  }

  Future<void> upgradeFullWorkspace({required List<String> approvedScopes}) {
    final scopes = List<String>.of(approvedScopes);
    return _exclusive((generation) async {
      await _commandGuard(generation);
      if (_v2 == null || activeProtocol != 1 || upgrading) {
        throw StateError('当前工作区不可开始升级');
      }
      await _syncV1(generation);
      await _commandGuard(generation);
      if (pending != 0 || conflicts.isNotEmpty) {
        throw StateError('请先同步并处理原工作区待确认记录');
      }
      _acceptV2Result(
        await _useDriver(
          generation,
          (driver) => driver.upgrade(approvedScopes: scopes),
        ),
      );
    });
  }

  Future<void> cancelFullUpgrade() => _exclusive((generation) async {
    if (!_current(generation)) throw const WorkspaceSyncFailure('请回到前台后继续');
    await refresh();
    if (!_current(generation)) throw const WorkspaceSyncFailure('同步操作已取消');
    if (!_statusReady || _v2 == null || activeProtocol != 1 || !upgrading) {
      throw StateError('当前没有可取消的升级');
    }
    await _useDriver(generation, (driver) => driver.cancelUpgrade());
    _hasConfirmed = false;
  });

  Future<void> retryPermissionRefresh() => _exclusive((generation) async {
    await _commandGuard(generation);
    if (_v2 == null || activeProtocol != 2) throw StateError('完整工作区尚未启用');
    await controller.updateFromSync(() async {
      await _commandGuard(generation);
      await (store as SqliteWorkspaceStore).beginV2PermissionRefresh(
        retry: true,
      );
    });
    _acceptV2Result(
      await _useDriver(generation, (driver) => driver.synchronize()),
    );
  });

  Future<Map<String, dynamic>> loadBlockedPreview(
    String kind,
    String id,
  ) async {
    final generation = _generation;
    _checkCommandGeneration(generation);
    if (store is! SqliteWorkspaceStore) throw StateError('完整工作区尚未启用');
    final preview = await (store as SqliteWorkspaceStore).loadV2BlockedPreview(
      kind,
      id,
    );
    _checkCommandGeneration(generation);
    return preview;
  }

  Future<void> discardBlocked(
    String kind,
    String id, {
    required int expectedLocalRevision,
    required String expectedOperationId,
    required int expectedRemoteRevision,
  }) => _exclusive((generation) async {
    if (store is! SqliteWorkspaceStore) throw StateError('完整工作区尚未启用');
    await controller.updateFromSync(() async {
      _checkCommandGeneration(generation);
      await (store as SqliteWorkspaceStore).discardV2Blocked(
        kind,
        id,
        expectedLocalRevision: expectedLocalRevision,
        expectedOperationId: expectedOperationId,
        expectedRemoteRevision: expectedRemoteRevision,
      );
    });
  }, resumeQueued: false);

  Future<void> resolve(
    String kind,
    String id, {
    required bool keepLocal,
    int? expectedLocalRevision,
    int? expectedRemoteRevision,
  }) async {
    await _exclusive((generation) async {
      await refresh();
      if (!_statusReady) throw StateError('同步状态无法读取');
      if (activeProtocol == 2) {
        if (expectedLocalRevision == null || expectedRemoteRevision == null) {
          throw ArgumentError('请选择当前显示的两个版本');
        }
        await controller.updateFromSync(() async {
          _checkCommandGeneration(generation);
          await (store as SqliteWorkspaceStore).resolveV2Conflict(
            kind,
            id,
            keepLocal: keepLocal,
            expectedLocalRevision: expectedLocalRevision,
            expectedRemoteRevision: expectedRemoteRevision,
          );
        });
      } else {
        await controller.updateFromSync(() async {
          _checkCommandGeneration(generation);
          await store.resolveSyncConflict(
            kind,
            id,
            keepLocal: keepLocal,
            expectedLocalRevision: expectedLocalRevision,
            expectedRemoteRevision: expectedRemoteRevision,
          );
        });
      }
    });
    if (_running == null) requestSync();
  }

  void _checkDriverOwner() {
    final generation = _driverGeneration;
    if (generation == null || !_current(generation)) {
      throw const WorkspaceV2Failure('同步已暂停', cancelled: true);
    }
  }

  Future<T> _useDriver<T>(
    int generation,
    Future<T> Function(WorkspaceV2Driver) action,
  ) async {
    if (_v2 == null || !_current(generation)) {
      throw const WorkspaceV2Failure('同步已暂停', cancelled: true);
    }
    _driverGeneration = generation;
    try {
      final result = await action(_v2!);
      _checkDriverOwner();
      return result;
    } finally {
      if (_driverGeneration == generation) _driverGeneration = null;
    }
  }

  void _acceptV2Result(WorkspaceV2RunResult result) {
    _v2Result = result.state;
    _hasConfirmed =
        result.state == WorkspaceV2RunState.complete &&
        result.unconfirmedCount == 0 &&
        !result.permissionsRefreshRequired;
    if (result.state == WorkspaceV2RunState.paused) error = '等待Wi-Fi或电量恢复';
    if (result.state == WorkspaceV2RunState.deferred) error = '待同步内容较多，点击继续';
    if (result.state != WorkspaceV2RunState.complete) _queued = false;
  }

  String _failureMessage(Object failure) => failure is WorkspaceSyncFailure
      ? failure.message
      : failure is WorkspaceV2Failure
      ? failure.message
      : '同步未完成，本机数据已保留';

  bool _current(int generation) =>
      !_disposed && active && generation == _generation;

  Future<({Map<String, dynamic> request, Map<String, dynamic> response})>
  _exchange(
    DesktopConnection current,
    Map<String, dynamic> request,
    int generation,
    int operationLimit,
  ) async {
    final payload = Map<String, dynamic>.from(request['payload'] as Map);
    final fresh = await connections.load();
    if (!_current(generation) ||
        fresh?.serviceId != current.serviceId ||
        fresh?.deviceId != current.deviceId ||
        fresh?.secretBase64 != current.secretBase64) {
      throw const WorkspaceSyncFailure('电脑连接已改变，同步已暂停');
    }
    try {
      return (
        request: payload,
        response: await client.sync(
          current,
          payload,
          request['counter'] as int,
        ),
      );
    } on WorkspaceSyncFailure catch (failure) {
      if (failure.requiresPairing ||
          failure.tooLarge ||
          !_current(generation)) {
        rethrow;
      }
      final found = (await discover())
          .where(
            (entry) =>
                entry.serviceId == current.serviceId &&
                entry.protocolVersion >= 2,
          )
          .firstOrNull;
      if (found == null || !_current(generation)) rethrow;
      final latest = await connections.load();
      if (latest?.serviceId != current.serviceId ||
          latest?.deviceId != current.deviceId ||
          latest?.secretBase64 != current.secretBase64) {
        throw const WorkspaceSyncFailure('电脑连接已改变，同步已暂停');
      }
      final updated = current.copyWithAddress(found.address);
      connection = updated;
      final retry = await store.prepareSyncRequest(
        operationLimit: operationLimit,
      );
      if (!_current(generation)) rethrow;
      final retryPayload = Map<String, dynamic>.from(retry['payload'] as Map);
      return (
        request: retryPayload,
        response: await client.sync(
          updated,
          retryPayload,
          retry['counter'] as int,
        ),
      );
    }
  }

  Future<void> _drain() async {
    busy = true;
    _queued = false;
    error = null;
    _notify();
    final generation = _generation;
    try {
      await refresh();
      if (!_statusReady || !enabled || !_current(generation)) return;
      if (connection == null ||
          connection!.needsSecurityUpgrade ||
          connection!.serviceId != status['workspaceId'] ||
          connection!.deviceId != status['deviceId']) {
        throw const WorkspaceSyncFailure('电脑连接已改变，同步已暂停');
      }
      if (activeProtocol == 2 || upgrading) {
        if (_v2 == null) throw StateError('完整工作区同步不可用');
        _acceptV2Result(
          await _useDriver(generation, (driver) => driver.resume()),
        );
      } else {
        await _syncV1(generation);
      }
    } catch (failure) {
      _hasConfirmed = false;
      if (_current(generation)) error = _failureMessage(failure);
      if (generation == _generation) _queued = false;
    } finally {
      await refresh();
      busy = false;
      _notify();
    }
  }

  Future<void> _syncV1(int generation) async {
    bool acquired = false;
    try {
      acquired = await environment.acquireWifi();
      if (!acquired || !(await environment.read()).allows(attachments: false)) {
        throw const WorkspaceSyncFailure('等待Wi-Fi');
      }
      var operationLimit = 100;
      var catchup = false;
      for (var page = 0; page < 50 && _current(generation); page++) {
        _queued = false;
        final request = await store.prepareSyncRequest(
          operationLimit: operationLimit,
        );
        if (!_current(generation)) break;
        final sentConnection = connection!;
        late ({Map<String, dynamic> request, Map<String, dynamic> response})
        exchange;
        try {
          exchange = await _exchange(
            sentConnection,
            request,
            generation,
            operationLimit,
          );
        } on WorkspaceSyncFailure catch (failure) {
          final count =
              ((request['payload'] as Map)['operations'] as List).length;
          if (!failure.tooLarge || count < 2) rethrow;
          operationLimit = (count / 2).ceil();
          continue;
        }
        final reply = exchange.response;
        if (!_current(generation)) break;
        final latest = await connections.load();
        if (latest?.serviceId != status['workspaceId'] ||
            latest?.deviceId != status['deviceId'] ||
            latest?.secretBase64 != sentConnection.secretBase64) {
          throw const WorkspaceSyncFailure('电脑连接已改变，同步已暂停');
        }
        await controller.updateFromSync(() async {
          if (!_current(generation)) throw const WorkspaceSyncFailure('同步已暂停');
          final saved = await connections.load();
          if (saved?.serviceId != latest?.serviceId ||
              saved?.deviceId != latest?.deviceId ||
              saved?.secretBase64 != latest?.secretBase64) {
            throw const WorkspaceSyncFailure('电脑连接已改变，同步已暂停');
          }
          if (!_current(generation)) throw const WorkspaceSyncFailure('同步已暂停');
          await store.applySyncResponse(exchange.request, reply);
        });
        _hasConfirmed = true;
        await refresh();
        if (reply['hasMore'] == true) {
          catchup = true;
        } else if (sendable == 0 && !_queued) {
          if (catchup) {
            catchup = false;
          } else {
            break;
          }
        }
        if (page == 49) error = '待同步内容较多，点击继续';
      }
    } finally {
      if (acquired) await environment.releaseWifi();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    active = false;
    _cancelCurrent();
    super.dispose();
  }
}
