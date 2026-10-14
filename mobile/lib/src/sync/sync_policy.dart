import 'dart:async';
import 'package:flutter/services.dart';

class SyncEnvironment {
  const SyncEnvironment({
    required this.wifi,
    required this.metered,
    required this.powerSaver,
    required this.batteryPercent,
    required this.charging,
  });
  final bool wifi;
  final bool metered;
  final bool powerSaver;
  final int batteryPercent;
  final bool charging;
  bool get lowPower => powerSaver || (batteryPercent < 20 && !charging);
  bool allows({required bool attachments, bool background = false}) =>
      wifi &&
      (!attachments || !metered) &&
      (!(attachments || background) || !lowPower);
}

abstract class SyncEnvironmentProvider {
  const SyncEnvironmentProvider();
  Future<bool> acquireWifi() async => true;
  Future<void> releaseWifi() async {}
  Future<SyncEnvironment> read();
}

class NativeSyncEnvironmentProvider extends SyncEnvironmentProvider {
  const NativeSyncEnvironmentProvider();
  @override
  Future<bool> acquireWifi() async {
    try {
      return await const MethodChannel(
            'ly.creator.capture/device_status',
          ).invokeMethod<bool>('acquireLocalWifi') ??
          false;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> releaseWifi() async {
    try {
      await const MethodChannel(
        'ly.creator.capture/device_status',
      ).invokeMethod<void>('releaseLocalWifi');
    } catch (_) {}
  }

  @override
  Future<SyncEnvironment> read() async {
    try {
      final map = await const MethodChannel(
        'ly.creator.capture/device_status',
      ).invokeMapMethod<String, dynamic>('getSyncEnvironment');
      return SyncEnvironment(
        wifi: map?['wifi'] == true,
        metered: map?['metered'] != false,
        powerSaver: map?['powerSaver'] != false,
        batteryPercent: (map?['batteryPercent'] as num?)?.toInt() ?? 0,
        charging: map?['charging'] == true,
      );
    } catch (_) {
      return const SyncEnvironment(
        wifi: false,
        metered: true,
        powerSaver: true,
        batteryPercent: 0,
        charging: false,
      );
    }
  }
}

class ForegroundNetworkEvents {
  ForegroundNetworkEvents(this.onChanged);
  final void Function() onChanged;
  static const channel = MethodChannel('ly.creator.capture/network');
  Timer? _debounce;
  bool _active = false;
  Future<void> start() async {
    if (_active) return;
    _active = true;
    channel.setMethodCallHandler((call) async {
      if (!_active || call.method != 'networkChanged') return;
      _debounce?.cancel();
      _debounce = Timer(const Duration(seconds: 1), () {
        if (_active) onChanged();
      });
    });
    try {
      await channel.invokeMethod<void>('startNetworkEvents');
    } catch (_) {}
  }

  Future<void> stop() async {
    _active = false;
    _debounce?.cancel();
    try {
      await channel.invokeMethod<void>('stopNetworkEvents');
    } catch (_) {}
  }
}
