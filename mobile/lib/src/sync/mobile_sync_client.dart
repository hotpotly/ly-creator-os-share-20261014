import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter/services.dart';
import 'package:multicast_dns/multicast_dns.dart';

import '../model/capture_entry.dart';
import '../model/desktop_connection.dart';
import '../model/desktop_service.dart';
import 'attachment_byte_source.dart';

const mobileSyncProtocolV1 = 1;
const mobileSyncProtocolV2 = 2;
const mobileSyncServiceType = '_lycreator._tcp.local';
const _pairingCapabilities = <String>[
  'capture_attachments',
  'capture_text',
  'system_share',
];

typedef DesktopDiscovery = Future<List<DesktopService>> Function();
typedef AttachmentProgress =
    Future<void> Function(String attachmentId, List<int> uploadedChunks);
typedef UploadContinuation = Future<bool> Function();

class MobileSyncException implements Exception {
  const MobileSyncException(
    this.message, {
    this.requiresPairing = false,
    this.waitingForMac = false,
  });
  final String message;
  final bool requiresPairing;
  final bool waitingForMac;

  @override
  String toString() => message;
}

class MobileSyncPausedException extends MobileSyncException {
  const MobileSyncPausedException() : super('同步已暂停');
}

class MobileCaptureReceipt {
  const MobileCaptureReceipt({
    required this.mobileCaptureId,
    required this.desktopCaptureId,
    required this.duplicate,
  });
  final String mobileCaptureId;
  final String desktopCaptureId;
  final bool duplicate;
}

class MobileNoteReceipt {
  const MobileNoteReceipt({
    required this.mobileCaptureId,
    required this.desktopCaptureId,
    required this.notesRevision,
    required this.duplicate,
  });

  final String mobileCaptureId;
  final String desktopCaptureId;
  final int notesRevision;
  final bool duplicate;
}

class MobileAppUpdate {
  const MobileAppUpdate({
    required this.versionCode,
    required this.versionName,
    required this.sizeBytes,
    required this.sha256,
    required this.downloadUrl,
  });

  final int versionCode;
  final String versionName;
  final int sizeBytes;
  final String sha256;
  final String downloadUrl;
}

class PairingAttempt {
  const PairingAttempt({
    required this.service,
    required this.sessionId,
    required this.deviceId,
    required this.deviceName,
    required this.shortAuthenticationString,
    required this.expiresAt,
    required this.sessionKey,
    required this.deviceSecret,
  });

  final DesktopService service;
  final String sessionId;
  final String deviceId;
  final String deviceName;
  final String shortAuthenticationString;
  final DateTime expiresAt;
  final List<int> sessionKey;
  final List<int> deviceSecret;
}

String normalizeDesktopAddress(String value) {
  final normalized = value
      .trim()
      .replaceFirst(RegExp(r'^https?://', caseSensitive: false), '')
      .replaceAll(RegExp(r'/+$'), '');
  final match = RegExp(
    r'^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$',
  ).firstMatch(normalized);
  if (match == null) {
    throw const MobileSyncException('Mac自动发现地址无效');
  }
  final octets = match.group(1)!.split('.').map(int.parse).toList();
  final port = int.parse(match.group(2)!);
  if (octets.any((octet) => octet > 255) || port < 1 || port > 65535) {
    throw const MobileSyncException('Mac自动发现地址无效');
  }
  final private =
      octets[0] == 10 ||
      (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] == 192 && octets[1] == 168) ||
      octets[0] == 127;
  if (!private) {
    throw const MobileSyncException('只允许连接同一可信局域网内的Mac');
  }
  return normalized;
}

String mobileCaptureAad({
  required String deviceId,
  required String mobileCaptureId,
  required String createdAt,
  int protocolVersion = mobileSyncProtocolV2,
}) {
  return '$protocolVersion\n$deviceId\n$mobileCaptureId\n$createdAt';
}

String mobileUploadControlAad({
  required String deviceId,
  required String mobileCaptureId,
  required String messageType,
  required String createdAt,
}) =>
    '$mobileSyncProtocolV2\n$deviceId\n$mobileCaptureId\n$messageType\n$createdAt';

String mobileUploadChunkAad({
  required String deviceId,
  required String mobileCaptureId,
  required String attachmentId,
  required int chunkIndex,
}) =>
    '$mobileSyncProtocolV2\n$deviceId\n$mobileCaptureId\n$attachmentId\n$chunkIndex';

