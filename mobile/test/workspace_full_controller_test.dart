import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_full_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_sync_store_test.dart' as v1;
import 'workspace_test.dart' show TestWorkspaceCipher, todo;
import 'workspace_v2_persistence_test.dart' as migration;

class UnreadableWorkspaceCipher extends TestWorkspaceCipher {
  bool failRead = false;
  @override
  Future<String> decrypt(String text) {
    if (failRead) throw const FormatException('temporary read failure');
    return super.decrypt(text);
  }
}

class PostSaveUnreadableStore
    implements WorkspaceStore, WorkspaceV2Store, WorkspaceV2Persistence {
  PostSaveUnreadableStore(this.delegate);
  final SqliteWorkspaceStore delegate;
  bool unreadable = false;
  @override
  Future<Map<String, dynamic>> v2Status() => delegate.v2Status();
  @override
  Future<Map<String, dynamic>> loadV2Workspace() {
    if (unreadable) throw StateError('post-save read failure');
    return delegate.loadV2Workspace();
  }

  @override
  Future<List<WorkspaceRecord>> loadV2ReviewDrafts() =>
      delegate.loadV2ReviewDrafts();
  @override
  Future<List<Map<String, dynamic>>> saveV2Todos(
    List<Map<String, dynamic>> commands,
  ) async {
    final result = await delegate.saveV2Todos(commands);
    unreadable = true;
    return result;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  final fixtures =
      jsonDecode(
            File(
              '../shared-fixtures/workspace-domain-v2.json',
            ).readAsStringSync(),
          )
          as Map;
  Map<String, dynamic> sample(String name) => Map<String, dynamic>.from(
    jsonDecode(jsonEncode((fixtures['samples'] as Map)[name])) as Map,
  );
  Map<String, dynamic> createBody() => {
    ...sample('todoCreate'),
    'projectId': null,
    'stageKey': null,
  };
  late SqliteWorkspaceStore store;
  late WorkspaceController controller;
  late Directory directory;
  late UnreadableWorkspaceCipher cipher;
  final now = DateTime.utc(2026, 10, 3, 12);
  var notifications = 0;

  Future<void> activate([
    List<Map<String, dynamic>> rows = const [],
    Map<String, String> blobs = const {},
  ]) async {
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setV2ApprovedScopes(migration.scopes);
    final upgrade = await store.prepareV2Upgrade(
      migration.capsRequest(),
      migration.capsResponse(),
    );
    final id = upgrade['upgradeId'] as String;
    final manifest = migration.manifest(rows, now);
    await store.attachV2Manifest(id, manifest);
    await store.appendV2StagePage(
      id,
      migration.pageRequest(manifest),
      migration.pageResponse(manifest, rows),
    );
    for (final raw in blobs.values) {
      final bytes = utf8.encode(raw);
      for (var start = 0; start < bytes.length; start += 65536) {
        final end = start + 65536 < bytes.length ? start + 65536 : bytes.length;
        final chunk = bytes.sublist(start, end);
        await store.putV2StageJsonChunk(
          id,
          sha256: workspaceV2Sha256Sync(bytes),
          index: start ~/ 65536,
          bytes: chunk,
          chunkHash: workspaceV2Sha256Sync(chunk),
        );
      }
    }
    await controller.updateFromSync(() => store.activateV2Stage(id));
  }

  setUp(() async {
    final root = await Directory('../tmp/mobile-tests').create(recursive: true);
    directory = await root.createTemp('full-controller-');
    cipher = UnreadableWorkspaceCipher();
    store = await SqliteWorkspaceStore.create(
      factory: databaseFactoryFfi,
      databasePath: '${directory.path}/workspace.sqlite',
      cipher: cipher,
      now: () => now,
    );
    controller = WorkspaceController(store);
    notifications = 0;
    controller.onLocalChanged = () => notifications++;
    await controller.load();
  });
  tearDown(() async {
    controller.dispose();
    await store.close();
    await directory.delete(recursive: true);
  });

  test(
    'activation switches the unique domain and keeps editable local drafts',
    () async {
      final draft = WorkspaceRecord(
        kind: 'review_draft',
        id: 'weekly:2026-09-28',
        data: {'goalsText': '旧目标', 'bodyText': '原稿'},
      );
      await controller.save(draft);
      await activate();
      expect(controller.fullActive, true);
      expect(controller.records.single.kind, 'review_draft');
      expect(notifications, 0);
      await controller.save(
        controller.records.single.copy(
          data: {'goalsText': '改稿', 'bodyText': '原稿'},
        ),
      );
      expect(controller.records.single.data['goalsText'], '改稿');
      await expectLater(controller.save(todo()), throwsStateError);
      expect(controller.fullRecords, isEmpty);
    },
  );

  test(
    'full create offline and in flight retain completion and raw fields',
    () async {
      await activate();
      await store.setSyncEnabled(false);
      final id = workspaceId();
      await controller.saveFullTodo({'id': id, 'body': createBody()}, 0);
      final first = controller.findFull('todo', id)!;
      expect(first.progress, 37);
      expect(first.writable, true);
      expect(first.supported, true);
      expect(notifications, 1);
      expect(controller.records, isEmpty);
      expect(() => first.body['progress'] = 9, throwsUnsupportedError);
      expect(
        () => (first.metadata['editableFields'] as List).clear(),
        throwsUnsupportedError,
      );
      await store.setSyncEnabled(true);
      await store.prepareV2Sync();
      await controller.load();
      expect(controller.findFull('todo', id)!.writable, true);
      await controller.saveFullTodo({
        'id': id,
        'body': first.patched({'progress': 67}),
      }, first.revision);
      await expectLater(
        controller.saveFullTodo({
          'id': id,
          'body': first.patched({'progress': 40}),
        }, first.revision),
        throwsA(isA<WorkspaceConflict>()),
      );
      expect(controller.findFull('todo', id)!.progress, 67);
      expect(notifications, 2);
      await controller.updateFromSync(() async {});
      expect(notifications, 2);
    },
  );

  test(
    'bulk remains atomic and arguments are frozen before serial work',
    () async {
      await activate();
      final valid = {
        'command': {'id': workspaceId(), 'body': createBody()},
        'expectedLocalRevision': 0,
      };
      final invalid = {
        'command': {
          'id': workspaceId(),
          'body': {...createBody(), 'progress': -1},
        },
        'expectedLocalRevision': 0,
      };
      await expectLater(
        controller.saveFullTodos([valid, invalid]),
        throwsFormatException,
      );
      expect(controller.fullRecords, isEmpty);
      final future = controller.saveFullTodos([valid]);
      (valid['command'] as Map)['body'] = {'title': 'changed after call'};
      await future;
      expect(controller.fullRecords.single.progress, 37);
      expect(notifications, 1);
    },
  );

  test(
    'zero and clear are distinct before first remote confirmation',
    () async {
      await activate();
      await controller.saveFullWorkLog({'day': '2026-10-03', 'minutes': 0}, 0);
      final zero = controller.findFull('work_log', '2026-10-03')!;
      expect(zero.workMinutes, 0);
      expect(zero.writable, true);
      await controller.saveFullWorkLog({
        'day': '2026-10-03',
        'clear': true,
      }, zero.revision);
      expect(controller.findFull('work_log', '2026-10-03'), isNull);
      expect(
        controller
            .findFull('work_log', '2026-10-03', includeDeleted: true)!
            .workMinutes,
        isNull,
      );
    },
  );

  test(
    'full historical raw values and unknown records do not break reading',
    () async {
      final id = workspaceId();
      final body = {
        ...sample('todo'),
        'id': id,
        'title': 'x' * 80000,
        'progress': 12.25,
        'projectId': null,
        'stageKey': null,
        'stageLinkSource': null,
      };
      final raw = jsonEncode(body);
      final record = migration.v2Record(id: id, json: raw, blob: true);
      (record['metadata'] as Map)['editableFields'] = ['title', 'category'];
      await activate([record], {id: raw});
      final item = controller.fullRecords.single;
      expect(item.rawJson, raw);
      expect(item.title.length, 80000);
      expect(item.progress, 12.25);
      expect(item.writable, true);
      await controller.saveFullTodo({
        'id': id,
        'body': item.patched({'category': 'life'}),
      }, item.revision);
      expect(controller.fullRecords.single.title.length, 80000);
      expect(controller.fullRecords.single.progress, 12.25);
    },
  );

  test(
    'unsafe JSON is retained byte for byte and never promoted by metadata',
    () {
      const raw = '{"title":"未知格式","progress":1e400,"nested":{"values":[1,2]}}';
      final row = WorkspaceFullRecord({
        'kind': 'todo',
        'id': workspaceId(),
        'json': raw,
        'localRevision': 3,
        'remoteRevision': 1,
        'deleted': false,
        'metadata': {
          'editableFields': ['title'],
        },
        'writable': true,
      });
      expect(row.title, '未知格式');
      expect(row.rawJson, raw);
      expect(row.writable, false);
      expect(row.canEdit('title'), false);
      expect(
        () => ((row.body['nested'] as Map)['values'] as List).add(3),
        throwsUnsupportedError,
      );
    },
  );

  test(
    'failed full reload retains visible raw data and never falls back to v1',
    () async {
      await activate();
      final id = workspaceId();
      await controller.saveFullTodo({'id': id, 'body': createBody()}, 0);
      final raw = controller.fullRecords.single.rawJson;
      cipher.failRead = true;
      await controller.load();
      expect(controller.loaded, false);
      expect(controller.fullActive, true);
      expect(controller.fullRecords.single.rawJson, raw);
      expect(controller.canWriteFullKind('todo'), false);
      await expectLater(
        controller.saveFullTodo({'id': workspaceId(), 'body': createBody()}, 0),
        throwsStateError,
      );
      expect(notifications, 1);
      cipher.failRead = false;
      await controller.load();
      expect(controller.loaded, true);
      expect(controller.fullRecords.single.rawJson, raw);
      expect(notifications, 1);
    },
  );

  test(
    'a committed save followed by reload failure does not advertise a failed save',
    () async {
      await activate();
      controller.dispose();
      final proxy = PostSaveUnreadableStore(store);
      controller = WorkspaceController(proxy)
        ..onLocalChanged = () => notifications++;
      await controller.load();
      final id = workspaceId();
      await controller.saveFullTodo({'id': id, 'body': createBody()}, 0);
      expect(controller.loaded, false);
      expect(controller.error, '本机已保存，工作区暂时无法读取');
      expect(controller.fullRecords, isEmpty);
      expect(notifications, 1);
      expect((await store.loadV2Workspace())['pendingCount'], 1);
      proxy.unreadable = false;
      await controller.load();
      expect(controller.fullRecords.single.id, id);
      expect(controller.fullRecords.single.revision, 1);
      expect(controller.loaded, true);
      expect(notifications, 1);
    },
  );

  test(
    'dates keep the complete domain range instead of the v1 picker limit',
    () {
      final body = {
        ...sample('todo'),
        'id': workspaceId(),
        'plannedDate': '0026-10-03',
        'dateRange': null,
      };
      final row = WorkspaceFullRecord({
        'kind': 'todo',
        'id': body['id'],
        'json': jsonEncode(body),
        'localRevision': 1,
        'remoteRevision': 1,
        'deleted': false,
        'metadata': {},
        'writable': false,
      });
      expect(row.appearsOn('0026-10-03', '2026-10-03'), true);
      final range = {
        ...body,
        'plannedDate': null,
        'segment': null,
        'dateRange': {
          'startDate': '2026-12-30',
          'endDate': '2027-01-02',
          'name': '范围',
        },
      };
      final next = WorkspaceFullRecord({
        ...row.state,
        'json': jsonEncode(range),
      });
      expect(next.appearsOn('2027-01-01', '2027-01-01'), true);
      expect(next.appearsOn('2027-01-03', '2027-01-01'), false);
      expect(
        workspaceDomainV2Inspect(
          'todo',
          body['id'] as String,
          row.rawJson,
        )['supported'],
        true,
      );
    },
  );
}
