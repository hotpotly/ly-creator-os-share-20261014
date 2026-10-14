import 'package:flutter/services.dart';
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/controller/capture_queue_controller.dart';
import 'package:ly_creator_capture/src/maintenance/mobile_app_settings.dart';
import 'package:ly_creator_capture/src/maintenance/mobile_maintenance.dart';
import 'package:ly_creator_capture/src/model/capture_entry.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/storage/capture_store.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/mobile_sync_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _connection = DesktopConnection(
  address: '127.0.0.1:1234',
  deviceId: 'device',
  secretBase64: 'secret',
  deviceName: 'Android真机',
);

CaptureEntry _entry({
  required String id,
  CaptureSyncState state = CaptureSyncState.pending,
  String content = '本地记录',
  String notes = '',
  int notesRevision = 0,
  int notesSyncedRevision = 0,
  int attemptCount = 0,
  String? desktopCaptureId,
  DateTime? deletedAt,
  List<MobileAttachment> attachments = const [],
}) => CaptureEntry(
  id: id,
  title: '$id标题',
  content: content,
  hint: CaptureHint.auto,
  createdAt: DateTime.utc(2026, 7, 25),
  syncState: state,
  notes: notes,
  notesRevision: notesRevision,
  notesSyncedRevision: notesSyncedRevision,
  attemptCount: attemptCount,
  desktopCaptureId: desktopCaptureId,
  deletedAt: deletedAt,
  sourceApp: 'com.example.browser',
  sourceTitle: '网页标题',
  sourceUrl: 'https://example.com/story',
  attachments: attachments,
);

MobileAttachment _attachment(String id, {MobileAttachmentKind? kind}) =>
    MobileAttachment(
      id: id,
      localPath: '/private/$id.lyenc',
      name: '$id.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 128,
      sha256: 'a' * 64,
      kind: kind ?? MobileAttachmentKind.pdf,
      chunkCount: 1,
      encryptedAtRest: true,
    );

class FakeMaintenance implements MobileMaintenance {
  final List<List<MobileAttachment>> deleted = [];
  final List<({CaptureEntry entry, String? attachmentId})> shared = [];
  Map<String, Object?>? diagnostics;
  void Function(String action)? quickActionHandler;

  @override
  void setQuickActionHandler(void Function(String action)? handler) {
    quickActionHandler = handler;
  }

  @override
  Future<void> setScreenProtection(bool enabled) async {}

  @override
  Future<int> appStorageBytes() async => 1024;

  @override
  Future<bool> authenticate(String reason) async => true;

  @override
  Future<String?> consumeQuickAction() async => null;

  @override
  Future<void> deletePrivateCopies(List<MobileAttachment> attachments) async {
    deleted.add(List.of(attachments));
  }

  @override
  Future<void> exportDiagnostics(Map<String, Object?> diagnostics) async {
    this.diagnostics = Map.of(diagnostics);
  }

  @override
  Future<void> installUpdate({
    required String url,
    required String sha256,
    required int sizeBytes,
    required int versionCode,
  }) async {}

  @override
  Future<void> openAutoStartSettings() async {}

  @override
  Future<void> openInstallSettings() async {}

  @override
  Future<void> openBatterySettings() async {}

  @override
  Future<MobileSetupStatus> requestCorePermissions() async => setupStatus();

  @override
  Future<MobileSetupStatus> setupStatus() async => const MobileSetupStatus(
    microphone: true,
    camera: true,
    notifications: true,
    batteryUnrestricted: true,
    installUpdates: true,
    isOppo: true,
    appVersion: '1.0.0',
    appVersionCode: 1,
  );

  @override
  Future<void> share(CaptureEntry entry, {String? attachmentId}) async {
    shared.add((entry: entry, attachmentId: attachmentId));
  }

  @override
  Future<void> updateWidget({
    required int pendingCount,
    required bool recording,
  }) async {}
}