class MobileSyncClient {
  MobileSyncClient({
    HttpClient Function()? httpClientFactory,
    DesktopDiscovery? discovery,
    AttachmentByteSource? attachmentByteSource,
  }) : _httpClientFactory = httpClientFactory ?? _defaultClient,
       // ignore: prefer_initializing_formals
       _discovery = discovery,
       _attachmentByteSource =
           attachmentByteSource ?? const PlatformAttachmentByteSource();

  final HttpClient Function() _httpClientFactory;
  final DesktopDiscovery? _discovery;
  final AttachmentByteSource _attachmentByteSource;
  final AesGcm _cipher = AesGcm.with256bits();
  final X25519 _keyExchange = X25519();
  final Hmac _hmac = Hmac.sha256();
  final Random _random = Random.secure();
  static const _networkChannel = MethodChannel('ly.creator.capture/network');

  static HttpClient _defaultClient() =>
      HttpClient()..connectionTimeout = const Duration(seconds: 6);

  Future<List<DesktopService>> discoverServices() async {
    final override = _discovery;
    if (override != null) return override();
    final client = MDnsClient();
    var multicastLockHeld = false;
    try {
      if (Platform.isAndroid) {
        await _networkChannel.invokeMethod<void>('acquireMulticastLock');
        multicastLockHeld = true;
      }
      await client.start();
      final pointers = await client
          .lookup<PtrResourceRecord>(
            ResourceRecordQuery.serverPointer(mobileSyncServiceType),
            timeout: const Duration(seconds: 2),
          )
          .toList();
      final services = <String, DesktopService>{};
      for (final pointer in pointers) {
        final records = await client
            .lookup<SrvResourceRecord>(
              ResourceRecordQuery.service(pointer.domainName),
              timeout: const Duration(seconds: 2),
            )
            .toList();
        for (final record in records) {
          final txtFuture = client
              .lookup<TxtResourceRecord>(
                ResourceRecordQuery.text(pointer.domainName),
                timeout: const Duration(seconds: 2),
              )
              .toList();
          final ipFuture = client
              .lookup<IPAddressResourceRecord>(
                ResourceRecordQuery.addressIPv4(record.target),
                timeout: const Duration(seconds: 2),
              )
              .toList();
          final textRecords = await txtFuture;
          final addresses = await ipFuture;
          final attributes = _txtAttributes(textRecords);
          final serviceId = attributes['sid'];
          final protocolVersion = int.tryParse(attributes['pv'] ?? '');
          if (serviceId == null ||
              serviceId.isEmpty ||
              protocolVersion != mobileSyncProtocolV2) {
            continue;
          }
          for (final address in addresses) {
            final endpoint = normalizeDesktopAddress(
              '${address.address.address}:${record.port}',
            );
            services[serviceId] = DesktopService(
              serviceId: serviceId,
              name: _serviceDisplayName(pointer.domainName),
              address: endpoint,
              protocolVersion: protocolVersion!,
            );
          }
        }
      }
      final result = services.values.toList()
        ..sort((a, b) => a.name.compareTo(b.name));
      return result;
    } on MobileSyncException {
      rethrow;
    } on Object {
      throw const MobileSyncException('无法搜索同一Wi-Fi内的Mac，请确认Mac已开启接收');
    } finally {
      client.stop();
      if (multicastLockHeld) {
        await _networkChannel
            .invokeMethod<void>('releaseMulticastLock')
            .catchError((_) {});
      }
    }
  }

