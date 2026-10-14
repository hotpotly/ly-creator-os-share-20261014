import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';

import '../model/desktop_connection.dart';
import '../workspace/workspace_models.dart';
import '../workspace/workspace_v2_contract.dart';
import 'mobile_sync_client.dart';

const _requestSchemas = {
  'capabilities': 'capabilitiesRequest',
  'sync': 'syncRequest',
  'snapshot.start': 'snapshotStart',
  'snapshot.page': 'snapshotPageRequest',
  'blob.start': 'blobStart',
  'blob.status': 'blobStatus',
  'blob.chunk': 'blobChunk',
  'blob.commit': 'blobCommitRequest',
  'blob.read': 'blobReadRequest',
};
const _responseSchemas = {
  'capabilities': 'capabilitiesResponse',
  'sync': 'syncResponse',
  'snapshot.start': 'manifest',
  'snapshot.page': 'snapshotPageResponse',
  'blob.start': 'blobSession',
  'blob.status': 'blobSession',
  'blob.chunk': 'blobChunkAck',
  'blob.commit': 'blobCommitResponse',
  'blob.read': 'blobReadResponse',
};

class WorkspaceV2Failure implements Exception {
  const WorkspaceV2Failure(
    this.message, {
    this.requiresPairing = false,
    this.tooLarge = false,
    this.unsupportedCapabilities = false,
    this.cancelled = false,
    this.uploadSessionExpired = false,
    this.snapshotExpired = false,
  });
  final String message;
  final bool requiresPairing;
  final bool tooLarge;
  final bool unsupportedCapabilities;
  final bool cancelled;
  final bool uploadSessionExpired;
  final bool snapshotExpired;
  @override
  String toString() => message;
}

class WorkspaceV2WireCodec {
  static Future<SecretKey> key(DesktopConnection connection) async {
    if (connection.needsSecurityUpgrade ||
        !workspaceV2Uuid(connection.serviceId) ||
        !workspaceV2Uuid(connection.deviceId)) {
      throw const WorkspaceV2Failure('请重新连接电脑', requiresPairing: true);
    }
    return Hkdf(hmac: Hmac.sha256(), outputLength: 32).deriveKey(
      secretKey: SecretKey(
        workspaceV2DecodeBase64(connection.secretBase64, expectedLength: 32),
      ),
      nonce: utf8.encode(connection.serviceId!),
      info: utf8.encode(workspaceV2KeyInfo),
    );
  }

  static Future<Map<String, dynamic>> seal(
    DesktopConnection connection,
    String purpose,
    Map<String, dynamic> body, {
    required String requestId,
    required int counter,
    String direction = 'request',
    List<int>? nonce,
  }) async {
    if (!workspaceV2Purposes.contains(purpose) ||
        !['request', 'response'].contains(direction) ||
        !workspaceV2Uuid(requestId) ||
        !workspaceV2SafeInteger(counter, minimum: 1) ||
        body['workspaceId'] != connection.serviceId ||
        body['deviceId'] != connection.deviceId) {
      throw const FormatException('同步请求身份无效');
    }
    final plain = utf8.encode(jsonEncode(body));
    if (plain.length > workspaceV2PageBytes) {
      throw const WorkspaceV2Failure('同步批次过大', tooLarge: true);
    }
    workspaceV2Validate(
      (direction == 'request' ? _requestSchemas : _responseSchemas)[purpose]!,
      body,
    );
    final identity = <String, dynamic>{
      'protocolVersion': 2,
      'workspaceId': connection.serviceId,
      'serviceId': connection.serviceId,
      'deviceId': connection.deviceId,
      'purpose': purpose,
      'requestId': requestId,
      'counter': counter,
    };
    final box = await AesGcm.with256bits().encrypt(
      plain,
      secretKey: await key(connection),
      nonce: nonce,
      aad: utf8.encode(workspaceV2Aad(direction, identity)),
    );
    return workspaceV2Validate('envelope', {
      ...identity,
      'nonce': base64Encode(box.nonce),
      'ciphertext': base64Encode(box.cipherText),
      'tag': base64Encode(box.mac.bytes),
    });
  }

