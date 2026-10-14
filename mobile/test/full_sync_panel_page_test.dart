import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_driver.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_panel.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'support/full_sync_fixture.dart';
import 'workspace_test.dart' show todo;

void main() {
  late FullSyncFixture fixture;
  Finder key(String value) => find.byKey(ValueKey(value));
  Future<void> open(
    WidgetTester tester, {
    bool full = false,
    bool allow = true,
    int budget = 256,
    WorkspaceRecord? oldTodo,
    bool legacyConflict = false,
    bool dark = false,
    double scale = 1,
  }) async {
    fixture = (await tester.runAsync(
      () => FullSyncFixture.open(
        full: full,
        budget: budget,
        oldTodo: oldTodo,
        legacyConflict: legacyConflict,
      ),
    ))!;
    addTearDown(() => tester.runAsync(fixture.close));
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: workspaceTheme(dark ? Brightness.dark : Brightness.light),
        builder: (context, child) => MediaQuery(
          data: MediaQueryData(
            size: const Size(360, 800),
            textScaler: TextScaler.linear(scale),
          ),
          child: child!,
        ),
        home: Scaffold(
          body: WorkspaceSyncPanel(
            engine: fixture.engine,
            onConnect: () async {},
            allowFullUpgrade: allow,
          ),
        ),
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
      await fixture.engine.settled;
    });
    await tester.pumpAndSettle();
  }

  Future<void> waitFor(WidgetTester tester, Finder finder) async {
    for (
      var attempt = 0;
      attempt < 100 && finder.evaluate().isEmpty;
      attempt++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pumpAndSettle();
    }
    expect(finder, findsOneWidget);
  }

  Future<String> conflict(WidgetTester tester, {bool deleted = false}) async {
    final id = workspaceId();
    await tester.runAsync(() async {
      await fixture.addFull(id);
      await fixture.conflict(id, deleted: deleted);
    });
    expect(fixture.engine.conflicts, hasLength(1));
    await tester.pumpAndSettle();
    return id;
  }

  testWidgets('release gate keeps explicit full upgrade unavailable', (
    tester,
  ) async {
    await open(tester, allow: false);
    expect(key('full-upgrade-open'), findsNothing);
    expect(fixture.engine.activeProtocol, 1);
    expect(fixture.server.calls, isEmpty);
  });

  testWidgets(
    'full upgrade consent drains old pending operations and approves only four scopes',
    (tester) async {
      final existing = todo();
      await open(tester, oldTodo: existing);
      await tap(tester, key('full-upgrade-open'));
      expect(fixture.engine.activeProtocol, 1);
      expect(fixture.server.calls, isEmpty);
      expect(
        (await tester.runAsync(fixture.store.syncStatus))!['pendingCount'],
        1,
      );
      await tap(tester, key('full-upgrade-confirm'));
      expect(fixture.engine.activeProtocol, 2);
      expect(
        fixture.engine.status['scopes'],
        WorkspaceV2Driver.supportedScopes,
      );
      expect(
        fixture.controller.findFull('todo', existing.id)!.body['title'],
        existing.data['title'],
      );
      expect(
        (await tester.runAsync(fixture.store.syncStatus))!['pendingCount'],
        0,
      );
      expect(key('full-upgrade-open'), findsNothing);
      expect(
        fixture.legacy.calls.any((c) => (c['operations'] as List).isNotEmpty),
        true,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unresolved legacy conflict prevents full activation and preserves original task',
    (tester) async {
      final existing = todo();
      await open(tester, oldTodo: existing, legacyConflict: true);
      await tap(tester, key('full-upgrade-open'));
      await tap(tester, key('full-upgrade-confirm'));
      expect(fixture.engine.activeProtocol, 1);
      expect(fixture.engine.conflicts, hasLength(1));
      expect(
        fixture.controller.find('todo', existing.id)!.data['title'],
        existing.data['title'],
      );
      expect(fixture.server.calls, isEmpty);
    },
  );

  testWidgets('staged upgrade can be cancelled locally while disconnected', (
    tester,
  ) async {
    await open(tester, budget: 2);
    await tap(tester, key('full-upgrade-open'));
    await tap(tester, key('full-upgrade-confirm'));
    expect(fixture.engine.activeProtocol, 1);
    expect(fixture.engine.upgrading, true);
    await tester.runAsync(() async {
      await fixture.connections.clear();
      await fixture.engine.refresh();
    });
    await tester.pumpAndSettle();
    final requestCount = fixture.server.calls.length;
    await tap(tester, key('full-upgrade-cancel'));
    final confirms = find.widgetWithText(FilledButton, '取消升级');
    if (confirms.evaluate().isNotEmpty) await tap(tester, confirms.last);
    expect(fixture.engine.upgrading, false);
    expect(fixture.engine.activeProtocol, 1);
    expect(fixture.server.calls.length, requestCount);
  });

  testWidgets(
    'full conflict shows exact two raw records and retains them after stale CAS fails',
    (tester) async {
      await open(tester, full: true);
      final id = await conflict(tester);
      final opened = fixture.engine.conflicts.single;
      await tap(tester, key('full-conflict-todo-$id'));
      expect(
        tester.widget<SelectableText>(key('full-conflict-local-json')).data,
        opened['local']['json'],
      );
      expect(
        tester.widget<SelectableText>(key('full-conflict-remote-json')).data,
        opened['remote']['json'],
      );
      await tester.runAsync(() => fixture.changeRemote(id));
      await tester.pumpAndSettle();
      await tap(tester, key('full-conflict-keep-remote'));
      expect(key('full-conflict-error'), findsOneWidget);
      expect(key('full-conflict-local-json'), findsOneWidget);
      expect(
        fixture.controller.findFull('todo', id)!.body['title'],
        'Phone draft',
      );
      expect(fixture.engine.conflicts, hasLength(1));
    },
  );

  testWidgets(
    'full conflict choosing desktop is a single explicit versioned decision',
    (tester) async {
      await open(tester, full: true, dark: true, scale: 1.8);
      final id = await conflict(tester);
      await tap(tester, key('full-conflict-todo-$id'));
      expect(tester.takeException(), isNull);
      await tap(tester, key('full-conflict-keep-remote'));
      expect(fixture.engine.conflicts, isEmpty);
      expect(
        fixture.controller.findFull('todo', id)!.body['title'],
        'Desktop revision',
      );
      expect(key('full-conflict-local-json'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'terminal rejection is separate from conflicts and unchanged sync never resubmits it',
    (tester) async {
      await open(tester, full: true);
      final id = workspaceId();
      await tester.runAsync(() async {
        await fixture.addFull(id);
        await fixture.reject(id);
      });
      await tester.pumpAndSettle();
      expect(fixture.engine.conflicts, isEmpty);
      expect(fixture.engine.blocked, hasLength(1));
      expect(key('full-blocked-todo-$id'), findsOneWidget);
      expect(key('full-conflict-todo-$id'), findsNothing);
      final before = fixture.server.calls.length;
      await tester.runAsync(() async {
        fixture.engine.requestSync();
        await fixture.engine.settled;
      });
      final syncs = fixture.server.calls
          .skip(before)
          .where((call) => call['purpose'] == 'sync');
      expect(
        syncs.every(
          (call) => ((call['payload'] as Map)['operations'] as List).isEmpty,
        ),
        true,
      );
      expect(
        fixture.controller.findFull('todo', id)!.body['title'],
        'Rejected draft',
      );
      expect(fixture.engine.label, isNot('已同步'));
    },
  );
  testWidgets(
    'blocked discard previews current raw records and works offline without upload',
    (tester) async {
      await open(tester, full: true);
      final id = workspaceId();
      await tester.runAsync(() async {
        await fixture.addFull(id);
        await fixture.reject(id);
        await fixture.connections.clear();
        await fixture.engine.refresh();
      });
      await tester.pumpAndSettle();
      final local = fixture.controller.findFull('todo', id)!;
      final requestCount = fixture.server.calls.length;
      await tap(tester, key('full-blocked-todo-$id'));
      await tap(tester, key('full-blocked-discard-open'));
      await waitFor(tester, key('full-blocked-local-json'));
      expect(
        tester.widget<SelectableText>(key('full-blocked-local-json')).data,
        local.rawJson,
      );
      expect(key('full-blocked-remote-json'), findsOneWidget);
      await tap(tester, key('full-blocked-discard-confirm'));
      expect(fixture.engine.blocked, isEmpty);
      expect(
        fixture.controller.findFull('todo', id)!.body['title'],
        'original',
      );
      expect(
        fixture.controller.findFull('todo', id)!.revision,
        greaterThan(local.revision),
      );
      expect(fixture.server.calls.length, requestCount);
      expect(fixture.engine.pending, 0);
    },
  );

  testWidgets(
    'blocked discard refuses an obsolete preview and keeps the newer draft',
    (tester) async {
      await open(tester, full: true);
      final id = workspaceId();
      await tester.runAsync(() async {
        await fixture.addFull(id);
        await fixture.reject(id);
      });
      await tester.pumpAndSettle();
      await tap(tester, key('full-blocked-todo-$id'));
      await tap(tester, key('full-blocked-discard-open'));
      await waitFor(tester, key('full-blocked-local-json'));
      await tester.runAsync(() => fixture.edit(id, 'Corrected newer draft'));
      await tester.pumpAndSettle();
      await tap(tester, key('full-blocked-discard-confirm'));
      expect(key('full-blocked-discard-error'), findsOneWidget);
      expect(key('full-blocked-local-json'), findsOneWidget);
      expect(
        fixture.controller.findFull('todo', id)!.body['title'],
        'Corrected newer draft',
      );
      expect(fixture.engine.pending, 1);
    },
  );

  testWidgets(
    'rejected deletion can return to the cached desktop version without reviving the remote',
    (tester) async {
      await open(tester, full: true);
      final id = workspaceId();
      await tester.runAsync(() async {
        await fixture.addFull(id);
        await fixture.reject(id, deleted: true);
      });
      await tester.pumpAndSettle();
      expect(fixture.controller.findFull('todo', id), isNull);
      await tap(tester, key('full-blocked-todo-$id'));
      expect(key('full-blocked-edit'), findsNothing);
      await tap(tester, key('full-blocked-discard-open'));
      await waitFor(tester, key('full-blocked-local-json'));
      fixture.controller.onLocalChanged = fixture.engine.localChanged;
      final requests = fixture.server.calls.length;
      await tap(tester, key('full-blocked-discard-confirm'));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 650));
        await fixture.engine.settled;
      });
      expect(fixture.engine.blocked, isEmpty);
      expect(
        fixture.controller.findFull('todo', id)!.body['title'],
        'original',
      );
      expect(fixture.server.records[id]!['deleted'], false);
      expect(fixture.server.calls.length, requests);
    },
  );

  testWidgets(
    'discarding a rejected new task removes only the local active copy',
    (tester) async {
      await open(tester, full: true);
      final id = workspaceId();
      await tester.runAsync(() => fixture.reject(id, create: true));
      await tester.pumpAndSettle();
      await tap(tester, key('full-blocked-todo-$id'));
      await tap(tester, key('full-blocked-discard-open'));
      await waitFor(tester, key('full-blocked-local-json'));
      expect(key('full-blocked-local-json'), findsOneWidget);
      expect(key('full-blocked-remote-json'), findsNothing);
      final requests = fixture.server.calls.length;
      await tap(tester, key('full-blocked-discard-confirm'));
      expect(
        fixture.controller.findFull('todo', id, includeDeleted: true),
        isNull,
      );
      expect(fixture.server.records.containsKey(id), false);
      expect(fixture.engine.blocked, isEmpty);
      expect(fixture.engine.pending, 0);
      expect(fixture.server.calls.length, requests);
    },
  );
}
