import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_card.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_catalog.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_composer.dart';
import 'package:ly_creator_capture/src/workspace/todo_page.dart';
import 'package:ly_creator_capture/src/workspace/workspace_full_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';

import 'support/full_workspace_fixture.dart';

void main() {
  for (final numericToken in ['1e400', '9007199254740993']) {
    testWidgets(
      'unsupported raw $numericToken remains visible without JSON reencoding',
      (tester) async {
        final body = {
          ...fullFixtureSample('todo'),
          'title': '历史原稿',
          'plannedDate': workspaceDay(DateTime.now()),
        };
        final json = jsonEncode(body);
        final raw =
            '${json.substring(0, json.length - 1)}, "futureNumber":$numericToken}';
        final record = WorkspaceFullRecord({
          'kind': 'todo',
          'id': body['id'],
          'json': raw,
          'localRevision': 1,
          'remoteRevision': 1,
          'deleted': false,
          'writable': false,
          'metadata': {'editableFields': <String>[], 'deletable': false},
        });
        expect(record.supported, false);
        await tester.pumpWidget(
          MaterialApp(
            theme: workspaceTheme(Brightness.dark),
            home: Builder(
              builder: (context) => Scaffold(
                body: FullTodoCard(
                  record: record,
                  catalog: FullTodoCatalog(const []),
                  onOpen: () => showFullTodoDetails(
                    context,
                    record,
                    FullTodoCatalog(const []),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('历史原稿'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('原始内容'));
        await tester.pumpAndSettle();
        expect(find.text(raw), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'authorization revoked during armed pull removes FAB and cannot open composer',
    (tester) async {
      final fixture = (await tester.runAsync(
        () => FullWorkspaceFixture.open(),
      ))!;
      addTearDown(() => tester.runAsync(fixture.close));
      await tester.pumpWidget(
        MaterialApp(
          theme: workspaceTheme(Brightness.light),
          home: TodoPage(controller: fixture.controller),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FloatingActionButton), findsOneWidget);
      final gesture = await tester.startGesture(
        tester.getCenter(find.byType(ListView)),
      );
      await gesture.moveBy(const Offset(0, 190));
      await tester.pump();
      await tester.runAsync(() async {
        final live = await fixture.store.loadV2Workspace();
        final request = Map<String, dynamic>.from(
          live['capabilitiesRequest'] as Map,
        );
        final response = Map<String, dynamic>.from(
          live['capabilitiesResponse'] as Map,
        );
        response['permissions'] = [
          for (final permission in response['permissions'] as List)
            {...Map<String, dynamic>.from(permission as Map), 'write': false},
        ];
        await fixture.controller.updateFromSync(
          () => fixture.store.refreshV2Capabilities(request, response),
        );
      });
      await tester.pump();
      await gesture.up();
      await tester.pumpAndSettle();
      expect(find.byType(FloatingActionButton), findsNothing);
      expect(find.byType(FullTodoComposer), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final brightness in Brightness.values) {
    testWidgets(
      'full card at 320dp and 200 percent text stays usable in $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(320, 740);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final fixture = (await tester.runAsync(
          () => FullWorkspaceFixture.open(
            todos: [
              {
                ...fullFixtureSample('todo'),
                'title': '较长的历史待办标题保留全部信息并可打开查看',
                'plannedDate': workspaceDay(DateTime.now()),
                'progress': 37.5,
                'isExtra': true,
              },
            ],
          ),
        ))!;
        addTearDown(() => tester.runAsync(fixture.close));
        await tester.pumpWidget(
          MaterialApp(
            theme: workspaceTheme(brightness),
            home: MediaQuery(
              data: const MediaQueryData(
                size: Size(320, 740),
                textScaler: TextScaler.linear(2),
              ),
              child: TodoPage(controller: fixture.controller),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(FullTodoCard), findsOneWidget);
        expect(find.text('37.5%'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
