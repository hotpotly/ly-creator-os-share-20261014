import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_panel.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_sync_fixture.dart';

void main() {
  testWidgets(
    'pause remains reachable during upgrade and late snapshot cannot activate',
    (tester) async {
      final fixture = (await tester.runAsync(FullSyncFixture.open))!;
      late Completer<void> entered, release;
      await tester.runAsync(() async {
        entered = Completer<void>();
        release = Completer<void>();
      });
      addTearDown(() async {
        if (!release.isCompleted) release.complete();
        await tester.runAsync(fixture.close);
      });
      await tester.runAsync(() async {
        fixture.server.before = (purpose, _) async {
          if (purpose == 'snapshot.start') {
            if (!entered.isCompleted) entered.complete();
            await release.future;
          }
        };
      });
      await tester.pumpWidget(
        MaterialApp(
          theme: workspaceTheme(Brightness.light),
          home: Scaffold(
            body: WorkspaceSyncPanel(
              engine: fixture.engine,
              onConnect: () async {},
              allowFullUpgrade: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => tester.tap(find.byKey(const ValueKey('full-upgrade-open'))),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => tester.tap(find.byKey(const ValueKey('full-upgrade-confirm'))),
      );
      for (var attempt = 0; attempt < 200 && !entered.isCompleted; attempt++) {
        await tester.pump();
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
      }
      expect(
        entered.isCompleted,
        true,
        reason:
            'snapshot未进入：${fixture.engine.error}；${fixture.server.calls.map((call) => call["purpose"]).toList()}',
      );
      await tester.pumpAndSettle();
      expect(fixture.engine.busy, true);
      final pause = find.byKey(const ValueKey('workspace-sync-pause'));
      await tester.ensureVisible(pause);
      expect(tester.widget<TextButton>(pause).onPressed, isNotNull);
      await tester.runAsync(() => tester.tap(pause));
      await tester.pump();
      await tester.runAsync(() async {
        release.complete();
        await fixture.engine.settled;
        await fixture.controller.settled;
      });
      await tester.pumpAndSettle();
      expect(fixture.engine.enabled, false);
      expect(fixture.engine.activeProtocol, 1);
      expect(fixture.engine.upgrading, false);
      expect(fixture.controller.fullActive, false);
      expect(
        fixture.server.calls.any((c) => c['purpose'] == 'snapshot.page'),
        false,
      );
      expect(
        fixture.server.calls.any((c) => c['purpose'] == 'blob.start'),
        false,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
