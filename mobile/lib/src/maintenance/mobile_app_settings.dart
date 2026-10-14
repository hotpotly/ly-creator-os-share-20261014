import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MobileAppSettings extends ChangeNotifier {
  static const _setupCompleteKey = 'mobile_setup_complete_v1';
  static const _historyLockKey = 'history_lock_enabled_v1';
  static const _historyLockMinutesKey = 'history_lock_minutes_v1';

  bool _loaded = false;
  bool _setupComplete = false;
  bool _historyLockEnabled = false;
  int _historyLockMinutes = 5;

  bool get loaded => _loaded;
  bool get setupComplete => _setupComplete;
  bool get historyLockEnabled => _historyLockEnabled;
  int get historyLockMinutes => _historyLockMinutes;

  Future<void> load() async {
    final preferences = await SharedPreferences.getInstance();
    _setupComplete = preferences.getBool(_setupCompleteKey) ?? false;
    _historyLockEnabled = preferences.getBool(_historyLockKey) ?? false;
    _historyLockMinutes = (preferences.getInt(_historyLockMinutesKey) ?? 5)
        .clamp(1, 60);
    _loaded = true;
    notifyListeners();
  }

  Future<void> completeSetup() async {
    _setupComplete = true;
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool(_setupCompleteKey, true);
    notifyListeners();
  }

  Future<void> setHistoryLock(bool enabled) async {
    _historyLockEnabled = enabled;
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool(_historyLockKey, enabled);
    notifyListeners();
  }

  Future<void> setHistoryLockMinutes(int minutes) async {
    _historyLockMinutes = minutes.clamp(1, 60);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setInt(_historyLockMinutesKey, _historyLockMinutes);
    notifyListeners();
  }
}