  static Future<Map<String, dynamic>> open(
    DesktopConnection connection,
    Map<String, dynamic> envelope, {
    required Map<String, dynamic> requestEnvelope,
    String direction = 'response',
  }) async {
    if (!['request', 'response'].contains(direction) ||
        requestEnvelope['workspaceId'] != connection.serviceId ||
        requestEnvelope['deviceId'] != connection.deviceId) {
      throw const FormatException('同步响应身份无效');
    }
    try {
      workspaceV2AssertResponseEnvelope(requestEnvelope, envelope);
      final plain = await AesGcm.with256bits().decrypt(
        SecretBox(
          workspaceV2DecodeBase64(
            envelope['ciphertext'],
            maximumLength: workspaceV2PageBytes,
          ),
          nonce: workspaceV2DecodeBase64(envelope['nonce'], expectedLength: 12),
          mac: Mac(
            workspaceV2DecodeBase64(envelope['tag'], expectedLength: 16),
          ),
        ),
        secretKey: await key(connection),
        aad: utf8.encode(workspaceV2Aad(direction, envelope)),
      );
      if (plain.length > workspaceV2PageBytes) {
        throw const FormatException('同步响应过大');
      }
      final body = workspaceV2Map(jsonDecode(utf8.decode(plain)));
      workspaceV2AssertEnvelopeBody(envelope, body);
      return workspaceV2Validate(
        (direction == 'request'
            ? _requestSchemas
            : _responseSchemas)[envelope['purpose']]!,
        body,
      );
    } catch (_) {
      throw const WorkspaceV2Failure('同步响应校验失败，本机数据已保留');
    }
  }
}

class WorkspaceV2Client {
  WorkspaceV2Client({HttpClient Function()? httpClientFactory})
    : _factory = httpClientFactory ?? HttpClient.new;
  final HttpClient Function() _factory;
  static final Map<String, Future<void>> _lanes = {};
  final Set<HttpClient> _active = {};
  int _generation = 0;

  void cancel() {
    _generation++;
    for (final client in _active) {
      client.close(force: true);
    }
    _active.clear();
  }

  void _checkActive(int generation) {
    if (generation != _generation) {
      throw const WorkspaceV2Failure('同步已暂停', cancelled: true);
    }
  }

  Future<Map<String, dynamic>> request(
    DesktopConnection connection,
    String purpose,
    Map<String, dynamic> payload, {
    required Future<int> Function() reserveCounter,
    Map<String, dynamic>? expectedBlob,
    List<Map<String, dynamic>>? approvedPermissions,
  }) async {
    final generation = _generation;
    final frozenPayload = workspaceV2Map(jsonDecode(jsonEncode(payload)));
    final frozenBlob = expectedBlob == null
        ? null
        : workspaceV2Map(jsonDecode(jsonEncode(expectedBlob)));
    final frozenPermissions = approvedPermissions
        ?.map((p) => workspaceV2Map(jsonDecode(jsonEncode(p))))
        .toList();
    final lane = '${connection.serviceId}/${connection.deviceId}';
    final preceding = _lanes[lane] ?? Future<void>.value();
    final result = preceding.then((_) {
      _checkActive(generation);
      return _request(
        connection,
        purpose,
        frozenPayload,
        generation: generation,
        reserveCounter: reserveCounter,
        expectedBlob: frozenBlob,
        approvedPermissions: frozenPermissions,
      );
    });
    final settled = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    _lanes[lane] = settled;
    unawaited(
      settled.then((_) {
        if (identical(_lanes[lane], settled)) _lanes.remove(lane);
      }),
    );
    return result;
  }

