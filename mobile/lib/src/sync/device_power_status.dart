import 'package:flutter/services.dart';

class DevicePowerStatus {
  const DevicePowerStatus({
    required this.batteryPercent,
    required this.charging,
  });

  final int batteryPercent;
  final bool charging;

  bool get shouldPauseLargeTransfers => batteryPercent < 20 && !charging;
}

abstract interface class DevicePowerStatusProvider {
  Future<DevicePowerStatus> read();
}

class NativeDevicePowerStatusProvider implements DevicePowerStatusProvider {
  const NativeDevicePowerStatusProvider();

  static const _channel = MethodChannel('ly.creator.capture/device_status');

  @override
  Future<DevicePowerStatus> read() async {
    final value = await _channel.invokeMapMethod<Object?, Object?>('getPower');
    return DevicePowerStatus(
      batteryPercent: (value?['batteryPercent'] as num?)?.toInt() ?? 100,
      charging: value?['charging'] as bool? ?? true,
    );
  }
}

class UnrestrictedDevicePowerStatusProvider
    implements DevicePowerStatusProvider {
  const UnrestrictedDevicePowerStatusProvider();

  @override
  Future<DevicePowerStatus> read() async =>
      const DevicePowerStatus(batteryPercent: 100, charging: true);
}
