import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart' show DartSha256;

const workspaceV2Protocol = 2;
const workspaceV2SchemaVersion = 1;
const workspaceV2KeyInfo = 'ly-creator-workspace-v2';
const workspaceV2BatchLimit = 100;
const workspaceV2PageBytes = 256 * 1024;
const workspaceV2InlineBytes = 16 * 1024;
const workspaceV2JsonBytes = 16 * 1024 * 1024;
const workspaceV2ImageBytes = 20 * 1024 * 1024;
const workspaceV2ChunkBytes = 65536;
const workspaceV2ConcurrentUploads = 2;
const workspaceV2DeviceTemporaryBytes = 256 * 1024 * 1024;
const workspaceV2WorkspaceTemporaryBytes = 512 * 1024 * 1024;
const workspaceV2IdleTtlSeconds = 24 * 60 * 60;
const workspaceV2AbsoluteTtlSeconds = 7 * 24 * 60 * 60;
const workspaceV2UnreferencedTtlSeconds = 24 * 60 * 60;
const workspaceV2MaxImagesPerEntry = 20;
const workspaceV2PreviewPixels = 2048;
const workspaceV2MaxSafeInteger = 9007199254740991;

const workspaceV2Scopes = {
  'todo.full',
  'work_log',
  'todo.day',
  'preferences.todo',
  'project.catalog',
  'trip',
  'review',
  'review.file',
};

const workspaceV2KindScopes = {
  'todo': 'todo.full',
  'work_log': 'work_log',
  'todo_day': 'todo.day',
  'todo_preferences': 'preferences.todo',
  'project_catalog': 'project.catalog',
  'trip': 'trip',
  'review_period': 'review',
  'review_entry': 'review',
  'review_file': 'review.file',
};

const workspaceV2Purposes = {
  'capabilities',
  'sync',
  'snapshot.start',
  'snapshot.page',
  'blob.start',
  'blob.status',
  'blob.chunk',
  'blob.commit',
  'blob.read',
};

const workspaceV2ImageTypes = {'image/png', 'image/jpeg', 'image/webp'};

bool workspaceV2SafeInteger(
  Object? value, {
  int minimum = 0,
  int maximum = workspaceV2MaxSafeInteger,
}) =>
    value is num &&
    value.isFinite &&
    value >= minimum &&
    value <= maximum &&
    value == value.truncateToDouble();

bool workspaceV2Hash(Object? value) =>
    value is String && RegExp(r'^[0-9a-f]{64}$').hasMatch(value);

Map<String, dynamic> workspaceV2Map(Object? value) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw const FormatException('v2对象格式无效');
  }
  return Map<String, dynamic>.from(value);
}

void workspaceV2Fields(
  Map<String, dynamic> value,
  Set<String> required, {
  Set<String> optional = const {},
}) {
  if (!required.every(value.containsKey) ||
      value.keys.any(
        (key) => !required.contains(key) && !optional.contains(key),
      )) {
    throw const FormatException('v2字段无效');
  }
}

String _workspaceV2JsonString(String value) {
  final result = StringBuffer('"');
  final units = value.codeUnits;
  for (var i = 0; i < units.length; i++) {
    final code = units[i];
    if (code == 34) {
      result.write(r'\"');
    } else if (code == 92) {
      result.write(r'\\');
    } else if (code == 8) {
      result.write(r'\b');
    } else if (code == 9) {
      result.write(r'\t');
    } else if (code == 10) {
      result.write(r'\n');
    } else if (code == 12) {
      result.write(r'\f');
    } else if (code == 13) {
      result.write(r'\r');
    } else if (code < 32 ||
        (code >= 0xdc00 && code <= 0xdfff) ||
        (code >= 0xd800 &&
            code <= 0xdbff &&
            (i + 1 == units.length ||
                units[i + 1] < 0xdc00 ||
                units[i + 1] > 0xdfff))) {
      result.write('\\u${code.toRadixString(16).padLeft(4, '0')}');
    } else if (code >= 0xd800 && code <= 0xdbff) {
      result.write(String.fromCharCodes([code, units[++i]]));
    } else {
      result.writeCharCode(code);
    }
  }
  return '$result"';
}

String workspaceV2CanonicalJson(Object? value) {
  final active = <Object>{};
  String visit(Object? item) {
    if (item == null) return 'null';
    if (item is String) return _workspaceV2JsonString(item);
    if (item is bool) return item ? 'true' : 'false';
    if (item is num) {
      if (!workspaceV2SafeInteger(item, minimum: -workspaceV2MaxSafeInteger)) {
        throw const FormatException('规范JSON只接受安全整数');
      }
      return item.toInt().toString();
    }
    if (item is! List && item is! Map) {
      throw const FormatException('规范JSON类型无效');
    }
    if (!active.add(item)) throw const FormatException('规范JSON不能循环引用');
    try {
      if (item is List) return '[${item.map(visit).join(',')}]';
      final object = workspaceV2Map(item);
      final keys = object.keys.toList()..sort();
      return '{${keys.map((key) => '${_workspaceV2JsonString(key)}:${visit(object[key])}').join(',')}}';
    } finally {
      active.remove(item);
    }
  }

  return visit(value);
}

