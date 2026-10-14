import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_v2_driver_test.dart' as base;
import 'workspace_sync_store_test.dart' as v1;
import 'workspace_v2_persistence_test.dart' as migration;
import 'workspace_test.dart' show TestWorkspaceCipher;

class PermissionServer extends base.DriverServer {
  int pageSize = 100;
  bool mirrorGrant = true;
  void grant(bool value) {
    writable = value;
    if (!mirrorGrant) return;
    for (final id in records.keys.toList()) {
      final record = records[id]!;
      final write =
          value && !(record['kind'] == 'todo' && record['deleted'] == true);
      records[id] = {
        ...record,
        'metadata': {
          ...workspaceV2Map(record['metadata']),
          'write': write,
          'deletable': write,
          'editableFields': write
              ? workspaceDomainV2TodoUnits.values
                    .expand((fields) => fields)
                    .toList()
              : <String>[],
        },
      };
    }
  }

  @override
  Future<Map<String, dynamic>> respond(
    String purpose,
    Map<String, dynamic> request,
  ) {
    if (purpose == 'snapshot.start') {
      workspaceV2Validate('snapshotStart', request);
    }
    if (purpose == 'snapshot.page') {
      return super.respond(purpose, {
        ...request,
        'limit': (request['limit'] as int).clamp(1, pageSize),
      });
    }
    return super.respond(purpose, request);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late SqliteWorkspaceStore store;
  late PermissionServer server;
  late base.DriverEnvironment environment;
  late WorkspaceV2Driver driver;
  late Directory dir;
  late String path;
  late DesktopConnection connection;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: path,
    cipher: TestWorkspaceCipher(),
  );
  WorkspaceV2Driver make({int maxRequests = 256, WorkspaceV2Apply? apply}) =>
      WorkspaceV2Driver(
        store: store,
        connection: () async => connection,
        environment: environment,
        exchange: server.exchange,
        maxRequests: maxRequests,
        apply: apply ?? (action) => action(),
      );
  Future<void> restart() async {
    driver.cancel();
    await driver.settled;
    await store.close();
    store = await open();
    driver = make();
  }

  Future<Map<String, dynamic>> row(String id) async => workspaceV2Map(
    ((await store.loadV2Workspace())['records'] as List).singleWhere(
      (record) => record['id'] == id,
    ),
  );
  Future<void> edit(String id, String title) async {
    final current = await row(id);
    await store.saveV2Todo({
      'id': id,
      'body': {
        ...workspaceV2Map(jsonDecode(current['json'] as String)),
        'title': title,
      },
    }, current['localRevision'] as int);
  }

  Future<void> caps(bool writable) =>
      store.refreshV2Capabilities(migration.capsRequest(), {
        ...migration.capsResponse(),
        'permissions': [
          for (final scope in migration.scopes)
            {'scope': scope, 'read': true, 'write': writable},
        ],
      });
  Future<void> bootstrap({bool writable = false}) async {
    server.grant(writable);
    expect(
      (await driver.upgrade(approvedScopes: migration.scopes)).state,
      WorkspaceV2RunState.complete,
    );
    server.calls.clear();
  }

