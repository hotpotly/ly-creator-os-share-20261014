import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'full_todo_catalog.dart';
import 'full_todo_commands.dart';
import 'workspace_controller.dart';
import 'workspace_domain_v2.dart';
import 'workspace_full_models.dart';
import 'workspace_models.dart';
import 'workspace_theme.dart';

class FullTodoComposer extends StatefulWidget {
  const FullTodoComposer({
    super.key,
    required this.controller,
    required this.day,
    this.record,
  });
  final WorkspaceController controller;
  final String day;
  final WorkspaceFullRecord? record;
  @override
  State<FullTodoComposer> createState() => _FullTodoComposerState();
}

class _FullTodoComposerState extends State<FullTodoComposer> {
  late final original = widget.record?.body ?? <String, dynamic>{};
  late final title = TextEditingController(
    text: original['title'] as String? ?? '',
  );
  late final start = TextEditingController(
    text:
        (original['dateRange'] as Map?)?['startDate'] as String? ??
        original['plannedDate'] as String? ??
        widget.day,
  );
  late final end = TextEditingController(
    text: (original['dateRange'] as Map?)?['endDate'] as String? ?? start.text,
  );
  late final rangeName = TextEditingController(
    text: (original['dateRange'] as Map?)?['name'] as String? ?? '',
  );
  late final progress = TextEditingController(
    text: '${original['progress'] ?? 0}',
  );
  late final before = TextEditingController(
    text: original['progressBeforeComplete']?.toString() ?? '',
  );
  final focus = FocusNode();
  late String category = original['category'] as String? ?? 'self_media';
  late String dateMode = original['dateRange'] != null
      ? 'range'
      : editing && original['plannedDate'] == null
      ? 'none'
      : 'day';
  late String? segment = original['segment'] as String?;
  late String? projectId = original['projectId'] as String?;
  late String? stageKey = original['stageKey'] as String?;
  late String trackingMode = original['trackingMode'] as String? ?? 'checklist';
  late bool completed = original['status'] == 'completed';
  late num completionProgress = original['progress'] as num? ?? 0;
  late String? completedAt = original['completedAt'] as String?;
  late bool extra = original['isExtra'] == true;
  late final showBeforeProgress =
      original['progressBeforeComplete'] is num &&
      ((original['progressBeforeComplete'] as num).truncateToDouble() !=
              original['progressBeforeComplete'] ||
          (original['progressBeforeComplete'] as num) < 0 ||
          (original['progressBeforeComplete'] as num) > 99);
  late final showLegacyProgress =
      original['progress'] is num &&
      (original['progress'] as num).truncateToDouble() != original['progress'];
  bool saving = false,
      batch = false,
      completionDirty = false,
      dateDirty = false,
      projectDirty = false;
  int created = 0;
  String? error;
  bool get editing => widget.record != null;
  FullTodoCatalog get catalog => FullTodoCatalog(widget.controller.fullRecords);
  bool can(Iterable<String> fields) {
    if (saving ||
        !widget.controller.loaded ||
        widget.controller.error != null) {
      return false;
    }
    if (!editing) return widget.controller.canWriteFullKind('todo');
    final live = widget.controller.findFull(
      'todo',
      widget.record!.id,
      includeDeleted: true,
    );
    return live != null &&
        fullTodoCanEdit(live, fields) &&
        fullTodoCanEdit(widget.record!, fields);
  }

  bool get canSave => can(const []) && (editing || catalog.labels.isNotEmpty);

  @override
  void dispose() {
    for (final field in [title, start, end, rangeName, progress, before]) {
      field.dispose();
    }
    focus.dispose();
    super.dispose();
  }

  num number(String text) {
    final parsed = num.tryParse(text.trim());
    if (parsed == null || !parsed.isFinite) {
      throw const FormatException('请先将进度调整为整数');
    }
    return parsed;
  }

