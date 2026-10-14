import 'package:flutter/services.dart';
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/controller/capture_queue_controller.dart';
import 'package:ly_creator_capture/src/intake/share_intake.dart';
import 'package:ly_creator_capture/src/model/capture_entry.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/model/desktop_service.dart';
import 'package:ly_creator_capture/src/storage/capture_store.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/mobile_sync_client.dart';
import 'package:ly_creator_capture/src/sync/device_power_status.dart';

const testConnection = DesktopConnection(
  address: '127.0.0.1:1234',
  deviceId: 'device',
  secretBase64: 'secret',
  deviceName: '测试手机',
);

void mainSharedIntakeMetadataTest() {
  test('parses encrypted preview and source time from native media intake', () {
    final shared = SharedCaptureInput.fromMap({
      'shareId': 'media-share',
      'content': '',
      'createdAt': '2026-07-25T08:00:00.000Z',
      'attachments': [
        {
          'attachmentId': 'photo-id',
          'localPath': '/private/photo.lyenc',
          'name': '照片.jpg',
          'mimeType': 'image/jpeg',
          'sizeBytes': 12,
          'sha256': 'a' * 64,
          'encryptedAtRest': true,
          'sourceModifiedAt': '2026-07-24T07:30:00.000Z',
          'previewAttachmentId': 'photo-id-preview',
          'previewLocalPath': '/private/photo-preview.lyenc',
        },
      ],
    });
    expect(
      shared.attachments.single.sourceModifiedAt?.toIso8601String(),
      '2026-07-24T07:30:00.000Z',
    );
    expect(shared.attachments.single.previewAttachmentId, 'photo-id-preview');
    expect(
      shared.attachments.single.previewLocalPath,
      '/private/photo-preview.lyenc',
    );
  });

  test('isolates one malformed native queue item from later shares', () {
    final values = parsePendingSharedCaptures([
      {
        'shareId': 'bad-native-item',
        'createdAt': '2026-07-25T08:00:00.000Z',
        'attachments': [
          {'attachmentId': 'missing-required-fields'},
        ],
      },
      {
        'shareId': 'good-native-item',
        'content': '后续分享',
        'createdAt': '2026-07-25T08:01:00.000Z',
        'attachments': const [],
      },
    ]);
    expect(values, hasLength(2));
    expect(values.first.shareId, 'bad-native-item');
    expect(values.first.error, contains('系统分享记录损坏'));
    expect(values.last.content, '后续分享');
  });
}

class FailingSyncClient extends MobileSyncClient {
  FailingSyncClient({
    required this.requiresPairing,
    this.waitingForMac = false,
  });
  final bool requiresPairing;
  final bool waitingForMac;
  int uploadCount = 0;

  @override
  Future<MobileCaptureReceipt> upload(
    DesktopConnection connection,
    CaptureEntry entry, {
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  }) async {
    uploadCount += 1;
    throw MobileSyncException(
      '模拟同步失败',
      requiresPairing: requiresPairing,
      waitingForMac: waitingForMac,
    );
  }
}

class RecordingSyncClient extends MobileSyncClient {
  final List<String> uploadedIds = [];

  @override
  Future<MobileCaptureReceipt> upload(
    DesktopConnection connection,
    CaptureEntry entry, {
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  }) async {
    uploadedIds.add(entry.id);
    return MobileCaptureReceipt(
      mobileCaptureId: entry.id,
      desktopCaptureId: 'desktop-${entry.id}',
      duplicate: false,
    );
  }
}

class BlockingSyncClient extends MobileSyncClient {
  final Completer<void> entered = Completer<void>();
  final Completer<void> release = Completer<void>();
  int uploadCount = 0;

  @override
  Future<MobileCaptureReceipt> upload(
    DesktopConnection connection,
    CaptureEntry entry, {
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  }) async {
    uploadCount += 1;
    if (!entered.isCompleted) entered.complete();
    await release.future;
    return MobileCaptureReceipt(
      mobileCaptureId: entry.id,
      desktopCaptureId: 'desktop-${entry.id}',
      duplicate: false,
    );
  }
}