class BlockingNoteSyncClient extends MobileSyncClient {
  BlockingNoteSyncClient({this.failFirst = false});

  final bool failFirst;
  final Completer<void> firstEntered = Completer<void>();
  final Completer<void> releaseFirst = Completer<void>();
  final List<({int revision, String notes})> noteRequests = [];
  int uploadCount = 0;

  @override
  Future<MobileCaptureReceipt> upload(
    DesktopConnection connection,
    CaptureEntry entry, {
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  }) async {
    uploadCount += 1;
    return MobileCaptureReceipt(
      mobileCaptureId: entry.id,
      desktopCaptureId: 'desktop-${entry.id}',
      duplicate: false,
    );
  }

  @override
  Future<MobileNoteReceipt> appendNotes(
    DesktopConnection connection,
    CaptureEntry entry,
  ) async {
    noteRequests.add((revision: entry.notesRevision, notes: entry.notes));
    if (noteRequests.length == 1) {
      firstEntered.complete();
      await releaseFirst.future;
      if (failFirst) {
        throw const MobileSyncException('首个备注版本未到达Mac');
      }
    }
    return MobileNoteReceipt(
      mobileCaptureId: entry.id,
      desktopCaptureId: entry.desktopCaptureId!,
      notesRevision: entry.notesRevision,
      duplicate: false,
    );
  }
}

