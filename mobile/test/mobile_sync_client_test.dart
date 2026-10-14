import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/capture_entry.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/model/desktop_service.dart';
import 'package:ly_creator_capture/src/sync/attachment_byte_source.dart';
import 'package:ly_creator_capture/src/sync/mobile_sync_client.dart';

void writeJson(HttpResponse response, int status, Map<String, Object?> body) {
  response.statusCode = status;
  response.headers.contentType = ContentType.json;
  response.write(jsonEncode(body));
  response.close();
}

Future<List<int>> calculateHmac(List<int> key, String value) async {
  final mac = await Hmac.sha256().calculateMac(
    utf8.encode(value),
    secretKey: SecretKey(key),
  );
  return mac.bytes;
}

class MockMac {
  MockMac({
    this.legacySecret,
    this.legacyDeviceId,
    this.tamperProof = false,
    this.tamperReceiptProof = false,
  });

  static const serviceId = 'mac-service-id';
  static const deviceId = '550e8400-e29b-41d4-a716-446655440000';
  final List<int>? legacySecret;
  final String? legacyDeviceId;
  final bool tamperProof;
  final bool tamperReceiptProof;
  late final HttpServer server;
  late List<int> sessionKey;
  late List<int> deviceSecret;
  late String sas;
  String decryptedText = '';
  bool requestContainedPlaintext = false;
  bool startContainedSecret = false;
  bool upgradeProofValid = false;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final raw = await utf8.decoder.bind(request).join();
      final body = raw.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(raw) as Map<String, dynamic>;
      if (request.uri.path == '/v2/pair/start') {
        startContainedSecret = body.containsKey('secret');
        final x25519 = X25519();
        final serverKeyPair = await x25519.newKeyPair();
        final serverPublicKey = await serverKeyPair.extractPublicKey();
        final serverPublicKeyBase64 = base64Encode(serverPublicKey.bytes);
        final serverChallenge = List<int>.generate(32, (index) => index + 11);
        final serverChallengeBase64 = base64Encode(serverChallenge);
        final sessionId = '660e8400-e29b-41d4-a716-446655440000';
        final responseDeviceId = legacyDeviceId ?? deviceId;
        final hello = <String, Object?>{
          'protocolVersion': 2,
          'deviceName': body['deviceName'],
          'clientPublicKey': body['clientPublicKey'],
          'clientChallenge': body['clientChallenge'],
          'capabilities': [...(body['capabilities'] as List)]..sort(),
          'upgradeDeviceId': body['upgradeDeviceId'],
        };
        if (legacySecret != null) {
          final expected = await calculateHmac(
            legacySecret!,
            'upgrade-start\n${jsonEncode(hello)}',
          );
          upgradeProofValid =
              Mac(expected) ==
              Mac(base64Decode(body['upgradeProof'] as String));
        }
        final transcript = jsonEncode(<String, Object?>{
          'protocolVersion': 2,
          'sessionId': sessionId,
          'deviceId': responseDeviceId,
          'serviceId': serviceId,
          'deviceName': body['deviceName'],
          'clientPublicKey': body['clientPublicKey'],
          'serverPublicKey': serverPublicKeyBase64,
          'clientChallenge': body['clientChallenge'],
          'serverChallenge': serverChallengeBase64,
          'capabilities': [...(body['capabilities'] as List)]..sort(),
          'upgradeDeviceId': body['upgradeDeviceId'],
        });
        final shared = await x25519.sharedSecretKey(
          keyPair: serverKeyPair,
          remotePublicKey: SimplePublicKey(
            base64Decode(body['clientPublicKey'] as String),
            type: KeyPairType.x25519,
          ),
        );
        final salt = (await Sha256().hash([
          ...base64Decode(body['clientChallenge'] as String),
          ...serverChallenge,
        ])).bytes;
        final derived = await Hkdf(hmac: Hmac.sha256(), outputLength: 64)
            .deriveKey(
              secretKey: shared,
              nonce: salt,
              info: utf8.encode('ly-creator-mobile-pairing-v2\n$transcript'),
            );
        final derivedBytes = await derived.extractBytes();
        sessionKey = derivedBytes.sublist(0, 32);
        deviceSecret = derivedBytes.sublist(32);
        final sasBytes = await calculateHmac(sessionKey, 'sas\n$transcript');
        final sasNumber =
            (sasBytes[0] << 24) |
            (sasBytes[1] << 16) |
            (sasBytes[2] << 8) |
            sasBytes[3];
        sas = (sasNumber % 1000000).toString().padLeft(6, '0');
        final proof = tamperProof
            ? List<int>.filled(32, 0)
            : await calculateHmac(sessionKey, 'server-proof\n$transcript');
        writeJson(request.response, 200, {
          'protocolVersion': 2,
          'sessionId': sessionId,
          'deviceId': responseDeviceId,
          'serviceId': serviceId,
          'serverPublicKey': serverPublicKeyBase64,
          'serverChallenge': serverChallengeBase64,
          'expiresAt': DateTime.now()
              .toUtc()
              .add(const Duration(minutes: 2))
              .toIso8601String(),
          'serverProof': base64Encode(proof),
        });
        return;
      }
      if (request.uri.path == '/v2/pair/status') {
        final expected = await calculateHmac(
          sessionKey,
          'status\n${body['sessionId']}',
        );
        expect(Mac(base64Decode(body['proof'] as String)), Mac(expected));
        writeJson(request.response, 200, {
          'protocolVersion': 2,
          'sessionId': body['sessionId'],
          'deviceId': legacyDeviceId ?? deviceId,
          'serviceId': serviceId,
          'state': 'approved',
        });
        return;
      }
      if (request.uri.path == '/v2/captures') {
        const noteText = '正文不会直接出现在HTTP请求里';
        requestContainedPlaintext = raw.contains(noteText);
        final createdAt = body['createdAt']! as String;
        final box = SecretBox(
          base64Decode(body['ciphertext']! as String),
          nonce: base64Decode(body['nonce']! as String),
          mac: Mac(base64Decode(body['tag']! as String)),
        );
        final clear = await AesGcm.with256bits().decrypt(
          box,
          secretKey: SecretKey(deviceSecret),
          aad: utf8.encode(
            mobileCaptureAad(
              deviceId: body['deviceId']! as String,
              mobileCaptureId: body['mobileCaptureId']! as String,
              createdAt: createdAt,
              protocolVersion: 2,
            ),
          ),
        );
        decryptedText =
            (jsonDecode(utf8.decode(clear)) as Map<String, dynamic>)['content']!
                as String;
        final receipt = <String, Object?>{
          'protocolVersion': 2,
          'mobileCaptureId': body['mobileCaptureId'],
          'desktopCaptureId': 'desktop-capture-1',
          'duplicate': false,
          'classificationStatus': 'suggested',
          'attachmentCount': 0,
          'attachmentsCommitted': true,
        };
        final proof = tamperReceiptProof
            ? List<int>.filled(32, 0)
            : await calculateHmac(
                deviceSecret,
                'upload-response\n${jsonEncode(receipt)}',
              );
        writeJson(request.response, 200, {
          ...receipt,
          'proof': base64Encode(proof),
        });
        return;
      }
      writeJson(request.response, 404, {'error': 'not_found'});
    });
  }

  DesktopService get service => DesktopService(
    serviceId: serviceId,
    name: 'LY Creator OS-测试',
    address: '127.0.0.1:${server.port}',
    protocolVersion: 2,
  );
}