Future<String> workspaceV2Sha256(List<int> bytes) async {
  final hash = await Sha256().hash(bytes);
  return hash.bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
}

String workspaceV2Aad(String direction, Map<String, dynamic> envelope) {
  if (!{'request', 'response'}.contains(direction) ||
      !workspaceV2Purposes.contains(envelope['purpose']) ||
      !workspaceV2SafeInteger(envelope['counter'], minimum: 1)) {
    throw const FormatException('v2认证用途无效');
  }
  return 'workspace-v2\n$direction\n${envelope['purpose']}\n${envelope['workspaceId']}\n${envelope['serviceId']}\n${envelope['deviceId']}\n${envelope['requestId']}\n${(envelope['counter'] as num).toInt()}';
}

int workspaceV2ExpectedChunkLength(num byteLength, num index) {
  if (!workspaceV2SafeInteger(
        byteLength,
        minimum: 1,
        maximum: workspaceV2ImageBytes,
      ) ||
      !workspaceV2SafeInteger(index) ||
      index >=
          (byteLength + workspaceV2ChunkBytes - 1) ~/ workspaceV2ChunkBytes) {
    throw const FormatException('v2分块位置无效');
  }
  final remaining = byteLength.toInt() - index.toInt() * workspaceV2ChunkBytes;
  return remaining > workspaceV2ChunkBytes ? workspaceV2ChunkBytes : remaining;
}

List<int> workspaceV2DecodeBase64(
  Object? value, {
  int? expectedLength,
  int maximumLength = workspaceV2ChunkBytes,
}) {
  if (value is! String ||
      value.length > ((maximumLength + 2) ~/ 3) * 4 ||
      !RegExp(
        r'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
      ).hasMatch(value)) {
    throw const FormatException('v2分块编码无效');
  }
  final bytes = base64Decode(value);
  if (bytes.isEmpty ||
      bytes.length > maximumLength ||
      (expectedLength != null && bytes.length != expectedLength) ||
      base64Encode(bytes) != value) {
    throw const FormatException('v2分块长度无效');
  }
  return bytes;
}

Future<List<int>> workspaceV2VerifyChunk({
  required Object? bytesBase64,
  required Object? sha256,
  required int byteLength,
  required int index,
}) async {
  final bytes = workspaceV2DecodeBase64(
    bytesBase64,
    expectedLength: workspaceV2ExpectedChunkLength(byteLength, index),
  );
  if (!workspaceV2Hash(sha256) || await workspaceV2Sha256(bytes) != sha256) {
    throw const FormatException('v2分块哈希不一致');
  }
  return bytes;
}

String workspaceV2Sha256Sync(List<int> bytes) => const DartSha256()
    .hashSync(bytes)
    .bytes
    .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
    .join();

bool workspaceV2Uuid(Object? value) =>
    value is String &&
    RegExp(
      r'^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
    ).hasMatch(value);

bool workspaceV2Day(Object? value) {
  if (value is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) {
    return false;
  }
  final parsed = DateTime.tryParse(value);
  return parsed != null &&
      parsed.year == int.parse(value.substring(0, 4)) &&
      parsed.month == int.parse(value.substring(5, 7)) &&
      parsed.day == int.parse(value.substring(8, 10));
}

bool workspaceV2UploadFits({
  required int activeUploads,
  required int deviceDeclaredBytes,
  required int workspaceDeclaredBytes,
  required int incomingBytes,
}) =>
    workspaceV2SafeInteger(activeUploads) &&
    activeUploads < workspaceV2ConcurrentUploads &&
    workspaceV2SafeInteger(deviceDeclaredBytes) &&
    workspaceV2SafeInteger(workspaceDeclaredBytes) &&
    workspaceV2SafeInteger(
      incomingBytes,
      minimum: 1,
      maximum: workspaceV2ImageBytes,
    ) &&
    deviceDeclaredBytes + incomingBytes <= workspaceV2DeviceTemporaryBytes &&
    workspaceDeclaredBytes + incomingBytes <=
        workspaceV2WorkspaceTemporaryBytes;

bool workspaceV2TemporaryExpired({
  required DateTime createdAt,
  required DateTime lastActivityAt,
  required DateTime now,
}) =>
    now.difference(createdAt).inSeconds >= workspaceV2AbsoluteTtlSeconds ||
    now.difference(lastActivityAt).inSeconds >= workspaceV2IdleTtlSeconds;

const workspaceV2Limits = {
  'batchRecords': 100,
  'metadataBytes': 262144,
  'inlineJsonBytes': 16384,
  'blobChunkBytes': 65536,
  'jsonBlobBytes': 16777216,
  'imageBlobBytes': 20971520,
  'imagesPerRecord': 20,
  'concurrentUploads': 2,
  'concurrentDownloads': 2,
  'deviceTemporaryBytes': 268435456,
  'workspaceTemporaryBytes': 536870912,
  'idleTtlSeconds': 86400,
  'absoluteTtlSeconds': 604800,
  'unreferencedTtlSeconds': 86400,
  'previewMaxPixels': 2048,
};
const _identityFields = {'protocolVersion', 'workspaceId', 'deviceId'};
const _scopedFields = {'scopes', 'scopeDigest'};

