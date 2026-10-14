import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_sync_store_test.dart' as v1;
import 'workspace_sync_engine_test.dart' show desktop;
import 'workspace_v2_driver_test.dart' as base;
import 'workspace_v2_persistence_test.dart' as migration;

class DiscardCipher extends TestWorkspaceCipher {
  String? failContains;
  @override
  Future<String> encrypt(String text) async {
    if (failContains != null && text.contains(failContains!)) {
      throw StateError('archive encryption failure');
    }
    return super.encrypt(text);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory directory;
  late String path;
  late SqliteWorkspaceStore store;
  late DiscardCipher cipher;
  final raws = <String, String>{};
  final now = DateTime.utc(2026, 10, 3);
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

  Map<String, dynamic> remote(
    String id,
    String raw, {
    int revision = 1,
    int sequence = 1,
    bool deleted = false,
    String kind = 'todo',
  }) {
    final bytes = utf8.encode(raw), hash = workspaceV2Sha256Sync(bytes);
    raws[hash] = raw;
    return {
      'kind': kind,
      'id': id,
      'revision': revision,
      'sequence': sequence,
      'deleted': deleted,
      'payload': bytes.length <= workspaceV2InlineBytes
          ? migration.inline(raw)
          : {
              'encoding': 'blob',
              'ref': {
                'sha256': hash,
                'byteLength': bytes.length,
                'mediaType': 'application/json',
              },
            },
      'metadata': {
        'scope': workspaceV2KindScopes[kind],
        'read': true,
        'write': true,
        'deletable': true,
        'editableFields': kind == 'todo'
            ? workspaceDomainV2TodoUnits.values.expand((keys) => keys).toList()
            : ['totalMinutes'],
        'source': kind == 'todo' ? 'manual' : null,
      },
    };
  }

  Future<void> activate(List<Map<String, dynamic>> records) async {
    records.sort(
      (a, b) => '${a['kind']}:${a['id']}'.compareTo('${b['kind']}:${b['id']}'),
    );
    await store.setV2ApprovedScopes(migration.scopes);
    final upgrade = await store.prepareV2Upgrade(
          migration.capsRequest(),
          migration.capsResponse(),
        ),
        id = upgrade['upgradeId'] as String;
    final manifest = migration.manifest(records, now);
    await store.attachV2Manifest(id, manifest);
    await store.appendV2StagePage(
      id,
      migration.pageRequest(manifest),
      migration.pageResponse(manifest, records),
    );
    for (final record in records) {
      final payload = workspaceV2Map(record['payload']);
      if (payload['encoding'] != 'blob') continue;
      final hash = (payload['ref'] as Map)['sha256'] as String,
          bytes = utf8.encode(raws[hash]!);
      for (
        var index = 0;
        index * workspaceV2ChunkBytes < bytes.length;
        index++
      ) {
        final offset = index * workspaceV2ChunkBytes,
            chunk = bytes.sublist(
              offset,
              offset + workspaceV2ExpectedChunkLength(bytes.length, index),
            );
        await store.putV2StageJsonChunk(
          id,
          sha256: hash,
          index: index,
          bytes: chunk,
          chunkHash: workspaceV2Sha256Sync(chunk),
        );
      }
    }
    await store.activateV2Stage(id);
  }

  Future<Map<String, dynamic>> row(String id, {String kind = 'todo'}) async =>
      workspaceV2Map(
        ((await store.loadV2Workspace())['records'] as List).singleWhere(
          (r) => r['kind'] == kind && r['id'] == id,
        ),
      );
  Future<void> edit(String id, String title) async {
    final value = await row(id);
    await store.saveV2Todo({
      'id': id,
      'body': {
        ...workspaceV2Map(jsonDecode(value['json'] as String)),
        'title': title,
      },
    }, value['localRevision'] as int);
  }

  Future<Map<String, dynamic>> prepared() => store.prepareV2Sync();
  Map<String, dynamic> result(
    Map<String, dynamic> request, {
    List<Map<String, dynamic>> receipts = const [],
    List<Map<String, dynamic>> changes = const [],
    int? through,
  }) => {
    ...migration.identity(),
    'scopes': request['scopes'],
    'scopeDigest': request['scopeDigest'],
    'cursor': through ?? request['cursor'],
    'through': through ?? request['through'] ?? request['cursor'],
    'hasMore': false,
    'receipts': receipts,
    'changes': changes,
  };
  Future<void> apply(
    Map<String, dynamic> preparation,
    Map<String, dynamic> response,
  ) async {
    final request = workspaceV2Map(preparation['payload']);
    final stage = await store.stageV2SyncResponse(
      request,
      response,
      permissionContext: preparation['permissionContext'] as String?,
    );
    for (final download in stage['downloads'] as List) {
      final hash = download['sha256'] as String,
          bytes = utf8.encode(raws[hash]!);
      for (
        var index = 0;
        index * workspaceV2ChunkBytes < bytes.length;
        index++
      ) {
        final offset = index * workspaceV2ChunkBytes,
            chunk = bytes.sublist(
              offset,
              offset + workspaceV2ExpectedChunkLength(bytes.length, index),
            );
        await store.putV2ResponseJsonChunk(
          stage['responseId'] as String,
          sha256: hash,
          index: index,
          bytes: chunk,
          chunkHash: workspaceV2Sha256Sync(chunk),
        );
      }
    }
    await store.commitV2SyncResponse(stage['responseId'] as String);
  }

  Future<Map<String, dynamic>> reject(
    Map<String, dynamic> preparation, {
    Map<String, dynamic>? record,
    List<Map<String, dynamic>> changes = const [],
    int? through,
  }) async {
    final request = workspaceV2Map(preparation['payload']),
        operation = workspaceV2Map((request['operations'] as List).single);
    final receipt = {
      'status': 'rejected',
      'operationId': operation['operationId'],
      'localRevision': operation['localRevision'],
      'target': {'kind': operation['kind'], 'id': operation['id']},
      'operationHash': workspaceV2OperationHash(operation),
      'code': 'record_read_only',
      'record': record,
    };
    await apply(
      preparation,
      result(request, receipts: [receipt], changes: changes, through: through),
    );
    return receipt;
  }

  Future<void> discard(
    Map<String, dynamic> preview, {
    int? localRevision,
    String? operationId,
    int? remoteRevision,
  }) => store.discardV2Blocked(
    preview['kind'] as String,
    preview['id'] as String,
    expectedLocalRevision:
        localRevision ?? preview['expectedLocalRevision'] as int,
    expectedOperationId:
        operationId ?? preview['expectedOperationId'] as String,
    expectedRemoteRevision:
        remoteRevision ?? preview['expectedRemoteRevision'] as int,
  );
  Future<T> inspect<T>(Future<T> Function(Database) operation) async {
    await store.close();
    final db = await databaseFactoryFfi.openDatabase(path);
    try {
      return await operation(db);
    } finally {
      await db.close();
      store = await open();
    }
  }

  Future<List<Map<String, dynamic>>> history() => inspect(
    (db) async => [
      for (final row in await db.query('workspace_v2_history'))
        workspaceV2Map(
          jsonDecode(await cipher.decrypt(row['payload'] as String)),
        ),
    ],
  );
  Future<Map<String, dynamic>> seedBlocked({
    bool create = false,
    bool deleting = false,
  }) async {
    final id = workspaceId(),
        original = remote(id, jsonEncode(base.fullBody(id)));
    await activate(create ? [] : [original]);
    if (create) {
      await store.saveV2Todo({
        'id': id,
        'body': base.createBody('new rejected'),
      }, 0);
    } else if (deleting) {
      await store.saveV2Todo({
        'id': id,
        'deleted': true,
      }, (await row(id))['localRevision'] as int);
    } else {
      await edit(id, 'rejected local');
    }
    await reject(await prepared(), record: create ? null : original);
    return store.loadV2BlockedPreview('todo', id);
  }

  setUp(() async {
    raws.clear();
    directory = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('discard-blocked-');
    path = '${directory.path}/workspace.sqlite';
    cipher = DiscardCipher();
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
  });
  tearDown(() async {
    cipher.failContains = null;
    await store.close();
    await directory.delete(recursive: true);
  });

  test(
    'rejected deletion archives before adopting baseline without queue or watermark changes',
    () async {
      final preview = await seedBlocked(deleting: true),
          before = await store.loadV2Workspace();
      final id = preview['id'] as String;
      expect(preview['local']['deleted'], true);
      await discard(preview);
      final after = await store.loadV2Workspace(), clean = await row(id);
      expect(clean['deleted'], false);
      expect(clean['json'], preview['remote']['json']);
      expect(
        clean['localRevision'],
        (preview['expectedLocalRevision'] as int) + 1,
      );
      for (final field in ['pending', 'inflight', 'blocked', 'conflict']) {
        expect(clean[field], null);
      }
      for (final field in [
        'cursor',
        'knownSequence',
        'through',
        'capabilitiesResponse',
      ]) {
        expect(after[field], before[field]);
      }
      final archived = (await history()).single;
      expect(archived['decision'], 'discard_blocked');
      expect(archived['local']['deleted'], true);
      expect(archived['baseline']['json'], preview['remote']['json']);
      expect((await prepared())['payload']['operations'], isEmpty);
      await inspect((db) async {
        expect(
          (await db.query('workspace_v2_history')).single['payload'],
          startsWith('test:'),
        );
        expect(
          (await db.query('workspace_v2_history')).single['payload'],
          isNot(contains('discard_blocked')),
        );
      });
    },
  );

  test(
    'rejected create only removes active local record and archives original',
    () async {
      final preview = await seedBlocked(create: true);
      expect(preview['remote'], null);
      expect(preview['expectedRemoteRevision'], 0);
      await discard(preview);
      expect((await store.loadV2Workspace())['records'], isEmpty);
      expect((await prepared())['payload']['operations'], isEmpty);
      expect(
        (await history()).single['local']['json'],
        preview['local']['json'],
      );
      await restart();
      expect((await store.loadV2Workspace())['records'], isEmpty);
    },
  );

  test(
    'preview and history use current successor rather than old frozen intent',
    () async {
      final preview = await seedBlocked();
      final id = preview['id'] as String;
      await edit(id, 'current successor');
      await expectLater(discard(preview), throwsA(isA<WorkspaceConflict>()));
      final current = await store.loadV2BlockedPreview('todo', id);
      expect(
        jsonDecode(current['local']['json'])['title'],
        'current successor',
      );
      await discard(current);
      final archived = (await history()).single;
      expect(archived['local']['json'], archived['pending']['json']);
      expect(
        jsonDecode(archived['local']['json'])['title'],
        'current successor',
      );
      expect(
        jsonDecode(archived['blocked']['frozen']['json'])['title'],
        'rejected local',
      );
    },
  );

  for (final field in ['local', 'operation', 'remote']) {
    test('$field CAS mismatch changes no facts or history', () async {
      final preview = await seedBlocked(),
          before = await store.loadV2Workspace();
      await expectLater(
        discard(
          preview,
          localRevision: field == 'local'
              ? (preview['expectedLocalRevision'] as int) + 1
              : null,
          operationId: field == 'operation' ? workspaceId() : null,
          remoteRevision: field == 'remote'
              ? (preview['expectedRemoteRevision'] as int) + 1
              : null,
        ),
        throwsA(isA<WorkspaceConflict>()),
      );
      expect(await store.loadV2Workspace(), before);
      expect(await history(), isEmpty);
    });
  }

  test(
    'any staged response blocks discard without changing original facts',
    () async {
      final preview = await seedBlocked(),
          prep = await prepared(),
          request = workspaceV2Map(prep['payload']);
      await store.stageV2SyncResponse(
        request,
        result(request),
        permissionContext: prep['permissionContext'] as String?,
      );
      final before = await store.loadV2Workspace();
      await expectLater(discard(preview), throwsStateError);
      expect(await store.loadV2Workspace(), before);
      expect(await history(), isEmpty);
    },
  );

  test(
    'inflight guard does not treat a rejected proof as cancellation authority',
    () async {
      final preview = await seedBlocked();
      await inspect((db) async {
        final saved = (await db.query('workspace_v2_blocked')).single;
        final blocked = workspaceV2Map(
          jsonDecode(await cipher.decrypt(saved['payload'] as String)),
        );
        await db.insert('workspace_v2_inflight', {
          'kind': 'todo',
          'id': preview['id'],
          'payload': await cipher.encrypt(jsonEncode(blocked['frozen'])),
        });
        await db.delete('workspace_v2_pending');
      });
      final before = await store.loadV2Workspace();
      await expectLater(discard(preview), throwsStateError);
      expect(await store.loadV2Workspace(), before);
      expect(await history(), isEmpty);
    },
  );

  for (final failure in ['"decision":"discard_blocked"', '"localRevision":3']) {
    test(
      'encryption failure at $failure rolls back history and local replacement',
      () async {
        final preview = await seedBlocked(),
            before = await store.loadV2Workspace();
        cipher.failContains = failure;
        await expectLater(discard(preview), throwsStateError);
        cipher.failContains = null;
        expect(await store.loadV2Workspace(), before);
        expect(await history(), isEmpty);
        await discard(preview);
        expect(await history(), hasLength(1));
      },
    );
  }

  test(
    'old rejected blob is archived fully before later cache collection and restart',
    () async {
      final id = workspaceId(), otherId = workspaceId();
      final original = remote(id, jsonEncode(base.fullBody(id))),
          other = remote(
            otherId,
            jsonEncode(base.fullBody(otherId)),
            sequence: 2,
          );
      await activate([original, other]);
      await edit(id, 'local raw');
      final prep = await prepared();
      final oldRaw = jsonEncode({...base.fullBody(id), 'title': '旧' * 30000});
      final old = remote(id, oldRaw, revision: 2, sequence: 101);
      final currentRaw = jsonEncode({
        ...base.fullBody(id),
        'title': 'latest baseline',
      });
      final current = remote(id, currentRaw, revision: 3, sequence: 102);
      await reject(prep, record: old, changes: [current], through: 102);
      final otherBefore = await row(otherId),
          before = await store.loadV2Workspace(),
          preview = await store.loadV2BlockedPreview('todo', id);
      expect(preview['expectedRemoteRevision'], 3);
      expect(preview['remote']['json'], currentRaw);
      await discard(preview);
      final archived = (await history()).single;
      expect(archived['receiptRecord']['json'], oldRaw);
      expect(archived['baseline']['json'], currentRaw);
      expect(await row(otherId), otherBefore);
      final pull = await prepared();
      await apply(pull, result(workspaceV2Map(pull['payload'])));
      await restart();
      expect((await history()).single['receiptRecord']['json'], oldRaw);
      expect((await row(id))['json'], currentRaw);
      expect((await store.loadV2Workspace())['cursor'], before['cursor']);
      await inspect(
        (db) async =>
            expect(await db.query('workspace_v2_json_objects'), isEmpty),
      );
    },
  );

  test(
    'unknown raw remote body is adopted exactly and remains readonly',
    () async {
      final id = workspaceId(),
          original = remote(id, jsonEncode(base.fullBody(id)));
      await activate([original]);
      await edit(id, 'local edit');
      final prep = await prepared(), encoded = jsonEncode(base.fullBody(id));
      final raw =
          '${encoded.substring(0, encoded.length - 1)}, "future": 1e400 }';
      final unknown = remote(id, raw, revision: 2, sequence: 101);
      await reject(prep, record: unknown);
      final preview = await store.loadV2BlockedPreview('todo', id);
      expect(preview['remote']['json'], raw);
      await discard(preview);
      final clean = await row(id);
      expect(clean['json'], raw);
      expect(clean['writable'], false);
      expect((await history()).single['receiptRecord']['json'], raw);
      await restart();
      expect((await row(id))['json'], raw);
    },
  );

  test(
    'tampered frozen base binding fails closed for preview and discard',
    () async {
      final preview = await seedBlocked();
      await inspect((db) async {
        final row = (await db.query('workspace_v2_blocked')).single;
        final value = workspaceV2Map(
          jsonDecode(await cipher.decrypt(row['payload'] as String)),
        );
        value['frozen']['baseJson'] = '{}';
        await db.update('workspace_v2_blocked', {
          'payload': await cipher.encrypt(jsonEncode(value)),
        });
      });
      await expectLater(
        store.loadV2BlockedPreview('todo', preview['id'] as String),
        throwsFormatException,
      );
      await expectLater(discard(preview), throwsFormatException);
      expect(await history(), isEmpty);
    },
  );

  test(
    'engine discard works disconnected and disabled without scheduling a network call',
    () async {
      final preview = await seedBlocked();
      await store.setSyncEnabled(false);
      await store.invalidateV2Capabilities();
      final controller = WorkspaceController(store);
      await controller.load();
      final environment = base.DriverEnvironment()..wifi = false;
      var networkCalls = 0;
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(),
        environment: environment,
        v2Exchange:
            (
              connection,
              purpose,
              payload, {
              required reserveCounter,
              expectedBlob,
              approvedPermissions,
            }) async {
              networkCalls++;
              throw StateError('must not send');
            },
      );
      addTearDown(() {
        engine.dispose();
        controller.dispose();
      });
      engine.active = true;
      final shown = await engine.loadBlockedPreview(
        'todo',
        preview['id'] as String,
      );
      await engine.discardBlocked(
        'todo',
        shown['id'] as String,
        expectedLocalRevision: shown['expectedLocalRevision'] as int,
        expectedOperationId: shown['expectedOperationId'] as String,
        expectedRemoteRevision: shown['expectedRemoteRevision'] as int,
      );
      await engine.settled;
      await Future<void>.delayed(const Duration(milliseconds: 500));
      expect(networkCalls, 0);
      expect(environment.acquired, 0);
      expect(engine.blocked, isEmpty);
      expect(
        controller.findFull('todo', preview['id'] as String)!.title,
        'original',
      );
    },
  );

