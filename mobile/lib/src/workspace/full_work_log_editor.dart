import 'package:flutter/material.dart';
import 'workspace_controller.dart';
import 'workspace_full_models.dart';
import 'workspace_v2_contract.dart';
import 'full_work_log_view.dart';

Map<String, dynamic> fullWorkLogCommand(String day, String input) {
  if (!workspaceV2Day(day)) throw const FormatException('日期无效');
  final value = input.trim();
  final minutes = RegExp(r'^\d+$').hasMatch(value) ? int.tryParse(value) : null;
  if (minutes == null || minutes < 0 || minutes > 1440) {
    throw const FormatException('请输入0至1440的整数分钟');
  }
  return {'day': day, 'minutes': minutes};
}

class FullWorkLogEditor extends StatefulWidget {
  const FullWorkLogEditor({
    super.key,
    required this.controller,
    required this.day,
    this.record,
  });
  final WorkspaceController controller;
  final String day;
  final WorkspaceFullRecord? record;
  @override
  State<FullWorkLogEditor> createState() => _FullWorkLogEditorState();
}

class _FullWorkLogEditorState extends State<FullWorkLogEditor> {
  late final initialText = widget.record?.workMinutes?.toString() ?? '';
  late final text = TextEditingController(text: initialText);
  late final revision = widget.record?.revision ?? 0;
  bool saving = false, confirming = false;
  String? error;
  WorkspaceFullRecord? get live =>
      widget.controller.findFull('work_log', widget.day, includeDeleted: true);
  bool get canWrite =>
      !saving &&
      !confirming &&
      widget.controller.canWriteFullKind('work_log') &&
      (widget.record == null || fullWorkLogCanWrite(widget.record!)) &&
      (live == null || fullWorkLogCanWrite(live!));
  bool get canClear =>
      canWrite &&
      widget.record != null &&
      !widget.record!.deleted &&
      live?.deleted == false &&
      live?.metadata['deletable'] == true &&
      widget.record!.metadata['deletable'] == true;

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  Future<void> save({bool clear = false}) async {
    if (saving || confirming) return;
    try {
      if (!canWrite || clear && !canClear) throw StateError('此记录当前只读');
      if (!clear &&
          widget.record != null &&
          !widget.record!.deleted &&
          text.text == initialText) {
        Navigator.pop(context);
        return;
      }
      final command = clear
          ? <String, dynamic>{'day': widget.day, 'clear': true}
          : fullWorkLogCommand(widget.day, text.text);
      setState(() {
        saving = true;
        error = null;
      });
      await widget.controller.saveFullWorkLog(command, revision);
      if (mounted) Navigator.pop(context);
    } catch (failure) {
      if (mounted) {
        setState(
          () =>
              error = failure is FormatException ? failure.message : '$failure',
        );
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> clear() async {
    if (!canClear) return;
    setState(() => confirming = true);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('清空这天的投入记录？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('清空'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    setState(() => confirming = false);
    if (confirmed == true) await save(clear: true);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) {
      final rawOnly =
          widget.record != null && !fullWorkLogCanWrite(widget.record!);
      return PopScope(
        canPop: !saving && !confirming,
        child: AlertDialog(
          title: Text('${widget.day.substring(5)}投入'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (rawOnly) ...[
                  Text(fullWorkLogReading(widget.record).label),
                  const SizedBox(height: 12),
                  SelectableText(
                    widget.record!.rawJson,
                    key: const ValueKey('full-work-raw'),
                  ),
                ] else
                  TextField(
                    key: const ValueKey('full-work-minutes'),
                    controller: text,
                    autofocus: true,
                    readOnly: !canWrite,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
                    onSubmitted: canWrite ? (_) => save() : null,
                    decoration: const InputDecoration(labelText: '分钟'),
                  ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      error!,
                      key: const ValueKey('full-work-error'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            if (widget.record != null && !widget.record!.deleted && !rawOnly)
              TextButton(
                onPressed: canClear ? clear : null,
                child: const Text('清空记录'),
              ),
            TextButton(
              onPressed: saving || confirming
                  ? null
                  : () => Navigator.pop(context),
              child: Text(rawOnly ? '关闭' : '取消'),
            ),
            if (!rawOnly)
              FilledButton(
                onPressed: canWrite ? () => save() : null,
                child: Text(saving ? '保存中…' : '保存'),
              ),
          ],
        ),
      );
    },
  );
}