void _require(bool condition) {
  if (!condition) throw const FormatException('v2合同校验失败');
}

bool _string(
  Object? value, {
  int minimum = 0,
  int maximum = workspaceV2MaxSafeInteger,
}) => value is String && value.length >= minimum && value.length <= maximum;

bool _entityId(Object? value) =>
    _string(value, minimum: 1, maximum: 256) &&
    !RegExp(r'[\u0000-\u001f\u007f]').hasMatch(value as String);

bool _timestamp(Object? value) {
  if (value is! String ||
      !RegExp(
        r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$',
      ).hasMatch(value)) {
    return false;
  }
  final month = int.parse(value.substring(5, 7));
  final day = int.parse(value.substring(8, 10));
  final hour = int.parse(value.substring(11, 13));
  final minute = int.parse(value.substring(14, 16));
  final second = int.parse(value.substring(17, 19));
  if (month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 24 ||
      minute > 59 ||
      second > 59) {
    return false;
  }
  if (hour == 24 &&
      (minute != 0 ||
          second != 0 ||
          (value.contains('.') &&
              int.parse(value.substring(20, value.length - 1)) != 0))) {
    return false;
  }
  final parsed = DateTime.tryParse(value);
  return parsed != null &&
      parsed.toIso8601String().substring(0, 19) == value.substring(0, 19);
}

bool _pageToken(Object? value) =>
    value == null ||
    value is String && RegExp(r'^[A-Za-z0-9_-]{1,512}$').hasMatch(value);

bool _orderedStrings(List values) =>
    List.generate(values.length, (index) => index).every(
      (index) =>
          values[index] is String &&
          (index == 0 ||
              (values[index - 1] as String).compareTo(values[index] as String) <
                  0),
    );

List<String> workspaceV2ValidateScopes(
  Object? value, {
  bool allowEmpty = false,
}) {
  _require(
    value is List &&
        (allowEmpty || value.isNotEmpty) &&
        value.length <= workspaceV2Scopes.length &&
        value.every(workspaceV2Scopes.contains) &&
        _orderedStrings(value),
  );
  return (value as List).cast<String>();
}

String workspaceV2ScopeDigest(List<String> scopes) {
  workspaceV2ValidateScopes(scopes);
  return workspaceV2Sha256Sync(utf8.encode(workspaceV2CanonicalJson(scopes)));
}

void _identity(Map<String, dynamic> value) => _require(
  value['protocolVersion'] == 2 &&
      workspaceV2Uuid(value['workspaceId']) &&
      workspaceV2Uuid(value['deviceId']),
);

void _scopes(Map<String, dynamic> value) {
  final scopes = workspaceV2ValidateScopes(value['scopes']);
  _require(
    workspaceV2Hash(value['scopeDigest']) &&
        workspaceV2ScopeDigest(scopes) == value['scopeDigest'],
  );
}

void _pageBytes(Map<String, dynamic> value) => _require(
  utf8.encode(workspaceV2CanonicalJson(value)).length <= workspaceV2PageBytes,
);

Map<String, dynamic> _ref(Object? raw, {bool onlyJson = false}) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {'sha256', 'byteLength', 'mediaType'});
  _require(
    workspaceV2Hash(value['sha256']) &&
        workspaceV2SafeInteger(
          value['byteLength'],
          minimum: 1,
          maximum: onlyJson || value['mediaType'] == 'application/json'
              ? workspaceV2JsonBytes
              : workspaceV2ImageBytes,
        ),
  );
  _require(
    onlyJson
        ? value['mediaType'] == 'application/json'
        : value['mediaType'] == 'application/json' ||
              workspaceV2ImageTypes.contains(value['mediaType']),
  );
  return value;
}

Map<String, dynamic> workspaceV2ValidateBlobRef(Object? raw) => _ref(raw);

Map<String, dynamic> workspaceV2ValidatePayload(Object? raw) {
  final value = workspaceV2Map(raw);
  if (value['encoding'] == 'json') return workspaceV2Validate('inline', value);
  workspaceV2Fields(value, {'encoding', 'ref'});
  _require(value['encoding'] == 'blob');
  _ref(value['ref'], onlyJson: true);
  return value;
}

void _snapshot(Object? raw) {
  final value = workspaceV2Map(raw);
  workspaceV2Fields(value, {'deleted', 'payload'});
  _require(value['deleted'] is bool);
  workspaceV2ValidatePayload(value['payload']);
}

void _records(Object? value) {
  _require(value is List && value.length <= 100);
  for (final record in value as List) {
    workspaceV2Validate('record', record);
  }
}

void _indexes(Object? value) {
  _require(value is List && value.length <= 320);
  num previous = -1;
  for (final index in value as List) {
    _require(
      workspaceV2SafeInteger(index, maximum: 319) && (index as num) > previous,
    );
    previous = index as num;
  }
}

