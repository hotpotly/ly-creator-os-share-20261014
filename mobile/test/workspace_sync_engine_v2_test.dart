import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_sync_engine_test.dart' show desktop;
import 'workspace_sync_store_test.dart' as v1;
import 'workspace_test.dart' show TestWorkspaceCipher, todo;
import 'workspace_v2_driver_permissions_test.dart' show PermissionServer;
import 'workspace_v2_driver_test.dart' as base;
import 'workspace_v2_persistence_test.dart' as migration;

class LegacyClient extends WorkspaceSyncClient {
  LegacyClient(this.server);
  final PermissionServer server;
  final calls = <Map<String, dynamic>>[];
  final receipts = <String, Map<String, dynamic>>{};
  Completer<void>? gate;
  bool conflict = false;
  @override
  Future<Map<String, dynamic>> sync(
    DesktopConnection connection,
    Map<String, dynamic> payload,
    int counter,
  ) async {
    calls.add(jsonDecode(jsonEncode(payload)) as Map<String, dynamic>);
    await gate?.future;
    final ack = <Map<String, dynamic>>[];
    for (final raw in payload['operations'] as List) {
      final op = workspaceV2Map(raw);
      final id = op['id'] as String;
      final body = workspaceV2Map((op['next'] as Map)['data']);
      final record = WorkspaceRecord(
        kind: op['kind'] as String,
        id: id,
        data: {...body, if (conflict) 'title': 'remote conflict'},
      );
      ack.add(
        receipts.putIfAbsent(
          op['operationId'] as String,
          () => v1.receipt(
            op,
            v1.remote(record),
            status: conflict ? 'conflict' : 'accepted',
          ),
        ),
      );
      if (!conflict) {
        server.add(id, {...base.fullBody(id), ...body});
      }
    }
    return v1.response(
      payload,
      receipts: ack,
      cursor: receipts.isEmpty ? 0 : 1,
    );
  }
}

class EngineNetwork extends base.DriverEnvironment {
  Completer<void>? releaseGate, releaseEntered;
  int remainingReleases = 1;
  @override
  Future<void> releaseWifi() async {
    await super.releaseWifi();
    if (releaseGate == null || --remainingReleases > 0) return;
    final gate = releaseGate!;
    releaseGate = null;
    releaseEntered?.complete();
    await gate.future;
  }
}

class EngineConnections extends MemoryConnectionStore {
  EngineConnections() : super(desktop);
  Completer<void>? loadGate, loadEntered;
  @override
  Future<DesktopConnection?> load() async {
    final current = await super.load(), gate = loadGate;
    if (gate != null) {
      loadGate = null;
      loadEntered?.complete();
      await gate.future;
    }
    return current;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory dir;
  late String path;
  late SqliteWorkspaceStore store;
  late WorkspaceController controller;
  late WorkspaceSyncEngine engine;
  late PermissionServer server;
  late LegacyClient legacy;
  late EngineNetwork environment;
  late EngineConnections connections;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: path,
    cipher: TestWorkspaceCipher(),
  );
  WorkspaceSyncEngine make({int budget = 256}) => WorkspaceSyncEngine(
    store: store,
    controller: controller,
    connections: connections,
    client: legacy,
    environment: environment,
    v2Exchange: server.exchange,
    v2MaxRequests: budget,
    discover: () async => [],
  );
  Future<void> start() async {
    engine.setActive(true);
    await engine.settled;
  }

  Future<void> upgrade() async {
    await start();
    await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
    expect(engine.activeProtocol, 2);
    legacy.calls.clear();
    server.calls.clear();
  }

  Future<Map<String, dynamic>> row(String id) async => workspaceV2Map(
    ((await store.loadV2Workspace())['records'] as List).singleWhere(
      (r) => r['id'] == id,
    ),
  );
  Future<void> edit(String id, String title) async {
    final current = await row(id);
    await store.saveV2Todo({
      'id': id,
      'body': {
        ...workspaceV2Map(jsonDecode(current['json'] as String)),
        'title': title,
      },
    }, current['localRevision'] as int);
  }