  Future<PairingAttempt> beginPairing({
    required DesktopService service,
    required String deviceName,
    DesktopConnection? upgradeConnection,
  }) async {
    if (service.protocolVersion != mobileSyncProtocolV2) {
      throw const MobileSyncException('这台Mac不支持安全连接');
    }
    final address = normalizeDesktopAddress(service.address);
    final cleanDeviceName = deviceName.trim();
    if (cleanDeviceName.isEmpty || cleanDeviceName.length > 80) {
      throw const MobileSyncException('设备名称需要1—80个字符');
    }
    final clientKeyPair = await _keyExchange.newKeyPair();
    final clientPublicKey = await clientKeyPair.extractPublicKey();
    if (clientPublicKey.bytes.length != 32) {
      throw const MobileSyncException('无法建立Android安全密钥');
    }
    final clientChallengeBytes = List<int>.generate(
      32,
      (_) => _random.nextInt(256),
    );
    final clientPublicKeyBase64 = base64Encode(clientPublicKey.bytes);
    final clientChallengeBase64 = base64Encode(clientChallengeBytes);
    final upgradeDeviceId = upgradeConnection?.deviceId;
    final hello = _clientHello(
      deviceName: cleanDeviceName,
      clientPublicKey: clientPublicKeyBase64,
      clientChallenge: clientChallengeBase64,
      upgradeDeviceId: upgradeDeviceId,
    );
    String? upgradeProof;
    if (upgradeConnection != null) {
      if (!upgradeConnection.needsSecurityUpgrade) {
        throw const MobileSyncException('当前连接已经是安全协议v2');
      }
      final legacySecret = _decodeSecret(upgradeConnection.secretBase64);
      upgradeProof = base64Encode(
        await _calculateHmac(
          legacySecret,
          'upgrade-start\n${jsonEncode(hello)}',
        ),
      );
    }
    final requestBody = <String, Object?>{...hello};
    if (upgradeProof != null) requestBody['upgradeProof'] = upgradeProof;
    final response = await _post(address, '/v2/pair/start', requestBody);
    if (response.statusCode != 200) throw _serverError(response);
    final body = response.body;
    final sessionId = body['sessionId'];
    final deviceId = body['deviceId'];
    final responseServiceId = body['serviceId'];
    final serverPublicKey = body['serverPublicKey'];
    final serverChallenge = body['serverChallenge'];
    final expiresAtText = body['expiresAt'];
    final serverProof = body['serverProof'];
    if (body.containsKey('secret') ||
        body['protocolVersion'] != mobileSyncProtocolV2 ||
        sessionId is! String ||
        deviceId is! String ||
        responseServiceId != service.serviceId ||
        serverPublicKey is! String ||
        serverChallenge is! String ||
        expiresAtText is! String ||
        serverProof is! String) {
      throw const MobileSyncException('Mac返回的安全连接信息无效');
    }
    final serverPublicKeyBytes = _decodeBase64(serverPublicKey, 32, 'Mac公钥无效');
    final serverChallengeBytes = _decodeBase64(serverChallenge, 32, 'Mac挑战无效');
    final proofBytes = _decodeBase64(serverProof, 32, 'Mac安全证明无效');
    final transcript = jsonEncode(<String, Object?>{
      'protocolVersion': mobileSyncProtocolV2,
      'sessionId': sessionId,
      'deviceId': deviceId,
      'serviceId': responseServiceId,
      'deviceName': cleanDeviceName,
      'clientPublicKey': clientPublicKeyBase64,
      'serverPublicKey': serverPublicKey,
      'clientChallenge': clientChallengeBase64,
      'serverChallenge': serverChallenge,
      'capabilities': [..._pairingCapabilities]..sort(),
      'upgradeDeviceId': upgradeDeviceId,
    });
    final sharedSecret = await _keyExchange.sharedSecretKey(
      keyPair: clientKeyPair,
      remotePublicKey: SimplePublicKey(
        serverPublicKeyBytes,
        type: KeyPairType.x25519,
      ),
    );
    final salt = (await Sha256().hash([
      ...clientChallengeBytes,
      ...serverChallengeBytes,
    ])).bytes;
    final derived = await Hkdf(hmac: Hmac.sha256(), outputLength: 64).deriveKey(
      secretKey: sharedSecret,
      nonce: salt,
      info: utf8.encode('ly-creator-mobile-pairing-v2\n$transcript'),
    );
    final derivedBytes = await derived.extractBytes();
    final sessionKey = derivedBytes.sublist(0, 32);
    final deviceSecret = derivedBytes.sublist(32, 64);
    final expectedProof = await _calculateHmac(
      sessionKey,
      'server-proof\n$transcript',
    );
    if (!_constantTimeEquals(proofBytes, expectedProof)) {
      throw const MobileSyncException('Mac安全证明不一致，请停止本次连接');
    }
    final sasBytes = await _calculateHmac(sessionKey, 'sas\n$transcript');
    final sasValue = ByteData.sublistView(
      Uint8List.fromList(sasBytes),
    ).getUint32(0, Endian.big);
    final expiresAt = DateTime.tryParse(expiresAtText);
    if (expiresAt == null || !expiresAt.isAfter(DateTime.now().toUtc())) {
      throw const MobileSyncException('数字核对已经超时，请重新连接');
    }
    return PairingAttempt(
      service: service,
      sessionId: sessionId,
      deviceId: deviceId,
      deviceName: cleanDeviceName,
      shortAuthenticationString: (sasValue % 1000000).toString().padLeft(
        6,
        '0',
      ),
      expiresAt: expiresAt,
      sessionKey: sessionKey,
      deviceSecret: deviceSecret,
    );
  }

