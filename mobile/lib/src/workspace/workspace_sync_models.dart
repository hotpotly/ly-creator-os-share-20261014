import 'dart:convert';

import 'workspace_models.dart';

const workspaceSyncByteLimit = 256 * 1024;
const workspaceSyncBatchLimit = 100;
const workspaceSyncKinds = {'todo', 'work_log'};
const workspaceTodoFields = {'title', 'category', 'plannedDate', 'completedAt'};

bool workspaceJsonEqual(Object? a, Object? b) {
  if (a is Map && b is Map) {
    return a.length == b.length &&
        a.keys.every(
          (key) => b.containsKey(key) && workspaceJsonEqual(a[key], b[key]),
        );
  }
  if (a is List && b is List) {
    return a.length == b.length &&
        List.generate(
          a.length,
          (i) => i,
        ).every((i) => workspaceJsonEqual(a[i], b[i]));
  }
  return a == b;
}

bool workspaceSyncUuid(Object? value) =>
    value is String &&
    RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    ).hasMatch(value);

bool workspaceSyncInteger(Object? value, {int minimum = 0}) =>
    value is int && value >= minimum && value <= 9007199254740991;

Map<String, dynamic> workspaceSyncMap(Object? value) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw const FormatException('同步对象格式无效');
  }
  return Map<String, dynamic>.from(value);
}

void workspaceSyncFields(Map<String, dynamic> value, Set<String> fields) {
  if (value.length != fields.length || !fields.every(value.containsKey)) {
    throw const FormatException('同步字段无效');
  }
}

Map<String, dynamic> workspaceSnapshot(WorkspaceRecord record) => {
  'deleted': record.deleted,
  'data': record.data,
};

WorkspaceRecord workspaceRemoteRecord(
  Map<String, dynamic> remote, {
  int localRevision = 0,
}) {
  workspaceSyncFields(remote, {
    'kind',
    'id',
    'revision',
    'sequence',
    'deleted',
    'data',
    'metadata',
  });
  if (!workspaceSyncKinds.contains(remote['kind']) ||
      !workspaceSyncInteger(remote['revision'], minimum: 1) ||
      !workspaceSyncInteger(remote['sequence'], minimum: 1)) {
    throw const FormatException('远端版本无效');
  }
  final metadata = workspaceSyncMap(remote['metadata']);
  final record = WorkspaceRecord.fromJson({
    'kind': remote['kind'],
    'id': remote['id'],
    'revision': localRevision,
    'deleted': remote['deleted'],
    'data': workspaceSyncMap(remote['data']),
    'metadata': metadata,
  });
  if (record.kind == 'todo') {
    final todo = workspaceSyncMap(metadata['todo']);
    final fields = metadata['editableFields'];
    if (todo['id'] != record.id ||
        todo['source'] is! String ||
        fields is! List ||
        fields.any((field) => !workspaceTodoFields.contains(field)) ||
        fields.toSet().length != fields.length ||
        metadata['deletable'] is! bool) {
      throw const FormatException('待办完整信息无效');
    }
  }
  return record;
}

Map<String, dynamic> workspaceValidateOperation(Object? value) {
  final operation = workspaceSyncMap(value);
  workspaceSyncFields(operation, {
    'operationId',
    'kind',
    'id',
    'localRevision',
    'baseRevision',
    'base',
    'next',
  });
  if (!workspaceSyncUuid(operation['operationId']) ||
      !workspaceSyncKinds.contains(operation['kind']) ||
      !workspaceSyncInteger(operation['localRevision'], minimum: 1) ||
      !workspaceSyncInteger(operation['baseRevision']) ||
      ((operation['baseRevision'] == 0) != (operation['base'] == null))) {
    throw const FormatException('待同步操作无效');
  }
  for (final item in [operation['base'], operation['next']]) {
    if (item == null) continue;
    final snapshot = workspaceSyncMap(item);
    workspaceSyncFields(snapshot, {'deleted', 'data'});
    WorkspaceRecord.fromJson({
      'kind': operation['kind'],
      'id': operation['id'],
      'revision': operation['localRevision'],
      'deleted': snapshot['deleted'],
      'data': snapshot['data'],
    });
  }
  if (operation['next'] == null) throw const FormatException('缺少同步内容');
  final next = workspaceSyncMap(operation['next']);
  final data = workspaceSyncMap(next['data']);
  final base = operation['base'] == null
      ? null
      : workspaceSyncMap(operation['base']);
  final baseData = base == null ? null : workspaceSyncMap(base['data']);
  if (operation['kind'] == 'work_log' &&
      next['deleted'] == false &&
      data['minutes'] != baseData?['minutes'] &&
      data['minutes'] != null &&
      (data['minutes'] as int) > 1440) {
    throw const FormatException('每日投入须在0至1440分钟内');
  }
  return operation;
}

