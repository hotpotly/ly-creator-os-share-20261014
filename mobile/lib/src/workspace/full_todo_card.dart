import 'package:flutter/material.dart';
import 'full_todo_catalog.dart';
import 'workspace_full_models.dart';
import 'workspace_theme.dart';

String? _string(Object? value) => value is String ? value : null;

String fullTodoDateLabel(WorkspaceFullRecord record) {
  final body = record.body;
  String short(Object? day) {
    final value = day?.toString() ?? '';
    return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)
        ? value.substring(5)
        : value;
  }

  if (body['dateRange'] case final Map range) {
    return [
      '${short(range['startDate'])}—${short(range['endDate'])}',
      if (range['name'] is String && (range['name'] as String).isNotEmpty)
        range['name'] as String,
    ].join(' · ');
  }
  return [
    body['plannedDate'] == null ? '无日期' : short(body['plannedDate']),
    if (body['segment'] != null)
      const {
            'morning': '上午',
            'afternoon': '下午',
            'evening': '晚上',
          }[body['segment']] ??
          body['segment'].toString(),
  ].join(' · ');
}

class FullTodoCard extends StatelessWidget {
  const FullTodoCard({
    super.key,
    required this.record,
    required this.catalog,
    required this.onOpen,
    this.onToggle,
  });
  final WorkspaceFullRecord record;
  final FullTodoCatalog catalog;
  final VoidCallback onOpen;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final done = record.completed;
    final progressMode = record.body['trackingMode'] == 'progress';
    final category = _string(record.body['category']);
    final categoryLabel = catalog.labels[category];
    final identity = workspaceIdentityColors(
      catalog.colors[category],
      theme.brightness,
    );
    final project = catalog.projectLabel(_string(record.body['projectId']));
    final stage = catalog.stageLabel(_string(record.body['stageKey']));
    return Material(
      color: done ? scheme.surfaceContainerLow : scheme.surface,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 12, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Checkbox(
                value: done,
                shape: const CircleBorder(),
                onChanged: onToggle == null ? null : (_) => onToggle!(),
                semanticLabel: '${done ? '撤销完成' : '完成'}${record.title}',
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        record.title,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: done
                              ? FontWeight.normal
                              : FontWeight.w600,
                          color: done
                              ? scheme.onSurfaceVariant
                              : scheme.onSurface,
                          decoration: done ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (categoryLabel != null)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color:
                                    identity?.background ??
                                    scheme.surfaceContainerLow,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                categoryLabel,
                                style: theme.textTheme.labelMedium?.copyWith(
                                  color:
                                      identity?.foreground ??
                                      scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          if (record.body['isExtra'] == true) const Text('额外'),
                          if (record.body['dateRange'] != null ||
                              record.body['segment'] != null)
                            Text(
                              fullTodoDateLabel(record),
                              style: theme.textTheme.labelMedium,
                            ),
                          if (!record.writable)
                            const Tooltip(
                              message: '仅查看',
                              child: Icon(Icons.lock_outline, size: 16),
                            ),
                          if (record.hasConflict || record.blockedCode != null)
                            Tooltip(
                              message: record.hasConflict ? '待合并' : '需修正',
                              child: Icon(
                                Icons.error_outline,
                                size: 16,
                                color: scheme.error,
                              ),
                            ),
                        ],
                      ),
                      if (project != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          [project, ?stage].join(' · '),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                      if (progressMode && record.progress != null) ...[
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: LinearProgressIndicator(
                                value: (record.progress! / 100)
                                    .clamp(0.0, 1.0)
                                    .toDouble(),
                                minHeight: 3,
                                borderRadius: BorderRadius.circular(8),
                                semanticsLabel: '进度',
                                semanticsValue: '${record.progress}%',
                              ),
                            ),
                            const SizedBox(width: 10),
                            Text(
                              '${record.progress}%',
                              style: theme.textTheme.labelMedium,
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              IconButton(
                tooltip: record.writable ? '编辑待办' : '查看待办',
                onPressed: onOpen,
                icon: const Icon(Icons.more_horiz),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> showFullTodoDetails(
  BuildContext context,
  WorkspaceFullRecord record,
  FullTodoCatalog catalog,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (context) => ConstrainedBox(
    constraints: BoxConstraints(
      maxHeight: MediaQuery.sizeOf(context).height * .85,
    ),
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('待办 · 仅查看')),
              IconButton(
                onPressed: () => Navigator.pop(context),
                tooltip: '关闭',
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SelectableText(
            record.title,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 16),
          Text(fullTodoDateLabel(record)),
          if (catalog.labels[record.body['category']] case final String label)
            Text(label),
          if (record.progress != null) Text('进度${record.progress}%'),
          if (record.body['projectId'] case final String id)
            Text(
              [
                catalog.projectLabel(id)!,
                if (catalog.stageLabel(_string(record.body['stageKey']))
                    case final String stage)
                  stage,
              ].join(' · '),
            ),
          if (!record.supported) ...[
            const SizedBox(height: 16),
            const Text('当前版本无法编辑此格式'),
            ExpansionTile(
              title: const Text('原始内容'),
              children: [SelectableText(record.rawJson)],
            ),
          ],
        ],
      ),
    ),
  ),
);
