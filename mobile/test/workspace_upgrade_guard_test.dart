import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_upgrade_guard.dart';

void main() {
  final frozen = WorkspaceUpgradeBarrier(
    workspaceId: '11111111-1111-4111-8111-111111111111',
    deviceId: '22222222-2222-4222-8222-222222222222',
    scopesHash: 'a' * 64,
    localMutationEpoch: 7,
    localRecordsHash: 'b' * 64,
    v1Cursor: 9,
    v1Counter: 12,
    v1KnownSequence: 11,
  );
  WorkspaceUpgradeProof proof({
    int records = 2,
    int pendingJson = 0,
    bool pages = true,
    bool valid = true,
    String? digest,
  }) => WorkspaceUpgradeProof(
    manifestId: '33333333-3333-4333-8333-333333333333',
    workspaceId: frozen.workspaceId,
    deviceId: frozen.deviceId,
    scopesHash: frozen.scopesHash,
    expectedRecords: 2,
    verifiedRecords: records,
    expectedDigest: 'c' * 64,
    actualDigest: digest ?? 'c' * 64,
    allPagesVerified: pages,
    pendingJsonObjects: pendingJson,
    manifestValid: valid,
  );
  void verify({
    WorkspaceUpgradeBarrier? current,
    WorkspaceUpgradeProof? snapshot,
    int pending = 0,
    int inflight = 0,
    int conflicts = 0,
    int? through,
    bool invalid = false,
    int protocol = 1,
  }) => verifyWorkspaceUpgradeActivation(
    frozen: frozen,
    current: current ?? frozen,
    proof: snapshot ?? proof(),
    activeProtocol: protocol,
    pendingV1: pending,
    inflightV1: inflight,
    conflictsV1: conflicts,
    v1Through: through,
    invalidated: invalid,
  );

  test(
    'activation requires a matching stable barrier and complete snapshot',
    () {
      expect(verify, returnsNormally);
      expect(
        WorkspaceUpgradeBarrier.fromJson(frozen.toJson()).toJson(),
        frozen.toJson(),
      );
    },
  );
  test(
    'every binding and local mutation field invalidates a staged snapshot',
    () {
      for (final field in [
        'workspaceId',
        'deviceId',
        'scopesHash',
        'localRecordsHash',
        'localMutationEpoch',
        'v1Cursor',
        'v1Counter',
        'v1KnownSequence',
      ]) {
        final json = frozen.toJson();
        json[field] = json[field] is int
            ? (json[field] as int) + 1
            : field.endsWith('Id')
            ? '44444444-4444-4444-8444-444444444444'
            : 'd' * 64;
        expect(
          () => verify(current: WorkspaceUpgradeBarrier.fromJson(json)),
          throwsStateError,
          reason: field,
        );
      }
    },
  );
  test(
    'pending operations, in-flight ACK, conflict, and unfinished v1 pages block activation',
    () {
      expect(() => verify(pending: 1), throwsStateError);
      expect(() => verify(inflight: 1), throwsStateError);
      expect(() => verify(conflicts: 1), throwsStateError);
      expect(() => verify(through: 9), throwsStateError);
      expect(() => verify(protocol: 2), throwsStateError);
      expect(() => verify(invalid: true), throwsStateError);
    },
  );
  test(
    'missing JSON, records, pages, digest or expired manifest never activates',
    () {
      for (final candidate in [
        proof(pendingJson: 1),
        proof(records: 1),
        proof(pages: false),
        proof(valid: false),
        proof(digest: 'd' * 64),
      ]) {
        expect(() => verify(snapshot: candidate), throwsStateError);
      }
    },
  );
  test('corrupt counts and persisted barrier fields fail closed', () {
    expect(() => verify(pending: -1), throwsFormatException);
    expect(
      () => WorkspaceUpgradeBarrier.fromJson({
        ...frozen.toJson(),
        'localMutationEpoch': 1.1,
      }),
      throwsFormatException,
    );
    expect(
      () => WorkspaceUpgradeBarrier.fromJson({
        ...frozen.toJson(),
        'unknown': true,
      }),
      throwsFormatException,
    );
  });
}