  Map<String, dynamic> completion({bool validate = true}) {
    final result = fullTodoProgressCompletion({
      'status': completed ? 'completed' : 'open',
      'trackingMode': trackingMode,
      'progress': completionProgress,
      'progressBeforeComplete': before.text.trim().isEmpty
          ? null
          : number(before.text),
      'completedAt': completedAt,
    }, number(progress.text));
    if (validate) workspaceDomainV2Validate('completion', result);
    return result;
  }

  bool get shownCompleted {
    try {
      return completion(validate: false)['status'] == 'completed';
    } catch (_) {
      return completed;
    }
  }

  Map<String, dynamic> date() => {
    'plannedDate': dateMode == 'day' ? start.text.trim() : null,
    'segment': dateMode == 'range' ? null : segment,
    'dateRange': dateMode == 'range'
        ? {
            'startDate': start.text.trim(),
            'endDate': end.text.trim(),
            'name': fullTodoTrim(rangeName.text),
          }
        : null,
  };
  Map<String, dynamic> project() => {
    'projectId': projectId,
    'stageKey': stageKey,
    'stageLinkSource': stageKey == null ? null : 'manual',
  };

  void toggleCompletion() {
    try {
      final group = fullTodoToggleCompletion(completion(validate: false));
      setState(() {
        completed = group['status'] == 'completed';
        completedAt = group['completedAt'] as String?;
        completionProgress = group['progress'] as num;
        progress.text = '${group['progress']}';
        before.text = group['progressBeforeComplete']?.toString() ?? '';
        completionDirty = true;
        error = null;
      });
    } catch (failure) {
      setState(
        () => error = failure is FormatException ? failure.message : '$failure',
      );
    }
  }