Map<String, dynamic> workspaceV2Validate(String schema, Object? raw) {
  final value = workspaceV2Map(raw);
  switch (schema) {
    case 'envelope':
      workspaceV2Fields(value, {
        ..._identityFields,
        'serviceId',
        'purpose',
        'requestId',
        'counter',
        'nonce',
        'ciphertext',
        'tag',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['serviceId']) &&
            value['workspaceId'] == value['serviceId'] &&
            workspaceV2Uuid(value['requestId']) &&
            workspaceV2Purposes.contains(value['purpose']) &&
            workspaceV2SafeInteger(value['counter'], minimum: 1),
      );
      workspaceV2DecodeBase64(
        value['nonce'],
        maximumLength: 12,
        expectedLength: 12,
      );
      workspaceV2DecodeBase64(
        value['tag'],
        maximumLength: 16,
        expectedLength: 16,
      );
      workspaceV2DecodeBase64(
        value['ciphertext'],
        maximumLength: workspaceV2PageBytes,
      );
      break;
    case 'inline':
      workspaceV2Fields(value, {'encoding', 'json', 'sha256', 'byteLength'});
      _require(
        value['encoding'] == 'json' &&
            _string(
              value['json'],
              minimum: 2,
              maximum: workspaceV2InlineBytes,
            ) &&
            workspaceV2Hash(value['sha256']) &&
            workspaceV2SafeInteger(
              value['byteLength'],
              minimum: 1,
              maximum: workspaceV2InlineBytes,
            ),
      );
      final bytes = utf8.encode(value['json'] as String);
      _require(
        jsonDecode(value['json'] as String) is Map &&
            bytes.length == value['byteLength'] &&
            workspaceV2Sha256Sync(bytes) == value['sha256'],
      );
      break;
    case 'metadata':
      workspaceV2Fields(value, {
        'scope',
        'read',
        'write',
        'deletable',
        'editableFields',
        'source',
      });
      final fields = value['editableFields'];
      _require(
        workspaceV2Scopes.contains(value['scope']) &&
            value['read'] == true &&
            value['write'] is bool &&
            value['deletable'] is bool &&
            fields is List &&
            fields.length <= 40 &&
            fields.every(
              (field) =>
                  field is String &&
                  RegExp(r'^[A-Za-z][A-Za-z0-9]{0,63}$').hasMatch(field),
            ) &&
            fields.toSet().length == fields.length &&
            {null, 'manual', 'schedule'}.contains(value['source']),
      );
      _require(
        !(value['write'] == false &&
                (value['deletable'] == true || (fields as List).isNotEmpty)) &&
            !(value['scope'] == 'project.catalog' && value['write'] == true) &&
            !(value['scope'] != 'todo.full' && value['source'] != null),
      );
      break;
    case 'record':
      workspaceV2Fields(value, {
        'kind',
        'id',
        'revision',
        'sequence',
        'deleted',
        'payload',
        'metadata',
      });
      _require(
        workspaceV2KindScopes.containsKey(value['kind']) &&
            _entityId(value['id']) &&
            workspaceV2SafeInteger(value['revision'], minimum: 1) &&
            workspaceV2SafeInteger(value['sequence'], minimum: 1) &&
            value['deleted'] is bool,
      );
      workspaceV2ValidatePayload(value['payload']);
      final metadata = workspaceV2Validate('metadata', value['metadata']);
      _require(workspaceV2KindScopes[value['kind']] == metadata['scope']);
      break;
    case 'operation':
      _require(
        workspaceV2Uuid(value['operationId']) &&
            workspaceV2SafeInteger(value['localRevision'], minimum: 1) &&
            workspaceV2SafeInteger(value['baseRevision']),
      );
      if (value['type'] == 'record') {
        workspaceV2Fields(value, {
          'type',
          'operationId',
          'kind',
          'id',
          'localRevision',
          'baseRevision',
          'base',
          'next',
        });
        _require(
          workspaceV2KindScopes.containsKey(value['kind']) &&
              value['kind'] != 'project_catalog' &&
              _entityId(value['id']) &&
              (value['baseRevision'] == 0) == (value['base'] == null),
        );
        if (value['base'] != null) _snapshot(value['base']);
        _snapshot(value['next']);
      } else {
        workspaceV2Fields(value, {
          'type',
          'operationId',
          'localRevision',
          'baseRevision',
          'todoId',
          'day',
          'viewMode',
          'category',
          'segment',
          'beforeId',
          'afterId',
        });
        _require(
          value['type'] == 'todo.move' &&
              workspaceV2Uuid(value['todoId']) &&
              workspaceV2Day(value['day']) &&
              {'all', 'time', 'category'}.contains(value['viewMode']) &&
              {
                null,
                'self_media',
                'ai',
                'life',
                'other_work',
              }.contains(value['category']) &&
              {
                null,
                'morning',
                'afternoon',
                'evening',
              }.contains(value['segment']) &&
              (value['beforeId'] == null ||
                  workspaceV2Uuid(value['beforeId'])) &&
              (value['afterId'] == null || workspaceV2Uuid(value['afterId'])),
        );
        _require(
          value['beforeId'] != value['todoId'] &&
              value['afterId'] != value['todoId'] &&
              !(value['beforeId'] != null &&
                  value['beforeId'] == value['afterId']) &&
              !(value['viewMode'] != 'category' && value['category'] != null) &&
              !(value['viewMode'] == 'category' && value['category'] == null) &&
              !(value['viewMode'] != 'time' && value['segment'] != null),
        );
      }
      break;
    case 'syncRequest':
      workspaceV2Fields(value, {
        ..._identityFields,
        ..._scopedFields,
        'cursor',
        'through',
        'operations',
      });
      _identity(value);
      _scopes(value);
      _require(
        workspaceV2SafeInteger(value['cursor']) &&
            (value['through'] == null ||
                workspaceV2SafeInteger(value['through']) &&
                    (value['through'] as num) >= (value['cursor'] as num)) &&
            value['operations'] is List &&
            (value['operations'] as List).length <= 100,
      );
      final operationIds = <String>{};
      final targets = <String>{};
      for (final rawOperation in value['operations'] as List) {
        final operation = workspaceV2Validate('operation', rawOperation);
        final target = operation['type'] == 'record'
            ? '${operation['kind']}:${operation['id']}'
            : 'todo.move:order';
        final required = operation['type'] == 'record'
            ? [workspaceV2KindScopes[operation['kind']]]
            : ['preferences.todo', 'todo.full'];
        _require(
          operationIds.add(operation['operationId'] as String) &&
              targets.add(target) &&
              required.every(
                (scope) => (value['scopes'] as List).contains(scope),
              ),
        );
      }
      _pageBytes(value);
      break;
    case 'receipt':
      if (value['status'] == 'rejected') {
        workspaceV2Fields(value, {
          'operationId',
          'localRevision',
          'status',
          'target',
          'operationHash',
          'code',
          'record',
        });
        final target = workspaceV2Map(value['target']);
        workspaceV2Fields(target, {'kind', 'id'});
        _require(
          workspaceV2Uuid(value['operationId']) &&
              workspaceV2SafeInteger(value['localRevision'], minimum: 1) &&
              workspaceV2KindScopes.containsKey(target['kind']) &&
              _entityId(target['id']) &&
              workspaceV2Hash(value['operationHash']) &&
              {
                'project_unavailable',
                'stage_unavailable',
                'invalid_change',
                'record_read_only',
              }.contains(value['code']),
        );
        if (value['record'] != null) {
          final record = workspaceV2Validate('record', value['record']);
          _require(
            record['kind'] == target['kind'] && record['id'] == target['id'],
          );
        }
        break;
      }
      workspaceV2Fields(value, {
        'operationId',
        'localRevision',
        'status',
        'record',
      });
      _require(
        workspaceV2Uuid(value['operationId']) &&
            workspaceV2SafeInteger(value['localRevision'], minimum: 1) &&
            {'accepted', 'conflict'}.contains(value['status']),
      );
      workspaceV2Validate('record', value['record']);
      break;
    case 'syncResponse':
      workspaceV2Fields(value, {
        ..._identityFields,
        ..._scopedFields,
        'receipts',
        'changes',
        'cursor',
        'through',
        'hasMore',
      });
      _identity(value);
      _scopes(value);
      _require(
        workspaceV2SafeInteger(value['cursor']) &&
            workspaceV2SafeInteger(value['through']) &&
            value['hasMore'] is bool &&
            (value['cursor'] as num) <= (value['through'] as num) &&
            value['hasMore'] ==
                ((value['cursor'] as num) < (value['through'] as num)) &&
            value['receipts'] is List &&
            (value['receipts'] as List).length <= 100,
      );
      _records(value['changes']);
      num previous = 0;
      for (final rawRecord in value['changes'] as List) {
        final record = workspaceV2Map(rawRecord);
        _require(
          (record['sequence'] as num) > previous &&
              (record['sequence'] as num) <= (value['cursor'] as num) &&
              (value['scopes'] as List).contains(
                (record['metadata'] as Map)['scope'],
              ),
        );
        previous = record['sequence'] as num;
      }
      for (final rawReceipt in value['receipts'] as List) {
        final receipt = workspaceV2Validate('receipt', rawReceipt);
        if (receipt['status'] == 'rejected') {
          _require(
            (value['scopes'] as List).contains(
              workspaceV2KindScopes[(receipt['target'] as Map)['kind']],
            ),
          );
        }
        if (receipt['record'] != null) {
          _require(
            (value['scopes'] as List).contains(
              ((receipt['record'] as Map)['metadata'] as Map)['scope'],
            ),
          );
        }
      }
      _pageBytes(value);
      break;
    case 'capabilitiesRequest':
      workspaceV2Fields(value, {..._identityFields, 'clientScopes'});
      _identity(value);
      final scopes = value['clientScopes'];
      _require(
        scopes is List &&
            scopes.length <= 32 &&
            scopes.every(
              (scope) =>
                  scope is String &&
                  RegExp(r'^[a-z][a-z_.]{0,39}$').hasMatch(scope),
            ) &&
            _orderedStrings(scopes),
      );
      break;
    case 'capabilitiesResponse':
      workspaceV2Fields(value, {
        ..._identityFields,
        'schemaVersion',
        'supportedScopes',
        'permissions',
        'limits',
      });
      _identity(value);
      _require(value['schemaVersion'] == 1);
      final scopes = workspaceV2ValidateScopes(
        value['supportedScopes'],
        allowEmpty: true,
      );
      final permissions = value['permissions'];
      _require(permissions is List && permissions.length == scopes.length);
      for (var index = 0; index < (permissions as List).length; index++) {
        final permission = workspaceV2Map(permissions[index]);
        workspaceV2Fields(permission, {'scope', 'read', 'write'});
        _require(
          permission['scope'] == scopes[index] &&
              permission['read'] == true &&
              permission['write'] is bool &&
              !(permission['scope'] == 'project.catalog' &&
                  permission['write'] == true),
        );
      }
      final limits = workspaceV2Map(value['limits']);
      workspaceV2Fields(limits, workspaceV2Limits.keys.toSet());
      _require(
        workspaceV2Limits.entries.every(
          (entry) => limits[entry.key] == entry.value,
        ),
      );
      break;
    case 'snapshotStart':
      workspaceV2Fields(value, {..._identityFields, ..._scopedFields});
      _identity(value);
      _scopes(value);
      break;
    case 'manifest':
      workspaceV2Fields(value, {
        ..._identityFields,
        ..._scopedFields,
        'manifestId',
        'schemaVersion',
        'through',
        'entityCount',
        'entriesSha256',
        'expiresAt',
      });
      _identity(value);
      _scopes(value);
      _require(
        workspaceV2Uuid(value['manifestId']) &&
            value['schemaVersion'] == 1 &&
            workspaceV2SafeInteger(value['through']) &&
            workspaceV2SafeInteger(value['entityCount']) &&
            workspaceV2Hash(value['entriesSha256']) &&
            _timestamp(value['expiresAt']),
      );
      break;
    case 'snapshotPageRequest':
      workspaceV2Fields(value, {
        ..._identityFields,
        'manifestId',
        'after',
        'limit',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['manifestId']) &&
            _pageToken(value['after']) &&
            workspaceV2SafeInteger(value['limit'], minimum: 1, maximum: 100),
      );
      break;
    case 'snapshotPageResponse':
      workspaceV2Fields(value, {
        ..._identityFields,
        'manifestId',
        'records',
        'next',
        'done',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['manifestId']) &&
            _pageToken(value['next']) &&
            value['done'] is bool &&
            value['done'] == (value['next'] == null),
      );
      _records(value['records']);
      _require(value['done'] == true || (value['records'] as List).isNotEmpty);
      _pageBytes(value);
      break;
    case 'blobStart':
      workspaceV2Fields(value, {
        ..._identityFields,
        'uploadId',
        'scope',
        'entity',
        'purpose',
        'sha256',
        'byteLength',
        'mediaType',
      });
      _identity(value);
      final entity = workspaceV2Map(value['entity']);
      workspaceV2Fields(entity, {'kind', 'id'});
      _require(
        workspaceV2Uuid(value['uploadId']) &&
            workspaceV2Scopes.contains(value['scope']) &&
            workspaceV2KindScopes.containsKey(entity['kind']) &&
            _entityId(entity['id']) &&
            {'document', 'image'}.contains(value['purpose']) &&
            workspaceV2Hash(value['sha256']) &&
            workspaceV2SafeInteger(
              value['byteLength'],
              minimum: 1,
              maximum: workspaceV2ImageBytes,
            ) &&
            (value['mediaType'] == 'application/json' ||
                workspaceV2ImageTypes.contains(value['mediaType'])),
      );
      _require(
        workspaceV2KindScopes[entity['kind']] == value['scope'] &&
            value['scope'] != 'project.catalog',
      );
      _require(
        value['purpose'] == 'document'
            ? value['mediaType'] == 'application/json' &&
                  (value['byteLength'] as num) <= workspaceV2JsonBytes
            : value['scope'] == 'review.file' &&
                  workspaceV2ImageTypes.contains(value['mediaType']),
      );
      break;
    case 'blobSession':
      workspaceV2Fields(value, {
        ..._identityFields,
        'sessionId',
        'chunkBytes',
        'receivedIndexes',
        'expiresAt',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['sessionId']) &&
            value['chunkBytes'] == workspaceV2ChunkBytes &&
            _timestamp(value['expiresAt']),
      );
      _indexes(value['receivedIndexes']);
      break;
    case 'blobStatus':
      workspaceV2Fields(value, {..._identityFields, 'sessionId'});
      _identity(value);
      _require(workspaceV2Uuid(value['sessionId']));
      break;
    case 'blobChunk':
      workspaceV2Fields(value, {
        ..._identityFields,
        'sessionId',
        'index',
        'sha256',
        'bytesBase64',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['sessionId']) &&
            workspaceV2SafeInteger(value['index'], maximum: 319) &&
            workspaceV2Hash(value['sha256']),
      );
      final bytes = workspaceV2DecodeBase64(value['bytesBase64']);
      _require(workspaceV2Sha256Sync(bytes) == value['sha256']);
      break;
    case 'blobChunkAck':
      workspaceV2Fields(value, {
        ..._identityFields,
        'sessionId',
        'index',
        'sha256',
        'byteLength',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['sessionId']) &&
            workspaceV2SafeInteger(value['index'], maximum: 319) &&
            workspaceV2Hash(value['sha256']) &&
            workspaceV2SafeInteger(
              value['byteLength'],
              minimum: 1,
              maximum: workspaceV2ChunkBytes,
            ),
      );
      break;
    case 'blobCommitRequest':
      workspaceV2Fields(value, {
        ..._identityFields,
        'sessionId',
        'sha256',
        'byteLength',
      });
      _identity(value);
      _require(
        workspaceV2Uuid(value['sessionId']) &&
            workspaceV2Hash(value['sha256']) &&
            workspaceV2SafeInteger(
              value['byteLength'],
              minimum: 1,
              maximum: workspaceV2ImageBytes,
            ),
      );
      break;
    case 'blobCommitResponse':
      workspaceV2Fields(value, {..._identityFields, 'sessionId', 'ref'});
      _identity(value);
      _require(workspaceV2Uuid(value['sessionId']));
      _ref(value['ref']);
      break;
    case 'blobReadRequest':
      workspaceV2Fields(value, {
        ..._identityFields,
        'record',
        'sha256',
        'index',
      });
      _identity(value);
      final record = workspaceV2Map(value['record']);
      workspaceV2Fields(
        record,
        {'kind', 'id', 'revision'},
        optional: {'manifestId'},
      );
      _require(
        workspaceV2KindScopes.containsKey(record['kind']) &&
            _entityId(record['id']) &&
            workspaceV2SafeInteger(record['revision'], minimum: 1) &&
            (!record.containsKey('manifestId') ||
                workspaceV2Uuid(record['manifestId'])) &&
            workspaceV2Hash(value['sha256']) &&
            workspaceV2SafeInteger(value['index'], maximum: 319),
      );
      break;
    case 'blobReadResponse':
      workspaceV2Fields(value, {
        ..._identityFields,
        'sha256',
        'byteLength',
        'index',
        'chunkSha256',
        'bytesBase64',
      });
      _identity(value);
      _require(
        workspaceV2Hash(value['sha256']) &&
            workspaceV2SafeInteger(
              value['byteLength'],
              minimum: 1,
              maximum: workspaceV2ImageBytes,
            ) &&
            workspaceV2SafeInteger(value['index'], maximum: 319) &&
            workspaceV2Hash(value['chunkSha256']),
      );
      final bytes = workspaceV2DecodeBase64(
        value['bytesBase64'],
        expectedLength: workspaceV2ExpectedChunkLength(
          (value['byteLength'] as num).toInt(),
          (value['index'] as num).toInt(),
        ),
      );
      _require(workspaceV2Sha256Sync(bytes) == value['chunkSha256']);
      break;
    default:
      throw FormatException('未知v2合同：$schema');
  }
  return value;
}