  Future<void> restart() async {
    engine.dispose();
    await engine.settled;
    controller.dispose();
    await store.close();
    store = await open();
    controller = WorkspaceController(store);
    await controller.load();
    engine = make();
  }

  Future<void> pull({bool authenticate = true}) async {
    final prepared = await store.prepareV2Sync(),
        request = workspaceV2Map(prepared['payload']);
    final response = await server.respond('sync', request);
    final stage = await store.stageV2SyncResponse(
      request,
      response,
      permissionContext: authenticate
          ? prepared['permissionContext'] as String?
          : null,
    );
    await store.commitV2SyncResponse(stage['responseId'] as String);
  }

  setUp(() async {
    dir = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('engine-v2-');
    path = '${dir.absolute.path}/workspace.sqlite';
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
    controller = WorkspaceController(store);
    await controller.load();
    server = PermissionServer();
    legacy = LegacyClient(server);
    environment = EngineNetwork();
    connections = EngineConnections();
    engine = make();
  });
  tearDown(() async {
    engine.dispose();
    await engine.settled;
    controller.dispose();
    await store.close();
    await dir.delete(recursive: true);
  });

  test(
    'ordinary enabled v1 never invokes full workspace or auto-upgrades',
    () async {
      await start();
      expect(legacy.calls.length, 1);
      expect(server.calls, isEmpty);
      expect(engine.activeProtocol, 1);
      await engine.setEnabled(false);
      await engine.setEnabled(true);
      await engine.settled;
      expect(server.calls, isEmpty);
      expect(engine.activeProtocol, 1);
    },
  );