class MockAttachmentMac {
  MockAttachmentMac(this.secret, this.expectedBytes);

  final List<int> secret;
  final List<int> expectedBytes;
  late final HttpServer server;
  final receivedChunks = <int, List<int>>{};
  bool requestLeakedName = false;

  Future<void> start() async {
    receivedChunks[0] = expectedBytes.sublist(0, mobileAttachmentChunkBytes);
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final raw = await utf8.decoder.bind(request).join();
      final body = jsonDecode(raw) as Map<String, dynamic>;
      requestLeakedName = requestLeakedName || raw.contains('resume-photo.jpg');
      if (request.uri.path == '/v2/uploads/start') {
        final clear = await _decryptControl(body, 'start');
        expect(
          (clear['attachments'] as List).single['name'],
          'resume-photo.jpg',
        );
        await _signed(request.response, {
          'protocolVersion': 2,
          'mobileCaptureId': body['mobileCaptureId'],
          'state': 'receiving',
          'committedCaptureId': null,
          'attachments': [
            {
              'attachmentId': 'attachment-1',
              'state': 'receiving',
              'receivedCount': 1,
              'chunkCount': 2,
              'missingChunks': [1],
            },
          ],
        });
        return;
      }
      if (request.uri.path == '/v2/uploads/chunk') {
        final index = body['chunkIndex'] as int;
        final box = SecretBox(
          base64Decode(body['ciphertext'] as String),
          nonce: base64Decode(body['nonce'] as String),
          mac: Mac(base64Decode(body['tag'] as String)),
        );
        receivedChunks[index] = await AesGcm.with256bits().decrypt(
          box,
          secretKey: SecretKey(secret),
          aad: utf8.encode(
            mobileUploadChunkAad(
              deviceId: body['deviceId'] as String,
              mobileCaptureId: body['mobileCaptureId'] as String,
              attachmentId: body['attachmentId'] as String,
              chunkIndex: index,
            ),
          ),
        );
        await _signed(request.response, {
          'protocolVersion': 2,
          'mobileCaptureId': body['mobileCaptureId'],
          'attachmentId': body['attachmentId'],
          'chunkIndex': index,
          'duplicate': false,
          'receivedCount': receivedChunks.length,
          'chunkCount': 2,
        });
        return;
      }
      if (request.uri.path == '/v2/uploads/commit') {
        await _decryptControl(body, 'commit');
        expect([...receivedChunks[0]!, ...receivedChunks[1]!], expectedBytes);
        await _signed(request.response, {
          'mobileCaptureId': body['mobileCaptureId'],
          'desktopCaptureId': 'desktop-with-attachment',
          'duplicate': false,
          'classificationStatus': 'suggested',
          'protocolVersion': 2,
          'attachmentCount': 1,
          'attachmentsCommitted': true,
        });
        return;
      }
      writeJson(request.response, 404, {'error': 'not_found'});
    });
  }

  Future<Map<String, dynamic>> _decryptControl(
    Map<String, dynamic> body,
    String messageType,
  ) async {
    final box = SecretBox(
      base64Decode(body['ciphertext'] as String),
      nonce: base64Decode(body['nonce'] as String),
      mac: Mac(base64Decode(body['tag'] as String)),
    );
    final clear = await AesGcm.with256bits().decrypt(
      box,
      secretKey: SecretKey(secret),
      aad: utf8.encode(
        mobileUploadControlAad(
          deviceId: body['deviceId'] as String,
          mobileCaptureId: body['mobileCaptureId'] as String,
          messageType: messageType,
          createdAt: body['createdAt'] as String,
        ),
      ),
    );
    return jsonDecode(utf8.decode(clear)) as Map<String, dynamic>;
  }

  Future<void> _signed(HttpResponse response, Map<String, Object?> body) async {
    final proof = await calculateHmac(
      secret,
      'upload-response\n${jsonEncode(body)}',
    );
    writeJson(response, 200, {...body, 'proof': base64Encode(proof)});
  }

  DesktopConnection get connection => DesktopConnection(
    address: '127.0.0.1:${server.port}',
    deviceId: MockMac.deviceId,
    secretBase64: base64Encode(secret),
    deviceName: '附件测试机',
    protocolVersion: 2,
    serviceId: MockMac.serviceId,
  );
}