String workspaceV2PayloadHash(Map<String, dynamic> payload) =>
    payload['encoding'] == 'json'
    ? payload['sha256'] as String
    : (payload['ref'] as Map)['sha256'] as String;

String workspaceV2ManifestText(List<Map<String, dynamic>> records) {
  final result = StringBuffer();
  Map<String, dynamic>? previous;
  for (final raw in records) {
    final record = workspaceV2Validate('record', raw);
    if (previous != null) {
      final kindComparison = (previous['kind'] as String).compareTo(
        record['kind'] as String,
      );
      _require(
        kindComparison < 0 ||
            kindComparison == 0 &&
                (previous['id'] as String).compareTo(record['id'] as String) <
                    0,
      );
    }
    final metadataHash = workspaceV2Sha256Sync(
      utf8.encode(workspaceV2CanonicalJson(record['metadata'])),
    );
    result.write(
      workspaceV2CanonicalJson([
        record['kind'],
        record['id'],
        record['revision'],
        record['sequence'],
        record['deleted'],
        workspaceV2PayloadHash(workspaceV2Map(record['payload'])),
        metadataHash,
      ]),
    );
    previous = record;
  }
  return result.toString();
}

String workspaceV2ManifestDigest(List<Map<String, dynamic>> records) =>
    workspaceV2Sha256Sync(utf8.encode(workspaceV2ManifestText(records)));

