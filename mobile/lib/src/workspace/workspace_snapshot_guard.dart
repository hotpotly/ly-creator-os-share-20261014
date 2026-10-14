import 'dart:convert';

import 'workspace_v2_contract.dart';

class WorkspaceSnapshotCheckpoint {
  const WorkspaceSnapshotCheckpoint({
    required this.manifestHash,
    this.nextToken,
    this.verifiedCount = 0,
    this.lastKind,
    this.lastId,
    this.finished = false,
    this.seenTokens = const [],
  });

  final String manifestHash;
  final String? nextToken;
  final int verifiedCount;
  final String? lastKind;
  final String? lastId;
  final bool finished;
  final List<String> seenTokens;

  Map<String, dynamic> toJson() => {
    'manifestHash': manifestHash,
    'nextToken': nextToken,
    'verifiedCount': verifiedCount,
    'lastKind': lastKind,
    'lastId': lastId,
    'finished': finished,
    'seenTokens': seenTokens,
  };

  factory WorkspaceSnapshotCheckpoint.fromJson(Map<String, dynamic> json) {
    workspaceV2Fields(json, {
      'manifestHash',
      'nextToken',
      'verifiedCount',
      'lastKind',
      'lastId',
      'finished',
      'seenTokens',
    });
    final tokens = json['seenTokens'];
    final count = json['verifiedCount'];
    if (!workspaceV2Hash(json['manifestHash']) ||
        !workspaceV2SafeInteger(count) ||
        json['finished'] is! bool ||
        tokens is! List ||
        tokens.any((token) => !_token(token)) ||
        tokens.toSet().length != tokens.length ||
        (json['nextToken'] != null && !_token(json['nextToken'])) ||
        (json['nextToken'] != null &&
            (tokens.isEmpty || tokens.last != json['nextToken'])) ||
        (json['finished'] == true && json['nextToken'] != null) ||
        (json['finished'] == false &&
            count != 0 &&
            json['nextToken'] == null) ||
        (count == 0 &&
            (json['lastKind'] != null ||
                json['lastId'] != null ||
                tokens.isNotEmpty)) ||
        (count != 0 &&
            (!workspaceV2KindScopes.containsKey(json['lastKind']) ||
                json['lastId'] is! String ||
                (json['lastId'] as String).isEmpty))) {
      throw const FormatException('快照页检查点无效');
    }
    return WorkspaceSnapshotCheckpoint(
      manifestHash: json['manifestHash'] as String,
      nextToken: json['nextToken'] as String?,
      verifiedCount: (count as num).toInt(),
      lastKind: json['lastKind'] as String?,
      lastId: json['lastId'] as String?,
      finished: json['finished'] as bool,
      seenTokens: List<String>.unmodifiable(tokens.cast<String>()),
    );
  }
}

bool _token(Object? value) =>
    value is String && RegExp(r'^[A-Za-z0-9_-]{1,512}$').hasMatch(value);

String _manifestHash(Map<String, dynamic> manifest) =>
    workspaceV2Sha256Sync(utf8.encode(workspaceV2CanonicalJson(manifest)));

WorkspaceSnapshotCheckpoint beginWorkspaceSnapshot(
  Map<String, dynamic> manifest, {
  required DateTime now,
}) {
  workspaceV2Validate('manifest', manifest);
  if (!DateTime.parse(manifest['expiresAt'] as String).isAfter(now)) {
    throw StateError('快照已过期');
  }
  return WorkspaceSnapshotCheckpoint(manifestHash: _manifestHash(manifest));
}

WorkspaceSnapshotCheckpoint advanceWorkspaceSnapshot({
  required Map<String, dynamic> manifest,
  required Map<String, dynamic> request,
  required Map<String, dynamic> response,
  required WorkspaceSnapshotCheckpoint checkpoint,
  required DateTime now,
}) {
  workspaceV2Validate('manifest', manifest);
  workspaceV2Validate('snapshotPageRequest', request);
  workspaceV2Validate('snapshotPageResponse', response);
  WorkspaceSnapshotCheckpoint.fromJson(checkpoint.toJson());
  if (checkpoint.finished ||
      checkpoint.manifestHash != _manifestHash(manifest) ||
      !DateTime.parse(manifest['expiresAt'] as String).isAfter(now) ||
      request['after'] != checkpoint.nextToken) {
    throw StateError('快照页链已改变或失效');
  }
  for (final field in ['workspaceId', 'deviceId', 'manifestId']) {
    if (request[field] != manifest[field] ||
        response[field] != manifest[field]) {
      throw StateError('快照页身份不匹配');
    }
  }
  final records = (response['records'] as List).map(workspaceV2Map).toList();
  final count = checkpoint.verifiedCount + records.length;
  final done = response['done'] as bool;
  final next = response['next'] as String?;
  if (records.length > (request['limit'] as num) ||
      count > (manifest['entityCount'] as num) ||
      (done && count != manifest['entityCount']) ||
      (!done && count >= (manifest['entityCount'] as num)) ||
      (next != null && checkpoint.seenTokens.contains(next))) {
    throw StateError('快照页数目或顺序无效');
  }
  String? lastKind = checkpoint.lastKind, lastId = checkpoint.lastId;
  for (final record in records) {
    final kind = record['kind'] as String;
    final id = record['id'] as String;
    if ((lastKind != null &&
            (kind.compareTo(lastKind) < 0 ||
                (kind == lastKind && id.compareTo(lastId!) <= 0))) ||
        (record['sequence'] as num) > (manifest['through'] as num) ||
        !(manifest['scopes'] as List).contains(
          (record['metadata'] as Map)['scope'],
        )) {
      throw StateError('快照记录重复、越界或超出范围');
    }
    lastKind = kind;
    lastId = id;
  }
  return WorkspaceSnapshotCheckpoint(
    manifestHash: checkpoint.manifestHash,
    nextToken: next,
    verifiedCount: count,
    lastKind: lastKind,
    lastId: lastId,
    finished: done,
    seenTokens: List<String>.unmodifiable([
      ...checkpoint.seenTokens,
      ?next,
    ]),
  );
}