  test(
    'explicit upgrade drains legacy queue atomically and subsequent owner is v2 only',
    () async {
      final record = todo();
      await controller.save(record);
      await controller.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {'goalsText': 'private draft', 'bodyText': ''},
        ),
      );
      engine.active = true;
      await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
      expect(legacy.calls.single['operations'], hasLength(1));
      expect((await store.syncStatus())['sendableCount'], 0);
      expect(controller.fullActive, true);
      expect(controller.findFull('todo', record.id), isNotNull);
      expect(controller.records.single.kind, 'review_draft');
      legacy.calls.clear();
      engine.requestSync();
      await engine.settled;
      expect(legacy.calls, isEmpty);
      expect(engine.label, '已同步');
      await restart();
      await start();
      expect(legacy.calls, isEmpty);
      expect(controller.fullActive, true);
    },
  );

  test(
    'legacy conflict prevents explicit upgrade without clearing original intent',
    () async {
      await controller.save(todo());
      legacy.conflict = true;
      engine.active = true;
      await expectLater(
        engine.upgradeFullWorkspace(approvedScopes: migration.scopes),
        throwsStateError,
      );
      expect(engine.activeProtocol, 1);
      expect((await store.syncStatus())['conflicts'], isNotEmpty);
      expect(server.calls, isEmpty);
    },
  );

  test(
    'upgrade resumes persisted stage after bounded round and restart without v1 request',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      engine = make(budget: 3);
      engine.active = true;
      await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
      expect(engine.upgrading, true);
      expect(engine.activeProtocol, 1);
      expect(engine.label, isNot('已同步'));
      final frozen = (await store.v2Status())['upgrade'];
      expect(frozen['manifest'], isNotNull);
      legacy.calls.clear();
      server.calls.clear();
      await restart();
      await start();
      expect(engine.activeProtocol, 2);
      expect(legacy.calls, isEmpty);
      expect(server.calls.any((c) => c['purpose'] == 'snapshot.start'), false);
    },
  );

  test(
    'upgrade cancels and settles an earlier v1 request before taking network ownership',
    () async {
      final saved = todo();
      await controller.save(saved);
      legacy.gate = Completer<void>();
      engine.setActive(true);
      while (legacy.calls.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      final upgrading = engine.upgradeFullWorkspace(
        approvedScopes: migration.scopes,
      );
      await Future<void>.delayed(Duration.zero);
      expect(server.calls, isEmpty);
      legacy.gate!.complete();
      await upgrading;
      await engine.settled;
      expect(engine.activeProtocol, 2);
      expect(legacy.calls.length, 2);
      expect(legacy.calls[0]['operations'], legacy.calls[1]['operations']);
      expect(server.records.keys, contains(saved.id));
    },
  );

  test(
    'disable cancels an unactivated upgrade while ordinary pause retains it',
    () async {
      engine = make(budget: 3);
      engine.active = true;
      await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
      expect(engine.upgrading, true);
      engine.setActive(false);
      await engine.settled;
      expect((await store.v2Status())['upgrade'], isNotNull);
      await engine.setEnabled(false);
      expect((await store.v2Status())['upgrade'], null);
      expect(engine.activeProtocol, 1);
    },
  );

  test(
    'persisted permission block only restarts after explicit foreground retry',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await upgrade();
      await edit(id, 'retained blocked draft');
      await store.refreshV2Capabilities(migration.capsRequest(), {
        ...migration.capsResponse(),
        'permissions': [
          for (final scope in migration.scopes)
            {'scope': scope, 'read': true, 'write': false},
        ],
      });
      await store.refreshV2Capabilities(
        migration.capsRequest(),
        migration.capsResponse(),
      );
      engine.dispose();
      await engine.settled;
      controller.dispose();
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(path),
          cipher = TestWorkspaceCipher();
      final old = (await db.query('workspace_v2_permission_state')).single;
      final state = workspaceV2Map(
        jsonDecode(await cipher.decrypt(old['payload'] as String)),
      );
      await db.update('workspace_v2_permission_state', {
        'payload': await cipher.encrypt(
          jsonEncode({
            ...state,
            'completed': null,
            'stage': null,
            'blockedReason': 'too_large',
          }),
        ),
      });
      await db.close();
      store = await open();
      controller = WorkspaceController(store);
      await controller.load();
      engine = make();
      await engine.refresh();
      expect(engine.permissionBlockReason, 'too_large');
      expect(engine.label, '权限更新待处理');
      await expectLater(
        engine.retryPermissionRefresh(),
        throwsA(isA<WorkspaceSyncFailure>()),
      );
      expect((await store.v2PermissionStatus())['blockedReason'], 'too_large');
      await start();
      expect(
        server.calls.where(
          (c) => (c['purpose'] as String).startsWith('snapshot.'),
        ),
        isEmpty,
      );
      expect(engine.permissionBlockReason, 'too_large');
      await engine.retryPermissionRefresh();
      await engine.settled;
      expect(engine.permissionBlockReason, null);
      expect(engine.unconfirmed, 0);
      expect(engine.label, '已同步');
      expect(server.calls.any((c) => c['purpose'] == 'snapshot.start'), true);
      expect(
        jsonDecode((await row(id))['json'])['title'],
        'retained blocked draft',
      );
    },
  );

  for (final manual in [false, true]) {
    test(
      '${manual ? 'explicit upgrade' : 'automatic sync'} preserves local change queued during final release',
      () async {
        final id = workspaceId();
        server.add(id, base.fullBody(id));
        if (!manual) await upgrade();
        final gate = Completer<void>(), entered = Completer<void>();
        environment.releaseGate = gate;
        environment.releaseEntered = entered;
        environment.remainingReleases = manual ? 2 : 1;
        Future<void>? upgrading;
        if (manual) {
          engine.active = true;
          upgrading = engine.upgradeFullWorkspace(
            approvedScopes: migration.scopes,
          );
        } else {
          engine.requestSync();
        }
        await entered.future;
        expect((await store.v2Status())['activeProtocol'], 2);
        final sent = server.calls.length;
        await edit(id, 'late local change');
        engine.localChanged();
        await Future<void>.delayed(const Duration(milliseconds: 650));
        expect(server.calls.length, sent);
        gate.complete();
        await upgrading;
        await engine.settled;
        expect((await row(id))['pending'], null);
        expect((await row(id))['inflight'], null);
        expect(engine.unconfirmed, 0);
        expect(engine.label, '已同步');
        expect(
          jsonDecode(
            server.jsons[(server.records[id]!['payload'] as Map)['sha256']] ??
                (server.records[id]!['payload'] as Map)['json'],
          )['title'],
          'late local change',
        );
      },
    );
  }

  test(
    'cancelled enable command cannot write after connection load completes',
    () async {
      await engine.setEnabled(false);
      final gate = Completer<void>(), entered = Completer<void>();
      connections.loadGate = gate;
      connections.loadEntered = entered;
      final enabling = engine.setEnabled(true);
      final failed = expectLater(
        enabling,
        throwsA(isA<WorkspaceSyncFailure>()),
      );
      await entered.future;
      engine.cancel();
      gate.complete();
      await failed;
      await engine.settled;
      expect((await store.syncStatus())['enabled'], false);
      expect(legacy.calls, isEmpty);
      expect(server.calls, isEmpty);
    },
  );

  test(
    'explicit cancel waits upgrade owner and never accepts the late manifest',
    () async {
      final entered = Completer<void>(), gate = Completer<void>();
      server.before = (purpose, payload) async {
        if (purpose == 'snapshot.start') {
          entered.complete();
          await gate.future;
        }
      };
      engine.active = true;
      final upgrading = engine.upgradeFullWorkspace(
        approvedScopes: migration.scopes,
      );
      final failed = expectLater(upgrading, throwsA(isA<WorkspaceV2Failure>()));
      await entered.future;
      final cancelling = engine.cancelFullUpgrade();
      gate.complete();
      await failed;
      await cancelling;
      await engine.settled;
      expect(engine.activeProtocol, 1);
      expect(engine.upgrading, false);
      expect(
        server.calls.where((c) => c['purpose'] == 'snapshot.page'),
        isEmpty,
      );
    },
  );

  test(
    'unpaired upgrade can be cancelled locally without downgrading active2',
    () async {
      engine = make(budget: 3);
      engine.active = true;
      await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
      expect(engine.upgrading, true);
      final count = server.calls.length;
      await connections.clear();
      await engine.cancelFullUpgrade();
      expect(engine.upgrading, false);
      expect(engine.activeProtocol, 1);
      expect(server.calls.length, count);
      connections.connection = desktop;
      engine.dispose();
      await engine.settled;
      engine = make();
      engine.active = true;
      await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
      await expectLater(engine.cancelFullUpgrade(), throwsStateError);
      expect((await store.v2Status())['activeProtocol'], 2);
    },
  );

  test(
    'explicit full workspace commands require foreground and enabled binding',
    () async {
      await expectLater(
        engine.upgradeFullWorkspace(approvedScopes: migration.scopes),
        throwsA(isA<WorkspaceSyncFailure>()),
      );
      expect(legacy.calls, isEmpty);
      expect(server.calls, isEmpty);
      engine.active = true;
      await engine.setEnabled(false);
      await expectLater(
        engine.upgradeFullWorkspace(approvedScopes: migration.scopes),
        throwsA(isA<WorkspaceSyncFailure>()),
      );
      expect((await store.v2Status())['upgrade'], null);
    },
  );

  test(
    'active2 failure never falls back or drains a queued infinite retry',
    () async {
      await upgrade();
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': base.createBody()}, 0);
      server.before = (purpose, payload) async {
        engine.requestSync();
        throw const WorkspaceV2Failure('offline');
      };
      engine.requestSync();
      await engine.settled;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(server.calls.length, 1);
      expect(legacy.calls, isEmpty);
      expect(engine.pending, 1);
      expect(engine.label, isNot('已同步'));
      expect((await row(id))['pending'], isNotNull);
    },
  );

  test(
    'readonly retained pending and metadata proof status survive refresh and restart',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await upgrade();
      await edit(id, 'local draft');
      server.grant(false);
      engine.requestSync();
      await engine.settled;
      expect(engine.unconfirmed, 1);
      expect(engine.status['authorizationPendingCount'], 1);
      expect(engine.label, '等待写入授权');
      await restart();
      await engine.refresh();
      expect(engine.unconfirmed, 1);
      expect(engine.label, '等待写入授权');
      server.grant(true);
      await start();
      expect(engine.unconfirmed, 0);
      expect(engine.label, '已同步');
      expect(jsonDecode((await row(id))['json'])['title'], 'local draft');
      expect(legacy.calls, isEmpty);
    },
  );

  for (final disable in [false, true]) {
    test(
      '${disable ? 'disable' : 'background'} cancels full owner and prevents local debounce networking',
      () async {
        final id = workspaceId();
        server.add(id, base.fullBody(id));
        await upgrade();
        await edit(id, 'pending before pause');
        final gate = Completer<void>(), entered = Completer<void>();
        server.before = (purpose, payload) async {
          if (purpose == 'sync') {
            entered.complete();
            await gate.future;
          }
        };
        engine.requestSync();
        await entered.future;
        Future<void>? stopping;
        if (disable) {
          stopping = engine.setEnabled(false);
        } else {
          engine.setActive(false);
        }
        gate.complete();
        await stopping;
        await engine.settled;
        final frozen = (await row(id))['inflight'];
        expect(frozen, isNotNull);
        server.before = null;
        server.calls.clear();
        await edit(id, 'offline successor');
        engine.localChanged();
        await Future<void>.delayed(const Duration(milliseconds: 650));
        await engine.settled;
        expect(server.calls, isEmpty);
        expect(legacy.calls, isEmpty);
        if (disable) {
          await engine.setEnabled(true);
        } else {
          engine.setActive(true);
        }
        await engine.settled;
        expect(engine.label, '已同步');
        expect(
          jsonDecode((await row(id))['json'])['title'],
          'offline successor',
        );
      },
    );
  }

  test(
    'refresh invalidates confirmation after repaired credentials but not address changes',
    () async {
      await upgrade();
      expect(engine.label, '已同步');
      connections.connection = desktop.copyWithAddress('127.0.0.1:99');
      await engine.refresh();
      expect(engine.label, '已同步');
      connections.connection = DesktopConnection(
        address: desktop.address,
        serviceId: desktop.serviceId,
        deviceId: desktop.deviceId,
        secretBase64: base64Encode(List.filled(32, 9)),
        deviceName: 'repaired',
      );
      await engine.refresh();
      expect(engine.label, '等待同步');
      expect(server.calls, isEmpty);
      expect(legacy.calls, isEmpty);
      expect((await store.v2Status())['activeProtocol'], 2);
    },
  );

  test(
    'live secret replacement is observed instead of cached engine credentials',
    () async {
      await upgrade();
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': base.createBody()}, 0);
      server.after = (purpose, request) async {
        if (purpose != 'sync') return;
        connections.connection = DesktopConnection(
          address: desktop.address,
          serviceId: desktop.serviceId,
          deviceId: desktop.deviceId,
          secretBase64: base64Encode(List.filled(32, 8)),
          deviceName: 'repaired',
        );
      };
      engine.requestSync();
      await engine.settled;
      expect(engine.error, contains('身份已改变'));
      expect((await row(id))['inflight'], isNotNull);
      expect((await store.loadV2Workspace())['suspended'], true);
      expect(legacy.calls, isEmpty);
    },
  );

  test(
    'permissions and unconsumed fixed watermark prevent stale confirmed label',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await upgrade();
      await edit(id, 'new');
      await pull(authenticate: false);
      await engine.refresh();
      expect(engine.status['knownSequence'], 101);
      expect(engine.status['cursor'], 100);
      expect(engine.permissionsRefreshRequired, true);
      expect(engine.label, isNot('已同步'));
    },
  );

  test(
    'full conflict resolution requires exact opened versions and returns full remote',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await upgrade();
      await edit(id, 'local');
      final sent = await store.prepareV2Sync();
      final op = ((sent['payload'] as Map)['operations'] as List).single;
      server.add(id, base.fullBody(id, 'remote'), revision: 2, seq: 101);
      server.sequence = 101;
      server.receipts[op['operationId'] as String] = {
        'operationId': op['operationId'],
        'localRevision': op['localRevision'],
        'status': 'conflict',
        'record': server.records[id],
      };
      engine.requestSync();
      await engine.settled;
      final opened = engine.conflicts.single;
      expect(jsonDecode(opened['local']['json'])['title'], 'local');
      expect(jsonDecode(opened['remote']['json'])['title'], 'remote');
      await expectLater(
        engine.resolve('todo', id, keepLocal: false),
        throwsArgumentError,
      );
      await expectLater(
        engine.resolve(
          'todo',
          id,
          keepLocal: false,
          expectedLocalRevision: opened['localRevision'] as int,
          expectedRemoteRevision: 1,
        ),
        throwsA(isA<WorkspaceConflict>()),
      );
      final gate = Completer<void>(), entered = Completer<void>();
      final holding = controller.updateFromSync(() async {
        entered.complete();
        await gate.future;
      });
      await entered.future;
      final resolving = engine.resolve(
        'todo',
        id,
        keepLocal: false,
        expectedLocalRevision: opened['localRevision'] as int,
        expectedRemoteRevision: opened['remoteRevision'] as int,
      );
      final cancelled = expectLater(
        resolving,
        throwsA(isA<WorkspaceSyncFailure>()),
      );
      while (!engine.busy) {
        await Future<void>.delayed(Duration.zero);
      }
      await Future<void>.delayed(const Duration(milliseconds: 20));
      engine.cancel();
      gate.complete();
      await holding;
      await cancelled;
      await engine.settled;
      expect((await row(id))['conflict'], isNotNull);
      expect(jsonDecode((await row(id))['json'])['title'], 'local');
      await engine.resolve(
        'todo',
        id,
        keepLocal: false,
        expectedLocalRevision: opened['localRevision'] as int,
        expectedRemoteRevision: opened['remoteRevision'] as int,
      );
      await engine.settled;
      expect(engine.conflicts, isEmpty);
      expect(controller.findFull('todo', id)!.body['title'], 'remote');
      expect(legacy.calls, isEmpty);
    },
  );

  test(
    'terminal rejected state is not mislabeled synced or auto-cleared',
    () async {
      await upgrade();
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': base.createBody()}, 0);
      server.before = (purpose, request) async {
        if (purpose != 'sync') return;
        for (final raw in request['operations'] as List) {
          final op = workspaceV2Map(raw);
          server.receipts[op['operationId'] as String] = {
            'operationId': op['operationId'],
            'localRevision': op['localRevision'],
            'status': 'rejected',
            'code': 'invalid_change',
            'operationHash': workspaceV2OperationHash(op),
            'target': {'kind': op['kind'], 'id': id},
            'record': null,
          };
        }
      };
      engine.requestSync();
      await engine.settled;
      expect(engine.blocked, hasLength(1));
      expect(engine.label, '1项需修正');
      expect(engine.unconfirmed, 1);
      expect(engine.conflicts, isEmpty);
      expect(legacy.calls, isEmpty);
    },
  );
}