void workspaceV2VerifyManifest(
  Map<String, dynamic> manifest,
  List<Map<String, dynamic>> records,
) {
  workspaceV2Validate('manifest', manifest);
  _require(
    records.length == manifest['entityCount'] &&
        records.every(
          (record) =>
              (record['sequence'] as num) <= (manifest['through'] as num) &&
              (manifest['scopes'] as List).contains(
                (record['metadata'] as Map)['scope'],
              ),
        ) &&
        workspaceV2ManifestDigest(records) == manifest['entriesSha256'],
  );
}

String workspaceV2Path(String purpose) {
  _require(workspaceV2Purposes.contains(purpose));
  return '/workspace/v2/${purpose.replaceFirst('.', '/')}';
}

bool workspaceV2CheckUploadBudget(Map<String, dynamic> input) {
  _require(input.values.every((value) => workspaceV2SafeInteger(value)));
  return workspaceV2UploadFits(
    activeUploads: (input['activeUploads'] as num).toInt(),
    deviceDeclaredBytes: (input['deviceReservedBytes'] as num).toInt(),
    workspaceDeclaredBytes: (input['workspaceReservedBytes'] as num).toInt(),
    incomingBytes: (input['declaredBytes'] as num).toInt(),
  );
}

int workspaceV2SessionExpiry(num createdAtMs, num lastActivityMs) {
  _require(
    workspaceV2SafeInteger(createdAtMs) &&
        workspaceV2SafeInteger(lastActivityMs) &&
        lastActivityMs >= createdAtMs,
  );
  final absolute = createdAtMs.toInt() + workspaceV2AbsoluteTtlSeconds * 1000;
  final idle = lastActivityMs.toInt() + workspaceV2IdleTtlSeconds * 1000;
  final expiry = absolute < idle ? absolute : idle;
  _require(workspaceV2SafeInteger(expiry));
  return expiry;
}

