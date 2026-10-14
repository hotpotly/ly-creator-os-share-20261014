import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_work_log_editor.dart';
import 'package:ly_creator_capture/src/workspace/review_page.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_workspace_fixture.dart';

void main() {
  late FullWorkspaceFixture fixture;
  const previewFont = String.fromEnvironment('FULL_WORK_PREVIEW_FONT');
  final now = DateTime.now();
  final monday = DateTime(now.year, now.month, now.day - now.weekday + 1);
  String day(int offset) =>
      workspaceDay(DateTime(monday.year, monday.month, monday.day + offset));
  Map<String, dynamic> log(
    int offset, {
    num? total,
    num self = 0,
    num ai = 0,
    num other = 0,
  }) => {
    ...fullFixtureSample('workLog'),
    'day': day(offset),
    'totalMinutes': total,
    'selfMediaMinutes': self,
    'aiMinutes': ai,
    'otherWorkMinutes': other,
  };
  Future<void> open(
    WidgetTester tester, {
    List<Map<String, dynamic>> logs = const [],
    List<String> deleted = const [],
    bool writable = true,
    bool dark = false,
    double scale = 1,
    double keyboard = 0,
    bool visual = false,
  }) async {
    fixture = (await tester.runAsync(
      () => FullWorkspaceFixture.open(
        workLogs: logs,
        deletedWorkLogs: deleted,
        writable: writable,
      ),
    ))!;
    addTearDown(() => tester.runAsync(fixture.close));
    tester.view.physicalSize = const Size(360, 800);
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
            size: const Size(360, 800),
            textScaler: TextScaler.linear(scale),
            viewInsets: EdgeInsets.only(bottom: keyboard),
          ),
          child: RepaintBoundary(
            key: const ValueKey('full-work-preview'),
            child: child!,
          ),
        ),
        home: ReviewPage(controller: fixture.controller),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(finder);
      await fixture.controller.settled;
    });
    await tester.pumpAndSettle();
  }

  Finder row(int offset) =>
      find.byKey(ValueKey('full-work-day-${day(offset)}'));
  Finder minutes() => find.byKey(const ValueKey('full-work-minutes'));
  Finder save() => find.widgetWithText(FilledButton, '保存');

  testWidgets(
    'full work totals distinguish zero, category sums, deleted and missing days',
    (tester) async {
      await open(
        tester,
        logs: [
          log(0, total: 0, self: 80),
          log(1, self: 90, ai: 15.5),
          log(2, total: 450),
        ],
        deleted: [day(2)],
      );
      expect(
        find.descendant(of: row(0), matching: find.text('0小时')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row(1), matching: find.text('1小时45.5分钟')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row(2), matching: find.text('未记录')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('full-work-total')), findsOneWidget);
      expect(find.text('2/7天已记录'), findsOneWidget);
      final zero = tester.widget<Text>(
        find.descendant(of: row(0), matching: find.text('0小时')),
      );
      expect(zero.style?.color, workspaceWorkMinutesColor(0, Brightness.light));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a blank period is unrecorded and not zero hours', (
    tester,
  ) async {
    await open(tester);
    expect(find.text('0小时'), findsNothing);
    expect(find.text('未记录'), findsWidgets);
    expect(find.text('0/7天已记录'), findsOneWidget);
  });

  testWidgets(
    'saving unchanged historical total preserves raw category mode and large duration',
    (tester) async {
      final original = log(0, self: 1440, ai: 1440, other: 1440);
      await open(tester, logs: [original]);
      expect(
        find.descendant(of: row(0), matching: find.text('72小时')),
        findsOneWidget,
      );
      await tap(tester, row(0));
      expect(find.byType(FullWorkLogEditor), findsOneWidget);
      final before = fixture.controller.findFull('work_log', day(0))!;
      await tap(tester, save());
      final after = fixture.controller.findFull('work_log', day(0))!;
      expect(after.rawJson, before.rawJson);
      expect(after.revision, before.revision);
      expect(after.body['totalMinutes'], isNull);
    },
  );

  testWidgets(
    'total edit retains categories and empty input never silently clears',
    (tester) async {
      final original = log(0, self: 90, ai: 15.5);
      await open(tester, logs: [original]);
      await tap(tester, row(0));
      await tester.enterText(minutes(), '');
      await tap(tester, save());
      expect(find.byKey(const ValueKey('full-work-error')), findsOneWidget);
      expect(fixture.controller.findFull('work_log', day(0))!.body, original);
      await tester.enterText(minutes(), '45');
      await tap(tester, save());
      expect(find.byType(FullWorkLogEditor), findsNothing);
      expect(fixture.controller.findFull('work_log', day(0))!.body, {
        ...original,
        'totalMinutes': 45,
      });
    },
  );

  testWidgets(
    'zero is a record; explicit clear and tombstone refill use the same date identity',
    (tester) async {
      await open(tester);
      await tap(tester, row(0));
      await tester.enterText(minutes(), '0');
      await tap(tester, save());
      final first = fixture.controller.findFull('work_log', day(0))!;
      expect(first.workMinutes, 0);
      await tap(tester, row(0));
      await tap(tester, find.text('清空记录'));
      await tap(tester, find.widgetWithText(TextButton, '清空'));
      final cleared = fixture.controller.findFull(
        'work_log',
        day(0),
        includeDeleted: true,
      )!;
      expect(cleared.deleted, true);
      expect(cleared.workMinutes, isNull);
      await tap(tester, row(0));
      await tester.enterText(minutes(), '30');
      await tap(tester, save());
      final restored = fixture.controller.findFull('work_log', day(0))!;
      expect(restored.workMinutes, 30);
      expect(restored.id, first.id);
    },
  );

  testWidgets(
    'remote work revision changes keep the editor draft and reject its stale save',
    (tester) async {
      final original = log(0, total: 60, self: 90);
      await open(tester, logs: [original]);
      await tap(tester, row(0));
      await tester.enterText(minutes(), '45');
      await tester.runAsync(
        () => fixture.replaceRemote('work_log', day(0), {
          ...original,
          'totalMinutes': 20,
        }),
      );
      await tester.pumpAndSettle();
      await tap(tester, save());
      expect(find.byType(FullWorkLogEditor), findsOneWidget);
      expect(tester.widget<TextField>(minutes()).controller!.text, '45');
      expect(find.byKey(const ValueKey('full-work-error')), findsOneWidget);
      expect(fixture.controller.findFull('work_log', day(0))!.workMinutes, 20);
    },
  );

  testWidgets('read-only work data remains visible but cannot save or clear', (
    tester,
  ) async {
    await open(
      tester,
      logs: [log(0, total: 360)],
      writable: false,
      dark: true,
      scale: 1.8,
    );
    await tap(tester, row(0));
    expect(find.byType(FullWorkLogEditor), findsOneWidget);
    final buttons = tester.widgetList<FilledButton>(find.byType(FilledButton));
    expect(buttons.every((button) => button.onPressed == null), true);
    final clears = tester.widgetList<TextButton>(
      find.widgetWithText(TextButton, '清空记录'),
    );
    expect(clears.every((button) => button.onPressed == null), true);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'active v2 review saves remain local drafts and never become formal review entities',
    (tester) async {
      await open(tester);
      await tester.enterText(find.byType(TextField).first, '这周的本机目标');
      await tester.pump();
      await tap(tester, find.widgetWithText(TextButton, '保存草稿'));
      expect(find.text('已存本机'), findsOneWidget);
      expect(fixture.controller.records.single.kind, 'review_draft');
      expect(fixture.controller.records.single.data['goalsText'], '这周的本机目标');
      expect(
        fixture.controller.fullRecords.any((r) => r.kind == 'review'),
        false,
      );
      final prepared = await tester.runAsync(fixture.store.prepareV2Sync);
      expect((prepared!['payload'] as Map)['operations'], isEmpty);
    },
  );
  for (final dark in [false, true]) {
    testWidgets(
      'work editor with keyboard and large text in ${dark ? 'dark' : 'light'} mode',
      (tester) async {
        await open(
          tester,
          logs: [log(0, total: 365)],
          dark: dark,
          scale: 1.8,
          keyboard: 280,
          visual: true,
        );
        await tap(tester, row(0));
        expect(tester.takeException(), isNull);
        expect(tester.getRect(save()).bottom, lessThanOrEqualTo(520));
        if (previewFont.isNotEmpty) {
          final boundary = tester.renderObject<RenderRepaintBoundary>(
            find.byKey(const ValueKey('full-work-preview')),
          );
          await tester.runAsync(() async {
            final image = await boundary.toImage(pixelRatio: 2);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final file = File(
              '../tmp/full-work-visual/editor-${dark ? 'dark' : 'light'}.png',
            );
            await file.parent.create(recursive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        await tester.enterText(minutes(), '360');
        await tap(tester, save());
        expect(
          fixture.controller.findFull('work_log', day(0))!.workMinutes,
          360,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
