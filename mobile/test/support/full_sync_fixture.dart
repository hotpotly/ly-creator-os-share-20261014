import 'dart:convert';
import 'dart:io';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../workspace_sync_engine_test.dart' show desktop;
import '../workspace_sync_engine_v2_test.dart' show LegacyClient;
import '../workspace_sync_store_test.dart' as v1;
import '../workspace_test.dart' show TestWorkspaceCipher;
import '../workspace_v2_driver_permissions_test.dart' show PermissionServer;
import '../workspace_v2_driver_test.dart' as base;
import '../workspace_v2_persistence_test.dart' as migration;
import 'full_workspace_fixture.dart' show fullFixtureSample;

class FullSyncServer extends PermissionServer {
  FullSyncServer() {
    scopes = List.of(WorkspaceV2Driver.supportedScopes);
    records['workspace'] = {
      'kind': 'todo_preferences',
      'id': 'workspace',
      'revision': 1,
      'sequence': 1,
      'deleted': false,
      'payload': migration.inline(
        jsonEncode(fullFixtureSample('todoPreferences')),
      ),
      'metadata': {
        'scope': 'preferences.todo',
        'read': true,
        'write': false,
        'deletable': false,
        'editableFields': <String>[],
        'source': null,
      },
    };
  }
  @override
  Future<Map<String, dynamic>> respond(
    String purpose,
    Map<String, dynamic> request,
  ) async {
    if (purpose == 'snapshot.start') {
      final values =
          records.values
              .map((row) => workspaceV2Map(jsonDecode(jsonEncode(row))))
              .toList()
            ..sort(
              (a, b) => '${a['kind']}:${a['id']}'.compareTo(
                '${b['kind']}:${b['id']}',
              ),
            );
      final value = {
        ...migration.manifest(values, now),
        'scopes': request['scopes'],
        'scopeDigest': request['scopeDigest'],
        'through': sequence,
      };
      manifests[value['manifestId'] as String] = values;
      return value;
    }
    return super.respond(purpose, request);
  }
}

class FullSyncFixture {
  FullSyncFixture(
    this.directory,
    this.store,
    this.controller,
    this.engine,
    this.server,
    this.legacy,
    this.connections,
  );
  final Directory directory;
  final SqliteWorkspaceStore store;
  final WorkspaceController controller;
  final WorkspaceSyncEngine engine;
  final FullSyncServer server;
  final LegacyClient legacy;
  final MemoryConnectionStore connections;

  static Future<FullSyncFixture> open({
    bool full = false,
    int budget = 256,
    WorkspaceRecord? oldTodo,
    bool legacyConflict = false,
  }) async {
    sqfliteFfiInit();
    final directory = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('full-panel-');
    final store = await SqliteWorkspaceStore.create(
      factory: databaseFactoryFfi,
      databasePath: '${directory.path}/workspace.sqlite',
      cipher: TestWorkspaceCipher(),
    );
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
    final controller = WorkspaceController(store);
    await controller.load();
    final server = FullSyncServer();
    final legacy = LegacyClient(server)..conflict = legacyConflict;
    final connections = MemoryConnectionStore(desktop);
    final engine = WorkspaceSyncEngine(
      store: store,
      controller: controller,
      connections: connections,
      client: legacy,
      environment: base.DriverEnvironment(),
      v2Exchange: server.exchange,
      v2MaxRequests: budget,
      discover: () async => [],
    );
    final fixture = FullSyncFixture(
      directory,
      store,
      controller,
      engine,
      server,
      legacy,
      connections,
    );
    engine.setActive(true);
    await engine.settled;
    if (oldTodo != null) await controller.save(oldTodo);
    if (full) {
      await engine.upgradeFullWorkspace(
        approvedScopes: WorkspaceV2Driver.supportedScopes,
      );
      await engine.settled;
    }
    await engine.refresh();
    return fixture;
  }

  Future<void> addFull(String id) async {
    server.add(id, base.fullBody(id), seq: ++server.sequence);
    engine.requestSync();
    await engine.settled;
  }

  Future<void> edit(String id, String title) async {
    final current = controller.findFull('todo', id)!;
    await controller.saveFullTodo({
      'id': id,
      'body': {...current.body, 'title': title},
    }, current.revision);
    await engine.refresh();
  }

  Future<void> conflict(String id, {bool deleted = false}) async {
    await edit(id, 'Phone draft');
    final prepared = await store.prepareV2Sync();
    final op = ((prepared['payload'] as Map)['operations'] as List).single;
    server.records[id] = server.record(
      id,
      base.fullBody(id, 'Desktop revision'),
      revision: 2,
      seq: ++server.sequence,
      deleted: deleted,
    );
    server.receipts[op['operationId'] as String] = {
      'operationId': op['operationId'],
      'localRevision': op['localRevision'],
      'status': 'conflict',
      'record': server.records[id],
    };
    engine.requestSync();
    await engine.settled;
  }

  Future<void> changeRemote(String id) async {
    server.add(
      id,
      base.fullBody(id, 'Newer desktop revision'),
      revision: 3,
      seq: ++server.sequence,
    );
    engine.requestSync();
    await engine.settled;
  }

  Future<void> reject(
    String id, {
    bool create = false,
    bool deleted = false,
  }) async {
    if (create) {
      await controller.saveFullTodo({
        'id': id,
        'body': base.createBody('Rejected new task'),
      }, 0);
    } else if (deleted) {
      final current = controller.findFull('todo', id)!;
      await controller.saveFullTodo({
        'id': id,
        'deleted': true,
      }, current.revision);
    } else {
      await edit(id, 'Rejected draft');
    }
    final prepared = await store.prepareV2Sync();
    final op = workspaceV2Map(
      ((prepared['payload'] as Map)['operations'] as List).single,
    );
    server.receipts[op['operationId'] as String] = {
      'operationId': op['operationId'],
      'localRevision': op['localRevision'],
      'status': 'rejected',
      'target': {'kind': 'todo', 'id': id},
      'operationHash': workspaceV2OperationHash(op),
      'code': 'invalid_change',
      'record': server.records[id],
    };
    engine.requestSync();
    await engine.settled;
  }

  Future<void> close() async {
    engine.dispose();
    await engine.settled;
    await controller.settled;
    controller.dispose();
    await store.close();
    await directory.delete(recursive: true);
  }
}
