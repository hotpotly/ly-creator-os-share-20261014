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
import 'workspace_v2_persistence_test.dart' as fixture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory directory;
  late SqliteWorkspaceStore store;
  late DriverServer server;
  late String id;
  late Map<String, dynamic> remote;
  final now = DateTime.utc(2026, 10, 3, 12);
  Future<Map<String, dynamic>> row() async => workspaceV2Map(
    ((await store.loadV2Workspace())['records'] as List).single,
  );
  Future<void> caps(bool write) async {
    final response = fixture.capsResponse();
    response['permissions'] = [
      for (final scope in fixture.scopes)
        {'scope': scope, 'read': true, 'write': write},
    ];
    await store.refreshV2Capabilities(fixture.capsRequest(), response);
  }

  Future<void> refresh(Map<String, dynamic> proof) async {
    final stage = await store.beginV2PermissionRefresh(),
        manifest = fixture.manifest([proof], now),
        refreshId = stage['refreshId'] as String;
    await store.attachV2PermissionManifest(refreshId, manifest);
    await store.appendV2PermissionPage(
      refreshId,
      fixture.pageRequest(manifest),
      fixture.pageResponse(manifest, [proof]),
    );
    await store.commitV2Permissions(refreshId);
  }

  Future<void> receive(
    Map<String, dynamic> prepared, {
    String? context,
    Map<String, dynamic>? requestOverride,
  }) async {
    final request = requestOverride ?? workspaceV2Map(prepared['payload']),
        newer = server.record(
          id,
          fullBody(id, 'authenticated fact'),
          revision: 2,
          seq: 101,
        );
    final response = {
      ...fixture.identity(),
      'scopes': request['scopes'],
      'scopeDigest': request['scopeDigest'],
      'cursor': 101,
      'through': 101,
      'hasMore': false,
      'receipts': <Map<String, dynamic>>[],
      'changes': [newer],
    };
    final staged = await store.stageV2SyncResponse(
      request,
      response,
      permissionContext: context,
    );
    await store.commitV2SyncResponse(staged['responseId'] as String);
  }

  setUp(() async {
    final root = await Directory('../tmp/mobile-tests').create(recursive: true);
    directory = await root.createTemp('permission-review-');
    store = await SqliteWorkspaceStore.create(
      factory: databaseFactoryFfi,
      databasePath: '${directory.path}/review.sqlite',
      cipher: TestWorkspaceCipher(),
      now: () => now,
    );
    await store.bindSync(v1.macId, v1.phoneId);
    await store.setV2ApprovedScopes(fixture.scopes);
    server = DriverServer();
    id = workspaceId();
    remote = server.record(id, fullBody(id));
    final upgrade = await store.prepareV2Upgrade(
          fixture.capsRequest(),
          fixture.capsResponse(),
        ),
        manifest = fixture.manifest([remote], now),
        upgradeId = upgrade['upgradeId'] as String;
    await store.attachV2Manifest(upgradeId, manifest);
    await store.appendV2StagePage(
      upgradeId,
      fixture.pageRequest(manifest),
      fixture.pageResponse(manifest, [remote]),
    );
    await store.activateV2Stage(upgradeId);
    expect((await row())['writable'], true);
  });
  tearDown(() async {
    await store.close();
    await directory.delete(recursive: true);
  });

  for (final mismatch in ['sequence', 'deleted', 'byteLength']) {
    test(
      'permission proof rejects matching hash with mismatched $mismatch',
      () async {
        final original = await row();
        await caps(false);
        await caps(true);
        final proof = workspaceV2Map(jsonDecode(jsonEncode(remote)));
        if (mismatch == 'sequence') proof['sequence'] = 2;
        if (mismatch == 'deleted') proof['deleted'] = true;
        if (mismatch == 'byteLength') {
          final payload = workspaceV2Map(proof['payload']);
          proof['payload'] = {
            'encoding': 'blob',
            'ref': {
              'sha256': payload['sha256'],
              'byteLength': (payload['byteLength'] as int) + 1,
              'mediaType': 'application/json',
            },
          };
        }
        await refresh(proof);
        final after = await row();
        expect(after['writable'], false);
        expect(after['json'], original['json']);
        expect(after['localRevision'], original['localRevision']);
        expect((await store.loadV2Workspace())['cursor'], 100);
      },
    );
  }

  test(
    'later same-hash prepare cannot refresh the original response epoch',
    () async {
      final old = await store.prepareV2Sync();
      await caps(false);
      await caps(true);
      final current = await store.prepareV2Sync();
      expect(current['payload'], old['payload']);
      expect(current['permissionContext'], isNot(old['permissionContext']));
      await receive(old, context: old['permissionContext'] as String?);
      expect(
        jsonDecode((await row())['json'] as String)['title'],
        'authenticated fact',
      );
      expect((await row())['writable'], false);
    },
  );

  test(
    'absent context never promotes a changed baseline even at initial epoch',
    () async {
      final prepared = await store.prepareV2Sync();
      await receive(prepared);
      expect((await row())['remoteRevision'], 2);
      expect((await row())['writable'], false);
      expect((await store.v2PermissionStatus())['required'], true);
    },
  );

  test(
    'evicted request context is facts-only and context storage remains bounded',
    () async {
      final oldest = await store.prepareV2Sync();
      for (var i = 0; i < 20; i++) {
        await store.prepareV2Sync();
      }
      final status = await store.v2PermissionStatus();
      expect((status['requests'] as List).length, 16);
      await receive(oldest, context: oldest['permissionContext'] as String?);
      expect((await row())['remoteRevision'], 2);
      expect((await row())['writable'], false);
    },
  );

  test(
    'valid current context proves fresh changes without altering their raw JSON',
    () async {
      await caps(false);
      await caps(true);
      final prepared = await store.prepareV2Sync();
      await receive(
        prepared,
        context: prepared['permissionContext'] as String?,
      );
      final local = await row();
      expect(local['writable'], true);
      expect(local['json'], jsonEncode(fullBody(id, 'authenticated fact')));
      expect(local['pending'], isNull);
      expect(local['inflight'], isNull);
    },
  );

  test(
    'v4 migration preserves pending, inflight and raw baseline before establishing permission proof',
    () async {
      Future<void> edit(String title) async {
        final before = await row();
        await store.saveV2Todo({
          'id': id,
          'body': {
            ...workspaceV2Map(jsonDecode(before['json'] as String)),
            'title': title,
          },
        }, before['localRevision'] as int);
      }

      await edit('inflight draft');
      final prepared = await store.prepareV2Sync();
      await edit('successor draft');
      final before = await row(), beforeLive = await store.loadV2Workspace();
      await store.close();
      final db = await databaseFactoryFfi.openDatabase(
            '${directory.path}/review.sqlite',
          ),
          cipher = TestWorkspaceCipher();
      for (final table in [
        'permission_state',
        'permission_pages',
        'permission_records',
      ]) {
        await db.execute('DROP TABLE workspace_v2_$table');
      }
      final stateRow = (await db.query('workspace_v2_state')).single;
      final state = workspaceV2Map(
        jsonDecode(await cipher.decrypt(stateRow['payload'] as String)),
      )..remove('permissionsInitialized');
      await db.update('workspace_v2_state', {
        'payload': await cipher.encrypt(jsonEncode(state)),
      });
      await db.setVersion(4);
      await db.close();
      store = await SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: '${directory.path}/review.sqlite',
        cipher: cipher,
        now: () => now,
      );
      final after = await row();
      for (final key in [
        'json',
        'localRevision',
        'pending',
        'inflight',
        'remoteRevision',
      ]) {
        expect(after[key], before[key]);
      }
      expect(after['writable'], true);
      expect((await store.loadV2Workspace())['cursor'], beforeLive['cursor']);
      expect((await store.prepareV2Sync())['payload'], prepared['payload']);
    },
  );
}