  setUp(() async {
    dir = await (await Directory(
      '../tmp/mobile-tests',
    ).create(recursive: true)).createTemp('v2-driver-permissions-');
    path = '${dir.absolute.path}/workspace.sqlite';
    store = await open();
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setSyncEnabled(true);
    server = PermissionServer();
    environment = base.DriverEnvironment();
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
    'same revision elevation uses metadata snapshot without blob or cursor replacement',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id, '文' * 30000));
      await bootstrap();
      final before = await row(id);
      server.grant(true);
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.complete);
      expect(result.permissionsRefreshRequired, false);
      expect((await row(id))['writable'], true);
      for (final key in [
        'json',
        'localRevision',
        'remoteRevision',
        'remoteSequence',
      ]) {
        expect((await row(id))[key], before[key], reason: key);
      }
      expect((await store.loadV2Workspace())['cursor'], 100);
      expect(server.calls.map((call) => call['purpose']), [
        'capabilities',
        'sync',
        'snapshot.start',
        'snapshot.page',
        'capabilities',
      ]);
      expect(
        server.calls.any(
          (call) => (call['purpose'] as String).startsWith('blob.'),
        ),
        false,
      );
    },
  );

  test(
    'budget exhausted immediately after fresh caps retains permission-needed status',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap();
      server.grant(true);
      driver = make(maxRequests: 1);
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.deferred);
      expect(result.permissionsRefreshRequired, true);
      expect(result.unconfirmedCount, 0);
      expect(server.calls.map((call) => call['purpose']), ['capabilities']);
      expect((await store.v2PermissionStatus())['required'], true);
      expect((await row(id))['writable'], false);
    },
  );

  test(
    'terminal rejected draft reports attention and is not retried automatically',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap(writable: true);
      await edit(id, 'rejected local');
      server.before = (purpose, request) async {
        if (purpose != 'sync') return;
        for (final raw in request['operations'] as List) {
          final operation = workspaceV2Map(raw);
          server.receipts[operation['operationId'] as String] = {
            'operationId': operation['operationId'],
            'localRevision': operation['localRevision'],
            'status': 'rejected',
            'target': {'kind': operation['kind'], 'id': operation['id']},
            'operationHash': workspaceV2OperationHash(operation),
            'code': 'invalid_change',
            'record': server.records[id],
          };
        }
      };
      for (var i = 0; i < 2; i++) {
        final result = await driver.synchronize();
        expect(result.state, WorkspaceV2RunState.needsAttention);
        expect(result.unconfirmedCount, 1);
        expect((await row(id))['blocked'], isNotNull);
        expect((await row(id))['inflight'], null);
      }
      final syncs = server.calls
          .where((call) => call['purpose'] == 'sync')
          .toList();
      expect(syncs.length, 2);
      expect(syncs.first['payload']['operations'], hasLength(1));
      expect(syncs.last['payload']['operations'], isEmpty);
      expect(jsonDecode((await row(id))['json'])['title'], 'rejected local');
      expect(server.sequence, 100);
    },
  );

  test(
    'permission pages share request budget and resume exact checkpoint after restart',
    () async {
      for (var i = 0; i < 2; i++) {
        final id = workspaceId();
        server.add(id, base.fullBody(id));
      }
      await bootstrap();
      server.grant(true);
      server.pageSize = 1;
      driver = make(maxRequests: 4);
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.deferred);
      expect(result.permissionsRefreshRequired, true);
      final stage = (await store.v2PermissionStatus())['stage'];
      expect(stage['checkpoint']['nextToken'], '1');
      expect(stage['checkpoint']['verifiedCount'], 1);
      expect(server.calls.length, 4);
      await restart();
      server.calls.clear();
      expect((await driver.resume()).state, WorkspaceV2RunState.complete);
      expect(
        server.calls.any((call) => call['purpose'] == 'snapshot.start'),
        false,
      );
      final page = server.calls.singleWhere(
        (call) => call['purpose'] == 'snapshot.page',
      );
      expect(page['payload']['after'], '1');
      expect(page['payload']['manifestId'], stage['manifest']['manifestId']);
      expect((await store.v2PermissionStatus())['completed'], isNotNull);
    },
  );

  test(
    'permission proof unlocks preserved pending then uploads in the same round budget',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap(writable: true);
      await edit(id, 'preserved local');
      await caps(false);
      server.grant(true);
      final before = await row(id);
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.complete);
      expect(result.unconfirmedCount, 0);
      final syncs = server.calls
          .where((call) => call['purpose'] == 'sync')
          .toList();
      expect(syncs.first['payload']['operations'], isEmpty);
      expect(
        syncs
            .skip(1)
            .any((call) => (call['payload']['operations'] as List).isNotEmpty),
        true,
      );
      expect(jsonDecode((await row(id))['json'])['title'], 'preserved local');
      expect((await row(id))['pending'], null);
      expect(before['pending'], isNotNull);
      expect(server.receipts.length, 1);
    },
  );

  test(
    'final capability ABA defers without committing or rebuilding proof',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap();
      server.grant(true);
      var pagesFinished = false, changed = false;
      server.after = (purpose, request) async {
        if (purpose == 'snapshot.page') pagesFinished = true;
      };
      server.before = (purpose, request) async {
        if (purpose == 'capabilities' && pagesFinished && !changed) {
          changed = true;
          await caps(false);
          await caps(true);
        }
      };
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.deferred);
      expect((await row(id))['writable'], false);
      expect((await store.v2PermissionStatus())['completed'], null);
      expect(
        server.calls
            .where((call) => call['purpose'] == 'snapshot.start')
            .length,
        1,
      );
      expect((await store.loadV2Workspace())['cursor'], 100);
    },
  );

  for (final action in ['cancel', 'disable']) {
    test(
      '$action rejects a late permission page before durable append',
      () async {
        final id = workspaceId();
        server.add(id, base.fullBody(id));
        await bootstrap();
        server.grant(true);
        server.after = (purpose, request) async {
          if (purpose != 'snapshot.page') return;
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
                (e) => e.cancelled,
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
        final stage = (await store.v2PermissionStatus())['stage'];
        expect(stage['checkpoint']['verifiedCount'], 0);
        expect((await row(id))['writable'], false);
        expect((await store.loadV2Workspace())['cursor'], 100);
      },
    );
  }

  test('permission metadata pages recheck network policy', () async {
    for (var i = 0; i < 2; i++) {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
    }
    await bootstrap();
    server.grant(true);
    server.pageSize = 1;
    server.after = (purpose, request) async {
      if (purpose == 'snapshot.page') environment.wifi = false;
    };
    expect((await driver.synchronize()).state, WorkspaceV2RunState.paused);
    expect(
      server.calls.where((call) => call['purpose'] == 'snapshot.page').length,
      1,
    );
    expect(
      (await store
          .v2PermissionStatus())['stage']['checkpoint']['verifiedCount'],
      1,
    );
  });

  test(
    'snapshot410 cancels only permission stage then defers until external trigger',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap(writable: true);
      await edit(id, 'unsent');
      await caps(false);
      server.grant(true);
      final before = await row(id);
      server.before = (purpose, request) async {
        if (purpose == 'snapshot.page') {
          throw const WorkspaceV2Failure('expired', snapshotExpired: true);
        }
      };
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.deferred);
      expect((await store.v2PermissionStatus())['stage'], null);
      final after = await row(id);
      for (final key in ['json', 'pending', 'inflight', 'localRevision']) {
        expect(after[key], before[key], reason: key);
      }
      expect(
        server.calls
            .where((call) => call['purpose'] == 'snapshot.start')
            .length,
        1,
      );
      server.before = null;
      server.calls.clear();
      expect((await driver.resume()).state, WorkspaceV2RunState.complete);
      final firstWrite = server.calls.indexWhere(
        (call) =>
            call['purpose'] == 'sync' &&
            (call['payload']['operations'] as List).isNotEmpty,
      );
      expect(firstWrite, greaterThan(0));
      expect(
        server.calls
            .take(firstWrite)
            .where((call) => call['purpose'] == 'snapshot.start')
            .length,
        1,
      );
      expect((await row(id))['pending'], null);
    },
  );

  test(
    'snapshot413 shrinks the same page token to one and does not loop past one',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap();
      server.grant(true);
      server.before = (purpose, request) async {
        if (purpose == 'snapshot.page' && request['limit'] != 1) {
          throw const WorkspaceV2Failure('large', tooLarge: true);
        }
      };
      await driver.synchronize();
      final pages = server.calls
          .where((call) => call['purpose'] == 'snapshot.page')
          .toList();
      expect(pages.map((call) => call['payload']['limit']), [
        100,
        50,
        25,
        12,
        6,
        3,
        1,
      ]);
      expect(pages.every((call) => call['payload']['after'] == null), true);
      await caps(false);
      await caps(true);
      server.calls.clear();
      server.before = (purpose, request) async {
        if (purpose == 'snapshot.page') {
          throw const WorkspaceV2Failure('large', tooLarge: true);
        }
      };
      await expectLater(
        driver.synchronize(),
        throwsA(
          isA<WorkspaceV2Failure>().having((e) => e.tooLarge, 'tooLarge', true),
        ),
      );
      expect(
        server.calls.where((call) => call['purpose'] == 'snapshot.page').length,
        7,
      );
      expect((await store.v2PermissionStatus())['stage'], isNotNull);
    },
  );

  test(
    'snapshot409 retains checkpoint and is never treated as expiry',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap();
      server.grant(true);
      server.before = (purpose, request) async {
        if (purpose == 'snapshot.page') {
          throw const WorkspaceV2Failure('changed');
        }
      };
      await expectLater(
        driver.synchronize(),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      expect((await store.v2PermissionStatus())['stage'], isNotNull);
      expect(
        server.calls
            .where((call) => call['purpose'] == 'snapshot.start')
            .length,
        1,
      );
    },
  );

  test(
    'final capability authorization failure invalidates rather than retries stage',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap();
      server.grant(true);
      var ready = false;
      server.after = (purpose, request) async {
        if (purpose == 'snapshot.page') ready = true;
      };
      server.before = (purpose, request) async {
        if (purpose == 'capabilities' && ready) {
          throw const WorkspaceV2Failure('revoked', requiresPairing: true);
        }
      };
      await expectLater(
        driver.synchronize(),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      expect((await store.loadV2Workspace())['suspended'], true);
      expect((await store.v2PermissionStatus())['stage'], null);
      expect((await row(id))['writable'], false);
      expect(
        server.calls
            .where((call) => call['purpose'] == 'snapshot.start')
            .length,
        1,
      );
    },
  );

  test(
    'persisted over-budget state is unresolved and never automatically refetched',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap(writable: true);
      await edit(id, 'preserved');
      await caps(false);
      await caps(true);
      server.grant(true);
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(path),
          cipher = TestWorkspaceCipher();
      final saved = (await db.query('workspace_v2_permission_state')).single;
      final state = workspaceV2Map(
        jsonDecode(await cipher.decrypt(saved['payload'] as String)),
      );
      await db.update('workspace_v2_permission_state', {
        'payload': await cipher.encrypt(
          jsonEncode({
            ...state,
            'blockedReason': 'too_large',
            'completed': null,
            'stage': null,
          }),
        ),
      });
      await db.close();
      store = await open();
      driver = make();
      server.calls.clear();
      for (var i = 0; i < 2; i++) {
        final result = await driver.synchronize();
        expect(result.state, WorkspaceV2RunState.permissionBlocked);
        expect(result.permissionBlockReason, 'too_large');
        expect(result.permissionsRefreshRequired, true);
        expect(result.unconfirmedCount, 1);
      }
      expect(
        server.calls.any(
          (call) => (call['purpose'] as String).startsWith('snapshot.'),
        ),
        false,
      );
      expect((await row(id))['pending'], isNotNull);
    },
  );

  test(
    'proof with newer remote revision waits for real increment and does not refetch forever',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap(writable: true);
      await edit(id, 'local');
      await caps(false);
      await caps(true);
      final baseline = server.records[id]!;
      server.add(id, base.fullBody(id, 'new remote'), revision: 2, seq: 101);
      server.sequence = 101;
      server.before = (purpose, request) async {
        if (purpose == 'sync') {
          server.records[id] = baseline;
        } else if (purpose == 'snapshot.start') {
          server.add(
            id,
            base.fullBody(id, 'new remote'),
            revision: 2,
            seq: 101,
          );
        }
      };
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.awaitingAuthorization);
      expect(result.unconfirmedCount, 1);
      expect(
        server.calls
            .where((call) => call['purpose'] == 'snapshot.start')
            .length,
        1,
      );
      expect((await row(id))['pending'], isNotNull);
      expect((await row(id))['remoteRevision'], 1);
      expect((await store.v2PermissionStatus())['required'], false);
    },
  );

  test(
    'pending deletion without deletable permission never reports fully synchronized',
    () async {
      final id = workspaceId();
      server.add(id, base.fullBody(id));
      await bootstrap(writable: true);
      await store.saveV2Todo({
        'id': id,
        'deleted': true,
      }, (await row(id))['localRevision'] as int);
      await caps(false);
      await caps(true);
      final original = server.records[id]!;
      server.records[id] = {
        ...original,
        'metadata': {
          ...workspaceV2Map(original['metadata']),
          'deletable': false,
        },
      };
      final result = await driver.synchronize();
      expect(result.state, WorkspaceV2RunState.awaitingAuthorization);
      expect(result.unconfirmedCount, 1);
      expect((await row(id))['writable'], true);
      expect((await row(id))['pending'], isNotNull);
      expect(server.receipts, isEmpty);
    },
  );
}
