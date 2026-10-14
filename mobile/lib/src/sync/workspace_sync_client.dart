import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';

import '../model/desktop_connection.dart';
import '../workspace/workspace_models.dart';
import '../workspace/workspace_sync_models.dart';
import 'mobile_sync_client.dart';

class WorkspaceSyncFailure implements Exception {
  const WorkspaceSyncFailure(
    this.message, {
    this.requiresPairing = false,
    this.tooLarge = false,
  });
  final String message;
  final bool requiresPairing;
  final bool tooLarge;
  @override
  String toString() => message;
}

class WorkspaceWireCodec {
  static const fields = {
    'protocolVersion',
    'workspaceId',
    'serviceId',
    'deviceId',
    'requestId',
    'counter',
    'nonce',
    'ciphertext',
    'tag',
  };

  static Future<SecretKey> key(DesktopConnection connection) async {
    if (connection.needsSecurityUpgrade ||
        !workspaceSyncUuid(connection.serviceId) ||
        !workspaceSyncUuid(connection.deviceId)) {
      throw const WorkspaceSyncFailure('请重新连接电脑', requiresPairing: true);
    }
    return Hkdf(hmac: Hmac.sha256(), outputLength: 32).deriveKey(
      secretKey: SecretKey(_decode(connection.secretBase64, 32)),
      nonce: utf8.encode(connection.serviceId!),
      info: utf8.encode('ly-creator-workspace-v1'),
    );
  }

  static List<int> aad(String direction, Map<String, dynamic> envelope) =>
      utf8.encode(
        'workspace-v1\n$direction\n${envelope['workspaceId']}\n'
        '${envelope['serviceId']}\n${envelope['deviceId']}\n'
        '${envelope['requestId']}\n${envelope['counter']}',
      );

  static Future<Map<String, dynamic>> seal(
    DesktopConnection connection,
    Map<String, dynamic> payload, {
    required String requestId,
    required int counter,
    String direction = 'request',
    List<int>? nonce,
  }) async {
    if (!workspaceSyncUuid(requestId) ||
        !workspaceSyncInteger(counter, minimum: 1) ||
        !['request', 'response'].contains(direction) ||
        payload['workspaceId'] != connection.serviceId ||
        payload['deviceId'] != connection.deviceId ||
        payload['protocolVersion'] != 1) {
      throw const FormatException('同步身份无效');
    }
    final bytes = utf8.encode(jsonEncode(payload));
    if (bytes.length > workspaceSyncByteLimit) {
      throw const WorkspaceSyncFailure('同步批次过大');
    }
    final envelope = <String, dynamic>{
      'protocolVersion': 1,
      'workspaceId': connection.serviceId,
      'serviceId': connection.serviceId,
      'deviceId': connection.deviceId,
      'requestId': requestId,
      'counter': counter,
    };
    final box = await AesGcm.with256bits().encrypt(
      bytes,
      secretKey: await key(connection),
      nonce: nonce,
      aad: aad(direction, envelope),
    );
    return {
      ...envelope,
      'nonce': base64Encode(box.nonce),
      'ciphertext': base64Encode(box.cipherText),
      'tag': base64Encode(box.mac.bytes),
    };
  }

