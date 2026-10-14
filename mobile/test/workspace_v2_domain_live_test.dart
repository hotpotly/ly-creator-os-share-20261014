import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_test.dart' show TestWorkspaceCipher;

void main() {
  const encoded = String.fromEnvironment('WORKSPACE_V2_DOMAIN_FIXTURE');
  test(
    'real full-domain synchronization keeps offline progress, original bodies and rejected drafts',
    () async {
      final fixture = workspaceV2Map(
        jsonDecode(utf8.decode(base64Decode(encoded))),
      );
      final connection = DesktopConnection(
        address: fixture['address'] as String,
        deviceId: fixture['deviceId'] as String,
        serviceId: fixture['workspaceId'] as String,
        secretBase64: fixture['secretBase64'] as String,
        deviceName: 'v2-domain-fixture',
      );
      sqfliteFfiInit();
      Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: fixture['databasePath'] as String,
        cipher: TestWorkspaceCipher(),
      );
      var store = await open();
      final client = WorkspaceV2Client();
      addTearDown(() async {
        client.cancel();
        await store.close();
      });
      Future<void> restart() async {
        await store.close();
        store = await open();
      }

      final identity = {
        'protocolVersion': 2,
        'workspaceId': connection.serviceId,
        'deviceId': connection.deviceId,
      };
      final scopes = [
        'preferences.todo',
        'project.catalog',
        'todo.full',
        'work_log',
      ];
      final permissions = [
        for (final scope in scopes)
          {
            'scope': scope,
            'read': true,
            'write': scope == 'todo.full' || scope == 'work_log',
          },
      ];
      Future<Map<String, dynamic>> call(
        String purpose,
        Map<String, dynamic> payload, {
        Map<String, dynamic>? ref,
      }) => client.request(
        connection,
        purpose,
        payload,
        reserveCounter: store.reserveV2Counter,
        approvedPermissions: purpose == 'capabilities' ? permissions : null,
        expectedBlob: ref,
      );
      Future<Map<String, dynamic>> command(String action) async {
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
          return workspaceV2Map(jsonDecode(body));
        } finally {
          http.close(force: true);
        }
      }

      Future<Map<String, dynamic>> row(String kind, String id) async {
        final state = await store.loadV2Workspace();
        return (state['records'] as List)
            .map(workspaceV2Map)
            .firstWhere((item) => item['kind'] == kind && item['id'] == id);
      }

      Map<String, dynamic> body(Map<String, dynamic> record) =>
          workspaceV2Map(jsonDecode(record['json'] as String));
      Future<void> editTodo(String id, Map<String, dynamic> patch) async {
        final current = await row('todo', id);
        await store.saveV2Todo({
          'id': id,
          'body': {...body(current), ...patch},
          'deleted': false,
        }, current['localRevision'] as int);
      }

      var restartedUpload = false, expiredUpload = false;
      final confirmedChunks = <String>{};
      final requestContexts = Expando<String>();
      Future<Map<String, dynamic>> prepare() async {
        var prepared = await store.prepareV2Sync();
        for (final raw in prepared['uploads'] as List) {
          final upload = workspaceV2Map(raw);
          if (upload['committed'] == true) continue;
          final ref = workspaceV2Map(upload['ref']);
          final operation =
              (workspaceV2Map(prepared['payload'])['operations'] as List)
                  .map(workspaceV2Map)
                  .firstWhere(
                    (value) => value['operationId'] == upload['operationId'],
                  );
          Map<String, dynamic> session;
          if (upload['checkpoint'] != null) {
            final checkpoint = workspaceV2Map(upload['checkpoint']);
            session = await call('blob.status', {
              ...identity,
              'sessionId': checkpoint['sessionId'],
            });
            if (restartedUpload && !expiredUpload) {
              expect(session['receivedIndexes'], contains(0));
              await command('expire-upload');
              await expectLater(
                call('blob.status', {
                  ...identity,
                  'sessionId': checkpoint['sessionId'],
                }),
                throwsA(
                  isA<WorkspaceV2Failure>().having(
                    (failure) => failure.uploadSessionExpired,
                    'uploadSessionExpired',
                    true,
                  ),
                ),
              );
              await store.resetV2Upload(
                upload['operationId'] as String,
                ref['sha256'] as String,
                reason: 'server_expired',
              );
              final restored = await store.prepareV2Sync();
              expect(restored['payload'], prepared['payload']);
              final renewed = (restored['uploads'] as List)
                  .map(workspaceV2Map)
                  .firstWhere(
                    (value) =>
                        value['operationId'] == upload['operationId'] &&
                        workspaceV2Map(value['ref'])['sha256'] == ref['sha256'],
                  );
              expect(renewed['uploadId'], isNot(upload['uploadId']));
              expect(renewed['checkpoint'], isNull);
              expect(renewed['ref'], ref);
              expiredUpload = true;
              await restart();
              return prepare();
            }
          } else {
            session = await call('blob.start', {
              ...identity,
              'uploadId': upload['uploadId'],
              'scope': workspaceV2KindScopes[operation['kind']],
              'entity': {'kind': operation['kind'], 'id': operation['id']},
              'purpose': 'document',
              ...ref,
            });
          }
          await store.saveV2UploadCheckpoint(
            upload['operationId'] as String,
            ref['sha256'] as String,
            session,
          );
          final count =
              ((ref['byteLength'] as int) + workspaceV2ChunkBytes - 1) ~/
              workspaceV2ChunkBytes;
          for (var index = 0; index < count; index++) {
            if ((session['receivedIndexes'] as List).contains(index)) continue;
            final chunkKey = '${upload['uploadId']}:${ref['sha256']}:$index';
            expect(confirmedChunks, isNot(contains(chunkKey)));
            final chunk = await store.loadV2UploadChunk(
              upload['operationId'] as String,
              ref['sha256'] as String,
              index,
            );
            await call('blob.chunk', {
              ...identity,
              'sessionId': session['sessionId'],
              'index': index,
              'sha256': chunk['chunkHash'],
              'bytesBase64': base64Encode(
                List<int>.from(chunk['bytes'] as List),
              ),
            });
            session = await call('blob.status', {
              ...identity,
              'sessionId': session['sessionId'],
            });
            await store.saveV2UploadCheckpoint(
              upload['operationId'] as String,
              ref['sha256'] as String,
              session,
            );
            confirmedChunks.add(chunkKey);
            if (!restartedUpload) {
              await restart();
              restartedUpload = true;
              final restored = await store.prepareV2Sync();
              expect(restored['payload'], prepared['payload']);
              final restoredUpload = (restored['uploads'] as List)
                  .map(workspaceV2Map)
                  .firstWhere(
                    (value) =>
                        value['operationId'] == upload['operationId'] &&
                        workspaceV2Map(value['ref'])['sha256'] == ref['sha256'],
                  );
              final checkpoint = workspaceV2Map(restoredUpload['checkpoint']);
              expect(checkpoint['sessionId'], session['sessionId']);
              expect(checkpoint['receivedIndexes'], contains(index));
              return prepare();
            }
          }
          final committed = await call('blob.commit', {
            ...identity,
            'sessionId': session['sessionId'],
            'sha256': ref['sha256'],
            'byteLength': ref['byteLength'],
          });
          await store.markV2UploadCommitted(
            upload['operationId'] as String,
            ref['sha256'] as String,
            committed,
          );
        }
        prepared = await store.prepareV2Sync();
        expect(prepared['ready'], true);
        final request = workspaceV2Map(prepared['payload']);
        requestContexts[request] = prepared['permissionContext'] as String;
        return request;
      }

      Future<void> apply(
        Map<String, dynamic> request,
        Map<String, dynamic> response,
      ) async {
        final before = workspaceV2Map(
          jsonDecode(jsonEncode(await store.loadV2Workspace())),
        );
        final staged = await store.stageV2SyncResponse(
          request,
          response,
          permissionContext: requestContexts[request],
        );
        final responseId = staged['responseId'] as String;
        final downloads = (staged['downloads'] as List)
            .map(workspaceV2Map)
            .where((download) => download['complete'] != true)
            .toList();
        if (downloads.isNotEmpty) {
          await expectLater(
            store.commitV2SyncResponse(responseId),
            throwsA(anyOf(isA<StateError>(), isA<FormatException>())),
          );
          await restart();
          final unchanged = await store.loadV2Workspace();
          for (final key in [
            'cursor',
            'through',
            'knownSequence',
            'records',
            'pendingCount',
            'sendableCount',
            'inflightCount',
          ]) {
            expect(unchanged[key], before[key], reason: key);
          }
        }
        for (final download in downloads) {
          final ref = {
            'sha256': download['sha256'],
            'byteLength': download['byteLength'],
            'mediaType': download['mediaType'],
          };
          final count =
              ((download['byteLength'] as int) + workspaceV2ChunkBytes - 1) ~/
              workspaceV2ChunkBytes;
          for (var index = 0; index < count; index++) {
            if ((download['receivedIndexes'] as List? ?? []).contains(index)) {
              continue;
            }
            final chunk = await call('blob.read', {
              ...identity,
              'record': download['record'],
              'sha256': download['sha256'],
              'index': index,
            }, ref: ref);
            await store.putV2ResponseJsonChunk(
              responseId,
              sha256: download['sha256'] as String,
              index: index,
              bytes: workspaceV2DecodeBase64(chunk['bytesBase64']),
              chunkHash: chunk['chunkSha256'] as String,
            );
          }
        }
        await store.commitV2SyncResponse(responseId);
      }

      Future<void> flush() async {
        for (var page = 0; page < 40; page++) {
          final request = await prepare();
          final response = await call('sync', request);
          await apply(request, response);
          final state = await store.loadV2Workspace();
          if (!response['hasMore'] &&
              state['sendableCount'] == 0 &&
              (state['knownSequence'] as int) <= (state['cursor'] as int)) {
            return;
          }
        }
        fail('full-domain fixture did not drain');
      }

      await store.bindSync(connection.serviceId!, connection.deviceId);
      await store.setSyncEnabled(true);
      await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {
            'goalsText': 'Original draft',
            'bodyText': 'Never auto-convert',
          },
        ),
      );
      await store.setV2ApprovedScopes(scopes);
      final capsRequest = {...identity, 'clientScopes': scopes};
      final capabilities = await call('capabilities', capsRequest);
      expect(capabilities['supportedScopes'], scopes);
      expect(capabilities['permissions'], permissions);
      final upgrade = await store.prepareV2Upgrade(capsRequest, capabilities);
      final upgradeId = upgrade['upgradeId'] as String;
      final manifest = await call(
        'snapshot.start',
        workspaceV2Map(upgrade['request']),
      );
      await store.attachV2Manifest(upgradeId, manifest);
      String? after;
      while (true) {
        final request = {
          ...identity,
          'manifestId': manifest['manifestId'],
          'after': after,
          'limit': 2,
        };
        final response = await call('snapshot.page', request);
        await store.appendV2StagePage(upgradeId, request, response);
        if (response['done'] == true) break;
        after = response['next'] as String;
      }
      for (final raw in (await store.v2Status())['downloads'] as List) {
        final download = workspaceV2Map(raw);
        final ref = {
          'sha256': download['sha256'],
          'byteLength': download['byteLength'],
          'mediaType': download['mediaType'],
        };
        final count =
            ((download['byteLength'] as int) + workspaceV2ChunkBytes - 1) ~/
            workspaceV2ChunkBytes;
        for (var index = 0; index < count; index++) {
          final chunk = await call('blob.read', {
            ...identity,
            'record': download['record'],
            'sha256': download['sha256'],
            'index': index,
          }, ref: ref);
          await store.putV2StageJsonChunk(
            upgradeId,
            sha256: download['sha256'] as String,
            index: index,
            bytes: workspaceV2DecodeBase64(chunk['bytesBase64']),
            chunkHash: chunk['chunkSha256'] as String,
          );
        }
      }
      await store.activateV2Stage(upgradeId);
      await restart();
      expect(body(await row('todo_preferences', 'workspace')).keys.toSet(), {
        'todoCategoryLabels',
        'todoCategoryColors',
        'todoCategoryWeights',
        'companionTodoView',
        'companionTodoOrder',
      });
      expect(body(await row('project_catalog', 'ios')).keys.toSet(), {
        'id',
        'title',
        'status',
        'topicStageRole',
        'trashedAt',
        'ledgerOnly',
        'stages',
      });
      expect(
        (await store.loadV2ReviewDrafts()).single.data['bodyText'],
        'Never auto-convert',
      );

      final mobileId = fixture['mobileTodoId'] as String;
      final createBody = <String, dynamic>{
        'title': 'Phone progress',
        'category': 'self_media',
        'isExtra': false,
        'plannedDate': '2026-10-03',
        'segment': null,
        'dateRange': null,
        'projectId': 'ios',
        'stageKey': 'script',
        'status': 'open',
        'trackingMode': 'progress',
        'progress': 37,
        'progressBeforeComplete': null,
        'completedAt': null,
      };
      await store.saveV2Todo({
        'id': mobileId,
        'body': createBody,
        'deleted': false,
      }, 0);
      final lostRequest = await prepare();
      final lostResponse = await call('sync', lostRequest);
      final eventsAfterCreate = workspaceV2Map(
        (await command('state'))['events'],
      )[mobileId];
      await editTodo(mobileId, {'progress': 67});
      await editTodo(mobileId, {
        'status': 'completed',
        'progress': 100,
        'progressBeforeComplete': 67,
        'completedAt': '2026-10-03T04:05:06.123456Z',
      });
      await editTodo(mobileId, {
        'status': 'open',
        'progress': 67,
        'progressBeforeComplete': 67,
        'completedAt': null,
      });
      await restart();
      expect(await prepare(), lostRequest);
      final retry = await call('sync', lostRequest);
      expect(retry['receipts'], lostResponse['receipts']);
      await apply(lostRequest, retry);
      expect(body(await row('todo', mobileId))['progress'], 67);
      expect(
        workspaceV2Map((await command('state'))['events'])[mobileId],
        eventsAfterCreate,
      );
      await flush();
      expect(
        body(await row('todo', mobileId)),
        containsPair('progressBeforeComplete', 67),
      );

      final macId = fixture['macTodoId'] as String;
      await editTodo(macId, {'title': 'Phone title'});
      final mergeRequest = await prepare();
      await command('edit-mac-category');
      await apply(mergeRequest, await call('sync', mergeRequest));
      await flush();
      expect(
        body(await row('todo', macId)),
        containsPair('title', 'Phone title'),
      );
      expect(body(await row('todo', macId)), containsPair('category', 'life'));
      await editTodo(macId, {'progress': 67});
      final conflictRequest = await prepare();
      await command('edit-mac-progress');
      final conflictResponse = await call('sync', conflictRequest);
      expect(
        workspaceV2Map((conflictResponse['receipts'] as List).single)['status'],
        'conflict',
      );
      await apply(conflictRequest, conflictResponse);
      final conflicted = await row('todo', macId);
      expect(conflicted['conflict'], isNotNull);
      await store.resolveV2Conflict(
        'todo',
        macId,
        keepLocal: true,
        expectedLocalRevision: conflicted['localRevision'] as int,
        expectedRemoteRevision: conflicted['remoteRevision'] as int,
      );
      await flush();
      expect(body(await row('todo', macId)), containsPair('progress', 67));

      var log = await row('work_log', '2026-10-03');
      await store.saveV2WorkLog({
        'day': '2026-10-03',
        'minutes': 0,
        'clear': false,
      }, log['localRevision'] as int);
      await flush();
      log = await row('work_log', '2026-10-03');
      expect(log['deleted'], false);
      expect(body(log), containsPair('totalMinutes', 0));
      expect(body(log), containsPair('selfMediaMinutes', 90));
      await store.saveV2WorkLog({
        'day': '2026-10-03',
        'clear': true,
      }, log['localRevision'] as int);
      await flush();
      log = await row('work_log', '2026-10-03');
      expect(log['deleted'], true);
      await store.saveV2WorkLog({
        'day': '2026-10-03',
        'minutes': 0,
        'clear': false,
      }, log['localRevision'] as int);
      await flush();
      expect(
        body(await row('work_log', '2026-10-03')),
        containsPair('selfMediaMinutes', 0),
      );
      await store.saveV2WorkLog({'day': '2026-10-04', 'clear': true}, 0);
      await flush();
      expect((await row('work_log', '2026-10-04'))['deleted'], true);

      final longId = fixture['longTodoId'] as String;
      await editTodo(longId, {'category': 'life'});
      await flush();
      expect(restartedUpload, true);
      expect(expiredUpload, true);
      expect(body(await row('todo', longId)), containsPair('progress', 12.25));
      expect(
        body(await row('todo', longId)),
        containsPair('title', 'x' * 80000),
      );

      final rejectedId = fixture['rejectedTodoId'] as String;
      await store.saveV2Todo({
        'id': rejectedId,
        'body': {...createBody, 'title': 'Retained rejected draft'},
        'deleted': false,
      }, 0);
      final rejectedRequest = await prepare();
      await command('archive-project');
      final rejectedResponse = await call('sync', rejectedRequest);
      final receipt = workspaceV2Map(
        (rejectedResponse['receipts'] as List).single,
      );
      expect(receipt['status'], 'rejected');
      expect(receipt['record'], isNull);
      await restart();
      expect(await prepare(), rejectedRequest);
      await command('restore-project');
      final repeatedRejection = await call('sync', rejectedRequest);
      expect(repeatedRejection['receipts'], rejectedResponse['receipts']);
      await apply(rejectedRequest, repeatedRejection);
      await restart();
      expect((await row('todo', rejectedId))['blocked'], isNotNull);
      expect((await store.loadV2Workspace())['sendableCount'], 0);
      expect(workspaceV2Map((await command('state'))['events'])[rejectedId], 0);
      await flush();
      expect((await row('todo', rejectedId))['blocked'], isNotNull);
      await editTodo(rejectedId, {'projectId': null, 'stageKey': null});
      await flush();
      expect((await row('todo', rejectedId))['blocked'], isNull);
      expect(workspaceV2Map((await command('state'))['events'])[rejectedId], 1);
      await restart();
      expect((await store.loadV2Workspace())['pendingCount'], 0);
      expect(body(await row('todo', mobileId)), containsPair('progress', 67));
      await command('finished');
      stdout.writeln('LIVE_WORKSPACE_V2_DOMAIN_PASSED');
    },
    skip: encoded.isEmpty,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
