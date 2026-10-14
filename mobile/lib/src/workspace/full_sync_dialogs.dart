import 'package:flutter/material.dart';
import '../sync/workspace_sync_engine.dart';
import 'workspace_domain_v2.dart';
import 'workspace_full_models.dart';

const fullWorkspaceUpgradeScopes = [
  'preferences.todo',
  'project.catalog',
  'todo.full',
  'work_log',
];

String fullSyncBlockedReason(String? code) => switch (code) {
  'project_unavailable' => '关联项目当前不可用',
  'stage_unavailable' => '关联阶段当前不可用',
  'record_read_only' => '此记录当前只读',
  'invalid_change' => '此项修改未被电脑接受',
  _ => '此项需要修正',
};

class FullSyncConflict {
  FullSyncConflict(Map<String, dynamic> value)
    : value = freezeWorkspaceMap(value);
  final Map<String, dynamic> value;
  String get kind => value['kind'] as String;
  String get id => value['id'] as String;
  int get localRevision => value['localRevision'] as int;
  int get remoteRevision => value['remoteRevision'] as int;
  String get localJson => (value['local'] as Map)['json'] as String;
  String get remoteJson => (value['remote'] as Map)['json'] as String;
  bool get localDeleted => (value['local'] as Map)['deleted'] == true;
  Map get remoteRecord => (value['remote'] as Map)['record'] as Map;
  bool get remoteDeleted => remoteRecord['deleted'] == true;
  bool get createsCopy => kind == 'todo' && remoteDeleted && !localDeleted;

  bool canKeepLocal(
    WorkspaceFullRecord? current, {
    bool canCreateTodo = false,
  }) {
    if (current == null ||
        current.kind != kind ||
        current.id != id ||
        !current.supported ||
        current.state['inflight'] != null) {
      return false;
    }
    final local = workspaceDomainV2Inspect(kind, id, localJson);
    final remote = workspaceDomainV2Inspect(kind, id, remoteJson);
    if (local['writable'] != true || remote['writable'] != true) return false;
    if (createsCopy) {
      if (!canCreateTodo ||
          (remoteRecord['metadata'] as Map)['source'] != 'manual') {
        return false;
      }
      final body = local['body'] as Map;
      try {
        workspaceDomainV2Validate('todoCreate', {
          for (final key in [
            'title',
            'category',
            'isExtra',
            'plannedDate',
            'segment',
            'dateRange',
            'projectId',
            'stageKey',
            'status',
            'trackingMode',
            'progress',
            'progressBeforeComplete',
            'completedAt',
          ])
            key: body.containsKey(key)
                ? body[key]
                : key == 'isExtra'
                ? false
                : null,
        });
      } on FormatException {
        return false;
      }
      return true;
    }
    return current.state['writable'] == true &&
        current.metadata['write'] == true &&
        (!localDeleted || current.metadata['deletable'] == true);
  }
}

class FullWorkspaceConflictDialog extends StatefulWidget {
  const FullWorkspaceConflictDialog({
    super.key,
    required this.engine,
    required this.conflict,
  });
  final WorkspaceSyncEngine engine;
  final Map<String, dynamic> conflict;
  @override
  State<FullWorkspaceConflictDialog> createState() =>
      _FullWorkspaceConflictDialogState();
}

class _FullWorkspaceConflictDialogState
    extends State<FullWorkspaceConflictDialog> {
  late final snapshot = FullSyncConflict(widget.conflict);
  bool saving = false;
  String? error;

  Future<void> resolve(bool keepLocal) async {
    if (saving) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.engine.resolve(
        snapshot.kind,
        snapshot.id,
        keepLocal: keepLocal,
        expectedLocalRevision: snapshot.localRevision,
        expectedRemoteRevision: snapshot.remoteRevision,
      );
      if (mounted) Navigator.pop(context);
    } catch (failure) {
      if (mounted) setState(() => error = '$failure');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.engine.controller,
    builder: (context, _) {
      final canKeepLocal = snapshot.canKeepLocal(
        widget.engine.controller.findFull(
          snapshot.kind,
          snapshot.id,
          includeDeleted: true,
        ),
        canCreateTodo: widget.engine.controller.canWriteFullKind('todo'),
      );
      return PopScope(
        canPop: !saving,
        child: AlertDialog(
          title: const Text('选择保留的版本'),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '手机 · ${snapshot.localDeleted ? '已删除' : '未删除'}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                SelectableText(
                  snapshot.localJson,
                  key: const ValueKey('full-conflict-local-json'),
                ),
                const SizedBox(height: 20),
                Text(
                  '电脑 · ${snapshot.remoteDeleted ? '已删除' : '未删除'}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                SelectableText(
                  snapshot.remoteJson,
                  key: const ValueKey('full-conflict-remote-json'),
                ),
                if (!canKeepLocal)
                  const Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: Text('手机版当前不可覆盖电脑版本'),
                  ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      error!,
                      key: const ValueKey('full-conflict-error'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(context),
              child: const Text('稍后'),
            ),
            TextButton(
              key: const ValueKey('full-conflict-keep-remote'),
              onPressed: saving ? null : () => resolve(false),
              child: const Text('保留电脑版'),
            ),
            FilledButton(
              key: const ValueKey('full-conflict-keep-local'),
              onPressed: saving || !canKeepLocal ? null : () => resolve(true),
              child: Text(
                saving
                    ? '保存中…'
                    : snapshot.createsCopy
                    ? '保留为新待办'
                    : '保留手机版',
              ),
            ),
          ],
        ),
      );
    },
  );
}