  static Future<Map<String, dynamic>> open(
    DesktopConnection connection,
    Map<String, dynamic> envelope, {
    required String requestId,
    required int counter,
    String direction = 'response',
  }) async {
    workspaceSyncFields(envelope, fields);
    if (envelope['protocolVersion'] != 1 ||
        envelope['workspaceId'] != connection.serviceId ||
        envelope['serviceId'] != connection.serviceId ||
        envelope['deviceId'] != connection.deviceId ||
        envelope['requestId'] != requestId ||
        envelope['counter'] != counter) {
      throw const WorkspaceSyncFailure('同步响应身份不匹配');
    }
    try {
      final ciphertext = _decode(envelope['ciphertext'], null);
      if (ciphertext.length > workspaceSyncByteLimit) {
        throw const FormatException('同步批次过大');
      }
      final plain = await AesGcm.with256bits().decrypt(
        SecretBox(
          ciphertext,
          nonce: _decode(envelope['nonce'], 12),
          mac: Mac(_decode(envelope['tag'], 16)),
        ),
        secretKey: await key(connection),
        aad: aad(direction, envelope),
      );
      final payload = workspaceSyncMap(jsonDecode(utf8.decode(plain)));
      if (payload['protocolVersion'] != 1 ||
          payload['workspaceId'] != connection.serviceId ||
          payload['deviceId'] != connection.deviceId) {
        throw const FormatException('同步内容身份不匹配');
      }
      return payload;
    } catch (_) {
      throw const WorkspaceSyncFailure('同步响应校验失败，本机数据未变更');
    }
  }

  static List<int> _decode(Object? value, int? length) {
    if (value is! String || value.length > 360000) {
      throw const FormatException('加密内容无效');
    }
    final bytes = base64Decode(value);
    if (base64Encode(bytes) != value ||
        (length != null && bytes.length != length)) {
      throw const FormatException('加密内容无效');
    }
    return bytes;
  }
}

class WorkspaceSyncClient {
  WorkspaceSyncClient({HttpClient Function()? httpClientFactory})
    : _factory = httpClientFactory ?? HttpClient.new;
  final HttpClient Function() _factory;
  final Set<HttpClient> _active = {};
  int _generation = 0;

  void cancel() {
    _generation++;
    for (final client in _active) {
      client.close(force: true);
    }
    _active.clear();
  }

  Future<Map<String, dynamic>> sync(
    DesktopConnection connection,
    Map<String, dynamic> payload,
    int counter,
  ) async {
    final generation = _generation;
    final requestId = workspaceId();
    final envelope = await WorkspaceWireCodec.seal(
      connection,
      payload,
      requestId: requestId,
      counter: counter,
    );
    if (generation != _generation) {
      throw const WorkspaceSyncFailure('同步已暂停');
    }
    final address = normalizeDesktopAddress(connection.address);
    final client = _factory()..connectionTimeout = const Duration(seconds: 6);
    _active.add(client);
    try {
      return await (() async {
        final request = await client.postUrl(
          Uri.parse('http://$address/workspace/v1/sync'),
        );
        request.followRedirects = false;
        request.headers.contentType = ContentType.json;
        request.add(utf8.encode(jsonEncode(envelope)));
        final response = await request.close();
        if (response.statusCode != 200) {
          if (response.statusCode == 401 || response.statusCode == 403) {
            throw const WorkspaceSyncFailure(
              '连接已失效，请重新连接电脑',
              requiresPairing: true,
            );
          }
          if (response.statusCode == 413) {
            throw const WorkspaceSyncFailure('同步批次过大', tooLarge: true);
          }
          if (response.statusCode == 409) {
            throw const WorkspaceSyncFailure('同步版本校验失败，本机数据已保留');
          }
          throw const WorkspaceSyncFailure('电脑暂时无法同步');
        }
        final bytes = <int>[];
        await for (final chunk in response) {
          if (bytes.length + chunk.length > 360000) {
            throw const WorkspaceSyncFailure('同步响应过大');
          }
          bytes.addAll(chunk);
        }
        return WorkspaceWireCodec.open(
          connection,
          workspaceSyncMap(jsonDecode(utf8.decode(bytes))),
          requestId: requestId,
          counter: counter,
        );
      })().timeout(const Duration(seconds: 20));
    } on SocketException {
      throw const WorkspaceSyncFailure('等待电脑上线');
    } on TimeoutException {
      throw const WorkspaceSyncFailure('同步超时，本机数据已保留');
    } on HttpException {
      throw const WorkspaceSyncFailure('连接中断，本机数据已保留');
    } finally {
      _active.remove(client);
      client.close(force: true);
    }
  }
}
