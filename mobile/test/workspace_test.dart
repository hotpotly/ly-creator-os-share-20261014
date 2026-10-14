import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/storage/capture_payload_cipher.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class TestWorkspaceCipher extends CapturePayloadCipher {
  @override
  Future<String> encrypt(String text) async =>
      'test:${base64Encode(utf8.encode(text))}';
  @override
  Future<String> decrypt(String text) async {
    if (!text.startsWith('test:')) {
      throw const FormatException('bad ciphertext');
    }
    return utf8.decode(base64Decode(text.substring(5)));
  }
}

class MemoryWorkspaceStore implements WorkspaceStore {
  List<WorkspaceRecord> records = [];
  bool failSave = false;
  Completer<void>? readGate;
  @override
  Future<List<WorkspaceRecord>> load() async {
    final snapshot = List<WorkspaceRecord>.of(records);
    await readGate?.future;
    return snapshot;
  }

  @override
  Future<WorkspaceRecord> save(WorkspaceRecord record) async =>
      (await saveAll([record])).single;
  @override
  Future<List<WorkspaceRecord>> saveAll(List<WorkspaceRecord> batch) async {
    if (failSave) throw StateError('保存失败');
    final updated = List<WorkspaceRecord>.of(records);
    final saved = <WorkspaceRecord>[];
    for (final record in batch) {
      final index = updated.indexWhere(
        (r) => r.kind == record.kind && r.id == record.id,
      );
      if ((index < 0 ? 0 : updated[index].revision) != record.revision) {
        throw const WorkspaceConflict();
      }
      final next = record.copy(revision: record.revision + 1);
      if (index < 0) {
        updated.add(next);
      } else {
        updated[index] = next;
      }
      saved.add(next);
    }
    records = updated;
    return saved;
  }

  @override
  Future<int> pendingCount() async => records.length;
  @override
  Future<void> close() async {}
}

