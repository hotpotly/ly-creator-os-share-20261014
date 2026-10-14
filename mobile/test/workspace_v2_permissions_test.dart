import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_v2_driver_test.dart' show DriverServer, fullBody;
import 'workspace_sync_store_test.dart' as v1;
import 'workspace_v2_persistence_test.dart' as migration;

class PermissionCipher extends TestWorkspaceCipher {
  bool failComplete = false;
  @override
  Future<String> encrypt(String value) {
    if (failComplete && value.contains('"completed":{')) {
      throw StateError('commit failed');
    }
    return super.encrypt(value);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory dir;
  late String path;
  late SqliteWorkspaceStore store;
  late PermissionCipher cipher;
  late DateTime now;
  late DriverServer server;
  late String id;
  late Map<String, dynamic> remote;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: path,
    cipher: cipher,
    now: () => now,
  );
  Future<void> restart() async {
    await store.close();
    store = await open();
  }

  Future<Map<String, dynamic>> local([String? key]) async => workspaceV2Map(
    ((await store.loadV2Workspace())['records'] as List).firstWhere(
      (r) => r['id'] == (key ?? id),
    ),
  );
  Future<void> caps(bool write) async {
    final response = migration.capsResponse();
    response['permissions'] = [
      for (final scope in migration.scopes)
        {'scope': scope, 'read': true, 'write': write},
    ];
    await store.refreshV2Capabilities(migration.capsRequest(), response);
  }

  Future<void> edit(String title) async {
    final row = await local();
    await store.saveV2Todo({
      'id': id,
      'body': {
        ...workspaceV2Map(jsonDecode(row['json'] as String)),
        'title': title,
      },
    }, row['localRevision'] as int);
  }

  Future<Map<String, dynamic>> start(List<Map<String, dynamic>> records) async {
    final stage = await store.beginV2PermissionRefresh();
    final manifest = migration.manifest(records, now);
    await store.attachV2PermissionManifest(
      stage['refreshId'] as String,
      manifest,
    );
    return {...stage, 'manifest': manifest};
  }

  Future<void> page(
    Map<String, dynamic> stage,
    List<Map<String, dynamic>> records, {
    String? after,
    String? next,
  }) => store.appendV2PermissionPage(
    stage['refreshId'] as String,
    migration.pageRequest(workspaceV2Map(stage['manifest']), after: after),
    migration.pageResponse(
      workspaceV2Map(stage['manifest']),
      records,
      next: next,
    ),
  );
  Future<void> proof(List<Map<String, dynamic>> records) async {
    final stage = await start(records);
    await page(stage, records);
    await store.commitV2Permissions(stage['refreshId'] as String);
  }

  Map<String, dynamic> response(
    Map<String, dynamic> request,
    List<Map<String, dynamic>> changes, {
    List<Map<String, dynamic>> receipts = const [],
    int cursor = 101,
  }) => {
    ...migration.identity(),
    'scopes': request['scopes'],
    'scopeDigest': request['scopeDigest'],
    'cursor': cursor,
    'through': cursor,
    'hasMore': false,
    'receipts': receipts,
    'changes': changes,
  };
  setUp(() async {
    dir = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('permissions-');
    path = '${dir.path}/workspace.sqlite';
    cipher = PermissionCipher();
    now = DateTime.utc(2026, 10, 3, 12);
    server = DriverServer();
    id = workspaceId();
    remote = server.record(id, fullBody(id));
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setV2ApprovedScopes(migration.scopes);
    final stage = await store.prepareV2Upgrade(
      migration.capsRequest(),
      migration.capsResponse(),
    );
    final manifest = migration.manifest([remote], now),
        key = stage['upgradeId'] as String;
    await store.attachV2Manifest(key, manifest);
    await store.appendV2StagePage(
      key,
      migration.pageRequest(manifest),
      migration.pageResponse(manifest, [remote]),
    );
    await store.activateV2Stage(key);
  });
  tearDown(() async {
    await store.close();
    await dir.delete(recursive: true);
  });

  test(
    'permission elevation needs a complete authenticated matching proof',
    () async {
      final original = await local();
      expect(original['writable'], true);
      await caps(false);
      await caps(true);
      expect((await local())['writable'], false);
      await expectLater(edit('unsafe'), throwsStateError);
      final stage = await start([remote]);
      await expectLater(
        store.commitV2Permissions(stage['refreshId'] as String),
        throwsStateError,
      );
      await page(stage, [remote]);
      expect((await local())['writable'], false);
      await store.commitV2Permissions(stage['refreshId'] as String);
      expect((await local())['writable'], true);
      expect((await local())['json'], original['json']);
      expect((await local())['localRevision'], original['localRevision']);
      await edit('allowed');
    },
  );

