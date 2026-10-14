import 'dart:collection';
import 'dart:convert';

import 'workspace_v2_contract.dart';

const workspaceDomainV2Kinds = [
  'todo',
  'work_log',
  'project_catalog',
  'todo_preferences',
];
const workspaceDomainV2StageKeys = [
  'materials',
  'outline',
  'script',
  'production',
  'shooting',
  'editing',
  'postproduction',
  'publishing',
  'versions',
];
const workspaceDomainV2TodoUnits = {
  'title': ['title'],
  'category': ['category'],
  'isExtra': ['isExtra'],
  'C': [
    'status',
    'trackingMode',
    'progress',
    'progressBeforeComplete',
    'completedAt',
  ],
  'D': ['plannedDate', 'segment', 'dateRange'],
  'P': ['projectId', 'stageKey', 'stageLinkSource'],
};
const _categories = ['self_media', 'ai', 'life', 'other_work'];
const _segments = ['morning', 'afternoon', 'evening'];
const _tracking = ['checklist', 'progress'];
const _todoCreateKeys = {
  'title',
  'category',
  'isExtra',
  'plannedDate',
  'segment',
  'dateRange',
  'projectId',
  'stageKey',
  'status',
  'trackingMode',
  'progress',
  'progressBeforeComplete',
  'completedAt',
};
const _todoReadKeys = {
  'id',
  'title',
  'category',
  'plannedDate',
  'segment',
  'projectId',
  'status',
  'trackingMode',
  'progress',
  'progressBeforeComplete',
  'completedAt',
  'source',
  'sourceScheduleId',
  'sourcePlannedDate',
  'sourceSegment',
  'scheduleSyncEnabled',
  'dismissedAt',
  'createdAt',
  'updatedAt',
};

void _require(bool valid) {
  if (!valid) throw const FormatException('完整工作区领域格式无效');
}

bool _text(Object? value, {int minimum = 0, int? maximum}) =>
    value is String &&
    value.length >= minimum &&
    (maximum == null || value.length <= maximum);
bool _number(Object? value) => value is num && value.isFinite;
bool _integer(Object? value, int minimum, int maximum) =>
    workspaceV2SafeInteger(value, minimum: minimum, maximum: maximum);
bool _nullable(Object? value, bool Function(Object?) check) =>
    value == null || check(value);
String _jsTrim(String value) => value.replaceAll(
  RegExp(
    r'^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
  ),
  '',
);
bool _title(Object? value) =>
    value is String &&
    _jsTrim(value).isNotEmpty &&
    _jsTrim(value).length <= 300;
bool _projectId(Object? value) => _text(value, minimum: 1, maximum: 128);
bool _time(Object? value) {
  if (value is! String ||
      !RegExp(
        r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$',
      ).hasMatch(value)) {
    return false;
  }
  final parsed = DateTime.tryParse(value);
  return parsed != null &&
      parsed.toUtc().toIso8601String().substring(0, 19) ==
          value.substring(0, 19);
}

void _range(Object? raw, {required bool write}) {
  if (raw == null) return;
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {'startDate', 'endDate', 'name'});
  _require(
    workspaceV2Day(value['startDate']) &&
        workspaceV2Day(value['endDate']) &&
        _text(value['name']) &&
        (value['startDate'] as String).compareTo(value['endDate'] as String) <=
            0 &&
        (!write || _jsTrim(value['name'] as String).length <= 60),
  );
}

Map<String, dynamic> _pick(Map<String, dynamic> value, Iterable<String> keys) =>
    {
      for (final key in keys)
        if (value.containsKey(key)) key: value[key],
    };

