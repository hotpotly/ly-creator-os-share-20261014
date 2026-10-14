import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_sync_store_test.dart' as v1;
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_v2_driver_permissions_test.dart' show PermissionServer;
import 'workspace_v2_driver_test.dart' as base;
import 'workspace_v2_persistence_test.dart' as migration;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory directory;
  late SqliteWorkspaceStore store;
  late WorkspaceV2Driver driver;
  late PermissionServer server;
  late String id;
  late DesktopConnection connection;

  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: '${directory.path}/workspace.sqlite',
    cipher: TestWorkspaceCipher(),
  );
  WorkspaceV2Driver make({int maxRequests = 256}) => WorkspaceV2Driver(
    store: store,
    connection: () async => connection,
    environment: base.DriverEnvironment(),
    exchange: server.exchange,
    maxRequests: maxRequests,
    apply: (action) => action(),
  );
  Future<Map<String, dynamic>> row() async => workspaceV2Map(
    ((await store.loadV2Workspace())['records'] as List).singleWhere(
      (record) => record['id'] == id,
    ),
  );
  Future<void> restart() async {
    driver.cancel();
    await driver.settled;
    await store.close();
    store = await open();
    driver = make();
  }

  setUp(() async {
    directory = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('v2-driver-independent-');
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
    connection = DesktopConnection(
      address: '127.0.0.1:1',
      deviceId: v1.phoneId,
      serviceId: v1.macId,
      secretBase64: base64Encode(List.filled(32, 1)),
      deviceName: 'independent-test',
    );
    server = PermissionServer();
    id = workspaceId();
    server.add(id, base.fullBody(id));
    server.grant(false);
    driver = make();
    expect(
      (await driver.upgrade(approvedScopes: migration.scopes)).state,
      WorkspaceV2RunState.complete,
    );
    server.calls.clear();
    server.grant(true);
  });
  tearDown(() async {
    driver.cancel();
    await driver.settled;
    await store.close();
    await directory.delete(recursive: true);
  });

  test(
    'finished pages do not grant until final capabilities and resume without refetch',
    () async {
      final before = await row();
      driver = make(maxRequests: 4);
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.deferred);
      expect(result.permissionsRefreshRequired, true);
      final stage = (await store.v2PermissionStatus())['stage'];
      expect(stage['checkpoint']['finished'], true);
      expect((await row())['writable'], false);
      expect(server.calls, hasLength(4));
      await restart();
      server.calls.clear();
      expect((await driver.synchronize()).state, WorkspaceV2RunState.complete);
      expect(server.calls.map((call) => call['purpose']), [
        'capabilities',
        'sync',
        'capabilities',
      ]);
      final after = await row();
      expect(after['writable'], true);
      for (final key in [
        'json',
        'localRevision',
        'remoteRevision',
        'remoteSequence',
      ]) {
        expect(after[key], before[key], reason: key);
      }
      expect((await store.loadV2Workspace())['cursor'], 100);
    },
  );

  for (final action in ['cancel', 'disable']) {
    test(
      '$action after final capabilities still prevents permission commit',
      () async {
        var pageFetched = false;
        server.after = (purpose, request) async {
          if (purpose == 'snapshot.page') pageFetched = true;
          if (purpose != 'capabilities' || !pageFetched) return;
          if (action == 'cancel') {
            driver.cancel();
          } else {
            await store.setSyncEnabled(false);
          }
        };
        if (action == 'cancel') {
          await expectLater(
            driver.synchronize(),
            throwsA(
              isA<WorkspaceV2Failure>().having(
                (failure) => failure.cancelled,
                'cancelled',
                true,
              ),
            ),
          );
        } else {
          expect(
            (await driver.synchronize()).state,
            WorkspaceV2RunState.disabled,
          );
        }
        expect((await row())['writable'], false);
        final state = await store.v2PermissionStatus();
        expect(state['completed'], null);
        expect(state['stage']['checkpoint']['finished'], true);
        expect((await store.loadV2Workspace())['cursor'], 100);
      },
    );
  }

  test(
    'server downgrade in final capabilities discards the previously writable proof',
    () async {
      var pageFetched = false;
      server.after = (purpose, request) async {
        if (purpose == 'snapshot.page') pageFetched = true;
      };
      server.before = (purpose, request) async {
        if (purpose == 'capabilities' && pageFetched) server.grant(false);
      };
      expect((await driver.synchronize()).state, WorkspaceV2RunState.deferred);
      final state = await store.v2PermissionStatus();
      expect(state['completed'], null);
      expect(state['stage'], null);
      expect(state['required'], true);
      expect((await row())['writable'], false);
      expect(
        server.calls.where((call) => call['purpose'] == 'snapshot.start'),
        hasLength(1),
      );
      expect((await store.loadV2Workspace())['cursor'], 100);
    },
  );
}