  Future<DesktopConnection> waitForApproval(PairingAttempt attempt) async {
    while (DateTime.now().toUtc().isBefore(attempt.expiresAt)) {
      final proof = await _calculateHmac(
        attempt.sessionKey,
        'status\n${attempt.sessionId}',
      );
      final response = await _post(attempt.service.address, '/v2/pair/status', {
        'sessionId': attempt.sessionId,
        'proof': base64Encode(proof),
      });
      if (response.statusCode != 200) throw _serverError(response);
      final body = response.body;
      if (body['protocolVersion'] != mobileSyncProtocolV2 ||
          body['sessionId'] != attempt.sessionId ||
          body['deviceId'] != attempt.deviceId ||
          body['serviceId'] != attempt.service.serviceId ||
          body['secret'] != null) {
        throw const MobileSyncException('Mac返回的批准状态无效');
      }
      switch (body['state']) {
        case 'approved':
          return DesktopConnection(
            address: attempt.service.address,
            deviceId: attempt.deviceId,
            secretBase64: base64Encode(attempt.deviceSecret),
            deviceName: attempt.deviceName,
            protocolVersion: mobileSyncProtocolV2,
            serviceId: attempt.service.serviceId,
          );
        case 'rejected':
          throw const MobileSyncException('Mac已拒绝这台设备');
        case 'expired':
          throw const MobileSyncException('数字核对已经超时，请重新连接');
        case 'pending':
          await Future<void>.delayed(const Duration(seconds: 1));
        default:
          throw const MobileSyncException('Mac返回的批准状态无效');
      }
    }
    throw const MobileSyncException('数字核对已经超时，请重新连接');
  }

  Future<MobileCaptureReceipt> upload(
    DesktopConnection connection,
    CaptureEntry entry, {
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  }) async {
    // 网络层再次收敛标题，确保旧版本已经落盘的失败记录升级后也能重试。
    final uploadTitle = boundedCaptureTitle(
      entry.title.trim().isEmpty ? entry.displayTitle : entry.title,
    );
    final createdAt = entry.createdAt.toUtc().toIso8601String();
    final secretBytes = _decodeSecret(connection.secretBase64);
    final protocolVersion = connection.protocolVersion;
    if (protocolVersion != mobileSyncProtocolV1 &&
        protocolVersion != mobileSyncProtocolV2) {
      throw const MobileSyncException('本机连接协议无效，请重新连接', requiresPairing: true);
    }
    if (entry.attachments.isNotEmpty) {
      if (protocolVersion != mobileSyncProtocolV2) {
        throw const MobileSyncException('附件需要先完成安全升级', requiresPairing: true);
      }
      return _uploadWithAttachments(
        connection,
        entry,
        secretBytes,
        onAttachmentProgress,
        shouldContinue,
      );
    }
    final nonce = _cipher.newNonce();
    final box = await _cipher.encrypt(
      utf8.encode(
        jsonEncode({
          'content': entry.content,
          'hint': entry.hint.name,
          'title': uploadTitle,
          'sourceApp': entry.sourceApp,
          'sourceTitle': entry.sourceTitle,
          'sourceUrl': entry.sourceUrl,
          'notes': entry.notes,
          'recordingMarkersMs': entry.recordingMarkersMs,
          'recordingInterruptionReason': entry.recordingInterruptionReason,
        }),
      ),
      secretKey: SecretKey(secretBytes),
      nonce: nonce,
      aad: utf8.encode(
        mobileCaptureAad(
          deviceId: connection.deviceId,
          mobileCaptureId: entry.id,
          createdAt: createdAt,
          protocolVersion: protocolVersion,
        ),
      ),
    );
    final response =
        await _post(connection.address, '/v$protocolVersion/captures', {
          'protocolVersion': protocolVersion,
          'deviceId': connection.deviceId,
          'mobileCaptureId': entry.id,
          'createdAt': createdAt,
          'nonce': base64Encode(box.nonce),
          'ciphertext': base64Encode(box.cipherText),
          'tag': base64Encode(box.mac.bytes),
        });
    if (response.statusCode != 200) throw _serverError(response);
    if (protocolVersion == mobileSyncProtocolV2) {
      await _verifyUploadResponse(response.body, secretBytes);
    }
    final mobileCaptureId = response.body['mobileCaptureId'];
    final desktopCaptureId = response.body['desktopCaptureId'];
    final duplicate = response.body['duplicate'];
    if (mobileCaptureId != entry.id ||
        desktopCaptureId is! String ||
        duplicate is! bool) {
      throw const MobileSyncException('Mac回执与本地记录不一致');
    }
    return MobileCaptureReceipt(
      mobileCaptureId: mobileCaptureId as String,
      desktopCaptureId: desktopCaptureId,
      duplicate: duplicate,
    );
  }

