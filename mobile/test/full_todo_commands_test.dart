import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_commands.dart';
import 'package:ly_creator_capture/src/workspace/workspace_domain_v2.dart';
import 'package:ly_creator_capture/src/workspace/workspace_full_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';

import 'workspace_v2_driver_test.dart' as fixtures;

WorkspaceFullRecord fullRecord(
  Map<String, dynamic> body, {
  bool write = true,
  int remoteRevision = 1,
  List<String>? fields,
}) => WorkspaceFullRecord({
  'kind': 'todo',
  'id': body['id'] ?? '99999999-9999-4999-8999-999999999999',
  'json': jsonEncode(body),
  'localRevision': 7,
  'remoteRevision': remoteRevision,
  'remoteSequence': remoteRevision,
  'deleted': false,
  'writable': write,
  'pending': remoteRevision == 0 ? {} : null,
  'metadata': {
    'write': write,
    'read': true,
    'deletable': write,
    'source': 'manual',
    'editableFields':
        fields ?? workspaceDomainV2TodoUnits.values.expand((v) => v).toList(),
  },
});
Map<String, dynamic> todoBody() => fixtures.fullBody(workspaceId());

void main() {
  test('37 to67 completion undo keeps67 and earlier completion memory', () {
    var body = {...todoBody(), 'trackingMode': 'progress', 'progress': 37};
    body = Map<String, dynamic>.from(
      fullTodoEditCommand(
            fullRecord(body),
            completion: {
              ...fullTodoGroup(body, fullTodoCompletionFields),
              'progress': 67,
            },
          )['body']
          as Map,
    );
    final now = DateTime.utc(2026, 10, 3, 10, 11, 12, 123, 456);
    body = Map<String, dynamic>.from(
      fullTodoToggleCommand(fullRecord(body), now: now)['body'] as Map,
    );
    expect(body['progress'], 100);
    expect(body['progressBeforeComplete'], 67);
    expect(body['completedAt'], '2026-10-03T10:11:12.123456Z');
    body = Map<String, dynamic>.from(
      fullTodoToggleCommand(fullRecord(body))['body'] as Map,
    );
    expect(body['status'], 'open');
    expect(body['progress'], 67);
    expect(body['progressBeforeComplete'], 67);
    body = Map<String, dynamic>.from(
      fullTodoEditCommand(
            fullRecord(body),
            completion: {
              ...fullTodoGroup(body, fullTodoCompletionFields),
              'progress': 40,
            },
          )['body']
          as Map,
    );
    expect(body['progressBeforeComplete'], 67);
  });
  test(
    'historical fractional progress is not silently rounded by completion',
    () {
      final body = {
        ...todoBody(),
        'trackingMode': 'progress',
        'progress': 37.5,
      };
      expect(
        () => fullTodoToggleCommand(fullRecord(body)),
        throwsFormatException,
      );
      final modified = fullTodoEditCommand(
        fullRecord(body),
        fields: {'category': 'life'},
      );
      expect((modified['body'] as Map)['progress'], 37.5);
    },
  );
  test(
    'fractional completion memory must be explicitly corrected before toggling',
    () {
      final body = {
        ...todoBody(),
        'trackingMode': 'progress',
        'progress': 40,
        'progressBeforeComplete': 37.5,
      };
      expect(
        () => fullTodoToggleCommand(fullRecord(body)),
        throwsFormatException,
      );
    },
  );
  test('completed null memory reopens progress99 without inventing memory', () {
    final body = {
      ...todoBody(),
      'trackingMode': 'progress',
      'status': 'completed',
      'progress': 100,
      'progressBeforeComplete': null,
      'completedAt': '2026-10-03T10:00:00.123456Z',
    };
    final result = fullTodoToggleCommand(fullRecord(body))['body'] as Map;
    expect(result['progress'], 99);
    expect(result['progressBeforeComplete'], null);
    expect(result['completedAt'], null);
  });
  test('checklist undo returns zero and preserves completion memory', () {
    final body = {...todoBody(), 'trackingMode': 'checklist', 'progress': 0};
    final result =
        fullTodoToggleCommand(fullRecord(body))['body'] as Map<String, dynamic>;
    final undone = fullTodoToggleCommand(fullRecord(result))['body'] as Map;
    expect(undone['progress'], 0);
    expect(undone['progressBeforeComplete'], 0);
  });
  test(
    'title3000 numeric history and missing optional keys survive unrelated edit',
    () {
      final body = {
        ...todoBody(),
        'title': '字' * 3000,
        'trackingMode': 'progress',
        'progress': 37.5,
        'progressBeforeComplete': 80.5,
      };
      for (final key in [
        'isExtra',
        'dateRange',
        'stageKey',
        'stageLinkSource',
      ]) {
        body.remove(key);
      }
      final result =
          fullTodoEditCommand(
                fullRecord(body),
                fields: {'category': 'ai'},
              )['body']
              as Map;
      expect(result, {...body, 'category': 'ai'});
      expect(
        () => fullTodoEditCommand(
          fullRecord(body),
          fields: {'title': '${body['title']}新'},
        ),
        throwsFormatException,
      );
    },
  );
  test('unchanged group keeps absent optional key absent', () {
    final body = todoBody()..remove('dateRange');
    final result =
        fullTodoEditCommand(
              fullRecord(body),
              date: fullTodoGroup(body, fullTodoDateFields),
            )['body']
            as Map;
    expect(result.containsKey('dateRange'), false);
  });
  test('range single and undated conversions are complete date groups', () {
    final body = todoBody();
    final range = {
      'plannedDate': null,
      'segment': null,
      'dateRange': {
        'startDate': '2026-12-31',
        'endDate': '2027-01-02',
        'name': '跨年',
      },
    };
    final ranged =
        fullTodoEditCommand(fullRecord(body), date: range)['body']
            as Map<String, dynamic>;
    expect(ranged['dateRange'], range['dateRange']);
    final single =
        fullTodoEditCommand(
              fullRecord(ranged),
              date: {
                'plannedDate': '2027-01-04',
                'segment': 'morning',
                'dateRange': null,
              },
            )['body']
            as Map<String, dynamic>;
    final none =
        fullTodoEditCommand(
              fullRecord(single),
              date: {'plannedDate': null, 'segment': null, 'dateRange': null},
            )['body']
            as Map;
    expect(none['plannedDate'], null);
    expect(none['segment'], null);
  });
  test('range and single date overlap is rejected', () {
    expect(
      () => fullTodoEditCommand(
        fullRecord(todoBody()),
        date: {
          'plannedDate': '2026-10-03',
          'segment': null,
          'dateRange': {
            'startDate': '2026-10-03',
            'endDate': '2026-10-04',
            'name': '',
          },
        },
      ),
      throwsFormatException,
    );
  });
  test(
    'project change derives manual link and explicit clear removes whole group',
    () {
      final body = todoBody();
      final linked =
          fullTodoEditCommand(
                fullRecord(body),
                project: {
                  'projectId': 'legacy-ios',
                  'stageKey': 'script',
                  'stageLinkSource': 'manual',
                },
              )['body']
              as Map<String, dynamic>;
      expect(linked['projectId'], 'legacy-ios');
      final cleared =
          fullTodoEditCommand(
                fullRecord(linked),
                project: {
                  'projectId': null,
                  'stageKey': null,
                  'stageLinkSource': null,
                },
              )['body']
              as Map;
      expect(cleared['stageKey'], null);
    },
  );
  test('partial completion permissions cannot authorize whole group', () {
    expect(
      () => fullTodoToggleCommand(
        fullRecord(todoBody(), fields: ['status', 'completedAt']),
      ),
      throwsStateError,
    );
  });
  test('readonly record and server-field patches are rejected', () {
    expect(
      () => fullTodoEditCommand(
        fullRecord(todoBody(), write: false),
        fields: {'title': 'new'},
      ),
      throwsStateError,
    );
    expect(
      () => fullTodoEditCommand(
        fullRecord(todoBody()),
        fields: {'source': 'manual'},
      ),
      throwsFormatException,
    );
  });
  test(
    'create is exactly13 writable keys and local edit does not add server link source',
    () {
      final body = fullTodoCreateBody(
        title: '新待办',
        category: 'life',
        plannedDate: null,
      );
      expect(body.length, 13);
      expect(body.containsKey('source'), false);
      final result =
          fullTodoEditCommand(
                fullRecord(body, remoteRevision: 0),
                project: {
                  'projectId': 'ios',
                  'stageKey': 'script',
                  'stageLinkSource': 'manual',
                },
              )['body']
              as Map;
      expect(result.containsKey('stageLinkSource'), false);
      expect(workspaceDomainV2Validate('todoCreate', result), isNotNull);
    },
  );
  test('invalid new title category and completion are rejected', () {
    expect(
      () => fullTodoCreateBody(title: '', category: 'life'),
      throwsFormatException,
    );
    expect(
      () => fullTodoCreateBody(title: '字' * 301, category: 'life'),
      throwsFormatException,
    );
    expect(
      () => fullTodoCreateBody(title: 'x', category: 'missing'),
      throwsFormatException,
    );
    expect(
      () => fullTodoEditCommand(
        fullRecord(todoBody()),
        completion: {'progress': 30},
      ),
      throwsFormatException,
    );
  });
  test('setting100 completes and undo restores pre-edit37', () {
    final body = {...todoBody(), 'trackingMode': 'progress', 'progress': 37};
    final next = Map<String, dynamic>.from(
      fullTodoProgressCommand(
            fullRecord(body),
            100,
            now: DateTime.utc(2026, 10, 3),
          )['body']
          as Map,
    );
    expect(next['status'], 'completed');
    expect(next['progress'], 100);
    expect(next['progressBeforeComplete'], 37);
    expect(next['completedAt'], '2026-10-03T00:00:00.000Z');
    final undone = fullTodoToggleCommand(fullRecord(next))['body'] as Map;
    expect(undone['status'], 'open');
    expect(undone['progress'], 37);
    expect(undone['progressBeforeComplete'], 37);
    expect(undone['completedAt'], null);
  });
  test('setting completed100 to40 reopens and keeps prior67', () {
    final body = {
      ...todoBody(),
      'trackingMode': 'progress',
      'progress': 100,
      'status': 'completed',
      'progressBeforeComplete': 67,
      'completedAt': '2026-10-03T00:00:00Z',
    };
    final next = fullTodoProgressCommand(fullRecord(body), 40)['body'] as Map;
    expect(next['status'], 'open');
    expect(next['progress'], 40);
    expect(next['progressBeforeComplete'], 67);
    expect(next['completedAt'], null);
  });
  test(
    'unchanged historical completion group stays byte-semantically intact',
    () {
      final body = {
        ...todoBody(),
        'trackingMode': 'progress',
        'progress': 37.5,
        'progressBeforeComplete': 80.5,
      };
      final next = fullTodoEditCommand(
        fullRecord(body),
        completion: fullTodoGroup(body, fullTodoCompletionFields),
      )['body'];
      expect(next, body);
      expect(fullTodoProgressCommand(fullRecord(body), 37.5)['body'], body);
      expect(
        () => fullTodoProgressCommand(fullRecord(body), 100),
        throwsFormatException,
      );
    },
  );
  test('batch accepts100 rejects101 and retains English internal spaces', () {
    final input = List.generate(100, (i) => 'MX Master 4第$i项').join('\n');
    expect(fullTodoParseBatch(input), hasLength(100));
    expect(fullTodoParseBatch(input).first, 'MX Master 4第0项');
    expect(() => fullTodoParseBatch('$input\n第101项'), throwsFormatException);
  });
  test('new title uses ECMAScript trim rather than Dart-only whitespace', () {
    expect(
      fullTodoCreateBody(title: '\u0085', category: 'life')['title'],
      '\u0085',
    );
    expect(
      () => fullTodoCreateBody(title: '\ufeff', category: 'life'),
      throwsFormatException,
    );
  });
}
