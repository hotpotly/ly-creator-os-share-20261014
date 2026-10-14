import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_models.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'workspace_test.dart' show TestWorkspaceCipher, todo;

const macId = '11111111-1111-4111-8111-111111111111';
const phoneId = '22222222-2222-4222-8222-222222222222';

Map<String, dynamic> remote(
  WorkspaceRecord record, {
  int revision = 1,
  int sequence = 1,
  Map<String, dynamic>? metadata,
}) => {
  'kind': record.kind,
  'id': record.id,
  'revision': revision,
  'sequence': sequence,
  'deleted': record.deleted,
  'data': record.data,
  'metadata':
      metadata ??
      (record.kind == 'todo'
          ? {
              'todo': {
                'id': record.id,
                ...record.data,
                'source': 'manual',
                'dateRange': null,
                'progress': 0.42,
                'trackingMode': 'progress',
                'stageKey': 'copy',
                'projectId': 'project-a',
                'unknownFutureField': {
                  'nested': [1, '保留'],
                },
              },
              'editableFields': workspaceTodoFields.toList(),
              'deletable': true,
            }
          : {
              'date': record.id,
              'categoryMinutes': {'self_media': 120, 'life': 15},
            }),
};

Map<String, dynamic> response(
  Map<String, dynamic> request, {
  List<Map<String, dynamic>> receipts = const [],
  List<Map<String, dynamic>> changes = const [],
  int cursor = 0,
  int? through,
  bool hasMore = false,
}) => {
  'protocolVersion': 1,
  'workspaceId': macId,
  'deviceId': phoneId,
  'receipts': receipts,
  'changes': changes.isNotEmpty
      ? changes
      : (receipts
            .map((item) => workspaceSyncMap(item['record']))
            .where(
              (item) =>
                  (item['sequence'] as int) > (request['cursor'] as int) &&
                  (item['sequence'] as int) <= cursor,
            )
            .toList()
          ..sort(
            (a, b) => (a['sequence'] as int).compareTo(b['sequence'] as int),
          )),
  'cursor': cursor,
  'through': through ?? cursor,
  'hasMore': hasMore,
};

Map<String, dynamic> receipt(
  Map<String, dynamic> operation,
  Map<String, dynamic> record, {
  String status = 'accepted',
}) => {
  'operationId': operation['operationId'],
  'localRevision': operation['localRevision'],
  'status': status,
  'record': record,
};