Map<String, dynamic> workspaceValidateRequest(Map<String, dynamic> request) {
  workspaceSyncFields(request, {
    'protocolVersion',
    'workspaceId',
    'deviceId',
    'cursor',
    'through',
    'operations',
  });
  if (request['protocolVersion'] != 1 ||
      !workspaceSyncUuid(request['workspaceId']) ||
      !workspaceSyncUuid(request['deviceId']) ||
      !workspaceSyncInteger(request['cursor']) ||
      (request['through'] != null &&
          (!workspaceSyncInteger(request['through']) ||
              (request['through'] as int) < (request['cursor'] as int))) ||
      request['operations'] is! List ||
      (request['operations'] as List).length > workspaceSyncBatchLimit ||
      utf8.encode(jsonEncode(request)).length > workspaceSyncByteLimit) {
    throw const FormatException('同步请求无效');
  }
  final ids = <String>{};
  final entities = <String>{};
  for (final value in request['operations'] as List) {
    final operation = workspaceValidateOperation(value);
    if (!ids.add(operation['operationId'] as String) ||
        !entities.add('${operation['kind']}:${operation['id']}')) {
      throw const FormatException('同步操作重复');
    }
  }
  return request;
}

void workspaceValidateResponse(
  Map<String, dynamic> request,
  Map<String, dynamic> response,
) {
  workspaceValidateRequest(request);
  workspaceSyncFields(response, {
    'protocolVersion',
    'workspaceId',
    'deviceId',
    'receipts',
    'changes',
    'cursor',
    'through',
    'hasMore',
  });
  if (response['protocolVersion'] != 1 ||
      response['workspaceId'] != request['workspaceId'] ||
      response['deviceId'] != request['deviceId'] ||
      !workspaceSyncInteger(response['cursor']) ||
      !workspaceSyncInteger(response['through']) ||
      response['hasMore'] is! bool ||
      response['receipts'] is! List ||
      response['changes'] is! List ||
      (response['changes'] as List).length > workspaceSyncBatchLimit ||
      utf8.encode(jsonEncode(response)).length > workspaceSyncByteLimit) {
    throw const FormatException('同步响应身份或格式无效');
  }
  final cursor = response['cursor'] as int;
  final through = response['through'] as int;
  final start = request['cursor'] as int;
  final hasMore = response['hasMore'] as bool;
  if (cursor < start ||
      through < cursor ||
      (request['through'] != null && request['through'] != through) ||
      (hasMore
          ? cursor >= through ||
                (cursor == start && (response['receipts'] as List).isEmpty)
          : cursor != through)) {
    throw const FormatException('同步游标回退或分页水位无效');
  }
  final expected = {
    for (final value in request['operations'] as List)
      (value as Map)['operationId']: value,
  };
  final seen = <String>{};
  for (final value in response['receipts'] as List) {
    final receipt = workspaceSyncMap(value);
    workspaceSyncFields(receipt, {
      'operationId',
      'localRevision',
      'status',
      'record',
    });
    final operation = expected[receipt['operationId']];
    if (operation == null ||
        !seen.add(receipt['operationId'] as String) ||
        receipt['localRevision'] != operation['localRevision'] ||
        !{'accepted', 'conflict'}.contains(receipt['status'])) {
      throw const FormatException('同步回执不匹配');
    }
    final remote = workspaceSyncMap(receipt['record']);
    workspaceRemoteRecord(remote);
    if (remote['kind'] != operation['kind'] ||
        remote['id'] != operation['id'] ||
        (receipt['status'] == 'accepted' &&
            (remote['revision'] as int) < (operation['baseRevision'] as int))) {
      throw const FormatException('同步回执版本或对象不匹配');
    }
  }
  if (seen.length != expected.length) throw const FormatException('同步回执不完整');
  var previous = start;
  for (final value in response['changes'] as List) {
    final remote = workspaceSyncMap(value);
    workspaceRemoteRecord(remote);
    final sequence = remote['sequence'] as int;
    if (sequence <= previous || sequence > cursor || sequence > through) {
      throw const FormatException('同步变更顺序无效');
    }
    previous = sequence;
  }
  if (previous != cursor) throw const FormatException('同步分页未取得进展');
}

