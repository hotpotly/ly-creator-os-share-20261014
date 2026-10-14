import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/capture_entry.dart';
import 'package:ly_creator_capture/src/storage/capture_payload_cipher.dart';
import 'package:ly_creator_capture/src/storage/sqlite_capture_store.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class TestCipher implements CapturePayloadCipher {
  @override
  Future<void> prepare({required bool hasEncryptedData}) async {}

  @override
  Future<String> decrypt(String payload) async {
    if (!payload.startsWith('test-encrypted:')) {
      throw const FormatException('payload was not encrypted');
    }
    return utf8.decode(
      base64Decode(payload.substring('test-encrypted:'.length)),
    );
  }

  @override
  Future<String> encrypt(String plaintext) async =>
      'test-encrypted:${base64Encode(utf8.encode(plaintext))}';
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late Directory directory;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    directory = await Directory.systemTemp.createTemp('ly-capture-sqlite-');
  });

  tearDown(() async {
    await directory.delete(recursive: true);
  });

  test(
    'persists encrypted long-lived records and restores the active draft',
    () async {
      final preferences = await SharedPreferences.getInstance();
      final databasePath = '${directory.path}/captures.sqlite';
      final store = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: databasePath,
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      final entry = CaptureEntry(
        id: 'stable-record-id',
        title: '本地标题',
        content: '离线原文',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.pending,
        sourceApp: 'com.example.browser',
        sourceUrl: 'https://example.com/story',
      );
      await store.save([entry]);
      await store.saveDraft('未提交草稿');
      await store.close();

      final rawDatabase = await databaseFactoryFfi.openDatabase(databasePath);
      final rawRows = await rawDatabase.query('capture_entries');
      expect(rawRows.single['payload_json'], isNot(contains('离线原文')));
      final draftRows = await rawDatabase.query(
        'app_state',
        where: 'key = ?',
        whereArgs: ['active_text_draft'],
      );
      expect(draftRows.single['value'], isNot(contains('未提交草稿')));
      await rawDatabase.close();

      final restored = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: databasePath,
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      expect((await restored.load()).single.toJson(), entry.toJson());
      expect(await restored.loadDraft(), '未提交草稿');
      await restored.close();
    },
  );

  test(
    'upgrades the local database and persists stage C lifecycle fields',
    () async {
      final preferences = await SharedPreferences.getInstance();
      final databasePath = '${directory.path}/captures.sqlite';
      final legacy = await databaseFactoryFfi.openDatabase(
        databasePath,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (database, _) async {
            await database.execute('''
            CREATE TABLE capture_entries(
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            )
          ''');
            await database.execute('''
            CREATE TABLE app_state(
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          ''');
          },
        ),
      );
      await legacy.close();

      final store = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: databasePath,
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      final entry = CaptureEntry(
        id: 'stage-c-record',
        content: '长期资料库',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.synced,
        notes: '追加后的完整备注',
        notesRevision: 3,
        notesSyncedRevision: 2,
        noteSyncError: '等待主Mac',
        desktopCaptureId: 'desktop-stage-c',
        deletedAt: DateTime.utc(2026, 7, 26),
        localCopyRemovedAt: DateTime.utc(2026, 7, 27),
      );
      await store.upsert(entry);
      await store.close();

      final raw = await databaseFactoryFfi.openDatabase(databasePath);
      expect(
        await raw.query(
          'sqlite_master',
          where: 'type = ? AND name = ?',
          whereArgs: ['table', 'diagnostic_events'],
        ),
        hasLength(1),
      );
      await raw.close();

      final restored = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: databasePath,
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      expect((await restored.load()).single.toJson(), entry.toJson());
      await restored.deleteById(entry.id);
      expect(await restored.load(), isEmpty);
      await restored.close();
    },
  );

  test(
    'does not delete a corrupt legacy queue before it can be recovered',
    () async {
      SharedPreferences.setMockInitialValues({
        'creator_capture_queue_v1': '{not-json',
      });
      final preferences = await SharedPreferences.getInstance();
      final store = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: '${directory.path}/captures.sqlite',
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      expect(preferences.getString('creator_capture_queue_v1'), '{not-json');
      await store.close();
    },
  );

  test('an unreadable row survives later saves of readable records', () async {
    final preferences = await SharedPreferences.getInstance();
    final databasePath = '${directory.path}/captures.sqlite';
    final original = CaptureEntry(
      id: 'readable',
      content: '可读记录',
      hint: CaptureHint.auto,
      createdAt: DateTime.utc(2026, 7, 25),
      syncState: CaptureSyncState.pending,
    );
    final first = await SqliteCaptureStore.create(
      factory: databaseFactoryFfi,
      databasePath: databasePath,
      legacyPreferences: preferences,
      payloadCipher: TestCipher(),
    );
    await first.save([original]);
    await first.close();

    final raw = await databaseFactoryFfi.openDatabase(databasePath);
    await raw.insert('capture_entries', {
      'id': 'unreadable',
      'created_at': '2026-07-25T01:00:00.000Z',
      'updated_at': '2026-07-25T01:00:00.000Z',
      'payload_json': 'broken-ciphertext',
    });
    await raw.close();

    final reopened = await SqliteCaptureStore.create(
      factory: databaseFactoryFfi,
      databasePath: databasePath,
      legacyPreferences: preferences,
      payloadCipher: TestCipher(),
    );
    expect((await reopened.load()).map((entry) => entry.id), ['readable']);
    await reopened.save([original.copyWith(title: '只更新可读记录')]);
    await reopened.close();

    final verified = await databaseFactoryFfi.openDatabase(databasePath);
    expect(
      await verified.query(
        'capture_entries',
        where: 'id = ?',
        whereArgs: ['unreadable'],
      ),
      hasLength(1),
    );
    await verified.close();
  });

  test('legacy migration is all-or-nothing when one item is corrupt', () async {
    final valid = CaptureEntry(
      id: 'legacy-valid',
      content: '旧记录',
      hint: CaptureHint.auto,
      createdAt: DateTime.utc(2026, 7, 25),
      syncState: CaptureSyncState.pending,
    );
    final rawLegacy = jsonEncode([
      valid.toJson(),
      {'id': 'broken-item'},
    ]);
    SharedPreferences.setMockInitialValues({
      'creator_capture_queue_v1': rawLegacy,
    });
    final preferences = await SharedPreferences.getInstance();
    final store = await SqliteCaptureStore.create(
      factory: databaseFactoryFfi,
      databasePath: '${directory.path}/captures.sqlite',
      legacyPreferences: preferences,
      payloadCipher: TestCipher(),
    );
    expect(await store.load(), isEmpty);
    expect(preferences.getString('creator_capture_queue_v1'), rawLegacy);
    await store.close();
  });

  test(
    'coordinates foreground and headless workers with a renewable SQLite lease',
    () async {
      final preferences = await SharedPreferences.getInstance();
      final databasePath = '${directory.path}/captures.sqlite';
      final foreground = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: databasePath,
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      final headless = await SqliteCaptureStore.create(
        factory: databaseFactoryFfi,
        databasePath: databasePath,
        legacyPreferences: preferences,
        payloadCipher: TestCipher(),
      );
      final now = DateTime.now().toUtc();

      expect(
        await foreground.tryAcquireLease(
          'sync',
          'foreground',
          now.add(const Duration(minutes: 2)),
        ),
        isTrue,
      );
      expect(
        await headless.tryAcquireLease(
          'sync',
          'headless',
          now.add(const Duration(minutes: 2)),
        ),
        isFalse,
      );
      expect(
        await foreground.tryAcquireLease(
          'sync',
          'foreground',
          now.add(const Duration(minutes: 4)),
        ),
        isTrue,
      );
      await headless.releaseLease('sync', 'headless');
      expect(
        await headless.tryAcquireLease(
          'sync',
          'headless',
          now.add(const Duration(minutes: 2)),
        ),
        isFalse,
      );
      await foreground.releaseLease('sync', 'foreground');
      expect(
        await headless.tryAcquireLease(
          'sync',
          'headless',
          now.add(const Duration(minutes: 2)),
        ),
        isTrue,
      );

      await headless.close();
      await foreground.close();
    },
  );
}