  Future<MobileNoteReceipt> appendNotes(
    DesktopConnection connection,
    CaptureEntry entry,
  ) async {
    if (connection.protocolVersion != mobileSyncProtocolV2) {
      throw const MobileSyncException('追加备注需要先完成安全升级', requiresPairing: true);
    }
    if (!entry.hasPendingNoteSync || entry.notesRevision < 1) {
      throw const MobileSyncException('这条记录没有待同步备注');
    }
    final secretBytes = _decodeSecret(connection.secretBase64);
    final response = await _postEncryptedControl(
      connection,
      entry.id,
      secretBytes,
      'notes',
      {'revision': entry.notesRevision, 'notes': entry.notes},
    );
    if (response.statusCode != 200) throw _serverError(response);
    await _verifyUploadResponse(response.body, secretBytes);
    final mobileCaptureId = response.body['mobileCaptureId'];
    final desktopCaptureId = response.body['desktopCaptureId'];
    final notesRevision = response.body['notesRevision'];
    final duplicate = response.body['duplicate'];
    if (mobileCaptureId != entry.id ||
        desktopCaptureId != entry.desktopCaptureId ||
        notesRevision != entry.notesRevision ||
        duplicate is! bool) {
      throw const MobileSyncException('Mac追加备注回执与本地记录不一致');
    }
    return MobileNoteReceipt(
      mobileCaptureId: mobileCaptureId as String,
      desktopCaptureId: desktopCaptureId as String,
      notesRevision: notesRevision as int,
      duplicate: duplicate,
    );
  }

  Future<MobileAppUpdate?> checkForUpdate(
    DesktopConnection connection, {
    required int currentVersionCode,
  }) async {
    if (connection.protocolVersion != mobileSyncProtocolV2) {
      throw const MobileSyncException('App更新需要先完成安全升级', requiresPairing: true);
    }
    final secretBytes = _decodeSecret(connection.secretBase64);
    final response = await _postEncryptedControl(
      connection,
      'app-update',
      secretBytes,
      'update',
      {'currentVersionCode': currentVersionCode},
      path: '/v2/app/update/check',
    );
    if (response.statusCode != 200) throw _serverError(response);
    await _verifyUploadResponse(response.body, secretBytes);
    if (response.body['mobileCaptureId'] != 'app-update' ||
        response.body['available'] is! bool) {
      throw const MobileSyncException('Mac更新信息无效');
    }
    if (response.body['available'] != true) return null;
    final versionCode = response.body['versionCode'];
    final versionName = response.body['versionName'];
    final sizeBytes = response.body['sizeBytes'];
    final sha256 = response.body['sha256'];
    final ticket = response.body['ticket'];
    if (versionCode is! int ||
        versionCode <= currentVersionCode ||
        versionName is! String ||
        versionName.isEmpty ||
        sizeBytes is! int ||
        sizeBytes <= 0 ||
        sha256 is! String ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(sha256) ||
        ticket is! String ||
        ticket.isEmpty) {
      throw const MobileSyncException('Mac更新包元数据无效');
    }
    final address = normalizeDesktopAddress(connection.address);
    return MobileAppUpdate(
      versionCode: versionCode,
      versionName: versionName,
      sizeBytes: sizeBytes,
      sha256: sha256,
      downloadUrl:
          'http://$address/v2/app/update/download?ticket=${Uri.encodeQueryComponent(ticket)}',
    );
  }

