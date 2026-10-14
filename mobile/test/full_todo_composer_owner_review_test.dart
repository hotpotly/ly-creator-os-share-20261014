import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_composer.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_workspace_fixture.dart';

void main() {
  late FullWorkspaceFixture fixture;
  Future<void> mount(WidgetTester tester, Map<String, dynamic> changes) async {
    final body = {
      ...fullFixtureSample('todo'),
      'plannedDate': workspaceDay(DateTime.now()),
      ...changes,
    };
    fixture = (await tester.runAsync(
      () => FullWorkspaceFixture.open(todos: [body]),
    ))!;
    addTearDown(() => tester.runAsync(fixture.close));
    await tester.pumpWidget(
      MaterialApp(
        theme: workspaceTheme(Brightness.light),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => FullTodoComposer(
                  controller: fixture.controller,
                  day: workspaceDay(DateTime.now()),
                  record: fixture.controller.findFull(
                    'todo',
                    body['id'] as String,
                  ),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> save(WidgetTester tester) async {
    final button = find.widgetWithText(FilledButton, '保存');
    await tester.ensureVisible(button);
    await tester.runAsync(() async {
      await tester.tap(button);
      await fixture.controller.settled;
    });
    await tester.pumpAndSettle();
  }

  Map<String, dynamic> stored() =>
      fixture.controller.fullRecords.singleWhere((r) => r.kind == 'todo').body;

  testWidgets(
    'typing100 finishes with previous37 preserved as completion memory',
    (tester) async {
      await mount(tester, {
        'trackingMode': 'progress',
        'progress': 37,
        'status': 'open',
        'completedAt': null,
        'progressBeforeComplete': null,
      });
      await tester.tap(find.text('进度').first);
      await tester.pumpAndSettle();
      final input = find.byKey(const ValueKey('full-todo-progress'));
      await tester.ensureVisible(input);
      await tester.enterText(input, '100');
      await save(tester);
      expect(stored()['status'], 'completed');
      expect(stored()['progress'], 100);
      expect(stored()['progressBeforeComplete'], 37);
      expect(stored()['completedAt'], isNotNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('typing40 on completed100 reopens without forgetting67', (
    tester,
  ) async {
    await mount(tester, {
      'trackingMode': 'progress',
      'progress': 100,
      'status': 'completed',
      'completedAt': '2026-10-03T10:11:12.123456Z',
      'progressBeforeComplete': 67,
    });
    await tester.tap(find.text('进度').first);
    await tester.pumpAndSettle();
    final input = find.byKey(const ValueKey('full-todo-progress'));
    await tester.ensureVisible(input);
    await tester.enterText(input, '40');
    await save(tester);
    expect(stored()['status'], 'open');
    expect(stored()['progress'], 40);
    expect(stored()['progressBeforeComplete'], 67);
    expect(stored()['completedAt'], null);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'choosing current project is a no-op and keeps the linked stage',
    (tester) async {
      final body = fullFixtureSample('todo');
      await mount(tester, {});
      await tester.ensureVisible(find.text('关联项目（可选）'));
      await tester.tap(find.text('关联项目（可选）'));
      await tester.pumpAndSettle();
      final dropdown = tester.widget<DropdownButtonFormField<String>>(
        find.byKey(ValueKey('full-todo-project-${body['projectId']}')),
      );
      dropdown.onChanged!(body['projectId'] as String? ?? '');
      await tester.pumpAndSettle();
      await save(tester);
      expect(stored()['projectId'], body['projectId']);
      expect(stored()['stageKey'], body['stageKey']);
      expect(stored()['stageLinkSource'], body['stageLinkSource']);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'out-of-range historical completion memory has an explicit correction input',
    (tester) async {
      await mount(tester, {
        'trackingMode': 'progress',
        'progress': 100,
        'status': 'completed',
        'completedAt': '2026-10-03T10:11:12Z',
        'progressBeforeComplete': 101,
      });
      await tester.tap(find.text('进度').first);
      await tester.pumpAndSettle();
      final before = find.byKey(const ValueKey('full-todo-before-progress'));
      expect(before, findsOneWidget);
      await tester.ensureVisible(before);
      await tester.enterText(before, '67');
      await save(tester);
      expect(stored()['progress'], 100);
      expect(stored()['progressBeforeComplete'], 67);
      expect(stored()['completedAt'], '2026-10-03T10:11:12Z');
      expect(tester.takeException(), isNull);
    },
  );
}
