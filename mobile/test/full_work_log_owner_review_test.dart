import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_work_log_editor.dart';
import 'package:ly_creator_capture/src/workspace/full_work_log_view.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_workspace_fixture.dart';

void main() {
  late FullWorkspaceFixture fixture;
  const day = '2026-10-03';
  Map<String, dynamic> body([Map<String, dynamic> changes = const {}]) => {
    ...fullFixtureSample('workLog'),
    'day': day,
    'totalMinutes': 60,
    'selfMediaMinutes': 90.5,
    ...changes,
  };

  Future<void> mount(WidgetTester tester, Map<String, dynamic> data) async {
    fixture = (await tester.runAsync(
      () => FullWorkspaceFixture.open(workLogs: [data]),
    ))!;
    addTearDown(() => tester.runAsync(fixture.close));
    await tester.pumpWidget(
      MaterialApp(
        theme: workspaceTheme(Brightness.light),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => FullWorkLogEditor(
                  controller: fixture.controller,
                  day: day,
                  record: fixture.controller.findFull('work_log', day),
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

  Future<void> tap(WidgetTester tester, Finder target) async {
    await tester.ensureVisible(target);
    await tester.runAsync(() async {
      await tester.tap(target);
      await Future<void>.delayed(Duration.zero);
      await fixture.controller.settled;
    });
    await tester.pumpAndSettle();
  }

  Finder input() => find.byKey(const ValueKey('full-work-minutes'));
  Finder save() => find.widgetWithText(FilledButton, '保存');

  testWidgets('unknown work body stays exact readonly and uncountable', (
    tester,
  ) async {
    await mount(
      tester,
      body({
        'future': {'minutes': 7, 'text': '原始数据'},
      }),
    );
    final record = fixture.controller.findFull('work_log', day)!;
    expect(record.supported, false);
    expect(
      tester
          .widget<SelectableText>(find.byKey(const ValueKey('full-work-raw')))
          .data,
      record.rawJson,
    );
    expect(input(), findsNothing);
    expect(save(), findsNothing);
    expect(find.text('清空记录'), findsNothing);
    expect(find.text('不可统计'), findsOneWidget);
    final summary = fullWorkLogSummary(fixture.controller.fullRecords, [day]);
    expect(summary.label, '不可统计');
    expect(summary.recordedCount, 1);
    expect(summary.minutes, isNull);
    final prepared = await tester.runAsync(fixture.store.prepareV2Sync);
    expect((prepared!['payload'] as Map)['operations'], isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'permission loss while editing preserves draft and disables writes',
    (tester) async {
      final original = body();
      await mount(tester, original);
      await tester.enterText(input(), '45');
      await tester.runAsync(
        () => fixture.controller.updateFromSync(
          fixture.store.invalidateV2Capabilities,
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(input()).controller!.text, '45');
      expect(tester.widget<TextField>(input()).readOnly, true);
      expect(tester.widget<FilledButton>(save()).onPressed, isNull);
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, '清空记录'))
            .onPressed,
        isNull,
      );
      expect(fixture.controller.findFull('work_log', day)!.body, original);
      expect(
        fixture.controller.findFull('work_log', day)!.state['pending'],
        isNull,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('remote change during clear confirmation rejects stale delete', (
    tester,
  ) async {
    final original = body();
    await mount(tester, original);
    await tester.enterText(input(), '45');
    await tap(tester, find.widgetWithText(TextButton, '清空记录'));
    expect(find.text('清空这天的投入记录？'), findsOneWidget);
    final remote = {...original, 'totalMinutes': 20};
    await tester.runAsync(() => fixture.replaceRemote('work_log', day, remote));
    await tester.pumpAndSettle();
    await tap(tester, find.widgetWithText(TextButton, '清空'));
    expect(find.byType(FullWorkLogEditor), findsOneWidget);
    expect(tester.widget<TextField>(input()).controller!.text, '45');
    expect(find.byKey(const ValueKey('full-work-error')), findsOneWidget);
    final record = fixture.controller.findFull('work_log', day)!;
    expect(record.body, remote);
    expect(record.deleted, false);
    expect(record.state['pending'], isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'duplicate save callback creates one local revision and operation',
    (tester) async {
      final original = body();
      await mount(tester, original);
      final previous = fixture.controller.findFull('work_log', day)!;
      await tester.enterText(input(), '45');
      final callback = tester.widget<FilledButton>(save()).onPressed!;
      await tester.runAsync(() async {
        callback();
        callback();
        await fixture.controller.settled;
      });
      await tester.pumpAndSettle();
      final record = fixture.controller.findFull('work_log', day)!;
      expect(record.revision, previous.revision + 1);
      expect(record.body, {...original, 'totalMinutes': 45});
      final prepared = await tester.runAsync(fixture.store.prepareV2Sync);
      expect((prepared!['payload'] as Map)['operations'], hasLength(1));
      expect(find.byType(FullWorkLogEditor), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