Map<String, dynamic> workspaceDomainV2Validate(String schema, Object? raw) {
  final value = workspaceV2Map(raw);
  switch (schema) {
    case 'completion':
      workspaceV2Fields(value, workspaceDomainV2TodoUnits['C']!.toSet());
      _require(
        ['open', 'completed'].contains(value['status']) &&
            _tracking.contains(value['trackingMode']) &&
            _integer(value['progress'], 0, 100) &&
            _nullable(
              value['progressBeforeComplete'],
              (n) => _integer(n, 0, 99),
            ) &&
            _nullable(value['completedAt'], _time),
      );
      _require(
        value['status'] == 'completed'
            ? value['progress'] == 100 && value['completedAt'] != null
            : value['completedAt'] == null &&
                  (value['trackingMode'] == 'checklist'
                      ? value['progress'] == 0
                      : (value['progress'] as num) <= 99),
      );
      break;
    case 'date':
      workspaceV2Fields(value, workspaceDomainV2TodoUnits['D']!.toSet());
      _require(
        _nullable(value['plannedDate'], workspaceV2Day) &&
            _nullable(value['segment'], _segments.contains),
      );
      _range(value['dateRange'], write: true);
      _require(
        value['dateRange'] == null ||
            value['plannedDate'] == null && value['segment'] == null,
      );
      break;
    case 'project':
      workspaceV2Fields(value, workspaceDomainV2TodoUnits['P']!.toSet());
      _require(
        _nullable(value['projectId'], _projectId) &&
            _nullable(value['stageKey'], workspaceDomainV2StageKeys.contains) &&
            _nullable(value['stageLinkSource'], (v) => v == 'manual'),
      );
      _require(
        value['stageKey'] == null
            ? value['stageLinkSource'] == null
            : value['projectId'] != null &&
                  value['stageLinkSource'] == 'manual',
      );
      break;
    case 'todoCreate':
      workspaceV2Fields(value, _todoCreateKeys);
      _require(
        _title(value['title']) &&
            _categories.contains(value['category']) &&
            value['isExtra'] is bool,
      );
      workspaceDomainV2Validate(
        'completion',
        _pick(value, workspaceDomainV2TodoUnits['C']!),
      );
      workspaceDomainV2Validate(
        'date',
        _pick(value, workspaceDomainV2TodoUnits['D']!),
      );
      workspaceDomainV2Validate('project', {
        'projectId': value['projectId'],
        'stageKey': value['stageKey'],
        'stageLinkSource': value['stageKey'] != null ? 'manual' : null,
      });
      break;
    case 'todoRead':
      workspaceV2Fields(
        value,
        _todoReadKeys,
        optional: {'isExtra', 'dateRange', 'stageKey', 'stageLinkSource'},
      );
      _require(
        workspaceV2Uuid(value['id']) &&
            _text(value['title']) &&
            _categories.contains(value['category']) &&
            (!value.containsKey('isExtra') || value['isExtra'] is bool) &&
            _nullable(value['plannedDate'], workspaceV2Day) &&
            _nullable(value['segment'], _segments.contains),
      );
      if (value.containsKey('dateRange')) {
        _range(value['dateRange'], write: false);
      }
      _require(
        _nullable(value['projectId'], _text) &&
            _nullable(
              value['stageKey'],
              (v) => [...workspaceDomainV2StageKeys, 'feedback'].contains(v),
            ) &&
            _nullable(value['stageLinkSource'], (v) => v == 'manual'),
      );
      _require(
        ['open', 'completed', 'dismissed'].contains(value['status']) &&
            _tracking.contains(value['trackingMode']) &&
            _number(value['progress']) &&
            _nullable(value['progressBeforeComplete'], _number) &&
            _nullable(value['completedAt'], _text),
      );
      _require(
        ['manual', 'schedule'].contains(value['source']) &&
            _nullable(value['sourceScheduleId'], _text) &&
            _nullable(value['sourcePlannedDate'], workspaceV2Day) &&
            _nullable(value['sourceSegment'], _segments.contains) &&
            value['scheduleSyncEnabled'] is bool &&
            _nullable(value['dismissedAt'], _text) &&
            _text(value['createdAt']) &&
            _text(value['updatedAt']),
      );
      break;
    case 'workLogCreate':
      workspaceV2Fields(value, {'day', 'totalMinutes'});
      _require(
        workspaceV2Day(value['day']) &&
            _nullable(value['totalMinutes'], (v) => _integer(v, 0, 1440)),
      );
      break;
    case 'workLogRead':
      workspaceV2Fields(
        value,
        {
          'day',
          'selfMediaMinutes',
          'aiMinutes',
          'otherWorkMinutes',
          'updatedAt',
        },
        optional: {'totalMinutes'},
      );
      _require(
        workspaceV2Day(value['day']) &&
            _nullable(value['totalMinutes'], _number) &&
            [
              'selfMediaMinutes',
              'aiMinutes',
              'otherWorkMinutes',
            ].every((key) => _number(value[key])) &&
            _text(value['updatedAt']),
      );
      break;
    case 'projectCatalog':
      workspaceV2Fields(value, {
        'id',
        'title',
        'status',
        'topicStageRole',
        'trashedAt',
        'ledgerOnly',
        'stages',
      });
      _require(
        _projectId(value['id']) &&
            _text(value['title']) &&
            [
              'candidate',
              'preparing',
              'producing',
              'paused',
              'published',
              'archived',
            ].contains(value['status']) &&
            _nullable(
              value['topicStageRole'],
              (v) => [
                'standard',
                'project_created',
                'completed',
                'archived',
                'shelved',
              ].contains(v),
            ) &&
            _nullable(value['trashedAt'], _text) &&
            value['ledgerOnly'] is bool &&
            value['stages'] is List,
      );
      final keys = <String>{};
      for (final rawStage in value['stages'] as List) {
        final stage = workspaceV2Map(rawStage);
        workspaceV2Fields(stage, {
          'key',
          'enabled',
          'completedAt',
          'status',
          'revision',
        });
        _require(
          workspaceDomainV2StageKeys.contains(stage['key']) &&
              keys.add(stage['key'] as String) &&
              stage['enabled'] is bool &&
              _nullable(stage['completedAt'], _text) &&
              [
                'not_started',
                'in_progress',
                'completed',
                'skipped',
              ].contains(stage['status']) &&
              workspaceV2Hash(stage['revision']),
        );
      }
      break;
    case 'todoPreferences':
      workspaceV2Fields(value, {
        'todoCategoryLabels',
        'todoCategoryColors',
        'todoCategoryWeights',
        'companionTodoView',
        'companionTodoOrder',
      });
      for (final field in [
        'todoCategoryLabels',
        'todoCategoryColors',
        'todoCategoryWeights',
      ]) {
        final map = workspaceV2Map(value[field]);
        workspaceV2Fields(map, _categories.toSet());
        _require(
          map.values.every(
            (item) => field == 'todoCategoryLabels'
                ? _text(item)
                : field == 'todoCategoryWeights'
                ? _number(item)
                : [for (var i = 1; i <= 12; i++) 'project-$i'].contains(item),
          ),
        );
      }
      _require(
        ['all', 'time', 'category'].contains(value['companionTodoView']) &&
            value['companionTodoOrder'] is List &&
            (value['companionTodoOrder'] as List).every(workspaceV2Uuid),
      );
      break;
    default:
      throw FormatException('未知领域合同：$schema');
  }
  return value;
}

