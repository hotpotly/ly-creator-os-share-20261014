import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'workspace_controller.dart';
import 'workspace_models.dart';

List<String> parseTodoBatch(String text) {
  final titles = text
      .split(RegExp(r'\r\n|\n|\r'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  if (titles.isEmpty) throw const FormatException('请输入待办内容');
  if (titles.length > 100) throw const FormatException('一次最多添加100项');
  if (titles.any((s) => s.length > 300)) {
    throw const FormatException('每项待办最多300字');
  }
  return titles;
}

class TodoComposer extends StatefulWidget {
  const TodoComposer({
    super.key,
    required this.controller,
    required this.day,
    this.record,
  });
  final WorkspaceController controller;
  final String day;
  final WorkspaceRecord? record;
  @override
  State<TodoComposer> createState() => _TodoComposerState();
}

class _TodoComposerState extends State<TodoComposer> {
  late final title = TextEditingController(
    text: widget.record?.data['title'] as String? ?? '',
  );
  final focus = FocusNode();
  late String category =
      widget.record?.data['category'] as String? ?? 'self_media';
  late String day = widget.record?.data['plannedDate'] as String? ?? widget.day;
  bool saving = false;
  bool batch = false;
  int created = 0;
  String? error;
  bool get editing => widget.record != null;

  @override
  void dispose() {
    title.dispose();
    focus.dispose();
    super.dispose();
  }

  Future<void> save({bool keepOpen = false, bool deleted = false}) async {
    if (saving) return;
    if (!editing && !keepOpen && created > 0 && title.text.trim().isEmpty) {
      Navigator.pop(context);
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      if (!deleted && title.text.trim().isEmpty) {
        throw const FormatException('请输入待办内容');
      }
      final titles = deleted
          ? [widget.record!.data['title'] as String]
          : batch
          ? parseTodoBatch(title.text)
          : [title.text.trim()];
      final records = titles
          .map(
            (text) => editing
                ? widget.record!.copy(
                    deleted: deleted,
                    data: {
                      ...widget.record!.data,
                      'title': text,
                      'category': category,
                      'plannedDate': day,
                    },
                  )
                : WorkspaceRecord(
                    kind: 'todo',
                    id: workspaceId(),
                    data: {
                      'title': text,
                      'category': category,
                      'plannedDate': day,
                      'completedAt': null,
                    },
                  ),
          )
          .toList();
      await widget.controller.saveAll(records);
      if (!mounted) return;
      HapticFeedback.lightImpact();
      if (keepOpen && !editing) {
        setState(() {
          created += records.length;
          title.clear();
        });
      } else {
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        setState(() => error = e is FormatException ? e.message : '$e');
      }
    } finally {
      if (mounted) {
        setState(() => saving = false);
        if (keepOpen) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) focus.requestFocus();
          });
        }
      }
    }
  }

  void submit(String value) {
    if (saving || editing) return;
    if (!batch) {
      save(keepOpen: true);
      return;
    }
    final selection = title.selection;
    final start = selection.isValid ? selection.start : title.text.length;
    final end = selection.isValid ? selection.end : start;
    setState(
      () => title.value = TextEditingValue(
        text: title.text.replaceRange(start, end, '\n'),
        selection: TextSelection.collapsed(offset: start + 1),
      ),
    );
    focus.requestFocus();
  }

  Future<void> pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: parseWorkspaceDay(day),
      firstDate: DateTime(1900),
      lastDate: DateTime(2199, 12, 31),
    );
    if (date != null && mounted) setState(() => day = workspaceDay(date));
  }

  Future<void> delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除这条待办？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) await save(deleted: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final today = workspaceDay(DateTime.now());
    final tomorrow = workspaceDay(
      DateUtils.dateOnly(DateTime.now()).add(const Duration(days: 1)),
    );
    final count = title.text
        .split(RegExp(r'\r\n|\n|\r'))
        .where((s) => s.trim().isNotEmpty)
        .length;
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 180);
    return PopScope(
      canPop: !saving,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        editing ? '编辑待办' : '新增待办',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (!editing)
                      TextButton.icon(
                        onPressed: saving
                            ? null
                            : () => setState(() => batch = !batch),
                        icon: Icon(
                          batch ? Icons.short_text : Icons.playlist_add,
                          size: 20,
                        ),
                        label: Text(batch ? '逐条' : '批量'),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('todo-content'),
                  controller: title,
                  focusNode: focus,
                  autofocus: true,
                  readOnly: saving,
                  minLines: batch ? 3 : 1,
                  maxLines: batch
                      ? 6
                      : editing
                      ? 4
                      : 1,
                  keyboardType: batch || editing
                      ? TextInputType.multiline
                      : TextInputType.text,
                  textInputAction: batch || editing
                      ? TextInputAction.newline
                      : TextInputAction.next,
                  onSubmitted: editing ? null : submit,
                  onChanged: (text) => setState(() {
                    error = null;
                    if (!editing && text.contains(RegExp(r'[\r\n]'))) {
                      batch = true;
                    }
                  }),
                  style: theme.textTheme.titleMedium?.copyWith(height: 1.5),
                  decoration: InputDecoration(
                    hintText: batch ? '一行一项' : '待办内容',
                    errorText: error,
                    errorMaxLines: 3,
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final entry in workspaceCategories.entries)
                      ChoiceChip(
                        label: Text(entry.value),
                        selected: category == entry.key,
                        showCheckmark: false,
                        onSelected: saving
                            ? null
                            : (_) => setState(() => category = entry.key),
                      ),
                  ],
                ),
                Wrap(
                  spacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final entry in {today: '今天', tomorrow: '明天'}.entries)
                      ChoiceChip(
                        label: Text(entry.value),
                        selected: day == entry.key,
                        showCheckmark: false,
                        onSelected: saving
                            ? null
                            : (_) => setState(() => day = entry.key),
                      ),
                    TextButton.icon(
                      onPressed: saving ? null : pickDate,
                      icon: const Icon(Icons.calendar_today_outlined, size: 18),
                      label: Text(
                        day == today || day == tomorrow
                            ? '日期'
                            : day.substring(5),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    if (editing)
                      IconButton(
                        tooltip: '删除待办',
                        onPressed: saving ? null : delete,
                        icon: const Icon(Icons.delete_outline),
                      ),
                    Expanded(
                      child: AnimatedSwitcher(
                        duration: duration,
                        child: created == 0
                            ? const SizedBox()
                            : Text(
                                '已添加$created项',
                                key: ValueKey(created),
                                style: TextStyle(
                                  color: theme.colorScheme.primary,
                                ),
                              ),
                      ),
                    ),
                    TextButton(
                      onPressed: saving ? null : () => Navigator.pop(context),
                      child: const Text('取消'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: saving ? null : () => save(),
                      child: Text(
                        saving
                            ? '保存中…'
                            : !editing && batch && count > 0
                            ? '添加$count项'
                            : !editing &&
                                  created > 0 &&
                                  title.text.trim().isEmpty
                            ? '完成'
                            : '保存',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