  test(
    'proof submission preserves pending successors and immutable operations',
    () async {
      await edit('first');
      final sent = await store.prepareV2Sync();
      await edit('successor');
      final before = await local(),
          cursor = (await store.loadV2Workspace())['cursor'];
      await caps(false);
      await caps(true);
      await proof([remote]);
      final after = await local();
      for (final key in [
        'json',
        'localRevision',
        'pending',
        'inflight',
        'remoteRevision',
      ]) {
        expect(after[key], before[key]);
      }
      expect((await store.prepareV2Sync())['payload'], sent['payload']);
      expect((await store.loadV2Workspace())['cursor'], cursor);
    },
  );

  test('narrow field proof is not replaced by old record metadata', () async {
    await caps(false);
    await caps(true);
    final narrowed = {
      ...remote,
      'metadata': {
        ...workspaceV2Map(remote['metadata']),
        'editableFields': ['category'],
      },
    };
    await proof([narrowed]);
    await expectLater(edit('not allowed'), throwsStateError);
    final row = await local();
    await store.saveV2Todo({
      'id': id,
      'body': {
        ...workspaceV2Map(jsonDecode(row['json'] as String)),
        'category': 'life',
      },
    }, row['localRevision'] as int);
    expect((await local())['metadata'], narrowed['metadata']);
  });

  test(
    'request epoch is captured before transport and cannot be refreshed by ABA',
    () async {
      final prepared = await store.prepareV2Sync(),
          request = workspaceV2Map(prepared['payload']);
      await caps(false);
      await caps(true);
      final changed = server.record(
        id,
        fullBody(id, 'remote change'),
        revision: 2,
        seq: 101,
      );
      final staged = await store.stageV2SyncResponse(
        request,
        response(request, [changed]),
        permissionContext: prepared['permissionContext'] as String?,
      );
      await store.commitV2SyncResponse(staged['responseId'] as String);
      expect(
        jsonDecode((await local())['json'] as String)['title'],
        'remote change',
      );
      expect((await local())['writable'], false);
      final current = await store.prepareV2Sync(),
          currentRequest = workspaceV2Map(current['payload']);
      final newer = server.record(
        id,
        fullBody(id, 'fresh'),
        revision: 3,
        seq: 102,
      );
      final fresh = await store.stageV2SyncResponse(
        currentRequest,
        response(currentRequest, [newer], cursor: 102),
        permissionContext: current['permissionContext'] as String?,
      );
      await store.commitV2SyncResponse(fresh['responseId'] as String);
      expect((await local())['writable'], true);
    },
  );

  test(
    'a previously staged writable response still commits facts after downgrade',
    () async {
      final prepared = await store.prepareV2Sync(),
          request = workspaceV2Map(prepared['payload']);
      final changed = server.record(
        id,
        fullBody(id, 'received'),
        revision: 2,
        seq: 101,
      );
      final stage = await store.stageV2SyncResponse(
        request,
        response(request, [changed]),
        permissionContext: prepared['permissionContext'] as String?,
      );
      await caps(false);
      await restart();
      await store.commitV2SyncResponse(stage['responseId'] as String);
      expect((await local())['writable'], false);
      expect(
        jsonDecode((await local())['json'] as String)['title'],
        'received',
      );
      await caps(true);
      expect((await local())['writable'], false);
    },
  );

  test(
    'checkpoint survives restart and a paused sync without early permission',
    () async {
      await caps(false);
      await caps(true);
      final other = server.record(workspaceId(), fullBody(workspaceId()));
      final rows = [remote, other]
        ..sort((a, b) => (a['id'] as String).compareTo(b['id'] as String));
      final stage = await start(rows);
      await page(stage, [rows.first], next: 'next');
      await store.setSyncEnabled(false);
      await restart();
      expect((await store.v2PermissionStatus())['stage'], isNotNull);
      expect((await local())['writable'], false);
      await store.setSyncEnabled(true);
      await page(stage, [rows.last], after: 'next');
      await store.commitV2Permissions(stage['refreshId'] as String);
      expect((await local())['writable'], true);
    },
  );

  test(
    'scope epoch changes discard old proof and stage without editing facts',
    () async {
      await caps(false);
      await caps(true);
      await proof([remote]);
      final before = (await local())['json'];
      final stage = await start([remote]);
      await page(stage, [remote]);
      await store.invalidateV2Capabilities();
      await caps(true);
      await expectLater(
        store.commitV2Permissions(stage['refreshId'] as String),
        throwsA(anyOf(isA<StateError>(), isA<FormatException>())),
      );
      expect((await local())['writable'], false);
      expect((await local())['json'], before);
    },
  );

