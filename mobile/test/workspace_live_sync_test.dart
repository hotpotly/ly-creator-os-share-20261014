import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_client.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/sync/sync_policy.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_models.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_test.dart' show TestWorkspaceCipher;

void main() {
  const encoded = String.fromEnvironment('WORKSPACE_LIVE_FIXTURE');
  test(
    'real Mac HTTP and Dart SQLite preserve domain sync invariants',
    () async {
      final fixture = workspaceSyncMap(
        jsonDecode(utf8.decode(base64Decode(encoded))),
      );
      final connection = DesktopConnection(
        address: fixture['address'] as String,
        deviceId: fixture['deviceId'] as String,
        serviceId: fixture['workspaceId'] as String,
        secretBase64: fixture['secretBase64'] as String,
        deviceName: 'integration-fixture',
      );
      sqfliteFfiInit();
      Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
        factory: databaseFactoryFfi,
        databasePath: fixture['databasePath'] as String,
        cipher: TestWorkspaceCipher(),
      );
      var store = await open();
      final client = WorkspaceSyncClient();
      addTearDown(() async {
        client.cancel();
        await store.close();
      });
      Future<Map<String, dynamic>> command(
        String action, [
        Map<String, dynamic> fields = const {},
      ]) async {
        final http = HttpClient();
        try {
          final request = await http.postUrl(
            Uri.parse('http://${fixture['controlAddress']}/'),
          );
          request.headers.set('authorization', 'Bearer ${fixture['token']}');
          request.add(utf8.encode(jsonEncode({'action': action, ...fields})));
          final response = await request.close();
          final body = await utf8.decoder.bind(response).join();
          expect(response.statusCode, 200, reason: body);
          return workspaceSyncMap(jsonDecode(body));
        } finally {
          http.close(force: true);
        }
      }

      Future<Map<String, dynamic>> exchange({bool apply = true}) async {
        final prepared = await store.prepareSyncRequest();
        final request = workspaceSyncMap(prepared['payload']);
        final response = await client.sync(
          connection,
          request,
          prepared['counter'] as int,
        );
        if (apply) {
          await store.applySyncResponse(request, response);
        }
        return {
          'request': request,
          'response': response,
          'counter': prepared['counter'],
        };
      }

      Future<void> synchronize() async {
        for (var page = 0; page < 20; page++) {
          final exchangeResult = await exchange();
          final response = workspaceSyncMap(exchangeResult['response']);
          final state = await store.syncStatus();
          if (response['hasMore'] == false && state['pendingCount'] == 0) {
            return;
          }
        }
        fail('Live sync did not finish within 20 pages');
      }

      Future<WorkspaceRecord> local(String kind, String id) async =>
          (await store.load()).singleWhere(
            (value) => value.kind == kind && value.id == id,
          );
      final macTodoId = fixture['macTodoId'] as String;
      final mobileTodoId = fixture['mobileTodoId'] as String;
      final deletedId = fixture['macDeletedTodoId'] as String;

      await store.bindSync(connection.serviceId!, connection.deviceId);
      final bootstrap = await exchange();
      expect(workspaceSyncMap(bootstrap['request'])['operations'], isEmpty);
      final macTodo = await local('todo', macTodoId);
      expect(macTodo.data['title'], 'Mac待办原文');
      expect(macTodo.metadata['todo'], containsPair('progress', 42));
      expect(macTodo.metadata['todo'], containsPair('stageKey', 'script'));
      expect((await local('work_log', '2026-10-03')).data['minutes'], 135);
      expect((await store.syncStatus())['pendingCount'], 0);

      await store.save(
        WorkspaceRecord(
          kind: 'todo',
          id: mobileTodoId,
          data: {
            'title': '手机新建完成任务',
            'category': 'life',
            'plannedDate': null,
            'completedAt': '2026-10-03T18:30:00.123456Z',
          },
        ),
      );
      final lostAcknowledgment = await exchange(apply: false);
      await store.close();
      store = await open();
      final retried = await exchange();
      expect(
        workspaceSyncMap(retried['request'])['operations'],
        workspaceSyncMap(lostAcknowledgment['request'])['operations'],
      );
      expect(
        retried['counter'] as int,
        greaterThan(lostAcknowledgment['counter'] as int),
      );
      expect(
        workspaceSyncMap(retried['response'])['receipts'],
        workspaceSyncMap(lostAcknowledgment['response'])['receipts'],
      );
      final phoneCreated = await command('inspect', {'id': mobileTodoId});
      expect(phoneCreated['events'], 1);
      expect(
        workspaceSyncMap(
          workspaceSyncMap(phoneCreated['todo'])['data'],
        )['completedAt'],
        '2026-10-03T18:30:00.123456Z',
      );

      var current = await local('todo', macTodoId);
      await store.save(
        current.copy(data: {...current.data, 'title': '手机修改标题'}),
      );
      await command('edit', {
        'id': macTodoId,
        'patch': {'completed': true},
      });
      await synchronize();
      current = await local('todo', macTodoId);
      expect(current.data['title'], '手机修改标题');
      expect(current.data['completedAt'], isNotNull);
      expect(
        current.metadata['todo'],
        containsPair('progressBeforeComplete', 42),
      );
      expect(current.metadata['todo'], containsPair('isExtra', true));
      expect(current.metadata['todo'], containsPair('segment', 'evening'));

      final originalTitle = current.data['title'];
      final temporarilyChanged = await store.save(
        current.copy(data: {...current.data, 'title': '随后撤销的标题'}),
      );
      await store.save(
        temporarilyChanged.copy(
          data: {...temporarilyChanged.data, 'title': originalTitle},
        ),
      );
      final beforeNoop = await command('inspect', {'id': macTodoId});
      await synchronize();
      final afterNoop = await command('inspect', {'id': macTodoId});
      expect(afterNoop['events'], beforeNoop['events']);

      current = await local('todo', macTodoId);
      await store.save(
        current.copy(data: {...current.data, 'title': '手机冲突版本'}),
      );
      await command('edit', {
        'id': macTodoId,
        'patch': {'title': '电脑冲突版本'},
      });
      await exchange();
      var conflicts = (await store.syncStatus())['conflicts'] as List;
      expect(conflicts, hasLength(1));
      expect((await local('todo', macTodoId)).data['title'], '手机冲突版本');
      expect(
        workspaceSyncMap(
          workspaceSyncMap(
            workspaceSyncMap(conflicts.single)['remote'],
          )['data'],
        )['title'],
        '电脑冲突版本',
      );
      await store.resolveSyncConflict('todo', macTodoId, keepLocal: false);
      expect((await local('todo', macTodoId)).data['title'], '电脑冲突版本');

      var log = await local('work_log', '2026-10-03');
      await store.save(log.copy(data: {'minutes': 0}));
      await synchronize();
      var inspected = await command('inspect');
      expect(inspected['workLog'], containsPair('totalMinutes', 0));
      expect(inspected['workLog'], containsPair('selfMediaMinutes', 90));
      expect(inspected['workLog'], containsPair('aiMinutes', 30));
      log = await local('work_log', '2026-10-03');
      await store.save(log.copy(data: {'minutes': null}));
      await synchronize();
      inspected = await command('inspect');
      expect(inspected['workLog'], containsPair('updatedAt', ''));
      log = await local('work_log', '2026-10-03');
      expect(log.data['minutes'], isNull);
      expect(log.deleted, true);
      expect(log.metadata, containsPair('selfMediaMinutes', 90));

      final phoneTask = await local('todo', mobileTodoId);
      await store.save(phoneTask.copy(deleted: true));
      await synchronize();
      expect(
        workspaceSyncMap(
          (await command('inspect', {'id': mobileTodoId}))['todo'],
        )['deleted'],
        true,
      );
      final deletionTarget = await local('todo', deletedId);
      await store.save(
        deletionTarget.copy(
          data: {...deletionTarget.data, 'title': '手机尚未同步修改'},
        ),
      );
      await command('delete', {'id': deletedId});
      await exchange();
      conflicts = (await store.syncStatus())['conflicts'] as List;
      expect(conflicts, hasLength(1));
      expect(
        workspaceSyncMap(
          workspaceSyncMap(conflicts.single)['remote'],
        )['deleted'],
        true,
      );
      expect((await local('todo', deletedId)).deleted, false);
      await store.resolveSyncConflict('todo', deletedId, keepLocal: true);
      final recovery = (await store.load()).singleWhere(
        (value) =>
            value.kind == 'todo' &&
            value.id != deletedId &&
            value.data['title'] == '手机尚未同步修改',
      );
      expect(recovery.deleted, false);
      await synchronize();
      expect(
        workspaceSyncMap(
          (await command('inspect', {'id': recovery.id}))['todo'],
        )['deleted'],
        false,
      );
      expect((await local('todo', deletedId)).deleted, true);

      final complexId = (await command('seed-complex'))['id'] as String;
      await synchronize();
      final complex = await local('todo', complexId);
      await store.save(
        complex.copy(data: {...complex.data, 'title': '复杂任务手机修改'}),
      );
      await command('delete', {'id': complexId});
      await exchange();
      await expectLater(
        store.resolveSyncConflict('todo', complexId, keepLocal: true),
        throwsA(isA<FormatException>()),
      );
      expect((await store.syncStatus())['conflicts'], hasLength(1));
      expect(
        (await local('todo', complexId)).metadata['todo'],
        containsPair('stageKey', 'script'),
      );
      await store.resolveSyncConflict('todo', complexId, keepLocal: false);

      final largeIds = ((await command('seed-large'))['ids'] as List)
          .cast<String>()
          .toSet();
      await synchronize();
      final largeRows = (await store.load())
          .where((value) => largeIds.contains(value.id))
          .toList();
      expect(largeRows, hasLength(100));
      for (var start = 0; start < 100; start += 50) {
        await store.saveAll(
          largeRows
              .sublist(start, start + 50)
              .map(
                (value) =>
                    value.copy(data: {...value.data, 'category': 'life'}),
              )
              .toList(),
        );
      }
      final overBudget = await store.prepareSyncRequest();
      expect(
        workspaceSyncMap(overBudget['payload'])['operations'],
        hasLength(100),
      );
      await expectLater(
        client.sync(
          connection,
          workspaceSyncMap(overBudget['payload']),
          overBudget['counter'] as int,
        ),
        throwsA(
          isA<WorkspaceSyncFailure>().having(
            (failure) => failure.tooLarge,
            'tooLarge',
            true,
          ),
        ),
      );
      final immutableOperationIds =
          (workspaceSyncMap(overBudget['payload'])['operations'] as List)
              .map((value) => workspaceSyncMap(value)['operationId'])
              .toSet();
      final engineController = WorkspaceController(store);
      await engineController.load();
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: engineController,
        connections: MemoryConnectionStore(connection),
        client: client,
        environment: const _LiveEnvironment(),
        discover: () async => [],
      );
      engine.setActive(true);
      await engine.settled;
      expect(engine.error, isNull);
      expect((await store.syncStatus())['pendingCount'], 0);
      expect(
        (await store.load())
            .where((value) => largeIds.contains(value.id))
            .every((value) => value.data['category'] == 'life'),
        true,
      );
      expect(
        (await command('inspect'))['receiptOperationIds'],
        containsAll(immutableOperationIds),
      );
      expect(
        workspaceSyncMap(
          workspaceSyncMap(
            (await command('inspect', {'id': largeIds.first}))['todo'],
          )['data'],
        )['category'],
        'life',
      );
      engine.dispose();
      engineController.dispose();

      var requestBytes = 0;
      var responseBytes = 0;
      final beforeMeasured = await command('inspect', {'id': macTodoId});
      for (var index = 0; index < 100; index++) {
        final measuredTodo = await local('todo', macTodoId);
        await store.save(
          measuredTodo.copy(
            data: {...measuredTodo.data, 'title': '文案第${index + 1}次修改'},
          ),
        );
        final measured = await exchange();
        final payload = workspaceSyncMap(measured['request']);
        final reply = workspaceSyncMap(measured['response']);
        expect(payload['operations'], hasLength(1));
        expect(reply['receipts'], hasLength(1));
        expect(
          workspaceSyncMap((reply['receipts'] as List).single)['status'],
          'accepted',
        );
        expect(reply['hasMore'], false);
        requestBytes += utf8.encode(jsonEncode(payload)).length;
        responseBytes += utf8.encode(jsonEncode(reply)).length;
      }
      final measuredTotal = requestBytes + responseBytes;
      expect(measuredTotal, lessThanOrEqualTo(1024 * 1024));
      final afterMeasured = await command('inspect', {'id': macTodoId});
      expect(afterMeasured['events'], (beforeMeasured['events'] as int) + 100);
      expect((await store.syncStatus())['pendingCount'], 0);
      await command('measurement', {
        'measurement': {
          'changes': 100,
          'mode': '100 sequential HTTP exchanges',
          'requestBytes': requestBytes,
          'responseBytes': responseBytes,
          'totalBytes': measuredTotal,
        },
      });

      await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'monthly:2026-10-01',
          data: {'goalsText': '复盘只在本机', 'bodyText': '不发送'},
        ),
      );
      final reviewExchange = await exchange();
      expect(
        workspaceSyncMap(reviewExchange['request'])['operations'],
        isEmpty,
      );
      expect(await store.pendingCount(), 1);
      expect((await store.syncStatus())['pendingCount'], 0);
      inspected = await command('inspect');
      expect(inspected['captures'], fixture['captureCount']);
      expect(inspected['captureChanged'], 0);
      final http = HttpClient();
      try {
        final health = await (await http.getUrl(
          Uri.parse('http://${connection.address}/v2/health'),
        )).close();
        expect(health.statusCode, 200);
        await health.drain<void>();
      } finally {
        http.close(force: true);
      }

      current = await local('todo', macTodoId);
      await store.save(current.copy(data: {...current.data, 'category': 'ai'}));
      await command('revoke');
      await expectLater(
        exchange(),
        throwsA(
          isA<WorkspaceSyncFailure>().having(
            (failure) => failure.requiresPairing,
            'requiresPairing',
            true,
          ),
        ),
      );
      expect((await store.syncStatus())['pendingCount'], 1);
      expect((await local('todo', macTodoId)).data['category'], 'ai');
      await command('finished');
      stdout.writeln('LIVE_WORKSPACE_SYNC_PASSED');
    },
    skip: encoded.isEmpty ? 'Requires the Mac Vitest HTTP fixture' : false,
    timeout: const Timeout(Duration(seconds: 120)),
  );
}

class _LiveEnvironment extends SyncEnvironmentProvider {
  const _LiveEnvironment();
  @override
  Future<SyncEnvironment> read() async => const SyncEnvironment(
    wifi: true,
    metered: false,
    powerSaver: false,
    batteryPercent: 80,
    charging: false,
  );
}
