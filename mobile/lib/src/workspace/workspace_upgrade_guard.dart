import 'workspace_sync_models.dart';

class WorkspaceUpgradeBarrier {
  const WorkspaceUpgradeBarrier({
    required this.workspaceId,
    required this.deviceId,
    required this.scopesHash,
    required this.localMutationEpoch,
    required this.localRecordsHash,
    required this.v1Cursor,
    required this.v1Counter,
    required this.v1KnownSequence,
  });

  final String workspaceId;
  final String deviceId;
  final String scopesHash;
  final int localMutationEpoch;
  final String localRecordsHash;
  final int v1Cursor;
  final int v1Counter;
  final int v1KnownSequence;

  Map<String, dynamic> toJson() => {
    'workspaceId': workspaceId,
    'deviceId': deviceId,
    'scopesHash': scopesHash,
    'localMutationEpoch': localMutationEpoch,
    'localRecordsHash': localRecordsHash,
    'v1Cursor': v1Cursor,
    'v1Counter': v1Counter,
    'v1KnownSequence': v1KnownSequence,
  };

  factory WorkspaceUpgradeBarrier.fromJson(Map<String, dynamic> json) {
    workspaceSyncFields(json, {
      'workspaceId',
      'deviceId',
      'scopesHash',
      'localMutationEpoch',
      'localRecordsHash',
      'v1Cursor',
      'v1Counter',
      'v1KnownSequence',
    });
    if (!workspaceSyncUuid(json['workspaceId']) ||
        !workspaceSyncUuid(json['deviceId']) ||
        ![json['scopesHash'], json['localRecordsHash']].every(_hash) ||
        ![
          'localMutationEpoch',
          'v1Cursor',
          'v1Counter',
          'v1KnownSequence',
        ].every((field) => workspaceSyncInteger(json[field]))) {
      throw const FormatException('升级屏障无效');
    }
    return WorkspaceUpgradeBarrier(
      workspaceId: json['workspaceId'] as String,
      deviceId: json['deviceId'] as String,
      scopesHash: json['scopesHash'] as String,
      localMutationEpoch: json['localMutationEpoch'] as int,
      localRecordsHash: json['localRecordsHash'] as String,
      v1Cursor: json['v1Cursor'] as int,
      v1Counter: json['v1Counter'] as int,
      v1KnownSequence: json['v1KnownSequence'] as int,
    );
  }

  void validate() => WorkspaceUpgradeBarrier.fromJson(toJson());
}

class WorkspaceUpgradeProof {
  const WorkspaceUpgradeProof({
    required this.manifestId,
    required this.workspaceId,
    required this.deviceId,
    required this.scopesHash,
    required this.expectedRecords,
    required this.verifiedRecords,
    required this.expectedDigest,
    required this.actualDigest,
    required this.allPagesVerified,
    required this.pendingJsonObjects,
    required this.manifestValid,
  });
  final String manifestId;
  final String workspaceId;
  final String deviceId;
  final String scopesHash;
  final int expectedRecords;
  final int verifiedRecords;
  final String expectedDigest;
  final String actualDigest;
  final bool allPagesVerified;
  final int pendingJsonObjects;
  final bool manifestValid;
}

void verifyWorkspaceUpgradeActivation({
  required WorkspaceUpgradeBarrier frozen,
  required WorkspaceUpgradeBarrier current,
  required WorkspaceUpgradeProof proof,
  required int activeProtocol,
  required int pendingV1,
  required int inflightV1,
  required int conflictsV1,
  required int? v1Through,
  required bool invalidated,
}) {
  frozen.validate();
  current.validate();
  if (![
        pendingV1,
        inflightV1,
        conflictsV1,
        proof.expectedRecords,
        proof.verifiedRecords,
        proof.pendingJsonObjects,
      ].every(workspaceSyncInteger) ||
      !workspaceSyncUuid(proof.manifestId) ||
      ![
        proof.expectedDigest,
        proof.actualDigest,
        proof.scopesHash,
      ].every(_hash)) {
    throw const FormatException('升级凭据无效');
  }
  if (activeProtocol != 1 ||
      invalidated ||
      !proof.manifestValid ||
      pendingV1 != 0 ||
      inflightV1 != 0 ||
      conflictsV1 != 0 ||
      v1Through != null ||
      !workspaceJsonEqual(frozen.toJson(), current.toJson()) ||
      proof.workspaceId != frozen.workspaceId ||
      proof.deviceId != frozen.deviceId ||
      proof.scopesHash != frozen.scopesHash) {
    throw StateError('升级期间工作区已改变，保留当前记录重新检查');
  }
  if (!proof.allPagesVerified ||
      proof.pendingJsonObjects != 0 ||
      proof.expectedRecords != proof.verifiedRecords ||
      proof.expectedDigest != proof.actualDigest) {
    throw StateError('升级快照不完整，当前工作区保持不变');
  }
}

bool _hash(Object? value) =>
    value is String && RegExp(r'^[0-9a-f]{64}$').hasMatch(value);
