import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/storage/connection_store.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_engine.dart';
import 'package:ly_creator_capture/src/workspace/full_sync_dialogs.dart';
import 'package:ly_creator_capture/src/workspace/workspace_controller.dart';
import 'package:ly_creator_capture/src/workspace/workspace_full_models.dart';
import 'package:ly_creator_capture/src/workspace/workspace_sync_panel.dart';
import 'package:ly_creator_capture/src/workspace/workspace_theme.dart';
import 'full_todo_commands_test.dart' show fullRecord, todoBody;
import 'workspace_sync_engine_test.dart' show EngineStore;

class DialogEngine extends WorkspaceSyncEngine {
  DialogEngine(EngineStore store, WorkspaceController controller)
    : super(
        store: store,
        controller: controller,
        connections: MemoryConnectionStore(null),
      );
  final calls = <Map<String, dynamic>>[];
  Completer<void>? gate;
  bool fail = true;
  @override
  Future<void> discardBlocked(
    String kind,
    String id, {
    required int expectedLocalRevision,
    required String expectedOperationId,
    required int expectedRemoteRevision,
  }) async {
    calls.add({
      'action': 'discard',
      'kind': kind,
      'id': id,
      'localRevision': expectedLocalRevision,
      'operationId': expectedOperationId,
      'remoteRevision': expectedRemoteRevision,
    });
    await gate?.future;
    if (fail) throw StateError('版本已改变');
  }

  @override
  Future<void> resolve(
    String kind,
    String id, {
    required bool keepLocal,
    int? expectedLocalRevision,
    int? expectedRemoteRevision,
  }) async {
    calls.add({
      'kind': kind,
      'id': id,
      'keepLocal': keepLocal,
      'localRevision': expectedLocalRevision,
      'remoteRevision': expectedRemoteRevision,
    });
    await gate?.future;
    if (fail) throw StateError('版本已改变');
  }
}

Map<String, dynamic> conflict(
  WorkspaceFullRecord record, {
  String? localJson,
  String? remoteJson,
  bool remoteDeleted = false,
}) => {
  'kind': record.kind,
  'id': record.id,
  'localRevision': 7,
  'remoteRevision': 11,
  'local': {
    'json': localJson ?? record.rawJson,
    'deleted': record.deleted,
    'localRevision': 900,
  },
  'remote': {
    'json': remoteJson ?? record.rawJson,
    'record': {
      'kind': record.kind,
      'id': record.id,
      'revision': 901,
      'deleted': remoteDeleted,
      'metadata': {'source': 'manual'},
    },
  },
};

