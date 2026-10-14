import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_sync_store_test.dart' as v1;
import 'workspace_test.dart' show TestWorkspaceCipher, todo;

class FailingMigrationCipher extends TestWorkspaceCipher {
  bool failActivation = false;
  @override
  Future<String> encrypt(String text) async {
    if (failActivation && text.contains('"activeProtocol":2')) {
      throw StateError('模拟事务写失败');
    }
    return super.encrypt(text);
  }
}

const scopes = ['todo.full', 'work_log'];
Map<String, dynamic> identity() => {
  'protocolVersion': 2,
  'workspaceId': v1.macId,
  'deviceId': v1.phoneId,
};
Map<String, dynamic> capsRequest() => {...identity(), 'clientScopes': scopes};
Map<String, dynamic> capsResponse() => {
  ...identity(),
  'supportedScopes': scopes,
  'permissions': [
    for (final scope in scopes) {'scope': scope, 'read': true, 'write': true},
  ],
  'limits': workspaceV2Limits,
  'schemaVersion': 1,
};
Map<String, dynamic> inline(String json) => {
  'encoding': 'json',
  'json': json,
  'sha256': workspaceV2Sha256Sync(utf8.encode(json)),
  'byteLength': utf8.encode(json).length,
};
Map<String, dynamic> v2Record({
  String? id,
  String json = '{"title":"正文", "unknown":{"future":1.5}}',
  bool blob = false,
  int sequence = 1,
  String kind = 'todo',
}) => {
  'kind': kind,
  'id': id ?? workspaceId(),
  'revision': 1,
  'sequence': sequence,
  'deleted': false,
  'payload': blob
      ? {
          'encoding': 'blob',
          'ref': {
            'sha256': workspaceV2Sha256Sync(utf8.encode(json)),
            'byteLength': utf8.encode(json).length,
            'mediaType': 'application/json',
          },
        }
      : inline(json),
  'metadata': {
    'scope': kind == 'todo' ? 'todo.full' : 'work_log',
    'read': true,
    'write': true,
    'deletable': true,
    'editableFields': ['title'],
    'source': kind == 'todo' ? 'manual' : null,
  },
};
Map<String, dynamic> manifest(
  List<Map<String, dynamic>> records,
  DateTime now,
) => {
  ...identity(),
  'schemaVersion': 1,
  'scopes': scopes,
  'scopeDigest': workspaceV2ScopeDigest(scopes),
  'manifestId': workspaceId(),
  'through': 100,
  'entityCount': records.length,
  'entriesSha256': workspaceV2ManifestDigest(records),
  'expiresAt': now.add(const Duration(hours: 12)).toUtc().toIso8601String(),
};
Map<String, dynamic> pageRequest(Map<String, dynamic> m, {String? after}) => {
  ...identity(),
  'manifestId': m['manifestId'],
  'after': after,
  'limit': 100,
};
Map<String, dynamic> pageResponse(
  Map<String, dynamic> m,
  List<Map<String, dynamic>> records, {
  String? next,
}) => {
  ...identity(),
  'manifestId': m['manifestId'],
  'records': records,
  'next': next,
  'done': next == null,
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory directory;
  late String dbPath;
  late SqliteWorkspaceStore store;
  late DateTime now;
  late FailingMigrationCipher cipher;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: dbPath,
    cipher: cipher,
    now: () => now,
  );
  Future<Database> raw() => databaseFactoryFfi.openDatabase(dbPath);
  Future<void> restart() async {
    await store.close();
    store = await open();
  }

  Future<String> prepare() async {
    await store.setV2ApprovedScopes(scopes);
    return (await store.prepareV2Upgrade(
          capsRequest(),
          capsResponse(),
        ))['upgradeId']
        as String;
  }

  Future<String> stage(
    List<Map<String, dynamic>> records, {
    Map<String, dynamic>? chosenManifest,
  }) async {
    final id = await prepare(), m = chosenManifest ?? manifest(records, now);
    await store.attachV2Manifest(id, m);
    await store.appendV2StagePage(id, pageRequest(m), pageResponse(m, records));
    return id;
  }

  Future<WorkspaceRecord> cleanTodo() async {
    final item = await store.save(todo());
    final sent =
        (await store.prepareSyncRequest())['payload'] as Map<String, dynamic>;
    final op = v1.operation(sent);
    await store.applySyncResponse(
      sent,
      v1.response(sent, receipts: [v1.receipt(op, v1.remote(item))], cursor: 1),
    );
    return (await store.load()).single;
  }

  Future<void> put(
    String upgradeId,
    String json,
    int index, {
    List<int>? replacement,
  }) async {
    final bytes = utf8.encode(json), start = index * workspaceV2ChunkBytes;
    final part =
        replacement ??
        bytes.sublist(
          start,
          (start + workspaceV2ChunkBytes).clamp(0, bytes.length),
        );
    await store.putV2StageJsonChunk(
      upgradeId,
      sha256: workspaceV2Sha256Sync(bytes),
      index: index,
      bytes: part,
      chunkHash: workspaceV2Sha256Sync(part),
    );
  }

  setUp(() async {
    now = DateTime.utc(2026, 10, 3, 12);
    cipher = FailingMigrationCipher();
    final root = await Directory('../tmp/mobile-tests').create(recursive: true);
    directory = await root.createTemp('workspace-v2-');
    dbPath = '${directory.path}/db.sqlite';
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
  });
  tearDown(() async {
    await store.close();
    await directory.delete(recursive: true);
  });

  test(
    'database upgrade leaves v1 pending original operation and data unchanged',
    () async {
      final original = await store.save(todo());
      final request = (await store.prepareSyncRequest())['payload'];
      await store.close();
      final db = await raw();
      final tables = await db.rawQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'workspace_v2_%'",
      );
      for (final row in tables) {
        await db.execute('DROP TABLE ${row['name']}');
      }
      await db.setVersion(2);
      await db.close();
      store = await open();
      expect((await store.load()).single.toJson(), original.toJson());
      expect((await store.prepareSyncRequest())['payload'], request);
      expect((await store.v2Status())['activeProtocol'], 1);
    },
  );

  test(
    'v2 counter persists independently and rejects disabled network',
    () async {
      expect(await store.reserveV2Counter(), 1);
      expect(await store.reserveV2Counter(), 2);
      expect((await store.syncStatus())['counter'], 0);
      await restart();
      expect(await store.reserveV2Counter(), 3);
      await store.setSyncEnabled(false);
      await expectLater(store.reserveV2Counter(), throwsStateError);
      expect((await store.v2Status())['counter'], 3);
    },
  );

  test(
    'capability approval is explicit and cannot gain unrequested scopes',
    () async {
      await expectLater(
        store.prepareV2Upgrade(capsRequest(), capsResponse()),
        throwsFormatException,
      );
      await store.setV2ApprovedScopes(['todo.full']);
      await expectLater(
        store.prepareV2Upgrade(capsRequest(), capsResponse()),
        throwsFormatException,
      );
      await store.setV2ApprovedScopes(scopes);
      await expectLater(
        store.prepareV2Upgrade({
          ...capsRequest(),
          'deviceId': workspaceId(),
        }, capsResponse()),
        throwsStateError,
      );
      await expectLater(
        store.prepareV2Upgrade({
          ...capsRequest(),
          'clientScopes': ['todo.full'],
        }, capsResponse()),
        throwsFormatException,
      );
      expect((await store.v2Status())['upgrade'], null);
    },
  );

  test(
    'old pending and immutable inflight block upgrade including lost ack',
    () async {
      await store.save(todo());
      await store.setV2ApprovedScopes(scopes);
      await expectLater(
        store.prepareV2Upgrade(capsRequest(), capsResponse()),
        throwsStateError,
      );
      final before = (await store.prepareSyncRequest())['payload'];
      await expectLater(
        store.prepareV2Upgrade(capsRequest(), capsResponse()),
        throwsStateError,
      );
      await restart();
      expect((await store.prepareSyncRequest())['payload'], before);
      expect((await store.v2Status())['activeProtocol'], 1);
    },
  );

  test('v1 fixed page and conflict each prevent freezing', () async {
    final item = await store.save(todo());
    final request =
        (await store.prepareSyncRequest())['payload'] as Map<String, dynamic>;
    await store.applySyncResponse(
      request,
      v1.response(
        request,
        receipts: [
          v1.receipt(
            v1.operation(request),
            v1.remote(item.copy(data: {...item.data, 'title': '电脑'})),
            status: 'conflict',
          ),
        ],
        cursor: 0,
        through: 1,
        hasMore: true,
      ),
    );
    await store.setV2ApprovedScopes(scopes);
    await expectLater(
      store.prepareV2Upgrade(capsRequest(), capsResponse()),
      throwsStateError,
    );
    expect((await store.syncStatus())['conflicts'], hasLength(1));
  });

  test(
    'freeze precedes manifest and blocks late empty v1 response without changing counter',
    () async {
      final request =
          (await store.prepareSyncRequest())['payload'] as Map<String, dynamic>;
      final before = await store.syncStatus(), id = await prepare();
      await expectLater(store.prepareSyncRequest(), throwsStateError);
      await expectLater(
        store.applySyncResponse(request, v1.response(request)),
        throwsStateError,
      );
      expect(await store.syncStatus(), before);
      await store.reserveV2Counter();
      final m = manifest([], now);
      await store.attachV2Manifest(id, m);
      await store.appendV2StagePage(id, pageRequest(m), pageResponse(m, []));
      await store.activateV2Stage(id);
      expect((await store.v2Status())['activeProtocol'], 2);
    },
  );

  test(
    'successful local edits cancel frozen token before manifest attach and preserve pending',
    () async {
      final item = await cleanTodo(),
          id = await prepare(),
          m = manifest([], now);
      final updated = await store.save(
        item.copy(data: {...item.data, 'title': '升级时新写'}),
      );
      await expectLater(store.attachV2Manifest(id, m), throwsStateError);
      expect((await store.load()).single.data['title'], updated.data['title']);
      expect((await store.v2Status())['localMutationEpoch'], 2);
      expect((await store.v2Status())['upgrade'], null);
      expect(
        (await store.prepareSyncRequest())['payload']['operations'],
        hasLength(1),
      );
    },
  );

  test(
    'each successful domain batch advances epoch once while failed batch changes nothing',
    () async {
      final a = todo(), b = todo();
      final saved = await store.saveAll([a, b]);
      expect((await store.v2Status())['localMutationEpoch'], 1);
      await expectLater(
        store.saveAll([
          saved[0].copy(data: {...a.data, 'title': '新'}),
          b,
        ]),
        throwsA(isA<WorkspaceConflict>()),
      );
      expect((await store.v2Status())['localMutationEpoch'], 1);
      expect((await store.load()).first.data['title'], a.data['title']);
    },
  );

  test(
    'draft writes do not invalidate upgrade and survive activation with old outbox',
    () async {
      final id = await stage([v2Record()]);
      final draft = await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {'goalsText': '原草稿', 'bodyText': '未知格式之前的正文'},
        ),
      );
      expect((await store.v2Status())['localMutationEpoch'], 0);
      await store.activateV2Stage(id);
      expect(
        (await store.loadV2ReviewDrafts()).single.toJson(),
        draft.toJson(),
      );
      expect(await store.pendingCount(), 1);
      await store.save(draft.copy(data: {...draft.data, 'bodyText': '继续离线草稿'}));
      await restart();
      expect(
        (await store.loadV2ReviewDrafts()).single.data['bodyText'],
        '继续离线草稿',
      );
    },
  );

  test(
    'activation atomically exposes original JSON and preserves v1 recovery archive',
    () async {
      final original = await cleanTodo();
      const json = '{ "unknown":{"x":1.5,"s":"😀"}, "title":"完整待办" }';
      final record = v2Record(id: original.id, json: json),
          id = await stage([v2Record(id: original.id, json: json)]);
      await store.activateV2Stage(id);
      expect((await store.loadV2Records()).single, {...record, 'json': json});
      await expectLater(store.load(), throwsStateError);
      await expectLater(
        store.save(original.copy(data: {...original.data, 'title': '不能写入旧库'})),
        throwsStateError,
      );
      await expectLater(store.prepareSyncRequest(), throwsStateError);
      await restart();
      expect((await store.loadV2Records()).single['json'], json);
      final db = await raw(), rows = await db.query('workspace_records');
      expect(rows, hasLength(1));
      expect(
        jsonDecode(
          await TestWorkspaceCipher().decrypt(rows.single['payload'] as String),
        ),
        original.toJson(),
      );
    },
  );

  test(
    'a page is idempotent but replacement and skipped token fail with checkpoint intact',
    () async {
      final records = [v2Record(id: 'a'), v2Record(id: 'b')],
          m = manifest([v2Record(id: 'a'), v2Record(id: 'b')], now),
          id = await prepare();
      await store.attachV2Manifest(id, m);
      final request = pageRequest(m),
          response = pageResponse(m, [records[0]], next: 'next');
      await store.appendV2StagePage(id, request, response);
      await store.appendV2StagePage(id, request, response);
      await expectLater(
        store.appendV2StagePage(
          id,
          pageRequest(m, after: 'skipped'),
          pageResponse(m, [records[1]]),
        ),
        throwsStateError,
      );
      expect(
        (await store.v2Status())['upgrade']['checkpoint']['verifiedCount'],
        1,
      );
      await restart();
      await store.appendV2StagePage(
        id,
        pageRequest(m, after: 'next'),
        pageResponse(m, [records[1]]),
      );
      await store.activateV2Stage(id);
      expect(await store.loadV2Records(), hasLength(2));
    },
  );

  for (final mode in ['identity', 'scopes', 'expired']) {
    test(
      'manifest $mode rejected while frozen token stays unchanged',
      () async {
        final id = await prepare(), m = manifest([], now);
        if (mode == 'identity') m['deviceId'] = workspaceId();
        if (mode == 'scopes') {
          m['scopes'] = ['todo.full'];
          m['scopeDigest'] = workspaceV2ScopeDigest(['todo.full']);
        }
        if (mode == 'expired') m['expiresAt'] = now.toIso8601String();
        await expectLater(
          store.attachV2Manifest(id, m),
          throwsA(anyOf(isA<FormatException>(), isA<StateError>())),
        );
        expect((await store.v2Status())['upgrade']['manifest'], null);
        await store.cancelV2Stage();
        expect((await store.v2Status())['activeProtocol'], 1);
      },
    );
  }

  test(
    'unfinished page, wrong digest and missing necessary JSON cannot activate',
    () async {
      final record = v2Record(),
          m = manifest([record], now),
          id = await prepare();
      m['entriesSha256'] = '0' * 64;
      await store.attachV2Manifest(id, m);
      await expectLater(
        store.activateV2Stage(id),
        throwsA(anyOf(isA<FormatException>(), isA<StateError>())),
      );
      await store.appendV2StagePage(
        id,
        pageRequest(m),
        pageResponse(m, [record]),
      );
      await expectLater(
        store.activateV2Stage(id),
        throwsA(anyOf(isA<FormatException>(), isA<StateError>())),
      );
      expect((await store.v2Status())['activeProtocol'], 1);
    },
  );

  test(
    'large JSON chunks resume out of order and keep UTF8 byte spelling',
    () async {
      final json = '{ "text":"${'中😀' * 18000}","unknown":{"version":1.5}}';
      final bytes = utf8.encode(json),
          record = v2Record(json: json, blob: true),
          id = await stage([v2Record(json: json, blob: true)]);
      await expectLater(store.activateV2Stage(id), throwsStateError);
      await put(id, json, 1);
      await put(id, json, 1);
      await restart();
      expect((await store.v2Status())['downloads'].single['receivedIndexes'], [
        1,
      ]);
      await put(id, json, 0);
      for (var i = 2; i < (bytes.length + 65535) ~/ 65536; i++) {
        await put(id, json, i);
      }
      expect((await store.v2Status())['downloads'].single['complete'], true);
      await store.activateV2Stage(id);
      await restart();
      expect((await store.loadV2Records()).single['json'], json);
      expect(
        (await store.loadV2Records()).single['payload'],
        record['payload'],
      );
    },
  );

  test(
    'unknown blob, bad hash, bad length and replacement do not acknowledge chunks',
    () async {
      final json = '{"text":"${'x' * 70000}"}',
          id = await stage([
            v2Record(json: '{"text":"${'x' * 70000}"}', blob: true),
          ]);
      final bytes = utf8.encode(json);
      await expectLater(
        store.putV2StageJsonChunk(
          id,
          sha256: '0' * 64,
          index: 0,
          bytes: bytes.sublist(0, 65536),
          chunkHash: workspaceV2Sha256Sync(bytes.sublist(0, 65536)),
        ),
        throwsFormatException,
      );
      await expectLater(
        store.putV2StageJsonChunk(
          id,
          sha256: workspaceV2Sha256Sync(bytes),
          index: 0,
          bytes: bytes.sublist(0, 65536),
          chunkHash: '0' * 64,
        ),
        throwsFormatException,
      );
      await expectLater(
        put(id, json, 0, replacement: [1]),
        throwsFormatException,
      );
      await put(id, json, 0);
      await expectLater(
        put(id, json, 0, replacement: List.filled(65536, 32)),
        throwsFormatException,
      );
      expect((await store.v2Status())['downloads'].single['receivedIndexes'], [
        0,
      ]);
    },
  );

  test(
    'full content mismatch rolls back final chunk rather than claiming complete',
    () async {
      final json = '{"text":"${'x' * 70000}"}',
          id = await stage([
            v2Record(json: '{"text":"${'x' * 70000}"}', blob: true),
          ]);
      await put(id, json, 0, replacement: List.filled(65536, 32));
      await expectLater(put(id, json, 1), throwsFormatException);
      expect((await store.v2Status())['downloads'].single['receivedIndexes'], [
        0,
      ]);
      await expectLater(store.activateV2Stage(id), throwsStateError);
    },
  );

  test(
    'non-object JSON cannot commit even with correct bytes and hash',
    () async {
      final json = '[${'0,' * 40000}0]',
          id = await stage([v2Record(json: '[${'0,' * 40000}0]', blob: true)]);
      await put(id, json, 0);
      await expectLater(put(id, json, 1), throwsFormatException);
      expect((await store.v2Status())['activeProtocol'], 1);
    },
  );

  test('two concurrent necessary downloads and expiry are enforced', () async {
    final jsons = [for (var i = 0; i < 3; i++) '{"text":"${'$i' * 70000}"}'];
    final records = [
          for (var i = 0; i < 3; i++)
            v2Record(id: 'r$i', json: jsons[i], blob: true),
        ],
        id = await stage([
          for (var i = 0; i < 3; i++)
            v2Record(id: 'r$i', json: jsons[i], blob: true),
        ]);
    expect(records, hasLength(3));
    await put(id, jsons[0], 0);
    await put(id, jsons[1], 0);
    await expectLater(put(id, jsons[2], 0), throwsStateError);
    await put(id, jsons[0], 1);
    await put(id, jsons[2], 0);
    now = now.add(const Duration(days: 2));
    await restart();
    expect((await store.v2Status())['upgrade'], null);
    expect((await store.v2Status())['activeProtocol'], 1);
    await store.prepareSyncRequest();
  });

  test(
    'revocation cancels temporary pages and prevents stale activation',
    () async {
      final id = await stage([v2Record()]);
      await store.setSyncEnabled(false);
      await expectLater(store.activateV2Stage(id), throwsStateError);
      expect((await store.v2Status())['upgrade'], null);
      await store.bindSync(v1.macId, v1.phoneId);
      await store.prepareSyncRequest();
    },
  );

  for (final table in [
    'workspace_v2_pages',
    'workspace_v2_staged_records',
    'workspace_v2_stage',
  ]) {
    test(
      'restart discards corrupt $table without damaging original v1 facts',
      () async {
        final original = await cleanTodo();
        await stage([v2Record(id: original.id)]);
        final db = await raw();
        await db.update(table, {'payload': 'corrupt'});
        await restart();
        expect((await store.load()).single.toJson(), original.toJson());
        expect((await store.v2Status())['upgrade'], null);
      },
    );
  }

  test(
    'restart rehashes saved chunks and cancels bad migration only',
    () async {
      final json = '{"text":"${'x' * 70000}"}',
          id = await stage([
            v2Record(json: '{"text":"${'x' * 70000}"}', blob: true),
          ]);
      await put(id, json, 0);
      final db = await raw();
      await db.update('workspace_v2_json_chunks', {'payload': 'corrupt'});
      await restart();
      expect((await store.v2Status())['upgrade'], null);
      expect(await store.load(), isEmpty);
    },
  );

  test(
    'all migration payloads are encrypted and mutable maps cannot change frozen evidence',
    () async {
      final response = capsResponse();
      await store.setV2ApprovedScopes(scopes);
      final id =
          (await store.prepareV2Upgrade(capsRequest(), response))['upgradeId']
              as String;
      response['supportedScopes'] = [];
      final record = v2Record(json: '{"title":"私有正文"}'),
          m = manifest([v2Record(json: '{"title":"私有正文"}')], now);
      m['entriesSha256'] = workspaceV2ManifestDigest([record]);
      await store.attachV2Manifest(id, m);
      await store.appendV2StagePage(
        id,
        pageRequest(m),
        pageResponse(m, [record]),
      );
      final db = await raw();
      for (final table in [
        'workspace_v2_state',
        'workspace_v2_stage',
        'workspace_v2_pages',
        'workspace_v2_staged_records',
      ]) {
        for (final row in await db.query(table)) {
          expect(row['payload'], startsWith('test:'));
          expect(row['payload'], isNot(contains('私有正文')));
        }
      }
      await store.activateV2Stage(id);
      expect((await store.loadV2Records()).single['json'], '{"title":"私有正文"}');
    },
  );
  test(
    'activation encryption failure rolls back records baseline and active switch',
    () async {
      final original = await cleanTodo();
      final id = await stage([v2Record(id: original.id)]);
      cipher.failActivation = true;
      await expectLater(store.activateV2Stage(id), throwsStateError);
      expect((await store.v2Status())['activeProtocol'], 1);
      expect((await store.load()).single.toJson(), original.toJson());
      final db = await raw();
      expect(await db.query('workspace_v2_records'), isEmpty);
      expect(await db.query('workspace_v2_baselines'), isEmpty);
      cipher.failActivation = false;
      await restart();
      await store.activateV2Stage(id);
      expect((await store.v2Status())['activeProtocol'], 2);
    },
  );

  test(
    'scope approval withdrawal cancels staged records and frozen token',
    () async {
      final id = await stage([v2Record()]);
      await store.setV2ApprovedScopes(['todo.full']);
      await expectLater(store.activateV2Stage(id), throwsStateError);
      expect((await store.v2Status())['upgrade'], null);
      await store.prepareSyncRequest();
    },
  );

  test(
    'snapshot cannot grant write permission beyond capability and bad page rolls back',
    () async {
      await store.setV2ApprovedScopes(scopes);
      final capabilities = capsResponse();
      for (final permission in capabilities['permissions']) {
        permission['write'] = false;
      }
      final id =
          (await store.prepareV2Upgrade(
                capsRequest(),
                capabilities,
              ))['upgradeId']
              as String;
      final record = v2Record(), m = manifest([v2Record()], now);
      m['entriesSha256'] = workspaceV2ManifestDigest([record]);
      await store.attachV2Manifest(id, m);
      await expectLater(
        store.appendV2StagePage(id, pageRequest(m), pageResponse(m, [record])),
        throwsFormatException,
      );
      expect(
        (await store.v2Status())['upgrade']['checkpoint']['verifiedCount'],
        0,
      );
      final db = await raw();
      expect(await db.query('workspace_v2_staged_records'), isEmpty);
    },
  );

  test(
    'completed manifest loses authority immediately after local work log batch',
    () async {
      final id = await stage([v2Record()]);
      await store.save(
        WorkspaceRecord(
          kind: 'work_log',
          id: '2026-10-03',
          data: {'minutes': 0},
        ),
      );
      expect((await store.v2Status())['localMutationEpoch'], 1);
      await expectLater(store.activateV2Stage(id), throwsStateError);
      expect((await store.load()).single.data['minutes'], 0);
    },
  );

  test(
    'disabled synchronization rejects previously prepared v1 response',
    () async {
      final request =
          (await store.prepareSyncRequest())['payload'] as Map<String, dynamic>;
      await store.setSyncEnabled(false);
      await expectLater(
        store.applySyncResponse(request, v1.response(request)),
        throwsStateError,
      );
      expect((await store.syncStatus())['cursor'], 0);
    },
  );

  test(
    'active snapshot corruption fails closed rather than restoring old v1 source',
    () async {
      final id = await stage([v2Record()]);
      await store.activateV2Stage(id);
      final db = await raw();
      await db.delete('workspace_v2_baselines');
      await store.close();
      await expectLater(open(), throwsFormatException);
    },
  );

  test(
    'stage restart without manifest retains freeze but abandoned freeze expires',
    () async {
      final id = await prepare();
      await restart();
      expect((await store.v2Status())['upgrade']['upgradeId'], id);
      await expectLater(store.prepareSyncRequest(), throwsStateError);
      now = now.add(const Duration(days: 8));
      await restart();
      expect((await store.v2Status())['upgrade'], null);
      await store.prepareSyncRequest();
    },
  );
}