  Future<Map<String, dynamic>> _request(
    DesktopConnection connection,
    String purpose,
    Map<String, dynamic> payload, {
    required int generation,
    required Future<int> Function() reserveCounter,
    Map<String, dynamic>? expectedBlob,
    List<Map<String, dynamic>>? approvedPermissions,
  }) async {
    final address = normalizeDesktopAddress(connection.address);
    final path = workspaceV2Path(purpose);
    final body = workspaceV2Validate(
      _requestSchemas[purpose]!,
      jsonDecode(jsonEncode(payload)),
    );
    if (connection.needsSecurityUpgrade ||
        body['workspaceId'] != connection.serviceId ||
        body['deviceId'] != connection.deviceId) {
      throw const WorkspaceV2Failure('同步身份不匹配', requiresPairing: true);
    }
    if (utf8.encode(jsonEncode(body)).length > workspaceV2PageBytes) {
      throw const WorkspaceV2Failure('同步批次过大', tooLarge: true);
    }
    final reference = expectedBlob == null
        ? null
        : workspaceV2Map(jsonDecode(jsonEncode(expectedBlob)));
    final permissions = approvedPermissions
        ?.map((p) => workspaceV2Map(jsonDecode(jsonEncode(p))))
        .toList();
    if (purpose == 'capabilities' && permissions == null) {
      throw const FormatException('缺少本机确认的同步范围');
    }
    if (purpose == 'blob.read') {
      if (reference == null) throw const FormatException('缺少已授权记录的文件引用');
      workspaceV2ValidateBlobRef(reference);
      if (reference['sha256'] != body['sha256']) {
        throw const FormatException('文件引用不匹配');
      }
      workspaceV2ExpectedChunkLength(
        (reference['byteLength'] as num),
        (body['index'] as num),
      );
    }
    final counter = await reserveCounter();
    _checkActive(generation);
    final envelope = await WorkspaceV2WireCodec.seal(
      connection,
      purpose,
      body,
      requestId: workspaceId(),
      counter: counter,
    );
    _checkActive(generation);
    final client = _factory()..connectionTimeout = const Duration(seconds: 6);
    _active.add(client);
    try {
      final result = await (() async {
        final outgoing = await client.postUrl(
          Uri.parse('http://$address$path'),
        );
        _checkActive(generation);
        outgoing.followRedirects = false;
        outgoing.headers.contentType = ContentType.json;
        outgoing.add(utf8.encode(jsonEncode(envelope)));
        final response = await outgoing.close();
        _checkActive(generation);
        if (response.statusCode != 200) {
          if (response.statusCode == 401 || response.statusCode == 403) {
            throw const WorkspaceV2Failure(
              '设备授权已失效，本机数据已保留',
              requiresPairing: true,
            );
          }
          if (response.statusCode == 413) {
            throw const WorkspaceV2Failure('同步批次过大', tooLarge: true);
          }
          if (response.statusCode == 404) {
            throw WorkspaceV2Failure(
              '电脑尚不支持此同步版本',
              unsupportedCapabilities: purpose == 'capabilities',
            );
          }
          if (response.statusCode == 410 && purpose == 'snapshot.page') {
            throw const WorkspaceV2Failure(
              '快照已过期，本机记录已保留',
              snapshotExpired: true,
            );
          }
          if (response.statusCode == 410 &&
              (const [
                    'blob.start',
                    'blob.status',
                    'blob.chunk',
                    'blob.commit',
                  ].contains(purpose) ||
                  (purpose == 'sync' &&
                      (body['operations'] as List).any(
                        (operation) =>
                            operation['type'] == 'record' &&
                            operation['next']['payload']['encoding'] == 'blob',
                      )))) {
            throw const WorkspaceV2Failure(
              '上传暂存已过期，本机原稿已保留',
              uploadSessionExpired: true,
            );
          }
          if (response.statusCode == 409) {
            throw const WorkspaceV2Failure('同步版本已改变，本机数据已保留');
          }
          throw const WorkspaceV2Failure('电脑暂时无法同步');
        }
        final bytes = <int>[];
        await for (final chunk in response) {
          _checkActive(generation);
          if (bytes.length + chunk.length > 360000) {
            throw const WorkspaceV2Failure('同步响应过大');
          }
          bytes.addAll(chunk);
        }
        final result = await WorkspaceV2WireCodec.open(
          connection,
          workspaceV2Map(jsonDecode(utf8.decode(bytes))),
          requestEnvelope: envelope,
        );
        _checkActive(generation);
        _correlate(purpose, body, result, reference, permissions);
        return result;
      })().timeout(const Duration(seconds: 20));
      _checkActive(generation);
      return result;
    } on SocketException {
      _checkActive(generation);
      throw const WorkspaceV2Failure('等待电脑上线');
    } on TimeoutException {
      _checkActive(generation);
      throw const WorkspaceV2Failure('同步超时，本机数据已保留');
    } on HttpException {
      _checkActive(generation);
      throw const WorkspaceV2Failure('连接中断，本机数据已保留');
    } finally {
      _active.remove(client);
      client.close(force: true);
    }
  }

  static void _correlate(
    String purpose,
    Map<String, dynamic> sent,
    Map<String, dynamic> received,
    Map<String, dynamic>? reference,
    List<Map<String, dynamic>>? permissions,
  ) {
    void same(String field, [String? other]) {
      if (sent[field] != received[other ?? field]) {
        throw const FormatException('同步响应与请求不匹配');
      }
    }

    same('workspaceId');
    same('deviceId');
    switch (purpose) {
      case 'capabilities':
        workspaceV2AssertCapabilities(sent, received, permissions!);
      case 'sync':
        workspaceV2AssertSyncResponse(sent, received);
      case 'snapshot.start':
        same('scopeDigest');
        if (workspaceV2CanonicalJson(sent['scopes']) !=
            workspaceV2CanonicalJson(received['scopes'])) {
          throw const FormatException('快照范围不匹配');
        }
      case 'snapshot.page':
        same('manifestId');
        if ((received['records'] as List).length > (sent['limit'] as num)) {
          throw const FormatException('快照页过大');
        }
      case 'blob.status':
        same('sessionId');
      case 'blob.chunk':
        same('sessionId');
        same('index');
        same('sha256');
        if (received['byteLength'] !=
            workspaceV2DecodeBase64(sent['bytesBase64']).length) {
          throw const FormatException('分块回执长度不匹配');
        }
      case 'blob.commit':
        same('sessionId');
        final ref = received['ref'] as Map;
        if (ref['sha256'] != sent['sha256'] ||
            ref['byteLength'] != sent['byteLength']) {
          throw const FormatException('文件提交回执不匹配');
        }
      case 'blob.read':
        same('sha256');
        same('index');
        if (reference!['byteLength'] != received['byteLength']) {
          throw const FormatException('下载文件长度与记录引用不匹配');
        }
    }
  }
}