String _inspectNumbers(Object? body) {
  final pending = <Object?>[body], seen = HashSet<Object>.identity();
  while (pending.isNotEmpty) {
    final value = pending.removeLast();
    if (value is num) {
      if (!value.isFinite || value.abs() > 9007199254740991) {
        return 'unsafe_number';
      }
    } else if (value is List || value is Map) {
      if (value is Map && value.keys.any((key) => key is! String)) {
        return 'unsupported_shape';
      }
      if (!seen.add(value!)) continue;
      pending.addAll(value is List ? value : (value as Map).values);
    } else if (value != null && value is! String && value is! bool) {
      return 'unsupported_shape';
    }
  }
  return 'valid';
}

bool _valid(String schema, Object? body) {
  try {
    workspaceDomainV2Validate(schema, body);
    return true;
  } on FormatException {
    return false;
  }
}

Map<String, dynamic> _inspectBody(
  String kind,
  String id,
  Map<String, dynamic> body,
) {
  Map<String, dynamic> failure(String reason) => {
    'supported': false,
    'writable': false,
    'reason': reason,
  };
  final numbers = _inspectNumbers(body);
  if (numbers != 'valid') return failure(numbers);
  const schemas = {
    'todo': 'todoRead',
    'work_log': 'workLogRead',
    'project_catalog': 'projectCatalog',
    'todo_preferences': 'todoPreferences',
  };
  if (!schemas.containsKey(kind) || !_valid(schemas[kind]!, body)) {
    return failure('unsupported_shape');
  }
  if (kind == 'todo_preferences' && id != 'workspace' ||
      (kind == 'work_log'
          ? body['day'] != id
          : kind != 'todo_preferences' && body['id'] != id)) {
    return failure('identity_mismatch');
  }
  final writable =
      kind == 'work_log' || kind == 'todo' && body['source'] == 'manual';
  return {
    'supported': true,
    'writable': writable,
    'reason': writable ? null : 'record_read_only',
  };
}

