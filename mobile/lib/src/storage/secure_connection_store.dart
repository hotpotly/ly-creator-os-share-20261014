import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../model/desktop_connection.dart';
import 'connection_store.dart';

class SecureConnectionStore implements ConnectionStore {
  const SecureConnectionStore([this._storage = const FlutterSecureStorage()]);

  static const _key = 'creator_desktop_connection_v1';
  final FlutterSecureStorage _storage;

  @override
  Future<DesktopConnection?> load() async {
    final raw = await _storage.read(key: _key);
    if (raw == null || raw.isEmpty) return null;
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('连接信息格式无效');
    }
    return DesktopConnection.fromJson(decoded.cast<String, Object?>());
  }

  @override
  Future<void> save(DesktopConnection connection) async {
    await _storage.write(key: _key, value: jsonEncode(connection.toJson()));
  }

  @override
  Future<void> clear() => _storage.delete(key: _key);
}
