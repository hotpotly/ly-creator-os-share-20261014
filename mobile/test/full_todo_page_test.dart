import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_card.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_catalog.dart';
import 'package:ly_creator_capture/src/workspace/full_todo_composer.dart';
import 'package:ly_creator_capture/src/workspace/todo_page.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_workspace_fixture.dart';

void main() {
  late FullWorkspaceFixture fixture;
  const previewFont = String.fromEnvironment('FULL_TODO_PREVIEW_FONT');
  Map<String, dynamic> item({String? title, num progress = 37}) => {
    ...fullFixtureSample('todo'),
    'title': title ?? '写到500字',
    'progress': progress,
    'plannedDate': workspaceDay(DateTime.now()),
  };
  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(() => fixture.controller.settled);
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.runAsync(() async {
      await tester.tap(finder);
      await fixture.controller.settled;
    });
    await tester.pumpAndSettle();
  }

  Future<void> mount(
    WidgetTester tester, {
    bool dark = false,
    double scale = 1,
    double keyboard = 0,
    bool visual = false,
  }) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var theme = workspaceTheme(dark ? Brightness.dark : Brightness.light);
    if (visual && previewFont.isNotEmpty) {
      await tester.runAsync(() async {
        final loader = FontLoader('Visual Chinese')
          ..addFont(File(previewFont).readAsBytes().then(ByteData.sublistView));
        await loader.load();
        await (FontLoader(
          'MaterialIcons',
        )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
      });
      theme = theme.copyWith(
        textTheme: theme.textTheme.apply(fontFamily: 'Visual Chinese'),
        primaryTextTheme: theme.primaryTextTheme.apply(
          fontFamily: 'Visual Chinese',
        ),
      );
    }
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        builder: (context, child) => MediaQuery(
          data: MediaQueryData(
            size: const Size(360, 740),
            textScaler: TextScaler.linear(scale),
            viewInsets: EdgeInsets.only(bottom: keyboard),
          ),
          child: RepaintBoundary(
            key: const ValueKey('full-todo-preview'),
            child: child,
          ),
        ),
        home: TodoPage(controller: fixture.controller),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> capture(WidgetTester tester, String name) async {
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('full-todo-preview')),
    );
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      final directory = await Directory(
        '../tmp/full-todo-visual',
      ).create(recursive: true);
      await File(
        '${directory.path}/$name.png',
      ).writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
  }

  Future<void> openFixture(
    WidgetTester tester, {
    List<Map<String, dynamic>>? todos,
    bool writable = true,
    bool preferences = true,
  }) async {
    fixture = (await tester.runAsync(
      () => FullWorkspaceFixture.open(
        todos: todos ?? [item()],
        writable: writable,
        preferences: preferences,
      ),
    ))!;
    addTearDown(() => tester.runAsync(fixture.close));
  }

  testWidgets(
    'full list preserves progress, category, project and same completion semantics',
    (tester) async {
      await openFixture(tester);
      await mount(tester);
      expect(find.text('37%'), findsOneWidget);
      expect(find.text('工作'), findsOneWidget);
      expect(find.text('iOS视频 · 文案'), findsOneWidget);
      var record = fixture.controller.fullRecords.firstWhere(
        (r) => r.kind == 'todo',
      );
      await tester.runAsync(
        () => fixture.controller.saveFullTodo({
          'id': record.id,
          'body': record.patched({'progress': 67}),
        }, record.revision),
      );
      await tester.pumpAndSettle();
      expect(find.text('67%'), findsOneWidget);
      await tap(tester, find.byType(Checkbox));
      await settle(tester);
      record = fixture.controller.findFull('todo', record.id)!;
      expect(record.completed, true);
      expect(record.progress, 100);
      expect(record.body['progressBeforeComplete'], 67);
      await tap(tester, find.byType(Checkbox));
      await settle(tester);
      record = fixture.controller.findFull('todo', record.id)!;
      expect(record.completed, false);
      expect(record.progress, 67);
      expect(record.body['progressBeforeComplete'], 67);
      expect(record.body['stageKey'], 'script');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'readonly and unsupported cards are inspectable without edits or pull creation',
    (tester) async {
      await openFixture(
        tester,
        writable: false,
        todos: [
          {...item(), 'future': 'keep raw'},
        ],
      );
      await mount(tester);
      expect(find.byType(FloatingActionButton), findsNothing);
      expect(tester.widget<Checkbox>(find.byType(Checkbox)).onChanged, isNull);
      await tester.drag(find.byType(ListView), const Offset(0, 200));
      await tester.pumpAndSettle();
      expect(find.byType(FullTodoComposer), findsNothing);
      await tap(tester, find.text('写到500字'));
      await tester.pumpAndSettle();
      expect(find.text('当前版本无法编辑此格式'), findsOneWidget);
      expect(find.text('原始内容'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'historical decimal progress is visible and is not silently rounded by completion',
    (tester) async {
      await openFixture(tester, todos: [item(progress: 37.5)]);
      await mount(tester, dark: true, scale: 1.6);
      expect(find.text('37.5%'), findsOneWidget);
      await tap(tester, find.byType(Checkbox));
      await settle(tester);
      final record = fixture.controller.fullRecords.firstWhere(
        (r) => r.kind == 'todo',
      );
      expect(record.progress, 37.5);
      expect(record.completed, false);
      expect(find.byType(SnackBar), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'empty full list uses the same pull and FAB composer and keeps no-date entries only today',
    (tester) async {
      await openFixture(tester, todos: []);
      await mount(tester);
      await tester.drag(find.byType(ListView), const Offset(0, 40));
      await tester.pumpAndSettle();
      expect(find.byType(FullTodoComposer), findsNothing);
      await tester.drag(find.byType(ListView), const Offset(0, 200));
      await tester.pumpAndSettle();
      expect(find.byType(FullTodoComposer), findsOneWidget);
      await tap(tester, find.text('取消'));
      await tester.pumpAndSettle();
      await tap(tester, find.text('新增待办'));
      await tester.pumpAndSettle();
      expect(find.byType(FullTodoComposer), findsOneWidget);
    },
  );

  testWidgets(
    'range and no-date completion do not duplicate into the wrong day',
    (tester) async {
      final now = DateTime.now();
      final today = workspaceDay(now);
      final yesterday = workspaceDay(
        DateTime(now.year, now.month, now.day - 1),
      );
      final source = item();
      final range = {
        ...source,
        'title': '范围任务',
        'plannedDate': null,
        'segment': null,
        'dateRange': {'startDate': yesterday, 'endDate': today, 'name': '写作'},
      };
      final old = {
        ...source,
        'id': workspaceId(),
        'title': '昨天已完成',
        'plannedDate': null,
        'status': 'completed',
        'progress': 100,
        'completedAt': '${yesterday}T01:00:00Z',
      };
      await openFixture(tester, todos: [range, old]);
      await mount(tester);
      expect(find.text('范围任务'), findsOneWidget);
      expect(find.text('昨天已完成'), findsNothing);
      await tap(tester, find.byTooltip('前一天'));
      await tester.pumpAndSettle();
      expect(find.text('范围任务'), findsOneWidget);
      expect(find.text('昨天已完成'), findsOneWidget);
      expect(find.byType(FullTodoCard), findsNWidgets(2));
    },
  );

  testWidgets(
    'catalog excludes unavailable new links while retaining old readable names',
    (tester) async {
      final archived = {
        ...fullFixtureSample('projectCatalog'),
        'status': 'archived',
      };
      fixture = (await tester.runAsync(
        () => FullWorkspaceFixture.open(projects: [archived]),
      ))!;
      addTearDown(() => tester.runAsync(fixture.close));
      final catalog = FullTodoCatalog(fixture.controller.fullRecords);
      expect(catalog.projects, isEmpty);
      expect(catalog.stages('ios'), isEmpty);
      expect(catalog.projectLabel('ios'), 'iOS视频');
      expect(catalog.projectLabel('missing'), 'missing');
      expect(catalog.labels['self_media'], '工作');
      expect(catalog.colors['self_media'], 'project-4');
      expect(
        workspaceIdentityColors('project-4', Brightness.light)?.foreground,
        const Color(0xff76491f),
      );
      expect(
        workspaceIdentityColors('project-4', Brightness.dark)?.foreground,
        const Color(0xfff4be89),
      );
      expect(workspaceIdentityColors('unknown', Brightness.light), isNull);
    },
  );
  testWidgets(
    'open full editor rejects a stale revision and retains its draft',
    (tester) async {
      await openFixture(tester);
      await mount(tester);
      await tap(tester, find.byType(FullTodoCard));
      await tester.pumpAndSettle();
      final input = find.byKey(const ValueKey('full-todo-content'));
      await tester.enterText(input, '我的未保存修改');
      final record = fixture.controller.fullRecords.firstWhere(
        (r) => r.kind == 'todo',
      );
      await tester.runAsync(
        () => fixture.replaceRemote(
          'todo',
          record.id,
          record.patched({'category': 'life'}),
        ),
      );

      await tester.pumpAndSettle();
      await tester.ensureVisible(find.widgetWithText(FilledButton, '保存'));
      await tap(tester, find.widgetWithText(FilledButton, '保存'));
      await settle(tester);
      expect(find.byType(FullTodoComposer), findsOneWidget);
      expect(tester.widget<TextField>(input).controller!.text, '我的未保存修改');
      expect(find.byKey(const ValueKey('full-todo-error')), findsOneWidget);
      final stored = fixture.controller.findFull('todo', record.id)!;
      expect(stored.title, '写到500字');
      expect(stored.body['category'], 'life');
      expect(stored.remoteRevision, record.remoteRevision + 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unchanged historical title and decimal completion survive category-only editing',
    (tester) async {
      final original = item(title: '长' * 3000, progress: 37.5);
      await openFixture(tester, todos: [original]);
      await mount(tester);
      await tap(tester, find.byType(FullTodoCard));
      await tester.pumpAndSettle();
      await tap(tester, find.widgetWithText(ChoiceChip, '生活'));
      await tester.ensureVisible(find.widgetWithText(FilledButton, '保存'));
      await tap(tester, find.widgetWithText(FilledButton, '保存'));
      await settle(tester);
      expect(find.byType(FullTodoComposer), findsNothing);
      final stored = fixture.controller.findFull(
        'todo',
        original['id'] as String,
      )!;
      expect(stored.body, {...original, 'category': 'life'});
    },
  );

  testWidgets('full batch rejects 101 atomically then accepts exactly 100', (
    tester,
  ) async {
    await openFixture(tester, todos: []);
    await mount(tester);
    await tap(tester, find.text('新增待办'));
    await tester.pumpAndSettle();
    final input = find.byKey(const ValueKey('full-todo-content'));
    await tap(tester, find.text('批量'));
    await tester.enterText(input, List.generate(101, (i) => '批量$i').join('\n'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, '添加101项'));
    await tap(tester, find.widgetWithText(FilledButton, '添加101项'));
    await settle(tester);
    expect(
      fixture.controller.fullRecords.where((r) => r.kind == 'todo'),
      isEmpty,
    );
    expect(find.byKey(const ValueKey('full-todo-error')), findsOneWidget);
    await tester.enterText(input, List.generate(100, (i) => '批量$i').join('\n'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, '添加100项'));
    await tap(tester, find.widgetWithText(FilledButton, '添加100项'));
    await settle(tester);
    expect(find.byType(FullTodoComposer), findsNothing);
    final records = fixture.controller.fullRecords
        .where((r) => r.kind == 'todo')
        .toList();
    expect(records, hasLength(100));
    expect(
      records.every(
        (r) => r.body['plannedDate'] == workspaceDay(DateTime.now()),
      ),
      true,
    );
    expect(records.map((r) => r.id).toSet(), hasLength(100));
  });

  testWidgets(
    'full composer Enter continues in place without duplicate tasks',
    (tester) async {
      await openFixture(tester, todos: []);
      await mount(tester);
      await tap(tester, find.text('新增待办'));
      await tester.pumpAndSettle();
      final input = find.byKey(const ValueKey('full-todo-content'));
      for (final title in ['拍开头', '整理素材']) {
        await tester.enterText(input, title);
        await tester.runAsync(() async {
          await tester.testTextInput.receiveAction(TextInputAction.next);
          await fixture.controller.settled;
        });
        await settle(tester);
        expect(tester.widget<TextField>(input).controller!.text, isEmpty);
      }
      await tester.ensureVisible(find.widgetWithText(FilledButton, '完成'));
      await tap(tester, find.widgetWithText(FilledButton, '完成'));
      await tester.pumpAndSettle();
      expect(find.byType(FullTodoComposer), findsNothing);
      expect(
        fixture.controller.fullRecords.where((r) => r.kind == 'todo'),
        hasLength(2),
      );
      expect(find.text('拍开头'), findsOneWidget);
      expect(find.text('整理素材'), findsOneWidget);
    },
  );
  for (final dark in [false, true]) {
    testWidgets(
      'full Todo ${dark ? 'dark' : 'light'} editor remains usable with keyboard and larger text',
      (tester) async {
        await openFixture(tester);
        await mount(
          tester,
          dark: dark,
          scale: 1.4,
          keyboard: 280,
          visual: true,
        );
        await tap(tester, find.byType(FullTodoCard));
        await tester.pumpAndSettle();
        expect(find.byType(FullTodoComposer), findsOneWidget);
        expect(tester.takeException(), isNull);
        if (previewFont.isNotEmpty) {
          await capture(tester, dark ? 'editor-dark' : 'editor-light');
        }
        final save = find.widgetWithText(FilledButton, '保存');
        await tester.ensureVisible(save);
        await tester.pumpAndSettle();
        expect(tester.getBottomRight(save).dy, lessThanOrEqualTo(740 - 280));
        expect(tester.takeException(), isNull);
      },
    );
  }
}
