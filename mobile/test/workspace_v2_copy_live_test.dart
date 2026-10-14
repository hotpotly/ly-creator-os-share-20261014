import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
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
    'real Mac readonly tombstone allows a scope-authorized new UUID copy but never resurrection',
    () async {
      final fixture = workspaceV2Map(
        jsonDecode(utf8.decode(base64Decode(encoded))),
      );
      final connection = DesktopConnection(
        address: fixture['address'] as String,
        deviceId: fixture['deviceId'] as String,
        serviceId: fixture['workspaceId'] as String,
        secretBase64: fixture['secretBase64'] as String,
        deviceName: 'v2-copy-fixture',
      );
      sqfliteFfiInit();
      final store = await SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: fixture['databasePath'] as String,
        cipher: TestWorkspaceCipher(),
      );
      final controller = WorkspaceController(store);
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(connection),
        environment: DriverEnvironment(),
        discover: () async => [],
      );
      addTearDown(() async {
        engine.dispose();
        await engine.settled;
        controller.dispose();
        await store.close();
      });
      Future<Map<String, dynamic>> command(String action) async {
        final http = HttpClient();
        try {
          final request = await http.postUrl(
            Uri.parse('http://${fixture['controlAddress']}'),
          );
          request.headers.set('authorization', 'Bearer ${fixture['token']}');
          request.add(utf8.encode(jsonEncode({'action': action})));
          final response = await request.close();
          final text = await utf8.decoder.bind(response).join();
          expect(response.statusCode, 200, reason: text);
          return workspaceV2Map(jsonDecode(text));
        } finally {
          http.close(force: true);
        }
      }

      Future<void> sync() async {
        engine.requestSync();
        await engine.settled;
        expect(engine.error, null);
      }

      await store.bindSync(connection.serviceId!, connection.deviceId);
      await store.setSyncEnabled(true);
      await controller.load();
      engine.setActive(true);
      await engine.settled;
      expect(engine.activeProtocol, 1);
      await engine.upgradeFullWorkspace(
        approvedScopes: WorkspaceV2Driver.supportedScopes,
      );
      await engine.settled;
      expect(engine.activeProtocol, 2);
      await command('writable');
      await sync();
      final id = fixture['todoId'] as String;
      final before = controller.findFull('todo', id)!;
      expect(before.writable, true);
      engine.setActive(false);
      await controller.saveFullTodo({
        'id': id,
        'body': before.patched({'title': 'Recovered task', 'progress': 67}),
      }, before.revision);
      await command('delete');
      engine.setActive(true);
      await engine.settled;
      expect(engine.error, null);
      expect(engine.conflicts, hasLength(1));
      final conflict = engine.conflicts.single;
      expect(conflict['remote']['record']['deleted'], true);
      expect(conflict['remote']['record']['metadata']['write'], false);
      expect(controller.findFull('todo', id)!.state['writable'], false);
      expect(controller.canWriteFullKind('todo'), true);
      await engine.resolve(
        'todo',
        id,
        keepLocal: true,
        expectedLocalRevision: conflict['localRevision'] as int,
        expectedRemoteRevision: conflict['remoteRevision'] as int,
      );
      await engine.settled;
      expect(engine.error, null);
      expect(engine.conflicts, isEmpty);
      expect(engine.pending, 0);
      expect(controller.findFull('todo', id), isNull);
      final copied = controller.fullRecords
          .where(
            (row) =>
                row.kind == 'todo' &&
                !row.deleted &&
                row.title == 'Recovered task',
          )
          .single;
      expect(copied.id, isNot(id));
      expect(copied.body['progress'], 67);
      expect(copied.body['source'], 'manual');
      final remote = await command('state');
      expect(remote['todo']['status'], 'dismissed');
      expect((remote['todos'] as List).single['id'], copied.id);
      expect((remote['todos'] as List).single['progress'], 67);
      await command('finished');
      stdout.writeln('LIVE_WORKSPACE_V2_COPY_PASSED');
    },
    skip: encoded.isEmpty,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
