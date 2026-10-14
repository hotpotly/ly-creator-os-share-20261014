import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/todo_composer.dart';
import 'package:ly_creator_capture/src/workspace/todo_page.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'workspace_test.dart' show MemoryWorkspaceStore, todo;

void main() {
  Future<WorkspaceController> mount(
    WidgetTester tester,
    MemoryWorkspaceStore store, {
    bool dark = false,
    bool reduced = false,
  }) async {
    final controller = WorkspaceController(store);
    await controller.load();
    await tester.pumpWidget(
      MaterialApp(
        theme: workspaceTheme(dark ? Brightness.dark : Brightness.light),
        home: MediaQuery(
          data: MediaQueryData(
            size: const Size(360, 740),
            disableAnimations: reduced,
          ),
          child: TodoPage(controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
    addTearDown(controller.dispose);
    return controller;
  }

  test(
    'batch accepts CRLF and blank lines without silently deduplicating titles',
    () {
      expect(parseTodoBatch(' 拍摄 \r\n\n剪辑\r拍摄 '), ['拍摄', '剪辑', '拍摄']);
      expect(() => parseTodoBatch('\n  '), throwsFormatException);
      expect(() => parseTodoBatch('字' * 301), throwsFormatException);
      expect(
        () => parseTodoBatch(List.filled(101, '任务').join('\n')),
        throwsFormatException,
      );
    },
  );

  testWidgets(
    'empty list pull releases into the same composer; small pull cancels',
    (tester) async {
      await mount(tester, MemoryWorkspaceStore());
      await tester.drag(find.byType(ListView), const Offset(0, 40));
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsNothing);
      await tester.drag(find.byType(ListView), const Offset(0, 200));
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsOneWidget);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('新增待办'));
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsOneWidget);
    },
  );

  testWidgets(
    'pull back below threshold and pointer cancellation never open editor',
    (tester) async {
      await mount(tester, MemoryWorkspaceStore());
      var gesture = await tester.startGesture(
        tester.getCenter(find.byType(ListView)),
      );
      await gesture.moveBy(const Offset(0, 180));
      await tester.pump();
      expect(find.text('松开新增'), findsOneWidget);
      await gesture.moveBy(const Offset(0, -180));
      await tester.pump();
      await gesture.up();
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsNothing);
      gesture = await tester.startGesture(
        tester.getCenter(find.byType(ListView)),
      );
      await gesture.moveBy(const Offset(0, 180));
      await tester.pump();
      await gesture.cancel();
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsNothing);
    },
  );

  testWidgets(
    'scrolling a long list upward or downward does not create a task',
    (tester) async {
      final store = MemoryWorkspaceStore()
        ..records = List.generate(35, (_) => todo(day: null));
      await mount(tester, store);
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView), const Offset(0, 180));
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsNothing);
    },
  );

  testWidgets(
    'keyboard next creates repeatedly with the selected day/category',
    (tester) async {
      final store = MemoryWorkspaceStore();
      await mount(tester, store);
      await tester.tap(find.text('新增待办'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('生活'));
      await tester.tap(find.text('明天'));
      await tester.enterText(find.byType(TextField), '买菜');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pumpAndSettle();
      expect(find.text('已添加1项'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus,
        isTrue,
      );
      await tester.enterText(find.byType(TextField), '散步');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pumpAndSettle();
      expect(store.records, hasLength(2));
      expect(store.records.every((r) => r.data['category'] == 'life'), isTrue);
      expect(
        store.records[0].data['plannedDate'],
        store.records[1].data['plannedDate'],
      );
      await tester.tap(find.text('完成'));
      await tester.pumpAndSettle();
      expect(find.byType(TodoComposer), findsNothing);
    },
  );

  testWidgets(
    'batch keyboard action inserts newline without saving or losing focus',
    (tester) async {
      final store = MemoryWorkspaceStore();
      await mount(tester, store);
      await tester.tap(find.text('新增待办'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('批量'));
      await tester.enterText(find.byType(TextField), '第一项');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pumpAndSettle();
      expect(store.records, isEmpty);
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller!.text, '第一项\n');
      expect(field.focusNode!.hasFocus, isTrue);
      await tester.enterText(
        find.byType(TextField),
        '${field.controller!.text}第二项',
      );
      await tester.pump();
      await tester.tap(find.text('添加2项'));
      await tester.pumpAndSettle();
      expect(store.records, hasLength(2));
    },
  );

  testWidgets('batch is atomic on failure, preserves draft, and can retry', (
    tester,
  ) async {
    final store = MemoryWorkspaceStore()..failSave = true;
    await mount(tester, store);
    await tester.tap(find.text('新增待办'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('批量'));
    await tester.enterText(find.byType(TextField), '拍摄\n\n剪辑\n发布');
    await tester.pumpAndSettle();
    await tester.tap(find.text('添加3项'));
    await tester.pumpAndSettle();
    expect(store.records, isEmpty);
    expect(find.textContaining('保存失败'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      '拍摄\n\n剪辑\n发布',
    );
    store.failSave = false;
    await tester.tap(find.text('添加3项'));
    await tester.pumpAndSettle();
    expect(store.records.map((r) => r.data['title']), ['拍摄', '剪辑', '发布']);
    expect(find.byType(TodoComposer), findsNothing);
  });

  testWidgets('batch validates every item before creating any task', (
    tester,
  ) async {
    final store = MemoryWorkspaceStore();
    await mount(tester, store);
    await tester.tap(find.text('新增待办'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('批量'));
    await tester.enterText(find.byType(TextField), '可以保存\n${'字' * 301}');
    await tester.pump();
    await tester.tap(find.text('添加2项'));
    await tester.pumpAndSettle();
    expect(store.records, isEmpty);
    expect(find.text('每项待办最多300字'), findsOneWidget);
  });

  for (final dark in [false, true]) {
    testWidgets(
      '360dp keyboard composer ${dark ? 'dark' : 'light'} supports large text and reduced motion',
      (tester) async {
        tester.view.physicalSize = const Size(360, 740);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        tester.view.viewInsets = const FakeViewPadding(bottom: 280);
        addTearDown(tester.view.resetViewInsets);
        tester.platformDispatcher.textScaleFactorTestValue = 1.3;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await mount(tester, MemoryWorkspaceStore(), dark: dark, reduced: true);
        await tester.tap(find.text('新增待办'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('批量'));
        await tester.enterText(find.byType(TextField), '第一项\n第二项');
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('添加2项'));
        await tester.pumpAndSettle();
        expect(tester.getBottomRight(find.text('添加2项')).dy, lessThan(460));
      },
    );
  }
}