  Future<MobileCaptureReceipt> _uploadWithAttachments(
    DesktopConnection connection,
    CaptureEntry entry,
    List<int> secretBytes,
    AttachmentProgress? onAttachmentProgress,
    UploadContinuation? shouldContinue,
  ) async {
    final start = await _postEncryptedControl(
      connection,
      entry.id,
      secretBytes,
      'start',
      {
        'content': entry.content,
        'hint': entry.hint.name,
        'title': boundedCaptureTitle(
          entry.title.trim().isEmpty ? entry.displayTitle : entry.title,
        ),
        'sourceApp': entry.sourceApp,
        'sourceTitle': entry.sourceTitle,
        'sourceUrl': entry.sourceUrl,
        'notes': entry.notes,
        'recordingMarkersMs': entry.recordingMarkersMs,
        'recordingInterruptionReason': entry.recordingInterruptionReason,
        'captureCreatedAt': entry.createdAt.toUtc().toIso8601String(),
        'attachments': entry.attachments
            .map(
              (attachment) => {
                'attachmentId': attachment.id,
                'attachmentKind': attachment.kind.name,
                'name': attachment.name,
                'mimeType': attachment.mimeType,
                'byteSize': attachment.sizeBytes,
                'sha256': attachment.sha256,
                'chunkCount': attachment.chunkCount,
                'sourceModifiedAt': attachment.sourceModifiedAt
                    ?.toUtc()
                    .toIso8601String(),
              },
            )
            .toList(),
      },
    );
    if (start.statusCode != 200) throw _serverError(start);
    await _verifyUploadResponse(start.body, secretBytes);
    final alreadyCommitted = _receiptFromUploadResponse(entry, start.body);
    if (alreadyCommitted != null) return alreadyCommitted;

    final missingByAttachment = _missingChunks(start.body, entry.attachments);
    for (final attachment in entry.attachments) {
      final missing =
          missingByAttachment[attachment.id] ??
          List<int>.generate(attachment.chunkCount, (index) => index);
      final uploaded = <int>{
        ...List<int>.generate(
          attachment.chunkCount,
          (index) => index,
        ).where((index) => !missing.contains(index)),
      };
      if (onAttachmentProgress != null) {
        await onAttachmentProgress(attachment.id, uploaded.toList()..sort());
      }
      if (!await _attachmentByteSource.exists(attachment)) {
        throw MobileSyncException('附件“${attachment.name}”的手机私有副本已丢失');
      }
      final actualSize = await _attachmentByteSource.clearSize(attachment);
      if (actualSize != attachment.sizeBytes) {
        throw MobileSyncException('附件“${attachment.name}”大小发生变化');
      }
      for (final chunkIndex in missing) {
        if (shouldContinue != null && !await shouldContinue()) {
          throw const MobileSyncPausedException();
        }
        final offset = chunkIndex * mobileAttachmentChunkBytes;
        final length = min(
          mobileAttachmentChunkBytes,
          attachment.sizeBytes - offset,
        );
        final bytes = await _attachmentByteSource.readChunk(
          attachment,
          chunkIndex,
        );
        if (bytes.length != length) {
          throw MobileSyncException('附件“${attachment.name}”读取中断');
        }
        final nonce = _cipher.newNonce();
        final box = await _cipher.encrypt(
          bytes,
          secretKey: SecretKey(secretBytes),
          nonce: nonce,
          aad: utf8.encode(
            mobileUploadChunkAad(
              deviceId: connection.deviceId,
              mobileCaptureId: entry.id,
              attachmentId: attachment.id,
              chunkIndex: chunkIndex,
            ),
          ),
        );
        final response = await _post(connection.address, '/v2/uploads/chunk', {
          'protocolVersion': mobileSyncProtocolV2,
          'deviceId': connection.deviceId,
          'mobileCaptureId': entry.id,
          'attachmentId': attachment.id,
          'chunkIndex': chunkIndex,
          'nonce': base64Encode(box.nonce),
          'ciphertext': base64Encode(box.cipherText),
          'tag': base64Encode(box.mac.bytes),
        });
        if (response.statusCode != 200) throw _serverError(response);
        await _verifyUploadResponse(response.body, secretBytes);
        if (response.body['mobileCaptureId'] != entry.id ||
            response.body['attachmentId'] != attachment.id ||
            response.body['chunkIndex'] != chunkIndex) {
          throw const MobileSyncException('Mac附件分块回执不一致');
        }
        uploaded.add(chunkIndex);
        if (onAttachmentProgress != null) {
          await onAttachmentProgress(attachment.id, uploaded.toList()..sort());
        }
      }
    }

    final committed = await _postEncryptedControl(
      connection,
      entry.id,
      secretBytes,
      'commit',
      const {},
    );
    if (committed.statusCode != 200) throw _serverError(committed);
    await _verifyUploadResponse(committed.body, secretBytes);
    final receipt = _receiptFromUploadResponse(entry, committed.body);
    if (receipt == null) {
      throw const MobileSyncException('Mac没有返回完整附件回执');
    }
    return receipt;
  }

