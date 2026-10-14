import 'dart:convert';

import 'workspace_snapshot_guard.dart';
import 'workspace_v2_contract.dart';

void _require(bool value) {
  if (!value) throw const FormatException('范围扩展证据不匹配');
}

bool _equal(Object? left, Object? right) =>
    workspaceV2CanonicalJson(left) == workspaceV2CanonicalJson(right);

String workspaceScopeExtensionDigest(Object? value) =>
    workspaceV2Sha256Sync(utf8.encode(workspaceV2CanonicalJson(value)));

void workspaceScopeExtensionScopes(Object? raw) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {'sourceScopes', 'targetScopes'});
  final source = workspaceV2ValidateScopes(value['sourceScopes']);
  final target = workspaceV2ValidateScopes(value['targetScopes']);
  _require(target.length > source.length && source.every(target.contains));
}

List<Map<String, dynamic>> _permissions(Object? raw, List<String> scopes) {
  _require(raw is List && raw.length == scopes.length);
  final permissions = (raw as List).map(workspaceV2Map).toList();
  for (var index = 0; index < scopes.length; index++) {
    final permission = permissions[index];
    workspaceV2Fields(permission, {'scope', 'read', 'write'});
    _require(
      permission['scope'] == scopes[index] &&
          permission['read'] == true &&
          permission['write'] is bool &&
          !(permission['scope'] == 'project.catalog' &&
              permission['write'] == true),
    );
  }
  return permissions;
}

void workspaceScopeExtensionCapabilities(Object? raw) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {
    'sourceScopes',
    'targetScopes',
    'sourcePermissions',
    'request',
    'response',
    'approvedPermissions',
  });
  workspaceScopeExtensionScopes({
    'sourceScopes': value['sourceScopes'],
    'targetScopes': value['targetScopes'],
  });
  final source = workspaceV2ValidateScopes(value['sourceScopes']);
  final target = workspaceV2ValidateScopes(value['targetScopes']);
  final previous = _permissions(value['sourcePermissions'], source);
  final approved = _permissions(value['approvedPermissions'], target);
  workspaceV2AssertCapabilities(value['request'], value['response'], approved);
  final request = workspaceV2Map(value['request']);
  final response = workspaceV2Map(value['response']);
  _require(_equal(request['clientScopes'], target));
  _require(_equal(response['supportedScopes'], target));
  final permissions = _permissions(response['permissions'], target);
  for (final permission in previous) {
    _require(
      _equal(
        permission,
        permissions[target.indexOf(permission['scope'] as String)],
      ),
    );
  }
}

Map<String, dynamic> _payloadInfo(Map<String, dynamic> record) {
  final payload = workspaceV2Map(record['payload']);
  return payload['encoding'] == 'json'
      ? {'sha256': payload['sha256'], 'byteLength': payload['byteLength']}
      : workspaceV2Map(payload['ref']);
}

String _key(Map<String, dynamic> record) =>
    '${record['kind']}\u0000${record['id']}';