void workspaceValidateLocalChange(
  WorkspaceRecord? current,
  WorkspaceRecord next, {
  Map<String, dynamic>? permissions,
}) {
  if (next.kind == 'todo') {
    final title = next.data['title'] as String;
    if ((current == null || title != current.data['title']) &&
        title.length > 300) {
      throw const FormatException('待办内容不能超过300字');
    }
    final metadata =
        permissions ?? current?.metadata ?? const <String, dynamic>{};
    if (metadata.isNotEmpty) {
      final todo = workspaceSyncMap(metadata['todo']);
      final editable = metadata['editableFields'];
      final readOnly = todo['source'] != 'manual' || todo['dateRange'] != null;
      if (readOnly || editable is! List || metadata['deletable'] is! bool) {
        throw const FormatException('此待办请在电脑端编辑');
      }
      if (next.deleted != (current?.deleted ?? false) &&
          metadata['deletable'] != true) {
        throw const FormatException('此待办不能在手机端删除');
      }
      for (final key in next.data.keys) {
        if (!workspaceJsonEqual(next.data[key], current?.data[key]) &&
            !editable.contains(key)) {
          throw const FormatException('此待办字段请在电脑端编辑');
        }
      }
    }
  }
  if (next.kind == 'work_log') {
    final minutes = next.data['minutes'];
    if (!next.deleted &&
        (current == null || current.data['minutes'] != minutes) &&
        minutes != null &&
        (minutes as int) > 1440) {
      throw const FormatException('每日投入须在0至1440分钟内');
    }
  }
}

bool workspaceCanCopyDeletedTodo(
  WorkspaceRecord local,
  WorkspaceRecord remote,
) {
  if (local.kind != 'todo' ||
      remote.kind != 'todo' ||
      local.deleted ||
      !remote.deleted) {
    return false;
  }
  for (final record in [local, remote]) {
    if (record.metadata.isEmpty) continue;
    final todo = record.metadata['todo'];
    if (todo is! Map ||
        todo['source'] != 'manual' ||
        todo['dateRange'] != null ||
        todo['projectId'] != null ||
        todo['stageKey'] != null ||
        todo['stageLinkSource'] != null ||
        todo['segment'] != null ||
        todo['isExtra'] == true ||
        todo['trackingMode'] == 'progress' ||
        (todo['progress'] != null &&
            todo['progress'] != 0 &&
            todo['progress'] != 100) ||
        (todo['progressBeforeComplete'] != null &&
            todo['progressBeforeComplete'] != 0 &&
            todo['progressBeforeComplete'] != 100) ||
        todo['sourceScheduleId'] != null ||
        todo['sourcePlannedDate'] != null ||
        todo['sourceSegment'] != null ||
        todo['scheduleSyncEnabled'] == true) {
      return false;
    }
  }
  return (local.data['title'] as String).length <= 300;
}
