import 'package:flutter/material.dart';
import 'workspace_controller.dart';
import 'workspace_full_models.dart';
import 'workspace_theme.dart';

String formatFullWorkMinutes(num minutes) {
  if (!minutes.isFinite) return '不可统计';
  if (minutes < 0) return '$minutes分钟';
  if (minutes == 0) return '0小时';
  final parts = minutes.toString().toLowerCase().split('e');
  final decimal = parts.first.split('.');
  final fraction = decimal.length == 1 ? '' : decimal[1];
  final places =
      fraction.length - (parts.length == 1 ? 0 : int.parse(parts[1]));
  final coefficient = BigInt.parse('${decimal.first}$fraction');
  final scale = BigInt.from(10).pow(places > 0 ? places : 0);
  final total = places < 0
      ? coefficient * BigInt.from(10).pow(-places)
      : coefficient;
  final hours = total ~/ (scale * BigInt.from(60));
  final rest = total % (scale * BigInt.from(60));
  var remaining = rest.toString();
  if (places > 0) {
    final digits = remaining.padLeft(places + 1, '0');
    remaining =
        '${digits.substring(0, digits.length - places)}.${digits.substring(digits.length - places)}'
            .replaceFirst(RegExp(r'0+$'), '')
            .replaceFirst(RegExp(r'\.$'), '');
  }
  return '${hours == BigInt.zero ? '' : '$hours小时'}${rest == BigInt.zero ? '' : '$remaining分钟'}';
}

bool fullWorkLogCanWrite(WorkspaceFullRecord record) =>
    record.kind == 'work_log' &&
    record.supported &&
    record.state['writable'] == true &&
    record.metadata['write'] == true &&
    (record.metadata['editableFields'] as List? ?? []).contains('totalMinutes');

class FullWorkLogReading {
  FullWorkLogReading(this.record);
  final WorkspaceFullRecord? record;
  bool get recorded => record != null && !record!.deleted;
  bool get unsupported =>
      recorded &&
      (!record!.supported ||
          record!.workMinutes == null ||
          !record!.workMinutes!.isFinite);
  num? get minutes => recorded && !unsupported ? record!.workMinutes : null;
  String get label => unsupported
      ? '不可统计'
      : minutes == null
      ? '未记录'
      : formatFullWorkMinutes(minutes!);
}

FullWorkLogReading fullWorkLogReading(WorkspaceFullRecord? record) =>
    FullWorkLogReading(record);

class FullWorkLogSummary {
  FullWorkLogSummary(this.readings);
  final List<FullWorkLogReading> readings;
  int get recordedCount => readings.where((value) => value.recorded).length;
  int get unknownCount => readings.where((value) => value.unsupported).length;
  num? get minutes {
    if (recordedCount == 0 || unknownCount != 0) return null;
    final total = readings.fold<num>(
      0,
      (sum, value) => sum + (value.minutes ?? 0),
    );
    return total.isFinite ? total : null;
  }

  String get label => recordedCount == 0
      ? '未记录'
      : minutes == null
      ? '不可统计'
      : formatFullWorkMinutes(minutes!);
}

FullWorkLogSummary fullWorkLogSummary(
  Iterable<WorkspaceFullRecord> records,
  List<String> dates,
) {
  final byDay = {
    for (final record in records)
      if (record.kind == 'work_log') record.id: record,
  };
  return FullWorkLogSummary([
    for (final day in dates) fullWorkLogReading(byDay[day]),
  ]);
}

class FullWorkLogView extends StatelessWidget {
  const FullWorkLogView({
    super.key,
    required this.controller,
    required this.dates,
    required this.onEdit,
    this.initiallyExpanded = true,
  });
  final WorkspaceController controller;
  final List<String> dates;
  final ValueChanged<String> onEdit;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) {
      final theme = Theme.of(context);
      final summary = fullWorkLogSummary(controller.fullRecords, dates);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              summary.label,
              key: const ValueKey('full-work-total'),
              style: theme.textTheme.headlineSmall,
            ),
          ),
          Text(
            '${summary.recordedCount}/${dates.length}天已记录',
            key: const ValueKey('full-work-coverage'),
            style: theme.textTheme.bodySmall,
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text('每天记录'),
            initiallyExpanded: initiallyExpanded,
            children: [
              for (var index = 0; index < dates.length; index++)
                InkWell(
                  key: ValueKey('full-work-day-${dates[index]}'),
                  onTap: () => onEdit(dates[index]),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Row(
                      children: [
                        Expanded(
                          child: Wrap(
                            spacing: 8,
                            runSpacing: 4,
                            children: [
                              Text(dates[index].substring(5), softWrap: false),
                              Text(
                                '周${['一', '二', '三', '四', '五', '六', '日'][DateTime.parse(dates[index]).weekday - 1]}',
                                softWrap: false,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Flexible(
                          child: Text(
                            summary.readings[index].label,
                            textAlign: TextAlign.end,
                            style: TextStyle(
                              color: workspaceWorkMinutesColor(
                                summary.readings[index].minutes,
                                theme.brightness,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        const Icon(Icons.edit_outlined, size: 18),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ],
      );
    },
  );
}
