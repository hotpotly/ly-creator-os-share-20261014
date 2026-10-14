import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_v2_driver_test.dart' show DriverEnvironment;

void main() {
  const encoded = String.fromEnvironment('WORKSPACE_V2_DRIVER_FIXTURE');
  test(
    'production driver preserves drafts and immutable operations across real grant changes',
    () async {
      final fixture = workspaceV2Map(
        jsonDecode(utf8.decode(base64Decode(encoded))),
      );
      final connection = DesktopConnection(
        address: fixture['address'] as String,
        deviceId: fixture['deviceId'] as String,
        serviceId: fixture['workspaceId'] as String,
        secretBase64: fixture['secretBase64'] as String,
        deviceName: 'v2-driver-fixture',
      );
      sqfliteFfiInit();
      Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: fixture['databasePath'] as String,
        cipher: TestWorkspaceCipher(),
      );
      var store = await open();
      var controller = WorkspaceController(store);
      final client = WorkspaceV2Client();
      final calls = <String>[];
      final transmissions = <Map<String, dynamic>>[];
      Map<String, dynamic>? lostTransmission;
      var loseConfirmation = false;
      Future<Map<String, dynamic>> exchange(
        DesktopConnection target,
        String purpose,
        Map<String, dynamic> payload, {
        required Future<int> Function() reserveCounter,
        Map<String, dynamic>? expectedBlob,
        List<Map<String, dynamic>>? approvedPermissions,
      }) async {
        calls.add(purpose);
        final response = await client.request(
          target,
          purpose,
          payload,
          reserveCounter: reserveCounter,
          expectedBlob: expectedBlob,
          approvedPermissions: approvedPermissions,
        );
        if (purpose == 'sync' && (payload['operations'] as List).isNotEmpty) {
          transmissions.add(
            workspaceV2Map(
              jsonDecode(
                jsonEncode({'request': payload, 'response': response}),
              ),
            ),
          );
        }
        if (loseConfirmation &&
            purpose == 'sync' &&
            (payload['operations'] as List).isNotEmpty) {
          loseConfirmation = false;
          lostTransmission = transmissions.last;
          throw const WorkspaceV2Failure('fixture lost confirmation');
        }
        return response;
      }

      WorkspaceV2Driver makeDriver() => WorkspaceV2Driver(
        store: store,
        connection: () async => connection,
        apply: controller.updateFromSync,
        environment: DriverEnvironment(),
        client: client,
        exchange: exchange,
      );
      var driver = makeDriver();
      addTearDown(() async {
        driver.cancel();
        client.cancel();
        controller.dispose();
        await store.close();
      });
      Future<void> restart() async {
        driver.cancel();
        await driver.settled;
        controller.dispose();
        await store.close();
        store = await open();
        controller = WorkspaceController(store);
        await controller.load();
        driver = makeDriver();
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

      final id = fixture['todoId'] as String,
          largeId = fixture['largeTodoId'] as String;
      await store.bindSync(connection.serviceId!, connection.deviceId);
      await store.setSyncEnabled(true);
      await controller.load();
      expect(
        (await driver.synchronize()).state,
        WorkspaceV2RunState.needsUpgrade,
      );
      expect(controller.fullActive, false);
      expect(
        (await driver.upgrade(
          approvedScopes: WorkspaceV2Driver.supportedScopes,
        )).state,
        WorkspaceV2RunState.complete,
      );
      expect(controller.fullActive, true);
      final original = controller.findFull('todo', id)!;
      expect(original.writable, false);
      expect(controller.findFull('todo', largeId)!.title.length, 80000);
      final downloaded = calls.where((call) => call == 'blob.read').length;
      expect(downloaded, greaterThan(0));
      final beforeElevation = controller.fullWorkspace!;
      final callStart = calls.length;
      await command('writable');
      final elevated = await driver.synchronize();
      expect(elevated.permissionsRefreshRequired, false);
      expect(elevated.state, WorkspaceV2RunState.complete);
      var row = controller.findFull('todo', id)!;
      expect(row.writable, true);
      expect(row.rawJson, original.rawJson);
      expect(row.remoteRevision, original.remoteRevision);
      expect(row.revision, original.revision);
      expect(row.state['remoteSequence'], original.state['remoteSequence']);
      for (final field in ['cursor', 'knownSequence']) {
        expect(controller.fullWorkspace![field], beforeElevation[field]);
      }
      final elevationCalls = calls.sublist(callStart);
      expect(elevationCalls, contains('snapshot.start'));
      expect(elevationCalls, contains('snapshot.page'));
      expect(
        elevationCalls.lastIndexOf('capabilities'),
        greaterThan(elevationCalls.lastIndexOf('snapshot.page')),
      );
      expect(calls.where((call) => call == 'blob.read').length, downloaded);
      await controller.saveFullTodo({
        'id': id,
        'body': row.patched({'title': 'Retained draft'}),
      }, row.revision);
      final draft = controller.findFull('todo', id)!.rawJson;
      await command('readonly');
      final withheld = await driver.synchronize();
      expect(withheld.state, WorkspaceV2RunState.awaitingAuthorization);
      expect(withheld.unconfirmedCount, 1);
      expect(controller.findFull('todo', id)!.rawJson, draft);
      expect((await command('state'))['todo']['title'], 'Driver task');
      await restart();
      expect(controller.findFull('todo', id)!.rawJson, draft);
      await command('writable');
      final restored = await driver.synchronize();
      expect(restored.state, WorkspaceV2RunState.complete);
      expect(restored.unconfirmedCount, 0);
      expect((await command('state'))['todo']['title'], 'Retained draft');
      row = controller.findFull('todo', id)!;
      await controller.saveFullTodo({
        'id': id,
        'body': row.patched({'progress': 67}),
      }, row.revision);
      loseConfirmation = true;
      await expectLater(
        driver.synchronize(),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      final inflight = (await store.loadV2Workspace())['records'].firstWhere(
        (r) => r['id'] == id,
      )['inflight'];
      expect(inflight, isNotNull);
      final applied = await command('state');
      expect(applied['todo']['progress'], 67);
      await restart();
      await command('readonly');
      expect(
        (await driver.synchronize()).state,
        WorkspaceV2RunState.needsAttention,
      );
      expect(controller.findFull('todo', id)!.hasConflict, true);
      expect(
        (await store.loadV2Workspace())['records'].firstWhere(
          (r) => r['id'] == id,
        )['inflight'],
        inflight,
      );
      await command('writable');
      final confirmed = await driver.synchronize();
      expect(confirmed.state, WorkspaceV2RunState.complete);
      expect(confirmed.unconfirmedCount, 0);
      final lost = lostTransmission!;
      final lostOperation =
          ((lost['request'] as Map)['operations'] as List).single as Map;
      final retries = transmissions
          .where(
            (entry) => ((entry['request'] as Map)['operations'] as List).any(
              (operation) =>
                  operation['operationId'] == lostOperation['operationId'],
            ),
          )
          .toList();
      expect(retries.length, greaterThanOrEqualTo(2));
      for (final retry in retries) {
        expect(
          (retry['request'] as Map)['operations'],
          (lost['request'] as Map)['operations'],
        );
        expect(
          (retry['response'] as Map)['receipts'],
          (lost['response'] as Map)['receipts'],
        );
      }
      expect((await command('state'))['eventCount'], applied['eventCount']);
      expect(calls.where((call) => call == 'blob.read').length, downloaded);
      expect(controller.findFull('todo', id)!.progress, 67);
      await command('finished');
      stdout.writeln('LIVE_WORKSPACE_V2_DRIVER_PASSED');
    },
    skip: encoded.isEmpty,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