Map<String, dynamic> workspaceDomainV2Inspect(
  String kind,
  String id,
  String rawJson,
) {
  Map<String, dynamic> failure(String reason) => {
    'rawJson': rawJson,
    'body': null,
    'supported': false,
    'writable': false,
    'reason': reason,
  };
  if (utf8.encode(rawJson).length > workspaceV2JsonBytes) {
    return failure('too_large');
  }
  Map<String, dynamic> body;
  try {
    body = workspaceV2Map(jsonDecode(rawJson));
  } on FormatException {
    return failure('invalid_json');
  }
  return {'rawJson': rawJson, 'body': body, ..._inspectBody(kind, id, body)};
}

bool workspaceDomainV2Equal(Object? left, Object? right) {
  final pending = <List<Object?>>[
        [left, right],
      ],
      seenLeft = HashSet<Object>.identity(),
      seenRight = HashSet<Object>.identity();
  while (pending.isNotEmpty) {
    final pair = pending.removeLast(), a = pair[0], b = pair[1];
    bool supported(Object? value) =>
        value == null ||
        value is num ||
        value is String ||
        value is bool ||
        value is Map ||
        value is List;
    if (!supported(a) || !supported(b)) return false;
    if (a is num && b is num) {
      if (!a.isFinite || !b.isFinite || a != b) return false;
    } else if (a == null ||
        b == null ||
        (a is! Map && a is! List) ||
        (b is! Map && b is! List)) {
      if (a != b) return false;
    } else {
      if (!seenLeft.add(a) || !seenRight.add(b) || (a is List) != (b is List)) {
        return false;
      }
      if (a is List && b is List) {
        if (a.length != b.length) return false;
        for (var i = 0; i < a.length; i++) {
          pending.add([a[i], b[i]]);
        }
      } else {
        final aa = a as Map, bb = b as Map;
        if (aa.keys.any((k) => k is! String) ||
            bb.keys.any((k) => k is! String) ||
            aa.length != bb.length ||
            aa.keys.any((key) => !bb.containsKey(key))) {
          return false;
        }
        for (final key in aa.keys) {
          pending.add([aa[key], bb[key]]);
        }
      }
    }
  }
  return true;
}

void workspaceDomainV2AssertBaseRaw(
  Map<String, dynamic> actual,
  Map<String, dynamic> historical,
) {
  if (actual['deleted'] != historical['deleted'] ||
      actual['json'] != historical['json']) {
    throw const FormatException('同步基线原文不匹配');
  }
}

Map<String, dynamic> _rejected([String reason = 'invalid_change']) => {
  'status': 'rejected',
  'reason': reason,
};
Map<String, dynamic> _conflict(String reason, List<String> units) => {
  'status': 'conflict',
  'reason': reason,
  'conflictingUnits': units,
};
Map<String, dynamic> _result(
  String status,
  Map<String, dynamic> body,
  bool deleted,
  List<String> units,
) => {
  'status': status,
  'body': jsonDecode(jsonEncode(body)),
  'deleted': deleted,
  'changedUnits': units,
};
bool _validChangedTodoUnit(String unit, Map<String, dynamic> body) {
  if (unit == 'title') return _title(body['title']);
  if (unit == 'category') return _categories.contains(body['category']);
  if (unit == 'isExtra') return body['isExtra'] is bool;
  return _valid(
    {'C': 'completion', 'D': 'date', 'P': 'project'}[unit]!,
    _pick(body, workspaceDomainV2TodoUnits[unit]!),
  );
}

