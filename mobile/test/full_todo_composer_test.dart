import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_composer.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_workspace_fixture.dart';

void main() {
  late FullWorkspaceFixture fixture;
  late Map<String, dynamic> body;
  Future<void> mount(WidgetTester tester) async {
    body = {
      ...fullFixtureSample('todo'),
      'trackingMode': 'progress',
      'progress': 37,
      'status': 'open',
      'completedAt': null,
      'progressBeforeComplete': null,
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
                  day: '2026-10-03',
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

  testWidgets(
    'empty progress is retained on failure and later100 remembers37',
    (tester) async {
      await mount(tester);
      await tester.tap(find.text('进度').first);
      await tester.pumpAndSettle();
      final field = find.byKey(const ValueKey('full-todo-progress'));
      await tester.ensureVisible(field);
      await tester.enterText(field, '');
      await save(tester);
      expect(find.byKey(const ValueKey('full-todo-error')), findsOneWidget);
      expect(tester.widget<TextField>(field).controller!.text, '');
      expect(
        fixture.controller
            .findFull('todo', body['id'] as String)!
            .body['progress'],
        37,
      );
      await tester.ensureVisible(field);
      await tester.enterText(field, '100');
      await save(tester);
      final result = fixture.controller
          .findFull('todo', body['id'] as String)!
          .body;
      expect(result['status'], 'completed');
      expect(result['progressBeforeComplete'], 37);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('deletion ignores unsaved project edits after catalog archive', (
    tester,
  ) async {
    await mount(tester);
    await tester.ensureVisible(find.text('关联项目（可选）'));
    await tester.tap(find.text('关联项目（可选）'));
    await tester.pumpAndSettle();
    tester
        .widget<DropdownButtonFormField<String>>(
          find.byKey(
            ValueKey(
              'full-todo-stage-${body['projectId']}-${body['stageKey']}',
            ),
          ),
        )
        .onChanged!('');
    await tester.pumpAndSettle();
    final project = fullFixtureSample('projectCatalog');
    await tester.runAsync(
      () => fixture.replaceRemote('project_catalog', project['id'] as String, {
        ...project,
        'status': 'archived',
      }),
    );
    await tester.pumpAndSettle();
    final delete = find.byTooltip('删除待办');
    await tester.ensureVisible(delete);
    await tester.runAsync(() => tester.tap(delete));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.text('删除').last);
      await Future<void>.delayed(Duration.zero);
      await fixture.controller.settled;
    });
    await tester.pumpAndSettle();
    final result = fixture.controller.findFull(
      'todo',
      body['id'] as String,
      includeDeleted: true,
    )!;
    expect(result.deleted, true);
    expect(result.body, body);
    expect(tester.takeException(), isNull);
  });
}
