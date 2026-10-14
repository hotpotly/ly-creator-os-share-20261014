import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_sync_store_test.dart' as v1;
import 'workspace_v2_persistence_test.dart' as migration;

class FailingV2Cipher extends TestWorkspaceCipher {
  String? failContains;
  @override
  Future<String> encrypt(String text) async {
    if (failContains != null && text.contains(failContains!)) {
      throw StateError('simulated failure');
    }
    return super.encrypt(text);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  final fixture = workspaceV2Map(
    jsonDecode(
      File('../shared-fixtures/workspace-domain-v2.json').readAsStringSync(),
    ),
  );
  Map<String, dynamic> sample(String name) =>
      workspaceV2Map(jsonDecode(jsonEncode((fixture['samples'] as Map)[name])));
  Map<String, dynamic> createBody() => {
    ...sample('todoCreate'),
    'projectId': null,
    'stageKey': null,
  };
  Map<String, dynamic> fullBody(String id) => {
    ...sample('todo'),
    'id': id,
    'projectId': null,
    'stageKey': null,
    'stageLinkSource': null,
  };
  Map<String, dynamic> record(
    String kind,
    String id,
    Map<String, dynamic> body, {
    int revision = 1,
    int sequence = 1,
    bool deleted = false,
    bool writable = true,
    String? raw,
  }) => {
    'kind': kind,
    'id': id,
    'revision': revision,
    'sequence': sequence,
    'deleted': deleted,
    'payload': migration.inline(raw ?? jsonEncode(body)),
    'metadata': {
      'scope': workspaceV2KindScopes[kind],
      'read': true,
      'write': writable && !(kind == 'todo' && deleted),
      'deletable': writable && !(kind == 'todo' && deleted),
      'editableFields': writable && !(kind == 'todo' && deleted)
          ? (kind == 'todo'
                ? workspaceDomainV2TodoUnits.values.expand((v) => v).toList()
                : ['totalMinutes'])
          : [],
      'source': kind == 'todo' ? 'manual' : null,
    },
  };
  Map<String, dynamic> response(
    Map<String, dynamic> request, {
    List<Map<String, dynamic>> receipts = const [],
    List<Map<String, dynamic>> changes = const [],
    int? cursor,
    int? through,
    bool hasMore = false,
  }) => {
    ...migration.identity(),
    'scopes': request['scopes'],
    'scopeDigest': request['scopeDigest'],
    'cursor': cursor ?? request['cursor'],
    'through': through ?? request['through'] ?? request['cursor'],
    'hasMore': hasMore,
    'receipts': receipts,
    'changes': changes,
  };
  Map<String, dynamic> receipt(
    Map<String, dynamic> op,
    Map<String, dynamic> remote, {
    String status = 'accepted',
  }) => {
    'operationId': op['operationId'],
    'localRevision': op['localRevision'],
    'status': status,
    'record': remote,
  };
  late Directory dir;
  late String dbPath;
  late SqliteWorkspaceStore store;
  late FailingV2Cipher cipher;
  late DateTime now;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: dbPath,
    cipher: cipher,
    now: () => now,
  );
  Future<void> restart() async {
    await store.close();
    store = await open();
  }

  Future<Map<String, dynamic>> row(String kind, String id) async =>
      workspaceV2Map(
        ((await store.loadV2Workspace())['records'] as List).firstWhere(
          (r) => r['kind'] == kind && r['id'] == id,
        ),
      );
  Map<String, dynamic> body(Map<String, dynamic> r) =>
      workspaceV2Map(jsonDecode(r['json'] as String));
  final permissionContexts = Expando<String>(
    'prepared request permission context',
  );
  Future<Map<String, dynamic>> prepare({int limit = 100}) async {
    final prepared = await store.prepareV2Sync(operationLimit: limit),
        payload = workspaceV2Map(prepared['payload']);
    permissionContexts[payload] = prepared['permissionContext'] as String?;
    return payload;
  }

  Future<Map<String, dynamic>> stageResponse(
    Map<String, dynamic> request,
    Map<String, dynamic> result,
  ) => store.stageV2SyncResponse(
    request,
    result,
    permissionContext: permissionContexts[request],
  );
  Future<void> refreshPermissions(List<Map<String, dynamic>> records) async {
    final snapshotRecords = List<Map<String, dynamic>>.of(records)
      ..sort(
        (a, b) =>
            '${a['kind']}:${a['id']}'.compareTo('${b['kind']}:${b['id']}'),
      );
    final refresh = await store.beginV2PermissionRefresh(),
        refreshId = refresh['refreshId'] as String,
        manifest = {
          ...migration.manifest(snapshotRecords, now),
          'through': (await store.loadV2Workspace())['knownSequence'],
        };
    await store.attachV2PermissionManifest(refreshId, manifest);
    await store.appendV2PermissionPage(
      refreshId,
      migration.pageRequest(manifest),
      migration.pageResponse(manifest, snapshotRecords),
    );
    await store.commitV2Permissions(refreshId);
  }

  Map<String, dynamic> op(Map<String, dynamic> request) =>
      workspaceV2Map((request['operations'] as List).single);
  Future<void> apply(
    Map<String, dynamic> request,
    Map<String, dynamic> result,
  ) async {
    final staged = await stageResponse(request, result);
    await store.commitV2SyncResponse(staged['responseId'] as String);
  }

