import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ly_creator_capture/src/app.dart';
import 'package:ly_creator_capture/src/storage/capture_store.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_shell.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'workspace_test.dart' show MemoryWorkspaceStore;
import 'capture_queue_test.dart' show MemoryAttachmentIntake;
import 'stage_c_library_test.dart' show FakeMaintenance;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'root app switches normal tabs through navigator privacy wrapper',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'mobile_setup_complete_v1': true,
      });
      await tester.pumpWidget(
        CreatorCaptureApp(
          captureStore: MemoryCaptureStore(),
          connectionStore: MemoryConnectionStore(),
          attachmentIntake: MemoryAttachmentIntake([]),
          maintenance: FakeMaintenance(),
          workspaceStore: MemoryWorkspaceStore(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('计划与复盘').last);
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      expect(find.text('周目标草稿'), findsOneWidget);
      await tester.tap(find.text('灵感采集').last);
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        2,
      );
      expect(find.text('周目标草稿'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
  setUp(() {
    SharedPreferences.setMockInitialValues({'mobile_setup_complete_v1': true});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('ly.creator.capture/recording'),
          (_) async => {'state': 'idle', 'durationMs': 0, 'markersMs': []},
        );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('ly.creator.capture/network'),
          (_) async => null,
        );
  });
  testWidgets(
    'three destinations separate capture, task and review; drafts persist on tab switches',
    (tester) async {
      final store = MemoryWorkspaceStore();
      final destination = ValueNotifier(0);
      await tester.pumpWidget(
        MaterialApp(
          theme: workspaceTheme(Brightness.light),
          home: WorkspaceShell(
            store: store,
            destination: destination,
            captureBuilder: (_) => const Center(child: Text('独立采集表单')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('暂无待办'), findsOneWidget);
      expect(find.text('独立采集表单'), findsNothing);
      await tester.tap(find.text('新增待办'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '手机测试待办');
      await tester.tap(find.text('保存'));
      await tester.pumpAndSettle();
      expect(store.records.single.kind, 'todo');
      expect(find.text('手机测试待办'), findsOneWidget);
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();
      expect(store.records.single.data['completedAt'], isNotNull);
      await tester.tap(find.text('计划与复盘').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '本周拍完视频');
      await tester.tap(find.text('灵感采集').last);
      await tester.pumpAndSettle();
      expect(find.text('独立采集表单'), findsOneWidget);
      expect(store.records.where((r) => r.kind == 'todo'), hasLength(1));
      await tester.tap(find.text('计划与复盘').last);
      await tester.pumpAndSettle();
      expect(find.text('本周拍完视频'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(
        store.records
            .where((r) => r.kind == 'review_draft')
            .single
            .data['goalsText'],
        '本周拍完视频',
      );
      await tester.pumpWidget(const SizedBox());
      destination.dispose();
    },
  );
  testWidgets('failed todo save keeps editor text and creates no entity', (
    tester,
  ) async {
    final store = MemoryWorkspaceStore()..failSave = true;
    final destination = ValueNotifier(0);
    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceShell(
          store: store,
          destination: destination,
          captureBuilder: (_) => const SizedBox(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('新增待办'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '不要丢失');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();
    expect(find.text('不要丢失'), findsOneWidget);
    expect(store.records, isEmpty);
    expect(find.textContaining('保存失败'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    destination.dispose();
  });
  testWidgets(
    'cold lock hides all workspace data and defers quick actions until authentication',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'mobile_setup_complete_v1': true,
        'history_lock_enabled_v1': true,
      });
      final maintenance = FakeMaintenance();
      final store = MemoryWorkspaceStore();
      await tester.pumpWidget(
        CreatorCaptureApp(
          captureStore: MemoryCaptureStore(),
          connectionStore: MemoryConnectionStore(),
          attachmentIntake: MemoryAttachmentIntake([]),
          maintenance: maintenance,
          workspaceStore: store,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('解锁'), findsOneWidget);
      expect(find.text('新增待办'), findsNothing);
      maintenance.quickActionHandler?.call('text');
      await tester.pumpAndSettle();
      expect(find.text('解锁'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      await tester.tap(find.text('解锁'));
      await tester.pumpAndSettle();
      expect(find.text('解锁'), findsNothing);
      final nav = tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(nav.selectedIndex, 2);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'hot quick action waits for task dialog instead of writing behind it',
    (tester) async {
      final maintenance = FakeMaintenance();
      await tester.pumpWidget(
        CreatorCaptureApp(
          captureStore: MemoryCaptureStore(),
          connectionStore: MemoryConnectionStore(),
          attachmentIntake: MemoryAttachmentIntake([]),
          maintenance: maintenance,
          workspaceStore: MemoryWorkspaceStore(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('新增待办'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '仍在编辑');
      maintenance.quickActionHandler?.call('text');
      await tester.pumpAndSettle();
      expect(find.text('仍在编辑'), findsOneWidget);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        0,
      );
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        2,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('privacy timeout masks navigator without destroying task draft', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      'mobile_setup_complete_v1': true,
      'history_lock_enabled_v1': true,
      'history_lock_minutes_v1': 1,
    });
    var now = DateTime(2026, 10, 3, 12);
    await tester.pumpWidget(
      CreatorCaptureApp(
        captureStore: MemoryCaptureStore(),
        connectionStore: MemoryConnectionStore(),
        attachmentIntake: MemoryAttachmentIntake([]),
        maintenance: FakeMaintenance(),
        workspaceStore: MemoryWorkspaceStore(),
        now: () => now,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('解锁'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('新增待办'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '锁定后保留的草稿');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    now = now.add(const Duration(minutes: 2));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('解锁'), findsOneWidget);
    expect(find.text('锁定后保留的草稿'), findsNothing);
    await tester.tap(find.text('解锁'));
    await tester.pumpAndSettle();
    expect(find.text('锁定后保留的草稿'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('360dp dark theme has no overflow', (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final destination = ValueNotifier(1);
    await tester.pumpWidget(
      MaterialApp(
        theme: workspaceTheme(Brightness.dark),
        home: WorkspaceShell(
          store: MemoryWorkspaceStore(),
          destination: destination,
          captureBuilder: (_) => const SizedBox(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    destination.dispose();
  });
}
