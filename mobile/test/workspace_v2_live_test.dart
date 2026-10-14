import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_test.dart' show TestWorkspaceCipher;

void main() {
  const encoded = String.fromEnvironment('WORKSPACE_V2_LIVE_FIXTURE');
  test(
    'real authenticated snapshot upgrade preserves v1 edits and resumes verified JSON',
    () async {
      final fixture = workspaceV2Map(
        jsonDecode(utf8.decode(base64Decode(encoded))),
      );
      final connection = DesktopConnection(
        address: fixture['address'] as String,
        deviceId: fixture['deviceId'] as String,
        serviceId: fixture['workspaceId'] as String,
        secretBase64: fixture['secretBase64'] as String,
        deviceName: 'v2-integration-fixture',
      );
      sqfliteFfiInit();
      Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: fixture['databasePath'] as String,
        cipher: TestWorkspaceCipher(),
      );
      var store = await open();
      final v1 = WorkspaceSyncClient(), v2 = WorkspaceV2Client();
      addTearDown(() async {
        v1.cancel();
        v2.cancel();
        await store.close();
      });
      final identity = {
        'protocolVersion': 2,
        'workspaceId': connection.serviceId,
        'deviceId': connection.deviceId,
      };
      final scopes = ['todo.full', 'work_log'];
      final permissions = [
        for (final scope in scopes)
          {'scope': scope, 'read': true, 'write': false},
      ];
      final capsRequest = {...identity, 'clientScopes': scopes};
      Future<void> command(String action) async {
        final http = HttpClient();
        try {
          final request = await http.postUrl(
            Uri.parse('http://${fixture['controlAddress']}/'),
          );
          request.headers.set('authorization', 'Bearer ${fixture['token']}');
          request.add(utf8.encode(jsonEncode({'action': action})));
          final response = await request.close();
          final body = await utf8.decoder.bind(response).join();
          expect(response.statusCode, 200, reason: body);
        } finally {
          http.close(force: true);
        }
      }

      Future<Map<String, dynamic>> call(
        String purpose,
        Map<String, dynamic> body, {
        Map<String, dynamic>? ref,
      }) => v2.request(
        connection,
        purpose,
        body,
        reserveCounter: store.reserveV2Counter,
        approvedPermissions: purpose == 'capabilities' ? permissions : null,
        expectedBlob: ref,
      );
      Future<void> drainV1() async {
        for (var page = 0; page < 20; page++) {
          final prepared = await store.prepareSyncRequest();
          final request = workspaceV2Map(prepared['payload']);
          final response = await v1.sync(
            connection,
            request,
            prepared['counter'] as int,
          );
          await store.applySyncResponse(request, response);
          if (!response['hasMore'] &&
              (await store.syncStatus())['sendableCount'] == 0) {
            return;
          }
        }
        fail('v1 did not drain');
      }

      await store.bindSync(connection.serviceId!, connection.deviceId);
      await store.setSyncEnabled(true);
      await store.setV2ApprovedScopes(scopes);
      final unapproved = await call('capabilities', capsRequest);
      expect(unapproved['supportedScopes'], isEmpty);
      await command('grant');
      final capabilities = await call('capabilities', capsRequest);
      expect(capabilities['supportedScopes'], scopes);
      expect(
        (capabilities['permissions'] as List).every((p) => p['write'] == false),
        true,
      );
      var local = await store.save(
        WorkspaceRecord(
          kind: 'todo',
          id: fixture['mobileTodoId'] as String,
          data: {
            'title': 'Before upgrade',
            'category': 'life',
            'plannedDate': '2026-10-03',
            'completedAt': null,
          },
        ),
      );
      await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {
            'goalsText': 'Never auto-convert',
            'bodyText': 'Keep original rich draft',
          },
        ),
      );
      await expectLater(
        store.prepareV2Upgrade(capsRequest, capabilities),
        throwsStateError,
      );
      await drainV1();
      final first = await store.prepareV2Upgrade(capsRequest, capabilities);
      await expectLater(store.prepareSyncRequest(), throwsStateError);
      final firstManifest = await call(
        'snapshot.start',
        workspaceV2Map(first['request']),
      );
      local = (await store.load()).firstWhere((r) => r.id == local.id);
      await store.save(
        local.copy(data: {...local.data, 'title': 'Edited while upgrading'}),
      );
      await expectLater(
        store.attachV2Manifest(first['upgradeId'] as String, firstManifest),
        throwsStateError,
      );
      expect((await store.v2Status())['activeProtocol'], 1);
      expect(
        (await store.load()).firstWhere((r) => r.id == local.id).data['title'],
        'Edited while upgrading',
      );
      await drainV1();
      final late = await store.prepareSyncRequest();
      final lateRequest = workspaceV2Map(late['payload']);
      final lateReply = await v1.sync(
        connection,
        lateRequest,
        late['counter'] as int,
      );
      final prepared = await store.prepareV2Upgrade(capsRequest, capabilities);
      final upgradeId = prepared['upgradeId'] as String;
      await expectLater(
        store.applySyncResponse(lateRequest, lateReply),
        throwsStateError,
      );
      final manifest = await call(
        'snapshot.start',
        workspaceV2Map(prepared['request']),
      );
      await store.attachV2Manifest(upgradeId, manifest);
      await command('edit-after-snapshot');
      String? after;
      var pages = 0;
      while (true) {
        final request = {
          ...identity,
          'manifestId': manifest['manifestId'],
          'after': after,
          'limit': 1,
        };
        final page = await call('snapshot.page', request);
        await store.appendV2StagePage(upgradeId, request, page);
        pages++;
        if (page['done'] == true) break;
        after = page['next'] as String;
      }
      expect(pages, greaterThanOrEqualTo(3));
      await expectLater(
        store.activateV2Stage(upgradeId),
        throwsStateError,
      );
      var downloads = ((await store.v2Status())['downloads'] as List)
          .map(workspaceV2Map)
          .toList();
      expect(downloads, isNotEmpty);
      var restarted = false;
      for (final download in downloads) {
        final ref = {
          'sha256': download['sha256'],
          'byteLength': download['byteLength'],
          'mediaType': download['mediaType'],
        };
        final count =
            ((download['byteLength'] as int) + workspaceV2ChunkBytes - 1) ~/
            workspaceV2ChunkBytes;
        expect(count, greaterThanOrEqualTo(2));
        for (var index = 0; index < count; index++) {
          final chunk = await call('blob.read', {
            ...identity,
            'record': download['record'],
            'sha256': download['sha256'],
            'index': index,
          }, ref: ref);
          final bytes = workspaceV2DecodeBase64(chunk['bytesBase64']);
          if (index == 0) {
            await expectLater(
              store.putV2StageJsonChunk(
                upgradeId,
                sha256: download['sha256'] as String,
                index: index,
                bytes: bytes,
                chunkHash: '0' * 64,
              ),
              throwsA(isA<Exception>()),
            );
          }
          await store.putV2StageJsonChunk(
            upgradeId,
            sha256: download['sha256'] as String,
            index: index,
            bytes: bytes,
            chunkHash: chunk['chunkSha256'] as String,
          );
          if (!restarted) {
            await store.close();
            store = await open();
            restarted = true;
            downloads = ((await store.v2Status())['downloads'] as List)
                .map(workspaceV2Map)
                .toList();
            expect(downloads.first['receivedIndexes'], contains(0));
          }
        }
      }
      await store.activateV2Stage(upgradeId);
      expect((await store.v2Status())['activeProtocol'], 2);
      await expectLater(store.prepareSyncRequest(), throwsStateError);
      await store.close();
      store = await open();
      final records = await store.loadV2Records();
      final migrated = records.firstWhere(
        (r) => r['id'] == fixture['mobileTodoId'],
      );
      expect(
        workspaceV2Map(jsonDecode(migrated['json'] as String))['title'],
        'Edited while upgrading',
      );
      final longRecord = records.firstWhere(
        (r) => r['id'] == fixture['macTodoId'],
      );
      final todo = workspaceV2Map(jsonDecode(longRecord['json'] as String));
      expect(todo['title'], 'x' * 80000);
      expect(todo['trackingMode'], 'progress');
      expect(todo['progress'], 42);
      expect(todo['isExtra'], true);
      expect(todo['projectId'], 'ios');
      expect(
        (await store.loadV2ReviewDrafts()).single.data['bodyText'],
        'Keep original rich draft',
      );
      final catchup = await call('sync', {
        ...identity,
        'scopes': scopes,
        'scopeDigest': workspaceV2ScopeDigest(scopes),
        'cursor': manifest['through'],
        'through': null,
        'operations': <Object>[],
      });
      expect(
        (catchup['changes'] as List).any(
          (r) => r['id'] == fixture['macTodoId'],
        ),
        true,
      );
      final catchupRecord = workspaceV2Map(
        (catchup['changes'] as List).firstWhere(
          (r) => r['id'] == fixture['macTodoId'],
        ),
      );
      expect(
        workspaceV2Map(
          jsonDecode(catchupRecord['payload']['json'] as String),
        )['title'],
        'after fixed snapshot',
      );
      await command('revoke');
      await expectLater(
        call('capabilities', capsRequest),
        throwsA(
          isA<WorkspaceV2Failure>().having(
            (e) => e.requiresPairing,
            'requiresPairing',
            true,
          ),
        ),
      );
      expect((await store.v2Status())['activeProtocol'], 2);
      expect((await store.loadV2Records()).length, records.length);
      await command('finished');
      stdout.writeln('LIVE_WORKSPACE_V2_PASSED');
    },
    skip: encoded.isEmpty
        ? 'Launched by the Mac v2 integration harness'
        : false,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