  Future<void> activate(
    List<Map<String, dynamic>> records, {
    bool writable = true,
  }) async {
    await store.setV2ApprovedScopes(migration.scopes);
    final caps = migration.capsResponse();
    if (!writable) {
      caps['permissions'] = [
        for (final scope in migration.scopes)
          {'scope': scope, 'read': true, 'write': false},
      ];
    }
    final upgrade = await store.prepareV2Upgrade(migration.capsRequest(), caps),
        id = upgrade['upgradeId'] as String;
    records.sort(
      (a, b) => '${a['kind']}:${a['id']}'.compareTo('${b['kind']}:${b['id']}'),
    );
    final manifest = migration.manifest(records, now);
    await store.attachV2Manifest(id, manifest);
    await store.appendV2StagePage(
      id,
      migration.pageRequest(manifest),
      migration.pageResponse(manifest, records),
    );
    await store.activateV2Stage(id);
  }

  Future<void> edit(String id, Map<String, dynamic> patch) async {
    final r = await row('todo', id);
    await store.saveV2Todo({
      'id': id,
      'body': {...body(r), ...patch},
    }, r['localRevision'] as int);
  }

  setUp(() async {
    now = DateTime.utc(2026, 10, 3, 12);
    cipher = FailingV2Cipher();
    final root = await Directory('../tmp/mobile-tests').create(recursive: true);
    dir = await root.createTemp('incremental-');
    dbPath = '${dir.absolute.path}/workspace.sqlite';
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
  });
  tearDown(() async {
    await store.close();
    await dir.delete(recursive: true);
  });

