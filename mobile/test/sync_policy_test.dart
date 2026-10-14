import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/sync/sync_policy.dart';
import 'package:ly_creator_capture/src/controller/capture_queue_controller.dart';
import 'package:ly_creator_capture/src/storage/capture_store.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/model/capture_entry.dart';
import 'package:ly_creator_capture/src/intake/share_intake.dart';
import 'capture_queue_test.dart'
    show RecordingSyncClient, MemoryAttachmentIntake, testConnection;

class Environment extends SyncEnvironmentProvider {
  Environment(this.value);
  SyncEnvironment value;
  Completer<void>? gate;
  int acquires = 0;
  int releases = 0;
  bool permit = true;
  @override
  Future<bool> acquireWifi() async {
    acquires++;
    return permit;
  }

  @override
  Future<void> releaseWifi() async {
    releases++;
  }

  @override
  Future<SyncEnvironment> read() async {
    await gate?.future;
    return value;
  }
}

const wifi = SyncEnvironment(
  wifi: true,
  metered: false,
  powerSaver: false,
  batteryPercent: 100,
  charging: false,
);
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'single flight survives awaited network policy and releases only acquired lease',
    () async {
      final environment = Environment(wifi);
      final sync = RecordingSyncClient();
      final controller = CaptureQueueController(
        MemoryCaptureStore(),
        MemoryConnectionStore(testConnection),
        syncClient: sync,
        syncEnvironmentProvider: environment,
        autoDiscovery: false,
        scheduleRetries: false,
        backgroundWorker: true,
      );
      await controller.load(syncImmediately: false, startDiscovery: false);
      await controller.add('只传一次', CaptureHint.auto);
      environment.gate = Completer<void>();
      final first = controller.syncPending();
      final second = controller.syncPending();
      environment.gate!.complete();
      await first;
      await second;
      expect(sync.uploadedIds, hasLength(1));
      expect(environment.acquires, 1);
      expect(environment.releases, 1);
      environment.permit = false;
      await controller.add('绑定失败', CaptureHint.auto);
      await controller.syncPending();
      expect(environment.releases, 1);
      controller.dispose();
    },
  );
  testWidgets(
    'foreground network callbacks debounce and stop while backgrounded',
    (tester) async {
      var count = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            ForegroundNetworkEvents.channel,
            (_) async => null,
          );
      final events = ForegroundNetworkEvents(() => count++);
      await events.start();
      Future<void> notify() async {
        final done = Completer<void>();
        tester.binding.defaultBinaryMessenger.handlePlatformMessage(
          'ly.creator.capture/network',
          const StandardMethodCodec().encodeMethodCall(
            const MethodCall('networkChanged'),
          ),
          (_) => done.complete(),
        );
        await done.future;
      }

      await notify();
      await notify();
      await tester.pump(const Duration(seconds: 2));
      expect(count, 1);
      await events.stop();
      await notify();
      await tester.pump(const Duration(seconds: 2));
      expect(count, 1);
    },
  );
  test('Wi-Fi, metered hotspot, battery saver and background matrix', () {
    expect(wifi.allows(attachments: true), isTrue);
    const cellular = SyncEnvironment(
      wifi: false,
      metered: true,
      powerSaver: false,
      batteryPercent: 100,
      charging: false,
    );
    expect(cellular.allows(attachments: false), isFalse);
    const hotspot = SyncEnvironment(
      wifi: true,
      metered: true,
      powerSaver: false,
      batteryPercent: 100,
      charging: false,
    );
    expect(hotspot.allows(attachments: false), isTrue);
    expect(hotspot.allows(attachments: true), isFalse);
    const low = SyncEnvironment(
      wifi: true,
      metered: false,
      powerSaver: false,
      batteryPercent: 19,
      charging: false,
    );
    expect(low.allows(attachments: false), isTrue);
    expect(low.allows(attachments: true), isFalse);
    expect(low.allows(attachments: false, background: true), isFalse);
  });
  test(
    'background share import never fires detached upload before policy check',
    () async {
      final sync = RecordingSyncClient();
      final controller = CaptureQueueController(
        MemoryCaptureStore(),
        MemoryConnectionStore(testConnection),
        syncClient: sync,
        syncEnvironmentProvider: Environment(
          const SyncEnvironment(
            wifi: true,
            metered: false,
            powerSaver: true,
            batteryPercent: 10,
            charging: false,
          ),
        ),
        attachmentIntake: MemoryAttachmentIntake([
          SharedCaptureInput(
            shareId: 'one',
            content: '灵感而非待办',
            createdAt: DateTime.now(),
            attachments: [],
          ),
        ]),
        backgroundWorker: true,
        autoDiscovery: false,
        scheduleRetries: false,
      );
      controller.syncDeadline = DateTime.now().add(const Duration(seconds: 40));
      await controller.load(syncImmediately: false, startDiscovery: false);
      await controller.syncPending();
      expect(controller.entries, hasLength(1));
      expect(controller.entries.single.syncState, CaptureSyncState.pending);
      expect(sync.uploadedIds, isEmpty);
      controller.dispose();
    },
  );
  test(
    'empty queue does not discover or upload; suspended foreground stays offline',
    () async {
      final sync = RecordingSyncClient();
      final controller = CaptureQueueController(
        MemoryCaptureStore(),
        MemoryConnectionStore(testConnection),
        syncClient: sync,
        syncEnvironmentProvider: Environment(wifi),
        autoDiscovery: false,
        scheduleRetries: false,
      );
      await controller.load();
      await controller.syncPending();
      expect(sync.uploadedIds, isEmpty);
      controller.setForeground(false);
      await controller.add('离线保存', CaptureHint.auto);
      await controller.syncPending();
      expect(sync.uploadedIds, isEmpty);
      controller.dispose();
    },
  );
}
