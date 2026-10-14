import 'package:flutter/material.dart';
import 'workspace_controller.dart';
import 'workspace_models.dart';
import 'todo_composer.dart';
import 'pull_to_add.dart';
import 'full_todo_card.dart';
import 'full_todo_catalog.dart';
import 'full_todo_commands.dart';
import 'full_todo_composer.dart';
import 'workspace_domain_v2.dart';
import 'workspace_full_models.dart';

class TodoPage extends StatefulWidget {
  const TodoPage({super.key, required this.controller});
  final WorkspaceController controller;
  @override
  State<TodoPage> createState() => _TodoPageState();
}

class _TodoPageState extends State<TodoPage> {
  DateTime selected = DateTime.now();
  bool saving = false;

  bool editorOpen = false;
  Future<void> editFull([WorkspaceFullRecord? record]) async {
    if (editorOpen) return;
    final catalog = FullTodoCatalog(widget.controller.fullRecords);
    if (record == null && !widget.controller.canWriteFullKind('todo')) return;
    editorOpen = true;
    try {
      if (record != null && !record.writable) {
        await showFullTodoDetails(context, record, catalog);
      } else {
        await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          isDismissible: false,
          enableDrag: false,
          sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
              ? AnimationStyle.noAnimation
              : const AnimationStyle(
                  duration: Duration(milliseconds: 240),
                  reverseDuration: Duration(milliseconds: 180),
                ),
          builder: (_) => FullTodoComposer(
            controller: widget.controller,
            record: record,
            day: workspaceDay(selected),
          ),
        );
      }
    } finally {
      editorOpen = false;
    }
  }

  Future<void> toggleFull(WorkspaceFullRecord record) async {
    if (saving) return;
    setState(() => saving = true);
    try {
      await widget.controller.saveFullTodo(
        fullTodoToggleCommand(record),
        record.revision,
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error is FormatException ? error.message : '$error'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> edit([WorkspaceRecord? record]) async {
    if (editorOpen || (record != null && !_canEdit(record))) return;
    editorOpen = true;
    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        isDismissible: false,
        enableDrag: false,
        sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
            ? AnimationStyle.noAnimation
            : const AnimationStyle(
                duration: Duration(milliseconds: 240),
                reverseDuration: Duration(milliseconds: 180),
              ),
        builder: (_) => TodoComposer(
          controller: widget.controller,
          record: record,
          day: workspaceDay(selected),
        ),
      );
    } finally {
      editorOpen = false;
    }
  }

  bool _canEdit(WorkspaceRecord record) =>
      record.metadata.isEmpty ||
      (record.metadata['editableFields'] as List? ?? []).contains('title');

  Future<void> toggle(WorkspaceRecord record) async {
    if (saving || !_canEdit(record)) return;
    setState(() => saving = true);
    try {
      await widget.controller.save(
        record.copy(
          data: {
            ...record.data,
            'completedAt': record.data['completedAt'] == null
                ? DateTime.now().toUtc().toIso8601String()
                : null,
          },
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) {
      final full = widget.controller.fullActive;
      final catalog = FullTodoCatalog(widget.controller.fullRecords);
      final day = workspaceDay(selected);
      final today = workspaceDay(DateTime.now());
      final records = widget.controller.records
          .where((r) => r.appearsOn(day, today))
          .toList();
      final fullRecords = widget.controller.fullRecords
          .where((r) => r.appearsOn(day, today))
          .toList();
      final count = full ? fullRecords.length : records.length;
      final canAdd = !full || widget.controller.canWriteFullKind('todo');
      Future<void> add() => full ? editFull() : edit();
      return Scaffold(
        appBar: AppBar(
          title: const Text('待办'),
          actions: [
            TextButton(
              onPressed: () => setState(() => selected = DateTime.now()),
              child: const Text('今天'),
            ),
          ],
        ),
        body: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  tooltip: '前一天',
                  onPressed: full && day == '0000-01-01'
                      ? null
                      : () => setState(
                          () => selected = DateTime(
                            selected.year,
                            selected.month,
                            selected.day - 1,
                          ),
                        ),
                  icon: const Icon(Icons.chevron_left),
                ),
                Flexible(
                  child: TextButton(
                    onPressed: () async {
                      final date = await showDatePicker(
                        context: context,
                        initialDate: selected,
                        firstDate: DateTime(full ? 0 : 1900),
                        lastDate: DateTime(full ? 9999 : 2199, 12, 31),
                      );
                      if (date != null && mounted) {
                        setState(() => selected = date);
                      }
                    },
                    child: Text(
                      textAlign: TextAlign.center,
                      '${selected.month}月${selected.day}日  周${['一', '二', '三', '四', '五', '六', '日'][selected.weekday - 1]}',
                    ),
                  ),
                ),
                IconButton(
                  tooltip: '后一天',
                  onPressed: full && day == '9999-12-31'
                      ? null
                      : () => setState(
                          () => selected = DateTime(
                            selected.year,
                            selected.month,
                            selected.day + 1,
                          ),
                        ),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
            Expanded(
              child: PullToAdd(
                enabled: canAdd,
                onAdd: add,
                child: ListView.separated(
                  key: ValueKey('todo-list-$day'),
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: ClampingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                  itemCount: count == 0 ? 1 : count,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    if (count == 0) {
                      return const SizedBox(
                        height: 280,
                        child: Center(child: Text('暂无待办')),
                      );
                    }
                    if (full) {
                      final record = fullRecords[index];
                      return FullTodoCard(
                        key: ValueKey(record.id),
                        record: record,
                        catalog: catalog,
                        onOpen: () => editFull(record),
                        onToggle:
                            !saving &&
                                workspaceDomainV2TodoUnits['C']!.every(
                                  record.canEdit,
                                )
                            ? () => toggleFull(record)
                            : null,
                      );
                    }
                    final record = records[index];
                    final done = record.data['completedAt'] != null;
                    final theme = Theme.of(context);
                    return Material(
                      key: ValueKey(record.id),
                      animationDuration: MediaQuery.disableAnimationsOf(context)
                          ? Duration.zero
                          : const Duration(milliseconds: 180),
                      color: done
                          ? theme.colorScheme.surfaceContainerLow
                          : theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      clipBehavior: Clip.antiAlias,
                      child: ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 6,
                        ),
                        leading: Checkbox(
                          value: done,
                          shape: const CircleBorder(),
                          onChanged: saving || !_canEdit(record)
                              ? null
                              : (_) => toggle(record),
                          semanticLabel:
                              '${done ? '撤销完成' : '完成'}${record.data['title']}',
                        ),
                        title: Text(
                          record.data['title'] as String,
                          style: TextStyle(
                            fontWeight: done
                                ? FontWeight.normal
                                : FontWeight.w500,
                            color: done
                                ? theme.colorScheme.onSurfaceVariant
                                : theme.colorScheme.onSurface,
                            decoration: done
                                ? TextDecoration.lineThrough
                                : null,
                          ),
                        ),
                        subtitle: Text(
                          workspaceCategories[record.data['category']]!,
                        ),
                        onTap: _canEdit(record) ? () => edit(record) : null,
                        trailing: !_canEdit(record)
                            ? const Tooltip(
                                message: '电脑管理',
                                child: Icon(Icons.lock_outline, size: 18),
                              )
                            : IconButton(
                                tooltip: '编辑待办',
                                icon: const Icon(Icons.more_horiz),
                                onPressed: () => edit(record),
                              ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
        floatingActionButton: !canAdd
            ? null
            : FloatingActionButton.extended(
                onPressed: add,
                icon: const Icon(Icons.add),
                label: const Text('新增待办'),
              ),
      );
    },
  );
}