Map<String, dynamic> _resolveTodo(Map<String, dynamic> input) {
  final base = input['base'] == null ? null : workspaceV2Map(input['base']),
      next = workspaceV2Map(input['next']),
      current = input['current'] == null
          ? null
          : workspaceV2Map(input['current']);
  final id = input['id'] as String, nextBody = workspaceV2Map(next['body']);
  if (!workspaceV2Uuid(id)) return _rejected();
  if (base == null) {
    if (current != null) return _conflict('identity_collision', ['create']);
    if (next['deleted'] == true || !_valid('todoCreate', nextBody)) {
      return _rejected();
    }
    return _result('apply', nextBody, false, ['create']);
  }
  final baseBody = workspaceV2Map(base['body']);
  if (current == null ||
      _inspectBody('todo', id, baseBody)['writable'] != true ||
      _inspectBody('todo', id, workspaceV2Map(current['body']))['writable'] !=
          true) {
    return _rejected('record_read_only');
  }
  final currentBody = workspaceV2Map(current['body']);
  if (next['deleted'] == true) {
    if (!workspaceDomainV2Equal(baseBody, nextBody)) return _rejected();
    if (current['deleted'] == true) {
      return _result('noop', currentBody, true, []);
    }
    if (input['currentRevision'] != input['baseRevision']) {
      return _conflict('concurrent_change', ['deleted']);
    }
    return _result('apply', currentBody, true, ['deleted']);
  }
  if (base['deleted'] == true ||
      current['deleted'] == true ||
      currentBody['status'] == 'dismissed') {
    return _conflict('deleted_record', ['deleted']);
  }
  if (_inspectBody('todo', id, nextBody)['writable'] != true) {
    return _rejected();
  }
  final writableKeys = workspaceDomainV2TodoUnits.values
      .expand((fields) => fields)
      .toSet();
  if (!workspaceDomainV2Equal(
    _pick(baseBody, baseBody.keys.where((key) => !writableKeys.contains(key))),
    _pick(nextBody, nextBody.keys.where((key) => !writableKeys.contains(key))),
  )) {
    return _rejected();
  }
  final changed = <String>[],
      conflicting = <String>[],
      merged = workspaceV2Map(jsonDecode(jsonEncode(currentBody)));
  for (final entry in workspaceDomainV2TodoUnits.entries) {
    final baseUnit = _pick(baseBody, entry.value),
        nextUnit = _pick(nextBody, entry.value),
        currentUnit = _pick(currentBody, entry.value);
    if (workspaceDomainV2Equal(baseUnit, nextUnit)) continue;
    if (!_validChangedTodoUnit(entry.key, nextBody)) return _rejected();
    if (!workspaceDomainV2Equal(baseUnit, currentUnit) &&
        !workspaceDomainV2Equal(currentUnit, nextUnit)) {
      conflicting.add(entry.key);
      continue;
    }
    if (workspaceDomainV2Equal(currentUnit, nextUnit)) continue;
    for (final key in entry.value) {
      if (nextBody.containsKey(key)) {
        merged[key] = nextBody[key];
      } else {
        merged.remove(key);
      }
    }
    changed.add(entry.key);
  }
  if (conflicting.isNotEmpty) {
    return _conflict('concurrent_change', conflicting);
  }
  return _result(changed.isEmpty ? 'noop' : 'apply', merged, false, changed);
}

