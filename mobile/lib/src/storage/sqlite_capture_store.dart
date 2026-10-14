import 'dart:convert';

import 'package:path/path.dart' as path;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../model/capture_entry.dart';
import 'capture_payload_cipher.dart';
import 'capture_store.dart';

class SqliteCaptureStore extends CaptureStore {
  SqliteCaptureStore._(
    this._database,
    this._legacyPreferences,
    this._payloadCipher,
  );

  static const _legacyQueueKey = 'creator_capture_queue_v1';
  static const _draftKey = 'active_text_draft';
  static const _syncPausedKey = 'sync_paused';
  static const _legacyMigrationKey = 'legacy_queue_v1_migrated';
  static const _leaseKeyPrefix = 'queue_lease:';

  final Database _database;
  final SharedPreferences _legacyPreferences;
  final CapturePayloadCipher _payloadCipher;

  static Future<SqliteCaptureStore> create({
    DatabaseFactory? factory,
    String? databasePath,
    SharedPreferences? legacyPreferences,
    CapturePayloadCipher? payloadCipher,
  }) async {
    final selectedFactory = factory ?? databaseFactory;
    final selectedPath =
        databasePath ??
        path.join(await getDatabasesPath(), 'ly_creator_capture.sqlite');
    final preferences =
        legacyPreferences ?? await SharedPreferences.getInstance();
    final database = await selectedFactory.openDatabase(
      selectedPath,
      options: OpenDatabaseOptions(
        version: 2,
        onConfigure: (database) async {
          await database.execute('PRAGMA foreign_keys = ON');
          await database.rawQuery('PRAGMA journal_mode = WAL');
          await database.execute('PRAGMA synchronous = FULL');
        },
        onCreate: (database, _) async {
          await database.execute('''
            CREATE TABLE capture_entries(
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            )
          ''');
          await database.execute(
            'CREATE INDEX capture_entries_created_at_idx ON capture_entries(created_at DESC)',
          );
          await database.execute('''
            CREATE TABLE app_state(
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          ''');
          await database.execute('''
            CREATE TABLE diagnostic_events(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_code TEXT NOT NULL,
              created_at TEXT NOT NULL
            )
          ''');
        },
        onUpgrade: (database, oldVersion, newVersion) async {
          if (oldVersion < 2) {
            await database.execute('''
              CREATE TABLE IF NOT EXISTS diagnostic_events(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_code TEXT NOT NULL,
                created_at TEXT NOT NULL
              )
            ''');
          }
        },
      ),
    );
    final selectedCipher = payloadCipher ?? SecureCapturePayloadCipher();
    final encryptedRecordCount =
        Sqflite.firstIntValue(
          await database.rawQuery(
            "SELECT COUNT(*) FROM capture_entries WHERE payload_json LIKE 'enc:v1:%'",
          ),
        ) ??
        0;
    final encryptedDraftCount =
        Sqflite.firstIntValue(
          await database.rawQuery(
            "SELECT COUNT(*) FROM app_state WHERE key = ? AND value LIKE 'enc:v1:%'",
            [_draftKey],
          ),
        ) ??
        0;
    await selectedCipher.prepare(
      hasEncryptedData: encryptedRecordCount + encryptedDraftCount > 0,
    );
    final store = SqliteCaptureStore._(database, preferences, selectedCipher);
    await store._migrateLegacyQueue();
    return store;
  }

  @override
  Future<List<CaptureEntry>> load() async {
    final rows = await _database.query(
      'capture_entries',
      columns: ['payload_json'],
      orderBy: 'created_at DESC',
    );
    final entries = <CaptureEntry>[];
    for (final row in rows) {
      try {
        final clear = await _payloadCipher.decrypt(
          row['payload_json']! as String,
        );
        final decoded = jsonDecode(clear);
        if (decoded is Map<String, dynamic>) {
          entries.add(CaptureEntry.fromJson(decoded.cast<String, Object?>()));
        }
      } catch (_) {
        // 保留损坏行供诊断，不用一次解析失败清空其他长期记录。
      }
    }
    return entries;
  }

