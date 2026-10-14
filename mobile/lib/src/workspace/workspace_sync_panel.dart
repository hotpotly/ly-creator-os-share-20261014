import 'package:flutter/material.dart';
import '../sync/workspace_sync_engine.dart';
import 'workspace_models.dart';
import 'workspace_sync_models.dart';
import 'full_sync_dialogs.dart';
import 'full_todo_composer.dart';
import 'full_work_log_editor.dart';
import 'full_work_log_view.dart';

class WorkspaceSyncPanel extends StatefulWidget {
  const WorkspaceSyncPanel({
    super.key,
    required this.engine,
    required this.onConnect,
    this.allowFullUpgrade = false,
  });
  final WorkspaceSyncEngine engine;
  final Future<void> Function() onConnect;
  final bool allowFullUpgrade;
  @override
  State<WorkspaceSyncPanel> createState() => _WorkspaceSyncPanelState();
}

class _WorkspaceSyncPanelState extends State<WorkspaceSyncPanel> {
  WorkspaceSyncEngine get engine => widget.engine;
  bool acting = false;
  bool interrupting = false;
  bool get locked => acting || interrupting;

  Future<void> _action(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    if (locked) return;
    setState(() => acting = true);
    try {
      await action();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => acting = false);
    }
  }

  Future<void> _interrupt(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    if (interrupting) return;
    setState(() => interrupting = true);
    try {
      await action();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => interrupting = false);
    }
  }

  Future<void> _enable(BuildContext context) async {
    if (engine.connection == null || engine.connection!.needsSecurityUpgrade) {
      await widget.onConnect();
      await engine.refresh();
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('启用工作台同步？'),
        content: const Text('与已连接的电脑双向同步待办和每日投入。复盘草稿保留在本机。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('启用同步'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await engine.setEnabled(true);
    }
  }

  Future<void> _conflict(
    BuildContext context,
    Map<String, dynamic> conflict,
  ) async {
    if (engine.activeProtocol == 2) {
      await showDialog<void>(
        context: context,
        builder: (_) =>
            FullWorkspaceConflictDialog(engine: engine, conflict: conflict),
      );
      return;
    }
    final kind = conflict['kind'] as String;
    final local = Map<String, dynamic>.from(conflict['local'] as Map);
    final remote = Map<String, dynamic>.from(conflict['remote'] as Map);
    final restoring =
        kind == 'todo' && remote['deleted'] == true && local['deleted'] != true;
    final canKeepLocal =
        !restoring ||
        workspaceCanCopyDeletedTodo(
          WorkspaceRecord.fromJson(local),
          WorkspaceRecord.fromJson(remote),
        );
    final choice = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('选择保留的版本'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('手机', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              SelectableText(_summary(kind, local)),
              const SizedBox(height: 20),
              Text('电脑', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              SelectableText(_summary(kind, remote)),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('稍后'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('保留电脑版'),
          ),
          FilledButton(
            onPressed: canKeepLocal ? () => Navigator.pop(context, true) : null,
            child: Text(
              !canKeepLocal
                  ? '需电脑恢复'
                  : restoring
                  ? '保留为新待办'
                  : '保留手机版',
            ),
          ),
        ],
      ),
    );
    if (choice != null && context.mounted) {
      await engine.resolve(
        kind,
        conflict['id'] as String,
        keepLocal: choice,
        expectedLocalRevision: local['revision'] as int,
        expectedRemoteRevision: remote['revision'] as int,
      );
    }
  }

  String _summary(String kind, Map<String, dynamic> record) {
    if (record['deleted'] == true) return '已删除';
    final data = record['data'] as Map;
    if (kind == 'work_log') {
      return data['minutes'] == null ? '未记录' : '${data['minutes']}分钟';
    }
    return '${data['title']}\n${workspaceCategories[data['category']] ?? ''}\n'
        '${data['plannedDate'] ?? '无指定日期'}\n${data['completedAt'] == null ? '未完成' : '已完成'}';
  }

  Future<void> _upgrade(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('升级完整工作台？'),
        content: const SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('完整待办'),
              SizedBox(height: 8),
              Text('每日投入'),
              SizedBox(height: 8),
              Text('项目目录 · 只读'),
              SizedBox(height: 8),
              Text('分类偏好 · 只读'),
              SizedBox(height: 16),
              Text('编辑权限以电脑授权为准。升级后不可退回旧工作区，复盘草稿保留在本机。'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('full-upgrade-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认升级'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await engine.upgradeFullWorkspace(
        approvedScopes: fullWorkspaceUpgradeScopes,
      );
    }
  }

  Future<void> _blocked(
    BuildContext context,
    Map<String, dynamic> blocked,
  ) async {
    final kind = blocked['kind'] as String, id = blocked['id'] as String;
    final record = engine.controller.findFull(kind, id, includeDeleted: true);
    final editable =
        record != null &&
        engine.controller.canWriteFullKind(kind) &&
        (kind == 'todo'
            ? record.writable
            : kind == 'work_log' && fullWorkLogCanWrite(record));
    final choice = await showDialog<String>(
      context: context,
      builder: (_) =>
          FullWorkspaceBlockedDialog(blocked: blocked, canEdit: editable),
    );
    if (!context.mounted) return;
    if (choice == 'discard') {
      final preview = await engine.loadBlockedPreview(kind, id);
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) =>
            FullWorkspaceDiscardBlockedDialog(engine: engine, preview: preview),
      );
      return;
    }
    if (choice != 'edit' || record == null) return;
    if (kind == 'todo') {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => FullTodoComposer(
          controller: engine.controller,
          day: workspaceDay(DateTime.now()),
          record: record,
        ),
      );
    } else {
      await showDialog<void>(
        context: context,
        builder: (_) => FullWorkLogEditor(
          controller: engine.controller,
          day: id,
          record: record,
        ),
      );
    }
    await engine.refresh();
  }

  String _fullTitle(Map<String, dynamic> value) => value['kind'] == 'work_log'
      ? '${value['id']}投入'
      : engine.controller
                .findFull(
                  value['kind'] as String,
                  value['id'] as String,
                  includeDeleted: true,
                )
                ?.title ??
            value['id'] as String;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: engine,
    builder: (context, _) => SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '工作台同步',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  tooltip: '关闭',
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(engine.label, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 12),
            for (final conflict in engine.conflicts)
              ListTile(
                key: engine.activeProtocol == 2
                    ? ValueKey(
                        'full-conflict-${conflict['kind']}-${conflict['id']}',
                      )
                    : null,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  engine.activeProtocol == 2
                      ? _fullTitle(conflict)
                      : conflict['kind'] == 'work_log'
                      ? '${conflict['id']}投入'
                      : ((conflict['local'] as Map)['data'] as Map)['title']
                            as String,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: locked
                    ? null
                    : () =>
                          _action(context, () => _conflict(context, conflict)),
              ),
            if (engine.activeProtocol == 2 && engine.blocked.isNotEmpty) ...[
              Text('需修正', style: Theme.of(context).textTheme.titleSmall),
              for (final blocked in engine.blocked)
                ListTile(
                  key: ValueKey(
                    'full-blocked-${blocked['kind']}-${blocked['id']}',
                  ),
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    _fullTitle(blocked),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    fullSyncBlockedReason(
                      (blocked['receipt'] as Map)['code'] as String?,
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: locked
                      ? null
                      : () =>
                            _action(context, () => _blocked(context, blocked)),
                ),
            ],
            if (engine.activeProtocol == 2 &&
                engine.permissionsRefreshRequired) ...[
              if (engine.permissionBlockReason != null)
                const Text('权限资料超出本机处理上限'),
              TextButton(
                key: const ValueKey('full-permissions-retry'),
                onPressed: locked || engine.busy || !engine.enabled
                    ? null
                    : () => _action(context, engine.retryPermissionRefresh),
                child: Text(
                  engine.permissionBlockReason == null ? '更新权限' : '重试权限更新',
                ),
              ),
            ],
            if (engine.activeProtocol == 1 && engine.upgrading)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed: locked || engine.busy || !engine.enabled
                        ? null
                        : engine.requestSync,
                    child: const Text('继续升级'),
                  ),
                  TextButton(
                    key: const ValueKey('full-upgrade-cancel'),
                    onPressed: interrupting
                        ? null
                        : () => _interrupt(context, engine.cancelFullUpgrade),
                    child: const Text('取消升级'),
                  ),
                ],
              ),
            if (widget.allowFullUpgrade &&
                engine.enabled &&
                engine.activeProtocol == 1 &&
                !engine.upgrading)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: OutlinedButton(
                  key: const ValueKey('full-upgrade-open'),
                  onPressed: locked || engine.busy
                      ? null
                      : () => _action(context, () => _upgrade(context)),
                  child: const Text('升级完整工作台'),
                ),
              ),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                if (engine.enabled) ...[
                  if (!engine.upgrading)
                    FilledButton.icon(
                      onPressed: locked || engine.busy
                          ? null
                          : engine.requestSync,
                      icon: const Icon(Icons.sync),
                      label: const Text('立即同步'),
                    ),
                  TextButton(
                    key: const ValueKey('workspace-sync-pause'),
                    onPressed: interrupting
                        ? null
                        : () => _interrupt(
                            context,
                            () => engine.setEnabled(false),
                          ),
                    child: const Text('暂停同步'),
                  ),
                ] else
                  FilledButton(
                    onPressed: locked
                        ? null
                        : () => _action(context, () => _enable(context)),
                    child: Text(engine.connection == null ? '连接电脑' : '启用同步'),
                  ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}