Map<String, dynamic> _resolveWorkLog(Map<String, dynamic> input) {
  final base = input['base'] == null ? null : workspaceV2Map(input['base']),
      next = workspaceV2Map(input['next']),
      current = input['current'] == null
          ? null
          : workspaceV2Map(input['current']);
  final id = input['id'] as String, nextBody = workspaceV2Map(next['body']);
  if (!workspaceV2Day(id)) return _rejected();
  if (base == null) {
    if (current != null) return _conflict('identity_collision', ['create']);
    if (!_valid('workLogCreate', nextBody) ||
        nextBody['day'] != id ||
        next['deleted'] != (nextBody['totalMinutes'] == null)) {
      return _rejected();
    }
    return _result('apply', nextBody, next['deleted'] as bool, ['create']);
  }
  final baseBody = workspaceV2Map(base['body']);
  if (current == null ||
      _inspectBody('work_log', id, baseBody)['writable'] != true ||
      _inspectBody(
            'work_log',
            id,
            workspaceV2Map(current['body']),
          )['writable'] !=
          true) {
    return _rejected('record_read_only');
  }
  final currentBody = workspaceV2Map(current['body']);
  if (_inspectBody('work_log', id, nextBody)['writable'] != true) {
    return _rejected();
  }
  if (!workspaceDomainV2Equal(
    _pick(baseBody, baseBody.keys.where((key) => key != 'totalMinutes')),
    _pick(nextBody, nextBody.keys.where((key) => key != 'totalMinutes')),
  )) {
    return _rejected();
  }
  if (next['deleted'] == true && !workspaceDomainV2Equal(baseBody, nextBody)) {
    return _rejected();
  }
  final totalChanged = !workspaceDomainV2Equal(
    _pick(baseBody, ['totalMinutes']),
    _pick(nextBody, ['totalMinutes']),
  );
  if (next['deleted'] != true &&
      (totalChanged || base['deleted'] == true) &&
      !_integer(nextBody['totalMinutes'], 0, 1440)) {
    return _rejected();
  }
  if (input['currentRevision'] != input['baseRevision']) {
    return _conflict('concurrent_change', ['work_log']);
  }
  if (next['deleted'] == true) {
    return _result(
      current['deleted'] == true ? 'noop' : 'apply',
      currentBody,
      true,
      current['deleted'] == true ? [] : ['deleted'],
    );
  }
  if (base['deleted'] == true) {
    return _result(
      'apply',
      {
        ...currentBody,
        'totalMinutes': nextBody['totalMinutes'],
        'selfMediaMinutes': 0,
        'aiMinutes': 0,
        'otherWorkMinutes': 0,
      },
      false,
      ['totalMinutes'],
    );
  }
  if (!totalChanged) return _result('noop', currentBody, false, []);
  return _result(
    'apply',
    {...currentBody, 'totalMinutes': nextBody['totalMinutes']},
    false,
    ['totalMinutes'],
  );
}

Map<String, dynamic> workspaceDomainV2Resolve(Map<String, dynamic> input) {
  try {
    workspaceV2Fields(input, {
      'kind',
      'id',
      'baseRevision',
      'currentRevision',
      'base',
      'next',
      'current',
    });
    _require(
      workspaceDomainV2Kinds.contains(input['kind']) &&
          _text(input['id'], minimum: 1) &&
          workspaceV2SafeInteger(input['baseRevision']) &&
          workspaceV2SafeInteger(input['currentRevision']),
    );
    for (final key in ['base', 'next', 'current']) {
      if (input[key] == null && key != 'next') continue;
      final snapshot = workspaceV2Map(input[key]);
      workspaceV2Fields(snapshot, {'deleted', 'body'});
      _require(snapshot['deleted'] is bool);
      workspaceV2Map(snapshot['body']);
    }
    _require(
      (input['baseRevision'] == 0) == (input['base'] == null) &&
          (input['currentRevision'] == 0) == (input['current'] == null) &&
          (input['currentRevision'] as num) >= (input['baseRevision'] as num),
    );
  } on FormatException {
    return _rejected();
  }
  if (['project_catalog', 'todo_preferences'].contains(input['kind'])) {
    return _rejected('record_read_only');
  }
  final base = input['base'] == null ? null : workspaceV2Map(input['base']);
  final current = input['current'] == null
      ? null
      : workspaceV2Map(input['current']);
  if (base != null && current != null) {
    final kind = input['kind'] as String, id = input['id'] as String;
    if (_inspectBody(kind, id, workspaceV2Map(base['body']))['writable'] !=
            true ||
        _inspectBody(kind, id, workspaceV2Map(current['body']))['writable'] !=
            true) {
      return _rejected('record_read_only');
    }
    if (input['baseRevision'] == input['currentRevision'] &&
        (base['deleted'] != current['deleted'] ||
            !workspaceDomainV2Equal(base['body'], current['body']))) {
      return _rejected();
    }
  }
  return input['kind'] == 'todo' ? _resolveTodo(input) : _resolveWorkLog(input);
}
