import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/workspace/workspace_shell.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_panel.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'workspace_sync_engine_test.dart' show EngineStore, desktop;

void main() {
  for (final enabled in [false, true]) {
    testWidgets(
      'formal workspace entry preserves explicit consent with sync $enabled',
      (tester) async {
        final store = EngineStore()..enabled = enabled;
        final destination = ValueNotifier(0);
        final shell = GlobalKey<WorkspaceShellState>();
        tester.view.physicalSize = const Size(360, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          destination.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(
            theme: workspaceTheme(Brightness.light),
            home: WorkspaceShell(
              key: shell,
              store: store,
              destination: destination,
              connections: MemoryConnectionStore(desktop),
              active: false,
              captureBuilder: (_) => const Center(child: Text('Capture entry')),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(shell.currentState!.sync!.activeProtocol, 1);
        expect(store.counter, 0);
        expect(store.enabled, enabled);
        for (final index in [0, 1]) {
          destination.value = index;
          await tester.pumpAndSettle();
          await tester.tap(find.byIcon(Icons.sync));
          await tester.pumpAndSettle();
          expect(
            tester
                .widget<WorkspaceSyncPanel>(find.byType(WorkspaceSyncPanel))
                .allowFullUpgrade,
            true,
          );
          final upgrade = find.byKey(const ValueKey('full-upgrade-open'));
          if (enabled) {
            expect(upgrade, findsOneWidget);
            await tester.tap(upgrade);
            await tester.pumpAndSettle();
            expect(find.text('升级完整工作台？'), findsOneWidget);
            expect(find.text('项目目录 · 只读'), findsOneWidget);
            expect(find.text('分类偏好 · 只读'), findsOneWidget);
            expect(shell.currentState!.sync!.activeProtocol, 1);
            expect(store.counter, 0);
            await tester.tap(find.text('取消'));
            await tester.pumpAndSettle();
            expect(upgrade, findsOneWidget);
          } else {
            expect(upgrade, findsNothing);
            expect(find.text('启用同步'), findsOneWidget);
            expect(store.enabled, false);
          }
          Navigator.of(tester.element(find.byType(WorkspaceSyncPanel))).pop();
          await tester.pumpAndSettle();
        }
        destination.value = 2;
        await tester.pumpAndSettle();
        expect(find.text('Capture entry'), findsOneWidget);
        expect(find.byIcon(Icons.sync), findsNothing);
        expect(find.byKey(const ValueKey('full-upgrade-open')), findsNothing);
        expect(store.counter, 0);
        expect(store.enabled, enabled);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