  test(
    'engine cancelled while queued never discards the current draft',
    () async {
      final preview = await seedBlocked(),
          controller = WorkspaceController(store);
      await controller.load();
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(),
      );
      addTearDown(() {
        engine.dispose();
        controller.dispose();
      });
      final gate = Completer<void>(), entered = Completer<void>();
      final holding = controller.updateFromSync(() async {
        entered.complete();
        await gate.future;
      });
      await entered.future;
      final discarding = engine.discardBlocked(
        'todo',
        preview['id'] as String,
        expectedLocalRevision: preview['expectedLocalRevision'] as int,
        expectedOperationId: preview['expectedOperationId'] as String,
        expectedRemoteRevision: preview['expectedRemoteRevision'] as int,
      );
      await Future<void>.delayed(Duration.zero);
      engine.cancel();
      gate.complete();
      await holding;
      await expectLater(discarding, throwsA(isA<Exception>()));
      expect((await row(preview['id'] as String))['blocked'], isNotNull);
      expect(await history(), isEmpty);
    },
  );

  test(
    'worklog zero remains a real received baseline after rejecting a clear',
    () async {
      const day = '2026-10-03';
      final original = remote(
        day,
        jsonEncode({
          'day': day,
          'totalMinutes': 0,
          'selfMediaMinutes': 70,
          'aiMinutes': 20,
          'otherWorkMinutes': 0,
          'updatedAt': '',
        }),
        kind: 'work_log',
      );
      await activate([original]);
      await store.saveV2WorkLog({
        'day': day,
        'clear': true,
      }, (await row(day, kind: 'work_log'))['localRevision'] as int);
      await reject(await prepared(), record: original);
      final preview = await store.loadV2BlockedPreview('work_log', day);
      expect(preview['local']['deleted'], true);
      await discard(preview);
      final clean = await row(day, kind: 'work_log');
      expect(clean['deleted'], false);
      expect(clean['json'], original['payload']['json']);
      expect(jsonDecode(clean['json'])['totalMinutes'], 0);
      expect(jsonDecode(clean['json'])['selfMediaMinutes'], 70);
    },
  );

  test(
    'unknown current successor raw is archived without decoding and reencoding',
    () async {
      final preview = await seedBlocked();
      final id = preview['id'] as String;
      final oldRaw = preview['local']['json'] as String;
      final raw = '${oldRaw.substring(0, oldRaw.length - 1)}, "future":1e400}';
      await inspect((db) async {
        for (final table in ['records', 'pending']) {
          final saved = (await db.query(
            'workspace_v2_$table',
            where: 'id=?',
            whereArgs: [id],
          )).single;
          final value = workspaceV2Map(
            jsonDecode(await cipher.decrypt(saved['payload'] as String)),
          );
          value['json'] = raw;
          value['localRevision'] = (value['localRevision'] as int) + 1;
          if (table == 'records') {
            value['sha256'] = workspaceV2Sha256Sync(utf8.encode(raw));
          }
          await db.update(
            'workspace_v2_$table',
            {'payload': await cipher.encrypt(jsonEncode(value))},
            where: 'id=?',
            whereArgs: [id],
          );
        }
      });
      final shown = await store.loadV2BlockedPreview('todo', id);
      expect(shown['local']['json'], raw);
      await discard(shown);
      final archived = (await history()).single;
      expect(archived['local']['json'], raw);
      expect(archived['pending']['json'], raw);
      await restart();
      expect((await history()).single['local']['json'], raw);
    },
  );

  test(
    'discard preserves unrelated pending and permission persistence bytes',
    () async {
      final id = workspaceId(),
          otherId = workspaceId(),
          original = remote(id, jsonEncode(base.fullBody(id)));
      await activate([
        original,
        remote(otherId, jsonEncode(base.fullBody(otherId)), sequence: 2),
      ]);
      await edit(id, 'rejected');
      await reject(await prepared(), record: original);
      await edit(otherId, 'unrelated pending');
      final shown = await store.loadV2BlockedPreview('todo', id),
          other = await row(otherId);
      final permissions = await inspect(
        (db) async => {
          for (final table in [
            'permission_state',
            'permission_records',
            'permission_pages',
            'live',
          ])
            table: await db.query('workspace_v2_$table'),
        },
      );
      await discard(shown);
      expect(await row(otherId), other);
      final after = await inspect(
        (db) async => {
          for (final table in [
            'permission_state',
            'permission_records',
            'permission_pages',
            'live',
          ])
            table: await db.query('workspace_v2_$table'),
        },
      );
      expect(after, permissions);
    },
  );

  test(
    'engine local discard does not drain a request queued during controller refresh',
    () async {
      final preview = await seedBlocked(),
          controller = WorkspaceController(store);
      await controller.load();
      var calls = 0;
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(desktop),
        environment: base.DriverEnvironment(),
        v2Exchange:
            (
              connection,
              purpose,
              payload, {
              required reserveCounter,
              expectedBlob,
              approvedPermissions,
            }) async {
              calls++;
              throw StateError('must not send');
            },
      );
      addTearDown(() {
        engine.dispose();
        controller.dispose();
      });
      engine.active = true;
      controller.addListener(() {
        if (engine.busy) engine.requestSync();
      });
      await engine.discardBlocked(
        'todo',
        preview['id'] as String,
        expectedLocalRevision: preview['expectedLocalRevision'] as int,
        expectedOperationId: preview['expectedOperationId'] as String,
        expectedRemoteRevision: preview['expectedRemoteRevision'] as int,
      );
      await engine.settled;
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(calls, 0);
      expect(engine.busy, false);
    },
  );

  for (final denial in [
    'none',
    'no_scope',
    'remote_unknown',
    'remote_schedule',
    'local_unknown',
    'closed_project',
  ]) {
    test(
      'deleted Todo new-ID copy checks $denial without raising old tombstone metadata',
      () async {
        final id = workspaceId(),
            original = remote(id, jsonEncode(base.fullBody(id)));
        await activate([original]);
        await edit(id, 'preserved local');
        final prep = await prepared(),
            request = workspaceV2Map(prep['payload']),
            op = workspaceV2Map((request['operations'] as List).single);
        final body = {
          ...base.fullBody(id),
          'status': 'dismissed',
          'dismissedAt': now.toIso8601String(),
          if (denial == 'remote_unknown') 'unknown': 'keep',
          if (denial == 'remote_schedule') 'source': 'schedule',
        };
        final tombstone = remote(
          id,
          jsonEncode(body),
          revision: 2,
          sequence: 101,
          deleted: true,
        );
        tombstone['metadata'] = {
          ...workspaceV2Map(tombstone['metadata']),
          'write': false,
          'deletable': false,
          'editableFields': <String>[],
          if (denial == 'remote_schedule') 'source': 'schedule',
        };
        await apply(
          prep,
          result(
            request,
            receipts: [
              {
                'operationId': op['operationId'],
                'localRevision': op['localRevision'],
                'status': 'conflict',
                'record': tombstone,
              },
            ],
          ),
        );
        if (denial == 'no_scope') {
          final caps = migration.capsResponse();
          caps['permissions'] = [
            for (final scope in migration.scopes)
              {'scope': scope, 'read': true, 'write': false},
          ];
          await store.refreshV2Capabilities(migration.capsRequest(), caps);
        }
        if (denial == 'local_unknown' || denial == 'closed_project') {
          await inspect((db) async {
            final local = (await db.query('workspace_v2_records')).single;
            final value = workspaceV2Map(
              jsonDecode(await cipher.decrypt(local['payload'] as String)),
            );
            final json = jsonEncode({
              ...workspaceV2Map(jsonDecode(value['json'] as String)),
              if (denial == 'local_unknown') 'unknown': 'keep',
              if (denial == 'closed_project') 'projectId': 'missing',
            });
            value['json'] = json;
            value['sha256'] = workspaceV2Sha256Sync(utf8.encode(json));
            await db.update('workspace_v2_records', {
              'payload': await cipher.encrypt(jsonEncode(value)),
            });
            final pending = (await db.query('workspace_v2_pending')).single;
            final next = workspaceV2Map(
              jsonDecode(await cipher.decrypt(pending['payload'] as String)),
            );
            next['json'] = json;
            await db.update('workspace_v2_pending', {
              'payload': await cipher.encrypt(jsonEncode(next)),
            });
            final conflict = (await db.query('workspace_v2_conflicts')).single;
            final two = workspaceV2Map(
              jsonDecode(await cipher.decrypt(conflict['payload'] as String)),
            );
            two['local'] = value;
            await db.update('workspace_v2_conflicts', {
              'payload': await cipher.encrypt(jsonEncode(two)),
            });
          });
        }
        final before = await store.loadV2Workspace(), current = await row(id);
        final resolving = store.resolveV2Conflict(
          'todo',
          id,
          keepLocal: true,
          expectedLocalRevision: current['localRevision'] as int,
          expectedRemoteRevision: 2,
        );
        if (denial != 'none') {
          await expectLater(resolving, throwsStateError);
          expect(await store.loadV2Workspace(), before);
          expect(await history(), isEmpty);
          return;
        }
        final copied = await resolving;
        expect(copied, isNot(id));
        expect(copied, isNotNull);
        final old = await row(id), next = await row(copied!);
        expect(old['deleted'], true);
        expect(old['metadata']['write'], false);
        expect(old['metadata']['deletable'], false);
        expect(old['json'], tombstone['payload']['json']);
        expect(next['remoteRevision'], 0);
        expect(jsonDecode(next['json'])['title'], 'preserved local');
        final sent = await prepared();
        expect(sent['payload']['operations'], hasLength(1));
        expect(sent['payload']['operations'][0]['id'], copied);
        expect(sent['payload']['operations'][0]['baseRevision'], 0);
      },
    );
  }
}