class MemoryEncryptedAttachmentSource implements AttachmentByteSource {
  MemoryEncryptedAttachmentSource(this.bytes);

  final List<int> bytes;
  final List<int> readIndexes = [];

  @override
  Future<int> clearSize(MobileAttachment attachment) async => bytes.length;

  @override
  Future<bool> exists(MobileAttachment attachment) async => true;

  @override
  Future<Uint8List> readChunk(
    MobileAttachment attachment,
    int chunkIndex,
  ) async {
    readIndexes.add(chunkIndex);
    final start = chunkIndex * mobileAttachmentChunkBytes;
    final end = min(bytes.length, start + mobileAttachmentChunkBytes);
    return Uint8List.fromList(bytes.sublist(start, end));
  }
}

void main() {
  test(
    'derives a v2 secret locally, verifies SAS and uploads ciphertext without plaintext',
    () async {
      final mac = MockMac();
      await mac.start();
      addTearDown(() => mac.server.close(force: true));
      const noteText = '正文不会直接出现在HTTP请求里';
      final client = MobileSyncClient();
      final attempt = await client.beginPairing(
        service: mac.service,
        deviceName: 'Pixel',
      );
      expect(attempt.shortAuthenticationString, mac.sas);
      expect(mac.startContainedSecret, isFalse);
      final connection = await client.waitForApproval(attempt);
      expect(connection.protocolVersion, 2);
      expect(connection.serviceId, MockMac.serviceId);
      expect(base64Decode(connection.secretBase64), mac.deviceSecret);

      final entry = CaptureEntry(
        id: 'mobile-note-1',
        content: noteText,
        hint: CaptureHint.topic,
        createdAt: DateTime.utc(2026, 7, 21, 12, 30),
        syncState: CaptureSyncState.pending,
      );
      final receipt = await client.upload(connection, entry);
      expect(receipt.mobileCaptureId, 'mobile-note-1');
      expect(receipt.desktopCaptureId, 'desktop-capture-1');
      expect(receipt.duplicate, isFalse);
      expect(mac.requestContainedPlaintext, isFalse);
      expect(mac.decryptedText, noteText);
    },
  );

  test(
    'refuses to mark text as synced when the Mac receipt is forged',
    () async {
      final mac = MockMac(tamperReceiptProof: true);
      await mac.start();
      addTearDown(() => mac.server.close(force: true));
      final client = MobileSyncClient();
      final attempt = await client.beginPairing(
        service: mac.service,
        deviceName: 'Pixel',
      );
      final connection = await client.waitForApproval(attempt);
      final entry = CaptureEntry(
        id: 'mobile-note-forged',
        content: '不能接受伪造回执',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 21),
        syncState: CaptureSyncState.pending,
      );
      await expectLater(
        client.upload(connection, entry),
        throwsA(
          isA<MobileSyncException>().having(
            (error) => error.message,
            'message',
            contains('安全证明不一致'),
          ),
        ),
      );
    },
  );

  test(
    'resumes only missing encrypted attachment chunks and requires a signed final receipt',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'ly-mobile-attachment-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final bytes = List<int>.generate(
        mobileAttachmentChunkBytes + 97,
        (index) => index % 251,
      );
      final file = File('${directory.path}/resume-photo.jpg');
      await file.writeAsBytes(bytes, flush: true);
      final digest = (await Sha256().hash(
        bytes,
      )).bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
      final secret = List<int>.generate(32, (index) => index + 3);
      final mac = MockAttachmentMac(secret, bytes);
      await mac.start();
      addTearDown(() => mac.server.close(force: true));
      final entry = CaptureEntry(
        id: 'attachment-capture-1',
        content: '图片来自系统分享',
        hint: CaptureHint.auto,
        createdAt: DateTime.utc(2026, 7, 22, 9),
        syncState: CaptureSyncState.pending,
        attachments: [
          MobileAttachment(
            id: 'attachment-1',
            localPath: file.path,
            name: 'resume-photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: bytes.length,
            sha256: digest,
            kind: MobileAttachmentKind.image,
            chunkCount: 2,
            encryptedAtRest: true,
          ),
        ],
      );
      final source = MemoryEncryptedAttachmentSource(bytes);
      final progress = <List<int>>[];
      final receipt = await MobileSyncClient(attachmentByteSource: source)
          .upload(
            mac.connection,
            entry,
            onAttachmentProgress: (_, chunks) async =>
                progress.add([...chunks]),
          );
      expect(receipt.desktopCaptureId, 'desktop-with-attachment');
      expect(mac.receivedChunks.keys, {0, 1});
      expect(source.readIndexes, [1]);
      expect(progress, [
        [0],
        [0, 1],
      ]);
      expect(mac.requestLeakedName, isFalse);
    },
  );

  test(
    'authenticates a legacy in-place security upgrade without sending its secret',
    () async {
      final legacySecret = List<int>.generate(32, (index) => index + 1);
      const legacyDeviceId = '770e8400-e29b-41d4-a716-446655440000';
      final mac = MockMac(
        legacySecret: legacySecret,
        legacyDeviceId: legacyDeviceId,
      );
      await mac.start();
      addTearDown(() => mac.server.close(force: true));
      final legacy = DesktopConnection(
        address: mac.service.address,
        deviceId: legacyDeviceId,
        secretBase64: base64Encode(legacySecret),
        deviceName: '旧版Android',
        protocolVersion: 1,
      );
      final client = MobileSyncClient();
      final attempt = await client.beginPairing(
        service: mac.service,
        deviceName: '升级后的Android',
        upgradeConnection: legacy,
      );
      final upgraded = await client.waitForApproval(attempt);
      expect(mac.upgradeProofValid, isTrue);
      expect(mac.startContainedSecret, isFalse);
      expect(upgraded.deviceId, legacyDeviceId);
      expect(upgraded.protocolVersion, 2);
      expect(base64Decode(upgraded.secretBase64), isNot(legacySecret));
    },
  );

  test(
    'stops pairing when the Mac proof does not match the transcript',
    () async {
      final mac = MockMac(tamperProof: true);
      await mac.start();
      addTearDown(() => mac.server.close(force: true));
      await expectLater(
        MobileSyncClient().beginPairing(
          service: mac.service,
          deviceName: 'Pixel',
        ),
        throwsA(
          isA<MobileSyncException>().having(
            (error) => error.message,
            'message',
            contains('安全证明不一致'),
          ),
        ),
      );
    },
  );

  test(
    'keeps legacy stored connections upgradeable and validates private endpoints',
    () {
      final legacy = DesktopConnection.fromJson({
        'address': '192.168.1.8:4567',
        'deviceId': 'legacy-id',
        'secretBase64': base64Encode(List<int>.filled(32, 1)),
        'deviceName': '旧手机',
      });
      expect(legacy.protocolVersion, 1);
      expect(legacy.needsSecurityUpgrade, isTrue);
      expect(legacy.serviceId, isNull);
      expect(
        normalizeDesktopAddress('http://192.168.1.8:4567/'),
        '192.168.1.8:4567',
      );
      expect(normalizeDesktopAddress('10.0.2.2:1234'), '10.0.2.2:1234');
      expect(
        () => normalizeDesktopAddress('8.8.8.8:443'),
        throwsA(isA<MobileSyncException>()),
      );
    },
  );
}