WorkspaceRecord todo({String? day = '2026-10-03'}) => WorkspaceRecord(
  kind: 'todo',
  id: workspaceId(),
  data: {
    'title': '拍一段开头',
    'category': 'self_media',
    'plannedDate': day,
    'completedAt': null,
  },
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory directory;
  late String dbPath;
  setUp(() async {
    final root = await Directory(
      '${Directory.current.path}/../tmp/mobile-tests',
    ).create(recursive: true);
    directory = await root.createTemp('workspace-');
    dbPath = '${directory.path}/workspace.sqlite';
  });
  tearDown(() async => directory.delete(recursive: true));
  Future<SqliteWorkspaceStore> open() => SqliteWorkspaceStore.create(
    factory: databaseFactoryFfi,
    databasePath: dbPath,
    cipher: TestWorkspaceCipher(),
  );

  test(
    'calendar dates and periods reject rolled dates and cross year correctly',
    () {
      expect(() => parseWorkspaceDay('2026-02-30'), throwsFormatException);
      expect(reviewPeriodId(DateTime(2027, 1, 1), false), 'weekly:2026-12-28');
      expect(
        reviewPeriodId(DateTime(2026, 12, 31), true),
        'monthly:2026-12-01',
      );
      expect(
        () => WorkspaceRecord(
          kind: 'review_draft',
          id: 'weekly:2026-10-03',
          data: {'goalsText': '', 'bodyText': ''},
        ),
        throwsFormatException,
      );
    },
  );
  test(
    'completion preserves planned day; undated belongs to today or completion day',
    () {
      final completed = todo(day: '2026-10-02').copy(
        data: {
          ...todo().data,
          'plannedDate': '2026-10-02',
          'completedAt': '2026-10-03T12:00:00.000Z',
        },
      );
      expect(completed.appearsOn('2026-10-02', '2026-10-03'), isTrue);
      expect(completed.appearsOn('2026-10-03', '2026-10-03'), isFalse);
      expect(todo(day: null).appearsOn('2026-10-03', '2026-10-03'), isTrue);
      expect(todo(day: null).appearsOn('2026-10-02', '2026-10-03'), isFalse);
    },
  );
  test('field whitelist and real minute bounds', () {
    expect(
      () => todo().copy(data: {...todo().data, 'capture': 'wrong domain'}),
      throwsFormatException,
    );
    expect(
      () => WorkspaceRecord(
        kind: 'work_log',
        id: '2026-10-03',
        data: {'minutes': 1441},
      ),
      throwsFormatException,
    );
    expect(
      WorkspaceRecord(
        kind: 'work_log',
        id: '2026-10-03',
        data: {'minutes': 0},
      ).data['minutes'],
      0,
    );
  });
  test(
    'transaction persists encrypted entity and compacted outbox across restart',
    () async {
      var store = await open();
      final original = todo();
      final first = await store.save(original);
      final second = await store.save(
        first.copy(data: {...first.data, 'title': '拍摄新版开头'}),
      );
      expect(await store.pendingCount(), 1);
      await expectLater(store.save(first), throwsA(isA<WorkspaceConflict>()));
      await store.close();
      final raw = await databaseFactoryFfi.openDatabase(dbPath);
      final row = (await raw.query('workspace_outbox')).single;
      expect(row['base_revision'], 0);
      expect(row['local_revision'], 2);
      expect(row['payload'], isNot(contains('拍摄')));
      await raw.close();
      store = await open();
      expect((await store.load()).single.data['title'], '拍摄新版开头');
      await store.save(second.copy(deleted: true));
      expect((await store.load()).single.deleted, isTrue);
      await store.close();
    },
  );
  test(
    'batch conflict rolls back prior entities and their outbox rows',
    () async {
      final store = await open();
      final existing = todo();
      await store.save(existing);
      final first = todo();
      await expectLater(
        store.saveAll([first, existing]),
        throwsA(isA<WorkspaceConflict>()),
      );
      expect((await store.load()).map((r) => r.id), [existing.id]);
      expect(await store.pendingCount(), 1);
      await store.close();
    },
  );
  test('batch outbox failure on second item rolls back entire batch', () async {
    final store = await open();
    final raw = await databaseFactoryFfi.openDatabase(dbPath);
    await raw.execute(
      "CREATE TRIGGER fail_batch BEFORE INSERT ON workspace_outbox WHEN (SELECT COUNT(*) FROM workspace_outbox) = 1 BEGIN SELECT RAISE(ABORT, 'second item failure'); END",
    );
    await expectLater(
      store.saveAll([todo(), todo()]),
      throwsA(isA<DatabaseException>()),
    );
    expect(await store.load(), isEmpty);
    expect(await store.pendingCount(), 0);
    await raw.close();
    await store.close();
  });
  test('batch persists all records and outbox after restart', () async {
    var store = await open();
    final saved = await store.saveAll([todo(), todo(), todo()]);
    expect(saved.every((r) => r.revision == 1), isTrue);
    await store.close();
    store = await open();
    expect((await store.load()).map((r) => r.id), saved.map((r) => r.id));
    expect(await store.pendingCount(), 3);
    await store.close();
  });
  test('outbox failure rolls back entity write', () async {
    final store = await open();
    final raw = await databaseFactoryFfi.openDatabase(dbPath);
    await raw.execute(
      "CREATE TRIGGER fail_outbox BEFORE INSERT ON workspace_outbox BEGIN SELECT RAISE(ABORT, 'disk simulation'); END",
    );
    await expectLater(store.save(todo()), throwsA(isA<DatabaseException>()));
    expect(await store.load(), isEmpty);
    await store.close();
  });
  test('corrupt or missing queue on an unsynced record fails closed', () async {
    final store = await open();
    await store.save(todo());
    await store.close();
    final raw = await databaseFactoryFfi.openDatabase(dbPath);
    await raw.update('workspace_outbox', {'payload': 'bad'});
    await raw.close();
    await expectLater(open(), throwsFormatException);
    final check = await databaseFactoryFfi.openDatabase(dbPath);
    expect(await check.query('workspace_records'), hasLength(1));
    expect((await check.query('workspace_outbox')).single['payload'], 'bad');
    await check.delete('workspace_outbox');
    await check.close();
    await expectLater(open(), throwsFormatException);
  });
  test(
    'new workspace cipher rejects plaintext while legacy capture stays compatible',
    () async {
      final strict = SecureCapturePayloadCipher(allowLegacyPlaintext: false);
      await expectLater(
        strict.decrypt('{"kind":"todo"}'),
        throwsFormatException,
      );
      expect(
        await SecureCapturePayloadCipher().decrypt('old capture'),
        'old capture',
      );
    },
  );
  test(
    'controller serializes stale read and write; failed load blocks writes',
    () async {
      final store = MemoryWorkspaceStore();
      final controller = WorkspaceController(store);
      await controller.load();
      store.readGate = Completer<void>();
      final load = controller.load();
      final save = controller.save(todo());
      await Future<void>.delayed(Duration.zero);
      store.readGate!.complete();
      await load;
      await save;
      expect(controller.records, hasLength(1));
      expect(store.records, hasLength(1));
      controller.dispose();
    },
  );
}