class ChunkAwareSyncClient extends MobileSyncClient {
  ChunkAwareSyncClient({required this.afterFirstChunk});

  final Future<void> Function(CaptureEntry entry) afterFirstChunk;
  final List<String> events = [];
  bool hookUsed = false;

  @override
  Future<MobileCaptureReceipt> upload(
    DesktopConnection connection,
    CaptureEntry entry, {
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  }) async {
    final chunks = entry.attachments.isEmpty ? 1 : 3;
    for (var chunk = 0; chunk < chunks; chunk += 1) {
      if (shouldContinue != null && !await shouldContinue()) {
        events.add('${entry.id}:paused-before-$chunk');
        throw const MobileSyncPausedException();
      }
      events.add('${entry.id}:chunk-$chunk');
      if (!hookUsed && chunk == 0) {
        hookUsed = true;
        await afterFirstChunk(entry);
      }
      if (entry.attachments.isNotEmpty && onAttachmentProgress != null) {
        await onAttachmentProgress(
          entry.attachments.single.id,
          List<int>.generate(chunk + 1, (index) => index),
        );
      }
    }
    events.add('${entry.id}:complete');
    return MobileCaptureReceipt(
      mobileCaptureId: entry.id,
      desktopCaptureId: 'desktop-${entry.id}',
      duplicate: false,
    );
  }
}

class LowBatteryStatusProvider implements DevicePowerStatusProvider {
  @override
  Future<DevicePowerStatus> read() async =>
      const DevicePowerStatus(batteryPercent: 10, charging: false);
}

class MutablePowerStatusProvider implements DevicePowerStatusProvider {
  MutablePowerStatusProvider(this.value);
  DevicePowerStatus value;

  @override
  Future<DevicePowerStatus> read() async => value;
}

class MemoryAttachmentIntake implements AttachmentIntake {
  MemoryAttachmentIntake(
    this.pending, {
    this.pickedFiles,
    this.pickedMedia,
    this.photo,
  });
  final List<SharedCaptureInput> pending;
  final SharedCaptureInput? pickedFiles;
  final SharedCaptureInput? pickedMedia;
  final SharedCaptureInput? photo;
  final List<String> acknowledged = [];
  void Function()? callback;

  @override
  Future<void> acknowledge(String shareId) async => acknowledged.add(shareId);

  @override
  Future<List<SharedCaptureInput>> listPendingShares() async => [...pending];

  @override
  Future<SharedCaptureInput?> pickFiles() async => pickedFiles;

  @override
  Future<SharedCaptureInput?> pickMedia() async => pickedMedia;

  @override
  Future<SharedCaptureInput?> takePhoto() async => photo;

  @override
  void setOnShareReady(void Function() callback) => this.callback = callback;
}

class CorruptDraftStore extends MemoryCaptureStore {
  int draftSaveCount = 0;

  @override
  Future<String> loadDraft() async => throw const FormatException('bad draft');