  Future<_JsonResponse> _postEncryptedControl(
    DesktopConnection connection,
    String mobileCaptureId,
    List<int> secretBytes,
    String messageType,
    Map<String, Object?> payload, {
    String? path,
  }) async {
    final createdAt = DateTime.now().toUtc().toIso8601String();
    final nonce = _cipher.newNonce();
    final box = await _cipher.encrypt(
      utf8.encode(jsonEncode(payload)),
      secretKey: SecretKey(secretBytes),
      nonce: nonce,
      aad: utf8.encode(
        mobileUploadControlAad(
          deviceId: connection.deviceId,
          mobileCaptureId: mobileCaptureId,
          messageType: messageType,
          createdAt: createdAt,
        ),
      ),
    );
    return _post(connection.address, path ?? '/v2/uploads/$messageType', {
      'protocolVersion': mobileSyncProtocolV2,
      'deviceId': connection.deviceId,
      'mobileCaptureId': mobileCaptureId,
      'createdAt': createdAt,
      'nonce': base64Encode(box.nonce),
      'ciphertext': base64Encode(box.cipherText),
      'tag': base64Encode(box.mac.bytes),
    });
  }

  Map<String, List<int>> _missingChunks(
    Map<String, Object?> body,
    List<MobileAttachment> attachments,
  ) {
    final raw = body['attachments'];
    if (raw is! List) throw const MobileSyncException('Mac附件续传状态无效');
    final expected = {for (final item in attachments) item.id: item};
    final result = <String, List<int>>{};
    for (final item in raw) {
      if (item is! Map) throw const MobileSyncException('Mac附件续传状态无效');
      final value = item.cast<Object?, Object?>();
      final attachmentId = value['attachmentId'];
      final missing = value['missingChunks'];
      final attachment = expected[attachmentId];
      if (attachmentId is! String || attachment == null || missing is! List) {
        throw const MobileSyncException('Mac附件续传状态无效');
      }
      final indexes = missing
          .whereType<num>()
          .map((value) => value.toInt())
          .toList();
      if (indexes.length != missing.length ||
          indexes.toSet().length != indexes.length ||
          indexes.any((index) => index < 0 || index >= attachment.chunkCount)) {
        throw const MobileSyncException('Mac附件续传状态无效');
      }
      result[attachmentId] = indexes;
    }
    if (result.length != expected.length) {
      throw const MobileSyncException('Mac附件续传状态缺少附件');
    }
    return result;
  }

  Future<void> _verifyUploadResponse(
    Map<String, Object?> body,
    List<int> secretBytes,
  ) async {
    final proof = body['proof'];
    if (proof is! String) throw const MobileSyncException('Mac回执缺少安全证明');
    final unsigned = <String, Object?>{...body}..remove('proof');
    final expected = await _calculateHmac(
      secretBytes,
      'upload-response\n${jsonEncode(unsigned)}',
    );
    final actual = _decodeBase64(proof, 32, 'Mac回执安全证明无效');
    if (!_constantTimeEquals(actual, expected)) {
      throw const MobileSyncException('Mac回执安全证明不一致');
    }
  }

  MobileCaptureReceipt? _receiptFromUploadResponse(
    CaptureEntry entry,
    Map<String, Object?> body,
  ) {
    if (body['attachmentsCommitted'] != true) return null;
    final mobileCaptureId = body['mobileCaptureId'];
    final desktopCaptureId = body['desktopCaptureId'];
    final duplicate = body['duplicate'];
    final attachmentCount = body['attachmentCount'];
    if (mobileCaptureId != entry.id ||
        desktopCaptureId is! String ||
        duplicate is! bool ||
        attachmentCount != entry.attachments.length) {
      throw const MobileSyncException('Mac完整附件回执与本地记录不一致');
    }
    return MobileCaptureReceipt(
      mobileCaptureId: mobileCaptureId as String,
      desktopCaptureId: desktopCaptureId,
      duplicate: duplicate,
    );
  }

