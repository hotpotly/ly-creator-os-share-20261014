import 'dart:convert';

import 'workspace_domain_v2.dart';
import 'workspace_models.dart';

Object? freezeWorkspaceValue(Object? value) {
  if (value is Map) {
    return Map<String, dynamic>.unmodifiable({
      for (final entry in value.entries)
        entry.key as String: freezeWorkspaceValue(entry.value),
    });
  }
  if (value is List) {
    return List<dynamic>.unmodifiable(value.map(freezeWorkspaceValue));
  }
  return value;
}

Map<String, dynamic> freezeWorkspaceMap(Map<String, dynamic> value) =>
    freezeWorkspaceValue(value) as Map<String, dynamic>;

class WorkspaceFullRecord {
  WorkspaceFullRecord(Map<String, dynamic> value)
    : state = freezeWorkspaceMap(value),
      inspection = freezeWorkspaceMap(
        workspaceDomainV2Inspect(
          value['kind'] as String,
          value['id'] as String,
          value['json'] as String,
        ),
      );

  final Map<String, dynamic> state;
  final Map<String, dynamic> inspection;

  String get kind => state['kind'] as String;
  String get id => state['id'] as String;
  String get rawJson => state['json'] as String;
  int get revision => state['localRevision'] as int;
  int get remoteRevision => state['remoteRevision'] as int;
  bool get deleted => state['deleted'] == true;
  bool get supported => inspection['supported'] == true || _validLocalCreate;
  Map<String, dynamic> get body =>
      inspection['body'] as Map<String, dynamic>? ?? const {};
  Map<String, dynamic> get metadata =>
      state['metadata'] as Map<String, dynamic>;
  bool get writable => !deleted && state['writable'] == true && supported;
  bool get _validLocalCreate {
    if (!['todo', 'work_log'].contains(kind) ||
        remoteRevision != 0 ||
        state['pending'] == null && state['inflight'] == null) {
      return false;
    }
    try {
      workspaceDomainV2Validate(
        kind == 'todo' ? 'todoCreate' : 'workLogCreate',
        body,
      );
      return true;
    } on FormatException {
      return false;
    }
  }

  bool canEdit(String field) =>
      writable && (metadata['editableFields'] as List? ?? []).contains(field);
  bool get deletable => writable && metadata['deletable'] == true;
  bool get hasConflict => state['conflict'] != null;
  String? get blockedCode =>
      ((state['blocked'] as Map?)?['receipt'] as Map?)?['code'] as String?;
  String get title => body['title'] is String ? body['title'] as String : id;
  bool get completed => body['status'] == 'completed';
  num? get progress => body['progress'] is num ? body['progress'] as num : null;

  Map<String, dynamic> patched(Map<String, dynamic> changes) => {
    ...jsonDecode(rawJson) as Map<String, dynamic>,
    ...changes,
  };

  bool appearsOn(String day, String today) {
    if (kind != 'todo' || deleted || body['dismissedAt'] != null) return false;
    final range = body['dateRange'];
    if (range is Map &&
        range['startDate'] is String &&
        range['endDate'] is String) {
      return day.compareTo(range['startDate'] as String) >= 0 &&
          day.compareTo(range['endDate'] as String) <= 0;
    }
    final planned = body['plannedDate'];
    if (planned is String) return planned == day;
    final completedAt = body['completedAt'];
    return completedAt is String
        ? workspaceCompletedDay(completedAt) == day
        : day == today;
  }

  num? get workMinutes {
    if (kind != 'work_log' || deleted || !supported) return null;
    if (body['totalMinutes'] is num) return body['totalMinutes'] as num;
    if (![
      'selfMediaMinutes',
      'aiMinutes',
      'otherWorkMinutes',
    ].every((key) => body[key] is num)) {
      return null;
    }
    return (body['selfMediaMinutes'] as num) +
        (body['aiMinutes'] as num) +
        (body['otherWorkMinutes'] as num);
  }
}
