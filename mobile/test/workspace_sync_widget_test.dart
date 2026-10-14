import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_shell.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_panel.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'workspace_sync_engine_test.dart'
    show EngineStore, EngineEnvironment, EngineClient, desktop;

class ConflictStore extends EngineStore {
  final conflict = <String, dynamic>{
    'kind': 'todo',
    'id': '55555555-5555-4555-8555-555555555555',
    'local': {
      'revision': 3,
      'deleted': false,
      'data': {
        'title': '手机文案',
        'category': 'self_media',
        'plannedDate': null,
        'completedAt': null,
      },
    },
    'remote': {
      'revision': 7,
      'deleted': false,
      'data': {
        'title': '电脑文案',
        'category': 'self_media',
        'plannedDate': null,
        'completedAt': null,
      },
    },
  };
  int? receivedLocal;
  int? receivedRemote;
  bool conflictChanged = false;
  @override
  Future<Map<String, dynamic>> syncStatus() async => {
    ...await super.syncStatus(),
    'conflicts': [conflict],
  };
  @override
  Future<void> resolveSyncConflict(
    String kind,
    String id, {
    required bool keepLocal,
    int? expectedLocalRevision,
    int? expectedRemoteRevision,
  }) async {
    receivedLocal = expectedLocalRevision;
    receivedRemote = expectedRemoteRevision;
    if (conflictChanged) throw const WorkspaceConflict();
  }
}

void main() {
  testWidgets(
    'slow initialization preserves background state and cannot activate sync',
    (tester) async {
      final store = EngineStore()..enabled = true;
      store.readGate = Completer<void>();
      final key = GlobalKey<WorkspaceShellState>();
      final destination = ValueNotifier(0);
      int acquireCalls = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('ly.creator.capture/device_status'),
            (call) async {
              if (call.method == 'acquireLocalWifi') acquireCalls++;
              return null;
            },
          );
      await tester.pumpWidget(
        MaterialApp(
          home: WorkspaceShell(
            key: key,
            store: store,
            destination: destination,
            connections: MemoryConnectionStore(desktop),
            captureBuilder: (_) => const SizedBox(),
          ),
        ),
      );
      key.currentState!.setForeground(false);
      store.readGate!.complete();
      await tester.pumpAndSettle();
      expect(key.currentState!.sync!.active, false);
      expect(acquireCalls, 0);
      await tester.pumpWidget(const SizedBox());
      destination.dispose();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('ly.creator.capture/device_status'),
            null,
          );
    },
  );
  testWidgets(
    'conflict decision carries exactly the versions shown in the dialog',
    (tester) async {
      final store = ConflictStore();
      final controller = WorkspaceController(store);
      await controller.load();
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(desktop),
        client: EngineClient(),
        environment: EngineEnvironment(),
        discover: () async => [],
      );
      await engine.refresh();
      await tester.pumpWidget(
        MaterialApp(
          theme: workspaceTheme(Brightness.light),
          home: Scaffold(
            body: WorkspaceSyncPanel(engine: engine, onConnect: () async {}),
          ),
        ),
      );
      await tester.tap(find.text('手机文案'));
      await tester.pumpAndSettle();
      expect(find.text('选择保留的版本'), findsOneWidget);
      store.conflictChanged = true;
      await tester.tap(find.text('保留手机版'));
      await tester.pumpAndSettle();
      expect(store.receivedLocal, 3);
      expect(store.receivedRemote, 7);
      expect(find.textContaining('记录已被修改'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      engine.dispose();
      controller.dispose();
    },
  );
  testWidgets(
    'paired device requires explicit confirmation before enabling workspace sync',
    (tester) async {
      final store = EngineStore();
      final controller = WorkspaceController(store);
      await controller.load();
      final engine = WorkspaceSyncEngine(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(desktop),
        client: EngineClient(),
        environment: EngineEnvironment(),
        discover: () async => [],
      );
      await engine.refresh();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: WorkspaceSyncPanel(engine: engine, onConnect: () async {}),
          ),
        ),
      );
      expect(store.enabled, false);
      await tester.tap(find.text('启用同步'));
      await tester.pumpAndSettle();
      expect(store.enabled, false);
      expect(find.text('启用工作台同步？'), findsOneWidget);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(store.enabled, false);
      await tester.tap(find.text('启用同步'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('启用同步').last);
      await tester.pumpAndSettle();
      expect(store.enabled, true);
      await tester.pumpWidget(const SizedBox());
      engine.dispose();
      controller.dispose();
    },
  );
}
