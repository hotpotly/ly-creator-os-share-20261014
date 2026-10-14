import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_scope_extension_guard.dart';
import 'package:ly_creator_capture/src/workspace/workspace_snapshot_guard.dart';
import 'package:ly_creator_capture/src/workspace/workspace_upgrade_guard.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';

Map<String, dynamic> clone(Object? value) =>
    workspaceV2Map(jsonDecode(jsonEncode(value)));

void main() {
  final fixtures =
      jsonDecode(
            File(
              '../shared-fixtures/workspace-scope-extension.json',
            ).readAsStringSync(),
          )
          as Map;
  final cases = fixtures['cases'] as List;
  Map<String, dynamic> sample(String name) =>
      clone(cases.firstWhere((value) => value['name'] == name)['value']);
  for (final testCase in cases) {
    test('shared ${testCase['name']}', () {
      void verify() => workspaceScopeExtensionValidate(
        testCase['schema'] as String,
        testCase['value'],
      );
      expect(
        verify,
        testCase['valid'] == true ? returnsNormally : throwsA(anything),
      );
    });
  }

  final now = DateTime.utc(2026, 10, 3, 10);
  late Map<String, dynamic> barrier, readiness, proof;
  void rebuildSnapshot() {
    final records = (proof['records'] as List).map(workspaceV2Map).toList();
    final manifest = workspaceV2Map(proof['manifest']);
    manifest['entityCount'] = records.length;
    manifest['entriesSha256'] = workspaceV2ManifestDigest(records);
    proof['manifest'] = manifest;
    final request = workspaceV2Map(proof['terminalRequest']);
    request['after'] = null;
    proof['terminalRequest'] = request;
    final response = workspaceV2Map(proof['verifiedTerminalResponse']);
    response['records'] = records;
    proof['verifiedTerminalResponse'] = response;
    proof['replayedTerminalResponse'] = clone(response);
    proof['checkpoint'] = advanceWorkspaceSnapshot(
      manifest: manifest,
      request: request,
      response: response,
      checkpoint: beginWorkspaceSnapshot(manifest, now: now),
      now: now,
    ).toJson();
    barrier['baselinesHash'] = workspaceV2ManifestDigest(
      (proof['oldRecords'] as List).map(workspaceV2Map).toList(),
    );
  }

  setUp(() {
    final snapshot = sample('snapshot.complete');
    final caps = sample('caps.exact');
    final terminal = sample('terminal.complete');
    barrier = {
      'mode': 'scope_extension',
      'sourceProtocol': 2,
      'stageId': '77777777-7777-4777-8777-777777777777',
      'workspaceId': snapshot['workspaceId'],
      'deviceId': snapshot['deviceId'],
      'sourceScopes': snapshot['sourceScopes'],
      'targetScopes': snapshot['targetScopes'],
      'sourceScopeDigest': workspaceV2ScopeDigest(
        (snapshot['sourceScopes'] as List).cast<String>(),
      ),
      'targetScopeDigest': workspaceV2ScopeDigest(
        (snapshot['targetScopes'] as List).cast<String>(),
      ),
      'scopeEpoch': 3,
      'localMutationEpoch': 12,
      'localRecordsHash': 'a' * 64,
      'baselinesHash': workspaceV2ManifestDigest(
        (snapshot['oldRecords'] as List).map(workspaceV2Map).toList(),
      ),
      'cursor': 2,
      'knownSequence': 2,
      'permissionEpoch': 4,
      'sourcePermissionsDigest': workspaceScopeExtensionDigest(
        caps['sourcePermissions'],
      ),
      'targetPermissionsDigest': workspaceScopeExtensionDigest(
        (caps['response'] as Map)['permissions'],
      ),
      'createdAt': now
          .subtract(const Duration(minutes: 1))
          .millisecondsSinceEpoch,
    };
    readiness = {
      'activeProtocol': 2,
      'enabled': true,
      'suspended': false,
      'pendingCount': 0,
      'inflightCount': 0,
      'conflictCount': 0,
      'blockedCount': 0,
      'responseId': null,
      'permissionStageId': null,
      'permissionRequired': false,
      'permissionBlockedReason': null,
      'through': null,
      'cursor': 2,
      'knownSequence': 2,
    };
    proof = {
      'origin': {
        for (final key in [
          'stageId',
          'scopeEpoch',
          'permissionEpoch',
          'targetScopeDigest',
        ])
          key: barrier[key],
      },
      'capabilitiesRequest': caps['request'],
      'initialCapabilities': caps['response'],
      'finalCapabilities': clone(caps['response']),
      'sourcePermissions': caps['sourcePermissions'],
      'approvedPermissions': caps['approvedPermissions'],
      'manifest': snapshot['manifest'],
      'oldRecords': snapshot['oldRecords'],
      'records': snapshot['records'],
      'checkpoint': <String, dynamic>{},
      'documents': <dynamic>[],
      'terminalRequest': terminal['request'],
      'verifiedTerminalResponse': terminal['verifiedResponse'],
      'replayedTerminalResponse': terminal['response'],
    };
    rebuildSnapshot();
  });
  void verify({Map<String, dynamic>? current, DateTime? at}) =>
      verifyWorkspaceScopeExtensionActivation(
        frozen: WorkspaceScopeExtensionBarrier.fromJson(barrier),
        current: WorkspaceScopeExtensionBarrier.fromJson(current ?? barrier),
        readiness: readiness,
        proof: proof,
        now: at ?? now,
      );

  test('drained cursor cannot exceed or trail known history', () {
    for (final cursor in [1, 3]) {
      expect(
        () => WorkspaceScopeExtensionBarrier.fromJson({
          ...barrier,
          'cursor': cursor,
        }),
        throwsA(anything),
      );
      expect(
        () => workspaceScopeExtensionReady({...readiness, 'cursor': cursor}),
        throwsA(anything),
      );
    }
  });
  test('snapshot metadata cannot grant write beyond final capabilities', () {
    (proof['sourcePermissions'] as List)[0]['write'] = false;
    for (final key in ['initialCapabilities', 'finalCapabilities']) {
      (proof[key] as Map)['permissions'][2]['write'] = false;
    }
    barrier['sourcePermissionsDigest'] = workspaceScopeExtensionDigest(
      proof['sourcePermissions'],
    );
    barrier['targetPermissionsDigest'] = workspaceScopeExtensionDigest(
      (proof['finalCapabilities'] as Map)['permissions'],
    );
    expect(verify, throwsA(anything));
    (proof['records'] as List)[1]['metadata'].addAll({
      'write': false,
      'deletable': false,
      'editableFields': [],
    });
    rebuildSnapshot();
    verify();
  });
  test('v2 barrier roundtrips independently and never changes v1 parser', () {
    final frozen = WorkspaceScopeExtensionBarrier.fromJson(barrier);
    expect(frozen.toJson(), barrier);
    final copy = frozen.toJson();
    (copy['targetScopes'] as List).clear();
    expect(frozen.toJson(), barrier);
    expect(() => WorkspaceUpgradeBarrier.fromJson(barrier), throwsA(anything));
    verify();
  });
  test(
    'barrier rejects invalid shape counters identities and scope hashes',
    () {
      final invalid = <String, dynamic>{
        'mode': 'v1_upgrade',
        'sourceProtocol': 1,
        'stageId': 'not-uuid',
        'workspaceId': 'not-uuid',
        'deviceId': 'not-uuid',
        'sourceScopeDigest': '0' * 64,
        'targetScopeDigest': '0' * 64,
        'scopeEpoch': 0,
        'localMutationEpoch': -1,
        'permissionEpoch': 0.5,
        'cursor': 1,
        'knownSequence': 9007199254740992,
        'localRecordsHash': 'unsafe',
        'baselinesHash': 'unsafe',
        'sourcePermissionsDigest': 'unsafe',
        'targetPermissionsDigest': 'unsafe',
        'createdAt': -1,
      };
      for (final entry in invalid.entries) {
        expect(
          () => WorkspaceScopeExtensionBarrier.fromJson({
            ...barrier,
            entry.key: entry.value,
          }),
          throwsA(anything),
          reason: entry.key,
        );
      }
      expect(
        () => WorkspaceScopeExtensionBarrier.fromJson({
          ...barrier,
          'scopeEpoch': workspaceV2MaxSafeInteger,
        }),
        throwsA(anything),
      );
      expect(
        () => WorkspaceScopeExtensionBarrier.fromJson({
          ...barrier,
          'verified': true,
        }),
        throwsA(anything),
      );
      for (final key in barrier.keys) {
        final next = clone(barrier)..remove(key);
        expect(
          () => WorkspaceScopeExtensionBarrier.fromJson(next),
          throwsA(anything),
          reason: key,
        );
      }
      expect(
        WorkspaceScopeExtensionBarrier.fromJson({
          ...barrier,
          'scopeEpoch': 3.0,
        }).toJson()['scopeEpoch'],
        3,
      );
    },
  );
  test('all persisted queue and permission blockers prevent readiness', () {
    final invalid = <String, dynamic>{
      'activeProtocol': 1,
      'enabled': false,
      'suspended': true,
      'pendingCount': 1,
      'inflightCount': 1,
      'conflictCount': 1,
      'blockedCount': 1,
      'responseId': barrier['stageId'],
      'permissionStageId': barrier['stageId'],
      'permissionRequired': true,
      'permissionBlockedReason': 'too_large',
      'through': 2,
      'cursor': 1,
      'knownSequence': 3,
    };
    for (final entry in invalid.entries) {
      expect(
        () => workspaceScopeExtensionReady({
          ...readiness,
          entry.key: entry.value,
        }),
        throwsA(anything),
        reason: entry.key,
      );
    }
    expect(
      () => workspaceScopeExtensionReady({...readiness, 'pendingCount': -1}),
      throwsA(anything),
    );
    expect(
      () => workspaceScopeExtensionReady({...readiness, 'pendingCount': false}),
      throwsA(anything),
    );
    expect(
      () => workspaceScopeExtensionReady({...readiness, 'reviewDraftCount': 3}),
      throwsA(anything),
    );
  });
  test('final activation checks every barrier field and request origin', () {
    final changed = <String, dynamic>{
      'stageId': '88888888-8888-4888-8888-888888888888',
      'workspaceId': '88888888-8888-4888-8888-888888888888',
      'deviceId': '88888888-8888-4888-8888-888888888888',
      'scopeEpoch': 4,
      'localMutationEpoch': 13,
      'localRecordsHash': 'b' * 64,
      'baselinesHash': 'b' * 64,
      'cursor': 3,
      'knownSequence': 1,
      'permissionEpoch': 5,
      'sourcePermissionsDigest': 'b' * 64,
      'targetPermissionsDigest': 'b' * 64,
      'createdAt': barrier['createdAt'] + 1,
    };
    for (final entry in changed.entries) {
      expect(
        () => verify(current: {...barrier, entry.key: entry.value}),
        throwsA(anything),
        reason: entry.key,
      );
    }
    final saved = clone(proof['origin']);
    for (final key in saved.keys) {
      proof['origin'] = {
        ...saved,
        key: key.endsWith('Epoch') ? 99 : 'mismatch',
      };
      expect(verify, throwsA(anything), reason: key);
    }
  });
  test(
    'staging and manifest expire without accepting a future creation clock',
    () {
      expect(
        () => verify(at: now.add(const Duration(days: 1))),
        throwsA(anything),
      );
      expect(
        () => verify(at: now.subtract(const Duration(minutes: 2))),
        throwsA(anything),
      );
      (proof['manifest'] as Map)['expiresAt'] = now.toUtc().toIso8601String();
      expect(verify, throwsA(anything));
    },
  );
  test('permission ABA and baseline substitution cannot reuse final proof', () {
    expect(
      () => verify(current: {...barrier, 'permissionEpoch': 6}),
      throwsA(anything),
    );
    (proof['finalCapabilities'] as Map)['permissions'][2]['write'] = false;
    expect(verify, throwsA(anything));
    proof['finalCapabilities'] = clone(proof['initialCapabilities']);
    proof['oldRecords'] = [];
    expect(verify, throwsA(anything));
  });
  test(
    'checkpoint completion alone is insufficient without exact terminal replay',
    () {
      final saved = clone(proof);
      for (final edit in <void Function()>[
        () => (proof['checkpoint'] as Map)['manifestHash'] = '0' * 64,
        () => (proof['checkpoint'] as Map)['verifiedCount'] = 2,
        () => (proof['checkpoint'] as Map)['finished'] = false,
        () => (proof['terminalRequest'] as Map)['after'] = 'other',
        () => (proof['replayedTerminalResponse'] as Map)['records'] = [],
        () {
          (proof['verifiedTerminalResponse'] as Map)['records'] = [];
          (proof['replayedTerminalResponse'] as Map)['records'] = [];
        },
      ]) {
        proof = clone(saved);
        edit();
        expect(verify, throwsA(anything));
      }
    },
  );
  test('multiple verified pages bind final suffix and token', () {
    final manifest = workspaceV2Map(proof['manifest']);
    final records = (proof['records'] as List).map(workspaceV2Map).toList();
    final request = workspaceV2Map(proof['terminalRequest']);
    final first = {
      ...workspaceV2Map(proof['verifiedTerminalResponse']),
      'records': records.take(2).toList(),
      'next': 'page_2',
      'done': false,
    };
    final checkpoint = advanceWorkspaceSnapshot(
      manifest: manifest,
      request: {...request, 'limit': 2},
      response: first,
      checkpoint: beginWorkspaceSnapshot(manifest, now: now),
      now: now,
    );
    final last = {
      ...workspaceV2Map(proof['verifiedTerminalResponse']),
      'records': records.skip(2).toList(),
    };
    proof['terminalRequest'] = {...request, 'after': 'page_2', 'limit': 2};
    proof['verifiedTerminalResponse'] = last;
    proof['replayedTerminalResponse'] = clone(last);
    proof['checkpoint'] = advanceWorkspaceSnapshot(
      manifest: manifest,
      request: workspaceV2Map(proof['terminalRequest']),
      response: last,
      checkpoint: checkpoint,
      now: now,
    ).toJson();
    verify();
    (proof['terminalRequest'] as Map)['after'] = 'wrong_token';
    expect(verify, throwsA(anything));
  });
  test('empty manifest still needs an authenticated empty terminal page', () {
    proof['records'] = [];
    proof['oldRecords'] = [];
    rebuildSnapshot();
    verify();
    proof['replayedTerminalResponse'] = {};
    expect(verify, throwsA(anything));
  });
  test(
    'blob activation verifies full original JSON bytes, hash and object shape',
    () {
      final original = clone(proof);
      for (final raw in [
        '{ "unknown":1e400,"progress":37.50 }',
        '[]',
        'null',
      ]) {
        proof = clone(original);
        final bytes = utf8.encode(raw),
            hash = workspaceV2Sha256Sync(utf8.encode(raw));
        (proof['records'] as List)[0]['payload'] = {
          'encoding': 'blob',
          'ref': {
            'sha256': hash,
            'byteLength': bytes.length,
            'mediaType': 'application/json',
          },
        };
        proof['documents'] = [
          {'sha256': hash, 'json': raw},
        ];
        rebuildSnapshot();
        expect(
          verify,
          raw.startsWith('{') ? returnsNormally : throwsA(anything),
        );
        if (raw.startsWith('{')) {
          proof['documents'] = [];
          expect(verify, throwsA(anything));
          proof['documents'] = [
            {'sha256': hash, 'json': raw.replaceFirst('37.50', '37.5')},
          ];
          expect(verify, throwsA(anything));
          proof['documents'] = [
            {'sha256': hash, 'json': raw},
            {'sha256': hash, 'json': raw},
          ];
          expect(verify, throwsA(anything));
        }
      }
    },
  );
}