Future<void> _waitUntil(bool Function() predicate) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (!predicate()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('condition was not reached');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('ly.creator.capture/device_status'),
          (call) async => call.method == 'acquireLocalWifi'
              ? true
              : call.method == 'releaseLocalWifi'
              ? null
              : {
                  'wifi': true,
                  'metered': false,
                  'powerSaver': false,
                  'batteryPercent': 100,
                  'charging': true,
                },
        );
  });
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('searches local metadata and applies library filters', () async {
    final entries = [
      _entry(
        id: 'audio',
        state: CaptureSyncState.synced,
        desktopCaptureId: 'desktop-audio',
        notes: '尤其注意结尾',
        attachments: [_attachment('采访录音', kind: MobileAttachmentKind.audio)],
      ),
      _entry(id: 'failed', state: CaptureSyncState.failed, content: '失败记录'),
      _entry(
        id: 'file',
        state: CaptureSyncState.synced,
        desktopCaptureId: 'desktop-file',
        attachments: [_attachment('商务brief')],
      ),
    ];
    final controller = CaptureQueueController(
      MemoryCaptureStore(entries),
      MemoryConnectionStore(),
      autoDiscovery: false,
    );
    await controller.load(syncImmediately: false);

    expect(controller.search(query: 'example.com').length, 3);
    expect(controller.search(query: '尤其注意').single.id, 'audio');
    expect(controller.search(query: '商务brief').single.id, 'file');
    expect(
      controller.search(filter: CaptureLibraryFilter.failed).single.id,
      'failed',
    );
    expect(
      controller.search(filter: CaptureLibraryFilter.recording).single.id,
      'audio',
    );
    expect(
      controller.search(filter: CaptureLibraryFilter.files).single.id,
      'file',
    );
    controller.dispose();
  });

  test(
    'trash preserves unsynced work, restores it, and purges after 30 days',
    () async {
      final attachment = _attachment('draft-file');
      final expired = _entry(
        id: 'expired',
        deletedAt: DateTime.now().toUtc().subtract(const Duration(days: 31)),
        attachments: [attachment],
      );
      final store = MemoryCaptureStore([_entry(id: 'draft'), expired]);
      final maintenance = FakeMaintenance();
      final controller = CaptureQueueController(
        store,
        MemoryConnectionStore(),
        maintenance: maintenance,
        autoDiscovery: false,
      );
      await controller.load(syncImmediately: false);

      expect(controller.entries.map((entry) => entry.id), ['draft']);
      expect((await store.load()).map((entry) => entry.id), ['draft']);
      expect(maintenance.deleted.single.single.id, attachment.id);

      await controller.deleteRecord('draft');
      expect(controller.entries, isEmpty);
      expect(controller.trashedEntries.single.id, 'draft');
      await controller.restoreFromTrash('draft');
      expect(controller.entries.single.id, 'draft');
      expect(controller.entries.single.syncState, CaptureSyncState.pending);
      controller.dispose();
    },
  );

  test('deletes a fully synced phone copy immediately', () async {
    final attachment = _attachment('synced-file');
    final store = MemoryCaptureStore([
      _entry(
        id: 'synced',
        state: CaptureSyncState.synced,
        desktopCaptureId: 'desktop-synced',
        attachments: [attachment],
      ),
    ]);
    final maintenance = FakeMaintenance();
    final controller = CaptureQueueController(
      store,
      MemoryConnectionStore(),
      maintenance: maintenance,
      autoDiscovery: false,
    );
    await controller.load(syncImmediately: false);

    await controller.deleteRecord('synced');

    expect(controller.entries, isEmpty);
    expect(await store.load(), isEmpty);
    expect(maintenance.deleted.single.single.id, attachment.id);
    controller.dispose();
  });

  test(
    'keeps metadata after clearing synced files and can re-share text',
    () async {
      final attachment = _attachment('synced-file');
      final store = MemoryCaptureStore([
        _entry(
          id: 'synced',
          state: CaptureSyncState.synced,
          desktopCaptureId: 'desktop-synced',
          notes: '保留备注',
          attachments: [attachment],
        ),
      ]);
      final maintenance = FakeMaintenance();
      final controller = CaptureQueueController(
        store,
        MemoryConnectionStore(),
        maintenance: maintenance,
        autoDiscovery: false,
      );
      await controller.load(syncImmediately: false);

      await controller.clearSyncedLocalCopies(['synced']);
      final retained = controller.entries.single;
      expect(retained.attachments.single.name, attachment.name);
      expect(retained.localCopyRemovedAt, isNotNull);
      await controller.shareRecord('synced');
      expect(maintenance.shared.single.entry.attachments, isEmpty);
      expect(maintenance.shared.single.entry.notes, '保留备注');
      await expectLater(
        controller.shareRecord('synced', attachmentId: attachment.id),
        throwsStateError,
      );
      controller.dispose();
    },
  );

  test(
    'serializes notes appended while an earlier revision is in flight',
    () async {
      final client = BlockingNoteSyncClient();
      final controller = CaptureQueueController(
        MemoryCaptureStore([
          _entry(
            id: 'note',
            state: CaptureSyncState.synced,
            desktopCaptureId: 'desktop-note',
          ),
        ]),
        MemoryConnectionStore(_connection),
        maintenance: FakeMaintenance(),
        syncClient: client,
        autoDiscovery: false,
      );
      await controller.load(syncImmediately: false);

      await controller.appendNote('note', '第一条');
      await client.firstEntered.future;
      await controller.appendNote('note', '第二条');
      client.releaseFirst.complete();
      await _waitUntil(
        () =>
            client.noteRequests.length == 2 &&
            !controller.entries.single.hasPendingNoteSync,
      );

      expect(client.noteRequests, [
        (revision: 1, notes: '第一条'),
        (revision: 2, notes: '第一条\n第二条'),
      ]);
      expect(controller.entries.single.notesSyncedRevision, 2);
      controller.dispose();
    },
  );

  test('sends an independent note update after a capture retry', () async {
    final client = BlockingNoteSyncClient()..releaseFirst.complete();
    final controller = CaptureQueueController(
      MemoryCaptureStore([
        _entry(
          id: 'possibly-committed',
          state: CaptureSyncState.failed,
          attemptCount: 1,
        ),
      ]),
      MemoryConnectionStore(_connection),
      maintenance: FakeMaintenance(),
      syncClient: client,
      autoDiscovery: false,
      scheduleRetries: false,
    );
    await controller.load(syncImmediately: false);
    await controller.appendNote('possibly-committed', '补充备注');
    await _waitUntil(
      () =>
          client.uploadCount == 1 &&
          client.noteRequests.length == 1 &&
          !controller.entries.single.hasPendingNoteSync,
    );

    expect(client.noteRequests.single, (revision: 1, notes: '补充备注'));
    expect(controller.entries.single.syncState, CaptureSyncState.synced);
    controller.dispose();
  });

  test(
    'a newer full-note snapshot recovers when the in-flight version fails',
    () async {
      final client = BlockingNoteSyncClient(failFirst: true);
      final controller = CaptureQueueController(
        MemoryCaptureStore([
          _entry(
            id: 'note-retry',
            state: CaptureSyncState.synced,
            desktopCaptureId: 'desktop-note-retry',
          ),
        ]),
        MemoryConnectionStore(_connection),
        maintenance: FakeMaintenance(),
        syncClient: client,
        autoDiscovery: false,
        scheduleRetries: false,
      );
      await controller.load(syncImmediately: false);

      await controller.appendNote('note-retry', '第一条');
      await client.firstEntered.future;
      await controller.appendNote('note-retry', '第二条');
      client.releaseFirst.complete();
      await _waitUntil(
        () =>
            client.noteRequests.length == 2 &&
            controller.entries.single.notesSyncedRevision == 2,
      );

      expect(client.noteRequests.first, (revision: 1, notes: '第一条'));
      expect(client.noteRequests.last, (revision: 2, notes: '第一条\n第二条'));
      expect(controller.entries.single.notesSyncedRevision, 2);
      expect(controller.entries.single.noteSyncError, isNull);
      controller.dispose();
    },
  );

  test('uses a new revision after a committed note response is lost', () async {
    final client = BlockingNoteSyncClient(failFirst: true);
    final controller = CaptureQueueController(
      MemoryCaptureStore([
        _entry(
          id: 'note-response-lost',
          state: CaptureSyncState.synced,
          desktopCaptureId: 'desktop-note-response-lost',
        ),
      ]),
      MemoryConnectionStore(_connection),
      maintenance: FakeMaintenance(),
      syncClient: client,
      autoDiscovery: false,
      scheduleRetries: false,
    );
    await controller.load(syncImmediately: false);

    await controller.appendNote('note-response-lost', '第一条');
    await client.firstEntered.future;
    client.releaseFirst.complete();
    await _waitUntil(() => controller.entries.single.noteSyncError != null);
    expect(client.noteRequests.single, (revision: 1, notes: '第一条'));

    await controller.appendNote('note-response-lost', '第二条');
    await _waitUntil(
      () =>
          client.noteRequests.length == 2 &&
          controller.entries.single.notesSyncedRevision == 2,
    );

    expect(client.noteRequests.last, (revision: 2, notes: '第一条\n第二条'));
    expect(controller.entries.single.noteSyncError, isNull);
    controller.dispose();
  });

  test('history lock settings persist and clamp the timeout', () async {
    final settings = MobileAppSettings();
    await settings.load();
    await settings.completeSetup();
    await settings.setHistoryLock(true);
    await settings.setHistoryLockMinutes(500);

    final restored = MobileAppSettings();
    await restored.load();
    expect(restored.setupComplete, isTrue);
    expect(restored.historyLockEnabled, isTrue);
    expect(restored.historyLockMinutes, 60);
  });

  test('forwards quick actions received while the Flutter screen is alive', () {
    final maintenance = FakeMaintenance();
    final controller = CaptureQueueController(
      MemoryCaptureStore(),
      MemoryConnectionStore(),
      maintenance: maintenance,
      autoDiscovery: false,
    );
    String? received;
    controller.setQuickActionHandler((action) => received = action);
    maintenance.quickActionHandler?.call('camera');
    expect(received, 'camera');
    controller.setQuickActionHandler(null);
    expect(maintenance.quickActionHandler, isNull);
    controller.dispose();
  });
}