  @override
  Future<void> saveDraft(String content) async {
    draftSaveCount += 1;
    await super.saveDraft(content);
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
  mainSharedIntakeMetadataTest();
  test('persists offline entries before reporting success', () async {
    final store = MemoryCaptureStore();
    final controller = CaptureQueueController(
      store,
      MemoryConnectionStore(),
      autoDiscovery: false,
    );
    await controller.load();

    final first = await controller.add('  一条离线灵感  ', CaptureHint.auto);
    final second = await controller.add('一个新选题', CaptureHint.topic);

    expect(first.content, '一条离线灵感');
    expect(first.syncState, CaptureSyncState.pending);
    expect(second.id, isNot(first.id));
    expect((await store.load()).map((entry) => entry.id), [
      second.id,
      first.id,
    ]);
  });

  test('restores drafts and allows editing local title before sync', () async {
    final store = MemoryCaptureStore(const [], '切后台也不能丢的草稿');
    final controller = CaptureQueueController(
      store,
      MemoryConnectionStore(),
      autoDiscovery: false,
    );
    await controller.load();
    expect(controller.draftContent, '切后台也不能丢的草稿');

    controller.updateDraft('自动保存的新草稿');
    await controller.flushDraft();
    expect(await store.loadDraft(), '自动保存的新草稿');

    final entry = await controller.add('今天想到 一个更直接的开场', CaptureHint.auto);
    expect(entry.displayTitle, '一个更直接的开场');
    expect(await store.loadDraft(), isEmpty);
    await controller.updatePendingRecord(
      id: entry.id,
      title: '手动标题',
      content: '修改后的原始文字',
    );
    expect(controller.entries.single.displayTitle, '手动标题');
    expect(controller.entries.single.content, '修改后的原始文字');
    controller.dispose();
  });

  test(
    'locks content after the first upload attempt even if the receipt was lost',
    () async {
      final attempted = CaptureEntry(
        id: 'possibly-committed',
        content: 'Mac可能已经保存的旧原文',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.failed,
        attemptCount: 1,
      );
      final controller = CaptureQueueController(
        MemoryCaptureStore([attempted]),
        MemoryConnectionStore(),
        autoDiscovery: false,
      );
      await controller.load();
      await expectLater(
        controller.updatePendingRecord(
          id: attempted.id,
          title: '新标题',
          content: '不能覆盖成新原文',
        ),
        throwsStateError,
      );
      expect(controller.entries.single.content, attempted.content);
      controller.dispose();
    },
  );

  test('local title uses the first non-empty paragraph', () {
    expect(
      localCaptureTitle(
        content: '第一段标题\n第二段不能进入标题',
        attachments: const [],
        createdAt: DateTime.utc(2026, 7, 25),
      ),
      '第一段标题',
    );
  });

  test(
    'truncates a long shared page title without losing source metadata',
    () async {
      final longTitle = List.filled(100, '很长的网页标题').join();
      final controller = CaptureQueueController(
        MemoryCaptureStore(),
        MemoryConnectionStore(),
        autoDiscovery: false,
      );
      await controller.load();
      final entry = await controller.add(
        'https://example.com/story',
        CaptureHint.auto,
        sourceTitle: longTitle,
        sourceUrl: 'https://example.com/story',
      );
      expect(entry.title.runes.length, 20);
      expect(entry.sourceTitle?.length, 500);
      expect(longTitle.startsWith(entry.sourceTitle!), isTrue);
      controller.dispose();
    },
  );

  test(
    'truncates an attachment-only local title to the Mac protocol limit',
    () {
      final title = localCaptureTitle(
        content: '',
        attachments: [
          MobileAttachment(
            id: 'long-name-image',
            localPath: '/private/long-name.lyenc',
            name: '${List.filled(20, 'Screenshot_2026-07-26_').join()}.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 12,
            sha256: 'a' * 64,
            kind: MobileAttachmentKind.image,
            chunkCount: 1,
          ),
        ],
        createdAt: DateTime.utc(2026, 7, 26),
      );
      expect(title.runes.length, mobileCaptureTitleMaxRunes);
    },
  );

  test('repairs an overlong title when loading an old queued record', () {
    final entry = CaptureEntry.fromJson({
      'id': 'legacy-long-title',
      'title': List.filled(80, '旧').join(),
      'content': '',
      'hint': CaptureHint.auto.name,
      'createdAt': '2026-07-26T10:00:00.000Z',
      'syncState': CaptureSyncState.failed.name,
      'attachments': const [],
    });
    expect(entry.title.runes.length, mobileCaptureTitleMaxRunes);
  });

  test('a corrupt encrypted draft does not block the record library', () async {
    final store = CorruptDraftStore();
    final controller = CaptureQueueController(
      store,
      MemoryConnectionStore(),
      autoDiscovery: false,
    );
    await controller.load();
    expect(controller.loading, isFalse);
    expect(controller.draftContent, isEmpty);
    expect(controller.intakeError, contains('原始加密数据已保留'));
    await controller.flushDraft();
    expect(store.draftSaveCount, 0);
    controller.updateDraft('用户明确输入的新草稿');
    await controller.flushDraft();
    expect(store.draftSaveCount, 1);
    controller.dispose();
  });

  test(
    'imports a system share once with stable private attachment metadata',
    () async {
      final attachment = MobileAttachment(
        id: 'shared-file-1',
        localPath: '/private/app/files/shared-file-1.pdf',
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 300000,
        sha256: 'a' * 64,
        kind: MobileAttachmentKind.pdf,
        chunkCount: 2,
      );
      final intake = MemoryAttachmentIntake([
        SharedCaptureInput(
          shareId: 'share-1',
          content: '浏览器分享说明',
          createdAt: DateTime.utc(2026, 7, 22),
          attachments: [attachment],
          sourceApp: 'com.example.browser',
          sourceTitle: '分享页标题',
          sourceUrl: 'https://example.com/story',
        ),
      ]);
      final store = MemoryCaptureStore();
      final controller = CaptureQueueController(
        store,
        MemoryConnectionStore(),
        attachmentIntake: intake,
        autoDiscovery: false,
      );
      await controller.load();
      expect(controller.entries, hasLength(1));
      expect(controller.entries.single.sourceShareId, 'share-1');
      expect(controller.entries.single.displayTitle, '分享页标题');
      expect(controller.entries.single.sourceApp, 'com.example.browser');
      expect(controller.entries.single.sourceUrl, 'https://example.com/story');
      expect(
        controller.entries.single.attachments.single.toJson(),
        attachment.toJson(),
      );
      expect(intake.acknowledged, ['share-1']);

      await controller.importPendingShares();
      expect(controller.entries, hasLength(1));
      expect(intake.acknowledged, ['share-1', 'share-1']);
      final restored = CaptureEntry.fromJson(
        controller.entries.single.toJson(),
      );
      expect(restored.attachments.single.id, 'shared-file-1');
      expect(restored.attachments.single.chunkCount, 2);
      controller.dispose();
    },
  );

  test(
    'one invalid system share does not block later durable shares',
    () async {
      final intake = MemoryAttachmentIntake([
        SharedCaptureInput(
          shareId: 'too-long',
          content: List.filled(100001, 'x').join(),
          createdAt: DateTime.utc(2026, 7, 25),
          attachments: const [],
        ),
        SharedCaptureInput(
          shareId: 'valid-after-error',
          content: '后续正常分享',
          createdAt: DateTime.utc(2026, 7, 25, 0, 1),
          attachments: const [],
        ),
      ]);
      final controller = CaptureQueueController(
        MemoryCaptureStore(),
        MemoryConnectionStore(),
        attachmentIntake: intake,
        autoDiscovery: false,
      );

      await controller.load();

      expect(controller.entries.map((entry) => entry.content), ['后续正常分享']);
      expect(intake.acknowledged, ['valid-after-error']);
      expect(controller.intakeError, contains('100000'));
      controller.dispose();
    },
  );

  test(
    'app file picker atomically saves the durable native share before ack',
    () async {
      final picked = SharedCaptureInput(
        shareId: 'picker-job-1',
        content: '',
        createdAt: DateTime.utc(2026, 7, 25),
        attachments: [
          MobileAttachment(
            id: 'picker-file-1',
            localPath: '/private/app/files/picker-file-1.pdf.lyenc',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 512,
            sha256: 'a' * 64,
            kind: MobileAttachmentKind.pdf,
            chunkCount: 1,
            encryptedAtRest: true,
          ),
        ],
        sourceApp: 'Android文件选择器',
      );
      final intake = MemoryAttachmentIntake(const [], pickedFiles: picked);
      final store = MemoryCaptureStore();
      final controller = CaptureQueueController(
        store,
        MemoryConnectionStore(),
        attachmentIntake: intake,
        autoDiscovery: false,
      );
      await controller.load();

      final saved = await controller.pickAttachments();

      expect(saved?.sourceShareId, picked.shareId);
      expect(saved?.attachments.single.encryptedAtRest, isTrue);
      expect((await store.load()).single.sourceShareId, picked.shareId);
      expect(intake.acknowledged, [picked.shareId]);
      controller.dispose();
    },
  );

  test(
    'restores an interrupted sync as pending without changing its stable id',
    () async {
      final interrupted = CaptureEntry(
        id: 'stable-id',
        content: '不能丢',
        hint: CaptureHint.inspiration,
        createdAt: DateTime.utc(2026, 7, 21),
        syncState: CaptureSyncState.syncing,
      );
      final restored = CaptureEntry.fromJson(interrupted.toJson());
      expect(restored.id, 'stable-id');
      expect(restored.syncState, CaptureSyncState.pending);
    },
  );

  test('rejects empty and oversized notes', () async {
    final controller = CaptureQueueController(
      MemoryCaptureStore(),
      MemoryConnectionStore(),
      autoDiscovery: false,
    );
    await controller.load();
    await expectLater(
      controller.add('   ', CaptureHint.auto),
      throwsArgumentError,
    );
    await expectLater(
      controller.add('a' * 100001, CaptureHint.auto),
      throwsArgumentError,
    );
  });

  test(
    'clears a revoked connection and never marks the note as synced',
    () async {
      final entry = CaptureEntry(
        id: 'stable-id',
        content: '保留原文',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 21),
        syncState: CaptureSyncState.pending,
      );
      final connectionStore = MemoryConnectionStore(testConnection);
      final client = FailingSyncClient(requiresPairing: true);
      final controller = CaptureQueueController(
        MemoryCaptureStore([entry]),
        connectionStore,
        syncClient: client,
        autoDiscovery: false,
      );
      await controller.load();
      await pumpEventQueue(times: 10);

      expect(controller.connection, isNull);
      expect(connectionStore.connection, isNull);
      expect(controller.entries.single.syncState, CaptureSyncState.failed);
      expect(controller.entries.single.content, '保留原文');
      controller.dispose();
    },
  );