  Future<void> save({bool keepOpen = false, bool deleted = false}) async {
    if (saving) return;
    if (!editing &&
        created > 0 &&
        fullTodoTrim(title.text).isEmpty &&
        !keepOpen) {
      Navigator.pop(context);
      return;
    }
    try {
      if (!canSave && !deleted) {
        throw StateError(editing ? '此待办当前只读' : '分类尚未同步或当前未获写入授权');
      }
      if (!deleted &&
          projectDirty &&
          projectId != null &&
          (!catalog.projects.any((p) => p.id == projectId) ||
              stageKey != null &&
                  !catalog.stages(projectId).contains(stageKey))) {
        throw const FormatException('请选择当前可用的项目和阶段');
      }
      if (!deleted &&
          editing &&
          category != original['category'] &&
          !catalog.labels.containsKey(category)) {
        throw const FormatException('分类尚未同步');
      }
      final commands = <Map<String, dynamic>>[];
      if (editing) {
        final record = widget.record!;
        if (deleted &&
            !(widget.controller.findFull('todo', record.id)?.deletable ??
                false)) {
          throw StateError('此待办不可删除');
        }
        commands.add({
          'expectedLocalRevision': record.revision,
          'command': deleted
              ? {'id': record.id, 'deleted': true}
              : fullTodoEditCommand(
                  record,
                  fields: {
                    if (title.text != original['title']) 'title': title.text,
                    if (category != original['category']) 'category': category,
                    if (extra != (original['isExtra'] == true))
                      'isExtra': extra,
                  },
                  completion: completionDirty
                      ? completion(validate: false)
                      : null,
                  date: dateDirty ? date() : null,
                  project: projectDirty ? project() : null,
                ),
        });
      } else {
        final titles = batch
            ? fullTodoParseBatch(title.text)
            : [fullTodoTrim(title.text)];
        if (!catalog.labels.containsKey(category)) {
          throw const FormatException('分类尚未同步');
        }
        final dates = date(), projects = project();
        for (final text in titles) {
          commands.add({
            'expectedLocalRevision': 0,
            'command': {
              'id': workspaceId(),
              'body': fullTodoCreateBody(
                title: text,
                category: category,
                isExtra: extra,
                plannedDate: dates['plannedDate'] as String?,
                segment: dates['segment'] as String?,
                dateRange: dates['dateRange'] as Map<String, dynamic>?,
                projectId: projects['projectId'] as String?,
                stageKey: projects['stageKey'] as String?,
                completion: completion(),
              ),
            },
          });
        }
      }
      setState(() {
        saving = true;
        error = null;
      });
      await widget.controller.saveFullTodos(commands);
      if (!mounted) return;
      HapticFeedback.lightImpact();
      if (keepOpen && !editing) {
        setState(() {
          created += commands.length;
          title.clear();
        });
      } else {
        Navigator.pop(context);
      }
    } catch (failure) {
      if (mounted) {
        setState(
          () =>
              error = failure is FormatException ? failure.message : '$failure',
        );
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

  void submit(String _) {
    if (editing || saving) return;
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

  Future<void> pickDate(TextEditingController value) async {
    if (!can(fullTodoDateFields)) return;
    final parsed = DateTime.tryParse(value.text.trim()) ?? DateTime.now();
    final first = DateTime(1), last = DateTime(9999, 12, 31);
    final initial = parsed.isBefore(first)
        ? first
        : parsed.isAfter(last)
        ? last
        : parsed;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
    );
    if (picked != null && mounted) {
      setState(() {
        value.text = workspaceDay(picked);
        dateDirty = true;
      });
    }
  }

  Widget dateField(TextEditingController value, String label, String key) =>
      Padding(
        padding: const EdgeInsets.only(top: 10),
        child: TextField(
          key: ValueKey(key),
          controller: value,
          readOnly: !can(fullTodoDateFields),
          keyboardType: TextInputType.datetime,
          onChanged: (_) => setState(() => dateDirty = true),
          decoration: InputDecoration(
            labelText: label,
            hintText: 'YYYY-MM-DD',
            suffixIcon: IconButton(
              tooltip: '选择$label',
              onPressed: can(fullTodoDateFields) ? () => pickDate(value) : null,
              icon: const Icon(Icons.calendar_today_outlined, size: 20),
            ),
          ),
        ),
      );
  Widget section({
    required String label,
    required String value,
    required IconData icon,
    required List<Widget> children,
  }) => ExpansionTile(
    tilePadding: EdgeInsets.zero,
    childrenPadding: const EdgeInsets.only(bottom: 8),
    leading: Icon(icon, size: 20),
    title: Text(label),
    subtitle: Text(value),
    children: children,
  );

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) {
      final theme = Theme.of(context), data = catalog;
      final count = title.text
          .split(RegExp(r'\r\n|\n|\r'))
          .where((s) => s.trim().isNotEmpty)
          .length;
      final projectChoices = data.projects;
      final projectUnavailable =
          projectId != null && !projectChoices.any((p) => p.id == projectId);
      final stages = projectUnavailable ? <String>[] : data.stages(projectId);
      final canProject = can(fullTodoProjectFields);
      final canCompletion = can(fullTodoCompletionFields);
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
                    key: const ValueKey('full-todo-content'),
                    controller: title,
                    focusNode: focus,
                    autofocus: true,
                    readOnly: !can(['title']),
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
                    onChanged: (value) => setState(() {
                      error = null;
                      if (!editing && value.contains(RegExp(r'[\r\n]'))) {
                        batch = true;
                      }
                    }),
                    decoration: InputDecoration(
                      hintText: batch ? '一行一项' : '待办内容',
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (data.labels.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(editing ? '分类：$category' : '分类尚未同步'),
                    ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final entry in data.labels.entries)
                        ChoiceChip(
                          label: Text(entry.value),
                          selected: category == entry.key,
                          showCheckmark: true,
                          checkmarkColor: workspaceIdentityColors(
                            data.colors[entry.key],
                            theme.brightness,
                          )?.foreground,
                          selectedColor: workspaceIdentityColors(
                            data.colors[entry.key],
                            theme.brightness,
                          )?.background,
                          backgroundColor: workspaceIdentityColors(
                            data.colors[entry.key],
                            theme.brightness,
                          )?.background,
                          labelStyle: TextStyle(
                            color: workspaceIdentityColors(
                              data.colors[entry.key],
                              theme.brightness,
                            )?.foreground,
                          ),
                          onSelected: can(['category'])
                              ? (_) => setState(() => category = entry.key)
                              : null,
                        ),
                    ],
                  ),
                  section(
                    label: '待办日期',
                    value: dateMode == 'none'
                        ? '无日期'
                        : dateMode == 'range'
                        ? '${start.text}—${end.text}'
                        : start.text,
                    icon: Icons.calendar_today_outlined,
                    children: [
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final entry in {
                            'none': '无日期',
                            'day': '单日',
                            'range': '范围',
                          }.entries)
                            ChoiceChip(
                              label: Text(entry.value),
                              selected: dateMode == entry.key,
                              showCheckmark: false,
                              onSelected: can(fullTodoDateFields)
                                  ? (_) => setState(() {
                                      if (dateMode == entry.key) return;
                                      dateMode = entry.key;
                                      dateDirty = true;
                                    })
                                  : null,
                            ),
                        ],
                      ),
                      if (dateMode == 'day')
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final entry in {
                              workspaceDay(DateTime.now()): '今天',
                              workspaceDay(
                                DateUtils.dateOnly(
                                  DateTime.now(),
                                ).add(const Duration(days: 1)),
                              ): '明天',
                            }.entries)
                              ChoiceChip(
                                label: Text(entry.value),
                                selected: start.text == entry.key,
                                showCheckmark: false,
                                onSelected: can(fullTodoDateFields)
                                    ? (_) => setState(() {
                                        start.text = entry.key;
                                        dateDirty = true;
                                      })
                                    : null,
                              ),
                          ],
                        ),
                      if (dateMode != 'none')
                        dateField(
                          start,
                          dateMode == 'range' ? '开始日期' : '日期',
                          'full-todo-start',
                        ),
                      if (dateMode == 'range') ...[
                        dateField(end, '结束日期', 'full-todo-end'),
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: TextField(
                            key: const ValueKey('full-todo-range-name'),
                            controller: rangeName,
                            readOnly: !can(fullTodoDateFields),
                            onChanged: (_) => setState(() => dateDirty = true),
                            decoration: const InputDecoration(
                              labelText: '范围名称',
                            ),
                          ),
                        ),
                      ] else
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final entry in {
                              '': '未分时段',
                              'morning': '上午',
                              'afternoon': '下午',
                              'evening': '晚上',
                            }.entries)
                              ChoiceChip(
                                label: Text(entry.value),
                                selected: (segment ?? '') == entry.key,
                                showCheckmark: false,
                                onSelected: can(fullTodoDateFields)
                                    ? (_) => setState(() {
                                        segment = entry.key.isEmpty
                                            ? null
                                            : entry.key;
                                        dateDirty = true;
                                      })
                                    : null,
                              ),
                          ],
                        ),
                    ],
                  ),
                  section(
                    label: '进度',
                    value: shownCompleted
                        ? '已完成'
                        : trackingMode == 'progress'
                        ? '${progress.text}%'
                        : '勾选完成',
                    icon: Icons.check_circle_outline,
                    children: [
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final entry in {
                            'checklist': '勾选',
                            'progress': '进度',
                          }.entries)
                            ChoiceChip(
                              label: Text(entry.value),
                              selected: trackingMode == entry.key,
                              showCheckmark: false,
                              onSelected: canCompletion
                                  ? (_) => setState(() {
                                      if (trackingMode == entry.key) return;
                                      final done = shownCompleted;
                                      trackingMode = entry.key;
                                      if (!done &&
                                          trackingMode == 'checklist') {
                                        progress.text = '0';
                                      }
                                      completionDirty = true;
                                    })
                                  : null,
                            ),
                        ],
                      ),
                      if (trackingMode == 'progress' || showLegacyProgress)
                        TextField(
                          key: const ValueKey('full-todo-progress'),
                          controller: progress,
                          readOnly: !canCompletion,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: '进度',
                            suffixText: '%',
                          ),
                          onChanged: (_) =>
                              setState(() => completionDirty = true),
                        ),
                      if (showBeforeProgress)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: TextField(
                            key: const ValueKey('full-todo-before-progress'),
                            controller: before,
                            readOnly: !canCompletion,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: '完成前进度',
                            ),
                            onChanged: (_) =>
                                setState(() => completionDirty = true),
                          ),
                        ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('已完成'),
                        value: shownCompleted,
                        controlAffinity: ListTileControlAffinity.leading,
                        onChanged: canCompletion
                            ? (_) => toggleCompletion()
                            : null,
                      ),
                    ],
                  ),
                  section(
                    label: '关联项目（可选）',
                    value:
                        [
                          data.projectLabel(projectId),
                          data.stageLabel(stageKey),
                        ].whereType<String>().join(' · ').isEmpty
                        ? '不关联项目'
                        : [
                            data.projectLabel(projectId),
                            data.stageLabel(stageKey),
                          ].whereType<String>().join(' · '),
                    icon: Icons.link,
                    children: [
                      DropdownButtonFormField<String>(
                        key: ValueKey('full-todo-project-$projectId'),
                        initialValue: projectId ?? '',
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '关联项目'),
                        items: [
                          const DropdownMenuItem(
                            value: '',
                            child: Text('不关联项目'),
                          ),
                          for (final project in projectChoices)
                            DropdownMenuItem(
                              value: project.id,
                              child: Text(
                                project.title,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          if (projectUnavailable)
                            DropdownMenuItem(
                              value: projectId!,
                              enabled: false,
                              child: Text(
                                '${data.projectLabel(projectId)}（不可新选）',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: canProject
                            ? (value) => setState(() {
                                final next = value == '' ? null : value;
                                if (projectId == next) return;
                                projectId = next;
                                stageKey = null;
                                projectDirty = true;
                              })
                            : null,
                      ),
                      if (projectId != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: DropdownButtonFormField<String>(
                            key: ValueKey(
                              'full-todo-stage-$projectId-$stageKey',
                            ),
                            initialValue: stageKey ?? '',
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: '项目阶段',
                            ),
                            items: [
                              const DropdownMenuItem(
                                value: '',
                                child: Text('不关联阶段'),
                              ),
                              for (final key in stages)
                                DropdownMenuItem(
                                  value: key,
                                  child: Text(data.stageLabel(key)!),
                                ),
                              if (stageKey != null &&
                                  !stages.contains(stageKey))
                                DropdownMenuItem(
                                  value: stageKey!,
                                  enabled: false,
                                  child: Text(
                                    '${data.stageLabel(stageKey)}（不可新选）',
                                  ),
                                ),
                            ],
                            onChanged: canProject && !projectUnavailable
                                ? (value) => setState(() {
                                    final next = value == '' ? null : value;
                                    if (stageKey == next) return;
                                    stageKey = next;
                                    projectDirty = true;
                                  })
                                : null,
                          ),
                        ),
                    ],
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('额外'),
                    value: extra,
                    onChanged: can(['isExtra'])
                        ? (value) => setState(() => extra = value)
                        : null,
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        error!,
                        key: const ValueKey('full-todo-error'),
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ),
                  Row(
                    children: [
                      if (editing &&
                          (widget.controller
                                  .findFull('todo', widget.record!.id)
                                  ?.deletable ??
                              false))
                        IconButton(
                          tooltip: '删除待办',
                          onPressed: saving ? null : delete,
                          icon: const Icon(Icons.delete_outline),
                        ),
                      Expanded(
                        child: created == 0
                            ? const SizedBox()
                            : Text(
                                '已添加$created项',
                                style: TextStyle(
                                  color: theme.colorScheme.primary,
                                ),
                              ),
                      ),
                      TextButton(
                        onPressed: saving ? null : () => Navigator.pop(context),
                        child: const Text('取消'),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: canSave ? () => save() : null,
                        child: Text(
                          saving
                              ? '保存中…'
                              : !editing && batch && count > 0
                              ? '添加$count项'
                              : !editing &&
                                    created > 0 &&
                                    fullTodoTrim(title.text).isEmpty
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
    },
  );
}
