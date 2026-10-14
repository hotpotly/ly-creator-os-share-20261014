import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class CapturePayloadCipher {
  Future<void> prepare({required bool hasEncryptedData}) async {}
  Future<String> encrypt(String plaintext);
  Future<String> decrypt(String payload);
}

class SecureCapturePayloadCipher implements CapturePayloadCipher {
  SecureCapturePayloadCipher({
    this._storage = const FlutterSecureStorage(
      aOptions: AndroidOptions(
        resetOnError: false,
        migrateOnAlgorithmChange: true,
        migrateWithBackup: true,
        storageNamespace: 'ly_creator_capture',
      ),
    ),
    this.allowLegacyPlaintext = true,
    this._keyName = 'creator_capture_database_key_v1',
    Cipher? cipher,
  }) : _cipher = cipher ?? AesGcm.with256bits();

  final bool allowLegacyPlaintext;
  final String _keyName;
  static const _prefix = 'enc:v1:';

  final FlutterSecureStorage _storage;
  final Cipher _cipher;
  SecretKey? _cachedKey;
  bool _prepared = false;

  @override
  Future<void> prepare({required bool hasEncryptedData}) async {
    if (_prepared) return;
    final encoded = await _storage.read(key: _keyName);
    if ((encoded == null || encoded.isEmpty) && hasEncryptedData) {
      throw StateError('检测到加密记录，但Android安全密钥不可用；已停止写入以保护原始数据');
    }
    if (encoded == null || encoded.isEmpty) {
      final bytes = await SecretKeyData.random(length: 32).extractBytes();
      await _storage.write(key: _keyName, value: base64Encode(bytes));
      _cachedKey = SecretKey(bytes);
    } else {
      final bytes = base64Decode(encoded);
      if (bytes.length != 32) throw const FormatException('本地记录密钥格式无效');
      _cachedKey = SecretKey(bytes);
    }
    _prepared = true;
  }

  @override
  Future<String> encrypt(String plaintext) async {
    final key = await _key();
    final box = await _cipher.encrypt(utf8.encode(plaintext), secretKey: key);
    final envelope = jsonEncode({
      'nonce': base64Encode(box.nonce),
      'ciphertext': base64Encode(box.cipherText),
      'mac': base64Encode(box.mac.bytes),
    });
    return '$_prefix${base64UrlEncode(utf8.encode(envelope))}';
  }

  @override
  Future<String> decrypt(String payload) async {
    // 兼容升级前的明文SQLite数据；下一次保存会自动重新加密。
    if (!payload.startsWith(_prefix)) {
      if (allowLegacyPlaintext) return payload;
      throw const FormatException('工作区记录必须加密');
    }
    try {
      final envelope =
          jsonDecode(
                utf8.decode(
                  base64Url.decode(payload.substring(_prefix.length)),
                ),
              )
              as Map<String, dynamic>;
      final clear = await _cipher.decrypt(
        SecretBox(
          base64Decode(envelope['ciphertext']! as String),
          nonce: base64Decode(envelope['nonce']! as String),
          mac: Mac(base64Decode(envelope['mac']! as String)),
        ),
        secretKey: await _key(),
      );
      return utf8.decode(clear);
    } on SecretBoxAuthenticationError {
      throw const FormatException('本地记录加密验证失败');
    }
  }

  Future<SecretKey> _key() async {
    final cached = _cachedKey;
    if (cached != null) return cached;
    await prepare(hasEncryptedData: false);
    final prepared = _cachedKey;
    if (prepared != null) return prepared;
    final encoded = await _storage.read(key: _keyName);
    late final List<int> bytes;
    if (encoded == null || encoded.isEmpty) {
      bytes = await SecretKeyData.random(length: 32).extractBytes();
      await _storage.write(key: _keyName, value: base64Encode(bytes));
    } else {
      bytes = base64Decode(encoded);
      if (bytes.length != 32) throw const FormatException('本地记录密钥格式无效');
    }
    return _cachedKey = SecretKey(bytes);
  }
}

class PlaintextCapturePayloadCipher implements CapturePayloadCipher {
  const PlaintextCapturePayloadCipher();

  @override
  Future<void> prepare({required bool hasEncryptedData}) async {}

  @override
  Future<String> decrypt(String payload) async => payload;

  @override
  Future<String> encrypt(String plaintext) async => plaintext;
}