  @override
  Future<void> save(List<CaptureEntry> entries) async {
    await _database.transaction((transaction) async {
      // save只负责更新/插入；即使某一行暂时无法解密，
      // 后续保存其他记录也不能把那行原始密文永久删除。
      for (final entry in entries) {
        final updatedAt = entry.updatedAt ?? entry.createdAt;
        final payload = await _payloadCipher.encrypt(
          jsonEncode(entry.toJson()),
        );
        await transaction.insert('capture_entries', {
          'id': entry.id,
          'created_at': entry.createdAt.toUtc().toIso8601String(),
          'updated_at': updatedAt.toUtc().toIso8601String(),
          'payload_json': payload,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
    });
  }

  @override
  Future<void> upsert(CaptureEntry entry) async {
    final updatedAt = entry.updatedAt ?? entry.createdAt;
    final payload = await _payloadCipher.encrypt(jsonEncode(entry.toJson()));
    await _database.insert('capture_entries', {
      'id': entry.id,
      'created_at': entry.createdAt.toUtc().toIso8601String(),
      'updated_at': updatedAt.toUtc().toIso8601String(),
      'payload_json': payload,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<CaptureEntry?> loadById(String id) async {
    final rows = await _database.query(
      'capture_entries',
      columns: ['payload_json'],
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    try {
      final clear = await _payloadCipher.decrypt(
        rows.single['payload_json']! as String,
      );
      final decoded = jsonDecode(clear);
      return decoded is Map<String, dynamic>
          ? CaptureEntry.fromJson(decoded.cast<String, Object?>())
          : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> deleteById(String id) =>
      _database.delete('capture_entries', where: 'id = ?', whereArgs: [id]);

  @override
  Future<bool> tryAcquireLease(String name, String owner, DateTime expiresAt) {
    final key = '$_leaseKeyPrefix$name';
    return _database.transaction((transaction) async {
      final rows = await transaction.query(
        'app_state',
        columns: ['value'],
        where: 'key = ?',
        whereArgs: [key],
        limit: 1,
      );
      if (rows.isNotEmpty) {
        try {
          final decoded = jsonDecode(rows.single['value']! as String);
          if (decoded is Map<String, dynamic>) {
            final currentOwner = decoded['owner'] as String?;
            final currentExpiry = DateTime.tryParse(
              decoded['expiresAt'] as String? ?? '',
            );
            if (currentOwner != owner &&
                currentExpiry != null &&
                currentExpiry.isAfter(DateTime.now().toUtc())) {
              return false;
            }
          }
        } catch (_) {
          // A malformed/legacy lease is treated as expired.
        }
      }
      await transaction.insert('app_state', {
        'key': key,
        'value': jsonEncode({
          'owner': owner,
          'expiresAt': expiresAt.toUtc().toIso8601String(),
        }),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      return true;
    });
  }

  @override
  Future<void> releaseLease(String name, String owner) {
    final key = '$_leaseKeyPrefix$name';
    return _database.transaction((transaction) async {
      final rows = await transaction.query(
        'app_state',
        columns: ['value'],
        where: 'key = ?',
        whereArgs: [key],
        limit: 1,
      );
      if (rows.isEmpty) return;
      try {
        final decoded = jsonDecode(rows.single['value']! as String);
        if (decoded is Map<String, dynamic> && decoded['owner'] == owner) {
          await transaction.delete(
            'app_state',
            where: 'key = ?',
            whereArgs: [key],
          );
        }
      } catch (_) {
        // Never delete a lease we cannot prove belongs to this owner.
      }
    });
  }

  @override
  Future<String> loadDraft() async {
    final row = await _database.query(
      'app_state',
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [_draftKey],
      limit: 1,
    );
    if (row.isEmpty) return '';
    return _payloadCipher.decrypt(row.single['value']! as String);
  }

  @override
  Future<void> saveDraft(String content) async {
    final encrypted = await _payloadCipher.encrypt(content);
    await _database.insert('app_state', {
      'key': _draftKey,
      'value': encrypted,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<void> clearDraft() =>
      _database.delete('app_state', where: 'key = ?', whereArgs: [_draftKey]);

  @override
  Future<bool> loadSyncPaused() async {
    final rows = await _database.query(
      'app_state',
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [_syncPausedKey],
      limit: 1,
    );
    return rows.isNotEmpty && rows.single['value'] == 'true';
  }

  @override
  Future<void> saveSyncPaused(bool paused) async {
    await _database.insert('app_state', {
      'key': _syncPausedKey,
      'value': paused.toString(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<void> close() => _database.close();

  Future<void> _migrateLegacyQueue() async {
    final migrated = await _database.query(
      'app_state',
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [_legacyMigrationKey],
      limit: 1,
    );
    if (migrated.isNotEmpty) return;

    final raw = _legacyPreferences.getString(_legacyQueueKey);
    if (raw != null && raw.isNotEmpty) {
      final entries = <CaptureEntry>[];
      var decodedSuccessfully = false;
      try {
        final decoded = jsonDecode(raw);
        if (decoded is List && decoded.every((item) => item is Map)) {
          for (final item in decoded.cast<Map>()) {
            entries.add(CaptureEntry.fromJson(item.cast<String, Object?>()));
          }
          decodedSuccessfully = true;
        }
      } catch (_) {
        // 旧值继续保留，等待未来版本或人工恢复，不能假装迁移成功。
      }
      if (!decodedSuccessfully) return;
      if (entries.isNotEmpty) {
        final merged = <String, CaptureEntry>{
          for (final entry in await load()) entry.id: entry,
          for (final entry in entries) entry.id: entry,
        };
        await save(merged.values.toList());
      }
    }

    await _database.insert('app_state', {
      'key': _legacyMigrationKey,
      'value': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    await _legacyPreferences.remove(_legacyQueueKey);
  }
}
