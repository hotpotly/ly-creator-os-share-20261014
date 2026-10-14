import 'dart:io';
import 'dart:math';

import 'package:flutter/services.dart';

import '../model/capture_entry.dart';

abstract interface class AttachmentByteSource {
  Future<bool> exists(MobileAttachment attachment);
  Future<int> clearSize(MobileAttachment attachment);
  Future<Uint8List> readChunk(MobileAttachment attachment, int chunkIndex);
}

class PlatformAttachmentByteSource implements AttachmentByteSource {
  const PlatformAttachmentByteSource();

  static const _channel = MethodChannel(
    'ly.creator.capture/attachment_storage',
  );

  @override
  Future<bool> exists(MobileAttachment attachment) async {
    if (!attachment.encryptedAtRest) {
      return File(attachment.localPath).exists();
    }
    return await _channel.invokeMethod<bool>('exists', {
          'path': attachment.localPath,
          'attachmentId': attachment.id,
        }) ??
        false;
  }

  @override
  Future<int> clearSize(MobileAttachment attachment) async {
    if (!attachment.encryptedAtRest) {
      return File(attachment.localPath).length();
    }
    final size = await _channel.invokeMethod<int>('clearSize', {
      'path': attachment.localPath,
      'attachmentId': attachment.id,
    });
    if (size == null) throw const FileSystemException('无法读取加密附件大小');
    return size;
  }

  @override
  Future<Uint8List> readChunk(
    MobileAttachment attachment,
    int chunkIndex,
  ) async {
    if (attachment.encryptedAtRest) {
      final bytes = await _channel.invokeMethod<Uint8List>('readChunk', {
        'path': attachment.localPath,
        'attachmentId': attachment.id,
        'chunkIndex': chunkIndex,
      });
      if (bytes == null) throw const FileSystemException('无法读取加密附件分块');
      return bytes;
    }
    final offset = chunkIndex * mobileAttachmentChunkBytes;
    final length = min(
      mobileAttachmentChunkBytes,
      attachment.sizeBytes - offset,
    );
    final input = await File(attachment.localPath).open(mode: FileMode.read);
    try {
      await input.setPosition(offset);
      return Uint8List.fromList(await input.read(length));
    } finally {
      await input.close();
    }
  }
}
