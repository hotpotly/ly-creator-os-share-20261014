import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_v2_driver_test.dart' show DriverEnvironment;

class ForbiddenLegacyClient extends WorkspaceSyncClient {
  int attempts = 0;
  @override
  Future<Map<String, dynamic>> sync(
    DesktopConnection connection,
    Map<String, dynamic> payload,
    int counter,
  ) async {
    attempts++;
    throw StateError('active v2 cannot contact legacy transport');
  }
}

void main() {
  const encoded = String.fromEnvironment('WORKSPACE_V2_DRIVER_FIXTURE');
  test(
    'production coordinator routes v2 only and never hides retained work behind a synced label',
    () async {
      final fixture = workspaceV2Map(
        jsonDecode(utf8.decode(base64Decode(encoded))),
      );
      final connection = DesktopConnection(
        address: fixture['address'] as String,
        deviceId: fixture['deviceId'] as String,
        serviceId: fixture['workspaceId'] as String,
        secretBase64: fixture['secretBase64'] as String,
        deviceName: 'v2-engine-fixture',
      );
      final connections = MemoryConnectionStore(connection);
      sqfliteFfiInit();
      Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: fixture['databasePath'] as String,
        cipher: TestWorkspaceCipher(),
      );
      var store = await open();
      var controller = WorkspaceController(store);
      final legacy = ForbiddenLegacyClient();
      final transport = WorkspaceV2Client();
      var transportCalls = 0;
      Future<Map<String, dynamic>> exchange(
        DesktopConnection target,
        String purpose,
        Map<String, dynamic> payload, {
        required Future<int> Function() reserveCounter,
        Map<String, dynamic>? expectedBlob,
        List<Map<String, dynamic>>? approvedPermissions,
      }) {
        transportCalls++;
        return transport.request(
          target,
          purpose,
          payload,
          reserveCounter: reserveCounter,
          expectedBlob: expectedBlob,
          approvedPermissions: approvedPermissions,
        );
      }

      WorkspaceSyncEngine makeEngine() => WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: connections,
        client: legacy,
        v2Client: transport,
        v2Exchange: exchange,
        environment: DriverEnvironment(),
        discover: () async => [],
      );
      await store.bindSync(connection.serviceId!, connection.deviceId);
      await store.setSyncEnabled(true);
      await controller.load();
      final bootstrap = WorkspaceV2Driver(
        store: store,
        connection: connections.load,
        apply: controller.updateFromSync,
        environment: DriverEnvironment(),
      );
      expect(
        (await bootstrap.upgrade(
          approvedScopes: WorkspaceV2Driver.supportedScopes,
        )).state,
        WorkspaceV2RunState.complete,
      );
      bootstrap.cancel();
      var engine = makeEngine();
      controller.onLocalChanged = engine.localChanged;
      addTearDown(() async {
        engine.dispose();
        await engine.settled;
        transport.cancel();
        controller.dispose();
        await store.close();
      });
      Future<void> restart() async {
        engine.dispose();
        await engine.settled;
        controller.dispose();
        await store.close();
        store = await open();
        controller = WorkspaceController(store);
        await controller.load();
        engine = makeEngine();
        controller.onLocalChanged = engine.localChanged;
        await engine.refresh();
      }

      Future<Map<String, dynamic>> command(String action) async {
        final http = HttpClient();
        try {
          final request = await http.postUrl(
            Uri.parse('http://${fixture['controlAddress']}/'),
          );
          request.headers.set('authorization', 'Bearer ${fixture['token']}');
          request.add(utf8.encode(jsonEncode({'action': action})));
          final response = await request.close();
          final body = await utf8.decoder.bind(response).join();
          expect(response.statusCode, 200, reason: body);
          return workspaceV2Map(jsonDecode(body));
        } finally {
          http.close(force: true);
        }
      }

      Future<void> expectDurablySynced() async {
        final persisted = await store.loadV2Workspace();
        expect(persisted['pendingCount'], 0);
        expect(persisted['inflightCount'], 0);
        expect(persisted['response'], null);
        expect(persisted['through'], null);
        expect(
          persisted['knownSequence'] as int,
          lessThanOrEqualTo(persisted['cursor'] as int),
        );
        for (final row in persisted['records'] as List) {
          for (final field in ['pending', 'inflight', 'conflict', 'blocked']) {
            expect(row[field], null);
          }
        }
        final permission = await store.v2PermissionStatus();
        expect(permission['required'], false);
        expect(permission['stage'], null);
        expect(permission['blockedReason'], null);
      }

      final id = fixture['todoId'] as String;
      await engine.refresh();
      expect(engine.status['activeProtocol'], 2);
      expect(engine.label, isNot('已同步'));
      engine.setActive(true);
      await engine.settled;
      expect(engine.error, null);
      expect(engine.label, '已同步');
      await expectDurablySynced();
      expect(controller.findFull('todo', id)!.writable, false);
      await command('writable');
      engine.requestSync();
      await engine.settled;
      expect(engine.error, null);
      final initial = controller.findFull('todo', id)!;
      expect(initial.writable, true);
      engine.setActive(false);
      await controller.saveFullTodo({
        'id': id,
        'body': initial.patched({'title': 'Retained draft'}),
      }, initial.revision);
      final draft = controller.findFull('todo', id)!.rawJson;
      await engine.refresh();
      expect(engine.pending, 1);
      expect(engine.label, isNot('已同步'));
      await command('readonly');
      engine.setActive(true);
      await engine.settled;
      expect(engine.error, null);
      expect(engine.pending, 1);
      expect(engine.label, isNot('已同步'));
      expect((await command('state'))['todo']['title'], 'Driver task');
      await restart();
      expect(engine.status['activeProtocol'], 2);
      expect(engine.pending, 1);
      expect(controller.findFull('todo', id)!.rawJson, draft);
      expect(engine.label, isNot('已同步'));
      await command('writable');
      engine.setActive(true);
      await engine.settled;
      expect(engine.error, null);
      expect(engine.pending, 0);
      expect(engine.status['inflightCount'], 0);
      expect(engine.label, '已同步');
      await expectDurablySynced();
      expect((await command('state'))['todo']['title'], 'Retained draft');
      await restart();
      await expectDurablySynced();
      expect(controller.findFull('todo', id)!.title, 'Retained draft');
      engine.setActive(false);
      final row = controller.findFull('todo', id)!;
      await controller.saveFullTodo({
        'id': id,
        'body': row.patched({'progress': 67}),
      }, row.revision);
      final pausedCalls = transportCalls;
      engine.requestSync();
      await Future<void>.delayed(const Duration(milliseconds: 650));
      await engine.settled;
      expect(transportCalls, pausedCalls);
      expect((await command('state'))['todo']['progress'], 37);
      await engine.refresh();
      expect(engine.label, isNot('已同步'));
      engine.setActive(true);
      await engine.settled;
      expect(engine.error, null);
      expect((await command('state'))['todo']['progress'], 67);
      expect(engine.label, '已同步');
      await expectDurablySynced();
      await engine.setEnabled(false);
      expect(engine.enabled, false);
      expect(controller.fullActive, true);
      expect(engine.label, isNot('已同步'));
      final disabled = controller.findFull('todo', id)!;
      final disabledCalls = transportCalls;
      await controller.saveFullTodo({
        'id': id,
        'body': disabled.patched({'category': 'life'}),
      }, disabled.revision);
      final disabledDraft = controller.findFull('todo', id)!.rawJson;
      await Future<void>.delayed(const Duration(milliseconds: 650));
      await engine.settled;
      expect(transportCalls, disabledCalls);
      expect((await command('state'))['todo']['category'], 'self_media');
      await restart();
      expect(engine.enabled, false);
      expect(engine.pending, 1);
      expect(controller.findFull('todo', id)!.rawJson, disabledDraft);
      expect(engine.status['activeProtocol'], 2);
      engine.setActive(true);
      await engine.setEnabled(true);
      await engine.settled;
      expect(engine.error, null);
      expect(engine.label, '已同步');
      await expectDurablySynced();
      expect((await command('state'))['todo']['category'], 'life');
      expect(legacy.attempts, 0);
      expect(
        controller
            .findFull('todo', fixture['largeTodoId'] as String)!
            .title
            .length,
        80000,
      );
      await command('finished');
      stdout.writeln('LIVE_WORKSPACE_V2_ENGINE_PASSED');
    },
    skip: encoded.isEmpty,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
