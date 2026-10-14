import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_sync_store_test.dart' as v1;
import 'workspace_sync_engine_test.dart' show desktop;
import 'workspace_sync_engine_v2_test.dart' show LegacyClient;
import 'workspace_v2_driver_test.dart' as base;
import 'workspace_v2_driver_permissions_test.dart' show PermissionServer;
import 'workspace_v2_persistence_test.dart' as migration;

class ReleaseGate extends base.DriverEnvironment {
  Completer<void>? entered, gate;
  @override
  Future<void> releaseWifi() async {
    final wait = gate;
    if (wait != null) {
      gate = null;
      entered!.complete();
      await wait.future;
    }
    await super.releaseWifi();
  }
}

class ConnectionGate extends MemoryConnectionStore {
  ConnectionGate() : super(desktop);
  Completer<void>? entered, gate;
  @override
  Future<DesktopConnection?> load() async {
    final wait = gate;
    if (wait != null) {
      gate = null;
      entered!.complete();
      await wait.future;
    }
    return super.load();
  }
}

class QueueController extends WorkspaceController {
  QueueController(super.store);
  Completer<void>? queued;
  @override
  Future<void> updateFromSync(Future<void> Function() apply) {
    queued?.complete();
    queued = null;
    return super.updateFromSync(apply);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory dir;
  late SqliteWorkspaceStore store;
  late QueueController controller;
  late WorkspaceSyncEngine engine;
  late PermissionServer server;
  late ReleaseGate environment;
  late ConnectionGate connections;
  late String id;
  setUp(() async {
    dir = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('owner-review-');
    store = await SqliteWorkspaceStore.create(
      factory: databaseFactoryFfi,
      databasePath: '${dir.path}/review.sqlite',
      cipher: TestWorkspaceCipher(),
    );
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
    controller = QueueController(store);
    await controller.load();
    server = PermissionServer();
    id = workspaceId();
    server.add(id, base.fullBody(id));
    environment = ReleaseGate();
    connections = ConnectionGate();
    engine = WorkspaceSyncEngine(
      store: store,
      controller: controller,
      connections: connections,
      client: LegacyClient(server),
      v2Exchange: server.exchange,
      environment: environment,
      discover: () async => [],
    );
    controller.onLocalChanged = engine.localChanged;
    engine.active = true;
    await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
  });
  tearDown(() async {
    engine.dispose();
    await engine.settled;
    controller.dispose();
    await store.close();
    await dir.delete(recursive: true);
  });
  Future<void> edit(String title) async {
    final row = controller.findFull('todo', id)!;
    await controller.saveFullTodo({
      'id': id,
      'body': row.patched({'title': title}),
    }, row.revision);
  }

  test(
    'unpaired device can cancel only its local unfinished upgrade with no network',
    () async {
      engine.dispose();
      await engine.settled;
      controller.dispose();
      await store.close();
      store = await SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: '${dir.path}/cancel.sqlite',
        cipher: TestWorkspaceCipher(),
      );
      await store.bindSync(v1.macId, v1.phoneId);
      await store.setSyncEnabled(true);
      controller = QueueController(store);
      await controller.load();
      await controller.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {'goalsText': 'private text', 'bodyText': ''},
        ),
      );
      engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: connections,
        client: LegacyClient(server),
        v2Exchange: server.exchange,
        environment: environment,
        v2MaxRequests: 3,
        discover: () async => [],
      );
      engine.active = true;
      await engine.upgradeFullWorkspace(approvedScopes: migration.scopes);
      expect(engine.upgrading, true);
      await connections.clear();
      server.calls.clear();
      await engine.cancelFullUpgrade();
      expect((await store.v2Status())['upgrade'], null);
      expect(engine.activeProtocol, 1);
      expect(server.calls, isEmpty);
      expect(controller.records.single.data['goalsText'], 'private text');
    },
  );

  test(
    'refresh after a connection identity replacement clears confirmed status',
    () async {
      expect(engine.label, '已同步');
      connections.connection = DesktopConnection(
        address: desktop.address,
        serviceId: desktop.serviceId,
        deviceId: desktop.deviceId,
        secretBase64: base64Encode(List.filled(32, 8)),
        deviceName: 'new identity',
      );
      await engine.refresh();
      expect(engine.label, isNot('已同步'));
    },
  );

  test('final release cannot swallow a debounced new local write', () async {
    final entered = Completer<void>(), gate = Completer<void>();
    environment.entered = entered;
    environment.gate = gate;
    engine.requestSync();
    await entered.future;
    await edit('after driver already completed');
    await Future<void>.delayed(const Duration(milliseconds: 650));
    gate.complete();
    await engine.settled;
    final persisted = await store.loadV2Workspace();
    expect(persisted['pendingCount'], 0);
    expect(persisted['inflightCount'], 0);
    expect(engine.label, '已同步');
  });

  test(
    'cancel while enable awaits connection leaves synchronization disabled',
    () async {
      await engine.setEnabled(false);
      final entered = Completer<void>(), gate = Completer<void>();
      connections.entered = entered;
      connections.gate = gate;
      final enabling = engine.setEnabled(true);
      final cancelled = expectLater(enabling, throwsA(isA<Exception>()));
      await entered.future;
      engine.cancel();
      gate.complete();
      await cancelled;
      await engine.settled;
      expect((await store.syncStatus())['enabled'], false);
    },
  );

  test(
    'cancel before queued conflict commit preserves both versions',
    () async {
      controller.onLocalChanged = null;
      await edit('local version');
      final prepared = await store.prepareV2Sync();
      final op = ((prepared['payload'] as Map)['operations'] as List).single;
      server.add(
        id,
        base.fullBody(id, 'remote version'),
        revision: 2,
        seq: 101,
      );
      server.sequence = 101;
      server.receipts[op['operationId'] as String] = {
        'operationId': op['operationId'],
        'localRevision': op['localRevision'],
        'status': 'conflict',
        'record': server.records[id],
      };
      engine.requestSync();
      await engine.settled;
      final conflict = engine.conflicts.single;
      final entered = Completer<void>(),
          gate = Completer<void>(),
          queued = Completer<void>();
      final prior = controller.updateFromSync(() async {
        entered.complete();
        await gate.future;
      });
      await entered.future;
      controller.queued = queued;
      final resolving = engine.resolve(
        'todo',
        id,
        keepLocal: false,
        expectedLocalRevision: conflict['localRevision'] as int,
        expectedRemoteRevision: conflict['remoteRevision'] as int,
      );
      final cancelled = expectLater(resolving, throwsA(isA<Exception>()));
      await queued.future;
      engine.cancel();
      gate.complete();
      await prior;
      await cancelled;
      await engine.settled;
      final records = (await store.loadV2Workspace())['records'] as List;
      final row = records.singleWhere((r) => r['id'] == id);
      expect(jsonDecode(row['json'])['title'], 'local version');
      expect(row['conflict'], isNotNull);
    },
  );
}