void workspaceV2AssertEnvelopeBody(
  Map<String, dynamic> envelope,
  Map<String, dynamic> body,
) {
  workspaceV2Validate('envelope', envelope);
  _require(
    body['protocolVersion'] == 2 &&
        body['workspaceId'] == envelope['workspaceId'] &&
        body['deviceId'] == envelope['deviceId'],
  );
}

void workspaceV2AssertResponseEnvelope(Object? request, Object? response) {
  final sent = workspaceV2Validate('envelope', request);
  final received = workspaceV2Validate('envelope', response);
  for (final key in [
    'protocolVersion',
    'workspaceId',
    'serviceId',
    'deviceId',
    'purpose',
    'requestId',
    'counter',
  ]) {
    _require(sent[key] == received[key]);
  }
}

void workspaceV2AssertCapabilities(
  Object? request,
  Object? response,
  List<Map<String, dynamic>> approvedPermissions,
) {
  final sent = workspaceV2Validate('capabilitiesRequest', request);
  final received = workspaceV2Validate('capabilitiesResponse', response);
  _require(approvedPermissions.length <= 8);
  final approved = <String, Map<String, dynamic>>{};
  for (final permission in approvedPermissions) {
    workspaceV2Fields(permission, {'scope', 'read', 'write'});
    _require(
      workspaceV2Scopes.contains(permission['scope']) &&
          permission['read'] == true &&
          permission['write'] is bool &&
          !approved.containsKey(permission['scope']),
    );
    approved[permission['scope'] as String] = permission;
  }
  _require(
    sent['workspaceId'] == received['workspaceId'] &&
        sent['deviceId'] == received['deviceId'],
  );
  for (final value in received['permissions'] as List) {
    final permission = workspaceV2Map(value);
    final trusted = approved[permission['scope']];
    _require(
      (sent['clientScopes'] as List).contains(permission['scope']) &&
          trusted != null &&
          !(permission['write'] == true && trusted['write'] != true),
    );
  }
}