  test('stops a batch after the first transient network failure', () async {
    final entries = List.generate(
      3,
      (index) => CaptureEntry(
        id: 'stable-$index',
        content: '记录$index',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 21, 0, index),
        syncState: CaptureSyncState.pending,
      ),
    );
    final client = FailingSyncClient(requiresPairing: false);
    final controller = CaptureQueueController(
      MemoryCaptureStore(entries),
      MemoryConnectionStore(testConnection),
      syncClient: client,
      autoDiscovery: false,
    );
    await controller.load();
    await pumpEventQueue(times: 10);

    expect(client.uploadCount, 1);
    expect(
      controller.entries.where(
        (entry) => entry.syncState == CaptureSyncState.failed,
      ),
      hasLength(1),
    );
    expect(
      controller.entries.where(
        (entry) => entry.syncState == CaptureSyncState.pending,
      ),
      hasLength(2),
    );
    controller.dispose();
  });

  test(
    'shows waiting Mac instead of failure for an unavailable trusted Mac',
    () async {
      final entry = CaptureEntry(
        id: 'waiting-mac',
        content: 'Mac睡眠时也不能丢',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.pending,
      );
      final controller = CaptureQueueController(
        MemoryCaptureStore([entry]),
        MemoryConnectionStore(testConnection),
        syncClient: FailingSyncClient(
          requiresPairing: false,
          waitingForMac: true,
        ),
        autoDiscovery: false,
      );
      await controller.load();
      await pumpEventQueue(times: 10);

      expect(controller.entries.single.syncState, CaptureSyncState.waitingMac);
      expect(controller.entries.single.content, entry.content);
      controller.dispose();
    },
  );

  test(
    'refreshes a trusted Mac address from its stable Bonjour identity',
    () async {
      const service = DesktopService(
        serviceId: 'stable-mac',
        name: 'LY Creator OS',
        address: '192.168.1.55:41234',
        protocolVersion: 2,
      );
      const connection = DesktopConnection(
        address: '192.168.1.20:40000',
        deviceId: 'device',
        secretBase64: 'secret',
        deviceName: '测试手机',
        protocolVersion: 2,
        serviceId: 'stable-mac',
      );
      final connectionStore = MemoryConnectionStore(connection);
      final controller = CaptureQueueController(
        MemoryCaptureStore(),
        connectionStore,
        syncClient: MobileSyncClient(discovery: () async => [service]),
        autoDiscovery: false,
      );
      await controller.load();
      await controller.refreshDiscovery();

      expect(controller.discoveredServices, [service]);
      expect(controller.connection?.address, service.address);
      expect(connectionStore.connection?.address, service.address);
      controller.dispose();
    },
  );

  test(
    'prioritizes explicit records and skips low-battery large media',
    () async {
      MobileAttachment video(String id) => MobileAttachment(
        id: id,
        localPath: '/private/$id.mp4',
        name: '$id.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 20 * 1024 * 1024,
        sha256: 'a' * 64,
        kind: MobileAttachmentKind.video,
        chunkCount: 80,
      );
      final entries = [
        CaptureEntry(
          id: 'large-normal',
          content: '',
          hint: CaptureHint.auto,
          createdAt: DateTime.utc(2026, 7, 25, 1),
          syncState: CaptureSyncState.pending,
          attachments: [video('normal-video')],
        ),
        CaptureEntry(
          id: 'small-text',
          content: '小文字',
          hint: CaptureHint.auto,
          createdAt: DateTime.utc(2026, 7, 25, 2),
          syncState: CaptureSyncState.pending,
        ),
        CaptureEntry(
          id: 'large-priority',
          content: '',
          hint: CaptureHint.auto,
          createdAt: DateTime.utc(2026, 7, 25, 3),
          syncState: CaptureSyncState.pending,
          attachments: [video('priority-video')],
          priority: true,
        ),
      ];
      final client = RecordingSyncClient();
      final controller = CaptureQueueController(
        MemoryCaptureStore(entries),
        MemoryConnectionStore(testConnection),
        syncClient: client,
        powerStatusProvider: LowBatteryStatusProvider(),
        autoDiscovery: false,
      );
      await controller.load();
      await pumpEventQueue(times: 20);

      expect(client.uploadedIds, ['large-priority', 'small-text']);
      expect(
        controller.entries
            .firstWhere((entry) => entry.id == 'large-normal')
            .syncState,
        CaptureSyncState.pending,
      );
      controller.dispose();
    },
  );

  test('a later charging sync resumes low-battery large media', () async {
    final video = MobileAttachment(
      id: 'charging-video',
      localPath: '/private/charging-video.mp4',
      name: 'charging-video.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 20 * 1024 * 1024,
      sha256: 'a' * 64,
      kind: MobileAttachmentKind.video,
      chunkCount: 80,
    );
    final entry = CaptureEntry(
      id: 'charging-entry',
      content: '',
      hint: CaptureHint.auto,
      createdAt: DateTime.utc(2026, 7, 25),
      syncState: CaptureSyncState.pending,
      attachments: [video],
    );
    final power = MutablePowerStatusProvider(
      const DevicePowerStatus(batteryPercent: 10, charging: false),
    );
    final client = RecordingSyncClient();
    final controller = CaptureQueueController(
      MemoryCaptureStore([entry]),
      MemoryConnectionStore(testConnection),
      syncClient: client,
      powerStatusProvider: power,
      autoDiscovery: false,
    );
    await controller.load();
    await pumpEventQueue(times: 10);
    expect(client.uploadedIds, isEmpty);

    power.value = const DevicePowerStatus(batteryPercent: 10, charging: true);
    await controller.syncPending();

    expect(client.uploadedIds, ['charging-entry']);
    expect(controller.entries.single.syncState, CaptureSyncState.synced);
    controller.dispose();
  });

  test(
    'global and per-record pause persist without deleting originals',
    () async {
      final entry = CaptureEntry(
        id: 'paused-record',
        content: '不能删除',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.pending,
      );
      final store = MemoryCaptureStore([entry])..syncPaused = true;
      final client = RecordingSyncClient();
      final controller = CaptureQueueController(
        store,
        MemoryConnectionStore(testConnection),
        syncClient: client,
        autoDiscovery: false,
      );
      await controller.load();
      await pumpEventQueue(times: 5);
      expect(client.uploadedIds, isEmpty);

      await controller.setRecordSyncPaused(entry.id, true);
      await controller.setGlobalSyncPaused(false);
      await pumpEventQueue(times: 5);
      expect(client.uploadedIds, isEmpty);
      expect(controller.entries.single.content, '不能删除');

      await controller.setRecordSyncPaused(entry.id, false);
      await pumpEventQueue(times: 10);
      expect(client.uploadedIds, ['paused-record']);
      expect(store.syncPaused, isFalse);
      controller.dispose();
    },
  );

  test(
    'foreground and headless controllers cannot upload the same record together',
    () async {
      final entry = CaptureEntry(
        id: 'single-uploader',
        content: '只能上传一次',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.pending,
      );
      final store = MemoryCaptureStore([entry]);
      final client = BlockingSyncClient();
      final foreground = CaptureQueueController(
        store,
        MemoryConnectionStore(testConnection),
        syncClient: client,
        autoDiscovery: false,
      );
      final headless = CaptureQueueController(
        store,
        MemoryConnectionStore(testConnection),
        syncClient: client,
        autoDiscovery: false,
      );
      await foreground.load(syncImmediately: false);
      await headless.load(syncImmediately: false);

      final foregroundRun = foreground.syncPending();
      await client.entered.future;
      await headless.syncPending();
      client.release.complete();
      await foregroundRun;

      expect(client.uploadCount, 1);
      expect((await store.load()).single.syncState, CaptureSyncState.synced);
      foreground.dispose();
      headless.dispose();
    },
  );

  test(
    'a new text record interrupts a large upload at a chunk boundary',
    () async {
      final large = CaptureEntry(
        id: 'large-video',
        content: '',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.pending,
        attachments: [
          MobileAttachment(
            id: 'video',
            localPath: '/private/video.mp4',
            name: 'video.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 30 * 1024 * 1024,
            sha256: 'a' * 64,
            kind: MobileAttachmentKind.video,
            chunkCount: 3,
          ),
        ],
      );
      late CaptureQueueController controller;
      final client = ChunkAwareSyncClient(
        afterFirstChunk: (_) async {
          await controller.add('需要立即同步的小文字', CaptureHint.auto);
        },
      );
      controller = CaptureQueueController(
        MemoryCaptureStore([large]),
        MemoryConnectionStore(testConnection),
        syncClient: client,
        autoDiscovery: false,
      );
      await controller.load();
      await pumpEventQueue(times: 40);

      final smallId = controller.entries
          .firstWhere((entry) => entry.content == '需要立即同步的小文字')
          .id;
      expect(client.events.take(4), [
        'large-video:chunk-0',
        'large-video:paused-before-1',
        '$smallId:chunk-0',
        '$smallId:complete',
      ]);
      expect(client.events, contains('large-video:complete'));
      expect(
        controller.entries.every(
          (entry) => entry.syncState == CaptureSyncState.synced,
        ),
        isTrue,
      );
      controller.dispose();
    },
  );

  test(
    'per-record pause stops an active upload before its next chunk',
    () async {
      final large = CaptureEntry(
        id: 'pause-active',
        content: '',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 25),
        syncState: CaptureSyncState.pending,
        attachments: [
          MobileAttachment(
            id: 'audio',
            localPath: '/private/audio.m4a',
            name: 'audio.m4a',
            mimeType: 'audio/mp4',
            sizeBytes: 12 * 1024 * 1024,
            sha256: 'b' * 64,
            kind: MobileAttachmentKind.audio,
            chunkCount: 3,
          ),
        ],
      );
      late CaptureQueueController controller;
      final client = ChunkAwareSyncClient(
        afterFirstChunk: (entry) =>
            controller.setRecordSyncPaused(entry.id, true),
      );
      controller = CaptureQueueController(
        MemoryCaptureStore([large]),
        MemoryConnectionStore(testConnection),
        syncClient: client,
        autoDiscovery: false,
      );
      await controller.load();
      await pumpEventQueue(times: 20);

      expect(client.events, [
        'pause-active:chunk-0',
        'pause-active:paused-before-1',
      ]);
      expect(controller.entries.single.syncState, CaptureSyncState.paused);
      expect(
        controller.entries.single.attachments.single.sizeBytes,
        large.attachments.single.sizeBytes,
      );
      controller.dispose();
    },
  );
}
