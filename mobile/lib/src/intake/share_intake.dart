import 'package:flutter/services.dart';

import '../model/capture_entry.dart';

class SharedCaptureInput {
  const SharedCaptureInput({
    required this.shareId,
    required this.content,
    required this.createdAt,
    required this.attachments,
    this.sourceApp,
    this.sourceTitle,
    this.sourceUrl,
    this.recordingMarkersMs = const [],
    this.recordingInterruptionReason,
    this.error,
  });

  final String shareId;
  final String content;
  final DateTime createdAt;
  final List<MobileAttachment> attachments;
  final String? sourceApp;
  final String? sourceTitle;
  final String? sourceUrl;
  final List<int> recordingMarkersMs;
  final String? recordingInterruptionReason;
  final String? error;

  static SharedCaptureInput fromMap(Map<Object?, Object?> value) {
    final attachments =
        (value['attachments'] as List?)?.whereType<Map>().map((item) {
          final map = item.cast<Object?, Object?>();
          final sizeBytes = (map['sizeBytes'] as num?)?.toInt() ?? 0;
          final name = map['name'] as String? ?? '未命名文件';
          final mimeType =
              map['mimeType'] as String? ?? 'application/octet-stream';
          return MobileAttachment(
            id: map['attachmentId']! as String,
            localPath: map['localPath']! as String,
            name: name,
            mimeType: mimeType,
            sizeBytes: sizeBytes,
            sha256: map['sha256']! as String,
            kind: attachmentKindFor(name, mimeType),
            chunkCount:
                (sizeBytes + mobileAttachmentChunkBytes - 1) ~/
                mobileAttachmentChunkBytes,
            encryptedAtRest: map['encryptedAtRest'] as bool? ?? false,
            sourceModifiedAt: DateTime.tryParse(
              map['sourceModifiedAt'] as String? ?? '',
            )?.toUtc(),
            previewAttachmentId: map['previewAttachmentId'] as String?,
            previewLocalPath: map['previewLocalPath'] as String?,
          );
        }).toList() ??
        const [];
    return SharedCaptureInput(
      shareId: value['shareId']! as String,
      content: value['content'] as String? ?? '',
      createdAt:
          DateTime.tryParse(value['createdAt'] as String? ?? '')?.toUtc() ??
          DateTime.now().toUtc(),
      attachments: attachments,
      sourceApp: value['sourceApp'] as String?,
      sourceTitle: value['sourceTitle'] as String?,
      sourceUrl: value['sourceUrl'] as String?,
      recordingMarkersMs:
          (value['recordingMarkersMs'] as List?)
              ?.whereType<num>()
              .map((value) => value.toInt())
              .toList() ??
          const [],
      recordingInterruptionReason:
          value['recordingInterruptionReason'] as String?,
      error: value['error'] as String?,
    );
  }
}

MobileAttachmentKind attachmentKindFor(String name, String mimeType) {
  final mime = mimeType.toLowerCase();
  final lowerName = name.toLowerCase();
  if (mime.startsWith('image/')) return MobileAttachmentKind.image;
  if (mime.startsWith('video/')) return MobileAttachmentKind.video;
  if (mime.startsWith('audio/')) return MobileAttachmentKind.audio;
  if (mime == 'application/pdf' || lowerName.endsWith('.pdf')) {
    return MobileAttachmentKind.pdf;
  }
  if (mime.contains('word') ||
      lowerName.endsWith('.doc') ||
      lowerName.endsWith('.docx')) {
    return MobileAttachmentKind.word;
  }
  return MobileAttachmentKind.file;
}

List<SharedCaptureInput> parsePendingSharedCaptures(Iterable<Object?> values) {
  final result = <SharedCaptureInput>[];
  for (final raw in values) {
    if (raw is! Map) continue;
    final value = raw.cast<Object?, Object?>();
    try {
      result.add(SharedCaptureInput.fromMap(value));
    } catch (error) {
      final shareId = value['shareId'];
      if (shareId is! String || shareId.isEmpty) continue;
      result.add(
        SharedCaptureInput(
          shareId: shareId,
          content: '',
          createdAt: DateTime.now().toUtc(),
          attachments: const [],
          error: '系统分享记录损坏：$error',
        ),
      );
    }
  }
  return result;
}

abstract interface class AttachmentIntake {
  void setOnShareReady(void Function() callback);
  Future<List<SharedCaptureInput>> listPendingShares();
  Future<SharedCaptureInput?> pickFiles();
  Future<SharedCaptureInput?> pickMedia();
  Future<SharedCaptureInput?> takePhoto();
  Future<void> acknowledge(String shareId);
}

class NativeShareIntake implements AttachmentIntake {
  NativeShareIntake() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'shareReady') _onShareReady?.call();
    });
  }

  static const _channel = MethodChannel('ly.creator.capture/share_intake');
  void Function()? _onShareReady;

  @override
  void setOnShareReady(void Function() callback) => _onShareReady = callback;

  @override
  Future<List<SharedCaptureInput>> listPendingShares() async {
    final values = await _channel.invokeListMethod<Object?>(
      'listPendingShares',
    );
    return parsePendingSharedCaptures(values ?? const []);
  }

  @override
  Future<SharedCaptureInput?> pickFiles() async {
    final value = await _channel.invokeMapMethod<Object?, Object?>('pickFiles');
    return value == null ? null : SharedCaptureInput.fromMap(value);
  }

  @override
  Future<SharedCaptureInput?> pickMedia() async {
    final value = await _channel.invokeMapMethod<Object?, Object?>('pickMedia');
    return value == null ? null : SharedCaptureInput.fromMap(value);
  }

  @override
  Future<SharedCaptureInput?> takePhoto() async {
    final value = await _channel.invokeMapMethod<Object?, Object?>('takePhoto');
    return value == null ? null : SharedCaptureInput.fromMap(value);
  }

  @override
  Future<void> acknowledge(String shareId) =>
      _channel.invokeMethod<void>('acknowledgeShare', {'shareId': shareId});
}