  Map<String, Object?> _clientHello({
    required String deviceName,
    required String clientPublicKey,
    required String clientChallenge,
    required String? upgradeDeviceId,
  }) => <String, Object?>{
    'protocolVersion': mobileSyncProtocolV2,
    'deviceName': deviceName,
    'clientPublicKey': clientPublicKey,
    'clientChallenge': clientChallenge,
    'capabilities': [..._pairingCapabilities]..sort(),
    'upgradeDeviceId': upgradeDeviceId,
  };

  Map<String, String> _txtAttributes(List<TxtResourceRecord> records) {
    final result = <String, String>{};
    for (final record in records) {
      for (final line in record.text.split(RegExp(r'[\r\n]+'))) {
        final equals = line.indexOf('=');
        if (equals > 0) {
          result[line.substring(0, equals)] = line.substring(equals + 1);
        }
      }
    }
    return result;
  }

  String _serviceDisplayName(String domainName) {
    const suffix = '._lycreator._tcp.local';
    final normalized = domainName.replaceFirst(RegExp(r'\.$'), '');
    final value = normalized.endsWith(suffix)
        ? normalized.substring(0, normalized.length - suffix.length)
        : normalized;
    return value.replaceAll(r'\032', ' ').replaceAll(r'\.', '.');
  }

  List<int> _decodeSecret(String encoded) {
    return _decodeBase64(encoded, 32, '本机连接密钥无效，请重新连接');
  }

  List<int> _decodeBase64(String value, int length, String message) {
    try {
      final bytes = base64Decode(value);
      if (bytes.length != length) throw const FormatException();
      return bytes;
    } on FormatException {
      throw MobileSyncException(
        message,
        requiresPairing: message.contains('重新连接'),
      );
    }
  }

  Future<List<int>> _calculateHmac(List<int> key, String value) async {
    final mac = await _hmac.calculateMac(
      utf8.encode(value),
      secretKey: SecretKey(key),
    );
    return mac.bytes;
  }

  bool _constantTimeEquals(List<int> left, List<int> right) {
    if (left.length != right.length) return false;
    var difference = 0;
    for (var index = 0; index < left.length; index += 1) {
      difference |= left[index] ^ right[index];
    }
    return difference == 0;
  }

  Future<_JsonResponse> _post(
    String address,
    String path,
    Map<String, Object?> body,
  ) async {
    final normalizedAddress = normalizeDesktopAddress(address);
    final client = _httpClientFactory();
    try {
      final request = await client
          .postUrl(Uri.parse('http://$normalizedAddress$path'))
          .timeout(const Duration(seconds: 8));
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
      final response = await request.close().timeout(
        const Duration(seconds: 12),
      );
      final raw = await utf8.decoder
          .bind(response)
          .join()
          .timeout(const Duration(seconds: 12));
      final decoded = raw.isEmpty ? <String, Object?>{} : jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        throw const MobileSyncException('Mac返回格式无效');
      }
      return _JsonResponse(
        response.statusCode,
        decoded.cast<String, Object?>(),
      );
    } on SocketException {
      throw const MobileSyncException(
        '等待主Mac连接，请确认两台设备在同一Wi-Fi且Mac已开启接收',
        waitingForMac: true,
      );
    } on HttpException {
      throw const MobileSyncException('主Mac连接中断，等待恢复', waitingForMac: true);
    } on TimeoutException {
      throw const MobileSyncException('等待主Mac响应', waitingForMac: true);
    } on FormatException {
      throw const MobileSyncException('Mac返回格式无效');
    } finally {
      client.close(force: true);
    }
  }

  MobileSyncException _serverError(_JsonResponse response) {
    final message = response.body['message'];
    final requiresPairing = response.statusCode == 401;
    return MobileSyncException(
      message is String && message.isNotEmpty ? message : 'Mac拒绝了本次同步',
      requiresPairing: requiresPairing,
    );
  }
}

class _JsonResponse {
  const _JsonResponse(this.statusCode, this.body);
  final int statusCode;
  final Map<String, Object?> body;
}

Uint8List decodeBase64Bytes(String value) =>
    Uint8List.fromList(base64Decode(value));