Map<String, dynamic> operation(Map<String, dynamic> request) =>
    workspaceSyncMap((request['operations'] as List).single);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory directory;
  late String dbPath;
  late SqliteWorkspaceStore store;
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: dbPath,
    cipher: TestWorkspaceCipher(),
  );
  Future<Map<String, dynamic>> prepare() async =>
      workspaceSyncMap((await store.prepareSyncRequest())['payload']);
  Future<void> pull(List<Map<String, dynamic>> changes, int cursor) async {
    final request = await prepare();
    expect(request['operations'], isEmpty);
    await store.applySyncResponse(
      request,
      response(request, changes: changes, cursor: cursor),
    );
  }

  setUp(() async {
    final root = await Directory(
      '${Directory.current.path}/../tmp/mobile-tests',
    ).create(recursive: true);
    directory = await root.createTemp('workspace-sync-');
    dbPath = '${directory.path}/workspace.sqlite';
    store = await open();
    await store.bindSync(macId, phoneId);
  });
  tearDown(() async {
    await store.close();
    await directory.delete(recursive: true);
  });

  test(
    'binding requires explicit identity, disable keeps identity and queued data',
    () async {
      await store.save(todo());
      await store.setSyncEnabled(false);
      await expectLater(store.prepareSyncRequest(), throwsStateError);
      await expectLater(
        store.bindSync(workspaceId(), phoneId),
        throwsStateError,
      );
      await expectLater(store.bindSync(macId, workspaceId()), throwsStateError);
      await store.close();
      store = await open();
      expect((await store.syncStatus())['enabled'], false);
      expect((await store.syncStatus())['workspaceId'], macId);
      expect(await store.pendingCount(), 1);
      await store.bindSync(macId, phoneId);
      expect((await store.syncStatus())['enabled'], true);
    },
  );

  test(
    'immutable operation survives retries, restart and edits during flight; ack keeps successor',
    () async {
      final first = await store.save(todo());
      final prepared = await store.prepareSyncRequest();
      final request = workspaceSyncMap(prepared['payload']);
      final sent = operation(request);
      final second = await store.save(
        first.copy(data: {...first.data, 'title': '发送期间修改'}),
      );
      await store.close();
      store = await open();
      final retry = await store.prepareSyncRequest();
      expect(retry['counter'], (prepared['counter'] as int) + 1);
      expect(workspaceSyncMap(retry['payload']), request);
      final accepted = remote(first);
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(sent, accepted)],
          changes: [accepted],
          cursor: 1,
        ),
      );
      expect((await store.load()).single.data['title'], second.data['title']);
      expect(await store.pendingCount(), 1);
      final followup = await prepare();
      final next = operation(followup);
      expect(next['operationId'], isNot(sent['operationId']));
      expect(next['baseRevision'], 1);
      expect(next['base'], {'deleted': false, 'data': first.data});
      expect(next['next'], {'deleted': false, 'data': second.data});
      final finalRecord = remote(second, revision: 2, sequence: 2);
      await store.applySyncResponse(
        followup,
        response(
          followup,
          receipts: [receipt(next, finalRecord)],
          changes: [finalRecord],
          cursor: 2,
        ),
      );
      expect(await store.pendingCount(), 0);
      await store.close();
      store = await open();
      expect((await store.load()).single.data['title'], second.data['title']);
    },
  );

  test(
    'empty outbox pulls remote records without enqueue and preserves full metadata',
    () async {
      final source = remote(todo());
      await pull([source], 1);
      final local = (await store.load()).single;
      expect(local.metadata, source['metadata']);
      expect(await store.pendingCount(), 0);
      await store.close();
      store = await open();
      expect((await store.load()).single.metadata, source['metadata']);
      expect((await prepare())['operations'], isEmpty);
    },
  );

  test('local revision does not become remote base revision', () async {
    final record = todo();
    await pull([remote(record, revision: 12, sequence: 30)], 30);
    final local = (await store.load()).single;
    expect(local.revision, 1);
    await store.save(local.copy(data: {...local.data, 'category': 'life'}));
    expect(operation(await prepare())['baseRevision'], 12);
  });

  test(
    'review drafts remain local and retain outbox while todo ack clears only todo',
    () async {
      await store.save(
        WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-09-28',
          data: {'goalsText': '保留草稿', 'bodyText': '原文'},
        ),
      );
      final local = await store.save(todo());
      final request = await prepare();
      expect((request['operations'] as List).length, 1);
      final record = remote(local);
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), record)],
          cursor: 1,
        ),
      );
      expect(await store.pendingCount(), 1);
      expect((await store.syncStatus())['pendingCount'], 0);
      expect((await prepare())['operations'], isEmpty);
      expect(
        (await store.load())
            .firstWhere((r) => r.kind == 'review_draft')
            .data['bodyText'],
        '原文',
      );
    },
  );

  test(
    'receipt newer than paginated change wins and fixed through excludes new pending',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final latest = remote(
        local.copy(data: {...local.data, 'title': '新版本'}),
        revision: 2,
        sequence: 9,
      );
      final old = remote(local, revision: 1, sequence: 1);
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), latest)],
          changes: [old],
          cursor: 1,
          through: 5,
          hasMore: true,
        ),
      );
      expect((await store.load()).single.data['title'], '新版本');
      final current = (await store.load()).single;
      await store.save(
        current.copy(data: {...current.data, 'category': 'life'}),
      );
      final page2 = await prepare();
      expect(page2['through'], 5);
      expect(page2['operations'], isEmpty);
      await store.applySyncResponse(
        page2,
        response(page2, changes: [remote(todo(), sequence: 5)], cursor: 5),
      );
      final next = operation(await prepare());
      expect(next['baseRevision'], 2);
      expect(next['base']['data']['title'], '新版本');
    },
  );

  test(
    'rebase successor applies only user changes atop merged accepted fields',
    () async {
      final initial = todo();
      await pull([remote(initial)], 1);
      final local = (await store.load()).single;
      final edit = await store.save(
        local.copy(data: {...local.data, 'title': '改标题'}),
      );
      final request = await prepare();
      await store.save(
        edit.copy(data: {...edit.data, 'plannedDate': '2026-10-04'}),
      );
      final accepted = remote(
        edit.copy(data: {...edit.data, 'category': 'life'}),
        revision: 2,
        sequence: 2,
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), accepted)],
          cursor: 2,
        ),
      );
      final current = (await store.load()).single;
      expect(current.data['category'], 'life');
      expect(current.data['plannedDate'], '2026-10-04');
      expect(operation(await prepare())['base']['data']['category'], 'life');
    },
  );

  for (final keepLocal in [true, false]) {
    test(
      'work hours create collision exposes both versions and resolves keepLocal=$keepLocal',
      () async {
        final local = await store.save(
          WorkspaceRecord(
            kind: 'work_log',
            id: '2026-10-03',
            data: {'minutes': 0},
          ),
        );
        final request = await prepare();
        final desktop = remote(
          local.copy(data: {'minutes': 360}),
          revision: 4,
          sequence: 8,
        );
        await store.applySyncResponse(
          request,
          response(
            request,
            receipts: [
              receipt(operation(request), desktop, status: 'conflict'),
            ],
            changes: [desktop],
            cursor: 8,
          ),
        );
        final conflict =
            ((await store.syncStatus())['conflicts'] as List).single;
        expect(conflict['local']['data']['minutes'], 0);
        expect(conflict['remote']['data']['minutes'], 360);
        expect((await prepare())['operations'], isEmpty);
        await store.close();
        store = await open();
        await store.resolveSyncConflict(
          local.kind,
          local.id,
          keepLocal: keepLocal,
        );
        expect((await store.syncStatus())['conflicts'], isEmpty);
        final current = (await store.load()).single;
        expect(current.data['minutes'], keepLocal ? 0 : 360);
        final next = await prepare();
        if (keepLocal) {
          expect(operation(next)['baseRevision'], 4);
          expect(
            operation(next)['operationId'],
            isNot(operation(request)['operationId']),
          );
        } else {
          expect(next['operations'], isEmpty);
          expect(await store.pendingCount(), 0);
        }
      },
    );
  }

  test(
    'conflict keeps subsequent local edit and newest remote choice across pull',
    () async {
      var local = await store.save(todo());
      final request = await prepare();
      final desktop = remote(
        local.copy(data: {...local.data, 'title': '电脑版'}),
        revision: 2,
        sequence: 2,
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), desktop, status: 'conflict')],
          cursor: 2,
        ),
      );
      local = await store.save(
        local.copy(data: {...local.data, 'title': '手机新版'}),
      );
      final latest = remote(
        local.copy(data: {...local.data, 'title': '电脑新版'}),
        revision: 3,
        sequence: 3,
      );
      await pull([latest], 3);
      final conflict = ((await store.syncStatus())['conflicts'] as List).single;
      expect(conflict['local']['data']['title'], '手机新版');
      expect(conflict['remote']['data']['title'], '电脑新版');
      await store.resolveSyncConflict(local.kind, local.id, keepLocal: true);
      expect(operation(await prepare())['baseRevision'], 3);
    },
  );

  test(
    'remote tombstones keep baseline for explicit restore and null differs from zero',
    () async {
      final record = WorkspaceRecord(
        kind: 'work_log',
        id: '2026-10-03',
        deleted: true,
        data: {'minutes': null},
      );
      await pull([remote(record, revision: 7, sequence: 8)], 8);
      final local = (await store.load()).single;
      expect(local.deleted, true);
      expect(local.data['minutes'], isNull);
      await store.save(local.copy(deleted: false, data: {'minutes': 0}));
      final next = operation(await prepare());
      expect(next['baseRevision'], 7);
      expect(next['base']['deleted'], true);
      expect(next['next']['data']['minutes'], 0);
    },
  );

  test(
    'transaction rollback never advances cursor or clears operation after malformed later change',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final first = remote(local);
      final inconsistent = {
        ...first,
        'data': {...local.data, 'title': '同版本不同值'},
      };
      await expectLater(
        store.applySyncResponse(
          request,
          response(
            request,
            receipts: [receipt(operation(request), first)],
            changes: [inconsistent],
            cursor: 1,
          ),
        ),
        throwsFormatException,
      );
      expect((await store.syncStatus())['cursor'], 0);
      expect(await prepare(), request);
      expect((await store.load()).single.data, local.data);
    },
  );

  test(
    'disk failure during acknowledgement rolls back records, queue and cursor',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final raw = await databaseFactoryFfi.openDatabase(dbPath);
      await raw.execute(
        "CREATE TRIGGER fail_state BEFORE INSERT ON workspace_sync_state BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
      );
      final accepted = remote(local);
      await expectLater(
        store.applySyncResponse(
          request,
          response(
            request,
            receipts: [receipt(operation(request), accepted)],
            cursor: 1,
          ),
        ),
        throwsA(isA<DatabaseException>()),
      );
      await raw.execute('DROP TRIGGER fail_state');
      expect((await store.syncStatus())['cursor'], 0);
      expect(operation(await prepare()), operation(request));
      expect((await store.load()).single.metadata, isEmpty);
    },
  );

  test(
    'wrong identity, missing receipts, unmatched receipt and cursor errors fail atomically',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final accepted = remote(local);
      final valid = response(
        request,
        receipts: [receipt(operation(request), accepted)],
        cursor: 1,
      );
      final invalid = [
        {...valid, 'workspaceId': workspaceId()},
        {...valid, 'deviceId': workspaceId()},
        {...valid, 'receipts': []},
        {
          ...valid,
          'receipts': [
            {
              ...receipt(operation(request), accepted),
              'operationId': workspaceId(),
            },
          ],
        },
        {
          ...valid,
          'receipts': [
            {...receipt(operation(request), accepted), 'localRevision': 999},
          ],
        },
        {...valid, 'cursor': 2, 'through': 1},
        {...valid, 'cursor': 0, 'through': 0, 'hasMore': true},
        {
          ...valid,
          'changes': [remote(todo(), sequence: 2)],
        },
      ];
      for (final bad in invalid) {
        await expectLater(
          store.applySyncResponse(request, bad),
          throwsFormatException,
        );
        expect((await store.syncStatus())['cursor'], 0);
        expect(await store.pendingCount(), 1);
      }
      await store.applySyncResponse(request, valid);
      final newer = await prepare();
      await expectLater(
        store.applySyncResponse(newer, response(newer, cursor: 0)),
        throwsFormatException,
      );
      await expectLater(
        store.applySyncResponse(request, valid),
        throwsFormatException,
      );
    },
  );

  test('fixed paging waterline cannot change', () async {
    final request = await prepare();
    await store.applySyncResponse(
      request,
      response(
        request,
        changes: [remote(todo())],
        cursor: 1,
        through: 2,
        hasMore: true,
      ),
    );
    final next = await prepare();
    await expectLater(
      store.applySyncResponse(next, response(next, cursor: 3)),
      throwsFormatException,
    );
    expect((await store.syncStatus())['cursor'], 1);
  });

  test(
    'stale incoming remote changes preserve unsent edits and original conflict baseline',
    () async {
      final original = todo();
      await pull([remote(original)], 1);
      final local = (await store.load()).single;
      await store.save(local.copy(data: {...local.data, 'title': '手机离线版'}));
      final request = await prepare();
      final desktop = remote(
        original.copy(data: {...original.data, 'title': '电脑并发版'}),
        revision: 2,
        sequence: 2,
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), desktop, status: 'conflict')],
          changes: [desktop],
          cursor: 2,
        ),
      );
      expect((await store.load()).single.data['title'], '手机离线版');
      expect((await store.syncStatus())['conflicts'], hasLength(1));
    },
  );

  test(
    'historical long title and 4320 minutes are preserved, only changed values constrained',
    () async {
      final original = todo();
      final legacyTodo = WorkspaceRecord.fromJson({
        ...original.toJson(),
        'data': {...original.data, 'title': '旧' * 1000},
      });
      final legacyLog = WorkspaceRecord.fromJson({
        'kind': 'work_log',
        'id': '2026-10-03',
        'revision': 0,
        'deleted': false,
        'data': {'minutes': 4320},
      });
      await pull([remote(legacyTodo), remote(legacyLog, sequence: 2)], 2);
      final all = await store.load();
      final task = all.firstWhere((r) => r.kind == 'todo');
      await store.save(task.copy(data: {...task.data, 'category': 'life'}));
      await expectLater(
        store.save(task.copy(data: {...task.data, 'title': '新' * 1001})),
        throwsA(anyOf(isA<FormatException>(), isA<WorkspaceConflict>())),
      );
      final log = all.firstWhere((r) => r.kind == 'work_log');
      await expectLater(
        store.save(log.copy(data: {'minutes': 1441})),
        throwsFormatException,
      );
      final corrected = await store.save(log.copy(data: {'minutes': null}));
      expect(corrected.data['minutes'], isNull);
      expect(
        operationFor(await prepare(), 'work_log')['base']['data']['minutes'],
        4320,
      );
    },
  );

  test(
    'read-only range and schedule tasks preserve dates/metadata and reject modification',
    () async {
      final original = todo(day: null);
      final value = remote(original);
      final metadata = workspaceSyncMap(value['metadata']);
      metadata['todo'] = {
        ...workspaceSyncMap(metadata['todo']),
        'dateRange': {
          'startDate': '2026-10-01',
          'endDate': '2026-10-05',
          'name': '出差',
        },
      };
      metadata['editableFields'] = <String>[];
      metadata['deletable'] = false;
      value['metadata'] = metadata;
      await pull([value], 1);
      final local = (await store.load()).single;
      expect(local.appearsOn('2026-10-01', '2026-10-10'), true);
      expect(local.appearsOn('2026-10-10', '2026-10-10'), false);
      await expectLater(
        store.save(local.copy(data: {...local.data, 'title': '不能改'})),
        throwsFormatException,
      );
      await expectLater(
        store.save(local.copy(deleted: true)),
        throwsFormatException,
      );
      expect((await store.load()).single.metadata, metadata);
    },
  );

  test(
    'all persisted private snapshots, baselines, conflicts and binding state are encrypted',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      await store.save(local.copy(data: {...local.data, 'title': '待发送正文'}));
      final raw = await databaseFactoryFfi.openDatabase(dbPath);
      final inflight = (await raw.query('workspace_sync_inflight')).single;
      expect(inflight['payload'], startsWith('test:'));
      final desktop = remote(
        local.copy(data: {...local.data, 'title': '电脑正文'}),
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), desktop, status: 'conflict')],
          cursor: 1,
        ),
      );
      for (final table in [
        'workspace_records',
        'workspace_outbox',
        'workspace_sync_baselines',
        'workspace_sync_conflicts',
        'workspace_sync_state',
      ]) {
        for (final row in await raw.query(table)) {
          expect(row['payload'], startsWith('test:'));
          expect(row['payload'], isNot(contains('正文')));
          if (row['base_payload'] != null) {
            expect(row['base_payload'], startsWith('test:'));
          }
        }
      }
      await raw.close();
    },
  );

  test('old version encrypted records and queue migrate without loss', () async {
    await store.close();
    await databaseFactoryFfi.deleteDatabase(dbPath);
    final original = todo().copy(revision: 7);
    final draft = WorkspaceRecord(
      kind: 'review_draft',
      id: 'weekly:2026-09-28',
      revision: 2,
      data: {'goalsText': '原目标', 'bodyText': '原复盘'},
    );
    final old = await databaseFactoryFfi.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE workspace_records(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))',
          );
          await db.execute(
            'CREATE TABLE workspace_outbox(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL,base_revision INTEGER NOT NULL,local_revision INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(kind,entity_id))',
          );
        },
      ),
    );
    final operationIds = <String>[];
    for (final record in [original, draft]) {
      final legacyJson = record.toJson()..remove('metadata');
      final payload = await TestWorkspaceCipher().encrypt(
        jsonEncode(legacyJson),
      );
      await old.insert('workspace_records', {
        'kind': record.kind,
        'id': record.id,
        'revision': record.revision,
        'payload': payload,
      });
      final opId = workspaceId();
      operationIds.add(opId);
      await old.insert('workspace_outbox', {
        'operation_id': opId,
        'kind': record.kind,
        'entity_id': record.id,
        'base_revision': record.revision - 1,
        'local_revision': record.revision,
        'payload': payload,
      });
    }
    await old.close();
    store = await open();
    expect((await store.load()).map((r) => r.toJson()), [
      original.toJson(),
      draft.toJson(),
    ]);
    expect(await store.pendingCount(), 2);
    expect((await store.syncStatus())['enabled'], false);
    await store.bindSync(macId, phoneId);
    final request = await prepare();
    expect(operation(request)['baseRevision'], 0);
    expect(operation(request)['operationId'], operationIds.first);
    expect(operation(request)['localRevision'], 7);
    expect(operation(request)['base'], isNull);
    final raw = await databaseFactoryFfi.openDatabase(dbPath);
    expect(
      (await raw.query('workspace_outbox')).single['operation_id'],
      operationIds.last,
    );
    await raw.close();
  });

  test(
    'conflict resolution rejects local or remote versions changed since confirmation',
    () async {
      var local = await store.save(todo());
      final request = await prepare();
      final desktop = remote(
        local.copy(data: {...local.data, 'title': '电脑版'}),
        revision: 2,
        sequence: 2,
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), desktop, status: 'conflict')],
          cursor: 2,
        ),
      );
      final shownLocalRevision = local.revision;
      local = await store.save(
        local.copy(data: {...local.data, 'title': '手机后续编辑'}),
      );
      await expectLater(
        store.resolveSyncConflict(
          local.kind,
          local.id,
          keepLocal: false,
          expectedLocalRevision: shownLocalRevision,
          expectedRemoteRevision: 2,
        ),
        throwsA(isA<WorkspaceConflict>()),
      );
      final newDesktop = remote(
        local.copy(data: {...local.data, 'title': '电脑后续编辑'}),
        revision: 3,
        sequence: 3,
      );
      await pull([newDesktop], 3);
      await expectLater(
        store.resolveSyncConflict(
          local.kind,
          local.id,
          keepLocal: true,
          expectedLocalRevision: local.revision,
          expectedRemoteRevision: 2,
        ),
        throwsA(isA<WorkspaceConflict>()),
      );
      final status = await store.syncStatus();
      final conflict = (status['conflicts'] as List).single;
      expect(conflict['local']['data']['title'], '手机后续编辑');
      expect(conflict['remote']['data']['title'], '电脑后续编辑');
      expect((await prepare())['operations'], isEmpty);
      await store.resolveSyncConflict(
        local.kind,
        local.id,
        keepLocal: true,
        expectedLocalRevision: local.revision,
        expectedRemoteRevision: 3,
      );
      expect(operation(await prepare())['baseRevision'], 3);
    },
  );

  test(
    'sendable count excludes conflicts but preserves their pending count',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final desktop = remote(
        local.copy(data: {...local.data, 'title': '电脑冲突版'}),
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), desktop, status: 'conflict')],
          cursor: 1,
        ),
      );
      var status = await store.syncStatus();
      expect(status['pendingCount'], 1);
      expect(status['sendableCount'], 0);
      await store.save(todo());
      status = await store.syncStatus();
      expect(status['pendingCount'], 2);
      expect(status['sendableCount'], 1);
      await prepare();
      expect((await store.syncStatus())['sendableCount'], 1);
    },
  );

  test(
    'smaller immutable retry batch acknowledges only sent operations after restart',
    () async {
      final locals = await store.saveAll([todo(), todo(), todo()]);
      final first = await store.prepareSyncRequest();
      final original = workspaceSyncMap(first['payload']);
      final originalOperations = (original['operations'] as List)
          .map(workspaceSyncMap)
          .toList();
      expect(originalOperations, hasLength(3));
      await store.close();
      store = await open();
      final retry = await store.prepareSyncRequest(operationLimit: 1);
      final subset = workspaceSyncMap(retry['payload']);
      expect(retry['counter'], (first['counter'] as int) + 1);
      expect(operation(subset), originalOperations.first);
      final accepted = remote(locals.first);
      await store.applySyncResponse(
        subset,
        response(
          subset,
          receipts: [receipt(operation(subset), accepted)],
          changes: [accepted],
          cursor: 1,
        ),
      );
      expect(await store.pendingCount(), 2);
      await store.close();
      store = await open();
      final remaining = workspaceSyncMap(
        (await store.prepareSyncRequest(operationLimit: 1))['payload'],
      );
      expect(operation(remaining), originalOperations[1]);
      expect((await store.syncStatus())['sendableCount'], 2);
      await expectLater(
        store.prepareSyncRequest(operationLimit: 0),
        throwsFormatException,
      );
      await expectLater(
        store.prepareSyncRequest(operationLimit: 101),
        throwsFormatException,
      );
    },
  );

  test(
    'keeping local after a simple todo deletion makes a new UUID and preserves tombstone',
    () async {
      final original = todo();
      final metadata = {
        'todo': {
          'id': original.id,
          ...original.data,
          'source': 'manual',
          'trackingMode': 'checklist',
          'progress': 0,
          'projectId': null,
          'stageKey': null,
          'dateRange': null,
        },
        'editableFields': workspaceTodoFields.toList(),
        'deletable': true,
      };
      await pull([remote(original, metadata: metadata)], 1);
      final current = (await store.load()).single;
      final edited = await store.save(
        current.copy(data: {...current.data, 'title': '保留此离线修改'}),
      );
      final request = await prepare();
      final deletedMetadata = {
        ...metadata,
        'todo': {
          ...workspaceSyncMap(metadata['todo']),
          'dismissedAt': '2026-10-03T12:00:00Z',
        },
      };
      final tombstone = remote(
        original.copy(deleted: true),
        revision: 2,
        sequence: 2,
        metadata: deletedMetadata,
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [
            receipt(operation(request), tombstone, status: 'conflict'),
          ],
          cursor: 2,
        ),
      );
      await store.resolveSyncConflict(
        original.kind,
        original.id,
        keepLocal: true,
        expectedLocalRevision: edited.revision,
        expectedRemoteRevision: 2,
      );
      final records = await store.load();
      final old = records.singleWhere((r) => r.id == original.id);
      final copy = records.singleWhere((r) => r.id != original.id);
      expect(old.deleted, true);
      expect(old.metadata, deletedMetadata);
      expect(copy.data, edited.data);
      expect(copy.metadata, isEmpty);
      expect(copy.revision, 1);
      expect((await store.syncStatus())['conflicts'], isEmpty);
      final next = operation(await prepare());
      expect(next['id'], copy.id);
      expect(next['baseRevision'], 0);
      expect(next['base'], isNull);
      await store.close();
      store = await open();
      expect((await store.load()).where((r) => !r.deleted), hasLength(1));
    },
  );

  for (final complexField in [
    {'projectId': 'keep-project'},
    {'stageKey': 'copy'},
    {'segment': 'morning'},
    {'isExtra': true},
    {'trackingMode': 'progress'},
    {'progress': 35},
    {'source': 'schedule'},
    {
      'dateRange': {
        'startDate': '2026-10-01',
        'endDate': '2026-10-04',
        'name': '范围',
      },
    },
  ]) {
    test(
      'complex deletion conflict retains both versions rather than degrading $complexField',
      () async {
        final original = todo();
        final plainTodo = {
          'id': original.id,
          ...original.data,
          'source': 'manual',
          'trackingMode': 'checklist',
          'progress': 0,
        };
        final metadata = {
          'todo': plainTodo,
          'editableFields': workspaceTodoFields.toList(),
          'deletable': true,
        };
        await pull([remote(original, metadata: metadata)], 1);
        final local = (await store.load()).single;
        final edited = await store.save(
          local.copy(data: {...local.data, 'title': '离线修改'}),
        );
        final request = await prepare();
        final tombstone = remote(
          original.copy(deleted: true),
          revision: 2,
          sequence: 2,
          metadata: {
            ...metadata,
            'todo': {...plainTodo, ...complexField},
          },
        );
        await store.applySyncResponse(
          request,
          response(
            request,
            receipts: [
              receipt(operation(request), tombstone, status: 'conflict'),
            ],
            cursor: 2,
          ),
        );
        await expectLater(
          store.resolveSyncConflict(
            local.kind,
            local.id,
            keepLocal: true,
            expectedLocalRevision: edited.revision,
            expectedRemoteRevision: 2,
          ),
          throwsFormatException,
        );
        expect((await store.load()).single.data['title'], '离线修改');
        expect((await store.syncStatus())['conflicts'], hasLength(1));
        expect((await store.syncStatus())['sendableCount'], 0);
      },
    );
  }

  test(
    'deleted copy eligibility checks old local metadata even if remote clears attributes',
    () {
      final original = todo();
      final plain = WorkspaceRecord.fromJson({
        ...original.toJson(),
        'metadata': {
          'todo': {
            'source': 'manual',
            'trackingMode': 'checklist',
            'progress': 0,
          },
        },
      });
      final local = plain.copy(
        metadata: {
          'todo': {'source': 'manual', 'projectId': 'old-project'},
        },
      );
      expect(
        workspaceCanCopyDeletedTodo(local, plain.copy(deleted: true)),
        false,
      );
    },
  );

  test(
    'load rejects missing successor queue even with a valid older in-flight operation',
    () async {
      final local = await store.save(todo());
      await prepare();
      await store.save(local.copy(data: {...local.data, 'title': '在途后继'}));
      final raw = await databaseFactoryFfi.openDatabase(dbPath);
      await raw.delete('workspace_outbox');
      await expectLater(store.load(), throwsFormatException);
    },
  );

  test(
    'new pull rejects desktop history older than an acknowledged record beyond old waterline',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final early = remote(local);
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), early)],
          changes: [early],
          cursor: 1,
          through: 5,
          hasMore: true,
        ),
      );
      final latestLocal = (await store.load()).single;
      await store.save(
        latestLocal.copy(data: {...latestLocal.data, 'title': '后续编辑'}),
      );
      final fixed = await prepare();
      expect(fixed['operations'], isEmpty);
      await store.applySyncResponse(
        fixed,
        response(fixed, changes: [remote(todo(), sequence: 5)], cursor: 5),
      );
      final write = await prepare();
      final latest = remote(
        (await store.load()).singleWhere((item) => item.id == local.id),
        revision: 9,
        sequence: 9,
      );
      await store.applySyncResponse(
        write,
        response(
          write,
          receipts: [receipt(operation(write), latest)],
          cursor: 5,
          through: 9,
          hasMore: true,
        ),
      );
      final paging = await prepare();
      await store.applySyncResponse(
        paging,
        response(paging, changes: [latest], cursor: 9),
      );
      expect((await store.syncStatus())['cursor'], 9);
      final restored = await prepare();
      await expectLater(
        store.applySyncResponse(restored, response(restored, cursor: 8)),
        throwsFormatException,
      );
      expect((await store.syncStatus())['cursor'], 9);
    },
  );

  test(
    'known receipt sequence prevents silent backup rollback while paginated cursor is older',
    () async {
      final first = await store.save(todo());
      final second = await store.save(todo());
      await store.prepareSyncRequest();
      final subset = workspaceSyncMap(
        (await store.prepareSyncRequest(operationLimit: 1))['payload'],
      );
      final firstRemote = remote(first);
      await store.applySyncResponse(
        subset,
        response(
          subset,
          receipts: [receipt(operation(subset), firstRemote)],
          changes: [firstRemote],
          cursor: 1,
          through: 5,
          hasMore: true,
        ),
      );
      final fixed = workspaceSyncMap(
        (await store.prepareSyncRequest(operationLimit: 1))['payload'],
      );
      expect(fixed['through'], 5);
      final secondRemote = remote(second, revision: 9, sequence: 9);
      await store.applySyncResponse(
        fixed,
        response(
          fixed,
          receipts: [receipt(operation(fixed), secondRemote)],
          changes: [remote(todo(), sequence: 5)],
          cursor: 5,
          through: 5,
        ),
      );
      final before = await store.syncStatus();
      expect(before['cursor'], 5);
      final next = await prepare();
      await expectLater(
        store.applySyncResponse(next, response(next, cursor: 8)),
        throwsFormatException,
      );
      expect((await store.syncStatus())['cursor'], 5);
      expect(
        (await store.load()).singleWhere((r) => r.id == second.id).metadata,
        secondRemote['metadata'],
      );
      await store.applySyncResponse(
        next,
        response(next, changes: [secondRemote], cursor: 9),
      );
      expect((await store.syncStatus())['cursor'], 9);
    },
  );

  test(
    'terminal response cannot skip changes while advancing cursor',
    () async {
      final request = await prepare();
      await expectLater(
        store.applySyncResponse(request, response(request, cursor: 8)),
        throwsFormatException,
      );
      expect((await store.syncStatus())['cursor'], 0);
      final local = await store.save(todo());
      final write = await prepare();
      final accepted = remote(local);
      final bad = response(
        write,
        receipts: [receipt(operation(write), accepted)],
        cursor: 1,
      )..['changes'] = [];
      await expectLater(
        store.applySyncResponse(write, bad),
        throwsFormatException,
      );
      expect((await store.syncStatus())['cursor'], 0);
      expect(await store.pendingCount(), 1);
    },
  );

  test(
    'no-op acknowledgement accepts equal base revision without losing metadata',
    () async {
      final original = todo();
      final same = remote(original, revision: 5, sequence: 5);
      await pull([same], 5);
      final local = (await store.load()).single;
      await store.save(local);
      final request = await prepare();
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), same)],
          cursor: 5,
        ),
      );
      expect(await store.pendingCount(), 0);
      expect((await store.load()).single.metadata, same['metadata']);
    },
  );

  test(
    'receipt-only page advances operation state then pulls at the fixed waterline',
    () async {
      final local = await store.save(todo());
      final request = await prepare();
      final accepted = remote(local);
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), accepted)],
          cursor: 0,
          through: 1,
          hasMore: true,
        ),
      );
      expect(await store.pendingCount(), 0);
      final next = await prepare();
      expect(next['through'], 1);
      expect(next['operations'], isEmpty);
      await store.applySyncResponse(
        next,
        response(next, changes: [accepted], cursor: 1),
      );
      expect((await store.syncStatus())['through'], isNull);
    },
  );

  test(
    'hours entered while a clear is in flight survive normalized remote tombstone',
    () async {
      final original = WorkspaceRecord(
        kind: 'work_log',
        id: '2026-10-03',
        data: {'minutes': 120},
      );
      await pull([remote(original)], 1);
      final local = (await store.load()).single;
      final cleared = await store.save(local.copy(data: {'minutes': null}));
      final request = await prepare();
      await store.save(cleared.copy(data: {'minutes': 360}, deleted: false));
      final tombstone = remote(
        cleared.copy(deleted: true),
        revision: 2,
        sequence: 2,
      );
      await store.applySyncResponse(
        request,
        response(
          request,
          receipts: [receipt(operation(request), tombstone)],
          cursor: 2,
        ),
      );
      final current = (await store.load()).single;
      expect(current.deleted, false);
      expect(current.data['minutes'], 360);
      final next = operation(await prepare());
      expect(next['base']['deleted'], true);
      expect(next['next']['deleted'], false);
      expect(next['next']['data']['minutes'], 360);
    },
  );

  test(
    'UTC second, millisecond and microsecond values retain their wire spelling',
    () {
      for (final timestamp in [
        '2026-10-03T18:30:00Z',
        '2026-10-03T18:30:00.000Z',
        '2026-10-03T18:30:00.123456Z',
      ]) {
        final original = todo();
        final record = original.copy(
          data: {...original.data, 'completedAt': timestamp},
        );
        expect(record.data['completedAt'], timestamp);
      }
      final original = todo();
      expect(
        () => original.copy(
          data: {...original.data, 'completedAt': '2026-02-30T18:30:00Z'},
        ),
        throwsFormatException,
      );
    },
  );

  test(
    'request batches at 100 and response cannot confirm a different payload',
    () async {
      await store.saveAll(List.generate(101, (_) => todo()));
      final request = await prepare();
      expect(request['operations'], hasLength(100));
      final forged = workspaceSyncMap(jsonDecode(jsonEncode(request)));
      forged['operations'][0]['next']['data']['title'] = '伪造负载';
      final receipts = <Map<String, dynamic>>[];
      for (final value in forged['operations'] as List) {
        final op = workspaceSyncMap(value);
        final local = WorkspaceRecord.fromJson({
          'kind': op['kind'],
          'id': op['id'],
          'revision': op['localRevision'],
          ...workspaceSyncMap(op['next']),
        });
        receipts.add(receipt(op, remote(local, sequence: receipts.length + 1)));
      }
      await expectLater(
        store.applySyncResponse(
          forged,
          response(forged, receipts: receipts, cursor: 100),
        ),
        throwsFormatException,
      );
      expect(await store.pendingCount(), 101);
    },
  );
}

Map<String, dynamic> operationFor(Map<String, dynamic> request, String kind) =>
    workspaceSyncMap(
      (request['operations'] as List).firstWhere(
        (value) => value['kind'] == kind,
      ),
    );
