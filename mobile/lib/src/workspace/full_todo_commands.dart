import 'dart:convert';

import 'workspace_domain_v2.dart';
import 'workspace_full_models.dart';
import 'workspace_sync_models.dart';

String fullTodoTrim(String value) => value.replaceAll(
  RegExp(
    r'^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
  ),
  '',
);

List<String> fullTodoParseBatch(String text) {
  final titles = text
      .split(RegExp(r'\r\n|\n|\r'))
      .map(fullTodoTrim)
      .where((s) => s.isNotEmpty)
      .toList();
  if (titles.isEmpty) throw const FormatException('请输入待办内容');
  if (titles.length > 100) throw const FormatException('一次最多添加100项');
  if (titles.any((s) => s.length > 300)) {
    throw const FormatException('每项待办最多300字');
  }
  return titles;
}

const fullTodoCompletionFields = [
  'status',
  'trackingMode',
  'progress',
  'progressBeforeComplete',
  'completedAt',
];
const fullTodoDateFields = ['plannedDate', 'segment', 'dateRange'];
const fullTodoProjectFields = ['projectId', 'stageKey', 'stageLinkSource'];

bool fullTodoCanEdit(WorkspaceFullRecord record, Iterable<String> fields) =>
    record.kind == 'todo' && record.writable && fields.every(record.canEdit);

Map<String, dynamic> fullTodoGroup(
  Map<String, dynamic> body,
  Iterable<String> fields,
) => {for (final key in fields) key: body[key]};

int _progress(Object? value) {
  if (value is! num || !value.isFinite || value != value.truncateToDouble()) {
    throw const FormatException('请先将进度调整为整数');
  }
  return value.toInt();
}

Map<String, dynamic> fullTodoToggleCompletion(
  Map<String, dynamic> body, {
  DateTime? now,
}) {
  final mode = body['trackingMode'];
  final progress = _progress(body['progress']);
  final before = body['progressBeforeComplete'] == null
      ? null
      : _progress(body['progressBeforeComplete']);
  final done = body['status'] == 'completed';
  final group = {
    'status': done ? 'open' : 'completed',
    'trackingMode': mode,
    'progress': done
        ? (mode == 'checklist' ? 0 : before ?? progress.clamp(0, 99))
        : 100,
    'progressBeforeComplete': done ? before : progress,
    'completedAt': done
        ? null
        : (now ?? DateTime.now()).toUtc().toIso8601String(),
  };
  workspaceDomainV2Validate('completion', group);
  return group;
}

Map<String, dynamic> fullTodoProgressCompletion(
  Map<String, dynamic> body,
  num value, {
  DateTime? now,
}) {
  final group = fullTodoGroup(body, fullTodoCompletionFields);
  if (value == body['progress']) return group;
  final progress = _progress(value);
  if (progress < 0 || progress > 100) throw const FormatException('进度需为0至100');
  final done = progress == 100;
  final result = {
    ...group,
    'status': done ? 'completed' : 'open',
    'progress': progress,
    'progressBeforeComplete': done && body['status'] != 'completed'
        ? _progress(body['progress'])
        : body['progressBeforeComplete'],
    'completedAt': done
        ? body['status'] == 'completed'
              ? body['completedAt']
              : (now ?? DateTime.now()).toUtc().toIso8601String()
        : null,
  };
  workspaceDomainV2Validate('completion', result);
  return result;
}

Map<String, dynamic> fullTodoProgressCommand(
  WorkspaceFullRecord record,
  num progress, {
  DateTime? now,
}) => fullTodoEditCommand(
  record,
  completion: fullTodoProgressCompletion(record.body, progress, now: now),
);

Map<String, dynamic> fullTodoToggleCommand(
  WorkspaceFullRecord record, {
  DateTime? now,
}) => fullTodoEditCommand(
  record,
  completion: fullTodoToggleCompletion(record.body, now: now),
);

Map<String, dynamic> fullTodoEditCommand(
  WorkspaceFullRecord record, {
  Map<String, dynamic> fields = const {},
  Map<String, dynamic>? completion,
  Map<String, dynamic>? date,
  Map<String, dynamic>? project,
}) {
  if (record.kind != 'todo' || !record.writable) throw StateError('此待办只读');
  if (fields.keys.any(
    (key) => !['title', 'category', 'isExtra'].contains(key),
  )) {
    throw const FormatException('不能修改此字段');
  }
  final body = Map<String, dynamic>.from(jsonDecode(record.rawJson) as Map);
  for (final entry in fields.entries) {
    if (workspaceJsonEqual(body[entry.key], entry.value)) continue;
    if (!record.canEdit(entry.key)) throw StateError('此字段只读');
    final value = entry.value;
    if (entry.key == 'title' &&
        (value is! String ||
            fullTodoTrim(value).isEmpty ||
            fullTodoTrim(value).length > 300)) {
      throw const FormatException('待办内容需为1至300字');
    }
    if (entry.key == 'category' &&
        !['self_media', 'ai', 'life', 'other_work'].contains(value)) {
      throw const FormatException('分类无效');
    }
    if (entry.key == 'isExtra' && value is! bool) {
      throw const FormatException('额外安排无效');
    }
    body[entry.key] = entry.key == 'title'
        ? fullTodoTrim(value as String)
        : value;
  }
  final groups = {'completion': completion, 'date': date, 'project': project};
  final keys = {
    'completion': fullTodoCompletionFields,
    'date': fullTodoDateFields,
    'project': fullTodoProjectFields,
  };
  for (final entry in groups.entries) {
    final group = entry.value;
    if (group == null) continue;
    final names = keys[entry.key]!;
    if (group.length != names.length || !names.every(group.containsKey)) {
      throw const FormatException('请完整设置此项');
    }
    if (names.every((key) => workspaceJsonEqual(body[key], group[key]))) {
      continue;
    }
    if (entry.key == 'completion') {
      _progress(group['progress']);
      if (group['progressBeforeComplete'] != null) {
        _progress(group['progressBeforeComplete']);
      }
    }
    workspaceDomainV2Validate(entry.key, group);
    if (!fullTodoCanEdit(record, names)) throw StateError('此项只读');
    for (final key in names) {
      if (record.remoteRevision == 0 && key == 'stageLinkSource') continue;
      body[key] = group[key];
    }
  }
  if (record.remoteRevision == 0) workspaceDomainV2Validate('todoCreate', body);
  return {'id': record.id, 'body': body};
}

Map<String, dynamic> fullTodoCreateBody({
  required String title,
  required String category,
  bool isExtra = false,
  String? plannedDate,
  String? segment,
  Map<String, dynamic>? dateRange,
  String? projectId,
  String? stageKey,
  Map<String, dynamic>? completion,
}) {
  final body = {
    'title': fullTodoTrim(title),
    'category': category,
    'isExtra': isExtra,
    'plannedDate': plannedDate,
    'segment': segment,
    'dateRange': dateRange,
    'projectId': projectId,
    'stageKey': stageKey,
    ...?completion,
  };
  if (completion == null) {
    body.addAll({
      'status': 'open',
      'trackingMode': 'checklist',
      'progress': 0,
      'progressBeforeComplete': null,
      'completedAt': null,
    });
  }
  workspaceDomainV2Validate('todoCreate', body);
  return body;
}
