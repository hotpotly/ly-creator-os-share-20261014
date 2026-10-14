import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';

import '../controller/capture_queue_controller.dart';
import '../intake/share_intake.dart';
import '../storage/secure_connection_store.dart';
import '../storage/sqlite_capture_store.dart';
import 'sync_policy.dart';

const _periodicTaskName = 'ly.creator.capture.periodic-sync-v1';
const _immediateTaskName = 'ly.creator.capture.immediate-sync-v1';

@pragma('vm:entry-point')
void mobileSyncCallbackDispatcher() {
  Workmanager().executeTask((taskName, inputData) async {
    WidgetsFlutterBinding.ensureInitialized();
    SqliteCaptureStore? store;
    CaptureQueueController? controller;
    try {
      store = await SqliteCaptureStore.create();
      controller = CaptureQueueController(
        store,
        const SecureConnectionStore(),
        attachmentIntake: NativeShareIntake(),
        autoDiscovery: false,
        scheduleRetries: false,
        backgroundWorker: true,
      );
      controller.syncDeadline = DateTime.now().add(const Duration(seconds: 40));
      await controller.load(
        importShares: true,
        syncImmediately: false,
        startDiscovery: false,
      );
      if (controller.syncPaused ||
          controller.connection == null ||
          controller.pendingCount == 0) {
        return true;
      }
      if (!(await const NativeSyncEnvironmentProvider().read()).allows(
        attachments: false,
        background: true,
      )) {
        return true;
      }
      await controller.refreshDiscovery(syncAfterRefresh: false);
      await controller.syncPending();
      return true;
    } catch (_) {
      // The periodic job and the app's foreground retry loop will try again.
      // Returning success avoids a noisy OS retry storm when the Mac is asleep.
      return true;
    } finally {
      final activeController = controller;
      if (activeController != null) {
        try {
          await const MethodChannel(
            'ly.creator.capture/attachment_storage',
          ).invokeMethod<void>('updateWidgetPending', {
            'pendingCount': activeController.pendingCount,
          });
        } catch (_) {
          // Widget status is best-effort and must not turn a sync into a retry storm.
        }
        activeController.dispose();
      }
      await store?.close();
    }
  });
}

Future<void> initializeBackgroundSync() async {
  await Workmanager().initialize(mobileSyncCallbackDispatcher);
  await Workmanager().cancelByUniqueName(_periodicTaskName);
}

Future<void> scheduleBackgroundSyncNow({required bool hasPendingWork}) async {
  if (!hasPendingWork) {
    await Workmanager().cancelByUniqueName(_immediateTaskName);
    return;
  }
  await Workmanager().registerOneOffTask(
    _immediateTaskName,
    _immediateTaskName,
    initialDelay: const Duration(seconds: 30),
    constraints: Constraints(
      requiresStorageNotLow: true,
      requiresBatteryNotLow: true,
      networkType: NetworkType.unmetered,
    ),
    existingWorkPolicy: ExistingWorkPolicy.keep,
    backoffPolicy: BackoffPolicy.exponential,
    backoffPolicyDelay: const Duration(minutes: 15),
  );
}
