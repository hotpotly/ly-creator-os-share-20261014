import 'dart:async';
import 'package:flutter/material.dart';
import 'workspace_controller.dart';
import 'workspace_models.dart';
import 'full_work_log_editor.dart';
import 'full_work_log_view.dart';

class ReviewPage extends StatefulWidget {
  const ReviewPage({super.key, required this.controller});
  final WorkspaceController controller;
  @override
  State<ReviewPage> createState() => _ReviewPageState();
}

class _ReviewPageState extends State<ReviewPage> with WidgetsBindingObserver {
  Timer? autosave;
  DateTime anchor = DateTime.now();
  bool monthly = false;
  late WorkspaceRecord draft;
  final goals = TextEditingController();
  final body = TextEditingController();
  bool dirty = false;
  bool saving = false;
  String? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    read();
    goals.addListener(changed);
    body.addListener(changed);
  }

  void changed() {
    if (!dirty) setState(() => dirty = true);
    autosave?.cancel();
    autosave = Timer(const Duration(seconds: 2), () => unawaited(save()));
  }

  void read() {
    draft =
        widget.controller.find(
          'review_draft',
          reviewPeriodId(anchor, monthly),
        ) ??
        WorkspaceRecord(
          kind: 'review_draft',
          id: reviewPeriodId(anchor, monthly),
          data: {'goalsText': '', 'bodyText': ''},
        );
    goals.text = draft.data['goalsText'] as String;
    body.text = draft.data['bodyText'] as String;
    dirty = false;
    error = null;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    autosave?.cancel();
    goals.dispose();
    body.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) unawaited(save());
  }

  Future<bool> save() async {
    if (saving) return false;
    if (!dirty) return true;
    autosave?.cancel();
    final snapshotGoals = goals.text;
    final snapshotBody = body.text;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.controller.save(
        draft.copy(
          data: {'goalsText': snapshotGoals, 'bodyText': snapshotBody},
        ),
      );
      if (!mounted) return false;
      draft = widget.controller.find('review_draft', draft.id)!;
      setState(
        () => dirty = goals.text != snapshotGoals || body.text != snapshotBody,
      );
      if (dirty) {
        autosave = Timer(const Duration(seconds: 2), () => unawaited(save()));
      }
      return true;
    } catch (e) {
      if (mounted) setState(() => error = '$e');
      return false;
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> change(DateTime date, bool nextMonthly) async {
    if (!await save() || !mounted) return;
    setState(() {
      anchor = date;
      monthly = nextMonthly;
      read();
    });
  }

  Future<void> editMinutes(String day) async {
    if (widget.controller.fullActive) {
      await showDialog<void>(
        context: context,
        builder: (_) => FullWorkLogEditor(
          controller: widget.controller,
          day: day,
          record: widget.controller.findFull(
            'work_log',
            day,
            includeDeleted: true,
          ),
        ),
      );
      return;
    }
    final record =
        widget.controller.find('work_log', day, includeDeleted: true) ??
        WorkspaceRecord(kind: 'work_log', id: day, data: {'minutes': null});
    await showDialog<void>(
      context: context,
      builder: (_) =>
          _MinutesEditor(controller: widget.controller, record: record),
    );
  }

  @override
  Widget build(BuildContext context) {
    final start = parseWorkspaceDay(draft.id.split(':').last);
    final days = monthly
        ? DateUtils.getDaysInMonth(start.year, start.month)
        : 7;
    return Scaffold(
      appBar: AppBar(
        title: const Text('计划与复盘'),
        actions: [
          TextButton(
            onPressed: dirty && !saving ? save : null,
            child: Text(
              saving
                  ? '保存中…'
                  : dirty
                  ? '保存草稿'
                  : draft.revision > 0
                  ? '已存本机'
                  : '草稿',
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          SegmentedButton<bool>(
            showSelectedIcon: false,
            style: ButtonStyle(
              side: const WidgetStatePropertyAll(BorderSide.none),
              shape: WidgetStatePropertyAll(
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              backgroundColor: WidgetStateProperty.resolveWith(
                (states) => states.contains(WidgetState.selected)
                    ? Theme.of(context).colorScheme.primaryContainer
                    : Theme.of(context).colorScheme.surfaceContainerLow,
              ),
              foregroundColor: WidgetStatePropertyAll(
                Theme.of(context).colorScheme.onSurface,
              ),
            ),
            segments: const [
              ButtonSegment(value: false, label: Text('周')),
              ButtonSegment(value: true, label: Text('月')),
            ],
            selected: {monthly},
            onSelectionChanged: saving
                ? null
                : (values) => change(anchor, values.first),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                tooltip: '上一周期',
                onPressed: saving
                    ? null
                    : () => change(
                        monthly
                            ? DateTime(start.year, start.month - 1)
                            : DateTime(start.year, start.month, start.day - 7),
                        monthly,
                      ),
                icon: const Icon(Icons.chevron_left),
              ),
              Flexible(
                child: Text(
                  monthly
                      ? '${start.year}年${start.month}月'
                      : '${start.month}月${start.day}日—${workspaceDay(DateTime(start.year, start.month, start.day + 6)).substring(5)}',
                ),
              ),
              IconButton(
                tooltip: '下一周期',
                onPressed: saving
                    ? null
                    : () => change(
                        monthly
                            ? DateTime(start.year, start.month + 1)
                            : DateTime(start.year, start.month, start.day + 7),
                        monthly,
                      ),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
          _ReviewNote(
            title: monthly ? '月目标草稿' : '周目标草稿',
            controller: goals,
            minLines: 3,
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Material(
              type: MaterialType.transparency,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '实际投入',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  AnimatedBuilder(
                    animation: widget.controller,
                    builder: (context, _) {
                      final dates = List.generate(
                        days,
                        (i) => workspaceDay(
                          DateTime(start.year, start.month, start.day + i),
                        ),
                      );
                      if (widget.controller.fullActive) {
                        return FullWorkLogView(
                          controller: widget.controller,
                          dates: dates,
                          onEdit: editMinutes,
                          initiallyExpanded: !monthly,
                        );
                      }
                      final values = dates
                          .map(
                            (day) =>
                                widget.controller
                                        .find('work_log', day)
                                        ?.data['minutes']
                                    as int?,
                          )
                          .toList();
                      final total = values.fold<int>(
                        0,
                        (sum, value) => sum + (value ?? 0),
                      );
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: Text(
                              '${total ~/ 60}小时${total % 60 == 0 ? '' : '${total % 60}分钟'}',
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                          ),
                          ExpansionTile(
                            tilePadding: EdgeInsets.zero,
                            title: const Text('每天记录'),
                            initiallyExpanded: !monthly,
                            children: List.generate(
                              dates.length,
                              (i) => ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  '${dates[i].substring(5)}  周${['一', '二', '三', '四', '五', '六', '日'][parseWorkspaceDay(dates[i]).weekday - 1]}',
                                ),
                                trailing: Text(
                                  values[i] == null
                                      ? '未记录'
                                      : '${values[i]! ~/ 60}小时${values[i]! % 60 == 0 ? '' : '${values[i]! % 60}分钟'}',
                                ),
                                onTap: () => editMinutes(dates[i]),
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _ReviewNote(title: '自由复盘草稿', controller: body, minLines: 6),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: dirty && !saving ? save : null,
            child: const Text('保存草稿'),
          ),
        ],
      ),
    );
  }
}

class _ReviewNote extends StatelessWidget {
  const _ReviewNote({
    required this.title,
    required this.controller,
    required this.minLines,
  });
  final String title;
  final TextEditingController controller;
  final int minLines;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        Semantics(
          label: title,
          child: TextField(
            controller: controller,
            minLines: minLines,
            maxLines: null,
            maxLength: 100000,
            decoration: const InputDecoration(
              filled: false,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              counterText: '',
              contentPadding: EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
      ],
    ),
  );
}

class _MinutesEditor extends StatefulWidget {
  const _MinutesEditor({required this.controller, required this.record});
  final WorkspaceController controller;
  final WorkspaceRecord record;
  @override
  State<_MinutesEditor> createState() => _MinutesEditorState();
}

class _MinutesEditorState extends State<_MinutesEditor> {
  late final text = TextEditingController(
    text: widget.record.data['minutes']?.toString() ?? '',
  );
  String? error;
  bool saving = false;
  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  Future<void> save() async {
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final raw = text.text.trim();
      final minutes = raw.isEmpty ? null : int.tryParse(raw);
      if (raw.isNotEmpty && minutes == null) {
        throw const FormatException('请输入整数分钟');
      }
      await widget.controller.save(
        widget.record.copy(
          data: {'minutes': minutes},
          deleted: minutes == null,
        ),
      );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: Text('${widget.record.id}投入'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: text,
            autofocus: true,
            enabled: !saving,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: '分钟',
              hintText: '留空为未记录',
            ),
          ),
          if (error != null)
            Text(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(onPressed: saving ? null : save, child: const Text('保存')),
      ],
    ),
  );
}
