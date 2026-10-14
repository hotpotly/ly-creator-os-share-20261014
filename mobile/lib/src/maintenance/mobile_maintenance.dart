import 'package:flutter/services.dart';

import '../model/capture_entry.dart';

class MobileSetupStatus {
  const MobileSetupStatus({
    required this.microphone,
    required this.camera,
    required this.notifications,
    required this.batteryUnrestricted,
    required this.installUpdates,
    required this.isOppo,
    required this.appVersion,
    required this.appVersionCode,
  });

  final bool microphone;
  final bool camera;
  final bool notifications;
  final bool batteryUnrestricted;
  final bool installUpdates;
  final bool isOppo;
  final String appVersion;
  final int appVersionCode;

  bool get coreReady => microphone && camera && notifications;

  factory MobileSetupStatus.fromMap(Map<Object?, Object?> map) =>
      MobileSetupStatus(
        microphone: map['microphone'] == true,
        camera: map['camera'] == true,
        notifications: map['notifications'] == true,
        batteryUnrestricted: map['batteryUnrestricted'] == true,
        installUpdates: map['installUpdates'] == true,
        isOppo: map['isOppo'] == true,
        appVersion: map['appVersion'] as String? ?? '',
        appVersionCode: (map['appVersionCode'] as num?)?.toInt() ?? 0,
      );
}

abstract interface class MobileMaintenance {
  void setQuickActionHandler(void Function(String action)? handler);
  Future<void> setScreenProtection(bool enabled);
  Future<void> deletePrivateCopies(List<MobileAttachment> attachments);
  Future<void> share(CaptureEntry entry, {String? attachmentId});
  Future<int> appStorageBytes();
  Future<MobileSetupStatus> setupStatus();
  Future<MobileSetupStatus> requestCorePermissions();
  Future<void> openBatterySettings();
  Future<void> openAutoStartSettings();
  Future<void> openInstallSettings();
  Future<bool> authenticate(String reason);
  Future<void> exportDiagnostics(Map<String, Object?> diagnostics);
  Future<void> updateWidget({
    required int pendingCount,
    required bool recording,
  });
  Future<String?> consumeQuickAction();
  Future<void> installUpdate({
    required String url,
    required String sha256,
    required int sizeBytes,
    required int versionCode,
  });
}

class NativeMobileMaintenance implements MobileMaintenance {
  const NativeMobileMaintenance();

  static const _channel = MethodChannel('ly.creator.capture/maintenance');

  @override
  void setQuickActionHandler(void Function(String action)? handler) {
    _channel.setMethodCallHandler(
      handler == null
          ? null
          : (call) async {
              if (call.method == 'quickAction' && call.arguments is String) {
                handler(call.arguments as String);
              }
            },
    );
  }

  @override
  Future<void> setScreenProtection(bool enabled) =>
      _channel.invokeMethod<void>('setScreenProtection', {'enabled': enabled});

  List<Map<String, Object?>> _attachmentArguments(
    List<MobileAttachment> attachments,
  ) => attachments
      .map(
        (attachment) => {
          'attachmentId': attachment.id,
          'path': attachment.localPath,
          'name': attachment.name,
          'mimeType': attachment.mimeType,
          'previewAttachmentId': attachment.previewAttachmentId,
          'previewPath': attachment.previewLocalPath,
        },
      )
      .toList();

  @override
  Future<void> deletePrivateCopies(List<MobileAttachment> attachments) =>
      _channel.invokeMethod<void>('deletePrivateCopies', {
        'attachments': _attachmentArguments(attachments),
      });

  @override
  Future<void> share(CaptureEntry entry, {String? attachmentId}) =>
      _channel.invokeMethod<void>('shareCapture', {
        'title': entry.displayTitle,
        'content': entry.content,
        'notes': entry.notes,
        'attachments': _attachmentArguments(
          attachmentId == null
              ? entry.attachments
              : entry.attachments
                    .where((item) => item.id == attachmentId)
                    .toList(),
        ),
      });

  @override
  Future<int> appStorageBytes() async =>
      await _channel.invokeMethod<int>('appStorageBytes') ?? 0;

  @override
  Future<MobileSetupStatus> setupStatus() async {
    final result = await _channel.invokeMapMethod<Object?, Object?>(
      'setupStatus',
    );
    return MobileSetupStatus.fromMap(result ?? const {});
  }

  @override
  Future<MobileSetupStatus> requestCorePermissions() async {
    final result = await _channel.invokeMapMethod<Object?, Object?>(
      'requestCorePermissions',
    );
    return MobileSetupStatus.fromMap(result ?? const {});
  }

  @override
  Future<void> openBatterySettings() =>
      _channel.invokeMethod<void>('openBatterySettings');

  @override
  Future<void> openAutoStartSettings() =>
      _channel.invokeMethod<void>('openAutoStartSettings');

  @override
  Future<void> openInstallSettings() =>
      _channel.invokeMethod<void>('openInstallSettings');

  @override
  Future<bool> authenticate(String reason) async =>
      await _channel.invokeMethod<bool>('authenticate', {'reason': reason}) ??
      false;

  @override
  Future<void> exportDiagnostics(Map<String, Object?> diagnostics) =>
      _channel.invokeMethod<void>('exportDiagnostics', diagnostics);

  @override
  Future<void> updateWidget({
    required int pendingCount,
    required bool recording,
  }) => _channel.invokeMethod<void>('updateWidget', {
    'pendingCount': pendingCount,
    'recording': recording,
  });

  @override
  Future<String?> consumeQuickAction() =>
      _channel.invokeMethod<String>('consumeQuickAction');

  @override
  Future<void> installUpdate({
    required String url,
    required String sha256,
    required int sizeBytes,
    required int versionCode,
  }) => _channel.invokeMethod<void>('installUpdate', {
    'url': url,
    'sha256': sha256,
    'sizeBytes': sizeBytes,
    'versionCode': versionCode,
  });
}