void workspaceScopeExtensionSnapshot(Object? raw) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {
    'sourceScopes',
    'targetScopes',
    'workspaceId',
    'deviceId',
    'knownSequence',
    'manifest',
    'oldRecords',
    'records',
  });
  workspaceScopeExtensionScopes({
    'sourceScopes': value['sourceScopes'],
    'targetScopes': value['targetScopes'],
  });
  _require(
    workspaceV2Uuid(value['workspaceId']) && workspaceV2Uuid(value['deviceId']),
  );
  _require(workspaceV2SafeInteger(value['knownSequence']));
  _require(value['oldRecords'] is List && value['records'] is List);
  final old = (value['oldRecords'] as List)
      .map((row) => workspaceV2Validate('record', row))
      .toList();
  final records = (value['records'] as List)
      .map((row) => workspaceV2Validate('record', row))
      .toList();
  final manifest = workspaceV2Validate('manifest', value['manifest']);
  _require(
    manifest['workspaceId'] == value['workspaceId'] &&
        manifest['deviceId'] == value['deviceId'] &&
        _equal(manifest['scopes'], value['targetScopes']) &&
        (manifest['through'] as num) >= (value['knownSequence'] as num),
  );
  workspaceV2VerifyManifest(manifest, records);
  final lengths = <String, num>{};
  for (final record in [...old, ...records]) {
    final info = _payloadInfo(record);
    final hash = info['sha256'] as String;
    _require(!lengths.containsKey(hash) || lengths[hash] == info['byteLength']);
    lengths[hash] = info['byteLength'] as num;
  }
  final newHashes = records
      .map((record) => _payloadInfo(record)['sha256'] as String)
      .toSet();
  _require(
    newHashes.fold<num>(0, (total, hash) => total + lengths[hash]!) <=
        workspaceV2DeviceTemporaryBytes,
  );
  final latest = {for (final record in records) _key(record): record};
  final seen = <String>{};
  for (final record in old) {
    _require(
      seen.add(_key(record)) &&
          (value['sourceScopes'] as List).contains(
            (record['metadata'] as Map)['scope'],
          ) &&
          (record['sequence'] as num) <= (value['knownSequence'] as num),
    );
    final next = latest[_key(record)];
    _require(next != null);
    _require(
      (next!['revision'] as num) >= (record['revision'] as num) &&
          (next['sequence'] as num) >= (record['sequence'] as num),
    );
    if (next['revision'] == record['revision']) {
      _require(
        next['sequence'] == record['sequence'] &&
            next['deleted'] == record['deleted'] &&
            _equal(
              _payloadInfo(next)..remove('mediaType'),
              _payloadInfo(record)..remove('mediaType'),
            ),
      );
    } else {
      _require((next['sequence'] as num) > (record['sequence'] as num));
    }
  }
}

void workspaceScopeExtensionTerminalReplay(Object? raw) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {'request', 'verifiedResponse', 'response'});
  final request = workspaceV2Validate('snapshotPageRequest', value['request']);
  final original = workspaceV2Validate(
    'snapshotPageResponse',
    value['verifiedResponse'],
  );
  final response = workspaceV2Validate(
    'snapshotPageResponse',
    value['response'],
  );
  _require(original['done'] == true && original['next'] == null);
  _require((original['records'] as List).length <= (request['limit'] as num));
  for (final field in ['workspaceId', 'deviceId', 'manifestId']) {
    _require(request[field] == original[field]);
  }
  _require(_equal(original, response));
}

void workspaceScopeExtensionValidate(String schema, Object? value) {
  switch (schema) {
    case 'scopes':
      workspaceScopeExtensionScopes(value);
    case 'capabilities':
      workspaceScopeExtensionCapabilities(value);
    case 'snapshot':
      workspaceScopeExtensionSnapshot(value);
    case 'terminalReplay':
      workspaceScopeExtensionTerminalReplay(value);
    default:
      throw const FormatException('未知范围扩展校验');
  }
}

class WorkspaceScopeExtensionBarrier {
  WorkspaceScopeExtensionBarrier._(this._value);
  final Map<String, dynamic> _value;

  factory WorkspaceScopeExtensionBarrier.fromJson(Object? raw) {
    final value = workspaceV2Map(raw);
    workspaceV2Fields(value, {
      'mode',
      'sourceProtocol',
      'stageId',
      'workspaceId',
      'deviceId',
      'sourceScopes',
      'sourceScopeDigest',
      'targetScopes',
      'targetScopeDigest',
      'scopeEpoch',
      'localMutationEpoch',
      'localRecordsHash',
      'baselinesHash',
      'cursor',
      'knownSequence',
      'permissionEpoch',
      'sourcePermissionsDigest',
      'targetPermissionsDigest',
      'createdAt',
    });
    workspaceScopeExtensionScopes({
      'sourceScopes': value['sourceScopes'],
      'targetScopes': value['targetScopes'],
    });
    _require(
      value['mode'] == 'scope_extension' && value['sourceProtocol'] == 2,
    );
    _require(
      [
        'stageId',
        'workspaceId',
        'deviceId',
      ].every((field) => workspaceV2Uuid(value[field])),
    );
    _require(
      [
        'localRecordsHash',
        'baselinesHash',
        'sourcePermissionsDigest',
        'targetPermissionsDigest',
      ].every((field) => workspaceV2Hash(value[field])),
    );
    _require(
      [
        'localMutationEpoch',
        'cursor',
        'knownSequence',
        'permissionEpoch',
        'createdAt',
      ].every((field) => workspaceV2SafeInteger(value[field])),
    );
    _require(
      workspaceV2SafeInteger(
        value['scopeEpoch'],
        minimum: 1,
        maximum: workspaceV2MaxSafeInteger - 1,
      ),
    );
    _require(value['cursor'] == value['knownSequence']);
    _require(
      value['sourceScopeDigest'] ==
          workspaceV2ScopeDigest(
            workspaceV2ValidateScopes(value['sourceScopes']),
          ),
    );
    _require(
      value['targetScopeDigest'] ==
          workspaceV2ScopeDigest(
            workspaceV2ValidateScopes(value['targetScopes']),
          ),
    );
    return WorkspaceScopeExtensionBarrier._(
      workspaceV2Map(jsonDecode(workspaceV2CanonicalJson(value))),
    );
  }