class FullWorkspaceBlockedDialog extends StatelessWidget {
  const FullWorkspaceBlockedDialog({
    super.key,
    required this.blocked,
    required this.canEdit,
  });
  final Map<String, dynamic> blocked;
  final bool canEdit;
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('需修正'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            fullSyncBlockedReason(
              (blocked['receipt'] as Map)['code'] as String?,
            ),
          ),
          const SizedBox(height: 12),
          SelectableText(
            (blocked['frozen'] as Map)['json'] as String,
            key: const ValueKey('full-blocked-json'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('关闭'),
      ),
      TextButton(
        key: const ValueKey('full-blocked-discard-open'),
        onPressed: () => Navigator.pop(context, 'discard'),
        child: const Text('放弃手机修改'),
      ),
      if (canEdit)
        FilledButton(
          key: const ValueKey('full-blocked-edit'),
          onPressed: () => Navigator.pop(context, 'edit'),
          child: const Text('修改'),
        ),
    ],
  );
}

class FullSyncBlockedPreview {
  FullSyncBlockedPreview(Map<String, dynamic> preview)
    : value = freezeWorkspaceMap(preview);
  final Map<String, dynamic> value;
  String get kind => value['kind'] as String;
  String get id => value['id'] as String;
  int get localRevision => value['expectedLocalRevision'] as int;
  String get operationId => value['expectedOperationId'] as String;
  int get remoteRevision => value['expectedRemoteRevision'] as int;
  String get localJson => (value['local'] as Map)['json'] as String;
  bool get localDeleted => (value['local'] as Map)['deleted'] == true;
  bool get hasRemote => value['remote'] != null;
  String? get remoteJson => (value['remote'] as Map?)?['json'] as String?;
  bool get remoteDeleted =>
      ((value['remote'] as Map?)?['record'] as Map?)?['deleted'] == true;
}

class FullWorkspaceDiscardBlockedDialog extends StatefulWidget {
  const FullWorkspaceDiscardBlockedDialog({
    super.key,
    required this.engine,
    required this.preview,
  });
  final WorkspaceSyncEngine engine;
  final Map<String, dynamic> preview;
  @override
  State<FullWorkspaceDiscardBlockedDialog> createState() =>
      _FullWorkspaceDiscardBlockedDialogState();
}

class _FullWorkspaceDiscardBlockedDialogState
    extends State<FullWorkspaceDiscardBlockedDialog> {
  late final snapshot = FullSyncBlockedPreview(widget.preview);
  bool saving = false;
  String? error;

  Future<void> discard() async {
    if (saving) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.engine.discardBlocked(
        snapshot.kind,
        snapshot.id,
        expectedLocalRevision: snapshot.localRevision,
        expectedOperationId: snapshot.operationId,
        expectedRemoteRevision: snapshot.remoteRevision,
      );
      if (mounted) Navigator.pop(context);
    } catch (failure) {
      if (mounted) setState(() => error = '$failure');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: const Text('放弃当前手机修改？'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(fullSyncBlockedReason(snapshot.value['code'] as String?)),
            const SizedBox(height: 12),
            Text(
              '当前手机 · ${snapshot.localDeleted ? '已删除' : '未删除'}',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            SelectableText(
              snapshot.localJson,
              key: const ValueKey('full-blocked-local-json'),
            ),
            const SizedBox(height: 20),
            Text(
              snapshot.hasRemote
                  ? '已接收电脑版本 · ${snapshot.remoteDeleted ? '已删除' : '未删除'}'
                  : '电脑尚无记录',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            if (snapshot.hasRemote) ...[
              const SizedBox(height: 8),
              SelectableText(
                snapshot.remoteJson!,
                key: const ValueKey('full-blocked-remote-json'),
              ),
            ],
            const SizedBox(height: 16),
            Text(
              snapshot.hasRemote
                  ? '将采用已接收的电脑版本，当前手机原稿存入本机归档。'
                  : '将移除当前手机副本，原稿存入本机归档，不会删除电脑资料。',
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  error!,
                  key: const ValueKey('full-blocked-discard-error'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('full-blocked-discard-confirm'),
          onPressed: saving ? null : discard,
          child: Text(saving ? '保存中…' : '放弃手机修改'),
        ),
      ],
    ),
  );
}
