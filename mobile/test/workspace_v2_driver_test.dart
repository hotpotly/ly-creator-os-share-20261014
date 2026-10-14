import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/sync_policy.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_sync_store_test.dart' as v1;
import 'workspace_test.dart' show TestWorkspaceCipher;
import 'workspace_v2_persistence_test.dart' as migration;

class DriverEnvironment extends SyncEnvironmentProvider {
  bool wifi = true, metered = false, powerSaver = false;
  int acquired = 0, released = 0;
  @override
  Future<bool> acquireWifi() async {
    acquired++;
    return wifi;
  }

  @override
  Future<void> releaseWifi() async {
    released++;
  }

  @override
  Future<SyncEnvironment> read() async => SyncEnvironment(
    wifi: wifi,
    metered: metered,
    powerSaver: powerSaver,
    batteryPercent: 100,
    charging: true,
  );
}

final samples =
    workspaceV2Map(
          jsonDecode(
            File(
              '../shared-fixtures/workspace-domain-v2.json',
            ).readAsStringSync(),
          ),
        )['samples']
        as Map;
Map<String, dynamic> sample(String name) =>
    workspaceV2Map(jsonDecode(jsonEncode(samples[name])));
Map<String, dynamic> createBody([String title = 'new todo']) => {
  ...sample('todoCreate'),
  'title': title,
  'projectId': null,
  'stageKey': null,
};
Map<String, dynamic> fullBody(String id, [String title = 'original']) => {
  ...sample('todo'),
  'id': id,
  'title': title,
  'projectId': null,
  'stageKey': null,
  'stageLinkSource': null,
};

class DriverServer {
  final now = DateTime.now().toUtc();
  final records = <String, Map<String, dynamic>>{};
  final jsons = <String, String>{};
  final manifests = <String, List<Map<String, dynamic>>>{};
  final sessions = <String, Map<String, dynamic>>{};
  final uploadIds = <String, String>{};
  final receipts = <String, Map<String, dynamic>>{};
  final calls = <Map<String, dynamic>>[];
  final chunks = <String, Map<int, List<int>>>{};
  int sequence = 100, syncLimit = 100;
  bool writable = true;
  List<String> scopes = List.of(migration.scopes);
  Future<void> Function(String, Map<String, dynamic>)? before, after;

  Map<String, dynamic> record(
    String id,
    Map<String, dynamic> body, {
    int revision = 1,
    int seq = 1,
    bool deleted = false,
  }) {
    final json = jsonEncode(body), bytes = utf8.encode(json);
    final write = writable && !deleted;
    final hash = workspaceV2Sha256Sync(bytes);
    jsons[hash] = json;
    return {
      'kind': 'todo',
      'id': id,
      'revision': revision,
      'sequence': seq,
      'deleted': deleted,
      'payload': bytes.length > workspaceV2InlineBytes
          ? {
              'encoding': 'blob',
              'ref': {
                'sha256': hash,
                'byteLength': bytes.length,
                'mediaType': 'application/json',
              },
            }
          : migration.inline(json),
      'metadata': {
        'scope': 'todo.full',
        'read': true,
        'write': write,
        'deletable': write,
        'editableFields': write
            ? workspaceDomainV2TodoUnits.values
                  .expand((fields) => fields)
                  .toList()
            : [],
        'source': 'manual',
      },
    };
  }

  void add(
    String id,
    Map<String, dynamic> body, {
    int revision = 1,
    int seq = 1,
  }) {
    records[id] = record(id, body, revision: revision, seq: seq);
  }

  Map<String, dynamic> session(String id) => {
    ...migration.identity(),
    'sessionId': id,
    'chunkBytes': workspaceV2ChunkBytes,
    'receivedIndexes': chunks[id]!.keys.toList()..sort(),
    'expiresAt': now.add(const Duration(hours: 24)).toIso8601String(),
  };