  test(
    'initial snapshot evolves independently and empty outbox pulls',
    () async {
      final id = workspaceId();
      await activate([]);
      final sent = await prepare();
      final remote = record('todo', id, fullBody(id), sequence: 101);
      await apply(
        sent,
        response(sent, changes: [remote], cursor: 101, through: 101),
      );
      await restart();
      expect(body(await row('todo', id)), fullBody(id));
      expect((await store.loadV2Workspace())['cursor'], 101);
      expect((await prepare())['operations'], isEmpty);
    },
  );
  test(
    'immutable create lost ACK and edited successor survives restart with complete body',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare(), frozen = op(sent);
      await edit(id, {'progress': 67, 'progressBeforeComplete': 67});
      await restart();
      expect(await prepare(), sent);
      final remote = record('todo', id, {
        ...fullBody(id),
        'progress': 37,
      }, sequence: 101);
      await apply(
        sent,
        response(
          sent,
          receipts: [receipt(frozen, remote)],
          cursor: 100,
          through: 100,
        ),
      );
      final current = await row('todo', id);
      expect(body(current)['progress'], 67);
      expect(body(current)['id'], id);
      expect(current['inflight'], null);
      expect(current['writable'], false);
      await refreshPermissions([remote]);
      final next = op(await prepare());
      expect(next['baseRevision'], 1);
      expect(next['operationId'], isNot(frozen['operationId']));
      await restart();
      expect(op(await prepare()), next);
    },
  );
  test(
    '100 local creates are atomic and 413 subset ACK retains unsent inflight',
    () async {
      await activate([]);
      final ids = [for (var i = 0; i < 100; i++) workspaceId()];
      final commands = [
        for (final id in ids)
          {
            'command': {'id': id, 'body': createBody()},
            'expectedLocalRevision': 0,
          },
      ];
      await store.saveV2Todos(commands);
      expect((await store.loadV2Workspace())['pendingCount'], 100);
      final all = await prepare();
      expect((all['operations'] as List).length, 100);
      final subset = await prepare(limit: 1), first = op(subset);
      await apply(
        subset,
        response(
          subset,
          receipts: [
            receipt(
              first,
              record(
                'todo',
                first['id'] as String,
                fullBody(first['id'] as String),
                sequence: 101,
              ),
            ),
          ],
        ),
      );
      expect(
        (await prepare())['operations'],
        (all['operations'] as List).skip(1).toList(),
      );
      await restart();
      expect((await store.loadV2Workspace())['inflightCount'], 99);
    },
  );
  test('invalid batch rolls back first create', () async {
    await activate([]);
    await expectLater(
      store.saveV2Todos([
        {
          'command': {'id': workspaceId(), 'body': createBody()},
          'expectedLocalRevision': 0,
        },
        {
          'command': {
            'id': workspaceId(),
            'body': {...createBody(), 'title': ''},
          },
          'expectedLocalRevision': 0,
        },
      ]),
      throwsFormatException,
    );
    expect((await store.loadV2Workspace())['records'], isEmpty);
  });
  test(
    'write-false capability and record metadata both block local writes',
    () async {
      final id = workspaceId();
      await activate([
        record('todo', id, fullBody(id), writable: false),
      ], writable: false);
      await expectLater(
        store.saveV2Todo({'id': workspaceId(), 'body': createBody()}, 0),
        throwsStateError,
      );
      await store.refreshV2Capabilities(
        migration.capsRequest(),
        migration.capsResponse(),
      );
      await expectLater(edit(id, {'title': 'x'}), throwsStateError);
      expect((await store.loadV2Workspace())['pendingCount'], 0);
    },
  );
  test(
    'group merge replays pending without overwriting changed remote category',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      await edit(id, {'title': 'local'});
      final sent = await prepare();
      await edit(id, {'isExtra': true});
      final remote = record(
        'todo',
        id,
        {...fullBody(id), 'title': 'local', 'category': 'life'},
        revision: 2,
        sequence: 101,
      );
      await apply(sent, response(sent, receipts: [receipt(op(sent), remote)]));
      final r = await row('todo', id);
      expect(body(r)['category'], 'life');
      expect(body(r)['isExtra'], true);
      expect(r['conflict'], null);
    },
  );
  test(
    'concurrent C group retains both versions and resolution checks both versions',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      await edit(id, {'progress': 67});
      final sent = await prepare();
      final remote = record(
        'todo',
        id,
        {...fullBody(id), 'progress': 80},
        revision: 2,
        sequence: 101,
      );
      await apply(
        sent,
        response(
          sent,
          receipts: [receipt(op(sent), remote, status: 'conflict')],
        ),
      );
      await restart();
      expect((await row('todo', id))['writable'], false);
      await refreshPermissions([remote]);
      final r = await row('todo', id);
      expect(r['conflict'], isNotNull);
      await expectLater(
        store.resolveV2Conflict(
          'todo',
          id,
          keepLocal: true,
          expectedLocalRevision: (r['localRevision'] as int) - 1,
          expectedRemoteRevision: 2,
        ),
        throwsA(isA<WorkspaceConflict>()),
      );
      await store.resolveV2Conflict(
        'todo',
        id,
        keepLocal: true,
        expectedLocalRevision: r['localRevision'] as int,
        expectedRemoteRevision: 2,
      );
      expect(body(await row('todo', id))['progress'], 67);
      expect(op(await prepare())['baseRevision'], 2);
    },
  );
  test(
    'remote change while pending creates conflict without losing local text',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      final pull = await prepare();
      await edit(id, {'title': 'local'});
      final remote = record(
        'todo',
        id,
        {...fullBody(id), 'title': 'remote'},
        revision: 2,
        sequence: 101,
      );
      await apply(
        pull,
        response(pull, changes: [remote], cursor: 101, through: 101),
      );
      await restart();
      final r = await row('todo', id);
      expect(body(r)['title'], 'local');
      expect(r['conflict'], isNotNull);
      await store.resolveV2Conflict(
        'todo',
        id,
        keepLocal: false,
        expectedLocalRevision: r['localRevision'] as int,
        expectedRemoteRevision: 2,
      );
      expect(body(await row('todo', id))['title'], 'remote');
      expect((await prepare())['operations'], isEmpty);
    },
  );
  test(
    'new todo cancelled locally before send and delete during create waits for ACK',
    () async {
      await activate([]);
      var id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      await store.saveV2Todo({'id': id, 'deleted': true}, 1);
      expect((await store.loadV2Workspace())['records'], isEmpty);
      id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      await store.saveV2Todo({'id': id, 'deleted': true}, 1);
      final remote = record('todo', id, fullBody(id), sequence: 101);
      await apply(sent, response(sent, receipts: [receipt(op(sent), remote)]));
      expect((await row('todo', id))['writable'], false);
      await refreshPermissions([remote]);
      final next = op(await prepare());
      expect((next['next'] as Map)['deleted'], true);
      expect((next['next'] as Map)['payload'], remote['payload']);
      expect(next['baseRevision'], 1);
    },
  );
  test(
    'deletion preserves baseline raw bytes not current unsent editing',
    () async {
      final id = workspaceId(),
          raw = '  ${jsonEncode(fullBody('placeholder'))}';
      final bodyValue = fullBody(id);
      final original = '  ${jsonEncode(bodyValue)}';
      expect(raw, isNotEmpty);
      await activate([record('todo', id, bodyValue, raw: original)]);
      await edit(id, {'title': 'not sent'});
      final r = await row('todo', id);
      await store.saveV2Todo({
        'id': id,
        'deleted': true,
      }, r['localRevision'] as int);
      final next = op(await prepare());
      expect(((next['next'] as Map)['payload'] as Map)['json'], original);
      expect(((next['base'] as Map)['payload'] as Map)['json'], original);
    },
  );
  test(
    'worklog null classified total, explicit zero, clear and tombstone refill',
    () async {
      final b = sample('workLog');
      await activate([record('work_log', b['day'] as String, b)]);
      var r = await row('work_log', b['day'] as String);
      await store.saveV2WorkLog({
        'day': b['day'],
        'minutes': 0,
      }, r['localRevision'] as int);
      expect(
        body(await row('work_log', b['day'] as String))['selfMediaMinutes'],
        1440,
      );
      var sent = await prepare();
      var remote = record(
        'work_log',
        b['day'] as String,
        {...b, 'totalMinutes': 0},
        revision: 2,
        sequence: 101,
      );
      await apply(sent, response(sent, receipts: [receipt(op(sent), remote)]));
      expect((await row('work_log', b['day'] as String))['writable'], false);
      await refreshPermissions([remote]);
      r = await row('work_log', b['day'] as String);
      await store.saveV2WorkLog({
        'day': b['day'],
        'clear': true,
      }, r['localRevision'] as int);
      sent = await prepare();
      remote = {...remote, 'revision': 3, 'sequence': 102, 'deleted': true};
      await apply(
        sent,
        response(
          sent,
          receipts: [receipt(op(sent), remote)],
          cursor: 101,
          through: 101,
        ),
      );
      expect((await row('work_log', b['day'] as String))['writable'], false);
      await refreshPermissions([remote]);
      r = await row('work_log', b['day'] as String);
      await store.saveV2WorkLog({
        'day': b['day'],
        'minutes': 0,
      }, r['localRevision'] as int);
      expect((op(await prepare()))['baseRevision'], 3);
      await store.saveV2WorkLog({'day': '2026-10-04', 'clear': true}, 0);
      expect((await row('work_log', '2026-10-04'))['deleted'], true);
    },
  );
  test(
    'new request cannot accept history before a receipt beyond through',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      await apply(
        sent,
        response(
          sent,
          receipts: [
            receipt(op(sent), record('todo', id, fullBody(id), sequence: 120)),
          ],
          through: 100,
        ),
      );
      final pull = await prepare();
      await expectLater(
        stageResponse(pull, response(pull, through: 119)),
        throwsFormatException,
      );
      expect((await store.loadV2Workspace())['knownSequence'], 120);
    },
  );
  test('old changes do not overwrite newer receipt', () async {
    final id = workspaceId();
    await activate([record('todo', id, fullBody(id))]);
    await edit(id, {'title': 'local'});
    final sent = await prepare();
    await apply(
      sent,
      response(
        sent,
        receipts: [
          receipt(
            op(sent),
            record(
              'todo',
              id,
              {...fullBody(id), 'title': 'local'},
              revision: 3,
              sequence: 120,
            ),
          ),
        ],
        changes: [
          record(
            'todo',
            id,
            {...fullBody(id), 'title': 'older'},
            revision: 2,
            sequence: 101,
          ),
        ],
        cursor: 110,
        through: 110,
      ),
    );
    expect(body(await row('todo', id))['title'], 'local');
    expect((await row('todo', id))['remoteRevision'], 3);
    await restart();
  });
  test(
    'authenticated rejected keeps blocked raw and corrected successor uses fresh ID',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare(), frozen = op(sent);
      final rejection = {
        'operationId': frozen['operationId'],
        'localRevision': frozen['localRevision'],
        'status': 'rejected',
        'target': {'kind': 'todo', 'id': id},
        'operationHash': workspaceV2OperationHash(frozen),
        'code': 'invalid_change',
        'record': null,
      };
      await restart();
      expect(await prepare(), sent);
      await apply(sent, response(sent, receipts: [rejection]));
      await restart();
      expect((await row('todo', id))['blocked'], isNotNull);
      expect((await store.loadV2Workspace())['sendableCount'], 0);
      await edit(id, {'title': 'corrected'});
      expect(op(await prepare())['operationId'], isNot(frozen['operationId']));
    },
  );
  test(
    'rejected older intent does not block already corrected newer pending',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare(), frozen = op(sent);
      await edit(id, {'title': 'corrected'});
      await apply(
        sent,
        response(
          sent,
          receipts: [
            {
              'operationId': frozen['operationId'],
              'localRevision': frozen['localRevision'],
              'status': 'rejected',
              'target': {'kind': 'todo', 'id': id},
              'operationHash': workspaceV2OperationHash(frozen),
              'code': 'invalid_change',
              'record': null,
            },
          ],
        ),
      );
      expect((await store.loadV2Workspace())['sendableCount'], 1);
      expect(body(await row('todo', id))['title'], 'corrected');
      await restart();
      expect((op(await prepare()))['localRevision'], 2);
    },
  );
  test(
    'wrong rejected proof and wrong response identity leave frozen operations',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare(), frozen = op(sent);
      final rejection = {
        'operationId': frozen['operationId'],
        'localRevision': frozen['localRevision'],
        'status': 'rejected',
        'target': {'kind': 'todo', 'id': id},
        'operationHash': 'a' * 64,
        'code': 'invalid_change',
        'record': null,
      };
      await expectLater(
        stageResponse(sent, response(sent, receipts: [rejection])),
        throwsFormatException,
      );
      expect(await prepare(), sent);
      await expectLater(
        stageResponse(sent, {...response(sent), 'deviceId': workspaceId()}),
        throwsFormatException,
      );
      expect(await prepare(), sent);
    },
  );
  test('cipher failure during commit rolls back receipt and cursor', () async {
    await activate([]);
    final id = workspaceId();
    await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
    final sent = await prepare();
    final stage = await stageResponse(
      sent,
      response(
        sent,
        receipts: [
          receipt(op(sent), record('todo', id, fullBody(id), sequence: 101)),
        ],
      ),
    );
    cipher.failContains = '"knownSequence":101';
    await expectLater(
      store.commitV2SyncResponse(stage['responseId'] as String),
      throwsStateError,
    );
    cipher.failContains = null;
    expect((await row('todo', id))['inflight'], isNotNull);
    expect((await store.loadV2Workspace())['cursor'], 100);
    await store.commitV2SyncResponse(stage['responseId'] as String);
    expect((await row('todo', id))['inflight'], null);
  });

  test(
    'necessary response JSON blocks all ACK and cursor until verified across restart',
    () async {
      await activate([]);
      final id = workspaceId(),
          big = jsonEncode({
            ...fullBody(id),
            'title': 'x' * 80000,
            'progress': 12.25,
          });
      final bytes = utf8.encode(big), hash = workspaceV2Sha256Sync(bytes);
      final remote = {
        ...record('todo', id, fullBody(id), sequence: 101),
        'payload': {
          'encoding': 'blob',
          'ref': {
            'sha256': hash,
            'byteLength': bytes.length,
            'mediaType': 'application/json',
          },
        },
      };
      final sent = await prepare(),
          result = response(sent, changes: [remote], cursor: 101, through: 101);
      final stage = await stageResponse(sent, result),
          responseId = stage['responseId'] as String;
      await expectLater(
        store.commitV2SyncResponse(responseId),
        throwsStateError,
      );
      expect((await store.loadV2Workspace())['cursor'], 100);
      final part = bytes.sublist(0, workspaceV2ChunkBytes);
      await expectLater(
        store.putV2ResponseJsonChunk(
          responseId,
          sha256: hash,
          index: 0,
          bytes: part,
          chunkHash: 'a' * 64,
        ),
        throwsFormatException,
      );
      await store.putV2ResponseJsonChunk(
        responseId,
        sha256: hash,
        index: 0,
        bytes: part,
        chunkHash: workspaceV2Sha256Sync(part),
      );
      await restart();
      expect(
        ((await store.loadV2Workspace())['response'] as Map)['responseId'],
        responseId,
      );
      final rest = bytes.sublist(workspaceV2ChunkBytes);
      await store.putV2ResponseJsonChunk(
        responseId,
        sha256: hash,
        index: 1,
        bytes: rest,
        chunkHash: workspaceV2Sha256Sync(rest),
      );
      await store.commitV2SyncResponse(responseId);
      expect((await row('todo', id))['json'], big);
      await edit(id, {'category': 'life'});
      final prepared = await store.prepareV2Sync(),
          upload = workspaceV2Map((prepared['uploads'] as List).single),
          operation = op(workspaceV2Map(prepared['payload']));
      expect(prepared['ready'], false);
      final chunk = await store.loadV2UploadChunk(
        operation['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        0,
      );
      expect((chunk['bytes'] as List).length, workspaceV2ChunkBytes);
      final checkpoint = {
        ...migration.identity(),
        'sessionId': workspaceId(),
        'chunkBytes': workspaceV2ChunkBytes,
        'receivedIndexes': [0],
        'expiresAt': now.add(const Duration(hours: 1)).toIso8601String(),
      };
      await store.saveV2UploadCheckpoint(
        operation['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        checkpoint,
      );
      await edit(id, {'isExtra': true});
      await restart();
      final resumed = await store.prepareV2Sync();
      expect(resumed['payload'], prepared['payload']);
      expect((resumed['uploads'] as List).single['checkpoint'], checkpoint);
      final session = workspaceV2Map(checkpoint);
      await expectLater(
        store.markV2UploadCommitted(
          operation['operationId'] as String,
          (upload['ref'] as Map)['sha256'] as String,
          {
            ...migration.identity(),
            'sessionId': workspaceId(),
            'ref': upload['ref'],
          },
        ),
        throwsFormatException,
      );
      await store.markV2UploadCommitted(
        operation['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        {
          ...migration.identity(),
          'sessionId': session['sessionId'],
          'ref': upload['ref'],
        },
      );
      expect((await store.prepareV2Sync())['ready'], true);
      await expectLater(
        store.resetV2Upload(
          operation['operationId'] as String,
          (upload['ref'] as Map)['sha256'] as String,
          reason: 'local_expired',
        ),
        throwsStateError,
      );
      now = now.add(const Duration(hours: 2));
      await store.resetV2Upload(
        operation['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        reason: 'local_expired',
      );
      final retry = await store.prepareV2Sync(),
          rotated = workspaceV2Map((retry['uploads'] as List).single);
      expect(retry['payload'], prepared['payload']);
      expect(rotated['uploadId'], isNot(upload['uploadId']));
      expect(rotated['checkpoint'], null);
      expect(rotated['committed'], false);
      await restart();
      expect((await store.prepareV2Sync())['payload'], prepared['payload']);
      final retryBytes = await store.loadV2UploadChunk(
        operation['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        0,
      );
      expect(retryBytes, chunk);
      await store.resetV2Upload(
        operation['operationId'] as String,
        (upload['ref'] as Map)['sha256'] as String,
        reason: 'server_expired',
      );
      expect((await store.prepareV2Sync())['payload'], prepared['payload']);
    },
  );
  test(
    'invalid remote full body hash leaves staged response and pending intact',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      final big = jsonEncode({...fullBody(id), 'title': 'x' * 70000}),
          bytes = utf8.encode(big),
          hash = 'a' * 64;
      final remote = {
        ...record('todo', id, fullBody(id), sequence: 101),
        'payload': {
          'encoding': 'blob',
          'ref': {
            'sha256': hash,
            'byteLength': bytes.length,
            'mediaType': 'application/json',
          },
        },
      };
      final stage = await stageResponse(
            sent,
            response(sent, receipts: [receipt(op(sent), remote)]),
          ),
          responseId = stage['responseId'] as String;
      final first = bytes.sublist(0, workspaceV2ChunkBytes),
          last = bytes.sublist(workspaceV2ChunkBytes);
      await store.putV2ResponseJsonChunk(
        responseId,
        sha256: hash,
        index: 0,
        bytes: first,
        chunkHash: workspaceV2Sha256Sync(first),
      );
      await expectLater(
        store.putV2ResponseJsonChunk(
          responseId,
          sha256: hash,
          index: 1,
          bytes: last,
          chunkHash: workspaceV2Sha256Sync(last),
        ),
        throwsFormatException,
      );
      expect((await row('todo', id))['inflight'], isNotNull);
      expect((await store.loadV2Workspace())['cursor'], 100);
    },
  );
  test(
    'local oversized edited body rolls back without deleting legacy source',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      final before = await row('todo', id);
      await expectLater(
        store.saveV2Todo({
          'id': id,
          'body': {...fullBody(id), 'title': 'x' * (17 * 1024 * 1024)},
        }, before['localRevision'] as int),
        throwsFormatException,
      );
      expect((await row('todo', id))['json'], before['json']);
    },
  );
  test(
    'remote deletion conflict recovery uses a new manual UUID never revives original',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      await edit(id, {'title': 'local'});
      final sent = await prepare();
      final remote = record(
        'todo',
        id,
        {
          ...fullBody(id),
          'status': 'dismissed',
          'dismissedAt': now.toIso8601String(),
        },
        revision: 2,
        sequence: 101,
        deleted: true,
      );
      await apply(
        sent,
        response(
          sent,
          receipts: [receipt(op(sent), remote, status: 'conflict')],
        ),
      );
      expect((await row('todo', id))['writable'], false);
      await refreshPermissions([remote]);
      final current = await row('todo', id);
      final copy = await store.resolveV2Conflict(
        'todo',
        id,
        keepLocal: true,
        expectedLocalRevision: current['localRevision'] as int,
        expectedRemoteRevision: 2,
      );
      expect(copy, isNot(id));
      expect((await row('todo', id))['deleted'], true);
      expect(body(await row('todo', copy!))['title'], 'local');
      expect(op(await prepare())['baseRevision'], 0);
    },
  );
  test(
    'changing granted write permission blocks edits and preserves inflight',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      final caps = migration.capsResponse();
      caps['permissions'] = [
        for (final scope in migration.scopes)
          {'scope': scope, 'read': true, 'write': false},
      ];
      await store.refreshV2Capabilities(migration.capsRequest(), caps);
      await expectLater(edit(id, {'title': 'new'}), throwsStateError);
      expect((await prepare())['operations'], isEmpty);
      expect((await row('todo', id))['inflight']['operation'], op(sent));
      await restart();
      expect((await row('todo', id))['inflight'], isNotNull);
      await store.refreshV2Capabilities(
        migration.capsRequest(),
        migration.capsResponse(),
      );
      expect(await prepare(), sent);
    },
  );
  test(
    'all active private rows use encryption and orphan pending deletion fails closed',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      await edit(id, {'title': 'private unsent'});
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(dbPath);
      final tables = await db.rawQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'workspace_v2_%'",
      );
      for (final t in tables) {
        final name = t['name'] as String;
        for (final item in await db.query(name)) {
          if (item['payload'] != null) {
            expect(item['payload'], startsWith('test:'));
            expect(
              (item['payload'] as String).contains('private unsent'),
              false,
            );
          }
        }
      }
      await db.delete('workspace_v2_pending');
      await db.close();
      await expectLater(open(), throwsFormatException);
    },
  );

  test(
    'scope shrink suspends writes and transport while preserving all local drafts',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      final caps = migration.capsResponse();
      caps['supportedScopes'] = ['todo.full'];
      caps['permissions'] = [
        {'scope': 'todo.full', 'read': true, 'write': true},
      ];
      await store.refreshV2Capabilities(migration.capsRequest(), caps);
      await restart();
      expect((await store.loadV2Workspace())['suspended'], true);
      await expectLater(store.prepareV2Sync(), throwsStateError);
      await expectLater(edit(id, {'title': 'changed'}), throwsStateError);
      expect((await row('todo', id))['inflight'], isNotNull);
      await store.refreshV2Capabilities(
        migration.capsRequest(),
        migration.capsResponse(),
      );
      expect(await prepare(), sent);
    },
  );
  test(
    'legacy activated v3 requires authenticated capability before writes',
    () async {
      final id = workspaceId(), remote = record('todo', id, fullBody(id));
      await activate([remote]);
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(dbPath),
          stateRow = (await db.query('workspace_v2_state')).single;
      final state = workspaceV2Map(
        jsonDecode(await cipher.decrypt(stateRow['payload'] as String)),
      );
      (state['active'] as Map).remove('capabilitiesRequest');
      (state['active'] as Map).remove('capabilitiesResponse');
      state.remove('permissionsInitialized');
      await db.update('workspace_v2_state', {
        'payload': await cipher.encrypt(jsonEncode(state)),
      });
      await db.delete('workspace_v2_records');
      await db.insert('workspace_v2_records', {
        'kind': 'todo',
        'id': id,
        'payload': await cipher.encrypt(jsonEncode(remote)),
      });
      for (final table in [
        'live',
        'response',
        'pending',
        'inflight',
        'conflicts',
        'blocked',
        'uploads',
        'history',
        'permission_state',
        'permission_pages',
        'permission_records',
      ]) {
        await db.execute('DROP TABLE workspace_v2_$table');
      }
      await db.setVersion(3);
      await db.close();
      store = await open();
      expect(body(await row('todo', id)), fullBody(id));
      await expectLater(edit(id, {'title': 'new'}), throwsStateError);
      await store.refreshV2Capabilities(
        migration.capsRequest(),
        migration.capsResponse(),
      );
      await expectLater(edit(id, {'title': 'new'}), throwsStateError);
      final refresh = await store.beginV2PermissionRefresh(),
          refreshId = refresh['refreshId'] as String,
          manifest = migration.manifest([remote], now);
      await store.attachV2PermissionManifest(refreshId, manifest);
      await store.appendV2PermissionPage(
        refreshId,
        migration.pageRequest(manifest),
        migration.pageResponse(manifest, [remote]),
      );
      await store.commitV2Permissions(refreshId);
      await edit(id, {'title': 'new'});
      expect(op(await prepare())['baseRevision'], 1);
    },
  );
  test(
    'explicit first clear keeps tombstone intent after unsent worklog edit',
    () async {
      await activate([]);
      await store.saveV2WorkLog({'day': '2026-10-03', 'minutes': 20}, 0);
      await store.saveV2WorkLog({'day': '2026-10-03', 'clear': true}, 1);
      final operation = op(await prepare());
      expect(operation['baseRevision'], 0);
      expect((operation['next'] as Map)['deleted'], true);
      expect(
        jsonDecode(
          ((operation['next'] as Map)['payload'] as Map)['json'] as String,
        ),
        {'day': '2026-10-03', 'totalMinutes': null},
      );
    },
  );
  test(
    'corrupt partial response cache is discarded without retiring inflight',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      final big = jsonEncode({...fullBody(id), 'title': 'x' * 70000}),
          bytes = utf8.encode(big),
          hash = workspaceV2Sha256Sync(bytes);
      final remote = {
        ...record('todo', id, fullBody(id), sequence: 101),
        'payload': {
          'encoding': 'blob',
          'ref': {
            'sha256': hash,
            'byteLength': bytes.length,
            'mediaType': 'application/json',
          },
        },
      };
      final responseValue = response(
            sent,
            receipts: [receipt(op(sent), remote)],
          ),
          stage = await stageResponse(sent, responseValue),
          first = bytes.sublist(0, workspaceV2ChunkBytes);
      await store.putV2ResponseJsonChunk(
        stage['responseId'] as String,
        sha256: hash,
        index: 0,
        bytes: first,
        chunkHash: workspaceV2Sha256Sync(first),
      );
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(dbPath);
      await db.update('workspace_v2_json_chunks', {
        'payload': await cipher.encrypt('{}'),
      });
      await db.close();
      store = await open();
      expect((await store.loadV2Workspace())['response'], null);
      expect(await prepare(), sent);
      final retry = await stageResponse(sent, responseValue);
      expect((retry['downloads'] as List).single['receivedIndexes'], isEmpty);
    },
  );

  test(
    'completed but uncommitted JSON remains charged to temporary budget',
    () async {
      await activate([]);
      final id = workspaceId(),
          big = jsonEncode({...fullBody(id), 'title': 'x' * 70000}),
          bytes = utf8.encode(big),
          hash = workspaceV2Sha256Sync(bytes);
      final remote = {
            ...record('todo', id, fullBody(id), sequence: 101),
            'payload': {
              'encoding': 'blob',
              'ref': {
                'sha256': hash,
                'byteLength': bytes.length,
                'mediaType': 'application/json',
              },
            },
          },
          sent = await prepare();
      final stage = await stageResponse(
        sent,
        response(sent, changes: [remote], cursor: 101, through: 101),
      );
      final db = await databaseFactoryFfi.openDatabase(dbPath);
      for (var i = 0; i < 16; i++) {
        final hash = i.toRadixString(16).padLeft(64, '0');
        await db.insert('workspace_v2_json_objects', {
          'sha256': hash,
          'payload': await cipher.encrypt(
            jsonEncode({
              'sha256': hash,
              'byteLength': workspaceV2JsonBytes,
              'createdAt': now.millisecondsSinceEpoch,
              'lastActivityAt': now.millisecondsSinceEpoch,
              'complete': true,
            }),
          ),
        });
      }
      final first = bytes.sublist(0, workspaceV2ChunkBytes);
      await expectLater(
        store.putV2ResponseJsonChunk(
          stage['responseId'] as String,
          sha256: hash,
          index: 0,
          bytes: first,
          chunkHash: workspaceV2Sha256Sync(first),
        ),
        throwsStateError,
      );
      expect((await store.loadV2Workspace())['cursor'], 100);
    },
  );

  test(
    'remote rebase increments local revision and rejects stale open editor',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      final pull = await prepare();
      await edit(id, {'title': 'local A'});
      final stale = await row('todo', id),
          remote = record(
            'todo',
            id,
            {...fullBody(id), 'category': 'life'},
            revision: 2,
            sequence: 101,
          );
      await apply(
        pull,
        response(pull, changes: [remote], cursor: 101, through: 101),
      );
      final current = await row('todo', id);
      expect(
        current['localRevision'],
        greaterThan(stale['localRevision'] as int),
      );
      expect(
        (current['pending'] as Map)['localRevision'],
        current['localRevision'],
      );
      await expectLater(
        store.saveV2Todo({
          'id': id,
          'body': {...body(stale), 'title': 'stale edit'},
        }, stale['localRevision'] as int),
        throwsA(isA<WorkspaceConflict>()),
      );
      expect(body(await row('todo', id))['category'], 'life');
      await restart();
    },
  );
  test(
    'same-result pending convergence retains exact remote raw bytes',
    () async {
      final id = workspaceId();
      await activate([record('todo', id, fullBody(id))]);
      final pull = await prepare();
      await edit(id, {'title': 'same'});
      final newBody = {...fullBody(id), 'title': 'same'},
          raw = '  ${jsonEncode(newBody)}  ';
      await apply(
        pull,
        response(
          pull,
          changes: [
            record('todo', id, newBody, revision: 2, sequence: 101, raw: raw),
          ],
          cursor: 101,
          through: 101,
        ),
      );
      await restart();
      final r = await row('todo', id);
      expect(r['json'], raw);
      expect(r['pending'], null);
    },
  );

  test(
    'disabled sync rejects late response stage and keeps immutable request',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare(),
          received = response(
            sent,
            receipts: [
              receipt(
                op(sent),
                record('todo', id, fullBody(id), sequence: 101),
              ),
            ],
          );
      await store.setSyncEnabled(false);
      await expectLater(stageResponse(sent, received), throwsStateError);
      await edit(id, {'title': 'offline remains writable'});
      expect((await row('todo', id))['inflight'], isNotNull);
      await store.setSyncEnabled(true);
      expect(await prepare(), sent);
    },
  );
  test('disabled sync rejects commit of previously staged response', () async {
    await activate([]);
    final id = workspaceId();
    await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
    final sent = await prepare(),
        received = response(
          sent,
          receipts: [
            receipt(op(sent), record('todo', id, fullBody(id), sequence: 101)),
          ],
        );
    final stage = await stageResponse(sent, received);
    await store.setSyncEnabled(false);
    await expectLater(
      store.commitV2SyncResponse(stage['responseId'] as String),
      throwsStateError,
    );
    expect((await row('todo', id))['inflight'], isNotNull);
    expect((await store.loadV2Workspace())['cursor'], 100);
    await store.setSyncEnabled(true);
    expect(await prepare(), sent);
  });
  test('late accepted worklog must not erase newer remote conflict', () async {
    final day = '2026-10-03';
    final base = {
      'day': day,
      'totalMinutes': 10,
      'selfMediaMinutes': 0,
      'aiMinutes': 0,
      'otherWorkMinutes': 0,
      'updatedAt': '',
    };
    await activate([record('work_log', day, base)]);
    await store.saveV2WorkLog({
      'day': day,
      'minutes': 20,
    }, (await row('work_log', day))['localRevision'] as int);
    final original = await prepare();
    await store.saveV2WorkLog({
      'day': day,
      'minutes': 30,
    }, (await row('work_log', day))['localRevision'] as int);
    final pull = {...original, 'operations': <Map<String, dynamic>>[]};
    await apply(
      pull,
      response(
        pull,
        changes: [
          record(
            'work_log',
            day,
            {...base, 'totalMinutes': 40},
            revision: 3,
            sequence: 102,
          ),
        ],
        cursor: 102,
        through: 102,
      ),
    );
    expect((await row('work_log', day))['conflict'], isNotNull);
    final retry = await prepare();
    await apply(
      retry,
      response(
        retry,
        receipts: [
          receipt(
            op(retry),
            record(
              'work_log',
              day,
              {...base, 'totalMinutes': 20},
              revision: 2,
              sequence: 101,
            ),
          ),
        ],
      ),
    );
    expect((await row('work_log', day))['conflict'], isNotNull);
    expect(body(await row('work_log', day))['totalMinutes'], 30);
    expect((await store.loadV2Workspace())['sendableCount'], 0);
  });

  test('scope shrink blocks transport with an empty outbox', () async {
    await activate([]);
    final caps = migration.capsResponse();
    caps['supportedScopes'] = ['todo.full'];
    caps['permissions'] = [
      {'scope': 'todo.full', 'read': true, 'write': true},
    ];
    await store.refreshV2Capabilities(migration.capsRequest(), caps);
    await restart();
    await expectLater(store.prepareV2Sync(), throwsStateError);
    expect((await store.loadV2Workspace())['records'], isEmpty);
  });

  test(
    'missing activation state cannot expose an empty v1 while incremental facts remain',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(dbPath);
      for (final table in ['state', 'records', 'baselines']) {
        await db.delete('workspace_v2_$table');
      }
      await db.close();
      await expectLater(open(), throwsFormatException);
    },
  );

  test(
    'oversized initial snapshot cancels frozen stage atomically and retains v1 drafts',
    () async {
      final draft = await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {'goalsText': '原草稿', 'bodyText': '不能删除'},
        ),
      );
      final pendingBefore = await store.pendingCount();
      await store.setV2ApprovedScopes(migration.scopes);
      final upgrade = await store.prepareV2Upgrade(
            migration.capsRequest(),
            migration.capsResponse(),
          ),
          upgradeId = upgrade['upgradeId'] as String;
      final records = [
        for (var i = 0; i < 17; i++)
          {
            ...record('todo', workspaceId(), {}),
            'payload': {
              'encoding': 'blob',
              'ref': {
                'sha256': i.toRadixString(16).padLeft(64, '0'),
                'byteLength': workspaceV2JsonBytes,
                'mediaType': 'application/json',
              },
            },
          },
      ];
      records.sort((a, b) => (a['id'] as String).compareTo(b['id'] as String));
      final manifest = migration.manifest(records, now);
      await store.attachV2Manifest(upgradeId, manifest);
      await store.appendV2StagePage(
        upgradeId,
        migration.pageRequest(manifest),
        migration.pageResponse(
          manifest,
          records.take(8).toList(),
          next: 'page2',
        ),
      );
      await expectLater(
        store.appendV2StagePage(
          upgradeId,
          migration.pageRequest(manifest, after: 'page2'),
          migration.pageResponse(manifest, records.skip(8).toList()),
        ),
        throwsStateError,
      );
      final status = await store.v2Status();
      expect(status['activeProtocol'], 1);
      expect(status['upgrade'], null);
      expect((await store.load()).single.toJson(), draft.toJson());
      expect(await store.pendingCount(), pendingBefore);
      await restart();
      expect((await store.v2Status())['upgrade'], null);
    },
  );
  test(
    'corrupt staged response releases unretained complete objects without losing facts',
    () async {
      await activate([]);
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final sent = await prepare();
      final responseValue = response(
        sent,
        receipts: [
          receipt(op(sent), record('todo', id, fullBody(id), sequence: 101)),
        ],
      );
      await stageResponse(sent, responseValue);
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(dbPath), hash = 'a' * 64;
      await db.update('workspace_v2_response', {
        'payload': await cipher.encrypt('{}'),
      });
      await db.insert('workspace_v2_json_objects', {
        'sha256': hash,
        'payload': await cipher.encrypt(
          jsonEncode({
            'sha256': hash,
            'byteLength': workspaceV2JsonBytes,
            'createdAt': now.millisecondsSinceEpoch,
            'lastActivityAt': now.millisecondsSinceEpoch,
            'complete': true,
          }),
        ),
      });
      await db.close();
      store = await open();
      expect(await prepare(), sent);
      final reopened = await databaseFactoryFfi.openDatabase(dbPath);
      expect(await reopened.query('workspace_v2_json_objects'), isEmpty);
      expect((await row('todo', id))['inflight'], isNotNull);
    },
  );
}
