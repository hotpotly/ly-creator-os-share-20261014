import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../model/capture_entry.dart';
import 'capture_store.dart';

class SharedPreferencesCaptureStore extends CaptureStore {
  SharedPreferencesCaptureStore._(this._preferences);

  static const _key = 'creator_capture_queue_v1';
  final SharedPreferences _preferences;

  static Future<SharedPreferencesCaptureStore> create() async {
    return SharedPreferencesCaptureStore._(
      await SharedPreferences.getInstance(),
    );
  }

  @override
  Future<List<CaptureEntry>> load() async {
    final raw = _preferences.getString(_key);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .whereType<Map<String, dynamic>>()
          .map((entry) => CaptureEntry.fromJson(entry.cast<String, Object?>()))
          .toList();
    } catch (_) {
      // 不覆盖损坏的原始值，避免一次解析失败导致记录永久丢失。
      return [];
    }
  }

  @override
  Future<void> save(List<CaptureEntry> entries) async {
    final encoded = jsonEncode(entries.map((entry) => entry.toJson()).toList());
    final saved = await _preferences.setString(_key, encoded);
    if (!saved) throw StateError('本地保存失败');
  }
}