  Map<String, dynamic> toJson() =>
      workspaceV2Map(jsonDecode(workspaceV2CanonicalJson(_value)));
}

void workspaceScopeExtensionReady(Object? raw) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {
    'activeProtocol',
    'enabled',
    'suspended',
    'pendingCount',
    'inflightCount',
    'conflictCount',
    'blockedCount',
    'responseId',
    'permissionStageId',
    'permissionRequired',
    'permissionBlockedReason',
    'through',
    'cursor',
    'knownSequence',
  });
  _require(
    value['activeProtocol'] == 2 &&
        value['enabled'] == true &&
        value['suspended'] == false,
  );
  _require(
    ['pendingCount', 'inflightCount', 'conflictCount', 'blockedCount'].every(
      (field) => workspaceV2SafeInteger(value[field]) && value[field] == 0,
    ),
  );
  _require(
    value['responseId'] == null &&
        value['permissionStageId'] == null &&
        value['permissionRequired'] == false &&
        value['permissionBlockedReason'] == null &&
        value['through'] == null,
  );
  _require(
    workspaceV2SafeInteger(value['cursor']) &&
        workspaceV2SafeInteger(value['knownSequence']) &&
        value['cursor'] == value['knownSequence'],
  );
}

void verifyWorkspaceScopeExtensionActivation({
  required WorkspaceScopeExtensionBarrier frozen,
  required WorkspaceScopeExtensionBarrier current,
  required Map<String, dynamic> readiness,
  required Map<String, dynamic> proof,
  required DateTime now,
}) {
  final barrier = frozen.toJson();
  _require(_equal(barrier, current.toJson()));
  workspaceScopeExtensionReady(readiness);
  _require(
    readiness['cursor'] == barrier['cursor'] &&
        readiness['knownSequence'] == barrier['knownSequence'],
  );
  final elapsed = now.millisecondsSinceEpoch - (barrier['createdAt'] as int);
  _require(elapsed >= 0 && elapsed < workspaceV2IdleTtlSeconds * 1000);
  workspaceV2Fields(proof, {
    'origin',
    'capabilitiesRequest',
    'initialCapabilities',
    'finalCapabilities',
    'sourcePermissions',
    'approvedPermissions',
    'manifest',
    'oldRecords',
    'records',
    'checkpoint',
    'documents',
    'terminalRequest',
    'verifiedTerminalResponse',
    'replayedTerminalResponse',
  });
  final origin = workspaceV2Map(proof['origin']);
  workspaceV2Fields(origin, {
    'stageId',
    'scopeEpoch',
    'permissionEpoch',
    'targetScopeDigest',
  });
  for (final field in origin.keys) {
    _require(origin[field] == barrier[field]);
  }
  for (final response in [
    proof['initialCapabilities'],
    proof['finalCapabilities'],
  ]) {
    workspaceScopeExtensionCapabilities({
      'sourceScopes': barrier['sourceScopes'],
      'targetScopes': barrier['targetScopes'],
      'sourcePermissions': proof['sourcePermissions'],
      'request': proof['capabilitiesRequest'],
      'response': response,
      'approvedPermissions': proof['approvedPermissions'],
    });
    final received = workspaceV2Map(response);
    _require(
      received['workspaceId'] == barrier['workspaceId'] &&
          received['deviceId'] == barrier['deviceId'],
    );
    _require(
      workspaceScopeExtensionDigest(received['permissions']) ==
          barrier['targetPermissionsDigest'],
    );
  }
  _require(
    workspaceScopeExtensionDigest(proof['sourcePermissions']) ==
        barrier['sourcePermissionsDigest'],
  );
  workspaceScopeExtensionSnapshot({
    'sourceScopes': barrier['sourceScopes'],
    'targetScopes': barrier['targetScopes'],
    'workspaceId': barrier['workspaceId'],
    'deviceId': barrier['deviceId'],
    'knownSequence': barrier['knownSequence'],
    'manifest': proof['manifest'],
    'oldRecords': proof['oldRecords'],
    'records': proof['records'],
  });
  _require(
    workspaceV2ManifestDigest(
          (proof['oldRecords'] as List).map(workspaceV2Map).toList(),
        ) ==
        barrier['baselinesHash'],
  );
  final manifest = workspaceV2Map(proof['manifest']);
  final permissions =
      (workspaceV2Map(proof['finalCapabilities'])['permissions'] as List)
          .map(workspaceV2Map)
          .toList();
  for (final raw in proof['records'] as List) {
    final metadata = workspaceV2Map(workspaceV2Map(raw)['metadata']);
    final permission = permissions.singleWhere(
      (value) => value['scope'] == metadata['scope'],
    );
    _require(metadata['write'] != true || permission['write'] == true);
  }
  final initial = beginWorkspaceSnapshot(manifest, now: now);
  final checkpoint = WorkspaceSnapshotCheckpoint.fromJson(
    workspaceV2Map(proof['checkpoint']),
  );
  final records = (proof['records'] as List).map(workspaceV2Map).toList();
  _require(
    checkpoint.finished &&
        checkpoint.manifestHash == initial.manifestHash &&
        checkpoint.verifiedCount == records.length,
  );
  if (records.isNotEmpty) {
    _require(
      checkpoint.lastKind == records.last['kind'] &&
          checkpoint.lastId == records.last['id'],
    );
  }
  final request = workspaceV2Map(proof['terminalRequest']);
  final original = workspaceV2Map(proof['verifiedTerminalResponse']);
  workspaceScopeExtensionTerminalReplay({
    'request': request,
    'verifiedResponse': original,
    'response': proof['replayedTerminalResponse'],
  });
  _require(
    request['manifestId'] == manifest['manifestId'] &&
        request['workspaceId'] == manifest['workspaceId'] &&
        request['deviceId'] == manifest['deviceId'],
  );
  _require(
    request['after'] ==
        (checkpoint.seenTokens.isEmpty ? null : checkpoint.seenTokens.last),
  );
  final tail = original['records'] as List;
  _require(records.isEmpty || tail.isNotEmpty);
  _require(
    tail.length <= records.length &&
        _equal(tail, records.sublist(records.length - tail.length)),
  );
  if (request['after'] == null) _require(tail.length == records.length);
  _require(proof['documents'] is List);
  final expected = <String, num>{};
  for (final record in records) {
    final payload = workspaceV2Map(record['payload']);
    if (payload['encoding'] == 'blob') {
      final ref = workspaceV2Map(payload['ref']);
      expected[ref['sha256'] as String] = ref['byteLength'] as num;
    }
  }
  final receivedHashes = <String>{};
  for (final raw in proof['documents'] as List) {
    final document = workspaceV2Map(raw);
    workspaceV2Fields(document, {'sha256', 'json'});
    _require(workspaceV2Hash(document['sha256']) && document['json'] is String);
    final hash = document['sha256'] as String,
        json = document['json'] as String;
    final bytes = utf8.encode(json);
    _require(
      receivedHashes.add(hash) &&
          expected[hash] == bytes.length &&
          workspaceV2Sha256Sync(bytes) == hash,
    );
    workspaceV2Map(jsonDecode(json));
  }
  _require(receivedHashes.length == expected.length);
}
