import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';

void main() {
  final fixture = workspaceV2Map(
    jsonDecode(
      File('../shared-fixtures/workspace-domain-v2.json').readAsStringSync(),
    ),
  );
  Map<String, dynamic> sample(String name) => workspaceV2Map(
    jsonDecode(jsonEncode(workspaceV2Map(fixture['samples'])[name])),
  );
  Map<String, dynamic> inputForTodo(
    Map<String, dynamic> next,
    Map<String, dynamic> base,
  ) => {
    'kind': 'todo',
    'id': base['id'],
    'baseRevision': 1,
    'currentRevision': 1,
    'base': {'deleted': false, 'body': jsonDecode(jsonEncode(base))},
    'next': {'deleted': false, 'body': next},
    'current': {'deleted': false, 'body': jsonDecode(jsonEncode(base))},
  };
  for (final raw in fixture['cases'] as List) {
    final value = workspaceV2Map(raw);
    test('domain schema ${value['name']}', () {
      void validate() =>
          workspaceDomainV2Validate(value['schema'] as String, value['value']);
      expect(
        validate,
        value['valid'] == true ? returnsNormally : throwsFormatException,
      );
    });
  }
  for (final raw in fixture['inspectCases'] as List) {
    final value = workspaceV2Map(raw);
    test('domain inspect ${value['name']}', () {
      final result = workspaceDomainV2Inspect(
        value['kind'] as String,
        value['id'] as String,
        value['json'] as String,
      );
      expect(result['rawJson'], value['json']);
      if (result['body'] != null) {
        expect(result['body'], jsonDecode(value['json'] as String));
      }
      expect(result['writable'], value['writable']);
      if (value.containsKey('supported')) {
        expect(result['supported'], value['supported']);
      }
      if (value.containsKey('reason')) {
        expect(result['reason'], value['reason']);
      }
    });
  }
  for (final raw in fixture['equalityCases'] as List) {
    final value = workspaceV2Map(raw);
    test('domain equal ${value['name']}', () {
      expect(
        workspaceDomainV2Equal(
          jsonDecode(value['leftJson'] as String),
          jsonDecode(value['rightJson'] as String),
        ),
        value['equal'],
      );
    });
  }
  for (final raw in fixture['rawBaseCases'] as List) {
    final value = workspaceV2Map(raw);
    test('domain raw base ${value['name']}', () {
      void validate() => workspaceDomainV2AssertBaseRaw(
        workspaceV2Map(value['actual']),
        workspaceV2Map(value['historical']),
      );
      expect(
        validate,
        value['valid'] == true ? returnsNormally : throwsFormatException,
      );
    });
  }
  for (final raw in fixture['resolutionCases'] as List) {
    final value = workspaceV2Map(raw);
    test('domain resolve ${value['name']}', () {
      final before = jsonEncode(value['input']);
      expect(
        workspaceDomainV2Resolve(workspaceV2Map(value['input'])),
        value['expected'],
      );
      expect(jsonEncode(value['input']), before);
    });
  }

  test('domain create fields exclude server metadata', () {
    final body = sample('todoCreate');
    expect(body.length, 13);
    expect(workspaceDomainV2Validate('todoCreate', body), body);
    expect(
      () => workspaceDomainV2Validate('todoCreate', {
        ...body,
        'source': 'manual',
      }),
      throwsFormatException,
    );
  });
  test(
    'domain preserves 80k history and fractional completion during category edits',
    () {
      final base = {...sample('todo'), 'title': '字' * 80000, 'progress': 12.25};
      final result = workspaceDomainV2Resolve(
        inputForTodo({...base, 'category': 'life'}, base),
      );
      expect(result['status'], 'apply');
      expect(result['changedUnits'], ['category']);
      expect(workspaceV2Map(result['body'])['title'], base['title']);
      expect(workspaceV2Map(result['body'])['progress'], 12.25);
      expect(
        workspaceDomainV2Resolve(
          inputForTodo({...base, 'title': '${base['title']}新'}, base),
        ),
        {'status': 'rejected', 'reason': 'invalid_change'},
      );
    },
  );
  test('domain preserves optional field absence for unrelated changes', () {
    final base = sample('todo');
    const keys = ['dateRange', 'isExtra', 'stageLinkSource', 'stageKey'];
    for (final key in keys) {
      base.remove(key);
    }
    final result = workspaceDomainV2Resolve(
      inputForTodo({...base, 'title': '新标题'}, base),
    );
    expect(result['status'], 'apply');
    for (final key in keys) {
      expect(workspaceV2Map(result['body']).containsKey(key), false);
    }
    expect(
      workspaceDomainV2Resolve(
        inputForTodo({...base, 'dateRange': null}, base),
      )['changedUnits'],
      ['D'],
    );
    expect(
      workspaceDomainV2Resolve(inputForTodo({...base, 'stageKey': null}, base)),
      {'status': 'rejected', 'reason': 'invalid_change'},
    );
  });
  test('domain preserves legacy feedback stage on unrelated edits', () {
    final base = {
      ...sample('todo'),
      'projectId': 'archived-project',
      'stageKey': 'feedback',
      'stageLinkSource': null,
    };
    final result = workspaceDomainV2Resolve(
      inputForTodo({...base, 'title': '仅改标题'}, base),
    );
    expect(result['status'], 'apply');
    expect(result['changedUnits'], ['title']);
    expect(workspaceV2Map(result['body'])['stageKey'], 'feedback');
  });
  test('domain numeric new-body reencoding leaves raw baseline intact', () {
    final raw = jsonEncode(
      sample('todo'),
    ).replaceFirst('"progress":37', '"progress":37.0');
    final base = workspaceDomainV2Inspect(
      'todo',
      sample('todo')['id'] as String,
      raw,
    );
    final body = workspaceV2Map(base['body']);
    final next = {...body, 'title': '新标题', 'progress': 37};
    final result = workspaceDomainV2Resolve(inputForTodo(next, body));
    expect(result['status'], 'apply');
    expect(result['changedUnits'], ['title']);
    expect(base['rawJson'], raw);
    expect(
      () => workspaceDomainV2AssertBaseRaw(
        {'deleted': false, 'json': jsonEncode(next)},
        {'deleted': false, 'json': raw},
      ),
      throwsFormatException,
    );
  });
  test('domain finite fractional history is not integer canonical JSON', () {
    final base = {
      ...sample('todo'),
      'progress': 12.25,
      'progressBeforeComplete': 37.5,
    };
    final result = workspaceDomainV2Resolve(
      inputForTodo({...base, 'isExtra': true}, base),
    );
    expect(result['changedUnits'], ['isExtra']);
    expect(workspaceV2Map(result['body'])['progressBeforeComplete'], 37.5);
  });
  test('domain refuses 17MiB raw JSON without truncation', () {
    final raw = jsonEncode({
      ...sample('todo'),
      'title': 'x' * (17 * 1024 * 1024),
    });
    final result = workspaceDomainV2Inspect(
      'todo',
      sample('todo')['id'] as String,
      raw,
    );
    expect(result, {
      'rawJson': raw,
      'body': null,
      'supported': false,
      'writable': false,
      'reason': 'too_large',
    });
  });
  test('domain unsafe numeric text remains intact and read only', () {
    for (final token in [
      '9007199254740992',
      '-9007199254740992',
      '1e400',
      '-1e400',
    ]) {
      final raw = jsonEncode(
        sample('todo'),
      ).replaceFirst('"progress":37', '"progress":$token');
      final result = workspaceDomainV2Inspect(
        'todo',
        sample('todo')['id'] as String,
        raw,
      );
      expect(result['rawJson'], raw);
      expect(result['reason'], 'unsafe_number');
      expect(result['writable'], false);
    }
  });
  test(
    'domain shared immutable inputs stay unchanged and results are detached',
    () {
      final base = {
        ...sample('todo'),
        'plannedDate': null,
        'segment': null,
        'dateRange': {
          'startDate': '2026-10-03',
          'endDate': '2026-10-04',
          'name': '拍摄',
        },
      };
      final input = inputForTodo({...base, 'title': '新标题'}, base);
      input['current'] = input['base'];
      final before = jsonEncode(input);
      final result = workspaceDomainV2Resolve(input);
      expect(result['status'], 'apply');
      (workspaceV2Map(result['body'])['dateRange'] as Map)['name'] = 'changed';
      expect(jsonEncode(input), before);
      expect((base['dateRange'] as Map)['name'], '拍摄');
    },
  );
  test('domain equality rejects cycles and non-JSON objects', () {
    final left = <String, dynamic>{}, right = <String, dynamic>{};
    left['self'] = left;
    right['self'] = right;
    expect(workspaceDomainV2Equal(left, right), false);
    final date = DateTime.utc(2026);
    expect(workspaceDomainV2Equal(date, date), false);
  });

  test('domain nonfinite history remains read only when revisions match', () {
    final body = {...sample('todo'), 'progress': double.infinity};
    final input = {
      'kind': 'todo',
      'id': body['id'],
      'baseRevision': 1,
      'currentRevision': 1,
      'base': {'deleted': false, 'body': body},
      'next': {
        'deleted': false,
        'body': {...body, 'title': '新标题'},
      },
      'current': {
        'deleted': false,
        'body': {...body},
      },
    };
    expect(workspaceDomainV2Resolve(input), {
      'status': 'rejected',
      'reason': 'record_read_only',
    });
  });
}