void workspaceV2AssertSyncResponse(Object? request, Object? response) {
  final sent = workspaceV2Validate('syncRequest', request);
  final received = workspaceV2Validate('syncResponse', response);
  _require(
    sent['workspaceId'] == received['workspaceId'] &&
        sent['deviceId'] == received['deviceId'] &&
        sent['scopeDigest'] == received['scopeDigest'] &&
        workspaceV2CanonicalJson(sent['scopes']) ==
            workspaceV2CanonicalJson(received['scopes']),
  );
  _require(
    (sent['through'] == null || sent['through'] == received['through']) &&
        (received['cursor'] as num) >= (sent['cursor'] as num) &&
        (received['changes'] as List).every(
          (record) => (record['sequence'] as num) > (sent['cursor'] as num),
        ),
  );
  final operations = {
    for (final raw in sent['operations'] as List)
      (raw as Map)['operationId']: workspaceV2Map(raw),
  };
  _require((received['receipts'] as List).length == operations.length);
  _require(
    !(received['hasMore'] == true &&
        received['cursor'] == sent['cursor'] &&
        (received['receipts'] as List).isEmpty),
  );
  final acknowledged = <String>{};
  for (final value in received['receipts'] as List) {
    final receipt = workspaceV2Map(value);
    final operation = operations[receipt['operationId']];
    _require(
      operation != null &&
          receipt['localRevision'] == operation['localRevision'] &&
          acknowledged.add(receipt['operationId'] as String),
    );
    if (receipt['status'] == 'rejected') {
      final target = workspaceV2Map(receipt['target']);
      final recordOperation = operation!['type'] == 'record';
      _require(
        target['kind'] ==
                (recordOperation ? operation['kind'] : 'todo_preferences') &&
            target['id'] == (recordOperation ? operation['id'] : 'workspace') &&
            receipt['operationHash'] == workspaceV2OperationHash(operation) &&
            (receipt['record'] != null || operation['baseRevision'] == 0) &&
            (receipt['record'] == null ||
                ((receipt['record'] as Map)['revision'] as num) >=
                    (operation['baseRevision'] as num)),
      );
      continue;
    }
    final record = workspaceV2Map(receipt['record']);
    if (operation!['type'] == 'record') {
      _require(
        record['kind'] == operation['kind'] &&
            record['id'] == operation['id'] &&
            !(receipt['status'] == 'accepted' &&
                (record['revision'] as num) <
                    (operation['baseRevision'] as num)),
      );
    } else {
      _require(
        record['kind'] == 'todo_preferences' && record['id'] == 'workspace',
      );
    }
  }
}

String workspaceV2OperationHash(Map<String, dynamic> operation) =>
    workspaceV2Sha256Sync(
      utf8.encode(
        workspaceV2CanonicalJson(workspaceV2Validate('operation', operation)),
      ),
    );