void main() {
  test('upgrade gate defaults closed with exact ordered fixed scopes', () {
    final store = EngineStore(),
        controller = WorkspaceController(EngineStore());
    final engine = DialogEngine(store, controller);
    expect(
      WorkspaceSyncPanel(
        engine: engine,
        onConnect: () async {},
      ).allowFullUpgrade,
      false,
    );
    expect(fullWorkspaceUpgradeScopes, [
      'preferences.todo',
      'project.catalog',
      'todo.full',
      'work_log',
    ]);
    engine.dispose();
    controller.dispose();
  });
  test(
    'conflict freezes original raw strings and captures top-level revisions',
    () {
      final record = fullRecord(todoBody());
      const original = '{ "unsafe": 9007199254740993, "decimal": 1e2 }';
      final value = conflict(record, localJson: original);
      final snapshot = FullSyncConflict(value);
      (value['local'] as Map)['json'] = '{}';
      expect(snapshot.localJson, original);
      expect(snapshot.localRevision, 7);
      expect(snapshot.remoteRevision, 11);
      expect(snapshot.canKeepLocal(record), false);
    },
  );
  test('only interpretable and authorized manual records can keep local', () {
    final body = todoBody();
    final record = fullRecord(body);
    final snapshot = FullSyncConflict(conflict(record));
    expect(snapshot.canKeepLocal(record), true);
    expect(snapshot.canKeepLocal(fullRecord(body, write: false)), false);
    final unknown = FullSyncConflict(
      conflict(record, remoteJson: jsonEncode({...body, 'future': true})),
    );
    expect(unknown.canKeepLocal(record), false);
    final schedule = fullRecord({...body, 'source': 'schedule'});
    expect(FullSyncConflict(conflict(schedule)).canKeepLocal(schedule), false);
  });
  test(
    'desktop deletion uses explicit copy label only for safe create candidate',
    () {
      final record = fullRecord(todoBody());
      final snapshot = FullSyncConflict(conflict(record, remoteDeleted: true));
      expect(snapshot.createsCopy, true);
      expect(snapshot.canKeepLocal(record), false);
      expect(snapshot.canKeepLocal(record, canCreateTodo: true), true);
      final readOnly = fullRecord(record.body, write: false);
      expect(snapshot.canKeepLocal(readOnly), false);
      expect(snapshot.canKeepLocal(readOnly, canCreateTodo: true), true);
      final history = fullRecord({...todoBody(), 'title': '字' * 301});
      expect(
        FullSyncConflict(
          conflict(history, remoteDeleted: true),
        ).canKeepLocal(history, canCreateTodo: true),
        false,
      );
    },
  );
  test('terminal error names are distinct from merge conflicts', () {
    expect(fullSyncBlockedReason('project_unavailable'), '关联项目当前不可用');
    expect(fullSyncBlockedReason('stage_unavailable'), '关联阶段当前不可用');
    expect(fullSyncBlockedReason('record_read_only'), '此记录当前只读');
    expect(fullSyncBlockedReason('invalid_change'), '此项修改未被电脑接受');
  });
  testWidgets(
    'failed conflict resolution keeps exact two versions and blocks duplicate submission',
    (tester) async {
      final store = EngineStore(),
          controller = WorkspaceController(EngineStore());
      final record = fullRecord(todoBody());
      controller.fullRecords = [record];
      final engine = DialogEngine(store, controller)..gate = Completer<void>();
      addTearDown(() {
        engine.dispose();
        controller.dispose();
      });
      final value = conflict(record);
      await tester.pumpWidget(
        MaterialApp(
          theme: workspaceTheme(Brightness.light),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) => FullWorkspaceConflictDialog(
                    engine: engine,
                    conflict: value,
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
      final button = find.byKey(const ValueKey('full-conflict-keep-remote'));
      final callback = tester.widget<TextButton>(button).onPressed!;
      callback();
      callback();
      await tester.pump();
      expect(engine.calls, hasLength(1));
      expect(tester.widget<TextButton>(button).onPressed, null);
      engine.gate!.complete();
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('full-conflict-error')), findsOneWidget);
      expect(
        tester
            .widget<SelectableText>(
              find.byKey(const ValueKey('full-conflict-local-json')),
            )
            .data,
        value['local']['json'],
      );
      expect(
        tester
            .widget<SelectableText>(
              find.byKey(const ValueKey('full-conflict-remote-json')),
            )
            .data,
        value['remote']['json'],
      );
      expect(engine.calls.single['localRevision'], 7);
      expect(engine.calls.single['remoteRevision'], 11);
      engine.fail = false;
      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(find.byType(FullWorkspaceConflictDialog), findsNothing);
      expect(engine.calls, hasLength(2));
      expect(tester.takeException(), isNull);
    },
  );
  test(
    'blocked preview freezes current raw and all three decision versions',
    () {
      final value = <String, dynamic>{
        'kind': 'todo',
        'id': 'id',
        'expectedLocalRevision': 8,
        'expectedOperationId': 'original-op',
        'expectedRemoteRevision': 12,
        'code': 'record_read_only',
        'local': {'json': ' { "number":9007199254740993 } ', 'deleted': true},
        'remote': {
          'record': {'deleted': false},
          'json': '{"baseline":1e2}',
        },
      };
      final snapshot = FullSyncBlockedPreview(value);
      value['expectedLocalRevision'] = 10;
      (value['local'] as Map)['json'] = '{}';
      expect(snapshot.localRevision, 8);
      expect(snapshot.operationId, 'original-op');
      expect(snapshot.remoteRevision, 12);
      expect(snapshot.localJson, ' { "number":9007199254740993 } ');
      expect(snapshot.localDeleted, true);
      expect(snapshot.remoteJson, '{"baseline":1e2}');
      expect(snapshot.remoteDeleted, false);
    },
  );
  testWidgets(
    'blocked discard confirmation keeps current raw on failed CAS and submits once',
    (tester) async {
      final store = EngineStore(),
          controller = WorkspaceController(EngineStore());
      final engine = DialogEngine(store, controller)..gate = Completer<void>();
      addTearDown(() {
        engine.dispose();
        controller.dispose();
      });
      const raw = '{"latestDraft":9007199254740993}';
      final preview = <String, dynamic>{
        'kind': 'todo',
        'id': 'id',
        'expectedLocalRevision': 8,
        'expectedOperationId': 'op',
        'expectedRemoteRevision': 0,
        'code': 'record_read_only',
        'local': {'json': raw, 'deleted': false},
        'remote': null,
      };
      await tester.pumpWidget(
        MaterialApp(
          theme: workspaceTheme(Brightness.dark),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) => FullWorkspaceDiscardBlockedDialog(
                    engine: engine,
                    preview: preview,
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
      expect(find.text('电脑尚无记录'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('full-blocked-remote-json')),
        findsNothing,
      );
      final button = find.byKey(const ValueKey('full-blocked-discard-confirm'));
      final callback = tester.widget<FilledButton>(button).onPressed!;
      preview['expectedLocalRevision'] = 10;
      callback();
      callback();
      await tester.pump();
      expect(engine.calls, hasLength(1));
      expect(tester.widget<FilledButton>(button).onPressed, null);
      engine.gate!.complete();
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('full-blocked-discard-error')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<SelectableText>(
              find.byKey(const ValueKey('full-blocked-local-json')),
            )
            .data,
        raw,
      );
      expect(engine.calls.single['localRevision'], 8);
      expect(engine.calls.single['operationId'], 'op');
      expect(engine.calls.single['remoteRevision'], 0);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(find.byType(FullWorkspaceDiscardBlockedDialog), findsNothing);
      expect(engine.calls, hasLength(1));
      expect(tester.takeException(), isNull);
    },
  );
}
