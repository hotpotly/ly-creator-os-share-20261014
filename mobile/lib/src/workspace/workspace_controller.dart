import 'dart:async';
import 'package:flutter/foundation.dart';
import 'workspace_models.dart';
import 'workspace_full_models.dart';
import 'workspace_v2_contract.dart';
import 'workspace_store.dart';

class WorkspaceController extends ChangeNotifier {
  WorkspaceController(this.store);
  final WorkspaceStore store;
  List<WorkspaceRecord> records = [];
  List<WorkspaceFullRecord> fullRecords = const [];
  Map<String, dynamic>? fullWorkspace;
  int activeProtocol = 1;
  bool get fullActive => activeProtocol == 2;
  bool loaded = false;
  String? error;
  bool _disposed = false;
  VoidCallback? onLocalChanged;
  Future<void> _tail = Future.value();

  Future<T> _run<T>(Future<T> Function() operation) {
    final result = _tail.then((_) => operation());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> load() => _run(() async {
    try {
      await _reload();
      loaded = true;
      error = null;
    } catch (_) {
      loaded = false;
      error = '本地工作区暂时无法读取，原始数据已保留';
    }
    if (!_disposed) notifyListeners();
  });

  Future<void> _reload() async {
    final persistence = store is WorkspaceV2Persistence
        ? store as WorkspaceV2Persistence
        : null;
    final protocol = persistence == null
        ? 1
        : (await persistence.v2Status())['activeProtocol'] as int;
    if (protocol == 2) {
      if (store is! WorkspaceV2Store) throw StateError('完整工作区不可用');
      final snapshot = await (store as WorkspaceV2Store).loadV2Workspace();
      final next = [
        for (final row in snapshot['records'] as List)
          WorkspaceFullRecord(Map<String, dynamic>.from(row as Map)),
      ];
      final drafts = await persistence!.loadV2ReviewDrafts();
      fullWorkspace = freezeWorkspaceMap(snapshot);
      fullRecords = List.unmodifiable(next);
      records = List.unmodifiable(drafts);
    } else {
      final next = await store.load();
      records = List.unmodifiable(next);
      fullRecords = const [];
      fullWorkspace = null;
    }
    activeProtocol = protocol;
  }

  WorkspaceFullRecord? findFull(
    String kind,
    String id, {
    bool includeDeleted = false,
  }) => fullRecords
      .where(
        (r) => r.kind == kind && r.id == id && (includeDeleted || !r.deleted),
      )
      .firstOrNull;

  bool canWriteFullKind(String kind) =>
      loaded &&
      error == null &&
      fullActive &&
      fullWorkspace?['suspended'] != true &&
      ((fullWorkspace?['capabilitiesResponse'] as Map?)?['permissions']
                  as List? ??
              [])
          .any(
            (p) =>
                p['scope'] == workspaceV2KindScopes[kind] && p['write'] == true,
          );

  WorkspaceRecord? find(
    String kind,
    String id, {
    bool includeDeleted = false,
  }) => records
      .where(
        (r) => r.kind == kind && r.id == id && (includeDeleted || !r.deleted),
      )
      .firstOrNull;

  Future<void> save(WorkspaceRecord record) => saveAll([record]);

  Future<void> saveAll(List<WorkspaceRecord> batch) => _run(() async {
    if (!loaded || error != null) throw StateError('工作区尚未就绪，请重试读取');
    if (fullActive && batch.any((r) => r.kind != 'review_draft')) {
      throw StateError('请使用完整工作区编辑');
    }
    final saved = await store.saveAll(batch);
    final updated = List<WorkspaceRecord>.of(records);
    for (final record in saved) {
      final index = updated.indexWhere(
        (r) => r.kind == record.kind && r.id == record.id,
      );
      if (index < 0) {
        updated.add(record);
      } else {
        updated[index] = record;
      }
    }
    records = updated;
    if (!_disposed) {
      notifyListeners();
      if (saved.any(
        (record) => record.kind == 'todo' || record.kind == 'work_log',
      )) {
        onLocalChanged?.call();
      }
    }
  });

  Future<void> _saveFull(Future<void> Function(WorkspaceV2Store) write) =>
      _run(() async {
        if (!loaded ||
            error != null ||
            !fullActive ||
            store is! WorkspaceV2Store) {
          throw StateError('完整工作区尚未就绪，请重试读取');
        }
        await write(store as WorkspaceV2Store);
        try {
          await _reload();
        } catch (_) {
          loaded = false;
          error = '本机已保存，工作区暂时无法读取';
        }
        if (!_disposed) {
          notifyListeners();
          onLocalChanged?.call();
        }
      });

  Future<void> saveFullTodo(
    Map<String, dynamic> command,
    int expectedLocalRevision,
  ) => saveFullTodos([
    {'command': command, 'expectedLocalRevision': expectedLocalRevision},
  ]);

  Future<void> saveFullTodos(List<Map<String, dynamic>> commands) {
    final frozen = [
      for (final command in commands) freezeWorkspaceMap(command),
    ];
    return _saveFull((store) async {
      await store.saveV2Todos(frozen);
    });
  }

  Future<void> saveFullWorkLog(
    Map<String, dynamic> command,
    int expectedLocalRevision,
  ) {
    final frozen = freezeWorkspaceMap(command);
    return _saveFull((store) async {
      await store.saveV2WorkLog(frozen, expectedLocalRevision);
    });
  }

  Future<void> updateFromSync(Future<void> Function() apply) => _run(() async {
    await apply();
    try {
      await _reload();
      loaded = true;
      error = null;
    } catch (_) {
      loaded = false;
      error = '本地工作区暂时无法读取，原始数据已保留';
      if (!_disposed) notifyListeners();
      rethrow;
    }
    if (!_disposed) notifyListeners();
  });

  Future<void> get settled => _tail;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
