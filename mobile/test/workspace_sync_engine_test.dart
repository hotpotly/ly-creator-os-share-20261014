import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/model/desktop_service.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/sync_policy.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'workspace_test.dart' show MemoryWorkspaceStore;

const desktop = DesktopConnection(
  address: '127.0.0.1:1234',
  deviceId: '22222222-2222-4222-8222-222222222222',
  serviceId: '11111111-1111-4111-8111-111111111111',
  secretBase64: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  deviceName: 'fixture',
);

class EngineStore extends MemoryWorkspaceStore implements WorkspaceSyncStore {
  bool enabled = false;
  int counter = 0;
  int applied = 0;
  int cursor = 0;
  int queuedOperations = 0;
  int conflictedOperations = 0;
  Map<String, dynamic>? lastApplied;
  @override
  Future<Map<String, dynamic>> syncStatus() async => {
    'enabled': enabled,
    'workspaceId': desktop.serviceId,
    'deviceId': desktop.deviceId,
    'pendingCount': queuedOperations + conflictedOperations,
    'sendableCount': queuedOperations,
    'cursor': cursor,
    'conflicts': <Map<String, dynamic>>[],
  };
  @override
  Future<void> bindSync(String workspaceId, String deviceId) async {
    enabled = true;
  }

  @override
  Future<void> setSyncEnabled(bool value) async {
    enabled = value;
  }

  @override
  Future<Map<String, dynamic>> prepareSyncRequest({
    int operationLimit = 100,
  }) async => {
    'counter': ++counter,
    'payload': {
      'protocolVersion': 1,
      'workspaceId': desktop.serviceId,
      'deviceId': desktop.deviceId,
      'cursor': cursor,
      'through': null,
      'operations': List.generate(
        queuedOperations < operationLimit ? queuedOperations : operationLimit,
        (i) => {'operationId': 'op-$i'},
      ),
      'attempt': counter,
    },
  };
  @override
  Future<void> applySyncResponse(
    Map<String, dynamic> request,
    Map<String, dynamic> response,
  ) async {
    applied++;
    queuedOperations -= (request['operations'] as List).length;
    lastApplied = request;
    cursor = response['cursor'] as int;
  }

  @override
  Future<void> resolveSyncConflict(
    String kind,
    String id, {
    required bool keepLocal,
    int? expectedLocalRevision,
    int? expectedRemoteRevision,
  }) async {}
}

class EngineEnvironment extends SyncEnvironmentProvider {
  bool wifi = true;
  int acquired = 0;
  int released = 0;
  @override
  Future<bool> acquireWifi() async {
    acquired++;
    return true;
  }

  @override
  Future<void> releaseWifi() async {
    released++;
  }

  @override
  Future<SyncEnvironment> read() async => SyncEnvironment(
    wifi: wifi,
    metered: false,
    powerSaver: false,
    batteryPercent: 80,
    charging: false,
  );
}

class EngineClient extends WorkspaceSyncClient {
  int calls = 0;
  bool failFirst = false;
  bool hasMore = false;
  int? maxOperations;
  Completer<void>? gate;
  @override
  Future<Map<String, dynamic>> sync(
    DesktopConnection connection,
    Map<String, dynamic> payload,
    int counter,
  ) async {
    calls++;
    if (maxOperations != null &&
        (payload['operations'] as List).length > maxOperations!) {
      throw const WorkspaceSyncFailure('too large', tooLarge: true);
    }
    await gate?.future;
    if (failFirst && calls == 1) throw const WorkspaceSyncFailure('offline');
    return {
      'cursor': calls,
      'through': calls,
      'receipts': [],
      'changes': [],
      'hasMore': hasMore && calls == 1,
    };
  }
}

