import '../model/capture_entry.dart';

abstract class CaptureStore {
  Future<List<CaptureEntry>> load();
  Future<void> save(List<CaptureEntry> entries);
  Future<void> upsert(CaptureEntry entry) async {
    final entries = await load();
    final next = [entry, ...entries.where((item) => item.id != entry.id)];
    await save(next);
  }

  Future<CaptureEntry?> loadById(String id) async =>
      (await load()).where((item) => item.id == id).firstOrNull;
  Future<void> deleteById(String id) async {
    final entries = await load();
    await save(entries.where((item) => item.id != id).toList());
  }

  Future<bool> tryAcquireLease(
    String name,
    String owner,
    DateTime expiresAt,
  ) async => true;
  Future<void> releaseLease(String name, String owner) async {}

  Future<String> loadDraft() async => '';
  Future<void> saveDraft(String content) async {}
  Future<void> clearDraft() async {}
  Future<bool> loadSyncPaused() async => false;
  Future<void> saveSyncPaused(bool paused) async {}
  Future<void> close() async {}
}

class MemoryCaptureStore extends CaptureStore {
  MemoryCaptureStore([List<CaptureEntry> initial = const [], String draft = ''])
    : _entries = List.of(initial),
      _draft = draft;

  List<CaptureEntry> _entries;
  String _draft;
  final Map<String, ({String owner, DateTime expiresAt})> _leases = {};

  @override
  Future<List<CaptureEntry>> load() async => List.of(_entries);

  @override
  Future<void> save(List<CaptureEntry> entries) async {
    _entries = List.of(entries);
  }

  @override
  Future<void> upsert(CaptureEntry entry) async {
    _entries = [entry, ..._entries.where((item) => item.id != entry.id)];
  }

  @override
  Future<CaptureEntry?> loadById(String id) async =>
      _entries.where((item) => item.id == id).firstOrNull;

  @override
  Future<void> deleteById(String id) async {
    _entries.removeWhere((item) => item.id == id);
  }

  @override
  Future<bool> tryAcquireLease(
    String name,
    String owner,
    DateTime expiresAt,
  ) async {
    final current = _leases[name];
    if (current != null &&
        current.owner != owner &&
        current.expiresAt.isAfter(DateTime.now().toUtc())) {
      return false;
    }
    _leases[name] = (owner: owner, expiresAt: expiresAt.toUtc());
    return true;
  }

  @override
  Future<void> releaseLease(String name, String owner) async {
    if (_leases[name]?.owner == owner) _leases.remove(name);
  }

  @override
  Future<String> loadDraft() async => _draft;

  @override
  Future<void> saveDraft(String content) async => _draft = content;

  @override
  Future<void> clearDraft() async => _draft = '';

  bool syncPaused = false;

  @override
  Future<bool> loadSyncPaused() async => syncPaused;

  @override
  Future<void> saveSyncPaused(bool paused) async => syncPaused = paused;
}