  test(
    'a completed proof has no 24-hour offline expiry, unfinished stage does',
    () async {
      await caps(false);
      await caps(true);
      await proof([remote]);
      now = now.add(const Duration(days: 3));
      await restart();
      expect((await local())['writable'], true);
      final stage = await start([remote]);
      now = now.add(const Duration(hours: 25));
      await restart();
      expect((await store.v2PermissionStatus())['stage'], isNull);
      expect((await local())['writable'], true);
      await store.cancelV2PermissionRefresh(stage['refreshId'] as String);
    },
  );

  test(
    'last encrypted write failure rolls back all promoted metadata',
    () async {
      await caps(false);
      await caps(true);
      final stage = await start([remote]);
      await page(stage, [remote]);
      cipher.failComplete = true;
      await expectLater(
        store.commitV2Permissions(stage['refreshId'] as String),
        throwsStateError,
      );
      expect((await local())['writable'], false);
      cipher.failComplete = false;
      await restart();
      await store.commitV2Permissions(stage['refreshId'] as String);
      expect((await local())['writable'], true);
    },
  );

  test(
    'missing initialized state fails closed instead of restoring epoch zero',
    () async {
      await caps(false);
      await caps(true);
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(path);
      await db.delete('workspace_v2_permission_state');
      await db.close();
      await expectLater(open(), throwsFormatException);
    },
  );

  test('invalid final digest cannot grant permissions', () async {
    await caps(false);
    await caps(true);
    final stage = await store.beginV2PermissionRefresh();
    final manifest = {
      ...migration.manifest([remote], now),
      'entriesSha256': 'a' * 64,
    };
    final invalid = {...stage, 'manifest': manifest};
    await store.attachV2PermissionManifest(
      stage['refreshId'] as String,
      manifest,
    );
    await page(invalid, [remote]);
    await expectLater(
      store.commitV2Permissions(stage['refreshId'] as String),
      throwsFormatException,
    );
    expect((await local())['writable'], false);
  });
  test(
    'permission metadata budget blocks retries durably without dropping facts',
    () async {
      await edit('local draft');
      await caps(false);
      await caps(true);
      final before = await local();
      final records = List.generate(
        7000,
        (index) => {
          ...remote,
          'id': '00000000-0000-4000-8000-${index.toString().padLeft(12, '0')}',
          'metadata': {
            ...workspaceV2Map(remote['metadata']),
            'editableFields': List.generate(
              40,
              (i) => 'field${i.toString().padLeft(2, '0')}${'x' * 57}',
            ),
          },
        },
      );
      final stage = await start(records);
      var exceeded = false;
      for (var offset = 0; offset < records.length; offset += 70) {
        final end = (offset + 70).clamp(0, records.length);
        try {
          await page(
            stage,
            records.sublist(offset, end),
            after: offset == 0 ? null : 'page$offset',
            next: end == records.length ? null : 'page$end',
          );
        } on WorkspaceV2PermissionBudgetExceeded {
          exceeded = true;
          break;
        }
      }
      expect(exceeded, true);
      await restart();
      final status = await store.v2PermissionStatus();
      expect(status['blockedReason'], 'too_large');
      expect(status['stage'], null);
      expect(status['required'], false);
      for (final field in ['json', 'localRevision', 'pending', 'inflight']) {
        expect((await local())[field], before[field]);
      }
      await expectLater(
        store.beginV2PermissionRefresh(),
        throwsA(isA<WorkspaceV2PermissionBudgetExceeded>()),
      );
      await store.beginV2PermissionRefresh(retry: true);
      expect((await store.v2PermissionStatus())['blockedReason'], null);
    },
  );
  test(
    'unproven recovered response requests a proof even at epoch zero',
    () async {
      expect((await store.v2PermissionStatus())['required'], false);
      final sent = await store.prepareV2Sync();
      final request = workspaceV2Map(sent['payload']);
      final next = {...remote, 'revision': 2, 'sequence': 101};
      final stage = await store.stageV2SyncResponse(
        request,
        response(request, [next]),
      );
      await store.commitV2SyncResponse(stage['responseId'] as String);
      await restart();
      final status = await store.v2PermissionStatus();
      expect(status['epoch'], 0);
      expect(status['required'], true);
      expect((await local())['writable'], false);
    },
  );

  test(
    'unproven baseline advance invalidates completed and older staged proof',
    () async {
      await proof([remote]);
      expect((await store.v2PermissionStatus())['completed'], isNotNull);
      await start([remote]);
      final prepared = await store.prepareV2Sync();
      final request = workspaceV2Map(prepared['payload']);
      final next = {...remote, 'revision': 2, 'sequence': 101};
      final staged = await store.stageV2SyncResponse(
        request,
        response(request, [next]),
      );
      await store.commitV2SyncResponse(staged['responseId'] as String);
      final status = await store.v2PermissionStatus();
      expect(status['completed'], null);
      expect(status['stage'], null);
      expect(status['required'], true);
      expect((await local())['writable'], false);
    },
  );
}