  Future<Map<String, dynamic>> exchange(
    DesktopConnection connection,
    String purpose,
    Map<String, dynamic> payload, {
    required Future<int> Function() reserveCounter,
    Map<String, dynamic>? expectedBlob,
    List<Map<String, dynamic>>? approvedPermissions,
  }) async {
    await reserveCounter();
    calls.add({'purpose': purpose, 'payload': jsonDecode(jsonEncode(payload))});
    await before?.call(purpose, payload);
    final result = await respond(purpose, payload);
    await after?.call(purpose, payload);
    return result;
  }

  Future<Map<String, dynamic>> respond(
    String purpose,
    Map<String, dynamic> request,
  ) async {
    switch (purpose) {
      case 'capabilities':
        return {
          ...migration.identity(),
          'supportedScopes': scopes,
          'permissions': [
            for (final scope in scopes)
              {
                'scope': scope,
                'read': true,
                'write':
                    writable && (scope == 'todo.full' || scope == 'work_log'),
              },
          ],
          'limits': workspaceV2Limits,
          'schemaVersion': 1,
        };
      case 'snapshot.start':
        final list =
            records.values
                .map((r) => workspaceV2Map(jsonDecode(jsonEncode(r))))
                .toList()
              ..sort(
                (a, b) => (a['id'] as String).compareTo(b['id'] as String),
              );
        final manifest = migration.manifest(list, now);
        manifest['through'] = sequence;
        manifests[manifest['manifestId'] as String] = list;
        return manifest;
      case 'snapshot.page':
        final list = manifests[request['manifestId']]!;
        final offset = request['after'] == null
            ? 0
            : int.parse(request['after'] as String);
        final page = list.skip(offset).take(request['limit'] as int).toList();
        final done = offset + page.length == list.length;
        return {
          ...migration.identity(),
          'manifestId': request['manifestId'],
          'records': page,
          'done': done,
          'next': done ? null : '${offset + page.length}',
        };
      case 'blob.read':
        final bytes = utf8.encode(jsons[request['sha256']]!);
        final index = request['index'] as int;
        final chunk = bytes.sublist(
          index * workspaceV2ChunkBytes,
          index * workspaceV2ChunkBytes +
              workspaceV2ExpectedChunkLength(bytes.length, index),
        );
        return {
          ...migration.identity(),
          'sha256': request['sha256'],
          'byteLength': bytes.length,
          'index': index,
          'chunkSha256': workspaceV2Sha256Sync(chunk),
          'bytesBase64': base64Encode(chunk),
        };
      case 'blob.start':
        final id = uploadIds.putIfAbsent(
          request['uploadId'] as String,
          workspaceId,
        );
        sessions[id] = request;
        chunks.putIfAbsent(id, () => {});
        return session(id);
      case 'blob.status':
        return session(request['sessionId'] as String);
      case 'blob.chunk':
        final bytes = base64Decode(request['bytesBase64'] as String);
        chunks[request['sessionId']]![request['index'] as int] = bytes;
        return {
          ...migration.identity(),
          'sessionId': request['sessionId'],
          'index': request['index'],
          'sha256': request['sha256'],
          'byteLength': bytes.length,
        };
      case 'blob.commit':
        final id = request['sessionId'] as String,
            declaration = sessions[request['sessionId']]!;
        final bytes = <int>[];
        for (var i = 0; i < chunks[id]!.length; i++) {
          bytes.addAll(chunks[id]![i]!);
        }
        expect(workspaceV2Sha256Sync(bytes), declaration['sha256']);
        jsons[declaration['sha256'] as String] = utf8.decode(bytes);
        return {
          ...migration.identity(),
          'sessionId': id,
          'ref': {
            'sha256': declaration['sha256'],
            'byteLength': declaration['byteLength'],
            'mediaType': 'application/json',
          },
        };
      case 'sync':
        final operations = (request['operations'] as List)
            .map(workspaceV2Map)
            .toList();
        if (operations.length > syncLimit) {
          throw const WorkspaceV2Failure('test413', tooLarge: true);
        }
        final through = request['through'] as int? ?? sequence;
        final ack = <Map<String, dynamic>>[];
        for (final operation in operations) {
          final opId = operation['operationId'] as String;
          if (!receipts.containsKey(opId)) {
            final next = workspaceV2Map(operation['next']);
            final payload = workspaceV2Map(next['payload']);
            final json = payload['encoding'] == 'json'
                ? payload['json'] as String
                : jsons[(payload['ref'] as Map)['sha256']]!;
            final body = workspaceV2Map(jsonDecode(json)),
                id = operation['id'] as String;
            final current = records[id];
            final full = operation['baseRevision'] == 0
                ? {...fullBody(id), ...body}
                : body;
            final remote = record(
              id,
              full,
              revision: (current?['revision'] as int? ?? 0) + 1,
              seq: ++sequence,
              deleted: next['deleted'] as bool,
            );
            records[id] = remote;
            receipts[opId] = {
              'operationId': opId,
              'localRevision': operation['localRevision'],
              'status': 'accepted',
              'record': remote,
            };
          }
          ack.add(receipts[opId]!);
        }
        final changes =
            records.values
                .where(
                  (record) =>
                      (record['sequence'] as int) >
                          (request['cursor'] as int) &&
                      (record['sequence'] as int) <= through,
                )
                .toList()
              ..sort(
                (a, b) =>
                    (a['sequence'] as int).compareTo(b['sequence'] as int),
              );
        return {
          ...migration.identity(),
          'scopes': request['scopes'],
          'scopeDigest': request['scopeDigest'],
          'through': through,
          'cursor': through,
          'hasMore': false,
          'changes': changes,
          'receipts': ack,
        };
      default:
        throw StateError(purpose);
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late SqliteWorkspaceStore store;
  late DriverServer server;
  late DriverEnvironment environment;
  late Directory dir;
  late String path;
  late DesktopConnection? connection;
  late WorkspaceV2Driver driver;
  var applyCount = 0;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: path,
    cipher: TestWorkspaceCipher(),
  );
  WorkspaceV2Driver make({int maxRequests = 256, WorkspaceV2Apply? apply}) =>
      WorkspaceV2Driver(
        store: store,
        connection: () async => connection,
        exchange: server.exchange,
        environment: environment,
        maxRequests: maxRequests,
        apply:
            apply ??
            (action) async {
              applyCount++;
              await action();
            },
      );
  Future<Map<String, dynamic>> row(String id) async => workspaceV2Map(
    ((await store.loadV2Workspace())['records'] as List).singleWhere(
      (r) => r['id'] == id,
    ),
  );
  Future<void> edit(String id, Map<String, dynamic> patch) async {
    final current = await row(id);
    await store.saveV2Todo({
      'id': id,
      'body': {
        ...workspaceV2Map(jsonDecode(current['json'] as String)),
        ...patch,
      },
    }, current['localRevision'] as int);
  }

  Future<void> upgrade() async {
    expect(
      (await driver.upgrade(approvedScopes: migration.scopes)).state,
      WorkspaceV2RunState.complete,
    );
  }

  Future<void> restart() async {
    driver.cancel();
    await driver.settled;
    await store.close();
    store = await open();
    driver = make();
  }

  setUp(() async {
    dir = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('v2-driver-');
    path = '${dir.absolute.path}/workspace.sqlite';
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
    server = DriverServer();
    environment = DriverEnvironment();
    applyCount = 0;
    connection = DesktopConnection(
      address: '127.0.0.1:1',
      deviceId: v1.phoneId,
      serviceId: v1.macId,
      secretBase64: base64Encode(List.filled(32, 1)),
      deviceName: 'test',
    );
    driver = make();
  });
  tearDown(() async {
    driver.cancel();
    await driver.settled;
    await store.close();
    await dir.delete(recursive: true);
  });

  test(
    'v1 is never automatically upgraded and explicit upgrade preserves drafts',
    () async {
      expect(
        (await driver.synchronize()).state,
        WorkspaceV2RunState.needsUpgrade,
      );
      expect(server.calls, isEmpty);
      await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {'bodyText': 'draft', 'goalsText': ''},
        ),
      );
      await upgrade();
      expect((await store.v2Status())['activeProtocol'], 2);
      expect(
        (await store.loadV2ReviewDrafts()).single.data['bodyText'],
        'draft',
      );
      expect(applyCount, greaterThanOrEqualTo(5));
      expect(environment.acquired, environment.released);
    },
  );

  test('v1 pending edits prevent snapshot request and remain intact', () async {
    await store.save(
      WorkspaceRecord(
        kind: 'todo',
        id: workspaceId(),
        data: {
          'title': 'offline',
          'category': 'life',
          'plannedDate': null,
          'completedAt': null,
        },
      ),
    );
    await expectLater(
      driver.upgrade(approvedScopes: migration.scopes),
      throwsStateError,
    );
    expect(
      server.calls.any((call) => call['purpose'] == 'snapshot.start'),
      false,
    );
    expect((await store.v2Status())['activeProtocol'], 1);
    expect(await store.pendingCount(), 1);
  });

  test('snapshot chunk checkpoint survives budget yield and restart', () async {
    final id = workspaceId();
    server.add(id, fullBody(id, '文' * 30000));
    driver = make(maxRequests: 5);
    expect(
      (await driver.upgrade(approvedScopes: migration.scopes)).state,
      WorkspaceV2RunState.deferred,
    );
    expect((await store.v2Status())['activeProtocol'], 1);
    final download = ((await store.v2Status())['downloads'] as List).single;
    expect(download['receivedIndexes'], [0]);
    await restart();
    expect((await driver.resume()).state, WorkspaceV2RunState.complete);
    final reads = server.calls
        .where((call) => call['purpose'] == 'blob.read')
        .toList();
    expect(reads.map((call) => call['payload']['index']), [0, 1]);
    expect(jsonDecode((await row(id))['json'])['title'], '文' * 30000);
  });

  test('upgrade permission change before activation cancels stage', () async {
    server.after = (purpose, request) async {
      if (purpose == 'snapshot.page') server.writable = false;
    };
    await expectLater(
      driver.upgrade(approvedScopes: migration.scopes),
      throwsA(isA<WorkspaceV2Failure>()),
    );
    final state = await store.v2Status();
    expect(state['activeProtocol'], 1);
    expect(state['upgrade'], null);
  });

  test(
    'local edit during snapshot prevents activation without dropping v1 edits',
    () async {
      server.after = (purpose, request) async {
        if (purpose == 'snapshot.start') {
          await store.save(
            WorkspaceRecord(
              kind: 'todo',
              id: workspaceId(),
              data: {
                'title': 'newer',
                'category': 'life',
                'plannedDate': null,
                'completedAt': null,
              },
            ),
          );
        }
      };
      await expectLater(
        driver.upgrade(approvedScopes: migration.scopes),
        throwsStateError,
      );
      expect((await store.v2Status())['activeProtocol'], 1);
      expect((await store.load()).single.data['title'], 'newer');
    },
  );

  test('receipt above fixed through triggers a fresh catchup window', () async {
    await upgrade();
    server.calls.clear();
    final id = workspaceId();
    await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
    await driver.synchronize();
    final sync = server.calls
        .where((call) => call['purpose'] == 'sync')
        .toList();
    expect(sync.length, 2);
    expect(sync.first['payload']['cursor'], 100);
    expect(sync.last['payload']['cursor'], 100);
    expect((await store.loadV2Workspace())['cursor'], 101);
    expect((await row(id))['pending'], isNull);
  });

  test(
    'HTTP413 retries immutable subsets then drains once without empty loops',
    () async {
      await upgrade();
      server.calls.clear();
      server.syncLimit = 1;
      await store.saveV2Todos([
        for (var i = 0; i < 3; i++)
          {
            'command': {'id': workspaceId(), 'body': createBody('todo$i')},
            'expectedLocalRevision': 0,
          },
      ]);
      await driver.synchronize();
      final requests = server.calls
          .where((call) => call['purpose'] == 'sync')
          .map((call) => workspaceV2Map(call['payload']))
          .toList();
      final first = (requests.first['operations'] as List)
          .map(workspaceV2Map)
          .toList();
      for (final request in requests.skip(1)) {
        for (final operation in request['operations'] as List) {
          expect(
            operation,
            first.singleWhere(
              (old) => old['operationId'] == operation['operationId'],
            ),
          );
        }
      }
      expect((await store.loadV2Workspace())['inflightCount'], 0);
      expect(requests.length, lessThan(9));
    },
  );

  test(
    'local too-large preparation is typed and driver shrinks atomically',
    () async {
      for (var i = 0; i < 20; i++) {
        final id = workspaceId();
        server.add(id, fullBody(id, 'a' * 10000));
      }
      await upgrade();
      for (final id in server.records.keys) {
        await edit(id, {'category': 'life'});
      }
      await expectLater(
        store.prepareV2Sync(),
        throwsA(isA<WorkspaceV2PrepareTooLarge>()),
      );
      expect((await store.loadV2Workspace())['inflightCount'], 0);
      server.calls.clear();
      await driver.synchronize();
      expect((await store.loadV2Workspace())['sendableCount'], 0);
      final count =
          (server.calls.firstWhere(
                    (call) => call['purpose'] == 'sync',
                  )['payload']['operations']
                  as List)
              .length;
      expect(count, lessThan(20));
    },
  );

  test(
    'authenticated response missing JSON is resumed before any new prepare',
    () async {
      await upgrade();
      final id = workspaceId();
      server.add(id, fullBody(id, '文' * 30000), seq: ++server.sequence);
      server.calls.clear();
      driver = make(maxRequests: 3);
      expect((await driver.synchronize()).state, WorkspaceV2RunState.deferred);
      final staged = await store.loadV2Workspace();
      expect(staged['cursor'], 100);
      expect(staged['records'], isEmpty);
      expect(staged['response'], isNotNull);
      await restart();
      server.calls.clear();
      await driver.resume();
      expect(server.calls.map((call) => call['purpose']).take(3), [
        'capabilities',
        'blob.read',
        'sync',
      ]);
      expect((await store.loadV2Workspace())['cursor'], 101);
      expect((await row(id))['remoteRevision'], 1);
    },
  );

  test('pause between response and controller apply cannot commit', () async {
    await upgrade();
    final id = workspaceId();
    server.add(id, fullBody(id), seq: ++server.sequence);
    var writes = 0;
    driver = make(
      apply: (action) async {
        writes++;
        if (writes == 2) driver.cancel();
        await action();
      },
    );
    await expectLater(
      driver.synchronize(),
      throwsA(
        isA<WorkspaceV2Failure>().having((e) => e.cancelled, 'cancelled', true),
      ),
    );
    expect((await store.loadV2Workspace())['cursor'], 100);
    expect((await store.loadV2Workspace())['response'], isNotNull);
  });

  test(
    'connection replacement rejects late response and preserves frozen operation',
    () async {
      await upgrade();
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      server.after = (purpose, request) async {
        if (purpose == 'sync') {
          connection = DesktopConnection(
            address: '127.0.0.1:1',
            deviceId: v1.phoneId,
            serviceId: v1.macId,
            secretBase64: base64Encode(List.filled(32, 2)),
            deviceName: 'changed',
          );
        }
      };
      await expectLater(
        driver.synchronize(),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      final state = await store.loadV2Workspace();
      expect(state['inflightCount'], 1);
      expect(state['cursor'], 100);
      expect(state['suspended'], true);
    },
  );

  test(
    'authorization failure suspends writes without changing user enabled choice',
    () async {
      await upgrade();
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      server.before = (purpose, request) async {
        throw const WorkspaceV2Failure('revoked', requiresPairing: true);
      };
      await expectLater(
        driver.synchronize(),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      await restart();
      expect((await store.v2Status())['enabled'], true);
      expect((await store.loadV2Workspace())['suspended'], true);
      await expectLater(
        store.saveV2Todo({'id': workspaceId(), 'body': createBody()}, 0),
        throwsStateError,
      );
      server.before = null;
      await driver.resume();
      expect((await store.loadV2Workspace())['suspended'], false);
      expect((await row(id))['pending'], isNull);
    },
  );

  test('network and power policy checked before each JSON chunk', () async {
    final id = workspaceId();
    server.add(id, fullBody(id, '文' * 30000));
    server.after = (purpose, request) async {
      if (purpose == 'blob.read') environment.powerSaver = true;
    };
    expect(
      (await driver.upgrade(approvedScopes: migration.scopes)).state,
      WorkspaceV2RunState.paused,
    );
    expect((await store.v2Status())['activeProtocol'], 1);
    expect(
      server.calls.where((call) => call['purpose'] == 'blob.read').length,
      1,
    );
    expect(environment.released, 1);
    environment.powerSaver = false;
    server.after = null;
    await driver.resume();
    expect((await store.v2Status())['activeProtocol'], 2);
  });

  test(
    'one driver is single flight and explicit cancellation retains checkpoint',
    () async {
      final gate = Completer<void>();
      server.before = (purpose, request) async {
        if (purpose == 'snapshot.start') await gate.future;
      };
      final run = driver.upgrade(approvedScopes: migration.scopes);
      while (!server.calls.any((call) => call['purpose'] == 'snapshot.start')) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(() => driver.synchronize(), throwsStateError);
      driver.cancel();
      gate.complete();
      await expectLater(run, throwsA(isA<WorkspaceV2Failure>()));
      expect((await store.v2Status())['upgrade'], isNotNull);
      await driver.cancelUpgrade();
      expect((await store.v2Status())['upgrade'], null);
    },
  );

  test(
    'upload checkpoint restart skips verified chunks and retries expired session only once',
    () async {
      final id = workspaceId();
      server.add(id, fullBody(id, '文' * 30000));
      await upgrade();
      await edit(id, {'category': 'life'});
      driver = make(maxRequests: 4);
      expect((await driver.synchronize()).state, WorkspaceV2RunState.deferred);
      final operation =
          ((await store.prepareV2Sync())['payload']['operations'] as List)
              .single;
      await restart();
      server.calls.clear();
      await driver.synchronize();
      final sentChunks = server.calls
          .where((call) => call['purpose'] == 'blob.chunk')
          .toList();
      expect(sentChunks.map((call) => call['payload']['index']), [1]);
      expect(
        server.calls.firstWhere(
          (call) => call['purpose'] == 'sync',
        )['payload']['operations'],
        [operation],
      );
      expect((await row(id))['pending'], isNull);

      await edit(id, {'category': 'ai'});
      server.calls.clear();
      server.before = (purpose, request) async {
        if (purpose == 'blob.start') {
          throw const WorkspaceV2Failure('expired', uploadSessionExpired: true);
        }
      };
      final frozen = (await store.prepareV2Sync())['payload'];
      await expectLater(
        driver.synchronize(),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      expect(
        server.calls.where((call) => call['purpose'] == 'blob.start').length,
        2,
      );
      expect((await store.prepareV2Sync())['payload'], frozen);
    },
  );

  test('sync410 rotates upload session but never operation payload', () async {
    final id = workspaceId();
    server.add(id, fullBody(id, '文' * 30000));
    await upgrade();
    await edit(id, {'category': 'life'});
    server.calls.clear();
    var expired = false;
    server.before = (purpose, request) async {
      if (purpose == 'sync' && !expired) {
        expired = true;
        throw const WorkspaceV2Failure('gone', uploadSessionExpired: true);
      }
    };
    await driver.synchronize();
    final requests = server.calls
        .where((call) => call['purpose'] == 'sync')
        .map((call) => call['payload'])
        .toList();
    expect(requests[0], requests[1]);
    final starts = server.calls
        .where((call) => call['purpose'] == 'blob.start')
        .toList();
    expect(starts.length, 2);
    expect(
      starts[0]['payload']['uploadId'],
      isNot(starts[1]['payload']['uploadId']),
    );
    expect((await row(id))['pending'], isNull);
  });
  test(
    'readonly capability keeps unsent local pending but still pulls remote data',
    () async {
      await upgrade();
      final localId = workspaceId(), remoteId = workspaceId();
      await store.saveV2Todo({
        'id': localId,
        'body': createBody('keep local'),
      }, 0);
      server.writable = false;
      server.add(remoteId, fullBody(remoteId), seq: ++server.sequence);
      server.calls.clear();
      final waiting = await driver.synchronize();
      expect(waiting.state, WorkspaceV2RunState.awaitingAuthorization);
      expect(waiting.unconfirmedCount, 1);
      final requests = server.calls.where((call) => call['purpose'] == 'sync');
      expect(requests, isNotEmpty);
      expect(
        requests.every(
          (call) => (call['payload']['operations'] as List).isEmpty,
        ),
        true,
      );
      expect((await row(localId))['pending'], isNotNull);
      expect((await row(remoteId))['remoteRevision'], 1);
      expect((await store.loadV2Workspace())['cursor'], 101);
      expect((await row(localId))['writable'], false);
    },
  );

  test(
    'readonly capability retains frozen operation until write permission restores',
    () async {
      await upgrade();
      final id = workspaceId();
      await store.saveV2Todo({'id': id, 'body': createBody()}, 0);
      final frozen = workspaceV2Map((await store.prepareV2Sync())['payload']);
      await server.respond('sync', frozen);
      server.writable = false;
      final record = server.records[id]!;
      server.records[id] = {
        ...record,
        'metadata': {
          ...workspaceV2Map(record['metadata']),
          'write': false,
          'deletable': false,
          'editableFields': <String>[],
        },
      };
      server.calls.clear();
      final waiting = await driver.synchronize();
      expect(waiting.state, WorkspaceV2RunState.needsAttention);
      expect((await row(id))['conflict'], isNotNull);
      expect(waiting.unconfirmedCount, 1);
      final requests = server.calls
          .where((call) => call['purpose'] == 'sync')
          .toList();
      expect(
        requests.every(
          (call) => (call['payload']['operations'] as List).isEmpty,
        ),
        true,
      );
      expect(
        (await row(id))['inflight']['operation'],
        (frozen['operations'] as List).single,
      );
      expect((await row(id))['writable'], false);
      expect((await store.loadV2Workspace())['cursor'], 101);
      server.writable = true;
      server.calls.clear();
      await driver.synchronize();
      final retried = server.calls.firstWhere(
        (call) => call['purpose'] == 'sync',
      );
      expect(retried['payload']['operations'], frozen['operations']);
      expect((await row(id))['inflight'], null);
      expect(server.sequence, 101);
      expect(server.receipts.length, 1);
    },
  );
  test(
    'new large pending during upload waits until its own chunks are committed',
    () async {
      final firstId = workspaceId(), secondId = workspaceId();
      server.add(firstId, fullBody(firstId, '甲' * 30000));
      server.add(secondId, fullBody(secondId, '乙' * 30000));
      await upgrade();
      await edit(firstId, {'category': 'life'});
      final frozen = workspaceV2Map((await store.prepareV2Sync())['payload']);
      var added = false;
      server.after = (purpose, request) async {
        if (purpose == 'blob.status' && !added) {
          added = true;
          await edit(secondId, {'category': 'ai'});
        }
      };
      server.before = (purpose, request) async {
        if (purpose != 'sync') return;
        for (final operation in request['operations'] as List) {
          final payload = operation['next']['payload'];
          if (payload['encoding'] == 'blob') {
            expect(
              server.jsons.containsKey(payload['ref']['sha256']),
              true,
              reason: 'newly frozen operation requires a committed upload',
            );
          }
        }
      };
      server.calls.clear();
      await driver.synchronize();
      final requests = server.calls
          .where((call) => call['purpose'] == 'sync')
          .toList();
      expect(requests.first['payload']['operations'], frozen['operations']);
      expect(
        requests
            .skip(1)
            .any(
              (call) => (call['payload']['operations'] as List).any(
                (op) => op['id'] == secondId,
              ),
            ),
        true,
      );
      expect((await row(firstId))['pending'], null);
      expect((await row(secondId))['pending'], null);
    },
  );
}
