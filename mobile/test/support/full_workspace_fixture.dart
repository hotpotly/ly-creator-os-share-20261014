import 'dart:convert';
import 'dart:io';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../workspace_sync_store_test.dart' as v1;
import '../workspace_test.dart' show TestWorkspaceCipher;
import '../workspace_v2_persistence_test.dart' as migration;

Map<String, dynamic> fullFixtureSample(String name) =>
    Map<String, dynamic>.from(
      jsonDecode(
            File(
              '../shared-fixtures/workspace-domain-v2.json',
            ).readAsStringSync(),
          )['samples'][name]
          as Map,
    );

class FullWorkspaceFixture {
  FullWorkspaceFixture(this.directory, this.store, this.controller);
  final Directory directory;
  final SqliteWorkspaceStore store;
  final WorkspaceController controller;

  static Future<FullWorkspaceFixture> open({
    List<Map<String, dynamic>> todos = const [],
    List<Map<String, dynamic>> workLogs = const [],
    List<String> deletedWorkLogs = const [],
    bool writable = true,
    bool preferences = true,
    List<Map<String, dynamic>>? projects,
  }) async {
    sqfliteFfiInit();
    final root = await Directory('../tmp/mobile-tests').create(recursive: true);
    final directory = await root.createTemp('full-ui-');
    final store = await SqliteWorkspaceStore.create(
      factory: databaseFactoryFfi,
      databasePath: '${directory.path}/workspace.sqlite',
      cipher: TestWorkspaceCipher(),
    );
    final controller = WorkspaceController(store);
    await controller.load();
    const scopes = [
      'preferences.todo',
      'project.catalog',
      'todo.full',
      'work_log',
    ];
    final caps = {
      ...migration.capsResponse(),
      'supportedScopes': scopes,
      'permissions': [
        for (final scope in scopes)
          {
            'scope': scope,
            'read': true,
            'write': writable && ['todo.full', 'work_log'].contains(scope),
          },
      ],
    };
    final records = <Map<String, dynamic>>[];
    void add(String kind, String id, Map<String, dynamic> body) {
      final write =
          writable &&
          (kind == 'work_log' || kind == 'todo' && body['source'] == 'manual');
      records.add({
        'kind': kind,
        'id': id,
        'revision': 1,
        'sequence': records.length + 1,
        'deleted': kind == 'work_log' && deletedWorkLogs.contains(id),
        'payload': migration.inline(jsonEncode(body)),
        'metadata': {
          'scope': workspaceV2KindScopes[kind],
          'read': true,
          'write': write,
          'deletable': write,
          'editableFields': !write
              ? <String>[]
              : kind == 'todo'
              ? workspaceDomainV2TodoUnits.values
                    .expand((fields) => fields)
                    .toList()
              : ['totalMinutes'],
          'source': kind == 'todo' ? body['source'] : null,
        },
      });
    }

    for (final body in todos) {
      add('todo', body['id'] as String, body);
    }
    for (final body in workLogs) {
      add('work_log', body['day'] as String, body);
    }
    for (final body in projects ?? [fullFixtureSample('projectCatalog')]) {
      add('project_catalog', body['id'] as String, body);
    }
    if (preferences) {
      add(
        'todo_preferences',
        'workspace',
        fullFixtureSample('todoPreferences'),
      );
    }
    records.sort((a, b) {
      final kind = (a['kind'] as String).compareTo(b['kind'] as String);
      return kind == 0
          ? (a['id'] as String).compareTo(b['id'] as String)
          : kind;
    });
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setV2ApprovedScopes(scopes);
    final upgrade = await store.prepareV2Upgrade({
      ...migration.capsRequest(),
      'clientScopes': scopes,
    }, caps);
    final id = upgrade['upgradeId'] as String;
    final manifest = {
      ...migration.manifest(records, DateTime.now()),
      'scopes': scopes,
      'scopeDigest': workspaceV2ScopeDigest(scopes),
    };
    await store.attachV2Manifest(id, manifest);
    await store.appendV2StagePage(
      id,
      migration.pageRequest(manifest),
      migration.pageResponse(manifest, records),
    );
    await controller.updateFromSync(() => store.activateV2Stage(id));
    return FullWorkspaceFixture(directory, store, controller);
  }

  Future<void> replaceRemote(
    String kind,
    String id,
    Map<String, dynamic> body,
  ) async {
    final current = controller.findFull(kind, id, includeDeleted: true)!;
    final prepared = await store.prepareV2Sync();
    final request = Map<String, dynamic>.from(prepared['payload'] as Map);
    if ((request['operations'] as List).isNotEmpty) {
      throw StateError('fixture expects a clean queue');
    }
    final sequence = (request['cursor'] as int) + 1;
    final response = {
      ...migration.identity(),
      'scopes': request['scopes'],
      'scopeDigest': request['scopeDigest'],
      'cursor': sequence,
      'through': sequence,
      'hasMore': false,
      'receipts': <Map<String, dynamic>>[],
      'changes': [
        {
          'kind': kind,
          'id': id,
          'revision': current.remoteRevision + 1,
          'sequence': sequence,
          'deleted': false,
          'payload': migration.inline(jsonEncode(body)),
          'metadata': current.metadata,
        },
      ],
    };
    await controller.updateFromSync(() async {
      final staged = await store.stageV2SyncResponse(
        request,
        response,
        permissionContext: prepared['permissionContext'] as String?,
      );
      await store.commitV2SyncResponse(staged['responseId'] as String);
    });
  }

  Future<void> close() async {
    await controller.settled;
    controller.dispose();
    await store.close();
    await directory.delete(recursive: true);
  }
}