void main() {
  late EngineStore store;
  late WorkspaceController controller;
  late EngineEnvironment environment;
  late EngineClient client;
  late MemoryConnectionStore connections;
  late WorkspaceSyncEngine engine;
  setUp(() async {
    store = EngineStore();
    controller = WorkspaceController(store);
    await controller.load();
    environment = EngineEnvironment();
    client = EngineClient();
    connections = MemoryConnectionStore(desktop);
    engine = WorkspaceSyncEngine(
      store: store,
      controller: controller,
      connections: connections,
      client: client,
      environment: environment,
      discover: () async => [
        DesktopService(
          serviceId: desktop.serviceId!,
          name: 'fixture',
          address: '127.0.0.1:5678',
          protocolVersion: 2,
        ),
      ],
    );
  });
  tearDown(() async {
    engine.dispose();
    await engine.settled;
    controller.dispose();
  });
  test('local review drafts never schedule a workspace upload', () async {
    int signals = 0;
    controller.onLocalChanged = () => signals++;
    await controller.save(
      WorkspaceRecord(
        kind: 'review_draft',
        id: 'weekly:2026-09-28',
        data: {'goalsText': '计划', 'bodyText': '复盘'},
      ),
    );
    expect(signals, 0);
    await controller.save(
      WorkspaceRecord(kind: 'work_log', id: '2026-10-03', data: {'minutes': 0}),
    );
    expect(signals, 1);
  });

  test(
    'pairing alone never enables domain sync or repeatedly drains',
    () async {
      engine.setActive(true);
      await engine.settled;
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(client.calls, 0);
      expect(environment.acquired, 0);
      expect(engine.busy, false);
      await engine.setEnabled(true);
      await engine.settled;
      expect(client.calls, 1);
      expect(store.applied, 1);
    },
  );
  test('no Wi-Fi keeps local work and releases network lease', () async {
    store.enabled = true;
    environment.wifi = false;
    engine.setActive(true);
    await engine.settled;
    expect(client.calls, 0);
    expect(store.counter, 0);
    expect(engine.error, '等待Wi-Fi');
    expect(environment.released, 1);
  });
  test('empty outbox still pulls all fixed watermark pages', () async {
    store.enabled = true;
    client.hasMore = true;
    engine.setActive(true);
    await engine.settled;
    expect(client.calls, 3);
    expect(store.applied, 3);
    expect(environment.released, 1);
  });
  test('discovery retry applies the actual newly reserved request', () async {
    store.enabled = true;
    client.failFirst = true;
    engine.setActive(true);
    await engine.settled;
    expect(client.calls, 2);
    expect(store.lastApplied!['attempt'], 2);
    expect(connections.connection!.address, desktop.address);
  });
  test(
    '413 reduces immutable sub-batches instead of endlessly retrying them',
    () async {
      store.enabled = true;
      store.queuedOperations = 8;
      client.maxOperations = 2;
      engine.setActive(true);
      await engine.settled;
      expect(client.calls, 6);
      expect(store.applied, 4);
      expect(store.queuedOperations, 0);
      expect(engine.error, isNull);
    },
  );
  test('unresolved conflicts do not cause fifty empty requests', () async {
    store.enabled = true;
    store.conflictedOperations = 3;
    engine.setActive(true);
    await engine.settled;
    expect(client.calls, 1);
    expect(store.conflictedOperations, 3);
  });

  test('pausing while response is in flight cannot apply it', () async {
    store.enabled = true;
    client.gate = Completer<void>();
    engine.setActive(true);
    while (client.calls == 0) {
      await Future<void>.delayed(Duration.zero);
    }
    engine.setActive(false);
    client.gate!.complete();
    await engine.settled;
    expect(store.applied, 0);
    expect(environment.released, 1);
    client.gate = null;
    engine.setActive(true);
    await engine.settled;
    expect(store.applied, 1);
  });
  test('changed paired computer never receives the old queue', () async {
    store.enabled = true;
    connections.connection = const DesktopConnection(
      address: '127.0.0.1:9999',
      deviceId: '22222222-2222-4222-8222-222222222222',
      serviceId: '33333333-3333-4333-8333-333333333333',
      secretBase64: 'key',
      deviceName: 'other',
    );
    engine.setActive(true);
    await engine.settled;
    expect(client.calls, 0);
    expect(store.applied, 0);
    expect(engine.error, contains('连接已改变'));
  });
  test(
    'identity changed during response cannot mutate local records',
    () async {
      store.enabled = true;
      client.gate = Completer<void>();
      engine.setActive(true);
      while (client.calls == 0) {
        await Future<void>.delayed(Duration.zero);
      }
      await connections.clear();
      client.gate!.complete();
      await engine.settled;
      expect(store.applied, 0);
    },
  );
}
