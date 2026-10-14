import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_snapshot_guard.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';

void main() {
  final fixtures =
      jsonDecode(
            File(
              '../shared-fixtures/workspace-sync-v2.json',
            ).readAsStringSync(),
          )
          as Map;
  Map<String, dynamic> sample(String schema) => Map<String, dynamic>.from(
    (fixtures['cases'] as List).firstWhere(
      (item) => item['schema'] == schema && item['valid'] == true,
    )['value'],
  );
  final now = DateTime.utc(2026, 10, 3);
  late Map<String, dynamic> manifest, request, response;
  late WorkspaceSnapshotCheckpoint initial;
  setUp(() {
    manifest = sample('manifest');
    request = sample('snapshotPageRequest');
    response = sample('snapshotPageResponse');
    initial = beginWorkspaceSnapshot(manifest, now: now);
  });

  WorkspaceSnapshotCheckpoint advance({
    Map<String, dynamic>? m,
    Map<String, dynamic>? req,
    Map<String, dynamic>? res,
    WorkspaceSnapshotCheckpoint? checkpoint,
    DateTime? at,
  }) => advanceWorkspaceSnapshot(
    manifest: m ?? manifest,
    request: req ?? request,
    response: res ?? response,
    checkpoint: checkpoint ?? initial,
    now: at ?? now,
  );

  test(
    'complete and two-page snapshots preserve deterministic checkpoints',
    () {
      final complete = advance();
      expect(complete.finished, true);
      expect(complete.verifiedCount, 2);
      expect(
        WorkspaceSnapshotCheckpoint.fromJson(complete.toJson()).toJson(),
        complete.toJson(),
      );
      final records = response['records'] as List;
      final first = advance(
        req: {...request, 'limit': 1},
        res: {
          ...response,
          'records': [records.first],
          'next': 'page_2',
          'done': false,
        },
      );
      expect(first.verifiedCount, 1);
      expect(first.seenTokens, ['page_2']);
      final last = advance(
        checkpoint: WorkspaceSnapshotCheckpoint.fromJson(first.toJson()),
        req: {...request, 'after': 'page_2'},
        res: {
          ...response,
          'records': [records.last],
        },
      );
      expect(last.finished, true);
      expect(last.verifiedCount, 2);
      expect(() => advance(checkpoint: last), throwsStateError);
    },
  );

  test('empty snapshot still requires an authenticated final page', () {
    final empty = {
      ...manifest,
      'entityCount': 0,
      'through': 0,
      'entriesSha256': workspaceV2Sha256Sync([]),
    };
    final start = beginWorkspaceSnapshot(empty, now: now);
    expect(start.finished, false);
    expect(
      advance(
        m: empty,
        checkpoint: start,
        res: {...response, 'records': []},
      ).finished,
      true,
    );
  });

  test(
    'identity, manifest substitution, expiry and request position fail closed',
    () {
      const other = '77777777-7777-4777-8777-777777777777';
      for (final field in ['workspaceId', 'deviceId', 'manifestId']) {
        expect(
          () => advance(req: {...request, field: other}),
          throwsStateError,
        );
        expect(
          () => advance(res: {...response, field: other}),
          throwsStateError,
        );
      }
      expect(() => advance(m: {...manifest, 'through': 3}), throwsStateError);
      expect(
        () => advance(req: {...request, 'after': 'skip_page'}),
        throwsStateError,
      );
      expect(() => advance(at: DateTime.utc(2026, 10, 4)), throwsStateError);
      expect(
        () => beginWorkspaceSnapshot(manifest, now: DateTime.utc(2026, 10, 4)),
        throwsStateError,
      );
    },
  );

  test(
    'page limits, total counts and finality cannot skip or invent records',
    () {
      expect(() => advance(req: {...request, 'limit': 1}), throwsStateError);
      expect(
        () => advance(
          res: {
            ...response,
            'records': [(response['records'] as List).first],
          },
        ),
        throwsStateError,
      );
      expect(
        () => advance(res: {...response, 'done': false, 'next': 'extra'}),
        throwsStateError,
      );
      expect(
        () => advance(
          res: {
            ...response,
            'records': [
              ...response['records'],
              (response['records'] as List).last,
            ],
          },
        ),
        throwsStateError,
      );
    },
  );

  test(
    'kind/id order, duplicate records and sequence outside manifest rejected',
    () {
      final records = response['records'] as List;
      expect(
        () => advance(res: {...response, 'records': records.reversed.toList()}),
        throwsStateError,
      );
      expect(
        () => advance(
          res: {
            ...response,
            'records': [records.first, records.first],
          },
        ),
        throwsStateError,
      );
      expect(
        () => advance(
          res: {
            ...response,
            'records': [
              records.first,
              {...records.last, 'sequence': 3},
            ],
          },
        ),
        throwsStateError,
      );
      final first = advance(
        res: {
          ...response,
          'records': [records.first],
          'next': 'next_page',
          'done': false,
        },
      );
      expect(
        () => advance(
          checkpoint: first,
          req: {...request, 'after': 'next_page'},
          res: {
            ...response,
            'records': [records.first],
          },
        ),
        throwsStateError,
      );
    },
  );

  test('unauthorized scopes and cyclic tokens cannot progress', () {
    final narrowed = {
      ...manifest,
      'scopes': ['todo.full'],
      'scopeDigest': workspaceV2ScopeDigest(['todo.full']),
    };
    expect(
      () => advance(
        m: narrowed,
        checkpoint: beginWorkspaceSnapshot(narrowed, now: now),
      ),
      throwsStateError,
    );
    final record = (response['records'] as List).first as Map;
    final larger = {...manifest, 'entityCount': 4};
    final first = advance(
      m: larger,
      checkpoint: beginWorkspaceSnapshot(larger, now: now),
      res: {
        ...response,
        'records': [record],
        'done': false,
        'next': 'next_page',
      },
    );
    expect(
      () => advance(
        m: larger,
        checkpoint: first,
        req: {...request, 'after': 'next_page'},
        res: {
          ...response,
          'records': [
            {...record, 'id': '55555555-5555-4555-8555-555555555555'},
          ],
          'done': false,
          'next': 'next_page',
        },
      ),
      throwsStateError,
    );
  });

  test('corrupt persisted checkpoints are rejected rather than reset', () {
    for (final patch in [
      {'verifiedCount': -1},
      {'verifiedCount': 1},
      {'manifestHash': 'no'},
      {'nextToken': 'unseen'},
      {
        'seenTokens': ['duplicate', 'duplicate'],
      },
      {'finished': true, 'nextToken': 'next'},
      {'extra': true},
    ]) {
      expect(
        () => WorkspaceSnapshotCheckpoint.fromJson({
          ...initial.toJson(),
          ...patch,
        }),
        throwsFormatException,
      );
    }
  });
}
